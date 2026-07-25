import { FormEvent, useEffect, useState } from "react";
import { api, hojeISO, paraCents } from "../api";
import { useAtualizacao } from "../estado";
import Modal from "./Modal";
import { useToast } from "./Toast";

type Tipo = "variavel" | "entrada" | "fixa";
type Categoria = { id: number; nome: string; tipo: string };

const FORMAS = [
  ["pix", "Pix"], ["credito", "Crédito"], ["debito", "Débito"], ["dinheiro", "Dinheiro"], ["boleto", "Boleto"],
] as const;

/** Modal unificado de cadastro: despesa variável, entrada ou conta fixa. */
export default function AddTransacaoModal({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const toast = useToast();
  const { atualizar } = useAtualizacao();

  const [tipo, setTipo] = useState<Tipo>("variavel");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeISO());
  const [dia, setDia] = useState("10");
  const [forma, setForma] = useState("pix");
  const [recorrente, setRecorrente] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<string>("");
  const [sugerindo, setSugerindo] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (aberto) api<Categoria[]>("/categorias").then(setCategorias).catch(() => setCategorias([]));
  }, [aberto]);

  const catsDoTipo = categorias.filter((c) => c.tipo === (tipo === "fixa" ? "fixa" : tipo));

  async function sugerirCategoria() {
    if (!descricao.trim() || catsDoTipo.length === 0) return;
    setSugerindo(true);
    try {
      const r = await api<{ categoria: string | null }>("/ia/categorizar", { method: "POST", body: JSON.stringify({ descricao }) });
      const achada = catsDoTipo.find((c) => c.nome === r.categoria);
      if (achada) setCategoriaId(String(achada.id));
      else toast("A IA não encontrou uma categoria correspondente.", "erro");
    } catch (err) {
      toast((err as Error).message, "erro");
    } finally {
      setSugerindo(false);
    }
  }

  function limpar() {
    setDescricao(""); setValor(""); setData(hojeISO()); setDia("10"); setRecorrente(false); setCategoriaId(""); setErros({});
  }

  function validar(): boolean {
    const e: Record<string, string> = {};
    if (!descricao.trim()) e.descricao = "Informe uma descrição.";
    const cents = paraCents(valor);
    if (!valor.trim() || isNaN(cents) || cents <= 0) e.valor = "Informe um valor válido.";
    if (tipo === "fixa") {
      const d = Number(dia);
      if (!Number.isInteger(d) || d < 1 || d > 31) e.dia = "Dia entre 1 e 31.";
    }
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (!validar()) return;
    setEnviando(true);
    const cents = paraCents(valor);
    const cat = categoriaId ? Number(categoriaId) : null;
    try {
      if (tipo === "variavel") {
        await api("/variaveis", { method: "POST", body: JSON.stringify({ descricao, valor_cents: cents, data, forma_pagamento: forma, categoria_id: cat }) });
      } else if (tipo === "entrada") {
        await api("/entradas", { method: "POST", body: JSON.stringify({ descricao, valor_cents: cents, data, recorrente, categoria_id: cat }) });
      } else {
        await api("/contas-fixas", { method: "POST", body: JSON.stringify({ nome: descricao, dia_vencimento: Number(dia), valor_estimado_cents: cents }) });
      }
      toast(tipo === "fixa" ? "Conta fixa criada." : "Transação adicionada.");
      atualizar();
      limpar();
      aoFechar();
    } catch (err) {
      toast((err as Error).message, "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Adicionar transação" aberto={aberto} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="campos">
        <div className="seg" role="tablist" aria-label="Tipo de transação">
          {([["variavel", "Despesa"], ["entrada", "Receita"], ["fixa", "Conta fixa"]] as [Tipo, string][]).map(([t, r]) => (
            <button type="button" key={t} role="tab" aria-selected={tipo === t}
              className={`btn ${tipo === t ? "btn-primario" : ""}`} onClick={() => setTipo(t)}>{r}</button>
          ))}
        </div>

        <div className="campo">
          <label htmlFor="add-desc">{tipo === "fixa" ? "Nome da conta" : "Descrição"}</label>
          <input id="add-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)}
            aria-invalid={!!erros.descricao} autoFocus />
          {erros.descricao && <span className="erro-campo">{erros.descricao}</span>}
        </div>

        <div className="campo">
          <label htmlFor="add-valor">Valor (R$)</label>
          <input id="add-valor" inputMode="decimal" placeholder="0,00" value={valor}
            onChange={(e) => setValor(e.target.value)} aria-invalid={!!erros.valor} />
          {erros.valor && <span className="erro-campo">{erros.valor}</span>}
        </div>

        {tipo === "fixa" ? (
          <div className="campo">
            <label htmlFor="add-dia">Dia de vencimento</label>
            <input id="add-dia" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} aria-invalid={!!erros.dia} />
            {erros.dia && <span className="erro-campo">{erros.dia}</span>}
          </div>
        ) : (
          <div className="campo">
            <label htmlFor="add-data">Data</label>
            <input id="add-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        )}

        {tipo === "variavel" && (
          <div className="campo">
            <label htmlFor="add-forma">Forma de pagamento</label>
            <select id="add-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </div>
        )}

        {tipo !== "fixa" && catsDoTipo.length > 0 && (
          <div className="campo">
            <label htmlFor="add-cat">Categoria</label>
            <div className="linha-form" style={{ alignItems: "stretch" }}>
              <select id="add-cat" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} style={{ flex: 1 }}>
                <option value="">— nenhuma —</option>
                {catsDoTipo.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <button type="button" className="btn" onClick={sugerirCategoria} disabled={sugerindo || !descricao.trim()} title="Sugerir com IA">
                {sugerindo ? "…" : "✨ IA"}
              </button>
            </div>
          </div>
        )}

        {tipo === "entrada" && (
          <label className="campo" style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} />
            <span>Receita recorrente</span>
          </label>
        )}

        <div className="acoes-modal">
          <button type="submit" className="btn btn-primario" disabled={enviando}>{enviando ? "Salvando…" : "Salvar"}</button>
          <button type="button" className="btn" onClick={aoFechar}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
