-- Categorias padrão: sem elas a categorização automática por IA não tem de onde
-- escolher (a lista vazia chega ao modelo e a coluna fica sempre "—").
-- INSERT OR IGNORE respeita o UNIQUE(nome, tipo): quem já criou/renomeou não é tocado.

-- Gastos variáveis
INSERT OR IGNORE INTO categorias (nome, tipo, cor) VALUES
  ('Alimentação',  'variavel', '#f59e0b'),
  ('Mercado',      'variavel', '#84cc16'),
  ('Transporte',   'variavel', '#3b82f6'),
  ('Saúde',        'variavel', '#ef4444'),
  ('Farmácia',     'variavel', '#f43f5e'),
  ('Pet',          'variavel', '#a855f7'),
  ('Assinaturas',  'variavel', '#06b6d4'),
  ('Lazer',        'variavel', '#ec4899'),
  ('Casa',         'variavel', '#8b5cf6'),
  ('Vestuário',    'variavel', '#14b8a6'),
  ('Educação',     'variavel', '#6366f1'),
  ('Outros',       'variavel', '#94a3b8');

-- Contas fixas
INSERT OR IGNORE INTO categorias (nome, tipo, cor) VALUES
  ('Moradia',        'fixa', '#8b5cf6'),
  ('Contas de casa', 'fixa', '#0ea5e9'),
  ('Assinaturas',    'fixa', '#06b6d4'),
  ('Saúde',          'fixa', '#ef4444'),
  ('Educação',       'fixa', '#6366f1');

-- Entradas
INSERT OR IGNORE INTO categorias (nome, tipo, cor) VALUES
  ('Salário',     'entrada', '#22c55e'),
  ('Rendimentos', 'entrada', '#10b981'),
  ('Outros',      'entrada', '#94a3b8');
