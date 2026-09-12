import { Capacitor } from "@capacitor/core";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { sincronizar } from "./api";
import Bloqueio from "./components/Bloqueio";
import TelaServidor from "./components/TelaServidor";
import { ToastProvider } from "./components/Toast";
import { EstadoProvider } from "./estado";
import { marcarAtividade, precisaDesbloquear } from "./bloqueio";
import { biometriaDisponivel } from "./nativo/biometria";
import { atualizarContadores, definirOffline } from "./offline/estadoOffline";
import { isNativo } from "./plataforma";
import { carregarServidor, temApiBase } from "./servidor";
import { carregarSessao, limparSessao, temSessao } from "./sessao";
import "./app.css";

/** Observa a conexão e o primeiro plano: marca o estado e repete a fila quando
 *  a rede volta ou o app é retomado (o `online` sozinho não cobre o aparelho que
 *  perdeu rede com o app em segundo plano). */
function vigiarConexao() {
  const aoMudar = () => {
    definirOffline(!navigator.onLine);
    if (navigator.onLine) sincronizar();
  };
  const aoVoltar = () => { if (document.visibilityState === "visible") aoMudar(); };
  window.addEventListener("online", aoMudar);
  window.addEventListener("offline", aoMudar);
  document.addEventListener("visibilitychange", aoVoltar);
  definirOffline(!navigator.onLine);
  void atualizarContadores();
}

/** Casca: decide entre primeiro-aviso de servidor, tela de bloqueio e o app.
 *
 *  O bloqueio na abertura a frio é decidido no boot (antes de montar, para não
 *  piscar dado na tela); o de resume fica no listener de visibilidade, que exige
 *  5 minutos de inatividade e biometria disponível. */
function Raiz({ bloqueadoInicial, precisaServidor }: { bloqueadoInicial: boolean; precisaServidor: boolean }) {
  const [bloqueado, setBloqueado] = useState(bloqueadoInicial);
  const biometria = useRef(false);

  useEffect(() => {
    let vivo = true;
    if (isNativo() && temSessao()) {
      biometriaDisponivel().then((b) => { if (vivo) biometria.current = b; });
    }
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const aoTrocarVisibilidade = () => {
      if (document.visibilityState === "hidden") { marcarAtividade(); return; }
      // Voltou ao primeiro plano: só tranca se passou do limite E há como pedir
      // biometria. Sem sensor, seguir direto (a senha continua sendo o caminho).
      if (precisaDesbloquear() && biometria.current && temSessao()) setBloqueado(true);
      else marcarAtividade();
    };
    document.addEventListener("visibilitychange", aoTrocarVisibilidade);
    return () => document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
  }, []);

  if (precisaServidor) return <TelaServidor />;
  if (bloqueado) {
    return (
      <Bloqueio
        aoDesbloquear={() => { marcarAtividade(); setBloqueado(false); }}
        aoFalhar={async () => { await limparSessao(); window.location.href = "/login"; }}
      />
    );
  }
  return <App />;
}

async function iniciar() {
  // A plataforma vira atributo no <html>, como o tema: o Android segue as
  // convenções do Material 3 (pílula tonal sob o ícone ativo, FAB estendido) e o
  // iOS/web seguem o desenho base. Assim a diferença mora no CSS, e nenhum
  // componente precisa perguntar em que aparelho está rodando.
  document.documentElement.dataset.plataforma = Capacitor.getPlatform();

  // Ordem importa: o servidor primeiro, senão a sessão (cofre/Keychain) e só
  // então o gate de biometria, que precisa saber se há sessão para proteger.
  await carregarServidor();
  await carregarSessao();
  vigiarConexao();

  const precisaServidor = isNativo() && !temApiBase();
  const bloqueadoInicial = !precisaServidor && isNativo() && temSessao()
    && await biometriaDisponivel();

  // Fila que sobrou de uma sessão offline anterior: tenta aplicar já no boot
  // (sem bloquear a renderização — o banner reflete o resultado).
  if (!precisaServidor && navigator.onLine) void sincronizar();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <EstadoProvider>
          <ToastProvider>
            <Raiz bloqueadoInicial={bloqueadoInicial} precisaServidor={precisaServidor} />
          </ToastProvider>
        </EstadoProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

iniciar();
