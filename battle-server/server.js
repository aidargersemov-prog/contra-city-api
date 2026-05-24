const dgram = require("dgram");
const net = require("net");

const PORTS = (process.env.BATTLE_PORTS || "5055,5056,5057,5058,5255")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Boolean);
const API_BASE_URL = (process.env.API_BASE_URL || "https://contra-city-api.onrender.com").replace(/\/+$/, "");
const API_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "54.145.212.225";
const SERVER_NAME = process.env.SERVER_NAME || "Contra City";
const BUILD_ID = "battle-server-2026-05-24-no-zero-pulses-compact-actor-v60";
const FORCE_TEAM_MODE = process.env.FORCE_TEAM_MODE === "1";
const AUTO_SPAWN_AFTER_GAMESTATE = process.env.AUTO_SPAWN_AFTER_GAMESTATE === "1";
const AUTO_SPAWN_RETRY_LIMIT = Number(process.env.AUTO_SPAWN_RETRY_LIMIT || 8);
const AUTO_SPAWN_RETRY_MS = Number(process.env.AUTO_SPAWN_RETRY_MS || 250);
const SPAWN_NO_MOVE_WARN_MS = Math.max(0, Number(process.env.SPAWN_NO_MOVE_WARN_MS || 2500));
const DEBUG_PACKETS = process.env.DEBUG_PACKETS === "1";
const DEBUG_MOVE_PACKETS = process.env.DEBUG_MOVE_PACKETS === "1";
const LOG_SEND_PACKETS = DEBUG_PACKETS || process.env.LOG_SEND_PACKETS === "1";
const ACTOR_JOIN_ASYNC_DELAY_MS = Math.max(0, Number(process.env.ACTOR_JOIN_ASYNC_DELAY_MS || 1500));
const MOVE_LOG_EVERY = Math.max(1, Number(process.env.MOVE_LOG_EVERY || 100));
const SPAWN_INDEX = Number(process.env.SPAWN_INDEX || 0);
const SPAWN_Y_OFFSET = Number(process.env.SPAWN_Y_OFFSET || 0);
const DEFAULT_TEAM = Number(process.env.DEFAULT_TEAM || 1);
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || "restore-room";
const DEFAULT_MAP = process.env.DEFAULT_MAP || "Arena_3lvl";
const INIT_REPLY = ["callback", "legacy", "both"].includes((process.env.INIT_REPLY || "").toLowerCase())
  ? process.env.INIT_REPLY.toLowerCase()
  : "callback";
const PUSH_ROOM_LIST_AFTER_INIT = process.env.PUSH_ROOM_LIST_AFTER_INIT === "1";
const PROFILE_CACHE_TTL_MS = Number(process.env.PROFILE_CACHE_TTL_MS || 30000);
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS || 300000);
const PROFILE_JOIN_WAIT_MS = Math.max(0, Number(process.env.PROFILE_JOIN_WAIT_MS || 1000));
const JOIN_LOADOUT_SLOT_LIMIT = Math.max(1, Math.min(7, Number(process.env.JOIN_LOADOUT_SLOT_LIMIT || 7)));
const INCLUDE_WEAPON_LEGACY_FIELDS = process.env.INCLUDE_WEAPON_LEGACY_FIELDS === "1";
const INCLUDE_JOIN_WEARS = process.env.INCLUDE_JOIN_WEARS === "1";
const INCLUDE_JOIN_ACTOR_ECHO_FIELDS = process.env.INCLUDE_JOIN_ACTOR_ECHO_FIELDS === "1";
const INCLUDE_ACTOR_IN_GAMESTATE = process.env.INCLUDE_ACTOR_IN_GAMESTATE === "1";
const INCLUDE_PEERS_IN_GAMESTATE = process.env.INCLUDE_PEERS_IN_GAMESTATE === "1";
const GAMESTATE_REPEAT_MIN_MS = Math.max(0, Number(process.env.GAMESTATE_REPEAT_MIN_MS || 750));
const MAX_UDP_PACKET_BYTES = Math.max(0, Number(process.env.MAX_UDP_PACKET_BYTES || 1200));
const JOIN_SELF_EVENT_DELAY_MS = Math.max(0, Number(process.env.JOIN_SELF_EVENT_DELAY_MS || 600));
const JOIN_SELF_PROFILE_WAIT_MS = Math.max(JOIN_SELF_EVENT_DELAY_MS, Number(process.env.JOIN_SELF_PROFILE_WAIT_MS || 2500));
const JOIN_PROFILE_RETRY_MS = Math.max(250, Number(process.env.JOIN_PROFILE_RETRY_MS || 1000));
const JOIN_PROFILE_MAX_WAIT_MS = Math.max(JOIN_SELF_PROFILE_WAIT_MS, Number(process.env.JOIN_PROFILE_MAX_WAIT_MS || 70000));
const ALLOW_FALLBACK_JOIN_PROFILE = process.env.ALLOW_FALLBACK_JOIN_PROFILE === "1";
const JOIN_SETTINGS_PUSH_DELAYS_MS = parseDelayList(process.env.JOIN_SETTINGS_PUSH_DELAYS_MS || "");
const JOIN_START_EVENT_FALLBACK_DELAY_MS = Math.max(0, Number(process.env.JOIN_START_EVENT_FALLBACK_DELAY_MS || 0));
const JOIN_LATE_START_DELAYS_MS = parseDelayList(process.env.JOIN_LATE_START_DELAYS_MS || "");
const DESTROY_GEOMETRY = process.env.DESTROY_GEOMETRY === "1";
const NORMALIZE_WEAPON_RAPIDITY = process.env.NORMALIZE_WEAPON_RAPIDITY !== "0";
const SHOT_THROTTLE_SLACK_MS = Math.max(0, Number(process.env.SHOT_THROTTLE_SLACK_MS || 20));
const ENABLE_MAP_PICKUPS = process.env.ENABLE_MAP_PICKUPS === "1";
const ITEM_RESPAWN_MS = Math.max(0, Number(process.env.ITEM_RESPAWN_MS || 30000));
const ITEM_PICKUP_RADIUS = Math.max(1, Number(process.env.ITEM_PICKUP_RADIUS || 8));
const REQUIRE_PICKUP_BENEFIT = process.env.REQUIRE_PICKUP_BENEFIT === "1";
const BIKER_SET_HEALTH_FLOOR = Number(process.env.BIKER_SET_HEALTH_FLOOR || 170);
const BIKER_SET_SPEED_FLOOR = Number(process.env.BIKER_SET_SPEED_FLOOR || 0);
const BIKER_SET_WEAPON_SPEED_BONUS = Number(process.env.BIKER_SET_WEAPON_SPEED_BONUS || 0);
const BIKER_SET_SHOTGUN_JUMP_BONUS = Number(process.env.BIKER_SET_SHOTGUN_JUMP_BONUS || 0);
// ShotController uses ActorInfo[92] directly for shotgun air recoil; no per-weapon hidden recoil stat exists in the client.
const SHOTGUN_RECOIL_SMALL_JUMP_BONUS = Number(process.env.SHOTGUN_RECOIL_SMALL_JUMP_BONUS || 2);
const SHOTGUN_RECOIL_JUMP_BONUS = Number(process.env.SHOTGUN_RECOIL_JUMP_BONUS || 4);
const SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS = Number(process.env.SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS || 6);
const BIG_SHOTGUN_RECOIL_JUMP_BONUS = Number(process.env.BIG_SHOTGUN_RECOIL_JUMP_BONUS || 8);
const SHOTGUN_RECOIL_HUGE_JUMP_BONUS = Number(process.env.SHOTGUN_RECOIL_HUGE_JUMP_BONUS || 12);
const MAX_PLAYER_JUMP = Math.max(1, Number(process.env.MAX_PLAYER_JUMP || 32));

const sessions = new Map();
const rooms = new Map();
const profileCache = new Map();
const profileLoads = new Map();
let shopCatalogCache = { loadedAt: 0, weapons: [], wears: [] };
const PROCESS_START_MS = Date.now();
function parseDelayList(value) {
  return String(value || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((delayMs) => Number.isFinite(delayMs) && delayMs > 0);
}

function formatDelayList(delays) {
  return delays.length ? `${delays.join(",")}ms` : "off";
}

const ITEM_TYPES = {
  HEALTH: 101,
  ARMOR: 100,
  AMMO: 99,
};

const RAPIDITY_FLOORS_BY_TYPE = new Map([
  [1, 340],
  [2, 420],
  [3, 240],
  [4, 150],
  [5, 115],
  [6, 125],
  [7, 620],
  [8, 900],
  [9, 900],
  [10, 850],
  [11, 115],
  [12, 115],
  [13, 115],
  [14, 115],
  [15, 900],
]);

const MAP_PICKUP_POINTS = {
  arena_3lvl: [
    { id: 31001, type: ITEM_TYPES.HEALTH, subType: 0, value: 45, x: -18.5, y: -64.1, z: 282.8, rotY: 90 },
    { id: 31002, type: ITEM_TYPES.ARMOR, subType: 0, value: 40, x: 24.0, y: -64.1, z: 304.0, rotY: 0 },
    { id: 31003, type: ITEM_TYPES.AMMO, subType: 0, value: 35, x: 65.5, y: -64.1, z: 289.2, rotY: 270 },
    { id: 31004, type: ITEM_TYPES.HEALTH, subType: 1, value: 25, x: 29.5, y: -40.9, z: 276.8, rotY: 180 },
    { id: 31005, type: ITEM_TYPES.ARMOR, subType: 1, value: 25, x: 73.0, y: -40.9, z: 303.2, rotY: 270 },
    { id: 31006, type: ITEM_TYPES.AMMO, subType: 1, value: 20, x: -14.0, y: -40.9, z: 299.0, rotY: 90 },
    { id: 31007, type: ITEM_TYPES.AMMO, subType: 0, value: 35, x: 51.0, y: -13.7, z: 285.6, rotY: 270 },
    { id: 31008, type: ITEM_TYPES.HEALTH, subType: 1, value: 25, x: 13.0, y: 5.1, z: 292.0, rotY: 0 },
  ],
};
const MAP_SPAWN_POINTS = {
  arena_3lvl: {
    // Extracted from Arena_3lvl.unity3d -> POINTS_RESCALE -> Respawn_T0/T1/T2.
    dm: [
      { x: -71.27, y: 5.0, z: 277.35, rotY: 90 },
      { x: 106.68, y: -13.63, z: 282.31, rotY: 270 },
      { x: 111.88, y: 5.25, z: 295.54, rotY: 270 },
      { x: -45.8, y: -13.89, z: 274.64, rotY: 90 },
      { x: 125.09, y: -40.91, z: 305.86, rotY: 270 },
      { x: -66.15, y: -41.17, z: 271.57, rotY: 90 },
      { x: 125.6, y: -64.1, z: 294.95, rotY: 270 },
      { x: -70.1, y: -64.1, z: 283.02, rotY: 90 },
    ],
    team1: [
      { x: -74.19, y: -64.1, z: 285.35, rotY: 90 },
      { x: -74.19, y: -64.1, z: 278.72, rotY: 90 },
      { x: -70.84, y: -64.1, z: 290.2, rotY: 90 },
      { x: -74.19, y: -64.1, z: 298.13, rotY: 90 },
      { x: -70.84, y: -64.1, z: 277.28, rotY: 90 },
      { x: -74.19, y: -64.1, z: 271.47, rotY: 90 },
      { x: -74.19, y: -64.1, z: 292.17, rotY: 90 },
    ],
    team2: [
      { x: 127.92, y: -64.1, z: 280.28, rotY: 270 },
      { x: 127.92, y: -64.1, z: 285.87, rotY: 270 },
      { x: 127.92, y: -64.1, z: 291.36, rotY: 270 },
      { x: 127.92, y: -64.1, z: 304.04, rotY: 270 },
      { x: 122.84, y: -64.1, z: 299.84, rotY: 270 },
      { x: 127.92, y: -64.1, z: 297.92, rotY: 270 },
      { x: 122.84, y: -64.1, z: 282.49, rotY: 270 },
      { x: 122.84, y: -64.1, z: 292.28, rotY: 270 },
    ],
  },
  zombi_2: {
    // Extracted from mapsnew/Zombi_2_unity3d/MapData/Zombi_2.points.json.
    // Zombi_2 is exposed as Deathmatch-only for now, so only Respawn_T0 is active.
    dm: [
      { x: -70.033, y: -15.715, z: 277.352, rotY: 0 },
      { x: 65.904, y: -15.945, z: 214.208, rotY: 0 },
      { x: 52.837, y: -64.671, z: 323.296, rotY: 270 },
      { x: -59.761, y: -64.608, z: 338.49, rotY: 105 },
      { x: 34.605, y: -13.893, z: 337.558, rotY: 30 },
      { x: 29.135, y: -64.391, z: 219.293, rotY: 270 },
      { x: -51.11, y: -64.992, z: 216.989, rotY: 0 },
      { x: -69.938, y: -64.096, z: 244.364, rotY: 90 },
    ],
  },
};

function photonNow() {
  return Math.max(0, Math.floor(Date.now() - PROCESS_START_MS)) >>> 0;
}

function roomAgeMs(room) {
  const startedAt = Number(room?.startedAt);
  return Number.isFinite(startedAt) ? Math.max(0, photonNow() - startedAt) : 0;
}

function hasEnvSpawnOverride() {
  return process.env.SPAWN_X != null || process.env.SPAWN_Y != null || process.env.SPAWN_Z != null;
}

function envSpawnPoint() {
  return {
    x: Number(process.env.SPAWN_X || 0),
    y: Number(process.env.SPAWN_Y || 2) + (Number.isFinite(SPAWN_Y_OFFSET) ? SPAWN_Y_OFFSET : 0),
    z: Number(process.env.SPAWN_Z || 0),
    rotY: Number(process.env.SPAWN_ROT_Y || 0),
  };
}

function mapKey(value) {
  return String(value || DEFAULT_MAP)
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.unity3d$/i, "")
    .toLowerCase();
}

function pointListFor(session, team) {
  const mapSpawns = MAP_SPAWN_POINTS[mapKey(session.room?.map)];
  if (!mapSpawns) return null;
  if (team === 1 && mapSpawns.team1?.length) return mapSpawns.team1;
  if (team === 2 && mapSpawns.team2?.length) return mapSpawns.team2;
  return mapSpawns.dm?.length ? mapSpawns.dm : null;
}

function preferredDmSpawnPoints(session, team, points) {
  if (team !== 0) return points;
  const map = mapKey(session.room?.map);
  if (map === "arena_3lvl") {
    return points.filter((point) => Number(point.y) <= -60);
  }
  if (map === "zombi_2") {
    return points.filter((point) => Number(point.y) >= -30 && Number(point.y) <= -5);
  }
  return points;
}

function spawnPointFor(session, team) {
  if (hasEnvSpawnOverride()) return envSpawnPoint();

  const points = pointListFor(session, team);
  if (!points?.length) return envSpawnPoint();

  if (Number.isFinite(SPAWN_INDEX) && SPAWN_INDEX !== 0) {
    const point = points[Math.abs(SPAWN_INDEX - 1) % points.length];
    return {
      ...point,
      y: point.y + (Number.isFinite(SPAWN_Y_OFFSET) ? SPAWN_Y_OFFSET : 0),
    };
  }

  // Restored maps can contain exported spawn layers that are not the playable DM floor.
  const preferredPoints = preferredDmSpawnPoints(session, team, points);
  const candidates = preferredPoints.length ? preferredPoints : points;
  const baseIndex = (Number(session.actorId) || 1) - 1;
  const point = candidates[Math.abs(baseIndex) % candidates.length];
  return {
    ...point,
    y: point.y + (Number.isFinite(SPAWN_Y_OFFSET) ? SPAWN_Y_OFFSET : 0),
  };
}

function fmtPoint(point) {
  return `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)},${Number(point.z).toFixed(2)}@${Number(point.rotY || 0).toFixed(0)}`;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

function i16(n) {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n | 0, 0);
  return b;
}

function i64(n) {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(n), 0);
  return b;
}

function f32(n) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(Number(n) || 0, 0);
  return b;
}

function readU16(buf, offset) {
  return buf.readUInt16BE(offset);
}

function readI16(buf, offset) {
  return buf.readInt16BE(offset);
}

function readU32(buf, offset) {
  return buf.readUInt32BE(offset) >>> 0;
}

function readI32(buf, offset) {
  return buf.readInt32BE(offset);
}

function key(port, rinfo) {
  return `${port}:${rinfo.address}:${rinfo.port}`;
}

function makeHeader(peerId, commandCount, sentTime, challenge) {
  return Buffer.concat([
    u16(peerId),
    Buffer.from([0x00, commandCount]),
    u32(sentTime),
    u32(challenge),
  ]);
}

function makeAck(channel, reliableSeq, sentTime) {
  return Buffer.concat([
    Buffer.from([0x01, channel, 0x00, 0x04]),
    u32(20),
    u32(0),
    u32(reliableSeq),
    u32(sentTime),
  ]);
}

function makeVerifyConnect(seq) {
  return Buffer.concat([
    Buffer.from([0x03, 0x00, 0x01, 0x04]),
    u32(44),
    u32(seq),
    Buffer.from("000104b000080000000200000000000000000013880000000200000002", "hex"),
  ]);
}

function makeReliable(seq, payload, channel = 0) {
  return Buffer.concat([
    Buffer.from([0x06, channel, 0x01, 0x04]),
    u32(12 + payload.length),
    u32(seq),
    payload,
  ]);
}

function cacheReliableResponse(session, cacheKey, reliableCommands) {
  session.reliableResponses.set(cacheKey, reliableCommands);
  while (session.reliableResponses.size > 128) {
    const firstKey = session.reliableResponses.keys().next().value;
    session.reliableResponses.delete(firstKey);
  }
  return reliableCommands;
}

function sendPacket(socket, rinfo, session, commands, peerIdOverride = null) {
  const sentTime = photonNow();
  const buildPacket = (packetCommands) => Buffer.concat([
    makeHeader(peerIdOverride ?? session.peerId, packetCommands.length, sentTime, session.challenge),
    ...packetCommands,
  ]);
  const packet = buildPacket(commands);

  if (MAX_UDP_PACKET_BYTES > 0 && commands.length > 1 && packet.length > MAX_UDP_PACKET_BYTES) {
    let chunk = [];
    for (const command of commands) {
      const nextChunk = [...chunk, command];
      if (chunk.length > 0 && buildPacket(nextChunk).length > MAX_UDP_PACKET_BYTES) {
        sendPacket(socket, rinfo, session, chunk, peerIdOverride);
        chunk = [command];
      } else {
        chunk = nextChunk;
      }
    }
    if (chunk.length > 0) {
      sendPacket(socket, rinfo, session, chunk, peerIdOverride);
    }
    return;
  }

  socket.send(packet, rinfo.port, rinfo.address);
  const ackOnly = commands.every((command) => command[0] === 0x01);
  if (LOG_SEND_PACKETS || (!ackOnly && MAX_UDP_PACKET_BYTES > 0 && packet.length > MAX_UDP_PACKET_BYTES)) {
    console.log(`[send] bytes=${packet.length} to=${rinfo.address}:${rinfo.port} cmds=${commands.length}`);
  }
  if (MAX_UDP_PACKET_BYTES > 0 && packet.length > MAX_UDP_PACKET_BYTES) {
    console.log(`[warn] udp-packet-large bytes=${packet.length} max=${MAX_UDP_PACKET_BYTES} cmds=${commands.length}`);
  }
}

