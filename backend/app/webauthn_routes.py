"""Passkeys (WebAuthn): registro + login sem senha.

Quatro rotas, duas cerimônias:

  register (autenticado — exige Bearer): o dono prova quem é com a sessão atual
  e cadastra o aparelho (`begin` devolve as opções, `finish` verifica a resposta
  e grava a credencial). Sem sessão não há registro: passkey nova é ato do dono
  logado, nunca de visitante.

  login (público, com rate limit): `begin` devolve o desafio (+ a lista de
  credenciais conhecidas), `finish` verifica a assinatura e — só então — emite a
  MESMA sessão que o /login por senha emitiria (access + refresh, cookie +
  corpo nativo). Não há "sessão de passkey": depois do finish, é uma sessão
  normal, com a mesma rotação e o mesmo teto.

Segurança que importa aqui:

  - `rpId`/`origin` vêm do host de produção via env, nunca de header nem de
    localhost em prod: a verificação da lib recusa respostas de outra origem, e
    é isso que impede um site atacante de usar a passkey do dono.
  - `sign_count`: contador que só anda para frente. Resposta com contador menor
    ou igual ao guardado (e diferente de zero) = credencial clonada -> 401 e a
    credencial é marcada (ultimo_uso não avança; o dono vê e remove).
  - Desafio one-shot de 5 min, guardado no banco: replay do mesmo finish falha
    (desafio consumido), e restart do backend entre begin/finish não perde nada.
  - TOTP + senha continuam intactos: passkey é caminho alternativo, não
    substituto. Conta sem passkey cadastrada faz login como antes.
"""

import json
import os
import secrets
import sqlite3
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json
from webauthn.helpers.structs import PublicKeyCredentialDescriptor

from .auth import (
    _cliente_nativo,
    _emitir_access,
    _emitir_refresh,
    _set_cookie,
    config_get,
    limiter,
)
from .db import get_db

router = APIRouter(prefix="/auth/webauthn", tags=["webauthn"])

# Relying party: quem o autenticador mostra ao dono ("FinControl") e o sufixo
# de domínio que a credencial fica presa (rpId). Em dev, localhost; em produção,
# o host real — via env, nunca via header (header mente).
RP_NOME = "FinControl"
RP_ID = os.environ.get("FINCONTROL_WEBAUTHN_RP_ID", "").strip() or None
ORIGIN = os.environ.get("FINCONTROL_WEBAUTHN_ORIGIN", "").strip() or None

DESAFIO_TTL_SEGUNDOS = 5 * 60


def _eh_producao() -> bool:
    return os.environ.get("FINCONTROL_ENV", "dev").strip().lower() in ("production", "prod")


def _rp_id(request: Request) -> str:
    if RP_ID:
        return RP_ID
    if _eh_producao():
        raise HTTPException(500, "FINCONTROL_WEBAUTHN_RP_ID obrigatório em produção")
    host = (request.headers.get("host") or "").split(":")[0]
    return host or "localhost"


def _origin(request: Request) -> str:
    if ORIGIN:
        return ORIGIN
    if _eh_producao():
        raise HTTPException(500, "FINCONTROL_WEBAUTHN_ORIGIN obrigatório em produção")
    proto = request.headers.get("x-forwarded-proto", "http")
    host = request.headers.get("host", "localhost")
    return f"{proto}://{host}"


def _rejeitar_localhost_em_prod(rp_id: str, origin: str) -> None:
    """localhost em produção é configuração errada — e silenciosa: o registro
    funcionaria no dev e o login real falharia, com erro só no autenticador."""
    if not _eh_producao():
        return
    if rp_id in ("localhost", "127.0.0.1", "::1") or "localhost" in origin or "127.0.0.1" in origin:
        raise HTTPException(500, "WebAuthn mal configurado: FINCONTROL_WEBAUTHN_RP_ID/ORIGIN com localhost em produção")


def _purgar_desafios(db: sqlite3.Connection) -> None:
    db.execute("DELETE FROM webauthn_desafios WHERE criado_em <= ?", (int(time.time()) - DESAFIO_TTL_SEGUNDOS,))


