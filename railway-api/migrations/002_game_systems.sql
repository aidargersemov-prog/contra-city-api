CREATE TABLE IF NOT EXISTS player_equipment (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  view JSONB NOT NULL DEFAULT '{}'::jsonb,
  weap JSONB NOT NULL DEFAULT '{}'::jsonb,
  taun JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_history (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_type INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'vcur',
  item_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_history_player_id_idx ON purchase_history(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS player_weapon_stats (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  weapon_id INTEGER NOT NULL,
  weapon_type INTEGER NOT NULL DEFAULT 0,
  system_name TEXT NOT NULL DEFAULT '',
  kills INTEGER NOT NULL DEFAULT 0,
  headshots INTEGER NOT NULL DEFAULT 0,
  nuts INTEGER NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, weapon_id)
);

CREATE TABLE IF NOT EXISTS player_achievements (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  claimed_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS player_match_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  map_name TEXT NOT NULL DEFAULT '',
  mode INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  headshots INTEGER NOT NULL DEFAULT 0,
  play_time INTEGER NOT NULL DEFAULT 0,
  won BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_match_stats_player_id_idx ON player_match_stats(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clans (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL DEFAULT '',
  owner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_friends (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_player_id)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  item_key TEXT PRIMARY KEY,
  item_type INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  system_name TEXT NOT NULL DEFAULT '',
  item_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
