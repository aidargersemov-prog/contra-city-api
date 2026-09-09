import { createHash, randomUUID } from 'node:crypto';

const MINUTE = 60000;
const TERMINAL = new Set(['completed', 'cancelled', 'forfeit']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WAR_MAPS = Object.freeze([
  { id: 'Arena_3lvl', name: 'Ангар, задний двор' }, { id: 'ArenaRing', name: 'Форпост' },
  { id: 'Bit_map', name: 'Комиссариат' }, { id: 'LegoTurnament', name: 'Рубеж' },
  { id: 'Inferno', name: 'Урбан' }
]);
const iso = value => new Date(value).toISOString();
const time = value => Date.parse(value);
const clone = value => JSON.parse(JSON.stringify(value));
const active = side => side.players.filter(p => !['replaced', 'ineligible'].includes(p.status));
const accepted = side => active(side).length === 5 && active(side).every(p => p.status === 'accepted');
const ids = war => [war.challenger.clanId, war.defender.clanId];
const sides = war => [war.challenger, war.defender];
const MESSAGES = Object.freeze({
  clan_wars_disabled: 'Клановые войны отключены', invalid_opponent: 'Выберите другой существующий клан',
  map_not_verified: 'Эта карта ещё не допущена к клановым войнам', invalid_duration: 'Продолжительность: от 10 до 15 минут',
  invalid_utc_time: 'Некорректное время войны', invalid_schedule: 'Назначьте войну от часа до семи дней вперёд',
  five_unique_players_required: 'Выберите ровно пять разных участников', owner_required: 'Действие доступно только главе клана',
  player_not_in_clan: 'Игрок больше не состоит в этом клане', clan_required: 'Для вызова нужно состоять в клане',
  clan_schedule_overlap: 'У одного из кланов уже назначена война на это время', player_schedule_overlap: 'Участник занят в другой войне',
  revision_conflict: 'Состав или состояние изменились. Обновите данные и повторите действие',
  request_id_conflict: 'Этот запрос уже использован с другими параметрами', war_not_active: 'Война уже завершена или отменена',
  not_in_war: 'Вы не участвуете в этой войне', challenge_not_sent: 'Вызов ещё не отправлен', join_unavailable: 'Вход в бой сейчас недоступен',
  battle_unavailable: 'Боевой сервер временно недоступен', roster_locked: 'Состав уже зафиксирован, изменения недоступны',
  invitation_not_pending: 'Это приглашение уже обработано или отозвано', challenge_not_pending: 'Вызов уже обработан',
  invalid_replacement: 'Выберите свободного участника для замены'
});
const fail = (code, message = MESSAGES[code] || code) => { throw Object.assign(new Error(message), { code, public: true }); };
const assert = (condition, code) => { if (!condition) fail(code); };
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const publicWar = war => { const copy = clone(war); delete copy.server; return copy; };
export function overlaps(a, b) {
  // Reserve the maximum round even when the selected match is only 10m:
  // gathering 5m + countdown 5s + round 15m + post-match buffer 5m.
  const reservedAfterStart = 25 * MINUTE + 5000;
  return time(a.lockAt) < time(b.scheduledAt) + reservedAfterStart &&
    time(b.lockAt) < time(a.scheduledAt) + reservedAfterStart;
}
export function validateCreate(data, now, maps) {
  assert(Number.isSafeInteger(data.opponentClanId) && data.opponentClanId > 0, 'invalid_opponent');
  assert(maps.some(m => m.id === data.map), 'map_not_verified');
  assert(Number.isInteger(data.durationMinutes) && data.durationMinutes >= 10 && data.durationMinutes <= 15, 'invalid_duration');
  const scheduled = time(data.scheduledAt);
  assert(Number.isFinite(scheduled) && /Z$/.test(data.scheduledAt), 'invalid_utc_time');
  assert(scheduled >= now + 60 * MINUTE && scheduled <= now + 7 * 24 * 60 * MINUTE, 'invalid_schedule');
  validateRoster(data.playerIds);
}
function validateRoster(list) {
  assert(Array.isArray(list) && list.length === 5 && new Set(list).size === 5 && list.every(n => Number.isSafeInteger(n) && n > 0), 'five_unique_players_required');
}

/** All decisions use a PostgreSQL clock and a single short transaction lock.
 * This intentionally serializes the low-volume war coordinator, including rating
 * and overlap checks, across API replicas. Never hold the lock for network I/O. */
export function createClanWars({ getPool, enabled = false, verifiedMaps = [], endpoint, log = console }) {
  const maps = WAR_MAPS.filter(m => verifiedMaps.includes(m.id));
  const isEnabled = () => Boolean(enabled && getPool());
  async function transaction(fn) {
    assert(isEnabled(), 'clan_wars_disabled');
    const db = await getPool().connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '5s'");
      await db.query('SELECT pg_advisory_xact_lock(737037, 1)');
      // Conflicts with legacy DELETE/reinsert and membership mutations. Unlike
      // row locks this also protects an empty/deleted membership set.
      await db.query('LOCK TABLE clans, clan_members IN SHARE MODE');
      const clock = await db.query('SELECT clock_timestamp() AS now');
      const now = new Date(clock.rows[0].now).getTime();
      const clans = (await db.query('SELECT id, name, tag, owner_player_id FROM clans WHERE deleted_at IS NULL')).rows;
      const members = (await db.query('SELECT m.clan_id, m.player_id, p.name FROM clan_members m JOIN players p ON p.id=m.player_id')).rows;
      const wars = (await db.query("SELECT data FROM clan_wars WHERE status NOT IN ('completed','cancelled','forfeit') ORDER BY scheduled_at")).rows.map(r => r.data);
      const ctx = { db, now, clans, members, wars };
      await reconcile(ctx);
      const result = await fn(ctx);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { db.release(); }
  }
  async function save(ctx, war) {
    war.revision++;
    await ctx.db.query(`INSERT INTO clan_wars(id,challenger_id,defender_id,scheduled_at,status,revision,data)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,revision=excluded.revision,data=excluded.data,updated_at=now()`,
    [war.id, war.challenger.clanId, war.defender.clanId, war.scheduledAt, war.status, war.revision, JSON.stringify(war)]);
  }
  const memberOf = (ctx, pid, cid) => ctx.members.some(m => Number(m.player_id) === pid && Number(m.clan_id) === cid);
  const clanFor = (ctx, pid) => ctx.clans.find(c => memberOf(ctx, pid, Number(c.id)));
  function owner(ctx, pid, cid) {
    assert(ctx.clans.some(c => Number(c.id) === cid && Number(c.owner_player_id) === pid) && memberOf(ctx, pid, cid), 'owner_required');
  }
  function roster(ctx, cid, list) {
    validateRoster(list);
    return list.map(pid => {
      const m = ctx.members.find(m => Number(m.clan_id) === cid && Number(m.player_id) === pid);
      assert(m, 'player_not_in_clan');
      return { playerId: pid, name: m.name, status: 'pending', ready: false, presence: 'offline' };
    });
  }
  function checkOverlap(ctx, war) {
    const players = sides(war).flatMap(s => active(s).map(p => p.playerId));
    for (const other of ctx.wars) {
      if (other.id === war.id || TERMINAL.has(other.status) || !overlaps(war, other)) continue;
      assert(!ids(other).some(id => ids(war).includes(id)), 'clan_schedule_overlap');
      assert(!sides(other).some(s => active(s).some(p => players.includes(p.playerId))), 'player_schedule_overlap');
    }
  }
  function terminal(war, status, reason, now) {
    war.status = status; war.reason = reason; war.ratingDelta = 0; war.rated = false;
    war.finishedAt = iso(now);
    sides(war).forEach(s => s.players.forEach(p => { p.ready = false; p.presence = p.presence && p.presence !== 'offline' ? 'disconnected' : 'offline'; }));
  }
  async function reconcile(ctx) {
    for (const war of ctx.wars) {
      const before = JSON.stringify(war);
      if (war.status !== 'running') {
        if (!ids(war).every(id => ctx.clans.some(c => Number(c.id) === id))) terminal(war, 'cancelled', 'clan_deleted', ctx.now);
        else {
          for (const side of sides(war)) for (const p of active(side)) {
            if (!memberOf(ctx, p.playerId, side.clanId)) { p.status = 'ineligible'; p.ready = false; p.presence = p.presence && p.presence !== 'offline' ? 'disconnected' : 'offline'; }
          }
          if (ctx.now >= time(war.lockAt) && !['locked', 'gathering'].includes(war.status)) {
            if (war.status === 'scheduled' && sides(war).every(accepted)) war.status = 'locked';
            else terminal(war, 'cancelled', 'rosters_not_confirmed', ctx.now);
          }
          if (war.status === 'locked' && ctx.now >= time(war.scheduledAt)) war.status = 'gathering';
          if (war.status === 'gathering' && ctx.now >= time(war.gatherUntil)) {
            if (!war.server || ctx.now > time(war.server.leaseUntil)) terminal(war, 'cancelled', 'infrastructure_unavailable', ctx.now);
            else {
              const ready = sides(war).map(s => accepted(s) && active(s).every(p => p.ready));
              terminal(war, ready[0] !== ready[1] ? 'forfeit' : 'cancelled', ready[0] !== ready[1] ? 'team_no_show' : 'gathering_expired', ctx.now);
              if (ready[0] !== ready[1]) war.winnerClanId = ready[0] ? war.challenger.clanId : war.defender.clanId;
            }
          }
        }
      } else if (ctx.now > time(war.endAt) + 120000) {
        terminal(war, 'cancelled', 'result_reconciliation_timeout', ctx.now);
      }
      if (before !== JSON.stringify(war)) await save(ctx, war);
    }
  }
  async function state(ctx, pid, requestedClanId) {
    const own = clanFor(ctx, pid);
    const cid = requestedClanId || Number(own?.id || 0);
    const privateView = own && Number(own.id) === cid;
    const board = (await ctx.db.query(`SELECT c.id AS "clanId",c.name,c.tag,COALESCE(r.rating,0)::int AS rating,COALESCE(r.wins,0)::int AS wins,
      ROW_NUMBER() OVER(ORDER BY COALESCE(r.rating,0) DESC,COALESCE(r.wins,0) DESC,c.id)::int AS place
      FROM clans c LEFT JOIN clan_war_ratings r ON r.clan_id=c.id WHERE c.deleted_at IS NULL`)).rows.map(r => ({ ...r, clanId: Number(r.clanId) }));
    board.sort((a, b) => a.place - b.place);
    const mine = board.find(r => r.clanId === cid);
    const history = (await ctx.db.query(`SELECT data FROM clan_wars WHERE
      ((challenger_id=$1 OR defender_id=$1) OR ($2::boolean AND (data @> $3::jsonb OR data @> $4::jsonb)))
      AND status IN ('completed','forfeit','cancelled') ORDER BY scheduled_at DESC LIMIT 30`,
    [cid, !requestedClanId, JSON.stringify({ challenger: { players: [{ playerId: pid }] } }),
      JSON.stringify({ defender: { players: [{ playerId: pid }] } })])).rows.map(r => publicWar(r.data));
    const wars = ctx.wars.filter(w => !TERMINAL.has(w.status) && (
      (privateView && ids(w).includes(cid) && (w.status !== 'preparing' || w.challenger.clanId === cid)) ||
      (!requestedClanId && w.status === 'running' && sides(w).some(s => active(s).some(p => p.playerId === pid)))
    )).map(publicWar);
    const invites = ctx.wars.filter(w => !TERMINAL.has(w.status) && ctx.now < time(w.lockAt) && sides(w).some(s => active(s).some(p => p.playerId === pid && p.status === 'pending'))).map(w => ({ warId: w.id, revision: w.revision }));
    return { enabled: true, serverNow: iso(ctx.now), clanId: cid, canManage: Boolean(privateView && Number(own.owner_player_id) === pid), maps,
      members: privateView ? ctx.members.filter(m => Number(m.clan_id) === cid).map(m => ({ playerId: Number(m.player_id), name: m.name })) : [],
      opponents: privateView ? ctx.clans.filter(c => Number(c.id) !== cid).map(c => ({ clanId: Number(c.id), name: c.name, tag: c.tag })) : [],
      wars, invites: privateView || !requestedClanId ? invites : [], history: privateView ? history : history.filter(w => ['completed','forfeit'].includes(w.status)),
      leaderboard: board.slice(0, 100), rating: mine?.rating || 0, place: mine?.place || 0 };
  }
  function freshJoin(ctx, pid, warId) {
    const war = ctx.wars.find(w => w.id === warId && !TERMINAL.has(w.status));
    assert(war, 'war_not_active');
    const participant = sides(war).find(s => active(s).some(p => p.playerId === pid && p.status === 'accepted'));
    assert(participant && ['gathering','running'].includes(war.status), 'join_unavailable');
    assert(war.status === 'running' || memberOf(ctx, pid, participant.clanId), 'not_in_war');
    assert(war.status !== 'running' || ctx.now < time(war.endAt), 'join_unavailable');
    assert(war.server && time(war.server.leaseUntil) > ctx.now && endpoint &&
      war.server.serverId === endpoint.serverId && war.server.host === endpoint.host && war.server.port === endpoint.port, 'battle_unavailable');
    return { warId: war.id, attemptId: war.attemptId, roomName: war.roomName, map: war.map,
      team: participant === war.challenger ? 1 : 2, durationMinutes: war.durationMinutes,
      serverId: war.server.serverId, host: war.server.host, port: war.server.port };
  }
  async function ajax(pid, action, params) {
    if (!isEnabled()) return action === 'state' ? { result: true, wars: { enabled: false, clanId: 0, wars: [], invites: [], history: [], leaderboard: [], maps: [], members: [], opponents: [], rating: 0, place: 0, canManage: false, serverNow: iso(Date.now()) } } : { result: false, error: 'clan_wars_disabled', message: 'Клановые войны отключены' };
    try {
      return await transaction(async ctx => {
        if (action === 'state') return { result: true, wars: await state(ctx, pid, Number(params.get('cid') || 0)) };
        assert(['create','accept','decline','respond','replace','cancel','join'].includes(action), 'invalid_action');
        const rid = params.get('rid'); assert(UUID.test(rid || ''), 'invalid_request_id');
        let data;
        try { data = JSON.parse(params.get('data') || '{}'); } catch { fail('invalid_data'); }
        assert(data && typeof data === 'object' && !Array.isArray(data), 'invalid_data');
        const hash = fingerprint({ action, data });
        const prior = (await ctx.db.query('SELECT fingerprint,response FROM clan_war_operations WHERE actor_id=$1 AND request_id=$2', [pid, rid])).rows[0];
        if (prior) {
          assert(prior.fingerprint === hash, 'request_id_conflict');
          if (!prior.response.result) return prior.response;
          // The operation's outcome is immutable, its old private snapshot is
          // not an authorization grant. Rebuild it for today's membership and
          // revisions. Join is a read capability and must also be revalidated.
          const join = action === 'join' ? freshJoin(ctx, pid, data.warId) : null;
          return { result: true, wars: await state(ctx, pid), ...(join ? { join } : {}) };
        }
        await ctx.db.query('SAVEPOINT war_mutation');
        try {
        let war; let join;
        if (action === 'create') {
          validateCreate(data, ctx.now, maps);
          const own = clanFor(ctx, pid); assert(own, 'clan_required'); owner(ctx, pid, Number(own.id));
          const other = ctx.clans.find(c => Number(c.id) === data.opponentClanId); assert(other && Number(other.id) !== Number(own.id), 'invalid_opponent');
          const side = c => ({ clanId: Number(c.id), name: c.name, tag: c.tag, players: [] });
          war = { id: randomUUID(), revision: 0, status: 'preparing', map: data.map, scheduledAt: iso(time(data.scheduledAt)),
            lockAt: iso(time(data.scheduledAt) - 10 * MINUTE), gatherUntil: iso(time(data.scheduledAt) + 5 * MINUTE),
            durationMinutes: data.durationMinutes, challenger: side(own), defender: side(other), score: [0, 0], ratingDelta: 0, rated: false };
          war.challenger.players = roster(ctx, war.challenger.clanId, data.playerIds);
          checkOverlap(ctx, war); ctx.wars.push(war);
        } else {
          assert(UUID.test(data.warId || ''), 'invalid_war_id');
          war = ctx.wars.find(w => w.id === data.warId); assert(war && !TERMINAL.has(war.status), 'war_not_active');
          const side = sides(war).find(s => memberOf(ctx, pid, s.clanId));
          assert(side || (action === 'join' && war.status === 'running' && sides(war).some(s => active(s).some(p => p.playerId === pid))), 'not_in_war');
          assert(war.status !== 'preparing' || side === war.challenger, 'challenge_not_sent');
          if (action === 'join') {
            join = freshJoin(ctx, pid, war.id);
          } else {
            assert(data.revision === war.revision, 'revision_conflict');
            assert(ctx.now < time(war.lockAt), 'roster_locked');
            if (action === 'respond') {
              const player = active(side).find(p => p.playerId === pid);
              assert(player && player.status === 'pending' && typeof data.accept === 'boolean', 'invitation_not_pending');
              player.status = data.accept ? 'accepted' : 'declined';
            } else {
              owner(ctx, pid, side.clanId);
              if (action === 'accept') {
                assert(side === war.defender && war.status === 'challenged', 'challenge_not_pending');
                war.defender.players = roster(ctx, side.clanId, data.playerIds); war.status = 'assembling';
              } else if (action === 'decline') {
                assert(side === war.defender && war.status === 'challenged', 'challenge_not_pending');
                terminal(war, 'cancelled', 'challenge_declined', ctx.now);
              } else if (action === 'cancel') terminal(war, 'cancelled', 'owner_cancelled', ctx.now);
              else if (action === 'replace') {
                const old = side.players.find(p => p.playerId === data.oldPlayerId && p.status !== 'replaced');
                assert(old && !active(side).some(p => p.playerId === data.newPlayerId), 'invalid_replacement');
                assert(Number.isSafeInteger(data.newPlayerId) && memberOf(ctx, data.newPlayerId, side.clanId), 'player_not_in_clan');
                const m = ctx.members.find(m => Number(m.player_id) === data.newPlayerId && Number(m.clan_id) === side.clanId);
                old.status = 'replaced'; old.ready = false; old.presence = 'offline';
                side.players.push({ playerId: data.newPlayerId, name: m.name, status: 'pending', ready: false, presence: 'offline' });
                if (war.status === 'scheduled') war.status = 'assembling';
              }
            }
            if (war.status === 'preparing' && accepted(war.challenger)) war.status = 'challenged';
            if (war.status === 'assembling' && sides(war).every(accepted)) war.status = 'scheduled';
            if (!TERMINAL.has(war.status)) checkOverlap(ctx, war);
          }
        }
        if (action !== 'join') await save(ctx, war);
        const response = { result: true, wars: await state(ctx, pid), ...(join ? { join } : {}) };
        await ctx.db.query('INSERT INTO clan_war_operations(actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4::jsonb)', [pid, rid, hash, JSON.stringify(response)]);
        return response;
        } catch (error) {
          if (!error.public) throw error;
          await ctx.db.query('ROLLBACK TO SAVEPOINT war_mutation');
          const response = { result: false, error: error.code, message: error.message };
          await ctx.db.query('INSERT INTO clan_war_operations(actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4::jsonb)', [pid, rid, hash, JSON.stringify(response)]);
          return response;
        }
      });
    } catch (error) {
      if (!error.public) log.error('[clan-wars] ajax failed', error);
      return { result: false, error: error.code && error.public ? error.code : 'clan_wars_unavailable', message: error.public ? error.message : 'Клановые войны временно недоступны' };
    }
  }
  function verifyService(body) {
    assert(endpoint && body.serverId === endpoint.serverId && body.host === endpoint.host && Number(body.port) === endpoint.port, 'invalid_server_identity');
    assert(UUID.test(body.bootId || ''), 'invalid_boot_id');
  }
  async function service(body) {
    try {
      verifyService(body);
      return await transaction(async ctx => {
        if (body.action === 'poll') {
          assert(Array.isArray(body.maps), 'invalid_maps');
          const assignments = [];
          for (const war of ctx.wars) {
            if (!['locked','gathering','running'].includes(war.status) || !body.maps.includes(war.map) || !maps.some(m => m.id === war.map)) continue;
            if (war.server && war.server.bootId !== body.bootId) {
              // Never replay a live attempt after a process restart. Preserve its
              // fencing identity for durable outbox reconciliation.
              if (war.status === 'running') continue;
              if (time(war.server.leaseUntil) >= ctx.now) continue;
              terminal(war, 'cancelled', 'battle_restarted', ctx.now); await save(ctx, war); continue;
            }
            if (!war.server) {
              war.attemptId = randomUUID(); war.roomName = `ClanWar:${war.id}:${war.attemptId}`;
              war.server = { ...endpoint, bootId: body.bootId, leaseUntil: iso(ctx.now + 30000) };
              await save(ctx, war);
            }
            assignments.push(clone(war));
          }
          const terminalRows = await ctx.db.query(`SELECT data FROM clan_wars WHERE status IN ('completed','cancelled','forfeit')
            AND updated_at > now() - interval '10 minutes' AND data->'server'->>'bootId'=$1`, [body.bootId]);
          assignments.push(...terminalRows.rows.map(r => r.data));
          return { ok: true, serverNow: iso(ctx.now), assignments, leaseSeconds: 30 };
        }
        assert(['heartbeat','start','result'].includes(body.action), 'invalid_action');
        assert(UUID.test(body.warId || '') && UUID.test(body.attemptId || ''), 'invalid_attempt');
        const row = (await ctx.db.query('SELECT data FROM clan_wars WHERE id=$1', [body.warId])).rows[0];
        assert(row, 'war_not_found');
        const war = row.data;
        assert(war.attemptId === body.attemptId && war.server?.bootId === body.bootId && war.server?.serverId === body.serverId, 'attempt_fenced');
        if (body.action === 'result') return finish(ctx, war, body);
        if (TERMINAL.has(war.status)) return { ok: false, error: 'war_terminal', war: clone(war) };
        assert(ctx.now < time(war.server.leaseUntil), 'lease_expired');
        assert(Array.isArray(body.readyPlayerIds) && body.readyPlayerIds.length <= 10 && body.readyPlayerIds.every(Number.isSafeInteger), 'invalid_ready_players');
        // A member can become ineligible between two heartbeats. Accept that
        // known actor ID but clear readiness below, so battle receives the new
        // admission list instead of losing its lease to a stale readiness list.
        const allowed = sides(war).flatMap(s => s.players.filter(p => p.status !== 'replaced').map(p => p.playerId));
        assert(body.readyPlayerIds.every(id => allowed.includes(id)), 'invalid_ready_players');
        const connected = body.connectedPlayerIds === undefined ? body.readyPlayerIds : body.connectedPlayerIds;
        assert(Array.isArray(connected) && connected.length <= 10 && connected.every(id => Number.isSafeInteger(id) && allowed.includes(id)), 'invalid_connected_players');
        assert(body.readyPlayerIds.every(id => connected.includes(id)), 'ready_player_not_connected');
        war.server.leaseUntil = iso(ctx.now + 30000);
        sides(war).forEach(s => s.players.forEach(p => {
          const eligible = p.status === 'accepted';
          p.ready = eligible && body.readyPlayerIds.includes(p.playerId);
          p.presence = p.ready ? 'ready' : eligible && connected.includes(p.playerId) ? 'connecting' :
            p.presence && p.presence !== 'offline' ? 'disconnected' : 'offline';
        }));
        if (body.action === 'start' && war.status !== 'running') {
          assert(war.status === 'gathering' && ctx.now < time(war.gatherUntil), 'not_gathering');
          assert(sides(war).every(s => accepted(s) && active(s).every(p => p.ready)), 'ten_loaded_players_required');
          war.status = 'running'; war.startAt = iso(ctx.now + 5000); war.endAt = iso(ctx.now + 5000 + war.durationMinutes * MINUTE);
        }
        if (war.status === 'running' && body.score !== undefined) {
          validateScore(body.score); assert(body.score.every((n, i) => n >= war.score[i]), 'score_regression'); war.score = body.score;
        }
        await save(ctx, war);
        return { ok: true, war: clone(war), leaseSeconds: 30 };
      });
    } catch (error) {
      if (!error.public) log.error('[clan-wars] service failed', error);
      return { ok: false, error: error.public ? error.code : 'clan_wars_unavailable' };
    }
  }
  function validateScore(score) { assert(Array.isArray(score) && score.length === 2 && score.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000), 'invalid_score'); }
  async function finish(ctx, war, body) {
    assert(UUID.test(body.resultId || ''), 'invalid_result_id'); validateScore(body.score);
    const hash = fingerprint({ warId: body.warId, attemptId: body.attemptId, score: body.score, resultId: body.resultId });
    const prior = (await ctx.db.query('SELECT fingerprint FROM clan_war_results WHERE war_id=$1 OR result_id=$2', [war.id, body.resultId])).rows;
    if (prior.length) { assert(prior.length === 1 && prior[0].fingerprint === hash, 'result_conflict'); return { ok: true, ack: true, warId: war.id, resultId: body.resultId }; }
    const recoverable = war.status === 'cancelled' && war.reason === 'result_reconciliation_timeout';
    assert(war.status === 'running' || recoverable, 'war_not_running');
    // The boot/attempt fence was checked by service(). Only this technical
    // cancellation can be superseded by a durable result: never a no-show,
    // leader cancellation, different attempt or match that did not start.
    assert(Number.isFinite(time(war.startAt)) && Number.isFinite(time(war.endAt)) &&
      time(war.endAt) - time(war.startAt) === war.durationMinutes * MINUTE, 'invalid_match_clock');
    assert(ctx.now >= time(war.endAt), 'match_not_finished');
    assert(body.score.every((n, i) => n >= war.score[i]), 'score_regression');
    const pair = ids(war).sort((a, b) => a - b).join(':');
    // Eligibility follows match-end chronology, not result delivery order.
    // UUID is a deterministic tie-breaker (normal scheduling prevents equal
    // end times for this pair). A draw also consumes the chronological slot.
    const previous = await ctx.db.query(`SELECT 1 FROM clan_war_results WHERE pair_key=$1
      AND finished_at > $2::timestamptz - interval '24 hours'
      AND (finished_at,war_id) < ($2::timestamptz,$3::uuid) LIMIT 1`, [pair, war.endAt, war.id]);
    const rated = previous.rowCount === 0;
    const winner = body.score[0] === body.score[1] ? null : body.score[0] > body.score[1] ? war.challenger.clanId : war.defender.clanId;
    terminal(war, 'completed', !winner ? 'draw' : rated ? 'victory' : 'pair_cooldown', ctx.now);
    war.score = body.score; war.rated = rated; war.winnerClanId = winner || 0; war.ratingDelta = winner && rated ? 25 : 0;
    await ctx.db.query(`INSERT INTO clan_war_results(war_id,result_id,attempt_id,fingerprint,pair_key,finished_at,rated,winner_clan_id,score)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [war.id, body.resultId, war.attemptId, hash, pair, war.endAt, rated, winner, JSON.stringify(body.score)]);
    if (winner) await ctx.db.query(`INSERT INTO clan_war_ratings(clan_id,rating,wins) VALUES($1,$2,1)
      ON CONFLICT(clan_id) DO UPDATE SET rating=clan_war_ratings.rating+excluded.rating,wins=clan_war_ratings.wins+1,updated_at=now()`, [winner, war.ratingDelta]);
    // Inserting an earlier completion can only REMOVE eligibility from later
    // results within 24h; results outside that window cannot be affected. This
    // indexed, bounded-window repair runs under the same coordinator lock and
    // transaction as the new receipt, so rating/history never disagree. It is
    // not a full-history recomputation. Wins count actual victories, so only
    // awarded rating changes during repair.
    const displaced = await ctx.db.query(`SELECT r.war_id,r.winner_clan_id,w.data
      FROM clan_war_results r JOIN clan_wars w ON w.id=r.war_id
      WHERE r.pair_key=$1 AND r.rated=true
      AND (r.finished_at,r.war_id) > ($2::timestamptz,$3::uuid)
      AND r.finished_at < $2::timestamptz + interval '24 hours'
      ORDER BY r.finished_at,r.war_id`, [pair, war.endAt, war.id]);
    for (const result of displaced.rows) {
      if (result.winner_clan_id) {
        const corrected = await ctx.db.query(`UPDATE clan_war_ratings SET rating=rating-25,updated_at=now()
          WHERE clan_id=$1 AND rating>=25 RETURNING clan_id`, [result.winner_clan_id]);
        if (corrected.rowCount !== 1) throw new Error('clan_war_rating_ledger_mismatch');
      }
      await ctx.db.query('UPDATE clan_war_results SET rated=false WHERE war_id=$1', [result.war_id]);
      const later = result.data;
      later.rated = false; later.ratingDelta = 0; later.winnerClanId = Number(result.winner_clan_id || 0);
      later.reason = result.winner_clan_id ? 'pair_cooldown' : 'draw';
      await save(ctx, later);
    }
    await save(ctx, war);
    return { ok: true, ack: true, warId: war.id, resultId: body.resultId };
  }
  return { ajax, service, isEnabled };
}
