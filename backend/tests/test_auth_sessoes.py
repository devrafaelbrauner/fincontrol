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

NATIVO = {"X-Client": "native"}


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


def test_reuso_de_token_rotacionado_revoga_todas_as_sessoes(cliente):
    """Token já gasto reaparecendo = provável vazamento: derruba a família toda."""
    vazado = _login(cliente)
    outra_sessao = _login(cliente)
    corrente = _refresh(cliente, vazado).json()["refresh_token"]

    r = _refresh(cliente, vazado)
    assert r.status_code == 401
    assert "revogado" in r.json()["detail"]
    # A revogação vale para tudo, inclusive para quem não estava envolvido.
    assert _refresh(cliente, corrente).status_code == 401
    assert _refresh(cliente, outra_sessao).status_code == 401


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
