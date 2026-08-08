"""A conversa do assistente é memória, não só histórico de tela.

O que este arquivo protege, em duas frentes:

1. PERSISTÊNCIA — antes a conversa vivia só no estado do React. Um F5, trocar
   de aba ou abrir o app no celular começava do zero.
2. CONTEXTO — cada pergunta chegava ao modelo ISOLADA, então "e no mês
   passado?" não tinha a que se referir. O teste mais importante daqui é o que
   confere que as falas anteriores de fato entram na chamada.

Os limites (`MEMORIA_FALAS`, `MEMORIA_CARACTERES`) existem porque cada token
enviado é pago; sem eles a centésima pergunta carregaria as 99 anteriores.
"""

import pytest

from app.db import connect
from app.routers import ia


@pytest.fixture
def db():
    conn = connect()
    conn.execute("DELETE FROM conversa_mensagens")
    conn.commit()
    yield conn
    conn.execute("DELETE FROM conversa_mensagens")
    conn.commit()
    conn.close()


@pytest.fixture
def modelo(monkeypatch):
    """Captura as mensagens que iriam para o modelo e devolve resposta fixa."""
    chamadas = []

    def falso(db, mensagens, espera_json=False, max_tokens=700):
        chamadas.append(mensagens)
        return "  resposta do modelo  "

    monkeypatch.setattr("app.openrouter.chamar", falso)
    return chamadas


def perguntar(cliente, texto):
    return cliente.post("/api/ia/perguntar", json={"pergunta": texto})


def test_pergunta_e_resposta_ficam_guardadas(db, autenticado, modelo):
    assert perguntar(autenticado, "Quanto gastei?").status_code == 200
    linhas = db.execute("SELECT papel, texto FROM conversa_mensagens ORDER BY id").fetchall()
    assert [(r["papel"], r["texto"]) for r in linhas] == [
        ("user", "Quanto gastei?"),
        ("assistant", "resposta do modelo"),   # gravado já sem os espaços das pontas
    ]


def test_a_conversa_volta_depois_do_reload(db, autenticado, modelo):
    perguntar(autenticado, "Primeira")
    perguntar(autenticado, "Segunda")
    r = autenticado.get("/api/ia/conversa")
    assert r.status_code == 200
    assert [m["texto"] for m in r.json()["mensagens"]] == [
        "Primeira", "resposta do modelo", "Segunda", "resposta do modelo",
    ]


def test_falas_anteriores_chegam_ao_modelo(db, autenticado, modelo):
    """É isto que faz "e no mês passado?" funcionar."""
    perguntar(autenticado, "Quanto gastei em julho?")
    perguntar(autenticado, "E no mês passado?")

    papeis = [(m["role"], m["content"]) for m in modelo[-1]]
    assert papeis[0][0] == "system"
    # A rodada anterior aparece, na ordem em que aconteceu.
    assert ("user", "Quanto gastei em julho?") in papeis
    assert ("assistant", "resposta do modelo") in papeis
    # E a pergunta atual é a ÚLTIMA, junto do contexto recalculado.
    assert papeis[-1][0] == "user"
    assert "E no mês passado?" in papeis[-1][1]
    assert "Contexto (dados reais" in papeis[-1][1]


def test_contexto_atual_vem_depois_do_historico(db, autenticado, modelo):
    """Falas antigas carregam números de quando foram ditas. O contexto é
    recalculado a cada pergunta, então ele precisa ser a última coisa que o
    modelo lê — senão um lançamento feito no meio da conversa fica perdendo
    para um valor citado três perguntas atrás."""
    perguntar(autenticado, "Primeira")
    perguntar(autenticado, "Segunda")
    conteudos = [m["content"] for m in modelo[-1]]
    ultimo_historico = max(i for i, c in enumerate(conteudos) if "Contexto" not in c)
    indice_contexto = max(i for i, c in enumerate(conteudos) if "Contexto (dados reais" in c)
    assert indice_contexto > ultimo_historico


def test_memoria_para_no_limite_de_falas(db, autenticado, modelo):
    for i in range(ia.MEMORIA_FALAS):     # cada uma gera 2 falas
        perguntar(autenticado, f"P{i}")
    enviados = [m for m in modelo[-1] if m["role"] != "system"]
    # -1 porque a última mensagem é a pergunta atual, que não vem do histórico.
    assert len(enviados) - 1 <= ia.MEMORIA_FALAS


def test_memoria_corta_pelas_falas_mais_antigas(db, autenticado, modelo, monkeypatch):
    """Estourado o teto de caracteres, quem sai é o começo da conversa — o fio
    recente é o que dá sentido a uma pergunta de continuação."""
    monkeypatch.setattr(ia, "MEMORIA_CARACTERES", 120)
    perguntar(autenticado, "ANTIGA " + "x" * 100)
    perguntar(autenticado, "RECENTE")
    perguntar(autenticado, "atual")
    conteudos = " ".join(m["content"] for m in modelo[-1])
    assert "RECENTE" in conteudos
    assert "ANTIGA" not in conteudos


def test_falha_do_modelo_nao_deixa_pergunta_pendurada(db, autenticado, monkeypatch):
    """Sem isto, a pergunta ficaria gravada sem par e iria para a chamada
    seguinte como se tivesse sido respondida."""
    def explode(*_a, **_k):
        raise ia.OpenRouterError("modelo fora do ar")
    monkeypatch.setattr("app.openrouter.chamar", explode)

    assert perguntar(autenticado, "Vai falhar").status_code == 502
    assert db.execute("SELECT COUNT(*) n FROM conversa_mensagens").fetchone()["n"] == 0


def test_apagar_conversa_zera_a_memoria(db, autenticado, modelo):
    perguntar(autenticado, "Alguma coisa")
    assert autenticado.delete("/api/ia/conversa").status_code == 200
    assert autenticado.get("/api/ia/conversa").json()["mensagens"] == []
    # E a próxima pergunta vai sem histórico nenhum.
    perguntar(autenticado, "Depois de apagar")
    assert len([m for m in modelo[-1] if m["role"] != "system"]) == 1


def test_pergunta_vazia_e_recusada(db, autenticado, modelo):
    assert perguntar(autenticado, "   ").status_code == 422
    assert db.execute("SELECT COUNT(*) n FROM conversa_mensagens").fetchone()["n"] == 0


def test_thread_guardada_tem_teto(db, autenticado, modelo, monkeypatch):
    """Log de IA que só cresce vira um arquivo grande em silêncio dentro do
    backup diário."""
    monkeypatch.setattr(ia, "HISTORICO_GUARDADO", 4)
    for i in range(5):
        perguntar(autenticado, f"P{i}")
    n = db.execute("SELECT COUNT(*) n FROM conversa_mensagens").fetchone()["n"]
    assert n <= 4
    # O que sobrou é o FIM da conversa, não o começo.
    ultima = db.execute("SELECT texto FROM conversa_mensagens ORDER BY id DESC LIMIT 1").fetchone()
    assert ultima["texto"] == "resposta do modelo"
    assert db.execute(
        "SELECT COUNT(*) n FROM conversa_mensagens WHERE texto = 'P0'").fetchone()["n"] == 0
