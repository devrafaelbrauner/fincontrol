"""Compras parceladas: geração das parcelas mês a mês e exclusão em grupo."""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    for t in ("lancamentos_variaveis", "parcelamentos"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    yield conn
    conn.close()


def criar(autenticado, **campos):
    corpo = {
        "descricao": "Notebook",
        "valor_parcela_cents": 50_000,
        "parcelas": 10,
        "primeira_data": "2026-08-15",
        **campos,
    }
    return autenticado.post("/api/variaveis/parcelado", json=corpo)


def test_cria_todas_as_parcelas_uma_por_mes(db, autenticado):
    r = criar(autenticado)
    assert r.status_code == 201, r.text
    assert r.json()["total_cents"] == 500_000

    linhas = db.execute(
        "SELECT data, valor_cents, parcela_num, forma_pagamento FROM lancamentos_variaveis ORDER BY data"
    ).fetchall()
    assert len(linhas) == 10
    assert [l["parcela_num"] for l in linhas] == list(range(1, 11))
    assert linhas[0]["data"] == "2026-08-15"
    assert linhas[4]["data"] == "2026-12-15"
    assert linhas[5]["data"] == "2027-01-15"  # atravessa a virada do ano
    assert all(l["valor_cents"] == 50_000 for l in linhas)
    assert all(l["forma_pagamento"] == "credito" for l in linhas)  # default


def test_dia_31_encolhe_para_o_fim_do_mes(db, autenticado):
    criar(autenticado, primeira_data="2026-01-31", parcelas=4)

    datas = [l["data"] for l in db.execute("SELECT data FROM lancamentos_variaveis ORDER BY data")]
    assert datas == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]


def test_listagem_traz_o_total_de_parcelas_para_o_badge(db, autenticado):
    criar(autenticado, parcelas=3)

    r = autenticado.get("/api/variaveis", params={"de": "2026-09-01", "ate": "2026-09-30"})
    itens = r.json()["itens"]

    assert len(itens) == 1
    assert itens[0]["parcela_num"] == 2
    assert itens[0]["parcelas_total"] == 3
    # Lançamento comum continua sem os campos de parcela preenchidos:
    autenticado.post("/api/variaveis", json={"descricao": "Café", "valor_cents": 900, "data": "2026-09-02"})
    r = autenticado.get("/api/variaveis", params={"de": "2026-09-01", "ate": "2026-09-30"})
    comum = next(i for i in r.json()["itens"] if i["descricao"] == "Café")
    assert comum["parcelamento_id"] is None
    assert comum["parcelas_total"] is None


def test_excluir_parcelamento_remove_todas_as_parcelas(db, autenticado):
    pid = criar(autenticado).json()["id"]

    r = autenticado.delete(f"/api/variaveis/parcelado/{pid}")
    assert r.status_code == 200
    assert r.json()["parcelas_removidas"] == 10
    assert db.execute("SELECT COUNT(*) n FROM lancamentos_variaveis").fetchone()["n"] == 0
    assert autenticado.delete(f"/api/variaveis/parcelado/{pid}").status_code == 404


def test_excluir_uma_parcela_nao_afeta_as_outras(db, autenticado):
    criar(autenticado, parcelas=3)
    uma = db.execute("SELECT id FROM lancamentos_variaveis WHERE parcela_num = 2").fetchone()["id"]

    autenticado.delete(f"/api/variaveis/{uma}")

    restantes = [l["parcela_num"] for l in db.execute("SELECT parcela_num FROM lancamentos_variaveis ORDER BY parcela_num")]
    assert restantes == [1, 3]


def test_validacoes(db, autenticado):
    assert criar(autenticado, parcelas=1).status_code == 422
    assert criar(autenticado, parcelas=73).status_code == 422
    assert criar(autenticado, valor_parcela_cents=0).status_code == 422
    # Data agora é validada no schema (util.DataISO), junto com as demais do app
    # — por isso 422 e não mais o 400 do check que existia só aqui.
    assert criar(autenticado, primeira_data="2026-02-30").status_code == 422
    assert criar(autenticado, primeira_data="agosto").status_code == 422
    # fromisoformat (3.11+) aceita estes formatos, mas o banco filtra tudo por
    # prefixo 'YYYY-MM-': se entrassem, o dinheiro sumiria das visões mensais.
    assert criar(autenticado, primeira_data="20261115").status_code == 422
    assert criar(autenticado, primeira_data="2026-W33-1").status_code == 422
    # FK inexistente é erro do chamador (400), não um 500:
    assert criar(autenticado, categoria_id=99_999).status_code == 400
    assert criar(autenticado, anexo_id=99_999).status_code == 400
    # Nada foi criado pelas tentativas inválidas:
    assert db.execute("SELECT COUNT(*) n FROM parcelamentos").fetchone()["n"] == 0
    assert db.execute("SELECT COUNT(*) n FROM lancamentos_variaveis").fetchone()["n"] == 0


def test_recategorizar_a_compra_inteira(db, autenticado):
    cur = db.execute("INSERT INTO categorias (nome, tipo) VALUES ('Eletrônicos parc', 'variavel')")
    db.commit()
    cat = cur.lastrowid
    pid = criar(autenticado, parcelas=3).json()["id"]

    r = autenticado.patch(f"/api/variaveis/parcelado/{pid}", json={"categoria_id": cat})
    assert r.status_code == 200
    assert r.json()["parcelas_atualizadas"] == 3
    assert db.execute(
        "SELECT COUNT(*) n FROM lancamentos_variaveis WHERE categoria_id = ?", (cat,)
    ).fetchone()["n"] == 3
    assert db.execute("SELECT categoria_id FROM parcelamentos WHERE id = ?", (pid,)).fetchone()["categoria_id"] == cat

    # Categoria inexistente e parcelamento inexistente:
    assert autenticado.patch(f"/api/variaveis/parcelado/{pid}", json={"categoria_id": 99_999}).status_code == 400
    assert autenticado.patch("/api/variaveis/parcelado/99999", json={"categoria_id": None}).status_code == 404
