CREATE TABLE IF NOT EXISTS daily_quest_events (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_date DATE NOT NULL,
  quest_id SMALLINT NOT NULL CHECK (quest_id BETWEEN 1 AND 24),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, quest_date, quest_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS daily_quest_events_player_date_idx
  ON daily_quest_events (player_id, quest_date DESC);
