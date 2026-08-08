#!/usr/bin/env bash
# Gera o APK de release: assinado, apontado para a VPS, instalável por sideload.
#
# É o irmão do apk-teste.sh, e a diferença entre os dois é o que separa "dá para
# testar" de "dá para usar":
#
#   apk-teste.sh  → variante debug, aponta para o IP do Mac na rede local, exige
#                   o backend rodando aqui, libera tráfego em texto claro, e se
#                   instala como um app à parte ("FinControl teste").
#   este          → variante release, aponta para a VPS em HTTPS, funciona de
#                   qualquer rede, recusa texto claro, e é o app de verdade.
#
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${FINCONTROL_API_BASE:-https://financespace.duckdns.org}"
CHAVES="${FINCONTROL_KEYS_DIR:-$HOME/.fincontrol-keys}"
PROPS="${FINCONTROL_KEYSTORE_PROPERTIES:-$CHAVES/keystore.properties}"
JKS="$CHAVES/fincontrol-release.jks"

# --- Ambiente ---------------------------------------------------------------
# Mesma lógica do apk-teste.sh, e pelo mesmo motivo: o openjdk@21 do Homebrew é
# keg-only, então `java` não está no PATH e `brew --prefix` imprime o caminho
# MESMO com a fórmula ausente — o caminho precisa ser conferido, senão o gradle
# falha com "JAVA_HOME is not a valid JDK" em vez de "instale o openjdk@21".
if [ -z "${JAVA_HOME:-}" ]; then
  CANDIDATO="$(brew --prefix openjdk@21 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home"
  [ -x "$CANDIDATO/bin/java" ] && export JAVA_HOME="$CANDIDATO"
fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
elif ! command -v java >/dev/null; then
  echo "ERRO: nenhum JDK encontrado. Instale com: brew install openjdk@21" >&2
  exit 1
fi

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -f android/local.properties ]; then
  SDK="$(awk -F= '/^sdk.dir=/{print $2}' android/local.properties)"
fi
SDK="${SDK:-/opt/homebrew/share/android-commandlinetools}"
if [ ! -d "$SDK/platforms" ]; then
  echo "ERRO: SDK do Android não encontrado em $SDK." >&2
  echo "      Defina ANDROID_HOME, ou crie frontend/android/local.properties com sdk.dir=<caminho>." >&2
  exit 1
fi
# Não sobrescreve um local.properties que já funciona (mesma ressalva do apk-teste.sh).
[ -f android/local.properties ] || echo "sdk.dir=$SDK" > android/local.properties

# O glob direto expandiria para TODAS as versões de build-tools instaladas, e a
# segunda viraria subcomando do apksigner ("Unsupported command"). Já aconteceu
# num projeto vizinho, e com `|| true` no fim o build passava verde sem conferir
# assinatura nenhuma — que é o pior desfecho possível para um passo cuja única
# função é conferir.
APKSIGNER="$(ls -d "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
AAPT2="$(ls -d "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"
[ -x "$APKSIGNER" ] || { echo "ERRO: apksigner não encontrado em $SDK/build-tools." >&2; exit 1; }

# --- Keystore ---------------------------------------------------------------
# Criada na primeira execução e reutilizada para sempre. "Para sempre" é literal:
# o Android identifica o app pela assinatura, então trocar de chave quebra a
# atualização por cima (INSTALL_FAILED_UPDATE_INCOMPATIBLE) e obriga a
# desinstalar. Aqui isso custa refazer o login e nada mais — o FinControl não
# guarda dado financeiro no aparelho —, mas é chato o bastante para não valer.
if [ ! -f "$PROPS" ]; then
  if [ -e "$JKS" ]; then
    echo "ERRO: existe uma keystore em $JKS, mas não o $PROPS que a descreve." >&2
    echo "      Não vou gerar outra por cima — isso descartaria a chave que já assinou APKs." >&2
    exit 1
  fi
  echo "==> Primeira execução: gerando a keystore de release em $CHAVES"
  mkdir -p "$CHAVES" && chmod 700 "$CHAVES"
  SENHA="$(openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-32)"
  printf '%s\n' "$SENHA" > "$CHAVES/keystore-password.txt"
  chmod 600 "$CHAVES/keystore-password.txt"
  # Validade de 30 anos: um certificado que expira invalida as atualizações no
  # meio do caminho, e renová-lo exige a chave original de qualquer jeito.
  keytool -genkeypair -keystore "$JKS" -storetype PKCS12 \
    -alias release -keyalg RSA -keysize 4096 -validity 10950 \
    -storepass "$SENHA" -keypass "$SENHA" \
    -dname "CN=FinControl, O=Rafael Brauner, C=BR" >/dev/null
  chmod 600 "$JKS"
  cat > "$PROPS" <<FIM
