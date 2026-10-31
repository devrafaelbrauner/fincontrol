import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  _definirBackendParaTeste, _definirCascaParaTeste, baseLocal, ESPERA_RELEITURA_MS,
  type EstadoBackend, MOTIVO_SEM_INFO, observarBackend, relerInfo, tokenLocal,
} from "./backendLocal";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

type Ouvinte = (evento: { payload: EstadoBackend }) => void;

/** Simula o Rust: `backend_estado` devolve `estado`, `backend_info` devolve as
 *  infos na ordem dada, e o ouvinte registrado fica em `emitir`. */
function simularRust(estado: EstadoBackend, ...infos: { base: string; token: string }[]) {
  let ouvinte: Ouvinte | null = null;
  vi.mocked(listen).mockImplementation(async (_nome, fn) => {
    ouvinte = fn as unknown as Ouvinte;
    return () => { ouvinte = null; };
  });
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "backend_estado") return estado;
    if (cmd === "backend_info") {
      const info = infos.shift();
      if (!info) throw "nao_pronto";
      return info;
    }
    throw new Error(`comando inesperado: ${cmd}`);
  });
  return { emitir: (payload: EstadoBackend) => ouvinte?.({ payload }) };
}

/** Deixa as promessas encadeadas do invoke mockado terminarem (só microtarefas,
 *  sem relógio). */
async function assentar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  _definirBackendParaTeste(null);
  _definirCascaParaTeste(null);
  vi.useRealTimers();
});

