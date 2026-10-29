import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativo, isTauri } from "./plataforma";

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
