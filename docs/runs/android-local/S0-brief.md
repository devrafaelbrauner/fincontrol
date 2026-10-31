# Brief — S0 Spike Chaquopy no aparelho (gate go/no-go)

Programa: `docs/runs/android-local/` (`sprint.md` v2). Run sugerida:
`fincontrol-a1-spike-android`, perfil `full` (a triagem 0t registra o tamanho: esperado
`feature`). Entradas: este brief, `DECISIONS.md` da run `fincontrol-a0-android-sync`,
`arch-backend.md` D1 e `arch-frontend.md` D3/D7.

## Demanda

Provar, num aparelho Android real (ou emulador arm64), que o mesmo `backend/` sobe dentro do
APK pelo Chaquopy e que o WebView do app consegue falar com ele em `http://127.0.0.1`. Nada
de produto muda: só o sabor `local` novo, ao lado do APK de hoje (sabor `nuvem`). É o gate
do programa: sem go, S1a em diante não começam.

## Alvos (estimativa: 4 alterados + 13 criados = 17)

`--target` (existentes):
- `backend/app/main.py` — import de `webauthn_routes` (`:23`) passa para dentro do
  `if not MODO_DESKTOP` (`:287`), para `import app.main` não exigir webauthn;
- `frontend/android/build.gradle` — plugin Chaquopy 17.2 (AGP 8.13 já está);
- `frontend/android/app/build.gradle` — sabores `nuvem` (sem mudança de comportamento) e
  `local` (`applicationIdSuffix ".local"`, Chaquopy, Python 3.13, `abiFilters "arm64-v8a"`
  no release, `pip { options("--find-links","wheels"); install("-r",".../backend/requirements-android.txt") }`,
  fonte Python = cópia gerada de `backend/app`);
- `frontend/scripts/apk-release.sh` (`:120-122`) e `frontend/scripts/apk-teste.sh`
  (`:98-100`) — tarefa/caminho do sabor `nuvem` (`assembleNuvemRelease`/`assembleNuvemDebug`).

`--create`:
- `backend/requirements-android.txt` (lock: `cryptography==42.0.8`, uvicorn sem
  `[standard]`, sem webauthn e pywebpush; exceção do pip-audit documentada por CVE, O4);
- `backend/app/android.py` — `iniciar(dados, segredos) -> (porta, token)`: bind
  127.0.0.1:0, `uvicorn.Server.run(sockets=[sock])` em thread (reusa `backend/app/desktop.py`);
- `backend/tests/test_android_boot.py` (nome sugerido) — `iniciar` no host: porta, token, prova;
- `.github/workflows/wheels-android.yml` — manual, cibuildwheel `--platform android`,
  `pydantic_core==2.50.2` com hash, `cp313-*`, `arm64_v8a x86_64`, teste = import no emulador;
- `frontend/android/app/wheels/` — 2 wheels do pydantic-core (nome exato vem do
  cibuildwheel) + `SHA256SUMS`;
- `frontend/android/app/src/local/AndroidManifest.xml`,
  `.../src/local/res/xml/network_security_config.xml` (cleartext só `127.0.0.1`),
  `.../src/local/res/values/strings.xml` (nome distinto na gaveta),
  `.../src/local/java/com/rafaelbrauner/fincontrol/FinControlApp.kt` (`Python.start` fora da
  main thread, sobe `android.iniciar`, loga porta e prova — só no spike);
- `frontend/scripts/apk-local.sh` — build/instalação do sabor `local`.

Passar de 20 arquivos = parar e refatiar (CONTRATO §5).

## Aceite

- **S0.1 (R1, K1)** `import app.main` no aparelho arm64-v8a com Python 3.13; `sys.platform`,
  SQLite (WAL) e JSON ok.
- **S0.2 (A2.1 prévia)** `android.iniciar` faz bind em 127.0.0.1:0 e `/api/health` devolve a
  prova HMAC correta para o token do processo.
- **S0.3 (K1, 16 KB)** todos os `.so` do APK `local` alinhados a 16 KB (`zipalign -c -P 16`
  e alinhamento ELF dos segmentos LOAD).
- **S0.4 (AF V2)** no WebView do `.local` (origem `https://localhost`), via chrome://inspect:
  `fetch("http://127.0.0.1:<p>/api/health")` → 200, sem `allowMixedContent` e sem prompt
  (mixed content e Local Network Access).
- **S0.5 (NF1, NF3)** boot frio e quente (3 medidas cada) e tamanho do APK arm64 gravados.
- **S0.6 (A7.2)** APK `nuvem`: mesmo `applicationId`, sem `libpython` (`unzip -l`), mesmo
  comportamento; `.local` instala ao lado sem substituir.
- **S0.7 (A7.1)** `.nexus/gates.json` verde (build, vitest, pytest, cargo) e
  `test_desktop_boot`/`test_webauthn` verdes (VPS segue com passkey).

## Go / no-go

- **Go** = S0.1–S0.7 todos verdes.
- **Desvio, não no-go:** S0.4 falha → plano B ponte pelo plugin (QF4) e S1a/S1b
  reestimadas; Chaquopy entra no `nuvem` → congelar o APK nuvem em 1.2.1 (QF3).
- **No-go:** pydantic-core não sai para Android em 2 runs, ou boot frio > 20 s (limite do
  desktop). S1a em diante param; o humano escolhe (a) ficar como hoje e reforçar a fila
  offline (`frontend/src/offline/fila.ts`) numa patch, ou (b) programa novo sem Pydantic v2
  no celular (fere R1). S2a e S4a seguem valendo.

## O que NÃO muda

`backend/requirements.txt` (VPS e desktop), `desktop_guard.py`, `desktop.py`, `auth.py`,
`frontend/src/**`, `capacitor.config.ts`, `frontend/src-tauri/**`, migrations,
`deploy/`, `release.yml`; `applicationId`, assinatura e comportamento do APK de hoje; rotas da
VPS (passkey continua registrada fora do modo desktop). Sem segredo real no APK do spike.

## Pré-requisitos humanos

- **HA1** (obrigatório): celular Android arm64 com depuração USB, ou autorização para
  instalar JDK 17 + Android SDK + emulador arm64 neste Mac.
- Rodar o workflow manual `wheels-android.yml` no GitHub (sem secrets).
- Não precisa: Q1, Q2, O1, HA2–HA6.

## Evidência esperada (`$R/evidencia/`)

Logcat do import e da prova; `zipalign`/ELF; console do chrome://inspect com o fetch;
tabela de boot e tamanho; `unzip -l` dos 2 APKs; URL da execução do workflow + `SHA256SUMS`;
`gates/report.json`.
