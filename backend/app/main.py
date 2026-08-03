import asyncio
import contextlib
import logging
import os

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .auth import COOKIE_SECURE, IS_PROD, SECRET_KEY, SECRET_KEY_DEFAULT, limiter, require_auth
from .auth import router as auth_router
from .db import connect, migrate
from .routers import analises, anexos, calendario, categorias, contas_fixas, dashboard, entradas, ia, metas, orcamentos, push, variaveis

_log = logging.getLogger("uvicorn.error")


def _validar_ambiente() -> None:
    """Falha rápido em produção se os segredos forem os defaults inseguros.

    Sem isto, um .env incompleto sobe o app com um SECRET_KEY público (do repo),
    permitindo forjar JWTs válidos e burlar senha+2FA. Ver deploy/README.md.
    """
    tem_fernet = bool(os.environ.get("FINCONTROL_FERNET_KEY"))
    if IS_PROD:
        problemas = []
        if SECRET_KEY == SECRET_KEY_DEFAULT or len(SECRET_KEY) < 32:
            problemas.append("FINCONTROL_SECRET_KEY ausente, curta (<32) ou igual ao default")
        if not tem_fernet:
            problemas.append("FINCONTROL_FERNET_KEY ausente (obrigatória em produção)")
        if not COOKIE_SECURE:
            problemas.append("FINCONTROL_COOKIE_SECURE deve ser 1 em produção (HTTPS)")
        if problemas:
            raise RuntimeError(
                "Configuração de produção inválida — corrija o backend/.env: "
                + "; ".join(problemas)
            )
    elif SECRET_KEY == SECRET_KEY_DEFAULT and not tem_fernet:
        _log.warning(
            "Rodando com SECRET_KEY de desenvolvimento (público). OK para dev local; "
            "em produção defina FINCONTROL_ENV=production, FINCONTROL_SECRET_KEY e FINCONTROL_FERNET_KEY."
        )


_validar_ambiente()  # valida os segredos ANTES de tocar no banco
migrate()


def _avisar_se_sem_conta() -> None:
    """Banco sem conta em produção = /api/auth/cadastro aberto para quem chegar
    primeiro. É o estado normal antes do setup_user, mas também o estado de um
    backup restaurado vazio — e aí passa despercebido. Ver deploy/README.md."""
    if not IS_PROD:
        return
    db = connect()
    try:
        tem_conta = db.execute("SELECT 1 FROM config WHERE chave = 'senha_hash'").fetchone()
    finally:
        db.close()
    if not tem_conta:
        _log.warning(
            "NENHUMA CONTA CONFIGURADA: /api/auth/cadastro está aberto e o primeiro "
            "visitante vira o dono. Rode 'python -m app.setup_user' ou cadastre-se agora."
        )


