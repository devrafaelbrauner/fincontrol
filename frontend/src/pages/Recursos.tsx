import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, paraCents } from "../api";
import { IcMais, IcRecursos } from "../components/icones";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

type Conta = {
  id: number;
  banco: string;
  nome: string;
  ativa: boolean;
  saldo_cents: number | null;
  saldo_anterior_cents: number | null;
  variacao_cents: number | null;
  variacao_pct: number | null;
  pct_do_total: number | null;
  atualizado_em: string | null;
  versao: number;
};

type Resumo = {
  itens: Conta[];
  total_cents: number;
  variacao_total_cents: number | null;
  variacao_total_pct: number | null;
  contas_sem_saldo: number;
};

type Reconciliacao = {
  competencia: string;
  variacao_saldos_cents: number;
  explicado_lancamentos_cents: number;
  diferenca_cents: number;
  contas_medidas: number;
};

type Leitura = {
  id: number;
  valor_cents: number;
  registrado_em: string;
  observacao: string | null;
  variacao_cents: number | null;
  variacao_pct: number | null;
};

/** 'YYYY-MM-DD HH:MM:SS' (fuso do app) → '05/08/2026 16:42'. Sem `new Date()`:
 *  a string não tem fuso, e o Date a interpretaria como local/UTC conforme o
 *  navegador, deslocando a hora que o próprio servidor carimbou. */
