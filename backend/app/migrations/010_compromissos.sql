-- Compromissos financeiros: obrigação PONTUAL, com valor total e prazo, que se
-- acompanha até quitar (IPVA, IPTU, acordo de dívida, dinheiro pego emprestado).
--
-- O que já existia não cobria isso: conta fixa recorre todo mês e não tem total
-- nem fim; parcelamento é compra no cartão já dividida, sem credor; meta é o
-- oposto — juntar dinheiro PARA algo, não dever algo. Sem esta tabela, um IPVA
-- virava conta fixa falsa ou um variável com data futura, e em nenhum dos dois
-- o app sabia quanto ainda falta quitar.
CREATE TABLE compromissos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  credor TEXT,                          -- quem ou o quê: 'João', 'Banco X', 'IPVA do carro'
  categoria_id INTEGER REFERENCES categorias(id),   -- tipo 'variavel': onde o pagamento cai no orçamento
  valor_total_cents INTEGER NOT NULL CHECK (valor_total_cents > 0),
  data_limite TEXT NOT NULL,            -- YYYY-MM-DD
  forma_pagamento TEXT CHECK (forma_pagamento IN ('pix', 'credito', 'debito', 'dinheiro', 'boleto')),
  orientacao_texto TEXT,                -- texto da IA (espelho de metas.estrategia_texto)
  lembrete_dias_antes INTEGER NOT NULL DEFAULT 3,
  -- Arquivar sem apagar histórico (espelho de metas.ativa). É também a saída para
  -- "quitei com desconto": não há coluna de quitação manual, porque quitado é
  -- derivado (pago >= total), como todo status de pagamento neste schema.
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- O pagamento de um compromisso NÃO tem tabela própria: é um lancamentos_variaveis
-- comum, apontando para cá — a mesma jogada de parcelamento_id (008). Assim o
-- dashboard, as análises, os orçamentos, a busca e a exportação enxergam o
-- pagamento sem código novo, e duplicidade fica impossível por construção: existe
-- um registro só, não um espelho para conciliar.
ALTER TABLE lancamentos_variaveis ADD COLUMN compromisso_id INTEGER REFERENCES compromissos(id);
CREATE INDEX idx_lanc_variaveis_compromisso ON lancamentos_variaveis (compromisso_id);
CREATE INDEX idx_compromissos_data_limite ON compromissos (data_limite);
