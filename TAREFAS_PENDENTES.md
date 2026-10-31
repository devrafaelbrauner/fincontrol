# TAREFAS_PENDENTES.md — FinControl (etapa multiplataforma 1.1.0)

Backlog desta etapa, na ordem de execução do plano
`.local/share/kilo/plans/1789137497854-fincontrol-andamento-restante.md`.
Bloqueantes: **0 → 1 → 2 → 3**. Paralelo: **4**. Depois **5 → 6 → 7**. **8** espera 4 e 7. **9** por último.

- [x] **0 — Docs de versionamento** (`MELHORIAS.md` + este arquivo na raiz).
- [x] **1 — Fechar cliente nativo + CORS** (`isNativo()` reutilizável no throw
  de `VITE_API_BASE`, teste de `http://localhost:1420` só com `producao=False`,
  `tzdata` em vez do fallback UTC em `util.py`, origin WKWebView documentado em
  `ORIGENS_NATIVAS`, `pytest backend/tests/test_cors_nativo.py` verde, suite
  completa sem regressão do single-flight).
- [x] **2 — Tauri 2 (`frontend/src-tauri/`)** — scaffold, janela, ícone, bundle
  `frontend/dist`, `VITE_API_BASE` obrigatório via `scripts/checar-api-base.mjs`
  (`--dev` libera localhost), script `npm run macos` / `macos:dev`, cliente
  `X-Client: native` sem subir Python, CSP restrita ao host da API.
- [x] **3 — Aposentar AppKit (`macos/`)** — root `README.md` com caminho diário
  Mac = Tauri; `macos/README.md` como experimental/obsoleto (rollback only).
  **Não apagado**.
- [x] **4 — Hub (paralelo a 2–3)** — `App.tsx` sem sidebar/bottom-nav/sheet Mais;
  chrome mínimo (logo→`/`, competência, busca, tema, sair + FAB); internas com
  voltar → `/`; `Dashboard.tsx` com grade de atalhos **acima** do resumo;
  `app.css` ajustado; `ordem.ts` removido + seção da Config.
- [x] **5 — Passkeys backend** — `017_webauthn.sql`, `webauthn>=3.0`, rotas
  `POST /api/auth/webauthn/{register,login}/{begin,finish}`, register
  autenticado, `rpId`/`origin` do host de produção (nunca localhost em prod),
  TOTP + senha intactos, cadastro 409 se já há conta, `test_webauthn.py`
  (register, login, replay `sign_count`, origem inválida).
- [x] **6 — Login web passkey** — "Entrar com passkey" primeiro, senha+TOTP em
  "Outra forma"; convite a cadastrar passkey pós-login/cadastro; TOTP intacto;
  gestão em Configurações.
- [x] **7 — Nativos + association** — Associated Domains (entitlements, placeholder)
  + AASA no Caddy; `assetlinks.json` + `intent-filter autoVerify` (placeholder);
  Tauri com o mesmo `rpId`; refresh nativo documentado como `localStorage` até
  o plugin Keychain/Keystore existir (não fingido).
- [x] **8 — Versionar `1.1.0`** — `VERSION` + espelhos (`package.json`, Xcode,
  `Cargo.toml` via `versao.sh`), CHANGELOG, rebuild nativos com `VITE_API_BASE`
  de produção (na hora de distribuir).
- [x] **9 — `/seguranca` depois `/verificar`** — auth/WebAuthn/CORS conferidos
  (`pytest` 311 passed; vitest 58; tsc ok). Sem achado bloqueante de auth.
  Ressalvas (não fingidas): refresh nativo ainda em `localStorage` (Keychain
  pendente); AASA/`assetlinks` com placeholder até domínio + Team ID; origin
  real do WKWebView Tauri 2 no Mac a confirmar no primeiro `npm run macos`.
  Encerrado na tag `v1.1.0` (`55165732`).

# TAREFAS — etapa 1.2.0 (pós-1.1.0)

Plano `.local/share/kilo/plans/1789177254780-fincontrol-melhorias.md`. Fora:
UI Swift/Kotlin, token GitHub no bundle, live-update Capacitor, fila de
anexos/IA/passkeys.

- [x] **1 — If-Match no restante das tabelas mutáveis** — migration `018`
  (`lancamentos_variaveis`, `lancamentos_fixos`, `entradas`, `metas`,
  `metas_itens`, `metas_aportes`, `categorias`, `orcamentos`, `parcelamentos`),
  `TABELAS_VERSIONADAS`, `If-Match` nos PATCH/DELETE/PUT, `test_concorrencia.py`
  cobrindo cada tabela (16 testes).
