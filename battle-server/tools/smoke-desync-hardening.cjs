const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextDecoder } = require("util");

const serverPath = path.resolve(__dirname, "..", "server.js");
const serverDir = path.dirname(serverPath);
const serverSource = fs.readFileSync(serverPath, "utf8");
const logs = [];
const inertTimer = { unref() {} };

function inertUdpSocket() {
  return {
    on() { return this; },
    bind(_port, _host, callback) { if (callback) callback(); return this; },
    send() {},
  };
}

function inertTcpServer() {
  return {
    maxConnections: 0,
    on() { return this; },
    listen(_port, _host, callback) { if (callback) callback(); return this; },
  };
}

const sandbox = {
  AbortController,
  Array,
  Boolean,
  Buffer,
  Date,
  Error,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Promise,
  Set,
  String,
  TextDecoder,
  Uint8Array,
  URL,
  URLSearchParams,
  WeakMap,
  WeakSet,
  clearInterval() {},
  clearTimeout() {},
  console: {
    error: (...args) => logs.push(args.join(" ")),
    log: (...args) => logs.push(args.join(" ")),
  },
  fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  process: {
    env: {
      BATTLE_EVENT_TOKEN: "smoke-token",
      BATTLE_PORTS: "5055",
      PUBLIC_HOST: "127.0.0.1",
      BATTLE_EVENT_CONCURRENCY: "8",
      BATTLE_EVENT_QUEUE_MAX: "16",
      PROFILE_LOAD_CONCURRENCY: "4",
      PROFILE_LOAD_QUEUE_MAX: "16",
      PROFILE_CHANGE_SETTLE_MS: "0",
    },
    on() {},
  },
  require(id) {
    if (id === "dgram") return { createSocket: inertUdpSocket };
    if (id === "net") return { createServer: inertTcpServer };
    if (id === "util") return { TextDecoder };
    if (id.startsWith(".")) return require(path.resolve(serverDir, id));
    return require(id);
  },
  setInterval: () => inertTimer,
  setTimeout: () => inertTimer,
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;

const exportsSource = `
globalThis.__desyncSmoke = {
  BUILD_ID,
  ROOM_LIST_COALESCE_MS,
  OUTBOUND_RELIABLE_RECOVERY_MS,
  OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS,
  RELIABLE_RESPONSE_CACHE_TTL_MS,
  BATTLE_EVENT_CONCURRENCY,
  BATTLE_EVENT_QUEUE_MAX,
  PROFILE_LOAD_CONCURRENCY,
  MAX_UDP_PACKET_BYTES,
  UDP_OUTBOX_FLUSH_MS,
  applyLateProfile,
  cacheReliableResponse,
  enqueueInboundReliableRequest,
  fallbackPlayerProfile,
  fetchWithTimeout,
  findNatRebindSession,
  getCachedReliableResponse,
  logReliableReplay,
  profileForJoin,
  loadPlayerProfileSingleFlight,
  markPlayerProfileChanged,
  postBattleEvent,
  battleApiQueueSnapshot,
  scheduleProfileLoad,
  existingRoomForJoin,
  rawHashtable,
  rawByte,
  rawInt,
  rawString,
  readTypedRaw,
  rebindSessionEndpoint,
  removeDuplicatePlayerSessionsFromAllRooms,
  roomHasCapacityForJoin,
  roomOccupancyForJoin,
  runOutboundReliableRetries,
  sendPacket,
  sendPacketNow,
  flushSessionUdpOutbox,
  sessions,
  rooms,
  updateActorWireData,
};
`;
vm.createContext(sandbox);
new vm.Script(`${serverSource}\n${exportsSource}`, { filename: serverPath }).runInContext(sandbox);

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function testInboundReliableOrdering(battle) {
  const executionOrder = [];
  const session = {
    actorId: 7,
    transportDisconnected: false,
    reliableGeneration: 0,
    inboundReliableChannels: new Map(),
    reliableResponses: new Map(),
    reliableInFlight: new Map(),
  };
  const request = (seq) => ({
    cacheKey: `0:0:${seq}`,
    channel: 0,
    startSeq: seq,
    endSeq: seq,
    parsed: null,
    execute: async () => {
      executionOrder.push(seq);
      return [];
    },
  });

  const second = battle.enqueueInboundReliableRequest(session, request(2));
  assert.strictEqual(second.status, "buffered", "sequence 2 must wait for missing sequence 1");
  await tick();
  assert.deepStrictEqual(executionOrder, [], "out-of-order request executed before its gap was filled");

  const first = battle.enqueueInboundReliableRequest(session, request(1));
  assert.strictEqual(first.status, "ready");
  await tick();
  await tick();
  assert.deepStrictEqual(executionOrder, [1, 2], "reliable operations must execute in channel sequence order");

  const stale = battle.enqueueInboundReliableRequest(session, request(1));
  assert.strictEqual(stale.status, "stale", "old sequence without cache must never execute twice");
  await tick();
  assert.deepStrictEqual(executionOrder, [1, 2]);
}

function testResponseCacheWindow(battle) {
  const session = { reliableResponses: new Map() };
  const commands = [Buffer.from([1, 2, 3])];
  battle.cacheReliableResponse(session, "0:0:1", commands);
  assert.strictEqual(battle.getCachedReliableResponse(session, "0:0:1"), commands);
  assert(commands.expiresAt - commands.cachedAt >= battle.RELIABLE_RESPONSE_CACHE_TTL_MS);
  commands.expiresAt = Date.now() - 1;
  assert.strictEqual(battle.getCachedReliableResponse(session, "0:0:1"), null);
}

function testLateProfileFreeze(battle) {
  const oldWeaponStates = new Map([[1, { slot: 1, loadedAmmo: 3 }]]);
  const session = {
    actorId: 3,
    gameStateRequested: true,
    spawned: true,
    matchStartedAt: Date.now(),
    weaponStates: oldWeaponStates,
  };
  const room = { players: new Map([[3, session]]) };
  session.room = room;
  const applied = battle.applyLateProfile(session, { authId: 55, authKey: "k", name: "late" });
  assert.strictEqual(applied, false);
  assert.strictEqual(session.weaponStates, oldWeaponStates, "late profile reset weapon runtime during battle");
  assert.strictEqual(session.pendingBattleProfile.profile.authId, 55);
}

function testActorWireBuild(battle) {
  const session = {
    actorId: 1,
    roomRaw: battle.rawHashtable([]),
  };
  const profile = battle.fallbackPlayerProfile(null);
  assert.doesNotThrow(() => battle.updateActorWireData(session, null, profile, 0));
  assert(Buffer.isBuffer(session.actorRaw) && session.actorRaw.length > 0);
  assert(Buffer.isBuffer(session.peerActorRaw) && session.peerActorRaw.length > 0);
  assert(Buffer.isBuffer(session.joinActorRaw) && session.joinActorRaw.length > 0);
}

function testNatRebindBeforeSpawn(battle) {
  battle.sessions.clear();
  const now = Date.now();
  const session = {
    actorId: 4,
    peerId: 9,
    challenge: 0x12345678,
    port: 5055,
    seenVerify: true,
    verifySeq: 0,
    reliableGeneration: 2,
    transportGeneration: 2,
    lastSeenAt: now - 30000,
    spawned: false,
    transportDisconnected: false,
  };
  session.room = null;
  battle.sessions.set("old", session);
  const packet = Buffer.alloc(12);
  packet.writeUInt16BE(9, 0);
  packet.writeUInt32BE(0x12345678, 8);
  assert.strictEqual(battle.findNatRebindSession(5055, packet, { address: "203.0.113.2", port: 40000 }, now), session);
  const room = { name: "rebind-room" };
  const actorId = session.actorId;
  session.room = room;
  session.sessionId = "old";
  session.remoteKey = "198.51.100.1:30000";
  session.outboundReliable = new Map([["0:1", { rinfo: { address: "198.51.100.1", port: 30000 } }]]);
  const socket = { send() {} };
  const rebound = battle.rebindSessionEndpoint(session, "new", socket, { address: "203.0.113.2", port: 40000 });
  assert.strictEqual(rebound, session);
  assert.strictEqual(battle.sessions.has("old"), false);
  assert.strictEqual(battle.sessions.get("new"), session);
  assert.strictEqual(session.room, room, "NAT rebind recreated the room");
  assert.strictEqual(session.actorId, actorId, "NAT rebind recreated the actor");
  assert.strictEqual(session.outboundReliable.get("0:1").rinfo.address, "203.0.113.2");
  assert.strictEqual(session.outboundReliable.get("0:1").rinfo.port, 40000);
  session.transportGeneration = 1;
  assert.strictEqual(battle.findNatRebindSession(5055, packet, { address: "203.0.113.2", port: 40000 }, now), null);
}

function testAtomicDuplicateSessionCleanup(battle) {
  battle.sessions.clear();
  battle.rooms.clear();
  const oldSession = {
    actorId: 2,
    playerId: 55,
    playerAuthKey: "old-key",
    port: 5056,
    matchStatsPosted: true,
    outboundReliable: new Map(),
    reliableResponses: new Map(),
    reliableInFlight: new Map(),
    reliableFragments: new Map(),
    inboundReliableChannels: new Map(),
    sessionId: "old",
  };
  const replacement = {
    actorId: 1,
    playerId: 55,
    playerAuthKey: "new-key",
    port: 5055,
    sessionId: "new",
  };
  const room = {
    name: "duplicate-room",
    map: "arena_1",
    mode: 1,
    players: new Map([[2, oldSession]]),
  };
  oldSession.room = room;
  battle.sessions.set("old", oldSession);
  battle.sessions.set("new", replacement);
  battle.rooms.set(room.name, room);
  assert.strictEqual(battle.removeDuplicatePlayerSessionsFromAllRooms(replacement, "smoke-duplicate"), 1);
  assert.strictEqual(room.players.has(2), false, "old actor remained in room.players");
  assert.strictEqual(battle.sessions.has("old"), false, "old ccid remained in global sessions");
  assert.strictEqual(battle.sessions.get("new"), replacement, "replacement session was removed");
  assert.strictEqual(oldSession.transportDisconnected, true);
}

async function testProfileJoinRequiresRealProfile(battle) {
  const result = await battle.profileForJoin(null, { forceRefresh: true });
  assert.strictEqual(result.source, "fallback");
  assert.strictEqual(result.profile.isFallback, true);
}

async function testApiTimeout(battle) {
  const previousFetch = sandbox.fetch;
  const previousSetTimeout = sandbox.setTimeout;
  const previousClearTimeout = sandbox.clearTimeout;
  sandbox.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal.reason || new Error("aborted")), { once: true });
  });
  sandbox.setTimeout = (callback, delay) => ({ timer: setTimeout(callback, delay), unref() {} });
  sandbox.clearTimeout = (handle) => clearTimeout(handle?.timer);
  try {
    await assert.rejects(() => battle.fetchWithTimeout("https://example.invalid", {}, 10), /api timeout 10ms/);
  } finally {
    sandbox.fetch = previousFetch;
    sandbox.setTimeout = previousSetTimeout;
    sandbox.clearTimeout = previousClearTimeout;
  }
}

