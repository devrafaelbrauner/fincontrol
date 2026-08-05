import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..util import DataISO, hoje

router = APIRouter(prefix="/metas", tags=["metas"])


class MetaIn(BaseModel):
    nome: str
    valor_total_cents: int = Field(gt=0)
    # Prazo malformado não é só um dado torto: `_meses_restantes` faz int(prazo[:4])
    # e derrubaria a listagem inteira de metas com 500.
    prazo: DataISO
    estrategia_texto: str | None = None


class MetaPatch(BaseModel):
    nome: str | None = None
    valor_total_cents: int | None = Field(default=None, gt=0)
    prazo: DataISO | None = None
    estrategia_texto: str | None = None
    ativa: bool | None = None


class AporteIn(BaseModel):
    valor_cents: int = Field(gt=0)
    data: DataISO | None = None  # default: hoje
    observacao: str | None = None


class ItemIn(BaseModel):
    nome: str
    valor_cents: int = Field(ge=0)
    descricao: str | None = None


class ItemPatch(BaseModel):
    nome: str | None = None
    valor_cents: int | None = Field(default=None, ge=0)
    descricao: str | None = None


# `model_dump(exclude_unset=True)` preserva um null enviado de propósito ({"nome": null}),
# e escrevê-lo numa coluna NOT NULL estoura IntegrityError — 500 onde cabia 422. Estas são
# as colunas editáveis que o schema declara NOT NULL.
NAO_NULAVEIS_META = frozenset({"nome", "valor_total_cents", "prazo", "ativa"})
NAO_NULAVEIS_ITEM = frozenset({"nome", "valor_cents"})


def _recusar_nulos(campos: dict, nao_nulaveis: frozenset[str]) -> None:
    nulos = sorted(c for c in campos if c in nao_nulaveis and campos[c] is None)
    if nulos:
        raise HTTPException(422, f"Campo não pode ser nulo: {', '.join(nulos)}")


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
    itens = db.execute("SELECT * FROM metas_itens ORDER BY id").fetchall()
    por_meta: dict[int, list[dict]] = {}
    for i in itens:
        por_meta.setdefault(i["meta_id"], []).append(dict(i))
    out = []
    for r in rows:
        d = dict(r)
        faltante = max(d["valor_total_cents"] - d["valor_atual_cents"], 0)
        d["valor_mensal_necessario_cents"] = faltante // _meses_restantes(d["prazo"])
        d["itens"] = por_meta.get(d["id"], [])
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
    _recusar_nulos(campos, NAO_NULAVEIS_META)
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


# ---------- itens de planejamento ----------

@router.post("/{meta_id}/itens", status_code=201)
def criar_item(meta_id: int, body: ItemIn, db: sqlite3.Connection = Depends(get_db)):
    if not db.execute("SELECT 1 FROM metas WHERE id = ?", (meta_id,)).fetchone():
        raise HTTPException(404, "Meta não encontrada")
    if not body.nome.strip():
        raise HTTPException(422, "Informe o nome do item")
    cur = db.execute(
        "INSERT INTO metas_itens (meta_id, nome, valor_cents, descricao) VALUES (?, ?, ?, ?)",
        (meta_id, body.nome.strip(), body.valor_cents, body.descricao),
    )
    return {"id": cur.lastrowid}


# Colunas que o PATCH pode escrever. O SET é montado por interpolação, então o
# nome da coluna nunca pode vir de fora: hoje as chaves são as do ItemPatch, mas
# um campo novo no modelo (ou um model_dump que passe a incluir extras) viraria
# SQL direto. A lista fecha isso na origem.
COLUNAS_EDITAVEIS = frozenset({"nome", "valor_cents", "descricao"})


@router.patch("/{meta_id}/itens/{item_id}")
def editar_item(meta_id: int, item_id: int, body: ItemPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = {c: v for c, v in body.model_dump(exclude_unset=True).items() if c in COLUNAS_EDITAVEIS}
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    _recusar_nulos(campos, NAO_NULAVEIS_ITEM)
    if "nome" in campos:  # mesma validação que o POST faz, senão "   " vira um nome vazio na lista
        campos["nome"] = campos["nome"].strip()
        if not campos["nome"]:
            raise HTTPException(422, "Informe o nome do item")
    sets = ", ".join(f"{c} = ?" for c in campos)
    cur = db.execute(
        f"UPDATE metas_itens SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND meta_id = ?",
        (*campos.values(), item_id, meta_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "Item não encontrado")
    return {"ok": True}


@router.delete("/{meta_id}/itens/{item_id}")
def excluir_item(meta_id: int, item_id: int, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM metas_itens WHERE id = ? AND meta_id = ?", (item_id, meta_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "Item não encontrado")
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