function sendReliablePayload(socket, rinfo, session, payload, channel = 0) {
  sendPacket(socket, rinfo, session, [makeReliable(session.serverSeq++, payload, channel)]);
}

function reliableChannelForSession(session, fallback = 0) {
  const lastChannel = Number(session?.lastChannel);
  if (Number.isInteger(lastChannel) && lastChannel >= 0 && lastChannel <= 255) return lastChannel;
  const fallbackChannel = Number(fallback);
  if (Number.isInteger(fallbackChannel) && fallbackChannel >= 0 && fallbackChannel <= 255) return fallbackChannel;
  return 0;
}

function rawNull() {
  return Buffer.from([0x2a]);
}

function rawByte(value) {
  return Buffer.from([0x62, Number(value) & 0xff]);
}

function rawBool(value) {
  return Buffer.from([0x6f, value ? 1 : 0]);
}

function rawShort(value) {
  return Buffer.concat([Buffer.from([0x6b]), i16(Number(value) || 0)]);
}

function rawInt(value) {
  return Buffer.concat([Buffer.from([0x69]), i32(Number(value) || 0)]);
}

function rawLong(value) {
  return Buffer.concat([Buffer.from([0x6c]), i64(value ?? photonNow())]);
}

function rawFloat(value) {
  return Buffer.concat([Buffer.from([0x66]), f32(value)]);
}

function rawString(value) {
  const data = Buffer.from(String(value ?? ""), "utf8");
  return Buffer.concat([Buffer.from([0x73]), u16(data.length), data]);
}

function rawStringArray(values) {
  const items = values.map((value) => {
    const data = Buffer.from(String(value ?? ""), "utf8");
    return Buffer.concat([u16(data.length), data]);
  });
  return Buffer.concat([Buffer.from([0x61]), u16(items.length), ...items]);
}

function rawHashtable(entries) {
  return Buffer.concat([Buffer.from([0x68]), rawHashtableBody(entries)]);
}

function rawHashtableBody(entries) {
  return Buffer.concat([
    u16(entries.length),
    ...entries.flatMap((entry) => [entry.key, entry.value]),
  ]);
}

function rawDictionary(keyType, valueType, entries) {
  return Buffer.concat([
    Buffer.from([0x44, keyType, valueType]),
    u16(entries.length),
    ...entries.flatMap((entry) => [entry.key, entry.value]),
  ]);
}

function rawTypedDictionary(keyType, valueType, entries) {
  return Buffer.concat([
    Buffer.from([0x44, keyType, valueType]),
    u16(entries.length),
    ...entries.flatMap((entry) => [entry.keyBody, entry.valueBody]),
  ]);
}

function rawParamTable(entries) {
  return Buffer.concat([
    u16(entries.length),
    ...entries.flatMap((entry) => [Buffer.from([entry.key & 0xff]), entry.value]),
  ]);
}

function rawOperationResponse(opCode, entries, returnCode = 0, debugMessage = "") {
  return Buffer.concat([
    Buffer.from([0xf3, 0x03, opCode & 0xff]),
    i16(returnCode),
    debugMessage ? rawString(debugMessage) : rawNull(),
    rawParamTable(entries),
  ]);
}

function rawEvent(eventCode, entries) {
  return Buffer.concat([
    Buffer.from([0xf3, 0x04, eventCode & 0xff]),
    rawParamTable(entries),
  ]);
}

function rawInit(mode = INIT_REPLY) {
  // Photon3Unity3D.dll routes message type 1 to PeerBase.InitCallback().
  // Keep the option names stable because old VPS commands use INIT_REPLY=callback.
  return mode === "both" ? Buffer.from([0xf3, 0x01]) : Buffer.from([0xf3, 0x01]);
}

function readString(buf, offset) {
  const len = readU16(buf, offset);
  const start = offset + 2;
  return { value: buf.subarray(start, start + len).toString("utf8"), offset: start + len };
}

function readTypedRaw(buf, offset, forcedType = null) {
  const start = offset;
  const type = forcedType == null ? buf[offset++] : forcedType;
  let value = null;

  if (type === 0x2a) {
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x62) {
    value = buf[offset++];
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x6f) {
    value = Boolean(buf[offset++]);
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x6b) {
    value = readI16(buf, offset);
    offset += 2;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x69) {
    value = readI32(buf, offset);
    offset += 4;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x6c) {
    value = Number(buf.readBigInt64BE(offset));
    offset += 8;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x66) {
    value = buf.readFloatBE(offset);
    offset += 4;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x64) {
    value = buf.readDoubleBE(offset);
    offset += 8;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x73) {
    const parsed = readString(buf, offset);
    value = parsed.value;
    offset = parsed.offset;
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x68) {
    const count = readU16(buf, offset);
    offset += 2;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const keyParsed = readTypedRaw(buf, offset);
      offset = keyParsed.offset;
      const valueParsed = readTypedRaw(buf, offset);
      offset = valueParsed.offset;
      entries.push({ key: keyParsed, value: valueParsed });
    }
    value = { kind: "hashtable", entries };
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x44) {
    const keyType = buf[offset++];
    const valueType = buf[offset++];
    const count = readU16(buf, offset);
    offset += 2;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const keyParsed = readTypedRaw(buf, offset, keyType === 0 || keyType === 0x2a ? null : keyType);
      offset = keyParsed.offset;
      const valueParsed = readTypedRaw(buf, offset, valueType === 0 || valueType === 0x2a ? null : valueType);
      offset = valueParsed.offset;
      entries.push({ key: keyParsed, value: valueParsed });
    }
    value = { kind: "dictionary", keyType, valueType, entries };
    return { type, value, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x78) {
    const len = readI32(buf, offset);
    offset += 4 + len;
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x61) {
    const count = readU16(buf, offset);
    offset += 2;
    const items = [];
    for (let i = 0; i < count; i++) {
      const parsed = readString(buf, offset);
      offset = parsed.offset;
      items.push(parsed.value);
    }
    return { type, value: items, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x6e) {
    const count = readI32(buf, offset);
    offset += 4 + count * 4;
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x7a) {
    const count = readU16(buf, offset);
    offset += 2;
    for (let i = 0; i < count; i++) {
      const parsed = readTypedRaw(buf, offset);
      offset = parsed.offset;
    }
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x76) {
    const count = readU16(buf, offset);
    offset += 2;
    if (count > 0) {
      const itemType = buf[offset++];
      for (let i = 0; i < count; i++) {
        const parsed = readTypedRaw(buf, offset, itemType);
        offset = parsed.offset;
      }
    }
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }
  if (type === 0x79) {
    const count = readU16(buf, offset);
    offset += 2;
    const itemType = buf[offset++];
    for (let i = 0; i < count; i++) {
      const parsed = readTypedRaw(buf, offset, itemType);
      offset = parsed.offset;
    }
    return { type, value: null, raw: buf.subarray(start, offset), offset };
  }

  throw new Error(`unsupported photon type 0x${type.toString(16)} at ${start}`);
}

function readParameterTable(buf, offset) {
  const count = readU16(buf, offset);
  offset += 2;
  const params = new Map();
  for (let i = 0; i < count; i++) {
    const keyByte = buf[offset++];
    const parsed = readTypedRaw(buf, offset);
    offset = parsed.offset;
    params.set(keyByte, parsed);
  }
  return { params, offset };
}

function parsePhotonRequest(payload) {
  if (payload.length < 5 || payload[0] !== 0xf3) return null;
  const messageType = payload[1] & 0x7f;
  if (messageType !== 2) return { messageType };
  const opCode = payload[2];
  const parsed = readParameterTable(payload, 3);
  return { messageType, opCode, params: parsed.params };
}

function htGet(parsedValue, wantedKey) {
  if (!parsedValue || !parsedValue.value || !parsedValue.value.entries) return undefined;
  for (const entry of parsedValue.value.entries) {
    if (entry.key.value === wantedKey) return entry.value;
    if (String(entry.key.value) === String(wantedKey)) return entry.value;
  }
  return undefined;
}

function describeHashtable(parsedValue) {
  if (!parsedValue || !parsedValue.value || !parsedValue.value.entries) return "";
  return parsedValue.value.entries
    .map((entry) => `${String(entry.key.value)}:0x${Number(entry.value.type).toString(16)}`)
    .join(",");
}

function photonEventCode(parsed) {
  return parsed?.opCode === 253 ? parsed.params.get(244)?.value : null;
}

function isMoveEvent(parsed) {
  return photonEventCode(parsed) === 99;
}

function shouldLogParsedPayload(parsed) {
  return DEBUG_PACKETS || DEBUG_MOVE_PACKETS || !isMoveEvent(parsed);
}

