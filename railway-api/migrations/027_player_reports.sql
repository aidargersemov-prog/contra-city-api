CREATE TABLE IF NOT EXISTS player_reports (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  reporter_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  target_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  reporter_actor_id INTEGER NOT NULL DEFAULT 0,
  target_actor_id INTEGER NOT NULL DEFAULT 0,
  room_name TEXT NOT NULL DEFAULT '',
  map_name TEXT NOT NULL DEFAULT '',
  mode INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('cheats', 'abuse', 'voice_abuse', 'griefing', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 700),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  handled_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  staff_note TEXT NOT NULL DEFAULT '' CHECK (char_length(staff_note) <= 700),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS player_reports_status_created_idx
  ON player_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS player_reports_target_created_idx
  ON player_reports (target_player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS player_reports_reporter_created_idx
  ON player_reports (reporter_player_id, created_at DESC);
