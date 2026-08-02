-- Sessões abertas: uma linha por refresh token vigente.
--
-- Antes isto era um blob JSON num único campo de config, lido e reescrito a cada
-- rotação: dois refreshes concorrentes (web + iPhone + macOS) perdiam a escrita
-- um do outro, e o jti sumido era lido como reuso de token vazado — o que revoga
-- todas as sessões. Uma linha por token torna cada operação uma instrução atômica.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti       TEXT PRIMARY KEY,
  expira_em INTEGER NOT NULL,
  -- 1 = vigente. 0 = encerrado pelo teto de sessões simultâneas; o dono só
  -- precisa entrar de novo. Já um jti AUSENTE da tabela é token rotacionado
  -- reaparecendo = reuso, e aí sim a família inteira é revogada.
  vigente   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expira ON refresh_tokens(expira_em);

-- Tokens emitidos antes desta migração têm jti que não existe na tabela nova, e
-- cairiam no caminho de "reuso de token vazado" — alarme falso logo após o deploy.
-- Subir a versão os invalida pela via honesta (o /refresh confere 'ver' antes do
-- jti): o dono só faz login de novo, sem susto no log.
INSERT INTO config (chave, valor) VALUES ('refresh_version', '1')
  ON CONFLICT(chave) DO UPDATE SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT);

-- O blob JSON que a tabela substitui.
DELETE FROM config WHERE chave IN ('refresh_jtis', 'totp_usado');
