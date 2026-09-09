-- Keep existing daily goals, progress, wallets and rewards unchanged.
-- Empty spec identifies the original v1 goals until their normal daily reset.
ALTER TABLE clan_contract_entries ADD COLUMN IF NOT EXISTS objective_spec JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE clan_contract_entries ADD COLUMN IF NOT EXISTS objective_state JSONB NOT NULL DEFAULT '{}'::jsonb;
