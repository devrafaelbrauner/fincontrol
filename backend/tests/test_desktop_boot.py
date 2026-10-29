"""Boot do backend embutido no app desktop (`python -m app.desktop`, do código-fonte).

Exercita o contrato com a casca Rust: segredos numa linha JSON no stdin, bind só em
127.0.0.1, `/api/health` pronto, EOF no stdin encerrando o processo, segredos fora da
saída e do app-data, e a cópia do banco antes de migração pendente (guarda 5).
O executável congelado (PyInstaller) passa pelo mesmo smoke na CI (release.yml).
"""

import json
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from app.util import normalizar_busca
from app.versao import VERSAO

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((BACKEND / "app" / "migrations").glob("*.sql"))
PRAZO_PRONTO = 20
PRAZO_EOF = 3


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _segredos() -> dict[str, str]:
    return {
        "secret_key": secrets.token_hex(32),
        "fernet_key": Fernet.generate_key().decode(),
        "token": secrets.token_hex(32),
    }


class Sidecar:
    def __init__(self, data: Path, linha: bytes, porta: int | None = None):
        self.data = data
        self.porta = porta or _porta_livre()
        self.saida = data.parent / f"saida-{self.porta}.log"
        env = {k: v for k, v in os.environ.items() if not k.startswith("FINCONTROL_")}
        env.update(FINCONTROL_DATA=str(data), FINCONTROL_PORTA=str(self.porta),
                   FINCONTROL_AGENDADOR="0", FINCONTROL_MODO="desktop")
        self._arquivo_saida = open(self.saida, "wb")  # noqa: SIM115
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "app.desktop"], cwd=BACKEND, env=env,
            stdin=subprocess.PIPE, stdout=self._arquivo_saida, stderr=subprocess.STDOUT,
        )
        self.proc.stdin.write(linha)
        self.proc.stdin.flush()

    def esperar_pronto(self) -> float:
        inicio = time.monotonic()
        while time.monotonic() - inicio < PRAZO_PRONTO:
            assert self.proc.poll() is None, f"o sidecar saiu antes de ficar pronto:\n{self.texto_saida()}"
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.porta}/api/health", timeout=1) as r:
                    if r.status == 200:
                        assert json.loads(r.read()) == {"ok": True}
                        return time.monotonic() - inicio
            except OSError:
                pass
            time.sleep(0.1)
        pytest.fail(f"/api/health não respondeu em {PRAZO_PRONTO} s:\n{self.texto_saida()}")

    def fechar_stdin(self) -> float:
        inicio = time.monotonic()
        if not self.proc.stdin.closed:
            self.proc.stdin.close()
        self.proc.wait(timeout=10)
        return time.monotonic() - inicio

    def encerrar(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(timeout=10)
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        self._arquivo_saida.close()

    def texto_saida(self) -> str:
        self._arquivo_saida.flush()
        return self.saida.read_bytes().decode("utf-8", "replace")


def _linha(segredos: dict[str, str]) -> bytes:
    return (json.dumps(segredos) + "\n").encode()


def _ip_fora_do_loopback() -> str | None:
    candidatos = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.0.2.1", 9))  # UDP não envia nada: só escolhe a interface de saída
            candidatos.add(s.getsockname()[0])
        except OSError:
            pass
    try:
        candidatos.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    validos = sorted(ip for ip in candidatos if not ip.startswith(("127.", "0.")))
    return validos[0] if validos else None


@pytest.fixture(scope="module")
def no_ar(tmp_path_factory):
    """Um sidecar com app-data vazio, de pé para os testes do caminho feliz."""
    data = tmp_path_factory.mktemp("desktop-boot") / "app-data"
    segredos = _segredos()
    s = Sidecar(data, _linha(segredos))
    s.segredos = segredos
    try:
        s.esperar_pronto()
        yield s
    finally:
        s.encerrar()


def test_health_responde_em_127(no_ar):
    with urllib.request.urlopen(f"http://127.0.0.1:{no_ar.porta}/api/health", timeout=2) as r:
        assert r.status == 200
        assert json.loads(r.read()) == {"ok": True}
    assert (no_ar.data / "fincontrol.db").is_file()
    assert not (no_ar.data / "backups").exists()  # banco novo: nada a copiar


def test_porta_nao_escuta_fora_do_loopback(no_ar):
    ip = _ip_fora_do_loopback()
    if ip is None:
        pytest.skip("nenhum IP local fora do loopback nesta máquina")
    with pytest.raises(OSError):
        socket.create_connection((ip, no_ar.porta), timeout=2).close()


def test_eof_no_stdin_encerra_em_ate_3s(no_ar):
    no_ar.esperar_pronto()
    assert no_ar.fechar_stdin() <= PRAZO_EOF
    assert no_ar.proc.returncode == 0


def test_segredos_fora_da_saida_e_do_app_data(no_ar):
    no_ar.fechar_stdin()
    valores = [v.encode() for v in no_ar.segredos.values()]
    saida = no_ar.saida.read_bytes()
    for v in valores:
        assert v not in saida
    for arquivo in (p for p in no_ar.data.rglob("*") if p.is_file()):
        conteudo = arquivo.read_bytes()
        for v in valores:
            assert v not in conteudo, f"segredo gravado em {arquivo.name}"


@pytest.mark.parametrize("linha", [
    b"isto nao e json\n",
    b"\n",
    b"[]\n",
    pytest.param("sem_token", id="falta-token"),
    pytest.param("hex_curto", id="secret-curta"),
    pytest.param("fernet_ruim", id="fernet-invalida"),
    pytest.param("chave_extra", id="chave-extra"),
])
def test_stdin_invalido_sai_com_erro_rapido(tmp_path, linha):
    segredos = _segredos()
    if linha == "sem_token":
        linha = _linha({k: v for k, v in segredos.items() if k != "token"})
    elif linha == "hex_curto":
        linha = _linha({**segredos, "secret_key": segredos["secret_key"][:40]})
    elif linha == "fernet_ruim":
        linha = _linha({**segredos, "fernet_key": "A" * 43 + "!"})
    elif linha == "chave_extra":
        linha = _linha({**segredos, "outra": "x"})
    s = Sidecar(tmp_path / "app-data", linha)
    try:
        inicio = time.monotonic()
        s.proc.wait(timeout=15)
        assert time.monotonic() - inicio < 15
        assert s.proc.returncode not in (0, None)
        saida = s.texto_saida()
        assert "fincontrol-backend:" in saida
        for v in segredos.values():
            assert v not in saida
        assert not (tmp_path / "app-data" / "fincontrol.db").exists()  # nem chegou ao app
    finally:
        s.encerrar()


def _banco_antigo(db_path: Path, aplicar: int) -> None:
    """Banco como um app de versão anterior deixaria: as `aplicar` primeiras migrações."""
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.create_function("norm", 1, normalizar_busca, deterministic=True)
    conn.execute("CREATE TABLE schema_migrations (nome TEXT PRIMARY KEY,"
                 " aplicada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    for sql in MIGRATIONS[:aplicar]:
        conn.executescript(sql.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations (nome) VALUES (?)", (sql.name,))
        conn.commit()
    conn.close()


def _migracoes_em(db_path: Path) -> int:
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
    finally:
        conn.close()


def test_copia_o_banco_antes_de_migracao_pendente_e_guarda_5(tmp_path):
    data = tmp_path / "app-data"
    db_path = data / "fincontrol.db"
    aplicadas = len(MIGRATIONS) - 1
    _banco_antigo(db_path, aplicadas)
    backups = data / "backups"
    backups.mkdir()
    antigas = []
    for i in range(6):  # 6 cópias antigas + a nova = 7; ficam as 5 mais novas
        p = backups / f"pre-migracao-0.9.0-2020010{i + 1}-000000.db"
        p.write_bytes(b"velha")
        os.utime(p, (1_600_000_000 + i, 1_600_000_000 + i))
        antigas.append(p)

    s = Sidecar(data, _linha(_segredos()))
    try:
        s.esperar_pronto()
        assert s.fechar_stdin() <= PRAZO_EOF
    finally:
        s.encerrar()

    versao = re.escape(re.sub(r"[^A-Za-z0-9._-]", "_", VERSAO))
    novas = [p for p in backups.glob("pre-migracao-*.db") if re.fullmatch(rf"pre-migracao-{versao}-\d{{8}}-\d{{6}}\.db", p.name)]
    assert len(novas) == 1, sorted(p.name for p in backups.iterdir())
    assert _migracoes_em(novas[0]) == aplicadas  # foto de antes da migração
    assert _migracoes_em(db_path) == len(MIGRATIONS)  # o app migrou depois
    restantes = sorted(backups.iterdir())
    assert len(restantes) == 5
    assert set(restantes) == {novas[0], *antigas[-4:]}
    assert not list(backups.glob("*.parcial"))

    # Banco em dia: subir de novo não cria cópia.
    s = Sidecar(data, _linha(_segredos()))
    try:
        s.esperar_pronto()
    finally:
        s.fechar_stdin()
        s.encerrar()
    assert sorted(backups.iterdir()) == restantes
