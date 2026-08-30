"""Compromissos financeiros: CRUD, pagamento parcial e a integração que é o
ponto do recurso — o pagamento é um lançamento variável de verdade, então ele
aparece no mês, no orçamento e nas análises sem nada além do vínculo.
"""

from datetime import timedelta

import pytest

from app.db import connect
from app.util import hoje


@pytest.fixture
def db():
    conn = connect()
    for t in ("lancamentos_variaveis", "compromissos", "orcamentos"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    yield conn
    conn.close()


def cat(db, nome, tipo="variavel"):
    cur = db.execute("INSERT INTO categorias (nome, tipo) VALUES (?, ?)", (nome, tipo))
    db.commit()
    return cur.lastrowid


def em(dias: int) -> str:
    return (hoje() + timedelta(days=dias)).isoformat()


def criar(autenticado, **campos):
    corpo = {"nome": "IPVA", "valor_total_cents": 120_000, "data_limite": em(30)} | campos
    r = autenticado.post("/api/compromissos", json=corpo)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_crud(db, autenticado):
    cid = criar(autenticado, nome="IPVA 2026", credor="Detran", valor_total_cents=120_000)

    lista = autenticado.get("/api/compromissos").json()
    assert len(lista) == 1
    assert lista[0]["nome"] == "IPVA 2026"
    assert lista[0]["credor"] == "Detran"
    assert lista[0]["valor_total_cents"] == 120_000
    assert lista[0]["pago_cents"] == 0
    assert lista[0]["falta_cents"] == 120_000
    assert lista[0]["status"] == "em_aberto"

    assert autenticado.patch(f"/api/compromissos/{cid}", json={"valor_total_cents": 130_000}).status_code == 200
    assert autenticado.get(f"/api/compromissos/{cid}").json()["falta_cents"] == 130_000

    assert autenticado.delete(f"/api/compromissos/{cid}").status_code == 200
    assert autenticado.get("/api/compromissos").json() == []
    assert autenticado.delete(f"/api/compromissos/{cid}").status_code == 404
    assert autenticado.get(f"/api/compromissos/{cid}").status_code == 404


def test_pagamento_parcial_soma_e_quita(db, autenticado):
    cid = criar(autenticado, valor_total_cents=120_000)

    assert autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 40_000}).status_code == 201
    c = autenticado.get(f"/api/compromissos/{cid}").json()
    assert (c["pago_cents"], c["falta_cents"], c["status"]) == (40_000, 80_000, "em_aberto")

    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 80_000})
    c = autenticado.get(f"/api/compromissos/{cid}").json()
    assert (c["pago_cents"], c["falta_cents"], c["status"]) == (120_000, 0, "quitado")

    # Pagar além do total (acordo corrigido) não é erro; falta não fica negativo.
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 5_000})
    c = autenticado.get(f"/api/compromissos/{cid}").json()
    assert (c["pago_cents"], c["falta_cents"], c["status"]) == (125_000, 0, "quitado")

    assert len(autenticado.get(f"/api/compromissos/{cid}/pagamentos").json()) == 3


def test_pagamento_e_um_gasto_do_mes_de_verdade(db, autenticado):
    """O ponto do recurso: sem código novo, o pagamento entra na lista de
    variáveis, no total do mês do dashboard e no orçamento da categoria."""
    mercado = cat(db, "Acordo cat")
    autenticado.put(f"/api/orcamentos/{mercado}", json={"limite_cents": 100_000})
    cid = criar(autenticado, categoria_id=mercado, valor_total_cents=90_000)

    h = hoje().isoformat()
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 30_000, "data": h})

    variaveis = autenticado.get("/api/variaveis").json()
    assert [(v["descricao"], v["valor_cents"], v["categoria_id"]) for v in variaveis["itens"]] == [
        ("IPVA", 30_000, mercado)
    ]
    assert variaveis["itens"][0]["compromisso_id"] == cid

    comp = h[:7]
    assert autenticado.get(f"/api/dashboard/{comp}").json()["variaveis_cents"] == 30_000

    orc = autenticado.get("/api/orcamentos", params={"competencia": comp}).json()
    assert [o["gasto_cents"] for o in orc if o["categoria_id"] == mercado] == [30_000]


