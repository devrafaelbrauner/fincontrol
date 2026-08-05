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
                "tipo": "fixa",
                "nome": r["nome"],
                "valor_cents": r["valor_cents"],
                "vencimento": venc,
                "status": status_lancamento(None, venc),
            }
        )

    # Compromissos em aberto do mês entram na mesma lista: para quem olha o
    # dashboard, "o que ainda tenho a pagar este mês" é uma pergunta só — deixá-los
    # de fora escondia justamente as obrigações pontuais, que são as esquecíveis.
    for r in db.execute(
        """SELECT c.id, c.nome, c.credor, c.data_limite,
                  c.valor_total_cents - COALESCE(SUM(l.valor_cents), 0) AS falta_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.ativo = 1 AND substr(c.data_limite, 1, 7) = ?
           GROUP BY c.id HAVING falta_cents > 0""",
        (competencia,),
    ):
        proximos.append({
            "id": r["id"],
            "tipo": "compromisso",
            "nome": r["nome"] + (f" ({r['credor']})" if r["credor"] else ""),
            # O que falta, não o total: com pagamento parcial o valor cheio faria
            # o dashboard cobrar dinheiro que já saiu.
            "valor_cents": r["falta_cents"],
            "vencimento": r["data_limite"],
            "status": status_lancamento(None, r["data_limite"]),
        })
    proximos.sort(key=lambda p: (p["vencimento"], p["nome"]))

    return {
        "competencia": competencia,
        "entradas_cents": entradas,
        "fixas_cents": fixas,
        "variaveis_cents": variaveis,
        "saldo_cents": entradas - fixas - variaveis,
        "proximos_vencimentos": proximos,
    }