function transformFromEventData(parsed) {
  const data = parsed?.params?.get(245);
  const x = Number(htGet(data, 1)?.value);
  const y = Number(htGet(data, 2)?.value);
  const z = Number(htGet(data, 3)?.value);
  const rotY = Number(htGet(data, 7)?.value || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z, rotY: Number.isFinite(rotY) ? rotY : 0 };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringOr(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function shortRoomValue(value, fallback, min = 0, max = 32767) {
  const number = Math.trunc(numberOr(value, fallback));
  return Math.max(min, Math.min(max, number));
}

function boolOr(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function roomSettingsFrom(rawRoom) {
  const hasFullSettings = Boolean(htGet(rawRoom, "map"));
  const name = stringOr(htGet(rawRoom, "name")?.value, DEFAULT_ROOM);
  const map = stringOr(htGet(rawRoom, "map")?.value, DEFAULT_MAP);
  const modeValue = htGet(rawRoom, "game_mode")?.value;
  const requestedMode = Number(modeValue ?? 1);
  const maxUsers = htGet(rawRoom, "max_users")?.value;
  const friendly = htGet(rawRoom, "friendly_fire")?.value;
  const guestMode = htGet(rawRoom, "guest_mode")?.value;
  return {
    name,
    map,
    mode: FORCE_TEAM_MODE ? 2 : (Number.isFinite(requestedMode) && requestedMode > 0 ? requestedMode : 1),
    maxUsers: shortRoomValue(maxUsers, 8, 1, 64),
    friendlyFire: boolOr(friendly, false),
    timeLimit: shortRoomValue(htGet(rawRoom, "time_limit")?.value, 10, 1, 50),
    fragLimit: shortRoomValue(htGet(rawRoom, "frag_limit")?.value, 50, 1, 1000),
    lvlMin: shortRoomValue(htGet(rawRoom, "lvl_min")?.value, 1, 1, 99),
    lvlMax: shortRoomValue(htGet(rawRoom, "lvl_max")?.value, 50, 1, 99),
    password: stringOr(htGet(rawRoom, "password")?.value, ""),
    guestMode: guestMode == null ? 0 : shortRoomValue(guestMode === true ? 1 : guestMode, 0, 0, 32767),
    hasFullSettings,
  };
}

function makeRoomSettingsRaw(settings) {
  const entries = [
    { key: rawString("time_limit"), value: rawShort(shortRoomValue(settings.timeLimit, 10, 1, 50)) },
    { key: rawString("frag_limit"), value: rawShort(shortRoomValue(settings.fragLimit, 50, 1, 1000)) },
    { key: rawString("friendly_fire"), value: rawBool(settings.friendlyFire) },
    { key: rawString("lvl_min"), value: rawShort(shortRoomValue(settings.lvlMin, 1, 1, 99)) },
    { key: rawString("lvl_max"), value: rawShort(shortRoomValue(settings.lvlMax, 50, 1, 99)) },
    { key: rawString("game_mode"), value: rawByte(settings.mode) },
    { key: rawString("map"), value: rawString(settings.map) },
    { key: rawString("max_users"), value: rawShort(shortRoomValue(settings.maxUsers, 8, 1, 64)) },
    { key: rawString("name"), value: rawString(settings.name) },
    {
      key: rawString("game_param"),
      value: rawHashtable([
        { key: rawString("remote_animation_send"), value: rawBool(true) },
        { key: rawString("remote_animation_receive"), value: rawBool(true) },
        { key: rawString("transform_per_second"), value: rawInt(20) },
        { key: rawString("tcp_transform_per_second"), value: rawInt(0) },
        { key: rawString("interpolation_mode"), value: rawByte(0) },
        { key: rawString("destroy_geometry"), value: rawBool(DESTROY_GEOMETRY) },
      ]),
    },
  ];
  if (settings.password) {
    entries.push({ key: rawString("password"), value: rawString(settings.password) });
  }
  if (settings.guestMode) {
    entries.push({ key: rawString("guest_mode"), value: rawShort(shortRoomValue(settings.guestMode, 0)) });
  }
  return rawHashtable(entries);
}

function makeEmptyActorListRaw() {
  return rawHashtable([]);
}

function makeRoomActorListRaw(room, excludeSession = null) {
  if (!room?.players?.size) return makeEmptyActorListRaw();
  const entries = [];
  for (const [actorId, playerSession] of room.players.entries()) {
    if (!playerSession || playerSession === excludeSession || !playerSession.actorRaw) continue;
    entries.push({
      key: rawInt(actorId),
      value: playerSession.actorRaw,
    });
  }
  return rawHashtable(entries);
}

const WEAPON_NAME_OVERRIDES = {
  ohca_basebalbat: "OHCA_BasebalBat",
  ohca_crowbar: "OHCA_Crowbar",
  thca_scythe_b: "THCA_Scythe_B",
  ohca_torch_f: "OHCA_Torch_F",
  thca_katana_b: "THCA_Katana_B",
  ohca_zombie: "OHCA_Zombie",
  ohca_candy: "OHCA_Candy",
  ohca_candy2: "OHCA_Candy2",
  hg_makarov: "HG_Makarov",
  hg_walther_r: "HG_Walther_R",
  hg_tt: "HG_TT",
  hg_taurus: "HG_Taurus",
  hg_usp: "HG_USP",
  hg_sigsauerp226_b: "HG_SIGSauerP226_B",
  hg_glock_s: "HG_Glock_S",
  hg_desert: "HG_Desert",
  hg_glockb01_s: "HG_GlockB01_S",
  hg_desertb01: "HG_DesertB01",
  hg_waltherp99: "HG_WaltherP99",
  mg_ak47: "MG_AK47",
  mg_m16: "MG_M16",
  mg_ak103: "MG_AK103",
  mg_ak103_o: "MG_AK103_O",
  mg_ak103d_o: "MG_AK103D_O",
  mg_ak47b06: "MG_AK47B06",
  mg_ak47b07: "MG_AK47B07",
  mg_ak47b08: "MG_AK47B08",
  mg_m4: "MG_M4",
  mg_m4_o: "MG_M4_O",
  mg_m4d_o: "MG_M4D_O",
  mg_aug1_o: "MG_AUG1_O",
  mg_aug2_o: "MG_AUG2_O",
  mg_aug3_o: "MG_AUG3_O",
  mg_aug4_o: "MG_AUG4_O",
  mg_aug5_o: "MG_AUG5_O",
  mg_assaultrifle02: "MG_AssaultRifle02",
  mg_assaultrifle03: "MG_AssaultRifle03",
  mg_ump45: "MG_UMP45",
  mg_ump45d_o: "MG_UMP45D_O",
  mg_ump45d2_o: "MG_UMP45D2_O",
  mg_ump45vkks_o: "MG_UMP45VKKS_O",
  fl_n1: "FL_N1",
  gg_m134: "GG_M134",
  gg_m249: "GG_M249",
  gg_fnmag: "GG_FNMAG",
  gg_m134b01: "GG_M134B01",
  gg_m134b02: "GG_M134B02",
  gg_m134b03: "GG_M134B03",
  gg_n2: "GG_N2",
  sg_winchester1887: "SG_Winchester1887",
  sg_novapump: "SG_Novapump",
  sg_spas: "SG_Spas",
  sg_remington: "SG_Remington",
  sg_db: "SG_DB",
  rl_rpg26: "RL_RPG26",
  rl_rpg7: "RL_RPG7",
  rl_rpg7b02: "RL_RPG7B02",
  rl_m202a1: "RL_M202A1",
  gl_milkor: "GL_Milkor",
  gl_milkor_a: "GL_Milkor_A",
  gl_ex41: "GL_EX41",
  gl_grenadelauncher03: "GL_GrenadeLauncher03",
  gl_snowlauncher: "GL_SnowLauncher",
  bl_sticky: "BL_Sticky",
  bl_stickyb02: "BL_StickyB02",
  sng_snowgun: "SNG_Snowgun",
  sr_svd: "SR_SVD",
  sr_sniperrifle03: "SR_SniperRifle03",
  sr_wildcat1: "SR_Wildcat1",
  sr_wildcat2: "SR_Wildcat2",
  sr_vintorez: "SR_Vintorez",
  sr_arctic: "SR_Arctic",
  sr_arcticb01: "SR_ArcticB01",
  sr_hk417_d: "SR_HK417_D",
  sr_m110_b: "SR_M110_B",
  sr_steyr: "SR_Steyr",
  sr_steyrb01: "SR_SteyrB01",
};

const DEFAULT_LOADOUT_WEAPONS = [
  { w_id: 1, id: 1, wt: 1, ws: 1, sn: "ohca_basebalbat", vel: 100, rad: 8, ang: 0, rap: 340, rt: 0, ammo: 0, ammo_tot: 0, lt: 250, krit: 8, dev: 2, smindam: 19, smaxdam: 35, mmindam: 13, mmaxdam: 23, lmindam: 9, lmaxdam: 15 },
  { w_id: 2, id: 2, wt: 3, ws: 2, sn: "hg_makarov", vel: 100, rad: 10, ang: 0, rap: 240, rt: 2967, ammo: 12, ammo_tot: 60, lt: 520, krit: 7, dev: 8, smindam: 20, smaxdam: 30, mmindam: 15, mmaxdam: 23, lmindam: 10, lmaxdam: 17 },
  { w_id: 3, id: 3, wt: 4, ws: 3, sn: "mg_ak47", vel: 100, rad: 12, ang: 0, rap: 150, rt: 2967, ammo: 30, ammo_tot: 90, lt: 650, krit: 5, dev: 12, smindam: 19, smaxdam: 28, mmindam: 16, mmaxdam: 24, lmindam: 12, lmaxdam: 20 },
  { w_id: 4, id: 4, wt: 6, ws: 4, sn: "gg_m134", vel: 100, rad: 14, ang: 0, rap: 125, rt: 800, ammo: 90, ammo_tot: 180, lt: 1100, krit: 4, dev: 18, smindam: 17, smaxdam: 26, mmindam: 15, mmaxdam: 22, lmindam: 12, lmaxdam: 18 },
  { w_id: 5, id: 5, wt: 7, ws: 5, sn: "sg_winchester1887", vel: 100, rad: 18, ang: 0, rap: 620, rt: 4500, ammo: 6, ammo_tot: 36, lt: 900, krit: 6, dev: 24, smindam: 55, smaxdam: 82, mmindam: 30, mmaxdam: 48, lmindam: 10, lmaxdam: 18 },
  { w_id: 6, id: 6, wt: 8, ws: 6, sn: "rl_rpg26", vel: 65, rad: 28, ang: 0, rap: 900, rt: 2300, ammo: 1, ammo_tot: 8, lt: 1150, krit: 3, dev: 6, smindam: 79, smaxdam: 121, mmindam: 63, mmaxdam: 96, lmindam: 41, lmaxdam: 73 },
  { w_id: 7, id: 7, wt: 10, ws: 7, sn: "sr_svd", vel: 100, rad: 10, ang: 0, rap: 850, rt: 2967, ammo: 10, ammo_tot: 40, lt: 1000, krit: 12, dev: 3, smindam: 67, smaxdam: 97, mmindam: 74, mmaxdam: 112, lmindam: 84, lmaxdam: 137 },
];

const WEAR_VIEW_KEYS = [
  ["hat", 1],
  ["mask", 2],
  ["gloves", 3],
  ["shirt", 4],
  ["pants", 5],
  ["boots", 6],
  ["backpack", 7],
  ["other", 8],
  ["head", 9],
];

const WEAPON_STAT_OVERRIDES = {
  ohca_basebalbat: {
    rt: 0,
    ammo: 0,
    ammo_tot: 0
  },
  ohca_candy: {
    rt: 0,
    ammo: 0,
    ammo_tot: 0
  },
  ohca_candy2: {
    rt: 0,
    ammo: 0,
    ammo_tot: 0
  },
  hg_taurus: {
    rt: 2533
  },
  hg_usp: {
    rt: 2667
  },
  mg_assaultrifle02: {
    rt: 3000
  },
  mg_ump45vkks_o: {
    rt: 3000
  },
  mg_aug5_o: {
    rt: 3000
  },
  mg_aug4_o: {
    rt: 3000
  },
  gg_fnmag: {
    rt: 4000
  },
  gg_m134b03: {
    rt: 800
  },
  sg_remington: {
    w_id: 109,
    id: 109,
    wt: 7,
    ws: 5,
    sn: "sg_remington",
    vel: 100,
    rad: 18,
    ang: 0,
    rap: 650,
    rt: 3864,
    ammo: 8,
    ammo_tot: 48,
    lt: 900,
    krit: 10,
    dev: 30,
    smindam: 62,
    smaxdam: 90,
    mmindam: 34,
    mmaxdam: 54,
    lmindam: 10,
    lmaxdam: 18,
    wsp: 15,
    shake: 1
  },
  sg_spas: {
    w_id: 106,
    id: 106,
    wt: 7,
    ws: 5,
    sn: "sg_spas",
    rt: 3500,
    ammo: 6,
    ammo_tot: 36
  },
  rl_m202a1: {
    w_id: 43,
    id: 43,
    wt: 8,
    ws: 6,
    sn: "rl_m202a1",
    vel: 60,
    rad: 30,
    ang: 0,
    rap: 920,
    rt: 5067,
    ammo: 4,
    ammo_tot: 16,
    lt: 1200,
    krit: 3,
    dev: 7,
    smindam: 82,
    smaxdam: 126,
    mmindam: 66,
    mmaxdam: 102,
    lmindam: 44,
    lmaxdam: 79,
    wsp: -15,
    launch: 1,
    shake: 1
  },
  rl_rpg7b02: {
    rt: 2967
  },
  gl_grenadelauncher03: {
    rt: 4000
  },
  gl_milkor: {
    rt: 6667
  },
  gl_milkor_a: {
    rt: 6667
  },
  sr_vintorez: {
    rt: 3167
  },
  sr_sniperrifle03: {
    rt: 3667
  },
  sr_wildcat1: {
    rt: 2333
  },
  sr_wildcat2: {
    rt: 2333
  }
};

const ABILITY_BONUS_LEVELS = {
  1: { armorFlat: [10, 20, 40, 60, 80] },
  2: { healthFlat: [10, 20, 30, 40, 50] },
  3: { speedPercent: [2, 4, 6, 8, 10] },
  5: { weaponRapidityPercent: [2, 4, 6, 8, 10] },
  6: { weaponCritPercent: [5, 10, 15, 20, 25] },
  7: { weaponAmmoPercent: [10, 30, 40, 50, 60] },
  8: { weaponMinDamageFlat: [1, 2, 3, 4, 5] },
  9: { weaponMaxDamageFlat: [1, 2, 3, 4, 5] },
};

const SET_BONUS_DEFINITIONS = [
  {
    id: 32,
    code: "biker",
    required: ["1:biker", "4:biker", "5:jeansb02", "3:biker", "6:sneakv201"],
    healthPercent: 15,
    healthFloor: BIKER_SET_HEALTH_FLOOR,
    speedPercent: 2,
    clientSpeedFloor: BIKER_SET_SPEED_FLOOR,
    weaponSpeedPercent: BIKER_SET_WEAPON_SPEED_BONUS,
    shotgunJumpBonus: BIKER_SET_SHOTGUN_JUMP_BONUS,
    damageBonuses: [
      { types: [10], range: "medium", amount: 2 },
      { types: [4], range: "long", amount: 4 },
    ],
    protections: { shotgun: 10, sniper: 5, rocket: 5, flamer: 10, grenade: 5, melee: 20 },
  },
  {
    id: 36,
    code: "spy",
    required: ["1:business", "2:businessgoogles", "4:business", "5:business", "3:business", "6:business"],
    healthPercent: 9,
    damageBonuses: [
      { types: [3], range: "medium", amount: 7 },
      { types: [4], range: "medium", amount: 6 },
    ],
    protections: { pistol: 10, sniper: 10 },
  },
  {
    id: 35,
    code: "stalker",
    required: ["1:stalker", "2:stalkergasmask", "4:stalker", "5:stalker", "3:stalker", "6:stalker"],
    healthPercent: 12,
    damageBonuses: [
      { types: [7], range: "medium", amount: 6 },
      { types: [4], range: "long", amount: 5 },
    ],
    protections: { shotgun: 15, flamer: 15, sniper: 5, melee: 5 },
  },
  {
    id: 37,
    code: "contranos",
    required: ["9:thanos", "2:thanos", "4:thanos", "5:thanos", "3:thanos", "6:thanos", "7:thanos"],
    healthPercent: 4,
    damageBonuses: [
      { types: [8], range: "long", amount: 6 },
      { types: [4], range: "medium", amount: 3 },
    ],
    protections: { automatic: 10, sniper: 5, pistol: 4, melee: 15, rocket: 15, grenade: 15, shotgun: 5 },
  },
];

function normalizeSystemName(value, fallback) {
  const raw = stringOr(value, fallback);
  const lower = raw.toLowerCase();
  if (WEAPON_NAME_OVERRIDES[lower]) return WEAPON_NAME_OVERRIDES[lower];
  const parts = lower.split("_");
  if (parts.length < 2) return raw;
  return `${parts[0].toUpperCase()}_${parts.slice(1).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join("_")}`;
}

function weaponSlot(item = {}, index = 0) {
  const slot = numberOr(item.ws ?? item.slot, index + 1);
  if (slot >= 1 && slot <= 7) return slot;
  return Math.min(7, Math.max(1, index + 1));
}

function weaponAllowedInSlot(item, slot) {
  return Number(item?.ws || 0) === Number(slot);
}

function defaultWeaponForSlot(slot) {
  return DEFAULT_LOADOUT_WEAPONS.find((item) => Number(item.ws) === Number(slot)) || DEFAULT_LOADOUT_WEAPONS[0];
}

function defaultWeaponSpeedPercent(item = {}) {
  switch (numberOr(item.wt, 0)) {
    case 1:
    case 2:
      return 0;
    case 3:
      return -5;
    case 4:
    case 11:
    case 12:
    case 13:
    case 14:
      return -8;
    case 5:
    case 7:
      return -10;
    case 6:
    case 8:
      return -15;
    case 9:
    case 10:
    case 15:
      return -12;
    default:
      return 0;
  }
}

function isColdArmsWeaponType(type) {
  const value = numberOr(type, 0);
  return value === 1 || value === 2;
}

function weaponMaxLoadedAmmo(item = {}, fallback = {}) {
  if (isColdArmsWeaponType(item.wt ?? fallback.wt)) return 0;
  return Math.max(0, numberOr(item.ammo, fallback.ammo ?? 0));
}

function weaponMaxAmmoReserve(item = {}, fallback = {}) {
  if (isColdArmsWeaponType(item.wt ?? fallback.wt)) return 0;
  return Math.max(0, numberOr(item.ammo_tot, fallback.ammo_tot ?? weaponMaxLoadedAmmo(item, fallback)));
}

function weaponSpeedPercent(item = {}) {
  const explicitSpeed = item.wsp ?? item.sp ?? item.speed ?? item.speed_percent ?? item.speedPercent ?? item.spd ?? item.stSp ?? item.wSpeed ?? item.WeaponSpeed;
  if (explicitSpeed !== undefined && explicitSpeed !== null && explicitSpeed !== "") {
    return numberOr(explicitSpeed, 0);
  }
  return defaultWeaponSpeedPercent(item);
}

function weaponRapidity(item = {}, fallback = {}) {
  const rawRapidity = numberOr(item.rap ?? item.rapid ?? item.rapidity, fallback.rap ?? 100);
  if (!NORMALIZE_WEAPON_RAPIDITY) return rawRapidity;

  const weaponType = numberOr(item.wt ?? fallback.wt, 0);
  const floor = RAPIDITY_FLOORS_BY_TYPE.get(weaponType);
  return Math.max(rawRapidity, floor ?? 100);
}

function shotIntervalMsFromRapidity(rapidity) {
  const shotTimeMs = numberOr(rapidity, 100) + 10;
  return shotTimeMs < 100 ? 110 : shotTimeMs;
}

function reloadDurationMsFromRaw(reloadTimeMs) {
  const reloadMs = numberOr(reloadTimeMs, 0) + 10;
  return reloadMs < 100 ? 110 : reloadMs;
}

function weaponAdditionalValuesRaw(item = {}) {
  const entries = [];
  const speedPercent = weaponSpeedPercent(item);
  if (speedPercent !== 0) entries.push({ key: rawByte(78), value: rawInt(speedPercent) });
  if (numberOr(item.launch, 0) > 0) entries.push({ key: rawByte(75), value: rawInt(1) });
  if (numberOr(item.shake, 0) > 0) entries.push({ key: rawByte(76), value: rawInt(1) });
  return entries.length ? rawHashtable(entries) : null;
}

function weaponBodyFromItem(item = {}, index = 0, profile = null) {
  const fallback = defaultWeaponForSlot(index + 1);
  const slot = weaponSlot({ ...fallback, ...(item || {}) }, index);
  const merged = mergedWeaponForSlot(item, fallback, slot, profile);
  const weaponId = numberOr(merged.w_id ?? merged.id, numberOr(process.env.DEFAULT_WEAPON_ID, fallback.w_id));
  const systemName = normalizeSystemName(merged.sn ?? merged.sname, fallback.sn);
  const maxLoadedAmmo = weaponMaxLoadedAmmo(merged, fallback);
  const maxAmmoReserve = weaponMaxAmmoReserve(merged, fallback);
  const entries = [
    { key: rawByte(99), value: rawString(systemName) },
    { key: rawByte(98), value: rawInt(numberOr(merged.wt, fallback.wt)) },
    { key: rawByte(97), value: rawInt(numberOr(merged.vel, fallback.vel)) },
    { key: rawByte(96), value: rawInt(numberOr(merged.rad, fallback.rad)) },
    { key: rawByte(95), value: rawFloat(numberOr(merged.ang, fallback.ang)) },
    { key: rawByte(94), value: rawInt(weaponRapidity(merged, fallback)) },
    { key: rawByte(93), value: rawInt(numberOr(merged.rt, fallback.rt)) },
    { key: rawByte(92), value: rawInt(maxLoadedAmmo) },
    { key: rawByte(91), value: rawInt(maxAmmoReserve) },
    { key: rawByte(90), value: rawInt(numberOr(merged.lt, fallback.lt)) },
    { key: rawByte(87), value: rawInt(numberOr(merged.dev, fallback.dev)) },
    { key: rawByte(80), value: rawInt(weaponId) },
  ];

  if (INCLUDE_WEAPON_LEGACY_FIELDS) {
    entries.push(
      { key: rawByte(89), value: rawInt(slot) },
      { key: rawByte(88), value: rawInt(numberOr(merged.krit, fallback.krit)) },
      { key: rawByte(86), value: rawInt(numberOr(merged.smindam, fallback.smindam)) },
      { key: rawByte(85), value: rawInt(numberOr(merged.smaxdam, fallback.smaxdam)) },
      { key: rawByte(84), value: rawInt(numberOr(merged.mmindam, fallback.mmindam)) },
      { key: rawByte(83), value: rawInt(numberOr(merged.mmaxdam, fallback.mmaxdam)) },
      { key: rawByte(82), value: rawInt(numberOr(merged.lmindam, fallback.lmindam)) },
      { key: rawByte(81), value: rawInt(numberOr(merged.lmaxdam, fallback.lmaxdam)) },
    );
  }

  const additional = weaponAdditionalValuesRaw(merged);
  if (additional) entries.push({ key: rawByte(79), value: additional });

  return rawHashtableBody(entries);
}

function makeDefaultWeaponBody(index = 0) {
  return weaponBodyFromItem(defaultWeaponForSlot(index + 1), index);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemId(item) {
  return numberOr(item?.id ?? item?.w_id ?? item?.t_id ?? item?.e_id, 0);
}

function selectedWeapons(profile) {
  if (!profile) return null;
  const weapons = [
    ...(profile.defaultWeapons || []),
    ...(profile.inventory || []).filter((item) => Number(item.itype) === 1),
    ...(profile.catalogWeapons || []),
  ];
  const byId = new Map(weapons.map((item) => [itemId(item), item]));
  const bySlot = new Map(DEFAULT_LOADOUT_WEAPONS.map((item) => [Number(item.ws), item]));
  for (const item of weapons) {
    const slot = weaponSlot(item);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, item);
  }

  const selected = [];
  const seen = new Set();
  for (let slot = 1; slot <= 7; slot += 1) {
    const selectedId = numberOr(profile.weap?.[`id${slot}`], 0);
    const selectedItem = selectedId > 0 ? byId.get(selectedId) : null;
    if (selectedItem && !weaponAllowedInSlot(selectedItem, slot)) {
      console.log(`[loadout] ignored slot-mismatch slot=${slot} id=${selectedId} itemSlot=${weaponSlot(selectedItem)} name=${stringOr(selectedItem.sn ?? selectedItem.sname, "unknown")}`);
    }
    const item = (selectedItem && weaponAllowedInSlot(selectedItem, slot) ? selectedItem : null) || bySlot.get(slot) || defaultWeaponForSlot(slot);
    const id = itemId(item) || Number(item?.w_id || slot);
    const uniqueKey = `${slot}:${id}`;
    if (item && !seen.has(uniqueKey)) {
      selected.push({ ...item, ws: slot });
      seen.add(uniqueKey);
    }
  }
  return selected.length ? selected : null;
}

function weaponSlotsForProfile(profile) {
  const selected = selectedWeapons(profile) || DEFAULT_LOADOUT_WEAPONS;
  const bySlot = new Map();
  for (const item of selected) {
    const slot = weaponSlot(item);
    if (!bySlot.has(slot)) bySlot.set(slot, item);
  }
  for (const fallback of DEFAULT_LOADOUT_WEAPONS) {
    const slot = weaponSlot(fallback);
    if (!bySlot.has(slot)) bySlot.set(slot, fallback);
  }
  return Array.from(bySlot.entries()).sort(([left], [right]) => left - right);
}

function selectedWears(profile) {
  if (!profile) return [];
  const wears = [
    ...(profile.catalogWears || []),
    ...(profile.inventory || []).filter((item) => Number(item.itype) === 3),
  ];
  const byId = new Map(wears.map((item) => [itemId(item), item]));
  const selected = [];
  for (const [viewKey, wearType] of WEAR_VIEW_KEYS) {
    const selectedId = numberOr(profile.view?.[viewKey], 0);
    const item = selectedId > 0 ? byId.get(selectedId) : null;
    if (item) selected.push({ item, wearType });
  }
  return selected;
}

function weaponCanonicalKey(item = {}) {
  return stringOr(item.sn ?? item.sname, "").toLowerCase();
}

function wearBonusKey(selectedWear) {
  const item = selectedWear?.item || {};
  const wearType = numberOr(item.wt, selectedWear?.wearType ?? 0);
  const systemName = stringOr(item.sn ?? item.sname, "").toLowerCase();
  return `${wearType}:${systemName}`;
}

function abilityLevel(profile, abilityId) {
  let level = 0;
  for (const ability of profile?.abilities || []) {
    if (Number(ability?.i) === Number(abilityId)) level = Math.max(level, numberOr(ability?.l, 0));
  }
  return Math.max(0, Math.min(5, level));
}

function addProtectionBonuses(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = numberOr(target[key], 0) + numberOr(value, 0);
  }
}

const WEAR_PROTECTION_TERMS = [
  { key: "automatic", pattern: /автомат/ },
  { key: "machinegun", pattern: /пулем/ },
  { key: "pistol", pattern: /пистолет/ },
  { key: "shotgun", pattern: /дробов/ },
  { key: "sniper", pattern: /снайпер|анаконд/ },
  { key: "rocket", pattern: /ракет|троллебуз/ },
  { key: "grenade", pattern: /гранатом|гранатин/ },
  { key: "flamer", pattern: /огнем/ },
  { key: "melee", pattern: /ближнего\s+боя|лезви/ },
];

function protectionKeyFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  return WEAR_PROTECTION_TERMS.find((term) => term.pattern.test(normalized))?.key || "";
}

function applyWearProtectionBonuses(modifiers, text) {
  for (const match of text.matchAll(/\+(\d+)\s*%\s*защит[аы]\s+от\s+([^\n]+)/g)) {
    const key = protectionKeyFromText(match[2]);
    if (!key) continue;
    modifiers.protections[key] = numberOr(modifiers.protections[key], 0) + numberOr(match[1], 0);
  }
}

function shotgunJumpBonusFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  if (!/(прыж|jump)/.test(normalized) || !/(дробов|shotgun)/.test(normalized)) return 0;
  if (/огром|huge/.test(normalized)) return SHOTGUN_RECOIL_HUGE_JUMP_BONUS;
  if (/выше\s+средн|above\s+average/.test(normalized)) return SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS;
  if (/мал|небольш|small/.test(normalized)) return SHOTGUN_RECOIL_SMALL_JUMP_BONUS;
  if (/больш|big/.test(normalized)) return BIG_SHOTGUN_RECOIL_JUMP_BONUS;
  return SHOTGUN_RECOIL_JUMP_BONUS;
}

