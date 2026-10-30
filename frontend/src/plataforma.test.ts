import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativo, isTauri, isTauriMac } from "./plataforma";

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
