"""Itens de planejamento de uma meta."""
import pytest

from app.db import connect

from .conftest import SENHA


@pytest.fixture
def autenticado(cliente):
    r = cliente.post("/api/auth/login", json={"senha": SENHA})
    assert r.status_code == 200
    cliente.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return cliente


@pytest.fixture
def meta(autenticado):
    r = autenticado.post("/api/metas", json={
        "nome": "Viagem", "valor_total_cents": 500000, "prazo": "2027-12",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_criar_listar_e_excluir_item(autenticado, meta):
    r = autenticado.post(f"/api/metas/{meta}/itens", json={
        "nome": "Passagens", "valor_cents": 180000, "descricao": "cotar com 3 meses",
    })
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    metas = autenticado.get("/api/metas").json()
    itens = next(m for m in metas if m["id"] == meta)["itens"]
    assert [i["nome"] for i in itens] == ["Passagens"]

    assert autenticado.delete(f"/api/metas/{meta}/itens/{item_id}").status_code == 200
    metas = autenticado.get("/api/metas").json()
    assert next(m for m in metas if m["id"] == meta)["itens"] == []


def test_editar_item_altera_so_o_que_foi_enviado(autenticado, meta):
    item_id = autenticado.post(f"/api/metas/{meta}/itens", json={
        "nome": "Hospedagem", "valor_cents": 100000, "descricao": "original",
    }).json()["id"]

    assert autenticado.patch(f"/api/metas/{meta}/itens/{item_id}",
                             json={"valor_cents": 120000}).status_code == 200

    db = connect()
    linha = db.execute("SELECT * FROM metas_itens WHERE id = ?", (item_id,)).fetchone()
    db.close()
    assert linha["valor_cents"] == 120000
    assert linha["nome"] == "Hospedagem"      # não enviado, não mexeu
    assert linha["descricao"] == "original"


def test_campo_desconhecido_no_patch_e_ignorado(autenticado, meta):
    """O SET do UPDATE é montado por interpolação: nome de coluna nunca pode vir
    do corpo da requisição."""
    item_id = autenticado.post(f"/api/metas/{meta}/itens",
                               json={"nome": "Passeios", "valor_cents": 5000}).json()["id"]

    r = autenticado.patch(f"/api/metas/{meta}/itens/{item_id}",
                          json={"meta_id = 999, nome": "x", "nome": "Passeios 2"})
    assert r.status_code == 200

    db = connect()
    linha = db.execute("SELECT * FROM metas_itens WHERE id = ?", (item_id,)).fetchone()
    db.close()
    assert linha["meta_id"] == meta
    assert linha["nome"] == "Passeios 2"


def test_item_de_outra_meta_nao_e_alcancavel(autenticado, meta):
    item_id = autenticado.post(f"/api/metas/{meta}/itens",
                               json={"nome": "Reserva", "valor_cents": 1000}).json()["id"]
    outra = autenticado.post("/api/metas", json={
        "nome": "Notebook", "valor_total_cents": 400000, "prazo": "2027-06",
    }).json()["id"]

    assert autenticado.patch(f"/api/metas/{outra}/itens/{item_id}",
                             json={"nome": "sequestrado"}).status_code == 404
    assert autenticado.delete(f"/api/metas/{outra}/itens/{item_id}").status_code == 404


def test_item_em_meta_inexistente(autenticado):
    r = autenticado.post("/api/metas/99999/itens", json={"nome": "x", "valor_cents": 1})
    assert r.status_code == 404
