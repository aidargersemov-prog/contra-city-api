ALTER TABLE player_store_entitlements
  ADD COLUMN IF NOT EXISTS special_case_fragments INTEGER NOT NULL DEFAULT 0
    CHECK (special_case_fragments BETWEEN 0 AND 2000);

UPDATE player_store_entitlements
SET special_case_fragments = LEAST(
  2000,
  GREATEST(
    special_case_fragments,
    COALESCE(summer_case_progress, 0),
    COALESCE(tropical_case_progress, 0)
  )
);

ALTER TABLE player_case_openings
  ADD COLUMN IF NOT EXISTS resolution_data JSONB NOT NULL DEFAULT '{"decisions":{}}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE player_case_openings
SET resolution_data = '{"legacyGranted":true,"decisions":{}}'::jsonb,
    resolved_at = COALESCE(resolved_at, created_at)
WHERE resolved_at IS NULL
  AND result_data <> '{}'::jsonb;

CREATE INDEX IF NOT EXISTS player_case_openings_pending_idx
  ON player_case_openings (player_id, created_at DESC)
  WHERE resolved_at IS NULL;
