"""Cadastro de primeiro uso: cria a conta única e nunca sobrescreve a existente."""
from app import auth
from app.db import connect

from .conftest import SENHA

CONTA = {
    "nome": "Fulano",
    "email": "fulano@exemplo.com",
    "senha": "senha-forte-123!",
}


def _sem_conta():
    db = connect()
    db.execute("DELETE FROM config WHERE chave = 'senha_hash'")
    db.commit()
    db.close()


def test_status_reflete_se_ha_conta(cliente):
    assert cliente.get("/api/auth/status").json()["configurado"] is True
    _sem_conta()
    assert cliente.get("/api/auth/status").json()["configurado"] is False


def test_cadastro_cria_conta_e_ja_autentica(cliente):
    _sem_conta()
    r = cliente.post("/api/auth/cadastro", json=CONTA)
    assert r.status_code == 201, r.text
    assert r.json()["nome"] == "Fulano"
    assert r.json()["token"]
    assert cliente.post("/api/auth/login", json={"senha": CONTA["senha"]}).status_code == 200


def test_cadastro_nao_sobrescreve_conta_existente(cliente):
    """A senha do dono não pode ser trocada por quem achar a URL."""
    r = cliente.post("/api/auth/cadastro", json=CONTA)
    assert r.status_code == 409

    # A senha original continua valendo, a do invasor não.
    assert cliente.post("/api/auth/login", json={"senha": SENHA}).status_code == 200
    assert cliente.post("/api/auth/login", json={"senha": CONTA["senha"]}).status_code == 401


def test_senha_curta_e_recusada(cliente):
    _sem_conta()
    curta = {**CONTA, "senha": "abc1!"}
    r = cliente.post("/api/auth/cadastro", json=curta)
    assert r.status_code == 422
    assert str(auth.SENHA_MINIMA) in r.json()["detail"]


def test_senha_sem_variedade_e_recusada(cliente):
    _sem_conta()
    for senha in ("senhalongasemnumero!", "senhalonga1234567890", "SENHALONGA1234567890"):
        r = cliente.post("/api/auth/cadastro", json={**CONTA, "senha": senha})
        assert r.status_code == 422, f"{senha!r} deveria ser recusada"


def test_email_invalido_e_recusado(cliente):
    _sem_conta()
    r = cliente.post("/api/auth/cadastro", json={**CONTA, "email": "sem-arroba"})
    assert r.status_code == 422
