"""Cliente OpenRouter (só o backend fala com ele; a chave nunca vai ao frontend).

Caminho único do MVP: uma chave, múltiplos modelos (inclusive multimodais para ler
PDF/foto). API compatível com OpenAI (chat/completions).
"""

import base64
import json
import re
import sqlite3
import time

import httpx

from .cripto import descriptografar

URL = "https://openrouter.ai/api/v1/chat/completions"
MODELO_PADRAO = "anthropic/claude-sonnet-4.5"
TIMEOUT = 60.0
TENTATIVAS = 3                       # tentativas totais em falhas transitórias
STATUS_RETENTAVEL = {429, 500, 502, 503, 504}


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


def extrair_json(texto: str) -> dict:
    """Parse tolerante: remove cercas ```json e, se preciso, isola o primeiro objeto {...}."""
    limpo = texto.strip()
    limpo = re.sub(r"^```(?:json)?\s*|\s*```$", "", limpo).strip()
    try:
        return json.loads(limpo)
    except json.JSONDecodeError:
        pass
    ini, fim = limpo.find("{"), limpo.rfind("}")
    if ini != -1 and fim > ini:
        try:
            return json.loads(limpo[ini:fim + 1])
        except json.JSONDecodeError:
            pass
    raise OpenRouterError(f"Modelo não retornou JSON válido: {texto[:300]}")


