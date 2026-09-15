"""Rotação de refresh token: o que distingue vazamento de sessão só encerrada.

O ponto sensível é o /refresh reagir a um jti que não está mais vigente. Se ele
tratar TODO jti ausente como reuso de token vazado, o teto de sessões simultâneas
vira um canhão: passar de MAX_SESSOES derruba todas as sessões do dono de uma vez.
"""
import time

import pyotp

from app import auth
from app.db import connect

from .conftest import SENHA

NATIVO = {"X-Client": "native", "Origin": "capacitor://localhost"}


def _login(c, **corpo):
    r = c.post("/api/auth/login", json={"senha": SENHA, **corpo}, headers=NATIVO)
    assert r.status_code == 200, r.text
    # O endpoint prefere o cookie ao header; limpar isola o fluxo do app nativo.
    c.cookies.clear()
    return r.json()["refresh_token"]


def _refresh(c, token):
    c.cookies.clear()
    return c.post("/api/auth/refresh", headers={**NATIVO, "X-Refresh-Token": token})


def test_refresh_rotaciona_o_token(cliente):
    inicial = _login(cliente)
    r = _refresh(cliente, inicial)
    assert r.status_code == 200
    novo = r.json()["refresh_token"]
    assert novo != inicial
    assert _refresh(cliente, novo).status_code == 200


def _envelhecer_graca(segundos: int = 3600) -> None:
    """Recua o `rotacionado_em` das linhas em graça, simulando tempo decorrido.

    Mexer no relógio é mais honesto do que zerar JANELA_GRACA_SEGUNDOS: o que se
    quer testar é o comportamento DEPOIS da janela, não uma configuração
    diferente da de produção.
    """
    db = connect()
    db.execute("UPDATE refresh_tokens SET rotacionado_em = rotacionado_em - ? "
               "WHERE rotacionado_em IS NOT NULL", (segundos,))
    db.commit()
    db.close()


def test_reuso_fora_da_janela_de_graca_revoga_todas_as_sessoes(cliente):
    """Token já gasto reaparecendo MUITO depois = provável vazamento: derruba a
    família toda. É o que a janela de graça não pode ter enfraquecido."""
    vazado = _login(cliente)
    outra_sessao = _login(cliente)
    corrente = _refresh(cliente, vazado).json()["refresh_token"]
    _envelhecer_graca()

    r = _refresh(cliente, vazado)
    assert r.status_code == 401
    assert "revogado" in r.json()["detail"]
    # A revogação vale para tudo, inclusive para quem não estava envolvido.
    assert _refresh(cliente, corrente).status_code == 401
    assert _refresh(cliente, outra_sessao).status_code == 401


def test_jti_nunca_emitido_revoga_tudo(cliente):
    """Token forjado com jti inventado (assinatura válida) continua sendo alarme."""
    import time as _t

    import jwt as _jwt

    sessao = _login(cliente)
    forjado = _jwt.encode(
        {"sub": "dono", "type": "refresh", "ver": 0, "jti": "0" * 32,
         "exp": int(_t.time()) + 3600},
        auth.SECRET_KEY, algorithm="HS256",
    )
    r = _refresh(cliente, forjado)
    assert r.status_code == 401 and "revogado" in r.json()["detail"]
    assert _refresh(cliente, sessao).status_code == 401


# ---------- corrida de renovação (o defeito que motivou a janela) ----------

def test_replay_dentro_da_graca_devolve_o_sucessor_sem_revogar_nada(cliente):
    """A segunda de N chamadas simultâneas chega com o token já rotacionado.

    Antes isso era lido como vazamento e zerava a tabela de sessões — um F5 no
    navegador derrubava iPhone e Mac. Agora a resposta é idempotente.
    """
    outro_aparelho = _login(cliente)
    inicial = _login(cliente)

    primeiro = _refresh(cliente, inicial)
    assert primeiro.status_code == 200
    sucessor = primeiro.json()["refresh_token"]

    # Mesmo token, de novo — a chamada que perdeu a corrida:
    segundo = _refresh(cliente, inicial)
    assert segundo.status_code == 200
    assert segundo.json()["refresh_token"] == sucessor, "deve devolver o MESMO sucessor"

    # E ninguém foi derrubado:
    assert _refresh(cliente, outro_aparelho).status_code == 200
    assert _refresh(cliente, sucessor).status_code == 200


