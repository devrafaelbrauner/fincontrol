import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";
import { IcCompromissos, IcMais } from "../components/icones";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAtualizacao } from "../estado";

type Compromisso = {
  id: number;
  nome: string;
  credor: string | null;
  categoria_id: number | null;
  categoria: string | null;
  categoria_cor: string | null;
  valor_total_cents: number;
  pago_cents: number;
  falta_cents: number;
  data_limite: string;
  forma_pagamento: string | null;
  orientacao_texto: string | null;
  status: "em_aberto" | "atrasado" | "quitado";
  ativo: boolean;
};

type Categoria = { id: number; nome: string; tipo: string };

type Pagamento = { id: number; descricao: string; valor_cents: number; data: string; forma_pagamento: string | null };

const FORMAS = ["pix", "credito", "debito", "dinheiro", "boleto"];

const dataBR = (iso: string) => new Date(iso + "T00:00").toLocaleDateString("pt-BR");

/** Dias até o vencimento; negativo = já passou. */
function diasRestantes(dataLimite: string): number {
  const hoje = new Date(hojeISO() + "T00:00").getTime();
  return Math.round((new Date(dataLimite + "T00:00").getTime() - hoje) / 86_400_000);
}

function rotuloPrazo(c: Compromisso): string {
  if (c.status === "quitado") return `quitado · vencia ${dataBR(c.data_limite)}`;
  const d = diasRestantes(c.data_limite);
  if (d < 0) return `atrasado há ${-d} dia${-d > 1 ? "s" : ""}`;
  if (d === 0) return "vence hoje";
  if (d === 1) return "vence amanhã";
  return `vence em ${d} dias · ${dataBR(c.data_limite)}`;
}

// Mesmos tiers do orçamento no Dashboard, invertidos: aqui progresso ALTO é bom.
const corBarra = (c: Compromisso) =>
  c.status === "quitado" ? "var(--positive)" : c.status === "atrasado" ? "var(--negative)" : "var(--accent)";

