import { Capacitor } from "@capacitor/core";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { EstadoProvider } from "./estado";
import "./app.css";

// A plataforma vira atributo no <html>, como o tema: o Android segue as
// convenções do Material 3 (pílula tonal sob o ícone ativo, FAB estendido) e o
// iOS/web seguem o desenho base. Assim a diferença mora no CSS, e nenhum
// componente precisa perguntar em que aparelho está rodando.
document.documentElement.dataset.plataforma = Capacitor.getPlatform();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <EstadoProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </EstadoProvider>
    </BrowserRouter>
  </React.StrictMode>
);
