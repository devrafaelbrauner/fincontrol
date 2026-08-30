#!/usr/bin/env bash
# Sobe a versão do FinControl e propaga para os espelhos.
#
#   ./scripts/versao.sh                 mostra a versão atual e o estado dos espelhos
#   ./scripts/versao.sh sincronizar     reescreve os espelhos a partir do VERSION
#   ./scripts/versao.sh patch|minor|major   sobe o dígito e sincroniza
#   ./scripts/versao.sh 2.1.0           define um número exato e sincroniza
#
# O script NÃO commita, NÃO marca tag e NÃO empurra nada: quem faz isso é o
# processo descrito no README, depois de você editar o CHANGELOG. A tag tem de
# apontar para um commit que já contenha a versão nova, então marcá-la aqui seria
# marcar cedo demais.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARQ_VERSION="$RAIZ/VERSION"
PACKAGE_JSON="$RAIZ/frontend/package.json"
PBXPROJ="$RAIZ/frontend/ios/App/App.xcodeproj/project.pbxproj"

erro() { printf '\033[31merro:\033[0m %s\n' "$1" >&2; exit 1; }

[[ -f "$ARQ_VERSION" ]] || erro "não achei $ARQ_VERSION"
ATUAL="$(tr -d '[:space:]' < "$ARQ_VERSION")"
[[ "$ATUAL" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || erro "VERSION tem '$ATUAL', que não é MAJOR.MINOR.PATCH"

IFS=. read -r MAJOR MINOR PATCH <<< "$ATUAL"

case "${1-}" in
  "")           NOVA="$ATUAL"; SO_CONFERIR=1 ;;
  sincronizar)  NOVA="$ATUAL" ;;
  major)        NOVA="$((MAJOR + 1)).0.0" ;;
  minor)        NOVA="$MAJOR.$((MINOR + 1)).0" ;;
  patch)        NOVA="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  *)
    [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || erro "não entendi '$1' (use patch, minor, major, sincronizar ou um número como 2.1.0)"
    NOVA="$1"
    ;;
esac

# `sed -i` difere entre BSD (macOS) e GNU; o Python já é dependência do backend,
# e aqui evita tanto essa diferença quanto ter de escapar ponto em regex.
escrever() {
  VERSAO_NOVA="$NOVA" python3 - "$PACKAGE_JSON" "$PBXPROJ" <<'PY'
import json, os, re, sys
nova = os.environ["VERSAO_NOVA"]
pkg_path, pbx_path = sys.argv[1], sys.argv[2]

# O package.json é reescrito preservando a formatação: um json.dump reindentaria
# o arquivo inteiro e encheria o diff de ruído que não é a versão.
with open(pkg_path, encoding="utf-8") as f:
    bruto = f.read()
atual = json.loads(bruto)["version"]
if atual != nova:
    novo, n = re.subn(r'("version"\s*:\s*)"[^"]*"', lambda m: m.group(1) + f'"{nova}"', bruto, count=1)
    if n != 1:
        sys.exit("não consegui achar a chave version no package.json")
    with open(pkg_path, "w", encoding="utf-8") as f:
        f.write(novo)
    print(f"  package.json      {atual} -> {nova}")
else:
    print(f"  package.json      {nova}")

if os.path.exists(pbx_path):
    with open(pbx_path, encoding="utf-8") as f:
        bruto = f.read()
    antes = set(re.findall(r"MARKETING_VERSION = ([^;]+);", bruto))
    if antes != {nova}:
        novo, n = re.subn(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {nova};", bruto)
        if n == 0:
            sys.exit("não achei MARKETING_VERSION no project.pbxproj")
        with open(pbx_path, "w", encoding="utf-8") as f:
            f.write(novo)
        print(f"  Xcode             {', '.join(sorted(antes))} -> {nova} ({n} configurações)")
    else:
        print(f"  Xcode             {nova}")
else:
    print("  Xcode             (ausente, ignorado)")
PY
}

# Sem argumento o script não escreve nada: só relata. Um comando de diagnóstico
# que altera arquivos é uma armadilha — você o roda para entender o estado e ele
# muda o estado que você queria entender.
if [[ "${SO_CONFERIR-0}" == 1 ]]; then
  printf 'versão atual: \033[1m%s\033[0m\n\n' "$ATUAL"
  # `|| status=$?` porque sob `set -e` o exit 1 do Python derrubaria o script
  # antes de chegar no teste logo abaixo.
  status=0
  VERSAO_ESPERADA="$ATUAL" python3 - "$PACKAGE_JSON" "$PBXPROJ" <<'PY' || status=$?
import json, os, re, sys
esperada = os.environ["VERSAO_ESPERADA"]
pkg_path, pbx_path = sys.argv[1], sys.argv[2]
VERDE, AMARELO, FIM = "\033[32m", "\033[33m", "\033[0m"
divergiu = False

with open(pkg_path, encoding="utf-8") as f:
    achado = json.load(f)["version"]
ok = achado == esperada
divergiu |= not ok
print(f"  package.json   {VERDE if ok else AMARELO}{achado}{FIM}")

if os.path.exists(pbx_path):
    with open(pbx_path, encoding="utf-8") as f:
        achados = sorted(set(re.findall(r"MARKETING_VERSION = ([^;]+);", f.read())))
    ok = achados == [esperada]
    divergiu |= not ok
    print(f"  Xcode          {VERDE if ok else AMARELO}{', '.join(achados) or '(nenhum)'}{FIM}")
else:
    print("  Xcode          (ausente)")

sys.exit(1 if divergiu else 0)
PY
  if [[ $status -ne 0 ]]; then
    printf '\n\033[33mespelhos divergem do VERSION.\033[0m corrija com:  ./scripts/versao.sh sincronizar\n'
    exit 1
  fi
  printf '\n\033[32mtudo sincronizado.\033[0m para subir:  ./scripts/versao.sh patch|minor|major\n'
  exit 0
fi

printf '%s -> \033[1m%s\033[0m\n' "$ATUAL" "$NOVA"
printf '%s\n' "$NOVA" > "$ARQ_VERSION"
escrever

cat <<FIM

Falta, e o script não faz por você:
  1. descrever a versão no CHANGELOG.md (o teste exige a seção '## [$NOVA]')
  2. subir o fincontrolVersionCode em frontend/android/gradle.properties, se for
     distribuir APK — é um inteiro à parte, e repetir o número faz o Android
     recusar a instalação por cima
  3. rodar os testes:  cd backend && python -m pytest tests/test_versao.py
  4. commitar, marcar e empurrar:
       git commit -am "Versão $NOVA"
       git tag -a "v$NOVA" -m "Versão $NOVA"
       git push && git push origin "v$NOVA"
FIM
