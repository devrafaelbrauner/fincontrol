"""Compromissos financeiros: obrigação pontual com valor total e prazo.

A diferença para o resto do app, que é o motivo desta aba existir: conta fixa
recorre sem fim nem total; parcelamento é compra no cartão já dividida; meta é
juntar dinheiro PARA algo. Compromisso é dever algo, com um total a quitar.

**O pagamento é um lançamento variável de verdade** (`compromisso_id` em
`lancamentos_variaveis`), não uma tabela paralela — ver a migration 010. Por isso
`pago_cents` é sempre derivado: somar os lançamentos vinculados é a única fonte,
e não existe caminho para o número da aba divergir do gasto do mês.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import DataISO, hoje

router = APIRouter(prefix="/compromissos", tags=["compromissos"])

FORMAS = ("pix", "credito", "debito", "dinheiro", "boleto")


class CompromissoIn(BaseModel):
    nome: str
    credor: str | None = None
    categoria_id: int | None = None
    valor_total_cents: int = Field(gt=0)
    data_limite: DataISO
    forma_pagamento: str | None = None
    lembrete_dias_antes: int = Field(default=3, ge=0, le=90)


class CompromissoPatch(BaseModel):
    nome: str | None = None
    credor: str | None = None
    categoria_id: int | None = None
    valor_total_cents: int | None = Field(default=None, gt=0)
    data_limite: DataISO | None = None
    forma_pagamento: str | None = None
    orientacao_texto: str | None = None
    lembrete_dias_antes: int | None = Field(default=None, ge=0, le=90)
    ativo: bool | None = None


class PagamentoIn(BaseModel):
    valor_cents: int = Field(gt=0)
    data: DataISO | None = None  # default: hoje
    forma_pagamento: str | None = None  # default: a do compromisso
    anexo_id: int | None = None  # comprovante
    descricao: str | None = None  # default: o nome do compromisso


# Mesmo motivo do `NAO_NULAVEIS_META` em metas.py: `exclude_unset=True` preserva um
# null mandado de propósito, e escrevê-lo numa coluna NOT NULL vira IntegrityError
# — 500 onde cabia 422.
NAO_NULAVEIS = frozenset({"nome", "valor_total_cents", "data_limite", "lembrete_dias_antes", "ativo"})

# O SET do PATCH é montado por interpolação, então o nome da coluna nunca pode vir
# de fora. Hoje as chaves são as do CompromissoPatch, mas um campo novo no modelo
# viraria SQL direto — a lista fecha isso na origem (igual metas.py:142).
COLUNAS_EDITAVEIS = frozenset({
    "nome", "credor", "categoria_id", "valor_total_cents", "data_limite",
    "forma_pagamento", "orientacao_texto", "lembrete_dias_antes", "ativo",
})


def _recusar_nulos(campos: dict) -> None:
    nulos = sorted(c for c in campos if c in NAO_NULAVEIS and campos[c] is None)
    if nulos:
        raise HTTPException(422, f"Campo não pode ser nulo: {', '.join(nulos)}")


def _validar_forma(valor: str | None) -> None:
    """A coluna tem CHECK; sem isto o valor errado só estouraria como IntegrityError
    (500), sem dizer quais são as formas aceitas."""
    if valor is not None and valor not in FORMAS:
        raise HTTPException(422, f"forma_pagamento deve ser uma de: {', '.join(FORMAS)}")


def _status(pago: int, total: int, data_limite: str) -> str:
    """Derivado, nunca armazenado — mesma regra do `status_lancamento` das fixas."""
    if pago >= total:
        return "quitado"
    return "atrasado" if hoje().isoformat() > data_limite else "em_aberto"


def _com_progresso(r: sqlite3.Row) -> dict:
    d = dict(r)
    pago = d.pop("pago_cents_bruto", 0) or 0
    d["pago_cents"] = pago
    d["falta_cents"] = max(d["valor_total_cents"] - pago, 0)
    d["status"] = _status(pago, d["valor_total_cents"], d["data_limite"])
    d["ativo"] = bool(d["ativo"])
    return d


SELECT_BASE = """
    SELECT c.*, COALESCE(SUM(l.valor_cents), 0) AS pago_cents_bruto,
           cat.nome AS categoria, cat.cor AS categoria_cor
    FROM compromissos c
    LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
    LEFT JOIN categorias cat ON cat.id = c.categoria_id
