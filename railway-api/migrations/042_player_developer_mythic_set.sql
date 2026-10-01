ALTER TABLE player_developer_effects
  ADD COLUMN IF NOT EXISTS mythic_set BOOLEAN NOT NULL DEFAULT false;
