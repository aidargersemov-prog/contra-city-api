CREATE TABLE IF NOT EXISTS donate_products (
  id TEXT PRIMARY KEY,
  coins INTEGER NOT NULL CHECK (coins > 0),
  rubles INTEGER NOT NULL CHECK (rubles > 0),
  stars INTEGER NOT NULL CHECK (stars > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO donate_products (id, coins, rubles, stars, display_order, active)
VALUES
  ('coins_150', 150, 69, 35, 10, TRUE),
  ('coins_400', 400, 179, 90, 20, TRUE),
  ('coins_1100', 1100, 489, 245, 30, TRUE),
  ('coins_2900', 2900, 1249, 625, 40, TRUE),
  ('coins_5800', 5800, 2399, 1200, 50, TRUE)
ON CONFLICT (id) DO UPDATE
SET coins = EXCLUDED.coins,
    rubles = EXCLUDED.rubles,
    stars = EXCLUDED.stars,
    display_order = EXCLUDED.display_order,
    active = EXCLUDED.active,
    updated_at = now();

CREATE TABLE IF NOT EXISTS donate_orders (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  telegram_user_id BIGINT NOT NULL,
  product_id TEXT NOT NULL REFERENCES donate_products(id) ON DELETE RESTRICT,
  coins INTEGER NOT NULL CHECK (coins > 0),
  rubles INTEGER NOT NULL CHECK (rubles > 0),
  stars INTEGER NOT NULL CHECK (stars > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'refunded')),
  telegram_payment_charge_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS donate_orders_telegram_idx
  ON donate_orders (telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS donate_orders_player_idx
  ON donate_orders (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS donate_orders_pending_expiry_idx
  ON donate_orders (expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS donate_payments (
  telegram_payment_charge_id TEXT PRIMARY KEY,
  provider_payment_charge_id TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL UNIQUE REFERENCES donate_orders(id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  telegram_user_id BIGINT NOT NULL,
  product_id TEXT NOT NULL REFERENCES donate_products(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency = 'XTR'),
  stars INTEGER NOT NULL CHECK (stars > 0),
  coins INTEGER NOT NULL CHECK (coins > 0),
  rubles INTEGER NOT NULL CHECK (rubles > 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  telegram_paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS donate_payments_player_idx
  ON donate_payments (player_id, created_at DESC);
