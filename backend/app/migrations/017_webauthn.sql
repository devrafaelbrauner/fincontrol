-- Passkeys (WebAuthn): credenciais por aparelho, sem senha.
--
-- Uma linha por credencial registrada: o `credential_id` identifica a chave no
-- autenticador, `public_key` verifica as assinaturas e `sign_count` denuncia
-- clonagem (contador que voltou para trás = mesma chave em dois lugares).
-- `transports` (usb/nfc/ble/internal/hybrid) diz ao navegador quais caminhos
-- oferecer no login; `aaguid`/`nome` são só leitura humana (qual aparelho é).
--
-- Desafios pendentes moram em `webauthn_desafios`, não na memória do processo:
-- o backend roda atrás de um só uvicorn hoje, mas nada garante que continue
-- assim — e desafio em memória some no restart entre o begin e o finish.
-- Cada desafio expira em 5 minutos; a purga acontece na emissão.
CREATE TABLE IF NOT EXISTS webauthn_credenciais (
  id            TEXT PRIMARY KEY,      -- credential_id em base64url
  public_key    BLOB NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                  -- JSON: ["internal","hybrid"]
  aaguid        TEXT,
  nome          TEXT,                  -- "iPhone do Rafael", dado no registro
  criado_em     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso_em TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_desafios (
  id          TEXT PRIMARY KEY,        -- token opaco do fluxo (não o challenge)
  tipo        TEXT NOT NULL CHECK (tipo IN ('register', 'login')),
  challenge   BLOB NOT NULL,
  criado_em   INTEGER NOT NULL,        -- epoch, para a expiração de 5 min
  credential_id TEXT                   -- login: qual credencial (descoberta); register: NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_desafios_criado ON webauthn_desafios(criado_em);
