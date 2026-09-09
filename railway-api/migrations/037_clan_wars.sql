-- War history deliberately has no FK to legacy clans/players: the legacy store
-- rebuilds clans during ordinary saves. Only this subsystem owns these records.
CREATE TABLE IF NOT EXISTS clan_wars (
  id UUID PRIMARY KEY,
  challenger_id BIGINT NOT NULL,
  defender_id BIGINT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing','challenged','assembling','scheduled','locked','gathering','running','completed','cancelled','forfeit')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (challenger_id <> defender_id)
);
CREATE INDEX IF NOT EXISTS clan_wars_schedule ON clan_wars(status, scheduled_at);
CREATE INDEX IF NOT EXISTS clan_wars_challenger ON clan_wars(challenger_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS clan_wars_defender ON clan_wars(defender_id, scheduled_at DESC);
CREATE TABLE IF NOT EXISTS clan_war_operations (
  actor_id INTEGER NOT NULL,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, request_id)
);
CREATE TABLE IF NOT EXISTS clan_war_results (
  war_id UUID PRIMARY KEY REFERENCES clan_wars(id),
  result_id UUID NOT NULL UNIQUE,
  attempt_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  pair_key TEXT NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  rated BOOLEAN NOT NULL,
  winner_clan_id BIGINT,
  score JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS clan_war_pair_results ON clan_war_results(pair_key, finished_at DESC);
CREATE TABLE IF NOT EXISTS clan_war_ratings (
  clan_id BIGINT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0 CHECK(rating >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
