"""Allowlist de Web Push: http, IP interno e host desconhecido são recusados.

O servidor chama `webpush()` no URL que o cliente mandou — aceitar http, IP
ou webhook arbitrário seria SSRF autenticado. A prova é de `_endpoint_push_ok`
e do `POST /api/push/subscribe` que a usa.
"""

from app.db import connect
from app.routers import push
from app.routers.push import _endpoint_push_ok

CHAVES = {"p256dh": "p256dh-teste", "auth": "auth-teste"}
FCM = "https://fcm.googleapis.com/fcm/send/abc"


def _subscribe(autenticado, monkeypatch, endpoint: str):
    monkeypatch.setattr(push, "VAPID_PUBLIC", "pub-teste")
    monkeypatch.setattr(push, "VAPID_PRIVATE", "priv-teste")
    return autenticado.post(
        "/api/push/subscribe",
        json={"endpoint": endpoint, "keys": CHAVES},
    )


def test_endpoint_http_e_recusado():
    """R4.22 / aceite 18: scheme http (não HTTPS) recusa mesmo em host conhecido."""
    assert _endpoint_push_ok("http://fcm.googleapis.com/fcm/send/abc") is False


def test_endpoint_ip_interno_e_recusado():
    """R4.22 / aceite 18: loopback, RFC1918 e link-local recusam mesmo em HTTPS."""
    assert _endpoint_push_ok("https://127.0.0.1/push") is False
    assert _endpoint_push_ok("https://10.0.0.1/push") is False
    assert _endpoint_push_ok("https://169.254.169.254/push") is False


def test_endpoint_host_fora_da_allowlist_e_recusado():
    """R4.22 / aceite 18: host fora de _HOSTS_PUSH / _SUFIXOS_PUSH recusa."""
    assert _endpoint_push_ok("https://evil.example/push") is False


def test_endpoint_https_da_allowlist_e_aceito():
    """R4.23 / aceite 19: HTTPS de host/sufixo da allowlist continua válido."""
    assert _endpoint_push_ok(FCM) is True
    assert _endpoint_push_ok("https://android.googleapis.com/gcm/send/abc") is True
    assert _endpoint_push_ok("https://updates.push.services.mozilla.com/wpush/v2/abc") is True
    assert _endpoint_push_ok("https://web.push.apple.com/abc") is True
    assert _endpoint_push_ok("https://wns2-pn1p.notify.windows.com/w") is True


def test_endpoint_com_userinfo_e_recusado():
    """R4.23: userinfo no URL recusa mesmo com host da allowlist."""
    assert _endpoint_push_ok("https://user:pass@fcm.googleapis.com/fcm/send/abc") is False


def test_subscribe_http_e_recusado(autenticado, monkeypatch):
    r = _subscribe(autenticado, monkeypatch, "http://fcm.googleapis.com/fcm/send/abc")
    assert r.status_code == 400
    assert "inválido" in r.json()["detail"].lower()


def test_subscribe_ip_interno_e_recusado(autenticado, monkeypatch):
    r = _subscribe(autenticado, monkeypatch, "https://127.0.0.1/push")
    assert r.status_code == 400
    assert "inválido" in r.json()["detail"].lower()


def test_subscribe_host_fora_da_allowlist_e_recusado(autenticado, monkeypatch):
    r = _subscribe(autenticado, monkeypatch, "https://evil.example/push")
    assert r.status_code == 400
    assert "inválido" in r.json()["detail"].lower()


def test_subscribe_https_da_allowlist_nao_e_quebrado(autenticado, monkeypatch):
    r = _subscribe(autenticado, monkeypatch, FCM)
    assert r.status_code == 201, r.text
    assert r.json()["ok"] is True
    db = connect()
    db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (FCM,))
    db.commit()
    db.close()
