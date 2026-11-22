ALTER TABLE regular_pve_profiles
  ADD COLUMN adrenaline_rank integer NOT NULL DEFAULT 0 CHECK (adrenaline_rank BETWEEN 0 AND 5),
  ADD COLUMN vampirism_rank integer NOT NULL DEFAULT 0 CHECK (vampirism_rank BETWEEN 0 AND 5);
