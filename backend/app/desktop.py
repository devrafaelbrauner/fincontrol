"""Entrada do backend embutido no app desktop (sidecar do Tauri).

O app desktop (casca Rust) lança este processo com:

- env público: `FINCONTROL_DATA` (app-data), `FINCONTROL_PORTA`, `FINCONTROL_AGENDADOR=0`,
  `FINCONTROL_MODO=desktop`;
- stdin: UMA linha JSON `{"secret_key", "fernet_key", "token"}` e o pipe continua aberto.

Os segredos vêm pelo stdin, e não pelo env do spawn, porque o ambiente de um processo é
legível por outros processos do mesmo usuário. Aqui eles vão para `os.environ` ANTES de
importar `app.main` (`auth.py`, `cripto.py` e a guarda do modo desktop os leem na
importação) e saem do `os.environ` logo depois, para nenhum processo filho (ex.: o
`os.startfile` do `/api/anexos/{id}/abrir`) herdá-los. Nunca são impressos nem logados.

Antes de o `app.main` rodar `migrate()`, um banco existente com migração pendente é
copiado (API de backup do SQLite) para `<data>/backups/pre-migracao-<versão>-<carimbo>.db`;
ficam as 5 cópias mais novas. O `uvicorn` sobe só em `127.0.0.1`, e o fim do stdin (EOF:
o app fechou ou morreu) encerra o processo na hora.

    python -m app.desktop        # do código-fonte (tests/test_desktop_boot.py)
    fincontrol-backend[.exe]     # congelado pelo PyInstaller (desktop.spec)
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
from datetime import datetime
from pathlib import Path

HOST = "127.0.0.1"
MANTER_BACKUPS = 5
TAMANHO_MAX_LINHA = 4096
CHAVES = frozenset({"secret_key", "fernet_key", "token"})
SEGREDOS_ENV = ("FINCONTROL_SECRET_KEY", "FINCONTROL_FERNET_KEY", "FINCONTROL_DESKTOP_TOKEN")
_HEX64 = re.compile(r"[0-9a-fA-F]{64}")
_FERNET = re.compile(r"[A-Za-z0-9_-]{43}=")

# Códigos de saída (a casca Rust só distingue zero de não zero; o número ajuda no log).
SAIDA_ENTRADA_INVALIDA = 2
SAIDA_BACKUP_FALHOU = 3


class EntradaInvalida(ValueError):
    """Stdin ou env fora do contrato. A mensagem nunca carrega os valores recebidos."""


def validar_segredos(linha: bytes) -> dict[str, str]:
    try:
        dados = json.loads(linha.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise EntradaInvalida("stdin: a primeira linha não é JSON UTF-8") from None
    if not isinstance(dados, dict) or set(dados) != CHAVES:
        raise EntradaInvalida("stdin: esperado objeto com exatamente secret_key, fernet_key e token")
    if not all(isinstance(v, str) for v in dados.values()):
        raise EntradaInvalida("stdin: os valores devem ser texto")
    if not _HEX64.fullmatch(dados["secret_key"]):
        raise EntradaInvalida("stdin: secret_key deve ter 64 caracteres hexadecimais")
    if not _HEX64.fullmatch(dados["token"]):
        raise EntradaInvalida("stdin: token deve ter 64 caracteres hexadecimais")
    if not _FERNET.fullmatch(dados["fernet_key"]):
        raise EntradaInvalida("stdin: fernet_key deve ter 44 caracteres base64 url-safe")
    from cryptography.fernet import Fernet

    try:
        Fernet(dados["fernet_key"].encode("ascii"))
    except ValueError:
        raise EntradaInvalida("stdin: fernet_key não é uma chave Fernet válida") from None
    return dados


def ler_porta(bruto: str | None) -> int:
    if not bruto or not bruto.isdigit() or not 1 <= int(bruto) <= 65535:
        raise EntradaInvalida("FINCONTROL_PORTA ausente ou fora de 1–65535")
    return int(bruto)


def migracoes_pendentes(db_path: Path, migrations_dir: Path) -> bool:
    """Mesma regra do `db.migrate()`: arquivo .sql sem linha em `schema_migrations`."""
    arquivos = {p.name for p in migrations_dir.glob("*.sql")}
    conn = sqlite3.connect(db_path)
    try:
        tem_tabela = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ).fetchone()
        aplicadas = {r[0] for r in conn.execute("SELECT nome FROM schema_migrations")} if tem_tabela else set()
    finally:
        conn.close()
    return bool(arquivos - aplicadas)


def copiar_antes_de_migrar(db_path: Path, pasta: Path, versao: str, agora: datetime | None = None) -> Path:
    """Copia o banco com a API de backup do SQLite (consistente mesmo em WAL) e poda as antigas."""
    pasta.mkdir(parents=True, exist_ok=True)
    versao_segura = re.sub(r"[^A-Za-z0-9._-]", "_", versao)
    base = f"pre-migracao-{versao_segura}-{(agora or datetime.now()).strftime('%Y%m%d-%H%M%S')}"
    destino = pasta / f"{base}.db"
    n = 1
    while destino.exists():  # reinício no mesmo segundo
        destino = pasta / f"{base}-{n}.db"
        n += 1
    # Copia num nome temporário e renomeia: uma cópia interrompida não conta como backup.
    parcial = destino.with_name(destino.name + ".parcial")
    origem = sqlite3.connect(db_path)
    try:
        alvo = sqlite3.connect(parcial)
        try:
            origem.backup(alvo)
        finally:
            alvo.close()
    finally:
        origem.close()
    os.replace(parcial, destino)
    podar_backups(pasta)
    return destino


def podar_backups(pasta: Path, manter: int = MANTER_BACKUPS) -> None:
    copias = sorted(pasta.glob("pre-migracao-*.db"), key=lambda p: (p.stat().st_mtime, p.name), reverse=True)
    for antiga in copias[manter:]:
        antiga.unlink(missing_ok=True)


def remover_segredos_do_ambiente(env=os.environ) -> None:
    """Tira os segredos do ambiente depois que o app já os leu (import de `app.main`)."""
    for chave in SEGREDOS_ENV:
        env.pop(chave, None)


def _vigiar_stdin(fd: int) -> None:
    """EOF no stdin = o app desktop fechou (ou morreu): sai na hora, sem esperar o uvicorn."""
    try:
        while os.read(fd, 65536):
            pass
    except OSError:
        pass
    os._exit(0)


def _garantir_stdio() -> None:
    # Num executável sem console os streams podem ser None; o logging do uvicorn quebraria.
    # Com console, o Windows usaria a code page do console (cp1252): o log da casca é UTF-8.
    for nome in ("stdout", "stderr"):
        stream = getattr(sys, nome)
        if stream is None:
            setattr(sys, nome, open(os.devnull, "w", encoding="utf-8"))  # noqa: SIM115
        elif hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def _falhar(mensagem: str, codigo: int) -> None:
    print(f"fincontrol-backend: {mensagem}", file=sys.stderr, flush=True)
    sys.exit(codigo)


def main() -> None:
    _garantir_stdio()
    if sys.stdin is None:
        _falhar("stdin ausente: os segredos chegam pelo stdin", SAIDA_ENTRADA_INVALIDA)
    try:
        segredos = validar_segredos(sys.stdin.buffer.readline(TAMANHO_MAX_LINHA))
        porta = ler_porta(os.environ.get("FINCONTROL_PORTA"))
        if not os.environ.get("FINCONTROL_DATA"):
            raise EntradaInvalida("FINCONTROL_DATA ausente")
    except EntradaInvalida as e:
        _falhar(str(e), SAIDA_ENTRADA_INVALIDA)

    threading.Thread(target=_vigiar_stdin, args=(sys.stdin.fileno(),), daemon=True, name="stdin-eof").start()

    os.environ["FINCONTROL_SECRET_KEY"] = segredos["secret_key"]
    os.environ["FINCONTROL_FERNET_KEY"] = segredos["fernet_key"]
    os.environ["FINCONTROL_DESKTOP_TOKEN"] = segredos["token"]
    os.environ.setdefault("FINCONTROL_AGENDADOR", "0")
    del segredos

    # `app.db` lê FINCONTROL_DATA na importação e resolve as migrações como o app (também congelado).
    from app import db
    from app.versao import VERSAO

    if db.DB_PATH.is_file():
        try:
            if migracoes_pendentes(db.DB_PATH, db.MIGRATIONS_DIR):
                copiar_antes_de_migrar(db.DB_PATH, db.DATA_DIR / "backups", VERSAO)
        except (OSError, sqlite3.Error) as e:
            # Sem cópia, não migra: melhor o app avisar "falhou" que arriscar o banco.
            _falhar(f"cópia do banco antes da migração falhou: {type(e).__name__}", SAIDA_BACKUP_FALHOU)

    import uvicorn

    from app.main import app  # roda migrate() na importação e lê os segredos

    remover_segredos_do_ambiente()
    # Sem proxy na frente: X-Forwarded-For/Proto de um cliente local não valem nada
    # (furariam o rate limit por IP).
    uvicorn.run(app, host=HOST, port=porta, workers=1, access_log=False, log_level="warning",
                proxy_headers=False)


if __name__ == "__main__":
    main()
