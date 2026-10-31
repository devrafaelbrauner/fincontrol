# Brief — S2 Offline + ciclo de vida

Programa: `docs/runs/android-local/` (`sprint.md` v2, S2). Run sugerida `fincontrol-a5-offline-ciclo`
(próximo número livre), perfil pela triagem 0t (esperado `feature`). Entradas: este brief; da
S1b (run a4): `reality.json`, `DECISIONS.md` e os achados abertos; `arch-frontend.md` D1 e
"Fatias" (S2), `arch-backend.md` D1/D6, `ux-matrix.md`, `produto.md` A1.1–A1.3, A3.1.

## Demanda

O `.local` funciona sozinho e sobrevive ao ciclo de vida do Android: em modo avião ele entra,
cria, edita, exclui e reabre com o dado lá; matar o processo durante uma escrita nunca deixa o
banco quebrado; o que só existe no servidor some da tela e dá 404. Fecha A1.1, A1.2 (sem sync),
A1.3 e A3.1. Sem Open Design.

## Alvos (estimativa: 18 com docs; confirmar na triagem e cortar se passar de 20)

- Front (só-servidor oculto no Android local, `arch-frontend` D1): `Login.tsx`+teste, `Config.tsx`,
  `Calendario.tsx`, `OfflineBar.tsx`, `BannerVersao.tsx` (desligado no local, `ux-matrix` C3),
  `servidor.ts`, `api.ts`, `nativo/cascaAndroid.ts`. O `Login.test.tsx` ainda simula o boot local
  com `isDesktopLocal`. Desde a S1b o `main.tsx` usa `isBackendLocal()`, então o teste passa mas
  já não exercita `iniciarLocal` (S1b DECISIONS 6). Mapear `isBackendLocal` no mock.
  Ainda no Login, vistos na evidência da S1b: no Android local o cadastro diz que "os dados
  ficam só no seu servidor", mas eles ficam no aparelho. E o axe aponta `color-contrast`
  grave no "ver" (4,25:1) e no link `#0068ff` sobre fundo escuro, no cadastro e no login. Isso
  já existia antes da S1b. No celular real (Samsung, API 37), o topo do painel fica embaixo
  da barra de status, com a hora em cima do logo: o `frontend/src` não usa
  `safe-area-inset-top` (S1b QA-1, também antigo).
  Faltam testes deixados pela S1b (CR-4/CR-10): registro do SW com `PROD` ligado; escolha da
  casca (`cascaAtual()`) e do `cascaAndroid.ts`; um caso que separe "2 leituras de `info` por
  evento" (o teste da S1b pega o boot preso, não a leitura dobrada). Hoje só o emulador prova o
  SW e a casca. `lerPastaDeDados` ainda não tem chamador no Android (CR-6): ligar em
  Config › Dados.
- `frontend/scripts/apk-local.sh`: ainda descreve o spike da S0 e repete a conferência do
  `SHA256SUMS` que o Gradle já faz. A limpeza saiu da S1b (DECISIONS 11 da a4, STOP de arquivo
  editado 3×). Manter `set -euo pipefail` e o `cd "$(dirname "$0")/.."`, como nos irmãos.
- Casca/anexo: `BackendLocalPlugin.kt` (`abrirAnexo`), `src/local/AndroidManifest.xml`
  (FileProvider), `src/local/res/xml/file_paths.xml` (só `uploads/` e `exportacoes/`);
  `backend/app/routers/anexos.py` (`/abrir` devolve `{caminho}` no Android em vez de abrir no
  servidor; hoje dá 500 lá).
- Backend do ciclo de vida: `backend/app/android.py` (cópia antes de migrar, hoje duplicada de
  `desktop.py` e sem teste Android, S0 CR3; `quick_check` no boot) + `backend/tests/test_android_boot.py`.
- Docs: `CHANGELOG.md`, `TAREFAS_PENDENTES.md`, tabela do programa, `S3-brief.md`.

## Aceite

- **S2.1 (A1.1)** no emulador, em modo avião: entrar, criar/editar/excluir lançamento,
  `am force-stop`, reabrir → dado lá. Rotas só-servidor (passkey, push, calendário `.ics`,
  servidor) ocultas no front e 404 no backend Android.
- **S2.2 (A1.2, sem sync)** captura de tráfego (`tcpdump` no emulador ou proxy): nada sai do
  aparelho além da IA, quando chamada.
- **S2.3 (A1.3)** migration pendente no boot: cópia em `backups/pre-migracao-*` antes, transação,
  `quick_check` ok; teste no host.
- **S2.4 (A3.1)** `am force-stop` no meio de escritas, 20×: `PRAGMA integrity_check` ok e cada
  escrita inteira ou ausente (base: S2a, commit antes da resposta).
- **S2.5** anexo PDF/imagem abre pelo FileProvider no app padrão; nada fora de `uploads/`.
- **S2.6 (A7.1/A7.2)** desktop, web e `nuvem` iguais; gates verdes.

## O que NÃO muda

`frontend/src-tauri/**`, cofre/runtime da casca (S1a), adaptador do `backendLocal.ts` (S1b),
migrations existentes, `requirements*.txt`, `release.yml`, `applicationId` e assinatura.

## Fora desta fatia (dono)

- **S3, antes de dado real (S4b)**, que vira a fatia de endurecimento:
  - CSP no Capacitor (`<meta>` no `index.html`). Nenhum app Capacitor tem CSP hoje (S1b
    DECISIONS 5). Afeta web, iOS, `nuvem` e desktop.
  - Transferência entre aparelhos: o Android 12+ copia o cofre e o banco, mas não a chave do
    KeyStore, e o app fica em `falhou`. Resolver com `dataExtractionRules` ou pela exportação
    (S1a A1/CR-1).
  - Cadeia de suprimentos do item S3 no `TAREFAS_PENDENTES.md`.
- **HA1 celular**: K3 (digital nova não invalida a chave).

## Pré-requisitos humanos

Nenhum obrigatório: o emulador `fc-arm64-16k` basta. O celular `RXGL10CHB5E` serve para repetir
o S2.1 num aparelho real, com as mesmas regras da S1b (DECISIONS 8–9 da a4: só os pacotes
`.local*`).
