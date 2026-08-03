"""Orçamentos: limite mensal de gasto variável por categoria.

O gasto comparado ao limite é SÓ o variável — conta fixa é previsível por
natureza e entraria no orçamento como um "estouro" que não informa nada.
O aviso push de estouro sai pelo job diário (lembretes.py), com a mesma
garantia de não repetição dos outros lembretes.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import competencia_de, hoje, validar_competencia

router = APIRouter(prefix="/orcamentos", tags=["orcamentos"])


class OrcamentoIn(BaseModel):
    limite_cents: int = Field(gt=0)


def gastos_do_mes(db: sqlite3.Connection, competencia: str) -> dict[int, int]:
    """Gasto variável por categoria na competência (só categorias com orçamento)."""
    return {
        r["categoria_id"]: r["t"]
        for r in db.execute(
            """SELECT l.categoria_id, SUM(l.valor_cents) t
               FROM lancamentos_variaveis l
               JOIN orcamentos o ON o.categoria_id = l.categoria_id
               WHERE substr(l.data, 1, 7) = ?
               GROUP BY l.categoria_id""",
            (competencia,),
        )
    }


@router.get("")
def listar(competencia: str | None = None, db: sqlite3.Connection = Depends(get_db)):
    competencia = competencia or competencia_de(hoje())
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    gastos = gastos_do_mes(db, competencia)
    return [
        {
            "categoria_id": r["categoria_id"],
            "nome": r["nome"],
            "cor": r["cor"],
            "limite_cents": r["limite_cents"],
            "gasto_cents": gastos.get(r["categoria_id"], 0),
        }
        # Categoria desativada continua aparecendo enquanto tiver orçamento:
        # sumir da lista esconderia um limite ainda ativo no job de push.
        for r in db.execute(
            """SELECT o.categoria_id, o.limite_cents, c.nome, c.cor
               FROM orcamentos o JOIN categorias c ON c.id = o.categoria_id
               ORDER BY c.nome"""
        )
    ]


@router.put("/{categoria_id}")
def definir(categoria_id: int, body: OrcamentoIn, db: sqlite3.Connection = Depends(get_db)):
    cat = db.execute("SELECT tipo FROM categorias WHERE id = ?", (categoria_id,)).fetchone()
    if not cat:
        raise HTTPException(404, "Categoria não encontrada")
    if cat["tipo"] != "variavel":
        raise HTTPException(400, "Orçamento é só para categorias de gasto variável")
    db.execute(
        """INSERT INTO orcamentos (categoria_id, limite_cents) VALUES (?, ?)
           ON CONFLICT(categoria_id) DO UPDATE SET
             limite_cents = excluded.limite_cents, atualizado_em = CURRENT_TIMESTAMP""",
        (categoria_id, body.limite_cents),
    )
    return {"ok": True}


@router.delete("/{categoria_id}")
def remover(categoria_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM orcamentos WHERE categoria_id = ?", (categoria_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Esta categoria não tem orçamento")
    return {"ok": True}
