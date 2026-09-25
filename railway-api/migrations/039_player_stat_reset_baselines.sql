-- Map and mode statistics share player_match_stats. Independent resets keep
-- match history intact and exclude rows recorded before each scope's reset.
CREATE TABLE IF NOT EXISTS player_stat_reset_baselines (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  mode_after_match_id BIGINT NOT NULL DEFAULT 0,
  map_after_match_id BIGINT NOT NULL DEFAULT 0
);
