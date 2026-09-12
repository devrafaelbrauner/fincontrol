-- Contador de versão por linha nas demais tabelas mutáveis, para If-Match.
--
-- A migration 013 deu `versao` a compromissos, contas_fixas e contas_bancarias.
-- Sem ela no resto, o sync offline não teria como reconciliar: um PATCH que
-- chegasse depois de outro aparelho ter editado a mesma linha sobrescreveria em
-- silêncio. E é sempre um contador, nunca `atualizado_em` — CURRENT_TIMESTAMP
-- tem resolução de um segundo, e duas edições no mesmo segundo passariam ambas.
--
-- `parcelamentos` entra junto do lançamento que ele cria em massa: recategorizar
-- ou excluir um parcelado é uma edição da mesma "compra", e sem versão própria o
-- último a salvar venceria sem aviso, igual aos outros casos aqui.
ALTER TABLE lancamentos_variaveis ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lancamentos_fixos     ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE entradas              ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE metas                 ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE metas_itens           ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE metas_aportes         ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categorias            ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orcamentos            ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;
ALTER TABLE parcelamentos         ADD COLUMN versao INTEGER NOT NULL DEFAULT 1;