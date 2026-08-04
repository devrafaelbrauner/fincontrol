"""Motor de lembretes: quais avisos saem, quando, e a garantia de não repetir."""

from datetime import date, timedelta

import pytest

from app import lembretes
from app.db import connect
from app.routers import push
from app.util import competencia_de, gerar_lancamentos_fixos, hoje, somar_meses


@pytest.fixture
def db():
    conn = connect()
    for tabela in ("lembretes_enviados", "lancamentos_fixos", "contas_fixas",
                   "entradas", "lancamentos_variaveis", "insights_cache",
                   "push_subscriptions"):
        conn.execute(f"DELETE FROM {tabela}")
    # Um aparelho inscrito: sem nenhum, enviar_lembretes sai cedo de propósito.
    conn.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('x', 'y', 'z')")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def enviados(monkeypatch):
    """Captura os pushes em vez de sair para a rede."""
    capturados = []

    def falso_enviar(_db, titulo, corpo, url="/"):
        capturados.append({"titulo": titulo, "corpo": corpo, "url": url})
        return 1

    monkeypatch.setattr(push, "enviar", falso_enviar)
    return capturados


def cria_conta(db, nome, dia, valor_cents=10000, antes=3):
    cur = db.execute(
        """INSERT INTO contas_fixas (nome, dia_vencimento, valor_estimado_cents, lembrete_dias_antes)
           VALUES (?, ?, ?, ?)""",
        (nome, dia, valor_cents, antes),
    )
    db.commit()
    return cur.lastrowid


# Um dia 15 confortável: longe da virada do mês e fora da janela do resumo mensal.
HOJE = date(2026, 8, 15)


def test_avisa_no_lembrete_dias_antes_e_nao_antes_disso(db):
    cria_conta(db, "Internet", dia=18, antes=3)

    assert [p["tipo"] for p in lembretes.pendencias(db, HOJE)] == ["antes"]
    assert lembretes.pendencias(db, HOJE - timedelta(days=1)) == []


def test_avisa_no_dia_do_vencimento(db):
    cria_conta(db, "Aluguel", dia=15, valor_cents=120000)

    pend = lembretes.pendencias(db, HOJE)
    assert [p["tipo"] for p in pend] == ["hoje"]
    msg = lembretes._mensagens(pend)[0]
    assert msg["titulo"] == "Vence hoje"
    assert msg["corpo"] == "Aluguel — R$ 1.200,00"
    assert msg["url"] == "/fixas"


def test_conta_paga_nao_gera_aviso(db):
    conta = cria_conta(db, "Luz", dia=15)
    gerar_lancamentos_fixos(db, "2026-08")  # o que o app faz ao abrir o mês
    db.execute(
        "UPDATE lancamentos_fixos SET data_pagamento = ? WHERE conta_fixa_id = ? AND competencia = '2026-08'",
        (HOJE.isoformat(), conta),
    )
    db.commit()

    assert lembretes.pendencias(db, HOJE) == []


def test_conta_inativa_nao_gera_aviso(db):
    cria_conta(db, "Academia", dia=15)
    db.execute("UPDATE contas_fixas SET ativa = 0")
    db.commit()

    assert lembretes.pendencias(db, HOJE) == []


def test_contas_do_mesmo_dia_viram_uma_notificacao_so(db):
    cria_conta(db, "Aluguel", dia=15, valor_cents=120000)
    cria_conta(db, "Luz", dia=15, valor_cents=28000)

    msgs = lembretes._mensagens(lembretes.pendencias(db, HOJE))
    assert len(msgs) == 1
    assert msgs[0]["titulo"] == "2 contas vencem hoje"
    assert msgs[0]["corpo"] == "Aluguel, Luz — R$ 1.480,00 no total"


