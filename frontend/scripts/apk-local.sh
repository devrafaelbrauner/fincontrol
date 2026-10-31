#!/usr/bin/env bash
# Gera e instala o APK do sabor `local`: o backend Python roda DENTRO do app (Chaquopy) e o
# WebView fala com ele em http://127.0.0.1:<porta sorteada a cada processo>.
#
# É o spike S0 do programa android-local (docs/runs/android-local/). Ainda não há tela do
# modo local: o app abre o front de sempre, e a prova de vida do backend sai no logcat
# (adb logcat -s FinControlLocal). Os irmãos:
#
#   apk-teste.sh   → sabor nuvem, debug: backend do Mac na rede local ("FinControl teste").
#   apk-release.sh → sabor nuvem, release: a VPS, o app de verdade ("FinControl").
#   este           → sabor local, pacote .local ("FinControl local"), instala AO LADO dos dois.
#
# Uso: bash scripts/apk-local.sh [release|debug]
#   release (padrão): só arm64-v8a, assinado com a chave de DEBUG (spike: nada vai ao usuário).
#   debug: pacote .local.teste, WebView inspecionável no chrome://inspect.
set -euo pipefail

cd "$(dirname "$0")/.."

TIPO="${1:-release}"
case "$TIPO" in
  release) TAREFA=assembleLocalRelease; PACOTE=com.rafaelbrauner.fincontrol.local ;;
  debug)   TAREFA=assembleLocalDebug;   PACOTE=com.rafaelbrauner.fincontrol.local.teste ;;
  *) echo "Uso: $0 [release|debug]" >&2; exit 2 ;;
esac
APK="android/app/build/outputs/apk/local/$TIPO/app-local-$TIPO.apk"

# --- Ambiente ---------------------------------------------------------------
# Mesma lógica dos irmãos: o openjdk@21 do Homebrew é keg-only, e `brew --prefix`
# imprime o caminho mesmo com a fórmula ausente — por isso o caminho é conferido.
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
# Não sobrescreve um local.properties que já funciona (mesma ressalva dos irmãos).
[ -f android/local.properties ] || echo "sdk.dir=$SDK" > android/local.properties

# O Chaquopy compila o Python do app e roda o pip com um Python da MESMA versão do app.
if ! command -v python3.13 >/dev/null; then
  echo "ERRO: python3.13 não está no PATH — o Chaquopy precisa dele no build." >&2
  echo "      Instale o Python 3.13 (python.org, ou brew install python@3.13)." >&2
  exit 1
fi

# As wheels Android do pydantic-core (saída do .github/workflows/wheels-android.yml) são
# conferidas antes de irem para dentro do APK.
(cd android/app/wheels && shasum -a 256 -c SHA256SUMS >/dev/null) || {
  echo "ERRO: as wheels de android/app/wheels não conferem com o SHA256SUMS." >&2; exit 1; }

# --- Build ------------------------------------------------------------------
# Sem FINCONTROL_ANDROID_TESTE_LOCAL, de propósito: o allowMixedContent fica false. O
# WebView alcança o 127.0.0.1 pela network_security_config do sabor, não por liberar
# mixed content. Sem VITE_API_BASE: o front ainda não conhece o modo local (S1).
echo "==> Web: build + cap sync android"
env -u FINCONTROL_ANDROID_TESTE_LOCAL -u FINCONTROL_BUILD_LOCAL -u VITE_API_BASE npm run android

echo "==> Compilando o APK do sabor local ($TIPO)"
(cd android && ./gradlew "$TAREFA" -q)
[ -f "$APK" ] || { echo "ERRO: $APK não saiu do build." >&2; exit 1; }

# --- Conferências -----------------------------------------------------------
MISTO="$(unzip -p "$APK" assets/capacitor.config.json | tr -d ' \t\n' | grep -o '"allowMixedContent":[a-z]*' || true)"
case "$MISTO" in
  *:false) echo "    ok: allowMixedContent=false" ;;
  *) echo "ERRO: o APK libera mixed content (${MISTO:-ausente}); refaça sem FINCONTROL_ANDROID_TESTE_LOCAL." >&2
     exit 1 ;;
esac
# A listagem vai para uma variável antes do grep -q: no cano, o grep sai no 1º casamento,
# o unzip morre de SIGPIPE e o pipefail daria "sem Python" num APK certo.
CONTEUDO="$(unzip -l "$APK")"
grep -q "lib/arm64-v8a/libpython3" <<<"$CONTEUDO" || {
  echo "ERRO: o APK saiu sem o Python embutido (lib/arm64-v8a/libpython3*.so)." >&2; exit 1; }
echo "    ok: Python 3 embutido (arm64-v8a), $(( $(stat -f %z "$APK") / 1048576 )) MB"

# --- Instalação -------------------------------------------------------------
# `install -r` instala por cima do próprio sabor local; o app nuvem (outro pacote) não é tocado.
ADB="$SDK/platform-tools/adb"
if [ -x "$ADB" ] && [ "$("$ADB" get-state 2>/dev/null || true)" = "device" ]; then
  "$ADB" install -r "$APK"
  "$ADB" shell am start -n "$PACOTE/com.rafaelbrauner.fincontrol.MainActivity" >/dev/null
  echo "==> Instalado e aberto ($PACOTE). Prova de vida: $ADB logcat -s FinControlLocal"
else
  echo "==> Nenhum aparelho (ou mais de um: defina ANDROID_SERIAL). Instale com:"
  echo "    adb install -r $APK"
fi
