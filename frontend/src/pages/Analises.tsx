import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { BarChart, BarrasRank, BarraMes, Donut, FatiaDonut } from "../components/graficos";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

type Dash = { competencia: string; entradas_cents: number; fixas_cents: number; variaveis_cents: number };
type Categoria = { id: number; nome: string; tipo: string; cor: string | null; ativa: number };
type Variavel = { valor_cents: number; categoria_id: number | null; forma_pagamento: string | null };

const PALETA = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#22d3ee", "#f472b6", "#94a3b8"];
const FORMA_ROTULO: Record<string, string> = { pix: "Pix", credito: "Crédito", debito: "Débito", dinheiro: "Dinheiro", boleto: "Boleto" };

function ultimasCompetencias(fim: string, n: number): string[] {
  let [ano, mes] = fim.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${ano}-${String(mes).padStart(2, "0")}`);
    mes--;
    if (mes === 0) { mes = 12; ano--; }
  }
  return out;
}
const mesCurto = (c: string) => new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", { month: "short" });

export default function Analises() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao, atualizar } = useAtualizacao();

  const [barras, setBarras] = useState<BarraMes[]>([]);
  const [porCategoria, setPorCategoria] = useState<FatiaDonut[]>([]);
  const [porForma, setPorForma] = useState<FatiaDonut[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("variavel");
  const [cor, setCor] = useState("#60a5fa");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const comps = ultimasCompetencias(competencia, 6);
      const dashes = await Promise.all(comps.map((c) => api<Dash>(`/dashboard/${c}`)));
      setBarras(dashes.map((d) => ({ rotulo: mesCurto(d.competencia), entradas: d.entradas_cents, gastos: d.fixas_cents + d.variaveis_cents })));

      const ate = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)), 0).getDate();
      const [vars, cats] = await Promise.all([
        api<{ itens: Variavel[] }>(`/variaveis?de=${competencia}-01&ate=${competencia}-${String(ate).padStart(2, "0")}`),
        api<Categoria[]>("/categorias"),
      ]);
      setCategorias(cats);
      const mapaCat = new Map(cats.map((c) => [c.id, c] as const));

      const somaCat = new Map<string, { valor: number; cor: string }>();
      const somaForma = new Map<string, number>();
      let i = 0;
      for (const v of vars.itens) {
        const c = v.categoria_id != null ? mapaCat.get(v.categoria_id) : undefined;
        const nomeCat = c?.nome ?? "Sem categoria";
        const corCat = c?.cor ?? (nomeCat === "Sem categoria" ? "#6b7080" : PALETA[i++ % PALETA.length]);
        const at = somaCat.get(nomeCat) ?? { valor: 0, cor: corCat };
        at.valor += v.valor_cents; somaCat.set(nomeCat, at);
        const f = v.forma_pagamento ?? "outro";
        somaForma.set(f, (somaForma.get(f) ?? 0) + v.valor_cents);
      }
      setPorCategoria([...somaCat.entries()].map(([rotulo, x]) => ({ rotulo, valor: x.valor, cor: x.cor })).sort((a, b) => b.valor - a.valor));
      setPorForma([...somaForma.entries()].map(([f, valor], j) => ({ rotulo: FORMA_ROTULO[f] ?? f, valor, cor: PALETA[j % PALETA.length] })).sort((a, b) => b.valor - a.valor));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [competencia, versao]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criarCategoria(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      await api("/categorias", { method: "POST", body: JSON.stringify({ nome: nome.trim(), tipo, cor }) });
      toast("Categoria criada.");
      setNome("");
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function mudarCor(id: number, novaCor: string) {
    await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ cor: novaCor }) });
    atualizar();
  }

  async function desativar(id: number) {
    if (!confirm("Desativar esta categoria? Ela some das listas (os lançamentos existentes são mantidos).")) return;
    await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ ativa: false }) });
    toast("Categoria desativada.");
    atualizar();
  }

  const mesExtenso = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)) - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (erro) return <p className="erro">{erro}</p>;

  return (
    <>
      <h2>Análises</h2>
      <p className="sub">Entradas × gastos, distribuição por categoria e forma de pagamento — {mesExtenso} (troque o mês no topo).</p>

      {carregando ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : (
        <>
          <section className="glass card surgir">
            <h3>Entradas × Gastos (6 meses)</h3>
            <BarChart dados={barras} />
            <div className="legenda" style={{ flexDirection: "row", gap: "1rem", marginTop: "0.5rem" }}>
              <span className="item"><span className="ponto" style={{ background: "var(--verde)" }} />Entradas</span>
              <span className="item"><span className="ponto" style={{ background: "var(--vermelho)" }} />Gastos</span>
            </div>
          </section>

          <div className="grid-2 secao">
            <section className="glass card surgir">
              <h3>Gastos por categoria</h3>
              <Donut fatias={porCategoria} />
              <div style={{ marginTop: "1rem" }}><BarrasRank fatias={porCategoria} /></div>
            </section>
            <section className="glass card surgir">
              <h3>Por forma de pagamento</h3>
              <BarrasRank fatias={porForma} />
            </section>
          </div>
        </>
      )}

      <section className="glass card surgir secao">
        <h3>Categorias</h3>
        <p className="sub">Crie categorias para classificar seus gastos. Atribua nos gastos (aba Variáveis) ou no cadastro de transação.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0" }}>
          {categorias.length === 0 && <span className="sub">Nenhuma categoria ainda.</span>}
          {categorias.map((c) => (
            <span key={c.id} className="chip" style={{ gap: "0.5rem" }}>
              <input type="color" value={c.cor ?? "#60a5fa"} onChange={(e) => mudarCor(c.id, e.target.value)}
                aria-label={`Cor de ${c.nome}`} style={{ width: 20, height: 20, padding: 0, border: "none", background: "none", borderRadius: 6 }} />
              {c.nome}
              <span className="pct" style={{ marginLeft: 0 }}>({c.tipo})</span>
              <button className="anexo-remover" onClick={() => desativar(c.id)} aria-label={`Desativar ${c.nome}`}>×</button>
            </span>
          ))}
        </div>
        <form onSubmit={criarCategoria} className="linha-form">
          <input placeholder="Nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} style={{ flex: "1 1 160px" }} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="variavel">Variável</option>
            <option value="fixa">Fixa</option>
            <option value="entrada">Entrada</option>
          </select>
          <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} aria-label="Cor" style={{ width: 44, padding: 4 }} />
          <button className="btn btn-primario" type="submit">Adicionar</button>
        </form>
      </section>
    </>
  );
}
