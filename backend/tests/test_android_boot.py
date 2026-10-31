"""Boot do backend do APK Android (`app.android.iniciar`), no host.

`iniciar` roda num processo filho (como no app, uma vez por processo: o `app.main` deste
processo de teste é o da VPS). O teste faz o papel da casca: sorteia o token e o manda junto
com os segredos; o filho devolve só a porta e imprime numa linha o que só se vê de dentro dele.
O teste confere: porta livre só em 127.0.0.1, `/api/health` pronto e com a prova HMAC do token
da casca, 401 sem o token, a Origin do Capacitor aceita pela guarda (`FINCONTROL_MODO=android`,
sem remendo no `android.py`) e outra recusada, segredos fora do `os.environ`, `webauthn` não
importado e a 2ª chamada recusada. EOF no stdin encerra o filho. Uma falha antes do `pronto`
(prazo estourado ou uvicorn morto) solta a porta e não deixa thread de pé.
"""

import contextlib
import hashlib
import hmac
import json
import os
import queue
import secrets
import socket
import subprocess
import sys
import threading
import urllib.request

import pytest

from app import android
from app.desktop import EntradaInvalida
from tests.test_desktop_boot import BACKEND, PRAZO_PRONTO, _ip_fora_do_loopback, _linha, _segredos, pedir

ORIGEM_CAPACITOR = "https://localhost"

FILHO = """
import json, os, sys
from app import android, desktop, desktop_guard

porta = android.iniciar(sys.argv[1], sys.stdin.readline())
try:
    android.iniciar(sys.argv[1], sys.stdin.readline())
    segunda = "aceita"
except RuntimeError:
    segunda = "recusada"
print(json.dumps({
    "porta": porta,
    "modo": os.environ.get("FINCONTROL_MODO"),
    "origens_desktop": list(desktop_guard.ORIGENS_DESKTOP),
    "segredos_no_ambiente": sorted(k for k in desktop.SEGREDOS_ENV if k in os.environ),
    "webauthn": sorted(m for m in sys.modules if m.split(".")[0] == "webauthn" or m == "app.webauthn_routes"),
    "segunda": segunda,
}), flush=True)
sys.stdin.read()
"""

# Um uvicorn.Server que nunca chega ao `started`: "morre" (a thread acaba) ou "nunca_sobe"
# (preso até o `should_exit`). O import real do `app.main` não é o assunto aqui.
FILHO_FALHA = """
import json, os, socket, sys, threading, time, types
import uvicorn
from app import android, desktop

class Servidor:
    def __init__(self, config):
        self.started = False
        self.should_exit = False

    def run(self, sockets):
        Servidor.socket = sockets[0]
        Servidor.porta = sockets[0].getsockname()[1]
        while sys.argv[2] == "nunca_sobe" and not self.should_exit:
            time.sleep(0.01)

uvicorn.Server = Servidor
android.PRAZO_PRONTO = 0.5
falso = types.ModuleType("app.main")
falso.app = None
sys.modules["app.main"] = falso
try:
    android.iniciar(sys.argv[1], sys.stdin.readline())
    erro = None
except (RuntimeError, TimeoutError) as e:
    erro = type(e).__name__
fim = time.monotonic() + 2
while time.monotonic() < fim and any(t.name == "fincontrol-backend" for t in threading.enumerate()):
    time.sleep(0.01)
outro = socket.socket()
try:
    outro.bind(("127.0.0.1", Servidor.porta))
    porta_livre = True
except OSError:
    porta_livre = False
finally:
    outro.close()
try:
    android.iniciar(sys.argv[1], sys.stdin.readline())
    segunda = "aceita"
except RuntimeError:
    segunda = "recusada"
print(json.dumps({
    "erro": erro,
    "socket_fechado": Servidor.socket.fileno() == -1,
    "porta_livre": porta_livre,
    "thread_viva": any(t.name == "fincontrol-backend" for t in threading.enumerate()),
    "segredos_no_ambiente": sorted(k for k in desktop.SEGREDOS_ENV if k in os.environ),
    "segunda": segunda,
}), flush=True)
"""


