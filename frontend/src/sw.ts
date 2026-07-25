/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// Precache do app shell (injetado pelo vite-plugin-pwa no build).
precacheAndRoute(self.__WB_MANIFEST);

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

// Clique na notificação abre/foca o app na URL indicada.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientes) => {
      for (const c of clientes) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
