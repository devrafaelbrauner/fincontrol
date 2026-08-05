#!/usr/bin/env bash
# Gera o APK de teste apontado para o backend DESTA máquina, na rede local.
#
# Existe porque a montagem à mão tinha duas armadilhas silenciosas, e as duas
# custaram um APK que não funcionava:
#
#   1. O IP da LAN era digitado no comando de build e ficava congelado no
#      bundle. Trocar de rede (ou o DHCP renovar) invalidava o APK sem nada
#      avisar: o app só ficava girando. Aqui o IP é descoberto na hora.
#   2. O backend documentado sobe com `--host 127.0.0.1`, que aceita conexão só
#      da própria máquina. Com o IP certo no APK, o celular ainda assim não
#      alcançava. O comando impresso no fim usa 0.0.0.0.
#
set -euo pipefail

cd "$(dirname "$0")/.."

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then
  echo "ERRO: não achei o IP desta máquina na rede local (en0/en1)." >&2
  echo "      Conecte-se ao Wi-Fi e rode de novo." >&2
  exit 1
fi

PORTA="${FINCONTROL_PORTA:-8000}"
BASE="http://$IP:$PORTA"

echo "==> Backend alvo: $BASE"
FINCONTROL_BUILD_LOCAL=1 FINCONTROL_ANDROID_TESTE_LOCAL=1 VITE_API_BASE="$BASE" npm run android

echo "==> Compilando o APK (variante debug, que libera tráfego em texto claro)"
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
export ANDROID_HOME
if [ -z "${JAVA_HOME:-}" ] && command -v brew >/dev/null; then
  JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
  export JAVA_HOME
fi
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

(cd android && ./gradlew assembleDebug -q)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
DESTINO="${1:-$HOME/Downloads/Android/fincontrol-teste-local.apk}"
mkdir -p "$(dirname "$DESTINO")"
cp "$APK" "$DESTINO"

cat <<FIM

APK pronto: $DESTINO   (aponta para $BASE)

Antes de abrir no celular, suba o backend ACESSÍVEL NA REDE — o comando de
sempre usa 127.0.0.1 e o celular não enxerga:

  cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORTA

O celular precisa estar na mesma rede Wi-Fi. Se o IP desta máquina mudar,
rode este script de novo: o APK antigo passa a apontar para o vazio.
FIM
