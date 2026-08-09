ALTER TABLE player_store_entitlements
  ADD COLUMN IF NOT EXISTS tropical_case_progress INTEGER NOT NULL DEFAULT 0
    CHECK (tropical_case_progress BETWEEN 0 AND 2000);

ALTER TABLE player_case_openings
  DROP CONSTRAINT IF EXISTS player_case_openings_case_kind_check;

ALTER TABLE player_case_openings
  ADD CONSTRAINT player_case_openings_case_kind_check
  CHECK (case_kind IN ('summer', 'tropical'));
