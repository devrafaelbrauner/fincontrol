"""Writes de IA incrementam `versao` — senão o If-Match da fila offline fica furado."""
from app import openrouter
from app.db import connect

from .conftest import limpar_movimento


def test_categorizar_lote_incrementa_versao(autenticado, monkeypatch):
    limpar_movimento(connect())
    lid = autenticado.post(
        "/api/variaveis",
        json={"descricao": "Mercado", "valor_cents": 5_000, "data": "2026-03-10"},
    ).json()["id"]
    v0 = autenticado.get("/api/variaveis").json()["itens"][0]["versao"]
    cats = autenticado.get("/api/categorias").json()
    nome = next(c["nome"] for c in cats if c["tipo"] == "variavel")

    monkeypatch.setattr(openrouter, "categorizar_lote", lambda *_a, **_k: {lid: nome})
    r = autenticado.post("/api/ia/categorizar-lote")
    assert r.status_code == 200, r.text
    v1 = autenticado.get("/api/variaveis").json()["itens"][0]["versao"]
    assert v1 == v0 + 1
    assert autenticado.patch(
        f"/api/variaveis/{lid}", json={"descricao": "X"}, headers={"If-Match": str(v0)}
    ).status_code == 409


def test_estrategia_meta_incrementa_versao(autenticado, monkeypatch):
    limpar_movimento(connect())
    mid = autenticado.post(
        "/api/metas",
        json={"nome": "Viagem", "valor_total_cents": 500_000, "prazo": "2026-12-31"},
    ).json()["id"]
    v0 = autenticado.get("/api/metas").json()[0]["versao"]
    monkeypatch.setattr(openrouter, "estrategia_meta", lambda *_a, **_k: "guarde R$ 100")
    r = autenticado.post(f"/api/ia/estrategia-meta/{mid}")
    assert r.status_code == 200, r.text
    v1 = autenticado.get("/api/metas").json()[0]["versao"]
    assert v1 == v0 + 1


def test_orientacao_compromisso_incrementa_versao(autenticado, monkeypatch):
    limpar_movimento(connect())
    cid = autenticado.post(
        "/api/compromissos",
        json={"nome": "IPVA", "valor_total_cents": 120_000, "data_limite": "2026-12-31"},
    ).json()["id"]
    v0 = autenticado.get(f"/api/compromissos/{cid}").json()["versao"]
    monkeypatch.setattr(openrouter, "orientacao_compromisso", lambda *_a, **_k: "pague em 3x")
    r = autenticado.post(f"/api/ia/orientacao-compromisso/{cid}")
    assert r.status_code == 200, r.text
    v1 = autenticado.get(f"/api/compromissos/{cid}").json()["versao"]
    assert v1 == v0 + 1
