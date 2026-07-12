CREATE OR REPLACE FUNCTION audit_player_state_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_state JSONB;
  new_state JSONB;
  changed_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF OLD.money IS DISTINCT FROM NEW.money THEN changed_fields := array_append(changed_fields, 'balance'); END IF;
  IF OLD.exp IS DISTINCT FROM NEW.exp THEN changed_fields := array_append(changed_fields, 'experience'); END IF;
  IF OLD.level IS DISTINCT FROM NEW.level THEN changed_fields := array_append(changed_fields, 'level'); END IF;
  IF OLD.stats IS DISTINCT FROM NEW.stats THEN changed_fields := array_append(changed_fields, 'statistics'); END IF;
  IF OLD.view IS DISTINCT FROM NEW.view THEN changed_fields := array_append(changed_fields, 'view'); END IF;
  IF OLD.weap IS DISTINCT FROM NEW.weap THEN changed_fields := array_append(changed_fields, 'weapons'); END IF;
  IF OLD.taun IS DISTINCT FROM NEW.taun THEN changed_fields := array_append(changed_fields, 'taunts'); END IF;

  IF cardinality(changed_fields) = 0 THEN RETURN NEW; END IF;

  old_state := jsonb_build_object(
    'balance', OLD.money, 'experience', OLD.exp, 'level', OLD.level,
    'statistics', OLD.stats, 'view', OLD.view, 'weapons', OLD.weap, 'taunts', OLD.taun
  );
  new_state := jsonb_build_object(
    'balance', NEW.money, 'experience', NEW.exp, 'level', NEW.level,
    'statistics', NEW.stats, 'view', NEW.view, 'weapons', NEW.weap, 'taunts', NEW.taun
  );

  INSERT INTO audit_events (
    player_id, player_name, event_type, category, severity, suspicious,
    description, old_value, new_value, source, metadata
  ) VALUES (
    NEW.id, NEW.name, 'player_state_change',
    CASE WHEN changed_fields && ARRAY['balance']::TEXT[] THEN 'economy' ELSE 'profile' END,
    CASE WHEN abs(COALESCE(NEW.money, 0) - COALESCE(OLD.money, 0)) >= 10000 THEN 'warning' ELSE 'info' END,
    abs(COALESCE(NEW.money, 0) - COALESCE(OLD.money, 0)) >= 10000,
    'Изменены данные игрока: ' || array_to_string(changed_fields, ', '),
    old_state,
    new_state,
    'database_trigger',
    jsonb_build_object('changedFields', to_jsonb(changed_fields))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_audit_state_change ON players;
CREATE TRIGGER players_audit_state_change
AFTER UPDATE OF money, exp, level, stats, view, weap, taun ON players
FOR EACH ROW EXECUTE FUNCTION audit_player_state_changes();

CREATE OR REPLACE FUNCTION audit_player_inventory_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_player_id INTEGER;
  target_item_key TEXT;
  player_name_value TEXT;
  operation_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_player_id := OLD.player_id;
    target_item_key := OLD.item_key;
  ELSE
    target_player_id := NEW.player_id;
    target_item_key := NEW.item_key;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.item_type IS NOT DISTINCT FROM NEW.item_type AND OLD.item_data IS NOT DISTINCT FROM NEW.item_data THEN
    RETURN NEW;
  END IF;
  SELECT name INTO player_name_value FROM players WHERE id = target_player_id;
  operation_name := CASE TG_OP WHEN 'INSERT' THEN 'добавлен' WHEN 'DELETE' THEN 'удалён' ELSE 'изменён' END;

  INSERT INTO audit_events (
    player_id, player_name, event_type, category, severity, suspicious,
    description, old_value, new_value, source, metadata
  ) VALUES (
    target_player_id,
    COALESCE(player_name_value, ''),
    'inventory_change',
    'inventory',
    'info',
    FALSE,
    'Предмет ' || target_item_key || ' ' || operation_name,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.item_data END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.item_data END,
    'database_trigger',
    jsonb_build_object('operation', lower(TG_OP), 'itemKey', target_item_key)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS player_inventory_audit_change ON player_inventory;
CREATE TRIGGER player_inventory_audit_change
AFTER INSERT OR UPDATE OR DELETE ON player_inventory
FOR EACH ROW EXECUTE FUNCTION audit_player_inventory_changes();

CREATE OR REPLACE FUNCTION audit_clan_state_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN changed_fields := array_append(changed_fields, 'name'); END IF;
  IF OLD.tag IS DISTINCT FROM NEW.tag THEN changed_fields := array_append(changed_fields, 'tag'); END IF;
  IF OLD.owner_player_id IS DISTINCT FROM NEW.owner_player_id THEN changed_fields := array_append(changed_fields, 'owner'); END IF;
  IF OLD.money IS DISTINCT FROM NEW.money THEN changed_fields := array_append(changed_fields, 'treasury'); END IF;
  IF OLD.level IS DISTINCT FROM NEW.level THEN changed_fields := array_append(changed_fields, 'level'); END IF;
  IF OLD.exp IS DISTINCT FROM NEW.exp THEN changed_fields := array_append(changed_fields, 'experience'); END IF;
  IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN changed_fields := array_append(changed_fields, 'deleted'); END IF;
  IF cardinality(changed_fields) = 0 THEN RETURN NEW; END IF;

  INSERT INTO audit_events (
    player_id, clan_id, clan_name, event_type, category, severity, suspicious,
    description, old_value, new_value, source, metadata
  ) VALUES (
    NEW.owner_player_id,
    NEW.id,
    NEW.name,
    'clan_state_change',
    CASE WHEN changed_fields && ARRAY['treasury']::TEXT[] THEN 'economy' ELSE 'clan' END,
    CASE WHEN changed_fields && ARRAY['deleted', 'owner']::TEXT[] THEN 'warning' ELSE 'info' END,
    FALSE,
    'Изменены данные клана: ' || array_to_string(changed_fields, ', '),
    jsonb_build_object('name', OLD.name, 'tag', OLD.tag, 'ownerPlayerId', OLD.owner_player_id, 'money', OLD.money, 'level', OLD.level, 'exp', OLD.exp, 'deletedAt', OLD.deleted_at),
    jsonb_build_object('name', NEW.name, 'tag', NEW.tag, 'ownerPlayerId', NEW.owner_player_id, 'money', NEW.money, 'level', NEW.level, 'exp', NEW.exp, 'deletedAt', NEW.deleted_at),
    'database_trigger',
    jsonb_build_object('changedFields', to_jsonb(changed_fields))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clans_audit_state_change ON clans;
CREATE TRIGGER clans_audit_state_change
AFTER UPDATE OF name, tag, owner_player_id, money, level, exp, deleted_at ON clans
FOR EACH ROW EXECUTE FUNCTION audit_clan_state_changes();
