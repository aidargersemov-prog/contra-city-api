ALTER TABLE regular_pve_profiles
  ADD COLUMN berserk_rank integer NOT NULL DEFAULT 0 CHECK (berserk_rank BETWEEN 0 AND 5),
  ADD COLUMN ninja_rank integer NOT NULL DEFAULT 0 CHECK (ninja_rank BETWEEN 0 AND 5);
