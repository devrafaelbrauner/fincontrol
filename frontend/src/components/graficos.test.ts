import { describe, expect, it } from "vitest";
import { COR_SEM_CATEGORIA, FatiaDonut, PALETA_SERIES, ROTULO_DEMAIS, ROTULO_SEM_CATEGORIA, corDaCategoria, dobrarEmOutros } from "./graficos";

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

  it("passou do limite, a cauda vira uma linha só e o total se conserva", () => {
    const entrada = Array.from({ length: 9 }, (_, i) => fatia(`c${i}`, 100 - i * 10));
    const r = dobrarEmOutros(entrada);
    expect(r).toHaveLength(PALETA_SERIES.length);
    expect(r[r.length - 1].rotulo).toBe(ROTULO_DEMAIS);
    // Nada some no caminho: era o defeito do `slice(0, 5)` que isto substitui,
    // onde a cauda recortada não era somada em lugar nenhum e os percentuais
    // exibidos não fechavam com o total impresso ao lado.
    const soma = (fs: FatiaDonut[]) => fs.reduce((s, f) => s + f.valor, 0);
    expect(soma(r)).toBe(soma(entrada));
  });

  it("nunca recicla matiz: no máximo uma cor por vaga da paleta", () => {
    // As cores vêm de corDaCategoria, como na tela — passar cores já distintas
    // à mão faria o teste passar sem exercitar nada.
    const entrada = Array.from({ length: 20 }, (_, i) => fatia(`c${i}`, 100 - i, corDaCategoria({ id: i })));
    const cores = dobrarEmOutros(entrada).map((f) => f.cor);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it("ids que caem na mesma vaga não viram a mesma cor na legenda", () => {
    // 1 e 7 diferem por um múltiplo de seis, então corDaCategoria devolve a
    // mesma vaga para os dois — plausível assim que o usuário passa das 20
    // categorias semeadas.
    expect(corDaCategoria({ id: 1 })).toBe(corDaCategoria({ id: 7 }));
    const r = dobrarEmOutros([fatia("a", 50, corDaCategoria({ id: 1 })), fatia("b", 30, corDaCategoria({ id: 7 }))]);
    expect(r[0].cor).not.toBe(r[1].cor);
  });

  it("a linha de resumo sai mesmo quando a cauda soma zero", () => {
    // valor_cents aceita 0 (CHECK >= 0), então sem isto as categorias zeradas
    // sumiriam da lista sem nada explicando a ausência.
    // Sete linhas com limite seis: cinco vão para o topo e a cauda é só o par
    // zerado, então a linha de resumo soma exatamente 0.
    const entrada = [
      ...Array.from({ length: 5 }, (_, i) => fatia(`c${i}`, 100 - i)),
      fatia("zerada 1", 0), fatia("zerada 2", 0),
    ];
    const r = dobrarEmOutros(entrada);
    expect(r).toHaveLength(PALETA_SERIES.length);
    expect(r[r.length - 1]).toMatchObject({ rotulo: ROTULO_DEMAIS, valor: 0 });
  });

  it("a linha de resumo não se chama Outros — isso é uma categoria de verdade", () => {
    // A migration 004 semeia 'Outros' (variável e entrada). Como as somas são
    // chaveadas por nome, uma linha de resumo homônima poria duas "Outros" com
    // cores e valores diferentes na mesma legenda.
    const entrada = [
      ...Array.from({ length: 8 }, (_, i) => fatia(`c${i}`, 100 - i)),
      fatia("Outros", 5),
    ];
    const r = dobrarEmOutros(entrada);
    expect(r.filter((f) => f.rotulo === "Outros").length).toBeLessThanOrEqual(1);
    expect(new Set(r.map((f) => f.rotulo)).size).toBe(r.length);
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
    expect(r[r.length - 1]).toMatchObject({ rotulo: ROTULO_DEMAIS, valor: 500 + 95 + 94 + 93 });
  });

  it("limite menor, como o do Dashboard, mantém a contagem de linhas", () => {
    const entrada = Array.from({ length: 12 }, (_, i) => fatia(`c${i}`, 100 - i));
    expect(dobrarEmOutros(entrada, 5)).toHaveLength(5);
  });

  it("lista vazia não inventa Outros", () => {
    expect(dobrarEmOutros([])).toEqual([]);
  });
});
