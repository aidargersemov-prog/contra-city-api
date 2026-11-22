ALTER TABLE regular_pve_profiles
  ADD COLUMN equipped_outfit text CHECK (equipped_outfit IN ('stalker','technician'));

CREATE TABLE regular_pve_outfits (
  player_id bigint NOT NULL REFERENCES regular_pve_profiles(player_id) ON DELETE CASCADE,
  outfit text NOT NULL CHECK (outfit IN ('stalker','technician')),
  PRIMARY KEY (player_id, outfit)
);
