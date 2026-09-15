# Especificação — FinControl (ciclo pós-1.2.1)

**Status:** Draft (discovery)
**Produto:** FinControl (existente, em produção)
**Baseline publicado:** v1.2.1 (`VERSION`, tag `v1.2.1` = `d35a2cf9b9050c001a5e43e89567ada5ed87f306`)
**Branch de trabalho:** `revisao-pos-1.2.1`
**HEAD Git no bootstrap deste ciclo:** `4c462d6a2dd2659c95ad08f3db8e94c3e52e1ad3`
**Este arquivo é a única fonte de requisitos do ciclo.** Não há PRD concorrente.

---

## 1. Visão / contexto

O FinControl já é o app pessoal de finanças do dono, em uso diário: contas
fixas e variáveis, entradas, metas, anexos, contas bancárias, orçamentos,
compromissos, calendário `.ics`, IA (OpenRouter) e push (PWA). Single-user.

Stack vigente (não reinventar):

- Backend FastAPI + SQLite WAL (`backend/`)
- Frontend React + TypeScript + Vite, PWA (`frontend/`)
- Clientes: Capacitor (iOS/Android) + Tauri 2 (macOS/Windows)
- Produção: VPS + Caddy (HTTPS) + systemd; frontend estático same-origin
- Auth: senha (mín. 12) + TOTP, JWT curto + refresh httpOnly, passkeys,
  rate limit no login; cadastro HTTP bloqueado em produção (conta via
  `python -m app.setup_user`)

Fases 0–4 do `PLANO.md` já foram entregues até a 1.2.1. Este ciclo **não**
abre produto novo e **não** reescreve o que está no ar. O problema é fechar
a revisão de código **depois** da 1.2.1: o working tree em
`revisao-pos-1.2.1` já contém o WIP (32 arquivos modificados +
`backend/tests/test_anexos.py` + `backend/tests/test_ia_versao.py`,
uncommitted) e dois furos confirmados (P1 saldo, P2 teste de push).

Custo de não fechar: race de saldo com `delta_cents` (dois POSTs no mesmo
segundo podem gravar o mesmo total); allowlist de push sem prova; CHANGELOG
`[Não lançado]` afirma `BEGIN IMMEDIATE` que o código não faz
(`isolation_level = "IMMEDIATE"` no SELECT, Python 3.14
`in_transaction=False`).

---

## 2. Requisitos deste ciclo (numerados)

### R1 — Baseline 1.2.1 permanece

1. O produto publicado 1.2.1 é a linha de base. Funcionalidades já no ar
   (CRUD financeiro, If-Match das tabelas da 1.2.0, offline/fila, cofre
   biométrico, servidor em runtime, updater Tauri, CI `security.yml` /
   `release.yml`, backup, feed `.ics`) **não** são reescritas nem removidas
   neste ciclo.
2. `VERSION` continua `1.2.1` até o dono decidir versionar um lançamento.
   Este ciclo não cria tag, não publica e não sobe MAJOR/MINOR/PATCH.

### R2 — Fechar o WIP pós-1.2.1 (já no working tree)

O WIP uncommitted é a entrega a concluir, não um rascunho a descartar.
Deve permanecer e ser verificável:

**Auth / MFA**
3. Re-enrolment de MFA (`POST /api/auth/mfa/iniciar` e `/mfa/confirmar`)
   exige TOTP vigente **ou** senha se já houver `totp_secret`. Primeira
   ativação (sem secret) não pede fator extra.
4. `python -m app.setup_user`, após gravar senha/2FA, bumpa
   `refresh_version` e apaga `refresh_tokens` (sessões abertas caem).
5. `refresh_token` no JSON de login só sai se a `Origin` estiver em
   `ORIGENS_NATIVAS`. `X-Client: native` sozinho, com Origin web, **não**
   devolve o token.