function dataHora(iso: string): string {
  const [d, h] = iso.split(" ");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h ? ` ${h.slice(0, 5)}` : ""}`;
}

/** Variação com sinal explícito — "+" não sai do brl() e é o que diferencia
 *  ganho de perda numa lista lida de relance. */
function Variacao({ cents, pct }: { cents: number | null; pct: number | null }) {
  if (cents === null) return <span className="sub">primeira leitura</span>;
  if (cents === 0) return <span className="sub">sem variação</span>;
  const sobe = cents > 0;
  return (
    <span style={{ color: sobe ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
      {sobe ? "+" : "−"}{brl(Math.abs(cents))}
      {pct !== null && ` (${sobe ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)`}
    </span>
  );
}

export default function Recursos() {
  const toast = useToast();
  const { versao } = useAtualizacao();
  const { competencia } = useCompetencia();
  const [recon, setRecon] = useState<Reconciliacao | null>(null);
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [verArquivadas, setVerArquivadas] = useState(false);

  const [novaAberta, setNovaAberta] = useState(false);
  const [banco, setBanco] = useState("");
  const [nome, setNome] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");

  const [atualizando, setAtualizando] = useState<Conta | null>(null);
  const [modo, setModo] = useState<"total" | "delta">("total");
  const [valor, setValor] = useState("");
  const [sentido, setSentido] = useState<"mais" | "menos">("mais");
  const [obs, setObs] = useState("");

  const [expandida, setExpandida] = useState<number | null>(null);
  const [historico, setHistorico] = useState<Leitura[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await api<Resumo>(`/contas-bancarias?incluir_arquivadas=${verArquivadas}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [verArquivadas, versao]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criarConta(e: FormEvent) {
    e.preventDefault();
    const corpo: Record<string, unknown> = { banco, nome };
    if (saldoInicial.trim()) {
      const c = paraCents(saldoInicial);
      if (Number.isNaN(c)) { toast("Saldo inicial inválido.", "erro"); return; }
      corpo.saldo_inicial_cents = c;
    }
    try {
      await api("/contas-bancarias", { method: "POST", body: JSON.stringify(corpo) });
      toast("Conta cadastrada.");
      setBanco(""); setNome(""); setSaldoInicial(""); setNovaAberta(false);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  function abrirAtualizacao(c: Conta) {
    setAtualizando(c);
    // Sem saldo ainda, só faz sentido informar o total — não há do que variar.
    setModo(c.saldo_cents === null ? "total" : "total");
    setValor(""); setSentido("mais"); setObs("");
  }

  async function salvarSaldo(e: FormEvent) {
    e.preventDefault();
    if (!atualizando) return;
    const c = paraCents(valor);
    if (Number.isNaN(c)) { toast("Valor inválido.", "erro"); return; }
    const corpo = modo === "total"
      ? { valor_cents: c, observacao: obs.trim() || null }
      : { delta_cents: sentido === "mais" ? c : -c, observacao: obs.trim() || null };
    try {
      await api(`/contas-bancarias/${atualizando.id}/saldos`, { method: "POST", body: JSON.stringify(corpo) });
      toast("Saldo atualizado.");
      if (expandida === atualizando.id) verHistorico(atualizando.id, true);
      setAtualizando(null);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function verHistorico(id: number, forcar = false) {
    if (expandida === id && !forcar) { setExpandida(null); return; }
    setExpandida(id);
    try {
      setHistorico(await api<Leitura[]>(`/contas-bancarias/${id}/saldos`));
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function apagarLeitura(conta: number, leitura: number) {
    if (!confirm("Apagar esta leitura? O saldo volta a ser o da leitura anterior.")) return;
    try {
      await api(`/contas-bancarias/${conta}/saldos/${leitura}`, { method: "DELETE" });
      toast("Leitura removida.");
      verHistorico(conta, true);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function arquivar(c: Conta) {
    try {
      await api(`/contas-bancarias/${c.id}`, {
        method: "PATCH", body: JSON.stringify({ ativa: !c.ativa }),
        headers: { "If-Match": String(c.versao) },
      });
      toast(c.ativa ? "Conta arquivada." : "Conta reativada.");
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function excluir(c: Conta) {
    if (!confirm(`Excluir "${c.banco} — ${c.nome}"? O histórico de saldos vai junto.`)) return;
    try {
      await api(`/contas-bancarias/${c.id}`, { method: "DELETE" });
      toast("Conta excluída.");
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  const itens = dados?.itens ?? [];

  async function verReconciliacao() {
    setRecon(null);
    try {
      setRecon(await api<Reconciliacao>(`/contas-bancarias/reconciliacao/${competencia}`));
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p className="sub">Onde seu dinheiro está hoje, e como cada conta variou.</p>
        </div>
        <button className="btn btn-primario" onClick={() => setNovaAberta(true)}><IcMais />Nova conta</button>
      </div>

      {dados && itens.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <div className="sub">Total em contas</div>
          <div className="num" style={{ fontSize: "1.6rem" }}>{brl(dados.total_cents)}</div>
          <div style={{ marginTop: "0.3rem" }}>
            <Variacao cents={dados.variacao_total_cents} pct={dados.variacao_total_pct} />
            <span className="sub"> desde a leitura anterior</span>
          </div>
          {dados.contas_sem_saldo > 0 && (
            <div className="sub" style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>
              {dados.contas_sem_saldo} conta(s) ainda sem saldo registrado — não entram no total.
            </div>
          )}
          {/* Distribuição: uma barra só, uma fatia por conta com saldo positivo. */}
          {dados.total_cents > 0 && (
            <div className="progresso" style={{ marginTop: "0.7rem", display: "flex", overflow: "hidden" }}>
              {itens.filter((c) => (c.saldo_cents ?? 0) > 0).map((c, i) => (
                <i key={c.id}
                   title={`${c.banco} — ${c.nome}: ${c.pct_do_total?.toFixed(1)}%`}
                   style={{
                     width: `${c.pct_do_total ?? 0}%`,
                     position: "relative",
                     background: `var(--accent)`,
                     opacity: 1 - (i % 4) * 0.18,
                   }} />
              ))}
            </div>
          )}
        </div>
      )}

      {dados && itens.length > 0 && (
        <div style={{ marginTop: "0.6rem" }}>
          <button className="btn" onClick={verReconciliacao}>
            Conferir com os lançamentos de {competencia.slice(5, 7)}/{competencia.slice(0, 4)}
          </button>
        </div>
      )}

      {recon && (
        <div className="card insights-sugestao" style={{ marginTop: "0.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <strong>Saldos × lançamentos</strong>
            <button className="btn btn-icone" onClick={() => setRecon(null)} aria-label="Fechar">×</button>
          </div>
          {recon.contas_medidas === 0 ? (
            <p className="sub">
              Nenhuma conta tem leitura de saldo neste mês E no anterior — sem os dois pontos não
              há variação a comparar.
            </p>
          ) : (
            <>
              <p className="sub" style={{ marginBottom: "0.3rem" }}>
                Seus saldos variaram <strong>{brl(recon.variacao_saldos_cents)}</strong>;
                os lançamentos explicam <strong>{brl(recon.explicado_lancamentos_cents)}</strong>.
              </p>
              {recon.diferenca_cents === 0 ? (
                <p style={{ color: "var(--positive)" }}>Bate exatamente — nada ficou de fora.</p>
              ) : (
                <p>
                  <strong style={{ color: "var(--warning)" }}>
                    {brl(Math.abs(recon.diferenca_cents))} {recon.diferenca_cents > 0 ? "a mais" : "a menos"}
                  </strong>{" "}
                  do que os lançamentos explicam — dinheiro que se moveu sem passar por nenhum
                  registro: rendimento, tarifa, transferência entre contas ou um gasto esquecido.
                </p>
              )}
              <p className="sub" style={{ fontSize: "0.78rem" }}>
                Considera {recon.contas_medidas} conta(s) com leitura antes e dentro do mês. Conta fixa
                não paga não entra: ela ainda não saiu do banco.
              </p>
            </>
          )}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.75rem" }} className="sub">
        <input type="checkbox" checked={verArquivadas} onChange={(e) => setVerArquivadas(e.target.checked)} />
        Mostrar arquivadas
      </label>

      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="grid-metas">{[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 140 }} />)}</div>
      ) : itens.length === 0 ? (
        <p className="sub">Nenhuma conta cadastrada. Comece pelo banco onde está a maior parte do seu dinheiro.</p>
      ) : (
        <div className="grid-metas">
          {itens.map((c) => (
            <article key={c.id} className="ficha surgir" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", opacity: c.ativa ? 1 : 0.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <IcRecursos /> {c.banco}
                  </strong>
                  <div className="sub" style={{ fontSize: "0.82rem" }}>{c.nome}</div>
                </div>
                <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                  <button className="btn btn-icone" onClick={() => arquivar(c)} title={c.ativa ? "Arquivar" : "Reativar"}
                    aria-label={c.ativa ? `Arquivar ${c.banco}` : `Reativar ${c.banco}`}>{c.ativa ? "⌷" : "↺"}</button>
                  <button className="btn btn-icone btn-perigo" onClick={() => excluir(c)}
                    aria-label={`Excluir ${c.banco}`} title="Excluir">×</button>
                </div>
              </div>

              <div>
                <div className="num" style={{ fontSize: "1.3rem" }}>
                  {c.saldo_cents === null ? <span className="sub">sem saldo registrado</span> : brl(c.saldo_cents)}
                </div>
                <div style={{ marginTop: "0.2rem" }}>
                  <Variacao cents={c.variacao_cents} pct={c.variacao_pct} />
                </div>
                {c.atualizado_em && (
                  <div className="sub" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                    atualizado em {dataHora(c.atualizado_em)}
                    {c.pct_do_total !== null && ` · ${c.pct_do_total.toFixed(1)}% do total`}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <button className="btn btn-primario" onClick={() => abrirAtualizacao(c)}>Atualizar saldo</button>
                <button className="btn" onClick={() => verHistorico(c.id)}>
                  {expandida === c.id ? "Ocultar" : "Histórico"}
                </button>
              </div>

              {expandida === c.id && (
                <div className="plano">
                  {historico.length === 0 ? (
                    <span className="sub" style={{ fontSize: "0.8rem" }}>Nenhuma leitura ainda.</span>
                  ) : historico.map((l) => (
                    <div key={l.id} className="plano-item">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="plano-item-linha">
                          <span className="sub">{dataHora(l.registrado_em)}</span>
                          <span className="num">{brl(l.valor_cents)}</span>
                        </div>
                        <div style={{ fontSize: "0.8rem" }}>
                          <Variacao cents={l.variacao_cents} pct={l.variacao_pct} />
                          {l.observacao && <span className="sub"> · {l.observacao}</span>}
                        </div>
                      </div>
                      <button className="btn btn-icone btn-perigo" onClick={() => apagarLeitura(c.id, l.id)}
                        aria-label="Apagar leitura" title="Apagar leitura">×</button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal aberto={novaAberta} aoFechar={() => setNovaAberta(false)} titulo="Nova conta">
        <form onSubmit={criarConta} className="form">
          <label>Banco
            <input value={banco} onChange={(e) => setBanco(e.target.value)} required placeholder="Nubank" />
          </label>
          <label>Nome da conta
            <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Conta corrente" />
          </label>
          <label>Saldo atual (opcional)
            <input value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)}
              inputMode="decimal" placeholder="1.500,00" />
          </label>
          <p className="sub" style={{ fontSize: "0.78rem" }}>
            Sem saldo, a conta entra como "sem saldo registrado" e fica fora do total até a primeira leitura.
          </p>
          <button className="btn btn-primario" type="submit">Cadastrar</button>
        </form>
      </Modal>

      <Modal aberto={!!atualizando} aoFechar={() => setAtualizando(null)}
        titulo={atualizando ? `${atualizando.banco} — ${atualizando.nome}` : ""}>
        <form onSubmit={salvarSaldo} className="form">
          {atualizando?.saldo_cents !== null && atualizando && (
            <p className="sub">Saldo atual: {brl(atualizando.saldo_cents!)}</p>
          )}

          {atualizando?.saldo_cents !== null && (
            <div role="group" aria-label="Como informar" style={{ display: "flex", gap: "0.4rem" }}>
              <button type="button" className={`btn${modo === "total" ? " btn-primario" : ""}`}
                onClick={() => setModo("total")}>Novo saldo</button>
              <button type="button" className={`btn${modo === "delta" ? " btn-primario" : ""}`}
                onClick={() => setModo("delta")}>Quanto mudou</button>
            </div>
          )}

          {modo === "delta" && (
            <div role="group" aria-label="Sentido" style={{ display: "flex", gap: "0.4rem" }}>
              <button type="button" className={`btn${sentido === "mais" ? " btn-primario" : ""}`}
                onClick={() => setSentido("mais")}>Entrou (+)</button>
              <button type="button" className={`btn${sentido === "menos" ? " btn-primario" : ""}`}
                onClick={() => setSentido("menos")}>Saiu (−)</button>
            </div>
          )}

          <label>{modo === "total" ? "Novo saldo" : "Valor da variação"}
            <input value={valor} onChange={(e) => setValor(e.target.value)} required inputMode="decimal"
              placeholder={modo === "total" ? "1.750,00" : "250,00"} autoFocus />
          </label>
          <label>Observação (opcional)
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="rendimento, transferência…" />
          </label>
          <p className="sub" style={{ fontSize: "0.78rem" }}>
            Isto não lança nada nas suas despesas ou entradas — é só o retrato de onde o dinheiro está.
          </p>
          <button className="btn btn-primario" type="submit">Registrar</button>
        </form>
      </Modal>
    </>
  );
}
