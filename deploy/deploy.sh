#!/usr/bin/env bash
# Deploy/atualização do FinControl em um comando.
# Uso (na VPS): cd /opt/fincontrol && ./deploy/deploy.sh
#
# Pressupõe o provisionamento inicial já feito (ver deploy/README.md):
# usuário fincontrol, /opt/fincontrol clonado, backend/.env preenchido,
# serviço systemd `fincontrol` e o Caddy instalados.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

echo "==> Atualizando código (git pull --ff-only)"
git pull --ff-only

echo "==> Backend: venv + dependências"
cd "$RAIZ/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "==> Frontend: build de produção"
cd "$RAIZ/frontend"
npm ci --no-audit --no-fund
npm run build

echo "==> Reiniciando backend e recarregando Caddy"
# As migrations rodam no startup do app (migrate() em app.main).
sudo systemctl restart fincontrol
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

echo "==> Pronto."
sudo systemctl --no-pager --lines=0 status fincontrol | head -4
