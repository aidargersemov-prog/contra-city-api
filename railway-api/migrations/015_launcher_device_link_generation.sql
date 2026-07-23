ALTER TABLE launcher_devices
  ADD COLUMN IF NOT EXISTS link_key_hash TEXT NOT NULL DEFAULT '';
