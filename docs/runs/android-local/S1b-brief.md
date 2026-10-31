# Brief — S1b Modo local no front

Programa: `docs/runs/android-local/` (`sprint.md` v2, S1b). Run sugerida `fincontrol-a4-front-local`
(próximo número livre), perfil pela triagem 0t (esperado `feature`). Entradas: este brief; da
S1a (run a3): `reality.json`, `DECISIONS.md` (7–14) e os achados abertos; `arch-frontend.md`
D1/D2/D4, `ux-matrix.md` (Boot, Bloqueio Android), `produto.md` A1.1/NF1/K5.

## Demanda

O WebView do sabor `local` passa a usar o backend do aparelho, pelo mesmo caminho de boot do
desktop: `TelaBackend` → sessão → Bloqueio → App. Um `dist/` só serve web, iOS, `nuvem`, `local`
e desktop; o modo é decidido em tempo de execução. Fecha A1.1 (boot). Sem Open Design.

## Contrato da casca (entregue pela S1a; não muda aqui)

Plugin Capacitor `BackendLocal`, só no `local` (`isPluginAvailable("BackendLocal")`):
- `estado()` → `{estado: "iniciando" | "pronto" | "falhou", motivo?}` (mesmo payload do Tauri);
  evento `estado` com o mesmo objeto. O evento não é retido: registrar o listener **antes** de
  ler `estado()`.
- `info()` → `{base, token}` só em `pronto`; senão rejeita com `nao_pronto`.
- `reiniciar()` resolve e depois relança o processo (o WebView recarrega; token e porta novos,
  o antigo dá 401).
- `pastaDeDados()` → `{caminho}` (desembrulhar para string). No Android não há "Abrir pasta".
- CORS/preflight com o header do token a partir de `https://localhost` já funciona (S1a.5).

## Alvos (estimativa: 12 + docs)

- `frontend/capacitor.config.ts`: `android.loggingBehavior: "none"` — **primeiro item, bloqueante**:
  em build debuggável o Capacitor loga no logcat o resultado de toda chamada de plugin, incluindo
  o token do `info()` (S1a, DECISIONS 13). Conferir que o `SecureStorage` some do log também.
- `frontend/src/plataforma.ts`+teste: `isAndroidLocal()`, `isBackendLocal()` = desktop ∨ Android local.
- `frontend/src/backendLocal.ts`+teste: adaptador de casca Tauri × Capacitor (como
  `nativo/cofre.ts:55-61`); núcleo único (`observarBackend`, geração, single-flight); casos do
  Tauri repetidos com o plugin stub.
- `frontend/src/nativo/cascaAndroid.ts` (criar): ponte fina para o plugin.
- `frontend/src/api.ts`, `frontend/src/main.tsx`: `isDesktopLocal()` → `isBackendLocal()` onde o
  `arch-frontend` D1 manda (`api.ts:73,365`, `main.tsx:185`); SW: `main.tsx` registra só se
  `!isBackendLocal()` e desregistra sobras no local (D2).
- `frontend/vite.config.ts` (`injectRegister: false`), `frontend/src/vite-env.d.ts`.
- `frontend/src/components/TelaBackend.tsx`+teste: sem "Abrir pasta de dados" no Android.
- `frontend/scripts/apk-local.sh`: ainda descreve o spike da S0 e repete a conferência do
  `SHA256SUMS` que o Gradle já faz desde a S1a.

## Aceite

- **S1b.1 (V4)** vitest com o plugin stub: `isAndroidLocal`, adaptador repete os casos do Tauri,
  0 SW registrado no `.local`; web/iOS/`nuvem` registram como hoje.
- **S1b.2 (A1.1, NF1)** no emulador `fc-arm64-16k`: boot frio do `.local` passa por `TelaBackend`
  → cadastro (banco vazio) → painel, falando com `127.0.0.1`; quente sem tela de espera; `falhou`
  mostra o motivo e "Tentar de novo" (`reiniciar`). 3 medidas de frio/quente. Inclui o `falhou`
  do cofre (achado CR-7 da S1a, sem teste até aqui): texto cifrado corrompido em
  `shared_prefs/fincontrol_cofre.xml` (via `run-as`) → `falhou` com motivo, nunca segredo novo.
- **S1b.3 (K5, A2.2)** token e JWT só em memória no front; logcat de um boot debug sem token,
  JWT ou segredo; CSP do `index.html` vale no `.local`.
- **S1b.4** repetir o S0.4 num WebView atual (Local Network Access). Sem celular, registrar a
  versão usada; com celular arm64 (HA1), repetir lá e medir o NF1.
- **S1b.5 (A7.1/A7.2)** desktop, web e `nuvem` iguais: gates verdes, smoke do `nuvem`.

## O que NÃO muda

Casca Kotlin e backend (S1a), `frontend/src-tauri/**`, Login/Config/Calendario/OfflineBar/
BannerVersao/servidor (S2), migrations, `requirements*.txt`, `release.yml`, `applicationId` e
assinatura dos sabores.

## Fora desta fatia (dono)

- **S2**: rotas só-servidor ocultas/404 no front e no backend Android, `/abrir` → `{caminho}` +
  FileProvider + `file_paths.xml`, cópia antes de migrar + teste Android, `quick_check`;
  transferência entre aparelhos (Android 12+ copia o cofre e o banco, mas não a chave do
  KeyStore: o app fica em `falhou` para sempre) → `dataExtractionRules` ou saída pela
  exportação (S1a: AppSec A1, review CR-1).
- **S3 (antes de dado real)**: cadeia de suprimentos (ver o item S3 no `TAREFAS_PENDENTES.md`),
  incluindo sdist (`.tar.gz`/`.zip`) em `wheels/` passar pelo `--find-links` sem conferência
  (S1a: CR-2/A2).
- **HA1 celular**: NF1 e K3 (digital nova não invalida a chave) em aparelho real.

## Pré-requisitos humanos

Nenhum obrigatório (emulador basta). Celular arm64 por USB, se houver, para S1b.4/NF1.
