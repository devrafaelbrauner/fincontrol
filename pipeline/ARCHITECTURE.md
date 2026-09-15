# Arquitetura — FinControl (ciclo pós-1.2.1)

**Status:** consolidado (ARCH-STACK).
**Produto:** FinControl existente, em produção.
**Baseline publicado:** v1.2.1 (`VERSION` = `1.2.1`; tag `v1.2.1` = `d35a2cf9b9050c001a5e43e89567ada5ed87f306`).
**Este ciclo não bumpa versão, não cria tag e não publica.**

Documento da stack **já em uso**. Não é greenfield. `PLANO.md` descreve Fases 0–4 como roadmap; essas fases já foram entregues até a 1.2.1 — inclusive Capacitor/Tauri (o plano ainda trata nativos como “somente se a PWA decepcionar”; isso está obsoleto). Produção continua VPS + Caddy; **não** há hospedagem cloud nova.

---

## Git (GIT-BOOTSTRAP)

Registrado a partir do diagnóstico do agency-git-workflow-master e atualizado após GIT-COMMIT-PIPELINE-DOCS, GIT-ISOLATE-WIP-BRANCH e GIT-COMMIT-DISC-DOCS.

### Estado atual

- Branch de trabalho: `revisao-pos-1.2.1` (sem upstream) — permanecer nela enquanto o WIP estiver uncommitted
- HEAD: `34b7c6969cf330742bbc73d41985cca2e6df7b70` (GIT-COMMIT-DISC-DOCS: fontes de discovery). Sem push. Sem tag.
- Ref `main`: `4c462d6a2dd2659c95ad08f3db8e94c3e52e1ad3` (1 ahead de `origin/main` nas refs locais; bootstrap do pipeline)
- Tag `v1.2.1`: `d35a2cf9b9050c001a5e43e89567ada5ed87f306`
- Tracking: `main` → `origin/main`; fetch/pull não rodaram nesta sessão
- Remoto existente (não inventar outro): `origin` = `https://github.com/devrafaelbrauner/fincontrol.git`
- Working tree: sujo (WIP de produto); staged vazio
- Push em `main` dispara `.github/workflows/security.yml`
- Tags `v*` / `workflow_dispatch` disparam `.github/workflows/release.yml`
- Push **não** autorizado até o dono pedir; não criar tag

### Convenção observada (manter)

- Trunk-based em `main` (linha publicável, tags `vX.Y.Z`).
- Feature branches curtas em kebab-case descritivo, sem prefixos `feat/`/`fix/`.
- Commits em português, frase completa, sem Conventional Commits (`feat:`/`fix:`).
- Integração via GitHub PR + merge commit.
- Vincular commits aos IDs de `TASKS.md`.
- Um tema por commit; não misturar produto e fontes canônicas do pipeline.

### Isolamento do WIP (executado)

Branch `revisao-pos-1.2.1` criada a partir de `4c462d6` (pipeline bootstrap); discovery commitou `34b7c696` nesta branch.
WIP pós-1.2.1 permanece **uncommitted** (32 modified + `backend/tests/test_anexos.py` e
`backend/tests/test_ia_versao.py`). Checkout de `main` arrasta esse working tree;
não voltar a `main` sem stash/commit do WIP. Commit/push do WIP só com confirmação
humana; não criar tag.

### Não versionar

- `pipeline/.task-lock`
- `.opencode/`
- `pipeline/evidence/`
- `.env`, `.venv/`, `node_modules/`, `backend/data/`, `backend/uploads/`, builds nativos

Proposta de acréscimo ao `.gitignore` (coordenador consolida; owner implementa, ainda não aplicado):

```
.opencode/
pipeline/.task-lock
pipeline/evidence/
```

### Operações proibidas automaticamente

Force-push, reset, clean, rebase, amend, exclusão de branches/tags.
Branches locais divergentes (`compromisso-so-o-nome`, `pr57-rebase` gone) não limpar sozinho.

---

## 1. Stack e runtime

**Padrão:** monólito modular no mesmo repositório. Um processo FastAPI, um SQLite, um frontend estático. Sem microsserviços, sem fila externa, sem banco gerenciado, sem PaaS.

### Backend

| Item | Vigente |
|---|---|
| Framework | FastAPI (`backend/app/main.py`), versão lida de `VERSION` |
| Servidor | uvicorn `app.main:app` |
| Banco | SQLite WAL (`backend/app/db.py`) |
| Auth | senha (Argon2, mín. 12) + TOTP + JWT + refresh httpOnly + passkeys (WebAuthn) |
| Rate limit | slowapi (login 5/min por IP + teto global 30/min; refresh 30/min; logout 10/min; IA 10/min) |
| Docs OpenAPI | desligados em produção (`docs_url`/`redoc_url`/`openapi_url` = None) |

