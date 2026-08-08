-- Devolve as categorias SEMEADAS à paleta validada.
--
-- A migration 004 gravou uma cor hex em cada uma das 20 categorias padrão.
-- Isso não era escolha de ninguém — era só um valor de semente —, mas o
-- frontend respeita `cor` antes de qualquer outra coisa, então essas cores
-- venciam a paleta categórica: trocar os tokens --chart-* não mudava nada do
-- que o usuário via, nem numa instalação nova.
--
-- Duas delas eram ativamente erradas: 'Saúde' (#ef4444) e 'Salário' (#22c55e)
-- são o vermelho e o verde que significam saída e entrada no resto do app,
-- exatamente a colisão que a paleta nova existe para impedir.
--
-- Com `cor` nula, a categoria cai no slot determinístico da paleta e passa a
-- acompanhar o tema (o claro tem degraus próprios, pensados para o papel).
--
-- O `AND cor = '<hex da semente>'` é o que separa semente de escolha: quem
-- tiver aberto o seletor antigo e definido uma cor não é tocado, porque o
-- valor dele não bate com o da semente. Renomear também protege, já que o
-- nome entra na condição.
UPDATE categorias SET cor = NULL WHERE
  (nome = 'Alimentação'   AND tipo = 'variavel' AND cor = '#f59e0b') OR
  (nome = 'Mercado'       AND tipo = 'variavel' AND cor = '#84cc16') OR
  (nome = 'Transporte'    AND tipo = 'variavel' AND cor = '#3b82f6') OR
  (nome = 'Saúde'         AND tipo = 'variavel' AND cor = '#ef4444') OR
  (nome = 'Farmácia'      AND tipo = 'variavel' AND cor = '#f43f5e') OR
  (nome = 'Pet'           AND tipo = 'variavel' AND cor = '#a855f7') OR
  (nome = 'Assinaturas'   AND tipo = 'variavel' AND cor = '#06b6d4') OR
  (nome = 'Lazer'         AND tipo = 'variavel' AND cor = '#ec4899') OR
  (nome = 'Casa'          AND tipo = 'variavel' AND cor = '#8b5cf6') OR
  (nome = 'Vestuário'     AND tipo = 'variavel' AND cor = '#14b8a6') OR
  (nome = 'Educação'      AND tipo = 'variavel' AND cor = '#6366f1') OR
  (nome = 'Outros'        AND tipo = 'variavel' AND cor = '#94a3b8') OR
  (nome = 'Moradia'        AND tipo = 'fixa' AND cor = '#8b5cf6') OR
  (nome = 'Contas de casa' AND tipo = 'fixa' AND cor = '#0ea5e9') OR
  (nome = 'Assinaturas'    AND tipo = 'fixa' AND cor = '#06b6d4') OR
  (nome = 'Saúde'          AND tipo = 'fixa' AND cor = '#ef4444') OR
  (nome = 'Educação'       AND tipo = 'fixa' AND cor = '#6366f1') OR
  (nome = 'Salário'     AND tipo = 'entrada' AND cor = '#22c55e') OR
  (nome = 'Rendimentos' AND tipo = 'entrada' AND cor = '#10b981') OR
  (nome = 'Outros'      AND tipo = 'entrada' AND cor = '#94a3b8');
