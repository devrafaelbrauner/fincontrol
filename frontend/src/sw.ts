/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// Em injectManifest o Workbox NÃO injeta skipWaiting/clientsClaim — sem eles o
// SW novo fica em "waiting" e a PWA instalada continua no shell antigo para
// sempre após um deploy (o registerType: "autoUpdate" seria decorativo).
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Precache do app shell (injetado pelo vite-plugin-pwa no build).
precacheAndRoute(self.__WB_MANIFEST);

// Navegação offline: deep links (/metas, /config) caem no index.html do
// precache. API e feed .ics nunca são interceptados.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api\//, /^\/calendar\//],
}));

// Notificação recebida do backend (Web Push).
self.addEventListener("push", (event) => {
  const dados = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return {};
    }
  })();
  const titulo = dados.titulo ?? "FinControl";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.corpo ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: dados.url ?? "/" },
    })
  );
});

// Clique na notificação navega para a URL do payload — focus sozinho deixava
// o app na tela em que já estava.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const alvo = clientes[0];
    if (alvo && "navigate" in alvo) {
      const nav = await alvo.navigate(url);
      await (nav ?? alvo).focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});
