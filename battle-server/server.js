const dgram = require("dgram");
const net = require("net");
const crypto = require("crypto");
const { TextDecoder } = require("util");
const { monitorEventLoopDelay } = require("perf_hooks");

function boundedEnvInt(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
}

const PORTS = (process.env.BATTLE_PORTS || "5055,5056,5057,5058,5255")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter(Boolean);
const API_BASE_URL = (process.env.API_BASE_URL || "https://contra-city-api-production-fedf.up.railway.app").replace(/\/+$/, "");
const API_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";
const RETIRED_PUBLIC_HOST = "54.145.212.225";
const DEFAULT_PUBLIC_HOST = "3.76.0.237";
const CONFIGURED_PUBLIC_HOST = String(process.env.PUBLIC_HOST || "").trim();
const PUBLIC_HOST = !CONFIGURED_PUBLIC_HOST || CONFIGURED_PUBLIC_HOST === RETIRED_PUBLIC_HOST
  ? DEFAULT_PUBLIC_HOST
  : CONFIGURED_PUBLIC_HOST;
const SERVER_NAME = process.env.SERVER_NAME || "Contra City";
const BUILD_ID = "battle-server-2026-08-28-expedition-ai-coop-v309";
// Isolated Expedition protocol. Code 157 is unused by the recovered client;
// no existing Photon event (84/97/99/100/105) is repurposed.
const EXPEDITION_EVENT = 157;
const EXPEDITION_COMMAND = Object.freeze({
  START: 1, WAVE: 2, COMPLETE: 3,
  SOLO_QUEUE_JOIN: 10, SOLO_QUEUE_CANCEL: 11,
  PARTY_CREATE: 20, PARTY_LEAVE: 21, PARTY_INVITE: 22, PARTY_INVITE_RESPONSE: 23, PARTY_READY: 24, PARTY_REFRESH: 25,
  // A developer-only lobby request. It does not weaken the normal 4/4
  // SOLO/party launch gates; the server rechecks the fresh staff role below.
  DEVELOPER_SOLO_LAUNCH: 30,
  STARTED: 101, COMPLETED: 102, REJECTED: 103,
  SOLO_QUEUE_STATE: 110, SOLO_QUEUE_LAUNCH: 111, SOLO_QUEUE_REJECTED: 112,
  PARTY_STATE: 120, PARTY_INVITATION: 121, PARTY_LAUNCH: 123, PARTY_REJECTED: 124,
  // Co-op PvE is deliberately carried only by the isolated Expedition event.
  // Legacy Photon Event84/99/100/105 contracts remain untouched.
  PLAYER_STATE: 40, SHOT_INTENT: 41, REVIVE_REQUEST: 42, RESYNC_REQUEST: 43,
  HOST_SNAPSHOT: 44, HOST_ACTION: 45, HOST_DAMAGE: 46,
  AI_AUTHORITY: 130, AI_SNAPSHOT: 131, AI_LIFECYCLE: 132, AI_DAMAGE: 133,
  AI_REVIVE: 134, AI_WIPE: 135, AI_RESYNC: 136,
});
const expeditionSoloQueues = new Map();
let expeditionSoloQueueSequence = 0;
const expeditionParties = new Map();
let expeditionPartySequence = 0;
const expeditionPartyFriendCache = new Map();
const EXPEDITION_PARTY_FRIEND_CACHE_MS = 5000;
const EXPEDITION_WAVE_REPORT_MIN_MS = Math.max(1000, Number(process.env.EXPEDITION_WAVE_REPORT_MIN_MS || 5000));
const EXPEDITION_AI_SNAPSHOT_MIN_MS = 180;
const EXPEDITION_AI_COMMAND_MIN_MS = 35;
const EXPEDITION_AI_MAX_PAYLOAD_BYTES = 24576;
// Private voice protocol. It is intentionally outside the recovered original
// contract: original Contra City has no voice client or server events.
const VOICE_FRAME_EVENT = 68;
const VOICE_CAPABILITY_EVENT = 69;
const PLAYER_REPORT_EVENT = 66;
// Private staff protocol. Event99 keeps its recovered original payload; this
// event only authorizes the restored staff flight state on the battle server.
const STAFF_FLIGHT_EVENT = 218;
const VOICE_PROTOCOL_LEGACY = 1;
const VOICE_PROTOCOL_OPUS_V2 = 2;
const VOICE_PROTOCOL_OPUS = 3;
const VOICE_PROTOCOL_VERSION = VOICE_PROTOCOL_OPUS;
const VOICE_PROTOCOL_SIGNATURE_V2 = "cc-voice-v2";
const VOICE_PROTOCOL_SIGNATURE = "cc-voice-v3";
const VOICE_CHANNEL = 1;
const VOICE_FRAME_BYTES = 160; // Legacy v1: 20 ms, 8 kHz, mono, G.711 mu-law.
const VOICE_OPUS_MAX_FRAME_BYTES = 400; // v2/v3: 16 kHz mono Opus, FEC included.
const VOICE_OPUS_V2_FRAME_MS = 20;
const VOICE_OPUS_FRAME_MS = 40;
const VOICE_RATE_WINDOW_MS = 1000;
const VOICE_RATE_MAX_FRAMES_V2 = 55;
const VOICE_RATE_MAX_FRAMES = 30;
const VOICE_RATE_MAX_BYTES = VOICE_OPUS_MAX_FRAME_BYTES * VOICE_RATE_MAX_FRAMES;
const PLAYER_REPORT_COOLDOWN_MS = 90 * 1000;
const PLAYER_REPORT_TEXT_MAX = 700;
const PLAYER_REPORT_REASON = Object.freeze({
  1: "cheats",
  2: "abuse",
  3: "voice_abuse",
  4: "griefing",
  5: "other",
});
const STAFF_ROLE_ORDER = Object.freeze(["none", "helper", "moderator", "admin", "owner", "developer"]);
const STAFF_ROLE_RANK = Object.freeze({
  none: 0,
  helper: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
  developer: 4,
});
const STAFF_CAPABILITY_MIN_ROLE = Object.freeze({
	flight: "helper",
	kick: "helper",
  panel: "moderator",
  private_room: "moderator",
  spectator: "moderator",
  ban: "admin",
});
const STAFF_DISCONNECT_GRACE_MS = boundedEnvInt("STAFF_DISCONNECT_GRACE_MS", 750, 250, 3000);
const STAFF_REASON_MAX_LENGTH = boundedEnvInt("STAFF_REASON_MAX_LENGTH", 300, 1, 1000);
// KickManager.cs owns these two client-visible timings. The original server
// threshold is not present in the client; this restore uses a strict majority
// of the room's active kick-capable players.
const KICK_VOTE_DURATION_MS = 30000;
const KICK_VOTE_COOLDOWN_MS = 240000;
const KICK_VOTE_REASON_NAMES = Object.freeze({
  1: "cheating",
  2: "threats",
  3: "other",
});
const GAME_MASTER_PORT = Number(process.env.GAME_MASTER_PORT || 5058);
const SOCIAL_MASTER_PORTS = new Set(
  String(process.env.SOCIAL_MASTER_PORTS || process.env.SOCIAL_MASTER_PORT || "5057")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Boolean)
);
const PRIMARY_BATTLE_PORT = PORTS.find((port) => port !== GAME_MASTER_PORT && !SOCIAL_MASTER_PORTS.has(port)) || 5055;
const CLAN_TREASURY_POLL_MS = Math.max(250, Number(process.env.CLAN_TREASURY_POLL_MS || 750));
const CLAN_TREASURY_POLL_LIMIT = Math.max(1, Math.min(200, Number(process.env.CLAN_TREASURY_POLL_LIMIT || 100)));
const CLAN_TREASURY_EVENT_ADD = 17;
const CLAN_TREASURY_RECORD_ADD = 1;
const CLAN_EVENT_CHANGE_ARM = 5;
const CLAN_EVENT_ADD_EVENT = 20;
const FORCE_TEAM_MODE = process.env.FORCE_TEAM_MODE === "1";
const AUTO_SPAWN_AFTER_GAMESTATE = process.env.AUTO_SPAWN_AFTER_GAMESTATE === "1";
const PLAYER_BASE_SPEED10 = 130;
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
const ZOMBIE_UPDATE_REPAIR_DELAYS_MS = parseDelayList(process.env.ZOMBIE_UPDATE_REPAIR_DELAYS_MS || "");
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
const VERBOSE_GAMEPLAY_LOGS = process.env.VERBOSE_GAMEPLAY_LOGS === "1";
const ENABLE_BATTLE_EXP = process.env.ENABLE_BATTLE_EXP !== "0";
const BATTLE_EXP_PER_KILL = Math.max(0, Number(process.env.BATTLE_EXP_PER_KILL || 25));
// The client contains the enhancer percentages but not the server-side base awards.
// Keep those bases configurable and use the current restored kill award as one score unit.
const BATTLE_EXP_PER_ASSIST = Math.max(0, Number(process.env.BATTLE_EXP_PER_ASSIST || BATTLE_EXP_PER_KILL));
const BATTLE_EXP_PER_FLAG = Math.max(0, Number(process.env.BATTLE_EXP_PER_FLAG || 20));
const BATTLE_EXP_PER_CONTROL_POINT = Math.max(0, Number(process.env.BATTLE_EXP_PER_CONTROL_POINT || 20));
const DOMINATION_STREAK_KILLS = Math.max(0, Number(process.env.DOMINATION_STREAK_KILLS || 4));
const ACTOR_JOIN_ASYNC_DELAY_MS = Math.max(0, Number(process.env.ACTOR_JOIN_ASYNC_DELAY_MS || 1500));
const PEER_ACTOR_REPAIR_DELAYS_MS = parseDelayList(process.env.PEER_ACTOR_REPAIR_DELAYS_MS || "");
const MOVE_LOG_EVERY = Math.max(1, Number(process.env.MOVE_LOG_EVERY || 100));
const SPAWN_INDEX = Number(process.env.SPAWN_INDEX || 0);
const SPAWN_Y_OFFSET = Number(process.env.SPAWN_Y_OFFSET || 0);
const DEFAULT_TEAM = Number(process.env.DEFAULT_TEAM || 1);
const DEFAULT_ROOM = process.env.DEFAULT_ROOM || "restore-room";
const DEFAULT_MAP = process.env.DEFAULT_MAP || "Arena_3lvl";
const ROOM_SESSION_IDLE_MS = Math.max(0, Number(process.env.ROOM_SESSION_IDLE_MS || 90000));
const ROOM_SESSION_PRUNE_INTERVAL_MS = Math.max(1000, Number(process.env.ROOM_SESSION_PRUNE_INTERVAL_MS || 5000));
const ROOM_LIST_COALESCE_MS = Math.max(100, Math.min(250, Number(process.env.ROOM_LIST_COALESCE_MS || 150) || 150));
const INIT_REPLY = ["callback", "legacy", "both"].includes((process.env.INIT_REPLY || "").toLowerCase())
  ? process.env.INIT_REPLY.toLowerCase()
  : "callback";
const PUSH_ROOM_LIST_AFTER_INIT = process.env.PUSH_ROOM_LIST_AFTER_INIT === "1";
const REPLAY_PEER_SPAWNS_AFTER_SELF = process.env.REPLAY_PEER_SPAWNS_AFTER_SELF !== "0";
const CONFIRM_PEER_SPAWN_AFTER_ISENEMY = process.env.CONFIRM_PEER_SPAWN_AFTER_ISENEMY !== "0";
const PROFILE_CACHE_TTL_MS = Number(process.env.PROFILE_CACHE_TTL_MS || 30000);
const PROFILE_CACHE_MAX = boundedEnvInt("PROFILE_CACHE_MAX", 2048);
const PROFILE_LOAD_CONCURRENCY = boundedEnvInt("PROFILE_LOAD_CONCURRENCY", 16, 1, 64);
const PROFILE_LOAD_QUEUE_MAX = boundedEnvInt("PROFILE_LOAD_QUEUE_MAX", 1024);
// The original client reports a profile mutation to the game-logic connection
// immediately before it starts the separate HTTP save. Give that save a bounded
// ordering window before a real-room join reads the canonical Railway profile.
const PROFILE_CHANGE_SETTLE_MS = boundedEnvInt("PROFILE_CHANGE_SETTLE_MS", 750, 0, 5000);
const PROFILE_CHANGE_TRACK_MS = boundedEnvInt("PROFILE_CHANGE_TRACK_MS", 10000, PROFILE_CHANGE_SETTLE_MS, 60000);
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS || 300000);
const BATTLE_EVENT_CONCURRENCY = boundedEnvInt("BATTLE_EVENT_CONCURRENCY", 12, 8, 16);
const BATTLE_EVENT_QUEUE_MAX = boundedEnvInt("BATTLE_EVENT_QUEUE_MAX", 2048, 16);
const BATTLE_EVENT_TIMEOUT_MS = boundedEnvInt("BATTLE_EVENT_TIMEOUT_MS", 8000, 1000);
const BATTLE_MOVE_FLUSH_MS = boundedEnvInt("BATTLE_MOVE_FLUSH_MS", 7500, 5000, 10000);
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
const MAX_UDP_PACKET_BYTES = boundedEnvInt("MAX_UDP_PACKET_BYTES", 1200, 128, 1200);
const UDP_OUTBOX_FLUSH_MS = boundedEnvInt("UDP_OUTBOX_FLUSH_MS", 15, 10, 20);
const UDP_OUTBOX_MAX_COMMANDS = boundedEnvInt("UDP_OUTBOX_MAX_COMMANDS", 128, 1, 255);
const UDP_OUTBOX_MAX_BYTES = boundedEnvInt("UDP_OUTBOX_MAX_BYTES", 64 * 1024, MAX_UDP_PACKET_BYTES);
const RUNTIME_METRICS_INTERVAL_MS = boundedEnvInt("RUNTIME_METRICS_INTERVAL_MS", 5000, 3000, 10000);
const OUTBOUND_RELIABLE_INITIAL_RTO_MS = Math.max(50, Number(process.env.OUTBOUND_RELIABLE_INITIAL_RTO_MS || 300));
const OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE = Math.max(1, Number(process.env.OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE || 5));
const OUTBOUND_RELIABLE_DISCONNECT_MS = Math.max(1000, Number(process.env.OUTBOUND_RELIABLE_DISCONNECT_MS || 10000));
const OUTBOUND_RELIABLE_SWEEP_MS = Math.max(25, Number(process.env.OUTBOUND_RELIABLE_SWEEP_MS || 50));
const OUTBOUND_RELIABLE_RECOVERY_MS = Math.max(10000, Number(process.env.OUTBOUND_RELIABLE_RECOVERY_MS || 60000));
const OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS = Math.max(1, Number(process.env.OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS || 16));
const OUTBOUND_RELIABLE_RETRY_MAX_RTO_MS = Math.max(OUTBOUND_RELIABLE_INITIAL_RTO_MS, Number(process.env.OUTBOUND_RELIABLE_RETRY_MAX_RTO_MS || 5000));
const OUTBOUND_RELIABLE_PENDING_MAX = Math.max(128, Number(process.env.OUTBOUND_RELIABLE_PENDING_MAX || 2048));
const RELIABLE_RESPONSE_CACHE_TTL_MS = Math.max(1000, Number(process.env.RELIABLE_RESPONSE_CACHE_TTL_MS || 60000));
const RELIABLE_RESPONSE_CACHE_MAX = Math.max(128, Number(process.env.RELIABLE_RESPONSE_CACHE_MAX || 4096));
const RELIABLE_REPLAY_LOG_INTERVAL_MS = Math.max(100, Number(process.env.RELIABLE_REPLAY_LOG_INTERVAL_MS || 1000));
const INBOUND_RELIABLE_PENDING_MAX = Math.max(32, Number(process.env.INBOUND_RELIABLE_PENDING_MAX || 2048));
const PENDING_RELIABLE_STATE_MAX = boundedEnvInt("PENDING_RELIABLE_STATE_MAX", 32, 4, 256);
const API_REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.API_REQUEST_TIMEOUT_MS || 8000));
const ENET_NAT_REBIND_MAX_IDLE_MS = Math.max(1000, Number(process.env.ENET_NAT_REBIND_MAX_IDLE_MS || 60000));
const ENET_FRAGMENT_TRACE = process.env.ENET_FRAGMENT_TRACE === "1";
const ENET_MAX_FRAGMENT_COUNT = Math.max(1, Number(process.env.ENET_MAX_FRAGMENT_COUNT || 128));
const ENET_MAX_FRAGMENT_TOTAL_BYTES = Math.max(4096, Number(process.env.ENET_MAX_FRAGMENT_TOTAL_BYTES || 65536));
const PENDING_FRAGMENT_COUNT_MAX = boundedEnvInt("PENDING_FRAGMENT_COUNT_MAX", 16, 1, ENET_MAX_FRAGMENT_COUNT);
const PENDING_FRAGMENT_TOTAL_BYTES_MAX = boundedEnvInt("PENDING_FRAGMENT_TOTAL_BYTES_MAX", 16384, 1024, ENET_MAX_FRAGMENT_TOTAL_BYTES);
const SHOT_LOCAL_RESPONSE_TRACE = process.env.SHOT_LOCAL_RESPONSE_TRACE === "1";
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
const COMPLEX_RELOAD_AMMO_CLIP_MS = Math.max(1, Number(process.env.COMPLEX_RELOAD_AMMO_CLIP_MS || 1000));
const REMINGTON_FIRST_RELOAD_TICK_MS = Math.max(1, Number(process.env.REMINGTON_FIRST_RELOAD_TICK_MS || 400));
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
// Enhancer 1 has no numeric damage/radius payload in Assembly-CSharp. Reuse the
// restored explosion envelope and expose the missing original values as env knobs.
const ENHANCER_KAMIKAZE_DAMAGE = Math.max(0, Number(process.env.ENHANCER_KAMIKAZE_DAMAGE || 100));
const ENHANCER_KAMIKAZE_FULL_RADIUS = Math.max(0, Number(process.env.ENHANCER_KAMIKAZE_FULL_RADIUS || DAMAGE_EXPLOSION_FULL_RADIUS));
const ENHANCER_KAMIKAZE_ZERO_RADIUS = Math.max(
  ENHANCER_KAMIKAZE_FULL_RADIUS + 0.1,
  Number(process.env.ENHANCER_KAMIKAZE_ZERO_RADIUS || DAMAGE_EXPLOSION_ZERO_RADIUS)
);
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
const APPLY_TRAINING_ABILITY_BONUSES = process.env.APPLY_TRAINING_ABILITY_BONUSES !== "0";
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
// Every limit is deliberately reducible through env so small hosts can fail closed.
// Defaults still allow 100 players behind one NAT with several Photon endpoints each.
const MAX_SESSIONS_TOTAL = boundedEnvInt("MAX_SESSIONS_TOTAL", 8192);
const MAX_SESSIONS_PER_IP = boundedEnvInt("MAX_SESSIONS_PER_IP", 512);
const MAX_PENDING_SESSIONS_TOTAL = boundedEnvInt("MAX_PENDING_SESSIONS_TOTAL", 4096);
const MAX_PENDING_SESSIONS_PER_IP = boundedEnvInt("MAX_PENDING_SESSIONS_PER_IP", 512);
const PENDING_SESSION_TTL_MS = boundedEnvInt("PENDING_SESSION_TTL_MS", 5000, 250);
const PREAUTH_SESSION_TTL_MS = boundedEnvInt("PREAUTH_SESSION_TTL_MS", 30000, 1000);
const SESSION_SECURITY_SWEEP_MS = boundedEnvInt("SESSION_SECURITY_SWEEP_MS", 500, 50);
const SESSION_SECURITY_SWEEP_LIMIT = boundedEnvInt("SESSION_SECURITY_SWEEP_LIMIT", 512);
const UDP_RATE_WINDOW_MS = boundedEnvInt("UDP_RATE_WINDOW_MS", 10000, 250);
const UDP_RATE_PACKETS_PER_IP = boundedEnvInt("UDP_RATE_PACKETS_PER_IP", 50000);
const UDP_RATE_BYTES_PER_IP = boundedEnvInt("UDP_RATE_BYTES_PER_IP", 128 * 1024 * 1024);
const UDP_RATE_BUCKET_CAP = boundedEnvInt("UDP_RATE_BUCKET_CAP", 65536);
const UDP_RATE_SWEEP_MS = boundedEnvInt("UDP_RATE_SWEEP_MS", 1000, 100);
const UDP_RATE_SWEEP_LIMIT = boundedEnvInt("UDP_RATE_SWEEP_LIMIT", 1024);
const INVALID_PACKETS_PER_IP = boundedEnvInt("INVALID_PACKETS_PER_IP", 64);
const INVALID_WINDOW_MS = boundedEnvInt("INVALID_WINDOW_MS", 10000, 250);
const QUARANTINE_SHORT_MS = boundedEnvInt("QUARANTINE_SHORT_MS", 2000, 100);
const QUARANTINE_REPEAT_MS = boundedEnvInt("QUARANTINE_REPEAT_MS", 10000, QUARANTINE_SHORT_MS);
const SECURITY_IP_STATE_CAP = boundedEnvInt("SECURITY_IP_STATE_CAP", 65536);
const AUTH_OPERATION_WINDOW_MS = boundedEnvInt("AUTH_OPERATION_WINDOW_MS", 10000, 250);
const AUTH_OPERATIONS_PER_SESSION = boundedEnvInt("AUTH_OPERATIONS_PER_SESSION", 2000);
const AUTH_OPERATIONS_PER_ACCOUNT = boundedEnvInt("AUTH_OPERATIONS_PER_ACCOUNT", 5000);
const ACCOUNT_OPERATION_BUCKET_CAP = boundedEnvInt("ACCOUNT_OPERATION_BUCKET_CAP", 16384);
const TCP_MAX_CONNECTIONS_PER_IP = boundedEnvInt("TCP_MAX_CONNECTIONS_PER_IP", 512);
const TCP_IDLE_TIMEOUT_MS = boundedEnvInt("TCP_IDLE_TIMEOUT_MS", 120000, 1000);
const TCP_MAX_BYTES_PER_CONNECTION = boundedEnvInt("TCP_MAX_BYTES_PER_CONNECTION", 64 * 1024 * 1024, 1024);

const sessions = new Map();
const pendingSessions = new Map();
const rooms = new Map();
const masterSessionsByPlayerId = new Map();
const clanTreasuryLiveEvents = new Map();
const profileCache = new Map();
const profileLoads = new Map();
const profileChanges = new Map();
const profileLoadQueue = [];
let profileLoadInFlight = 0;
let shopCatalogLoad = null;
const battleEventHighQueue = [];
const battleEventNormalQueue = [];
let battleEventInFlight = 0;
let battleMoveTelemetry = new Map();
const battleApiStats = {
  queued: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  dropped: 0,
  moveFlushes: 0,
  moveSamples: 0,
};
const runtimeMetrics = {
  startedAt: Date.now(),
  lastReportAt: Date.now(),
  udpInboundPackets: 0,
  udpInboundBytes: 0,
  udpInboundDropped: 0,
  udpOutboundPackets: 0,
  udpOutboundBytes: 0,
  udpOutboundCommands: 0,
  udpOutboundDropped: 0,
  outboxFlushes: 0,
  outboxCommands: 0,
  moves: 0,
  shots: 0,
  reliableRetryCommands: 0,
  reliableRecoveriesStarted: 0,
  reliableRecoveriesCompleted: 0,
};
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();
const udpRateByIp = new Map();
const tcpConnectionsByIp = new Map();
const fullSessionCountByIp = new Map();
const pendingSessionCountByIp = new Map();
const securityStateByIp = new Map();
const accountOperationRate = new Map();
let clanTreasuryPollCursor = 0;
let clanTreasuryPollInitialized = false;
let clanTreasuryPollInFlight = false;
let clanTreasuryPollLastErrorAt = 0;
let roomListPushTimer = null;
let roomListPushChannel = 0;
const roomListPushReasons = new Set();
let udpRateSweepIterator = null;
let pendingSessionSweepIterator = null;
let fullSessionSweepIterator = null;
let securityIpSweepIterator = null;
let accountOperationSweepIterator = null;
let outboundReliableRetryCursor = 0;

function incrementCount(map, keyValue) {
  const key = String(keyValue || "unknown");
  map.set(key, Number(map.get(key) || 0) + 1);
}

