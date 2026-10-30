"""`db.migrate()`: cada migration roda inteira numa transação, ou não roda.

Antes, `executescript` gravava comando a comando: uma migration que parava no meio
deixava tabelas e linhas sem registro em `schema_migrations`, e a abertura seguinte
falhava para sempre ("table b already exists"). Aqui cada teste usa um banco e um
diretório de migrations próprios (sintéticas), fora do banco compartilhado da suíte.
"""

import sqlite3

import pytest

from app import db

REBUILD_PAI = """
PRAGMA foreign_keys=OFF;
CREATE TABLE pai_novo (id INTEGER PRIMARY KEY, nome TEXT);
INSERT INTO pai_novo (id, nome) SELECT id, nome FROM pai;
DROP TABLE pai;
ALTER TABLE pai_novo RENAME TO pai;
PRAGMA foreign_keys=ON;
"""


@pytest.fixture
def banco(tmp_path, monkeypatch):
    """Banco vazio e diretório de migrations vazio só deste teste."""
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    monkeypatch.setattr(db, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "data" / "fincontrol.db")
    monkeypatch.setattr(db, "MIGRATIONS_DIR", migrations)
    return migrations


def _tabelas() -> set[str]:
    conn = db.connect()
    try:
        return {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def _registradas() -> list[str]:
    conn = db.connect()
    try:
        return [r["nome"] for r in conn.execute("SELECT nome FROM schema_migrations ORDER BY nome")]
    finally:
        conn.close()


def _pai_e_filhos(migrations):
    (migrations / "001_pai_filho.sql").write_text(
        "CREATE TABLE pai (id INTEGER PRIMARY KEY, nome TEXT NOT NULL);\n"
        "CREATE TABLE filho (id INTEGER PRIMARY KEY,"
        " pai_id INTEGER REFERENCES pai(id) ON DELETE CASCADE);\n"
        "INSERT INTO pai (id, nome) VALUES (1, 'um'), (2, 'dois');\n"
        "INSERT INTO filho (id, pai_id) VALUES (10, 1), (11, 1), (20, 2);\n",
        encoding="utf-8",
    )


def test_migration_que_falha_no_meio_nao_deixa_nada_e_roda_depois_de_corrigida(banco):
    (banco / "001_ok.sql").write_text("CREATE TABLE a (x INTEGER);\n", encoding="utf-8")
    quebrada = banco / "002_quebra.sql"
    quebrada.write_text(
        "CREATE TABLE b (x INTEGER);\n"
        "INSERT INTO b VALUES (1);\n"
        "ISTO NAO E SQL;\n",
        encoding="utf-8",
    )

    with pytest.raises(sqlite3.OperationalError):
        db.migrate()

    # A 001 ficou aplicada e registrada; da 002 não sobra tabela, linha nem registro.
    assert "a" in _tabelas()
    assert "b" not in _tabelas()
    assert _registradas() == ["001_ok.sql"]

    quebrada.write_text(
        "CREATE TABLE b (x INTEGER);\n"
        "INSERT INTO b VALUES (1);\n",
        encoding="utf-8",
    )
    db.migrate()
    db.migrate()

    conn = db.connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM b").fetchone()[0] == 1
    finally:
        conn.close()
    assert _registradas() == ["001_ok.sql", "002_quebra.sql"]


@pytest.mark.parametrize("pragma", ["PRAGMA foreign_keys=OFF;", "pragma foreign_keys = 0;"])
def test_rebuild_com_foreign_keys_off_preserva_filhos_e_religa_fks(banco, pragma):
    _pai_e_filhos(banco)
    (banco / "002_rebuild.sql").write_text(
        REBUILD_PAI.replace("PRAGMA foreign_keys=OFF;", pragma), encoding="utf-8"
    )
    # Roda na mesma conexão do rebuild: o CASCADE só apaga o filho 20 se o `finally`
    # religou as FKs depois da 002.
    (banco / "003_apaga_pai.sql").write_text("DELETE FROM pai WHERE id = 2;\n", encoding="utf-8")

    db.migrate()

    conn = db.connect()
    try:
        # Com as FKs ligadas na transação, o DROP do pai teria levado os filhos (CASCADE).
        assert [r["id"] for r in conn.execute("SELECT id FROM filho ORDER BY id")] == [10, 11]
        assert [r["nome"] for r in conn.execute("SELECT nome FROM pai ORDER BY id")] == ["um"]
        # O REFERENCES do filho continua no nome que a tabela reconstruída volta a ter.
        assert [r["table"] for r in conn.execute("PRAGMA foreign_key_list(filho)")] == ["pai"]
    finally:
        conn.close()
    assert _registradas() == ["001_pai_filho.sql", "002_rebuild.sql", "003_apaga_pai.sql"]


def test_pragma_so_em_comentario_roda_com_fks_ligadas(banco):
    _pai_e_filhos(banco)
    (banco / "002_apaga_pai.sql").write_text(
        "-- aqui não precisa de PRAGMA foreign_keys=OFF\n"
        "DELETE FROM pai WHERE id = 2;\n",
        encoding="utf-8",
    )

    db.migrate()

    conn = db.connect()
    try:
        # O CASCADE apagou o filho 20: as FKs não foram desligadas pelo comentário.
        assert [r["id"] for r in conn.execute("SELECT id FROM filho ORDER BY id")] == [10, 11]
    finally:
        conn.close()


class _SemFechar:
    """Repassa tudo à conexão real, menos o `close()` — para olhar a conexão do migrate() depois."""

    def __init__(self, conn):
        self.conn = conn

    def __getattr__(self, nome):
        return getattr(self.conn, nome)

    def close(self):
        pass


def test_rebuild_que_falha_no_meio_mantem_pai_e_filhos(banco, monkeypatch):
    _pai_e_filhos(banco)
    db.migrate()
    (banco / "002_rebuild.sql").write_text(
        REBUILD_PAI.replace("ALTER TABLE pai_novo RENAME TO pai;", "ISTO NAO E SQL;"),
        encoding="utf-8",
    )
    connect_real = db.connect
    abertas = []
    monkeypatch.setattr(db, "connect", lambda: abertas.append(_SemFechar(connect_real())) or abertas[-1])

    with pytest.raises(sqlite3.OperationalError):
        db.migrate()

    # A mesma conexão em que a 002 falhou voltou a ter as FKs ligadas (o `finally`).
    (usada,) = abertas
    assert usada.conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert not usada.conn.in_transaction
    usada.conn.close()
    monkeypatch.setattr(db, "connect", connect_real)

    conn = db.connect()
    try:
        assert [r["nome"] for r in conn.execute("SELECT nome FROM pai ORDER BY id")] == ["um", "dois"]
        assert [r["id"] for r in conn.execute("SELECT id FROM filho ORDER BY id")] == [10, 11, 20]
        assert "pai_novo" not in _tabelas()
    finally:
        conn.close()
    assert _registradas() == ["001_pai_filho.sql"]


def test_migrations_reais_aplicam_do_zero_e_sao_idempotentes(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "fincontrol.db")
    reais = sorted(p.name for p in db.MIGRATIONS_DIR.glob("*.sql"))

    db.migrate()
    assert _registradas() == reais

    db.migrate()
    assert _registradas() == reais