describe("observarBackend", () => {
  it("ouve o evento ANTES de ler o estado: um `pronto` emitido antes do listen vem pela leitura", async () => {
    // O Rust já emitiu `pronto` antes de o front existir; ninguém ouviu. Só a
    // leitura do estado atual, feita depois do listen, cobre esse aviso.
    simularRust({ estado: "pronto" }, { base: "http://127.0.0.1:5123/", token: TOKEN_A });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();

    const ordemListen = vi.mocked(listen).mock.invocationCallOrder[0];
    const ordemEstado = vi.mocked(invoke).mock.invocationCallOrder[
      vi.mocked(invoke).mock.calls.findIndex(([cmd]) => cmd === "backend_estado")
    ];
    expect(vi.mocked(listen).mock.calls[0][0]).toBe("backend-estado");
    expect(ordemListen).toBeLessThan(ordemEstado);
    expect(visto).toEqual([{ estado: "pronto" }]);
  });

  it("em `pronto`, base e token vêm do backend_info e já estão lá quando avisa", async () => {
    simularRust({ estado: "pronto" }, { base: "http://127.0.0.1:5123", token: TOKEN_A });
    const lidos: [string | null, string | null][] = [];

    await observarBackend(() => lidos.push([baseLocal(), tokenLocal()]));
    await assentar();

    expect(lidos).toEqual([["http://127.0.0.1:5123", TOKEN_A]]);
  });

  it("`iniciando` e `falhou` esquecem base e token", async () => {
    const rust = simularRust({ estado: "pronto" }, { base: "http://127.0.0.1:5123", token: TOKEN_A });
    const visto: EstadoBackend[] = [];
    await observarBackend((e) => visto.push(e));
    await assentar();
    expect(tokenLocal()).toBe(TOKEN_A);

    rust.emitir({ estado: "iniciando" });
    await assentar();
    expect(baseLocal()).toBeNull();
    expect(tokenLocal()).toBeNull();

    _definirBackendParaTeste({ base: "http://127.0.0.1:5123", token: TOKEN_A });
    rust.emitir({ estado: "falhou", motivo: "porta ocupada" });
    await assentar();
    expect(baseLocal()).toBeNull();
    expect(visto).toEqual([
      { estado: "pronto" },
      { estado: "iniciando" },
      { estado: "falhou", motivo: "porta ocupada" },
    ]);
  });

  it("um `pronto` que termina de ler depois de um `iniciando` não revive a base velha", async () => {
    // `Promise.withResolvers` não está no lib ES2020 do tsconfig.
    let soltar: (v: unknown) => void = () => {};
    const rust = simularRust({ estado: "iniciando" });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "backend_estado") return { estado: "iniciando" };
      return new Promise((r) => { soltar = r; });
    });
    const visto: EstadoBackend[] = [];
    await observarBackend((e) => visto.push(e));
    await assentar();

    rust.emitir({ estado: "pronto" });
    rust.emitir({ estado: "iniciando" });
    soltar({ base: "http://127.0.0.1:5123", token: TOKEN_A });
    await assentar();

    expect(baseLocal()).toBeNull();
    expect(visto).toEqual([{ estado: "iniciando" }, { estado: "iniciando" }]);
  });

  it("evento que chega durante a leitura inicial vence a leitura (que pode ser mais velha)", async () => {
    const rust = simularRust({ estado: "iniciando" });
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "backend_estado") {
        // O Rust troca de estado enquanto a leitura volta: o evento chega antes dela.
        rust.emitir({ estado: "falhou", motivo: "sidecar ausente" });
        return { estado: "iniciando" };
      }
      throw new Error(`comando inesperado: ${cmd}`);
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();

    expect(visto).toEqual([{ estado: "falhou", motivo: "sidecar ausente" }]);
  });

  it("cada evento lê `info` UMA vez: `pronto` durante a leitura inicial termina em `pronto`", async () => {
    // CR-1: quando as cascas chamavam `aplicar` e o `observarBackend` chamava de
    // novo, este cenário lia `backend_info` 2× e terminava em `[iniciando]`,
    // prendendo o boot em "Abrindo…". Passa pela `cascaTauri` real (mocks de
    // `invoke`/`listen`), sem `Casca` injetada.
    _definirCascaParaTeste(null);
    const rust = simularRust({ estado: "iniciando" });
    let leiturasInfo = 0;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "backend_estado") {
        // O Rust fica `pronto` enquanto a leitura volta: o evento chega antes dela.
        rust.emitir({ estado: "pronto" });
        return { estado: "iniciando" };
      }
      if (cmd === "backend_info") {
        leiturasInfo++;
        return { base: "http://127.0.0.1:5123", token: TOKEN_A };
      }
      throw new Error(`comando inesperado: ${cmd}`);
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();

    expect(leiturasInfo).toBe(1);
    expect(tokenLocal()).toBe(TOKEN_A);
    expect(visto).toEqual([{ estado: "pronto" }]);
  });

  it("`pronto` com backend_info falhando uma vez tenta de novo e segue", async () => {
    vi.useFakeTimers();
    simularRust({ estado: "pronto" });
    let leituras = 0;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "backend_estado") return { estado: "pronto" };
      if (++leituras === 1) throw "nao_pronto";
      return { base: "http://127.0.0.1:5123", token: TOKEN_A };
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();
    expect(visto).toEqual([]);

    await vi.advanceTimersByTimeAsync(ESPERA_RELEITURA_MS);

    expect(leituras).toBe(2);
    expect(visto).toEqual([{ estado: "pronto" }]);
    expect(tokenLocal()).toBe(TOKEN_A);
  });

  it("`pronto` com backend_info falhando duas vezes vira `falhou`, em vez de ficar em \"Abrindo…\"", async () => {
    vi.useFakeTimers();
    simularRust({ estado: "pronto" });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();
    await vi.advanceTimersByTimeAsync(ESPERA_RELEITURA_MS);

    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "backend_info")).toHaveLength(2);
    expect(MOTIVO_SEM_INFO).toBe("Não foi possível ler o endereço do backend local.");
    expect(visto).toEqual([{ estado: "falhou", motivo: MOTIVO_SEM_INFO }]);
    expect(baseLocal()).toBeNull();
  });
});

describe("relerInfo", () => {
  it("é single-flight: vários 401 juntos fazem UMA leitura", async () => {
    simularRust({ estado: "pronto" }, { base: "http://127.0.0.1:6000", token: TOKEN_B });

    await Promise.all([relerInfo(), relerInfo(), relerInfo()]);

    const leituras = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "backend_info");
    expect(leituras).toHaveLength(1);
    expect(baseLocal()).toBe("http://127.0.0.1:6000");
    expect(tokenLocal()).toBe(TOKEN_B);
  });

  it("terminada a leitura, a próxima chamada lê de novo", async () => {
    simularRust({ estado: "pronto" },
      { base: "http://127.0.0.1:6000", token: TOKEN_A },
      { base: "http://127.0.0.1:6001", token: TOKEN_B });

    await relerInfo();
    await relerInfo();

    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "backend_info")).toHaveLength(2);
    expect(tokenLocal()).toBe(TOKEN_B);
  });

  it("`nao_pronto` esquece a base e rejeita", async () => {
    simularRust({ estado: "iniciando" });
    _definirBackendParaTeste({ base: "http://127.0.0.1:6000", token: TOKEN_A });

    await expect(relerInfo()).rejects.toBe("nao_pronto");
    expect(baseLocal()).toBeNull();
    expect(tokenLocal()).toBeNull();
  });

  it("uma releitura que volta depois de um aviso mais novo é descartada", async () => {
    let soltar: (v: unknown) => void = () => {};
    const rust = simularRust({ estado: "pronto" }, { base: "http://127.0.0.1:5123", token: TOKEN_A });
    await observarBackend(() => {});
    await assentar();
    vi.mocked(invoke).mockImplementation(() => new Promise((r) => { soltar = r; }));

    const releitura = relerInfo();
    rust.emitir({ estado: "iniciando" });
    soltar({ base: "http://127.0.0.1:6000", token: TOKEN_B });
    await releitura;

    expect(baseLocal()).toBeNull();
    expect(tokenLocal()).toBeNull();
  });
});

