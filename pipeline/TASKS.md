# Backlog

Ciclo atual: diagnóstico do produto existente (v1.2.1) antes de implementar.
Discovery ainda não começou. Nenhuma task de implementação está ativa.

## GIT-BOOTSTRAP — Git bootstrap / reconciliação

- **ID:** GIT-BOOTSTRAP
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-git-workflow-master
- **Dependências:** nenhuma
- **Arquivos exclusivos:** somente leitura (nenhuma edição)
- **Evidência:** branch `main`, HEAD `d35a2cf9b9050c001a5e43e89567ada5ed87f306`, tag `v1.2.1`, tracking `origin/main` (refs locais 0 ahead / 0 behind), staged vazio, working tree sujo (32 unstaged + 2 testes untracked de produto + placeholders de pipeline). Sem commit/push/reset/clean.

## READINESS-DIAG-BOOTSTRAP — Diagnóstico de prontidão

- **ID:** READINESS-DIAG-BOOTSTRAP
- **Fase:** bootstrap
- **Status:** done
- **Owner:** agency-project-readiness-reviewer
- **Dependências:** GIT-BOOTSTRAP
- **Arquivos exclusivos:** somente leitura
- **Evidência:** parecer `blocked` em `pipeline/reviews/readiness.json` e `pipeline/READINESS.md`. Fingerprint/gateAt/tasksHash = null. Não libera DevOps nem implementação.

## DISC-SPEC — Discovery do produto existente + WIP

- **ID:** DISC-SPEC
- **Fase:** discovery
- **Status:** pending (aguardando confirmação do dono para iniciar)
- **Owner:** agency-product-manager
- **Dependências:** GIT-BOOTSTRAP, READINESS-DIAG-BOOTSTRAP
- **Arquivos exclusivos:** proposta para `pipeline/SPEC.md` (coordenador consolida)
- **Critério:** SPEC com requisitos, não-objetivos e aceite numerado: baseline 1.2.1, WIP pós-1.2.1, P1 (BEGIN IMMEDIATE + reler saldo) e P2 (teste allowlist push). Não incluir MELHORIAS.md como compromisso.

## DISC-BACKLOG — Backlog priorizado

- **ID:** DISC-BACKLOG
- **Fase:** discovery
- **Status:** pending
- **Owner:** agency-sprint-prioritizer
- **Dependências:** DISC-SPEC
- **Arquivos exclusivos:** proposta para `pipeline/TASKS.md` (coordenador consolida)
- **Critério:** backlog pequeno com IDs, owners, arquivos exclusivos e dependências (Git/WIP → P1 → P2 → resto do WIP → CHANGELOG alinhado).

## Notas de preservação

- Não descartar o WIP unstaged em `main`.
- Não misturar commit de produto com arquivos `pipeline/`.
- Não versionar `pipeline/.task-lock` nem `.opencode/`.
- Commit e push só com confirmação humana por execução.
