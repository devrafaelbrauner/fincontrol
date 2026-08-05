import sqlite3
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import DataFiltro, DataISO, somar_meses, vencimento

router = APIRouter(prefix="/variaveis", tags=["variaveis"])


class VariavelIn(BaseModel):
    descricao: str
    categoria_id: int | None = None
    valor_cents: int = Field(ge=0)
    data: DataISO
    forma_pagamento: Literal["pix", "credito", "debito", "dinheiro", "boleto"] | None = None
    anexo_id: int | None = None


class VariavelPatch(BaseModel):
    anexo_id: int | None = None
    categoria_id: int | None = None
    descricao: str | None = None
    valor_cents: int | None = Field(default=None, ge=0)
    data: DataISO | None = None
    forma_pagamento: Literal["pix", "credito", "debito", "dinheiro", "boleto"] | None = None


@router.get("")
def listar(
    # Validado no schema, como os campos gravados: um `de` fora do padrão não
    # dava erro — comparado como texto, '15/08/2026' < '2026-...', o WHERE
    # virava sempre verdadeiro e a resposta vinha SEM FILTRO, com cara de
    # filtrada. O 422 do schema nomeia o campo, que é o que a UI mostra.
    de: DataFiltro = None,
    ate: DataFiltro = None,
    categoria_id: int | None = None,
    db: sqlite3.Connection = Depends(get_db),
):
    where, params = ["1=1"], []
    if de:
        where.append("l.data >= ?")
        params.append(de)
    if ate:
        where.append("l.data <= ?")
        params.append(ate)
    if categoria_id:
        where.append("l.categoria_id = ?")
        params.append(categoria_id)
    sql_where = " AND ".join(where)
    # parcelas_total junto: a UI mostra "3/10" sem uma requisição por linha.
    itens = [
        dict(r)
        for r in db.execute(
            f"""SELECT l.*, p.parcelas AS parcelas_total
                FROM lancamentos_variaveis l
                LEFT JOIN parcelamentos p ON p.id = l.parcelamento_id
                WHERE {sql_where} ORDER BY l.data DESC, l.id DESC""",
            params,
        )
    ]
    return {"itens": itens, "total_cents": sum(i["valor_cents"] for i in itens)}


class ParceladoIn(BaseModel):
    descricao: str
    categoria_id: int | None = None
    # Convenção brasileira: informa-se o valor DA PARCELA ("10× de R$ 149,90"),
    # não o total — é o número que está no comprovante.
    valor_parcela_cents: int = Field(gt=0)
    parcelas: int = Field(ge=2, le=72)
    primeira_data: DataISO
    forma_pagamento: Literal["pix", "credito", "debito", "dinheiro", "boleto"] | None = "credito"
    anexo_id: int | None = None  # comprovante da compra — vai na 1ª parcela


@router.post("/parcelado", status_code=201)
def criar_parcelado(body: ParceladoIn, db: sqlite3.Connection = Depends(get_db)):
    """Cria o parcelamento e TODAS as parcelas de uma vez, uma por mês.

    Materializar já — em vez de gerar on-access como as contas fixas — é
    deliberado: parcela tem valor travado no ato da compra (não há "estimado"
    para atualizar) e o total de meses é conhecido; com as linhas no banco, os
    meses futuros mostram o comprometimento sem nenhum código especial.
    """
    # O formato já foi checado no schema (DataISO) — aqui só se converte.
    primeira = date.fromisoformat(body.primeira_data)

    try:
        cur = db.execute(
            """INSERT INTO parcelamentos (descricao, categoria_id, valor_parcela_cents, parcelas, primeira_data, forma_pagamento)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (body.descricao, body.categoria_id, body.valor_parcela_cents, body.parcelas,
             body.primeira_data, body.forma_pagamento),
        )
        parcelamento_id = cur.lastrowid

        comp0 = f"{primeira.year:04d}-{primeira.month:02d}"
        ids = []
        for n in range(body.parcelas):
            # Mesmo dia da 1ª parcela nos meses seguintes; dia 31 encolhe para o
            # último dia do mês quando ele não existe (vencimento já faz isso).
            data_n = body.primeira_data if n == 0 else vencimento(somar_meses(comp0, n), primeira.day)
            cur = db.execute(
                """INSERT INTO lancamentos_variaveis
                   (descricao, categoria_id, valor_cents, data, forma_pagamento, anexo_id, parcelamento_id, parcela_num)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (body.descricao, body.categoria_id, body.valor_parcela_cents, data_n,
                 body.forma_pagamento, body.anexo_id if n == 0 else None, parcelamento_id, n + 1),
            )
            ids.append(cur.lastrowid)
    except sqlite3.IntegrityError:
        # FK de categoria/anexo inexistente: erro do chamador, não do servidor.
        # O get_db não comita em exceção — nada fica pela metade.
        raise HTTPException(400, "categoria_id ou anexo_id inexistente")

    return {
        "id": parcelamento_id,
        "lancamentos": ids,
        "total_cents": body.valor_parcela_cents * body.parcelas,
    }


