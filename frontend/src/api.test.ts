import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { abreviarBRL, abrirAnexo, api, cadastrar, competenciaAtual, contaConfigurada, hojeISO, isNativo, mensagemDeErro, paraCents, sincronizar } from "./api";
import { _definirBackendParaTeste } from "./backendLocal";
import { _definirCofreParaTeste } from "./nativo/cofre";
import { _definirArmazemParaTeste, armazemMemoria } from "./offline/banco";
import { listarFila } from "./offline/fila";
import { getToken, guardarToken } from "./sessao";

// Só o `invoke` é trocado; o `isTauri` real lê o global, que os testes do
// desktop ligam com `vi.stubGlobal("isTauri", true)`.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  invoke: vi.fn(),
}));

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

  it("ignora também o prefixo 'query', dos filtros de data validados no schema", () => {
    // `GET /variaveis?de=15/08/2026` responde 422 com loc ["query", "de"];
    // sem tirar o prefixo, o toast diria "query.de: ..." — o "query" não
    // significa nada para quem está olhando o filtro na tela.
    const detail = [
      { loc: ["query", "de"], msg: "Value error, Data deve estar no formato YYYY-MM-DD (recebido: '15/08/2026')" },
    ];
    expect(mensagemDeErro(detail, "Erro")).toBe(
      "de: Data deve estar no formato YYYY-MM-DD (recebido: '15/08/2026')",
    );
  });

  it("deixa passar o `detail` string dos HTTPException e cai no fallback quando não dá para ler", () => {
    expect(mensagemDeErro("Lançamento não encontrado", "Erro")).toBe("Lançamento não encontrado");
    expect(mensagemDeErro(undefined, "Bad Request")).toBe("Bad Request");
    expect(mensagemDeErro([], "Bad Request")).toBe("Bad Request");
  });
});

describe("abreviarBRL", () => {
  it("abrevia milhar e milhão em pt-BR", () => {
    expect(abreviarBRL(120_000)).toBe("R$ 1,2 mil");
    expect(abreviarBRL(1_250_000)).toBe("R$ 12,5 mil");
    expect(abreviarBRL(150_000_000)).toBe("R$ 1,5 mi");
  });

  it("acima de 100 unidades, corta a casa decimal", () => {
    // "R$ 125,4 mil" não cabe melhor que "R$ 125 mil" e não informa mais nada:
    // num eixo, a ordem de grandeza é o que se lê.
    expect(abreviarBRL(12_540_000)).toBe("R$ 125 mil");
  });

  it("abaixo de mil, sai por extenso e sem centavos", () => {
    expect(abreviarBRL(95_000)).toBe("R$ 950");
    expect(abreviarBRL(0)).toBe("R$ 0");
  });

  it("sem moeda, para o eixo, onde ela já foi dita na linha de leitura", () => {
    // Medido na tela: com "R$", o rótulo "R$ 7,5 mil" não cabia na calha e
    // saía cortado pela borda do viewBox.
    expect(abreviarBRL(750_000, false)).toBe("7,5 mil");
    expect(abreviarBRL(0, false)).toBe("0");
    expect(abreviarBRL(-120_000, false)).toBe("-1,2 mil");
  });

  it("preserva o sinal", () => {
    // O eixo do fluxo desce abaixo do zero quando o saldo é negativo.
    expect(abreviarBRL(-120_000)).toBe("-R$ 1,2 mil");
    expect(abreviarBRL(-95_000)).toBe("-R$ 950");
  });
});