def _guardar_desafio(db: sqlite3.Connection, tipo: str, challenge: bytes, credential_id: str | None = None) -> str:
    _purgar_desafios(db)
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO webauthn_desafios (id, tipo, challenge, criado_em, credential_id) VALUES (?, ?, ?, ?, ?)",
        (token, tipo, challenge, int(time.time()), credential_id),
    )
    return token


def _consumir_desafio(db: sqlite3.Connection, token: str, tipo: str) -> tuple[bytes, str | None]:
    row = db.execute("SELECT challenge, criado_em, credential_id FROM webauthn_desafios WHERE id = ? AND tipo = ?", (token, tipo)).fetchone()
    if row is None:
        raise HTTPException(400, "Desafio expirado ou inválido — recomece")
    db.execute("DELETE FROM webauthn_desafios WHERE id = ?", (token,))
    if int(time.time()) - row["criado_em"] > DESAFIO_TTL_SEGUNDOS:
        raise HTTPException(400, "Desafio expirado — recomece")
    return bytes(row["challenge"]), row["credential_id"]


def _credenciais(db: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(db.execute("SELECT * FROM webauthn_credenciais"))


class BeginRegisterBody(BaseModel):
    nome: str | None = None


class FinishRegisterBody(BaseModel):
    token: str
    credencial: dict
    nome: str | None = None


class FinishLoginBody(BaseModel):
    token: str
    credencial: dict


def _exigir_configurado(db: sqlite3.Connection) -> None:
    if not config_get(db, "senha_hash"):
        raise HTTPException(503, "Usuário não configurado — rode: python -m app.setup_user")


@router.get("/status")
def webauthn_status(db: sqlite3.Connection = Depends(get_db)):
    """Público: o login decide se mostra passkey primeiro, sem criar desafio."""
    return {"cadastrado": bool(_credenciais(db))}


@router.post("/register/begin")
def register_begin(request: Request, body: BeginRegisterBody, db: sqlite3.Connection = Depends(get_db),
                   authorization: str | None = Header(default=None)):
    """Inicia o registro: exige sessão (o dono logado cadastra o aparelho)."""
    from .auth import require_auth

    require_auth(authorization)
    _exigir_configurado(db)
    rp_id, origin = _rp_id(request), _origin(request)
    _rejeitar_localhost_em_prod(rp_id, origin)
    existentes = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["id"])) for r in _credenciais(db)]
    opcoes = generate_registration_options(
        rp_id=rp_id, rp_name=RP_NOME, user_name=config_get(db, "perfil_email") or "dono",
        user_id=b"dono", user_display_name=config_get(db, "perfil_nome") or "dono",
        exclude_credentials=existentes or None,
    )
    token = _guardar_desafio(db, "register", opcoes.challenge)
    resposta = json.loads(options_to_json(opcoes))
    return {"token": token, "opcoes": resposta, "nome": body.nome}


@router.post("/register/finish", status_code=201)
def register_finish(request: Request, body: FinishRegisterBody, db: sqlite3.Connection = Depends(get_db),
                    authorization: str | None = Header(default=None)):
    from .auth import require_auth

    require_auth(authorization)
    _exigir_configurado(db)
    rp_id, origin = _rp_id(request), _origin(request)
    _rejeitar_localhost_em_prod(rp_id, origin)
    challenge, _ = _consumir_desafio(db, body.token, "register")
    try:
        verificado = verify_registration_response(
            credential=body.credencial, expected_challenge=challenge,
            expected_rp_id=rp_id, expected_origin=origin,
        )
    except Exception:
        raise HTTPException(400, "Registro de passkey inválido")
    cred_id = bytes_to_base64url(verificado.credential_id)
    if db.execute("SELECT 1 FROM webauthn_credenciais WHERE id = ?", (cred_id,)).fetchone():
        raise HTTPException(409, "Esta passkey já está cadastrada")
    nome = (body.nome or "").strip() or None
    transports = body.credencial.get("response", {}).get("transports")
    db.execute(
        "INSERT INTO webauthn_credenciais (id, public_key, sign_count, transports, nome)"
        " VALUES (?, ?, ?, ?, ?)",
        (cred_id, verificado.credential_public_key, verificado.sign_count,
         json.dumps(transports) if isinstance(transports, list) else None, nome),
    )
    return {"ok": True, "id": cred_id}


