// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelaBackend, { LENTO_MS } from "./TelaBackend";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const nada = async () => {};

describe("TelaBackend", () => {
  it("iniciando: avisa que está abrindo, como status (sem roubar a leitura)", () => {
    const { getByRole, queryByRole } = render(
      <TelaBackend estado={{ estado: "iniciando" }} aoTentarDeNovo={nada} aoAbrirPasta={nada} />,
    );
    expect(getByRole("status").textContent).toContain("Abrindo o FinControl…");
    expect(queryByRole("alert")).toBeNull();
    expect(queryByRole("button")).toBeNull();
  });

  it("depois de 8 s em iniciando, diz que está demorando — e segue esperando", () => {
    vi.useFakeTimers();
    const { getByRole } = render(
      <TelaBackend estado={{ estado: "iniciando" }} aoTentarDeNovo={nada} aoAbrirPasta={nada} />,
    );
    expect(LENTO_MS).toBe(8_000);

    act(() => { vi.advanceTimersByTime(7_999); });
    expect(getByRole("status").textContent).not.toContain("Está demorando mais que o normal.");

    act(() => { vi.advanceTimersByTime(1); });
    expect(getByRole("status").textContent).toContain("Está demorando mais que o normal.");
    expect(getByRole("status").textContent).toContain("Abrindo o FinControl…");
  });

  it("falhou: mostra o motivo e os dois botões chamam suas ações", async () => {
    const tentar = vi.fn(async () => {});
    const abrir = vi.fn(async () => {});
    const { getByRole } = render(
      <TelaBackend estado={{ estado: "falhou", motivo: "backend não respondeu em 30 s" }}
        aoTentarDeNovo={tentar} aoAbrirPasta={abrir} />,
    );

    const alerta = getByRole("alert");
    expect(alerta.textContent).toContain("Não foi possível iniciar o FinControl.");
    expect(alerta.textContent).toContain("Seus dados não foram alterados.");
    expect(alerta.textContent).toContain("backend não respondeu em 30 s");

    await act(async () => { fireEvent.click(getByRole("button", { name: "Tentar de novo" })); });
    await act(async () => { fireEvent.click(getByRole("button", { name: "Abrir pasta de dados" })); });

    expect(tentar).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("os botões ficam desabilitados enquanto o reinício está em andamento", async () => {
    let terminar: () => void = () => {};
    const tentar = vi.fn(() => new Promise<void>((r) => { terminar = r; }));
    const { getByRole } = render(
      <TelaBackend estado={{ estado: "falhou", motivo: "x" }} aoTentarDeNovo={tentar} aoAbrirPasta={nada} />,
    );
    const botao = getByRole("button", { name: "Tentar de novo" }) as HTMLButtonElement;

    act(() => { fireEvent.click(botao); });
    expect(botao.disabled).toBe(true);
    expect((getByRole("button", { name: "Abrir pasta de dados" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { terminar(); });
    expect(botao.disabled).toBe(false);
  });

  it("o botão diz \"Tentando de novo…\" enquanto reinicia e volta ao rótulo depois", async () => {
    let terminar: () => void = () => {};
    const tentar = vi.fn(() => new Promise<void>((r) => { terminar = r; }));
    const { getByRole } = render(
      <TelaBackend estado={{ estado: "falhou", motivo: "x" }} aoTentarDeNovo={tentar} aoAbrirPasta={nada} />,
    );
    const botao = getByRole("button", { name: "Tentar de novo" }) as HTMLButtonElement;

    act(() => { fireEvent.click(botao); });
    expect(botao.textContent).toBe("Tentando de novo…");
    expect(getByRole("button", { name: "Tentando de novo…" })).toBe(botao);
    expect(botao.disabled).toBe(true);

    await act(async () => { terminar(); });
    expect(botao.textContent).toBe("Tentar de novo");
    expect(botao.disabled).toBe(false);
  });
});
