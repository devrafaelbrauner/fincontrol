import { describe, expect, it } from "vitest";
import { decorridos, LIMITE_RESUME_MS, marcarAtividade, precisaDesbloquear } from "./bloqueio";

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