**IA / anexos / passkeys / push (implementação)**
6. Writes de IA incrementam `versao`: `categorizar-lote` em
   `lancamentos_variaveis`; `estrategia_texto` em `metas`;
   `orientacao_texto` em `compromissos` — senão o If-Match da fila
   offline fica furado.
7. Rate limit 10/min em `POST /ia/perguntar`, `/extrair`,
   `/extrair-itens` e `/insights`.
8. Download/exclusão de anexo confina o path com `resolve` /
   `is_relative_to` da pasta de uploads (path traversal → 400).
9. `POST /push/subscribe` recusa endpoint que não seja HTTPS de host da
   allowlist (`_endpoint_push_ok`).
10. PATCH/DELETE de passkey inexistente devolve 404.

**Offline / frontend / nativo**
11. Fila offline: 409 = `conflito` (não derruba o resto); 404 em DELETE =
    descarta o item; 400/422 (e demais 4xx que não sejam 409/404-DELETE) =
    status `permanente`, sem retentar.
12. Mutação PATCH/PUT/DELETE em id otimista (negativo) é recusada no
    cliente; edição/exclusão/anexo ficam escondidos em linhas pendentes.
13. Dashboard, Variáveis e Entradas ignoram resposta antiga ao trocar
    competência (guarda de requisição).
14. `AnexoCampo` sem `capture="environment"` (picker nativo aceita PDF no
    iOS).
15. Rota desconhecida redireciona para `/`. Clique em notificação navega
    para `data.url`.
16. Configurações: “Sair de todos os aparelhos” chama
    `POST /api/auth/logout?todos=1`.
17. Boot nativo: falha do cofre/início mostra tela de erro, não `#root`
    vazio. Há ErrorBoundary nas rotas (o texto cru de `erro.message` neste
    boundary **não** precisa ser genericizado neste ciclo — ver N8).
18. iOS: `NSFaceIDUsageDescription` e `NSCameraUsageDescription`.
    Android: `allowBackup=false`.
19. Testes novos/alterados do WIP entram na suíte: `test_anexos.py`,
    `test_ia_versao.py`, casos MFA/sessão/passkey 404 e os casos de fila
    404/422 em `offline.test.ts`.

### R3 — P1 ACEITE: race de saldo

20. `POST /api/contas-bancarias/{id}/saldos` deve emitir **`BEGIN IMMEDIATE`
    explícito** (SQL) **antes** de reler o último saldo. Só
    `db.isolation_level = "IMMEDIATE"` **não** satisfaz: no Python 3.14 o
    SELECT seguinte fica com `in_transaction=False` e dois POSTs com
    `delta_cents` no mesmo segundo leem o mesmo saldo e ambos inserem.
21. O último saldo usado para aplicar `delta_cents` (e a variação
    devolvida) é lido **depois** do lock, na mesma transação, não antes.

### R4 — P2 ACEITE: testes do allowlist de push

22. Existem testes automatizados de `_endpoint_push_ok` (função direta
    e/ou `POST /push/subscribe`) cobrindo **no mínimo**:
    - endpoint `http://…` (não HTTPS) → recusa;
    - IP interno (ex. `127.0.0.1` / `10.0.0.1` / link-local) → recusa;
    - host fora da lista (`_HOSTS_PUSH` / `_SUFIXOS_PUSH`) → recusa.
23. A allowlist já presente no WIP permanece: HTTPS, hostname conhecido
    (FCM, Mozilla, Apple, Windows Notify) ou sufixo correspondente; userinfo
    no URL também recusa.

### R5 — CHANGELOG alinhado ao código

24. A seção `[Não lançado]` só afirma o que o working tree realmente faz.
    Hoje a linha “POST de saldo usa `BEGIN IMMEDIATE` e relê o último saldo
    na transação” é falsa; ou o código cumpre R3 e a linha permanece, ou a
    linha é corrigida/removida até o código cumprir.
