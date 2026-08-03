-- Log de lembretes já enviados: é o que impede o job diário de repetir o mesmo
-- aviso a cada execução (ou a cada restart do backend, que roda um catch-up).
-- chave = identidade do aviso, ex.:
--   'fixo:12:2026-08:antes' | 'fixo:12:2026-08:hoje' | 'fixo:12:2026-08:atraso'
--   'resumo:2026-07'
CREATE TABLE lembretes_enviados (
  chave TEXT PRIMARY KEY,
  enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
