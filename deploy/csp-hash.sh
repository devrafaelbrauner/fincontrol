#!/usr/bin/env bash
# Hash CSP dos scripts inline do index.html.
#
# O Caddyfile libera o <script> inline do index.html (o que aplica o tema antes da
# primeira pintura) por sha256. Se o script mudar e o hash não, o navegador bloqueia
# em silêncio — o app funciona, mas pisca o tema errado a cada carregamento e enche
# o console de erro de CSP. Este script existe para isso nunca passar despercebido.
#
# Uso:
#   ./deploy/csp-hash.sh          # imprime o(s) hash(es) para colar no Caddyfile
#   ./deploy/csp-hash.sh check    # falha se o Caddyfile estiver defasado (usado no deploy)

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# CADDYFILE=/etc/caddy/Caddyfile ./deploy/csp-hash.sh check → confere o que está
# realmente servindo, não só a cópia versionada.
CADDYFILE="${CADDYFILE:-$RAIZ/deploy/Caddyfile}"

# Fonte, não dist: o Vite copia o script inline verbatim (os hashes batem), e um
# dist velho no diretório de trabalho daria alarme falso.
HTML="$RAIZ/frontend/index.html"
[ -f "$HTML" ] || { echo "ERRO: $HTML não encontrado" >&2; exit 1; }

hashes() {
	python3 - "$HTML" <<'PY'
import base64, hashlib, re, sys

html = open(sys.argv[1], encoding="utf-8").read()
# Só scripts inline (sem src=) entram no hash do CSP.
for corpo in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
    digest = hashlib.sha256(corpo.encode()).digest()
    print("sha256-" + base64.b64encode(digest).decode())
PY
}

ESPERADOS="$(hashes)"

if [ "${1:-}" = "check" ]; then
	faltando=0
	while IFS= read -r h; do
		[ -n "$h" ] || continue
		if ! grep -qF "'$h'" "$CADDYFILE"; then
			echo "ERRO: script inline do index.html não está liberado no CSP: '$h'" >&2
			faltando=1
		fi
	done <<<"$ESPERADOS"
	if [ "$faltando" -ne 0 ]; then
		echo "       Atualize o script-src em deploy/Caddyfile (rode: ./deploy/csp-hash.sh)." >&2
		exit 1
	fi
	echo "    CSP: hash do script inline confere com o Caddyfile"
	exit 0
fi

echo "Cole no script-src do deploy/Caddyfile (fonte: ${HTML#"$RAIZ"/}):"
while IFS= read -r h; do
	[ -n "$h" ] && echo "  '$h'"
done <<<"$ESPERADOS"
