CREATE TABLE library_item_episodes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  library_item_id UUID NOT NULL,
  season_number INTEGER NOT NULL CHECK (season_number >= 1),
  episode_number INTEGER NOT NULL CHECK (episode_number >= 1),
  watched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT library_item_episodes_pkey PRIMARY KEY (user_id, library_item_id, season_number, episode_number),
  CONSTRAINT library_item_episodes_library_item_fkey
    FOREIGN KEY (user_id, library_item_id)
    REFERENCES library_items (user_id, id)
    ON DELETE CASCADE
);

CREATE INDEX library_item_episodes_lookup_idx
  ON library_item_episodes (user_id, library_item_id, season_number, episode_number);
