-- Cache dos insights de IA por competência (evita recomputar/re-cobrar a cada abertura).
CREATE TABLE insights_cache (
  competencia TEXT PRIMARY KEY,          -- 'YYYY-MM'
  dados_json TEXT NOT NULL,              -- {destaques[], alertas[], sugestao}
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
