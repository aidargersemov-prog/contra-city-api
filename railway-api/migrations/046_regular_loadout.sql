CREATE TABLE regular_pve_loadout (
 player_id bigint REFERENCES regular_pve_profiles, slot integer CHECK(slot BETWEEN 1 AND 69), material text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 99), rotated boolean NOT NULL, PRIMARY KEY(player_id,slot)
);
CREATE TABLE regular_pve_raid_history (
 player_id bigint REFERENCES regular_pve_profiles, run_id text NOT NULL, finished_at timestamptz, seconds integer,
 PRIMARY KEY(player_id,run_id)
);
-- Historical receipts have no timestamp. Include them in lifetime totals only.
INSERT INTO regular_pve_raid_history(player_id,run_id)
 SELECT player_id,operation FROM regular_pve_operations WHERE operation LIKE '%/evac';
CREATE TABLE regular_pve_departures (
 player_id bigint REFERENCES regular_pve_profiles, run_id uuid NOT NULL, PRIMARY KEY(player_id,run_id)
);
CREATE TABLE regular_pve_departure_items (
 player_id bigint,run_id uuid,slot integer,material text NOT NULL,quantity integer NOT NULL,rotated boolean NOT NULL,
 PRIMARY KEY(player_id,run_id,slot), FOREIGN KEY(player_id,run_id) REFERENCES regular_pve_departures
);
