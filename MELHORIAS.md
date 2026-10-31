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
- [x] **Fixar as actions do workflow por SHA** (17 tags mutáveis, achado do semgrep)
  e restringir `VITE_API_BASE` ao passo de build — feito no branch
  `seguranca-achados-scanner` (run `fincontrol-r12-scanner`): os 17 `uses:` com o
  SHA do commit e a tag em comentário; `VITE_API_BASE` só nos passos `tauri build`.
- [x] **`min-release-age` no `frontend/.npmrc`** — esperar alguns dias antes de
  resolver versões novas de pacotes. Feito na run `fincontrol-r12-scanner`:
  `min-release-age=7` (dias; 7 é o mínimo que o semgrep aceita; vale no npm ≥ 11.10).
  O npm 10 da CI (Node 22) ignora a chave sem aviso; lá só o lockfile segura.
- [ ] **`useHttpsScheme: true` no Windows (etapa 2)** — tiraria a origin
  `http://tauri.localhost` do CORS; muda a origin e perde o `localStorage`, então
  só vale antes de haver instalação real.
- [ ] **`@capacitor/core` e `@capacitor/cli` em 8.4.3** — o r3 subiu só
  `@capacitor/android`/`ios` (e o `capacitor-swift-pm`) para 8.4.3; alinhar o
  core/cli evita mistura de versões no `cap sync`.
- [ ] **3 alertas `deepmerge` (baixos, só dev)** — o `npm audit fix` só resolve com
  `--force` (sobe major de quem depende dele); revisar quando o pacote pai atualizar.
- [x] **Comentário obsoleto em `frontend/src-tauri/src/main.rs`** — dizia "sem
  sidecar, sem Python"; atualizado no branch `desktop-limpeza-sw` (run
  `fincontrol-r8-sw`) para o backend embutido.
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
  - `actions/setup-python` já fixado por SHA (run `fincontrol-r12-scanner`); falta o
    `pip install --require-hashes` no sidecar;
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
- [ ] **Achados não bloqueantes da etapa 4 e da limpeza do SW** (`fincontrol-r7-f3b/finish-report.md`,
  `security-report.md`; `fincontrol-r8-sw/review-code.md`, `evidence-report.md`):
  - cabeçalho fixo translúcido deixa o conteúdo rolado aparecer por baixo; hover de
    "Abrir pasta de dados" não muda a cor; no cadastro, com 1001 px de altura, o botão
    "Criar conta" fica abaixo da dobra (já existiam antes da etapa 4);
  - entre o backend cair e o Rust avisar `iniciando`, uma requisição ainda pode ir para a
    porta antiga com token e JWT (não medido; depende do aviso do `sidecar.rs`);
  - `_definirBackendParaTeste` é exportado no código de produção (`backendLocal.ts`);
  - single-instance: há uma brecha de microssegundos entre o mutex e a janela `-siw` da
    1ª instância em que uma 2ª passaria e apagaria a pasta `Service Worker` do app aberto;
  - um `msedgewebview2` ainda vivo de um fechamento anterior faz o `remove_dir_all` parar
    no 1º erro e deixar o `Database` do SW pela metade (que o Chromium se recupere é
    inferência, não medido);
  - sem console no release, um panic some sem rastro: um panic hook que grave no log;
  - as frases do desktop na `OfflineBar` não têm teste unitário (só print), e a pasta
    temporária dos testes `limpeza_sw_*` fica para trás se um assert falhar.
