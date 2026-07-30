const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextDecoder } = require("util");

const serverPath = path.resolve(__dirname, "..", "server.js");
const serverDir = path.dirname(serverPath);
const serverSource = fs.readFileSync(serverPath, "utf8");
const inertTimer = { unref() {} };
const fetchCalls = [];
let approvalPayload = {
  ok: true,
  actor: { role: "moderator" },
  target: { role: "helper" },
};
let profileAccessDenied = false;

function inertUdpSocket() {
  return {
    on() { return this; },
    bind(_port, _host, callback) { callback?.(); return this; },
    send() {},
  };
}

function inertTcpServer() {
  return {
    maxConnections: 0,
    on() { return this; },
    listen(_port, _host, callback) { callback?.(); return this; },
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
  console: { error() {}, log() {} },
  decodeURIComponent,
  fetch: async (url, options) => {
    if (profileAccessDenied && String(url).includes("/ajax.php")) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ result: false, error: "1" }),
      };
    }
    fetchCalls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => approvalPayload,
    };
  },
  process: {
    env: {
      API_BASE_URL: "https://staff-smoke.invalid",
      BATTLE_EVENT_TOKEN: "staff-smoke-token",
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
globalThis.__staffSmoke = {
  BUILD_ID,
  STAFF_ROLE_RANK,
  normalizeStaffRole,
  staffProfileFromPayload,
  staffRoleRank,
  staffHasCapability,
  applySessionStaffProfile,
  cachedStaffCanModerate,
  roomPasswordMatches,
  decodeStaffReason,
  parseStaffChatCommand,
  requestStaffActionApproval,
  roomPlayableOccupancy,
  makeActorDataRaw,
  makeModerationDisconnectEvent,
  makeInstantKickEvent,
  makeKickVoteEvent,
  finishRoomKickVote,
  handleOperation,
  profileForJoin,
  profileCache,
  sessions,
  parsePhotonRequest,
  readParameterTable,
  htGet,
  rawParamTable,
  rawHashtable,
  rawByte,
  rawBool,
  rawInt,
  rawString,
  readTypedRaw,
};
`;

vm.createContext(sandbox);
new vm.Script(`${serverSource}\n${exportsSource}`, { filename: serverPath }).runInContext(sandbox);
const staff = sandbox.__staffSmoke;

assert.strictEqual(staff.BUILD_ID, "battle-server-2026-07-30-clan-delete-v292");
assert.strictEqual(staff.normalizeStaffRole("MODER"), "moderator");
assert.strictEqual(staff.normalizeStaffRole("dev"), "developer");
assert.strictEqual(staff.normalizeStaffRole("unknown"), "none");
assert.strictEqual(staff.staffRoleRank("owner"), staff.staffRoleRank("developer"));

assert.strictEqual(staff.staffProfileFromPayload({ conf: { staff: "helper" } }).role, "helper");
assert.strictEqual(staff.staffProfileFromPayload({ conf: { staff: { role: "admin", active: true } } }).role, "admin");
assert.strictEqual(staff.staffProfileFromPayload({ conf: { staff: { role: "owner", active: false } } }).role, "none");
assert.strictEqual(staff.staffProfileFromPayload({ conf: {} }).role, "none");

assert.strictEqual(staff.staffHasCapability("helper", "kick"), true);
assert.strictEqual(staff.staffHasCapability("helper", "panel"), false);
assert.strictEqual(staff.staffHasCapability("moderator", "private_room"), true);
assert.strictEqual(staff.staffHasCapability("moderator", "spectator"), true);
assert.strictEqual(staff.staffHasCapability("helper", "spectator"), false);
assert.strictEqual(staff.staffHasCapability("moderator", "ban"), false);
assert.strictEqual(staff.staffHasCapability("admin", "ban"), true);

const source = {
  playerId: 10,
  playerName: "[MODER] Smoke",
  staffRole: "moderator",
  room: { name: "staff-room", map: "Arena_3lvl" },
};
const helperTarget = { playerId: 20, staffRole: "helper" };
const developerTarget = { playerId: 30, staffRole: "developer" };
const ownerSource = { playerId: 40, staffRole: "owner" };
assert.strictEqual(staff.cachedStaffCanModerate(source, helperTarget, "kick"), true);
assert.strictEqual(staff.cachedStaffCanModerate(source, source, "kick"), false);
assert.strictEqual(staff.cachedStaffCanModerate(ownerSource, developerTarget, "kick"), false);

assert.strictEqual(staff.roomPasswordMatches({ password: "secret" }, "secret"), true);
assert.strictEqual(staff.roomPasswordMatches({ password: "secret" }, "Secret"), false);
assert.strictEqual(staff.roomPasswordMatches({ password: "" }, ""), true);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(staff.parseStaffChatCommand("/__staff kick 20 repeated%20spam"))),
  { action: "kick", targetPlayerId: 20, durationMinutes: 0, reason: "repeated spam" },
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(staff.parseStaffChatCommand("/__staff ban 20 60 repeated%20spam"))),
  { action: "ban", targetPlayerId: 20, durationMinutes: 60, reason: "repeated spam" },
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(staff.parseStaffChatCommand("/__staff ban 20 0 permanent"))),
  { action: "ban", targetPlayerId: 20, durationMinutes: 0, reason: "permanent" },
);
assert.strictEqual(staff.parseStaffChatCommand("hello"), null);
assert.strictEqual(staff.parseStaffChatCommand("/__staff kick 20 %E0%A4%A").action, "invalid");
assert.strictEqual(staff.parseStaffChatCommand("/__staff dev infinite_ammo 1").action, "invalid");
const unicodeReason = "漢".repeat(300);
assert.strictEqual(
  staff.parseStaffChatCommand(`/__staff ban 20 1440 ${encodeURIComponent(unicodeReason)}`).reason,
  unicodeReason,
);
assert.strictEqual(
  staff.roomPlayableOccupancy({
    players: new Map([
      [1, { isGuest: false }],
      [2, { isGuest: true }],
      [3, {}],
    ]),
  }),
  2,
);

const guestActor = staff.readTypedRaw(staff.makeActorDataRaw(null, {
  authId: 10,
  name: "[MODER] Smoke",
  level: 40,
}, {
  isGuest: true,
}), 0);
const guestActorInfo = staff.htGet(guestActor, 96);
assert(guestActorInfo, "guest actor must contain ActorInfo at actorData[96]");
assert.strictEqual(staff.htGet(guestActor, 4), undefined, "IsGuest must not be serialized at actorData[4]");
assert.strictEqual(staff.htGet(guestActorInfo, 4).value, true, "CombatPlayer.Init expects IsGuest at actorData[96][4]");

const regularActor = staff.readTypedRaw(staff.makeActorDataRaw(null, {
  authId: 11,
  name: "Regular",
  level: 1,
}, {
  isGuest: false,
}), 0);
assert.strictEqual(staff.htGet(staff.htGet(regularActor, 96), 4), undefined, "regular actor must not receive IsGuest");

function makeInstantKickRequest(targetPlayerId, targetActorId, reasonCode = 4) {
  return staff.parsePhotonRequest(Buffer.concat([
    Buffer.from([0xf3, 0x02, 0xfd]),
    staff.rawParamTable([
      { key: 244, value: staff.rawByte(70) },
      {
        key: 245,
        value: staff.rawHashtable([
          { key: staff.rawByte(1), value: staff.rawInt(targetPlayerId) },
          { key: staff.rawByte(5), value: staff.rawInt(targetActorId) },
          { key: staff.rawByte(9), value: staff.rawByte(reasonCode) },
        ]),
      },
    ]),
  ]));
}

function makeKickBallotRequest(targetPlayerId, targetActorId, ballot) {
  return staff.parsePhotonRequest(Buffer.concat([
    Buffer.from([0xf3, 0x02, 0xfd]),
    staff.rawParamTable([
      { key: 244, value: staff.rawByte(70) },
      {
        key: 245,
        value: staff.rawHashtable([
          { key: staff.rawByte(1), value: staff.rawInt(targetPlayerId) },
          { key: staff.rawByte(5), value: staff.rawInt(targetActorId) },
          { key: staff.rawByte(2), value: staff.rawBool(ballot) },
        ]),
      },
    ]),
  ]));
}

function makeStaffChatRequest(message) {
  return staff.parsePhotonRequest(Buffer.concat([
    Buffer.from([0xf3, 0x02, 0xfd]),
    staff.rawParamTable([
      { key: 244, value: staff.rawByte(155) },
      {
        key: 245,
        value: staff.rawHashtable([
          { key: staff.rawByte(77), value: staff.rawString(message) },
          { key: staff.rawByte(80), value: staff.rawByte(248) },
        ]),
      },
    ]),
  ]));
}

function eventData(payload) {
  return staff.readParameterTable(payload, 3).params;
}

(async () => {
  const approved = await staff.requestStaffActionApproval(
    source,
    20,
    "kick",
    "repeated spam",
    0,
    helperTarget,
    { minimumRole: "moderator", source: "panel" },
  );
  assert.strictEqual(approved.ok, true);
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(fetchCalls[0].url, "https://staff-smoke.invalid/battle/admin/action");
  assert.strictEqual(fetchCalls[0].options.headers["x-battle-token"], "staff-smoke-token");
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.deepStrictEqual(body, {
    action: "kick",
    actorPlayerId: 10,
    targetPlayerId: 20,
    durationMinutes: 0,
    reason: "repeated spam",
    roomName: "staff-room",
    mapName: "Arena_3lvl",
    minimumRole: "moderator",
    source: "panel",
  });

  const callsBeforeDenied = fetchCalls.length;
  const selfDenied = await staff.requestStaffActionApproval(source, 10, "kick", "self", 0, source);
  assert.strictEqual(selfDenied.ok, false);
  const roleDenied = await staff.requestStaffActionApproval(source, 20, "ban", "no permission", 60, helperTarget);
  assert.strictEqual(roleDenied.ok, false);
  assert.strictEqual(fetchCalls.length, callsBeforeDenied + 1);

  approvalPayload = {
    ok: true,
    actorRole: "owner",
    targetRole: "developer",
  };
  const equalRankDenied = await staff.requestStaffActionApproval(ownerSource, 30, "kick", "protected", 0, developerTarget);
  assert.strictEqual(equalRankDenied.ok, false);
  assert.strictEqual(fetchCalls.length, callsBeforeDenied + 2);

  approvalPayload = {
    ok: true,
    actorRole: "moderator",
    targetRole: "none",
  };
  const freshlyGranted = { playerId: 50, staffRole: "none", room: source.room };
  const ordinaryTarget = { playerId: 60, staffRole: "none" };
  const freshApproved = await staff.requestStaffActionApproval(
    freshlyGranted,
    60,
    "kick",
    "fresh grant",
    0,
    ordinaryTarget,
    { minimumRole: "moderator", source: "panel" },
  );
  assert.strictEqual(freshApproved.ok, true);
  assert.strictEqual(freshlyGranted.staffRole, "moderator");

  approvalPayload = {
    ok: true,
    actor: { role: "helper" },
    target: { role: "none" },
  };
  const liveSource = {
    actorId: 3,
    playerId: 10,
    playerName: "[HELPER] Smoke",
    staffRole: "helper",
    transportDisconnected: false,
  };
  const liveTarget = {
    actorId: 7,
    playerId: 20,
    playerName: "Target",
    staffRole: "none",
    transportDisconnected: false,
  };
  const liveRoom = {
    name: "staff-room",
    map: "Arena_3lvl",
    players: new Map([[3, liveSource], [7, liveTarget]]),
  };
  liveSource.room = liveRoom;
  liveTarget.room = liveRoom;

  const callsBeforeContractRejects = fetchCalls.length;
  assert.strictEqual(
    (await staff.handleOperation(5055, null, null, liveSource, makeInstantKickRequest(20, 8), 0)).length,
    0,
    "forged actor id must be rejected",
  );
  assert.strictEqual(
    (await staff.handleOperation(5055, null, null, liveSource, makeInstantKickRequest(20, 7, 0), 0)).length,
    0,
    "unknown kick reason must be rejected",
  );
  assert.strictEqual(fetchCalls.length, callsBeforeContractRejects, "rejected Event70 reached the API");

  const kickResponses = await staff.handleOperation(
    5055,
    null,
    null,
    liveSource,
    makeInstantKickRequest(20, 7),
    0,
  );
  assert.strictEqual(kickResponses.length, 2, "Instant Event70 must return start and accepted events");
  assert(kickResponses.every((payload) => Buffer.isBuffer(payload) && payload[2] === 70));

  const startedParams = eventData(kickResponses[0]);
  const startedData = startedParams.get(245);
  assert.strictEqual(startedParams.get(254).value, 3);
  assert.strictEqual(staff.htGet(startedData, 1).value, 20);
  assert.strictEqual(staff.htGet(startedData, 5).value, 7);
  assert.strictEqual(staff.htGet(startedData, 6).value, 1);
  assert.strictEqual(staff.htGet(startedData, 7).value, 0);
  assert.strictEqual(staff.htGet(startedData, 9).value, 4);
  assert.strictEqual(staff.htGet(startedData, 10).value, "Target");
  assert.strictEqual(staff.htGet(startedData, 11).value, "[HELPER] Smoke");

  const acceptedParams = eventData(kickResponses[1]);
  const acceptedData = acceptedParams.get(245);
  assert.strictEqual(staff.htGet(acceptedData, 1).value, 20);
  assert.strictEqual(staff.htGet(acceptedData, 2).value, true);
  assert.strictEqual(staff.htGet(acceptedData, 6).value, 1);
  assert.strictEqual(staff.htGet(acceptedData, 7).value, 0);
  assert.strictEqual(liveTarget.moderationDisconnectPending, true);
  assert.strictEqual(liveTarget.moderationDisconnectAction, "kick");

  const kickApiCall = fetchCalls[fetchCalls.length - 1];
  assert.strictEqual(kickApiCall.url, "https://staff-smoke.invalid/battle/admin/action");
  assert.deepStrictEqual(JSON.parse(kickApiCall.options.body), {
    action: "kick",
    actorPlayerId: 10,
    targetPlayerId: 20,
    durationMinutes: 0,
    reason: "instant-kick",
    roomName: "staff-room",
    mapName: "Arena_3lvl",
    minimumRole: "helper",
    source: "event70",
  });

  approvalPayload = {
    ok: true,
    actor: { role: "moderator" },
    target: { role: "none" },
  };
  const voteSource = {
    actorId: 11,
    playerId: 70,
    playerName: "[MODER] Vote",
    staffRole: "moderator",
    transportDisconnected: false,
  };
  const voteVoter = {
    actorId: 12,
    playerId: 71,
    playerName: "[HELPER] Voter",
    staffRole: "helper",
    transportDisconnected: false,
  };
  const voteTarget = {
    actorId: 13,
    playerId: 72,
    playerName: "Vote Target",
    staffRole: "none",
    transportDisconnected: false,
  };
  const voteRoom = {
    name: "vote-room",
    map: "Arena_3lvl",
    players: new Map([[11, voteSource], [12, voteVoter], [13, voteTarget]]),
  };
  voteSource.room = voteRoom;
  voteVoter.room = voteRoom;
  voteTarget.room = voteRoom;

  const voteCallsBefore = fetchCalls.length;
  const voteStart = await staff.handleOperation(
    5055,
    null,
    null,
    voteSource,
    makeInstantKickRequest(72, 13, 2),
    0,
  );
  assert.strictEqual(voteStart.length, 1, "Threats must start a timed Event70 vote");
  const voteStartParams = eventData(voteStart[0]);
  const voteStartData = voteStartParams.get(245);
  assert.strictEqual(staff.htGet(voteStartData, 1).value, 72);
  assert.strictEqual(staff.htGet(voteStartData, 5).value, 13);
  assert.strictEqual(staff.htGet(voteStartData, 6).value, 1);
  assert.strictEqual(staff.htGet(voteStartData, 7).value, 0);
  assert.strictEqual(staff.htGet(voteStartData, 9).value, 2);
  assert.strictEqual(staff.htGet(voteStartData, 10).value, "Vote Target");
  assert.strictEqual(staff.htGet(voteStartData, 11).value, "[MODER] Vote");
  assert.strictEqual(voteRoom.kickVote.threshold, 2);
  assert.strictEqual(voteRoom.kickVote.eligibleActorIds.size, 2);
  assert.strictEqual(fetchCalls.length, voteCallsBefore + 1);
  assert.deepStrictEqual(JSON.parse(fetchCalls[voteCallsBefore].options.body), {
    action: "kick",
    actorPlayerId: 70,
    targetPlayerId: 72,
    durationMinutes: 0,
    reason: "vote-threats",
    roomName: "vote-room",
    mapName: "Arena_3lvl",
    minimumRole: "helper",
    source: "event70",
    authorizeOnly: true,
  });

  const voteAccepted = await staff.handleOperation(
    5055,
    null,
    null,
    voteVoter,
    makeKickBallotRequest(72, 13, true),
    0,
  );
  assert.strictEqual(voteAccepted.length, 2, "majority YES must return update and accepted result");
  const voteUpdateData = eventData(voteAccepted[0]).get(245);
  const voteResultData = eventData(voteAccepted[1]).get(245);
  assert.strictEqual(staff.htGet(voteUpdateData, 6).value, 2);
  assert.strictEqual(staff.htGet(voteUpdateData, 7).value, 0);
  assert.strictEqual(staff.htGet(voteResultData, 2).value, true);
  assert.strictEqual(staff.htGet(voteResultData, 6).value, 2);
  assert.strictEqual(staff.htGet(voteResultData, 7).value, 0);
  assert.strictEqual(voteRoom.kickVote, null);
  assert.strictEqual(voteTarget.moderationDisconnectPending, true);
  assert.strictEqual(fetchCalls.length, voteCallsBefore + 2, "accepted vote must be authorized again before disconnect");
  const voteActionBody = JSON.parse(fetchCalls[voteCallsBefore + 1].options.body);
  assert.strictEqual(voteActionBody.reason, "vote-threats");
  assert.strictEqual(Object.hasOwn(voteActionBody, "authorizeOnly"), false);

  approvalPayload = {
    ok: true,
    actor: { role: "helper" },
    target: { role: "none" },
  };
  const rejectSource = {
    actorId: 21,
    playerId: 80,
    playerName: "[HELPER] Reject",
    staffRole: "helper",
    transportDisconnected: false,
  };
  const rejectVoter = {
    actorId: 22,
    playerId: 81,
    playerName: "[HELPER] No",
    staffRole: "helper",
    transportDisconnected: false,
  };
  const rejectTarget = {
    actorId: 23,
    playerId: 82,
    playerName: "Reject Target",
    staffRole: "none",
    transportDisconnected: false,
  };
  const rejectRoom = {
    name: "vote-reject-room",
    map: "Arena_3lvl",
    players: new Map([[21, rejectSource], [22, rejectVoter], [23, rejectTarget]]),
  };
  rejectSource.room = rejectRoom;
  rejectVoter.room = rejectRoom;
  rejectTarget.room = rejectRoom;
  const rejectCallsBefore = fetchCalls.length;
  assert.strictEqual(
    (await staff.handleOperation(5055, null, null, rejectSource, makeInstantKickRequest(82, 23, 1), 0)).length,
    1,
  );
  const voteRejected = await staff.handleOperation(
    5055,
    null,
    null,
    rejectVoter,
    makeKickBallotRequest(82, 23, false),
    0,
  );
  assert.strictEqual(voteRejected.length, 2, "an impossible majority must finish as rejected");
  const rejectedResultData = eventData(voteRejected[1]).get(245);
  assert.strictEqual(staff.htGet(rejectedResultData, 2).value, false);
  assert.strictEqual(staff.htGet(rejectedResultData, 6).value, 1);
  assert.strictEqual(staff.htGet(rejectedResultData, 7).value, 1);
  assert.strictEqual(rejectTarget.moderationDisconnectPending, undefined);
  assert.strictEqual(fetchCalls.length, rejectCallsBefore + 1, "rejected vote must not write a kick action");

  const singleSource = {
    actorId: 24,
    playerId: 83,
    playerName: "[HELPER] Solo",
    staffRole: "helper",
    transportDisconnected: false,
  };
  const singleTarget = {
    actorId: 25,
    playerId: 84,
    playerName: "Solo Target",
    staffRole: "none",
    transportDisconnected: false,
  };
  const singleRoom = {
    name: "vote-single-room",
    map: "Arena_3lvl",
    players: new Map([[24, singleSource], [25, singleTarget]]),
  };
  singleSource.room = singleRoom;
  singleTarget.room = singleRoom;
  const singleCallsBefore = fetchCalls.length;
  assert.strictEqual(
    (await staff.handleOperation(5055, null, null, singleSource, makeInstantKickRequest(84, 25, 3), 0)).length,
    1,
  );
  assert.strictEqual(singleRoom.kickVote.threshold, 1);
  assert.strictEqual(singleTarget.moderationDisconnectPending, undefined, "single eligible vote must remain visible until timeout");
  const singleResult = await staff.finishRoomKickVote(singleRoom.kickVote, true, 0, "timeout-test");
  assert.strictEqual(staff.htGet(eventData(singleResult).get(245), 2).value, true);
  assert.strictEqual(singleTarget.moderationDisconnectPending, true);
  assert.strictEqual(fetchCalls.length, singleCallsBefore + 2);

  approvalPayload = {
    ok: true,
    actor: { role: "admin" },
    target: { role: "none" },
  };
  const banSource = {
    actorId: 31,
    playerId: 90,
    playerName: "[ADMIN] Ban",
    staffRole: "admin",
    transportDisconnected: false,
  };
  const banTarget = {
    actorId: 32,
    playerId: 91,
    playerName: "Ban Target",
    staffRole: "none",
    transportDisconnected: false,
  };
  const banRoom = {
    name: "ban-room",
    map: "Arena_3lvl",
    players: new Map([[31, banSource], [32, banTarget]]),
  };
  banSource.room = banRoom;
  banTarget.room = banRoom;
  staff.sessions.set("ban-source-smoke", banSource);
  staff.sessions.set("ban-target-smoke", banTarget);
  const banCallsBefore = fetchCalls.length;
  const banResponses = await staff.handleOperation(
    5055,
    null,
    null,
    banSource,
    makeStaffChatRequest(`/__staff ban 91 1440 ${encodeURIComponent("нарушение")}`),
    0,
  );
  assert.strictEqual(banResponses.length, 0, "staff ban command must never leak into battle chat");
  assert.strictEqual(banTarget.moderationDisconnectPending, true);
  assert.strictEqual(banTarget.moderationDisconnectAction, "ban");
  assert.deepStrictEqual(JSON.parse(fetchCalls[banCallsBefore].options.body), {
    action: "ban",
    actorPlayerId: 90,
    targetPlayerId: 91,
    durationMinutes: 1440,
    reason: "нарушение",
    roomName: "ban-room",
    mapName: "Arena_3lvl",
    minimumRole: "admin",
    source: "panel",
  });
  staff.sessions.delete("ban-source-smoke");
  staff.sessions.delete("ban-target-smoke");

  const deniedActor = staff.readTypedRaw(staff.rawHashtable([
    { key: staff.rawByte(241), value: staff.rawInt(91) },
    { key: staff.rawByte(240), value: staff.rawString("ban-key") },
    { key: staff.rawByte(242), value: staff.rawString("Ban Target") },
  ]), 0).value;
  staff.profileCache.set("91:ban-key", {
    loadedAt: Date.now(),
    profile: { authId: 91, authKey: "ban-key", name: "Ban Target", staffRole: "none" },
  });
  profileAccessDenied = true;
  const deniedJoinProfile = await staff.profileForJoin(deniedActor, { forceRefresh: true });
  profileAccessDenied = false;
  assert.strictEqual(deniedJoinProfile.source, "access-denied");
  assert.strictEqual(deniedJoinProfile.profile.isFallback, true);
  assert.strictEqual(deniedJoinProfile.profile.accessDenied, true);
  assert.notStrictEqual(deniedJoinProfile.profile, staff.profileCache.get("91:ban-key")?.profile);

  const kickDisconnectEvent = staff.makeModerationDisconnectEvent({ actorId: 7 }, "kick");
  assert(Buffer.isBuffer(kickDisconnectEvent));
  assert.strictEqual(kickDisconnectEvent[2], 104);
  const kickDisconnectData = eventData(kickDisconnectEvent).get(245);
  assert.strictEqual(staff.htGet(kickDisconnectData, 1), undefined);

  const banDisconnectEvent = staff.makeModerationDisconnectEvent({ actorId: 7 }, "ban");
  assert(Buffer.isBuffer(banDisconnectEvent));
  assert.strictEqual(banDisconnectEvent[2], 104);
  const banDisconnectData = eventData(banDisconnectEvent).get(245);
  assert.strictEqual(staff.htGet(banDisconnectData, 1).value, 1);
  const instantKickEvent = staff.makeInstantKickEvent(
    { actorId: 3, playerId: 10, playerName: "[HELPER] Smoke" },
    { actorId: 7, playerId: 20, playerName: "Target" },
  );
  assert(Buffer.isBuffer(instantKickEvent));
  assert.strictEqual(instantKickEvent[2], 70);

  assert(serverSource.includes('rawOperationResponse(255, [], -12, "invalid-password")'));
  assert(serverSource.includes('staffHasCapability(profile.staffRole, "private_room")'));
  assert(serverSource.includes('staffHasCapability(profile.staffRole, "spectator")'));
  assert(serverSource.includes("session.isGuest = staffSpectator"));
  assert(serverSource.includes("CombatPlayer.Init() reads IsGuest from ActorInfo = actorData[96], key 4"));
  assert(serverSource.includes("playerSession?.isGuest"));
  assert(!serverSource.includes('postApiJson("/battle/staff/control"'));
  assert(!serverSource.includes("developerInfiniteAmmo"));
  assert(!serverSource.includes("developerInfiniteHp"));
  assert(!serverSource.includes("shotgun_recoil"));
  assert(serverSource.includes("eventCode === 70"));
  assert(serverSource.includes('postApiJson("/battle/admin/action"'));
  assert(serverSource.includes("{ key: rawByte(5), value: rawInt(targetSession.actorId) }"));

  console.log(`OK build=${staff.BUILD_ID} roles=helper/moderator/admin/owner=developer spectator=actorData[96][4]+no-spawn+slot-bypass dev-gameplay=removed privateRoom=exact-password kick=instant+vote-start/update/result+majority+api+disconnect ban=chat-suppressed+api+disconnect+cached-rejoin-denied`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
