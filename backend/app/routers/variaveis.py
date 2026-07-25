import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db

router = APIRouter(prefix="/variaveis", tags=["variaveis"])


class VariavelIn(BaseModel):
    descricao: str
    categoria_id: int | None = None
    valor_cents: int = Field(ge=0)
    data: str
    forma_pagamento: Literal["pix", "credito", "debito", "dinheiro", "boleto"] | None = None
    anexo_id: int | None = None


class VariavelPatch(BaseModel):
    anexo_id: int | None = None
    categoria_id: int | None = None
    descricao: str | None = None
    valor_cents: int | None = Field(default=None, ge=0)
    data: str | None = None
    forma_pagamento: Literal["pix", "credito", "debito", "dinheiro", "boleto"] | None = None


@router.get("")
def listar(
    de: str | None = None,
    ate: str | None = None,
    categoria_id: int | None = None,
    db: sqlite3.Connection = Depends(get_db),
):
    where, params = ["1=1"], []
    if de:
        where.append("data >= ?")
        params.append(de)
    if ate:
        where.append("data <= ?")
        params.append(ate)
    if categoria_id:
        where.append("categoria_id = ?")
        params.append(categoria_id)
    sql_where = " AND ".join(where)
    itens = [
        dict(r)
        for r in db.execute(
            f"SELECT * FROM lancamentos_variaveis WHERE {sql_where} ORDER BY data DESC, id DESC", params
        )
    ]
    return {"itens": itens, "total_cents": sum(i["valor_cents"] for i in itens)}


@router.post("", status_code=201)
def criar(body: VariavelIn, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        """INSERT INTO lancamentos_variaveis (descricao, categoria_id, valor_cents, data, forma_pagamento, anexo_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (body.descricao, body.categoria_id, body.valor_cents, body.data, body.forma_pagamento, body.anexo_id),
    )
    return {"id": cur.lastrowid}


@router.patch("/{lancamento_id}")
def editar(lancamento_id: int, body: VariavelPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = body.model_dump(exclude_unset=True)  # atualização parcial (anexo e/ou categoria)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    sets = ", ".join(f"{c} = ?" for c in campos)
    cur = db.execute(
        f"UPDATE lancamentos_variaveis SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
        (*campos.values(), lancamento_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}


@router.delete("/{lancamento_id}")
def excluir(lancamento_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM lancamentos_variaveis WHERE id = ?", (lancamento_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}
