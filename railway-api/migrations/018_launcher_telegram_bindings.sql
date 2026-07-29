CREATE TABLE IF NOT EXISTS launcher_telegram_bindings (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  telegram_username TEXT NOT NULL DEFAULT '',
  telegram_first_name TEXT NOT NULL DEFAULT '',
  telegram_last_name TEXT NOT NULL DEFAULT '',
  link_key_hash TEXT NOT NULL,
  last_ip_hash TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launcher_telegram_bindings_updated_idx
  ON launcher_telegram_bindings (updated_at DESC);

CREATE TABLE IF NOT EXISTS launcher_telegram_flows (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  device_key_id TEXT NOT NULL,
  link_key_hash TEXT NOT NULL,
  launcher_ip_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'confirmed', 'cancelled')),
  telegram_user_id BIGINT,
  telegram_username TEXT NOT NULL DEFAULT '',
  telegram_first_name TEXT NOT NULL DEFAULT '',
  telegram_last_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launcher_telegram_flows_player_idx
  ON launcher_telegram_flows (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS launcher_telegram_flows_expiry_idx
  ON launcher_telegram_flows (expires_at);
