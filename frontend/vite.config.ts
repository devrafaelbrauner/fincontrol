import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const versaoApp = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(versaoApp) },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Default não inclui woff2: offline cairia na fonte do sistema.
      // Os subsets não-latinos ficam de fora do precache: o @fontsource emite um
      // woff2 por subset e o navegador só baixa os que o unicode-range pede — mas
      // o precache baixaria TODOS. São 111 KB de cirílico, grego e vietnamita que
      // um app em português nunca renderiza. Continuam servidos sob demanda.
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        globIgnores: ["**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2"],
      },
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "auto",
      manifest: {
        id: "/",
        name: "FinControl",
        short_name: "FinControl",
        description: "Controle financeiro pessoal",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Mesma cor em: src/tema.ts, index.html e capacitor.config.ts.
        theme_color: "#000000",
        background_color: "#000000",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Análises", url: "/analises" },
          { name: "Metas", url: "/metas" },
          { name: "Calendário", url: "/calendario" },
          { name: "Assistente", url: "/assistente" },
        ],
      },
      // `--mode desktop` (app Tauri): o app já está no disco e não precisa de
      // service worker nem manifest. Mas builds antigos registraram um sw.js no
      // perfil do WebView2, que serve o index.html velho e impede o app novo de
      // rodar (evidencia/sw-antigo.log). Sem sw.js no dist a atualização dele
      // falha e ele fica para sempre; com este sw.js autodestrutivo, a checagem
      // de atualização baixa um SW que se desregistra, apaga os caches e
      // recarrega a janela. Mesmo nome (sw.js), sem registro novo.
      ...(mode === "desktop" ? { selfDestroying: true, injectRegister: false, manifest: false } as const : {}),
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
}));
