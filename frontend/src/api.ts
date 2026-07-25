export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401 && !path.startsWith("/auth")) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Não autenticado");
  }
  if (!res.ok) {
    const corpo = await res.json().catch(() => null);
    throw new Error(corpo?.detail ?? res.statusText);
  }
  return res.json();
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 12,34" | "12,34" | "12.34" → 1234 centavos */
export const paraCents = (texto: string) =>
  Math.round(parseFloat(texto.replace(/[^\d,.-]/g, "").replace(",", ".")) * 100);

export const competenciaAtual = () => new Date().toISOString().slice(0, 7);

export const hojeISO = () => new Date().toISOString().slice(0, 10);
