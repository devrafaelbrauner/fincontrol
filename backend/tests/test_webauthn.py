"""Passkeys (WebAuthn): registro, login, replay de sign_count e origem inválida.

Os testes não passam por um autenticador de verdade: constroem pares EC P-256,
assinam o que o navegador assinaria e verificam contra o backend. É o nível que
pega regressão de regra (replay, origem, desafio one-shot, 409/404) sem emular
o ceremony inteiro do browser — o ceremony real é validado manualmente no
primeiro cadastro (etapa 6 do plano).
"""

import base64
import hashlib
import json
import os
import struct

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from app import webauthn_routes
from app.db import connect

from .conftest import SENHA

# O TestClient serve como `testserver`: rpId/origin do teste têm de ser os que o
# backend deriva do header Host (ver _rp_id/_origin em webauthn_routes.py).
RP_ID = "testserver"
ORIGIN = "http://testserver"

TABELAS_EXTRA = ("webauthn_credenciais", "webauthn_desafios")


@pytest.fixture(autouse=True)
def webauthn_limpo():
    """Cada teste de passkey começa sem credencial nem desafio pendente."""
    db = connect()
    for t in TABELAS_EXTRA:
        try:
            db.execute(f"DELETE FROM {t}")
        except Exception:
            pass
    db.commit()
    db.close()
    yield


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64url_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login_token(c) -> str:
    auth.limiter.enabled = False
    try:
        r = c.post("/api/auth/login", json={"senha": SENHA})
    finally:
        auth.limiter.enabled = True
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _der_para_raw(sig_der: bytes) -> bytes:
    r, s = decode_dss_signature(sig_der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def _credential_pubkey_cose(chave) -> bytes:
    """COSE_Key ES256 (-7) a partir da chave pública: o que o finish grava."""
    nums = chave.public_key().public_numbers()
    cose = {
        1: 2,       # kty EC2
        3: -7,      # alg ES256
        -1: 1,      # crv P-256
        -2: nums.x.to_bytes(32, "big"),
        -3: nums.y.to_bytes(32, "big"),
    }
    import cbor2

    return cbor2.dumps(cose)


def _fazer_credencial(challenge: bytes, rp_id: str = RP_ID, origin: str = ORIGIN,
                      sign_count: int = 0, chave=None, aaguid: bytes = b"\x00" * 16):
    """Constrói attestation `none` + assertion válidos para o backend verificar."""
    chave = chave or ec.generate_private_key(ec.SECP256R1())
    cred_id = os.urandom(32)
    rp_hash = hashlib.sha256(rp_id.encode()).digest()
    # authData do registro: rpHash + flags(UP+AT) + signCount + attestedCredentialData.
    # attestedCredentialData = aaguid(16) + credIdLen(2) + credId + credentialPublicKey —
    # SEM prefixo 0x0100: esse era um resquício de outro formato e a lib lia como
    # "leftover bytes" no parse.
    coin = aaguid + struct.pack(">H", len(cred_id)) + cred_id + _credential_pubkey_cose(chave)
    auth_data_reg = rp_hash + b"\x41" + struct.pack(">I", 0) + coin
    client_json = json.dumps({"type": "webauthn.create", "challenge": _b64url(challenge), "origin": origin}).encode()
    att_obj = {"fmt": "none", "authData": auth_data_reg, "attStmt": {}}
    import cbor2

    registro = {
        "id": _b64url(cred_id),
        "rawId": _b64url(cred_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": _b64url(client_json),
            "attestationObject": _b64url(cbor2.dumps(att_obj)),
            "transports": ["internal"],
        },
    }
    return chave, cred_id, registro


def _fazer_assertion(chave, cred_id: bytes, challenge: bytes, rp_id: str = RP_ID,
                     origin: str = ORIGIN, sign_count: int = 1) -> dict:
    rp_hash = hashlib.sha256(rp_id.encode()).digest()
    auth_data = rp_hash + b"\x01" + struct.pack(">I", sign_count)
    client_json = json.dumps({"type": "webauthn.get", "challenge": _b64url(challenge), "origin": origin}).encode()
    assinado = auth_data + hashlib.sha256(client_json).digest()
    # O navegador manda a assinatura ECDSA em DER; a lib verifica DER direto
    # (cryptography). Converter para raw r||s aqui quebrava tudo com 401.
    sig = chave.sign(assinado, ec.ECDSA(hashes.SHA256()))
    return {
        "id": _b64url(cred_id),
        "rawId": _b64url(cred_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": _b64url(client_json),
            "authenticatorData": _b64url(auth_data),
            "signature": _b64url(sig),
            "userHandle": _b64url(b"dono"),
        },
    }


def _registrar(c, token: str, chave=None, nome="Mac do Rafael"):
    r = c.post("/api/auth/webauthn/register/begin", json={"nome": nome}, headers=_auth(token))
    assert r.status_code == 200, r.text
    corpo = r.json()
    challenge = _b64url_dec(corpo["opcoes"]["challenge"])
    chave, cred_id, registro = _fazer_credencial(challenge, chave=chave)
    r2 = c.post("/api/auth/webauthn/register/finish",
                json={"token": corpo["token"], "credencial": registro, "nome": nome},
                headers=_auth(token))
    assert r2.status_code == 201, r2.text
    return chave, cred_id


def _logar(c, chave, cred_id: bytes, count: int = 1, rp_id: str = RP_ID, origin: str = ORIGIN):
    r = c.post("/api/auth/webauthn/login/begin", json={})
    assert r.status_code == 200, r.text
    corpo = r.json()
    challenge = _b64url_dec(corpo["opcoes"]["challenge"])
    assertion = _fazer_assertion(chave, cred_id, challenge, rp_id=rp_id, origin=origin, sign_count=count)
    return c.post("/api/auth/webauthn/login/finish", json={"token": corpo["token"], "credencial": assertion})


def test_register_exige_login(cliente):
    assert cliente.post("/api/auth/webauthn/register/begin", json={}).status_code == 401
    assert cliente.post("/api/auth/webauthn/register/finish", json={"token": "x", "credencial": {}}).status_code == 401


def test_register_e_login_funcionam(cliente):
    token = _login_token(cliente)
    chave, cred_id = _registrar(cliente, token)
    r = _logar(cliente, chave, cred_id)
    assert r.status_code == 200, r.text
    assert "token" in r.json()


def test_login_sem_credencial_e_404_para_cair_no_totp(cliente):
    """Sem passkey, o cliente usa senha+TOTP: 404 diz isso sem virar erro."""
    assert cliente.post("/api/auth/webauthn/login/begin", json={}).status_code == 404


def test_register_duplicado_e_409(cliente):
    """A mesma passkey duas vezes: a segunda cai no 409, sem gravar de novo."""
    token = _login_token(cliente)
    chave, cred_id = _registrar(cliente, token)
    # Novo desafio, mas a resposta carrega o MESMO credential_id: reconstruir o
    # registro com o id já gravado (a lib só verifica attestation, não unicidade).
    r = cliente.post("/api/auth/webauthn/register/begin", json={}, headers=_auth(token))
    assert r.status_code == 200, r.text
    challenge2 = _b64url_dec(r.json()["opcoes"]["challenge"])
    # Re-assina um attestation válido para o novo desafio, reutilizando a chave —
    # mas com o credential_id antigo: o servidor deve recusar no 409.
    import cbor2 as _cbor2

    rp_hash = hashlib.sha256(RP_ID.encode()).digest()
    coin = b"\x00" * 16 + struct.pack(">H", len(cred_id)) + cred_id + _credential_pubkey_cose(chave)
    auth_data = rp_hash + b"\x41" + struct.pack(">I", 0) + coin
    client_json = json.dumps({"type": "webauthn.create", "challenge": _b64url(challenge2), "origin": ORIGIN}).encode()
    att_obj = {"fmt": "none", "authData": auth_data, "attStmt": {}}
    registro2 = {
        "id": _b64url(cred_id), "rawId": _b64url(cred_id), "type": "public-key",
        "response": {
            "clientDataJSON": _b64url(client_json),
            "attestationObject": _b64url(_cbor2.dumps(att_obj)),
            "transports": ["internal"],
        },
    }
    r2 = cliente.post("/api/auth/webauthn/register/finish",
                      json={"token": r.json()["token"], "credencial": registro2}, headers=_auth(token))
    assert r2.status_code == 409, r2.text
    db = connect()
    total = db.execute("SELECT COUNT(*) c FROM webauthn_credenciais").fetchone()["c"]
    db.close()
    assert total == 1


def test_replay_de_sign_count_e_barrado(cliente):
    """Contador que não anda = credencial clonada: 401 e o guardado não avança."""
    token = _login_token(cliente)
    chave, cred_id = _registrar(cliente, token)
    assert _logar(cliente, chave, cred_id, count=1).status_code == 200
    db = connect()
    guardado = db.execute("SELECT sign_count FROM webauthn_credenciais").fetchone()["sign_count"]
    db.close()
    assert guardado == 1
    # Repetir o count=1 (replay da assertion anterior com novo desafio falha na
    # assinatura; aqui o teste direto: count menor que o guardado).
    r = _logar(cliente, chave, cred_id, count=1)
    assert r.status_code == 401, r.text
    db = connect()
    ainda = db.execute("SELECT sign_count FROM webauthn_credenciais").fetchone()["sign_count"]
    db.close()
    assert ainda == 1


def test_origem_invalida_e_recusada(cliente):
    """Resposta assinada para outro origin não autentica (anti-phishing)."""
    token = _login_token(cliente)
    chave, cred_id = _registrar(cliente, token)
    r = _logar(cliente, chave, cred_id, origin="https://site-do-atacante.example")
    assert r.status_code == 401, r.text


def test_desafio_e_one_shot(cliente):
    """O mesmo finish duas vezes: a segunda cai (desafio consumido)."""
    token = _login_token(cliente)
    chave, cred_id = _registrar(cliente, token)
    r = cliente.post("/api/auth/webauthn/login/begin", json={})
    corpo = r.json()
    challenge = _b64url_dec(corpo["opcoes"]["challenge"])
    assertion = _fazer_assertion(chave, cred_id, challenge, sign_count=5)
    payload = {"token": corpo["token"], "credencial": assertion}
    assert cliente.post("/api/auth/webauthn/login/finish", json=payload).status_code == 200
    assert cliente.post("/api/auth/webauthn/login/finish", json=payload).status_code == 400


def test_cadastro_com_conta_existente_continua_409(cliente):
    """Passkeys não abrem segunda conta: o cadastro segue 409."""
    r = cliente.post("/api/auth/cadastro", json={"nome": "Outro", "email": "outro@x.com", "senha": "Aa!123456"})
    assert r.status_code == 409


def test_senha_totp_intactos_apos_passkey(cliente):
    """Cadastrar passkey não desliga a senha: o login antigo continua valendo."""
    token = _login_token(cliente)
    _registrar(cliente, token)
    auth.limiter.enabled = False
    try:
        r = cliente.post("/api/auth/login", json={"senha": SENHA})
    finally:
        auth.limiter.enabled = True
    assert r.status_code == 200, r.text


def test_status_publico_nao_cria_desafio(cliente):
    """O login pergunta se há passkey sem gastar o begin (rate limit + desafio)."""
    r = cliente.get("/api/auth/webauthn/status")
    assert r.status_code == 200
    assert r.json() == {"cadastrado": False}
    token = _login_token(cliente)
    _registrar(cliente, token)
    r = cliente.get("/api/auth/webauthn/status")
    assert r.json() == {"cadastrado": True}
    db = connect()
    n = db.execute("SELECT COUNT(*) c FROM webauthn_desafios WHERE tipo = 'login'").fetchone()["c"]
    db.close()
    assert n == 0


def test_producao_exige_rpid_e_origin(cliente, monkeypatch):
    """Em produção o Host do request NÃO vira rpId — é o que impede phishing."""
    monkeypatch.setenv("FINCONTROL_ENV", "production")
    monkeypatch.setattr(webauthn_routes, "RP_ID", None)
    monkeypatch.setattr(webauthn_routes, "ORIGIN", None)
    token = _login_token(cliente)
    r = cliente.post("/api/auth/webauthn/register/begin", json={}, headers=_auth(token))
    assert r.status_code == 500, r.text
