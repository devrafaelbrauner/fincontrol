"""Entrada do backend embutido no APK Android, sabor `local` (Chaquopy).

A casca Kotlin (`RuntimeBackend.kt`) chama `iniciar(dados, segredos)` uma vez por processo,
fora da main thread, e recebe a porta:

- `dados`: pasta privada do app (banco, anexos, cópias de antes de migrar);
- `segredos`: JSON `{"secret_key", "fernet_key", "token"}`, com as regras do stdin do desktop.
  As chaves vêm do cofre da casca (AndroidKeyStore); o `token` (64 hex) a casca sorteia a cada
  processo, como o `sidecar.rs` do desktop, e com ele prova o `/api/health` (HMAC do nonce)
  antes de usar a porta. Daqui ele não volta: só a casca e este processo o conhecem.

O resto é o contrato do `desktop.py`, reaproveitado: os segredos ficam no `os.environ` só
até o import de `app.main` (que os lê), o banco é copiado antes de migração pendente, a
guarda de Host/Origin/token vale (`FINCONTROL_MODO=android`: a do desktop, mais a Origin do
WebView do Capacitor) e o bind é só em 127.0.0.1, numa porta livre que o sistema escolhe (bind
em :0 ANTES do import, porque a guarda precisa saber a porta). O uvicorn roda numa thread
daemon: o processo do app é o dono, e o backend morre com ele. Reiniciar = processo novo (o
`app.main` não se importa duas vezes), e é também a saída de uma falha aqui: nada fica de pé
(a porta é solta), mas a 2ª chamada no mesmo processo segue recusada.
"""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import threading
import time
from pathlib import Path

from . import desktop

PRAZO_PRONTO = 20  # s: o mesmo teto de boot do desktop (NF1)

_trava = threading.Lock()
_iniciado = False


def _validar(segredos: str) -> dict[str, str]:
    """Segredos e token da casca, pela mesma regra do stdin do desktop (sem ecoar valores)."""
    try:
        recebidos = json.loads(segredos)
    except (TypeError, ValueError):
        raise desktop.EntradaInvalida("segredos: não é JSON") from None
    try:
        return desktop.validar_segredos(json.dumps(recebidos).encode())
    except desktop.EntradaInvalida as e:
        raise desktop.EntradaInvalida("segredos: " + str(e).removeprefix("stdin: ")) from None


def iniciar(dados: str | os.PathLike[str], segredos: str) -> int:
    """Sobe o backend em 127.0.0.1:<porta livre> e devolve a porta quando ele aceita conexões."""
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
            FINCONTROL_MODO="android",
            FINCONTROL_SECRET_KEY=validos["secret_key"],
            FINCONTROL_FERNET_KEY=validos["fernet_key"],
            FINCONTROL_DESKTOP_TOKEN=validos["token"],
        )
        os.environ.setdefault("FINCONTROL_AGENDADOR", "0")

        # `app.db` lê FINCONTROL_DATA na importação.
        from . import db
        from .versao import VERSAO

        if db.DB_PATH.is_file():
            try:
                if desktop.migracoes_pendentes(db.DB_PATH, db.MIGRATIONS_DIR):
                    desktop.copiar_antes_de_migrar(db.DB_PATH, db.DATA_DIR / "backups", VERSAO)
            except (OSError, sqlite3.Error) as e:
                # Sem cópia, não migra: melhor a casca avisar "falhou" que arriscar o banco.
                raise RuntimeError(f"cópia do banco antes da migração falhou: {type(e).__name__}") from e

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
            sock.close()
            raise RuntimeError("o backend parou antes de ficar pronto (ver o log do uvicorn)")
        if time.monotonic() > limite:
            # Nada fica de pé: o uvicorn sai se ainda chegar ao laço, e a porta é solta.
            servidor.should_exit = True
            sock.close()
            raise TimeoutError(f"o backend não ficou pronto em {PRAZO_PRONTO} s")
        time.sleep(0.005)
    return porta
