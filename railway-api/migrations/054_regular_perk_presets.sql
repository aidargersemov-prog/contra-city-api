ALTER TABLE regular_pve_profiles
  ADD COLUMN active_perk_preset smallint NOT NULL DEFAULT 1 CHECK (active_perk_preset BETWEEN 1 AND 4),
  ADD COLUMN perk_presets jsonb NOT NULL DEFAULT '[[],[],[],[]]' CHECK (
    jsonb_typeof(perk_presets) = 'array' AND jsonb_array_length(perk_presets) = 4
    AND jsonb_array_length(perk_presets->0) <= 4
    AND jsonb_array_length(perk_presets->1) <= 4
    AND jsonb_array_length(perk_presets->2) <= 4
    AND jsonb_array_length(perk_presets->3) <= 4
  );