function decrementCount(map, keyValue) {
  const key = String(keyValue || "unknown");
  const next = Number(map.get(key) || 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

function allowUdpPacket(rinfo, byteLength) {
  const address = String(rinfo?.address || "unknown");
  const now = Date.now();
  let bucket = udpRateByIp.get(address);
  if (!bucket || now - bucket.startedAt >= UDP_RATE_WINDOW_MS) {
    if (!bucket && udpRateByIp.size >= UDP_RATE_BUCKET_CAP) return false;
    bucket = { startedAt: now, packets: 0, bytes: 0, dropped: 0 };
    udpRateByIp.set(address, bucket);
  }
  bucket.packets++;
  bucket.bytes += Math.max(0, Number(byteLength || 0));
  const allowed = bucket.packets <= UDP_RATE_PACKETS_PER_IP && bucket.bytes <= UDP_RATE_BYTES_PER_IP;
  if (!allowed) bucket.dropped++;
  return allowed;
}

function runtimeMetricsSnapshot(now = Date.now()) {
  const elapsedMs = Math.max(1, now - Number(runtimeMetrics.lastReportAt || now));
  const elapsedSeconds = elapsedMs / 1000;
  const activePlayers = new Set();
  for (const room of rooms.values()) {
    for (const playerSession of room?.players?.values?.() || []) {
      if (playerSession && !playerSession.transportDisconnected) activePlayers.add(playerSession);
    }
  }
  let reliablePending = 0;
  let outboxQueued = 0;
  for (const session of sessions.values()) {
    if (!session || session.transportDisconnected) continue;
    reliablePending += Number(session.outboundReliable?.size || 0);
    outboxQueued += Number(session.udpOutbox?.commandCount || 0);
  }
  const memory = typeof process.memoryUsage === "function"
    ? process.memoryUsage()
    : { rss: 0, heapUsed: 0, heapTotal: 0 };
  const api = battleApiQueueSnapshot();
  const p95 = Number(eventLoopDelay.percentile(95)) / 1e6;
  const p99 = Number(eventLoopDelay.percentile(99)) / 1e6;
  return {
    elapsedMs,
    players: activePlayers.size,
    sessions: sessions.size,
    pendingSessions: pendingSessions.size,
    rooms: rooms.size,
    movePerSecond: runtimeMetrics.moves / elapsedSeconds,
    shotPerSecond: runtimeMetrics.shots / elapsedSeconds,
    udpInboundPps: runtimeMetrics.udpInboundPackets / elapsedSeconds,
    udpInboundMbps: runtimeMetrics.udpInboundBytes * 8 / elapsedSeconds / 1e6,
    udpInboundDropped: runtimeMetrics.udpInboundDropped,
    udpOutboundPps: runtimeMetrics.udpOutboundPackets / elapsedSeconds,
    udpOutboundMbps: runtimeMetrics.udpOutboundBytes * 8 / elapsedSeconds / 1e6,
    udpOutboundCommands: runtimeMetrics.udpOutboundCommands,
    udpOutboundDropped: runtimeMetrics.udpOutboundDropped,
    eventLoopP95Ms: Number.isFinite(p95) ? p95 : 0,
    eventLoopP99Ms: Number.isFinite(p99) ? p99 : 0,
    rssMb: Number(memory.rss || 0) / 1024 / 1024,
    heapUsedMb: Number(memory.heapUsed || 0) / 1024 / 1024,
    heapTotalMb: Number(memory.heapTotal || 0) / 1024 / 1024,
    apiInFlight: api.inFlight,
    apiQueued: api.queued,
    profileInFlight: api.profileInFlight,
    profileQueued: api.profileQueued,
    reliablePending,
    reliableRetryCommands: runtimeMetrics.reliableRetryCommands,
    reliableRecoveriesStarted: runtimeMetrics.reliableRecoveriesStarted,
    reliableRecoveriesCompleted: runtimeMetrics.reliableRecoveriesCompleted,
    outboxFlushes: runtimeMetrics.outboxFlushes,
    outboxCommands: runtimeMetrics.outboxCommands,
    outboxAverageCommands: runtimeMetrics.outboxFlushes > 0
      ? runtimeMetrics.outboxCommands / runtimeMetrics.outboxFlushes
      : 0,
    outboxQueued,
  };
}

function resetRuntimeMetricsInterval(now = Date.now()) {
  runtimeMetrics.lastReportAt = now;
  for (const key of [
    "udpInboundPackets",
    "udpInboundBytes",
    "udpInboundDropped",
    "udpOutboundPackets",
    "udpOutboundBytes",
    "udpOutboundCommands",
    "udpOutboundDropped",
    "outboxFlushes",
    "outboxCommands",
    "moves",
    "shots",
    "reliableRetryCommands",
    "reliableRecoveriesStarted",
    "reliableRecoveriesCompleted",
  ]) runtimeMetrics[key] = 0;
  eventLoopDelay.reset();
}

function reportRuntimeMetrics() {
  const now = Date.now();
  const metrics = runtimeMetricsSnapshot(now);
  console.log(
    `[metrics] players=${metrics.players} sessions=${metrics.sessions} pending=${metrics.pendingSessions} rooms=${metrics.rooms}` +
    ` move=${metrics.movePerSecond.toFixed(1)}/s shot=${metrics.shotPerSecond.toFixed(1)}/s` +
    ` udpIn=${metrics.udpInboundPps.toFixed(1)}pps/${metrics.udpInboundMbps.toFixed(2)}Mbps/drop${metrics.udpInboundDropped}` +
    ` udpOut=${metrics.udpOutboundPps.toFixed(1)}pps/${metrics.udpOutboundMbps.toFixed(2)}Mbps/cmd${metrics.udpOutboundCommands}/drop${metrics.udpOutboundDropped}` +
    ` loop=${metrics.eventLoopP95Ms.toFixed(2)}/${metrics.eventLoopP99Ms.toFixed(2)}ms` +
    ` mem=${metrics.rssMb.toFixed(1)}rss/${metrics.heapUsedMb.toFixed(1)}heapMB` +
    ` api=${metrics.apiInFlight}/${metrics.apiQueued} profile=${metrics.profileInFlight}/${metrics.profileQueued}` +
    ` reliable=${metrics.reliablePending}/retry${metrics.reliableRetryCommands}/recovery${metrics.reliableRecoveriesStarted}:${metrics.reliableRecoveriesCompleted}` +
    ` outbox=${metrics.outboxFlushes}/${metrics.outboxAverageCommands.toFixed(2)}avg/queued${metrics.outboxQueued}`,
  );
  resetRuntimeMetricsInterval(now);
  return metrics;
}

function sessionCountForIp(address) {
  return Number(fullSessionCountByIp.get(String(address || "unknown")) || 0);
}

function isIpQuarantined(address, now = Date.now()) {
  return Number(securityStateByIp.get(String(address || "unknown"))?.quarantineUntil || 0) > now;
}

function recordInvalidUdpPacket(address, now = Date.now()) {
  const ip = String(address || "unknown");
  let state = securityStateByIp.get(ip);
  if (!state) {
    if (securityStateByIp.size >= SECURITY_IP_STATE_CAP) return false;
    state = { startedAt: now, lastSeenAt: now, invalid: 0, offenses: 0, quarantineUntil: 0 };
    securityStateByIp.set(ip, state);
  }
  if (now - Number(state.startedAt || 0) >= INVALID_WINDOW_MS) {
    state.startedAt = now;
    state.invalid = 0;
  }
  state.lastSeenAt = now;
  state.invalid = Number(state.invalid || 0) + 1;
  if (state.invalid < INVALID_PACKETS_PER_IP) return false;
  state.invalid = 0;
  state.startedAt = now;
  state.offenses = Number(state.offenses || 0) + 1;
  const penalty = state.offenses > 1 ? QUARANTINE_REPEAT_MS : QUARANTINE_SHORT_MS;
  state.quarantineUntil = Math.max(Number(state.quarantineUntil || 0), now + penalty);
  return true;
}

function consumeRateBucket(holder, field, limit, now = Date.now()) {
  let bucket = holder[field];
  if (!bucket || now - Number(bucket.startedAt || 0) >= AUTH_OPERATION_WINDOW_MS) {
    bucket = { startedAt: now, count: 0, dropped: 0 };
    holder[field] = bucket;
  }
  if (bucket.count >= limit) {
    bucket.dropped += 1;
    return false;
  }
  bucket.count += 1;
  return true;
}

function allowAuthenticatedOperation(session, now = Date.now()) {
  if (!session || !consumeRateBucket(session, "operationRate", AUTH_OPERATIONS_PER_SESSION, now)) return false;
  const playerId = Number(session.playerId || 0);
  if (!session.applicationJoinedAt || playerId <= 1) return true;
  let bucket = accountOperationRate.get(playerId);
  if (!bucket || now - Number(bucket.startedAt || 0) >= AUTH_OPERATION_WINDOW_MS) {
    if (!bucket && accountOperationRate.size >= ACCOUNT_OPERATION_BUCKET_CAP) return false;
    bucket = { startedAt: now, count: 0, dropped: 0, lastSeenAt: now };
    accountOperationRate.set(playerId, bucket);
  }
  bucket.lastSeenAt = now;
  if (bucket.count >= AUTH_OPERATIONS_PER_ACCOUNT) {
    bucket.dropped += 1;
    return false;
  }
  bucket.count += 1;
  return true;
}

function sweepIteratorBatch(map, iterator, limit, visit) {
  let activeIterator = iterator || map.entries();
  let processed = 0;
  while (processed < limit) {
    const next = activeIterator.next();
    if (next.done) return null;
    processed += 1;
    visit(next.value[0], next.value[1]);
  }
  return activeIterator;
}

function sweepUdpRateBuckets(now = Date.now()) {
  udpRateSweepIterator = sweepIteratorBatch(udpRateByIp, udpRateSweepIterator, UDP_RATE_SWEEP_LIMIT, (ip, bucket) => {
    if (now - Number(bucket?.startedAt || 0) > UDP_RATE_WINDOW_MS * 2) udpRateByIp.delete(ip);
  });
}

function sweepSecurityState(now = Date.now()) {
  pendingSessionSweepIterator = sweepIteratorBatch(pendingSessions, pendingSessionSweepIterator, SESSION_SECURITY_SWEEP_LIMIT, (_sessionId, pending) => {
    if (now - Number(pending?.lastSeenAt || pending?.createdAt || 0) > PENDING_SESSION_TTL_MS) deletePendingSession(pending);
  });
  fullSessionSweepIterator = sweepIteratorBatch(sessions, fullSessionSweepIterator, SESSION_SECURITY_SWEEP_LIMIT, (_sessionId, session) => {
    if (session?.applicationJoinedAt) return;
    if (now - Number(session?.promotedAt || session?.createdAt || 0) > PREAUTH_SESSION_TTL_MS) {
      expireTransportSession(session, "preauth-ttl");
    }
  });
  securityIpSweepIterator = sweepIteratorBatch(securityStateByIp, securityIpSweepIterator, SESSION_SECURITY_SWEEP_LIMIT, (ip, state) => {
    const keepUntil = Math.max(Number(state?.quarantineUntil || 0), Number(state?.lastSeenAt || 0) + INVALID_WINDOW_MS * 2);
    if (keepUntil <= now) securityStateByIp.delete(ip);
  });
  accountOperationSweepIterator = sweepIteratorBatch(accountOperationRate, accountOperationSweepIterator, SESSION_SECURITY_SWEEP_LIMIT, (playerId, holder) => {
    if (now - Number(holder?.lastSeenAt || 0) > AUTH_OPERATION_WINDOW_MS * 2) accountOperationRate.delete(playerId);
  });
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
  promzona: {
    dm: [
      // Respawn_T0 world position. The authored marker is nested under
      // POINTS_RESCALE and MAP_ROOT; MAP_ROOT currently has scale 5.
      { x: 654.935, y: 6.86, z: 150.265, rotY: 0 },
    ]
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
// New mode. It deliberately does not reuse any original Photon event code.
const MAP_MODE_ROGUELIKE = 128;
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
  promzona: [MAP_MODE_DEATHMATCH, MAP_MODE_ROGUELIKE],
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

function maxUsersForRoomMode(mode, value, fallback = 8) {
  const normalized = shortRoomValue(value, fallback, 1, 64);
  if (Number(mode) === MAP_MODE_ROGUELIKE) return Math.max(1, Math.min(4, normalized));
  return normalized;
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
  if (roomMode(session) === MAP_MODE_DEATHMATCH || roomMode(session) === MAP_MODE_ZOMBIE || roomMode(session) === MAP_MODE_ROGUELIKE) {
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
  const baseIndex = mode === MAP_MODE_DEATHMATCH || mode === MAP_MODE_ZOMBIE || mode === MAP_MODE_ROGUELIKE
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

function isExactEnetConnectPacket(msg) {
  if (!Buffer.isBuffer(msg) || msg.length !== 56) return false;
  if (readU16(msg, 0) !== 0xffff || msg[3] !== 1) return false;
  if (msg[12] !== 0x02 || ![0, 0xff].includes(msg[13])) return false;
  if (readU32(msg, 16) !== 44 || 12 + readU32(msg, 16) !== msg.length) return false;
  const mtu = readU16(msg, 26);
  const channelCount = readU32(msg, 32);
  return readU32(msg, 20) > 0 && mtu >= 576 && mtu <= 4096 && channelCount >= 1 && channelCount <= 255;
}

function makePendingSession(port, socket, rinfo, sessionId, challenge, now = Date.now()) {
  return {
    pendingHandshake: true,
    peerId: 1,
    actorId: 0,
    challenge: Number(challenge || 0) >>> 0,
    serverSeq: 0,
    unreliableSeq: 0,
    serverSeqByChannel: new Map(),
    unreliableSeqByChannel: new Map(),
    outboundReliable: new Map(),
    outboundReliableRecoveryByChannel: new Map(),
    outboundReliableOverflowAt: 0,
    outboundRoundTripTime: OUTBOUND_RELIABLE_INITIAL_RTO_MS,
    outboundRoundTripVariance: 0,
    verifySeq: null,
    seenVerify: false,
    reliableResponses: new Map(),
    reliableInFlight: new Map(),
    reliableFragments: new Map(),
    reliableGeneration: 0,
    transportGeneration: 0,
    inboundReliableChannels: new Map(),
    reliableReplayLogState: new Map(),
    transportDisconnected: false,
    lastChannel: 0,
    port,
    remoteKey: `${rinfo.address}:${rinfo.port}`,
    sessionId,
    socket,
    rinfo: { address: rinfo.address, port: rinfo.port },
    createdAt: now,
    lastSeenAt: now,
    playerId: 0,
    playerAuthKey: "",
    room: null,
  };
}

function storePendingSession(pending) {
  if (!pending?.sessionId || pendingSessions.has(pending.sessionId)) return pending || null;
  const ip = String(pending.rinfo?.address || "unknown");
  if (pendingSessions.size >= MAX_PENDING_SESSIONS_TOTAL) return null;
  if (Number(pendingSessionCountByIp.get(ip) || 0) >= MAX_PENDING_SESSIONS_PER_IP) return null;
  pendingSessions.set(pending.sessionId, pending);
  pending.pendingCountedIp = ip;
  incrementCount(pendingSessionCountByIp, ip);
  return pending;
}

function deletePendingSession(pendingOrSessionId, options = {}) {
  const sessionId = typeof pendingOrSessionId === "string" ? pendingOrSessionId : pendingOrSessionId?.sessionId;
  const pending = sessionId ? pendingSessions.get(sessionId) : null;
  if (!pending || (typeof pendingOrSessionId === "object" && pending !== pendingOrSessionId)) return false;
  pendingSessions.delete(sessionId);
  if (pending.pendingCountedIp) decrementCount(pendingSessionCountByIp, pending.pendingCountedIp);
  pending.pendingCountedIp = "";
  if (!options.preserveOutbox) clearSessionUdpOutbox(pending);
  return true;
}

function storeFullSession(sessionId, session) {
  if (!sessionId || !session) return null;
  const current = sessions.get(sessionId);
  if (current && current !== session) return null;
  if (!session.fullSessionCountedIp) {
    const ip = String(session.rinfo?.address || "unknown");
    incrementCount(fullSessionCountByIp, ip);
    session.fullSessionCountedIp = ip;
  }
  sessions.set(sessionId, session);
  return session;
}

function deleteFullSession(sessionOrId, expectedSession = null, options = {}) {
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.sessionId;
  const session = expectedSession || (typeof sessionOrId === "object" ? sessionOrId : sessions.get(sessionId));
  if (!sessionId || !session || sessions.get(sessionId) !== session) return false;
  sessions.delete(sessionId);
  if (session.fullSessionCountedIp) decrementCount(fullSessionCountByIp, session.fullSessionCountedIp);
  session.fullSessionCountedIp = "";
  if (!options.preserveOutbox) clearSessionUdpOutbox(session);
  return true;
}

function promotePendingSession(pending, now = Date.now(), credentials = {}) {
  if (!pending?.pendingHandshake || pendingSessions.get(pending.sessionId) !== pending) return null;
  const ip = String(pending.rinfo?.address || "unknown");
  if (sessions.size >= MAX_SESSIONS_TOTAL || sessionCountForIp(ip) >= MAX_SESSIONS_PER_IP) {
    deletePendingSession(pending);
    return null;
  }
  deletePendingSession(pending, { preserveOutbox: true });
  const runtimeStats = playerRuntimeStats(null);
  Object.assign(pending, {
    pendingHandshake: false,
    promotedAt: now,
    applicationJoinedAt: 0,
    actorId: 1,
    listLobby: false,
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
    damageContributors: new Map(),
    kamikazeTriggered: false,
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
    knownActorIds: new Set(),
    actorJoinAnnouncedAt: new Map(),
    joinActorListIds: new Set(),
    deferredJoinActorIds: new Set(),
    peerSpawnTimers: new Set(),
    pendingSpawnBroadcast: null,
    pendingPickupSync: null,
    pickupSpawnRepairTimers: new Set(),
    playerId: Number(credentials.authId || 0) > 0 ? Number(credentials.authId) : 1,
    playerAuthKey: String(credentials.authKey || ""),
    playerName: process.env.DEFAULT_PLAYER_NAME || "ContraCity",
    staffRole: "none",
    staffRank: 0,
    staffProfileLoadedAt: 0,
    staffFlightActive: false,
    staffFlightMode: "combat",
    staffFlightChangedAt: 0,
    moderationDisconnectPending: false,
    health: runtimeStats.maxHealth,
    energy: runtimeStats.maxEnergy,
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
    operationRate: null,
  });
  pending.roomRaw = makeRoomSettingsRaw(pending.room);
  return storeFullSession(pending.sessionId, pending);
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
    if (!candidate.seenVerify && candidate.verifySeq == null) continue;
    if (Number(candidate.transportGeneration || 0) !== Number(candidate.reliableGeneration || 0)) continue;
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
    deleteFullSession(previousSessionId, session, { preserveOutbox: true });
  }
  session.sessionId = sessionId;
  session.remoteKey = `${rinfo.address}:${rinfo.port}`;
  session.socket = socket;
  session.rinfo = { address: rinfo.address, port: rinfo.port };
  storeFullSession(sessionId, session);
  refreshSessionReliableEndpoint(session, socket, rinfo);
  console.log(`[state] enet nat-rebind actor=${session.actorId || 0} player=${session.playerId || "unknown"} room=${session.room?.name || "none"} from=${previousRemote} to=${session.remoteKey} pending=${session.outboundReliable?.size || 0} generation=${session.transportGeneration || 0}`);
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
  if (!(session.reliableResponses instanceof Map)) session.reliableResponses = new Map();
  const now = Date.now();
  reliableCommands.cachedAt = now;
  reliableCommands.expiresAt = now + RELIABLE_RESPONSE_CACHE_TTL_MS;
  session.reliableResponses.set(cacheKey, reliableCommands);
  for (const [key, cached] of session.reliableResponses.entries()) {
    if (Number(cached?.expiresAt || 0) > now) continue;
    session.reliableResponses.delete(key);
  }
  const cacheMax = session.pendingHandshake ? PENDING_RELIABLE_STATE_MAX : RELIABLE_RESPONSE_CACHE_MAX;
  while (session.reliableResponses.size > cacheMax) {
    const firstKey = session.reliableResponses.keys().next().value;
    session.reliableResponses.delete(firstKey);
  }
  return reliableCommands;
}

function getCachedReliableResponse(session, cacheKey) {
  const cached = session?.reliableResponses?.get?.(cacheKey);
  if (!cached) return null;
  if (Number(cached.expiresAt || 0) <= Date.now()) {
    session.reliableResponses.delete(cacheKey);
    return null;
  }
  return cached;
}

function logReliableReplay(session, channel, reliableSeq, cachedCount, details = "") {
  if (!(session.reliableReplayLogState instanceof Map)) session.reliableReplayLogState = new Map();
  const key = normalizeChannelId(channel, 0);
  const now = Date.now();
  const state = session.reliableReplayLogState.get(key) || { lastAt: 0, suppressed: 0 };
  if (now - state.lastAt < RELIABLE_REPLAY_LOG_INTERVAL_MS) {
    state.suppressed += 1;
    session.reliableReplayLogState.set(key, state);
    return;
  }
  const suppressed = state.suppressed > 0 ? ` suppressed=${state.suppressed}` : "";
  console.log(`[state] reliable replay actor=${session?.actorId || 0} channel=${key} seq=${Number(reliableSeq) >>> 0} cached=${cachedCount}${suppressed}${details}`);
  session.reliableReplayLogState.set(key, { lastAt: now, suppressed: 0 });
}

function reliableSequenceCompare(left, right) {
  const a = Number(left) >>> 0;
  const b = Number(right) >>> 0;
  if (a === b) return 0;
  return ((a - b) >>> 0) < 0x80000000 ? 1 : -1;
}

function nextReliableSequence(sequence) {
  return ((Number(sequence) >>> 0) + 1) >>> 0;
}

function ensureInboundReliableChannel(session, channel) {
  if (!(session.inboundReliableChannels instanceof Map)) session.inboundReliableChannels = new Map();
  const targetChannel = normalizeChannelId(channel, 0);
  let state = session.inboundReliableChannels.get(targetChannel);
  if (!state) {
    state = { expectedSeq: 1, pending: new Map(), running: false };
    session.inboundReliableChannels.set(targetChannel, state);
  }
  return state;
}

function prepareInboundReliableRequest(request) {
  if (request.completion) return request;
  request.completion = new Promise((resolve, reject) => {
    request.resolve = resolve;
    request.reject = reject;
  });
  return request;
}

async function drainInboundReliableChannel(session, channel, state) {
  if (state.running) return;
  state.running = true;
  try {
    while (true) {
      const expected = Number(state.expectedSeq) >>> 0;
      const request = state.pending.get(expected);
      if (!request) break;
      state.pending.delete(expected);
      let result = [];
      let failure = null;
      try {
        result = await request.execute();
      } catch (error) {
        failure = error;
      }
      state.expectedSeq = nextReliableSequence(request.endSeq);
      if (failure) {
        request.reject?.(failure);
        try {
          request.onError?.(failure);
        } catch (error) {
          console.log(`[guard] inbound-reliable-error-handler actor=${session?.actorId || 0} channel=${channel} reason=${error.message}`);
        }
      } else {
        request.resolve?.(result);
        try {
          request.onComplete?.(result);
        } catch (error) {
          console.log(`[guard] inbound-reliable-complete-handler actor=${session?.actorId || 0} channel=${channel} reason=${error.message}`);
        }
      }
    }
  } finally {
    state.running = false;
    const expected = Number(state.expectedSeq) >>> 0;
    if (state.pending.has(expected)) {
      Promise.resolve().then(() => drainInboundReliableChannel(session, channel, state));
    }
  }
}

function enqueueInboundReliableRequest(session, rawRequest) {
  const request = prepareInboundReliableRequest(rawRequest);
  const channel = normalizeChannelId(request.channel, 0);
  const state = ensureInboundReliableChannel(session, channel);
  request.startSeq = Number(request.startSeq) >>> 0;
  request.endSeq = Number(request.endSeq ?? request.startSeq) >>> 0;

  if (reliableSequenceCompare(request.startSeq, state.expectedSeq) < 0) {
    request.resolve?.([]);
    return { status: "stale", completion: request.completion, request };
  }
  if (state.pending.has(request.startSeq)) {
    const existing = state.pending.get(request.startSeq);
    request.resolve?.([]);
    return { status: "duplicate", completion: existing.completion, request: existing };
  }
  const pendingMax = session.pendingHandshake ? PENDING_RELIABLE_STATE_MAX : INBOUND_RELIABLE_PENDING_MAX;
  if (state.pending.size >= pendingMax) {
    const error = new Error(`inbound reliable pending overflow channel=${channel} size=${state.pending.size}`);
    request.reject?.(error);
    return { status: "overflow", completion: request.completion, request };
  }

  const ready = reliableSequenceCompare(request.startSeq, state.expectedSeq) === 0 && !state.running;
  state.pending.set(request.startSeq, request);
  drainInboundReliableChannel(session, channel, state).catch((error) => {
    console.log(`[guard] inbound-reliable-drain actor=${session?.actorId || 0} channel=${channel} reason=${error.message}`);
  });
  return { status: ready ? "ready" : "buffered", completion: request.completion, request };
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

function ensureOutboundReliableRecoveryMap(session) {
  if (!session) return null;
  if (!(session.outboundReliableRecoveryByChannel instanceof Map)) {
    session.outboundReliableRecoveryByChannel = new Map();
  }
  return session.outboundReliableRecoveryByChannel;
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
    const pendingMax = session.pendingHandshake ? PENDING_RELIABLE_STATE_MAX : OUTBOUND_RELIABLE_PENDING_MAX;
    if (pending.size >= pendingMax) {
      if (!session.outboundReliableOverflowAt) {
        session.outboundReliableOverflowAt = now;
        console.log(`[warn] reliable pending overflow actor=${session.actorId || 0} size=${pending.size} max=${pendingMax}`);
      }
      continue;
    }
    const recovery = ensureOutboundReliableRecoveryMap(session)?.get(info.channel);
    pending.set(key, {
      ...info,
      command: Buffer.from(command),
      socket,
      rinfo: { address: rinfo.address, port: rinfo.port },
      firstSentAt: now,
      lastSentAt: now,
      sentCount: 1,
      roundTripTimeout: outboundReliableRto(session),
      recoveryStartedAt: Number(recovery?.startedAt || 0),
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
  const channelPending = Array.from(pending.values()).some((candidate) => Number(candidate.channel) === Number(channel));
  if (!channelPending) {
    const recoveryByChannel = ensureOutboundReliableRecoveryMap(session);
    if (recoveryByChannel?.has(normalizeChannelId(channel, 0))) {
      runtimeMetrics.reliableRecoveriesCompleted += 1;
      recoveryByChannel.delete(normalizeChannelId(channel, 0));
    }
  }
  if (DEBUG_PACKETS) {
    console.log(`[ack] actor=${session.actorId || 0} channel=${channel} seq=${reliableSeq} sample=${sample}ms pending=${pending.size}`);
  }
  return true;
}

function clearOutboundReliableState(session) {
  if (!session) return;
  session.outboundReliable = new Map();
  session.outboundReliableRecoveryByChannel = new Map();
  session.outboundReliableOverflowAt = 0;
  session.outboundRoundTripTime = OUTBOUND_RELIABLE_INITIAL_RTO_MS;
  session.outboundRoundTripVariance = 0;
}

function expireTransportSession(session, reason, entry = null) {
  if (!session || session.transportDisconnected) return false;
  session.transportDisconnected = true;
  const detail = entry
    ? ` channel=${entry.channel} seq=${entry.reliableSeq} count=${entry.sentCount} age=${Date.now() - entry.firstSentAt}ms`
    : "";
  console.log(`[state] transport expired actor=${session.actorId || 0} player=${session.playerId || "unknown"} reason=${reason}${detail}`);
  detachMasterSession(session, reason);
  detachSessionFromRoom(session, reason);
  if (session.sessionId && sessions.get(session.sessionId) === session) deleteFullSession(session.sessionId, session);
  return true;
}

function beginOutboundReliableChannelRecovery(session, entry, now) {
  const recoveryByChannel = ensureOutboundReliableRecoveryMap(session);
  const channel = normalizeChannelId(entry.channel, 0);
  let recovery = recoveryByChannel.get(channel);
  if (!recovery) {
    recovery = { startedAt: now, lastLoggedAt: now };
    recoveryByChannel.set(channel, recovery);
    runtimeMetrics.reliableRecoveriesStarted += 1;
    const transportIdle = Math.max(0, now - numberOr(session.lastSeenAt, 0));
    console.log(`[recovery] reliable-channel actor=${session.actorId || 0} channel=${channel} seq=${entry.reliableSeq} pending=${session.outboundReliable?.size || 0} transportIdle=${transportIdle}ms hard=${OUTBOUND_RELIABLE_RECOVERY_MS}ms`);
  }
  entry.recoveryStartedAt = Number(recovery.startedAt || now);
  return recovery;
}

function runOutboundReliableRetries() {
  const now = Date.now();
  const expiredSessions = new Map();
  let retryBudget = OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS;
  const sessionList = Array.from(sessions.values());
  if (sessionList.length <= 0) {
    outboundReliableRetryCursor = 0;
    return;
  }
  const startIndex = outboundReliableRetryCursor % sessionList.length;
  let visitedSessions = 0;
  for (let offset = 0; offset < sessionList.length && retryBudget > 0; offset += 1) {
    const index = (startIndex + offset) % sessionList.length;
    const session = sessionList[index];
    visitedSessions = offset + 1;
    const pending = session?.outboundReliable;
    if (!(pending instanceof Map) || pending.size <= 0) continue;
    const dueEntries = [];
    for (const entry of pending.values()) {
      if (now - entry.lastSentAt <= entry.roundTripTimeout) continue;
      const normalRetryWindowExpired =
        entry.sentCount > OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE ||
        now - entry.firstSentAt > OUTBOUND_RELIABLE_DISCONNECT_MS;
      if (normalRetryWindowExpired) {
        const recovery = beginOutboundReliableChannelRecovery(session, entry, now);
        if (now - recovery.startedAt > OUTBOUND_RELIABLE_RECOVERY_MS) {
          if (!expiredSessions.has(session)) expiredSessions.set(session, entry);
          break;
        }
      }
      if (retryBudget > 0) dueEntries.push(entry);
      if (dueEntries.length >= retryBudget) break;
    }
    if (expiredSessions.has(session) || dueEntries.length <= 0) continue;
    const retryCommands = dueEntries.map((entry) => entry.command);
    const sent = sendPacketNow(session.socket, session.rinfo, session, retryCommands);
    if (!sent) continue;
    for (const entry of dueEntries) {
      entry.sentCount += 1;
      entry.lastSentAt = now;
      entry.roundTripTimeout = Math.min(
        OUTBOUND_RELIABLE_RETRY_MAX_RTO_MS,
        Math.max(OUTBOUND_RELIABLE_INITIAL_RTO_MS, entry.roundTripTimeout * 2),
      );
    }
    retryBudget -= dueEntries.length;
    runtimeMetrics.reliableRetryCommands += dueEntries.length;
    if (VERBOSE_GAMEPLAY_LOGS || DEBUG_PACKETS) {
      console.log(`[retry] reliable-batch actor=${session.actorId || 0} commands=${dueEntries.length} pending=${pending.size} budget=${retryBudget} seq=${dueEntries.map((entry) => `${entry.channel}:${entry.reliableSeq}`).join(",")}`);
    }
  }
  outboundReliableRetryCursor = (startIndex + Math.max(1, visitedSessions)) % sessionList.length;

  for (const [session, entry] of expiredSessions.entries()) {
    expireTransportSession(session, "reliable-recovery-exhausted", entry);
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

  if (session.pendingHandshake) {
    if (parsed?.messageType !== 2 || parsed.opCode !== 255 || !(parsed.params instanceof Map)) return [];
    const actorParam = parsed.params.get(249);
    const credentials = actorParam ? actorCredentials(actorParam) : {};
    if (!promotePendingSession(session, Date.now(), credentials)) return [];
  }

  const responses = await handleOperation(port, socket, rinfo, session, parsed, channel);
  if (parsed?.opCode === 255 && responses.length > 0 && !session.applicationJoinedAt) {
    session.applicationJoinedAt = Date.now();
  }
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

function sendPacketNow(socket, rinfo, session, commands, peerIdOverride = null) {
  if (!socket || !rinfo || !session || !Array.isArray(commands) || commands.length === 0) return false;
  const outgoingCommands = fragmentOutgoingReliableCommands(session, commands);
  const sentTime = photonNow();
  const buildPacket = (packetCommands) => Buffer.concat([
    makeHeader(peerIdOverride ?? session.peerId, packetCommands.length, sentTime, session.challenge),
    ...packetCommands,
  ]);
  const packet = buildPacket(outgoingCommands);

  if (MAX_UDP_PACKET_BYTES > 0 && outgoingCommands.length > 1 && packet.length > MAX_UDP_PACKET_BYTES) {
    let chunk = [];
    let allSent = true;
    for (const command of outgoingCommands) {
      const nextChunk = [...chunk, command];
      if (chunk.length > 0 && buildPacket(nextChunk).length > MAX_UDP_PACKET_BYTES) {
        allSent = sendPacketNow(socket, rinfo, session, chunk, peerIdOverride) && allSent;
        chunk = [command];
      } else {
        chunk = nextChunk;
      }
    }
    if (chunk.length > 0) {
      allSent = sendPacketNow(socket, rinfo, session, chunk, peerIdOverride) && allSent;
    }
    return allSent;
  }

  if (packet.length > MAX_UDP_PACKET_BYTES) {
    runtimeMetrics.udpOutboundDropped += outgoingCommands.length;
    console.log(`[warn] udp-packet-dropped bytes=${packet.length} max=${MAX_UDP_PACKET_BYTES} cmds=${outgoingCommands.length}`);
    return false;
  }

  try {
    socket.send(packet, rinfo.port, rinfo.address);
  } catch (error) {
    runtimeMetrics.udpOutboundDropped += outgoingCommands.length;
    console.log(`[send] failed to=${rinfo.address}:${rinfo.port} bytes=${packet.length} reason=${error.message}`);
    return false;
  }
  runtimeMetrics.udpOutboundPackets += 1;
  runtimeMetrics.udpOutboundBytes += packet.length;
  runtimeMetrics.udpOutboundCommands += outgoingCommands.length;
  trackOutboundReliableCommands(socket, rinfo, session, outgoingCommands);
  const ackOnly = outgoingCommands.every((command) => command[0] === 0x01);
  if (LOG_SEND_PACKETS) {
    console.log(`[send] bytes=${packet.length} to=${rinfo.address}:${rinfo.port} cmds=${outgoingCommands.length}`);
  }
  return true;
}

function ensureSessionUdpOutbox(session, socket, rinfo) {
  if (!session) return null;
  if (!session.udpOutbox) {
    session.udpOutbox = {
      groups: [],
      commandCount: 0,
      commandBytes: 0,
      timer: null,
      socket: null,
      rinfo: null,
    };
  }
  const outbox = session.udpOutbox;
  if (socket) outbox.socket = socket;
  if (rinfo) outbox.rinfo = { address: rinfo.address, port: rinfo.port };
  return outbox;
}

function clearSessionUdpOutbox(session) {
  const outbox = session?.udpOutbox;
  if (!outbox) return 0;
  if (outbox.timer) clearTimeout(outbox.timer);
  const dropped = Number(outbox.commandCount || 0);
  if (dropped > 0) runtimeMetrics.udpOutboundDropped += dropped;
  outbox.groups = [];
  outbox.commandCount = 0;
  outbox.commandBytes = 0;
  outbox.timer = null;
  outbox.socket = null;
  outbox.rinfo = null;
  return dropped;
}

function flushSessionUdpOutbox(session) {
  const outbox = session?.udpOutbox;
  if (!outbox || outbox.commandCount <= 0) return true;
  if (outbox.timer) clearTimeout(outbox.timer);
  const groups = outbox.groups;
  const socket = session.socket || outbox.socket;
  const rinfo = session.rinfo || outbox.rinfo;
  const flushedCommands = outbox.commandCount;
  outbox.groups = [];
  outbox.commandCount = 0;
  outbox.commandBytes = 0;
  outbox.timer = null;
  outbox.socket = socket;
  outbox.rinfo = rinfo;

  if (!socket || !rinfo || session.transportDisconnected) {
    runtimeMetrics.udpOutboundDropped += flushedCommands;
    return false;
  }
  runtimeMetrics.outboxFlushes += 1;
  runtimeMetrics.outboxCommands += flushedCommands;
  let allSent = true;
  for (const group of groups) {
    allSent = sendPacketNow(socket, rinfo, session, group.commands, group.peerId) && allSent;
  }
  return allSent;
}

function scheduleSessionUdpOutboxFlush(session, outbox) {
  if (outbox.timer) return;
  outbox.timer = setTimeout(() => flushSessionUdpOutbox(session), UDP_OUTBOX_FLUSH_MS);
  if (typeof outbox.timer?.unref === "function") outbox.timer.unref();
}

function sendPacket(socket, rinfo, session, commands, peerIdOverride = null) {
  if (!socket || !rinfo || !session || !Array.isArray(commands) || commands.length === 0) return false;
  const outgoingCommands = fragmentOutgoingReliableCommands(session, commands);
  const outbox = ensureSessionUdpOutbox(session, socket, rinfo);
  if (!outbox) return false;
  const peerId = Number(peerIdOverride ?? session.peerId) & 0xffff;
  let allAccepted = true;

  for (const command of outgoingCommands) {
    if (command.length > UDP_OUTBOX_MAX_BYTES) {
      if (outbox.commandCount > 0) flushSessionUdpOutbox(session);
      allAccepted = sendPacketNow(socket, rinfo, session, [command], peerId) && allAccepted;
      continue;
    }
    if (
      outbox.commandCount >= UDP_OUTBOX_MAX_COMMANDS ||
      (outbox.commandCount > 0 && outbox.commandBytes + command.length > UDP_OUTBOX_MAX_BYTES)
    ) {
      flushSessionUdpOutbox(session);
    }
    let group = outbox.groups[outbox.groups.length - 1];
    if (!group || group.peerId !== peerId) {
      group = { peerId, commands: [] };
      outbox.groups.push(group);
    }
    group.commands.push(command);
    outbox.commandCount += 1;
    outbox.commandBytes += command.length;
  }
  if (outbox.commandCount > 0) scheduleSessionUdpOutboxFlush(session, outbox);
  return allAccepted;
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
  return sendPacket(socket, rinfo, session, makeReliableCommandsForPayload(session, payload, channel));
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
  return { value: repairWindows1251Mojibake(buf.subarray(start, start + len).toString("utf8")), offset: start + len };
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
    const dataOffset = offset + 4;
    const dataEnd = dataOffset + len;
    if (!Number.isInteger(len) || len < 0 || dataEnd > buf.length) {
      throw new Error(`invalid photon byte-array length=${len} at ${start}`);
    }
    value = buf.subarray(dataOffset, dataEnd);
    offset = dataEnd;
    return { type, value, raw: buf.subarray(start, offset), offset };
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
  return DEBUG_PACKETS || DEBUG_MOVE_PACKETS || (VERBOSE_GAMEPLAY_LOGS && !isMoveEvent(parsed));
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

function repairWindows1251Mojibake(value) {
  const source = String(value ?? "");
  if (!/[пїЅпїЅ][\u0080-\u00bf]/.test(source)) return source;
  const bytes = [];
  for (const character of source) {
    const byte = WINDOWS_1251_ENCODER.get(character);
    if (byte == null) return source;
    bytes.push(byte);
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  if (!decoded || decoded.includes("\ufffd")) return source;
  if (!/[пїЅ-пїЅпїЅ-пїЅпїЅпїЅ]/.test(decoded)) return source;
  return decoded;
}
function decodeLegacyBonusText(value) {
  let current = stringOr(value, "");
  // Client-derived tooltip tables may contain one or more reversible
  // Windows-1251/UTF-8 mojibake layers. Decode only lossless layers and
  // stop before valid UTF-8 text; API-provided Unicode remains unchanged.
  for (let pass = 0; pass < 3; pass += 1) {
    const bytes = [];
    let reversible = true;
    for (const character of current) {
      const byte = WINDOWS_1251_ENCODER.get(character);
      if (byte == null) {
        reversible = false;
        break;
      }
      bytes.push(byte);
    }
    if (!reversible) break;

    const decoded = Buffer.from(bytes).toString("utf8");
    if (!decoded || decoded.includes("\ufffd") || decoded === current) break;
    current = decoded;
  }
  return current;
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
    maxUsers: maxUsersForRoomMode(mode, maxUsers),
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
  const mode = Number(settings.mode ?? MAP_MODE_DEATHMATCH);
  const entries = [
    { key: rawString("time_limit"), value: rawShort(shortRoomValue(settings.timeLimit, 10, 1, 50)) },
    { key: rawString("frag_limit"), value: rawShort(shortRoomValue(settings.fragLimit, 50, 1, 1000)) },
    { key: rawString("friendly_fire"), value: rawBool(settings.friendlyFire) },
    { key: rawString("lvl_min"), value: rawShort(shortRoomValue(settings.lvlMin, 1, 1, 99)) },
    { key: rawString("lvl_max"), value: rawShort(shortRoomValue(settings.lvlMax, 50, 1, 99)) },
    { key: rawString("game_mode"), value: rawByte(mode) },
    { key: rawString("map"), value: rawString(settings.map) },
    { key: rawString("max_users"), value: rawShort(maxUsersForRoomMode(mode, settings.maxUsers)) },
    { key: rawString("name"), value: rawString(settings.name) },
    {
      key: rawString("game_param"),
      value: rawHashtable([
        { key: rawString("remote_animation_send"), value: rawBool(true) },
        { key: rawString("remote_animation_receive"), value: rawBool(true) },
        { key: rawString("transform_per_second"), value: rawInt(100) },
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

const ENHANCER_TYPE = Object.freeze({
  KAMIKAZE: 1,
  PERSONAL_EXP: 2,
  DISABLE_DOMINATION_ICON: 4,
  REDUCED_SELF_PROJECTILE_DAMAGE: 5,
  CLAN_EXP: 10,
  CLAN_REDUCED_FRIEND_SOUND: 11,
  CLAN_DISABLE_FRIENDLY_LAUNCHER_DAMAGE: 12,
  CLAN_HEALTH: 13,
  ANTI_FIRE: 30,
  ANTI_BLOOD: 31,
  ANTI_POISON: 32,
  ANTI_ELECTRO: 33,
  ANTI_FROST: 34,
  ANTI_BIOHAZARD: 35,
  CLAN_GRENADE_RADIUS: 150,
  CLAN_ROCKET_RADIUS: 151,
  CLAN_ASSIST_EXP: 152,
  CLAN_FLAG_EXP: 153,
  CLAN_CONTROL_EXP: 154,
  CLAN_ZOMBIE_EXP: 155,
  CLAN_OTHER_CLAN_KILL_EXP: 156,
  CLAN_NUT_DAMAGE: 159,
  CLAN_ZOMBIE_DAMAGE: 160,
  CLAN_PISTOL_DAMAGE: 205,
  CLAN_SHOTGUN_DAMAGE: 208,
  CLAN_MELEE_DAMAGE: 209,
});

// IDs 3 (ReducedDamageFall / "Лёгкое приземление") and 36 ("Меркурий")
// are intentionally absent from the restored gameplay contract.
const PASSIVE_BATTLE_ENHANCER_IDS = new Set(Object.values(ENHANCER_TYPE));
// Only the original byte-enum enhancers are useful to the C# client. High clan
// IDs are server-side effects and are omitted from ActorInfo[108] to save UDP space.
const CLIENT_VISIBLE_ENHANCER_IDS = new Set([
  ENHANCER_TYPE.KAMIKAZE,
  ENHANCER_TYPE.PERSONAL_EXP,
  ENHANCER_TYPE.DISABLE_DOMINATION_ICON,
  ENHANCER_TYPE.REDUCED_SELF_PROJECTILE_DAMAGE,
  ENHANCER_TYPE.CLAN_EXP,
  ENHANCER_TYPE.CLAN_REDUCED_FRIEND_SOUND,
  ENHANCER_TYPE.CLAN_DISABLE_FRIENDLY_LAUNCHER_DAMAGE,
  ENHANCER_TYPE.ANTI_FIRE,
  ENHANCER_TYPE.ANTI_BLOOD,
  ENHANCER_TYPE.ANTI_POISON,
  ENHANCER_TYPE.ANTI_ELECTRO,
  ENHANCER_TYPE.ANTI_FROST,
  ENHANCER_TYPE.ANTI_BIOHAZARD,
]);

const IMPACT_TYPE = Object.freeze({
  NONE: 0,
  FIRE: 1,
  BLOOD: 2,
  POISON: 3,
  ELECTRO: 4,
  FROST: 5,
  BIOHAZARD: 6,
  STUNNING: 7,
});

const IMPACT_DOT_DEFINITIONS = [
  { type: IMPACT_TYPE.FIRE, min: 3, max: 6, ids: [80], keys: ["mg_aug5_o"] },
  { type: IMPACT_TYPE.FIRE, min: 2, max: 5, ids: [72], keys: ["ohca_candy"] },
  { type: IMPACT_TYPE.FIRE, min: 6, max: 10, ids: [104], keys: ["gl_grenadelauncher03"] },
  { type: IMPACT_TYPE.FROST, min: 2, max: 5, ids: [71], keys: ["ohca_candy2"] },
  { type: IMPACT_TYPE.BLOOD, min: 6, max: 10, ids: [59], keys: ["rl_rpg7b02"] },
  { type: IMPACT_TYPE.BLOOD, min: 3, max: 6, ids: [79, 109], keys: ["mg_aug4_o", "sg_remington"] },
  { type: IMPACT_TYPE.POISON, min: 1, max: 3, ids: [76], keys: ["mg_aug1_o"] },
  { type: IMPACT_TYPE.POISON, min: 4, max: 7, ids: [45], keys: ["gl_milkor_a"] },
  { type: IMPACT_TYPE.POISON, min: 3, max: 6, ids: [75], keys: ["sr_wildcat2"] },
  { type: IMPACT_TYPE.BLOOD, min: 2, max: 4, ids: [42], keys: ["THCA_Scythe_B"] },
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
  [IMPACT_TYPE.FIRE, ENHANCER_TYPE.ANTI_FIRE],
  [IMPACT_TYPE.BLOOD, ENHANCER_TYPE.ANTI_BLOOD],
  [IMPACT_TYPE.POISON, ENHANCER_TYPE.ANTI_POISON],
  [IMPACT_TYPE.ELECTRO, ENHANCER_TYPE.ANTI_ELECTRO],
  [IMPACT_TYPE.FROST, ENHANCER_TYPE.ANTI_FROST],
  [IMPACT_TYPE.BIOHAZARD, ENHANCER_TYPE.ANTI_BIOHAZARD],
]);
const DIRECT_PROTECTION_ENHANCER_BY_WEAPON_TYPE = new Map([
  [5, ENHANCER_TYPE.ANTI_FIRE],
  [11, ENHANCER_TYPE.ANTI_FROST],
  [12, ENHANCER_TYPE.ANTI_POISON],
  [13, ENHANCER_TYPE.ANTI_ELECTRO],
  [14, ENHANCER_TYPE.ANTI_BIOHAZARD],
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
  1: "+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  2: "+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  3: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\nР СњР ВµР В±Р С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  6: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р С” Р вЂРЎР‚Р С•Р Р…Р Вµ",
  7: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†",
  8: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  9: "+35% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В»Р ВµР Т‘Р С•Р СР ВµРЎвЂљР С•Р Р†\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n-20% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—Р С•Р Т‘Р В¶Р С‘Р С–Р В°РЎР‹РЎвЂ°Р ВµР С–Р С• Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ",
  10: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  11: "Р Р€РЎР‚Р С•Р Р… РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘. Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† +5%\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” +15%\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  12: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р†\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+7% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3\nРЎС“РЎР‚Р С•Р Р… РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2",
  14: "Р Р€РЎР‚Р С•Р Р… РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘. Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† +10%\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” +10%\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  15: "Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉР Вµ +7%\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ:\nРЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ  +15%\nР В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† +11%\nР Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† +10%\nРЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” +15%\nР С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† +7%\nР Р€РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +4",
  16: "Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉР Вµ +5%\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ:\nРЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ  +13%\nР В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† +10%\nР Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† +9%\nРЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” +15%\nР С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† +5%\nР Р€РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  17: "Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉР Вµ +5%\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ:\nРЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ  +11%\nР В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† +9%\nР Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† +8%\nРЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” +15%\nР С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† +3%\nР Р€РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2",
  18: "+6% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+8% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  19: "+3% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+5% Р вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р†\nРЎС“Р Р†Р ВµР В»Р С‘РЎвЂЎР С‘Р Р†Р В°Р ВµРЎвЂљ РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљРЎРЉ Р С—Р ВµРЎР‚Р ВµР Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ",
  20: "+6% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+8% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  21: "+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р С” Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2",
  22: "+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+10% Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹",
  23: "+6% Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+12% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР В° Р СџРЎР‚Р С•Р Р†Р С•Р С”Р В°РЎвЂљР С•РЎР‚\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†",
  24: "+5% Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В° Р РЋР С‘Р В±Р С‘РЎР‚РЎРЏР С”",
  25: "+7% Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+12% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+7% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р† \n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  26: "+6% Р вЂ”Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  27: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р†\n+12% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†",
  28: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚РЎС“РЎвЂЎР Р…Р С•Р С–Р С•\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С”Р С‘ Р СџР С‘РЎРѓР ВµРЎвЂ \nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2",
  29: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+7% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +4",
  30: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\n+4% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3\nРЎС“РЎР‚Р С•Р Р… Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  31: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+12% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+8% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+6% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2\nРЎС“РЎР‚Р С•Р Р… Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р† Р Р…Р В° Р В±Р В»Р С‘Р В¶Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +5",
  32: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\n+20% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+15% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+2% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nРЎС“РЎР‚Р С•Р Р… РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С” Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +4",
  33: "+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+4% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +4\nРЎС“РЎР‚Р С•Р Р… Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +2",
  34: "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+4% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\n+5% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3\nРЎС“РЎР‚Р С•Р Р… Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +5",
  35: "+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+12% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +6\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +5",
  36: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+9% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +7\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +6",
  37: "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+4% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+15% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+4% Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\nРЎС“РЎР‚Р С•Р Р… РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ  Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +6\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3",
  38: "+50% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\n+50% Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+150 Р С” Р В·Р Т‘Р С•РЎР‚Р С•Р Р†РЎРЉРЎР‹\n+20 Р С” Р В±РЎР‚Р С•Р Р…Р Вµ\nРЎС“РЎР‚Р С•Р Р… Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† Р Р…Р В° Р Т‘Р В°Р В»РЎРЉР Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +3\nРЎС“РЎР‚Р С•Р Р… Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р† Р Р…Р В° РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР в„– Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ +5",
  39: "+12 к здоровью\nБроня +20\n+3% к скорости",
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
  { id: 39, code: "gavai", required: ["1:capgavaimag", "2:gavaibandana", "4:gavaihoodie", "5:shortigavai", "6:gavaibootsmag", "7:popugagavai", "3:gavaigloves"] }
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

function selectedClientEnhancers(profile) {
  return selectedEnhancers(profile).filter(({ enhancerType }) => CLIENT_VISIBLE_ENHANCER_IDS.has(Number(enhancerType)));
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
    electro: IMPACT_TYPE.ELECTRO,
    electric: IMPACT_TYPE.ELECTRO,
    frost: IMPACT_TYPE.FROST,
    biohazard: IMPACT_TYPE.BIOHAZARD,
    virus: IMPACT_TYPE.BIOHAZARD,
    stunning: IMPACT_TYPE.STUNNING,
    slow: IMPACT_TYPE.STUNNING,
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
  if (impactType === IMPACT_TYPE.ELECTRO) return "Electro";
  if (impactType === IMPACT_TYPE.FROST) return "Frost";
  if (impactType === IMPACT_TYPE.BIOHAZARD) return "Biohazard";
  if (impactType === IMPACT_TYPE.STUNNING) return "Stunning";
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
  // "РџСЂРѕС…Р»Р°РґРЅРёРє" (РЎС‚СѓР¶Р°) keeps its own armor bonus even when the full set is incomplete.
  // Recovered from the active client TextAsset: wear_Shirts_santa2_desca = "Р‘СЂРѕРЅСЏ +17".
  "4:santa2": "Р‘СЂРѕРЅСЏ +17",
  "6:boot02": "+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+3% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakolimpic": "Р вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°\nР вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р† +3%",
  "6:tacticalb01": "+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘ Р С—Р ВµРЎР‚Р ВµР Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\nР вЂ™РЎвЂ№РЎв‚¬Р Вµ РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР С–Р С• Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakv2b05": "+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘ Р С—Р ВµРЎР‚Р ВµР Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ\nР вЂ™РЎвЂ№РЎв‚¬Р Вµ РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР С–Р С• Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakv2b02": "Р вЂ™РЎвЂ№РЎв‚¬Р Вµ РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР С–Р С• Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakv2b06": "+2% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘ Р С—Р ВµРЎР‚Р ВµР Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ\n+1% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\nР вЂ™РЎвЂ№РЎв‚¬Р Вµ РЎРѓРЎР‚Р ВµР Т‘Р Р…Р ВµР С–Р С• Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakv2b03": "+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘ Р С—Р ВµРЎР‚Р ВµР Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ",
  "6:sneakv2b04": "+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘",
  "6:infernal": "Р вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘",
  "6:franky": "Р вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°\n+4% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†",
  "6:sneakv2b10": "Р вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°\n+2% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†",
  "6:anarch": "Р вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°\n+5% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘",
  "6:avenger": "+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:zadira": "+4% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+1% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:prizrak": "+1% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+3% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:sneakv201": "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+8% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:business": "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎРѓР Р…Р В°Р в„–Р С—Р ВµРЎР‚Р С•Р С”\n+3% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р С•Р Р†\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:stalker": "+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ РЎР‚Р В°Р С”Р ВµРЎвЂљР Р…Р С‘РЎвЂ \n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•Р С–Р Р…Р ВµР СР ВµРЎвЂљР С•Р Р†\n+2% Р С” РЎРѓР С”Р С•РЎР‚Р С•РЎРѓРЎвЂљР С‘\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:thanos": "+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—РЎС“Р В»Р ВµР СР ВµРЎвЂљР С•Р Р†\n+5% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+10% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С–РЎР‚Р В°Р Р…Р В°РЎвЂљР С•Р СР ВµРЎвЂљР С•Р Р†\nР вЂР С•Р В»РЎРЉРЎв‚¬Р С•Р в„– Р В±Р С•Р Р…РЎС“РЎРѓ Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  "6:slip99": "+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С•Р Р†\n+4% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С—Р С‘РЎРѓРЎвЂљР С•Р В»Р ВµРЎвЂљР С•Р Р†\n+2% Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С•РЎвЂљ Р С•РЎР‚РЎС“Р В¶Р С‘РЎРЏ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• Р В±Р С•РЎРЏ\n+40% Р С” Р С—РЎР‚РЎвЂ№Р В¶Р С”РЎС“ Р С—Р С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С‘Р В· Р Т‘РЎР‚Р С•Р В±Р С•Р Р†Р С‘Р С”Р В°",
  // The active-client UTF-8 table is authoritative. This final spread also prevents
  // legacy mojibake overrides above from masking valid item bonuses.
  ...CLIENT_WEAR_BONUS_TEXTS,
*/
const RESTORED_WEAR_BONUS_TEXTS = new Map(Object.entries(CLIENT_WEAR_BONUS_TEXTS));

const SHOTGUN_JUMP_PERCENT_BY_BOOT = new Map(Object.entries({
  "6:sneak02": 5,      // Р В¤Р С•РЎР‚Р ВµРЎРѓРЎвЂљ
  "6:slip01": 5,       // Р СћР В°РЎР‚Р В°Р С”Р В°Р Р…РЎРЉРЎРЏ РЎРѓР СР ВµРЎР‚РЎвЂљРЎРЉ
  "6:boot01": 5,       // Р вЂР ВµРЎР‚РЎвЂ РЎвЂ№
  "6:sneakv202": 10,   // Р РЃР Р…РЎС“РЎР‚
  "6:sneakv203": 10,   // Р СџРЎР‚РЎвЂ№Р С–РЎС“Р Р…
  "6:sneakolimpic": 15, // Р вЂєР ВµР С–Р С”Р С•РЎРѓРЎвЂљРЎС“Р С—
  "6:skeleton": 15,    // Р РЋР СР ВµРЎР‚РЎвЂљР С•РЎвЂ¦Р С•Р Т‘РЎвЂ№
  "6:santa": 15,       // Р РЋР В°Р Р…Р С‘РЎР‚Р В°Р в„–Р Т‘Р ВµРЎР‚РЎвЂ№
  "6:bear": 15,        // Р СљР ВµР Т‘Р Р†Р ВµР Т‘Р С•Р В»Р В°Р С—РЎвЂ№
  "6:tacticalb01": 15, // Р вЂќР ВµР В»РЎРЉРЎвЂљР С•Р Р†Р С‘Р С”Р С‘
  "6:tactical01": 15,  // Р С’РЎР‚Р СР ВµР в„–РЎвЂ РЎвЂ№
  "6:tactical02": 15,  // Р РЋР Р†Р ВµРЎР‚РЎвЂ¦Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р С‘Р СР ВµРЎвЂ 
  "6:sneakv2b06": 16,  // Р С™Р С‘РЎРѓР В»Р С•РЎвЂ¦Р С•Р Т‘РЎвЂ№
  "6:sneakv2b10": 16,  // Р вЂєР В°Р в„–Р СР В°Р В±РЎС“РЎвЂљРЎРѓРЎвЂ№
  "6:santa2": 16,      // Р СћРЎР‚Р ВµРЎРѓР С”РЎС“Р Р…РЎвЂ№
  "6:sneakv2b05": 17,  // Р С™РЎР‚Р С•РЎРѓРЎвЂ№
  "6:mummy": 17,       // Р СџР ВµРЎРѓР С”Р С•РЎвЂ¦Р С•Р Т‘РЎвЂ№
  "6:infernal": 17,    // Р ТђР С•Р Т‘РЎРЏРЎвЂ°Р С‘Р Вµ Р С—Р С• РЎС“Р С–Р В»РЎРЏР С
  "6:franky": 17,      // Р вЂўР Т‘Р С‘Р Р…Р ВµР Р…Р С‘Р Вµ РЎРѓ Р С—Р С•РЎвЂЎР Р†Р С•Р в„–
  "6:boot02": 17,      // Р СћР В°Р Р…Р В¶Р ВµРЎР‚РЎвЂ№
  "6:anarch": 20,      // Р С™Р ВµР Т‘Р С•Р Р…РЎвЂ№
  "6:avenger": 20,     // Р РЋР С‘Р Р…РЎРЉР вЂќР С‘Р С”Р В°РЎвЂљРЎвЂ№
  "6:slip99": 25,      // Р РЃР В»Р ВµР С—Р В°Р Р…РЎвЂ№
  "6:gavaibootsmag": 25, // axyenno
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
    grenadeRadiusPercent: 0,
    rocketRadiusPercent: 0,
    damageBonuses: [],
    protections: {},
    rangeProtections: { short: {}, medium: {}, long: {} },
    completedSets: [],
  };


  if (APPLY_TRAINING_ABILITY_BONUSES) {
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
  }

  const enhancerTypes = new Set(selectedEnhancers(profile).map(({ enhancerType }) => Number(enhancerType)));
  if (enhancerTypes.has(ENHANCER_TYPE.CLAN_HEALTH)) {
    modifiers.healthPercent += 5;
  }
  if (enhancerTypes.has(ENHANCER_TYPE.CLAN_GRENADE_RADIUS)) {
    modifiers.grenadeRadiusPercent += 10;
  }
  if (enhancerTypes.has(ENHANCER_TYPE.CLAN_ROCKET_RADIUS)) {
    modifiers.rocketRadiusPercent += 10;
  }
  const enhancerWeaponDamageBonuses = [
    [ENHANCER_TYPE.CLAN_PISTOL_DAMAGE, [3], 8],
    [ENHANCER_TYPE.CLAN_SHOTGUN_DAMAGE, [7], 15],
    [ENHANCER_TYPE.CLAN_MELEE_DAMAGE, [1, 2], 15],
  ];
  for (const [enhancerType, types, amount] of enhancerWeaponDamageBonuses) {
    if (!enhancerTypes.has(enhancerType)) continue;
    for (const range of ALL_DAMAGE_RANGES) {
      modifiers.damageBonuses.push({ range, types, amount });
    }
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

  const radiusPercent = weaponType === 8
    ? numberOr(modifiers.rocketRadiusPercent, 0)
    : ((weaponType === 9 || weaponType === 15) ? numberOr(modifiers.grenadeRadiusPercent, 0) : 0);
  if (radiusPercent !== 0) {
    result.rad = Math.max(1, Math.round(numberOr(result.rad, 0) * (1 + radiusPercent / 100)));
  }

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

function playerRuntimeStats(profile = null, options = {}) {
  const modifiers = gameplayModifiersForProfile(profile);
  const baseHealth = Number(process.env.DEFAULT_PLAYER_HEALTH || 100);
  const baseEnergy = Math.max(0, numberOr(process.env.DEFAULT_PLAYER_ENERGY, 0));
  const baseSpeed10 = Number(options.baseSpeed10 ?? PLAYER_BASE_SPEED10);
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
  return playerRuntimeStats(session?.loadedProfile || null, { baseSpeed10: PLAYER_BASE_SPEED10 });
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
  const selected = selectedClientEnhancers(profile);
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
  const stats = playerRuntimeStats(profile, options);
  const clanId = numberOr(profile?.clan?.cid ?? profile?.clan?.id, 0);
  const clanTag = clanId > 0
    ? stringOr(profile?.clan?.t ?? profile?.clan?.tag, "")
    : "";
  const entries = [
    { key: rawByte(100), value: rawInt(stats.maxHealth) },
    { key: rawByte(99), value: rawInt(stats.maxEnergy) },
    { key: rawByte(95), value: rawInt(stats.speed10) },
    { key: rawByte(94), value: makeWeaponDictionaryRaw(profile, options.weaponSlotLimit ?? JOIN_LOADOUT_SLOT_LIMIT, options) },
    { key: rawByte(92), value: rawInt(stats.jump) },
    { key: rawByte(76), value: rawInt(numberOr(profile?.level, Number(process.env.DEFAULT_PLAYER_LEVEL || 1))) },
    { key: rawByte(36), value: rawBool(process.env.DEFAULT_PLAYER_PREMIUM === "1") },
    // GameScore.AddUser() formats any non-empty/non-null clan tag as
    // "[tag] name". Keep key 6 even in compact actor payloads so a player
    // without a clan is always initialized with string.Empty, never null.
    { key: rawByte(6), value: rawString(clanTag) },
  ];

  if (options.isGuest === true) {
    // CombatPlayer.Init() reads IsGuest from ActorInfo = actorData[96], key 4.
    // Presence of the key is the original client contract; its value is not read.
    entries.push({ key: rawByte(4), value: rawBool(true) });
  }

  if (options.includeActorOptionalFields !== false) {
    const clanArmId = numberOr(profile?.clan?.aid ?? profile?.clan?.armId, 0);
    if (clanId > 0) entries.push({ key: rawByte(8), value: rawInt(clanId) });
    entries.push({ key: rawByte(5), value: rawInt(clanArmId) });
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

function normalizeStaffRole(value) {
  const role = String(value ?? "").trim().toLowerCase();
  const aliases = {
    mod: "moderator",
    moder: "moderator",
    administrator: "admin",
    dev: "developer",
  };
  const normalized = aliases[role] || role;
  return Object.prototype.hasOwnProperty.call(STAFF_ROLE_RANK, normalized) ? normalized : "none";
}

function staffProfileFromPayload(profilePayload) {
  const raw = profilePayload?.conf?.staff;
  if (typeof raw === "string") return { role: normalizeStaffRole(raw) };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { role: "none" };
  const activeValue = raw.active ?? raw.enabled ?? raw.a;
  const activeText = String(activeValue ?? "").trim().toLowerCase();
  const active = activeValue == null || activeValue === true || activeValue === 1 || ["1", "true", "on", "yes"].includes(activeText);
  if (!active) return { role: "none" };
  return { role: normalizeStaffRole(raw.role ?? raw.r ?? raw.name) };
}

function staffRoleRank(value) {
  return Number(STAFF_ROLE_RANK[normalizeStaffRole(value)] || 0);
}

function staffHasCapability(sessionOrRole, capability) {
  const role = typeof sessionOrRole === "string"
    ? normalizeStaffRole(sessionOrRole)
    : normalizeStaffRole(sessionOrRole?.staffRole);
  const minimum = STAFF_CAPABILITY_MIN_ROLE[capability];
  return Boolean(minimum) && staffRoleRank(role) >= staffRoleRank(minimum);
}

function applySessionStaffProfile(session, profile) {
  if (!session) return "none";
  const role = normalizeStaffRole(profile?.staffRole);
  session.staffRole = role;
  session.staffRank = staffRoleRank(role);
  session.staffProfileLoadedAt = Date.now();
  if (!staffHasCapability(session, "flight")) clearStaffFlightState(session, "role-revoked");
  return role;
}

function clearStaffFlightState(session, reason = "clear") {
  if (!session) return false;
  const wasActive = session.staffFlightActive === true;
  session.staffFlightActive = false;
  session.staffFlightMode = "combat";
  session.staffFlightChangedAt = Date.now();
  if (wasActive) {
    console.log(`[staff] fly disabled actor=${session.actorId || 0} player=${session.playerId || 0} reason=${reason}`);
  }
  return wasActive;
}

function handleStaffFlightRequest(session, parsed) {
  const data = eventDataHash(parsed);
  const requested = Number(htGet(data, 1)?.value || 0) === 1;
  const cinematic = Number(htGet(data, 2)?.value || 0) === 1;
  if (!requested) {
    clearStaffFlightState(session, "client-disable");
    return [];
  }
  if (
    !session?.room ||
    !session.spawned ||
    session.dead ||
    session.isGuest ||
    !staffHasCapability(session, "flight")
  ) {
    clearStaffFlightState(session, "rejected");
    console.log(`[staff] fly rejected actor=${session?.actorId || 0} player=${session?.playerId || 0} role=${normalizeStaffRole(session?.staffRole)} spawned=${session?.spawned ? 1 : 0} dead=${session?.dead ? 1 : 0} guest=${session?.isGuest ? 1 : 0}`);
    return [];
  }
  session.staffFlightActive = true;
  session.staffFlightMode = cinematic ? "cinematic" : "combat";
  session.staffFlightChangedAt = Date.now();
  console.log(`[staff] fly enabled actor=${session.actorId} player=${session.playerId || 0} role=${normalizeStaffRole(session.staffRole)} mode=${session.staffFlightMode}`);
  return [];
}

function cachedStaffCanModerate(sourceSession, targetSession, capability) {
  if (!sourceSession || !targetSession) return false;
  if (Number(sourceSession.playerId || 0) <= 0 || Number(targetSession.playerId || 0) <= 0) return false;
  if (Number(sourceSession.playerId) === Number(targetSession.playerId)) return false;
  if (!staffHasCapability(sourceSession, capability)) return false;
  return staffRoleRank(sourceSession.staffRole) > staffRoleRank(targetSession.staffRole);
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

function invalidatePlayerProfileCache(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return 0;
  const prefix = `${id}:`;
  let removed = 0;
  for (const cacheKey of profileCache.keys()) {
    if (!String(cacheKey).startsWith(prefix)) continue;
    profileCache.delete(cacheKey);
    removed += 1;
  }
  return removed;
}

function invalidateClanProfileCache(clanId) {
  const id = Number(clanId || 0);
  if (!Number.isFinite(id) || id <= 0) return 0;
  let removed = 0;
  for (const [cacheKey, cached] of profileCache.entries()) {
    if (Number(cached?.profile?.clan?.cid || 0) !== id) continue;
    profileCache.delete(cacheKey);
    removed += 1;
  }
  return removed;
}

function markPlayerProfileChanged(playerId, changeType) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const previous = profileChanges.get(id);
  const change = {
    version: Number(previous?.version || 0) + 1,
    changedAt: Date.now(),
    changeType: Number(changeType || 0),
  };
  profileChanges.delete(id);
  profileChanges.set(id, change);
  while (profileChanges.size > PROFILE_CACHE_MAX) {
    profileChanges.delete(profileChanges.keys().next().value);
  }
  const removed = invalidatePlayerProfileCache(id);
  console.log(`[profile] invalidated id=${id} change=${change.changeType || "unknown"} version=${change.version} cache=${removed}`);
  return change;
}

async function settleRecentPlayerProfileChange(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const change = profileChanges.get(id);
  if (!change) return null;
  const age = Date.now() - change.changedAt;
  if (age >= PROFILE_CHANGE_TRACK_MS) {
    if (profileChanges.get(id) === change) profileChanges.delete(id);
    return null;
  }
  const waitMs = Math.max(0, PROFILE_CHANGE_SETTLE_MS - age);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return { ...change, waitedMs: waitMs };
}

function fallbackPlayerProfile(incomingActor, options = {}) {
  const { authId, authKey } = actorCredentials(incomingActor);
  return {
    isFallback: true,
    accessDenied: options.accessDenied === true,
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
    staffRole: "none",
  };
}

function isFallbackBattleProfile(profile) {
  return !profile || profile.isFallback === true;
}

function drainProfileLoadQueue() {
  while (profileLoadInFlight < PROFILE_LOAD_CONCURRENCY && profileLoadQueue.length > 0) {
    const job = profileLoadQueue.shift();
    profileLoadInFlight += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        profileLoadInFlight -= 1;
        drainProfileLoadQueue();
      });
  }
}

function scheduleProfileLoad(task) {
  if (profileLoadQueue.length >= PROFILE_LOAD_QUEUE_MAX) {
    return Promise.reject(new Error(`profile queue full size=${profileLoadQueue.length}`));
  }
  return new Promise((resolve, reject) => {
    profileLoadQueue.push({ task, resolve, reject });
    drainProfileLoadQueue();
  });
}

function loadPlayerProfileSingleFlight(incomingActor, options = {}) {
  const { authId, authKey } = actorCredentials(incomingActor);
  const ccid = Number(authId || 0);
  const identityKey = `${ccid}:${authKey}`;
  const forceRefresh = Boolean(options.forceRefresh);
  const existing = profileLoads.get(ccid);
  if (existing) {
    if (existing.identityKey === identityKey) {
      if (!forceRefresh || existing.forceRefresh) return existing.promise;
      // A canonical join refresh must never be downgraded to an older lobby
      // warm-up that was allowed to use the cache.
      return existing.promise
        .catch(() => null)
        .then(() => loadPlayerProfileSingleFlight(incomingActor, { ...options, forceRefresh: true }));
    }
    return existing.promise.catch(() => null).then(() => loadPlayerProfileSingleFlight(incomingActor, options));
  }
  const promise = scheduleProfileLoad(() => loadPlayerProfile(incomingActor, options))
    .finally(() => {
      if (profileLoads.get(ccid)?.promise === promise) profileLoads.delete(ccid);
    });
  profileLoads.set(ccid, { identityKey, forceRefresh, promise });
  return promise;
}

function warmPlayerProfile(incomingActor, reason = "warm") {
  const cached = cachedPlayerProfile(incomingActor);
  if (cached) return Promise.resolve(cached);

  const { authId } = actorCredentials(incomingActor);
  console.log(`[profile] warm start id=${authId} reason=${reason}`);
  return loadPlayerProfileSingleFlight(incomingActor)
    .catch((error) => {
      console.log(`[profile] warm failed id=${authId} reason=${reason} ${error.message}`);
      return fallbackPlayerProfile(incomingActor);
    });
}

async function profileForJoin(incomingActor, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const cached = cachedPlayerProfile(incomingActor);
  if (!forceRefresh && cached) return { profile: cached, source: "cache" };

  let loaded;
  try {
    const { authId } = actorCredentials(incomingActor);
    let settledChange = forceRefresh ? await settleRecentPlayerProfileChange(authId) : null;
    loaded = await loadPlayerProfileSingleFlight(incomingActor, { forceRefresh });

    // If another client mutation arrived while the canonical profile was being
    // loaded, wait for that save and refresh once more instead of joining with
    // the just-obsoleted snapshot.
    if (forceRefresh) {
      const latestChange = profileChanges.get(Number(authId || 0));
      if (latestChange && (!settledChange || latestChange.version !== settledChange.version)) {
        invalidatePlayerProfileCache(authId);
        settledChange = await settleRecentPlayerProfileChange(authId);
        loaded = await loadPlayerProfileSingleFlight(incomingActor, { forceRefresh: true });
      }
      if (settledChange?.waitedMs > 0) {
        console.log(`[profile] join settled id=${authId} change=${settledChange.changeType || "unknown"} version=${settledChange.version} wait=${settledChange.waitedMs}ms`);
      }
    }
  } catch (error) {
    console.log(`[profile] join load failed id=${actorCredentials(incomingActor).authId} ${error.message}`);
    loaded = fallbackPlayerProfile(incomingActor);
  }
  if (!isFallbackBattleProfile(loaded)) return { profile: loaded, source: forceRefresh ? "fresh" : "loaded" };
  // A 403 from the canonical API means that these credentials are no longer
  // allowed (including an active ban). Never revive a cached pre-ban profile.
  if (loaded?.accessDenied === true) return { profile: loaded, source: "access-denied" };
  if (cached && !isFallbackBattleProfile(cached)) return { profile: cached, source: "cache-fallback" };
  return { profile: fallbackPlayerProfile(incomingActor), source: "fallback" };
}

function applyLateProfile(session, profile, incomingActor = null) {
  if (isFallbackBattleProfile(profile)) return false;
  const battleActive = Boolean(session?.room && (session.gameStateRequested || session.spawned || session.matchStartedAt));
  if (battleActive) {
    session.pendingBattleProfile = { profile, incomingActor, stagedAt: Date.now() };
    console.log(`[profile] late staged actor=${session.actorId || 0} id=${profile.authId} reason=active-battle`);
    return false;
  }
  session.loadedProfile = profile;
  session.playerId = profile.authId;
  session.playerAuthKey = profile.authKey || session.playerAuthKey || "";
  session.playerName = profile.name;
  applySessionStaffProfile(session, profile);
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
  return true;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  if (typeof fetch !== "function") return null;
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`api timeout ${timeoutMs}ms`)), timeoutMs);
  if (typeof timeout.unref === "function") timeout.unref();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`api timeout ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

async function fetchApiJson(path) {
  if (!API_BASE_URL || typeof fetch !== "function") return null;
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const error = new Error(`status=${response.status}`);
    error.status = Number(response.status || 0);
    throw error;
  }
  return response.json();
}

async function postApiJson(path, body) {
  if (!API_BASE_URL || typeof fetch !== "function") return null;
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
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
  if (!options.forceRefresh && shopCatalogCache.loadedAt > 0 && Date.now() - shopCatalogCache.loadedAt < CATALOG_CACHE_TTL_MS) {
    return shopCatalogCache;
  }
  if (shopCatalogLoad) return shopCatalogLoad;
  shopCatalogLoad = fetchApiJson(`/ajax.php?page=shop&act=items&${query}`)
    .then((payload) => {
      const weapons = Array.isArray(payload?.weap?.items) ? payload.weap.items : [];
      const wears = Array.isArray(payload?.wear?.items) ? payload.wear.items : [];
      shopCatalogCache = { loadedAt: Date.now(), weapons, wears };
      return shopCatalogCache;
    })
    .finally(() => {
      shopCatalogLoad = null;
    });
  return shopCatalogLoad;
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
      loadShopCatalog(query).catch((error) => {
        console.log(`[profile] catalog failed id=${authId} ${error.message}`);
        return { weapons: [], wears: [] };
      }),
    ]);

    const info = profilePayload?.info || {};
    const loadedAuthId = Number(info.u_id || 0);
    if (!Number.isFinite(loadedAuthId) || loadedAuthId <= 0) {
      throw new Error("profile-unavailable missing-ccid");
    }
    if (Number.isFinite(authId) && authId > 0 && loadedAuthId !== authId) {
      throw new Error(`profile-ccid-mismatch requested=${authId} loaded=${loadedAuthId}`);
    }
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
      authId: loadedAuthId,
      authKey,
      // API owns role assignment and may decorate info.un. Battle never trusts
      // actor properties for either the displayed staff name or authorization.
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
      staffRole: staffProfileFromPayload(profilePayload).role,
    };
    profileCache.set(cacheKey, { loadedAt: Date.now(), profile });
    while (profileCache.size > PROFILE_CACHE_MAX) {
      profileCache.delete(profileCache.keys().next().value);
    }
    const stats = playerRuntimeStats(profile);
    console.log(`[profile] loaded id=${profile.authId} name=${profile.name} weap=${profileWeaponSelectionSummary(profile.weap)} loadout=${selectedWeaponLoadoutSummary(profile)} weapons=${selectedWeapons(profile)?.length || 0} weaponUpgrades=${selectedWeaponUpgradeSummary(profile)} wears=${selectedWears(profile).length} wearList=${selectedWearSummary(profile)} taunts=${selectedTaunts(profile).length} tauntSlots=${selectedTauntSummary(profile)} enhancers=${selectedEnhancers(profile).length} enhancerList=${selectedEnhancerSummary(profile)} abilities=${profile.abilities.length} sets=${stats.modifiers.completedSets.join(",") || "none"} hpPct=${stats.modifiers.healthPercent} hpFloor=${stats.modifiers.healthFloor} armorFlat=${stats.modifiers.armorFlat} armorPct=${stats.modifiers.armorPercent} dmgRedPct=${stats.modifiers.damageReductionPercent} speedPct=${stats.modifiers.speedPercent} speedFloor=${stats.modifiers.clientSpeedFloor} weaponSpeedPct=${stats.modifiers.weaponSpeedPercent} weaponRapidityPct=${stats.modifiers.weaponRapidityPercent} weaponHeadDmgPct=${stats.modifiers.weaponHeadDamagePercent} weaponAccuracyFlat=${stats.modifiers.weaponAccuracyFlat} ammoPct=${stats.modifiers.weaponAmmoPercent} jumpPct=${stats.modifiers.jumpPercent} shotgunJumpBonus=${stats.modifiers.shotgunJumpBonus} jumpCap=${stats.jumpCap} prot=${formatProtectionBonuses(stats.modifiers.protections)} rangeProt=${formatRangeProtectionBonuses(stats.modifiers.rangeProtections)} wearDmg=${formatDamageBonuses(stats.modifiers.damageBonuses)} health=${stats.maxHealth} energy=${stats.maxEnergy} speed10=${stats.speed10} jump=${stats.jump}`);
    return profile;
  } catch (error) {
    console.log(`[profile] failed id=${authId} ${error.message}`);
    return fallbackPlayerProfile(incomingActor, { accessDenied: Number(error?.status || 0) === 403 });
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

function mandatoryLoadoutActorCandidates(incomingActor, profile, sharedOptions = {}) {
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
    raw: makeActorDataRaw(incomingActor, profile, { ...candidate.options, ...sharedOptions }),
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

function fitActorDataRaw(incomingActor, profile, actorId, channel = 0, roomRaw = null, mode = "event", sharedOptions = {}) {
  const maxSlots = FULL_LOADOUT_SLOT_LIMIT;
  const wearCount = selectedWears(profile).length;
  const wearList = selectedWearSummary(profile);
  const enhancerCount = selectedClientEnhancers(profile).length;
  const enhancerList = selectedEnhancerSummary(profile);
  let fallback = null;
  for (const candidate of mandatoryLoadoutActorCandidates(incomingActor, profile, sharedOptions)) {
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
  const baseSpeed10 = PLAYER_BASE_SPEED10;
  const isGuest = session?.isGuest === true;
  session.actorJoinParam = incomingActor;
  session.actorRaw = makeActorDataRaw(incomingActor, profile, {
    weaponSlotLimit: FULL_LOADOUT_SLOT_LIMIT,
    baseSpeed10,
    isGuest,
  });
  const peerActor = fitActorDataRaw(incomingActor, profile, session.actorId, channel, session.roomRaw, "event", { baseSpeed10, isGuest });
  const joinActor = fitActorDataRaw(incomingActor, profile, session.actorId, channel, session.roomRaw, "join", { baseSpeed10, isGuest });
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
  session.actorEnhancerCount = selectedClientEnhancers(profile).length;
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
  const flagExp = awardBattleExp(session, BATTLE_EXP_PER_FLAG, "flag-deliver", {
    eventBonusPercent: hasSelectedEnhancer(session.loadedProfile, ENHANCER_TYPE.CLAN_FLAG_EXP) ? 100 : 0,
    persist: true,
  });
  sendReliableToWholeRoom(room, makeFlagEvent(1, carried), channel, { requireGameState: false });
  sendReliableToWholeRoom(room, makeScoreUpdateEvent(session), channel, { requireGameState: false });
  console.log(`[flag] delivered actor=${session.actorId} flagTeam=${carried.team} score=${teamScorePoints(session, session.team)} exp=${flagExp} source=${source} pos=${fmtPoint(session.lastTransform)}`);
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
  for(const flag of room.flags.values()) if(flag.bearer===session.actorId) { flag.bearer=-1; flag.state=2; Object.assign(flag,session.lastTransform||flag); sendReliableToWholeRoom(room,makeFlagEvent(type,flag),channel,{requireGameState:false}); console.log(`[flag] dropped actor=${session.actorId} flagTeam=${flag.team} reason=${type}`); }
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
      awardBattleExp(player, BATTLE_EXP_PER_CONTROL_POINT, "control-capture", {
        eventBonusPercent: hasSelectedEnhancer(player.loadedProfile, ENHANCER_TYPE.CLAN_CONTROL_EXP) ? 100 : 0,
        persist: true,
      });
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
      subType: item.subType,
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
    return sendPacket(targetSession.socket, targetSession.rinfo, targetSession, commands);
  } catch (error) {
    console.log(`[warn] peer-send failed actor=${targetSession.actorId || "?"} cmds=${commands.length} reason=${error.message}`);
    return false;
  }
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
    return sendPacket(targetSession.socket, targetSession.rinfo, targetSession, commands);
  } catch (error) {
    console.log(`[warn] peer-send failed actor=${targetSession.actorId || "?"} seq=${reliableCommand.seqs ?? reliableCommand.seq ?? "?"} reason=${error.message}`);
    return false;
  }
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
  return mode === MAP_MODE_TEAM_DEATHMATCH || mode === MAP_MODE_CAPTURE_THE_FLAG || mode === MAP_MODE_CONTROL_POINTS;
}

function isVoiceEvent(parsed) {
  const eventCode = photonEventCode(parsed);
  if (eventCode !== VOICE_FRAME_EVENT && eventCode !== VOICE_CAPABILITY_EVENT) return false;
  const data = eventDataHash(parsed);
  const version = Number(htGet(data, 1)?.value);
  return hasVoiceProtocolSignature(data, version);
}

function isSupportedVoiceProtocol(version) {
  return version === VOICE_PROTOCOL_LEGACY ||
    version === VOICE_PROTOCOL_OPUS_V2 ||
    version === VOICE_PROTOCOL_OPUS;
}

function voiceMaxFrameBytes(version) {
  return version === VOICE_PROTOCOL_LEGACY
    ? VOICE_FRAME_BYTES
    : VOICE_OPUS_MAX_FRAME_BYTES;
}

function voiceFrameMilliseconds(version) {
  if (version === VOICE_PROTOCOL_OPUS) return VOICE_OPUS_FRAME_MS;
  return VOICE_OPUS_V2_FRAME_MS;
}

function voiceSignatureForVersion(version) {
  if (version === VOICE_PROTOCOL_OPUS) return VOICE_PROTOCOL_SIGNATURE;
  if (version === VOICE_PROTOCOL_OPUS_V2) return VOICE_PROTOCOL_SIGNATURE_V2;
  return "";
}

function hasVoiceProtocolSignature(data, version) {
  if (version === VOICE_PROTOCOL_LEGACY) return true;
  const expected = voiceSignatureForVersion(version);
  return Boolean(expected) && String(htGet(data, 4)?.value || "") === expected;
}

function hasKnownVoiceSignature(data) {
  const signature = String(htGet(data, 4)?.value || "");
  return signature === VOICE_PROTOCOL_SIGNATURE || signature === VOICE_PROTOCOL_SIGNATURE_V2;
}

function setVoiceCapability(session, parsed) {
  const data = eventDataHash(parsed);
  const version = Number(htGet(data, 1)?.value);
  const codec = Number(htGet(data, 2)?.value || 0);
  const frameMillisecondsField = htGet(data, 5);
  const frameMilliseconds = Number(frameMillisecondsField?.value || voiceFrameMilliseconds(version));
  const valid =
    version === VOICE_PROTOCOL_LEGACY ||
    ((version === VOICE_PROTOCOL_OPUS_V2 || version === VOICE_PROTOCOL_OPUS) &&
      codec === 1 && hasVoiceProtocolSignature(data, version) &&
      frameMilliseconds === voiceFrameMilliseconds(version) &&
      (version !== VOICE_PROTOCOL_OPUS || Boolean(frameMillisecondsField)));
  if (!session || !valid) {
    return false;
  }
  if (session.voiceProtocolVersion !== version || session.voiceCodec !== codec) {
    const codecName = version === VOICE_PROTOCOL_LEGACY ? "mulaw" : `opus${frameMilliseconds}`;
    console.log(`[voice] capable actor=${session.actorId || 0} player=${session.playerId || 0} protocol=${version} codec=${codecName}`);
  }
  session.voiceProtocolVersion = version;
  session.voiceCodec = codec;
  session.voiceFrameMilliseconds = frameMilliseconds;
  session.voiceCapabilityAt = Date.now();
  return true;
}

function sendRealtimeUnreliableToSession(targetSession, payload, channel = 0, options = {}) {
  if (!targetSession?.socket || !targetSession?.rinfo || !payload || targetSession.transportDisconnected) return false;
  const command = makeSessionUnreliableCommand(targetSession, payload, channel, options);
  try {
    // Voice is real-time data. Bypass the shared 15 ms outbox so a stalled
    // event loop cannot accumulate old audio and burst it ahead of gameplay.
    return sendPacketNow(
      targetSession.socket,
      targetSession.rinfo,
      targetSession,
      [command.command],
    );
  } catch (error) {
    console.log(`[warn] peer-send-realtime failed actor=${targetSession.actorId || "?"} seq=${command.seq ?? "?"} reason=${error.message}`);
    return false;
  }
}

function readVoiceFrame(parsed) {
  const data = eventDataHash(parsed);
  const version = Number(htGet(data, 1)?.value);
  const sequence = Number(htGet(data, 2)?.value);
  const frame = htGet(data, 3);
  const frameMillisecondsField = htGet(data, 5);
  const frameMilliseconds = Number(frameMillisecondsField?.value || voiceFrameMilliseconds(version));
  if (!isSupportedVoiceProtocol(version) || !hasVoiceProtocolSignature(data, version) ||
      frameMilliseconds !== voiceFrameMilliseconds(version) ||
      (version === VOICE_PROTOCOL_OPUS && !frameMillisecondsField) ||
      !Number.isInteger(sequence) || !frame ||
      frame.type !== 0x78 || !Buffer.isBuffer(frame.value)) {
    return null;
  }
  const frameLength = frame.value.length;
  const validLength = version === VOICE_PROTOCOL_LEGACY
    ? frameLength === VOICE_FRAME_BYTES
    : frameLength > 0 && frameLength <= VOICE_OPUS_MAX_FRAME_BYTES;
  if (!validLength) return null;
  return { data, version, sequence, frameMilliseconds, frame: frame.value };
}

function voiceRateAllows(session, byteLength, version) {
  const now = Date.now();
  let rate = session.voiceRate;
  if (!rate || now - Number(rate.startedAt || 0) >= VOICE_RATE_WINDOW_MS) {
    rate = { startedAt: now, frames: 0, bytes: 0, lastDropLogAt: 0 };
    session.voiceRate = rate;
  }
  const maxFrames = version === VOICE_PROTOCOL_OPUS ? VOICE_RATE_MAX_FRAMES : VOICE_RATE_MAX_FRAMES_V2;
  const maxBytes = version === VOICE_PROTOCOL_OPUS
    ? VOICE_RATE_MAX_BYTES
    : VOICE_OPUS_MAX_FRAME_BYTES * VOICE_RATE_MAX_FRAMES_V2;
  if (rate.frames >= maxFrames || rate.bytes + byteLength > maxBytes) {
    if (now - Number(rate.lastDropLogAt || 0) >= VOICE_RATE_WINDOW_MS) {
      rate.lastDropLogAt = now;
      console.log(`[voice] rate-drop actor=${session.actorId || 0} frames=${rate.frames} bytes=${rate.bytes}`);
    }
    return false;
  }
  rate.frames += 1;
  rate.bytes += byteLength;
  return true;
}

function voiceTeamOnly(session) {
  return !isZombieRoom(session?.room) && isTeamMode(roomMode(session));
}

function canReceiveVoice(playerSession, sourceProtocolVersion, sourceCodec) {
  return Boolean(
    playerSession &&
    !playerSession.isGuest &&
    playerSession.gameStateRequested &&
    Number(playerSession.voiceProtocolVersion) === Number(sourceProtocolVersion) &&
    Number(playerSession.voiceCodec || 0) === Number(sourceCodec || 0)
  );
}

function buildVoiceFrameEvent(session, data) {
  return rawEvent(VOICE_FRAME_EVENT, [
    { key: 254, value: rawInt(session.actorId) },
    { key: 245, value: data.raw },
  ]);
}

function broadcastVoiceFrame(session, payload) {
  const room = session?.room;
  if (!room?.players?.size || !payload) return 0;
  const sourceProtocolVersion = Number(session.voiceProtocolVersion);
  const sourceCodec = Number(session.voiceCodec || 0);
  const teamOnly = voiceTeamOnly(session);
  if (teamOnly && ![1, 2].includes(Number(session.team))) return 0;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!canReceiveVoice(playerSession, sourceProtocolVersion, sourceCodec) || playerSession === session) continue;
    if (teamOnly && Number(playerSession.team) !== Number(session.team)) continue;
    if (sendRealtimeUnreliableToSession(playerSession, payload, VOICE_CHANNEL, { forceChannel: true })) {
      sent += 1;
    }
  }
  return sent;
}

function handleVoiceCapability(session, parsed) {
  if (!setVoiceCapability(session, parsed)) {
    console.log(`[voice] capability ignored actor=${session?.actorId || 0} reason=protocol`);
  }
  return [];
}

function handleVoiceFrame(session, parsed) {
  if (!session?.room || session.isGuest || !session.gameStateRequested) return [];
  if (!isSupportedVoiceProtocol(Number(session.voiceProtocolVersion))) return [];
  const voice = readVoiceFrame(parsed);
  if (!voice || Number(session.voiceProtocolVersion) !== voice.version) return [];
  if (!voiceRateAllows(session, voice.frame.length, voice.version)) return [];
  const event = buildVoiceFrameEvent(session, voice.data);
  broadcastVoiceFrame(session, event);
  return [];
}

function cleanPlayerReportText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, PLAYER_REPORT_TEXT_MAX);
}

function makePlayerReportStatusEvent(session, accepted, status) {
  const signature = voiceSignatureForVersion(Number(session?.voiceProtocolVersion)) || VOICE_PROTOCOL_SIGNATURE;
  return rawEvent(PLAYER_REPORT_EVENT, [
    { key: 254, value: rawInt(session.actorId) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawInt(1), value: rawByte(accepted ? 1 : 0) },
        { key: rawInt(2), value: rawString(String(status || "error").slice(0, 48)) },
        { key: rawInt(4), value: rawString(signature) },
      ]),
    },
  ]);
}

function sendPlayerReportStatus(session, accepted, status) {
  if (!session?.socket || !session?.rinfo) return false;
  const channel = reliableChannelForSession(session, session.lastChannel || 0);
  return sendReliableToSession(session, makePlayerReportStatusEvent(session, accepted, status), channel);
}

function handlePlayerReport(session, parsed) {
  if (!session?.room || session.isGuest || !session.gameStateRequested) return [];
  const data = eventDataHash(parsed);
  if (!hasKnownVoiceSignature(data)) return [];
  const targetActorId = Number(htGet(data, 1)?.value || 0);
  const reasonCode = Number(htGet(data, 2)?.value || 0);
  const details = cleanPlayerReportText(htGet(data, 3)?.value);
  const target = session.room.players.get(targetActorId);
  const now = Date.now();
  if (!Number.isInteger(targetActorId) || !target || target === session ||
      !Number.isInteger(Number(target.playerId)) || Number(target.playerId) <= 0) {
    sendPlayerReportStatus(session, false, "invalid_target");
    return [];
  }
  if (!PLAYER_REPORT_REASON[reasonCode]) {
    sendPlayerReportStatus(session, false, "invalid_reason");
    return [];
  }
  if (reasonCode === 5 && details.length < 3) {
    sendPlayerReportStatus(session, false, "details_required");
    return [];
  }
  if (now - Number(session.playerReportLastAt || 0) < PLAYER_REPORT_COOLDOWN_MS) {
    sendPlayerReportStatus(session, false, "cooldown");
    return [];
  }
  session.playerReportLastAt = now;
  postBattleEvent(session, "player_report", {
    targetPlayerId: Number(target.playerId),
    targetPlayerName: String(target.playerName || "").slice(0, 80),
    targetActorId,
    reportReason: PLAYER_REPORT_REASON[reasonCode],
    reportDetails: details,
    eventData: {
      targetActorId,
      targetPlayerId: Number(target.playerId),
      targetPlayerName: String(target.playerName || "").slice(0, 80),
      reason: PLAYER_REPORT_REASON[reasonCode],
      details,
    },
  }).then((stored) => {
    sendPlayerReportStatus(session, stored === true, stored === true ? "accepted" : "storage_unavailable");
  }).catch(() => {
    sendPlayerReportStatus(session, false, "storage_unavailable");
  });
  return [];
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
  return isTeamMode(mode) ? -1 : 0;
}

function autoTeamForTeamRoom(room) {
  const players = Array.from(room?.players?.values?.() || []);
  const team1 = players.filter((playerSession) => Number(playerSession.team) === 1).length;
  const team2 = players.filter((playerSession) => Number(playerSession.team) === 2).length;
  return team2 < team1 ? 2 : 1;
}

function enhancerExpPercent(session) {
  if (!session) return 0;
  let percent = 0;
  if (hasSelectedEnhancer(session.loadedProfile, ENHANCER_TYPE.PERSONAL_EXP)) percent += 50;
  if (hasSelectedEnhancer(session.loadedProfile, ENHANCER_TYPE.CLAN_EXP)) percent += 50;
  return percent;
}

function awardBattleExp(session, amount, reason = "kill", options = {}) {
  if (!ENABLE_BATTLE_EXP || !session) return 0;
  const base = Math.max(0, Math.trunc(numberOr(amount, 0)));
  const passivePercent = enhancerExpPercent(session);
  const eventBonusPercent = Math.max(0, numberOr(options.eventBonusPercent, 0));
  const flatBonus = Math.max(0, Math.trunc(numberOr(options.flatBonus, 0)));
  const exp = Math.max(0, Math.round(base * (1 + (passivePercent + eventBonusPercent) / 100)) + flatBonus);
  if (exp <= 0) return 0;
  session.expEarned = numberOr(session.expEarned, 0) + exp;
  session.matchExp = numberOr(session.matchExp, 0) + exp;
  const clanKoef = numberOr(session.loadedProfile?.clan?.ek, 0);
  const exp2clan = clanKoef > 0 ? Math.round(exp * clanKoef / 100) : 0;
  if (exp2clan > 0) {
    session.exp2clan = numberOr(session.exp2clan, 0) + exp2clan;
  }
  if (options.persist === true) {
    postBattleEvent(session, "exp", {
      expAwarded: exp,
      exp2clan,
      eventData: {
        reason,
        base,
        passivePercent,
        eventBonusPercent,
        flatBonus,
      },
    });
  }
  console.log(`[event] exp actor=${session.actorId} player=${session.playerId || "unknown"} reason=${reason} base=${base} passivePct=${passivePercent} eventPct=${eventBonusPercent} flat=${flatBonus} add=${exp} total=${session.expEarned}`);
  return exp;
}

function battleExpForKill(shooter, targetSession) {
  if (!ENABLE_BATTLE_EXP || !shooter || !targetSession || shooter === targetSession) return 0;
  return BATTLE_EXP_PER_KILL;
}

function sessionClanId(session) {
  return numberOr(session?.loadedProfile?.clan?.cid ?? session?.loadedProfile?.clan?.id, 0);
}

function battleExpOptionsForKill(shooter, targetSession) {
  const shooterClanId = sessionClanId(shooter);
  const targetClanId = sessionClanId(targetSession);
  const zombieBonus = isZombiePlayerSession(targetSession)
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_ZOMBIE_EXP);
  const otherClanBonus = shooterClanId > 0
    && targetClanId > 0
    && shooterClanId !== targetClanId
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_OTHER_CLAN_KILL_EXP);
  return {
    eventBonusPercent: zombieBonus ? 100 : 0,
    flatBonus: otherClanBonus ? 5 : 0,
  };
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
    if (!playerSession || playerSession.isGuest || Number(playerSession.team) !== team) continue;
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
    if (!playerSession?.actorRaw || playerSession.isGuest) continue;
    const hasScoreState =
      playerSession.spawned ||
      playerSession.dead ||
      numberOr(playerSession.kills, 0) > 0 ||
      numberOr(playerSession.deaths, 0) > 0 ||
      numberOr(playerSession.points, 0) > 0;
    if (!hasScoreState) continue;
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
  session.damageContributors = new Map();
  session.kamikazeTriggered = false;
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
  beginSessionMatchStats(playerSession);
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
  beginSessionMatchStats(playerSession);
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

function keepZombieLateJoinSpectator(session) {
  const room = session?.room;
  if (!isZombieRoom(room)) return false;
  if (zombieModeForRoom(room) < ZOMBIE_MODE.BOSS_INFECTION || session.spawned) return false;
  session.team = -1;
  session.zombieType = ZOMBIE_TYPE.HUMAN;
  session.spawned = false;
  session.dead = true;
  session.moveSeen = false;
  session.moveCount = 0;
  session.waitingSelfSpawnMove = false;
  session.lastTransform = null;
  session.pendingSpawnBroadcast = null;
  clearSpawnStallRecovery(session);
  clearSpawnMoveWarningTimer(session);
  clearSpawnSelfRetryTimers(session);
  console.log(`[zombie] late-join spectator actor=${session.actorId} room=${room.name} mode=${zombieModeForRoom(room)} spawn=deferred-next-round`);
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
  const shellCount = Math.max(1, numberOr(amount, 1));
  return Math.min(fullReloadMs, reloadSingleDurationMs(state) * shellCount);
}

function reloadFirstTickDurationMs(state) {
  const clientSingleReloadMs = reloadSingleDurationMs(state);
  if (String(state?.systemName || "").toLowerCase() !== "sg_remington") {
    return clientSingleReloadMs;
  }
  return Math.min(clientSingleReloadMs, REMINGTON_FIRST_RELOAD_TICK_MS);
}

function isReloadWeaponMode(mode) {
  return mode === WEAPON_MODE.RELOADING || mode === WEAPON_MODE.RELOADING_READY;
}

function shotReadyAt(state) {
  return numberOr(state?.shotStartedAt, 0) + numberOr(state?.shotIntervalMs, shotIntervalMsFromRapidity(state?.rapidity));
}

function isShotReadyWithinSlack(state, now = Date.now()) {
  return Math.max(0, shotReadyAt(state) - now) <= SHOT_THROTTLE_SLACK_MS;
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
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ${reason} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
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
      if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload tick actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} amount=${amount}`);
    }
    completeWeaponReloadState(state, now);
    return;
  }

  if (state.weaponMode === WEAPON_MODE.RELOADING && now >= numberOr(state.reloadReadyAt, now)) {
    setWeaponMode(state, WEAPON_MODE.RELOADING_READY, now);
  }

  if (missing > 0 && reserve > 0) {
    const amount = 1;
    state.loadedAmmo += amount;
    state.ammoReserve -= amount;
    const event = makeReloadUpdateEvent(session, state);
    sendReliableToSession(session, event, channel);
    broadcastReliableToRoom(session, event, channel, "reload", { requireLiveReady: true });
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload tick actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} amount=${amount}`);
  }

  const remainingMs = Math.max(0, numberOr(state.reloadFullUntil, now + fullReloadMs) - now);
  if (remainingMs <= 0) {
    completeWeaponReloadState(state, now);
    return;
  }

  const nextShellMs = Math.min(singleReloadMs, COMPLEX_RELOAD_AMMO_CLIP_MS);
  if (state.loadedAmmo < state.maxLoadedAmmo && state.ammoReserve > 0 && nextShellMs <= remainingMs) {
    scheduleReloadTick(session, state, channel, reloadSeq, nextShellMs);
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
    if (isShotReadyWithinSlack(state, now)) {
      return { ok: true, reason: "shot-slack", intervalMs };
    }
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

function explosionRadiusMultiplierForShooter(shooter, weaponType) {
  const type = Number(weaponType);
  if (
    type === 8
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_ROCKET_RADIUS)
  ) {
    return 1.1;
  }
  if (
    (type === 9 || type === 15)
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_GRENADE_RADIUS)
  ) {
    return 1.1;
  }
  return 1;
}

function explosionDistanceCoefficient(distance, radiusMultiplier = 1) {
  if (!Number.isFinite(distance)) return 1;
  const multiplier = Math.max(0.01, numberOr(radiusMultiplier, 1));
  const fullRadius = DAMAGE_EXPLOSION_FULL_RADIUS * multiplier;
  const zeroRadius = DAMAGE_EXPLOSION_ZERO_RADIUS * multiplier;
  if (distance <= fullRadius) return 1;
  if (distance >= zeroRadius) return 0;
  const span = zeroRadius - fullRadius;
  return Math.max(0, Math.min(1, 1 - (distance - fullRadius) / span));
}

function directEnhancerReductionForTarget(targetSession, shooter, weaponType) {
  let percent = 0;
  const protectionEnhancer = DIRECT_PROTECTION_ENHANCER_BY_WEAPON_TYPE.get(Number(weaponType));
  if (protectionEnhancer && hasSelectedEnhancer(targetSession?.loadedProfile, protectionEnhancer)) {
    percent += 50;
  }
  if (
    shooter === targetSession
    && isProjectileWeaponType(weaponType)
    && hasSelectedEnhancer(targetSession?.loadedProfile, ENHANCER_TYPE.REDUCED_SELF_PROJECTILE_DAMAGE)
  ) {
    percent += 50;
  }
  return clampNumber(percent, 0, 100);
}

function outgoingEnhancerDamagePercent(shooter, targetSession, hitZone) {
  let percent = 0;
  if (
    hitZone === HIT_ZONE_ENGINE
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_NUT_DAMAGE)
  ) {
    percent += 5;
  }
  if (
    isZombiePlayerSession(targetSession)
    && hasSelectedEnhancer(shooter?.loadedProfile, ENHANCER_TYPE.CLAN_ZOMBIE_DAMAGE)
  ) {
    percent += 5;
  }
  return percent;
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

function sessionsAreAllies(shooter, target) {
  if (!shooter || !target || shooter === target) return false;
  if (!hasTeamDamageMode(roomMode(shooter))) return false;
  const shooterTeam = Number(shooter.team);
  const targetTeam = Number(target.team);
  return shooterTeam > 0 && targetTeam > 0 && shooterTeam === targetTeam;
}

function friendlyFireBlocked(shooter, target, weaponType = 0) {
  if (shooter && target && shooter === target) return false;
  if (
    sessionsAreAllies(shooter, target)
    && isProjectileWeaponType(weaponType)
    && hasSelectedEnhancer(target.loadedProfile, ENHANCER_TYPE.CLAN_DISABLE_FRIENDLY_LAUNCHER_DAMAGE)
  ) {
    return true;
  }
  if (!hasTeamDamageMode(roomMode(shooter)) || shooter.room?.friendlyFire) return false;
  return sessionsAreAllies(shooter, target);
}

function recordDamageContribution(targetSession, shooter, amount) {
  const damage = Math.max(0, Math.trunc(numberOr(amount, 0)));
  if (!targetSession || !shooter || shooter === targetSession || damage <= 0) return;
  if (!targetSession.room || targetSession.room !== shooter.room) return;
  targetSession.damageContributors ||= new Map();
  const actorId = Number(shooter.actorId);
  if (!Number.isInteger(actorId) || actorId <= 0) return;
  const previous = targetSession.damageContributors.get(actorId) || { damage: 0, lastAt: 0 };
  targetSession.damageContributors.set(actorId, {
    damage: numberOr(previous.damage, 0) + damage,
    lastAt: Date.now(),
  });
}

function resolveKillAssistant(killer, targetSession) {
  const contributors = targetSession?.damageContributors;
  if (!(contributors instanceof Map) || contributors.size === 0) return null;
  const candidates = Array.from(contributors.entries())
    .filter(([actorId]) => Number(actorId) !== Number(killer?.actorId))
    .map(([actorId, entry]) => ({
      session: targetSession.room?.players?.get(Number(actorId)) || null,
      damage: numberOr(entry?.damage, 0),
      lastAt: numberOr(entry?.lastAt, 0),
    }))
    .filter(({ session }) => {
      if (!session || session.room !== targetSession.room) return false;
      if (!hasTeamDamageMode(roomMode(killer))) return true;
      return Number(session.team) > 0 && Number(session.team) === Number(killer?.team);
    })
    .sort((left, right) => right.damage - left.damage || right.lastAt - left.lastAt);
  return candidates[0]?.session || null;
}

function awardAssistExp(assistant) {
  if (!assistant) return 0;
  return awardBattleExp(assistant, BATTLE_EXP_PER_ASSIST, "assist", {
    eventBonusPercent: hasSelectedEnhancer(assistant.loadedProfile, ENHANCER_TYPE.CLAN_ASSIST_EXP) ? 100 : 0,
    persist: true,
  });
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

function makeKillPlayerEvent(shooter, targetActorId, weaponType, hitZone, impulse, fragInfo = null, assistantActorId = null) {
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
  if (Number.isInteger(Number(assistantActorId)) && Number(assistantActorId) > 0) {
    entries.push({ key: rawByte(47), value: rawInt(Number(assistantActorId)) });
  }
  return rawEvent(95, [
    { key: 254, value: rawInt(shooter.actorId) },
    { key: 245, value: rawHashtable(entries) },
  ]);
}

function kamikazeDistanceCoefficient(distance) {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= ENHANCER_KAMIKAZE_FULL_RADIUS) return 1;
  if (distance >= ENHANCER_KAMIKAZE_ZERO_RADIUS) return 0;
  const span = ENHANCER_KAMIKAZE_ZERO_RADIUS - ENHANCER_KAMIKAZE_FULL_RADIUS;
  return Math.max(0, Math.min(1, 1 - (distance - ENHANCER_KAMIKAZE_FULL_RADIUS) / span));
}

function applyKamikazeExplosion(deadSession, channel = 0) {
  const result = { impactEvents: [], killEvents: [], scoreEvents: [], killedSessions: [], summaries: [] };
  if (!deadSession?.room || !deadSession.dead || deadSession.kamikazeTriggered) return result;
  if (!hasSelectedEnhancer(deadSession.loadedProfile, ENHANCER_TYPE.KAMIKAZE)) return result;
  const origin = deadSession.lastTransform;
  if (!origin) return result;
  deadSession.kamikazeTriggered = true;

  const chainedDeaths = [];
  for (const targetSession of Array.from(deadSession.room.players.values())) {
    if (!targetSession || targetSession === deadSession || !targetSession.spawned || targetSession.dead) continue;
    // The enhancer description explicitly says "surrounding enemies", even in
    // rooms where ordinary friendly fire is enabled.
    if (sessionsAreAllies(deadSession, targetSession)) continue;
    const distance = distanceBetweenPoints(origin, targetSession.lastTransform);
    const coefficient = kamikazeDistanceCoefficient(distance);
    if (coefficient <= 0) continue;

    const targetCurrent = sessionCurrentHealthEnergy(targetSession);
    const range = damageRangeName(distance);
    const protectionKey = "grenade";
    const protection = clampNumber(
      numberOr(targetCurrent.stats.modifiers.protections?.[protectionKey], 0)
        + numberOr(targetCurrent.stats.modifiers.rangeProtections?.[range]?.[protectionKey], 0),
      -DAMAGE_MAX_PROTECTION_PERCENT,
      DAMAGE_MAX_PROTECTION_PERCENT
    );
    const damageReduction = clampNumber(
      targetCurrent.stats.modifiers.damageReductionPercent ?? 0,
      0,
      DAMAGE_MAX_PROTECTION_PERCENT
    );
    const totalDamage = Math.max(0, Math.round(
      ENHANCER_KAMIKAZE_DAMAGE
      * coefficient
      * (1 - protection / 100)
      * (1 - damageReduction / 100)
    ));
    if (totalDamage <= 0) continue;

    const energyDamage = Math.min(targetCurrent.energy, totalDamage);
    const healthDamage = Math.min(targetCurrent.health, Math.max(0, totalDamage - energyDamage));
    targetSession.energy = targetCurrent.energy - energyDamage;
    targetSession.health = targetCurrent.health - healthDamage;
    recordDamageContribution(targetSession, deadSession, healthDamage + energyDamage);
    result.impactEvents.push(makePlayerImpactEvent(
      deadSession,
      targetSession.actorId,
      IMPACT_TYPE.NONE,
      healthDamage,
      energyDamage
    ));
    result.summaries.push(`${targetSession.actorId}:${healthDamage}/${energyDamage}@${formatCaptureDistance(distance)}`);

    if (targetCurrent.health <= 0 || targetSession.health > 0) continue;
    const assistant = resolveKillAssistant(deadSession, targetSession);
    const assistExpAwarded = awardAssistExp(assistant);
    targetSession.dead = true;
    targetSession.waitingSelfSpawnMove = false;
    resetZombieInfectionProgress(targetSession);
    targetSession.deaths = numberOr(targetSession.deaths, 0) + 1;
    targetSession.matchDeaths = numberOr(targetSession.matchDeaths, 0) + 1;
    deadSession.kills = numberOr(deadSession.kills, 0) + 1;
    deadSession.points = numberOr(deadSession.points, 0) + 1;
    deadSession.matchKills = numberOr(deadSession.matchKills, 0) + 1;
    const fragInfo = recordKillFragState(deadSession, targetSession);
    const expAwarded = awardBattleExp(
      deadSession,
      battleExpForKill(deadSession, targetSession),
      "kamikaze-kill",
      battleExpOptionsForKill(deadSession, targetSession)
    );
    const exp2clanAwarded = expAwarded > 0
      ? Math.round(expAwarded * numberOr(deadSession.loadedProfile?.clan?.ek, 0) / 100)
      : 0;

    clearSpawnMoveWarningTimer(targetSession);
    clearSpawnSelfRetryTimers(targetSession);
    clearSessionWeaponReloadTimers(targetSession);
    clearSessionActiveShotLedgers(targetSession);
    clearSessionImpactTimers(targetSession);
    clearPeerSpawnTimers(targetSession);
    clearPickupSpawnRepairTimers(targetSession);
    clearSpawnStallRecovery(targetSession);
    targetSession.damageContributors = new Map();
    targetSession.pendingSpawnBroadcast = null;
    result.killEvents.push(makeKillPlayerEvent(
      deadSession,
      targetSession.actorId,
      203,
      0,
      null,
      fragInfo,
      assistant?.actorId
    ));
    result.killedSessions.push(targetSession);
    chainedDeaths.push(targetSession);
    postBattleEvent(targetSession, "death", {
      health: targetSession.health,
      energy: targetSession.energy,
      killerPlayerId: deadSession.playerId,
      victimPlayerId: targetSession.playerId,
      killerPlayerName: deadSession.playerName,
      victimPlayerName: targetSession.playerName,
      killerActorId: deadSession.actorId,
      victimActorId: targetSession.actorId,
      victimZombieType: numberOr(targetSession.zombieType, 0),
      weaponId: 996,
      weaponType: 203,
      weaponSystemName: "OHCA_Kamikadze",
      hitZone: 0,
      healthDamage,
      energyDamage,
      expAwarded,
      exp2clan: exp2clanAwarded,
      assistantActorId: numberOr(assistant?.actorId, 0),
      assistantPlayerId: assistant?.playerId || "",
      assistExpAwarded,
      fragType: fragInfo?.name || "none",
      domination: fragInfo?.code === KILL_FRAG_TYPE_DOMINATION ? 1 : 0,
      revenge: fragInfo?.code === KILL_FRAG_TYPE_REVENGE ? 1 : 0,
      dominationStreak: numberOr(fragInfo?.dominationStreak, 0),
      revengeStreak: numberOr(fragInfo?.revengeStreak, 0),
    });
  }

  if (result.killEvents.length > 0) {
    result.scoreEvents.push(makeScoreUpdateEvent(deadSession));
  }
  console.log(`[enhancer] kamikaze actor=${deadSession.actorId} damage=${ENHANCER_KAMIKAZE_DAMAGE} radius=${ENHANCER_KAMIKAZE_FULL_RADIUS}/${ENHANCER_KAMIKAZE_ZERO_RADIUS} hits=${result.summaries.join(",") || "none"} kills=${result.killEvents.length}`);
  for (const chainedSession of chainedDeaths) {
    const chained = applyKamikazeExplosion(chainedSession, channel);
    result.impactEvents.push(...chained.impactEvents);
    result.killEvents.push(...chained.killEvents);
    result.scoreEvents.push(...chained.scoreEvents);
    result.killedSessions.push(...chained.killedSessions);
    result.summaries.push(...chained.summaries);
  }
  return result;
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
    expAwarded = awardBattleExp(
      shooter,
      battleExpForKill(shooter, targetSession),
      "zombie-infect",
      battleExpOptionsForKill(shooter, targetSession)
    );
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
  targetSession.damageContributors = new Map();
  targetSession.kamikazeTriggered = false;
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
    victimZombieType: numberOr(targetSession.zombieType, 0),
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
  const enhancerDamagePercent = outgoingEnhancerDamagePercent(effect.shooter, targetSession, 0);
  const totalDamage = Math.max(0, Math.round(
    (requestedDamage / referenceMultiplier) *
    (1 + enhancerDamagePercent / 100) *
    (1 - damageReduction / 100) *
    (1 - enhancerReduction / 100)
  ));
  const energyDamage = Math.min(targetCurrent.energy, totalDamage);
  const healthDamage = Math.min(targetCurrent.health, Math.max(0, totalDamage - energyDamage));
  targetSession.energy = targetCurrent.energy - energyDamage;
  targetSession.health = targetCurrent.health - healthDamage;
  recordDamageContribution(targetSession, effect.shooter, healthDamage + energyDamage);
  return {
    targetCurrent,
    requestedDamage,
    totalDamage,
    healthDamage,
    energyDamage,
    damageReduction,
    enhancerReduction,
    enhancerDamagePercent,
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
  let assistant = null;
  let assistExpAwarded = 0;
  if (targetSession !== shooter) {
    assistant = resolveKillAssistant(shooter, targetSession);
    shooter.kills = numberOr(shooter.kills, 0) + 1;
    shooter.points = numberOr(shooter.points, 0) + 1;
    shooter.matchKills = numberOr(shooter.matchKills, 0) + 1;
    fragInfo = recordKillFragState(shooter, targetSession);
    expAwarded = awardBattleExp(
      shooter,
      battleExpForKill(shooter, targetSession),
      "dot-kill",
      battleExpOptionsForKill(shooter, targetSession)
    );
    exp2clanAwarded = expAwarded > 0 ? Math.round(expAwarded * numberOr(shooter.loadedProfile?.clan?.ek, 0) / 100) : 0;
    assistExpAwarded = awardAssistExp(assistant);
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
  targetSession.damageContributors = new Map();
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
    victimZombieType: numberOr(targetSession.zombieType, 0),
    weaponId: numberOr(effect.weaponId, effect.weaponType),
    weaponType: effect.weaponType,
    weaponSystemName: stringOr(effect.systemName, ""),
    hitZone: 0,
    healthDamage: damage.healthDamage,
    energyDamage: damage.energyDamage,
    expAwarded,
    exp2clan: exp2clanAwarded,
    assistantActorId: numberOr(assistant?.actorId, 0),
    assistantPlayerId: assistant?.playerId || "",
    assistExpAwarded,
    fragType: fragInfo?.name || "none",
    domination: fragInfo?.code === KILL_FRAG_TYPE_DOMINATION ? 1 : 0,
    revenge: fragInfo?.code === KILL_FRAG_TYPE_REVENGE ? 1 : 0,
    dominationStreak: numberOr(fragInfo?.dominationStreak, 0),
    revengeStreak: numberOr(fragInfo?.revengeStreak, 0),
  });
  return makeKillPlayerEvent(
    shooter,
    targetSession.actorId,
    effect.weaponType,
    0,
    null,
    fragInfo,
    assistant?.actorId
  );
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
  console.log(`[event] impact-dot actor=${effect.shooter.actorId} target=${targetSession.actorId} type=${impactTypeName(effect.type)} tick=${effect.tick + 1}/${effect.ticks} dmg=${damage.healthDamage}/${damage.energyDamage} roll=${damage.requestedDamage}/${effect.min}-${effect.max} hp=${targetSession.health}/${damage.targetCurrent.maxHealth} en=${targetSession.energy}/${damage.targetCurrent.stats.maxEnergy} dmgRed=${damage.damageReduction} enhRed=${damage.enhancerReduction} enhDmg=${damage.enhancerDamagePercent} sent=${sent}`);

  if (damage.targetCurrent.health > 0 && targetSession.health <= 0) {
    const killEvent = applyImpactDotKill(effect, targetSession, damage);
    sendImpactDotPayload(effect, killEvent, "kill-dot");
    const kamikaze = applyKamikazeExplosion(targetSession, effect.channel ?? 0);
    for (const impact of kamikaze.impactEvents) {
      sendImpactDotPayload(effect, impact, "impact-kamikaze");
    }
    for (const kill of kamikaze.killEvents) {
      sendImpactDotPayload(effect, kill, "kill-kamikaze");
    }
    for (const score of kamikaze.scoreEvents) {
      sendImpactDotPayload(effect, score, "score-kamikaze");
    }
    const scoreEvent = makeScoreUpdateEvent(effect.shooter);
    const scorePeers = sendImpactDotPayload(effect, scoreEvent, "score");
    console.log(`[sync] impact-dot-kill actor=${effect.shooter.actorId} target=${targetSession.actorId} type=${impactTypeName(effect.type)} scorePeers=${scorePeers} kills=${numberOr(effect.shooter.kills, 0)} deaths=${numberOr(targetSession.deaths, 0)}`);
    gateKilledSessionsAfterDelivery({ killedSessions: [targetSession, ...kamikaze.killedSessions] });
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

  const baseTicks = Math.max(1, numberOr(definition.ticks, IMPACT_DOT_DEFAULT_TICKS));
  const effect = {
    type: definition.type,
    min: numberOr(definition.min, 0),
    max: numberOr(definition.max, definition.min),
    ticks: baseTicks,
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
  if (friendlyFireBlocked(shooter, targetSession, weaponType)) {
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
  if (isColdArmsWeaponType(weaponType) && Number.isFinite(damageDistance) && damageDistance > DAMAGE_MELEE_MAX_DISTANCE) {
    noteAntiCheatWeaponViolation(shooter, "damage", "melee-range", {
      weaponType,
      slot: weaponStateByType(shooter, weaponType)?.slot,
    });
    result.hit = false;
    result.summary = `${targetActorId}:melee-range=${formatCaptureDistance(damageDistance)}>${DAMAGE_MELEE_MAX_DISTANCE}`;
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
  const explosionRadiusMultiplier = explosive ? explosionRadiusMultiplierForShooter(shooter, weaponType) : 1;
  const explosionCoefficient = explosive
    ? explosionDistanceCoefficient(originDistance ?? actorDistance, explosionRadiusMultiplier)
    : 1;
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
  const enhancerReduction = directEnhancerReductionForTarget(targetSession, shooter, weaponType);
  const enhancerDamagePercent = outgoingEnhancerDamagePercent(shooter, targetSession, hitZone);
  const totalDamage = Math.max(0, Math.round(
    baseDamage *
    explosionCoefficient *
    hitZoneMultiplier(hitZone) *
    (1 + headDamageBonus / 100) *
    (1 + enhancerDamagePercent / 100) *
    (crit ? DAMAGE_CRIT_MULTIPLIER : 1) *
    (1 - protection / 100) *
    (1 - damageReduction / 100) *
    (1 - enhancerReduction / 100)
  ));

  const energyDamage = Math.min(targetCurrent.energy, totalDamage);
  const healthDamage = Math.min(targetCurrent.health, Math.max(0, totalDamage - energyDamage));
  targetSession.energy = targetCurrent.energy - energyDamage;
  targetSession.health = targetCurrent.health - healthDamage;
  recordDamageContribution(targetSession, shooter, healthDamage + energyDamage);

  result.energyDamage = energyDamage;
  result.healthDamage = healthDamage;
  result.crit = crit && totalDamage > 0;
  result.summary = `${targetActorId}:dmg=${healthDamage}/${energyDamage}:hp=${targetSession.health}/${targetCurrent.maxHealth}:en=${targetSession.energy}/${targetCurrent.stats.maxEnergy}:range=${range}:dist=${formatCaptureDistance(damageDistance)}:roll=${baseDamage}/${minDamage}-${maxDamage}:headDmg=${headDamageBonus}:enhDmg=${enhancerDamagePercent}:radius=${explosionRadiusMultiplier}:prot=${protectionKey}:${protection}:rangeProt=${rangeProtection}:dmgRed=${damageReduction}:enhRed=${enhancerReduction}:crit=${result.crit ? 1 : 0}:${critChance}`;

  if (targetCurrent.health > 0 && targetSession.health <= 0) {
    targetSession.dead = true;
    targetSession.waitingSelfSpawnMove = false;
    resetZombieInfectionProgress(targetSession);
    targetSession.deaths = numberOr(targetSession.deaths, 0) + 1;
    targetSession.matchDeaths = numberOr(targetSession.matchDeaths, 0) + 1;
    let expAwarded = 0;
    let exp2clanAwarded = 0;
    let fragInfo = null;
    let assistant = null;
    let assistExpAwarded = 0;
    if (targetSession !== shooter) {
      assistant = resolveKillAssistant(shooter, targetSession);
      shooter.kills = numberOr(shooter.kills, 0) + 1;
      shooter.points = numberOr(shooter.points, 0) + 1;
      shooter.matchKills = numberOr(shooter.matchKills, 0) + 1;
      if (hitZone === HIT_ZONE_CABIN) shooter.matchHeadKills = numberOr(shooter.matchHeadKills, 0) + 1;
      if (hitZone === HIT_ZONE_ENGINE) shooter.matchNutsKills = numberOr(shooter.matchNutsKills, 0) + 1;
      fragInfo = recordKillFragState(shooter, targetSession);
      expAwarded = awardBattleExp(
        shooter,
        battleExpForKill(shooter, targetSession),
        "kill",
        battleExpOptionsForKill(shooter, targetSession)
      );
      exp2clanAwarded = expAwarded > 0 ? Math.round(expAwarded * numberOr(shooter.loadedProfile?.clan?.ek, 0) / 100) : 0;
      assistExpAwarded = awardAssistExp(assistant);
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
    targetSession.damageContributors = new Map();
    targetSession.pendingSpawnBroadcast = null;
    const impulse = shotImpulseVector(data, shooter, targetSession);
    result.killed = true;
    result.killedSession = targetSession;
    result.killEvent = makeKillPlayerEvent(
      shooter,
      targetActorId,
      weaponType,
      hitZone,
      impulse,
      fragInfo,
      assistant?.actorId
    );
    result.summary += `:kill=1:exp=${expAwarded}:assistant=${assistant?.actorId || 0}:assistExp=${assistExpAwarded}:frag=${fragInfo?.name || "none"}`;
    postBattleEvent(targetSession, "death", {
      health: targetSession.health,
      energy: targetSession.energy,
      killerPlayerId: shooter.playerId,
      victimPlayerId: targetSession.playerId,
      killerPlayerName: shooter.playerName,
      victimPlayerName: targetSession.playerName,
      killerActorId: shooter.actorId,
      victimActorId: targetSession.actorId,
      victimZombieType: numberOr(targetSession.zombieType, 0),
      weaponId: numberOr(damageState?.weaponId, weaponType),
      weaponType,
      weaponSystemName: stringOr(damageState?.systemName, ""),
      hitZone,
      healthDamage,
      energyDamage,
      expAwarded,
      exp2clan: exp2clanAwarded,
      assistantActorId: numberOr(assistant?.actorId, 0),
      assistantPlayerId: assistant?.playerId || "",
      assistExpAwarded,
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
  const enhancerScoreEvents = [];
  const killedSessions = new Set();
  const kamikazeCandidates = new Set();
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
        if (damage.killedSession) {
          killedSessions.add(damage.killedSession);
          kamikazeCandidates.add(damage.killedSession);
        }
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
      // Apply death explosions only after every direct target in this Shot97 has
      // been resolved, so target-array order cannot change direct damage/assists.
      for (const deadSession of kamikazeCandidates) {
        const kamikaze = applyKamikazeExplosion(deadSession, session.lastChannel || 0);
        impactEvents.push(...kamikaze.impactEvents);
        killEvents.push(...kamikaze.killEvents);
        enhancerScoreEvents.push(...kamikaze.scoreEvents);
        for (const killedSession of kamikaze.killedSessions) killedSessions.add(killedSession);
        if (kamikaze.killEvents.length || kamikaze.impactEvents.length) {
          summaries.push(`kamikaze:${deadSession.actorId}=${kamikaze.impactEvents.length}/${kamikaze.killEvents.length}`);
        }
      }
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
    enhancerScoreEvents,
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
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] shot blocked actor=${session?.actorId ?? "?"} type=${weaponType} mode=${launchMode} reason=not-live`);
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
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] shot blocked actor=${session.actorId} type=${weaponType} mode=${launchMode} reason=${gate.reason}${gate.waitMs ? ` wait=${gate.waitMs}ms` : ""}`);
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
  runtimeMetrics.shots += 1;
  if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] shot actor=${session.actorId} type=${weaponType} mode=${launchMode}${ammo}${describeShotTargets(data)}${describeShotDamageContext(session, data, state)}${describeProjectileLaunchPayloadKeys(data, weaponType, launchMode)}${response.summary}`);
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
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] weapon-change ignored actor=${session?.actorId ?? "?"} reason=not-live`);
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
  if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] weapon-change actor=${session.actorId}${describeWeaponEventData(data)}${state ? ` name=${state.systemName}` : ""}`);
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
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ignored actor=${session?.actorId ?? "?"} missingType=${requestedType} reason=not-live`);
    return null;
  }
  if (isZombiePlayerSession(session)) {
    console.log(`[zombie] reload ignored actor=${session.actorId} type=${requestedType} reason=zombie-hand-only`);
    return null;
  }
  const state = weaponStateByType(session, requestedType);
  if (!state) {
    noteAntiCheatWeaponViolation(session, "reload", "missing-weapon", { weaponType: requestedType });
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ignored actor=${session.actorId} missingType=${requestedType}`);
    return null;
  }

  if (isColdArmsWeaponType(state.type)) {
    noteAntiCheatWeaponViolation(session, "reload", "cold-arms", { weaponType: requestedType, slot: state.slot });
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=cold-arms`);
    return null;
  }

  const missing = Math.max(0, state.maxLoadedAmmo - state.loadedAmmo);
  const reserve = Math.max(0, state.ammoReserve);
  const amount = Math.min(missing, reserve);
  if (amount <= 0) {
    noteAntiCheatWeaponViolation(session, "reload", "full-or-empty", { weaponType: requestedType, slot: state.slot });
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=full-or-empty loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
    return null;
  }

  const now = Date.now();
  const weaponMode = refreshWeaponMode(state, now);
  if (weaponMode === WEAPON_MODE.RELOADING) {
    noteAntiCheatWeaponViolation(session, "reload", "already-reloading", { weaponType: requestedType, slot: state.slot });
    if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload ignored actor=${session.actorId} slot=${state.slot} type=${state.type} reason=already-reloading loaded=${state.loadedAmmo} reserve=${state.ammoReserve}`);
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
  state.reloadReadyAt = isComplexReloadWeaponState(state) ? now + reloadFirstTickDurationMs(state) : 0;
  state.reloadFullUntil = now + reloadDurationForAmountMs(state, amount);
  setWeaponMode(state, WEAPON_MODE.RELOADING, now);
  const firstTickMs = isComplexReloadWeaponState(state)
    ? Math.min(reloadFirstTickDurationMs(state), numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs)))
    : numberOr(state.reloadDurationMs, reloadDurationMsFromRaw(state.reloadTimeMs));
  scheduleReloadTick(session, state, channel, state.reloadSeq, firstTickMs);
  if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] reload start actor=${session.actorId} slot=${state.slot} type=${state.type} loaded=${state.loadedAmmo} reserve=${state.ammoReserve} first=${firstTickMs}ms ready=${Math.max(0, numberOr(state.reloadReadyAt, 0) - now)}ms full=${state.reloadFullUntil - now}ms complex=${isComplexReloadWeaponState(state) ? 1 : 0}`);
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

function roomPlayableOccupancy(room) {
  if (!room?.players) return 0;
  let count = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession?.isGuest) count += 1;
  }
  return count;
}

function roomListData(room) {
  const users = roomPlayableOccupancy(room);
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
    if (roomPlayableOccupancy(room) <= 0) continue;
    entries.push({
      key: rawString(room.name),
      value: rawStringArray(roomListData(room)),
    });
  }
  return rawHashtable(entries);
}

function roomListSummary() {
  return Array.from(rooms.values())
    .filter((room) => room?.name && roomPlayableOccupancy(room) > 0)
    .map((room) => `${room.name}:${room.map}:${roomPlayableOccupancy(room)}/${room.maxUsers || 8}`)
    .join(",") || "empty";
}

function makeRoomListEvent(session) {
  return rawEvent(252, [
    { key: 254, value: rawInt(session?.actorId || 0) },
    { key: 245, value: makeRoomListRaw() },
  ]);
}

function pushRoomListToLobbySessions(reason = "room-list", channel = 0) {
  let sent = 0;
  for (const session of sessions.values()) {
    if (!session?.listLobby) continue;
    if (!session.socket || !session.rinfo) continue;
    if (sendReliablePayload(session.socket, session.rinfo, session, makeRoomListEvent(session), channel)) sent += 1;
  }
  if (sent > 0) console.log(`[event] room list live push reason=${reason} sessions=${sent} rooms=${roomListSummary()}`);
  return sent;
}

function scheduleRoomListPush(reason = "room-list", channel = 0) {
  roomListPushReasons.add(String(reason || "room-list"));
  roomListPushChannel = normalizeChannelId(channel, 0);
  if (roomListPushTimer) return;
  roomListPushTimer = setTimeout(() => {
    roomListPushTimer = null;
    const reasons = Array.from(roomListPushReasons);
    roomListPushReasons.clear();
    pushRoomListToLobbySessions(`coalesced:${reasons.join("+") || "room-list"}`, roomListPushChannel);
  }, ROOM_LIST_COALESCE_MS);
  roomListPushTimer.unref?.();
}

function roomSettingsCompatible(room, mapName, mode) {
  if (!room) return false;
  const roomModeValue = Number(room.mode || 1);
  const requestedModeValue = Number(mode || 1);
  return mapKey(room.map) === mapKey(mapName) && roomModeValue === requestedModeValue;
}

function roomPasswordMatches(room, suppliedPassword) {
  const expected = String(room?.password || "");
  if (!expected) return true;
  return String(suppliedPassword || "") === expected;
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
      maxUsers: maxUsersForRoomMode(normalizedMode, settings.maxUsers),
      friendlyFire: settings.friendlyFire || false,
      timeLimit: settings.timeLimit || 10,
      fragLimit: settings.fragLimit || 50,
      lvlMin: settings.lvlMin || 1,
      lvlMax: settings.lvlMax || 50,
      password: settings.password || "",
      guestMode: settings.guestMode || 0,
      startedAt: photonNow(),
      players: new Map(),
      kickVote: null,
      kickVoteAuthorization: null,
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
      expedition: null,
    });
  } else {
    const room = rooms.get(name);
    if (room.players.size === 0 && settings.hasFullSettings !== false) {
      clearZombieTimers(room);
      room.map = settings.map || room.map || DEFAULT_MAP;
      room.mode = normalizeModeForMap(room.map, mode);
      room.maxUsers = maxUsersForRoomMode(room.mode, settings.maxUsers || room.maxUsers);
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
      room.expedition = null;
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
    for (const channelState of session.inboundReliableChannels?.values?.() || []) {
      for (const request of channelState.pending?.values?.() || []) {
        request.reject?.(new Error(`reliable generation reset reason=${reason}`));
      }
    }
    session.inboundReliableChannels = new Map();
    session.reliableReplayLogState = new Map();
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
    if (!playerSession.spawned || ![ZOMBIE_TEAM, HUMAN_TEAM].includes(Number(playerSession.team))) continue;
    const won = Number(playerSession.team || 0) === normalizedWinner;
    if (postSessionBattleSummary(playerSession, reason, { won, eventData: { roundWinner: normalizedWinner } })) posted += 1;
  }
  return posted;
}

function resetSessionRoomProgress(session) {
  if (!session) return;
  session.isGuest = false;
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
  session.damageContributors = new Map();
  session.kamikazeTriggered = false;
  resetSessionFragState(session);
  clearSessionActiveShotLedgers(session);
  session.team = -1;
  session.zombieType = ZOMBIE_TYPE.HUMAN;
  session.lastTransform = null;
  clearStaffFlightState(session, "room-reset");
  session.pendingSpawnBroadcast = null;
  session.pendingPickupSync = null;
  resetSessionMatchStats(session);
  clearOutboundReliableState(session);
}

function deleteEmptyRoom(room, reason = "empty") {
  if (!room?.name || (room.players?.size || 0) > 0) return false;
  if (rooms.get(room.name) !== room) return false;
  clearZombieTimers(room);
  if (room.expeditionReservationTimer) {
    clearTimeout(room.expeditionReservationTimer);
    room.expeditionReservationTimer = null;
  }
  rooms.delete(room.name);
  console.log(`[state] empty room deleted reason=${reason} room=${room.name} map=${room.map || DEFAULT_MAP}`);
  scheduleRoomListPush(`delete-${reason}`);
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

function existingRoomForJoin(settings) {
  const room = rooms.get(settings?.name || DEFAULT_ROOM);
  if (!room) return null;
  if (
    (room.players?.size || 0) > 0 &&
    settings?.hasFullSettings !== false &&
    !roomSettingsCompatible(room, settings.map || DEFAULT_MAP, normalizeModeForMap(settings.map || DEFAULT_MAP, Number(settings.mode ?? 1)))
  ) {
    return null;
  }
  return room;
}

function roomOccupancyForJoin(room, playerId, joiningSession) {
  if (!room?.players) return 0;
  const normalizedPlayerId = Number(playerId || 0);
  let count = 0;
  for (const playerSession of room.players.values()) {
    if (playerSession === joiningSession) continue;
    if (normalizedPlayerId > 0 && Number(playerSession?.playerId || 0) === normalizedPlayerId) continue;
    if (playerSession?.isGuest) continue;
    count += 1;
  }
  return count;
}

function roomHasCapacityForJoin(room, playerId, joiningSession) {
  if (!room) return true;
  const maxUsers = Math.max(1, Number(room.maxUsers || 8));
  return roomOccupancyForJoin(room, playerId, joiningSession) < maxUsers;
}

function sameAuthenticatedCcid(left, right) {
  if (!left || !right || left === right) return false;
  const leftId = Number(left.playerId || 0);
  const rightId = Number(right.playerId || 0);
  return Number.isFinite(leftId) && leftId > 0 && leftId === rightId;
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
  // The Unity AI host may leave mid-wave. Transfer authority only after the
  // actor is removed, so election is deterministically the lowest active id.
  if (room.expedition && room.expedition.phase !== "finished" && Number(room.expedition.authorityActorId || 0) === Number(actorId)) {
    publishExpeditionAiAuthority(room, room.expedition, options.channel || 0);
  }
  cancelRoomKickVoteForDeparture(room, actorId, options.channel || 0, reason);
  forgetActorForRoom(room, actorId);
  maybeFinishZombieRound(room, `leave-${reason}`, options.channel || 0);
  if (options.postSummary !== false) postSessionBattleSummary(playerSession, reason);
  resetSessionRoomProgress(playerSession);
  if (playerSession.room === room) playerSession.room = null;
  console.log(`[state] room player removed reason=${reason} room=${room.name} map=${room.map || DEFAULT_MAP} actor=${actorId} player=${playerSession.playerId || "unknown"} peers=${peers}`);
  broadcastMasterUserState(playerSession.playerId);
  const deleted = deleteEmptyRoom(room, reason);
  if (!deleted) scheduleRoomListPush(`leave-${reason}`, options.channel || 0);
  return true;
}

function detachSessionFromRoom(session, reason = "leave") {
  removeExpeditionPartyMember(session, `detach-${reason}`, session?.lastChannel || 0);
  removeExpeditionSoloMatchmakingSession(session, `detach-${reason}`, session?.lastChannel || 0);
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
  clearSessionUdpOutbox(session);
  detachSessionFromRoom(session, reason);
  resetReliableDedupe(session, reason, { bumpGeneration: true });
  clearOutboundReliableState(session);
  session.transportGeneration = session.reliableGeneration;
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
  session.damageContributors = new Map();
  session.kamikazeTriggered = false;
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
  const candidates = new Set(sessions.values());
  for (const room of Array.from(rooms.values())) {
    if (!room?.players) continue;
    for (const playerSession of room.players.values()) candidates.add(playerSession);
  }

  let removedActors = 0;
  let removedSessions = 0;
  for (const candidate of candidates) {
    if (!sameAuthenticatedCcid(candidate, session)) continue;
    if (candidate.isMasterSession) continue;
    if (!isBattleListSession(candidate)) continue;
    candidate.joinAttemptGeneration = (candidate.joinAttemptGeneration || 0) + 1;
    candidate.transportDisconnected = true;
    for (const room of Array.from(rooms.values())) {
      if (!room?.players) continue;
      for (const [actorId, playerSession] of Array.from(room.players.entries())) {
        if (playerSession !== candidate) continue;
        if (removeRoomPlayer(room, actorId, candidate, reason, { broadcastReason: "stale-leave" })) {
          removedActors += 1;
        }
      }
    }
    clearOutboundReliableState(candidate);
    resetReliableDedupe(candidate, reason, { bumpGeneration: true });
    candidate.transportGeneration = candidate.reliableGeneration;
    for (const [sessionId, mappedSession] of Array.from(sessions.entries())) {
      if (mappedSession === candidate) deleteFullSession(sessionId, candidate);
    }
    candidate.sessionId = null;
    candidate.socket = null;
    candidate.rinfo = null;
    removedSessions += 1;
  }
  if (removedSessions > 0) {
    console.log(`[state] duplicate ccid cleanup player=${session.playerId || "unknown"} sessions=${removedSessions} actors=${removedActors}`);
  }
  return removedSessions;
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
        if (playerSession.sessionId) deleteFullSession(playerSession.sessionId, playerSession);
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
      if (session?.sessionId) deleteFullSession(session.sessionId, session);
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

function chatRequestData(parsed) {
  if (parsed?.opCode === 253) return eventDataHash(parsed);
  return null;
}

function chatRequestText(parsed) {
  const data = chatRequestData(parsed);
  const value = data ? htGet(data, 77)?.value : parsed?.params?.get(77)?.value;
  return String(value ?? "").trim();
}

function chatRequestType(parsed) {
  const data = chatRequestData(parsed);
  const value = data ? htGet(data, 80)?.value : parsed?.params?.get(80)?.value;
  const type = Number(value ?? 253);
  return Number.isFinite(type) ? (type & 0xff) : 253;
}

function decodeStaffReason(value) {
  const encoded = String(value || "");
  if (!encoded || encoded.length > STAFF_REASON_MAX_LENGTH * 12) return "";
  try {
    return decodeURIComponent(encoded.replace(/\+/g, "%20"))
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, STAFF_REASON_MAX_LENGTH);
  } catch {
    return "";
  }
}

function parseStaffChatCommand(message) {
  const text = String(message || "").trim();
  const prefix = "/__staff ";
  if (!text.startsWith(prefix)) return null;
  const tokens = text.slice(prefix.length).trim().split(/\s+/);
  const action = String(tokens.shift() || "").toLowerCase();
  if (action === "kick" && tokens.length === 2) {
    const targetPlayerId = Number(tokens[0]);
    const reason = decodeStaffReason(tokens[1]);
    if (Number.isInteger(targetPlayerId) && targetPlayerId > 0 && reason) {
      return { action, targetPlayerId, durationMinutes: 0, reason };
    }
  }
  if (action === "ban" && tokens.length === 3) {
    const targetPlayerId = Number(tokens[0]);
    const durationMinutes = Number(tokens[1]);
    const reason = decodeStaffReason(tokens[2]);
    if (
      Number.isInteger(targetPlayerId) &&
      targetPlayerId > 0 &&
      Number.isInteger(durationMinutes) &&
      durationMinutes >= 0 &&
      durationMinutes <= 5256000 &&
      reason
    ) {
      return { action, targetPlayerId, durationMinutes, reason };
    }
  }
  return { action: "invalid", targetPlayerId: 0, durationMinutes: 0, reason: "" };
}

function moderationRoleFromResult(result, side) {
  if (!result || typeof result !== "object") return null;
  const raw = side === "actor"
    ? (result.actorRole ?? result.sourceRole ?? result.moderatorRole ?? result.actor?.role ?? result.source?.role)
    : (result.targetRole ?? result.target?.role);
  return raw == null ? null : normalizeStaffRole(raw);
}

async function requestStaffActionApproval(sourceSession, targetPlayerId, action, reason, durationMinutes = 0, targetSession = null, options = {}) {
  if (!API_BASE_URL || !API_TOKEN) return { ok: false, error: "staff-service-unavailable" };
  if (Number(sourceSession.playerId) === Number(targetPlayerId)) return { ok: false, error: "staff-self-target" };
  const minimumRole = normalizeStaffRole(options.minimumRole || (action === "ban" ? "admin" : "helper"));
  const authorizeOnly = options.authorizeOnly === true;
  try {
    const result = await postApiJson("/battle/admin/action", {
      action,
      actorPlayerId: Number(sourceSession.playerId),
      targetPlayerId: Number(targetPlayerId),
      durationMinutes: action === "ban" ? Number(durationMinutes) : 0,
      reason: String(reason || "").slice(0, STAFF_REASON_MAX_LENGTH),
      roomName: String(sourceSession.room?.name || ""),
      mapName: String(sourceSession.room?.map || ""),
      minimumRole,
      source: String(options.source || "battle").slice(0, 40),
      ...(authorizeOnly ? { authorizeOnly: true } : {}),
    });
    if (!result || result.ok !== true) return { ok: false, error: String(result?.error || "staff-action-denied") };

    const actorRole = moderationRoleFromResult(result, "actor");
    const targetRole = moderationRoleFromResult(result, "target");
    if (actorRole) {
      sourceSession.staffRole = actorRole;
      sourceSession.staffRank = staffRoleRank(actorRole);
    }
    if (targetSession && targetRole) {
      targetSession.staffRole = targetRole;
      targetSession.staffRank = staffRoleRank(targetRole);
    }
    if (actorRole && staffRoleRank(actorRole) < staffRoleRank(minimumRole)) {
      return { ok: false, error: "staff-role-required" };
    }
    if (actorRole && targetRole && staffRoleRank(actorRole) <= staffRoleRank(targetRole)) {
      return { ok: false, error: "staff-target-protected" };
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message || "staff-action-failed") };
  }
}

function makeModerationDisconnectEvent(targetSession, action = "kick") {
  const disconnectData = String(action || "kick").toLowerCase() === "ban"
    ? [{ key: rawByte(1), value: rawByte(1) }]
    : [];
  return rawEvent(104, [
    { key: 254, value: rawInt(targetSession?.actorId || 0) },
    { key: 245, value: rawHashtable(disconnectData) },
  ]);
}

function scheduleModerationDisconnect(targetSession, action, sourceSession, reason, channel = 0) {
  if (!targetSession || targetSession.transportDisconnected || targetSession.moderationDisconnectPending) return false;
  targetSession.moderationDisconnectPending = true;
  targetSession.moderationDisconnectAction = String(action || "kick");
  targetSession.moderationDisconnectBy = Number(sourceSession?.playerId || 0);
  targetSession.moderationDisconnectReason = String(reason || "").slice(0, STAFF_REASON_MAX_LENGTH);
  sendReliableToSession(
    targetSession,
    makeModerationDisconnectEvent(targetSession, targetSession.moderationDisconnectAction),
    channel,
  );
  const timer = setTimeout(() => {
    if (targetSession.transportDisconnected) return;
    flushSessionUdpOutbox(targetSession);
    expireTransportSession(targetSession, `staff-${targetSession.moderationDisconnectAction}`);
  }, STAFF_DISCONNECT_GRACE_MS);
  timer.unref?.();
  console.log(`[staff] disconnect scheduled action=${targetSession.moderationDisconnectAction} by=${targetSession.moderationDisconnectBy} target=${targetSession.playerId || 0} actor=${targetSession.actorId || 0} role=${normalizeStaffRole(targetSession.staffRole)} grace=${STAFF_DISCONNECT_GRACE_MS}ms`);
  return true;
}

function activeSessionsForPlayerId(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return [];
  return Array.from(new Set(sessions.values())).filter((candidate) => (
    candidate &&
    !candidate.transportDisconnected &&
    Number(candidate.playerId || 0) === id
  ));
}

async function handleStaffChatCommand(session, command, channel = 0) {
  if (!command || command.action === "invalid") {
    console.log(`[staff] command rejected player=${session?.playerId || 0} reason=invalid-command`);
    return [];
  }
  const targetSession = roomSessionByPlayerId(session.room, command.targetPlayerId)
    || activeSessionsForPlayerId(command.targetPlayerId)[0]
    || null;
  if (
    Number(session.playerId) === Number(command.targetPlayerId) ||
    !["kick", "ban"].includes(command.action)
  ) {
    console.log(`[staff] command rejected action=${command.action} by=${session.playerId || 0} target=${command.targetPlayerId} role=${normalizeStaffRole(session.staffRole)} targetRole=${normalizeStaffRole(targetSession?.staffRole)} reason=rbac`);
    return [];
  }
  if (command.action === "kick" && (!targetSession || targetSession.room !== session.room)) {
    console.log(`[staff] command rejected action=kick by=${session.playerId || 0} target=${command.targetPlayerId} reason=not-in-room`);
    return [];
  }

  const approval = await requestStaffActionApproval(
    session,
    command.targetPlayerId,
    command.action,
    command.reason,
    command.durationMinutes,
    targetSession,
    {
      minimumRole: command.action === "ban" ? "admin" : "moderator",
      source: "panel",
    },
  );
  if (!approval.ok) {
    console.log(`[staff] command denied action=${command.action} by=${session.playerId || 0} target=${command.targetPlayerId} reason=${approval.error}`);
    return [];
  }
  if (command.action === "ban") {
    invalidatePlayerProfileCache(command.targetPlayerId);
  }

  const targets = command.action === "ban"
    ? activeSessionsForPlayerId(command.targetPlayerId)
    : [targetSession];
  let disconnected = 0;
  for (const target of targets) {
    if (scheduleModerationDisconnect(target, command.action, session, command.reason, channel)) disconnected += 1;
  }
  console.log(`[staff] command accepted action=${command.action} by=${session.playerId || 0} role=${normalizeStaffRole(session.staffRole)} target=${command.targetPlayerId} duration=${command.durationMinutes || 0} disconnected=${disconnected}`);
  return [];
}

function kickVoteReasonName(reasonCode) {
  return KICK_VOTE_REASON_NAMES[Number(reasonCode)] || "unknown";
}

function makeKickVoteEvent(sourceSession, targetSession, options = {}) {
  const yes = Math.max(0, Number(options.yes || 0));
  const no = Math.max(0, Number(options.no || 0));
  const entries = [
    { key: rawByte(1), value: rawInt(targetSession.playerId) },
    { key: rawByte(5), value: rawInt(targetSession.actorId) },
    { key: rawByte(6), value: rawInt(yes) },
    { key: rawByte(7), value: rawInt(no) },
  ];
  if (options.reasonCode != null) {
    entries.push(
      { key: rawByte(9), value: rawByte(options.reasonCode) },
      { key: rawByte(10), value: rawString(stringOr(targetSession.playerName, `Player ${targetSession.playerId}`)) },
      { key: rawByte(11), value: rawString(stringOr(sourceSession.playerName, `Player ${sourceSession.playerId}`)) },
    );
  } else if (options.result != null) {
    entries.push({ key: rawByte(2), value: rawBool(options.result) });
  }
  return rawEvent(70, [
    { key: 254, value: rawInt(sourceSession.actorId || 0) },
    { key: 245, value: rawHashtable(entries) },
  ]);
}

function makeInstantKickEvent(sourceSession, targetSession, result = null) {
  return makeKickVoteEvent(sourceSession, targetSession, result == null
    ? { yes: 1, no: 0, reasonCode: 4 }
    : { yes: 1, no: 0, result });
}

function kickVoteCounts(vote) {
  let yes = 0;
  let no = 0;
  for (const ballot of vote.votes.values()) {
    if (ballot === true) yes += 1;
    else no += 1;
  }
  return { yes, no };
}

function kickVoteEligibleActors(room, targetActorId) {
  const eligible = new Set();
  for (const [actorId, candidate] of room?.players?.entries?.() || []) {
    const normalizedActorId = Number(actorId || 0);
    if (
      normalizedActorId <= 0 ||
      normalizedActorId === Number(targetActorId) ||
      !candidate ||
      candidate.isGuest ||
      candidate.transportDisconnected ||
      candidate.moderationDisconnectPending ||
      !staffHasCapability(candidate, "kick")
    ) {
      continue;
    }
    eligible.add(normalizedActorId);
  }
  return eligible;
}

function broadcastKickVoteToPeers(sourceSession, payload, channel = 0, room = sourceSession?.room) {
  let sent = 0;
  for (const peer of room?.players?.values?.() || []) {
    if (!peer || peer === sourceSession) continue;
    if (sendReliableToSession(peer, payload, channel)) sent += 1;
  }
  return sent;
}

function broadcastKickVoteToRoom(room, payload, channel = 0) {
  let sent = 0;
  for (const peer of room?.players?.values?.() || []) {
    if (!peer) continue;
    if (sendReliableToSession(peer, payload, channel)) sent += 1;
  }
  return sent;
}

function clearRoomKickVoteTimer(vote) {
  if (!vote?.timer) return;
  clearTimeout(vote.timer);
  vote.timer = null;
}

async function finishRoomKickVote(vote, requestedAccepted, channel = 0, reason = "threshold") {
  const room = vote?.room;
  if (!room || room.kickVote !== vote || vote.resolving) return null;
  vote.resolving = true;

  const sourceSession = room.players.get(vote.starterActorId);
  const targetSession = room.players.get(vote.targetActorId);
  let accepted = requestedAccepted === true;
  let denialReason = "";
  if (
    accepted &&
    sourceSession === vote.sourceSession &&
    targetSession === vote.targetSession &&
    sourceSession.room === room &&
    targetSession.room === room
  ) {
    const actionReason = `vote-${kickVoteReasonName(vote.reasonCode)}`;
    const approval = await requestStaffActionApproval(
      sourceSession,
      vote.targetPlayerId,
      "kick",
      actionReason,
      0,
      targetSession,
      { minimumRole: "helper", source: "event70" },
    );
    accepted = approval.ok === true;
    denialReason = approval.ok ? "" : approval.error;
  } else if (accepted) {
    accepted = false;
    denialReason = "participant-left";
  }

  clearRoomKickVoteTimer(vote);
  if (room.kickVote === vote) room.kickVote = null;
  const counts = kickVoteCounts(vote);
  const resultEvent = makeKickVoteEvent(
    sourceSession || vote.sourceSession,
    targetSession || vote.targetSession,
    { ...counts, result: accepted },
  );
  if (accepted) {
    scheduleModerationDisconnect(
      targetSession,
      "kick",
      sourceSession,
      `vote-${kickVoteReasonName(vote.reasonCode)}`,
      channel,
    );
  }
  console.log(`[staff] event70 vote result room=${room.name} by=${vote.starterPlayerId} target=${vote.targetPlayerId}/${vote.targetActorId} reason=${kickVoteReasonName(vote.reasonCode)} yes=${counts.yes} no=${counts.no} threshold=${vote.threshold} accepted=${accepted ? "yes" : "no"} finish=${reason}${denialReason ? ` denial=${denialReason}` : ""}`);
  return resultEvent;
}

function scheduleRoomKickVoteExpiry(vote, channel = 0) {
  vote.timer = setTimeout(() => {
    const counts = kickVoteCounts(vote);
    finishRoomKickVote(vote, counts.yes >= vote.threshold, channel, "timeout")
      .then((payload) => {
        if (payload) broadcastKickVoteToRoom(vote.room, payload, channel);
      })
      .catch((error) => {
        console.log(`[staff] event70 vote timeout failed room=${vote.room?.name || "unknown"} ${error.message}`);
      });
  }, KICK_VOTE_DURATION_MS);
  vote.timer.unref?.();
}

function cancelRoomKickVoteForDeparture(room, actorId, channel = 0, reason = "leave") {
  const vote = room?.kickVote;
  const normalizedActorId = Number(actorId || 0);
  if (
    !vote ||
    vote.resolving ||
    (normalizedActorId !== vote.starterActorId && normalizedActorId !== vote.targetActorId)
  ) {
    return false;
  }
  vote.resolving = true;
  clearRoomKickVoteTimer(vote);
  room.kickVote = null;
  const counts = kickVoteCounts(vote);
  const resultEvent = makeKickVoteEvent(vote.sourceSession, vote.targetSession, { ...counts, result: false });
  broadcastKickVoteToRoom(room, resultEvent, channel);
  console.log(`[staff] event70 vote cancelled room=${room.name} target=${vote.targetPlayerId}/${vote.targetActorId} actor=${normalizedActorId} reason=${reason}`);
  return true;
}

async function handleRoomKickVoteStartRequest(session, data, channel = 0) {
  const targetPlayerId = Number(htGet(data, 1)?.value || 0);
  const targetActorId = Number(htGet(data, 5)?.value || 0);
  const reasonCode = Number(htGet(data, 9)?.value || 0);
  const room = session?.room;
  if (
    !KICK_VOTE_REASON_NAMES[reasonCode] ||
    !Number.isInteger(targetPlayerId) ||
    targetPlayerId <= 0 ||
    !Number.isInteger(targetActorId) ||
    targetActorId <= 0 ||
    !Number.isInteger(Number(session?.actorId || 0)) ||
    Number(session.actorId) <= 0
  ) {
    console.log(`[staff] event70 vote rejected by=${session?.playerId || 0} reason=contract`);
    return [];
  }
  const targetSession = room?.players?.get(targetActorId);
  if (!targetSession || Number(targetSession.playerId) !== targetPlayerId) {
    console.log(`[staff] event70 vote rejected by=${session?.playerId || 0} target=${targetPlayerId}/${targetActorId} reason=identity-mismatch`);
    return [];
  }
  if (!cachedStaffCanModerate(session, targetSession, "kick")) {
    console.log(`[staff] event70 vote rejected by=${session?.playerId || 0} target=${targetPlayerId} reason=rbac`);
    return [];
  }
  if (room.kickVote || room.kickVoteAuthorization) {
    console.log(`[staff] event70 vote rejected by=${session.playerId || 0} target=${targetPlayerId} reason=vote-active`);
    return [];
  }
  const now = Date.now();
  if (now < Number(session.kickVoteStartedAt || 0) + KICK_VOTE_COOLDOWN_MS) {
    console.log(`[staff] event70 vote rejected by=${session.playerId || 0} target=${targetPlayerId} reason=cooldown`);
    return [];
  }

  const authorizationToken = {};
  room.kickVoteAuthorization = authorizationToken;
  try {
    const actionReason = `vote-${kickVoteReasonName(reasonCode)}`;
    const approval = await requestStaffActionApproval(
      session,
      targetPlayerId,
      "kick",
      actionReason,
      0,
      targetSession,
      { minimumRole: "helper", source: "event70", authorizeOnly: true },
    );
    if (!approval.ok) {
      console.log(`[staff] event70 vote denied by=${session.playerId || 0} target=${targetPlayerId} reason=${approval.error}`);
      return [];
    }
    if (
      room.kickVote ||
      session.room !== room ||
      targetSession.room !== room ||
      room.players.get(Number(session.actorId)) !== session ||
      room.players.get(targetActorId) !== targetSession ||
      !cachedStaffCanModerate(session, targetSession, "kick")
    ) {
      console.log(`[staff] event70 vote rejected by=${session.playerId || 0} target=${targetPlayerId} reason=state-changed`);
      return [];
    }

    const eligibleActorIds = kickVoteEligibleActors(room, targetActorId);
    const starterActorId = Number(session.actorId);
    if (!eligibleActorIds.has(starterActorId)) {
      console.log(`[staff] event70 vote rejected by=${session.playerId || 0} target=${targetPlayerId} reason=not-eligible`);
      return [];
    }
    const startedAt = Date.now();
    const vote = {
      room,
      sourceSession: session,
      targetSession,
      starterPlayerId: Number(session.playerId),
      starterActorId,
      targetPlayerId,
      targetActorId,
      reasonCode,
      startedAt,
      eligibleActorIds,
      threshold: Math.floor(eligibleActorIds.size / 2) + 1,
      votes: new Map([[starterActorId, true]]),
      resolving: false,
      timer: null,
    };
    session.kickVoteStartedAt = startedAt;
    room.kickVote = vote;
    const started = makeKickVoteEvent(session, targetSession, { yes: 1, no: 0, reasonCode });
    broadcastKickVoteToPeers(session, started, channel);
    scheduleRoomKickVoteExpiry(vote, channel);
    console.log(`[staff] event70 vote started room=${room.name} by=${session.playerId} target=${targetPlayerId}/${targetActorId} reason=${kickVoteReasonName(reasonCode)} eligible=${eligibleActorIds.size} threshold=${vote.threshold} period=${KICK_VOTE_DURATION_MS}ms`);
    return [started];
  } finally {
    if (room.kickVoteAuthorization === authorizationToken) room.kickVoteAuthorization = null;
  }
}

async function handleRoomKickVoteBallotRequest(session, data, channel = 0) {
  const targetPlayerId = Number(htGet(data, 1)?.value || 0);
  const targetActorId = Number(htGet(data, 5)?.value || 0);
  const ballot = htGet(data, 2)?.value;
  const vote = session?.room?.kickVote;
  const actorId = Number(session?.actorId || 0);
  if (
    !vote ||
    vote.resolving ||
    targetPlayerId !== vote.targetPlayerId ||
    targetActorId !== vote.targetActorId ||
    typeof ballot !== "boolean" ||
    !vote.eligibleActorIds.has(actorId) ||
    session.room.players.get(actorId) !== session ||
    vote.votes.has(actorId)
  ) {
    console.log(`[staff] event70 ballot rejected by=${session?.playerId || 0} target=${targetPlayerId}/${targetActorId} reason=contract-or-state`);
    return [];
  }

  vote.votes.set(actorId, ballot);
  const counts = kickVoteCounts(vote);
  const update = makeKickVoteEvent(session, vote.targetSession, counts);
  broadcastKickVoteToPeers(session, update, channel);
  console.log(`[staff] event70 ballot room=${vote.room.name} by=${session.playerId || 0} target=${vote.targetPlayerId} vote=${ballot ? "yes" : "no"} yes=${counts.yes} no=${counts.no} threshold=${vote.threshold}`);

  const remaining = vote.eligibleActorIds.size - vote.votes.size;
  let decision = null;
  if (counts.yes >= vote.threshold) decision = true;
  else if (counts.yes + remaining < vote.threshold) decision = false;
  if (decision == null) return [update];

  const result = await finishRoomKickVote(vote, decision, channel, "threshold");
  if (!result) return [update];
  broadcastKickVoteToPeers(session, result, channel, vote.room);
  return [update, result];
}

async function handleStaffInstantKickRequest(session, parsed, channel = 0) {
  const data = eventDataHash(parsed);
  const targetPlayerId = Number(htGet(data, 1)?.value || 0);
  const targetActorId = Number(htGet(data, 5)?.value || 0);
  const reasonCode = Number(htGet(data, 9)?.value || 0);
  if (reasonCode !== 4 || !Number.isInteger(targetPlayerId) || targetPlayerId <= 0 || !Number.isInteger(targetActorId) || targetActorId <= 0) {
    console.log(`[staff] event70 rejected by=${session?.playerId || 0} reason=contract`);
    return [];
  }
  const targetSession = session?.room?.players?.get(targetActorId);
  if (!targetSession || Number(targetSession.playerId) !== targetPlayerId) {
    console.log(`[staff] event70 rejected by=${session?.playerId || 0} target=${targetPlayerId}/${targetActorId} reason=identity-mismatch`);
    return [];
  }
  if (Number(session.playerId) === targetPlayerId) {
    console.log(`[staff] event70 rejected by=${session?.playerId || 0} target=${targetPlayerId} reason=self-target`);
    return [];
  }
  const approval = await requestStaffActionApproval(
    session,
    targetPlayerId,
    "kick",
    "instant-kick",
    0,
    targetSession,
    { minimumRole: "helper", source: "event70" },
  );
  if (!approval.ok) {
    console.log(`[staff] event70 denied by=${session.playerId || 0} target=${targetPlayerId} reason=${approval.error}`);
    return [];
  }

  const started = makeInstantKickEvent(session, targetSession);
  const accepted = makeInstantKickEvent(session, targetSession, true);
  for (const peer of session.room.players.values()) {
    if (!peer || peer === session) continue;
    sendReliablePayloadsToSession(peer, [started, accepted], channel);
  }
  scheduleModerationDisconnect(targetSession, "kick", session, "instant-kick", channel);
  console.log(`[staff] event70 accepted by=${session.playerId || 0} role=${normalizeStaffRole(session.staffRole)} target=${targetPlayerId} actor=${targetActorId}`);
  return [started, accepted];
}

async function handleKickRequest(session, parsed, channel = 0) {
  const data = eventDataHash(parsed);
  const reasonEntry = htGet(data, 9);
  const ballotEntry = htGet(data, 2);
  if ((reasonEntry == null) === (ballotEntry == null)) {
    console.log(`[staff] event70 rejected by=${session?.playerId || 0} reason=request-shape`);
    return [];
  }
  if (reasonEntry != null) {
    const reasonCode = Number(reasonEntry.value || 0);
    if (reasonCode === 4) return handleStaffInstantKickRequest(session, parsed, channel);
    return handleRoomKickVoteStartRequest(session, data, channel);
  }
  return handleRoomKickVoteBallotRequest(session, data, channel);
}

function buildBattleChatEvent(session, message, type) {
  const team = Number.isFinite(Number(session?.team)) ? Number(session.team) : 0;
  return rawEvent(155, [
    { key: 254, value: rawInt(session.actorId) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(77), value: rawString(message) },
        { key: rawByte(85), value: rawString(stringOr(session.playerName, process.env.DEFAULT_PLAYER_NAME || "ContraCity")) },
        { key: rawByte(80), value: rawByte(type) },
        { key: rawByte(84), value: rawShort(team) },
      ]),
    },
  ]);
}

function isExpeditionRoom(session) {
  return Number(session?.room?.mode) === MAP_MODE_ROGUELIKE && mapKey(session?.room?.map) === "promzona";
}

function expeditionRunId(value) {
  const runId = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(runId) ? runId : "";
}

function newExpeditionRunId() {
  return crypto.randomBytes(16).toString("hex");
}

function expeditionPayloadValue(data, key, fallback = null) {
  const item = data ? htGet(data, key) : null;
  return item ? item.value : fallback;
}

function makeExpeditionReply(session, command, runId, message, ok) {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(command) },
        { key: rawByte(2), value: rawString(runId || "") },
        { key: rawByte(3), value: rawString(message || "") },
        { key: rawByte(4), value: rawBool(Boolean(ok)) },
      ]),
    },
  ]);
}

// Event-157 AI transport has a fixed schema. The Node server validates room
// membership, authority, order and rate, then relays Unity-host simulation;
// it intentionally does not pretend to own NavMesh or Unity raycasts.
function makeExpeditionAiEvent(command, runId, sequence, sourceActorId, typedPayload = "", targetActorId = 0) {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(sourceActorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(Number(command || 0)) },
        { key: rawByte(2), value: rawString(String(runId || "")) },
        { key: rawByte(3), value: rawInt(Math.max(0, Math.trunc(Number(sequence || 0)))) },
        { key: rawByte(4), value: rawInt(Number(sourceActorId || 0)) },
        { key: rawByte(5), value: rawInt(Number(targetActorId || 0)) },
        { key: rawByte(6), value: rawByte(1) },
        { key: rawByte(7), value: rawString(String(typedPayload || "")) },
      ]),
    },
  ]);
}

function activeExpeditionRoomMembers(room) {
  return Array.from(room?.players?.entries?.() || [])
    .filter(([, member]) => member && !member.transportDisconnected && member.socket && member.rinfo)
    .sort((left, right) => Number(left[0]) - Number(right[0]));
}

function expeditionAuthorityActor(room) {
  const members = activeExpeditionRoomMembers(room);
  return members.length ? Number(members[0][0]) : 0;
}

function sendExpeditionAiToSession(target, command, run, sequence, sourceActorId, typedPayload = "", targetActorId = 0, channel = 0) {
  if (!target?.socket || !target?.rinfo || !run) return false;
  return sendReliablePayload(target.socket, target.rinfo, target,
    makeExpeditionAiEvent(command, run.runId, sequence, sourceActorId, typedPayload, targetActorId), channel);
}

function publishExpeditionAiAuthority(room, run, channel = 0) {
  if (!room || !run) return 0;
  const nextActor = expeditionAuthorityActor(room);
  run.authorityActorId = nextActor;
  run.authorityChangedAt = Date.now();
  let sent = 0;
  for (const [, member] of activeExpeditionRoomMembers(room)) {
    if (sendExpeditionAiToSession(member, EXPEDITION_COMMAND.AI_AUTHORITY, run, run.lastAiSequence || 0, nextActor, "", 0, channel)) sent += 1;
  }
  return sent;
}

function relayExpeditionAi(room, source, command, run, sequence, typedPayload, targetActorId = 0, channel = 0, includeSource = false) {
  let sent = 0;
  for (const [, member] of activeExpeditionRoomMembers(room)) {
    if (!includeSource && member === source) continue;
    if (targetActorId && Number(member.actorId || 0) !== Number(targetActorId)) continue;
    if (sendExpeditionAiToSession(member, command, run, sequence, Number(source?.actorId || 0), typedPayload, targetActorId, channel)) sent += 1;
  }
  return sent;
}

function validExpeditionAiPayload(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= EXPEDITION_AI_MAX_PAYLOAD_BYTES;
}

function isActiveExpeditionSoloQueueSession(session, queueId) {
  return Boolean(
    session &&
    !session.transportDisconnected &&
    session.listLobby &&
    session.sessionId &&
    session.expeditionSoloQueueId === queueId &&
    sessions.get(session.sessionId) === session,
  );
}

function makeExpeditionSoloQueueState(session, queue) {
  const players = Array.from(queue?.members?.values?.() || [])
    .filter((member) => isActiveExpeditionSoloQueueSession(member, queue?.id))
    .slice(0, 4);
  const ready = players.length === 4;
  const names = players.map((member) => String(member.playerName || "Боец").slice(0, 48));
  while (names.length < 4) names.push("");
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.SOLO_QUEUE_STATE) },
        { key: rawByte(2), value: rawString(String(queue?.id || "")) },
        { key: rawByte(3), value: rawByte(players.length) },
        { key: rawByte(4), value: rawString(names[0]) },
        { key: rawByte(5), value: rawString(names[1]) },
        { key: rawByte(6), value: rawString(names[2]) },
        { key: rawByte(7), value: rawString(names[3]) },
        { key: rawByte(8), value: rawBool(ready) },
        { key: rawByte(9), value: rawString(ready ? "Отряд собран." : "Подбираем бойцов…") },
      ]),
    },
  ]);
}

function makeExpeditionSoloQueueRejected(session, reason) {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.SOLO_QUEUE_REJECTED) },
        { key: rawByte(9), value: rawString(String(reason || "queue_unavailable").slice(0, 64)) },
      ]),
    },
  ]);
}

function makeExpeditionSoloQueueLaunch(session, roomName) {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.SOLO_QUEUE_LAUNCH) },
        { key: rawByte(2), value: rawString(String(roomName || "")) },
        { key: rawByte(9), value: rawString("launching") },
      ]),
    },
  ]);
}

function publishExpeditionSoloQueueState(queue, channel = 0) {
  if (!queue?.members?.size) return 0;
  let sent = 0;
  for (const member of queue.members.values()) {
    if (!isActiveExpeditionSoloQueueSession(member, queue.id) || !member.socket || !member.rinfo) continue;
    if (sendReliablePayload(member.socket, member.rinfo, member, makeExpeditionSoloQueueState(member, queue), channel)) sent += 1;
  }
  return sent;
}

function clearExpeditionSoloQueueLaunch(queue) {
  if (!queue?.launchTimer) return;
  clearTimeout(queue.launchTimer);
  queue.launchTimer = null;
}

function expeditionReservationAllowsPlayer(room, playerId) {
  if (!room?.expeditionReserved) return true;
  const id = Number(playerId || 0);
  return Number.isFinite(id) && id > 0 && room.expeditionReservationPlayerIds instanceof Set && room.expeditionReservationPlayerIds.has(id);
}

function reserveExpeditionSoloRoom(queue, members) {
  const room = ensureRoom({
    name: `Expedition solo ${queue.id}`,
    map: "promzona",
    mode: MAP_MODE_ROGUELIKE,
    maxUsers: 4,
    friendlyFire: false,
    timeLimit: 10,
    fragLimit: 50,
    lvlMin: 1,
    lvlMax: 99,
    hasFullSettings: true,
  });
  room.expeditionReserved = true;
  room.expeditionQueueId = queue.id;
  room.expeditionReservationPlayerIds = new Set(members.map((member) => Number(member.playerId || 0)).filter((id) => id > 0));
  if (room.expeditionReservationTimer) clearTimeout(room.expeditionReservationTimer);
  room.expeditionReservationTimer = setTimeout(() => {
    if (rooms.get(room.name) !== room) return;
    room.expeditionReservationTimer = null;
    room.expeditionReserved = false;
    room.expeditionReservationPlayerIds = null;
    if ((room.players?.size || 0) === 0) deleteEmptyRoom(room, "expedition-reservation-timeout");
  }, 90000);
  room.expeditionReservationTimer.unref?.();
  return room;
}

function scheduleExpeditionSoloQueueLaunch(queue, channel = 0) {
  if (!queue || queue.launchTimer || queue.members.size !== 4) return;
  // Keep the confirmed 4/4 state visible long enough for the roster to paint,
  // then atomically reserve the Promzona room for these exact four profiles.
  queue.launchTimer = setTimeout(() => {
    queue.launchTimer = null;
    const members = Array.from(queue.members.values())
      .filter((member) => isActiveExpeditionSoloQueueSession(member, queue.id));
    if (members.length !== 4 || expeditionSoloQueues.get(queue.id) !== queue) {
      pruneExpeditionSoloQueues(channel);
      return;
    }

    const room = reserveExpeditionSoloRoom(queue, members);
    expeditionSoloQueues.delete(queue.id);
    queue.members.clear();
    for (const member of members) {
      member.expeditionSoloQueueId = "";
      if (!member.socket || !member.rinfo) continue;
      sendReliablePayload(member.socket, member.rinfo, member, makeExpeditionSoloQueueLaunch(member, room.name), channel);
    }
    console.log(`[expedition] solo queue launch queue=${queue.id} room=${room.name} players=${members.map((member) => member.playerId).join(",")}`);
  }, 400);
  queue.launchTimer.unref?.();
}

function removeExpeditionSoloMatchmakingSession(session, reason = "leave", channel = 0) {
  const queueId = String(session?.expeditionSoloQueueId || "");
  if (!queueId) return false;
  const queue = expeditionSoloQueues.get(queueId);
  session.expeditionSoloQueueId = "";
  if (!queue?.members) return false;
  clearExpeditionSoloQueueLaunch(queue);
  queue.members.delete(session.sessionId);
  if (queue.members.size === 0) {
    expeditionSoloQueues.delete(queueId);
  } else {
    publishExpeditionSoloQueueState(queue, channel);
  }
  console.log(`[expedition] solo queue leave reason=${reason} queue=${queueId} player=${session.playerId || "unknown"}`);
  return true;
}

function pruneExpeditionSoloQueues(channel = 0) {
  for (const [queueId, queue] of expeditionSoloQueues) {
    let changed = false;
    for (const [sessionId, member] of queue.members) {
      if (isActiveExpeditionSoloQueueSession(member, queueId)) continue;
      queue.members.delete(sessionId);
      if (member?.expeditionSoloQueueId === queueId) member.expeditionSoloQueueId = "";
      changed = true;
    }
    if (queue.members.size === 0) {
      clearExpeditionSoloQueueLaunch(queue);
      expeditionSoloQueues.delete(queueId);
    } else if (changed) {
      if (queue.members.size < 4) clearExpeditionSoloQueueLaunch(queue);
      publishExpeditionSoloQueueState(queue, channel);
    }
  }
}

async function loadExpeditionSoloQueueProfile(session, options = {}) {
  if (!session?.listLobby || !session.lobbyActor) return null;
  const { profile, source } = await profileForJoin(session.lobbyActor, { forceRefresh: Boolean(options.forceRefresh) });
  // A privileged launch must fail closed if the canonical profile service is
  // unavailable. Regular matchmaking retains its existing cache behaviour.
  if (options.requireFresh && source !== "fresh") return null;
  if (!profile || profile.accessDenied || isFallbackBattleProfile(profile)) return null;
  if (session.transportDisconnected || !session.sessionId || sessions.get(session.sessionId) !== session) return null;
  session.playerId = profile.authId;
  session.playerAuthKey = profile.authKey || actorCredentials(session.lobbyActor).authKey || "";
  session.playerName = profile.name;
  session.loadedProfile = profile;
  return profile;
}

// This reservation is deliberately separate from reserveExpeditionSoloRoom().
// Normal SOLO still launches only from its 4/4 queue; this path is the explicit
// developer tool requested from the staff panel and reserves the room for one
// authenticated developer profile only.
function reserveDeveloperExpeditionSoloRoom(session) {
  const playerId = Number(session?.playerId || 0);
  const reservationId = `developer-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const room = ensureRoom({
    name: `Expedition developer ${reservationId}`,
    map: "promzona",
    mode: MAP_MODE_ROGUELIKE,
    maxUsers: 4,
    friendlyFire: false,
    timeLimit: 10,
    fragLimit: 50,
    lvlMin: 1,
    lvlMax: 99,
    hasFullSettings: true,
  });
  room.expeditionReserved = true;
  room.expeditionQueueId = reservationId;
  room.expeditionReservationPlayerIds = new Set(playerId > 0 ? [playerId] : []);
  if (room.expeditionReservationTimer) clearTimeout(room.expeditionReservationTimer);
  room.expeditionReservationTimer = setTimeout(() => {
    if (rooms.get(room.name) !== room) return;
    room.expeditionReservationTimer = null;
    room.expeditionReserved = false;
    room.expeditionReservationPlayerIds = null;
    if ((room.players?.size || 0) === 0) deleteEmptyRoom(room, "expedition-developer-reservation-timeout");
  }, 90000);
  room.expeditionReservationTimer.unref?.();
  return room;
}

async function handleDeveloperExpeditionSoloLaunch(session, channel = 0) {
  if (!session?.listLobby || !isBattleListSession(session)) {
    return [makeExpeditionSoloQueueRejected(session, "developer_lobby_only")];
  }

  // Do not trust the client-side panel role. Force a canonical profile refresh
  // and require the exact Developer role (Owner and lower staff roles do not
  // inherit this test-only bypass).
  const profile = await loadExpeditionSoloQueueProfile(session, { forceRefresh: true, requireFresh: true });
  if (!profile) return [makeExpeditionSoloQueueRejected(session, "profile_unavailable")];
  const staffRole = applySessionStaffProfile(session, profile);
  if (staffRole !== "developer") {
    console.log(`[expedition] developer solo denied player=${session.playerId || "unknown"} role=${staffRole}`);
    return [makeExpeditionSoloQueueRejected(session, "developer_role_required")];
  }

  // A staff member cannot remain in a regular queue/party while launching a
  // private one-person test. Cleanup reuses the same state publication paths.
  removeExpeditionSoloMatchmakingSession(session, "developer-launch", channel);
  removeExpeditionPartyMember(session, "developer-launch", channel);

  const room = reserveDeveloperExpeditionSoloRoom(session);
  console.log(`[expedition] developer solo launch room=${room.name} player=${session.playerId} role=${staffRole}`);
  return [makeExpeditionSoloQueueLaunch(session, room.name)];
}

async function handleExpeditionSoloMatchmaking(session, command, channel = 0) {
  if (!session?.listLobby) return [makeExpeditionSoloQueueRejected(session, "not_in_lobby")];
  if (command === EXPEDITION_COMMAND.SOLO_QUEUE_CANCEL) {
    removeExpeditionSoloMatchmakingSession(session, "client-cancel", channel);
    return [];
  }
  if (command !== EXPEDITION_COMMAND.SOLO_QUEUE_JOIN) {
    return [makeExpeditionSoloQueueRejected(session, "unknown_command")];
  }

  const profile = await loadExpeditionSoloQueueProfile(session);
  if (!profile) return [makeExpeditionSoloQueueRejected(session, "profile_unavailable")];
  pruneExpeditionSoloQueues(channel);
  removeExpeditionSoloMatchmakingSession(session, "requeue", channel);

  let queue = Array.from(expeditionSoloQueues.values()).find((candidate) => candidate.members.size < 4);
  if (!queue) {
    expeditionSoloQueueSequence += 1;
    queue = { id: `solo-${Date.now().toString(36)}-${expeditionSoloQueueSequence.toString(36)}`, members: new Map() };
    expeditionSoloQueues.set(queue.id, queue);
  }
  queue.members.set(session.sessionId, session);
  session.expeditionSoloQueueId = queue.id;
  publishExpeditionSoloQueueState(queue, channel);
  if (queue.members.size === 4) {
    scheduleExpeditionSoloQueueLaunch(queue, channel);
  }
  console.log(`[expedition] solo queue join queue=${queue.id} player=${profile.authId} name=${profile.name} count=${queue.members.size}/4`);
  return [];
}

function isActiveExpeditionPartySession(session, partyId) {
  return Boolean(
    session &&
    !session.transportDisconnected &&
    isBattleListSession(session) &&
    session.listLobby &&
    session.sessionId &&
    session.expeditionPartyId === partyId &&
    sessions.get(session.sessionId) === session,
  );
}

function activeExpeditionLobbySessionForUser(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  for (const candidate of sessions.values()) {
    if (!candidate || candidate.transportDisconnected || !isBattleListSession(candidate)) continue;
    // The recovered list-lobby path attaches a shared placeholder room to the
    // session, so listLobby (not room === null) is the authoritative signal
    // that a player is in the headquarters and can receive a PvE invite.
    if (!candidate.listLobby || Number(candidate.playerId || 0) !== id) continue;
    if (!candidate.sessionId || sessions.get(candidate.sessionId) !== candidate) continue;
    return candidate;
  }
  return null;
}

function anyBattleSessionForUser(playerId) {
  const id = Number(playerId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  for (const candidate of sessions.values()) {
    if (!candidate || candidate.transportDisconnected || !isBattleListSession(candidate)) continue;
    if (Number(candidate.playerId || 0) === id && candidate.sessionId && sessions.get(candidate.sessionId) === candidate) return candidate;
  }
  return null;
}

function partyMembers(party) {
  return Array.from(party?.members?.values?.() || [])
    .filter((member) => isActiveExpeditionPartySession(member, party?.id))
    .slice(0, 4);
}

function partyCountdownSeconds(party) {
  if (!party?.countdownEndsAt) return 0;
  return Math.max(0, Math.min(5, Math.ceil((party.countdownEndsAt - Date.now()) / 1000)));
}

function makeExpeditionPartyState(session, party, friendRows = []) {
  const members = partyMembers(party);
  const names = members.map((member) => String(member.playerName || "Боец").slice(0, 48));
  const userIds = members.map((member) => Number(member.playerId || 0));
  const ready = members.map((member) => Boolean(member.expeditionPartyReady));
  while (names.length < 4) names.push("");
  while (userIds.length < 4) userIds.push(0);
  while (ready.length < 4) ready.push(false);
  const friendTable = rawHashtable(friendRows.map((friend) => ({
    key: rawInt(Number(friend.userId || 0)),
    value: rawHashtable([
      { key: rawByte(1), value: rawString(String(friend.name || "Боец").slice(0, 48)) },
      { key: rawByte(2), value: rawBool(Boolean(friend.canInvite)) },
      { key: rawByte(3), value: rawString(String(friend.status || "НЕ В СЕТИ").slice(0, 48)) },
    ]),
  })));
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.PARTY_STATE) },
        { key: rawByte(2), value: rawString(String(party?.id || "")) },
        { key: rawByte(3), value: rawByte(members.length) },
        { key: rawByte(4), value: rawString(names[0]) },
        { key: rawByte(5), value: rawString(names[1]) },
        { key: rawByte(6), value: rawString(names[2]) },
        { key: rawByte(7), value: rawString(names[3]) },
        { key: rawByte(8), value: rawInt(userIds[0]) },
        { key: rawByte(9), value: rawInt(userIds[1]) },
        { key: rawByte(10), value: rawInt(userIds[2]) },
        { key: rawByte(11), value: rawInt(userIds[3]) },
        { key: rawByte(12), value: rawBool(ready[0]) },
        { key: rawByte(13), value: rawBool(ready[1]) },
        { key: rawByte(14), value: rawBool(ready[2]) },
        { key: rawByte(15), value: rawBool(ready[3]) },
        { key: rawByte(16), value: rawInt(Number(party?.leaderUserId || 0)) },
        { key: rawByte(17), value: rawByte(partyCountdownSeconds(party)) },
        { key: rawByte(18), value: rawBool(true) },
        { key: rawByte(19), value: rawString(String(party?.message || "Соберите отряд и приготовьтесь к рейду.").slice(0, 128)) },
        { key: rawByte(20), value: friendTable },
      ]),
    },
  ]);
}

