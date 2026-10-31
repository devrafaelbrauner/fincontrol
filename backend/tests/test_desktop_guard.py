"""Guarda do backend embutido (`app/desktop_guard.py`) num app Starlette isolado.

Contrato: Host exato `127.0.0.1:<porta>` (400 `host_invalido`), Origin na lista Tauri — mais
`https://localhost` (WebView do Capacitor) só com `FINCONTROL_MODO=android` — (403
`origem_invalida`), `X-FinControl-Token` igual ao da sessão (401 `token_local`) em toda
rota menos `GET /api/health`, que devolve a prova HMAC-SHA256(token, nonce) sem o token.
"""

import hashlib
import hmac
import secrets

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import desktop_guard
from app.desktop_guard import DesktopGuard

PORTA = 48123
BASE = f"http://127.0.0.1:{PORTA}"
TOKEN = secrets.token_hex(32)


async def _health(_req):
    return JSONResponse({"ok": True})


async def _dados(_req):
    return JSONResponse({"dados": 1})


async def _ws(websocket):
    await websocket.accept()
    await websocket.send_text("oi")
    await websocket.close()


def _cliente(token: str = TOKEN, porta: int = PORTA, dev: bool = False) -> TestClient:
    app = Starlette(
        routes=[
            Route("/api/health", _health),
            Route("/api/dados", _dados, methods=["GET", "POST"]),
            WebSocketRoute("/api/ws", _ws),
        ],
        middleware=[Middleware(DesktopGuard, token=token, porta=porta, dev=dev)],
    )
    return TestClient(app, base_url=BASE)


@pytest.fixture
def cliente():
    with _cliente() as c:
        yield c


def _com_token(**extra) -> dict:
    return {"X-FinControl-Token": TOKEN, **extra}


# ---------- construção (fail closed) ----------

@pytest.mark.parametrize("token", ["", "abc", "0" * 63, "0" * 65, "g" * 64, None])
def test_recusa_subir_sem_token_de_64_hex(token):
    with pytest.raises(RuntimeError, match="FINCONTROL_DESKTOP_TOKEN"):
        DesktopGuard(_health, token=token, porta=PORTA)


@pytest.mark.parametrize("porta", [0, 65536, -1])
def test_recusa_porta_invalida(porta):
    with pytest.raises(RuntimeError, match="FINCONTROL_PORTA"):
        DesktopGuard(_health, token=TOKEN, porta=porta)


# ---------- Host ----------

@pytest.mark.parametrize("host", [
    "localhost:%d" % PORTA, "127.0.0.1", "127.0.0.1:%d" % (PORTA + 1), "evil.example:%d" % PORTA, "[::1]:%d" % PORTA,
])
def test_host_errado_400_mesmo_com_token(cliente, host):
    r = cliente.get("/api/dados", headers=_com_token(Host=host))
    assert r.status_code == 400
    assert r.json() == {"detail": "host_invalido"}


def test_host_errado_400_tambem_no_health(cliente):
    r = cliente.get("/api/health", headers={"Host": f"localhost:{PORTA}"})
    assert r.status_code == 400
    assert r.json() == {"detail": "host_invalido"}


def test_host_vem_antes_da_origem(cliente):
    r = cliente.get("/api/dados", headers=_com_token(Host="evil:1", Origin="https://evil.example"))
    assert r.status_code == 400


# ---------- Origin ----------

@pytest.mark.parametrize("origem", ["https://evil.example", "null", "http://localhost:1420", "https://tauri.localhost",
                                    "http://127.0.0.1:%d" % PORTA])
def test_origem_fora_da_lista_403(cliente, origem):
    r = cliente.get("/api/dados", headers=_com_token(Origin=origem))
    assert r.status_code == 403
    assert r.json() == {"detail": "origem_invalida"}


