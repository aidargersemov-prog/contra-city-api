const dgram = require("dgram");
const net = require("net");
const { TextDecoder } = require("util");

const PORTS = (process.env.BATTLE_PORTS || "5055,5056,5057,5058,5255")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Boolean);
const API_BASE_URL = (process.env.API_BASE_URL || "https://contra-city-api-production.up.railway.app").replace(/\/+$/, "");
const API_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "54.145.212.225";
const SERVER_NAME = process.env.SERVER_NAME || "Contra City";
const BUILD_ID = "battle-server-2026-06-28-round-summary-stats-v233";
const GAME_MASTER_PORT = Number(process.env.GAME_MASTER_PORT || 5058);
const SOCIAL_MASTER_PORTS = new Set(
  String(process.env.SOCIAL_MASTER_PORTS || process.env.SOCIAL_MASTER_PORT || "5057")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Boolean)
);
const FORCE_TEAM_MODE = process.env.FORCE_TEAM_MODE === "1";
const AUTO_SPAWN_AFTER_GAMESTATE = process.env.AUTO_SPAWN_AFTER_GAMESTATE === "1";
const ZOMBIE_MIN_PLAYERS = 2;
const ZOMBIE_BOSS_INFECTION_MS = 10000;
const ZOMBIE_ROUND_RESTART_MS = 10500;
// The active client keeps its result screen for this interval before Event91.
// It is intentionally shared with zombie rounds so all modes have one round cadence.
const STANDARD_ROUND_RESTART_MS = Math.max(1000, Number(process.env.STANDARD_ROUND_RESTART_MS || ZOMBIE_ROUND_RESTART_MS));
const ZOMBIE_REGULAR_INFECTION_HITS = Math.max(2, Math.min(3, Number(process.env.ZOMBIE_REGULAR_INFECTION_HITS || 3) || 3));
const ZOMBIE_REGULAR_MAX_HEALTH = Math.max(1, Number(process.env.ZOMBIE_REGULAR_MAX_HEALTH || 1000) || 1000);
const ZOMBIE_BOSS_MAX_HEALTH = Math.max(1, Number(process.env.ZOMBIE_BOSS_MAX_HEALTH || 3000) || 3000);
const ZOMBIE_REGEN_TICK_MS = Math.max(250, Number(process.env.ZOMBIE_REGEN_TICK_MS || 3000) || 3000);
const ZOMBIE_REGULAR_REGEN_MIN = Math.max(0, Number(process.env.ZOMBIE_REGULAR_REGEN_MIN || 20) || 20);
const ZOMBIE_REGULAR_REGEN_MAX = Math.max(ZOMBIE_REGULAR_REGEN_MIN, Number(process.env.ZOMBIE_REGULAR_REGEN_MAX || 35) || 35);
const ZOMBIE_BOSS_REGEN_MIN = Math.max(0, Number(process.env.ZOMBIE_BOSS_REGEN_MIN || 50) || 50);
const ZOMBIE_BOSS_REGEN_MAX = Math.max(ZOMBIE_BOSS_REGEN_MIN, Number(process.env.ZOMBIE_BOSS_REGEN_MAX || 60) || 60);
const ZOMBIE_UPDATE_REPAIR_DELAYS_MS = parseDelayList(process.env.ZOMBIE_UPDATE_REPAIR_DELAYS_MS || "350,1200,2500");
const AUTO_SPAWN_RETRY_LIMIT = Number(process.env.AUTO_SPAWN_RETRY_LIMIT || 8);
const AUTO_SPAWN_RETRY_MS = Number(process.env.AUTO_SPAWN_RETRY_MS || 250);
const SPAWN_NO_MOVE_WARN_MS = Math.max(0, Number(process.env.SPAWN_NO_MOVE_WARN_MS || 2500));
const SPAWN_SELF_RETRY_DELAYS_MS = parseDelayList(process.env.SPAWN_SELF_RETRY_DELAYS_MS || "650,1400");
const SPECTATOR_LIVE_UNRELIABLE = process.env.SPECTATOR_LIVE_UNRELIABLE !== "0";
const SPECTATOR_MOVE_UNRELIABLE = process.env.SPECTATOR_MOVE_UNRELIABLE !== "0";
const SPECTATOR_LIVE_CHANNEL = normalizeChannelId(process.env.SPECTATOR_LIVE_CHANNEL ?? 1, 1);
const MOVE_BROADCAST_UNRELIABLE = process.env.MOVE_BROADCAST_UNRELIABLE !== "0";
const DEBUG_PACKETS = process.env.DEBUG_PACKETS === "1";
const DEBUG_MOVE_PACKETS = process.env.DEBUG_MOVE_PACKETS === "1";
const LOG_SEND_PACKETS = DEBUG_PACKETS || process.env.LOG_SEND_PACKETS === "1";
const ENABLE_BATTLE_EXP = process.env.ENABLE_BATTLE_EXP !== "0";
const BATTLE_EXP_PER_KILL = Math.max(0, Number(process.env.BATTLE_EXP_PER_KILL || 25));
const DOMINATION_STREAK_KILLS = Math.max(0, Number(process.env.DOMINATION_STREAK_KILLS || 4));
const ACTOR_JOIN_ASYNC_DELAY_MS = Math.max(0, Number(process.env.ACTOR_JOIN_ASYNC_DELAY_MS || 1500));
const PEER_ACTOR_REPAIR_DELAYS_MS = parseDelayList(process.env.PEER_ACTOR_REPAIR_DELAYS_MS || "1200");
const MOVE_LOG_EVERY = Math.max(1, Number(process.env.MOVE_LOG_EVERY || 100));
const SPAWN_INDEX = Number(process.env.SPAWN_INDEX || 0);
const SPAWN_Y_OFFSET = Number(process.env.SPAWN_Y_OFFSET || 0);
const DEFAULT_TEAM = Number(process.env.DEFAULT_TEAM || 1);
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || "restore-room";
const DEFAULT_MAP = process.env.DEFAULT_MAP || "Arena_3lvl";
const ROOM_SESSION_IDLE_MS = Math.max(0, Number(process.env.ROOM_SESSION_IDLE_MS || 90000));
const ROOM_SESSION_PRUNE_INTERVAL_MS = Math.max(1000, Number(process.env.ROOM_SESSION_PRUNE_INTERVAL_MS || 5000));
const INIT_REPLY = ["callback", "legacy", "both"].includes((process.env.INIT_REPLY || "").toLowerCase())
  ? process.env.INIT_REPLY.toLowerCase()
  : "callback";
const PUSH_ROOM_LIST_AFTER_INIT = process.env.PUSH_ROOM_LIST_AFTER_INIT === "1";
const REPLAY_PEER_SPAWNS_AFTER_SELF = process.env.REPLAY_PEER_SPAWNS_AFTER_SELF !== "0";
const CONFIRM_PEER_SPAWN_AFTER_ISENEMY = process.env.CONFIRM_PEER_SPAWN_AFTER_ISENEMY !== "0";
const PROFILE_CACHE_TTL_MS = Number(process.env.PROFILE_CACHE_TTL_MS || 30000);
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS || 300000);
const PROFILE_JOIN_WAIT_MS = Math.max(0, Number(process.env.PROFILE_JOIN_WAIT_MS || 2500));
const JOIN_LOADOUT_SLOT_LIMIT = Math.max(1, Math.min(7, Number(process.env.JOIN_LOADOUT_SLOT_LIMIT || 7)));
const FULL_LOADOUT_SLOT_LIMIT = 7;
const INCLUDE_WEAPON_LEGACY_FIELDS = process.env.INCLUDE_WEAPON_LEGACY_FIELDS === "1";
const INCLUDE_JOIN_WEARS = process.env.INCLUDE_JOIN_WEARS !== "0";
const INCLUDE_BATTLE_ENHANCERS = process.env.INCLUDE_BATTLE_ENHANCERS !== "0";
const INCLUDE_JOIN_ACTOR_ECHO_FIELDS = process.env.INCLUDE_JOIN_ACTOR_ECHO_FIELDS === "1";
const INCLUDE_ACTOR_IN_GAMESTATE = process.env.INCLUDE_ACTOR_IN_GAMESTATE === "1";
const INCLUDE_PEERS_IN_GAMESTATE = process.env.INCLUDE_PEERS_IN_GAMESTATE === "1";
const GAMESTATE_REPEAT_MIN_MS = Math.max(0, Number(process.env.GAMESTATE_REPEAT_MIN_MS || 750));
const MAX_UDP_PACKET_BYTES = Math.max(0, Number(process.env.MAX_UDP_PACKET_BYTES || 1200));
const OUTBOUND_RELIABLE_INITIAL_RTO_MS = Math.max(50, Number(process.env.OUTBOUND_RELIABLE_INITIAL_RTO_MS || 300));
const OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE = Math.max(1, Number(process.env.OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE || 5));
const OUTBOUND_RELIABLE_DISCONNECT_MS = Math.max(1000, Number(process.env.OUTBOUND_RELIABLE_DISCONNECT_MS || 10000));
const OUTBOUND_RELIABLE_SWEEP_MS = Math.max(25, Number(process.env.OUTBOUND_RELIABLE_SWEEP_MS || 50));
const ENET_NAT_REBIND_MAX_IDLE_MS = Math.max(1000, Number(process.env.ENET_NAT_REBIND_MAX_IDLE_MS || 15000));
const ENET_FRAGMENT_TRACE = process.env.ENET_FRAGMENT_TRACE !== "0";
const ENET_MAX_FRAGMENT_COUNT = Math.max(1, Number(process.env.ENET_MAX_FRAGMENT_COUNT || 128));
const ENET_MAX_FRAGMENT_TOTAL_BYTES = Math.max(4096, Number(process.env.ENET_MAX_FRAGMENT_TOTAL_BYTES || 65536));
const SHOT_LOCAL_RESPONSE_TRACE = process.env.SHOT_LOCAL_RESPONSE_TRACE !== "0";
const ACTOR_JOIN_MAX_PACKET_BYTES = Math.max(0, Number(process.env.ACTOR_JOIN_MAX_PACKET_BYTES || 1160));
const JOIN_SELF_EVENT_DELAY_MS = Math.max(0, Number(process.env.JOIN_SELF_EVENT_DELAY_MS || 0));
const JOIN_SELF_PROFILE_WAIT_MS = Math.max(JOIN_SELF_EVENT_DELAY_MS, Number(process.env.JOIN_SELF_PROFILE_WAIT_MS || 2500));
const JOIN_PROFILE_RETRY_MS = Math.max(250, Number(process.env.JOIN_PROFILE_RETRY_MS || 1000));
const JOIN_PROFILE_MAX_WAIT_MS = Math.max(JOIN_SELF_PROFILE_WAIT_MS, Number(process.env.JOIN_PROFILE_MAX_WAIT_MS || 70000));
const ALLOW_FALLBACK_JOIN_PROFILE = process.env.ALLOW_FALLBACK_JOIN_PROFILE === "1";
const JOIN_SETTINGS_PUSH_DELAYS_MS = parseDelayList(process.env.JOIN_SETTINGS_PUSH_DELAYS_MS || "");
const JOIN_START_EVENT_FALLBACK_DELAY_MS = Math.max(0, Number(process.env.JOIN_START_EVENT_FALLBACK_DELAY_MS || 0));
const JOIN_LATE_START_DELAYS_MS = parseDelayList(process.env.JOIN_LATE_START_DELAYS_MS || "");
const DESTROY_GEOMETRY = process.env.DESTROY_GEOMETRY === "1";
const NORMALIZE_WEAPON_RAPIDITY = process.env.NORMALIZE_WEAPON_RAPIDITY === "1";
const SHOT_THROTTLE_SLACK_MS = Math.max(0, Number(process.env.SHOT_THROTTLE_SLACK_MS || 20));
const ENABLE_MAP_PICKUPS = process.env.ENABLE_MAP_PICKUPS !== "0";
const MAP_PICKUPS_IN_GAMESTATE = process.env.MAP_PICKUPS_IN_GAMESTATE === "1";
const ITEM_RESPAWN_MS = Math.max(0, Number(process.env.ITEM_RESPAWN_MS || 15000));
const ITEM_PICKUP_RADIUS = Math.max(1, Number(process.env.ITEM_PICKUP_RADIUS || 8));
const PICKUP_SPAWN_REPAIR_DELAYS_MS = parseDelayList(process.env.PICKUP_SPAWN_REPAIR_DELAYS_MS || "");
const REQUIRE_PICKUP_BENEFIT = true;
const ENABLE_BATTLE_DAMAGE = process.env.ENABLE_BATTLE_DAMAGE !== "0";
const DAMAGE_SHORT_RANGE = Math.max(1, Number(process.env.DAMAGE_SHORT_RANGE || 30));
const DAMAGE_MEDIUM_RANGE = Math.max(DAMAGE_SHORT_RANGE, Number(process.env.DAMAGE_MEDIUM_RANGE || 85));
const DAMAGE_HEAD_MULTIPLIER = Math.max(0, Number(process.env.DAMAGE_HEAD_MULTIPLIER || 1.35));
const DAMAGE_ENGINE_MULTIPLIER = Math.max(0, Number(process.env.DAMAGE_ENGINE_MULTIPLIER || 1.1));
const DAMAGE_CRIT_MULTIPLIER = Math.max(1, Number(process.env.DAMAGE_CRIT_MULTIPLIER || 1.25));
const DAMAGE_MAX_CRIT_CHANCE = Math.max(0, Math.min(100, Number(process.env.DAMAGE_MAX_CRIT_CHANCE || 35)));
const DAMAGE_SORT_RANGES_BY_POWER = process.env.DAMAGE_SORT_RANGES_BY_POWER !== "0";
const DAMAGE_EXPLOSION_FULL_RADIUS = Math.max(0, Number(process.env.DAMAGE_EXPLOSION_FULL_RADIUS || 6.5));
const DAMAGE_EXPLOSION_ZERO_RADIUS = Math.max(DAMAGE_EXPLOSION_FULL_RADIUS + 0.1, Number(process.env.DAMAGE_EXPLOSION_ZERO_RADIUS || 20));
const DAMAGE_MAX_PROTECTION_PERCENT = Math.max(0, Math.min(100, Number(process.env.DAMAGE_MAX_PROTECTION_PERCENT || 95)));
const DAMAGE_MAX_HEAD_BONUS_PERCENT = Math.max(0, Number(process.env.DAMAGE_MAX_HEAD_BONUS_PERCENT || 50));
const DAMAGE_MELEE_MAX_DISTANCE = Math.max(1, Number(process.env.DAMAGE_MELEE_MAX_DISTANCE || 12));
const IMPACT_DOT_TICK_MS = Math.max(250, Number(process.env.IMPACT_DOT_TICK_MS || 1000));
const IMPACT_DOT_DEFAULT_TICKS = Math.max(1, Number(process.env.IMPACT_DOT_DEFAULT_TICKS || 5));
const IMPACT_REFERENCE_DAMAGE_REDUCTION = Math.max(0, Math.min(95, Number(process.env.IMPACT_REFERENCE_DAMAGE_REDUCTION || 10)));
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
const MAX_PLAYER_ENERGY = Math.max(0, Number(process.env.MAX_PLAYER_ENERGY || 100));
const MAX_PLAYER_JUMP = Math.max(1, Number(process.env.MAX_PLAYER_JUMP || 32));
// Original client default is SMOOTH_LINEAR_IN_EX=3; it consumes live Move99 key4/key5 as pitch/yaw.
const ROOM_INTERPOLATION_MODE_RAW = Number(process.env.ROOM_INTERPOLATION_MODE ?? 3);
const ROOM_INTERPOLATION_MODE = Math.max(0, Math.min(255, Number.isFinite(ROOM_INTERPOLATION_MODE_RAW) ? ROOM_INTERPOLATION_MODE_RAW : 0));
const ADD_MOVE_ROTATION_KEY = process.env.ADD_MOVE_ROTATION_KEY !== "0";
const MAX_UDP_DATAGRAM_BYTES = Math.max(512, Number(process.env.MAX_UDP_DATAGRAM_BYTES || 4096));
const MAX_ENET_COMMANDS_PER_PACKET = Math.max(1, Number(process.env.MAX_ENET_COMMANDS_PER_PACKET || 64));
// Compatibility-first defaults: one public/NAT address may represent many real players,
// and every client maintains several Photon endpoints at the same time.
const MAX_SESSIONS_TOTAL = Math.max(50000, Number(process.env.MAX_SESSIONS_TOTAL || 50000));
const MAX_SESSIONS_PER_IP = Math.max(512, Number(process.env.MAX_SESSIONS_PER_IP || 512));
const UDP_RATE_WINDOW_MS = Math.max(1000, Number(process.env.UDP_RATE_WINDOW_MS || 10000));
const UDP_RATE_PACKETS_PER_IP = Math.max(100000, Number(process.env.UDP_RATE_PACKETS_PER_IP || 100000));
const UDP_RATE_BYTES_PER_IP = Math.max(512 * 1024 * 1024, Number(process.env.UDP_RATE_BYTES_PER_IP || 512 * 1024 * 1024));
const TCP_MAX_CONNECTIONS_PER_IP = Math.max(128, Number(process.env.TCP_MAX_CONNECTIONS_PER_IP || 128));
const TCP_IDLE_TIMEOUT_MS = Math.max(120000, Number(process.env.TCP_IDLE_TIMEOUT_MS || 120000));
const TCP_MAX_BYTES_PER_CONNECTION = Math.max(64 * 1024 * 1024, Number(process.env.TCP_MAX_BYTES_PER_CONNECTION || 64 * 1024 * 1024));

const sessions = new Map();
const rooms = new Map();
const masterSessionsByPlayerId = new Map();
const profileCache = new Map();
const profileLoads = new Map();
const udpRateByIp = new Map();
const tcpConnectionsByIp = new Map();

function allowUdpPacket(rinfo, byteLength) {
  const address = String(rinfo?.address || "unknown");
  const now = Date.now();
  let bucket = udpRateByIp.get(address);
  if (!bucket || now - bucket.startedAt >= UDP_RATE_WINDOW_MS) {
    bucket = { startedAt: now, packets: 0, bytes: 0, dropped: 0 };
    udpRateByIp.set(address, bucket);
  }
  bucket.packets++;
  bucket.bytes += Math.max(0, Number(byteLength || 0));
  const allowed = bucket.packets <= UDP_RATE_PACKETS_PER_IP && bucket.bytes <= UDP_RATE_BYTES_PER_IP;
  if (!allowed) bucket.dropped++;
  if (udpRateByIp.size > 10000) {
    for (const [ip, value] of udpRateByIp) {
      if (now - value.startedAt > UDP_RATE_WINDOW_MS * 2) udpRateByIp.delete(ip);
    }
  }
  return allowed;
}

function sessionCountForIp(address) {
  let count = 0;
  for (const session of sessions.values()) {
    if (session?.rinfo?.address === address || String(session?.remoteKey || "").startsWith(`${address}:`)) count++;
  }
  return count;
}
let shopCatalogCache = { loadedAt: 0, weapons: [], wears: [] };
const PROCESS_START_MS = Date.now();
let lastRoomSessionPruneAt = 0;
function parseDelayList(value) {
  return String(value || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((delayMs) => Number.isFinite(delayMs) && delayMs > 0);
}

function formatDelayList(delays) {
  return delays.length ? `${delays.join(",")}ms` : "off";
}

function normalizeChannelId(value, fallback = 0) {
  const channel = Number(value);
  if (Number.isInteger(channel) && channel >= 0 && channel <= 255) return channel;
  return fallback;
}

const ITEM_TYPES = {
  HEALTH: 101,
  ARMOR: 100,
  AMMO: 99,
};
const ARMOR_PICKUP_CAP = 100;
const SMALL_PICKUP_PERCENT = 50;
const FULL_PICKUP_PERCENT = 100;

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
    // Extracted from mapsnew/Arena_3lvl_unity3d/Assets/Arena_3lvl.unity.
    { id: 31001, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 118.98, y: -62.738, z: 305.555, rotY: 0 },
    { id: 31002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -63.127, y: -62.913, z: 271.435, rotY: 0 },
    { id: 31003, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 47.443, y: 7.054, z: 329.094, rotY: 0 },
    { id: 31004, type: ITEM_TYPES.ARMOR, subType: 2, value: 0, x: 28.608, y: -17.373, z: 243.007, rotY: 0 },
    { id: 31005, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: -62.958, y: -62.866, z: 295.271, rotY: 0 },
    { id: 31006, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 118.812, y: -63.121, z: 282.525, rotY: 0 },
    { id: 31007, type: ITEM_TYPES.HEALTH, subType: 1, value: 0, x: 45.275, y: 7.14, z: 249.416, rotY: 0 },
  ],
  zombi: [
    // Zombi.unity is binary; local pickup points are under POINTS_RESCALE offset -62.951/119.348/-15.745.
    { id: 32001, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 66.648, y: 5.781, z: 266.642, rotY: 270 },
    { id: 32002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 147.027, y: -16.897, z: 187.417, rotY: 270 },
    { id: 32003, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -28.712, y: -16.897, z: 287.682, rotY: 270 },
    { id: 32004, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 60.257, y: -16.897, z: 266.146, rotY: 270 },
    { id: 32005, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 66.648, y: -16.897, z: 135.84, rotY: 270 },
    { id: 32006, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 68.092, y: -16.897, z: 411.423, rotY: 270 },
    { id: 32007, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 115.696, y: -17.238, z: 264.746, rotY: 90 },
  ],
  zombi_2: [
    // Extracted from mapsnew/Zombi_2_unity3d/Assets/Zombi_2.unity.
    { id: 33001, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 33.446, y: -15.755, z: 202.595, rotY: 0 },
    { id: 33002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -63.127, y: -62.913, z: 285.293, rotY: 180 },
    { id: 33003, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 47.443, y: -15.804, z: 329.094, rotY: 0 },
    { id: 33004, type: ITEM_TYPES.ARMOR, subType: 2, value: 0, x: 1.823, y: -14.834, z: 343.083, rotY: 0 },
    { id: 33005, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: -62.958, y: -62.866, z: 295.271, rotY: 180 },
    { id: 33006, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 23.053, y: -16.17, z: 202.715, rotY: 0 },
    { id: 33007, type: ITEM_TYPES.HEALTH, subType: 1, value: 0, x: 88.024, y: -64.147, z: 216.508, rotY: 0 },
    { id: 33008, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 65.427, y: -14.893, z: 253.181, rotY: 90 },
    { id: 33009, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 55.449, y: -14.846, z: 253.35, rotY: 90 },
    { id: 33010, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 53.452, y: -15.804, z: 245.798, rotY: 0 },
  ],
  arenaring: [
    // Extracted from mapsnew/ArenaRing_unity3d/Assets/ArenaRing.unity.
    { id: 34001, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 28.645, y: -62.718, z: 296.427, rotY: 0 },
    { id: 34002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -123.594, y: -44.142, z: 289.183, rotY: 0 },
    { id: 34003, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 171.784, y: -43.864, z: 303.327, rotY: 180 },
    { id: 34004, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 31.43, y: 2.999, z: 302.329, rotY: 0 },
    { id: 34005, type: ITEM_TYPES.ARMOR, subType: 2, value: 0, x: 28.786, y: -62.142, z: 300.642, rotY: 0 },
    { id: 34006, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: -123.522, y: -43.838, z: 296.811, rotY: 180 },
    { id: 34007, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 171.712, y: -43.86, z: 295.462, rotY: 0 },
    { id: 34008, type: ITEM_TYPES.HEALTH, subType: 1, value: 0, x: 31.603, y: 2.766, z: 289.057, rotY: 0 },
  ],
  bit_map: [
    // World positions from mapsnew/Bit_map_unity3d/Assets/Bit_map.unity.bak-large-fileids.
    { id: 35001, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 190.864, y: -14.332, z: 309.846, rotY: 0 },
    { id: 35002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -89.571, y: -14.26, z: 308.956, rotY: 180 },
    { id: 35003, type: ITEM_TYPES.ARMOR, subType: 1, value: 0, x: 55.921, y: 0.834, z: 222.08, rotY: 90 },
    { id: 35004, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: -98.531, y: -14.472, z: 308.47, rotY: 180 },
    { id: 35005, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 199.764, y: -14.76, z: 309.077, rotY: 0 },
    { id: 35006, type: ITEM_TYPES.ARMOR, subType: 2, value: 0, x: 45.025, y: -0.265, z: 330.98, rotY: 0 },
    { id: 35007, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 62.553, y: 0.035, z: 222.734, rotY: 90 },
    { id: 35008, type: ITEM_TYPES.HEALTH, subType: 1, value: 0, x: 48.951, y: 0.175, z: 221.892, rotY: 90 },
  ],
  legoturnament: [
    // World positions from mapsnew/LegoTurnament_unity3d/Assets/LegoTurnament.unity.bak-large-fileids.
    { id: 36001, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 6.126, y: 36.396, z: 159.793, rotY: 90 },
    { id: 36002, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 2.755, y: 22.209, z: 161.192, rotY: 270 },
  ],
  inferno: [
    // World positions from mapsnew/Inferno_unity3d/Assets/Inferno.unity.bak-large-fileids.
    { id: 37001, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: 303.875, y: -52.652, z: 215.451, rotY: 270 },
    { id: 37002, type: ITEM_TYPES.HEALTH, subType: 2, value: 0, x: -92.621, y: -38.102, z: 44.399, rotY: 90 },
    { id: 37003, type: ITEM_TYPES.ARMOR, subType: 2, value: 0, x: -124.063, y: -18.953, z: 302.018, rotY: 0 },
    { id: 37004, type: ITEM_TYPES.HEALTH, subType: 1, value: 0, x: 149.435, y: -37.244, z: 141.801, rotY: 180 },
    { id: 37005, type: ITEM_TYPES.ARMOR, subType: 1, value: 0, x: 149.623, y: -36.25, z: 134.831, rotY: 180 },
    { id: 37006, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: 303.106, y: -52.318, z: 206.551, rotY: 270 },
    { id: 37007, type: ITEM_TYPES.AMMO, subType: 2, value: 0, x: -93.107, y: -37.914, z: 53.359, rotY: 90 },
    { id: 37008, type: ITEM_TYPES.AMMO, subType: 1, value: 0, x: 150.277, y: -36.871, z: 128.199, rotY: 180 },
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
    // The active export only has a recovered playable Respawn_T0 layer.
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
  zombi: {
    // Extracted from mapsnew/Zombi_unity3d/MapData/Zombi.points.json.
    // Raw Respawn_T0 markers sit at y ~= -24 and were live-rejected as under-texture spawns.
    // Use the exported playable layer until a better original infection split is recovered.
    dm: [
      { x: 80.077, y: 10.966, z: 193.052, rotY: 60 },
      { x: 65.359, y: -18.278, z: 131.071, rotY: 180 },
      { x: 49.396, y: -18.36, z: 122.169, rotY: 270 },
      { x: 78.51, y: -18.322, z: 130.862, rotY: 180 },
      { x: 102.706, y: -18.439, z: 121.382, rotY: 0 },
      { x: 112.801, y: -18.501, z: 121.92, rotY: 0 },
      { x: 64.701, y: -17.621, z: 104.472, rotY: 0 },
      { x: 50.443, y: -18.509, z: 104.635, rotY: 0 },
      { x: 62.765, y: -18.43, z: 417.897, rotY: 180 },
      { x: -35.083, y: -18.451, z: 314.706, rotY: 90 },
      { x: 169.289, y: -18.284, z: 186.146, rotY: 270 },
      { x: 82.401, y: -18.284, z: 119.729, rotY: 270 },
      { x: -49.385, y: 17.041, z: 265.592, rotY: 90 },
      { x: 37.764, y: 3.852, z: 261.716, rotY: 90 },
      { x: 182.13, y: -18.398, z: 244.876, rotY: 270 },
      { x: 107.399, y: -18.43, z: 124.384, rotY: 0 },
      { x: 88.996, y: 10.842, z: 340.641, rotY: 180 },
      { x: 3.285, y: -18.284, z: 225.055, rotY: 45 },
    ],
  },
  arenaring: {
    // Extracted from mapsnew/ArenaRing_unity3d/MapData/ArenaRing.points.json.
    // ArenaRing is exposed as Team Deathmatch-only, so Respawn_T1/T2 are the active teams.
    dm: [
      { x: -117.322, y: -45.841, z: 300.186, rotY: 90 },
      { x: -117.301, y: -45.841, z: 292.934, rotY: 90 },
      { x: -109.441, y: -45.841, z: 303.228, rotY: 90 },
      { x: -109.436, y: -45.841, z: 296.624, rotY: 90 },
      { x: -109.441, y: -45.841, z: 285.776, rotY: 90 },
      { x: -117.608, y: -45.841, z: 286.514, rotY: 90 },
      { x: -117.125, y: -45.841, z: 306.935, rotY: 90 },
      { x: 165.452, y: -45.698, z: 286.104, rotY: 270 },
      { x: 165.452, y: -45.698, z: 291.698, rotY: 270 },
      { x: 165.452, y: -45.698, z: 297.183, rotY: 270 },
      { x: 165.452, y: -45.698, z: 309.869, rotY: 270 },
      { x: 158.131, y: -45.698, z: 308.932, rotY: 270 },
      { x: 165.452, y: -45.698, z: 303.747, rotY: 270 },
      { x: 158.131, y: -45.698, z: 286.673, rotY: 270 },
      { x: 158.131, y: -45.698, z: 298.105, rotY: 270 },
    ],
    team1: [
      { x: -117.322, y: -45.841, z: 300.186, rotY: 90 },
      { x: -117.301, y: -45.841, z: 292.934, rotY: 90 },
      { x: -109.441, y: -45.841, z: 303.228, rotY: 90 },
      { x: -109.436, y: -45.841, z: 296.624, rotY: 90 },
      { x: -109.441, y: -45.841, z: 285.776, rotY: 90 },
      { x: -117.608, y: -45.841, z: 286.514, rotY: 90 },
      { x: -117.125, y: -45.841, z: 306.935, rotY: 90 },
    ],
    team2: [
      { x: 165.452, y: -45.698, z: 286.104, rotY: 270 },
      { x: 165.452, y: -45.698, z: 291.698, rotY: 270 },
      { x: 165.452, y: -45.698, z: 297.183, rotY: 270 },
      { x: 165.452, y: -45.698, z: 309.869, rotY: 270 },
      { x: 158.131, y: -45.698, z: 308.932, rotY: 270 },
      { x: 165.452, y: -45.698, z: 303.747, rotY: 270 },
      { x: 158.131, y: -45.698, z: 286.673, rotY: 270 },
      { x: 158.131, y: -45.698, z: 298.105, rotY: 270 },
    ],
  },
  bit_map: {
    // World positions from mapsnew/Bit_map_unity3d/Assets/Bit_map.unity.bak-large-fileids -> POINTS_RESCALE -> Respawn_T0/T1/T2.
    dm: [
      { x: 178.244, y: -15.663, z: 335.71, rotY: 0 },
      { x: 99.715, y: -15.689, z: 303.016, rotY: 270 },
      { x: 2.74, y: -15.798, z: 292.658, rotY: 90 },
      { x: 243.241, y: -15.742, z: 362.263, rotY: 270 },
      { x: -74.119, y: -15.764, z: 334.666, rotY: 0 },
      { x: 67.259, y: -14.925, z: 343.686, rotY: 180 },
    ],
    team1: [
      { x: -130.996, y: -15.663, z: 353.131, rotY: 90 },
      { x: -132.44, y: -15.663, z: 276.096, rotY: 90 },
      { x: -139.332, y: -15.663, z: 360.048, rotY: 90 },
      { x: -125.957, y: -15.663, z: 261.735, rotY: 0 },
      { x: -132.44, y: -15.663, z: 289.272, rotY: 90 },
      { x: -139.408, y: -15.498, z: 329.31, rotY: 90 },
      { x: -138.4, y: -15.663, z: 303.144, rotY: 90 },
    ],
    team2: [
      { x: 230.451, y: -15.663, z: 261.518, rotY: 0 },
      { x: 235.946, y: -15.663, z: 299.687, rotY: 270 },
      { x: 242.88, y: -15.663, z: 313.017, rotY: 270 },
      { x: 242.874, y: -15.663, z: 328.896, rotY: 270 },
      { x: 236.406, y: -15.663, z: 274.035, rotY: 270 },
      { x: 242.891, y: -15.663, z: 348.459, rotY: 270 },
      { x: 235.394, y: -15.663, z: 287.297, rotY: 270 },
      { x: 242.281, y: -15.663, z: 361.541, rotY: 270 },
    ],
  },
  legoturnament: {
    // World positions from mapsnew/LegoTurnament_unity3d/Assets/LegoTurnament.unity.bak-large-fileids -> POINTS_RESCALE.
    dm: [
      { x: 98.817, y: 14.554, z: 116.706, rotY: 330 },
      { x: -74.851, y: 14.933, z: 117.843, rotY: 45 },
      { x: 97.485, y: 14.196, z: 297.849, rotY: 225 },
      { x: -85.626, y: 14.933, z: 297.573, rotY: 135 },
      { x: 6.239, y: 14.933, z: 208.724, rotY: 180 },
    ],
    team1: [
      { x: 21.008, y: 20.784, z: 25.909, rotY: 180 },
      { x: 7.199, y: 21.485, z: -0.482, rotY: 0 },
      { x: 7.857, y: 20.828, z: 26.118, rotY: 180 },
      { x: -7.059, y: 20.597, z: -0.318, rotY: 0 },
      { x: 16.649, y: 20.668, z: 0.282, rotY: 0 },
      { x: 26.743, y: 20.606, z: 0.821, rotY: 0 },
      { x: -8.106, y: 20.746, z: 17.215, rotY: 270 },
    ],
    team2: [
      { x: 24.852, y: 20.822, z: 313.538, rotY: 180 },
      { x: -6.359, y: 20.671, z: 312.792, rotY: 180 },
      { x: 21.772, y: 20.694, z: 294.258, rotY: 0 },
      { x: 11.614, y: 20.822, z: 293.706, rotY: 0 },
      { x: 5.765, y: 20.655, z: 312.691, rotY: 180 },
      { x: 0.131, y: 20.822, z: 293.174, rotY: 0 },
      { x: 16.51, y: 20.676, z: 312.944, rotY: 180 },
    ],
  },
  inferno: {
    // World positions from mapsnew/Inferno_unity3d/Assets/Inferno.unity.bak-large-fileids -> POINTS_RESCALE.
    dm: [
      { x: 19.998, y: -20.936, z: 294.54, rotY: 270 },
      { x: 103.554, y: -31.33, z: -35.494, rotY: 270 },
      { x: -113.018, y: -32.175, z: 169.619, rotY: 90 },
      { x: 55.97, y: -36.772, z: 298.581, rotY: 270 },
      { x: 106.512, y: -38.506, z: 210.627, rotY: 180 },
      { x: -6.091, y: -50.703, z: 15.123, rotY: 270 },
      { x: 174.96, y: -28.484, z: 313.652, rotY: 180 },
    ],
    team1: [
      { x: 289.406, y: -54.583, z: 179.367, rotY: 0 },
      { x: 281.244, y: -54.105, z: 179.996, rotY: 45 },
      { x: 300.727, y: -54.583, z: 185.215, rotY: 270 },
      { x: 284.533, y: -54.105, z: 191.203, rotY: 45 },
      { x: 300.39, y: -54.583, z: 186.977, rotY: 330 },
      { x: 313.215, y: -50.928, z: 262.948, rotY: 270 },
      { x: 284.321, y: -53.821, z: 200.322, rotY: 60 },
    ],
    team2: [
      { x: -128.095, y: -31.862, z: 108.363, rotY: 90 },
      { x: -125.603, y: -40.126, z: 25.032, rotY: 45 },
      { x: -122.138, y: -32.121, z: 86.884, rotY: 135 },
      { x: -127.335, y: -40.126, z: 64.064, rotY: 90 },
      { x: -127.134, y: -40.126, z: 36.449, rotY: 90 },
      { x: -127.903, y: -40.126, z: 49.714, rotY: 90 },
      { x: -122.07, y: -40.126, z: 17.735, rotY: 45 },
    ],
  },
};

const MAP_MODE_DEATHMATCH = 1;
const MAP_MODE_TEAM_DEATHMATCH = 2;
const MAP_MODE_CAPTURE_THE_FLAG = 4;
const MAP_MODE_CONTROL_POINTS = 8;
const MAP_MODE_ZOMBIE = 64;
const ZOMBIE_MODE = {
  PAUSE: 1,
  WAIT_FOR_PLAYERS: 2,
  BOSS_INFECTION: 3,
  MAIN: 4,
};
const ZOMBIE_TYPE = {
  HUMAN: 0,
  REGULAR: 1,
  BOSS: 2,
};
const ZOMBIE_TEAM = 1;
const HUMAN_TEAM = 2;
const MAP_ALLOWED_MODES = {
  zombi_2: [MAP_MODE_DEATHMATCH, MAP_MODE_ZOMBIE],
  zombi: [MAP_MODE_DEATHMATCH, MAP_MODE_ZOMBIE],
  arenaring: [MAP_MODE_TEAM_DEATHMATCH, MAP_MODE_CAPTURE_THE_FLAG, MAP_MODE_CONTROL_POINTS],
  legoturnament: [MAP_MODE_TEAM_DEATHMATCH, MAP_MODE_CAPTURE_THE_FLAG],
  arena_3lvl: [MAP_MODE_DEATHMATCH, MAP_MODE_TEAM_DEATHMATCH, MAP_MODE_CAPTURE_THE_FLAG, MAP_MODE_CONTROL_POINTS],
  inferno: [MAP_MODE_DEATHMATCH, MAP_MODE_TEAM_DEATHMATCH, MAP_MODE_CAPTURE_THE_FLAG, MAP_MODE_CONTROL_POINTS],
};
const CTF_MAPS = {
  arena_3lvl: [{team:1,x:-30,y:-65,z:282},{team:2,x:87,y:-65,z:295}],
  arenaring: [{team:1,x:-52.497,y:-65,z:282},{team:2,x:117.454,y:-65,z:295}],
  inferno: [{team:1,x:394.08,y:-66.15,z:157.5},{team:2,x:-10.84,y:-51.73,z:-37.88}],
  legoturnament: [{team:1,x:79.72,y:-65.41,z:65.65},{team:2,x:202.58,y:-71.92,z:70.62}],
};

// Centers are the exported Game/finish4/ControlPointN/ControlPoint transforms.
// Bit_map deliberately has no entry: its active bundle has point prefabs only, not map objects.
const CONTROL_POINT_MAPS = {
  arena_3lvl: [{ id: 1, x: 26.692, y: -64.946, z: 288.789 }],
  arenaring: [{ id: 1, x: 30.08, y: -24.095, z: 297.007 }],
  inferno: [
    { id: 1, x: 56.31, y: -60.76, z: 45.83 },
    { id: 2, x: 238.08, y: -99.91, z: 43.89 },
  ],
};
const CONTROL_POINT_CAPTURE_TICK_MS = Math.max(50, Number(process.env.CONTROL_POINT_CAPTURE_TICK_MS || 100));
const CONTROL_POINT_CAPTURE_STEP = Math.max(1, Math.min(100, Number(process.env.CONTROL_POINT_CAPTURE_STEP || 1)));
const CONTROL_POINT_SCORE_INTERVAL_MS = Math.max(250, Number(process.env.CONTROL_POINT_SCORE_INTERVAL_MS || 1000));

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

function normalizeRoomModeValue(value, fallback = MAP_MODE_DEATHMATCH) {
  const mode = Number(value);
  return Number.isFinite(mode) && mode > 0 ? mode : fallback;
}

function normalizeModeForMap(mapName, requestedMode) {
  const mode = normalizeRoomModeValue(requestedMode);
  if (mode === MAP_MODE_CONTROL_POINTS && !CONTROL_POINT_MAPS[mapKey(mapName)]?.length) {
    return MAP_MODE_DEATHMATCH;
  }
  const allowed = MAP_ALLOWED_MODES[mapKey(mapName)];
  if (!allowed?.length) return mode;
  return allowed.includes(mode) ? mode : allowed[0];
}

function allSpawnPointsForDeathmatch(mapSpawns) {
  return [
    ...(mapSpawns?.dm || []),
    ...(mapSpawns?.team1 || []),
    ...(mapSpawns?.team2 || []),
  ];
}

function pointListFor(session, team) {
  const mapSpawns = MAP_SPAWN_POINTS[mapKey(session.room?.map)];
  if (!mapSpawns) return null;
  if (roomMode(session) === MAP_MODE_DEATHMATCH || roomMode(session) === MAP_MODE_ZOMBIE) {
    const points = allSpawnPointsForDeathmatch(mapSpawns);
    return points.length ? points : null;
  }
  if (team === 1 && mapSpawns.team1?.length) return mapSpawns.team1;
  if (team === 2 && mapSpawns.team2?.length) return mapSpawns.team2;
  return mapSpawns.dm?.length ? mapSpawns.dm : null;
}

function preferredDmSpawnPoints(session, team, points) {
  if (roomMode(session) === MAP_MODE_ZOMBIE) return points;
  if (team !== 0) return points;
  const map = mapKey(session.room?.map);
  if (map === "arena_3lvl") {
    return points.filter((point) => Number(point.y) <= -60);
  }
  if (map === "zombi_2") {
    return points.filter((point) => Number(point.y) >= -30 && Number(point.y) <= -5);
  }
  if (map === "zombi") {
    return points.filter((point) => Number(point.y) >= -19);
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
  const mode = roomMode(session);
  const baseIndex = mode === MAP_MODE_DEATHMATCH || mode === MAP_MODE_ZOMBIE
    ? Math.floor(Math.random() * candidates.length)
    : (Number(session.actorId) || 1) - 1;
  const point = candidates[Math.abs(baseIndex) % candidates.length];
  return {
    ...point,
    y: point.y + (Number.isFinite(SPAWN_Y_OFFSET) ? SPAWN_Y_OFFSET : 0),
  };
}

function fmtPoint(point) {
  return `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)},${Number(point.z).toFixed(2)}@${Number(point.rotY || 0).toFixed(0)}`;
}

function fmtVector(point) {
  return `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)},${Number(point.z).toFixed(2)}`;
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

function refreshSessionReliableEndpoint(session, socket, rinfo) {
  if (!session || !socket || !rinfo) return;
  const pending = session.outboundReliable;
  if (!(pending instanceof Map)) return;
  for (const entry of pending.values()) {
    entry.socket = socket;
    entry.rinfo = { address: rinfo.address, port: rinfo.port };
  }
}

function findNatRebindSession(port, msg, rinfo, now = Date.now()) {
  const incomingPeerId = msg.readUInt16BE(0);
  const incomingChallenge = readU32(msg, 8);
  if (!incomingChallenge || incomingPeerId === 0xffff) return null;

  const matches = [];
  for (const candidate of sessions.values()) {
    if (!candidate || candidate.transportDisconnected) continue;
    if (Number(candidate.port) !== Number(port)) continue;
    if (Number(candidate.peerId) !== Number(incomingPeerId)) continue;
    if (Number(candidate.challenge) !== Number(incomingChallenge)) continue;
    if (!candidate.room || !candidate.actorId || !candidate.spawned) continue;
    if (now - numberOr(candidate.lastSeenAt, 0) > ENET_NAT_REBIND_MAX_IDLE_MS) continue;
    matches.push(candidate);
    if (matches.length > 1) return null;
  }
  return matches[0] || null;
}

function rebindSessionEndpoint(session, sessionId, socket, rinfo) {
  const previousSessionId = session.sessionId;
  const previousRemote = session.remoteKey || "unknown";
  if (previousSessionId && previousSessionId !== sessionId && sessions.get(previousSessionId) === session) {
    sessions.delete(previousSessionId);
  }
  sessions.set(sessionId, session);
  session.sessionId = sessionId;
  session.remoteKey = `${rinfo.address}:${rinfo.port}`;
  session.socket = socket;
  session.rinfo = { address: rinfo.address, port: rinfo.port };
  refreshSessionReliableEndpoint(session, socket, rinfo);
  console.log(`[state] enet nat-rebind actor=${session.actorId || 0} player=${session.playerId || "unknown"} room=${session.room?.name || "none"} from=${previousRemote} to=${session.remoteKey} pending=${session.outboundReliable?.size || 0}`);
  return session;
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

function makeReliableFragment(seq, startSeq, fragmentCount, fragmentNumber, totalLength, fragmentOffset, payload, channel = 0) {
  return Buffer.concat([
    Buffer.from([0x08, channel, 0x01, 0x04]),
    u32(32 + payload.length),
    u32(seq),
    u32(startSeq),
    u32(fragmentCount),
    u32(fragmentNumber),
    u32(totalLength),
    u32(fragmentOffset),
    payload,
  ]);
}

function makeUnreliable(lastReliableSeq, unreliableSeq, payload, channel = 0) {
  return Buffer.concat([
    Buffer.from([0x07, channel, 0x00, 0x04]),
    u32(16 + payload.length),
    u32(Math.max(0, Number(lastReliableSeq) || 0)),
    u32(unreliableSeq),
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

function commandBytes(commands) {
  return (commands || []).reduce((sum, command) => sum + (command?.length || 0), 0);
}

function reliableCommandSeq(command) {
  return command?.length >= 12 ? readU32(command, 8) : null;
}

function reliableCommandSeqSummary(commands) {
  const seqs = (commands || [])
    .map((command) => reliableCommandSeq(command))
    .filter((seq) => seq != null);
  return seqs.length ? seqs.join(",") : "none";
}

function makeReliableCommandsForPayload(session, payload, channel = 0) {
  const targetChannel = normalizeChannelId(channel, 0);
  const packetBytes = 12 + 12 + payload.length;
  if (!MAX_UDP_PACKET_BYTES || packetBytes <= MAX_UDP_PACKET_BYTES) {
    const seq = nextReliableSeqForSession(session, targetChannel);
    return [makeReliable(seq, payload, targetChannel)];
  }

  const maxFragmentPayload = Math.max(1, MAX_UDP_PACKET_BYTES - 12 - 32);
  const fragmentCount = Math.ceil(payload.length / maxFragmentPayload);
  if (fragmentCount > ENET_MAX_FRAGMENT_COUNT || payload.length > ENET_MAX_FRAGMENT_TOTAL_BYTES) {
    const seq = nextReliableSeqForSession(session, targetChannel);
    console.log(`[warn] outgoing-fragment-too-large actor=${session?.actorId || "?"} bytes=${payload.length} fragments=${fragmentCount}/${ENET_MAX_FRAGMENT_COUNT}`);
    return [makeReliable(seq, payload, targetChannel)];
  }

  const commands = [];
  let startSeq = null;
  for (let index = 0; index < fragmentCount; index += 1) {
    const fragmentOffset = index * maxFragmentPayload;
    const fragmentPayload = payload.subarray(fragmentOffset, Math.min(payload.length, fragmentOffset + maxFragmentPayload));
    const seq = nextReliableSeqForSession(session, targetChannel);
    if (startSeq == null) startSeq = seq;
    commands.push(makeReliableFragment(seq, startSeq, fragmentCount, index, payload.length, fragmentOffset, fragmentPayload, targetChannel));
  }
  if (ENET_FRAGMENT_TRACE) {
    console.log(`[fragment] send actor=${session?.actorId || "?"} start=${startSeq} parts=${fragmentCount} bytes=${payload.length} maxPayload=${maxFragmentPayload} channel=${targetChannel}`);
  }
  return commands;
}

function fragmentReliableCommandIfNeeded(session, command) {
  if (!command || command[0] !== 0x06 || !MAX_UDP_PACKET_BYTES) return [command];
  if (12 + command.length <= MAX_UDP_PACKET_BYTES) return [command];

  const targetChannel = normalizeChannelId(command[1], 0);
  const commandLength = readU32(command, 4);
  const totalLength = Math.max(0, Math.min(command.length, commandLength) - 12);
  const payload = command.subarray(12, 12 + totalLength);
  const maxFragmentPayload = Math.max(1, MAX_UDP_PACKET_BYTES - 12 - 32);
  const fragmentCount = Math.ceil(payload.length / maxFragmentPayload);
  if (fragmentCount < 2 || fragmentCount > ENET_MAX_FRAGMENT_COUNT || payload.length > ENET_MAX_FRAGMENT_TOTAL_BYTES) {
    console.log(`[warn] outgoing-command-fragment-too-large actor=${session?.actorId || "?"} bytes=${payload.length} fragments=${fragmentCount}/${ENET_MAX_FRAGMENT_COUNT}`);
    return [command];
  }

  const startSeq = readU32(command, 8);
  const commands = [];
  for (let index = 0; index < fragmentCount; index += 1) {
    const fragmentOffset = index * maxFragmentPayload;
    const fragmentPayload = payload.subarray(fragmentOffset, Math.min(payload.length, fragmentOffset + maxFragmentPayload));
    const seq = index === 0 ? startSeq : nextReliableSeqForSession(session, targetChannel);
    commands.push(makeReliableFragment(seq, startSeq, fragmentCount, index, payload.length, fragmentOffset, fragmentPayload, targetChannel));
  }
  if (ENET_FRAGMENT_TRACE) {
    console.log(`[fragment] send actor=${session?.actorId || "?"} start=${startSeq} parts=${fragmentCount} bytes=${payload.length} maxPayload=${maxFragmentPayload} channel=${targetChannel} source=sendPacket`);
  }
  return commands;
}

function fragmentOutgoingReliableCommands(session, commands) {
  return (commands || []).flatMap((command) => fragmentReliableCommandIfNeeded(session, command));
}

function ensureOutboundReliableMap(session) {
  if (!session) return null;
  if (!(session.outboundReliable instanceof Map)) session.outboundReliable = new Map();
  return session.outboundReliable;
}

function outboundReliableKey(channel, reliableSeq) {
  return `${normalizeChannelId(channel, 0)}:${Number(reliableSeq) >>> 0}`;
}

function outboundReliableCommandInfo(command) {
  if (!command || command.length < 12) return null;
  const commandType = command[0];
  if (commandType !== 0x06 && commandType !== 0x08) return null;
  return {
    commandType,
    channel: normalizeChannelId(command[1], 0),
    reliableSeq: readU32(command, 8),
  };
}

function outboundReliableRto(session) {
  const roundTripTime = Math.max(1, numberOr(session?.outboundRoundTripTime, OUTBOUND_RELIABLE_INITIAL_RTO_MS));
  const variance = Math.max(0, numberOr(session?.outboundRoundTripVariance, 0));
  return Math.max(OUTBOUND_RELIABLE_INITIAL_RTO_MS, Math.round(roundTripTime + 4 * variance));
}

function trackOutboundReliableCommands(socket, rinfo, session, commands) {
  const pending = ensureOutboundReliableMap(session);
  if (!pending) return;
  const now = Date.now();
  for (const command of commands || []) {
    const info = outboundReliableCommandInfo(command);
    if (!info) continue;
    const key = outboundReliableKey(info.channel, info.reliableSeq);
    const existing = pending.get(key);
    if (existing) {
      existing.socket = socket;
      existing.rinfo = { address: rinfo.address, port: rinfo.port };
      existing.lastSentAt = now;
      continue;
    }
    pending.set(key, {
      ...info,
      command: Buffer.from(command),
      socket,
      rinfo: { address: rinfo.address, port: rinfo.port },
      firstSentAt: now,
      lastSentAt: now,
      sentCount: 1,
      roundTripTimeout: outboundReliableRto(session),
    });
  }
}

function acknowledgeOutboundReliable(session, channel, reliableSeq) {
  const pending = ensureOutboundReliableMap(session);
  if (!pending) return false;
  const key = outboundReliableKey(channel, reliableSeq);
  const entry = pending.get(key);
  if (!entry) return false;
  pending.delete(key);

  const sample = Math.max(1, Date.now() - entry.lastSentAt);
  const previousRtt = Math.max(1, numberOr(session.outboundRoundTripTime, OUTBOUND_RELIABLE_INITIAL_RTO_MS));
  const previousVariance = Math.max(0, numberOr(session.outboundRoundTripVariance, 0));
  session.outboundRoundTripVariance = Math.round(previousVariance * 0.75 + Math.abs(previousRtt - sample) * 0.25);
  session.outboundRoundTripTime = Math.round(previousRtt * 0.875 + sample * 0.125);
  if (DEBUG_PACKETS) {
    console.log(`[ack] actor=${session.actorId || 0} channel=${channel} seq=${reliableSeq} sample=${sample}ms pending=${pending.size}`);
  }
  return true;
}

function clearOutboundReliableState(session) {
  if (!session) return;
  session.outboundReliable = new Map();
  session.outboundRoundTripTime = OUTBOUND_RELIABLE_INITIAL_RTO_MS;
  session.outboundRoundTripVariance = 0;
}

function sendOutboundReliableRetry(session, entry) {
  if (!session || !entry?.socket || !entry?.rinfo || !entry.command) return false;
  const sentTime = photonNow();
  const packet = Buffer.concat([
    makeHeader(session.peerId, 1, sentTime, session.challenge),
    entry.command,
  ]);
  try {
    entry.socket.send(packet, entry.rinfo.port, entry.rinfo.address);
  } catch (error) {
    console.log(`[warn] reliable-retry failed actor=${session.actorId || 0} channel=${entry.channel} seq=${entry.reliableSeq} reason=${error.message}`);
    return false;
  }
  return true;
}

function runOutboundReliableRetries() {
  const now = Date.now();
  const expiredSessions = new Map();
  for (const session of sessions.values()) {
    const pending = session?.outboundReliable;
    if (!(pending instanceof Map) || pending.size <= 0) continue;
    for (const [key, entry] of pending.entries()) {
      if (now - entry.lastSentAt <= entry.roundTripTimeout) continue;
      if (
        entry.sentCount > OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE ||
        now - entry.firstSentAt > OUTBOUND_RELIABLE_DISCONNECT_MS
      ) {
        pending.delete(key);
        if (!expiredSessions.has(session)) expiredSessions.set(session, entry);
        continue;
      }
      if (!sendOutboundReliableRetry(session, entry)) continue;
      entry.sentCount += 1;
      entry.lastSentAt = now;
      entry.roundTripTimeout *= 2;
      console.log(`[retry] reliable actor=${session.actorId || 0} channel=${entry.channel} seq=${entry.reliableSeq} type=${entry.commandType} count=${entry.sentCount} next=${entry.roundTripTimeout}ms pending=${pending.size}`);
    }
  }

  for (const [session, entry] of expiredSessions.entries()) {
    if (session.transportDisconnected) continue;
    session.transportDisconnected = true;
    console.log(`[state] reliable timeout actor=${session.actorId || 0} channel=${entry.channel} seq=${entry.reliableSeq} count=${entry.sentCount} age=${now - entry.firstSentAt}ms`);
    detachMasterSession(session, "reliable-timeout");
    detachSessionFromRoom(session, "reliable-timeout");
    if (session.sessionId) sessions.delete(session.sessionId);
  }
}

function shotTrajectoryCount(data) {
  const trajectory = htGet(data, 15)?.value;
  if (trajectory?.kind === "typed-array") return trajectory.items?.length || 0;
  if (Array.isArray(trajectory)) return trajectory.length;
  return 0;
}

function describeShotRequest(parsed) {
  const data = parsed?.params?.get(245);
  if (!data) return "type=? mode=? ts=none";
  const weaponType = htGet(data, 91)?.value;
  const launchMode = shotLaunchMode(data);
  const ts = shotTimestampKey(data) || "none";
  const landing = htGet(data, 9)?.value;
  const trajectory = shotTrajectoryCount(data);
  return `type=${weaponType ?? "?"} mode=${launchMode ?? "?"} ts=${ts} landing=${landing ?? "none"} trajectory=${trajectory}`;
}

async function buildReliableCommandsForParsedPayload(port, socket, rinfo, session, parsed, payload, channel) {
  if (payload[0] === 0xf3 && payload[1] === 0x00) {
    const initModes = INIT_REPLY === "both" ? ["callback", "legacy"] : [INIT_REPLY];
    const initSeqs = [];
    const reliableCommands = [];
    for (const initMode of initModes) {
      const initCommands = makeReliableCommandsForPayload(session, rawInit(initMode), channel);
      initSeqs.push(reliableCommandSeqSummary(initCommands));
      reliableCommands.push(...initCommands);
    }
    console.log(`[state] init accepted reply=${initModes.join("+")} seq=${initSeqs.join(",")}`);
    if (PUSH_ROOM_LIST_AFTER_INIT) {
      const roomListCommands = makeReliableCommandsForPayload(session, makeRoomListEvent(session), channel);
      reliableCommands.push(...roomListCommands);
      console.log(`[event] room list pushed after init seq=${reliableCommandSeqSummary(roomListCommands)} rooms=${roomListSummary()}`);
    }
    return reliableCommands;
  }

  const responses = await handleOperation(port, socket, rinfo, session, parsed, channel);
  const reliableCommands = responses.flatMap((response) => makeReliableCommandsForPayload(session, response, channel));
  if (SHOT_LOCAL_RESPONSE_TRACE && photonEventCode(parsed) === 97) {
    console.log(`[sync] shot-response actor=${session.actorId} ${describeShotRequest(parsed)} responses=${responses.length} commands=${reliableCommands.length} bytes=${commandBytes(reliableCommands)} seq=${reliableCommandSeqSummary(reliableCommands)} channel=${channel}`);
  }
  return reliableCommands;
}

function reliableFragmentCacheKey(session, channel, fragmentStartSeq) {
  return `${session.reliableGeneration || 0}:${channel}:fragment:${fragmentStartSeq}`;
}

function parseReliableFragmentCommand(msg, offset, commandEnd, channel, reliableSeq) {
  if (offset + 32 > commandEnd) {
    return { error: `short-fragment-header size=${commandEnd - offset}` };
  }
  const startSeq = readU32(msg, offset + 12);
  const fragmentCount = readU32(msg, offset + 16);
  const fragmentNumber = readU32(msg, offset + 20);
  const totalLength = readU32(msg, offset + 24);
  const fragmentOffset = readU32(msg, offset + 28);
  const dataOffset = offset + 32;
  const fragmentLength = commandEnd - dataOffset;
  if (!Number.isFinite(fragmentCount) || fragmentCount < 1 || fragmentCount > ENET_MAX_FRAGMENT_COUNT) {
    return { error: `bad-fragment-count count=${fragmentCount}` };
  }
  if (!Number.isFinite(fragmentNumber) || fragmentNumber < 0 || fragmentNumber >= fragmentCount) {
    return { error: `bad-fragment-number number=${fragmentNumber} count=${fragmentCount}` };
  }
  if (!Number.isFinite(totalLength) || totalLength < 1 || totalLength > ENET_MAX_FRAGMENT_TOTAL_BYTES) {
    return { error: `bad-fragment-total total=${totalLength}` };
  }
  if (!Number.isFinite(fragmentOffset) || fragmentOffset < 0 || fragmentOffset + fragmentLength > totalLength) {
    return { error: `bad-fragment-offset offset=${fragmentOffset} len=${fragmentLength} total=${totalLength}` };
  }
  return {
    channel,
    reliableSeq,
    startSeq,
    fragmentCount,
    fragmentNumber,
    totalLength,
    fragmentOffset,
    payload: msg.subarray(dataOffset, commandEnd),
  };
}

function addReliableFragment(session, fragment) {
  if (!session.reliableFragments) session.reliableFragments = new Map();
  const key = reliableFragmentCacheKey(session, fragment.channel, fragment.startSeq);
  let entry = session.reliableFragments.get(key);
  if (!entry || entry.totalLength !== fragment.totalLength || entry.fragmentCount !== fragment.fragmentCount) {
    entry = {
      buffer: Buffer.alloc(fragment.totalLength),
      received: new Set(),
      receivedBytes: 0,
      totalLength: fragment.totalLength,
      fragmentCount: fragment.fragmentCount,
      createdAt: Date.now(),
    };
    session.reliableFragments.set(key, entry);
  }
  if (!entry.received.has(fragment.fragmentNumber)) {
    fragment.payload.copy(entry.buffer, fragment.fragmentOffset);
    entry.received.add(fragment.fragmentNumber);
    entry.receivedBytes += fragment.payload.length;
  }
  while (session.reliableFragments.size > 32) {
    const firstKey = session.reliableFragments.keys().next().value;
    session.reliableFragments.delete(firstKey);
  }
  return entry.received.size === entry.fragmentCount ? { key, payload: entry.buffer } : null;
}

function sendPacket(socket, rinfo, session, commands, peerIdOverride = null) {
  const outgoingCommands = fragmentOutgoingReliableCommands(session, commands);
  const sentTime = photonNow();
  const buildPacket = (packetCommands) => Buffer.concat([
    makeHeader(peerIdOverride ?? session.peerId, packetCommands.length, sentTime, session.challenge),
    ...packetCommands,
  ]);
  const packet = buildPacket(outgoingCommands);

  if (MAX_UDP_PACKET_BYTES > 0 && outgoingCommands.length > 1 && packet.length > MAX_UDP_PACKET_BYTES) {
    let chunk = [];
    for (const command of outgoingCommands) {
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
  trackOutboundReliableCommands(socket, rinfo, session, outgoingCommands);
  const ackOnly = outgoingCommands.every((command) => command[0] === 0x01);
  if (LOG_SEND_PACKETS || (!ackOnly && MAX_UDP_PACKET_BYTES > 0 && packet.length > MAX_UDP_PACKET_BYTES)) {
    console.log(`[send] bytes=${packet.length} to=${rinfo.address}:${rinfo.port} cmds=${outgoingCommands.length}`);
  }
  if (MAX_UDP_PACKET_BYTES > 0 && packet.length > MAX_UDP_PACKET_BYTES) {
    console.log(`[warn] udp-packet-large bytes=${packet.length} max=${MAX_UDP_PACKET_BYTES} cmds=${outgoingCommands.length}`);
  }
}

function nextReliableSeqForSession(session, channel = 0) {
  const targetChannel = normalizeChannelId(channel, 0);
  if (targetChannel === 0) return session.serverSeq++;
  if (!session.serverSeqByChannel) session.serverSeqByChannel = new Map();
  const seq = (Number(session.serverSeqByChannel.get(targetChannel)) || 0) + 1;
  session.serverSeqByChannel.set(targetChannel, seq);
  return seq;
}

function currentReliableSeqForSession(session, channel = 0) {
  const targetChannel = normalizeChannelId(channel, 0);
  if (targetChannel === 0) return Math.max(0, (Number(session.serverSeq) || 0) - 1);
  return Math.max(0, Number(session.serverSeqByChannel?.get(targetChannel)) || 0);
}

function nextUnreliableSeqForSession(session, channel = 0) {
  const targetChannel = normalizeChannelId(channel, 0);
  if (targetChannel === 0) {
    session.unreliableSeq = ((Number(session.unreliableSeq) || 0) + 1) >>> 0;
    return session.unreliableSeq;
  }
  if (!session.unreliableSeqByChannel) session.unreliableSeqByChannel = new Map();
  const seq = ((Number(session.unreliableSeqByChannel.get(targetChannel)) || 0) + 1) >>> 0;
  session.unreliableSeqByChannel.set(targetChannel, seq);
  return seq;
}

function sendReliablePayload(socket, rinfo, session, payload, channel = 0) {
  sendPacket(socket, rinfo, session, makeReliableCommandsForPayload(session, payload, channel));
}

function reliableChannelForSession(session, fallback = 0, options = {}) {
  if (options.forceChannel) return normalizeChannelId(fallback, 0);
  const lastChannel = Number(session?.lastChannel);
  if (Number.isInteger(lastChannel) && lastChannel >= 0 && lastChannel <= 255) return lastChannel;
  return normalizeChannelId(fallback, 0);
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

function rawShortArray(values) {
  return rawTypedArray(0x6b, values.map((value) => i16(Number(value) || 0)));
}

function rawHashtable(entries) {
  return Buffer.concat([Buffer.from([0x68]), rawHashtableBody(entries)]);
}

function rawHashtableFromBody(body) {
  return Buffer.concat([Buffer.from([0x68]), body]);
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

function rawTypedArray(itemType, itemBodies) {
  return Buffer.concat([
    Buffer.from([0x79]),
    u16(itemBodies.length),
    Buffer.from([itemType & 0xff]),
    ...itemBodies,
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
    const items = [];
    for (let i = 0; i < count; i++) {
      const parsed = readTypedRaw(buf, offset, itemType);
      offset = parsed.offset;
      items.push(parsed);
    }
    value = { kind: "typed-array", itemType, items };
    return { type, value, raw: buf.subarray(start, offset), offset };
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
  const rotX = Number(htGet(data, 4)?.value || 0);
  const rotY = Number(htGet(data, 5)?.value ?? htGet(data, 7)?.value ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return {
    x,
    y,
    z,
    rotX: Number.isFinite(rotX) ? rotX : 0,
    rotY: Number.isFinite(rotY) ? rotY : 0,
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringOr(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

// Telemetry only: Contra City has legitimate weapon-propelled movement, so
// movement is intentionally outside this first anti-cheat pass. These counters
// cover only weapon events that the server has already rejected from its own
// authoritative weapon state.
function noteAntiCheatWeaponViolation(session, kind, reason, details = {}) {
  if (!session) return;

  const antiCheat = session.antiCheat || (session.antiCheat = {
    weaponViolations: new Map(),
    totalWeaponViolations: 0,
  });
  const key = `${kind}:${reason}`;
  const count = numberOr(antiCheat.weaponViolations.get(key), 0) + 1;
  antiCheat.weaponViolations.set(key, count);
  antiCheat.totalWeaponViolations = numberOr(antiCheat.totalWeaponViolations, 0) + 1;

  // Preserve useful evidence without turning an intentional packet flood into
  // an AWS log flood.
  if (count !== 1 && count !== 5 && count % 25 !== 0) return;

  const weapon = details.weaponType == null ? "" : ` type=${details.weaponType}`;
  const slot = details.slot == null ? "" : ` slot=${details.slot}`;
  const wait = Number.isFinite(Number(details.waitMs)) && Number(details.waitMs) > 0
    ? ` wait=${Math.round(Number(details.waitMs))}ms`
    : "";
  console.log(`[anticheat] weapon-rejected actor=${session.actorId ?? "?"} kind=${kind} reason=${reason}${weapon}${slot}${wait} count=${count} total=${antiCheat.totalWeaponViolations}`);
}

const WINDOWS_1251_DECODER = new TextDecoder("windows-1251");
const WINDOWS_1251_ENCODER = new Map();
for (let byte = 0; byte <= 0xff; byte += 1) {
  WINDOWS_1251_ENCODER.set(WINDOWS_1251_DECODER.decode(Uint8Array.of(byte)), byte);
}

function decodeLegacyBonusText(value) {
  const source = stringOr(value, "");
  // Restored tooltip constants contain UTF-8 bytes decoded as Windows-1251.
  // API strings can already be valid UTF-8, so accept the reversal only when
  // every character maps losslessly and the resulting UTF-8 has no replacement.
  if (!/[РС][^\s]/.test(source)) return source;
  const bytes = [];
  for (const character of source) {
    const byte = WINDOWS_1251_ENCODER.get(character);
    if (byte == null) return source;
    bytes.push(byte);
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("\ufffd") ? source : decoded;
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function hashStringToU32(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function deterministicUnit(...parts) {
  return hashStringToU32(parts.join("|")) / 0x100000000;
}

function roomSettingsFrom(rawRoom) {
  const hasFullSettings = Boolean(htGet(rawRoom, "map"));
  const name = stringOr(htGet(rawRoom, "name")?.value, DEFAULT_ROOM);
  const map = stringOr(htGet(rawRoom, "map")?.value, DEFAULT_MAP);
  const modeValue = htGet(rawRoom, "game_mode")?.value;
  const requestedMode = Number(modeValue ?? 1);
  const mode = normalizeModeForMap(map, FORCE_TEAM_MODE ? MAP_MODE_TEAM_DEATHMATCH : requestedMode);
  if (mode !== requestedMode) {
    console.log(`[state] room mode normalized map=${map} requested=${requestedMode} accepted=${mode}`);
  }
  const maxUsers = htGet(rawRoom, "max_users")?.value;
  const friendly = htGet(rawRoom, "friendly_fire")?.value;
  const guestMode = htGet(rawRoom, "guest_mode")?.value;
  return {
    name,
    map,
    mode,
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
        { key: rawString("interpolation_mode"), value: rawByte(ROOM_INTERPOLATION_MODE) },
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

function shouldDeferPeerFromJoinActorList(playerSession) {
  return Boolean(
    playerSession?.actorWearCount > 0 &&
    !playerSession.joinActorHasWears &&
    playerSession.peerActorHasWears &&
    playerSession.peerActorRaw
  );
}

function makeRoomActorListRaw(room, excludeSession = null) {
  if (excludeSession) {
    excludeSession.joinActorListIds = new Set();
    excludeSession.deferredJoinActorIds = new Set();
  }
  if (!room?.players?.size) return makeEmptyActorListRaw();
  const entries = [];
  for (const [actorId, playerSession] of room.players.entries()) {
    if (!playerSession || playerSession === excludeSession) continue;
    refreshActorWireDataForRoomActorList(playerSession);
    if (excludeSession && shouldDeferPeerFromJoinActorList(playerSession)) {
      excludeSession.deferredJoinActorIds.add(Number(actorId));
      console.log(`[state] actor-list defer target=${excludeSession.actorId || "pending"} actor=${actorId} reason=join-no-wears peerProfile=${playerSession.peerActorProfile || "n/a"} peerPacket=${playerSession.peerActorRawBytes || 0} joinProfile=${playerSession.joinActorProfile || "n/a"} joinPacket=${playerSession.joinActorRawBytes || 0} wears=${playerSession.actorWearCount || 0} wearList=${playerSession.actorWearSummary || "none"}`);
      continue;
    }
    const playerActorRaw = playerSession.joinActorRaw || playerSession.peerActorRaw || playerSession.actorRaw;
    if (!playerActorRaw) continue;
    excludeSession?.joinActorListIds?.add(Number(actorId));
    entries.push({
      key: rawInt(actorId),
      value: playerActorRaw,
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
  { w_id: 1, id: 1, wt: 1, ws: 1, sn: "ohca_basebalbat", vel: 100, rad: 8, ang: 2.05, rap: 340, rt: 0, ammo: 0, ammo_tot: 0, lt: 250, krit: 8, dev: 2, smindam: 18, smaxdam: 34, mmindam: 12, mmaxdam: 22, lmindam: 8, lmaxdam: 14 },
  { w_id: 2, id: 2, wt: 3, ws: 2, sn: "hg_makarov", vel: 100, rad: 10, ang: 0, rap: 240, rt: 2967, ammo: 12, ammo_tot: 60, lt: 520, krit: 7, dev: 8, smindam: 18, smaxdam: 28, mmindam: 13, mmaxdam: 21, lmindam: 8, lmaxdam: 15 },
  { w_id: 3, id: 3, wt: 4, ws: 3, sn: "mg_ak47", vel: 100, rad: 12, ang: 0, rap: 150, rt: 2967, ammo: 30, ammo_tot: 90, lt: 650, krit: 5, dev: 12, smindam: 16, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 9, lmaxdam: 17 },
  { w_id: 4, id: 4, wt: 6, ws: 4, sn: "gg_m134", vel: 100, rad: 14, ang: 0, rap: 125, rt: 800, ammo: 90, ammo_tot: 180, lt: 1100, krit: 4, dev: 18, smindam: 13, smaxdam: 22, mmindam: 11, mmaxdam: 18, lmindam: 8, lmaxdam: 14 },
  { w_id: 5, id: 5, wt: 7, ws: 5, sn: "sg_winchester1887", vel: 100, rad: 18, ang: 0, rap: 620, rt: 4500, ammo: 6, ammo_tot: 36, lt: 900, krit: 6, dev: 24, smindam: 42, smaxdam: 62, mmindam: 22, mmaxdam: 35, lmindam: 8, lmaxdam: 14 },
  { w_id: 6, id: 6, wt: 8, ws: 6, sn: "rl_rpg26", vel: 65, rad: 28, ang: 0, rap: 900, rt: 2300, ammo: 1, ammo_tot: 8, lt: 1150, krit: 3, dev: 6, smindam: 78, smaxdam: 120, mmindam: 62, mmaxdam: 95, lmindam: 40, lmaxdam: 72 },
  { w_id: 7, id: 7, wt: 10, ws: 7, sn: "sr_svd", vel: 100, rad: 10, ang: 0, rap: 850, rt: 2967, ammo: 10, ammo_tot: 40, lt: 1000, krit: 8, dev: 3, smindam: 34, smaxdam: 48, mmindam: 38, mmaxdam: 54, lmindam: 42, lmaxdam: 60 },
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

const PASSIVE_BATTLE_ENHANCER_IDS = new Set([
  1, 2, 3, 4, 5,
  10, 11, 12,
  30, 31, 32, 33, 34, 35, 36,
]);

const IMPACT_TYPE = Object.freeze({
  NONE: 0,
  FIRE: 1,
  BLOOD: 2,
  POISON: 3,
  FROST: 5,
});

const IMPACT_DOT_DEFINITIONS = [
  { type: IMPACT_TYPE.FIRE, min: 3, max: 6, ids: [80], keys: ["mg_aug5_o"] },
  { type: IMPACT_TYPE.FIRE, min: 2, max: 5, ids: [72], keys: ["ohca_candy"] },
  { type: IMPACT_TYPE.FIRE, min: 6, max: 10, ids: [104], keys: ["gl_grenadelauncher03"] },
  { type: IMPACT_TYPE.FROST, min: 2, max: 5, ids: [71], keys: ["ohca_candy2"] },
  { type: IMPACT_TYPE.BLOOD, min: 6, max: 10, ids: [59], keys: ["rl_rpg7b02"] },
  { type: IMPACT_TYPE.BLOOD, min: 3, max: 6, ids: [79, 109], keys: ["mg_aug4_o", "sg_remington"] },
  { type: IMPACT_TYPE.POISON, min: 3, max: 5, ids: [76], keys: ["mg_aug1_o"] },
  { type: IMPACT_TYPE.POISON, min: 4, max: 7, ids: [45], keys: ["gl_milkor_a"] },
  { type: IMPACT_TYPE.POISON, min: 3, max: 6, ids: [75], keys: ["sr_wildcat2"] },
].map((definition) => ({
  ...definition,
  ticks: Math.max(1, numberOr(definition.ticks, IMPACT_DOT_DEFAULT_TICKS)),
}));

const IMPACT_DOT_BY_WEAPON_ID = new Map();
const IMPACT_DOT_BY_WEAPON_KEY = new Map();
for (const definition of IMPACT_DOT_DEFINITIONS) {
  for (const id of definition.ids || []) IMPACT_DOT_BY_WEAPON_ID.set(Number(id), definition);
  for (const key of definition.keys || []) IMPACT_DOT_BY_WEAPON_KEY.set(String(key).toLowerCase(), definition);
}

const IMPACT_PROTECTION_ENHANCER_BY_TYPE = new Map([
  [IMPACT_TYPE.FIRE, 30],
  [IMPACT_TYPE.BLOOD, 31],
  [IMPACT_TYPE.POISON, 32],
  [IMPACT_TYPE.FROST, 34],
]);
const ARCING_LAUNCHER_VELOCITY = 10;
const ARCING_LAUNCHER_LIFE = 7000;
const ARCING_LAUNCHER_DISTANCE = 10;

const WEAPON_STAT_OVERRIDES = {
  ohca_basebalbat: {
    rt: 0,
    ammo: 0,
    ammo_tot: 0,
    rad: 8,
    ang: 2.05
  },
  ohca_candy: {
    w_id: 72, id: 72, wt: 1, ws: 1, sn: "ohca_candy", vel: 100, rad: 8, ang: 2.05, rap: 330, rt: 0, ammo: 0, ammo_tot: 0, lt: 250, krit: 10, dev: 2,
    smindam: 20, smaxdam: 36, mmindam: 14, mmaxdam: 24, lmindam: 9, lmaxdam: 15
  },
  ohca_candy2: {
    w_id: 71, id: 71, wt: 1, ws: 1, sn: "ohca_candy2", vel: 100, rad: 8, ang: 2.05, rap: 335, rt: 0, ammo: 0, ammo_tot: 0, lt: 250, krit: 9, dev: 2,
    smindam: 20, smaxdam: 36, mmindam: 13, mmaxdam: 24, lmindam: 9, lmaxdam: 16
  },
  hg_taurus: {
    w_id: 108, id: 108, wt: 3, ws: 2, sn: "hg_taurus", vel: 100, rad: 10, ang: 0, rap: 260, rt: 2533, ammo: 6, ammo_tot: 38, lt: 520, krit: 10, dev: 6,
    smindam: 28, smaxdam: 42, mmindam: 20, mmaxdam: 31, lmindam: 13, lmaxdam: 22
  },
  hg_usp: {
    w_id: 105, id: 105, wt: 3, ws: 2, sn: "hg_usp", vel: 100, rad: 10, ang: 0, rap: 205, rt: 2667, ammo: 13, ammo_tot: 45, lt: 520, krit: 9, dev: 5,
    smindam: 22, smaxdam: 34, mmindam: 17, mmaxdam: 27, lmindam: 11, lmaxdam: 19
  },
  hg_desertb01: {
    w_id: 69, id: 69, wt: 3, ws: 2, sn: "hg_desertb01", vel: 100, rad: 10, ang: 0, rap: 280, rt: 2533, ammo: 7, ammo_tot: 42, lt: 520, krit: 10, dev: 6,
    smindam: 24, smaxdam: 37, mmindam: 20, mmaxdam: 29, lmindam: 12, lmaxdam: 19
  },
  hg_desert: {
    w_id: 53, id: 53, wt: 3, ws: 2, sn: "hg_desert", vel: 100, rad: 10, ang: 0, rap: 260, rt: 2533, ammo: 7, ammo_tot: 42, lt: 520, krit: 9, dev: 7,
    smindam: 21, smaxdam: 31, mmindam: 14, mmaxdam: 21, lmindam: 11, lmaxdam: 21
  },
  hg_glockb01_s: {
    w_id: 68, id: 68, wt: 3, ws: 2, sn: "hg_glockb01_s", vel: 100, rad: 10, ang: 0, rap: 150, rt: 2667, ammo: 18, ammo_tot: 108, lt: 520, krit: 6, dev: 9,
    smindam: 17, smaxdam: 25, mmindam: 12, mmaxdam: 19, lmindam: 9, lmaxdam: 16
  },
  mg_assaultrifle02: {
    w_id: 101, id: 101, wt: 4, ws: 3, sn: "mg_assaultrifle02", vel: 100, rad: 12, ang: 0, rap: 145, rt: 3000, ammo: 35, ammo_tot: 175, lt: 650, krit: 6, dev: 9,
    smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19
  },
  mg_ump45vkks_o: {
    w_id: 73, id: 73, wt: 4, ws: 3, sn: "mg_ump45vkks_o", vel: 100, rad: 12, ang: 0, rap: 145, rt: 3000, ammo: 35, ammo_tot: 210, lt: 650, krit: 8, dev: 6,
    smindam: 23, smaxdam: 36, mmindam: 20, mmaxdam: 31, lmindam: 16, lmaxdam: 26
  },
  mg_aug1_o: {
    w_id: 76, id: 76, wt: 4, ws: 3, sn: "mg_aug1_o", vel: 100, rad: 12, ang: 0, rap: 145, rt: 3000, ammo: 30, ammo_tot: 180, lt: 650, krit: 6, dev: 9,
    smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19
  },
  mg_aug5_o: {
    w_id: 80, id: 80, wt: 4, ws: 3, sn: "mg_aug5_o", vel: 100, rad: 12, ang: 0, rap: 135, rt: 3000, ammo: 30, ammo_tot: 132, lt: 650, krit: 8, dev: 8,
    smindam: 21, smaxdam: 33, mmindam: 18, mmaxdam: 29, lmindam: 14, lmaxdam: 24
  },
  mg_aug4_o: {
    w_id: 79, id: 79, wt: 4, ws: 3, sn: "mg_aug4_o", vel: 100, rad: 12, ang: 0, rap: 130, rt: 3000, ammo: 30, ammo_tot: 168, lt: 650, krit: 8, dev: 6,
    smindam: 20, smaxdam: 32, mmindam: 17, mmaxdam: 28, lmindam: 13, lmaxdam: 23
  },
  sr_svd: {
    smindam: 34,
    smaxdam: 48,
    mmindam: 38,
    mmaxdam: 54,
    lmindam: 42,
    lmaxdam: 60,
    krit: 8
  },
  gg_fnmag: {
    w_id: 110, id: 110, wt: 6, ws: 4, sn: "gg_fnmag", vel: 100, rad: 14, ang: 0, rap: 125, rt: 4000, ammo: 90, ammo_tot: 270, lt: 1100, krit: 6, dev: 14,
    smindam: 17, smaxdam: 29, mmindam: 15, mmaxdam: 25, lmindam: 11, lmaxdam: 19
  },
  gg_m134b03: {
    w_id: 67, id: 67, wt: 6, ws: 4, sn: "gg_m134b03", vel: 100, rad: 14, ang: 0, rap: 115, rt: 800, ammo: 100, ammo_tot: 300, lt: 1100, krit: 4, dev: 20,
    smindam: 15, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 10, lmaxdam: 17
  },
  sg_remington: {
    w_id: 109, id: 109, wt: 7, ws: 5, sn: "sg_remington", vel: 100, rad: 18, ang: 0, rap: 660, rt: 3864, ammo: 3, ammo_tot: 11, lt: 900, krit: 11, dev: 26,
    smindam: 58, smaxdam: 86, mmindam: 34, mmaxdam: 52, lmindam: 10, lmaxdam: 18,
    wsp: 15,
    shake: 1
  },
  sg_spas: {
    w_id: 106, id: 106, wt: 7, ws: 5, sn: "sg_spas", vel: 100, rad: 18, ang: 0, rap: 650, rt: 3500, ammo: 6, ammo_tot: 36, lt: 900, krit: 8, dev: 22,
    smindam: 48, smaxdam: 72, mmindam: 28, mmaxdam: 44, lmindam: 9, lmaxdam: 16
  },
  rl_m202a1: {
    w_id: 43, id: 43, wt: 8, ws: 6, sn: "rl_m202a1", vel: 60, rad: 30, ang: 0, rap: 920, rt: 5067, ammo: 4, ammo_tot: 16, lt: 1200, krit: 3, dev: 7,
    smindam: 45, smaxdam: 70, mmindam: 34, mmaxdam: 54, lmindam: 22, lmaxdam: 38,
    wsp: -15,
    launch: 1,
    shake: 1
  },
  rl_rpg7b02: {
    w_id: 59, id: 59, wt: 8, ws: 6, sn: "rl_rpg7b02", vel: 65, rad: 28, ang: 0, rap: 900, rt: 2967, ammo: 1, ammo_tot: 9, lt: 1150, krit: 4, dev: 6,
    smindam: 84, smaxdam: 126, mmindam: 68, mmaxdam: 104, lmindam: 48, lmaxdam: 78
  },
  gl_grenadelauncher03: {
    w_id: 104, id: 104, wt: 9, ws: 6, sn: "gl_grenadelauncher03", vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, rap: 880, rt: 4000, ammo: 3, ammo_tot: 18, lt: ARCING_LAUNCHER_LIFE, krit: 4, dev: 5,
    smindam: 68, smaxdam: 104, mmindam: 54, mmaxdam: 86, lmindam: 36, lmaxdam: 62
  },
  gl_milkor: {
    w_id: 44, id: 44, wt: 9, ws: 6, sn: "gl_milkor", vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, rap: 900, rt: 6667, ammo: 6, ammo_tot: 30, lt: ARCING_LAUNCHER_LIFE, krit: 3, dev: 6,
    smindam: 54, smaxdam: 82, mmindam: 42, mmaxdam: 66, lmindam: 28, lmaxdam: 48
  },
  gl_milkor_a: {
    w_id: 45, id: 45, wt: 9, ws: 6, sn: "gl_milkor_a", vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, rap: 900, rt: 6667, ammo: 6, ammo_tot: 36, lt: ARCING_LAUNCHER_LIFE, krit: 3, dev: 6,
    smindam: 56, smaxdam: 84, mmindam: 44, mmaxdam: 68, lmindam: 30, lmaxdam: 50
  },
  sr_vintorez: {
    w_id: 107, id: 107, wt: 10, ws: 7, sn: "sr_vintorez", vel: 100, rad: 10, ang: 0, rap: 700, rt: 3167, ammo: 20, ammo_tot: 100, lt: 1000, krit: 10, dev: 3,
    smindam: 42, smaxdam: 58, mmindam: 48, mmaxdam: 66, lmindam: 54, lmaxdam: 74
  },
  sr_sniperrifle03: {
    w_id: 103, id: 103, wt: 10, ws: 7, sn: "sr_sniperrifle03", vel: 100, rad: 10, ang: 0, rap: 950, rt: 3667, ammo: 5, ammo_tot: 35, lt: 1000, krit: 14, dev: 2,
    smindam: 54, smaxdam: 72, mmindam: 62, mmaxdam: 82, lmindam: 70, lmaxdam: 88
  },
  sr_wildcat1: {
    w_id: 74, id: 74, wt: 10, ws: 7, sn: "sr_wildcat1", vel: 100, rad: 10, ang: 0, rap: 980, rt: 2333, ammo: 1, ammo_tot: 16, lt: 1000, krit: 12, dev: 2,
    smindam: 50, smaxdam: 68, mmindam: 58, mmaxdam: 78, lmindam: 66, lmaxdam: 84
  },
  sr_wildcat2: {
    w_id: 75, id: 75, wt: 10, ws: 7, sn: "sr_wildcat2", vel: 100, rad: 10, ang: 0, rap: 980, rt: 2333, ammo: 1, ammo_tot: 16, lt: 1000, krit: 11, dev: 2,
    smindam: 46, smaxdam: 62, mmindam: 54, mmaxdam: 72, lmindam: 62, lmaxdam: 82
  }
};

const ABILITY_BONUS_LEVELS = {
  1: { armorFlat: [10, 20, 40, 60, 80] },
  2: { healthFlat: [10, 20, 30, 40, 50] },
  3: { speedPercent: [2, 4, 6, 8, 10] },
  4: { damageReductionPercent: [2, 4, 6, 8, 10] },
  5: { weaponRapidityPercent: [2, 4, 6, 8, 10] },
  6: { weaponCritPercent: [5, 10, 15, 20, 25] },
  7: { weaponAmmoPercent: [10, 30, 40, 50, 60] },
  8: { weaponMinDamageFlat: [1, 2, 3, 4, 5] },
  9: { weaponMaxDamageFlat: [1, 2, 3, 4, 5] },
  10: { weaponAccuracyFlat: [1, 2, 3, 4, 5] },
  11: { weaponHeadDamagePercent: [5, 10, 15, 20, 25] },
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

const ASSEMBLAGE_BONUS_TEXTS = {
  1: "+15% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  2: "+15% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  3: "+5% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\nРќРµР±РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  6: "+10% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Рє Р‘СЂРѕРЅРµ",
  7: "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ\n+2% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ",
  8: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  9: "+35% Р·Р°С‰РёС‚С‹ РѕС‚ Р»РµРґРѕРјРµС‚РѕРІ\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ\n-20% Р·Р°С‰РёС‚С‹ РѕС‚ РїРѕРґР¶РёРіР°СЋС‰РµРіРѕ РѕСЂСѓР¶РёСЏ",
  10: "+5% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  11: "РЈСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґ. РґРёСЃС‚Р°РЅС†РёРё +2\nР—Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ +5%\nР—Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє +15%\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  12: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+7% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3\nСѓСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2",
  14: "РЈСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґ. РґРёСЃС‚Р°РЅС†РёРё +2\nР—Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ +10%\nР—Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє +10%\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ",
  15: "Р—РґРѕСЂРѕРІСЊРµ +7%\nР—Р°С‰РёС‚Р° РѕС‚:\nСЂР°РєРµС‚РЅРёС† +15%\nР°РІС‚РѕРјР°С‚РѕРІ +11%\nРґСЂРѕР±РѕРІРёРєРѕРІ +10%\nСЃРЅР°Р№РїРµСЂРѕРє +15%\nРїРёСЃС‚РѕР»РµС‚РѕРІ +7%\nРЈСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +4",
  16: "Р—РґРѕСЂРѕРІСЊРµ +5%\nР—Р°С‰РёС‚Р° РѕС‚:\nСЂР°РєРµС‚РЅРёС† +13%\nР°РІС‚РѕРјР°С‚РѕРІ +10%\nРґСЂРѕР±РѕРІРёРєРѕРІ +9%\nСЃРЅР°Р№РїРµСЂРѕРє +15%\nРїРёСЃС‚РѕР»РµС‚РѕРІ +5%\nРЈСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  17: "Р—РґРѕСЂРѕРІСЊРµ +5%\nР—Р°С‰РёС‚Р° РѕС‚:\nСЂР°РєРµС‚РЅРёС† +11%\nР°РІС‚РѕРјР°С‚РѕРІ +9%\nРґСЂРѕР±РѕРІРёРєРѕРІ +8%\nСЃРЅР°Р№РїРµСЂРѕРє +15%\nРїРёСЃС‚РѕР»РµС‚РѕРІ +3%\nРЈСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2",
  18: "+6% Рє Р—РґРѕСЂРѕРІСЊСЋ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+8% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+7% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  19: "+3% Рє Р—РґРѕСЂРѕРІСЊСЋ\n+3% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р—Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\nСѓРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  20: "+6% Рє Р—РґРѕСЂРѕРІСЊСЋ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+8% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+7% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  21: "+7% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+7% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+3% Р·Р°С‰РёС‚Р° РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Рє Р—РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2",
  22: "+15% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+10% Р—РґРѕСЂРѕРІСЊСЋ",
  23: "+6% Р—РґРѕСЂРѕРІСЊСЋ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+12% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+3% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚Р° РџСЂРѕРІРѕРєР°С‚РѕСЂ\n+3% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ",
  24: "+5% Р—РґРѕСЂРѕРІСЊСЋ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+7% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєР° РЎРёР±РёСЂСЏРє",
  25: "+7% Р—РґРѕСЂРѕРІСЊСЋ\n+7% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+12% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+7% Р·Р°С‰РёС‚С‹ РѕС‚ РїСѓР»РµРјРµС‚РѕРІ \n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  26: "+6% Р—РґРѕСЂРѕРІСЊСЋ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  27: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+12% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ",
  28: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЂСѓС‡РЅРѕРіРѕ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРєРё РџРёСЃРµС†\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2",
  29: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+7% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +4",
  30: "+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+4% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ РїСѓР»РµРјРµС‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3\nСѓСЂРѕРЅ РїРёСЃС‚РѕР»РµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  31: "+5% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+12% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+8% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+6% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2\nСѓСЂРѕРЅ РїСѓР»РµРјРµС‚РѕРІ РЅР° Р±Р»РёР¶РЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +5",
  32: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+20% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+15% Рє Р·РґРѕСЂРѕРІСЊСЋ\n+2% Рє СЃРєРѕСЂРѕСЃС‚Рё\nСѓСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +4",
  33: "+3% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+4% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +4\nСѓСЂРѕРЅ РїРёСЃС‚РѕР»РµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2",
  34: "+5% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+4% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+5% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3\nСѓСЂРѕРЅ РїСѓР»РµРјРµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +5",
  35: "+15% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+12% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ РґСЂРѕР±РѕРІРёРєРѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +5",
  36: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+9% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ РїРёСЃС‚РѕР»РµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +7\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6",
  37: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+4% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+4% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ СЂР°РєРµС‚РЅРёС† РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
  38: "+50% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+50% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+150 Рє Р·РґРѕСЂРѕРІСЊСЋ\n+20 Рє Р±СЂРѕРЅРµ\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3\nСѓСЂРѕРЅ РїСѓР»РµРјРµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +5",
};

const RESTORED_SET_BONUS_DEFINITIONS = [
  { id: 1, code: "peak_reaper", required: ["1:tophat", "2:skeleton_h", "4:skeleton", "7:tomb", "3:skeleton", "5:skeleton", "6:skeleton", "8:coins"] },
  { id: 2, code: "raven", required: ["2:gasmask01", "1:tactichelm01", "4:tactic01", "3:tactical01", "5:tactic01", "6:tactical01"] },
  { id: 3, code: "vandal", required: ["1:cap02", "2:band01", "3:bint02", "4:hood04", "5:sport03", "6:sneak02", "7:darts", "8:maz"] },
  { id: 6, code: "belov", required: ["1:indiana02", "2:goog02", "3:bint01", "4:hood03", "5:sport02", "7:rocket02", "8:cola01", "9:brown04"] },
  { id: 7, code: "mummy", required: ["1:pharaoh", "4:mummy", "7:sarcophagus", "3:mummy", "5:mummy", "6:mummy", "2:mummy_h", "8:skrab"] },
  { id: 8, code: "recon", required: ["1:tactichelm02", "2:gasmask02", "4:tactic02", "5:tactic02", "6:tactical02", "3:clock02"] },
  { id: 9, code: "dead_moroz", required: ["1:santa", "2:santa", "4:santa", "7:santa", "3:santa", "5:santa", "6:santa", "8:santa"] },
  { id: 10, code: "vdv", required: ["1:beret03", "4:trooper", "2:aviaglass", "5:trooper"] },
  { id: 11, code: "barkhan", required: ["1:milcap03", "4:tactic04", "3:tactical02", "5:tactic04"] },
  { id: 12, code: "invader", required: ["4:tactic03", "5:tactic03", "6:boot02", "2:googb02", "1:beret01"] },
  { id: 14, code: "olympian", required: ["1:olympic", "2:snowgoggles", "4:hoodolimpic", "7:snowboard", "3:olympic", "5:olympic", "6:sneakolimpic", "8:medal"] },
  { id: 15, code: "vkks_gold_2014", required: ["1:capvkks01", "5:sportvkks01", "8:medalgold", "4:chood01"] },
  { id: 16, code: "vkks_silver_2014", required: ["1:capvkks02", "4:chood02", "5:sportvkks02", "8:medalsilver"] },
  { id: 17, code: "vkks_bronze_2014", required: ["1:capvkks03", "4:chood03", "5:sportvkks03", "8:medalbronze"] },
  { id: 18, code: "delta", required: ["1:tacticalb01", "4:tacticb01", "5:tacticb01", "3:tacticalb01", "6:tacticalb01", "8:smertik"] },
  { id: 19, code: "ray", required: ["4:hoodb08", "5:sportb08", "6:sneakv2b02", "1:capb08", "2:bandb07"], speedPercent: 1 },
  { id: 20, code: "badboy", required: ["4:hoodb03", "5:sportb03", "8:badboy", "6:sneakv2b05", "2:maskb01", "1:capb04"] },
  { id: 21, code: "acid_warrior", required: ["1:hatb08", "4:hoodb10", "5:sportb10", "6:sneakv2b06", "2:bandb03"] },
  { id: 22, code: "stuzha", required: ["1:santa2", "2:santa2", "4:santa2", "7:santa2", "3:santa2", "5:santa2", "6:santa2", "8:santa2"] },
  { id: 23, code: "red_heat", required: ["1:capb06", "4:shirtb09", "5:shortb12", "2:googb01", "6:sneakv2b07"] },
  { id: 24, code: "cool_breeze", required: ["1:capb05", "4:shirtb04", "5:shortb14", "2:googb03", "6:sneakv2b03"] },
  { id: 25, code: "necrowarrior", required: ["9:franky", "2:franky", "4:franky", "5:franky", "6:franky", "3:franky", "8:franky", "7:frankyoctopus"] },
  { id: 26, code: "infernal", required: ["1:infernal", "4:infernal", "5:infernal", "6:infernal", "3:infernal", "2:infernal_h", "8:infernal", "7:infernalraven"] },
  { id: 27, code: "cyborg", required: ["2:maskb02", "4:hoodb05", "5:sportb05", "6:sneakv2b04"] },
  { id: 28, code: "wanderer", required: ["1:hatb01", "2:bandb05", "4:hoodb01", "5:sportb01", "6:sneakv2b10"] },
  { id: 29, code: "snakecatcher", required: ["2:bandb01", "4:hoodb04", "5:sportb04", "1:capb07", "7:snake01"] },
  { id: 30, code: "ghost", required: ["2:klavab01", "4:prizrak", "5:prizrak", "3:prizrak", "6:prizrak"] },
  { id: 31, code: "anarchist", required: ["1:capb01", "4:anarch", "5:jeansb03", "3:wristwrapb03", "6:anarch", "8:spinyellow"] },
  {
    id: 32,
    code: "biker",
    required: ["1:biker", "4:biker", "5:jeansb02", "3:biker", "6:sneakv201"],
    healthFloor: BIKER_SET_HEALTH_FLOOR,
    clientSpeedFloor: BIKER_SET_SPEED_FLOOR,
    weaponSpeedPercent: BIKER_SET_WEAPON_SPEED_BONUS,
    shotgunJumpBonus: BIKER_SET_SHOTGUN_JUMP_BONUS,
  },
  { id: 33, code: "scrapper", required: ["1:hatb06", "2:bandb04", "4:hoodb06", "5:sportb06", "6:zadira", "8:burger"] },
  { id: 34, code: "avenger", required: ["1:avenger", "2:avenger", "4:avenger", "5:avenger", "3:avenger", "6:avenger", "8:spinblue"] },
  { id: 35, code: "stalker", required: ["1:stalker", "2:stalkergasmask", "4:stalker", "5:stalker", "3:stalker", "6:stalker"] },
  { id: 36, code: "spy", required: ["1:business", "2:businessgoogles", "4:business", "5:business", "3:business", "6:business"] },
  { id: 37, code: "contranos", required: ["9:thanos", "2:thanos", "4:thanos", "5:thanos", "3:thanos", "6:thanos", "7:thanos"] },
  { id: 38, code: "blue_soldier", required: ["9:spec99", "1:ushanka2", "4:trooper2", "5:pant032", "3:glov022", "6:slip99", "7:rec2", "8:vodka"] },
].map((definition) => ({
  ...definition,
  bonusText: ASSEMBLAGE_BONUS_TEXTS[definition.id] || "",
}));

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
  return 0;
}

function isColdArmsWeaponType(type) {
  const value = numberOr(type, 0);
  return value === 1 || value === 2;
}

const MELEE_DEFAULT_DISTANCE = 8;
const MELEE_DEFAULT_ANGLE = 2.05;

function normalizeMeleeWeaponStats(item = {}) {
  const type = numberOr(item.wt ?? item.type, 0);
  if (!isColdArmsWeaponType(type)) return item;
  const result = { ...item };
  const distance = numberOr(result.rad ?? result.distance, 0);
  if (distance <= 0 || distance > 15) result.rad = MELEE_DEFAULT_DISTANCE;
  const angle = Number(result.ang ?? result.angle);
  if (!Number.isFinite(angle) || angle <= 0 || angle > Math.PI) result.ang = MELEE_DEFAULT_ANGLE;
  return result;
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

function clientSafeWeaponDeviation(deviation, weaponType) {
  const value = Math.max(0, numberOr(deviation, 0));
  // Active ShotController treats zero deviation on handguns, machine guns and gatlings as a cheat path
  // and returns before SendShot(), so accuracy bonuses must not serialize these weapons as perfectly accurate.
  return (weaponType === 3 || weaponType === 4 || weaponType === 6) ? Math.max(1, value) : value;
}

function weaponRapidityForProfile(item = {}, fallback = {}, profile = null) {
  const rapidity = weaponRapidity(item, fallback);
  return Math.max(70, shotIntervalMsForProfileRapidity(rapidity, profile) - 10);
}

function shotIntervalMsFromRapidity(rapidity) {
  const shotTimeMs = numberOr(rapidity, 100) + 10;
  return shotTimeMs < 100 ? 110 : shotTimeMs;
}

function rapidityBonusPercent(profile = null) {
  const stats = playerRuntimeStats(profile);
  return clampNumber(stats.modifiers.weaponRapidityPercent ?? 0, 0, 80);
}

function shotIntervalMsForProfileRapidity(rapidity, profile = null) {
  const base = shotIntervalMsFromRapidity(rapidity);
  const rapidityPercent = rapidityBonusPercent(profile);
  return Math.max(80, Math.round(base * (100 - rapidityPercent) / 100));
}

function rapidityDeltaForWeapon(profile = null, rapidity = 0) {
  const base = shotIntervalMsFromRapidity(rapidity);
  return shotIntervalMsForProfileRapidity(rapidity, profile) - base;
}

function reloadDurationMsFromRaw(reloadTimeMs) {
  const reloadMs = numberOr(reloadTimeMs, 0) + 10;
  return reloadMs < 100 ? 110 : reloadMs;
}

const WEAPON_MODE = Object.freeze({
  READY: "ready",
  RELOADING: "reloading",
  RELOADING_READY: "reloading_ready",
  CHANGING: "changing",
  SHOOTING: "shooting",
  LAUNCHING: "launching",
});

const WEAPON_CHANGE_DURATION_MS = 300;
const DEFAULT_WEAPON_LAUNCH_DURATION_MS = 1500;
const FAST_GATLING_LAUNCH_DURATION_MS = 400;
const MELEE_DELAYED_SHOT_MS = 200;
const MELEE_DELAYED_SHOT_GRACE_MS = 350;
const PROJECTILE_IMPACT_GRACE_MS = 5000;
const PROJECTILE_SHOT_MAX_AGE_MS = 120000;
const MAX_ACTIVE_PROJECTILE_SHOTS = 32;
const ACTIVE_ITEM_SHOT_GRACE_MS = 5000;
const ACTIVE_ITEM_SHOT_MAX_AGE_MS = 180000;
const MAX_ACTIVE_ITEM_SHOTS = 64;
const TURRET_SHOT_WARMUP_MS = 2000;
const TURRET_SHOT_INTERVAL_MS = 250;
const TURRET_SHOT_TIMER_GRACE_MS = 150;

const LAUNCH_MODE = Object.freeze({
  SHOT: 0,
  LAUNCH: 1,
  BLOW: 2,
  TURRET_SHOT: 3,
  TURRET_CONTROL: 4,
  SPIN: 5,
  DISACTIVATE: 6,
});

const ACTIVE_MINE_WEAPON_TYPES = new Set([103, 104, 105, 106, 107]);
const ACTIVE_TURRET_WEAPON_TYPES = new Set([102, 108]);
const ACTIVE_ITEM_WEAPON_TYPES = new Set([
  ...ACTIVE_MINE_WEAPON_TYPES,
  ...ACTIVE_TURRET_WEAPON_TYPES,
]);

function launchDurationMsForSystemName(systemName) {
  return systemName === "GG_M249" || systemName === "GG_FNMAG"
    ? FAST_GATLING_LAUNCH_DURATION_MS
    : DEFAULT_WEAPON_LAUNCH_DURATION_MS;
}

function weaponAdditionalValuesRaw(item = {}) {
  const entries = [];
  const speedPercent = weaponSpeedPercent(item);
  if (speedPercent !== 0) entries.push({ key: rawByte(78), value: rawInt(speedPercent) });
  if (numberOr(item.launch, 0) > 0) entries.push({ key: rawByte(75), value: rawInt(1) });
  if (numberOr(item.shake, 0) > 0) entries.push({ key: rawByte(76), value: rawInt(1) });
  return entries.length ? rawHashtable(entries) : null;
}

function weaponBodyFromItem(item = {}, index = 0, profile = null, options = {}) {
  const fallback = defaultWeaponForSlot(index + 1);
  const slot = weaponSlot({ ...fallback, ...(item || {}) }, index);
  const merged = mergedWeaponForSlot(item, fallback, slot, profile);
  const weaponId = numberOr(merged.w_id ?? merged.id, numberOr(process.env.DEFAULT_WEAPON_ID, fallback.w_id));
  const systemName = normalizeSystemName(merged.sn ?? merged.sname, fallback.sn);
  const maxLoadedAmmo = weaponMaxLoadedAmmo(merged, fallback);
  const maxAmmoReserve = weaponMaxAmmoReserve(merged, fallback);
  const rapidity = weaponRapidityForProfile(merged, fallback, profile);
  const entries = [
    { key: rawByte(99), value: rawString(systemName) },
    { key: rawByte(98), value: rawInt(numberOr(merged.wt, fallback.wt)) },
    { key: rawByte(97), value: rawInt(numberOr(merged.vel, fallback.vel)) },
    { key: rawByte(96), value: rawInt(numberOr(merged.rad, fallback.rad)) },
    { key: rawByte(95), value: rawFloat(numberOr(merged.ang, fallback.ang)) },
    { key: rawByte(94), value: rawInt(rapidity) },
    { key: rawByte(93), value: rawInt(numberOr(merged.rt, fallback.rt)) },
    { key: rawByte(92), value: rawInt(maxLoadedAmmo) },
    { key: rawByte(91), value: rawInt(maxAmmoReserve) },
    { key: rawByte(90), value: rawInt(numberOr(merged.lt, fallback.lt)) },
    { key: rawByte(87), value: rawInt(clientSafeWeaponDeviation(merged.dev ?? fallback.dev, numberOr(merged.wt, fallback.wt))) },
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

  if (options.includeWeaponAdditional !== false) {
    const additional = weaponAdditionalValuesRaw(merged);
    if (additional) entries.push({ key: rawByte(79), value: additional });
  }

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

function isActiveWorkshopWeaponUpgrade(item = {}) {
  if (Number(item?.itype || 0) !== 1 || item?.u_id == null) return false;
  const expiresAt = numberOr(item.eD, 0);
  return expiresAt > Math.floor(Date.now() / 1000);
}

function workshopUpgradedWeaponStats(item = {}) {
  const result = { ...item };
  const ammo = numberOr(result.ammo, 0);
  const ammoTotal = numberOr(result.ammo_tot, 0);
  result.rap = Math.max(60, Math.round(numberOr(result.rap, 100) * 0.9));
  result.dev = Math.max(0, Math.round(numberOr(result.dev, 0) * 0.9));
  result.krit = numberOr(result.krit, 0) + 2;
  result.smindam = Math.max(0, Math.round(numberOr(result.smindam, 0) * 1.1));
  result.smaxdam = Math.max(result.smindam, Math.round(numberOr(result.smaxdam, 0) * 1.1));
  result.mmindam = Math.max(0, Math.round(numberOr(result.mmindam, 0) * 1.1));
  result.mmaxdam = Math.max(result.mmindam, Math.round(numberOr(result.mmaxdam, 0) * 1.1));
  result.lmindam = Math.max(0, Math.round(numberOr(result.lmindam, 0) * 1.1));
  result.lmaxdam = Math.max(result.lmindam, Math.round(numberOr(result.lmaxdam, 0) * 1.1));
  result.ammo_tot = ammoTotal > 0 ? Math.max(ammo, Math.round(ammoTotal * 1.1)) : ammoTotal;
  return result;
}

function inventoryWeaponForBattle(item = {}, baseWeaponsById = new Map()) {
  if (item?.u_id == null || isActiveWorkshopWeaponUpgrade(item)) return item;
  return baseWeaponsById.get(itemId(item)) || item;
}

function selectedWeapons(profile) {
  if (!profile) return null;
  const defaultWeapons = profile.defaultWeapons || [];
  const catalogWeapons = profile.catalogWeapons || [];
  const baseWeaponsById = new Map([...defaultWeapons, ...catalogWeapons].map((item) => [itemId(item), item]));
  const inventoryWeapons = (profile.inventory || [])
    .filter((item) => Number(item.itype) === 1)
    .map((item) => inventoryWeaponForBattle(item, baseWeaponsById));
  const weapons = [
    ...defaultWeapons,
    ...catalogWeapons,
    ...inventoryWeapons,
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

function selectedWeaponUpgradeSummary(profile) {
  const upgraded = (selectedWeapons(profile) || []).filter((item) => isActiveWorkshopWeaponUpgrade(item));
  if (!upgraded.length) return "none";
  return upgraded
    .map((item) => `${weaponSlot(item)}:${itemId(item)}:${stringOr(item.sn ?? item.sname, "")}:u=${numberOr(item.u_id, 0)}:eD=${numberOr(item.eD, 0)}`)
    .join(",");
}

function profileWeaponSelectionSummary(weap = {}) {
  return Array.from({ length: 7 }, (_, index) => {
    const slot = index + 1;
    return `${slot}:${numberOr(weap?.[`id${slot}`], 0)}`;
  }).join(",");
}

function selectedWeaponLoadoutSummary(profile) {
  const selected = selectedWeapons(profile) || [];
  if (!selected.length) return "none";
  return selected
    .map((item) => `${weaponSlot(item)}:${itemId(item)}:${stringOr(item.sn ?? item.sname, "")}`)
    .join(",");
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
  const byId = new Map();
  for (const item of profile.catalogWears || []) {
    const id = itemId(item);
    if (id > 0) byId.set(id, item);
  }
  for (const item of (profile.inventory || []).filter((entry) => Number(entry.itype) === 3)) {
    const id = itemId(item);
    if (id <= 0) continue;
    const catalogItem = byId.get(id) || {};
    byId.set(id, {
      ...catalogItem,
      ...item,
      name: item.name ?? catalogItem.name,
      desc: item.desc ?? catalogItem.desc,
      desca: item.desca ?? item.descAdditional ?? item.da ?? catalogItem.desca ?? catalogItem.descAdditional ?? catalogItem.da,
      descAdditional: item.descAdditional ?? item.desca ?? item.da ?? catalogItem.descAdditional ?? catalogItem.desca ?? catalogItem.da,
    });
  }
  const selected = [];
  for (const [viewKey, wearType] of WEAR_VIEW_KEYS) {
    const selectedId = numberOr(profile.view?.[viewKey], 0);
    const item = selectedId > 0 ? byId.get(selectedId) : null;
    if (item) selected.push({ item, wearType });
  }
  return selected;
}

function selectedWearSummary(profile) {
  const selected = selectedWears(profile);
  if (!selected.length) return "none";
  return selected
    .map(({ item, wearType }) => `${wearType}:${itemId(item) || 0}:${stringOr(item.sn ?? item.sname, "")}`)
    .join(",");
}

function tauntItemId(item = {}) {
  return numberOr(item.t_id ?? item.id, 0);
}

function tauntExpiresAt(item = {}) {
  return numberOr(item.eD ?? item.ed ?? item.expiresAt, 0);
}

function isInventoryTauntActive(item = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = tauntExpiresAt(item);
  return expiresAt <= 0 || expiresAt > nowSeconds;
}

function selectedTaunts(profile) {
  if (!profile) return [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const owned = new Set();
  for (const item of profile.inventory || []) {
    if (Number(item.itype) !== 4) continue;
    if (!isInventoryTauntActive(item, nowSeconds)) continue;
    const tauntId = tauntItemId(item);
    if (tauntId > 0) owned.add(tauntId);
  }

  const selected = [];
  for (let slot = 0; slot < 3; slot += 1) {
    const tauntId = numberOr(profile.taun?.[`i${slot}`], 0);
    if (tauntId > 0 && (tauntId === 1 || owned.has(tauntId))) {
      selected.push({ slot, tauntId });
    }
  }
  return selected;
}

function selectedTauntSummary(profile) {
  const selected = selectedTaunts(profile);
  if (!selected.length) return "none";
  return selected.map(({ slot, tauntId }) => `${slot}:${tauntId}`).join(",");
}

function enhancerTypeId(item = {}) {
  return numberOr(item.e_id ?? item.eid ?? item.id, 0);
}

function enhancerExpiresAt(item = {}) {
  return numberOr(item.eD ?? item.ed ?? item.expiresAt, 0);
}

function isInventoryEnhancerActive(item = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = enhancerExpiresAt(item);
  return expiresAt <= 0 || expiresAt > nowSeconds;
}

function selectedEnhancers(profile) {
  if (!profile) return [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const byType = new Map();
  for (const item of profile.inventory || []) {
    if (Number(item.itype) !== 2) continue;
    const enhancerType = enhancerTypeId(item);
    if (!PASSIVE_BATTLE_ENHANCER_IDS.has(enhancerType)) continue;
    if (!isInventoryEnhancerActive(item, nowSeconds)) continue;
    if (!byType.has(enhancerType)) byType.set(enhancerType, item);
  }
  return Array.from(byType.entries())
    .sort(([left], [right]) => left - right)
    .map(([enhancerType, item]) => ({ enhancerType, item }));
}

function selectedEnhancerSummary(profile) {
  const selected = selectedEnhancers(profile);
  if (!selected.length) return "none";
  return selected
    .map(({ enhancerType, item }) => `${enhancerType}:${itemId(item) || 0}:${stringOr(item.sn ?? item.sname ?? item.name, "")}:eD=${enhancerExpiresAt(item)}`)
    .join(",");
}

function weaponCanonicalKey(item = {}) {
  return stringOr(item.sn ?? item.sname, "").toLowerCase();
}

function weaponImpactDefinition(item = {}) {
  const id = itemId(item);
  const key = weaponCanonicalKey(item);
  const base = IMPACT_DOT_BY_WEAPON_ID.get(id) || IMPACT_DOT_BY_WEAPON_KEY.get(key) || null;
  if (!isActiveWorkshopWeaponUpgrade(item)) return base;

  const workshopType = String(item.workshopImpactType || "").toLowerCase();
  const type = ({
    fire: IMPACT_TYPE.FIRE,
    blood: IMPACT_TYPE.BLOOD,
    poison: IMPACT_TYPE.POISON,
    frost: IMPACT_TYPE.FROST,
  })[workshopType] ?? base?.type ?? IMPACT_TYPE.NONE;
  if (type === IMPACT_TYPE.NONE) return base;

  const source = base || { type, min: 3, max: 5, ticks: IMPACT_DOT_DEFAULT_TICKS };
  const damageMultiplier = 1 + Math.max(0, numberOr(item.workshopImpactDamagePercent, 0)) / 100;
  return {
    ...source,
    type,
    min: Math.max(1, Math.round(numberOr(source.min, 3) * damageMultiplier)),
    max: Math.max(1, Math.round(numberOr(source.max, source.min ?? 5) * damageMultiplier)),
    ticks: Math.max(1, numberOr(source.ticks, IMPACT_DOT_DEFAULT_TICKS) + Math.max(0, numberOr(item.workshopImpactTicksBonus, 0))),
  };
}

function weaponImpactType(item = {}) {
  return weaponImpactDefinition(item)?.type ?? IMPACT_TYPE.NONE;
}

function impactTypeName(impactType) {
  if (impactType === IMPACT_TYPE.FIRE) return "Fire";
  if (impactType === IMPACT_TYPE.BLOOD) return "Blood";
  if (impactType === IMPACT_TYPE.POISON) return "Poison";
  if (impactType === IMPACT_TYPE.FROST) return "Frost";
  return "None";
}

function wearBonusKey(selectedWear) {
  const item = selectedWear?.item || {};
  const wearType = numberOr(item.wt, selectedWear?.wearType ?? 0);
  const systemName = stringOr(item.sn ?? item.sname, "").toLowerCase();
  return `${wearType}:${systemName}`;
}

// Generated 1:1 from the active client TextAsset wear_*_desca entries.
// The final spread below deliberately makes this UTF-8 client table authoritative.
const CLIENT_WEAR_BONUS_TEXTS = require("./wear-bonus-texts.json");
/* Historical malformed literals retained only as a migration reference; never evaluated.
  ...CLIENT_WEAR_BONUS_TEXTS,
  // "Прохладник" (Стужа) keeps its own armor bonus even when the full set is incomplete.
  // Recovered from the active client TextAsset: wear_Shirts_santa2_desca = "Броня +17".
  "4:santa2": "Броня +17",
  "6:boot02": "+3% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+3% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakolimpic": "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\nР—Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ +3%",
  "6:tacticalb01": "+1% Рє СЃРєРѕСЂРѕСЃС‚Рё РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\nР’С‹С€Рµ СЃСЂРµРґРЅРµРіРѕ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakv2b05": "+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nР’С‹С€Рµ СЃСЂРµРґРЅРµРіРѕ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakv2b02": "Р’С‹С€Рµ СЃСЂРµРґРЅРµРіРѕ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakv2b06": "+2% Рє СЃРєРѕСЂРѕСЃС‚Рё РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\n+1% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\nР’С‹С€Рµ СЃСЂРµРґРЅРµРіРѕ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakv2b03": "+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  "6:sneakv2b04": "+3% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё",
  "6:infernal": "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\n+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё",
  "6:franky": "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\n+4% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ",
  "6:sneakv2b10": "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\n+2% Рє СЃРєРѕСЂРѕСЃС‚Рё\n+3% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ",
  "6:anarch": "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\n+5% Рє СЃРєРѕСЂРѕСЃС‚Рё",
  "6:avenger": "+3% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:zadira": "+4% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:prizrak": "+1% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+3% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:sneakv201": "+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+8% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:business": "+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+3% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:stalker": "+10% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+2% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:thanos": "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  "6:slip99": "+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+4% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+40% Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°",
  // The active-client UTF-8 table is authoritative. This final spread also prevents
  // legacy mojibake overrides above from masking valid item bonuses.
  ...CLIENT_WEAR_BONUS_TEXTS,
*/
const RESTORED_WEAR_BONUS_TEXTS = new Map(Object.entries(CLIENT_WEAR_BONUS_TEXTS));

const SHOTGUN_JUMP_PERCENT_BY_BOOT = new Map(Object.entries({
  "6:sneak02": 5,      // Р¤РѕСЂРµСЃС‚
  "6:slip01": 5,       // РўР°СЂР°РєР°РЅСЊСЏ СЃРјРµСЂС‚СЊ
  "6:boot01": 5,       // Р‘РµСЂС†С‹
  "6:sneakv202": 10,   // РЁРЅСѓСЂ
  "6:sneakv203": 10,   // РџСЂС‹РіСѓРЅ
  "6:sneakolimpic": 15, // Р›РµРіРєРѕСЃС‚СѓРї
  "6:skeleton": 15,    // РЎРјРµСЂС‚РѕС…РѕРґС‹
  "6:santa": 15,       // РЎР°РЅРёСЂР°Р№РґРµСЂС‹
  "6:bear": 15,        // РњРµРґРІРµРґРѕР»Р°РїС‹
  "6:tacticalb01": 15, // Р”РµР»СЊС‚РѕРІРёРєРё
  "6:tactical01": 15,  // РђСЂРјРµР№С†С‹
  "6:tactical02": 15,  // РЎРІРµСЂС…РїСЂРѕС…РѕРґРёРјРµС†
  "6:sneakv2b06": 16,  // РљРёСЃР»РѕС…РѕРґС‹
  "6:sneakv2b10": 16,  // Р›Р°Р№РјР°Р±СѓС‚СЃС‹
  "6:santa2": 16,      // РўСЂРµСЃРєСѓРЅС‹
  "6:sneakv2b05": 17,  // РљСЂРѕСЃС‹
  "6:mummy": 17,       // РџРµСЃРєРѕС…РѕРґС‹
  "6:infernal": 17,    // РҐРѕРґСЏС‰РёРµ РїРѕ СѓРіР»СЏРј
  "6:franky": 17,      // Р•РґРёРЅРµРЅРёРµ СЃ РїРѕС‡РІРѕР№
  "6:boot02": 17,      // РўР°РЅР¶РµСЂС‹
  "6:anarch": 20,      // РљРµРґРѕРЅС‹
  "6:avenger": 20,     // РЎРёРЅСЊР”РёРєР°С‚С‹
  "6:slip99": 40,      // РЁР»РµРїР°РЅС‹
}));

function restoredWearBonusText(selectedWear) {
  const fallback = RESTORED_WEAR_BONUS_TEXTS.get(wearBonusKey(selectedWear));
  if (!fallback) return "";
  const item = selectedWear?.item || {};
  const existing = stringOr(item.desca ?? item.descAdditional ?? item.da, "");
  return existing.trim() ? "" : fallback;
}

function wearWithRestoredBonusText(selectedWear) {
  const fallback = restoredWearBonusText(selectedWear);
  if (!fallback) return selectedWear?.item || {};
  return { ...(selectedWear?.item || {}), desca: fallback, descAdditional: fallback };
}

function shotgunJumpPercentForWear(selectedWear) {
  return numberOr(SHOTGUN_JUMP_PERCENT_BY_BOOT.get(wearBonusKey(selectedWear)), 0);
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

function addProtectionBonus(target, key, amount) {
  if (!key) return;
  target[key] = numberOr(target[key], 0) + numberOr(amount, 0);
}

const WEAR_PROTECTION_TERMS = [
  { key: "automatic", pattern: /автомат/ },
  { key: "machinegun", pattern: /пулем/ },
  { key: "pistol", pattern: /пистолет/ },
  { key: "shotgun", pattern: /дробов/ },
  { key: "sniper", pattern: /снайпер|анаконд/ },
  { key: "rocket", pattern: /ракет|троллебуз/ },
  { key: "grenade", pattern: /гранатом|гранатин/ },
  { key: "snow", pattern: /ледом|снегом/ },
  { key: "flamer", pattern: /огнем|поджига/ },
  { key: "melee", pattern: /ближнего\s+боя|ручн|лезви/ },
];

const ALL_WEAR_PROTECTION_KEYS = WEAR_PROTECTION_TERMS.map((term) => term.key);
const ALL_DAMAGE_RANGES = ["short", "medium", "long"];
const WEAR_DAMAGE_TERMS = [
  { types: [4], pattern: /автомат/ },
  { types: [6], pattern: /пулем/ },
  { types: [3], pattern: /пистолет/ },
  { types: [7], pattern: /дробов/ },
  { types: [10], pattern: /снайпер|анаконд/ },
  { types: [8], pattern: /ракет|троллебуз/ },
  { types: [9, 15], pattern: /гранатом|гранатин/ },
  { types: [11], pattern: /ледом|снегом/ },
  { types: [5], pattern: /огнем/ },
  { types: [1, 2], pattern: /ближнего\s+боя|ручн|лезви/ },
];

function protectionKeyFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  return WEAR_PROTECTION_TERMS.find((term) => term.pattern.test(normalized))?.key || "";
}

function protectionKeysFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  if (/всех\s+типов\s+(?:оруж|оруд)/.test(normalized)) return ALL_WEAR_PROTECTION_KEYS;
  const keys = WEAR_PROTECTION_TERMS
    .filter((term) => term.pattern.test(normalized))
    .map((term) => term.key);
  return Array.from(new Set(keys));
}

function damageTypesFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  const types = new Set();
  for (const term of WEAR_DAMAGE_TERMS) {
    if (!term.pattern.test(normalized)) continue;
    for (const type of term.types) types.add(type);
  }
  return Array.from(types);
}

function damageRangeFromText(text) {
  const normalized = stringOr(text, "").toLowerCase();
  if (/ближн/.test(normalized)) return "short";
  if (/средн|сред\./.test(normalized)) return "medium";
  if (/дальн/.test(normalized)) return "long";
  return "";
}

function addWearProtectionBonuses(modifiers, keys, amount, range = "") {
  const value = numberOr(amount, 0);
  if (value === 0 || !keys.length) return;
  if (range) {
    if (!modifiers.rangeProtections) modifiers.rangeProtections = { short: {}, medium: {}, long: {} };
    if (!modifiers.rangeProtections[range]) modifiers.rangeProtections[range] = {};
    for (const key of keys) addProtectionBonus(modifiers.rangeProtections[range], key, value);
    return;
  }
  for (const key of keys) addProtectionBonus(modifiers.protections, key, value);
}

function applyWearProtectionBonuses(modifiers, text) {
  let rangeContext = "";
  let protectionList = false;
  for (const rawLine of stringOr(text, "").toLowerCase().split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) {
      protectionList = false;
      continue;
    }

    const lineRange = damageRangeFromText(line);
    if (/защит/.test(line) && lineRange) rangeContext = lineRange;
    if (/защит.*от\s*:/.test(line)) {
      protectionList = true;
      continue;
    }

    const prefixMatch = line.match(/([+-]?\d+)\s*%\s*защит[аы]?\s+от\s+(.+)/);
    if (prefixMatch) {
      addWearProtectionBonuses(modifiers, protectionKeysFromText(prefixMatch[2]), prefixMatch[1], lineRange);
      continue;
    }

    const suffixMatch = line.match(/защит[аы]?\s+от\s+(.+?)\s*([+-]?\d+)\s*%/);
    if (suffixMatch) {
      addWearProtectionBonuses(modifiers, protectionKeysFromText(suffixMatch[1]), suffixMatch[2], lineRange);
      continue;
    }

    if (protectionList) {
      const listMatch = line.match(/(.+?)\s*([+-]?\d+)\s*%/);
      if (listMatch) {
        addWearProtectionBonuses(modifiers, protectionKeysFromText(listMatch[1]), listMatch[2], rangeContext);
      }
    }
  }
}

function addWearDamageBonuses(modifiers, types, ranges, amount) {
  const value = numberOr(amount, 0);
  if (value <= 0 || !types.length || !ranges.length) return;
  for (const range of ranges) {
    modifiers.damageBonuses.push({ types, range, amount: value });
  }
}

function applyWearDamageBonuses(modifiers, text) {
  let rangeContext = "";
  let protectionList = false;
  for (const rawLine of stringOr(text, "").toLowerCase().split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) {
      protectionList = false;
      continue;
    }
    if (/защит.*от\s*:/.test(line)) {
      protectionList = true;
      continue;
    }
    if (/защит/.test(line)) continue;
    if (protectionList && !/урон/.test(line)) continue;
    if (/урон/.test(line)) protectionList = false;

    const lineRange = damageRangeFromText(line);
    if (/урон\s+на\s+/.test(line) && lineRange) rangeContext = lineRange;

    const amountMatch = line.match(/\+(\d+)\s*%?/);
    if (!amountMatch) continue;

    const types = damageTypesFromText(line);
    if (!types.length) continue;

    const ranges = lineRange ? [lineRange] : (rangeContext ? [rangeContext] : ALL_DAMAGE_RANGES);
    addWearDamageBonuses(modifiers, types, ranges, amountMatch[1]);
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

function formatRangeProtectionBonuses(rangeProtections = {}) {
  const entries = [];
  for (const range of ALL_DAMAGE_RANGES) {
    for (const [key, value] of Object.entries(rangeProtections?.[range] || {})) {
      if (numberOr(value, 0) !== 0) entries.push(`${range}.${key}:${value}`);
    }
  }
  return entries.length ? entries.sort().join(",") : "none";
}

function formatDamageBonuses(bonuses = []) {
  const entries = bonuses
    .map((bonus) => `${bonus.range}:${(bonus.types || []).join("+")}:${numberOr(bonus.amount, 0)}`)
    .filter((entry) => !entry.endsWith(":0"))
    .sort();
  return entries.length ? entries.join(",") : "none";
}

function applyWearTextBonuses(modifiers, item = {}, options = {}) {
  const text = decodeLegacyBonusText(item.desca ?? item.descAdditional ?? item.da).toLowerCase();
  if (!text) return;

  applyWearProtectionBonuses(modifiers, text);
  applyWearDamageBonuses(modifiers, text);
  applyJumpPercentBonuses(modifiers, text);

  for (const match of text.matchAll(/\+(\d+)\s*%\s*(?:к\s*)?здоров(?:ью|ья|ье)?/g)) {
    modifiers.healthPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/здоров(?:ье|ью|ья)?[ \t]*\+(\d+)[ \t]*%/g)) {
    modifiers.healthPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/жизн[ьи][ \t]*\+(\d+)[ \t]*%/g)) {
    modifiers.healthPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*%\s*(?:к\s*)?жизн[ьи]/g)) {
    modifiers.healthPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*к\s*здоров(?:ью|ья|ье)?/g)) {
    modifiers.healthFlat += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*%\s*к\s*скорости/g)) {
    modifiers.speedPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*%\s*к\s*брон[еия]/g)) {
    modifiers.armorPercent += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/\+(\d+)\s*к\s*броне/g)) {
    modifiers.armorFlat += numberOr(match[1], 0);
  }
  for (const match of text.matchAll(/брон[яе][ \t]*\+(\d+)/g)) {
    modifiers.armorFlat += numberOr(match[1], 0);
  }
  if (!options.suppressShotgunJump) {
    modifiers.shotgunJumpBonus += shotgunJumpBonusFromText(text);
  }
}

function gameplayModifiersForProfile(profile = null) {
  const modifiers = {
    healthFlat: 0,
    healthPercent: 0,
    healthFloor: 0,
    armorFlat: 0,
    armorPercent: 0,
    damageReductionPercent: 0,
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
    weaponHeadDamagePercent: 0,
    weaponAccuracyFlat: 0,
    weaponAmmoPercent: 0,
    weaponMinDamageFlat: 0,
    weaponMaxDamageFlat: 0,
    damageBonuses: [],
    protections: {},
    rangeProtections: { short: {}, medium: {}, long: {} },
    completedSets: [],
  };

  for (const [abilityIdText, bonus] of Object.entries(ABILITY_BONUS_LEVELS)) {
    const level = abilityLevel(profile, Number(abilityIdText));
    if (level <= 0) continue;
    const index = level - 1;
    modifiers.healthFlat += numberOr(bonus.healthFlat?.[index], 0);
    modifiers.armorFlat += numberOr(bonus.armorFlat?.[index], 0);
    modifiers.damageReductionPercent += numberOr(bonus.damageReductionPercent?.[index], 0);
    modifiers.speedPercent += numberOr(bonus.speedPercent?.[index], 0);
    modifiers.weaponSpeedPercent += numberOr(bonus.weaponSpeedPercent?.[index], 0);
    modifiers.weaponRapidityPercent += numberOr(bonus.weaponRapidityPercent?.[index], 0);
    modifiers.weaponCritPercent += numberOr(bonus.weaponCritPercent?.[index], 0);
    modifiers.weaponHeadDamagePercent += numberOr(bonus.weaponHeadDamagePercent?.[index], 0);
    modifiers.weaponAccuracyFlat += numberOr(bonus.weaponAccuracyFlat?.[index], 0);
    modifiers.weaponAmmoPercent += numberOr(bonus.weaponAmmoPercent?.[index], 0);
    modifiers.weaponMinDamageFlat += numberOr(bonus.weaponMinDamageFlat?.[index], 0);
    modifiers.weaponMaxDamageFlat += numberOr(bonus.weaponMaxDamageFlat?.[index], 0);
  }

  const selectedWearList = selectedWears(profile);
  for (const selectedWear of selectedWearList) {
    const shotgunJumpPercent = shotgunJumpPercentForWear(selectedWear);
    applyWearTextBonuses(modifiers, wearWithRestoredBonusText(selectedWear), {
      suppressShotgunJump: shotgunJumpPercent > 0,
    });
    modifiers.jumpPercent += shotgunJumpPercent;
  }

  const selectedWearKeys = new Set(selectedWearList.map(wearBonusKey));
  for (const definition of RESTORED_SET_BONUS_DEFINITIONS) {
    if (!definition.required.every((key) => selectedWearKeys.has(key))) continue;
    modifiers.completedSets.push(definition.id);
    if (definition.bonusText) applyWearTextBonuses(modifiers, { desca: definition.bonusText });
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
    for (const range of ALL_DAMAGE_RANGES) {
      addProtectionBonuses(modifiers.rangeProtections[range], definition.rangeProtections?.[range]);
    }
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

  const critPercent = numberOr(modifiers.weaponCritPercent, 0);
  if (critPercent > 0) {
    result.krit = numberOr(result.krit, 0) + critPercent;
  }

  const accuracyFlat = numberOr(modifiers.weaponAccuracyFlat, 0);
  if (accuracyFlat > 0) {
    result.dev = clientSafeWeaponDeviation(
      Math.round(numberOr(result.dev, 0) - accuracyFlat),
      weaponType
    );
  }

  const movementSpeedPercentBonus = numberOr(modifiers.speedPercent, 0);
  const weaponSpeedPercentBonus = numberOr(modifiers.weaponSpeedPercent, 0);
  const totalSpeedPercentBonus = movementSpeedPercentBonus + weaponSpeedPercentBonus;
  if (totalSpeedPercentBonus !== 0) {
    result.wsp = Math.round(weaponSpeedPercent(result) + totalSpeedPercentBonus);
  }

  return result;
}

function mergedWeaponForSlot(item = {}, fallback = {}, slot = 1, profile = null) {
  const base = { ...fallback, ...(item || {}), ws: slot };
  const override = WEAPON_STAT_OVERRIDES[weaponCanonicalKey(base)];
  const mergedBase = override
    ? { ...base, ...override, ws: slot, w_id: numberOr(override.w_id, base.w_id ?? base.id), id: numberOr(override.id, base.id ?? base.w_id) }
    : base;
  // The API persists the complete upgraded weapon payload. While eD is active,
  // those exact fields win over canonical base stats once and are not regenerated.
  const merged = isActiveWorkshopWeaponUpgrade(base)
    ? {
        ...mergedBase,
        ...base,
        ws: slot,
        w_id: numberOr(mergedBase.w_id, base.w_id ?? base.id),
        id: numberOr(mergedBase.id, base.id ?? base.w_id),
      }
    : mergedBase;
  return normalizeMeleeWeaponStats(applyWeaponGameplayBonuses(merged, profile));
}

function playerRuntimeStats(profile = null) {
  const modifiers = gameplayModifiersForProfile(profile);
  const baseHealth = Number(process.env.DEFAULT_PLAYER_HEALTH || 100);
  const baseEnergy = Math.max(0, numberOr(process.env.DEFAULT_PLAYER_ENERGY, 0));
  const baseSpeed10 = Number(process.env.DEFAULT_PLAYER_SPEED10 || 100);
  const baseJump = Number(process.env.DEFAULT_PLAYER_JUMP || 15);
  const calculatedHealth = Math.round((baseHealth + modifiers.healthFlat) * (1 + modifiers.healthPercent / 100));
  const maxHealth = Math.max(1, calculatedHealth, numberOr(modifiers.healthFloor, 0));
  const maxEnergy = Math.min(MAX_PLAYER_ENERGY, Math.max(0, Math.round((baseEnergy + modifiers.armorFlat) * (1 + modifiers.armorPercent / 100))));
  const baseClientSpeed = Math.max(1, Math.floor(baseSpeed10 / 10));
  // ActorInfo[95] is integer client speed; exact movement percents are emitted through weapon [79][78].
  const rawClientSpeed = baseClientSpeed + modifiers.clientSpeedBonus;
  const roundedClientSpeed = Math.round(rawClientSpeed);
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

function makeWeaponDictionaryRaw(profile = null, slotLimit = JOIN_LOADOUT_SLOT_LIMIT, options = {}) {
  const allSlots = weaponSlotsForProfile(profile);
  const normalizedLimit = Math.max(1, Math.min(7, Number(slotLimit || JOIN_LOADOUT_SLOT_LIMIT)));
  const joinSlots = allSlots.slice(0, normalizedLimit);
  if (options.logCompact !== false && joinSlots.length < allSlots.length) {
    console.log(`[loadout] compact join slots=${joinSlots.map(([slot]) => slot).join(",")} of=${allSlots.length} limit=${normalizedLimit}`);
  }

  return rawTypedDictionary(0x69, 0x68, joinSlots.map(([slot, item]) => ({
    keyBody: i32(slot - 1),
    valueBody: weaponBodyFromItem(item, slot - 1, profile, options),
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
    ]),
  })));
}

function makeEnhancerDictionaryRaw(profile = null) {
  const selected = selectedEnhancers(profile);
  if (!selected.length) return null;
  // CombatPlayer.ContainsEnhancer() only checks ActorInfo[108] dictionary keys.
  return rawTypedDictionary(0x62, 0x68, selected.map(({ enhancerType }) => ({
    keyBody: Buffer.from([enhancerType & 0xff]),
    valueBody: rawHashtableBody([]),
  })));
}

function makeTauntDictionaryRaw(profile = null) {
  const selected = selectedTaunts(profile);
  if (!selected.length) return null;
  // CombatPlayer.Init() casts ActorInfo[106] to Dictionary<int, int>.
  return rawTypedDictionary(0x69, 0x69, selected.map(({ slot, tauntId }) => ({
    keyBody: i32(slot),
    valueBody: i32(tauntId),
  })));
}

function makeWeaponRuntimeState(profile = null) {
  const states = new Map();
  for (const [slot, item] of weaponSlotsForProfile(profile)) {
    const fallback = defaultWeaponForSlot(slot);
    const merged = mergedWeaponForSlot(item, fallback, slot, profile);
    const maxLoadedAmmo = weaponMaxLoadedAmmo(merged, fallback);
    const maxAmmoReserve = weaponMaxAmmoReserve(merged, fallback);
    const rapidity = weaponRapidityForProfile(merged, fallback, profile);
    const reloadTimeMs = numberOr(merged.rt, fallback.rt ?? 0);
    const impact = weaponImpactDefinition(merged);
    states.set(slot, {
      slot,
      index: slot - 1,
      weaponId: numberOr(merged.w_id ?? merged.id, fallback.w_id ?? fallback.id),
      type: numberOr(merged.wt, fallback.wt),
      workshopExpiresAt: isActiveWorkshopWeaponUpgrade(merged) ? numberOr(merged.eD, 0) : 0,
      rapidity,
      shotIntervalMs: shotIntervalMsFromRapidity(rapidity),
      nextShotAt: 0,
      weaponMode: WEAPON_MODE.READY,
      modeStartedAt: 0,
      changeDurationMs: WEAPON_CHANGE_DURATION_MS,
      changeUntil: 0,
      launchDurationMs: launchDurationMsForSystemName(normalizeSystemName(merged.sn ?? merged.sname, fallback.sn)),
      shotStartedAt: 0,
      launchStartedAt: 0,
      meleeDelayedShotUntil: 0,
      meleeDelayedShotUsed: false,
      meleeDistance: isColdArmsWeaponType(merged.wt) ? numberOr(merged.rad, MELEE_DEFAULT_DISTANCE) : 0,
      meleeAngle: isColdArmsWeaponType(merged.wt) ? numberOr(merged.ang, MELEE_DEFAULT_ANGLE) : 0,
      activeProjectileShots: new Map(),
      reloadTimeMs,
      reloadDurationMs: reloadDurationMsFromRaw(reloadTimeMs),
      reloadTimer: null,
      reloadSeq: 0,
      reloading: false,
      reloadStartedAt: 0,
      reloadReadyAt: 0,
      reloadFullUntil: 0,
      maxLoadedAmmo,
      maxAmmoReserve,
      loadedAmmo: maxLoadedAmmo,
      ammoReserve: Math.max(0, maxAmmoReserve - maxLoadedAmmo),
      systemName: normalizeSystemName(merged.sn ?? merged.sname, fallback.sn),
      impact,
      impactType: impact?.type ?? IMPACT_TYPE.NONE,
      crit: numberOr(merged.krit, fallback.krit),
      deviation: clientSafeWeaponDeviation(merged.dev ?? fallback.dev, numberOr(merged.wt, fallback.wt)),
      shortDamage: [numberOr(merged.smindam, fallback.smindam), numberOr(merged.smaxdam, fallback.smaxdam)],
      mediumDamage: [numberOr(merged.mmindam, fallback.mmindam), numberOr(merged.mmaxdam, fallback.mmaxdam)],
      longDamage: [numberOr(merged.lmindam, fallback.lmindam), numberOr(merged.lmaxdam, fallback.lmaxdam)],
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

function makeActorInfoRaw(profile = null, options = {}) {
  const stats = playerRuntimeStats(profile);
  const entries = [
    { key: rawByte(100), value: rawInt(stats.maxHealth) },
    { key: rawByte(99), value: rawInt(stats.maxEnergy) },
    { key: rawByte(95), value: rawInt(stats.speed10) },
    { key: rawByte(94), value: makeWeaponDictionaryRaw(profile, options.weaponSlotLimit ?? JOIN_LOADOUT_SLOT_LIMIT, options) },
    { key: rawByte(92), value: rawInt(stats.jump) },
    { key: rawByte(76), value: rawInt(numberOr(profile?.level, Number(process.env.DEFAULT_PLAYER_LEVEL || 1))) },
    { key: rawByte(36), value: rawBool(process.env.DEFAULT_PLAYER_PREMIUM === "1") },
  ];

  if (options.includeActorOptionalFields !== false) {
    const clanId = numberOr(profile?.clan?.cid ?? profile?.clan?.id, 0);
    const clanArmId = numberOr(profile?.clan?.aid ?? profile?.clan?.armId, 0);
    const clanTag = stringOr(profile?.clan?.t ?? profile?.clan?.tag, "");
    if (clanId > 0) entries.push({ key: rawByte(8), value: rawInt(clanId) });
    entries.push(
      { key: rawByte(6), value: rawString(clanTag) },
      { key: rawByte(5), value: rawInt(clanArmId) },
    );
  }

  if (options.includeWears !== false && INCLUDE_JOIN_WEARS) {
    const wears = makeWearDictionaryRaw(profile);
    if (wears) entries.push({ key: rawByte(30), value: wears });
  }

  if (options.includeTaunts !== false) {
    const taunts = makeTauntDictionaryRaw(profile);
    if (taunts) entries.push({ key: rawByte(106), value: taunts });
  }

  if (options.includeEnhancers !== false && INCLUDE_BATTLE_ENHANCERS) {
    const enhancers = makeEnhancerDictionaryRaw(profile);
    if (enhancers) entries.push({ key: rawByte(108), value: enhancers });
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

const RAW_OMIT = Symbol("raw-omit");

function hashtableBodyWithReplacements(parsedHashtable, replacements = new Map()) {
  const entries = [];
  const used = new Set();
  for (const entry of parsedHashtable?.value?.entries || []) {
    const keyValue = entry.key.value;
    if (replacements.has(keyValue)) {
      const rawValue = replacements.get(keyValue);
      if (rawValue !== RAW_OMIT) {
        entries.push({ key: entry.key.raw, value: rawValue });
      }
      used.add(keyValue);
    } else {
      entries.push({ key: entry.key.raw, value: entry.value.raw });
    }
  }
  for (const [keyValue, rawValue] of replacements.entries()) {
    if (used.has(keyValue)) continue;
    if (rawValue === RAW_OMIT) continue;
    entries.push({ key: rawByte(keyValue), value: rawValue });
  }
  return rawHashtableBody(entries);
}

function hashtableRawWithReplacements(parsedHashtable, replacements = new Map()) {
  return rawHashtableFromBody(hashtableBodyWithReplacements(parsedHashtable, replacements));
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
    clan: null,
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

async function profileForJoin(incomingActor, options = {}) {
  const cached = cachedPlayerProfile(incomingActor);
  if (cached && !options.forceRefresh) return { profile: cached, source: "cache" };

  const loading = options.forceRefresh
    ? loadPlayerProfile(incomingActor, { forceRefresh: true }).catch((error) => {
        const { authId } = actorCredentials(incomingActor);
        console.log(`[profile] refresh failed id=${authId} reason=room-join ${error.message}`);
        return cached || fallbackPlayerProfile(incomingActor);
      })
    : warmPlayerProfile(incomingActor, "room-join");
  const joinWaitMs = options.forceRefresh && !ALLOW_FALLBACK_JOIN_PROFILE
    ? JOIN_PROFILE_MAX_WAIT_MS
    : (options.forceRefresh ? Math.max(PROFILE_JOIN_WAIT_MS, JOIN_SELF_PROFILE_WAIT_MS) : PROFILE_JOIN_WAIT_MS);
  if (joinWaitMs > 0) {
    const loaded = await Promise.race([
      loading.then((profile) => (isFallbackBattleProfile(profile) ? null : { profile, source: "loaded" })),
      new Promise((resolve) => setTimeout(() => resolve(null), joinWaitMs)),
    ]);
    if (loaded?.profile) return loaded;
  }

  if (cached) return { profile: cached, source: "cache", pendingProfile: loading };
  return { profile: fallbackPlayerProfile(incomingActor), source: "fallback", pendingProfile: loading };
}

function applyLateProfile(session, profile, incomingActor = null) {
  if (isFallbackBattleProfile(profile)) return;
  session.loadedProfile = profile;
  session.playerId = profile.authId;
  session.playerAuthKey = profile.authKey || session.playerAuthKey || "";
  session.playerName = profile.name;
  session.weaponStates = makeWeaponRuntimeState(profile);
  if (incomingActor) {
    updateActorWireData(session, incomingActor, profile, session.lastChannel || 0);
  }
  removeDuplicatePlayerSessionsFromAllRooms(session, "late-profile-duplicate");
  const stats = playerRuntimeStats(profile);
  if (!session.spawned) {
    session.health = stats.maxHealth;
    session.energy = stats.maxEnergy;
  }
  console.log(`[profile] late ready actor=${session.actorId} id=${profile.authId} name=${profile.name} wears=${selectedWears(profile).length} wearList=${selectedWearSummary(profile)} taunts=${selectedTaunts(profile).length} tauntSlots=${selectedTauntSummary(profile)} enhancers=${selectedEnhancers(profile).length} enhancerList=${selectedEnhancerSummary(profile)} joinProfile=${session.joinActorProfile || "n/a"} joinHasWears=${session.joinActorHasWears ? "yes" : "no"} joinHasEnhancers=${session.joinActorHasEnhancers ? "yes" : "no"} peerProfile=${session.peerActorProfile || "n/a"} peerHasWears=${session.peerActorHasWears ? "yes" : "no"} peerHasEnhancers=${session.peerActorHasEnhancers ? "yes" : "no"} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} armorPct=${stats.modifiers.armorPercent} dmgRedPct=${stats.modifiers.damageReductionPercent} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponSpeedPct=${stats.modifiers.weaponSpeedPercent} weaponRapidityPct=${stats.modifiers.weaponRapidityPercent} weaponHeadDmgPct=${stats.modifiers.weaponHeadDamagePercent} weaponAccuracyFlat=${stats.modifiers.weaponAccuracyFlat} ammoPct=${stats.modifiers.weaponAmmoPercent} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} jumpCap=${stats.jumpCap} prot=${formatProtectionBonuses(stats.modifiers.protections)} rangeProt=${formatRangeProtectionBonuses(stats.modifiers.rangeProtections)} wearDmg=${formatDamageBonuses(stats.modifiers.damageBonuses)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump}`);
}

async function fetchApiJson(path) {
  if (!API_BASE_URL || typeof fetch !== "function") return null;
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`status=${response.status}`);
  return response.json();
}

async function postApiJson(path, body) {
  if (!API_BASE_URL || typeof fetch !== "function") return null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(API_TOKEN ? { "x-battle-token": API_TOKEN } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) throw new Error(`status=${response.status}`);
  return response.json();
}

async function loadShopCatalog(query, options = {}) {
  if (!options.forceRefresh && (shopCatalogCache.weapons.length || shopCatalogCache.wears.length) && Date.now() - shopCatalogCache.loadedAt < CATALOG_CACHE_TTL_MS) {
    return shopCatalogCache;
  }

  const payload = await fetchApiJson(`/ajax.php?page=shop&act=items&${query}`);
  const weapons = Array.isArray(payload?.weap?.items) ? payload.weap.items : [];
  const wears = Array.isArray(payload?.wear?.items) ? payload.wear.items : [];
  shopCatalogCache = { loadedAt: Date.now(), weapons, wears };
  return shopCatalogCache;
}

async function loadPlayerProfile(incomingActor, options = {}) {
  const { authId, authKey } = actorCredentials(incomingActor);
  const cacheKey = `${authId}:${authKey}`;
  const cached = profileCache.get(cacheKey);
  if (!options.forceRefresh && cached && Date.now() - cached.loadedAt < PROFILE_CACHE_TTL_MS) {
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
      loadShopCatalog(query, { forceRefresh: options.forceRefresh }).catch((error) => {
        console.log(`[profile] catalog failed id=${authId} ${error.message}`);
        return { weapons: [], wears: [] };
      }),
    ]);

    const info = profilePayload?.info || {};
    const clanPayload = profilePayload?.cl || null;
    const clan = clanPayload
      ? {
          cid: numberOr(clanPayload.cid ?? clanPayload.clan_id, 0),
          aid: numberOr(clanPayload.aid ?? clanPayload.caid, 0),
          t: stringOr(clanPayload.t ?? clanPayload.ctag, ""),
          ek: numberOr(clanPayload.ek, 0),
        }
      : null;
    const personalInventory = parseJsonArray(inventoryPayload?.data?.items);
    const clanInventory = Array.isArray(profilePayload?.clinv) ? profilePayload.clinv : [];
    const profile = {
      authId: numberOr(info.u_id, authId),
      authKey,
      name: stringOr(info.un, process.env.DEFAULT_PLAYER_NAME || "ContraCity"),
      level: numberOr(info.lvl, Number(process.env.DEFAULT_PLAYER_LEVEL || 1)),
      view: profilePayload?.view || {},
      weap: profilePayload?.weap || {},
      taun: profilePayload?.taun || {},
      inventory: [...personalInventory, ...clanInventory],
      abilities: Array.isArray(abilitiesPayload?.u) ? abilitiesPayload.u : [],
      defaultWeapons: parseJsonArray(inventoryPayload?.data?.dw),
      catalogWeapons: shopCatalog.weapons,
      catalogWears: shopCatalog.wears,
      clan,
    };
    profileCache.set(cacheKey, { loadedAt: Date.now(), profile });
    const stats = playerRuntimeStats(profile);
    console.log(`[profile] loaded id=${profile.authId} name=${profile.name} weap=${profileWeaponSelectionSummary(profile.weap)} loadout=${selectedWeaponLoadoutSummary(profile)} weapons=${selectedWeapons(profile)?.length || 0} weaponUpgrades=${selectedWeaponUpgradeSummary(profile)} wears=${selectedWears(profile).length} wearList=${selectedWearSummary(profile)} taunts=${selectedTaunts(profile).length} tauntSlots=${selectedTauntSummary(profile)} enhancers=${selectedEnhancers(profile).length} enhancerList=${selectedEnhancerSummary(profile)} abilities=${profile.abilities.length} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} armorPct=${stats.modifiers.armorPercent} dmgRedPct=${stats.modifiers.damageReductionPercent} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponSpeedPct=${stats.modifiers.weaponSpeedPercent} weaponRapidityPct=${stats.modifiers.weaponRapidityPercent} weaponHeadDmgPct=${stats.modifiers.weaponHeadDamagePercent} weaponAccuracyFlat=${stats.modifiers.weaponAccuracyFlat} ammoPct=${stats.modifiers.weaponAmmoPercent} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} jumpCap=${stats.jumpCap} prot=${formatProtectionBonuses(stats.modifiers.protections)} rangeProt=${formatRangeProtectionBonuses(stats.modifiers.rangeProtections)} wearDmg=${formatDamageBonuses(stats.modifiers.damageBonuses)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump}`);
    return profile;
  } catch (error) {
    console.log(`[profile] failed id=${authId} ${error.message}`);
    return fallbackPlayerProfile(incomingActor);
  }
}

function makeActorDataRaw(incomingActor, profile = null, options = {}) {
  const credentials = actorCredentials(incomingActor);
  const authId = numberOr(profile?.authId, credentials.authId);
  const name = stringOr(profile?.name ?? htGet(incomingActor, 242)?.value, process.env.DEFAULT_PLAYER_NAME || "ContraCity");
  const team = Number(htGet(incomingActor, 239)?.value ?? -1);
  const entries = [
    { key: rawByte(242), value: rawString(name) },
    { key: rawByte(241), value: rawInt(authId) },
    { key: rawByte(239), value: rawShort(Number.isFinite(team) ? team : -1) },
    { key: rawByte(96), value: makeActorInfoRaw(profile, options) },
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

function actorRawForPeer(session) {
  return session?.peerActorRaw || session?.actorRaw || rawHashtable([]);
}

function actorJoinPacketBytes(actorId, actorRaw, channel = 0) {
  const payload = rawEvent(105, [
    { key: 254, value: rawInt(actorId) },
    { key: 245, value: actorRaw || rawHashtable([]) },
  ]);
  return 12 + makeReliable(0, payload, channel).length;
}

function actorListJoinResponsePacketBytes(actorId, actorRaw, roomRaw, channel = 0) {
  const actorList = rawHashtable([{
    key: rawInt(actorId),
    value: actorRaw || rawHashtable([]),
  }]);
  const payload = rawOperationResponse(255, [
    { key: 254, value: rawInt(actorId) },
    { key: 249, value: actorList },
    { key: 248, value: roomRaw || rawHashtable([]) },
  ]);
  return 12 + makeReliable(0, payload, channel).length;
}

function mandatoryLoadoutActorCandidates(incomingActor, profile) {
  const maxSlots = FULL_LOADOUT_SLOT_LIMIT;
  return [
    { label: "full", options: { weaponSlotLimit: maxSlots, logCompact: false } },
    { label: "no-weapon-extra", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWeaponAdditional: false } },
    { label: "no-weapon-extra-no-actor-optional", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWeaponAdditional: false, includeActorOptionalFields: false } },
    { label: "no-wears", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWears: false } },
    { label: "no-wears-no-weapon-extra", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWears: false, includeWeaponAdditional: false } },
    { label: "no-wears-no-weapon-extra-no-enhancers", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWears: false, includeWeaponAdditional: false, includeEnhancers: false } },
    { label: "required-actor", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWears: false, includeEnhancers: false, includeWeaponAdditional: false, includeActorOptionalFields: false } },
    { label: "required-actor-no-taunts", options: { weaponSlotLimit: maxSlots, logCompact: false, includeWears: false, includeEnhancers: false, includeTaunts: false, includeWeaponAdditional: false, includeActorOptionalFields: false } },
    { label: "required-actor-no-taunts-6slots", options: { weaponSlotLimit: Math.min(6, maxSlots), logCompact: false, includeWears: false, includeEnhancers: false, includeTaunts: false, includeWeaponAdditional: false, includeActorOptionalFields: false } },
  ].map((candidate) => ({
    label: candidate.label,
    slotLimit: candidate.options.weaponSlotLimit,
    raw: makeActorDataRaw(incomingActor, profile, candidate.options),
  }));
}

function actorProfileHasWears(label, wearCount) {
  const profileLabel = String(label || "");
  return wearCount > 0 && !profileLabel.startsWith("no-wears") && !profileLabel.startsWith("required-actor");
}

function actorProfileHasEnhancers(label, enhancerCount) {
  const profileLabel = String(label || "");
  return enhancerCount > 0 && INCLUDE_BATTLE_ENHANCERS && !profileLabel.includes("no-enhancers") && !profileLabel.startsWith("required-actor");
}

function fitActorDataRaw(incomingActor, profile, actorId, channel = 0, roomRaw = null, mode = "event") {
  const maxSlots = FULL_LOADOUT_SLOT_LIMIT;
  const wearCount = selectedWears(profile).length;
  const wearList = selectedWearSummary(profile);
  const enhancerCount = selectedEnhancers(profile).length;
  const enhancerList = selectedEnhancerSummary(profile);
  let fallback = null;
  for (const candidate of mandatoryLoadoutActorCandidates(incomingActor, profile)) {
    const eventBytes = actorJoinPacketBytes(actorId, candidate.raw, channel);
    const joinBytes = actorListJoinResponsePacketBytes(actorId, candidate.raw, roomRaw, channel);
    const bytes = mode === "join" ? joinBytes : eventBytes;
    const result = { ...candidate, bytes, eventBytes, joinBytes };
    fallback = result;
    if (!ACTOR_JOIN_MAX_PACKET_BYTES || bytes <= ACTOR_JOIN_MAX_PACKET_BYTES) {
      if (candidate.label !== "full") {
        const hasWears = actorProfileHasWears(candidate.label, wearCount);
        const hasEnhancers = actorProfileHasEnhancers(candidate.label, enhancerCount);
        console.log(`[loadout] ${mode} actor compact actor=${actorId} profile=${candidate.label} slots=${candidate.slotLimit}/${maxSlots} wears=${wearCount} hasWears=${hasWears ? "yes" : "no"} wearList=${wearList} enhancers=${enhancerCount} hasEnhancers=${hasEnhancers ? "yes" : "no"} enhancerList=${enhancerList} bytes=${bytes}/${ACTOR_JOIN_MAX_PACKET_BYTES} event=${eventBytes} join=${joinBytes}`);
      }
      return result;
    }
  }
  if (fallback && ACTOR_JOIN_MAX_PACKET_BYTES) {
    const hasWears = actorProfileHasWears(fallback.label, wearCount);
    const hasEnhancers = actorProfileHasEnhancers(fallback.label, enhancerCount);
    console.log(`[warn] ${mode} actor payload over budget actor=${actorId} profile=${fallback.label} slots=${fallback.slotLimit}/${maxSlots} wears=${wearCount} hasWears=${hasWears ? "yes" : "no"} wearList=${wearList} enhancers=${enhancerCount} hasEnhancers=${hasEnhancers ? "yes" : "no"} enhancerList=${enhancerList} bytes=${fallback.bytes}/${ACTOR_JOIN_MAX_PACKET_BYTES} event=${fallback.eventBytes} join=${fallback.joinBytes}`);
  }
  return fallback || { raw: rawHashtable([]), label: "empty", slotLimit: 0, bytes: actorJoinPacketBytes(actorId, rawHashtable([]), channel) };
}

function updateActorWireData(session, incomingActor, profile, channel = 0) {
  session.actorJoinParam = incomingActor;
  session.actorRaw = makeActorDataRaw(incomingActor, profile, {
    weaponSlotLimit: FULL_LOADOUT_SLOT_LIMIT,
  });
  const peerActor = fitActorDataRaw(incomingActor, profile, session.actorId, channel, session.roomRaw, "event");
  const joinActor = fitActorDataRaw(incomingActor, profile, session.actorId, channel, session.roomRaw, "join");
  session.peerActorRaw = peerActor.raw;
  session.peerActorLoadoutSlots = peerActor.slotLimit;
  session.peerActorRawBytes = peerActor.bytes;
  session.peerActorProfile = peerActor.label;
  session.joinActorRaw = joinActor.raw;
  session.joinActorLoadoutSlots = joinActor.slotLimit;
  session.joinActorRawBytes = joinActor.bytes;
  session.joinActorProfile = joinActor.label;
  session.actorWireSourceProfile = profile;
  session.actorWearCount = selectedWears(profile).length;
  session.actorWearSummary = selectedWearSummary(profile);
  session.actorTauntCount = selectedTaunts(profile).length;
  session.actorTauntSummary = selectedTauntSummary(profile);
  session.actorEnhancerCount = selectedEnhancers(profile).length;
  session.actorEnhancerSummary = selectedEnhancerSummary(profile);
  session.peerActorHasWears = actorProfileHasWears(peerActor.label, session.actorWearCount);
  session.joinActorHasWears = actorProfileHasWears(joinActor.label, session.actorWearCount);
  session.peerActorHasEnhancers = actorProfileHasEnhancers(peerActor.label, session.actorEnhancerCount);
  session.joinActorHasEnhancers = actorProfileHasEnhancers(joinActor.label, session.actorEnhancerCount);
}

function refreshActorWireDataForRoomActorList(playerSession) {
  if (!playerSession?.actorJoinParam || !playerSession.loadedProfile || isFallbackBattleProfile(playerSession.loadedProfile)) {
    return false;
  }
  if (playerSession.actorWireSourceProfile === playerSession.loadedProfile && playerSession.joinActorRaw) {
    return false;
  }
  updateActorWireData(playerSession, playerSession.actorJoinParam, playerSession.loadedProfile, playerSession.lastChannel || 0);
  console.log(`[state] actor-wire refresh actor=${playerSession.actorId} reason=room-actor-list wears=${playerSession.actorWearCount || 0} wearList=${playerSession.actorWearSummary || "none"} taunts=${playerSession.actorTauntCount || 0} tauntSlots=${playerSession.actorTauntSummary || "none"} enhancers=${playerSession.actorEnhancerCount || 0} enhancerList=${playerSession.actorEnhancerSummary || "none"} joinProfile=${playerSession.joinActorProfile || "n/a"} joinHasWears=${playerSession.joinActorHasWears ? "yes" : "no"} joinHasEnhancers=${playerSession.joinActorHasEnhancers ? "yes" : "no"} joinPacket=${playerSession.joinActorRawBytes || 0} peerProfile=${playerSession.peerActorProfile || "n/a"} peerHasWears=${playerSession.peerActorHasWears ? "yes" : "no"} peerHasEnhancers=${playerSession.peerActorHasEnhancers ? "yes" : "no"} peerPacket=${playerSession.peerActorRawBytes || 0}`);
  return true;
}

function isZombieModeValue(mode) {
  return Number(mode) === MAP_MODE_ZOMBIE;
}

function isZombieRoom(room) {
  return isZombieModeValue(room?.mode);
}

function isZombiePlayerSession(session) {
  return isZombieModeValue(roomMode(session)) && Number(session?.team) === ZOMBIE_TEAM;
}

function zombieMaxHealthForType(zombieType) {
  if (Number(zombieType) === ZOMBIE_TYPE.BOSS) return ZOMBIE_BOSS_MAX_HEALTH;
  if (Number(zombieType) === ZOMBIE_TYPE.REGULAR) return ZOMBIE_REGULAR_MAX_HEALTH;
  return 0;
}

function sessionMaxHealth(session, stats = null) {
  const resolvedStats = stats || sessionRuntimeStats(session);
  if (isZombiePlayerSession(session)) {
    return zombieMaxHealthForType(session.zombieType) || resolvedStats.maxHealth;
  }
  return resolvedStats.maxHealth;
}

function randomIntInclusive(min, max) {
  const lo = Math.ceil(Math.min(Number(min), Number(max)));
  const hi = Math.floor(Math.max(Number(min), Number(max)));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function isZombieRoundPausedSession(session) {
  return isZombieRoom(session?.room) && zombieModeForRoom(session.room) === ZOMBIE_MODE.PAUSE;
}

function zombieModeForRoom(room) {
  if (!isZombieRoom(room)) return 0;
  const mode = Number(room.zombieMode || 0);
  return mode > 0 ? mode : ZOMBIE_MODE.WAIT_FOR_PLAYERS;
}

function makeZombieModeStateRaw(mode) {
  return rawHashtable([
    { key: rawByte(51), value: rawByte(mode) },
  ]);
}

function makeGameStateRaw(session) {
  const entries = [
    { key: rawByte(88), value: makeScoreRaw(session) },
    { key: rawByte(77), value: rawBool(isStandardRoundPaused(session.room)) },
    { key: rawByte(95), value: rawLong(session.room.startedAt) },
  ];

  if (isZombieRoom(session.room)) {
    entries.push({ key: rawByte(51), value: makeZombieModeStateRaw(zombieModeForRoom(session.room)) });
  }

  const controlPoints = makeControlPointsRaw(session.room);
  if (controlPoints) entries.push({ key: rawByte(78), value: controlPoints });
  const flags = makeFlagsRaw(session.room);
  if (flags) entries.push({ key: rawByte(79), value: flags });

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

function isCtfRoom(room) { return Number(room?.mode) === MAP_MODE_CAPTURE_THE_FLAG && Boolean(CTF_MAPS[mapKey(room?.map)]?.length); }
function makeFlagState(mapName) { return new Map((CTF_MAPS[mapKey(mapName)] || []).map((p) => [p.team, {...p, bearer:-1, state:0}])); }
function makeFlagRaw(flag) { return rawHashtable([{key:rawByte(64),value:rawShort(flag.team)},{key:rawByte(65),value:makeTransformRaw(flag)},{key:rawByte(62),value:rawInt(flag.state)},{key:rawByte(63),value:rawInt(flag.bearer)}]); }
function makeFlagsRaw(room) { return isCtfRoom(room) ? rawHashtable(Array.from(room.flags.values()).map((f)=>({key:rawShort(f.team),value:makeFlagRaw(f)}))) : null; }
function makeFlagEvent(type, flag) { return rawEvent(89,[{key:254,value:rawInt(0)},{key:245,value:rawHashtable([{key:rawByte(85),value:rawShort(type)},{key:rawByte(84),value:makeFlagRaw(flag)}])}]); }
function ctfDistance(a,b) { return a && b ? Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) : Infinity; }
function ctfHomePoint(room, team) {
  return (CTF_MAPS[mapKey(room?.map)] || []).find((point) => Number(point.team) === Number(team)) || null;
}
function ctfPlayerAtBase(session, team) {
  const home = ctfHomePoint(session?.room, team);
  if (!home || !session?.lastTransform) return false;
  // Active FlagPoint checks the local player against FlagPoint + (0,3,0), radius 8.
  return ctfDistance(session.lastTransform, { x: home.x, y: home.y + 3, z: home.z }) < 8;
}
function tryDeliverCtfFlag(session, channel, source = "move") {
  const room = session?.room;
  if (!isCtfRoom(room) || !session.spawned || session.dead || isRoundPausedSession(session)) return false;
  const home = room.flags.get(session.team);
  if (!home || home.bearer >= 0 || home.state !== 0 || !ctfPlayerAtBase(session, session.team)) return false;
  const carried = Array.from(room.flags.values()).find((flag) => flag.team !== session.team && flag.bearer === session.actorId);
  if (!carried) return false;
  const carriedHome = ctfHomePoint(room, carried.team);
  if (!carriedHome) return false;

  Object.assign(carried, carriedHome, { bearer: -1, state: 0 });
  session.points = numberOr(session.points, 0) + 1;
  sendReliableToWholeRoom(room, makeFlagEvent(1, carried), channel, { requireGameState: false });
  sendReliableToWholeRoom(room, makeScoreUpdateEvent(session), channel, { requireGameState: false });
  console.log(`[flag] delivered actor=${session.actorId} flagTeam=${carried.team} score=${teamScorePoints(session, session.team)} source=${source} pos=${fmtPoint(session.lastTransform)}`);
  maybeFinishStandardRound(room, "flag-deliver", channel, session);
  return true;
}
function updateCtfOnMove(session, channel) {
  const room=session.room; if(!isCtfRoom(room)||!session.spawned||session.dead) return;
  if (tryDeliverCtfFlag(session, channel, "move")) return;
  for(const flag of room.flags.values()) {
    if(flag.bearer<0 && ctfDistance(session.lastTransform,flag)<=8) {
      if(flag.team===session.team && flag.state!==0) { flag.state=0; Object.assign(flag,CTF_MAPS[mapKey(room.map)].find(x=>x.team===flag.team)); sendReliableToWholeRoom(room,makeFlagEvent(3,flag),channel,{requireGameState:false}); console.log(`[flag] returned actor=${session.actorId} flagTeam=${flag.team}`); }
      else if(flag.team!==session.team) { flag.bearer=session.actorId; flag.state=1; sendReliableToWholeRoom(room,makeFlagEvent(0,flag),channel,{requireGameState:false}); console.log(`[flag] captured actor=${session.actorId} flagTeam=${flag.team} pos=${fmtPoint(session.lastTransform)}`); }
    }
  }
}
function resetCtfFlag(room, flag, type, channel) {
  const home=(CTF_MAPS[mapKey(room.map)]||[]).find((item)=>item.team===flag.team); if(!home)return;
  Object.assign(flag,home,{bearer:-1,state:0}); sendReliableToWholeRoom(room,makeFlagEvent(type,flag),channel,{requireGameState:false});
}
function dropCtfFlagsForSession(session, type=2, channel=0) {
  const room=session?.room; if(!isCtfRoom(room))return;
  for(const flag of room.flags.values()) if(flag.bearer===session.actorId) { flag.bearer=-1; flag.state=0; Object.assign(flag,session.lastTransform||flag); sendReliableToWholeRoom(room,makeFlagEvent(type,flag),channel,{requireGameState:false}); console.log(`[flag] dropped actor=${session.actorId} flagTeam=${flag.team} reason=${type}`); }
}

function isControlPointsRoom(room) {
  return Number(room?.mode) === MAP_MODE_CONTROL_POINTS && Boolean(CONTROL_POINT_MAPS[mapKey(room?.map)]?.length);
}

function makeControlPointsRaw(room) {
  if (!isControlPointsRoom(room) || !room.controlPoints?.size) return null;
  return rawHashtable(Array.from(room.controlPoints.values()).map((point) => ({
    key: rawShort(point.id),
    value: rawHashtable([
      { key: rawByte(61), value: rawShort(point.id) },
      { key: rawByte(59), value: rawInt(point.state) },
      { key: rawByte(58), value: rawByte(point.progress) },
      { key: rawByte(60), value: rawShort(point.team) },
    ]),
  })));
}

function makeControlPointEvent(point) {
  return rawEvent(88, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: rawHashtable([{ key: rawByte(82), value: rawHashtable([
      { key: rawByte(61), value: rawShort(point.id) },
      { key: rawByte(59), value: rawInt(point.state) },
      { key: rawByte(58), value: rawByte(point.progress) },
      { key: rawByte(60), value: rawShort(point.team) },
    ]) }]) },
  ]);
}

function makeControlPointState(mapName) {
  return new Map((CONTROL_POINT_MAPS[mapKey(mapName)] || []).map((definition) => [definition.id, {
    ...definition, state: 0, progress: 0, team: -1, occupants: new Set(), nextScoreAt: 0,
  }]));
}

function makeControlPointScoreState() {
  return { 1: 0, 2: 0 };
}

function controlPointContains(point, transform) {
  if (!point || !transform) return false;
  return Math.hypot(transform.x - point.x, transform.z - point.z) <= 6 && Math.abs(transform.y - point.y) <= 7.2;
}

function updateControlPointOccupancyFromMove(session) {
  const room = session?.room;
  if (!isControlPointsRoom(room) || !session.spawned || session.dead || isRoundPausedSession(session)) return;
  for (const point of room.controlPoints.values()) {
    const inside = controlPointContains(point, session.lastTransform);
    const present = point.occupants.has(session.actorId);
    if (inside === present) continue;
    if (inside) point.occupants.add(session.actorId);
    else point.occupants.delete(session.actorId);
    console.log(`[control] ${inside ? "enter" : "exit"} actor=${session.actorId} point=${point.id} team=${session.team} source=move pos=${fmtPoint(session.lastTransform)}`);
  }
}

function updateControlPoint(room, point, channel) {
  const teams = new Set();
  for (const actorId of Array.from(point.occupants)) {
    const player = room.players.get(actorId);
    if (!player || !player.spawned || player.dead || isRoundPausedSession(player) || !controlPointContains(point, player.lastTransform)) {
      point.occupants.delete(actorId);
      continue;
    }
    if (player.team === 1 || player.team === 2) teams.add(player.team);
  }

  const before = `${point.state}/${point.progress}/${point.team}`;
  const wasCaptured = point.state === 2;
  let captureTeam = 0;

  if (teams.size === 0) {
    if (point.state === 1 && point.progress > 0) {
      point.progress = Math.max(0, point.progress - CONTROL_POINT_CAPTURE_STEP);
      if (point.progress === 0) {
        point.state = 0;
        point.team = -1;
      }
    }
  } else if (teams.size === 1) {
    captureTeam = Array.from(teams)[0];
    if (point.team !== captureTeam) {
      if (point.team > 0 && point.progress > 0) {
        point.state = 1;
        point.progress = Math.max(0, point.progress - CONTROL_POINT_CAPTURE_STEP);
        point.nextScoreAt = 0;
        if (point.progress === 0) {
          point.state = 0;
          point.team = -1;
        }
      } else {
        point.team = captureTeam;
        point.state = 1;
        point.progress = Math.min(100, point.progress + CONTROL_POINT_CAPTURE_STEP);
      }
    } else if (point.state !== 2) {
      point.state = 1;
      point.progress = Math.min(100, point.progress + CONTROL_POINT_CAPTURE_STEP);
    }
  }

  if (point.progress >= 100) {
    point.progress = 100;
    point.state = 2;
  }

  const stateChanged = before !== `${point.state}/${point.progress}/${point.team}`;
  if (stateChanged) {
    const event = makeControlPointEvent(point);
    sendReliableToWholeRoom(room, event, channel, { requireGameState: false });
    console.log(`[control] state point=${point.id} state=${point.state} progress=${point.progress} team=${point.team} occupants=${Array.from(point.occupants).join(",") || "none"}`);
  }

  if (!wasCaptured && point.state === 2) {
    for (const actorId of point.occupants) {
      const player = room.players.get(actorId);
      if (!player || player.team !== point.team) continue;
      player.points = numberOr(player.points, 0) + 1;
    }
    room.controlPointScores ||= makeControlPointScoreState();
    room.controlPointScores[point.team] = numberOr(room.controlPointScores[point.team], 0) + 1;
    point.nextScoreAt = Date.now() + CONTROL_POINT_SCORE_INTERVAL_MS;
    const source = Array.from(room.players.values()).find((player) => player?.team === point.team)
      || Array.from(room.players.values())[0];
    if (source) {
      sendReliableToWholeRoom(room, makeScoreUpdateEvent(source), channel, { requireGameState: false });
    }
    console.log(`[control] captured point=${point.id} team=${point.team} score=${source ? teamScorePoints(source, point.team) : 0}`);
    maybeFinishStandardRound(room, "control-point", channel);
    return true;
  }

  if (point.state === 2 && (point.team === 1 || point.team === 2) && room.standardRoundState === "active") {
    const now = Date.now();
    if (!point.nextScoreAt) point.nextScoreAt = now + CONTROL_POINT_SCORE_INTERVAL_MS;
    if (now >= point.nextScoreAt) {
      const elapsedIntervals = Math.max(1, Math.floor((now - point.nextScoreAt) / CONTROL_POINT_SCORE_INTERVAL_MS) + 1);
      room.controlPointScores ||= makeControlPointScoreState();
      room.controlPointScores[point.team] = numberOr(room.controlPointScores[point.team], 0) + elapsedIntervals;
      point.nextScoreAt += elapsedIntervals * CONTROL_POINT_SCORE_INTERVAL_MS;
      const source = Array.from(room.players.values())[0];
      if (source) {
        sendReliableToWholeRoom(room, makeScoreUpdateEvent(source), channel, { requireGameState: false });
        console.log(`[control] score point=${point.id} team=${point.team} add=${elapsedIntervals} total=${teamScorePoints(source, point.team)}`);
      }
      maybeFinishStandardRound(room, "control-point-hold", channel);
      return true;
    }
  }

  return stateChanged;
}

function startControlPointTicker(room, channel = 0) {
  if (!isControlPointsRoom(room) || room.controlPointTimer) return;
  room.controlPointTimer = setInterval(() => {
    if (!isControlPointsRoom(room)) return;
    for (const point of room.controlPoints.values()) updateControlPoint(room, point, channel);
  }, CONTROL_POINT_CAPTURE_TICK_MS);
}

function stopControlPointTicker(room) {
  if (room?.controlPointTimer) clearInterval(room.controlPointTimer);
  if (room) room.controlPointTimer = null;
}

function resetControlPointsForRound(room, channel = 0) {
  if (!isControlPointsRoom(room)) return;
  room.controlPointScores = makeControlPointScoreState();
  for (const point of room.controlPoints.values()) {
    point.state = 0;
    point.progress = 0;
    point.team = -1;
    point.nextScoreAt = 0;
    point.occupants.clear();
    sendReliableToWholeRoom(room, makeControlPointEvent(point), channel, { requireGameState: false });
  }
}

function makeTransformRaw(point) {
  const yaw = numberOr(point.rotY, 0);
  const pitch = numberOr(point.rotX, 0);
  return rawHashtable([
    { key: rawByte(1), value: rawFloat(point.x) },
    { key: rawByte(2), value: rawFloat(point.y) },
    { key: rawByte(3), value: rawFloat(point.z) },
    // Smooth interpolation consumes Speed.x/y as pitch/yaw; spawn and some snapshots consume Rotation.y.
    { key: rawByte(4), value: rawFloat(pitch) },
    { key: rawByte(5), value: rawFloat(yaw) },
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

function makeItemRaw(item, overrides = {}) {
  const value = overrides.value ?? item.value;
  const subType = overrides.subType ?? item.subType;
  const entries = [
    { key: rawByte(75), value: rawInt(item.id) },
    { key: rawByte(73), value: rawByte(item.type) },
    { key: rawByte(71), value: makeTransformRaw(item) },
    { key: rawByte(70), value: rawInt(value) },
  ];
  if (subType !== undefined && subType !== null) {
    entries.push({ key: rawByte(72), value: rawShort(subType) });
  }
  return rawHashtable(entries);
}

function describeSpawnItemPayload(itemsOrEntries, limit = 3) {
  const items = (Array.isArray(itemsOrEntries) ? itemsOrEntries : [])
    .map((entry) => entry?.item || entry)
    .filter(Boolean);
  if (!items.length) return "";
  const sample = items.slice(0, limit)
    .map((item) => `${item.id}:${item.type}/${item.subType ?? 0}@${fmtPoint(item)}`)
    .join("|");
  return ` spawnData=${sample}${items.length > limit ? `+${items.length - limit}` : ""}`;
}

function makeRoomItemsRaw(room) {
  if (!ENABLE_MAP_PICKUPS || !MAP_PICKUPS_IN_GAMESTATE || !room) return null;
  const items = ensureRoomItems(room);
  const active = Array.from(items.values()).filter((item) => !item.picked);
  if (!active.length) return null;
  return rawHashtable(active.map((item) => ({
    key: rawInt(item.id),
    value: makeItemRaw(item),
  })));
}

function buildSpawnItemEvent(item) {
  return rawEvent(94, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: makeItemRaw(item) },
  ]);
}

function buildRemoveItemEvent(item) {
  return rawEvent(93, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: makeItemRaw(item, { value: 0 }) },
  ]);
}

function ensureSessionVisibleItemIds(session) {
  if (!session) return new Set();
  if (!(session?.visibleItemIds instanceof Set)) {
    session.visibleItemIds = new Set();
  }
  return session.visibleItemIds;
}

function markSessionItemVisible(session, itemId) {
  if (!session || !Number.isFinite(Number(itemId))) return;
  ensureSessionVisibleItemIds(session).add(Number(itemId));
}

function markSessionItemHidden(session, itemId) {
  if (!session?.visibleItemIds || !Number.isFinite(Number(itemId))) return;
  session.visibleItemIds.delete(Number(itemId));
}

function markActiveRoomItemsVisible(session) {
  if (!ENABLE_MAP_PICKUPS || !session?.room) return;
  const visible = ensureSessionVisibleItemIds(session);
  for (const item of ensureRoomItems(session.room).values()) {
    if (item.picked) visible.delete(Number(item.id));
    else visible.add(Number(item.id));
  }
}

function markRoomItemHiddenForAll(room, itemId) {
  if (!room?.players?.size) return;
  for (const playerSession of room.players.values()) {
    markSessionItemHidden(playerSession, itemId);
  }
}

function sessionHasVisibleRoomItem(session, item) {
  if (!session?.gameStateRequested || !item) return false;
  return ensureSessionVisibleItemIds(session).has(Number(item.id));
}

function activeRoomPickupEventsForSession(session) {
  if (!ENABLE_MAP_PICKUPS || !session?.room || !session.gameStateRequested || !session.spawned || session.dead) return [];
  const visible = ensureSessionVisibleItemIds(session);
  const events = [];
  for (const item of ensureRoomItems(session.room).values()) {
    const id = Number(item.id);
    if (item.picked) {
      visible.delete(id);
      continue;
    }
    if (visible.has(id)) continue;
    events.push({ item, event: buildSpawnItemEvent(item) });
  }
  return events;
}

function ensurePickupSpawnRepairTimerSet(session) {
  if (!session) return null;
  if (!(session.pickupSpawnRepairTimers instanceof Set)) {
    session.pickupSpawnRepairTimers = new Set();
  }
  return session.pickupSpawnRepairTimers;
}

function clearPickupSpawnRepairTimers(session) {
  if (!(session?.pickupSpawnRepairTimers instanceof Set)) return;
  for (const timer of session.pickupSpawnRepairTimers) {
    clearTimeout(timer);
  }
  session.pickupSpawnRepairTimers.clear();
}

function activeRoomItemsByIds(room, itemIds) {
  if (!room || !Array.isArray(itemIds) || !itemIds.length) return [];
  const items = ensureRoomItems(room);
  const active = [];
  for (const rawId of itemIds) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    const item = items.get(id);
    if (item && !item.picked) active.push(item);
  }
  return active;
}

function pickupSpawnRepairPayloads(items) {
  const payloads = [];
  for (const item of items) {
    payloads.push(buildRemoveItemEvent(item), buildSpawnItemEvent(item));
  }
  return payloads;
}

function queuePickupSpawnRepair(session, itemIds, channel = 0, reason = "item-spawn") {
  if (!PICKUP_SPAWN_REPAIR_DELAYS_MS.length || !session?.room || !Array.isArray(itemIds) || !itemIds.length) return;
  const ids = Array.from(new Set(itemIds.map((id) => Number(id)).filter(Number.isFinite)));
  if (!ids.length) return;

  const actorId = session.actorId;
  const room = session.room;
  const spawnSeq = Number(session.spawnSeq || 0);
  const timerSet = ensurePickupSpawnRepairTimerSet(session);
  if (!timerSet) return;

  for (const delayMs of PICKUP_SPAWN_REPAIR_DELAYS_MS) {
    const waitMs = Math.max(0, Number(delayMs) || 0);
    const timer = setTimeout(() => {
      timerSet.delete(timer);
      if (session.actorId !== actorId || session.room !== room || room.players?.get(actorId) !== session) return;
      if (Number(session.spawnSeq || 0) !== spawnSeq) return;
      if (!session.spawned || session.dead || !session.gameStateRequested) return;

      const activeItems = activeRoomItemsByIds(room, ids);
      if (!activeItems.length) return;
      if (sendReliablePayloadsToSession(session, pickupSpawnRepairPayloads(activeItems), channel)) {
        for (const item of activeItems) {
          markSessionItemVisible(session, item.id);
        }
        console.log(`[sync] item-spawn-repair actor=${actorId} items=${activeItems.length} delay=${waitMs}ms reason=${reason}${describeSpawnItemPayload(activeItems)}`);
      }
    }, waitMs);
    timerSet.add(timer);
    if (typeof timer.unref === "function") timer.unref();
  }
}

function sendActiveRoomPickupsToSession(session, channel = 0, reason = "post-spawn") {
  const entries = activeRoomPickupEventsForSession(session);
  if (!entries.length) return 0;
  const items = entries.map((entry) => entry.item);
  if (!sendReliablePayloadsToSession(session, pickupSpawnRepairPayloads(items), channel)) return 0;
  for (const entry of entries) {
    markSessionItemVisible(session, entry.item.id);
  }
  queuePickupSpawnRepair(session, entries.map((entry) => entry.item.id), channel, reason);
  console.log(`[sync] item-spawn actor=${session.actorId} items=${entries.length} reason=${reason}${describeSpawnItemPayload(entries)}`);
  return entries.length;
}

function queuePostSpawnPickupSync(session, reason = "post-spawn") {
  if (!ENABLE_MAP_PICKUPS || !session?.room) return;
  session.pendingPickupSync = {
    reason,
    afterMoveCount: Math.max(2, (Number(session.moveCount) || 0) + 1),
  };
}

function appendActiveRoomPickupEvents(session, commands, channel = 0, reason = "post-spawn-response") {
  if (!Array.isArray(commands)) return 0;
  const entries = activeRoomPickupEventsForSession(session);
  if (!entries.length) return 0;
  const items = entries.map((entry) => entry.item);
  for (const payload of pickupSpawnRepairPayloads(items)) {
    commands.push(...makeReliableCommandsForPayload(session, payload, channel));
  }
  for (const item of items) {
    markSessionItemVisible(session, item.id);
  }
  queuePickupSpawnRepair(session, entries.map((entry) => entry.item.id), channel, reason);
  console.log(`[sync] item-spawn actor=${session.actorId} items=${entries.length} reason=${reason}${describeSpawnItemPayload(entries)}`);
  return entries.length;
}

function maybeAppendPostSpawnPickupSync(session, commands, channel = 0) {
  const pending = session?.pendingPickupSync;
  if (!pending || !ENABLE_MAP_PICKUPS) return;
  if (!session.spawned || session.dead || !session.gameStateRequested) return;
  if ((Number(session.moveCount) || 0) < Number(pending.afterMoveCount || 0)) return;
  appendActiveRoomPickupEvents(session, commands, channel, pending.reason || "post-spawn-response");
  session.pendingPickupSync = null;
}

function sendReliablePayloadsToSession(targetSession, payloads, channel = 0) {
  if (!targetSession?.socket || !targetSession?.rinfo || !Array.isArray(payloads)) return false;
  const reliablePayloads = payloads.filter(Boolean);
  if (!reliablePayloads.length) return false;
  const targetChannel = reliableChannelForSession(targetSession, channel);
  const commands = reliablePayloads.flatMap((payload) => makeReliableCommandsForPayload(targetSession, payload, targetChannel));
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

function makeSessionReliableCommand(session, payload, channel = 0) {
  const targetChannel = reliableChannelForSession(session, channel);
  const commands = makeReliableCommandsForPayload(session, payload, targetChannel);
  return {
    channel: targetChannel,
    seq: reliableCommandSeq(commands[0]),
    seqs: reliableCommandSeqSummary(commands),
    command: commands[0],
    commands,
  };
}

function reliableCommandCommands(reliableCommand) {
  return Array.isArray(reliableCommand?.commands)
    ? reliableCommand.commands.filter(Boolean)
    : (reliableCommand?.command ? [reliableCommand.command] : []);
}

function sendReliableCommandToSession(targetSession, reliableCommand) {
  const commands = reliableCommandCommands(reliableCommand);
  if (!targetSession?.socket || !targetSession?.rinfo || !commands.length) return false;
  try {
    sendPacket(targetSession.socket, targetSession.rinfo, targetSession, commands);
  } catch (error) {
    console.log(`[warn] peer-send failed actor=${targetSession.actorId || "?"} seq=${reliableCommand.seqs ?? reliableCommand.seq ?? "?"} reason=${error.message}`);
    return false;
  }
  return true;
}

function makeSessionUnreliableCommand(session, payload, channel = 0, options = {}) {
  const targetChannel = reliableChannelForSession(session, channel, options);
  const lastReliableSeq = currentReliableSeqForSession(session, targetChannel);
  const unreliableSeq = nextUnreliableSeqForSession(session, targetChannel);
  return {
    channel: targetChannel,
    seq: unreliableSeq,
    reliableSeq: lastReliableSeq,
    command: makeUnreliable(lastReliableSeq, unreliableSeq, payload, targetChannel),
  };
}

function sendUnreliableToSession(targetSession, payload, channel = 0, options = {}) {
  if (!targetSession?.socket || !targetSession?.rinfo || !payload) return false;
  const command = makeSessionUnreliableCommand(targetSession, payload, channel, options);
  try {
    sendPacket(targetSession.socket, targetSession.rinfo, targetSession, [command.command]);
  } catch (error) {
    console.log(`[warn] peer-send-unreliable failed actor=${targetSession.actorId || "?"} seq=${command.seq ?? "?"} reason=${error.message}`);
    return false;
  }
  return true;
}

function sendSpectatorUnreliableToSession(targetSession, payload) {
  return sendUnreliableToSession(targetSession, payload, SPECTATOR_LIVE_CHANNEL, { forceChannel: true });
}

function canReceiveLivePeerEvent(playerSession) {
  if (!playerSession?.gameStateRequested) return false;
  if (playerSession.waitingSelfSpawnMove) return false;
  return Boolean(playerSession.moveSeen);
}

function canReceiveSpectatorUnreliableLive(playerSession) {
  if (!SPECTATOR_LIVE_UNRELIABLE) return false;
  if (!playerSession?.gameStateRequested) return false;
  if (playerSession.waitingSelfSpawnMove) return false;
  return !playerSession.moveSeen;
}

function broadcastLiveToRoom(sourceSession, payload, channel = 0, options = {}) {
  const room = sourceSession?.room;
  if (!room?.players?.size || !payload) return { total: 0, reliable: 0, spectator: 0, spectatorChannel: SPECTATOR_LIVE_CHANNEL };
  const allowSpectator = options.allowSpectator !== false;
  let reliable = 0;
  let spectator = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === sourceSession) continue;
    if (canReceiveLivePeerEvent(playerSession)) {
      if (sendReliableToSession(playerSession, payload, channel)) reliable += 1;
    } else if (allowSpectator && canReceiveSpectatorUnreliableLive(playerSession)) {
      if (sendSpectatorUnreliableToSession(playerSession, payload)) spectator += 1;
    }
  }
  return { total: reliable + spectator, reliable, spectator, spectatorChannel: SPECTATOR_LIVE_CHANNEL };
}

function broadcastMoveToRoom(sourceSession, payload, channel = 0) {
  if (MOVE_BROADCAST_UNRELIABLE) {
    const room = sourceSession?.room;
    if (!room?.players?.size || !payload) return { total: 0, reliable: 0, unreliable: 0, spectator: 0, spectatorChannel: SPECTATOR_LIVE_CHANNEL };
    let unreliable = 0;
    let spectator = 0;
    for (const playerSession of room.players.values()) {
      if (!playerSession || playerSession === sourceSession) continue;
      if (canReceiveLivePeerEvent(playerSession)) {
        if (sendUnreliableToSession(playerSession, payload, channel)) unreliable += 1;
      } else if (SPECTATOR_MOVE_UNRELIABLE && canReceiveSpectatorUnreliableLive(playerSession)) {
        if (sendSpectatorUnreliableToSession(playerSession, payload)) spectator += 1;
      }
    }
    return { total: unreliable + spectator, reliable: 0, unreliable, spectator, spectatorChannel: SPECTATOR_LIVE_CHANNEL };
  }
  return broadcastLiveToRoom(sourceSession, payload, channel, {
    allowSpectator: SPECTATOR_MOVE_UNRELIABLE,
  });
}

function broadcastReliableToRoom(sourceSession, payload, channel = 0, reason = "sync", options = {}) {
  const room = sourceSession?.room;
  if (!room?.players?.size || !payload) return 0;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === sourceSession) continue;
    if (options.requireGameState !== false && !playerSession.gameStateRequested) continue;
    if (options.requireLiveReady && !canReceiveLivePeerEvent(playerSession)) continue;
    if (options.requireMoveSeen && !playerSession.moveSeen) continue;
    if (options.skipKnownActor && sessionHasActorData(playerSession, sourceSession.actorId)) continue;
    if (sendReliableToSession(playerSession, payload, channel)) {
      sent += 1;
      if (options.markActorKnown) markActorKnown(playerSession, sourceSession.actorId);
      if (options.markActorAnnounced) markActorAnnounced(playerSession, sourceSession.actorId);
      if (options.markItemVisibleId !== undefined) markSessionItemVisible(playerSession, options.markItemVisibleId);
      if (options.markItemHiddenId !== undefined) markSessionItemHidden(playerSession, options.markItemHiddenId);
    }
  }
  if (sent > 0 && reason) {
    console.log(`[sync] ${reason} actor=${sourceSession.actorId} peers=${sent}`);
  }
  return sent;
}

function sendReliableToWholeRoom(room, payload, channel = 0, options = {}) {
  if (!room?.players?.size || !payload) return 0;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession) continue;
    if (options.requireGameState !== false && !playerSession.gameStateRequested) continue;
    if (sendReliableToSession(playerSession, payload, channel)) sent += 1;
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
    markRoomItemHiddenForAll(session.room, item.id);
    const spawnItemEvent = buildSpawnItemEvent(item);
    commands.push(...makeReliableCommandsForPayload(session, spawnItemEvent, channel));
    markSessionItemVisible(session, item.id);
    queuePickupSpawnRepair(session, [item.id], channel, "item-respawn");
    broadcastReliableToRoom(session, spawnItemEvent, channel, "item-respawn", {
      requireLiveReady: false,
      markItemVisibleId: item.id,
    });
    console.log(`[event] item-respawn id=${item.id} type=${item.type} subType=${item.subType ?? 0} value=${item.value} pos=${fmtPoint(item)}`);
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

function pickupPercent(item) {
  return Number(item?.subType) === 1 ? SMALL_PICKUP_PERCENT : FULL_PICKUP_PERCENT;
}

function ammoStateCanBenefitFromPickup(state) {
  if (!state || isColdArmsWeaponType(state.type)) return false;
  return numberOr(state.ammoReserve, 0) < reserveCapForState(state);
}

function itemCanBenefitSession(session, item) {
  // PlayerManager.PickItem() removes the object client-side, so only send it when it changes a resource.
  if (isZombieRoundPausedSession(session)) return false;
  if (!session?.spawned || session.dead) return false;
  if (isZombiePlayerSession(session)) return false;
  if (item.type === ITEM_TYPES.HEALTH) {
    const stats = sessionRuntimeStats(session);
    const maxHealth = sessionMaxHealth(session, stats);
    return numberOr(session.health, maxHealth) < maxHealth;
  }
  if (item.type === ITEM_TYPES.ARMOR) {
    return numberOr(session.energy, 0) < ARMOR_PICKUP_CAP;
  }
  if (item.type === ITEM_TYPES.AMMO) {
    return ammoPickupStates(session).some(ammoStateCanBenefitFromPickup);
  }
  return true;
}

function makeSpawnRaw(session, team, point) {
  const stats = sessionRuntimeStats(session);
  const maxHealth = sessionMaxHealth(session, stats);
  const health = Math.round(clampNumber(session.health ?? maxHealth, 0, maxHealth));
  const energy = Math.round(clampNumber(session.energy ?? stats.maxEnergy, 0, stats.maxEnergy));
  const zombieType = isZombieModeValue(roomMode(session))
    ? clampNumber(session.zombieType ?? ZOMBIE_TYPE.HUMAN, ZOMBIE_TYPE.HUMAN, ZOMBIE_TYPE.BOSS)
    : ZOMBIE_TYPE.HUMAN;
  return rawHashtable([
    // Local SpawnMe uses NetworkTransform.Speed as rotation; remotes use Rotation, so emit both.
    { key: rawByte(237), value: makeTransformRaw(point) },
    { key: rawByte(239), value: rawShort(team) },
    { key: rawByte(100), value: rawInt(health) },
    { key: rawByte(99), value: rawInt(energy) },
    { key: rawByte(10), value: rawByte(zombieType) },
  ]);
}

function roomMode(session) {
  const mode = Number(session.room?.mode ?? 1);
  return Number.isFinite(mode) && mode > 0 ? mode : 1;
}

function isTeamMode(mode) {
  return mode >= 2 && mode !== 16 && mode !== 64;
}

function hasTeamScoreMode(mode) {
  return isTeamMode(mode) || isZombieModeValue(mode);
}

function hasTeamDamageMode(mode) {
  return isTeamMode(mode) || isZombieModeValue(mode);
}

function normalizeTeamForRoom(session, requestedTeam = null) {
  const mode = roomMode(session);
  const team = Number(requestedTeam);

  if (mode === 1) return 0;
  if (isZombieModeValue(mode)) {
    if (team === ZOMBIE_TEAM || team === HUMAN_TEAM) return team;
    if (session.team === ZOMBIE_TEAM || session.team === HUMAN_TEAM) return session.team;
    return HUMAN_TEAM;
  }
  if (team === 0 || team === 1 || team === 2) return team;
  if (session.team === 0 || session.team === 1 || session.team === 2) return session.team;
  return isTeamMode(mode) ? (DEFAULT_TEAM === 2 ? 2 : 1) : 0;
}

function autoTeamForTeamRoom(room) {
  const players = Array.from(room?.players?.values?.() || []);
  const team1 = players.filter((playerSession) => Number(playerSession.team) === 1).length;
  const team2 = players.filter((playerSession) => Number(playerSession.team) === 2).length;
  return team2 < team1 ? 2 : 1;
}

function awardBattleExp(session, amount, reason = "kill") {
  if (!ENABLE_BATTLE_EXP || !session) return 0;
  const exp = Math.max(0, Math.trunc(numberOr(amount, 0)));
  if (exp <= 0) return 0;
  session.expEarned = numberOr(session.expEarned, 0) + exp;
  session.matchExp = numberOr(session.matchExp, 0) + exp;
  const clanKoef = numberOr(session.loadedProfile?.clan?.ek, 0);
  const exp2clan = clanKoef > 0 ? Math.round(exp * clanKoef / 100) : 0;
  if (exp2clan > 0) {
    session.exp2clan = numberOr(session.exp2clan, 0) + exp2clan;
  }
  console.log(`[event] exp actor=${session.actorId} player=${session.playerId || "unknown"} reason=${reason} add=${exp} total=${session.expEarned}`);
  return exp;
}

function battleExpForKill(shooter, targetSession) {
  if (!ENABLE_BATTLE_EXP || !shooter || !targetSession || shooter === targetSession) return 0;
  return BATTLE_EXP_PER_KILL;
}

function makeScorePlayerRaw(session, team, options = {}) {
  const entries = [
    { key: rawByte(239), value: rawShort(team) },
    { key: rawByte(69), value: rawInt(numberOr(session.kills, 0)) },
    { key: rawByte(68), value: rawInt(numberOr(session.deaths, 0)) },
    { key: rawByte(67), value: rawInt(numberOr(session.points, 0)) },
    { key: rawByte(32), value: rawInt(numberOr(session.domination, 0)) },
    { key: rawByte(102), value: rawInt(numberOr(session.expEarned, 0)) },
  ];

  const exp2clan = numberOr(session.exp2clan, 0);
  if (exp2clan > 0) {
    entries.push({ key: rawByte(107), value: rawInt(exp2clan) });
  }

  if (options.includeAlive && !session.dead && session.lastTransform) {
    const stats = sessionRuntimeStats(session);
    const maxHealth = sessionMaxHealth(session, stats);
    entries.push(
      { key: rawByte(101), value: rawBool(true) },
      { key: rawByte(237), value: makeTransformRaw(session.lastTransform) },
      { key: rawByte(100), value: rawInt(Math.round(clampNumber(session.health ?? maxHealth, 0, maxHealth))) },
      { key: rawByte(99), value: rawInt(session.energy ?? stats.maxEnergy) },
    );
  }

  return rawHashtable(entries);
}

function teamScorePoints(session, team) {
  if (isControlPointsRoom(session?.room)) {
    return Math.max(0, numberOr(session.room.controlPointScores?.[team], 0));
  }
  if (isZombieRoom(session?.room) && zombieModeForRoom(session.room) === ZOMBIE_MODE.PAUSE) {
    const winnerTeam = Number(session.room.zombieRoundWinnerTeam || 0);
    if (winnerTeam === ZOMBIE_TEAM || winnerTeam === HUMAN_TEAM) {
      return Number(team) === winnerTeam ? 1 : 0;
    }
  }
  let total = 0;
  const players = session?.room?.players || new Map();
  for (const playerSession of players.values()) {
    if (!playerSession || Number(playerSession.team) !== team) continue;
    total += numberOr(playerSession.points, numberOr(playerSession.kills, 0));
  }
  return total;
}

function makeTeamScoreRaw(points) {
  return rawHashtable([{ key: rawByte(67), value: rawInt(Math.max(0, numberOr(points, 0))) }]);
}

function makeScoreRaw(session) {
  const mode = roomMode(session);
  const playerEntries = [];
  const players = session.room?.players || new Map();
  for (const [actorId, playerSession] of players.entries()) {
    if (!playerSession?.actorRaw) continue;
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

  if (hasTeamScoreMode(mode)) {
    const redPoints = teamScorePoints(session, 1);
    const bluePoints = teamScorePoints(session, 2);
    entries.push({
      key: rawByte(87),
      value: rawHashtable([
        { key: rawByte(1), value: makeTeamScoreRaw(redPoints) },
        { key: rawByte(2), value: makeTeamScoreRaw(bluePoints) },
      ]),
    });
  }

  return rawHashtable(entries);
}

function makeScoreUpdateEvent(session) {
  return rawEvent(90, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeScoreRaw(session) },
  ]);
}

function buildSpawnEvent(session, requestedTeam, reason) {
  const team = normalizeTeamForRoom(session, requestedTeam);
  const stats = sessionRuntimeStats(session);
  const wasDead = Boolean(session.dead);
  session.team = team;
  if (!isZombieModeValue(roomMode(session))) {
    session.zombieType = ZOMBIE_TYPE.HUMAN;
  } else if (team === HUMAN_TEAM) {
    session.zombieType = ZOMBIE_TYPE.HUMAN;
  } else if (team === ZOMBIE_TEAM && session.zombieType !== ZOMBIE_TYPE.BOSS) {
    session.zombieType = ZOMBIE_TYPE.REGULAR;
  }
  resetZombieInfectionProgress(session);
  session.spawned = true;
  session.dead = false;
  session.moveSeen = false;
  session.moveCount = 0;
  session.pendingPickupSync = null;
  clearPickupSpawnRepairTimers(session);
  session.visibleItemIds = new Set();
  session.waitingSelfSpawnMove = true;
  resetSessionWeaponStatesForSpawn(session, wasDead ? "respawn" : reason);
  clearSessionActiveShotLedgers(session);
  clearSessionImpactTimers(session);
  invalidatePeerWeaponConfirm(session.room, session.actorId);
  const maxHealth = sessionMaxHealth(session, stats);
  session.health = maxHealth;
  session.energy = stats.maxEnergy;
  const point = spawnPointFor(session, team);
  session.lastTransform = point;
  const spawn = makeSpawnRaw(session, team, point);
  console.log(`[event] ${reason} spawn actor=${session.actorId} team=${team} zombieType=${session.zombieType ?? 0} mode=${roomMode(session)} map=${session.room?.map || DEFAULT_MAP} pos=${fmtPoint(point)} health=${maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump} jumpCap=${stats.jumpCap} enhancers=${session.actorEnhancerCount || 0} enhancerList=${session.actorEnhancerSummary || "none"} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} armorPct=${stats.modifiers.armorPercent} dmgRedPct=${stats.modifiers.damageReductionPercent} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponHeadDmgPct=${stats.modifiers.weaponHeadDamagePercent} weaponAccuracyFlat=${stats.modifiers.weaponAccuracyFlat} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} prot=${formatProtectionBonuses(stats.modifiers.protections)} rangeProt=${formatRangeProtectionBonuses(stats.modifiers.rangeProtections)} wearDmg=${formatDamageBonuses(stats.modifiers.damageBonuses)}`);
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

function makeSpawnEventFromSession(session) {
  if (!session?.spawned || session.dead || !session.lastTransform) return null;
  const team = normalizeTeamForRoom(session, session.team);
  return rawEvent(100, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeSpawnRaw(session, team, session.lastTransform) },
  ]);
}

function makeZombieModeEvent(mode) {
  return rawEvent(73, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: makeZombieModeStateRaw(mode) },
  ]);
}

function makeZombiePlayerUpdateRaw(session, killerActorId = 0) {
  const stats = sessionRuntimeStats(session);
  const maxHealth = sessionMaxHealth(session, stats);
  const entries = [
    { key: rawByte(239), value: rawShort(normalizeTeamForRoom(session, session.team)) },
    { key: rawByte(100), value: rawInt(Math.round(clampNumber(session.health ?? maxHealth, 0, maxHealth))) },
    { key: rawByte(99), value: rawInt(Math.round(clampNumber(session.energy ?? stats.maxEnergy, 0, stats.maxEnergy))) },
    { key: rawByte(10), value: rawByte(clampNumber(session.zombieType ?? ZOMBIE_TYPE.HUMAN, ZOMBIE_TYPE.HUMAN, ZOMBIE_TYPE.BOSS)) },
  ];
  if (Number(killerActorId) > 0) {
    entries.push({ key: rawByte(97), value: rawInt(killerActorId) });
  }
  return rawHashtable(entries);
}

function makeZombiePlayerUpdateEvent(session, killerActorId = 0) {
  return rawEvent(73, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeZombiePlayerUpdateRaw(session, killerActorId) },
  ]);
}

function makePlayerHealthEnergyEvent(session) {
  const stats = sessionRuntimeStats(session);
  const maxHealth = sessionMaxHealth(session, stats);
  return rawEvent(85, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: rawHashtable([
      { key: rawByte(100), value: rawInt(Math.round(clampNumber(session.health ?? maxHealth, 0, maxHealth))) },
      { key: rawByte(99), value: rawInt(Math.round(clampNumber(session.energy ?? stats.maxEnergy, 0, ARMOR_PICKUP_CAP))) },
    ]) },
  ]);
}

function zombieRoomPlayers(room) {
  return Array.from(room?.players?.values?.() || [])
    .filter(Boolean)
    .sort((left, right) => Number(left.actorId || 0) - Number(right.actorId || 0));
}

function zombieReadyPlayers(room) {
  return zombieRoomPlayers(room).filter((playerSession) => playerSession.gameStateRequested);
}

function zombieAlivePlayers(room, team = 0) {
  return zombieRoomPlayers(room).filter((playerSession) => {
    if (!playerSession.spawned || playerSession.dead) return false;
    return !team || Number(playerSession.team) === Number(team);
  });
}

function sendZombiePayloadToReadyRoom(room, payload, channel = 0, currentSession = null, currentResponses = null) {
  if (!payload || !room?.players?.size) return 0;
  let sent = 0;
  for (const playerSession of zombieReadyPlayers(room)) {
    if (currentSession && playerSession === currentSession && Array.isArray(currentResponses)) {
      currentResponses.push(payload);
      sent += 1;
      continue;
    }
    if (sendReliableToSession(playerSession, payload, channel)) sent += 1;
  }
  return sent;
}

function sendZombiePayloadsToReadyRoom(room, payloads, channel = 0, currentSession = null, currentResponses = null) {
  let sent = 0;
  for (const payload of payloads || []) {
    sent += sendZombiePayloadToReadyRoom(room, payload, channel, currentSession, currentResponses);
  }
  return sent;
}

function isStandardRoundRoom(room) {
  const mode = Number(room?.mode || 0);
  return mode === MAP_MODE_DEATHMATCH || mode === MAP_MODE_TEAM_DEATHMATCH || mode === MAP_MODE_CAPTURE_THE_FLAG || mode === MAP_MODE_CONTROL_POINTS;
}

function isStandardRoundPaused(room) {
  return isStandardRoundRoom(room) && room?.standardRoundState === "pause";
}

function isRoundPausedSession(session) {
  return isZombieRoundPausedSession(session) || isStandardRoundPaused(session?.room);
}

function standardReadyPlayers(room) {
  return zombieReadyPlayers(room);
}

function sendStandardPayloadToReadyRoom(room, payload, channel = 0, currentSession = null, currentResponses = null) {
  if (!payload || !room?.players?.size) return 0;
  let sent = 0;
  for (const playerSession of standardReadyPlayers(room)) {
    if (currentSession && playerSession === currentSession && Array.isArray(currentResponses)) {
      currentResponses.push(payload);
      sent += 1;
      continue;
    }
    if (sendReliableToSession(playerSession, payload, channel)) sent += 1;
  }
  return sent;
}

function resetStandardRoundScore(playerSession) {
  playerSession.kills = 0;
  playerSession.deaths = 0;
  playerSession.points = 0;
  playerSession.domination = 0;
  playerSession.revenge = 0;
  resetSessionFragState(playerSession);
}

function clearStandardRoundTimer(room) {
  if (!room?.standardRoundTimer) return;
  clearTimeout(room.standardRoundTimer);
  room.standardRoundTimer = null;
}

function clearStandardRestartTimer(room) {
  if (!room?.standardRestartTimer) return;
  clearTimeout(room.standardRestartTimer);
  room.standardRestartTimer = null;
}

function clearStandardRoundTimers(room) {
  clearStandardRoundTimer(room);
  clearStandardRestartTimer(room);
}

function makeStandardNewGameEvent(room) {
  return rawEvent(91, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: rawHashtable([
      { key: rawByte(95), value: rawLong(room.startedAt) },
    ]) },
  ]);
}

function makeStandardTimeOverEvent(room) {
  const entries = [{ key: rawByte(95), value: rawLong(room.startedAt) }];
  if (Number(room.mode) === MAP_MODE_TEAM_DEATHMATCH || Number(room.mode) === MAP_MODE_CAPTURE_THE_FLAG || Number(room.mode) === MAP_MODE_CONTROL_POINTS) {
    entries.push({ key: rawByte(50), value: rawShortArray([room.standardTeam1Wins || 0, room.standardTeam2Wins || 0]) });
  }
  return rawEvent(92, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: rawHashtable(entries) },
  ]);
}

function standardRoundWinner(room) {
  const players = zombieRoomPlayers(room);
  if (Number(room?.mode) === MAP_MODE_TEAM_DEATHMATCH || Number(room?.mode) === MAP_MODE_CAPTURE_THE_FLAG || Number(room?.mode) === MAP_MODE_CONTROL_POINTS) {
    const source = players[0];
    if (!source) return 0;
    const red = teamScorePoints(source, 1);
    const blue = teamScorePoints(source, 2);
    return red === blue ? 0 : (red > blue ? 1 : 2);
  }
  const ranked = players
    .slice()
    .sort((left, right) => numberOr(right.points, right.kills) - numberOr(left.points, left.kills));
  if (!ranked.length) return 0;
  const first = numberOr(ranked[0].points, ranked[0].kills);
  const second = ranked[1] ? numberOr(ranked[1].points, ranked[1].kills) : -1;
  return first === second ? 0 : Number(ranked[0].actorId || 0);
}

function resetStandardPlayerForNextRound(playerSession) {
  resetStandardRoundScore(playerSession);
  resetZombieInfectionProgress(playerSession);
  clearSpawnMoveWarningTimer(playerSession);
  clearSpawnSelfRetryTimers(playerSession);
  clearSessionWeaponReloadTimers(playerSession);
  clearSessionActiveShotLedgers(playerSession);
  clearSessionImpactTimers(playerSession);
  clearPeerSpawnTimers(playerSession);
  clearPickupSpawnRepairTimers(playerSession);
  clearSpawnStallRecovery(playerSession);
  playerSession.pendingSpawnBroadcast = null;
  playerSession.pendingPickupSync = null;
  playerSession.visibleItemIds = new Set();
  playerSession.team = normalizeTeamForRoom(playerSession, playerSession.team);
  playerSession.zombieType = ZOMBIE_TYPE.HUMAN;
  playerSession.spawned = false;
  playerSession.dead = false;
  playerSession.moveSeen = false;
  playerSession.moveCount = 0;
  playerSession.waitingSelfSpawnMove = false;
  const stats = sessionRuntimeStats(playerSession);
  playerSession.health = stats.maxHealth;
  playerSession.energy = stats.maxEnergy;
}

function scheduleStandardRoundLimit(room, channel = 0) {
  clearStandardRoundTimer(room);
  const timeLimitMs = Math.max(0, numberOr(room?.timeLimit, 0) * 60 * 1000);
  if (!timeLimitMs) return;
  const roundSeq = Number(room.standardRoundSeq || 0);
  room.standardRoundTimer = setTimeout(() => {
    try {
      if (!room || rooms.get(room.name) !== room) return;
      if (!isStandardRoundRoom(room) || room.standardRoundState !== "active" || Number(room.standardRoundSeq || 0) !== roundSeq) return;
      finishStandardRound(room, standardRoundWinner(room), "time-limit", channel);
    } catch (error) {
      console.error(`[round] time-limit failed room=${room?.name || "unknown"} seq=${roundSeq}`, error);
    }
  }, timeLimitMs);
  if (typeof room.standardRoundTimer.unref === "function") room.standardRoundTimer.unref();
}

function startStandardRound(room, channel = 0, reason = "sync") {
  if (!isStandardRoundRoom(room) || room.standardRoundState === "pause" || room.standardRoundState === "active") return 0;
  room.standardRoundSeq = Number(room.standardRoundSeq || 0) + 1;
  room.standardRoundState = "active";
  room.standardRoundWinner = 0;
  room.startedAt = photonNow();
  scheduleStandardRoundLimit(room, channel);
  console.log(`[round] start room=${room.name} map=${room.map} mode=${room.mode} reason=${reason} players=${standardReadyPlayers(room).length} timeLimit=${room.timeLimit} fragLimit=${room.fragLimit}`);
  return 1;
}

function beginNextStandardRound(room, roundSeq, channel = 0) {
  if (!room || rooms.get(room.name) !== room) return;
  if (!isStandardRoundRoom(room) || Number(room.standardRoundSeq || 0) !== Number(roundSeq)) return;

  clearStandardRestartTimer(room);
  if (isCtfRoom(room)) for (const flag of room.flags.values()) resetCtfFlag(room, flag, 4, channel);
  resetControlPointsForRound(room, channel);
  room.startedAt = photonNow();
  room.standardRoundState = "ready";
  room.standardRoundWinner = 0;
  for (const playerSession of zombieRoomPlayers(room)) resetStandardPlayerForNextRound(playerSession);

  const ready = standardReadyPlayers(room);
  const newGameSent = sendStandardPayloadToReadyRoom(room, makeStandardNewGameEvent(room), channel);
  const started = startStandardRound(room, channel, "round-restart");
  console.log(`[round] restart room=${room.name} map=${room.map} mode=${room.mode} ready=${ready.length} newGamePeers=${newGameSent} spawn=client-request started=${started}`);
}

function scheduleStandardRestart(room, channel = 0) {
  clearStandardRestartTimer(room);
  const roundSeq = Number(room.standardRoundSeq || 0);
  room.standardRestartTimer = setTimeout(() => {
    try {
      beginNextStandardRound(room, roundSeq, channel);
    } catch (error) {
      console.error(`[round] restart failed room=${room?.name || "unknown"} seq=${roundSeq}`, error);
    }
  }, STANDARD_ROUND_RESTART_MS);
  if (typeof room.standardRestartTimer.unref === "function") room.standardRestartTimer.unref();
}

function finishStandardRound(room, winner, reason = "unknown", channel = 0, currentSession = null, currentResponses = null) {
  if (!isStandardRoundRoom(room) || room.standardRoundState === "pause") return 0;
  clearStandardRoundTimer(room);
  room.standardRoundState = "pause";
  room.standardRoundWinner = Number(winner || 0);
  room.startedAt = photonNow();
  if (Number(room.mode) === MAP_MODE_TEAM_DEATHMATCH || Number(room.mode) === MAP_MODE_CAPTURE_THE_FLAG || Number(room.mode) === MAP_MODE_CONTROL_POINTS) {
    if (Number(winner) === 1) room.standardTeam1Wins = numberOr(room.standardTeam1Wins, 0) + 1;
    if (Number(winner) === 2) room.standardTeam2Wins = numberOr(room.standardTeam2Wins, 0) + 1;
  }
  const summaries = postStandardRoundBattleSummaries(room, winner, `round-${reason}`);

  for (const playerSession of zombieRoomPlayers(room)) {
    clearSpawnMoveWarningTimer(playerSession);
    clearSpawnSelfRetryTimers(playerSession);
    clearSessionWeaponReloadTimers(playerSession);
    clearSessionActiveShotLedgers(playerSession);
    clearSessionImpactTimers(playerSession);
    clearPeerSpawnTimers(playerSession);
    clearPickupSpawnRepairTimers(playerSession);
    clearSpawnStallRecovery(playerSession);
    playerSession.pendingSpawnBroadcast = null;
    playerSession.waitingSelfSpawnMove = false;
  }

  const scoreSource = currentSession || standardReadyPlayers(room)[0] || zombieRoomPlayers(room)[0];
  const payloads = [
    scoreSource ? makeScoreUpdateEvent(scoreSource) : null,
    makeStandardTimeOverEvent(room),
  ].filter(Boolean);
  let sent = 0;
  for (const payload of payloads) sent += sendStandardPayloadToReadyRoom(room, payload, channel, currentSession, currentResponses);
  scheduleStandardRestart(room, channel);
  console.log(`[round] end room=${room.name} map=${room.map} mode=${room.mode} winner=${winner || "draw"} reason=${reason} players=${standardReadyPlayers(room).length} score=${hasTeamScoreMode(Number(room.mode)) ? `${teamScorePoints(scoreSource, 1)}:${teamScorePoints(scoreSource, 2)}` : "ffa"} summaries=${summaries} sent=${sent}`);
  return sent;
}

function maybeFinishStandardRound(room, reason = "state", channel = 0, currentSession = null, currentResponses = null) {
  if (!isStandardRoundRoom(room) || room.standardRoundState !== "active") return 0;
  const fragLimit = Math.max(1, numberOr(room.fragLimit, 50));
  if (Number(room.mode) === MAP_MODE_TEAM_DEATHMATCH || Number(room.mode) === MAP_MODE_CAPTURE_THE_FLAG || Number(room.mode) === MAP_MODE_CONTROL_POINTS) {
    const source = currentSession || zombieRoomPlayers(room)[0];
    if (!source) return 0;
    const red = teamScorePoints(source, 1);
    const blue = teamScorePoints(source, 2);
    if (red >= fragLimit || blue >= fragLimit) return finishStandardRound(room, red === blue ? 0 : (red > blue ? 1 : 2), reason, channel, currentSession, currentResponses);
    return 0;
  }
  const winner = zombieRoomPlayers(room).find((playerSession) => numberOr(playerSession.points, playerSession.kills) >= fragLimit);
  return winner ? finishStandardRound(room, winner.actorId, reason, channel, currentSession, currentResponses) : 0;
}

function resetZombieRoundScore(playerSession) {
  playerSession.kills = 0;
  playerSession.deaths = 0;
  playerSession.points = 0;
  playerSession.domination = 0;
  playerSession.revenge = 0;
  resetSessionFragState(playerSession);
}

function resetZombieInfectionProgress(playerSession) {
  if (!playerSession) return;
  playerSession.zombieInfectionHits = 0;
  playerSession.zombieLastInfectorActorId = 0;
}

function resetZombieParticipantForHumanStart(playerSession) {
  resetZombieRoundScore(playerSession);
  resetZombieInfectionProgress(playerSession);
  playerSession.team = HUMAN_TEAM;
  playerSession.zombieType = ZOMBIE_TYPE.HUMAN;
  const stats = sessionRuntimeStats(playerSession);
  playerSession.health = stats.maxHealth;
  playerSession.energy = stats.maxEnergy;
  playerSession.dead = false;
}

function chooseZombieBossActorId(room) {
  const players = zombieAlivePlayers(room).length ? zombieAlivePlayers(room) : zombieReadyPlayers(room);
  if (!players.length) return 0;
  const index = Math.floor(Math.random() * players.length);
  return Number(players[index]?.actorId || 0);
}

function makeZombieTimeOverEvent(room) {
  return rawEvent(92, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: rawHashtable([
      { key: rawByte(95), value: rawLong(room.startedAt) },
      { key: rawByte(50), value: rawShortArray([room.zombieWins || 0, room.humanWins || 0]) },
    ]) },
  ]);
}

function makeZombieNewGameEvent(room) {
  return rawEvent(91, [
    { key: 254, value: rawInt(0) },
    { key: 245, value: rawHashtable([
      { key: rawByte(95), value: rawLong(room.startedAt) },
    ]) },
  ]);
}

function clearZombieBossTimer(room) {
  if (!room?.zombieBossTimer) return;
  clearTimeout(room.zombieBossTimer);
  room.zombieBossTimer = null;
}

function clearZombieRoundTimer(room) {
  if (!room?.zombieRoundTimer) return;
  clearTimeout(room.zombieRoundTimer);
  room.zombieRoundTimer = null;
}

function clearZombieRestartTimer(room) {
  if (!room?.zombieRestartTimer) return;
  clearTimeout(room.zombieRestartTimer);
  room.zombieRestartTimer = null;
}

function resetZombiePlayerForNextRound(playerSession) {
  resetZombieRoundScore(playerSession);
  resetZombieInfectionProgress(playerSession);
  clearSpawnMoveWarningTimer(playerSession);
  clearSpawnSelfRetryTimers(playerSession);
  clearSessionWeaponReloadTimers(playerSession);
  clearSessionActiveShotLedgers(playerSession);
  clearSessionImpactTimers(playerSession);
  clearPeerSpawnTimers(playerSession);
  clearPickupSpawnRepairTimers(playerSession);
  clearSpawnStallRecovery(playerSession);
  playerSession.pendingSpawnBroadcast = null;
  playerSession.pendingPickupSync = null;
  playerSession.visibleItemIds = new Set();
  playerSession.team = HUMAN_TEAM;
  playerSession.zombieType = ZOMBIE_TYPE.HUMAN;
  playerSession.spawned = false;
  playerSession.dead = false;
  playerSession.moveSeen = false;
  playerSession.moveCount = 0;
  playerSession.waitingSelfSpawnMove = false;
  const stats = sessionRuntimeStats(playerSession);
  playerSession.health = stats.maxHealth;
  playerSession.energy = stats.maxEnergy;
}

function beginNextZombieRound(room, roundSeq, channel = 0) {
  if (!room || rooms.get(room.name) !== room) return;
  if (!isZombieRoom(room) || Number(room.zombieRoundSeq || 0) !== Number(roundSeq)) return;

  clearZombieRestartTimer(room);
  room.startedAt = photonNow();
  room.zombieMode = ZOMBIE_MODE.WAIT_FOR_PLAYERS;
  room.zombieBossActorId = 0;
  room.zombieRoundWinnerTeam = 0;

  for (const playerSession of zombieRoomPlayers(room)) {
    resetZombiePlayerForNextRound(playerSession);
  }

  const ready = zombieReadyPlayers(room);
  const newGame = makeZombieNewGameEvent(room);
  const waitMode = makeZombieModeEvent(room.zombieMode);
  const newGameSent = sendZombiePayloadToReadyRoom(room, newGame, channel);
  const waitSent = sendZombiePayloadToReadyRoom(room, waitMode, channel);
  const startSent = maybeStartZombieRound(room, channel, "round-restart");
  console.log(`[zombie] restart room=${room.name} ready=${ready.length}/${ZOMBIE_MIN_PLAYERS} newGamePeers=${newGameSent} waitPeers=${waitSent} startSent=${startSent}`);
}

function scheduleZombieRestart(room, channel = 0) {
  clearZombieRestartTimer(room);
  const roundSeq = Number(room.zombieRoundSeq || 0);
  room.zombieRestartTimer = setTimeout(() => beginNextZombieRound(room, roundSeq, channel), ZOMBIE_ROUND_RESTART_MS);
  if (typeof room.zombieRestartTimer.unref === "function") room.zombieRestartTimer.unref();
}

function finishZombieRound(room, winnerTeam, reason = "unknown", channel = 0, currentSession = null, currentResponses = null) {
  if (!isZombieRoom(room)) return 0;
  if (zombieModeForRoom(room) === ZOMBIE_MODE.PAUSE) return 0;
  const normalizedWinner = Number(winnerTeam) === HUMAN_TEAM ? HUMAN_TEAM : ZOMBIE_TEAM;
  clearZombieBossTimer(room);
  clearZombieRoundTimer(room);
  room.zombieMode = ZOMBIE_MODE.PAUSE;
  room.zombieBossActorId = 0;
  room.zombieRoundWinnerTeam = normalizedWinner;
  room.startedAt = photonNow();
  if (normalizedWinner === ZOMBIE_TEAM) room.zombieWins = numberOr(room.zombieWins, 0) + 1;
  else room.humanWins = numberOr(room.humanWins, 0) + 1;
  const summaries = postZombieRoundBattleSummaries(room, normalizedWinner, `zombie-round-${reason}`);

  for (const playerSession of zombieRoomPlayers(room)) {
    clearSpawnMoveWarningTimer(playerSession);
    clearSpawnSelfRetryTimers(playerSession);
    clearSessionWeaponReloadTimers(playerSession);
    clearSessionActiveShotLedgers(playerSession);
    clearSessionImpactTimers(playerSession);
    clearPeerSpawnTimers(playerSession);
    clearPickupSpawnRepairTimers(playerSession);
    clearSpawnStallRecovery(playerSession);
    playerSession.pendingSpawnBroadcast = null;
    playerSession.waitingSelfSpawnMove = false;
  }

  const scoreSource = currentSession || zombieReadyPlayers(room)[0] || zombieRoomPlayers(room)[0];
  const payloads = [
    scoreSource ? makeScoreUpdateEvent(scoreSource) : null,
    makeZombieModeEvent(room.zombieMode),
    makeZombieTimeOverEvent(room),
  ].filter(Boolean);
  const sent = sendZombiePayloadsToReadyRoom(room, payloads, channel, currentSession, currentResponses);
  scheduleZombieRestart(room, channel);
  console.log(`[zombie] round-end room=${room.name} winner=${normalizedWinner === ZOMBIE_TEAM ? "zombies" : "humans"} reason=${reason} aliveZ=${zombieAlivePlayers(room, ZOMBIE_TEAM).length} aliveH=${zombieAlivePlayers(room, HUMAN_TEAM).length} wins=${room.zombieWins || 0}:${room.humanWins || 0} summaries=${summaries} sent=${sent}`);
  return sent;
}

function maybeFinishZombieRound(room, reason = "state", channel = 0, currentSession = null, currentResponses = null) {
  if (!isZombieRoom(room) || zombieModeForRoom(room) !== ZOMBIE_MODE.MAIN) return 0;
  const aliveHumans = zombieAlivePlayers(room, HUMAN_TEAM).length;
  const aliveZombies = zombieAlivePlayers(room, ZOMBIE_TEAM).length;
  if (aliveHumans <= 0) return finishZombieRound(room, ZOMBIE_TEAM, reason, channel, currentSession, currentResponses);
  if (aliveZombies <= 0) return finishZombieRound(room, HUMAN_TEAM, reason, channel, currentSession, currentResponses);
  return 0;
}

function queueZombiePeerActorRepairForReadyRoom(room, channel = 0, reason = "zombie-sync") {
  if (!isZombieRoom(room) || !PEER_ACTOR_REPAIR_DELAYS_MS.length) return 0;
  const players = zombieReadyPlayers(room);
  for (const playerSession of players) {
    queuePeerActorRepair(playerSession, channel, reason);
  }
  return players.length;
}

function queueZombiePlayerUpdateRepair(playerSession, channel = 0, reason = "zombie-update") {
  const room = playerSession?.room;
  const actorId = Number(playerSession?.actorId || 0);
  if (!actorId || !isZombieRoom(room) || !ZOMBIE_UPDATE_REPAIR_DELAYS_MS.length) return 0;
  const roundSeq = Number(room.zombieRoundSeq || 0);
  let queued = 0;
  for (const delayMs of ZOMBIE_UPDATE_REPAIR_DELAYS_MS) {
    const waitMs = Math.max(0, Number(delayMs) || 0);
    const timer = setTimeout(() => {
      if (playerSession.room !== room || room.players.get(actorId) !== playerSession) return;
      if (Number(room.zombieRoundSeq || 0) !== roundSeq) return;
      if (!isZombiePlayerSession(playerSession) || playerSession.dead) return;
      const sent = sendZombiePayloadToReadyRoom(room, makeZombiePlayerUpdateEvent(playerSession), channel);
      console.log(`[zombie] update-repair actor=${actorId} type=${playerSession.zombieType} reason=${reason} delay=${waitMs}ms sent=${sent}`);
    }, waitMs);
    if (typeof timer.unref === "function") timer.unref();
    queued += 1;
  }
  return queued;
}

function zombieRegenRange(session) {
  if (Number(session?.zombieType) === ZOMBIE_TYPE.BOSS) {
    return { min: ZOMBIE_BOSS_REGEN_MIN, max: ZOMBIE_BOSS_REGEN_MAX };
  }
  if (Number(session?.zombieType) === ZOMBIE_TYPE.REGULAR) {
    return { min: ZOMBIE_REGULAR_REGEN_MIN, max: ZOMBIE_REGULAR_REGEN_MAX };
  }
  return null;
}

function runZombieRegenerationTick() {
  for (const room of rooms.values()) {
    if (!isZombieRoom(room) || zombieModeForRoom(room) !== ZOMBIE_MODE.MAIN) continue;
    for (const playerSession of zombieAlivePlayers(room, ZOMBIE_TEAM)) {
      const range = zombieRegenRange(playerSession);
      if (!range || range.max <= 0) continue;
      const stats = sessionRuntimeStats(playerSession);
      const maxHealth = sessionMaxHealth(playerSession, stats);
      const currentHealth = Math.round(clampNumber(playerSession.health ?? maxHealth, 0, maxHealth));
      if (currentHealth <= 0 || currentHealth >= maxHealth) continue;
      const amount = randomIntInclusive(range.min, range.max);
      if (amount <= 0) continue;
      playerSession.health = Math.min(maxHealth, currentHealth + amount);
      const payload = makePlayerHealthEnergyEvent(playerSession);
      const channel = reliableChannelForSession(playerSession, playerSession.lastChannel || 0);
      const sent = sendReliableToSession(playerSession, payload, channel) ? 1 : 0;
      console.log(`[zombie] regen actor=${playerSession.actorId} type=${playerSession.zombieType} hp=${currentHealth}->${playerSession.health}/${maxHealth} add=${playerSession.health - currentHealth} sent=${sent}`);
    }
  }
}

function beginZombieMain(room, roundSeq, channel = 0) {
  if (!room || rooms.get(room.name) !== room) return;
  if (!isZombieRoom(room) || Number(room.zombieRoundSeq || 0) !== Number(roundSeq)) return;
  const players = zombieReadyPlayers(room);
  if (players.length < ZOMBIE_MIN_PLAYERS) {
    room.zombieMode = ZOMBIE_MODE.WAIT_FOR_PLAYERS;
    room.zombieBossActorId = 0;
    room.zombieBossTimer = null;
    sendZombiePayloadToReadyRoom(room, makeZombieModeEvent(room.zombieMode), channel);
    console.log(`[zombie] main cancelled room=${room.name} ready=${players.length}/${ZOMBIE_MIN_PLAYERS}`);
    return;
  }

  const bossActorId = chooseZombieBossActorId(room);
  const bossSession = room.players.get(bossActorId);
  if (!bossSession) return;

  room.zombieMode = ZOMBIE_MODE.MAIN;
  room.zombieBossActorId = bossActorId;
  room.zombieBossTimer = null;

  const stats = sessionRuntimeStats(bossSession);
  bossSession.team = ZOMBIE_TEAM;
  bossSession.zombieType = ZOMBIE_TYPE.BOSS;
  resetZombieInfectionProgress(bossSession);
  bossSession.spawned = true;
  bossSession.dead = false;
  bossSession.waitingSelfSpawnMove = false;
  bossSession.health = sessionMaxHealth(bossSession, stats);
  bossSession.energy = stats.maxEnergy;
  clearSessionWeaponReloadTimers(bossSession);
  clearSessionActiveShotLedgers(bossSession);
  clearSessionImpactTimers(bossSession);

  const modeEvent = makeZombieModeEvent(room.zombieMode);
  const bossEvent = makeZombiePlayerUpdateEvent(bossSession);
  const scoreEvent = makeScoreUpdateEvent(bossSession);
  const modeSent = sendZombiePayloadToReadyRoom(room, modeEvent, channel);
  const bossSent = sendZombiePayloadToReadyRoom(room, bossEvent, channel);
  const scoreSent = sendZombiePayloadToReadyRoom(room, scoreEvent, channel);
  const updateRepairs = queueZombiePlayerUpdateRepair(bossSession, channel, "zombie-main");
  const repairTargets = queueZombiePeerActorRepairForReadyRoom(room, channel, "zombie-main");
  console.log(`[zombie] main room=${room.name} map=${room.map} boss=${bossActorId} players=${players.length} bossHp=${bossSession.health} modePeers=${modeSent} bossPeers=${bossSent} scorePeers=${scoreSent} updateRepairs=${updateRepairs} repairTargets=${repairTargets}`);
}

function scheduleZombieMain(room, channel = 0) {
  clearZombieBossTimer(room);
  const roundSeq = Number(room.zombieRoundSeq || 0);
  room.zombieBossTimer = setTimeout(() => beginZombieMain(room, roundSeq, channel), ZOMBIE_BOSS_INFECTION_MS);
  if (typeof room.zombieBossTimer.unref === "function") room.zombieBossTimer.unref();
}

function scheduleZombieRoundLimit(room, channel = 0) {
  clearZombieRoundTimer(room);
  const timeLimitMs = Math.max(0, numberOr(room?.timeLimit, 0) * 60 * 1000);
  if (!timeLimitMs) return;
  const roundSeq = Number(room.zombieRoundSeq || 0);
  room.zombieRoundTimer = setTimeout(() => {
    if (!room || rooms.get(room.name) !== room) return;
    if (!isZombieRoom(room) || Number(room.zombieRoundSeq || 0) !== roundSeq) return;
    const winner = zombieAlivePlayers(room, HUMAN_TEAM).length > 0 ? HUMAN_TEAM : ZOMBIE_TEAM;
    finishZombieRound(room, winner, "time-limit", channel);
  }, timeLimitMs);
  if (typeof room.zombieRoundTimer.unref === "function") room.zombieRoundTimer.unref();
}

function maybeStartZombieRound(room, channel = 0, reason = "sync", currentSession = null, currentResponses = null) {
  if (!isZombieRoom(room)) return 0;
  if (zombieModeForRoom(room) !== ZOMBIE_MODE.WAIT_FOR_PLAYERS) return 0;
  const players = zombieReadyPlayers(room);
  if (players.length < ZOMBIE_MIN_PLAYERS) return 0;

  room.zombieRoundSeq = Number(room.zombieRoundSeq || 0) + 1;
  room.zombieMode = ZOMBIE_MODE.BOSS_INFECTION;
  room.zombieBossActorId = 0;
  room.zombieRoundWinnerTeam = 0;
  room.startedAt = photonNow();

  let sent = 0;
  for (const playerSession of players) {
    resetZombieParticipantForHumanStart(playerSession);
    const spawnEvent = buildSpawnEvent(playerSession, HUMAN_TEAM, "zombie-round-start");
    sent += sendZombiePayloadToReadyRoom(room, spawnEvent, channel, currentSession, currentResponses);
  }
  sent += sendZombiePayloadToReadyRoom(room, makeZombieModeEvent(room.zombieMode), channel, currentSession, currentResponses);

  scheduleZombieMain(room, channel);
  scheduleZombieRoundLimit(room, channel);
  const repairTargets = queueZombiePeerActorRepairForReadyRoom(room, channel, "zombie-round-start");
  console.log(`[zombie] start room=${room.name} map=${room.map} reason=${reason} ready=${players.length}/${ZOMBIE_MIN_PLAYERS} boss=random-after-spawn infectionMs=${ZOMBIE_BOSS_INFECTION_MS} regularHits=${ZOMBIE_REGULAR_INFECTION_HITS} sent=${sent} repairTargets=${repairTargets}`);
  return sent;
}

function maybeAppendZombieLateJoinSpawn(session, responses, channel = 0) {
  const room = session?.room;
  if (!isZombieRoom(room) || !Array.isArray(responses)) return false;
  if (zombieModeForRoom(room) < ZOMBIE_MODE.BOSS_INFECTION || session.spawned) return false;
  session.team = HUMAN_TEAM;
  session.zombieType = ZOMBIE_TYPE.HUMAN;
  const spawnEvent = buildSpawnEvent(session, HUMAN_TEAM, "zombie-late-join");
  responses.push(spawnEvent);
  sendZombiePayloadToReadyRoom(room, spawnEvent, channel, session, []);
  const repairTargets = queueZombiePeerActorRepairForReadyRoom(room, channel, "zombie-late-join");
  console.log(`[zombie] late-join spawn actor=${session.actorId} room=${room.name} mode=${zombieModeForRoom(room)} repairTargets=${repairTargets}`);
  return true;
}

function buildPeerSpawnReplayEvents(targetSession) {
  if (!REPLAY_PEER_SPAWNS_AFTER_SELF) return [];
  const room = targetSession?.room;
  if (!room?.players?.size) return [];

  const events = [];
  for (const [actorId, playerSession] of room.players.entries()) {
    if (!playerSession || playerSession === targetSession || !playerSession.spawned || playerSession.dead) continue;
    if (!sessionHasActorData(targetSession, actorId)) continue;
    const announceAge = actorAnnounceAgeMs(targetSession, actorId);
    if (!sessionKnowsActor(targetSession, actorId) && announceAge != null && announceAge < ACTOR_JOIN_ASYNC_DELAY_MS) {
      continue;
    }

    const event = makeSpawnEventFromSession(playerSession);
    if (event) events.push(event);
  }

  if (events.length > 0) {
    console.log(`[sync] peer-spawn-after-self target=${targetSession.actorId} peers=${events.length}`);
  }
  return events;
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

function moveDataRawWithRotationKey(data) {
  if (!ADD_MOVE_ROTATION_KEY || !data?.value?.entries || htGet(data, 7) !== undefined) {
    return data?.raw || null;
  }

  const yaw = Number(htGet(data, 5)?.value);
  if (!Number.isFinite(yaw)) return data.raw;

  const entries = [];
  for (const entry of data.value.entries) {
    if (!entry?.key?.raw || !entry?.value?.raw) return data.raw;
    entries.push({ key: entry.key.raw, value: entry.value.raw });
  }
  entries.push({ key: rawByte(7), value: rawFloat(yaw) });
  return rawHashtable(entries);
}

function buildActorDataEvent(session, eventCode, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;
  const dataRaw = eventCode === 99 ? moveDataRawWithRotationKey(data) : data.raw;
  if (!dataRaw) return null;
  return rawEvent(eventCode, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: dataRaw },
  ]);
}

function weaponStateBySlot(session, slot) {
  if (!session.weaponStates) session.weaponStates = makeWeaponRuntimeState(null);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiredWorkshopState = Array.from(session.weaponStates.values()).some(
    (state) => numberOr(state.workshopExpiresAt, 0) > 0 && numberOr(state.workshopExpiresAt, 0) <= nowSeconds
  );
  if (expiredWorkshopState) {
    session.weaponStates = makeWeaponRuntimeState(session.loadedProfile || null);
    console.log(`[workshop] expired runtime actor=${session.actorId || 0} player=${session.playerId || 0}`);
  }
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

function weaponStateConfirmKey(state) {
  if (!state) return "";
  return `${state.slot}:${state.type}:${state.weaponId}:${state.systemName}`;
}

function buildWeaponChangePayloadFromState(state) {
  if (!state) return null;
  return rawHashtable([
    { key: rawByte(78), value: rawInt(state.slot) },
    { key: rawByte(89), value: rawByte(state.type) },
  ]);
}

function buildWeaponChangeEventFromState(session, state) {
  const payload = buildWeaponChangePayloadFromState(state);
  if (!payload) return null;
  return rawEvent(98, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: payload },
  ]);
}

function buildShotWeaponConfirm(session, state) {
  if (!state) return null;
  const key = weaponStateConfirmKey(state);
  if (!key) return null;
  const event = buildWeaponChangeEventFromState(session, state);
  return event ? { event, key, state } : null;
}

function invalidatePeerWeaponConfirm(room, actorId) {
  if (!room?.players) return;
  for (const playerSession of room.players.values()) {
    playerSession?.peerWeaponConfirmKeys?.delete(Number(actorId));
  }
}

function peerWeaponConfirmKnown(playerSession, actorId, key) {
  return playerSession?.peerWeaponConfirmKeys?.get(Number(actorId)) === key;
}

function markPeerWeaponConfirm(playerSession, actorId, key) {
  if (!playerSession.peerWeaponConfirmKeys) playerSession.peerWeaponConfirmKeys = new Map();
  playerSession.peerWeaponConfirmKeys.set(Number(actorId), key);
}

function broadcastShotWeaponConfirmToRoom(sourceSession, confirm, channel = 0) {
  const room = sourceSession?.room;
  if (!room?.players?.size || !confirm?.event || !confirm.key) return 0;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === sourceSession) continue;
    if (!playerSession.gameStateRequested || !playerSession.moveSeen) continue;
    if (peerWeaponConfirmKnown(playerSession, sourceSession.actorId, confirm.key)) continue;
    if (sendReliableToSession(playerSession, confirm.event, channel)) {
      markPeerWeaponConfirm(playerSession, sourceSession.actorId, confirm.key);
      sent += 1;
    }
  }
  return sent;
}

function shotConsumesAmmo(weaponType, launchMode) {
  const type = Number(weaponType);
  const mode = Number(launchMode ?? 0);
  if (isColdArmsWeaponType(type)) return false;
  if (isActiveItemWeaponType(type)) return false;
  if (type === 6) return mode === LAUNCH_MODE.SHOT;
  if (type === 8 || type === 9 || type === 15) return mode === LAUNCH_MODE.LAUNCH;
  return mode === LAUNCH_MODE.SHOT;
}

function isMineWeaponType(type) {
  return ACTIVE_MINE_WEAPON_TYPES.has(Number(type));
}

function isTurretWeaponType(type) {
  return ACTIVE_TURRET_WEAPON_TYPES.has(Number(type));
}

function isActiveItemWeaponType(type) {
  return ACTIVE_ITEM_WEAPON_TYPES.has(Number(type));
}

function isProjectileWeaponType(type) {
  const weaponType = Number(type);
  return weaponType === 8 || weaponType === 9 || weaponType === 15;
}

function isArcingProjectileWeaponType(type) {
  const weaponType = Number(type);
  return weaponType === 9 || weaponType === 15;
}

function isProjectileLaunchShot(state, launchMode) {
  return isProjectileWeaponType(state?.type) && Number(launchMode ?? 0) === LAUNCH_MODE.LAUNCH;
}

function isProjectileImpactShot(state, launchMode) {
  return isProjectileWeaponType(state?.type) && Number(launchMode ?? 0) === LAUNCH_MODE.SHOT;
}

function shotHasLaunchTiming(data) {
  return htGet(data, 9)?.value != null && htGet(data, 14)?.value != null;
}

function shotLaunchMode(data, fallback = LAUNCH_MODE.SHOT) {
  const explicit = htGet(data, 16)?.value;
  if (explicit != null) return numberOr(explicit, fallback);
  return shotHasLaunchTiming(data) ? LAUNCH_MODE.LAUNCH : fallback;
}

function shouldForceExplicitProjectileLaunchMode(data, weaponType, launchMode) {
  return (
    isProjectileWeaponType(weaponType) &&
    Number(launchMode ?? LAUNCH_MODE.SHOT) === LAUNCH_MODE.LAUNCH &&
    htGet(data, 16)?.value == null
  );
}

function describeProjectileLaunchPayloadKeys(data, weaponType, launchMode) {
  if (!isProjectileWeaponType(weaponType) || Number(launchMode ?? LAUNCH_MODE.SHOT) !== LAUNCH_MODE.LAUNCH) return "";
  const hasKey = (key) => (htGet(data, key)?.value != null ? 1 : 0);
  return ` projectileKeys=8:${hasKey(8)},9:${hasKey(9)},14:${hasKey(14)},15:${hasKey(15)},16:${hasKey(16)}`;
}

function shotTimestampKey(data) {
  const value = htGet(data, 8)?.value;
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString();
  const number = Number(value);
  if (Number.isFinite(number)) return String(Math.trunc(number));
  return String(value);
}

function projectileImpactExpiresAt(data, now = Date.now()) {
  const launchAt = Number(htGet(data, 8)?.value);
  const landingAt = Number(htGet(data, 9)?.value);
  const flightMs = Number.isFinite(launchAt) && Number.isFinite(landingAt) && landingAt > launchAt
    ? landingAt - launchAt
    : PROJECTILE_SHOT_MAX_AGE_MS;
  const ttlMs = clampNumber(
    flightMs + PROJECTILE_IMPACT_GRACE_MS,
    PROJECTILE_IMPACT_GRACE_MS,
    PROJECTILE_SHOT_MAX_AGE_MS
  );
  return now + ttlMs;
}

function activeItemShotExpiresAt(data, now = Date.now()) {
  const launchAt = Number(htGet(data, 8)?.value);
  const landingAt = Number(htGet(data, 9)?.value);
  const lifeMs = Number.isFinite(launchAt) && Number.isFinite(landingAt) && landingAt > launchAt
    ? landingAt - launchAt
    : ACTIVE_ITEM_SHOT_MAX_AGE_MS;
  const ttlMs = clampNumber(
    lifeMs + ACTIVE_ITEM_SHOT_GRACE_MS,
    ACTIVE_ITEM_SHOT_GRACE_MS,
    ACTIVE_ITEM_SHOT_MAX_AGE_MS
  );
  return now + ttlMs;
}

function trimActiveProjectileShots(state, now = Date.now()) {
  const shots = state?.activeProjectileShots;
  if (!(shots instanceof Map)) return;
  for (const [key, entry] of shots.entries()) {
    const expiresAt = numberOr(
      entry?.expiresAt,
      numberOr(entry?.createdAt, now) + PROJECTILE_SHOT_MAX_AGE_MS
    );
    if (!entry || now > expiresAt) {
      shots.delete(key);
    }
  }
  while (shots.size > MAX_ACTIVE_PROJECTILE_SHOTS) {
    const oldestKey = shots.keys().next().value;
    if (oldestKey == null) break;
    shots.delete(oldestKey);
  }
}

function isTripleRocketWeaponState(state) {
  const name = stringOr(state?.systemName, "").toLowerCase();
  return name.includes("triplerocket") || name.includes("triple_rocket") || (name.includes("triple") && name.includes("rocket"));
}

function projectileImpactLimitForState(state) {
  return isTripleRocketWeaponState(state) ? 3 : 1;
}

function rememberProjectileLaunch(state, data, now = Date.now()) {
  if (!state) return;
  if (!(state.activeProjectileShots instanceof Map)) state.activeProjectileShots = new Map();
  trimActiveProjectileShots(state, now);
  const key = shotTimestampKey(data);
  if (!key) return;
  const impactLimit = projectileImpactLimitForState(state);
  state.activeProjectileShots.set(key, {
    createdAt: now,
    expiresAt: projectileImpactExpiresAt(data, now),
    impactLimit,
    remainingImpacts: impactLimit,
  });
  trimActiveProjectileShots(state, now);
}

function consumeProjectileImpact(state, data, now = Date.now()) {
  const shots = state?.activeProjectileShots;
  if (!(shots instanceof Map)) return { ok: false, reason: "projectile-missing-launch" };
  trimActiveProjectileShots(state, now);
  const key = shotTimestampKey(data);
  if (!key) return { ok: false, reason: "projectile-missing-timestamp" };
  const entry = shots.get(key);
  if (!entry) return { ok: false, reason: "projectile-missing-launch" };
  const remainingImpacts = Math.max(1, numberOr(entry.remainingImpacts, 1));
  if (remainingImpacts > 1) {
    entry.remainingImpacts = remainingImpacts - 1;
  } else {
    shots.delete(key);
  }
  return { ok: true, reason: "projectile-impact" };
}

function ensureActiveItemShots(session) {
  if (!session) return null;
  if (!(session.activeItemShots instanceof Map)) session.activeItemShots = new Map();
  return session.activeItemShots;
}

function trimActiveItemShots(session, now = Date.now()) {
  const shots = session?.activeItemShots;
  if (!(shots instanceof Map)) return;
  for (const [key, entry] of shots.entries()) {
    const expiresAt = numberOr(
      entry?.expiresAt,
      numberOr(entry?.createdAt, now) + ACTIVE_ITEM_SHOT_MAX_AGE_MS
    );
    if (!entry || now > expiresAt) {
      shots.delete(key);
    }
  }
  while (shots.size > MAX_ACTIVE_ITEM_SHOTS) {
    const oldestKey = shots.keys().next().value;
    if (oldestKey == null) break;
    shots.delete(oldestKey);
  }
}

function rememberActiveItemLaunch(session, weaponType, data, now = Date.now()) {
  const key = shotTimestampKey(data);
  if (!key) return { ok: false, reason: "active-item-missing-timestamp" };
  const shots = ensureActiveItemShots(session);
  if (!shots) return { ok: false, reason: "active-item-missing-session" };
  trimActiveItemShots(session, now);
  const type = Number(weaponType);
  const turretReadyAt = isTurretWeaponType(type) ? now + TURRET_SHOT_WARMUP_MS : 0;
  shots.set(key, {
    type,
    createdAt: now,
    expiresAt: activeItemShotExpiresAt(data, now),
    turretReadyAt,
    nextTurretShotAt: turretReadyAt,
    controlCount: 0,
    shotCount: 0,
  });
  trimActiveItemShots(session, now);
  return { ok: true, reason: "active-item-launch" };
}

function activeItemEntry(session, weaponType, data, now = Date.now()) {
  const shots = session?.activeItemShots;
  if (!(shots instanceof Map)) return { ok: false, reason: "active-item-missing-launch" };
  trimActiveItemShots(session, now);
  const key = shotTimestampKey(data);
  if (!key) return { ok: false, reason: "active-item-missing-timestamp" };
  const entry = shots.get(key);
  if (!entry) return { ok: false, reason: "active-item-missing-launch" };
  const type = Number(weaponType);
  if (Number(entry.type) !== type) {
    return { ok: false, reason: "active-item-type-mismatch" };
  }
  return { ok: true, key, entry, shots };
}

function consumeActiveItemEntry(session, weaponType, data, now = Date.now()) {
  const found = activeItemEntry(session, weaponType, data, now);
  if (!found.ok) return found;
  found.shots.delete(found.key);
  return found;
}

function allowActiveItemShot(session, weaponType, launchMode, data, now = Date.now()) {
  const type = Number(weaponType);
  if (!isActiveItemWeaponType(type)) return null;

  const mode = Number(launchMode ?? LAUNCH_MODE.SHOT);
  if (mode === LAUNCH_MODE.LAUNCH) {
    const launch = rememberActiveItemLaunch(session, type, data, now);
    return launch.ok
      ? { ok: true, reason: launch.reason, intervalMs: 0 }
      : { ok: false, reason: launch.reason, intervalMs: 0 };
  }

  if (isMineWeaponType(type) && mode === LAUNCH_MODE.SHOT) {
    const mine = consumeActiveItemEntry(session, type, data, now);
    return mine.ok
      ? { ok: true, reason: "mine-shot", intervalMs: 0 }
      : { ok: false, reason: mine.reason, intervalMs: 0 };
  }

  if (mode === LAUNCH_MODE.BLOW || mode === LAUNCH_MODE.DISACTIVATE) {
    const item = consumeActiveItemEntry(session, type, data, now);
    if (!item.ok) return { ok: false, reason: item.reason, intervalMs: 0 };
    const reason = isTurretWeaponType(type)
      ? "turret-blow"
      : (mode === LAUNCH_MODE.DISACTIVATE ? "active-item-disactivate" : "mine-disactivate");
    return { ok: true, reason, intervalMs: 0 };
  }

  if (mode === LAUNCH_MODE.TURRET_CONTROL) {
    if (type !== 102) return { ok: false, reason: "turret-control-type", intervalMs: 0 };
    const turret = activeItemEntry(session, type, data, now);
    if (!turret.ok) return { ok: false, reason: turret.reason, intervalMs: 0 };
    turret.entry.controlCount = numberOr(turret.entry.controlCount, 0) + 1;
    return { ok: true, reason: "turret-control", intervalMs: 0 };
  }

  if (mode === LAUNCH_MODE.TURRET_SHOT) {
    if (!isTurretWeaponType(type)) return { ok: false, reason: "turret-shot-type", intervalMs: 0 };
    const turret = activeItemEntry(session, type, data, now);
    if (!turret.ok) return { ok: false, reason: turret.reason, intervalMs: 0 };
    const readyAt = numberOr(turret.entry.turretReadyAt, numberOr(turret.entry.createdAt, now) + TURRET_SHOT_WARMUP_MS);
    if (now + TURRET_SHOT_TIMER_GRACE_MS < readyAt) {
      return { ok: false, reason: "turret-warmup", waitMs: readyAt - now, intervalMs: TURRET_SHOT_INTERVAL_MS };
    }
    const nextAt = numberOr(turret.entry.nextTurretShotAt, 0);
    if (nextAt > 0 && now + TURRET_SHOT_TIMER_GRACE_MS < nextAt) {
      return { ok: false, reason: "turret-rate", waitMs: nextAt - now, intervalMs: TURRET_SHOT_INTERVAL_MS };
    }
    turret.entry.nextTurretShotAt = now + TURRET_SHOT_INTERVAL_MS;
    turret.entry.shotCount = numberOr(turret.entry.shotCount, 0) + 1;
    return { ok: true, reason: "turret-shot", intervalMs: TURRET_SHOT_INTERVAL_MS };
  }

  return { ok: false, reason: "active-item-mode", intervalMs: 0 };
}

function isWeaponControlShot(state, launchMode) {
  if (!state) return false;
  if (isColdArmsWeaponType(state.type)) return false;
  return !shotConsumesAmmo(state.type, launchMode);
}

function isLaunchLoopWeaponType(type) {
  const weaponType = Number(type);
  return weaponType === 5 || weaponType === 6 || weaponType === 11 || weaponType === 12;
}

function isGatlingWeaponType(type) {
  return Number(type) === 6;
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

function reloadDurationForAmountMs(state, amount) {
  const fullReloadMs = numberOr(state?.reloadDurationMs, reloadDurationMsFromRaw(state?.reloadTimeMs));
  if (!isComplexReloadWeaponState(state)) return fullReloadMs;
  return Math.min(fullReloadMs, reloadSingleDurationMs(state));
}

function isReloadWeaponMode(mode) {
  return mode === WEAPON_MODE.RELOADING || mode === WEAPON_MODE.RELOADING_READY;
}

function shotReadyAt(state) {
  return numberOr(state?.shotStartedAt, 0) + numberOr(state?.shotIntervalMs, shotIntervalMsFromRapidity(state?.rapidity));
}

function launchReadyAt(state) {
  return numberOr(state?.launchStartedAt, 0) + numberOr(state?.launchDurationMs, DEFAULT_WEAPON_LAUNCH_DURATION_MS);
}

function setWeaponMode(state, mode, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  state.weaponMode = mode;
  state.modeStartedAt = now;
  return mode;
}

function resetWeaponActionState(state) {
  if (!state) return;
  state.nextShotAt = 0;
  state.shotStartedAt = 0;
  state.launchStartedAt = 0;
  state.meleeDelayedShotUntil = 0;
  state.meleeDelayedShotUsed = false;
}

function resetWeaponReloadState(state) {
  if (!state) return;
  state.reloading = false;
  state.reloadStartedAt = 0;
  state.reloadReadyAt = 0;
  state.reloadFullUntil = 0;
}

function completeWeaponReloadState(state, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  clearWeaponReloadTimer(state);
  resetWeaponReloadState(state);
  return setWeaponMode(state, WEAPON_MODE.READY, now);
}

function refreshWeaponMode(state, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;

  const mode = state.weaponMode || WEAPON_MODE.READY;
  if (mode === WEAPON_MODE.CHANGING) {
    if (numberOr(state.changeUntil, 0) > 0 && now >= state.changeUntil) {
      state.changeUntil = 0;
      return setWeaponMode(state, WEAPON_MODE.READY, now);
    }
    return mode;
  }

  if (mode === WEAPON_MODE.SHOOTING) {
    if (numberOr(state.shotStartedAt, 0) > 0 && now >= shotReadyAt(state)) {
      return setWeaponMode(state, isLaunchLoopWeaponType(state.type) ? WEAPON_MODE.LAUNCHING : WEAPON_MODE.READY, now);
    }
    return mode;
  }

  if (mode === WEAPON_MODE.LAUNCHING) {
    return mode;
  }

  if (!isReloadWeaponMode(mode)) return mode;
  if (!state.reloading || numberOr(state.reloadFullUntil, 0) <= 0) {
    resetWeaponReloadState(state);
    return setWeaponMode(state, WEAPON_MODE.READY, now);
  }

  if (now >= state.reloadFullUntil) {
    return completeWeaponReloadState(state, now);
  }

  if (
    mode === WEAPON_MODE.RELOADING &&
    isComplexReloadWeaponState(state) &&
    numberOr(state.reloadReadyAt, 0) > 0 &&
    now >= state.reloadReadyAt
  ) {
    return setWeaponMode(state, WEAPON_MODE.RELOADING_READY, now);
  }

  return mode;
}

function startWeaponChange(state, reason = "interrupted-by-change", now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  cancelWeaponReload(state, reason, now);
  resetWeaponActionState(state);
  state.changeUntil = now + numberOr(state.changeDurationMs, WEAPON_CHANGE_DURATION_MS);
  return setWeaponMode(state, WEAPON_MODE.CHANGING, now);
}

function startWeaponLaunching(state, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  state.launchStartedAt = now;
  state.nextShotAt = 0;
  return setWeaponMode(state, WEAPON_MODE.LAUNCHING, now);
}

function startWeaponShooting(state, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  state.shotStartedAt = now;
  state.nextShotAt = now + numberOr(state.shotIntervalMs, shotIntervalMsFromRapidity(state.rapidity));
  return setWeaponMode(state, WEAPON_MODE.SHOOTING, now);
}

function stopWeaponAction(state, now = Date.now()) {
  if (!state) return WEAPON_MODE.READY;
  resetWeaponActionState(state);
  return setWeaponMode(state, WEAPON_MODE.READY, now);
}

function startMeleeShotChain(state, now = Date.now()) {
  startWeaponShooting(state, now);
  const intervalMs = numberOr(state.shotIntervalMs, shotIntervalMsFromRapidity(state.rapidity));
  state.meleeDelayedShotUntil = now + Math.max(MELEE_DELAYED_SHOT_MS, intervalMs) + MELEE_DELAYED_SHOT_GRACE_MS;
  state.meleeDelayedShotUsed = false;
}

function consumeMeleeDelayedShot(state) {
  if (!state) return;
  state.meleeDelayedShotUsed = true;
  state.meleeDelayedShotUntil = 0;
}

function clearWeaponReloadTimer(state) {
  if (!state?.reloadTimer) return;
  clearTimeout(state.reloadTimer);
  state.reloadTimer = null;
}

function cancelWeaponReload(state, reason = "cancel", now = Date.now()) {
  if (!state) return;
  clearWeaponReloadTimer(state);
  if (state.reloading) {
    console.log(`[event] reload ${reason} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
  }
  resetWeaponReloadState(state);
  setWeaponMode(state, WEAPON_MODE.READY, now);
}

function clearSessionWeaponReloadTimers(session) {
  for (const state of session?.weaponStates?.values?.() || []) {
    cancelWeaponReload(state, "clear");
  }
}

function resetWeaponStateForSpawn(state, now = Date.now()) {
  if (!state) return null;
  clearWeaponReloadTimer(state);
  state.reloadSeq = (state.reloadSeq || 0) + 1;
  resetWeaponReloadState(state);
  resetWeaponActionState(state);
  state.changeUntil = 0;
  state.loadedAmmo = Math.max(0, numberOr(state.maxLoadedAmmo, 0));
  state.ammoReserve = Math.max(0, numberOr(state.maxAmmoReserve, 0) - state.loadedAmmo);
  state.activeProjectileShots = new Map();
  setWeaponMode(state, WEAPON_MODE.READY, now);
  return `${state.slot}:${state.loadedAmmo}/${state.ammoReserve}`;
}

function resetSessionWeaponStatesForSpawn(session, reason = "spawn") {
  const summaries = [];
  const now = Date.now();
  for (const state of session?.weaponStates?.values?.() || []) {
    const summary = resetWeaponStateForSpawn(state, now);
    if (summary) summaries.push(summary);
  }
  session.currentWeaponSlot = 1;
  invalidatePeerWeaponConfirm(session.room, session.actorId);
  if (summaries.length > 0) {
    console.log(`[event] weapon-reset actor=${session.actorId} reason=${reason} slots=${summaries.length} ammo=${summaries.join(",")}`);
  }
}

function clearSessionActiveShotLedgers(session) {
  if (!session) return;
  session.activeItemShots = new Map();
  for (const state of session.weaponStates?.values?.() || []) {
    state.activeProjectileShots = new Map();
  }
}

function makeReloadUpdateEvent(session, state) {
  if (!state || isColdArmsWeaponType(state.type)) return null;
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

  const now = Date.now();
  const fullReloadMs = numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs));
  const singleReloadMs = reloadSingleDurationMs(state);
  const missing = Math.max(0, state.maxLoadedAmmo - state.loadedAmmo);
  const reserve = Math.max(0, state.ammoReserve);
  const complex = isComplexReloadWeaponState(state);

  if (!complex) {
    if (missing > 0 && reserve > 0) {
      const amount = Math.min(missing, reserve);
      state.loadedAmmo += amount;
      state.ammoReserve -= amount;
      const event = makeReloadUpdateEvent(session, state);
      sendReliableToSession(session, event, channel);
      broadcastReliableToRoom(session, event, channel, "reload", { requireLiveReady: true });
      console.log(`[event] reload tick actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} amount=${amount}`);
    }
    completeWeaponReloadState(state, now);
    return;
  }

  if (state.weaponMode === WEAPON_MODE.RELOADING && now >= numberOr(state.reloadReadyAt, now)) {
    setWeaponMode(state, WEAPON_MODE.RELOADING_READY, now);
  }

  if (missing > 0 && reserve > 0) {
    const amount = Math.min(missing, reserve);
    state.loadedAmmo += amount;
    state.ammoReserve -= amount;
    const event = makeReloadUpdateEvent(session, state);
    sendReliableToSession(session, event, channel);
    broadcastReliableToRoom(session, event, channel, "reload", { requireLiveReady: true });
    console.log(`[event] reload tick actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} amount=${amount}`);
  }

  const remainingMs = Math.max(0, numberOr(state.reloadFullUntil, now + fullReloadMs) - now);
  if (remainingMs <= 0) {
    completeWeaponReloadState(state, now);
    return;
  }

  if (state.loadedAmmo < state.maxLoadedAmmo && state.ammoReserve > 0 && singleReloadMs <= remainingMs) {
    scheduleReloadTick(session, state, channel, reloadSeq, singleReloadMs);
    return;
  }

  scheduleReloadTick(session, state, channel, reloadSeq, remainingMs);
}

function allowWeaponShot(session, state, weaponType, launchMode, data) {
  const now = Date.now();
  const activeItem = allowActiveItemShot(session, weaponType, launchMode, data, now);
  if (activeItem) return activeItem;
  if (!state) return { ok: true, reason: "unknown-state" };

  const weaponMode = refreshWeaponMode(state, now);
  const intervalMs = numberOr(state.shotIntervalMs, shotIntervalMsFromRapidity(state.rapidity));
  const consumesAmmo = shotConsumesAmmo(state.type, launchMode);

  if (isProjectileImpactShot(state, launchMode)) {
    const impact = consumeProjectileImpact(state, data, now);
    if (impact.ok) return { ok: true, reason: impact.reason, intervalMs };
    if (
      isArcingProjectileWeaponType(state.type) &&
      impact.reason === "projectile-missing-launch" &&
      shotTimestampKey(data)
    ) {
      return { ok: true, reason: "projectile-impact-untracked", intervalMs };
    }
    return { ok: false, reason: impact.reason, intervalMs };
  }

  if (weaponMode === WEAPON_MODE.CHANGING) {
    return { ok: false, reason: "changing", waitMs: Math.max(0, numberOr(state.changeUntil, now) - now), intervalMs };
  }

  if (weaponMode === WEAPON_MODE.RELOADING) {
    return { ok: false, reason: "reload", waitMs: Math.max(0, numberOr(state.reloadReadyAt || state.reloadFullUntil, now) - now), intervalMs };
  }

  if (
    weaponMode === WEAPON_MODE.RELOADING_READY &&
    !isComplexReloadWeaponState(state)
  ) {
    return { ok: false, reason: "reload", waitMs: Math.max(0, numberOr(state.reloadFullUntil, now) - now), intervalMs };
  }

  if (isColdArmsWeaponType(state.type)) {
    const mode = Number(launchMode ?? 0);
    if (mode === LAUNCH_MODE.SHOT) {
      if (
        numberOr(state.meleeDelayedShotUntil, 0) > 0 &&
        !state.meleeDelayedShotUsed &&
        now <= state.meleeDelayedShotUntil
      ) {
        return { ok: true, reason: "melee-delayed", intervalMs };
      }
      return {
        ok: false,
        reason: numberOr(state.meleeDelayedShotUntil, 0) > 0 ? "melee-delayed-expired" : "melee-missing-launch",
        waitMs: Math.max(0, numberOr(state.meleeDelayedShotUntil, now) - now),
        intervalMs,
      };
    }

    if (mode === LAUNCH_MODE.LAUNCH) {
      if (state.nextShotAt && now + SHOT_THROTTLE_SLACK_MS < state.nextShotAt) {
        return { ok: false, reason: "rate", waitMs: state.nextShotAt - now, intervalMs };
      }
      if (weaponMode !== WEAPON_MODE.READY) {
        return { ok: false, reason: weaponMode === WEAPON_MODE.SHOOTING ? "shooting" : "weapon-mode", waitMs: Math.max(0, shotReadyAt(state) - now), intervalMs };
      }
      return { ok: true, reason: "melee-launch", intervalMs };
    }

    return { ok: false, reason: "melee-mode", intervalMs };
  }

  if (isWeaponControlShot(state, launchMode)) {
    const mode = Number(launchMode ?? 0);
    if (isGatlingWeaponType(state.type) && mode === LAUNCH_MODE.LAUNCH) {
      if (state.loadedAmmo <= 0) {
        return { ok: false, reason: "empty", intervalMs };
      }
      if (weaponMode !== WEAPON_MODE.READY) {
        return { ok: false, reason: "launch-state", intervalMs };
      }
      startWeaponLaunching(state, now);
      return { ok: true, reason: "launch", intervalMs };
    }
    if (isGatlingWeaponType(state.type) && mode === LAUNCH_MODE.BLOW) {
      stopWeaponAction(state, now);
      return { ok: true, reason: "stop", intervalMs };
    }
    return { ok: true, reason: "control-event", intervalMs };
  }

  if (state.nextShotAt && now + SHOT_THROTTLE_SLACK_MS < state.nextShotAt) {
    return { ok: false, reason: "rate", waitMs: state.nextShotAt - now, intervalMs };
  }

  if (weaponMode === WEAPON_MODE.SHOOTING) {
    return { ok: false, reason: "shooting", waitMs: Math.max(0, shotReadyAt(state) - now), intervalMs };
  }

  if (isLaunchLoopWeaponType(state.type)) {
    if (isGatlingWeaponType(state.type)) {
      if (weaponMode !== WEAPON_MODE.LAUNCHING) {
        return { ok: false, reason: "launch-required", intervalMs };
      }
      if (now < launchReadyAt(state)) {
        return { ok: false, reason: "launching", waitMs: Math.max(0, launchReadyAt(state) - now), intervalMs };
      }
    } else if (weaponMode !== WEAPON_MODE.READY && weaponMode !== WEAPON_MODE.LAUNCHING) {
      return { ok: false, reason: "launch-state", intervalMs };
    }
  } else if (weaponMode !== WEAPON_MODE.READY && weaponMode !== WEAPON_MODE.RELOADING_READY) {
    return { ok: false, reason: "weapon-mode", intervalMs };
  }

  if (!consumesAmmo) {
    return { ok: true, reason: "no-ammo-event", intervalMs };
  }

  if (state.loadedAmmo <= 0) {
    return { ok: false, reason: "empty", intervalMs };
  }

  return { ok: true, reason: "shot", intervalMs };
}

function noteWeaponShot(session, parsed) {
  const data = parsed?.params?.get(245);
  const weaponType = htGet(data, 91)?.value;
  const launchMode = shotLaunchMode(data);
  const state = weaponStateByType(session, weaponType);
  const now = Date.now();
  if (!state) return;
  if (isColdArmsWeaponType(state.type)) {
    const mode = Number(launchMode ?? 0);
    if (mode === 1) startMeleeShotChain(state, now);
    if (mode === 0) consumeMeleeDelayedShot(state);
    return;
  }
  if (!shotConsumesAmmo(state.type, launchMode)) return;
  if (isReloadWeaponMode(refreshWeaponMode(state, now))) cancelWeaponReload(state, "interrupted-by-shot", now);
  state.loadedAmmo = Math.max(0, state.loadedAmmo - 1);
  startWeaponShooting(state, now);
  if (isProjectileLaunchShot(state, launchMode)) rememberProjectileLaunch(state, data, now);
}

function describeShotTargets(data) {
  const targets = htGet(data, 86);
  const targetItems = targets?.value?.kind === "typed-array" ? targets.value.items : null;
  if (!targetItems) return targets ? " targets=unparsed" : " targets=none";
  if (targetItems.length === 0) return " targets=empty";
  const details = targetItems.map((target) => {
    const actorId = htGet(target, 94)?.value;
    const descriptorRaw = htGet(target, 68)?.value;
    if (descriptorRaw == null) return `${actorId ?? "?"}:descriptor=none`;
    const descriptor = Number(descriptorRaw) & 0xff;
    return `${actorId ?? "?"}:descriptor=0x${descriptor.toString(16).padStart(2, "0")}:type=${descriptor & 7}:zone=0x${(descriptor & 48).toString(16).padStart(2, "0")}`;
  });
  return ` targets=${details.join(",")}`;
}

function pointFromHashtable(data) {
  const x = Number(htGet(data, 1)?.value);
  const y = Number(htGet(data, 2)?.value);
  const z = Number(htGet(data, 3)?.value);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function distanceBetweenPoints(left, right) {
  if (!left || !right) return null;
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pointOffset(point, y = 0) {
  if (!point) return null;
  const x = Number(point.x);
  const baseY = Number(point.y);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(baseY) || !Number.isFinite(z)) return null;
  return { x, y: baseY + y, z };
}

function angleBetweenVectorsRadians(left, right) {
  if (!left || !right) return null;
  const leftLength = Math.hypot(left.x, left.y, left.z);
  const rightLength = Math.hypot(right.x, right.y, right.z);
  if (leftLength <= 0 || rightLength <= 0) return null;
  const cosine = clampNumber(
    (left.x * right.x + left.y * right.y + left.z * right.z) / (leftLength * rightLength),
    -1,
    1
  );
  return Math.acos(cosine);
}

function isClientSegmentMeleeTarget(shooter, target) {
  if (!shooter || !target || shooter === target) return false;
  return Number(shooter.team) !== Number(target.team) ||
    roomMode(shooter) === MAP_MODE_DEATHMATCH ||
    Boolean(shooter.room?.friendlyFire);
}

function recoverMeleeSegmentTargetBodies(session, data, state, weaponType, launchMode) {
  if (
    !isColdArmsWeaponType(weaponType) ||
    Number(launchMode ?? LAUNCH_MODE.SHOT) !== LAUNCH_MODE.SHOT ||
    !session?.lastTransform ||
    !state
  ) {
    return null;
  }

  // Exact client basis from ShotCalculator.SegmentShot(): both actors are
  // evaluated at transform.position + (0, 3.5, 0), in weapon rad/ang.
  const attackerCenter = pointOffset(session.lastTransform, 3.5);
  const origin = pointFromHashtable(htGet(data, 11));
  if (!attackerCenter || !origin) return null;
  const aimVector = {
    x: origin.x - attackerCenter.x,
    y: origin.y - attackerCenter.y,
    z: origin.z - attackerCenter.z,
  };
  if (Math.hypot(aimVector.x, aimVector.y, aimVector.z) <= 0) return null;

  const distance = Math.max(0, numberOr(state.meleeDistance, MELEE_DEFAULT_DISTANCE));
  const angle = Math.max(0, numberOr(state.meleeAngle, MELEE_DEFAULT_ANGLE));
  const bodies = [];
  for (const target of session.room?.players?.values?.() || []) {
    if (
      !target?.spawned ||
      target.dead ||
      !target.lastTransform ||
      !isClientSegmentMeleeTarget(session, target)
    ) {
      continue;
    }
    const targetCenter = pointOffset(target.lastTransform, 3.5);
    if (!targetCenter) continue;
    const targetVector = {
      x: targetCenter.x - attackerCenter.x,
      y: targetCenter.y - attackerCenter.y,
      z: targetCenter.z - attackerCenter.z,
    };
    if (Math.hypot(targetVector.x, targetVector.y, targetVector.z) > distance) continue;
    const targetAngle = angleBetweenVectorsRadians(targetVector, aimVector);
    if (targetAngle == null || targetAngle > angle) continue;

    bodies.push(readTypedRaw(rawHashtable([
      { key: rawByte(94), value: rawInt(target.actorId) },
      { key: rawByte(68), value: rawByte(SHOT_TARGET_PLAYER) },
    ]), 0));
  }
  return bodies;
}

function formatCaptureDistance(distance) {
  return Number.isFinite(distance) ? distance.toFixed(2) : "unknown";
}

function describeShotDamageContext(session, data, state) {
  const targets = htGet(data, 86);
  const targetItems = targets?.value?.kind === "typed-array" ? targets.value.items : null;
  if (!targetItems?.length) return "";

  const origin = pointFromHashtable(htGet(data, 11));
  const weapon = state
    ? ` weapon=${state.systemName}#${state.weaponId} cfgDmg=${state.shortDamage.join("-")}/${state.mediumDamage.join("-")}/${state.longDamage.join("-")} crit=${state.crit} dev=${state.deviation}`
    : " weapon=unknown";
  const context = targetItems.map((target) => {
    const actorId = Number(htGet(target, 94)?.value);
    const targetSession = Number.isFinite(actorId) ? session.room?.players?.get(actorId) : null;
    if (!targetSession) return `${Number.isFinite(actorId) ? actorId : "?"}:session=missing`;
    const stats = sessionRuntimeStats(targetSession);
    const maxHealth = sessionMaxHealth(targetSession, stats);
    const actorDistance = distanceBetweenPoints(session.lastTransform, targetSession.lastTransform);
    const originDistance = distanceBetweenPoints(origin, targetSession.lastTransform);
    const health = targetSession.health ?? maxHealth;
    const energy = targetSession.energy ?? stats.maxEnergy;
    return `${actorId}:actorDist=${formatCaptureDistance(actorDistance)}:originDist=${formatCaptureDistance(originDistance)}:hp=${health}/${maxHealth}:energy=${energy}/${stats.maxEnergy}:prot=${formatProtectionBonuses(stats.modifiers.protections)}:rangeProt=${formatRangeProtectionBonuses(stats.modifiers.rangeProtections)}`;
  });
  return `${weapon} origin=${origin ? fmtVector(origin) : "unknown"} context=${context.join(",")}`;
}

const SHOT_TARGET_PLAYER = 1;
const HIT_ZONE_ENGINE = 16;
const HIT_ZONE_CABIN = 32;

function rawDamageShort(value) {
  return rawShort(Math.round(clampNumber(value, 0, 32767)));
}

function fallbackWeaponStateByType(weaponType) {
  const type = Number(weaponType);
  if (!Number.isFinite(type)) return null;
  for (const state of makeWeaponRuntimeState(null).values()) {
    if (state.type === type) return state;
  }
  return {
    slot: 0,
    index: 0,
    weaponId: type,
    type,
    systemName: `weapon_type_${type}`,
    crit: 0,
    deviation: 0,
    shortDamage: [1, 1],
    mediumDamage: [1, 1],
    longDamage: [1, 1],
  };
}

function shotDamageState(session, weaponType, state) {
  if (state) return state;
  if (isActiveItemWeaponType(weaponType)) return null;
  return state || fallbackWeaponStateByType(weaponType);
}

function weaponProtectionKey(weaponType) {
  switch (Number(weaponType)) {
    case 1:
    case 2:
      return "melee";
    case 3:
      return "pistol";
    case 5:
      return "flamer";
    case 6:
    case 102:
      return "machinegun";
    case 7:
      return "shotgun";
    case 8:
      return "rocket";
    case 9:
    case 15:
      return "grenade";
    case 10:
      return "sniper";
    case 11:
      return "snow";
    default:
      return "automatic";
  }
}

function isExplosiveDamageWeapon(weaponType, launchMode) {
  const type = Number(weaponType);
  const mode = Number(launchMode ?? 0);
  if ((type === 8 || type === 9 || type === 15) && mode !== LAUNCH_MODE.LAUNCH) return true;
  if (isMineWeaponType(type) && mode === LAUNCH_MODE.SHOT) return true;
  return type === 108 && mode === LAUNCH_MODE.TURRET_SHOT;
}

function explosionDistanceCoefficient(distance) {
  if (!Number.isFinite(distance)) return 1;
  if (distance <= DAMAGE_EXPLOSION_FULL_RADIUS) return 1;
  if (distance >= DAMAGE_EXPLOSION_ZERO_RADIUS) return 0;
  const span = DAMAGE_EXPLOSION_ZERO_RADIUS - DAMAGE_EXPLOSION_FULL_RADIUS;
  return Math.max(0, Math.min(1, 1 - (distance - DAMAGE_EXPLOSION_FULL_RADIUS) / span));
}

function damageRangeName(distance) {
  if (!Number.isFinite(distance)) return "medium";
  if (distance <= DAMAGE_SHORT_RANGE) return "short";
  if (distance <= DAMAGE_MEDIUM_RANGE) return "medium";
  return "long";
}

function normalizedDamagePair(pair) {
  const first = Math.max(0, numberOr(pair?.[0], 0));
  const second = Math.max(0, numberOr(pair?.[1], first));
  return first <= second ? [first, second] : [second, first];
}

function damagePairAverage(pair) {
  const [minDamage, maxDamage] = normalizedDamagePair(pair);
  return (minDamage + maxDamage) / 2;
}

function balancedDamagePairs(state) {
  if (!DAMAGE_SORT_RANGES_BY_POWER) {
    return {
      short: normalizedDamagePair(state?.shortDamage),
      medium: normalizedDamagePair(state?.mediumDamage),
      long: normalizedDamagePair(state?.longDamage),
    };
  }

  const ordered = [
    { source: "short", pair: normalizedDamagePair(state?.shortDamage) },
    { source: "medium", pair: normalizedDamagePair(state?.mediumDamage) },
    { source: "long", pair: normalizedDamagePair(state?.longDamage) },
  ].sort((left, right) => damagePairAverage(right.pair) - damagePairAverage(left.pair));

  return {
    short: ordered[0]?.pair || [0, 0],
    medium: ordered[1]?.pair || ordered[0]?.pair || [0, 0],
    long: ordered[2]?.pair || ordered[1]?.pair || ordered[0]?.pair || [0, 0],
  };
}

function damagePairForRange(state, range) {
  const pairs = balancedDamagePairs(state);
  if (range === "short") return pairs.short;
  if (range === "long") return pairs.long;
  return pairs.medium;
}

function hitZoneMultiplier(hitZone) {
  if (hitZone === HIT_ZONE_CABIN) return DAMAGE_HEAD_MULTIPLIER;
  if (hitZone === HIT_ZONE_ENGINE) return DAMAGE_ENGINE_MULTIPLIER;
  return 1;
}

function sessionCurrentHealthEnergy(session) {
  const stats = sessionRuntimeStats(session);
  const maxHealth = sessionMaxHealth(session, stats);
  return {
    stats,
    maxHealth,
    health: Math.round(clampNumber(session.health ?? maxHealth, 0, maxHealth)),
    energy: Math.round(clampNumber(session.energy ?? stats.maxEnergy, 0, ARMOR_PICKUP_CAP)),
  };
}

function friendlyFireBlocked(shooter, target) {
  if (shooter && target && shooter === target) return false;
  const mode = roomMode(shooter);
  if (!hasTeamDamageMode(mode) || shooter.room?.friendlyFire) return false;
  const shooterTeam = Number(shooter.team);
  const targetTeam = Number(target.team);
  return shooterTeam > 0 && targetTeam > 0 && shooterTeam === targetTeam;
}

function shotTimestampValue(data) {
  const timestamp = htGet(data, 8)?.value;
  return timestamp == null ? photonNow() : timestamp;
}

function pointSeedValue(point) {
  if (!point) return "none";
  return `${Number(point.x).toFixed(3)},${Number(point.y).toFixed(3)},${Number(point.z).toFixed(3)}`;
}

function shotRandomSeedParts(data, shooter, targetActorId, targetIndex, weaponType, range) {
  return [
    shooter?.actorId ?? "?",
    targetActorId,
    targetIndex,
    weaponType,
    range,
    shotTimestampValue(data),
    pointSeedValue(pointFromHashtable(htGet(data, 11))),
    pointSeedValue(pointFromHashtable(htGet(data, 12))),
  ];
}

function shotImpulseVector(data, shooter, target) {
  const origin = pointFromHashtable(htGet(data, 11)) || shooter.lastTransform;
  const destination = target.lastTransform;
  if (!origin || !destination) return null;
  const dx = Number(destination.x) - Number(origin.x);
  const dy = Number(destination.y) - Number(origin.y);
  const dz = Number(destination.z) - Number(origin.z);
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(length) || length <= 0.0001) return null;
  return { x: dx / length, y: dy / length, z: dz / length };
}

function makePointRaw(point) {
  return rawHashtable([
    { key: rawByte(1), value: rawFloat(point.x) },
    { key: rawByte(2), value: rawFloat(point.y) },
    { key: rawByte(3), value: rawFloat(point.z) },
  ]);
}

const KILL_FRAG_TYPE_REVENGE = 34;
const KILL_FRAG_TYPE_DOMINATION = 35;

function sessionFragPlayerId(session) {
  const actorId = Number(session?.actorId || 0);
  if (Number.isInteger(actorId) && actorId > 0) return actorId;
  const playerId = Number(session?.playerId || 0);
  return Number.isInteger(playerId) && playerId > 0 ? playerId : 0;
}

function ensureKillStreakByVictim(session) {
  if (!(session?.killStreakByVictim instanceof Map)) session.killStreakByVictim = new Map();
  return session.killStreakByVictim;
}

function ensureDominatedBy(session) {
  if (!(session?.dominatedBy instanceof Set)) session.dominatedBy = new Set();
  return session.dominatedBy;
}

function resetSessionFragState(session) {
  if (!session) return;
  session.domination = 0;
  session.revenge = 0;
  session.maxDomination = 0;
  session.maxRevenge = 0;
  session.revengeStreak = 0;
  session.killStreakByVictim = new Map();
  session.dominatedBy = new Set();
}

function recordKillFragState(shooter, targetSession) {
  if (!shooter || !targetSession || shooter === targetSession) return null;
  const shooterPlayerId = sessionFragPlayerId(shooter);
  const targetPlayerId = sessionFragPlayerId(targetSession);
  if (!shooterPlayerId || !targetPlayerId) return null;

  const shooterStreaks = ensureKillStreakByVictim(shooter);
  const targetDominatedBy = ensureDominatedBy(targetSession);
  const shooterDominatedBy = ensureDominatedBy(shooter);
  const streak = numberOr(shooterStreaks.get(targetPlayerId), 0) + 1;
  shooterStreaks.set(targetPlayerId, streak);
  ensureKillStreakByVictim(targetSession).set(shooterPlayerId, 0);

  if (shooterDominatedBy.has(targetPlayerId)) {
    shooterDominatedBy.delete(targetPlayerId);
    shooter.revenge = numberOr(shooter.revenge, 0) + 1;
    shooter.matchRevenge = numberOr(shooter.matchRevenge, 0) + 1;
    shooter.revengeStreak = numberOr(shooter.revengeStreak, 0) + 1;
    shooter.maxRevenge = Math.max(numberOr(shooter.maxRevenge, 0), numberOr(shooter.revengeStreak, 0));
    return {
      code: KILL_FRAG_TYPE_REVENGE,
      name: "revenge",
      dominationStreak: 0,
      revengeStreak: numberOr(shooter.revengeStreak, 0),
    };
  }

  shooter.revengeStreak = 0;
  if (DOMINATION_STREAK_KILLS > 0 && streak >= DOMINATION_STREAK_KILLS && !targetDominatedBy.has(shooterPlayerId)) {
    targetDominatedBy.add(shooterPlayerId);
    shooter.domination = numberOr(shooter.domination, 0) + 1;
    shooter.matchDomination = numberOr(shooter.matchDomination, 0) + 1;
    shooter.maxDomination = Math.max(numberOr(shooter.maxDomination, 0), streak);
    return {
      code: KILL_FRAG_TYPE_DOMINATION,
      name: "domination",
      dominationStreak: streak,
      revengeStreak: 0,
    };
  }

  return null;
}

function makeKillPlayerEvent(shooter, targetActorId, weaponType, hitZone, impulse, fragInfo = null) {
  const current = sessionCurrentHealthEnergy(shooter);
  const entries = [
    { key: rawByte(94), value: rawInt(targetActorId) },
    { key: rawByte(91), value: rawByte(weaponType) },
    { key: rawByte(68), value: rawByte(hitZone) },
    { key: rawByte(92), value: rawInt(current.health) },
    { key: rawByte(93), value: rawInt(current.energy) },
  ];
  if (impulse) entries.push({ key: rawByte(54), value: makePointRaw(impulse) });
  if (fragInfo?.code) entries.push({ key: rawByte(33), value: rawByte(fragInfo.code) });
  return rawEvent(95, [
    { key: 254, value: rawInt(shooter.actorId) },
    { key: 245, value: rawHashtable(entries) },
  ]);
}

function isZombieInfectionHit(shooter, targetSession, weaponType) {
  if (!isZombieModeValue(roomMode(shooter))) return false;
  if (Number(weaponType) !== 1) return false;
  return Number(shooter?.team) === ZOMBIE_TEAM && Number(targetSession?.team) === HUMAN_TEAM;
}

function noteZombieInfectionHit(shooter, targetSession) {
  const isBoss = Number(shooter?.zombieType) === ZOMBIE_TYPE.BOSS;
  const required = isBoss ? 1 : ZOMBIE_REGULAR_INFECTION_HITS;
  const hits = isBoss ? 1 : Math.min(required, numberOr(targetSession?.zombieInfectionHits, 0) + 1);
  if (targetSession) {
    targetSession.zombieInfectionHits = hits;
    targetSession.zombieLastInfectorActorId = numberOr(shooter?.actorId, 0);
  }
  return { complete: hits >= required, hits, required, isBoss };
}

function applyZombieInfectionHit(shooter, targetSession, context = {}) {
  let expAwarded = 0;
  let exp2clanAwarded = 0;
  let fragInfo = null;

  if (targetSession !== shooter) {
    shooter.kills = numberOr(shooter.kills, 0) + 1;
    shooter.points = numberOr(shooter.points, 0) + 1;
    shooter.matchKills = numberOr(shooter.matchKills, 0) + 1;
    if (context.hitZone === HIT_ZONE_CABIN) shooter.matchHeadKills = numberOr(shooter.matchHeadKills, 0) + 1;
    if (context.hitZone === HIT_ZONE_ENGINE) shooter.matchNutsKills = numberOr(shooter.matchNutsKills, 0) + 1;
    targetSession.deaths = numberOr(targetSession.deaths, 0) + 1;
    targetSession.matchDeaths = numberOr(targetSession.matchDeaths, 0) + 1;
    fragInfo = recordKillFragState(shooter, targetSession);
    expAwarded = awardBattleExp(shooter, battleExpForKill(shooter, targetSession), "zombie-infect");
    exp2clanAwarded = expAwarded > 0 ? Math.round(expAwarded * numberOr(shooter.loadedProfile?.clan?.ek, 0) / 100) : 0;
  }

  clearSpawnMoveWarningTimer(targetSession);
  clearSpawnSelfRetryTimers(targetSession);
  clearSessionWeaponReloadTimers(targetSession);
  clearSessionActiveShotLedgers(targetSession);
  clearSessionImpactTimers(targetSession);
  clearPeerSpawnTimers(targetSession);
  clearPickupSpawnRepairTimers(targetSession);
  clearSpawnStallRecovery(targetSession);
  targetSession.pendingSpawnBroadcast = null;
  resetZombieInfectionProgress(targetSession);
  targetSession.team = ZOMBIE_TEAM;
  targetSession.zombieType = ZOMBIE_TYPE.REGULAR;
  targetSession.spawned = true;
  targetSession.dead = false;
  targetSession.waitingSelfSpawnMove = false;
  const stats = sessionRuntimeStats(targetSession);
  targetSession.health = sessionMaxHealth(targetSession, stats);
  targetSession.energy = stats.maxEnergy;
  const updateRepairs = queueZombiePlayerUpdateRepair(targetSession, targetSession.lastChannel || shooter.lastChannel || 0, "zombie-infect");

  postBattleEvent(targetSession, "death", {
    health: targetSession.health,
    energy: targetSession.energy,
    killerPlayerId: shooter.playerId,
    victimPlayerId: targetSession.playerId,
    killerPlayerName: shooter.playerName,
    victimPlayerName: targetSession.playerName,
    killerActorId: shooter.actorId,
    victimActorId: targetSession.actorId,
    weaponId: numberOr(context.weaponId, context.weaponType),
    weaponType: context.weaponType,
    weaponSystemName: stringOr(context.weaponSystemName, "OHCA_Zombie"),
    hitZone: context.hitZone,
    healthDamage: 0,
    energyDamage: 0,
    expAwarded,
    exp2clan: exp2clanAwarded,
    fragType: fragInfo?.name || "zombie-infect",
    domination: fragInfo?.code === KILL_FRAG_TYPE_DOMINATION ? 1 : 0,
    revenge: fragInfo?.code === KILL_FRAG_TYPE_REVENGE ? 1 : 0,
    dominationStreak: numberOr(fragInfo?.dominationStreak, 0),
    revengeStreak: numberOr(fragInfo?.revengeStreak, 0),
    zombieUpdateRepairs: updateRepairs,
  });

  return {
    fragInfo,
    expAwarded,
    event: makeZombiePlayerUpdateEvent(targetSession, shooter.actorId),
  };
}

function makePlayerImpactEvent(shooter, targetActorId, impactType, healthDamage, energyDamage) {
  return rawEvent(74, [
    { key: 254, value: rawInt(shooter.actorId) },
    { key: 245, value: rawHashtable([
      { key: rawByte(94), value: rawInt(targetActorId) },
      { key: rawByte(52), value: rawByte(impactType) },
      { key: rawByte(92), value: rawDamageShort(healthDamage) },
      { key: rawByte(93), value: rawDamageShort(energyDamage) },
    ]) },
  ]);
}

function ensureSessionImpactTimers(session) {
  if (!session) return null;
  if (!session.impactTimers) session.impactTimers = new Map();
  return session.impactTimers;
}

function clearImpactDotState(targetSession, impactType) {
  const timers = targetSession?.impactTimers;
  const key = Number(impactType);
  const state = timers?.get(key);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  timers.delete(key);
}

function clearSessionImpactTimers(session) {
  if (!session?.impactTimers) return;
  for (const state of session.impactTimers.values()) {
    if (state?.timer) clearTimeout(state.timer);
  }
  session.impactTimers = new Map();
}

function hasSelectedEnhancer(profile, enhancerType) {
  const type = Number(enhancerType);
  if (!type) return false;
  return selectedEnhancers(profile).some((entry) => Number(entry.enhancerType) === type);
}

function impactDamageReductionForTarget(targetSession, impactType) {
  const stats = sessionRuntimeStats(targetSession);
  const damageReduction = clampNumber(
    stats.modifiers.damageReductionPercent ?? 0,
    0,
    DAMAGE_MAX_PROTECTION_PERCENT
  );
  const enhancerType = IMPACT_PROTECTION_ENHANCER_BY_TYPE.get(Number(impactType));
  const enhancerReduction = enhancerType && hasSelectedEnhancer(targetSession.loadedProfile, enhancerType) ? 50 : 0;
  return { damageReduction, enhancerReduction };
}

function impactDotRequestedDamage(effect) {
  const minDamage = Math.max(0, numberOr(effect.min, 0));
  const maxDamage = Math.max(minDamage, numberOr(effect.max, minDamage));
  const roll = deterministicUnit(
    BUILD_ID,
    "impact-dot",
    effect.token,
    effect.tick,
    effect.shooter?.actorId ?? "?",
    effect.targetActorId,
    effect.weaponId,
    effect.type
  );
  return minDamage + Math.round((maxDamage - minDamage) * roll);
}

function applyImpactDotDamage(effect, targetSession) {
  const targetCurrent = sessionCurrentHealthEnergy(targetSession);
  const requestedDamage = impactDotRequestedDamage(effect);
  const referenceMultiplier = Math.max(0.05, 1 - IMPACT_REFERENCE_DAMAGE_REDUCTION / 100);
  const { damageReduction, enhancerReduction } = impactDamageReductionForTarget(targetSession, effect.type);
  const totalDamage = Math.max(0, Math.round(
    (requestedDamage / referenceMultiplier) *
    (1 - damageReduction / 100) *
    (1 - enhancerReduction / 100)
  ));
  const energyDamage = Math.min(targetCurrent.energy, totalDamage);
  const healthDamage = Math.min(targetCurrent.health, Math.max(0, totalDamage - energyDamage));
  targetSession.energy = targetCurrent.energy - energyDamage;
  targetSession.health = targetCurrent.health - healthDamage;
  return {
    targetCurrent,
    requestedDamage,
    totalDamage,
    healthDamage,
    energyDamage,
    damageReduction,
    enhancerReduction,
  };
}

function impactDotSourceStillValid(effect, targetSession) {
  const shooter = effect?.shooter;
  const room = shooter?.room;
  if (!room || !targetSession?.room || targetSession.room !== room) return false;
  if (room.players?.get(shooter.actorId) !== shooter) return false;
  if (room.players?.get(targetSession.actorId) !== targetSession) return false;
  return Boolean(targetSession.spawned && !targetSession.dead);
}

function applyImpactDotKill(effect, targetSession, damage) {
  const shooter = effect.shooter;
  targetSession.dead = true;
  targetSession.waitingSelfSpawnMove = false;
  resetZombieInfectionProgress(targetSession);
  targetSession.deaths = numberOr(targetSession.deaths, 0) + 1;
  targetSession.matchDeaths = numberOr(targetSession.matchDeaths, 0) + 1;
  let expAwarded = 0;
  let exp2clanAwarded = 0;
  let fragInfo = null;
  if (targetSession !== shooter) {
    shooter.kills = numberOr(shooter.kills, 0) + 1;
    shooter.points = numberOr(shooter.points, 0) + 1;
    shooter.matchKills = numberOr(shooter.matchKills, 0) + 1;
    fragInfo = recordKillFragState(shooter, targetSession);
    expAwarded = awardBattleExp(shooter, battleExpForKill(shooter, targetSession), "dot-kill");
    exp2clanAwarded = expAwarded > 0 ? Math.round(expAwarded * numberOr(shooter.loadedProfile?.clan?.ek, 0) / 100) : 0;
  } else {
    shooter.matchSuicides = numberOr(shooter.matchSuicides, 0) + 1;
  }
  clearSpawnMoveWarningTimer(targetSession);
  clearSpawnSelfRetryTimers(targetSession);
  clearSessionWeaponReloadTimers(targetSession);
  clearSessionActiveShotLedgers(targetSession);
  clearSessionImpactTimers(targetSession);
  clearPeerSpawnTimers(targetSession);
  clearPickupSpawnRepairTimers(targetSession);
  clearSpawnStallRecovery(targetSession);
  targetSession.pendingSpawnBroadcast = null;
  postBattleEvent(targetSession, "death", {
    health: targetSession.health,
    energy: targetSession.energy,
    killerPlayerId: shooter.playerId,
    victimPlayerId: targetSession.playerId,
    killerPlayerName: shooter.playerName,
    victimPlayerName: targetSession.playerName,
    killerActorId: shooter.actorId,
    victimActorId: targetSession.actorId,
    weaponId: numberOr(effect.weaponId, effect.weaponType),
    weaponType: effect.weaponType,
    weaponSystemName: stringOr(effect.systemName, ""),
    hitZone: 0,
    healthDamage: damage.healthDamage,
    energyDamage: damage.energyDamage,
    expAwarded,
    exp2clan: exp2clanAwarded,
    fragType: fragInfo?.name || "none",
    domination: fragInfo?.code === KILL_FRAG_TYPE_DOMINATION ? 1 : 0,
    revenge: fragInfo?.code === KILL_FRAG_TYPE_REVENGE ? 1 : 0,
    dominationStreak: numberOr(fragInfo?.dominationStreak, 0),
    revengeStreak: numberOr(fragInfo?.revengeStreak, 0),
  });
  return makeKillPlayerEvent(shooter, targetSession.actorId, effect.weaponType, 0, null, fragInfo);
}

function sendImpactDotPayload(effect, payload, label, options = {}) {
  if (!payload || !effect?.shooter) return 0;
  const channel = effect.channel ?? 0;
  let sent = sendReliableToSession(effect.shooter, payload, channel) ? 1 : 0;
  sent += broadcastReliableToRoom(effect.shooter, payload, channel, label, options);
  return sent;
}

function scheduleImpactDotTick(effect, targetSession, delayMs) {
  effect.timer = setTimeout(() => {
    try {
      applyImpactDotTick(effect, targetSession);
    } catch (error) {
      console.log(`[error] impact-dot failed actor=${effect?.shooter?.actorId ?? "?"} target=${targetSession?.actorId ?? effect?.targetActorId ?? "?"} type=${impactTypeName(effect?.type)} tick=${numberOr(effect?.tick, 0) + 1}/${numberOr(effect?.ticks, 0)} reason=${error?.stack || error?.message || error}`);
      if (targetSession && effect?.type != null) {
        clearImpactDotState(targetSession, effect.type);
      }
    }
  }, Math.max(0, delayMs));
  if (typeof effect.timer.unref === "function") effect.timer.unref();
}

function applyImpactDotTick(effect, targetSession) {
  const timers = targetSession?.impactTimers;
  if (!timers || timers.get(Number(effect.type)) !== effect) return;
  effect.timer = null;

  if (!impactDotSourceStillValid(effect, targetSession)) {
    clearImpactDotState(targetSession, effect.type);
    return;
  }

  const damage = applyImpactDotDamage(effect, targetSession);
  const impactEvent = makePlayerImpactEvent(
    effect.shooter,
    targetSession.actorId,
    effect.type,
    damage.healthDamage,
    damage.energyDamage
  );
  const sent = sendImpactDotPayload(effect, impactEvent, "impact-dot", { requireMoveSeen: true });
  console.log(`[event] impact-dot actor=${effect.shooter.actorId} target=${targetSession.actorId} type=${impactTypeName(effect.type)} tick=${effect.tick + 1}/${effect.ticks} dmg=${damage.healthDamage}/${damage.energyDamage} roll=${damage.requestedDamage}/${effect.min}-${effect.max} hp=${targetSession.health}/${damage.targetCurrent.maxHealth} en=${targetSession.energy}/${damage.targetCurrent.stats.maxEnergy} dmgRed=${damage.damageReduction} enhRed=${damage.enhancerReduction} sent=${sent}`);

  if (damage.targetCurrent.health > 0 && targetSession.health <= 0) {
    const killEvent = applyImpactDotKill(effect, targetSession, damage);
    sendImpactDotPayload(effect, killEvent, "kill-dot");
    const scoreEvent = makeScoreUpdateEvent(effect.shooter);
    const scorePeers = sendImpactDotPayload(effect, scoreEvent, "score");
    console.log(`[sync] impact-dot-kill actor=${effect.shooter.actorId} target=${targetSession.actorId} type=${impactTypeName(effect.type)} scorePeers=${scorePeers} kills=${numberOr(effect.shooter.kills, 0)} deaths=${numberOr(targetSession.deaths, 0)}`);
    gateKilledSessionsAfterDelivery({ killedSessions: [targetSession] });
    maybeFinishZombieRound(effect.shooter.room, "impact-dot-kill", effect.channel ?? 0);
    maybeFinishStandardRound(effect.shooter.room, "impact-dot-kill", effect.channel ?? 0);
    return;
  }

  effect.tick += 1;
  if (effect.tick >= effect.ticks || damage.healthDamage + damage.energyDamage <= 0) {
    clearImpactDotState(targetSession, effect.type);
    return;
  }
  scheduleImpactDotTick(effect, targetSession, IMPACT_DOT_TICK_MS);
}

function startImpactDot(shooter, targetSession, damageState, data, targetIndex) {
  const definition = damageState?.impact;
  if (!definition || definition.type === IMPACT_TYPE.NONE) return "";
  if (!targetSession || targetSession.dead || !targetSession.spawned) return "";

  clearImpactDotState(targetSession, definition.type);
  const timers = ensureSessionImpactTimers(targetSession);
  if (!timers) return "";

  const effect = {
    type: definition.type,
    min: numberOr(definition.min, 0),
    max: numberOr(definition.max, definition.min),
    ticks: Math.max(1, numberOr(definition.ticks, IMPACT_DOT_DEFAULT_TICKS)),
    tick: 0,
    shooter,
    targetActorId: targetSession.actorId,
    weaponId: numberOr(damageState.weaponId, damageState.weaponType),
    weaponType: numberOr(damageState.type, 0),
    systemName: stringOr(damageState.systemName, ""),
    channel: reliableChannelForSession(shooter, 0),
    token: [
      Date.now(),
      shooter.actorId,
      targetSession.actorId,
      numberOr(damageState.weaponId, 0),
      targetIndex,
      shotTimestampValue(data),
      pointSeedValue(pointFromHashtable(htGet(data, 11))),
      pointSeedValue(pointFromHashtable(htGet(data, 12))),
    ].join(":"),
    timer: null,
  };
  timers.set(Number(effect.type), effect);
  scheduleImpactDotTick(effect, targetSession, 0);
  return `${impactTypeName(effect.type)}:${effect.min}-${effect.max}x${effect.ticks}`;
}

function applyShotDamageToTarget(shooter, data, damageState, weaponType, launchMode, target, targetIndex) {
  const descriptor = Number(htGet(target, 68)?.value ?? SHOT_TARGET_PLAYER) & 0xff;
  const targetType = descriptor & 7;
  const hitZone = descriptor & 48;
  const targetActorId = Number(htGet(target, 94)?.value);
  const result = {
    descriptor,
    targetActorId,
    hitZone,
    healthDamage: 0,
    energyDamage: 0,
    crit: false,
    hit: false,
    killed: false,
    killEvent: null,
    killedSession: null,
    targetSession: null,
    impactType: numberOr(damageState?.impactType, IMPACT_TYPE.NONE),
    summary: `${Number.isFinite(targetActorId) ? targetActorId : "?"}:skip`,
  };

  if (!ENABLE_BATTLE_DAMAGE) {
    result.summary = `${Number.isFinite(targetActorId) ? targetActorId : "?"}:damage=off`;
    return result;
  }
  if (targetType !== SHOT_TARGET_PLAYER || !Number.isFinite(targetActorId)) {
    result.summary = `${Number.isFinite(targetActorId) ? targetActorId : "?"}:non-player`;
    return result;
  }

  const targetSession = shooter.room?.players?.get(targetActorId);
  if (!targetSession || !targetSession.spawned || targetSession.dead) {
    result.summary = `${targetActorId}:not-live`;
    return result;
  }
  if (friendlyFireBlocked(shooter, targetSession)) {
    result.summary = `${targetActorId}:friendly`;
    return result;
  }

  const targetCurrent = sessionCurrentHealthEnergy(targetSession);
  if (targetCurrent.health <= 0) {
    targetSession.dead = true;
    targetSession.waitingSelfSpawnMove = false;
    resetZombieInfectionProgress(targetSession);
    result.summary = `${targetActorId}:dead`;
    return result;
  }
  result.targetSession = targetSession;
  result.hit = true;

  const origin = pointFromHashtable(htGet(data, 11));
  const actorDistance = distanceBetweenPoints(shooter.lastTransform, targetSession.lastTransform);
  const originDistance = distanceBetweenPoints(origin, targetSession.lastTransform);
  const explosive = isExplosiveDamageWeapon(weaponType, launchMode);
  const damageDistance = explosive ? (originDistance ?? actorDistance) : (actorDistance ?? originDistance);
  if (isColdArmsWeaponType(weaponType) && Number.isFinite(damageDistance) && damageDistance > DAMAGE_MELEE_MAX_DISTANCE) {
    noteAntiCheatWeaponViolation(shooter, "damage", "melee-range", {
      weaponType,
      slot: weaponStateByType(shooter, weaponType)?.slot,
    });
    result.hit = false;
    result.summary = `${targetActorId}:melee-range=${formatCaptureDistance(damageDistance)}>${DAMAGE_MELEE_MAX_DISTANCE}`;
    return result;
  }
  if (isZombieInfectionHit(shooter, targetSession, weaponType)) {
    const infectionProgress = noteZombieInfectionHit(shooter, targetSession);
    if (!infectionProgress.complete) {
      result.hit = true;
      result.summary = `${targetActorId}:infect-hit=${infectionProgress.hits}/${infectionProgress.required}:killer=${shooter.actorId}:ztype=${shooter.zombieType}:dist=${formatCaptureDistance(damageDistance)}`;
      return result;
    }
    const infection = applyZombieInfectionHit(shooter, targetSession, {
      damageState,
      weaponId: numberOr(damageState?.weaponId, weaponType),
      weaponType,
      weaponSystemName: stringOr(damageState?.systemName, "OHCA_Zombie"),
      hitZone,
    });
    result.hit = true;
    result.killed = true;
    result.killEvent = infection.event;
    result.summary = `${targetActorId}:infect=1:hits=${infectionProgress.hits}/${infectionProgress.required}:killer=${shooter.actorId}:ztype=${shooter.zombieType}:type=${targetSession.zombieType}:hp=${targetSession.health}:en=${targetSession.energy}:dist=${formatCaptureDistance(damageDistance)}:exp=${infection.expAwarded}:frag=${infection.fragInfo?.name || "zombie-infect"}`;
    return result;
  }
  const range = damageRangeName(damageDistance);
  const [minDamage, maxDamage] = damagePairForRange(damageState, range);
  const seedParts = shotRandomSeedParts(data, shooter, targetActorId, targetIndex, weaponType, range);
  const roll = deterministicUnit(BUILD_ID, "damage", ...seedParts);
  const baseDamage = minDamage + Math.round((maxDamage - minDamage) * roll);
  const critChance = clampNumber(numberOr(damageState?.crit, 0), 0, DAMAGE_MAX_CRIT_CHANCE);
  const crit = deterministicUnit(BUILD_ID, "crit", ...seedParts) * 100 < critChance;
  const shooterStats = sessionRuntimeStats(shooter);
  const headDamageBonus = hitZone === HIT_ZONE_CABIN
    ? clampNumber(shooterStats.modifiers.weaponHeadDamagePercent ?? 0, 0, DAMAGE_MAX_HEAD_BONUS_PERCENT)
    : 0;
  const explosionCoefficient = explosive ? explosionDistanceCoefficient(originDistance ?? actorDistance) : 1;
  const protectionKey = weaponProtectionKey(weaponType);
  const globalProtection = targetCurrent.stats.modifiers.protections?.[protectionKey] ?? 0;
  const rangeProtection = targetCurrent.stats.modifiers.rangeProtections?.[range]?.[protectionKey] ?? 0;
  const protection = clampNumber(
    globalProtection + rangeProtection,
    -DAMAGE_MAX_PROTECTION_PERCENT,
    DAMAGE_MAX_PROTECTION_PERCENT
  );
  const damageReduction = clampNumber(
    targetCurrent.stats.modifiers.damageReductionPercent ?? 0,
    0,
    DAMAGE_MAX_PROTECTION_PERCENT
  );
  const totalDamage = Math.max(0, Math.round(
    baseDamage *
    explosionCoefficient *
    hitZoneMultiplier(hitZone) *
    (1 + headDamageBonus / 100) *
    (crit ? DAMAGE_CRIT_MULTIPLIER : 1) *
    (1 - protection / 100) *
    (1 - damageReduction / 100)
  ));

  const energyDamage = Math.min(targetCurrent.energy, totalDamage);
  const healthDamage = Math.min(targetCurrent.health, Math.max(0, totalDamage - energyDamage));
  targetSession.energy = targetCurrent.energy - energyDamage;
  targetSession.health = targetCurrent.health - healthDamage;

  result.energyDamage = energyDamage;
  result.healthDamage = healthDamage;
  result.crit = crit && totalDamage > 0;
  result.summary = `${targetActorId}:dmg=${healthDamage}/${energyDamage}:hp=${targetSession.health}/${targetCurrent.maxHealth}:en=${targetSession.energy}/${targetCurrent.stats.maxEnergy}:range=${range}:dist=${formatCaptureDistance(damageDistance)}:roll=${baseDamage}/${minDamage}-${maxDamage}:headDmg=${headDamageBonus}:prot=${protectionKey}:${protection}:rangeProt=${rangeProtection}:dmgRed=${damageReduction}:crit=${result.crit ? 1 : 0}:${critChance}`;

  if (targetCurrent.health > 0 && targetSession.health <= 0) {
    targetSession.dead = true;
    targetSession.waitingSelfSpawnMove = false;
    resetZombieInfectionProgress(targetSession);
    targetSession.deaths = numberOr(targetSession.deaths, 0) + 1;
    targetSession.matchDeaths = numberOr(targetSession.matchDeaths, 0) + 1;
    let expAwarded = 0;
    let exp2clanAwarded = 0;
    let fragInfo = null;
    if (targetSession !== shooter) {
      shooter.kills = numberOr(shooter.kills, 0) + 1;
      shooter.points = numberOr(shooter.points, 0) + 1;
      shooter.matchKills = numberOr(shooter.matchKills, 0) + 1;
      if (hitZone === HIT_ZONE_CABIN) shooter.matchHeadKills = numberOr(shooter.matchHeadKills, 0) + 1;
      if (hitZone === HIT_ZONE_ENGINE) shooter.matchNutsKills = numberOr(shooter.matchNutsKills, 0) + 1;
      fragInfo = recordKillFragState(shooter, targetSession);
      expAwarded = awardBattleExp(shooter, battleExpForKill(shooter, targetSession), "kill");
      exp2clanAwarded = expAwarded > 0 ? Math.round(expAwarded * numberOr(shooter.loadedProfile?.clan?.ek, 0) / 100) : 0;
    } else {
      shooter.matchSuicides = numberOr(shooter.matchSuicides, 0) + 1;
    }
    clearSpawnMoveWarningTimer(targetSession);
    clearSpawnSelfRetryTimers(targetSession);
    clearSessionWeaponReloadTimers(targetSession);
    clearSessionActiveShotLedgers(targetSession);
    clearSessionImpactTimers(targetSession);
    clearPeerSpawnTimers(targetSession);
    clearPickupSpawnRepairTimers(targetSession);
    clearSpawnStallRecovery(targetSession);
    targetSession.pendingSpawnBroadcast = null;
    const impulse = shotImpulseVector(data, shooter, targetSession);
    result.killed = true;
    result.killedSession = targetSession;
    result.killEvent = makeKillPlayerEvent(shooter, targetActorId, weaponType, hitZone, impulse, fragInfo);
    result.summary += `:kill=1:exp=${expAwarded}:frag=${fragInfo?.name || "none"}`;
    postBattleEvent(targetSession, "death", {
      health: targetSession.health,
      energy: targetSession.energy,
      killerPlayerId: shooter.playerId,
      victimPlayerId: targetSession.playerId,
      killerPlayerName: shooter.playerName,
      victimPlayerName: targetSession.playerName,
      killerActorId: shooter.actorId,
      victimActorId: targetSession.actorId,
      weaponId: numberOr(damageState?.weaponId, weaponType),
      weaponType,
      weaponSystemName: stringOr(damageState?.systemName, ""),
      hitZone,
      healthDamage,
      energyDamage,
      expAwarded,
      exp2clan: exp2clanAwarded,
      fragType: fragInfo?.name || "none",
      domination: fragInfo?.code === KILL_FRAG_TYPE_DOMINATION ? 1 : 0,
      revenge: fragInfo?.code === KILL_FRAG_TYPE_REVENGE ? 1 : 0,
      dominationStreak: numberOr(fragInfo?.dominationStreak, 0),
      revengeStreak: numberOr(fragInfo?.revengeStreak, 0),
    });
  }

  return result;
}

function buildShotDamagePayload(session, data, state, weaponType, launchMode) {
  const targets = htGet(data, 86);
  const targetItems = targets?.value?.kind === "typed-array" ? targets.value.items : null;
  const recoveredMeleeTargetBodies = !targetItems?.length
    ? recoverMeleeSegmentTargetBodies(session, data, state, weaponType, launchMode)
    : null;
  const damageTargetItems = targetItems?.length
    ? targetItems
    : (recoveredMeleeTargetBodies || null);
  const damageTargetItemType = targetItems?.length ? targets.value.itemType : 0x68;
  const replacements = new Map();
  const killEvents = [];
  const impactEvents = [];
  const killedSessions = new Set();
  let shotCrit = false;
  const summaries = [];
  const stats = { shots: 1, hits: 0, playerTargets: 0, headHits: 0, nutsHits: 0, kills: 0 };

  if (shouldForceExplicitProjectileLaunchMode(data, weaponType, launchMode)) {
    replacements.set(16, rawByte(LAUNCH_MODE.LAUNCH));
  }

  if (damageTargetItems?.length && damageTargetItemType === 0x68) {
    const damageState = shotDamageState(session, weaponType, state);
    if (!damageState) {
      summaries.push("damage-state=missing");
    } else {
      const targetBodies = damageTargetItems.map((target, index) => {
        const damage = applyShotDamageToTarget(session, data, damageState, weaponType, launchMode, target, index);
        shotCrit = shotCrit || damage.crit;
        if (damage.killEvent) killEvents.push(damage.killEvent);
        if (damage.killedSession) killedSessions.add(damage.killedSession);
        if (damage.hit) {
          stats.hits += 1;
          stats.playerTargets += 1;
          if (damage.hitZone === HIT_ZONE_CABIN) stats.headHits += 1;
          if (damage.hitZone === HIT_ZONE_ENGINE) stats.nutsHits += 1;
          if (damage.impactType !== IMPACT_TYPE.NONE && damage.healthDamage + damage.energyDamage > 0 && !damage.killed) {
            const impactSummary = startImpactDot(session, damage.targetSession, damageState, data, index);
            if (impactSummary) damage.summary += `:dot=${impactSummary}`;
          }
        }
        if (damage.killed) stats.kills += 1;
        summaries.push(damage.summary);
        return hashtableBodyWithReplacements(target, new Map([
          [92, rawDamageShort(damage.healthDamage)],
          [93, rawDamageShort(damage.energyDamage)],
        ]));
      });
      replacements.set(86, rawTypedArray(0x68, targetBodies));
      if (recoveredMeleeTargetBodies) {
        summaries.unshift(`melee-segment-recovered=${recoveredMeleeTargetBodies.length}`);
      }
    }
  } else if (targets && targetItems === null) {
    summaries.push("targets=unparsed");
  }

  replacements.set(18, rawBool(shotCrit));
  const localReplacements = new Map(replacements);
  let localShotEvent = null;
  if (
    isProjectileWeaponType(weaponType) &&
    Number(launchMode ?? LAUNCH_MODE.SHOT) === LAUNCH_MODE.LAUNCH &&
    htGet(data, 15)?.value != null
  ) {
    localReplacements.set(15, RAW_OMIT);
    localShotEvent = rawEvent(97, [
      { key: 254, value: rawInt(session.actorId) },
      { key: 245, value: hashtableRawWithReplacements(data, localReplacements) },
    ]);
  }
  return {
    shotEvent: rawEvent(97, [
      { key: 254, value: rawInt(session.actorId) },
      { key: 245, value: hashtableRawWithReplacements(data, replacements) },
    ]),
    localShotEvent,
    killEvents,
    impactEvents,
    killedSessions: Array.from(killedSessions),
    scoreEvent: killEvents.length ? makeScoreUpdateEvent(session) : null,
    stats,
    summary: summaries.length ? ` damage=${summaries.join(",")}` : "",
  };
}

function buildShotEvent(session, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;

  const weaponType = htGet(data, 91)?.value;
  const launchMode = shotLaunchMode(data);
  if (isRoundPausedSession(session)) {
    console.log(`[round] shot blocked actor=${session?.actorId ?? "?"} type=${weaponType} mode=${launchMode} reason=round-paused`);
    return null;
  }
  if (!session?.spawned || session.dead) {
    console.log(`[event] shot blocked actor=${session?.actorId ?? "?"} type=${weaponType} mode=${launchMode} reason=not-live`);
    return null;
  }
  if (isZombiePlayerSession(session) && Number(weaponType) !== 1) {
    console.log(`[zombie] shot blocked actor=${session.actorId} type=${weaponType} mode=${launchMode} reason=zombie-hand-only`);
    return null;
  }
  const state = weaponStateByType(session, weaponType);
  const gate = allowWeaponShot(session, state, weaponType, launchMode, data);
  if (!gate.ok) {
    noteAntiCheatWeaponViolation(session, "shot", gate.reason, {
      weaponType,
      slot: state?.slot,
      waitMs: gate.waitMs,
    });
    console.log(`[event] shot blocked actor=${session.actorId} type=${weaponType} mode=${launchMode} reason=${gate.reason}${gate.waitMs ? ` wait=${gate.waitMs}ms` : ""}`);
    return null;
  }

  noteWeaponShot(session, parsed);
  if (state && shotConsumesAmmo(state.type, launchMode)) session.currentWeaponSlot = state.slot;
  const ammo = state
    ? (shotConsumesAmmo(state.type, launchMode)
      ? ` loaded=${state.loadedAmmo} reserve=${state.ammoReserve} interval=${gate.intervalMs}ms gate=${gate.reason}`
      : ` interval=${gate.intervalMs}ms gate=${gate.reason}`)
    : "";
  const response = buildShotDamagePayload(session, data, state, weaponType, launchMode);
  const shouldConfirmShotWeapon = state && (
    shotConsumesAmmo(state.type, launchMode) ||
    gate.reason === "melee-launch" ||
    gate.reason === "launch" ||
    gate.reason === "stop"
  );
  response.weaponConfirm = shouldConfirmShotWeapon ? buildShotWeaponConfirm(session, state) : null;
  response.localAmmoSync = state ? makeReloadUpdateEvent(session, state) : null;
  recordAcceptedShotStats(session, response, state, weaponType, launchMode);
  console.log(`[event] shot actor=${session.actorId} type=${weaponType} mode=${launchMode}${ammo}${describeShotTargets(data)}${describeShotDamageContext(session, data, state)}${describeProjectileLaunchPayloadKeys(data, weaponType, launchMode)}${response.summary}`);
  return response;
}

function gateKilledSessionsAfterDelivery(response) {
  for (const targetSession of response?.killedSessions || []) {
    if (!targetSession) continue;
    dropCtfFlagsForSession(targetSession);
    targetSession.moveSeen = false;
    targetSession.waitingSelfSpawnMove = false;
    clearSpawnSelfRetryTimers(targetSession);
    console.log(`[sync] death-gate actor=${targetSession.actorId} reason=kill-delivered`);
  }
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
  if (!sessionHasVisibleRoomItem(session, item)) {
    console.log(`[event] item-pick ignored actor=${session.actorId} id=${id} reason=not-visible`);
    return null;
  }
  if (!itemCanBenefitSession(session, item)) {
    console.log(`[event] item-pick ignored actor=${session.actorId} id=${id} reason=no-benefit`);
    return null;
  }

  return takeRoomItem(session, item, "client-request");
}

function refillSessionAmmoFromPickup(session, percent) {
  const summaries = [];
  const reloadEvents = [];
  for (const state of ammoPickupStates(session)) {
    const before = `${state.slot}:${state.loadedAmmo}/${state.ammoReserve}`;
    const reserveCap = reserveCapForState(state);
    const add = Math.floor(Math.max(0, numberOr(state.maxAmmoReserve, 0)) * percent / 100);
    state.ammoReserve = Math.min(reserveCap, Math.max(0, numberOr(state.ammoReserve, 0)) + add);
    summaries.push(`${before}->${state.loadedAmmo}/${state.ammoReserve}`);
    const reloadEvent = makeReloadUpdateEvent(session, state);
    if (reloadEvent) reloadEvents.push(reloadEvent);
  }
  if (reloadEvents.length > 0) {
    invalidatePeerWeaponConfirm(session.room, session.actorId);
  }
  return { reloadEvents, summary: summaries.join(",") };
}

function takeRoomItem(session, item, reason, context = {}) {
  if (!item || item.picked) return null;

  item.picked = true;
  item.nextRespawnAt = ITEM_RESPAWN_MS > 0 ? Date.now() + ITEM_RESPAWN_MS : 0;
  markRoomItemHiddenForAll(session.room, item.id);
  let pickValue = 0;
  let detail = "";
  const localEvents = [];
  if (item.type === ITEM_TYPES.AMMO) {
    pickValue = pickupPercent(item);
    const refill = refillSessionAmmoFromPickup(session, pickValue);
    localEvents.push(...refill.reloadEvents);
    detail = `${refill.summary ? ` ammo=${refill.summary}` : " ammo=none"} percent=${pickValue}`;
  } else if (item.type === ITEM_TYPES.HEALTH) {
    const stats = sessionRuntimeStats(session);
    const maxHealth = sessionMaxHealth(session, stats);
    const currentHealth = Math.max(0, numberOr(session.health, maxHealth));
    const amount = Math.floor(maxHealth * pickupPercent(item) / 100);
    pickValue = Math.min(Math.max(0, maxHealth - currentHealth), amount);
    session.health = currentHealth + pickValue;
    detail = ` hp=${session.health}/${maxHealth} add=${pickValue}`;
  } else if (item.type === ITEM_TYPES.ARMOR) {
    const currentEnergy = clampNumber(numberOr(session.energy, 0), 0, ARMOR_PICKUP_CAP);
    const amount = Math.floor(ARMOR_PICKUP_CAP * pickupPercent(item) / 100);
    pickValue = Math.min(Math.max(0, ARMOR_PICKUP_CAP - currentEnergy), amount);
    session.energy = currentEnergy + pickValue;
    detail = ` en=${session.energy}/${ARMOR_PICKUP_CAP} add=${pickValue}`;
  }

  const positionDetail = Number.isFinite(context.distance)
    ? ` dist=${context.distance.toFixed(2)} actorPos=${fmtPoint(context.actorPoint)} itemPos=${fmtPoint(item)}`
    : "";
  console.log(`[event] item-pick actor=${session.actorId} id=${item.id} type=${item.type} subType=${item.subType ?? 0} value=${pickValue} reason=${reason}${positionDetail}${detail}${localEvents.length ? ` reloadSync=${localEvents.length}` : ""}${ITEM_RESPAWN_MS > 0 ? ` respawn=${ITEM_RESPAWN_MS}ms` : ""}`);
  const pickEvent = rawEvent(93, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: makeItemRaw(item, { value: pickValue }) },
  ]);
  return { pickEvent, localEvents, itemId: item.id };
}

function buildProximityPickItemEvent(session, point) {
  if (!ENABLE_MAP_PICKUPS || !point || !session?.room) return null;
  const items = ensureRoomItems(session.room);
  const radiusSquared = ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS;
  let nearest = null;
  let nearestDistance = Infinity;

  for (const item of items.values()) {
    if (item.picked || !sessionHasVisibleRoomItem(session, item) || !itemCanBenefitSession(session, item)) continue;
    const dist = distanceSquared(point, item);
    if (dist <= radiusSquared && dist < nearestDistance) {
      nearest = item;
      nearestDistance = dist;
    }
  }

  return nearest ? takeRoomItem(session, nearest, "move-proximity", {
    distance: Math.sqrt(nearestDistance),
    actorPoint: point,
  }) : null;
}

function buildWeaponChangeEvent(session, parsed) {
  const data = parsed?.params?.get(245);
  if (!data?.raw) return null;
  if (isRoundPausedSession(session)) {
    console.log(`[round] weapon-change ignored actor=${session?.actorId ?? "?"} reason=round-paused`);
    return null;
  }
  if (!session?.spawned || session.dead) {
    console.log(`[event] weapon-change ignored actor=${session?.actorId ?? "?"} reason=not-live`);
    return null;
  }
  if (isZombiePlayerSession(session)) {
    console.log(`[zombie] weapon-change ignored actor=${session.actorId} reason=zombie-hand-only`);
    return null;
  }
  const slot = numberOr(htGet(data, 78)?.value, 0);
  const now = Date.now();
  const previousState = weaponStateBySlot(session, session.currentWeaponSlot);
  const state = weaponStateBySlot(session, slot);
  if (state) {
    if (previousState && previousState !== state) {
      startWeaponChange(previousState, "interrupted-by-change", now);
      startWeaponChange(state, "change-target", now);
    }
    session.currentWeaponSlot = slot;
    invalidatePeerWeaponConfirm(session.room, session.actorId);
  }
  console.log(`[event] weapon-change actor=${session.actorId}${describeWeaponEventData(data)}${state ? ` name=${state.systemName}` : ""}`);
  return rawEvent(98, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function buildReloadEvent(session, parsed, channel = 0) {
  const data = parsed?.params?.get(245);
  const requestedType = htGet(data, 89)?.value;
  if (isRoundPausedSession(session)) {
    console.log(`[round] reload ignored actor=${session?.actorId ?? "?"} type=${requestedType} reason=round-paused`);
    return null;
  }
  if (!session?.spawned || session.dead) {
    console.log(`[event] reload ignored actor=${session?.actorId ?? "?"} missingType=${requestedType} reason=not-live`);
    return null;
  }
  if (isZombiePlayerSession(session)) {
    console.log(`[zombie] reload ignored actor=${session.actorId} type=${requestedType} reason=zombie-hand-only`);
    return null;
  }
  const state = weaponStateByType(session, requestedType);
  if (!state) {
    noteAntiCheatWeaponViolation(session, "reload", "missing-weapon", { weaponType: requestedType });
    console.log(`[event] reload ignored actor=${session.actorId} missingType=${requestedType}`);
    return null;
  }

  if (isColdArmsWeaponType(state.type)) {
    noteAntiCheatWeaponViolation(session, "reload", "cold-arms", { weaponType: requestedType, slot: state.slot });
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=cold-arms`);
    return null;
  }

  const missing = Math.max(0, state.maxLoadedAmmo - state.loadedAmmo);
  const reserve = Math.max(0, state.ammoReserve);
  const amount = Math.min(missing, reserve);
  if (amount <= 0) {
    noteAntiCheatWeaponViolation(session, "reload", "full-or-empty", { weaponType: requestedType, slot: state.slot });
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=full-or-empty loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
    return null;
  }

  const now = Date.now();
  const weaponMode = refreshWeaponMode(state, now);
  if (weaponMode === WEAPON_MODE.RELOADING) {
    noteAntiCheatWeaponViolation(session, "reload", "already-reloading", { weaponType: requestedType, slot: state.slot });
    console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=already-reloading loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
    return null;
  }
  if (weaponMode === WEAPON_MODE.RELOADING_READY) {
    cancelWeaponReload(state, "interrupted-by-reload", now);
  }

  state.reloadSeq = (state.reloadSeq || 0) + 1;
  state.changeUntil = 0;
  resetWeaponActionState(state);
  state.reloading = true;
  state.reloadStartedAt = now;
  state.reloadReadyAt = isComplexReloadWeaponState(state) ? now + reloadSingleDurationMs(state) : 0;
  state.reloadFullUntil = now + reloadDurationForAmountMs(state, amount);
  setWeaponMode(state, WEAPON_MODE.RELOADING, now);
  const firstTickMs = isComplexReloadWeaponState(state)
    ? Math.min(reloadSingleDurationMs(state), numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs)))
    : numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs));
  scheduleReloadTick(session, state, channel, state.reloadSeq, firstTickMs);
  console.log(`[event] reload start actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} first=${firstTickMs}ms ready=${Math.max(0, numberOr(state.reloadReadyAt, 0) - now)}ms full=${state.reloadFullUntil - now}ms complex=${isComplexReloadWeaponState(state) ? 1 : 0}`);
  return null;
}
function clearSpawnStallRecovery(session) {
  if (!session?.spawnRetry) return;
  if (session.spawnRetry.timer) clearTimeout(session.spawnRetry.timer);
  session.spawnRetry = null;
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
  commands.push(...makeReliableCommandsForPayload(session, spawnResponse, channel));
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

function roomSettingsCompatible(room, mapName, mode) {
  if (!room) return false;
  const roomModeValue = Number(room.mode || 1);
  const requestedModeValue = Number(mode || 1);
  return mapKey(room.map) === mapKey(mapName) && roomModeValue === requestedModeValue;
}

function nextAvailableRoomName(baseName) {
  const name = stringOr(baseName, DEFAULT_ROOM);
  if (!rooms.has(name)) return name;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${name} (${index})`;
    if (!rooms.has(candidate)) return candidate;
  }
  return `${name} (${Date.now()})`;
}

function ensureRoom(settings) {
  let name = settings.name || DEFAULT_ROOM;
  const mode = Number(settings.mode ?? 1);
  const requestedMap = settings.map || DEFAULT_MAP;
  const normalizedMode = normalizeModeForMap(requestedMap, mode);
  const existingRoom = rooms.get(name);
  if (
    existingRoom?.players?.size > 0 &&
    settings.hasFullSettings !== false &&
    !roomSettingsCompatible(existingRoom, requestedMap, normalizedMode)
  ) {
    const splitName = nextAvailableRoomName(name);
    console.log(`[state] room name collision split requested=${name} existingMap=${existingRoom.map || DEFAULT_MAP} existingMode=${existingRoom.mode || 1} requestedMap=${requestedMap} requestedMode=${normalizedMode} newRoom=${splitName}`);
    name = splitName;
  }
  if (!rooms.has(name)) {
    const zombieRoom = normalizedMode === MAP_MODE_ZOMBIE;
    rooms.set(name, {
      name,
      map: requestedMap,
      mode: normalizedMode,
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
      items: makeRoomItemState(requestedMap),
      controlPoints: makeControlPointState(requestedMap),
      controlPointScores: makeControlPointScoreState(),
      flags: makeFlagState(requestedMap),
      controlPointTimer: null,
      zombieMode: zombieRoom ? ZOMBIE_MODE.WAIT_FOR_PLAYERS : 0,
      zombieRoundSeq: 0,
      zombieBossActorId: 0,
      zombieBossTimer: null,
      zombieRoundTimer: null,
      zombieRestartTimer: null,
      zombieRoundWinnerTeam: 0,
      zombieWins: 0,
      humanWins: 0,
      standardRoundState: zombieRoom ? null : "ready",
      standardRoundSeq: 0,
      standardRoundWinner: 0,
      standardRoundTimer: null,
      standardRestartTimer: null,
      standardTeam1Wins: 0,
      standardTeam2Wins: 0,
    });
  } else {
    const room = rooms.get(name);
    if (room.players.size === 0 && settings.hasFullSettings !== false) {
      clearZombieTimers(room);
      room.map = settings.map || room.map || DEFAULT_MAP;
      room.mode = normalizeModeForMap(room.map, mode);
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
      stopControlPointTicker(room);
      room.controlPoints = makeControlPointState(room.map);
      room.controlPointScores = makeControlPointScoreState();
      room.flags = makeFlagState(room.map);
      room.zombieMode = room.mode === MAP_MODE_ZOMBIE ? ZOMBIE_MODE.WAIT_FOR_PLAYERS : 0;
      room.zombieRoundSeq = 0;
      room.zombieBossActorId = 0;
      room.zombieRoundWinnerTeam = 0;
      room.zombieWins = 0;
      room.humanWins = 0;
      clearStandardRoundTimers(room);
      room.standardRoundState = room.mode === MAP_MODE_ZOMBIE ? null : "ready";
      room.standardRoundSeq = 0;
      room.standardRoundWinner = 0;
      room.standardTeam1Wins = 0;
      room.standardTeam2Wins = 0;
    }
    ensureRoomItems(room);
  }
  const room = rooms.get(name);
  startControlPointTicker(room);
  return room;
}

function clearZombieTimers(room) {
  clearZombieBossTimer(room);
  clearZombieRoundTimer(room);
  clearZombieRestartTimer(room);
  clearStandardRoundTimers(room);
  stopControlPointTicker(room);
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
  const fragments = session.reliableFragments?.size || 0;
  session.reliableResponses?.clear?.();
  session.reliableFragments?.clear?.();
  if (options.clearInFlight !== false) {
    session.reliableInFlight?.clear?.();
  }
  if (options.bumpGeneration) {
    session.reliableGeneration = (session.reliableGeneration || 0) + 1;
  }
  if (cached || inFlight || fragments || options.bumpGeneration) {
    console.log(`[state] reliable cache reset reason=${reason} cached=${cached} inflight=${inFlight} fragments=${fragments}${options.clearInFlight === false ? " preserved" : ""} gen=${session.reliableGeneration || 0}`);
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

function ensureSpawnSelfRetryTimerSet(session) {
  if (!session) return null;
  if (!(session.spawnSelfRetryTimers instanceof Set)) session.spawnSelfRetryTimers = new Set();
  return session.spawnSelfRetryTimers;
}

function clearSpawnSelfRetryTimers(session) {
  if (!(session?.spawnSelfRetryTimers instanceof Set)) return;
  for (const timer of session.spawnSelfRetryTimers) {
    clearTimeout(timer);
  }
  session.spawnSelfRetryTimers.clear();
}

function queueSelfSpawnRetry(session, reliableCommand, spawnSeq, reason) {
  if (!SPAWN_SELF_RETRY_DELAYS_MS.length || !session?.room || !reliableCommandCommands(reliableCommand).length) return;
  const actorId = session.actorId;
  const room = session.room;
  const timerSet = ensureSpawnSelfRetryTimerSet(session);
  if (!timerSet || !actorId) return;

  for (const delayMs of SPAWN_SELF_RETRY_DELAYS_MS) {
    const waitMs = Math.max(0, Number(delayMs) || 0);
    const timer = setTimeout(() => {
      timerSet.delete(timer);
      if (session.actorId !== actorId || session.room !== room) return;
      if (room.players?.get(actorId) !== session) return;
      if (session.spawnSeq !== spawnSeq) return;
      if (!session.spawned || session.dead || session.moveSeen || !session.waitingSelfSpawnMove) return;
      if (sendReliableCommandToSession(session, reliableCommand)) {
        console.log(`[sync] spawn-self-retry actor=${actorId} seq=${reliableCommand.seqs ?? reliableCommand.seq} delay=${waitMs}ms reason=${reason}`);
      }
    }, waitMs);
    timerSet.add(timer);
    if (typeof timer.unref === "function") timer.unref();
  }
}

function resetSessionMatchStats(session) {
  if (!session) return;
  session.matchStartedAt = 0;
  session.matchStatsPosted = false;
  session.matchShots = 0;
  session.matchHits = 0;
  session.matchKills = 0;
  session.matchDeaths = 0;
  session.matchHeadKills = 0;
  session.matchNutsKills = 0;
  session.matchSuicides = 0;
  session.matchDomination = 0;
  session.matchRevenge = 0;
  session.matchExp = 0;
}

function beginSessionMatchStats(session) {
  resetSessionMatchStats(session);
  session.expEarned = 0;
  session.exp2clan = 0;
  session.matchStartedAt = Date.now();
}

function recordAcceptedShotStats(session, response, state, weaponType, launchMode) {
  if (!session) return;
  const stats = response?.stats || {};
  const shots = Math.max(1, numberOr(stats.shots, 1));
  const hits = Math.max(0, numberOr(stats.hits, 0));
  session.matchShots = numberOr(session.matchShots, 0) + shots;
  session.matchHits = numberOr(session.matchHits, 0) + hits;
  postBattleEvent(session, "shot", {
    weaponId: numberOr(state?.weaponId, weaponType),
    weaponType: numberOr(state?.type, weaponType),
    weaponSystemName: stringOr(state?.systemName, ""),
    shots,
    hits,
    eventData: {
      launchMode,
      playerTargets: numberOr(stats.playerTargets, 0),
      headHits: numberOr(stats.headHits, 0),
      nutsHits: numberOr(stats.nutsHits, 0),
      kills: numberOr(stats.kills, 0),
    },
  });
}

function postSessionBattleSummary(session, reason = "leave", outcome = {}) {
  if (!session || session.matchStatsPosted || !session.matchStartedAt || !session.room) return false;
  const elapsedMs = Math.max(0, Date.now() - session.matchStartedAt);
  const playTimeMinutes = elapsedMs > 0 ? Math.max(1, Math.ceil(elapsedMs / 60000)) : 0;
  if (
    playTimeMinutes <= 0 &&
    !numberOr(session.matchShots, 0) &&
    !numberOr(session.matchKills, 0) &&
    !numberOr(session.matchDeaths, 0)
  ) {
    return false;
  }

  session.matchStatsPosted = true;
  const eventData = {
    reason,
    nutsKills: numberOr(session.matchNutsKills, 0),
    suicides: numberOr(session.matchSuicides, 0),
    domination: numberOr(session.matchDomination, 0),
    revenge: numberOr(session.matchRevenge, 0),
    maxDomination: numberOr(session.maxDomination, 0),
    maxRevenge: numberOr(session.maxRevenge, 0),
    ...(outcome && typeof outcome.eventData === "object" ? outcome.eventData : {}),
  };
  const summary = {
    playTimeMinutes,
    kills: numberOr(session.matchKills, 0),
    deaths: numberOr(session.matchDeaths, 0),
    headshots: numberOr(session.matchHeadKills, 0),
    shots: numberOr(session.matchShots, 0),
    hits: numberOr(session.matchHits, 0),
    expEarned: numberOr(session.matchExp, 0),
    eventData,
  };
  if (outcome && Object.prototype.hasOwnProperty.call(outcome, "won")) summary.won = Boolean(outcome.won);
  postBattleEvent(session, "summary", summary);
  return true;
}

function postStandardRoundBattleSummaries(room, winner, reason = "round-end") {
  if (!room?.players?.size) return 0;
  const mode = Number(room.mode || 0);
  const normalizedWinner = Number(winner || 0);
  const hasWinner = normalizedWinner > 0;
  const teamMode = mode === MAP_MODE_TEAM_DEATHMATCH || mode === MAP_MODE_CAPTURE_THE_FLAG || mode === MAP_MODE_CONTROL_POINTS;
  let posted = 0;
  for (const playerSession of zombieRoomPlayers(room)) {
    const outcome = { eventData: { roundWinner: normalizedWinner } };
    if (hasWinner) {
      outcome.won = teamMode
        ? Number(playerSession.team || 0) === normalizedWinner
        : Number(playerSession.actorId || 0) === normalizedWinner;
    }
    if (postSessionBattleSummary(playerSession, reason, outcome)) posted += 1;
  }
  return posted;
}

function postZombieRoundBattleSummaries(room, winnerTeam, reason = "zombie-round-end") {
  if (!room?.players?.size) return 0;
  const normalizedWinner = Number(winnerTeam) === HUMAN_TEAM ? HUMAN_TEAM : ZOMBIE_TEAM;
  let posted = 0;
  for (const playerSession of zombieRoomPlayers(room)) {
    const won = Number(playerSession.team || 0) === normalizedWinner;
    if (postSessionBattleSummary(playerSession, reason, { won, eventData: { roundWinner: normalizedWinner } })) posted += 1;
  }
  return posted;
}

function resetSessionRoomProgress(session) {
  if (!session) return;
  session.spawned = false;
  session.dead = false;
  session.moveSeen = false;
  session.moveCount = 0;
  session.waitingSelfSpawnMove = false;
  clearSpawnStallRecovery(session);
  clearSpawnMoveWarningTimer(session);
  clearSpawnSelfRetryTimers(session);
  clearPeerSpawnTimers(session);
  clearPickupSpawnRepairTimers(session);
  clearJoinRoomTimers(session);
  clearSessionWeaponReloadTimers(session);
  clearSessionImpactTimers(session);
  session.gameStateRequested = false;
  session.lastGameStateResponseAt = 0;
  session.knownActorIds = new Set();
  session.actorJoinAnnouncedAt = new Map();
  session.joinActorListIds = new Set();
  session.deferredJoinActorIds = new Set();
  session.peerWeaponConfirmKeys = new Map();
  session.visibleItemIds = new Set();
  session.expEarned = 0;
  session.exp2clan = 0;
  resetSessionFragState(session);
  clearSessionActiveShotLedgers(session);
  session.team = -1;
  session.zombieType = ZOMBIE_TYPE.HUMAN;
  session.lastTransform = null;
  session.pendingSpawnBroadcast = null;
  session.pendingPickupSync = null;
  resetSessionMatchStats(session);
  clearOutboundReliableState(session);
}

function deleteEmptyRoom(room, reason = "empty") {
  if (!room?.name || (room.players?.size || 0) > 0) return false;
  if (rooms.get(room.name) !== room) return false;
  clearZombieTimers(room);
  rooms.delete(room.name);
  console.log(`[state] empty room deleted reason=${reason} room=${room.name} map=${room.map || DEFAULT_MAP}`);
  return true;
}

function sessionIdentityKey(session) {
  const id = Number(session?.playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return "";
  const authKey = String(session?.playerAuthKey || "").trim();
  return authKey ? `${id}:${authKey}` : String(id);
}

function sameBattleIdentity(left, right) {
  if (!left || !right || left === right) return false;
  const leftIdentity = sessionIdentityKey(left);
  const rightIdentity = sessionIdentityKey(right);
  if (leftIdentity && rightIdentity && leftIdentity === rightIdentity) return true;
  return Boolean(left.remoteKey && right.remoteKey && left.remoteKey === right.remoteKey);
}

function removeRoomPlayer(room, actorId, playerSession, reason = "leave", options = {}) {
  if (!room?.players || room.players.get(actorId) !== playerSession) return false;
  playerSession.room = room;
  const peers = broadcastReliableToRoom(
    playerSession,
    makeActorLeaveEvent(actorId),
    options.channel || 0,
    options.broadcastReason || "actor-leave",
    { requireGameState: false },
  );
  room.players.delete(actorId);
  forgetActorForRoom(room, actorId);
  maybeFinishZombieRound(room, `leave-${reason}`, options.channel || 0);
  if (options.postSummary !== false) postSessionBattleSummary(playerSession, reason);
  resetSessionRoomProgress(playerSession);
  if (playerSession.room === room) playerSession.room = null;
  console.log(`[state] room player removed reason=${reason} room=${room.name} map=${room.map || DEFAULT_MAP} actor=${actorId} player=${playerSession.playerId || "unknown"} peers=${peers}`);
  broadcastMasterUserState(playerSession.playerId);
  deleteEmptyRoom(room, reason);
  return true;
}

function detachSessionFromRoom(session, reason = "leave") {
  const room = session?.room;
  dropCtfFlagsForSession(session, 2, session?.lastChannel || 0);
  let removed = false;
  if (room?.players) {
    for (const [actorId, playerSession] of Array.from(room.players.entries())) {
      if (playerSession === session) {
        removed = removeRoomPlayer(room, actorId, session, reason) || removed;
      }
    }
  }
  if (!removed) {
    postSessionBattleSummary(session, reason);
    resetSessionRoomProgress(session);
    if (session) session.room = null;
    deleteEmptyRoom(room, reason);
  }
}

function resetTransportForReconnect(session, reason) {
  detachSessionFromRoom(session, reason);
  resetReliableDedupe(session, reason, { bumpGeneration: true });
  session.serverSeq = 0;
  session.unreliableSeq = 0;
  session.serverSeqByChannel = new Map();
  session.unreliableSeqByChannel = new Map();
  session.reliableFragments = new Map();
  session.verifySeq = null;
  session.seenVerify = false;
  session.room = ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 });
  session.roomRaw = makeRoomSettingsRaw(session.room);
  session.actorRaw = null;
  session.peerActorRaw = null;
  session.peerActorRawBytes = 0;
  session.peerActorLoadoutSlots = 0;
  session.peerActorProfile = "";
  session.joinActorRaw = null;
  session.joinActorRawBytes = 0;
  session.joinActorLoadoutSlots = 0;
  session.joinActorProfile = "";
  session.actorJoinParam = null;
  session.currentWeaponSlot = 1;
  session.weaponStates = makeWeaponRuntimeState(null);
  session.peerWeaponConfirmKeys = new Map();
  clearSessionActiveShotLedgers(session);
  clearSessionImpactTimers(session);
  session.health = playerRuntimeStats(null).maxHealth;
  session.energy = playerRuntimeStats(null).maxEnergy;
  session.dead = false;
  session.waitingSelfSpawnMove = false;
  clearSpawnSelfRetryTimers(session);
  session.pendingSpawnBroadcast = null;
  session.kills = 0;
  session.deaths = 0;
  session.points = 0;
  session.expEarned = 0;
  session.exp2clan = 0;
}

function removeDuplicatePlayerSessions(room, session) {
  if (!room?.players) return;
  for (const [actorId, playerSession] of Array.from(room.players.entries())) {
    if (sameBattleIdentity(playerSession, session)) {
      removeRoomPlayer(room, actorId, playerSession, "duplicate-same-room", { broadcastReason: "stale-leave" });
    }
  }
}

function removeDuplicatePlayerSessionsFromAllRooms(session, reason = "duplicate-global") {
  let removed = 0;
  for (const room of Array.from(rooms.values())) {
    if (!room?.players) continue;
    for (const [actorId, playerSession] of Array.from(room.players.entries())) {
      if (!sameBattleIdentity(playerSession, session)) continue;
      if (removeRoomPlayer(room, actorId, playerSession, reason, { broadcastReason: "stale-leave" })) {
        removed += 1;
      }
    }
  }
  if (removed > 0) {
    console.log(`[state] duplicate identity cleanup player=${session.playerId || "unknown"} removed=${removed}`);
  }
  return removed;
}

function maybePruneIdleRoomSessions(now = Date.now()) {
  if (ROOM_SESSION_IDLE_MS <= 0) return 0;
  if (now - lastRoomSessionPruneAt < ROOM_SESSION_PRUNE_INTERVAL_MS) return 0;
  lastRoomSessionPruneAt = now;
  let removed = 0;
  for (const room of Array.from(rooms.values())) {
    if (!room?.players) continue;
    for (const [actorId, playerSession] of Array.from(room.players.entries())) {
      const lastSeenAt = Number(playerSession?.lastSeenAt || 0);
      if (lastSeenAt > 0 && now - lastSeenAt <= ROOM_SESSION_IDLE_MS) continue;
      if (removeRoomPlayer(room, actorId, playerSession, "idle-timeout", { broadcastReason: "idle-leave" })) {
        removed += 1;
        if (playerSession.sessionId) sessions.delete(playerSession.sessionId);
      }
    }
  }
  if (removed > 0) {
    console.log(`[state] idle room prune removed=${removed} idleMs=${ROOM_SESSION_IDLE_MS}`);
  }
  return removed;
}

function maybePruneIdleMasterSessions(now = Date.now()) {
  if (ROOM_SESSION_IDLE_MS <= 0) return 0;
  let removed = 0;
  for (const [playerId, set] of Array.from(masterSessionsByPlayerId.entries())) {
    for (const session of Array.from(set)) {
      const lastSeenAt = Number(session?.lastSeenAt || 0);
      if (lastSeenAt > 0 && now - lastSeenAt <= ROOM_SESSION_IDLE_MS) continue;
      set.delete(session);
      if (session?.sessionId) sessions.delete(session.sessionId);
      removed += 1;
    }
    if (set.size <= 0) {
      masterSessionsByPlayerId.delete(playerId);
      broadcastMasterLobbyEvent(212, playerId, masterUserDataRaw(masterKnownUser(playerId), { status: 2 }), playerId);
    }
  }
  if (removed > 0) {
    console.log(`[master-social] idle prune removed=${removed} idleMs=${ROOM_SESSION_IDLE_MS}`);
  }
  return removed;
}

function makeActorJoinEvent(session) {
  return rawEvent(105, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: actorRawForPeer(session) },
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
  if (session.joinActorListIds instanceof Set) {
    for (const actorId of session.joinActorListIds) {
      markActorKnown(session, actorId);
    }
    return;
  }
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
    if (sendPeerSpawnToSession(targetSession, sourceSession, spawnPayload, channel)) {
      console.log(`[sync] spawn-delayed actor=${sourceActorId} peer=${targetActorId} delay=${waitMs}ms`);
    }
  }, waitMs);
  timerSet?.add(timer);
  if (typeof timer.unref === "function") timer.unref();
  return true;
}

function buildDeferredPeerActorJoinEvents(targetSession, channel = 0) {
  const deferredIds = targetSession?.deferredJoinActorIds;
  const room = targetSession?.room;
  if (!(deferredIds instanceof Set) || deferredIds.size === 0 || !room?.players?.size) return [];

  const events = [];
  let queuedSpawns = 0;
  const announced = [];
  for (const actorId of deferredIds) {
    const normalizedActorId = Number(actorId);
    if (!Number.isInteger(normalizedActorId) || normalizedActorId <= 0) continue;
    if (sessionHasActorData(targetSession, normalizedActorId)) continue;

    const peerSession = room.players.get(normalizedActorId);
    if (!peerSession || peerSession === targetSession || !peerSession.peerActorRaw) continue;

    events.push(makeActorJoinEvent(peerSession));
    markActorAnnounced(targetSession, normalizedActorId);
    announced.push(normalizedActorId);

    const spawnEvent = makeSpawnEventFromSession(peerSession);
    if (spawnEvent && schedulePeerSpawnEvent(targetSession, peerSession, spawnEvent, channel, ACTOR_JOIN_ASYNC_DELAY_MS)) {
      queuedSpawns += 1;
    }
  }

  if (events.length > 0) {
    console.log(`[sync] deferred-actor-join target=${targetSession.actorId} actors=${announced.join(",")} queuedSpawns=${queuedSpawns}`);
  }
  deferredIds.clear();
  return events;
}

function queuePeerActorRepair(targetSession, channel = 0, reason = "gamestate") {
  const room = targetSession?.room;
  const targetActorId = targetSession?.actorId;
  if (!targetActorId || !room?.players?.size || !PEER_ACTOR_REPAIR_DELAYS_MS.length) return;

  const peers = Array.from(room.players.entries())
    .filter(([actorId, peerSession]) => Number(actorId) !== Number(targetActorId) && peerSession?.peerActorRaw);
  if (!peers.length) return;

  for (const delayMs of PEER_ACTOR_REPAIR_DELAYS_MS) {
    const waitMs = Math.max(0, Number(delayMs) || 0);
    const timer = setTimeout(() => {
      if (targetSession.room !== room || room.players.get(targetActorId) !== targetSession) return;
      if (!targetSession.gameStateRequested) return;

      const payloads = [];
      const actors = [];
      let queuedSpawns = 0;
      for (const [actorId, peerSession] of peers) {
        const normalizedActorId = Number(actorId);
        if (!Number.isInteger(normalizedActorId) || normalizedActorId <= 0) continue;
        if (peerSession.room !== room || room.players.get(normalizedActorId) !== peerSession || !peerSession.peerActorRaw) continue;

        payloads.push(makeActorLeaveEvent(normalizedActorId));
        payloads.push(makeActorJoinEvent(peerSession));
        markActorAnnounced(targetSession, normalizedActorId);
        actors.push(normalizedActorId);

        const spawnEvent = makeSpawnEventFromSession(peerSession);
        if (spawnEvent && schedulePeerSpawnEvent(targetSession, peerSession, spawnEvent, channel, ACTOR_JOIN_ASYNC_DELAY_MS)) {
          queuedSpawns += 1;
        }
      }

      if (!payloads.length) return;
      if (sendReliablePayloadsToSession(targetSession, payloads, channel)) {
        console.log(`[sync] peer-actor-repair target=${targetActorId} actors=${actors.join(",")} delay=${waitMs}ms reason=${reason} queuedSpawns=${queuedSpawns}`);
      }
    }, waitMs);
    if (typeof timer.unref === "function") timer.unref();
  }
}

function sendPeerSpawnToSession(targetSession, sourceSession, spawnPayload, channel) {
  const sourceActorId = sourceSession?.actorId;
  const targetActorId = targetSession?.actorId;
  if (!sourceActorId || !targetActorId || !spawnPayload) return false;
  if (!sendReliableToSession(targetSession, spawnPayload, channel)) return false;

  markActorKnown(targetSession, sourceActorId);
  if (CONFIRM_PEER_SPAWN_AFTER_ISENEMY) {
    sendReliableToSession(targetSession, spawnPayload, channel);
    console.log(`[sync] spawn-confirm actor=${sourceActorId} peer=${targetActorId}`);
  }
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
      if (sendPeerSpawnToSession(playerSession, sourceSession, spawnPayload, channel)) sent += 1;
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

    if (sendPeerSpawnToSession(playerSession, sourceSession, spawnPayload, channel)) {
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
    playerName: session.playerName || "",
    playerAuthKey: session.playerAuthKey || "",
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

function roomSessionByPlayerId(room, playerId) {
  const id = Number(playerId || 0);
  if (!room?.players?.size || !Number.isInteger(id) || id <= 0) return null;
  for (const playerSession of room.players.values()) {
    if (Number(playerSession?.playerId || 0) === id) return playerSession;
  }
  return null;
}

function makeAchievementEvent(actorId, achievement) {
  return rawEvent(76, [
    { key: 254, value: rawInt(actorId) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawInt(0), value: rawLong(achievement.i) },
        { key: rawInt(1), value: rawInt(achievement.maxValue) },
        { key: rawInt(2), value: rawInt(achievement.currentValue) },
        { key: rawInt(3), value: rawInt(achievement.reward) },
        { key: rawInt(4), value: rawInt(achievement.userId) },
      ]),
    },
  ]);
}

function emitAchievementEvents(sourceSession, achievements) {
  if (!Array.isArray(achievements) || achievements.length <= 0) return;
  for (const achievement of achievements) {
    const ownerSession = roomSessionByPlayerId(sourceSession?.room, achievement.userId) || sourceSession;
    const actorId = Number(ownerSession?.actorId || sourceSession?.actorId || 0);
    if (!Number.isInteger(actorId) || actorId <= 0) continue;
    const channel = reliableChannelForSession(ownerSession, sourceSession?.lastChannel || 0);
    const payload = makeAchievementEvent(actorId, achievement);
    const self = sendReliableToSession(ownerSession, payload, channel) ? 1 : 0;
    const peers = broadcastReliableToRoom(ownerSession, payload, channel, "achievement", { requireGameState: false });
    console.log(`[sync] achievement actor=${actorId} user=${achievement.userId} ach=${achievement.i} value=${achievement.currentValue}/${achievement.maxValue} reward=${achievement.reward} self=${self} peers=${peers}`);
  }
}

async function postBattleEvent(session, type, extra = {}) {
  if (!API_BASE_URL || typeof fetch !== "function") return;
  try {
    const response = await fetch(`${API_BASE_URL}/battle/event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(API_TOKEN ? { "x-battle-token": API_TOKEN } : {}),
      },
      body: JSON.stringify(jsonForDb(session, { type, ...extra })),
    });
    if (!response.ok) {
      console.log(`[api] ${type} failed status=${response.status}`);
    } else {
      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }
      emitAchievementEvents(session, result?.achievements);
      console.log(`[api] ${type} ok`);
    }
  } catch (error) {
    console.log(`[api] ${type} failed ${error.message}`);
  }
}

function masterSessionSet(playerId, create = false) {
  const id = Number(playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  let set = masterSessionsByPlayerId.get(id);
  if (!set && create) {
    set = new Set();
    masterSessionsByPlayerId.set(id, set);
  }
  return set || null;
}

function unregisterMasterSession(session) {
  const ids = Array.from(new Set([
    Number(session?.masterRegisteredPlayerId || 0),
    Number(session?.playerId || 0),
  ])).filter((id) => Number.isInteger(id) && id > 0);
  for (const id of ids) {
    const set = masterSessionsByPlayerId.get(id);
    if (!set) continue;
    set.delete(session);
    if (set.size <= 0) masterSessionsByPlayerId.delete(id);
  }
  if (session) session.masterRegisteredPlayerId = 0;
}

function registerMasterSession(session) {
  const id = Number(session?.playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return;
  unregisterMasterSession(session);
  session.isMasterSession = true;
  session.masterRegisteredPlayerId = id;
  masterSessionSet(id, true)?.add(session);
}

function detachMasterSession(session, reason = "leave") {
  if (!session?.isMasterSession) return 0;
  const userId = Number(session.playerId || session.masterRegisteredPlayerId || 0);
  unregisterMasterSession(session);
  if (!Number.isInteger(userId) || userId <= 0) return 0;
  const sent = broadcastMasterLobbyEvent(212, userId, masterUserDataRaw(masterKnownUser(userId), { status: 2 }), userId);
  console.log(`[master-social] leave user=${userId} reason=${reason} sent=${sent}`);
  return sent;
}

function activeMasterSessionsForUser(playerId) {
  return Array.from(masterSessionSet(playerId) || [])
    .filter((session) => session?.socket && session?.rinfo && sessions.get(session.sessionId) === session);
}

function rawMasterEvent(eventCode, actorId, dataRaw) {
  const entries = [];
  if (actorId != null) entries.push({ key: 225, value: rawInt(actorId) });
  if (dataRaw) entries.push({ key: 213, value: dataRaw });
  return rawEvent(eventCode, entries);
}

function isMasterSocialPort(port) {
  return SOCIAL_MASTER_PORTS.has(Number(port || 0));
}

function isBattleListSession(session) {
  const port = Number(session?.port || 0);
  return port && port !== GAME_MASTER_PORT && !isMasterSocialPort(port);
}

function masterSocialStateForUser(playerId) {
  const id = Number(playerId || 0);
  for (const session of sessions.values()) {
    if (!isBattleListSession(session)) continue;
    if (Number(session?.playerId || 0) !== id) continue;
    if (!session?.room || !session.room.players?.has(session.actorId)) continue;
    return {
      status: 3,
      roomName: session.room.name || DEFAULT_ROOM,
      serverId: `${PUBLIC_HOST}:${session.port || 5055}`,
      userOnline: Math.min(255, Math.max(0, Number(session.room.players?.size || 0))),
      userMax: Math.min(255, Math.max(0, Number(session.room.maxUsers || 0))),
    };
  }

  if (activeMasterSessionsForUser(id).length > 0) {
    return { status: 1, roomName: "", serverId: "", userOnline: 0, userMax: 0 };
  }

  return { status: 2, roomName: "", serverId: "", userOnline: 0, userMax: 0 };
}

function masterKnownUser(playerId, fallback = {}) {
  const id = Number(playerId || 0);
  let bestSession = null;
  for (const session of sessions.values()) {
    if (Number(session?.playerId || 0) !== id) continue;
    if (!bestSession || (session.loadedProfile && !bestSession.loadedProfile)) bestSession = session;
  }
  const profile = bestSession?.loadedProfile || null;
  return {
    userId: id,
    name: stringOr(fallback.name ?? profile?.name ?? bestSession?.playerName, `Player ${id}`),
    level: numberOr(fallback.level ?? profile?.level, 1),
    exp: numberOr(fallback.exp ?? profile?.exp, 0),
  };
}

function masterUserDataRaw(user, options = {}) {
  const state = masterSocialStateForUser(user.userId);
  const entries = [
    { key: rawByte(212), value: rawString(user.name || `Player ${user.userId}`) },
    { key: rawByte(205), value: rawShort(user.level || 1) },
    { key: rawByte(211), value: rawByte(options.status ?? state.status) },
    { key: rawByte(209), value: rawString(options.roomName ?? state.roomName ?? "") },
    { key: rawByte(210), value: rawString(options.serverId ?? state.serverId ?? "") },
    { key: rawByte(204), value: rawByte(options.userOnline ?? state.userOnline ?? 0) },
    { key: rawByte(203), value: rawByte(options.userMax ?? state.userMax ?? 0) },
  ];
  if (options.includeTarget) entries.unshift({ key: rawByte(207), value: rawInt(user.userId) });
  if (options.includeState) entries.push({ key: rawByte(208), value: rawByte(options.friendState || 0) });
  return rawHashtable(entries);
}

function masterFriendListRaw(friends) {
  return rawHashtable((friends || []).map((friend) => ({
    key: rawInt(friend.userId),
    value: masterUserDataRaw(masterKnownUser(friend.userId, friend), {
      includeState: true,
      friendState: Number(friend.state || 0),
    }),
  })));
}

function masterChatListRaw(ownerId, friends = []) {
  const byId = new Map();
  for (const friend of friends || []) {
    const friendId = Number(friend.userId || 0);
    if (!friendId || friendId === Number(ownerId)) continue;
    const live = masterSocialStateForUser(friendId);
    if (live.status !== 2) {
      byId.set(friendId, masterKnownUser(friendId, friend));
    }
  }
  return rawHashtable(Array.from(byId.values()).map((user) => ({
    key: rawInt(user.userId),
    value: masterUserDataRaw(user),
  })));
}

function masterServerListReportRaw() {
  const battlePeerCount = Array.from(sessions.values())
    .filter((session) => isBattleListSession(session) && session?.socket && session?.rinfo)
    .length;
  return rawHashtable([
    {
      key: rawString(PUBLIC_HOST),
      value: rawHashtable([
        { key: rawByte(214), value: rawInt(battlePeerCount) },
        { key: rawByte(199), value: rawShort(0) },
        { key: rawByte(202), value: rawShort(0) },
      ]),
    },
  ]);
}

async function loadMasterSocialList(userId) {
  try {
    const payload = await postApiJson("/battle/social", {
      token: API_TOKEN,
      action: "list",
      userId,
    });
    return Array.isArray(payload?.friends) ? payload.friends : [];
  } catch (error) {
    console.log(`[master-social] list failed user=${userId} ${error.message}`);
    return [];
  }
}

async function mutateMasterSocial(action, userId, targetId) {
  try {
    const payload = await postApiJson("/battle/social", {
      token: API_TOKEN,
      action,
      userId,
      targetId,
    });
    if (payload?.ok === false) {
      console.log(`[master-social] ${action} rejected user=${userId} target=${targetId} error=${payload.error || "unknown"}`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`[master-social] ${action} failed user=${userId} target=${targetId} ${error.message}`);
    return false;
  }
}

async function masterSocialRefreshEventsForUser(userId) {
  const friends = await loadMasterSocialList(userId);
  return [
    rawMasterEvent(224, userId, masterFriendListRaw(friends)),
    rawMasterEvent(214, userId, masterChatListRaw(userId, friends)),
  ];
}

async function buildMasterSocialInitEvents(session) {
  return masterSocialRefreshEventsForUser(session.playerId);
}

function sendMasterPayloadToUser(userId, payload) {
  let sent = 0;
  for (const targetSession of activeMasterSessionsForUser(userId)) {
    if (sendReliableToSession(targetSession, payload, targetSession.lastChannel || 0)) sent += 1;
  }
  return sent;
}

function broadcastMasterLobbyEvent(eventCode, actorUserId, dataRaw, exceptUserId = 0) {
  const payload = rawMasterEvent(eventCode, actorUserId, dataRaw);
  let sent = 0;
  for (const [playerId] of masterSessionsByPlayerId.entries()) {
    if (Number(playerId) === Number(exceptUserId)) continue;
    sent += sendMasterPayloadToUser(playerId, payload);
  }
  return sent;
}

function broadcastMasterUserState(userId) {
  const user = masterKnownUser(userId);
  let sent = 0;
  for (const [ownerId] of masterSessionsByPlayerId.entries()) {
    if (Number(ownerId) === Number(userId)) continue;
    const data = masterUserDataRaw(user, { includeTarget: true });
    sent += sendMasterPayloadToUser(ownerId, rawMasterEvent(211, ownerId, data));
  }
  if (sent > 0) {
    console.log(`[master-social] state user=${userId} sent=${sent}`);
  }
}

async function prepareMasterLobbySession(session, actorParam) {
  const { authId, authKey } = actorCredentials(actorParam);
  const cached = cachedPlayerProfile(actorParam);
  session.playerId = authId;
  session.playerAuthKey = authKey;
  session.playerName = stringOr(cached?.name ?? htGet(actorParam, 242)?.value, process.env.DEFAULT_PLAYER_NAME || "ContraCity");
  session.loadedProfile = cached || session.loadedProfile || null;
  registerMasterSession(session);

  warmPlayerProfile(actorParam, "master-lobby").then((profile) => {
    if (sessions.get(session.sessionId) !== session || Number(session.playerId) !== Number(authId)) return;
    session.loadedProfile = profile;
    session.playerName = profile.name || session.playerName;
    broadcastMasterUserState(authId);
  }).catch(() => {});

  const initEvents = await buildMasterSocialInitEvents(session);
  const userData = masterUserDataRaw(masterKnownUser(session.playerId, { name: session.playerName }));
  const joined = broadcastMasterLobbyEvent(213, session.playerId, userData, session.playerId);
  console.log(`[master-social] lobby user=${session.playerId} name=${session.playerName} friends-init=${initEvents.length} joined=${joined}`);
  return initEvents;
}

async function handleMasterEvent(session, parsed) {
  const eventCode = photonEventCode(parsed);
  const data = eventDataHash(parsed);
  const userId = Number(session.playerId || 0);
  const targetId = Number(htGet(data, 207)?.value || htGet(data, 68)?.value || 0);

  if (eventCode === 216) {
    console.log(`[master-social] refresh user=${userId}`);
    return buildMasterSocialInitEvents(session);
  }

  if ([222, 221, 220, 219].includes(eventCode)) {
    const action = ({ 222: "request", 221: "confirm", 220: "decline", 219: "remove" })[eventCode];
    if (!targetId) return [];
    const ok = await mutateMasterSocial(action, userId, targetId);
    if (!ok) return [];
    const eventData = rawHashtable([{ key: rawByte(207), value: rawInt(targetId) }]);
    const event = rawMasterEvent(eventCode, userId, eventData);
    sendMasterPayloadToUser(targetId, event);
    const targetRefresh = await masterSocialRefreshEventsForUser(targetId);
    let targetRefreshSent = 0;
    for (const payload of targetRefresh) {
      targetRefreshSent += sendMasterPayloadToUser(targetId, payload);
    }
    const ownerRefresh = await masterSocialRefreshEventsForUser(userId);
    console.log(`[master-social] ${action} user=${userId} target=${targetId} targetRefresh=${targetRefreshSent} ownerRefresh=${ownerRefresh.length}`);
    return [event, ...ownerRefresh];
  }

  if (eventCode === 217) {
    const message = String(htGet(data, 77)?.value || "").trim();
    if (!message) return [];
    const type = Number(htGet(data, 80)?.value ?? 253);
    const entries = [{ key: rawByte(77), value: rawString(message) }];
    if (data && htGet(data, 80) !== undefined) entries.push({ key: rawByte(80), value: rawByte(type) });
    if (targetId) entries.push({ key: rawByte(68), value: rawInt(targetId) });
    const event = rawMasterEvent(217, userId, rawHashtable(entries));
    if (targetId) {
      sendMasterPayloadToUser(targetId, event);
    } else {
      broadcastMasterLobbyEvent(217, userId, rawHashtable(entries), 0);
    }
    console.log(`[master-social] chat user=${userId} target=${targetId || "all"} type=${type} chars=${message.length}`);
    return [event];
  }

  if (eventCode === 210) {
    console.log(`[master-social] server-list user=${userId} host=${PUBLIC_HOST}`);
    return [rawMasterEvent(223, userId, masterServerListReportRaw())];
  }

  console.log(`[master-social] ack only code=${eventCode} user=${userId}`);
  return [];
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

  // BaseEnter is used by CTF BaseEnterTrigger and by ControlPointProximity.
  if (eventCode === 79) {
    const data = parsed.params.get(245);
    const declaredTeam = Number(htGet(data, 239)?.value);
    const pointData = htGet(data, 98);

    if (isCtfRoom(session.room) && pointData == null) {
      if (!session.spawned || session.dead || isRoundPausedSession(session)) {
        console.log(`[flag] base-enter ignored actor=${session.actorId} reason=session`);
        return [];
      }
      if (declaredTeam !== session.team) {
        console.log(`[flag] base-enter ignored actor=${session.actorId} declaredTeam=${declaredTeam || 0} actualTeam=${session.team} reason=team`);
        return [];
      }
      if (!ctfPlayerAtBase(session, declaredTeam)) {
        console.log(`[flag] base-enter ignored actor=${session.actorId} team=${declaredTeam} reason=position pos=${fmtPoint(session.lastTransform)}`);
        return [];
      }
      const delivered = tryDeliverCtfFlag(session, channel, "base-enter");
      console.log(`[flag] base-enter actor=${session.actorId} team=${declaredTeam} delivered=${delivered ? 1 : 0}`);
      return [];
    }

    if (!isControlPointsRoom(session.room) || !session.spawned || session.dead || isRoundPausedSession(session)) {
      console.log(`[control] enter ignored actor=${session.actorId} reason=room-or-session`);
      return [];
    }
    const pointId = Number(htGet(pointData, 61)?.value);
    const entering = Number(htGet(pointData, 1)?.value) === 1;
    const point = session.room.controlPoints?.get(pointId);
    if (!point || declaredTeam !== session.team) {
      console.log(`[control] enter ignored actor=${session.actorId} point=${pointId || 0} reason=contract`);
      return [];
    }
    if (entering && !controlPointContains(point, session.lastTransform)) {
      console.log(`[control] enter ignored actor=${session.actorId} point=${pointId} reason=position pos=${fmtPoint(session.lastTransform)}`);
      return [];
    }
    if (entering) point.occupants.add(session.actorId);
    else point.occupants.delete(session.actorId);
    updateControlPoint(session.room, point, channel);
    console.log(`[control] ${entering ? "enter" : "exit"} actor=${session.actorId} point=${pointId} team=${session.team}`);
    return [];
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
      if (isMasterSocialPort(port)) {
        const socialInitEvents = await prepareMasterLobbySession(session, actorParam);
        console.log(`[state] master-social lobby accepted port=${port} lobby=${requestedName}`);
        return [
          rawEvent(255, [
            { key: 225, value: rawInt(session.actorId) },
            { key: 213, value: rawHashtable([]) },
          ]),
          ...socialInitEvents,
          rawOperationResponse(255, []),
        ];
      }
      if (Number(port) === GAME_MASTER_PORT) {
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
    if (settings.hasFullSettings === false) {
      const joinRoom = rooms.get(settings.name);
      if (!joinRoom || (joinRoom.players?.size || 0) <= 0) {
        if (joinRoom && (joinRoom.players?.size || 0) <= 0) deleteEmptyRoom(joinRoom, "stale-name-join");
        console.log(`[state] room join rejected reason=missing-room name=${settings.name} requested=${requestedName}`);
        return [rawOperationResponse(255, [], -17, "room-not-found")];
      }
    }
    resetReliableDedupe(session, "real-room-join", { clearInFlight: false });
    detachSessionFromRoom(session, "rejoin");
    const { profile, source: profileSource, pendingProfile } = await profileForJoin(actorParam, { forceRefresh: true });
    session.playerId = profile.authId;
    session.playerAuthKey = profile.authKey || actorCredentials(actorParam).authKey || "";
    session.playerName = profile.name;
    session.loadedProfile = profile;
    session.currentWeaponSlot = 1;
    session.weaponStates = makeWeaponRuntimeState(profile);
    session.peerWeaponConfirmKeys = new Map();
    clearSessionActiveShotLedgers(session);
    clearSessionImpactTimers(session);
    session.dead = false;
    session.kills = 0;
    session.deaths = 0;
    session.points = 0;
    resetSessionFragState(session);
    beginSessionMatchStats(session);
    {
      const stats = sessionRuntimeStats(session);
      session.health = stats.maxHealth;
      session.energy = stats.maxEnergy;
    }
    removeDuplicatePlayerSessionsFromAllRooms(session, "room-join-duplicate");
    session.room = ensureRoom(settings);
    session.roomRaw = makeRoomSettingsRaw(session.room);
    removeDuplicatePlayerSessions(session.room, session);
    session.actorId = nextRoomActorId(session.room);
    updateActorWireData(session, actorParam, profile, channel);
    const joinActorId = session.actorId;
    if (profileSource === "fallback") {
      (pendingProfile || warmPlayerProfile(actorParam, "late-room-profile")).then((loadedProfile) => {
        if (sessions.get(key(port, rinfo)) === session && session.actorId === joinActorId) {
          applyLateProfile(session, loadedProfile, actorParam);
        }
      });
    } else if (profileSource === "cache") {
      loadPlayerProfile(actorParam, { forceRefresh: true }).then((loadedProfile) => {
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
    console.log(`[state] room join accepted room=${session.room.name} map=${session.room.map} mode=${session.room.mode} player=${session.playerId} name=${session.playerName} profile=${profileSource} wears=${session.actorWearCount || 0} wearList=${session.actorWearSummary || "none"} taunts=${session.actorTauntCount || 0} tauntSlots=${session.actorTauntSummary || "none"} enhancers=${session.actorEnhancerCount || 0} enhancerList=${session.actorEnhancerSummary || "none"} actorKeys=${describeHashtable(actorParam)} actorRaw=${session.actorRaw?.length || 0} peerActorRaw=${session.peerActorRaw?.length || 0} peerSlots=${session.peerActorLoadoutSlots || 0} peerProfile=${session.peerActorProfile || "n/a"} peerHasWears=${session.peerActorHasWears ? "yes" : "no"} peerHasEnhancers=${session.peerActorHasEnhancers ? "yes" : "no"} peerPacket=${session.peerActorRawBytes || 0} joinActorRaw=${session.joinActorRaw?.length || 0} joinSlots=${session.joinActorLoadoutSlots || 0} joinProfile=${session.joinActorProfile || "n/a"} joinHasWears=${session.joinActorHasWears ? "yes" : "no"} joinHasEnhancers=${session.joinActorHasEnhancers ? "yes" : "no"} joinPacket=${session.joinActorRawBytes || 0} joinDeferred=${session.deferredJoinActorIds?.size || 0} roomRaw=${session.roomRaw?.length || 0}`);
    postBattleEvent(session, "join", { playerData: { remote: rinfo.address, name: session.playerName } });
    broadcastMasterUserState(session.playerId);
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
    if (isMasterSocialPort(port) && session.isMasterSession) {
      detachMasterSession(session, "op-leave");
    }
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

  if (isMasterSocialPort(port)) {
    return handleMasterEvent(session, parsed);
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
    if (MAP_PICKUPS_IN_GAMESTATE) markActiveRoomItemsVisible(session);
    if (!isZombieRoom(session.room) && !isStandardRoundPaused(session.room)) {
      startStandardRound(session.room, channel, "pre-gamestate");
    }
    const responses = [
      ...buildDeferredPeerActorJoinEvents(session, channel),
      rawEvent(84, [
        { key: 254, value: rawInt(session.actorId) },
        { key: 245, value: makeGameStateRaw(session) },
      ]),
    ];
    if (isZombieRoom(session.room)) {
      const zombieStarted = maybeStartZombieRound(session.room, channel, "post-gamestate", session, responses);
      if (!zombieStarted) {
        maybeAppendZombieLateJoinSpawn(session, responses, channel);
      }
      if (!session.spawned) {
        console.log(`[zombie] waiting actor=${session.actorId} ready=${zombieReadyPlayers(session.room).length}/${ZOMBIE_MIN_PLAYERS} mode=${zombieModeForRoom(session.room)}`);
      }
    } else if (isStandardRoundPaused(session.room)) {
      console.log(`[round] game-state pause actor=${session.actorId} room=${session.room.name} waiting-restart=yes`);
    } else if (isCtfRoom(session.room) && !session.spawned) {
      const team = autoTeamForTeamRoom(session.room);
      const spawnResponse = buildSpawnEvent(session, team, "ctf-auto-after-gamestate");
      responses.push(spawnResponse);
      broadcastSpawnToRoom(session, spawnResponse, channel);
    } else if (AUTO_SPAWN_AFTER_GAMESTATE && !session.spawned) {
      const spawnResponse = buildSpawnEvent(session, null, "auto-after-gamestate");
      responses.push(spawnResponse);
      broadcastSpawnToRoom(session, spawnResponse, channel);
      queueAutoSpawn(session, null, "post-gamestate");
    } else if (!session.spawned) {
      console.log(`[event] waiting client spawn request actor=${session.actorId} team=${normalizeTeamForRoom(session)} mode=${roomMode(session)}`);
    }
    queuePeerActorRepair(session, channel, "post-gamestate");
    return responses;
  }

  if (eventCode === 100) {
    if (isZombieRoom(session.room)) {
      console.log(`[zombie] spawn request ignored actor=${session.actorId} reason=server-driven mode=${zombieModeForRoom(session.room)} ready=${zombieReadyPlayers(session.room).length}/${ZOMBIE_MIN_PLAYERS}`);
      return [];
    }
    if (isStandardRoundPaused(session.room)) {
      console.log(`[round] spawn request ignored actor=${session.actorId} reason=round-paused`);
      return [];
    }
    if (session.spawned && !session.dead) {
      console.log(`[event] spawn request ignored actor=${session.actorId} reason=already-spawned team=${session.team}`);
      return [];
    }
    const team = getTeamFromEventData(parsed, normalizeTeamForRoom(session));
    const respawnAfterDeath = Boolean(session.dead);
    session.lastGameStateResponseAt = 0;
    clearSpawnStallRecovery(session);
    clearSpawnSelfRetryTimers(session);
    clearJoinRoomTimers(session);
    session.spawnSeq = (session.spawnSeq || 0) + 1;
    const spawnSeq = session.spawnSeq;
    const response = buildSpawnEvent(session, team, "client-request");
    const selfSpawnCommand = makeSessionReliableCommand(session, response, channel);
    if (sendReliableCommandToSession(session, selfSpawnCommand)) {
      console.log(`[sync] spawn-self actor=${session.actorId} seq=${selfSpawnCommand.seq} reason=${respawnAfterDeath ? "respawn" : "spawn"}`);
    }
    queueSelfSpawnRetry(session, selfSpawnCommand, spawnSeq, respawnAfterDeath ? "respawn" : "spawn");
    if (respawnAfterDeath) {
      session.pendingSpawnBroadcast = { payload: response, channel };
      console.log(`[sync] spawn actor=${session.actorId} peer-broadcast=deferred-until-move reason=respawn`);
      return [];
    }
    broadcastSpawnToRoom(session, response, channel);
    return buildPeerSpawnReplayEvents(session);
  }

  if (eventCode === 99) {
    if (isRoundPausedSession(session)) {
      if (DEBUG_MOVE_PACKETS) {
        console.log(`[round] move ignored actor=${session.actorId} reason=round-paused`);
      }
      return [];
    }
    if (session.dead) {
      if (DEBUG_MOVE_PACKETS) {
        console.log(`[event] move ignored actor=${session.actorId} reason=dead`);
      }
      return [];
    }
    const firstMoveAfterSpawn = !session.moveSeen;
    session.spawned = true;
    session.moveSeen = true;
    session.moveCount = (Number(session.moveCount) || 0) + 1;
    session.waitingSelfSpawnMove = false;
    clearSpawnStallRecovery(session);
    clearSpawnSelfRetryTimers(session);
    clearJoinRoomTimers(session);
    clearSpawnMoveWarningTimer(session);
    session.room.moves += 1;
    const point = transformFromEventData(parsed);
    if (point) {
      session.lastTransform = point;
      updateCtfOnMove(session, channel);
      updateControlPointOccupancyFromMove(session);
    }
    if (DEBUG_MOVE_PACKETS || session.room.moves <= 5 || session.room.moves % MOVE_LOG_EVERY === 0) {
      console.log(`[event] move actor=${session.actorId} count=${session.room.moves}${point ? ` pos=${fmtPoint(point)}` : ""}`);
    }
    if (session.pendingSpawnBroadcast?.payload) {
      const pending = session.pendingSpawnBroadcast;
      session.pendingSpawnBroadcast = null;
      const spawnPeers = broadcastSpawnToRoom(session, pending.payload, pending.channel ?? channel);
      console.log(`[sync] deferred-spawn actor=${session.actorId} peers=${spawnPeers} reason=first-move-after-respawn`);
    }
    if (session.room.moves === 1 || session.room.moves % 250 === 0) {
      postBattleEvent(session, "move", { eventData: { count: session.room.moves } });
    }
    const move = buildActorDataEvent(session, 99, parsed);
    const movePeers = broadcastMoveToRoom(session, move, channel);
    if ((DEBUG_MOVE_PACKETS || session.room.moves <= 5 || session.room.moves % MOVE_LOG_EVERY === 0) && movePeers.total > 0) {
      console.log(`[sync] move actor=${session.actorId} peers=${movePeers.total} reliable=${movePeers.reliable} unreliable=${movePeers.unreliable || 0} spectator=${movePeers.spectator}${movePeers.spectator ? ` spectatorChannel=${movePeers.spectatorChannel}` : ""} count=${session.room.moves}`);
    }
    if (firstMoveAfterSpawn) {
      queuePostSpawnPickupSync(session, "second-move-after-spawn");
    }
    const pickup = firstMoveAfterSpawn ? null : buildProximityPickItemEvent(session, point);
    if (pickup?.pickEvent) {
      broadcastReliableToRoom(session, pickup.pickEvent, channel, "item-pick", {
        requireLiveReady: false,
        markItemHiddenId: pickup.itemId,
      });
    }
    return pickup?.pickEvent ? [pickup.pickEvent, ...(pickup.localEvents || [])] : [];
  }

  if (eventCode === 96) {
    const response = buildReloadEvent(session, parsed, channel);
    if (response) broadcastReliableToRoom(session, response, channel, "reload", { requireLiveReady: true });
    return response ? [response] : [];
  }

  if (eventCode === 93) {
    const response = buildPickItemEvent(session, parsed);
    if (response?.pickEvent) {
      broadcastReliableToRoom(session, response.pickEvent, channel, "item-pick", {
        requireLiveReady: false,
        markItemHiddenId: response.itemId,
      });
    }
    return response?.pickEvent ? [response.pickEvent, ...(response.localEvents || [])] : [];
  }

  if (eventCode === 97) {
    const response = buildShotEvent(session, parsed);
    const zombieRoundEndEvents = [];
    const standardRoundEndEvents = [];
    if (response?.shotEvent) {
      if (response.weaponConfirm) {
        const confirmPeers = broadcastShotWeaponConfirmToRoom(session, response.weaponConfirm, channel);
        if (confirmPeers > 0) {
          const state = response.weaponConfirm.state;
          console.log(`[sync] shot-weapon-confirm actor=${session.actorId} peers=${confirmPeers} slot=${state.slot} type=${state.type} name=${state.systemName}`);
        }
      }
      broadcastReliableToRoom(session, response.shotEvent, channel, "shot", { requireMoveSeen: true });
      for (const impactEvent of response.impactEvents || []) {
        broadcastReliableToRoom(session, impactEvent, channel, "impact", { requireMoveSeen: true });
      }
      for (const killEvent of response.killEvents || []) {
        broadcastReliableToRoom(session, killEvent, channel, "kill");
      }
      if (response.scoreEvent) {
        const scorePeers = broadcastReliableToRoom(session, response.scoreEvent, channel, "score");
        console.log(`[sync] score-update actor=${session.actorId} peers=${scorePeers} kills=${numberOr(session.kills, 0)} deaths=${numberOr(session.deaths, 0)} points=${numberOr(session.points, 0)} team1=${teamScorePoints(session, 1)} team2=${teamScorePoints(session, 2)}`);
      }
      if (response.killEvents?.length) {
        console.log(`[sync] kill-self actor=${session.actorId} events=${response.killEvents.length} score=${response.scoreEvent ? "yes" : "no"} delivery=cached-response`);
      }
      gateKilledSessionsAfterDelivery(response);
      if (response.killEvents.length) {
        maybeFinishZombieRound(session.room, "kill", channel, session, zombieRoundEndEvents);
        maybeFinishStandardRound(session.room, "kill", channel, session, standardRoundEndEvents);
      }
    }
    return response?.shotEvent
      ? [
          response.localShotEvent || response.shotEvent,
          ...(response.impactEvents || []),
          ...(response.killEvents || []),
          ...(response.scoreEvent ? [response.scoreEvent] : []),
          ...(response.localAmmoSync ? [response.localAmmoSync] : []),
          ...zombieRoundEndEvents,
          ...standardRoundEndEvents,
        ]
      : [];
  }

  if (eventCode === 98) {
    const response = buildWeaponChangeEvent(session, parsed);
    const ammoSync = response ? makeReloadUpdateEvent(session, weaponStateBySlot(session, session.currentWeaponSlot)) : null;
    if (response) {
      const weaponPeers = broadcastLiveToRoom(session, response, channel);
      if (weaponPeers.total > 0) {
        console.log(`[sync] weapon-change actor=${session.actorId} peers=${weaponPeers.total} reliable=${weaponPeers.reliable} spectator=${weaponPeers.spectator}${weaponPeers.spectator ? ` spectatorChannel=${weaponPeers.spectatorChannel}` : ""}`);
      }
    }
    return response ? [response, ...(ammoSync ? [ammoSync] : [])] : [];
  }
  if (eventCode === 77) {
    const animation = buildActorDataEvent(session, 77, parsed);
    const animationPeers = broadcastLiveToRoom(session, animation, channel);
    if (DEBUG_MOVE_PACKETS && animationPeers.total > 0) {
      console.log(`[sync] animation actor=${session.actorId} peers=${animationPeers.total} reliable=${animationPeers.reliable} spectator=${animationPeers.spectator}${animationPeers.spectator ? ` spectatorChannel=${animationPeers.spectatorChannel}` : ""}`);
    }
    return [];
  }
  console.log(`[event] ack only code=${eventCode}`);
  return [];
}

async function handleUdp(port, socket, msg, rinfo) {
  if (!Buffer.isBuffer(msg) || msg.length < 12 || msg.length > MAX_UDP_DATAGRAM_BYTES) return;
  if (!allowUdpPacket(rinfo, msg.length)) return;

  let offset = 12;
  const sessionId = key(port, rinfo);
  let session = sessions.get(sessionId);
  if (!session) {
    const reboundSession = findNatRebindSession(port, msg, rinfo);
    if (reboundSession) {
      session = rebindSessionEndpoint(reboundSession, sessionId, socket, rinfo);
    }
  }
  if (!session) {
    if (sessions.size >= MAX_SESSIONS_TOTAL) return;
    if (sessionCountForIp(rinfo.address) >= MAX_SESSIONS_PER_IP) return;
    session = {
      peerId: 1,
      actorId: 1,
      challenge: readU32(msg, 8),
      // VerifyConnect is an ENet control command and is not dispatched through
      // Photon payload order. The first real Photon payload must therefore use
      // reliable sequence 1, otherwise the Unity client ACKs it but waits for
      // missing sequence 1 forever.
      serverSeq: 0,
      unreliableSeq: 0,
      serverSeqByChannel: new Map(),
      unreliableSeqByChannel: new Map(),
      outboundReliable: new Map(),
      outboundRoundTripTime: OUTBOUND_RELIABLE_INITIAL_RTO_MS,
      outboundRoundTripVariance: 0,
      verifySeq: null,
      seenVerify: false,
      room: ensureRoom({ name: DEFAULT_ROOM, map: DEFAULT_MAP, mode: FORCE_TEAM_MODE ? 2 : 1, maxUsers: 8 }),
      roomRaw: null,
      actorRaw: null,
      peerActorRaw: null,
      peerActorRawBytes: 0,
      peerActorLoadoutSlots: 0,
      peerActorProfile: "",
      joinActorRaw: null,
      joinActorRawBytes: 0,
      joinActorLoadoutSlots: 0,
      joinActorProfile: "",
      actorJoinParam: null,
      team: -1,
      zombieType: ZOMBIE_TYPE.HUMAN,
      zombieInfectionHits: 0,
      zombieLastInfectorActorId: 0,
      spawned: false,
      dead: false,
      moveSeen: false,
      moveCount: 0,
      waitingSelfSpawnMove: false,
      currentWeaponSlot: 1,
      weaponStates: makeWeaponRuntimeState(null),
      peerWeaponConfirmKeys: new Map(),
      visibleItemIds: new Set(),
      activeItemShots: new Map(),
      impactTimers: new Map(),
      spawnSeq: 0,
      spawnRetry: null,
      spawnMoveWarningTimer: null,
      spawnSelfRetryTimers: new Set(),
      joinSelfEventTimer: null,
      joinStartEventTimer: null,
      joinSettingsTimers: [],
      joinLateStartTimers: [],
      gameStateRequested: false,
      lastGameStateResponseAt: 0,
      reliableResponses: new Map(),
      reliableInFlight: new Map(),
      reliableFragments: new Map(),
      reliableGeneration: 0,
      knownActorIds: new Set(),
      actorJoinAnnouncedAt: new Map(),
      joinActorListIds: new Set(),
      deferredJoinActorIds: new Set(),
      peerSpawnTimers: new Set(),
      pendingSpawnBroadcast: null,
      pendingPickupSync: null,
      pickupSpawnRepairTimers: new Set(),
      lastChannel: 0,
      port,
      remoteKey: `${rinfo.address}:${rinfo.port}`,
      playerId: 1,
      playerAuthKey: "",
      playerName: process.env.DEFAULT_PLAYER_NAME || "ContraCity",
      lastSeenAt: Date.now(),
      health: playerRuntimeStats(null).maxHealth,
      energy: playerRuntimeStats(null).maxEnergy,
      kills: 0,
      deaths: 0,
      points: 0,
      domination: 0,
      revenge: 0,
      maxDomination: 0,
      maxRevenge: 0,
      revengeStreak: 0,
      killStreakByVictim: new Map(),
      dominatedBy: new Set(),
      expEarned: 0,
      exp2clan: 0,
      matchStartedAt: 0,
      matchStatsPosted: false,
      matchShots: 0,
      matchHits: 0,
      matchKills: 0,
      matchDeaths: 0,
      matchHeadKills: 0,
      matchNutsKills: 0,
      matchSuicides: 0,
      matchDomination: 0,
      matchRevenge: 0,
      matchExp: 0,
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
  refreshSessionReliableEndpoint(session, socket, rinfo);
  const packetNow = Date.now();
  session.lastSeenAt = packetNow;
  maybePruneIdleRoomSessions(packetNow);
  maybePruneIdleMasterSessions(packetNow);

  const commands = [];
  let peerIdOverride = null;
  let lastChannel = 0;
  let transportDisconnected = false;
  const commandCount = msg[3] || 0;
  if (commandCount > MAX_ENET_COMMANDS_PER_PACKET) return;
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
    if (commandLength < 12 || commandEnd > msg.length) {
      if (DEBUG_PACKETS) {
        console.log(`[security] invalid command length ip=${rinfo.address} port=${port} type=${commandType} bytes=${commandLength}/${msg.length - offset}`);
      }
      break;
    }
    const payloadOffset = commandType === 0x07 ? offset + 16 : (commandType === 0x08 ? offset + 32 : offset + 12);
    if (DEBUG_PACKETS || ![0x01, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0c].includes(commandType)) {
      console.log(`[cmd:${port}] type=${commandType} seq=${reliableSeq} size=${commandLength}`);
    }

    if (commandType === 0x01) {
      if (commandEnd >= offset + 20) {
        acknowledgeOutboundReliable(session, channel, readU32(msg, offset + 12));
      }
    } else if (commandType === 0x02) {
      session.seenVerify = true;
      commands.push(makeAck(channel, reliableSeq, sentTime));
      if (session.verifySeq == null) {
        session.verifySeq = session.serverSeq++;
      }
      const verifySeq = session.verifySeq;
      commands.push(makeVerifyConnect(verifySeq));
      peerIdOverride = 0xffff;
      console.log(`[state] verify connect seq=${verifySeq}`);
    } else if (commandType === 0x04) {
      commands.push(makeAck(channel, reliableSeq, sentTime));
      if (!session.transportDisconnected) {
        session.transportDisconnected = true;
        transportDisconnected = true;
        const disconnectedRoom = session.room?.name || "none";
        detachMasterSession(session, "enet-disconnect");
        detachSessionFromRoom(session, "enet-disconnect");
        if (session.sessionId) sessions.delete(session.sessionId);
        console.log(`[state] enet disconnect port=${port} actor=${session.actorId || 0} player=${session.playerId || "unknown"} room=${disconnectedRoom}`);
      }
    } else if (commandType === 0x05 || commandType === 0x0c) {
      commands.push(makeAck(channel, reliableSeq, sentTime));
    } else if ((commandType === 0x06 || commandType === 0x07 || commandType === 0x08) && payloadOffset <= commandEnd) {
      commands.push(makeAck(channel, reliableSeq, sentTime));
      if (!session.seenVerify && session.verifySeq == null) {
        session.verifySeq = session.serverSeq++;
        commands.push(makeVerifyConnect(session.verifySeq));
        peerIdOverride = 0xffff;
        console.log(`[state] implicit verify connect seq=${session.verifySeq} reason=missing-handshake command=${commandType}`);
        offset = commandEnd;
        continue;
      }
      let cacheKey = commandType === 0x06 ? `${session.reliableGeneration || 0}:${channel}:${reliableSeq}` : null;
      let payload = msg.subarray(payloadOffset, commandEnd);
      let fragment = null;
      if (commandType === 0x08) {
        fragment = parseReliableFragmentCommand(msg, offset, commandEnd, channel, reliableSeq);
        if (fragment.error) {
          console.log(`[fragment] ignored actor=${session.actorId} seq=${reliableSeq} channel=${channel} reason=${fragment.error}`);
          offset = commandEnd;
          continue;
        }
        cacheKey = reliableFragmentCacheKey(session, channel, fragment.startSeq);
      }
      if (cacheKey && session.reliableResponses.has(cacheKey)) {
        const cached = session.reliableResponses.get(cacheKey);
        commands.push(...cached);
        console.log(`[state] reliable replay seq=${reliableSeq} cached=${cached.length}${commandType === 0x08 ? ` fragmentStart=${fragment.startSeq}` : ""}`);
        offset = commandEnd;
        continue;
      }
      if (cacheKey && session.reliableInFlight.has(cacheKey)) {
        const cached = await session.reliableInFlight.get(cacheKey);
        commands.push(...cached);
        console.log(`[state] reliable replay-wait seq=${reliableSeq} cached=${cached.length}${commandType === 0x08 ? ` fragmentStart=${fragment.startSeq}` : ""}`);
        offset = commandEnd;
        continue;
      }

      if (commandType === 0x08) {
        const complete = addReliableFragment(session, fragment);
        if (ENET_FRAGMENT_TRACE) {
          console.log(`[fragment] recv actor=${session.actorId} seq=${reliableSeq} start=${fragment.startSeq} part=${fragment.fragmentNumber + 1}/${fragment.fragmentCount} offset=${fragment.fragmentOffset} bytes=${fragment.payload.length}/${fragment.totalLength} complete=${complete ? "yes" : "no"} channel=${channel}`);
        }
        if (!complete) {
          offset = commandEnd;
          continue;
        }
        session.reliableFragments.delete(cacheKey);
        payload = complete.payload;
      }

      try {
        const parsed = parsePhotonRequest(payload);
        if (commandType === 0x08 && ENET_FRAGMENT_TRACE) {
          const eventCode = photonEventCode(parsed);
          console.log(`[fragment] complete actor=${session.actorId} start=${fragment.startSeq} event=${eventCode ?? "init"}${eventCode === 97 ? ` ${describeShotRequest(parsed)}` : ""} bytes=${payload.length} channel=${channel}`);
        }
        if (shouldLogParsedPayload(parsed)) {
          if (parsed?.messageType === 2) {
            console.log(`[payload] op-request ${payload.toString("hex").slice(0, 160)}`);
          } else {
            console.log(`[payload] messageType=${parsed?.messageType ?? "raw"} ${payload.toString("hex").slice(0, 160)}`);
          }
        }

        const buildReliableCommands = () => buildReliableCommandsForParsedPayload(port, socket, rinfo, session, parsed, payload, channel);

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

  if (!transportDisconnected) {
    maybeAppendQueuedSpawn(session, commands, lastChannel);
    maybeAppendPostSpawnPickupSync(session, commands, lastChannel);
    maybeAppendRespawnItems(session, commands, lastChannel);
  }

  if (commands.length > 0) {
    sendPacket(socket, rinfo, session, commands, peerIdOverride);
  }
}

console.log(`[config] build=${BUILD_ID} host=${PUBLIC_HOST} api=${API_BASE_URL} initReply=${INIT_REPLY} teamMode=${FORCE_TEAM_MODE ? "team" : "room"} autoSpawn=${AUTO_SPAWN_AFTER_GAMESTATE ? "on" : "off"} retry=${AUTO_SPAWN_RETRY_LIMIT}x${AUTO_SPAWN_RETRY_MS}ms spawnNoMoveWarn=${SPAWN_NO_MOVE_WARN_MS}ms spawnSelfRetry=${formatDelayList(SPAWN_SELF_RETRY_DELAYS_MS)} reliableRetry=${OUTBOUND_RELIABLE_INITIAL_RTO_MS}ms/x2/count${OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE}/timeout${OUTBOUND_RELIABLE_DISCONNECT_MS}ms debugPackets=${DEBUG_PACKETS ? "on" : "off"} sendLog=${LOG_SEND_PACKETS ? "on" : "off"} moveLogEvery=${MOVE_LOG_EVERY} moveBroadcast=${MOVE_BROADCAST_UNRELIABLE ? "unreliable" : "reliable"} spawnIndex=${SPAWN_INDEX || "actor"} spawnYOffset=${SPAWN_Y_OFFSET || 0} joinLoadoutSlots=${JOIN_LOADOUT_SLOT_LIMIT} peerLoadout=mandatory-full:${FULL_LOADOUT_SLOT_LIMIT} legacyWeaponFields=${INCLUDE_WEAPON_LEGACY_FIELDS ? "on" : "off"} joinWears=${INCLUDE_JOIN_WEARS ? "on" : "off"} battleEnhancers=${INCLUDE_BATTLE_ENHANCERS ? "on" : "off"} battleTaunts=on joinTauntCompact=on trainingAbilities=1-11 weaponWorkshop=on dossierStats=on deferredPeerWears=on actorEchoFields=${INCLUDE_JOIN_ACTOR_ECHO_FIELDS ? "on" : "off"} gameStateActor=${INCLUDE_ACTOR_IN_GAMESTATE ? "on" : "off"} gameStatePeers=${INCLUDE_PEERS_IN_GAMESTATE ? "on" : "off"} gameStateRepeat=${GAMESTATE_REPEAT_MIN_MS}ms maxUdp=${MAX_UDP_PACKET_BYTES} actorJoinMax=${ACTOR_JOIN_MAX_PACKET_BYTES} gameStateScore=actorRaw liveScoreUpdate=on killfeed=gameState dominationStreak=${DOMINATION_STREAK_KILLS} battleExp=${ENABLE_BATTLE_EXP ? "on" : "off"} expPerKill=${BATTLE_EXP_PER_KILL} peerSpawnAfterSelf=${REPLAY_PEER_SPAWNS_AFTER_SELF ? "on" : "off"} peerSpawnConfirm=${CONFIRM_PEER_SPAWN_AFTER_ISENEMY ? "on" : "off"} peerActorRepair=${formatDelayList(PEER_ACTOR_REPAIR_DELAYS_MS)} joinSelfDelay=${JOIN_SELF_EVENT_DELAY_MS}ms joinSelfProfileWait=${JOIN_SELF_PROFILE_WAIT_MS}ms joinProfileRetry=${JOIN_PROFILE_RETRY_MS}ms joinProfileMax=${JOIN_PROFILE_MAX_WAIT_MS}ms allowFallbackJoin=${ALLOW_FALLBACK_JOIN_PROFILE ? "on" : "off"} joinStartFallback=${JOIN_START_EVENT_FALLBACK_DELAY_MS}ms joinSettingsPush=${formatDelayList(JOIN_SETTINGS_PUSH_DELAYS_MS)} joinLateStart=${formatDelayList(JOIN_LATE_START_DELAYS_MS)} actorJoinAsyncDelay=${ACTOR_JOIN_ASYNC_DELAY_MS}ms profileJoinWait=${PROFILE_JOIN_WAIT_MS}ms cachedJoinRefresh=on interpolationMode=${ROOM_INTERPOLATION_MODE} moveRotationKey7=${ADD_MOVE_ROTATION_KEY ? "on" : "off"} destroyGeometry=${DESTROY_GEOMETRY ? "on" : "off"} rapidityNormalize=${NORMALIZE_WEAPON_RAPIDITY ? "on" : "off"} shotSlack=${SHOT_THROTTLE_SLACK_MS}ms mapPickups=${ENABLE_MAP_PICKUPS ? "on" : "off"} pickupGameState=${MAP_PICKUPS_IN_GAMESTATE ? "on" : "off"} pickupPostSpawn=second-move-response pickupSpawnRepair=${formatDelayList(PICKUP_SPAWN_REPAIR_DELAYS_MS)} pickupRadius=${ITEM_PICKUP_RADIUS} itemRespawn=${ITEM_RESPAWN_MS}ms requirePickupBenefit=${REQUIRE_PICKUP_BENEFIT ? "on" : "off"} damage=${ENABLE_BATTLE_DAMAGE ? "on" : "off"} damageRange=${DAMAGE_SHORT_RANGE}/${DAMAGE_MEDIUM_RANGE} meleeMax=${DAMAGE_MELEE_MAX_DISTANCE} damageRangeSort=${DAMAGE_SORT_RANGES_BY_POWER ? "power-desc" : "raw"} damageMult=head:${DAMAGE_HEAD_MULTIPLIER},headBonusMax:${DAMAGE_MAX_HEAD_BONUS_PERCENT},engine:${DAMAGE_ENGINE_MULTIPLIER},crit:${DAMAGE_CRIT_MULTIPLIER},critChanceMax:${DAMAGE_MAX_CRIT_CHANCE} impactDot=${IMPACT_DOT_TICK_MS}msx${IMPACT_DOT_DEFAULT_TICKS} impactReferenceDmgRed=${IMPACT_REFERENCE_DAMAGE_REDUCTION} explosion=${DAMAGE_EXPLOSION_FULL_RADIUS}/${DAMAGE_EXPLOSION_ZERO_RADIUS} bikerHpFloor=${BIKER_SET_HEALTH_FLOOR} bikerSpeedFloor=${BIKER_SET_SPEED_FLOOR} bikerWeaponSpeedBonus=${BIKER_SET_WEAPON_SPEED_BONUS} shotgunJumpSmall=${SHOTGUN_RECOIL_SMALL_JUMP_BONUS} shotgunJumpBonus=${SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpAbove=${SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS} bigShotgunJumpBonus=${BIG_SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpHuge=${SHOTGUN_RECOIL_HUGE_JUMP_BONUS} bikerShotgunJumpBonus=${BIKER_SET_SHOTGUN_JUMP_BONUS} maxJump=${MAX_PLAYER_JUMP} maxEnergy=${MAX_PLAYER_ENERGY} lobbyRoomSplit=on reliableDedupe=on reliableFragments=on fragmentTrace=${ENET_FRAGMENT_TRACE ? "on" : "off"} shotResponseTrace=${SHOT_LOCAL_RESPONSE_TRACE ? "on" : "off"} roomSync=on roomIsolation=global-duplicate+empty-prune idlePrune=${ROOM_SESSION_IDLE_MS}ms preSpawnSpectatorLive=${SPECTATOR_LIVE_UNRELIABLE ? (SPECTATOR_MOVE_UNRELIABLE ? "channel1-unreliable-move+animation+weapon" : "channel1-unreliable-animation+weapon") : "blocked"} peerLiveGate=move-seen-only spectatorLiveUnreliable=${SPECTATOR_LIVE_UNRELIABLE ? "on" : "off"} spectatorMoveUnreliable=${SPECTATOR_MOVE_UNRELIABLE ? "on" : "off"} spectatorLiveChannel=${SPECTATOR_LIVE_CHANNEL} gameMasterPort=${GAME_MASTER_PORT} socialMasterPorts=${Array.from(SOCIAL_MASTER_PORTS).join(",")} shotWeaponConfirm=on respawnAmmoReset=on spawnArmorBase0=on projectileLaunchInfer=on projectileSelfDamage=on projectileLaunchKeyLog=on grenadeFlight=${ARCING_LAUNCHER_VELOCITY}/${ARCING_LAUNCHER_LIFE}/${ARCING_LAUNCHER_DISTANCE}`);
console.log(`[config] zombie minPlayers=${ZOMBIE_MIN_PLAYERS} regularHp=${ZOMBIE_REGULAR_MAX_HEALTH} bossHp=${ZOMBIE_BOSS_MAX_HEALTH} regen=${ZOMBIE_REGEN_TICK_MS}ms regular=${ZOMBIE_REGULAR_REGEN_MIN}-${ZOMBIE_REGULAR_REGEN_MAX} boss=${ZOMBIE_BOSS_REGEN_MIN}-${ZOMBIE_BOSS_REGEN_MAX} updateRepair=${formatDelayList(ZOMBIE_UPDATE_REPAIR_DELAYS_MS)}`);
console.log(`[security] serviceToken=${API_TOKEN ? "configured" : "missing"} udpDatagramMax=${MAX_UDP_DATAGRAM_BYTES} commandsMax=${MAX_ENET_COMMANDS_PER_PACKET} sessions=${MAX_SESSIONS_TOTAL}/ip${MAX_SESSIONS_PER_IP} udpRate=${UDP_RATE_PACKETS_PER_IP}pkts/${UDP_RATE_BYTES_PER_IP}bytes/${UDP_RATE_WINDOW_MS}ms tcpPerIp=${TCP_MAX_CONNECTIONS_PER_IP} tcpIdle=${TCP_IDLE_TIMEOUT_MS}ms`);

const zombieRegenInterval = setInterval(runZombieRegenerationTick, ZOMBIE_REGEN_TICK_MS);
if (typeof zombieRegenInterval.unref === "function") zombieRegenInterval.unref();
const outboundReliableRetryInterval = setInterval(runOutboundReliableRetries, OUTBOUND_RELIABLE_SWEEP_MS);
if (typeof outboundReliableRetryInterval.unref === "function") outboundReliableRetryInterval.unref();

for (const port of PORTS) {
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    handleUdp(port, udp, msg, rinfo).catch((error) => {
      console.log(`[udp:${port}] handler failed ${error.stack || error.message}`);
    });
  });
  udp.bind(port, "0.0.0.0", () => console.log(`[udp] ${port} listening`));

  const tcp = net.createServer((socket) => {
    const address = String(socket.remoteAddress || "unknown");
    const active = Number(tcpConnectionsByIp.get(address) || 0);
    if (active >= TCP_MAX_CONNECTIONS_PER_IP) {
      socket.destroy();
      return;
    }
    tcpConnectionsByIp.set(address, active + 1);
    socket.setTimeout(TCP_IDLE_TIMEOUT_MS);
    socket.setNoDelay(true);
    let receivedBytes = 0;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const current = Number(tcpConnectionsByIp.get(address) || 1) - 1;
      if (current > 0) tcpConnectionsByIp.set(address, current);
      else tcpConnectionsByIp.delete(address);
    };
    socket.once("close", release);
    socket.once("error", release);
    socket.on("timeout", () => socket.destroy());
    console.log(`[tcp:${port}] client ${address}:${socket.remotePort}`);
    socket.on("data", (data) => {
      receivedBytes += data.length;
      if (receivedBytes > TCP_MAX_BYTES_PER_CONNECTION) {
        socket.destroy();
        return;
      }
      if (DEBUG_PACKETS) console.log(`[tcp:${port}] ${data.length} bytes`);
    });
  });
  tcp.maxConnections = Math.max(100, MAX_SESSIONS_TOTAL);
  tcp.listen(port, "0.0.0.0", () => console.log(`[tcp] ${port} listening`));
}