25. Demais bullets de `[Não lançado]` (auth/MFA, If-Match IA, fila, nativo,
    anexos, push, passkey 404) correspondem ao código deste ciclo.

### R6 — Git e preservação

26. Permanecer em `revisao-pos-1.2.1` enquanto o WIP estiver uncommitted.
    Não misturar commit de produto com fontes `pipeline/`. Não versionar
    `pipeline/.task-lock` nem `.opencode/`.
27. Commit e push **somente** com confirmação humana por execução (P3 de
    `TAREFAS_PENDENTES.md`). Este ciclo **não** inclui commit/push
    automático nem criação de tag.

---

## 3. Não-objetivos (numerados)

1. Não reescrever o app, não abrir greenfield, não “começar o FinControl”.
2. Não tratar `MELHORIAS.md` como compromisso deste ciclo.
3. Não inventar hospedagem cloud (AWS, PaaS, etc.): produção já é VPS + Caddy.
4. Não incluir commit, push, tag ou publicação automática (P3 é humano).
5. Não transformar números de performance das personas upstream (latência
   de API, % de requests, CSAT, NPS, RICE, GTM, rollout %) em requisito.
6. Não bump de versão, não release notes de GA, não disparar `release.yml`.
7. Não reabrir o roadmap das etapas 1.1.0 / 1.2.0 já marcadas feitas.
8. Não genericizar o ErrorBoundary (`erro.message` cru) — item aberto em
   `MELHORIAS.md`.
9. Não construir UI de “Descartar” para erro permanente da fila (400/422 /
   429) — item aberto em `MELHORIAS.md`.
10. Não construir UI nativa Swift/Kotlin.
11. Não alterar controles, recibos ou scripts do pipeline via este ciclo de
    produto; `gates.json` só depois da architecture, revisado pelo usuário.
12. Não executar deploy; não chamar DevOps neste SPEC.

---

## 4. Critérios de aceite (numerados, verificáveis)

**Baseline**
1. `VERSION` = `1.2.1`. Tag `v1.2.1` continua apontando para `d35a2cf9`.
2. Nenhuma funcionalidade da 1.2.1/1.2.0 listada em R1 foi removida como
   “limpeza” deste ciclo.

**WIP (R2) — evidência: código + testes já no working tree**
3. `test_mfa_reenrolment_recusado_sem_fator_vigente` e
   `test_mfa_reenrolment_aceita_totp_atual` passam; primeira ativação
   (`test_mfa_primeira_ativacao_nao_pede_fator`) passa.
4. `test_setup_user_bumpa_refresh_version` passa (`refresh_version` +1,
   `refresh_tokens` vazio, refresh antigo → 401).
5. `test_x_client_native_em_origem_web_nao_devolve_refresh` passa;
   `test_origem_nativa_devolve_refresh` passa.
6. `backend/tests/test_ia_versao.py` (três casos) passa: categorizar-lote,
   estratégia de meta e orientação de compromisso incrementam `versao`;
   If-Match velho em variável após lote → 409.
7. Rotas de IA em R2.7 têm `@limiter.limit("10/minute")`.
8. `backend/tests/test_anexos.py` (`test_baixar_recusa_path_traversal`)
   passa (path `../../etc/passwd` → 400).
9. `test_patch_delete_passkey_inexistente_e_404` passa.
10. Vitest da fila: 404 em DELETE descarta; 422 vira `permanente` e não
    entra em `conflitos` / `aProcessar`.
11. `api.ts` recusa PATCH/PUT/DELETE cujo path contém id negativo;
    Variáveis/Entradas não expõem editar/excluir em `id < 0`.
12. Info.plist contém as duas chaves de uso; AndroidManifest tem
    `android:allowBackup="false"`.
13. `iniciar().catch(telaDeErro)` existe em `main.tsx`; rotas envolvidas
    por boundary; `path="*"` redireciona para `/`.

