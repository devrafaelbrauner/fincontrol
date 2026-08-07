"""Fase 2 dos compromissos: o resto do app passa a enxergá-los.

Lembretes push, feed .ics, busca global e dashboard. O fio comum é que um
compromisso QUITADO some de todos eles — o prazo deixou de existir, e continuar
avisando sobre o que já foi resolvido é a forma mais rápida de ensinar o dono a
ignorar os avisos.
"""

from datetime import timedelta

import pytest

from app import ics, lembretes
from app.db import connect
from app.routers import push
from app.util import hoje

from .conftest import limpar_movimento


@pytest.fixture
def db():
    conn = connect()
    limpar_movimento(conn)
    conn.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('x','y','z')")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def enviados(monkeypatch):
    capturados = []
    monkeypatch.setattr(push, "enviar",
                        lambda _db, t, c, url="/": (capturados.append({"titulo": t, "corpo": c, "url": url}), 1)[1])
    return capturados


def em(dias: int) -> str:
    return (hoje() + timedelta(days=dias)).isoformat()


def proximo(enviados, url: str) -> dict:
    """O push de um dado destino, sem depender da ordem de saída."""
    achados = [e for e in enviados if e["url"] == url]
    assert len(achados) == 1, f"esperava 1 push para {url}, veio {enviados}"
    return achados[0]


def criar(autenticado, **campos):
    corpo = {"nome": "IPVA", "valor_total_cents": 120_000, "data_limite": em(3)} | campos
    r = autenticado.post("/api/compromissos", json=corpo)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- lembretes ----------

def test_avisa_antes_no_dia_e_no_atraso(db, autenticado, enviados):
    criar(autenticado, nome="Vence em 3", data_limite=em(3), lembrete_dias_antes=3)
    lembretes.enviar_lembretes(db)
    assert [e["titulo"] for e in enviados] == ["Compromisso vence em 3 dias"]
    assert "Vence em 3" in enviados[0]["corpo"]
    assert enviados[0]["url"] == "/compromissos"

    enviados.clear()
    db.execute("DELETE FROM compromissos")
    db.commit()
    criar(autenticado, nome="Hoje", data_limite=em(0))
    lembretes.enviar_lembretes(db)
    assert [e["titulo"] for e in enviados] == ["Compromisso vence hoje"]

    enviados.clear()
    db.execute("DELETE FROM compromissos")
    db.execute("DELETE FROM lembretes_enviados")
    db.commit()
    criar(autenticado, nome="Atrasado", data_limite=em(-2))
    lembretes.enviar_lembretes(db)
    assert [e["titulo"] for e in enviados] == ["Compromisso atrasado"]


def test_nao_repete_e_quitado_para_de_avisar(db, autenticado, enviados):
    cid = criar(autenticado, data_limite=em(0))
    lembretes.enviar_lembretes(db)
    assert len(enviados) == 1

    lembretes.enviar_lembretes(db)  # restart, segunda execução do dia
    assert len(enviados) == 1

    # Quitar e limpar a dedup: nem assim volta a avisar.
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 120_000})
    db.execute("DELETE FROM lembretes_enviados")
    db.commit()
    lembretes.enviar_lembretes(db)
    assert len(enviados) == 1, "compromisso quitado não avisa"


def test_pagamento_parcial_avisa_o_que_falta(db, autenticado, enviados):
    """Anunciar o valor cheio faria o aviso cobrar dinheiro que já saiu."""
    cid = criar(autenticado, valor_total_cents=120_000, data_limite=em(0))
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 90_000})

    lembretes.enviar_lembretes(db)
    assert "falta R$ 300,00" in enviados[0]["corpo"], enviados[0]["corpo"]


def test_arquivado_nao_avisa(db, autenticado, enviados):
    cid = criar(autenticado, data_limite=em(0))
    autenticado.patch(f"/api/compromissos/{cid}", json={"ativo": False})
    lembretes.enviar_lembretes(db)
    assert enviados == []


def test_varios_no_mesmo_prazo_viram_um_push(db, autenticado, enviados):
    criar(autenticado, nome="A", valor_total_cents=10_000, data_limite=em(0))
    criar(autenticado, nome="B", valor_total_cents=20_000, data_limite=em(0))

    lembretes.enviar_lembretes(db)
    assert len(enviados) == 1
    assert enviados[0]["titulo"] == "2 compromissos vencem hoje"
    assert "R$ 300,00 no total" in enviados[0]["corpo"]


