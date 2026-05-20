CREATE TABLE IF NOT EXISTS battle_rooms (
  id BIGSERIAL PRIMARY KEY,
  room_name TEXT NOT NULL UNIQUE,
  map_name TEXT NOT NULL,
  mode INTEGER NOT NULL DEFAULT 1,
  max_players INTEGER NOT NULL DEFAULT 8,
  password_hash TEXT NOT NULL DEFAULT '',
  friendly_fire BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'waiting',
  host_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  server_host TEXT NOT NULL DEFAULT '',
  server_port INTEGER NOT NULL DEFAULT 5055,
  room_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_rooms_status_idx ON battle_rooms(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS battle_room_players (
  room_id BIGINT NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL,
  team INTEGER NOT NULL DEFAULT -1,
  health INTEGER NOT NULL DEFAULT 100,
  energy INTEGER NOT NULL DEFAULT 100,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  ping INTEGER NOT NULL DEFAULT 0,
  connected BOOLEAN NOT NULL DEFAULT true,
  player_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id),
  UNIQUE (room_id, actor_id)
);

CREATE INDEX IF NOT EXISTS battle_room_players_player_id_idx ON battle_room_players(player_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS battle_spawn_events (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  actor_id INTEGER NOT NULL,
  team INTEGER NOT NULL DEFAULT 0,
  health INTEGER NOT NULL DEFAULT 100,
  energy INTEGER NOT NULL DEFAULT 100,
  transform JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_spawn_events_room_id_idx ON battle_spawn_events(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS battle_score_events (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  killer_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  victim_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  weapon_id INTEGER NOT NULL DEFAULT 0,
  hit_zone INTEGER NOT NULL DEFAULT 0,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_score_events_room_id_idx ON battle_score_events(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS battle_chat_events (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  actor_id INTEGER NOT NULL DEFAULT 0,
  channel INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_chat_events_room_id_idx ON battle_chat_events(room_id, created_at DESC);
