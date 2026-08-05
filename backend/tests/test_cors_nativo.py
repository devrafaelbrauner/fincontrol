"""As origens dos apps Capacitor precisam passar no preflight.

Antes elas dependiam de `FINCONTROL_CORS_ORIGINS`, e o `deploy/.env.example`
entregava a variável VAZIA — que é diferente de ausente, então o default nunca
entrava e a lista virava []. O web seguia funcionando (same-origin) e o deploy
parecia no ar, enquanto iPhone e Android não passavam do login: todo request leva
`X-Client: native`, que força preflight, e o preflight voltava 400.
"""

import pytest

from app.main import ORIGENS_NATIVAS, origens_cors


@pytest.mark.parametrize("origem", ORIGENS_NATIVAS)
def test_preflight_das_origens_nativas_passa(cliente, origem):
    r = cliente.options(
        "/api/auth/login",
        headers={
            "Origin": origem,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-client",
        },
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("access-control-allow-origin") == origem
    # allow_credentials: sem isto o cookie de refresh do web não trafega.
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_origem_desconhecida_nao_e_liberada(cliente):
    r = cliente.options(
        "/api/auth/login",
        headers={
            "Origin": "https://site-do-atacante.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.headers.get("access-control-allow-origin") is None


def test_ios_e_android_tem_origens_diferentes():
    """O .env.example trocava as duas, mandando `capacitor://localhost` para
    Android. São os defaults do Capacitor 8, um por plataforma."""
    assert "capacitor://localhost" in ORIGENS_NATIVAS  # iOS/iPadOS
    assert "https://localhost" in ORIGENS_NATIVAS      # Android


# ---------- composição da lista ----------

def test_variavel_vazia_nao_apaga_as_nativas():
    """O caso exato do .env.example: presente e vazia. Antes zerava a lista."""
    assert origens_cors("", producao=True) == list(ORIGENS_NATIVAS)


def test_extras_somam_em_vez_de_substituir():
    origens = origens_cors("https://outro-front.exemplo.com", producao=True)
    assert set(ORIGENS_NATIVAS) <= set(origens), "as nativas não podem sumir"
    assert "https://outro-front.exemplo.com" in origens


def test_extras_aceitam_lista_com_espacos_e_vazios():
    origens = origens_cors(" https://a.exemplo.com , ,https://b.exemplo.com ", producao=True)
    assert origens[len(ORIGENS_NATIVAS):] == ["https://a.exemplo.com", "https://b.exemplo.com"]


def test_dev_server_do_vite_so_fora_de_producao():
    assert "http://localhost:5173" in origens_cors(producao=False)
    assert "http://localhost:5173" not in origens_cors(producao=True)
