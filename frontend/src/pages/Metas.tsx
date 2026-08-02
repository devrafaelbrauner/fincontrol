import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";
import { ProgressRing } from "../components/graficos";
import { IcExtrair, IcMais, IcMetas } from "../components/icones";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAtualizacao } from "../estado";

type Item = { id: number; nome: string; valor_cents: number; descricao: string | null };

type Meta = {
  id: number;
  nome: string;
  valor_total_cents: number;
  valor_atual_cents: number;
  valor_mensal_necessario_cents: number;
  prazo: string;
  estrategia_texto: string | null;
  itens: Item[];
};

type Sugestao = { nome: string; valor_cents: number; descricao: string | null };

export default function Metas() {
  const toast = useToast();
  const { versao, atualizar } = useAtualizacao();
  const [metas, setMetas] = useState<Meta[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [novaAberta, setNovaAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [prazo, setPrazo] = useState("");

  const [aporteMeta, setAporteMeta] = useState<Meta | null>(null);
  const [valorAporte, setValorAporte] = useState("");
  const [dataAporte, setDataAporte] = useState(hojeISO());

  const [editMeta, setEditMeta] = useState<Meta | null>(null);
  const [editValor, setEditValor] = useState("");
  const [estrategiaId, setEstrategiaId] = useState<number | null>(null);

  // Planejamento (sub-itens)
  const [itemMeta, setItemMeta] = useState<Meta | null>(null);   // meta do modal de item
  const [itemEdit, setItemEdit] = useState<Item | null>(null);   // item em edição (null = novo)
  const [itemNome, setItemNome] = useState("");
  const [itemValor, setItemValor] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [planMeta, setPlanMeta] = useState<Meta | null>(null);   // meta do modal de sugestões da IA
  const [planItens, setPlanItens] = useState<Sugestao[]>([]);
  const [planAnalise, setPlanAnalise] = useState("");
  const [planSel, setPlanSel] = useState<Set<number>>(new Set());
  const [planejandoId, setPlanejandoId] = useState<number | null>(null);

  function abrirItem(m: Meta, i: Item | null) {
    setItemMeta(m);
    setItemEdit(i);
    setItemNome(i?.nome ?? "");
    setItemValor(i ? (i.valor_cents / 100).toFixed(2).replace(".", ",") : "");
    setItemDesc(i?.descricao ?? "");
  }

  async function salvarItem(e: FormEvent) {
    e.preventDefault();
    if (!itemMeta) return;
    const cents = paraCents(itemValor);
    if (!(cents >= 0)) { toast("Valor inválido.", "erro"); return; }
    const corpo = JSON.stringify({ nome: itemNome, valor_cents: cents, descricao: itemDesc.trim() || null });
    try {
      if (itemEdit) await api(`/metas/${itemMeta.id}/itens/${itemEdit.id}`, { method: "PATCH", body: corpo });
      else await api(`/metas/${itemMeta.id}/itens`, { method: "POST", body: corpo });
      toast(itemEdit ? "Item atualizado." : "Item adicionado.");
      setItemMeta(null);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function excluirItem(m: Meta, i: Item) {
    try {
      await api(`/metas/${m.id}/itens/${i.id}`, { method: "DELETE" });
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function planejarComIa(m: Meta) {
    setPlanejandoId(m.id);
    try {
      const d = await api<{ itens: Sugestao[]; analise: string }>(`/ia/planejar-meta/${m.id}`, { method: "POST", body: "{}" });
      setPlanMeta(m);
      setPlanItens(d.itens);
      setPlanAnalise(d.analise);
      setPlanSel(new Set(d.itens.map((_, idx) => idx)));
    } catch (err) { toast((err as Error).message, "erro"); }
    finally { setPlanejandoId(null); }
  }

  async function aceitarSugestoes() {
    if (!planMeta) return;
    const escolhidos = planItens.filter((_, idx) => planSel.has(idx));
    try {
      for (const s of escolhidos) {
        await api(`/metas/${planMeta.id}/itens`, {
          method: "POST",
          body: JSON.stringify({ nome: s.nome, valor_cents: s.valor_cents, descricao: s.descricao }),
        });
      }
      toast(`${escolhidos.length} ${escolhidos.length === 1 ? "item adicionado" : "itens adicionados"} ao planejamento.`);
      setPlanMeta(null);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  const carregar = useCallback(() => {
    setCarregando(true);
    api<Meta[]>("/metas").then(setMetas).catch((e) => setErro(e.message)).finally(() => setCarregando(false));
  }, []);

  useEffect(carregar, [carregar, versao]);

  async function gerarEstrategia(m: Meta) {
    setEstrategiaId(m.id);
    try {
      await api(`/ia/estrategia-meta/${m.id}`, { method: "POST", body: "{}" });
      toast("Estratégia gerada pela IA.");
      carregar();
    } catch (e) { toast((e as Error).message, "erro"); }
    finally { setEstrategiaId(null); }
  }

  async function excluir(m: Meta) {
    if (!confirm(`Excluir a meta "${m.nome}" e seus aportes?`)) return;
    try {
      await api(`/metas/${m.id}`, { method: "DELETE" });
      toast("Meta excluída.");
      carregar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function salvarEdicao(e: FormEvent) {
    e.preventDefault();
    if (!editMeta) return;
    const cents = paraCents(editValor);
    if (!(cents > 0)) { toast("Valor inválido.", "erro"); return; }
    try {
      await api(`/metas/${editMeta.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nome: editMeta.nome, valor_total_cents: cents, prazo: editMeta.prazo }),
      });
      toast("Meta atualizada.");
      setEditMeta(null);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/metas", { method: "POST", body: JSON.stringify({ nome, valor_total_cents: paraCents(valor), prazo }) });
      toast("Meta criada.");
      setNome(""); setValor(""); setPrazo(""); setNovaAberta(false);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function aportar(e: FormEvent) {
    e.preventDefault();
    if (!aporteMeta) return;
    try {
      await api(`/metas/${aporteMeta.id}/aportes`, { method: "POST", body: JSON.stringify({ valor_cents: paraCents(valorAporte), data: dataAporte }) });
      toast("Aporte registrado.");
      setAporteMeta(null); setValorAporte("");
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  const corPct = (p: number) => (p >= 100 ? "var(--positive)" : p >= 60 ? "var(--accent)" : "var(--warning)");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2>Metas</h2>
          <p className="sub">Guarde para objetivos com prazo e acompanhe o progresso.</p>
        </div>
        <button className="btn btn-primario" onClick={() => setNovaAberta(true)}><IcMais />Nova meta</button>
      </div>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="grid-metas">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}</div>
      ) : metas.length === 0 ? (
        <p className="card sub">Nenhuma meta ainda. Crie a primeira.</p>
      ) : (
        <div className="grid-metas">
          {metas.map((m) => {
            const pct = Math.min((m.valor_atual_cents / m.valor_total_cents) * 100, 100);
            return (
              <article key={m.id} className="card surgir" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
                  <ProgressRing pct={pct} cor={corPct(pct)} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><IcMetas /> {m.nome}</strong>
                    <div className="num" style={{ marginTop: "0.2rem" }}>{brl(m.valor_atual_cents)} <span style={{ color: "var(--content-3)" }}>/ {brl(m.valor_total_cents)}</span></div>
                    <div className="sub" style={{ fontSize: "0.8rem" }}>até {new Date(m.prazo + "T00:00").toLocaleDateString("pt-BR")}</div>
                  </div>
                </div>
                <div className="chip" style={{ alignSelf: "flex-start" }}>Sugestão: {brl(m.valor_mensal_necessario_cents)}/mês</div>
                {m.estrategia_texto && (
                  <div className="insights-sugestao" style={{ whiteSpace: "pre-line" }}><strong>Estratégia da IA:</strong> {m.estrategia_texto}</div>
                )}

                <div className="plano">
                  <div className="plano-topo">
                    <span className="plano-titulo">Planejamento</span>
                    {m.itens.length > 0 && (() => {
                      const soma = m.itens.reduce((s, i) => s + i.valor_cents, 0);
                      const estoura = soma > m.valor_total_cents;
                      return (
                        <span className="sub" style={{ fontSize: "0.78rem", color: estoura ? "var(--warning)" : undefined }}>
                          {brl(soma)} planejado{estoura ? ` — ${brl(soma - m.valor_total_cents)} acima do objetivo` : ` de ${brl(m.valor_total_cents)}`}
                        </span>
                      );
                    })()}
                  </div>
                  {m.itens.map((i) => (
                    <div key={i.id} className="plano-item">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="plano-item-linha">
                          <strong>{i.nome}</strong>
                          <span className="num">{brl(i.valor_cents)}</span>
                        </div>
                        {i.descricao && <div className="sub" style={{ fontSize: "0.78rem", whiteSpace: "pre-line" }}>{i.descricao}</div>}
                      </div>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button className="btn btn-icone" onClick={() => abrirItem(m, i)} aria-label={`Editar ${i.nome}`} title="Editar">✎</button>
                        <button className="btn btn-icone btn-perigo" onClick={() => excluirItem(m, i)} aria-label={`Excluir ${i.nome}`} title="Excluir">×</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => abrirItem(m, null)}><IcMais />Adicionar item</button>
                    <button className="btn" onClick={() => planejarComIa(m)} disabled={planejandoId === m.id}>
                      <IcExtrair />{planejandoId === m.id ? "Planejando…" : "Planejar com IA"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="btn btn-primario" onClick={() => { setAporteMeta(m); setValorAporte(""); }}><IcMais />Aporte</button>
                  <button className="btn" onClick={() => gerarEstrategia(m)} disabled={estrategiaId === m.id}>
                    <IcExtrair />{estrategiaId === m.id ? "Gerando…" : m.estrategia_texto ? "Refazer estratégia" : "Estratégia IA"}
                  </button>
                  <button className="btn btn-icone" onClick={() => { setEditMeta(m); setEditValor((m.valor_total_cents / 100).toFixed(2).replace(".", ",")); }} aria-label="Editar meta" title="Editar">✎</button>
                  <button className="btn btn-icone btn-perigo" onClick={() => excluir(m)} aria-label="Excluir meta" title="Excluir">×</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal titulo="Nova meta" aberto={novaAberta} aoFechar={() => setNovaAberta(false)}>
        <form onSubmit={criar} className="campos">
          <div className="campo"><label htmlFor="m-nome">Nome</label><input id="m-nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus /></div>
          <div className="campo"><label htmlFor="m-valor">Valor total (R$)</label><input id="m-valor" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} required /></div>
          <div className="campo"><label htmlFor="m-prazo">Prazo</label><input id="m-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} required /></div>
          <div className="acoes-modal"><button className="btn btn-primario" type="submit">Criar</button><button className="btn" type="button" onClick={() => setNovaAberta(false)}>Cancelar</button></div>
        </form>
      </Modal>

      <Modal titulo="Editar meta" aberto={!!editMeta} aoFechar={() => setEditMeta(null)}>
        {editMeta && (
          <form onSubmit={salvarEdicao} className="campos">
            <div className="campo"><label htmlFor="e-nome">Nome</label>
              <input id="e-nome" value={editMeta.nome} onChange={(e) => setEditMeta({ ...editMeta, nome: e.target.value })} required autoFocus /></div>
            <div className="campo"><label htmlFor="e-valor">Valor total (R$)</label>
              <input id="e-valor" inputMode="decimal" placeholder="0,00" value={editValor}
                onChange={(e) => setEditValor(e.target.value)} required /></div>
            <div className="campo"><label htmlFor="e-prazo">Prazo</label>
              <input id="e-prazo" type="date" value={editMeta.prazo} onChange={(e) => setEditMeta({ ...editMeta, prazo: e.target.value })} required /></div>
            <div className="acoes-modal"><button className="btn btn-primario" type="submit">Salvar</button><button className="btn" type="button" onClick={() => setEditMeta(null)}>Cancelar</button></div>
          </form>
        )}
      </Modal>

      <Modal titulo={`${itemEdit ? "Editar" : "Adicionar"} item — ${itemMeta?.nome ?? ""}`} aberto={!!itemMeta} aoFechar={() => setItemMeta(null)}>
        <form onSubmit={salvarItem} className="campos">
          <div className="campo"><label htmlFor="i-nome">Nome do item</label>
            <input id="i-nome" value={itemNome} onChange={(e) => setItemNome(e.target.value)} required autoFocus placeholder="Passagens, hospedagem…" /></div>
          <div className="campo"><label htmlFor="i-valor">Valor (R$)</label>
            <input id="i-valor" inputMode="decimal" placeholder="0,00" value={itemValor} onChange={(e) => setItemValor(e.target.value)} required /></div>
          <div className="campo"><label htmlFor="i-desc">Opções e planejamento</label>
            <textarea id="i-desc" rows={3} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)}
              placeholder="Datas, companhias, links, plano B…" /></div>
          <div className="acoes-modal">
            <button className="btn btn-primario" type="submit">{itemEdit ? "Salvar" : "Adicionar"}</button>
            <button className="btn" type="button" onClick={() => setItemMeta(null)}>Cancelar</button>
          </div>
        </form>
      </Modal>

      <Modal titulo={`Planejar com IA — ${planMeta?.nome ?? ""}`} aberto={!!planMeta} aoFechar={() => setPlanMeta(null)}>
        <div className="campos">
          {planAnalise && <div className="insights-sugestao" style={{ whiteSpace: "pre-line" }}>{planAnalise}</div>}
          <p className="sub" style={{ fontSize: "0.82rem" }}>Escolha o que entra no planejamento (valores são estimativas — edite depois):</p>
          {planItens.map((s, idx) => (
            <label key={idx} className="plano-sugestao">
              <input type="checkbox" checked={planSel.has(idx)} onChange={(e) => {
                const novo = new Set(planSel);
                if (e.target.checked) novo.add(idx); else novo.delete(idx);
                setPlanSel(novo);
              }} />
              <div style={{ minWidth: 0 }}>
                <div className="plano-item-linha"><strong>{s.nome}</strong><span className="num">{brl(s.valor_cents)}</span></div>
                {s.descricao && <div className="sub" style={{ fontSize: "0.78rem" }}>{s.descricao}</div>}
              </div>
            </label>
          ))}
          <div className="acoes-modal">
            <button className="btn btn-primario" onClick={aceitarSugestoes} disabled={planSel.size === 0}>
              Adicionar {planSel.size} {planSel.size === 1 ? "item" : "itens"}
            </button>
            <button className="btn" onClick={() => setPlanMeta(null)}>Cancelar</button>
          </div>
        </div>
      </Modal>

      <Modal titulo={`Aporte — ${aporteMeta?.nome ?? ""}`} aberto={!!aporteMeta} aoFechar={() => setAporteMeta(null)}>
        <form onSubmit={aportar} className="campos">
          <div className="campo"><label htmlFor="a-valor">Valor (R$)</label><input id="a-valor" inputMode="decimal" placeholder="0,00" value={valorAporte} onChange={(e) => setValorAporte(e.target.value)} required autoFocus /></div>
          <div className="campo"><label htmlFor="a-data">Data</label><input id="a-data" type="date" value={dataAporte} onChange={(e) => setDataAporte(e.target.value)} /></div>
          <div className="acoes-modal"><button className="btn btn-primario" type="submit">Registrar</button><button className="btn" type="button" onClick={() => setAporteMeta(null)}>Cancelar</button></div>
        </form>
      </Modal>
    </>
  );
}