def test_origem_fora_da_lista_403_tambem_no_health(cliente):
    r = cliente.get("/api/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


@pytest.mark.parametrize("origem", ["tauri://localhost", "http://tauri.localhost"])
def test_origens_tauri_passam(cliente, origem):
    r = cliente.get("/api/dados", headers=_com_token(Origin=origem))
    assert r.status_code == 200
    assert r.json() == {"dados": 1}


def test_sem_origin_passa_com_token(cliente):
    assert cliente.get("/api/dados", headers=_com_token()).status_code == 200


def test_origem_do_dev_so_com_a_flag():
    with _cliente(dev=False) as c:
        assert c.get("/api/dados", headers=_com_token(Origin="http://localhost:1420")).status_code == 403
    with _cliente(dev=True) as c:
        assert c.get("/api/dados", headers=_com_token(Origin="http://localhost:1420")).status_code == 200
        assert c.get("/api/dados", headers=_com_token(Origin="http://localhost:5173")).status_code == 403


# ---------- modo android × desktop (FINCONTROL_MODO) ----------

@pytest.mark.parametrize("modo", ["desktop", "Desktop", None, "", "androide"])
def test_origem_do_capacitor_403_fora_do_modo_android(monkeypatch, modo):
    if modo is None:
        monkeypatch.delenv("FINCONTROL_MODO", raising=False)
    else:
        monkeypatch.setenv("FINCONTROL_MODO", modo)
    assert "https://localhost" not in desktop_guard.origens_desktop(False)
    with _cliente() as c:
        r = c.get("/api/dados", headers=_com_token(Origin="https://localhost"))
        assert (r.status_code, r.json()) == (403, {"detail": "origem_invalida"})
        assert c.get("/api/health", headers={"Origin": "https://localhost"}).status_code == 403


@pytest.mark.parametrize("modo", ["android", " Android "])
def test_origem_do_capacitor_aceita_no_modo_android(monkeypatch, modo):
    monkeypatch.setenv("FINCONTROL_MODO", modo)
    assert desktop_guard.origens_desktop(False) == ["tauri://localhost", "http://tauri.localhost", "https://localhost"]
    with _cliente() as c:
        assert c.get("/api/dados", headers=_com_token(Origin="https://localhost")).json() == {"dados": 1}
        assert c.get("/api/health", headers={"Origin": "https://localhost"}).json() == {"ok": True}
        # A Origin não isola no Android (é a de todo app Capacitor): sem o token segue 401.
        r = c.get("/api/dados", headers={"Origin": "https://localhost"})
        assert (r.status_code, r.json()) == (401, {"detail": "token_local"})
        for outra in ("http://localhost", "https://localhost:8443", "capacitor://localhost", "https://evil.example"):
            assert c.get("/api/dados", headers=_com_token(Origin=outra)).status_code == 403


# ---------- token ----------

def test_sem_token_401(cliente):
    r = cliente.get("/api/dados")
    assert r.status_code == 401
    assert r.json() == {"detail": "token_local"}


@pytest.mark.parametrize("errado", ["", "x", TOKEN[:-1], TOKEN.upper() if TOKEN.upper() != TOKEN else "f" * 64,
                                    secrets.token_hex(32)])
def test_token_errado_401(cliente, errado):
    r = cliente.post("/api/dados", headers={"X-FinControl-Token": errado})
    assert r.status_code == 401
    assert r.json() == {"detail": "token_local"}


def test_token_certo_200(cliente):
    r = cliente.post("/api/dados", headers=_com_token(Origin="http://tauri.localhost"))
    assert r.status_code == 200


def test_compara_token_em_tempo_constante(cliente, monkeypatch):
    chamadas = []
    original = hmac.compare_digest

    def espiao(a, b):
        chamadas.append((a, b))
        return original(a, b)

    monkeypatch.setattr(desktop_guard.hmac, "compare_digest", espiao)
    assert cliente.get("/api/dados", headers=_com_token()).status_code == 200
    assert cliente.get("/api/dados", headers={"X-FinControl-Token": "0" * 64}).status_code == 401
    assert len(chamadas) == 2
    assert all(b == TOKEN.encode() for _a, b in chamadas)


def test_so_o_get_do_health_dispensa_token(cliente):
    assert cliente.post("/api/health").status_code == 401
    assert cliente.get("/api/health/").status_code == 401


def test_websocket_sem_token_e_fechado(cliente):
    with pytest.raises(WebSocketDisconnect) as erro:
        with cliente.websocket_connect("/api/ws", headers={"Host": f"127.0.0.1:{PORTA}"}) as ws:
            ws.receive_text()
    assert erro.value.code == 1008
    with cliente.websocket_connect("/api/ws", headers=_com_token(Host=f"127.0.0.1:{PORTA}")) as ws:
        assert ws.receive_text() == "oi"


# ---------- health e prova ----------

def test_health_sem_nonce_so_ok(cliente):
    r = cliente.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_com_nonce_devolve_a_prova_hmac(cliente):
    nonce = secrets.token_hex(16)
    r = cliente.get("/api/health", headers={"X-FinControl-Nonce": nonce, "Origin": "tauri://localhost"})
    assert r.status_code == 200
    esperado = hmac.new(TOKEN.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    assert r.json() == {"ok": True, "prova": esperado}
    assert TOKEN not in r.text


def test_prova_muda_com_o_nonce_e_com_o_token():
    nonce = secrets.token_hex(16)
    with _cliente() as c:
        p1 = c.get("/api/health", headers={"X-FinControl-Nonce": nonce}).json()["prova"]
        p2 = c.get("/api/health", headers={"X-FinControl-Nonce": secrets.token_hex(16)}).json()["prova"]
    with _cliente(token=secrets.token_hex(32)) as c:
        p3 = c.get("/api/health", headers={"X-FinControl-Nonce": nonce}).json()["prova"]
    assert len({p1, p2, p3}) == 3


@pytest.mark.parametrize("nonce", ["", "abc", "0" * 31, "0" * 33, "A" * 32, "g" * 32, "0" * 64])
def test_nonce_malformado_400(cliente, nonce):
    r = cliente.get("/api/health", headers={"X-FinControl-Nonce": nonce})
    assert r.status_code == 400
    assert r.json() == {"detail": "nonce_invalido"}


def test_health_com_host_errado_nao_entrega_prova(cliente):
    r = cliente.get("/api/health", headers={"Host": "evil.example", "X-FinControl-Nonce": secrets.token_hex(16)})
    assert r.status_code == 400
    assert "prova" not in r.text
