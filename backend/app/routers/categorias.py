import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import get_db

router = APIRouter(prefix="/categorias", tags=["categorias"])


class CategoriaIn(BaseModel):
    nome: str
    tipo: Literal["fixa", "variavel", "entrada"]
    cor: str | None = None


class CategoriaPatch(BaseModel):
    nome: str | None = None
    cor: str | None = None
    ativa: bool | None = None


@router.get("")
def listar(todas: bool = False, db: sqlite3.Connection = Depends(get_db)):
    """`todas=1` inclui as desativadas — para resolver nome/cor de lançamentos
    históricos (uma categoria desativada não pode virar "Sem categoria" nos
    gráficos); as listas de escolha continuam usando só as ativas."""
    where = "" if todas else "WHERE ativa = 1"
    return [dict(r) for r in db.execute(f"SELECT * FROM categorias {where} ORDER BY tipo, nome")]


@router.post("", status_code=201)
def criar(body: CategoriaIn, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)",
        (body.nome, body.tipo, body.cor),
    )
    return {"id": cur.lastrowid, "nome": body.nome, "tipo": body.tipo, "cor": body.cor, "ativa": 1}


@router.patch("/{categoria_id}")
def editar(categoria_id: int, body: CategoriaPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    if "ativa" in campos:
        campos["ativa"] = 1 if campos["ativa"] else 0
    sets = ", ".join(f"{c} = ?" for c in campos)
    cur = db.execute(f"UPDATE categorias SET {sets} WHERE id = ?", (*campos.values(), categoria_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "Categoria não encontrada")
    return {"ok": True}