async function testBoundedApiAndProfileQueues(battle) {
  assert.strictEqual(battle.BATTLE_EVENT_CONCURRENCY, 8);
  assert.strictEqual(battle.BATTLE_EVENT_QUEUE_MAX, 16);
  assert.strictEqual(battle.PROFILE_LOAD_CONCURRENCY, 4);
  const previousFetch = sandbox.fetch;
  const fetchResolvers = [];
  let activeFetches = 0;
  let maxActiveFetches = 0;
  sandbox.fetch = () => new Promise((resolve) => {
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    fetchResolvers.push(() => {
      activeFetches -= 1;
      resolve({ ok: true, status: 200, json: async () => ({}) });
    });
  });
  try {
    const session = {
      actorId: 1,
      playerId: 42,
      playerName: "QueueSmoke",
      playerAuthKey: "queue-key",
      port: 5055,
      team: 1,
      room: { name: "queue-room", map: "Arena_3lvl", mode: 1, maxUsers: 8 },
    };
    const eventPromises = [];
    for (let index = 0; index < 24; index += 1) eventPromises.push(battle.postBattleEvent(session, "shot", { shots: 1 }));
    assert.strictEqual(battle.battleApiQueueSnapshot().inFlight, 8);
    assert.strictEqual(battle.battleApiQueueSnapshot().queued, 16);
    eventPromises.push(battle.postBattleEvent(session, "death", { deaths: 1 }));
    assert.strictEqual(battle.battleApiQueueSnapshot().highQueued, 1);
    assert.strictEqual(battle.battleApiQueueSnapshot().queued, 16);
    while (battle.battleApiQueueSnapshot().inFlight > 0 || battle.battleApiQueueSnapshot().queued > 0) {
      const batch = fetchResolvers.splice(0);
      batch.forEach((resolve) => resolve());
      await tick();
      await tick();
    }
    await Promise.all(eventPromises);
    assert.strictEqual(maxActiveFetches, 8);
    assert(battle.battleApiQueueSnapshot().dropped >= 1);
  } finally {
    sandbox.fetch = previousFetch;
  }

  const taskResolvers = [];
  let activeTasks = 0;
  let maxActiveTasks = 0;
  const tasks = Array.from({ length: 12 }, () => battle.scheduleProfileLoad(() => new Promise((resolve) => {
    activeTasks += 1;
    maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
    taskResolvers.push(() => {
      activeTasks -= 1;
      resolve(true);
    });
  })));
  await tick();
  assert.strictEqual(battle.battleApiQueueSnapshot().profileInFlight, 4);
  assert.strictEqual(battle.battleApiQueueSnapshot().profileQueued, 8);
  while (battle.battleApiQueueSnapshot().profileInFlight > 0 || battle.battleApiQueueSnapshot().profileQueued > 0) {
    const batch = taskResolvers.splice(0);
    batch.forEach((resolve) => resolve());
    await tick();
    await tick();
  }
  await Promise.all(tasks);
  assert.strictEqual(maxActiveTasks, 4);
}

