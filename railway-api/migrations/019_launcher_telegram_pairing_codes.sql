CREATE TABLE IF NOT EXISTS launcher_telegram_system_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  binding_epoch BIGINT NOT NULL DEFAULT 1 CHECK (binding_epoch > 0),
  last_reset_at TIMESTAMPTZ,
  last_reset_by_telegram_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO launcher_telegram_system_state (id, binding_epoch)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE launcher_telegram_bindings
  ADD COLUMN IF NOT EXISTS binding_epoch BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS launcher_telegram_login_requests (
  request_id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('link', 'ip_reverify')),
  expected_telegram_user_id BIGINT,
  device_key_id TEXT NOT NULL,
  link_key_hash TEXT NOT NULL,
  launcher_ip_hash TEXT NOT NULL,
  binding_epoch BIGINT NOT NULL CHECK (binding_epoch > 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'confirmed', 'rejected', 'cancelled', 'expired', 'locked')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS launcher_telegram_login_requests_active_player_idx
  ON launcher_telegram_login_requests (player_id)
  WHERE state IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS launcher_telegram_login_requests_telegram_idx
  ON launcher_telegram_login_requests (expected_telegram_user_id, state, created_at DESC);

CREATE INDEX IF NOT EXISTS launcher_telegram_login_requests_expiry_idx
  ON launcher_telegram_login_requests (expires_at);

CREATE TABLE IF NOT EXISTS launcher_telegram_pairing_codes (
  request_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  telegram_user_id BIGINT NOT NULL,
  telegram_username TEXT NOT NULL DEFAULT '',
  telegram_first_name TEXT NOT NULL DEFAULT '',
  telegram_last_name TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL CHECK (purpose IN ('link', 'ip_reverify')),
  expected_player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  login_request_id TEXT
    REFERENCES launcher_telegram_login_requests(request_id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  device_key_id TEXT,
  link_key_hash TEXT,
  launcher_ip_hash TEXT,
  binding_epoch BIGINT NOT NULL CHECK (binding_epoch > 0),
  state TEXT NOT NULL DEFAULT 'issued'
    CHECK (state IN ('issued', 'claimed', 'confirmed', 'rejected', 'cancelled', 'expired')),
  bot_chat_id BIGINT NOT NULL,
  bot_message_id BIGINT,
  confirmation_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS launcher_telegram_pairing_codes_active_user_idx
  ON launcher_telegram_pairing_codes (telegram_user_id)
  WHERE state IN ('issued', 'claimed');

CREATE UNIQUE INDEX IF NOT EXISTS launcher_telegram_pairing_codes_active_login_idx
  ON launcher_telegram_pairing_codes (login_request_id)
  WHERE login_request_id IS NOT NULL
    AND state IN ('issued', 'claimed');

CREATE INDEX IF NOT EXISTS launcher_telegram_pairing_codes_claimed_notify_idx
  ON launcher_telegram_pairing_codes (state, confirmation_notified_at, claimed_at)
  WHERE state = 'claimed';

CREATE INDEX IF NOT EXISTS launcher_telegram_pairing_codes_player_idx
  ON launcher_telegram_pairing_codes (player_id, state, created_at DESC);

CREATE INDEX IF NOT EXISTS launcher_telegram_pairing_codes_expiry_idx
  ON launcher_telegram_pairing_codes (expires_at);

CREATE TABLE IF NOT EXISTS launcher_telegram_admin_actions (
  request_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action = 'reset_all'),
  admin_telegram_user_id BIGINT NOT NULL,
  binding_epoch BIGINT NOT NULL CHECK (binding_epoch > 0),
  affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  state TEXT NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared', 'executed', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launcher_telegram_admin_actions_expiry_idx
  ON launcher_telegram_admin_actions (expires_at);

UPDATE launcher_telegram_flows
SET state = 'cancelled',
    updated_at = now()
WHERE state IN ('pending', 'claimed');
