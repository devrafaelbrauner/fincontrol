"""/analises/historico: séries mensais corretas e sem efeito colateral de escrita."""

import pytest

from app.db import connect
from app.util import competencia_de, hoje


@pytest.fixture
def db():
    conn = connect()
    # As categorias padrão (migração 004) ficam: não têm lançamentos, logo não
    # aparecem no resultado — e apagá-las afetaria testes vizinhos.
    for t in ("lancamentos_fixos", "contas_fixas", "lancamentos_variaveis", "entradas"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    yield conn
    conn.close()


def historico(autenticado, **params):
    r = autenticado.get("/api/analises/historico", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def cat(db, nome, tipo="variavel", cor="#123456"):
    cur = db.execute("INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)", (nome, tipo, cor))
    db.commit()
    return cur.lastrowid


def entrada(db, data, cents):
    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('e', ?, ?)", (cents, data))
    db.commit()


def variavel(db, data, cents, categoria_id=None):
    db.execute(
        "INSERT INTO lancamentos_variaveis (descricao, valor_cents, data, categoria_id) VALUES ('v', ?, ?, ?)",
        (cents, data, categoria_id),
    )
    db.commit()


def fixo(db, competencia, cents, categoria_id=None, nome="Conta"):
    """Conta fixa + lançamento materializado na competência."""
    cur = db.execute(
        "INSERT INTO contas_fixas (nome, dia_vencimento, valor_estimado_cents, categoria_id) VALUES (?, 10, ?, ?)",
        (nome, cents, categoria_id),
    )
    db.execute(
        "INSERT INTO lancamentos_fixos (conta_fixa_id, competencia, valor_cents) VALUES (?, ?, ?)",
        (cur.lastrowid, competencia, cents),
    )
    db.commit()
    return cur.lastrowid


def test_serie_cobre_a_janela_inteira_com_zeros(db, autenticado):
    entrada(db, "2026-06-10", 1000)

    serie = historico(autenticado, ate="2026-08", meses=3)["serie"]

    assert [p["competencia"] for p in serie] == ["2026-06", "2026-07", "2026-08"]
    assert serie[0]["entradas_cents"] == 1000
    # Meses sem movimento existem na série (zerados) — o gráfico precisa do eixo
    # contínuo; um buraco viraria uma linha ligando meses não adjacentes.
    assert serie[1] == {"competencia": "2026-07", "entradas_cents": 0, "fixas_cents": 0,
                        "variaveis_cents": 0, "saldo_cents": 0}


def test_agregacao_por_mes_e_saldo(db, autenticado):
    entrada(db, "2026-07-05", 500_000)
    entrada(db, "2026-07-20", 100_000)
    variavel(db, "2026-07-08", 120_000)
    fixo(db, "2026-07", 80_000)
    # Vizinhos não vazam para 2026-07:
    entrada(db, "2026-06-30", 999)
    variavel(db, "2026-08-01", 999)

    serie = historico(autenticado, ate="2026-08", meses=3)["serie"]
    julho = serie[1]

    assert julho["entradas_cents"] == 600_000
    assert julho["variaveis_cents"] == 120_000
    assert julho["fixas_cents"] == 80_000
    assert julho["saldo_cents"] == 600_000 - 120_000 - 80_000


def test_nao_materializa_lancamentos_fixos(db, autenticado):
    # Conta ativa SEM lançamento: o /dashboard geraria a linha do mês; o
    # histórico não pode — é uma consulta, e mês nunca aberto não tem gasto.
    db.execute(
        "INSERT INTO contas_fixas (nome, dia_vencimento, valor_estimado_cents) VALUES ('Luz', 10, 15000)"
    )
    db.commit()

    serie = historico(autenticado, ate="2026-08", meses=2)["serie"]

    assert all(p["fixas_cents"] == 0 for p in serie)
    assert db.execute("SELECT COUNT(*) n FROM lancamentos_fixos").fetchone()["n"] == 0


def test_por_categoria_soma_variaveis_e_fixos(db, autenticado):
    moradia = cat(db, "Moradia teste", tipo="fixa")
    variavel(db, "2026-07-15", 10_000, categoria_id=moradia)
    fixo(db, "2026-07", 50_000, categoria_id=moradia, nome="Aluguel")
    variavel(db, "2026-07-16", 7_000)  # sem categoria

    linhas = historico(autenticado, ate="2026-07", meses=2)["por_categoria"]

    por_id = {r["categoria_id"]: r for r in linhas}
    assert por_id[moradia]["total_cents"] == 60_000
    assert por_id[moradia]["nome"] == "Moradia teste"
    assert por_id[None]["total_cents"] == 7_000
    assert por_id[None]["nome"] is None


def test_ate_padrao_e_o_mes_corrente(db, autenticado):
    serie = historico(autenticado, meses=2)["serie"]
    assert serie[-1]["competencia"] == competencia_de(hoje())


def test_categorias_todas_inclui_desativadas(db, autenticado):
    # Os gráficos históricos resolvem nome/cor de categoria desativada via
    # todas=1; a lista padrão (telas de escolha) continua só com as ativas.
    inativa = cat(db, "Antiga desativada")
    db.execute("UPDATE categorias SET ativa = 0 WHERE id = ?", (inativa,))
    db.commit()

    ativas = {c["id"] for c in autenticado.get("/api/categorias").json()}
    todas = {c["id"] for c in autenticado.get("/api/categorias", params={"todas": 1}).json()}

    assert inativa not in ativas
    assert inativa in todas


def test_parametros_invalidos(db, autenticado):
    assert autenticado.get("/api/analises/historico", params={"meses": 1}).status_code == 422
    assert autenticado.get("/api/analises/historico", params={"meses": 37}).status_code == 422
    assert autenticado.get("/api/analises/historico", params={"ate": "2026-13"}).status_code == 400
    assert autenticado.get("/api/analises/historico", params={"ate": "agosto"}).status_code == 400
