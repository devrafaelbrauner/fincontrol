-- Otimização de Recursos: onde o dinheiro ESTÁ, e não por onde ele passou.
--
-- Todo o resto do app rastreia FLUXO (entradas, gastos, o "saldo do mês" que é
-- entradas − fixas − variáveis). Isto rastreia ESTOQUE: quanto há hoje em cada
-- conta, e como isso mudou. São eixos diferentes e deliberadamente
-- independentes — a variação de um saldo não vira lançamento, porque ela tanto
-- pode ser salário já lançado quanto transferência entre contas ou rendimento,
-- e adivinhar qual duplicaria o lançamento ou inventaria uma categoria.
CREATE TABLE contas_bancarias (
  id INTEGER PRIMARY KEY,
  banco TEXT NOT NULL,                 -- instituição: 'Nubank', 'Itaú'
  nome TEXT NOT NULL,                  -- identificação: 'Conta corrente', 'Reserva'
  ativa INTEGER NOT NULL DEFAULT 1,    -- arquivar sem perder histórico
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (banco, nome)
);

-- Uma linha por LEITURA de saldo. O valor atual da conta é a leitura mais
-- recente; o anterior é a penúltima; variação e variação percentual saem da
-- diferença entre as duas.
--
-- Nada disso é coluna de propósito: o schema já fixa que status é calculado e
-- não armazenado (ver 001_inicial), e guardar `valor_anterior`/`variacao`
-- criaria uma segunda fonte de verdade que diverge no instante em que uma
-- leitura errada for corrigida ou apagada.
CREATE TABLE saldos_conta (
  id INTEGER PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas_bancarias(id) ON DELETE CASCADE,
  -- SEM CHECK (>= 0), ao contrário de todo o resto do schema: cheque especial
  -- e conta no vermelho são saldos legítimos, e recusá-los obrigaria o dono a
  -- mentir o número que está lendo no banco.
  valor_cents INTEGER NOT NULL,
  registrado_em TEXT NOT NULL,         -- 'YYYY-MM-DD HH:MM:SS' no fuso do app
  observacao TEXT
);

-- A listagem sempre busca a leitura mais recente por conta.
CREATE INDEX idx_saldos_conta ON saldos_conta (conta_id, registrado_em DESC, id DESC);
