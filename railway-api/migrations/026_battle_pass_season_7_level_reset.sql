UPDATE player_store_entitlements
SET battle_pass_level = 1,
    updated_at = now()
WHERE battle_pass_level <> 1;
