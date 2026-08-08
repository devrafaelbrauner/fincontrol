"""Configuração do OpenRouter e recursos de IA.

A chave do OpenRouter é criptografada (Fernet) ao salvar e nunca volta ao frontend
— só o status "configurada". Todas as chamadas de IA passam pelo backend.
"""

import json
import sqlite3
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import openrouter
from ..cripto import criptografar
from ..db import get_db
from ..openrouter import OpenRouterError
from ..routers.anexos import EXTENSAO_PARA_CONTENT_TYPE, UPLOADS_DIR
from ..util import hoje, validar_competencia, validar_data, gerar_lancamentos_fixos

router = APIRouter(prefix="/ia", tags=["ia"])


def _data_ok(valor: str) -> bool:
    """Data que o modelo devolveu serve para gravar/recortar por mês?"""
    try:
        validar_data(valor)
    except ValueError:
        return False
    return True


# ---------- helpers de resumo (contexto para insights/estratégia/chat) ----------

def _competencias_anteriores(competencia: str, n: int) -> list[str]:
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    out = []
    for _ in range(n):
        out.append(f"{ano:04d}-{mes:02d}")
        mes -= 1
        if mes == 0:
            mes, ano = 12, ano - 1
    return out


def _resumo_mes(db: sqlite3.Connection, competencia: str) -> str:
    gerar_lancamentos_fixos(db, competencia)
    prefixo = competencia + "-%"
    entradas = db.execute("SELECT COALESCE(SUM(valor_cents),0) t FROM entradas WHERE data LIKE ?", (prefixo,)).fetchone()["t"]
    fixas = db.execute("SELECT COALESCE(SUM(valor_cents),0) t FROM lancamentos_fixos WHERE competencia = ?", (competencia,)).fetchone()["t"]
    variaveis = db.execute("SELECT COALESCE(SUM(valor_cents),0) t FROM lancamentos_variaveis WHERE data LIKE ?", (prefixo,)).fetchone()["t"]
    por_cat = db.execute(
        """SELECT COALESCE(c.nome, 'sem categoria') nome, SUM(v.valor_cents) t, COUNT(*) n
           FROM lancamentos_variaveis v LEFT JOIN categorias c ON c.id = v.categoria_id
           WHERE v.data LIKE ? GROUP BY c.nome ORDER BY t DESC LIMIT 6""",
        (prefixo,),
    ).fetchall()
    reais = lambda c: f"R$ {c/100:.2f}"
    linhas = [
        f"Mês {competencia}: entradas {reais(entradas)}, contas fixas {reais(fixas)}, "
        f"gastos variáveis {reais(variaveis)}, saldo {reais(entradas - fixas - variaveis)}."
    ]
    if por_cat:
        linhas.append("  Top categorias variáveis: " + "; ".join(
            f"{r['nome']} {reais(r['t'])} ({r['n']} lançamento{'s' if r['n'] > 1 else ''})" for r in por_cat) + ".")
    return "\n".join(linhas)


def _resumo_3meses(db: sqlite3.Connection, competencia: str) -> str:
    return "\n".join(_resumo_mes(db, c) for c in _competencias_anteriores(competencia, 3))


