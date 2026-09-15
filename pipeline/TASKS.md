# Backlog

Ciclo atual: commit das docs de discovery, depois architecture (`ARCH-STACK`).
Uma task ativa por vez. Branch de trabalho: `revisao-pos-1.2.1`.
SPEC: `pipeline/SPEC.md` (R1–R6, aceite 1–24).

## GIT-BOOTSTRAP — Git bootstrap / reconciliação

- **ID:** GIT-BOOTSTRAP
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-git-workflow-master
- **Dependências:** nenhuma
- **Arquivos exclusivos:** somente leitura
- **Evidência:** HEAD inicial `d35a2cf9b9050c001a5e43e89567ada5ed87f306` (tag `v1.2.1`).

## READINESS-DIAG-BOOTSTRAP — Diagnóstico de prontidão

- **ID:** READINESS-DIAG-BOOTSTRAP
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-project-readiness-reviewer
- **Dependências:** GIT-BOOTSTRAP
- **Arquivos exclusivos:** somente leitura
- **Evidência:** parecer `blocked` em `pipeline/reviews/readiness.json` e `pipeline/READINESS.md`.

## GIT-COMMIT-PIPELINE-DOCS — Commit local das fontes do pipeline

- **ID:** GIT-COMMIT-PIPELINE-DOCS
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-git-workflow-master
- **Dependências:** READINESS-DIAG-BOOTSTRAP
- **Arquivos exclusivos:** os 7 caminhos `pipeline/` (sem `.task-lock`)
- **Evidência:** commit `4c462d6a2dd2659c95ad08f3db8e94c3e52e1ad3`. Sem push. Sem tag.

## GIT-ISOLATE-WIP-BRANCH — Isolar WIP na branch de trabalho

- **ID:** GIT-ISOLATE-WIP-BRANCH
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-git-workflow-master
- **Dependências:** GIT-COMMIT-PIPELINE-DOCS
- **Arquivos exclusivos:** nenhum de produto (só `git checkout -b`)
- **Evidência:** branch `revisao-pos-1.2.1` em HEAD `4c462d6`; WIP uncommitted. Sem push.

## DISC-SPEC — Discovery do produto existente + WIP

- **ID:** DISC-SPEC
- **Fase:** discovery
- **Status:** done
- **Owner:** agency-product-manager
- **Dependências:** GIT-BOOTSTRAP, READINESS-DIAG-BOOTSTRAP, GIT-COMMIT-PIPELINE-DOCS, GIT-ISOLATE-WIP-BRANCH
- **Arquivos exclusivos:** proposta de texto para `pipeline/SPEC.md` (coordenador consolidou)
- **Evidência:** `pipeline/SPEC.md` com R1–R6, não-objetivos N1–N12 e aceite 1–24. MELHORIAS.md fora.

## DISC-BACKLOG — Backlog priorizado

- **ID:** DISC-BACKLOG
- **Fase:** discovery
- **Status:** done
- **Owner:** agency-sprint-prioritizer
- **Dependências:** DISC-SPEC
- **Arquivos exclusivos:** proposta para `pipeline/TASKS.md` (coordenador consolidou)
- **Evidência:** tasks ARCH-STACK → IMPL-P1-SALDO → IMPL-P2-PUSH-TEST → IMPL-WIP-BACKEND → IMPL-WIP-FRONTEND → IMPL-CHANGELOG → QA-SUITE → QA-API → QA-CODE → GIT-PROPOSE-WIP.

## GIT-COMMIT-DISC-DOCS — Commit local das docs de discovery

- **ID:** GIT-COMMIT-DISC-DOCS
- **Fase:** discovery
- **Status:** in_progress
- **Owner:** agency-git-workflow-master
- **Dependências:** DISC-SPEC, DISC-BACKLOG
- **Arquivos exclusivos:** `pipeline/SPEC.md`, `pipeline/TASKS.md`, `pipeline/STATE.json`, `pipeline/ARCHITECTURE.md`
- **Critério:** commit atômico só desses caminhos na branch `revisao-pos-1.2.1`. Sem produto. Sem push. Sem tag.

## ARCH-STACK — Consolidar stack e contratos existentes

