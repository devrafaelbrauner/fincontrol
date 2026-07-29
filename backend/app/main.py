import logging
import os

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .auth import COOKIE_SECURE, IS_PROD, SECRET_KEY, SECRET_KEY_DEFAULT, limiter, require_auth
from .auth import router as auth_router
from .db import migrate
from .routers import anexos, calendario, categorias, contas_fixas, dashboard, entradas, ia, metas, push, variaveis

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

app = FastAPI(title="FinControl API", version="0.1.0")

# Rate limiting (slowapi) — protege o login de brute force.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
for r in (categorias.router, contas_fixas.router, variaveis.router, entradas.router, metas.router, dashboard.router, anexos.router, calendario.router, ia.router, push.router):
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
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{caminho:path}", include_in_schema=False)
    def spa(caminho: str):
        if caminho.startswith("api/"):
            raise HTTPException(404)
        arquivo = (DIST / caminho).resolve()
        if caminho and arquivo.is_file() and arquivo.is_relative_to(DIST):
            return FileResponse(arquivo)
        return FileResponse(DIST / "index.html")
