import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Default não inclui woff2: offline cairia na fonte do sistema.
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2}"] },
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
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
});
