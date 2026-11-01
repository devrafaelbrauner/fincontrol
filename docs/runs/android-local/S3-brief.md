# Brief — S3a Endurecimento antes de dado real

Programa: `docs/runs/android-local/` (`sprint.md` v2, S3, dividida aqui em S3a e S3b porque os
herdados de S0–S2 passam de 20 arquivos junto com a IA). Run sugerida `fincontrol-a6-endurecimento`
(próximo número livre), perfil pela triagem 0t (esperado `feature`). Entradas: este brief; da S2
(run a5): `reality.json`, `DECISIONS.md` e os achados abertos; `arch-backend.md` D1, `produto.md`
K3/K5/O4.

## Demanda

Nada de dado real entra no celular (S4b) antes de o `.local` ter três coisas: CSP, saída segura
na troca de aparelho e cadeia de suprimentos conferida. Sem Open Design.

## Alvos (estimativa: 13 + docs)

- **CSP no Capacitor** (S1b DECISIONS 5): `<meta http-equiv="Content-Security-Policy">` no
  `frontend/index.html`, coerente com o header do Caddy (`deploy/Caddyfile:69`) e com o
  `tauri.conf.json:23`. `connect-src` precisa de `http://127.0.0.1:*`, da URL do servidor do
  usuário (nativo/web) e do OpenRouter; o hash do script de tema também. Afeta web, iOS,
  `nuvem`, `local` e desktop: provar nos cinco.
- **Troca de aparelho** (S1a A1/CR-1): `dataExtractionRules`
  (`src/local/AndroidManifest.xml` + `src/local/res/xml/data_extraction_rules.xml`) exclui o
  cofre e o banco da transferência entre aparelhos. A outra saída é a exportação (S4). Sem isso,
  o Android 12+ copia o cofre sem a chave do KeyStore e o app fica em `falhou` para sempre.
- **Mensagens de falha legíveis** (S2 DECISIONS 11): `RuntimeBackend.kt` traduz `BancoCorrompido`,
  `CopiaAntesDeMigrarFalhou` e a migration que falha (hoje `OperationalError`). Com
  `BancoCorrompido` ainda não há saída pela tela; as cópias em `backups/` só saem por adb (S2 CR-5).
- **`abrirAnexo` robusto** (S2 CR-1, primeiro a fazer, junto com a CSP): `BackendLocalPlugin.kt`
  não captura a `IOException` do `canonicalFile` nem a `SecurityException` do `startActivity`. O
  Capacitor relança a exceção como `RuntimeException` e derruba o app junto com o backend; o
  gatilho é JS mandando um caminho malformado. Corrigir com `try/catch` → `recusar(call,
  "caminho_invalido")`. Nas telas, `AnexoCampo.tsx:35` e `Importar.tsx:265` engolem o `sem_app`
  (aparelho sem leitor de PDF) sem avisar (S2 CR-2).
- **Cadeia de suprimentos** (S0/S1a):
  - `backend/requirements-android.txt` com `--require-hashes`, incluindo as wheels do índice do
    Chaquopy e o `chaquopy-libffi`, que não existe no PyPI e pede tratamento contra dependency
    confusion;
  - `frontend/android/app/build.gradle`: o `conferirWheelsLocal` também barra sdist
    (`.tar.gz`/`.zip`) em `wheels/` (S1a CR-2);
  - `.github/workflows/wheels-android.yml`: `cibuildwheel`/maturin fixados, attestation das
    wheels, sem o gatilho `push`;
  - `.github/workflows/security.yml`: pip-audit do `requirements-android.txt`;
  - `cryptography==42.0.8` reauditada (7 exceções), com a decisão registrada antes de X.509/EC/
    TLS e da S6.
- `frontend/scripts/apk-local.sh`: tirar o cabeçalho do spike e a conferência do `SHA256SUMS`
  repetida. Manter `set -euo pipefail` e o `cd "$(dirname "$0")/.."` (S1b DECISIONS 11).
- **Autofill** (S2 DECISIONS 7): decidir se o WebView do `local` desliga o autofill fora do login.
  Hoje o Chromium manda as assinaturas dos formulários para `content-autofill.googleapis.com`.
- Docs: `CHANGELOG.md`, `TAREFAS_PENDENTES.md`, tabela do programa, `S3b-brief.md`.

## Aceite

- **S3a.1** CSP ativa no `.local`, no `nuvem`, no iOS (build), na web e no desktop. O console não
  mostra violações num boot + login + uma tela de cada rota principal, e um script inline injetado
  é bloqueado.
- **S3a.2** troca de aparelho: `adb shell bmgr` ou a ferramenta de transferência do Android não
  leva o cofre nem o banco; o app novo abre em "sem dados" (não em `falhou`).
- **S3a.3** falhas do backend com mensagem legível na `TelaBackend` (3 casos).
- **S3a.4** wheel ou sdist fora do lock quebra o build; o pip-audit roda na CI; a attestation é
  verificável.
- **S3a.5 (A7.1)** gates verdes e smoke do `nuvem`.

## O que NÃO muda

Rotas e regras do backend, adaptador do front (S1b), migrations, `applicationId` e assinatura.

## Fora desta fatia (dono)

- **S3b (IA no aparelho + acabamento)**, pré-requisito HA6 (chave OpenRouter de teste):
  - chave de IA por aparelho, cifrada, sem sincronizar (A4.1, A4.2, Q3);
  - contraste do login (`--accent-vivid` nos links, `--content-2` no "ver") e
    `env(safe-area-inset-top)` no `.topo` do `app.css` (S2 DECISIONS 8–9);
  - botão do Bloqueio sem margem lateral e o salto da `TelaBackend` (S1b DECISIONS 12);
  - testes que faltam: SW com `PROD`, escolha da casca e "2 leituras por evento" (S1b
    CR-4/CR-10, S2 DECISIONS 12);
  - achados de a11y/UI da evidência da S2, todos antigos: o botão "+" do topo sem nome
    acessível (axe critical, todas as rotas); contraste 4,21:1 do dia de hoje no calendário;
    barra fixa do topo transparente ao rolar.
- **HA1 celular**: K3 (digital nova não invalida a chave) e o S2.5 no celular, pelo dono, à mão.
- **S4b**: `exportacoes/` já aparece no FileProvider, mas ninguém escreve nem compartilha lá ainda
  (S2 CR-4). O `file_paths.xml` do `local` tirou o `external-path`/`cache-path` que o Capacitor usa
  para `<input capture>`: um uso futuro de câmera quebra só no `local` (S2 CR-3).
- **S3b ou MELHORIAS** (a S3a decide): o `test_desktop_modo.py` tem uma asserção vazia
  (`app.routes` lista wrappers no FastAPI 0.162); o visualizador de PDF mostra o nome sha256 do
  anexo; a barra fixa do topo cobre o conteúdo ao rolar Config; o `Login.test` não mapeia
  `isAndroidLocal` (S2 CR-6).

## Pré-requisitos humanos

Nenhum para a S3a. A S3b precisa da HA6.
