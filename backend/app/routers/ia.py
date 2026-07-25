"""Configuração do OpenRouter e recursos de IA (extração de anexo, categorização).

A chave do OpenRouter é criptografada (Fernet) ao salvar e nunca volta ao frontend
— só o status "configurada". Todas as chamadas de IA passam pelo backend.
"""

import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import openrouter
from ..cripto import criptografar
from ..db import get_db
from ..openrouter import OpenRouterError
from ..routers.anexos import EXTENSAO_PARA_CONTENT_TYPE, UPLOADS_DIR
from ..util import gerar_lancamentos_fixos, validar_competencia
from pathlib import Path

router = APIRouter(prefix="/ia", tags=["ia"])


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
        """SELECT COALESCE(c.nome, 'sem categoria') nome, SUM(v.valor_cents) t
           FROM lancamentos_variaveis v LEFT JOIN categorias c ON c.id = v.categoria_id
           WHERE v.data LIKE ? GROUP BY c.nome ORDER BY t DESC LIMIT 5""",
        (prefixo,),
    ).fetchall()
    reais = lambda c: f"R$ {c/100:.2f}"
    linhas = [
        f"Mês {competencia}: entradas {reais(entradas)}, contas fixas {reais(fixas)}, "
        f"gastos variáveis {reais(variaveis)}, saldo {reais(entradas - fixas - variaveis)}."
    ]
    if por_cat:
        cats = "; ".join(f"{r['nome']} {reais(r['t'])}" for r in por_cat)
        linhas.append(f"  Top categorias variáveis: {cats}.")
    return "\n".join(linhas)


class ConfigIn(BaseModel):
    api_key: str | None = None
    modelo: str | None = None


class CategorizarIn(BaseModel):
    descricao: str


def _set_config(db: sqlite3.Connection, chave: str, valor: str) -> None:
    db.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )


@router.get("/config")
def ver_config(db: sqlite3.Connection = Depends(get_db)):
    return {
        "configurada": openrouter.api_key(db) is not None,
        "modelo": openrouter.modelo_preferido(db),
    }


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


@router.post("/extrair/{anexo_id}")
def extrair(anexo_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT * FROM anexos WHERE id = ?", (anexo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Anexo não encontrado")
    caminho = UPLOADS_DIR / row["caminho_arquivo"]
    if not caminho.exists():
        raise HTTPException(404, "Arquivo não encontrado no disco")
    mime = EXTENSAO_PARA_CONTENT_TYPE.get(Path(row["caminho_arquivo"]).suffix, "application/octet-stream")
    try:
        dados = openrouter.extrair_de_anexo(db, caminho.read_bytes(), mime, row["tipo"])
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    db.execute(
        "UPDATE anexos SET extraido_por_ia = 1, dados_extraidos_json = ? WHERE id = ?",
        (json.dumps(dados, ensure_ascii=False), anexo_id),
    )
    return dados


@router.post("/insights/{competencia}")
def insights(competencia: str, db: sqlite3.Connection = Depends(get_db)):
    try:
        validar_competencia(competencia)
    except ValueError as e:
        raise HTTPException(400, str(e))
    resumo = "\n".join(_resumo_mes(db, c) for c in _competencias_anteriores(competencia, 3))
    try:
        texto = openrouter.gerar_insights(db, resumo)
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    return {"insights": texto}


@router.post("/categorizar")
def categorizar(body: CategorizarIn, db: sqlite3.Connection = Depends(get_db)):
    categorias = [r["nome"] for r in db.execute("SELECT nome FROM categorias WHERE ativa = 1")]
    if not categorias:
        return {"categoria": None}
    try:
        escolha = openrouter.categorizar(db, body.descricao, categorias)
    except OpenRouterError as e:
        raise HTTPException(502, str(e))
    return {"categoria": escolha}
