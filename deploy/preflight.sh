#!/usr/bin/env bash
# Pré-deploy do FinControl: gera segredos e valida o backend/.env antes de subir.
#
# Uso:
#   ./deploy/preflight.sh gen      # imprime SECRET_KEY e FERNET_KEY novos para colar no .env
#   ./deploy/preflight.sh check    # valida o backend/.env (produção)
#   ./deploy/preflight.sh          # roda gen e check
#
# Não escreve no .env nem imprime segredos existentes — só gera novos e audita.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/backend/.env"

gerar() {
	echo "==> Segredos novos (cole no $ENV_FILE):"
	echo
	echo "FINCONTROL_SECRET_KEY=$(openssl rand -hex 32)"
	# Chave Fernet = 32 bytes em base64 url-safe.
	echo "FINCONTROL_FERNET_KEY=$(openssl rand -base64 32 | tr '+/' '-_')"
	echo
	echo "   (SECRET_KEY assina os JWT; FERNET_KEY cifra a chave do OpenRouter.)"
	echo "   Guarde-os: trocar a FERNET_KEY torna a chave do OpenRouter salva ilegível."
}

validar() {
	echo "==> Validando $ENV_FILE"
	if [ ! -f "$ENV_FILE" ]; then
		echo "   ERRO: $ENV_FILE não existe. Copie de deploy/.env.example e preencha." >&2
		exit 1
	fi

	# Lê valores sem exportar/imprimir.
	get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

	local env secret fernet secure erros=0
	env="$(get FINCONTROL_ENV)"
	secret="$(get FINCONTROL_SECRET_KEY)"
	fernet="$(get FINCONTROL_FERNET_KEY)"
	secure="$(get FINCONTROL_COOKIE_SECURE)"

	if [ "$env" != "production" ]; then
		echo "   FALTA: FINCONTROL_ENV=production (achado: '${env:-vazio}')" >&2; erros=$((erros+1))
	fi
	if [ -z "$secret" ] || [ "$secret" = "troque-por-uma-chave-aleatoria-longa" ] || [ "${#secret}" -lt 32 ]; then
		echo "   FALTA: FINCONTROL_SECRET_KEY ausente, curta (<32) ou default. Rode: $0 gen" >&2; erros=$((erros+1))
	fi
	if [ -z "$fernet" ]; then
		echo "   FALTA: FINCONTROL_FERNET_KEY (obrigatória em produção). Rode: $0 gen" >&2; erros=$((erros+1))
	fi
	if [ "$secure" != "1" ]; then
		echo "   AVISO: FINCONTROL_COOKIE_SECURE não é 1 (será forçado como Secure em produção)." >&2
	fi

	if [ "$erros" -gt 0 ]; then
		echo "==> $erros problema(s) — corrija antes do deploy." >&2
		exit 1
	fi
	echo "   OK: .env pronto para produção."
}

case "${1:-tudo}" in
	gen) gerar ;;
	check) validar ;;
	tudo) gerar; echo; validar ;;
	*) echo "Uso: $0 [gen|check]" >&2; exit 2 ;;
esac
