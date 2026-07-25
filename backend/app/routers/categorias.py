import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_db

router = APIRouter(prefix="/categorias", tags=["categorias"])


class CategoriaIn(BaseModel):
    nome: str
    tipo: Literal["fixa", "variavel", "entrada"]
    cor: str | None = None


@router.get("")
def listar(db: sqlite3.Connection = Depends(get_db)):
    return [dict(r) for r in db.execute("SELECT * FROM categorias WHERE ativa = 1 ORDER BY tipo, nome")]


@router.post("", status_code=201)
def criar(body: CategoriaIn, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)",
        (body.nome, body.tipo, body.cor),
    )
    return {"id": cur.lastrowid}
