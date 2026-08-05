"""Motor de lembretes — o que faz o Web Push disparar sozinho.

Sem isto, `push.enviar` só era chamado pelo botão "Enviar teste": a PWA sabia
receber notificação, mas nada nunca a mandava. O agendador em `main.py` chama
`enviar_lembretes` uma vez por dia (e no boot, como catch-up).

Dois tipos de aviso:
1. Vencimento de conta fixa em aberto — `lembrete_dias_antes` da conta, no dia do
   vencimento, e uma única vez quando ela passa a estar atrasada.
2. Fechamento do mês (dia 1) — números do mês fechado + insights de IA.

Cada aviso é gravado em `lembretes_enviados` antes de ser considerado entregue. É
essa chave que impede repetição: o job pode rodar N vezes por dia (restart do
backend, chamada manual) sem notificar duas vezes a mesma coisa.
"""

import asyncio
import json
import logging
import os
import sqlite3
from datetime import date, datetime, timedelta

from .db import connect
from .util import TZ, brl, competencia_de, hoje, somar_meses, vencimento

_log = logging.getLogger("uvicorn.error")


def _hora_configurada() -> int:
    bruto = os.environ.get("FINCONTROL_LEMBRETE_HORA", "8")
    try:
        hora = int(bruto)
    except ValueError:
        hora = -1
    if not 0 <= hora <= 23:
        _log.warning("FINCONTROL_LEMBRETE_HORA inválida (%r); usando 8h.", bruto)
        return 8
    return hora


HORA_PADRAO = _hora_configurada()  # hora local (America/Sao_Paulo) do job diário

# Atraso mais antigo que isto não vira notificação: um banco restaurado com meses
# de contas em aberto encheria a tela de avisos sobre coisas já resolvidas.
DIAS_ATRASO_MAX = 60

# Janela em que o resumo do mês fechado ainda pode ser enviado — cobre o backend
# ter ficado fora do ar no dia 1, sem que uma instalação nova no dia 20 dispare
# (e pague uma chamada de IA por) o resumo de um mês que o app nem acompanhou.
DIA_LIMITE_RESUMO = 5

MESES_PT = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]


# ---------- quais avisos são devidos hoje ----------