- [x] **2 — Keychain + lock biométrico** — `sessao.ts` (cofre do aparelho;
  migração do `refresh_token` do `localStorage`), `cofre.ts`, `biometria.ts`,
  `Bloqueio.tsx` e gate de frio/resume 5 min; comandos Rust `cofre_*` com
  `keyring`; biometria via `tauri-plugin-biometry`/plugin Capacitor.
- [x] **3 — URL da API em runtime** — `getApiBase()` (cofre > `VITE_API_BASE` >
  same-origin), seção "Servidor" na Config e `TelaServidor.tsx` de primeiro
  aviso; checagem de build deixa de exigir a variável.
- [x] **4 — Offline** — `offline/{banco,cache,fila,estadoOffline,sincronizador}.ts`,
  integração em `api.ts` (cache de GET + fila), `OfflineBar.tsx` com conflito
  local × servidor; testes vitest da fila (404/409/5xx/401+refresh/ordem).
- [x] **5 — Windows + CI + updater** — `tauri-plugin-updater`, pubkey no
  `tauri.conf.json`, `release.yml` (macos `.dmg`, windows `.msi`/NSIS),
  `scripts/latest-json.mjs`, `BannerVersao.tsx` no Capacitor.
- [x] **6 — Versão 1.2.0** — `versao.sh minor`, `fincontrolVersionCode=6`,
  CHANGELOG e itens marcados aqui e em `MELHORIAS.md`.

## Ressalvas (não fingidas)

- **Update otimista do offline**: aplicado aos recursos de forma conhecida
  (`/variaveis`, `/entradas`, `/metas`, `/categorias`, `/orcamentos`,
  `/compromissos`); onde a forma é opaca (Resumo de contas bancárias, lançamentos
  de contas fixas) o otimista **não adivinha** — a fila continua e o banner
  mostra a pendência. Operações de grupo (`/variaveis/parcelado/{id}`) também
  ficam sem otimista.
- **Updater**: a pubkey foi gerada localmente e `TAURI_SIGNING_PRIVATE_KEY` já
  está nos Secrets; falta `RELEASES_PAT` (write no repo público) e
  `VITE_API_BASE`. Só um ciclo real Mac confirma.
- **Nativo (Tauri/Capacitor)**: `cargo`/Xcode não rodaram nesta sessão — os
  caminhos Rust/plugin precisam de `npm run macos` e `cap sync` num aparelho.
- AASA/`assetlinks` seguem placeholder (como em 1.1.0).

# TAREFAS — correções do code review (pós-1.2.1)

- [x] **Auth/MFA** — re-enrolment exige TOTP/senha; `setup_user` bumpa refresh;
  `refresh_token` no JSON só com Origin nativa.
- [x] **IA / If-Match / rate limit / anexos / push / saldos / passkey 404**.
- [x] **Frontend** — boot try/catch, ErrorBoundary, fila 404/422 vs 409, id
  otimista, race de competência, PDF no iOS, `path=*`, notificationclick,
  logout `?todos=1`, Info.plist, `allowBackup=false`.
- [x] **`npx cap sync`** — `@aparajita/capacitor-biometric-auth` e
  `capacitor-secure-storage` em `capacitor.plugins.json` (Android) e
  `Package.swift` (iOS).

# TAREFAS — verificação da entrega do code review (pós-1.2.1)

Trabalho **não commitado** (instrução da sessão). `/verificar` 2026-09-14.

- [x] **P1 — POST `/contas-bancarias/{id}/saldos` ainda tem race** — `isolation_level = "IMMEDIATE"` não abre transação no SELECT (Python 3.14: `in_transaction=False` após a leitura). Dois POSTs com `delta_cents` no mesmo segundo leem o mesmo saldo e ambos inserem. Correção: `BEGIN IMMEDIATE` explícito e reler o último saldo *depois* do lock. Encaminhar: `/corrigir`. *Feito: `BEGIN IMMEDIATE` em `backend/app/routers/contas_bancarias.py`, commit `14501b1`.*
- [x] **P2 — Sem teste do allowlist de push** — `_endpoint_push_ok` recusa HTTP/SSRF, mas não há teste (http, IP interno, host fora da lista). Encaminhar: `/corrigir`. *Feito: `backend/tests/test_push_allowlist.py`, commit `7462fc0`.*
- [x] **P3 — Commit + push** — 32 arquivos modificados + 2 testes novos, `main` = `origin/main` em `d35a2cf`. Só versionar quando o dono pedir. *Feito: `14501b1` e `7462fc0` estão na `main`.*

# TAREFAS — desktop local (Windows + macOS, sem servidor)