def test_atraso_avisa_uma_vez_e_nao_repete(db, enviados):
    cria_conta(db, "Cartão", dia=10, valor_cents=50000)

    lembretes.enviar_lembretes(db, HOJE)
    assert [e["titulo"] for e in enviados] == ["Conta em atraso"]

    enviados.clear()
    lembretes.enviar_lembretes(db, HOJE)          # mesmo dia, de novo (restart do backend)
    lembretes.enviar_lembretes(db, HOJE + timedelta(days=1))  # e no dia seguinte
    assert enviados == []


def test_atraso_antigo_demais_e_ignorado(db):
    """Um banco restaurado com meses em aberto não pode virar uma enxurrada de
    avisos: só o atraso recente conta (o do próprio mês, aqui)."""
    cria_conta(db, "Conta velha", dia=10)
    gerar_lancamentos_fixos(db, "2026-08")
    db.commit()
    muito_depois = HOJE + timedelta(days=lembretes.DIAS_ATRASO_MAX + 5)  # 19/10/2026

    vencimentos = [p["vencimento"] for p in lembretes.pendencias(db, muito_depois)]
    assert "2026-08-10" not in vencimentos   # 70 dias atrás: fora da janela
    assert vencimentos == ["2026-10-10"]     # setembro nunca foi aberto: não se inventa


def test_forcar_reenvia_o_que_ja_saiu(db, enviados):
    cria_conta(db, "Aluguel", dia=15)

    lembretes.enviar_lembretes(db, HOJE)
    enviados.clear()
    lembretes.enviar_lembretes(db, HOJE)
    assert enviados == []

    lembretes.enviar_lembretes(db, HOJE, forcar=True)
    assert [e["titulo"] for e in enviados] == ["Vence hoje"]


def test_lembrete_atravessa_a_virada_do_mes(db):
    """Conta do dia 2 com lembrete de 3 dias: no dia 30 do mês anterior o
    lançamento da competência seguinte nem existe ainda."""
    cria_conta(db, "Streaming", dia=2, antes=3)

    pend = lembretes.pendencias(db, date(2026, 8, 30))
    assert ("antes", "2026-09-02") in [(p["tipo"], p["vencimento"]) for p in pend]


def test_resumo_mensal_sai_no_dia_1_com_os_numeros(db, enviados):
    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.execute("INSERT INTO lancamentos_variaveis (descricao, valor_cents, data) VALUES ('Mercado', 150000, '2026-07-10')")
    db.commit()

    lembretes.enviar_lembretes(db, date(2026, 8, 1))
    resumo = [e for e in enviados if e["titulo"].startswith("Resumo")]
    assert len(resumo) == 1
    assert resumo[0]["titulo"] == "Resumo de julho de 2026"
    assert "Saldo R$ 6.500,00" in resumo[0]["corpo"]
    assert resumo[0]["url"] == "/"

    enviados.clear()
    lembretes.enviar_lembretes(db, date(2026, 8, 2))
    assert enviados == []


def test_resumo_mensal_nao_sai_no_meio_do_mes(db, enviados):
    lembretes.enviar_lembretes(db, HOJE)
    assert enviados == []


def test_sem_aparelho_inscrito_nao_queima_as_chaves(db, enviados):
    """Instalação nova (VAPID pronto, PWA ainda não instalada) não pode perder o
    primeiro dia de avisos marcando tudo como enviado para ninguém."""
    cria_conta(db, "Aluguel", dia=15)
    db.execute("DELETE FROM push_subscriptions")
    db.commit()

    r = lembretes.enviar_lembretes(db, HOJE)

    assert r["notificacoes"] == [] and r["motivo"] == "nenhum aparelho inscrito"
    assert db.execute("SELECT COUNT(*) n FROM lembretes_enviados").fetchone()["n"] == 0
    # Inscrito o aparelho, o aviso de hoje ainda está lá para ser enviado.
    db.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('a','b','c')")
    db.commit()
    lembretes.enviar_lembretes(db, HOJE)
    assert [e["titulo"] for e in enviados] == ["Vence hoje"]


