"""Busca global: filtros combinados sobre variáveis, entradas e fixas."""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    for t in ("lancamentos_fixos", "contas_fixas", "lancamentos_variaveis", "entradas"):
        conn.execute(f"DELETE FROM {t}")
    # Massa mínima nas três fontes:
    conn.execute("INSERT INTO lancamentos_variaveis (descricao, valor_cents, data) VALUES ('Mercado Pão de Açúcar', 25_000, '2026-07-10')")
    conn.execute("INSERT INTO lancamentos_variaveis (descricao, valor_cents, data) VALUES ('Farmácia', 8_000, '2026-08-01')")
    conn.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário mercado de trabalho', 900_000, '2026-08-05')")
    cur = conn.execute("INSERT INTO contas_fixas (nome, dia_vencimento, valor_estimado_cents) VALUES ('Supermercado assinatura', 20, 15_000)")
    conn.execute("INSERT INTO lancamentos_fixos (conta_fixa_id, competencia, valor_cents) VALUES (?, '2026-08', 15_000)", (cur.lastrowid,))
    conn.commit()
    yield conn
    conn.close()


def buscar(autenticado, **params):
    r = autenticado.get("/api/busca", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_texto_encontra_nas_tres_fontes(db, autenticado):
    itens = buscar(autenticado, q="mercado")["itens"]

    tipos = {i["tipo"] for i in itens}
    assert tipos == {"variavel", "entrada", "fixa"}
    fixa = next(i for i in itens if i["tipo"] == "fixa")
    assert fixa["data"] == "2026-08-20"  # vencimento calculado da competência
    assert fixa["pago"] is False


def test_texto_e_case_insensitive_e_literal(db, autenticado):
    assert len(buscar(autenticado, q="MERCADO")["itens"]) == 3
    # Curingas do usuário não são curingas de LIKE:
    assert buscar(autenticado, q="merc%do")["itens"] == []
    assert buscar(autenticado, q="_ercado")["itens"] == []


def test_periodo_corta_pelo_vencimento_da_fixa(db, autenticado):
    # A fixa de agosto vence dia 20; um período que termina dia 15 não a inclui,
    # mesmo a competência (2026-08) estando dentro do intervalo.
    itens = buscar(autenticado, q="mercado", de="2026-08-01", ate="2026-08-15")["itens"]
    assert [i["tipo"] for i in itens] == ["entrada"]

    itens = buscar(autenticado, q="mercado", de="2026-08-16")["itens"]
    assert [i["tipo"] for i in itens] == ["fixa"]


def test_faixa_de_valor(db, autenticado):
    itens = buscar(autenticado, valor_min=10_000, valor_max=30_000)["itens"]
    assert sorted(i["descricao"] for i in itens) == ["Mercado Pão de Açúcar", "Supermercado assinatura"]


def test_periodo_sozinho_e_ordenacao(db, autenticado):
    itens = buscar(autenticado, de="2026-08-01", ate="2026-08-31")["itens"]
    assert [i["data"] for i in itens] == ["2026-08-20", "2026-08-05", "2026-08-01"]  # desc


def test_sem_criterio_nenhum_e_400(db, autenticado):
    assert autenticado.get("/api/busca").status_code == 400
    assert autenticado.get("/api/busca", params={"q": "   "}).status_code == 400


def test_truncamento_no_limite(db, autenticado):
    db.executemany(
        "INSERT INTO lancamentos_variaveis (descricao, valor_cents, data) VALUES (?, 100, '2026-06-01')",
        [(f"lote {n}",) for n in range(60)],
    )
    db.commit()

    r = buscar(autenticado, q="lote")
    assert len(r["itens"]) == 50
    assert r["truncado"] is True
