# FinControl

App pessoal de finanças — contas fixas, variáveis, entradas, metas, anexos e IA.
Plano completo em [PLANO.md](PLANO.md).

## Stack

- **Backend:** FastAPI + SQLite (`backend/`)
- **Frontend:** React + TypeScript + Vite, PWA (`frontend/`)

## Rodando em desenvolvimento

### Backend (porta 8000)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.setup_user     # define senha e 2FA (primeira vez)
.venv/bin/uvicorn app.main:app --reload
```

### Frontend (porta 5173, com proxy para /api)

```bash
cd frontend
npm install
npm run dev
```

Acesse http://localhost:5173 e faça login com a senha definida no setup.

## Produção (resumo — ver PLANO.md §2 e §5)

- VPS com Caddy (HTTPS automático) → `uvicorn app.main:app`
- `FINCONTROL_SECRET_KEY` obrigatória no ambiente (assina os JWT)
- `FINCONTROL_DATA` opcional (diretório do SQLite; padrão `backend/data/`)
- Frontend: `npm run build` → servir `frontend/dist/` pelo Caddy
- Backup diário do SQLite + `uploads/` para fora da VPS

## Estrutura

```
backend/app/
├── main.py            # app FastAPI, CORS, routers
├── db.py              # conexão SQLite (WAL) + runner de migrations
├── auth.py            # login (senha + TOTP) e JWT
├── setup_user.py      # cria/redefine usuário: python -m app.setup_user
├── util.py            # competência, vencimento, geração on-access
├── migrations/        # SQL versionado (001_inicial.sql, ...)
└── routers/           # categorias, contas_fixas, variaveis, entradas, metas, dashboard

frontend/src/
├── App.tsx            # rotas + layout (abas)
├── api.ts             # fetch com JWT, helpers de dinheiro (centavos ↔ BRL)
└── pages/             # Login, Dashboard, ContasFixas, Variaveis, Entradas, Metas
```

## Próximas fases

- **Fase 2:** anexos (upload de PDF/foto) — tabela `anexos` já existe no schema
- **Fase 3:** feed `.ics` (`webcal://`) + IA via OpenRouter
- **Fase 4:** push notifications; Tauri/Capacitor só se a PWA não bastar
