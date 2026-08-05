"""Toda data gravada passa por `util.DataISO`.

O que este arquivo protege: antes, só `/variaveis/parcelado` checava o formato.
`POST /variaveis` com "15/08/2026" (ou "banana") respondia 201, a linha entrava
no banco e sumia de tudo que recorta por mês — dashboard, análises, orçamentos,
lembretes — enquanto continuava somando no total da lista sem filtro. Caminho
real para isso: o preenchimento por IA (`/ia/interpretar`, `/ia/extrair`) devolve
a string crua do modelo, e o `<input type=date>` mostra vazio sem limpar o estado
que vai para o POST.
"""

import pytest

from app.db import connect


@pytest.fixture
def db():
    conn = connect()
    for t in ("lancamentos_variaveis", "parcelamentos", "entradas", "metas_aportes",
              "metas", "lancamentos_fixos", "contas_fixas"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    yield conn
    conn.close()


# Formatos que `date.fromisoformat` (3.11+) aceita, mas que o banco — que filtra
# por prefixo 'YYYY-MM-' — não enxerga em nenhuma visão mensal.
DATAS_INVALIDAS = ["15/08/2026", "2026-8-5", "banana", "20260815", "2026-W33-1", "2026-02-30", ""]


@pytest.mark.parametrize("data", DATAS_INVALIDAS)
def test_variavel_recusa_data_fora_do_padrao(db, autenticado, data):
    r = autenticado.post("/api/variaveis", json={"descricao": "Mercado", "valor_cents": 5000, "data": data})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT COUNT(*) n FROM lancamentos_variaveis").fetchone()["n"] == 0


@pytest.mark.parametrize("data", DATAS_INVALIDAS)
def test_entrada_recusa_data_fora_do_padrao(db, autenticado, data):
    r = autenticado.post("/api/entradas", json={"descricao": "Salário", "valor_cents": 100000, "data": data})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT COUNT(*) n FROM entradas").fetchone()["n"] == 0


def test_patch_de_variavel_tambem_valida(db, autenticado):
    novo = autenticado.post(
        "/api/variaveis", json={"descricao": "Mercado", "valor_cents": 5000, "data": "2026-08-15"}
    ).json()
    r = autenticado.patch(f"/api/variaveis/{novo['id']}", json={"data": "amanhã"})
    assert r.status_code == 422, r.text
    assert db.execute("SELECT data FROM lancamentos_variaveis").fetchone()["data"] == "2026-08-15"


def test_meta_recusa_prazo_sem_dia(db, autenticado):
    # 'YYYY-MM' passava e a meta sumia do feed .ics (que já descartava prazo não
    # parseável em silêncio) e quebrava o "até <data>" da tela.
    r = autenticado.post("/api/metas", json={"nome": "Viagem", "valor_total_cents": 500000, "prazo": "2027-12"})
    assert r.status_code == 422, r.text


def test_aporte_e_pagamento_validam_a_data(db, autenticado):
    meta = autenticado.post(
        "/api/metas", json={"nome": "Viagem", "valor_total_cents": 500000, "prazo": "2027-12-31"}
    ).json()
    r = autenticado.post(f"/api/metas/{meta['id']}/aportes", json={"valor_cents": 1000, "data": "ontem"})
    assert r.status_code == 422, r.text

    conta = autenticado.post(
        "/api/contas-fixas", json={"nome": "Luz", "dia_vencimento": 10, "valor_estimado_cents": 15000}
    ).json()
    lancs = autenticado.get("/api/contas-fixas/lancamentos/2026-08").json()
    lanc_id = next(l["id"] for l in lancs if l["conta_fixa_id"] == conta["id"])
    r = autenticado.post(f"/api/contas-fixas/lancamentos/{lanc_id}/pagar", json={"data_pagamento": "hoje"})
    assert r.status_code == 422, r.text


def test_data_valida_continua_passando(db, autenticado):
    for corpo in (
        {"descricao": "Mercado", "valor_cents": 5000, "data": "2026-08-15"},
        {"descricao": "Último dia", "valor_cents": 100, "data": "2026-02-29"},  # 2026 não é bissexto…
    ):
        r = autenticado.post("/api/variaveis", json=corpo)
        esperado = 201 if corpo["data"] == "2026-08-15" else 422
        assert r.status_code == esperado, r.text


def test_fk_inexistente_e_400_e_nao_500(db, autenticado):
    """O /parcelado já traduzia FK quebrada em 400; os endpoints simples davam 500."""
    r = autenticado.post(
        "/api/variaveis",
        json={"descricao": "X", "valor_cents": 100, "data": "2026-08-15", "categoria_id": 99_999},
    )
    assert r.status_code == 400, r.text

    r = autenticado.post(
        "/api/entradas",
        json={"descricao": "X", "valor_cents": 100, "data": "2026-08-15", "categoria_id": 99_999},
    )
    assert r.status_code == 400, r.text

    novo = autenticado.post(
        "/api/variaveis", json={"descricao": "Mercado", "valor_cents": 5000, "data": "2026-08-15"}
    ).json()
    r = autenticado.patch(f"/api/variaveis/{novo['id']}", json={"anexo_id": 99_999})
    assert r.status_code == 400, r.text


# ---------- filtros de leitura (`de`/`ate`) ----------
#
# Mesma classe, do lado da leitura: `de`/`ate` não eram validados em /variaveis
# e /entradas. Comparados como texto, `'15/08/2026' < '2026-...'`, então o WHERE
# ficava sempre verdadeiro e a lista voltava INTEIRA — sem filtro, com cara de
# filtrada. `/busca` já validava (e responde 400, com o rótulo do parâmetro).


@pytest.mark.parametrize("endpoint", ["/api/variaveis", "/api/entradas"])
@pytest.mark.parametrize("param", ["de", "ate"])
@pytest.mark.parametrize("data", DATAS_INVALIDAS[:-1])  # "" significa "sem filtro", não erro
def test_filtro_de_data_invalido_e_recusado(db, autenticado, endpoint, param, data):
    r = autenticado.get(endpoint, params={param: data})
    assert r.status_code == 422, r.text


def test_filtro_em_formato_brasileiro_nao_devolve_lista_inteira(db, autenticado):
    """O caso que passava despercebido: não vinha lista vazia, vinha TUDO."""
    autenticado.post("/api/variaveis", json={"descricao": "Mercado", "valor_cents": 5000, "data": "2026-08-15"})

    assert autenticado.get("/api/variaveis", params={"de": "15/08/2026"}).status_code == 422
    # O filtro válido continua filtrando de verdade nos dois sentidos:
    assert autenticado.get("/api/variaveis", params={"de": "2026-09-01"}).json()["itens"] == []
    assert len(autenticado.get("/api/variaveis", params={"de": "2026-08-01"}).json()["itens"]) == 1


def test_filtro_de_data_vazio_significa_sem_filtro(db, autenticado):
    autenticado.post("/api/entradas", json={"descricao": "Salário", "valor_cents": 900_000, "data": "2026-08-05"})

    r = autenticado.get("/api/entradas", params={"de": "", "ate": ""})
    assert r.status_code == 200, r.text
    assert len(r.json()["itens"]) == 1
