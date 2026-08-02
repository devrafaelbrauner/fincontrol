import json
import os
import secrets
import sqlite3
import time

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
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


def _config_set(db: sqlite3.Connection, chave: str, valor: str) -> None:
    db.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )


def _bump_refresh_version(db: sqlite3.Connection) -> None:
    _config_set(db, "refresh_version", str(_refresh_version(db) + 1))
    db.execute("DELETE FROM refresh_tokens")


# Teto de sessões simultâneas (web + iPhone + macOS sobram folgados em 10).
MAX_SESSOES = 10


# Refresh tokens vigentes, uma linha por sessão (tabela refresh_tokens): a rotação
# apaga o antigo, e um token assinado cujo jti sumiu denuncia reuso (vazamento).
def _registrar_jti(db: sqlite3.Connection, jti: str, exp: int, remover: str | None = None) -> None:
    if remover:
        # Rotação: o token anterior deixa de existir. Se reaparecer num /refresh,
        # é token já gasto voltando — reuso.
        db.execute("DELETE FROM refresh_tokens WHERE jti = ?", (remover,))
    db.execute("DELETE FROM refresh_tokens WHERE expira_em <= ?", (int(time.time()),))
    db.execute("INSERT INTO refresh_tokens (jti, expira_em) VALUES (?, ?)", (jti, exp))
    # Passou do teto: encerra as sessões mais antigas marcando vigente = 0.
    # Despejo NÃO é reuso — marcar (em vez de apagar) é o que evita que o dono,
    # ao voltar na sessão despejada, derrube todas as outras junto.
    db.execute(
        """UPDATE refresh_tokens SET vigente = 0 WHERE jti IN (
             SELECT jti FROM refresh_tokens WHERE vigente = 1
             ORDER BY expira_em DESC, rowid DESC LIMIT -1 OFFSET ?)""",
        (MAX_SESSOES,),
    )


def _estado_jti(db: sqlite3.Connection, jti: str) -> str:
    """'vigente', 'despejado' (teto de sessões) ou 'desconhecido' (reuso/forjado)."""
    row = db.execute(
        "SELECT vigente FROM refresh_tokens WHERE jti = ? AND expira_em > ?",
        (jti, int(time.time())),
    ).fetchone()
    if row is None:
        return "desconhecido"
    return "vigente" if row["vigente"] else "despejado"


def _emitir_access() -> str:
    return jwt.encode(
        {"sub": "dono", "type": "access", "exp": int(time.time()) + ACCESS_TTL_SEGUNDOS},
        SECRET_KEY,
        algorithm="HS256",
    )


def _emitir_refresh(db: sqlite3.Connection, substituir_jti: str | None = None) -> str:
    jti = secrets.token_hex(16)
    exp = int(time.time()) + REFRESH_TTL_SEGUNDOS
    _registrar_jti(db, jti, exp, remover=substituir_jti)
    return jwt.encode(
        {"sub": "dono", "type": "refresh", "ver": _refresh_version(db), "jti": jti, "exp": exp},
        SECRET_KEY,
        algorithm="HS256",
    )


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        COOKIE_NOME, token,
        max_age=REFRESH_TTL_SEGUNDOS, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", path=COOKIE_PATH,
    )


# Cobre a valid_window=1 do TOTP (passo de 30s: anterior + atual + seguinte).
JANELA_TOTP_SEGUNDOS = 95


def _totp_ja_usado(db: sqlite3.Connection, codigo: str) -> bool:
    """Anti-replay: um código TOTP interceptado não vale duas vezes na janela.

    Guarda TODOS os códigos recentes, não só o último — com um só, bastava um
    login intercalado com o código seguinte para liberar a repetição do anterior.
    """
    agora = int(time.time())
    try:
        recentes = json.loads(config_get(db, "totp_usados") or "{}")
    except json.JSONDecodeError:
        recentes = {}
    if not isinstance(recentes, dict):
        recentes = {}
    vivos = {
        c: t for c, t in recentes.items()
        if isinstance(t, int) and 0 <= agora - t < JANELA_TOTP_SEGUNDOS
    }
    repetido = codigo in vivos
    vivos[codigo] = agora
    _config_set(db, "totp_usados", json.dumps(vivos))
    return repetido


