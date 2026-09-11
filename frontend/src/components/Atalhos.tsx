import { NavLink } from "react-router-dom";
import {
  IcAnalises, IcCalendario, IcChat, IcCompromissos, IcConfig, IcEntradas, IcFixas,
  IcImportar, IcMetas, IcRecursos, IcVariaveis, IcVisao,
} from "./icones";

/** Atalhos do hub: grade de destinos acima do resumo financeiro.
 *
 *  Lista FECHADA de propósito (não lê a ordem salva da sidebar antiga): o hub
 *  não tem ordem custom — a grade é fixa e igual em todo aparelho. Rotas atuais
 *  permanecem; cada atalho leva à página que já existia.
 */
export const ATALHOS = [
  { para: "/", rotulo: "Visão geral", icone: <IcVisao /> },
  { para: "/analises", rotulo: "Análises", icone: <IcAnalises /> },
  { para: "/assistente", rotulo: "Assistente", icone: <IcChat /> },
  { para: "/importar", rotulo: "Importar", icone: <IcImportar /> },
  { para: "/fixas", rotulo: "Contas fixas", icone: <IcFixas /> },
  { para: "/variaveis", rotulo: "Variáveis", icone: <IcVariaveis /> },
  { para: "/entradas", rotulo: "Entradas", icone: <IcEntradas /> },
  { para: "/metas", rotulo: "Metas", icone: <IcMetas /> },
  { para: "/compromissos", rotulo: "Compromissos", icone: <IcCompromissos /> },
  { para: "/calendario", rotulo: "Calendário", icone: <IcCalendario /> },
  { para: "/recursos", rotulo: "Recursos", icone: <IcRecursos /> },
  { para: "/config", rotulo: "Configurações", icone: <IcConfig /> },
];

/** Grade de atalhos do hub. Renderizada pelo Dashboard acima do resumo. */
export default function Atalhos() {
  return (
    <nav className="hub-atalhos" aria-label="Atalhos">
      {ATALHOS.map((a) => (
        <NavLink key={a.para} to={a.para} end={a.para === "/"} className="hub-atalho">
          {a.icone}
          <span>{a.rotulo}</span>
        </NavLink>
      ))}
    </nav>
  );
}
