import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";
import { ProgressRing } from "../components/graficos";
import { IcExtrair, IcMais, IcMetas } from "../components/icones";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAtualizacao } from "../estado";

type Meta = {
  id: number;
  nome: string;
  valor_total_cents: number;
  valor_atual_cents: number;
  valor_mensal_necessario_cents: number;
  prazo: string;
  estrategia_texto: string | null;
};

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
  const [estrategiaId, setEstrategiaId] = useState<number | null>(null);

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
    try {
      await api(`/metas/${editMeta.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nome: editMeta.nome, valor_total_cents: editMeta.valor_total_cents, prazo: editMeta.prazo }),
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

  const corPct = (p: number) => (p >= 100 ? "var(--verde)" : p >= 60 ? "var(--azul)" : "var(--laranja)");

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
        <p className="glass card sub">Nenhuma meta ainda. Crie a primeira.</p>
      ) : (
        <div className="grid-metas">
          {metas.map((m) => {
            const pct = Math.min((m.valor_atual_cents / m.valor_total_cents) * 100, 100);
            return (
              <article key={m.id} className="glass card surgir" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
                  <ProgressRing pct={pct} cor={corPct(pct)} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}><IcMetas /> {m.nome}</strong>
                    <div className="num" style={{ marginTop: "0.2rem" }}>{brl(m.valor_atual_cents)} <span style={{ color: "var(--texto-3)" }}>/ {brl(m.valor_total_cents)}</span></div>
                    <div className="sub" style={{ fontSize: "0.8rem" }}>até {new Date(m.prazo + "T00:00").toLocaleDateString("pt-BR")}</div>
                  </div>
                </div>
                <div className="chip" style={{ alignSelf: "flex-start" }}>Sugestão: {brl(m.valor_mensal_necessario_cents)}/mês</div>
                {m.estrategia_texto && (
                  <div className="insights-sugestao"><strong>Estratégia da IA:</strong> {m.estrategia_texto}</div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button className="btn btn-primario" onClick={() => { setAporteMeta(m); setValorAporte(""); }}><IcMais />Aporte</button>
                  <button className="btn" onClick={() => gerarEstrategia(m)} disabled={estrategiaId === m.id}>
                    <IcExtrair />{estrategiaId === m.id ? "Gerando…" : m.estrategia_texto ? "Refazer estratégia" : "Estratégia IA"}
                  </button>
                  <button className="btn btn-icone" onClick={() => setEditMeta(m)} aria-label="Editar meta" title="Editar">✎</button>
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
              <input id="e-valor" inputMode="decimal" value={(editMeta.valor_total_cents / 100).toFixed(2).replace(".", ",")}
                onChange={(e) => setEditMeta({ ...editMeta, valor_total_cents: paraCents(e.target.value) || 0 })} required /></div>
            <div className="campo"><label htmlFor="e-prazo">Prazo</label>
              <input id="e-prazo" type="date" value={editMeta.prazo} onChange={(e) => setEditMeta({ ...editMeta, prazo: e.target.value })} required /></div>
            <div className="acoes-modal"><button className="btn btn-primario" type="submit">Salvar</button><button className="btn" type="button" onClick={() => setEditMeta(null)}>Cancelar</button></div>
          </form>
        )}
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
