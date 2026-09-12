"""Orçamentos: limite mensal de gasto variável por categoria.

O gasto comparado ao limite é SÓ o variável — conta fixa é previsível por
natureza e entraria no orçamento como um "estouro" que não informa nada.
Os avisos push (chegando no limite aos 80%, estouro aos 100%) saem pelo job
diário (lembretes.py), com a mesma garantia de não repetição dos outros
lembretes — e contando só o que já saiu, ao contrário da barra na tela.
"""

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import competencia_de, conferir_versao, hoje, validar_competencia

router = APIRouter(prefix="/orcamentos", tags=["orcamentos"])


class OrcamentoIn(BaseModel):
    limite_cents: int = Field(gt=0)


def gastos_do_mes(
    db: sqlite3.Connection, competencia: str, ate: str | None = None
) -> dict[int, int]:
    """Gasto variável por categoria na competência (só categorias com orçamento).

    `ate` corta no dia, e os dois consumidores querem coisas diferentes:

    - A **listagem** (barra na tela) não passa nada: a pergunta ali é quanto do
      limite já está comprometido, e uma parcela que vence dia 20 compromete o
      mês desde que a compra foi feita. Contar o mês inteiro é o certo.
    - O **job de push** passa hoje. Compra em N× é materializada com a data do
      mês de cada parcela, então sem o corte o job anunciaria "orçamento
      estourado" no dia 5 por dinheiro que só sai no dia 20 — falso alarme
      sobre algo que o usuário não pode mais evitar de qualquer forma.
    """
    where, params = "substr(l.data, 1, 7) = ?", [competencia]
    if ate:
        where += " AND l.data <= ?"
        params.append(ate)
    return {
        r["categoria_id"]: r["t"]
        for r in db.execute(
            f"""SELECT l.categoria_id, SUM(l.valor_cents) t
               FROM lancamentos_variaveis l
               JOIN orcamentos o ON o.categoria_id = l.categoria_id
               WHERE {where}
               GROUP BY l.categoria_id""",
            params,
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
            "versao": r["versao"],
        }
        # Categoria desativada continua aparecendo enquanto tiver orçamento:
        # sumir da lista esconderia um limite ainda ativo no job de push.
        for r in db.execute(
            """SELECT o.categoria_id, o.limite_cents, o.versao, c.nome, c.cor
               FROM orcamentos o JOIN categorias c ON c.id = o.categoria_id
               ORDER BY c.nome"""
        )
    ]


@router.put("/{categoria_id}")
def definir(categoria_id: int, body: OrcamentoIn, db: sqlite3.Connection = Depends(get_db),
            if_match: str | None = Header(default=None, alias="If-Match")):
    cat = db.execute("SELECT tipo FROM categorias WHERE id = ?", (categoria_id,)).fetchone()
    if not cat:
        raise HTTPException(404, "Categoria não encontrada")
    if cat["tipo"] != "variavel":
        raise HTTPException(400, "Orçamento é só para categorias de gasto variável")
    conferir_versao(db, "orcamentos", categoria_id, if_match, coluna_id="categoria_id")
    db.execute(
        """INSERT INTO orcamentos (categoria_id, limite_cents) VALUES (?, ?)
           ON CONFLICT(categoria_id) DO UPDATE SET
             limite_cents = excluded.limite_cents, atualizado_em = CURRENT_TIMESTAMP,
             versao = orcamentos.versao + 1""",
        (categoria_id, body.limite_cents),
    )
    return {"ok": True}


@router.delete("/{categoria_id}")
def remover(categoria_id: int, db: sqlite3.Connection = Depends(get_db),
            if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "orcamentos", categoria_id, if_match, coluna_id="categoria_id")
    cur = db.execute("DELETE FROM orcamentos WHERE categoria_id = ?", (categoria_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Esta categoria não tem orçamento")
    return {"ok": True}