describe("isNativo", () => {
  // Este arquivo roda em node (sem DOM). O ramo Tauri (global `isTauri`) é
  // coberto em plataforma.test.ts; aqui vale o ramo Capacitor.
  afterEach(() => vi.unstubAllGlobals());

  it("Capacitor nativo dispara o caminho nativo (etapa 1 do plano)", async () => {
    // O throw de VITE_API_BASE ausente usa isNativo(): o cheque aqui é da
    // FUNÇÃO (o throw roda no import, com cache — reimportar não re-executa).
    const { Capacitor } = await import("@capacitor/core");
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(isNativo()).toBe(true);
    vi.restoreAllMocks();
  });

  it("no web (sem Capacitor) não é nativo", async () => {
    const { Capacitor } = await import("@capacitor/core");
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    expect(isNativo()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("desktop: backend local", () => {
  const TOKEN_A = "a".repeat(64);
  const TOKEN_B = "b".repeat(64);
  const JWT = "jwt-da-sessao";

  const cofreMemoria = () => {
    const mapa = new Map<string, string>();
    return {
      ler: async (k: string) => mapa.get(k) ?? null,
      gravar: async (k: string, v: string) => { mapa.set(k, v); },
      apagar: async (k: string) => { mapa.delete(k); },
    };
  };

  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

  /** Cabeçalhos e opções de cada fetch, como o navegador os receberia. */
  const chamadas = (fetchMock: Mock) =>
    (fetchMock.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
      url,
      credentials: init.credentials,
      token: new Headers(init.headers).get("X-FinControl-Token"),
      auth: new Headers(init.headers).get("Authorization"),
    }));

  beforeEach(async () => {
    vi.stubGlobal("isTauri", true);
    _definirCofreParaTeste(cofreMemoria());
    _definirArmazemParaTeste(armazemMemoria());
    await guardarToken(JWT);
    _definirBackendParaTeste({ base: "http://127.0.0.1:5123", token: TOKEN_A });
  });

  afterEach(async () => {
    await guardarToken(null);
    vi.unstubAllGlobals();
    vi.mocked(invoke).mockReset();
    _definirBackendParaTeste(null);
    _definirCofreParaTeste(null);
    _definirArmazemParaTeste(null);
  });

  it("manda o token local, sem cookies, para a base local", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/dashboard");
    await cadastrar({ nome: "R", telefone: "", email: "a@b.c", senha: "Abc12@" }).catch(() => {});

    expect(chamadas(fetchMock)).toEqual([
      { url: "http://127.0.0.1:5123/api/dashboard", credentials: "omit", token: TOKEN_A, auth: `Bearer ${JWT}` },
      { url: "http://127.0.0.1:5123/api/auth/cadastro", credentials: "omit", token: TOKEN_A, auth: null },
    ]);
  });

  it("sem backend pronto a requisição nem sai, e falha como falta de rede", async () => {
    _definirBackendParaTeste(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const erro = await cadastrar({ nome: "R", telefone: "", email: "a@b.c", senha: "Abc12@" })
      .then(() => null, (e: unknown) => e);
    // GET sem cache: o caminho offline de sempre assume.
    const offline = await api("/dashboard").then(() => null, (e: Error) => e.message);

    expect(erro).toBeInstanceOf(TypeError);
    expect(offline).toBe("Sem conexão e sem dados salvos para esta tela.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escrita enfileirável sem backend pronto vai para a fila sem fetch, e o replay também espera", async () => {
    _definirBackendParaTeste(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const corpo = JSON.stringify({ nome: "Mercado", valor_cents: 1234 });

    const resposta = await api<{ id: number }>("/variaveis", { method: "POST", body: corpo });
    await sincronizar();

    const fila = await listarFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ method: "POST", path: "/variaveis", body: corpo, status: "pendente" });
    expect(resposta).toEqual({ id: -fila[0].id });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 `token_local` relê o backend_info e repete uma vez, sem refresh e sem deslogar", async () => {
    vi.mocked(invoke).mockResolvedValue({ base: "http://127.0.0.1:6000", token: TOKEN_B });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ detail: "token_local" }, 401))
      .mockResolvedValueOnce(json({ saldo: 10 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await api("/dashboard")).toEqual({ saldo: 10 });

    expect(vi.mocked(invoke).mock.calls).toEqual([["backend_info"]]);
    expect(chamadas(fetchMock)).toEqual([
      { url: "http://127.0.0.1:5123/api/dashboard", credentials: "omit", token: TOKEN_A, auth: `Bearer ${JWT}` },
      { url: "http://127.0.0.1:6000/api/dashboard", credentials: "omit", token: TOKEN_B, auth: `Bearer ${JWT}` },
    ]);
    expect(getToken()).toBe(JWT);
  });

  it("dois 401 `token_local` seguidos viram falta de rede (TypeError), sem refresh e sem deslogar", async () => {
    vi.mocked(invoke).mockResolvedValue({ base: "http://127.0.0.1:6000", token: TOKEN_B });
    const fetchMock = vi.fn().mockImplementation(async () => json({ detail: "token_local" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const erro = await api("/ia/config", { method: "PUT", body: "{}" }).then(() => null, (e: unknown) => e);

    expect(erro).toBeInstanceOf(TypeError);
    expect(chamadas(fetchMock).map((c) => c.url)).toEqual([
      "http://127.0.0.1:5123/api/ia/config",
      "http://127.0.0.1:6000/api/ia/config",
    ]);
    expect(getToken()).toBe(JWT);
  });

  it("abre o anexo pelo POST /abrir e aceita o 204 sem corpo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await abrirAnexo(7);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:5123/api/anexos/7/abrir");
    expect(init.method).toBe("POST");
  });

  it("no web segue igual: cookies incluídos e nenhum token local", async () => {
    vi.stubGlobal("isTauri", false);
    const fetchMock = vi.fn().mockResolvedValue(json({ configurado: true }));
    vi.stubGlobal("fetch", fetchMock);

    await contaConfigurada();

    expect(fetchMock.mock.calls).toEqual([["/api/auth/status", { credentials: "include" }]]);
  });
});
