ALTER TABLE regular_pve_profiles
  ADD COLUMN collector_rank integer NOT NULL DEFAULT 0 CHECK (collector_rank BETWEEN 0 AND 5),
  ADD COLUMN economist_rank integer NOT NULL DEFAULT 0 CHECK (economist_rank BETWEEN 0 AND 5);
