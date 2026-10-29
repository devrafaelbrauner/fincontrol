"""Modo desktop de ponta a ponta: `python -m app.desktop` de verdade, app-data vazio.

Guarda (Host 400, Origin 403, token 401), CORS só das origens Tauri e sem credenciais,
cadastro só com o banco vazio, rotas de servidor e docs em 404, sem cookie. O que não dá
para observar de fora do processo filho (segredos fora do `os.environ`, o `/abrir` abrindo
o arquivo) é testado aqui, em processo, nos helpers que o `desktop.py` e o `anexos.py` usam.
"""

import inspect
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import cripto, desktop
from app.db import connect
from app.main import app as app_web
from app.routers import anexos
from tests.test_desktop_boot import BACKEND, Sidecar, _linha, _segredos, pedir

TAURI = "http://tauri.localhost"
SENHA = "Senha-forte-do-dono-123!"


@pytest.fixture(scope="module")
def desktop_no_ar(tmp_path_factory):
    data = tmp_path_factory.mktemp("desktop-modo") / "app-data"
    segredos = _segredos()
    s = Sidecar(data, _linha(segredos))
    s.token = segredos["token"]
    try:
        s.esperar_pronto()
        yield s
    finally:
        s.fechar_stdin()
        s.encerrar()


def _com_token(s, **extra) -> dict:
    return {"X-FinControl-Token": s.token, **extra}


def _json(corpo: bytes):
    return json.loads(corpo) if corpo else None


# ---------- CORS ----------

@pytest.mark.parametrize("origem", [TAURI, "tauri://localhost"])
def test_preflight_tauri_200_sem_credenciais(desktop_no_ar, origem):
    status, h, _ = pedir(desktop_no_ar.porta, "OPTIONS", "/api/auth/status", {
        "Origin": origem,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-fincontrol-token, x-client, authorization, content-type, if-match",
    })
    assert status == 200
    assert h.get("access-control-allow-origin") == origem
    assert h.get("access-control-allow-credentials") != "true"
    permitidos = {x.strip().lower() for x in h.get("access-control-allow-headers", "").split(",")}
    assert {"x-fincontrol-token", "x-fincontrol-nonce", "x-refresh-token", "x-client", "if-match",
            "authorization", "content-type"} <= permitidos


def test_preflight_de_origem_estranha_nao_libera(desktop_no_ar):
    status, h, _ = pedir(desktop_no_ar.porta, "OPTIONS", "/api/auth/status", {
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET",
    })
    assert status == 400
    assert "access-control-allow-origin" not in h


def test_resposta_real_leva_cors_da_origem_tauri(desktop_no_ar):
    status, h, _ = pedir(desktop_no_ar.porta, "GET", "/api/auth/status", _com_token(desktop_no_ar, Origin=TAURI))
    assert status == 200
    assert h.get("access-control-allow-origin") == TAURI
    assert h.get("access-control-allow-credentials") != "true"


# ---------- guarda ----------

def test_origem_estranha_403(desktop_no_ar):
    status, _, corpo = pedir(desktop_no_ar.porta, "GET", "/api/auth/status",
                             _com_token(desktop_no_ar, Origin="https://evil.example"))
    assert status == 403
    assert _json(corpo) == {"detail": "origem_invalida"}


def test_origem_do_dev_403_sem_a_flag(desktop_no_ar):
    status, _, _ = pedir(desktop_no_ar.porta, "GET", "/api/auth/status",
                         _com_token(desktop_no_ar, Origin="http://localhost:1420"))
    assert status == 403


@pytest.mark.parametrize("host", ["localhost:{p}", "evil.example:{p}", "127.0.0.1"])
def test_host_errado_400(desktop_no_ar, host):
    status, _, corpo = pedir(desktop_no_ar.porta, "GET", "/api/auth/status",
                             _com_token(desktop_no_ar, Host=host.format(p=desktop_no_ar.porta)))
    assert status == 400
    assert _json(corpo) == {"detail": "host_invalido"}


def test_sem_token_401_e_com_token_200(desktop_no_ar):
    status, _, corpo = pedir(desktop_no_ar.porta, "GET", "/api/auth/status")
    assert status == 401
    assert _json(corpo) == {"detail": "token_local"}
    status, _, _ = pedir(desktop_no_ar.porta, "GET", "/api/auth/status", {"X-FinControl-Token": secrets.token_hex(32)})
    assert status == 401
    status, _, corpo = pedir(desktop_no_ar.porta, "GET", "/api/auth/status", _com_token(desktop_no_ar))
    assert status == 200
    assert set(_json(corpo)) == {"configurado"}


def test_health_nonce_malformado_400(desktop_no_ar):
    status, _, corpo = pedir(desktop_no_ar.porta, "GET", "/api/health", {"X-FinControl-Nonce": "nao-e-hex"})
    assert status == 400
    assert _json(corpo) == {"detail": "nonce_invalido"}


