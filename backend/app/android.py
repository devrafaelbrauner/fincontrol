"""Entrada do backend embutido no APK Android, sabor `local` (Chaquopy).

A casca Kotlin chama `iniciar(dados, segredos)` uma vez por processo, fora da main thread,
e recebe `(porta, token)`:

- `dados`: pasta privada do app (banco, anexos, cópias de antes de migrar);
- `segredos`: JSON `{"secret_key", "fernet_key"}`, com as regras do desktop;
- `token`: 64 hex novos a cada processo. Só volta para a casca, que prova o `/api/health`
  com ele (HMAC do nonce, como o `sidecar.rs` do desktop) antes de usar a porta.

O resto é o contrato do `desktop.py`, reaproveitado: os segredos ficam no `os.environ` só
até o import de `app.main` (que os lê), o banco é copiado antes de migração pendente, a
guarda de Host/Origin/token vale (`FINCONTROL_MODO=desktop`) e o bind é só em 127.0.0.1,
numa porta livre que o sistema escolhe (bind em :0 ANTES do import, porque a guarda precisa
saber a porta). O uvicorn roda numa thread daemon: o processo do app é o dono, e o backend
morre com ele. Reiniciar = processo novo (o `app.main` não se importa duas vezes).
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import sqlite3
import threading
import time
from pathlib import Path

from . import desktop

CHAVES = frozenset({"secret_key", "fernet_key"})
PRAZO_PRONTO = 20  # s: o mesmo teto de boot do desktop (NF1)
# Origem das páginas do Capacitor (o WebView do app serve o front em https://localhost).
# Spike S0: entra na lista da guarda daqui; a S1 a leva para o desktop_guard.py, com
# FINCONTROL_MODO=android.
ORIGEM_CAPACITOR = "https://localhost"

_trava = threading.Lock()
_iniciado = False


def _validar(segredos: str) -> dict[str, str]:
    """Segredos da casca + token novo, validados pela mesma regra do stdin do desktop."""
    try:
        recebidos = json.loads(segredos)
    except (TypeError, ValueError):
        raise desktop.EntradaInvalida("segredos: não é JSON") from None
    if not isinstance(recebidos, dict) or set(recebidos) != CHAVES:
        raise desktop.EntradaInvalida("segredos: esperado objeto com exatamente secret_key e fernet_key")
    linha = json.dumps({**recebidos, "token": secrets.token_hex(32)}).encode()
    try:
        return desktop.validar_segredos(linha)
    except desktop.EntradaInvalida as e:
        raise desktop.EntradaInvalida("segredos: " + str(e).removeprefix("stdin: ")) from None


def iniciar(dados: str | os.PathLike[str], segredos: str) -> tuple[int, str]:
    """Sobe o backend em 127.0.0.1:<porta livre> e devolve `(porta, token)` quando ele aceita conexões."""
    global _iniciado
    validos = _validar(segredos)
    with _trava:
        if _iniciado:
            raise RuntimeError("backend já iniciado neste processo: reiniciar é abrir um processo novo")
        _iniciado = True

    pasta = Path(dados)
    pasta.mkdir(parents=True, exist_ok=True)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((desktop.HOST, 0))
        porta = sock.getsockname()[1]
        os.environ.update(
            FINCONTROL_DATA=str(pasta),
            FINCONTROL_PORTA=str(porta),
            FINCONTROL_MODO="desktop",
            FINCONTROL_SECRET_KEY=validos["secret_key"],
            FINCONTROL_FERNET_KEY=validos["fernet_key"],
            FINCONTROL_DESKTOP_TOKEN=validos["token"],
        )
        os.environ.setdefault("FINCONTROL_AGENDADOR", "0")

        # `app.db` lê FINCONTROL_DATA na importação.
        from . import db, desktop_guard
        from .versao import VERSAO

        if db.DB_PATH.is_file():
            try:
                if desktop.migracoes_pendentes(db.DB_PATH, db.MIGRATIONS_DIR):
                    desktop.copiar_antes_de_migrar(db.DB_PATH, db.DATA_DIR / "backups", VERSAO)
            except (OSError, sqlite3.Error) as e:
                # Sem cópia, não migra: melhor a casca avisar "falhou" que arriscar o banco.
                raise RuntimeError(f"cópia do banco antes da migração falhou: {type(e).__name__}") from e

        if ORIGEM_CAPACITOR not in desktop_guard.ORIGENS_DESKTOP:
            desktop_guard.ORIGENS_DESKTOP = (*desktop_guard.ORIGENS_DESKTOP, ORIGEM_CAPACITOR)

        import uvicorn

        from .main import app  # roda migrate() na importação e lê os segredos
    except BaseException:
        sock.close()
        raise
    finally:
        desktop.remover_segredos_do_ambiente()

    # asyncio + h11 explícitos: o mesmo caminho no APK (uvicorn sem [standard]) e no teste do host.
    servidor = uvicorn.Server(uvicorn.Config(
        app, loop="asyncio", http="h11", ws="none", lifespan="on",
        access_log=False, log_level="warning", proxy_headers=False,
    ))
    thread = threading.Thread(target=servidor.run, kwargs={"sockets": [sock]}, name="fincontrol-backend", daemon=True)
    thread.start()
    limite = time.monotonic() + PRAZO_PRONTO
    while not servidor.started:
        if not thread.is_alive():
            raise RuntimeError("o backend parou antes de ficar pronto (ver o log do uvicorn)")
        if time.monotonic() > limite:
            raise TimeoutError(f"o backend não ficou pronto em {PRAZO_PRONTO} s")
        time.sleep(0.005)
    return porta, validos["token"]
