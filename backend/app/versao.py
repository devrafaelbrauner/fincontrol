"""A versão do FinControl, lida do arquivo `VERSION` na raiz do repositório.

O número mora num arquivo só, e todo lugar que precisa dele ou lê daqui, ou é um
espelho conferido por `tests/test_versao.py`. Antes disso havia quatro cópias
soltas — `frontend/package.json`, o `FastAPI(version=...)` logo abaixo, o
`MARKETING_VERSION` do Xcode e o `versionName` do Android — e elas **já tinham
divergido**: as duas primeiras diziam `0.1.0` enquanto o iOS dizia `1.0`.

A leitura é em tempo de importação, com fallback, porque a alternativa é pior: o
backend não pode recusar-se a subir por causa de um arquivo de metadado. O que
protege de verdade contra a versão errada é o teste, que roda antes do deploy —
não uma exceção em produção.
"""

from pathlib import Path

# backend/app/versao.py → backend/app → backend → raiz
_RAIZ = Path(__file__).resolve().parent.parent.parent
_ARQUIVO = _RAIZ / "VERSION"

# `FALLBACK` é o que se vê se o arquivo sumir no empacotamento (um `pip install`
# sem ele, um contêiner que copiou só `backend/`). Fica propositalmente feio:
# "0.0.0+desconhecida" num painel é um sintoma legível, enquanto um número
# plausível e errado engana quem for depurar.
FALLBACK = "0.0.0+desconhecida"


def ler_versao() -> str:
    try:
        return _ARQUIVO.read_text(encoding="utf-8").strip() or FALLBACK
    except OSError:
        return FALLBACK


VERSAO = ler_versao()
