/** Armazém chave/valor do offline.
 *
 * Duas lojas: `cache` (última resposta boa de cada GET) e `fila` (escritas que
 * ainda não chegaram ao servidor). Em runtime é IndexedDB; nos testes injeta-se
 * um armazém em memória — o vitest roda em node, sem IndexedDB.
 *
 * Nada aqui decide política: cache e fila só leem/gravam. Quem decide o que
 * fazer com um 409, por exemplo, é o sincronizador. */

export interface Armazem {
  ler<T>(loja: string, chave: string): Promise<T | undefined>;
  gravar<T>(loja: string, chave: string, valor: T): Promise<void>;
  listar<T>(loja: string): Promise<T[]>;
  apagar(loja: string, chave: string): Promise<void>;
  limpar(loja: string): Promise<void>;
}

export const LOJA_CACHE = "cache";
export const LOJA_FILA = "fila";

const BANCO = "fincontrol-offline";
const VERSAO = 1;

class ArmazemIndexedDB implements Armazem {
  private abrir(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BANCO, VERSAO);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LOJA_CACHE)) db.createObjectStore(LOJA_CACHE, { keyPath: "chave" });
        if (!db.objectStoreNames.contains(LOJA_FILA)) db.createObjectStore(LOJA_FILA, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async com<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.abrir();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async ler<T>(loja: string, chave: string): Promise<T | undefined> {
    const r = await this.com<{ valor: T } | undefined>(loja, "readonly", (s) => s.get(chave));
    return r?.valor;
  }

  gravar<T>(loja: string, chave: string, valor: T): Promise<void> {
    return this.com<void>(loja, "readwrite", (s) => s.put({ chave, valor }));
  }

  async listar<T>(loja: string): Promise<T[]> {
    const r = await this.com<{ valor: T }[]>(loja, "readonly", (s) => s.getAll());
    return r.map((x) => x.valor);
  }

  apagar(loja: string, chave: string): Promise<void> {
    return this.com<void>(loja, "readwrite", (s) => s.delete(chave));
  }

  limpar(loja: string): Promise<void> {
    return this.com<void>(loja, "readwrite", (s) => s.clear());
  }
}

let atual: Armazem | null = null;

/** O armazém da plataforma (IndexedDB), criado na primeira chamada. */
export function armazem(): Armazem {
  if (!atual) atual = new ArmazemIndexedDB();
  return atual;
}

/** Só para testes: injeta um armazém em memória / limpa o memoizado. */
export function _definirArmazemParaTeste(a: Armazem | null): void {
  atual = a;
}

/** Armazém em memória — usado nos testes e como degradação onde não há IndexedDB. */
export function armazemMemoria(): Armazem {
  const lojas = new Map<string, Map<string, unknown>>();
  const loja = (n: string) => {
    if (!lojas.has(n)) lojas.set(n, new Map());
    return lojas.get(n)!;
  };
  return {
    ler: async (l, c) => loja(l).get(c) as never,
    gravar: async (l, c, v) => { loja(l).set(c, v); },
    listar: async (l) => [...loja(l).values()] as never,
    apagar: async (l, c) => { loja(l).delete(c); },
    limpar: async (l) => { loja(l).clear(); },
  };
}
