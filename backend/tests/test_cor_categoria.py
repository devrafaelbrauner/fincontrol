"""A cor da categoria passa por `categorias.Cor`.

O que este arquivo protege: o campo era `cor: str | None`, sem checagem nenhuma.
Como o frontend joga esse valor direto em `background` e em `fill` de SVG, ele
aceitava tanto uma cor ilegível (o verde que significa "entrada" no resto do
app, ou um tom que ninguém com daltonismo distingue da categoria vizinha)
quanto uma string que não é cor alguma.

Duas formas são válidas: `var(--chart-N)`, que é o que a cartela grava, e
`#rrggbb`, que é o que o antigo seletor livre gravava — este segue aceito para
as categorias que já existem não quebrarem ao serem editadas.

NÃO limpe a tabela `categorias` aqui. O conftest a deixa de fora do
`limpar_movimento` de propósito ("a migration 004 semeia as padrão, e vários
testes dependem delas"), e o banco é um só para a sessão inteira: um DELETE
aqui deixaria sem categorias todo teste que rodasse depois. Cada caso usa um
nome próprio — `UNIQUE(nome, tipo)` reclamaria de um nome semeado.
"""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    yield conn
    conn.close()


def cor_de(db, categoria_id):
    return db.execute("SELECT cor FROM categorias WHERE id = ?", (categoria_id,)).fetchone()["cor"]


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
    # O nome pode repetir entre os casos: 422 significa que nada foi inserido,
    # então o UNIQUE(nome, tipo) nunca chega a ser tocado.
    nome = "Categoria de teste de cor"
    r = autenticado.post("/api/categorias", json={"nome": nome, "tipo": "variavel", "cor": cor})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT COUNT(*) n FROM categorias WHERE nome = ?", (nome,)).fetchone()["n"] == 0


@pytest.mark.parametrize("cor", CORES_INVALIDAS)
def test_editar_recusa_cor_fora_do_padrao(db, autenticado, cor):
    criada = autenticado.post("/api/categorias", json={"nome": f"Editar cor {cor!r}", "tipo": "variavel"})
    assert criada.status_code == 201, criada.text
    cat_id = criada.json()["id"]

    r = autenticado.patch(f"/api/categorias/{cat_id}", json={"cor": cor})
    assert r.status_code == 422, r.text
    assert cor_de(db, cat_id) is None


@pytest.mark.parametrize("cor", ["var(--chart-1)", "var(--chart-6)", "#60a5fa", "#FFAA00"])
def test_aceita_token_da_cartela_e_hex_antigo(db, autenticado, cor):
    r = autenticado.post("/api/categorias", json={"nome": f"Aceita {cor}", "tipo": "variavel", "cor": cor})
    assert r.status_code == 201, r.text
    assert cor_de(db, r.json()["id"]) == cor


def test_cor_continua_opcional(db, autenticado):
    """Sem cor a categoria cai no slot determinístico do frontend, então nada
    obriga a escolher uma na criação."""
    r = autenticado.post("/api/categorias", json={"nome": "Sem cor definida", "tipo": "variavel"})
    assert r.status_code == 201, r.text
    assert r.json()["cor"] is None


def test_migration_014_soltou_as_categorias_semeadas(db):
    """As cores da migration 004 venciam a paleta validada — inclusive em
    instalação nova, onde eram as únicas categorias existentes. Duas delas
    colidiam com as cores semânticas: 'Saúde' era o vermelho de saída e
    'Salário' o verde de entrada."""
    for nome, tipo in [("Saúde", "variavel"), ("Salário", "entrada"), ("Mercado", "variavel")]:
        linha = db.execute("SELECT cor FROM categorias WHERE nome = ? AND tipo = ?", (nome, tipo)).fetchone()
        assert linha is not None, f"{nome}/{tipo} deveria existir (migration 004)"
        assert linha["cor"] is None, f"{nome}/{tipo} ainda carrega a cor da semente"
