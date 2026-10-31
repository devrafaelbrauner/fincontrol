"""Guarda do backend embutido (ASGI puro): Host, Origin e token local em toda requisição.

Ativa com `FINCONTROL_MODO=desktop` (sidecar do Tauri) ou `android` (APK, sabor `local`); o
`main.py` a instala por dentro do CORS, que responde o preflight. O backend escuta em
127.0.0.1 numa porta aleatória, e qualquer processo local ou página com DNS rebinding pode
achar essa porta. Por isso:

- `Host` diferente de `127.0.0.1:<porta>` → 400 `host_invalido` (barra DNS rebinding);
- `Origin` presente e fora da lista → 403 `origem_invalida` (barra páginas do navegador);
- `X-FinControl-Token` diferente do token da sessão → 401 `token_local`.

Só no modo `android` a lista ganha `https://localhost`, a origem do WebView do Capacitor. Ela
é a mesma em todo app Capacitor do aparelho, então lá a Origin não isola nada: quem barra
outro app é o token. No desktop essa origem segue 403.

`GET /api/health` é a única rota sem token: checa Host e Origin e, com o header
`X-FinControl-Nonce` (32 hex), responde `{"ok": true, "prova": HMAC-SHA256(token, nonce)}`.
A casca prova assim que quem responde na porta conhece o token, sem nunca enviá-lo.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re

ORIGENS_DESKTOP = ("tauri://localhost", "http://tauri.localhost")
ORIGEM_ANDROID = "https://localhost"  # WebView do Capacitor; só com FINCONTROL_MODO=android
ORIGEM_DEV = "http://localhost:1420"  # `tauri dev` (Vite); só com FINCONTROL_DESKTOP_DEV=1
HEADER_TOKEN = b"x-fincontrol-token"
HEADER_NONCE = b"x-fincontrol-nonce"
CAMINHO_HEALTH = "/api/health"

_HEX64 = re.compile(r"[0-9a-fA-F]{64}")
_NONCE = re.compile(r"[0-9a-f]{32}")


def prova_de(token: str, nonce: str) -> str:
    """HMAC-SHA256(chave = token, mensagem = nonce), em hex minúsculo."""
    return hmac.new(token.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256).hexdigest()


def modo_android() -> bool:
    """`FINCONTROL_MODO=android`, que o `app/android.py` liga antes de importar o `app.main`."""
    return os.environ.get("FINCONTROL_MODO", "").strip().lower() == "android"


def origens_desktop(dev: bool) -> list[str]:
    android = (ORIGEM_ANDROID,) if modo_android() else ()
    return [*ORIGENS_DESKTOP, *android, *((ORIGEM_DEV,) if dev else ())]


def _resposta(status: int, corpo: dict) -> tuple[dict, dict]:
    dados = json.dumps(corpo, separators=(",", ":")).encode()
    inicio = {
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(dados)).encode())],
    }
    return inicio, {"type": "http.response.body", "body": dados}


class DesktopGuard:
    """Middleware ASGI. Token, porta e flag de dev chegam uma vez, na construção.

    Os valores vêm por parâmetro (o `main.py` os lê do ambiente no import), porque o
    `desktop.py` apaga o token do `os.environ` antes da primeira requisição — e o
    Starlette só constrói a pilha de middlewares nessa primeira requisição. O modo
    (`origens_desktop`) sai do `FINCONTROL_MODO`, que não é segredo e fica no ambiente.
    """

    def __init__(self, app, *, token: str, porta: int, dev: bool = False) -> None:
        if not isinstance(token, str) or not _HEX64.fullmatch(token):
            raise RuntimeError("modo desktop sem FINCONTROL_DESKTOP_TOKEN válido (64 hex): recusando subir")
        if not isinstance(porta, int) or not 1 <= porta <= 65535:
            raise RuntimeError("modo desktop sem FINCONTROL_PORTA válida (1–65535): recusando subir")
        self.app = app
        self._token = token.encode("utf-8")
        self._token_str = token
        self._host = f"127.0.0.1:{porta}".encode()
        self._origens = frozenset(o.encode() for o in origens_desktop(dev))

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers: dict[bytes, list[bytes]] = {}
        for nome, valor in scope.get("headers") or ():
            headers.setdefault(nome.lower(), []).append(valor)

        erro = self._checar(scope, headers)
        if erro is None and scope["type"] == "http" and scope["method"] == "GET" and scope["path"] == CAMINHO_HEALTH:
            nonces = headers.get(HEADER_NONCE)
            if nonces is None:
                await self.app(scope, receive, send)  # {"ok": true}, sem token
                return
            nonce = nonces[0].decode("latin-1") if len(nonces) == 1 else ""
            if not _NONCE.fullmatch(nonce):
                erro = (400, "nonce_invalido")
            else:
                await self._enviar(scope, send, 200, {"ok": True, "prova": prova_de(self._token_str, nonce)})
                return
        if erro is None and not self._token_ok(headers.get(HEADER_TOKEN)):
            erro = (401, "token_local")
        if erro is None:
            await self.app(scope, receive, send)
            return
        await self._enviar(scope, send, erro[0], {"detail": erro[1]})

    def _checar(self, scope, headers: dict[bytes, list[bytes]]) -> tuple[int, str] | None:
        if headers.get(b"host") != [self._host]:
            return (400, "host_invalido")
        origens = headers.get(b"origin")
        if origens is not None and (len(origens) != 1 or origens[0] not in self._origens):
            return (403, "origem_invalida")
        return None

    def _token_ok(self, valores: list[bytes] | None) -> bool:
        if not valores or len(valores) != 1:
            return False
        return hmac.compare_digest(valores[0], self._token)

    @staticmethod
    async def _enviar(scope, send, status: int, corpo: dict) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        inicio, fim = _resposta(status, corpo)
        await send(inicio)
        await send(fim)
