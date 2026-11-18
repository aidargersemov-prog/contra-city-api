-- Reunite any previously parked items with their owners before retiring the feature.
INSERT INTO regular_pve_materials(player_id,purpose,material,quantity)
SELECT player_id,'warehouse',material,quantity FROM regular_pve_bag_remainder
ON CONFLICT(player_id,purpose,material) DO UPDATE SET quantity=regular_pve_materials.quantity+excluded.quantity;
WITH used AS (SELECT player_id,ceil(sum(ceil(quantity/99.0))/9)::int AS rows FROM regular_pve_materials WHERE purpose='warehouse' GROUP BY player_id)
UPDATE regular_pve_profiles p SET storage_rows_2=greatest(storage_rows_2,least(7,used.rows-7-storage_rows_3)),
 storage_rows_3=greatest(storage_rows_3,least(7,used.rows-14)) FROM used WHERE p.player_id=used.player_id AND used.rows>7+storage_rows_2+storage_rows_3;
DROP TABLE regular_pve_bag_remainder;
