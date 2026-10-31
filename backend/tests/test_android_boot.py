"""Boot do backend do APK Android (`app.android.iniciar`), no host.

`iniciar` roda num processo filho (como no app, uma vez por processo: o `app.main` deste
processo de teste é o da VPS) e o filho imprime numa linha a porta, o token e o que só se
vê de dentro dele. O teste confere: porta livre só em 127.0.0.1, `/api/health` pronto e com
a prova HMAC do token, 401 sem o token, a origem do Capacitor aceita e outra recusada,
segredos fora do `os.environ`, `webauthn` não importado e a 2ª chamada recusada. EOF no
stdin encerra o filho.
"""

import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import socket
import subprocess
import sys
import threading
import urllib.request

import pytest
from cryptography.fernet import Fernet

from app import android
from app.desktop import EntradaInvalida
from tests.test_desktop_boot import BACKEND, PRAZO_PRONTO, _ip_fora_do_loopback, pedir

FILHO = """
import json, os, sys
from app import android, desktop

porta, token = android.iniciar(sys.argv[1], sys.stdin.readline())
try:
    android.iniciar(sys.argv[1], sys.stdin.readline())
    segunda = "aceita"
except RuntimeError:
    segunda = "recusada"
print(json.dumps({
    "porta": porta,
    "token": token,
    "segredos_no_ambiente": sorted(k for k in desktop.SEGREDOS_ENV if k in os.environ),
    "webauthn": sorted(m for m in sys.modules if m.split(".")[0] == "webauthn" or m == "app.webauthn_routes"),
    "segunda": segunda,
}), flush=True)
sys.stdin.read()
"""


def _segredos() -> dict[str, str]:
    return {"secret_key": secrets.token_hex(32), "fernet_key": Fernet.generate_key().decode()}


@pytest.fixture(scope="module")
def no_ar(tmp_path_factory):
    raiz = tmp_path_factory.mktemp("android-boot")
    dados = raiz / "dados"
    linha = (json.dumps(_segredos()) + "\n").encode()
    env = {k: v for k, v in os.environ.items() if not k.startswith("FINCONTROL_")}
    with open(raiz / "stderr.log", "wb") as erros:
        proc = subprocess.Popen(
            [sys.executable, "-c", FILHO, str(dados)], cwd=BACKEND, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=erros,
        )
    try:
        proc.stdin.write(linha * 2)
        proc.stdin.flush()
        saida: queue.Queue[bytes] = queue.Queue()
        threading.Thread(target=lambda: saida.put(proc.stdout.readline()), daemon=True).start()
        try:
            bruto = saida.get(timeout=PRAZO_PRONTO)
        except queue.Empty:
            bruto = b""
        if not bruto:
            proc.kill()
            proc.wait(timeout=10)
            pytest.fail("iniciar() não respondeu:\n" + (raiz / "stderr.log").read_text("utf-8", "replace"))
        info = json.loads(bruto)
        info["dados"] = dados
        info["stderr"] = raiz / "stderr.log"
        yield info
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


def test_devolve_porta_livre_e_token_novo(no_ar):
    assert 1 <= no_ar["porta"] <= 65535
    assert re.fullmatch(r"[0-9a-f]{64}", no_ar["token"])
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


def test_health_prova_o_token_do_processo(no_ar):
    nonce = secrets.token_hex(16)
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"X-FinControl-Nonce": nonce})
    assert status == 200
    esperado = hmac.new(no_ar["token"].encode(), nonce.encode(), hashlib.sha256).hexdigest()
    assert json.loads(corpo) == {"ok": True, "prova": esperado}


def test_sem_token_401_e_com_token_200(no_ar):
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/auth/status")
    assert (status, json.loads(corpo)) == (401, {"detail": "token_local"})
    status, _, corpo = pedir(no_ar["porta"], "GET", "/api/auth/status", {"X-FinControl-Token": no_ar["token"]})
    assert (status, json.loads(corpo)) == (200, {"configurado": False})


def test_origem_do_capacitor_aceita_e_outra_recusada(no_ar):
    status, h, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"Origin": android.ORIGEM_CAPACITOR})
    assert (status, json.loads(corpo)) == (200, {"ok": True})
    assert h.get("access-control-allow-origin") == android.ORIGEM_CAPACITOR
    status, h, corpo = pedir(no_ar["porta"], "GET", "/api/health", {"Origin": "https://exemplo.com"})
    assert (status, json.loads(corpo)) == (403, {"detail": "origem_invalida"})
    assert "access-control-allow-origin" not in h


def test_segredos_fora_do_ambiente_sem_webauthn_e_uma_vez_por_processo(no_ar):
    assert no_ar["segredos_no_ambiente"] == []
    assert no_ar["webauthn"] == []
    assert no_ar["segunda"] == "recusada"
    assert no_ar["token"] not in no_ar["stderr"].read_text("utf-8", "replace")


@pytest.mark.parametrize("segredos", [
    "isto nao e json",
    json.dumps(["secret_key", "fernet_key"]),
    json.dumps({"secret_key": secrets.token_hex(32)}),
    json.dumps({**_segredos(), "token": secrets.token_hex(32)}),
    json.dumps({**_segredos(), "secret_key": "curta"}),
    json.dumps({**_segredos(), "fernet_key": "nao-e-fernet"}),
])
def test_segredos_invalidos_recusados_antes_de_tocar_em_nada(tmp_path, segredos):
    ambiente = dict(os.environ)
    with pytest.raises(EntradaInvalida, match=r"^segredos: "):
        android.iniciar(tmp_path / "dados", segredos)
    assert dict(os.environ) == ambiente
    assert not (tmp_path / "dados").exists()
    assert android._iniciado is False
