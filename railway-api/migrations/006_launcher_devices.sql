CREATE TABLE IF NOT EXISTS launcher_devices (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  device_key_id TEXT NOT NULL,
  device_public_key TEXT NOT NULL,
  hwid_hash TEXT NOT NULL DEFAULT '',
  risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS launcher_devices_device_key_id_idx
  ON launcher_devices (device_key_id);
