"""Configuração do OpenRouter e recursos de IA.

A chave do OpenRouter é criptografada (Fernet) ao salvar e nunca volta ao frontend
— só o status "configurada". Todas as chamadas de IA passam pelo backend.
"""

import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import openrouter
from ..cripto import criptografar
from ..db import get_db
from ..openrouter import OpenRouterError
from ..routers.anexos import EXTENSAO_PARA_CONTENT_TYPE, UPLOADS_DIR
from ..util import hoje, validar_competencia, gerar_lancamentos_fixos

router = APIRouter(prefix="/ia", tags=["ia"])


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


@router.post("/perguntar")
def perguntar(body: PerguntarIn, db: sqlite3.Connection = Depends(get_db)):
    h = hoje()
    comp = f"{h.year:04d}-{h.month:02d}"
    contexto = f"Hoje: {h.isoformat()}.\n" + _contexto_financeiro(db, comp)
    try:
        return {"resposta": openrouter.perguntar(db, body.pergunta, contexto)}
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
