-- Clan Cup is entirely server-authoritative.  A player can appear only once
-- in a cup roster, and every reward is tied to a persisted cup/player pair.

CREATE TABLE IF NOT EXISTS clan_cups (
  id BIGSERIAL PRIMARY KEY,
  cup_number INTEGER NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('draft', 'registration', 'locked', 'live', 'paused', 'completed', 'cancelled')),
  max_clans SMALLINT NOT NULL CHECK (max_clans IN (4, 8, 16, 32, 64)),
  map_name TEXT NOT NULL DEFAULT 'legoturnament',
  mode TEXT NOT NULL DEFAULT 'team_deathmatch',
  score_limit SMALLINT NOT NULL DEFAULT 30,
  match_duration_seconds INTEGER NOT NULL DEFAULT 900,
  round_interval_minutes SMALLINT NOT NULL DEFAULT 45,
  registration_opens_at TIMESTAMPTZ NOT NULL,
  registration_closes_at TIMESTAMPTZ NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  reward_amount INTEGER NOT NULL CHECK (reward_amount >= 0),
  created_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (registration_closes_at > registration_opens_at),
  CHECK (starts_at >= registration_closes_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS clan_cups_one_active_idx
  ON clan_cups ((1))
  WHERE state IN ('draft', 'registration', 'locked', 'live', 'paused');

CREATE TABLE IF NOT EXISTS clan_cup_entries (
  id BIGSERIAL PRIMARY KEY,
  cup_id BIGINT NOT NULL REFERENCES clan_cups(id) ON DELETE CASCADE,
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE RESTRICT,
  registered_by_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  seed INTEGER NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  UNIQUE (cup_id, clan_id)
);

CREATE INDEX IF NOT EXISTS clan_cup_entries_cup_seed_idx
  ON clan_cup_entries (cup_id, seed)
  WHERE withdrawn_at IS NULL;

CREATE TABLE IF NOT EXISTS clan_cup_entry_players (
  entry_id BIGINT NOT NULL REFERENCES clan_cup_entries(id) ON DELETE CASCADE,
  cup_id BIGINT NOT NULL REFERENCES clan_cups(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  roster_role TEXT NOT NULL CHECK (roster_role IN ('main', 'reserve')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, player_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS clan_cup_entry_players_one_roster_idx
  ON clan_cup_entry_players (cup_id, player_id);

CREATE TABLE IF NOT EXISTS clan_cup_matches (
  id BIGSERIAL PRIMARY KEY,
  cup_id BIGINT NOT NULL REFERENCES clan_cups(id) ON DELETE CASCADE,
  round_index SMALLINT NOT NULL CHECK (round_index >= 1),
  slot_index SMALLINT NOT NULL CHECK (slot_index >= 1),
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'launching', 'live', 'completed', 'cancelled')),
  entry_a_id BIGINT REFERENCES clan_cup_entries(id) ON DELETE RESTRICT,
  entry_b_id BIGINT REFERENCES clan_cup_entries(id) ON DELETE RESTRICT,
  winner_entry_id BIGINT REFERENCES clan_cup_entries(id) ON DELETE RESTRICT,
  next_match_id BIGINT REFERENCES clan_cup_matches(id) ON DELETE SET NULL,
  next_match_slot SMALLINT CHECK (next_match_slot IN (1, 2)),
  scheduled_at TIMESTAMPTZ NOT NULL,
  checkin_opens_at TIMESTAMPTZ NOT NULL,
  checkin_locks_at TIMESTAMPTZ NOT NULL,
  room_name TEXT UNIQUE,
  score_a SMALLINT,
  score_b SMALLINT,
  result_kind TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (cup_id, round_index, slot_index),
  CHECK (checkin_opens_at <= checkin_locks_at),
  CHECK (checkin_locks_at <= scheduled_at)
);

CREATE INDEX IF NOT EXISTS clan_cup_matches_cup_schedule_idx
  ON clan_cup_matches (cup_id, state, scheduled_at);

CREATE INDEX IF NOT EXISTS clan_cup_matches_next_idx
  ON clan_cup_matches (next_match_id);

CREATE TABLE IF NOT EXISTS clan_cup_match_players (
  match_id BIGINT NOT NULL REFERENCES clan_cup_matches(id) ON DELETE CASCADE,
  entry_id BIGINT NOT NULL REFERENCES clan_cup_entries(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  PRIMARY KEY (match_id, entry_id, player_id)
);

CREATE INDEX IF NOT EXISTS clan_cup_match_players_checkin_idx
  ON clan_cup_match_players (match_id, entry_id, is_active, checked_in_at);

CREATE TABLE IF NOT EXISTS clan_cup_awards (
  cup_id BIGINT NOT NULL REFERENCES clan_cups(id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cup_id, player_id)
);

CREATE TABLE IF NOT EXISTS clan_cup_admin_actions (
  id BIGSERIAL PRIMARY KEY,
  cup_id BIGINT REFERENCES clan_cups(id) ON DELETE SET NULL,
  actor_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
