-- Compromisso passa a exigir só o nome: valor total e prazo viram opcionais.
--
-- O motivo é o uso real: você lembra que deve algo antes de saber quanto ou até
-- quando. Obrigar os três campos empurrava a pessoa a inventar um valor e uma
-- data para conseguir registrar — e número chutado num app de dinheiro contamina
-- tudo que soma depois (dashboard, orçamento, plano de quitação).
--
-- SQLite não tem ALTER COLUMN: tirar NOT NULL exige reconstruir a tabela. Este é
-- o procedimento documentado pelo próprio SQLite ("Making Other Kinds Of Table
-- Schema Changes"), e a ordem importa:
--
--   PRAGMA foreign_keys=OFF antes do DROP. Duas razões, as duas mordem:
--   1. `lancamentos_variaveis.compromisso_id` referencia esta tabela. Com as FKs
--      ligadas, o DROP levaria junto os pagamentos já registrados.
--   2. Com FKs ligadas, `ALTER TABLE ... RENAME` reescreve as cláusulas
--      REFERENCES das OUTRAS tabelas para o nome novo — lancamentos_variaveis
--      passaria a apontar para "compromissos_novo", um nome que deixa de existir
--      na linha seguinte. Desligadas, o REFERENCES continua em "compromissos",
--      que é exatamente o que a tabela reconstruída volta a se chamar.
--
-- O CHECK de valor > 0 fica, mas só morde quando há valor: em SQL, `NULL > 0` é
-- NULL, e CHECK só reprova em FALSE. Ou seja, ausente é aceito e zero/negativo
-- continua recusado — que é a regra que se quer.
PRAGMA foreign_keys=OFF;

CREATE TABLE compromissos_novo (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  credor TEXT,
  categoria_id INTEGER REFERENCES categorias(id),
  valor_total_cents INTEGER CHECK (valor_total_cents > 0),   -- opcional: ainda não sei quanto
  data_limite TEXT,                                          -- opcional: ainda não sei quando
  forma_pagamento TEXT CHECK (forma_pagamento IN ('pix', 'credito', 'debito', 'dinheiro', 'boleto')),
  orientacao_texto TEXT,
  lembrete_dias_antes INTEGER NOT NULL DEFAULT 3,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  versao INTEGER NOT NULL DEFAULT 1
);

INSERT INTO compromissos_novo
  (id, nome, credor, categoria_id, valor_total_cents, data_limite, forma_pagamento,
   orientacao_texto, lembrete_dias_antes, ativo, criado_em, atualizado_em, versao)
SELECT
   id, nome, credor, categoria_id, valor_total_cents, data_limite, forma_pagamento,
   orientacao_texto, lembrete_dias_antes, ativo, criado_em, atualizado_em, versao
FROM compromissos;

DROP TABLE compromissos;
ALTER TABLE compromissos_novo RENAME TO compromissos;

CREATE INDEX IF NOT EXISTS idx_compromissos_data_limite ON compromissos (data_limite);

PRAGMA foreign_keys=ON;
