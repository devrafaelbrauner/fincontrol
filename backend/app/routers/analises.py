"""Séries históricas para a página Análises.

Diferente do /dashboard/{competencia}, aqui NADA é materializado: cada mês entra
como o app o registrou (linhas de `lancamentos_fixos` só existem se o mês foi
aberto). Materializar numa consulta de N meses daria efeito colateral de escrita
a um GET — e faria meses que o app nunca acompanhou nascerem com gastos fixos
projetados que ninguém conferiu, distorcendo exatamente a série que a página
existe para mostrar.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..util import competencia_de, hoje, somar_meses, validar_competencia

router = APIRouter(prefix="/analises", tags=["analises"])

# Janela máxima: acima disso o gráfico vira ruído e a resposta cresce à toa.
MESES_MAX = 36


@router.get("/historico")
def historico(
    ate: str | None = None,
    meses: int = Query(12, ge=2, le=MESES_MAX),
    db: sqlite3.Connection = Depends(get_db),
):
    """Série mensal (entradas/fixas/variáveis/saldo) e gastos por categoria,
    dos `meses` que terminam em `ate` (padrão: o mês corrente)."""
    ate = ate or competencia_de(hoje())
    try:
        validar_competencia(ate)
    except ValueError as e:
        raise HTTPException(400, str(e))
    comps = [somar_meses(ate, n) for n in range(-(meses - 1), 1)]
    ini, fim = comps[0], comps[-1]

    def por_mes(sql: str) -> dict[str, int]:
        return {r["m"]: r["t"] for r in db.execute(sql, (ini, fim))}

    # BETWEEN funciona porque 'YYYY-MM' ordena lexicograficamente como cronologicamente.
    entradas = por_mes(
        "SELECT substr(data, 1, 7) m, SUM(valor_cents) t FROM entradas "
        "WHERE substr(data, 1, 7) BETWEEN ? AND ? GROUP BY m"
    )
    variaveis = por_mes(
        "SELECT substr(data, 1, 7) m, SUM(valor_cents) t FROM lancamentos_variaveis "
        "WHERE substr(data, 1, 7) BETWEEN ? AND ? GROUP BY m"
    )
    fixas = por_mes(
        "SELECT competencia m, SUM(valor_cents) t FROM lancamentos_fixos "
        "WHERE competencia BETWEEN ? AND ? GROUP BY m"
    )

    serie = []
    for c in comps:
        e, v, f = entradas.get(c, 0), variaveis.get(c, 0), fixas.get(c, 0)
        serie.append({
            "competencia": c,
            "entradas_cents": e,
            "fixas_cents": f,
            "variaveis_cents": v,
            "saldo_cents": e - f - v,
        })

    # Gastos por categoria por mês — variáveis (categoria própria) + fixos (a da
    # conta). O donut do mês na página usa só variáveis; aqui a pergunta é "para
    # onde o dinheiro foi ao longo do tempo", e um aluguel categorizado como
    # Moradia sumir da tendência responderia errado.
    por_categoria = [
        dict(r)
        for r in db.execute(
            """SELECT m, categoria_id, nome, cor, SUM(t) AS total_cents FROM (
                 SELECT substr(l.data, 1, 7) m, l.categoria_id, c.nome, c.cor,
                        SUM(l.valor_cents) t
                 FROM lancamentos_variaveis l
                 LEFT JOIN categorias c ON c.id = l.categoria_id
                 WHERE substr(l.data, 1, 7) BETWEEN ? AND ?
                 GROUP BY m, l.categoria_id
                 UNION ALL
                 SELECT l.competencia m, cf.categoria_id, c.nome, c.cor,
                        SUM(l.valor_cents) t
                 FROM lancamentos_fixos l
                 JOIN contas_fixas cf ON cf.id = l.conta_fixa_id
                 LEFT JOIN categorias c ON c.id = cf.categoria_id
                 WHERE l.competencia BETWEEN ? AND ?
                 GROUP BY m, cf.categoria_id
               )
               GROUP BY m, categoria_id
               ORDER BY m""",
            (ini, fim, ini, fim),
        )
    ]

    return {"serie": serie, "por_categoria": por_categoria}
