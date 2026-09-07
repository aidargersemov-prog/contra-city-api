-- Clan contracts deliberately do not use FK references to `clans`: the
-- restored server rewrites the legacy clan snapshot inside one transaction.
-- Keeping the contract ledger independent prevents a normal clan profile
-- save from cascading into a live daily operation.

CREATE TABLE IF NOT EXISTS clan_contract_wallets (
  clan_id BIGINT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned_total INTEGER NOT NULL DEFAULT 0 CHECK (earned_total >= 0),
  spent_total INTEGER NOT NULL DEFAULT 0 CHECK (spent_total >= 0),
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clan_contract_wallet_events (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL,
  actor_player_id INTEGER,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clan_contract_wallet_events_clan_created_idx
  ON clan_contract_wallet_events (clan_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS clan_contract_cycles (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL,
  cycle_key DATE NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  reset_at TIMESTAMPTZ NOT NULL,
  completion_bonus INTEGER NOT NULL CHECK (completion_bonus >= 0),
  bonus_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clan_id, cycle_key)
);

CREATE TABLE IF NOT EXISTS clan_contract_entries (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES clan_contract_cycles(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 3),
  objective_key TEXT NOT NULL,
  target_value INTEGER NOT NULL CHECK (target_value > 0),
  current_value INTEGER NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  reward INTEGER NOT NULL CHECK (reward >= 0),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, slot),
  UNIQUE (cycle_id, objective_key)
);

CREATE TABLE IF NOT EXISTS clan_contract_contributions (
  contract_id BIGINT NOT NULL REFERENCES clan_contract_entries(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, player_id)
);

CREATE TABLE IF NOT EXISTS clan_contract_match_receipts (
  clan_id BIGINT NOT NULL,
  player_id INTEGER NOT NULL,
  match_instance_id UUID NOT NULL,
  cycle_id BIGINT NOT NULL REFERENCES clan_contract_cycles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A player can never move the same already-finished match into a new clan
  -- by leaving/rejoining before a delayed summary is retried.
  PRIMARY KEY (player_id, match_instance_id)
);

CREATE TABLE IF NOT EXISTS clan_contract_operations (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL,
  actor_player_id INTEGER NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('buy_arm', 'open_case')),
  product_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clan_contract_operations_clan_created_idx
  ON clan_contract_operations (clan_id, created_at DESC, id DESC);
