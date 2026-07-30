import { FormEvent, useRef, useState } from "react";
import { api } from "../api";
import { IcChat } from "../components/icones";

type Fala = { de: "voce" | "ia"; texto: string };

const SUGESTOES = [
  "Quanto gastei este mês?",
  "Qual categoria mais pesou?",
  "Como está o progresso das minhas metas?",
  "Posso gastar R$ 300 sem ficar no vermelho?",
];

export default function Assistente() {
  const [falas, setFalas] = useState<Fala[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  async function enviar(texto: string) {
    const q = texto.trim();
    if (!q || pensando) return;
    setFalas((f) => [...f, { de: "voce", texto: q }]);
    setPergunta("");
    setPensando(true);
    try {
      const r = await api<{ resposta: string }>("/ia/perguntar", { method: "POST", body: JSON.stringify({ pergunta: q }) });
      setFalas((f) => [...f, { de: "ia", texto: r.resposta }]);
    } catch (e) {
      setFalas((f) => [...f, { de: "ia", texto: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setPensando(false);
      setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function onSubmit(e: FormEvent) { e.preventDefault(); enviar(pergunta); }

  return (
    <>
      <h2>Assistente</h2>
      <p className="sub">Pergunte sobre suas finanças. As respostas usam seus dados reais (últimos meses e metas) como contexto.</p>

      <div className="card chat" role="log" aria-live="polite">
        {falas.length === 0 && (
          <div className="chat-vazio">
            <IcChat />
            <p className="sub">Faça uma pergunta ou escolha uma sugestão abaixo.</p>
            <div className="chat-sugestoes">
              {SUGESTOES.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => enviar(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {falas.map((f, i) => (
          <div key={i} className={`bolha ${f.de}`}>{f.texto}</div>
        ))}
        {pensando && <div className="bolha ia pensando">Pensando…</div>}
        <div ref={fimRef} />
      </div>

      <form onSubmit={onSubmit} className="linha-form" style={{ marginTop: "0.75rem" }}>
        <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Pergunte algo…"
          aria-label="Sua pergunta" style={{ flex: 1 }} />
        <button className="btn btn-primario" type="submit" disabled={pensando || !pergunta.trim()}>Enviar</button>
      </form>
    </>
  );
}
