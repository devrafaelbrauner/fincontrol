import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import (
    DataISO,
    conferir_versao,
    gerar_lancamentos_fixos,
    hoje,
    status_lancamento,
    validar_competencia,
    vencimento,
)

router = APIRouter(prefix="/contas-fixas", tags=["contas-fixas"])


class ContaFixaIn(BaseModel):
    nome: str
    categoria_id: int | None = None
    dia_vencimento: int = Field(ge=1, le=31)
    valor_estimado_cents: int = Field(ge=0)
    lembrete_dias_antes: int = 3


class ContaFixaPatch(BaseModel):
    nome: str | None = None
    categoria_id: int | None = None
    dia_vencimento: int | None = Field(default=None, ge=1, le=31)
    valor_estimado_cents: int | None = Field(default=None, ge=0)
    lembrete_dias_antes: int | None = None
    ativa: bool | None = None


class PagamentoIn(BaseModel):
    # Data torta aqui não some da tela (a linha é da competência), mas quebra o
    # `status_lancamento` e o "pago em" — e o .ics compara string com string.
    data_pagamento: DataISO | None = None  # default: hoje
    valor_cents: int | None = Field(default=None, ge=0)


class AnexoLancamentoIn(BaseModel):
    anexo_id: int | None = None


@router.get("")
def listar(db: sqlite3.Connection = Depends(get_db)):
    # `versao` acompanha o If-Match do PATCH; `atualizado_em` continua saindo
    # cru para quem já o lia.
    return [{**dict(r), "versao": r["versao"]}
            for r in db.execute("SELECT * FROM contas_fixas ORDER BY dia_vencimento, nome")]


@router.post("", status_code=201)
def criar(body: ContaFixaIn, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute(
        """INSERT INTO contas_fixas (nome, categoria_id, dia_vencimento, valor_estimado_cents, lembrete_dias_antes)
           VALUES (?, ?, ?, ?, ?)""",
        (body.nome, body.categoria_id, body.dia_vencimento, body.valor_estimado_cents, body.lembrete_dias_antes),
    )
    return {"id": cur.lastrowid}


@router.patch("/{conta_id}")
def editar(conta_id: int, body: ContaFixaPatch, db: sqlite3.Connection = Depends(get_db),
           if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "contas_fixas", conta_id, if_match)
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    sets = ", ".join(f"{c} = ?" for c in campos)
    cur = db.execute(
        f"UPDATE contas_fixas SET {sets}, versao = versao + 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
        (*campos.values(), conta_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Conta fixa não encontrada")
    return {"ok": True}


@router.delete("/{conta_id}")
def excluir(conta_id: int, db: sqlite3.Connection = Depends(get_db),
            if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "contas_fixas", conta_id, if_match)
    if not db.execute("SELECT 1 FROM contas_fixas WHERE id = ?", (conta_id,)).fetchone():
        raise HTTPException(404, "Conta fixa não encontrada")
    db.execute("DELETE FROM lancamentos_fixos WHERE conta_fixa_id = ?", (conta_id,))
    db.execute("DELETE FROM contas_fixas WHERE id = ?", (conta_id,))
    return {"ok": True}


@router.get("/lancamentos/{competencia}")
def lancamentos(competencia: str, db: sqlite3.Connection = Depends(get_db)):
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    gerar_lancamentos_fixos(db, competencia)
    rows = db.execute(
        """SELECT l.id, l.conta_fixa_id, l.competencia, l.valor_cents, l.data_pagamento, l.anexo_id, l.versao,
                  c.nome, c.dia_vencimento, c.versao AS conta_versao
           FROM lancamentos_fixos l JOIN contas_fixas c ON c.id = l.conta_fixa_id
           WHERE l.competencia = ? ORDER BY c.dia_vencimento, c.nome""",
        (competencia,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["vencimento"] = vencimento(competencia, r["dia_vencimento"])
        d["status"] = status_lancamento(r["data_pagamento"], d["vencimento"])
        out.append(d)
    return out


@router.post("/lancamentos/{lancamento_id}/pagar")
def pagar(lancamento_id: int, body: PagamentoIn, db: sqlite3.Connection = Depends(get_db),
          if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "lancamentos_fixos", lancamento_id, if_match)
    data = body.data_pagamento or hoje().isoformat()
    if body.valor_cents is not None:
        cur = db.execute(
            "UPDATE lancamentos_fixos SET data_pagamento = ?, valor_cents = ?, atualizado_em = CURRENT_TIMESTAMP, "
            "versao = versao + 1 WHERE id = ?",
            (data, body.valor_cents, lancamento_id),
        )
    else:
        cur = db.execute(
            "UPDATE lancamentos_fixos SET data_pagamento = ?, atualizado_em = CURRENT_TIMESTAMP, "
            "versao = versao + 1 WHERE id = ?",
            (data, lancamento_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}


@router.patch("/lancamentos/{lancamento_id}/anexo")
def anexar(lancamento_id: int, body: AnexoLancamentoIn, db: sqlite3.Connection = Depends(get_db),
           if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "lancamentos_fixos", lancamento_id, if_match)
    cur = db.execute(
        "UPDATE lancamentos_fixos SET anexo_id = ?, atualizado_em = CURRENT_TIMESTAMP, versao = versao + 1 WHERE id = ?",
        (body.anexo_id, lancamento_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}


@router.post("/lancamentos/{lancamento_id}/desfazer-pagamento")
def desfazer_pagamento(lancamento_id: int, db: sqlite3.Connection = Depends(get_db),
                       if_match: str | None = Header(default=None, alias="If-Match")):
    conferir_versao(db, "lancamentos_fixos", lancamento_id, if_match)
    cur = db.execute(
        "UPDATE lancamentos_fixos SET data_pagamento = NULL, atualizado_em = CURRENT_TIMESTAMP, "
        "versao = versao + 1 WHERE id = ?",
        (lancamento_id,),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}