Routers sob `/api` com `Depends(require_auth)`, exceto auth/status/cadastro/login/refresh/logout, WebAuthn login e o feed `.ics` (`/calendar/{token}.ics`, autenticado só pelo token na URL).

### Frontend

| Item | Vigente |
|---|---|
| UI | React 18 + TypeScript + Vite 7, PWA (`vite-plugin-pwa`) |
| Cliente HTTP | `frontend/src/api.ts` — Bearer, refresh single-flight, fila offline, If-Match |
| Testes | vitest (`npm test`) |
| Node | `^20.19.0 \|\| >=22.12.0` |

### Clientes nativos (já existem; não são deste ciclo)

- **Capacitor 8:** iOS/Android. Origens CORS fixas: `capacitor://localhost`, `https://localhost`. `VITE_API_BASE` congelada no bundle.
- **Tauri 2:** macOS/Windows. Origens: `tauri://localhost`, `https://tauri.localhost`. Dev: `http://localhost:1420`.
- Cofre biométrico e updater Tauri já na 1.2.1. Este ciclo **não** adiciona tela nativa Swift/Kotlin.

### Runtime local

```
cd backend && .venv/bin/python -m app.setup_user
cd backend && .venv/bin/uvicorn app.main:app --reload     # :8000
cd frontend && npm run dev                                  # :5173, proxy /api
```

Prova deste ciclo (aceite 23), **não** `opencode-pipeline gate` enquanto `gates.json` estiver `configured=false`:

```
cd backend && .venv/bin/python -m pytest tests/ -q
cd frontend && npm test
```

### Runtime de produção (já no ar)

```
HTTPS (Caddy / Let's Encrypt)
  ├── /api/*  e  /calendar/*  → uvicorn 127.0.0.1:8000 (systemd `fincontrol`)
  └── resto                   → frontend/dist (same-origin, sem CORS no web)
```

- Unidade: `deploy/fincontrol.service` (`User=fincontrol`, `ProtectSystem=strict`, `ReadWritePaths=/opt/fincontrol/backend/data`).
- Atualização: `deploy/deploy.sh` (git pull como `fincontrol`, backup do SQLite, restart, `/api/health`). **Este ciclo não executa deploy.**
- Segredos no `backend/.env` da VPS: `FINCONTROL_ENV=production`, `FINCONTROL_SECRET_KEY` (≥32, não default), `FINCONTROL_FERNET_KEY` obrigatória, `FINCONTROL_COOKIE_SECURE=1`.
- Produção recusa subir com defaults (`main._validar_ambiente`). Cadastro HTTP = 403; conta só via `python -m app.setup_user`.
- Backup diário: `sqlite3 .backup` + `uploads.tar.gz` + rclone opcional (`FINCONTROL_BACKUP_REMOTE`). Não é cloud de aplicação.

**Fora:** AWS, PaaS, Kubernetes, banco gerenciado, CDN como requisito, novo remoto Git.

---

## 2. Dados

### Persistência

