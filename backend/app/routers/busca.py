"""Busca global: texto, período e/ou faixa de valor sobre gastos variáveis,
entradas e contas fixas — de qualquer tela, numa chamada só."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..util import vencimento

router = APIRouter(prefix="/busca", tags=["busca"])

# Teto de linhas devolvidas (após juntar as três fontes). A UI mostra os mais
# recentes; quem precisa de tudo refina o filtro.
LIMITE = 50


def _like(q: str) -> str:
    """Padrão LIKE com curingas do usuário neutralizados (busca literal)."""
    escapado = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escapado}%"


@router.get("")
def buscar(
    q: str | None = None,
    de: str | None = None,
    ate: str | None = None,
    valor_min: int | None = Query(None, ge=0),
    valor_max: int | None = Query(None, ge=0),
    db: sqlite3.Connection = Depends(get_db),
):
    q = (q or "").strip() or None
    if not any((q, de, ate, valor_min is not None, valor_max is not None)):
        raise HTTPException(400, "Informe ao menos um critério: texto, período ou valor")

    def clausulas(col_texto: str, col_data: str, col_valor: str) -> tuple[str, list]:
        where, params = ["1=1"], []
        if q:
            where.append(f"{col_texto} LIKE ? ESCAPE '\\'")
            params.append(_like(q))
        if de:
            where.append(f"{col_data} >= ?")
            params.append(de)
        if ate:
            where.append(f"{col_data} <= ?")
            params.append(ate)
        if valor_min is not None:
            where.append(f"{col_valor} >= ?")
            params.append(valor_min)
        if valor_max is not None:
            where.append(f"{col_valor} <= ?")
            params.append(valor_max)
        return " AND ".join(where), params

    itens = []

    w, p = clausulas("l.descricao", "l.data", "l.valor_cents")
    for r in db.execute(
        f"""SELECT l.id, l.descricao, l.valor_cents, l.data, l.categoria_id, l.forma_pagamento, c.nome AS categoria
            FROM lancamentos_variaveis l LEFT JOIN categorias c ON c.id = l.categoria_id
            WHERE {w} ORDER BY l.data DESC LIMIT ?""",
        (*p, LIMITE + 1),
    ):
        itens.append({"tipo": "variavel", **dict(r)})

    w, p = clausulas("e.descricao", "e.data", "e.valor_cents")
    for r in db.execute(
        f"""SELECT e.id, e.descricao, e.valor_cents, e.data, e.categoria_id, c.nome AS categoria
            FROM entradas e LEFT JOIN categorias c ON c.id = e.categoria_id
            WHERE {w} ORDER BY e.data DESC LIMIT ?""",
        (*p, LIMITE + 1),
    ):
        itens.append({"tipo": "entrada", **dict(r)})

    # Contas fixas: o "quando" de um lançamento é o vencimento (dia da conta na
    # competência), que não existe como coluna — é calculado. No SQL o período
    # entra por competência (filtro FROUXO, mês inteiro: um proxy de dia fixo
    # descartaria vencimentos válidos); o corte fino sobre o vencimento
    # calculado acontece no Python logo abaixo.
    where_f, params_f = ["1=1"], []
    if q:
        where_f.append("cf.nome LIKE ? ESCAPE '\\'")
        params_f.append(_like(q))
    if de:
        where_f.append("l.competencia >= ?")
        params_f.append(de[:7])
    if ate:
        where_f.append("l.competencia <= ?")
        params_f.append(ate[:7])
    if valor_min is not None:
        where_f.append("l.valor_cents >= ?")
        params_f.append(valor_min)
    if valor_max is not None:
        where_f.append("l.valor_cents <= ?")
        params_f.append(valor_max)
    for r in db.execute(
        f"""SELECT l.id, cf.nome AS descricao, l.valor_cents, l.competencia, cf.dia_vencimento,
                   l.data_pagamento, cf.categoria_id, c.nome AS categoria
            FROM lancamentos_fixos l
            JOIN contas_fixas cf ON cf.id = l.conta_fixa_id
            LEFT JOIN categorias c ON c.id = cf.categoria_id
            WHERE {' AND '.join(where_f)} ORDER BY l.competencia DESC LIMIT ?""",
        (*params_f, LIMITE + 1),
    ):
        data = vencimento(r["competencia"], r["dia_vencimento"])
        if de and data < de:
            continue
        if ate and data > ate:
            continue
        itens.append({
            "tipo": "fixa",
            "id": r["id"],
            "descricao": r["descricao"],
            "valor_cents": r["valor_cents"],
            "data": data,
            "competencia": r["competencia"],
            "pago": r["data_pagamento"] is not None,
            "categoria_id": r["categoria_id"],
            "categoria": r["categoria"],
        })

    itens.sort(key=lambda i: i["data"], reverse=True)
    truncado = len(itens) > LIMITE
    return {"itens": itens[:LIMITE], "truncado": truncado}
