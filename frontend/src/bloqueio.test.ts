import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bloquearNaCarga, decorridos, LIMITE_RESUME_MS, marcarAtividade, marcarLoginPorSenha, precisaDesbloquear,
  VALIDADE_LOGIN_POR_SENHA_MS,
} from "./bloqueio";

describe("gate de resume", () => {
  it("não tranca antes de 5 minutos de inatividade", () => {
    marcarAtividade(1_000_000);
    expect(precisaDesbloquear(1_000_000 + LIMITE_RESUME_MS - 1)).toBe(false);
    expect(decorridos(1_000_000 + LIMITE_RESUME_MS - 1)).toBe(LIMITE_RESUME_MS - 1);
  });

  it("tranca exatamente no limite e depois dele", () => {
    marcarAtividade(1_000_000);
    expect(precisaDesbloquear(1_000_000 + LIMITE_RESUME_MS)).toBe(true);
    expect(precisaDesbloquear(1_000_000 + LIMITE_RESUME_MS * 3)).toBe(true);
  });

  it("marcar atividade de novo zera o relógio", () => {
    marcarAtividade(0);
    expect(precisaDesbloquear(LIMITE_RESUME_MS)).toBe(true);
    marcarAtividade(LIMITE_RESUME_MS);
    expect(precisaDesbloquear(LIMITE_RESUME_MS + 1000)).toBe(false);
  });
});

/** sessionStorage de mentira: o vitest roda em node, sem DOM. Um objeto novo é
 *  um app reaberto (a sessionStorage morre com a janela). */
function sessionStorageFalso() {
  const mapa = new Map<string, string>();
  return {
    getItem: (k: string) => (mapa.has(k) ? mapa.get(k)! : null),
    setItem: (k: string, v: string) => { mapa.set(k, v); },
    removeItem: (k: string) => { mapa.delete(k); },
  };
}

describe("gate da carga da página (abertura a frio)", () => {
  beforeEach(() => { vi.stubGlobal("sessionStorage", sessionStorageFalso()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("abertura a frio com sessão e biometria tranca", () => {
    expect(bloquearNaCarga(true, 1_000_000)).toBe(true);
  });

  it("a carga logo depois de um login por senha não tranca, uma vez só", () => {
    marcarLoginPorSenha(1_000_000);
    expect(bloquearNaCarga(true, 1_000_000 + 1000)).toBe(false);
    expect(bloquearNaCarga(true, 1_000_000 + 2000)).toBe(true);
  });

  it("marca velha não vale: tranca", () => {
    marcarLoginPorSenha(1_000_000);
    expect(bloquearNaCarga(true, 1_000_000 + VALIDADE_LOGIN_POR_SENHA_MS)).toBe(true);
  });

  it("a marca não sobrevive ao app fechado e reaberto", () => {
    marcarLoginPorSenha(1_000_000);
    vi.stubGlobal("sessionStorage", sessionStorageFalso());
    expect(bloquearNaCarga(true, 1_000_000 + 1000)).toBe(true);
  });

  it("sem sessão ou sem biometria não tranca, e a marca é consumida", () => {
    marcarLoginPorSenha(1_000_000);
    expect(bloquearNaCarga(false, 1_000_000 + 1000)).toBe(false);
    expect(bloquearNaCarga(true, 1_000_000 + 2000)).toBe(true);
  });
});
