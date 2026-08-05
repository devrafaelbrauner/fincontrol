"""Fases 3 e 4: as três frentes de IA sobre compromissos.

Aqui o `openrouter.chamar`/`chamar_json` é sempre falsificado — o que se testa é
o que o app faz com a resposta do modelo, não o modelo. E a régua é a mesma do
resto do app: **o que vem do modelo é suspeito até provar o contrário**, então
id inventado, data torta e valor ilegível são descartados em vez de gravados.
"""

from datetime import timedelta

import pytest

from app import openrouter
from app.db import connect
from app.util import hoje

from .conftest import limpar_movimento


@pytest.fixture
def db():
    conn = connect()
    limpar_movimento(conn)
    yield conn
    conn.close()


def em(dias: int) -> str:
    return (hoje() + timedelta(days=dias)).isoformat()


def criar(autenticado, **campos):
    corpo = {"nome": "IPVA", "valor_total_cents": 120_000, "data_limite": em(30)} | campos
    r = autenticado.post("/api/compromissos", json=corpo)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def ia(monkeypatch):
    """Substitui a chamada de rede. `resposta` é o que o 'modelo' devolve."""
    estado = {"texto": "Diagnóstico: cabe.", "json": {}, "chamadas": 0, "ctx": ""}

    def falso_chamar(_db, mensagens, espera_json=True, max_tokens=1500):
        estado["chamadas"] += 1
        estado["ctx"] = mensagens[-1]["content"]
        return estado["texto"]

    def falso_json(_db, mensagens, max_tokens=1500):
        estado["chamadas"] += 1
        estado["ctx"] = mensagens[-1]["content"]
        return estado["json"]

    monkeypatch.setattr(openrouter, "chamar", falso_chamar)
    monkeypatch.setattr(openrouter, "chamar_json", falso_json)
    return estado


# ---------- orientação (Fase 3) ----------

def test_orientacao_salva_no_compromisso(db, autenticado, ia):
    cid = criar(autenticado)
    ia["texto"] = "Diagnóstico: sobra R$ 800/mês.\nPrimeiro passo: separar hoje."

    r = autenticado.post(f"/api/ia/orientacao-compromisso/{cid}")
    assert r.status_code == 200, r.text
    assert "Primeiro passo" in r.json()["orientacao"]
    assert autenticado.get(f"/api/compromissos/{cid}").json()["orientacao_texto"] == ia["texto"]


def test_orientacao_manda_o_que_falta_e_nao_o_total(db, autenticado, ia):
    cid = criar(autenticado, valor_total_cents=120_000)
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 90_000})

    autenticado.post(f"/api/ia/orientacao-compromisso/{cid}")
    assert "FALTA R$ 300.00" in ia["ctx"], ia["ctx"]


def test_orientacao_em_quitado_nao_chama_a_ia(db, autenticado, ia):
    """Pagar uma chamada para dizer "não faça nada" é queimar dinheiro do dono."""
    cid = criar(autenticado, valor_total_cents=100_000)
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 100_000})

    r = autenticado.post(f"/api/ia/orientacao-compromisso/{cid}")
    assert r.status_code == 400
    assert ia["chamadas"] == 0


def test_orientacao_em_inexistente_e_404(db, autenticado, ia):
    assert autenticado.post("/api/ia/orientacao-compromisso/99999").status_code == 404
    assert ia["chamadas"] == 0


# ---------- priorização (Fase 3) ----------

def test_priorizacao_ordena_e_devolve_motivos(db, autenticado, ia):
    a = criar(autenticado, nome="A", data_limite=em(10))
    b = criar(autenticado, nome="B", data_limite=em(60))
    ia["json"] = {"ordem": [{"id": b, "posicao": 2, "motivo": "prazo longo"},
                            {"id": a, "posicao": 1, "motivo": "vence antes"}],
                  "resumo": "Ataque o mais próximo."}

    r = autenticado.post("/api/ia/priorizar-compromissos").json()
    assert [o["id"] for o in r["ordem"]] == [a, b]
    assert [o["posicao"] for o in r["ordem"]] == [1, 2]
    assert r["resumo"] == "Ataque o mais próximo."
    assert r["sem_posicao"] == []


def test_priorizacao_descarta_id_inventado_e_reporta_o_esquecido(db, autenticado, ia):
    a = criar(autenticado, nome="A", data_limite=em(10))
    b = criar(autenticado, nome="B", data_limite=em(60))
    # O modelo inventou um id e esqueceu o B.
    ia["json"] = {"ordem": [{"id": a, "posicao": 1, "motivo": "ok"},
                            {"id": 98765, "posicao": 2, "motivo": "fantasma"}],
                  "resumo": "x"}

    r = autenticado.post("/api/ia/priorizar-compromissos").json()
    assert [o["id"] for o in r["ordem"]] == [a]
    assert r["sem_posicao"] == [b], "quem o modelo esqueceu tem que aparecer, não sumir"


