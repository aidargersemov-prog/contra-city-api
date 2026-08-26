CREATE TABLE IF NOT EXISTS expedition_stash_pages (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  page_index SMALLINT NOT NULL CHECK (page_index BETWEEN 1 AND 4),
  unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  unlocked_at TIMESTAMPTZ NULL,
  PRIMARY KEY (player_id, page_index)
);

CREATE TABLE IF NOT EXISTS expedition_stash_items (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  page_index SMALLINT NOT NULL CHECK (page_index BETWEEN 1 AND 4),
  slot_x SMALLINT NOT NULL CHECK (slot_x BETWEEN 0 AND 4),
  slot_y SMALLINT NOT NULL CHECK (slot_y BETWEEN 0 AND 3),
  width SMALLINT NOT NULL CHECK (width BETWEEN 1 AND 2),
  height SMALLINT NOT NULL CHECK (height BETWEEN 1 AND 2),
  item_id TEXT NOT NULL CHECK (item_id ~ '^[a-z0-9_]{2,64}$'),
  item_type TEXT NOT NULL CHECK (item_type IN ('material', 'coupon')),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000000),
  coupon_value INTEGER NOT NULL DEFAULT 0 CHECK (coupon_value BETWEEN 0 AND 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_x + width <= 5),
  CHECK (slot_y + height <= 4)
);

CREATE INDEX IF NOT EXISTS expedition_stash_items_player_page_idx
  ON expedition_stash_items (player_id, page_index, created_at, id);

CREATE TABLE IF NOT EXISTS expedition_coupon_redemptions (
  stash_item_id BIGINT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value BETWEEN 1 AND 1000000),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expedition_runs (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  client_run_id TEXT NOT NULL CHECK (client_run_id ~ '^[0-9a-f]{32}$'),
  room_name TEXT NOT NULL DEFAULT '',
  player_count SMALLINT NOT NULL DEFAULT 1 CHECK (player_count BETWEEN 1 AND 4),
  state TEXT NOT NULL CHECK (state IN ('active', 'evacuated', 'wiped')),
  highest_wave SMALLINT NOT NULL DEFAULT 0 CHECK (highest_wave BETWEEN 0 AND 50),
  loot JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  UNIQUE (player_id, client_run_id)
);

CREATE INDEX IF NOT EXISTS expedition_runs_player_started_idx
  ON expedition_runs (player_id, started_at DESC);
