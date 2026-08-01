-- Sub-itens de planejamento de uma meta (ex.: Viagem → passagens, hospedagem…).
CREATE TABLE IF NOT EXISTS metas_itens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id       INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  valor_cents   INTEGER NOT NULL DEFAULT 0,
  descricao     TEXT,                -- opções e planejamento em texto livre
  criado_em     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_metas_itens_meta ON metas_itens(meta_id);
