import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { IcChat } from "../components/icones";

type Fala = { de: "voce" | "ia"; texto: string };
type MensagemSalva = { id: number; papel: "user" | "assistant"; texto: string; criado_em: string };

const SUGESTOES = [
  "Quanto gastei este mês?",
  "Qual categoria mais pesou?",
  "Como está o progresso das minhas metas?",
  "Posso gastar R$ 300 sem ficar no vermelho?",
];

/** Sugestões só fazem sentido na conversa vazia: com histórico, a continuação
 *  natural é perguntar sobre o que já foi dito. */
export default function Assistente() {
  const toast = useToast();
  const [falas, setFalas] = useState<Fala[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const fimRef = useRef<HTMLDivElement>(null);

  const aoFim = useCallback((suave = true) => {
    setTimeout(() => fimRef.current?.scrollIntoView({ behavior: suave ? "smooth" : "auto" }), 50);
  }, []);

  // A conversa vive no servidor, então ela é a mesma no web, no macOS e no
  // celular — e sobrevive a um F5, que antes zerava tudo.
  useEffect(() => {
    api<{ mensagens: MensagemSalva[] }>("/ia/conversa")
      .then((r) => {
        setFalas(r.mensagens.map((m) => ({ de: m.papel === "user" ? "voce" : "ia", texto: m.texto })));
        if (r.mensagens.length) aoFim(false);
      })
      // Falhar aqui não pode trancar a tela: sem histórico ela ainda serve para
      // perguntar. O erro real aparece quando a pergunta for enviada.
      .catch(() => undefined)
      .finally(() => setCarregando(false));
  }, [aoFim]);

  async function enviar(texto: string) {
    const q = texto.trim();
    if (!q || pensando) return;
    setFalas((f) => [...f, { de: "voce", texto: q }]);
    setPergunta("");
    setPensando(true);
    aoFim();
    try {
      const r = await api<{ resposta: string }>("/ia/perguntar", { method: "POST", body: JSON.stringify({ pergunta: q }) });
      setFalas((f) => [...f, { de: "ia", texto: r.resposta }]);
    } catch (e) {
      // O servidor não grava a pergunta quando a chamada falha, então a bolha
      // de erro fica só nesta tela — recarregar não traz de volta uma pergunta
      // que nunca foi respondida.
      setFalas((f) => [...f, { de: "ia", texto: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setPensando(false);
      aoFim();
    }
  }

  async function limpar() {
    if (!confirm("Apagar toda a conversa? O assistente perde a memória do que foi dito.")) return;
    try {
      await api("/ia/conversa", { method: "DELETE" });
      setFalas([]);
      toast("Conversa apagada.");
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  function onSubmit(e: FormEvent) { e.preventDefault(); enviar(pergunta); }

  return (
    <>
      <div className="secao-regua">
        <p className="sub" style={{ margin: 0 }}>
          Pergunte sobre suas finanças. As respostas usam seus dados reais (últimos meses e metas)
          como contexto, e o assistente lembra do que já foi dito nesta conversa.
        </p>
        {/* nowrap: o texto do parágrafo ao lado é longo e, sem isto, o botão
            encolhe até quebrar em duas linhas dentro da régua. */}
        {falas.length > 0 && (
          <button type="button" className="btn" style={{ whiteSpace: "nowrap" }} onClick={limpar}>
            Apagar conversa
          </button>
        )}
      </div>

      <div className="chat" role="log" aria-live="polite">
        {carregando && <div className="bolha ia pensando">Carregando a conversa…</div>}
        {!carregando && falas.length === 0 && (
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
