import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FINCONTROL_DATA", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "fincontrol.db"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
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
