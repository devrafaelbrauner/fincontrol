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
