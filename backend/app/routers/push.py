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
                # Commit imediato: senão a transação aberta pela remoção ficaria
                # de pé pelo resto do lote, que é feito de chamadas de rede.
                db.commit()
        except Exception:
            # Falha de rede/endpoint numa assinatura não pode abortar o lote.
            pass
    return enviados


@router.get("/config")
def config(db: sqlite3.Connection = Depends(get_db)):
    from ..lembretes import HORA_PADRAO  # tardio: lembretes importa este módulo

    inscritos = db.execute("SELECT COUNT(*) n FROM push_subscriptions").fetchone()["n"]
    return {
        "habilitado": habilitado(),
        "vapid_public": VAPID_PUBLIC,
        "inscritos": inscritos,
        "hora_lembrete": HORA_PADRAO,
    }


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


@router.get("/lembretes")
def previa_lembretes(db: sqlite3.Connection = Depends(get_db)):
    """O que o job do dia notificaria — sem enviar nem marcar como enviado."""
    from .. import lembretes
    from ..util import competencia_de, hoje

    pend = lembretes.pendencias(db)
    msgs = lembretes._mensagens(pend)
    # A prévia precisa cobrir TODO tipo de aviso do job — mentir por omissão
    # aqui é o usuário ver a lista vazia e às 8h chegar um push "inexistente".
    estourados = lembretes.orcamentos_estourados(db)
    if estourados:
        msgs.append(lembretes._mensagem_orcamentos(estourados, competencia_de(hoje())))
    return {"pendencias": pend, "notificacoes": msgs}


@router.post("/lembretes")
def rodar_lembretes(forcar: bool = False, db: sqlite3.Connection = Depends(get_db)):
    """Roda o job de lembretes agora (o agendador faz isso uma vez por dia).

    `forcar=1` reenvia o que já saiu hoje — útil para ver a notificação chegar.
    """
    from .. import lembretes

    return lembretes.enviar_lembretes(db, forcar=forcar)
