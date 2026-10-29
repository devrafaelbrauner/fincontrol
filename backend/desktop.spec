# -*- mode: python ; coding: utf-8 -*-
# PyInstaller: backend do app desktop (sidecar do Tauri), onedir sem UPX.
#
# Da raiz do repositório (é o que a CI roda; a saída é ignorada pelo git):
#   pyinstaller backend/desktop.spec --noconfirm --distpath frontend/src-tauri/sidecar-dist --workpath backend/build/pyinstaller
# Gera frontend/src-tauri/sidecar-dist/fincontrol-backend/fincontrol-backend[.exe], que o
# tauri.conf.json leva em bundle.resources como fincontrol-backend/.
#
# - onedir, não onefile: onefile extrai tudo no %TEMP% a cada abertura e é mais barrado
#   por antivírus. Sem UPX pelo mesmo motivo.
# - console=True (medido no Windows): com console=False o stdin em pipe funciona, mas uma
#   exceção não tratada abre a caixa de traceback do bootloader "windowed" e o processo fica
#   travado em vez de sair — a casca Rust não veria a queda. A casca lança com
#   CREATE_NO_WINDOW, então nenhuma janela de console aparece.
import os
import shutil

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

BACKEND = SPECPATH  # noqa: F821 (global do PyInstaller)
RAIZ = os.path.dirname(BACKEND)
NOME = "fincontrol-backend"

hiddenimports = (
    collect_submodules("uvicorn")  # protocolos/loops/lifespan são importados por nome
    + collect_submodules("tzdata")  # zoneinfo acha a base tz pelo pacote tzdata (Windows)
    + collect_submodules("webauthn")
    + ["_cffi_backend"]  # argon2-cffi (bindings CFFI)
)

datas = (
    # db.py procura as migrações em Path(app/db.py).parent / "migrations"; congelado, isso é
    # sys._MEIPASS/app/migrations.
    [(os.path.join(BACKEND, "app", "migrations", "*.sql"), os.path.join("app", "migrations"))]
    + collect_data_files("tzdata")
)

a = Analysis(  # noqa: F821
    [os.path.join(BACKEND, "fincontrol_desktop.py")],
    pathex=[BACKEND],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=NOME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=NOME,
)

# versao.py lê <raiz>/VERSION com raiz = Path(app/versao.py).parent.parent.parent; congelado,
# isso é a pasta do onedir (pai de _internal/). Sem o arquivo a versão vira "0.0.0+desconhecida".
shutil.copyfile(os.path.join(RAIZ, "VERSION"), os.path.join(DISTPATH, NOME, "VERSION"))  # noqa: F821
