"""Web Push (VAPID) para PWA instalada.

Bônus da Fase 4 — o lembrete principal continua vindo do calendário assinado.
Habilitado só se as chaves VAPID estiverem no ambiente:
  FINCONTROL_VAPID_PUBLIC  — chave pública (base64url), exposta ao frontend
  FINCONTROL_VAPID_PRIVATE — chave privada (base64url), nunca sai do backend
  FINCONTROL_VAPID_SUBJECT — contato, ex. mailto:voce@exemplo.com
Gere um par com:  python -m app.gerar_vapid
"""

import json
import os
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import get_db

router = APIRouter(prefix="/push", tags=["push"])

VAPID_PUBLIC = os.environ.get("FINCONTROL_VAPID_PUBLIC")
VAPID_PRIVATE = os.environ.get("FINCONTROL_VAPID_PRIVATE")
VAPID_SUBJECT = os.environ.get("FINCONTROL_VAPID_SUBJECT", "mailto:dono@fincontrol.local")


class ChavesIn(BaseModel):
    p256dh: str
    auth: str


class InscricaoIn(BaseModel):
    endpoint: str
    keys: ChavesIn


def habilitado() -> bool:
    return bool(VAPID_PUBLIC and VAPID_PRIVATE)


def enviar(db: sqlite3.Connection, titulo: str, corpo: str, url: str = "/") -> int:
    """Envia a todas as assinaturas; remove as que o navegador expirou (404/410). Retorna quantas receberam."""
    if not habilitado():
        return 0
    from pywebpush import WebPushException, webpush  # import tardio: só quando há chaves

    payload = json.dumps({"titulo": titulo, "corpo": corpo, "url": url})
    enviados = 0
    for sub in db.execute("SELECT * FROM push_subscriptions").fetchall():
        info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        try:
            webpush(
                subscription_info=info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
            enviados += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                db.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub["id"],))
        except Exception:
            # Falha de rede/endpoint numa assinatura não pode abortar o lote.
            pass
    return enviados


@router.get("/config")
def config():
    return {"habilitado": habilitado(), "vapid_public": VAPID_PUBLIC}


@router.post("/subscribe", status_code=201)
def subscribe(body: InscricaoIn, db: sqlite3.Connection = Depends(get_db)):
    if not habilitado():
        raise HTTPException(503, "Push não configurado no servidor")
    db.execute(
        """INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth""",
        (body.endpoint, body.keys.p256dh, body.keys.auth),
    )
    return {"ok": True}


@router.post("/testar")
def testar(db: sqlite3.Connection = Depends(get_db)):
    if not habilitado():
        raise HTTPException(503, "Push não configurado no servidor")
    n = enviar(db, "FinControl", "Notificação de teste ✅", "/")
    return {"enviados": n}