function applyJumpPercentBonuses(modifiers, text) {
  for (const match of text.matchAll(/\+(\d+)\s*%\s*(?:к\s*)?прыж/g)) {
    modifiers.jumpPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*%\s*to\s+jump/g)) {
    modifiers.jumpPercent += numberOr(match[1], 0);
  }
}

function formatProtectionBonuses(protections = {}) {
  const entries = Object.entries(protections)
    .filter(([, value]) => numberOr(value, 0) !== 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(",") : "none";
}

function applyWearTextBonuses(modifiers, item = {}) {
  const text = stringOr(item.desca ?? item.descAdditional ?? item.da, "").toLowerCase();
  if (!text) return;

  applyWearProtectionBonuses(modifiers, text);
  applyJumpPercentBonuses(modifiers, text);

  for (const match of text.matchAll(/\+(\d+)\s*%\s*к\s*здоровью/g)) {
    modifiers.healthPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*%\s*к\s*скорости/g)) {
    modifiers.speedPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*к\s*броне/g)) {
    modifiers.armorFlat += numberOr(match[1], 0);
  }
  modifiers.shotgunJumpBonus += shotgunJumpBonusFromText(text);
}

function gameplayModifiersForProfile(profile = null) {
  const modifiers = {
    healthFlat: 0,
    healthPercent: 0,
    healthFloor: 0,
    armorFlat: 0,
    speedPercent: 0,
    clientSpeedBonus: 0,
    clientSpeedFloor: 0,
    jumpFlat: 0,
    jumpPercent: 0,
    jumpFloor: 0,
    shotgunJumpBonus: 0,
    weaponSpeedPercent: 0,
    weaponRapidityPercent: 0,
    weaponCritPercent: 0,
    weaponAmmoPercent: 0,
    weaponMinDamageFlat: 0,
    weaponMaxDamageFlat: 0,
    damageBonuses: [],
    protections: {},
    completedSets: [],
  };

  for (const [abilityIdText, bonus] of Object.entries(ABILITY_BONUS_LEVELS)) {
    const level = abilityLevel(profile, Number(abilityIdText));
    if (level <= 0) continue;
    const index = level - 1;
    modifiers.healthFlat += numberOr(bonus.healthFlat?.[index], 0);
    modifiers.armorFlat += numberOr(bonus.armorFlat?.[index], 0);
    modifiers.speedPercent += numberOr(bonus.speedPercent?.[index], 0);
    modifiers.weaponSpeedPercent += numberOr(bonus.weaponSpeedPercent?.[index], 0);
    modifiers.weaponRapidityPercent += numberOr(bonus.weaponRapidityPercent?.[index], 0);
    modifiers.weaponCritPercent += numberOr(bonus.weaponCritPercent?.[index], 0);
    modifiers.weaponAmmoPercent += numberOr(bonus.weaponAmmoPercent?.[index], 0);
    modifiers.weaponMinDamageFlat += numberOr(bonus.weaponMinDamageFlat?.[index], 0);
    modifiers.weaponMaxDamageFlat += numberOr(bonus.weaponMaxDamageFlat?.[index], 0);
  }

  const selectedWearList = selectedWears(profile);
  for (const { item } of selectedWearList) {
    applyWearTextBonuses(modifiers, item);
  }

  const selectedWearKeys = new Set(selectedWearList.map(wearBonusKey));
  for (const definition of SET_BONUS_DEFINITIONS) {
    if (!definition.required.every((key) => selectedWearKeys.has(key))) continue;
    modifiers.completedSets.push(definition.id);
    modifiers.healthFlat += numberOr(definition.healthFlat, 0);
    modifiers.healthPercent += numberOr(definition.healthPercent, 0);
    modifiers.healthFloor = Math.max(modifiers.healthFloor, numberOr(definition.healthFloor, 0));
    modifiers.speedPercent += numberOr(definition.speedPercent, 0);
    modifiers.clientSpeedBonus += numberOr(definition.clientSpeedBonus, 0);
    modifiers.clientSpeedFloor = Math.max(modifiers.clientSpeedFloor, numberOr(definition.clientSpeedFloor, 0));
    modifiers.jumpFlat += numberOr(definition.jumpFlat, 0);
    modifiers.jumpFloor = Math.max(modifiers.jumpFloor, numberOr(definition.jumpFloor, 0));
    modifiers.shotgunJumpBonus += numberOr(definition.shotgunJumpBonus, 0);
    modifiers.weaponSpeedPercent += numberOr(definition.weaponSpeedPercent, 0);
    modifiers.weaponRapidityPercent += numberOr(definition.weaponRapidityPercent, 0);
    modifiers.weaponCritPercent += numberOr(definition.weaponCritPercent, 0);
    modifiers.weaponAmmoPercent += numberOr(definition.weaponAmmoPercent, 0);
    modifiers.weaponMinDamageFlat += numberOr(definition.weaponMinDamageFlat, 0);
    modifiers.weaponMaxDamageFlat += numberOr(definition.weaponMaxDamageFlat, 0);
    modifiers.damageBonuses.push(...(definition.damageBonuses || []));
    addProtectionBonuses(modifiers.protections, definition.protections);
  }

  for (const item of selectedWeapons(profile) || []) {
    const override = WEAPON_STAT_OVERRIDES[weaponCanonicalKey(item)] || {};
    const weapon = { ...item, ...override };
    modifiers.jumpFlat += numberOr(weapon.jumpFlat, 0);
    modifiers.shotgunJumpBonus += numberOr(weapon.shotgunJumpBonus, 0);
    modifiers.jumpFloor = Math.max(modifiers.jumpFloor, numberOr(weapon.jumpFloor, 0));
  }

  return modifiers;
}

function applyWeaponGameplayBonuses(item, profile = null) {
  const modifiers = gameplayModifiersForProfile(profile);
  const result = { ...item };
  const weaponType = numberOr(result.wt, 0);

  for (const bonus of modifiers.damageBonuses) {
    if (!bonus.types.includes(weaponType)) continue;
    const amount = numberOr(bonus.amount, 0);
    if (bonus.range === "short") {
      result.smindam = numberOr(result.smindam, 0) + amount;
      result.smaxdam = numberOr(result.smaxdam, 0) + amount;
    } else if (bonus.range === "medium") {
      result.mmindam = numberOr(result.mmindam, 0) + amount;
      result.mmaxdam = numberOr(result.mmaxdam, 0) + amount;
    } else if (bonus.range === "long") {
      result.lmindam = numberOr(result.lmindam, 0) + amount;
      result.lmaxdam = numberOr(result.lmaxdam, 0) + amount;
    }
  }

  const minDamageFlat = numberOr(modifiers.weaponMinDamageFlat, 0);
  const maxDamageFlat = numberOr(modifiers.weaponMaxDamageFlat, 0);
  if (minDamageFlat !== 0) {
    result.smindam = numberOr(result.smindam, 0) + minDamageFlat;
    result.mmindam = numberOr(result.mmindam, 0) + minDamageFlat;
    result.lmindam = numberOr(result.lmindam, 0) + minDamageFlat;
  }
  if (maxDamageFlat !== 0) {
    result.smaxdam = numberOr(result.smaxdam, 0) + maxDamageFlat;
    result.mmaxdam = numberOr(result.mmaxdam, 0) + maxDamageFlat;
    result.lmaxdam = numberOr(result.lmaxdam, 0) + maxDamageFlat;
  }

  const ammoPercent = numberOr(modifiers.weaponAmmoPercent, 0);
  if (ammoPercent > 0 && !isColdArmsWeaponType(weaponType)) {
    result.ammo_tot = Math.max(
      numberOr(result.ammo_tot, 0),
      Math.round(numberOr(result.ammo_tot, result.ammo ?? 0) * (1 + ammoPercent / 100))
    );
  }

  const rapidityPercent = numberOr(modifiers.weaponRapidityPercent, 0);
  if (rapidityPercent > 0) {
    result.rap = Math.round(numberOr(result.rap, 100) * (1 - rapidityPercent / 100));
  }

  const critPercent = numberOr(modifiers.weaponCritPercent, 0);
  if (critPercent > 0) {
    result.krit = numberOr(result.krit, 0) + critPercent;
  }

  const weaponSpeedPercentBonus = numberOr(modifiers.weaponSpeedPercent, 0);
  if (weaponSpeedPercentBonus !== 0) {
    result.wsp = Math.round(weaponSpeedPercent(result) + weaponSpeedPercentBonus);
  }

  return result;
}

function mergedWeaponForSlot(item = {}, fallback = {}, slot = 1, profile = null) {
  const base = { ...fallback, ...(item || {}), ws: slot };
  const override = WEAPON_STAT_OVERRIDES[weaponCanonicalKey(base)];
  const merged = override
    ? { ...base, ...override, ws: slot, w_id: numberOr(override.w_id, base.w_id ?? base.id), id: numberOr(override.id, base.id ?? base.w_id) }
    : base;
  return applyWeaponGameplayBonuses(merged, profile);
}

function playerRuntimeStats(profile = null) {
  const modifiers = gameplayModifiersForProfile(profile);
  const baseHealth = Number(process.env.DEFAULT_PLAYER_HEALTH || 100);
  const baseEnergy = Number(process.env.DEFAULT_PLAYER_ENERGY || 100);
  const baseSpeed10 = Number(process.env.DEFAULT_PLAYER_SPEED10 || 70);
  const baseJump = Number(process.env.DEFAULT_PLAYER_JUMP || 15);
  const calculatedHealth = Math.round((baseHealth + modifiers.healthFlat) * (1 + modifiers.healthPercent / 100));
  const maxHealth = Math.max(1, calculatedHealth, numberOr(modifiers.healthFloor, 0));
  const maxEnergy = Math.max(0, Math.round(baseEnergy + modifiers.armorFlat));
  const baseClientSpeed = Math.max(1, Math.floor(baseSpeed10 / 10));
  const speedMultiplier = 1 + modifiers.speedPercent / 100;
  const rawClientSpeed = baseClientSpeed * speedMultiplier + modifiers.clientSpeedBonus;
  const roundedClientSpeed = modifiers.speedPercent > 0 || modifiers.clientSpeedBonus > 0 || modifiers.clientSpeedFloor > 0
    ? Math.ceil(rawClientSpeed)
    : Math.round(rawClientSpeed);
  const clientSpeed = Math.max(1, roundedClientSpeed, numberOr(modifiers.clientSpeedFloor, 0));
  const speed10 = clientSpeed * 10;
  const jumpBeforePercent = Math.max(1, baseJump + modifiers.jumpFlat + modifiers.shotgunJumpBonus);
  const jumpWithPercent = Math.round(jumpBeforePercent * (1 + modifiers.jumpPercent / 100));
  const rawJump = Math.max(
    1,
    jumpWithPercent,
    numberOr(modifiers.jumpFloor, 0)
  );
  const jump = Math.min(MAX_PLAYER_JUMP, rawJump);
  return { maxHealth, maxEnergy, speed10, clientSpeed, jump, jumpCap: MAX_PLAYER_JUMP, modifiers };
}

function sessionRuntimeStats(session = null) {
  return playerRuntimeStats(session?.loadedProfile || null);
}

function makeWeaponDictionaryRaw(profile = null) {
  const allSlots = weaponSlotsForProfile(profile);
  const joinSlots = allSlots.slice(0, JOIN_LOADOUT_SLOT_LIMIT);
  if (joinSlots.length < allSlots.length) {
    console.log(`[loadout] compact join slots=${joinSlots.map(([slot]) => slot).join(",")} of=${allSlots.length} limit=${JOIN_LOADOUT_SLOT_LIMIT}`);
  }

  return rawTypedDictionary(0x69, 0x68, joinSlots.map(([slot, item]) => ({
    keyBody: i32(slot - 1),
    valueBody: weaponBodyFromItem(item, slot - 1, profile),
  })));
}

function makeWearDictionaryRaw(profile = null) {
  const selected = selectedWears(profile);
  if (!selected.length) return null;
  return rawTypedDictionary(0x69, 0x68, selected.map(({ item, wearType }, index) => ({
    keyBody: i32(itemId(item) || index),
    valueBody: rawHashtableBody([
      { key: rawByte(99), value: rawString(stringOr(item.sn ?? item.sname, "")) },
      { key: rawByte(98), value: rawInt(numberOr(item.wt, wearType)) },
      { key: rawByte(80), value: rawInt(itemId(item) || index) },
    ]),
  })));
}

function makeWeaponRuntimeState(profile = null) {
  const states = new Map();
  for (const [slot, item] of weaponSlotsForProfile(profile)) {
    const fallback = defaultWeaponForSlot(slot);
    const merged = mergedWeaponForSlot(item, fallback, slot, profile);
    const maxLoadedAmmo = weaponMaxLoadedAmmo(merged, fallback);
    const maxAmmoReserve = weaponMaxAmmoReserve(merged, fallback);
    const rapidity = weaponRapidity(merged, fallback);
    const reloadTimeMs = numberOr(merged.rt, fallback.rt ?? 0);
    states.set(slot, {
      slot,
      index: slot - 1,
      type: numberOr(merged.wt, fallback.wt),
      rapidity,
      shotIntervalMs: shotIntervalMsFromRapidity(rapidity),
      nextShotAt: 0,
      reloadTimeMs,
      reloadDurationMs: reloadDurationMsFromRaw(reloadTimeMs),
      reloadTimer: null,
      reloadSeq: 0,
      reloading: false,
      reloadStartedAt: 0,
      reloadFullUntil: 0,
      maxLoadedAmmo,
      maxAmmoReserve,
      loadedAmmo: maxLoadedAmmo,
      ammoReserve: Math.max(0, maxAmmoReserve - maxLoadedAmmo),
      systemName: normalizeSystemName(merged.sn ?? merged.sname, fallback.sn),
    });
  }
  return states;
}

function makeDefaultWeaponDictionaryRaw() {
  return rawTypedDictionary(0x69, 0x68, DEFAULT_LOADOUT_WEAPONS.map((item, index) => ({
    keyBody: i32(index),
    valueBody: makeDefaultWeaponBody(index),
  })));
}

function makeActorInfoRaw(profile = null) {
  const stats = playerRuntimeStats(profile);
  const entries = [
    { key: rawByte(100), value: rawInt(stats.maxHealth) },
    { key: rawByte(99), value: rawInt(stats.maxEnergy) },
    { key: rawByte(95), value: rawInt(stats.speed10) },
    { key: rawByte(94), value: makeWeaponDictionaryRaw(profile) },
    { key: rawByte(92), value: rawInt(stats.jump) },
    { key: rawByte(76), value: rawInt(numberOr(profile?.level, Number(process.env.DEFAULT_PLAYER_LEVEL || 1))) },
    { key: rawByte(36), value: rawBool(process.env.DEFAULT_PLAYER_PREMIUM === "1") },
    { key: rawByte(6), value: rawString("") },
    { key: rawByte(5), value: rawInt(0) },
  ];

  if (INCLUDE_JOIN_WEARS) {
    const wears = makeWearDictionaryRaw(profile);
    if (wears) entries.push({ key: rawByte(30), value: wears });
  }

  return rawHashtable(entries);
}

function getRawValue(parsedHashtable, wantedKey) {
  if (!parsedHashtable || !parsedHashtable.value || !parsedHashtable.value.entries) return null;
  for (const entry of parsedHashtable.value.entries) {
    if (entry.key.value === wantedKey || String(entry.key.value) === String(wantedKey)) {
      return entry.value.raw;
    }
  }
  return null;
}

function actorCredentials(incomingActor) {
  const authId = Number(htGet(incomingActor, 241)?.value || process.env.DEFAULT_PLAYER_ID || 1);
  const authKey = String(htGet(incomingActor, 240)?.value || process.env.DEFAULT_PLAYER_KEY || "contra-revive-key");
  return { authId, authKey };
}

function profileCacheKeyForActor(incomingActor) {
  const { authId, authKey } = actorCredentials(incomingActor);
  return `${authId}:${authKey}`;
}

function cachedPlayerProfile(incomingActor) {
  const cached = profileCache.get(profileCacheKeyForActor(incomingActor));
  if (cached?.profile && Date.now() - cached.loadedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }
  return null;
}

function fallbackPlayerProfile(incomingActor) {
  const { authId, authKey } = actorCredentials(incomingActor);
  return {
    isFallback: true,
    authId,
    authKey,
    name: stringOr(htGet(incomingActor, 242)?.value, process.env.DEFAULT_PLAYER_NAME || "ContraCity"),
    level: Number(process.env.DEFAULT_PLAYER_LEVEL || 1),
    view: {},
    weap: {},
    taun: {},
    inventory: [],
    abilities: [],
    defaultWeapons: [],
    catalogWeapons: [],
    catalogWears: [],
  };
}

function isFallbackBattleProfile(profile) {
  return !profile || profile.isFallback === true;
}

function warmPlayerProfile(incomingActor, reason = "warm") {
  const cached = cachedPlayerProfile(incomingActor);
  if (cached) return Promise.resolve(cached);

  const { authId } = actorCredentials(incomingActor);
  const cacheKey = profileCacheKeyForActor(incomingActor);
  if (profileLoads.has(cacheKey)) return profileLoads.get(cacheKey);

  console.log(`[profile] warm start id=${authId} reason=${reason}`);
  const promise = loadPlayerProfile(incomingActor)
    .catch((error) => {
      console.log(`[profile] warm failed id=${authId} reason=${reason} ${error.message}`);
      return fallbackPlayerProfile(incomingActor);
    })
    .finally(() => profileLoads.delete(cacheKey));
  profileLoads.set(cacheKey, promise);
  return promise;
}

async function profileForJoin(incomingActor) {
  const cached = cachedPlayerProfile(incomingActor);
  if (cached) return { profile: cached, source: "cache" };

  const loading = warmPlayerProfile(incomingActor, "room-join");
  if (PROFILE_JOIN_WAIT_MS > 0) {
    const loaded = await Promise.race([
      loading.then((profile) => (isFallbackBattleProfile(profile) ? null : { profile, source: "loaded" })),
      new Promise((resolve) => setTimeout(() => resolve(null), PROFILE_JOIN_WAIT_MS)),
    ]);
    if (loaded?.profile) return loaded;
  }

  return { profile: fallbackPlayerProfile(incomingActor), source: "fallback", pendingProfile: loading };
}