function makeExpeditionPartyInactive(session, message = "") {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.PARTY_STATE) },
        { key: rawByte(18), value: rawBool(false) },
        { key: rawByte(19), value: rawString(String(message).slice(0, 128)) },
      ]),
    },
  ]);
}

function makeExpeditionPartyRejected(session, message = "Действие недоступно.") {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.PARTY_REJECTED) },
        { key: rawByte(19), value: rawString(String(message).slice(0, 128)) },
      ]),
    },
  ]);
}

function makeExpeditionPartyInvitation(session, partyId = "", inviterId = 0, inviterName = "") {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.PARTY_INVITATION) },
        { key: rawByte(2), value: rawString(String(partyId || "")) },
        { key: rawByte(3), value: rawInt(Number(inviterId || 0)) },
        { key: rawByte(4), value: rawString(String(inviterName || "").slice(0, 48)) },
      ]),
    },
  ]);
}

function makeExpeditionPartyLaunch(session, roomName) {
  return rawEvent(EXPEDITION_EVENT, [
    { key: 254, value: rawInt(Number(session?.actorId || 0)) },
    {
      key: 245,
      value: rawHashtable([
        { key: rawByte(1), value: rawByte(EXPEDITION_COMMAND.PARTY_LAUNCH) },
        { key: rawByte(2), value: rawString(String(roomName || "")) },
      ]),
    },
  ]);
}

