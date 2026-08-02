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


def test_cookie_de_sessao_quando_lembrar_e_falso(cliente):
    """lembrar=False → cookie sem Max-Age, que morre ao fechar o navegador."""
    r = cliente.post("/api/auth/login", json={"senha": SENHA, "lembrar": False})
    assert r.status_code == 200
    assert "max-age" not in r.headers["set-cookie"].lower()

    r = cliente.post("/api/auth/login", json={"senha": SENHA, "lembrar": True})
    assert "max-age" in r.headers["set-cookie"].lower()
