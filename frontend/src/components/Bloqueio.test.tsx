// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autenticarBiometrico } from "../nativo/biometria";
import { isTauriMac } from "../plataforma";
import Bloqueio from "./Bloqueio";

// O prompt fica pendente: a tela não muda de estado depois do teste.
vi.mock("../nativo/biometria", () => ({ autenticarBiometrico: vi.fn(() => new Promise<boolean>(() => {})) }));
vi.mock("../plataforma", () => ({ isTauriMac: vi.fn() }));

afterEach(cleanup);

describe("Bloqueio", () => {
  it("motivo do prompt: infinitivo no Mac (o macOS prefixa \"FinControl está tentando\"), frase completa nos demais", () => {
    vi.mocked(isTauriMac).mockReturnValue(true);
    render(<Bloqueio aoDesbloquear={() => {}} aoFalhar={() => {}} />);
    expect(autenticarBiometrico).toHaveBeenLastCalledWith("desbloquear o FinControl");
    cleanup();

    vi.mocked(isTauriMac).mockReturnValue(false);
    render(<Bloqueio aoDesbloquear={() => {}} aoFalhar={() => {}} />);
    expect(autenticarBiometrico).toHaveBeenLastCalledWith("Desbloqueie o FinControl");
  });
});
