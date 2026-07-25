import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type FeedInfo = {
  token: string;
  caminho: string;
  url: string;
  webcal: string;
};

export default function Calendario() {
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<FeedInfo>("/calendario").then(setInfo).catch((e) => setErro(e.message));
  }, []);

  useEffect(carregar, [carregar]);

  async function regenerar() {
    if (!confirm("Gerar uma nova URL invalida a atual — você terá que reassinar o calendário em todos os aparelhos. Continuar?")) return;
    setErro(null);
    try {
      setInfo(await api<FeedInfo>("/calendario/regenerar", { method: "POST", body: "{}" }));
      setCopiado(false);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function copiar() {
    if (!info) return;
    await navigator.clipboard.writeText(info.url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <>
      <h2>Calendário</h2>
      <p>
        Assine este calendário no iPhone/Mac ou no Google Calendar para ver os vencimentos das
        contas fixas e os prazos das metas — com lembrete automático.
      </p>
      {erro && <p className="erro">{erro}</p>}

      {info && (
        <>
          <div className="cal-url">
            <code>{info.url}</code>
            <button onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button>
          </div>

          <div className="linha-form">
            <a href={info.webcal} className="botao-link">Assinar no Apple Calendar</a>
            <button onClick={regenerar} className="botao-perigo">Gerar nova URL</button>
          </div>

          <div className="cal-ajuda">
            <strong>Como assinar</strong>
            <ul>
              <li><strong>iPhone/Mac:</strong> toque em “Assinar no Apple Calendar” (ou Ajustes → Calendário → Contas → Adicionar assinatura, colando a URL).</li>
              <li><strong>Google Calendar:</strong> Outros calendários → “A partir do URL” → cole a URL copiada.</li>
            </ul>
            <p className="cal-aviso">
              ⚠️ Esta URL dá acesso de leitura aos seus vencimentos — trate como senha. Se vazar,
              use “Gerar nova URL”.
            </p>
          </div>
        </>
      )}
    </>
  );
}
