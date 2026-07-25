import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";

type Entrada = {
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  recorrente: number;
};

export default function Entradas() {
  const [itens, setItens] = useState<Entrada[]>([]);
  const [total, setTotal] = useState(0);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeISO());
  const [recorrente, setRecorrente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<{ itens: Entrada[]; total_cents: number }>("/entradas")
      .then((r) => {
        setItens(r.itens);
        setTotal(r.total_cents);
      })
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(carregar, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api("/entradas", {
        method: "POST",
        body: JSON.stringify({ descricao, valor_cents: paraCents(valor), data, recorrente }),
      });
      setDescricao("");
      setValor("");
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluir(id: number) {
    await api(`/entradas/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <>
      <h2>Entradas <small>(total: {brl(total)})</small></h2>
      <form onSubmit={criar} className="linha-form">
        <input placeholder="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        <input placeholder="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required />
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        <label>
          <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} /> recorrente
        </label>
        <button type="submit">Adicionar</button>
      </form>
      {erro && <p className="erro">{erro}</p>}

      <table>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>{i.data}</td>
              <td>{i.descricao}{i.recorrente ? " 🔁" : ""}</td>
              <td>{brl(i.valor_cents)}</td>
              <td><button onClick={() => excluir(i.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