export default function Compromissos() {
  const toast = useToast();
  const { atualizar } = useAtualizacao();
  const [itens, setItens] = useState<Compromisso[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [verArquivados, setVerArquivados] = useState(false);

  // Cadastro / edição — o mesmo modal, distinguido por `edit`.
  const [formAberto, setFormAberto] = useState(false);
  const [edit, setEdit] = useState<Compromisso | null>(null);
  const [nome, setNome] = useState("");
  const [credor, setCredor] = useState("");
  const [valor, setValor] = useState("");
  const [dataLimite, setDataLimite] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [forma, setForma] = useState("");

  // Pagamento
  const [pagando, setPagando] = useState<Compromisso | null>(null);
  const [valorPag, setValorPag] = useState("");
  const [dataPag, setDataPag] = useState(hojeISO());
  const [formaPag, setFormaPag] = useState("");

  // Histórico de pagamentos (carregado sob demanda, ao expandir)
  const [expandido, setExpandido] = useState<number | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [cs, cats] = await Promise.all([
        api<Compromisso[]>(`/compromissos?incluir_arquivados=${verArquivados}`),
        api<Categoria[]>("/categorias").catch(() => [] as Categoria[]),
      ]);
      setItens(cs);
      setCategorias(cats.filter((c) => c.tipo === "variavel"));
      setErro(null);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [verArquivados]);

  useEffect(() => { carregar(); }, [carregar]);

  function abrirForm(c: Compromisso | null) {
    setEdit(c);
    setNome(c?.nome ?? "");
    setCredor(c?.credor ?? "");
    setValor(c ? (c.valor_total_cents / 100).toFixed(2).replace(".", ",") : "");
    setDataLimite(c?.data_limite ?? "");
    setCategoriaId(c?.categoria_id ? String(c.categoria_id) : "");
    setForma(c?.forma_pagamento ?? "");
    setFormAberto(true);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const cents = paraCents(valor);
    if (!(cents > 0)) { toast("Informe um valor maior que zero.", "erro"); return; }
    const corpo = JSON.stringify({
      nome,
      credor: credor.trim() || null,
      categoria_id: categoriaId ? Number(categoriaId) : null,
      valor_total_cents: cents,
      data_limite: dataLimite,
      forma_pagamento: forma || null,
    });
    try {
      if (edit) await api(`/compromissos/${edit.id}`, { method: "PATCH", body: corpo });
      else await api("/compromissos", { method: "POST", body: corpo });
      toast(edit ? "Compromisso atualizado." : "Compromisso criado.");
      setFormAberto(false);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function pagar(e: FormEvent) {
    e.preventDefault();
    if (!pagando) return;
    const cents = paraCents(valorPag);
    if (!(cents > 0)) { toast("Informe um valor maior que zero.", "erro"); return; }
    try {
      await api(`/compromissos/${pagando.id}/pagamentos`, {
        method: "POST",
        body: JSON.stringify({ valor_cents: cents, data: dataPag, forma_pagamento: formaPag || null }),
      });
      toast("Pagamento registrado.");
      setPagando(null); setValorPag(""); setFormaPag("");
      if (expandido === pagando.id) verPagamentos(pagando.id, true);
      carregar();
      // O pagamento é um gasto variável de verdade: o resto do app precisa saber.
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function verPagamentos(id: number, forcar = false) {
    if (expandido === id && !forcar) { setExpandido(null); return; }
    setExpandido(id);
    try {
      setPagamentos(await api<Pagamento[]>(`/compromissos/${id}/pagamentos`));
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function excluir(c: Compromisso) {
    if (!confirm(`Excluir "${c.nome}"? Os pagamentos já registrados continuam nos gastos do mês.`)) return;
    try {
      const r = await api<{ pagamentos_desvinculados: number }>(`/compromissos/${c.id}`, { method: "DELETE" });
      toast(r.pagamentos_desvinculados
        ? `Compromisso excluído. ${r.pagamentos_desvinculados} pagamento(s) seguem nos gastos.`
        : "Compromisso excluído.");
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function arquivar(c: Compromisso) {
    try {
      await api(`/compromissos/${c.id}`, { method: "PATCH", body: JSON.stringify({ ativo: !c.ativo }) });
      toast(c.ativo ? "Compromisso arquivado." : "Compromisso reativado.");
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  const emAberto = itens.filter((c) => c.status !== "quitado");
  const totalFalta = emAberto.reduce((s, c) => s + c.falta_cents, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2>Compromissos</h2>
          <p className="sub">Dívidas e obrigações com valor total e prazo — o que falta quitar.</p>
        </div>
        <button className="btn btn-primario" onClick={() => abrirForm(null)}><IcMais />Novo compromisso</button>
      </div>

      {emAberto.length > 0 && (
        <div className="chip" style={{ marginTop: "0.5rem" }}>
          {emAberto.length} em aberto · falta {brl(totalFalta)}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.75rem" }} className="sub">
        <input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} />
        Mostrar arquivados
      </label>

      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="grid-metas">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}</div>
      ) : itens.length === 0 ? (
        <p className="card sub">Nenhum compromisso ainda. Cadastre o primeiro — IPVA, IPTU, um acordo, dinheiro que você pegou emprestado.</p>
      ) : (
        <div className="grid-metas">
          {itens.map((c) => {
            const pct = Math.min((c.pago_cents / c.valor_total_cents) * 100, 100);
            return (
              <article key={c.id} className="card surgir" style={{ display: "flex", flexDirection: "column", gap: "0.7rem", opacity: c.ativo ? 1 : 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <IcCompromissos /> {c.nome}
                    </strong>
                    {c.credor && <div className="sub" style={{ fontSize: "0.8rem" }}>para {c.credor}</div>}
                  </div>
                  <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                    <button className="btn btn-icone" onClick={() => abrirForm(c)} aria-label={`Editar ${c.nome}`} title="Editar">✎</button>
                    <button className="btn btn-icone" onClick={() => arquivar(c)} aria-label={c.ativo ? `Arquivar ${c.nome}` : `Reativar ${c.nome}`} title={c.ativo ? "Arquivar" : "Reativar"}>{c.ativo ? "⌷" : "↺"}</button>
                    <button className="btn btn-icone btn-perigo" onClick={() => excluir(c)} aria-label={`Excluir ${c.nome}`} title="Excluir">×</button>
                  </div>
                </div>

                <div>
                  <div className="num">
                    {brl(c.pago_cents)} <span style={{ color: "var(--content-3)" }}>de {brl(c.valor_total_cents)}</span>
                  </div>
                  <div className="progresso" style={{ marginTop: "0.35rem" }}>
                    <i style={{ width: `${pct}%`, background: corBarra(c) }} />
                  </div>
                  <div className="sub" style={{ fontSize: "0.8rem", marginTop: "0.3rem", color: c.status === "atrasado" ? "var(--negative)" : undefined }}>
                    {c.status === "quitado" ? rotuloPrazo(c) : `falta ${brl(c.falta_cents)} · ${rotuloPrazo(c)}`}
                  </div>
                </div>

                {c.categoria && (
                  <span className="chip" style={{ alignSelf: "flex-start" }}>
                    <span className="ponto" style={{ background: c.categoria_cor ?? "var(--content-3)" }} /> {c.categoria}
                  </span>
                )}

                {c.orientacao_texto && (
                  <div className="insights-sugestao" style={{ whiteSpace: "pre-line" }}>
                    <strong>Orientação da IA:</strong> {c.orientacao_texto}
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  {c.status !== "quitado" && (
                    <button className="btn btn-primario" onClick={() => { setPagando(c); setValorPag(""); setDataPag(hojeISO()); setFormaPag(""); }}>
                      Registrar pagamento
                    </button>
                  )}
                  <button className="btn" onClick={() => verPagamentos(c.id)}>
                    {expandido === c.id ? "Ocultar" : "Pagamentos"}
                  </button>
                </div>

                {expandido === c.id && (
                  <div className="plano">
                    {pagamentos.length === 0 ? (
                      <span className="sub" style={{ fontSize: "0.8rem" }}>Nenhum pagamento ainda.</span>
                    ) : pagamentos.map((p) => (
                      <div key={p.id} className="plano-item">
                        <div className="plano-item-linha" style={{ flex: 1 }}>
                          <span className="sub">{dataBR(p.data)}{p.forma_pagamento ? ` · ${p.forma_pagamento}` : ""}</span>
                          <span className="num">{brl(p.valor_cents)}</span>
                        </div>
                      </div>
                    ))}
                    <span className="sub" style={{ fontSize: "0.75rem" }}>
                      Cada pagamento é um gasto variável — some também na aba Variáveis e no orçamento da categoria.
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Modal aberto={formAberto} aoFechar={() => setFormAberto(false)} titulo={edit ? "Editar compromisso" : "Novo compromisso"}>
        <form onSubmit={salvar} className="form">
          <label>Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="IPVA 2026" />
          </label>
          <label>Para quem ou por quê
            <input value={credor} onChange={(e) => setCredor(e.target.value)} placeholder="Detran, João, reforma da cozinha…" />
          </label>
          <label>Valor total
            <input value={valor} onChange={(e) => setValor(e.target.value)} required inputMode="decimal" placeholder="1.200,00" />
          </label>
          <label>Vence em
            <input type="date" value={dataLimite} onChange={(e) => setDataLimite(e.target.value)} required />
          </label>
          <label>Categoria do gasto
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Forma de pagamento
            <select value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="">Não definida</option>
              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <button className="btn btn-primario" type="submit">{edit ? "Salvar" : "Criar"}</button>
        </form>
      </Modal>

      <Modal aberto={!!pagando} aoFechar={() => setPagando(null)} titulo={`Pagar ${pagando?.nome ?? ""}`}>
        <form onSubmit={pagar} className="form">
          {pagando && <p className="sub">Falta {brl(pagando.falta_cents)} de {brl(pagando.valor_total_cents)}.</p>}
          <label>Valor
            <input value={valorPag} onChange={(e) => setValorPag(e.target.value)} required inputMode="decimal" placeholder="400,00" autoFocus />
          </label>
          <label>Data
            <input type="date" value={dataPag} onChange={(e) => setDataPag(e.target.value)} required />
          </label>
          <label>Forma de pagamento
            <select value={formaPag} onChange={(e) => setFormaPag(e.target.value)}>
              <option value="">{pagando?.forma_pagamento ? `Do compromisso (${pagando.forma_pagamento})` : "Não definida"}</option>
              {FORMAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <p className="sub" style={{ fontSize: "0.78rem" }}>
            Isto lança um gasto variável na data escolhida — não registre o mesmo pagamento também na aba Variáveis.
          </p>
          <button className="btn btn-primario" type="submit">Registrar</button>
        </form>
      </Modal>
    </>
  );
}
