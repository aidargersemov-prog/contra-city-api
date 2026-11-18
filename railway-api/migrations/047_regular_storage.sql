ALTER TABLE regular_pve_profiles ADD COLUMN storage_rows_2 smallint NOT NULL DEFAULT 0 CHECK(storage_rows_2 BETWEEN 0 AND 7),
 ADD COLUMN storage_rows_3 smallint NOT NULL DEFAULT 0 CHECK(storage_rows_3 BETWEEN 0 AND 7);
CREATE TABLE regular_pve_bag_remainder(player_id bigint REFERENCES regular_pve_profiles, material text NOT NULL, quantity bigint NOT NULL CHECK(quantity>0), PRIMARY KEY(player_id,material));
-- Preserve overflow from the formerly unlimited warehouse without granting paid rows.
WITH ranked AS (
 SELECT player_id,material,quantity,coalesce(sum(ceil(quantity/99.0)) OVER(PARTITION BY player_id ORDER BY material ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) used
 FROM regular_pve_materials WHERE purpose='warehouse'
)
INSERT INTO regular_pve_bag_remainder SELECT player_id,material,quantity-least(quantity,greatest(0,63-used)::bigint*99)
 FROM ranked WHERE quantity>greatest(0,63-used)*99;
DELETE FROM regular_pve_materials m USING regular_pve_bag_remainder b WHERE m.player_id=b.player_id AND m.material=b.material AND m.purpose='warehouse' AND m.quantity=b.quantity;
UPDATE regular_pve_materials m SET quantity=m.quantity-b.quantity FROM regular_pve_bag_remainder b WHERE m.player_id=b.player_id AND m.material=b.material AND m.purpose='warehouse';