def test_cadastro_sem_token_401(desktop_no_ar):
    corpo = json.dumps({"nome": "Intruso", "email": "x@exemplo.com", "senha": SENHA}).encode()
    status, _, _ = pedir(desktop_no_ar.porta, "POST", "/api/auth/cadastro", {"Content-Type": "application/json"}, corpo)
    assert status == 401


def test_cadastro_so_com_banco_vazio_e_sem_cookie(desktop_no_ar):
    corpo = json.dumps({"nome": "Dono", "email": "dono@exemplo.com", "senha": SENHA}).encode()
    headers = _com_token(desktop_no_ar, Origin=TAURI, **{"Content-Type": "application/json"})
    status, h, resposta = pedir(desktop_no_ar.porta, "POST", "/api/auth/cadastro", headers, corpo)
    assert status == 201, resposta
    dados = _json(resposta)
    assert dados["token"] and dados["refresh_token"]  # desktop = cliente nativo: refresh no JSON
    assert "set-cookie" not in h  # sem cookie: ele não separaria por porta em 127.0.0.1
    status, _, _ = pedir(desktop_no_ar.porta, "POST", "/api/auth/cadastro", headers, corpo)
    assert status == 409


@pytest.fixture(scope="module")
def jwt_desktop(desktop_no_ar):
    """Access token do dono (cria a conta se o teste de cadastro não rodou antes)."""
    porta, json_ct = desktop_no_ar.porta, {"Content-Type": "application/json"}
    _, _, corpo = pedir(porta, "GET", "/api/auth/status", _com_token(desktop_no_ar))
    if not _json(corpo)["configurado"]:
        cadastro = json.dumps({"nome": "Dono", "email": "dono@exemplo.com", "senha": SENHA}).encode()
        pedir(porta, "POST", "/api/auth/cadastro", _com_token(desktop_no_ar, **json_ct), cadastro)
    status, _, corpo = pedir(porta, "POST", "/api/auth/login", _com_token(desktop_no_ar, **json_ct),
                             json.dumps({"email": "dono@exemplo.com", "senha": SENHA}).encode())
    assert status == 200, corpo
    return _json(corpo)["token"]


@pytest.mark.parametrize(("chave", "valor"), [
    ("FINCONTROL_DESKTOP_TOKEN", None), ("FINCONTROL_DESKTOP_TOKEN", "abc"),
    ("FINCONTROL_FERNET_KEY", None), ("FINCONTROL_SECRET_KEY", None), ("FINCONTROL_SECRET_KEY", "curta"),
])
def test_modo_desktop_sem_segredos_nao_sobe(tmp_path, chave, valor):
    segredos = _segredos()
    env = {k: v for k, v in os.environ.items() if not k.startswith("FINCONTROL_")}
    env.update(FINCONTROL_MODO="desktop", FINCONTROL_DATA=str(tmp_path / "app-data"), FINCONTROL_PORTA="12345",
               FINCONTROL_SECRET_KEY=segredos["secret_key"], FINCONTROL_FERNET_KEY=segredos["fernet_key"],
               FINCONTROL_DESKTOP_TOKEN=segredos["token"])
    if valor is None:
        del env[chave]
    else:
        env[chave] = valor
    r = subprocess.run([sys.executable, "-c", "import app.main"], cwd=BACKEND, env=env, capture_output=True, timeout=60)
    assert r.returncode != 0
    assert b"modo desktop" in r.stderr and chave.encode() in r.stderr
    assert not (tmp_path / "app-data" / "fincontrol.db").exists()  # falhou antes do migrate()


@pytest.mark.parametrize(("metodo", "caminho"), [
    ("GET", "/api/auth/webauthn/status"),
    ("POST", "/api/auth/webauthn/login/begin"),
    ("GET", "/api/push/config"),
    ("POST", "/api/push/subscribe"),
    ("GET", "/api/calendario"),
    ("POST", "/api/calendario/regenerar"),
    ("GET", "/calendar/qualquer.ics"),
    ("GET", "/docs"),
    ("GET", "/redoc"),
    ("GET", "/openapi.json"),
    ("GET", "/"),
])
def test_rotas_de_servidor_e_docs_404(desktop_no_ar, jwt_desktop, metodo, caminho):
    headers = _com_token(desktop_no_ar, Authorization=f"Bearer {jwt_desktop}", **{"Content-Type": "application/json"})
    status, _, _ = pedir(desktop_no_ar.porta, metodo, caminho, headers, b"{}" if metodo == "POST" else None)
    assert status == 404


def test_rota_comum_existe_e_exige_login(desktop_no_ar, jwt_desktop):
    status, _, _ = pedir(desktop_no_ar.porta, "GET", "/api/categorias", _com_token(desktop_no_ar))
    assert status == 401
    status, _, _ = pedir(desktop_no_ar.porta, "GET", "/api/categorias",
                         _com_token(desktop_no_ar, Authorization=f"Bearer {jwt_desktop}"))
    assert status == 200