class ParceladoPatch(BaseModel):
    categoria_id: int | None  # None = tirar a categoria de todas as parcelas


@router.patch("/parcelado/{parcelamento_id}")
def recategorizar_parcelado(parcelamento_id: int, body: ParceladoPatch, db: sqlite3.Connection = Depends(get_db)):
    """Muda a categoria da compra INTEIRA — todas as parcelas, passadas e
    futuras. Recategorizar só um mês é o PATCH comum do lançamento; sem este
    endpoint, a mesma compra ficaria com categorias diferentes entre os meses
    sem o usuário perceber."""
    if not db.execute("SELECT 1 FROM parcelamentos WHERE id = ?", (parcelamento_id,)).fetchone():
        raise HTTPException(404, "Parcelamento não encontrado")
    try:
        db.execute("UPDATE parcelamentos SET categoria_id = ? WHERE id = ?", (body.categoria_id, parcelamento_id))
        cur = db.execute(
            "UPDATE lancamentos_variaveis SET categoria_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE parcelamento_id = ?",
            (body.categoria_id, parcelamento_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "categoria_id inexistente")
    return {"ok": True, "parcelas_atualizadas": cur.rowcount}


@router.delete("/parcelado/{parcelamento_id}")
def excluir_parcelado(parcelamento_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Exclui a compra parcelada inteira — todas as parcelas, passadas e futuras.
    Para tirar só um mês, exclua a parcela como um lançamento comum."""
    removidas = db.execute(
        "DELETE FROM lancamentos_variaveis WHERE parcelamento_id = ?", (parcelamento_id,)
    ).rowcount
    cur = db.execute("DELETE FROM parcelamentos WHERE id = ?", (parcelamento_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Parcelamento não encontrado")
    return {"ok": True, "parcelas_removidas": removidas}


@router.post("", status_code=201)
def criar(body: VariavelIn, db: sqlite3.Connection = Depends(get_db)):
    try:
        cur = db.execute(
            """INSERT INTO lancamentos_variaveis (descricao, categoria_id, valor_cents, data, forma_pagamento, anexo_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (body.descricao, body.categoria_id, body.valor_cents, body.data, body.forma_pagamento, body.anexo_id),
        )
    except sqlite3.IntegrityError:
        # Mesma regra do /parcelado: FK inexistente é erro do chamador, não 500.
        raise HTTPException(400, "categoria_id ou anexo_id inexistente")
    return {"id": cur.lastrowid}


@router.patch("/{lancamento_id}")
def editar(lancamento_id: int, body: VariavelPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = body.model_dump(exclude_unset=True)  # atualização parcial (anexo e/ou categoria)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    sets = ", ".join(f"{c} = ?" for c in campos)
    try:
        cur = db.execute(
            f"UPDATE lancamentos_variaveis SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
            (*campos.values(), lancamento_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "categoria_id ou anexo_id inexistente")
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}


@router.delete("/{lancamento_id}")
def excluir(lancamento_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM lancamentos_variaveis WHERE id = ?", (lancamento_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Lançamento não encontrado")
    return {"ok": True}
