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
- [ ] **`@capacitor/core` e `@capacitor/cli` em 8.4.3** — o r3 subiu só
  `@capacitor/android`/`ios` (e o `capacitor-swift-pm`) para 8.4.3; alinhar o
  core/cli evita mistura de versões no `cap sync`.
- [ ] **3 alertas `deepmerge` (baixos, só dev)** — o `npm audit fix` só resolve com
  `--force` (sobe major de quem depende dele); revisar quando o pacote pai atualizar.
- [ ] **Comentário obsoleto em `frontend/src-tauri/src/main.rs`** — ainda diz "sem
  sidecar, sem Python"; desde a etapa 2 o app sobe o backend embutido.
- [ ] **`index.html` em LF nos checkouts Windows já existentes** — o `.gitattributes`
  vale para checkouts novos; uma cópia de trabalho antiga segue em CRLF até
  `git add --renormalize .` ou um novo checkout do arquivo.
- [ ] **Chave do updater fora do `pip install` da CI** — o `pip install` e o
  PyInstaller do sidecar rodam no job `build`, que tem `TAURI_SIGNING_PRIVATE_KEY`
  no `env`; mesma correção do item [SEG] do `TAREFAS_PENDENTES.md` (env só no passo
  do `tauri build`).
- [ ] **Sidecar menor** — o onedir tem ~53 MB (768 arquivos); excluir módulos não
  usados (ex.: `uvloop`/`watchfiles` do `uvicorn[standard]`) reduziria o instalador.
- [ ] **Achados não bloqueantes da revisão da etapa 2** (`fincontrol-r4-f2/review-code.md`):
  - `actions/setup-python` fixado por SHA e `pip install --require-hashes` no sidecar;
  - evento `backend-estado` pode chegar fora de ordem num reinício;
  - duas threads podem gerar os segredos ao mesmo tempo na 1ª execução;
  - erro ao podar backups antigos derruba o backend (sem teste);
  - o teste de porta fora do loopback depende da ordem dos testes;
  - o smoke da CI não confere o código de saída 0;
  - a descrição do `Cargo.toml` ainda diz que o app não sobe Python.
- [ ] **Achados não bloqueantes da revisão da etapa 3a** (`fincontrol-r5-f3a/review-code.md`):
  - o probe do `sidecar.rs` recusa resposta com corpo `chunked` (falha fechado; hoje o
    guard sempre manda `content-length`);
  - o `Popen` do `open`/`xdg-open` no `/abrir` não recebe `wait` e fica zumbi até o
    próximo `Popen` (macOS/Linux);
  - em `test_desktop_modo.py`, o cadastro 201 depende da ordem do módulo (com `-k` dá 409),
    e a ordem import → limpar env → `uvicorn.run` é conferida por `inspect.getsource`.
- [ ] **Achados não bloqueantes do reinício sem dois backends** (`fincontrol-r6-reinicio/review-code.md`):
  - um pânico entre `reservar` e guardar o filho deixaria a vaga presa (cada tentativa
    esperaria 5 s e falharia); um guard que libera no `Drop` fecha isso;
  - a porta é escolhida antes da espera de até 5 s; reservar antes de `porta_livre`
    diminui a chance de outro processo pegá-la;
  - os testes `processo_unico_*` não medem que a espera de fato aconteceu, e `parar` →
    `liberar` e a ordem dentro de `tentativa` só têm a prova de ponta a ponta.
  - se `try_wait`/`wait` derem erro no `parar`, a vaga é liberada sem confirmar que o
    processo saiu (já era assim; no Windows o Job Object cobre). AppSec S3 do r6.

## Segurança / acesso

- [x] **Lock biométrico por abertura** — 1.2.0: Face ID / Touch ID / Windows
  Hello na abertura a frio e no resume após 5 min, com fallback para senha+TOTP.
  Tokens no cofre do aparelho (Keychain / Credential Manager / Keystore).
- [x] **API URL em runtime (nativo)** — 1.2.0: `getApiBase()` resolve
  cofre > `VITE_API_BASE` > same-origin; campo "Servidor" em Configurações e
  tela de primeiro aviso quando não há default bakeado.
