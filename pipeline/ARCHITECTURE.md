# Arquitetura

Pendente de discovery do produto (fase architecture ainda não aberta).
Abaixo só a estratégia Git registrada no bootstrap. Stack, API, dados, auth e UX
serão consolidados depois do SPEC — sem inventar greenfield.

## Git (GIT-BOOTSTRAP)

Registrado a partir do diagnóstico do agency-git-workflow-master e atualizado após GIT-COMMIT-PIPELINE-DOCS e GIT-ISOLATE-WIP-BRANCH.

### Estado atual

- Branch de trabalho: `revisao-pos-1.2.1` (sem upstream) — permanecer nela enquanto o WIP estiver uncommitted
- HEAD: `4c462d6a2dd2659c95ad08f3db8e94c3e52e1ad3` (`Registra o bootstrap do pipeline local e o diagnóstico de prontidão (blocked)`)
- Ref `main`: o mesmo `4c462d6` (1 ahead de `origin/main` nas refs locais)
- Tag `v1.2.1`: `d35a2cf9b9050c001a5e43e89567ada5ed87f306`
- Tracking: `main` → `origin/main`; fetch/pull não rodaram nesta sessão
- Remoto existente (não inventar outro): `origin` = `https://github.com/devrafaelbrauner/fincontrol.git`
- Working tree: sujo (WIP de produto); staged vazio
- Push em `main` dispara `.github/workflows/security.yml`
- Tags `v*` / `workflow_dispatch` disparam `.github/workflows/release.yml`
- Push **não** autorizado até o dono pedir; não criar tag

### Convenção observada (manter)

- Trunk-based em `main` (linha publicável, tags `vX.Y.Z`).
- Feature branches curtas em kebab-case descritivo, sem prefixos `feat/`/`fix/`.
- Commits em português, frase completa, sem Conventional Commits (`feat:`/`fix:`).
- Integração via GitHub PR + merge commit.
- Vincular commits aos IDs de `TASKS.md`.
- Um tema por commit; não misturar produto e fontes canônicas do pipeline.

### Isolamento do WIP (executado)

Branch `revisao-pos-1.2.1` criada a partir de `4c462d6` (pipeline bootstrap).
WIP pós-1.2.1 permanece **uncommitted** (32 modified + `backend/tests/test_anexos.py` e
`backend/tests/test_ia_versao.py`). Checkout de `main` arrasta esse working tree;
não voltar a `main` sem stash/commit do WIP. Commit/push do WIP só com confirmação
humana; não criar tag.

### Não versionar

- `pipeline/.task-lock`
- `.opencode/`
- `pipeline/evidence/`
- `.env`, `.venv/`, `node_modules/`, `backend/data/`, `backend/uploads/`, builds nativos

Proposta de acréscimo ao `.gitignore` (coordenador consolida; owner implementa, ainda não aplicado):

```
.opencode/
pipeline/.task-lock
pipeline/evidence/
```

### Operações proibidas automaticamente

Force-push, reset, clean, rebase, amend, exclusão de branches/tags.
Branches locais divergentes (`compromisso-so-o-nome`, `pr57-rebase` gone) não limpar sozinho.