function applyLateProfile(session, profile, incomingActor = null) {
  if (isFallbackBattleProfile(profile)) return;
  session.loadedProfile = profile;
  session.playerId = profile.authId;
  session.playerName = profile.name;
  session.weaponStates = makeWeaponRuntimeState(profile);
  if (incomingActor) {
    session.actorRaw = makeActorDataRaw(incomingActor, profile);
  }
  const stats = playerRuntimeStats(profile);
  if (!session.spawned) {
    session.health = stats.maxHealth;
    session.energy = stats.maxEnergy;
  }
      console.log(`[profile] late ready actor=${session.actorId} id=${profile.authId} name=${profile.name} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponSpeedPct=${stats.modifiers.weaponSpeedPercent} weaponRapidityPct=${stats.modifiers.weaponRapidityPercent} ammoPct=${stats.modifiers.weaponAmmoPercent} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} jumpCap=${stats.jumpCap} prot=${formatProtectionBonuses(stats.modifiers.protections)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump}`);
}

async function fetchApiJson(path) {
  if (!API_BASE_URL || typeof fetch !== "function") return null;
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`status=${response.status}`);
  return response.json();
}

async function loadShopCatalog(query) {
  if ((shopCatalogCache.weapons.length || shopCatalogCache.wears.length) && Date.now() - shopCatalogCache.loadedAt < CATALOG_CACHE_TTL_MS) {
    return shopCatalogCache;
  }

  const payload = await fetchApiJson(`/ajax.php?page=shop&act=items&${query}`);
  const weapons = Array.isArray(payload?.weap?.items) ? payload.weap.items : [];
  const wears = Array.isArray(payload?.wear?.items) ? payload.wear.items : [];
  shopCatalogCache = { loadedAt: Date.now(), weapons, wears };
  return shopCatalogCache;
}

async function loadPlayerProfile(incomingActor) {
  const { authId, authKey } = actorCredentials(incomingActor);
  const cacheKey = `${authId}:${authKey}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  const query = `ccid=${encodeURIComponent(authId)}&cckey=${encodeURIComponent(authKey)}`;
  try {
    const [profilePayload, inventoryPayload, abilitiesPayload, shopCatalog] = await Promise.all([
      fetchApiJson(`/ajax.php?page=pl&act=i&${query}`),
      fetchApiJson(`/ajax.php?page=pl&act=inv&${query}`),
      fetchApiJson(`/ajax.php?page=pl&act=abil&${query}`).catch((error) => {
        console.log(`[profile] abilities failed id=${authId} ${error.message}`);
        return { u: [] };
      }),
      loadShopCatalog(query).catch((error) => {
        console.log(`[profile] catalog failed id=${authId} ${error.message}`);
        return { weapons: [], wears: [] };
      }),
    ]);

    const info = profilePayload?.info || {};
    const profile = {
      authId: numberOr(info.u_id, authId),
      authKey,
      name: stringOr(info.un, process.env.DEFAULT_PLAYER_NAME || "ContraCity"),
      level: numberOr(info.lvl, Number(process.env.DEFAULT_PLAYER_LEVEL || 1)),
      view: profilePayload?.view || {},
      weap: profilePayload?.weap || {},
      taun: profilePayload?.taun || {},
      inventory: parseJsonArray(inventoryPayload?.data?.items),
      abilities: Array.isArray(abilitiesPayload?.u) ? abilitiesPayload.u : [],
      defaultWeapons: parseJsonArray(inventoryPayload?.data?.dw),
      catalogWeapons: shopCatalog.weapons,
      catalogWears: shopCatalog.wears,
    };
    profileCache.set(cacheKey, { loadedAt: Date.now(), profile });
    const stats = playerRuntimeStats(profile);
    console.log(`[profile] loaded id=${profile.authId} name=${profile.name} weapons=${selectedWeapons(profile)?.length || 0} wears=${selectedWears(profile).length} abilities=${profile.abilities.length} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponSpeedPct=${stats.modifiers.weaponSpeedPercent} weaponRapidityPct=${stats.modifiers.weaponRapidityPercent} ammoPct=${stats.modifiers.weaponAmmoPercent} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} jumpCap=${stats.jumpCap} prot=${formatProtectionBonuses(stats.modifiers.protections)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump}`);
    return profile;
  } catch (error) {
    console.log(`[profile] failed id=${authId} ${error.message}`);
    return fallbackPlayerProfile(incomingActor);
  }
}

function makeActorDataRaw(incomingActor, profile = null) {
  const credentials = actorCredentials(incomingActor);
  const authId = numberOr(profile?.authId, credentials.authId);
  const name = stringOr(profile?.name ?? htGet(incomingActor, 242)?.value, process.env.DEFAULT_PLAYER_NAME || "ContraCity");
  const team = Number(htGet(incomingActor, 239)?.value ?? -1);
  const entries = [
    { key: rawByte(242), value: rawString(name) },
    { key: rawByte(241), value: rawInt(authId) },
    { key: rawByte(239), value: rawShort(Number.isFinite(team) ? team : -1) },
    { key: rawByte(96), value: makeActorInfoRaw(profile) },
  ];

  if (INCLUDE_JOIN_ACTOR_ECHO_FIELDS) {
    const authKey = getRawValue(incomingActor, 240);
    if (authKey) entries.push({ key: rawByte(240), value: authKey });

    const uniqueId = getRawValue(incomingActor, 32);
    if (uniqueId) entries.push({ key: rawByte(32), value: uniqueId });

    const serverLogic = getRawValue(incomingActor, 31);
    if (serverLogic) entries.push({ key: rawByte(31), value: serverLogic });
  }

  return rawHashtable(entries);
}

function makeGameStateRaw(session) {
  const entries = [
    { key: rawByte(88), value: makeScoreRaw(session) },
    { key: rawByte(77), value: rawBool(false) },
    { key: rawByte(95), value: rawLong(session.room.startedAt) },
  ];

  if (INCLUDE_PEERS_IN_GAMESTATE) {
    entries.unshift({ key: rawByte(99), value: makeRoomActorListRaw(session.room, session) });
  }

  const items = makeRoomItemsRaw(session.room);
  if (items) {
    entries.push({ key: rawByte(80), value: items });
  }

  if (INCLUDE_ACTOR_IN_GAMESTATE) {
    entries.unshift(
      { key: rawByte(98), value: session.actorRaw || rawHashtable([]) },
      { key: rawByte(97), value: rawInt(session.actorId) },
    );
  }

  return rawHashtable(entries);
}

function makeTransformRaw(point, options = {}) {
  const yaw = numberOr(point.rotY, 0);
  const speedY = options.spawnRotationInSpeed ? yaw : 0;
  return rawHashtable([
    { key: rawByte(1), value: rawFloat(point.x) },
    { key: rawByte(2), value: rawFloat(point.y) },
    { key: rawByte(3), value: rawFloat(point.z) },
    { key: rawByte(4), value: rawFloat(0) },
    { key: rawByte(5), value: rawFloat(speedY) },
    { key: rawByte(6), value: rawFloat(0) },
    { key: rawByte(7), value: rawFloat(yaw) },
    { key: rawByte(8), value: rawLong(photonNow()) },
  ]);
}

function mapPickupDefinitions(mapName) {
  if (!ENABLE_MAP_PICKUPS) return [];
  return MAP_PICKUP_POINTS[mapKey(mapName)] || [];
}

function makeRoomItemState(mapName) {
  const items = new Map();
  for (const item of mapPickupDefinitions(mapName)) {
    items.set(Number(item.id), {
      ...item,
      picked: false,
      nextRespawnAt: 0,
    });
  }
  return items;
}

function ensureRoomItems(room) {
  if (!room.items) room.items = makeRoomItemState(room.map);
  return room.items;
}

function makeItemRaw(item) {
  const entries = [
    { key: rawByte(75), value: rawInt(item.id) },
    { key: rawByte(73), value: rawByte(item.type) },
    { key: rawByte(71), value: makeTransformRaw(item) },
    { key: rawByte(70), value: rawInt(item.value) },
  ];
  if (item.subType !== undefined && item.subType !== null) {
    entries.push({ key: rawByte(72), value: rawShort(item.subType) });
  }
  return rawHashtable(entries);
}

function makeRoomItemsRaw(room) {
  if (!ENABLE_MAP_PICKUPS || !room) return null;
  const items = ensureRoomItems(room);
  const active = Array.from(items.values()).filter((item) => !item.picked);
  if (!active.length) return null;
  return rawHashtable(active.map((item) => ({
    key: rawInt(item.id),
    value: makeItemRaw(item),
  })));
}

function buildSpawnItemEvent(item) {
  return rawEvent(94, [{ key: 245, value: makeItemRaw(item) }]);
}

function sendReliablePayloadsToSession(targetSession, payloads, channel = 0) {
  if (!targetSession?.socket || !targetSession?.rinfo || !Array.isArray(payloads)) return false;
  const reliablePayloads = payloads.filter(Boolean);
  if (!reliablePayloads.length) return false;
  const targetChannel = reliableChannelForSession(targetSession, channel);
  const commands = reliablePayloads.map((payload) => makeReliable(targetSession.serverSeq++, payload, targetChannel));
  try {
    sendPacket(targetSession.socket, targetSession.rinfo, targetSession, commands);
  } catch (error) {
    console.log(`[warn] peer-send failed actor=${targetSession.actorId || "?"} cmds=${commands.length} reason=${error.message}`);
    return false;
  }
  return true;
}

function sendReliableToSession(targetSession, payload, channel = 0) {
  return sendReliablePayloadsToSession(targetSession, [payload], channel);
}

function broadcastReliableToRoom(sourceSession, payload, channel = 0, reason = "sync", options = {}) {
  const room = sourceSession?.room;
  if (!room?.players?.size || !payload) return 0;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === sourceSession) continue;
    if (options.requireGameState !== false && !playerSession.gameStateRequested) continue;
    if (options.skipKnownActor && sessionHasActorData(playerSession, sourceSession.actorId)) continue;
    if (sendReliableToSession(playerSession, payload, channel)) {
      sent += 1;
      if (options.markActorKnown) markActorKnown(playerSession, sourceSession.actorId);
      if (options.markActorAnnounced) markActorAnnounced(playerSession, sourceSession.actorId);
    }
  }
  if (sent > 0 && reason) {
    console.log(`[sync] ${reason} actor=${sourceSession.actorId} peers=${sent}`);
  }
  return sent;
}

function maybeAppendRespawnItems(session, commands, channel) {
  if (!ENABLE_MAP_PICKUPS || !session?.room?.items || ITEM_RESPAWN_MS <= 0) return;
  const now = Date.now();
  for (const item of session.room.items.values()) {
    if (!item.picked || !item.nextRespawnAt || now < item.nextRespawnAt) continue;
    item.picked = false;
    item.nextRespawnAt = 0;
    const spawnItemEvent = buildSpawnItemEvent(item);
    commands.push(makeReliable(session.serverSeq++, spawnItemEvent, channel));
    broadcastReliableToRoom(session, spawnItemEvent, channel, "item-respawn");
    console.log(`[event] item-respawn id=${item.id} type=${item.type} subType=${item.subType ?? 0} value=${item.value}`);
  }
}

function distanceSquared(left, right) {
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  return dx * dx + dy * dy + dz * dz;
}

function reserveCapForState(state) {
  return Math.max(0, numberOr(state?.maxAmmoReserve, 0) - numberOr(state?.loadedAmmo, 0));
}

function ammoPickupStates(session) {
  return Array.from(session?.weaponStates?.values?.() || [])
    .filter((state) => state && !isColdArmsWeaponType(state.type) && reserveCapForState(state) > 0);
}

function itemCanBenefitSession(session, item) {
  if (!REQUIRE_PICKUP_BENEFIT) {
    return item.type !== ITEM_TYPES.AMMO || ammoPickupStates(session).length > 0;
  }

  if (item.type === ITEM_TYPES.HEALTH) {
    const stats = sessionRuntimeStats(session);
    return numberOr(session.health, stats.maxHealth) < stats.maxHealth;
  }
  if (item.type === ITEM_TYPES.ARMOR) {
    const stats = sessionRuntimeStats(session);
    return numberOr(session.energy, stats.maxEnergy) < stats.maxEnergy;
  }
  if (item.type === ITEM_TYPES.AMMO) {
    return ammoPickupStates(session).some((state) => state.ammoReserve < reserveCapForState(state));
  }
  return true;
}

function makeSpawnRaw(session, team, point) {
  const stats = sessionRuntimeStats(session);
  return rawHashtable([
    // Local SpawnMe uses NetworkTransform.Speed as rotation; remotes use Rotation.
    { key: rawByte(237), value: makeTransformRaw(point, { spawnRotationInSpeed: true }) },
    { key: rawByte(239), value: rawShort(team) },
    { key: rawByte(100), value: rawInt(stats.maxHealth) },
    { key: rawByte(99), value: rawInt(stats.maxEnergy) },
    { key: rawByte(10), value: rawByte(0) },
  ]);
}

function roomMode(session) {
  const mode = Number(session.room?.mode ?? 1);
  return Number.isFinite(mode) && mode > 0 ? mode : 1;
}

function isTeamMode(mode) {
  return mode >= 2 && mode !== 16 && mode !== 64;
}

function normalizeTeamForRoom(session, requestedTeam = null) {
  const mode = roomMode(session);
  const team = Number(requestedTeam);

  if (mode === 1) return 0;
  if (team === 0 || team === 1 || team === 2) return team;
  if (session.team === 0 || session.team === 1 || session.team === 2) return session.team;
  return isTeamMode(mode) ? (DEFAULT_TEAM === 2 ? 2 : 1) : 0;
}

function makeScorePlayerRaw(session, team, options = {}) {
  const entries = [
    { key: rawByte(239), value: rawShort(team) },
    { key: rawByte(69), value: rawInt(0) },
    { key: rawByte(68), value: rawInt(0) },
    { key: rawByte(67), value: rawInt(0) },
    { key: rawByte(32), value: rawInt(0) },
    { key: rawByte(102), value: rawInt(0) },
    { key: rawByte(107), value: rawInt(0) },
  ];

  if (options.includeAlive && session.lastTransform) {
    entries.push(
      { key: rawByte(101), value: rawBool(true) },
      { key: rawByte(237), value: makeTransformRaw(session.lastTransform) },
      { key: rawByte(100), value: rawInt(session.health || 100) },
      { key: rawByte(99), value: rawInt(session.energy || 100) },
    );
  }

  return rawHashtable(entries);
}

function makeTeamScoreRaw() {
  return rawHashtable([{ key: rawByte(67), value: rawInt(0) }]);
}

function makeScoreRaw(session) {
  const mode = roomMode(session);
  const playerEntries = [];
  const players = session.room?.players || new Map();
  for (const [actorId, playerSession] of players.entries()) {
    if (!playerSession?.spawned) continue;
    const rawTeam = Number(playerSession.team);
    const team = mode === 1 ? 0 : (rawTeam === 1 || rawTeam === 2 ? rawTeam : -1);
    if (team < 0) continue;
    playerEntries.push({
      key: rawInt(actorId),
      value: makeScorePlayerRaw(playerSession, team, { includeAlive: true }),
    });
  }

  const entries = [
    { key: rawByte(89), value: rawInt(0) },
    { key: rawByte(88), value: rawHashtable(playerEntries) },
  ];

  if (isTeamMode(mode)) {
    entries.push({
      key: rawByte(87),
      value: rawHashtable([
        { key: rawByte(1), value: makeTeamScoreRaw() },
        { key: rawByte(2), value: makeTeamScoreRaw() },
      ]),
    });
  }

  return rawHashtable(entries);
}

function buildSpawnEvent(session, requestedTeam, reason) {
  const team = normalizeTeamForRoom(session, requestedTeam);
  const stats = sessionRuntimeStats(session);
  session.team = team;
  session.spawned = true;
  session.health = stats.maxHealth;
  session.energy = stats.maxEnergy;
  const point = spawnPointFor(session, team);
  session.lastTransform = point;
  const spawn = makeSpawnRaw(session, team, point);
  console.log(`[event] ${reason} spawn actor=${session.actorId} team=${team} mode=${roomMode(session)} map=${session.room?.map || DEFAULT_MAP} pos=${fmtPoint(point)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump} jumpCap=${stats.jumpCap} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} prot=${formatProtectionBonuses(stats.modifiers.protections)}`);
  postBattleEvent(session, "spawn", {
    team,
    transform: { x: point.x, y: point.y, z: point.z, rotY: point.rotY || 0 },
    eventData: { reason },
  });
  queueSpawnNoMoveWarning(session, point, reason);
  return rawEvent(100, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: spawn },
  ]);
}

function describeWeaponEventData(data) {
  const slot = htGet(data, 78)?.value;
  const weaponType = htGet(data, 89)?.value;
  const loadedAmmo = htGet(data, 81)?.value;
  const ammoReserve = htGet(data, 80)?.value;
  const parts = [];
  if (slot != null) parts.push(`slot=${slot}`);
  if (weaponType != null) parts.push(`type=${weaponType}`);
  if (loadedAmmo != null) parts.push(`loaded=${loadedAmmo}`);
  if (ammoReserve != null) parts.push(`reserve=${ammoReserve}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function buildActorEchoEvent(session, eventCode, parsed, reason) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;
  console.log(`[event] ${reason} actor=${session.actorId}${describeWeaponEventData(data)}`);
  return rawEvent(eventCode, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function buildActorDataEvent(session, eventCode, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;
  return rawEvent(eventCode, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function weaponStateBySlot(session, slot) {
  if (!session.weaponStates) session.weaponStates = makeWeaponRuntimeState(null);
  return session.weaponStates.get(Number(slot)) || null;
}

function weaponStateByType(session, weaponType) {
  const type = Number(weaponType);
  if (!Number.isFinite(type)) return null;
  const current = weaponStateBySlot(session, session.currentWeaponSlot);
  if (current && current.type === type) return current;
  for (const state of session.weaponStates?.values?.() || []) {
    if (state.type === type) return state;
  }
  return null;
}

function shotConsumesAmmo(weaponType, launchMode) {
  const type = Number(weaponType);
  const mode = Number(launchMode ?? 0);
  if (isColdArmsWeaponType(type)) return false;
  if (type === 6) return mode !== 1 && mode !== 2;
  if (type === 8 || type === 9 || type === 15) return mode === 1;
  return mode !== 2;
}

function isWeaponControlShot(state, launchMode) {
  if (!state) return false;
  if (isColdArmsWeaponType(state.type)) return false;
  return !shotConsumesAmmo(state.type, launchMode);
}

function isComplexReloadWeaponState(state) {
  const type = Number(state?.type);
  return (type === 7 || type === 8 || type === 9 || type === 15) && numberOr(state?.maxLoadedAmmo, 0) >= 3;
}

function reloadSingleDurationMs(state) {
  const fullReloadMs = numberOr(state?.reloadDurationMs, reloadDurationMsFromRaw(state?.reloadTimeMs));
  if (!isComplexReloadWeaponState(state)) return fullReloadMs;
  return Math.floor(fullReloadMs / Math.max(1, numberOr(state.maxLoadedAmmo, 1))) + 10;
}

function clearWeaponReloadTimer(state) {
  if (!state?.reloadTimer) return;
  clearTimeout(state.reloadTimer);
  state.reloadTimer = null;
}

function cancelWeaponReload(state, reason = "cancel") {
  if (!state) return;
  clearWeaponReloadTimer(state);
  if (state.reloading) {
    console.log(`[event] reload ${reason} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
  }
  state.reloading = false;
  state.reloadStartedAt = 0;
  state.reloadFullUntil = 0;
}

function clearSessionWeaponReloadTimers(session) {
  for (const state of session?.weaponStates?.values?.() || []) {
    cancelWeaponReload(state, "clear");
  }
}

function makeReloadUpdateEvent(session, state) {
  const reload = rawHashtable([
    { key: rawByte(78), value: rawInt(state.index) },
    { key: rawByte(81), value: rawInt(state.loadedAmmo) },
    { key: rawByte(80), value: rawInt(state.ammoReserve) },
    { key: rawByte(89), value: rawByte(state.type) },
  ]);
  return rawEvent(96, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: reload },
  ]);
}

function scheduleReloadTick(session, state, channel, reloadSeq, delayMs) {
  clearWeaponReloadTimer(state);
  state.reloadTimer = setTimeout(() => {
    state.reloadTimer = null;
    applyReloadTick(session, state, channel, reloadSeq);
  }, Math.max(0, delayMs));
  if (typeof state.reloadTimer.unref === "function") {
    state.reloadTimer.unref();
  }
}

function applyReloadTick(session, state, channel, reloadSeq) {
  if (!session || !state || state.reloadSeq !== reloadSeq || !state.reloading) return;
  if (session.weaponStates?.get?.(state.slot) !== state) return;

  const missing = Math.max(0, state.maxLoadedAmmo - state.loadedAmmo);
  const reserve = Math.max(0, state.ammoReserve);
  if (missing <= 0 || reserve <= 0) {
    cancelWeaponReload(state, "complete-empty");
    return;
  }

  const amount = isComplexReloadWeaponState(state) ? 1 : Math.min(missing, reserve);
  state.loadedAmmo += amount;
  state.ammoReserve -= amount;
  const event = makeReloadUpdateEvent(session, state);
  sendReliableToSession(session, event, channel);
  broadcastReliableToRoom(session, event, channel, "reload");
  console.log(`[event] reload tick actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} amount=${amount}`);

  if (
    isComplexReloadWeaponState(state) &&
    state.loadedAmmo < state.maxLoadedAmmo &&
    state.ammoReserve > 0 &&
    Date.now() < state.reloadFullUntil
  ) {
    scheduleReloadTick(session, state, channel, reloadSeq, reloadSingleDurationMs(state));
    return;
  }

  state.reloading = false;
  state.reloadStartedAt = 0;
  state.reloadFullUntil = 0;
}

function allowWeaponShot(session, state, launchMode) {
  if (!state) return { ok: true, reason: "unknown-state" };

  const now = Date.now();
  const intervalMs = numberOr(state.shotIntervalMs, shotIntervalMsFromRapidity(state.rapidity));
  const consumesAmmo = shotConsumesAmmo(state.type, launchMode);
  if (isWeaponControlShot(state, launchMode)) {
    return { ok: true, reason: "control-event", intervalMs };
  }

  if (state.nextShotAt && now + SHOT_THROTTLE_SLACK_MS < state.nextShotAt) {
    return { ok: false, reason: "rate", waitMs: state.nextShotAt - now, intervalMs };
  }

  if (state.reloading && (!isComplexReloadWeaponState(state) || state.loadedAmmo <= 0)) {
    return { ok: false, reason: "reload", waitMs: Math.max(0, Math.min(state.reloadFullUntil || now, Date.now() + reloadSingleDurationMs(state)) - now), intervalMs };
  }

  if (!consumesAmmo) {
    state.nextShotAt = now + intervalMs;
    return { ok: true, reason: "no-ammo-event", intervalMs };
  }

  if (state.loadedAmmo <= 0) {
    return { ok: false, reason: "empty", intervalMs };
  }

  state.nextShotAt = now + intervalMs;
  return { ok: true, reason: "shot", intervalMs };
}

function noteWeaponShot(session, parsed) {
  const data = parsed?.params?.get(245);
  const weaponType = htGet(data, 91)?.value;
  const launchMode = numberOr(htGet(data, 16)?.value, 0);
  const state = weaponStateByType(session, weaponType);
  if (!state || !shotConsumesAmmo(state.type, launchMode)) return;
  if (state.reloading) cancelWeaponReload(state, "interrupted-by-shot");
  state.loadedAmmo = Math.max(0, state.loadedAmmo - 1);
}

function buildShotEvent(session, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;

  const weaponType = htGet(data, 91)?.value;
  const launchMode = numberOr(htGet(data, 16)?.value, 0);
  const state = weaponStateByType(session, weaponType);
  const gate = allowWeaponShot(session, state, launchMode);
  if (!gate.ok) {
    console.log(`[event] shot blocked actor=${session.actorId} type=${weaponType} mode=${launchMode} reason=${gate.reason}${gate.waitMs ? ` wait=${gate.waitMs}ms` : ""}`);
    return null;
  }

  noteWeaponShot(session, parsed);
  const ammo = state
    ? (shotConsumesAmmo(state.type, launchMode)
      ? ` loaded=${state.loadedAmmo} reserve=${state.ammoReserve} interval=${gate.intervalMs}ms gate=${gate.reason}`
      : ` interval=${gate.intervalMs}ms gate=${gate.reason}`)
    : "";
  console.log(`[event] shot actor=${session.actorId} type=${weaponType} mode=${launchMode}${ammo}`);
  return rawEvent(97, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function buildPickItemEvent(session, parsed) {
  const data = parsed?.params?.get(245);
  const id = numberOr(htGet(data, 75)?.value, 0);
  if (!id || !session?.room) return null;

  const items = ensureRoomItems(session.room);
  const item = items.get(id);
  if (!item) {
    console.log(`[event] item-pick ignored actor=${session.actorId} id=${id} reason=unknown`);
    return null;
  }
  if (item.picked) {
    console.log(`[event] item-pick ignored actor=${session.actorId} id=${id} reason=already-picked`);
    return null;
  }
  if (!itemCanBenefitSession(session, item)) {
    console.log(`[event] item-pick ignored actor=${session.actorId} id=${id} reason=no-benefit`);
    return null;
  }

  return takeRoomItem(session, item, "client-request");
}

function takeRoomItem(session, item, reason) {
  if (!item || item.picked) return null;

  item.picked = true;
  item.nextRespawnAt = ITEM_RESPAWN_MS > 0 ? Date.now() + ITEM_RESPAWN_MS : 0;
  if (item.type === ITEM_TYPES.AMMO) {
    const percent = Math.max(0, numberOr(item.value, 0));
    for (const state of ammoPickupStates(session)) {
      const amount = Math.floor(numberOr(state.maxAmmoReserve, 0) * percent / 100);
      state.ammoReserve = Math.min(reserveCapForState(state), state.ammoReserve + amount);
    }
  } else if (item.type === ITEM_TYPES.HEALTH) {
    const stats = sessionRuntimeStats(session);
    session.health = Math.min(stats.maxHealth, numberOr(session.health, stats.maxHealth) + numberOr(item.value, 0));
  } else if (item.type === ITEM_TYPES.ARMOR) {
    const stats = sessionRuntimeStats(session);
    session.energy = Math.min(stats.maxEnergy, numberOr(session.energy, stats.maxEnergy) + numberOr(item.value, 0));
  }

  console.log(`[event] item-pick actor=${session.actorId} id=${item.id} type=${item.type} subType=${item.subType ?? 0} value=${item.value} reason=${reason}${ITEM_RESPAWN_MS > 0 ? ` respawn=${ITEM_RESPAWN_MS}ms` : ""}`);
  return rawEvent(93, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeItemRaw(item) },
  ]);
}

function buildProximityPickItemEvent(session, point) {
  if (!ENABLE_MAP_PICKUPS || !point || !session?.room) return null;
  const items = ensureRoomItems(session.room);
  const radiusSquared = ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const item of items.values()) {
    if (item.picked || !itemCanBenefitSession(session, item)) continue;
    const dist = distanceSquared(point, item);
    if (dist <= radiusSquared && dist < nearestDistance) {
      nearest = item;
      nearestDistance = dist;
    }
  }

  return nearest ? takeRoomItem(session, nearest, "move-proximity") : null;
}

function buildWeaponChangeEvent(session, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;
  const slot = numberOr(htGet(data, 78)?.value, 0);
  const state = weaponStateBySlot(session, slot);
  if (state) session.currentWeaponSlot = slot;
  console.log(`[event] weapon-change actor=${session.actorId}${describeWeaponEventData(data)}${state ? ` name=${state.systemName}` : ""}`);
  return rawEvent(98, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function buildReloadEvent(session, parsed, channel = 0) {
  const data = parsed?.params?.get(245);
  const requestedType = htGet(data, 89)?.value;
  const state = weaponStateByType(session, requestedType);
  if (!state) {
    console.log(`[event] reload ignored actor=${session.actorId} missingType=${requestedType}`);
    return null;
  }

  if (isColdArmsWeaponType(state.type)) {
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=cold-arms`);
    return null;
  }

  const missing = Math.max(0, state.maxLoadedAmmo - state.loadedAmmo);
  const reserve = Math.max(0, state.ammoReserve);
  const amount = Math.min(missing, reserve);
  if (amount <= 0) {
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=full-or-empty loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
    return null;
  }

  if (state.reloading) {
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=already-reloading loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
    return null;
  }

  const now = Date.now();
  state.reloadSeq = (state.reloadSeq || 0) + 1;
  state.reloading = true;
  state.reloadStartedAt = now;
  state.reloadFullUntil = now + numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs));
  const firstTickMs = isComplexReloadWeaponState(state) ? reloadSingleDurationMs(state) : numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs));
  scheduleReloadTick(session, state, channel, state.reloadSeq, firstTickMs);
  console.log(`[event] reload start actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} first=${firstTickMs}ms full=${state.reloadFullUntil - now}ms complex=${isComplexReloadWeaponState(state) ? 1 : 0}`);
  return null;
}
function queueAutoSpawn(session, requestedTeam, reason) {
  if (!AUTO_SPAWN_AFTER_GAMESTATE || session.moveSeen) return;
  session.spawnRetry = {
    team: normalizeTeamForRoom(session, requestedTeam),
    attempts: 0,
    nextAt: Date.now() + AUTO_SPAWN_RETRY_MS,
    reason,
  };
}