- [x] **Frontend desktop (etapa 4) sem `credentials: "include"`** — feito no branch
  `desktop-f3b-frontend` (run `fincontrol-r7-f3b`). O CORS do modo
  desktop é `allow_credentials=False`. Um `fetch` com `credentials: "include"` para
  `127.0.0.1` falha no preflight/resposta (o navegador exige
  `Access-Control-Allow-Credentials: true`). No desktop, usar `"omit"` e mandar
  `X-FinControl-Token` + `X-Refresh-Token`. O 401 `token_local` deve reler
  `backend_info`, e não chamar o `/auth/refresh` nem deslogar.
- [ ] **Mensagem do `checar-api-base` engana no desktop** — sem `VITE_API_BASE`, o
  script diz que "o app vai pedir o endereço do servidor na primeira abertura", mas o
  app desktop usa o backend embutido e nunca pede servidor (e ignora a variável se
  ela vier). Fica em `frontend/scripts/` e `package.json` (`macos`/`windows`), fora do
  raio da etapa 4: trocar o texto ou tirar o cheque desses dois scripts.
- [ ] **`OfflineBar` engana no desktop** — durante o reinício do backend local a barra
  diz "Sem conexão — mostrando dados salvos." e, no conflito, fala em "o que está no
  servidor". No desktop não há rede nem servidor: o texto devia falar do FinControl
  reiniciando e dos dados deste computador. `components/OfflineBar.tsx` ficou fora do
  raio da etapa 4 (run `fincontrol-r7-f3b`, DECISIONS 9).
- [ ] **Motivo cru do Rust na tela de falha do desktop** — o `motivo` do evento
  `falhou` vem do `sidecar.rs` com caminho `\\?\…` e termos como "sidecar". A
  `TelaBackend` mostra como chega; o texto devia sair legível do Rust (ou ser
  traduzido por código de erro).
- [ ] **Testes de render do modo desktop** — Config, Login e Calendário com
  `isTauri()` verdadeiro e falso (sem passkey/push/.ics/servidor só no desktop), e o
  boot do `main.tsx` (nada de API antes do `pronto`, reinício = barra offline, `falhou`
  = tela cheia). Hoje isso só está coberto pela evidência visual da etapa 4; cada um
  seria um arquivo de teste novo, acima do teto da run.
- [ ] **Rate limit do desktop é global** — todo pedido vem de `127.0.0.1`, então os
  tetos por IP (`slowapi`) valem para o app inteiro. Hoje isso é aceitável (um só
  usuário, token obrigatório); rever se algum teto atrapalhar o uso normal.
- [ ] **`/abrir` com ambiente explícito no macOS/Linux** — o `Popen` herda o
  `os.environ` já sem os segredos. Passar um `env` mínimo deixaria isso independente
  da ordem do `desktop.py`.
- [ ] **Achados não bloqueantes da AppSec da etapa 3a** (`fincontrol-r5-f3a/security-report.md`):
  - no Windows o socket do `uvicorn` não usa `SO_EXCLUSIVEADDRUSE`; um processo do mesmo
    usuário poderia sequestrar a porta com `SO_REUSEADDR`. Correção: socket já com bind
    e exclusivo, passado em `Server.run(sockets=[s])`;
  - a prova HMAC do health não amarra a porta: usar `"{porta}:{nonce}"` como mensagem;
  - o health sem nonce responde 200 sem token (decisão 3 do r5: só Host e Origin);
    reavaliar se o health passar a revelar algo além de "vivo".

## Dados / offline

- [x] **Offline + sync** — 1.2.0: cache IndexedDB das leituras e fila de
  escritas financeiras com reconciliação por `versao` de linha (`If-Match`); 409
  vira conflito visível por item, sem last-write-wins silencioso.
- [ ] **UI para erro permanente da fila** (400/422): hoje o item fica em
  `permanente` e não retenta, mas a barra só lista conflitos. Um “Descartar”
  explícito evitaria escrita inválida presa no IndexedDB. 429 também cai em
  `permanente` (não retenta).
- [ ] **ErrorBoundary** mostra `erro.message` cru ao usuário — filtrar/genericizar.
