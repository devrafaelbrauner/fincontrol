// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITE_RESUME_MS, marcarLoginPorSenha } from "../bloqueio";
import Login from "./Login";

/** O boot de main.tsx roda ao importar o módulo: `bootar` reimporta do zero,
 *  num aparelho nativo com biometria e um App de mentira ("app"). */
const m = vi.hoisted(() => ({
  isDesktopLocal: vi.fn(() => false),
  isBackendLocal: vi.fn(() => false),
  temSessao: vi.fn(() => false),
  contaConfigurada: vi.fn(async (): Promise<boolean | null> => true),
  // O backend embutido já nasce `pronto`; o espião conta quem passou pelo boot local.
  observarBackend: vi.fn(async (aoMudar: (e: { estado: "pronto" }) => void) => {
    aoMudar({ estado: "pronto" });
    return () => {};
  }),
}));

vi.mock("../plataforma", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isDesktopLocal: m.isDesktopLocal,
  isBackendLocal: m.isBackendLocal,
  isNativo: () => true,
}));
vi.mock("../sessao", () => ({ carregarSessao: async () => {}, limparSessao: async () => {}, temSessao: m.temSessao }));
vi.mock("../servidor", () => ({ carregarServidor: async () => {}, temApiBase: () => true }));
vi.mock("../nativo/biometria", () => ({
  biometriaDisponivel: async () => true,
  // O prompt fica pendente: a tela de bloqueio não sai do lugar.
  autenticarBiometrico: () => new Promise<boolean>(() => {}),
}));
vi.mock("../backendLocal", () => ({
  abrirPastaDeDados: async () => {},
  baseLocal: () => null,
  observarBackend: m.observarBackend,
  reiniciar: async () => {},
}));
vi.mock("../offline/estadoOffline", () => ({ atualizarContadores: async () => {}, definirOffline: () => {} }));
vi.mock("../estado", () => ({ EstadoProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../api", () => ({
  sincronizar: async () => {},
  contaConfigurada: m.contaConfigurada,
  login: async () => {},
  cadastrar: async () => {},
  api: async (caminho: string) =>
    caminho === "/auth/mfa/iniciar" ? { secret: "SEGREDO", otpauth_uri: "otpauth://totp/FinControl?secret=SEGREDO" } : {},
}));
vi.mock("../passkeys", () => ({ entrarComPasskey: async () => {}, cadastrarPasskey: async () => {}, temPasskey: async () => false }));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64," } }));
vi.mock("../App", () => ({ default: () => "app" }));

const MARCA = "fincontrol.login_por_senha";

type Plataforma = "servidor" | "desktop" | "android";

/** Os predicados de `plataforma` como cada build responde: só o desktop é
 *  `isDesktopLocal`; desktop e APK Android `local` são `isBackendLocal` (boot pela
 *  TelaBackend, o `iniciarLocal` do main.tsx); web, iOS e APK `nuvem` falam com o servidor. */
function emPlataforma(p: Plataforma) {
  m.isDesktopLocal.mockReturnValue(p === "desktop");
  m.isBackendLocal.mockReturnValue(p !== "servidor");
}

// As raízes que main.tsx cria são desmontadas no afterEach: a Raiz (e os
// listeners dela) de um boot anterior não reage aos eventos do caso seguinte.
const criarRoot = vi.spyOn(ReactDOM, "createRoot");

// Import dinâmico de propósito: main.tsx inicia o app ao ser importado, e cada
// teste precisa de um boot novo (um import estático rodaria uma vez só).
async function bootar(p: Plataforma) {
  emPlataforma(p);
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import("../main"); });
}