def test_pendencias_nao_escreve_no_banco(db):
    """A prévia é um GET: materializar os meses à frente congelaria o valor
    estimado do dia da geração e daria efeito colateral de escrita a uma leitura."""
    cria_conta(db, "Aluguel", dia=15, antes=3)

    lembretes.pendencias(db, HOJE)

    assert db.execute("SELECT COUNT(*) n FROM lancamentos_fixos").fetchone()["n"] == 0
    assert not db.in_transaction


def test_aumento_do_valor_aparece_nos_meses_futuros(db):
    """Antes, gerar o mês seguinte na prévia gravava o valor da época: reajustar a
    conta depois não mudava o aviso, porque a linha já existia com o valor velho."""
    conta = cria_conta(db, "Aluguel", dia=15, valor_cents=120000, antes=3)
    lembretes.pendencias(db, HOJE)                       # "olha" agosto e setembro
    db.execute("UPDATE contas_fixas SET valor_estimado_cents = 150000 WHERE id = ?", (conta,))
    db.commit()

    setembro = lembretes.pendencias(db, date(2026, 9, 12))
    assert [p["valor_cents"] for p in setembro] == [150000]


def test_aviso_antecipado_tem_catch_up(db, enviados):
    """Backend fora do ar no dia exato do aviso não pode perder o lembrete."""
    cria_conta(db, "Internet", dia=18, antes=3)          # aviso "natural" no dia 15

    lembretes.enviar_lembretes(db, date(2026, 8, 16))    # só voltou no dia 16
    assert [e["titulo"] for e in enviados] == ["Vence em 2 dias"]

    enviados.clear()
    lembretes.enviar_lembretes(db, date(2026, 8, 17))    # e não repete depois
    assert enviados == []


def test_job_nao_segura_transacao_durante_a_chamada_de_ia(db, enviados, monkeypatch):
    """A montagem do contexto faz a geração on-access (escreve). Se a transação
    seguir aberta durante a chamada de rede — até ~3 min com os retries — toda
    escrita concorrente do app bate no busy_timeout de 5s e vira 500."""
    from app import openrouter

    cria_conta(db, "Aluguel", dia=10)   # dá o que gerar no contexto
    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.commit()
    visto = {}
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")

    def espiar(_db, _contexto):
        visto["em_transacao"] = db.in_transaction
        return {"sugestao": "ok", "destaques": [], "alertas": []}

    monkeypatch.setattr(openrouter, "gerar_insights", espiar)

    lembretes.enviar_lembretes(db, date(2026, 8, 1))

    assert visto["em_transacao"] is False


def test_insight_ja_analisado_nao_paga_a_ia_de_novo(db, enviados, monkeypatch):
    from app import openrouter

    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.execute("INSERT INTO insights_cache (competencia, dados_json, criado_em) "
               "VALUES ('2026-07', ?, CURRENT_TIMESTAMP)",
               ('{"sugestao": "Do cache", "destaques": [], "alertas": []}',))
    db.commit()
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")
    monkeypatch.setattr(openrouter, "gerar_insights", lambda *_a, **_k: pytest.fail("chamou a IA à toa"))

    lembretes.enviar_lembretes(db, date(2026, 8, 1), forcar=True)

    assert "Do cache" in [e for e in enviados if e["titulo"].startswith("Resumo")][0]["corpo"]


def test_insight_em_formato_inesperado_nao_derruba_o_push(db, enviados, monkeypatch):
    """extrair_json promete dict mas devolve o que o modelo mandar; uma lista
    fazia o .get estourar depois da guarda de erro."""
    from app import openrouter

    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.commit()
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")
    monkeypatch.setattr(openrouter, "gerar_insights", lambda *_a, **_k: ["isto não é um objeto"])

    lembretes.enviar_lembretes(db, date(2026, 8, 1))

    resumo = [e for e in enviados if e["titulo"].startswith("Resumo")]
    assert len(resumo) == 1 and "Saldo R$ 8.000,00" in resumo[0]["corpo"]


