ALTER TABLE players
  ADD COLUMN IF NOT EXISTS name_pending BOOLEAN NOT NULL DEFAULT false;

UPDATE players
SET name_pending = true
WHERE id <> 1
  AND lower(trim(name)) = 'contracity';

