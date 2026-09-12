import { guardarGet, lerGet } from "./offline/cache";
import { atualizarContadores, definirOffline, registrarCacheEm } from "./offline/estadoOffline";
import { type ItemFila, enfileirar } from "./offline/fila";
import { aplicarOtimista } from "./offline/otimista";
import { drenarFila } from "./offline/sincronizador";
import { isNativo } from "./plataforma";
import { guardarRefresh, guardarSessao as salvarSessao, guardarToken, getRefresh, getToken, limparSessao } from "./sessao";
import { getApiBase } from "./servidor";

export { isNativo };
export { getToken } from "./sessao";

/** Falha de REDE (o fetch rejeitou), distinta de um erro HTTP nosso. Só ela
 *  dispara o caminho offline: um 401/409/500 é resposta do servidor e não pode
 *  ser confundido com "estou sem conexão". */
function ehFalhaDeRede(e: unknown): boolean {
  return e instanceof TypeError || (e as { name?: string } | null)?.name === "AbortError";
}

/** Prefixos cuja escrita pode esperar na fila. Ficam de fora IA, push, auth,
 *  importação e anexos: dependem do servidor na hora (ou são multipart). */
const ENFILEIRAVEIS = [
  "/variaveis", "/entradas", "/metas", "/categorias", "/orcamentos",
  "/compromissos", "/contas-fixas", "/contas-bancarias",
];

function podeEnfileirar(path: string, method: string): boolean {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return false;
  return ENFILEIRAVEIS.some((p) => path === p || path.startsWith(`${p}/`));
}

function cabecalhoIfMatch(options: RequestInit): string | null {
  const h = options.headers;
  if (!h || Array.isArray(h)) return null;
  const bruto = (h as Record<string, string>)["If-Match"];
  return bruto ?? null;
}

/** Cabeçalhos que identificam o cliente nativo (e opcionalmente carregam o refresh token). */
function headersNativos(comRefresh = false): Record<string, string> {
  if (!isNativo()) return {};
  const h: Record<string, string> = { "X-Client": "native" };
  const r = comRefresh ? getRefresh() : null;
  if (r) h["X-Refresh-Token"] = r;
  return h;
}

/** Texto legível do `detail` de um erro da API.
 *
 *  Num 422 o FastAPI manda uma LISTA de erros de campo, não uma string — e
 *  `new Error(lista)` virava o toast "[object Object]", que não diz nem qual
 *  campo recusou. Aqui vira "data: Data deve estar no formato YYYY-MM-DD". */
export function mensagemDeErro(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const partes = detail.map((d) => {
      const e = d as { loc?: unknown[]; msg?: string };
      // loc é ["body", "campo"] — ou ["query", "de"], desde que os filtros de
      // data também validam no schema. Onde o valor veio é ruído para quem lê:
      // o que importa é o nome do campo.
      const ORIGENS = ["body", "query", "path"];
      const campo = Array.isArray(e.loc)
        ? e.loc.filter((l) => typeof l === "string" && !ORIGENS.includes(l)).join(".")
        : "";
      const msg = (e.msg ?? "").replace(/^Value error, /, "");
      return campo && msg ? `${campo}: ${msg}` : msg || campo;
    }).filter(Boolean);
    if (partes.length) return partes.join(" · ");
  }
  return fallback;
}

/** Aplica a sessão devolvida por /auth/login ou /auth/webauthn/login/finish.
 *
 *  Async porque, no nativo, o token vai para o cofre do aparelho — quem chama
 *  precisa do `await` antes de navegar, senão a tela nova lê a sessão vazia. */
export async function aplicarSessao(corpo: { token: string; refresh_token?: string; nome?: string | null }) {
  await salvarSessao(corpo);
}