async function testProfileSingleFlightAndGlobalCatalog(battle) {
  const previousFetch = sandbox.fetch;
  const calls = { profile: 0, inventory: 0, abilities: 0, catalog: 0 };
  sandbox.fetch = async (url) => {
    const target = String(url);
    let payload = {};
    if (target.includes("page=pl&act=i&")) {
      calls.profile += 1;
      payload = { info: { u_id: 42, un: "SingleFlight" }, view: {}, weap: {}, taun: {} };
    } else if (target.includes("page=pl&act=inv&")) {
      calls.inventory += 1;
      payload = { data: { items: "[]", dw: "[]" } };
    } else if (target.includes("page=pl&act=abil&")) {
      calls.abilities += 1;
      payload = { u: [] };
    } else if (target.includes("page=shop&act=items&")) {
      calls.catalog += 1;
      payload = { weap: { items: [] }, wear: { items: [] } };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const typed = (raw) => battle.readTypedRaw(raw, 0);
    const actor = typed(battle.rawHashtable([
      { key: battle.rawByte(241), value: battle.rawInt(42) },
      { key: battle.rawByte(240), value: battle.rawString("single-flight-key") },
      { key: battle.rawByte(242), value: battle.rawString("SingleFlight") },
    ]));
    const [first, second] = await Promise.all([
      battle.loadPlayerProfileSingleFlight(actor),
      battle.loadPlayerProfileSingleFlight(actor),
    ]);
    assert.strictEqual(first.authId, 42);
    assert.strictEqual(second, first);
    assert.deepStrictEqual(calls, { profile: 1, inventory: 1, abilities: 1, catalog: 1 });
    const joined = await battle.profileForJoin(actor, { forceRefresh: true });
    assert.strictEqual(joined.source, "fresh");
    assert.deepStrictEqual(calls, { profile: 2, inventory: 2, abilities: 2, catalog: 1 });

    battle.markPlayerProfileChanged(42, 3);
    const afterChange = await battle.profileForJoin(actor);
    assert.strictEqual(afterChange.source, "loaded");
    assert.deepStrictEqual(calls, { profile: 3, inventory: 3, abilities: 3, catalog: 1 });

    let releaseWarmProfile;
    const raceCalls = { profile: 0, inventory: 0, abilities: 0 };
    sandbox.fetch = async (url) => {
      const target = String(url);
      let payload = {};
      if (target.includes("ccid=43") && target.includes("page=pl&act=i&")) {
        raceCalls.profile += 1;
        if (raceCalls.profile === 1) {
          return new Promise((resolve) => {
            releaseWarmProfile = () => resolve({
              ok: true,
              status: 200,
              json: async () => ({ info: { u_id: 43, un: "WarmRace" }, view: { hat: 1 }, weap: {}, taun: {} }),
            });
          });
        }
        payload = { info: { u_id: 43, un: "FreshRace" }, view: { hat: 2 }, weap: {}, taun: {} };
      } else if (target.includes("ccid=43") && target.includes("page=pl&act=inv&")) {
        raceCalls.inventory += 1;
        payload = { data: { items: "[]", dw: "[]" } };
      } else if (target.includes("ccid=43") && target.includes("page=pl&act=abil&")) {
        raceCalls.abilities += 1;
        payload = { u: [] };
      } else if (target.includes("page=shop&act=items&")) {
        payload = { weap: { items: [] }, wear: { items: [] } };
      }
      return { ok: true, status: 200, json: async () => payload };
    };
    const raceActor = typed(battle.rawHashtable([
      { key: battle.rawByte(241), value: battle.rawInt(43) },
      { key: battle.rawByte(240), value: battle.rawString("race-key") },
      { key: battle.rawByte(242), value: battle.rawString("WarmRace") },
    ]));
    const warm = battle.loadPlayerProfileSingleFlight(raceActor);
    await tick();
    const forced = battle.profileForJoin(raceActor, { forceRefresh: true });
    await tick();
    assert.strictEqual(raceCalls.profile, 1, "forced refresh did not wait for the in-flight warm load");
    releaseWarmProfile();
    await warm;
    const raceJoined = await forced;
    assert.strictEqual(raceJoined.source, "fresh");
    assert.strictEqual(raceJoined.profile.name, "FreshRace");
    assert.strictEqual(raceJoined.profile.view.hat, 2);
    assert.deepStrictEqual(raceCalls, { profile: 2, inventory: 2, abilities: 2 });
  } finally {
    sandbox.fetch = previousFetch;
  }
}

function testReliableRecoveryKeepsActiveTransport(battle) {
  battle.sessions.clear();
  const now = Date.now();
  const command = Buffer.alloc(13);
  command[0] = 0x06;
  command[1] = 0;
  command.writeUInt32BE(13, 4);
  command.writeUInt32BE(1, 8);
  const session = {
    actorId: 9,
    peerId: 1,
    challenge: 3,
    lastSeenAt: now,
    transportDisconnected: false,
    outboundReliableRecoveryByChannel: new Map(),
    outboundReliable: new Map([[
      "0:1",
      {
        channel: 0,
        reliableSeq: 1,
        commandType: 0x06,
        command,
        socket: { send() {} },
        rinfo: { address: "127.0.0.1", port: 45001 },
        firstSentAt: now - 11000,
        lastSentAt: now - 5000,
        sentCount: 6,
        roundTripTimeout: 100,
        recoveryStartedAt: 0,
      },
    ]]),
  };
  battle.sessions.set("active", session);
  battle.runOutboundReliableRetries();
  assert.strictEqual(session.transportDisconnected, false, "one stuck sequence disconnected an otherwise active transport");
  assert(session.outboundReliable.get("0:1").recoveryStartedAt > 0, "channel recovery was not entered");
}

function testReliableRecoveryHardTimeout(battle) {
  battle.sessions.clear();
  const now = Date.now();
  const command = Buffer.alloc(13);
  command[0] = 0x06;
  command.writeUInt32BE(13, 4);
  command.writeUInt32BE(1, 8);
  const entry = {
    channel: 0,
    reliableSeq: 1,
    commandType: 0x06,
    command,
    firstSentAt: now - battle.OUTBOUND_RELIABLE_RECOVERY_MS - 11000,
    lastSentAt: now - 5000,
    sentCount: 8,
    roundTripTimeout: 100,
    recoveryStartedAt: now - battle.OUTBOUND_RELIABLE_RECOVERY_MS - 1,
  };
  const session = {
    actorId: 12,
    playerId: 12,
    peerId: 1,
    challenge: 9,
    sessionId: "expired",
    lastSeenAt: now,
    transportDisconnected: false,
    outboundReliableRecoveryByChannel: new Map([[0, { startedAt: entry.recoveryStartedAt }]]),
    outboundReliable: new Map([["0:1", entry]]),
  };
  battle.sessions.set("expired", session);
  battle.runOutboundReliableRetries();
  assert.strictEqual(session.transportDisconnected, true, "recovery hard timeout did not close dead transport");
  assert.strictEqual(battle.sessions.has("expired"), false);
}

function testReliableRetryBatchBudget(battle) {
  battle.sessions.clear();
  const now = Date.now();
  const sentPackets = [];
  const socket = { send(packet) { sentPackets.push(Buffer.from(packet)); } };
  const rinfo = { address: "127.0.0.1", port: 45002 };
  const pending = new Map();
  for (let seq = 1; seq <= 40; seq += 1) {
    const command = Buffer.alloc(170);
    command[0] = 0x06;
    command[1] = 0;
    command.writeUInt32BE(170, 4);
    command.writeUInt32BE(seq, 8);
    pending.set(`0:${seq}`, {
      channel: 0,
      reliableSeq: seq,
      commandType: 0x06,
      command,
      socket,
      rinfo,
      firstSentAt: now - 5000,
      lastSentAt: now - 5000,
      sentCount: 1,
      roundTripTimeout: 100,
      recoveryStartedAt: 0,
    });
  }
  const session = {
    actorId: 10,
    peerId: 1,
    challenge: 4,
    socket,
    rinfo,
    lastSeenAt: now,
    transportDisconnected: false,
    outboundReliableRecoveryByChannel: new Map(),
    outboundReliable: pending,
  };
  battle.sessions.set("batch", session);
  battle.runOutboundReliableRetries();
  const resent = Array.from(pending.values()).filter((entry) => entry.sentCount === 2);
  assert.strictEqual(resent.length, battle.OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS, "retry sweep ignored its command budget");
  assert(sentPackets.length > 1 && sentPackets.length < resent.length, "retry batch did not reduce the UDP datagram burst");
  assert.strictEqual(sentPackets.reduce((sum, packet) => sum + packet[3], 0), battle.OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS, "batched ENet command count is wrong");
  assert(sentPackets.every((packet) => packet.length <= 1200), "retry batch ignored the UDP packet size limit");
}

function testReliableRetryRoundRobinFairness(battle) {
  battle.sessions.clear();
  const now = Date.now();
  const socket = { send() {} };
  const rinfo = { address: "127.0.0.1", port: 45003 };
  const makeEntry = (seq) => {
    const command = Buffer.alloc(32);
    command[0] = 0x06;
    command[1] = 0;
    command.writeUInt32BE(command.length, 4);
    command.writeUInt32BE(seq, 8);
    return {
      channel: 0,
      reliableSeq: seq,
      commandType: 0x06,
      command,
      socket,
      rinfo,
      firstSentAt: now - 5000,
      lastSentAt: now - 5000,
      sentCount: 1,
      roundTripTimeout: 100,
      recoveryStartedAt: 0,
    };
  };
  const busyPending = new Map();
  for (let seq = 1; seq <= battle.OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS * 2; seq += 1) {
    busyPending.set(`0:${seq}`, makeEntry(seq));
  }
  const lateEntry = makeEntry(1000);
  const makeSession = (actorId, pending) => ({
    actorId,
    peerId: 1,
    challenge: actorId,
    socket,
    rinfo,
    lastSeenAt: now,
    transportDisconnected: false,
    outboundReliableRecoveryByChannel: new Map(),
    outboundReliable: pending,
  });
  battle.sessions.set("busy", makeSession(20, busyPending));
  battle.sessions.set("late", makeSession(21, new Map([["0:1000", lateEntry]])));
  battle.runOutboundReliableRetries();
  battle.runOutboundReliableRetries();
  assert.strictEqual(lateEntry.sentCount, 2, "global retry budget starved a later session instead of rotating fairly");
}

function testUdpOutboxPreservesCommands(battle) {
  const packets = [];
  const socket = { send(packet) { packets.push(Buffer.from(packet)); } };
  const rinfo = { address: "127.0.0.1", port: 45100 };
  const session = {
    actorId: 15,
    peerId: 7,
    challenge: 33,
    socket,
    rinfo,
    transportDisconnected: false,
    outboundReliable: new Map(),
    outboundReliableRecoveryByChannel: new Map(),
  };
  const commands = [1, 2, 3].map((seq) => {
    const command = Buffer.alloc(15, seq);
    command[0] = 0x06;
    command[1] = seq % 2;
    command.writeUInt32BE(command.length, 4);
    command.writeUInt32BE(seq, 8);
    return command;
  });

  for (const command of commands) {
    assert.strictEqual(battle.sendPacket(socket, rinfo, session, [command]), true);
  }
  assert.strictEqual(packets.length, 0, "outbox sent before its batching window");
  assert.strictEqual(battle.flushSessionUdpOutbox(session), true);
  assert.strictEqual(packets.length, 1, "three small commands were not batched into one datagram");
  assert.strictEqual(packets[0][3], commands.length, "batched ENet command count changed");
  assert(packets[0].length <= battle.MAX_UDP_PACKET_BYTES, "batched datagram exceeded the hard size limit");
  let offset = 12;
  for (const original of commands) {
    const length = packets[0].readUInt32BE(offset + 4);
    assert.deepStrictEqual(packets[0].subarray(offset, offset + length), original, "outbox changed ENet command bytes or ordering");
    offset += length;
  }
  assert.strictEqual(offset, packets[0].length);

  packets.length = 0;
  const largeSession = {
    ...session,
    actorId: 16,
    outboundReliable: new Map(),
    outboundReliableRecoveryByChannel: new Map(),
    udpOutbox: null,
  };
  const largeCommands = [];
  for (let seq = 1; seq <= 20; seq += 1) {
    const command = Buffer.alloc(170, seq);
    command[0] = 0x06;
    command[1] = 0;
    command.writeUInt32BE(command.length, 4);
    command.writeUInt32BE(seq, 8);
    largeCommands.push(command);
  }
  assert.strictEqual(battle.sendPacket(socket, rinfo, largeSession, largeCommands), true);
  assert.strictEqual(battle.flushSessionUdpOutbox(largeSession), true);
  assert(packets.length > 1, "large outbox was not split into bounded datagrams");
  assert(packets.every((packet) => packet.length <= battle.MAX_UDP_PACKET_BYTES), "outbox emitted a datagram above 1200 bytes");
}

function testReliableReplayLogRateLimit(battle) {
  const before = logs.filter((line) => line.includes("[state] reliable replay actor=11")).length;
  const session = { actorId: 11, reliableReplayLogState: new Map() };
  for (let seq = 1; seq <= 20; seq += 1) battle.logReliableReplay(session, 0, seq, 0);
  const after = logs.filter((line) => line.includes("[state] reliable replay actor=11")).length;
  assert.strictEqual(after - before, 1, "reliable replay log storm was not rate-limited");
}

async function main() {
  const battle = sandbox.__desyncSmoke;
  assert.strictEqual(battle.BUILD_ID, "battle-server-2026-07-29-staff-rbac-v285");
  assert.strictEqual(battle.UDP_OUTBOX_FLUSH_MS, 15);
  assert.strictEqual(battle.ROOM_LIST_COALESCE_MS, 150);
  const capacityRoom = {
    name: "capacity-smoke",
    map: "Arena_3lvl",
    mode: 1,
    maxUsers: 2,
    players: new Map([
      [1, { playerId: 101 }],
      [2, { playerId: 202 }],
    ]),
  };
  battle.rooms.set(capacityRoom.name, capacityRoom);
  assert.strictEqual(battle.roomOccupancyForJoin(capacityRoom, 303, null), 2);
  assert.strictEqual(battle.roomHasCapacityForJoin(capacityRoom, 303, null), false);
  assert.strictEqual(battle.roomHasCapacityForJoin(capacityRoom, 202, null), true);
  assert.strictEqual(battle.existingRoomForJoin({ name: capacityRoom.name, map: capacityRoom.map, mode: 1, hasFullSettings: true }), capacityRoom);
  assert.strictEqual(battle.existingRoomForJoin({ name: capacityRoom.name, map: "Arena_DeathMatch", mode: 1, hasFullSettings: true }), null);
  battle.rooms.delete(capacityRoom.name);
  await testInboundReliableOrdering(battle);
  testResponseCacheWindow(battle);
  testLateProfileFreeze(battle);
  testActorWireBuild(battle);
  testNatRebindBeforeSpawn(battle);
  testAtomicDuplicateSessionCleanup(battle);
  await testProfileJoinRequiresRealProfile(battle);
  await testApiTimeout(battle);
  await testBoundedApiAndProfileQueues(battle);
  await testProfileSingleFlightAndGlobalCatalog(battle);
  testReliableRecoveryKeepsActiveTransport(battle);
  testReliableRecoveryHardTimeout(battle);
  testReliableRetryBatchBudget(battle);
  testReliableRetryRoundRobinFairness(battle);
  testUdpOutboxPreservesCommands(battle);
  testReliableReplayLogRateLimit(battle);
  assert(serverSource.includes("fetchWithTimeout"), "Railway API timeout helper is missing");
  assert(serverSource.includes("room join rejected reason=profile-unavailable"), "atomic profile join rejection is missing");
  assert(serverSource.includes("eventCode === 207"), "GameLogic profile-change invalidation is missing");
  assert(serverSource.includes('udp.on("error"'), "UDP error handler is missing");
  console.log(`OK build=${battle.BUILD_ID} reliableOrder=1,2 cacheTtl=${battle.RELIABLE_RESPONSE_CACHE_TTL_MS}ms natRebind=pre-spawn atomicJoin=real-profile+ccid-cleanup reliableRecovery=active-safe retryBatch=${battle.OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
