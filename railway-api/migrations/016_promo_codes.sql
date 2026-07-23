CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  code_normalized TEXT NOT NULL,
  reward_type TEXT NOT NULL DEFAULT 'contrabucks'
    CHECK (reward_type IN ('contrabucks')),
  reward_amount INTEGER NOT NULL
    CHECK (reward_amount > 0 AND reward_amount <= 10000000),
  max_redemptions INTEGER
    CHECK (max_redemptions IS NULL OR (max_redemptions > 0 AND max_redemptions <= 1000000)),
  redemption_count INTEGER NOT NULL DEFAULT 0
    CHECK (redemption_count >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by_telegram_id BIGINT,
  created_by_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_normalized_unique
  ON promo_codes (code_normalized);

CREATE INDEX IF NOT EXISTS promo_codes_active_idx
  ON promo_codes (active, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGSERIAL PRIMARY KEY,
  promo_code_id BIGINT NOT NULL REFERENCES promo_codes(id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL DEFAULT 'contrabucks'
    CHECK (reward_type IN ('contrabucks')),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  device_key_id TEXT NOT NULL DEFAULT '',
  link_key_hash TEXT NOT NULL DEFAULT '',
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, player_id)
);

CREATE INDEX IF NOT EXISTS promo_redemptions_player_idx
  ON promo_redemptions (player_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx
  ON promo_redemptions (promo_code_id, redeemed_at DESC);
