-- Orçamento mensal por categoria (só gastos variáveis: conta fixa é previsível
-- por natureza — "estourar o aluguel" não é um evento; mercado/lazer/farmácia é
-- onde limite muda comportamento). Um limite por categoria, válido todo mês.
CREATE TABLE orcamentos (
  categoria_id INTEGER PRIMARY KEY REFERENCES categorias(id),
  limite_cents INTEGER NOT NULL CHECK (limite_cents > 0),
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
