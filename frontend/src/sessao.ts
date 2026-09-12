import { cofre } from "./nativo/cofre";
import { isNativo } from "./plataforma";

/** Sessão: onde cada token vive, por plataforma.
 *
 * - Web: access no `localStorage` (recarregar a aba não pode derrubar para o
 *   login), refresh num cookie httpOnly que o JS nem enxerga.
 * - Nativo: os DOIS no cofre do aparelho (Keychain/Keystore/Credential Manager).
 *   O access fica também em memória para o `fetch` ser síncrono.
 *
 * A migração de quem veio da 1.1.0 (refresh no localStorage) roda uma vez no
 * boot: lê, grava no cofre e apaga — não fingir que já não morava lá. */

const CHAVE_TOKEN = "token";
const CHAVE_REFRESH = "refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;

export interface SessaoRecebida {
  token: string;
  refresh_token?: string;
  nome?: string | null;
}

export function getToken(): string | null {
  return accessToken;
}

export function getRefresh(): string | null {
  return refreshToken;
}

/** Há credencial de sessão (access ou refresh)? Decide o gate de desbloqueio. */
export function temSessao(): boolean {
  return Boolean(accessToken || refreshToken);
}

/** Carrega a sessão no boot e migra o localStorage da 1.1.0 para o cofre. */
export async function carregarSessao(): Promise<void> {
  if (!isNativo()) {
    // Web: o access continua no localStorage; o refresh é cookie httpOnly.
    try { accessToken = localStorage.getItem(CHAVE_TOKEN); } catch { accessToken = null; }
    return;
  }
  const c = await cofre();
  const velhoRefresh = localStorage.getItem(CHAVE_REFRESH);
  const velhoToken = localStorage.getItem(CHAVE_TOKEN);
  const cofreRefresh = await c.ler(CHAVE_REFRESH);
  const cofreToken = await c.ler(CHAVE_TOKEN);

  if (velhoRefresh && !cofreRefresh) {
    await c.gravar(CHAVE_REFRESH, velhoRefresh);
    refreshToken = velhoRefresh;
  } else {
    refreshToken = cofreRefresh;
  }
  if (velhoToken && !cofreToken) {
    await c.gravar(CHAVE_TOKEN, velhoToken);
    accessToken = velhoToken;
  } else {
    accessToken = cofreToken;
  }
  // A partir daqui o nativo não guarda mais nada de sessão no localStorage.
  localStorage.removeItem(CHAVE_REFRESH);
  localStorage.removeItem(CHAVE_TOKEN);
}

export async function guardarToken(token: string | null): Promise<void> {
  accessToken = token;
  if (!isNativo()) {
    try {
      if (token) localStorage.setItem(CHAVE_TOKEN, token);
      else localStorage.removeItem(CHAVE_TOKEN);
    } catch { /* modo privado sem storage: segue só em memória */ }
    return;
  }
  const c = await cofre();
  if (token) await c.gravar(CHAVE_TOKEN, token);
  else await c.apagar(CHAVE_TOKEN);
}

export async function guardarRefresh(token: string | null): Promise<void> {
  if (!isNativo()) return; // web: cookie httpOnly, o JS não toca
  refreshToken = token;
  const c = await cofre();
  if (token) await c.gravar(CHAVE_REFRESH, token);
  else await c.apagar(CHAVE_REFRESH);
}

/** Aplica a sessão de /auth/login, /auth/cadastro ou webauthn/finish. */
export async function guardarSessao(corpo: SessaoRecebida): Promise<void> {
  await guardarToken(corpo.token);
  if (corpo.nome) localStorage.setItem("nome", corpo.nome);
  if (corpo.refresh_token) await guardarRefresh(corpo.refresh_token);
}

/** Esquece os tokens (logout, falha de desbloqueio, troca de servidor). */
export async function limparSessao(): Promise<void> {
  await guardarToken(null);
  await guardarRefresh(null);
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem("nome");
}
