CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  cckey TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'Contra City Player',
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  exp_min INTEGER NOT NULL DEFAULT 0,
  exp_max INTEGER NOT NULL DEFAULT 1000,
  money INTEGER NOT NULL DEFAULT 1000,
  view JSONB NOT NULL DEFAULT '{}'::jsonb,
  weap JSONB NOT NULL DEFAULT '{}'::jsonb,
  taun JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS players_cckey_idx ON players (cckey);

CREATE TABLE IF NOT EXISTS player_inventory (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_type INTEGER NOT NULL,
  item_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_key)
);

CREATE INDEX IF NOT EXISTS player_inventory_player_id_idx ON player_inventory (player_id);

CREATE TABLE IF NOT EXISTS player_abilities (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL,
  ability_level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, ability_id)
);

CREATE INDEX IF NOT EXISTS player_abilities_player_id_idx ON player_abilities (player_id);
