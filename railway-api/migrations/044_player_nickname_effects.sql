CREATE TABLE IF NOT EXISTS player_nickname_effects (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  rainbow BOOLEAN NOT NULL DEFAULT false,
  granted_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