def test_pagamento_herda_categoria_e_forma_do_compromisso(db, autenticado):
    c = cat(db, "Herança cat")
    cid = criar(autenticado, categoria_id=c, forma_pagamento="boleto")

    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 1_000})
    # E o pagamento pode sobrescrever a forma, sem mexer no compromisso:
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 1_000, "forma_pagamento": "pix"})

    pgs = autenticado.get(f"/api/compromissos/{cid}/pagamentos").json()
    assert {p["forma_pagamento"] for p in pgs} == {"boleto", "pix"}
    assert {p["categoria_id"] for p in pgs} == {c}
    assert autenticado.get(f"/api/compromissos/{cid}").json()["forma_pagamento"] == "boleto"


def test_excluir_compromisso_preserva_o_dinheiro_que_saiu(db, autenticado):
    """Apagar a linha da aba não pode reescrever o gasto de um mês fechado."""
    cid = criar(autenticado)
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 40_000})

    r = autenticado.delete(f"/api/compromissos/{cid}")
    assert r.json()["pagamentos_desvinculados"] == 1

    itens = autenticado.get("/api/variaveis").json()["itens"]
    assert len(itens) == 1
    assert itens[0]["valor_cents"] == 40_000
    assert itens[0]["compromisso_id"] is None


def test_status_atrasado_e_arquivamento(db, autenticado):
    vencido = criar(autenticado, nome="Vencido", data_limite=em(-1))
    assert autenticado.get(f"/api/compromissos/{vencido}").json()["status"] == "atrasado"

    # Quitado nunca é "atrasado", mesmo passado do prazo:
    autenticado.post(f"/api/compromissos/{vencido}/pagamentos", json={"valor_cents": 120_000})
    assert autenticado.get(f"/api/compromissos/{vencido}").json()["status"] == "quitado"

    autenticado.patch(f"/api/compromissos/{vencido}", json={"ativo": False})
    assert autenticado.get("/api/compromissos").json() == []
    arq = autenticado.get("/api/compromissos", params={"incluir_arquivados": True}).json()
    assert [c["nome"] for c in arq] == ["Vencido"]
    assert arq[0]["ativo"] is False


def test_ordena_por_vencimento(db, autenticado):
    criar(autenticado, nome="Depois", data_limite=em(60))
    criar(autenticado, nome="Antes", data_limite=em(5))
    criar(autenticado, nome="Meio", data_limite=em(30))

    assert [c["nome"] for c in autenticado.get("/api/compromissos").json()] == ["Antes", "Meio", "Depois"]


# ---------- validação ----------

def test_data_limite_invalida_e_422(db, autenticado):
    for data in ("15/08/2026", "banana", "2026-13-01", "2026-8-5"):
        r = autenticado.post("/api/compromissos",
                             json={"nome": "X", "valor_total_cents": 1000, "data_limite": data})
        assert r.status_code == 422, (data, r.text)


def test_fk_inexistente_e_400_e_nao_500(db, autenticado):
    r = autenticado.post("/api/compromissos", json={
        "nome": "X", "valor_total_cents": 1000, "data_limite": em(10), "categoria_id": 99_999})
    assert r.status_code == 400, r.text

    cid = criar(autenticado)
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"categoria_id": 99_999}).status_code == 400
    r = autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 100, "anexo_id": 99_999})
    assert r.status_code == 400, r.text


def test_forma_pagamento_fora_da_lista_e_422_e_nao_500(db, autenticado):
    """A coluna tem CHECK: sem a validação no router isto viraria IntegrityError."""
    r = autenticado.post("/api/compromissos", json={
        "nome": "X", "valor_total_cents": 1000, "data_limite": em(10), "forma_pagamento": "cheque"})
    assert r.status_code == 422, r.text

    cid = criar(autenticado)
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"forma_pagamento": "cheque"}).status_code == 422
    r = autenticado.post(f"/api/compromissos/{cid}/pagamentos",
                         json={"valor_cents": 100, "forma_pagamento": "cheque"})
    assert r.status_code == 422, r.text


def test_campos_obrigatorios_e_patch_vazio(db, autenticado):
    assert autenticado.post("/api/compromissos", json={
        "nome": "   ", "valor_total_cents": 1000, "data_limite": em(10)}).status_code == 422
    assert autenticado.post("/api/compromissos", json={
        "nome": "X", "valor_total_cents": 0, "data_limite": em(10)}).status_code == 422

    cid = criar(autenticado)
    assert autenticado.patch(f"/api/compromissos/{cid}", json={}).status_code == 400
    # Null explícito em coluna NOT NULL é 422, não 500:
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"nome": None}).status_code == 422
    # Já um campo opcional aceita null (tirar o credor):
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"credor": None}).status_code == 200
    # Desde a migration 014, valor e prazo também: mandar null é como se apaga um
    # palpite que não vale mais. Este assert já valeu o contrário — o campo era
    # NOT NULL e a resposta, 422.
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"valor_total_cents": None}).status_code == 200
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"data_limite": None}).status_code == 200