def _contexto_financeiro(db: sqlite3.Connection, competencia: str, excluir_meta_id: int | None = None) -> str:
    """Fotografia completa: meses recentes, fixas, entradas recorrentes e metas concorrentes."""
    reais = lambda c: f"R$ {c/100:.2f}"
    partes = ["Resumo dos últimos 3 meses:", _resumo_3meses(db, competencia)]
    fixas = db.execute(
        "SELECT nome, valor_estimado_cents, dia_vencimento FROM contas_fixas WHERE ativa = 1 ORDER BY valor_estimado_cents DESC"
    ).fetchall()
    if fixas:
        partes.append("Contas fixas ativas: " + "; ".join(
            f"{f['nome']} {reais(f['valor_estimado_cents'])} (vence dia {f['dia_vencimento']})" for f in fixas) + ".")
    # Uma linha por descrição (o valor da mais recente) — o salário lançado todo
    # mês como recorrente apareceria repetido no contexto.
    rec = db.execute(
        """SELECT descricao, valor_cents, MAX(data) ultima FROM entradas
           WHERE recorrente = 1 GROUP BY descricao ORDER BY ultima DESC LIMIT 10"""
    ).fetchall()
    if rec:
        partes.append("Entradas recorrentes: " + "; ".join(f"{r['descricao']} {reais(r['valor_cents'])}" for r in rec) + ".")
    metas = db.execute(
        """SELECT m.id, m.nome, m.valor_total_cents, m.prazo, COALESCE(SUM(a.valor_cents),0) atual
           FROM metas m LEFT JOIN metas_aportes a ON a.meta_id = m.id
           WHERE m.ativa = 1 GROUP BY m.id""",
    ).fetchall()
    outras = [m for m in metas if m["id"] != excluir_meta_id]
    if outras:
        rotulo = "Outras metas ativas (disputam o mesmo orçamento)" if excluir_meta_id else "Metas ativas"
        partes.append(f"{rotulo}: " + "; ".join(
            f"{m['nome']} (guardado {reais(m['atual'])} de {reais(m['valor_total_cents'])}, prazo {m['prazo']})"
            for m in outras) + ".")
    # Compromissos em aberto: dívida com prazo compete pelo mesmo dinheiro que
    # meta e gasto variável. Sem eles no contexto, qualquer conselho de IA —
    # inclusive o do assistente e o dos insights do mês — sugere guardar dinheiro
    # que na verdade já está comprometido.
    comps = db.execute(
        """SELECT c.nome, c.credor, c.data_limite,
                  c.valor_total_cents - COALESCE(SUM(l.valor_cents), 0) AS falta_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.ativo = 1 GROUP BY c.id HAVING falta_cents > 0
           ORDER BY c.data_limite"""
    ).fetchall()
    if comps:
        partes.append("Compromissos em aberto: " + "; ".join(
            f"{c['nome']}" + (f" (para {c['credor']})" if c["credor"] else "")
            + f" falta {reais(c['falta_cents'])}, vence {c['data_limite']}"
            for c in comps) + ".")
    return "\n".join(partes)


# ---------- config ----------

class ConfigIn(BaseModel):
    api_key: str | None = None
    modelo: str | None = None


def _set_config(db: sqlite3.Connection, chave: str, valor: str) -> None:
    db.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )


@router.get("/config")
def ver_config(db: sqlite3.Connection = Depends(get_db)):
    return {"configurada": openrouter.api_key(db) is not None, "modelo": openrouter.modelo_preferido(db)}


@router.put("/config")
def salvar_config(body: ConfigIn, db: sqlite3.Connection = Depends(get_db)):
    if body.api_key:
        _set_config(db, "openrouter_api_key_enc", criptografar(body.api_key.strip()))
    if body.modelo:
        _set_config(db, "modelo_preferido", body.modelo.strip())
    return {"configurada": openrouter.api_key(db) is not None, "modelo": openrouter.modelo_preferido(db)}