- **ID:** ARCH-STACK
- **Fase:** architecture
- **Status:** pending
- **Owner:** agency-backend-architect
- **Dependências:** DISC-BACKLOG, GIT-COMMIT-DISC-DOCS
- **Arquivos exclusivos:** proposta de texto para `pipeline/ARCHITECTURE.md` (coordenador consolida; não editar SPEC/TASKS/STATE)
- **Critérios de aceite:** documentar a stack vigente (FastAPI+SQLite WAL, React/Vite PWA, Capacitor/Tauri, VPS+Caddy, auth senha+TOTP+JWT+passkeys) **sem** cloud nova; contrato mensurável de `POST /api/contas-bancarias/{id}/saldos` (SQL `BEGIN IMMEDIATE` explícito **antes** de reler o último saldo; aceite 14–17); contrato de `POST /push/subscribe` / `_endpoint_push_ok` (aceite 18–19, R4.23); sem telas novas; VERSION permanece 1.2.1 (aceite 1–2)
- **Evidência esperada:** proposta com stack, auth, dados e os dois contratos; zero greenfield; zero hospedagem cloud

## IMPL-P1-SALDO — Race de saldo (P1)

- **ID:** IMPL-P1-SALDO
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-backend-architect
- **Dependências:** ARCH-STACK
- **Arquivos exclusivos:** `backend/app/routers/contas_bancarias.py`
- **Critérios de aceite:** 14, 15, 16, 17 (R3.20–21). String SQL `BEGIN IMMEDIATE` visível em `atualizar_saldo`; `_ultimo_saldo` **depois** do lock e **antes** do `INSERT`; `delta_cents` sobre o valor relido; `isolation_level = "IMMEDIATE"` sozinho **não** conta
- **Evidência esperada:** diff pontual (não reescrever o router); comentário alinhado ao código; `test_contas_bancarias.py` existente continua passando (arquivo não é exclusivo desta task)

## IMPL-P2-PUSH-TEST — Testes da allowlist de push (P2)

- **ID:** IMPL-P2-PUSH-TEST
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-test-automation-engineer
- **Dependências:** ARCH-STACK, IMPL-P1-SALDO
- **Arquivos exclusivos:** `backend/tests/test_push_allowlist.py` (arquivo novo)
- **Critérios de aceite:** 18, 19 (R4.22–23). Casos identificáveis: `http://…` recusa; IP interno recusa; host fora de `_HOSTS_PUSH`/`_SUFIXOS_PUSH` recusa. Allowlist do WIP **não** é enfraquecida; inscrição HTTPS legítima não é quebrada. `push.py` é só leitura nesta task
- **Evidência esperada:** pytest dos três recusados verde; se o código falhar, **não** “corrigir” `push.py` aqui — devolver correção ao owner do backend

## IMPL-WIP-BACKEND — Fechar WIP backend (verificação pontual)

- **ID:** IMPL-WIP-BACKEND
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-backend-architect
- **Dependências:** ARCH-STACK, IMPL-P1-SALDO, IMPL-P2-PUSH-TEST
- **Arquivos exclusivos:** `backend/app/auth.py`, `backend/app/setup_user.py`, `backend/app/webauthn_routes.py`, `backend/app/routers/anexos.py`, `backend/app/routers/ia.py`, `backend/app/routers/push.py`, `backend/tests/test_auth_sessoes.py`, `backend/tests/test_login_mfa.py`, `backend/tests/test_webauthn.py`, `backend/tests/test_anexos.py`, `backend/tests/test_ia_versao.py`
- **Critérios de aceite:** 3, 4, 5, 6, 7, 8, 9 (R2.3–10, R2.19 backend). Não reescrever; só conferir o WIP e corrigir furo pontual. Não tocar em `contas_bancarias.py`. Não descartar o WIP (aceite 21)
- **Evidência esperada:** testes nomeados do aceite 3–9 passando **ou** lista de furos com arquivo/esperado/observado para correction

## IMPL-WIP-FRONTEND — Fechar WIP frontend/nativo (verificação pontual)

- **ID:** IMPL-WIP-FRONTEND
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-frontend-developer
- **Dependências:** ARCH-STACK, IMPL-WIP-BACKEND
- **Arquivos exclusivos:** `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/sw.ts`, `frontend/src/components/AnexoCampo.tsx`, `frontend/src/offline/estadoOffline.ts`, `frontend/src/offline/fila.ts`, `frontend/src/offline/otimista.ts`, `frontend/src/offline/sincronizador.ts`, `frontend/src/offline/offline.test.ts`, `frontend/src/pages/Config.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Entradas.tsx`, `frontend/src/pages/Variaveis.tsx`, `frontend/ios/App/App/Info.plist`, `frontend/ios/App/CapApp-SPM/Package.swift`, `frontend/android/app/src/main/AndroidManifest.xml`, `frontend/android/app/capacitor.build.gradle`, `frontend/android/capacitor.settings.gradle`
- **Critérios de aceite:** 10, 11, 12, 13 (R2.11–18, R2.19 fila). Sem tela nova; sem UI de “Descartar” (N9); sem genericizar ErrorBoundary (N8). Não descartar o WIP
- **Evidência esperada:** vitest da fila 404/422; checagem pontual dos arquivos acima vs. aceite 10–13; correção só se faltar

