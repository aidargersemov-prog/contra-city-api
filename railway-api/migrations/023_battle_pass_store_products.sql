ALTER TABLE donate_products
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_kind TEXT NOT NULL DEFAULT 'coins',
  ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 1;

ALTER TABLE donate_orders
  ADD COLUMN IF NOT EXISTS product_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_kind TEXT NOT NULL DEFAULT 'coins',
  ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 1;

ALTER TABLE donate_payments
  ADD COLUMN IF NOT EXISTS product_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reward_kind TEXT NOT NULL DEFAULT 'coins',
  ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reward_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reward_after JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE donate_orders DROP CONSTRAINT IF EXISTS donate_orders_status_check;
ALTER TABLE donate_orders
  ADD CONSTRAINT donate_orders_status_check
  CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'refunded'));

UPDATE donate_products
SET title = format('%s контрабаксов', coins),
    reward_kind = 'coins',
    reward_amount = coins
WHERE id LIKE 'coins_%';

UPDATE donate_orders
SET product_title = format('%s контрабаксов', coins),
    reward_kind = 'coins',
    reward_amount = coins
WHERE product_id LIKE 'coins_%';

UPDATE donate_payments
SET product_title = format('%s контрабаксов', coins),
    reward_kind = 'coins',
    reward_amount = coins
WHERE product_id LIKE 'coins_%';

ALTER TABLE donate_products DROP CONSTRAINT IF EXISTS donate_products_coins_check;
ALTER TABLE donate_orders DROP CONSTRAINT IF EXISTS donate_orders_coins_check;
ALTER TABLE donate_payments DROP CONSTRAINT IF EXISTS donate_payments_coins_check;

ALTER TABLE donate_products ALTER COLUMN coins DROP NOT NULL;
ALTER TABLE donate_orders ALTER COLUMN coins DROP NOT NULL;
ALTER TABLE donate_payments ALTER COLUMN coins DROP NOT NULL;

ALTER TABLE donate_products ALTER COLUMN coins SET DEFAULT 0;
ALTER TABLE donate_orders ALTER COLUMN coins SET DEFAULT 0;
ALTER TABLE donate_payments ALTER COLUMN coins SET DEFAULT 0;

UPDATE donate_products SET coins = 0 WHERE coins IS NULL;
UPDATE donate_orders SET coins = 0 WHERE coins IS NULL;
UPDATE donate_payments SET coins = 0 WHERE coins IS NULL;

ALTER TABLE donate_products ALTER COLUMN coins SET NOT NULL;
ALTER TABLE donate_orders ALTER COLUMN coins SET NOT NULL;
ALTER TABLE donate_payments ALTER COLUMN coins SET NOT NULL;

ALTER TABLE donate_products
  ADD CONSTRAINT donate_products_coins_nonnegative CHECK (coins >= 0);
ALTER TABLE donate_orders
  ADD CONSTRAINT donate_orders_coins_nonnegative CHECK (coins >= 0);
ALTER TABLE donate_payments
  ADD CONSTRAINT donate_payments_coins_nonnegative CHECK (coins >= 0);

ALTER TABLE donate_products
  ADD CONSTRAINT donate_products_reward_kind_check
  CHECK (reward_kind IN (
    'coins',
    'battle_pass_premium',
    'battle_pass_premium_plus',
    'battle_pass_levels',
    'case_tropical',
    'case_summer'
  ));

ALTER TABLE donate_products
  ADD CONSTRAINT donate_products_reward_amount_check CHECK (reward_amount > 0);
ALTER TABLE donate_orders
  ADD CONSTRAINT donate_orders_reward_amount_check CHECK (reward_amount > 0);
ALTER TABLE donate_payments
  ADD CONSTRAINT donate_payments_reward_amount_check CHECK (reward_amount > 0);

CREATE TABLE IF NOT EXISTS player_store_entitlements (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  battle_pass_season INTEGER NOT NULL DEFAULT 7 CHECK (battle_pass_season > 0),
  battle_pass_level INTEGER NOT NULL DEFAULT 1
    CHECK (battle_pass_level BETWEEN 1 AND 100),
  battle_pass_premium BOOLEAN NOT NULL DEFAULT FALSE,
  battle_pass_premium_plus BOOLEAN NOT NULL DEFAULT FALSE,
  tropical_cases INTEGER NOT NULL DEFAULT 0 CHECK (tropical_cases >= 0),
  summer_cases INTEGER NOT NULL DEFAULT 0 CHECK (summer_cases >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO player_store_entitlements (player_id, battle_pass_level)
SELECT id, LEAST(100, GREATEST(1, level))
FROM players
ON CONFLICT (player_id) DO NOTHING;

INSERT INTO donate_products (
  id, title, reward_kind, reward_amount,
  coins, rubles, stars, display_order, active
)
VALUES
  (
    'battle_pass_premium',
    'Premium Battle Pass',
    'battle_pass_premium',
    1,
    0,
    799,
    444,
    100,
    TRUE
  ),
  (
    'battle_pass_premium_plus',
    'Premium Plus (+10 уровней)',
    'battle_pass_premium_plus',
    10,
    0,
    1399,
    777,
    110,
    TRUE
  ),
  (
    'battle_pass_levels_5',
    '5 уровней Contra Pass',
    'battle_pass_levels',
    5,
    0,
    170,
    95,
    120,
    TRUE
  ),
  (
    'battle_pass_levels_10',
    '10 уровней Contra Pass',
    'battle_pass_levels',
    10,
    0,
    360,
    200,
    130,
    TRUE
  ),
  (
    'battle_pass_levels_20',
    '20 уровней Contra Pass',
    'battle_pass_levels',
    20,
    0,
    760,
    422,
    140,
    TRUE
  ),
  (
    'battle_pass_levels_100',
    '100 уровней Contra Pass',
    'battle_pass_levels',
    100,
    0,
    2120,
    1178,
    150,
    TRUE
  ),
  (
    'case_tropical',
    'Тропический кейс',
    'case_tropical',
    1,
    0,
    899,
    499,
    160,
    TRUE
  ),
  (
    'case_summer',
    'Кейс лета',
    'case_summer',
    1,
    0,
    159,
    88,
    170,
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
