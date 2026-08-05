"""Otimização de Recursos: saldos por conta, variações e distribuição.

O que este arquivo protege acima de tudo: **nada de variação é armazenado**.
Toda a aritmética sai das duas leituras mais recentes, então corrigir ou apagar
uma leitura tem que recalcular o resto — que é justamente o que uma coluna
`variacao` congelada erraria.
"""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    conn.execute("DELETE FROM saldos_conta")
    conn.execute("DELETE FROM contas_bancarias")
    conn.commit()
    yield conn
    conn.close()


def criar(autenticado, banco="Nubank", nome="Conta corrente", **extra):
    r = autenticado.post("/api/contas-bancarias", json={"banco": banco, "nome": nome, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def saldo(autenticado, conta, **corpo):
    r = autenticado.post(f"/api/contas-bancarias/{conta}/saldos", json=corpo)
    assert r.status_code == 201, r.text
    return r.json()


def listar(autenticado, **params):
    r = autenticado.get("/api/contas-bancarias", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_conta_sem_leitura_nao_finge_ter_zero(db, autenticado):
    """Distinção que a tela precisa: "sem saldo registrado" não é "R$ 0,00"."""
    criar(autenticado)
    r = listar(autenticado)
    c = r["itens"][0]
    assert c["saldo_cents"] is None
    assert c["variacao_cents"] is None and c["variacao_pct"] is None
    assert c["atualizado_em"] is None
    assert r["contas_sem_saldo"] == 1
    assert r["total_cents"] == 0


def test_primeira_leitura_nao_tem_com_o_que_comparar(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=100_000)
    c = listar(autenticado)["itens"][0]
    assert c["saldo_cents"] == 100_000
    assert c["saldo_anterior_cents"] is None
    # None, não zero: "não variou" e "não há anterior" são coisas diferentes.
    assert c["variacao_cents"] is None
    assert c["variacao_pct"] is None
    assert c["atualizado_em"] is not None


def test_variacao_positiva_e_negativa(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=100_000)

    r = saldo(autenticado, conta, valor_cents=125_000)
    assert (r["variacao_cents"], r["variacao_pct"]) == (25_000, 25.0)

    r = saldo(autenticado, conta, valor_cents=100_000)
    assert (r["variacao_cents"], r["variacao_pct"]) == (-25_000, -20.0)

    c = listar(autenticado)["itens"][0]
    assert (c["saldo_cents"], c["saldo_anterior_cents"]) == (100_000, 125_000)
    assert (c["variacao_cents"], c["variacao_pct"]) == (-25_000, -20.0)


def test_delta_e_aplicado_no_servidor(db, autenticado):
    """O cliente manda quanto mudou; quem soma é o servidor, sobre a leitura
    mais recente — somar no cliente gravaria total errado a partir de um saldo
    já desatualizado por outro aparelho."""
    conta = criar(autenticado, saldo_inicial_cents=100_000)

    assert saldo(autenticado, conta, delta_cents=25_000)["saldo_cents"] == 125_000
    assert saldo(autenticado, conta, delta_cents=-50_000)["saldo_cents"] == 75_000


def test_delta_exige_saldo_anterior(db, autenticado):
    conta = criar(autenticado)
    r = autenticado.post(f"/api/contas-bancarias/{conta}/saldos", json={"delta_cents": 1000})
    assert r.status_code == 400, r.text


def test_valor_e_delta_juntos_ou_nenhum_e_422(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=1000)
    for corpo in ({"valor_cents": 1, "delta_cents": 1}, {}):
        r = autenticado.post(f"/api/contas-bancarias/{conta}/saldos", json=corpo)
        assert r.status_code == 422, (corpo, r.text)


def test_saldo_negativo_e_aceito(db, autenticado):
    """Cheque especial existe; recusá-lo obrigaria a mentir o número do banco."""
    conta = criar(autenticado, saldo_inicial_cents=10_000)
    r = saldo(autenticado, conta, valor_cents=-5_000)
    assert r["saldo_cents"] == -5_000
    assert r["variacao_cents"] == -15_000


def test_variacao_percentual_a_partir_de_zero_e_nula(db, autenticado):
    """Mesma convenção do historico.ts: sair de R$ 0,00 não tem % definível —
    e "+100%" seria uma invenção."""
    conta = criar(autenticado, saldo_inicial_cents=0)
    r = saldo(autenticado, conta, valor_cents=50_000)
    assert r["variacao_cents"] == 50_000
    assert r["variacao_pct"] is None


def test_percentual_usa_o_modulo_do_anterior(db, autenticado):
    """Sair de −100 para −50 é melhorar 50%, não piorar."""
    conta = criar(autenticado, saldo_inicial_cents=-10_000)
    r = saldo(autenticado, conta, valor_cents=-5_000)
    assert (r["variacao_cents"], r["variacao_pct"]) == (5_000, 50.0)


def test_total_e_distribuicao(db, autenticado):
    a = criar(autenticado, banco="Nubank", nome="Corrente", saldo_inicial_cents=75_000)
    b = criar(autenticado, banco="Itaú", nome="Reserva", saldo_inicial_cents=25_000)

    r = listar(autenticado)
    assert r["total_cents"] == 100_000
    por_id = {i["id"]: i for i in r["itens"]}
    assert por_id[a]["pct_do_total"] == 75.0
    assert por_id[b]["pct_do_total"] == 25.0


def test_distribuicao_com_total_zero_nao_divide_por_zero(db, autenticado):
    criar(autenticado, banco="A", nome="X", saldo_inicial_cents=0)
    r = listar(autenticado)
    assert r["total_cents"] == 0
    assert r["itens"][0]["pct_do_total"] is None


def test_variacao_consolidada_ignora_contas_sem_comparacao(db, autenticado):
    """Uma conta recém-cadastrada não pode contar como 'ganho' no consolidado."""
    a = criar(autenticado, banco="Nubank", nome="Corrente", saldo_inicial_cents=100_000)
    saldo(autenticado, a, valor_cents=120_000)          # +20.000, tem anterior
    criar(autenticado, banco="Itaú", nome="Nova", saldo_inicial_cents=500_000)  # sem anterior

    r = listar(autenticado)
    assert r["total_cents"] == 620_000
    assert r["variacao_total_cents"] == 20_000, "os 500.000 da conta nova não são variação"
    assert r["variacao_total_pct"] == 20.0


def test_historico_traz_a_variacao_de_cada_leitura(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=100_000)
    saldo(autenticado, conta, valor_cents=110_000)
    saldo(autenticado, conta, valor_cents=90_000)

    h = autenticado.get(f"/api/contas-bancarias/{conta}/saldos").json()
    assert [x["valor_cents"] for x in h] == [90_000, 110_000, 100_000]  # mais recente primeiro
    assert [x["variacao_cents"] for x in h] == [-20_000, 10_000, None]
    assert h[-1]["variacao_pct"] is None  # a mais antiga não tem anterior


def test_apagar_leitura_recalcula_tudo(db, autenticado):
    """O teste que só passa porque nada é armazenado: apagar a leitura mais
    recente faz o saldo atual voltar a ser a anterior, sem nada a reconciliar."""
    conta = criar(autenticado, saldo_inicial_cents=100_000)
    saldo(autenticado, conta, valor_cents=120_000)
    errada = saldo(autenticado, conta, valor_cents=999_999)["id"]

    c = listar(autenticado)["itens"][0]
    assert c["saldo_cents"] == 999_999

    assert autenticado.delete(f"/api/contas-bancarias/{conta}/saldos/{errada}").status_code == 200

    c = listar(autenticado)["itens"][0]
    assert c["saldo_cents"] == 120_000
    assert c["saldo_anterior_cents"] == 100_000
    assert (c["variacao_cents"], c["variacao_pct"]) == (20_000, 20.0)


def test_arquivar_esconde_sem_perder_historico(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=100_000)
    assert autenticado.patch(f"/api/contas-bancarias/{conta}", json={"ativa": False}).status_code == 200

    assert listar(autenticado)["itens"] == []
    arq = listar(autenticado, incluir_arquivadas=True)
    assert [c["ativa"] for c in arq["itens"]] == [False]
    assert len(autenticado.get(f"/api/contas-bancarias/{conta}/saldos").json()) == 1


def test_excluir_conta_leva_o_historico_junto(db, autenticado):
    conta = criar(autenticado, saldo_inicial_cents=100_000)
    saldo(autenticado, conta, valor_cents=110_000)

    assert autenticado.delete(f"/api/contas-bancarias/{conta}").status_code == 200
    assert db.execute("SELECT COUNT(*) n FROM saldos_conta").fetchone()["n"] == 0
    assert autenticado.delete(f"/api/contas-bancarias/{conta}").status_code == 404


def test_conta_duplicada_e_409(db, autenticado):
    criar(autenticado, banco="Nubank", nome="Corrente")
    r = autenticado.post("/api/contas-bancarias", json={"banco": "Nubank", "nome": "Corrente"})
    assert r.status_code == 409, r.text
    # Mesmo nome em outro banco é legítimo:
    assert autenticado.post("/api/contas-bancarias",
                            json={"banco": "Itaú", "nome": "Corrente"}).status_code == 201


def test_validacoes_de_cadastro(db, autenticado):
    assert autenticado.post("/api/contas-bancarias", json={"banco": " ", "nome": "X"}).status_code == 422
    assert autenticado.post("/api/contas-bancarias", json={"banco": "X", "nome": "  "}).status_code == 422

    conta = criar(autenticado)
    assert autenticado.patch(f"/api/contas-bancarias/{conta}", json={}).status_code == 400
    assert autenticado.patch(f"/api/contas-bancarias/{conta}", json={"nome": ""}).status_code == 422
    assert autenticado.patch(f"/api/contas-bancarias/{conta}", json={"ativa": None}).status_code == 422
    assert autenticado.patch("/api/contas-bancarias/99999", json={"nome": "X"}).status_code == 404


def test_saldo_em_conta_inexistente_e_404(db, autenticado):
    assert autenticado.post("/api/contas-bancarias/99999/saldos", json={"valor_cents": 1}).status_code == 404
    assert autenticado.get("/api/contas-bancarias/99999/saldos").status_code == 404
