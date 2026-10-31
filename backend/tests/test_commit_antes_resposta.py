"""O commit do banco acontece ANTES da resposta HTTP.

Com o `get_db` no escopo padrão ("request"), o teardown do `yield` — onde está o
`commit()` — rodava depois de a resposta sair: o cliente recebia 200 e só então
a escrita era gravada. Processo morto nesse intervalo perdia a escrita, e erro no
commit nunca virava 500.
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db as app_db
from app.db import connect
from app.main import app


class _ConexaoCommitFalha:
    """Conexão real em tudo, menos no commit, que falha como um disco cheio."""

    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, nome):
        return getattr(self._conn, nome)

    def commit(self):
        raise sqlite3.OperationalError("database or disk is full")


@pytest.fixture
def sem_categoria_teste():
    def limpar():
        conn = connect()
        conn.execute("DELETE FROM categorias WHERE nome LIKE 'teste-commit-%'")
        conn.commit()
        conn.close()

    limpar()
    yield
    limpar()


def _existe(nome):
    conn = connect()
    try:
        return conn.execute("SELECT 1 FROM categorias WHERE nome = ?", (nome,)).fetchone() is not None
    finally:
        conn.close()


def test_commit_que_falha_vira_500_e_nada_fica_gravado(autenticado, monkeypatch, sem_categoria_teste):
    token = autenticado.headers["Authorization"]
    monkeypatch.setattr(app_db, "connect", lambda: _ConexaoCommitFalha(connect()))

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.post("/api/categorias", json={"nome": "teste-commit-falha", "tipo": "variavel"},
                   headers={"Authorization": token})

    assert r.status_code == 500, r.text
    assert not _existe("teste-commit-falha")


def test_escrita_ja_esta_no_banco_quando_a_resposta_chega(autenticado, sem_categoria_teste):
    r = autenticado.post("/api/categorias", json={"nome": "teste-commit-ok", "tipo": "variavel"})

    assert r.status_code == 201, r.text
    assert _existe("teste-commit-ok")
