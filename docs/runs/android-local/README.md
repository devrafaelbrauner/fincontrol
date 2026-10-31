# Programa — Android local + sincronização

Planejado na run NEXUS `fincontrol-a0-android-sync` (2026-10-30, perfil `full`, base
`main` b8a564e). Nada foi implementado nessa run: ela entrega este programa. Cada fatia
abaixo é uma run própria, com triagem, snapshot e Reality.

## Objetivo

O APK Android passa a funcionar como o desktop: o mesmo `backend/` (FastAPI) roda dentro do
aparelho (Chaquopy), os dados ficam no aparelho e só a IA (OpenRouter, chave do usuário) e
a sincronização saem dele. Celular e PC Windows ficam com os mesmos dados, por sync cifrado
de ponta a ponta. No fim, a VPS deixa de ser a fonte da verdade (corte com aceite do dono).

## Documentos congelados (não editar; mudança = nova decisão no brief da fatia)

| Arquivo | Conteúdo |
|---|---|
| `produto.md` | requisitos R1–R7, aceites A*, NF1–NF7 (*proposed*), riscos K1–K6, HA1–HA6, Q1–Q4 |
| `sprint.md` | programa v2: fatias, dependências, marcos, caminho crítico |
| `arch-backend.md` | runtime, modelo e motor de sync, canal, migração; arquivos por fatia |
| `arch-frontend.md` | modo local no front, casca Kotlin, sabores Gradle, agendador do sync |
| `ux-matrix.md` | fluxos e matriz rota × estado das telas novas |
| `S0-brief.md` | brief da próxima fatia |

## Decisões tomadas

- Chaquopy 17.2 + Python 3.13 (páginas de 16 KB), release só arm64-v8a; `pydantic-core`
  2.50.2 compilado por cibuildwheel (workflow manual), wheels versionadas com `SHA256SUMS`.
- `requirements-android.txt` próprio: sem webauthn/pywebpush, uvicorn sem `[standard]`,
  `cryptography==42.0.8` com exceção documentada no pip-audit (O4).
- Transporte front↔backend = socket 127.0.0.1 + token por processo, como o desktop; plano B
  = ponte pelo plugin (QF4). Segredos (SECRET_KEY/Fernet) sob AndroidKeyStore.
- Sabores Gradle: `nuvem` = APK de hoje, intocado; `local` (`applicationIdSuffix ".local"`)
  convive com ele de S1a a S9 e fica como app final (QF1). Se o Chaquopy vazar para o
  `nuvem`, ele congela em 1.2.1 (QF3).
- Sync: gid + tombstones por triggers (domínio e API intactos), motor agnóstico de canal,
  conflito com 2 versões e escolha explícita, 0 last-write-wins. O gatilho é do cliente
  (`frontend/src/sync/agendador.ts`).
- Defaults (DECISIONS §7): Q3 chave de IA por aparelho; Q4 anexos > 5 MB só em Wi-Fi; import
  antes de criar a conta (login com a senha/TOTP da VPS); convite do hub no `.env` (O2); zip
  de exportação cifrado com a chave do grupo (O3); `fastapi>=0.121` (O5); código de
  pareamento digitado, sem leitor de QR (QF2).
- S2a (achado): `get_db` commita depois da resposta; corrigir cedo, vale para VPS e desktop.

## Pendente do humano

| Item | Bloqueia | Recomendação |
|---|---|---|
| HA1 celular Android (USB) ou JDK+SDK+emulador neste Mac | S0, S1a, S1b, S2, S9 | emulador feito (AVD `fc-arm64-16k`, usado na S0); celular arm64 ainda para NF1 e S9 |
| Q1 canal de sync | S8, S9 (e S10/S11) | A: VPS como hub, só cifrado |
| O1 o PC já tem dados próprios no modo local? | S9 (v1 substitui ao parear: destrutivo) | responder antes de S9 |
| Q2 desligar web/PWA/iOS/.ics/push após o corte | S11a, S11b | sim |
| Aceite das metas NF1–NF7 | viram gate | medir em S0/S2/S9 |
| HA2 PC Windows 11 · HA3 backup da VPS decifrado · HA4 SSH + subdomínio (se A) · HA5 backup da keystore · HA6 chave OpenRouter de teste | ver tabela | — |

## Fatias

Profile = esperado; a triagem (0t) decide. OD = Open Design antes do front.

