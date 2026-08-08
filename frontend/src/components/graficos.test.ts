import { describe, expect, it } from "vitest";
import { COR_SEM_CATEGORIA, FatiaDonut, PALETA_SERIES, ROTULO_SEM_CATEGORIA, corDaCategoria, dobrarEmOutros } from "./graficos";

const fatia = (rotulo: string, valor: number, cor = PALETA_SERIES[0]): FatiaDonut => ({ rotulo, valor, cor });

describe("corDaCategoria", () => {
  it("respeita a cor escolhida pelo usuário", () => {
    expect(corDaCategoria({ id: 3, cor: "var(--chart-5)" })).toBe("var(--chart-5)");
  });

  it("sem categoria é o neutro, não uma vaga da paleta", () => {
    expect(corDaCategoria(null)).toBe(COR_SEM_CATEGORIA);
    expect(corDaCategoria(undefined)).toBe(COR_SEM_CATEGORIA);
  });

  it("mesma categoria, mesma cor — independente de onde ela apareça", () => {
    // A regressão que isto trava: cada tela sorteava por um índice próprio (em
    // Análises ele andava por lançamento, no Dashboard pela posição no ranking
    // do mês), então a mesma categoria saía de duas cores na mesma tela e
    // trocar de mês repintava todas.
    const cat = { id: 42, cor: null };
    expect(corDaCategoria(cat)).toBe(corDaCategoria(cat));
    expect(corDaCategoria({ id: 42 })).toBe(corDaCategoria({ id: 42, cor: null }));
  });

  it("só devolve cor que está na paleta", () => {
    for (let id = 0; id < 50; id++) {
      expect(PALETA_SERIES).toContain(corDaCategoria({ id }));
    }
  });
});

describe("dobrarEmOutros", () => {
  it("até o limite, devolve tudo — só ordenado por valor", () => {
    const r = dobrarEmOutros([fatia("b", 10), fatia("a", 30), fatia("c", 20)]);
    expect(r.map((f) => f.rotulo)).toEqual(["a", "c", "b"]);
  });

  it("passou do limite, a cauda vira Outros e o total se conserva", () => {
    const entrada = Array.from({ length: 9 }, (_, i) => fatia(`c${i}`, 100 - i * 10));
    const r = dobrarEmOutros(entrada);
    expect(r).toHaveLength(PALETA_SERIES.length);
    expect(r[r.length - 1].rotulo).toBe("Outros");
    // Nada some no caminho: era o defeito do `slice(0, 5)` que isto substitui,
    // onde a cauda recortada não era somada em lugar nenhum e os percentuais
    // exibidos não fechavam com o total impresso ao lado.
    const soma = (fs: FatiaDonut[]) => fs.reduce((s, f) => s + f.valor, 0);
    expect(soma(r)).toBe(soma(entrada));
  });

  it("nunca recicla matiz: no máximo uma cor por vaga da paleta", () => {
    const entrada = Array.from({ length: 20 }, (_, i) => fatia(`c${i}`, 100 - i, PALETA_SERIES[i % PALETA_SERIES.length]));
    const cores = dobrarEmOutros(entrada).map((f) => f.cor);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it("com dobra, Sem categoria desce junto — dois cinzas na legenda seriam um só", () => {
    const entrada = [
      ...Array.from({ length: 8 }, (_, i) => fatia(`c${i}`, 100 - i)),
      { rotulo: ROTULO_SEM_CATEGORIA, valor: 500, cor: COR_SEM_CATEGORIA },
    ];
    const r = dobrarEmOutros(entrada);
    expect(r.filter((f) => f.cor === COR_SEM_CATEGORIA)).toHaveLength(1);
    expect(r.some((f) => f.rotulo === ROTULO_SEM_CATEGORIA)).toBe(false);
    // Sem categoria era o maior valor da lista e ainda assim desceu: ele não é
    // uma identidade, então não ocupa vaga de cor.
    // 5 nomeadas ficam no topo; sobram c5, c6 e c7 (95, 94, 93) mais os 500.
    expect(r[r.length - 1]).toMatchObject({ rotulo: "Outros", valor: 500 + 95 + 94 + 93 });
  });

  it("limite menor, como o do Dashboard, mantém a contagem de linhas", () => {
    const entrada = Array.from({ length: 12 }, (_, i) => fatia(`c${i}`, 100 - i));
    expect(dobrarEmOutros(entrada, 5)).toHaveLength(5);
  });

  it("lista vazia não inventa Outros", () => {
    expect(dobrarEmOutros([])).toEqual([]);
  });
});
