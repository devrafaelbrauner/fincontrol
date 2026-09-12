import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { competenciaAtual } from "./api";

/** Competência (mês) selecionada, compartilhada entre o header e as páginas. */
const CompCtx = createContext<{ competencia: string; setCompetencia: (c: string) => void }>({
  competencia: competenciaAtual(),
  setCompetencia: () => {},
});

/** Sinal de "os dados mudaram" — páginas incluem `versao` nas deps do fetch. */
const AtualCtx = createContext<{ versao: number; atualizar: () => void }>({ versao: 0, atualizar: () => {} });

/** Intervalo mínimo entre revalidações automáticas.
 *
 *  Sem ele, alternar entre duas janelas dispararia um refetch por alternância.
 *  O objetivo é pegar dado velho depois de um tempo longe da tela, não a cada
 *  piscada. */
export const INTERVALO_REVALIDACAO_MS = 30_000;

/** Assina os eventos de "voltei para o app" e chama `aoVoltar`, no máximo uma
 *  vez a cada INTERVALO_REVALIDACAO_MS. Devolve a função de limpeza.
 *
 *  Exportada para poder ser testada sem montar o provider inteiro. */
export function assinarRetorno(aoVoltar: () => void): () => void {
  let ultima = Date.now();
  const revalidar = () => {
    const agora = Date.now();
    if (agora - ultima < INTERVALO_REVALIDACAO_MS) return;
    ultima = agora;
    aoVoltar();
  };
  const aoFicarVisivel = () => { if (!document.hidden) revalidar(); };

  document.addEventListener("visibilitychange", aoFicarVisivel);
  window.addEventListener("focus", revalidar);
  // `pageshow` cobre a volta pelo bfcache (voltar do navegador no celular), em
  // que nem `focus` nem `visibilitychange` disparam.
  window.addEventListener("pageshow", revalidar);
  // O replay da fila offline aplicou escritas: os dados do servidor mudaram e as
  // telas precisam revalidar sem esperar a próxima alternância de janela.
  const aoReplay = () => { ultima = 0; revalidar(); };
  window.addEventListener("fincontrol:atualizar", aoReplay);
  return () => {
    document.removeEventListener("visibilitychange", aoFicarVisivel);
    window.removeEventListener("focus", revalidar);
    window.removeEventListener("pageshow", revalidar);
    window.removeEventListener("fincontrol:atualizar", aoReplay);
  };
}

export function EstadoProvider({ children }: { children: ReactNode }) {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [versao, setVersao] = useState(0);
  const atualizar = useCallback(() => setVersao((v) => v + 1), []);

  // Revalidação ao voltar para o app.
  //
  // Nada avisa que os dados mudaram noutro aparelho: sem WebSocket, SSE nem
  // polling, uma tela só busca quando é montada. Na prática, um lançamento feito
  // no iPhone não aparecia no Mac aberto ao lado — indefinidamente, porque nada
  // remontava a tela.
  //
  // Isto não é sincronização em tempo real e não pretende ser: é o momento
  // barato e certeiro de revalidar, quando a pessoa volta a olhar.
  //
  // LIMITAÇÃO CONHECIDA: no WebView do Capacitor esses eventos podem não
  // disparar ao voltar do multitarefa — o sinal confiável no celular é o
  // `appStateChange` do `@capacitor/app`, que não é dependência do projeto. Se
  // na prática o celular continuar mostrando dado velho, é esse plugin que
  // falta, não este código.
  useEffect(() => assinarRetorno(atualizar), [atualizar]);

  return (
    <CompCtx.Provider value={{ competencia, setCompetencia }}>
      <AtualCtx.Provider value={{ versao, atualizar }}>{children}</AtualCtx.Provider>
    </CompCtx.Provider>
  );
}

export const useCompetencia = () => useContext(CompCtx);
export const useAtualizacao = () => useContext(AtualCtx);
