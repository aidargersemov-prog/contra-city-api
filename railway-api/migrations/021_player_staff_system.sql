CREATE TABLE IF NOT EXISTS player_staff_roles (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('helper', 'moderator', 'admin', 'owner', 'developer')),
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  granted_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_staff_roles_active_idx
  ON player_staff_roles (role, player_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS player_staff_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  player_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('moderator', 'admin', 'owner', 'developer')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_staff_chat_messages_created_idx
  ON player_staff_chat_messages (id DESC);

ALTER TABLE admin_punishments
  ALTER COLUMN issued_by DROP NOT NULL;

ALTER TABLE admin_punishments
  ADD COLUMN IF NOT EXISTS issued_by_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_punishments_issuer_required'
      AND conrelid = 'admin_punishments'::regclass
  ) THEN
    ALTER TABLE admin_punishments
      ADD CONSTRAINT admin_punishments_issuer_required
      CHECK (issued_by IS NOT NULL OR issued_by_player_id IS NOT NULL) NOT VALID;
  END IF;
END
$$;

ALTER TABLE admin_punishments
  VALIDATE CONSTRAINT admin_punishments_issuer_required;

CREATE TABLE IF NOT EXISTS player_staff_actions (
  id BIGSERIAL PRIMARY KEY,
  actor_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('helper', 'moderator', 'admin', 'owner', 'developer')),
  target_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  target_role TEXT NOT NULL CHECK (target_role IN ('none', 'helper', 'moderator', 'admin', 'owner', 'developer')),
  action TEXT NOT NULL CHECK (action IN ('kick', 'ban')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes BETWEEN 0 AND 5256000),
  source TEXT NOT NULL CHECK (source IN ('event70', 'panel')),
  room_name TEXT NOT NULL DEFAULT '',
  map_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_staff_actions_target_idx
  ON player_staff_actions (target_player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS player_staff_actions_actor_idx
  ON player_staff_actions (actor_player_id, created_at DESC);
