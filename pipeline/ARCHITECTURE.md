# Arquitetura

Pendente de discovery do produto (fase architecture ainda não aberta).
Abaixo só a estratégia Git registrada no bootstrap. Stack, API, dados, auth e UX
serão consolidados depois do SPEC — sem inventar greenfield.

## Git (GIT-BOOTSTRAP)

Registrado a partir do diagnóstico do agency-git-workflow-master.
Nenhuma alteração Git foi executada nesta fase.

### Estado inspecionado

- Branch: `main`
- HEAD: `d35a2cf9b9050c001a5e43e89567ada5ed87f306`
- Mensagem: `Versão 1.2.1: correções de segurança (senha, first-claimer, backup cifrado, CI)`
- Tag em HEAD: `v1.2.1`
- Tracking: `main` → `origin/main` (refs locais 0 ahead / 0 behind; fetch/pull não rodaram nesta sessão)
- Remoto existente (não inventar outro): `origin` = `https://github.com/devrafaelbrauner/fincontrol.git`
- Working tree: sujo; staged vazio
- Push em `main` dispara `.github/workflows/security.yml`
- Tags `v*` / `workflow_dispatch` disparam `.github/workflows/release.yml`

### Convenção observada (manter)

- Trunk-based em `main` (linha publicável, tags `vX.Y.Z`).
- Feature branches curtas em kebab-case descritivo, sem prefixos `feat/`/`fix/`.
- Commits em português, frase completa, sem Conventional Commits (`feat:`/`fix:`).
- Integração via GitHub PR + merge commit.
- Vincular commits aos IDs de `TASKS.md`.
- Um tema por commit; não misturar produto e fontes canônicas do pipeline.

### Isolamento do WIP (proposta; não executar sem o dono)

Working tree em `main` contém WIP de code review pós-1.2.1 (32 arquivos unstaged +
`backend/tests/test_anexos.py` e `backend/tests/test_ia_versao.py`).
Não fazer checkout de outra branch agora sem plano: as mudanças seguiriam o working tree.
Quando o dono autorizar: criar branch curta a partir de `main` (ex. `revisao-pos-1.2.1`)
e deixar `main` = v1.2.1. Commit/push só com confirmação humana por execução; não criar tag.

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
