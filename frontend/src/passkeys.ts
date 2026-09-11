/** Passkeys (WebAuthn) no browser: entrar e cadastrar sem senha.
 *
 *  `entrarComPasskey()` faz o ceremony de login (begin -> navigator -> finish)
 *  e recarrega na `/` com a sessão que o backend emitiu (a mesma do login por
 *  senha: access + refresh, cookie + corpo nativo). Devolve `null` quando não há
 *  passkey cadastrada (o backend responde 404 no begin) — aí o chamador cai para
 *  senha+TOTP sem tratar como erro.
 *
 *  `cadastrarPasskey()` roda LOGADO (pós-login/cadastro): begin autenticado ->
 *  navigator -> finish autenticado. O nome do aparelho vai junto para a lista de
 *  Configurações saber "qual é qual".
 *
 *  Sem `navigator.credentials` (HTTP sem localhost, browser antigo) as funções
 *  lançam erro legível em vez de TypeError — o login por senha continua valendo.
 */

import { api, aplicarSessao } from "./api";

function exigirWebauthn(): void {
  if (typeof navigator === "undefined" || !navigator.credentials?.create || !navigator.credentials?.get) {
    throw new Error("Este navegador não suporta passkeys — use senha + código.");
  }
}

/** base64url do servidor <-> ArrayBuffer do navegador. */
function b64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesParaB64(bytes: ArrayBuffer | Uint8Array): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** challenge/id do JSON do servidor viram buffers; o resto passa direto. */
function opcoesParaRegistro(opcoes: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const o = opcoes as unknown as {
    challenge: string; user: { id: string }; excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  };
  return {
    ...(opcoes as unknown as object),
    challenge: b64ParaBytes(o.challenge).buffer as ArrayBuffer,
    user: { ...(o as unknown as { user: object }).user, id: b64ParaBytes(o.user.id) },
    excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({
      ...c, type: "public-key" as const, id: b64ParaBytes(c.id).buffer as ArrayBuffer,
    })),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function opcoesParaLogin(opcoes: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const o = opcoes as { challenge: string; allowCredentials?: { id: string; type: string; transports?: string[] }[] };
  return {
    ...(opcoes as object),
    challenge: b64ParaBytes(o.challenge).buffer as ArrayBuffer,
    allowCredentials: (o.allowCredentials ?? []).map((c) => ({
      ...c, type: "public-key" as const, id: b64ParaBytes(c.id).buffer as ArrayBuffer,
    })),
  } as PublicKeyCredentialRequestOptions;
}

/** Resposta do navigator vira JSON posteável (tudo base64url). */
function respostaParaJson(cred: PublicKeyCredential): Record<string, unknown> {
  const r = cred.response as AuthenticatorResponse;
  const base: Record<string, unknown> = {
    id: cred.id,
    rawId: bytesParaB64(cred.rawId),
    type: cred.type,
    response: {} as Record<string, unknown>,
  };
  const resp = base.response as Record<string, unknown>;
  if ("attestationObject" in r) {
    const att = r as AuthenticatorAttestationResponse;
    resp.clientDataJSON = bytesParaB64(att.clientDataJSON);
    resp.attestationObject = bytesParaB64(att.attestationObject);
    const t = att.getTransports?.();
    if (t) resp.transports = t;
  } else {
    const ass = r as AuthenticatorAssertionResponse;
    resp.clientDataJSON = bytesParaB64(ass.clientDataJSON);
    resp.authenticatorData = bytesParaB64(ass.authenticatorData);
    resp.signature = bytesParaB64(ass.signature);
    const uh = ass.userHandle;
    if (uh) resp.userHandle = bytesParaB64(uh);
  }
  return base;
}

/** Login por passkey. Sem passkey cadastrada (404) lança — o chamador cai para senha. */
export async function entrarComPasskey(): Promise<void> {
  exigirWebauthn();
  const inicio = await api<{ token: string; opcoes: Record<string, unknown> }>(
    "/auth/webauthn/login/begin", { method: "POST", body: "{}" });
  const cred = await navigator.credentials.get({
    publicKey: opcoesParaLogin(inicio.opcoes),
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey cancelada.");
  const sessao = await api<{ token: string; refresh_token?: string; nome?: string | null }>(
    "/auth/webauthn/login/finish", {
      method: "POST",
      body: JSON.stringify({ token: inicio.token, credencial: respostaParaJson(cred) }),
    });
  aplicarSessao(sessao);
  window.location.href = "/";
}

/** Há passkey cadastrada? Decide se o login mostra o botão primeiro.
 *  GET /status de propósito: o begin cria desafio e conta no rate limit. */
export async function temPasskey(): Promise<boolean> {
  try {
    const r = await api<{ cadastrado: boolean }>("/auth/webauthn/status");
    return r.cadastrado === true;
  } catch {
    return false;
  }
}

/** Cadastra a passkey deste aparelho (logado). */
export async function cadastrarPasskey(nome?: string): Promise<void> {
  exigirWebauthn();
  const inicio = await api<{ token: string; opcoes: Record<string, unknown> }>(
    "/auth/webauthn/register/begin", { method: "POST", body: JSON.stringify({ nome: nome ?? null }) });
  const cred = await navigator.credentials.create({
    publicKey: opcoesParaRegistro(inicio.opcoes),
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error("Cadastro de passkey cancelado.");
  await api("/auth/webauthn/register/finish", {
    method: "POST",
    body: JSON.stringify({ token: inicio.token, credencial: respostaParaJson(cred), nome: nome ?? null }),
  });
}