def chamar(db: sqlite3.Connection, mensagens: list[dict], espera_json: bool = True, max_tokens: int = 1500) -> str:
    """Chamada única ao OpenRouter, com retry/backoff em falhas transitórias."""
    chave = api_key(db)
    if not chave:
        raise OpenRouterError("Chave do OpenRouter não configurada")
    corpo: dict = {"model": modelo_preferido(db), "messages": mensagens, "max_tokens": max_tokens}
    if espera_json:
        corpo["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {chave}", "Content-Type": "application/json"}

    ultimo_erro = ""
    for tentativa in range(TENTATIVAS):
        try:
            resp = httpx.post(URL, headers=headers, json=corpo, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            ultimo_erro = f"Falha de rede ao chamar OpenRouter: {e}"
        else:
            if resp.status_code == 200:
                dados = resp.json()
                try:
                    return dados["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as e:
                    raise OpenRouterError(f"Resposta inesperada do OpenRouter: {dados}") from e
            ultimo_erro = f"OpenRouter retornou {resp.status_code}: {resp.text[:300]}"
            if resp.status_code not in STATUS_RETENTAVEL:
                break  # 401/400 etc. não adianta repetir
        if tentativa < TENTATIVAS - 1:
            time.sleep(0.6 * (2 ** tentativa))  # backoff: 0.6s, 1.2s
    raise OpenRouterError(ultimo_erro or "Falha ao chamar OpenRouter")


def chamar_json(db: sqlite3.Connection, mensagens: list[dict], max_tokens: int = 1500) -> dict:
    return extrair_json(chamar(db, mensagens, espera_json=True, max_tokens=max_tokens))


def extrair_de_anexo(db: sqlite3.Connection, conteudo: bytes, mime: str, tipo: str) -> dict:
    """Pede ao modelo multimodal os campos de um boleto/comprovante."""
    instrucao = (
        "Você extrai dados de boletos e comprovantes brasileiros. Responda SOMENTE com um "
        "objeto JSON com as chaves: valor_cents (inteiro, valor em centavos, ex: 1200 para "
        "R$ 12,00), vencimento (YYYY-MM-DD ou null), descricao (texto curto), fornecedor "
        "(texto ou null), confianca (0 a 1, sua confiança na extração). Use null quando não "
        "encontrar o campo."
    )
    if tipo == "pdf":
        parte = {"type": "file", "file": {"filename": "anexo.pdf", "file_data": _data_url(conteudo, mime)}}
    else:
        parte = {"type": "image_url", "image_url": {"url": _data_url(conteudo, mime)}}
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": [{"type": "text", "text": "Extraia os dados deste documento."}, parte]},
    ]
    return chamar_json(db, mensagens)


def gerar_insights(db: sqlite3.Connection, resumo: str) -> dict:
    """Insights estruturados do mês vs. meses anteriores (JSON para render em cards)."""
    instrucao = (
        "Você é um consultor financeiro pessoal, direto e prático. Com base no resumo "
        "(valores em reais), responda SOMENTE com um objeto JSON: "
        '{"destaques": [str, ...], "alertas": [str, ...], "sugestao": str}. '
        "destaques = 2 a 4 observações sobre tendências e categorias que mais pesaram "
        "vs. meses anteriores; alertas = 0 a 3 pontos de atenção (gastos subindo, saldo "
        "negativo); sugestao = UMA recomendação concreta. Frases curtas, sem repetir os "
        "números crus linha a linha, sem markdown."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": resumo},
    ]
    return chamar_json(db, mensagens, max_tokens=800)


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
    try:
        escolha = chamar_json(db, mensagens, max_tokens=100).get("categoria")
    except OpenRouterError:
        return None
    return escolha if escolha in categorias else None


def categorizar_lote(db: sqlite3.Connection, itens: list[dict], categorias: list[str]) -> dict[int, str]:
    """Classifica vários gastos numa passada. itens: [{id, descricao}]. Retorna {id: categoria}."""
    if not itens or not categorias:
        return {}
    instrucao = (
        "Você classifica gastos pessoais em categorias existentes. Receberá uma lista de "
        "itens {id, descricao} e as categorias válidas. Responda SOMENTE com um JSON "
        '{"itens": [{"id": <int>, "categoria": <uma das categorias, ou null>}, ...]} '
        "com uma entrada por item recebido."
    )
    payload = {"categorias": categorias, "itens": [{"id": i["id"], "descricao": i["descricao"]} for i in itens]}
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    dados = chamar_json(db, mensagens, max_tokens=1500)
    validas = set(categorias)
    out: dict[int, str] = {}
    for it in dados.get("itens", []):
        cat = it.get("categoria")
        if isinstance(it.get("id"), int) and cat in validas:
            out[it["id"]] = cat
    return out


def estrategia_meta(db: sqlite3.Connection, meta: dict, resumo_gastos: str) -> str:
    """Plano curto e realista para atingir uma meta, usando os gastos reais recentes."""
    instrucao = (
        "Você é um consultor financeiro pessoal, direto e realista. Escreva uma estratégia "
        "curta (3 a 5 frases, sem markdown, sem preâmbulo) para a pessoa atingir a meta no "
        "prazo, baseada nos gastos reais dos últimos meses: onde cortar, quanto guardar por "
        "mês e um passo concreto."
    )
    ctx = (
        f"Meta: {meta['nome']} — objetivo {meta['valor_total_cents']/100:.2f}, "
        f"já guardado {meta['valor_atual_cents']/100:.2f}, prazo {meta['prazo']}, "
        f"precisa ~{meta['valor_mensal_necessario_cents']/100:.2f}/mês.\n\nGastos recentes:\n{resumo_gastos}"
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": ctx},
    ]
    return chamar(db, mensagens, espera_json=False, max_tokens=400).strip()


def interpretar_transacao(db: sqlite3.Connection, texto: str, hoje: str, categorias: list[str]) -> dict:
    """Linguagem natural → transação estruturada para o usuário confirmar."""
    instrucao = (
        "Você converte uma frase em português numa transação financeira. Hoje é " + hoje + ". "
        "Responda SOMENTE com um JSON: {\"tipo\": \"variavel\"|\"entrada\"|\"fixa\", "
        "\"descricao\": str, \"valor_cents\": int, \"data\": \"YYYY-MM-DD\", "
        "\"forma_pagamento\": \"pix\"|\"credito\"|\"debito\"|\"dinheiro\"|\"boleto\"|null, "
        "\"categoria\": <uma das categorias ou null>, \"dia_vencimento\": <int 1-31 ou null>}. "
        "tipo=variavel para gastos, entrada para receitas, fixa para contas mensais. "
        "Interprete datas relativas (ontem, hoje, dia 5) a partir de hoje. "
        f"Categorias válidas: {', '.join(categorias) or 'nenhuma'}."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": texto},
    ]
    return chamar_json(db, mensagens, max_tokens=300)


def perguntar(db: sqlite3.Connection, pergunta: str, contexto: str) -> str:
    """Assistente: responde sobre as finanças do usuário usando agregados reais como contexto."""
    instrucao = (
        "Você é o assistente financeiro do FinControl. Responda à pergunta da pessoa de forma "
        "curta, clara e em português, usando SOMENTE os dados fornecidos no contexto (valores "
        "em reais). Se o dado não estiver no contexto, diga que não tem essa informação. Não "
        "invente números. Sem markdown."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": f"Contexto (dados reais):\n{contexto}\n\nPergunta: {pergunta}"},
    ]
    return chamar(db, mensagens, espera_json=False, max_tokens=500).strip()
