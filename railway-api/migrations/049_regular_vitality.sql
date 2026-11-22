ALTER TABLE regular_pve_profiles
  ADD COLUMN vitality_rank integer NOT NULL DEFAULT 0 CHECK (vitality_rank BETWEEN 0 AND 5);
