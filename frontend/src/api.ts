export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

function irParaLogin(): never {
  setToken(null);
  window.location.href = "/login";
  throw new Error("Não autenticado");
}

/** Tenta renovar o access token usando o refresh cookie httpOnly. Retorna o novo token ou null. */
async function renovar(): Promise<string | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  setToken(token);
  return token;
}

/** fetch com Bearer atual; em 401 (fora de /auth) tenta renovar uma vez e repete. */
async function comAuth(path: string, montar: (token: string | null) => RequestInit): Promise<Response> {
  let res = await fetch("/api" + path, { credentials: "include", ...montar(getToken()) });
  if (res.status === 401 && !path.startsWith("/auth")) {
    const novo = await renovar();
    if (!novo) irParaLogin();
    res = await fetch("/api" + path, { credentials: "include", ...montar(novo) });
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
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  setToken(null);
  window.location.href = "/login";
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 12,34" | "12,34" | "12.34" → 1234 centavos */
export const paraCents = (texto: string) =>
  Math.round(parseFloat(texto.replace(/[^\d,.-]/g, "").replace(",", ".")) * 100);

export const competenciaAtual = () => new Date().toISOString().slice(0, 7);

export const hojeISO = () => new Date().toISOString().slice(0, 10);
