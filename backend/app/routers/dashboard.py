import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..util import gerar_lancamentos_fixos, status_lancamento, validar_competencia, vencimento

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/{competencia}")
def dashboard(competencia: str, db: sqlite3.Connection = Depends(get_db)):
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    gerar_lancamentos_fixos(db, competencia)
    prefixo = competencia + "-%"

    entradas = db.execute(
        "SELECT COALESCE(SUM(valor_cents), 0) AS t FROM entradas WHERE data LIKE ?", (prefixo,)
    ).fetchone()["t"]
    variaveis = db.execute(
        "SELECT COALESCE(SUM(valor_cents), 0) AS t FROM lancamentos_variaveis WHERE data LIKE ?", (prefixo,)
    ).fetchone()["t"]
    fixas = db.execute(
        "SELECT COALESCE(SUM(valor_cents), 0) AS t FROM lancamentos_fixos WHERE competencia = ?", (competencia,)
    ).fetchone()["t"]

    pendentes = db.execute(
        """SELECT l.id, l.valor_cents, c.nome, c.dia_vencimento
           FROM lancamentos_fixos l JOIN contas_fixas c ON c.id = l.conta_fixa_id
           WHERE l.competencia = ? AND l.data_pagamento IS NULL
           ORDER BY c.dia_vencimento""",
        (competencia,),
    ).fetchall()
    proximos = []
    for r in pendentes:
        venc = vencimento(competencia, r["dia_vencimento"])
        proximos.append(
            {
                "id": r["id"],
                "nome": r["nome"],
                "valor_cents": r["valor_cents"],
                "vencimento": venc,
                "status": status_lancamento(None, venc),
            }
        )

    return {
        "competencia": competencia,
        "entradas_cents": entradas,
        "fixas_cents": fixas,
        "variaveis_cents": variaveis,
        "saldo_cents": entradas - fixas - variaveis,
        "proximos_vencimentos": proximos,
    }
