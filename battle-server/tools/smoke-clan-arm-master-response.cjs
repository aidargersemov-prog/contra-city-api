const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextDecoder } = require("util");

const serverPath = path.resolve(__dirname, "..", "server.js");
const serverDir = path.dirname(serverPath);
const logs = [];
const inertTimer = { unref() {} };

function inertUdpSocket() {
  return {
    on() { return this; },
    bind(_port, _host, callback) {
      if (typeof callback === "function") callback();
      return this;
    },
    send() {},
    close() {},
  };
}

function inertTcpServer() {
  return {
    maxConnections: 0,
    on() { return this; },
    listen(_port, _host, callback) {
      if (typeof callback === "function") callback();
      return this;
    },
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
  fetch: async () => ({
    json: async () => ({}),
    ok: false,
    status: 503,
    text: async () => "",
  }),
  process: {
    env: {
      BATTLE_EVENT_TOKEN: "smoke-token",
      BATTLE_PORTS: "5055,5057",
      CLAN_TREASURY_POLL_MS: "750",
      PUBLIC_HOST: "127.0.0.1",
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
globalThis.__battleSmoke = {
  BUILD_ID,
  cacheReliableResponse,
  handleMasterEvent,
  makeReliableCommandsForPayload,
  parsePhotonRequest,
  profileCache,
};
`;
const source = `${fs.readFileSync(serverPath, "utf8")}\n${exportsSource}`;
vm.createContext(sandbox);
new vm.Script(source, { filename: serverPath }).runInContext(sandbox);

async function main() {
  const battle = sandbox.__battleSmoke;
  assert.strictEqual(battle.BUILD_ID, "battle-server-2026-07-30-clan-delete-v292");

  // Exact client Event209/ChangeArm request captured in the AWS trace:
  // user=4, clan=2, arm=3, cost=1500.
  const request = Buffer.from(
    "f302fd0002f56800036200690000000562016900000002620268000269000000006900000003690000000169000005dcf462d1",
    "hex"
  );
  const parsed = battle.parsePhotonRequest(request);
  const session = {
    actorId: 1,
    lastChannel: 0,
    playerId: 4,
    reliableResponses: new Map(),
    serverSeq: 1,
    serverSeqByChannel: new Map(),
  };

  const responses = await battle.handleMasterEvent(session, parsed);
  assert.strictEqual(responses.length, 1, "ChangeArm must return one Event209 to its sender");
  assert.strictEqual(responses[0][0], 0xf3, "sender response must retain the Photon payload marker");
  assert.strictEqual(responses[0][1], 0x04, "sender response must be a Photon EventData payload");
  assert.strictEqual(responses[0][2], 209, "sender response must retain Event209");

  const commands = responses.flatMap((payload) => battle.makeReliableCommandsForPayload(session, payload, 0));
  assert.strictEqual(commands.length, 1, "ChangeArm sender Event209 must produce one reliable command");
  battle.cacheReliableResponse(session, "0:0:77", commands);
  assert.strictEqual(session.reliableResponses.get("0:0:77").length, 1, "replay cache must retain Event209");

  const eventLog = logs.find((line) => line.includes("[master-social] clan-event") && line.includes("code=5"));
  assert(eventLog, "ChangeArm master log is missing");
  assert(eventLog.includes("response=1"), "ChangeArm must report sender reliable response");
  assert(eventLog.includes("peers=0"), "single-session smoke must not direct-send a duplicate sender echo");

  // DeleteClanLazy sends ClanEventCode.AddEvent=20 after the HTTP commit.
  // Reuse the exact client request shape above, changing only event code and
  // nested subject id; the extra arm-cost field is ignored by AddEvent.
  const deleteRequest = Buffer.from(request);
  const codeOffset = deleteRequest.indexOf(Buffer.from("62006900000005", "hex"));
  assert(codeOffset >= 0, "cannot locate clan event code in captured request");
  deleteRequest.writeInt32BE(20, codeOffset + 3);
  const subjectOffset = deleteRequest.indexOf(Buffer.from("69000000006900000003", "hex"));
  assert(subjectOffset >= 0, "cannot locate nested subject id in captured request");
  deleteRequest.writeInt32BE(4, subjectOffset + 6);

  battle.profileCache.set("4:key", {
    loadedAt: Date.now(),
    profile: { authId: 4, clan: { cid: 2, aid: 3, t: "OLD" } },
  });
  const deleteResponses = await battle.handleMasterEvent(session, battle.parsePhotonRequest(deleteRequest));
  assert.strictEqual(deleteResponses.length, 1, "AddEvent must return one Event209 to its sender");
  assert.strictEqual(deleteResponses[0][2], 209, "AddEvent sender response must retain Event209");
  assert.strictEqual(battle.profileCache.has("4:key"), false, "deleted clan profile cache must be invalidated");

  const deleteCommands = deleteResponses.flatMap((payload) => battle.makeReliableCommandsForPayload(session, payload, 0));
  assert.strictEqual(deleteCommands.length, 1, "AddEvent sender Event209 must produce one reliable command");
  battle.cacheReliableResponse(session, "0:0:78", deleteCommands);
  assert.strictEqual(session.reliableResponses.get("0:0:78").length, 1, "AddEvent replay cache must retain Event209");

  const deleteLog = logs.find((line) => line.includes("[master-social] clan-event") && line.includes("code=20"));
  assert(deleteLog, "AddEvent master log is missing");
  assert(deleteLog.includes("response=1"), "AddEvent must report sender reliable response");
  assert(deleteLog.includes("profileCache=1"), "AddEvent must report clan profile invalidation");

  console.log(`OK build=${battle.BUILD_ID} armResponses=${responses.length} deleteResponses=${deleteResponses.length} armCache=${session.reliableResponses.get("0:0:77").length} deleteCache=${session.reliableResponses.get("0:0:78").length}`);
  console.log(`RESPONSE_HEX=${responses[0].toString("hex")}`);
  console.log(eventLog);
  console.log(deleteLog);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
