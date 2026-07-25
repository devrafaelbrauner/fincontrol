import logging
import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .auth import limiter, require_auth
from .auth import router as auth_router
from .db import migrate
from .routers import anexos, calendario, categorias, contas_fixas, dashboard, entradas, ia, metas, push, variaveis

migrate()

# Aviso de segurança: sem FERNET_KEY própria, a chave do OpenRouter é criptografada
# sob um segredo derivado do SECRET_KEY — inseguro se o SECRET_KEY também for o default.
if not os.environ.get("FINCONTROL_FERNET_KEY") and \
        os.environ.get("FINCONTROL_SECRET_KEY", "dev-insecure-troque-em-producao") == "dev-insecure-troque-em-producao":
    logging.getLogger("uvicorn.error").warning(
        "FINCONTROL_FERNET_KEY e FINCONTROL_SECRET_KEY ausentes: a chave do OpenRouter será "
        "criptografada sob um segredo público de desenvolvimento. Defina-os em produção."
    )

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
