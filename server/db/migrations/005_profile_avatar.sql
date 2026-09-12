ALTER TABLE users
  ADD COLUMN avatar_data BYTEA,
  ADD COLUMN avatar_content_type TEXT,
  ADD COLUMN avatar_updated_at TIMESTAMPTZ;

ALTER TABLE users
  ADD CONSTRAINT users_avatar_fields_consistent CHECK (
    (avatar_data IS NULL AND avatar_content_type IS NULL AND avatar_updated_at IS NULL)
    OR (
      avatar_data IS NOT NULL
      AND avatar_content_type = 'image/webp'
      AND avatar_updated_at IS NOT NULL
    )
  );
