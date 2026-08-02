"""Itens de planejamento de uma meta."""
import pytest

from app.db import connect
from app.routers.ia import _valor_cents

from .conftest import SENHA


@pytest.mark.parametrize("bruto, esperado", [
    (180000, 180000),
    (1800.0, 1800),
    ("180000", 180000),
    ("  180000  ", 180000),
    (-5, 0),
    ("R$ 1.800,00", None),   # ambíguo: 1800 centavos ou 180000? não chutar
    ("1800.50", None),
    ("muito caro", None),
    (None, None),
    (True, None),            # bool é int em Python; não pode virar 1 centavo
])
def test_valor_cents_da_sugestao_da_ia(bruto, esperado):
    assert _valor_cents(bruto) == esperado


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


@pytest.mark.parametrize("corpo", [{"nome": None}, {"valor_cents": None}])
def test_patch_com_null_em_coluna_obrigatoria_da_422(autenticado, meta, corpo):
    """`exclude_unset` preserva null explícito; sem barreira ele vira SET nome = NULL
    numa coluna NOT NULL e o IntegrityError sobe como 500."""
    item_id = autenticado.post(f"/api/metas/{meta}/itens",
                               json={"nome": "Transporte", "valor_cents": 30000}).json()["id"]

    r = autenticado.patch(f"/api/metas/{meta}/itens/{item_id}", json=corpo)
    assert r.status_code == 422, r.text

    db = connect()
    linha = db.execute("SELECT * FROM metas_itens WHERE id = ?", (item_id,)).fetchone()
    db.close()
    assert linha["nome"] == "Transporte" and linha["valor_cents"] == 30000


def test_patch_recusa_nome_em_branco_como_o_post(autenticado, meta):
    item_id = autenticado.post(f"/api/metas/{meta}/itens",
                               json={"nome": "Alimentação", "valor_cents": 60000}).json()["id"]

    assert autenticado.patch(f"/api/metas/{meta}/itens/{item_id}",
                             json={"nome": "   "}).status_code == 422
    assert autenticado.patch(f"/api/metas/{meta}/itens/{item_id}",
                             json={"nome": "  Comida  "}).status_code == 200

    db = connect()
    linha = db.execute("SELECT * FROM metas_itens WHERE id = ?", (item_id,)).fetchone()
    db.close()
    assert linha["nome"] == "Comida"      # gravou aparado


def test_patch_de_meta_com_null_obrigatorio_da_422(autenticado, meta):
    r = autenticado.patch(f"/api/metas/{meta}", json={"nome": None})
    assert r.status_code == 422, r.text
    # estrategia_texto é nullable: continua aceitando null
    assert autenticado.patch(f"/api/metas/{meta}", json={"estrategia_texto": None}).status_code == 200
