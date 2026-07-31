#!/usr/bin/env bash
# Deploy/atualização do FinControl em um comando.
# Uso (na VPS, como ROOT): cd /opt/fincontrol && ./deploy/deploy.sh
#
# Modelo de execução: root orquestra (systemctl, caddy); os passos que tocam o
# repositório (git/pip/npm) rodam como o usuário `fincontrol` via sudo -u, para
# o dono dos arquivos nunca variar entre execuções.
#
# Pressupõe o provisionamento inicial já feito (ver deploy/README.md):
# usuário fincontrol, /opt/fincontrol clonado via deploy key, backend/.env
# preenchido, serviço systemd `fincontrol` e o Caddy instalados.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

if [ "$(id -u)" -ne 0 ]; then
	echo "ERRO: rode como root (sudo). Os passos de repositório rodam como 'fincontrol' via sudo -u." >&2
	exit 1
fi

como_app() { sudo -u fincontrol -H "$@"; }

echo "==> Validando backend/.env (preflight)"
"$RAIZ/deploy/preflight.sh" check

echo "==> Atualizando código (git pull --ff-only)"
como_app git -C "$RAIZ" pull --ff-only

echo "==> Backend: venv + dependências"
cd "$RAIZ/backend"
[ -d .venv ] || como_app python3 -m venv .venv
como_app .venv/bin/pip install -q --upgrade pip
como_app .venv/bin/pip install -q -r requirements.txt

echo "==> Frontend: build de produção"
cd "$RAIZ/frontend"
# --include=dev: vite/tsc são devDependencies; com NODE_ENV=production no
# ambiente o npm ci as pularia e o build morreria com "vite: not found".
como_app npm ci --no-audit --no-fund --include=dev
como_app npm run build

echo "==> Backup do banco antes de migrar"
# As migrations rodam no startup do app; um snapshot antes do restart garante
# rollback se uma migration nova corromper dados.
"$RAIZ/deploy/backup.sh" || { echo "FALHA no backup — abortando antes de migrar." >&2; exit 1; }

echo "==> Reiniciando backend"
systemctl restart fincontrol

# Readiness: se a migration ou os segredos falharem, o backend não sobe —
# aborta com log em vez de declarar sucesso com o site fora do ar.
sleep 2
if ! systemctl is-active --quiet fincontrol; then
	echo "FALHA: o backend não subiu após o restart. Últimas linhas do log:" >&2
	journalctl -u fincontrol -n 30 --no-pager >&2 || true
	exit 1
fi

echo "==> Recarregando Caddy (config validada antes)"
if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
	systemctl reload caddy || systemctl restart caddy
else
	echo "FALHA: /etc/caddy/Caddyfile inválido — Caddy NÃO foi recarregado (site segue no ar com a config antiga)." >&2
	caddy validate --config /etc/caddy/Caddyfile >&2 || true
	exit 1
fi

echo "==> Healthcheck fim-a-fim"
sleep 1
if curl -fsS -m 10 http://127.0.0.1:8000/api/health >/dev/null; then
	echo "    backend OK (127.0.0.1:8000)"
else
	echo "FALHA: /api/health não responde no backend." >&2
	exit 1
fi

echo "==> Pronto."
systemctl --no-pager --lines=0 status fincontrol | head -4
