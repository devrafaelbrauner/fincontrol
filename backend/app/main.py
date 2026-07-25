from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_auth
from .auth import router as auth_router
from .db import migrate
from .routers import categorias, contas_fixas, dashboard, entradas, metas, variaveis

migrate()

app = FastAPI(title="FinControl API", version="0.1.0")

# Em produção o frontend é servido pelo mesmo host (Caddy) — CORS só para o dev server do Vite.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
for r in (categorias.router, contas_fixas.router, variaveis.router, entradas.router, metas.router, dashboard.router):
    app.include_router(r, prefix="/api", dependencies=[Depends(require_auth)])


@app.get("/api/health")
def health():
    return {"ok": True}
