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

> Guia completo de deploy (provisionamento + atualização em um comando) em **[deploy/README.md](deploy/README.md)**.
> Artefatos prontos em `deploy/`: `Caddyfile`, `fincontrol.service`, `.env.example`, `deploy.sh`.

- VPS com Caddy (HTTPS automático) → `uvicorn app.main:app`
- `FINCONTROL_SECRET_KEY` obrigatória no ambiente (assina os JWT)
- `FINCONTROL_FERNET_KEY` **obrigatória em produção** (criptografa a chave do OpenRouter; o app recusa subir sem ela — a derivação a partir do SECRET_KEY vale só em dev)
- `FINCONTROL_COOKIE_SECURE=1` em produção (marca o cookie de refresh como Secure — só HTTPS)
- `FINCONTROL_CORS_ORIGINS` opcional (origens extras separadas por vírgula; dispensável se o frontend é servido no mesmo host)
- `FINCONTROL_DATA` opcional (diretório do SQLite; padrão `backend/data/`)
- Frontend: `npm run build` → servir `frontend/dist/` pelo Caddy
- Backup diário do SQLite + `uploads/` para fora da VPS

**Auth:** access token JWT curto (30 min) via `Authorization: Bearer` + refresh token
em cookie httpOnly (30 dias, rota `/api/auth/refresh`, rotacionado a cada uso).
`POST /api/auth/logout` encerra a sessão **deste aparelho**; `?todos=1` invalida todos os refresh tokens (aparelho perdido). Login tem rate limit (5/min por IP).

A rotação do refresh token tem uma **janela de graça de 30s** (`auth.JANELA_GRACA_SEGUNDOS`): reapresentar um token recém-rotacionado devolve o sucessor já emitido, em vez de acusar vazamento. Fora dela, reuso continua revogando todas as sessões.

**Push (opcional, Fase 4):** gere as chaves com `.venv/bin/python -m app.gerar_vapid` e
exporte `FINCONTROL_VAPID_PUBLIC` / `FINCONTROL_VAPID_PRIVATE` / `FINCONTROL_VAPID_SUBJECT`
(mailto:). Sem elas, o push fica desabilitado e o calendário assinado segue como
lembrete principal. iOS exige a PWA instalada na tela inicial (≥ 16.4).

**Lembretes automáticos:** com as chaves VAPID presentes, o app sobe um agendador
interno (tarefa asyncio, sem cron) que roda no start e todo dia às 8h — hora local
configurável em `FINCONTROL_LEMBRETE_HORA`, e `FINCONTROL_AGENDADOR=0` desliga tudo.
O que ele notifica (`backend/app/lembretes.py`):

- contas fixas em aberto, com a antecedência de cada conta (`lembrete_dias_antes`),
  no dia do vencimento e uma vez quando passam a estar atrasadas — contas do mesmo
  dia viram uma notificação só, não uma por conta;
- no dia 1, o resumo do mês fechado com os insights de IA, que ficam guardados no
  mesmo cache que o Dashboard lê (sem chave de IA, ou se a chamada falhar, o resumo
  numérico vai do mesmo jeito).

Cada aviso é registrado em `lembretes_enviados` — é isso que impede repetição quando
o job roda mais de uma vez no dia (restart do backend, execução manual). Para conferir
sem esperar o horário: **Configurações** → "Ver lembretes de hoje" (prévia, não consome
o aviso) e "Enviar agora".

## Estrutura

```
backend/app/
├── main.py            # app FastAPI, CORS, routers
├── db.py              # conexão SQLite (WAL) + runner de migrations
├── auth.py            # login (senha + TOTP) e JWT
├── setup_user.py      # cria/redefine usuário: python -m app.setup_user
├── util.py            # competência, vencimento, geração on-access
├── lembretes.py       # job diário de push (vencimentos + resumo mensal)
├── migrations/        # SQL versionado (001_inicial.sql, ...)
├── routers/           # categorias, contas_fixas, variaveis, entradas, metas, dashboard
└── tests/             # pytest — rotação de sessão e anti-replay de TOTP

frontend/src/
├── App.tsx            # rotas + layout (abas)
├── api.ts             # fetch com JWT, helpers de dinheiro (centavos ↔ BRL)
└── pages/             # Login, Dashboard, ContasFixas, Variaveis, Entradas, Metas
```

## Testes

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q      # sessões/auth (rodam num banco temporário)

cd frontend && npm test                   # vitest
```

## Fases

- **Fases 0–3:** ✅ fundação, MVP, anexos, metas, calendário `.ics`, IA (OpenRouter).
- **Fase 4:** ✅ insights mensais de IA + push notifications (PWA instalada), com
  lembretes disparados sozinhos pelo agendador. Tauri/Capacitor ficam de fora
  enquanto a PWA bastar.
