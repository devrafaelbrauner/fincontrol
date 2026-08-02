import os
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

# O ambiente precisa estar pronto ANTES de importar app.main: ele valida os
# segredos e roda as migrations no import.
os.environ["FINCONTROL_DATA"] = tempfile.mkdtemp(prefix="fincontrol-testes-")
os.environ["FINCONTROL_SECRET_KEY"] = "chave-de-teste-" + "0" * 40
os.environ.pop("FINCONTROL_ENV", None)  # os testes rodam no modo dev

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth  # noqa: E402
from app.db import connect  # noqa: E402
from app.main import app  # noqa: E402

SENHA = "segredo-de-teste-123"


@pytest.fixture(autouse=True)
def banco_limpo():
    """Cada teste começa com uma conta configurada e nenhuma sessão aberta."""
    db = connect()
    db.execute("DELETE FROM refresh_tokens")
    db.execute("DELETE FROM config")
    auth._config_set(db, "senha_hash", auth.ph.hash(SENHA))
    db.commit()
    db.close()
    # O teto de 5 logins/minuto inviabiliza o teste do limite de sessões.
    auth.limiter.enabled = False
    yield
    auth.limiter.enabled = True


@pytest.fixture
def cliente():
    with TestClient(app) as c:
        yield c
