CREATE TABLE IF NOT EXISTS daily_quests (
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_date DATE NOT NULL,
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 2),
  quest_id SMALLINT NOT NULL CHECK (quest_id BETWEEN 1 AND 24),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  target INTEGER NOT NULL CHECK (target > 0),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  reward_exp INTEGER NOT NULL CHECK (reward_exp >= 0),
  reward_coins INTEGER NOT NULL CHECK (reward_coins >= 0),
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, quest_date, slot),
  UNIQUE (player_id, quest_date, quest_id)
);

CREATE INDEX IF NOT EXISTS daily_quests_player_current_idx
  ON daily_quests (player_id, quest_date DESC);
