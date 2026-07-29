# FinControl — app nativo macOS (experimental)

Wrapper mínimo em Swift/AppKit: uma janela `WKWebView` apontando para o backend
local (`http://127.0.0.1:8000`), que serve o `frontend/dist` buildado. Service
workers são desregistrados dentro do app (o backend é local; SW só causaria
interface defasada — a PWA no navegador continua usando SW normalmente).

**O app sobe o backend sozinho:** se `/api/health` não responder, ele inicia
`.venv/bin/uvicorn` do repositório e o encerra ao sair — não precisa deixar
Terminal aberto. Se já houver um backend do FinControl no ar (o
`fincontrol-backend.command`, por exemplo), o app apenas o usa e não mexe nele.
O repositório é procurado em `~/Projects/fincontrol`; para outro caminho, defina
`FINCONTROL_HOME`. Quando o backend não sobe (venv ausente, porta 8000 ocupada
por outro serviço) o app mostra uma tela explicando, em vez de janela em branco —
⌘R tenta de novo.

## Build

Requisitos: Xcode e [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
cd macos
xcodegen generate   # gera FinControl.xcodeproj a partir do project.yml
xcodebuild -project FinControl.xcodeproj -scheme FinControl -configuration Release -derivedDataPath build build
```

O app fica em `build/Build/Products/Release/FinControl.app`.

## Rodar

```bash
cd frontend && npm run build          # frontend que o backend vai servir
open macos/build/Build/Products/Release/FinControl.app   # sobe o backend sozinho
```

Quando o servidor da VPS estiver no ar, basta trocar `urlApp` em
`Sources/main.swift` para o domínio HTTPS e o wrapper vira cliente do servidor real.
