"""O guarda do versionamento: garante que as cópias da versão não divirjam.

O arquivo `VERSION` na raiz é a fonte. Mas três lugares não conseguem lê-lo em
tempo de execução — o `package.json` (que o Gradle abre para montar o
`versionName` do APK), o `project.pbxproj` do Xcode e o `CHANGELOG.md` — então
são espelhos, e espelho sem conferência diverge.

Não é hipótese: quando estes testes foram escritos, o repositório tinha `0.1.0`
no `package.json`, `0.1.0` no `FastAPI(version=...)` e `1.0` no Xcode, sem que
nada acusasse. É o tipo de erro que só aparece na loja, meses depois, na tela
"sobre" de um aparelho.

Estes testes rodam sem rede e sem build, então valem em qualquer máquina e no CI.
"""

import json
import re
from pathlib import Path

import pytest

from app.main import app
from app.versao import FALLBACK, VERSAO, ler_versao

RAIZ_REPO = Path(__file__).resolve().parents[2]

ARQUIVO_VERSION = RAIZ_REPO / "VERSION"
PACKAGE_JSON = RAIZ_REPO / "frontend" / "package.json"
PBXPROJ = RAIZ_REPO / "frontend" / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
CARGO_TOML = RAIZ_REPO / "frontend" / "src-tauri" / "Cargo.toml"
CHANGELOG = RAIZ_REPO / "CHANGELOG.md"

# MAJOR.MINOR.PATCH, sem sufixo. O projeto não usa pré-lançamento nem metadado de
# build: o Android exige que o `versionName` seja legível para quem instala, e o
# `versionCode` (inteiro, à parte) é quem decide o que é atualização.
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def test_version_existe_e_e_semver():
    assert ARQUIVO_VERSION.is_file(), "o arquivo VERSION sumiu da raiz"
    assert SEMVER.match(VERSAO), f"VERSION deveria ser MAJOR.MINOR.PATCH, é {VERSAO!r}"


def test_fallback_nao_e_um_numero_plausivel():
    """O fallback tem de saltar aos olhos, não passar por versão de verdade."""
    assert not SEMVER.match(FALLBACK)
    assert VERSAO != FALLBACK, "o VERSION não foi lido — conferir o caminho em versao.py"


def test_package_json_espelha_o_version():
    """Esta é a que vira `versionName` no APK, via build.gradle."""
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    assert pkg["version"] == VERSAO, (
        f"frontend/package.json diz {pkg['version']!r} e VERSION diz {VERSAO!r} — "
        "rodar ./scripts/versao.sh sincronizar"
    )


def test_xcode_espelha_o_version():
    """`MARKETING_VERSION` é o CFBundleShortVersionString, o número que a App Store mostra."""
    if not PBXPROJ.is_file():  # pragma: no cover - o alvo iOS pode não estar no checkout
        pytest.skip("projeto Xcode ausente")
    achados = set(re.findall(r"MARKETING_VERSION = ([^;]+);", PBXPROJ.read_text(encoding="utf-8")))
    assert achados, "MARKETING_VERSION não encontrado no project.pbxproj"
    assert achados == {VERSAO}, (
        f"MARKETING_VERSION={achados} diverge de VERSION={VERSAO!r} — "
        "rodar ./scripts/versao.sh sincronizar"
    )
    # Debug e Release são duas configurações: se só uma foi trocada, o app de
    # release sai com a versão errada e o de debug parece certo na máquina.
    assert len(re.findall(r"MARKETING_VERSION = ", PBXPROJ.read_text(encoding="utf-8"))) >= 2


def test_tauri_espelha_o_version():
    """O bundle .app/.dmg carrega a versão do Cargo.toml, não do package.json."""
    if not CARGO_TOML.is_file():  # pragma: no cover - checkout sem o alvo Tauri
        pytest.skip("Cargo.toml do Tauri ausente")
    m = re.search(r'^version = "([^"]*)"', CARGO_TOML.read_text(encoding="utf-8"), flags=re.M)
    assert m, "version não encontrado no Cargo.toml do Tauri"
    assert m.group(1) == VERSAO, (
        f"src-tauri/Cargo.toml diz {m.group(1)!r} e VERSION diz {VERSAO!r} — "
        "rodar ./scripts/versao.sh sincronizar"
    )


def test_api_reporta_a_versao():
    assert app.version == VERSAO


def test_changelog_tem_a_versao_atual():
    """Uma versão sem entrada no CHANGELOG é uma versão que ninguém sabe o que mudou."""
    assert CHANGELOG.is_file(), "CHANGELOG.md sumiu da raiz"
    texto = CHANGELOG.read_text(encoding="utf-8")
    assert re.search(rf"^## \[{re.escape(VERSAO)}\]", texto, re.M), (
        f"CHANGELOG.md não tem seção '## [{VERSAO}]' — descrever a versão antes de marcá-la"
    )


def test_ler_versao_cai_no_fallback_sem_o_arquivo(monkeypatch, tmp_path):
    """Some com o arquivo: a API tem de continuar de pé, reportando o fallback."""
    from app import versao as mod

    monkeypatch.setattr(mod, "_ARQUIVO", tmp_path / "nao-existe")
    assert mod.ler_versao() == FALLBACK


def test_versao_exige_login(cliente):
    """O número fica atrás do login; o /health público continua só com `ok`."""
    assert cliente.get("/api/versao").status_code == 401
    assert cliente.get("/api/health").json() == {"ok": True}


def test_versao_logado_devolve_o_numero(autenticado):
    assert autenticado.get("/api/versao").json() == {"versao": VERSAO}
