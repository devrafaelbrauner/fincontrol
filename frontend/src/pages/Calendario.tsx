import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtualizacao } from "../estado";
import { api, brl } from "../api";
import { IcExpandir, IcRecolher } from "../components/icones";

type Lancamento = { id: number; nome: string; valor_cents: number; vencimento: string; status: "pago" | "pendente" | "atrasado" };
type FeedInfo = { token: string; caminho: string; url: string; webcal: string };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const competenciaDe = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export default function Calendario() {
  const { versao } = useAtualizacao();
  const hoje = useMemo(() => new Date(), []);
  // Sempre abre no mês atual.
  const [mes, setMes] = useState<string>(competenciaDe(hoje));
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [assinaturaAberta, setAssinaturaAberta] = useState(false);
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    api<Lancamento[]>(`/contas-fixas/lancamentos/${mes}`)
      .then(setLancamentos)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [mes, versao]);

  useEffect(carregar, [carregar]);

  function passoMes(delta: number) {
    const [ano, m] = mes.split("-").map(Number);
    const d = new Date(ano, m - 1 + delta, 1);
    setMes(competenciaDe(d));
  }

  const [ano, m] = mes.split("-").map(Number);
  const primeiroDiaSemana = new Date(ano, m - 1, 1).getDay();
  const diasNoMes = new Date(ano, m, 0).getDate();
  const ehMesAtual = mes === competenciaDe(hoje);

  const porDia = useMemo(() => {
    const mapa = new Map<number, Lancamento[]>();
    for (const l of lancamentos) {
      const dia = Number(l.vencimento.slice(8, 10));
      (mapa.get(dia) ?? mapa.set(dia, []).get(dia)!).push(l);
    }
    return mapa;
  }, [lancamentos]);

  const proximas = useMemo(() => {
    const hojeIso = `${competenciaDe(hoje)}-${pad(hoje.getDate())}`;
    return lancamentos
      .filter((l) => l.status !== "pago" && (!ehMesAtual || l.vencimento >= hojeIso))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }, [lancamentos, ehMesAtual, hoje]);

  const celulas: (number | null)[] = [
    ...Array(primeiroDiaSemana).fill(null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];
  const rotuloMes = new Date(ano, m - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const mesExtenso = rotuloMes.charAt(0).toUpperCase() + rotuloMes.slice(1);

  async function abrirAssinatura() {
    setAssinaturaAberta((a) => !a);
    if (!feed) {
      try { setFeed(await api<FeedInfo>("/calendario")); } catch (e) { setErro((e as Error).message); }
    }
  }
  async function regenerar() {
    if (!confirm("Gerar uma nova URL invalida a atual — você terá que reassinar em todos os aparelhos. Continuar?")) return;
    try { setFeed(await api<FeedInfo>("/calendario/regenerar", { method: "POST", body: "{}" })); setCopiado(false); } catch (e) { setErro((e as Error).message); }
  }
  async function copiar() { if (feed) { await navigator.clipboard.writeText(feed.url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } }

  return (
    <>
      <p className="sub">Vencimentos das contas fixas do mês. Hoje: {hoje.toLocaleDateString("pt-BR")}.</p>
      {erro && <p className="erro">{erro}</p>}

      <section className="ficha surgir">
        <div className="cal-topo">
          <button className="btn btn-icone" onClick={() => passoMes(-1)} aria-label="Mês anterior"><IcRecolher /></button>
          <span className="cal-mes">{mesExtenso}</span>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {!ehMesAtual && <button className="btn" onClick={() => setMes(competenciaDe(hoje))}>Hoje</button>}
            <button className="btn btn-icone" onClick={() => passoMes(1)} aria-label="Próximo mês"><IcExpandir /></button>
          </div>
        </div>

        <div className="cal-semana" aria-hidden="true">{DIAS.map((d) => <span key={d}>{d}</span>)}</div>
        {carregando ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <div className="cal-grade">
            {celulas.map((dia, i) => {
              if (dia == null) return <div key={`v${i}`} className="cal-dia vazio" />;
              const contas = porDia.get(dia) ?? [];
              const ehHoje = ehMesAtual && dia === hoje.getDate();
              const pior = contas.some((c) => c.status === "atrasado") ? "atrasado" : contas.some((c) => c.status === "pendente") ? "pendente" : "pago";
              return (
                <div key={dia} className={`cal-dia${ehHoje ? " hoje" : ""}`}
                  aria-label={`Dia ${dia}${contas.length ? `, ${contas.length} vencimento(s)` : ""}`}>
                  <span className="n">{dia}</span>
                  {/* Tokens semânticos: --verde/--laranja/--vermelho nunca
                      existiram no app.css, então este ponto — que é o ÚNICO
                      indicador de status no mobile, onde os rótulos .cal-venc
                      são escondidos — vinha sendo pintado com uma cor inválida,
                      ou seja, com nada. */}
                  {contas.length > 0 && <span className="ponto-venc" style={{ background: `var(--${pior === "pago" ? "positive" : pior === "pendente" ? "warning" : "negative"})` }} />}
                  {contas.slice(0, 2).map((c) => (
                    <span key={c.id} className={`cal-venc ${c.status}`} title={`${c.nome} — ${brl(c.valor_cents)} (${c.status})`}>{c.nome}</span>
                  ))}
                  {contas.length > 2 && <span className="cal-mais">+{contas.length - 2}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="secao">
        <h3 className="secao-titulo">Próximas contas a vencer</h3>
        {proximas.length === 0 ? (
          <p className="sub">Nada pendente {ehMesAtual ? "daqui pra frente neste mês" : "neste mês"}. 🎉</p>
        ) : (
          <div className="card">
            {proximas.map((l) => {
              const d = new Date(l.vencimento + "T00:00");
              return (
                <div key={l.id} className="prox-item">
                  <div className="dia">
                    <b>{d.getDate()}</b>
                    <small>{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{l.nome}</div>
                    <div className="sub" style={{ fontSize: "0.8rem" }}>{d.toLocaleDateString("pt-BR", { weekday: "long" })}</div>
                  </div>
                  <div className="num" style={{ fontWeight: 600 }}>{brl(l.valor_cents)}</div>
                  <span className={`badge ${l.status}`}>{l.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="secao">
        <button className="btn" onClick={abrirAssinatura} aria-expanded={assinaturaAberta}>
          {assinaturaAberta ? "Ocultar" : "Assinar em outro app (.ics)"}
        </button>
        {assinaturaAberta && feed && (
          <div className="ficha surgir" style={{ marginTop: "0.75rem", maxWidth: 640 }}>
            <p className="sub">Assine no iPhone/Mac ou Google Calendar para receber os mesmos vencimentos com lembrete automático.</p>
            <div className="cal-url">
              <code>{feed.url}</code>
              <button className="btn" onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button>
            </div>
            <div className="linha-form">
              <a href={feed.webcal} className="btn btn-primario">Assinar no Apple Calendar</a>
              <button onClick={regenerar} className="btn btn-perigo">Gerar nova URL</button>
            </div>
            <p className="cal-aviso">⚠️ Esta URL dá acesso de leitura aos seus vencimentos — trate como senha.</p>
          </div>
        )}
      </section>
    </>
  );
}
