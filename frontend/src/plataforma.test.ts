import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { isAndroidLocal, isBackendLocal, isNativo, isTauri, isTauriMac, prepararServiceWorker } from "./plataforma";

describe("isTauri", () => {
  // Roda em node (sem DOM): o Tauri 2 injeta `isTauri = true` no global da
  // janela, então o stub do global basta para simular o app desktop.
  afterEach(() => vi.unstubAllGlobals());

  it("no web não é Tauri", () => {
    expect(isTauri()).toBe(false);
  });

  it("com o global `isTauri` injetado pelo Tauri 2 é Tauri (e nativo)", () => {
    vi.stubGlobal("isTauri", true);
    expect(isTauri()).toBe(true);
    expect(isNativo()).toBe(true);
  });

  it("`__TAURI__` sozinho não conta (só existe com withGlobalTauri)", () => {
    vi.stubGlobal("__TAURI__", {});
    expect(isTauri()).toBe(false);
  });
});

describe("isTauriMac", () => {
  // Decide o motivo do prompt de biometria: só o Touch ID prefixa
  // "FinControl está tentando"; Windows Hello, iOS e Android mostram o motivo sozinho.
  afterEach(() => vi.unstubAllGlobals());
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

  it("app Tauri no macOS", () => {
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("navigator", { userAgent: MAC });
    expect(isTauriMac()).toBe(true);
  });

  it("Tauri no Windows não é; o iPadOS em modo desktop (diz Macintosh, sem Tauri) também não", () => {
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    });
    expect(isTauriMac()).toBe(false);
    vi.stubGlobal("isTauri", false);
    vi.stubGlobal("navigator", { userAgent: MAC });
    expect(isTauriMac()).toBe(false);
  });
});

describe("isAndroidLocal", () => {
  // O APK `local` é o único que registra o plugin `BackendLocal`: o mesmo
  // `dist/` decide em tempo de execução, sem `vite --mode`.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function simularAndroid(comPlugin: boolean) {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockImplementation((nome) => nome === "BackendLocal" && comPlugin);
  }

  it("no web não é (mesmo sem plugin)", () => {
    expect(isAndroidLocal()).toBe(false);
  });

  it("android sem o plugin (sabor `nuvem`) não é", () => {
    simularAndroid(false);
    expect(isAndroidLocal()).toBe(false);
  });

  it("android com o plugin (sabor `local`) é", () => {
    simularAndroid(true);
    expect(isAndroidLocal()).toBe(true);
  });

  it("iOS com um plugin de mesmo nome não é (a plataforma manda)", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
    expect(isAndroidLocal()).toBe(false);
  });
});

describe("isBackendLocal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("desktop (Tauri, sem Capacitor) é backend local", () => {
    vi.stubGlobal("isTauri", true);
    expect(isBackendLocal()).toBe(true);
  });

  it("APK `local` (android + plugin, sem Tauri) é backend local", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(true);
    expect(isBackendLocal()).toBe(true);
  });

  it("web, iOS e APK `nuvem` não são", () => {
    expect(isBackendLocal()).toBe(false);
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    expect(isBackendLocal()).toBe(false);
    vi.restoreAllMocks();
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.spyOn(Capacitor, "isPluginAvailable").mockReturnValue(false);
    expect(isBackendLocal()).toBe(false);
  });
});

describe("prepararServiceWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sem `navigator.serviceWorker` não faz nada (node)", () => {
    expect(() => prepararServiceWorker()).not.toThrow();
  });

  it("no modo local desregistra sobras em vez de registrar", async () => {
    vi.stubGlobal("isTauri", true);
    const desregistrar = vi.fn(async () => true);
    const registrar = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: async () => [{ unregister: desregistrar }], register: registrar } });
    prepararServiceWorker();
    // A desregistração é assíncrona (promise encadeada, sem await): espera.
    for (let i = 0; i < 10 && desregistrar.mock.calls.length === 0; i++) await Promise.resolve();
    expect(desregistrar).toHaveBeenCalledTimes(1);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("fora do modo local e fora de PROD não registra (dev)", () => {
    const registrar = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: async () => [], register: registrar } });
    prepararServiceWorker();
    expect(registrar).not.toHaveBeenCalled();
  });
});
