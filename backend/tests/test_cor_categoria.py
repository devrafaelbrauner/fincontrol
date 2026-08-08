"""A cor da categoria passa por `categorias.Cor`.

O que este arquivo protege: o campo era `cor: str | None`, sem checagem nenhuma.
Como o frontend joga esse valor direto em `background` e em `fill` de SVG, ele
aceitava tanto uma cor ilegível (o verde que significa "entrada" no resto do
app, ou um tom que ninguém com daltonismo distingue da categoria vizinha)
quanto uma string que não é cor alguma.

Duas formas são válidas: `var(--chart-N)`, que é o que a cartela grava, e
`#rrggbb`, que é o que o antigo seletor livre gravava — este segue aceito para
as categorias que já existem não quebrarem ao serem editadas.
"""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    conn.execute("DELETE FROM categorias")
    conn.commit()
    yield conn
    conn.close()


CORES_INVALIDAS = [
    "vermelho",
    "var(--positive)",          # token real, mas semântico: entrada não é identidade
    "var(--chart-7)",           # fora das seis vagas
    "var(--chart-0)",
    "#f00",                     # hex curto: o frontend aceita, o formato daqui não
    "#gggggg",
    "red; background: url(x)",  # o campo vai para dentro de um style
    "",
]


@pytest.mark.parametrize("cor", CORES_INVALIDAS)
def test_criar_recusa_cor_fora_do_padrao(db, autenticado, cor):
    r = autenticado.post("/api/categorias", json={"nome": "Mercado", "tipo": "variavel", "cor": cor})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT COUNT(*) n FROM categorias").fetchone()["n"] == 0


@pytest.mark.parametrize("cor", CORES_INVALIDAS)
def test_editar_recusa_cor_fora_do_padrao(db, autenticado, cor):
    criada = autenticado.post("/api/categorias", json={"nome": "Mercado", "tipo": "variavel"})
    assert criada.status_code == 201, criada.text
    cat_id = criada.json()["id"]

    r = autenticado.patch(f"/api/categorias/{cat_id}", json={"cor": cor})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT cor FROM categorias WHERE id = ?", (cat_id,)).fetchone()["cor"] is None


@pytest.mark.parametrize("cor", ["var(--chart-1)", "var(--chart-6)", "#60a5fa", "#FFAA00"])
def test_aceita_token_da_cartela_e_hex_antigo(db, autenticado, cor):
    r = autenticado.post("/api/categorias", json={"nome": "Mercado", "tipo": "variavel", "cor": cor})
    assert r.status_code == 201, r.text
    assert db.execute("SELECT cor FROM categorias WHERE id = ?", (r.json()["id"],)).fetchone()["cor"] == cor


def test_cor_continua_opcional(db, autenticado):
    """Sem cor a categoria cai no slot determinístico do frontend, então nada
    obriga a escolher uma na criação."""
    r = autenticado.post("/api/categorias", json={"nome": "Mercado", "tipo": "variavel"})
    assert r.status_code == 201, r.text
    assert r.json()["cor"] is None
