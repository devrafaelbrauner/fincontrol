import { afterEach, describe, expect, it, vi } from "vitest";
import { cadastrar, competenciaAtual, contaConfigurada, hojeISO, mensagemDeErro, paraCents } from "./api";

describe("paraCents", () => {
  it("converte formatos brasileiros para centavos", () => {
    expect(paraCents("12,34")).toBe(1234);
    expect(paraCents("R$ 12,34")).toBe(1234);
    expect(paraCents("10")).toBe(1000);
    expect(paraCents("0,50")).toBe(50);
  });

  it("ponto em grupos de 3 é milhar, não decimal", () => {
    // Num campo de limite mensal, "1.500" é mil e quinhentos — tratá-lo como
    // R$ 1,50 criava um orçamento minúsculo que estourava (e notificava) na hora.
    expect(paraCents("1.500")).toBe(150_000);
    expect(paraCents("12.345")).toBe(1_234_500);
    expect(paraCents("R$ 1.234,56")).toBe(123_456);
    // Ponto fora do padrão de milhar continua decimal:
    expect(paraCents("1.50")).toBe(150);
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

describe("contaConfigurada", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respondeCom = (corpo: unknown, ok = true, status = 200) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok, status, json: async () => corpo, statusText: "",
    }));

  it("devolve o que o servidor afirmou", async () => {
    respondeCom({ configurado: true });
    expect(await contaConfigurada()).toBe(true);
    respondeCom({ configurado: false });
    expect(await contaConfigurada()).toBe(false);
  });

  it("devolve null quando não deu para saber, e não `true`", async () => {
    // `true` esconderia o link de cadastro: primeiro acesso com o backend ainda
    // subindo (502 do Caddy) ficaria sem conta para entrar e sem como criar.
    respondeCom(null, false, 502);
    expect(await contaConfigurada()).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede fora")));
    expect(await contaConfigurada()).toBeNull();
  });
});

describe("erros de auth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carregam o status HTTP, não só a mensagem", async () => {
    // O tratamento do 409 no cadastro depende disto: casar substring do `detail`
    // em português quebraria em silêncio se o texto do backend mudasse.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 409, statusText: "Conflict",
      json: async () => ({ detail: "Conta já configurada — use a tela de login" }),
    }));

    const erro = await cadastrar({ nome: "R", telefone: "", email: "a@b.c", senha: "Abc12@" })
      .then(() => null, (e) => e as Error & { status?: number });

    expect(erro?.status).toBe(409);
  });
});

describe("mensagemDeErro", () => {
  it("transforma a lista de erros de um 422 em texto legível", () => {
    // O FastAPI manda uma lista de campos num 422; jogá-la em `new Error`
    // rendia o toast "[object Object]", sem dizer qual campo foi recusado.
    const detail = [
      { type: "value_error", loc: ["body", "data"], msg: "Value error, Data deve estar no formato YYYY-MM-DD" },
    ];
    expect(mensagemDeErro(detail, "Erro")).toBe("data: Data deve estar no formato YYYY-MM-DD");
  });

  it("junta vários campos e ignora o prefixo 'body'", () => {
    const detail = [
      { loc: ["body", "prazo"], msg: "Value error, Data inválida" },
      { loc: ["body", "valor_cents"], msg: "Input should be greater than 0" },
    ];
    expect(mensagemDeErro(detail, "Erro")).toBe("prazo: Data inválida · valor_cents: Input should be greater than 0");
  });

  it("deixa passar o `detail` string dos HTTPException e cai no fallback quando não dá para ler", () => {
    expect(mensagemDeErro("Lançamento não encontrado", "Erro")).toBe("Lançamento não encontrado");
    expect(mensagemDeErro(undefined, "Bad Request")).toBe("Bad Request");
    expect(mensagemDeErro([], "Bad Request")).toBe("Bad Request");
  });
});