function clearExpeditionPartyCountdown(party) {
  if (!party) return;
  if (party.countdownTimer) clearTimeout(party.countdownTimer);
  party.countdownTimer = null;
  party.countdownEndsAt = 0;
}

async function expeditionPartyFriendRows(party, ownerId) {
  const owner = Number(ownerId || 0);
  if (!owner) return [];
  const knownFriends = await loadExpeditionPartyFriends(owner);
  const rows = [];
  for (const friend of knownFriends) {
    const userId = Number(friend?.userId || 0);
    if (!userId || userId === owner || Number(friend?.state || 0) !== 1) continue;
    const member = partyMembers(party).some((entry) => Number(entry.playerId || 0) === userId);
    const invitationState = party?.inviteStates?.get(userId) || "";
    const lobbySession = activeExpeditionLobbySessionForUser(userId);
    const anySession = anyBattleSessionForUser(userId);
    let status = "НЕ В СЕТИ";
    let canInvite = false;
    if (member) status = "В ОТРЯДЕ";
    else if (invitationState) status = invitationState;
    else if (lobbySession && !lobbySession.expeditionPartyId && !lobbySession.expeditionSoloQueueId) {
      status = "В СЕТИ";
      canInvite = partyMembers(party).length < 4 && !party.countdownEndsAt;
    } else if (anySession?.room || (anySession && !anySession.listLobby)) status = "В БОЮ";
    else if (anySession) status = "В СЕТИ";
    rows.push({ userId, name: friend.name, canInvite, status });
  }
  return rows;
}

