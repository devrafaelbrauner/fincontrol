import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";
import AnexoCampo from "../components/AnexoCampo";

type Variavel = {
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  forma_pagamento: string | null;
  anexo_id: number | null;
};

export default function Variaveis() {
  const [itens, setItens] = useState<Variavel[]>([]);
  const [total, setTotal] = useState(0);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(hojeISO());
  const [forma, setForma] = useState("pix");
  const [anexoId, setAnexoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<{ itens: Variavel[]; total_cents: number }>("/variaveis")
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
      await api("/variaveis", {
        method: "POST",
        body: JSON.stringify({ descricao, valor_cents: paraCents(valor), data, forma_pagamento: forma, anexo_id: anexoId }),
      });
      setValor("");
      setDescricao("");
      setAnexoId(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluir(id: number) {
    await api(`/variaveis/${id}`, { method: "DELETE" });
    carregar();
  }

  async function definirAnexo(id: number, novoAnexoId: number | null) {
    await api(`/variaveis/${id}`, { method: "PATCH", body: JSON.stringify({ anexo_id: novoAnexoId }) });
    carregar();
  }

  return (
    <>
      <h2>Gastos variáveis <small>(total: {brl(total)})</small></h2>
      <form onSubmit={criar} className="linha-form">
        <input placeholder="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus required />
        <input placeholder="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        <select value={forma} onChange={(e) => setForma(e.target.value)}>
          <option value="pix">Pix</option>
          <option value="credito">Crédito</option>
          <option value="debito">Débito</option>
          <option value="dinheiro">Dinheiro</option>
          <option value="boleto">Boleto</option>
        </select>
        <AnexoCampo anexoId={anexoId} onChange={setAnexoId} />
        <button type="submit">Adicionar</button>
      </form>
      {erro && <p className="erro">{erro}</p>}

      <table>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>{i.data}</td>
              <td>{i.descricao}</td>
              <td>{i.forma_pagamento}</td>
              <td>{brl(i.valor_cents)}</td>
              <td><AnexoCampo anexoId={i.anexo_id} onChange={(id) => definirAnexo(i.id, id)} /></td>
              <td><button onClick={() => excluir(i.id)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