function maybeAppendQueuedSpawn(session, commands, channel) {
  if (!session.spawnRetry || session.moveSeen) return;

  const now = Date.now();
  if (now < session.spawnRetry.nextAt) return;

  if (session.spawnRetry.attempts >= AUTO_SPAWN_RETRY_LIMIT) {
    console.log(`[event] auto-spawn retry exhausted actor=${session.actorId}`);
    session.spawnRetry = null;
    return;
  }

  session.spawnRetry.attempts += 1;
  session.spawnRetry.nextAt = now + AUTO_SPAWN_RETRY_MS;
  const spawnResponse = buildSpawnEvent(session, session.spawnRetry.team, `auto-retry-${session.spawnRetry.attempts}`);
  commands.push(makeReliable(session.serverSeq++, spawnResponse, channel));
  broadcastSpawnToRoom(session, spawnResponse, channel);
}

function roomListData(room) {
  const users = room?.players?.size || 0;
  return [
    stringOr(room?.map, DEFAULT_MAP),
    String(shortRoomValue(room?.lvlMin, 1, 1, 99)),
    String(shortRoomValue(room?.lvlMax, 50, 1, 99)),
    String(shortRoomValue(room?.mode, FORCE_TEAM_MODE ? 2 : 1, 1, 255)),
    String(shortRoomValue(room?.timeLimit, 10, 1, 50)),
    String(shortRoomValue(room?.fragLimit, 50, 1, 1000)),
    String(shortRoomValue(users, 0, 0, 32767)),
    String(shortRoomValue(room?.maxUsers, 8, Math.max(1, users), 64)),
    String(boolOr(room?.friendlyFire, false)),
    String(Boolean(room?.password)),
  ];
}

function makeRoomListRaw() {
  const entries = [];
  for (const room of rooms.values()) {
    if (!room?.name) continue;
    if ((room.players?.size || 0) <= 0) continue;
    entries.push({
      key: rawString(room.name),
      value: rawStringArray(roomListData(room)),
    });
  }
  return rawHashtable(entries);
}

function roomListSummary() {
  return Array.from(rooms.values())
    .filter((room) => room?.name && (room.players?.size || 0) > 0)
    .map((room) => `${room.name}:${room.map}:${room.players.size}/${room.maxUsers || 8}`)
    .join(",") || "empty";
}

function makeRoomListEvent(session) {
  return rawEvent(252, [
    { key: 254, value: rawInt(session?.actorId || 0) },
    { key: 245, value: makeRoomListRaw() },
  ]);
}

function ensureRoom(settings) {
  const name = settings.name || DEFAULT_ROOM;
  const mode = Number(settings.mode ?? 1);
  if (!rooms.has(name)) {
    rooms.set(name, {
      name,
      map: settings.map || DEFAULT_MAP,
      mode: Number.isFinite(mode) && mode > 0 ? mode : 1,
      maxUsers: settings.maxUsers || 8,
      friendlyFire: settings.friendlyFire || false,
      timeLimit: settings.timeLimit || 10,
      fragLimit: settings.fragLimit || 50,
      lvlMin: settings.lvlMin || 1,
      lvlMax: settings.lvlMax || 50,
      password: settings.password || "",
      guestMode: settings.guestMode || 0,
      startedAt: photonNow(),
      players: new Map(),
      moves: 0,
      items: makeRoomItemState(settings.map || DEFAULT_MAP),
    });
  } else {
    const room = rooms.get(name);
    if (room.players.size === 0 && settings.hasFullSettings !== false) {
      room.map = settings.map || room.map || DEFAULT_MAP;
      room.mode = Number.isFinite(mode) && mode > 0 ? mode : room.mode;
      room.maxUsers = settings.maxUsers || room.maxUsers || 8;
      room.friendlyFire = settings.friendlyFire || false;
      room.timeLimit = settings.timeLimit || room.timeLimit || 10;
      room.fragLimit = settings.fragLimit || room.fragLimit || 50;
      room.lvlMin = settings.lvlMin || room.lvlMin || 1;
      room.lvlMax = settings.lvlMax || room.lvlMax || 50;
      room.password = settings.password || "";
      room.guestMode = settings.guestMode || 0;
      room.startedAt = photonNow();
      room.moves = 0;
      room.items = makeRoomItemState(room.map);
    }
    ensureRoomItems(room);
  }
  return rooms.get(name);
}

function nextRoomActorId(room) {
  if (!room?.players) return 1;
  const maxUsers = Math.max(1, Number(room.maxUsers || 8));
  for (let actorId = 1; actorId <= maxUsers + 32; actorId += 1) {
    if (!room.players.has(actorId)) return actorId;
  }
  let actorId = maxUsers + 33;
  while (room.players.has(actorId)) actorId += 1;
  return actorId;
}

function resetReliableDedupe(session, reason = "reset", options = {}) {
  if (!session) return;
  const cached = session.reliableResponses?.size || 0;
  const inFlight = session.reliableInFlight?.size || 0;
  session.reliableResponses?.clear?.();
  if (options.clearInFlight !== false) {
    session.reliableInFlight?.clear?.();
  }
  if (options.bumpGeneration) {
    session.reliableGeneration = (session.reliableGeneration || 0) + 1;
  }
  if (cached || inFlight || options.bumpGeneration) {
    console.log(`[state] reliable cache reset reason=${reason} cached=${cached} inflight=${inFlight}${options.clearInFlight === false ? " preserved" : ""} gen=${session.reliableGeneration || 0}`);
  }
}

function clearJoinSelfTimer(session) {
  if (!session?.joinSelfEventTimer) return;
  clearTimeout(session.joinSelfEventTimer);
  session.joinSelfEventTimer = null;
}

function clearSpawnMoveWarningTimer(session) {
  if (!session?.spawnMoveWarningTimer) return;
  clearTimeout(session.spawnMoveWarningTimer);
  session.spawnMoveWarningTimer = null;
}

function queueSpawnNoMoveWarning(session, point, reason) {
  clearSpawnMoveWarningTimer(session);
  if (!SPAWN_NO_MOVE_WARN_MS) return;
  const actorId = session.actorId;
  const roomName = session.room?.name;
  const mapName = session.room?.map || DEFAULT_MAP;
  session.spawnMoveWarningTimer = setTimeout(() => {
    session.spawnMoveWarningTimer = null;
    if (session.actorId !== actorId || session.room?.name !== roomName || session.moveSeen) {
      return;
    }
    console.log(`[warn] spawn-no-move actor=${actorId} map=${mapName} reason=${reason} pos=${fmtPoint(point)} wait=${SPAWN_NO_MOVE_WARN_MS}ms`);
  }, SPAWN_NO_MOVE_WARN_MS);
  if (typeof session.spawnMoveWarningTimer.unref === "function") {
    session.spawnMoveWarningTimer.unref();
  }
}

function resetSessionRoomProgress(session) {
  if (!session) return;
  session.spawned = false;
  session.moveSeen = false;
  session.spawnRetry = null;
  clearSpawnMoveWarningTimer(session);
  clearPeerSpawnTimers(session);
  clearJoinRoomTimers(session);
  clearSessionWeaponReloadTimers(session);
  session.gameStateRequested = false;
  session.lastGameStateResponseAt = 0;
  session.knownActorIds = new Set();
  session.actorJoinAnnouncedAt = new Map();
  session.team = -1;
  session.lastTransform = null;
}

function detachSessionFromRoom(session, reason = "leave") {
  if (session?.room?.players) {
    for (const [actorId, playerSession] of session.room.players.entries()) {
      if (playerSession === session) {
        broadcastReliableToRoom(session, makeActorLeaveEvent(actorId), 0, "actor-leave");
        session.room.players.delete(actorId);
        forgetActorForRoom(session.room, actorId);
        console.log(`[state] room player removed reason=${reason} room=${session.room.name} actor=${actorId}`);
      }
    }
  }
  resetSessionRoomProgress(session);
}

function resetTransportForReconnect(session, reason) {
  detachSessionFromRoom(session, reason);
  resetReliableDedupe(session, reason, { bumpGeneration: true });
  session.serverSeq = 0;
  session.verifySeq = null;
  session.seenVerify = false;
  session.room = ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 });
  session.roomRaw = makeRoomSettingsRaw(session.room);
  session.actorRaw = null;
  session.currentWeaponSlot = 1;
  session.weaponStates = makeWeaponRuntimeState(null);
  session.health = playerRuntimeStats(null).maxHealth;
  session.energy = playerRuntimeStats(null).maxEnergy;
}

