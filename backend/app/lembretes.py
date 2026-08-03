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
from .util import TZ, brl, competencia_de, gerar_lancamentos_fixos, hoje, somar_meses, vencimento

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

    Só olha lançamentos em aberto (`data_pagamento IS NULL`) de conta ativa.
    """
    hoje_ = hoje_ or hoje()
    atual = competencia_de(hoje_)

    # Uma conta com lembrete_dias_antes grande precisa que o lançamento do mês
    # seguinte já exista para ser vista com antecedência — daí a geração à frente
    # (idempotente, é a mesma geração on-access do resto do app).
    maior_antes = db.execute(
        "SELECT COALESCE(MAX(lembrete_dias_antes), 0) m FROM contas_fixas WHERE ativa = 1"
    ).fetchone()["m"]
    meses_a_frente = max(1, (maior_antes // 28) + 1)
    comps = [somar_meses(atual, n) for n in range(0, meses_a_frente + 1)]
    for c in comps:
        gerar_lancamentos_fixos(db, c)
    # O mês anterior entra só para leitura (atraso que atravessou a virada); gerar
    # nele criaria histórico de um mês que o usuário pode nunca ter aberto.
    comps.append(somar_meses(atual, -1))

    linhas = db.execute(
        f"""SELECT l.competencia, l.valor_cents, c.id AS conta_id, c.nome,
                   c.dia_vencimento, c.lembrete_dias_antes
            FROM lancamentos_fixos l JOIN contas_fixas c ON c.id = l.conta_fixa_id
            WHERE l.data_pagamento IS NULL AND c.ativa = 1
              AND l.competencia IN ({','.join('?' * len(comps))})""",
        comps,
    ).fetchall()

    out = []
    for r in linhas:
        venc = date.fromisoformat(vencimento(r["competencia"], r["dia_vencimento"]))
        dias = (venc - hoje_).days
        antes = r["lembrete_dias_antes"] or 0
        if dias == 0:
            tipo = "hoje"
        elif dias > 0 and antes > 0 and dias == antes:
            tipo = "antes"
        elif -DIAS_ATRASO_MAX <= dias < 0:
            tipo = "atraso"
        else:
            continue
        out.append({
            "chave": f"fixo:{r['conta_id']}:{r['competencia']}:{tipo}",
            "tipo": tipo,
            "dias": dias,
            "nome": r["nome"],
            "valor_cents": r["valor_cents"],
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


def _insight_do_mes(db: sqlite3.Connection, competencia: str) -> str | None:
    """Gera (e guarda no cache que o Dashboard lê) os insights do mês fechado.

    Devolve a frase de destaque para o push, ou None se não houver IA configurada
    ou a chamada falhar — o resumo numérico vai assim mesmo.
    """
    from . import openrouter  # tardio: evita ciclo com routers.ia e custo de import no boot
    from .routers.ia import _contexto_financeiro

    if not openrouter.api_key(db):
        return None
    try:
        dados = openrouter.gerar_insights(db, _contexto_financeiro(db, competencia))
    except Exception as e:  # rede, JSON inválido, o que vier: o push não pode falhar por causa da IA
        _log.warning("Resumo mensal: insights de IA falharam (%s). Enviando só os números.", e)
        return None
    db.execute(
        "INSERT INTO insights_cache (competencia, dados_json, criado_em) VALUES (?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(competencia) DO UPDATE SET dados_json = excluded.dados_json, criado_em = CURRENT_TIMESTAMP",
        (competencia, json.dumps(dados, ensure_ascii=False)),
    )
    destaque = str(dados.get("sugestao") or "").strip()
    if not destaque:
        lista = dados.get("destaques") or dados.get("alertas") or []
        destaque = str(lista[0]).strip() if lista else ""
    return destaque or None


def _mensagem_resumo(db: sqlite3.Connection, competencia: str) -> dict | None:
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
    destaque = _insight_do_mes(db, competencia)
    if destaque:
        linhas.append(destaque)
    return {"titulo": f"Resumo de {mes} de {competencia[:4]}", "corpo": "\n".join(linhas),
            "url": "/", "chaves": [f"resumo:{competencia}"]}


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

    `forcar` ignora o log de enviados (usado pelo botão de teste no Config); as
    chaves continuam sendo gravadas.
    """
    from .routers import push  # tardio: push.py também usa este módulo nos endpoints

    hoje_ = hoje_ or hoje()
    pend = pendencias(db, hoje_)
    if not forcar:
        vistas = _ja_enviadas(db, [p["chave"] for p in pend])
        pend = [p for p in pend if p["chave"] not in vistas]
    msgs = _mensagens(pend)

    # Resumo do mês fechado: no dia 1, ou nos primeiros dias se o backend estava
    # fora do ar na virada. A chamada de IA só acontece aqui, uma vez por mês.
    if hoje_.day <= DIA_LIMITE_RESUMO:
        anterior = somar_meses(competencia_de(hoje_), -1)
        chave = f"resumo:{anterior}"
        if forcar or not _ja_enviadas(db, [chave]):
            resumo = _mensagem_resumo(db, anterior)
            if resumo:
                msgs.append(resumo)

    enviados = []
    for m in msgs:
        # A chave é gravada mesmo se nenhum dispositivo receber (ninguém inscrito,
        # endpoint fora do ar): melhor perder um aviso do que repeti-lo todo dia.
        n = push.enviar(db, m["titulo"], m["corpo"], m["url"])
        db.executemany("INSERT OR IGNORE INTO lembretes_enviados (chave) VALUES (?)",
                       [(c,) for c in m["chaves"]])
        enviados.append({"titulo": m["titulo"], "corpo": m["corpo"], "dispositivos": n})
    db.commit()
    if enviados:
        _log.info("Lembretes: %d notificação(ões) enviada(s).", len(enviados))
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
