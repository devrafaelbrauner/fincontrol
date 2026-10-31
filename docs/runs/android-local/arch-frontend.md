# Arquitetura frontend/Android
`f/`=frontend/src · `fa/`=frontend/android/app/src · `b/`=backend/app · [DOC]=docs (Chaquopy 17.2, Capacitor v8, Android); sem SDK · [INF]=inferência. Rotas: ArqBackend; telas: ux-matrix.md.

## Decisões
**D1 Modo.** `f/plataforma.ts`: `isAndroidLocal()` = android ∧ `Capacitor.isPluginAvailable("BackendLocal")`; `isBackendLocal()` = desktop ∨ Android local. Runtime, sem `vite --mode`: um `dist/` serve os 2 sabores e o iOS (`capacitor.config.ts:14`). Viram `isBackendLocal()`: `api.ts:73`, `main.tsx:185`, `servidor.ts:28,40`, `OfflineBar.tsx:42`, `Login.tsx:115`, `Config.tsx:55,366`, `Calendario.tsx:158`; `BannerVersao.tsx:18` desliga.
**D2 Build.** Sem modo Vite novo (`tauri.conf.json:9` fica). SW: `injectRegister:false` e `main.tsx` registra se `!isBackendLocal()` (web/iOS/nuvem como hoje); o local desregistra sobras (`main.tsx:103-105`): SW com bundle velho (`vite.config.ts:56-62`) quebra o par front×backend. `capacitor.config.ts` igual (`allowMixedContent` só teste, `:24`).
**D3 Sabores Gradle**: `nuvem` = APK de hoje, intocado; `local` (`applicationIdSuffix ".local"`) = Chaquopy + plugin; convivem até S10.
**D4 Transporte = socket 127.0.0.1 + token por processo**, como o desktop. Dados: `enviarLocal`/`buscar` (`api.ts:60-86`), multipart e blobs sem mudança. Controle: ponte `BackendLocal`; `backendLocal.ts` ganha adaptador de casca Tauri×Capacitor (como `nativo/cofre.ts:55-61`), núcleo (`observarBackend`, geração, single-flight) único. 401 `token_local` (`api.ts:75-85`) fica; no Android token e porta duram o processo [DOC]. Plano B: ponte em processo atrás de `enviarLocal` (FormData/blob em base64, ≤ 15 MB `b/routers/anexos.py:15`; IA longa: resposta assíncrona).
**D5 Fila offline** (`f/offline/*`) fica como buffer de "backend abrindo" (`main.tsx:40-46`). Vão ao motor de sync (Python): replicação, conflito de 2 versões, pendentes, último sync; o front lê `/api/sync/estado`. 409 local segue `ehConflito` (`api.ts:234`). Ids da API seguem INTEGER (gid em `sync_linha`): `ID_OTIMISTA` (`api.ts:238`) e 61 `id: number` (20 arquivos) ficam.
**D6 Import/export** sem multipart (`b/main.py:139-142`): a casca copia o escolhido (SAF) para `<data>/importacoes/` → `POST /api/dados/importar {arquivo, conferir}`; export → `{arquivo}` → casca compartilha. Anexo: `/anexos/{id}/abrir` devolve `{caminho}`; casca abre via FileProvider.
**D7 Casca** (Kotlin, `fa/local/java/com/rafaelbrauner/fincontrol/`):
- `FinControlApp.kt`: `onCreate` sobe o runtime num executor, antes do WebView (NF1); `Python.start` 1×/processo [DOC].
- `RuntimeBackend.kt` (singleton): token 64 hex novo; Python faz bind na porta 0; prova HMAC por socket cru (`sidecar.rs:555-590`) antes de `pronto`. Payload do Tauri (`sidecar.rs:42-50`): `TelaBackend` intacta.
- `CofreBackend.kt`: SECRET_KEY/Fernet no 1º uso, AES-GCM com chave AndroidKeyStore sem exigir autenticação (digital nova não invalida, K3); só Kotlin↔Python (`sidecar.rs:604-620`). `capacitor-secure-storage` só guarda a sessão (`f/sessao.ts`): o JS lê tudo nele.
- `BackendLocalPlugin.kt`: `estado`, `info` (só em `pronto`), evento `estado`, `reiniciar` (= relançar o processo; nunca reimportar `app.main`), `pastaDeDados`, `escolherImportacao`, `compartilhar`, `abrirAnexo`, `tipoDeRede`. `MainActivity` registra via `PluginsDoSabor` antes do `super.onCreate` [DOC].
- Processo morto leva WebView e Python: boot frio pela `TelaBackend`; volta quente já `pronto`. Bloqueio/biometria: reuso (`main.tsx:71,157`).
- `fa/local/`: manifest, `network_security_config.xml` (cleartext só `127.0.0.1`), `file_paths.xml` (só `uploads/`, `exportacoes/`). `app/build.gradle`: Chaquopy 17.2 (AGP 8.13 ok, `android/build.gradle:9`), Kotlin, `arm64-v8a`, Python 3.13 (idem no build [DOC]), fonte = cópia gerada de `backend/app` (o diretório todo vai ao APK [DOC]).
**D8 Sync no cliente** (`f/sync/`): `estadoSync.ts` (padrão `offline/estadoOffline.ts`) ← `GET /api/sync/estado`; `agendador.ts` → `POST /api/sync/agora {wifi}` no `pronto`, ao voltar, 3 s após escrita 2xx (evento `fincontrol:escrita`), no botão e a cada 20 s se visível e pareado (NF2/NF4). Sincronizando: estado a 1 s; fim com mudança → `limparCache()` + `fincontrol:atualizar` (`estado.tsx:41-42`). Superfícies (U3): `IndicadorSync` no topo (`App.tsx:117`), `OfflineBar` só erro/conflito, `/conflitos` (`App.tsx:161-175`), Config › Sincronização / Dados e backup, `PrimeiroUso` (local sem conta, `Login.tsx:120-126`) hospedando `Parear` e `AssistenteImport`. Sem pareamento, nada (A7.2).

