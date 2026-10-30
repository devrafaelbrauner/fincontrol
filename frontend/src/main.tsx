import { Capacitor } from "@capacitor/core";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { sincronizar } from "./api";
import { abrirPastaDeDados, baseLocal, type EstadoBackend, observarBackend, reiniciar } from "./backendLocal";
import Bloqueio from "./components/Bloqueio";
import TelaServidor from "./components/TelaServidor";
import TelaBackend from "./components/TelaBackend";
import { ToastProvider } from "./components/Toast";
import { EstadoProvider } from "./estado";
import { marcarAtividade, precisaDesbloquear } from "./bloqueio";
import { biometriaDisponivel } from "./nativo/biometria";
import { atualizarContadores, definirOffline } from "./offline/estadoOffline";
import { isDesktopLocal, isNativo } from "./plataforma";
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

/** Desktop: a "conexão" é o backend embutido, e o `navigator.onLine` não diz
 *  nada sobre ele — o estado offline vem dos avisos do backend. Fica só a
 *  repetição da fila ao voltar ao primeiro plano. */
function vigiarDesktop() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && baseLocal()) void sincronizar();
  });
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

/** Boot do app desktop: o backend embutido sobe junto com a janela.
 *
 *  Nenhuma chamada à API antes do primeiro `pronto`; nele, a sessão e o gate de
 *  biometria como no boot de sempre, a fila e só então o app. Um reinício do
 *  backend com o app aberto vira a barra offline (o app segue montado, com
 *  cache e fila); só `falhou` volta para a tela cheia. */
async function iniciarDesktop() {
  // Builds antigos (cliente da VPS) registraram o sw.js no perfil do WebView2.
  // O desktop não usa service worker. O sw.js autodestrutivo do build desktop
  // (vite.config.ts) é inofensivo, mas não substitui o SW velho (a atualização
  // falha no WebView2); no Windows a limpeza é o lib.rs apagar a pasta
  // `Service Worker` do perfil antes da janela. Aqui, já no app novo, desregistra
  // o que tiver sobrado.
  void navigator.serviceWorker?.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {});

  const root = ReactDOM.createRoot(document.getElementById("root")!);
  let estado: EstadoBackend = { estado: "iniciando" };
  // null até o primeiro `pronto` terminar de ler a sessão.
  let app: { bloqueadoInicial: boolean } | null = null;
  // Tela cheia do backend: no boot e depois de um `falhou`, até o próximo `pronto`.
  let telaCheia = true;
  let preparo: Promise<void> | null = null;

  const pintar = () => root.render(
    <React.StrictMode>
      <BrowserRouter>
        <EstadoProvider>
          <ToastProvider>
            {telaCheia || !app
              ? <TelaBackend estado={estado} aoTentarDeNovo={reiniciar} aoAbrirPasta={abrirPastaDeDados} />
              : <Raiz bloqueadoInicial={app.bloqueadoInicial} precisaServidor={false} />}
          </ToastProvider>
        </EstadoProvider>
      </BrowserRouter>
    </React.StrictMode>
  );

  const voltarOnline = () => {
    telaCheia = false;
    definirOffline(false);
    void sincronizar();
  };

  // Depois de um erro no boot (root desmontado) ou ao sair da página (o logout
  // recarrega), os avisos do backend não têm mais onde pintar: para de ouvir.
  let encerrado = false;
  let pararDeOuvir: (() => void) | null = null;
  const encerrar = () => {
    encerrado = true;
    pararDeOuvir?.();
  };

  const aoMudar = (novo: EstadoBackend) => {
    if (encerrado) return;
    estado = novo;
    if (novo.estado !== "pronto") {
      definirOffline(true);
      if (novo.estado === "falhou") telaCheia = true;
    } else if (app) {
      voltarOnline();
    } else {
      preparo ??= (async () => {
        // Mesma ordem do boot de sempre: a sessão (cofre) antes do gate de
        // biometria, que precisa saber se há sessão para proteger.
        await carregarSessao();
        const bloqueadoInicial = temSessao() && await biometriaDisponivel();
        app = { bloqueadoInicial };
        // O backend pode ter reiniciado durante a leitura: aí espera o próximo `pronto`.
        if (estado.estado === "pronto") voltarOnline();
        pintar();
      })().catch((e: unknown) => { encerrar(); root.unmount(); telaDeErro(e); });
    }
    pintar();
  };

  pintar();
  vigiarDesktop();
  window.addEventListener("pagehide", encerrar, { once: true });
  try {
    pararDeOuvir = await observarBackend(aoMudar);
  } catch (e) {
    root.unmount();
    throw e;
  }
  if (encerrado) pararDeOuvir();
}

async function iniciar() {
  // A plataforma vira atributo no <html>, como o tema: o Android segue as
  // convenções do Material 3 (pílula tonal sob o ícone ativo, FAB estendido) e o
  // iOS/web seguem o desenho base. Assim a diferença mora no CSS, e nenhum
  // componente precisa perguntar em que aparelho está rodando.
  document.documentElement.dataset.plataforma = Capacitor.getPlatform();
  if (isDesktopLocal()) return iniciarDesktop();

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

function telaDeErro(erro: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const msg = erro instanceof Error ? erro.message : "Falha ao iniciar.";
  try {
    ReactDOM.createRoot(root).render(
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>FinControl não abriu</h1>
        <p style={{ margin: "0 0 16px", opacity: 0.75 }}>{msg}</p>
        <button type="button" onClick={() => window.location.reload()}>Recarregar</button>
      </div>
    );
  } catch {
    root.textContent = "FinControl não abriu. Recarregue a página.";
  }
}

iniciar().catch(telaDeErro);