- [ ] **Achados não bloqueantes da run r10 (provas no Mac)** (`fincontrol-r10-mac/qa/*.md`):
  - [x] logs em `app_log_dir` (`~/Library/Logs/...`, `%LOCALAPPDATA%`) e não na pasta que
    "Abrir pasta" mostra (`backendLocal.ts:128`, `sidecar.rs:466`) — feito na run
    `fincontrol-r11-achados`: `<pasta de dados>/logs/`;
  - [x] motivo do prompt por plataforma: infinitivo só no macOS, imperativo em Windows
    Hello/iOS/Android — feito na run `fincontrol-r11-achados` (`isTauriMac`);
  - [x] R1 da AppSec: a marca de login por senha usa a hora do clique em "Pular por
    enquanto", então a tela de MFA esquecida > 5 min abria sem biometria — feito na run
    `fincontrol-r11-achados` (o gate de resume arma no mount, sem exigir sessão);
  - [x] testes: marca no futuro e valor lixo em `bloqueio.test.ts`; fiação de
    `Login.tsx`/`main.tsx` — feito na run `fincontrol-r11-achados` (`pages/Login.test.tsx`);
  - [x] `sessionStorage` sem try/catch em `bloqueio.ts` — feito na run
    `fincontrol-r11-achados` (gravar é melhor esforço; erro na leitura tranca se protegido);
  - login por passkey no nativo recarrega sem marca e cai no bloqueio — dono: produto
    (decisão);
  - conferir em aparelho que a `sessionStorage` morre com o app no Windows/iOS/Android
    — dono: QA em aparelho;
  - [x] 24 falsos positivos de SQL do semgrep (`nosemgrep` justificado ou regra sqlite3) —
    feito na run `fincontrol-r12-scanner` (26 marcados com `nosemgrep: <regra>` e motivo);
  - [x] gitleaks: allowlist da pubkey do updater (`tauri.conf.json:48`) — feito na run
    `fincontrol-r12-scanner` (`.gitleaks.toml` com exceção só para esse ID).
- [ ] **Achados não bloqueantes da run r11 (correção dos achados da r10)**
  (`fincontrol-r11-achados/qa/*.md`):
  - depois do bloqueio de resume na tela do MFA, o desbloqueio volta ao Login e o passo do
    MFA (QR e segredo) se perde: quem já tem sessão vê o formulário de login
    (`App.tsx:107`) — dono: produto;
  - os testes de boot e de resume do `main.tsx` moram em `pages/Login.test.tsx`;
    morariam melhor num `main.test.tsx` — dono: testes;
  - checagem explícita de marca `null` em `bloqueio.ts` (hoje vale por `Number(null) = 0`,
    que tranca) — dono: frontend;
  - logs órfãos no lugar antigo (`~/Library/Logs/...`, `%LOCALAPPDATA%\...\logs`): limpar
    numa versão futura — dono: casca Rust.
- [ ] **Achados antigos vistos na matriz visual da r11 (fora do diff)**
  (`fincontrol-r11-achados/qa/matriz-r11.md`, `acabamento-r11.md`):
  - balões de validação do navegador em inglês ("Fill out this field") no cadastro e no
    Prazo da meta; o Prazo vazio mostra um placeholder que parece preenchido (dono: frontend);
  - conta fixa criada hoje entra nos meses passados (mai–set) das Análises e aparece
    "atrasado" no próprio dia da criação; decidir se é retroativa (dono: backend/produto);
  - diálogo "Adicionar transação" cortado em 1280x800, sem indicação de rolagem, e o "×"
    fica sobre o botão "Transação" do header (dono: frontend);
  - botões da tela de bloqueio sem folga lateral (`.auth-entrar` sem `padding`) (dono: frontend);
  - em 900 px, "Compromissos" e "Configurações" encostam na borda do tile do hub (dono: frontend);
  - percentuais com ponto ("327.5%") numa UI que usa vírgula (dono: frontend);
  - "12 meses" e "24 meses" quebram em duas linhas no seletor de período das Análises
    (dono: frontend);
  - tela de abertura cerca de 64 px à esquerda do centro (dono: frontend);
  - espaçamento apertado em Configurações: sem respiro entre o campo e o rótulo seguinte
    nem antes de "Salvar" (dono: frontend);
  - texto da Visão geral vazia ("Você recebeu R$ 0,00… fecha o mês com economia") sem
    sentido com zero (dono: frontend/produto);
  - no login, o Tab passa por "Esqueci a senha" antes da senha (dono: frontend);
  - o FAB "+" cobre a ponta da barra "Sem categoria" (dono: frontend).

