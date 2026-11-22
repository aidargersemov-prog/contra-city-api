ALTER TABLE regular_pve_profiles
  ADD COLUMN hardened_rank integer NOT NULL DEFAULT 0 CHECK (hardened_rank BETWEEN 0 AND 5),
  ADD COLUMN second_wind_rank integer NOT NULL DEFAULT 0 CHECK (second_wind_rank BETWEEN 0 AND 5);