function removeDuplicatePlayerSessions(room, session) {
  if (!room?.players) return;
  for (const [actorId, playerSession] of room.players.entries()) {
    if (
      playerSession !== session &&
      (
        (session.playerId && playerSession.playerId === session.playerId) ||
        (session.remoteKey && playerSession.remoteKey === session.remoteKey)
      )
    ) {
      broadcastReliableToRoom(playerSession, makeActorLeaveEvent(actorId), 0, "stale-leave");
      room.players.delete(actorId);
      forgetActorForRoom(room, actorId);
      playerSession.spawnRetry = null;
      clearSpawnMoveWarningTimer(playerSession);
      clearJoinRoomTimers(playerSession);
      clearSessionWeaponReloadTimers(playerSession);
      playerSession.gameStateRequested = false;
      console.log(`[state] stale player removed room=${room.name} actor=${actorId} player=${playerSession.playerId || "unknown"}`);
    }
  }
}

function makeActorJoinEvent(session) {
  return rawEvent(105, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: session.actorRaw || rawHashtable([]) },
  ]);
}

function makeActorLeaveEvent(actorId) {
  return rawEvent(106, [
    { key: 254, value: rawInt(actorId) },
    { key: 245, value: rawHashtable([]) },
  ]);
}

function ensureKnownActorSet(session) {
  if (!session) return null;
  if (!(session.knownActorIds instanceof Set)) session.knownActorIds = new Set();
  return session.knownActorIds;
}

function ensureActorAnnounceMap(session) {
  if (!session) return null;
  if (!(session.actorJoinAnnouncedAt instanceof Map)) session.actorJoinAnnouncedAt = new Map();
  return session.actorJoinAnnouncedAt;
}

function ensurePeerSpawnTimerSet(session) {
  if (!session) return null;
  if (!(session.peerSpawnTimers instanceof Set)) session.peerSpawnTimers = new Set();
  return session.peerSpawnTimers;
}

function clearPeerSpawnTimers(session) {
  if (!(session?.peerSpawnTimers instanceof Set)) return;
  for (const timer of session.peerSpawnTimers) {
    clearTimeout(timer);
  }
  session.peerSpawnTimers.clear();
}

function markActorKnown(session, actorId) {
  const normalizedActorId = Number(actorId);
  if (!Number.isInteger(normalizedActorId) || normalizedActorId <= 0) return;
  ensureKnownActorSet(session)?.add(normalizedActorId);
  session?.actorJoinAnnouncedAt?.delete?.(normalizedActorId);
}

function markActorAnnounced(session, actorId) {
  const normalizedActorId = Number(actorId);
  if (!Number.isInteger(normalizedActorId) || normalizedActorId <= 0) return;
  if (sessionKnowsActor(session, normalizedActorId)) return;
  ensureActorAnnounceMap(session)?.set(normalizedActorId, Date.now());
}

function sessionKnowsActor(session, actorId) {
  const normalizedActorId = Number(actorId);
  return Number.isInteger(normalizedActorId) && session?.knownActorIds instanceof Set && session.knownActorIds.has(normalizedActorId);
}

function actorAnnounceAgeMs(session, actorId) {
  const normalizedActorId = Number(actorId);
  if (!Number.isInteger(normalizedActorId) || !(session?.actorJoinAnnouncedAt instanceof Map)) return null;
  const announcedAt = session.actorJoinAnnouncedAt.get(normalizedActorId);
  return Number.isFinite(announcedAt) ? Date.now() - announcedAt : null;
}

function sessionHasActorData(session, actorId) {
  const normalizedActorId = Number(actorId);
  if (!Number.isInteger(normalizedActorId)) return false;
  return sessionKnowsActor(session, normalizedActorId) || actorAnnounceAgeMs(session, normalizedActorId) != null;
}

function markKnownRoomActors(session) {
  if (!session?.room?.players) return;
  markActorKnown(session, session.actorId);
  for (const [actorId, playerSession] of session.room.players.entries()) {
    if (!playerSession || playerSession === session || !playerSession.actorRaw) continue;
    markActorKnown(session, actorId);
  }
}

function forgetActorForRoom(room, actorId) {
  const normalizedActorId = Number(actorId);
  if (!Number.isInteger(normalizedActorId) || !room?.players?.size) return;
  for (const playerSession of room.players.values()) {
    playerSession?.knownActorIds?.delete?.(normalizedActorId);
    playerSession?.actorJoinAnnouncedAt?.delete?.(normalizedActorId);
  }
}

function schedulePeerSpawnEvent(targetSession, sourceSession, spawnPayload, channel, delayMs) {
  const room = sourceSession?.room;
  const sourceActorId = sourceSession?.actorId;
  const targetActorId = targetSession?.actorId;
  if (!room || !sourceActorId || !targetActorId || !spawnPayload) return false;
  const timerSet = ensurePeerSpawnTimerSet(targetSession);
  const waitMs = Math.max(0, Number(delayMs) || 0);
  const timer = setTimeout(() => {
    timerSet?.delete(timer);
    if (sourceSession.room !== room || targetSession.room !== room) return;
    if (room.players.get(sourceActorId) !== sourceSession || room.players.get(targetActorId) !== targetSession) return;
    if (!targetSession.gameStateRequested) return;
    if (sendReliableToSession(targetSession, spawnPayload, channel)) {
      markActorKnown(targetSession, sourceActorId);
      console.log(`[sync] spawn-delayed actor=${sourceActorId} peer=${targetActorId} delay=${waitMs}ms`);
    }
  }, waitMs);
  timerSet?.add(timer);
  if (typeof timer.unref === "function") timer.unref();
  return true;
}

function broadcastSpawnToRoom(sourceSession, spawnPayload, channel = 0) {
  const room = sourceSession?.room;
  if (!room?.players?.size || !spawnPayload) return 0;
  let sent = 0;
  let announced = 0;
  let queued = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === sourceSession || !playerSession.gameStateRequested) continue;

    if (sessionKnowsActor(playerSession, sourceSession.actorId)) {
      if (sendReliableToSession(playerSession, spawnPayload, channel)) sent += 1;
      continue;
    }

    const announceAge = actorAnnounceAgeMs(playerSession, sourceSession.actorId);
    if (announceAge == null) {
      if (sendReliableToSession(playerSession, makeActorJoinEvent(sourceSession), channel)) {
        markActorAnnounced(playerSession, sourceSession.actorId);
        announced += 1;
        if (schedulePeerSpawnEvent(playerSession, sourceSession, spawnPayload, channel, ACTOR_JOIN_ASYNC_DELAY_MS)) queued += 1;
      }
      continue;
    }

    const remainingDelay = ACTOR_JOIN_ASYNC_DELAY_MS - announceAge;
    if (remainingDelay > 0) {
      if (schedulePeerSpawnEvent(playerSession, sourceSession, spawnPayload, channel, remainingDelay)) queued += 1;
      continue;
    }

    if (sendReliableToSession(playerSession, spawnPayload, channel)) {
      markActorKnown(playerSession, sourceSession.actorId);
      sent += 1;
    }
  }
  if (sent > 0 || announced > 0 || queued > 0) {
    console.log(`[sync] spawn actor=${sourceSession.actorId} peers=${sent} announced=${announced} queued=${queued}`);
  }
  return sent;
}

function makeJoinSelfEvent(session) {
  return rawEvent(255, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 249, value: session.actorRaw || rawHashtable([]) },
  ]);
}

function makeJoinStartEvent(session) {
  return rawEvent(103, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: rawHashtable([]) },
  ]);
}

function makeJoinSettingsRaw(session, actorListRaw = null) {
  return rawHashtable([
    { key: rawByte(100), value: session.roomRaw || rawHashtable([]) },
    { key: rawByte(99), value: actorListRaw || makeRoomActorListRaw(session.room, session) },
    { key: rawByte(98), value: session.actorRaw || rawHashtable([]) },
    { key: rawByte(97), value: rawInt(session.actorId) },
  ]);
}

function makeJoinSettingsEvent(session) {
  return rawEvent(107, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeJoinSettingsRaw(session) },
  ]);
}

function clearJoinSettingsTimers(session) {
  if (!session?.joinSettingsTimers) return;
  for (const timer of session.joinSettingsTimers) {
    clearTimeout(timer);
  }
  session.joinSettingsTimers = [];
}

function clearJoinStartTimer(session) {
  if (!session?.joinStartEventTimer) return;
  clearTimeout(session.joinStartEventTimer);
  session.joinStartEventTimer = null;
}

function clearJoinLateStartTimers(session) {
  if (!session?.joinLateStartTimers) return;
  for (const timer of session.joinLateStartTimers) {
    clearTimeout(timer);
  }
  session.joinLateStartTimers = [];
}

function clearJoinRoomTimers(session) {
  clearJoinSelfTimer(session);
  clearJoinStartTimer(session);
  clearJoinSettingsTimers(session);
  clearJoinLateStartTimers(session);
}

