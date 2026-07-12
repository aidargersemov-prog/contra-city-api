INSERT INTO audit_events (
  created_at, player_id, event_type, category, severity, suspicious,
  description, old_value, new_value, source, metadata
)
SELECT
  ph.created_at,
  ph.player_id,
  'purchase',
  CASE ph.item_type
    WHEN 1 THEN 'weapons'
    WHEN 2 THEN 'enhancers'
    WHEN 3 THEN 'clothes'
    WHEN 4 THEN 'taunts'
    ELSE 'inventory'
  END,
  'info',
  FALSE,
  'Покупка ' || COALESCE(NULLIF(ph.item_data->>'name', ''), NULLIF(ph.item_data->>'sn', ''), ph.item_key),
  NULL,
  jsonb_build_object('itemKey', ph.item_key, 'itemId', ph.item_id, 'itemType', ph.item_type, 'price', ph.price),
  'history_backfill',
  jsonb_build_object('backfillKey', 'purchase_history:' || ph.id, 'price', ph.price, 'item', ph.item_data)
FROM purchase_history ph;

INSERT INTO audit_events (
  created_at, player_id, player_name, clan_id, event_type, category, severity,
  suspicious, description, new_value, source, metadata
)
SELECT
  te.created_at,
  te.player_id,
  te.player_name,
  te.clan_id,
  CASE WHEN te.event_type = 1 THEN 'clan_treasury_deposit' ELSE 'clan_treasury_spend' END,
  'economy',
  'notice',
  FALSE,
  CASE WHEN te.event_type = 1
    THEN 'Внесено ' || te.money || ' монет в казну клана'
    ELSE 'Списано ' || abs(te.money) || ' монет из казны клана'
  END,
  jsonb_build_object('amount', te.money, 'treasuryEventType', te.event_type),
  'history_backfill',
  jsonb_build_object('backfillKey', 'clan_treasury_events:' || te.id)
FROM clan_treasury_events te;

INSERT INTO audit_events (
  created_at, player_id, clan_id, event_type, category, severity,
  suspicious, description, new_value, source, metadata
)
SELECT
  ce.created_at,
  CASE
    WHEN COALESCE(ce.data->>'uid', '') ~ '^[0-9]+$'
      AND EXISTS (SELECT 1 FROM players p WHERE p.id = (ce.data->>'uid')::integer)
    THEN (ce.data->>'uid')::integer
    ELSE ce.creator_player_id
  END,
  ce.clan_id,
  CASE ce.event_type
    WHEN 1 THEN 'clan_delete'
    WHEN 2 THEN 'clan_owner_change'
    WHEN 3 THEN 'clan_member_remove'
    WHEN 4 THEN 'clan_leave'
    ELSE 'clan_event'
  END,
  'clan',
  CASE WHEN ce.event_type IN (1, 3) THEN 'warning' ELSE 'notice' END,
  FALSE,
  CASE ce.event_type
    WHEN 1 THEN 'Клан удалён'
    WHEN 2 THEN 'Изменён владелец клана'
    WHEN 3 THEN 'Участник исключён из клана'
    WHEN 4 THEN 'Участник вышел из клана'
    ELSE 'Событие клана'
  END,
  ce.data,
  'history_backfill',
  jsonb_build_object('backfillKey', 'clan_events:' || ce.id, 'creatorPlayerId', ce.creator_player_id)
FROM clan_events ce;

INSERT INTO audit_events (
  created_at, player_id, event_type, category, severity, suspicious,
  description, new_value, source, metadata
)
SELECT
  dq.updated_at,
  dq.player_id::integer,
  'daily_quest_claim',
  'progress',
  'notice',
  FALSE,
  'Выполнено ежедневное задание #' || dq.quest_id,
  jsonb_build_object('questId', dq.quest_id, 'progress', dq.progress, 'target', dq.target, 'rewardExp', dq.reward_exp, 'rewardCoins', dq.reward_coins),
  'history_backfill',
  jsonb_build_object('backfillKey', 'daily_quests:' || dq.player_id || ':' || dq.quest_date || ':' || dq.slot)
FROM daily_quests dq
WHERE dq.claimed = TRUE;

INSERT INTO player_activity (player_id, last_seen_at, last_source, updated_at)
SELECT id, updated_at, 'players.updated_at', now()
FROM players
ON CONFLICT (player_id) DO NOTHING;