async function postAuth(path: string, body: unknown): Promise<void> {
  const res = await fetch(getApiBase() + "/api/auth/" + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...headersNativos() },
    body: JSON.stringify(body),
  });
  const corpo = await res.json().catch(() => null);
  if (!res.ok) {
    // O status vai junto: quem trata o erro não deveria precisar casar substring
    // de mensagem em português — reescrever um `detail` no backend quebraria o
    // tratamento em silêncio.
    const erro = new Error(mensagemDeErro(corpo?.detail, res.statusText)) as Error & { status?: number };
    erro.status = res.status;
    throw erro;
  }
  await salvarSessao(corpo);
}

/** Login: autentica e guarda o access token (e, no nativo, o refresh token). */
export const login = (dados: { email: string; senha: string; codigo_totp?: string | null; lembrar?: boolean }) =>
  postAuth("login", dados);

/** Cadastro (primeiro uso): cria a conta única e já entra logado. */
export const cadastrar = (dados: { nome: string; telefone: string; email: string; senha: string }) =>
  postAuth("cadastro", dados);

/** Público: existe conta configurada? Decide entre tela de login e de cadastro.
 *
 *  `null` = não deu para saber (backend fora do ar, 502 do Caddy durante o boot).
 *  Distinguir isso de `true` importa: "tem conta" esconde o link de cadastro, e
 *  fazer isso na dúvida trancaria o primeiro acesso de uma instalação nova cujo
 *  backend só demorou a subir — sem conta para entrar e sem caminho para criar. */
export async function contaConfigurada(): Promise<boolean | null> {
  try {
    const res = await fetch(getApiBase() + "/api/auth/status", { credentials: "include" });
    if (!res.ok) return null;
    return ((await res.json()) as { configurado: boolean }).configurado;
  } catch {
    return null;
  }
}

async function irParaLogin(): Promise<never> {
  await limparSessao();
  window.location.href = "/login";
  throw new Error("Não autenticado");
}

async function renovarAgora(): Promise<string | null> {
  const res = await fetch(getApiBase() + "/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: headersNativos(true),
  });
  if (!res.ok) return null;
  const { token, refresh_token } = (await res.json()) as { token: string; refresh_token?: string };
  await guardarToken(token);
  if (refresh_token) await guardarRefresh(refresh_token);
  return token;
}

/** Renovação em voo, compartilhada por todas as chamadas que esbarrarem no 401. */
let renovacaoEmVoo: Promise<string | null> | null = null;

/** Renova o access token: web usa o cookie httpOnly; nativo manda o refresh token por header.
 *
 *  **Single-flight de propósito.** Uma tela com `Promise.all` (Dashboard, Análises)
 *  dispara várias chamadas de uma vez; vencido o access token, todas voltam 401
 *  juntas. Sem compartilhar a renovação, viravam N POSTs a /refresh com o MESMO
 *  refresh token: o primeiro rotaciona e os demais chegam com o token já gasto,
 *  que o servidor lê como vazamento e responde revogando TODAS as sessões — o
 *  iPhone e o Mac caíam na tela de login por causa de um F5 no navegador.
 *  Reproduzido com 6 chamadas: 3 sessões viravam 0. O servidor ganhou uma janela
 *  de graça para o mesmo caso (auth.JANELA_GRACA_SEGUNDOS); os dois lados juntos
 *  é que fecham o buraco — este evita a corrida, aquele perdoa a que escapar. */
function renovar(): Promise<string | null> {
  if (!renovacaoEmVoo) {
    // Zera na conclusão para que o próximo 401 (dali a 30 min) renove de novo,
    // em vez de reaproveitar um token já vencido.
    renovacaoEmVoo = renovarAgora().finally(() => { renovacaoEmVoo = null; });
  }
  return renovacaoEmVoo;
}

/** fetch com Bearer atual; em 401 (fora das rotas públicas de /auth) tenta renovar uma vez e repete. */
async function comAuth(path: string, montar: (token: string | null) => RequestInit): Promise<Response> {
  let res = await fetch(getApiBase() + "/api" + path, { credentials: "include", ...montar(getToken()) });
  // /auth/mfa/* é autenticada como as demais; só login/refresh/etc. ficam fora do retry.
  if (res.status === 401 && (!path.startsWith("/auth") || path.startsWith("/auth/mfa"))) {
    const novo = await renovar();
    if (!novo) await irParaLogin();
    res = await fetch(getApiBase() + "/api" + path, { credentials: "include", ...montar(novo) });
    if (res.status === 401) await irParaLogin();
  }
  return res;
}

