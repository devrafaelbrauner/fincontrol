#!/usr/bin/env bash
# Backup do FinControl: SQLite (.backup consistente) + uploads, com verificação
# de integridade, retenção local e cópia offsite opcional via rclone.
#
# Uso:      ./deploy/backup.sh            # roda um backup agora
# Agendar:  ver deploy/fincontrol-backup.timer (diário via systemd)
#
# Config (via ambiente ou backend/.env):
#   FINCONTROL_DATA           diretório de dados (default: backend/data)
#   FINCONTROL_BACKUP_DIR     destino local (default: /var/backups/fincontrol)
#   FINCONTROL_BACKUP_REMOTE  remoto rclone opcional, ex. "b2:meu-bucket/fincontrol"
#   FINCONTROL_BACKUP_DIAS    retenção local em dias (default: 14)

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/backend/.env"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

DATA_DIR="${FINCONTROL_DATA:-$RAIZ/backend/data}"
BACKUP_DIR="${FINCONTROL_BACKUP_DIR:-/var/backups/fincontrol}"
REMOTE="${FINCONTROL_BACKUP_REMOTE:-}"
RETENCAO_DIAS="${FINCONTROL_BACKUP_DIAS:-14}"
DB="$DATA_DIR/fincontrol.db"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
DESTINO="$BACKUP_DIR/$CARIMBO"

command -v sqlite3 >/dev/null || { echo "ERRO: sqlite3 não instalado (apt install sqlite3)" >&2; exit 1; }
[ -f "$DB" ] || { echo "ERRO: banco não encontrado em $DB" >&2; exit 1; }

mkdir -p "$DESTINO"
chmod 700 "$BACKUP_DIR"

echo "==> Backup do banco (snapshot consistente via .backup)"
sqlite3 "$DB" ".backup '$DESTINO/fincontrol.db'"

echo "==> Verificando integridade do snapshot"
INTEGRIDADE="$(sqlite3 "$DESTINO/fincontrol.db" "PRAGMA integrity_check;")"
if [ "$INTEGRIDADE" != "ok" ]; then
	echo "ERRO: integrity_check falhou: $INTEGRIDADE" >&2
	exit 1
fi

if [ -d "$DATA_DIR/uploads" ]; then
	echo "==> Empacotando uploads"
	tar -czf "$DESTINO/uploads.tar.gz" -C "$DATA_DIR" uploads
fi

echo "==> Retenção local: removendo backups com mais de $RETENCAO_DIAS dias"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENCAO_DIAS" -exec rm -rf {} +

if [ -n "$REMOTE" ]; then
	command -v rclone >/dev/null || { echo "ERRO: FINCONTROL_BACKUP_REMOTE definido mas rclone não instalado" >&2; exit 1; }
	echo "==> Enviando para o offsite ($REMOTE)"
	rclone copy "$DESTINO" "$REMOTE/$CARIMBO" --transfers 4
else
	echo "AVISO: sem FINCONTROL_BACKUP_REMOTE — backup só local. Configure o rclone" \
	     "e defina a variável no backend/.env para ter cópia fora da VPS." >&2
fi

echo "==> Backup concluído em $DESTINO"
echo "    Restauração: pare o serviço, copie fincontrol.db para \$FINCONTROL_DATA,"
echo "    extraia uploads.tar.gz no mesmo diretório e suba o serviço. Teste 1x/trimestre."