async function loadExpeditionPartyFriends(userId) {
  const id = Number(userId || 0);
  const cached = expeditionPartyFriendCache.get(id);
  if (cached && Date.now() - cached.loadedAt < EXPEDITION_PARTY_FRIEND_CACHE_MS) return cached.friends;
  const friends = await loadMasterSocialList(id);
  expeditionPartyFriendCache.set(id, { loadedAt: Date.now(), friends });
  return friends;
}

async function publishExpeditionPartyState(party, channel = 0) {
  if (!party?.members?.size || expeditionParties.get(party.id) !== party) return 0;
  let sent = 0;
  for (const member of partyMembers(party)) {
    const rows = await expeditionPartyFriendRows(party, member.playerId);
    if (expeditionParties.get(party.id) !== party) return sent;
    if (member.socket && member.rinfo && sendReliablePayload(member.socket, member.rinfo, member, makeExpeditionPartyState(member, party, rows), channel)) sent += 1;
  }
  return sent;
}

function clearExpeditionPartyInvitations(party, message = "") {
  for (const invitation of party?.pendingInvites?.values?.() || []) {
    const target = invitation?.session;
    if (target?.pendingExpeditionPartyInvite?.partyId === party.id) target.pendingExpeditionPartyInvite = null;
    if (target?.socket && target?.rinfo) sendReliablePayload(target.socket, target.rinfo, target, makeExpeditionPartyInvitation(target), target.lastChannel || 0);
  }
  if (party?.pendingInvites) party.pendingInvites.clear();
  if (message && party?.inviteStates) party.inviteStates.clear();
}

