-- Janela de graça na rotação de refresh token.
--
-- Antes, rotacionar APAGAVA o jti antigo, e um jti ausente era lido como reuso de
-- token vazado — o que revoga a família inteira (`DELETE FROM refresh_tokens`).
-- Isso transformava uma corrida rotineira em logout de todos os aparelhos:
-- uma tela com `Promise.all` (Dashboard, Análises) dispara N chamadas; passados
-- os 30 min do access token, as N voltam 401 juntas e viram N `/refresh` com o
-- MESMO token. A primeira rotaciona; as demais chegam com o token já gasto.
--
-- Reproduzido com 6 chamadas simultâneas: a tabela ia de 3 sessões a 0, e um
-- aparelho que não tinha feito nada recebia "Refresh token revogado".
--
-- Agora a rotação MARCA o jti antigo em vez de apagá-lo, guardando quem o
-- sucedeu. Reapresentado dentro da janela, ele devolve o mesmo sucessor (a
-- resposta vira idempotente) em vez de acusar vazamento. Passada a janela, a
-- linha é purgada e o jti volta a ser "desconhecido" — a detecção de vazamento
-- segue intacta, que é o motivo de a janela ser curta.
ALTER TABLE refresh_tokens ADD COLUMN sucessor_jti TEXT;
ALTER TABLE refresh_tokens ADD COLUMN rotacionado_em INTEGER;  -- epoch; NULL = não rotacionado

-- O estado 'rotacionado' é consultado a cada /refresh dentro da janela.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_rotacionado ON refresh_tokens(rotacionado_em);
