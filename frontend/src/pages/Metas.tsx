import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, hojeISO, paraCents } from "../api";
import { ProgressRing } from "../components/graficos";
import { IcMais, IcMetas } from "../components/icones";
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

  const carregar = useCallback(() => {
    setCarregando(true);
    api<Meta[]>("/metas").then(setMetas).catch((e) => setErro(e.message)).finally(() => setCarregando(false));
  }, []);

  useEffect(carregar, [carregar, versao]);

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
                <button className="btn btn-primario" onClick={() => { setAporteMeta(m); setValorAporte(""); }}><IcMais />Aporte</button>
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
