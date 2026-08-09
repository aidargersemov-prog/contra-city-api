ALTER TABLE player_store_entitlements
  ADD COLUMN IF NOT EXISTS summer_case_progress INTEGER NOT NULL DEFAULT 0
    CHECK (summer_case_progress BETWEEN 0 AND 2000);

CREATE TABLE IF NOT EXISTS player_case_openings (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  case_kind TEXT NOT NULL CHECK (case_kind IN ('summer')),
  case_amount SMALLINT NOT NULL CHECK (case_amount IN (1, 10)),
  result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);

ALTER TABLE player_pending_inventory_deliveries
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS case_opening_id BIGINT
    REFERENCES player_case_openings(id) ON DELETE CASCADE;

ALTER TABLE player_pending_inventory_deliveries
  DROP CONSTRAINT IF EXISTS player_pending_inventory_deliveries_source_check;

ALTER TABLE player_pending_inventory_deliveries
  ADD CONSTRAINT player_pending_inventory_deliveries_source_check
  CHECK ((order_id IS NOT NULL) <> (case_opening_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS player_pending_inventory_case_item_idx
  ON player_pending_inventory_deliveries (case_opening_id, item_key)
  WHERE case_opening_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS player_case_openings_player_created_idx
  ON player_case_openings (player_id, created_at DESC);