describe("casca Android (plugin BackendLocal)", () => {
  type OuvinteAndroid = (estado: EstadoBackend) => void;

  /** Simula o plugin `BackendLocal`: `estado()` devolve `estado`, `info()` as
   *  infos na ordem dada, e o ouvinte registrado fica em `emitir`. O núcleo
   *  (`observarBackend`, geração, single-flight) é o mesmo do Tauri: estes
   *  casos repetem os de lá contra o stub, como manda o arch-frontend D4. */
  function simularPlugin(estado: EstadoBackend, ...infos: { base: string; token: string }[]) {
    let ouvinte: OuvinteAndroid | null = null;
    let leiturasInfo = 0;
    _definirCascaParaTeste({
      lerEstado: async () => estado,
      lerInfo: async () => {
        leiturasInfo++;
        const info = infos.shift();
        if (!info) throw "nao_pronto";
        return info;
      },
      pedirReinicio: async () => {},
      ouvirEstado: async (fn) => {
        ouvinte = fn;
        return () => { ouvinte = null; };
      },
    });
    return {
      leiturasInfo: () => leiturasInfo,
      emitir: (novo: EstadoBackend) => ouvinte?.(novo),
    };
  }

  it("ouve o evento ANTES de ler o estado (ordem listener→estado)", async () => {
    // CR-4 (parte): o caso era tautológico. A ordem agora é conferida pela
    // sequência de chamadas no stub, como o caso Tauri faz com `listen`/`invoke`.
    const ordem: string[] = [];
    _definirCascaParaTeste({
      lerEstado: async () => { ordem.push("estado"); return { estado: "pronto" as const }; },
      lerInfo: async () => { ordem.push("info"); return { base: "http://127.0.0.1:5123/", token: TOKEN_A }; },
      pedirReinicio: async () => {},
      ouvirEstado: async () => { ordem.push("ouvir"); return () => {}; },
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();

    expect(ordem).toEqual(["ouvir", "estado", "info"]);
    expect(visto).toEqual([{ estado: "pronto" }]);
  });

  it("em `pronto`, base e token vêm do `info()` e já estão lá quando avisa", async () => {
    simularPlugin({ estado: "pronto" }, { base: "http://127.0.0.1:5123", token: TOKEN_A });
    const lidos: [string | null, string | null][] = [];

    await observarBackend(() => lidos.push([baseLocal(), tokenLocal()]));
    await assentar();

    expect(lidos).toEqual([["http://127.0.0.1:5123", TOKEN_A]]);
  });

  it("`iniciando` e `falhou` esquecem base e token", async () => {
    const plugin = simularPlugin({ estado: "pronto" }, { base: "http://127.0.0.1:5123", token: TOKEN_A });
    const visto: EstadoBackend[] = [];
    await observarBackend((e) => visto.push(e));
    await assentar();
    expect(tokenLocal()).toBe(TOKEN_A);

    plugin.emitir({ estado: "iniciando" });
    await assentar();
    expect(baseLocal()).toBeNull();
    expect(tokenLocal()).toBeNull();

    _definirBackendParaTeste({ base: "http://127.0.0.1:5123", token: TOKEN_A });
    plugin.emitir({ estado: "falhou", motivo: "cofre corrompido" });
    await assentar();
    expect(baseLocal()).toBeNull();
    expect(visto).toEqual([
      { estado: "pronto" },
      { estado: "iniciando" },
      { estado: "falhou", motivo: "cofre corrompido" },
    ]);
  });

  it("um `pronto` que termina de ler depois de um `iniciando` não revive a base velha", async () => {
    // `Promise.withResolvers` não está no lib ES2020 do tsconfig.
    let soltar: (v: { base: string; token: string }) => void = () => {};
    const caixa: { ouvinte: OuvinteAndroid | null } = { ouvinte: null };
    _definirCascaParaTeste({
      lerEstado: async () => ({ estado: "iniciando" as const }),
      lerInfo: () => new Promise<{ base: string; token: string }>((r) => { soltar = r; }),
      pedirReinicio: async () => {},
      ouvirEstado: async (fn) => {
        caixa.ouvinte = fn;
        return () => { caixa.ouvinte = null; };
      },
    });
    const visto: EstadoBackend[] = [];
    await observarBackend((e) => visto.push(e));
    await assentar();

    caixa.ouvinte?.({ estado: "pronto" });
    caixa.ouvinte?.({ estado: "iniciando" });
    soltar({ base: "http://127.0.0.1:5123", token: TOKEN_A });
    await assentar();

    expect(baseLocal()).toBeNull();
    expect(visto).toEqual([{ estado: "iniciando" }, { estado: "iniciando" }]);
  });

  it("evento que chega durante a leitura inicial vence a leitura (que pode ser mais velha)", async () => {
    let ouvinte: OuvinteAndroid | null = null;
    _definirCascaParaTeste({
      lerEstado: async () => {
        ouvinte?.({ estado: "falhou", motivo: "cofre corrompido" });
        return { estado: "iniciando" };
      },
      lerInfo: async () => { throw "nao_pronto"; },
      pedirReinicio: async () => {},
      ouvirEstado: async (fn) => {
        ouvinte = fn;
        return () => { ouvinte = null; };
      },
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();

    expect(visto).toEqual([{ estado: "falhou", motivo: "cofre corrompido" }]);
  });

  it("`pronto` com `info()` falhando uma vez tenta de novo e segue", async () => {
    vi.useFakeTimers();
    let chamadas = 0;
    _definirCascaParaTeste({
      lerEstado: async () => ({ estado: "pronto" as const }),
      lerInfo: async () => {
        // Primeira leitura: o backend ainda está subindo (`nao_pronto`).
        if (++chamadas === 1) throw "nao_pronto";
        return { base: "http://127.0.0.1:5123", token: TOKEN_A };
      },
      pedirReinicio: async () => {},
      ouvirEstado: async () => () => {},
    });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();
    expect(visto).toEqual([]);

    await vi.advanceTimersByTimeAsync(ESPERA_RELEITURA_MS);

    expect(chamadas).toBe(2);
    expect(visto).toEqual([{ estado: "pronto" }]);
    expect(tokenLocal()).toBe(TOKEN_A);
  });

  it("`pronto` com `info()` falhando duas vezes vira `falhou`, em vez de ficar em \"Abrindo…\"", async () => {
    vi.useFakeTimers();
    simularPlugin({ estado: "pronto" });
    const visto: EstadoBackend[] = [];

    await observarBackend((e) => visto.push(e));
    await assentar();
    await vi.advanceTimersByTimeAsync(ESPERA_RELEITURA_MS);

    expect(MOTIVO_SEM_INFO).toBe("Não foi possível ler o endereço do backend local.");
    expect(visto).toEqual([{ estado: "falhou", motivo: MOTIVO_SEM_INFO }]);
    expect(baseLocal()).toBeNull();
  });

  it("`relerInfo` é single-flight também no Android", async () => {
    const stub = simularPlugin({ estado: "pronto" }, { base: "http://127.0.0.1:6000", token: TOKEN_B });

    await Promise.all([relerInfo(), relerInfo(), relerInfo()]);

    expect(stub.leiturasInfo()).toBe(1);
    expect(baseLocal()).toBe("http://127.0.0.1:6000");
    expect(tokenLocal()).toBe(TOKEN_B);
  });

  it("`relerInfo` com `nao_pronto` esquece a base e rejeita", async () => {
    simularPlugin({ estado: "iniciando" });
    _definirBackendParaTeste({ base: "http://127.0.0.1:6000", token: TOKEN_A });

    await expect(relerInfo()).rejects.toBe("nao_pronto");
    expect(baseLocal()).toBeNull();
    expect(tokenLocal()).toBeNull();
  });
});
