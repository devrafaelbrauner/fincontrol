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


# ---------- restante das tabelas mutáveis (migration 018) ----------
#
# Sem versão nessas tabelas o sync offline não reconcilia: um PATCH/DELETE que
# saísse da fila depois de outro aparelho editar a mesma linha passaria por cima
# em silêncio. Cada teste repete o roteiro de test_patch_com_versao_velha_e_409:
# ler a versão → aparelho A salva → aparelho B (versão velha) leva 409.

def test_vale_para_lancamento_variavel(db, autenticado):
    lid = autenticado.post("/api/variaveis",
                           json={"descricao": "Mercado", "valor_cents": 5_000, "data": "2026-03-10"}).json()["id"]
    versao = autenticado.get("/api/variaveis").json()["itens"][0]["versao"]

    assert autenticado.patch(f"/api/variaveis/{lid}", json={"descricao": "A"},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/variaveis/{lid}", json={"descricao": "B"},
                             headers={"If-Match": str(versao)}).status_code == 409
    # E a escrita de A permaneceu.
    assert autenticado.get("/api/variaveis").json()["itens"][0]["descricao"] == "A"


def test_delete_de_lancamento_tambem_exige_versao(db, autenticado):
    """DELETE sem If-Match apaga; com versão velha, 409 — senão a exclusão da
    fila offline apagaria uma linha que outro aparelho acabou de editar."""
    lid = autenticado.post("/api/variaveis",
                           json={"descricao": "Farmácia", "valor_cents": 3_000, "data": "2026-03-11"}).json()["id"]
    versao = autenticado.get("/api/variaveis").json()["itens"][0]["versao"]

    autenticado.patch(f"/api/variaveis/{lid}", json={"descricao": "Farmácia 2"},
                      headers={"If-Match": str(versao)})
    assert autenticado.delete(f"/api/variaveis/{lid}", headers={"If-Match": str(versao)}).status_code == 409

    nova = autenticado.get("/api/variaveis").json()["itens"][0]["versao"]
    assert autenticado.delete(f"/api/variaveis/{lid}", headers={"If-Match": str(nova)}).status_code == 200


def test_vale_para_parcelamento(db, autenticado):
    """Recategorizar/excluir a compra inteira é uma edição do GRUPO: a versão
    conferida é a do parcelamento, não a de cada parcela."""
    pid = autenticado.post("/api/variaveis/parcelado", json={
        "descricao": "Notebook", "valor_parcela_cents": 50_000, "parcelas": 10, "primeira_data": "2026-03-05",
    }).json()["id"]
    versao = autenticado.get("/api/variaveis").json()["itens"][0]["parcelamento_versao"]

    assert autenticado.patch(f"/api/variaveis/parcelado/{pid}", json={"categoria_id": None},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/variaveis/parcelado/{pid}", json={"categoria_id": None},
                             headers={"If-Match": str(versao)}).status_code == 409
    assert autenticado.delete(f"/api/variaveis/parcelado/{pid}",
                              headers={"If-Match": str(versao)}).status_code == 409


def test_vale_para_lancamento_fixo(db, autenticado):
    autenticado.post("/api/contas-fixas",
                     json={"nome": "Aluguel", "dia_vencimento": 10, "valor_estimado_cents": 100_000})
    l = autenticado.get("/api/contas-fixas/lancamentos/2026-03").json()[0]

    assert autenticado.post(f"/api/contas-fixas/lancamentos/{l['id']}/pagar", json={},
                            headers={"If-Match": str(l["versao"])}).status_code == 200
    assert autenticado.post(f"/api/contas-fixas/lancamentos/{l['id']}/desfazer-pagamento", json={},
                            headers={"If-Match": str(l["versao"])}).status_code == 409


def test_vale_para_entrada(db, autenticado):
    eid = autenticado.post("/api/entradas",
                           json={"descricao": "Salário", "valor_cents": 800_000, "data": "2026-03-05"}).json()["id"]
    versao = autenticado.get("/api/entradas").json()["itens"][0]["versao"]

    # Entrada não tem PATCH: a versão existe para reconciliar o DELETE da fila.
    assert autenticado.delete(f"/api/entradas/{eid}", headers={"If-Match": str(versao)}).status_code == 200


def test_vale_para_meta(db, autenticado):
    mid = autenticado.post("/api/metas",
                           json={"nome": "Viagem", "valor_total_cents": 500_000, "prazo": "2026-12-31"}).json()["id"]
    versao = autenticado.get("/api/metas").json()[0]["versao"]

    assert autenticado.patch(f"/api/metas/{mid}", json={"nome": "A"},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/metas/{mid}", json={"nome": "B"},
                             headers={"If-Match": str(versao)}).status_code == 409
    assert autenticado.delete(f"/api/metas/{mid}", headers={"If-Match": str(versao)}).status_code == 409


def test_vale_para_item_de_meta(db, autenticado):
    mid = autenticado.post("/api/metas",
                           json={"nome": "Casa", "valor_total_cents": 500_000, "prazo": "2026-12-31"}).json()["id"]
    iid = autenticado.post(f"/api/metas/{mid}/itens", json={"nome": "Pintura", "valor_cents": 1_000}).json()["id"]
    versao = autenticado.get("/api/metas").json()[0]["itens"][0]["versao"]

    assert autenticado.patch(f"/api/metas/{mid}/itens/{iid}", json={"nome": "A"},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/metas/{mid}/itens/{iid}", json={"nome": "B"},
                             headers={"If-Match": str(versao)}).status_code == 409
    assert autenticado.delete(f"/api/metas/{mid}/itens/{iid}",
                              headers={"If-Match": str(versao)}).status_code == 409


def test_vale_para_categoria(db, autenticado):
    cid = autenticado.post("/api/categorias",
                           json={"nome": "Assinaturas de teste", "tipo": "variavel"}).json()["id"]
    versao = next(c for c in autenticado.get("/api/categorias").json() if c["id"] == cid)["versao"]

    assert autenticado.patch(f"/api/categorias/{cid}", json={"nome": "A"},
                             headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.patch(f"/api/categorias/{cid}", json={"nome": "B"},
                             headers={"If-Match": str(versao)}).status_code == 409


def test_vale_para_orcamento(db, autenticado):
    # A chave do orçamento é categoria_id: o If-Match viaja na rota da categoria.
    cat = next(c for c in autenticado.get("/api/categorias").json() if c["tipo"] == "variavel")
    autenticado.put(f"/api/orcamentos/{cat['id']}", json={"limite_cents": 50_000})
    versao = autenticado.get("/api/orcamentos").json()[0]["versao"]

    assert autenticado.put(f"/api/orcamentos/{cat['id']}", json={"limite_cents": 60_000},
                           headers={"If-Match": str(versao)}).status_code == 200
    assert autenticado.put(f"/api/orcamentos/{cat['id']}", json={"limite_cents": 70_000},
                           headers={"If-Match": str(versao)}).status_code == 409
    assert autenticado.delete(f"/api/orcamentos/{cat['id']}",
                              headers={"If-Match": str(versao)}).status_code == 409
