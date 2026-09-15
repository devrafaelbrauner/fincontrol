"""Calendário assinável (.ics).

Duas superfícies:
- `/api/calendario/*`  — autenticado; consulta/regenera o token e devolve a URL de assinatura.
- `/calendar/{token}.ics` — público (capability URL); o token secreto é a única credencial.
  A URL expõe os dados financeiros e deve ser tratada como senha.
"""

import secrets
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from ..db import get_db
from ..ics import gerar_feed

TOKEN_CHAVE = "ics_feed_token"

router = APIRouter(prefix="/calendario", tags=["calendario"])
feed_router = APIRouter(tags=["calendario"])


def _get_token(db: sqlite3.Connection) -> str | None:
    row = db.execute("SELECT valor FROM config WHERE chave = ?", (TOKEN_CHAVE,)).fetchone()
    return row["valor"] if row else None


def _set_token(db: sqlite3.Connection) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (TOKEN_CHAVE, token),
    )
    return token


def _payload(request: Request, token: str) -> dict:
    caminho = f"/calendar/{token}.ics"
    base = str(request.base_url).rstrip("/")
    url_https = f"{base}{caminho}"
    return {
        "token": token,
        "caminho": caminho,
        "url": url_https,
        "webcal": url_https.replace("https://", "webcal://").replace("http://", "webcal://"),
    }


@router.get("")
def info(request: Request, db: sqlite3.Connection = Depends(get_db)):
    """Devolve a URL de assinatura, gerando o token na primeira vez."""
    token = _get_token(db) or _set_token(db)
    return _payload(request, token)


@router.post("/regenerar")
def regenerar(request: Request, db: sqlite3.Connection = Depends(get_db)):
    """Invalida a URL antiga e emite uma nova (use se o link vazar)."""
    token = _set_token(db)
    return _payload(request, token)


@feed_router.get("/calendar/{token}.ics")
def feed(token: str, db: sqlite3.Connection = Depends(get_db)):
    atual = _get_token(db)
    # compare_digest sobre bytes: com str, um token não-ASCII na URL viraria 500.
    if not atual or not secrets.compare_digest(token.encode(), atual.encode()):
        raise HTTPException(404, "Feed não encontrado")
    corpo = gerar_feed(db)
    return Response(
        content=corpo,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="fincontrol.ics"',
            # Capability URL: tratada como senha. Não armazenar em cache
            # compartilhado nem em disco — vai para iCloud/Google ao assinar.
            "Cache-Control": "private, no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )
