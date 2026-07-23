-- Players without a clan must still be auditable. Migration 014 selected a
-- nullable clan name into audit_events.clan_name, which is NOT NULL and made
-- every balance/profile update fail for clanless players.
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
  IF OLD.view IS DISTINCT FROM NEW.view THEN changed_fields := array_append(changed_fields, 'view'); END IF;
  IF OLD.weap IS DISTINCT FROM NEW.weap THEN changed_fields := array_append(changed_fields, 'weapons'); END IF;
  IF OLD.taun IS DISTINCT FROM NEW.taun THEN changed_fields := array_append(changed_fields, 'taunts'); END IF;

  IF cardinality(changed_fields) = 0 THEN RETURN NEW; END IF;

  old_state := jsonb_build_object(
    'balance', OLD.money, 'experience', OLD.exp, 'level', OLD.level,
    'view', OLD.view, 'weapons', OLD.weap, 'taunts', OLD.taun
  );
  new_state := jsonb_build_object(
    'balance', NEW.money, 'experience', NEW.exp, 'level', NEW.level,
    'view', NEW.view, 'weapons', NEW.weap, 'taunts', NEW.taun
  );

  INSERT INTO audit_events (
    player_id, player_name, clan_id, clan_name, event_type, category, severity,
    suspicious, description, old_value, new_value, source, metadata
  )
  SELECT
    NEW.id,
    NEW.name,
    cm.clan_id,
    COALESCE(c.name, ''),
    'player_state_change',
    CASE WHEN changed_fields && ARRAY['balance']::TEXT[] THEN 'economy' ELSE 'profile' END,
    CASE WHEN abs(COALESCE(NEW.money, 0) - COALESCE(OLD.money, 0)) >= 10000 THEN 'warning' ELSE 'info' END,
    abs(COALESCE(NEW.money, 0) - COALESCE(OLD.money, 0)) >= 10000,
    'Изменены данные игрока: ' || array_to_string(changed_fields, ', '),
    old_state,
    new_state,
    'database_trigger',
    jsonb_build_object('changedFields', to_jsonb(changed_fields))
  FROM (SELECT 1) seed
  LEFT JOIN LATERAL (
    SELECT membership.clan_id
    FROM clan_members membership
    JOIN clans active_clan ON active_clan.id = membership.clan_id AND active_clan.deleted_at IS NULL
    WHERE membership.player_id = NEW.id
    ORDER BY membership.joined_at DESC, membership.clan_id DESC
    LIMIT 1
  ) cm ON TRUE
  LEFT JOIN clans c ON c.id = cm.clan_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_audit_state_change ON players;
CREATE TRIGGER players_audit_state_change
AFTER UPDATE OF money, exp, level, view, weap, taun ON players
FOR EACH ROW EXECUTE FUNCTION audit_player_state_changes();