def pendencias(db: sqlite3.Connection, hoje_: date | None = None) -> list[dict]:
    """Avisos de conta fixa devidos hoje, ignorando o que já foi enviado.

    **Só lê.** Projeta os vencimentos a partir de `contas_fixas` e usa
    `lancamentos_fixos` apenas para saber o que já foi pago (ou teve o valor
    editado) — o mesmo caminho do feed .ics. Materializar os meses à frente aqui
    congelaria o `valor_estimado_cents` do dia da geração: aumentar o aluguel em
    agosto não apareceria em setembro, porque a linha já existiria com o valor
    velho. E daria efeito colateral de escrita a um GET.
    """
    hoje_ = hoje_ or hoje()
    atual = competencia_de(hoje_)

    # Janela: mês anterior (atraso que atravessou a virada) até o suficiente para
    # a conta de maior antecedência ser vista a tempo.
    maior_antes = db.execute(
        "SELECT COALESCE(MAX(lembrete_dias_antes), 0) m FROM contas_fixas WHERE ativa = 1"
    ).fetchone()["m"]
    meses_a_frente = max(1, (maior_antes // 28) + 1)
    comps = [somar_meses(atual, n) for n in range(-1, meses_a_frente + 1)]

    marcadores = {
        (r["conta_fixa_id"], r["competencia"]): r
        for r in db.execute(
            f"""SELECT conta_fixa_id, competencia, valor_cents, data_pagamento
                FROM lancamentos_fixos WHERE competencia IN ({','.join('?' * len(comps))})""",
            comps,
        )
    }
    contas = db.execute(
        "SELECT id, nome, valor_estimado_cents, dia_vencimento, lembrete_dias_antes "
        "FROM contas_fixas WHERE ativa = 1"
    ).fetchall()

    out = []
    for c in contas:
        for comp in comps:
            lanc = marcadores.get((c["id"], comp))
            if lanc and lanc["data_pagamento"]:
                continue
            # Mês já fechado só conta se o app chegou a materializá-lo: sem isto,
            # uma conta cadastrada hoje nasceria "em atraso" no mês passado, que
            # ela nunca teve. Do mês corrente em diante a projeção vale, porque aí
            # a linha faltante é só o app ainda não ter sido aberto no mês.
            if comp < atual and lanc is None:
                continue
            venc = date.fromisoformat(vencimento(comp, c["dia_vencimento"]))
            dias = (venc - hoje_).days
            antes = c["lembrete_dias_antes"] or 0
            if dias == 0:
                tipo = "hoje"
            # `<=` e não `==`: com igualdade, o backend fora do ar exatamente no
            # dia do aviso o perderia para sempre. A chave de dedup é que garante
            # uma vez só, então a janela inteira serve de catch-up.
            elif 0 < dias <= antes:
                tipo = "antes"
            elif -DIAS_ATRASO_MAX <= dias < 0:
                tipo = "atraso"
            else:
                continue
            out.append({
                "chave": f"fixo:{c['id']}:{comp}:{tipo}",
                "tipo": tipo,
                "dias": dias,
                "nome": c["nome"],
                # Valor editado na competência manda; senão, o estimado da conta.
                "valor_cents": lanc["valor_cents"] if lanc else c["valor_estimado_cents"],
                "vencimento": venc.isoformat(),
            })
    out.sort(key=lambda p: (p["vencimento"], p["nome"]))
    return out


def _mensagens(pend: list[dict]) -> list[dict]:
    """Agrupa os avisos em notificações — cinco contas vencendo hoje viram um push,
    não cinco. Atrasos entram num grupo só, mesmo com vencimentos diferentes."""
    grupos: dict[tuple, list[dict]] = {}
    for p in pend:
        grupos.setdefault((p["tipo"], None if p["tipo"] == "atraso" else p["dias"]), []).append(p)

    msgs = []
    for (tipo, dias), itens in sorted(grupos.items(), key=lambda kv: ({"atraso": 0, "hoje": 1, "antes": 2}[kv[0][0]], kv[0][1] or 0)):
        total = sum(i["valor_cents"] for i in itens)
        nomes = ", ".join(i["nome"] for i in itens)
        n = len(itens)
        if tipo == "hoje":
            titulo = "Vence hoje" if n == 1 else f"{n} contas vencem hoje"
        elif tipo == "antes":
            quando = "amanhã" if dias == 1 else f"em {dias} dias"
            titulo = f"Vence {quando}" if n == 1 else f"{n} contas vencem {quando}"
        else:
            titulo = "Conta em atraso" if n == 1 else f"{n} contas em atraso"
        corpo = f"{nomes} — {brl(total)}" if n == 1 else f"{nomes} — {brl(total)} no total"
        msgs.append({"titulo": titulo, "corpo": corpo, "url": "/fixas",
                     "chaves": [i["chave"] for i in itens]})
    return msgs


# ---------- resumo do mês fechado (com insights de IA) ----------

def _totais_do_mes(db: sqlite3.Connection, competencia: str) -> dict:
    prefixo = competencia + "-%"
    um = lambda sql, p: db.execute(sql, p).fetchone()["t"]
    entradas = um("SELECT COALESCE(SUM(valor_cents),0) t FROM entradas WHERE data LIKE ?", (prefixo,))
    fixas = um("SELECT COALESCE(SUM(valor_cents),0) t FROM lancamentos_fixos WHERE competencia = ?", (competencia,))
    variaveis = um("SELECT COALESCE(SUM(valor_cents),0) t FROM lancamentos_variaveis WHERE data LIKE ?", (prefixo,))
    return {"entradas": entradas, "fixas": fixas, "variaveis": variaveis,
            "saldo": entradas - fixas - variaveis}


def _insight_do_mes(db: sqlite3.Connection, competencia: str, gerar: bool = True) -> str | None:
    """Gera (e guarda no cache que o Dashboard lê) os insights do mês fechado.

    Devolve a frase de destaque para o push, ou None se não houver IA configurada
    ou a chamada falhar — o resumo numérico vai assim mesmo.

    `gerar=False` só olha o cache: é o que a prévia usa para mostrar o resumo sem
    pagar uma análise de IA por clique em "Ver lembretes de hoje".
    """
    from . import openrouter  # tardio: evita ciclo com routers.ia e custo de import no boot
    from .routers.ia import _contexto_financeiro

    # Já analisado (pelo Dashboard ou por um envio anterior): reaproveita. Sem isto
    # cada clique em "Enviar agora" pagaria uma análise nova e sobrescreveria a
    # que já estava na tela.
    cache = db.execute(
        "SELECT dados_json FROM insights_cache WHERE competencia = ?", (competencia,)
    ).fetchone()
    if cache:
        return _destaque(json.loads(cache["dados_json"]))

    if not gerar:
        return None
    if not openrouter.api_key(db):
        return None
    # _contexto_financeiro roda a geração on-access de 3 meses, ou seja, ESCREVE.
    # Commitar aqui é o que impede a transação de ficar aberta durante a chamada
    # de rede seguinte: numa requisição HTTP isso é irrelevante (o get_db fecha
    # logo), mas aqui o intervalo é o timeout do OpenRouter vezes as tentativas —
    # até uns 3 minutos em que qualquer outra escrita do app bateria no
    # busy_timeout de 5s e viraria 500.
    contexto = _contexto_financeiro(db, competencia)
    db.commit()
    try:
        dados = openrouter.gerar_insights(db, contexto)
        # O parse fica DENTRO do try: extrair_json promete dict mas devolve o que
        # o json.loads produzir, e um modelo respondendo com lista faria o .get
        # estourar depois da guarda — derrubando o push por causa da IA.
        if not isinstance(dados, dict):
            raise TypeError(f"insights vieram como {type(dados).__name__}, não objeto")
        destaque = _destaque(dados)
    except Exception as e:  # rede, JSON inválido, o que vier: o push não pode falhar por causa da IA
        _log.warning("Resumo mensal: insights de IA falharam (%s). Enviando só os números.", e)
        return None
    db.execute(
        "INSERT INTO insights_cache (competencia, dados_json, criado_em) VALUES (?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(competencia) DO UPDATE SET dados_json = excluded.dados_json, criado_em = CURRENT_TIMESTAMP",
        (competencia, json.dumps(dados, ensure_ascii=False)),
    )
    return destaque


def _destaque(dados: dict) -> str | None:
    """A frase que vai no corpo do push: a sugestão principal, ou o 1º destaque."""
    texto = str(dados.get("sugestao") or "").strip()
    if not texto:
        lista = dados.get("destaques") or dados.get("alertas") or []
        texto = str(lista[0]).strip() if lista else ""
    return texto or None


def _mensagem_resumo(db: sqlite3.Connection, competencia: str, gerar_ia: bool = True) -> dict | None:
    t = _totais_do_mes(db, competencia)
    if not (t["entradas"] or t["fixas"] or t["variaveis"]):
        # Mês sem nenhum movimento (instalação nova, app parado): não há resumo a
        # dar, e gerar insights de IA sobre o nada seria só queimar uma chamada.
        return None
    mes = MESES_PT[int(competencia[5:7]) - 1]
    linhas = [
        f"Saldo {brl(t['saldo'])} · entradas {brl(t['entradas'])} · "
        f"gastos {brl(t['fixas'] + t['variaveis'])}"
    ]
    destaque = _insight_do_mes(db, competencia, gerar=gerar_ia)
    if destaque:
        linhas.append(destaque)
    return {"titulo": f"Resumo de {mes} de {competencia[:4]}", "corpo": "\n".join(linhas),
            "url": "/", "chaves": [f"resumo:{competencia}"]}


# ---------- orçamentos estourados ----------

# Percentual a partir do qual o job avisa que o orçamento está acabando. Espelha
# o âmbar que Dashboard e Análises já pintam em `pct >= 80`: avisar só aos 100%
# chega tarde demais para "mudar comportamento", que é o que a migration 009 diz
# que orçamento existe para fazer.
PCT_AVISO = 80


def orcamentos_em_alerta(db: sqlite3.Connection, hoje_: date | None = None) -> list[dict]:
    """Categorias cujo gasto variável chegou perto do limite do orçamento (ou passou).

    Conta só o que JÁ SAIU até hoje (`ate` em gastos_do_mes): parcela de compra
    em N× é gravada com a data do mês dela, então sem o corte o job anunciaria
    estouro no dia 5 por dinheiro que só sai no dia 20. A barra na tela continua
    contando o mês inteiro — lá a parcela futura conta mesmo.

    Olha o mês corrente e, nos primeiros dias (mesma janela do resumo mensal),
    também o anterior: um gasto na noite do dia 31 — ou lançado retroativamente
    na virada — estouraria um mês que o job das 8h nunca mais olharia.
    """
    from .routers.orcamentos import gastos_do_mes

    hoje_ = hoje_ or hoje()
    atual = competencia_de(hoje_)
    comps = [atual]
    if hoje_.day <= DIA_LIMITE_RESUMO:
        comps.append(somar_meses(atual, -1))

    # Fora do laço: os limites são os mesmos para toda competência olhada.
    limites = db.execute(
        "SELECT o.categoria_id, o.limite_cents, c.nome FROM orcamentos o "
        "JOIN categorias c ON c.id = o.categoria_id ORDER BY c.nome"
    ).fetchall()

    out = []
    for comp in comps:
        gastos = gastos_do_mes(db, comp, ate=hoje_.isoformat())
        for r in limites:
            gasto = gastos.get(r["categoria_id"], 0)
            if gasto * 100 < PCT_AVISO * r["limite_cents"]:
                continue
            nivel = "estouro" if gasto >= r["limite_cents"] else "aviso"
            out.append({
                # Uma chave por nível×categoria×mês. Chegar aos 80% e depois
                # estourar rende dois pushes — que é justamente o ponto de ter
                # os dois níveis. Já subir o limite depois do aviso e estourar
                # de novo no MESMO mês não gera segundo push; o mês seguinte
                # recomeça do zero.
                "chave": f"orcamento{'' if nivel == 'estouro' else '-aviso'}:{r['categoria_id']}:{comp}",
                "nivel": nivel,
                "competencia": comp,
                "nome": r["nome"],
                "gasto_cents": gasto,
                "limite_cents": r["limite_cents"],
            })
    return out


def _titulo_orcamentos(itens: list[dict], nivel: str) -> str:
    n = len(itens)
    if nivel == "aviso":
        return "Orçamento chegando no limite" if n == 1 else f"{n} orçamentos chegando no limite"
    # Bater na régua não é estourar: com gasto == limite o corpo diz
    # "R$ 500,00 de R$ 500,00", que sob o título de estouro soa como erro.
    if all(i["gasto_cents"] == i["limite_cents"] for i in itens):
        return "Orçamento no limite" if n == 1 else f"{n} orçamentos no limite"
    return "Orçamento estourado" if n == 1 else f"{n} orçamentos estourados"


def _mensagens_orcamentos(alertas: list[dict], atual: str) -> list[dict]:
    """Uma notificação por nível — juntar "chegando no limite" com "estourado"
    num push só faria o título mentir sobre metade dos itens. Estouro primeiro:
    é o que o usuário precisa ler antes."""
    msgs = []
    for nivel in ("estouro", "aviso"):
        itens = [a for a in alertas if a["nivel"] == nivel]
        if not itens:
            continue
        corpo = " · ".join(
            f"{e['nome']}: {brl(e['gasto_cents'])} de {brl(e['limite_cents'])}"
            # Alerta pego na janela de catch-up é de OUTRO mês — sem o rótulo, o
            # aviso no dia 2 pareceria falar do mês que acabou de começar.
            + (f" ({MESES_PT[int(e['competencia'][5:7]) - 1]})" if e["competencia"] != atual else "")
            for e in itens
        )
        msgs.append({"titulo": _titulo_orcamentos(itens, nivel), "corpo": corpo,
                     "url": "/analises", "chaves": [e["chave"] for e in itens]})
    return msgs


# ---------- compromissos a vencer ----------

def _comprometido_no_mes(db: sqlite3.Connection, competencia: str, exceto_id: int) -> int:
    """Contas fixas + outros compromissos em aberto que vencem na competência.

    Isto é o "alerta de conflito", e ele NÃO é um push próprio de propósito: vira
    uma frase no aviso do compromisso. Um push separado precisaria de um limiar
    ("pesado" a partir de quanto?) que nada no app sabe calibrar, e erraria para
    os dois lados. Como contexto na mensagem que já ia sair, informa sem inventar
    régua nem custar uma notificação a mais.
    """
    fixas = db.execute(
        "SELECT COALESCE(SUM(valor_estimado_cents), 0) t FROM contas_fixas WHERE ativa = 1"
    ).fetchone()["t"]
    outros = db.execute(
        """SELECT COALESCE(SUM(c.valor_total_cents - COALESCE(pago.t, 0)), 0) t
           FROM compromissos c
           LEFT JOIN (SELECT compromisso_id, SUM(valor_cents) t FROM lancamentos_variaveis
                      WHERE compromisso_id IS NOT NULL GROUP BY compromisso_id) pago
             ON pago.compromisso_id = c.id
           WHERE c.ativo = 1 AND c.id != ? AND substr(c.data_limite, 1, 7) = ?
             AND c.valor_total_cents > COALESCE(pago.t, 0)""",
        (exceto_id, competencia),
    ).fetchone()["t"]
    return fixas + outros


def pendencias_compromissos(db: sqlite3.Connection, hoje_: date | None = None) -> list[dict]:
    """Compromissos em aberto que merecem aviso hoje.

    Mesma taxonomia das contas fixas (`antes`/`hoje`/`atraso`) e o mesmo
    DIAS_ATRASO_MAX, para o dono não ter que aprender duas gramáticas de aviso.
    Quitado nunca avisa, mesmo vencido.
    """
    hoje_ = hoje_ or hoje()
    linhas = db.execute(
        """SELECT c.*, COALESCE(SUM(l.valor_cents), 0) AS pago_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.ativo = 1 GROUP BY c.id"""
    ).fetchall()

    out = []
    for c in linhas:
        falta = c["valor_total_cents"] - c["pago_cents"]
        if falta <= 0:
            continue  # quitado
        try:
            venc = date.fromisoformat(c["data_limite"])
        except ValueError:
            continue  # data corrompida não derruba o job inteiro
        dias = (venc - hoje_).days
        antes = c["lembrete_dias_antes"] or 0
        if dias == 0:
            tipo = "hoje"
        elif 0 < dias <= antes:
            tipo = "antes"
        elif -DIAS_ATRASO_MAX <= dias < 0:
            tipo = "atraso"
        else:
            continue
        out.append({
            "chave": f"compromisso:{c['id']}:{tipo}",
            "tipo": tipo,
            "dias": dias,
            "id": c["id"],
            "nome": c["nome"],
            "credor": c["credor"],
            "falta_cents": falta,
            "parcial": c["pago_cents"] > 0,
            "vencimento": c["data_limite"],
            "competencia": c["data_limite"][:7],
        })
    out.sort(key=lambda p: (p["vencimento"], p["nome"]))
    return out


def _mensagens_compromissos(db: sqlite3.Connection, pend: list[dict]) -> list[dict]:
    """Um push por grupo (mesmo tipo e mesmo prazo), com o peso do mês junto."""
    grupos: dict[tuple, list[dict]] = {}
    for p in pend:
        grupos.setdefault((p["tipo"], None if p["tipo"] == "atraso" else p["dias"]), []).append(p)

    msgs = []
    ordem = {"atraso": 0, "hoje": 1, "antes": 2}
    for (tipo, dias), itens in sorted(grupos.items(), key=lambda kv: (ordem[kv[0][0]], kv[0][1] or 0)):
        n = len(itens)
        total = sum(i["falta_cents"] for i in itens)
        if tipo == "hoje":
            titulo = "Compromisso vence hoje" if n == 1 else f"{n} compromissos vencem hoje"
        elif tipo == "antes":
            quando = "amanhã" if dias == 1 else f"em {dias} dias"
            titulo = f"Compromisso vence {quando}" if n == 1 else f"{n} compromissos vencem {quando}"
        else:
            titulo = "Compromisso atrasado" if n == 1 else f"{n} compromissos atrasados"

        partes = []
        for i in itens:
            # "falta" e não o total: com pagamento parcial, anunciar o valor
            # cheio faria o aviso pedir dinheiro que já saiu.
            rotulo = f"{i['nome']}{f' ({i['credor']})' if i['credor'] else ''}"
            partes.append(f"{rotulo}: {'falta ' if i['parcial'] else ''}{brl(i['falta_cents'])}")
        corpo = " · ".join(partes)
        if n > 1:
            corpo += f" — {brl(total)} no total"

        # Peso do mês: só faz sentido quando o grupo é de um mês só.
        comps = {i["competencia"] for i in itens}
        if len(comps) == 1:
            comp = comps.pop()
            outros = _comprometido_no_mes(db, comp, itens[0]["id"] if n == 1 else -1)
            if outros > 0:
                mes = MESES_PT[int(comp[5:7]) - 1]
                corpo += f". {mes.capitalize()} já tem {brl(outros)} em contas fixas e compromissos"
        msgs.append({"titulo": titulo, "corpo": corpo, "url": "/compromissos",
                     "chaves": [i["chave"] for i in itens]})
    return msgs


# ---------- execução ----------

def _ja_enviadas(db: sqlite3.Connection, chaves: list[str]) -> set[str]:
    if not chaves:
        return set()
    rows = db.execute(
        f"SELECT chave FROM lembretes_enviados WHERE chave IN ({','.join('?' * len(chaves))})", chaves
    )
    return {r["chave"] for r in rows}


def enviar_lembretes(db: sqlite3.Connection, hoje_: date | None = None, forcar: bool = False) -> dict:
    """Roda o job do dia. Idempotente: rodar de novo não repete o que já saiu.

    `forcar` ignora o log de enviados (usado pelo botão "Enviar agora" do Config);
    as chaves continuam sendo gravadas.
    """
    from .routers import push  # tardio: push.py também usa este módulo nos endpoints

    hoje_ = hoje_ or hoje()

    # Sem nenhum aparelho inscrito não há o que fazer — e sair aqui evita queimar
    # as chaves de dedup: senão a instalação nova (VAPID configurado, PWA ainda
    # não instalada) perderia o primeiro dia de avisos e o resumo do mês inteiro,
    # depois de pagar a chamada de IA para ninguém ler.
    if not db.execute("SELECT 1 FROM push_subscriptions LIMIT 1").fetchone():
        return {"notificacoes": [], "motivo": "nenhum aparelho inscrito"}

    pend = pendencias(db, hoje_)
    if not forcar:
        vistas = _ja_enviadas(db, [p["chave"] for p in pend])
        pend = [p for p in pend if p["chave"] not in vistas]
    msgs = _mensagens(pend)

    # Compromissos a vencer — mesma dedup por chave dos avisos de conta fixa.
    comp = pendencias_compromissos(db, hoje_)
    if not forcar:
        vistas = _ja_enviadas(db, [p["chave"] for p in comp])
        comp = [p for p in comp if p["chave"] not in vistas]
    msgs.extend(_mensagens_compromissos(db, comp))

    # Orçamentos em alerta (mês corrente + catch-up da virada) — junto do job
    # diário, com a mesma dedup por chave (nível×categoria×mês) dos outros avisos.
    alertas = orcamentos_em_alerta(db, hoje_)
    if not forcar:
        vistas = _ja_enviadas(db, [a["chave"] for a in alertas])
        alertas = [a for a in alertas if a["chave"] not in vistas]
    msgs.extend(_mensagens_orcamentos(alertas, competencia_de(hoje_)))

    # Resumo do mês fechado: no dia 1, ou nos primeiros dias se o backend estava
    # fora do ar na virada. A chamada de IA só acontece aqui, uma vez por mês.
    if hoje_.day <= DIA_LIMITE_RESUMO:
        anterior = somar_meses(competencia_de(hoje_), -1)
        chave = f"resumo:{anterior}"
        if forcar or not _ja_enviadas(db, [chave]):
            resumo = _mensagem_resumo(db, anterior)
            if resumo:
                msgs.append(resumo)
    # Fecha aqui o que o resumo escreveu (insights_cache) para não carregar uma
    # transação de escrita aberta por cima dos envios de rede que vêm a seguir.
    db.commit()

    enviados = []
    for m in msgs:
        # A chave é gravada mesmo se o endpoint de algum aparelho estiver morto:
        # melhor perder um aviso do que repeti-lo todo dia. O commit é por
        # notificação — com um único no fim, uma falha no meio desfaria as chaves
        # de pushes que o celular já tinha exibido, e eles voltariam amanhã.
        n = push.enviar(db, m["titulo"], m["corpo"], m["url"])
        db.executemany("INSERT OR IGNORE INTO lembretes_enviados (chave) VALUES (?)",
                       [(c,) for c in m["chaves"]])
        db.commit()
        enviados.append({"titulo": m["titulo"], "corpo": m["corpo"], "dispositivos": n})
    if enviados:
        _log.info("Lembretes: %d notificação(ões) enviada(s) para %d aparelho(s).",
                  len(enviados), sum(e["dispositivos"] for e in enviados))
    return {"notificacoes": enviados}


# ---------- agendador (uma tarefa asyncio; o processo é único, sem workers) ----------

def agendador_habilitado() -> bool:
    """Sem chaves VAPID não há para quem notificar, e o job vira ruído no log.
    FINCONTROL_AGENDADOR=0 desliga mesmo com push configurado."""
    from .routers import push

    if os.environ.get("FINCONTROL_AGENDADOR", "1") == "0":
        return False
    return push.habilitado()


def _segundos_ate(hora: int, agora: datetime | None = None) -> float:
    agora = agora or datetime.now(TZ)
    alvo = agora.replace(hour=hora, minute=0, second=0, microsecond=0)
    if alvo <= agora:
        alvo += timedelta(days=1)
    return (alvo - agora).total_seconds()


def _rodar_isolado() -> None:
    """Uma execução com conexão própria — a do job não pode ser a de uma requisição."""
    db = connect()
    try:
        enviar_lembretes(db)
    except Exception:
        # O loop diário não pode morrer por causa de um erro num dia.
        _log.exception("Lembretes: execução falhou.")
    finally:
        db.close()


async def agendador() -> None:
    """Roda no boot (catch-up de um dia em que o backend esteve fora) e depois
    todo dia na hora configurada. O trabalho é síncrono (SQLite, pywebpush, IA),
    então vai para uma thread — bloquear o event loop travaria a API inteira."""
    _log.info("Lembretes: agendador ativo (diariamente às %02d:00 %s).", HORA_PADRAO, TZ.key)
    while True:
        await asyncio.to_thread(_rodar_isolado)
        await asyncio.sleep(_segundos_ate(HORA_PADRAO))