function visibilidade(estado: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

/** As saídas do Login navegam com `window.location.href = "/"`: aqui isso só
 *  registra para onde foi e se a marca já estava gravada naquele instante. */
function capturarNavegacao() {
  const idas: { para: string; marca: string | null }[] = [];
  vi.stubGlobal("location", {
    set href(para: string) { idas.push({ para, marca: sessionStorage.getItem(MARCA) }); },
  });
  return idas;
}

async function criarConta() {
  fireEvent.change(await screen.findByLabelText("Nome"), { target: { value: "Eu" } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "eu@exemplo.com" } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-forte-123!" } });
  fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "senha-forte-123!" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  await screen.findByText("Proteja sua conta");
}

afterEach(() => {
  cleanup();
  act(() => { for (const r of criarRoot.mock.results) if (r.type === "return") r.value.unmount(); });
  criarRoot.mockClear();
  m.observarBackend.mockClear();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
});

describe("saídas do Login por senha: a marca é gravada antes de navegar", () => {
  it("login", async () => {
    emPlataforma("desktop");
    m.contaConfigurada.mockResolvedValue(true);
    const idas = capturarNavegacao();
    render(<Login />);
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "eu@exemplo.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha-certa" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(idas).toEqual([{ para: "/", marca: expect.any(String) }]));
  });

  it("cadastro e confirmação do MFA", async () => {
    emPlataforma("desktop");
    m.contaConfigurada.mockResolvedValue(false);
    const idas = capturarNavegacao();
    render(<Login />);
    await criarConta();
    fireEvent.change(screen.getByLabelText("Código do app autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Ativar MFA e entrar" }));
    await waitFor(() => expect(idas).toEqual([{ para: "/", marca: expect.any(String) }]));
  });

  it("cadastro e \"Pular por enquanto\"", async () => {
    emPlataforma("desktop");
    m.contaConfigurada.mockResolvedValue(false);
    const idas = capturarNavegacao();
    render(<Login />);
    await criarConta();
    fireEvent.click(screen.getByRole("button", { name: "Pular por enquanto" }));
    expect(idas).toEqual([{ para: "/", marca: expect.any(String) }]);
  });
});

describe.each([
  { plataforma: "servidor", onde: "no seu servidor", passkey: true },
  { plataforma: "desktop", onde: "neste computador", passkey: false },
  { plataforma: "android", onde: "neste aparelho", passkey: false },
] as const)("cadastro em $plataforma", ({ plataforma, onde, passkey }) => {
  it(`diz que os dados ficam ${onde} e só oferece passkey com servidor`, async () => {
    emPlataforma(plataforma);
    m.contaConfigurada.mockResolvedValue(false);
    render(<Login />);
    expect(await screen.findByText(`Primeiro acesso: os dados ficam só ${onde}.`)).toBeTruthy();
    await criarConta();
    expect(screen.queryByRole("button", { name: "Cadastrar passkey neste aparelho" }) !== null).toBe(passkey);
  });
});

describe.each([
  { plataforma: "servidor", local: false },
  { plataforma: "desktop", local: true },
  { plataforma: "android", local: true },
] as const)("boot $plataforma: a abertura passa pela decisão da carga", ({ plataforma, local }) => {
  it("com sessão e biometria, tranca", async () => {
    m.temSessao.mockReturnValue(true);
    await bootar(plataforma);
    expect(screen.getByText("FinControl bloqueado")).toBeTruthy();
    // Modo local: o boot passou pelo `iniciarLocal` (TelaBackend → `pronto`), não pelo do servidor.
    expect(m.observarBackend).toHaveBeenCalledTimes(local ? 1 : 0);
  });

  it("logo depois de um login por senha, abre sem trancar e consome a marca", async () => {
    m.temSessao.mockReturnValue(true);
    marcarLoginPorSenha();
    await bootar(plataforma);
    expect(screen.getByText("app")).toBeTruthy();
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(m.observarBackend).toHaveBeenCalledTimes(local ? 1 : 0);
  });
});

describe("resume depois do cadastro no Android local (sessão aberta com o app já montado)", () => {
  it("antes do cadastro (sem sessão), voltar depois de 5 min escondido não tranca", async () => {
    m.temSessao.mockReturnValue(false);
    await bootar("android");
    const t0 = Date.now();
    vi.setSystemTime(t0);
    visibilidade("hidden");
    vi.setSystemTime(t0 + LIMITE_RESUME_MS);
    visibilidade("visible");
    expect(screen.getByText("app")).toBeTruthy();
  });

  it("voltar depois de 5 min escondido pede a biometria; antes disso, não", async () => {
    m.temSessao.mockReturnValue(false); // abriu no cadastro, sem sessão
    await bootar("android");
    expect(screen.getByText("app")).toBeTruthy();

    m.temSessao.mockReturnValue(true); // o cadastro abriu a sessão: tela do MFA
    const t0 = Date.now();
    vi.setSystemTime(t0);
    visibilidade("hidden"); // foi ao app autenticador e voltou antes do limite
    vi.setSystemTime(t0 + LIMITE_RESUME_MS - 1);
    visibilidade("visible");
    expect(screen.getByText("app")).toBeTruthy();

    visibilidade("hidden"); // esquecido no fundo
    vi.setSystemTime(t0 + 2 * LIMITE_RESUME_MS);
    visibilidade("visible");
    expect(screen.getByText("FinControl bloqueado")).toBeTruthy();
  });
});
