import calendar
import re
import sqlite3
import unicodedata
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import AfterValidator

TZ = ZoneInfo("America/Sao_Paulo")
RE_COMPETENCIA = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
RE_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def hoje() -> date:
    return datetime.now(TZ).date()


def agora_iso() -> str:
    """Data e hora no fuso do app, 'YYYY-MM-DD HH:MM:SS'.

    Não use CURRENT_TIMESTAMP do SQLite para carimbo que o usuário vai LER: ele
    é UTC, e mostraria 3h à frente do relógio de quem registrou o saldo.
    """
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")


def vencimento(competencia: str, dia: int) -> str:
    """Data de vencimento na competência; dia 31 num mês curto cai no último dia."""
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    ultimo = calendar.monthrange(ano, mes)[1]
    return f"{ano:04d}-{mes:02d}-{min(dia, ultimo):02d}"


def competencia_de(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def somar_meses(competencia: str, n: int) -> str:
    """Competência deslocada em n meses (n pode ser negativo)."""
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    total = (ano * 12 + mes - 1) + n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def normalizar_busca(texto: str | None) -> str | None:
    """Texto reduzido a minúsculas SEM acento, para comparar em busca.

    Existe porque o LIKE do SQLite só dobra caixa em ASCII: letra acentuada nunca
    casa com sua versão em outra caixa, e a busca falhava em silêncio — 'água'
    não encontrava "Água mineral", 'FARMÁCIA' não encontrava "Farmácia". Numa
    base em português isso atinge quase tudo (mercado, cartão, alimentação).

    Tirar o acento junto é de propósito, não efeito colateral: quem digita
    'agua' ou 'farmacia' com pressa espera achar do mesmo jeito.
    """
    if texto is None:
        return None
    # NFD separa a letra do acento; a categoria 'Mn' são exatamente os acentos.
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )
    return sem_acento.casefold()


def brl(cents: int) -> str:
    return f"R$ {cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def validar_competencia(competencia: str) -> None:
    if not RE_COMPETENCIA.match(competencia):
        raise ValueError("Competência deve estar no formato YYYY-MM")


def validar_data(valor: str) -> str:
    """Aceita só 'YYYY-MM-DD' de calendário; devolve a própria string.

    O regex vem ANTES do parse porque `date.fromisoformat` (Python ≥3.11) também
    aceita "20260815", "2026-W33-1" e afins — e é a string CRUA que vai para o
    banco, onde todo recorte mensal é por prefixo ('YYYY-MM'). Uma data em outro
    formato entra sem erro e some do dashboard, das análises, dos orçamentos e
    dos lembretes, continuando a somar nos totais sem filtro: dinheiro fantasma.
    O parse, depois, é o que barra "2026-13-45", que tem o formato mas não existe.
    """
    if not RE_DATA.match(valor) or not _e_data_real(valor):
        raise ValueError(f"Data deve estar no formato YYYY-MM-DD (recebido: {valor!r})")
    return valor


def _e_data_real(valor: str) -> bool:
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True


# Tipo de campo para toda data que é gravada: a validação acontece no schema, e
# não em cada endpoint — que é como as datas de `/variaveis` e `/entradas` ficaram
# sem checagem enquanto `/variaveis/parcelado` tinha a sua.
DataISO = Annotated[str, AfterValidator(validar_data)]


def _data_de_filtro(valor: str | None) -> str | None:
    """Como DataISO, mas string vazia é 'sem filtro' — não erro.

    Um `<input type=date>` em branco manda `de=`, e isso sempre significou "não
    recorte por data". Só o que NÃO é vazio precisa ser uma data de verdade.
    """
    if not valor:
        return None
    return validar_data(valor)


# Para os parâmetros `de`/`ate` das listagens: sem validação, uma data em outro
# formato não filtrava nada — comparada como texto, '15/08/2026' < '2026-...',
# o WHERE ficava sempre verdadeiro e a lista voltava inteira parecendo filtrada.
DataFiltro = Annotated[str | None, AfterValidator(_data_de_filtro)]


def gerar_lancamentos_fixos(db: sqlite3.Connection, competencia: str) -> None:
    """Geração on-access, idempotente: cria os lançamentos da competência
    para toda conta fixa ativa que ainda não os tenha."""
    db.execute(
        """
        INSERT OR IGNORE INTO lancamentos_fixos (conta_fixa_id, competencia, valor_cents)
        SELECT id, ?, valor_estimado_cents FROM contas_fixas WHERE ativa = 1
        """,
        (competencia,),
    )


def status_lancamento(data_pagamento: str | None, data_vencimento: str) -> str:
    if data_pagamento:
        return "pago"
    return "atrasado" if hoje().isoformat() > data_vencimento else "pendente"


# Tabelas que suportam edição condicional. Lista fechada porque o nome entra no
# SQL por interpolação — nunca pode vir de fora.
TABELAS_VERSIONADAS = frozenset({"compromissos", "contas_fixas", "contas_bancarias"})


class ConflitoDeVersao(Exception):
    """A linha mudou entre a leitura do cliente e este PATCH."""

    def __init__(self, atual: int | None):
        self.atual = atual
        super().__init__("A linha foi alterada por outro aparelho")


def conferir_versao(db: sqlite3.Connection, tabela: str, id_: int, if_match: str | None) -> None:
    """Barra o PATCH quando a linha mudou desde que o cliente a leu.

    Sem isto todo PATCH era last-write-wins SILENCIOSO: dois aparelhos editando
    o mesmo item, o último a salvar apagava o outro e ninguém era avisado — e a
    coluna `atualizado_em`, carimbada em toda escrita, nunca era lida. Ela é a
    versão que já existia; só faltava conferi-la.

    `if_match` ausente passa direto, de propósito: é como o HTTP define
    (precondição opcional) e o que permite adotar tela a tela sem quebrar o que
    ainda não manda o cabeçalho.
    """
    if if_match is None:
        return
    if tabela not in TABELAS_VERSIONADAS:
        raise ValueError(f"tabela não versionada: {tabela}")
    row = db.execute(f"SELECT versao FROM {tabela} WHERE id = ?", (id_,)).fetchone()
    if row is None:
        return  # inexistente é 404 de quem chamou, não conflito
    if str(row["versao"]) != str(if_match).strip():
        raise ConflitoDeVersao(row["versao"])
