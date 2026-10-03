-- Preserve raw evidence, but exclude confirmed technical noise from the journal.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS audit_noise BOOLEAN NOT NULL DEFAULT false;
WITH pairs AS (
 SELECT d.id AS deleted_id, i.id AS inserted_id
 FROM audit_events d JOIN audit_events i
   ON i.player_id=d.player_id AND i.created_at=d.created_at
  AND i.metadata->>'itemKey'=d.metadata->>'itemKey'
  AND i.new_value=d.old_value
 WHERE d.source='database_trigger' AND i.source='database_trigger'
   AND d.event_type='inventory_change' AND i.event_type='inventory_change'
   AND d.metadata->>'operation'='delete' AND i.metadata->>'operation'='insert'
), noise AS (SELECT deleted_id id FROM pairs UNION SELECT inserted_id FROM pairs)
UPDATE audit_events e SET audit_noise=true,
 metadata=e.metadata || '{"technicalReason":"unchanged_inventory_snapshot"}'::jsonb
FROM noise n WHERE e.id=n.id;

-- A changed snapshot is one update, not a removal followed by a grant.
WITH pairs AS (
 SELECT d.id deleted_id,i.id inserted_id,d.old_value
 FROM audit_events d JOIN audit_events i ON i.player_id=d.player_id
 AND i.created_at=d.created_at AND i.metadata->>'itemKey'=d.metadata->>'itemKey'
 WHERE d.source='database_trigger' AND i.source='database_trigger'
 AND d.event_type='inventory_change' AND i.event_type='inventory_change'
 AND d.metadata->>'operation'='delete' AND i.metadata->>'operation'='insert'
 AND d.old_value IS DISTINCT FROM i.new_value
), repaired AS (
 UPDATE audit_events i SET old_value=p.old_value,
 metadata=i.metadata || '{"operation":"update","originalOperation":"insert","technicalReason":"changed_inventory_snapshot"}'::jsonb
 FROM pairs p WHERE i.id=p.inserted_id RETURNING p.deleted_id
)
UPDATE audit_events d SET audit_noise=true,
 metadata=d.metadata || '{"technicalReason":"changed_inventory_snapshot"}'::jsonb
FROM repaired r WHERE d.id=r.deleted_id;

UPDATE audit_events SET audit_noise=true,
 metadata=metadata || '{"technicalReason":"service_profile_request"}'::jsonb
WHERE source='game_api_login' AND event_type='player_login' AND device IN ('node','undici');

-- These old entries were inferred from every AJAX request, not explicit logins.
WITH visits AS (
 SELECT id, created_at, lag(created_at) OVER(PARTITION BY player_id,device ORDER BY created_at,id) previous
 FROM audit_events WHERE source='game_api_login' AND event_type='player_login' AND NOT audit_noise
)
UPDATE audit_events e SET audit_noise=true,
 metadata=metadata || '{"technicalReason":"ajax_visit_refresh","idleWindowMinutes":30}'::jsonb
FROM visits v WHERE e.id=v.id AND v.created_at-v.previous < interval '30 minutes';

UPDATE audit_events SET
 metadata=metadata || jsonb_build_object('originalEventType',event_type),
 event_type=CASE event_type WHEN 'player_login' THEN 'battle_join' ELSE 'battle_leave' END
WHERE source='battle_server' AND event_type IN ('player_login','player_logout');

-- Repair the denormalized profile only from real saved client evidence.
UPDATE player_activity pa SET last_device=COALESCE((
 SELECT e.device FROM audit_events e WHERE e.player_id=pa.player_id
 AND e.device NOT IN ('','node','undici')
 AND e.source IN ('game_api_login','launcher_session','web_session','login_link')
 ORDER BY e.created_at DESC,e.id DESC LIMIT 1), '')
WHERE pa.last_device IN ('node','undici');

UPDATE player_activity pa SET last_ip_address=COALESCE((
 SELECT regexp_replace(e.ip_address,'^::ffff:','','i') FROM audit_events e
 WHERE e.player_id=pa.player_id AND e.source='battle_server'
 AND e.ip_address<>'' AND e.ip_address !~ '^(::ffff:)?(100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
 ORDER BY e.created_at DESC,e.id DESC LIMIT 1), '')
WHERE pa.last_ip_address ~ '^(::ffff:)?100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.';

CREATE TABLE IF NOT EXISTS game_audit_visits (
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 device_key TEXT NOT NULL,
 last_seen_at TIMESTAMPTZ NOT NULL,
 emit_login BOOLEAN NOT NULL,
 PRIMARY KEY(player_id,device_key)
);

-- Old summaries carry no trustworthy server identity; leave them unassigned.
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS server_host TEXT NOT NULL DEFAULT '';
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS server_port INTEGER;
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS match_instance_id TEXT NOT NULL DEFAULT '';

-- Identically named rooms on different battle endpoints are independent.
ALTER TABLE battle_rooms DROP CONSTRAINT IF EXISTS battle_rooms_room_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS battle_rooms_endpoint_name_idx ON battle_rooms(server_host,server_port,room_name);
