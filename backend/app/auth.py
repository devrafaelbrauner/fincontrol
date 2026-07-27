import os
import sqlite3
import time

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from .db import get_db

# Ambiente: "dev" (padrão, permite rodar sem configuração) ou "production".
# Em produção, main.py exige segredos próprios e recusa subir com os defaults.
ENV = os.environ.get("FINCONTROL_ENV", "dev").strip().lower()
IS_PROD = ENV in ("production", "prod")

SECRET_KEY_DEFAULT = "dev-insecure-troque-em-producao"
SECRET_KEY = os.environ.get("FINCONTROL_SECRET_KEY", SECRET_KEY_DEFAULT)
ACCESS_TTL_SEGUNDOS = 30 * 60           # JWT de acesso, curto
REFRESH_TTL_SEGUNDOS = 30 * 24 * 60 * 60  # refresh token, longo (cookie httpOnly)
COOKIE_NOME = "fincontrol_refresh"
COOKIE_PATH = "/api/auth"
# Em produção (HTTPS) o cookie deve ser Secure; em dev via http, não.
# Secure por padrão quando FINCONTROL_ENV=production; opt-out explícito só em dev.
COOKIE_SECURE = os.environ.get("FINCONTROL_COOKIE_SECURE", "1" if IS_PROD else "0") == "1"

ph = PasswordHasher()
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    senha: str
    codigo_totp: str | None = None


def config_get(db: sqlite3.Connection, chave: str) -> str | None:
    row = db.execute("SELECT valor FROM config WHERE chave = ?", (chave,)).fetchone()
    return row["valor"] if row else None


def _refresh_version(db: sqlite3.Connection) -> int:
    return int(config_get(db, "refresh_version") or "0")


def _bump_refresh_version(db: sqlite3.Connection) -> None:
    nova = _refresh_version(db) + 1
    db.execute(
        "INSERT INTO config (chave, valor) VALUES ('refresh_version', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (str(nova),),
    )


def _emitir_access() -> str:
    return jwt.encode(
        {"sub": "dono", "type": "access", "exp": int(time.time()) + ACCESS_TTL_SEGUNDOS},
        SECRET_KEY,
        algorithm="HS256",
    )


def _emitir_refresh(db: sqlite3.Connection) -> str:
    return jwt.encode(
        {"sub": "dono", "type": "refresh", "ver": _refresh_version(db),
         "exp": int(time.time()) + REFRESH_TTL_SEGUNDOS},
        SECRET_KEY,
        algorithm="HS256",
    )


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        COOKIE_NOME, token,
        max_age=REFRESH_TTL_SEGUNDOS, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", path=COOKIE_PATH,
    )


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, response: Response, body: LoginBody, db: sqlite3.Connection = Depends(get_db)):
    senha_hash = config_get(db, "senha_hash")
    if not senha_hash:
        raise HTTPException(503, "Usuário não configurado — rode: python -m app.setup_user")
    try:
        ph.verify(senha_hash, body.senha)
    except VerifyMismatchError:
        raise HTTPException(401, "Senha ou código incorretos")
    totp_secret = config_get(db, "totp_secret")
    if totp_secret:
        if not body.codigo_totp or not pyotp.TOTP(totp_secret).verify(body.codigo_totp, valid_window=1):
            raise HTTPException(401, "Senha ou código incorretos")
    _set_cookie(response, _emitir_refresh(db))
    return {"token": _emitir_access()}


@router.post("/refresh")
def refresh(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)):
    cookie = request.cookies.get(COOKIE_NOME)
    if not cookie:
        raise HTTPException(401, "Sem refresh token")
    try:
        dados = jwt.decode(cookie, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Refresh token inválido ou expirado")
    if dados.get("type") != "refresh" or dados.get("ver") != _refresh_version(db):
        raise HTTPException(401, "Refresh token revogado")
    _set_cookie(response, _emitir_refresh(db))  # rotação
    return {"token": _emitir_access()}


@router.post("/logout")
def logout(response: Response, db: sqlite3.Connection = Depends(get_db)):
    _bump_refresh_version(db)  # invalida todos os refresh tokens existentes
    response.delete_cookie(COOKIE_NOME, path=COOKIE_PATH)
    return {"ok": True}


def require_auth(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Não autenticado")
    try:
        dados = jwt.decode(authorization[7:], SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessão inválida ou expirada")
    if dados.get("type") != "access":
        raise HTTPException(401, "Token inválido para esta operação")
