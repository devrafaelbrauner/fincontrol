"""Cliente OpenRouter (só o backend fala com ele; a chave nunca vai ao frontend).

Caminho único do MVP: uma chave, múltiplos modelos (inclusive multimodais para ler
PDF/foto). API compatível com OpenAI (chat/completions).
"""

import base64
import json
import sqlite3

import httpx

from .cripto import descriptografar

URL = "https://openrouter.ai/api/v1/chat/completions"
MODELO_PADRAO = "anthropic/claude-sonnet-4.5"
TIMEOUT = 60.0


class OpenRouterError(Exception):
    pass


def _config(db: sqlite3.Connection, chave: str) -> str | None:
    row = db.execute("SELECT valor FROM config WHERE chave = ?", (chave,)).fetchone()
    return row["valor"] if row else None


def api_key(db: sqlite3.Connection) -> str | None:
    enc = _config(db, "openrouter_api_key_enc")
    return descriptografar(enc) if enc else None


def modelo_preferido(db: sqlite3.Connection) -> str:
    return _config(db, "modelo_preferido") or MODELO_PADRAO


def _data_url(conteudo: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(conteudo).decode()}"


def chamar(db: sqlite3.Connection, mensagens: list[dict], espera_json: bool = True) -> str:
    chave = api_key(db)
    if not chave:
        raise OpenRouterError("Chave do OpenRouter não configurada")
    corpo: dict = {"model": modelo_preferido(db), "messages": mensagens}
    if espera_json:
        corpo["response_format"] = {"type": "json_object"}
    try:
        resp = httpx.post(
            URL,
            headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"},
            json=corpo,
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise OpenRouterError(f"Falha de rede ao chamar OpenRouter: {e}") from e
    if resp.status_code != 200:
        raise OpenRouterError(f"OpenRouter retornou {resp.status_code}: {resp.text[:300]}")
    dados = resp.json()
    try:
        return dados["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise OpenRouterError(f"Resposta inesperada do OpenRouter: {dados}") from e


def extrair_de_anexo(db: sqlite3.Connection, conteudo: bytes, mime: str, tipo: str) -> dict:
    """Pede ao modelo multimodal os campos de um boleto/comprovante."""
    instrucao = (
        "Você extrai dados de boletos e comprovantes brasileiros. Responda SOMENTE com um "
        "objeto JSON com as chaves: valor_cents (inteiro, valor em centavos, ex: 1200 para "
        "R$ 12,00), vencimento (YYYY-MM-DD ou null), descricao (texto curto), fornecedor "
        "(texto ou null). Use null quando não encontrar o campo."
    )
    if tipo == "pdf":
        parte = {
            "type": "file",
            "file": {"filename": "anexo.pdf", "file_data": _data_url(conteudo, mime)},
        }
    else:
        parte = {"type": "image_url", "image_url": {"url": _data_url(conteudo, mime)}}
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": [
            {"type": "text", "text": "Extraia os dados deste documento."},
            parte,
        ]},
    ]
    texto = chamar(db, mensagens, espera_json=True)
    try:
        return json.loads(texto)
    except json.JSONDecodeError as e:
        raise OpenRouterError(f"Modelo não retornou JSON válido: {texto[:300]}") from e


def categorizar(db: sqlite3.Connection, descricao: str, categorias: list[str]) -> str | None:
    """Sugere uma categoria (dentre as existentes) para uma descrição de gasto."""
    instrucao = (
        "Você classifica gastos pessoais. Dada a descrição e a lista de categorias, "
        "responda SOMENTE com um JSON {\"categoria\": <uma das categorias, ou null>}."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": f"Descrição: {descricao}\nCategorias: {', '.join(categorias)}"},
    ]
    texto = chamar(db, mensagens, espera_json=True)
    try:
        escolha = json.loads(texto).get("categoria")
    except json.JSONDecodeError:
        return None
    return escolha if escolha in categorias else None
