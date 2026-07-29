/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base absoluta da API (ex.: "https://financespace.duckdns.org").
   * Usada nos builds nativos (Capacitor), onde não há same-origin.
   * Vazio/ausente = same-origin (web servido pelo Caddy).
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