def test_replay_em_graca_nao_multiplica_sessoes(cliente):
    """Rotacionar a cada chamada em corrida encheria a tabela de sessões órfãs,
    empurrando aparelhos ociosos contra o teto."""
    _login(cliente)
    inicial = _login(cliente)
    corrente = _refresh(cliente, inicial).json()["refresh_token"]
    for _ in range(5):
        assert _refresh(cliente, inicial).status_code == 200

    db = connect()
    vivas = db.execute("SELECT COUNT(*) n FROM refresh_tokens WHERE rotacionado_em IS NULL").fetchone()["n"]
    db.close()
    assert vivas == 2, "duas sessões de verdade, sem órfãs"
    assert _refresh(cliente, corrente).status_code == 200


def test_seis_renovacoes_simultaneas_nao_derrubam_os_outros_aparelhos(cliente):
    """Reprodução do defeito original: 6 chamadas paralelas com o MESMO token
    zeravam a tabela e deslogavam aparelhos que não tinham feito nada."""
    import threading

    from fastapi.testclient import TestClient

    from app.main import app

    mac = _login(cliente)
    iphone = _login(cliente)

    resultados: list[int | None] = [None] * 6

    def renova(i: int) -> None:
        c = TestClient(app)
        resultados[i] = c.post(
            "/api/auth/refresh", headers={**NATIVO, "X-Refresh-Token": iphone}
        ).status_code

    threads = [threading.Thread(target=renova, args=(i,)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert all(s == 200 for s in resultados), f"toda renovação em graça deve passar: {resultados}"
    # O invariante que importa, seja qual for o entrelaçamento:
    assert _refresh(cliente, mac).status_code == 200, "o Mac não fez nada e não pode cair"

    # E o compare-and-swap da rotação: uma única troca, sem sessões órfãs. Sem
    # ele, as 6 rotacionavam em paralelo (todas leem "vigente" antes de qualquer
    # escrita) e sobravam 5 sessões fantasma empurrando aparelhos contra o teto.
    db = connect()
    vivas = db.execute(
        "SELECT COUNT(*) n FROM refresh_tokens WHERE rotacionado_em IS NULL AND vigente = 1"
    ).fetchone()["n"]
    db.close()
    assert vivas == 2, f"Mac + iPhone renovado, sem órfãs (encontradas {vivas})"


def test_despejo_por_lotacao_nao_derruba_as_outras_sessoes(cliente):
    """Regressão: o despejo do jti mais antigo era lido como reuso, e um 11º login
    revogava as 10 sessões anteriores junto."""
    tokens = [_login(cliente) for _ in range(auth.MAX_SESSOES + 1)]

    r = _refresh(cliente, tokens[0])
    assert r.status_code == 401
    assert "revogado" not in r.json()["detail"]  # não é vazamento, é lotação

    sobreviventes = sum(1 for t in tokens[1:] if _refresh(cliente, t).status_code == 200)
    assert sobreviventes == auth.MAX_SESSOES


def test_logout_exige_refresh_token_valido(cliente):
    """Sem isso a rota seria um DoS anônimo: derrubar as sessões em loop."""
    sessao = _login(cliente)

    cliente.cookies.clear()
    assert cliente.post("/api/auth/logout").status_code == 200
    assert _refresh(cliente, sessao).status_code == 200, "logout anônimo não pode revogar nada"

    assert cliente.post("/api/auth/logout", headers={**NATIVO, "X-Refresh-Token": sessao}).status_code == 200


def test_logout_encerra_so_este_aparelho(cliente):
    """Sair no navegador do trabalho não pode derrubar o iPhone no meio do uso."""
    iphone = _login(cliente)
    web = _login(cliente)

    cliente.cookies.clear()
    assert cliente.post("/api/auth/logout", headers={**NATIVO, "X-Refresh-Token": web}).status_code == 200

    assert _refresh(cliente, web).status_code == 401, "o aparelho que saiu não renova mais"
    assert _refresh(cliente, iphone).status_code == 200, "o iPhone continua logado"


def test_logout_todos_derruba_todo_mundo(cliente):
    """A revogação global vira exceção explícita (aparelho perdido), não o padrão."""
    iphone = _login(cliente)
    web = _login(cliente)

    cliente.cookies.clear()
    r = cliente.post("/api/auth/logout?todos=1", headers={**NATIVO, "X-Refresh-Token": web})
    assert r.status_code == 200

    assert _refresh(cliente, web).status_code == 401
    assert _refresh(cliente, iphone).status_code == 401


def test_logout_nao_deixa_o_antecessor_em_graca_ressuscitar_a_sessao(cliente):
    """Sair logo depois de renovar: o token anterior ainda está na janela e
    devolveria o sucessor recém-revogado se a cadeia não fosse apagada junto."""
    anterior = _login(cliente)
    atual = _refresh(cliente, anterior).json()["refresh_token"]

    cliente.cookies.clear()
    assert cliente.post("/api/auth/logout", headers={**NATIVO, "X-Refresh-Token": atual}).status_code == 200

    assert _refresh(cliente, atual).status_code == 401
    assert _refresh(cliente, anterior).status_code == 401, "o antecessor em graça não pode reabrir a sessão"


def test_x_client_native_em_origem_web_nao_devolve_refresh(cliente):
    """Header X-Client é forjável no browser; Origin web não recebe o token no JSON."""
    r = cliente.post("/api/auth/login", json={"senha": SENHA},
                     headers={"X-Client": "native", "Origin": "https://fincontrol.exemplo.com"})
    assert r.status_code == 200, r.text
    assert "refresh_token" not in r.json()


def test_origem_nativa_devolve_refresh(cliente):
    r = cliente.post("/api/auth/login", json={"senha": SENHA}, headers=NATIVO)
    assert r.status_code == 200, r.text
    assert r.json()["refresh_token"]


def test_setup_user_bumpa_refresh_version(cliente, monkeypatch):
    """Redefinir senha via SSH derruba as sessões abertas."""
    from app import setup_user

    refresh = _login(cliente)
    db = connect()
    ver_antes = int(auth.config_get(db, "refresh_version") or "0")
    db.close()

    senhas = iter(["NovaSenha-1234", "NovaSenha-1234"])
    monkeypatch.setattr(setup_user.getpass, "getpass", lambda *a, **k: next(senhas))
    monkeypatch.setattr("builtins.input", lambda *a, **k: "n")
    setup_user.main()

    db = connect()
    ver_depois = int(auth.config_get(db, "refresh_version") or "0")
    restam = db.execute("SELECT COUNT(*) n FROM refresh_tokens").fetchone()["n"]
    db.close()
    assert ver_depois == ver_antes + 1
    assert restam == 0
    assert _refresh(cliente, refresh).status_code == 401


def test_codigo_totp_nao_vale_duas_vezes_mesmo_com_login_intercalado(cliente):
    """Regressão: guardando só o ÚLTIMO código usado, bastava logar com o código
    seguinte para liberar o replay do anterior dentro da janela de validade."""
    segredo = pyotp.random_base32()
    db = connect()
    auth._config_set(db, "totp_secret", segredo)
    db.commit()
    db.close()

    totp = pyotp.TOTP(segredo)
    agora = int(time.time())
    atual = totp.at(agora)
    anterior = totp.at(agora - 30)
    if anterior == atual:  # na borda do passo, recua mais um
        anterior = totp.at(agora - 60)

    def login_totp(codigo):
        return cliente.post("/api/auth/login", json={"senha": SENHA, "codigo_totp": codigo})

    assert login_totp(anterior).status_code == 200
    assert login_totp(atual).status_code == 200
    assert login_totp(anterior).status_code == 401
