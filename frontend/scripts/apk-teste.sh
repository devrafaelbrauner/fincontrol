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

# Varre as interfaces e descarta o que não serve. Pegar "a primeira que
# responde" é armadilha: com bridge Thunderbolt ou iPhone tetherado, en0 pode
# devolver um 169.254.x.x (link-local, autoatribuído porque o DHCP falhou) ou a
# sub-rede do tethering — endereços que o celular no Wi-Fi não alcança. O
# checar-api-base.mjs só recusa loopback, então isso passaria e congelaria no
# bundle, reproduzindo exatamente o "app só fica girando" que este script existe
# para evitar.
CANDIDATOS=()
for IFACE in $(networksetup -listallhardwareports 2>/dev/null | awk '/Device:/{print $2}'); do
  ADDR="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
  case "$ADDR" in
    ""|169.254.*) continue ;;   # sem IP, ou link-local (DHCP falhou)
  esac
  CANDIDATOS+=("$IFACE=$ADDR")
done

if [ ${#CANDIDATOS[@]} -eq 0 ]; then
  echo "ERRO: nenhuma interface com IP de rede utilizável." >&2
  echo "      Conecte-se ao Wi-Fi e rode de novo (169.254.x.x não serve: é DHCP falhado)." >&2
  exit 1
fi
if [ ${#CANDIDATOS[@]} -gt 1 ]; then
  echo "AVISO: mais de uma interface com IP — usando a primeira."
  printf '       %s\n' "${CANDIDATOS[@]}"
  echo "       Se o celular não conectar, é provável que seja a rede errada."
fi
IP="${CANDIDATOS[0]#*=}"

PORTA="${FINCONTROL_PORTA:-8000}"
BASE="http://$IP:$PORTA"

echo "==> Backend alvo: $BASE"
FINCONTROL_BUILD_LOCAL=1 FINCONTROL_ANDROID_TESTE_LOCAL=1 VITE_API_BASE="$BASE" npm run android

echo "==> Compilando o APK (variante debug, que libera tráfego em texto claro)"
# (3) `brew --prefix X` imprime o caminho e sai 0 MESMO com a fórmula não
# instalada, então o caminho precisa ser conferido — senão o gradle falha com
# "JAVA_HOME is not a valid JDK" em vez de "instale o openjdk@21".
if [ -z "${JAVA_HOME:-}" ] && command -v brew >/dev/null; then
  CANDIDATO="$(brew --prefix openjdk@21 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home"
  if [ -x "$CANDIDATO/bin/java" ]; then
    JAVA_HOME="$CANDIDATO"; export JAVA_HOME
  fi
fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
elif ! command -v java >/dev/null; then
  echo "ERRO: nenhum JDK encontrado. Instale com: brew install openjdk@21" >&2
  exit 1
fi

# (2) NÃO sobrescreve um local.properties que já funciona: o padrão daqui é o
# caminho do Homebrew, e numa máquina com o SDK do Android Studio
# (~/Library/Android/sdk) isso apontaria para um diretório inexistente — e o
# estrago sobreviveria ao script, quebrando o assembleRelease documentado.
if [ ! -f android/local.properties ]; then
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}}"
  if [ ! -d "$SDK/platforms" ]; then
    echo "ERRO: SDK do Android não encontrado em $SDK." >&2
    echo "      Defina ANDROID_HOME, ou crie frontend/android/local.properties com sdk.dir=<caminho>." >&2
    exit 1
  fi
  echo "sdk.dir=$SDK" > android/local.properties
  echo "==> local.properties criado apontando para $SDK"
fi

(cd android && ./gradlew assembleDebug -q)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
DESTINO="${1:-$HOME/Downloads/Android/fincontrol-teste-local.apk}"
mkdir -p "$(dirname "$DESTINO")"
cp "$APK" "$DESTINO"

CHAVE="$(openssl rand -hex 32)"

cat <<FIM

APK pronto: $DESTINO   (aponta para $BASE)

Antes de abrir no celular, suba o backend ACESSÍVEL NA REDE — o comando de
sempre usa 127.0.0.1 e o celular não enxerga:

  cd backend && FINCONTROL_SECRET_KEY=$CHAVE \\
    .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORTA

A chave acima foi sorteada agora. NÃO rode sem ela: em modo dev o SECRET_KEY
cai no default "dev-insecure-troque-em-producao", que é PÚBLICO no repositório
— com o backend em 0.0.0.0, qualquer um na sua rede forjaria um token válido e
leria (ou alteraria) seus dados. Encerre o backend quando terminar o teste.

O celular precisa estar na mesma rede Wi-Fi. Se o IP desta máquina mudar,
rode este script de novo: o APK antigo passa a apontar para o vazio.
FIM
