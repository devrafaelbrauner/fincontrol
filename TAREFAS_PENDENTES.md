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
  Trabalho **não commitado** — commit/tag `v1.1.0` à parte.