async function corpoOuErro<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    const erro = new Error(mensagemDeErro(corpo?.detail, res.statusText)) as Error & { status?: number };
    // O status acompanha o erro para quem quiser distinguir um conflito de
    // edição (409) de um erro qualquer — casar substring de mensagem quebraria
    // no dia em que o texto mudasse.
    erro.status = res.status;
    throw erro;
  }
  return res.json();
}

/** O erro é um conflito de edição (409)? A tela recarrega para mostrar a versão
 *  atual em vez de insistir com a cópia velha. */
export function ehConflito(e: unknown): boolean {
  return (e as { status?: number } | null)?.status === 409;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const metodo = (options.method ?? "GET").toUpperCase();
  if (metodo === "GET") return buscarComCache<T>(path, options);

  try {
    return await executarMutacao<T>(path, options);
  } catch (e) {
    if (!ehFalhaDeRede(e) || !podeEnfileirar(path, metodo)) throw e;
    // Sem conexão: guarda a escrita (com o If-Match lido na tela) para o replay
    // e reflete a mudança no cache, para a leitura offline não mostrar o dado
    // velho como se nada tivesse acontecido.
    const item = await enfileirar({
      method: metodo,
      path,
      body: typeof options.body === "string" ? options.body : null,
      ifMatch: cabecalhoIfMatch(options),
    });
    await aplicarOtimista(item);
    definirOffline(true);
    await atualizarContadores();
    // Resposta sintética: a tela segue o fluxo (o refetch cai no cache) e o
    // banner mostra que há escrita pendente. O id negativo é o mesmo do item
    // otimista no cache, para quem usar o retorno não pegar um id diferente.
    return (metodo === "POST" ? { id: -item.id } : { ok: true }) as T;
  }
}

async function executarMutacao<T>(path: string, options: RequestInit): Promise<T> {
  const res = await comAuth(path, (token) => ({
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  }));
  if (res.status === 401 && path.startsWith("/auth")) {
    const corpo = await res.json().catch(() => null);
    throw new Error(mensagemDeErro(corpo?.detail, res.statusText));
  }
  return corpoOuErro<T>(res);
}

/** GET: guarda a última resposta boa e, se a rede cair, serve o snapshot. */
async function buscarComCache<T>(path: string, options: RequestInit): Promise<T> {
  try {
    const res = await comAuth(path, (token) => ({
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    }));
    const dados = await corpoOuErro<T>(res);
    try { await guardarGet(path, dados); } catch { /* sem armazém, segue online */ }
    definirOffline(false);
    registrarCacheEm(null);
    return dados;
  } catch (e) {
    if (!ehFalhaDeRede(e)) throw e;
    const rascunho = await lerGet<T>(path).catch(() => null);
    definirOffline(true);
    if (rascunho) {
      registrarCacheEm(rascunho.em);
      return rascunho.dados;
    }
    throw new Error("Sem conexão e sem dados salvos para esta tela.");
  }
}

/** Reenvia um item da fila direto no fetch (sem passar por `api`, para não
 *  reenfileirar em loop). O 409 sobe como status para o sincronizador marcar. */
async function executarDaFila(item: ItemFila): Promise<{ status: number; detail?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (item.ifMatch) headers["If-Match"] = item.ifMatch;
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(getApiBase() + "/api" + item.path, {
    method: item.method,
    credentials: "include",
    headers,
    body: item.body ?? undefined,
  });
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    return { status: res.status, detail: mensagemDeErro(corpo?.detail, res.statusText) };
  }
  return { status: res.status };
}

