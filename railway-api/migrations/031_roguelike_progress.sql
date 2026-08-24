CREATE TABLE IF NOT EXISTS player_roguelike_progress (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  highest_wave INTEGER NOT NULL DEFAULT 0 CHECK (highest_wave BETWEEN 0 AND 50),
  tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE,
  runs_completed INTEGER NOT NULL DEFAULT 0 CHECK (runs_completed >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_roguelike_materials (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 1000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, material_id)
);

CREATE INDEX IF NOT EXISTS player_roguelike_materials_player_id_idx
  ON player_roguelike_materials (player_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS roguelike_runs (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  client_run_id TEXT NOT NULL CHECK (client_run_id ~ '^[0-9a-f]{32}$'),
  wave INTEGER NOT NULL CHECK (wave BETWEEN 0 AND 50),
  won BOOLEAN NOT NULL DEFAULT FALSE,
  reward_contrabucks INTEGER NOT NULL DEFAULT 0 CHECK (reward_contrabucks BETWEEN 0 AND 11000),
  material_rewards JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, client_run_id)
);

CREATE INDEX IF NOT EXISTS roguelike_runs_player_created_idx
  ON roguelike_runs (player_id, created_at DESC);
