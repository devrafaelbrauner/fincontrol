"""Login em duas etapas: a senha é conferida antes de pedir o código do MFA."""
import pyotp

from app import auth
from app.db import connect

from .conftest import SENHA


def _com_mfa() -> pyotp.TOTP:
    segredo = pyotp.random_base32()
    db = connect()
    auth._config_set(db, "totp_secret", segredo)
    db.commit()
    db.close()
    return pyotp.TOTP(segredo)


def test_senha_certa_sem_codigo_pede_o_segundo_fator(cliente):
    _com_mfa()
    r = cliente.post("/api/auth/login", json={"senha": SENHA})
    assert r.status_code == 401
    # O frontend usa este detalhe para trocar para a tela do código.
    assert r.json()["detail"] == "codigo_totp_necessario"


def test_senha_errada_nao_revela_que_falta_o_codigo(cliente):
    """O sinal de 'falta o código' confirma que a senha está certa; ele não pode
    aparecer para quem errou a senha."""
    _com_mfa()
    r = cliente.post("/api/auth/login", json={"senha": "senha-errada-123!"})
    assert r.status_code == 401
    assert r.json()["detail"] != "codigo_totp_necessario"


def test_login_completo_com_codigo_valido(cliente):
    totp = _com_mfa()
    r = cliente.post("/api/auth/login", json={"senha": SENHA, "codigo_totp": totp.now()})
    assert r.status_code == 200
    assert r.json()["token"]


def test_mfa_reenrolment_recusado_sem_fator_vigente(autenticado):
    """Sessão logada não troca o 2FA sem o código atual (ou a senha)."""
    _com_mfa()
    r = autenticado.post("/api/auth/mfa/iniciar", json={})
    assert r.status_code == 403
    r = autenticado.post("/api/auth/mfa/confirmar", json={"codigo": "000000"})
    assert r.status_code == 403


def test_mfa_reenrolment_aceita_totp_atual(autenticado):
    totp = _com_mfa()
    r = autenticado.post("/api/auth/mfa/iniciar", json={"codigo_totp": totp.now()})
    assert r.status_code == 200, r.text
    assert r.json()["secret"]
    novo = pyotp.TOTP(r.json()["secret"])
    r = autenticado.post("/api/auth/mfa/confirmar", json={"codigo": novo.now(), "senha": SENHA})
    assert r.status_code == 200, r.text
    assert r.json()["ativo"] is True


def test_mfa_primeira_ativacao_nao_pede_fator(autenticado):
    r = autenticado.post("/api/auth/mfa/iniciar", json={})
    assert r.status_code == 200, r.text
    novo = pyotp.TOTP(r.json()["secret"])
    r = autenticado.post("/api/auth/mfa/confirmar", json={"codigo": novo.now()})
    assert r.status_code == 200, r.text


def test_cookie_de_sessao_quando_lembrar_e_falso(cliente):
    """lembrar=False → cookie sem Max-Age, que morre ao fechar o navegador."""
    r = cliente.post("/api/auth/login", json={"senha": SENHA, "lembrar": False})
    assert r.status_code == 200
    assert "max-age" not in r.headers["set-cookie"].lower()

    r = cliente.post("/api/auth/login", json={"senha": SENHA, "lembrar": True})
    assert "max-age" in r.headers["set-cookie"].lower()