@router.post("/login/begin")
@limiter.limit("10/minute")
def login_begin(request: Request, db: sqlite3.Connection = Depends(get_db)):
    """Inicia o login por passkey (público). 404 quando não há credencial:
    o cliente cai para senha+TOTP sem tratar como erro."""
    _exigir_configurado(db)
    creds = _credenciais(db)
    if not creds:
        raise HTTPException(404, "Nenhuma passkey cadastrada")
    rp_id, origin = _rp_id(request), _origin(request)
    _rejeitar_localhost_em_prod(rp_id, origin)
    permitir = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["id"])) for r in creds]
    opcoes = generate_authentication_options(rp_id=rp_id, allow_credentials=permitir)
    token = _guardar_desafio(db, "login", opcoes.challenge)
    return {"token": token, "opcoes": json.loads(options_to_json(opcoes))}


@router.post("/login/finish")
@limiter.limit("10/minute")
def login_finish(request: Request, response: Response, body: FinishLoginBody, db: sqlite3.Connection = Depends(get_db)):
    _exigir_configurado(db)
    rp_id, origin = _rp_id(request), _origin(request)
    _rejeitar_localhost_em_prod(rp_id, origin)
    challenge, _ = _consumir_desafio(db, body.token, "login")
    cred_id = (body.credencial.get("id") or "").strip().replace("=", "")
    # O navegador pode devolver o id com ou sem padding base64url; o banco guarda
    # sem padding (bytes_to_base64url). Normalizar antes de procurar.
    row = None
    for r in _credenciais(db):
        if r["id"].rstrip("=") == cred_id.rstrip("="):
            row = r
            break
    if row is None:
        raise HTTPException(401, "Passkey desconhecida")
    try:
        verificado = verify_authentication_response(
            credential=body.credencial, expected_challenge=challenge,
            expected_rp_id=rp_id, expected_origin=origin,
            credential_public_key=bytes(row["public_key"]),
            credential_current_sign_count=row["sign_count"],
        )
    except Exception:
        raise HTTPException(401, "Passkey inválida")
    novo_count = verificado.new_sign_count
    # Contador que voltou (ou repetiu, fora do caso zero) = clone: nega e não
    # avança o guardado, para a próxima tentativa legítima ainda denunciar.
    if novo_count != 0 and novo_count <= row["sign_count"]:
        raise HTTPException(401, "Passkey com sinal de clonagem — remova e cadastre de novo")
    db.execute(
        "UPDATE webauthn_credenciais SET sign_count = ?, ultimo_uso_em = CURRENT_TIMESTAMP WHERE id = ?",
        (novo_count, row["id"]),
    )
    refresh_token = _emitir_refresh(db)
    _set_cookie(response, refresh_token)
    corpo = {"token": _emitir_access(), "nome": config_get(db, "perfil_nome")}
    if _cliente_nativo(request):
        corpo["refresh_token"] = refresh_token
    return corpo


@router.get("/credenciais")
def listar_credenciais(db: sqlite3.Connection = Depends(get_db), authorization: str | None = Header(default=None)):
    """Aparelhos com passkey (logado). Sem public_key: ela nunca sai do servidor."""
    from .auth import require_auth

    require_auth(authorization)
    return [
        {"id": r["id"], "nome": r["nome"], "criado_em": r["criado_em"], "ultimo_uso_em": r["ultimo_uso_em"]}
        for r in _credenciais(db)
    ]


class RenomearBody(BaseModel):
    nome: str


@router.patch("/credenciais/{cred_id}")
def renomear_credencial(cred_id: str, body: RenomearBody, db: sqlite3.Connection = Depends(get_db),
                        authorization: str | None = Header(default=None)):
    from .auth import require_auth

    require_auth(authorization)
    cur = db.execute("UPDATE webauthn_credenciais SET nome = ? WHERE id = ?", (body.nome.strip() or None, cred_id))
    if cur.rowcount == 0:
        raise HTTPException(404, "Passkey não encontrada")
    return {"ok": True}


@router.delete("/credenciais/{cred_id}")
def remover_credencial(cred_id: str, db: sqlite3.Connection = Depends(get_db),
                       authorization: str | None = Header(default=None)):
    from .auth import require_auth

    require_auth(authorization)
    cur = db.execute("DELETE FROM webauthn_credenciais WHERE id = ?", (cred_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Passkey não encontrada")
    return {"ok": True}
