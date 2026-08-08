import { describe, expect, it } from "vitest";
import { COR_SEM_CATEGORIA, FatiaDonut, PALETA_SERIES, ROTULO_DEMAIS, ROTULO_SEM_CATEGORIA, corDaCategoria, dobrarEmOutros, resolverCores, ticksBonitos } from "./graficos";

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

describe("ticksBonitos", () => {
  it("usa passos redondos, não o intervalo dividido em partes iguais", () => {
    // Com (max-min)/3 puro sairia "R$ 3.847" no eixo, que não ajuda a estimar.
    const t = ticksBonitos(0, 11_540_00);
    expect(t.every((v) => v % 250_000 === 0 || v % 100_000 === 0)).toBe(true);
    expect(t[0]).toBe(0);
  });

  it("cobre o domínio sem passar do topo", () => {
    const t = ticksBonitos(0, 1000);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...t)).toBeLessThanOrEqual(1000);
  });

  it("o zero entra sempre que o domínio o atravessa", () => {
    // O saldo fica negativo em mês ruim, e é o zero — não o menor valor — que
    // dá sentido à leitura. As marcas são múltiplos do passo, então ele cai
    // naturalmente na régua; não é preciso haver marca ABAIXO de zero.
    expect(ticksBonitos(-500, 1500)).toContain(0);
    expect(ticksBonitos(-1500, 500)).toContain(0);
    expect(ticksBonitos(-8000, 12000)).toContain(0);
  });

  it("intervalo degenerado não trava nem devolve lista infinita", () => {
    expect(ticksBonitos(5, 5)).toEqual([5]);
    expect(ticksBonitos(10, 0)).toEqual([10]);
  });
});

describe("resolverCores", () => {
  it("dá cores distintas às primeiras seis, mesmo com ids que colidem", () => {
    // Casa (9) e Transporte (3) caem na mesma vaga por id % 6 — foi o que
    // apareceu na tela: dois âmbares no mesmo donut. Como aqui a atribuição
    // enxerga o conjunto todo, elas se separam.
    expect(corDaCategoria({ id: 3 })).toBe(corDaCategoria({ id: 9 }));
    const cores = resolverCores([2, 3, 9, 8, 4, 6].map((id) => ({ id })));
    expect(new Set(cores.values()).size).toBe(6);
  });

  it("a escolha do usuário é mantida e tira a vaga da disputa", () => {
    const cores = resolverCores([{ id: 1, cor: PALETA_SERIES[2] }, { id: 2 }, { id: 3 }]);
    expect(cores.get(1)).toBe(PALETA_SERIES[2]);
    expect(cores.get(2)).not.toBe(PALETA_SERIES[2]);
    expect(cores.get(3)).not.toBe(PALETA_SERIES[2]);
  });

  it("passando de seis, repete de forma estável em vez de inventar matiz", () => {
    const cores = resolverCores(Array.from({ length: 9 }, (_, i) => ({ id: i + 1 })));
    expect(cores.size).toBe(9);
    for (const c of cores.values()) expect(PALETA_SERIES).toContain(c);
  });

  it("a mesma categoria recebe a mesma cor nas duas seções da tela", () => {
    // A regressão que isto trava foi vista rodando: "Casa" saía âmbar em
    // "Tendência por categoria" e azul em "Gastos por categoria", logo abaixo.
    // Só não acontece porque as duas leem do mesmo mapa.
    const daTela = [2, 3, 9, 8].map((id) => ({ id }));
    const cores = resolverCores(daTela);
    for (const { id } of daTela) expect(cores.get(id)).toBe(cores.get(id));
    expect(cores.get(9)).not.toBe(cores.get(3));
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

  it("não repinta ninguém: a cor que entra é a cor que sai", () => {
    // Houve uma versão que desempatava cores colididas aqui dentro. Ela foi
    // removida por ter sido vista rodando: como só a seção "Gastos por
    // categoria" passa por esta função e a "Tendência por categoria" não,
    // "Casa" saía âmbar numa e azul na outra, na MESMA tela. Preferimos duas
    // categorias dividindo uma cor (o rótulo ao lado resolve) a uma categoria
    // com duas cores (que não tem como resolver pela leitura).
    const entrada = [fatia("a", 50, corDaCategoria({ id: 1 })), fatia("b", 30, corDaCategoria({ id: 7 }))];
    expect(corDaCategoria({ id: 1 })).toBe(corDaCategoria({ id: 7 }));   // colidem mesmo
    const r = dobrarEmOutros(entrada);
    expect(r.map((f) => f.cor)).toEqual(entrada.map((f) => f.cor));
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