# Lido por frontend/android/app/build.gradle. Vive aqui, fora do repositório, de
# propósito: um arquivo com senha dentro do projeto acaba commitado.
storeFile=$JKS
storePassword=$SENHA
keyAlias=release
keyPassword=$SENHA
FIM
  chmod 600 "$PROPS"
  echo "    Faça backup de $CHAVES — não existe cópia em lugar nenhum."
fi

# --- Versão -----------------------------------------------------------------
# O Android decide o que é atualização comparando o versionCode; repetir o número
# faz a instalação por cima ser recusada. Incrementa ANTES do build porque o
# valor entra no APK — se o build falhar, o número queimado só deixa um buraco na
# sequência, o que é inofensivo.
ARQ_VER="android/gradle.properties"
ATUAL="$(awk -F= '/^fincontrolVersionCode=/{print $2}' "$ARQ_VER")"
[ -n "$ATUAL" ] || { echo "ERRO: fincontrolVersionCode ausente em $ARQ_VER." >&2; exit 1; }
NOVO=$((ATUAL + 1))
# sed -i '' é a forma do BSD/macOS; o -i sem sufixo é GNU e falharia aqui.
sed -i '' "s/^fincontrolVersionCode=.*/fincontrolVersionCode=$NOVO/" "$ARQ_VER"
NOME_VER="$(node -p "require('./package.json').version")"
echo "==> Versão $NOME_VER (versionCode $ATUAL → $NOVO)"

# --- Build ------------------------------------------------------------------
# Sem FINCONTROL_BUILD_LOCAL e sem FINCONTROL_ANDROID_TESTE_LOCAL: é a ausência
# das duas que faz o release sair seguro por construção. A primeira mantém o
# checar-api-base.mjs exigindo https://; a segunda deixa o allowMixedContent em
# false. O usesCleartextTraffic="false" do manifesto principal já vale sozinho,
# porque o "true" mora só em src/debug/AndroidManifest.xml.
echo "==> Backend alvo: $BASE"
VITE_API_BASE="$BASE" npm run android

echo "==> Compilando o APK de release"
(cd android && ./gradlew assembleRelease -q)

APK="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "ERRO: $APK não saiu do build." >&2; exit 1; }

# --- Conferências -----------------------------------------------------------
# As duas coisas que separam este APK do de teste, verificadas no arquivo pronto
# em vez de assumidas a partir da configuração.
echo "==> Conferindo a assinatura"
"$APKSIGNER" verify --print-certs "$APK" | grep -E "Signer #1 certificate SHA-256|DN:" || {
  echo "ERRO: APK sem assinatura válida." >&2; exit 1; }

if [ -x "$AAPT2" ]; then
  echo "==> Conferindo que o APK recusa tráfego em texto claro"
  # Sem `exit` no awk, de propósito: com ele o awk fecha o cano no primeiro
  # casamento, o aapt2 morre de SIGPIPE (141) e o `pipefail` derruba o script
  # inteiro — sem imprimir nada, porque SIGPIPE não é erro que se explique
  # sozinho. Guardar o último casamento no END custa ler a saída toda (alguns
  # KB) e não tem essa armadilha.
  CLEAR="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" 2>/dev/null \
           | awk '/usesCleartextTraffic/{v=$0} END{print v}')"
  case "$CLEAR" in
    *0xffffffff*|*"=true"*|*"(type 0x12)0xffffffff"*)
      echo "ERRO: este APK aceita HTTP em texto claro — não distribua." >&2; exit 1 ;;
    "") echo "    (atributo ausente: o padrão do targetSdk 36 já é recusar)" ;;
    *)  echo "    ok: usesCleartextTraffic=false" ;;
  esac
fi

DESTINO="${1:-$HOME/Downloads/Android/fincontrol.apk}"
mkdir -p "$(dirname "$DESTINO")"
cp "$APK" "$DESTINO"

SHA="$("$APKSIGNER" verify --print-certs "$APK" | awk '/SHA-256 digest:/{v=$NF} END{print v}')"

cat <<FIM

APK pronto: $DESTINO
  versão      $NOME_VER (versionCode $NOVO)
  backend     $BASE
  certificado SHA-256 $SHA

Instale com o celular conectado por USB (depuração USB ligada):

  adb install -r "$DESTINO"

O -r instala POR CIMA, preservando o app. Não use "adb uninstall" antes: a
reinstalação limpa derruba a sessão e obriga a logar de novo.

O certificado acima é a identidade do app para o Android. Ele tem que ser o
mesmo em todo build futuro — se mudar, a atualização por cima passa a ser
recusada. A chave está em $CHAVES e não tem cópia em lugar nenhum: faça backup.

O $ARQ_VER foi alterado (versionCode $NOVO). Commite junto, senão o próximo
build repete o número.

A URL do backend fica CONGELADA neste APK. Um deploy na VPS atualiza o web e o
macOS, e não atualiza o celular — trocar de domínio pede rodar isto de novo.
FIM
