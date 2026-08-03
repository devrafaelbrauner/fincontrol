/** Transformações puras sobre o retorno de /analises/historico — separadas da
 *  página para serem testáveis sem DOM. */

export type PontoHistorico = {
  competencia: string;
  entradas_cents: number;
  fixas_cents: number;
  variaveis_cents: number;
  saldo_cents: number;
};

export type GastoCategoriaMes = {
  m: string;
  categoria_id: number | null;
  nome: string | null;
  cor: string | null;
  total_cents: number;
};

export type Delta = { atual: number; anterior: number; delta: number; pct: number | null };

/** pct em %, arredondado a 1 casa; null quando o anterior é zero (÷0 não é
 *  "+100%": um mês sem entradas seguido de um com salário não tem variação
 *  percentual definível). */
export function delta(atual: number, anterior: number): Delta {
  return {
    atual,
    anterior,
    delta: atual - anterior,
    pct: anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10,
  };
}

export type Comparativo = {
  anterior: string;
  entradas: Delta;
  fixas: Delta;
  variaveis: Delta;
  gastos: Delta;
  saldo: Delta;
};

/** Compara a competência `c` com a imediatamente anterior na série (ou null se
 *  `c` é o primeiro ponto — não há com o que comparar). */
export function comparativo(serie: PontoHistorico[], c: string): Comparativo | null {
  const i = serie.findIndex((p) => p.competencia === c);
  if (i < 1) return null;
  const ant = serie[i - 1];
  const at = serie[i];
  return {
    anterior: ant.competencia,
    entradas: delta(at.entradas_cents, ant.entradas_cents),
    fixas: delta(at.fixas_cents, ant.fixas_cents),
    variaveis: delta(at.variaveis_cents, ant.variaveis_cents),
    gastos: delta(at.fixas_cents + at.variaveis_cents, ant.fixas_cents + ant.variaveis_cents),
    saldo: delta(at.saldo_cents, ant.saldo_cents),
  };
}

export type TendenciaCategoria = {
  categoria_id: number | null;
  nome: string | null; // null = sem categoria (rótulo é decisão da UI)
  cor: string | null;
  valores: number[]; // alinhados a `comps`, zeros nos meses sem gasto
  total: number;
};

/** Pivota as linhas mês×categoria em séries alinhadas a `comps`, maiores gastos
 *  primeiro, no máximo `max` categorias. */
export function tendenciasPorCategoria(
  comps: string[],
  linhas: GastoCategoriaMes[],
  max = 6,
): TendenciaCategoria[] {
  const indice = new Map(comps.map((c, i) => [c, i] as const));
  const porCat = new Map<number | null, TendenciaCategoria>();
  for (const l of linhas) {
    const i = indice.get(l.m);
    if (i === undefined) continue; // fora da janela pedida
    let t = porCat.get(l.categoria_id);
    if (!t) {
      t = { categoria_id: l.categoria_id, nome: l.nome, cor: l.cor, valores: comps.map(() => 0), total: 0 };
      porCat.set(l.categoria_id, t);
    }
    t.valores[i] += l.total_cents;
    t.total += l.total_cents;
  }
  return [...porCat.values()].sort((a, b) => b.total - a.total).slice(0, max);
}
