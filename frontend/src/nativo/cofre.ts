import { isCapacitorNativo, isTauri } from "../plataforma";

/** Cofre de segredos do aparelho.
 *
 * No nativo o refresh token NÃO pode morar em `localStorage`: a WebView expõe o
 * localStorage a qualquer script injetado e ele sai em backup de texto. Aqui ele
 * vai para o Keychain (iOS/macOS), Keystore/SharedPreferences cifrado (Android)
 * ou Credential Manager (Windows), atrás de uma interface única.
 *
 * No web não há cofre: o refresh vive num cookie httpOnly gerido pelo backend, e
 * este módulo devolve um objeto vazio. */
export interface Cofre {
  ler(chave: string): Promise<string | null>;
  gravar(chave: string, valor: string): Promise<void>;
  apagar(chave: string): Promise<void>;
}

const NULO: Cofre = {
  ler: async () => null,
  gravar: async () => {},
  apagar: async () => {},
};

async function cofreCapacitor(): Promise<Cofre> {
  // Import dinâmico: o plugin é nativo e não pode ser avaliado no import dos
  // testes node (sem `window`/ponte nativa).
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  return {
    async ler(chave) {
      const v = await SecureStorage.get(chave);
      if (v == null) return null;
      return typeof v === "string" ? v : String(v);
    },
    gravar: (chave, valor) => SecureStorage.set(chave, valor),
    apagar: async (chave) => { await SecureStorage.remove(chave); },
  };
}

async function cofreTauri(): Promise<Cofre> {
  // Comandos Rust deste app (src-tauri): embrulham o crate `keyring`, que usa o
  // Keychain no macOS, o Credential Manager no Windows e o Secret Service no
  // Linux. Comandos do próprio app não passam pelo sistema de permissões de
  // plugin — por isso não há dependência JS de plugin aqui.
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    ler: (chave) => invoke<string | null>("cofre_ler", { chave }),
    gravar: (chave, valor) => invoke("cofre_gravar", { chave, valor }),
    apagar: (chave) => invoke("cofre_apagar", { chave }),
  };
}

let instancia: Cofre | null = null;

/** O cofre da plataforma atual, resolvido e memoizado na primeira chamada. */
export async function cofre(): Promise<Cofre> {
  if (instancia) return instancia;
  if (isTauri()) instancia = await cofreTauri();
  else if (isCapacitorNativo()) instancia = await cofreCapacitor();
  else instancia = NULO;
  return instancia;
}

/** Só para os testes: injeta um cofre falso / limpa o memoizado. */
export function _definirCofreParaTeste(c: Cofre | null): void {
  instancia = c;
}
