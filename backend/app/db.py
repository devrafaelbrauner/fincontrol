import os
import re
import sqlite3
from pathlib import Path

from .util import normalizar_busca

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FINCONTROL_DATA", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "fincontrol.db"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: cada requisição tem sua própria conexão, mas o FastAPI
    # pode criar/encerrar o generator de dependência em threads diferentes do handler.
    # A conexão nunca é usada concorrentemente (uma requisição por vez), então é seguro.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")  # espera locks (writes concorrentes) em vez de falhar
    # `norm(x)` deixa o LIKE da busca insensível a acento e caixa — o do SQLite
    # sozinho só dobra caixa em ASCII. Ver util.normalizar_busca.
    # deterministic=True: mesma entrada, mesma saída — permite ao SQLite usá-la
    # em índices e views, e evita reavaliações desnecessárias.
    conn.create_function("norm", 1, normalizar_busca, deterministic=True)
    return conn


def get_db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Script que pede FKs desligadas (rebuild de tabela-pai, como a 016): só o comando no
# início da linha (menção em comentário `--` não conta) e com qualquer valor falso
# que o SQLite aceita (OFF, 0, FALSE, NO, com ou sem aspas).
_FK_OFF = re.compile(r"^\s*PRAGMA\s+foreign_keys\s*=\s*['\"]?(off|0|false|no)\b", re.IGNORECASE | re.MULTILINE)


def migrate() -> None:
    """Aplica as migrations pendentes, cada uma numa transação só.

    A migration e a sua linha em `schema_migrations` entram juntas ou não entram:
    erro ou app fechado no meio não deixa o banco pela metade, e a próxima abertura
    roda a migration de novo do zero. Por isso nenhuma migration pode abrir ou fechar
    a própria transação (BEGIN/COMMIT/SAVEPOINT/VACUUM).
    """
    conn = connect()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " nome TEXT PRIMARY KEY,"
            " aplicada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.commit()
        aplicadas = {r["nome"] for r in conn.execute("SELECT nome FROM schema_migrations")}
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if sql_file.name in aplicadas:
                continue
            script = sql_file.read_text(encoding="utf-8")
            # Dentro de uma transação, `PRAGMA foreign_keys` não faz nada (doc do
            # SQLite): o OFF do script viraria no-op e, no rebuild da 016, o DROP de
            # `compromissos` levaria junto os pagamentos de `lancamentos_variaveis`.
            # Então desligamos na conexão antes do BEGIN — só para quem pede, as
            # outras continuam rodando com as FKs ligadas, como sempre.
            fk_off = bool(_FK_OFF.search(script))
            if fk_off:
                conn.execute("PRAGMA foreign_keys=OFF")
            try:
                # O BEGIN vai no próprio script: `executescript` faz COMMIT do que
                # estiver pendente antes de começar, então um BEGIN separado não valeria.
                conn.executescript("BEGIN IMMEDIATE;\n" + script)
                conn.execute("INSERT INTO schema_migrations (nome) VALUES (?)", (sql_file.name,))
                conn.commit()
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
            finally:
                if fk_off:
                    conn.execute("PRAGMA foreign_keys=ON")
    finally:
        conn.close()
