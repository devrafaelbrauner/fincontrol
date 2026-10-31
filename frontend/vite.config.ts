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
      // Os subsets não-latinos ficam fora do precache: o @fontsource emite um
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
      // Nada de `injectRegister`: quem registra é o `prepararServiceWorker`
      // (`plataforma.ts`) — só web, iOS e APK `nuvem` registram o `/sw.js`; no
      // modo local (desktop e Android `local`) o registrado é desligado, porque
      // um SW com o bundle de antes de uma atualização quebraria o par
      // front×backend. Ver `main.tsx`.
      injectRegister: false,
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
      // service worker nem manifest. O sw.js autodestrutivo é inofensivo (nada
      // substitui o SW que builds antigos deixaram no perfil do WebView2: a
      // atualização dele falha e ele segue servindo o index.html velho (run
      // fincontrol-r7-f3b, evidencia/sw-antigo.log). No Windows quem limpa é o
      // lib.rs, que apaga a pasta `Service Worker` do perfil antes de abrir a
      // janela. Mesmo nome (sw.js), sem registro novo.
      ...(mode === "desktop" ? { selfDestroying: true, manifest: false } as const : {}),
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
}));
