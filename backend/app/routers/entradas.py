import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import DataISO

router = APIRouter(prefix="/entradas", tags=["entradas"])


class EntradaIn(BaseModel):
    descricao: str
    categoria_id: int | None = None
    valor_cents: int = Field(ge=0)
    data: DataISO
    recorrente: bool = False


@router.get("")
def listar(de: str | None = None, ate: str | None = None, db: sqlite3.Connection = Depends(get_db)):
    where, params = ["1=1"], []
    if de:
        where.append("data >= ?")
        params.append(de)
    if ate:
        where.append("data <= ?")
        params.append(ate)
    itens = [
        dict(r)
        for r in db.execute(
            f"SELECT * FROM entradas WHERE {' AND '.join(where)} ORDER BY data DESC, id DESC", params
        )
    ]
    return {"itens": itens, "total_cents": sum(i["valor_cents"] for i in itens)}


@router.post("", status_code=201)
def criar(body: EntradaIn, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            "INSERT INTO entradas (descricao, categoria_id, valor_cents, data, recorrente) VALUES (?, ?, ?, ?, ?)",
            (body.descricao, body.categoria_id, body.valor_cents, body.data, int(body.recorrente)),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "categoria_id inexistente")
    return {"id": cur.lastrowid}


@router.delete("/{entrada_id}")
def excluir(entrada_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM entradas WHERE id = ?", (entrada_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Entrada não encontrada")
    return {"ok": True}