def test_peso_do_mes_entra_na_mensagem(db, autenticado, enviados):
    """O "alerta de conflito" é contexto na mensagem que já ia sair, não um push
    a mais com limiar arbitrário."""
    db.execute("INSERT INTO contas_fixas (nome, dia_vencimento, valor_estimado_cents) "
               "VALUES ('Aluguel', 10, 200_000)")
    db.commit()
    criar(autenticado, data_limite=em(0))

    lembretes.enviar_lembretes(db)
    # Pelo url, não pela posição: nos dias em que o próprio Aluguel (dia 10) cai
    # dentro da antecedência padrão de 3 dias, o aviso da conta fixa sai antes e
    # ocupa enviados[0] — o que quebrava este teste do dia 7 ao 10 de cada mês.
    corpo = proximo(enviados, "/compromissos")["corpo"]
    assert "em contas fixas e compromissos" in corpo
    assert "R$ 2.000,00" in corpo


def test_previa_inclui_compromissos(db, autenticado):
    criar(autenticado, nome="Prévia comp", data_limite=em(0))
    notifs = autenticado.get("/api/push/lembretes").json()["notificacoes"]
    assert any("Prévia comp" in n["corpo"] for n in notifs), notifs


# ---------- feed .ics ----------

def test_ics_traz_compromisso_em_aberto(db, autenticado):
    criar(autenticado, nome="IPTU", credor="Prefeitura", data_limite=em(20))
    feed = ics.gerar_feed(db)
    assert "IPTU" in feed and "Prefeitura" in feed
    assert "compromisso-" in feed


def test_ics_omite_quitado_e_arquivado(db, autenticado):
    quitado = criar(autenticado, nome="Quitado ics", data_limite=em(20))
    autenticado.post(f"/api/compromissos/{quitado}/pagamentos", json={"valor_cents": 120_000})
    arq = criar(autenticado, nome="Arquivado ics", data_limite=em(20))
    autenticado.patch(f"/api/compromissos/{arq}", json={"ativo": False})

    feed = ics.gerar_feed(db)
    assert "Quitado ics" not in feed
    assert "Arquivado ics" not in feed


# ---------- busca global ----------

def test_busca_acha_por_nome_e_por_credor(db, autenticado):
    criar(autenticado, nome="Acordo cartão", credor="Banco Máximo", data_limite=em(10))

    por_nome = autenticado.get("/api/busca", params={"q": "acordo"}).json()["itens"]
    assert [i["tipo"] for i in por_nome] == ["compromisso"]

    # Credor com acento, digitado sem — o norm() do PR #34 vale aqui também.
    por_credor = autenticado.get("/api/busca", params={"q": "maximo"}).json()["itens"]
    assert [i["descricao"] for i in por_credor] == ["Acordo cartão"]


def test_busca_usa_o_que_falta_na_faixa_de_valor(db, autenticado):
    cid = criar(autenticado, nome="Parcial busca", valor_total_cents=100_000, data_limite=em(10))
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 70_000})

    # Falta R$ 300: entra numa faixa até 500, e não numa que começa em 900.
    achou = autenticado.get("/api/busca", params={"q": "parcial busca", "valor_max": 50_000}).json()["itens"]
    assert [i["valor_cents"] for i in achou] == [30_000]
    vazio = autenticado.get("/api/busca", params={"q": "parcial busca", "valor_min": 90_000}).json()["itens"]
    assert vazio == []


def test_busca_recorta_pelo_prazo(db, autenticado):
    criar(autenticado, nome="Perto", data_limite=em(5))
    criar(autenticado, nome="Longe", data_limite=em(90))

    itens = autenticado.get("/api/busca", params={"q": "e", "ate": em(30)}).json()["itens"]
    nomes = [i["descricao"] for i in itens if i["tipo"] == "compromisso"]
    assert "Perto" in nomes and "Longe" not in nomes


# ---------- dashboard ----------

def test_dashboard_lista_compromisso_em_aberto(db, autenticado):
    hoje_ = hoje()
    comp = f"{hoje_.year:04d}-{hoje_.month:02d}"
    cid = criar(autenticado, nome="No mês", valor_total_cents=100_000,
                data_limite=hoje_.replace(day=28).isoformat())
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 40_000})

    prox = autenticado.get(f"/api/dashboard/{comp}").json()["proximos_vencimentos"]
    do_comp = [p for p in prox if p["tipo"] == "compromisso"]
    assert len(do_comp) == 1
    assert do_comp[0]["nome"] == "No mês"
    assert do_comp[0]["valor_cents"] == 60_000, "mostra o que falta, não o total"


def test_dashboard_omite_quitado(db, autenticado):
    hoje_ = hoje()
    comp = f"{hoje_.year:04d}-{hoje_.month:02d}"
    cid = criar(autenticado, nome="Quitado dash", valor_total_cents=100_000,
                data_limite=hoje_.replace(day=28).isoformat())
    autenticado.post(f"/api/compromissos/{cid}/pagamentos", json={"valor_cents": 100_000})

    prox = autenticado.get(f"/api/dashboard/{comp}").json()["proximos_vencimentos"]
    assert [p for p in prox if p["tipo"] == "compromisso"] == []
