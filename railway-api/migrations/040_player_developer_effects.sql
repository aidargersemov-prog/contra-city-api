CREATE TABLE IF NOT EXISTS player_developer_effects (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  spawn_effect SMALLINT NOT NULL DEFAULT 0 CHECK (spawn_effect BETWEEN 0 AND 8),
  death_effect SMALLINT NOT NULL DEFAULT 0 CHECK (death_effect BETWEEN 0 AND 8),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
