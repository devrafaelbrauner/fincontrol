# Deploy — FinControl (VPS + Caddy)

Arquitetura: **Caddy** (HTTPS automático) → **uvicorn** (systemd) → SQLite/uploads em disco.
Frontend é buildado para `frontend/dist/` e servido pelo Caddy (mesmo host → sem CORS).

## Pré-requisitos

- VPS com Debian/Ubuntu, Python 3.11+, Node 20+, `git`, e **Caddy** instalado
  (https://caddyserver.com/docs/install).
- Um subdomínio (ex. `fincontrol.seudominio.com`) com **registro A** apontando para o IP da VPS.

## Provisionamento inicial (uma vez)

```bash
# 1. Usuário e diretório do serviço
sudo useradd --system --create-home --home-dir /opt/fincontrol fincontrol
sudo -u fincontrol git clone https://github.com/rafaelbrauner22-bit/fincontrol.git /opt/fincontrol

# 2. Ambiente do backend
cd /opt/fincontrol/backend
sudo -u fincontrol cp ../deploy/.env.example .env
sudo -u fincontrol nano .env          # preencha SECRET_KEY, FERNET_KEY, COOKIE_SECURE=1, ...
sudo -u fincontrol python3 -m venv .venv
sudo -u fincontrol .venv/bin/pip install -r requirements.txt

# 3. Defina a senha (e 2FA) do usuário único
sudo -u fincontrol .venv/bin/python -m app.setup_user

# 4. Serviço systemd
sudo cp /opt/fincontrol/deploy/fincontrol.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fincontrol

# 5. Caddy — domínio e caminho do build via ambiente do serviço
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/fincontrol.conf >/dev/null <<'EOF'
[Service]
Environment=FINCONTROL_DOMAIN=fincontrol.seudominio.com
Environment=FINCONTROL_FRONTEND_DIST=/opt/fincontrol/frontend/dist
EOF
sudo cp /opt/fincontrol/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl restart caddy

# 6. Primeiro build do frontend
cd /opt/fincontrol/frontend && sudo -u fincontrol npm ci && sudo -u fincontrol npm run build
```

Acesse `https://fincontrol.seudominio.com` — o Caddy emite o certificado automaticamente.

## Atualizações (um comando)

```bash
cd /opt/fincontrol && ./deploy/deploy.sh
```

Faz `git pull`, atualiza dependências, buildar o frontend e reinicia o backend
(as migrations rodam no startup). O usuário do deploy precisa de `sudo` para
`systemctl restart fincontrol` e `reload caddy`.

## Backup (recomendado)

Copie para fora da VPS, diariamente:

```bash
sqlite3 /opt/fincontrol/backend/data/fincontrol.db ".backup /tmp/fincontrol.db"
# + o diretório /opt/fincontrol/backend/data/uploads/
# Enviar via rclone para Backblaze B2 / outro offsite. Testar restauração 1x/trimestre.
```

## Notas

- **Push (opcional):** gere as chaves VAPID com `.venv/bin/python -m app.gerar_vapid`
  e adicione ao `.env` (`FINCONTROL_VAPID_*`). Sem elas, o push fica desabilitado e o
  calendário assinado segue como lembrete principal.
- **Feed `.ics`:** é público por design (token secreto na URL) — o Caddy encaminha
  `/calendar/*` ao backend. Trate a URL como senha; regenere pelo app se vazar.
- **Cookie de refresh:** exige HTTPS (`FINCONTROL_COOKIE_SECURE=1`) — por isso o Caddy
  na frente é obrigatório em produção.
