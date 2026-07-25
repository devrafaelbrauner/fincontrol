export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

async function tratarResposta<T>(res: Response, path: string): Promise<T> {
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
  return tratarResposta<T>(res, path);
}

/** Upload multipart — não define Content-Type manualmente (o browser define com o boundary correto). */
export async function apiUpload<T>(path: string, arquivo: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await fetch("/api" + path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return tratarResposta<T>(res, path);
}

/** Baixa um anexo autenticado e devolve uma object URL para exibir/abrir no navegador. */
export async function abrirAnexo(anexoId: number): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/anexos/${anexoId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Não foi possível abrir o anexo");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 12,34" | "12,34" | "12.34" → 1234 centavos */
export const paraCents = (texto: string) =>
  Math.round(parseFloat(texto.replace(/[^\d,.-]/g, "").replace(",", ".")) * 100);

export const competenciaAtual = () => new Date().toISOString().slice(0, 7);

export const hojeISO = () => new Date().toISOString().slice(0, 10);
