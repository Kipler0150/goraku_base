ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_tokens_purpose_valid CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
  CONSTRAINT auth_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_tokens_active_lookup_idx
  ON auth_tokens (purpose, token_hash, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX auth_tokens_user_purpose_idx
  ON auth_tokens (user_id, purpose, created_at DESC);
