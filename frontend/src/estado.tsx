import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { competenciaAtual } from "./api";

/** Competência (mês) selecionada, compartilhada entre o header e as páginas. */
const CompCtx = createContext<{ competencia: string; setCompetencia: (c: string) => void }>({
  competencia: competenciaAtual(),
  setCompetencia: () => {},
});

/** Sinal de "os dados mudaram" — páginas incluem `versao` nas deps do fetch. */
const AtualCtx = createContext<{ versao: number; atualizar: () => void }>({ versao: 0, atualizar: () => {} });

export function EstadoProvider({ children }: { children: ReactNode }) {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [versao, setVersao] = useState(0);
  const atualizar = useCallback(() => setVersao((v) => v + 1), []);
  return (
    <CompCtx.Provider value={{ competencia, setCompetencia }}>
      <AtualCtx.Provider value={{ versao, atualizar }}>{children}</AtualCtx.Provider>
    </CompCtx.Provider>
  );
}

export const useCompetencia = () => useContext(CompCtx);
export const useAtualizacao = () => useContext(AtualCtx);
