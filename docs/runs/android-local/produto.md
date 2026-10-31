# Produto — fincontrol-a0-android-sync
`b/`=backend/app, `m/N`=b/migrations/N_*.sql, `f/`=frontend, `T:`=TAREFAS_PENDENTES.md

## Problema e usuários
Dono único (`b/auth.py:319`), celular Android + PC Windows (brief.md:5-13). Hoje o APK é casca e a VPS, a fonte de verdade (`f/android/app/build.gradle:10-11`); o desktop já leva o backend (`b/desktop.py:1-18`). Pedido: celular como o desktop, IA na nuvem, mesmos dados.
Web/PWA fica na VPS até A6.3; depois exigiria dados em claro lá. Rec.: desligar web/PWA, `.ics`, push, passkey (`b/main.py:284-296`) e iOS (`README.md:10`): Q2.

## Requisitos
**R1 Backend no Android (Chaquopy)**, mesmo `backend/`, sem fork.
- A1.1 Modo avião: login, criar/editar/excluir, matar e reabrir: dado lá; rotas só-servidor 404.
- A1.2 Captura de tráfego: só a IA (`b/openrouter.py:17-18`) e o sync saem do aparelho.
- A1.3 Migration: cópia antes e transação (`b/desktop.py:184-190`).
- A1.4 Exportar/importar o zip da etapa 5 (T:179-180).

**R2 Guarda do desktop**
- A2.1 Socket só em 127.0.0.1, token 64 hex por início; 401/400/403 sem token/Host/Origin; prova HMAC (`b/desktop_guard.py:7-13`). Sem socket: nada alcançável de fora.
- A2.2 SECRET_KEY/Fernet no Keystore, gerados no 1º uso (cofre: `f/src-tauri/src/sidecar.rs:604-620`); nunca em log/arquivo.
- A2.3 `usesCleartextTraffic=false` (`f/android/app/src/main/AndroidManifest.xml:5`) mantido; exceção só 127.0.0.1.

**R3 Ciclo de vida**: A3.1 `am force-stop` em escritas, 20×: `integrity_check` ok, escrita inteira ou ausente.

**R4 IA do aparelho**: A4.1 Chave cifrada no banco local (`b/routers/ia.py:162`), chamada direta (`b/openrouter.py:86`); sem rede, erro legível e nada gravado. A4.2 Chave não sincroniza (Q3).

**R5 Sync celular ↔ PC**
- A5.1 Sincroniza 14 tabelas (12 de `b/util.py:142-147` + `anexos`, `saldos_conta`), `uploads/` por sha256 (`b/routers/anexos.py:73-78`), `modelo_preferido`, `perfil_*`; credenciais, chave IA, push, webauthn, caches e conversa da IA (v1) ficam locais.
- A5.2 Ao abrir/voltar ao app, ≤ 10 s após escrita (com rede) e por botão; mostra o último sync; sem 2º plano no v1.
- A5.3 50 escritas offline por lado, com criações: checksum por tabela igual, 0 colisão de id, 0 duplicata.
- A5.4 Exclusão propaga. Linha alterada nos 2 desde o último sync: conflito nos 2, 2 versões e escolha explícita (`f/src/offline/fila.ts:94-104`); 0 last-write-wins silencioso.
- A5.5 Canal guarda só cifrado E2E (chave só nos aparelhos): busca de descrição conhecida = 0.
- A5.6 Parear exige ação nos 2 aparelhos; revogável.

**R6 Migração da VPS**: A6.1 Import do backup (H3): `integrity_check` ok, cópia antes, linhas e soma de `valor_cents` por tabela = VPS, sha256 de 100% dos anexos. A6.2 2º aparelho via sync, mesmos totais. A6.3 VPS só desliga com aceite do dono.

**R7 Desktop intacto**: A7.1 Cada fatia (≤ 20 arquivos) mantém verdes suíte do backend e smoke desktop (T:170-175). A7.2 Sem pareamento, igual a hoje.