function disbandExpeditionParty(party, reason = "Отряд расформирован.", channel = 0) {
  if (!party || expeditionParties.get(party.id) !== party) return false;
  clearExpeditionPartyCountdown(party);
  clearExpeditionPartyInvitations(party, reason);
  expeditionParties.delete(party.id);
  for (const member of party.members.values()) {
    if (member?.expeditionPartyId === party.id) {
      member.expeditionPartyId = "";
      member.expeditionPartyReady = false;
    }
    if (member?.socket && member?.rinfo) sendReliablePayload(member.socket, member.rinfo, member, makeExpeditionPartyInactive(member, reason), channel);
  }
  party.members.clear();
  console.log(`[expedition] party disband party=${party.id} reason=${reason}`);
  return true;
}

function removeExpeditionPartyMember(session, reason = "leave", channel = 0) {
  const partyId = String(session?.expeditionPartyId || "");
  if (!partyId) return false;
  const party = expeditionParties.get(partyId);
  session.expeditionPartyId = "";
  session.expeditionPartyReady = false;
  if (!party?.members) return false;
  if (Number(session.playerId || 0) === Number(party.leaderUserId || 0)) {
    return disbandExpeditionParty(party, "Лидер покинул отряд.", channel);
  }
  clearExpeditionPartyCountdown(party);
  party.members.delete(session.sessionId);
  party.message = `${String(session.playerName || "Боец").slice(0, 48)} покинул отряд.`;
  if (party.members.size === 0) {
    expeditionParties.delete(partyId);
  } else {
    publishExpeditionPartyState(party, channel).catch((error) => console.log(`[expedition] party leave publish failed ${error.message}`));
  }
  console.log(`[expedition] party leave party=${partyId} player=${session.playerId || "unknown"} reason=${reason}`);
  return true;
}

function allExpeditionPartyMembersReady(party) {
  const members = partyMembers(party);
  // Party PvE is a four-player expedition. A leader must not be able to
  // launch a one-, two- or three-person reservation just because every
  // currently occupied slot is marked ready. The client only visualizes this
  // state; the server remains the authoritative launch gate.
  return members.length === 4 && members.length === party.members.size && members.every((member) => member.expeditionPartyReady);
}

function reserveExpeditionPartyRoom(party, members) {
  const room = ensureRoom({
    name: `Expedition party ${party.id}`,
    map: "promzona",
    mode: MAP_MODE_ROGUELIKE,
    maxUsers: 4,
    friendlyFire: false,
    timeLimit: 10,
    fragLimit: 50,
    lvlMin: 1,
    lvlMax: 99,
    hasFullSettings: true,
  });
  room.expeditionReserved = true;
  room.expeditionQueueId = party.id;
  room.expeditionReservationPlayerIds = new Set(members.map((member) => Number(member.playerId || 0)).filter((id) => id > 0));
  if (room.expeditionReservationTimer) clearTimeout(room.expeditionReservationTimer);
  room.expeditionReservationTimer = setTimeout(() => {
    if (rooms.get(room.name) !== room) return;
    room.expeditionReservationTimer = null;
    room.expeditionReserved = false;
    room.expeditionReservationPlayerIds = null;
    if ((room.players?.size || 0) === 0) deleteEmptyRoom(room, "expedition-party-reservation-timeout");
  }, 90000);
  room.expeditionReservationTimer.unref?.();
  return room;
}

function startExpeditionPartyCountdown(party, channel = 0) {
  if (!party || party.countdownTimer || !allExpeditionPartyMembersReady(party)) return;
  party.countdownEndsAt = Date.now() + 5000;
  party.message = "Все готовы. Вылет через 5 секунд.";
  publishExpeditionPartyState(party, channel).catch((error) => console.log(`[expedition] party countdown publish failed ${error.message}`));
  party.countdownTimer = setTimeout(() => {
    party.countdownTimer = null;
    party.countdownEndsAt = 0;
    const members = partyMembers(party);
    if (expeditionParties.get(party.id) !== party || !allExpeditionPartyMembersReady(party)) return;
    const room = reserveExpeditionPartyRoom(party, members);
    expeditionParties.delete(party.id);
    party.members.clear();
    for (const member of members) {
      member.expeditionPartyId = "";
      member.expeditionPartyReady = false;
      if (member.socket && member.rinfo) sendReliablePayload(member.socket, member.rinfo, member, makeExpeditionPartyLaunch(member, room.name), channel);
    }
    console.log(`[expedition] party launch party=${party.id} room=${room.name} players=${members.map((member) => member.playerId).join(",")}`);
  }, 5000);
  party.countdownTimer.unref?.();
}

async function handleExpeditionPartyLobby(session, command, data, channel = 0) {
  if (!session?.listLobby || !isBattleListSession(session)) return [makeExpeditionPartyRejected(session, "Отряд доступен только в штабе.")];
  if (command === EXPEDITION_COMMAND.PARTY_CREATE) {
    const profile = await loadExpeditionSoloQueueProfile(session);
    if (!profile) return [makeExpeditionPartyRejected(session, "Профиль временно недоступен.")];
    removeExpeditionSoloMatchmakingSession(session, "party-create", channel);
    removeExpeditionPartyMember(session, "recreate", channel);
    expeditionPartySequence += 1;
    const party = {
      id: `party-${Date.now().toString(36)}-${expeditionPartySequence.toString(36)}`,
      leaderUserId: Number(session.playerId || 0),
      members: new Map([[session.sessionId, session]]),
      pendingInvites: new Map(),
      inviteStates: new Map(),
      countdownTimer: null,
      countdownEndsAt: 0,
      message: "Соберите отряд и приготовьтесь к рейду.",
    };
    session.expeditionPartyId = party.id;
    session.expeditionPartyReady = false;
    expeditionParties.set(party.id, party);
    await publishExpeditionPartyState(party, channel);
    console.log(`[expedition] party create party=${party.id} leader=${session.playerId}`);
    return [];
  }

  const party = expeditionParties.get(String(session.expeditionPartyId || ""));
  if (command === EXPEDITION_COMMAND.PARTY_LEAVE) {
    removeExpeditionPartyMember(session, "client-leave", channel);
    return [];
  }
  if (!party || !isActiveExpeditionPartySession(session, party.id)) return [makeExpeditionPartyRejected(session, "Отряд больше недоступен.")];

  if (command === EXPEDITION_COMMAND.PARTY_REFRESH) {
    await publishExpeditionPartyState(party, channel);
    return [];
  }

  if (command === EXPEDITION_COMMAND.PARTY_INVITE) {
    if (partyMembers(party).length >= 4 || party.countdownEndsAt) return [makeExpeditionPartyRejected(session, "Состав уже зафиксирован.")];
    const targetId = Number(expeditionPayloadValue(data, 2, 0));
    const target = activeExpeditionLobbySessionForUser(targetId);
    const knownFriends = await loadExpeditionPartyFriends(session.playerId);
    const isFriend = knownFriends.some((friend) => Number(friend?.userId || 0) === targetId && Number(friend?.state || 0) === 1);
    if (expeditionParties.get(party.id) !== party || !isActiveExpeditionPartySession(session, party.id)) return [];
    if (!target || !isFriend || target.expeditionPartyId || target.expeditionSoloQueueId || target.pendingExpeditionPartyInvite) {
      party.inviteStates.set(targetId, "НЕДОСТУПЕН");
      party.message = "Этот друг сейчас недоступен для рейда.";
      await publishExpeditionPartyState(party, channel);
      return [];
    }
    party.pendingInvites.set(targetId, { session: target });
    party.inviteStates.set(targetId, "ПРИГЛАШЁН");
    target.pendingExpeditionPartyInvite = { partyId: party.id, inviterUserId: session.playerId, inviterName: session.playerName };
    sendReliablePayload(target.socket, target.rinfo, target, makeExpeditionPartyInvitation(target, party.id, session.playerId, session.playerName), target.lastChannel || channel);
    party.message = "Приглашение отправлено.";
    await publishExpeditionPartyState(party, channel);
    return [];
  }

  if (command === EXPEDITION_COMMAND.PARTY_READY) {
    const ready = Boolean(expeditionPayloadValue(data, 2, false));
    session.expeditionPartyReady = ready;
    if (!ready) {
      clearExpeditionPartyCountdown(party);
      party.message = "Один из бойцов ещё не готов.";
      await publishExpeditionPartyState(party, channel);
      return [];
    }
    const memberCount = partyMembers(party).length;
    party.message = memberCount < 4
      ? `Готов. Ожидаем ещё ${4 - memberCount} бойц${4 - memberCount === 1 ? "а" : "ов"}.`
      : "Ожидаем готовность отряда.";
    if (allExpeditionPartyMembersReady(party)) startExpeditionPartyCountdown(party, channel);
    else await publishExpeditionPartyState(party, channel);
    return [];
  }

  return [makeExpeditionPartyRejected(session, "Неизвестное действие отряда.")];
}

