# Plano de Desenvolvimento — FinControl (v2, refinado)

App pessoal de finanças (single-user) — contas fixas, variáveis, entradas, metas, anexos, IA — rodando em web, Windows, macOS, iOS, Android e iPadOS a partir de uma única base de código.

*Refinado em 24/07/2026 a partir do plano v1. Mudanças principais: decisões fechadas (sem opções em aberto), correções técnicas no modelo de dados e nos jobs, segurança detalhada, roadmap com critérios de verificação por fase.*

---

## 1. Decisões fechadas (antes eram "opções")

| Decisão | Escolha | Justificativa |
|---|---|---|
| Frontend | **React + TypeScript + Vite, como PWA** | Cobre as 6 plataformas sem empacotamento nativo; alinhado ao seu roadmap de estudo; Tauri/Capacitor ficam para a Fase 4 *somente se* a PWA se provar insuficiente no uso real |
| Backend | **FastAPI + SQLite** | Mesma stack do Mapa HAPFOR, zero curva nova |
| Hospedagem | **VPS Hetzner** (a mesma que já roda o relay do Notion, ou uma CX22 dedicada ~€4/mês) com Caddy ou Nginx + HTTPS | Evita depender do túnel via rede do hospital, que é instável — este app será acessado de qualquer lugar, o tempo todo |
| Calendário | **Feed `.ics` assinável (`webcal://`)** servido pelo backend | Uma implementação cobre Apple Calendar e Google Calendar; a API OAuth do Google fica descartada (complexidade sem ganho real para 1 usuário) |
| IA | **OpenRouter como caminho único no MVP** | Uma chave, múltiplos modelos (inclusive multimodais para ler PDF/foto). Suporte a chaves diretas (Anthropic/OpenAI/xAI) só se um dia fizer falta — não construir agora |
| Local do projeto | `~/projects/fincontrol/` (monorepo: `backend/` + `frontend/`) | Ao lado dos seus outros projetos |

**Nota sobre OAuth com assinatura Claude/ChatGPT:** confirmado — não existe fluxo público de "login com sua conta de assinatura" para uso de API por apps de terceiros (jul/2026). Removido do plano; acesso programático é só via chave de API paga por uso, e o OpenRouter resolve isso melhor.

---

## 2. Arquitetura

```
┌─────────────────────────────────────────────┐
│  PWA React+TS (Vite)                        │
│  instalável em iOS/Android/desktop          │
│  service worker: cache de shell + fallback  │
└──────────────────┬──────────────────────────┘
                   │ HTTPS (JSON + upload multipart)
┌──────────────────▼──────────────────────────┐
│  VPS Hetzner                                │
│  Caddy (HTTPS automático) → FastAPI         │
│  ├── SQLite (WAL mode)                      │
│  ├── uploads/  (anexos em disco)            │
│  ├── feed .ics dinâmico (webcal)            │
│  └── chamadas OpenRouter (só o backend)     │
└─────────────────────────────────────────────┘
```

**Limitações de PWA que o design já absorve (importante para iOS):**
- Push notification em iOS só funciona com a PWA **instalada na tela inicial** (iOS ≥ 16.4). Os lembretes principais vêm do **calendário assinado** (nativo, confiável), não de push — push é bônus da Fase 4.
- Safari pode expurgar storage local de sites pouco usados → **o servidor é a fonte de verdade sempre**; a PWA guarda no máximo cache de interface. Nenhum dado financeiro vive só no cliente.
- Câmera no mobile: `<input type="file" accept="image/*" capture="environment">` — funciona em PWA sem nenhum plugin.

---

## 3. Modelo de dados (refinado)

Mudanças vs. v1: valores em **centavos (INTEGER)** — nunca float para dinheiro; `categorias` vira tabela própria compartilhada; status de pagamento **calculado, não armazenado** (só `data_pagamento` é gravada); timestamps de auditoria em tudo; anexo vinculado por FK direta no lançamento (mais simples que vínculo polimórfico).

```
categorias
├── id, nome, tipo (fixa | variavel | entrada), cor, ativa

contas_fixas
├── id, nome, categoria_id
├── dia_vencimento          -- 1..31; se 31 num mês de 30, vence no último dia
├── valor_estimado_cents
├── ativa                   -- pausar sem apagar histórico
├── lembrete_dias_antes
└── criado_em, atualizado_em

lancamentos_fixos           -- 1 linha por conta_fixa × competência
├── id, conta_fixa_id
├── competencia             -- 'YYYY-MM', UNIQUE(conta_fixa_id, competencia)
├── valor_cents             -- herda o estimado, editável
├── data_pagamento          -- NULL = não pago; status é derivado:
│                           --   pago | pendente | atrasado (hoje > vencimento)
├── anexo_id
└── criado_em, atualizado_em

lancamentos_variaveis
├── id, descricao, categoria_id, valor_cents, data
├── forma_pagamento         -- pix | credito | debito | dinheiro | boleto
├── anexo_id
└── criado_em, atualizado_em

entradas
├── id, descricao, categoria_id, valor_cents, data, recorrente
└── criado_em, atualizado_em

metas
├── id, nome, valor_total_cents, prazo, estrategia_texto
├── ativa
└── criado_em, atualizado_em
    -- valor_atual = SUM(aportes); valor_mensal_necessario =
    --   (valor_total - valor_atual) / meses_restantes  → calculados, não gravados

metas_aportes
├── id, meta_id, valor_cents, data, observacao

anexos
├── id, tipo (pdf | imagem), caminho_arquivo   -- nome em disco = hash sha256
├── nome_original, tamanho_bytes, data_upload
├── extraido_por_ia, dados_extraidos_json      -- {valor, vencimento, fornecedor}

config                       -- chave/valor; inclui:
├── openrouter_api_key_enc   -- criptografada (Fernet), nunca em claro
├── modelo_preferido
└── ics_feed_token           -- token secreto da URL do calendário
```

