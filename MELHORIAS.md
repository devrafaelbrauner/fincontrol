# MELHORIAS.md — FinControl

Backlog de melhorias futuras. Ideias registradas para não se perderem; nenhuma
delas é compromisso de entrega.

## Apps / distribuição

- [x] **Windows via Tauri** — 1.2.0: mesmo `frontend/src-tauri/` gera `.msi`
  (NSIS como fallback) pelo workflow `release.yml` em `windows-latest`.
- [x] **Auto-updater** — 1.2.0: `tauri-plugin-updater` assinado, publicando em
  `devrafaelbrauner/fincontrol-releases` com `latest.json`. No Capacitor, banner
  de versão + link do release (sem live-update).
- [ ] **UI nativa Swift/Kotlin** — se o WebView virar gargalo (scroll, teclado,
  câmera), avaliar telas nativas para login + dashboard, mantendo o resto no web.

## Segurança / acesso

- [x] **Lock biométrico por abertura** — 1.2.0: Face ID / Touch ID / Windows
  Hello na abertura a frio e no resume após 5 min, com fallback para senha+TOTP.
  Tokens no cofre do aparelho (Keychain / Credential Manager / Keystore).
- [x] **API URL em runtime (nativo)** — 1.2.0: `getApiBase()` resolve
  cofre > `VITE_API_BASE` > same-origin; campo "Servidor" em Configurações e
  tela de primeiro aviso quando não há default bakeado.

## Dados / offline

- [x] **Offline + sync** — 1.2.0: cache IndexedDB das leituras e fila de
  escritas financeiras com reconciliação por `versao` de linha (`If-Match`); 409
  vira conflito visível por item, sem last-write-wins silencioso.
- [ ] **UI para erro permanente da fila** (400/422): hoje o item fica em
  `permanente` e não retenta, mas a barra só lista conflitos. Um “Descartar”
  explícito evitaria escrita inválida presa no IndexedDB. 429 também cai em
  `permanente` (não retenta).
- [ ] **ErrorBoundary** mostra `erro.message` cru ao usuário — filtrar/genericizar.
