import crypto from "node:crypto";

const ROSTER_MAIN_COUNT = 5;
const ROSTER_RESERVE_COUNT = 2;
const ROSTER_SIZE = ROSTER_MAIN_COUNT + ROSTER_RESERVE_COUNT;
const CHECKIN_OPEN_MS = 15 * 60 * 1000;
const CHECKIN_LOCK_MS = 5 * 60 * 1000;
const CHECKIN_FORFEIT_MS = 5 * 60 * 1000;
const CUP_CAPACITIES = new Set([4, 8, 16, 32, 64]);
const ADMIN_ROLES = new Set(["owner", "developer"]);

function ok(payload = {}) {
  return { result: true, ok: true, ...payload };
}

function fail(error, status = 400) {
  return { result: false, ok: false, error, status };
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function integerList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const parsed = values.map((entry) => integer(entry, 1)).filter((entry) => entry !== null);
  return parsed.length === new Set(parsed).size ? parsed : [];
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  const milliseconds = Number.isFinite(numeric) && /^\d{10,13}$/.test(raw)
    ? (raw.length === 10 ? numeric * 1000 : numeric)
    : Date.parse(raw);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

function roundDate(cup, roundIndex) {
  return new Date(new Date(cup.starts_at).getTime() + (roundIndex - 1) * Number(cup.round_interval_minutes) * 60 * 1000);
}

function cupPayload(cup) {
  if (!cup) return null;
  return {
    id: Number(cup.id),
    number: Number(cup.cup_number),
    state: String(cup.state),
    maxClans: Number(cup.max_clans),
    map: String(cup.map_name),
    mode: String(cup.mode),
    scoreLimit: Number(cup.score_limit),
    matchDurationSeconds: Number(cup.match_duration_seconds),
    roundIntervalMinutes: Number(cup.round_interval_minutes),
    registrationOpensAt: new Date(cup.registration_opens_at).toISOString(),
    registrationClosesAt: new Date(cup.registration_closes_at).toISOString(),
    startsAt: new Date(cup.starts_at).toISOString(),
    rewardAmount: Number(cup.reward_amount),
  };
}

function matchPayload(row) {
  return {
    id: Number(row.id),
    round: Number(row.round_index),
    slot: Number(row.slot_index),
    state: String(row.state),
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    checkinOpensAt: new Date(row.checkin_opens_at).toISOString(),
    checkinLocksAt: new Date(row.checkin_locks_at).toISOString(),
    scoreA: row.score_a === null ? null : Number(row.score_a),
    scoreB: row.score_b === null ? null : Number(row.score_b),
    resultKind: row.result_kind || "",
    entryA: row.entry_a_id ? {
      id: Number(row.entry_a_id), clanId: Number(row.clan_a_id), name: String(row.clan_a_name || ""), tag: String(row.clan_a_tag || ""),
    } : null,
    entryB: row.entry_b_id ? {
      id: Number(row.entry_b_id), clanId: Number(row.clan_b_id), name: String(row.clan_b_name || ""), tag: String(row.clan_b_tag || ""),
    } : null,
    winnerEntryId: row.winner_entry_id ? Number(row.winner_entry_id) : 0,
  };
}

function currentMs() {
  return Date.now();
}

function randomRoomName(cupId, matchId) {
  return `clancup-${Number(cupId)}-${Number(matchId)}-${crypto.randomBytes(8).toString("hex")}`;
}

export function createClanCupSystem({ getPool, loadRole, audit }) {
  let lifecycleTickPending = false;

  function pool() {
    return getPool?.() || null;
  }

  async function activeCup(client, lock = false) {
    const result = await client.query(
      `SELECT * FROM clan_cups
       WHERE state IN ('draft', 'registration', 'locked', 'live', 'paused')
       ORDER BY id DESC
       LIMIT 1${lock ? " FOR UPDATE" : ""}`
    );
    return result.rows[0] || null;
  }

  async function currentCup(client) {
    const result = await client.query("SELECT * FROM clan_cups ORDER BY id DESC LIMIT 1");
    return result.rows[0] || null;
  }

  async function membership(client, playerId) {
    const result = await client.query(
      `SELECT cm.clan_id, cm.role, c.owner_player_id, c.name, c.tag
       FROM clan_members cm
       JOIN clans c ON c.id = cm.clan_id AND c.deleted_at IS NULL
       WHERE cm.player_id = $1
       LIMIT 1`,
      [Number(playerId)]
    );
    const row = result.rows[0] || null;
    if (!row) return null;
    return {
      clanId: Number(row.clan_id),
      role: String(row.role || "member"),
      name: String(row.name || ""),
      tag: String(row.tag || ""),
      isOwner: Number(row.owner_player_id) === Number(playerId),
    };
  }

  async function entryForClan(client, cupId, clanId, lock = false) {
    const result = await client.query(
      `SELECT * FROM clan_cup_entries
       WHERE cup_id = $1 AND clan_id = $2 AND withdrawn_at IS NULL
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [Number(cupId), Number(clanId)]
    );
    return result.rows[0] || null;
  }

  async function entryPlayers(client, entryId) {
    const result = await client.query(
      `SELECT ep.player_id, ep.roster_role, p.name, p.level
       FROM clan_cup_entry_players ep
       JOIN players p ON p.id = ep.player_id
       WHERE ep.entry_id = $1
       ORDER BY CASE ep.roster_role WHEN 'main' THEN 0 ELSE 1 END, ep.player_id`,
      [Number(entryId)]
    );
    return result.rows.map((row) => ({
      playerId: Number(row.player_id), name: String(row.name || ""), level: Number(row.level || 1), role: String(row.roster_role),
    }));
  }

  async function seedMatchPlayers(client, matchId, entryId) {
    if (!entryId) return;
    await client.query(
      `INSERT INTO clan_cup_match_players (match_id, entry_id, player_id, is_active)
       SELECT $1, ep.entry_id, ep.player_id, ep.roster_role = 'main'
       FROM clan_cup_entry_players ep
       WHERE ep.entry_id = $2
       ON CONFLICT (match_id, entry_id, player_id) DO NOTHING`,
      [Number(matchId), Number(entryId)]
    );
  }

  async function attachWinner(client, match, winnerEntryId) {
    if (!match.next_match_id || !winnerEntryId) return;
    const column = Number(match.next_match_slot) === 1 ? "entry_a_id" : "entry_b_id";
    const result = await client.query(
      `UPDATE clan_cup_matches
       SET ${column} = $2
       WHERE id = $1 AND ${column} IS NULL
       RETURNING id`,
      [Number(match.next_match_id), Number(winnerEntryId)]
    );
    if (result.rows[0]) await seedMatchPlayers(client, match.next_match_id, winnerEntryId);
  }

  async function completeMatch(client, match, winnerEntryId, resultKind, scoreA = null, scoreB = null) {
    const updated = await client.query(
      `UPDATE clan_cup_matches
       SET state = 'completed', winner_entry_id = $2, result_kind = $3,
           score_a = $4, score_b = $5, completed_at = now()
       WHERE id = $1 AND state <> 'completed'
       RETURNING *`,
      [Number(match.id), winnerEntryId || null, String(resultKind), scoreA, scoreB]
    );
    const committed = updated.rows[0] || null;
    if (committed?.winner_entry_id) await attachWinner(client, committed, Number(committed.winner_entry_id));
    return committed;
  }

  async function reconcileByes(client, cupId) {
    let changed = true;
    while (changed) {
      changed = false;
      const result = await client.query(
        `SELECT * FROM clan_cup_matches WHERE cup_id = $1 ORDER BY round_index, slot_index FOR UPDATE`,
        [Number(cupId)]
      );
      const matches = result.rows;
      const childrenByNext = new Map();
      for (const child of matches) {
        if (!child.next_match_id) continue;
        const list = childrenByNext.get(Number(child.next_match_id)) || [];
        list.push(child);
        childrenByNext.set(Number(child.next_match_id), list);
      }
      for (const match of matches) {
        if (match.state === "completed") continue;
        const children = childrenByNext.get(Number(match.id)) || [];
        const inputsSettled = Number(match.round_index) === 1 || (children.length === 2 && children.every((child) => child.state === "completed"));
        if (!inputsSettled) continue;
        const entryA = Number(match.entry_a_id || 0);
        const entryB = Number(match.entry_b_id || 0);
        if (entryA && !entryB) {
          if (await completeMatch(client, match, entryA, "bye")) changed = true;
        } else if (!entryA && entryB) {
          if (await completeMatch(client, match, entryB, "bye")) changed = true;
        } else if (!entryA && !entryB) {
          if (await completeMatch(client, match, null, "double_bye")) changed = true;
        }
      }
    }
  }

  async function awardCupWinner(client, cup) {
    const finalResult = await client.query(
      `SELECT winner_entry_id
       FROM clan_cup_matches
       WHERE cup_id = $1
       ORDER BY round_index DESC, slot_index ASC
       LIMIT 1
       FOR UPDATE`,
      [Number(cup.id)]
    );
    const winnerEntryId = Number(finalResult.rows[0]?.winner_entry_id || 0);
    if (!winnerEntryId) return false;
    const players = await client.query(
      `SELECT player_id
       FROM clan_cup_entry_players
       WHERE entry_id = $1
       ORDER BY player_id`,
      [winnerEntryId]
    );
    if (players.rows.length !== ROSTER_SIZE) return false;
    const reward = Number(cup.reward_amount || 0);
    const base = Math.floor(reward / ROSTER_SIZE);
    const remainder = reward % ROSTER_SIZE;
    for (let index = 0; index < players.rows.length; index += 1) {
      const playerId = Number(players.rows[index].player_id);
      const amount = base + (index < remainder ? 1 : 0);
      const inserted = await client.query(
        `INSERT INTO clan_cup_awards (cup_id, player_id, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (cup_id, player_id) DO NOTHING
         RETURNING player_id`,
        [Number(cup.id), playerId, amount]
      );
      if (inserted.rows[0]) {
        await client.query("UPDATE players SET money = money + $2, updated_at = now() WHERE id = $1", [playerId, amount]);
      }
    }
    await client.query("UPDATE clan_cups SET state = 'completed', completed_at = now(), updated_at = now() WHERE id = $1", [Number(cup.id)]);
    return true;
  }

  async function maybeCompleteCup(client, cup) {
    if (!cup || !["locked", "live"].includes(String(cup.state))) return;
    const result = await client.query(
      `SELECT state, winner_entry_id FROM clan_cup_matches WHERE cup_id = $1 ORDER BY round_index DESC, slot_index ASC LIMIT 1`,
      [Number(cup.id)]
    );
    if (result.rows[0]?.state !== "completed") return;
    if (Number(result.rows[0]?.winner_entry_id || 0)) {
      await awardCupWinner(client, cup);
    } else {
      await client.query("UPDATE clan_cups SET state='completed', completed_at=now(), updated_at=now() WHERE id=$1 AND state IN ('locked','live')", [Number(cup.id)]);
    }
  }

  async function buildBracket(client, cup) {
    const present = await client.query("SELECT 1 FROM clan_cup_matches WHERE cup_id = $1 LIMIT 1", [Number(cup.id)]);
    if (present.rows.length) return;
    const entriesResult = await client.query(
      `SELECT * FROM clan_cup_entries
       WHERE cup_id = $1 AND withdrawn_at IS NULL
       ORDER BY seed, id`,
      [Number(cup.id)]
    );
    const entries = entriesResult.rows;
    const bracketSize = Number(cup.max_clans);
    const rounds = Math.log2(bracketSize);
    const idsByRound = new Map();
    for (let round = 1; round <= rounds; round += 1) {
      const matchesInRound = bracketSize / (2 ** round);
      const ids = [];
      const scheduledAt = roundDate(cup, round);
      for (let slot = 1; slot <= matchesInRound; slot += 1) {
        const entryA = round === 1 ? entries[(slot - 1) * 2]?.id || null : null;
        const entryB = round === 1 ? entries[(slot - 1) * 2 + 1]?.id || null : null;
        const inserted = await client.query(
          `INSERT INTO clan_cup_matches (
             cup_id, round_index, slot_index, entry_a_id, entry_b_id,
             scheduled_at, checkin_opens_at, checkin_locks_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [
            Number(cup.id), round, slot, entryA, entryB, scheduledAt,
            new Date(scheduledAt.getTime() - CHECKIN_OPEN_MS),
            new Date(scheduledAt.getTime() - CHECKIN_LOCK_MS),
          ]
        );
        const matchId = Number(inserted.rows[0].id);
        ids.push(matchId);
        if (entryA) await seedMatchPlayers(client, matchId, entryA);
        if (entryB) await seedMatchPlayers(client, matchId, entryB);
      }
      idsByRound.set(round, ids);
    }
    for (let round = 1; round < rounds; round += 1) {
      const ids = idsByRound.get(round) || [];
      const nextIds = idsByRound.get(round + 1) || [];
      for (let index = 0; index < ids.length; index += 1) {
        await client.query(
          "UPDATE clan_cup_matches SET next_match_id = $2, next_match_slot = $3 WHERE id = $1",
          [ids[index], nextIds[Math.floor(index / 2)], index % 2 === 0 ? 1 : 2]
        );
      }
    }
    await reconcileByes(client, cup.id);
  }

  async function resolveExpiredCheckins(client, cup) {
    const due = await client.query(
      `SELECT * FROM clan_cup_matches
       WHERE cup_id = $1 AND state = 'scheduled' AND scheduled_at + interval '5 minutes' <= now()
       FOR UPDATE`,
      [Number(cup.id)]
    );
    for (const match of due.rows) {
      const counts = await client.query(
        `SELECT entry_id,
                COUNT(*) FILTER (WHERE is_active)::int AS active_count,
                COUNT(*) FILTER (WHERE is_active AND checked_in_at IS NOT NULL)::int AS ready_count
         FROM clan_cup_match_players
         WHERE match_id = $1 AND entry_id IN ($2, $3)
         GROUP BY entry_id`,
        [Number(match.id), Number(match.entry_a_id || 0), Number(match.entry_b_id || 0)]
      );
      const byEntry = new Map(counts.rows.map((row) => [Number(row.entry_id), Number(row.ready_count) === ROSTER_MAIN_COUNT && Number(row.active_count) === ROSTER_MAIN_COUNT]));
      const aReady = Boolean(byEntry.get(Number(match.entry_a_id || 0)));
      const bReady = Boolean(byEntry.get(Number(match.entry_b_id || 0)));
      if (aReady && !bReady) await completeMatch(client, match, Number(match.entry_a_id), "forfeit", 30, 0);
      else if (!aReady && bReady) await completeMatch(client, match, Number(match.entry_b_id), "forfeit", 0, 30);
      else if (!aReady && !bReady) await completeMatch(client, match, null, "double_forfeit");
    }
    await reconcileByes(client, cup.id);
  }

  async function advanceLifecycle(client) {
    let cup = await activeCup(client, true);
    if (!cup || cup.state === "paused") return cup;
    const now = currentMs();
    if (cup.state === "draft" && now >= new Date(cup.registration_opens_at).getTime()) {
      await client.query("UPDATE clan_cups SET state = 'registration', updated_at = now() WHERE id = $1", [Number(cup.id)]);
      cup = { ...cup, state: "registration" };
    }
    if (["draft", "registration"].includes(cup.state) && now >= new Date(cup.registration_closes_at).getTime()) {
      await client.query("UPDATE clan_cups SET state = 'locked', updated_at = now() WHERE id = $1", [Number(cup.id)]);
      cup = { ...cup, state: "locked" };
      await buildBracket(client, cup);
    }
    if (cup.state === "locked" && now >= new Date(cup.starts_at).getTime()) {
      await client.query("UPDATE clan_cups SET state = 'live', updated_at = now() WHERE id = $1", [Number(cup.id)]);
      cup = { ...cup, state: "live" };
    }
    if (cup.state === "live") {
      await resolveExpiredCheckins(client, cup);
      await maybeCompleteCup(client, cup);
    }
    return (await currentCup(client)) || cup;
  }

  async function publicState(client, cup, account) {
    if (!cup) return ok({ cup: null, message: "Ожидайте клановую войну", entries: [], matches: [], membership: null, entry: null, myMatches: [] });
    const playerId = Number(account.id);
    const member = await membership(client, playerId);
    const entriesResult = await client.query(
      `SELECT e.id, e.clan_id, e.seed, c.name, c.tag
       FROM clan_cup_entries e
       JOIN clans c ON c.id = e.clan_id
       WHERE e.cup_id = $1 AND e.withdrawn_at IS NULL
       ORDER BY e.seed, e.id`,
      [Number(cup.id)]
    );
    const matchesResult = await client.query(
      `SELECT m.*,
              ea.clan_id AS clan_a_id, ca.name AS clan_a_name, ca.tag AS clan_a_tag,
              eb.clan_id AS clan_b_id, cb.name AS clan_b_name, cb.tag AS clan_b_tag
       FROM clan_cup_matches m
       LEFT JOIN clan_cup_entries ea ON ea.id = m.entry_a_id
       LEFT JOIN clans ca ON ca.id = ea.clan_id
       LEFT JOIN clan_cup_entries eb ON eb.id = m.entry_b_id
       LEFT JOIN clans cb ON cb.id = eb.clan_id
       WHERE m.cup_id = $1
       ORDER BY m.round_index, m.slot_index`,
      [Number(cup.id)]
    );
    let ownEntry = null;
    let roster = [];
    let myMatches = [];
    let clanMembers = [];
    if (member) {
      const clanMemberRows = await client.query(
        `SELECT p.id, p.name, p.level
         FROM clan_members cm
         JOIN players p ON p.id = cm.player_id
         WHERE cm.clan_id = $1
         ORDER BY p.name, p.id`,
        [Number(member.clanId)]
      );
      clanMembers = clanMemberRows.rows.map((row) => ({ playerId: Number(row.id), name: String(row.name || ""), level: Number(row.level || 1) }));
      ownEntry = await entryForClan(client, cup.id, member.clanId);
      if (ownEntry) {
        roster = await entryPlayers(client, ownEntry.id);
        const ownMatchRows = matchesResult.rows.filter((row) => Number(row.entry_a_id) === Number(ownEntry.id) || Number(row.entry_b_id) === Number(ownEntry.id));
        for (const match of ownMatchRows) {
          const players = await client.query(
            `SELECT mp.player_id, mp.is_active, mp.checked_in_at, p.name
             FROM clan_cup_match_players mp
             JOIN players p ON p.id = mp.player_id
             WHERE mp.match_id = $1 AND mp.entry_id = $2
             ORDER BY mp.is_active DESC, p.name`,
            [Number(match.id), Number(ownEntry.id)]
          );
          myMatches.push({
            ...matchPayload(match),
            canSetLineup: member.isOwner && match.state === "scheduled" && currentMs() < new Date(match.checkin_locks_at).getTime(),
            players: players.rows.map((row) => ({ playerId: Number(row.player_id), name: String(row.name), active: Boolean(row.is_active), checkedIn: Boolean(row.checked_in_at) })),
          });
        }
      }
    }
    return ok({
      cup: cupPayload(cup),
      playerId,
      message: cup.state === "draft" ? "Регистрация ещё не открыта" : "",
      entries: entriesResult.rows.map((row) => ({ id: Number(row.id), clanId: Number(row.clan_id), seed: Number(row.seed), name: String(row.name), tag: String(row.tag) })),
      matches: matchesResult.rows.map(matchPayload),
      membership: member ? { clanId: member.clanId, name: member.name, tag: member.tag, isOwner: member.isOwner } : null,
      clanMembers,
      entry: ownEntry ? { id: Number(ownEntry.id), roster, canManage: member.isOwner && cup.state === "registration" } : null,
      myMatches,
    });
  }

  function parseRoster(params) {
    const main = integerList(params.get("main") || params.get("players") || "");
    const reserve = integerList(params.get("reserve") || params.get("reserves") || "");
    if (main.length !== ROSTER_MAIN_COUNT || reserve.length !== ROSTER_RESERVE_COUNT) return null;
    const all = [...main, ...reserve];
    return new Set(all).size === ROSTER_SIZE ? { main, reserve } : null;
  }

  async function register(account, params) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    const roster = parseRoster(params);
    if (!roster) return fail("roster_must_contain_5_main_and_2_reserves");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      if (!cup || cup.state !== "registration") {
        await client.query("ROLLBACK");
        return fail("registration_closed", 409);
      }
      const member = await membership(client, account.id);
      if (!member) {
        await client.query("ROLLBACK");
        return fail("clan_required", 403);
      }
      if (!member.isOwner) {
        await client.query("ROLLBACK");
        return fail("clan_owner_required", 403);
      }
      const existing = await entryForClan(client, cup.id, member.clanId, true);
      if (!existing) {
        const count = await client.query("SELECT COUNT(*)::int AS count FROM clan_cup_entries WHERE cup_id = $1 AND withdrawn_at IS NULL", [Number(cup.id)]);
        if (Number(count.rows[0]?.count || 0) >= Number(cup.max_clans)) {
          await client.query("ROLLBACK");
          return fail("cup_full", 409);
        }
      }
      const ids = [...roster.main, ...roster.reserve];
      const memberRows = await client.query(
        "SELECT player_id FROM clan_members WHERE clan_id = $1 AND player_id = ANY($2::int[])",
        [member.clanId, ids]
      );
      if (memberRows.rows.length !== ROSTER_SIZE) {
        await client.query("ROLLBACK");
        return fail("roster_player_not_in_clan", 409);
      }
      const duplicate = await client.query(
        `SELECT ep.player_id
         FROM clan_cup_entry_players ep
         JOIN clan_cup_entries e ON e.id = ep.entry_id
         WHERE ep.cup_id = $1 AND ep.player_id = ANY($2::int[])
           AND e.withdrawn_at IS NULL AND e.clan_id <> $3
         LIMIT 1`,
        [Number(cup.id), ids, member.clanId]
      );
      if (duplicate.rows[0]) {
        await client.query("ROLLBACK");
        return fail("roster_player_registered_for_another_clan", 409);
      }
      let entry = existing;
      if (!entry) {
        const inserted = await client.query(
          `INSERT INTO clan_cup_entries (cup_id, clan_id, registered_by_player_id, seed)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [Number(cup.id), member.clanId, Number(account.id), crypto.randomInt(1, 2147483647)]
        );
        entry = inserted.rows[0];
      }
      await client.query("DELETE FROM clan_cup_entry_players WHERE entry_id = $1", [Number(entry.id)]);
      for (const playerId of roster.main) {
        await client.query("INSERT INTO clan_cup_entry_players (entry_id, cup_id, player_id, roster_role) VALUES ($1,$2,$3,'main')", [Number(entry.id), Number(cup.id), playerId]);
      }
      for (const playerId of roster.reserve) {
        await client.query("INSERT INTO clan_cup_entry_players (entry_id, cup_id, player_id, roster_role) VALUES ($1,$2,$3,'reserve')", [Number(entry.id), Number(cup.id), playerId]);
      }
      await client.query("COMMIT");
      await audit?.(db, { playerId: Number(account.id), clanId: member.clanId, eventType: "clan_cup_registration", category: "clan", severity: "notice", description: `Клан зарегистрирован в Кубок #${cup.cup_number}`, metadata: { cupId: Number(cup.id), entryId: Number(entry.id), roster: ids } });
      return ok({ entryId: Number(entry.id) });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] registration failed", error);
      return fail("clan_cup_registration_failed", 503);
    } finally {
      client.release();
    }
  }

  async function withdraw(account) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      if (!cup || cup.state !== "registration") {
        await client.query("ROLLBACK");
        return fail("registration_closed", 409);
      }
      const member = await membership(client, account.id);
      const entry = member ? await entryForClan(client, cup.id, member.clanId, true) : null;
      if (!member?.isOwner || !entry) {
        await client.query("ROLLBACK");
        return fail("clan_owner_required", 403);
      }
      await client.query("UPDATE clan_cup_entries SET withdrawn_at = now() WHERE id = $1", [Number(entry.id)]);
      await client.query("COMMIT");
      await audit?.(db, { playerId: Number(account.id), clanId: member.clanId, eventType: "clan_cup_withdraw", category: "clan", severity: "notice", description: `Клан снят с Кубка #${cup.cup_number}`, metadata: { cupId: Number(cup.id), entryId: Number(entry.id) } });
      return ok();
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] withdraw failed", error);
      return fail("clan_cup_withdraw_failed", 503);
    } finally {
      client.release();
    }
  }

  async function updateLineup(account, params) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    const matchId = integer(params.get("match") || params.get("matchId"), 1);
    const active = integerList(params.get("active") || params.get("players") || "");
    if (!matchId || active.length !== ROSTER_MAIN_COUNT) return fail("invalid_lineup");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      const member = await membership(client, account.id);
      const matchResult = await client.query("SELECT * FROM clan_cup_matches WHERE id = $1 FOR UPDATE", [matchId]);
      const match = matchResult.rows[0] || null;
      if (!cup || !member?.isOwner || !match || Number(match.cup_id) !== Number(cup.id) || match.state !== "scheduled" || currentMs() >= new Date(match.checkin_locks_at).getTime()) {
        await client.query("ROLLBACK");
        return fail("lineup_locked", 409);
      }
      const entry = await entryForClan(client, cup.id, member.clanId, true);
      if (!entry || ![Number(match.entry_a_id), Number(match.entry_b_id)].includes(Number(entry.id))) {
        await client.query("ROLLBACK");
        return fail("match_not_owned_by_clan", 403);
      }
      const valid = await client.query("SELECT player_id FROM clan_cup_entry_players WHERE entry_id = $1 AND player_id = ANY($2::int[])", [Number(entry.id), active]);
      if (valid.rows.length !== ROSTER_MAIN_COUNT) {
        await client.query("ROLLBACK");
        return fail("lineup_player_not_in_roster", 409);
      }
      await client.query("UPDATE clan_cup_match_players SET is_active = player_id = ANY($3::int[]), checked_in_at = NULL WHERE match_id = $1 AND entry_id = $2", [matchId, Number(entry.id), active]);
      await client.query("COMMIT");
      return ok();
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] lineup failed", error);
      return fail("clan_cup_lineup_failed", 503);
    } finally {
      client.release();
    }
  }

  async function checkin(account, params) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    const matchId = integer(params.get("match") || params.get("matchId"), 1);
    if (!matchId) return fail("invalid_match");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      const matchResult = await client.query("SELECT * FROM clan_cup_matches WHERE id = $1 FOR UPDATE", [matchId]);
      const match = matchResult.rows[0] || null;
      if (!cup || !match || Number(match.cup_id) !== Number(cup.id) || match.state !== "scheduled" || currentMs() < new Date(match.checkin_opens_at).getTime() || currentMs() >= new Date(match.scheduled_at).getTime() + CHECKIN_FORFEIT_MS) {
        await client.query("ROLLBACK");
        return fail("checkin_unavailable", 409);
      }
      const active = await client.query(
        `SELECT mp.entry_id, e.clan_id
         FROM clan_cup_match_players mp
         JOIN clan_cup_entries e ON e.id = mp.entry_id
         JOIN clan_members cm ON cm.clan_id = e.clan_id AND cm.player_id = mp.player_id
         WHERE mp.match_id = $1 AND mp.player_id = $2 AND mp.is_active
         LIMIT 1`,
        [matchId, Number(account.id)]
      );
      if (!active.rows[0]) {
        await client.query("ROLLBACK");
        return fail("player_not_in_active_lineup", 403);
      }
      await client.query("UPDATE clan_cup_match_players SET checked_in_at = now() WHERE match_id = $1 AND player_id = $2 AND is_active", [matchId, Number(account.id)]);
      await client.query("COMMIT");
      return ok({ matchId });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] checkin failed", error);
      return fail("clan_cup_checkin_failed", 503);
    } finally {
      client.release();
    }
  }

  async function playerAjax(account, act, params) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    if (act === "register") return register(account, params);
    if (act === "withdraw") return withdraw(account);
    if (act === "lineup") return updateLineup(account, params);
    if (act === "checkin") return checkin(account, params);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      const response = await publicState(client, cup, account);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] state failed", error);
      return fail("clan_cup_state_failed", 503);
    } finally {
      client.release();
    }
  }

  async function tick() {
    if (lifecycleTickPending) return false;
    const db = pool();
    if (!db) return false;
    lifecycleTickPending = true;
    let client = null;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      await advanceLifecycle(client);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      try { if (client) await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] lifecycle tick failed", error);
      return false;
    } finally {
      client?.release();
      lifecycleTickPending = false;
    }
  }

  async function requireAdmin(db, account) {
    const role = String(await loadRole?.(db, Number(account?.id || 0)) || "none");
    return ADMIN_ROLES.has(role) ? role : "";
  }

  async function adminAjax(account, act, params) {
    const db = pool();
    if (!db) return fail("postgres_required", 503);
    const role = await requireAdmin(db, account);
    if (!role) return fail("clan_cup_admin_required", 403);
    if (act === "cup_get" || act === "cup_state") return playerAjax(account, "state", params);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      let cup = await advanceLifecycle(client);
      if (act === "cup_create") {
        if (cup && ["draft", "registration", "locked", "live", "paused"].includes(cup.state)) {
          await client.query("ROLLBACK");
          return fail("active_cup_exists", 409);
        }
        const maxClans = integer(params.get("maxClans") || params.get("max_clans"), 4, 64);
        const rewardAmount = integer(params.get("rewardAmount") || params.get("reward"), 0, 100000000);
        const opens = parseDate(params.get("registrationOpensAt") || params.get("opens"));
        const closes = parseDate(params.get("registrationClosesAt") || params.get("closes"));
        const starts = parseDate(params.get("startsAt") || params.get("start"));
        if (!CUP_CAPACITIES.has(maxClans) || rewardAmount === null || !opens || !closes || !starts || closes <= opens || starts < closes) {
          await client.query("ROLLBACK");
          return fail("invalid_cup_settings");
        }
        const numberResult = await client.query("SELECT COALESCE(MAX(cup_number), 0)::int + 1 AS number FROM clan_cups");
        const inserted = await client.query(
          `INSERT INTO clan_cups (
             cup_number, state, max_clans, registration_opens_at, registration_closes_at, starts_at, reward_amount, created_by_player_id
           ) VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7) RETURNING *`,
          [Number(numberResult.rows[0].number), maxClans, opens, closes, starts, rewardAmount, Number(account.id)]
        );
        cup = inserted.rows[0];
      } else {
        if (!cup) {
          await client.query("ROLLBACK");
          return fail("cup_not_found", 404);
        }
        if (act === "cup_update") {
          if (!["draft", "registration", "paused"].includes(cup.state)) {
            await client.query("ROLLBACK");
            return fail("cup_settings_locked", 409);
          }
          const maxClans = integer(params.get("maxClans") || params.get("max_clans"), 4, 64);
          const rewardAmount = integer(params.get("rewardAmount") || params.get("reward"), 0, 100000000);
          const opens = parseDate(params.get("registrationOpensAt") || params.get("opens"));
          const closes = parseDate(params.get("registrationClosesAt") || params.get("closes"));
          const starts = parseDate(params.get("startsAt") || params.get("start"));
          const count = await client.query("SELECT COUNT(*)::int AS count FROM clan_cup_entries WHERE cup_id = $1 AND withdrawn_at IS NULL", [Number(cup.id)]);
          if (!CUP_CAPACITIES.has(maxClans) || rewardAmount === null || !opens || !closes || !starts || closes <= opens || starts < closes || maxClans < Number(count.rows[0]?.count || 0)) {
            await client.query("ROLLBACK");
            return fail("invalid_cup_settings");
          }
          const updated = await client.query(
            `UPDATE clan_cups SET max_clans=$2, registration_opens_at=$3, registration_closes_at=$4, starts_at=$5, reward_amount=$6, updated_at=now()
             WHERE id=$1 RETURNING *`,
            [Number(cup.id), maxClans, opens, closes, starts, rewardAmount]
          );
          cup = updated.rows[0];
        } else if (act === "cup_pause") {
          if (["completed", "cancelled"].includes(cup.state)) {
            await client.query("ROLLBACK");
            return fail("cup_not_active", 409);
          }
          await client.query("UPDATE clan_cups SET state='paused', updated_at=now() WHERE id=$1", [Number(cup.id)]);
          cup = { ...cup, state: "paused" };
        } else if (act === "cup_resume") {
          if (cup.state !== "paused") {
            await client.query("ROLLBACK");
            return fail("cup_not_paused", 409);
          }
          const target = currentMs() < new Date(cup.registration_opens_at).getTime() ? "draft" : (currentMs() < new Date(cup.registration_closes_at).getTime() ? "registration" : "locked");
          await client.query("UPDATE clan_cups SET state=$2, updated_at=now() WHERE id=$1", [Number(cup.id), target]);
          cup = { ...cup, state: target };
          if (target === "locked") await buildBracket(client, cup);
        } else if (act === "cup_cancel") {
          await client.query("UPDATE clan_cups SET state='cancelled', cancelled_at=now(), updated_at=now() WHERE id=$1", [Number(cup.id)]);
          await client.query("UPDATE clan_cup_matches SET state='cancelled' WHERE cup_id=$1 AND state <> 'completed'", [Number(cup.id)]);
          cup = { ...cup, state: "cancelled" };
        } else if (act === "cup_resolve") {
          const matchId = integer(params.get("match") || params.get("matchId"), 1);
          const winnerClanId = integer(params.get("winnerClanId") || params.get("winner"), 1);
          const matchResult = await client.query("SELECT * FROM clan_cup_matches WHERE id=$1 AND cup_id=$2 FOR UPDATE", [matchId, Number(cup.id)]);
          const match = matchResult.rows[0] || null;
          if (!match || !winnerClanId || match.state === "completed" || match.state === "cancelled") {
            await client.query("ROLLBACK");
            return fail("invalid_match_result");
          }
          const entries = await client.query("SELECT id, clan_id FROM clan_cup_entries WHERE id = ANY($1::bigint[])", [[match.entry_a_id, match.entry_b_id].filter(Boolean)]);
          const winner = entries.rows.find((entry) => Number(entry.clan_id) === winnerClanId);
          if (!winner) {
            await client.query("ROLLBACK");
            return fail("winner_not_in_match");
          }
          await completeMatch(client, match, Number(winner.id), "admin_forfeit", null, null);
          await reconcileByes(client, cup.id);
          await maybeCompleteCup(client, cup);
        } else {
          await client.query("ROLLBACK");
          return fail("unknown_cup_admin_action", 404);
        }
      }
      await client.query(
        "INSERT INTO clan_cup_admin_actions (cup_id, actor_player_id, action, data) VALUES ($1,$2,$3,$4::jsonb)",
        [Number(cup.id), Number(account.id), act, JSON.stringify(Object.fromEntries(params.entries()))]
      );
      await client.query("COMMIT");
      await audit?.(db, { playerId: Number(account.id), eventType: "clan_cup_admin", category: "admin", severity: "warning", description: `Кубок: ${act}`, metadata: { cupId: Number(cup.id), role } });
      return ok({ cup: cupPayload(cup) });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] admin action failed", error);
      return fail("clan_cup_admin_failed", 503);
    } finally {
      client.release();
    }
  }

  async function readyEntries(client, match) {
    const result = await client.query(
      `SELECT entry_id,
              COUNT(*) FILTER (WHERE is_active)::int AS active_count,
              COUNT(*) FILTER (WHERE is_active AND checked_in_at IS NOT NULL)::int AS ready_count
       FROM clan_cup_match_players
       WHERE match_id = $1
       GROUP BY entry_id`,
      [Number(match.id)]
    );
    const counts = new Map(result.rows.map((row) => [Number(row.entry_id), Number(row.active_count) === ROSTER_MAIN_COUNT && Number(row.ready_count) === ROSTER_MAIN_COUNT]));
    return counts.get(Number(match.entry_a_id)) && counts.get(Number(match.entry_b_id));
  }

  async function battleDispatch(body) {
    const db = pool();
    if (!db) return { ok: false, error: "postgres_required", status: 503 };
    const playerIds = integerList(body?.playerIds || body?.players || []);
    if (!playerIds.length || playerIds.length > 256) return { ok: false, error: "invalid_players", status: 400 };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      if (!cup || cup.state !== "live") {
        await client.query("COMMIT");
        return { ok: true, assignments: [] };
      }
      const due = await client.query(
        `SELECT * FROM clan_cup_matches
         WHERE cup_id=$1 AND state='scheduled' AND scheduled_at <= now() AND scheduled_at + interval '5 minutes' > now()
         FOR UPDATE`,
        [Number(cup.id)]
      );
      for (const match of due.rows) {
        if (!match.entry_a_id || !match.entry_b_id || !(await readyEntries(client, match))) continue;
        await client.query(
          "UPDATE clan_cup_matches SET state='launching', room_name=$2, started_at=COALESCE(started_at, now()) WHERE id=$1 AND state='scheduled'",
          [Number(match.id), randomRoomName(cup.id, match.id)]
        );
      }
      const assignments = await client.query(
        `SELECT mp.player_id, m.id AS match_id, m.cup_id, m.room_name,
                CASE WHEN mp.entry_id = m.entry_a_id THEN 1 ELSE 2 END AS team,
                m.scheduled_at
         FROM clan_cup_match_players mp
         JOIN clan_cup_matches m ON m.id=mp.match_id
         WHERE m.cup_id=$1 AND m.state='launching' AND mp.is_active AND mp.checked_in_at IS NOT NULL
           AND mp.player_id = ANY($2::int[])
         ORDER BY m.id, mp.player_id`,
        [Number(cup.id), playerIds]
      );
      await client.query("COMMIT");
      return { ok: true, assignments: assignments.rows.map((row) => ({ playerId: Number(row.player_id), cupId: Number(row.cup_id), matchId: Number(row.match_id), roomName: String(row.room_name), team: Number(row.team), scheduledAt: new Date(row.scheduled_at).toISOString() })) };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] battle dispatch failed", error);
      return { ok: false, error: "clan_cup_dispatch_failed", status: 503 };
    } finally {
      client.release();
    }
  }

  async function battleAuthorize(body) {
    const db = pool();
    if (!db) return { ok: false, error: "postgres_required", status: 503 };
    const playerId = integer(body?.playerId, 1);
    const roomName = String(body?.roomName || "").trim().slice(0, 96);
    if (!playerId || !roomName) return { ok: false, error: "invalid_match_join", status: 400 };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await advanceLifecycle(client);
      const result = await client.query(
        `SELECT m.*, CASE WHEN mp.entry_id=m.entry_a_id THEN 1 ELSE 2 END AS team
         FROM clan_cup_matches m
         JOIN clan_cup_match_players mp ON mp.match_id=m.id
         JOIN clan_cup_entries e ON e.id=mp.entry_id AND e.withdrawn_at IS NULL
         JOIN clan_members cm ON cm.clan_id=e.clan_id AND cm.player_id=mp.player_id
         WHERE m.room_name=$1 AND m.state IN ('launching','live')
           AND mp.player_id=$2 AND mp.is_active AND mp.checked_in_at IS NOT NULL
         FOR UPDATE`,
        [roomName, playerId]
      );
      const row = result.rows[0] || null;
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, error: "clan_cup_join_denied", status: 403 };
      }
      if (row.state === "launching") await client.query("UPDATE clan_cup_matches SET state='live', started_at=COALESCE(started_at,now()) WHERE id=$1", [Number(row.id)]);
      await client.query("COMMIT");
      return { ok: true, matchId: Number(row.id), cupId: Number(row.cup_id), team: Number(row.team), map: "legoturnament", mode: "team_deathmatch", scoreLimit: 30, durationSeconds: 900 };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] battle authorize failed", error);
      return { ok: false, error: "clan_cup_authorize_failed", status: 503 };
    } finally {
      client.release();
    }
  }

  async function battleResult(body) {
    const db = pool();
    if (!db) return { ok: false, error: "postgres_required", status: 503 };
    const matchId = integer(body?.matchId, 1);
    const roomName = String(body?.roomName || "").trim().slice(0, 96);
    const winnerTeam = integer(body?.winnerTeam, 1, 2);
    const scoreA = integer(body?.scoreA, 0, 100);
    const scoreB = integer(body?.scoreB, 0, 100);
    if (!matchId || !roomName || !winnerTeam || scoreA === null || scoreB === null || scoreA === scoreB) return { ok: false, error: "invalid_match_result", status: 400 };
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const cup = await advanceLifecycle(client);
      const result = await client.query("SELECT * FROM clan_cup_matches WHERE id=$1 AND room_name=$2 FOR UPDATE", [matchId, roomName]);
      const match = result.rows[0] || null;
      if (match?.state === "completed") {
        const expectedWinner = winnerTeam === 1 ? Number(match.entry_a_id) : Number(match.entry_b_id);
        const sameResult = Number(match.winner_entry_id || 0) === expectedWinner
          && Number(match.score_a) === scoreA
          && Number(match.score_b) === scoreB;
        await client.query("COMMIT");
        return sameResult ? { ok: true, matchId, winnerEntryId: expectedWinner, idempotent: true } : { ok: false, error: "clan_cup_result_conflict", status: 409 };
      }
      if (!cup || !match || !["launching", "live"].includes(match.state)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "clan_cup_result_denied", status: 409 };
      }
      const winnerEntry = winnerTeam === 1 ? Number(match.entry_a_id) : Number(match.entry_b_id);
      if (!winnerEntry || (winnerTeam === 1 ? scoreA <= scoreB : scoreB <= scoreA)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "winner_score_mismatch", status: 400 };
      }
      await completeMatch(client, match, winnerEntry, "battle", scoreA, scoreB);
      await reconcileByes(client, cup.id);
      await maybeCompleteCup(client, cup);
      await client.query("COMMIT");
      return { ok: true, matchId, winnerEntryId: winnerEntry };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[clan-cup] battle result failed", error);
      return { ok: false, error: "clan_cup_result_failed", status: 503 };
    } finally {
      client.release();
    }
  }

  return { playerAjax, adminAjax, battleDispatch, battleAuthorize, battleResult, tick };
}
