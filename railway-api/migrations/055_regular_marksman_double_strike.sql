ALTER TABLE regular_pve_profiles
  ADD COLUMN marksman_rank integer NOT NULL DEFAULT 0 CHECK (marksman_rank BETWEEN 0 AND 5),
  ADD COLUMN double_strike_rank integer NOT NULL DEFAULT 0 CHECK (double_strike_rank BETWEEN 0 AND 5);
