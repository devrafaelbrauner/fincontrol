"""Geração do feed iCalendar (.ics) — vencimentos de contas fixas e prazos de metas.

Datas são eventos de dia inteiro (VALUE=DATE) no fuso America/Sao_Paulo. O feed é
somente-leitura e público (protegido por token secreto na URL), então nunca inclui
valores sensíveis além do necessário para o lembrete.
"""

import sqlite3
from datetime import date, datetime, timedelta

from .util import TZ, brl as _brl, hoje, vencimento

MESES_A_FRENTE = 6  # janela de vencimentos futuros exposta no feed


def _escape(texto: str) -> str:
    # RFC 5545 §3.3.11: escapar \ ; , e quebras de linha em valores de texto.
    return texto.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _dobrar_linha(linha: str) -> str:
    # RFC 5545 §3.1: linhas com mais de 75 octetos são dobradas com CRLF + espaço.
    if len(linha.encode("utf-8")) <= 75:
        return linha
    partes, atual = [], ""
    for ch in linha:
        if len((atual + ch).encode("utf-8")) > 74:
            partes.append(atual)
            atual = " " + ch
        else:
            atual += ch
    partes.append(atual)
    return "\r\n".join(partes)


def _competencias(hoje_: date) -> list[str]:
    out = []
    ano, mes = hoje_.year, hoje_.month
    for _ in range(MESES_A_FRENTE + 1):
        out.append(f"{ano:04d}-{mes:02d}")
        mes += 1
        if mes > 12:
            mes, ano = 1, ano + 1
    return out


def _evento(uid: str, dt: str, dtstamp: str, resumo: str, descricao: str, alarme_dias: int | None) -> list[str]:
    ini = dt.replace("-", "")
    fim = (date.fromisoformat(dt) + timedelta(days=1)).isoformat().replace("-", "")
    linhas = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{ini}",
        f"DTEND;VALUE=DATE:{fim}",
        f"SUMMARY:{_escape(resumo)}",
        f"DESCRIPTION:{_escape(descricao)}",
    ]
    if alarme_dias is not None and alarme_dias > 0:
        linhas += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_escape(resumo)}",
            f"TRIGGER:-P{alarme_dias}D",
            "END:VALARM",
        ]
    linhas.append("END:VEVENT")
    return linhas


def gerar_feed(db: sqlite3.Connection) -> str:
    hoje_ = hoje()
    dtstamp = datetime.now(TZ).strftime("%Y%m%dT%H%M%SZ")
    linhas = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//FinControl//PT-BR//",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:FinControl",
        "X-WR-TIMEZONE:America/Sao_Paulo",
    ]

    comps = _competencias(hoje_)
    pagos = {
        (r["conta_fixa_id"], r["competencia"])
        for r in db.execute(
            f"SELECT conta_fixa_id, competencia FROM lancamentos_fixos "
            f"WHERE data_pagamento IS NOT NULL AND competencia IN ({','.join('?' * len(comps))})",
            comps,
        )
    }

    contas = db.execute(
        "SELECT id, nome, valor_estimado_cents, dia_vencimento, lembrete_dias_antes "
        "FROM contas_fixas WHERE ativa = 1"
    ).fetchall()
    for c in contas:
        for comp in comps:
            venc = vencimento(comp, c["dia_vencimento"])
            pago = (c["id"], comp) in pagos
            marca = "✅ " if pago else ""
            resumo = f"{marca}{c['nome']} — {_brl(c['valor_estimado_cents'])}"
            descricao = f"Vencimento de conta fixa ({'pago' if pago else 'a pagar'})."
            linhas += _evento(
                uid=f"fixa-{c['id']}-{comp}@fincontrol",
                dt=venc,
                dtstamp=dtstamp,
                resumo=resumo,
                descricao=descricao,
                alarme_dias=None if pago else c["lembrete_dias_antes"],
            )

    metas = db.execute("SELECT id, nome, prazo, valor_total_cents FROM metas WHERE ativa = 1").fetchall()
    for m in metas:
        try:
            date.fromisoformat(m["prazo"])
        except ValueError:
            continue
        linhas += _evento(
            uid=f"meta-{m['id']}@fincontrol",
            dt=m["prazo"],
            dtstamp=dtstamp,
            resumo=f"🎯 Prazo da meta: {m['nome']} — {_brl(m['valor_total_cents'])}",
            descricao="Prazo final da meta financeira.",
            alarme_dias=7,
        )

    # Compromissos em aberto: uma obrigação pontual com prazo é exatamente o que
    # um calendário serve para lembrar. Quitado não vira evento — o prazo deixou
    # de existir, e mantê-lo poluiria a agenda com o que já foi resolvido.
    compromissos = db.execute(
        """SELECT c.id, c.nome, c.credor, c.data_limite, c.lembrete_dias_antes,
                  c.valor_total_cents - COALESCE(SUM(l.valor_cents), 0) AS falta_cents
           FROM compromissos c
           LEFT JOIN lancamentos_variaveis l ON l.compromisso_id = c.id
           WHERE c.ativo = 1
           GROUP BY c.id
           HAVING falta_cents > 0"""
    ).fetchall()
    for c in compromissos:
        try:
            date.fromisoformat(c["data_limite"])
        except ValueError:
            continue
        de = f" ({c['credor']})" if c["credor"] else ""
        linhas += _evento(
            uid=f"compromisso-{c['id']}@fincontrol",
            dt=c["data_limite"],
            dtstamp=dtstamp,
            resumo=f"💠 {c['nome']}{de} — {_brl(c['falta_cents'])}",
            descricao="Compromisso financeiro a quitar.",
            alarme_dias=c["lembrete_dias_antes"],
        )

    linhas.append("END:VCALENDAR")
    return "\r\n".join(_dobrar_linha(l) for l in linhas) + "\r\n"