function queueJoinSettingsPushes(port, socket, rinfo, session, channel = 0) {
  clearJoinSettingsTimers(session);
  if (!JOIN_SETTINGS_PUSH_DELAYS_MS.length) return;
  session.joinSettingsTimers = JOIN_SETTINGS_PUSH_DELAYS_MS.map((delayMs) => {
    const timer = setTimeout(() => {
      if (sessions.get(key(port, rinfo)) !== session || session.gameStateRequested) {
        return;
      }
      console.log(`[event] join-settings-push actor=${session.actorId} delay=${delayMs}ms actorRaw=${session.actorRaw?.length || 0} roomRaw=${session.roomRaw?.length || 0}`);
      markKnownRoomActors(session);
      sendReliablePayload(socket, rinfo, session, makeJoinSettingsEvent(session), channel);
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  });
}

function queueJoinStartFallback(port, socket, rinfo, session, channel = 0) {
  clearJoinStartTimer(session);
  // Normal slow-load recovery is handled by join-late-start pulses; this early one-shot is opt-in for diagnostics.
  if (JOIN_START_EVENT_FALLBACK_DELAY_MS <= 0) return;
  const actorId = session.actorId;
  session.joinStartEventTimer = setTimeout(() => {
    session.joinStartEventTimer = null;
    if (sessions.get(key(port, rinfo)) !== session || session.actorId !== actorId || session.gameStateRequested) {
      return;
    }
    console.log(`[event] join-start-fallback actor=${actorId} delay=${JOIN_START_EVENT_FALLBACK_DELAY_MS}ms`);
    sendReliablePayload(socket, rinfo, session, makeJoinStartEvent(session), channel);
  }, JOIN_START_EVENT_FALLBACK_DELAY_MS);
  if (typeof session.joinStartEventTimer.unref === "function") {
    session.joinStartEventTimer.unref();
  }
}

function queueJoinLateStartPulses(port, socket, rinfo, session, channel = 0) {
  clearJoinLateStartTimers(session);
  if (!JOIN_LATE_START_DELAYS_MS.length) return;
  const actorId = session.actorId;
  session.joinLateStartTimers = JOIN_LATE_START_DELAYS_MS.map((delayMs) => {
    const timer = setTimeout(() => {
      if (sessions.get(key(port, rinfo)) !== session || session.actorId !== actorId || session.gameStateRequested) {
        return;
      }
      console.log(`[event] join-late-start-pulse actor=${actorId} delay=${delayMs}ms`);
      sendReliablePayload(socket, rinfo, session, makeJoinStartEvent(session), channel);
      markKnownRoomActors(session);
      sendReliablePayload(socket, rinfo, session, makeJoinSettingsEvent(session), channel);
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  });
}

function buildJoinAccepted(port, socket, rinfo, session, channel = 0, actorListRaw = null, options = {}) {
  const response = rawOperationResponse(255, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 249, value: actorListRaw || makeRoomActorListRaw(session.room, session) },
    { key: 248, value: session.roomRaw },
  ]);
  const selfDelayMs = options.waitForProfile ? JOIN_SELF_PROFILE_WAIT_MS : JOIN_SELF_EVENT_DELAY_MS;

  if (!options.waitForProfile) {
    queueJoinSettingsPushes(port, socket, rinfo, session, channel);
    queueJoinStartFallback(port, socket, rinfo, session, channel);
    queueJoinLateStartPulses(port, socket, rinfo, session, channel);
  } else {
    clearJoinSettingsTimers(session);
    clearJoinStartTimer(session);
    clearJoinLateStartTimers(session);
  }

  if (selfDelayMs <= 0) {
    return [response, makeJoinSelfEvent(session)];
  }

  if (session.joinSelfEventTimer) {
    clearTimeout(session.joinSelfEventTimer);
  }
  const actorId = session.actorId;
  const startedAt = Date.now();
  const scheduleSelfJoin = (delayMs) => {
    session.joinSelfEventTimer = setTimeout(() => {
      session.joinSelfEventTimer = null;
      if (sessions.get(key(port, rinfo)) !== session || session.actorId !== actorId) {
        return;
      }

      if (options.waitForProfile && isFallbackBattleProfile(session.loadedProfile)) {
        const elapsed = Date.now() - startedAt;
        if (elapsed < JOIN_PROFILE_MAX_WAIT_MS) {
          console.log(`[event] join-self wait-profile actor=${actorId} elapsed=${elapsed}ms retry=${JOIN_PROFILE_RETRY_MS}ms`);
          if (options.incomingActor) {
            warmPlayerProfile(options.incomingActor, "join-self-retry").then((loadedProfile) => {
              if (sessions.get(key(port, rinfo)) === session && session.actorId === actorId) {
                applyLateProfile(session, loadedProfile, options.incomingActor);
              }
            });
          }
          scheduleSelfJoin(JOIN_PROFILE_RETRY_MS);
          return;
        }
        if (!ALLOW_FALLBACK_JOIN_PROFILE) {
          console.log(`[event] join-self blocked fallback-profile actor=${actorId} elapsed=${elapsed}ms`);
          return;
        }
      }

      console.log(`[event] delayed join-self actor=${actorId} delay=${delayMs}ms actorRaw=${session.actorRaw?.length || 0} profileWait=${options.waitForProfile ? "on" : "off"}`);
      sendReliablePayload(socket, rinfo, session, makeJoinSelfEvent(session), channel);
      queueJoinSettingsPushes(port, socket, rinfo, session, channel);
      queueJoinStartFallback(port, socket, rinfo, session, channel);
      queueJoinLateStartPulses(port, socket, rinfo, session, channel);
    }, delayMs);
    if (typeof session.joinSelfEventTimer.unref === "function") {
      session.joinSelfEventTimer.unref();
    }
  };
  scheduleSelfJoin(selfDelayMs);

  return [response];
}

function eventDataHash(parsed) {
  const evData = parsed.params.get(245);
  return evData && evData.type === 0x68 ? evData : null;
}

function getTeamFromEventData(parsed, fallback = 1) {
  const data = eventDataHash(parsed);
  const team = htGet(data, 239)?.value;
  if (team === 0 || team === 1 || team === 2) return team;
  return fallback;
}

function jsonForDb(session, extra = {}) {
  return {
    token: API_TOKEN,
    roomName: session.room?.name || DEFAULT_ROOM,
    mapName: session.room?.map || DEFAULT_MAP,
    mode: session.room?.mode ?? 1,
    maxPlayers: session.room?.maxUsers || 8,
    serverHost: PUBLIC_HOST,
    serverPort: session.port,
    playerId: session.playerId || 1,
    actorId: session.actorId || 1,
    team: session.team ?? -1,
    health: extra.health ?? 100,
    energy: extra.energy ?? 100,
    roomSettings: {
      name: session.room?.name || DEFAULT_ROOM,
      map: session.room?.map || DEFAULT_MAP,
      mode: session.room?.mode ?? 1,
      forceTeamMode: FORCE_TEAM_MODE,
    },
    ...extra,
  };
}

async function postBattleEvent(session, type, extra = {}) {
  if (!API_BASE_URL || typeof fetch !== "function") return;
  try {
    const response = await fetch(`${API_BASE_URL}/battle/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(jsonForDb(session, { type, ...extra })),
    });
    if (!response.ok) {
      console.log(`[api] ${type} failed status=${response.status}`);
    } else {
      console.log(`[api] ${type} ok`);
    }
  } catch (error) {
    console.log(`[api] ${type} failed ${error.message}`);
  }
}

async function handleOperation(port, socket, rinfo, session, parsed, channel = 0) {
  if (!parsed || parsed.messageType !== 2) {
    console.log(`[photon] unsupported messageType=${parsed?.messageType ?? "null"}`);
    return [];
  }

  const eventCode = photonEventCode(parsed);
  if (shouldLogParsedPayload(parsed)) {
    console.log(`[photon] op=${parsed.opCode} params=${Array.from(parsed.params.keys()).join(",")}`);
  }

  if (parsed.opCode === 255) {
    const roomNameParam = parsed.params.get(255);
    const roomPropsParam = parsed.params.get(248);
    const actorParam = parsed.params.get(249);
    const requestedName = roomNameParam?.value || DEFAULT_ROOM;

    if (String(requestedName).includes("list_lobby")) {
      session.room = ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 });
      session.roomRaw = makeRoomSettingsRaw(session.room);
      session.actorRaw = actorParam?.raw || session.actorRaw || rawHashtable([]);
      warmPlayerProfile(actorParam, "list-lobby");
      if (port === 5058) {
        console.log(`[state] game-logic lobby accepted port=${port} lobby=${requestedName}`);
        return [
          rawEvent(255, [
            { key: 225, value: rawInt(session.actorId) },
            { key: 213, value: rawHashtable([]) },
          ]),
          rawOperationResponse(255, []),
        ];
      }
      console.log(`[state] server-list refresh accepted port=${port} lobby=${requestedName}`);
      return [
        rawOperationResponse(255, [{ key: 75, value: rawInt(1) }], -3),
      ];
    }

    const plainLobbyJoin = !roomPropsParam || !parsed.params.has(242) || !parsed.params.has(250);
    if (plainLobbyJoin) {
      session.room = ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 });
      session.roomRaw = makeRoomSettingsRaw(session.room);
      session.actorRaw = actorParam?.raw || session.actorRaw || rawHashtable([]);
      warmPlayerProfile(actorParam, "plain-lobby");
      console.log(`[state] plain lobby join accepted port=${port} lobby=${requestedName} actorKeys=${describeHashtable(actorParam)}`);
      return [
        rawOperationResponse(255, [
          { key: 254, value: rawInt(session.actorId) },
          { key: 249, value: makeEmptyActorListRaw() },
          { key: 248, value: session.roomRaw },
        ]),
      ];
    }

    const settings = roomSettingsFrom(roomPropsParam);
    settings.name = settings.name || requestedName || DEFAULT_ROOM;
    resetReliableDedupe(session, "real-room-join", { clearInFlight: false });
    detachSessionFromRoom(session, "rejoin");
    const { profile, source: profileSource, pendingProfile } = await profileForJoin(actorParam);
    session.playerId = profile.authId;
    session.playerName = profile.name;
    session.loadedProfile = profile;
    session.currentWeaponSlot = 1;
    session.weaponStates = makeWeaponRuntimeState(profile);
    session.room = ensureRoom(settings);
    session.roomRaw = makeRoomSettingsRaw(session.room);
    removeDuplicatePlayerSessions(session.room, session);
    session.actorId = nextRoomActorId(session.room);
    session.actorRaw = makeActorDataRaw(actorParam, profile);
    const joinActorId = session.actorId;
    if (profileSource === "fallback") {
      (pendingProfile || warmPlayerProfile(actorParam, "late-room-profile")).then((loadedProfile) => {
        if (sessions.get(key(port, rinfo)) === session && session.actorId === joinActorId) {
          applyLateProfile(session, loadedProfile, actorParam);
        }
      });
    }
    const actorListRaw = makeRoomActorListRaw(session.room, session);
    session.knownActorIds = new Set();
    session.actorJoinAnnouncedAt = new Map();
    markKnownRoomActors(session);
    session.room.players.set(session.actorId, session);
    markActorKnown(session, session.actorId);
    session.gameStateRequested = false;
    console.log(`[state] room join accepted room=${session.room.name} map=${session.room.map} mode=${session.room.mode} player=${session.playerId} name=${session.playerName} profile=${profileSource} actorKeys=${describeHashtable(actorParam)} actorRaw=${session.actorRaw?.length || 0} roomRaw=${session.roomRaw?.length || 0}`);
    postBattleEvent(session, "join", { playerData: { remote: rinfo.address, name: session.playerName } });
    const responses = buildJoinAccepted(port, socket, rinfo, session, channel, actorListRaw, {
      waitForProfile: profileSource === "fallback",
      incomingActor: actorParam,
    });
    broadcastReliableToRoom(session, makeActorJoinEvent(session), channel, "actor-join", {
      markActorAnnounced: true,
      skipKnownActor: true,
    });
    return responses;
  }

  if (parsed.opCode === 254) {
    resetReliableDedupe(session, "op-leave");
    detachSessionFromRoom(session, "op-leave");
    return [rawOperationResponse(254, [])];
  }

  if (parsed.opCode !== 253) {
    console.log(`[op] unsupported op=${parsed.opCode}`);
    return [];
  }

  if (shouldLogParsedPayload(parsed)) {
    console.log(`[event] request code=${eventCode}`);
  }
  if (eventCode === 86) {
    console.log(`[event] room list request rooms=${roomListSummary()}`);
    return [makeRoomListEvent(session)];
  }

  if (eventCode === 84) {
    const now = Date.now();
    if (
      GAMESTATE_REPEAT_MIN_MS > 0 &&
      session.gameStateRequested &&
      !session.spawned &&
      session.lastGameStateResponseAt &&
      now - session.lastGameStateResponseAt < GAMESTATE_REPEAT_MIN_MS
    ) {
      console.log(`[event] game state request throttled actor=${session.actorId} age=${now - session.lastGameStateResponseAt}ms`);
      return [];
    }
    session.gameStateRequested = true;
    session.lastGameStateResponseAt = now;
    clearJoinRoomTimers(session);
    console.log(`[event] game state request actor=${session.actorId} room=${session.room?.name || DEFAULT_ROOM} roomAge=${roomAgeMs(session.room)}ms`);
    postBattleEvent(session, "gamestate");
    const responses = [
      rawEvent(84, [
        { key: 254, value: rawInt(session.actorId) },
        { key: 245, value: makeGameStateRaw(session) },
      ]),
    ];
    if (AUTO_SPAWN_AFTER_GAMESTATE && !session.spawned) {
      const spawnResponse = buildSpawnEvent(session, null, "auto-after-gamestate");
      responses.push(spawnResponse);
      broadcastSpawnToRoom(session, spawnResponse, channel);
      queueAutoSpawn(session, null, "post-gamestate");
    } else if (!session.spawned) {
      console.log(`[event] waiting client spawn request actor=${session.actorId} team=${normalizeTeamForRoom(session)} mode=${roomMode(session)}`);
    }
    return responses;
  }

  if (eventCode === 100) {
    const team = getTeamFromEventData(parsed, normalizeTeamForRoom(session));
    session.spawned = true;
    session.lastGameStateResponseAt = 0;
    session.spawnRetry = null;
    clearJoinRoomTimers(session);
    const response = buildSpawnEvent(session, team, "client-request");
    broadcastSpawnToRoom(session, response, channel);
    return [response];
  }

  if (eventCode === 99) {
    session.spawned = true;
    session.moveSeen = true;
    session.spawnRetry = null;
    clearJoinRoomTimers(session);
    clearSpawnMoveWarningTimer(session);
    session.room.moves += 1;
    const point = transformFromEventData(parsed);
    if (point) {
      session.lastTransform = point;
    }
    if (DEBUG_MOVE_PACKETS || session.room.moves <= 5 || session.room.moves % MOVE_LOG_EVERY === 0) {
      console.log(`[event] move actor=${session.actorId} count=${session.room.moves}${point ? ` pos=${fmtPoint(point)}` : ""}`);
    }
    if (session.room.moves === 1 || session.room.moves % 250 === 0) {
      postBattleEvent(session, "move", { eventData: { count: session.room.moves } });
    }
    const move = buildActorDataEvent(session, 99, parsed);
    const movePeers = broadcastReliableToRoom(session, move, channel, "", { requireGameState: true });
    if ((DEBUG_MOVE_PACKETS || session.room.moves <= 5 || session.room.moves % MOVE_LOG_EVERY === 0) && movePeers > 0) {
      console.log(`[sync] move actor=${session.actorId} peers=${movePeers} count=${session.room.moves}`);
    }
    const pickup = buildProximityPickItemEvent(session, point);
    if (pickup) broadcastReliableToRoom(session, pickup, channel, "item-pick");
    return pickup ? [pickup] : [];
  }

  if (eventCode === 96) {
    const response = buildReloadEvent(session, parsed, channel);
    if (response) broadcastReliableToRoom(session, response, channel, "reload");
    return response ? [response] : [];
  }

  if (eventCode === 93) {
    const response = buildPickItemEvent(session, parsed);
    if (response) broadcastReliableToRoom(session, response, channel, "item-pick");
    return response ? [response] : [];
  }

  if (eventCode === 97) {
    const response = buildShotEvent(session, parsed);
    if (response) broadcastReliableToRoom(session, response, channel, "shot");
    return response ? [response] : [];
  }

  if (eventCode === 98) {
    const response = buildWeaponChangeEvent(session, parsed);
    if (response) broadcastReliableToRoom(session, response, channel, "weapon-change");
    return response ? [response] : [];
  }
  if (eventCode === 77) {
    const animation = buildActorDataEvent(session, 77, parsed);
    broadcastReliableToRoom(session, animation, channel, "", { requireGameState: true });
    return [];
  }
  console.log(`[event] ack only code=${eventCode}`);
  return [];
}

async function handleUdp(port, socket, msg, rinfo) {
  let offset = 12;
  const sessionId = key(port, rinfo);
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      peerId: 1,
      actorId: 1,
      challenge: readU32(msg, 8),
      // VerifyConnect is an ENet control command and is not dispatched through
      // Photon payload order. The first real Photon payload must therefore use
      // reliable sequence 1, otherwise the Unity client ACKs it but waits for
      // missing sequence 1 forever.
      serverSeq: 0,
      verifySeq: null,
      seenVerify: false,
      room: ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 }),
      roomRaw: null,
      actorRaw: null,
      team: -1,
      spawned: false,
      moveSeen: false,
      currentWeaponSlot: 1,
      weaponStates: makeWeaponRuntimeState(null),
      spawnRetry: null,
      spawnMoveWarningTimer: null,
      joinSelfEventTimer: null,
      joinStartEventTimer: null,
      joinSettingsTimers: [],
      joinLateStartTimers: [],
      gameStateRequested: false,
      lastGameStateResponseAt: 0,
      reliableResponses: new Map(),
      reliableInFlight: new Map(),
      reliableGeneration: 0,
      knownActorIds: new Set(),
      actorJoinAnnouncedAt: new Map(),
      peerSpawnTimers: new Set(),
      lastChannel: 0,
      port,
      remoteKey: `${rinfo.address}:${rinfo.port}`,
      playerId: 1,
      playerName: process.env.DEFAULT_PLAYER_NAME || "ContraCity",
      health: playerRuntimeStats(null).maxHealth,
      energy: playerRuntimeStats(null).maxEnergy,
    };
    session.roomRaw = makeRoomSettingsRaw(session.room);
    sessions.set(sessionId, session);
  }
  const incomingChallenge = readU32(msg, 8);
  if (session.challenge && incomingChallenge && session.challenge !== incomingChallenge) {
    resetTransportForReconnect(session, `challenge-change ${session.challenge}->${incomingChallenge}`);
  }
  session.challenge = incomingChallenge;
  session.remoteKey = `${rinfo.address}:${rinfo.port}`;
  session.sessionId = sessionId;
  session.socket = socket;
  session.rinfo = { address: rinfo.address, port: rinfo.port };

  const commands = [];
  let peerIdOverride = null;
  let lastChannel = 0;
  const commandCount = msg[3] || 0;
  const sentTime = readU32(msg, 4);
  if (DEBUG_PACKETS) {
    console.log(`[udp:${port}] peer=${msg.readUInt16BE(0)} count=${commandCount} len=${msg.length}`);
  }

  for (let i = 0; i < commandCount && offset + 12 <= msg.length; i++) {
    const commandType = msg[offset];
    const channel = msg[offset + 1];
    lastChannel = channel;
    session.lastChannel = channel;
    const commandLength = readU32(msg, offset + 4);
    const reliableSeq = readU32(msg, offset + 8);
    const commandEnd = offset + commandLength;
    const payloadOffset = commandType === 0x07 ? offset + 16 : offset + 12;
    if (DEBUG_PACKETS || ![0x01, 0x04, 0x05, 0x06, 0x07, 0x0c].includes(commandType)) {
      console.log(`[cmd:${port}] type=${commandType} seq=${reliableSeq} size=${commandLength}`);
    }

    if (commandType === 0x02) {
      session.seenVerify = true;
      commands.push(makeAck(channel, reliableSeq, sentTime));
      if (session.verifySeq == null) {
        session.verifySeq = session.serverSeq++;
      }
      const verifySeq = session.verifySeq;
      commands.push(makeVerifyConnect(verifySeq));
      peerIdOverride = 0xffff;
      console.log(`[state] verify connect seq=${verifySeq}`);
    } else if (commandType === 0x05 || commandType === 0x0c || commandType === 0x04) {
      commands.push(makeAck(channel, reliableSeq, sentTime));
    } else if ((commandType === 0x06 || commandType === 0x07) && payloadOffset <= commandEnd) {
      commands.push(makeAck(channel, reliableSeq, sentTime));
      if (!session.seenVerify && session.verifySeq == null) {
        session.verifySeq = session.serverSeq++;
        commands.push(makeVerifyConnect(session.verifySeq));
        peerIdOverride = 0xffff;
        console.log(`[state] implicit verify connect seq=${session.verifySeq} reason=missing-handshake command=${commandType}`);
        offset = commandEnd;
        continue;
      }
      const cacheKey = commandType === 0x06 ? `${session.reliableGeneration || 0}:${channel}:${reliableSeq}` : null;
      if (cacheKey && session.reliableResponses.has(cacheKey)) {
        const cached = session.reliableResponses.get(cacheKey);
        commands.push(...cached);
        console.log(`[state] reliable replay seq=${reliableSeq} cached=${cached.length}`);
        offset = commandEnd;
        continue;
      }
      if (cacheKey && session.reliableInFlight.has(cacheKey)) {
        const cached = await session.reliableInFlight.get(cacheKey);
        commands.push(...cached);
        console.log(`[state] reliable replay-wait seq=${reliableSeq} cached=${cached.length}`);
        offset = commandEnd;
        continue;
      }

      const payload = msg.subarray(payloadOffset, commandEnd);
      try {
        const parsed = parsePhotonRequest(payload);
        if (shouldLogParsedPayload(parsed)) {
          if (parsed?.messageType === 2) {
            console.log(`[payload] op-request ${payload.toString("hex").slice(0, 160)}`);
          } else {
            console.log(`[payload] messageType=${parsed?.messageType ?? "raw"} ${payload.toString("hex").slice(0, 160)}`);
          }
        }

        const buildReliableCommands = async () => {
          if (payload[0] === 0xf3 && payload[1] === 0x00) {
            const initModes = INIT_REPLY === "both" ? ["callback", "legacy"] : [INIT_REPLY];
            const initSeqs = [];
            const reliableCommands = [];
            for (const initMode of initModes) {
              const initSeq = session.serverSeq++;
              initSeqs.push(initSeq);
              reliableCommands.push(makeReliable(initSeq, rawInit(initMode), channel));
            }
            console.log(`[state] init accepted reply=${initModes.join("+")} seq=${initSeqs.join(",")}`);
            if (PUSH_ROOM_LIST_AFTER_INIT) {
              const roomListSeq = session.serverSeq++;
              reliableCommands.push(makeReliable(roomListSeq, makeRoomListEvent(session), channel));
              console.log(`[event] room list pushed after init seq=${roomListSeq} rooms=${roomListSummary()}`);
            }
            return reliableCommands;
          }

          const responses = await handleOperation(port, socket, rinfo, session, parsed, channel);
          return responses.map((response) => makeReliable(session.serverSeq++, response, channel));
        };

        if (cacheKey) {
          const promise = buildReliableCommands()
            .then((reliableCommands) => cacheReliableResponse(session, cacheKey, reliableCommands))
            .finally(() => session.reliableInFlight.delete(cacheKey));
          session.reliableInFlight.set(cacheKey, promise);
          commands.push(...await promise);
        } else {
          commands.push(...await buildReliableCommands());
        }
      } catch (error) {
        console.log(`[parse] ${error.message}`);
        console.log(payload.toString("hex").match(/.{1,32}/g)?.join("\n") || "");
      }
    }

    offset = commandEnd;
  }

  maybeAppendQueuedSpawn(session, commands, lastChannel);
  maybeAppendRespawnItems(session, commands, lastChannel);

  if (commands.length > 0) {
    sendPacket(socket, rinfo, session, commands, peerIdOverride);
  }
}

console.log(`[config] build=${BUILD_ID} host=${PUBLIC_HOST} api=${API_BASE_URL} initReply=${INIT_REPLY} teamMode=${FORCE_TEAM_MODE ? "team" : "room"} autoSpawn=${AUTO_SPAWN_AFTER_GAMESTATE ? "on" : "off"} retry=${AUTO_SPAWN_RETRY_LIMIT}x${AUTO_SPAWN_RETRY_MS}ms spawnNoMoveWarn=${SPAWN_NO_MOVE_WARN_MS}ms debugPackets=${DEBUG_PACKETS ? "on" : "off"} sendLog=${LOG_SEND_PACKETS ? "on" : "off"} moveLogEvery=${MOVE_LOG_EVERY} spawnIndex=${SPAWN_INDEX || "actor"} spawnYOffset=${SPAWN_Y_OFFSET || 0} joinLoadoutSlots=${JOIN_LOADOUT_SLOT_LIMIT} legacyWeaponFields=${INCLUDE_WEAPON_LEGACY_FIELDS ? "on" : "off"} joinWears=${INCLUDE_JOIN_WEARS ? "on" : "off"} actorEchoFields=${INCLUDE_JOIN_ACTOR_ECHO_FIELDS ? "on" : "off"} gameStateActor=${INCLUDE_ACTOR_IN_GAMESTATE ? "on" : "off"} gameStatePeers=${INCLUDE_PEERS_IN_GAMESTATE ? "on" : "off"} gameStateRepeat=${GAMESTATE_REPEAT_MIN_MS}ms maxUdp=${MAX_UDP_PACKET_BYTES} gameStateScore=spawned joinSelfDelay=${JOIN_SELF_EVENT_DELAY_MS}ms joinSelfProfileWait=${JOIN_SELF_PROFILE_WAIT_MS}ms joinProfileRetry=${JOIN_PROFILE_RETRY_MS}ms joinProfileMax=${JOIN_PROFILE_MAX_WAIT_MS}ms allowFallbackJoin=${ALLOW_FALLBACK_JOIN_PROFILE ? "on" : "off"} joinStartFallback=${JOIN_START_EVENT_FALLBACK_DELAY_MS}ms joinSettingsPush=${formatDelayList(JOIN_SETTINGS_PUSH_DELAYS_MS)} joinLateStart=${formatDelayList(JOIN_LATE_START_DELAYS_MS)} actorJoinAsyncDelay=${ACTOR_JOIN_ASYNC_DELAY_MS}ms profileJoinWait=${PROFILE_JOIN_WAIT_MS}ms destroyGeometry=${DESTROY_GEOMETRY ? "on" : "off"} rapidityNormalize=${NORMALIZE_WEAPON_RAPIDITY ? "on" : "off"} shotSlack=${SHOT_THROTTLE_SLACK_MS}ms mapPickups=${ENABLE_MAP_PICKUPS ? "on" : "off"} pickupRadius=${ITEM_PICKUP_RADIUS} itemRespawn=${ITEM_RESPAWN_MS}ms requirePickupBenefit=${REQUIRE_PICKUP_BENEFIT ? "on" : "off"} bikerHpFloor=${BIKER_SET_HEALTH_FLOOR} bikerSpeedFloor=${BIKER_SET_SPEED_FLOOR} bikerWeaponSpeedBonus=${BIKER_SET_WEAPON_SPEED_BONUS} shotgunJumpSmall=${SHOTGUN_RECOIL_SMALL_JUMP_BONUS} shotgunJumpBonus=${SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpAbove=${SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS} bigShotgunJumpBonus=${BIG_SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpHuge=${SHOTGUN_RECOIL_HUGE_JUMP_BONUS} bikerShotgunJumpBonus=${BIKER_SET_SHOTGUN_JUMP_BONUS} maxJump=${MAX_PLAYER_JUMP} lobbyRoomSplit=on reliableDedupe=on roomSync=on`);

for (const port of PORTS) {
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    handleUdp(port, udp, msg, rinfo).catch((error) => {
      console.log(`[udp:${port}] handler failed ${error.stack || error.message}`);
    });
  });
  udp.bind(port, "0.0.0.0", () => console.log(`[udp] ${port} listening`));

  const tcp = net.createServer((socket) => {
    console.log(`[tcp:${port}] client ${socket.remoteAddress}:${socket.remotePort}`);
    socket.on("data", (data) => {
      console.log(`[tcp:${port}] ${data.length} bytes`);
    });
  });
  tcp.listen(port, "0.0.0.0", () => console.log(`[tcp] ${port} listening`));
}
