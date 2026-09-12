import { beforeEach, describe, expect, it, vi } from "vitest";
import { _definirArmazemParaTeste, armazemMemoria } from "./banco";
import { guardarGet, lerGet, limparCache } from "./cache";
import {
  aProcessar, conflitos, enfileirar, listarFila, marcarConflito, pendentes, reativarSemIfMatch,
} from "./fila";
import { drenarFila, type RespostaFila } from "./sincronizador";
import { aplicarEmSnapshot, aplicarOtimista, localizarRecurso } from "./otimista";

beforeEach(() => {
  _definirArmazemParaTeste(armazemMemoria());
});

describe("fila de escritas", () => {
  it("numera em ordem de criação e separa pendentes de conflitos", async () => {
    const a = await enfileirar({ method: "PATCH", path: "/variaveis/1", body: "{}", ifMatch: "1" });
    const b = await enfileirar({ method: "DELETE", path: "/metas/2", ifMatch: "3" });
    expect([a.id, b.id]).toEqual([1, 2]);
    expect((await pendentes()).map((i) => i.id)).toEqual([1, 2]);

    await marcarConflito(a.id, "editado em outro aparelho");
    expect((await pendentes()).map((i) => i.id)).toEqual([2]);
    expect((await conflitos())[0]).toMatchObject({ id: 1, status: "conflito", erro: "editado em outro aparelho" });
  });

  it("manter minha edição reaplica sem If-Match como pendente", async () => {
    const item = await enfileirar({ method: "PATCH", path: "/variaveis/1", ifMatch: "7" });
    await marcarConflito(item.id, "409");
    await reativarSemIfMatch(item.id);

    const [depois] = await listarFila();
    expect(depois.status).toBe("pendente");
    expect(depois.ifMatch).toBeNull();
  });
});

describe("cache de GET", () => {
  it("guarda e devolve o corpo com o instante", async () => {
    await guardarGet("/variaveis", { itens: [1, 2] }, new Date("2026-09-12T10:00:00Z"));
    const r = await lerGet<{ itens: number[] }>("/variaveis");
    expect(r?.dados).toEqual({ itens: [1, 2] });
    expect(r?.em).toBe("2026-09-12T10:00:00.000Z");
  });

  it("limparCache apaga tudo", async () => {
    await guardarGet("/x", 1);
    await limparCache();
    expect(await lerGet("/x")).toBeNull();
  });
});

describe("replay da fila", () => {
  it("sucesso remove o item e invalida o cache", async () => {
    await guardarGet("/variaveis", { velho: true });
    await enfileirar({ method: "PATCH", path: "/variaveis/1", ifMatch: "1" });

    const executor = vi.fn(async (): Promise<RespostaFila> => ({ status: 200 }));
    const r = await drenarFila(executor);

    expect(r).toMatchObject({ aplicados: 1, conflitos: 0, parouPorRede: false });
    expect(await listarFila()).toHaveLength(0);
    expect(await lerGet("/variaveis")).toBeNull();
  });

  it("409 vira conflito e NÃO derruba os próximos itens", async () => {
    await enfileirar({ method: "PATCH", path: "/variaveis/1", ifMatch: "1" });
    await enfileirar({ method: "PATCH", path: "/variaveis/2", ifMatch: "1" });

    const executor = vi.fn(async (item) =>
      item.path.endsWith("/1") ? { status: 409, detail: "conflito" } : { status: 200 });

    const r = await drenarFila(executor);
    expect(r).toMatchObject({ aplicados: 1, conflitos: 1 });
    expect(await conflitos()).toHaveLength(1);
    expect(await pendentes()).toHaveLength(0);
  });

  it("falha de rede para o replay inteiro, sem marcar conflito", async () => {
    await enfileirar({ method: "POST", path: "/variaveis", body: "{}" });
    const executor = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const r = await drenarFila(executor);

    expect(r.parouPorRede).toBe(true);
    expect(await pendentes()).toHaveLength(1);
    expect(await conflitos()).toHaveLength(0);
  });

  it("5xx vira erro retentável — e não some da próxima rodada", async () => {
    await enfileirar({ method: "POST", path: "/variaveis", body: "{}" });
    const caiu = vi.fn(async (): Promise<RespostaFila> => ({ status: 503, detail: "indisponível" }));
    const r1 = await drenarFila(caiu);
    expect(r1.erros).toBe(1);
    expect(await conflitos()).toHaveLength(0);
    expect(await aProcessar()).toHaveLength(1); // continua elegível ao retry

    const voltou = vi.fn(async (): Promise<RespostaFila> => ({ status: 200 }));
    const r2 = await drenarFila(voltou);
    expect(r2.aplicados).toBe(1);
    expect(await listarFila()).toHaveLength(0);
  });

  it("401 renova a sessão UMA vez e repete o item", async () => {
    await enfileirar({ method: "DELETE", path: "/metas/9", ifMatch: "2" });
    let chamadas = 0;
    const executor = vi.fn(async (): Promise<RespostaFila> => {
      chamadas += 1;
      return chamadas === 1 ? { status: 401 } : { status: 200 };
    });
    const renovar = vi.fn(async () => true);

    const r = await drenarFila(executor, renovar);
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(r.aplicados).toBe(1);
    expect(await listarFila()).toHaveLength(0);
  });

  it("401 sem renovação para e sinaliza login, mantendo a fila intacta", async () => {
    await enfileirar({ method: "DELETE", path: "/metas/9", ifMatch: "2" });
    const executor = vi.fn(async (): Promise<RespostaFila> => ({ status: 401 }));
    const r = await drenarFila(executor, async () => false);

    expect(r.precisaLogin).toBe(true);
    expect(await pendentes()).toHaveLength(1);
  });
});