## Canal de sync (Q1, decide o humano)
- A, VPS como hub E2E: VPS só vê cifrado/metadados; fora do ar, só o sync para; assíncrono e à distância; serviço novo na VPS.
- B, LAN direta: nada sai; só com os 2 ligados na mesma rede; backend do PC sai do 127.0.0.1 (`b/desktop.py:35`).
- C, Drive/OneDrive cifrado: OAuth+SDK nos 2 sistemas; terceiro vê metadados; corrida com o cliente do drive.

Rec. **A** (~70%): único assíncrono sem expor o PC; reusa VPS/HTTPS. Zip (A1.4) = plano B.

## Não funcionais
- NF1 *proposed*: frio ou volta do 2º plano ≤ 6 s p95 (desktop: limite 20 s, `sidecar.rs:31`); quente ≤ 1 s.
- NF2 *proposed*: escrita em A visível em B ≤ 30 s p95 com B aberto; ≤ 10 s após B abrir.
- NF3 *proposed*: APK arm64-v8a ≤ 60 MB.
- NF4 *proposed*: 0 serviço em 1º plano/alarme; bateria ≤ 2%/dia.
- NF5 *proposed*: perda em conflito = 0; divergência na migração = 0.
- NF6 *proposed*: 30 dias offline sem perda; hub retém ≥ 90 dias.
- NF7 *proposed*: 1º sync de 20 mil linhas ≤ 2 min (Wi-Fi).

## Riscos
- K1 Wheels (Chaquopy/PyPI, 2026-10-30): `pydantic-core` sem wheel Android (0/162 releases); código é Pydantic v2 (`b/routers/categorias.py:62`): compilar Rust ou parar. cryptography 42.0.8/argon2/cffi: cp312–313 só arm64 e x86_64. Chaquopy 17 só aceita wheel: `uvicorn[standard]` (`backend/requirements.txt:2`) traz uvloop/httptools; webauthn 3.0.1 pede cryptography ≥ 49, importado sempre (`b/main.py:23`). Páginas 16 KB: Python 3.13 (CI: 3.12, `.github/workflows/release.yml:69`).
- K2 Android mata o processo: WAL e migration transacional ajudam (`b/db.py:21,47-54`); sync idempotente.
- K3 Chaves: Fernet nova perde a chave de IA (`sidecar.rs:604-606`); perder a keystore do APK = desinstalar = apagar o banco (sem backup, `AndroidManifest.xml:6`; `build.gradle:10-14` fica falso); sem os 2 aparelhos, sem chave E2E.
- K4 Conflito: `versao` é contador local (m/013:9-10), id INTEGER local (m/001:6), DELETE físico (`b/routers/variaveis.py:213`): ids globais + tombstones.
- K5 Origin `https://localhost` é a de todo app Capacitor (`b/main.py:228`): na porta, só o token protege.
- K6 Migração: backup `.age` decifrado fora do app e etapa 5 abertos (T:179-184).

**Não sabemos:** build do pydantic-core p/ Android; boot e APK reais; volume da VPS; aparelho do dono.

## Perfil `full`
Várias fatias, solução aberta (canal, Python no Android), segurança e migração sem perda (DECISIONS.md:3). Gate: spike S0 (`import app.main` no aparelho) primeiro; 2 runs falhando: humano.

## Pré-requisitos humanos
HA1 celular (modelo/Android, depuração USB) ou JDK+SDK+emulador aqui; HA2 PC Windows 11 com o desktop; HA3 backup da VPS decifrado (=H3); HA4 SSH na VPS + subdomínio (se A); HA5 backup da keystore do APK; HA6 chave OpenRouter de teste.

## Questões abertas
Q1 canal (rec. A); Q2 desligar web/PWA/iOS/.ics/push pós-migração (rec. sim); Q3 chave IA por aparelho (rec. sim); Q4 anexos > 5 MB só em Wi-Fi (rec. sim).