**P1 (R3)**
14. Em `atualizar_saldo` (`backend/app/routers/contas_bancarias.py`) há
    execução de SQL `BEGIN IMMEDIATE` (string visível no código), não só
    atribuição a `isolation_level`.
15. A leitura de `_ultimo_saldo` (ou equivalente) ocorre **depois** desse
    `BEGIN IMMEDIATE` e **antes** do `INSERT` em `saldos_conta`.
16. `delta_cents` aplica-se sobre o valor relido sob o lock. Dois POSTs
    concorrentes com `delta_cents` no mesmo segundo não podem ambos partir
    da mesma leitura pré-lock.
17. `isolation_level = "IMMEDIATE"` **sozinho** não conta como aceite,
    mesmo com comentário dizendo “BEGIN IMMEDIATE”.

**P2 (R4)**
18. A suíte pytest inclui casos nomeados ou claramente identificáveis para
    os três recusados de R4.22 (http, IP interno, host fora da lista).
19. Endpoint HTTPS de host da allowlist **não** é quebrado por esses testes
    (regressão da inscrição legítima fora do escopo de recusa).

**CHANGELOG (R5)**
20. Grep de `[Não lançado]` vs. código: se o CHANGELOG cita `BEGIN
    IMMEDIATE`, o critério 14 também passa. Nenhuma afirmação de
    `[Não lançado]` contradiz o working tree.

**Git (R6)**
21. WIP de produto (os 32 arquivos + 2 testes novos) não foi descartado
    por reset/clean. Branch de trabalho permanece `revisao-pos-1.2.1`
    enquanto uncommitted.
22. Este ciclo não declara “commit feito” nem “push feito” sem confirmação
    humana por execução.

**Verificação de qualidade deste ciclo (sem fingir gates)**
23. Comandos reais da stack existente — `cd backend && .venv/bin/python -m
    pytest tests/ -q` e `cd frontend && npm test` — são o meio de prova
    dos critérios 3–11 e 18. Não usar `opencode-pipeline gate` como prova
    enquanto `gates.json` estiver `configured=false` com `npm` genérico
    na raiz.
24. Números de latência, throughput ou “X% das requests” **não** são
    critérios. Ausência deles não bloqueia aceite.

---

## 5. Fora de escopo explícito

- Itens abertos de `MELHORIAS.md`: UI Swift/Kotlin; UI de erro permanente
  da fila (“Descartar”); ErrorBoundary genérico.
- P3 commit + push + tag + publicação (humano, fora do pipeline de
  implementação).
- Provisionar cloud, mudar de VPS/Caddy, operar produção.
- Live-update Capacitor, token GitHub no bundle, fila offline de anexos/
  IA/passkeys (já recusados na etapa 1.2.0).
- Confirmar updater real Mac (`RELEASES_PAT` / ciclo `.dmg`) — ressalva
  1.2.0, não deste ciclo.
- Preencher `pipeline/ARCHITECTURE.md` de stack (fase architecture),
  configurar `gates.json` (usuário, fase quality-gates), `DEPLOY.md`
  (só após gate + prontidão na mesma versão).
- Qualquer PRD, Opportunity Assessment, GTM ou roadmap Now/Next/Later
  fora deste arquivo.

---

## 6. Evidência já observada (discovery; não é correção)

- P1 aberto no código atual: `atualizar_saldo` faz
  `db.isolation_level = "IMMEDIATE"` e em seguida o SELECT de existência /
  `_ultimo_saldo` **sem** `BEGIN IMMEDIATE`. Comentário no WIP mente.
- CHANGELOG `[Não lançado]` linha “POST de saldo usa `BEGIN IMMEDIATE`…”
  desalinhada (R5).
- P2: `_endpoint_push_ok` + recusa no `subscribe` existem no WIP; **não**
  há teste (grep só acha a função em `push.py` e nas notas de pipeline).
- Readiness bootstrap: `blocked`. Gates não configurados para
  FastAPI/pytest + Vite/vitest.
