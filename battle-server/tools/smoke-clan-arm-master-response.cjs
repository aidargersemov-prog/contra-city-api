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
};
`;
const source = `${fs.readFileSync(serverPath, "utf8")}\n${exportsSource}`;
vm.createContext(sandbox);
new vm.Script(source, { filename: serverPath }).runInContext(sandbox);

async function main() {
  const battle = sandbox.__battleSmoke;
  assert.strictEqual(battle.BUILD_ID, "battle-server-2026-07-29-staff-spectator-dev-v286");

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

  console.log(`OK build=${battle.BUILD_ID} responses=${responses.length} commands=${commands.length} cache=${session.reliableResponses.get("0:0:77").length}`);
  console.log(`RESPONSE_HEX=${responses[0].toString("hex")}`);
  console.log(eventLog);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
