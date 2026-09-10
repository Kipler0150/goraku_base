ALTER TABLE library_items
  ADD COLUMN personal_rating NUMERIC,
  ADD COLUMN note TEXT,
  ADD COLUMN progress JSONB,
  ADD CONSTRAINT library_items_personal_rating_valid CHECK (
    personal_rating IS NULL
    OR (
      personal_rating BETWEEN 0 AND 10
      AND personal_rating * 2 = trunc(personal_rating * 2)
    )
  ),
  ADD CONSTRAINT library_items_note_valid CHECK (
    note IS NULL OR char_length(note) <= 5000
  ),
  ADD CONSTRAINT library_items_progress_object_valid CHECK (
    progress IS NULL OR jsonb_typeof(progress) = 'object'
  ),
  ADD CONSTRAINT library_items_user_id_id_unique UNIQUE (user_id, id);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (lower(name)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tags_name_valid CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 50
  ),
  CONSTRAINT tags_user_normalized_name_unique UNIQUE (user_id, normalized_name),
  CONSTRAINT tags_user_id_id_unique UNIQUE (user_id, id)
);

CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (lower(name)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT collections_name_valid CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 50
  ),
  CONSTRAINT collections_user_normalized_name_unique UNIQUE (user_id, normalized_name),
  CONSTRAINT collections_user_id_id_unique UNIQUE (user_id, id)
);

CREATE TABLE library_item_tags (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  CONSTRAINT library_item_tags_pkey PRIMARY KEY (user_id, library_item_id, tag_id),
  CONSTRAINT library_item_tags_library_item_fkey
    FOREIGN KEY (user_id, library_item_id)
    REFERENCES library_items (user_id, id)
    ON DELETE CASCADE,
  CONSTRAINT library_item_tags_tag_fkey
    FOREIGN KEY (user_id, tag_id)
    REFERENCES tags (user_id, id)
    ON DELETE CASCADE
);

CREATE TABLE library_item_collections (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL,
  collection_id UUID NOT NULL,
  CONSTRAINT library_item_collections_pkey PRIMARY KEY (user_id, library_item_id, collection_id),
  CONSTRAINT library_item_collections_library_item_fkey
    FOREIGN KEY (user_id, library_item_id)
    REFERENCES library_items (user_id, id)
    ON DELETE CASCADE,
  CONSTRAINT library_item_collections_collection_fkey
    FOREIGN KEY (user_id, collection_id)
    REFERENCES collections (user_id, id)
    ON DELETE CASCADE
);

CREATE INDEX library_item_tags_tag_lookup_idx
  ON library_item_tags (user_id, tag_id, library_item_id);

CREATE INDEX library_item_collections_collection_lookup_idx
  ON library_item_collections (user_id, collection_id, library_item_id);

CREATE TRIGGER tags_set_updated_at
BEFORE UPDATE ON tags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER collections_set_updated_at
BEFORE UPDATE ON collections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