"""


@router.get("")
def listar(incluir_arquivados: bool = False, db: sqlite3.Connection = Depends(get_db)):
    where = "" if incluir_arquivados else "WHERE c.ativo = 1"
    # Vencendo antes primeiro: a aba existe para mostrar o que aperta agora.
    rows = db.execute(f"{SELECT_BASE} {where} GROUP BY c.id ORDER BY c.data_limite, c.id").fetchall()
    return [_com_progresso(r) for r in rows]


@router.get("/{compromisso_id}")
def obter(compromisso_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(f"{SELECT_BASE} WHERE c.id = ? GROUP BY c.id", (compromisso_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Compromisso não encontrado")
    return _com_progresso(row)


@router.post("", status_code=201)
def criar(body: CompromissoIn, db: sqlite3.Connection = Depends(get_db)):
    if not body.nome.strip():
        raise HTTPException(422, "Informe o nome do compromisso")
    _validar_forma(body.forma_pagamento)
    try:
        cur = db.execute(
            """INSERT INTO compromissos
               (nome, credor, categoria_id, valor_total_cents, data_limite, forma_pagamento, lembrete_dias_antes)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (body.nome.strip(), (body.credor or "").strip() or None, body.categoria_id,
             body.valor_total_cents, body.data_limite, body.forma_pagamento, body.lembrete_dias_antes),
        )
    except sqlite3.IntegrityError:
        # Mesma regra de /variaveis: FK inexistente é erro do chamador, não 500.
        raise HTTPException(400, "categoria_id inexistente")
    return {"id": cur.lastrowid}


@router.patch("/{compromisso_id}")
def editar(compromisso_id: int, body: CompromissoPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = {c: v for c, v in body.model_dump(exclude_unset=True).items() if c in COLUNAS_EDITAVEIS}
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    _recusar_nulos(campos)
    if "forma_pagamento" in campos:
        _validar_forma(campos["forma_pagamento"])
    if "ativo" in campos:
        campos["ativo"] = 1 if campos["ativo"] else 0
    if "nome" in campos:
        campos["nome"] = campos["nome"].strip()
        if not campos["nome"]:
            raise HTTPException(422, "Informe o nome do compromisso")
    sets = ", ".join(f"{c} = ?" for c in campos)
    try:
        cur = db.execute(
            f"UPDATE compromissos SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
            (*campos.values(), compromisso_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "categoria_id inexistente")
    if cur.rowcount == 0:
        raise HTTPException(404, "Compromisso não encontrado")
    return {"ok": True}


@router.delete("/{compromisso_id}")
def excluir(compromisso_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Apaga o compromisso e DESVINCULA os pagamentos, sem apagá-los.

    O dinheiro saiu de verdade: apagar os lançamentos junto reescreveria o gasto
    de meses já fechados — o dashboard, as análises e o orçamento mudariam de
    valor retroativamente por causa de uma faxina na aba de compromissos.
    """
    if not db.execute("SELECT 1 FROM compromissos WHERE id = ?", (compromisso_id,)).fetchone():
        raise HTTPException(404, "Compromisso não encontrado")
    desvinculados = db.execute(
        "UPDATE lancamentos_variaveis SET compromisso_id = NULL, atualizado_em = CURRENT_TIMESTAMP "
        "WHERE compromisso_id = ?",
        (compromisso_id,),
    ).rowcount
    db.execute("DELETE FROM compromissos WHERE id = ?", (compromisso_id,))
    return {"ok": True, "pagamentos_desvinculados": desvinculados}


# ---------- pagamentos (lançamentos variáveis vinculados) ----------

@router.get("/{compromisso_id}/pagamentos")
def pagamentos(compromisso_id: int, db: sqlite3.Connection = Depends(get_db)):
    if not db.execute("SELECT 1 FROM compromissos WHERE id = ?", (compromisso_id,)).fetchone():
        raise HTTPException(404, "Compromisso não encontrado")
    return [
        dict(r)
        for r in db.execute(
            "SELECT * FROM lancamentos_variaveis WHERE compromisso_id = ? ORDER BY data DESC, id DESC",
            (compromisso_id,),
        )
    ]


@router.post("/{compromisso_id}/pagamentos", status_code=201)
def pagar(compromisso_id: int, body: PagamentoIn, db: sqlite3.Connection = Depends(get_db)):
    """Registra um pagamento — que É um gasto variável, com a categoria e a forma
    do compromisso como padrão. Nada impede pagar mais que o total (acordo com
    juros, valor corrigido): o excedente aparece como quitado, não como erro."""
    c = db.execute("SELECT * FROM compromissos WHERE id = ?", (compromisso_id,)).fetchone()
    if not c:
        raise HTTPException(404, "Compromisso não encontrado")
    forma = body.forma_pagamento if body.forma_pagamento is not None else c["forma_pagamento"]
    _validar_forma(forma)
    descricao = (body.descricao or "").strip() or c["nome"]
    try:
        cur = db.execute(
            """INSERT INTO lancamentos_variaveis
               (descricao, categoria_id, valor_cents, data, forma_pagamento, anexo_id, compromisso_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (descricao, c["categoria_id"], body.valor_cents, body.data or hoje().isoformat(),
             forma, body.anexo_id, compromisso_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "anexo_id inexistente")
    return {"id": cur.lastrowid}