def test_mes_sem_movimento_nao_gera_resumo(db, enviados):
    """Instalação nova no dia 2: não há mês fechado para resumir — e nada de
    gastar uma chamada de IA analisando o vazio."""
    lembretes.enviar_lembretes(db, date(2026, 8, 2))
    assert enviados == []


def test_resumo_mensal_usa_a_ia_e_alimenta_o_cache_do_dashboard(db, enviados, monkeypatch):
    from app import openrouter

    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.commit()
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")
    monkeypatch.setattr(openrouter, "gerar_insights", lambda _db, _ctx: {
        "destaques": ["Gastos estáveis"], "alertas": [], "acoes": [],
        "sugestao": "Guarde R$ 500 na meta da viagem.",
    })

    lembretes.enviar_lembretes(db, date(2026, 8, 1))

    resumo = [e for e in enviados if e["titulo"].startswith("Resumo")][0]
    assert "Guarde R$ 500 na meta da viagem." in resumo["corpo"]
    # O Dashboard lê deste cache: o insight do mês fechado já chega pronto lá.
    guardado = db.execute("SELECT dados_json FROM insights_cache WHERE competencia = '2026-07'").fetchone()
    assert guardado and "Gastos estáveis" in guardado["dados_json"]


def test_resumo_mensal_sobrevive_a_falha_da_ia(db, enviados, monkeypatch):
    from app import openrouter

    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, '2026-07-05')")
    db.commit()
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")

    def explode(*_a, **_k):
        raise openrouter.OpenRouterError("provedor fora do ar")

    monkeypatch.setattr(openrouter, "gerar_insights", explode)

    lembretes.enviar_lembretes(db, date(2026, 8, 1))

    resumo = [e for e in enviados if e["titulo"].startswith("Resumo")]
    assert len(resumo) == 1
    assert "Saldo R$ 8.000,00" in resumo[0]["corpo"]


def test_previa_nao_marca_como_enviado(autenticado, db, enviados):
    """A prévia do Config mostra o que sairia; não pode consumir o aviso."""
    # hoje() (America/Sao_Paulo), não date.today(): num host em UTC as duas datas
    # divergem à noite e a conta cairia no dia errado.
    cria_conta(db, "Aluguel", dia=hoje().day)

    r = autenticado.get("/api/push/lembretes")
    assert r.status_code == 200
    assert [n["titulo"] for n in r.json()["notificacoes"]] == ["Vence hoje"]

    assert enviados == []
    assert db.execute("SELECT COUNT(*) n FROM lembretes_enviados").fetchone()["n"] == 0


def test_previa_mostra_o_resumo_do_mes_sem_pagar_a_ia(autenticado, db, monkeypatch):
    """Na janela do resumo (dias 1–5), a prévia tem que listar o resumo mensal:
    ela promete mostrar TUDO que o job enviaria. Mas sem gerar insights — senão
    cada clique em "Ver lembretes de hoje" custaria uma análise de IA."""
    from app import openrouter

    h = hoje()
    if h.day > lembretes.DIA_LIMITE_RESUMO:
        pytest.skip("fora da janela do resumo mensal (dias 1–5)")

    anterior = somar_meses(competencia_de(h), -1)
    db.execute("INSERT INTO entradas (descricao, valor_cents, data) VALUES ('Salário', 800000, ?)",
               (f"{anterior}-05",))
    db.commit()
    monkeypatch.setattr(openrouter, "api_key", lambda _db: "sk-or-falsa")
    monkeypatch.setattr(openrouter, "gerar_insights", lambda _db, _ctx: pytest.fail(
        "a prévia não pode chamar a IA"))

    titulos = [n["titulo"] for n in autenticado.get("/api/push/lembretes").json()["notificacoes"]]

    assert any(t.startswith("Resumo de") for t in titulos), titulos
    assert db.execute("SELECT COUNT(*) n FROM insights_cache").fetchone()["n"] == 0
