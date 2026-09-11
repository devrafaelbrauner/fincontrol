# MELHORIAS.md — FinControl

Backlog de melhorias futuras, fora do escopo da etapa atual (acesso multiplataforma 1.1.0).
Ideias registradas para não se perderem; nenhuma delas é compromisso de entrega.

## Apps / distribuição

- **Windows via Tauri** — hoje o Tauri cobre só o macOS. Reaproveitar o mesmo
  `frontend/src-tauri/` para gerar o `.msi`/`.exe` quando houver demanda.
- **Auto-updater** — hoje cada nativo exige rebuild + redistribuição manual.
  Avaliar `tauri-plugin-updater` (e equivalente Capacitor) com endpoint de
  releases assinado.
- **UI nativa Swift/Kotlin** — se o WebView virar gargalo (scroll, teclado,
  câmera), avaliar telas nativas para login + dashboard, mantendo o resto no web.

## Segurança / acesso

- **Lock biométrico por abertura** — exigir Face ID / Touch ID / biometria
  Android antes de expor o access token guardado, com fallback para senha+TOTP.
- **API URL em runtime (nativo)** — hoje `VITE_API_BASE` entra em build time e
  fica congelada no bundle. Tela de configuração no primeiro avvio permitiria
  apontar para outra VPS sem rebuild.

## Dados / offline

- **Offline + sync** — hoje sem rede o app não abre dado nenhum (só o shell PWA
  em cache). Fila local de lançamentos com reconciliação por `versao` de linha
  (`If-Match`, já usado nos PATCHs).