## Fatias (front/casca; backend no ArqBackend; OD = Open Design 2.5)
- S0 `android/build.gradle`, `app/build.gradle`, `fa/local/{AndroidManifest, network_security_config, strings, FinControlApp}`, `scripts/apk-local.sh`, `apk-release.sh:120-122`, `apk-teste.sh:98-100` = 9 · cabe · OD não
- S1 front: `plataforma`+t, `backendLocal`+t, `nativo/cascaAndroid`, `api`, `main`, `vite.config`, `vite-env.d.ts`, `TelaBackend`+t (−"Abrir pasta", `:72-74`) = 11; casca: `MainActivity`, `PluginsDoSabor`×2, plugin, runtime, cofre, app = 7 · ~22 c/ backend: **S1a casca / S1b front** · OD não
- S2 `Login`+t, `Config`, `Calendario`, `OfflineBar`, `BannerVersao`, `servidor`, `api`, `cascaAndroid`, plugin, `file_paths` = 11 · cabe · OD não
- S4 `AssistenteImport`+t, `PrimeiroUso`+t, `Login`, `Config`, `backendLocal`, `cascaAndroid`, `app.css`, plugin, `src-tauri/{lib.rs, Cargo.toml, Cargo.lock}` (diálogo) = 13 · ~20: **S4a backend / S4b UI** · OD **sim**
- S7 `sync/{estadoSync, agendador}`+t, `Conflitos`+t, `IndicadorSync`, `OfflineBar`, `App`, `Config`, `main`, `api`, `app.css` = 12 · cabe · OD **sim**
- S9 `Parear`+t, `PrimeiroUso`, `Config`, `agendador`+t, `backendLocal`, `cascaAndroid`, `app.css`, plugin, manifest = 11 · cabe sem leitor de QR · OD **sim**
- S3 `Config` (texto IA) = 1; S5, S6, S8 = 0; S10 barra "somente leitura" no web + `api` = 2–3 · cabem · OD não
- S11 `sw.ts`, `vite.config`, `main`, `Config`, `Login`, `servidor`, `Calendario`, −`passkeys`/`TelaServidor`/`BannerVersao`, sabor nuvem, `frontend/ios/` · **S11a web / S11b iOS+nuvem** · OD só se Q2 pedir página

## Premissas
Q1=A, Q3/Q4 na rec.; `<data>` = `filesDir/fincontrol` (HOME do Chaquopy [DOC]); `Python.start` fora da main thread [INF]; SW hoje registra no APK [INF].

## Conflitos
- C1 A2.3: com NSC o `usesCleartextTraffic` é ignorado (API ≥ 24) e sai no target ≥ 38; o WebView segue a política (target ≥ 26) [DOC]. A garantia vira o NSC, só no sabor local (no `main` quebraria o APK de LAN, `fa/debug/AndroidManifest.xml:15`).
- C2 sprint.md não diz como o APK casca (em uso) e o local convivem → D3.
- C3 S1, S4, S11 passam de 20 com backend → dividir.
- C4 Go do S0 exige o fetch do WebView (V2), não só "responde em 127.0.0.1".
- C5 A5.2/NF2 sem dono do gatilho: só o front sabe se há tela visível → D8.

## Questões abertas
- QF1 App final no S10: manter `.local` (rec.) ou virar o id principal (migrar dados; fila VPS em quarentena)?
- QF2 Leitor de QR (O3): plugin + CAMERA (+3–4 arquivos) ou só digitar/colar (rec.)?
- QF3 Se o Chaquopy não isolar Python do nuvem (V1): congelar o APK casca na 1.2.1?
- QF4 V2 falhou: ponte (D4) ou `androidScheme:"http"` só no local?

## Verificação
- V1 S0 (HA1): `import app.main` + bind 0 + health com prova; NF1 frio/quente e NF3 gravados; APK nuvem sem `libpython`.
- V2 S0, gate: chrome://inspect no `.local`, `fetch("http://127.0.0.1:<p>/api/health")` sem `allowMixedContent` → 200 sem prompt (mixed content e Local Network Access, que o Chrome cobra p/ loopback [DOC]).
- V3 S1: `adb shell` sem token → 401, Host errado → 400; segredos fora do logcat e de `files/`.
- V4 S1: vitest com plugin stub (`isAndroidLocal`; `backendLocal` repete os casos Tauri); 0 SW no `.local`.
- V5 S7/S9: agendador com relógio falso (gatilhos, para oculto, 1 por vez); 10 min em 2º plano = 0 `/sync/agora`.
