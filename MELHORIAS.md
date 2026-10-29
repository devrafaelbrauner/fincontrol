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
- [ ] **Mac Intel no desktop local** — fora da 1ª versão (só arm64). O GitHub
  ainda tem `macos-15-intel`, mas é a última imagem Intel (sai em ago/2027).
- [ ] **Assinatura de código** — Developer ID + notarização (Mac, US$ 99/ano) e
  Azure Trusted Signing (Windows) tiram os avisos do Gatekeeper/SmartScreen.
- [ ] **Lembretes como notificação nativa no desktop local** — sem servidor não
  há push; com o app aberto daria para usar `tauri-plugin-notification`.
- [ ] **Importar backup `.age` dentro do app** — hoje o plano é decifrar fora.
- [ ] **`--locked` no `tauri build` da CI** — garante que o `Cargo.lock`
  versionado é o que vai para o pacote (hoje um lock velho é regerado em silêncio).
- [ ] **Guardar o job `release` com `if: startsWith(github.ref, 'refs/tags/v')`** —
  um `workflow_dispatch` num branch publicaria um release com o nome do branch.
- [ ] **`latest-json.mjs`: falhar quando a plataforma repetir** — dois `.msi` (ex.:
  cache velho da CI) hoje fazem o último vencer sem aviso. A arquitetura do Mac sai
  do caminho `aarch64-apple-darwin/`, não do nome do arquivo.
- [ ] **CI conferir tag × versão** — uma `v1.2.2` sem atualizar `VERSION`/`Cargo.toml`
  deixaria o app em 1.2.1 e o updater ofereceria a mesma atualização em loop.
- [ ] **Fixar as actions do workflow por SHA** (16 tags mutáveis, achado do semgrep)
  e restringir `VITE_API_BASE` ao passo de build.
- [ ] **`min-release-age` no `frontend/.npmrc`** — esperar alguns dias antes de
  resolver versões novas de pacotes.
- [ ] **`useHttpsScheme: true` no Windows (etapa 2)** — tiraria a origin
  `http://tauri.localhost` do CORS; muda a origin e perde o `localStorage`, então
  só vale antes de haver instalação real.

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
