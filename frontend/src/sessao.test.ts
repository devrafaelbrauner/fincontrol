import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessao from "./sessao";
import { _definirCofreParaTeste, type Cofre } from "./nativo/cofre";

/** localStorage de mentira: o vitest roda em node, sem DOM. */
function localStorageFalso(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    setItem: (k: string, v: string) => { mapa.set(k, v); },
    removeItem: (k: string) => { mapa.delete(k); },
    mapa,
  };
}

function cofreFalso(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    ler: vi.fn(async (k: string) => mapa.get(k) ?? null),
    gravar: vi.fn(async (k: string, v: string) => { mapa.set(k, v); }),
    apagar: vi.fn(async (k: string) => { mapa.delete(k); }),
  } satisfies Cofre & { mapa: Map<string, string> };
}

async function comoNativo<T>(fn: () => Promise<T>): Promise<T> {
  const { Capacitor } = await import("@capacitor/core");
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  try {
    return await fn();
  } finally {
    vi.restoreAllMocks();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  _definirCofreParaTeste(null);
});

describe("sessão nativa", () => {
  it("migra o refresh do localStorage para o cofre e apaga a cópia velha", async () => {
    const ls = localStorageFalso({ refresh_token: "r-antigo", token: "a-antigo" });
    vi.stubGlobal("localStorage", ls);
    const cofre = cofreFalso();
    _definirCofreParaTeste(cofre);

    await comoNativo(async () => {
      await sessao.carregarSessao();
      expect(cofre.gravar).toHaveBeenCalledWith("refresh_token", "r-antigo");
      expect(cofre.gravar).toHaveBeenCalledWith("token", "a-antigo");
    });

    // O nativo não guarda mais segredo de sessão no localStorage.
    expect(ls.getItem("refresh_token")).toBeNull();
    expect(ls.getItem("token")).toBeNull();
    expect(sessao.getRefresh()).toBe("r-antigo");
    expect(sessao.getToken()).toBe("a-antigo");
  });

  it("o que já está no cofre vence o localStorage e não é sobrescrito", async () => {
    const ls = localStorageFalso({ refresh_token: "r-velho" });
    vi.stubGlobal("localStorage", ls);
    const cofre = cofreFalso({ refresh_token: "r-cofre" });
    _definirCofreParaTeste(cofre);

    await comoNativo(async () => {
      await sessao.carregarSessao();
      expect(cofre.gravar).not.toHaveBeenCalled();
    });
    expect(sessao.getRefresh()).toBe("r-cofre");
    expect(ls.getItem("refresh_token")).toBeNull();
  });

  it("guardarSessao no nativo vai para o cofre, nunca para o localStorage", async () => {
    const ls = localStorageFalso();
    vi.stubGlobal("localStorage", ls);
    const cofre = cofreFalso();
    _definirCofreParaTeste(cofre);

    await comoNativo(async () => {
      await sessao.guardarSessao({ token: "novo-a", refresh_token: "novo-r", nome: "Rafa" });
    });

    expect(cofre.mapa.get("token")).toBe("novo-a");
    expect(cofre.mapa.get("refresh_token")).toBe("novo-r");
    expect(ls.getItem("token")).toBeNull();
    expect(ls.getItem("refresh_token")).toBeNull();
  });

  it("limparSessao apaga os dois segredos do cofre", async () => {
    const ls = localStorageFalso();
    vi.stubGlobal("localStorage", ls);
    const cofre = cofreFalso({ token: "a", refresh_token: "r" });
    _definirCofreParaTeste(cofre);

    await comoNativo(async () => {
      await sessao.limparSessao();
    });

    expect(cofre.mapa.has("token")).toBe(false);
    expect(cofre.mapa.has("refresh_token")).toBe(false);
    expect(sessao.getToken()).toBeNull();
    expect(sessao.getRefresh()).toBeNull();
  });
});