async function handleExpeditionPartyInviteResponse(session, data, channel = 0) {
  const pending = session?.pendingExpeditionPartyInvite;
  const partyId = String(expeditionPayloadValue(data, 2, ""));
  const accepted = Boolean(expeditionPayloadValue(data, 3, false));
  if (!pending || pending.partyId !== partyId) return [makeExpeditionPartyRejected(session, "Приглашение больше не активно.")];
  session.pendingExpeditionPartyInvite = null;
  const party = expeditionParties.get(partyId);
  if (!party || !isActiveExpeditionPartySession(activeExpeditionLobbySessionForUser(pending.inviterUserId), partyId)) return [makeExpeditionPartyRejected(session, "Отряд больше недоступен.")];
  party.pendingInvites.delete(Number(session.playerId || 0));
  if (!accepted) {
    party.inviteStates.set(Number(session.playerId || 0), "ОТКАЗАЛСЯ");
    party.message = `${String(session.playerName || "Боец").slice(0, 48)} отказался от приглашения.`;
    await publishExpeditionPartyState(party, channel);
    return [makeExpeditionPartyInactive(session, "")];
  }
  if (partyMembers(party).length >= 4 || session.expeditionPartyId || session.expeditionSoloQueueId || !session.listLobby) {
    party.inviteStates.set(Number(session.playerId || 0), "НЕДОСТУПЕН");
    await publishExpeditionPartyState(party, channel);
    return [makeExpeditionPartyRejected(session, "Место в отряде уже занято.")];
  }
  session.expeditionPartyId = party.id;
  session.expeditionPartyReady = false;
  party.members.set(session.sessionId, session);
  party.inviteStates.delete(Number(session.playerId || 0));
  party.message = `${String(session.playerName || "Боец").slice(0, 48)} присоединился к отряду.`;
  await publishExpeditionPartyState(party, channel);
  return [];
}

function ensureExpeditionRun(room) {
  if (!room.expedition || room.expedition.phase === "finished") {
    room.expedition = {
      runId: newExpeditionRunId(), phase: "starting", wave: 0,
      playerCount: 1, startedAt: Date.now(), lastWaveAt: 0,
      completionByPlayer: new Map(),
      authorityActorId: 0, authorityChangedAt: 0,
      lastAiSequence: 0, lastAiSnapshotAt: 0, lastAiSnapshot: "",
      aiSequenceByActor: new Map(), aiAttackIds: new Set(), lastAiCommandAt: 0,
    };
  }
  return room.expedition;
}

function expeditionLootFromWire(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 9) return null;
    const allowed = new Set([
      "mat_industrial_dye", "mat_rare_fabric", "mat_chemical_reagents", "mat_microchips",
      "mat_rare_electronics", "mat_weapon_alloy", "mat_armored_fiber", "coupon_100", "coupon_300",
    ]);
    const loot = [];
    for (const entry of parsed) {
      const itemId = String(entry?.id || "").trim();
      const amount = Number(entry?.amount || 0);
      if (!allowed.has(itemId) || !Number.isInteger(amount) || amount < 1 || amount > 100) return null;
      loot.push({ itemId, amount });
    }
    return loot;
  } catch {
    return null;
  }
}

async function persistExpeditionCompletion(session, run, result, highestWave, playerCount, loot) {
  if (!API_BASE_URL || typeof fetch !== "function") return { ok: false, error: "battle_api_unavailable" };
  const response = await fetchWithTimeout(`${API_BASE_URL}/battle/expedition`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(API_TOKEN ? { "x-battle-token": API_TOKEN } : {}) },
    body: JSON.stringify({
      token: API_TOKEN,
      playerId: Number(session.playerId || 0), runId: run.runId, result,
      highestWave, playerCount, roomName: String(session.room?.name || "").slice(0, 96), loot,
    }),
  }, BATTLE_EVENT_TIMEOUT_MS);
  let body = null;
  try { body = await response?.json(); } catch {}
  return { ok: Boolean(response?.ok && body?.ok), error: String(body?.error || (response?.ok ? "" : "battle_api_failed")), body };
}

function handleExpeditionAiRequest(session, room, run, command, data, channel = 0) {
  const supported = new Set([
    EXPEDITION_COMMAND.PLAYER_STATE, EXPEDITION_COMMAND.SHOT_INTENT,
    EXPEDITION_COMMAND.REVIVE_REQUEST, EXPEDITION_COMMAND.RESYNC_REQUEST,
    EXPEDITION_COMMAND.HOST_SNAPSHOT, EXPEDITION_COMMAND.HOST_ACTION,
    EXPEDITION_COMMAND.HOST_DAMAGE,
  ]);
  if (!supported.has(command)) return null;

  const actorId = Number(session?.actorId || 0);
  const sourceActorId = Number(expeditionPayloadValue(data, 4, actorId));
  const targetActorId = Number(expeditionPayloadValue(data, 5, 0));
  const sequence = Math.trunc(Number(expeditionPayloadValue(data, 3, 0)) || 0);
  const typedPayload = String(expeditionPayloadValue(data, 7, "") || "");
  if (!actorId || sourceActorId !== actorId || sequence <= 0 || !validExpeditionAiPayload(typedPayload)) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "invalid_ai_payload", false)];
  }
  const previous = Number(run.aiSequenceByActor.get(actorId) || 0);
  if (sequence <= previous) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "stale_ai_sequence", false)];
  }
  const now = Date.now();
  if (command !== EXPEDITION_COMMAND.RESYNC_REQUEST && now - Number(run.lastAiCommandAt || 0) < EXPEDITION_AI_COMMAND_MIN_MS) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "ai_rate_limited", false)];
  }
  run.aiSequenceByActor.set(actorId, sequence);
  run.lastAiCommandAt = now;

  const authorityActorId = Number(run.authorityActorId || expeditionAuthorityActor(room));
  if (!run.authorityActorId) publishExpeditionAiAuthority(room, run, channel);
  const isAuthority = actorId === Number(run.authorityActorId || authorityActorId);

  if (command === EXPEDITION_COMMAND.PLAYER_STATE) {
    const authority = room.players.get(Number(run.authorityActorId || 0));
    if (authority && authority !== session) sendExpeditionAiToSession(authority, EXPEDITION_COMMAND.PLAYER_STATE, run, sequence, actorId, typedPayload, 0, channel);
    return [];
  }
  if (command === EXPEDITION_COMMAND.RESYNC_REQUEST) {
    if (run.lastAiSnapshot) {
      sendExpeditionAiToSession(session, EXPEDITION_COMMAND.AI_RESYNC, run, run.lastAiSequence, Number(run.authorityActorId || 0), run.lastAiSnapshot, actorId, channel);
    } else {
      sendExpeditionAiToSession(session, EXPEDITION_COMMAND.AI_AUTHORITY, run, run.lastAiSequence, Number(run.authorityActorId || 0), "", 0, channel);
    }
    return [];
  }
  if (command === EXPEDITION_COMMAND.SHOT_INTENT || command === EXPEDITION_COMMAND.REVIVE_REQUEST) {
    const authority = room.players.get(Number(run.authorityActorId || 0));
    if (!authority) return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "ai_authority_unavailable", false)];
    const eventCode = command === EXPEDITION_COMMAND.SHOT_INTENT ? EXPEDITION_COMMAND.SHOT_INTENT : EXPEDITION_COMMAND.REVIVE_REQUEST;
    sendExpeditionAiToSession(authority, eventCode, run, sequence, actorId, typedPayload, targetActorId, channel);
    return [];
  }
  if (!isAuthority) return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "ai_authority_required", false)];

  if (command === EXPEDITION_COMMAND.HOST_SNAPSHOT) {
    if (now - Number(run.lastAiSnapshotAt || 0) < EXPEDITION_AI_SNAPSHOT_MIN_MS) return [];
    run.lastAiSnapshotAt = now;
    run.lastAiSequence = sequence;
    run.lastAiSnapshot = typedPayload;
    relayExpeditionAi(room, session, EXPEDITION_COMMAND.AI_SNAPSHOT, run, sequence, typedPayload, 0, channel);
    return [];
  }
  if (command === EXPEDITION_COMMAND.HOST_ACTION) {
    let lifecycle = "";
    try { lifecycle = String(JSON.parse(typedPayload)?.Kind || "").toLowerCase(); } catch {}
    const eventCode = lifecycle === "revive" ? EXPEDITION_COMMAND.AI_REVIVE : (lifecycle === "wipe" ? EXPEDITION_COMMAND.AI_WIPE : EXPEDITION_COMMAND.AI_LIFECYCLE);
    relayExpeditionAi(room, session, eventCode, run, sequence, typedPayload, targetActorId, channel);
    return [];
  }
  if (command === EXPEDITION_COMMAND.HOST_DAMAGE) {
    if (!targetActorId || !room.players.has(targetActorId)) return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "invalid_ai_damage_target", false)];
    let attackId = 0;
    try { attackId = Math.trunc(Number(JSON.parse(typedPayload)?.AttackId || 0)); } catch {}
    // Attack ids are monotonic per Unity host. After a legitimate failover the
    // new host starts its own sequence, so include its actor id in dedupe.
    const attackKey = `${actorId}:${attackId}`;
    if (attackId <= 0 || run.aiAttackIds.has(attackKey)) return [];
    run.aiAttackIds.add(attackKey);
    if (run.aiAttackIds.size > 2048) run.aiAttackIds.clear();
    relayExpeditionAi(room, session, EXPEDITION_COMMAND.AI_DAMAGE, run, sequence, typedPayload, targetActorId, channel);
    return [];
  }
  return [];
}

async function handleExpeditionRequest(session, parsed, channel = 0) {
  const data = eventDataHash(parsed);
  if (!data) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, "", "wrong_room", false)];
  }
  const command = Number(expeditionPayloadValue(data, 1, 0));
  if (session?.listLobby && command === EXPEDITION_COMMAND.DEVELOPER_SOLO_LAUNCH) {
    return handleDeveloperExpeditionSoloLaunch(session, channel);
  }
  if (session?.listLobby && (command === EXPEDITION_COMMAND.SOLO_QUEUE_JOIN || command === EXPEDITION_COMMAND.SOLO_QUEUE_CANCEL)) {
    return handleExpeditionSoloMatchmaking(session, command, channel);
  }
  if (session?.listLobby && command === EXPEDITION_COMMAND.PARTY_INVITE_RESPONSE) {
    return handleExpeditionPartyInviteResponse(session, data, channel);
  }
  if (session?.listLobby && [
    EXPEDITION_COMMAND.PARTY_CREATE,
    EXPEDITION_COMMAND.PARTY_LEAVE,
    EXPEDITION_COMMAND.PARTY_INVITE,
    EXPEDITION_COMMAND.PARTY_READY,
    EXPEDITION_COMMAND.PARTY_REFRESH,
  ].includes(command)) {
    return handleExpeditionPartyLobby(session, command, data, channel);
  }
  if (!isExpeditionRoom(session)) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, "", "wrong_room", false)];
  }
  const room = session.room;
  if (command === EXPEDITION_COMMAND.START) {
    const run = ensureExpeditionRun(room);
    const requestedPlayers = Math.max(1, Math.min(4, Math.trunc(Number(expeditionPayloadValue(data, 3, 1)) || 1)));
    run.playerCount = Math.max(run.playerCount, requestedPlayers);
    // One room owns one run. Bind all current members immediately so a client
    // that receives authority before its own START reply is still authorized.
    for (const [, member] of activeExpeditionRoomMembers(room)) member.expeditionRunId = run.runId;
    publishExpeditionAiAuthority(room, run, channel);
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.STARTED, run.runId, "started", true)];
  }

  const run = room.expedition;
  const runId = expeditionRunId(expeditionPayloadValue(data, 2, ""));
  if (!run || !runId || runId !== run.runId || session.expeditionRunId !== run.runId) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run?.runId || "", "run_not_authorized", false)];
  }

  const aiResult = handleExpeditionAiRequest(session, room, run, command, data, channel);
  if (aiResult !== null) return aiResult;

  if (command === EXPEDITION_COMMAND.WAVE) {
    const requestedWave = Math.trunc(Number(expeditionPayloadValue(data, 3, 0)) || 0);
    if (requestedWave < 1 || requestedWave > 50 || requestedWave > run.wave + 1) {
      return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "invalid_wave", false)];
    }
    const now = Date.now();
    if (requestedWave > run.wave && run.lastWaveAt && now - run.lastWaveAt < EXPEDITION_WAVE_REPORT_MIN_MS) {
      return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "wave_rate_limited", false)];
    }
    if (requestedWave > run.wave) {
      run.wave = requestedWave;
      run.phase = "active";
      run.lastWaveAt = now;
    }
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.STARTED, run.runId, `wave_${run.wave}`, true)];
  }

  if (command !== EXPEDITION_COMMAND.COMPLETE) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "unknown_command", false)];
  }

  const result = String(expeditionPayloadValue(data, 3, "")).toLowerCase();
  const highestWave = Math.trunc(Number(expeditionPayloadValue(data, 4, 0)) || 0);
  const playerCount = Math.max(1, Math.min(4, Math.trunc(Number(expeditionPayloadValue(data, 5, run.playerCount)) || run.playerCount)));
  const loot = expeditionLootFromWire(expeditionPayloadValue(data, 6, ""));
  if (!["evacuated", "wiped"].includes(result) || highestWave < 0 || highestWave > 50 || !loot || (result === "evacuated" && (highestWave !== 50 || run.wave !== 50)) || (result === "wiped" && loot.length)) {
    return [makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "invalid_completion", false)];
  }
  const playerId = Number(session.playerId || 0);
  const existing = run.completionByPlayer.get(playerId);
  if (existing) return [existing];
  const pending = makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "completion_pending", false);
  run.completionByPlayer.set(playerId, pending);
  try {
    const saved = await persistExpeditionCompletion(session, run, result, highestWave, playerCount, loot);
    const reply = makeExpeditionReply(session, saved.ok ? EXPEDITION_COMMAND.COMPLETED : EXPEDITION_COMMAND.REJECTED, run.runId, saved.ok ? "saved" : saved.error, saved.ok);
    run.completionByPlayer.set(playerId, reply);
    if (saved.ok) console.log(`[expedition] complete room=${room.name} player=${playerId} run=${run.runId} wave=${highestWave} transferred=${saved.body?.transferredItems || 0}`);
    else console.log(`[expedition] completion rejected room=${room.name} player=${playerId} run=${run.runId} error=${saved.error}`);
    return [reply];
  } catch (error) {
    const reply = makeExpeditionReply(session, EXPEDITION_COMMAND.REJECTED, run.runId, "battle_api_failed", false);
    run.completionByPlayer.set(playerId, reply);
    console.log(`[expedition] completion failed room=${room.name} player=${playerId} ${error.message}`);
    return [reply];
  }
}

function broadcastBattleChat(session, payload, type, channel = 0) {
  const room = session?.room;
  if (!room?.players?.size || !payload) return 0;
  const teamOnly = Number(type) === 249;
  let sent = 0;
  for (const playerSession of room.players.values()) {
    if (!playerSession || playerSession === session) continue;
    if (teamOnly && Number(playerSession.team) !== Number(session.team)) continue;
    if (sendReliableToSession(playerSession, payload, channel)) sent += 1;
  }
  return sent;
}

