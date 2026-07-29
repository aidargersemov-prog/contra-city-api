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
  requestDeveloperControlApproval,
  roomPlayableOccupancy,
  makeModerationDisconnectEvent,
  makeInstantKickEvent,
  readTypedRaw,
};
`;

vm.createContext(sandbox);
new vm.Script(`${serverSource}\n${exportsSource}`, { filename: serverPath }).runInContext(sandbox);
const staff = sandbox.__staffSmoke;

assert.strictEqual(staff.BUILD_ID, "battle-server-2026-07-29-staff-spectator-dev-v286");
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
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(staff.parseStaffChatCommand("/__staff dev infinite_ammo 1"))),
  { action: "developer", control: "infinite_ammo", enabled: true, value: 1 },
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(staff.parseStaffChatCommand("/__staff dev shotgun_recoil 100"))),
  { action: "developer", control: "shotgun_recoil", enabled: true, value: 100 },
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
    actor: { role: "developer" },
    control: "infinite_ammo",
    enabled: true,
    value: 1,
  };
  const developerSession = { playerId: 70, staffRole: "none" };
  const developerApproved = await staff.requestDeveloperControlApproval(
    developerSession,
    { control: "infinite_ammo", enabled: true, value: 1 },
  );
  assert.strictEqual(developerApproved.ok, true);
  assert.strictEqual(developerSession.staffRole, "developer");
  const developerCall = fetchCalls[fetchCalls.length - 1];
  assert.strictEqual(developerCall.url, "https://staff-smoke.invalid/battle/staff/control");
  assert.deepStrictEqual(JSON.parse(developerCall.options.body), {
    actorPlayerId: 70,
    control: "infinite_ammo",
    enabled: true,
    value: 1,
  });

  const disconnectEvent = staff.makeModerationDisconnectEvent({ actorId: 7 });
  assert(Buffer.isBuffer(disconnectEvent));
  assert.strictEqual(disconnectEvent[2], 104);
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
  assert(serverSource.includes("playerSession?.isGuest"));
  assert(serverSource.includes('postApiJson("/battle/staff/control"'));
  assert(serverSource.includes("eventCode === 70"));
  assert(serverSource.includes('postApiJson("/battle/admin/action"'));
  assert(serverSource.includes("{ key: rawByte(5), value: rawInt(targetSession.actorId) }"));

  console.log(`OK build=${staff.BUILD_ID} roles=helper/moderator/admin/owner=developer spectator=guest+slot-bypass dev=api-authorized privateRoom=exact-password kick=event70+api ban=api+disconnect`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
