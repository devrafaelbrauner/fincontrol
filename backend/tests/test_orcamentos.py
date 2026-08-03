"""Orçamentos por categoria: CRUD, gasto do mês e aviso push de estouro."""

from datetime import date

import pytest

from app import lembretes
from app.db import connect
from app.routers import push


@pytest.fixture
def db():
    conn = connect()
    for t in ("orcamentos", "lancamentos_variaveis", "lancamentos_fixos", "contas_fixas",
              "entradas", "lembretes_enviados", "push_subscriptions"):
        conn.execute(f"DELETE FROM {t}")
    conn.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('x', 'y', 'z')")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def enviados(monkeypatch):
    capturados = []

    def falso_enviar(_db, titulo, corpo, url="/"):
        capturados.append({"titulo": titulo, "corpo": corpo, "url": url})
        return 1

    monkeypatch.setattr(push, "enviar", falso_enviar)
    return capturados


def cat(db, nome, tipo="variavel"):
    cur = db.execute("INSERT INTO categorias (nome, tipo) VALUES (?, ?)", (nome, tipo))
    db.commit()
    return cur.lastrowid


def gasto(db, categoria_id, cents, data="2026-08-10"):
    db.execute(
        "INSERT INTO lancamentos_variaveis (descricao, categoria_id, valor_cents, data) VALUES ('g', ?, ?, ?)",
        (categoria_id, cents, data),
    )
    db.commit()


HOJE = date(2026, 8, 15)  # longe do dia 1 (resumo mensal fora do caminho)


def test_definir_listar_e_remover(db, autenticado):
    mercado = cat(db, "Mercado orc")
    assert autenticado.put(f"/api/orcamentos/{mercado}", json={"limite_cents": 80_000}).status_code == 200
    gasto(db, mercado, 25_000)
    gasto(db, mercado, 10_000)
    gasto(db, mercado, 99_000, data="2026-07-05")  # outro mês não conta

    lista = autenticado.get("/api/orcamentos", params={"competencia": "2026-08"}).json()
    assert len(lista) == 1
    assert lista[0]["limite_cents"] == 80_000
    assert lista[0]["gasto_cents"] == 35_000

    # Upsert atualiza em vez de duplicar:
    autenticado.put(f"/api/orcamentos/{mercado}", json={"limite_cents": 90_000})
    lista = autenticado.get("/api/orcamentos", params={"competencia": "2026-08"}).json()
    assert [o["limite_cents"] for o in lista] == [90_000]

    assert autenticado.delete(f"/api/orcamentos/{mercado}").status_code == 200
    assert autenticado.get("/api/orcamentos").json() == []
    assert autenticado.delete(f"/api/orcamentos/{mercado}").status_code == 404


def test_validacoes(db, autenticado):
    fixa = cat(db, "Moradia orc", tipo="fixa")
    assert autenticado.put(f"/api/orcamentos/{fixa}", json={"limite_cents": 1000}).status_code == 400
    assert autenticado.put("/api/orcamentos/99999", json={"limite_cents": 1000}).status_code == 404
    v = cat(db, "Lazer orc")
    assert autenticado.put(f"/api/orcamentos/{v}", json={"limite_cents": 0}).status_code == 422
    assert autenticado.get("/api/orcamentos", params={"competencia": "2026-13"}).status_code == 400


def test_estouro_gera_push_uma_unica_vez(db, enviados):
    mercado = cat(db, "Mercado push")
    db.execute("INSERT INTO orcamentos (categoria_id, limite_cents) VALUES (?, 50_000)", (mercado,))
    db.commit()
    gasto(db, mercado, 50_000)  # exatamente no limite já conta como estouro

    lembretes.enviar_lembretes(db, HOJE)
    assert len(enviados) == 1
    assert enviados[0]["titulo"] == "Orçamento estourado"
    assert "Mercado push" in enviados[0]["corpo"]

    # Rodar de novo (restart, segundo gasto no mesmo mês): nada repete.
    gasto(db, mercado, 10_000)
    lembretes.enviar_lembretes(db, HOJE)
    assert len(enviados) == 1


def test_abaixo_do_limite_nao_avisa_e_mes_novo_reavisa(db, enviados):
    lazer = cat(db, "Lazer push")
    db.execute("INSERT INTO orcamentos (categoria_id, limite_cents) VALUES (?, 30_000)", (lazer,))
    db.commit()
    gasto(db, lazer, 29_999)

    lembretes.enviar_lembretes(db, HOJE)
    assert enviados == []

    # No mês seguinte o contador zera e um novo estouro avisa de novo:
    gasto(db, lazer, 40_000, data="2026-09-03")
    lembretes.enviar_lembretes(db, date(2026, 9, 15))
    assert len(enviados) == 1


def test_dois_estouros_viram_um_push_so(db, enviados):
    a = cat(db, "A push")
    b = cat(db, "B push")
    db.executemany("INSERT INTO orcamentos (categoria_id, limite_cents) VALUES (?, 10_000)", [(a,), (b,)])
    db.commit()
    gasto(db, a, 12_000)
    gasto(db, b, 15_000)

    lembretes.enviar_lembretes(db, HOJE)

    assert len(enviados) == 1
    assert enviados[0]["titulo"] == "2 orçamentos estourados"
    assert "A push" in enviados[0]["corpo"] and "B push" in enviados[0]["corpo"]
