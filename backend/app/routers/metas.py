import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import hoje

router = APIRouter(prefix="/metas", tags=["metas"])


class MetaIn(BaseModel):
    nome: str
    valor_total_cents: int = Field(gt=0)
    prazo: str  # YYYY-MM-DD
    estrategia_texto: str | None = None


class MetaPatch(BaseModel):
    nome: str | None = None
    valor_total_cents: int | None = Field(default=None, gt=0)
    prazo: str | None = None
    estrategia_texto: str | None = None
    ativa: bool | None = None


class AporteIn(BaseModel):
    valor_cents: int = Field(gt=0)
    data: str | None = None  # default: hoje
    observacao: str | None = None


def _meses_restantes(prazo: str) -> int:
    h = hoje()
    ano, mes = int(prazo[:4]), int(prazo[5:7])
    return max((ano - h.year) * 12 + (mes - h.month), 1)


@router.get("")
def listar(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT m.*, COALESCE(SUM(a.valor_cents), 0) AS valor_atual_cents
           FROM metas m LEFT JOIN metas_aportes a ON a.meta_id = m.id
           WHERE m.ativa = 1 GROUP BY m.id ORDER BY m.prazo"""
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        faltante = max(d["valor_total_cents"] - d["valor_atual_cents"], 0)
        d["valor_mensal_necessario_cents"] = faltante // _meses_restantes(d["prazo"])
        out.append(d)
    return out


@router.post("", status_code=201)
def criar(body: MetaIn, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        "INSERT INTO metas (nome, valor_total_cents, prazo, estrategia_texto) VALUES (?, ?, ?, ?)",
        (body.nome, body.valor_total_cents, body.prazo, body.estrategia_texto),
    )
    return {"id": cur.lastrowid}


@router.patch("/{meta_id}")
def editar(meta_id: int, body: MetaPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    if "ativa" in campos:
        campos["ativa"] = 1 if campos["ativa"] else 0
    sets = ", ".join(f"{c} = ?" for c in campos)
    cur = db.execute(
        f"UPDATE metas SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
        (*campos.values(), meta_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Meta não encontrada")
    return {"ok": True}


@router.delete("/{meta_id}")
def excluir(meta_id: int, db: sqlite3.Connection = Depends(get_db)):
    if not db.execute("SELECT 1 FROM metas WHERE id = ?", (meta_id,)).fetchone():
        raise HTTPException(404, "Meta não encontrada")
    db.execute("DELETE FROM metas_aportes WHERE meta_id = ?", (meta_id,))
    db.execute("DELETE FROM metas WHERE id = ?", (meta_id,))
    return {"ok": True}


@router.post("/{meta_id}/aportes", status_code=201)
def aportar(meta_id: int, body: AporteIn, db: sqlite3.Connection = Depends(get_db)):
    if not db.execute("SELECT 1 FROM metas WHERE id = ?", (meta_id,)).fetchone():
        raise HTTPException(404, "Meta não encontrada")
    cur = db.execute(
        "INSERT INTO metas_aportes (meta_id, valor_cents, data, observacao) VALUES (?, ?, ?, ?)",
        (meta_id, body.valor_cents, body.data or hoje().isoformat(), body.observacao),
    )
    return {"id": cur.lastrowid}


@router.get("/{meta_id}/aportes")
def aportes(meta_id: int, db: sqlite3.Connection = Depends(get_db)):
    return [
        dict(r)
        for r in db.execute(
            "SELECT * FROM metas_aportes WHERE meta_id = ? ORDER BY data DESC, id DESC", (meta_id,)
        )
    ]
