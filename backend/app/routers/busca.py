"""Busca global: texto, período e/ou faixa de valor sobre gastos variáveis,
entradas e contas fixas — de qualquer tela, numa chamada só."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..util import normalizar_busca, validar_data

router = APIRouter(prefix="/busca", tags=["busca"])


def _validar_data(rotulo: str, valor: str) -> None:
    """Mesma regra dos campos gravados (util.validar_data), com a mensagem
    apontando qual parâmetro veio torto. Aqui é 400 e não o 422 do schema porque
    são parâmetros de query, tratados à mão para poder nomear o rótulo."""
    try:
        validar_data(valor)
    except ValueError:
        raise HTTPException(400, f"'{rotulo}' deve ser uma data YYYY-MM-DD válida")

# Teto de linhas devolvidas (após juntar as três fontes). A UI mostra os mais
# recentes; quem precisa de tudo refina o filtro.
LIMITE = 50


def _like(q: str) -> str:
    """Padrão LIKE normalizado, com curingas do usuário neutralizados.

    Normaliza ANTES de escapar: a normalização não toca em `\\`, `%` nem `_`
    (são ASCII sem acento), mas fazer na ordem inversa deixaria o escape à mercê
    dela. A coluna recebe o mesmo `norm()` no SQL — os dois lados têm de estar
    na mesma forma, senão a comparação continua sensível a acento.
    """
    escapado = normalizar_busca(q).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
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
            where.append(f"norm({col_texto}) LIKE ? ESCAPE '\\'")
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
        where_f.append("norm(cf.nome) LIKE ? ESCAPE '\\'")
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