@contextlib.contextmanager
def _filho(script: str, dados, entrada: bytes, *args: str):
    """Roda `script` num filho e devolve a 1ª linha da saída (JSON e bruta) e o arquivo do stderr."""
    erros_em = dados.parent / f"stderr-{dados.name}.log"
    env = {k: v for k, v in os.environ.items() if not k.startswith("FINCONTROL_")}
    with open(erros_em, "wb") as erros:
        proc = subprocess.Popen(
            [sys.executable, "-c", script, str(dados), *args], cwd=BACKEND, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=erros,
        )
    saida: queue.Queue[bytes] = queue.Queue()
    leitor = threading.Thread(target=lambda: saida.put(proc.stdout.readline()), daemon=True)
    try:
        proc.stdin.write(entrada)
        proc.stdin.flush()
        leitor.start()
        try:
            bruto = saida.get(timeout=PRAZO_PRONTO)
        except queue.Empty:
            bruto = b""
        if not bruto:
            proc.kill()
            pytest.fail("o filho não respondeu:\n" + erros_em.read_text("utf-8", "replace"))
        yield json.loads(bruto), bruto.decode(), erros_em
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
        if leitor.is_alive():
            leitor.join(timeout=5)
        proc.stdout.close()


@pytest.fixture(scope="module")
def no_ar(tmp_path_factory):
    segredos = _segredos()  # o token é da casca (aqui, do teste), não do Python
    dados = tmp_path_factory.mktemp("android-boot") / "dados"
    with _filho(FILHO, dados, _linha(segredos) * 2) as (info, saida, stderr):
        yield {**info, "token": segredos["token"], "saida": saida, "dados": dados, "stderr": stderr}


def test_devolve_so_a_porta_livre(no_ar):
    assert isinstance(no_ar["porta"], int)
    assert 1 <= no_ar["porta"] <= 65535
    with urllib.request.urlopen(f"http://127.0.0.1:{no_ar['porta']}/api/health", timeout=2) as r:
        assert r.status == 200
        assert json.loads(r.read()) == {"ok": True}
    assert (no_ar["dados"] / "fincontrol.db").is_file()


def test_porta_nao_escuta_fora_do_loopback(no_ar):
    ip = _ip_fora_do_loopback()
    if ip is None:
        pytest.skip("nenhum IP local fora do loopback nesta máquina")
    with pytest.raises(OSError):
        socket.create_connection((ip, no_ar["porta"]), timeout=2).close()


def test_health_prova_o_token_da_casca(no_ar):
    nonce = secrets.token_hex(16)
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"X-FinControl-Nonce": nonce})
    assert status == 200
    esperado = hmac.new(no_ar["token"].encode(), nonce.encode(), hashlib.sha256).hexdigest()
    assert json.loads(corpo) == {"ok": True, "prova": esperado}


def test_sem_token_401_e_com_o_token_da_casca_200(no_ar):
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/auth/status")
    assert (status, json.loads(corpo)) == (401, {"detail": "token_local"})
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/auth/status", {"X-FinControl-Token": secrets.token_hex(32)})
    assert (status, json.loads(corpo)) == (401, {"detail": "token_local"})
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/auth/status", {"X-FinControl-Token": no_ar["token"]})
    assert (status, json.loads(corpo)) == (200, {"configurado": False})