- Arquivo: `$FINCONTROL_DATA/fincontrol.db` (padrão `backend/data/`).
- `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Uma conexão por request (`get_db` faz `commit` no sucesso; exceções **não** commitam — rotas que precisam persistir erro, como refresh revogado, chamam `db.commit()` à mão).
- Migrations SQL versionadas em `backend/app/migrations/*.sql`, aplicadas no boot (`schema_migrations`). Expand-only; este ciclo **não** adiciona migration.
- Valores monetários em **centavos INTEGER**. Conversão no cliente: `brl` / `paraCents` em `api.ts`. `saldos_conta.valor_cents` **não** tem `CHECK (>= 0)` (cheque especial é saldo legítimo).
- Anexos em disco (`uploads/`), nome = hash; teto ASGI 25 MB (Caddy `request_body max_size 25MB`); anexo individual 15 MB.
- Timezone de negócio: `America/Sao_Paulo`. Competência `YYYY-MM`. Lançamentos fixos gerados **on-access**, não por cron.

### Estoque vs fluxo

`contas_bancarias` / `saldos_conta` (migration 012) rastreiam **estoque**. O resto do app rastreia **fluxo**. Variação de saldo **não** vira lançamento. `variacao_cents` / `variacao_pct` são derivados das duas leituras mais recentes, nunca gravados.

### Concorrência de linha (`versao` / If-Match)

Coluna `versao INTEGER` (migrations 013 e 018), **não** `atualizado_em` (resolução de 1s no SQLite). Tabelas: `compromissos`, `contas_fixas`, `contas_bancarias`, `lancamentos_variaveis`, `lancamentos_fixos`, `entradas`, `metas`, `metas_itens`, `metas_aportes`, `categorias`, `orcamentos`, `parcelamentos`.

- Cliente manda `If-Match: <versao lida>`.
- Ausente = last-write-wins (precondição HTTP opcional).
- Divergente → `ConflitoDeVersao` → **409** `{"detail":"…","atualizado_em": <versao atual>}` (campo histórico; o valor é o contador `versao`).
- Writes de IA deste WIP incrementam `versao`: `POST /ia/categorizar-lote` em `lancamentos_variaveis`; `estrategia_texto` em `metas`; `orientacao_texto` em `compromissos`. Sem isso a fila offline aplica If-Match velho.

`saldos_conta` **não** usa If-Match: cada POST é um INSERT de leitura. A serialização é o lock de escrita (contrato P1).

---

## 3. Auth

Single-user (`sub: "dono"`). Sem RBAC, sem tenants.

| Peça | Contrato vigente |
|---|---|
| Senha | Argon2; mín. 12 + letra + dígito + especial |
| TOTP | pyotp, `valid_window=1`; anti-replay em `config.totp_usados` (janela 95s) |
| Access JWT | HS256, 30 min, `Authorization: Bearer`, `type=access` |
| Refresh | JWT 30 dias, cookie httpOnly `fincontrol_refresh` path `/api/auth`, SameSite=Lax, Secure em prod; nativo: JSON + `X-Refresh-Token` |
| Rotação | compare-and-swap em `refresh_tokens`; janela de graça 30s; reuso fora da graça → `_bump_refresh_version` (401, todas as sessões caem) |
| Teto | `MAX_SESSOES = 10`; despejo marca `vigente=0` (não é reuso) |
| Login | `POST /api/auth/login` — 401 `"codigo_totp_necessario"` se faltar 2FA; rate 5/min IP |
| Cadastro web | 403 em produção |
| Passkeys | `/api/auth/webauthn/*`; PATCH/DELETE de credencial inexistente → **404** `"Passkey não encontrada"` |
| Logout | `POST /api/auth/logout` este aparelho; `?todos=1` bumpa `refresh_version` |

### Origem nativa (WIP — R2.5)

`refresh_token` no JSON **somente** se `Origin` ∈ `ORIGENS_NATIVAS`:

`capacitor://localhost`, `https://localhost`, `tauri://localhost`, `https://tauri.localhost`.

`X-Client: native` sozinho, com Origin web, **não** devolve o token. Cookie httpOnly segue sendo setado.

### MFA re-enrolment (WIP — R2.3)

`POST /api/auth/mfa/iniciar` e `POST /api/auth/mfa/confirmar`:

- Sem `totp_secret`: primeira ativação, sem fator extra.
- Com `totp_secret`: exige TOTP vigente **ou** senha; falta/erro → **403** `"Confirme com o código atual do autenticador ou com a senha"`.
- `/mfa/confirmar` ainda valida o código do secret **pendente** (400 se incorreto / sem ativação em andamento).

### `setup_user` (WIP — R2.4)

Após gravar senha/2FA: `_bump_refresh_version` (`refresh_version` +1 e `DELETE FROM refresh_tokens`). Refresh antigo → 401.

---

## 4. Contratos API deste ciclo

Prefixo `/api`. Mutações autenticadas (exceto login/cadastro/refresh/logout/status e WebAuthn login). Cliente: `frontend/src/api.ts`.

### 4.1 P1 — `POST /api/contas-bancarias/{id}/saldos` (contrato-alvo)

**Estado atual (furo, não corrigir nesta task):** `atualizar_saldo` faz `db.isolation_level = "IMMEDIATE"` e em seguida o SELECT de existência / `_ultimo_saldo` **sem** SQL `BEGIN IMMEDIATE`. No Python 3.14 o SELECT seguinte fica com `in_transaction=False`. Dois POSTs com `delta_cents` no mesmo segundo leem o mesmo saldo e ambos inserem. O comentário e o CHANGELOG `[Não lançado]` afirmam o que o código não faz.

**Contrato-alvo (aceite 14–17, R3.20–21) — IMPL-P1-SALDO:**

Ordem obrigatória em `atualizar_saldo` (`backend/app/routers/contas_bancarias.py`):

1. Executar SQL com a string visível **`BEGIN IMMEDIATE`** (não basta `isolation_level = "IMMEDIATE"`, mesmo com comentário).
2. Só então `SELECT` de existência da conta e `_ultimo_saldo` (leitura **depois** do lock, **antes** do `INSERT`).
3. Aplicar `delta_cents` sobre o valor **relido** nessa transação.
4. `INSERT INTO saldos_conta (...)`.
5. Resposta 201 com variação derivada da leitura anterior **já sob o lock**.

Dois POSTs concorrentes com `delta_cents` no mesmo segundo **não** podem ambos partir da mesma leitura pré-lock.

**Request**

- Path: `conta_id` inteiro.
- Header: `Authorization: Bearer <access>`.
- Body JSON (`SaldoIn`): exatamente um de `valor_cents` (absoluto) **ou** `delta_cents` (delta no servidor); `observacao` opcional. Os dois ou nenhum → validação Pydantic **422**.

**Response 201**

```json
{ "id": <int>, "saldo_cents": <int>, "variacao_cents": <int|null>, "variacao_pct": <float|null> }
```

`variacao_*` = None na primeira leitura (não zero).

**Erros**

| Status | Quando |
|---|---|
| 401 | sem/invalid access |
| 404 | conta inexistente |
| 400 | `delta_cents` e a conta ainda não tem linha em `saldos_conta` |
| 422 | ambos ou nenhum campo de valor |

Não há If-Match neste POST. `agora_iso()` carimba `registrado_em`; o lock impede dois deltas no mesmo segundo de colidir no total, não no timestamp.

### 4.2 P2 — `POST /api/push/subscribe` e `_endpoint_push_ok`

**Estado atual:** allowlist e recusa já estão no WIP (`push.py`). **Não há teste** (P2 = só testes em IMPL-P2-PUSH-TEST; não enfraquecer a allowlist).

**Request** (auth Bearer; 201)

```json
{ "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } }
```

**`_endpoint_push_ok(endpoint) -> bool` (R4.23)**

1. `urlparse`; `ValueError` → False.
2. Recusa se `scheme != "https"` **ou** hostname vazio **ou** `username`/`password` (userinfo).
3. `host = hostname.lower().rstrip(".")`.
4. Aceita se `host` ∈ `_HOSTS_PUSH` **ou** `host.endswith` algum `_SUFIXOS_PUSH`.

`_HOSTS_PUSH`: `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`.
`_SUFIXOS_PUSH`: `.notify.windows.com`, `.push.apple.com`, `.fcm.googleapis.com`.

**Erros**

| Status | Quando |
|---|---|
| 401 | sem auth |
| 503 | VAPID ausente (`FINCONTROL_VAPID_PUBLIC`/`PRIVATE`) |
| 400 | `"Endpoint de push inválido"` se `_endpoint_push_ok` é False |
| 201 | `{"ok": true}` (upsert por `endpoint`) |

**Testes mínimos (aceite 18–19)** — casos identificáveis, função direta e/ou HTTP:

- `http://…` → recusa
- IP interno (`127.0.0.1` / `10.0.0.1` / link-local) → recusa
- host fora de `_HOSTS_PUSH`/`_SUFIXOS_PUSH` → recusa
- HTTPS de host da allowlist **não** quebra (regressão da inscrição legítima)

Motivo da allowlist: o servidor chama `webpush()` no URL do cliente (SSRF autenticado se aceitar http/IP/webhook arbitrário).

### 4.3 MFA / refresh (WIP — verificar em IMPL-WIP-BACKEND, não redesenhar)

| Rota | Mensurável |
|---|---|
| `POST /api/auth/mfa/iniciar` | 200 `{secret, otpauth_uri}` se fator ok ou primeira vez; 403 sem fator vigente |
| `POST /api/auth/mfa/confirmar` | 200 `{ativo: true}`; 400 sem pendente / código novo errado; 403 sem fator vigente |
| `POST /api/auth/login` | JSON `refresh_token` só com Origin nativa |
| `POST /api/auth/refresh` | cookie e, se nativo, `refresh_token`; 401 revogado/despejado/ausente |
| `python -m app.setup_user` | `refresh_version` +1, tabela `refresh_tokens` vazia |
| `PATCH/DELETE /api/auth/webauthn/credenciais/{id}` | 404 se inexistente |
| Download/exclusão anexo | path `resolve`/`is_relative_to`; traversal → **400** |
| `POST /ia/perguntar`, `/extrair/{id}`, `/extrair-itens/{id}`, `/insights/{competencia}` | `@limiter.limit("10/minute")` |

### 4.4 Fila offline (cliente; sem tela nova)

Prefixos enfileiráveis: `/variaveis`, `/entradas`, `/metas`, `/categorias`, `/orcamentos`, `/compromissos`, `/contas-fixas`, `/contas-bancarias`. Fora: IA, push, auth, anexos.

| HTTP no replay | Efeito |
|---|---|
| 2xx | remove da fila |
| 409 | status `conflito`; **não** bloqueia os próximos |
| 404 em DELETE | descarta o item |
| 400/422 e demais 4xx (exceto 409 e 404-DELETE) | `permanente`, sem retentar |
| 5xx | `erro`, retenta no próximo drain |
| PATCH/PUT/DELETE com id negativo no path | recusado no cliente |

UI de “Descartar” para permanente **não** entra (N9).

---

## 5. UX existente (sem telas novas)

Hub em `/` (“Visão geral”). Rotas já no ar: `/analises`, `/assistente`, `/importar`, `/fixas`, `/variaveis`, `/entradas`, `/metas`, `/compromissos`, `/recursos` (contas bancárias/saldos), `/calendario`, `/config`. `path="*"` → `/`. Login em `/login`.

Este ciclo **não** cria tela, componente de hub, UI nativa nem genericiza o ErrorBoundary (`erro.message` cru permanece — N8). Clique em notificação navega para `data.url`. Configurações: “Sair de todos os aparelhos” → `POST /api/auth/logout?todos=1`.

---

## 6. ADRs (decisões já tomadas)

Não são opções abertas. Não inventar cloud, banco novo ou rewrite.

**ADR-001 — Monólito FastAPI + SQLite, não microsserviços.** Um usuário, um processo, um arquivo. Complexidade operacional extra não se justifica.

**ADR-002 — SQLite WAL no disco da VPS, não banco gerenciado.** Backup `sqlite3 .backup` + rclone. WAL + `busy_timeout=5000` cobrem writes concorrentes do mesmo dono em vários aparelhos.

**ADR-003 — Produção = VPS + Caddy + systemd.** Same-origin web. HTTPS/HSTS/CSP no Caddy. Não migrar para AWS/PaaS neste ciclo (N3).

**ADR-004 — Dinheiro em centavos INTEGER.** Nunca float. Saldos podem ser negativos.

**ADR-005 — Auth senha + TOTP + JWT curto + refresh rotacionado + passkeys.** Cadastro HTTP bloqueado em produção. Passkey é caminho extra, não substituto.

**ADR-006 — Refresh no JSON só com Origin nativa.** `X-Client` é forjável no web. Cookie httpOnly no browser.

**ADR-007 — If-Match com contador `versao`, não `atualizado_em`.** Writes de IA que alteram linha versionada incrementam `versao`.

**ADR-008 — Clientes: PWA + Capacitor + Tauri já entregues.** Não reabrir “PWA vs nativo”. Sem UI Swift/Kotlin (N10).

**ADR-009 — Allowlist HTTPS de push (SSRF).** Recusa http, userinfo, IP e host desconhecido. Calendário `.ics` continua o lembrete principal.

**ADR-010 — Lock de saldo = SQL `BEGIN IMMEDIATE` explícito.** `isolation_level = "IMMEDIATE"` sozinho não serializa o SELECT no Python 3.14. Contrato-alvo do P1; código ainda não cumpre.

**ADR-011 — IA só via OpenRouter no backend.** Chave Fernet; nunca no cliente.

**ADR-012 — Feed `.ics` público por capability URL.** Tratar o token como senha; Caddy encaminha `/calendar/*`.

**ADR-013 — `VERSION` permanece `1.2.1` até o dono versionar.** Sem tag, sem `release.yml`, sem MAJOR/MINOR/PATCH neste ciclo (R1.2, N6).

---

## 7. Fora deste documento / deste ciclo

- `MELHORIAS.md` (ErrorBoundary genérico, UI “Descartar” da fila, UI Swift/Kotlin).
- Deploy automático, publicação, tag, push (P3 humano).
- Configurar `pipeline/gates.json` (usuário, fase quality-gates). Hoje: `configured=false`, checks `npm` genéricos na raiz — incompatíveis com FastAPI/pytest + Vite/vitest.
- `pipeline/DEPLOY.md` só após gate válido + prontidão na mesma versão.
- Live-update Capacitor, token GitHub no bundle, fila offline de anexos/IA/passkeys.
- Confirmar updater real Mac (`RELEASES_PAT` / `.dmg`) — ressalva 1.2.0.
- Números de latência/throughput das personas upstream **não** são requisitos (N5, aceite 24).
