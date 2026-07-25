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
from pathlib import Path

router = APIRouter(prefix="/ia", tags=["ia"])


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
