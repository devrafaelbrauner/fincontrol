-- Valores monetários sempre em centavos (INTEGER). Datas em ISO (YYYY-MM-DD),
-- competência em 'YYYY-MM'. Status de pagamento é derivado de data_pagamento,
-- nunca armazenado.

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('fixa', 'variavel', 'entrada')),
  cor TEXT,
  ativa INTEGER NOT NULL DEFAULT 1,
  UNIQUE (nome, tipo)
);

CREATE TABLE anexos (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('pdf', 'imagem')),
  caminho_arquivo TEXT NOT NULL,          -- nome em disco = sha256 do conteúdo
  nome_original TEXT NOT NULL,
  tamanho_bytes INTEGER NOT NULL,
  data_upload TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  extraido_por_ia INTEGER NOT NULL DEFAULT 0,
  dados_extraidos_json TEXT
);

CREATE TABLE contas_fixas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  valor_estimado_cents INTEGER NOT NULL CHECK (valor_estimado_cents >= 0),
  ativa INTEGER NOT NULL DEFAULT 1,
  lembrete_dias_antes INTEGER NOT NULL DEFAULT 3,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lancamentos_fixos (
  id INTEGER PRIMARY KEY,
  conta_fixa_id INTEGER NOT NULL REFERENCES contas_fixas(id),
  competencia TEXT NOT NULL,
  valor_cents INTEGER NOT NULL CHECK (valor_cents >= 0),
  data_pagamento TEXT,                     -- NULL = não pago
  anexo_id INTEGER REFERENCES anexos(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (conta_fixa_id, competencia)
);

CREATE TABLE lancamentos_variaveis (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  valor_cents INTEGER NOT NULL CHECK (valor_cents >= 0),
  data TEXT NOT NULL,
  forma_pagamento TEXT CHECK (forma_pagamento IN ('pix', 'credito', 'debito', 'dinheiro', 'boleto')),
  anexo_id INTEGER REFERENCES anexos(id),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE entradas (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  valor_cents INTEGER NOT NULL CHECK (valor_cents >= 0),
  data TEXT NOT NULL,
  recorrente INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE metas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  valor_total_cents INTEGER NOT NULL CHECK (valor_total_cents > 0),
  prazo TEXT NOT NULL,                     -- YYYY-MM-DD
  estrategia_texto TEXT,
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE metas_aportes (
  id INTEGER PRIMARY KEY,
  meta_id INTEGER NOT NULL REFERENCES metas(id),
  valor_cents INTEGER NOT NULL CHECK (valor_cents > 0),
  data TEXT NOT NULL,
  observacao TEXT
);

CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX idx_lanc_fixos_competencia ON lancamentos_fixos (competencia);
CREATE INDEX idx_lanc_variaveis_data ON lancamentos_variaveis (data);
CREATE INDEX idx_entradas_data ON entradas (data);
