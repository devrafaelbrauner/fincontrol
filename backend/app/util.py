import calendar
import re
import sqlite3
from datetime import date, datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")
RE_COMPETENCIA = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def hoje() -> date:
    return datetime.now(TZ).date()


def vencimento(competencia: str, dia: int) -> str:
    """Data de vencimento na competência; dia 31 num mês curto cai no último dia."""
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    ultimo = calendar.monthrange(ano, mes)[1]
    return f"{ano:04d}-{mes:02d}-{min(dia, ultimo):02d}"


def competencia_de(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def somar_meses(competencia: str, n: int) -> str:
    """Competência deslocada em n meses (n pode ser negativo)."""
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    total = (ano * 12 + mes - 1) + n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def brl(cents: int) -> str:
    return f"R$ {cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def validar_competencia(competencia: str) -> None:
    if not RE_COMPETENCIA.match(competencia):
        raise ValueError("Competência deve estar no formato YYYY-MM")


def gerar_lancamentos_fixos(db: sqlite3.Connection, competencia: str) -> None:
    """Geração on-access, idempotente: cria os lançamentos da competência
    para toda conta fixa ativa que ainda não os tenha."""
    db.execute(
        """
        INSERT OR IGNORE INTO lancamentos_fixos (conta_fixa_id, competencia, valor_cents)
        SELECT id, ?, valor_estimado_cents FROM contas_fixas WHERE ativa = 1
        """,
        (competencia,),
    )


def status_lancamento(data_pagamento: str | None, data_vencimento: str) -> str:
    if data_pagamento:
        return "pago"
    return "atrasado" if hoje().isoformat() > data_vencimento else "pendente"
