-- Contador de versão por linha, para edição condicional (If-Match).
--
-- A primeira tentativa usou `atualizado_em` como versão — ela já é carimbada em
-- toda escrita. Não serve: CURRENT_TIMESTAMP do SQLite tem resolução de UM
-- SEGUNDO, então duas edições no mesmo segundo carregam a mesma "versão" e o
-- segundo aparelho sobrescreveria o primeiro sem que nada detectasse. Foi um
-- teste que revelou isso, não o raciocínio.
--
-- Um contador não tem esse problema: cada UPDATE incrementa, e duas escritas
-- nunca compartilham valor por mais rápidas que sejam.
ALTER TABLE compromissos       ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contas_fixas       ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contas_bancarias   ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
