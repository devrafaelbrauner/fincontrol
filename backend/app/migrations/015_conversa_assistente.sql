-- Memória do assistente: a conversa deixa de viver só no estado do React.
--
-- Antes, `falas` existia apenas em memória do navegador. Recarregar a página,
-- trocar de aba ou abrir no celular começava do zero, e — mais importante — o
-- modelo recebia cada pergunta ISOLADA: não havia como perguntar "e no mês
-- passado?", porque a pergunta anterior não existia para ele.
--
-- Fica no servidor, e não no localStorage, pelo mesmo motivo que o resto do
-- app: é o servidor que é a fonte de verdade, e assim a conversa é a mesma no
-- web, no macOS e no Android.
--
-- Uma thread só. O app é single-user e o assistente responde sobre "as suas
-- finanças" — não há assunto paralelo que justifique várias conversas, e
-- inventar isso agora seria estrutura sem demanda.
CREATE TABLE conversa_mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'user' | 'assistant': os mesmos nomes que a API do modelo usa, para não
  -- precisar traduzir na hora de montar a chamada.
  papel TEXT NOT NULL CHECK (papel IN ('user', 'assistant')),
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A leitura é sempre "as últimas N, em ordem", tanto para montar a chamada
-- quanto para desenhar a tela.
CREATE INDEX idx_conversa_id ON conversa_mensagens (id DESC);
