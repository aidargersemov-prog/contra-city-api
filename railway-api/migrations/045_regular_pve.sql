CREATE TABLE regular_pve_profiles (
 player_id bigint PRIMARY KEY, revision integer NOT NULL DEFAULT 0, level integer NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 5),
 xp bigint NOT NULL DEFAULT 0 CHECK(xp>=0), yield_rank integer NOT NULL DEFAULT 0 CHECK(yield_rank BETWEEN 0 AND 4),
 speed_rank integer NOT NULL DEFAULT 0 CHECK(speed_rank BETWEEN 0 AND 4), loss_rank integer NOT NULL DEFAULT 0 CHECK(loss_rank BETWEEN 0 AND 4),
 extra_rank integer NOT NULL DEFAULT 0 CHECK(extra_rank BETWEEN 0 AND 4)
);
CREATE TABLE regular_pve_materials (
 player_id bigint REFERENCES regular_pve_profiles, purpose text NOT NULL, material text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0), PRIMARY KEY(player_id,purpose,material)
);
CREATE TABLE regular_pve_operations (
 player_id bigint REFERENCES regular_pve_profiles, operation text NOT NULL, PRIMARY KEY(player_id,operation)
);
