CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_is_normalized CHECK (email = lower(email) AND email = btrim(email) AND length(email) > 0)
);

CREATE TABLE local_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_identities_provider_not_blank CHECK (length(btrim(provider)) > 0),
  CONSTRAINT auth_identities_subject_not_blank CHECK (length(btrim(provider_subject)) > 0),
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE TABLE library_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  library_status TEXT NOT NULL DEFAULT 'PLANNING',
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT library_items_provider_type_valid CHECK (
    (provider IN ('anilist', 'myanimelist') AND type = 'ANIME')
    OR (provider = 'tmdb' AND type IN ('MOVIE', 'TV'))
    OR (provider IN ('thegamesdb', 'rawg') AND type = 'GAME')
  ),
  CONSTRAINT library_items_provider_id_valid CHECK (
    provider_id = btrim(provider_id) AND length(provider_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT library_items_status_valid CHECK (
    library_status IN ('PLANNING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'DROPPED')
  ),
  CONSTRAINT library_items_user_identity_unique UNIQUE (user_id, provider, type, provider_id)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_active_lookup_idx ON sessions (token_hash, expires_at, revoked_at);
CREATE INDEX library_items_user_created_idx ON library_items (user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER local_credentials_set_updated_at
BEFORE UPDATE ON local_credentials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER auth_identities_set_updated_at
BEFORE UPDATE ON auth_identities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER library_items_set_updated_at
BEFORE UPDATE ON library_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
