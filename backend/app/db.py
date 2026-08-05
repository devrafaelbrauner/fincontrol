import os
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


def migrate() -> None:
    conn = connect()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " nome TEXT PRIMARY KEY,"
            " aplicada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        aplicadas = {r["nome"] for r in conn.execute("SELECT nome FROM schema_migrations")}
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if sql_file.name in aplicadas:
                continue
            conn.executescript(sql_file.read_text())
            conn.execute("INSERT INTO schema_migrations (nome) VALUES (?)", (sql_file.name,))
            conn.commit()
    finally:
        conn.close()
