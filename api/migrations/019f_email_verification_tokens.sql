-- ============================================================
-- M-019f: email_verification_tokens — verificación de email por código
-- Creado en Fase 1 (autorizado por owner Ricardo el 2026-04-28).
-- Refleja el patrón de phone_verification_tokens pero para email.
-- Exp: 30 minutos (AUTH-04 contratos_api_v1).
-- ============================================================

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  email       VARCHAR(255) NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,          -- hash del código de 6 dígitos
  expires_at  TIMESTAMPTZ NOT NULL,            -- 30 minutos desde creación
  attempts    INT NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_evt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_evt_attempts CHECK (attempts >= 0 AND attempts <= 10)
);

CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_evt_email ON email_verification_tokens(email);
