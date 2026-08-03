"""Busca global: texto, período e/ou faixa de valor sobre gastos variáveis,
entradas e contas fixas — de qualquer tela, numa chamada só."""

import re
import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db

router = APIRouter(prefix="/busca", tags=["busca"])

# Regex + parse: o regex barra os formatos alternativos que fromisoformat
# (3.11+) aceitaria; o parse barra "2026-99-99", que tem o formato mas não é data.
RE_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validar_data(rotulo: str, valor: str) -> None:
    try:
        if not RE_DATA.match(valor):
            raise ValueError
        date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(400, f"'{rotulo}' deve ser uma data YYYY-MM-DD válida")

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
    for rotulo, valor in (("de", de), ("ate", ate)):
        if valor:
            _validar_data(rotulo, valor)

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
            WHERE {w} ORDER BY l.data DESC, l.id DESC LIMIT ?""",
        (*p, LIMITE + 1),
    ):
        itens.append({"tipo": "variavel", **dict(r)})

    w, p = clausulas("e.descricao", "e.data", "e.valor_cents")
    for r in db.execute(
        f"""SELECT e.id, e.descricao, e.valor_cents, e.data, e.categoria_id, c.nome AS categoria
            FROM entradas e LEFT JOIN categorias c ON c.id = e.categoria_id
            WHERE {w} ORDER BY e.data DESC, e.id DESC LIMIT ?""",
        (*p, LIMITE + 1),
    ):
        itens.append({"tipo": "entrada", **dict(r)})

    # Contas fixas: o "quando" de um lançamento é o vencimento (dia da conta na
    # competência), que não existe como coluna — é calculado NO SQL, igual ao
    # util.vencimento (dia clampado ao último do mês), para o corte por data
    # acontecer ANTES do LIMIT. Refinar depois do LIMIT descartaria matches
    # válidos que nem chegaram a sair do banco — e ainda mentiria no `truncado`.
    where_f, params_f = ["1=1"], []
    if q:
        where_f.append("cf.nome LIKE ? ESCAPE '\\'")
        params_f.append(_like(q))
    if valor_min is not None:
        where_f.append("l.valor_cents >= ?")
        params_f.append(valor_min)
    if valor_max is not None:
        where_f.append("l.valor_cents <= ?")
        params_f.append(valor_max)
    where_data, params_data = ["1=1"], []
    if de:
        where_data.append("data >= ?")
        params_data.append(de)
    if ate:
        where_data.append("data <= ?")
        params_data.append(ate)
    for r in db.execute(
        f"""SELECT * FROM (
              SELECT l.id, cf.nome AS descricao, l.valor_cents, l.competencia,
                     l.data_pagamento, cf.categoria_id, c.nome AS categoria,
                     l.competencia || '-' || printf('%02d', MIN(cf.dia_vencimento,
                         CAST(strftime('%d', date(l.competencia || '-01', '+1 month', '-1 day')) AS INTEGER))) AS data
              FROM lancamentos_fixos l
              JOIN contas_fixas cf ON cf.id = l.conta_fixa_id
              LEFT JOIN categorias c ON c.id = cf.categoria_id
              WHERE {' AND '.join(where_f)}
            )
            WHERE {' AND '.join(where_data)}
            ORDER BY data DESC, id DESC LIMIT ?""",
        (*params_f, *params_data, LIMITE + 1),
    ):
        itens.append({
            "tipo": "fixa",
            "id": r["id"],
            "descricao": r["descricao"],
            "valor_cents": r["valor_cents"],
            "data": r["data"],
            "competencia": r["competencia"],
            "pago": r["data_pagamento"] is not None,
            "categoria_id": r["categoria_id"],
            "categoria": r["categoria"],
        })

    itens.sort(key=lambda i: i["data"], reverse=True)
    truncado = len(itens) > LIMITE
    return {"itens": itens[:LIMITE], "truncado": truncado}
