"""Anexo no disco: o caminho gravado não pode escapar do diretório de uploads.

O `/abrir` só existe no backend embutido e muda com o modo: no desktop o Python abre o arquivo
no app do sistema (204); no APK Android ele devolve `{caminho}` relativo à pasta de dados e a
casca abre pelo FileProvider. Os dois passam pela mesma conferência (só em `uploads/`, só tipo
aceito, só se existir), testada aqui em processo com o abridor trocado. A rota que cada modo
registra é conferida num processo filho, que importa o router no modo de cada um (o modo é
lido no import). Servir de ponta a ponta: `test_android_boot` e `test_desktop_modo`.
"""
import json
import os
import secrets
import subprocess
import sys

import pytest
from fastapi import HTTPException

from app.db import DATA_DIR, connect
from app.routers import anexos
from tests.test_desktop_boot import BACKEND


def test_baixar_recusa_path_traversal(autenticado):
    db = connect()
    cur = db.execute(
        "INSERT INTO anexos (tipo, caminho_arquivo, nome_original, tamanho_bytes) VALUES (?, ?, ?, ?)",
        ("pdf", "../../etc/passwd", "passwd.pdf", 1),
    )
    anexo_id = cur.lastrowid
    db.commit()
    db.close()

    r = autenticado.get(f"/api/anexos/{anexo_id}")
    assert r.status_code == 400
    assert "inválido" in r.json()["detail"].lower()


# ---------- /abrir: a mesma conferência nos dois modos ----------

ABRIR_POR_MODO = {"desktop": anexos.abrir, "android": anexos.caminho_para_abrir}


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


@pytest.fixture
def arquivo_em_uploads():
    """Arquivos de verdade em uploads/, apagados no fim."""
    criados = []

    def criar(extensao: str, conteudo: bytes = b"%PDF-1.4"):
        anexos.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        arquivo = anexos.UPLOADS_DIR / f"{secrets.token_hex(8)}{extensao}"
        arquivo.write_bytes(conteudo)
        criados.append(arquivo)
        return arquivo

    yield criar
    for arquivo in criados:
        arquivo.unlink(missing_ok=True)


@pytest.mark.parametrize("modo", ABRIR_POR_MODO)
def test_abrir_id_desconhecido_404(anexo_db, abridor, modo):
    db, _ = anexo_db
    with pytest.raises(HTTPException) as erro:
        ABRIR_POR_MODO[modo](999_999, db)
    assert erro.value.status_code == 404
    assert abridor == []


@pytest.mark.parametrize("modo", ABRIR_POR_MODO)
def test_abrir_recusa_caminho_fora_de_uploads(anexo_db, abridor, tmp_path, modo):
    db, inserir = anexo_db
    fora = tmp_path / "fora.pdf"
    fora.write_bytes(b"%PDF-")
    banco = DATA_DIR / "fincontrol.db"  # o vizinho que um caminho forjado tentaria expor
    for caminho in ("../fora.pdf", "../../fora.pdf", str(fora), "../fincontrol.db", str(banco)):
        with pytest.raises(HTTPException) as erro:
            ABRIR_POR_MODO[modo](inserir(caminho), db)
        assert erro.value.status_code == 400, caminho
    assert abridor == []


@pytest.mark.parametrize("modo", ABRIR_POR_MODO)
def test_abrir_recusa_extensao_fora_dos_tipos_permitidos(anexo_db, abridor, arquivo_em_uploads, modo):
    db, inserir = anexo_db
    perigoso = arquivo_em_uploads(".exe", b"MZ")
    with pytest.raises(HTTPException) as erro:
        ABRIR_POR_MODO[modo](inserir(perigoso.name), db)
    assert erro.value.status_code == 400
    assert abridor == []


@pytest.mark.parametrize("modo", ABRIR_POR_MODO)
def test_abrir_arquivo_sumido_404(anexo_db, abridor, modo):
    db, inserir = anexo_db
    with pytest.raises(HTTPException) as erro:
        ABRIR_POR_MODO[modo](inserir(f"{secrets.token_hex(8)}.pdf"), db)
    assert erro.value.status_code == 404
    assert abridor == []


def test_abrir_no_desktop_abre_no_sistema_e_responde_204(anexo_db, abridor, arquivo_em_uploads):
    db, inserir = anexo_db
    arquivo = arquivo_em_uploads(".pdf")
    resposta = anexos.abrir(inserir(arquivo.name), db)
    assert resposta.status_code == 204
    assert abridor == [arquivo.resolve()]


@pytest.mark.parametrize("extensao", [".pdf", ".png"])
def test_abrir_no_android_devolve_o_caminho_em_uploads_sem_abrir_nada(anexo_db, abridor, arquivo_em_uploads, extensao):
    db, inserir = anexo_db
    arquivo = arquivo_em_uploads(extensao)
    resposta = anexos.caminho_para_abrir(inserir(arquivo.name), db)
    assert resposta == {"caminho": f"uploads/{arquivo.name}"}
    # Relativo à pasta de dados: é de lá que a casca resolve (`pastaDeDados()/caminho`).
    assert (DATA_DIR / resposta["caminho"]).resolve() == arquivo.resolve()
    assert abridor == []


# ---------- a rota que cada modo registra ----------

SONDA = """
import json
from app.routers import anexos
print(json.dumps([
    {"endpoint": r.endpoint.__name__, "metodos": sorted(r.methods), "status": r.status_code}
    for r in anexos.router.routes if r.path == "/anexos/{anexo_id}/abrir"
]))
"""


@pytest.mark.parametrize(("modo", "rota"), [
    ("desktop", [{"endpoint": "abrir", "metodos": ["POST"], "status": 204}]),
    ("android", [{"endpoint": "caminho_para_abrir", "metodos": ["POST"], "status": None}]),
    ("", []),  # servidor: sem a rota
])
def test_cada_modo_registra_o_seu_abrir(tmp_path, modo, rota):
    env = {k: v for k, v in os.environ.items() if not k.startswith("FINCONTROL_")}
    env.update(FINCONTROL_MODO=modo, FINCONTROL_DATA=str(tmp_path / "dados"))
    r = subprocess.run([sys.executable, "-c", SONDA], cwd=BACKEND, env=env, capture_output=True, timeout=60)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    assert json.loads(r.stdout) == rota