describe("update otimista", () => {
  const item = (method: string, path: string) =>
    ({ id: 7, method, path, body: null, ifMatch: null, criadoEm: "", status: "pendente" } as const);

  it("localiza o recurso, o id e o caso de grupo (parcelado)", () => {
    expect(localizarRecurso("/variaveis/12")).toMatchObject({ id: 12, ehGrupo: false });
    expect(localizarRecurso("/variaveis/parcelado/3")).toMatchObject({ ehGrupo: true });
    expect(localizarRecurso("/contas-bancarias/5")).toBeNull(); // forma desconhecida: não adivinha
    expect(localizarRecurso("/categorias")).toMatchObject({ id: null });
  });

  it("PATCH funde os campos na linha do snapshot", () => {
    const dados = { itens: [{ id: 1, descricao: "A", categoria_id: null }, { id: 2, descricao: "B" }] };
    const alvo = localizarRecurso("/variaveis/1")!;
    const novo = aplicarEmSnapshot(dados, item("PATCH", "/variaveis/1"), alvo, { categoria_id: 9 }, "/variaveis") as typeof dados;
    expect(novo.itens[0]).toMatchObject({ id: 1, descricao: "A", categoria_id: 9 });
    expect(novo.itens[1]).toEqual(dados.itens[1]);
  });

  it("DELETE remove a linha do snapshot", () => {
    const dados = { itens: [{ id: 1 }, { id: 2 }] };
    const alvo = localizarRecurso("/variaveis/1")!;
    const novo = aplicarEmSnapshot(dados, item("DELETE", "/variaveis/1"), alvo, null, "/variaveis") as typeof dados;
    expect(novo.itens).toEqual([{ id: 2 }]);
  });

  it("POST apara uma linha temporária (id negativo) só no mês certo", () => {
    const dados = { itens: [{ id: 1 }] };
    const alvo = localizarRecurso("/variaveis")!;
    const corpo = { descricao: "Nova", data: "2026-03-10" };

    const dentro = aplicarEmSnapshot(dados, item("POST", "/variaveis"), alvo, corpo, "/variaveis?de=2026-03-01&ate=2026-03-31") as typeof dados;
    expect(dentro.itens[0]).toMatchObject({ descricao: "Nova", __pendente: true });
    expect(dentro.itens[0].id).toBeLessThan(0);

    const fora = aplicarEmSnapshot(dados, item("POST", "/variaveis"), alvo, corpo, "/variaveis?de=2026-04-01&ate=2026-04-30");
    expect(fora).toBe(dados); // não aparece no mês errado
  });

  it("operação de grupo (parcelado) não altera o snapshot", () => {
    const dados = { itens: [{ id: 1 }] };
    const alvo = localizarRecurso("/variaveis/parcelado/3")!;
    const novo = aplicarEmSnapshot(dados, item("PATCH", "/variaveis/parcelado/3"), alvo, { categoria_id: 4 }, "/variaveis");
    expect(novo).toBe(dados);
  });

  it("aplicarOtimista grava o snapshot alterado no cache", async () => {
    await guardarGet("/variaveis?de=2026-03-01&ate=2026-03-31", { itens: [{ id: 1, descricao: "A" }] });
    const item = await enfileirar({ method: "PATCH", path: "/variaveis/1", body: JSON.stringify({ descricao: "Editada" }), ifMatch: "1" });

    await aplicarOtimista(item);

    const r = await lerGet<{ itens: { descricao: string }[] }>("/variaveis?de=2026-03-01&ate=2026-03-31");
    expect(r?.dados.itens[0].descricao).toBe("Editada");
  });
});
