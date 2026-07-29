# FinControl — app nativo macOS (experimental)

Wrapper mínimo em Swift/AppKit: uma janela `WKWebView` apontando para o backend
local (`http://127.0.0.1:8000`), que serve o `frontend/dist` buildado. Service
workers são desregistrados dentro do app (o backend é local; SW só causaria
interface defasada — a PWA no navegador continua usando SW normalmente).

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
cd backend && .venv/bin/uvicorn app.main:app --port 8000   # backend local
open macos/build/Build/Products/Release/FinControl.app
```

Quando o servidor da VPS estiver no ar, basta trocar `urlApp` em
`Sources/main.swift` para o domínio HTTPS e o wrapper vira cliente do servidor real.
