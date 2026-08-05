"""Edição concorrente deixa de ser last-write-wins silencioso.

Dois aparelhos editando o mesmo item: antes, o último a salvar apagava o outro
e ninguém era avisado. A coluna `atualizado_em` — carimbada em toda escrita —
já era a versão; só faltava conferi-la.
"""

import pytest

from app.db import connect

from .conftest import limpar_movimento


@pytest.fixture
def db():
    conn = connect()
    limpar_movimento(conn)
    yield conn
    conn.close()


def _compromisso(autenticado):
    r = autenticado.post("/api/compromissos",
                         json={"nome": "IPVA", "valor_total_cents": 100_000, "data_limite": "2026-12-01"})
    return r.json()["id"]


def test_patch_com_versao_velha_e_409(db, autenticado):
    cid = _compromisso(autenticado)
    versao = autenticado.get(f"/api/compromissos/{cid}").json()["versao"]

    # Aparelho A salva primeiro.
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"nome": "A venceu"},
                             headers={"If-Match": str(versao)}).status_code == 200

    # Aparelho B ainda tem a versão antiga em mãos.
    r = autenticado.patch(f"/api/compromissos/{cid}", json={"nome": "B chegou depois"},
                          headers={"If-Match": str(versao)})
    assert r.status_code == 409, r.text
    assert "outro aparelho" in r.json()["detail"]
    # A versão atual vem junto: sem ela a tela só saberia dizer "deu erro".
    assert r.json()["atualizado_em"] is not None

    # E a escrita de A permaneceu — o ponto todo.
    assert autenticado.get(f"/api/compromissos/{cid}").json()["nome"] == "A venceu"


def test_patch_com_versao_atual_passa(db, autenticado):
    cid = _compromisso(autenticado)
    versao = autenticado.get(f"/api/compromissos/{cid}").json()["versao"]
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"nome": "ok"},
                             headers={"If-Match": str(versao)}).status_code == 200

    nova = autenticado.get(f"/api/compromissos/{cid}").json()["versao"]
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"nome": "ok2"},
                             headers={"If-Match": str(nova)}).status_code == 200


def test_sem_cabecalho_continua_passando(db, autenticado):
    """Precondição é opcional no HTTP — e é o que permite adotar tela a tela."""
    cid = _compromisso(autenticado)
    assert autenticado.patch(f"/api/compromissos/{cid}", json={"nome": "sem if-match"}).status_code == 200


def test_inexistente_e_404_e_nao_409(db, autenticado):
    r = autenticado.patch("/api/compromissos/99999", json={"nome": "x"},
                          headers={"If-Match": "2026-01-01 00:00:00"})
    assert r.status_code == 404


def test_vale_para_conta_fixa(db, autenticado):
    r = autenticado.post("/api/contas-fixas",
                         json={"nome": "Aluguel", "dia_vencimento": 10, "valor_estimado_cents": 100_000})
    cid = r.json()["id"]
    versao = next(c for c in autenticado.get("/api/contas-fixas").json() if c["id"] == cid)["versao"]

    assert autenticado.patch(f"/api/contas-fixas/{cid}", json={"nome": "A"},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/contas-fixas/{cid}", json={"nome": "B"},
                             headers={"If-Match": str(versao)}).status_code == 409


def test_vale_para_conta_bancaria(db, autenticado):
    cid = autenticado.post("/api/contas-bancarias",
                           json={"banco": "Nubank", "nome": "Corrente"}).json()["id"]
    conta = autenticado.get("/api/contas-bancarias").json()["itens"][0]

    assert autenticado.patch(f"/api/contas-bancarias/{cid}", json={"nome": "A"},
                             headers={"If-Match": str(conta["versao"])}).status_code == 200
    assert autenticado.patch(f"/api/contas-bancarias/{cid}", json={"nome": "B"},
                             headers={"If-Match": str(conta["versao"])}).status_code == 409


def test_versao_da_linha_nao_e_a_data_do_saldo(db, autenticado):
    """Em Recursos `atualizado_em` é quando o SALDO foi lido; `versao` é a linha
    da conta. Misturá-los faria registrar saldo invalidar a edição do nome."""
    cid = autenticado.post("/api/contas-bancarias",
                           json={"banco": "Itaú", "nome": "Reserva"}).json()["id"]
    versao = autenticado.get("/api/contas-bancarias").json()["itens"][0]["versao"]

    autenticado.post(f"/api/contas-bancarias/{cid}/saldos", json={"valor_cents": 50_000})

    # Registrar saldo não mexe na linha da conta: a versão segue válida.
    assert autenticado.patch(f"/api/contas-bancarias/{cid}", json={"nome": "Reserva 2"},
                             headers={"If-Match": str(versao)}).status_code == 200
