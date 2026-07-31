import { Capacitor } from "@capacitor/core";

// Base da API. Vazio no web (same-origin, Caddy faz o proxy de /api).
// Nos builds nativos (Capacitor), defina VITE_API_BASE com a URL absoluta do backend:
//   VITE_API_BASE=https://seu-dominio npm run ios
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
if (Capacitor.isNativePlatform() && !API_BASE) {
  // Sem a base, todo request cairia no asset handler do Capacitor (index.html)
  // e o login quebraria com erro de JSON. Falha alto e cedo.
  throw new Error("Build nativo sem VITE_API_BASE — rode: VITE_API_BASE=https://seu-dominio npm run ios");
}

// No web, o refresh token vive num cookie httpOnly gerenciado pelo backend.
// No app nativo (WebView cross-origin), o cookie não trafega: guardamos o refresh
// token localmente e o enviamos por header. O backend identifica o cliente por X-Client.
const NATIVE = Capacitor.isNativePlatform();
const CHAVE_REFRESH = "refresh_token";

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

function getRefresh(): string | null {
  return NATIVE ? localStorage.getItem(CHAVE_REFRESH) : null;
}

function setRefresh(token: string | null) {
  if (!NATIVE) return; // no web o refresh fica no cookie httpOnly, não no JS
  if (token) localStorage.setItem(CHAVE_REFRESH, token);
  else localStorage.removeItem(CHAVE_REFRESH);
}

/** Cabeçalhos que identificam o cliente nativo (e opcionalmente carregam o refresh token). */
function headersNativos(comRefresh = false): Record<string, string> {
  if (!NATIVE) return {};
  const h: Record<string, string> = { "X-Client": "native" };
  const r = comRefresh ? getRefresh() : null;
  if (r) h["X-Refresh-Token"] = r;
  return h;
}

/** Login: autentica e guarda o access token (e, no nativo, o refresh token). */
export async function login(senha: string, codigo_totp: string | null): Promise<void> {
  const res = await fetch(API_BASE + "/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...headersNativos() },
    body: JSON.stringify({ senha, codigo_totp }),
  });
  const corpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(corpo?.detail ?? res.statusText);
  const { token, refresh_token } = corpo as { token: string; refresh_token?: string };
  setToken(token);
  if (refresh_token) setRefresh(refresh_token);
}

function irParaLogin(): never {
  setToken(null);
  setRefresh(null);
  window.location.href = "/login";
  throw new Error("Não autenticado");
}

/** Renova o access token: web usa o cookie httpOnly; nativo manda o refresh token por header. */
async function renovar(): Promise<string | null> {
  const res = await fetch(API_BASE + "/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: headersNativos(true),
  });
  if (!res.ok) return null;
  const { token, refresh_token } = (await res.json()) as { token: string; refresh_token?: string };
  setToken(token);
  if (refresh_token) setRefresh(refresh_token);
  return token;
}

/** fetch com Bearer atual; em 401 (fora de /auth) tenta renovar uma vez e repete. */
async function comAuth(path: string, montar: (token: string | null) => RequestInit): Promise<Response> {
  let res = await fetch(API_BASE + "/api" + path, { credentials: "include", ...montar(getToken()) });
  if (res.status === 401 && !path.startsWith("/auth")) {
    const novo = await renovar();
    if (!novo) irParaLogin();
    res = await fetch(API_BASE + "/api" + path, { credentials: "include", ...montar(novo) });
    if (res.status === 401) irParaLogin();
  }
  return res;
}

async function corpoOuErro<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(corpo?.detail ?? res.statusText);
  }
  return res.json();
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    throw new Error(corpo?.detail ?? res.statusText);
  }
  return corpoOuErro<T>(res);
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
  await fetch(API_BASE + "/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: headersNativos(),
  }).catch(() => {});
  setToken(null);
  setRefresh(null);
  window.location.href = "/login";
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 12,34" | "12,34" | "12.34" → 1234 centavos */
export const paraCents = (texto: string) =>
  Math.round(parseFloat(texto.replace(/[^\d,.-]/g, "").replace(",", ".")) * 100);

/** Data local (não UTC): à noite o toISOString() já viraria o dia/mês seguinte. */
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const competenciaAtual = () => hojeISO().slice(0, 7);
