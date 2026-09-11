# FinControl — wrapper macOS em AppKit (experimental / obsoleto)

> **Caminho diário no Mac é o app Tauri** (`VITE_API_BASE=... npm run macos`, ver
> root `README.md`). Este wrapper fica só como **fallback / rollback**: se o
> Tauri quebrar, é ele que abre enquanto se conserta — não recebe features novas.

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

## Downloads

Exportar CSV e salvar anexos gravam em `~/Downloads` e revelam o arquivo no Finder
(o wrapper não tem lista de downloads própria). Nada é sobrescrito: um nome repetido
vira `arquivo (2).csv`.

## Configuração

Aberto pelo Finder, o app não enxerga variáveis de ambiente do shell — por isso os
ajustes ficam em `defaults` (a variável `FINCONTROL_<CHAVE>` também funciona e tem
precedência, mas só quando o app é lançado pelo terminal).

| Chave | Para quê | Exemplo |
|---|---|---|
| `porta` | Porta do backend local (padrão 8000) | `defaults write br.com.rafaelbrauner.fincontrol porta -int 8010` |
| `url` | Aponta o wrapper para outro servidor, ex. a VPS | `defaults write br.com.rafaelbrauner.fincontrol url https://seu-dominio` |
| `home` | Checkout fora de `~/Projects/fincontrol` | `defaults write br.com.rafaelbrauner.fincontrol home ~/dev/fincontrol` |

Para voltar ao padrão: `defaults delete br.com.rafaelbrauner.fincontrol <chave>`.

Trocar a **porta** resolve conflito com outro serviço que já use a 8000 — o app
sobe o próprio backend na porta configurada. Atenção: o app do iPhone (build
Capacitor com `VITE_API_BASE`) e o `fincontrol-backend.command` continuam
apontando para a porta que você definiu neles; se mudar aqui, ajuste lá também.

Com `url` definida o app vira só cliente e não gerencia backend nenhum — quem
aponta um servidor é dono dele.
