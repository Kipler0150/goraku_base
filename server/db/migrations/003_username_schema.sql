ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE users
SET username = 'user_' || substring(replace(id::text, '-', '') FROM 1 FOR 12)
WHERE username IS NULL;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_username_is_normalized'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_username_is_normalized CHECK (
        username = lower(username)
        AND username = btrim(username)
        AND char_length(username) BETWEEN 3 AND 32
        AND username ~ '^[a-z0-9_]+$'
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_username_unique'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_username_unique UNIQUE (username);
  END IF;
END
$$;