def test_abrir_existe_no_desktop_atras_do_login(desktop_no_ar, jwt_desktop):
    status, _, _ = pedir(desktop_no_ar.porta, "POST", "/api/anexos/999999/abrir", _com_token(desktop_no_ar))
    assert status == 401
    status, _, corpo = pedir(desktop_no_ar.porta, "POST", "/api/anexos/999999/abrir",
                             _com_token(desktop_no_ar, Authorization=f"Bearer {jwt_desktop}"))
    assert status == 404
    assert _json(corpo) == {"detail": "Anexo não encontrado"}


# ---------- segredos fora do ambiente (em processo) ----------

def test_remover_segredos_do_ambiente():
    env = {"FINCONTROL_SECRET_KEY": "a", "FINCONTROL_FERNET_KEY": "b", "FINCONTROL_DESKTOP_TOKEN": "c",
           "FINCONTROL_DATA": "/dados", "PATH": "/bin"}
    desktop.remover_segredos_do_ambiente(env)
    assert env == {"FINCONTROL_DATA": "/dados", "PATH": "/bin"}


def test_remover_segredos_limpa_o_os_environ(monkeypatch):
    for chave in desktop.SEGREDOS_ENV:
        monkeypatch.setenv(chave, "valor-de-teste")
    desktop.remover_segredos_do_ambiente()
    assert not set(desktop.SEGREDOS_ENV) & set(os.environ)


def test_desktop_remove_os_segredos_depois_de_importar_o_app_e_sem_proxy_headers():
    fonte = inspect.getsource(desktop.main)
    importa, remove, sobe = (fonte.index("from app.main import app"), fonte.index("remover_segredos_do_ambiente()"),
                             fonte.index("uvicorn.run("))
    assert importa < remove < sobe
    assert "proxy_headers=False" in fonte[sobe:]


def test_cripto_segue_funcionando_sem_as_variaveis(monkeypatch):
    chave = cripto._MASTER_KEY
    monkeypatch.delenv("FINCONTROL_FERNET_KEY", raising=False)
    monkeypatch.delenv("FINCONTROL_SECRET_KEY", raising=False)
    assert cripto._MASTER_KEY == chave
    assert cripto.descriptografar(cripto.criptografar("sk-teste")) == "sk-teste"


# ---------- /abrir (em processo, abridor trocado) ----------

@pytest.fixture
def abridor(monkeypatch):
    chamadas = []
    monkeypatch.setattr(anexos, "_abrir_no_sistema", chamadas.append)
    return chamadas


@pytest.fixture
def anexo_db():
    db = connect()
    ids = []

    def inserir(caminho: str) -> int:
        cur = db.execute("INSERT INTO anexos (tipo, caminho_arquivo, nome_original, tamanho_bytes) VALUES (?, ?, ?, ?)",
                         ("pdf", caminho, "nota.pdf", 5))
        db.commit()
        ids.append(cur.lastrowid)
        return cur.lastrowid

    yield db, inserir
    for i in ids:
        db.execute("DELETE FROM anexos WHERE id = ?", (i,))
    db.commit()
    db.close()


def test_abrir_id_desconhecido_404(anexo_db, abridor):
    db, _ = anexo_db
    with pytest.raises(HTTPException) as erro:
        anexos.abrir(999_999, db)
    assert erro.value.status_code == 404
    assert abridor == []


def test_abrir_recusa_caminho_fora_de_uploads(anexo_db, abridor, tmp_path):
    db, inserir = anexo_db
    fora = tmp_path / "fora.pdf"
    fora.write_bytes(b"%PDF-")
    for caminho in ("../fora.pdf", "../../fora.pdf", str(fora)):
        with pytest.raises(HTTPException) as erro:
            anexos.abrir(inserir(caminho), db)
        assert erro.value.status_code == 400
    assert abridor == []


def test_abrir_recusa_extensao_fora_dos_tipos_permitidos(anexo_db, abridor):
    db, inserir = anexo_db
    anexos.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    perigoso = anexos.UPLOADS_DIR / f"{secrets.token_hex(8)}.exe"
    perigoso.write_bytes(b"MZ")
    try:
        with pytest.raises(HTTPException) as erro:
            anexos.abrir(inserir(perigoso.name), db)
        assert erro.value.status_code == 400
    finally:
        perigoso.unlink()
    assert abridor == []


def test_abrir_sucesso_204_chama_o_abridor_uma_vez(anexo_db, abridor):
    db, inserir = anexo_db
    anexos.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    arquivo = anexos.UPLOADS_DIR / f"{secrets.token_hex(8)}.pdf"
    arquivo.write_bytes(b"%PDF-1.4")
    try:
        resposta = anexos.abrir(inserir(arquivo.name), db)
    finally:
        arquivo.unlink()
    assert resposta.status_code == 204
    assert abridor == [arquivo.resolve()]
    assert Path(abridor[0]).is_relative_to(anexos.UPLOADS_DIR.resolve())


def test_abrir_nao_existe_fora_do_desktop(autenticado):
    assert not any(getattr(r, "path", "").endswith("/abrir") for r in app_web.routes)
    r = autenticado.post("/api/anexos/1/abrir")
    # Sem a rota: 404, ou 405 quando o frontend/dist local registra o catch-all GET do SPA.
    assert r.status_code in (404, 405)