def test_priorizacao_ignora_posicao_repetida(db, autenticado, ia):
    a = criar(autenticado, nome="A", data_limite=em(10))
    b = criar(autenticado, nome="B", data_limite=em(60))
    ia["json"] = {"ordem": [{"id": a, "posicao": 1, "motivo": "x"},
                            {"id": b, "posicao": 1, "motivo": "y"}], "resumo": ""}

    r = autenticado.post("/api/ia/priorizar-compromissos").json()
    # A posição é reconstruída aqui, não copiada do modelo.
    assert [o["posicao"] for o in r["ordem"]] == [1, 2]


def test_priorizacao_exige_dois_em_aberto(db, autenticado, ia):
    criar(autenticado)
    r = autenticado.post("/api/ia/priorizar-compromissos")
    assert r.status_code == 400
    assert ia["chamadas"] == 0


# ---------- plano de quitação (Fase 4) ----------

def test_plano_devolve_parcelas_ordenadas_e_a_diferenca(db, autenticado, ia):
    cid = criar(autenticado, valor_total_cents=90_000)
    ia["json"] = {"parcelas": [{"data": em(60), "valor_cents": 30_000},
                               {"data": em(30), "valor_cents": 30_000},
                               {"data": em(90), "valor_cents": 30_000}],
                  "analise": "Cabe na sobra."}

    r = autenticado.post(f"/api/ia/plano-compromisso/{cid}").json()
    assert [p["data"] for p in r["parcelas"]] == [em(30), em(60), em(90)]
    assert r["soma_cents"] == 90_000
    assert r["falta_cents"] == 90_000
    assert r["diferenca_cents"] == 0


def test_plano_descarta_parcela_com_data_ou_valor_invalido(db, autenticado, ia):
    """Mesma régua do PR #33: valor ilegível ou data fora do padrão não entra —
    gravar R$ 0,00 ou uma data que some dos recortes é pior que omitir."""
    cid = criar(autenticado, valor_total_cents=100_000)
    ia["json"] = {"parcelas": [
        {"data": em(30), "valor_cents": 50_000},     # ok
        {"data": "30/09/2026", "valor_cents": 20_000},  # formato brasileiro
        {"data": em(60), "valor_cents": "R$ 200,00"},   # valor formatado
        {"data": em(90), "valor_cents": 0},             # zero
        {"data": em(120), "valor_cents": 25_000},    # ok
    ], "analise": ""}

    r = autenticado.post(f"/api/ia/plano-compromisso/{cid}").json()
    assert [p["valor_cents"] for p in r["parcelas"]] == [50_000, 25_000]
    assert r["soma_cents"] == 75_000
    # A diferença é mostrada em vez de o plano fingir que cobre tudo.
    assert r["diferenca_cents"] == 25_000


def test_plano_nao_grava_nada(db, autenticado, ia):
    cid = criar(autenticado, valor_total_cents=90_000)
    ia["json"] = {"parcelas": [{"data": em(30), "valor_cents": 90_000}], "analise": ""}

    autenticado.post(f"/api/ia/plano-compromisso/{cid}")
    assert autenticado.get(f"/api/compromissos/{cid}").json()["pago_cents"] == 0
    assert db.execute("SELECT COUNT(*) n FROM lancamentos_variaveis").fetchone()["n"] == 0


# ---------- contexto compartilhado ----------

def test_contexto_financeiro_inclui_compromissos_em_aberto(db, autenticado, ia):
    """Sem isto, o assistente e os insights sugeririam guardar dinheiro que já
    está comprometido."""
    criar(autenticado, nome="Dívida do contexto", credor="João", data_limite=em(20))

    autenticado.post("/api/ia/perguntar", json={"pergunta": "e aí?"})
    assert "Compromissos em aberto" in ia["ctx"]
    assert "Dívida do contexto" in ia["ctx"] and "João" in ia["ctx"]


def test_contexto_omite_compromisso_quitado(db, autenticado, ia):
    cid = criar(autenticado, nome="Quitado ctx", valor_total_cents=100_000)
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 100_000})

    autenticado.post("/api/ia/perguntar", json={"pergunta": "e aí?"})
    assert "Quitado ctx" not in ia["ctx"]
