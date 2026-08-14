CREATE TABLE IF NOT EXISTS battle_pass_seasons (
  season_id INTEGER PRIMARY KEY CHECK (season_id > 0),
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  task_cycle_anchor_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS battle_pass_seasons_one_active_idx
  ON battle_pass_seasons (active)
  WHERE active = TRUE;

UPDATE battle_pass_seasons
SET active = FALSE,
    updated_at = now()
WHERE active = TRUE
  AND season_id <> 1;

INSERT INTO battle_pass_seasons (
  season_id, title, starts_at, ends_at, task_cycle_anchor_at, active
)
VALUES (
  1,
  'Летний сезон 1',
  now(),
  now() + INTERVAL '60 days',
  date_trunc('day', now()),
  TRUE
)
ON CONFLICT (season_id) DO UPDATE
SET title = EXCLUDED.title,
    active = TRUE,
    updated_at = now();

ALTER TABLE player_store_entitlements
  ADD COLUMN IF NOT EXISTS battle_pass_xp INTEGER NOT NULL DEFAULT 0;

ALTER TABLE player_store_entitlements
  DROP CONSTRAINT IF EXISTS player_store_entitlements_battle_pass_xp_check;

ALTER TABLE player_store_entitlements
  ADD CONSTRAINT player_store_entitlements_battle_pass_xp_check
  CHECK (battle_pass_xp >= 0 AND battle_pass_xp < 1000);

ALTER TABLE player_store_entitlements
  ALTER COLUMN battle_pass_season SET DEFAULT 1;

UPDATE player_store_entitlements
SET battle_pass_season = 1,
    battle_pass_level = 1,
    battle_pass_xp = 0,
    battle_pass_premium = FALSE,
    battle_pass_premium_plus = FALSE,
    updated_at = now()
WHERE battle_pass_season <> 1
   OR battle_pass_level <> 1
   OR battle_pass_xp <> 0;
