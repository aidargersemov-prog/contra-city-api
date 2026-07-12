CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'head_admin', 'admin', 'moderator', 'viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_login_lower_unique
  ON admin_users (lower(login));

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_single_owner_unique
  ON admin_users (role)
  WHERE role = 'owner' AND active = TRUE;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_sessions_active_idx
  ON admin_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL DEFAULT '',
  clan_id BIGINT REFERENCES clans(id) ON DELETE SET NULL,
  clan_name TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notice', 'warning', 'critical')),
  suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  source TEXT NOT NULL DEFAULT 'game_api',
  ip_address TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  admin_user_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (review_status IN ('unchecked', 'checked', 'suspicious', 'violation')),
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_player_idx ON audit_events (player_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_clan_idx ON audit_events (clan_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_category_idx ON audit_events (category, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_suspicious_idx ON audit_events (created_at DESC) WHERE suspicious = TRUE;
CREATE INDEX IF NOT EXISTS audit_events_review_idx ON audit_events (review_status, created_at DESC);

CREATE TABLE IF NOT EXISTS player_activity (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_logout_at TIMESTAMPTZ,
  last_ip_address TEXT NOT NULL DEFAULT '',
  last_device TEXT NOT NULL DEFAULT '',
  last_source TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_activity_last_seen_idx ON player_activity (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS admin_punishments (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  punishment_type TEXT NOT NULL CHECK (punishment_type IN ('warning', 'mute', 'ban')),
  reason TEXT NOT NULL,
  issued_by BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_punishments_player_idx
  ON admin_punishments (player_id, created_at DESC);
