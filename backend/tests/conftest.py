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


# Tabelas de movimento, filhas antes das mães (as FKs estão ligadas).
# NÃO inclui `categorias` (a migration 004 semeia as padrão, e vários testes
# dependem delas) nem `config`, que o banco_limpo já cuida.
# Nem `webauthn_*`: cada teste de passkey limpa as suas (fixture em test_webauthn).
TABELAS_MOVIMENTO = (
    "lancamentos_variaveis", "parcelamentos", "compromissos",
    "lancamentos_fixos", "contas_fixas", "entradas",
    "metas_aportes", "metas_itens", "metas",
    "orcamentos", "saldos_conta", "contas_bancarias",
    "lembretes_enviados", "push_subscriptions", "insights_cache",
    "conversa_mensagens",
)


def limpar_movimento(conn) -> None:
    """Zera todo dado de movimento.

    Use isto — em vez de listar tabelas à mão — em qualquer teste que afirme
    algo GLOBAL, como "nenhuma notificação foi enviada". Fixtures que listam só
    as tabelas do próprio assunto quebram em silêncio quando uma entidade nova
    passa a gerar aviso: foi o que aconteceu quando os compromissos entraram no
    job de lembretes e os testes de orçamento começaram a contar pushes alheios.
    """
    for t in TABELAS_MOVIMENTO:
        conn.execute(f"DELETE FROM {t}")
    conn.commit()


@pytest.fixture
def cliente():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def autenticado(cliente):
    """Cliente já logado — para testar o que vem DEPOIS do login.

    O fluxo de login em si (senha errada, MFA, rotação de sessão) é assunto de
    test_login_mfa/test_auth_sessoes e continua usando o `cliente` cru; repeti-lo
    em cada teste de funcionalidade só adiciona ruído e um ponto de quebra.
    """
    r = cliente.post("/api/auth/login", json={"senha": SENHA})
    assert r.status_code == 200, r.text
    cliente.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return cliente
