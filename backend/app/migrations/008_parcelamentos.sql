-- Compras parceladas (cartão em N×): o grupo vive aqui; cada parcela é um
-- lancamentos_variaveis normal (com data no mês dela), então dashboard,
-- análises e exportações as enxergam sem código novo — inclusive nos meses
-- futuros, que é onde mora o comprometimento.
CREATE TABLE parcelamentos (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  valor_parcela_cents INTEGER NOT NULL CHECK (valor_parcela_cents > 0),
  parcelas INTEGER NOT NULL CHECK (parcelas BETWEEN 2 AND 72),
  primeira_data TEXT NOT NULL,                 -- YYYY-MM-DD da 1ª parcela
  forma_pagamento TEXT CHECK (forma_pagamento IN ('pix', 'credito', 'debito', 'dinheiro', 'boleto')),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE lancamentos_variaveis ADD COLUMN parcelamento_id INTEGER REFERENCES parcelamentos(id);
ALTER TABLE lancamentos_variaveis ADD COLUMN parcela_num INTEGER;
