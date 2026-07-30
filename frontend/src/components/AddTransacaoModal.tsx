import { FormEvent, useEffect, useState } from "react";
import { api, hojeISO, paraCents } from "../api";
import { useAtualizacao } from "../estado";
import AnexoCampo from "./AnexoCampo";
import Modal from "./Modal";
import { useToast } from "./Toast";

type Tipo = "variavel" | "entrada" | "fixa";
type Categoria = { id: number; nome: string; tipo: string };
type Extraido = {
  tipo?: Tipo; descricao?: string | null; valor_cents?: number | null;
  data?: string | null; vencimento?: string | null; dia_vencimento?: number | null;
  forma_pagamento?: string | null; categoria?: string | null;
};

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

  const [nlTexto, setNlTexto] = useState("");
  const [interpretando, setInterpretando] = useState(false);
  const [anexoId, setAnexoId] = useState<number | null>(null);
  const [extraindo, setExtraindo] = useState(false);

  useEffect(() => {
    if (aberto) api<Categoria[]>("/categorias").then(setCategorias).catch(() => setCategorias([]));
  }, [aberto]);

  const catsDoTipo = categorias.filter((c) => c.tipo === (tipo === "fixa" ? "fixa" : tipo));

  const centsParaTexto = (c: number) => (c / 100).toFixed(2).replace(".", ",");

  /** Pré-preenche o formulário com dados vindos da IA (extração ou linguagem natural). */
  function aplicar(d: Extraido) {
    if (d.tipo === "variavel" || d.tipo === "entrada" || d.tipo === "fixa") setTipo(d.tipo);
    if (d.descricao) setDescricao(d.descricao);
    if (d.valor_cents != null) setValor(centsParaTexto(d.valor_cents));
    if (d.data) setData(d.data);
    if (d.vencimento) { setData(d.vencimento); const dd = Number(d.vencimento.slice(8, 10)); if (dd) setDia(String(dd)); }
    if (d.dia_vencimento) setDia(String(d.dia_vencimento));
    if (d.forma_pagamento) setForma(d.forma_pagamento);
    if (d.categoria) { const c = categorias.find((x) => x.nome === d.categoria); if (c) setCategoriaId(String(c.id)); }
  }

  async function interpretar() {
    if (!nlTexto.trim()) return;
    setInterpretando(true);
    try {
      aplicar(await api<Extraido>("/ia/interpretar", { method: "POST", body: JSON.stringify({ texto: nlTexto }) }));
      toast("Preenchido pela IA — confira antes de salvar.");
    } catch (err) {
      toast((err as Error).message, "erro");
    } finally {
      setInterpretando(false);
    }
  }

  async function extrairAnexo() {
    if (!anexoId) return;
    setExtraindo(true);
    try {
      aplicar(await api<Extraido>(`/ia/extrair/${anexoId}`, { method: "POST", body: "{}" }));
      toast("Dados do comprovante extraídos — confira antes de salvar.");
    } catch (err) {
      toast((err as Error).message, "erro");
    } finally {
      setExtraindo(false);
    }
  }

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
    setDescricao(""); setValor(""); setData(hojeISO()); setDia("10"); setRecorrente(false);
    setCategoriaId(""); setErros({}); setNlTexto(""); setAnexoId(null);
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
        await api("/variaveis", { method: "POST", body: JSON.stringify({ descricao, valor_cents: cents, data, forma_pagamento: forma, categoria_id: cat, anexo_id: anexoId }) });
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
        <div className="ia-box">
          <label htmlFor="add-nl" style={{ fontSize: "0.8rem", color: "var(--content-2)" }}>
            ✨ Descreva em uma frase, ou anexe um comprovante:
          </label>
          <div className="linha-form" style={{ alignItems: "stretch" }}>
            <input id="add-nl" placeholder="ex: paguei 50 no mercado ontem no crédito"
              value={nlTexto} onChange={(e) => setNlTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); interpretar(); } }} style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={interpretar} disabled={interpretando || !nlTexto.trim()}>
              {interpretando ? "…" : "Interpretar"}
            </button>
          </div>
          <div className="linha-form" style={{ alignItems: "center" }}>
            <AnexoCampo anexoId={anexoId} onChange={setAnexoId} />
            {anexoId && (
              <button type="button" className="btn" onClick={extrairAnexo} disabled={extraindo}>
                {extraindo ? "Lendo…" : "Extrair do comprovante"}
              </button>
            )}
          </div>
        </div>

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