**Geração de lançamentos mensais — sem cron:** em vez de job mensal (frágil: e se a VPS estiver reiniciando na virada?), o backend gera os lançamentos da competência **on-access**: ao consultar um mês, cria as linhas que faltam para as contas fixas ativas (idempotente via UNIQUE). Um job diário leve (APScheduler dentro do próprio FastAPI) roda como reforço para o feed de calendário enxergar meses futuros. Timezone fixa: `America/Sao_Paulo`.

---

## 4. Funcionalidades por aba

*(iguais à v1 no escopo; abaixo só o que mudou ou ganhou detalhe)*

- **Contas fixas** — lista + visão calendário do mês; status derivado em tempo real; pausar conta preserva histórico.
- **Contas variáveis** — input manual rápido (o formulário deve abrir já no campo valor — é a tela mais usada); filtros por período/categoria com totalizadores.
- **Entradas** — CRUD; alimenta o saldo do mês: `entradas − fixas − variáveis`.
- **Metas** — aportes com histórico, barra de progresso, valor mensal necessário calculado; sugestão de estratégia via IA usa os gastos variáveis reais dos últimos 3 meses como contexto.
- **Calendário** — o backend expõe `GET /calendar/{token}.ics` com eventos de vencimento (com `VALARM` de lembrete) e prazos de meta. Você assina a URL uma vez no iPhone/Mac (`webcal://`) e no Google Calendar ("adicionar por URL"). O token é secreto e regenerável — a URL é uma *capability URL* que expõe seus dados financeiros, tratar como senha.
- **Anexos** — upload (câmera no mobile / arquivo no desktop), validação de MIME e limite (ex. 15 MB), visualização inline; nome em disco por hash (evita colisão e path traversal).
- **IA (via OpenRouter, só no backend)**
  1. Extração de PDF/foto → preenche formulário (modelo multimodal, ex. Claude via OpenRouter); usuário sempre revisa antes de salvar.
  2. Categorização automática pela descrição.
  3. Insights mensais comparando com meses anteriores.
  4. Estratégias de meta baseadas nos gastos reais.

---

## 5. Segurança

- **HTTPS obrigatório** (Caddy resolve com Let's Encrypt automático).
- **Auth:** senha forte (hash argon2/bcrypt) + **TOTP 2FA** (pyotp + app autenticador) — o app fica exposto na internet. Sessão via JWT curto + refresh token httpOnly. Rate limiting no login (slowapi).
  - *Alternativa mais simples que vale considerar:* colocar o serviço atrás de **Tailscale** (VPN) — aí nem fica exposto publicamente e o 2FA vira opcional. Contra: o feed `.ics` precisa ser público para o Google Calendar assinar, então no mínimo essa rota fica fora da VPN.
- **Chave OpenRouter:** criptografada com Fernet; a master key vive em variável de ambiente na VPS (fora do repo e do banco). Depois de salva, nunca retorna ao frontend (só "•••• configurada").
- **Backup:** `sqlite3 banco.db ".backup"` diário + cópia para fora da VPS (Backblaze B2 via rclone, ou o mesmo esquema dos seus backups offsite existentes). Anexos (`uploads/`) entram no mesmo rclone. **Testar restauração uma vez por trimestre.**
- SQLite em **WAL mode** (leituras concorrentes + backup seguro).

---

## 6. Roadmap (com critério de "pronto" por fase)

### Fase 0 — Fundação (1–2 semanas)
Esqueleto `backend/` (FastAPI, SQLite, migrations com Alembic ou script SQL versionado) + `frontend/` (Vite + React + TS, roteamento, layout base). Auth com senha + TOTP.
✅ *Pronto quando:* login funciona via HTTPS na VPS e o deploy é um script de um comando.

### Fase 1 — MVP (3–5 semanas)
Contas fixas + lançamentos on-access, variáveis, entradas, dashboard (saldo do mês, próximos vencimentos). Manifest + service worker → instalável como PWA.
✅ *Pronto quando:* você registra sua vida financeira real de um mês inteiro só pelo app, no celular e no desktop.

### Fase 2 — Metas e anexos (2–3 semanas)
Metas + aportes + progresso; upload/visualização de PDF e foto.
✅ *Pronto quando:* uma conta paga tem o comprovante anexado e visível no iPhone.

### Fase 3 — Calendário e IA (2–3 semanas)
Feed `.ics` com token; config OpenRouter; extração de dados de anexo → pré-preenche formulário; categorização automática.
✅ *Pronto quando:* um vencimento novo aparece sozinho no Apple Calendar e no Google Calendar, e uma foto de boleto vira lançamento com um toque de confirmação.

### Fase 4 — Polimento (contínuo, só se necessário)
Push notifications (PWA instalada), insights mensais de IA, e **somente se a PWA decepcionar**: Tauri (desktop) / Capacitor (mobile).

---

## 7. Próximos passos imediatos

1. ~~Confirmar stack~~ → **fechada: React+TS+Vite PWA / FastAPI+SQLite / VPS Hetzner.**
2. Gerar o esqueleto do projeto em `~/projects/fincontrol/` (Fase 0) — próximo passo executável.
3. Provisionar/reaproveitar a VPS e apontar um subdomínio.
