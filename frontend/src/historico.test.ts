import { describe, expect, it } from "vitest";
import { comparativo, delta, PontoHistorico, tendenciasPorCategoria } from "./historico";

const ponto = (competencia: string, e: number, f: number, v: number): PontoHistorico => ({
  competencia,
  entradas_cents: e,
  fixas_cents: f,
  variaveis_cents: v,
  saldo_cents: e - f - v,
});

describe("delta", () => {
  it("calcula diferença e percentual arredondado a 1 casa", () => {
    expect(delta(150, 100)).toEqual({ atual: 150, anterior: 100, delta: 50, pct: 50 });
    expect(delta(100, 300)).toEqual({ atual: 100, anterior: 300, delta: -200, pct: -66.7 });
  });

  it("anterior zero → pct null, não Infinity nem 100", () => {
    expect(delta(5000, 0).pct).toBeNull();
    expect(delta(0, 0).pct).toBeNull();
  });

  it("anterior negativo usa o módulo como base", () => {
    // Saldo de -100 indo a -50 melhorou 50% — dividir pelo valor com sinal
    // inverteria a direção da variação.
    expect(delta(-50, -100).pct).toBe(50);
  });
});

describe("comparativo", () => {
  const serie = [ponto("2026-06", 1000, 200, 300), ponto("2026-07", 1500, 200, 100)];

  it("compara com o mês imediatamente anterior da série", () => {
    const c = comparativo(serie, "2026-07")!;
    expect(c.anterior).toBe("2026-06");
    expect(c.entradas.delta).toBe(500);
    expect(c.gastos.atual).toBe(300);
    expect(c.gastos.anterior).toBe(500);
    expect(c.saldo.delta).toBe(1200 - 500);
  });

  it("primeiro mês da série (ou mês fora dela) não tem comparativo", () => {
    expect(comparativo(serie, "2026-06")).toBeNull();
    expect(comparativo(serie, "2026-01")).toBeNull();
  });
});

describe("tendenciasPorCategoria", () => {
  const comps = ["2026-06", "2026-07", "2026-08"];
  const linha = (m: string, id: number | null, nome: string | null, total: number) => ({
    m, categoria_id: id, nome, cor: null, total_cents: total,
  });

  it("alinha valores aos meses (zeros onde não há gasto) e ordena por total", () => {
    const ts = tendenciasPorCategoria(comps, [
      linha("2026-06", 1, "Mercado", 100),
      linha("2026-08", 1, "Mercado", 300),
      linha("2026-07", 2, "Lazer", 900),
    ]);
    expect(ts.map((t) => t.nome)).toEqual(["Lazer", "Mercado"]);
    expect(ts[1].valores).toEqual([100, 0, 300]);
    expect(ts[1].total).toBe(400);
  });

  it("trata sem-categoria (id null) como série própria e respeita o limite", () => {
    const ts = tendenciasPorCategoria(
      comps,
      [linha("2026-06", null, null, 50), linha("2026-06", 1, "A", 500), linha("2026-06", 2, "B", 400)],
      2,
    );
    expect(ts).toHaveLength(2);
    expect(ts.map((t) => t.nome)).toEqual(["A", "B"]);
  });

  it("ignora meses fora da janela pedida", () => {
    const ts = tendenciasPorCategoria(comps, [linha("2025-01", 1, "A", 999), linha("2026-07", 1, "A", 10)]);
    expect(ts[0].total).toBe(10);
  });
});