/** Repete a fila offline. Chamado quando a conexão volta, no foreground e no
 *  boot. Single-flight: dois drains concorrentes leriam os MESMOS itens e os
 *  enviariam em dobro. */
let sincronizacaoEmVoo: Promise<void> | null = null;

export function sincronizar(): Promise<void> {
  if (!sincronizacaoEmVoo) {
    // 401 no meio do replay tenta renovar UMA vez (mesmo single-flight das
    // chamadas normais) antes de desistir e mandar para o login.
    sincronizacaoEmVoo = drenarFila(executarDaFila, async () => Boolean(await renovar()))
      .then(() => undefined)
      .finally(() => { sincronizacaoEmVoo = null; });
  }
  return sincronizacaoEmVoo;
}

/** Upload multipart — não define Content-Type manualmente (o browser define com o boundary correto). */
export async function apiUpload<T>(path: string, arquivo: File): Promise<T> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await comAuth(path, (token) => ({
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>),
    body: form,
  }));
  return corpoOuErro<T>(res);
}

/** Baixa um anexo autenticado e devolve uma object URL para exibir/abrir no navegador. */
export async function abrirAnexo(anexoId: number): Promise<void> {
  const res = await comAuth(`/anexos/${anexoId}`, (token) => ({
    headers: token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>),
  }));
  if (!res.ok) throw new Error("Não foi possível abrir o anexo");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function logout(): Promise<void> {
  await fetch(getApiBase() + "/api/auth/logout", {
    method: "POST",
    credentials: "include",
    // `true` manda o X-Refresh-Token. Sem ele, o app nativo — onde o cookie não
    // trafega (WebView cross-origin) — pedia logout sem se identificar: o
    // servidor não tinha o que revogar e a sessão seguia viva por até 30 dias,
    // enquanto o "Sair" parecia ter funcionado porque limpava o armazenamento.
    headers: headersNativos(true),
  }).catch(() => {});
  await limparSessao();
  window.location.href = "/login";
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Valor curto, para rótulo de eixo: "R$ 1,2 mil", "R$ 125 mil", "R$ 1,2 mi".
 *
 *  Existe porque `brl()` por extenso não cabe num eixo — "R$ 8.090,48" ocupa
 *  quase um terço da largura do gráfico num celular, e são três ou quatro
 *  desses empilhados na lateral. Aqui a precisão não importa: o eixo dá a
 *  ordem de grandeza, e o valor exato está na linha de leitura.
 *
 *  Uma casa decimal só abaixo de 100 unidades ("R$ 1,2 mil" mas "R$ 125 mil"):
 *  acima disso o dígito depois da vírgula é ruído que só alarga o rótulo. */
export function abreviarBRL(cents: number, comMoeda = true): string {
  const reais = cents / 100;
  const sinal = reais < 0 ? "-" : "";
  const abs = Math.abs(reais);
  const pre = `${sinal}${comMoeda ? "R$ " : ""}`;
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 });
  if (abs >= 1_000_000) return `${pre}${fmt(abs / 1_000_000)} mi`;
  if (abs >= 1_000) return `${pre}${fmt(abs / 1_000)} mil`;
  return `${pre}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** "R$ 12,34" | "12,34" | "12.34" → 1234 centavos */
export const paraCents = (texto: string) => {
  let t = texto.replace(/[^\d,.-]/g, "");
  if (t.includes(",")) {
    // Com vírgula, ela é o decimal e os pontos são milhar: "1.234,56".
    // (Antes, o parseFloat parava no segundo ponto e "1.234,56" virava R$ 1,23.)
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // Só pontos, em grupos de 3: milhar à brasileira — "1.500" é mil e
    // quinhentos, não um real e cinquenta. "1.50" segue sendo decimal.
    t = t.replace(/\./g, "");
  }
  return Math.round(parseFloat(t) * 100);
};

/** Data local (não UTC): à noite o toISOString() já viraria o dia/mês seguinte. */
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const competenciaAtual = () => hojeISO().slice(0, 7);