def _cliente_nativo(request: Request) -> bool:
    """App Capacitor (iOS/macOS/Android). Como o WebView roda cross-origin, o
    cookie de refresh não trafega: o app recebe o refresh token no corpo e o
    reenvia no header X-Refresh-Token. O web (same-origin) nunca manda X-Client."""
    return request.headers.get("X-Client") == "native"


@router.post("/login")
@limiter.limit("5/minute")                                    # por IP
@limiter.limit("30/minute", key_func=lambda *_: "login")      # teto global: Argon2 custa 64 MiB/tentativa
def login(request: Request, response: Response, body: LoginBody, db: sqlite3.Connection = Depends(get_db)):
    senha_hash = config_get(db, "senha_hash")
    if not senha_hash:
        raise HTTPException(503, "Usuário não configurado — rode: python -m app.setup_user")
    try:
        ph.verify(senha_hash, body.senha)
    except VerificationError:  # inclui mismatch e hash corrompido/inválido no banco
        raise HTTPException(401, "Senha ou código incorretos")
    totp_secret = config_get(db, "totp_secret")
    if totp_secret:
        if not body.codigo_totp or not pyotp.TOTP(totp_secret).verify(body.codigo_totp, valid_window=1):
            raise HTTPException(401, "Senha ou código incorretos")
        if _totp_ja_usado(db, body.codigo_totp):
            raise HTTPException(401, "Senha ou código incorretos")
    refresh_token = _emitir_refresh(db)
    _set_cookie(response, refresh_token)
    resposta = {"token": _emitir_access()}
    if _cliente_nativo(request):
        resposta["refresh_token"] = refresh_token
    return resposta


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db),
            x_refresh_token: str | None = Header(default=None)):
    # Web: refresh token no cookie httpOnly. Nativo: no header X-Refresh-Token.
    cookie = request.cookies.get(COOKIE_NOME) or x_refresh_token
    if not cookie:
        raise HTTPException(401, "Sem refresh token")
    try:
        dados = jwt.decode(cookie, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Refresh token inválido ou expirado")
    if dados.get("type") != "refresh" or dados.get("ver") != _refresh_version(db):
        raise HTTPException(401, "Refresh token revogado")
    jti = dados.get("jti")
    estado = _estado_jti(db, jti) if jti else "desconhecido"
    if estado == "despejado":
        # Sessão encerrada pelo teto de sessões simultâneas: só este cliente
        # precisa entrar de novo. Não é indício de vazamento, então as demais
        # sessões continuam de pé.
        db.execute("DELETE FROM refresh_tokens WHERE jti = ?", (jti,))
        db.commit()  # o get_db não faz commit quando a resposta é uma exceção
        raise HTTPException(401, "Sessão encerrada — entre novamente")
    if estado == "desconhecido":
        # Token assinado e não expirado, mas já rotacionado: reuso = provável
        # vazamento. Revoga a família inteira e força novo login.
        _bump_refresh_version(db)
        db.commit()  # o get_db não faz commit quando a resposta é uma exceção
        raise HTTPException(401, "Refresh token revogado")
    novo = _emitir_refresh(db, substituir_jti=jti)  # rotação: o antigo morre agora
    _set_cookie(response, novo)
    resposta = {"token": _emitir_access()}
    if _cliente_nativo(request):
        resposta["refresh_token"] = novo
    return resposta


@router.post("/logout")
@limiter.limit("10/minute")
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db),
           x_refresh_token: str | None = Header(default=None)):
    # Só quem apresenta um refresh token válido pode revogar as sessões — sem
    # isso a rota seria um DoS não autenticado (derrubar todas as sessões em loop).
    token = request.cookies.get(COOKIE_NOME) or x_refresh_token
    if token:
        try:
            dados = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            if dados.get("type") == "refresh" and dados.get("ver") == _refresh_version(db):
                _bump_refresh_version(db)  # invalida todos os refresh tokens existentes
        except jwt.PyJWTError:
            pass  # anônimo/expirado: só limpa o cookie, sem tocar nas sessões
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