Plano do run NEXUS `fincontrol-r1-desktop` (2026-10-29), perfil `standard`.
O app desktop passa a levar o backend FastAPI dentro (sidecar PyInstaller), com
os dados em app-data. Web/PWA e mobile seguem na VPS. Sem assinatura de código.
Ordem: 1 → 2 → 3 → 4 → 5 → 6, uma etapa por run. Humanos: H1 antes da 1, H3
antes da 5, H6 na 6.

- [x] **1 — CI de release verde** — `src-tauri/build.rs`, `[lib] fincontrol_lib`,
  `latest-json.mjs` no formato v2 (`.msi`/`-setup.exe` + `.sig`), Mac só arm64,
  `prerelease` em tag com `-`, `http://tauri.localhost` em `ORIGENS_NATIVAS`,
  `isTauri()` sem depender de `window.__TAURI__`. *Mesclado no PR #69 (run
  `fincontrol-r2-f1`; build local Windows gera `.msi`/`-setup.exe` + `.sig`).
  `.dmg` arm64 gerado no Mac pelo comando da CI (macOS 27.2, run `fincontrol-r10-mac`;
  sem os artefatos do updater, cuja chave só existe nos Secrets) e aberto; ad-hoc, não
  notarizado.* A trava "sem tag `v*` entre as
  etapas 2 e 3a" caiu com o merge do PR #72. Publicar o cliente da VPS =
  `versao.sh patch` + tag `v1.2.2` + H1; uma tag hoje leva um instalador desktop
  cuja interface só usa o backend local depois da etapa 4.
- [x] **[SEG] Chave de assinatura só nos passos de `tauri build`** — hoje
  `TAURI_SIGNING_PRIVATE_KEY` está no `env` do job `build` inteiro e chega aos
  scripts do `npm ci`, às actions de terceiros e aos `build.rs` das crates.
  *Feito na run `fincontrol-r14-chave-build`: a chave e a senha saem do `env` do
  job e ficam só nos dois passos `tauri build` do `release.yml`.*
- [x] **2 — Sidecar + casca Rust** — `backend/app/desktop.py`, spec PyInstaller
  onedir em `bundle.resources`, `lib.rs`/`sidecar.rs` (porta, token, cofre,
  Job Object, instância única), CSP `127.0.0.1`, `.gitattributes` (hash da CSP).
  *Mesclado no PR #71 (run `fincontrol-r4-f2`).*
- [x] **[SEG] 3 — Modo desktop no backend** — *Mesclado no PR #72 (run
  `fincontrol-r5-f3a`).*
  - [x] `desktop_guard.py` (Host 400, Origin 403, token 401 com `hmac.compare_digest`);
  - [x] CORS só Tauri, sem credenciais e sem cookie; cadastro só com banco vazio
    (409) e atrás do token; passkey/push/calendário/.ics em 404;
  - [x] `POST /api/anexos/{id}/abrir` (só desktop, só `uploads/`, só tipos aceitos).

  A AppSec do r4 acrescenta (`security-report.md`):
  - [x] guarda também no `/api/health` (Host e Origin; o token fica de fora para a
    prova abaixo); sem token de 64 hex, Fernet e `SECRET_KEY` ≥ 32, não sobe;
  - [x] `/docs`, `/redoc` e OpenAPI desligados;
  - [x] `proxy_headers=False` no `uvicorn.run`, para o `X-Forwarded-For` não furar o
    rate limit;
  - [x] segredos fora do `os.environ` depois do import do app (`cripto.py` lê a
    chave Fernet uma vez);
  - [x] prontidão por nonce/HMAC: `/api/health` devolve `HMAC-SHA256(token, nonce)`
    e a casca (`sidecar.rs`) confere a prova sem mandar o token;
  - [x] smoke da CI e `test_desktop_boot` com token (200), sem token (401) e prova;
  - [x] app-data, logs e credenciais `backend_*` dos smokes das etapas 2 e 3a apagados no PC
    (`%APPDATA%`/`%LOCALAPPDATA%\com.rafaelbrauner.fincontrol`, `cmdkey /delete`).