## IMPL-CHANGELOG — Alinhar [Não lançado] ao código

- **ID:** IMPL-CHANGELOG
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-senior-developer
- **Dependências:** IMPL-P1-SALDO, IMPL-WIP-BACKEND, IMPL-WIP-FRONTEND
- **Arquivos exclusivos:** `CHANGELOG.md`
- **Critérios de aceite:** 20 (R5.24–25). Se `[Não lançado]` cita `BEGIN IMMEDIATE`, o aceite 14 já passou. Nenhum bullet contradiz o working tree. Sem bump de versão (R1.2, N6)
- **Evidência esperada:** grep `[Não lançado]` vs. código; linha de saldo verdadeira **depois** do P1

## QA-SUITE — Pytest + vitest (prova do ciclo)

- **ID:** QA-SUITE
- **Fase:** qa-review
- **Status:** pending
- **Owner:** agency-test-automation-engineer
- **Dependências:** IMPL-P1-SALDO, IMPL-P2-PUSH-TEST, IMPL-WIP-BACKEND, IMPL-WIP-FRONTEND, IMPL-CHANGELOG
- **Arquivos exclusivos:** nenhum de produto (execução; não reescrever implementação sob revisão)
- **Critérios de aceite:** 23, e prova dos 3–11 e 18. Comandos reais: `cd backend && .venv/bin/python -m pytest tests/ -q` e `cd frontend && npm test`. Não usar `opencode-pipeline gate` enquanto `gates.json` estiver `configured=false`
- **Evidência esperada:** saída real dos dois comandos; falha volta ao owner com reprodução (correction), não “pass” por limite de ciclo

## QA-API — Contratos, auth, validação, erros

- **ID:** QA-API
- **Fase:** qa-review
- **Status:** pending
- **Owner:** agency-api-tester
- **Dependências:** QA-SUITE
- **Arquivos exclusivos:** nenhum de produto (somente leitura; não corrige o código julgado)
- **Critérios de aceite:** 3–9, 14–19 (contratos R2/R3/R4). Auth/MFA/refresh, path traversal anexo, passkey 404, allowlist push, saldo com lock
- **Evidência esperada:** parecer com casos reais e resultado; sem gravar `pipeline/reviews/api-review.json` (isso é quality-gates, fora deste backlog)

## QA-CODE — Revisão independente

- **ID:** QA-CODE
- **Fase:** qa-review
- **Status:** pending
- **Owner:** agency-code-reviewer
- **Dependências:** QA-SUITE
- **Arquivos exclusivos:** nenhum de produto (somente leitura; não corrige o código julgado)
- **Critérios de aceite:** 1, 2, 14–17, 20, 21. Baseline 1.2.1 intacta; P1 não é só `isolation_level`; CHANGELOG alinhado; WIP não descartado
- **Evidência esperada:** parecer independente; sem gravar `pipeline/reviews/code-review.json` neste backlog (quality-gates depois, usuário configura `gates.json`)

## GIT-PROPOSE-WIP — Propor commit atômico do produto (sem executar)

- **ID:** GIT-PROPOSE-WIP
- **Fase:** implementation
- **Status:** pending
- **Owner:** agency-git-workflow-master
- **Dependências:** QA-API, QA-CODE
- **Arquivos exclusivos:** nenhum (somente leitura; não stage/commit/push)
- **Critérios de aceite:** 21, 22 (R6.26–27). Permanecer em `revisao-pos-1.2.1`; não misturar `pipeline/` com produto; não versionar `pipeline/.task-lock` nem `.opencode/`; **não** declarar commit/push feito
- **Evidência esperada:** plano de commit(s) atômico(s) com diff/arquivos/mensagem; execução só com confirmação humana por execução (P3). Sem tag, sem push até o dono pedir

## Notas de preservação

- Permanecer em `revisao-pos-1.2.1` enquanto o WIP estiver uncommitted. Checkout de `main` arrasta o working tree.
- Não misturar commit de produto com arquivos `pipeline/`.
- Não versionar `pipeline/.task-lock` nem `.opencode/`.
- Commit e push só com confirmação humana por execução.
- Push não autorizado neste ciclo até o dono pedir.
- QA-API e QA-CODE sequenciais (uma task ativa). Correction volta ao owner do arquivo; máximo 3 ciclos; não marcar done por limite.
