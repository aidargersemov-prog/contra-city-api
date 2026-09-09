"use strict";

// Scheduled PvP only. No Photon encoding or ordinary-room rules live here.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAPS = Object.freeze(["Arena_3lvl", "ArenaRing", "Bit_map", "LegoTurnament", "Inferno"]);
const TERMINAL = new Set(["completed", "cancelled", "forfeit"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const integer = (value) => Math.max(0, Math.trunc(Number(value) || 0));

class ResultOutbox {
  constructor(directory, io = fs) {
    this.directory = path.resolve(directory);
    this.io = io;
    io.mkdirSync(this.directory, { recursive: true });
  }

  put(body) {
    if (!UUID.test(body.resultId)) throw new Error("invalid-result-id");
    const file = path.join(this.directory, body.resultId + ".json");
    if (this.io.existsSync(file)) {
      if (this.io.readFileSync(file, "utf8") !== JSON.stringify(body)) throw new Error("outbox-result-conflict");
      return;
    }
    const temporary = file + ".pending";
    const descriptor = this.io.openSync(temporary, "w", 0o600);
    try {
      this.io.writeFileSync(descriptor, JSON.stringify(body), "utf8");
      this.io.fsyncSync(descriptor);
    } finally { this.io.closeSync(descriptor); }
    this.io.renameSync(temporary, file);
    // Linux deployment: persist the directory entry as well as file contents.
    if (process.platform !== "win32") {
      const directory = this.io.openSync(this.directory, "r");
      try { this.io.fsyncSync(directory); } finally { this.io.closeSync(directory); }
    }
  }

  entries() {
    return this.io.readdirSync(this.directory).filter((name) => UUID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"))
      .map((name) => {
        const body = JSON.parse(this.io.readFileSync(path.join(this.directory, name), "utf8"));
        if (body.resultId + ".json" !== name || body.action !== "result") throw new Error("invalid-outbox-entry");
        return body;
      });
  }

  acknowledge(body) { this.io.unlinkSync(path.join(this.directory, body.resultId + ".json")); }
}

function createClanWarsBattle(options) {
  const now = options.now || Date.now;
  const log = options.log || console.log;
  const bootId = options.bootId || crypto.randomUUID();
  const maps = (options.maps || []).filter((map) => MAPS.includes(map));
  const identity = { serverId: options.serverId, bootId, host: options.host, port: Number(options.port), maps };
  if (!identity.serverId || !identity.host || !Number.isInteger(identity.port) || identity.port < 1 || !maps.length) throw new Error("clan-wars-service-not-configured");
  const outbox = options.outbox || new ResultOutbox(options.outboxDirectory);
  const records = new Map();
  let busy = false;
  let timer = null;
  let clockTimer = null;
  let serverOffset = 0;
  let outboxCursor = 0;
  const serviceNow = () => now() + serverOffset;

  function roster(war) {
    const result = new Map();
    for (const [index, side] of [war.challenger, war.defender].entries()) {
      const players = (side?.players || []).filter((player) => ["accepted", "ineligible"].includes(player.status));
      if (players.length !== 5) return null;
      for (const player of players) {
        const id = Number(player.playerId);
        if (!Number.isInteger(id) || id <= 0 || result.has(id)) return null;
        result.set(id, { team: index + 1, clanId: Number(side.clanId), eligible: player.status === "accepted" });
      }
    }
    return result.size === 10 ? result : null;
  }

  function snapshot(room, session) {
    const record = room?.clanWar;
    if (!record || !record.roster.has(Number(session?.playerId))) return;
    record.ledger.set(Number(session.playerId), {
      points: integer(session.points), kills: integer(session.kills), deaths: integer(session.deaths),
    });
  }

  function score(room) {
    const record = room?.clanWar;
    if (!record) return [0, 0];
    for (const session of room.players.values()) snapshot(room, session);
    const values = [0, 0];
    for (const [playerId, value] of record.ledger) values[record.roster.get(playerId).team - 1] += value.points;
    return values;
  }

  function ready(record) {
    return Array.from(record.room.players.values()).filter((session) => session.room === record.room && !session.transportDisconnected && !session.isGuest && session.gameStateRequested && record.roster.get(Number(session.playerId))?.eligible)
      .map((session) => Number(session.playerId)).filter((id, index, values) => values.indexOf(id) === index).sort((a, b) => a - b);
  }

  function connected(record) {
    return Array.from(record.room.players.values()).filter((session) => session.room === record.room && !session.transportDisconnected && !session.isGuest && record.roster.has(Number(session.playerId)))
      .map((session) => Number(session.playerId)).filter((id, index, values) => values.indexOf(id) === index).sort((a, b) => a - b);
  }

  function active(room) {
    const record = room?.clanWar;
    return Boolean(record && record.started && !record.stopped && !record.finished && now() < record.leaseUntil && serviceNow() < timestamp(record.war.endAt));
  }

  function stop(record, reason) {
    if (record.stopped || record.finished) return;
    record.stopped = true;
    try { options.onStop(record.room, reason); }
    catch (error) { log(`[clan-wars] stop-notification-failed war=${record.war.id} error=${error.message}`); }
    log(`[clan-wars] stopped war=${record.war.id} attempt=${record.war.attemptId} reason=${reason}`);
  }

  function complete(record) {
    if (record.finished || record.stopped) return;
    const finalScore = score(record.room);
    record.result ||= { ...identity, action: "result", warId: record.war.id, attemptId: record.war.attemptId, resultId: crypto.randomUUID(), score: finalScore };
    // No final is emitted before its exact immutable result is recoverable.
    try { outbox.put(record.result); }
    catch (error) { stop(record, "result-storage-unavailable"); log(`[clan-wars] outbox-write-failed war=${record.war.id} error=${error.message}`); return; }
    record.finished = true;
    try { options.onFinish(record.room, finalScore); }
    catch (error) { log(`[clan-wars] final-notification-failed war=${record.war.id} error=${error.message}`); }
    log(`[clan-wars] result-durable war=${record.war.id} attempt=${record.war.attemptId} result=${record.result.resultId} score=${finalScore.join(":")}`);
  }

  function tickClock() {
    for (const record of records.values()) {
      if (record.stopped || record.finished) continue;
      if (now() >= record.leaseUntil) { stop(record, "service-lease-expired"); continue; }
      if (record.war.status !== "running") continue;
      const starts = timestamp(record.war.startAt), ends = timestamp(record.war.endAt);
      if (!starts || !ends || ends <= starts) { stop(record, "invalid-match-clock"); continue; }
      if (serviceNow() >= ends) {
        if (!record.started) stop(record, "missed-entire-match");
        else complete(record);
        continue;
      }
      if (!record.started && serviceNow() >= starts) {
        // API atomically confirmed the complete loaded line-up in start.
        record.started = true;
        record.ledger.clear();
        try { options.onStart(record.room, Math.max(0, serviceNow() - starts)); }
        catch (error) { stop(record, "battle-start-failed"); continue; }
        log(`[clan-wars] start war=${record.war.id} attempt=${record.war.attemptId} players=${ready(record).length}`);
      }
    }
  }

  function accept(war, leaseSeconds) {
    if (!war || !war.id || !war.attemptId || !war.roomName || !maps.includes(war.map)) return null;
    const existing = records.get(String(war.id));
    if (existing && existing.war.attemptId !== war.attemptId) { stop(existing, "attempt-fenced"); return null; }
    if (TERMINAL.has(war.status)) {
      if (existing) {
        if (!existing.finished) stop(existing, war.reason || war.status);
        existing.terminal = true;
        existing.war = war;
        if (!existing.room.players.size) options.deleteRoom(existing.room);
      }
      return existing || null;
    }
    const endpoint = war.server;
    if (endpoint && (endpoint.serverId !== identity.serverId || endpoint.bootId !== bootId || endpoint.host !== identity.host || Number(endpoint.port) !== identity.port)) return null;
    if (!endpoint) return null;
    // A running match without this process's existing room can never be replayed.
    if (!existing && war.status === "running") return null;
    if (!["locked", "gathering", "running"].includes(war.status)) return null;
    const fixedRoster = roster(war);
    if (!fixedRoster) return null;
    const duration = Number(war.durationMinutes);
    if (!Number.isInteger(duration) || duration < 10 || duration > 15) return null;
    let record = existing;
    if (!record) {
      if (options.findRoom(war.roomName)) return null;
      const room = options.createRoom({ name: war.roomName, map: war.map, mode: 2, maxUsers: 10, friendlyFire: false, timeLimit: duration, fragLimit: 1000, lvlMin: 1, lvlMax: 99, hasFullSettings: true });
      record = { war, room, roster: fixedRoster, ledger: new Map(), leaseUntil: 0, started: false, stopped: false, finished: false, terminal: false };
      room.clanWar = record;
      room.standardRoundState = "pause";
      records.set(String(war.id), record);
      log(`[clan-wars] reserved war=${war.id} attempt=${war.attemptId} room=${war.roomName}`);
    }
    if (record.stopped || record.finished) return record;
    // Roster is immutable after assignment: a differing reply is not permission.
    const identities = (value) => JSON.stringify(Array.from(value, ([id, entry]) => [id, entry.team, entry.clanId]));
    if (identities(record.roster) !== identities(fixedRoster)) { stop(record, "roster-changed-after-assignment"); return record; }
    record.roster = fixedRoster;
    record.war = war;
    const lease = Math.min(30000, Math.max(0, Number(leaseSeconds || 30) * 1000));
    const leaseEnd = timestamp(endpoint.leaseUntil);
    record.leaseUntil = now() + Math.min(lease, leaseEnd ? Math.max(0, leaseEnd - serviceNow()) : lease);
    return record;
  }

  async function request(action, body = {}) {
    const response = await options.post({ ...identity, action, ...body });
    if (timestamp(response?.serverNow)) serverOffset = timestamp(response.serverNow) - now();
    return response;
  }

  async function retryResults() {
    const entries = outbox.entries();
    if (!entries.length) { outboxCursor = 0; return; }
    const batch = Array.from({ length: Math.min(8, entries.length) }, (_, index) => entries[(outboxCursor + index) % entries.length]);
    outboxCursor = (outboxCursor + batch.length) % entries.length;
    // Bounded concurrent retries: stale receipts must not starve live leases.
    await Promise.all(batch.map(async (body) => {
      try {
        // Original boot/attempt is intentional: this is crash reconciliation.
        const response = await options.post(body);
        if (response?.ok && response.ack === true && String(response.warId) === String(body.warId) && response.resultId === body.resultId) {
          outbox.acknowledge(body);
          const record = records.get(String(body.warId));
          if (record && record.war.attemptId === body.attemptId) record.terminal = true;
          log(`[clan-wars] result-acked war=${body.warId} result=${body.resultId}`);
        }
      } catch (error) { log(`[clan-wars] result-retry war=${body.warId} error=${error.message}`); }
    }));
  }

  async function cycle() {
    if (busy) return;
    busy = true;
    try {
      await retryResults();
      const response = await request("poll");
      if (response?.ok) for (const war of response.assignments || []) accept(war, response.leaseSeconds);
      await Promise.all(Array.from(records.values(), async (record) => {
        if (record.finished || record.stopped || record.terminal) return;
        try {
          const body = { warId: record.war.id, attemptId: record.war.attemptId, connectedPlayerIds: connected(record), readyPlayerIds: ready(record), score: score(record.room) };
          const heartbeat = await request("heartbeat", body);
          if (!heartbeat?.ok) {
            if (heartbeat?.war && TERMINAL.has(heartbeat.war.status)) accept(heartbeat.war, 0);
            else if (["attempt_fenced", "lease_expired", "war_terminal", "boot_mismatch"].includes(heartbeat?.error)) stop(record, heartbeat.error);
            return;
          }
          accept(heartbeat.war, heartbeat.leaseSeconds);
          if (!record.stopped && !record.finished && record.war.status === "gathering" && body.readyPlayerIds.length === 10) {
            const start = await request("start", body);
            if (start?.ok) accept(start.war, start.leaseSeconds);
          }
        } catch (error) { log(`[clan-wars] heartbeat-failed war=${record.war.id} error=${error.message}`); }
      }));
      tickClock();
      for (const [id, record] of records) {
        if (record.terminal && !record.room.players.size) { options.deleteRoom(record.room); records.delete(id); }
      }
    } catch (error) { log(`[clan-wars] service-cycle-failed error=${error.message}`); }
    finally { busy = false; }
  }

  function admission(settings, playerId, clanId, port) {
    const room = options.findRoom(settings.name);
    const record = room?.clanWar;
    if (!record) return /^ClanWar(?:\s|:|-)/i.test(settings.name || "") ? "war-room-unavailable" : "";
    if (settings.hasFullSettings !== false || Number(settings.guestMode) > 0) return "war-reservation-required";
    if (!["gathering", "running"].includes(record.war.status)) return "war-not-gathering";
    if (Number(port) !== identity.port || record.stopped || record.finished || record.terminal || now() >= record.leaseUntil) return "war-room-unavailable";
    const member = record.roster.get(Number(playerId));
    if (!member || !member.eligible || (clanId != null && Number(clanId) !== member.clanId && record.war.status !== "running")) return "war-roster-required";
    return "";
  }

  return {
    identity, cycle, tickClock, score, active, admission, snapshot, accept,
    fixedTeam(session) { return session?.room?.clanWar?.roster.get(Number(session.playerId))?.team ?? null; },
    attach(session) {
      const record = session?.room?.clanWar;
      if (!record) return;
      session.team = record.roster.get(Number(session.playerId))?.team ?? -1;
      Object.assign(session, record.ledger.get(Number(session.playerId)) || { points: 0, kills: 0, deaths: 0 });
    },
    retain(room) { return Boolean(room?.clanWar && !room.clanWar.terminal); },
    start() {
      if (timer) return;
      timer = setInterval(cycle, 2000); timer.unref?.();
      clockTimer = setInterval(tickClock, 50); clockTimer.unref?.();
      void cycle();
    },
    close() { clearInterval(timer); clearInterval(clockTimer); timer = clockTimer = null; },
  };
}

module.exports = { createClanWarsBattle, ResultOutbox, MAPS };
