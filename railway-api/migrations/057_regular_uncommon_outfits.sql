ALTER TABLE regular_pve_profiles
  DROP CONSTRAINT regular_pve_profiles_equipped_outfit_check,
  ADD CONSTRAINT regular_pve_profiles_equipped_outfit_check
    CHECK (equipped_outfit IN ('stalker','technician','mercenary','scout'));

ALTER TABLE regular_pve_outfits
  DROP CONSTRAINT regular_pve_outfits_outfit_check,
  ADD CONSTRAINT regular_pve_outfits_outfit_check
    CHECK (outfit IN ('stalker','technician','mercenary','scout'));