| # | Fatia | Dep | Pré humano | Bloqueio | Perfil | OD | Status |
|---|---|---|---|---|---|---|---|
| 1 | S0 Spike Chaquopy (go/no-go) | — | HA1 | — | feature | não | **GO** (run a2, branch `a2-spike-android`) |
| 2 | S2a Commit antes da resposta | — | — | — | patch | não | PR #82 (run a1), espera merge |
| 3 | S1a Casca Android | S0 | HA1 | — | feature | não | próxima: a run escreve o `S1a-brief.md` (herdados da S0 no `TAREFAS_PENDENTES.md`) |
| 4 | S1b Modo local no front | S1a | HA1 | — | feature | não | a fazer |
| 5 | S2 Offline + ciclo de vida | S1b, S2a | HA1 | — | feature | não | a fazer |
| 6 | S3 IA no aparelho | S2 | HA6 | — | patch | não | a fazer |
| 7 | S4a Import/export backend | S2a | HA3 | — | patch | não | a fazer |
| 8 | S4b Import/export UI | S4a, S1b | HA5 | — | feature | sim | a fazer |
| 9 | S5 Modelo de sync | S0=go | — | — | patch | não | a fazer |
| 10 | S6 Motor de sync | S5 | — | — | feature | não | a fazer |
| 11 | S7 UI de sync + agendador | S6, S1b | — | — | feature | sim | a fazer |
| 12 | S8 Canal | S6 | HA4 (se A) | Q1 | feature | não | a fazer |
| 13 | S9 Pareamento | S2, S4b, S7, S8 | HA1, HA2, O1 | Q1 | feature | sim | a fazer |
| 14 | S10 Corte | S4b, S9 | HA2, HA3, HA5 | Q1 (via S9) | patch | não | a fazer |
| 15 | S11a Desligar web | S10 + aceite | HA4 | Q2 | feature | se Q2 pedir página | a fazer |
| 16 | S11b Desligar iOS + nuvem | S11a | — | Q2 | patch | não | a fazer |

Marcos: **M1** celular offline sozinho = S0, S2a, S1a–S4b · **M2** sync = S5–S9 em aparelhos
reais · **M3** saída da VPS = S10, S11a, S11b. Caminho crítico: HA1 → S0 → S5 → S6 → S7 →
Q1 → S8 → S9 → S10 → S11a. No-go do S0: S1a em diante param (ver `sprint.md`); S2a e S4a
seguem valendo.

## Como começar a próxima fatia

1. Este diretório precisa estar no `main` (PR só de docs da run a0).
2. Worktree novo a partir do `main`, com o nome da run:
   ```sh
   cd ~/projects/fincontrol-mac && git fetch origin
   git worktree add ~/projects/fincontrol-a<N> -b a<N>-<slug> origin/main
   P=~/projects/fincontrol-a<N>; R=$P/.nexus/runs/fincontrol-a<N>-<slug>
   mkdir -p $R && cp ~/projects/fincontrol-mac/.nexus/gates.json $P/.nexus/
   ```
   `N` = próximo número livre (a0 = planejamento); ex.: S0 → `fincontrol-a1-spike-android`.
3. Entradas da run (nada mais): o brief da fatia (`docs/runs/android-local/S<k>-brief.md`,
   copiado para `$R/brief.md`), o `reality.json`, o `DECISIONS.md` e os achados abertos da
   run anterior. Para o S0: `DECISIONS.md` da a0 (sem Reality, DECISIONS §10).
4. Conferir os pré-requisitos humanos do brief no ask de abertura; se um bloqueia a fatia
   inteira, rodar a próxima independente (ex.: S2a) e registrar o motivo.
5. Fase 0, com os `--target`/`--create` do brief:
   ```sh
   python3 ~/.omp/agent/skills/nexus-baseline/scripts/baseline.py scan --project $P --out $R
   S=~/.omp/agent/skills/nexus-snapshot/scripts/snapshot.py
   python3 $S triage  --project $P --out $R --target <arq> --create <arq>
   python3 $S capture --project $P --out $R --target <arq> --create <arq> \
     --test-cmd "bash -c 'cd backend && ../.venv/bin/python -m pytest tests/ -q && cd ../frontend && npx vitest run'" \
     --test-focused '<suíte focada do brief>'
   python3 ~/.omp/agent/skills/nexus-open-design/scripts/adapter.py prepare \
     --brief $R/brief.md --out $R/design-0 --profile <perfil> [--ui no] --reason '<triagem>'
   ```
6. Ao fechar: atualizar o status na tabela acima e a linha em `TAREFAS_PENDENTES.md`, e
   escrever `S<k+1>-brief.md` da fatia seguinte.
