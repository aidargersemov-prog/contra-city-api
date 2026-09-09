-- No foreign key to clans: savePostgresStore replaces that legacy snapshot.
-- A cosmetic belongs to the clan permanently, not to the buying player.
CREATE TABLE IF NOT EXISTS clan_banner_ownership (
  clan_id BIGINT NOT NULL,
  banner_id TEXT NOT NULL CHECK (banner_id IN ('peaks', 'sunset', 'coast', 'rain', 'aurora', 'embers')),
  purchased_by INTEGER NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, banner_id)
);

CREATE TABLE IF NOT EXISTS clan_banner_appearance (
  clan_id BIGINT PRIMARY KEY,
  banner_id TEXT NOT NULL DEFAULT 'default' CHECK (banner_id IN ('default', 'peaks', 'sunset', 'coast', 'rain', 'aurora', 'embers')),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reuse the contract wallet's durable UUID receipt, including free equips.
ALTER TABLE clan_contract_operations
  DROP CONSTRAINT IF EXISTS clan_contract_operations_operation_kind_check;
ALTER TABLE clan_contract_operations
  ADD CONSTRAINT clan_contract_operations_operation_kind_check
  CHECK (operation_kind IN ('buy_arm', 'open_case', 'buy_banner', 'equip_banner'));
