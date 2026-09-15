# Changelog

Todas as mudanças relevantes do FinControl. O formato segue
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a numeração segue
[SemVer](https://semver.org/lang/pt-BR/) — o que cada dígito significa aqui está
descrito em [`README.md`](README.md#versionamento).

## [Não lançado]

## [1.2.1] — 2026-09-15

Correções de segurança: senha, first-claimer, backup cifrado e CI.

### Segurança

- **Senha mínima 6 → 12** (`backend/app/auth.py`, espelho em `Login.tsx`).
- **`POST /api/auth/cadastro` bloqueado em produção (403)** — a conta nasce
  só via `python -m app.setup_user`; fim da janela first-claimer em VPS
  nova/restaurada. Aviso de boot e `deploy/README` atualizados.
- **Backup com criptografia age opcional** (`FINCONTROL_BACKUP_PUBKEY`): com
  ela, o offsite recebe só `.age`; sem ela, aviso de backup em claro.
  Permissões 700/600 no destino; `preflight.sh check` exige `FERNET_KEY`
  válida (não só não-vazia).
- **Rate limit em `POST /api/anexos`** (10/min por IP) e feed `.ics` com
  `Cache-Control: private, no-store`.
- **CI de segurança** (`security.yml`): pip-audit + semgrep + npm audit +
  gitleaks; `release.yml` serializado por ref, chave de assinatura Tauri
  escopada ao job de build.
- **Dependência**: nanoid ≥ 3.3.18 (GHSA-2v37-7h3g-55p8); `npm audit` limpo.

## [1.2.0] — 2026-09-12

Confiabilidade dos dados: edição concorrente reconciliável, offline real com
fila e conflito visível, cofre do aparelho para os tokens, servidor escolhido em
runtime e distribuição assinada de macOS/Windows.

### Adicionado

- **`If-Match` em todas as tabelas mutáveis** (migration `018`): `versao` em
  `lancamentos_variaveis`, `lancamentos_fixos`, `entradas`, `metas`,
  `metas_itens`, `metas_aportes`, `categorias`, `orcamentos` e `parcelamentos`.
  PATCH/DELETE (e o `PUT` de orçamento) passam a aceitar `If-Match`; sem o
  cabeçalho seguem como antes. `test_concorrencia.py` cobre cada tabela. É a base
  da reconciliação do offline: dois aparelhos no mesmo id dão 409, nunca
  last-write-wins silencioso.
- **Offline com cache e fila** (IndexedDB, uma implementação para web/PWA/
  Capacitor/Tauri): GETs guardam o último snapshot e, sem rede, a tela mostra o
  dado salvo com o horário; escritas financeiras viram fila (`method`, `path`,
  `body`, `If-Match`) e são repetidas em `online`/foreground. 401 renova uma vez;
  409 vira **conflito** que não derruba o resto; 5xx volta como `erro` retentável.
  Banner de pendentes/conflitos com escolha "Atualizar dados" × "Manter minha
  edição". A escrita offline também é aplicada ao snapshot em cache (update
  otimista) nos recursos de forma conhecida. IA, anexos, passkeys, push e
  importação continuam online-only.
- **Cofre do aparelho + lock biométrico**: no nativo o access e o refresh saem do
  `localStorage` para o Keychain (macOS/iOS), Credential Manager (Windows) ou
  Keystore (Android); migração única lê o `refresh_token` antigo, grava no cofre e
  apaga. Gate de biometria na abertura a frio e no resume após 5 min (Touch ID /
  Windows Hello / Face ID), com fallback para senha + TOTP.
- **Servidor em runtime (nativo)**: `getApiBase()` resolve cofre > `VITE_API_BASE`
  > same-origin; campo "Servidor" em Configurações (trocar encerra a sessão) e
  tela de primeiro aviso quando não há default bakeado.
- **Updater assinado (Tauri)** e workflow `release.yml`: `macos-latest` gera
  `.dmg`, `windows-latest` gera `.msi` (NSIS como fallback), assinatura com a
  chave privada só em GitHub Secrets e publicação no repo público
  `devrafaelbrauner/fincontrol-releases`, com `latest.json` montado por
  `scripts/latest-json.mjs`. Banner de versão no Capacitor.

### Alterado

- `scripts/checar-api-base.mjs`: `VITE_API_BASE` ausente deixa de ser erro de
  build — o app pede o servidor na primeira abertura.
- `isNativo()` extraído para `plataforma.ts` (Capacitor **ou** `__TAURI__`),
  reexportado por `api.ts`.

## [1.1.0] — 2026-09-11

Acesso multiplataforma sem Python local: o Mac vira cliente Tauri como o
iPhone/Android já eram, a navegação vira hub e o login ganha passkeys.

### Adicionado

- **App macOS em Tauri 2** (`frontend/src-tauri/`, `npm run macos`): janela
  nativa servindo o bundle `frontend/dist`, cliente `X-Client: native` contra a
  VPS via `VITE_API_BASE` (obrigatório, checado em build). O wrapper AppKit em
  `macos/` fica como fallback experimental/rollback.
- **Hub**: `App.tsx` sem sidebar/bottom-nav/sheet "Mais" — chrome mínimo (logo,
  competência, busca, tema, sair + FAB) e grade de 12 atalhos no Dashboard
  **acima** do resumo financeiro. Rotas atuais permanecem; internas voltam → `/`.
- **Passkeys (WebAuthn)**: registro autenticado + login sem senha
  (`/api/auth/webauthn/{register,login}/{begin,finish}`, migration `017`,
  `webauthn>=3.0`), com `sign_count` anti-clonagem, desafio one-shot de 5 min e
  `rpId`/`origin` do host de produção (`GET /api/auth/webauthn/status` para o
  botão do login, sem criar desafio). Login web mostra "Entrar com passkey"
  primeiro (senha+TOTP em "Outra forma"); Configurações lista as credenciais.
- **Association nativa** (placeholders documentados até haver domínio/Team ID):
  AASA + `assetlinks.json` no Caddy, Associated Domains no iOS (entitlements),
  `intent-filter` com `autoVerify` no Android, mesmo `rpId` no Tauri.
- `tzdata` como dependência (Windows não tem base tz própria) e `tzdata`/`webauthn`
  no `requirements.txt`; `test_webauthn.py` e `isNativo()` cobertos no
  vitest; `versao.sh` + `test_versao.py` passam a sincronizar o `Cargo.toml`.

### Alterado

- `isNativo()` (Capacitor **ou** `__TAURI__`) no throw de `VITE_API_BASE` e no
  refresh single-flight; CORS inclui `tauri://localhost`,
  `https://tauri.localhost` e `:1420` (dev).
- `macos/README.md` e root `README.md`: caminho diário Mac = Tauri.

### Corrigido

- Login por passkey agora grava a sessão (`aplicarSessao`); sem isso o finish
  autenticava no servidor e o cliente voltava para o login.
- Em produção, `FINCONTROL_WEBAUTHN_RP_ID`/`ORIGIN` são obrigatórios (não derivam
  do header Host).
- `pytest` no Windows: `ZoneInfo("America/Sao_Paulo")` sem `tzdata` + leitura
  de migration sem `encoding="utf-8"` (cp1252 quebrava acentos).
- `vitest` sem DOM: `isNativo()` não toca em `window` inexistente.

## [1.0.0] — 2026-08-30

Primeira versão numerada. O aplicativo já estava em produção e em uso diário
antes disso; o que muda hoje é que passa a existir um número que diz **qual**
código está no ar.

### Adicionado

- Versionamento semântico com fonte única em [`VERSION`](VERSION). O
  `package.json`, o `MARKETING_VERSION` do Xcode e o `FastAPI(version=...)`
  deixam de ser cópias soltas e passam a ser espelhos conferidos por
  `backend/tests/test_versao.py`.
- `./scripts/versao.sh` para subir a versão e sincronizar os espelhos numa
  operação só.
- `GET /api/versao`, autenticado, para saber que versão está de pé num ambiente.

### Corrigido

- As cópias da versão **já estavam divergentes**: `package.json` e a API diziam
  `0.1.0` enquanto o projeto Xcode dizia `1.0`. Todas passam a dizer `1.0.0`.

---

## Antes do versionamento

O que segue não são versões — são os marcos do desenvolvimento entre 25/07 e
30/08 de 2026, reconstruídos a partir dos 67 PRs mergeados. Nenhum deles chegou
a ser publicado sob um número, e por isso ficam fora da lista acima. Cada marco
aponta os PRs que o compõem, para quem quiser o detalhe no histórico do git.

### Aplicativos e distribuição

- **APK Android de release assinado**, apontado para a VPS, com keystore fixa e
  `versionCode` próprio (#58, #64, #66). Antes disso houve um APK de teste
  separado, com pacote e nome distintos para conviver no mesmo aparelho (#43,
  #46).
- **Apps iOS/iPadOS via Capacitor**, incluindo a autenticação cross-origin que o
  WebView exige — o refresh token passa a trafegar no corpo quando o cliente se
  identifica como nativo (#12, #23, #38).
- **Wrapper macOS em AppKit** que sobe o backend sozinho, com anexos em janela
  própria (#13, #16, #17).

### Deploy

- VPS com Caddy (HTTPS), systemd e frontend estático servido same-origin (#5,
  #10, #19).
- Recusa de subir com segredo padrão ou sem chave de criptografia, ordem do CSP
  e variáveis de ambiente do Caddy (#47).

### Funcionalidades

- **Compromissos**: cadastro, acompanhamento e plano de quitação (#36, #40); na
  versão 1.0.0 passam a exigir só o nome (#57).
- **Orçamentos** em dois níveis, com parcela futura (#32, #35).
- **Compras parceladas**, com exclusão da série inteira (#29).
- **Metas** e sua leitura no painel (#24, #25).
- **Análises e histórico**, com comparativo entre meses e tendência por
  categoria (#28).
- **Busca global**, com acento e filtros de data (#30, #34).
- **Lembretes** por push e feed `.ics` assinável por token (#26).
- **Importação de documentos** e extração assistida por IA via OpenRouter (#8,
  #14).
- **Assistente** cuja conversa vira memória e mora no servidor (#65).
- **Contas bancárias**, categorias padrão e cadastro da conta (#15, #20).

### Sincronização entre aparelhos

- Corrida do `/refresh` que deslogava todos os aparelhos: resolvida dos dois
  lados, com single-flight no cliente e janela de graça no servidor (#37, #42).
- Edição concorrente passa a usar `If-Match` por linha, no lugar do
  last-write-wins silencioso (#42).

### Visual

Três direções sucessivas, cada uma substituindo a anterior por inteiro: Liquid
Glass (#9), Premium Flat (#18) e **Mono editorial** (#48–#56), a vigente —
IBM Plex Sans com JetBrains Mono nos números, fontes auto-hospedadas porque a CSP
de produção recusaria uma externa. Depois vieram o ajuste para telas pequenas e
as convenções do Material 3 no Android (#59), o tratamento dos gráficos (#60–#62)
e o login (#22, #27, #45, #63).

Na versão 1.0.0, os glifos de texto que faziam papel de ícone viraram SVG — eles
caíam fora dos subsets da fonte e sumiam justamente nos aparelhos Android (#57).

[Não lançado]: https://github.com/devrafaelbrauner/fincontrol/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/devrafaelbrauner/fincontrol/releases/tag/v1.0.0
