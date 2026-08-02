"""Teto de bytes no corpo da requisição.

O multipart é parseado (e derramado para disco) antes das dependências de auth,
então o teto precisa valer para requisição anônima. Content-length sozinho não
basta: em Transfer-Encoding: chunked ele simplesmente não existe.
"""
import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.main import LimiteCorpo

LIMITE = 1000


async def _eco(request):
    corpo = await request.body()
    return JSONResponse({"recebido": len(corpo)})


@pytest.fixture
def cliente_limitado():
    app = Starlette(routes=[Route("/eco", _eco, methods=["POST"])])
    app.add_middleware(LimiteCorpo, limite=LIMITE)
    with TestClient(app) as c:
        yield c


def test_corpo_dentro_do_limite_passa(cliente_limitado):
    r = cliente_limitado.post("/eco", content=b"x" * (LIMITE - 1))
    assert r.status_code == 200
    assert r.json()["recebido"] == LIMITE - 1


def test_content_length_acima_do_limite_e_recusado(cliente_limitado):
    r = cliente_limitado.post("/eco", content=b"x" * (LIMITE + 1))
    assert r.status_code == 413


def test_corpo_chunked_acima_do_limite_e_recusado(cliente_limitado):
    """Regressão: sem content-length, o teto era ignorado e o corpo inteiro
    chegava a ser lido — justamente o caminho que enchia o disco."""
    def pedacos():
        for _ in range(10):
            yield b"x" * 500  # 5000 bytes no total, sem declarar tamanho

    r = cliente_limitado.post("/eco", content=pedacos())
    assert r.status_code == 413


def test_chunked_dentro_do_limite_passa(cliente_limitado):
    def pedacos():
        yield b"x" * 100
        yield b"y" * 100

    r = cliente_limitado.post("/eco", content=pedacos())
    assert r.status_code == 200
    assert r.json()["recebido"] == 200
