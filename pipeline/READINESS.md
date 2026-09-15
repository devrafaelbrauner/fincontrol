# Prontidão — diagnóstico bootstrap

Parecer fiel de `agency-project-readiness-reviewer`.
JSON executável: `pipeline/reviews/readiness.json`.
Este diagnóstico **não** substitui gates e **não** autoriza publicação.

- **Status:** blocked
- **Em:** 2026-09-14
- **Fingerprint / gateAt / tasksHash:** null (gates ainda não existem)
- **HEAD relatado no bootstrap Git:** `d35a2cf9b9050c001a5e43e89567ada5ed87f306` (`main`, tag `v1.2.1`)

## Conclusão

O FinControl já está em produção na **v1.2.1**. O pipeline local ainda está em
**bootstrap**: sem SPEC de aceite, sem backlog canônico, sem architecture do
ciclo, sem gates configurados para FastAPI + Vite. Há WIP sujo em `main` e dois
buracos confirmados (P1 race de saldo, P2 teste de push). **Não implementar,
não DevOps, não done-local.**

## Checks

| Check | Status |
|---|---|
| scope | fail |
| tasks | fail |
| architecture | fail |
| quality | fail |
| operations | fail |
| evidence | fail |

## Blockers

1. Discovery não começou (SPEC/TASKS/ARCHITECTURE sem aceite deste ciclo).
2. Sem fingerprint, gates, reviews de código/API nem evidence.
3. Working tree sujo em `main`; WIP pós-1.2.1 deve ser preservado, não misturado.
4. P1: `POST /contas-bancarias/{id}/saldos` sem `BEGIN IMMEDIATE` explícito (CHANGELOG [Não lançado] afirma o contrário).
5. P2: `_endpoint_push_ok` sem teste; P3 commit/push só com o dono.
6. Não está em quality-gates nem em prontidão de implantação.

## Próximos passos (não executados neste diagnóstico)

1. Coordenador registra o parecer (este arquivo) e espera confirmação para discovery.
2. Isolar WIP em branch só se o dono autorizar; nunca reset/clean; nunca tag.
3. `agency-product-manager`: SPEC do produto existente + WIP + P1/P2; fora MELHORIAS.md.
4. `agency-sprint-prioritizer`: backlog pequeno com dependências.
5. Architecture depois do SPEC (VPS/Caddy existente, não cloud por padrão).
6. Usuário revisa `gates.json` só depois da architecture.
7. Não chamar DevOps neste ciclo até gate válido e prontidão favorável na mesma versão.

## Git

Commit e push **não** foram feitos. Sempre perguntar antes de cada execução.
Push em `main` dispara `security.yml`. Tag `v*` dispara `release.yml`.