_avisar_se_sem_conta()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Sobe o agendador de lembretes junto com o app (e o encerra junto)."""
    from . import lembretes

    tarefa = asyncio.create_task(lembretes.agendador()) if lembretes.agendador_habilitado() else None
    try:
        yield
    finally:
        if tarefa:
            tarefa.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarefa


# Em produção o schema/docs da API não ficam expostos.
app = FastAPI(
    title="FinControl API", version="0.1.0", lifespan=lifespan,
    **({"docs_url": None, "redoc_url": None, "openapi_url": None} if IS_PROD else {}),
)

# Rate limiting (slowapi) — protege o login de brute force.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# O multipart é parseado (e derramado para disco) ANTES das dependências de auth
# do FastAPI — sem este teto, um anônimo encheria o disco via /api/anexos. O Caddy
# impõe o mesmo limite na borda (request_body); este cobre o modo sem Caddy (macOS).
LIMITE_CORPO_BYTES = 25 * 1024 * 1024
_CORPO_413 = b'{"detail":"Corpo da requisi\\u00e7\\u00e3o excede 25 MB"}'


class LimiteCorpo:
    """Teto de bytes no corpo da requisição (ASGI puro).

    O content-length é só a checagem barata: ele não existe em Transfer-Encoding:
    chunked, e sozinho deixaria passar um upload sem tamanho declarado. Por isso os
    bytes também são contados conforme chegam, cortando a leitura ao estourar — do
    contrário o parser seguiria derramando o corpo inteiro para o disco.
    """

    def __init__(self, app, limite: int) -> None:
        self.app = app
        self.limite = limite

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        declarado = next((v for k, v in scope["headers"] if k == b"content-length"), b"")
        if declarado.isdigit() and int(declarado) > self.limite:
            return await self._responder_413(send)

        estado = {"lidos": 0, "estourou": False, "respondido": False}

        async def receive_contando():
            mensagem = await receive()
            if mensagem["type"] == "http.request":
                estado["lidos"] += len(mensagem.get("body", b""))
                if estado["lidos"] > self.limite:
                    estado["estourou"] = True
                    return {"type": "http.disconnect"}
            return mensagem

        async def send_filtrando(mensagem):
            # Estourado, a resposta que o app produziria (erro de parse, 500 do
            # disconnect) é descartada em favor de um 413 honesto.
            if not estado["estourou"]:
                return await send(mensagem)
            if estado["respondido"] or mensagem["type"] != "http.response.start":
                return
            estado["respondido"] = True
            await self._responder_413(send)

        try:
            await self.app(scope, receive_contando, send_filtrando)
        except Exception:
            # O disconnect forçado costuma virar ClientDisconnect no parser.
            if not estado["estourou"] or estado["respondido"]:
                raise
            estado["respondido"] = True
            await self._responder_413(send)

    @staticmethod
    async def _responder_413(send) -> None:
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_CORPO_413)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": _CORPO_413})


app.add_middleware(LimiteCorpo, limite=LIMITE_CORPO_BYTES)

# CORS: em produção o frontend é servido pelo mesmo host (Caddy) e CORS é dispensável;
# origens extras (ex. dev server do Vite) via FINCONTROL_CORS_ORIGINS (separadas por vírgula).
origens = os.environ.get("FINCONTROL_CORS_ORIGINS", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origens.split(",") if o.strip()],
    allow_credentials=True,  # necessário para o cookie httpOnly de refresh
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
for r in (categorias.router, contas_fixas.router, variaveis.router, entradas.router, metas.router, dashboard.router, analises.router, orcamentos.router, anexos.router, calendario.router, ia.router, push.router):
    app.include_router(r, prefix="/api", dependencies=[Depends(require_auth)])

# Feed .ics é público (autenticado só pelo token secreto na URL) — fora do require_auth e do /api.
app.include_router(calendario.feed_router)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve o frontend buildado quando frontend/dist existe (app nativo macOS e teste
# local sem Caddy; em produção o Caddy serve o dist diretamente — deploy/Caddyfile).
# Registrado por último: o feed .ics e o /api têm precedência por ordem de registro.
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
# Guard em dist/assets (não só dist/): um build interrompido deixaria o dist
# parcial e o StaticFiles levantaria RuntimeError no boot (restart loop).
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    # Shell do PWA nunca deve ser cacheado (aponta para os bundles com hash, esses
    # sim cacheáveis) — sem isto a WKWebView do app nativo pode reter o shell antigo.
    SEM_CACHE = {"Cache-Control": "no-cache"}
    ARQUIVOS_SEM_CACHE = {"sw.js", "registerSW.js", "manifest.webmanifest"}

    @app.get("/{caminho:path}", include_in_schema=False)
    def spa(caminho: str):
        if caminho.startswith("api/"):
            raise HTTPException(404)
        arquivo = (DIST / caminho).resolve()
        if caminho and arquivo.is_file() and arquivo.is_relative_to(DIST):
            sem_cache = arquivo.suffix == ".html" or arquivo.name in ARQUIVOS_SEM_CACHE
            return FileResponse(arquivo, headers=SEM_CACHE if sem_cache else None)
        return FileResponse(DIST / "index.html", headers=SEM_CACHE)
