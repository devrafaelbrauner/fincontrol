"""Otimização de Recursos: onde o dinheiro ESTÁ, e como isso muda.

O resto do app rastreia fluxo; aqui é estoque. Ver a migration 012 para o porquê
de os dois eixos serem independentes.

**Nada de variação é armazenado.** `saldo_anterior`, `variacao_cents` e
`variacao_pct` saem sempre da comparação entre as duas leituras mais recentes —
mesma regra que o schema aplica a status de pagamento, e o que garante que
corrigir uma leitura errada recalcule tudo em vez de deixar número velho para trás.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from ..db import get_db
from ..util import agora_iso

router = APIRouter(prefix="/contas-bancarias", tags=["contas-bancarias"])


class ContaIn(BaseModel):
    banco: str
    nome: str
    # Opcional: sem ele a conta nasce sem leitura nenhuma e aparece como
    # "sem saldo registrado", em vez de fingir que tem R$ 0,00.
    saldo_inicial_cents: int | None = None


class ContaPatch(BaseModel):
    banco: str | None = None
    nome: str | None = None
    ativa: bool | None = None


class SaldoIn(BaseModel):
    """Aceita o novo saldo OU o quanto mudou — nunca os dois.

    O delta é aplicado NO SERVIDOR, sobre a leitura mais recente. Deixar o
    cliente calcular o absoluto abriria a porta para ele somar em cima de um
    saldo que já mudou noutro aparelho, gravando um total errado sem erro nenhum.
    """
    valor_cents: int | None = None
    delta_cents: int | None = None
    observacao: str | None = None

    @model_validator(mode="after")
    def _exatamente_um(self):
        if (self.valor_cents is None) == (self.delta_cents is None):
            raise ValueError("Informe valor_cents (novo saldo) ou delta_cents (quanto mudou), não ambos")
        return self


def _variacao(atual: int, anterior: int | None) -> tuple[int | None, float | None]:
    """Variação em valor e em %, a partir da leitura anterior.

    Sem leitura anterior, as duas são None — não zero: "não houve variação" e
    "não há com o que comparar" são coisas diferentes na tela.

    O percentual é None quando o anterior é zero, pela mesma razão que
    `historico.ts` já adota: sair de R$ 0,00 não tem variação percentual
    definível. O denominador usa o VALOR ABSOLUTO do anterior, então sair de
    −100 para −50 é +50% (melhorou), e não −50%.
    """
    if anterior is None:
        return None, None
    delta = atual - anterior
    if anterior == 0:
        return delta, None
    return delta, round(delta / abs(anterior) * 100, 1)


# As duas leituras mais recentes de cada conta, numeradas. Uma consulta só para
# a listagem inteira — com uma por conta, a tela viraria N+1 consultas.
_ULTIMAS_DUAS = """
    SELECT conta_id, valor_cents, registrado_em,
           ROW_NUMBER() OVER (PARTITION BY conta_id ORDER BY registrado_em DESC, id DESC) AS pos
    FROM saldos_conta
