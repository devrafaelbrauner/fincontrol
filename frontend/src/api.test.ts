import { describe, expect, it } from "vitest";
import { competenciaAtual, hojeISO, paraCents } from "./api";

describe("paraCents", () => {
  it("converte formatos brasileiros para centavos", () => {
    expect(paraCents("12,34")).toBe(1234);
    expect(paraCents("R$ 12,34")).toBe(1234);
    expect(paraCents("10")).toBe(1000);
    expect(paraCents("0,50")).toBe(50);
  });

  it("aceita ponto como separador decimal", () => {
    expect(paraCents("12.34")).toBe(1234);
  });

  it("retorna NaN para entrada vazia ou sem número", () => {
    expect(paraCents("")).toBeNaN();
    expect(paraCents("abc")).toBeNaN();
  });
});

describe("datas locais", () => {
  it("hojeISO usa a data local, não UTC", () => {
    const d = new Date();
    const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(hojeISO()).toBe(esperado);
  });

  it("competenciaAtual é o prefixo YYYY-MM de hojeISO", () => {
    expect(competenciaAtual()).toBe(hojeISO().slice(0, 7));
    expect(competenciaAtual()).toMatch(/^\d{4}-\d{2}$/);
  });
});
