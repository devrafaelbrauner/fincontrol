import { afterEach, describe, expect, it, vi } from "vitest";
import { _definirBackendParaTeste } from "./backendLocal";
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

describe("base da API no desktop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _definirBackendParaTeste(null);
  });

  it("ignora o cofre e o VITE_API_BASE: só vale o backend local", async () => {
    vi.stubGlobal("isTauri", true);
    vi.stubEnv("VITE_API_BASE", "https://vps.exemplo.com");
    const cofre = cofreFalso({ api_base: "https://salvo.exemplo.com" });
    _definirCofreParaTeste(cofre);

    await carregarServidor();
    // Antes do `pronto` não há para onde mandar: "" (o api.ts nem tenta).
    expect(getApiBase()).toBe("");
    expect(temApiBase()).toBe(false);

    _definirBackendParaTeste({ base: "http://127.0.0.1:5123", token: "a".repeat(64) });
    expect(getApiBase()).toBe("http://127.0.0.1:5123");

    // Fora do desktop o cofre não aparece: o carregarServidor do desktop não leu nada.
    vi.stubGlobal("isTauri", false);
    expect(getApiBase()).toBe("https://vps.exemplo.com");
  });
});