def test_pagamento_em_compromisso_inexistente_e_404(db, autenticado):
    assert autenticado.post("/api/compromissos/99999/pagamentos", json={"valor_cents": 100}).status_code == 404
    assert autenticado.get("/api/compromissos/99999/pagamentos").status_code == 404


# ---------- só o nome é obrigatório (migration 014) ----------

def test_so_o_nome_e_obrigatorio(db, autenticado):
    """Registrar a dívida antes de saber quanto e até quando."""
    r = autenticado.post("/api/compromissos", json={"nome": "Acerto com o João"})
    assert r.status_code == 201, r.text
    c = autenticado.get(f"/api/compromissos/{r.json()['id']}").json()
    assert c["valor_total_cents"] is None
    assert c["data_limite"] is None
    # `falta_cents` NÃO é 0: zero se lê como quitado, e é o oposto de "não sei".
    assert c["falta_cents"] is None
    # Sem prazo não existe atraso; sem total não dá para dizer que quitou.
    assert c["status"] == "em_aberto"


def test_valor_invalido_continua_recusado(db, autenticado):
    """Opcional é diferente de "aceita qualquer coisa": o CHECK > 0 sobrevive à
    reconstrução da tabela, e só deixa de morder quando o valor está ausente."""
    assert autenticado.post("/api/compromissos", json={"nome": "X", "valor_total_cents": 0}).status_code == 422
    assert autenticado.post("/api/compromissos", json={"nome": "X", "valor_total_cents": -50}).status_code == 422
    assert autenticado.post("/api/compromissos", json={"nome": "X", "data_limite": "31/12/2026"}).status_code == 422


def test_sem_prazo_vai_para_o_fim_da_lista(db, autenticado):
    """No SQLite NULL ordena ANTES de tudo — sem cuidado no ORDER BY, o
    compromisso sem prazo apareceria acima do que vence amanhã."""
    criar(autenticado, nome="Sem prazo", data_limite=None)
    criar(autenticado, nome="Urgente", data_limite=em(1))
    nomes = [c["nome"] for c in autenticado.get("/api/compromissos").json()]
    assert nomes == ["Urgente", "Sem prazo"]


def test_pagamento_em_compromisso_sem_valor_nao_quita(db, autenticado):
    """Pagar R$ 50 de um total desconhecido não fecha nada."""
    cid = criar(autenticado, nome="Dívida", valor_total_cents=None)
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 5_000})
    c = autenticado.get(f"/api/compromissos/{cid}").json()
    assert c["pago_cents"] == 5_000
    assert c["falta_cents"] is None
    assert c["status"] == "em_aberto"


def test_incompletos_nao_derrubam_as_telas_que_os_leem(db, autenticado):
    """Regressão dos TypeError: `None` em aritmética ou em `date.fromisoformat`
    derrubava busca, dashboard, .ics e lembretes com 500. Cada rota abaixo já
    quebrou com um destes três compromissos."""
    criar(autenticado, nome="Sem nada", valor_total_cents=None, data_limite=None)
    criar(autenticado, nome="Sem valor", valor_total_cents=None, data_limite=em(3))
    criar(autenticado, nome="Sem prazo", valor_total_cents=90_000, data_limite=None)

    # busca: `falta_cents <= 0` era TypeError
    r = autenticado.get("/api/busca?q=sem")
    assert r.status_code == 200, r.text
    assert {i["descricao"] for i in r.json()["itens"]} >= {"Sem nada", "Sem valor", "Sem prazo"}

    # dashboard: o que vence no mês sem valor precisa APARECER, não sumir
    h = hoje()
    r = autenticado.get(f"/api/dashboard/{h.year:04d}-{h.month:02d}")
    assert r.status_code == 200, r.text

    # .ics: `date.fromisoformat(None)` levanta TypeError, que o except ValueError
    # de lá não pegava
    from app.ics import gerar_feed
    assert "BEGIN:VCALENDAR" in gerar_feed(db)

    # lembretes: mesmo TypeError, no job diário
    from app.lembretes import pendencias_compromissos
    pend = pendencias_compromissos(db)
    assert all(p["vencimento"] is not None for p in pend)
    # o de daqui a 3 dias entra sem valor definido, em vez de ser omitido
    assert any(p["nome"] == "Sem valor" and p["falta_cents"] is None for p in pend)