- [x] **Antes de publicar o modo local** — ~~rodar cada migration numa transação
  (`db.py` grava comando a comando: fechar o app no meio de uma migração deixa o
  banco quebrado)~~ feita no branch `migracoes-em-transacao` (run
  `fincontrol-r9-migracoes`); ~~`windows_subsystem = "windows"` no `src-tauri/src/main.rs`
  (hoje o app abre uma janela de console junto no Windows)~~ mesclado no
  PR #75 (run `fincontrol-r8-sw`); ~~`backend_reiniciar`
  sem dois backends ao mesmo tempo num reinício rápido (`sidecar.rs`)~~ mesclado no
  PR #73 (run `fincontrol-r6-reinicio`); ~~**service worker de build anterior**: no
  Windows, um perfil do WebView2 que já tem o `sw.js` de um build antigo continua
  servindo a interface velha ("Servidor do FinControl"), e o `sw.js` autodestrutivo
  do build desktop não consegue substituí-lo (o `update()` falha no WebView2; medido
  no run `fincontrol-r7-f3b`, `evidencia/sw-antigo.log`)~~ mesclado no PR #75
  (run `fincontrol-r8-sw`): o `lib.rs` apaga a pasta
  `Service Worker` do perfil a cada abertura, antes da janela; conferido no Mac (run
  `fincontrol-r10-mac`): o WKWebView não guarda service worker no perfil
  (`~/Library/WebKit/com.rafaelbrauner.fincontrol`), a limpeza Windows-only não faz falta.
- [x] **4 — Modo desktop no frontend** — `TelaBackend`, token no `api.ts`, sem
  servidor/passkey/push/.ics, PWA desligada no build desktop. *Mesclado no PR #74
  (run `fincontrol-r7-f3b`), com smoke no app Windows; smoke no Mac feito (r10): backend
  embutido, guarda (401/400/403), cadastro só senha, Config/Calendário sem
  servidor/passkey/push/.ics, lançamento persiste, ciclo de vida sem órfão, instância
  única.*
- [x] **Laço do bloqueio biométrico** (achado no Mac, valia também para o boot nativo):
  login por senha seguido do bloqueio e "Entrar com senha" voltando ao login. Corrigido
  na run `fincontrol-r10-mac`.
- [ ] **5 — Backup no app** — exportar zip, importar zip ou par da VPS, com
  `integrity_check`, cópia antes e teste de restauração local.
- [ ] **6 — Docs + smoke** — README/CHANGELOG, Windows 11 e Mac arm64 limpos,
  atualização vN→vN+1 sem perda.
- [ ] **H1** secret `RELEASES_PAT` (só `contents:write` em `fincontrol-releases`).
- [ ] **H3** baixar o backup atual da VPS (decifrar `.age` fora do app).
- [ ] **H5** confirmar as metas N1–N7 do plano.
- [ ] **H6** smoke em Windows 11 x64 e macOS arm64 limpos. *Parte Mac feita numa máquina
  de dev (não limpa); falta Windows 11 e Mac limpos.*

# TAREFAS — Android local + sincronização

Plano do run NEXUS `fincontrol-a0-android-sync` (2026-10-30), perfil `full`; programa em
`docs/runs/android-local/` (`README.md`, `sprint.md`, briefs). O APK passa a levar o
backend (Chaquopy), dados no aparelho, IA pelo OpenRouter, sync cifrado celular ↔ PC e
corte da VPS. Uma fatia por run, ≤ 20 arquivos; o sabor `local` (`.local`) convive com o
APK de hoje até S10. Ordem: S0 → S2a → S1a → S1b → S2 → S3 → S4a → S4b → S5 → S6 → S7 →
S8 → S9 → S10 → S11a → S11b. Humanos: HA1 antes de S0, Q1 até o fim de S7, O1 antes de
S9, Q2 antes de S11a.

