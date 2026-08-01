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
URL_OPENAI = "https://api.openai.com/v1/chat/completions"
MODELO_PADRAO = "anthropic/claude-sonnet-4.5"
MODELO_PADRAO_OPENAI = "gpt-4o"  # multimodal; usado quando a chave é da OpenAI
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
        raise OpenRouterError("Chave de IA não configurada (OpenRouter ou OpenAI)")
    # Detecção por prefixo: sk-or-… é OpenRouter; qualquer outra sk-… é tratada como
    # chave da OpenAI (mesma API chat/completions, endpoint e nomes de modelo próprios).
    if chave.startswith("sk-or-"):
        url, provedor, modelo = URL, "OpenRouter", modelo_preferido(db)
    else:
        url, provedor, modelo = URL_OPENAI, "OpenAI", modelo_preferido(db)
        if "/" in modelo:  # nome no formato do OpenRouter ("anthropic/…") não existe na OpenAI
            modelo = MODELO_PADRAO_OPENAI
    corpo: dict = {"model": modelo, "messages": mensagens, "max_tokens": max_tokens}
    if espera_json:
        corpo["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {chave}", "Content-Type": "application/json"}

    ultimo_erro = ""
    for tentativa in range(TENTATIVAS):
        try:
            resp = httpx.post(url, headers=headers, json=corpo, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            ultimo_erro = f"Falha de rede ao chamar {provedor}: {e}"
        else:
            if resp.status_code == 200:
                dados = resp.json()
                try:
                    return dados["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as e:
                    raise OpenRouterError(f"Resposta inesperada do {provedor}: {dados}") from e
            ultimo_erro = f"{provedor} retornou {resp.status_code}: {resp.text[:300]}"
            if resp.status_code not in STATUS_RETENTAVEL:
                break  # 401/400 etc. não adianta repetir
        if tentativa < TENTATIVAS - 1:
            time.sleep(0.6 * (2 ** tentativa))  # backoff: 0.6s, 1.2s
    raise OpenRouterError(ultimo_erro or f"Falha ao chamar {provedor}")


def chamar_json(db: sqlite3.Connection, mensagens: list[dict], max_tokens: int = 1500) -> dict:
    return extrair_json(chamar(db, mensagens, espera_json=True, max_tokens=max_tokens))


def extrair_de_anexo(
    db: sqlite3.Connection, conteudo: bytes, mime: str, tipo: str, categorias: list[str] | None = None
) -> dict:
    """Pede ao modelo multimodal os campos de um boleto/comprovante."""
    cats = ", ".join(f'"{c}"' for c in (categorias or []))
    instrucao = (
        "Você extrai dados de boletos, notas fiscais, recibos e comprovantes brasileiros. "
        "Responda SOMENTE com um objeto JSON com as chaves: "
        "tipo ('variavel' para gasto/compra/pagamento avulso, 'entrada' para valor recebido, "
        "'fixa' para boleto de conta recorrente como luz/água/internet/aluguel/assinatura, ou null); "
        "descricao (texto curto e útil, ex: 'Supermercado Zaffari'); fornecedor (texto ou null); "
        "valor_cents (inteiro, valor em centavos, ex: 1200 para R$ 12,00); "
        "data (YYYY-MM-DD — data do pagamento ou emissão — ou null); "
        "vencimento (YYYY-MM-DD ou null); "
        "forma_pagamento ('pix', 'credito', 'debito', 'dinheiro', 'boleto' ou null); "
        + (f"categoria (a mais adequada dentre: {cats}; ou null); " if cats else "")
        + "confianca (0 a 1, sua confiança na extração). Use null quando não encontrar o campo."
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


def extrair_itens_de_anexo(
    db: sqlite3.Connection, conteudo: bytes, mime: str, tipo: str, categorias: list[str] | None = None
) -> dict:
    """Extrai os lançamentos individuais de um documento com vários itens
    (fatura de cartão, extrato, nota de supermercado)."""
    cats = ", ".join(f'"{c}"' for c in (categorias or []))
    instrucao = (
        "Você extrai TODOS os lançamentos individuais de documentos financeiros brasileiros "
        "(faturas de cartão de crédito, extratos bancários, notas com vários itens). "
        "Responda SOMENTE com um objeto JSON com as chaves: "
        "fornecedor (emissor do documento, ou null); "
        "total_cents (total do documento em centavos, ou null); "
        '"itens": lista de objetos {descricao (texto curto), valor_cents (inteiro, centavos), '
        "data (YYYY-MM-DD ou null; se o documento não trouxer o ano, deduza pelo período/vencimento)"
        + (f", categoria (a mais adequada dentre: {cats}; ou null)" if cats else "")
        + "}; confianca (0 a 1). "
        "Liste apenas cobranças/gastos: ignore pagamentos recebidos, créditos e estornos. "
        "Não invente itens; se o documento tiver um único valor, retorne um único item."
    )
    if tipo == "pdf":
        parte = {"type": "file", "file": {"filename": "anexo.pdf", "file_data": _data_url(conteudo, mime)}}
    else:
        parte = {"type": "image_url", "image_url": {"url": _data_url(conteudo, mime)}}
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": [{"type": "text", "text": "Extraia os lançamentos deste documento."}, parte]},
    ]
    return chamar_json(db, mensagens, max_tokens=6000)


def gerar_insights(db: sqlite3.Connection, contexto: str) -> dict:
    """Insights estruturados do mês, com base no contexto financeiro completo."""
    instrucao = (
        "Você é um consultor financeiro pessoal, direto e prático. Analise o contexto "
        "financeiro completo (meses recentes, contas fixas, entradas recorrentes e metas; "
        "valores em reais) e responda SOMENTE com um objeto JSON: "
        '{"destaques": [str, ...], "alertas": [str, ...], "acoes": [str, ...], "sugestao": str}. '
        "destaques = 2 a 4 observações sobre tendências e categorias que mais pesaram "
        "vs. meses anteriores; alertas = 0 a 3 pontos de atenção (gastos subindo, saldo "
        "negativo, meta em risco); acoes = 2 a 3 ações concretas de economia ou renda, cada "
        "uma com valor estimado em R$ (ex: 'Reduzir alimentação fora de R$ 320 para R$ 200 "
        "libera R$ 120/mês'); sugestao = UMA recomendação principal. Frases curtas, sem "
        "repetir os números crus linha a linha, sem markdown."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": contexto},
    ]
    return chamar_json(db, mensagens, max_tokens=900)


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


def estrategia_meta(db: sqlite3.Connection, meta: dict, contexto: str) -> str:
    """Análise do contexto financeiro completo + plano concreto para atingir a meta."""
    instrucao = (
        "Você é um consultor financeiro pessoal, direto e realista. Analise o contexto "
        "financeiro completo (entradas, contas fixas, gastos variáveis por categoria e outras "
        "metas) e escreva um plano para atingir a meta no prazo. Sem markdown e sem preâmbulo; "
        "responda em linhas curtas, uma por tópico, neste formato:\n"
        "Diagnóstico: a sobra mensal real (entradas − fixas − variáveis) e se a meta cabe nela.\n"
        "Onde economizar: 2 a 4 cortes específicos por categoria, cada um com valor em R$ "
        "realista (reduções parciais; nunca mande zerar itens essenciais como saúde ou alimentação).\n"
        "Renda extra: se os cortes não fecharem a conta, quanto falta ganhar a mais por mês em R$ "
        "e uma sugestão concreta de como.\n"
        "Aporte mensal: o valor recomendado guardar por mês.\n"
        "Primeiro passo: uma ação executável ainda esta semana.\n"
        "Se a meta for inviável no prazo mesmo com cortes e renda extra plausíveis, diga isso com "
        "franqueza e proponha um prazo ou valor alternativo que feche a conta."
    )
    ctx = (
        f"Meta em análise: {meta['nome']} — objetivo R$ {meta['valor_total_cents']/100:.2f}, "
        f"já guardado R$ {meta['valor_atual_cents']/100:.2f}, prazo {meta['prazo']}, "
        f"aporte necessário ~R$ {meta['valor_mensal_necessario_cents']/100:.2f}/mês.\n\n"
        f"Contexto financeiro:\n{contexto}"
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": ctx},
    ]
    return chamar(db, mensagens, espera_json=False, max_tokens=800).strip()


def planejar_meta(db: sqlite3.Connection, meta: dict, itens: list[dict], contexto: str) -> dict:
    """Quebra a meta em itens de planejamento com valores estimados + análise do plano."""
    instrucao = (
        "Você é um consultor financeiro pessoal que ajuda a PLANEJAR uma meta, quebrando-a "
        "em itens concretos (ex.: viagem → passagens, hospedagem, transporte, alimentação, "
        "passeios, reserva de imprevistos). Responda SOMENTE com um objeto JSON: "
        '{"itens": [{"nome": str, "valor_cents": int, "descricao": str}, ...], "analise": str}. '
        "itens = 3 a 7 sugestões NOVAS (nunca repita itens que o usuário já tem), com valores "
        "realistas em centavos de real para o Brasil e descricao curta com opções/dicas "
        "práticas de como cotar ou economizar naquele item. "
        "analise = 2 a 4 frases: a soma do plano (itens existentes + sugeridos) versus o "
        "objetivo da meta — se estoura, diga onde apertar; se sobra, diga o que reforçar; "
        "considere o contexto financeiro para dizer se o plano cabe na realidade da pessoa. "
        "Sem markdown na analise."
    )
    existentes = "; ".join(
        f"{i['nome']} R$ {i['valor_cents']/100:.2f}" + (f" ({i['descricao']})" if i.get("descricao") else "")
        for i in itens
    ) or "nenhum"
    ctx = (
        f"Meta: {meta['nome']} — objetivo R$ {meta['valor_total_cents']/100:.2f}, "
        f"prazo {meta['prazo']}, já guardado R$ {meta['valor_atual_cents']/100:.2f}.\n"
        f"Itens já planejados: {existentes}.\n\nContexto financeiro:\n{contexto}"
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": ctx},
    ]
    return chamar_json(db, mensagens, max_tokens=1200)


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
        "em reais). Pode fazer contas simples a partir desses números (somas, médias, "
        "projeções lineares), explicitando a conta quando o resultado não for óbvio. Se o dado "
        "não estiver no contexto e não puder ser derivado dele, diga que não tem essa "
        "informação. Não invente números. Sem markdown."
    )
    mensagens = [
        {"role": "system", "content": instrucao},
        {"role": "user", "content": f"Contexto (dados reais):\n{contexto}\n\nPergunta: {pergunta}"},
    ]
    return chamar(db, mensagens, espera_json=False, max_tokens=700).strip()