def test_host_origin_e_token_juntos(no_ar):
    """O S1a.1 no host: Host errado 400, Origin estranha 403, os três certos 200."""
    certos = {"X-FinControl-Token": no_ar["token"], "Origin": ORIGEM_CAPACITOR}
    porta = no_ar["porta"]
    status, _, corpo = pedir(porta, "GET", "/api/auth/status", {**certos, "Host": f"localhost:{porta}"})
    assert (status, json.loads(corpo)) == (400, {"detail": "host_invalido"})
    status, _, corpo = pedir(porta, "GET", "/api/auth/status", {**certos, "Origin": "https://exemplo.com"})
    assert (status, json.loads(corpo)) == (403, {"detail": "origem_invalida"})
    status, h, corpo = pedir(porta, "GET", "/api/auth/status", certos)
    assert (status, json.loads(corpo)) == (200, {"configurado": False})
    assert h.get("access-control-allow-origin") == ORIGEM_CAPACITOR


def test_origem_do_capacitor_decidida_pela_guarda(no_ar):
    # FINCONTROL_MODO=android liga a origem na guarda; o android.py não mexe mais na lista dela.
    assert no_ar["modo"] == "android"
    assert no_ar["origens_desktop"] == ["tauri://localhost", "http://tauri.localhost"]
    assert not hasattr(android, "ORIGEM_CAPACITOR")
    status, h, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"Origin": ORIGEM_CAPACITOR})
    assert (status, json.loads(corpo)) == (200, {"ok": True})
    assert h.get("access-control-allow-origin") == ORIGEM_CAPACITOR
    status, h, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"Origin": "https://exemplo.com"})
    assert (status, json.loads(corpo)) == (403, {"detail": "origem_invalida"})
    assert "access-control-allow-origin" not in h


def test_segredos_fora_do_ambiente_sem_webauthn_e_uma_vez_por_processo(no_ar):
    assert no_ar["segredos_no_ambiente"] == []
    assert no_ar["webauthn"] == []
    assert no_ar["segunda"] == "recusada"
    assert no_ar["token"] not in no_ar["saida"]
    assert no_ar["token"] not in no_ar["stderr"].read_text("utf-8", "replace")


@pytest.mark.parametrize(("como", "erro"), [("nunca_sobe", "TimeoutError"), ("morre", "RuntimeError")])
def test_falha_antes_do_pronto_solta_a_porta(tmp_path, como, erro):
    with _filho(FILHO_FALHA, tmp_path / "dados", _linha(_segredos()) * 2, como) as (info, _, _):
        assert info == {
            "erro": erro, "socket_fechado": True, "porta_livre": True, "thread_viva": False,
            "segredos_no_ambiente": [], "segunda": "recusada",
        }


def _sem(chave: str) -> dict[str, str]:
    return {k: v for k, v in _segredos().items() if k != chave}


@pytest.mark.parametrize("segredos", [
    "isto nao e json",
    json.dumps(["secret_key", "fernet_key", "token"]),
    json.dumps({"secret_key": secrets.token_hex(32)}),
    json.dumps(_sem("token")),
    json.dumps({**_segredos(), "extra": "valor-que-nao-pode-ecoar"}),
    json.dumps({**_segredos(), "secret_key": "curta"}),
    json.dumps({**_segredos(), "fernet_key": "nao-e-fernet"}),
    json.dumps({**_segredos(), "token": "0" * 63}),
    json.dumps({**_segredos(), "token": "g" * 64}),
    json.dumps({**_segredos(), "token": 123}),
], ids=["nao-json", "lista", "so-secret", "sem-token", "chave-extra", "secret-curta", "fernet-invalida",
        "token-63-hex", "token-nao-hex", "token-numero"])
def test_segredos_invalidos_recusados_antes_de_tocar_em_nada(tmp_path, segredos):
    ambiente = dict(os.environ)
    with pytest.raises(EntradaInvalida, match=r"^segredos: ") as erro:
        android.iniciar(tmp_path / "dados", segredos)
    assert dict(os.environ) == ambiente
    assert not (tmp_path / "dados").exists()
    assert android._iniciado is False
    recebidos = json.loads(segredos) if segredos.startswith("{") else {}
    assert not any(v in str(erro.value) for v in recebidos.values() if isinstance(v, str) and len(v) >= 8)