async function handleBattleChatRequest(session, parsed, channel = 0) {
  if (!session?.room || !session.actorId) {
    console.log(`[chat] ignored op=155 reason=no-room actor=${session?.actorId || 0}`);
    return [];
  }
  const requestedMessage = chatRequestText(parsed);
  if (!requestedMessage) return [];
  const staffCommand = parseStaffChatCommand(requestedMessage);
  if (staffCommand) return handleStaffChatCommand(session, staffCommand, channel);
  const message = requestedMessage.slice(0, 160);
  const type = chatRequestType(parsed);
  const event = buildBattleChatEvent(session, message, type);
  const peers = broadcastBattleChat(session, event, type, channel);
  postBattleEvent(session, "chat", {
    message,
    eventData: { type, team: session.team || 0, peers },
  });
  console.log(`[chat] room=${session.room.name} actor=${session.actorId} user=${session.playerId || 0} type=${type} team=${session.team || 0} chars=${message.length} peers=${peers}`);
  return [event];
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

function battleEventPriority(type) {
  return ["join", "death", "exp", "summary", "matchend", "match-end", "leave", "player_report"].includes(String(type || "").toLowerCase())
    ? "high"
    : "normal";
}

function battleEventQueueSize() {
  return battleEventHighQueue.length + battleEventNormalQueue.length;
}

function battleApiQueueSnapshot() {
  return {
    ...battleApiStats,
    inFlight: battleEventInFlight,
    queued: battleEventQueueSize(),
    highQueued: battleEventHighQueue.length,
    normalQueued: battleEventNormalQueue.length,
    profileInFlight: profileLoadInFlight,
    profileQueued: profileLoadQueue.length,
  };
}

async function executeBattleEventJob(job) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/battle/event`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(API_TOKEN ? { "x-battle-token": API_TOKEN } : {}),
    },
    body: JSON.stringify(job.body),
  }, BATTLE_EVENT_TIMEOUT_MS);
  if (!response?.ok) throw new Error(`status=${response?.status ?? "no-response"}`);
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  emitAchievementEvents(job.session, result?.achievements);
}

function drainBattleEventQueue() {
  while (battleEventInFlight < BATTLE_EVENT_CONCURRENCY && battleEventQueueSize() > 0) {
    const job = battleEventHighQueue.shift() || battleEventNormalQueue.shift();
    battleEventInFlight += 1;
    executeBattleEventJob(job)
      .then(() => {
        battleApiStats.completed += 1;
        job.resolve(true);
      })
      .catch((error) => {
        battleApiStats.failed += 1;
        if (String(error?.message || "").includes("timeout")) battleApiStats.timedOut += 1;
        job.resolve(false);
      })
      .finally(() => {
        battleEventInFlight -= 1;
        drainBattleEventQueue();
      });
  }
}

function postBattleEvent(session, type, extra = {}) {
  if (!API_BASE_URL || typeof fetch !== "function") return Promise.resolve(false);
  const priority = battleEventPriority(type);
  if (battleEventQueueSize() >= BATTLE_EVENT_QUEUE_MAX) {
    if (priority !== "high") {
      battleApiStats.dropped += 1;
      return Promise.resolve(false);
    }
    const displaced = battleEventNormalQueue.shift() || battleEventHighQueue.shift();
    if (displaced) {
      battleApiStats.dropped += 1;
      displaced.resolve(false);
    }
  }
  return new Promise((resolve) => {
    const job = {
      session,
      type,
      priority,
      body: jsonForDb(session, { type, ...extra }),
      resolve,
    };
    if (priority === "high") battleEventHighQueue.push(job);
    else battleEventNormalQueue.push(job);
    battleApiStats.queued += 1;
    drainBattleEventQueue();
  });
}

function recordMoveTelemetry(session) {
  if (!session) return;
  const current = battleMoveTelemetry.get(session) || { moves: 0, lastRoomMoveCount: 0 };
  current.moves += 1;
  current.lastRoomMoveCount = Number(session.room?.moves || current.lastRoomMoveCount || 0);
  battleMoveTelemetry.set(session, current);
  battleApiStats.moveSamples += 1;
}

function flushMoveTelemetry() {
  const snapshot = battleMoveTelemetry;
  battleMoveTelemetry = new Map();
  if (snapshot.size <= 0) return;
  battleApiStats.moveFlushes += 1;
  for (const [session, telemetry] of snapshot) {
    if (!session || Number(session.playerId || 0) <= 1) continue;
    postBattleEvent(session, "move", {
      eventData: {
        count: telemetry.lastRoomMoveCount,
        moves: telemetry.moves,
        windowMs: BATTLE_MOVE_FLUSH_MS,
      },
    });
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

function clanTreasuryDeliveryKey(clanId, eventId) {
  const normalizedClanId = Number(clanId || 0);
  const normalizedEventId = Number(eventId || 0);
  if (!Number.isInteger(normalizedClanId) || normalizedClanId <= 0) return "";
  if (!Number.isInteger(normalizedEventId) || normalizedEventId <= 0) return "";
  return `${normalizedClanId}:${normalizedEventId}`;
}

function cachedClanTreasuryEvent(clanId, eventId) {
  const key = clanTreasuryDeliveryKey(clanId, eventId);
  return key ? clanTreasuryLiveEvents.get(key) || null : null;
}

function rememberClanTreasuryEvent(prepared) {
  const key = clanTreasuryDeliveryKey(prepared?.clanId, prepared?.eventId);
  if (!key) return null;
  let state = clanTreasuryLiveEvents.get(key);
  if (!state) {
    state = {
      prepared,
      deliveredSessions: new WeakSet(),
      at: Date.now(),
    };
    clanTreasuryLiveEvents.set(key, state);
  } else {
    state.prepared = prepared;
    state.at = Date.now();
  }
  while (clanTreasuryLiveEvents.size > 4096) {
    const oldest = clanTreasuryLiveEvents.keys().next().value;
    if (!oldest) break;
    clanTreasuryLiveEvents.delete(oldest);
  }
  return state;
}

function activeMasterSessionList() {
  const result = new Set();
  for (const [playerId] of masterSessionsByPlayerId.entries()) {
    for (const session of activeMasterSessionsForUser(playerId)) result.add(session);
  }
  return Array.from(result);
}

function rawClanEventEnvelopeForClient(eventCode, clanId, clanDataRaw) {
  // SendClanEvent serializes request-envelope keys as Byte, but the receiving
  // ClanManager.OnServerRequest looks them up as boxed Int32 keys.
  return rawHashtable([
    { key: rawInt(0), value: rawInt(eventCode) },
    { key: rawInt(1), value: rawInt(clanId) },
    { key: rawInt(2), value: clanDataRaw || rawHashtable([]) },
  ]);
}

function makeServerClanTreasuryEvent(item) {
  // Exact DB rows use `id`; cached canonical events already use `eventId`.
  const eventId = Number(item?.id || item?.eventId || 0);
  const clanId = Number(item?.clanId || 0);
  const playerId = Number(item?.playerId || 0);
  const money = Number(item?.money || 0);
  const playerName = String(item?.playerName || "");
  if (!eventId || !clanId || !playerId || money <= 0) return null;
  const clanData = rawHashtable([
    { key: rawInt(0), value: rawInt(playerId) },
    { key: rawInt(1), value: rawInt(money) },
    { key: rawInt(2), value: rawString(playerName) },
    { key: rawInt(3), value: rawInt(eventId) },
  ]);
  const envelope = rawClanEventEnvelopeForClient(CLAN_TREASURY_EVENT_ADD, clanId, clanData);
  return {
    eventId,
    clanId,
    playerId,
    playerName,
    money,
    payload: rawMasterEvent(209, playerId, envelope),
  };
}

function deliverClanTreasuryEvent(prepared, targetSessions, source = "server-feed") {
  const state = rememberClanTreasuryEvent(prepared);
  if (!state) return { processed: true, sent: 0, invalid: true };
  const sessionsToNotify = Array.from(targetSessions || activeMasterSessionList());
  if (sessionsToNotify.length === 0) {
    console.log(`[master-social] clan-treasury cached clan=${prepared.clanId} event=${prepared.eventId} source=${source} reason=no-master-sessions`);
    return { processed: true, sent: 0, skipped: 0, failed: 0, noSessions: true };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const targetSession of sessionsToNotify) {
    if (!targetSession || typeof targetSession !== "object") continue;
    if (state.deliveredSessions.has(targetSession)) {
      skipped += 1;
      continue;
    }
    if (!sendReliableToSession(targetSession, prepared.payload, targetSession.lastChannel || 0)) {
      failed += 1;
      continue;
    }
    state.deliveredSessions.add(targetSession);
    sent += 1;
  }

  console.log(`[master-social] clan-treasury-deliver clan=${prepared.clanId} event=${prepared.eventId} player=${prepared.playerId} money=${prepared.money} sessions=${sent} skipped=${skipped} failed=${failed} source=${source}`);
  return {
    processed: failed === 0 || sent > 0 || skipped > 0,
    sent,
    skipped,
    failed,
  };
}

function pushServerClanTreasuryEvent(item, options = {}) {
  const prepared = makeServerClanTreasuryEvent(item);
  if (!prepared) return { processed: true, sent: 0, invalid: true };
  return deliverClanTreasuryEvent(
    prepared,
    options.targetSessions || null,
    String(options.source || "server-feed")
  );
}

async function loadCommittedClanTreasuryEvent(eventId, clanId, playerId) {
  const cached = cachedClanTreasuryEvent(clanId, eventId);
  if (cached?.prepared) return cached.prepared;
  if (!API_TOKEN) return null;

  const response = await postApiJson("/battle/clan-events", {
    eventId,
    clanId,
    playerId,
  });
  if (!response || response.ok === false || !Array.isArray(response.events)) {
    throw new Error(response?.error || "invalid-clan-treasury-exact-response");
  }
  const item = response.events[0];
  if (!item) return null;
  if (
    Number(item.id) !== Number(eventId) ||
    Number(item.clanId) !== Number(clanId) ||
    Number(item.playerId) !== Number(playerId) ||
    Number(item.type) !== CLAN_TREASURY_RECORD_ADD
  ) {
    throw new Error("clan-treasury-exact-identity-mismatch");
  }
  return item;
}

async function runClanTreasuryLivePoll() {
  if (clanTreasuryPollInFlight || !API_TOKEN || CLAN_TREASURY_POLL_MS <= 0) return;
  clanTreasuryPollInFlight = true;
  try {
    const response = await postApiJson("/battle/clan-events", {
      afterId: clanTreasuryPollCursor,
      initialize: !clanTreasuryPollInitialized,
      limit: CLAN_TREASURY_POLL_LIMIT,
    });
    if (!response || response.ok === false || !Array.isArray(response.events)) {
      throw new Error(response?.error || "invalid-clan-treasury-feed");
    }
    if (!clanTreasuryPollInitialized) {
      clanTreasuryPollCursor = Math.max(0, Number(response.cursor || 0));
      clanTreasuryPollInitialized = true;
      console.log(`[master-social] clan-treasury-poll initialized cursor=${clanTreasuryPollCursor}`);
      return;
    }
    for (const item of response.events) {
      const eventId = Number(item?.id || 0);
      if (!Number.isInteger(eventId) || eventId <= clanTreasuryPollCursor) continue;
      // The contributing client always emits the original Event209 immediately
      // after the HTTP commit. Its echo must travel as the response to that
      // reliable operation; the feed is only the live path for other sessions.
      const contributorId = Number(item?.playerId || 0);
      const feedSessions = activeMasterSessionList()
        .filter((targetSession) => Number(targetSession?.playerId || 0) !== contributorId);
      const result = pushServerClanTreasuryEvent(item, {
        targetSessions: feedSessions,
        source: "server-feed",
      });
      if (!result.processed) break;
      clanTreasuryPollCursor = eventId;
    }
  } catch (error) {
    const now = Date.now();
    if (now - clanTreasuryPollLastErrorAt >= 30000) {
      clanTreasuryPollLastErrorAt = now;
      console.log(`[master-social] clan-treasury-poll failed after=${clanTreasuryPollCursor} ${error.message}`);
    }
  } finally {
    clanTreasuryPollInFlight = false;
  }
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
      // ServersList.ConnectFriend compares the social connection string with
      // ServerItem.Ports[0]. Rooms are process-global across battle ports, so
      // advertise the canonical first battle port rather than the incidental
      // port used by this player's current session.
      serverId: `${PUBLIC_HOST}:${PRIMARY_BATTLE_PORT}`,
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
  if (eventCode === 209) {
    if (!data?.raw) return [];
    const clanEventCode = Number(htGet(data, 0)?.value || 0);
    const clanId = Number(htGet(data, 1)?.value || 0);
    const clanEventData = htGet(data, 2);
    const subjectUserId = Number(htGet(clanEventData, 0)?.value || 0);
    const treasuryEventId = clanEventCode === CLAN_TREASURY_EVENT_ADD
      ? Number(htGet(clanEventData, 3)?.value || 0)
      : 0;

    if (clanEventCode === CLAN_TREASURY_EVENT_ADD) {
      if (clanId <= 0 || treasuryEventId <= 0 || subjectUserId !== userId) {
        console.log(`[master-social] clan-treasury-signal rejected user=${userId} clan=${clanId} event=${treasuryEventId || 0} subject=${subjectUserId || 0} reason=invalid-identity`);
        return [];
      }

      let committedEvent = null;
      try {
        committedEvent = await loadCommittedClanTreasuryEvent(treasuryEventId, clanId, userId);
      } catch (error) {
        console.log(`[master-social] clan-treasury-signal failed user=${userId} clan=${clanId} event=${treasuryEventId} ${error.message}`);
      }
      if (!committedEvent) {
        console.log(`[master-social] clan-treasury-signal pending user=${userId} clan=${clanId} event=${treasuryEventId} source=client`);
        void runClanTreasuryLivePoll();
        return [];
      }

      const prepared = makeServerClanTreasuryEvent(committedEvent);
      if (!prepared) {
        console.log(`[master-social] clan-treasury-signal rejected user=${userId} clan=${clanId} event=${treasuryEventId} reason=invalid-canonical-event`);
        return [];
      }

      const peerSessions = new Set();
      for (const targetSession of activeMasterSessionList()) {
        if (targetSession !== session) peerSessions.add(targetSession);
      }
      const delivery = peerSessions.size > 0
        ? deliverClanTreasuryEvent(prepared, peerSessions, "client-commit-signal")
        : { processed: true, sent: 0, skipped: 0, failed: 0 };
      const state = rememberClanTreasuryEvent(prepared);
      const senderResponse = state && !state.deliveredSessions.has(session) ? 1 : 0;
      if (senderResponse) state.deliveredSessions.add(session);

      const deliveredSessions = (delivery.sent || 0) + senderResponse;
      console.log(`[master-social] clan-treasury-signal user=${userId} clan=${clanId} event=${treasuryEventId} sessions=${deliveredSessions} response=${senderResponse} peers=${delivery.sent || 0} skipped=${delivery.skipped || 0} failed=${delivery.failed || 0} canonical=database`);
      // Match the original master contract used by chat/friend events: the
      // sender echo is returned from its reliable operation. This puts Event209
      // in the reliable response cache instead of caching an empty response.
      return senderResponse ? [prepared.payload] : [];
    }

    const event = rawMasterEvent(
      209,
      userId,
      rawClanEventEnvelopeForClient(clanEventCode, clanId, clanEventData?.raw)
    );

    if (clanEventCode === CLAN_EVENT_ADD_EVENT) {
      // Delete/leave/remove are applied by ClanManager only after this Event209
      // makes it back to the sender and triggers act=gevnt. Return the sender
      // echo through the reliable operation response so retries cache Event209
      // instead of an empty response; peers still receive their direct push.
      const invalidatedProfiles = invalidateClanProfileCache(clanId);
      let peerSent = 0;
      let subjectSent = 0;
      for (const targetSession of activeMasterSessionList()) {
        if (targetSession === session) continue;
        if (!sendReliableToSession(targetSession, event, targetSession.lastChannel || 0)) continue;
        peerSent += 1;
        if (subjectUserId > 0 && Number(targetSession.playerId || 0) === subjectUserId) subjectSent += 1;
      }
      console.log(`[master-social] clan-event user=${userId} clan=${clanId} code=${clanEventCode} subject=${subjectUserId || 0} sessions=${peerSent + 1} sender=1 subjectSessions=${subjectSent + (subjectUserId === userId ? 1 : 0)} response=1 peers=${peerSent} profileCache=${invalidatedProfiles}`);
      return [event];
    }

    if (clanEventCode === CLAN_EVENT_CHANGE_ARM) {
      // The owner applies a changed crest only from the incoming Event209. Return
      // that echo from the same reliable operation so retries reuse the cached
      // Event209 instead of caching an empty response. Other active sessions keep
      // the original direct peer broadcast and never receive a duplicate sender echo.
      let peerSent = 0;
      let subjectSent = 0;
      for (const targetSession of activeMasterSessionList()) {
        if (targetSession === session) continue;
        if (!sendReliableToSession(targetSession, event, targetSession.lastChannel || 0)) continue;
        peerSent += 1;
        if (subjectUserId > 0 && Number(targetSession.playerId || 0) === subjectUserId) subjectSent += 1;
      }
      console.log(`[master-social] clan-event user=${userId} clan=${clanId} code=${clanEventCode} subject=${subjectUserId || 0} sessions=${peerSent + 1} sender=1 subjectSessions=${subjectSent} response=1 peers=${peerSent}`);
      return [event];
    }

    const targetSessions = new Set([session]);
    for (const [playerId] of masterSessionsByPlayerId.entries()) {
      for (const targetSession of activeMasterSessionsForUser(playerId)) {
        targetSessions.add(targetSession);
      }
    }
    let sent = 0;
    let senderSent = 0;
    let subjectSent = 0;
    for (const targetSession of targetSessions) {
      if (!sendReliableToSession(targetSession, event, targetSession.lastChannel || 0)) continue;
      sent += 1;
      if (targetSession === session) senderSent += 1;
      if (subjectUserId > 0 && Number(targetSession.playerId || 0) === subjectUserId) subjectSent += 1;
    }
    console.log(`[master-social] clan-event user=${userId} clan=${clanId} code=${clanEventCode} subject=${subjectUserId || 0} sessions=${sent} sender=${senderSent} subjectSessions=${subjectSent}`);
    return [];
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
  if (session?.moderationDisconnectPending) return [];
  if (parsed.opCode !== 255 && !allowAuthenticatedOperation(session)) return [];

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
      session.lobbyActor = actorParam;
      session.listLobby = true;
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
      session.lobbyActor = actorParam;
      session.listLobby = true;
      warmPlayerProfile(actorParam, "plain-lobby");
      console.log(`[state] plain lobby join accepted port=${port} lobby=${requestedName} actorKeys=${describeHashtable(actorParam)}`);
      return [
        rawOperationResponse(255, [
          { key: 254, value: rawInt(session.actorId) },
          { key: 249, value: makeEmptyActorListRaw() },
          { key: 248, value: session.roomRaw },
        ]),
        // MainNetworkController's friend/quick-connect branch waits for the
        // lobby's first Event252 -> PhotonEvent86 before it calls JoinRoom.
        // Photon sends the current room snapshot on lobby entry; requiring a
        // manual OpRaiseEvent(86) here leaves QuickConnect stuck indefinitely.
        makeRoomListEvent(session),
      ];
    }

    const settings = roomSettingsFrom(roomPropsParam);
    settings.name = settings.name || requestedName || DEFAULT_ROOM;
    if (settings.hasFullSettings === false) {
      const joinRoom = rooms.get(settings.name);
      if (!joinRoom || ((joinRoom.players?.size || 0) <= 0 && !joinRoom.expeditionReserved)) {
        if (joinRoom && (joinRoom.players?.size || 0) <= 0 && !joinRoom.expeditionReserved) deleteEmptyRoom(joinRoom, "stale-name-join");
        console.log(`[state] room join rejected reason=missing-room name=${settings.name} requested=${requestedName}`);
        return [rawOperationResponse(255, [], -17, "room-not-found")];
      }
      if (!roomPasswordMatches(joinRoom, settings.password)) {
        console.log(`[state] room join rejected reason=invalid-password name=${settings.name}`);
        return [rawOperationResponse(255, [], -12, "invalid-password")];
      }
    }
    const requestedAuthId = Number(htGet(actorParam, 241)?.value || 0);
    const requestedAuthKey = String(htGet(actorParam, 240)?.value || "").trim();
    if (!Number.isFinite(requestedAuthId) || requestedAuthId <= 0 || !requestedAuthKey) {
      console.log(`[state] room join rejected reason=missing-auth requested=${settings.name}`);
      return [rawOperationResponse(255, [], -3, "profile-unavailable")];
    }
    if (settings.hasFullSettings === false) {
      const joinRoom = rooms.get(settings.name);
      if (joinRoom?.expeditionReserved && !expeditionReservationAllowsPlayer(joinRoom, requestedAuthId)) {
        console.log(`[expedition] reserved room join rejected room=${joinRoom.name} player=${requestedAuthId}`);
        return [rawOperationResponse(255, [], -17, "expedition-reservation-required")];
      }
    }
    const joinAttempt = (session.joinAttemptGeneration || 0) + 1;
    session.joinAttemptGeneration = joinAttempt;
    const { profile, source: profileSource } = await profileForJoin(actorParam, { forceRefresh: true });
    if (session.transportDisconnected || session.joinAttemptGeneration !== joinAttempt || !session.sessionId || sessions.get(session.sessionId) !== session) {
      console.log(`[state] room join rejected reason=join-superseded requested=${settings.name} player=${session.playerId || "unknown"}`);
      return [rawOperationResponse(255, [], -3, "join-superseded")];
    }
    if (profile?.accessDenied === true) {
      const requestedCcid = actorCredentials(actorParam).authId;
      invalidatePlayerProfileCache(requestedCcid);
      console.log(`[state] room join rejected reason=access-denied requested=${settings.name} player=${requestedCcid}`);
      return [rawOperationResponse(255, [], -3, "access-denied")];
    }
    if (isFallbackBattleProfile(profile)) {
      const requestedCcid = actorCredentials(actorParam).authId;
      console.log(`[state] room join rejected reason=profile-unavailable requested=${settings.name} player=${requestedCcid}`);
      return [rawOperationResponse(255, [], -3, "profile-unavailable")];
    }
    if (settings.hasFullSettings !== false && settings.password && !staffHasCapability(profile.staffRole, "private_room")) {
      console.log(`[staff] room create rejected player=${profile.authId} role=${normalizeStaffRole(profile.staffRole)} reason=private-room-role`);
      return [rawOperationResponse(255, [], -17, "staff-role-required")];
    }
    if (settings.hasFullSettings === false) {
      const joinRoom = rooms.get(settings.name);
      if (!joinRoom || ((joinRoom.players?.size || 0) <= 0 && !joinRoom.expeditionReserved)) {
        if (joinRoom && (joinRoom.players?.size || 0) <= 0 && !joinRoom.expeditionReserved) deleteEmptyRoom(joinRoom, "stale-name-join-after-profile");
        console.log(`[state] room join rejected reason=missing-room-after-profile name=${settings.name}`);
        return [rawOperationResponse(255, [], -17, "room-not-found")];
      }
      if (!roomPasswordMatches(joinRoom, settings.password)) {
        console.log(`[state] room join rejected reason=invalid-password-after-profile name=${settings.name} player=${profile.authId}`);
        return [rawOperationResponse(255, [], -12, "invalid-password")];
      }
      if (joinRoom.expeditionReserved && !expeditionReservationAllowsPlayer(joinRoom, profile.authId)) {
        console.log(`[expedition] reserved room profile rejected room=${joinRoom.name} player=${profile.authId}`);
        return [rawOperationResponse(255, [], -17, "expedition-reservation-required")];
      }
    }
    const requestedStaffSpectator =
      settings.hasFullSettings === false &&
      Number(settings.guestMode || 0) > 0;
    const staffSpectator =
      requestedStaffSpectator &&
      staffHasCapability(profile.staffRole, "spectator");
    if (requestedStaffSpectator && !staffSpectator) {
      console.log(`[staff] spectator join rejected player=${profile.authId} role=${normalizeStaffRole(profile.staffRole)} room=${settings.name}`);
      return [rawOperationResponse(255, [], -17, "staff-role-required")];
    }
    const capacityRoom = existingRoomForJoin(settings);
    if ((capacityRoom?.players?.size || 0) > 0 && !roomPasswordMatches(capacityRoom, settings.password)) {
      console.log(`[state] room join rejected reason=invalid-password-existing name=${capacityRoom.name} player=${profile.authId}`);
      return [rawOperationResponse(255, [], -12, "invalid-password")];
    }
    if (!staffSpectator && !roomHasCapacityForJoin(capacityRoom, profile.authId, session)) {
      const users = roomOccupancyForJoin(capacityRoom, profile.authId, session);
      const maxUsers = Math.max(1, Number(capacityRoom.maxUsers || 8));
      console.log(`[state] room join rejected reason=room-full name=${capacityRoom.name} users=${users}/${maxUsers} player=${profile.authId}`);
      return [rawOperationResponse(255, [], -11, "room-full")];
    }

    resetReliableDedupe(session, "real-room-join", { clearInFlight: false });
    session.listLobby = false;
    detachSessionFromRoom(session, "rejoin");
    session.playerId = profile.authId;
    session.playerAuthKey = profile.authKey || actorCredentials(actorParam).authKey || "";
    session.playerName = profile.name;
    session.loadedProfile = profile;
    applySessionStaffProfile(session, profile);
    session.isGuest = staffSpectator;
    session.pendingBattleProfile = null;
    session.currentWeaponSlot = 1;
    session.weaponStates = makeWeaponRuntimeState(profile);
    session.peerWeaponConfirmKeys = new Map();
    clearSessionActiveShotLedgers(session);
    clearSessionImpactTimers(session);
    session.dead = staffSpectator;
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
    session.actorId = nextRoomActorId(session.room);
    updateActorWireData(session, actorParam, profile, channel);
    const actorListRaw = makeRoomActorListRaw(session.room, session);
    session.knownActorIds = new Set();
    session.actorJoinAnnouncedAt = new Map();
    markKnownRoomActors(session);
    session.room.players.set(session.actorId, session);
    if (session.room.expeditionReserved && session.room.expeditionReservationPlayerIds instanceof Set && session.room.players.size >= session.room.expeditionReservationPlayerIds.size) {
      session.room.expeditionReserved = false;
      session.room.expeditionReservationPlayerIds = null;
      if (session.room.expeditionReservationTimer) {
        clearTimeout(session.room.expeditionReservationTimer);
        session.room.expeditionReservationTimer = null;
      }
    }
    scheduleRoomListPush("room-join", channel);
    markActorKnown(session, session.actorId);
    session.gameStateRequested = false;
    console.log(`[state] room join accepted room=${session.room.name} map=${session.room.map} mode=${session.room.mode} player=${session.playerId} name=${session.playerName} spectator=${session.isGuest ? "yes" : "no"} profile=${profileSource} wears=${session.actorWearCount || 0} wearList=${session.actorWearSummary || "none"} taunts=${session.actorTauntCount || 0} tauntSlots=${session.actorTauntSummary || "none"} enhancers=${session.actorEnhancerCount || 0} enhancerList=${session.actorEnhancerSummary || "none"} actorKeys=${describeHashtable(actorParam)} actorRaw=${session.actorRaw?.length || 0} peerActorRaw=${session.peerActorRaw?.length || 0} peerSlots=${session.peerActorLoadoutSlots || 0} peerProfile=${session.peerActorProfile || "n/a"} peerHasWears=${session.peerActorHasWears ? "yes" : "no"} peerHasEnhancers=${session.peerActorHasEnhancers ? "yes" : "no"} peerPacket=${session.peerActorRawBytes || 0} joinActorRaw=${session.joinActorRaw?.length || 0} joinSlots=${session.joinActorLoadoutSlots || 0} joinProfile=${session.joinActorProfile || "n/a"} joinHasWears=${session.joinActorHasWears ? "yes" : "no"} joinHasEnhancers=${session.joinActorHasEnhancers ? "yes" : "no"} joinPacket=${session.joinActorRawBytes || 0} joinDeferred=${session.deferredJoinActorIds?.size || 0} roomRaw=${session.roomRaw?.length || 0}`);
    postBattleEvent(session, "join", { playerData: { remote: rinfo.address, name: session.playerName } });
    broadcastMasterUserState(session.playerId);
    const responses = buildJoinAccepted(port, socket, rinfo, session, channel, actorListRaw, {
      waitForProfile: false,
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

  if (parsed.opCode === 155) {
    return handleBattleChatRequest(session, parsed, channel);
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

  if (eventCode === 207) {
    // GameLogicEventCode.Change. The original client sends key 51=changeType
    // for inventory(1), weapons(2), clothes(3), abilities(4), taunts(5),
    // clan/enhancers/name/stats(6..12). They all feed the same battle profile.
    const data = eventDataHash(parsed);
    const changeType = Number(htGet(data, 51)?.value || 0);
    markPlayerProfileChanged(session.playerId, changeType);
    return [];
  }

  if (eventCode === 155) {
    return handleBattleChatRequest(session, parsed, channel);
  }

  if (eventCode === EXPEDITION_EVENT) {
    return handleExpeditionRequest(session, parsed, channel);
  }

  if (eventCode === VOICE_CAPABILITY_EVENT) {
    return handleVoiceCapability(session, parsed);
  }

  if (eventCode === VOICE_FRAME_EVENT) {
    return handleVoiceFrame(session, parsed);
  }

  if (eventCode === PLAYER_REPORT_EVENT) {
    return handlePlayerReport(session, parsed);
  }

  if (eventCode === STAFF_FLIGHT_EVENT) {
    return handleStaffFlightRequest(session, parsed);
  }

  if (eventCode === 70) {
    return handleKickRequest(session, parsed, channel);
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
    if (!session.isGuest && !isZombieRoom(session.room) && !isStandardRoundPaused(session.room)) {
      startStandardRound(session.room, channel, "pre-gamestate");
    }
    const responses = [
      ...buildDeferredPeerActorJoinEvents(session, channel),
      rawEvent(84, [
        { key: 254, value: rawInt(session.actorId) },
        { key: 245, value: makeGameStateRaw(session) },
      ]),
    ];
    if (session.isGuest) {
      queuePeerActorRepair(session, channel, "post-gamestate-spectator");
      console.log(`[staff] spectator game-state actor=${session.actorId} player=${session.playerId || 0} room=${session.room?.name || DEFAULT_ROOM}`);
      return responses;
    }
    if (isZombieRoom(session.room)) {
      const zombieStarted = maybeStartZombieRound(session.room, channel, "post-gamestate", session, responses);
      if (!zombieStarted) {
        keepZombieLateJoinSpectator(session);
      }
      if (!session.spawned) {
        console.log(`[zombie] waiting actor=${session.actorId} ready=${zombieReadyPlayers(session.room).length}/${ZOMBIE_MIN_PLAYERS} mode=${zombieModeForRoom(session.room)}`);
      }
    } else if (isStandardRoundPaused(session.room)) {
      console.log(`[round] game-state pause actor=${session.actorId} room=${session.room.name} waiting-restart=yes`);
    } else if (isCtfRoom(session.room) && !session.spawned) {
      console.log(`[event] waiting client team selection actor=${session.actorId} mode=${roomMode(session)} room=${session.room?.name || DEFAULT_ROOM}`);
    } else if (AUTO_SPAWN_AFTER_GAMESTATE && !session.spawned && !isTeamMode(roomMode(session))) {
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

  if (session.isGuest) {
    // Guest actors are camera-only. Event84 above remains available so the
    // original client can construct all remote players and TPS cameras.
    console.log(`[staff] spectator event ignored actor=${session.actorId} code=${eventCode}`);
    return [];
  }

  if (eventCode === 100) {
	clearStaffFlightState(session, "spawn-request");
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
    runtimeMetrics.moves += 1;
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
    recordMoveTelemetry(session);
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
          if (VERBOSE_GAMEPLAY_LOGS) console.log(`[sync] shot-weapon-confirm actor=${session.actorId} peers=${confirmPeers} slot=${state.slot} type=${state.type} name=${state.systemName}`);
        }
      }
      broadcastReliableToRoom(session, response.shotEvent, channel, "shot", { requireMoveSeen: true });
      for (const impactEvent of response.impactEvents || []) {
        broadcastReliableToRoom(session, impactEvent, channel, "impact", { requireMoveSeen: true });
      }
      for (const killEvent of response.killEvents || []) {
        broadcastReliableToRoom(session, killEvent, channel, "kill");
      }
      for (const enhancerScoreEvent of response.enhancerScoreEvents || []) {
        broadcastReliableToRoom(session, enhancerScoreEvent, channel, "score-enhancer");
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
          ...(response.enhancerScoreEvents || []),
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
        if (VERBOSE_GAMEPLAY_LOGS) console.log(`[sync] weapon-change actor=${session.actorId} peers=${weaponPeers.total} reliable=${weaponPeers.reliable} spectator=${weaponPeers.spectator}${weaponPeers.spectator ? ` spectatorChannel=${weaponPeers.spectatorChannel}` : ""}`);
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
  if (VERBOSE_GAMEPLAY_LOGS) console.log(`[event] ack only code=${eventCode}`);
  return [];
}

async function handleUdp(port, socket, msg, rinfo) {
  if (!Buffer.isBuffer(msg) || msg.length < 12 || msg.length > MAX_UDP_DATAGRAM_BYTES) {
    runtimeMetrics.udpInboundDropped += 1;
    if (rinfo?.address) recordInvalidUdpPacket(rinfo.address);
    return;
  }
  if (!allowUdpPacket(rinfo, msg.length)) {
    runtimeMetrics.udpInboundDropped += 1;
    return;
  }
  runtimeMetrics.udpInboundPackets += 1;
  runtimeMetrics.udpInboundBytes += msg.length;

  let offset = 12;
  const sessionId = key(port, rinfo);
  let session = sessions.get(sessionId);
  if (!session) session = pendingSessions.get(sessionId);
  if (!session && !isExactEnetConnectPacket(msg) && readU16(msg, 0) !== 0xffff && readU32(msg, 8) !== 0) {
    const reboundSession = findNatRebindSession(port, msg, rinfo);
    if (reboundSession) {
      session = rebindSessionEndpoint(reboundSession, sessionId, socket, rinfo);
    }
  }
  if (!session) {
    if (isIpQuarantined(rinfo.address)) return;
    if (!isExactEnetConnectPacket(msg)) {
      recordInvalidUdpPacket(rinfo.address);
      return;
    }
    session = storePendingSession(makePendingSession(port, socket, rinfo, sessionId, readU32(msg, 8), Date.now()));
    if (!session) return;
  }
  const incomingChallenge = readU32(msg, 8);
  if (session.challenge && incomingChallenge && session.challenge !== incomingChallenge) {
    if (session.pendingHandshake) {
      if (!isExactEnetConnectPacket(msg)) return;
      deletePendingSession(session);
      session = storePendingSession(makePendingSession(port, socket, rinfo, sessionId, incomingChallenge, Date.now()));
      if (!session) return;
    } else {
      resetTransportForReconnect(session, `challenge-change ${session.challenge}->${incomingChallenge}`);
    }
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
  let lastChannel = Number.isInteger(Number(session.lastChannel)) ? Number(session.lastChannel) : 0;
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
      const inboundChannel = ensureInboundReliableChannel(session, channel);
      if (reliableSequenceCompare(inboundChannel.expectedSeq, reliableSeq) <= 0) {
        inboundChannel.expectedSeq = nextReliableSequence(reliableSeq);
      }
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
        if (session.pendingHandshake) {
          deletePendingSession(session);
        } else {
          const disconnectedRoom = session.room?.name || "none";
          detachMasterSession(session, "enet-disconnect");
          detachSessionFromRoom(session, "enet-disconnect");
          if (session.sessionId) deleteFullSession(session.sessionId, session);
          console.log(`[state] enet disconnect port=${port} actor=${session.actorId || 0} player=${session.playerId || "unknown"} room=${disconnectedRoom}`);
        }
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
      const reliableCommand = commandType === 0x06 || commandType === 0x08;
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
        if (session.pendingHandshake && (fragment.fragmentCount > PENDING_FRAGMENT_COUNT_MAX || fragment.totalLength > PENDING_FRAGMENT_TOTAL_BYTES_MAX)) {
          recordInvalidUdpPacket(rinfo.address);
          offset = commandEnd;
          continue;
        }
        cacheKey = reliableFragmentCacheKey(session, channel, fragment.startSeq);
      }
      const cachedResponse = cacheKey ? getCachedReliableResponse(session, cacheKey) : null;
      if (cachedResponse) {
        const cached = cachedResponse;
        commands.push(...cached);
        logReliableReplay(session, channel, commandType === 0x08 ? fragment.startSeq : reliableSeq, cached.length, commandType === 0x08 ? ` fragmentStart=${fragment.startSeq}` : "");
        offset = commandEnd;
        continue;
      }
      if (cacheKey && session.reliableInFlight.has(cacheKey)) {
        logReliableReplay(session, channel, commandType === 0x08 ? fragment.startSeq : reliableSeq, 0, `${commandType === 0x08 ? ` fragmentStart=${fragment.startSeq}` : ""} inFlight=yes`);
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
        // Voice uses its own unreliable channel. Do not let its 50 packets/s
        // replace the gameplay channel used by delayed reliable repairs.
        if (!isVoiceEvent(parsed)) {
          lastChannel = channel;
          session.lastChannel = channel;
        }
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

        if (!reliableCommand) {
          commands.push(...await buildReliableCommands());
          offset = commandEnd;
          continue;
        }

        const startSeq = Number(commandType === 0x08 ? fragment.startSeq : reliableSeq) >>> 0;
        const endSeq = commandType === 0x08
          ? ((startSeq + Math.max(1, Number(fragment.fragmentCount) || 1) - 1) >>> 0)
          : startSeq;
        const generation = Number(session.reliableGeneration || 0);
        const execute = () => {
          const existing = getCachedReliableResponse(session, cacheKey);
          if (existing) return Promise.resolve(existing);
          const inFlight = session.reliableInFlight.get(cacheKey);
          if (inFlight) return inFlight;
          const promise = buildReliableCommands()
            .then((reliableCommands) => cacheReliableResponse(session, cacheKey, reliableCommands))
            .finally(() => {
              if (session.reliableInFlight.get(cacheKey) === promise) session.reliableInFlight.delete(cacheKey);
            });
          session.reliableInFlight.set(cacheKey, promise);
          return promise;
        };
        const queued = enqueueInboundReliableRequest(session, {
          channel,
          startSeq,
          endSeq,
          cacheKey,
          execute,
        });
        if (queued.status === "ready" || queued.status === "buffered") {
          queued.request.onComplete = (reliableCommands) => {
            if (session.transportDisconnected || Number(session.reliableGeneration || 0) !== generation) return;
            if (!reliableCommands?.length || !session.socket || !session.rinfo) return;
            sendPacket(session.socket, session.rinfo, session, reliableCommands);
          };
          queued.request.onError = (error) => {
            console.log(`[guard] inbound-reliable-buffered actor=${session.actorId || 0} channel=${channel} seq=${startSeq} reason=${error.message}`);
          };
          queued.completion.catch(() => {});
          if (DEBUG_PACKETS && queued.status === "buffered") {
            console.log(`[state] reliable buffered actor=${session.actorId || 0} channel=${channel} seq=${startSeq} expected=${ensureInboundReliableChannel(session, channel).expectedSeq}`);
          }
        } else if (queued.status === "stale") {
          const staleCached = getCachedReliableResponse(session, cacheKey);
          if (staleCached) commands.push(...staleCached);
          logReliableReplay(session, channel, startSeq, staleCached?.length || 0, " stale=yes");
        } else if (queued.status === "duplicate") {
          logReliableReplay(session, channel, startSeq, 0, " pending=yes");
        } else if (queued.status === "overflow") {
          queued.completion.catch((error) => {
            console.log(`[security] inbound reliable overflow actor=${session.actorId || 0} channel=${channel} seq=${startSeq} reason=${error.message}`);
          });
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
    if (transportDisconnected) sendPacketNow(socket, rinfo, session, commands, peerIdOverride);
    else sendPacket(socket, rinfo, session, commands, peerIdOverride);
  }
}

console.log(`[config] build=${BUILD_ID} host=${PUBLIC_HOST} api=${API_BASE_URL} initReply=${INIT_REPLY} teamMode=${FORCE_TEAM_MODE ? "team" : "room"} autoSpawn=${AUTO_SPAWN_AFTER_GAMESTATE ? "on" : "off"} retry=${AUTO_SPAWN_RETRY_LIMIT}x${AUTO_SPAWN_RETRY_MS}ms spawnNoMoveWarn=${SPAWN_NO_MOVE_WARN_MS}ms spawnSelfRetry=${formatDelayList(SPAWN_SELF_RETRY_DELAYS_MS)} reliableRetry=${OUTBOUND_RELIABLE_INITIAL_RTO_MS}ms/x2/count${OUTBOUND_RELIABLE_SENT_COUNT_ALLOWANCE}/timeout${OUTBOUND_RELIABLE_DISCONNECT_MS}ms debugPackets=${DEBUG_PACKETS ? "on" : "off"} sendLog=${LOG_SEND_PACKETS ? "on" : "off"} moveLogEvery=${MOVE_LOG_EVERY} moveBroadcast=${MOVE_BROADCAST_UNRELIABLE ? "unreliable" : "reliable"} spawnIndex=${SPAWN_INDEX || "actor"} spawnYOffset=${SPAWN_Y_OFFSET || 0} joinLoadoutSlots=${JOIN_LOADOUT_SLOT_LIMIT} peerLoadout=mandatory-full:${FULL_LOADOUT_SLOT_LIMIT} legacyWeaponFields=${INCLUDE_WEAPON_LEGACY_FIELDS ? "on" : "off"} joinWears=${INCLUDE_JOIN_WEARS ? "on" : "off"} battleEnhancers=${INCLUDE_BATTLE_ENHANCERS ? "on" : "off"} battleTaunts=on joinTauntCompact=on trainingAbilities=${APPLY_TRAINING_ABILITY_BONUSES ? "runtime-on" : "runtime-off"} weaponWorkshop=on dossierStats=on deferredPeerWears=on actorEchoFields=${INCLUDE_JOIN_ACTOR_ECHO_FIELDS ? "on" : "off"} gameStateActor=${INCLUDE_ACTOR_IN_GAMESTATE ? "on" : "off"} gameStatePeers=${INCLUDE_PEERS_IN_GAMESTATE ? "on" : "off"} gameStateRepeat=${GAMESTATE_REPEAT_MIN_MS}ms maxUdp=${MAX_UDP_PACKET_BYTES} actorJoinMax=${ACTOR_JOIN_MAX_PACKET_BYTES} gameStateScore=actorRaw liveScoreUpdate=on killfeed=gameState dominationStreak=${DOMINATION_STREAK_KILLS} battleExp=${ENABLE_BATTLE_EXP ? "on" : "off"} expPerKill=${BATTLE_EXP_PER_KILL} peerSpawnAfterSelf=${REPLAY_PEER_SPAWNS_AFTER_SELF ? "on" : "off"} peerSpawnConfirm=${CONFIRM_PEER_SPAWN_AFTER_ISENEMY ? "on" : "off"} peerActorRepair=${formatDelayList(PEER_ACTOR_REPAIR_DELAYS_MS)} joinSelfDelay=${JOIN_SELF_EVENT_DELAY_MS}ms joinSelfProfileWait=${JOIN_SELF_PROFILE_WAIT_MS}ms joinProfileRetry=${JOIN_PROFILE_RETRY_MS}ms joinProfileMax=${JOIN_PROFILE_MAX_WAIT_MS}ms allowFallbackJoin=${ALLOW_FALLBACK_JOIN_PROFILE ? "on" : "off"} joinStartFallback=${JOIN_START_EVENT_FALLBACK_DELAY_MS}ms joinSettingsPush=${formatDelayList(JOIN_SETTINGS_PUSH_DELAYS_MS)} joinLateStart=${formatDelayList(JOIN_LATE_START_DELAYS_MS)} actorJoinAsyncDelay=${ACTOR_JOIN_ASYNC_DELAY_MS}ms profileJoinWait=${PROFILE_JOIN_WAIT_MS}ms cachedJoinRefresh=on interpolationMode=${ROOM_INTERPOLATION_MODE} moveRotationKey7=${ADD_MOVE_ROTATION_KEY ? "on" : "off"} destroyGeometry=${DESTROY_GEOMETRY ? "on" : "off"} rapidityNormalize=${NORMALIZE_WEAPON_RAPIDITY ? "on" : "off"} shotSlack=${SHOT_THROTTLE_SLACK_MS}ms mapPickups=${ENABLE_MAP_PICKUPS ? "on" : "off"} pickupGameState=${MAP_PICKUPS_IN_GAMESTATE ? "on" : "off"} pickupPostSpawn=second-move-response pickupSpawnRepair=${formatDelayList(PICKUP_SPAWN_REPAIR_DELAYS_MS)} pickupRadius=${ITEM_PICKUP_RADIUS} itemRespawn=${ITEM_RESPAWN_MS}ms requirePickupBenefit=${REQUIRE_PICKUP_BENEFIT ? "on" : "off"} damage=${ENABLE_BATTLE_DAMAGE ? "on" : "off"} damageRange=${DAMAGE_SHORT_RANGE}/${DAMAGE_MEDIUM_RANGE} meleeMax=${DAMAGE_MELEE_MAX_DISTANCE} damageRangeSort=${DAMAGE_SORT_RANGES_BY_POWER ? "power-desc" : "raw"} damageMult=head:${DAMAGE_HEAD_MULTIPLIER},headBonusMax:${DAMAGE_MAX_HEAD_BONUS_PERCENT},engine:${DAMAGE_ENGINE_MULTIPLIER},crit:${DAMAGE_CRIT_MULTIPLIER},critChanceMax:${DAMAGE_MAX_CRIT_CHANCE} impactDot=${IMPACT_DOT_TICK_MS}msx${IMPACT_DOT_DEFAULT_TICKS} impactReferenceDmgRed=${IMPACT_REFERENCE_DAMAGE_REDUCTION} explosion=${DAMAGE_EXPLOSION_FULL_RADIUS}/${DAMAGE_EXPLOSION_ZERO_RADIUS} bikerHpFloor=${BIKER_SET_HEALTH_FLOOR} bikerSpeedFloor=${BIKER_SET_SPEED_FLOOR} bikerWeaponSpeedBonus=${BIKER_SET_WEAPON_SPEED_BONUS} shotgunJumpSmall=${SHOTGUN_RECOIL_SMALL_JUMP_BONUS} shotgunJumpBonus=${SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpAbove=${SHOTGUN_RECOIL_ABOVE_AVERAGE_JUMP_BONUS} bigShotgunJumpBonus=${BIG_SHOTGUN_RECOIL_JUMP_BONUS} shotgunJumpHuge=${SHOTGUN_RECOIL_HUGE_JUMP_BONUS} bikerShotgunJumpBonus=${BIKER_SET_SHOTGUN_JUMP_BONUS} maxJump=${MAX_PLAYER_JUMP} maxEnergy=${MAX_PLAYER_ENERGY} lobbyRoomSplit=on reliableDedupe=on reliableFragments=on fragmentTrace=${ENET_FRAGMENT_TRACE ? "on" : "off"} shotResponseTrace=${SHOT_LOCAL_RESPONSE_TRACE ? "on" : "off"} roomSync=on roomIsolation=global-duplicate+empty-prune idlePrune=${ROOM_SESSION_IDLE_MS}ms preSpawnSpectatorLive=${SPECTATOR_LIVE_UNRELIABLE ? (SPECTATOR_MOVE_UNRELIABLE ? "channel1-unreliable-move+animation+weapon" : "channel1-unreliable-animation+weapon") : "blocked"} peerLiveGate=move-seen-only spectatorLiveUnreliable=${SPECTATOR_LIVE_UNRELIABLE ? "on" : "off"} spectatorMoveUnreliable=${SPECTATOR_MOVE_UNRELIABLE ? "on" : "off"} spectatorLiveChannel=${SPECTATOR_LIVE_CHANNEL} gameMasterPort=${GAME_MASTER_PORT} socialMasterPorts=${Array.from(SOCIAL_MASTER_PORTS).join(",")} shotWeaponConfirm=on respawnAmmoReset=on spawnArmorBase0=on projectileLaunchInfer=on projectileSelfDamage=on projectileLaunchKeyLog=on grenadeFlight=${ARCING_LAUNCHER_VELOCITY}/${ARCING_LAUNCHER_LIFE}/${ARCING_LAUNCHER_DISTANCE}`);
console.log(`[config] enhancers active=${Array.from(PASSIVE_BATTLE_ENHANCER_IDS).join(",")} clientVisible=${Array.from(CLIENT_VISIBLE_ENHANCER_IDS).join(",")} expAssist=${BATTLE_EXP_PER_ASSIST} expFlag=${BATTLE_EXP_PER_FLAG} expControl=${BATTLE_EXP_PER_CONTROL_POINT} kamikaze=${ENHANCER_KAMIKAZE_DAMAGE}@${ENHANCER_KAMIKAZE_FULL_RADIUS}/${ENHANCER_KAMIKAZE_ZERO_RADIUS}`);
console.log(`[config] weapon complexReloadAmmoClip=${COMPLEX_RELOAD_AMMO_CLIP_MS}ms remingtonFirstReloadTick=${REMINGTON_FIRST_RELOAD_TICK_MS}ms`);
console.log(`[config] transport inboundOrder=channel-sequence responseCache=${RELIABLE_RESPONSE_CACHE_TTL_MS}ms retryBatch=${OUTBOUND_RELIABLE_RETRY_BATCH_COMMANDS}/sweep recovery=${OUTBOUND_RELIABLE_RECOVERY_MS}ms pendingMax=${OUTBOUND_RELIABLE_PENDING_MAX} natRebind=${ENET_NAT_REBIND_MAX_IDLE_MS}ms outbox=${UDP_OUTBOX_FLUSH_MS}ms/${UDP_OUTBOX_MAX_COMMANDS}cmd/${UDP_OUTBOX_MAX_BYTES}bytes packetMax=${MAX_UDP_PACKET_BYTES} atomicProfileJoin=required`);
console.log(`[config] api battleQueue=${BATTLE_EVENT_CONCURRENCY}/${BATTLE_EVENT_QUEUE_MAX}/timeout${BATTLE_EVENT_TIMEOUT_MS}ms moveFlush=${BATTLE_MOVE_FLUSH_MS}ms profileQueue=${PROFILE_LOAD_CONCURRENCY}/${PROFILE_LOAD_QUEUE_MAX} profileCache=${PROFILE_CACHE_MAX}/${PROFILE_CACHE_TTL_MS}ms profileChangeSettle=${PROFILE_CHANGE_SETTLE_MS}ms/track${PROFILE_CHANGE_TRACK_MS}ms catalogCache=${CATALOG_CACHE_TTL_MS}ms`);
console.log(`[config] zombie minPlayers=${ZOMBIE_MIN_PLAYERS} regularHp=${ZOMBIE_REGULAR_MAX_HEALTH} bossHp=${ZOMBIE_BOSS_MAX_HEALTH} regen=${ZOMBIE_REGEN_TICK_MS}ms regular=${ZOMBIE_REGULAR_REGEN_MIN}-${ZOMBIE_REGULAR_REGEN_MAX} boss=${ZOMBIE_BOSS_REGEN_MIN}-${ZOMBIE_BOSS_REGEN_MAX} updateRepair=${formatDelayList(ZOMBIE_UPDATE_REPAIR_DELAYS_MS)}`);
console.log(`[config] clanTreasuryLive=${API_TOKEN ? "canonical-db" : "off-token-missing"} delivery=per-session clientSignal=reliable-response clanEventKeys=int32 clanArmSignal=reliable-response poll=${CLAN_TREASURY_POLL_MS}ms limit=${CLAN_TREASURY_POLL_LIMIT}`);
console.log(`[config] moderation kickVote=${KICK_VOTE_DURATION_MS}ms/strict-majority/kick-capable cooldown=${KICK_VOTE_COOLDOWN_MS}ms banJoin=canonical-403-deny`);
console.log(`[config] voice protocol=${VOICE_PROTOCOL_VERSION} signature=${VOICE_PROTOCOL_SIGNATURE} event=${VOICE_FRAME_EVENT}/${VOICE_CAPABILITY_EVENT} channel=${VOICE_CHANNEL} packet=${VOICE_OPUS_FRAME_MS}ms max=${VOICE_RATE_MAX_FRAMES}/s route=ffa+zombie:room,team:own-team`);
console.log(`[security] serviceToken=${API_TOKEN ? "configured" : "missing"} udpDatagramMax=${MAX_UDP_DATAGRAM_BYTES} commandsMax=${MAX_ENET_COMMANDS_PER_PACKET} sessions=${MAX_SESSIONS_TOTAL}/ip${MAX_SESSIONS_PER_IP} pending=${MAX_PENDING_SESSIONS_TOTAL}/ip${MAX_PENDING_SESSIONS_PER_IP}/ttl${PENDING_SESSION_TTL_MS}ms preauthTtl=${PREAUTH_SESSION_TTL_MS}ms udpRate=${UDP_RATE_PACKETS_PER_IP}pkts/${UDP_RATE_BYTES_PER_IP}bytes/${UDP_RATE_WINDOW_MS}ms buckets=${UDP_RATE_BUCKET_CAP}/sweep${UDP_RATE_SWEEP_LIMIT} tcpPerIp=${TCP_MAX_CONNECTIONS_PER_IP} tcpIdle=${TCP_IDLE_TIMEOUT_MS}ms`);

const zombieRegenInterval = setInterval(runZombieRegenerationTick, ZOMBIE_REGEN_TICK_MS);
if (typeof zombieRegenInterval.unref === "function") zombieRegenInterval.unref();
const outboundReliableRetryInterval = setInterval(runOutboundReliableRetries, OUTBOUND_RELIABLE_SWEEP_MS);
if (typeof outboundReliableRetryInterval.unref === "function") outboundReliableRetryInterval.unref();
const sessionSecuritySweepInterval = setInterval(sweepSecurityState, SESSION_SECURITY_SWEEP_MS);
if (typeof sessionSecuritySweepInterval.unref === "function") sessionSecuritySweepInterval.unref();
const udpRateSweepInterval = setInterval(sweepUdpRateBuckets, UDP_RATE_SWEEP_MS);
if (typeof udpRateSweepInterval.unref === "function") udpRateSweepInterval.unref();
const battleMoveFlushInterval = setInterval(flushMoveTelemetry, BATTLE_MOVE_FLUSH_MS);
if (typeof battleMoveFlushInterval.unref === "function") battleMoveFlushInterval.unref();
const runtimeMetricsInterval = setInterval(reportRuntimeMetrics, RUNTIME_METRICS_INTERVAL_MS);
if (typeof runtimeMetricsInterval.unref === "function") runtimeMetricsInterval.unref();
const clanTreasuryPollInterval = setInterval(runClanTreasuryLivePoll, CLAN_TREASURY_POLL_MS);
if (typeof clanTreasuryPollInterval.unref === "function") clanTreasuryPollInterval.unref();
const clanTreasuryInitialPoll = setTimeout(runClanTreasuryLivePoll, 0);
if (typeof clanTreasuryInitialPoll.unref === "function") clanTreasuryInitialPoll.unref();

for (const port of PORTS) {
  const udp = dgram.createSocket("udp4");
  udp.on("error", (error) => {
    console.log(`[udp:${port}] socket error ${error.stack || error.message}`);
  });
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
  tcp.on("error", (error) => {
    console.log(`[tcp:${port}] server error ${error.stack || error.message}`);
  });
  tcp.maxConnections = Math.max(100, MAX_SESSIONS_TOTAL);
  tcp.listen(port, "0.0.0.0", () => console.log(`[tcp] ${port} listening`));
}










