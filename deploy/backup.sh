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
#   FINCONTROL_BACKUP_PUBKEY  chave pública age (age1...) — se definida e `age`
#                             instalado, o snapshot é criptografado antes do
#                             offsite (recomendado: SQLite em claro vaza tudo).
#                             Gere com: age-keygen -o ~/.fincontrol-keys/backup.age

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/backend/.env"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

DATA_DIR="${FINCONTROL_DATA:-$RAIZ/backend/data}"
BACKUP_DIR="${FINCONTROL_BACKUP_DIR:-/var/backups/fincontrol}"
REMOTE="${FINCONTROL_BACKUP_REMOTE:-}"
RETENCAO_DIAS="${FINCONTROL_BACKUP_DIAS:-14}"
PUBKEY="${FINCONTROL_BACKUP_PUBKEY:-}"
DB="$DATA_DIR/fincontrol.db"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
DESTINO="$BACKUP_DIR/$CARIMBO"

command -v sqlite3 >/dev/null || { echo "ERRO: sqlite3 não instalado (apt install sqlite3)" >&2; exit 1; }
[ -f "$DB" ] || { echo "ERRO: banco não encontrado em $DB" >&2; exit 1; }

mkdir -p "$DESTINO"
chmod 700 "$BACKUP_DIR"
chmod 700 "$DESTINO"

echo "==> Backup do banco (snapshot consistente via .backup)"
sqlite3 "$DB" ".backup '$DESTINO/fincontrol.db'"
chmod 600 "$DESTINO/fincontrol.db"

echo "==> Verificando integridade do snapshot"
INTEGRIDADE="$(sqlite3 "$DESTINO/fincontrol.db" "PRAGMA integrity_check;")"
if [ "$INTEGRIDADE" != "ok" ]; then
	echo "ERRO: integrity_check falhou: $INTEGRIDADE" >&2
	exit 1
fi

if [ -d "$DATA_DIR/uploads" ]; then
	echo "==> Empacotando uploads"
	tar -czf "$DESTINO/uploads.tar.gz" -C "$DATA_DIR" uploads
	chmod 600 "$DESTINO/uploads.tar.gz"
fi

# Criptografia opcional (age): sem ela o backup é SQLite em claro — quem ler o
# arquivo lê finanças, TOTP seed e token .ics. Com PUBKEY, gera .age ao lado e
# envia SÓ o cifrado ao offsite (o claro fica só no disco local).
if [ -n "$PUBKEY" ]; then
	command -v age >/dev/null || { echo "ERRO: FINCONTROL_BACKUP_PUBKEY definido mas age não instalado (apt install age)" >&2; exit 1; }
	echo "==> Criptografando snapshot com age"
	age -r "$PUBKEY" -o "$DESTINO/fincontrol.db.age" "$DESTINO/fincontrol.db"
	chmod 600 "$DESTINO/fincontrol.db.age"
	if [ -f "$DESTINO/uploads.tar.gz" ]; then
		age -r "$PUBKEY" -o "$DESTINO/uploads.tar.gz.age" "$DESTINO/uploads.tar.gz"
		chmod 600 "$DESTINO/uploads.tar.gz.age"
	fi
fi

echo "==> Retenção local: removendo backups com mais de $RETENCAO_DIAS dias"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENCAO_DIAS" -exec rm -rf {} +

if [ -n "$REMOTE" ]; then
	command -v rclone >/dev/null || { echo "ERRO: FINCONTROL_BACKUP_REMOTE definido mas rclone não instalado" >&2; exit 1; }
	if [ -n "$PUBKEY" ]; then
		echo "==> Enviando para o offsite ($REMOTE) — SOMENTE cifrado (.age)"
		echo "    (use remote com crypt: para segunda camada — ver deploy/README)"
		rclone copy "$DESTINO/fincontrol.db.age" "$REMOTE/$CARIMBO" --transfers 4
		if [ -f "$DESTINO/uploads.tar.gz.age" ]; then
			rclone copy "$DESTINO/uploads.tar.gz.age" "$REMOTE/$CARIMBO" --transfers 4
		fi
	else
		echo "AVISO: enviando backup EM CLARO ao offsite. Defina FINCONTROL_BACKUP_PUBKEY" \
		     "para criptografar com age antes do envio." >&2
		echo "==> Enviando para o offsite ($REMOTE)"
		rclone copy "$DESTINO" "$REMOTE/$CARIMBO" --transfers 4 --exclude "*.age"
	fi
else
	echo "AVISO: sem FINCONTROL_BACKUP_REMOTE — backup só local. Configure o rclone" \
	     "e defina a variável no backend/.env para ter cópia fora da VPS." >&2
fi

echo "==> Backup concluído em $DESTINO"
echo "    Restauração: pare o serviço, copie fincontrol.db para \$FINCONTROL_DATA,"
echo "    extraia uploads.tar.gz no mesmo diretório e suba o serviço. Teste 1x/trimestre."
