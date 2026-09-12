import { afterEach, describe, expect, it, vi } from "vitest";
import { _definirCofreParaTeste } from "./nativo/cofre";
import { carregarServidor, definirServidor, getApiBase, temApiBase } from "./servidor";

function cofreFalso(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    mapa,
    ler: async (k: string) => mapa.get(k) ?? null,
    gravar: async (k: string, v: string) => { mapa.set(k, v); },
    apagar: async (k: string) => { mapa.delete(k); },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await definirServidor(null);
  _definirCofreParaTeste(null);
});

describe("base da API em runtime", () => {
  it("guarda a URL normalizada (sem barra final) no cofre", async () => {
    const cofre = cofreFalso();
    _definirCofreParaTeste(cofre);
    await definirServidor("https://fin.exemplo.com/");
    expect(getApiBase()).toBe("https://fin.exemplo.com");
    expect(cofre.mapa.get("api_base")).toBe("https://fin.exemplo.com");
    expect(temApiBase()).toBe(true);
  });

  it("carrega o valor salvo no boot (nativo)", async () => {
    const cofre = cofreFalso({ api_base: "https://salvo.exemplo.com/" });
    _definirCofreParaTeste(cofre);
    const { Capacitor } = await import("@capacitor/core");
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);

    await carregarServidor();
    expect(getApiBase()).toBe("https://salvo.exemplo.com");
  });

  it("remover volta para o VITE_API_BASE (vazio no web, same-origin)", async () => {
    const cofre = cofreFalso({ api_base: "https://salvo.exemplo.com" });
    _definirCofreParaTeste(cofre);
    await carregarServidor();
    await definirServidor(null);
    expect(getApiBase()).toBe("");
    expect(temApiBase()).toBe(false);
    expect(cofre.mapa.has("api_base")).toBe(false);
  });
});