"""


def _leituras(db: sqlite3.Connection) -> dict[int, list[sqlite3.Row]]:
    por_conta: dict[int, list[sqlite3.Row]] = {}
    for r in db.execute(f"SELECT * FROM ({_ULTIMAS_DUAS}) WHERE pos <= 2 ORDER BY conta_id, pos"):
        por_conta.setdefault(r["conta_id"], []).append(r)
    return por_conta


def _conta_com_saldo(c: sqlite3.Row, leituras: list[sqlite3.Row]) -> dict:
    atual = leituras[0]["valor_cents"] if leituras else None
    anterior = leituras[1]["valor_cents"] if len(leituras) > 1 else None
    variacao, pct = _variacao(atual, anterior) if atual is not None else (None, None)
    return {
        "id": c["id"],
        "banco": c["banco"],
        "nome": c["nome"],
        "ativa": bool(c["ativa"]),
        "saldo_cents": atual,
        "saldo_anterior_cents": anterior,
        "variacao_cents": variacao,
        "variacao_pct": pct,
        "atualizado_em": leituras[0]["registrado_em"] if leituras else None,
    }


@router.get("")
def listar(incluir_arquivadas: bool = False, db: sqlite3.Connection = Depends(get_db)):
    """Contas, saldos, variações e a distribuição do total entre elas."""
    where = "" if incluir_arquivadas else "WHERE ativa = 1"
    contas = db.execute(f"SELECT * FROM contas_bancarias {where} ORDER BY banco, nome").fetchall()
    leituras = _leituras(db)
    itens = [_conta_com_saldo(c, leituras.get(c["id"], [])) for c in contas]

    total = sum(i["saldo_cents"] or 0 for i in itens)
    for i in itens:
        # Distribuição: com total zero (ou uma carteira que se anula entre
        # positivo e negativo) não existe fatia — é o mesmo ÷0 do percentual.
        i["pct_do_total"] = (
            None if total == 0 or i["saldo_cents"] is None
            else round(i["saldo_cents"] / total * 100, 1)
        )

    # Variação consolidada: só entram as contas que têm com o que comparar.
    com_variacao = [i for i in itens if i["variacao_cents"] is not None]
    total_anterior = sum((i["saldo_anterior_cents"] or 0) for i in com_variacao)
    total_agora = sum((i["saldo_cents"] or 0) for i in com_variacao)
    variacao_total, pct_total = _variacao(total_agora, total_anterior if com_variacao else None)

    return {
        "itens": itens,
        "total_cents": total,
        "variacao_total_cents": variacao_total,
        "variacao_total_pct": pct_total,
        "contas_sem_saldo": sum(1 for i in itens if i["saldo_cents"] is None),
    }


@router.post("", status_code=201)
def criar(body: ContaIn, db: sqlite3.Connection = Depends(get_db)):
    banco, nome = body.banco.strip(), body.nome.strip()
    if not banco or not nome:
        raise HTTPException(422, "Informe o banco e o nome da conta")
    try:
        cur = db.execute("INSERT INTO contas_bancarias (banco, nome) VALUES (?, ?)", (banco, nome))
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Já existe uma conta '{nome}' no {banco}")
    conta_id = cur.lastrowid
    if body.saldo_inicial_cents is not None:
        db.execute(
            "INSERT INTO saldos_conta (conta_id, valor_cents, registrado_em, observacao) VALUES (?, ?, ?, ?)",
            (conta_id, body.saldo_inicial_cents, agora_iso(), "Saldo inicial"),
        )
    return {"id": conta_id}


@router.patch("/{conta_id}")
def editar(conta_id: int, body: ContaPatch, db: sqlite3.Connection = Depends(get_db)):
    campos = body.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(400, "Nada para atualizar")
    for c in ("banco", "nome"):
        if c in campos:
            if campos[c] is None or not campos[c].strip():
                raise HTTPException(422, f"'{c}' não pode ficar vazio")
            campos[c] = campos[c].strip()
    if "ativa" in campos:
        if campos["ativa"] is None:
            raise HTTPException(422, "'ativa' não pode ser nulo")
        campos["ativa"] = 1 if campos["ativa"] else 0
    sets = ", ".join(f"{c} = ?" for c in campos)  # chaves são as do ContaPatch, nunca externas
    try:
        cur = db.execute(
            f"UPDATE contas_bancarias SET {sets}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
            (*campos.values(), conta_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Já existe uma conta com esse banco e nome")
    if cur.rowcount == 0:
        raise HTTPException(404, "Conta não encontrada")
    return {"ok": True}


@router.delete("/{conta_id}")
def excluir(conta_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Apaga a conta e todo o histórico dela (ON DELETE CASCADE).

    Diferente do compromisso, aqui não há nada a preservar em outra tela: as
    leituras de saldo só existem para esta conta. Para guardar o histórico sem
    ver a conta na lista, arquive (`ativa = 0`).
    """
    cur = db.execute("DELETE FROM contas_bancarias WHERE id = ?", (conta_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Conta não encontrada")
    return {"ok": True}


# ---------- leituras de saldo ----------

def _ultimo_saldo(db: sqlite3.Connection, conta_id: int) -> sqlite3.Row | None:
    return db.execute(
        "SELECT * FROM saldos_conta WHERE conta_id = ? ORDER BY registrado_em DESC, id DESC LIMIT 1",
        (conta_id,),
    ).fetchone()


@router.post("/{conta_id}/saldos", status_code=201)
def atualizar_saldo(conta_id: int, body: SaldoIn, db: sqlite3.Connection = Depends(get_db)):
    if not db.execute("SELECT 1 FROM contas_bancarias WHERE id = ?", (conta_id,)).fetchone():
        raise HTTPException(404, "Conta não encontrada")
    ultimo = _ultimo_saldo(db, conta_id)
    if body.valor_cents is not None:
        novo = body.valor_cents
    else:
        if ultimo is None:
            raise HTTPException(
                400, "Esta conta ainda não tem saldo registrado — informe o valor, não a variação"
            )
        novo = ultimo["valor_cents"] + body.delta_cents
    cur = db.execute(
        "INSERT INTO saldos_conta (conta_id, valor_cents, registrado_em, observacao) VALUES (?, ?, ?, ?)",
        (conta_id, novo, agora_iso(), (body.observacao or "").strip() or None),
    )
    variacao, pct = _variacao(novo, ultimo["valor_cents"] if ultimo else None)
    return {"id": cur.lastrowid, "saldo_cents": novo,
            "variacao_cents": variacao, "variacao_pct": pct}


@router.get("/{conta_id}/saldos")
def historico(conta_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Histórico do mais recente para o mais antigo, com a variação de cada
    leitura em relação à anterior (a mais antiga fica com variação nula)."""
    if not db.execute("SELECT 1 FROM contas_bancarias WHERE id = ?", (conta_id,)).fetchone():
        raise HTTPException(404, "Conta não encontrada")
    linhas = db.execute(
        "SELECT * FROM saldos_conta WHERE conta_id = ? ORDER BY registrado_em DESC, id DESC",
        (conta_id,),
    ).fetchall()
    out = []
    for i, r in enumerate(linhas):
        anterior = linhas[i + 1]["valor_cents"] if i + 1 < len(linhas) else None
        variacao, pct = _variacao(r["valor_cents"], anterior)
        out.append({**dict(r), "variacao_cents": variacao, "variacao_pct": pct})
    return out


@router.delete("/{conta_id}/saldos/{saldo_id}")
def excluir_saldo(conta_id: int, saldo_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Remove uma leitura errada. Como tudo é derivado, apagar a mais recente
    faz o saldo atual voltar a ser a anterior — sem nada a reconciliar."""
    cur = db.execute("DELETE FROM saldos_conta WHERE id = ? AND conta_id = ?", (saldo_id, conta_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "Registro de saldo não encontrado")
    return {"ok": True}
