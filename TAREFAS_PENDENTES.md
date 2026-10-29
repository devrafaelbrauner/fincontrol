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

- [ ] **P1 — POST `/contas-bancarias/{id}/saldos` ainda tem race** — `isolation_level = "IMMEDIATE"` não abre transação no SELECT (Python 3.14: `in_transaction=False` após a leitura). Dois POSTs com `delta_cents` no mesmo segundo leem o mesmo saldo e ambos inserem. Correção: `BEGIN IMMEDIATE` explícito e reler o último saldo *depois* do lock. Encaminhar: `/corrigir`.
- [ ] **P2 — Sem teste do allowlist de push** — `_endpoint_push_ok` recusa HTTP/SSRF, mas não há teste (http, IP interno, host fora da lista). Encaminhar: `/corrigir`.
- [ ] **P3 — Commit + push** — 32 arquivos modificados + 2 testes novos, `main` = `origin/main` em `d35a2cf`. Só versionar quando o dono pedir.

# TAREFAS — desktop local (Windows + macOS, sem servidor)

Plano do run NEXUS `fincontrol-r1-desktop` (2026-10-29), perfil `standard`.
O app desktop passa a levar o backend FastAPI dentro (sidecar PyInstaller), com
os dados em app-data. Web/PWA e mobile seguem na VPS. Sem assinatura de código.
Ordem: 1 → 2 → 3 → 4 → 5 → 6, uma etapa por run. Humanos: H1 antes da 1, H3
antes da 5, H6 na 6.

- [ ] **1 — CI de release verde** — `src-tauri/build.rs`, `[lib] fincontrol_lib`,
  `latest-json.mjs` no formato v2 (`.msi`/`-setup.exe` + `.sig`), Mac só arm64,
  `prerelease` em tag com `-`, `http://tauri.localhost` em `ORIGENS_NATIVAS`,
  `isTauri()` sem depender de `window.__TAURI__`. *Código pronto no branch
  `desktop-f1-release-ci` (run `fincontrol-r2-f1`; build local Windows gera
  `.msi`/`-setup.exe` + `.sig`). Falta: provar o `.dmg` num Mac (`npm run macos`)
  e decidir a publicação — tag `-rc` não serve (`versao.sh` e o MSI só aceitam
  X.Y.Z); publicar = `versao.sh patch` + tag `v1.2.2` + H1.*
- [ ] **[SEG] Chave de assinatura só nos passos de `tauri build`** — hoje
  `TAURI_SIGNING_PRIVATE_KEY` está no `env` do job `build` inteiro e chega aos
  scripts do `npm ci`, às actions de terceiros e aos `build.rs` das crates.
- [ ] **2 — Sidecar + casca Rust** — `backend/app/desktop.py`, spec PyInstaller
  onedir em `bundle.resources`, `lib.rs`/`sidecar.rs` (porta, token, cofre,
  Job Object, instância única), CSP `127.0.0.1`, `.gitattributes` (hash da CSP).
- [ ] **3 — Modo desktop no backend** — `desktop_guard.py` (Host/token/Origin),
  CORS sem credenciais, cadastro com banco vazio, passkey/push/.ics em 404,
  `POST /api/anexos/{id}/abrir`.
- [ ] **4 — Modo desktop no frontend** — `TelaBackend`, token no `api.ts`, sem
  servidor/passkey/push/.ics, PWA desligada no build desktop.
- [ ] **5 — Backup no app** — exportar zip, importar zip ou par da VPS, com
  `integrity_check`, cópia antes e teste de restauração local.
- [ ] **6 — Docs + smoke** — README/CHANGELOG, Windows 11 e Mac arm64 limpos,
  atualização vN→vN+1 sem perda.
- [ ] **H1** secret `RELEASES_PAT` (só `contents:write` em `fincontrol-releases`).
- [ ] **H3** baixar o backup atual da VPS (decifrar `.age` fora do app).
- [ ] **H5** confirmar as metas N1–N7 do plano.
- [ ] **H6** smoke em Windows 11 x64 e macOS arm64 limpos.
