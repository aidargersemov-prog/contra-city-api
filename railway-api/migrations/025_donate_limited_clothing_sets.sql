ALTER TABLE donate_products
  DROP CONSTRAINT IF EXISTS donate_products_reward_kind_check;

ALTER TABLE donate_products
  ADD CONSTRAINT donate_products_reward_kind_check
  CHECK (reward_kind IN (
    'coins',
    'battle_pass_premium',
    'battle_pass_premium_plus',
    'battle_pass_levels',
    'case_tropical',
    'case_summer',
    'wear_set'
  ));

ALTER TABLE donate_orders
  ADD COLUMN IF NOT EXISTS limited_stock_reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS limited_stock_consumed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS donate_limited_stock (
  product_id TEXT PRIMARY KEY REFERENCES donate_products(id) ON DELETE CASCADE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0 AND remaining <= capacity),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_pending_inventory_deliveries (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES donate_orders(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_data JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, item_key)
);

CREATE INDEX IF NOT EXISTS player_pending_inventory_deliveries_player_idx
  ON player_pending_inventory_deliveries (player_id, created_at)
  WHERE delivered_at IS NULL;

INSERT INTO donate_products (
  id, title, reward_kind, reward_amount,
  coins, rubles, stars, display_order, active
)
VALUES
  (
    'set_spy',
    'Набор «Шпион»',
    'wear_set',
    36,
    0,
    3499,
    1949,
    180,
    TRUE
  ),
  (
    'set_stalker',
    'Набор «Сталкер»',
    'wear_set',
    35,
    0,
    2599,
    1449,
    190,
    TRUE
  ),
  (
    'set_necrowarrior',
    'Набор «Некровоин»',
    'wear_set',
    25,
    0,
    2099,
    1199,
    200,
    TRUE
  ),
  (
    'set_avenger',
    'Набор «Мститель»',
    'wear_set',
    34,
    0,
    1899,
    1059,
    210,
    TRUE
  )
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title,
    reward_kind = EXCLUDED.reward_kind,
    reward_amount = EXCLUDED.reward_amount,
    coins = EXCLUDED.coins,
    rubles = EXCLUDED.rubles,
    stars = EXCLUDED.stars,
    display_order = EXCLUDED.display_order,
    active = EXCLUDED.active,
    updated_at = now();

INSERT INTO donate_limited_stock (product_id, capacity, remaining)
VALUES
  ('set_spy', 5, 5),
  ('set_stalker', 5, 5),
  ('set_necrowarrior', 5, 5),
  ('set_avenger', 5, 5)
ON CONFLICT (product_id) DO NOTHING;