- [ ] **Sobras do Android local (S0/S1a, runs a2/a3)** — nenhuma tem fatia dona:
  - `apk-teste.sh` gera `fincontrol-teste-local.apk`, nome que agora confunde com o sabor
    `local`; falta um `apk:local` no `package.json`;
  - script da comparação APK `nuvem` × antes (S0.6/S1a.5 foram feitas à mão); refazer a cada
    alta de Chaquopy, Kotlin ou AGP;
  - `abiFilters "arm64-v8a"` também vale no `nuvem` (hoje sem `.so`, mas um plugin nativo
    futuro sairia só para arm64 sem aviso);
  - o manifest do sabor `local` ainda descreve o spike da S0;
  - sem harness de teste JVM para a casca Kotlin: a prova é só no aparelho;
  - `test_versao.py` não cobre o `VERSION` empacotado ao lado de `app/` (o fallback passa só
    porque `backend/VERSION` não existe);
  - `RuntimeBackend` avisa os ouvintes fora do lock: com `reiniciar` e `iniciar` ao mesmo
    tempo os eventos podem sair fora de ordem (≤ 300 ms antes do `exitProcess`);
  - no timeout, `android.py` fecha o socket de outra thread enquanto o uvicorn pode estar com
    ele (pior caso: traceback no stderr de um processo que já vai morrer);
  - segredos em `String` na JVM até o GC (mesma postura do desktop);
  - uvicorn ignora cliente que fecha a escrita antes da resposta (sondas tipo `nc`);
  - registrar o nível de segurança do KeyStore num celular real.

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
- [x] **`OfflineBar` engana no desktop** — durante o reinício do backend local a barra
  dizia "Sem conexão — mostrando dados salvos.". Feito no branch `desktop-limpeza-sw`
  (run `fincontrol-r8-sw`): no desktop diz "O FinControl está reiniciando — mostrando
  dados salvos…" e "… aguardando o FinControl voltar."; web e Capacitor iguais.
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
- [ ] **Achados não bloqueantes da run r12 (scanner)** (`fincontrol-r12-scanner/qa/code-review.md`,
  `security-appsec.md`):
  - Dependabot para GitHub Actions: sem atualizador, os SHAs fixados envelhecem (dono: devops);
  - `returntocorp/semgrep-action@v1` roda o semgrep 1.36.0; trocar pela CLI atual (dono: devops);
  - alinhar o gitleaks da CI (8.24.3, que não decodifica base64) com o local (8.30.1)
    (dono: devops);
  - actions em Node 20 deprecado (`actions/checkout@v4`, `gitleaks/gitleaks-action@v2`,
    forçadas a rodar em Node 24): subir de versão ao renovar os pins (dono: devops);
  - `VITE_API_BASE` poderia ser variável (`vars.`) em vez de secret: o valor é público no
    bundle (dono: devops);
  - o npm 12 bloqueia os scripts de install do esbuild e do fsevents (`allowScripts`):
    aprovar ou documentar (dono: frontend);
  - os PATCH de `categorias`, `contas_bancarias`, `contas_fixas` e `metas` montam as
    colunas com as chaves do `*Patch` e dependem do Pydantic descartar chave extra; um
    `extra="allow"` futuro viraria injeção no nome da coluna, e o `nosemgrep` a esconderia.
    Allowlist explícita como `COLUNAS_EDITAVEIS` ou teste com chave injetada (dono: backend).

## Dados / offline

- [x] **Offline + sync** — 1.2.0: cache IndexedDB das leituras e fila de
  escritas financeiras com reconciliação por `versao` de linha (`If-Match`); 409
  vira conflito visível por item, sem last-write-wins silencioso.
- [ ] **UI para erro permanente da fila** (400/422): hoje o item fica em
  `permanente` e não retenta, mas a barra só lista conflitos. Um “Descartar”
  explícito evitaria escrita inválida presa no IndexedDB. 429 também cai em
  `permanente` (não retenta).
- [ ] **ErrorBoundary** mostra `erro.message` cru ao usuário — filtrar/genericizar.