@router.delete("/config")
def remover_chave(db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM config WHERE chave = 'openrouter_api_key_enc'")
    return {"ok": True}


# ---------- extração de anexo ----------

@router.post("/extrair/{anexo_id}")
def extrair(anexo_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = UPLOADS_DIR / row["caminho_arquivo"]
    if not caminho.exists():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    mime = EXTENSAO_PARA_CONTENT_TYPE.get(Path(row["caminho_arquivo"]).suffix, "application/octet-stream")
    cats = [r["nome"] for r in db.execute("SELECT nome FROM categorias WHERE ativa = 1")]
    try:
        dados = openrouter.extrair_de_anexo(db, caminho.read_bytes(), mime, row["tipo"], cats)
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    db.execute("UPDATE anexos SET extraido_por_ia = 1, dados_extraidos_json = ? WHERE id = ?",
               (json.dumps(dados, ensure_ascii=False), anexo_id))
    return dados


@router.post("/extrair-itens/{anexo_id}")
def extrair_itens(anexo_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Extração itemizada: lê os lançamentos individuais do documento (fatura, extrato)."""
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = UPLOADS_DIR / row["caminho_arquivo"]
    if not caminho.exists():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    mime = EXTENSAO_PARA_CONTENT_TYPE.get(Path(row["caminho_arquivo"]).suffix, "application/octet-stream")
    cats = [r["nome"] for r in db.execute("SELECT nome FROM categorias WHERE ativa = 1 AND tipo = 'variavel'")]
    try:
        dados = openrouter.extrair_itens_de_anexo(db, caminho.read_bytes(), mime, row["tipo"], cats)
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    itens = dados.get("itens")
    if not isinstance(itens, list):
        raise HTTPException(502, "A IA não retornou a lista de itens esperada")
    return dados


# ---------- insights (com cache por competência) ----------

def _ler_insights(db: sqlite3.Connection, competencia: str) -> dict | None:
    row = db.execute("SELECT dados_json, criado_em FROM insights_cache WHERE competencia = ?", (competencia,)).fetchone()
    if not row:
        return None
    return {"insights": json.loads(row["dados_json"]), "gerado_em": row["criado_em"]}


@router.get("/insights/{competencia}")
def insights_cache(competencia: str, db: sqlite3.Connection = Depends(get_db)):
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _ler_insights(db, competencia) or {"insights": None}


@router.post("/insights/{competencia}")
def insights(competencia: str, db: sqlite3.Connection = Depends(get_db)):
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        dados = openrouter.gerar_insights(db, _contexto_financeiro(db, competencia))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    db.execute(
        "INSERT INTO insights_cache (competencia, dados_json, criado_em) VALUES (?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(competencia) DO UPDATE SET dados_json = excluded.dados_json, criado_em = CURRENT_TIMESTAMP",
        (competencia, json.dumps(dados, ensure_ascii=False)),
    )
    return _ler_insights(db, competencia)


# ---------- categorização (uma e em lote) ----------

class CategorizarIn(BaseModel):
    descricao: str


@router.post("/categorizar")
def categorizar(body: CategorizarIn, db: sqlite3.Connection = Depends(get_db)):
    categorias = [r["nome"] for r in db.execute("SELECT nome FROM categorias WHERE ativa = 1 AND tipo = 'variavel'")]
    if not categorias:
        return {"categoria": None}
    try:
        return {"categoria": openrouter.categorizar(db, body.descricao, categorias)}
    except OpenRouterError as e:
        raise HTTPException(502, str(e))


@router.post("/categorizar-lote")
def categorizar_lote(db: sqlite3.Connection = Depends(get_db)):
    """Classifica todos os gastos variáveis SEM categoria numa passada e aplica."""
    cats = db.execute("SELECT id, nome FROM categorias WHERE ativa = 1 AND tipo = 'variavel'").fetchall()
    if not cats:
        raise HTTPException(400, "Crie categorias (tipo variável) antes de categorizar.")
    nome_para_id = {c["nome"]: c["id"] for c in cats}
    sem_cat = db.execute(
        "SELECT id, descricao FROM lancamentos_variaveis WHERE categoria_id IS NULL ORDER BY id DESC LIMIT 100"
    ).fetchall()
    if not sem_cat:
        return {"categorizados": 0, "total": 0}
    try:
        mapa = openrouter.categorizar_lote(db, [dict(r) for r in sem_cat], list(nome_para_id))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    aplicados = 0
    for lanc_id, nome in mapa.items():
        cid = nome_para_id.get(nome)
        if cid is not None:
            db.execute("UPDATE lancamentos_variaveis SET categoria_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?", (cid, lanc_id))
            aplicados += 1
    return {"categorizados": aplicados, "total": len(sem_cat)}


# ---------- estratégia de meta ----------

@router.post("/estrategia-meta/{meta_id}")
def estrategia_meta(meta_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(
        """SELECT m.*, COALESCE(SUM(a.valor_cents), 0) AS valor_atual_cents
           FROM metas m LEFT JOIN metas_aportes a ON a.meta_id = m.id
           WHERE m.id = ? GROUP BY m.id""",
        (meta_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Meta não encontrada")
    h = hoje()
    ano, mes = int(row["prazo"][:4]), int(row["prazo"][5:7])
    meses = max((ano - h.year) * 12 + (mes - h.month), 1)
    faltante = max(row["valor_total_cents"] - row["valor_atual_cents"], 0)
    meta = {
        "nome": row["nome"], "valor_total_cents": row["valor_total_cents"],
        "valor_atual_cents": row["valor_atual_cents"], "prazo": row["prazo"],
        "valor_mensal_necessario_cents": faltante // meses,
    }
    comp = f"{h.year:04d}-{h.month:02d}"
    try:
        texto = openrouter.estrategia_meta(db, meta, _contexto_financeiro(db, comp, meta_id))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    db.execute("UPDATE metas SET estrategia_texto = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?", (texto, meta_id))
    return {"estrategia": texto}


def _valor_cents(bruto) -> int | None:
    """Normaliza o valor que o modelo devolveu, ou None se for ilegível — nesse caso a
    sugestão é descartada, em vez de entrar no plano valendo R$ 0,00.

    Aceita número e string de dígitos puros ("180000"), que é o modelo errando só o tipo.
    Recusa de propósito valor formatado ("R$ 1.800,00", "1800.50"): o campo é em centavos,
    então esse texto tanto pode ser 180000 centavos quanto 1800 — e chutar erra por 100x.
    """
    if isinstance(bruto, bool):
        return None
    if isinstance(bruto, int):
        return max(bruto, 0)
    if isinstance(bruto, float):
        return max(int(bruto), 0) if bruto.is_integer() else None
    if isinstance(bruto, str) and bruto.strip().isdigit():
        return int(bruto.strip())
    return None


@router.post("/planejar-meta/{meta_id}")
def planejar_meta(meta_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Sugere itens de planejamento para a meta (sem gravar — o usuário aceita os que quiser)."""
    row = db.execute(
        """SELECT m.*, COALESCE(SUM(a.valor_cents), 0) AS valor_atual_cents
           FROM metas m LEFT JOIN metas_aportes a ON a.meta_id = m.id
           WHERE m.id = ? GROUP BY m.id""",
        (meta_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Meta não encontrada")
    itens = [dict(r) for r in db.execute(
        "SELECT nome, valor_cents, descricao FROM metas_itens WHERE meta_id = ? ORDER BY id", (meta_id,)
    )]
    meta = {"nome": row["nome"], "valor_total_cents": row["valor_total_cents"],
            "valor_atual_cents": row["valor_atual_cents"], "prazo": row["prazo"]}
    h = hoje()
    comp = f"{h.year:04d}-{h.month:02d}"
    try:
        dados = openrouter.planejar_meta(db, meta, itens, _contexto_financeiro(db, comp, meta_id))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    sugestoes = []
    for i in dados.get("itens", []):
        if not isinstance(i, dict) or not str(i.get("nome", "")).strip():
            continue
        valor = _valor_cents(i.get("valor_cents"))
        if valor is None:  # veio ilegível: melhor omitir do que sugerir R$ 0,00 como se fosse o preço
            continue
        sugestoes.append({
            "nome": str(i["nome"]).strip(),
            "valor_cents": valor,
            "descricao": (str(i["descricao"]).strip() or None) if i.get("descricao") else None,
        })
    return {"itens": sugestoes, "analise": str(dados.get("analise", "")).strip()}


# ---------- linguagem natural → transação ----------

class InterpretarIn(BaseModel):
    texto: str


@router.post("/interpretar")
def interpretar(body: InterpretarIn, db: sqlite3.Connection = Depends(get_db)):
    cats = [r["nome"] for r in db.execute("SELECT nome FROM categorias WHERE ativa = 1")]
    try:
        return openrouter.interpretar_transacao(db, body.texto, hoje().isoformat(), cats)
    except OpenRouterError as e:
        raise HTTPException(502, str(e))


# ---------- assistente / chat ----------

class PerguntarIn(BaseModel):
    pergunta: str


# Quanta conversa passada acompanha cada pergunta.
#
# Os dois limites existem porque cada token enviado é pago pelo dono do app, e
# a conversa cresce sem teto natural: sem corte, a centésima pergunta carregaria
# as 99 anteriores. 12 falas são 6 rodadas — o bastante para "e no mês passado?"
# e para um encadeamento curto de raciocínio, que é como este assistente é
# usado. O teto de caracteres é a defesa contra o caso patológico das 12 falas
# serem todas longas (uma orientação de compromisso colada no chat, por
# exemplo); ele corta pelas mais ANTIGAS, preservando o fio recente.
MEMORIA_FALAS = 12
MEMORIA_CARACTERES = 6000

# Teto do que fica guardado. A thread é do dono e ninguém audita chat de app
# pessoal, mas um log de IA que só cresce vira um arquivo grande em silêncio
# dentro do backup diário. 200 falas são bem mais do que a memória usa.
HISTORICO_GUARDADO = 200


def _historico(db: sqlite3.Connection) -> list[dict]:
    """Falas anteriores no formato do modelo, mais antigas primeiro."""
    linhas = db.execute(
        "SELECT papel, texto FROM conversa_mensagens ORDER BY id DESC LIMIT ?",
        (MEMORIA_FALAS,),
    ).fetchall()
    recentes: list[dict] = []
    total = 0
    # Percorre do mais novo para o mais velho e para quando estoura o teto: é o
    # que garante que o corte sacrifique o começo da conversa, não o fim.
    for r in linhas:
        total += len(r["texto"])
        if total > MEMORIA_CARACTERES and recentes:
            break
        recentes.append({"role": r["papel"], "content": r["texto"]})
    recentes.reverse()
    return recentes


@router.get("/conversa")
def conversa(db: sqlite3.Connection = Depends(get_db)):
    """A thread inteira, para a tela ser a mesma em qualquer aparelho."""
    linhas = db.execute(
        "SELECT id, papel, texto, criado_em FROM conversa_mensagens ORDER BY id"
    ).fetchall()
    return {"mensagens": [dict(r) for r in linhas]}


@router.delete("/conversa")
def limpar_conversa(db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM conversa_mensagens")
    return {"ok": True}


@router.post("/perguntar")
def perguntar(body: PerguntarIn, db: sqlite3.Connection = Depends(get_db)):
    pergunta = body.pergunta.strip()
    if not pergunta:
        raise HTTPException(422, "Pergunta vazia")
    h = hoje()
    comp = f"{h.year:04d}-{h.month:02d}"
    contexto = f"Hoje: {h.isoformat()}.\n" + _contexto_financeiro(db, comp)
    try:
        resposta = openrouter.perguntar(db, pergunta, contexto, _historico(db))
    except OpenRouterError as e:
        # A pergunta NÃO é gravada antes da resposta, de propósito: uma chamada
        # que falha deixaria uma fala do usuário pendurada sem par, que na
        # próxima pergunta iria para o modelo como se tivesse sido respondida.
        raise HTTPException(502, str(e))

    db.executemany(
        "INSERT INTO conversa_mensagens (papel, texto) VALUES (?, ?)",
        [("user", pergunta), ("assistant", resposta)],
    )
    db.execute(
        "DELETE FROM conversa_mensagens WHERE id <= "
        "(SELECT id FROM conversa_mensagens ORDER BY id DESC LIMIT 1 OFFSET ?)",
        (HISTORICO_GUARDADO,),
    )
    return {"resposta": resposta}


# ---------- compromissos financeiros ----------

def _compromisso_para_ia(db: sqlite3.Connection, compromisso_id: int) -> dict:
    row = db.execute(
        """SELECT c.*, COALESCE(SUM(l.valor_cents), 0) AS pago_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.id = ? GROUP BY c.id""",
        (compromisso_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Compromisso não encontrado")
    falta = row["valor_total_cents"] - row["pago_cents"]
    if falta <= 0:
        # Pagar uma chamada de IA para orientar sobre dívida já quitada é queimar
        # dinheiro do dono para dizer "não faça nada".
        raise HTTPException(400, "Este compromisso já está quitado")
    h = hoje()
    return {
        "nome": row["nome"], "credor": row["credor"],
        "valor_total_cents": row["valor_total_cents"],
        "pago_cents": row["pago_cents"], "falta_cents": falta,
        "data_limite": row["data_limite"], "hoje": h.isoformat(),
        "dias_restantes": (date.fromisoformat(row["data_limite"]) - h).days,
    }


@router.post("/orientacao-compromisso/{compromisso_id}")
def orientacao_compromisso(compromisso_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Plano para quitar este compromisso. Salva em `orientacao_texto`.

    Sob demanda, nunca automático: cada chamada é paga, e gerar orientação para
    todo compromisso cadastrado cobraria o dono por texto que ele não pediu.
    """
    comp = _compromisso_para_ia(db, compromisso_id)
    h = hoje()
    try:
        texto = openrouter.orientacao_compromisso(
            db, comp, _contexto_financeiro(db, f"{h.year:04d}-{h.month:02d}"))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    db.execute("UPDATE compromissos SET orientacao_texto = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
               (texto, compromisso_id))
    return {"orientacao": texto}


@router.post("/priorizar-compromissos")
def priorizar_compromissos(db: sqlite3.Connection = Depends(get_db)):
    """Ordem sugerida de quitação — uma chamada olhando todos os abertos."""
    linhas = db.execute(
        """SELECT c.id, c.nome, c.credor, c.data_limite,
                  c.valor_total_cents - COALESCE(SUM(l.valor_cents), 0) AS falta_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.ativo = 1 GROUP BY c.id HAVING falta_cents > 0
           ORDER BY c.data_limite"""
    ).fetchall()
    if len(linhas) < 2:
        raise HTTPException(400, "Priorizar só faz sentido com dois ou mais compromissos em aberto")
    h = hoje()
    itens = [
        {**dict(r), "dias_restantes": (date.fromisoformat(r["data_limite"]) - h).days}
        for r in linhas if _data_ok(r["data_limite"])
    ]
    try:
        dados = openrouter.priorizar_compromissos(
            db, itens, _contexto_financeiro(db, f"{h.year:04d}-{h.month:02d}"))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    # O modelo pode inventar id ou esquecer algum: só passa o que existe, e a
    # ordem é reconstruída aqui em vez de confiar no `posicao` que ele mandou.
    validos = {i["id"] for i in itens}
    ordem = [o for o in dados.get("ordem", [])
             if isinstance(o, dict) and o.get("id") in validos]
    ordem.sort(key=lambda o: o.get("posicao") if isinstance(o.get("posicao"), int) else 999)
    vistos, limpa = set(), []
    for pos, o in enumerate(ordem, start=1):
        if o["id"] in vistos:
            continue
        vistos.add(o["id"])
        limpa.append({"id": o["id"], "posicao": pos, "motivo": str(o.get("motivo", "")).strip()})
    faltantes = [i["id"] for i in itens if i["id"] not in vistos]
    return {"ordem": limpa, "sem_posicao": faltantes,
            "resumo": str(dados.get("resumo", "")).strip()}


@router.post("/plano-compromisso/{compromisso_id}")
def plano_compromisso(compromisso_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Parcelas sugeridas até o prazo. NÃO grava nada — o dono aceita o que quiser."""
    comp = _compromisso_para_ia(db, compromisso_id)
    h = hoje()
    try:
        dados = openrouter.plano_compromisso(
            db, comp, _contexto_financeiro(db, f"{h.year:04d}-{h.month:02d}"))
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    parcelas = []
    for p in dados.get("parcelas", []):
        if not isinstance(p, dict):
            continue
        valor = _valor_cents(p.get("valor_cents"))
        data = str(p.get("data", "")).strip()
        # Mesma régua do resto do app: valor ilegível ou data fora do padrão é
        # descartado, e não gravado como R$ 0,00 ou data que some dos recortes.
        if valor is None or valor <= 0 or not _data_ok(data):
            continue
        parcelas.append({"data": data, "valor_cents": valor})
    parcelas.sort(key=lambda p: p["data"])
    soma = sum(p["valor_cents"] for p in parcelas)
    return {
        "parcelas": parcelas,
        "soma_cents": soma,
        "falta_cents": comp["falta_cents"],
        # A soma raramente fecha no centavo; a tela mostra a diferença em vez de
        # fingir que o plano cobre tudo.
        "diferenca_cents": comp["falta_cents"] - soma,
        "analise": str(dados.get("analise", "")).strip(),
    }