- [x] **S0 — Spike Chaquopy (go/no-go)** — **GO** (run `fincontrol-a2-spike-android`, PR #83).
  Emulador arm64 16 KB (API 36, WebView 133): `import app.main` com Python 3.13, `/api/health`
  com prova HMAC em `127.0.0.1`, `.so` alinhados a 16 KB, fetch do WebView do `.local` → 200
  sem mixed content, boot frio 0,76–1,04 s, APK arm64 33,1 MiB; APK `nuvem` igual ao de antes.
  Wheels do pydantic-core 2.50.2 pelo `wheels-android.yml` (run 41220674404).
- [x] **S2a — Commit antes da resposta** — `Depends(get_db, scope="function")`,
  `fastapi>=0.121`; vale para VPS e desktop (run a1, PR #82).
- [x] **[SEG] S1a — Casca Android** (run `fincontrol-a3-casca-android`, PR #84) — a casca
  Kotlin gera o token por processo e só marca `pronto` com a prova HMAC; SECRET_KEY/Fernet no
  AndroidKeyStore (AES-GCM, sem autenticação, fora de `files/`, iguais depois de force-stop);
  plugin `BackendLocal` só no `local`; guarda com `FINCONTROL_MODO=android` (401/400/403 pelo
  `adb shell`, porta só em 127.0.0.1); logcat da casca sem token/nonce/prova/segredo; Gradle
  copia só `.py`/`.sql`/`VERSION` e confere o `SHA256SUMS` das wheels; versão real no APK.
- [x] **S1b — Modo local no front** (run `fincontrol-a4-front-local`) — o `.local` abre pela
  `TelaBackend` e fala com o backend do aparelho (`isAndroidLocal()` em tempo de execução,
  adaptador Tauri×Capacitor com núcleo único); sem service worker no `.local`; token e JWT só
  em memória; `loggingBehavior: "none"` tira o token do logcat do build debug.
- [ ] **S2 — Offline + ciclo de vida** — modo avião, migration com cópia, 20× force-stop.
  Brief: `S2-brief.md`. Herdado (dona = S2): `/abrir` → `{caminho}` + FileProvider; cópia
  antes de migrar duplicada de `desktop.py` e sem teste Android (S0 CR3); o mock do
  `Login.test.tsx` não exercita mais o boot local (S1b DECISIONS 6); texto do cadastro no
  local ("dados só no seu servidor") e contraste do login (axe); testes do SW com `PROD` e da
  escolha da casca (S1b CR-4/CR-10); limpeza do `apk-local.sh` (S1b DECISIONS 11).
- [ ] **S3 — IA no aparelho + endurecimento antes de dado real (S4b)** — chave local cifrada,
  não sincroniza. Herdado (dona = S3):
  - CSP no Capacitor: `<meta>` no `index.html`; nenhum app Capacitor tem CSP hoje (S1b
    DECISIONS 5);
  - transferência entre aparelhos copia o cofre e o banco sem a chave do KeyStore →
    `dataExtractionRules` ou saída pela exportação (S1a A1/CR-1);
  - `--require-hashes` no `requirements-android.txt` (inclui `chaquopy-libffi`, ausente do
    PyPI); sdist em `wheels/` sem conferência (S1a CR-2); `cibuildwheel`/maturin fixados e
    attestation das wheels; tirar o gatilho `push` do `wheels-android.yml`; pip-audit do
    `requirements-android.txt` na CI; reauditar `cryptography==42.0.8` (7 exceções) antes de
    X.509/EC/TLS e da S6.
- [ ] **S4a — Import/export (backend)** — zip único, dry-run com relatório, aplicar
  atômico; cobre o backend da etapa 5 do desktop local.
- [ ] **S4b — Import/export (UI)** — PrimeiroUso, AssistenteImport, Config › Dados. Open
  Design antes.
- [ ] **S5 — Modelo de sync** — migration 019, gid + tombstones por triggers.
- [ ] **[SEG] S6 — Motor de sync** — lote cifrado E2E, conflito com 2 versões, anexos.
- [ ] **S7 — UI de sync + agendador** — IndicadorSync, `/conflitos`, gatilho no cliente.
  Open Design antes.
- [ ] **[SEG] S8 — Canal** — bloqueada por Q1 (rec. hub na VPS, só cifrado).
- [ ] **[SEG] S9 — Pareamento** — SAS nos 2 aparelhos, revogar, Wi-Fi para anexos grandes;
  bloqueada por Q1 e O1. Open Design antes.
- [ ] **S10 — Corte** — VPS só leitura, import final, 2º aparelho via sync, aceite do dono.
- [ ] **S11a — Desligar web/PWA** — bloqueada por Q2.
- [ ] **S11b — Desligar iOS + APK nuvem** — bloqueada por Q2.
- [ ] **HA1** celular Android por USB ou JDK+SDK+emulador neste Mac (S0, S1a, S1b, S2, S9).
  *Emulador feito no Mac (AVD `fc-arm64-16k`, 16 KB, API 36) e usado na S0; o celular arm64
  ainda falta para medir o NF1 em aparelho real e para a S9.*
- [ ] **HA2** PC Windows 11 com o desktop (S9, S10).
- [ ] **HA3** backup da VPS decifrado (`.age` fora do app; S4a, de novo no S10).
- [ ] **HA4** SSH na VPS + subdomínio do hub, se Q1 = A (S8, S11a).
- [ ] **HA5** backup da keystore do APK antes de dado real no celular (S4b, S10).
- [ ] **HA6** chave OpenRouter de teste (S3).
- [ ] **HQ1** escolher o canal de sync: A hub na VPS (rec.), B rede local, C drive.
- [ ] **HQ2** desligar web/PWA/iOS/.ics/push depois do corte (rec. sim).
- [ ] **HO1** o PC já tem dados próprios no modo local? (v1: parear substitui os dados de um
  lado — destrutivo).
- [ ] **HNF** aceitar ou ajustar as metas NF1–NF7 (`proposed` em `produto.md`).
