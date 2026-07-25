import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, paraCents } from "../api";

type Meta = {
  id: number;
  nome: string;
  valor_total_cents: number;
  valor_atual_cents: number;
  valor_mensal_necessario_cents: number;
  prazo: string;
};

export default function Metas() {
  const [metas, setMetas] = useState<Meta[]>([]);
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [prazo, setPrazo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Meta[]>("/metas").then(setMetas).catch((e) => setErro(e.message));
  }, []);

  useEffect(carregar, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api("/metas", {
        method: "POST",
        body: JSON.stringify({ nome, valor_total_cents: paraCents(valor), prazo }),
      });
      setNome("");
      setValor("");
      setPrazo("");
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function aportar(meta: Meta) {
    const txt = prompt(`Valor do aporte para "${meta.nome}" (R$):`);
    if (!txt) return;
    await api(`/metas/${meta.id}/aportes`, {
      method: "POST",
      body: JSON.stringify({ valor_cents: paraCents(txt) }),
    });
    carregar();
  }

  return (
    <>
      <h2>Metas</h2>
      <form onSubmit={criar} className="linha-form">
        <input placeholder="Nome da meta" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input placeholder="Valor total (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required />
        <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} required />
        <button type="submit">Criar meta</button>
      </form>
      {erro && <p className="erro">{erro}</p>}

      {metas.map((m) => {
        const pct = Math.min((m.valor_atual_cents / m.valor_total_cents) * 100, 100);
        return (
          <div key={m.id} className="card meta">
            <div className="meta-cabecalho">
              <strong>{m.nome}</strong>
              <span>
                {brl(m.valor_atual_cents)} / {brl(m.valor_total_cents)} · até {m.prazo}
              </span>
            </div>
            <div className="progresso">
              <div className="progresso-preenchido" style={{ width: `${pct}%` }} />
            </div>
            <div className="meta-rodape">
              <small>Necessário por mês: {brl(m.valor_mensal_necessario_cents)}</small>
              <button onClick={() => aportar(m)}>+ Aporte</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
