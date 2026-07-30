-- Soft-deleted clans keep their history row, but their name and tag become
-- available for a new clan immediately. Uniqueness must match the API's
-- active-clan checks and remain race-safe for concurrent create requests.

CREATE UNIQUE INDEX IF NOT EXISTS clans_name_active_lower_unique
  ON clans (lower(name))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clans_tag_active_lower_unique
  ON clans (lower(tag))
  WHERE deleted_at IS NULL AND tag <> '';

ALTER TABLE clans
  DROP CONSTRAINT IF EXISTS clans_name_key;

DROP INDEX IF EXISTS clans_tag_lower_unique;
