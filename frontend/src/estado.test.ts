// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { assinarRetorno, INTERVALO_REVALIDACAO_MS } from "./estado";

/** Nada avisa que os dados mudaram noutro aparelho — sem WebSocket, SSE nem
 *  polling, a tela só busca quando é montada. Estes testes protegem o único
 *  momento em que revalidar é barato e certeiro: quando a pessoa volta a olhar. */

let limpar: (() => void) | null = null;

afterEach(() => {
  limpar?.();
  limpar = null;
  vi.useRealTimers();
});

function montar() {
  const aoVoltar = vi.fn();
  limpar = assinarRetorno(aoVoltar);
  return aoVoltar;
}

/** `document.hidden` é somente-leitura; para simular a aba escondida é preciso
 *  redefinir a propriedade. */
function definirOculto(oculto: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculto });
}

describe("revalidação ao voltar para o app", () => {
  it("revalida quando a janela ganha foco", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    window.dispatchEvent(new Event("focus"));
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("revalida quando a aba volta a ficar visível", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    definirOculto(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("não revalida quando a aba fica OCULTA", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    definirOculto(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(aoVoltar).not.toHaveBeenCalled();
    definirOculto(false);
  });

  it("cobre a volta pelo bfcache (pageshow)", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    window.dispatchEvent(new Event("pageshow"));
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("estrangula: alternar entre janelas não dispara um refetch por alternância", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus"));
    expect(aoVoltar).toHaveBeenCalledTimes(1);

    // Passado o intervalo, volta a valer.
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);
    window.dispatchEvent(new Event("focus"));
    expect(aoVoltar).toHaveBeenCalledTimes(2);
  });

  it("não revalida logo após montar — a tela acabou de buscar", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();

    window.dispatchEvent(new Event("focus"));
    expect(aoVoltar).not.toHaveBeenCalled();
  });

  it("para de ouvir depois da limpeza", () => {
    vi.useFakeTimers();
    const aoVoltar = montar();
    vi.advanceTimersByTime(INTERVALO_REVALIDACAO_MS + 1);

    limpar?.();
    limpar = null;
    window.dispatchEvent(new Event("focus"));
    expect(aoVoltar).not.toHaveBeenCalled();
  });
});
