import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const API_BUILD_ID = "railway-api-2026-07-09-clan-lite-multi-invites-v27";
const CREATE_CODE = process.env.CREATE_CODE || "";
const DEFAULT_KEY = process.env.DEFAULT_KEY || "contra-revive-key";
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data", "accounts.json");
const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSET_BUNDLE_DIR = path.join(API_DIR, "assetbundles");
const ASSET_BUNDLE_NAMES = new Set([
  "arena_3lvl.unity3d",
  "zombi_2.unity3d",
  "zombi.unity3d",
  "arenaring.unity3d",
  "bit_map.unity3d",
  "legoturnament.unity3d",
  "inferno.unity3d"
]);
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const DATABASE_URL = process.env.DATABASE_URL || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://contra-city-api-production.up.railway.app").replace(/\/+$/, "");
const ALLOW_DYNAMIC_PUBLIC_ORIGIN = process.env.ALLOW_DYNAMIC_PUBLIC_ORIGIN === "1";

const START_MONEY = Number(process.env.START_MONEY || 1000);
const START_LEVEL = Number(process.env.START_LEVEL || 1);
const START_EXP = Number(process.env.START_EXP || 0);
const START_EXP_MAX = Number(process.env.START_EXP_MAX || 1000);
const LEVEL_EXP_STEP = Math.max(1, Number(process.env.LEVEL_EXP_STEP || START_EXP_MAX || 1000));
const SHOP_PRICE = 100;
const BATTLE_HOST = process.env.BATTLE_HOST || "";
const BATTLE_NAME = process.env.BATTLE_NAME || "Contra City";
const BATTLE_EVENT_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const MAX_REQUEST_URL_BYTES = Math.max(1024, Number(process.env.MAX_REQUEST_URL_BYTES || 16384));
const HTTP_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 15000));
const HTTP_HEADERS_TIMEOUT_MS = Math.max(5000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 10000));
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Math.max(1000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 5000));
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_REQUESTS = Math.max(30, Number(process.env.RATE_LIMIT_REQUESTS || 600));
const BATTLE_RATE_LIMIT_REQUESTS = Math.max(60000, Number(process.env.BATTLE_RATE_LIMIT_REQUESTS || 60000));
const TRUST_PROXY_HEADERS = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID) ||
  process.env.TRUST_PROXY_HEADERS === "1";
const rateLimitBuckets = new Map();
const LAUNCHER_VERSION = process.env.LAUNCHER_VERSION || "1.2.0";
const LAUNCHER_MANIFEST_URL = process.env.LAUNCHER_MANIFEST_URL || "";
const LAUNCHER_UPDATE_KEY = process.env.LAUNCHER_UPDATE_KEY || "";
const GAME_CLASSIC_MANIFEST_URL = process.env.GAME_CLASSIC_MANIFEST_URL ||
  "https://pub-bfbc65832fdd4742ac9dc2f24168c93b.r2.dev/builds/classic/manifest.json";
const GAME_NEW_TEXTURES_MANIFEST_URL = process.env.GAME_NEW_TEXTURES_MANIFEST_URL ||
  "https://pub-bfbc65832fdd4742ac9dc2f24168c93b.r2.dev/builds/new_textures/manifest.json";
const GAME_CLASSIC_UPDATE_KEY = process.env.GAME_CLASSIC_UPDATE_KEY || "";
const GAME_NEW_TEXTURES_UPDATE_KEY = process.env.GAME_NEW_TEXTURES_UPDATE_KEY || "";
const LAUNCHER_SESSION_TTL_MS = Math.max(60000, Number(process.env.LAUNCHER_SESSION_TTL_MS || 6 * 60 * 60 * 1000));
const LAUNCHER_DEVICE_CHALLENGE_TTL_MS = Math.max(30000, Number(process.env.LAUNCHER_DEVICE_CHALLENGE_TTL_MS || 3 * 60 * 1000));
const launcherSessions = new Map();
const launcherDeviceChallenges = new Map();

function safeTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requestClientIp(req) {
  const forwarded = TRUST_PROXY_HEADERS
    ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    : "";
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function requestRatePolicy(pathname) {
  if (pathname === "/create") return { windowMs: 10 * 60 * 1000, limit: 10 };
  // Both endpoints are called by the single battle VPS for all online players.
  // Keep the service token as the real authorization boundary and avoid throttling
  // legitimate aggregate battle/social traffic.
  if (pathname === "/battle/event" || pathname === "/battle/social") {
    return { windowMs: 60000, limit: BATTLE_RATE_LIMIT_REQUESTS };
  }
  if (pathname === "/launcher-session" || pathname === "/launcher-device/challenge" || pathname === "/session" || pathname === "/vk-login") {
    return { windowMs: 60000, limit: 120 };
  }
  return { windowMs: RATE_LIMIT_WINDOW_MS, limit: RATE_LIMIT_REQUESTS };
}

function allowHttpRequest(req, pathname) {
  const now = Date.now();
  const policy = requestRatePolicy(pathname);
  const bucketKey = `${requestClientIp(req)}|${pathname}`;
  let bucket = rateLimitBuckets.get(bucketKey);
  if (!bucket || now - bucket.startedAt >= policy.windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateLimitBuckets.set(bucketKey, bucket);
  }
  bucket.count++;
  if (rateLimitBuckets.size > 10000) {
    for (const [key, value] of rateLimitBuckets) {
      if (now - value.startedAt > 10 * 60 * 1000) rateLimitBuckets.delete(key);
    }
  }
  return bucket.count <= policy.limit;
}

function hasValidBattleServiceToken(req, body) {
  const presented = req.headers["x-battle-token"] || body?.token || "";
  return Boolean(BATTLE_EVENT_TOKEN) && safeTokenEquals(presented, BATTLE_EVENT_TOKEN);
}

function hasValidAdminToken(req) {
  return Boolean(ADMIN_API_TOKEN) && safeTokenEquals(req.headers["x-admin-token"], ADMIN_API_TOKEN);
}

const CLAN_CREATE_LEVEL = 30;
const CLAN_JOIN_LEVEL = 15;
const CLAN_DEFAULT_MAX_MEMBERS = 5;
const CLAN_MAX_MEMBERS = 50;
const CLAN_COSTS = Object.freeze({
  create: 1500,
  requests: 500,
  changeName: 1500,
  changeTag: 1500,
  changeArm: 1500,
  expandMember: 1000,
  expandMembers: [1, 2, 3, 4, 5, 6, 7, 8, 9]
});
const CLAN_ERROR = Object.freeze({
  MISSING_MONEY: 101,
  MISSING_MONEY_TREASURY: 102,
  CLAN_NAME: 350,
  CLAN_NAME_LEN: 351,
  CLAN_NAME_EXIST: 352,
  CLAN_TAG: 353,
  CLAN_TAG_LEN: 354,
  CLAN_TAG_EXIST: 355,
  CLAN_USER_LVL_LESS: 356,
  CLAN_CREATE_YOU_ARE_IN_CLAN: 357,
  CLAN_MEMBER_MAX_COUNT: 358,
  CLAN_URL: 359,
  CLAN_DESC: 360,
  CLAN_ACCESS_DISABLE: 361
});
const CLAN_EVENT_TYPE = Object.freeze({
  DELETE: 1,
  CHANGE_OWNER: 2,
  DELETE_MEMBER: 3,
  LEAVE_MEMBER: 4
});
const CLAN_TREASURY_EVENT_TYPE = Object.freeze({
  ADD: 1,
  EXPAND_MEMBER: 10,
  CHANGE_NAME: 11,
  CHANGE_TAG: 12,
  CHANGE_ARM: 13,
  BUY_ENHANCER: 14
});
const CLAN_ARM_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const CLAN_DEFAULT_ARM_IDS = Object.freeze([1, 6, 7, 9, 10]);
const CLAN_ARM_ID_SET = new Set(CLAN_ARM_IDS);
const CLAN_DEFAULT_ARM_ID_SET = new Set(CLAN_DEFAULT_ARM_IDS);
const CLAN_ARM_ASSET_DIR = path.join(API_DIR, "assets");
const CLAN_ARM_ITEM_TYPE = 5;
const PLAYER_ENHANCER_IDS = Object.freeze([1, 2, 3, 4, 5, 30, 31, 32, 33, 34, 35, 36]);
const CLAN_ENHANCER_IDS = Object.freeze([10, 11, 12, 13, 150, 151, 152, 153, 154, 155, 156, 159, 160, 205, 208, 209]);
const SHOP_ENHANCER_IDS = Object.freeze([...PLAYER_ENHANCER_IDS, ...CLAN_ENHANCER_IDS]);
const CLAN_ENHANCER_ID_SET = new Set(CLAN_ENHANCER_IDS);

const cost = (id, value = 100) => ({
  sc_id: String(id),
  tPv: value,
  tPr: 0,
  tPp: 0
});

const permanentCost = (id, value = 100) => ({
  sc_id: String(id),
  tPv: value,
  tPr: 0,
  tPp: 0
});

const timedPermanentCost = (id, value = 100) => ({
  sc_id: String(id),
  t1v: value,
  t1r: 0,
  t1p: 0,
  t7v: value,
  t7r: 0,
  t7p: 0,
  t30v: value,
  t30r: 0,
  t30p: 0,
  tPv: value,
  tPr: 0,
  tPp: 0
});

const weaponTitleById = {
  1: "Р‘РёС‚Р°",
  2: "РџР°СЂС‚РёР·Р°РЅ",
  3: "РљРѕРјСЂР°Рґ-47",
  4: "РЎС‚Р°С…Р°РЅРѕРІ",
  5: "Р’С‹РЅСЊР§РµСЃС‚РµСЂ",
  6: "РђРІСЂРѕСЂР°",
  7: "РљРѕРјРїРѕСЃС‚РµСЂ",
  10: "Р“РћРЎРў Р‘РёС‚Р°",
  11: "Р“РћРЎРў РџР°СЂС‚РёР·Р°РЅ",
  12: "Р“РћРЎРў РљРѕРјСЂР°Рґ-47",
  13: "Р“РћРЎРў РЎС‚Р°С…Р°РЅРѕРІ",
  14: "Р“РћРЎРў Р’С‹РЅСЊР§РµСЃС‚РµСЂ ",
  15: "Р“РћРЎРў РђРІСЂРѕСЂР° ",
  16: "Р“РћРЎРў РљРѕРјРїРѕСЃС‚РµСЂ",
  17: "Р›РѕРј",
  18: "РљРѕРјРёСЃСЃР°СЂ",
  19: "РњРњРњ-16",
  20: "Р‘РµСЂРёСЏ",
  21: "Р•РіРµСЂСЊ",
  22: "РњРёРЅРё РљР°С‚СЋС€Р°",
  23: "РЎРµСЂРї",
  24: "РЎРІРµСЂС…Р”РµРјР±РµР»СЊ",
  25: "РџСЂРёРјСѓСЃ",
  26: "РќР°С‡Р°Р»СЊРЅРёРє",
  27: "Р”СЂСѓР¶РёРЅРЅРёРє",
  28: "РџРѕР»РёС‚СЂСѓРє",
  29: "РљР»Р°РґРµРЅРµС†",
  30: "РџРѕР»РєР°РЅ",
  31: "РџРѕР±Р°СЂР°Р±Р°РЅС‰РёРє",
  32: "Р С‹Рє",
  33: "Р‘СЋСЂРѕРєСЂР°С‚",
  34: "РќР°РІРѕРґРєР°",
  35: "Р”Р°Р»СЊРЅРѕР±РѕР№С‰РёРє",
  36: "РљР»С‹Рє",
  37: "Р”РѕРЅ",
  38: "РЎРёР±РёСЂСЏРє",
  39: "Р“РћРЎРў РџСЂРёРјСѓСЃ",
  40: "РЎРІРµС‚РѕС‡",
  41: "РЎР°РјСѓСЂР°Р№",
  42: "РљРѕСЃР°СЂСЊ",
  43: "РњР­Р›РЎ",
  44: "Р“СЂР°РЅР°С‚РёРЅ",
  45: "Р“Р°РґСЋРєР°",
  46: "РџР°РІР»РёРє Рњ.",
  47: "Р’СЊСЋРіР°",
  48: "Р›РµРґРѕРІРёРє",
  50: "РџРёСЃРµС†",
  53: "РЎРѕРєРѕР»",
  55: "РЈР±РѕР№РЅРёРє",
  57: "РЎС‚РѕСЂРѕР¶",
  58: "РџСЂРѕРІРѕРєР°С‚РѕСЂ",
  59: "РўСЂРѕР»Р»РµР±СѓР·РёРЅР°",
  60: "Р—Р°СЃР°Рґ",
  61: "Р—РІРµР·РґРѕС‡РµС‚",
  62: "РЎРјРµСЂС‚РѕР±РѕР№",
  63: "Р™РѕР¶",
  64: "Р РµРїРµР№",
  65: "РњР°РєСЃРёРјС‹С‡ РІС‹РєР».",
  66: "РњР°РєСЃРёРјС‹С‡",
  67: "Р РѕР№",
  68: "РЎРїРµРєСѓР»СЏРЅС‚",
  69: "РџСѓСЃС‚С‹РЅРЅС‹Р№ РћСЂРµР»",
  70: "РљСЂРёРє",
  71: "РќРѕРІРѕРіРѕРґРЅСЏСЏ РљР°СЂР°РјРµР»СЊ",
  72: "РћРіРЅРµРЅРЅР°СЏ РљР°СЂР°РјРµР»СЊ",
  73: "Р’РѕР¶РґСЊ",
  74: "Р РѕСЃРѕРјР°С…Р°",
  75: "РЁРµСЂС€РµРЅСЊ",
  76: "Р‘РѕР»СЊС€РµРІРёРє",
  77: "Р’РµРєС‚РѕСЂ",
  78: "Р‘СѓСЂР°РЅ",
  79: "РљРѕР±СЂР°",
  80: "РџРѕРІСЃС‚Р°РЅРµС†",
  92: "Р›РёРєРІРёРґР°С‚РѕСЂ",
  100: "РЎС‚СЂР°Р¶",
  101: "РђРґРІРѕРєР°С‚",
  102: "Р‘Р°СЂСЃ",
  103: "РђРЅР°РєРѕРЅРґР°",
  104: "Р’РѕСЂС‡СѓРЅ",
  105: "РЎРєРёС„",
  106: "РљР°Р±Р°РЅ",
  107: "Р’С‹РјРїРµР»",
  108: "РџР°Р»Р°С‡",
  109: "РЎРѕРІРµС‚РЅРёРє",
  110: "Р‘Р°СЃС‚РёРѕРЅ"
};

const ARCING_LAUNCHER_VELOCITY = 10;
const ARCING_LAUNCHER_LIFE = 7000;
const ARCING_LAUNCHER_DISTANCE = 10;

function weaponBalance(slot, wt, id) {
  const bySlot = {
    1: { ammo: 1, ammo_tot: 1, rap: 340, rt: 0, lt: 250, dev: 2, rad: 8, krit: 8, smindam: 18, smaxdam: 34, mmindam: 12, mmaxdam: 22, lmindam: 8, lmaxdam: 14 },
    2: { ammo: 12, ammo_tot: 60, rap: 240, rt: 2967, lt: 520, dev: 8, rad: 10, krit: 7, smindam: 18, smaxdam: 28, mmindam: 13, mmaxdam: 21, lmindam: 8, lmaxdam: 15 },
    3: { ammo: 30, ammo_tot: 90, rap: 150, rt: 2967, lt: 650, dev: 12, rad: 12, krit: 5, smindam: 16, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 9, lmaxdam: 17 },
    4: { ammo: 90, ammo_tot: 180, rap: 125, rt: 800, lt: 1100, dev: 18, rad: 14, krit: 4, smindam: 13, smaxdam: 22, mmindam: 11, mmaxdam: 18, lmindam: 8, lmaxdam: 14 },
    5: { ammo: 6, ammo_tot: 36, rap: 620, rt: 4500, lt: 900, dev: 24, rad: 18, krit: 6, smindam: 42, smaxdam: 62, mmindam: 22, mmaxdam: 35, lmindam: 8, lmaxdam: 14 },
    6: { ammo: 1, ammo_tot: 8, rap: 900, rt: 2300, lt: 1150, dev: 6, rad: 28, krit: 3, smindam: 78, smaxdam: 120, mmindam: 62, mmaxdam: 95, lmindam: 40, lmaxdam: 72 },
    7: { ammo: 10, ammo_tot: 40, rap: 850, rt: 2967, lt: 1000, dev: 3, rad: 10, krit: 12, smindam: 65, smaxdam: 95, mmindam: 72, mmaxdam: 110, lmindam: 82, lmaxdam: 135 }
  };
  const base = bySlot[slot] || bySlot[3];
  const variant = Number(id % 5);
  const isArcingLauncher = wt === 9 || wt === 15;
  return {
    ...base,
    lt: isArcingLauncher ? ARCING_LAUNCHER_LIFE : base.lt,
    rad: isArcingLauncher ? ARCING_LAUNCHER_DISTANCE : base.rad,
    smindam: base.smindam + variant,
    smaxdam: base.smaxdam + variant,
    mmindam: base.mmindam + variant,
    mmaxdam: base.mmaxdam + variant,
    lmindam: base.lmindam + variant,
    lmaxdam: base.lmaxdam + variant,
    vel: wt === 8 ? 65 : (isArcingLauncher ? ARCING_LAUNCHER_VELOCITY : 100),
    ang: 0
  };
}

function weapon(id, wt, slot, sname, price, extra = {}) {
  const balance = weaponBalance(slot, wt, id);
  return {
    itype: 1,
    id,
    w_id: id,
    wt,
    ws: slot,
    ...balance,
    sname,
    sn: sname,
    name: weaponTitleById[id] || `РћСЂСѓР¶РёРµ ${id}`,
    nlvl: 1,
    iS: 1,
    sc: cost(1000 + id, price),
    ...extra
  };
}

function wear(id, wt, sname, price = 50, slot = null) {
  const text = wearTextFor(slot, sname);
  return {
    itype: 3,
    id,
    w_id: id,
    wt,
    sname,
    sn: sname,
    nlvl: 1,
    iS: 1,
    sc: cost(2000 + id, price),
    ...text
  };
}

function taunt(id, price = 100) {
  return {
    itype: 4,
    t_id: id,
    sname: `taunt_${id}`,
    sn: `taunt_${id}`,
    nlvl: 1,
    iS: 1,
    sc: timedPermanentCost(3000 + id, price)
  };
}

function isClanEnhancerId(id) {
  return CLAN_ENHANCER_ID_SET.has(Number(id));
}

function enhancer(id, price = 120) {
  return {
    itype: 2,
    e_id: id,
    sname: `enhancer_${id}`,
    sn: `enhancer_${id}`,
    nlvl: 1,
    iS: 1,
    iC: isClanEnhancerId(id) ? 1 : 0,
    sc: timedPermanentCost(4000 + id, price)
  };
}

const defaultWeapons = [
  weapon(1, 1, 1, "ohca_basebalbat", 0, { ammo: 0, ammo_tot: 0, smindam: 18, smaxdam: 34, mmindam: 12, mmaxdam: 22, lmindam: 8, lmaxdam: 14 }),
  weapon(2, 3, 2, "hg_makarov", 0, { smindam: 18, smaxdam: 28, mmindam: 13, mmaxdam: 21, lmindam: 8, lmaxdam: 15 }),
  weapon(3, 4, 3, "mg_ak47", 0, { smindam: 16, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 9, lmaxdam: 17 }),
  weapon(4, 6, 4, "gg_m134", 0, { smindam: 13, smaxdam: 22, mmindam: 11, mmaxdam: 18, lmindam: 8, lmaxdam: 14 }),
  weapon(5, 7, 5, "sg_winchester1887", 0),
  weapon(6, 8, 6, "rl_rpg26", 0, { smindam: 78, smaxdam: 120, mmindam: 62, mmaxdam: 95, lmindam: 40, lmaxdam: 72 }),
  weapon(7, 10, 7, "sr_svd", 0, { krit: 8, smindam: 34, smaxdam: 48, mmindam: 38, mmaxdam: 54, lmindam: 42, lmaxdam: 60 })
];

const rebuiltShopWeaponCatalog = [
  { id: 10, slot: 1, sname: "ohca_basebalbat", name: "Р“РћРЎРў Р‘РёС‚Р°", price: 100, stRa: 2, stDa: 2, ammo: 0, ammo_tot: 0 },
  { id: 72, slot: 1, sname: "ohca_candy", name: "РћРіРЅРµРЅРЅР°СЏ РљР°СЂР°РјРµР»СЊ", price: 900, stRa: 2, stDa: 4, ammo: 0, ammo_tot: 0 },
  { id: 71, slot: 1, sname: "ohca_candy2", name: "РќРѕРІРѕРіРѕРґРЅСЏСЏ РљР°СЂР°РјРµР»СЊ", price: 900, stRa: 2, stDa: 3, ammo: 0, ammo_tot: 0 },

  { id: 108, slot: 2, sname: "hg_taurus", name: "РџР°Р»Р°С‡", price: 1900, stRa: 3, stDi: 3, stDa: 5, ammo: 6, ammo_tot: 38 },
  { id: 105, slot: 2, sname: "hg_usp", name: "РЎРєРёС„", price: 1500, stRa: 3, stDi: 3, stDa: 3, ammo: 13, ammo_tot: 45 },
  { id: 69, slot: 2, sname: "HG_DesertB01", name: "РџСѓСЃС‚С‹РЅРЅС‹Р№ РћСЂРµР»", price: 1000, stRa: 2, stDi: 3, stDa: 5, ammo: 7, ammo_tot: 42 },
  { id: 53, slot: 2, sname: "HG_Desert", name: "РЎРѕРєРѕР»", price: 1000, stRa: 3, stDi: 3, stDa: 4, ammo: 7, ammo_tot: 42 },
  { id: 68, slot: 2, sname: "HG_GlockB01_S", name: "РЎРїРµРєСѓР»СЏРЅС‚", price: 1000, stRa: 5, stDi: 2, stDa: 3, ammo: 18, ammo_tot: 108 },

  { id: 101, slot: 3, sname: "mg_assaultrifle02", name: "РђРґРІРѕРєР°С‚", price: 2200, stRa: 4, stDi: 4, stDa: 4, ammo: 35, ammo_tot: 175 },
  { id: 73, slot: 3, sname: "mg_ump45vkks_o", name: "Р’РѕР¶РґСЊ", price: 2100, stRa: 4, stDi: 4, stDa: 5, ammo: 35, ammo_tot: 210 },
  { id: 76, slot: 3, sname: "MG_AUG1_O", name: "Р‘РѕР»СЊС€РµРІРёРє", price: 1000, stRa: 4, stDi: 4, stDa: 4, ammo: 30, ammo_tot: 180 },
  { id: 80, slot: 3, sname: "mg_aug5_o", name: "РџРѕРІСЃС‚Р°РЅРµС†", price: 2300, stRa: 5, stDa: 4, ammo: 30, ammo_tot: 132 },
  { id: 79, slot: 3, sname: "mg_aug4_o", name: "РљРѕР±СЂР°", price: 2300, stRa: 5, stDi: 4, stDa: 4, ammo: 30, ammo_tot: 168 },

  { id: 110, slot: 4, sname: "gg_fnmag", name: "Р‘Р°СЃС‚РёРѕРЅ", price: 2600, stRa: 5, stDi: 3, stDa: 5, ammo: 90, ammo_tot: 270 },
  { id: 67, slot: 4, sname: "gg_m134b03", name: "Р РѕР№", price: 2400, stRa: 5, stDi: 2, stDa: 4, ammo: 100, ammo_tot: 300 },

  { id: 109, slot: 5, sname: "sg_remington", name: "РЎРѕРІРµС‚РЅРёРє", price: 2200, stRa: 2, stDi: 2, stDa: 5, ammo: 3, ammo_tot: 11 },
  { id: 106, slot: 5, sname: "sg_spas", name: "РљР°Р±Р°РЅ", price: 2100, stRa: 2, stDi: 3, stDa: 5, ammo: 6, ammo_tot: 36 },

  { id: 43, slot: 6, sname: "rl_m202a1", name: "РњР­Р›РЎ", price: 2500, stRa: 2, stDi: 5, stDa: 5, ammo: 4, ammo_tot: 16 },
  { id: 44, slot: 6, sname: "gl_milkor", name: "Р“СЂР°РЅР°С‚РёРЅ", price: 2000, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 30 },
  { id: 104, slot: 6, sname: "gl_grenadelauncher03", name: "Р’РѕСЂС‡СѓРЅ", price: 2300, stRa: 3, stDi: 4, stDa: 4, ammo: 3, ammo_tot: 18 },
  { id: 59, slot: 6, sname: "rl_rpg7b02", name: "РўСЂРѕР»Р»РµР±СѓР·РёРЅР°", price: 2600, stRa: 1, stDi: 5, stDa: 5, ammo: 1, ammo_tot: 9 },
  { id: 45, slot: 6, sname: "gl_milkor_a", name: "Р“Р°РґСЋРєР°", price: 2200, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 36 },

  { id: 107, slot: 7, sname: "sr_vintorez", name: "Р’С‹РјРїРµР»", price: 2400, stRa: 4, stDi: 5, stDa: 4, ammo: 20, ammo_tot: 100 },
  { id: 103, slot: 7, sname: "sr_sniperrifle03", name: "РђРЅР°РєРѕРЅРґР°", price: 2300, stRa: 1, stDi: 5, stDa: 5, ammo: 5, ammo_tot: 35 },
  { id: 74, slot: 7, sname: "sr_wildcat1", name: "Р РѕСЃРѕРјР°С…Р°", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16 },
  { id: 75, slot: 7, sname: "sr_wildcat2", name: "РЁРµСЂС€РµРЅСЊ", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16 }
];

const originalReloadTimeMs = {
  ohca_basebalbat: 0,
  ohca_candy: 0,
  ohca_candy2: 0,
  hg_taurus: 2533,
  hg_usp: 2667,
  hg_desertb01: 2533,
  hg_desert: 2533,
  hg_glockb01_s: 2667,
  mg_assaultrifle02: 3000,
  mg_ump45vkks_o: 3000,
  mg_aug1_o: 3000,
  mg_aug5_o: 3000,
  mg_aug4_o: 3000,
  gg_fnmag: 4000,
  gg_m134b03: 800,
  sg_remington: 3864,
  sg_spas: 3500,
  rl_m202a1: 5067,
  rl_rpg7b02: 2967,
  gl_milkor: 6667,
  gl_milkor_a: 6667,
  gl_grenadelauncher03: 4000,
  sr_vintorez: 3167,
  sr_sniperrifle03: 3667,
  sr_wildcat1: 2333,
  sr_wildcat2: 2333
};

// Manual restore balance: no original damage table is available, so these
// values follow the recovered client formulas plus the gameplay hierarchy.
const canonicalShopWeaponStats = {
  ohca_candy: { rap: 330, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 10, ammo: 0, ammo_tot: 0, smindam: 20, smaxdam: 36, mmindam: 14, mmaxdam: 24, lmindam: 9, lmaxdam: 15 },
  ohca_candy2: { rap: 335, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 9, ammo: 0, ammo_tot: 0, smindam: 20, smaxdam: 36, mmindam: 13, mmaxdam: 24, lmindam: 9, lmaxdam: 16 },

  hg_taurus: { rap: 260, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 6, krit: 10, ammo: 6, ammo_tot: 38, smindam: 28, smaxdam: 42, mmindam: 20, mmaxdam: 31, lmindam: 13, lmaxdam: 22 },
  hg_usp: { rap: 205, rt: 2667, lt: 520, vel: 100, rad: 10, ang: 0, dev: 5, krit: 9, ammo: 13, ammo_tot: 45, smindam: 22, smaxdam: 34, mmindam: 17, mmaxdam: 27, lmindam: 11, lmaxdam: 19 },
  hg_desertb01: { rap: 280, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 6, krit: 10, ammo: 7, ammo_tot: 42, smindam: 24, smaxdam: 37, mmindam: 20, mmaxdam: 29, lmindam: 12, lmaxdam: 19 },
  hg_desert: { rap: 260, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 7, krit: 9, ammo: 7, ammo_tot: 42, smindam: 21, smaxdam: 31, mmindam: 14, mmaxdam: 21, lmindam: 11, lmaxdam: 21 },
  hg_glockb01_s: { rap: 150, rt: 2667, lt: 520, vel: 100, rad: 10, ang: 0, dev: 9, krit: 6, ammo: 18, ammo_tot: 108, smindam: 17, smaxdam: 25, mmindam: 12, mmaxdam: 19, lmindam: 9, lmaxdam: 16 },

  mg_assaultrifle02: { rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 9, krit: 6, ammo: 35, ammo_tot: 175, smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19 },
  mg_ump45vkks_o: { rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 6, krit: 8, ammo: 35, ammo_tot: 210, smindam: 23, smaxdam: 36, mmindam: 20, mmaxdam: 31, lmindam: 16, lmaxdam: 26 },
  mg_aug1_o: { desc: "Р РµРІРѕР»СЋС†РёРѕРЅРЅС‹Рµ С‚РµС…РЅРѕР»РѕРіРёРё РїРѕР±РµРґС‹.", desca: "- РќР°РЅРѕСЃРёС‚ РїРµСЂРёРѕРґРёС‡РµСЃРєРёР№ СѓСЂРѕРЅ С‚РёРїР° \"СЏРґ\"", rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 9, krit: 6, ammo: 30, ammo_tot: 180, smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19 },
  mg_aug5_o: { rap: 135, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 8, krit: 8, ammo: 30, ammo_tot: 132, smindam: 21, smaxdam: 33, mmindam: 18, mmaxdam: 29, lmindam: 14, lmaxdam: 24 },
  mg_aug4_o: { rap: 130, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 6, krit: 8, ammo: 30, ammo_tot: 168, smindam: 20, smaxdam: 32, mmindam: 17, mmaxdam: 28, lmindam: 13, lmaxdam: 23 },

  gg_fnmag: { rap: 125, rt: 4000, lt: 1100, vel: 100, rad: 14, ang: 0, dev: 14, krit: 6, ammo: 90, ammo_tot: 270, smindam: 17, smaxdam: 29, mmindam: 15, mmaxdam: 25, lmindam: 11, lmaxdam: 19 },
  gg_m134b03: { rap: 115, rt: 800, lt: 1100, vel: 100, rad: 14, ang: 0, dev: 20, krit: 4, ammo: 100, ammo_tot: 300, smindam: 15, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 10, lmaxdam: 17 },

  sg_remington: {
    desc: "РҐРѕСЂРѕС€РёР№ РёР»Рё РїР»РѕС…РѕР№ СЃРѕРІРµС‚С‡РёРє - СЂРµС€Р°С‚СЊ РІР°Рј.",
    desca: "- РќР°РЅРѕСЃРёС‚ РїРµСЂРёРѕРґРёС‡РµСЃРєРёР№ СѓСЂРѕРЅ С‚РёРїР° \"РєСЂРѕРІРѕС‚РµС‡РµРЅРёРµ\"",
    rap: 660,
    rt: 3864,
    lt: 900,
    vel: 100,
    rad: 18,
    ang: 0,
    dev: 26,
    krit: 11,
    ammo: 3,
    ammo_tot: 11,
    smindam: 58,
    smaxdam: 86,
    mmindam: 34,
    mmaxdam: 52,
    lmindam: 10,
    lmaxdam: 18,
    wsp: 15,
    shake: 1
  },
  sg_spas: { rap: 650, rt: 3500, lt: 900, vel: 100, rad: 18, ang: 0, dev: 22, krit: 8, ammo: 6, ammo_tot: 36, smindam: 48, smaxdam: 72, mmindam: 28, mmaxdam: 44, lmindam: 9, lmaxdam: 16 },

  rl_m202a1: {
    desc: "РљР°СЂР°СЋС‰Р°СЏ РґР»Р°РЅСЊ Р§РµС‚С‹СЂРµС… Р’РѕР¶РґРµР№ РљСЂР°СЃРЅРѕРіРѕ Р¤СЂРѕРЅС‚Р°.",
    desca: "Р§РµС‚С‹СЂРµС…Р·Р°СЂСЏРґРЅР°СЏ СЂР°РєРµС‚РЅРёС†Р°",
    rap: 920,
    rt: 5067,
    lt: 1200,
    vel: 60,
    rad: 30,
    ang: 0,
    dev: 7,
    krit: 3,
    ammo: 4,
    ammo_tot: 16,
    smindam: 45,
    smaxdam: 70,
    mmindam: 34,
    mmaxdam: 54,
    lmindam: 22,
    lmaxdam: 38,
    wsp: -15,
    launch: 1,
    shake: 1
  },
  gl_milkor: { rap: 900, rt: 6667, lt: ARCING_LAUNCHER_LIFE, vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, dev: 6, krit: 3, ammo: 6, ammo_tot: 30, smindam: 54, smaxdam: 82, mmindam: 42, mmaxdam: 66, lmindam: 28, lmaxdam: 48 },
  gl_grenadelauncher03: { rap: 880, rt: 4000, lt: ARCING_LAUNCHER_LIFE, vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, dev: 5, krit: 4, ammo: 3, ammo_tot: 18, smindam: 68, smaxdam: 104, mmindam: 54, mmaxdam: 86, lmindam: 36, lmaxdam: 62 },
  rl_rpg7b02: { rap: 900, rt: 2967, lt: 1150, vel: 65, rad: 28, ang: 0, dev: 6, krit: 4, ammo: 1, ammo_tot: 9, smindam: 84, smaxdam: 126, mmindam: 68, mmaxdam: 104, lmindam: 48, lmaxdam: 78 },
  gl_milkor_a: { rap: 900, rt: 6667, lt: ARCING_LAUNCHER_LIFE, vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, dev: 6, krit: 3, ammo: 6, ammo_tot: 36, smindam: 56, smaxdam: 84, mmindam: 44, mmaxdam: 68, lmindam: 30, lmaxdam: 50 },

  sr_vintorez: { rap: 700, rt: 3167, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 3, krit: 10, ammo: 20, ammo_tot: 100, smindam: 42, smaxdam: 58, mmindam: 48, mmaxdam: 66, lmindam: 54, lmaxdam: 74 },
  sr_sniperrifle03: { rap: 950, rt: 3667, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 14, ammo: 5, ammo_tot: 35, smindam: 54, smaxdam: 72, mmindam: 62, mmaxdam: 82, lmindam: 70, lmaxdam: 88 },
  sr_wildcat1: { rap: 980, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 12, ammo: 1, ammo_tot: 16, smindam: 50, smaxdam: 68, mmindam: 58, mmaxdam: 78, lmindam: 66, lmaxdam: 84 },
  sr_wildcat2: { rap: 980, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 11, ammo: 1, ammo_tot: 16, smindam: 46, smaxdam: 62, mmindam: 54, mmaxdam: 72, lmindam: 62, lmaxdam: 82 }
};

function withCanonicalShopWeaponStats(item) {
  const key = String(item?.sname || item?.sn || "").toLowerCase();
  const stats = canonicalShopWeaponStats[key] || {};
  const reloadTime = originalReloadTimeMs[key];
  return reloadTime === undefined ? { ...item, ...stats } : { ...item, ...stats, rt: reloadTime };
}

// The live weapon shop is the vetted resources.assets subset only.
const shopWeaponCatalog = rebuiltShopWeaponCatalog.map(withCanonicalShopWeaponStats);

function weaponTypeForSname(sname) {
  const prefix = String(sname || "").toLowerCase().split("_")[0];
  const types = {
    ohca: 1,
    thca: 2,
    hg: 3,
    mg: 4,
    fl: 5,
    gg: 6,
    sg: 7,
    rl: 8,
    gl: 9,
    sr: 10,
    sng: 11,
    bl: 15
  };
  return types[prefix] || 0;
}

function shopWeaponExtra(item) {
  const extra = {};
  for (const key of [
    "name",
    "desc",
    "desca",
    "ndesca",
    "stRa",
    "stDi",
    "stDa",
    "ammo",
    "ammo_tot",
    "rap",
    "rt",
    "lt",
    "vel",
    "rad",
    "ang",
    "dev",
    "krit",
    "smindam",
    "smaxdam",
    "mmindam",
    "mmaxdam",
    "lmindam",
    "lmaxdam",
    "wsp",
    "sp",
    "speed",
    "launch",
    "shake"
  ]) {
    if (item[key] !== undefined) extra[key] = item[key];
  }
  return extra;
}

const shopWeapons = shopWeaponCatalog.map((item) =>
  weapon(item.id, weaponTypeForSname(item.sname), item.slot, item.sname, item.price ?? SHOP_PRICE, shopWeaponExtra(item))
);

function numericField(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function scaledStat(value, multiplier, fallback = 0) {
  return Math.max(0, Math.round(numericField(value, fallback) * multiplier));
}

function stableWorkshopPrice(weaponId) {
  const id = Math.max(0, Math.trunc(numericField(weaponId, 0)));
  return 10 + ((id * 17 + 11) % 31);
}

const workshopUpgradeTextFallbacks = {
  10: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°",
  43: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ",
  44: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ Р·Р°РјРµРґР»РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ",
  45: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ",
  53: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° СЃСЂРµРґРЅРµР№ Рё РґР°Р»СЊРЅРµР№ РґРёСЃС‚.\nРџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈСЃРєРѕСЂРµРЅРЅР°СЏ РїРµСЂРµР·Р°СЂСЏРґРєР°",
  59: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°",
  67: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° РІСЃРµС… РґРёСЃС‚.\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°",
  68: "РџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРќР°РЅРѕСЃРёС‚ РїРµСЂРёРѕРґРёС‡РµСЃРєРёР№ СѓСЂРѕРЅ С‚РёРїР° РєСЂРѕРІРѕС‚РµС‡РµРЅРёРµ",
  69: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° СЃСЂРµРґРЅРµР№ Рё РґР°Р»СЊРЅРµР№ РґРёСЃС‚.\nРџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ",
  71: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СЂР°РґРёСѓСЃ РїРѕСЂР°Р¶РµРЅРёСЏ",
  72: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ",
  73: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  74: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ Р±РѕРµР·Р°РїР°СЃ\nРџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  75: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ Р±РѕРµР·Р°РїР°СЃ\nРџРѕРІС‹С€Р°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  76: "РЈСЃРєРѕСЂРµРЅРЅР°СЏ РїРµСЂРµР·Р°СЂСЏРґРєР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Рµ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ Рё Р±РѕРµР·Р°РїР°СЃ\nР‘РѕР»РµРµ РїСЂРѕРґРѕР»Р¶РёС‚РµР»СЊРЅС‹Р№ СѓСЂРѕРЅ РѕС‚ СЏРґР°",
  79: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  80: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР° Рё Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РѕС‚ РѕРіРЅСЏ",
  101: "РЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° СЃСЂРµРґРЅРµР№ Рё РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР° Рё Р±РѕРµР·Р°РїР°СЃ\nРЈСЃРєРѕСЂРµРЅРЅР°СЏ РїРµСЂРµР·Р°СЂСЏРґРєР°",
  103: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° СЃСЂРµРґРЅРµР№ Рё РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё",
  104: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР°\nР’СЂРµРјСЏ РїРѕСЂР°Р¶РµРЅРёСЏ РѕРіРЅРµРј СѓРІРµР»РёС‡РµРЅРѕ",
  105: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР° Рё РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРќР°РЅРѕСЃРёС‚ РїРµСЂРёРѕРґРёС‡РµСЃРєРёР№ СѓСЂРѕРЅ С‚РёРїР° СЏРґ",
  106: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° Р±Р»РёР¶РЅРµР№ Рё СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СЂР°РґРёСѓСЃ РїРѕСЂР°Р¶РµРЅРёСЏ",
  107: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР° Рё РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ",
  108: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ СЃРєРѕСЂРѕСЃС‚СЂРµР»СЊРЅРѕСЃС‚СЊ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё",
  109: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ РЅР° Р±Р»РёР¶РЅРµР№ РґРёСЃС‚Р°РЅС†РёРё\nРЈРІРµР»РёС‡РµРЅРЅС‹Р№ СѓСЂРѕРЅ С‚РёРїР° РєСЂРѕРІРѕС‚РµС‡РµРЅРёРµ",
  110: "РџРѕРІС‹С€РµРЅРЅС‹Р№ С€Р°РЅСЃ РєСЂРёС‚. СѓСЂРѕРЅР°\nРЈРІРµР»РёС‡РµРЅРЅР°СЏ РѕР±РѕР№РјР° Рё РѕР±С‰РёР№ Р±РѕРµР·Р°РїР°СЃ\nРЈРІРµР»РёС‡РёРІР°РµС‚ СЃРєРѕСЂРѕСЃС‚СЊ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ"
};

function workshopUpgradeContract(weaponId) {
  const text = String(
    wearTextTranslations.get(`w_${weaponId}_descupgrade`)
    || workshopUpgradeTextFallbacks[weaponId]
    || ""
  ).toLowerCase();
  const damageAll = /СѓРІРµР»РёС‡РµРЅ(?:РЅС‹Р№|РЅР°СЏ|РЅРѕРµ|РЅС‹Рµ|РЅРЅС‹Р№)\s+СѓСЂРѕРЅ(?:\s+РЅР°\s+РІСЃРµС…\s+РґРёСЃС‚|\s+РЅР°\s+РІСЃРµС…\s+РґРёСЃС‚Р°РЅС†)?(?:\.|$|\n)/m.test(text)
    && !/СѓСЂРѕРЅ\s+РѕС‚|СѓСЂРѕРЅ\s+С‚РёРїР°/.test(text);
  const damageShort = damageAll || /СѓСЂРѕРЅ\s+РЅР°\s+Р±Р»РёР¶РЅ/.test(text);
  const damageMedium = damageAll || /СѓСЂРѕРЅ\s+РЅР°\s+(?:СЃСЂРµРґРЅ|Р±Р»РёР¶РЅРµР№\s+Рё\s+СЃСЂРµРґРЅ)/.test(text);
  const damageLong = damageAll || /СѓСЂРѕРЅ\s+РЅР°\s+(?:РґР°Р»СЊРЅ|СЃСЂРµРґРЅ.*Рё\s+РґР°Р»СЊРЅ|Р±Р»РёР¶РЅ.*Рё\s+РґР°Р»СЊРЅ)/.test(text);
  const impactType = /С‚РёРї[Р°]?\s*[\"В«]?РѕРіРѕРЅСЊ|СѓСЂРѕРЅ\s+РѕС‚\s+РѕРіРЅ|РіРѕСЂРµРЅРё|РїРѕСЂР°Р¶РµРЅРёСЏ\s+РѕРіРЅРµРј/.test(text) ? "fire"
    : (/С‚РёРї[Р°]?\s*[\"В«]?РєСЂРѕРІ|РєСЂРѕРІРѕС‚РµС‡/.test(text) ? "blood"
      : (/С‚РёРї[Р°]?\s*[\"В«]?СЏРґ|СѓСЂРѕРЅ\s+РѕС‚\s+СЏРґР°/.test(text) ? "poison"
        : (/Р·Р°РјРѕСЂРѕР·|Р·Р°РјРµРґР»РµРЅ/.test(text) ? "frost" : "")));
  return {
    text,
    damageShort,
    damageMedium,
    damageLong,
    crit: /РєСЂРёС‚/.test(text),
    magazine: /РѕР±РѕР№Рј/.test(text),
    reserve: /Р±РѕРµР·Р°РїР°СЃ/.test(text),
    rapidity: /СЃРєРѕСЂРѕСЃС‚СЂРµР»СЊ|СЃРєРѕСЂРѕСЃС‚СЊ\s+Р°С‚Р°РєРё/.test(text),
    accuracy: /РєСѓС‡РЅРѕСЃС‚|СЂР°Р·Р±СЂРѕСЃ/.test(text),
    reload: /РїРµСЂРµР·Р°СЂСЏРґ/.test(text),
    radius: /СЂР°РґРёСѓСЃ\s+РїРѕСЂР°Р¶РµРЅРёСЏ/.test(text),
    speed: /СЃРєРѕСЂРѕСЃС‚[СЊРё]\s+РїРµСЂРµРґРІРёР¶РµРЅРёСЏ/.test(text),
    impactType,
    impactDamage: /СѓСЂРѕРЅ\s+РѕС‚\s+(?:РѕРіРЅСЏ|СЏРґР°|Р·Р°РјРѕСЂРѕР·)|СѓСЂРѕРЅ\s+С‚РёРїР°|СѓСЂРѕРЅ\s+РѕС‚\s+РіРѕСЂРµРЅРё|РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ\s+Рё\s+СѓСЂРѕРЅ/.test(text),
    impactDuration: /РґР»РёС‚РµР»СЊРЅ|РїСЂРѕРґРѕР»Р¶РёС‚РµР»СЊРЅ|РІСЂРµРјСЏ\s+РїРѕСЂР°Р¶РµРЅРёСЏ/.test(text)
  };
}

function upgradedWeaponItem(item) {
  const base = clone(item);
  const ammo = numericField(base.ammo, 0);
  const ammoTotal = numericField(base.ammo_tot, 0);
  const weaponId = numericField(base.w_id ?? base.id, 0);
  const contract = workshopUpgradeContract(weaponId);
  const upgraded = {
    ...base,
    u_id: 5000 + weaponId,
    stRa: Math.min(5, numericField(base.stRa, 1) + 1),
    stDi: Math.min(5, numericField(base.stDi, 1) + 1),
    stDa: Math.min(5, numericField(base.stDa, 1) + 1),
    sc: timedPermanentCost(5000 + weaponId, stableWorkshopPrice(weaponId)),
    workshopImpactType: contract.impactType,
    workshopImpactDamagePercent: contract.impactDamage ? 25 : 0,
    workshopImpactTicksBonus: contract.impactDuration ? 2 : 0
  };
  if (contract.rapidity) upgraded.rap = Math.max(60, scaledStat(base.rap, 0.9, 100));
  if (contract.accuracy) upgraded.dev = Math.max(0, scaledStat(base.dev, 0.9, 0));
  if (contract.crit) upgraded.krit = numericField(base.krit, 0) + 2;
  if (contract.reload) upgraded.rt = Math.max(0, scaledStat(base.rt, 0.9, 0));
  if (contract.radius) upgraded.rad = Math.max(1, scaledStat(base.rad, 1.1, 1));
  if (contract.speed) upgraded.wsp = numericField(base.wsp ?? base.speed, 0) + 5;
  if (contract.magazine && ammo > 0) upgraded.ammo = Math.max(ammo + 1, Math.round(ammo * 1.1));
  if (contract.reserve && ammoTotal > 0) upgraded.ammo_tot = Math.max(upgraded.ammo ?? ammo, Math.round(ammoTotal * 1.1));
  for (const [enabled, minKey, maxKey] of [
    [contract.damageShort, "smindam", "smaxdam"],
    [contract.damageMedium, "mmindam", "mmaxdam"],
    [contract.damageLong, "lmindam", "lmaxdam"]
  ]) {
    if (!enabled) continue;
    upgraded[minKey] = scaledStat(base[minKey], 1.1, 0);
    upgraded[maxKey] = Math.max(upgraded[minKey], scaledStat(base[maxKey], 1.1, 0));
  }
  return upgraded;
}

let shopWeaponUpgrades = [];
let shopWeaponUpgradesById = new Map();

const wearSlotIds = {
  Hats: 1,
  Masks: 2,
  Gloves: 3,
  Shirts: 4,
  Pants: 5,
  Boots: 6,
  Backpacks: 7,
  Others: 8,
  Heads: 9
};

function wearText(name, desc, desca) {
  return { name, desc, desca };
}

function decodeTextAssetLine(line) {
  const firstQuote = String(line || "").indexOf("\"");
  const lastQuote = String(line || "").lastIndexOf("\"");
  if (firstQuote < 0 || lastQuote <= firstQuote) return "";
  return line
    .slice(firstQuote + 1, lastQuote)
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function loadTextAssetTranslations() {
  const candidates = [
    process.env.WEAR_TEXT_ASSET_PATH,
    path.join(process.cwd(), "resources_textures_export", "TextAsset", "default.txt"),
    path.join(process.cwd(), "..", "resources_textures_export", "TextAsset", "default.txt"),
    path.join(API_DIR, "..", "resources_textures_export", "TextAsset", "default.txt"),
    path.join(API_DIR, "data", "default.txt")
  ].filter(Boolean);

  const seen = new Set();
  for (const candidate of candidates) {
    const filePath = path.resolve(candidate);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    if (!fs.existsSync(filePath)) continue;

    const translations = new Map();
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (!lines[index].startsWith("msgid ")) continue;
      const id = decodeTextAssetLine(lines[index]);
      let valueIndex = index + 1;
      while (valueIndex < lines.length && !lines[valueIndex].startsWith("msgstr ")) {
        valueIndex += 1;
      }
      if (valueIndex < lines.length) {
        translations.set(id, decodeTextAssetLine(lines[valueIndex]));
      }
    }
    console.log(`[wear-text] loaded path=${filePath} keys=${translations.size}`);
    return translations;
  }

  console.log("[wear-text] default.txt not found; using built-in wear text fallbacks only");
  return new Map();
}

const wearTextTranslations = loadTextAssetTranslations();
shopWeaponUpgrades = shopWeapons.map((item) => upgradedWeaponItem(item));
shopWeaponUpgradesById = new Map(shopWeaponUpgrades.map((item) => [Number(item.u_id), item]));

const wearTextOverrides = {
  "Hats:biker": wearText("РЎРєСѓР»РєРµРї", "Р§С‚РѕР±С‹ РїСѓРіР°С‚СЊ СЃРЅР°Р№РїРµСЂР°, СЃРјРѕС‚СЂСЏС‰РµРіРѕ РІ РїСЂРёС†РµР».", "+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ"),
  "Shirts:biker": wearText("Р‘Р°Р№РєРµСЂ", "Р”Р»СЏ Р»РµС‚СЏС‰РёС… РІРґР°Р»СЊ СЃС‚СЂР°РЅРЅРёРєРѕРІ.", "+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+20% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+20 Рє Р±СЂРѕРЅРµ"),
  "Pants:jeansB02": wearText("РљРµР»РІРёРЅС‹", "РЎС‚РёР»СЊРЅРѕ СЃРјРѕС‚СЂСЏС‚СЃСЏ РЅР° Р¶РµР»РµР·РЅРѕРј РєРѕРЅРµ.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+25% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ"),
  "Gloves:biker": wearText("Р–РµР»РµР·РѕС…СѓРє", "Р РµР°Р»СЊРЅРѕ СЃРІР°Р»РёС‚СЊ РґР°Р¶Рµ Р±РёР·РѕРЅР°.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ"),
  "Boots:sneakV201": wearText("Р§РѕРїРєСЂРѕСЃСЃС‹", "РЎ РЅРёРјРё РјРѕР¶РЅРѕ Р·Р°С‚РѕСЂРјРѕР·РёС‚СЊ Р±Р°Р№Рє РѕРґРЅРѕР№ Р»РёС€СЊ РЅРѕРіРѕР№.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+8% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),

  "Hats:business": wearText("РЁР»СЏРїР° Р”РѕРЅР° РљРѕСЂР»РµРѕРЅРµ", "РўС‹ РїСЂРѕСЃРёС€СЊ РєРѕРЅС‚СЂР°Р±Р°РєСЃС‹, РЅРѕ РґРµР»Р°РµС€СЊ СЌС‚Рѕ Р±РµР· СѓРІР°Р¶РµРЅРёСЏ.", "+3% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+1% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Masks:businessgoogles": wearText("РЎРєР°Р№С„РѕР»С‹", "РўРµ СЃР°РјС‹Рµ РѕС‡РєРё Р”Р¶РµР№РјСЃР° Р‘РѕРЅРґР°.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+6% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ"),
  "Shirts:business": wearText("РЎРјРѕРєРёРЅРіРѕРІСЃРєРёР№", "РЎРјРѕРєРёРЅРі РґР»СЏ Р°РіРµРЅС‚РѕРІ РљРѕРЅС‚СЂР° РЎРёС‚Рё.", "+7% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+15% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+20 Рє Р±СЂРѕРЅРµ\n+3% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Pants:business": wearText("Р‘РѕРЅРґРѕР±СЂСЋРєРё", "РЎР»РёС€РєРѕРј РґРµР»РѕРІРѕР№ СЃРєРёР»Р».", "+10% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†"),
  "Gloves:business": wearText("РџРµСЂС‡Р°С‚РєРё Р“СѓРґРёРЅРё", "РњРЅРѕРіРѕ СЃРµРєСЂРµС‚РѕРІ Рё РѕС‚РјС‹С‡РµРє С…СЂР°РЅСЏС‚ СЌС‚Рё РїРµСЂС‡Р°С‚РєРё.", "+2% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ"),
  "Boots:business": wearText("РџРѕРґРїРѕР»СЊРЅРёРєРё", "", "+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+3% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),
  "Boots:boot02": wearText("РўР°РЅР¶РµСЂС‹", "РРґРµР°Р»СЊРЅС‹ РґР»СЏ Р¶Р°СЂРєРёС… СЃРїРµС†РѕРїРµСЂР°С†РёР№.", "+3% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+3% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),
  "Boots:sneakV2B03": wearText("РљСЂРёРєРµС‚С‹", "РЎРїРµС†РёР°Р»СЊРЅРѕ РґР»СЏ СЌР»РёС‚РЅРѕР№ РёРіСЂС‹ РЅР° С‚СЂР°РІРµ.", "+2% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё РїРµСЂРµРґРІРёР¶РµРЅРёСЏ"),
  "Boots:sneakV2B04": wearText("Р”СѓРїР»РµРєСЃРєСЂРѕСЃСЃС‹", "Р”Р»СЏ Р±РµР·РѕРїР°СЃРЅРѕРіРѕ РїСЂРµРѕРґРѕР»РµРЅРёСЏ РїСЂРѕРіСЂР°РјРјРЅС‹С… Р»РѕРІСѓС€РµРє.", "+3% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё"),
  "Boots:anarch": wearText("РљРµРґРѕРЅС‹", "Р”Р»СЏ СЃРІРµР¶РµРіРѕ РєРѕРЅС‚СЂР°СЃС‚Р° СЃ РїС‹Р»СЊРЅРѕР№ РґРѕСЂРѕРіРѕР№.", "Р‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°\n+5% Рє СЃРєРѕСЂРѕСЃС‚Рё"),
  "Boots:zadira": wearText("РљСЂРѕСЃС‚РёР»СЊРЅРёРєРё", "РњРѕР¶РЅРѕ РґР°Р¶Рµ РЅР°РїРѕРґРґР°С‚СЊ, РїРѕРєР° РЅРµ РІРёРґРёС‚ РґРёСЂРµРєС‚РѕСЂ.", "+4% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+2% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+1% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),
  "Boots:prizrak": wearText("Р‘РµСЃС€СѓР±РµСЂС†С‹", "РћС‡РµРЅСЊ С‚РёС…Р°СЏ РїРѕСЃС‚СѓРїСЊ РѕР±РµСЃРїРµС‡РµРЅР°.", "+1% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+3% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),

  "Hats:stalker": wearText("РљР°РїСЋС€РѕРЅРєР°", "РЈРєСЂС‹РІР°РµС‚ РѕС‚ РґРѕР¶РґСЏ РІСЂР°Р¶РµСЃРєРёС… РїСѓР»СЊ.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+2% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Masks:stalkergasmask": wearText("РђРЅС‚РёСЂР°Рґ", "РЎРµРєСЂРµС‚РЅР°СЏ СЂР°Р·СЂР°Р±РѕС‚РєР° С„РµРґРµСЂР°С†РёРё.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+1% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Shirts:stalker": wearText("Р Р°Р·СЂСѓС€РёС‚РµР»СЊ", "РђСЂС‚РµС„Р°РєС‚ РїСЂСЏРјРёРєРѕРј РёР· Р§РµСЂРЅРѕР±С‹Р»СЏ.", "+15% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+4% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+20 Рє Р±СЂРѕРЅРµ"),
  "Pants:stalker": wearText("РњРёР»РёС‚Р°СЂРЅРёРєРё", "РљРµРІР»Р°СЂРѕРІС‹Рµ С€С‚Р°РЅС‹. РќРµ С‚РѕР»СЊРєРѕ РіСЂРµСЋС‚, РЅРѕ Рё Р·Р°С‰РёС‰Р°СЋС‚.", "+15% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ"),
  "Gloves:stalker": wearText("РќРёС‚СЂРёР»РѕРІС‹Рµ РїРµСЂС‡Рё", "Р—Р°С‰РёС‚Р° РѕС‚ Р»СЋР±РѕРіРѕ РІРёРґР° Р»РµР·РІРёСЏ.", "+4% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ"),
  "Boots:stalker": wearText("РЎС‚СЂР°РЅРЅРёРєРё", "", "+10% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+2% Рє СЃРєРѕСЂРѕСЃС‚Рё\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),

  "Heads:thanos": wearText("РљР°РјРµРЅСЊ РЎС‚Р°СЂС†РµРІР°", "Р”Р°РЅРЅС‹Р№ РєР°РјРµРЅСЊ РёСЃРїС‹С‚С‹РІР°РµС‚ РіРѕР»РѕРґ, РєРѕС‚РѕСЂС‹Р№ РјРѕР¶РЅРѕ СѓС‚Р°Р»РёС‚СЊ С‚РѕР»СЊРєРѕ РґСѓС€Р°РјРё РїРѕРІРµСЂР¶РµРЅРЅС‹С… РІСЂР°РіРѕРІ.", "+9% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+8% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+3% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Masks:thanos": wearText("РљР°РјРµРЅСЊ РљСѓРґСЂСЏС€РѕРІР°", "РџРѕР»РЅР°СЏ РІР»Р°СЃС‚СЊ РЅР°Рґ РІСЂРµРјРµРЅРµРј - РјРѕР¶РЅРѕ СѓРІРёРґРµС‚СЊ РІСЃРµ РІРѕР·РјРѕР¶РЅС‹Рµ РёСЃС…РѕРґС‹ Р±РёС‚РІС‹.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+7% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+20% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРєРё РђРЅР°РєРѕРЅРґР°"),
  "Shirts:thanos": wearText("РљР°РјРµРЅСЊ Р›РµРіРµРЅРґР°СЂРЅРѕРіРѕ", "РљР°РјРµРЅСЊ, РєРѕС‚РѕСЂС‹Р№ РїРѕР·РІРѕР»СЏРµС‚ С‡РёС‚Р°С‚СЊ РјС‹СЃР»Рё Рё РѕРІР»Р°РґРµРІР°С‚СЊ СЂР°Р·СѓРјРѕРј СЃРѕРїРµСЂРЅРёРєРѕРІ.", "+10% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+4% Рє Р·РґРѕСЂРѕРІСЊСЋ"),
  "Pants:thanos": wearText("РљР°РјРµРЅСЊ РљРѕРјРёСЃСЃР°СЂР°", "РћРіР»СЏРЅРёСЃСЊ РІРѕРєСЂСѓРі - С‚С‹ Рё РІРїСЂР°РІРґСѓ РґСѓРјР°РµС€СЊ, С‡С‚Рѕ РІСЃРµ СЌС‚Рѕ СЂРµР°Р»СЊРЅРѕ?", "+9% Р·Р°С‰РёС‚Р° РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+15% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†С‹ РўСЂРѕР»Р»РµР±СѓР·РёРЅР°"),
  "Gloves:thanos": wearText("РџРµСЂС‡Р°С‚РєР° Р—РѕРЅРіР°", "РћРґРЅРёРј С‰РµР»С‡РєРѕРј С‚С‹ РјРѕР¶РµС€СЊ РїСЂРµРІСЂР°С‚РёС‚СЊ РїРѕР»РѕРІРёРЅСѓ СЃРІРѕРёС… РІСЂР°РіРѕРІ РІ РїСЂР°С….", "+10% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+15% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+10% Р·Р°С‰РёС‚Р° РѕС‚ СЂР°РєРµС‚РЅРёС†\n+20 Рє Р±СЂРѕРЅРµ"),
  "Boots:thanos": wearText("РљР°РјРµРЅСЊ РђРЅРґСЂРѕРёС‚Р°", "РџСЂРёРґР°РµС‚ СЃРёР»С‹ Р»СЋР±РѕРјСѓ РѕСЂСѓР¶РёСЋ, РІР·СЏС‚РѕРјСѓ РІ СЂСѓРєРё.", "+5% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚Р° РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\nР‘РѕР»СЊС€РѕР№ Р±РѕРЅСѓСЃ Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°"),
  "Backpacks:thanos": wearText("РљР°РјРµРЅСЊ Р—РЅР°С‚Р°", "Р’СЂР°Рі РґР°Р¶Рµ РЅРµ РїРѕРґРѕР·СЂРµРІР°РµС‚, С‡С‚Рѕ С‚С‹ СѓР¶Рµ СЃС‚РѕРёС€СЊ Сѓ РЅРµРіРѕ Р·Р° СЃРїРёРЅРѕР№.", "+10% Р·Р°С‰РёС‚Р° РѕС‚ РїСѓР»РµРјРµС‚РѕРІ\n+15% Р·Р°С‰РёС‚Р° РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+10% Р·Р°С‰РёС‚Р° РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+15% Р·Р°С‰РёС‚Р° РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚Р° Р“СЂР°РЅР°С‚РёРЅ")
};

const BLUE_SOLDIER_SLIP99_SHOTGUN_JUMP_BONUS = "+40% Рє РїСЂС‹Р¶РєСѓ РїРѕСЃР»Рµ РІС‹СЃС‚СЂРµР»Р° РёР· РґСЂРѕР±РѕРІРёРєР°";

function appendWearBonusText(text, bonus) {
  const current = String(text || "").trim();
  if (!bonus || current.includes(bonus)) return current;
  return current ? `${current}\n${bonus}` : bonus;
}

function wearTextFor(slot, sname) {
  const key = `${slot || ""}:${String(sname || "")}`;
  const prefix = `wear_${slot}_${sname}`;
  const localized = {};
  for (const field of ["name", "desc", "desca"]) {
    const value = wearTextTranslations.get(`${prefix}_${field}`);
    if (typeof value === "string") localized[field] = value;
  }
  const result = { ...(wearTextOverrides[key] || {}), ...localized };
  if (key === "Boots:slip99") {
    result.desca = appendWearBonusText(result.desca, BLUE_SOLDIER_SLIP99_SHOTGUN_JUMP_BONUS);
  }
  return result;
}

const shopWearCatalog = {
  Hats: ["hat01", "hat02", "hat03", "helm02", "cap01", "cap02", "helm01", "vietnam", "pilothelm", "budenka", "ushmil", "ushanka", "party02", "party01", "english", "indiana02", "indiana01", "indiana03", "pharaoh", "tophat", "beret01", "beret02", "beret03", "beret04", "tactichelm01", "tactichelm02", "milcap01", "milcap02", "milcap03", "Witchhat", "Jacklantern", "santa", "santa2", "Olympic", "capVKKS01", "capVKKS02", "capVKKS03", "tacticalB01", "capB04", "capB08", "hatB08", "capB06", "capB05", "infernal", "hatB01", "capB07", "capB01", "avenger", "hatB06", "biker", "business", "stalker", "ushanka2"],
  Masks: ["goog01", "goog02", "goog03", "mask01", "band01", "band02", "band03", "klava01", "klava02", "klava03", "mummy_H", "bandB08", "skeleton_H", "gasmask01", "gasmask02", "aviaglass", "santa", "santa2", "SnowGoggles", "maskB01", "bandB03", "bandB07", "googB01", "googB03", "infernal_H", "franky", "maskB02", "bandB05", "bandB01", "googB02", "avenger", "bandB04", "klavaB01", "businessgoogles", "stalkergasmask", "thanos"],
  Gloves: ["glov01", "bint01", "bint02", "clock01", "clock02", "glov02", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "Olympic", "tacticalB01", "infernal", "franky", "wristwrapB03", "avenger", "prizrak", "biker", "business", "stalker", "thanos", "glov022"],
  Shirts: ["armor01", "armor02", "armor03", "armor04", "hood01", "hood02", "hood03", "hood04", "hood05", "jack01", "singl05", "singl06", "jack02", "jack03", "shirt01", "shirt02", "shirt03", "shirt04", "singl01", "singl02", "singl03", "singl04", "shirtB08", "chood01", "chood02", "chood03", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "hoodOlimpic", "hoodZong", "tacticB01", "hoodB03", "hoodB08", "hoodB10", "shirtB09", "shirtB04", "infernal", "franky", "hoodB05", "hoodB01", "hoodB04", "anarch", "avenger", "hoodB06", "prizrak", "biker", "business", "stalker", "thanos", "trooper2"],
  Pants: ["jeans01", "jeans02", "pant01", "pant02", "pant03", "sport01", "sport02", "sport03", "sport04", "short01", "short02", "short03", "short04", "short05", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "Olympic", "sportVKKS01", "sportVKKS02", "sportVKKS03", "tacticB01", "sportB03", "sportB08", "sportB10", "shortB12", "shortB14", "infernal", "franky", "sportB05", "sportB01", "sportB04", "jeansB03", "avenger", "sportB06", "prizrak", "jeansB02", "business", "stalker", "thanos", "pant032"],
  Boots: ["boot01", "bear", "boot02", "slip01", "sneak01", "sneak02", "sneakV201", "sneakV202", "sneakV203", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "sneakOlimpic", "tacticalB01", "sneakV2B05", "sneakV2B02", "sneakV2B06", "sneakV2B07", "sneakV2B03", "infernal", "franky", "sneakV2B04", "sneakV2B10", "anarch", "avenger", "zadira", "prizrak", "business", "stalker", "thanos", "slip99"],
  Backpacks: ["parr01", "back01", "back02", "guit01", "guit02", "turt01", "octopus", "arrows", "darts", "rocket01", "rocket02", "rec", "shield", "extinguisher", "sarcophagus", "tomb", "Morte", "Raven", "Scarecrow", "santa", "santa2", "Snowboard", "VampireBat", "infernalRaven", "frankyOctopus", "snake01", "thanos", "rec2"],
  Others: ["maz", "icecream01", "icecream02", "icecream03", "cola01", "cola02", "cola03", "skrab", "coins", "santa", "santa2", "medal", "medalgold", "medalsilver", "medalbronze", "smertik", "badboy", "infernal", "franky", "newyearball", "schelkunchik", "spingreen", "spinyellow", "spinblue", "burger", "teeth", "spider", "vodka"],
  Heads: ["bald01", "bald02", "black01", "black02", "black03", "black04", "blond01", "blond02", "blond03", "brown01", "brown02", "brown03", "brown04", "spec01", "spec02", "spec03", "spec04", "franky", "thanos", "spec99"]
};

const legacyShopWears = Object.entries(shopWearCatalog).flatMap(([slot, names]) =>
  names.map((sname, index) => wear(10000 + wearSlotIds[slot] * 1000 + index + 1, wearSlotIds[slot], sname, SHOP_PRICE, slot))
);

const shopWears = legacyShopWears;

function findWearCatalogItem(slot, sname) {
  const wt = wearSlotIds[slot];
  const item = shopWears.find((wearItem) => Number(wearItem.wt) === Number(wt) && String(wearItem.sname) === String(sname));
  if (!item) {
    throw new Error(`Wear catalog item not found: ${slot}:${sname}`);
  }
  return item;
}

function assemblageWear(slot, sname) {
  const item = findWearCatalogItem(slot, sname);
  return {
    it: 3,
    id: item.id,
    w_id: item.w_id,
    wt: item.wt,
    sname: item.sname,
    sn: item.sn,
    name: item.name,
    desc: item.desc,
    desca: item.desca,
    nlvl: item.nlvl,
    iS: item.iS,
    sc: item.sc
  };
}

const assemblageDefinitions = [
  {
    id: 32,
    name: "Р‘Р°Р№РєРµСЂ",
    desca: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+20% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+15% Рє Р·РґРѕСЂРѕРІСЊСЋ\n+2% Рє СЃРєРѕСЂРѕСЃС‚Рё\nСѓСЂРѕРЅ СЃРЅР°Р№РїРµСЂРѕРє РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +2\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +4",
    ndesca: "",
    items: [
      ["Hats", "biker"],
      ["Shirts", "biker"],
      ["Pants", "jeansB02"],
      ["Gloves", "biker"],
      ["Boots", "sneakV201"]
    ]
  },
  {
    id: 36,
    name: "РЁРїРёРѕРЅ",
    desca: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+10% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+9% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ РїРёСЃС‚РѕР»РµС‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +7\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6",
    ndesca: "",
    items: [
      ["Hats", "business"],
      ["Masks", "businessgoogles"],
      ["Shirts", "business"],
      ["Gloves", "business"],
      ["Pants", "business"],
      ["Boots", "business"]
    ]
  },
  {
    id: 35,
    name: "РЎС‚Р°Р»РєРµСЂ",
    desca: "+15% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕРіРЅРµРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+12% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ РґСЂРѕР±РѕРІРёРєРѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +5",
    ndesca: "",
    items: [
      ["Hats", "stalker"],
      ["Masks", "stalkergasmask"],
      ["Shirts", "stalker"],
      ["Pants", "stalker"],
      ["Gloves", "stalker"],
      ["Boots", "stalker"]
    ]
  },
  {
    id: 37,
    name: "РєРѕРЅРўСЂРђРќРћРЎ",
    desca: "+10% Р·Р°С‰РёС‚С‹ РѕС‚ Р°РІС‚РѕРјР°С‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ СЃРЅР°Р№РїРµСЂРѕРє\n+4% Р·Р°С‰РёС‚С‹ РѕС‚ РїРёСЃС‚РѕР»РµС‚РѕРІ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РѕСЂСѓР¶РёСЏ Р±Р»РёР¶РЅРµРіРѕ Р±РѕСЏ\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ СЂР°РєРµС‚РЅРёС†\n+15% Р·Р°С‰РёС‚С‹ РѕС‚ РіСЂР°РЅР°С‚РѕРјРµС‚РѕРІ\n+5% Р·Р°С‰РёС‚С‹ РѕС‚ РґСЂРѕР±РѕРІРёРєРѕРІ\n+4% Рє Р·РґРѕСЂРѕРІСЊСЋ\nСѓСЂРѕРЅ СЂР°РєРµС‚РЅРёС† РЅР° РґР°Р»СЊРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +6\nСѓСЂРѕРЅ Р°РІС‚РѕРјР°С‚РѕРІ РЅР° СЃСЂРµРґРЅРµР№ РґРёСЃС‚Р°РЅС†РёРё +3",
    ndesca: "",
    items: [
      ["Heads", "thanos"],
      ["Masks", "thanos"],
      ["Shirts", "thanos"],
      ["Pants", "thanos"],
      ["Gloves", "thanos"],
      ["Boots", "thanos"],
      ["Backpacks", "thanos"]
    ]
  }
];

function assemblageTextFor(id) {
  const prefix = `assemblage_${id}`;
  return {
    name: wearTextTranslations.get(`${prefix}_name`) || prefix,
    desca: wearTextTranslations.get(`${prefix}_desca`) || "",
    ndesca: wearTextTranslations.get(`${prefix}_ndesc`) || ""
  };
}

const restoredAssemblageDefinitions = [
  { id: 1, code: "peak_reaper", items: [["Hats", "tophat"], ["Masks", "skeleton_H"], ["Shirts", "skeleton"], ["Backpacks", "tomb"], ["Gloves", "skeleton"], ["Pants", "skeleton"], ["Boots", "skeleton"], ["Others", "coins"]] },
  { id: 2, code: "raven", items: [["Masks", "gasmask01"], ["Hats", "tactichelm01"], ["Shirts", "tactic01"], ["Gloves", "tactical01"], ["Pants", "tactic01"], ["Boots", "tactical01"]] },
  { id: 3, code: "vandal", items: [["Hats", "cap02"], ["Masks", "band01"], ["Gloves", "bint02"], ["Shirts", "hood04"], ["Pants", "sport03"], ["Boots", "sneak02"], ["Backpacks", "darts"], ["Others", "maz"]] },
  { id: 6, code: "belov", items: [["Hats", "indiana02"], ["Masks", "goog02"], ["Gloves", "bint01"], ["Shirts", "hood03"], ["Pants", "sport02"], ["Backpacks", "rocket02"], ["Others", "cola01"], ["Heads", "brown04"]] },
  { id: 7, code: "mummy", items: [["Hats", "pharaoh"], ["Shirts", "mummy"], ["Backpacks", "sarcophagus"], ["Gloves", "mummy"], ["Pants", "mummy"], ["Boots", "mummy"], ["Masks", "mummy_H"], ["Others", "skrab"]] },
  { id: 8, code: "recon", items: [["Hats", "tactichelm02"], ["Masks", "gasmask02"], ["Shirts", "tactic02"], ["Pants", "tactic02"], ["Boots", "tactical02"], ["Gloves", "clock02"]] },
  { id: 9, code: "dead_moroz", items: [["Hats", "santa"], ["Masks", "santa"], ["Shirts", "santa"], ["Backpacks", "santa"], ["Gloves", "santa"], ["Pants", "santa"], ["Boots", "santa"], ["Others", "santa"]] },
  { id: 10, code: "vdv", items: [["Hats", "beret03"], ["Shirts", "trooper"], ["Masks", "aviaglass"], ["Pants", "trooper"]] },
  { id: 11, code: "barkhan", items: [["Hats", "milcap03"], ["Shirts", "tactic04"], ["Gloves", "tactical02"], ["Pants", "tactic04"]] },
  { id: 12, code: "invader", items: [["Shirts", "tactic03"], ["Pants", "tactic03"], ["Boots", "boot02"], ["Masks", "googB02"], ["Hats", "beret01"]] },
  { id: 14, code: "olympian", items: [["Hats", "Olympic"], ["Masks", "SnowGoggles"], ["Shirts", "hoodOlimpic"], ["Backpacks", "Snowboard"], ["Gloves", "Olympic"], ["Pants", "Olympic"], ["Boots", "sneakOlimpic"], ["Others", "medal"]] },
  { id: 15, code: "vkks_gold_2014", items: [["Hats", "capVKKS01"], ["Pants", "sportVKKS01"], ["Others", "medalgold"], ["Shirts", "chood01"]] },
  { id: 16, code: "vkks_silver_2014", items: [["Hats", "capVKKS02"], ["Shirts", "chood02"], ["Pants", "sportVKKS02"], ["Others", "medalsilver"]] },
  { id: 17, code: "vkks_bronze_2014", items: [["Hats", "capVKKS03"], ["Shirts", "chood03"], ["Pants", "sportVKKS03"], ["Others", "medalbronze"]] },
  { id: 18, code: "delta", items: [["Hats", "tacticalB01"], ["Shirts", "tacticB01"], ["Pants", "tacticB01"], ["Gloves", "tacticalB01"], ["Boots", "tacticalB01"], ["Others", "smertik"]] },
  { id: 19, code: "ray", items: [["Shirts", "hoodB08"], ["Pants", "sportB08"], ["Boots", "sneakV2B02"], ["Hats", "capB08"], ["Masks", "bandB07"]] },
  { id: 20, code: "badboy", items: [["Shirts", "hoodB03"], ["Pants", "sportB03"], ["Others", "badboy"], ["Boots", "sneakV2B05"], ["Masks", "maskB01"], ["Hats", "capB04"]] },
  { id: 21, code: "acid_warrior", items: [["Hats", "hatB08"], ["Shirts", "hoodB10"], ["Pants", "sportB10"], ["Boots", "sneakV2B06"], ["Masks", "bandB03"]] },
  { id: 22, code: "stuzha", items: [["Hats", "santa2"], ["Masks", "santa2"], ["Shirts", "santa2"], ["Backpacks", "santa2"], ["Gloves", "santa2"], ["Pants", "santa2"], ["Boots", "santa2"], ["Others", "santa2"]] },
  { id: 23, code: "red_heat", items: [["Hats", "capB06"], ["Shirts", "shirtB09"], ["Pants", "shortB12"], ["Masks", "googB01"], ["Boots", "sneakV2B07"]] },
  { id: 24, code: "cool_breeze", items: [["Hats", "capB05"], ["Shirts", "shirtB04"], ["Pants", "shortB14"], ["Masks", "googB03"], ["Boots", "sneakV2B03"]] },
  { id: 25, code: "necrowarrior", items: [["Heads", "franky"], ["Masks", "franky"], ["Shirts", "franky"], ["Pants", "franky"], ["Boots", "franky"], ["Gloves", "franky"], ["Others", "franky"], ["Backpacks", "frankyOctopus"]] },
  { id: 26, code: "infernal", items: [["Hats", "infernal"], ["Shirts", "infernal"], ["Pants", "infernal"], ["Boots", "infernal"], ["Gloves", "infernal"], ["Masks", "infernal_H"], ["Others", "infernal"], ["Backpacks", "infernalRaven"]] },
  { id: 27, code: "cyborg", items: [["Masks", "maskB02"], ["Shirts", "hoodB05"], ["Pants", "sportB05"], ["Boots", "sneakV2B04"]] },
  { id: 28, code: "wanderer", items: [["Hats", "hatB01"], ["Masks", "bandB05"], ["Shirts", "hoodB01"], ["Pants", "sportB01"], ["Boots", "sneakV2B10"]] },
  { id: 29, code: "snakecatcher", items: [["Masks", "bandB01"], ["Shirts", "hoodB04"], ["Pants", "sportB04"], ["Hats", "capB07"], ["Backpacks", "snake01"]] },
  { id: 30, code: "ghost", items: [["Masks", "klavaB01"], ["Shirts", "prizrak"], ["Pants", "prizrak"], ["Gloves", "prizrak"], ["Boots", "prizrak"]] },
  { id: 31, code: "anarchist", items: [["Hats", "capB01"], ["Shirts", "anarch"], ["Pants", "jeansB03"], ["Gloves", "wristwrapB03"], ["Boots", "anarch"], ["Others", "spinyellow"]] },
  { id: 32, code: "biker", items: [["Hats", "biker"], ["Shirts", "biker"], ["Pants", "jeansB02"], ["Gloves", "biker"], ["Boots", "sneakV201"]] },
  { id: 33, code: "scrapper", items: [["Hats", "hatB06"], ["Masks", "bandB04"], ["Shirts", "hoodB06"], ["Pants", "sportB06"], ["Boots", "zadira"], ["Others", "burger"]] },
  { id: 34, code: "avenger", items: [["Hats", "avenger"], ["Masks", "avenger"], ["Shirts", "avenger"], ["Pants", "avenger"], ["Gloves", "avenger"], ["Boots", "avenger"], ["Others", "spinblue"]] },
  { id: 35, code: "stalker", items: [["Hats", "stalker"], ["Masks", "stalkergasmask"], ["Shirts", "stalker"], ["Pants", "stalker"], ["Gloves", "stalker"], ["Boots", "stalker"]] },
  { id: 36, code: "spy", items: [["Hats", "business"], ["Masks", "businessgoogles"], ["Shirts", "business"], ["Pants", "business"], ["Gloves", "business"], ["Boots", "business"]] },
  { id: 37, code: "contranos", items: [["Heads", "thanos"], ["Masks", "thanos"], ["Shirts", "thanos"], ["Pants", "thanos"], ["Gloves", "thanos"], ["Boots", "thanos"], ["Backpacks", "thanos"]] },
  { id: 38, code: "blue_soldier", items: [["Heads", "spec99"], ["Hats", "ushanka2"], ["Shirts", "trooper2"], ["Pants", "pant032"], ["Gloves", "glov022"], ["Boots", "slip99"], ["Backpacks", "rec2"], ["Others", "vodka"]] }
];

// Assemblages 4 (РЁРўРЈР РњРћР’РРљ) and 5 (Р­РљРћРўР•Р Р РћР ) have no recoverable original item lists.
// Keep them out of the shop response instead of exposing sets the battle server cannot complete.
const removedAssemblageIds = new Set([4, 5]);
const shopAssemblages = restoredAssemblageDefinitions
  .filter((definition) => !removedAssemblageIds.has(definition.id))
  .map((definition) => {
  const text = assemblageTextFor(definition.id);
  return {
    id: definition.id,
    name: text.name,
    desca: text.desca,
    ndesca: text.ndesca,
    items: JSON.stringify(definition.items.map(([slot, sname]) => assemblageWear(slot, sname)))
  };
  });

// Hidden from the live shop: 2 "Р›РёРјРѕРЅР°РґРЅС‹Р№ РіР»РѕС‚РѕРє", 6 "РџР°Р»СЊС†РµСЃС‚СЂРµР»",
// 10 "РЎРµРєРёСЂ-Р±Р°С€РєР°", 11 "РџРѕРґРѕР·СЂРёС‚РµР»СЊРЅРѕСЃС‚СЊ".
const shopTaunts = [3, 4, 5, 7, 8, 9].map((id) => taunt(id, SHOP_PRICE));
const shopEnhancers = SHOP_ENHANCER_IDS.map((id) =>
  enhancer(id, SHOP_PRICE)
);
const canonicalWeaponsById = new Map([...defaultWeapons, ...shopWeapons].map((item) => [Number(item.w_id), item]));
const weaponSnameKey = (item) => String(item?.sn || item?.sname || "").toLowerCase();
const canonicalWeaponsBySname = new Map([...defaultWeapons, ...shopWeapons].map((item) => [weaponSnameKey(item), item]).filter(([key]) => key));
const canonicalWearsById = new Map(shopWears.map((item) => [Number(item.w_id), item]));
const canonicalTauntsById = new Map(shopTaunts.map((item) => [Number(item.t_id), item]));
const canonicalEnhancersById = new Map(shopEnhancers.map((item) => [Number(item.e_id), item]));
const viewWearKeys = ["hat", "head", "mask", "gloves", "shirt", "pants", "boots", "backpack", "other"];

function allCatalogItems() {
  return [...defaultWeapons, ...shopWeapons, ...shopWears, ...shopTaunts, ...shopEnhancers];
}

const abilityValueDefinitions = {
  1: { type: "1", key: "cdef", values: [10, 20, 40, 60, 80] },
  2: { type: "1", key: "cheal", values: [10, 20, 30, 40, 50] },
  3: { type: "2", key: "cspd", values: [2, 4, 6, 8, 10] },
  4: { type: "2", key: "cdecdam", values: [2, 4, 6, 8, 10] },
  5: { type: "2", key: "wrap", values: [2, 4, 6, 8, 10] },
  6: { type: "2", key: "wcrit", values: [5, 10, 15, 20, 25] },
  7: { type: "2", key: "wam", values: [10, 30, 40, 50, 60] },
  8: { type: "1", key: "wmdam", values: [1, 2, 3, 4, 5] },
  9: { type: "1", key: "wmxdam", values: [1, 2, 3, 4, 5] },
  10: { type: "1", key: "wacc", values: [1, 2, 3, 4, 5] },
  11: { type: "2", key: "whcrit", values: [5, 10, 15, 20, 25] }
};

const abilityCatalog = [];
for (const [abilityIdText, definition] of Object.entries(abilityValueDefinitions)) {
  const abilityId = Number(abilityIdText);
  for (let level = 1; level <= definition.values.length; level += 1) {
    abilityCatalog.push({
      i: abilityId,
      l: level,
      v: JSON.stringify([{ t: definition.type, [definition.key]: String(definition.values[level - 1]) }]),
      sc: cost(5000 + abilityId * 10 + level, 100 * level)
    });
  }
}

const mapPlayers = "4,6,8,10,12,14,16";
const MAP_MODE_DEATHMATCH = 1;
const MAP_MODE_TEAM_DEATHMATCH = 2;
const MAP_MODE_CAPTURE_THE_FLAG = 4;
const MAP_MODE_CONTROL_POINTS = 8;
const MAP_MODE_ZOMBIE = 64;
const MAP_MODE_DM_ZOMBIE = MAP_MODE_DEATHMATCH | MAP_MODE_ZOMBIE;
const DOSSIER_GAME_MODE_STATS = [
  MAP_MODE_DEATHMATCH,
  MAP_MODE_TEAM_DEATHMATCH,
  MAP_MODE_CAPTURE_THE_FLAG,
  MAP_MODE_CONTROL_POINTS,
  MAP_MODE_ZOMBIE
];
const mapEntry = (id, systemName, modes = 3) => ({ i: id, n: systemName, m: modes, p: mapPlayers, dp: 4 });

function normalizeStatsMode(mode) {
  const value = Number(mode || 0);
  if (!Number.isFinite(value)) return 0;
  if ((value & MAP_MODE_ZOMBIE) === MAP_MODE_ZOMBIE) return MAP_MODE_ZOMBIE;
  if (value === MAP_MODE_DEATHMATCH || value === MAP_MODE_TEAM_DEATHMATCH || value === MAP_MODE_CAPTURE_THE_FLAG || value === MAP_MODE_CONTROL_POINTS) {
    return value;
  }
  return value;
}

const maps = [
  mapEntry(1, "Arena_3lvl", MAP_MODE_DEATHMATCH | MAP_MODE_TEAM_DEATHMATCH | MAP_MODE_CAPTURE_THE_FLAG | MAP_MODE_CONTROL_POINTS),
  mapEntry(13, "Zombi_2", MAP_MODE_DM_ZOMBIE),
  mapEntry(14, "Zombi", MAP_MODE_DM_ZOMBIE),
  mapEntry(15, "ArenaRing", MAP_MODE_TEAM_DEATHMATCH | MAP_MODE_CAPTURE_THE_FLAG | MAP_MODE_CONTROL_POINTS),
  mapEntry(16, "Bit_map", MAP_MODE_DEATHMATCH | MAP_MODE_TEAM_DEATHMATCH),
  mapEntry(17, "LegoTurnament", MAP_MODE_TEAM_DEATHMATCH | MAP_MODE_CAPTURE_THE_FLAG),
  mapEntry(18, "Inferno", MAP_MODE_DEATHMATCH | MAP_MODE_TEAM_DEATHMATCH | MAP_MODE_CAPTURE_THE_FLAG | MAP_MODE_CONTROL_POINTS)
];

function starterAccount(name = "ContraCity", id = 1, key = DEFAULT_KEY) {
  return {
    id,
    key,
    name: cleanName(name),
    fullName: "Contra City Player",
    level: START_LEVEL,
    exp: START_EXP,
    expMin: 0,
    expMax: START_EXP_MAX,
    money: START_MONEY,
    view: {
      hat: 0,
      head: 0,
      mask: 0,
      gloves: 0,
      shirt: 0,
      pants: 0,
      boots: 0,
      backpack: 0,
      other: 0
    },
    weap: {
      id1: 0,
      id2: 0,
      id3: 0,
      id4: 0,
      id5: 0,
      id6: 0,
      id7: 0
    },
    taun: {
      i0: 0,
      i1: 0,
      i2: 0
    },
    stats: {},
    inventory: [],
    abilities: [],
    clanMaxRequest: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function cleanName(value) {
  const name = String(value || "").trim().slice(0, 24);
  return name || "ContraCity";
}

function nextAccountId() {
  const ids = Object.keys(store?.accounts || {})
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function newAccountKey(id) {
  return `${DEFAULT_KEY}-${id}-${crypto.randomUUID()}`.slice(0, 128);
}

async function createNewAccount(name) {
  const id = nextAccountId();
  const account = starterAccount(name, id, newAccountKey(id));
  account.namePending = true;
  store.accounts[String(id)] = account;
  await saveStore(store);
  if (pgPool) {
    const saved = await loadPostgresAccount(id);
    if (!saved || saved.key !== account.key) {
      throw new Error(`created account ${id} was not saved to postgres`);
    }
    store.accounts[String(id)] = saved;
  }
  return account;
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.accounts) {
      return normalizeStore(parsed);
    }
  } catch {
    // First run on Railway has no data file yet.
  }
  return normalizeStore({ accounts: {} });
}

function saveStore(store) {
  if (pgPool) {
    pgSaveChain = pgSaveChain.then(() => savePostgresStore(clone(store)));
    return pgSaveChain;
  }

  ensureStoreDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
  return Promise.resolve();
}

let pgPool = null;
let pgSaveChain = Promise.resolve();
const viewSelectionSaveVersions = new Map();
const weaponSelectionSaveVersions = new Map();
const MANAGED_CATALOG_ITEM_TYPES = [1, 2, 3, 4];

function enqueuePostgresMutation(operation) {
  const run = pgSaveChain.catch(() => {}).then(operation);
  pgSaveChain = run.catch((error) => {
    console.error("[postgres] mutation failed", error);
  });
  return run;
}

function nextWeaponSelectionSaveVersion(accountId) {
  const key = String(accountId || 0);
  const version = Number(weaponSelectionSaveVersions.get(key) || 0) + 1;
  weaponSelectionSaveVersions.set(key, version);
  return version;
}

function isLatestWeaponSelectionSaveVersion(accountId, version) {
  return Number(weaponSelectionSaveVersions.get(String(accountId || 0)) || 0) === Number(version);
}

function nextViewSelectionSaveVersion(accountId) {
  const key = String(accountId || 0);
  const version = Number(viewSelectionSaveVersions.get(key) || 0) + 1;
  viewSelectionSaveVersions.set(key, version);
  return version;
}

function isLatestViewSelectionSaveVersion(accountId, version) {
  return Number(viewSelectionSaveVersions.get(String(accountId || 0)) || 0) === Number(version);
}

function jsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function inventoryItemKey(item) {
  const itemType = Number(item?.itype || 0);
  const itemId = Number(item?.id ?? item?.w_id ?? item?.t_id ?? item?.e_id ?? 0);
  return `${itemType}:${itemId}`;
}

function inventoryItemId(item) {
  return Number(item?.id ?? item?.w_id ?? item?.t_id ?? item?.e_id ?? 0);
}

async function runMigrations() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/i, "");
    const applied = await pgPool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (applied.rowCount) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8").replace(/^\uFEFF/, "");
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function ensurePlayerNamePendingSchema() {
  await pgPool.query("ALTER TABLE players ADD COLUMN IF NOT EXISTS name_pending BOOLEAN NOT NULL DEFAULT false");
}

async function ensureLauncherDeviceSchema() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS launcher_devices (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      device_key_id TEXT NOT NULL,
      device_public_key TEXT NOT NULL,
      hwid_hash TEXT NOT NULL DEFAULT '',
      risk JSONB NOT NULL DEFAULT '{}'::jsonb,
      bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reset_at TIMESTAMPTZ
    )
  `);
  await pgPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS launcher_devices_device_key_id_idx
      ON launcher_devices (device_key_id)
  `);
}

async function syncPostgresCatalog(existingClient = null) {
  const client = existingClient || (await pgPool.connect());
  const ownsClient = !existingClient;
  const catalogItems = allCatalogItems();
  const catalogKeys = catalogItems.map(inventoryItemKey);

  try {
    if (ownsClient) await client.query("BEGIN");

    await client.query(
      `DELETE FROM catalog_items
       WHERE item_type = ANY($1::int[])
         AND NOT (item_key = ANY($2::text[]))`,
      [MANAGED_CATALOG_ITEM_TYPES, catalogKeys]
    );

    for (const item of catalogItems) {
      await client.query(
        `INSERT INTO catalog_items (item_key, item_type, item_id, system_name, item_data, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_id = EXCLUDED.item_id,
           system_name = EXCLUDED.system_name,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [
          inventoryItemKey(item),
          Number(item.itype || 0),
          inventoryItemId(item),
          String(item.sn || item.sname || ""),
          JSON.stringify(item)
        ]
      );
    }

    if (ownsClient) await client.query("COMMIT");
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

async function loadLegacyPostgresStore() {
  const table = await pgPool.query("SELECT to_regclass('public.contracity_store') AS name");
  if (!table.rows[0]?.name) return null;

  const result = await pgPool.query("SELECT data FROM contracity_store WHERE id = $1", ["main"]);
  return result.rows[0]?.data || null;
}

async function loadPostgresStore() {
  const players = await pgPool.query("SELECT * FROM players ORDER BY id");
  const inventory = await pgPool.query("SELECT player_id, item_data FROM player_inventory ORDER BY player_id, created_at, item_key");
  const abilities = await pgPool.query("SELECT player_id, ability_id, ability_level FROM player_abilities ORDER BY player_id, ability_id");
  const clansTable = await pgPool.query("SELECT to_regclass('public.clans') AS name");
  const clans = clansTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clans ORDER BY id")
    : { rows: [] };
  const clanMembers = clansTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clan_members ORDER BY clan_id, joined_at, player_id")
    : { rows: [] };
  const clanInvitesTable = await pgPool.query("SELECT to_regclass('public.clan_invites') AS name");
  const clanInvites = clanInvitesTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clan_invites ORDER BY clan_id, created_at, player_id")
    : { rows: [] };
  const clanEventsTable = await pgPool.query("SELECT to_regclass('public.clan_events') AS name");
  const clanEvents = clanEventsTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clan_events ORDER BY clan_id, id")
    : { rows: [] };
  const clanTreasuryTable = await pgPool.query("SELECT to_regclass('public.clan_treasury_events') AS name");
  const clanTreasury = clanTreasuryTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clan_treasury_events ORDER BY clan_id, id")
    : { rows: [] };
  const clanInventoryTable = await pgPool.query("SELECT to_regclass('public.clan_inventory') AS name");
  const clanInventory = clanInventoryTable.rows[0]?.name
    ? await pgPool.query("SELECT * FROM clan_inventory ORDER BY clan_id, created_at, item_key")
    : { rows: [] };

  const inventoryByPlayer = new Map();
  for (const row of inventory.rows) {
    const list = inventoryByPlayer.get(row.player_id) || [];
    list.push(jsonValue(row.item_data, {}));
    inventoryByPlayer.set(row.player_id, list);
  }

  const abilitiesByPlayer = new Map();
  for (const row of abilities.rows) {
    const list = abilitiesByPlayer.get(row.player_id) || [];
    list.push({ i: Number(row.ability_id), l: Number(row.ability_level) });
    abilitiesByPlayer.set(row.player_id, list);
  }

  const accounts = {};
  for (const row of players.rows) {
    const account = accountFromPostgresRow(row, inventoryByPlayer.get(row.id) || [], abilitiesByPlayer.get(row.id) || []);
    accounts[String(account.id)] = account;
  }

  const clanStore = {
    byId: {},
    nextId: 1,
    nextEventId: 1,
    nextTreasuryEventId: 1
  };
  for (const row of clans.rows) {
    const clan = normalizeClanRecord({
      id: Number(row.id),
      name: row.name,
      tag: row.tag,
      ownerPlayerId: Number(row.owner_player_id || 0),
      level: Number(row.level || 1),
      exp: Number(row.exp || 0),
      money: Number(row.money || 0),
      armId: Number(row.arm_id || 1),
      tagColor: row.tag_color || "",
      homepage: row.homepage || "",
      desc: row.description || "",
      access: Number(row.access ?? 1),
      accessLevel: Number(row.access_level ?? CLAN_JOIN_LEVEL),
      maxMembers: Number(row.max_members || CLAN_DEFAULT_MAX_MEMBERS),
      deletedAt: postgresTimestamp(row.deleted_at) || null,
      createdAt: postgresTimestamp(row.created_at),
      updatedAt: postgresTimestamp(row.updated_at),
      members: {},
      invites: {},
      events: [],
      treasuryEvents: [],
      inventory: []
    });
    clanStore.byId[String(clan.id)] = clan;
    clanStore.nextId = Math.max(clanStore.nextId, Number(clan.id) + 1);
  }
  for (const row of clanMembers.rows) {
    const clan = clanStore.byId[String(row.clan_id)];
    if (!clan) continue;
    clan.members[String(row.player_id)] = normalizeClanMemberRecord({
      playerId: Number(row.player_id),
      memberLevel: Number(row.member_level || (row.role === "owner" ? 2 : 1)),
      money: Number(row.money || 0),
      clanExp: Number(row.clan_exp || 0),
      expKoef: Number(row.exp_koef || 0),
      playerExp: Number(row.player_exp || 0),
      joinedAt: postgresTimestamp(row.joined_at)
    });
  }
  for (const row of clanInvites.rows) {
    const clan = clanStore.byId[String(row.clan_id)];
    if (!clan) continue;
    clan.invites[String(row.player_id)] = {
      playerId: Number(row.player_id),
      createdAt: postgresTimestamp(row.created_at)
    };
  }
  for (const row of clanEvents.rows) {
    const clan = clanStore.byId[String(row.clan_id)];
    if (!clan) continue;
    const event = normalizeClanEventRecord({
      id: Number(row.id),
      clanId: Number(row.clan_id),
      type: Number(row.event_type || 0),
      creatorPlayerId: Number(row.creator_player_id || 0),
      data: jsonValue(row.data, {}),
      expiresAt: postgresTimestamp(row.expires_at),
      createdAt: postgresTimestamp(row.created_at)
    });
    if (event) clan.events.push(event);
    clanStore.nextEventId = Math.max(clanStore.nextEventId, Number(row.id) + 1);
  }
  for (const row of clanTreasury.rows) {
    const clan = clanStore.byId[String(row.clan_id)];
    if (!clan) continue;
    const event = normalizeClanTreasuryRecord({
      id: Number(row.id),
      clanId: Number(row.clan_id),
      playerId: Number(row.player_id || 0),
      playerName: row.player_name || "",
      money: Number(row.money || 0),
      type: Number(row.event_type || 0),
      createdAt: postgresTimestamp(row.created_at)
    });
    if (event) clan.treasuryEvents.push(event);
    clanStore.nextTreasuryEventId = Math.max(clanStore.nextTreasuryEventId, Number(row.id) + 1);
  }
  for (const row of clanInventory.rows) {
    const clan = clanStore.byId[String(row.clan_id)];
    if (!clan) continue;
    const item = jsonValue(row.item_data, {});
    if (item && typeof item === "object") clan.inventory.push({ ...item, itemKey: row.item_key });
  }

  return normalizeStore({ accounts, clans: clanStore });
}

async function initStore() {
  if (!DATABASE_URL) {
    return loadStore();
  }

  const { Pool } = await import("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
  });

  await runMigrations();
  await ensurePlayerNamePendingSchema();
  await ensureLauncherDeviceSchema();
  await syncPostgresCatalog();

  let loaded = await loadPostgresStore();
  if (Object.keys(loaded.accounts).length > 0) {
    return loaded;
  }

  const legacy = await loadLegacyPostgresStore();
  if (legacy?.accounts) {
    await savePostgresStore(legacy);
    loaded = await loadPostgresStore();
    if (Object.keys(loaded.accounts).length > 0) {
      return loaded;
    }
  }

  return normalizeStore({ accounts: {} });
}

async function savePostgresStore(nextStore) {
  const client = await pgPool.connect();
  try {
    nextStore = normalizeStore(nextStore);
    await client.query("BEGIN");

    for (const rawAccount of Object.values(nextStore.accounts || {})) {
      const account = normalizeAccount(rawAccount);
      const createdAt = account.createdAt || new Date().toISOString();
      const updatedAt = account.updatedAt || new Date().toISOString();
      const existingPlayer = await client.query("SELECT updated_at FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      if (existingPlayer.rows[0] && isOlderPostgresSnapshot(updatedAt, existingPlayer.rows[0].updated_at)) {
        continue;
      }

      await client.query(
        `INSERT INTO players (
          id, cckey, name, full_name, level, exp, exp_min, exp_max, money,
          view, weap, taun, stats, name_pending, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          cckey = EXCLUDED.cckey,
          name = EXCLUDED.name,
          full_name = EXCLUDED.full_name,
          level = EXCLUDED.level,
          exp = EXCLUDED.exp,
          exp_min = EXCLUDED.exp_min,
          exp_max = EXCLUDED.exp_max,
          money = EXCLUDED.money,
          view = EXCLUDED.view,
          weap = EXCLUDED.weap,
          taun = EXCLUDED.taun,
          stats = EXCLUDED.stats,
          name_pending = EXCLUDED.name_pending,
          updated_at = EXCLUDED.updated_at`,
        [
          account.id,
          account.key,
          account.name,
          account.fullName,
          account.level,
          account.exp,
          account.expMin,
          account.expMax,
          account.money,
          JSON.stringify(account.view || {}),
          JSON.stringify(account.weap || {}),
          JSON.stringify(account.taun || {}),
          JSON.stringify(account.stats || {}),
          Boolean(account.namePending),
          createdAt,
          updatedAt
        ]
      );

      await client.query("DELETE FROM player_inventory WHERE player_id = $1", [account.id]);
      for (const item of account.inventory || []) {
        await client.query(
          `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, now())
           ON CONFLICT (player_id, item_key) DO UPDATE SET
             item_type = EXCLUDED.item_type,
             item_data = EXCLUDED.item_data,
             updated_at = now()`,
          [account.id, inventoryItemKey(item), Number(item?.itype || 0), JSON.stringify(item)]
        );
      }

      await client.query("DELETE FROM player_abilities WHERE player_id = $1", [account.id]);
      for (const ability of account.abilities || []) {
        await client.query(
          `INSERT INTO player_abilities (player_id, ability_id, ability_level, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (player_id, ability_id) DO UPDATE SET
             ability_level = EXCLUDED.ability_level,
             updated_at = now()`,
          [account.id, Number(ability.i || 0), Number(ability.l || 1)]
        );
      }

      await client.query(
        `INSERT INTO player_equipment (player_id, view, weap, taun, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, now())
         ON CONFLICT (player_id) DO UPDATE SET
           view = EXCLUDED.view,
           weap = EXCLUDED.weap,
           taun = EXCLUDED.taun,
           updated_at = now()`,
        [account.id, JSON.stringify(account.view || {}), JSON.stringify(account.weap || {}), JSON.stringify(account.taun || {})]
      );

      const ownedWeapons = [...defaultWeapons, ...(account.inventory || []).filter((item) => Number(item.itype) === 1)];
      const accountWeaponStats = new Map((account.weaponStats || []).map((item) => [Number(item.wid || item.weapon_id || 0), item]));
      for (const weaponItem of ownedWeapons) {
        const weaponId = Number(weaponItem.w_id || weaponItem.id || 0);
        const weaponStats = accountWeaponStats.get(weaponId) || {};
        await client.query(
          `INSERT INTO player_weapon_stats (player_id, weapon_id, weapon_type, system_name, kills, headshots, nuts, shots, hits, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           ON CONFLICT (player_id, weapon_id) DO UPDATE SET
             weapon_type = EXCLUDED.weapon_type,
             system_name = EXCLUDED.system_name,
             kills = GREATEST(player_weapon_stats.kills, EXCLUDED.kills),
             headshots = GREATEST(player_weapon_stats.headshots, EXCLUDED.headshots),
             nuts = GREATEST(player_weapon_stats.nuts, EXCLUDED.nuts),
             shots = GREATEST(player_weapon_stats.shots, EXCLUDED.shots),
             hits = GREATEST(player_weapon_stats.hits, EXCLUDED.hits),
             updated_at = now()`,
          [
            account.id,
            weaponId,
            Number(weaponStats.wt ?? weaponStats.weapon_type ?? weaponItem.wt ?? 0),
            String(weaponStats.sn || weaponStats.system_name || weaponItem.sn || weaponItem.sname || ""),
            statNumber(weaponStats.k ?? weaponStats.kills, 0),
            statNumber(weaponStats.hs ?? weaponStats.headshots, 0),
            statNumber(weaponStats.ns ?? weaponStats.nuts, 0),
            statNumber(weaponStats.sh ?? weaponStats.shots, 0),
            statNumber(weaponStats.hi ?? weaponStats.hits, 0)
          ]
        );
      }

      const achievementProgress = achievementProgressFor(account);
      for (const [achievementId, progress] of Object.entries(achievementProgress)) {
        await client.query(
          `INSERT INTO player_achievements (player_id, achievement_id, current_value, claimed_value, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (player_id, achievement_id) DO UPDATE SET
             current_value = EXCLUDED.current_value,
             claimed_value = EXCLUDED.claimed_value,
             updated_at = now()`,
          [account.id, Number(achievementId), Number(progress.v || 0), Number(progress.c || 0)]
        );
      }
    }

    await client.query("DELETE FROM clan_inventory");
    await client.query("DELETE FROM clan_treasury_events");
    await client.query("DELETE FROM clan_events");
    await client.query("DELETE FROM clan_invites");
    await client.query("DELETE FROM clan_members");
    await client.query("DELETE FROM clans");

    for (const clan of Object.values(nextStore.clans?.byId || {})) {
      const normalized = normalizeClanRecord(clan);
      await client.query(
        `INSERT INTO clans (
          id, name, tag, owner_player_id, level, exp, money, arm_id,
          tag_color, homepage, description, access, access_level, max_members,
          deleted_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          normalized.id,
          normalized.name,
          normalized.tag,
          normalized.ownerPlayerId || null,
          normalized.level,
          normalized.exp,
          normalized.money,
          normalized.armId,
          normalized.tagColor,
          normalized.homepage,
          normalized.desc,
          normalized.access,
          normalized.accessLevel,
          normalized.maxMembers,
          normalized.deletedAt,
          normalized.createdAt,
          normalized.updatedAt
        ]
      );

      for (const member of Object.values(normalized.members || {})) {
        if (!nextStore.accounts?.[String(member.playerId)]) continue;
        await client.query(
          `INSERT INTO clan_members (
            clan_id, player_id, role, member_level, money, clan_exp, exp_koef, player_exp, joined_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            normalized.id,
            member.playerId,
            Number(member.playerId) === Number(normalized.ownerPlayerId) ? "owner" : "member",
            member.memberLevel,
            member.money,
            member.clanExp,
            member.expKoef,
            member.playerExp,
            member.joinedAt
          ]
        );
      }

      for (const invite of Object.values(normalized.invites || {})) {
        if (!nextStore.accounts?.[String(invite.playerId)]) continue;
        await client.query(
          `INSERT INTO clan_invites (clan_id, player_id, created_at)
           VALUES ($1, $2, $3)`,
          [normalized.id, invite.playerId, invite.createdAt]
        );
      }

      for (const event of normalized.events || []) {
        await client.query(
          `INSERT INTO clan_events (id, clan_id, event_type, creator_player_id, data, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            event.id,
            normalized.id,
            event.type,
            event.creatorPlayerId || null,
            JSON.stringify(event.data || {}),
            event.expiresAt,
            event.createdAt
          ]
        );
      }

      for (const event of normalized.treasuryEvents || []) {
        await client.query(
          `INSERT INTO clan_treasury_events (id, clan_id, player_id, player_name, money, event_type, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            event.id,
            normalized.id,
            event.playerId || null,
            event.playerName,
            event.money,
            event.type,
            event.createdAt
          ]
        );
      }

      for (const item of normalized.inventory || []) {
        const itemKey = String(item.itemKey || inventoryItemKey(item));
        await client.query(
          `INSERT INTO clan_inventory (clan_id, item_key, item_data, expires_at, created_at)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           ON CONFLICT (clan_id, item_key) DO UPDATE SET
             item_data = EXCLUDED.item_data,
             expires_at = EXCLUDED.expires_at`,
          [
            normalized.id,
            itemKey,
            JSON.stringify(item),
            Number(item.eD || 0) > 0 ? new Date(Number(item.eD) * 1000).toISOString() : null,
            item.createdAt || new Date().toISOString()
          ]
        );
      }
    }

    await syncPostgresCatalog(client);

    await client.query("COMMIT");
  } catch (error) {
    console.error("Failed to save PostgreSQL store", error);
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors after a failed connection.
    }
  } finally {
    client.release();
  }
}

let store = await initStore();

function canonicalWeaponForRawItem(item) {
  if (Number(item?.itype || 0) !== 1) return null;
  const rawId = Number(item?.w_id ?? item?.id);
  const byId = canonicalWeaponsById.get(rawId) || null;
  if (rawId >= 1 && rawId <= 7 && byId) return byId;
  return canonicalWeaponsBySname.get(weaponSnameKey(item)) || byId;
}

function weaponAllowedInSlot(item, slot) {
  return Number(item?.ws || 0) === Number(slot);
}

function hasActiveWeaponUpgrade(item, now = currentUnixSeconds()) {
  if (Number(item?.itype || 0) !== 1 || item?.u_id == null) return false;
  const expiresAt = Number(item?.eD || 0);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function normalizeInventoryItem(item) {
  const type = Number(item?.itype || 0);
  if (type === 1) {
    const canonical = canonicalWeaponForRawItem(item);
    if (canonical && item?.u_id != null) {
      if (!hasActiveWeaponUpgrade(item)) return clone(canonical);
      return {
        ...clone(canonical),
        ...clone(item),
        id: canonical.id,
        w_id: canonical.w_id,
        sname: canonical.sname,
        sn: canonical.sn,
        wt: canonical.wt,
        ws: canonical.ws,
        name: canonical.name
      };
    }
    return canonical
      ? {
          ...clone(item),
          ...clone(canonical),
          id: canonical.id,
          w_id: canonical.w_id,
          sname: canonical.sname,
          sn: canonical.sn,
          wt: canonical.wt,
          ws: canonical.ws,
          name: canonical.name,
          sc: canonical.sc
        }
      : item;
  }
  if (type === 3) {
    const canonical = canonicalWearsById.get(Number(item?.w_id ?? item?.id));
    return canonical
      ? {
          ...clone(item),
          ...clone(canonical),
          id: canonical.id,
          w_id: canonical.w_id,
          sname: canonical.sname,
          sn: canonical.sn,
          wt: canonical.wt
        }
      : item;
  }
  if (type === 4) {
    const canonical = canonicalTauntsById.get(Number(item?.t_id ?? item?.id));
    return canonical ? { ...clone(canonical), ...clone(item), t_id: canonical.t_id, sname: canonical.sname, sn: canonical.sn } : item;
  }
  if (type === 2) {
    const canonical = canonicalEnhancersById.get(Number(item?.e_id ?? item?.id));
    return canonical ? { ...clone(canonical), ...clone(item), e_id: canonical.e_id, sname: canonical.sname, sn: canonical.sn } : item;
  }
  return item;
}

function normalizeWeaponSelection(selection, rawInventory = []) {
  const byRawId = new Map();
  for (const raw of rawInventory.map(normalizeInventoryItem)) {
    const rawId = Number((raw?.w_id ?? raw?.id) || 0);
    const canonical = canonicalWeaponForRawItem(raw);
    if (rawId && canonical) byRawId.set(rawId, canonical);
  }

  const normalized = { ...selection };
  for (let slot = 1; slot <= 7; slot += 1) {
    const key = `id${slot}`;
    const selectedId = Number(normalized[key] || 0);
    if (!selectedId) continue;

    const canonical = canonicalWeaponsById.get(selectedId) || byRawId.get(selectedId);
    if (canonical && weaponAllowedInSlot(canonical, slot)) {
      normalized[key] = Number(canonical.w_id || canonical.id);
    } else {
      normalized[key] = 0;
    }
  }
  return normalized;
}

function inventoryWeaponId(item) {
  return Number(item?.w_id ?? item?.id ?? 0);
}

function hasInventoryWeapon(inventory, weaponId) {
  return inventory.some((item) => Number(item?.itype || 0) === 1 && inventoryWeaponId(item) === Number(weaponId));
}

function inventoryWearId(item) {
  return Number(item?.w_id ?? item?.id ?? 0);
}

const viewKeyByWearType = new Map([
  [1, "hat"],
  [2, "mask"],
  [3, "gloves"],
  [4, "shirt"],
  [5, "pants"],
  [6, "boots"],
  [7, "backpack"],
  [8, "other"],
  [9, "head"]
]);

function viewAfterPurchasedWear(view, item) {
  const current = { ...(view || {}) };
  if (Number(item?.itype || 0) !== 3) return current;
  const viewKey = viewKeyByWearType.get(Number(item?.wt || 0));
  const wearId = inventoryWearId(item);
  if (viewKey && wearId > 0) current[viewKey] = wearId;
  return current;
}

function weaponSelectionAfterPurchasedWeapon(selection, item) {
  const current = { ...(selection || {}) };
  if (Number(item?.itype || 0) !== 1) return current;
  const slot = Number(item?.ws || 0);
  const weaponId = inventoryWeaponId(item);
  if (slot < 1 || slot > 7 || weaponId <= 0) return current;
  current[`id${slot}`] = weaponId;
  return current;
}

function hasInventoryWear(inventory, wearId) {
  return inventory.some((item) => Number(item?.itype || 0) === 3 && inventoryWearId(item) === Number(wearId));
}

function normalizeLoadoutInventory(selection, rawInventory = []) {
  const inventory = rawInventory.map(normalizeInventoryItem);
  const weap = normalizeWeaponSelection(selection, inventory);

  for (let slot = 1; slot <= 7; slot += 1) {
    const key = `id${slot}`;
    const weaponId = Number(weap[key] || 0);
    if (!weaponId) continue;

    const canonical = canonicalWeaponsById.get(weaponId);
    if (!canonical) {
      weap[key] = 0;
      continue;
    }

    if (!hasInventoryWeapon(inventory, weaponId)) {
      inventory.push(clone(canonical));
    }
  }

  return { weap, inventory };
}

function normalizeViewInventory(view, rawInventory = []) {
  const inventory = rawInventory.map(normalizeInventoryItem);
  const normalized = { ...view };

  for (const key of viewWearKeys) {
    const wearId = Number(normalized[key] || 0);
    if (!wearId) continue;

    const canonical = canonicalWearsById.get(wearId);
    if (!canonical) {
      normalized[key] = 0;
      continue;
    }

    if (!hasInventoryWear(inventory, wearId)) {
      inventory.push(clone(canonical));
    }
  }

  return { view: normalized, inventory };
}

function profileInventoryItems(account) {
  return Array.isArray(account?.inventory) ? account.inventory.map(normalizeInventoryItem) : [];
}

function selectedProfileWear(inventory, wearId) {
  const id = Number(wearId || 0);
  if (!id) return 0;

  const owned = inventory.find((item) => Number(item?.itype || 0) === 3 && inventoryWearId(item) === id);
  const item = owned || canonicalWearsById.get(id);
  return item ? clone(normalizeInventoryItem(item)) : 0;
}

function selectedProfileWeapon(inventory, weaponId, slot) {
  const id = Number(weaponId || 0);
  if (!id) return 0;

  const owned = inventory.find((item) => Number(item?.itype || 0) === 1 && inventoryWeaponId(item) === id);
  const item = normalizeInventoryItem(owned || canonicalWeaponsById.get(id));
  if (!item || !weaponAllowedInSlot(item, slot)) return 0;
  return clone(item);
}

function profileViewObjectPayload(account) {
  const inventory = profileInventoryItems(account);
  return Object.fromEntries(
    viewWearKeys.map((key) => [key, selectedProfileWear(inventory, account?.view?.[key])])
  );
}

function profileWeaponObjectPayload(account) {
  const inventory = profileInventoryItems(account);
  const result = {};
  for (let slot = 1; slot <= 7; slot += 1) {
    const key = `id${slot}`;
    result[key] = selectedProfileWeapon(inventory, account?.weap?.[key], slot);
  }
  return result;
}

function normalizeAccount(account) {
  const fresh = starterAccount(account?.name);
  const rawInventory = Array.isArray(account?.inventory) ? account.inventory : [];
  const loadoutInventory = normalizeLoadoutInventory({ ...fresh.weap, ...(account?.weap || {}) }, rawInventory);
  const viewInventory = normalizeViewInventory({ ...fresh.view, ...(account?.view || {}) }, loadoutInventory.inventory);
  return {
    ...fresh,
    ...account,
    view: viewInventory.view,
    weap: loadoutInventory.weap,
    taun: { ...fresh.taun, ...(account?.taun || {}) },
    stats: { ...fresh.stats, ...(account?.stats || {}) },
    inventory: viewInventory.inventory,
    abilities: Array.isArray(account?.abilities) ? account.abilities : [],
    clanMaxRequest: Number(account?.clanMaxRequest || fresh.clanMaxRequest || 10),
    clan: normalizeClanSummary(account?.clan || null),
    weaponStats: Array.isArray(account?.weaponStats) ? account.weaponStats : [],
    modeStats: Array.isArray(account?.modeStats) ? account.modeStats : [],
    mapStats: Array.isArray(account?.mapStats) ? account.mapStats : []
  };
}

function ensureDesktopAccount() {
  const existing = store.accounts["1"] ? normalizeAccount(store.accounts["1"]) : null;
  if (existing) {
    existing.id = 1;
    store.accounts["1"] = existing;
    return existing;
  }

  store.accounts["1"] = normalizeAccount(starterAccount(process.env.PLAYER_NAME || "ContraCity", 1, DEFAULT_KEY));
  saveStore(store);
  return store.accounts["1"];
}

function randomLauncherToken() {
  return crypto
    .randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pruneLauncherSessions(now = Date.now()) {
  for (const [token, session] of launcherSessions) {
    if (!session || Number(session.expiresAt || 0) <= now) {
      launcherSessions.delete(token);
    }
  }
}

function createLauncherSession(account) {
  pruneLauncherSessions();
  const token = randomLauncherToken();
  const expiresAt = Date.now() + LAUNCHER_SESSION_TTL_MS;
  launcherSessions.set(token, {
    id: String(account.id),
    key: String(account.key),
    expiresAt
  });
  return {
    token,
    expiresInSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))
  };
}

function launcherSessionCredentials(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  pruneLauncherSessions();
  const session = launcherSessions.get(token);
  if (!session) return null;
  return { id: String(session.id), key: String(session.key) };
}

function accountCredentialsFrom(url) {
  const rawId = url.searchParams.get("ccid");
  const key = url.searchParams.get("cckey");
  const idNumber = Number(rawId);

  if (rawId && Number.isInteger(idNumber) && idNumber > 0 && key) {
    if (key === "contra-revive-key") return null;
    return { id: String(idNumber), key };
  }

  const sessionCredentials = launcherSessionCredentials(url.searchParams.get("ccsession"));
  if (sessionCredentials) {
    return sessionCredentials;
  }

  return null;
}

const ajaxActAliases = {
  profile: "i",
  inventory: "inv",
  weapons: "weap",
  weapon: "weap",
  wears: "wear",
  clothes: "wear",
  abilities: "abil",
  maps: "map",
  achievements: "ach"
};

function normalizedAjaxRoute(url) {
  let page = url.searchParams.get("page") || "";
  let act = url.searchParams.get("act") || url.searchParams.get("action") || "";

  if (page === "sh") page = "shop";
  if (page === "ch") page = "pl";
  act = ajaxActAliases[act] || act;

  return { page, act };
}

function isWeaponSelectionSaveRequest(url) {
  const { page, act } = normalizedAjaxRoute(url);
  return page === "pl" && act === "sweap";
}

function isEquipmentSelectionSaveRequest(url) {
  const { page, act } = normalizedAjaxRoute(url);
  return page === "pl" && (act === "sweap" || act === "sview");
}

function accountFrom(url) {
  const credentials = accountCredentialsFrom(url);
  if (!credentials) {
    return null;
  }

  const account = store.accounts[credentials.id] ? normalizeAccount(store.accounts[credentials.id]) : null;
  if (!account || account.key !== credentials.key) {
    return null;
  }
  store.accounts[credentials.id] = account;
  return account;
}

function persist(account) {
  account.updatedAt = new Date().toISOString();
  store.accounts[String(account.id)] = normalizeAccount(account);
  saveStore(store);
}

async function accountFromRequest(url) {
  const credentials = accountCredentialsFrom(url);
  if (!credentials) {
    return null;
  }

  const skipPreRefresh = isEquipmentSelectionSaveRequest(url);
  const cached = store.accounts[credentials.id] ? normalizeAccount(store.accounts[credentials.id]) : null;
  if (cached && cached.key === credentials.key) {
    store.accounts[credentials.id] = cached;
    return skipPreRefresh ? cached : refreshAccountFromPostgres(cached);
  }

  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const fresh = await loadPostgresAccount(credentials.id);
      if (fresh && fresh.key === credentials.key) {
        store.accounts[credentials.id] = fresh;
        return fresh;
      }
    } catch (error) {
      console.error("[postgres] account lookup failed", error);
    }
  }

  const account = accountFrom(url);
  return skipPreRefresh ? account : refreshAccountFromPostgres(account);
}

function postgresTimestamp(value) {
  return value?.toISOString?.() || value;
}

function isOlderPostgresSnapshot(snapshotUpdatedAt, databaseUpdatedAt) {
  const snapshotMs = Date.parse(postgresTimestamp(snapshotUpdatedAt));
  const databaseMs = Date.parse(postgresTimestamp(databaseUpdatedAt));
  return Number.isFinite(snapshotMs) && Number.isFinite(databaseMs) && snapshotMs < databaseMs;
}

function accountFromPostgresRow(row, inventory = [], abilities = [], weaponStats = [], modeStats = [], mapStats = []) {
  return normalizeAccount({
    id: Number(row.id),
    key: row.cckey,
    name: row.name,
    namePending: Boolean(row.name_pending),
    fullName: row.full_name,
    level: Number(row.level),
    exp: Number(row.exp),
    expMin: Number(row.exp_min),
    expMax: Number(row.exp_max),
    money: Number(row.money),
    view: jsonValue(row.view, {}),
    weap: jsonValue(row.weap, {}),
    taun: jsonValue(row.taun, {}),
    stats: jsonValue(row.stats, {}),
    inventory,
    abilities,
    weaponStats,
    modeStats,
    mapStats,
    createdAt: postgresTimestamp(row.created_at),
    updatedAt: postgresTimestamp(row.updated_at)
  });
}

async function loadPostgresAccount(id) {
  if (!pgPool) return null;
  const player = await pgPool.query("SELECT * FROM players WHERE id = $1", [Number(id)]);
  const row = player.rows[0];
  if (!row) return null;

  const inventory = await pgPool.query(
    "SELECT item_data FROM player_inventory WHERE player_id = $1 ORDER BY created_at, item_key",
    [Number(row.id)]
  );
  const abilities = await pgPool.query(
    "SELECT ability_id, ability_level FROM player_abilities WHERE player_id = $1 ORDER BY ability_id",
    [Number(row.id)]
  );
  const weaponStats = await pgPool.query(
    `SELECT weapon_id, weapon_type, system_name, kills, headshots, nuts, shots, hits
     FROM player_weapon_stats
     WHERE player_id = $1
     ORDER BY kills DESC, weapon_id`,
    [Number(row.id)]
  );
  const modeStats = await pgPool.query(
    `SELECT mode, SUM(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins, 0::int AS losses, SUM(play_time)::int AS play_time
     FROM player_match_stats
     WHERE player_id = $1
     GROUP BY mode
     ORDER BY play_time DESC, mode`,
    [Number(row.id)]
  );
  const mapStats = await pgPool.query(
    `SELECT map_name, SUM(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins, 0::int AS losses, SUM(play_time)::int AS play_time
     FROM player_match_stats
     WHERE player_id = $1
     GROUP BY map_name
     ORDER BY play_time DESC, map_name`,
    [Number(row.id)]
  );

  const account = accountFromPostgresRow(
    row,
    inventory.rows.map((itemRow) => jsonValue(itemRow.item_data, {})),
    abilities.rows.map((abilityRow) => ({ i: Number(abilityRow.ability_id), l: Number(abilityRow.ability_level) })),
    weaponStats.rows.map((statRow) => ({
      wid: Number(statRow.weapon_id),
      wt: Number(statRow.weapon_type),
      sn: String(statRow.system_name || ""),
      k: Number(statRow.kills || 0),
      hs: Number(statRow.headshots || 0),
      ns: Number(statRow.nuts || 0),
      sh: Number(statRow.shots || 0),
      hi: Number(statRow.hits || 0)
    })),
    modeStats.rows.map((statRow) => ({
      m: Number(statRow.mode || 0),
      w: Number(statRow.wins || 0),
      l: Number(statRow.losses || 0),
      pt: Number(statRow.play_time || 0)
    })),
    mapStats.rows.map((statRow) => ({
      n: String(statRow.map_name || ""),
      w: Number(statRow.wins || 0),
      l: Number(statRow.losses || 0),
      pt: Number(statRow.play_time || 0)
    }))
  );
  account.clan = clanSummaryForPlayer(account.id);
  return normalizeAccount(account);
}

async function refreshAccountFromPostgres(account) {
  if (!pgPool || !account?.id) return account;

  try {
    await pgSaveChain.catch(() => {});
    const fresh = await loadPostgresAccount(account.id);
    if (!fresh) return account;
    if (account.key && fresh.key && account.key !== fresh.key) return account;

    store.accounts[String(fresh.id)] = fresh;
    return fresh;
  } catch (error) {
    console.error("[postgres] account refresh failed", error);
    return account;
  }
}

async function profileAccountForView(account, url) {
  const targetId = Number(url.searchParams.get("ui") || 0);
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(account.id)) return account;

  let target = accountById(targetId);
  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const fresh = await loadPostgresAccount(targetId);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
        target = fresh;
      }
    } catch (error) {
      console.error("[postgres] profile view account load failed", error);
    }
  }

  if (target) {
    console.log(`[profile-view] requester=${account.id} target=${target.id}`);
  } else {
    console.warn(`[profile-view] requester=${account.id} target=${targetId} missing`);
  }
  return target || account;
}

function sessionAuth(account) {
  return `ccid=${encodeURIComponent(String(account.id))}&cckey=${encodeURIComponent(String(account.key))}&`;
}

function publicBaseUrl(requestOrigin = null) {
  return String((ALLOW_DYNAMIC_PUBLIC_ORIGIN ? requestOrigin : "") || PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function loginLink(account, requestOrigin = null) {
  return `${publicBaseUrl(requestOrigin)}/vk-login?${sessionAuth(account)}`;
}

function sessionPayload(account, requestOrigin = null) {
  return {
    ccid: account.id,
    cckey: account.key,
    sessionAuth: sessionAuth(account),
    loginLink: loginLink(account, requestOrigin),
    ajaxUrl: `${publicBaseUrl(requestOrigin)}/ajax.php?${sessionAuth(account)}`,
    storage: pgPool ? "postgres" : "json-file"
  };
}

function launcherPlayerPayload(account) {
  const stats = playerStats(account);
  const modeStats = gameModeStatItems(account);
  const wins = statNumber(stats.w, 0) || modeStats.reduce((sum, item) => sum + statNumber(item.w, 0), 0);
  const playMinutes = statNumber(stats.pt, 0) || modeStats.reduce((sum, item) => sum + statNumber(item.pt, 0), 0);
  const level = Number(account.level || 1);
  return {
    username: String(account.name || account.fullName || `Player ${account.id}`),
    level,
    kills: statNumber(stats.k, 0),
    deaths: statNumber(stats.d, 0),
    wins,
    playtime_hours: Math.max(0, Math.floor(playMinutes / 60))
  };
}

function launcherNewsPayload() {
  return [
    {
      id: "fresh-build",
      title: `РЎРІРµР¶Р°СЏ СЃР±РѕСЂРєР° v${LAUNCHER_VERSION}`,
      is_pinned: true
    }
  ];
}

function launcherStatePayload(account) {
  return {
    result: true,
    version: LAUNCHER_VERSION,
    manifestUrl: GAME_CLASSIC_MANIFEST_URL,
    textureManifestUrl: GAME_NEW_TEXTURES_MANIFEST_URL,
    updateKey: GAME_CLASSIC_UPDATE_KEY,
    textureUpdateKey: GAME_NEW_TEXTURES_UPDATE_KEY,
    sessionAuth: account ? sessionAuth(account) : "",
    player: account ? launcherPlayerPayload(account) : null,
    news: launcherNewsPayload(),
    downloads: {
      u: LAUNCHER_MANIFEST_URL,
      k: LAUNCHER_UPDATE_KEY
    }
  };
}

function normalizeLauncherDeviceKeyId(value) {
  const keyId = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(keyId)) return "";
  return keyId;
}

function normalizeLauncherPublicKey(value) {
  const publicKey = String(value || "").trim();
  if (!publicKey || publicKey.length > 2048) return "";
  if (!publicKey.includes("BEGIN PUBLIC KEY") || !publicKey.includes("END PUBLIC KEY")) return "";
  return publicKey;
}

function normalizeHwidRiskHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function launcherDeviceCredentials(body, url = null) {
  const rawId = body?.ccid ?? url?.searchParams?.get("ccid");
  const key = String(body?.cckey ?? url?.searchParams?.get("cckey") ?? "");
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !key) return null;
  return { id: String(id), key };
}

async function accountFromLauncherDeviceBody(body, url = null) {
  const credentials = launcherDeviceCredentials(body, url);
  if (!credentials) return null;
  const credentialUrl = new URL("https://launcher.local/launcher-state");
  credentialUrl.searchParams.set("ccid", credentials.id);
  credentialUrl.searchParams.set("cckey", credentials.key);
  return accountFromRequest(credentialUrl);
}

async function loadLauncherDevice(accountId) {
  if (!accountId) return null;
  if (pgPool) {
    const result = await pgPool.query("SELECT * FROM launcher_devices WHERE player_id = $1", [Number(accountId)]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      playerId: Number(row.player_id),
      deviceKeyId: row.device_key_id,
      publicKey: row.device_public_key,
      hwidHash: row.hwid_hash || "",
      risk: jsonValue(row.risk, {}),
      boundAt: postgresTimestamp(row.bound_at),
      lastSeenAt: postgresTimestamp(row.last_seen_at),
      resetAt: postgresTimestamp(row.reset_at)
    };
  }

  const account = store.accounts[String(accountId)];
  return account?.launcherDevice || null;
}

async function bindLauncherDevice(account, body, req) {
  const deviceKeyId = normalizeLauncherDeviceKeyId(body?.deviceKeyId);
  const publicKey = normalizeLauncherPublicKey(body?.devicePublicKey);
  const hwidHash = normalizeHwidRiskHash(body?.hwidRiskHash);
  if (!deviceKeyId || !publicKey || !hwidHash) {
    return { ok: false, error: "device_bind_required" };
  }

  const now = new Date().toISOString();
  const risk = { hwidChanged: false, ip: requestClientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 160) };
  if (pgPool) {
    const existingDevice = await pgPool.query(
      "SELECT player_id FROM launcher_devices WHERE device_key_id = $1 AND player_id <> $2",
      [deviceKeyId, Number(account.id)]
    );
    if (existingDevice.rowCount) {
      return { ok: false, error: "device_already_bound" };
    }

    try {
      await pgPool.query(
        `INSERT INTO launcher_devices (player_id, device_key_id, device_public_key, hwid_hash, risk, bound_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
         ON CONFLICT (player_id) DO NOTHING`,
        [Number(account.id), deviceKeyId, publicKey, hwidHash, JSON.stringify(risk)]
      );
    } catch (error) {
      if (error?.code === "23505") {
        return { ok: false, error: "device_already_bound" };
      }
      throw error;
    }
  } else {
    for (const existing of Object.values(store.accounts || {})) {
      if (Number(existing?.id) !== Number(account.id) && existing?.launcherDevice?.deviceKeyId === deviceKeyId) {
        return { ok: false, error: "device_already_bound" };
      }
    }
    const normalized = normalizeAccount(account);
    normalized.launcherDevice = { playerId: Number(account.id), deviceKeyId, publicKey, hwidHash, risk, boundAt: now, lastSeenAt: now };
    store.accounts[String(account.id)] = normalized;
    await saveStore(store);
  }

  console.log(`[launcher-device] bound player=${account.id} keyId=${deviceKeyId}`);
  return { ok: true };
}

async function touchLauncherDevice(account, device, hwidHash, req) {
  const normalizedHash = normalizeHwidRiskHash(hwidHash);
  const risk = {
    hwidChanged: Boolean(device?.hwidHash && normalizedHash && device.hwidHash !== normalizedHash),
    ip: requestClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 160)
  };

  if (pgPool) {
    await pgPool.query(
      `UPDATE launcher_devices
       SET hwid_hash = COALESCE(NULLIF($2, ''), hwid_hash), risk = $3::jsonb, last_seen_at = now()
       WHERE player_id = $1`,
      [Number(account.id), normalizedHash, JSON.stringify(risk)]
    );
  } else if (store.accounts[String(account.id)]?.launcherDevice) {
    const normalized = normalizeAccount(store.accounts[String(account.id)]);
    normalized.launcherDevice = { ...normalized.launcherDevice, hwidHash: normalizedHash || normalized.launcherDevice.hwidHash, risk, lastSeenAt: new Date().toISOString() };
    store.accounts[String(account.id)] = normalized;
    await saveStore(store);
  }

  if (risk.hwidChanged) {
    console.warn(`[launcher-device] hwid risk player=${account.id} keyId=${device.deviceKeyId}`);
  }
}

function pruneLauncherDeviceChallenges() {
  const now = Date.now();
  for (const [nonce, challenge] of launcherDeviceChallenges) {
    if (challenge.expiresAt <= now) launcherDeviceChallenges.delete(nonce);
  }
}

function createLauncherDeviceChallenge(account, deviceKeyId) {
  pruneLauncherDeviceChallenges();
  const nonce = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + LAUNCHER_DEVICE_CHALLENGE_TTL_MS;
  launcherDeviceChallenges.set(nonce, { playerId: Number(account.id), deviceKeyId, expiresAt });
  return { nonce, expiresInSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) };
}

function consumeLauncherDeviceChallenge(account, deviceKeyId, nonce) {
  pruneLauncherDeviceChallenges();
  const challenge = launcherDeviceChallenges.get(String(nonce || ""));
  if (!challenge) return false;
  launcherDeviceChallenges.delete(String(nonce));
  return challenge.playerId === Number(account.id) && challenge.deviceKeyId === deviceKeyId && challenge.expiresAt > Date.now();
}

function decodeSignature(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return Buffer.from(raw, "base64");
  } catch {
    try {
      return Buffer.from(raw, "base64url");
    } catch {
      return null;
    }
  }
}

function verifyLauncherDeviceSignature(device, nonce, signature) {
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes || !nonce) return false;
  try {
    return crypto.verify("sha256", Buffer.from(String(nonce), "utf8"), device.publicKey, signatureBytes);
  } catch (error) {
    console.warn(`[launcher-device] signature verify failed keyId=${device.deviceKeyId}: ${error.message}`);
    return false;
  }
}

async function verifyLauncherDeviceAccess(account, body, req) {
  const current = await loadLauncherDevice(account.id);
  if (!current) {
    const bound = await bindLauncherDevice(account, body, req);
    if (!bound.ok) return { ok: false, status: 403, error: bound.error };
    return { ok: true, bound: true };
  }

  const deviceKeyId = normalizeLauncherDeviceKeyId(body?.deviceKeyId);
  if (!deviceKeyId || deviceKeyId !== current.deviceKeyId) {
    return { ok: false, status: 403, error: "device_signature_required" };
  }

  const nonce = String(body?.challengeNonce || "").trim();
  if (!nonce || !body?.challengeSignature) {
    return { ok: false, status: 403, error: "device_signature_required" };
  }

  if (!consumeLauncherDeviceChallenge(account, deviceKeyId, nonce)) {
    return { ok: false, status: 403, error: "device_challenge_invalid" };
  }

  if (!verifyLauncherDeviceSignature(current, nonce, body.challengeSignature)) {
    return { ok: false, status: 403, error: "device_signature_invalid" };
  }

  await touchLauncherDevice(account, current, body?.hwidRiskHash, req);
  return { ok: true, bound: true };
}

async function resetLauncherDeviceBinding(accountId) {
  if (pgPool) {
    const result = await pgPool.query("DELETE FROM launcher_devices WHERE player_id = $1", [Number(accountId)]);
    return result.rowCount > 0;
  }
  const account = store.accounts[String(accountId)];
  if (!account?.launcherDevice) return false;
  delete account.launcherDevice;
  store.accounts[String(accountId)] = account;
  await saveStore(store);
  return true;
}

async function loginAccountFromUrl(url) {
  if (!accountCredentialsFrom(url)) {
    return null;
  }
  return accountFromRequest(url);
}

function cookieHeaders(account) {
  return [
    `ccid=${account.id}; Path=/; SameSite=None; Secure`,
    `cckey=${account.key}; Path=/; SameSite=None; Secure`
  ];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const playerStatKeys = ["k", "d", "s", "hs", "ns", "pt", "w", "l", "dhs", "dns", "do", "re", "mdo", "mre", "sh", "hi"];

function statNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function normalizePlayerStats(rawStats = {}) {
  return Object.fromEntries(playerStatKeys.map((key) => [key, statNumber(rawStats?.[key], 0)]));
}

function levelStateForExp(totalExp, currentLevel = START_LEVEL) {
  const exp = statNumber(totalExp, START_EXP);
  const calculatedLevel = Math.floor(exp / LEVEL_EXP_STEP) + 1;
  const level = Math.max(1, calculatedLevel, statNumber(currentLevel, START_LEVEL || 1));
  return {
    level,
    exp,
    expMin: (level - 1) * LEVEL_EXP_STEP,
    expMax: level * LEVEL_EXP_STEP
  };
}

async function awardPlayerExperience(client, playerId, amount) {
  const id = Number(playerId || 0);
  const expGain = statNumber(amount, 0);
  if (!Number.isInteger(id) || id <= 0 || expGain <= 0) return null;

  const row = await client.query("SELECT level, exp FROM players WHERE id = $1 FOR UPDATE", [id]);
  const player = row.rows[0];
  if (!player) return null;

  const oldLevel = statNumber(player.level, START_LEVEL || 1);
  const oldExp = statNumber(player.exp, START_EXP);
  const next = levelStateForExp(oldExp + expGain, oldLevel);
  await client.query(
    `UPDATE players
     SET level = $2, exp = $3, exp_min = $4, exp_max = $5, updated_at = now()
     WHERE id = $1`,
    [id, next.level, next.exp, next.expMin, next.expMax]
  );

  const cached = store.accounts[String(id)];
  if (cached) {
    cached.level = next.level;
    cached.exp = next.exp;
    cached.expMin = next.expMin;
    cached.expMax = next.expMax;
    cached.updatedAt = new Date().toISOString();
  }

  console.log(`[battle-exp] player=${id} add=${expGain} exp=${oldExp}->${next.exp} level=${oldLevel}->${next.level} next=${next.expMax}`);
  return {
    gained: expGain,
    expBefore: oldExp,
    exp: next.exp,
    levelBefore: oldLevel,
    level: next.level,
    expMin: next.expMin,
    expMax: next.expMax
  };
}

async function awardClanExperience(client, playerId, amount) {
  const id = Number(playerId || 0);
  const expGain = statNumber(amount, 0);
  if (!Number.isInteger(id) || id <= 0 || expGain <= 0) return null;

  const clan = playerClanRecord(id);
  const member = clan?.members?.[String(id)];
  if (!clan || !member) return null;

  member.clanExp = Number(member.clanExp || 0) + expGain;
  const account = accountById(id);
  member.playerExp = Number(account?.exp || member.playerExp || 0);
  clan.exp = Object.values(clan.members || {}).reduce((sum, item) => sum + Number(item.clanExp || 0), 0);
  clan.updatedAt = new Date().toISOString();
  refreshAllAccountClanSummaries(store);

  await client.query(
    `UPDATE clan_members
     SET clan_exp = clan_exp + $2,
         player_exp = COALESCE((SELECT exp FROM players WHERE id = $1), player_exp)
     WHERE player_id = $1`,
    [id, expGain]
  );
  await client.query(
    `UPDATE clans
     SET exp = exp + $2,
         updated_at = now()
     WHERE id = $1`,
    [Number(clan.id), expGain]
  );

  console.log(`[clan-exp] player=${id} clan=${clan.id} add=${expGain} total=${clan.exp}`);
  return {
    gained: expGain,
    clanId: Number(clan.id),
    clanExp: Number(clan.exp),
    memberExp: Number(member.clanExp)
  };
}

function profilePayload(account, full = false) {
  const publicName = account.namePending ? "" : account.name;
  const payload = {
    result: true,
    info: {
      u_id: account.id,
      un: publicName,
      fname: account.fullName,
      lvl: account.level,
      vcur: account.money,
      exp: {
        cur: account.exp,
        min: account.expMin,
        max: account.expMax
      }
    },
    conf: {
      cst: {
        cn: 30
      }
    },
    name_pending: Boolean(account.namePending)
  };

  if (full) {
    payload.view = clone(account.view);
    payload.weap = clone(account.weap);
    payload.taun = clone(account.taun);
  }

  const liveClan = clanSummaryForPlayer(account.id) || account.clan || null;
  if (liveClan) {
    const clanRecord = clanById(liveClan.cid);
    payload.cl = {
      cid: Number(liveClan.cid),
      l: Number(liveClan.l || 1),
      fid: Number(liveClan.fid || 0),
      fn: String(liveClan.fn || ""),
      a: Number(liveClan.a || 0),
      alvl: Number(liveClan.alvl || 0),
      mcnt: Number(liveClan.mcnt || 0),
      macnt: Number(liveClan.macnt || CLAN_DEFAULT_MAX_MEMBERS),
      e: Number(liveClan.e || 0),
      n: String(liveClan.n || ""),
      t: String(liveClan.t || ""),
      tc: String(liveClan.tc || ""),
      aid: Number(liveClan.aid || 0),
      h: String(liveClan.h || ""),
      d: String(liveClan.d || ""),
      vc: Number(liveClan.vc || 0),
      ek: Number(liveClan.ek || 0),
      ue: Number(account.exp || liveClan.ue || 0)
    };
    payload.clinv = activeClanInventoryItems(clanRecord);
  }

  payload.sA = statsBlock(account);
  payload.vk = "0";

  return payload;
}

function inventoryPayload(account) {
  return {
    result: true,
    st: Math.floor(Date.now() / 1000),
    data: {
      items: JSON.stringify(account.inventory || []),
      dw: clone(defaultWeapons)
    }
  };
}

function shopPayload() {
  return {
    result: true,
    weap: {
      upg: clone(shopWeaponUpgrades),
      items: clone(shopWeapons)
    },
    wear: {
      items: clone(shopWears)
    },
    taunt: {
      items: clone(shopTaunts)
    },
    enh: {
      items: clone(shopEnhancers)
    }
  };
}

function logShopItemsPayload(account, act) {
  const weapons = shopWeapons.map((item) => `${item.w_id}:${item.sn || item.sname}:ws${item.ws}`).join(",");
  console.log(`[shop-items] account=${account?.id || "unknown"} act=${act || "items"} weapons=${shopWeapons.length} ids=${weapons}`);
}

function abilitiesPayload(account) {
  return {
    result: true,
    b: clone(abilityCatalog),
    u: clone(account.abilities || [])
  };
}

function mapsPayload() {
  const gameMasterPort = process.env.GAME_MASTER_PORT || "5058";
  const socialMasterPort = process.env.SOCIAL_MASTER_PORT || "5057";
  const battlePorts = String(process.env.CLIENT_BATTLE_PORTS || process.env.BATTLE_PORTS || "5055,5056,5255")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== gameMasterPort && value !== socialMasterPort)
    .join(",") || "5055";
  const battleServers = BATTLE_HOST
    ? [
        { h: BATTLE_HOST, p: battlePorts, n: BATTLE_NAME, pL: "100", lM: "0", lMa: "100", m: "0" },
        { h: BATTLE_HOST, p: socialMasterPort, n: `${BATTLE_NAME} Master`, pL: "100", lM: "0", lMa: "100", m: "1" }
      ]
    : [];
  const gameMasters = BATTLE_HOST
    ? [
        { h: BATTLE_HOST, p: gameMasterPort, n: BATTLE_NAME, pL: "100", lM: "0", lMa: "100", m: "1", iD: "1" }
      ]
    : [];

  return {
    result: true,
    s: battleServers,
    gm: gameMasters,
    b: clone(maps)
  };
}

const ACHIEVEMENTS_TEXT_PATH = process.env.ACHIEVEMENTS_TEXT_PATH || path.join(API_DIR, "achievements.txt");
const ACHIEVEMENT_MODE_FAMILY_TO_MODE = Object.freeze({
  201: 1,
  202: 2,
  204: 4,
  208: 8,
  264: 64
});
const ACHIEVEMENT_REWARD_BY_GROUP = Object.freeze({
  100003600: [15, 25, 35, 50, 70],
  100005800: [15, 25, 35, 50, 70],
  100006200: [25, 50, 90, 140, 200],
  100006900: [10, 20, 30, 40, 50],
  100010000: [20, 35, 60, 100, 160],
  100010200: [20, 35, 60, 100, 160],
  100010300: [15, 35, 100, 200, 500],
  400000132: [15, 25, 35, 50, 70]
});
const ACHIEVEMENT_REWARD_DEFAULT = Object.freeze([10, 20, 30, 40, 50]);
const ACHIEVEMENT_REWARD_WEAPON = Object.freeze([10, 20, 35, 50, 70]);
const ACHIEVEMENT_REWARD_MODE = Object.freeze([15, 25, 40, 60, 90]);
const ACHIEVEMENT_COMPACT_ID_BASE = 1000;

function achievementTextValue(line) {
  const prefix = 'msgstr "';
  if (!String(line || "").startsWith(prefix) || !String(line || "").endsWith('"')) return "";
  return String(line).slice(prefix.length, -1).replace(/\\"/g, '"');
}

function achievementThreshold(description) {
  const values = Array.from(String(description || "").matchAll(/\d[\d ]*/g))
    .map((match) => Number(String(match[0]).replace(/\s+/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? values[values.length - 1] : 1;
}

function achievementReward(achievementId) {
  const text = String(Math.trunc(Number(achievementId) || 0)).padStart(11, "0");
  const group = text.slice(0, -2);
  const level = Math.max(1, Math.min(5, Number(text.slice(-2)) || 1));
  const parts = achievementParts(achievementId);
  const override = ACHIEVEMENT_REWARD_BY_GROUP[group];
  if (override?.[level - 1] != null) return override[level - 1];
  if (ACHIEVEMENT_MODE_FAMILY_TO_MODE[parts.family]) return ACHIEVEMENT_REWARD_MODE[level - 1];
  if ((parts.family === 100 && parts.weaponId > 0) || (parts.family >= 101 && parts.family <= 110)) {
    return ACHIEVEMENT_REWARD_WEAPON[level - 1];
  }
  return ACHIEVEMENT_REWARD_DEFAULT[level - 1];
}

function achievementParts(achievementId) {
  const text = String(Math.trunc(Number(achievementId) || 0)).padStart(11, "0");
  const group = text.slice(0, -2);
  return {
    family: Number(group.slice(0, 3)),
    weaponId: Number(group.slice(3, 7)),
    hitZone: Number(group.slice(7, 9)),
    level: Number(text.slice(-2))
  };
}

function loadAchievementCatalog() {
  let text = "";
  try {
    text = fs.readFileSync(ACHIEVEMENTS_TEXT_PATH, "utf8");
  } catch (error) {
    console.warn(`[achievements] catalog read failed path=${ACHIEVEMENTS_TEXT_PATH} error=${error.message}`);
  }

  const rows = new Map();
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length - 1; idx += 1) {
    const match = /^msgid "ach(\d+)(name|desc|img)"$/.exec(lines[idx]);
    if (!match) continue;
    const [, achievementId, field] = match;
    if (!rows.has(achievementId)) rows.set(achievementId, {});
    rows.get(achievementId)[field] = achievementTextValue(lines[idx + 1]);
  }

  const catalog = Array.from(rows.entries())
    .filter(([, item]) => item.name && item.desc && item.img)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([achievementId], index) => {
      const parts = achievementParts(achievementId);
      return {
        id: ACHIEVEMENT_COMPACT_ID_BASE + index + 1,
        i: Number(achievementId),
        v: achievementThreshold(rows.get(achievementId).desc),
        r: achievementReward(achievementId),
        ul: 1,
        parts
      };
    });
  console.log(`[achievements] catalog loaded count=${catalog.length} path=${ACHIEVEMENTS_TEXT_PATH}`);
  return catalog;
}

const achievementCatalog = loadAchievementCatalog();
const achievementBase = achievementCatalog.map(({ parts, ...achievement }) => achievement);
const achievementCatalogIds = new Set(achievementCatalog.map((achievement) => Number(achievement.id)));
const ACHIEVEMENT_POP_HISTORICAL = process.env.ACHIEVEMENT_POP_HISTORICAL === "1";

function achievementWeaponStats(account) {
  return (account.weaponStats || []).map((item) => ({
    wid: Number(item.wid ?? item.weapon_id ?? item.w_id ?? 0),
    wt: Number(item.wt ?? item.weapon_type ?? 0),
    k: statNumber(item.k ?? item.kills, 0),
    hs: statNumber(item.hs ?? item.headshots, 0),
    ns: statNumber(item.ns ?? item.nuts, 0)
  }));
}

function achievementWeaponValue(account, predicate, hitZone) {
  return achievementWeaponStats(account)
    .filter(predicate)
    .reduce((sum, item) => {
      if (hitZone === 16) return sum + item.ns;
      if (hitZone === 32) return sum + item.hs;
      return sum + item.k;
    }, 0);
}

function achievementModeWins(account, mode) {
  return (account.modeStats || [])
    .filter((item) => Number(item.m ?? item.mode ?? 0) === Number(mode))
    .reduce((sum, item) => sum + statNumber(item.w ?? item.wins, 0), 0);
}

function achievementValueFor(account, achievement) {
  const stats = playerStats(account);
  const { family, weaponId, hitZone } = achievement.parts || achievementParts(achievement.i);

  if (family === 100 && weaponId === 0) {
    if (hitZone === 16) return statNumber(stats.ns, 0);
    if (hitZone === 32) return statNumber(stats.hs, 0);
    return statNumber(stats.k, 0);
  }

  if (family >= 101 && family <= 110 && weaponId === 0) {
    const weaponType = family - 100;
    return achievementWeaponValue(account, (item) => item.wt === weaponType, hitZone);
  }

  if ((family === 100 || (family >= 101 && family <= 110)) && weaponId > 0) {
    return achievementWeaponValue(account, (item) => item.wid === weaponId, hitZone);
  }

  if (ACHIEVEMENT_MODE_FAMILY_TO_MODE[family]) {
    return achievementModeWins(account, ACHIEVEMENT_MODE_FAMILY_TO_MODE[family]);
  }

  return 0;
}

function achievementProgressFor(account) {
  return Object.fromEntries(
    achievementCatalog.map((achievement) => {
      const value = Math.max(0, Math.trunc(achievementValueFor(account, achievement)));
      return [
        String(achievement.id),
        {
          c: value >= Number(achievement.v || 0) ? 1 : 0,
          v: value
        }
      ];
    })
  );
}

function achievementsPayload(account) {
  return {
    result: true,
    b: achievementBase,
    u: {
      data: JSON.stringify(achievementProgressFor(account))
    }
  };
}

async function loadAchievementAccountFromPostgres(client, playerId) {
  const id = Number(playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const player = await client.query("SELECT id, stats FROM players WHERE id = $1", [id]);
  const row = player.rows[0];
  if (!row) return null;

  const weaponStats = await client.query(
    `SELECT weapon_id, weapon_type, kills, headshots, nuts
     FROM player_weapon_stats
     WHERE player_id = $1`,
    [id]
  );
  const modeStats = await client.query(
    `SELECT mode, SUM(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins
     FROM player_match_stats
     WHERE player_id = $1
     GROUP BY mode`,
    [id]
  );

  return {
    id,
    stats: jsonValue(row.stats, {}),
    weaponStats: weaponStats.rows.map((statRow) => ({
      wid: Number(statRow.weapon_id || 0),
      wt: Number(statRow.weapon_type || 0),
      k: Number(statRow.kills || 0),
      hs: Number(statRow.headshots || 0),
      ns: Number(statRow.nuts || 0)
    })),
    modeStats: modeStats.rows.map((statRow) => ({
      m: Number(statRow.mode || 0),
      w: Number(statRow.wins || 0)
    }))
  };
}

async function syncPostgresAchievements(client, playerId) {
  if (!achievementCatalog.length) return [];
  const account = await loadAchievementAccountFromPostgres(client, playerId);
  if (!account) return [];

  const existing = await client.query(
    "SELECT achievement_id, claimed_value FROM player_achievements WHERE player_id = $1",
    [account.id]
  );
  const hasCatalogProgress = existing.rows.some((row) => achievementCatalogIds.has(Number(row.achievement_id)));
  const baselineOnly = !ACHIEVEMENT_POP_HISTORICAL && !hasCatalogProgress;
  const completedBefore = new Set(
    existing.rows
      .filter((row) => Number(row.claimed_value || 0) > 0)
      .map((row) => Number(row.achievement_id))
  );
  const progress = achievementProgressFor(account);
  const newlyCompleted = [];
  let completedCount = 0;

  for (const achievement of achievementCatalog) {
    const itemProgress = progress[String(achievement.id)] || { c: 0, v: 0 };
    const currentValue = Math.max(0, Number(itemProgress.v || 0));
    const complete = Number(itemProgress.c || 0) > 0 ? 1 : 0;
    if (complete) completedCount += 1;

    if (!baselineOnly && complete && !completedBefore.has(Number(achievement.id))) {
      newlyCompleted.push({
        id: Number(achievement.id),
        i: Number(achievement.i),
        maxValue: Number(achievement.v || 0),
        currentValue,
        reward: Number(achievement.r || 0),
        userId: account.id
      });
    }

    await client.query(
      `INSERT INTO player_achievements (player_id, achievement_id, current_value, claimed_value, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (player_id, achievement_id) DO UPDATE SET
         current_value = EXCLUDED.current_value,
         claimed_value = GREATEST(player_achievements.claimed_value, EXCLUDED.claimed_value),
         updated_at = now()`,
      [account.id, Number(achievement.id), currentValue, complete]
    );
  }

  if (baselineOnly) {
    console.log(`[achievements] baseline player=${account.id} completed=${completedCount} catalog=${achievementCatalog.length}`);
  } else if (newlyCompleted.length) {
    console.log(`[achievements] unlock player=${account.id} count=${newlyCompleted.length} ids=${newlyCompleted.map((item) => item.i).join(",")}`);
  }
  return newlyCompleted;
}

function leagueLimits() {
  const limits = {};
  for (let i = 1; i <= 15; i += 1) {
    limits[String(i)] = [(i - 1) * 10000, i === 15 ? 0 : i * 10000];
  }
  return limits;
}

function leagueIndexForExp(exp, limits) {
  const value = Number(exp || 0);
  for (let i = 1; i <= 15; i += 1) {
    const [min, max] = limits[String(i)];
    if (value >= Number(min || 0) && (Number(max || 0) === 0 || value < Number(max || 0))) return i;
  }
  return 1;
}

async function leaguePayload(account) {
  const accounts = await allAccountsForStats();
  const sorted = sortRatingAccounts(accounts, 2);
  const currentIndex = sorted.findIndex((ratedAccount) => Number(ratedAccount.id) === Number(account.id));
  const currentAccount = currentIndex >= 0 ? sorted[currentIndex] : account;
  const me = ratingUser(currentAccount, currentIndex >= 0 ? currentIndex + 1 : 1);
  const limits = leagueLimits();
  const leagues = Object.fromEntries(Array.from({ length: 15 }, (_, idx) => [`l${idx + 1}`, []]));

  for (const ratedAccount of sorted) {
    const row = ratingUser(ratedAccount);
    const leagueIndex = leagueIndexForExp(row.exp, limits);
    if (leagues[`l${leagueIndex}`].length < 101 || Number(row.id) === Number(account.id)) {
      leagues[`l${leagueIndex}`].push(row);
    }
  }

  return {
    result: true,
    u: me,
    ls: limits,
    ...leagues
  };
}

function playerStats(account) {
  return normalizePlayerStats(account.stats || {});
}

function weaponStatItems(account) {
  const owned = [...defaultWeapons, ...(account.inventory || []).filter((item) => Number(item.itype) === 1)];
  const statByWeaponId = new Map((account.weaponStats || []).map((item) => [Number(item.wid || item.weapon_id || 0), item]));
  const seen = new Set();
  return owned
    .filter((item) => {
      const key = Number(item.w_id || item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => {
      const weaponId = Number(item.w_id || item.id);
      const stats = statByWeaponId.get(weaponId) || {};
      return {
        wid: weaponId,
        wt: Number(stats.wt ?? stats.weapon_type ?? item.wt ?? 0),
        sn: String(stats.sn || stats.system_name || item.sn || item.sname || `weapon_${weaponId}`),
        k: statNumber(stats.k ?? stats.kills, 0),
        hs: statNumber(stats.hs ?? stats.headshots, 0),
        ns: statNumber(stats.ns ?? stats.nuts, 0),
        sh: statNumber(stats.sh ?? stats.shots, 0),
        hi: statNumber(stats.hi ?? stats.hits, 0)
      };
    });
}

function gameModeStatItems(account) {
  const statByMode = new Map();
  for (const item of account.modeStats || []) {
    const mode = normalizeStatsMode(item.m || item.mode || 0);
    if (!mode) continue;
    const current = statByMode.get(mode) || { w: 0, l: 0, pt: 0 };
    current.w += statNumber(item.w ?? item.wins, 0);
    current.l += statNumber(item.l ?? item.losses, 0);
    current.pt += statNumber(item.pt ?? item.play_time, 0);
    statByMode.set(mode, current);
  }
  return DOSSIER_GAME_MODE_STATS.map((mode) => {
    const stats = statByMode.get(mode) || {};
    return {
      m: mode,
      w: statNumber(stats.w ?? stats.wins, 0),
      l: statNumber(stats.l ?? stats.losses, 0),
      pt: statNumber(stats.pt ?? stats.play_time, 0)
    };
  });
}

function mapStatItems(account) {
  const statByMap = new Map((account.mapStats || []).map((item) => [String(item.n || item.map_name || ""), item]));
  return maps.map((map) => {
    const stats = statByMap.get(map.n) || {};
    return {
      n: map.n,
      w: statNumber(stats.w ?? stats.wins, 0),
      l: statNumber(stats.l ?? stats.losses, 0),
      pt: statNumber(stats.pt ?? stats.play_time, 0)
    };
  });
}

function statsBlock(account) {
  return {
    wd: JSON.stringify(weaponStatItems(account)),
    ud: JSON.stringify(playerStats(account)),
    md: JSON.stringify(gameModeStatItems(account)),
    mad: JSON.stringify(mapStatItems(account))
  };
}

function usesProfileObjectLoadout(account, url) {
  const targetId = Number(url.searchParams.get("ui") || 0);
  return Number.isInteger(targetId) && targetId > 0 && targetId !== Number(account.id);
}

function advancedStatsPayload(account, options = {}) {
  const objectLoadout = Boolean(options.objectLoadout);
  const payload = {
    ...profilePayload(account, true),
    sA: statsBlock(account),
    vk: "0"
  };
  if (objectLoadout) {
    payload.view = profileViewObjectPayload(account);
    payload.weap = profileWeaponObjectPayload(account);
  }
  console.log(
    `[profile-payload] user=${account.id} loadout=${objectLoadout ? "objects" : "ids"} view=${viewSelectionSummary(account.view)} weap=${weaponSelectionSummary(account.weap)}`
  );
  return payload;
}

function ratingUser(account, pos = 1, overrides = {}) {
  const stats = playerStats(account);
  const death = Number(overrides.death ?? stats.d);
  const kill = Number(overrides.kill ?? stats.k);
  const liveClan = clanSummaryForPlayer(account.id) || account.clan || null;
  return {
    pos,
    id: Number(overrides.id ?? account.id),
    uid: Number(overrides.id ?? account.id),
    name: String(overrides.name ?? account.name),
    un: String(overrides.name ?? account.name),
    n: String(overrides.name ?? account.name),
    lvl: Number(overrides.lvl ?? account.level),
    l: Number(overrides.lvl ?? account.level),
    exp: Number(overrides.exp ?? account.exp),
    e: Number(overrides.exp ?? account.exp),
    kill,
    k: kill,
    death,
    d: death,
    kd: death > 0 ? Math.round((kill / death) * 1000) : kill * 1000,
    h: Number(overrides.h ?? stats.hs),
    f: Number(overrides.f ?? 0),
    p: Number(overrides.p ?? 0),
    do: Number(overrides.do ?? stats.do),
    nu: Number(overrides.nu ?? stats.ns),
    a: Number(overrides.a ?? 0),
    ach: Number(overrides.ach ?? 0),
    ptime: Number(overrides.ptime ?? stats.pt),
    cid: Number(overrides.cid ?? liveClan?.cid ?? 0),
    clid: Number(overrides.cid ?? liveClan?.cid ?? 0),
    clan_id: Number(overrides.cid ?? liveClan?.cid ?? 0),
    aid: Number(overrides.aid ?? liveClan?.aid ?? 0),
    caid: Number(overrides.aid ?? liveClan?.aid ?? 0),
    arm_id: Number(overrides.aid ?? liveClan?.aid ?? 0),
    ctag: String(overrides.ct ?? liveClan?.t ?? ""),
    clan_name: String(overrides.ct ?? liveClan?.t ?? "")
  };
}

async function allAccountsForStats() {
  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const loaded = await loadPostgresStore();
      store.accounts = { ...(store.accounts || {}), ...(loaded.accounts || {}) };
    } catch (error) {
      console.error("[postgres] stats account load failed", error);
    }
  }
  const byId = new Map();
  for (const raw of Object.values(store.accounts || {})) {
    const account = normalizeAccount(raw);
    const id = Number(account.id || 0);
    if (!Number.isInteger(id) || id <= 0) continue;
    const existing = byId.get(id);
    if (!existing || statNumber(account.exp, 0) >= statNumber(existing.exp, 0)) {
      byId.set(id, account);
    }
  }
  return Array.from(byId.values());
}

function ratingSortValue(account, type) {
  const stats = playerStats(account);
  const kills = statNumber(stats.k, 0);
  const deaths = statNumber(stats.d, 0);
  switch (Number(type || 0)) {
    case 1: return statNumber(account.level, 0);
    case 2: return statNumber(account.exp, 0);
    case 3: return kills;
    case 4: return deaths;
    case 5: return deaths > 0 ? kills / deaths : kills;
    case 6: return 0;
    case 7: return statNumber(stats.pt, 0);
    default: return statNumber(account.exp, 0);
  }
}

function sortRatingAccounts(accounts, type) {
  return [...accounts].sort((left, right) => {
    const scoreDiff = ratingSortValue(right, type) - ratingSortValue(left, type);
    if (scoreDiff !== 0) return scoreDiff;
    const expDiff = statNumber(right.exp, 0) - statNumber(left.exp, 0);
    if (expDiff !== 0) return expDiff;
    const killDiff = statNumber(playerStats(right).k, 0) - statNumber(playerStats(left).k, 0);
    if (killDiff !== 0) return killDiff;
    return Number(left.id) - Number(right.id);
  });
}

async function ratingPayload(account, url) {
  const type = Number(url.searchParams.get("t") || 2);
  const page = Math.max(0, Number(url.searchParams.get("p") || 0));
  const pageSize = 100;
  const accounts = await allAccountsForStats();
  const sorted = sortRatingAccounts(accounts, type);
  const start = page * pageSize;
  const users = sorted.slice(start, start + pageSize).map((ratedAccount, index) => ratingUser(ratedAccount, start + index + 1));
  const currentIndex = sorted.findIndex((ratedAccount) => Number(ratedAccount.id) === Number(account.id));
  const currentAccount = currentIndex >= 0 ? sorted[currentIndex] : account;

  return {
    result: true,
    users,
    musers: String(sorted.length),
    uinfo: ratingUser(currentAccount, currentIndex >= 0 ? currentIndex + 1 : 1)
  };
}

async function yesterdayBestPayload(account) {
  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const result = await pgPool.query(`
        SELECT
          p.id,
          p.name,
          p.level,
          COALESCE(SUM(CASE WHEN b.killer_player_id = p.id THEN COALESCE(NULLIF(b.event_data->>'expAwarded', '')::int, 0) ELSE 0 END), 0)::int AS exp_today,
          COUNT(b.id) FILTER (WHERE b.killer_player_id = p.id AND b.victim_player_id IS DISTINCT FROM p.id)::int AS kills,
          COUNT(b.id) FILTER (WHERE b.killer_player_id = p.id AND b.hit_zone = 32)::int AS heads,
          COUNT(b.id) FILTER (WHERE b.killer_player_id = p.id AND b.hit_zone = 16)::int AS nuts,
          COALESCE(SUM(CASE WHEN b.killer_player_id = p.id THEN COALESCE(NULLIF(b.event_data->>'domination', '')::int, 0) ELSE 0 END), 0)::int AS domination
        FROM players p
        LEFT JOIN battle_score_events b
          ON (b.killer_player_id = p.id OR b.victim_player_id = p.id)
         AND b.created_at >= now() - interval '1 day'
        GROUP BY p.id, p.name, p.level
        ORDER BY kills DESC, exp_today DESC, p.level DESC, p.id
        LIMIT 100
      `);
      return {
        result: true,
        yb: result.rows.map((row) => {
          const clan = clanSummaryForPlayer(row.id) || {};
          return {
            id: Number(row.id),
            name: String(row.name || ""),
            n: String(row.name || ""),
            un: String(row.name || ""),
            lvl: Number(row.level || 1),
            l: Number(row.level || 1),
            exp: Number(row.exp_today || 0),
            e: Number(row.exp_today || 0),
            kill: Number(row.kills || 0),
            k: Number(row.kills || 0),
            h: Number(row.heads || 0),
            f: 0,
            p: 0,
            do: Number(row.domination || 0),
            nu: Number(row.nuts || 0),
            a: 0,
            clan_id: Number(clan.cid || 0),
            ctag: String(clan.t || ""),
            caid: Number(clan.aid || 0)
          };
        })
      };
    } catch (error) {
      console.error("[postgres] ybest load failed", error);
    }
  }

  const yb = (await allAccountsForStats()).map((ratedAccount) => {
    const stats = playerStats(ratedAccount);
    return ratingUser(ratedAccount, 1, {
      exp: ratedAccount.exp,
      kill: stats.k,
      h: stats.hs,
      do: stats.do,
      nu: stats.ns
    });
  });
  if (!yb.some((row) => Number(row.id) === Number(account.id))) yb.push(ratingUser(account));
  return { result: true, yb };
}

function ok(extra = {}) {
  return {
    result: true,
    ...extra
  };
}

function findShopItem(collection, idField, id) {
  return collection.find((item) => Number(item[idField] ?? item.id ?? item.w_id) === Number(id));
}

function itemPrice(item) {
  return Number(item?.sc?.tPv || 0);
}

function isWeaponItem(item) {
  return Number(item?.itype || 0) === 1;
}

function isValidShopPrice(price) {
  return Number.isFinite(price) && price > 0;
}

const SHOP_DURATION = Object.freeze({
  DAY: 1,
  WEEK: 2,
  MONTH: 3,
  PERMANENT: 4
});
const SHOP_DAY_SECONDS = 86460;

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeClanSummary(clan) {
  if (!clan) return null;
  const id = Number(clan.cid ?? clan.id ?? clan.clanId ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    cid: id,
    id,
    l: Number(clan.l ?? clan.level ?? 1),
    fid: Number(clan.fid ?? clan.ownerPlayerId ?? clan.owner_player_id ?? 0),
    fn: String(clan.fn ?? clan.founderName ?? ""),
    a: Number(clan.a ?? clan.access ?? 1),
    alvl: Number(clan.alvl ?? clan.accessLevel ?? 15),
    mcnt: Number(clan.mcnt ?? clan.memberCount ?? 0),
    macnt: Number(clan.macnt ?? clan.maxMembers ?? CLAN_DEFAULT_MAX_MEMBERS),
    e: Number(clan.e ?? clan.exp ?? 0),
    n: String(clan.n ?? clan.name ?? ""),
    t: String(clan.t ?? clan.tag ?? ""),
    tc: String(clan.tc ?? clan.tagColor ?? ""),
    aid: Number(clan.aid ?? clan.armId ?? 1),
    h: String(clan.h ?? clan.homepage ?? ""),
    d: String(clan.d ?? clan.desc ?? ""),
    vc: Number(clan.vc ?? clan.money ?? 0),
    ek: Number(clan.ek ?? clan.expKoef ?? 0),
    ue: Number(clan.ue ?? clan.userExp ?? 0)
  };
}

function normalizeStore(rawStore = {}) {
  const next = {
    ...rawStore,
    accounts: rawStore.accounts || {},
    clans: rawStore.clans || {},
    playerFriends: Array.isArray(rawStore.playerFriends) ? rawStore.playerFriends : []
  };
  const clans = next.clans;
  clans.byId = clans.byId || {};
  clans.nextId = Number(clans.nextId || 1);
  clans.nextEventId = Number(clans.nextEventId || 1);
  clans.nextTreasuryEventId = Number(clans.nextTreasuryEventId || 1);
  for (const [id, clan] of Object.entries(clans.byId)) {
    clans.byId[id] = normalizeClanRecord(clan);
    clans.nextId = Math.max(clans.nextId, Number(id) + 1);
  }
  refreshAllAccountClanSummaries(next);
  return next;
}

function ensureClanStore() {
  store = normalizeStore(store || { accounts: {} });
  return store.clans;
}

function normalizeClanRecord(raw = {}) {
  const id = Number(raw.id ?? raw.cid ?? 0);
  const members = {};
  for (const [playerId, member] of Object.entries(raw.members || {})) {
    members[String(playerId)] = normalizeClanMemberRecord(member, Number(playerId));
  }
  const invites = {};
  for (const [playerId, invite] of Object.entries(raw.invites || {})) {
    invites[String(playerId)] = {
      playerId: Number(invite.playerId ?? playerId),
      createdAt: invite.createdAt || new Date().toISOString()
    };
  }
  const rawTreasuryEvents = Array.isArray(raw.treasuryEvents)
    ? raw.treasuryEvents
    : (Array.isArray(raw.etreas) ? raw.etreas : []);
  const normalized = {
    id,
    name: String(raw.name ?? raw.n ?? ""),
    tag: String(raw.tag ?? raw.t ?? ""),
    ownerPlayerId: Number(raw.ownerPlayerId ?? raw.fid ?? 0),
    level: Number(raw.level ?? raw.l ?? 1),
    exp: Number(raw.exp ?? raw.e ?? 0),
    money: Number(raw.money ?? raw.vc ?? 0),
    armId: Number(raw.armId ?? raw.aid ?? 1),
    tagColor: String(raw.tagColor ?? raw.tc ?? ""),
    homepage: String(raw.homepage ?? raw.h ?? ""),
    desc: String(raw.desc ?? raw.description ?? raw.d ?? ""),
    access: Number(raw.access ?? raw.a ?? 1),
    accessLevel: Number(raw.accessLevel ?? raw.alvl ?? CLAN_JOIN_LEVEL),
    maxMembers: Math.min(CLAN_MAX_MEMBERS, Math.max(CLAN_DEFAULT_MAX_MEMBERS, Number(raw.maxMembers ?? raw.macnt ?? CLAN_DEFAULT_MAX_MEMBERS))),
    deletedAt: raw.deletedAt || null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    members,
    invites,
    events: Array.isArray(raw.events) ? raw.events.map(normalizeClanEventRecord).filter(Boolean) : [],
    treasuryEvents: rawTreasuryEvents.map(normalizeClanTreasuryRecord).filter(Boolean),
    inventory: Array.isArray(raw.inventory) ? raw.inventory : []
  };
  ensureClanOwnedArm(normalized, normalized.armId, "current");
  return normalized;
}

function normalizeClanMemberRecord(raw = {}, fallbackPlayerId = 0) {
  return {
    playerId: Number(raw.playerId ?? raw.uid ?? fallbackPlayerId),
    memberLevel: Number(raw.memberLevel ?? raw.mlvl ?? 1),
    money: Number(raw.money ?? raw.m ?? 0),
    clanExp: Number(raw.clanExp ?? raw.e ?? 0),
    expKoef: Number(raw.expKoef ?? raw.ek ?? 0),
    playerExp: Number(raw.playerExp ?? raw.ue ?? 0),
    joinedAt: raw.joinedAt || raw.date || new Date().toISOString()
  };
}

function normalizeClanEventRecord(raw = {}) {
  const id = Number(raw.id ?? raw.i ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    clanId: Number(raw.clanId ?? raw.cid ?? 0),
    type: Number(raw.type ?? raw.et ?? 0),
    creatorPlayerId: Number(raw.creatorPlayerId ?? raw.creatid ?? 0),
    data: raw.data && typeof raw.data === "object" ? raw.data : {},
    expiresAt: raw.expiresAt || new Date(Date.now() + 1000).toISOString(),
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

function normalizeClanTreasuryRecord(raw = {}) {
  const id = Number(raw.id ?? raw.i ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    clanId: Number(raw.clanId ?? raw.cid ?? 0),
    playerId: Number(raw.playerId ?? raw.uid ?? 0),
    playerName: String(raw.playerName ?? raw.un ?? ""),
    money: Number(raw.money ?? raw.vcur ?? 0),
    type: Number(raw.type ?? raw.t ?? 0),
    createdAt: raw.createdAt || raw.d || new Date().toISOString()
  };
}

function accountById(playerId, targetStore = store) {
  const account = targetStore.accounts?.[String(Number(playerId))];
  return account ? normalizeAccount(account) : null;
}

async function searchPlayersByName(account, rawQuery) {
  const query = String(rawQuery || "").trim();
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return ok({ names: [] });

  const accounts = await allAccountsForStats();
  const rows = accounts
    .filter((candidate) => {
      const id = Number(candidate.id || 0);
      if (!Number.isInteger(id) || id <= 0 || id === Number(account.id)) return false;
      return String(candidate.name || "").trim().toLowerCase() === normalizedQuery;
    })
    .slice(0, 1)
    .map((candidate) => ({ i: String(Number(candidate.id)), n: String(candidate.name || `Player ${candidate.id}`) }));

  console.log(`[social-search] user=${account.id} query=${query} exact=1 results=${rows.length}`);
  return ok({ names: rows });
}

function socialPlayerPayload(account) {
  const normalized = normalizeAccount(account);
  return {
    userId: Number(normalized.id),
    name: String(normalized.name || `Player ${normalized.id}`),
    level: Number(normalized.level || 1),
    exp: Number(normalized.exp || 0)
  };
}

function normalizeFriendRow(row = {}) {
  const playerId = Number(row.playerId ?? row.player_id ?? row.p ?? 0);
  const friendPlayerId = Number(row.friendPlayerId ?? row.friend_player_id ?? row.f ?? 0);
  if (!Number.isInteger(playerId) || playerId <= 0 || !Number.isInteger(friendPlayerId) || friendPlayerId <= 0) {
    return null;
  }
  return {
    playerId,
    friendPlayerId,
    status: String(row.status || "accepted"),
    createdAt: row.createdAt || row.created_at || new Date().toISOString()
  };
}

function friendStateForRow(row, userId) {
  if (row.status === "accepted") return 1;
  if (row.status === "pending" && Number(row.playerId) === Number(userId)) return 2;
  if (row.status === "pending" && Number(row.friendPlayerId) === Number(userId)) return 3;
  return 0;
}

function jsonFriendRowsForUser(userId) {
  return (store.playerFriends || [])
    .map(normalizeFriendRow)
    .filter(Boolean)
    .filter((row) => Number(row.playerId) === Number(userId) || Number(row.friendPlayerId) === Number(userId));
}

function socialListFromRows(userId, rows, accountsById) {
  const byFriend = new Map();
  for (const row of rows) {
    const friendId = Number(row.playerId) === Number(userId) ? Number(row.friendPlayerId) : Number(row.playerId);
    if (!Number.isInteger(friendId) || friendId <= 0 || friendId === Number(userId)) continue;

    const state = friendStateForRow(row, userId);
    if (!state) continue;
    const previous = byFriend.get(friendId);
    if (previous && previous.state === 1) continue;
    if (previous && state !== 1 && previous.createdAt <= row.createdAt) continue;

    const account = accountsById.get(friendId) || accountById(friendId);
    if (!account) continue;
    byFriend.set(friendId, {
      ...socialPlayerPayload(account),
      state,
      relationStatus: row.status
    });
  }
  return Array.from(byFriend.values()).sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

async function battleSocialList(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid_user", status: 400 };

  if (pgPool) {
    await pgSaveChain.catch(() => {});
    const friendRows = await pgPool.query(
      `SELECT player_id, friend_player_id, status, created_at
       FROM player_friends
       WHERE player_id = $1 OR friend_player_id = $1
       ORDER BY created_at`,
      [id]
    );
    const ids = Array.from(new Set(friendRows.rows.flatMap((row) => [Number(row.player_id), Number(row.friend_player_id)]).filter((value) => value && value !== id)));
    const accountsById = new Map();
    if (ids.length > 0) {
      const players = await pgPool.query("SELECT id, name, level, exp FROM players WHERE id = ANY($1::int[])", [ids]);
      for (const row of players.rows) {
        accountsById.set(Number(row.id), normalizeAccount({
          id: Number(row.id),
          name: row.name,
          level: Number(row.level || 1),
          exp: Number(row.exp || 0)
        }));
      }
    }
    return { ok: true, friends: socialListFromRows(id, friendRows.rows.map(normalizeFriendRow).filter(Boolean), accountsById) };
  }

  const accountsById = new Map();
  for (const account of Object.values(store.accounts || {})) {
    const normalized = normalizeAccount(account);
    accountsById.set(Number(normalized.id), normalized);
  }
  return { ok: true, friends: socialListFromRows(id, jsonFriendRowsForUser(id), accountsById) };
}

function upsertJsonFriendRow(playerId, friendPlayerId, status) {
  const rows = (store.playerFriends || []).map(normalizeFriendRow).filter(Boolean);
  const existing = rows.find((row) => Number(row.playerId) === Number(playerId) && Number(row.friendPlayerId) === Number(friendPlayerId));
  if (existing) {
    existing.status = status;
  } else {
    rows.push({ playerId: Number(playerId), friendPlayerId: Number(friendPlayerId), status, createdAt: new Date().toISOString() });
  }
  store.playerFriends = rows;
}

function deleteJsonFriendRows(userId, targetId) {
  store.playerFriends = (store.playerFriends || [])
    .map(normalizeFriendRow)
    .filter(Boolean)
    .filter((row) => !(
      (Number(row.playerId) === Number(userId) && Number(row.friendPlayerId) === Number(targetId)) ||
      (Number(row.playerId) === Number(targetId) && Number(row.friendPlayerId) === Number(userId))
    ));
}

async function mutateBattleSocial(action, userId, targetId) {
  const id = Number(userId);
  const target = Number(targetId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(target) || target <= 0 || id === target) {
    return { ok: false, error: "invalid_target", status: 400 };
  }

  if (pgPool) {
    return enqueuePostgresMutation(async () => {
      const client = await pgPool.connect();
      try {
        await client.query("BEGIN");
        const targetExists = await client.query("SELECT id FROM players WHERE id = $1", [target]);
        if (!targetExists.rows[0]) {
          await client.query("ROLLBACK");
          return { ok: false, error: "target_not_found", status: 404 };
        }

        if (action === "request") {
          const existing = await client.query(
            `SELECT player_id, friend_player_id, status
             FROM player_friends
             WHERE (player_id = $1 AND friend_player_id = $2) OR (player_id = $2 AND friend_player_id = $1)
             FOR UPDATE`,
            [id, target]
          );
          if (existing.rows.some((row) => row.status === "accepted")) {
            // Already friends; original client treats this as a no-op after refresh.
          } else if (existing.rows.some((row) => Number(row.player_id) === target && Number(row.friend_player_id) === id && row.status === "pending")) {
            await client.query("DELETE FROM player_friends WHERE (player_id = $1 AND friend_player_id = $2) OR (player_id = $2 AND friend_player_id = $1)", [id, target]);
            await client.query(
              `INSERT INTO player_friends (player_id, friend_player_id, status)
               VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
               ON CONFLICT (player_id, friend_player_id) DO UPDATE SET status = 'accepted'`,
              [id, target]
            );
          } else {
            await client.query(
              `INSERT INTO player_friends (player_id, friend_player_id, status)
               VALUES ($1, $2, 'pending')
               ON CONFLICT (player_id, friend_player_id) DO UPDATE SET status = EXCLUDED.status`,
              [id, target]
            );
          }
        } else if (action === "confirm") {
          await client.query("DELETE FROM player_friends WHERE (player_id = $1 AND friend_player_id = $2) OR (player_id = $2 AND friend_player_id = $1)", [id, target]);
          await client.query(
            `INSERT INTO player_friends (player_id, friend_player_id, status)
             VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
             ON CONFLICT (player_id, friend_player_id) DO UPDATE SET status = 'accepted'`,
            [id, target]
          );
        } else if (action === "decline" || action === "remove") {
          await client.query("DELETE FROM player_friends WHERE (player_id = $1 AND friend_player_id = $2) OR (player_id = $2 AND friend_player_id = $1)", [id, target]);
        }

        await client.query("COMMIT");
        return { ok: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }

  if (action === "request") {
    const existing = (store.playerFriends || []).map(normalizeFriendRow).filter(Boolean)
      .filter((row) => (
        (Number(row.playerId) === id && Number(row.friendPlayerId) === target) ||
        (Number(row.playerId) === target && Number(row.friendPlayerId) === id)
      ));
    if (existing.some((row) => row.status === "accepted")) {
      // Already friends; original client treats this as a no-op after refresh.
    } else if (existing.some((row) => Number(row.playerId) === target && Number(row.friendPlayerId) === id && row.status === "pending")) {
      deleteJsonFriendRows(id, target);
      upsertJsonFriendRow(id, target, "accepted");
      upsertJsonFriendRow(target, id, "accepted");
    } else {
      upsertJsonFriendRow(id, target, "pending");
    }
  } else if (action === "confirm") {
    deleteJsonFriendRows(id, target);
    upsertJsonFriendRow(id, target, "accepted");
    upsertJsonFriendRow(target, id, "accepted");
  } else if (action === "decline" || action === "remove") {
    deleteJsonFriendRows(id, target);
  }
  saveStore(store);
  return { ok: true };
}

async function battleSocialRequest(body) {
  const action = String(body.action || "list");
  const userId = Number(body.userId || body.playerId || 0);
  if (action === "list") return battleSocialList(userId);
  if (["request", "confirm", "decline", "remove"].includes(action)) {
    const result = await mutateBattleSocial(action, userId, Number(body.targetId || body.friendId || 0));
    if (result.ok === false) return result;
    const list = await battleSocialList(userId);
    console.log(`[social] ${action} user=${userId} target=${Number(body.targetId || body.friendId || 0)} friends=${list.friends?.length || 0}`);
    return list;
  }
  return { ok: false, error: "unknown_action", status: 400 };
}

function clanMemberAccountPayload(member, targetStore = store) {
  const account = accountById(member.playerId, targetStore);
  return {
    uid: Number(member.playerId),
    ul: Number(account?.level || 1),
    n: String(account?.name || `Player ${member.playerId}`),
    mlvl: Number(member.memberLevel || 1),
    m: Number(member.money || 0),
    e: Number(member.clanExp || 0),
    ek: Number(member.expKoef || 0),
    ue: Number(account?.exp ?? member.playerExp ?? 0),
    date: formatClanDate(member.joinedAt)
  };
}

function clanInvitePayload(invite, targetStore = store) {
  const account = accountById(invite.playerId, targetStore);
  return {
    uid: Number(invite.playerId),
    ul: Number(account?.level || 1),
    n: String(account?.name || `Player ${invite.playerId}`),
    mlvl: 0,
    m: 0,
    e: 0,
    ek: 0,
    ue: Number(account?.exp || 0),
    date: formatClanDate(invite.createdAt)
  };
}

function formatClanDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || "");
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clanFounderName(clan, targetStore = store) {
  return accountById(clan.ownerPlayerId, targetStore)?.name || "";
}

function clanMemberList(clan, targetStore = store) {
  return Object.values(clan.members || {})
    .map((member) => clanMemberAccountPayload(member, targetStore))
    .sort((left, right) => Number(right.e || 0) - Number(left.e || 0));
}

function clanInviteList(clan, targetStore = store) {
  return Object.values(clan.invites || {}).map((invite) => clanInvitePayload(invite, targetStore));
}

function clanEventPayload(event) {
  return {
    i: Number(event.id),
    cid: Number(event.clanId),
    et: Number(event.type),
    creatid: Number(event.creatorPlayerId || 0),
    exDa: Math.max(currentUnixSeconds(), Math.floor(new Date(event.expiresAt).getTime() / 1000)),
    d: JSON.stringify(event.data || {})
  };
}

function clanTreasuryPayload(event) {
  return {
    i: Number(event.id),
    cid: Number(event.clanId),
    uid: Number(event.playerId || 0),
    vcur: Number(event.money || 0),
    un: String(event.playerName || ""),
    t: Number(event.type || 0),
    d: event.createdAt || new Date().toISOString()
  };
}

function isActiveTimedItem(item = {}, now = currentUnixSeconds()) {
  const expiresAt = Number(item.eD ?? item.ed ?? item.expiresAt ?? 0);
  return expiresAt <= 0 || expiresAt > now;
}

function activeClanInventoryItems(clan, now = currentUnixSeconds()) {
  return (clan?.inventory || [])
    .filter((item) => Number(item?.itype ?? item?.it ?? 0) === 2)
    .filter((item) => Number(item?.iC || 0) === 1)
    .filter((item) => isActiveTimedItem(item, now))
    .map((item) => clone(item));
}

function clanPayload(clan, options = {}) {
  const full = Boolean(options.full);
  const targetStore = options.store || store;
  const payload = {
    cid: Number(clan.id),
    l: Number(clan.level || 1),
    fid: Number(clan.ownerPlayerId || 0),
    fn: clanFounderName(clan, targetStore),
    a: Number(clan.access || 0),
    alvl: Number(clan.accessLevel || 0),
    mcnt: Object.keys(clan.members || {}).length,
    macnt: Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS),
    e: Number(clan.exp || 0),
    n: String(clan.name || ""),
    t: String(clan.tag || ""),
    tc: String(clan.tagColor || ""),
    aid: Number(clan.armId || 0),
    vc: Number(clan.money || 0)
  };
  if (full) {
    payload.h = String(clan.homepage || "");
    payload.d = String(clan.desc || "");
    payload.mlist = clanMemberList(clan, targetStore);
    payload.inv = clanInviteList(clan, targetStore);
    payload.ev = (clan.events || []).map(clanEventPayload);
    payload.etreas = (clan.treasuryEvents || []).map(clanTreasuryPayload);
    payload.inventory = { items: activeClanInventoryItems(clan) };
  }
  return payload;
}

function clanSummaryForPlayer(playerId, targetStore = store) {
  const clans = targetStore?.clans?.byId || {};
  const id = String(Number(playerId));
  for (const clan of Object.values(clans)) {
    if (clan.deletedAt) continue;
    const member = clan.members?.[id];
    if (!member) continue;
    return normalizeClanSummary({
      ...clanPayload(clan, { store: targetStore }),
      h: clan.homepage || "",
      d: clan.desc || "",
      ek: member.expKoef || 0,
      ue: accountById(playerId, targetStore)?.exp || member.playerExp || 0
    });
  }
  return null;
}

function refreshAllAccountClanSummaries(targetStore = store) {
  for (const account of Object.values(targetStore.accounts || {})) {
    account.clan = clanSummaryForPlayer(account.id, targetStore);
  }
}

function clanCostsPayload() {
  return {
    cc: CLAN_COSTS.create,
    cr: CLAN_COSTS.requests,
    ccn: CLAN_COSTS.changeName,
    cct: CLAN_COSTS.changeTag,
    cecm: CLAN_COSTS.expandMembers
  };
}

function normalizeClanArmId(value) {
  const id = Number(value);
  return CLAN_ARM_ID_SET.has(id) ? id : 0;
}

function isDefaultClanArmId(value) {
  return CLAN_DEFAULT_ARM_ID_SET.has(Number(value));
}

function clanArmAssetPath(id) {
  const armId = normalizeClanArmId(id);
  return armId ? path.join(CLAN_ARM_ASSET_DIR, `${armId}.png`) : "";
}

function clanArmAssetVersion(id) {
  const filePath = clanArmAssetPath(id);
  if (!filePath) return 0;
  try {
    return Math.trunc(fs.statSync(filePath).mtimeMs);
  } catch {
    return 0;
  }
}

function clanArmImageUrl(id, requestOrigin = null) {
  const armId = normalizeClanArmId(id) || 1;
  return `${publicBaseUrl(requestOrigin)}/clan-arm/${armId}.png?v=${clanArmAssetVersion(armId)}`;
}

function clanArmCost(id) {
  return normalizeClanArmId(id) ? CLAN_COSTS.changeArm : CLAN_COSTS.expandMember;
}

function clanArmInventoryKey(id) {
  return `clan-arm:${normalizeClanArmId(id) || 0}`;
}

function clanOwnsArm(clan, id) {
  const armId = normalizeClanArmId(id);
  if (!clan || !armId) return false;
  if (Number(clan.armId || 0) === armId) return true;
  const key = clanArmInventoryKey(armId);
  return (clan.inventory || []).some((item) => {
    if (String(item?.itemKey || "") === key) return true;
    if (Number(item?.itype ?? item?.it ?? 0) !== CLAN_ARM_ITEM_TYPE) return false;
    return Number(item?.aid ?? item?.armId ?? item?.id ?? 0) === armId;
  });
}

function ensureClanOwnedArm(clan, id, source = "unknown") {
  const armId = normalizeClanArmId(id);
  if (!clan || !armId) return false;
  clan.inventory = Array.isArray(clan.inventory) ? clan.inventory : [];
  const key = clanArmInventoryKey(armId);
  if (clan.inventory.some((item) => {
    if (String(item?.itemKey || "") === key) return true;
    if (Number(item?.itype ?? item?.it ?? 0) !== CLAN_ARM_ITEM_TYPE) return false;
    return Number(item?.aid ?? item?.armId ?? item?.id ?? 0) === armId;
  })) return false;
  clan.inventory.push({
    itemKey: key,
    it: CLAN_ARM_ITEM_TYPE,
    itype: CLAN_ARM_ITEM_TYPE,
    aid: armId,
    armId,
    iC: 1,
    eD: 0,
    source,
    createdAt: new Date().toISOString()
  });
  return true;
}

function clanArmCostForClan(clan, id) {
  const armId = normalizeClanArmId(id);
  if (!armId) return clanArmCost(id);
  return clanOwnsArm(clan, armId) ? 0 : clanArmCost(armId);
}

function clanArmsPayload(requestOrigin = null, clan = null) {
  return CLAN_ARM_IDS.map((id) => {
    const arm = {
      aid: id,
      i: clanArmImageUrl(id, requestOrigin),
      d: isDefaultClanArmId(id) ? 1 : 0
    };
    if (!clanOwnsArm(clan, id)) {
      arm.sc = cost(7000 + id, clanArmCost(id));
    }
    return arm;
  });
}

function activeClanRecords() {
  ensureClanStore();
  return Object.values(store.clans.byId || {}).filter((clan) => !clan.deletedAt);
}

function clanById(clanId, { includeDeleted = false } = {}) {
  ensureClanStore();
  const clan = store.clans.byId[String(Number(clanId))];
  if (!clan || (!includeDeleted && clan.deletedAt)) return null;
  return clan;
}

function playerClanRecord(playerId) {
  const id = String(Number(playerId));
  return activeClanRecords().find((clan) => clan.members?.[id]) || null;
}

function playerInviteClanIds(playerId) {
  const id = String(Number(playerId));
  return activeClanRecords()
    .filter((clan) => clan.invites?.[id])
    .map((clan) => Number(clan.id));
}

function nextClanIdValue() {
  const clans = ensureClanStore();
  const id = Math.max(1, Number(clans.nextId || 1));
  clans.nextId = id + 1;
  return id;
}

function nextClanEventIdValue() {
  const clans = ensureClanStore();
  const id = Math.max(1, Number(clans.nextEventId || 1));
  clans.nextEventId = id + 1;
  return id;
}

function nextClanTreasuryEventIdValue() {
  const clans = ensureClanStore();
  const id = Math.max(1, Number(clans.nextTreasuryEventId || 1));
  clans.nextTreasuryEventId = id + 1;
  return id;
}

function clanError(code) {
  return { result: false, code: Number(code) };
}

function clanFormValue(url, ...names) {
  for (const name of names) {
    if (url.searchParams.has(name)) return String(url.searchParams.get(name) || "");
  }
  return "";
}

function cleanClanName(value) {
  return String(value || "").trim().slice(0, 64);
}

function cleanClanTag(value) {
  return String(value || "").trim().slice(0, 6);
}

function cleanClanUrl(value) {
  return String(value || "").trim().slice(0, 256);
}

function cleanClanDesc(value) {
  return String(value || "").trim().slice(0, 1024);
}

function validateClanName(name, currentClanId = 0) {
  if (!name) return CLAN_ERROR.CLAN_NAME;
  if (name.length < 3 || name.length > 16) return CLAN_ERROR.CLAN_NAME_LEN;
  const lower = name.toLowerCase();
  if (activeClanRecords().some((clan) => Number(clan.id) !== Number(currentClanId) && String(clan.name || "").toLowerCase() === lower)) {
    return CLAN_ERROR.CLAN_NAME_EXIST;
  }
  return 0;
}

function validateClanTag(tag, currentClanId = 0) {
  if (!tag) return CLAN_ERROR.CLAN_TAG;
  if (tag.length < 2 || tag.length > 6) return CLAN_ERROR.CLAN_TAG_LEN;
  const lower = tag.toLowerCase();
  if (activeClanRecords().some((clan) => Number(clan.id) !== Number(currentClanId) && String(clan.tag || "").toLowerCase() === lower)) {
    return CLAN_ERROR.CLAN_TAG_EXIST;
  }
  return 0;
}

function ensureClanAccount(account) {
  const normalized = normalizeAccount(account);
  store.accounts[String(normalized.id)] = normalized;
  return normalized;
}

function saveClanState() {
  refreshAllAccountClanSummaries(store);
  return saveStore(store);
}

function clanMemberRecordForAccount(account, memberLevel = 1) {
  return normalizeClanMemberRecord({
    playerId: Number(account.id),
    memberLevel,
    money: 0,
    clanExp: 0,
    expKoef: 0,
    playerExp: Number(account.exp || 0),
    joinedAt: new Date().toISOString()
  });
}

function addClanTreasuryEvent(clan, playerId, money, type) {
  const account = accountById(playerId);
  const event = normalizeClanTreasuryRecord({
    id: nextClanTreasuryEventIdValue(),
    clanId: clan.id,
    playerId,
    playerName: account?.name || "",
    money,
    type,
    createdAt: new Date().toISOString()
  });
  clan.treasuryEvents.push(event);
  clan.treasuryEvents.sort((left, right) => Number(right.id) - Number(left.id));
  return event;
}

async function addClanMoneyPostgres(account, clanId, money) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    let eventId = 0;
    let nextPlayerMoney = Number(account.money || 0);
    let nextClanMoney = 0;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const playerRow = player.rows[0];
      if (!playerRow || playerRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const clanResult = await client.query("SELECT * FROM clans WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [Number(clanId)]);
      const clanRow = clanResult.rows[0];
      const memberResult = await client.query(
        "SELECT * FROM clan_members WHERE clan_id = $1 AND player_id = $2 FOR UPDATE",
        [Number(clanId), Number(account.id)]
      );
      const memberRow = memberResult.rows[0];
      if (!clanRow || !memberRow || money <= 0) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const playerMoney = Number(playerRow.money || 0);
      if (playerMoney < money) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.MISSING_MONEY);
      }

      const eventIdResult = await client.query("SELECT COALESCE(MAX(id), 0)::int + 1 AS id FROM clan_treasury_events");
      eventId = Number(eventIdResult.rows[0]?.id || 1);
      const createdAt = new Date().toISOString();
      nextPlayerMoney = playerMoney - money;
      nextClanMoney = Number(clanRow.money || 0) + money;
      const nextMemberMoney = Number(memberRow.money || 0) + money;
      const playerName = String(playerRow.name || account.name || "");

      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextPlayerMoney]);
      await client.query("UPDATE clans SET money = $2, updated_at = now() WHERE id = $1", [Number(clanId), nextClanMoney]);
      await client.query(
        "UPDATE clan_members SET money = $3 WHERE clan_id = $1 AND player_id = $2",
        [Number(clanId), Number(account.id), nextMemberMoney]
      );
      await client.query(
        `INSERT INTO clan_treasury_events (id, clan_id, player_id, player_name, money, event_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, Number(clanId), Number(account.id), playerName, money, CLAN_TREASURY_EVENT_TYPE.ADD, createdAt]
      );
      await client.query("COMMIT");
      committed = true;

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        fresh.money = nextPlayerMoney;
        store.accounts[String(fresh.id)] = fresh;
      } else {
        account.money = nextPlayerMoney;
        store.accounts[String(account.id)] = normalizeAccount(account);
      }

      const clan = clanById(clanId, { includeDeleted: true });
      if (clan) {
        clan.money = nextClanMoney;
        clan.updatedAt = createdAt;
        if (clan.members?.[String(account.id)]) {
          clan.members[String(account.id)].money = nextMemberMoney;
        }
        const event = normalizeClanTreasuryRecord({
          id: eventId,
          clanId,
          playerId: Number(account.id),
          playerName,
          money,
          type: CLAN_TREASURY_EVENT_TYPE.ADD,
          createdAt
        });
        clan.treasuryEvents = (clan.treasuryEvents || []).filter((item) => Number(item.id) !== eventId);
        clan.treasuryEvents.push(event);
        clan.treasuryEvents.sort((left, right) => Number(right.id) - Number(left.id));
        store.clans.nextTreasuryEventId = Math.max(Number(store.clans.nextTreasuryEventId || 1), eventId + 1);
        refreshAllAccountClanSummaries(store);
      }

      console.log(`[clan-treasury] add player=${account.id} clan=${clanId} money=${money} playerMoney=${nextPlayerMoney} clanMoney=${nextClanMoney} event=${eventId}`);
      return ok({ id: eventId, cid: Number(clanId) });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      if (committed) {
        console.error("[postgres] clan treasury memory sync failed", error);
        return ok({ id: eventId, cid: Number(clanId) });
      }
      console.error("[postgres] clan treasury add failed", error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

function addClanEvent(clan, type, data = {}, creatorPlayerId = 0) {
  const event = normalizeClanEventRecord({
    id: nextClanEventIdValue(),
    clanId: clan.id,
    type,
    creatorPlayerId,
    data,
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    createdAt: new Date().toISOString()
  });
  clan.events.push(event);
  return event;
}

function clanBaseResponse(account, extra = {}) {
  return ok({
    time: currentUnixSeconds(),
    costs: clanCostsPayload(),
    ui: {
      i: playerInviteClanIds(account.id),
      uc: {
        u: playerInviteClanIds(account.id).length,
        m: Number(account.clanMaxRequest || 10),
        ek: Number(account.clan?.ek || 0)
      }
    },
    ...extra
  });
}

function clanListPayload(url, account, sourceClans = activeClanRecords()) {
  const page = Math.max(1, Number(url.searchParams.get("pg") || 1));
  const pageSize = 100;
  const lite = Number(url.searchParams.get("lite") || 0) === 1;
  const sorted = [...sourceClans].sort((left, right) => {
    const expDiff = Number(right.exp || 0) - Number(left.exp || 0);
    if (expDiff !== 0) return expDiff;
    return Number(left.id) - Number(right.id);
  });
  const start = (page - 1) * pageSize;
  const ownClan = playerClanRecord(account.id);
  const response = clanBaseResponse(account, {
    pg: page,
    dtot: Math.max(1, Math.ceil(sorted.length / pageSize)),
    d: sorted.slice(start, start + pageSize).map((clan) => clanPayload(clan))
  });
  if (ownClan && !lite) {
    response.id = Number(ownClan.id);
    response.cinfo = clanPayload(ownClan, { full: true });
  }
  return response;
}

function clanExtraPayload(account, clanId) {
  const clan = clanById(clanId, { includeDeleted: true });
  if (!clan) return clanBaseResponse(account, { id: 0, cinfo: {} });
  return clanBaseResponse(account, {
    id: Number(clan.id),
    cinfo: clanPayload(clan, { full: true })
  });
}

async function createClan(account, url) {
  account = ensureClanAccount(account);
  const name = cleanClanName(clanFormValue(url, "data[name]", "name"));
  const tag = cleanClanTag(clanFormValue(url, "data[tag]", "tag"));
  const armId = normalizeClanArmId(clanFormValue(url, "data[arm_id]", "arm_id") || 1);
  if (Number(account.level || 1) < CLAN_CREATE_LEVEL) return clanError(CLAN_ERROR.CLAN_USER_LVL_LESS);
  if (playerClanRecord(account.id)) return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
  if (!armId || !isDefaultClanArmId(armId)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const nameError = validateClanName(name);
  if (nameError) return clanError(nameError);
  const tagError = validateClanTag(tag);
  if (tagError) return clanError(tagError);
  if (Number(account.money || 0) < CLAN_COSTS.create) return clanError(CLAN_ERROR.MISSING_MONEY);

  const createdAt = new Date().toISOString();
  account.money = Number(account.money || 0) - CLAN_COSTS.create;
  account.updatedAt = createdAt;
  const id = nextClanIdValue();
  const clan = normalizeClanRecord({
    id,
    name,
    tag,
    ownerPlayerId: Number(account.id),
    money: 0,
    armId,
    access: 1,
    accessLevel: CLAN_JOIN_LEVEL,
    maxMembers: CLAN_DEFAULT_MAX_MEMBERS,
    members: {
      [String(account.id)]: clanMemberRecordForAccount(account, 2)
    },
    createdAt,
    updatedAt: createdAt
  });
  store.clans.byId[String(id)] = clan;
  await saveClanState();
  return clanBaseResponse(account, {
    id,
    cinfo: clanPayload(clan, { full: true })
  });
}

async function joinClan(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  if (!clan) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(account.level || 1) < CLAN_JOIN_LEVEL) return clanError(CLAN_ERROR.CLAN_USER_LVL_LESS);
  if (playerClanRecord(account.id)) return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
  if (Number(clan.access || 0) === 0 || Number(clan.accessLevel || 0) > Number(account.level || 0)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Object.keys(clan.members || {}).length >= Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS)) return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
  if (playerInviteClanIds(account.id).length >= Number(account.clanMaxRequest || 10) && !clan.invites[String(account.id)]) {
    return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  }
  clan.invites[String(account.id)] = {
    playerId: Number(account.id),
    createdAt: new Date().toISOString()
  };
  await saveClanState();
  console.log(`[clan-invite] join player=${account.id} clan=${clan.id} invites=${Object.keys(clan.invites || {}).length}`);
  return ok({ id: Number(clan.id) });
}

async function buyClanRequests(account) {
  account = ensureClanAccount(account);
  if (Number(account.money || 0) < CLAN_COSTS.requests) return clanError(CLAN_ERROR.MISSING_MONEY);
  account.money = Number(account.money || 0) - CLAN_COSTS.requests;
  account.clanMaxRequest = Number(account.clanMaxRequest || 10) + 5;
  account.updatedAt = new Date().toISOString();
  await saveClanState();
  return ok();
}

function isClanOwner(account, clan) {
  return Number(clan?.ownerPlayerId || 0) === Number(account?.id || 0);
}

async function acceptClanInvite(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const userId = Number(url.searchParams.get("uid") || 0);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const invite = clan.invites[String(userId)];
  const userAccount = accountById(userId);
  if (!invite || !userAccount) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const existingClan = playerClanRecord(userId);
  if (existingClan) {
    if (clan.invites?.[String(userId)]) {
      delete clan.invites[String(userId)];
      clan.updatedAt = new Date().toISOString();
      await saveClanState();
    }
    return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
  }
  if (Object.keys(clan.members || {}).length >= Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS)) {
    return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
  }
  let removedInvites = 0;
  for (const otherClan of activeClanRecords()) {
    if (!otherClan.invites?.[String(userId)]) continue;
    delete otherClan.invites[String(userId)];
    otherClan.updatedAt = new Date().toISOString();
    removedInvites += 1;
  }
  clan.members[String(userId)] = clanMemberRecordForAccount(userAccount, 1);
  clan.updatedAt = new Date().toISOString();
  await saveClanState();
  console.log(`[clan-invite] accept owner=${account.id} player=${userId} clan=${clan.id} invites=${Object.keys(clan.invites || {}).length}`);
  return ok({
    id: userId,
    i: clanMemberAccountPayload(clan.members[String(userId)])
  });
}

async function rejectClanInvite(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const userId = Number(url.searchParams.get("uid") || 0);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  delete clan.invites[String(userId)];
  clan.updatedAt = new Date().toISOString();
  await saveClanState();
  console.log(`[clan-invite] reject owner=${account.id} player=${userId} clan=${clan.id} invites=${Object.keys(clan.invites || {}).length}`);
  return ok({ id: userId });
}

function removeClanMember(account, url, eventType = CLAN_EVENT_TYPE.DELETE_MEMBER) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const userId = eventType === CLAN_EVENT_TYPE.LEAVE_MEMBER ? Number(account.id) : Number(url.searchParams.get("uid") || 0);
  if (!clan || !clan.members[String(userId)]) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (eventType !== CLAN_EVENT_TYPE.LEAVE_MEMBER && !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(clan.ownerPlayerId) === Number(userId)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  delete clan.members[String(userId)];
  addClanEvent(clan, eventType, { uid: userId }, Number(account.id));
  clan.exp = Object.values(clan.members || {}).reduce((sum, member) => sum + Number(member.clanExp || 0), 0);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok();
}

function deleteClan(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  addClanEvent(clan, CLAN_EVENT_TYPE.DELETE, {}, Number(account.id));
  clan.deletedAt = new Date().toISOString();
  clan.members = {};
  clan.invites = {};
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok();
}

function expandClan(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(clan.maxMembers || 0) >= CLAN_MAX_MEMBERS) return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
  if (Number(clan.money || 0) < CLAN_COSTS.expandMember) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - CLAN_COSTS.expandMember;
  clan.maxMembers = Math.min(CLAN_MAX_MEMBERS, Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS) + 1);
  addClanTreasuryEvent(clan, account.id, -CLAN_COSTS.expandMember, CLAN_TREASURY_EVENT_TYPE.EXPAND_MEMBER);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ cid: Number(clan.id), macnt: Number(clan.maxMembers) });
}

function addClanMoney(account, url) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  const money = Math.max(0, Number(url.searchParams.get("money") || 0));
  if (pgPool) return addClanMoneyPostgres(account, clanId, money);
  const clan = clanById(clanId);
  if (!clan || !clan.members[String(account.id)] || money <= 0) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(account.money || 0) < money) return clanError(CLAN_ERROR.MISSING_MONEY);
  account.money = Number(account.money || 0) - money;
  clan.money = Number(clan.money || 0) + money;
  clan.members[String(account.id)].money = Number(clan.members[String(account.id)].money || 0) + money;
  const event = addClanTreasuryEvent(clan, account.id, money, CLAN_TREASURY_EVENT_TYPE.ADD);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  console.log(`[clan-treasury] add player=${account.id} clan=${clan.id} money=${money} playerMoney=${account.money} clanMoney=${clan.money} event=${event.id}`);
  return ok({ id: Number(event.id), cid: Number(clan.id) });
}

function changeClanName(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const name = cleanClanName(clanFormValue(url, "data[name]", "name"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const error = validateClanName(name, clan.id);
  if (error) return clanError(error);
  if (Number(clan.money || 0) < CLAN_COSTS.changeName) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - CLAN_COSTS.changeName;
  clan.name = name;
  addClanTreasuryEvent(clan, account.id, -CLAN_COSTS.changeName, CLAN_TREASURY_EVENT_TYPE.CHANGE_NAME);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ id: Number(clan.id) });
}

function changeClanTag(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const tag = cleanClanTag(clanFormValue(url, "data[tag]", "tag"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const error = validateClanTag(tag, clan.id);
  if (error) return clanError(error);
  if (Number(clan.money || 0) < CLAN_COSTS.changeTag) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - CLAN_COSTS.changeTag;
  clan.tag = tag;
  addClanTreasuryEvent(clan, account.id, -CLAN_COSTS.changeTag, CLAN_TREASURY_EVENT_TYPE.CHANGE_TAG);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ id: Number(clan.id) });
}

function changeClanArm(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const armId = normalizeClanArmId(clanFormValue(url, "data[arm_id]", "arm_id") || 1);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (!armId) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(clan.armId || 0) === armId) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const price = clanArmCostForClan(clan, armId);
  if (Number(clan.money || 0) < price) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - price;
  clan.armId = armId;
  ensureClanOwnedArm(clan, armId, price > 0 ? "purchase" : "switch");
  if (price > 0) addClanTreasuryEvent(clan, account.id, -price, CLAN_TREASURY_EVENT_TYPE.CHANGE_ARM);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  console.log(`[clan-arm] change player=${account.id} clan=${clan.id} arm=${armId} price=${price} money=${clan.money}`);
  return ok({ id: Number(clan.id) });
}

function changeClanText(account, url, field) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (field === "homepage") clan.homepage = cleanClanUrl(clanFormValue(url, "data[url]", "url"));
  if (field === "desc") clan.desc = cleanClanDesc(clanFormValue(url, "data[desc]", "data[description]", "desc", "description"));
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ id: Number(clan.id) });
}

function changeClanAccess(account, url, field) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (field === "access") clan.access = Number(url.searchParams.get("access") || 0) === 1 ? 1 : 0;
  if (field === "accessLevel") clan.accessLevel = Math.max(0, Number(url.searchParams.get("accesslvl") || 0));
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  console.log(`[clan-access] change player=${account.id} clan=${clan.id} access=${clan.access} accessLevel=${clan.accessLevel}`);
  return ok({ id: Number(clan.id) });
}

function changeClanOwner(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const newOwnerId = Number(url.searchParams.get("nid") || 0);
  if (!clan || !isClanOwner(account, clan) || !clan.members[String(newOwnerId)]) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  clan.ownerPlayerId = newOwnerId;
  addClanEvent(clan, CLAN_EVENT_TYPE.CHANGE_OWNER, { nuid: newOwnerId }, Number(account.id));
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ cid: Number(clan.id), nid: newOwnerId });
}

function changeClanKoef(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const value = Number(url.searchParams.get("val") || 0);
  if (!clan || !clan.members[String(account.id)] || ![0, 25, 50, 75, 100].includes(value)) {
    return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  }
  clan.members[String(account.id)].expKoef = value === 100 ? 75 : value;
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ cid: Number(clan.id), id: Number(account.id), val: Number(clan.members[String(account.id)].expKoef) });
}

function buyClanEnhancer(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const enhancerId = Number(url.searchParams.get("id") || 0);
  const duration = normalizeShopDuration(url.searchParams.get("dur"));
  const item = canonicalEnhancersById.get(enhancerId);
  if (!clan || !isClanOwner(account, clan) || !item || Number(item.iC || 0) !== 1) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const price = shopDurationPrice(item, duration);
  if (Number(clan.money || 0) < price) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - price;
  const seconds = shopDurationSeconds(duration);
  const expiresAt = seconds > 0 ? currentUnixSeconds() + seconds : 0;
  const inventoryItem = {
    ...clone(item),
    it: 2,
    itype: 2,
    iC: 1,
    eD: expiresAt
  };
  const key = `2:${enhancerId}`;
  clan.inventory = (clan.inventory || []).filter((owned) => String(owned.itemKey || inventoryItemKey(owned)) !== key);
  clan.inventory.push({ ...inventoryItem, itemKey: key });
  addClanTreasuryEvent(clan, account.id, -price, CLAN_TREASURY_EVENT_TYPE.BUY_ENHANCER);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok();
}

function refreshClanEvents(account, url) {
  const clan = clanById(url.searchParams.get("cid"), { includeDeleted: true });
  if (!clan) return ok({ cid: Number(url.searchParams.get("cid") || 0), ev: [] });
  return ok({ cid: Number(clan.id), ev: (clan.events || []).map(clanEventPayload) });
}

function deleteClanEvent(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"), { includeDeleted: true });
  const eventId = Number(url.searchParams.get("eid") || 0);
  if (!clan) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  clan.events = (clan.events || []).filter((event) => Number(event.id) !== eventId);
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  return ok({ cid: Number(clan.id), eid: eventId });
}

async function routeClan(account, url, act, requestOrigin = null) {
  ensureClanStore();
  account = ensureClanAccount(account);

  switch (act) {
    case "g":
      return clanListPayload(url, account);
    case "gextra":
      return clanExtraPayload(account, url.searchParams.get("cid"));
    case "src": {
      const value = clanFormValue(url, "v").toLowerCase();
      const clans = activeClanRecords().filter((clan) => {
        if (!value) return false;
        return String(clan.name || "").toLowerCase().includes(value) || String(clan.tag || "").toLowerCase().includes(value);
      });
      console.log(`[clan-search] user=${account.id} value=${value} results=${clans.length} clans=${clans.map((clan) => `${clan.id}:aid${clan.armId}:a${clan.access}`).join(",")}`);
      return clanBaseResponse(account, { d: clans.map((clan) => clanPayload(clan)) });
    }
    case "m": {
      const clan = clanById(url.searchParams.get("cid"), { includeDeleted: true });
      return ok({ mlist: clan ? clanMemberList(clan) : [] });
    }
    case "inv": {
      const clan = clanById(url.searchParams.get("cid"), { includeDeleted: true });
      return ok({ inv: clan ? clanInviteList(clan) : [] });
    }
    case "arms":
      return ok({ arms: clanArmsPayload(requestOrigin, playerClanRecord(account.id)) });
    case "create":
      return await createClan(account, url);
    case "del":
      return deleteClan(account, url);
    case "join":
      return await joinClan(account, url);
    case "accept":
      return await acceptClanInvite(account, url);
    case "reject":
      return await rejectClanInvite(account, url);
    case "buyReq":
      return await buyClanRequests(account);
    case "expand":
      return expandClan(account, url);
    case "remove":
      return removeClanMember(account, url, CLAN_EVENT_TYPE.DELETE_MEMBER);
    case "leave":
      return removeClanMember(account, url, CLAN_EVENT_TYPE.LEAVE_MEMBER);
    case "bench":
      return buyClanEnhancer(account, url);
    case "cname":
      return changeClanName(account, url);
    case "ctag":
      return changeClanTag(account, url);
    case "carm":
      return changeClanArm(account, url);
    case "curl":
      return changeClanText(account, url, "homepage");
    case "cdesc":
      return changeClanText(account, url, "desc");
    case "cowner":
      return changeClanOwner(account, url);
    case "caccess":
      return changeClanAccess(account, url, "access");
    case "caccesslvl":
      return changeClanAccess(account, url, "accessLevel");
    case "amoney":
      return addClanMoney(account, url);
    case "ckoef":
      return changeClanKoef(account, url);
    case "gevnt":
      return refreshClanEvents(account, url);
    case "delevnt":
      return deleteClanEvent(account, url);
    default:
      return clanBaseResponse(account, { d: [] });
  }
}

function normalizeShopDuration(value) {
  const duration = Number(value);
  return Object.values(SHOP_DURATION).includes(duration) ? duration : SHOP_DURATION.PERMANENT;
}

function shopDurationSeconds(duration) {
  switch (normalizeShopDuration(duration)) {
    case SHOP_DURATION.DAY:
      return SHOP_DAY_SECONDS;
    case SHOP_DURATION.WEEK:
      return SHOP_DAY_SECONDS * 7;
    case SHOP_DURATION.MONTH:
      return SHOP_DAY_SECONDS * 30;
    case SHOP_DURATION.PERMANENT:
    default:
      return 0;
  }
}

function shopDurationPrice(item, duration) {
  const sc = item?.sc || {};
  const keyByDuration = {
    [SHOP_DURATION.DAY]: "t1v",
    [SHOP_DURATION.WEEK]: "t7v",
    [SHOP_DURATION.MONTH]: "t30v",
    [SHOP_DURATION.PERMANENT]: "tPv"
  };
  const value = Number(sc[keyByDuration[normalizeShopDuration(duration)]]);
  return Number.isFinite(value) ? value : itemPrice(item);
}

function findOwnedInventoryItem(account, item) {
  return (account.inventory || []).find(
    (owned) =>
      Number(owned.itype) === Number(item.itype) &&
      Number(owned.id ?? owned.w_id ?? owned.t_id ?? owned.e_id) === Number(item.id ?? item.w_id ?? item.t_id ?? item.e_id)
  );
}

function withPurchasedDuration(item, duration, existingItem = null, now = currentUnixSeconds()) {
  const itemData = clone(item);
  const seconds = shopDurationSeconds(duration);
  if (seconds === 0) {
    itemData.eD = 0;
    return itemData;
  }

  const existingExpiry = Number(existingItem?.eD || 0);
  const base = Number.isFinite(existingExpiry) && existingExpiry > now ? existingExpiry : now;
  itemData.eD = base + seconds;
  return itemData;
}

function hasInventoryItem(account, item) {
  return account.inventory.some((owned) => Number(owned.itype) === Number(item.itype) && Number(owned.id ?? owned.w_id ?? owned.t_id ?? owned.e_id) === Number(item.id ?? item.w_id ?? item.t_id ?? item.e_id));
}

function recordPurchase(account, item, price) {
  if (!pgPool || !item) return;
  const row = {
    playerId: account.id,
    itemKey: inventoryItemKey(item),
    itemType: Number(item.itype || 0),
    itemId: inventoryItemId(item),
    price: Number(price || 0),
    itemData: clone(item)
  };
  pgSaveChain = pgSaveChain
    .then(() =>
      pgPool.query(
        `INSERT INTO purchase_history (player_id, item_key, item_type, item_id, price, currency, item_data)
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)`,
        [row.playerId, row.itemKey, row.itemType, row.itemId, row.price, JSON.stringify(row.itemData)]
      )
    )
    .catch((error) => {
      console.error("[postgres] purchase_history write failed", error);
    });
}

async function buyItemPostgres(account, item, price) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    try {
      const itemData = clone(item);
      const itemType = Number(itemData?.itype || 0);
      if (isWeaponItem(itemData) && !isValidShopPrice(price)) {
        console.error(`[buy-item] invalid weapon price player=${account.id} key=${inventoryItemKey(itemData)} item=${inventoryItemId(itemData)} price=${price}`);
        return { result: false, err: [1] };
      }

      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const money = Number(row.money || 0);
      if (isWeaponItem(itemData)) {
        const existing = await client.query(
          "SELECT 1 FROM player_inventory WHERE player_id = $1 AND item_key = $2 LIMIT 1",
          [Number(account.id), inventoryItemKey(itemData)]
        );
        if (existing.rowCount > 0) {
          await client.query("ROLLBACK");
          return ok({ req: "", vcur: money });
        }
      }

      if (money < price) {
        await client.query("ROLLBACK");
        return { result: false, err: [2] };
      }

      const nextMoney = money - price;
      const currentView = jsonValue(row.view, {});
      const currentWeapons = jsonValue(row.weap, {});
      const nextView = viewAfterPurchasedWear(currentView, itemData);
      const nextWeapons = weaponSelectionAfterPurchasedWeapon(currentWeapons, itemData);
      await client.query(
        "UPDATE players SET money = $2, view = $3::jsonb, weap = $4::jsonb, updated_at = now() WHERE id = $1",
        [Number(account.id), nextMoney, JSON.stringify(nextView), JSON.stringify(nextWeapons)]
      );
      await client.query(
        `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [Number(account.id), inventoryItemKey(itemData), itemType, JSON.stringify(itemData)]
      );
      await client.query(
        `INSERT INTO purchase_history (player_id, item_key, item_type, item_id, price, currency, item_data)
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)`,
        [
          Number(account.id),
          inventoryItemKey(itemData),
          itemType,
          inventoryItemId(itemData),
          Number(price || 0),
          JSON.stringify(itemData)
        ]
      );
      if (itemType === 1 || itemType === 3) {
        await client.query(
          `INSERT INTO player_equipment (player_id, view, weap, taun, updated_at)
           VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, now())
           ON CONFLICT (player_id) DO UPDATE SET
             view = EXCLUDED.view,
             weap = EXCLUDED.weap,
             updated_at = now()`,
          [
            Number(account.id),
            JSON.stringify(nextView),
            JSON.stringify(nextWeapons),
            JSON.stringify(jsonValue(row.taun, {}))
          ]
        );
      }

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
      }

      console.log(`[buy-item] pg player=${account.id} type=${itemType} key=${inventoryItemKey(itemData)} item=${inventoryItemId(itemData)} price=${price} before=${money} after=${nextMoney} view=${viewSelectionSummary(nextView)} weap=${weaponSelectionSummary(nextWeapons)}`);
      return ok({ req: "", vcur: nextMoney });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] buy item failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function buyItem(account, item) {
  if (!item) return { result: false, err: [1] };
  const price = itemPrice(item);
  if (isWeaponItem(item) && !isValidShopPrice(price)) {
    console.error(`[buy-item] invalid weapon price player=${account.id} key=${inventoryItemKey(item)} item=${inventoryItemId(item)} price=${price}`);
    return { result: false, err: [1] };
  }
  if (pgPool) return buyItemPostgres(account, item, price);
  if (isWeaponItem(item) && hasInventoryItem(account, item)) {
    return ok({ req: "", vcur: account.money });
  }
  if (account.money < price) return { result: false, err: [2] };
  if (!hasInventoryItem(account, item)) {
    account.inventory.push(clone(item));
  }
  account.view = viewAfterPurchasedWear(account.view, item);
  account.weap = weaponSelectionAfterPurchasedWeapon(account.weap, item);
  const beforeMoney = Number(account.money || 0);
  account.money -= price;
  recordPurchase(account, item, price);
  persist(account);
  console.log(`[buy-item] json player=${account.id} type=${Number(item?.itype || 0)} key=${inventoryItemKey(item)} item=${inventoryItemId(item)} price=${price} before=${beforeMoney} after=${account.money} view=${viewSelectionSummary(account.view)} weap=${weaponSelectionSummary(account.weap)}`);
  return ok({ req: "", vcur: account.money });
}

async function buyEnhancerPostgres(account, item, duration, price) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const money = Number(row.money || 0);
      if (money < price) {
        await client.query("ROLLBACK");
        return { result: false, err: [2] };
      }

      const itemKey = inventoryItemKey(item);
      const existing = await client.query(
        "SELECT item_data FROM player_inventory WHERE player_id = $1 AND item_key = $2 FOR UPDATE",
        [Number(account.id), itemKey]
      );
      const itemData = withPurchasedDuration(item, duration, jsonValue(existing.rows[0]?.item_data, null));
      const nextMoney = money - price;

      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextMoney]);
      await client.query(
        `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [Number(account.id), itemKey, Number(itemData?.itype || 0), JSON.stringify(itemData)]
      );
      await client.query(
        `INSERT INTO purchase_history (player_id, item_key, item_type, item_id, price, currency, item_data)
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)`,
        [
          Number(account.id),
          itemKey,
          Number(itemData?.itype || 0),
          inventoryItemId(itemData),
          Number(price || 0),
          JSON.stringify(itemData)
        ]
      );

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
      }

      return ok({ req: "", vcur: nextMoney });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] buy enhancer failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function buyEnhancer(account, item, duration) {
  if (!item) return { result: false, err: [1] };
  if (Number(item.iC || 0) === 1) return { result: false, err: [1] };
  const selectedDuration = normalizeShopDuration(duration);
  const price = shopDurationPrice(item, selectedDuration);
  if (pgPool) return buyEnhancerPostgres(account, item, selectedDuration, price);
  if (account.money < price) return { result: false, err: [2] };
  if (!Array.isArray(account.inventory)) account.inventory = [];

  const existingItem = findOwnedInventoryItem(account, item);
  const itemData = withPurchasedDuration(item, selectedDuration, existingItem);
  const itemKey = inventoryItemKey(itemData);
  const existingIndex = (account.inventory || []).findIndex((owned) => inventoryItemKey(owned) === itemKey);
  if (existingIndex >= 0) {
    account.inventory[existingIndex] = itemData;
  } else {
    account.inventory.push(itemData);
  }

  account.money -= price;
  persist(account);
  return ok({ req: "", vcur: account.money });
}

function weaponUpgradePrice(item) {
  return shopDurationPrice(item, SHOP_DURATION.DAY);
}

function withWeaponUpgradeDuration(upgrade, existingItem = null, now = currentUnixSeconds()) {
  const itemData = clone(upgrade);
  const existingExpiry = Number(existingItem?.eD || 0);
  const base = Number.isFinite(existingExpiry) && existingExpiry > now ? existingExpiry : now;
  itemData.eD = base + SHOP_DAY_SECONDS;
  return itemData;
}

async function buyWeaponUpgradePostgres(account, upgrade, price) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    try {
      if (!isValidShopPrice(price)) {
        console.error(`[buy-weapon-upgrade] invalid price player=${account.id} key=${inventoryItemKey(upgrade)} item=${inventoryItemId(upgrade)} price=${price}`);
        return { result: false, err: [1] };
      }

      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const money = Number(row.money || 0);
      if (money < price) {
        await client.query("ROLLBACK");
        return { result: false, err: [2] };
      }

      const itemKey = inventoryItemKey(upgrade);
      const existing = await client.query(
        "SELECT item_data FROM player_inventory WHERE player_id = $1 AND item_key = $2 FOR UPDATE",
        [Number(account.id), itemKey]
      );
      const existingItem = jsonValue(existing.rows[0]?.item_data, null);
      if (!existingItem || Number(existingItem?.itype || 0) !== 1) {
        await client.query("ROLLBACK");
        return { result: false, err: [1] };
      }

      const itemData = withWeaponUpgradeDuration(upgrade, existingItem);
      const nextMoney = money - price;

      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextMoney]);
      await client.query(
        `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [Number(account.id), itemKey, Number(itemData?.itype || 0), JSON.stringify(itemData)]
      );
      await client.query(
        `INSERT INTO purchase_history (player_id, item_key, item_type, item_id, price, currency, item_data)
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)`,
        [
          Number(account.id),
          itemKey,
          Number(itemData?.itype || 0),
          inventoryItemId(itemData),
          Number(price || 0),
          JSON.stringify(itemData)
        ]
      );

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
      }

      console.log(`[buy-weapon-upgrade] pg player=${account.id} key=${itemKey} item=${inventoryItemId(itemData)} price=${price} before=${money} after=${nextMoney}`);
      return ok({ req: "", vcur: nextMoney });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] buy weapon upgrade failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function buyWeaponUpgrade(account, upgrade) {
  if (!upgrade) return { result: false, err: [1] };
  const price = weaponUpgradePrice(upgrade);
  if (!isValidShopPrice(price)) {
    console.error(`[buy-weapon-upgrade] invalid price player=${account.id} key=${inventoryItemKey(upgrade)} item=${inventoryItemId(upgrade)} price=${price}`);
    return { result: false, err: [1] };
  }
  if (pgPool) return buyWeaponUpgradePostgres(account, upgrade, price);
  if (account.money < price) return { result: false, err: [2] };
  if (!Array.isArray(account.inventory)) account.inventory = [];

  const itemKey = inventoryItemKey(upgrade);
  const existingIndex = account.inventory.findIndex((owned) => inventoryItemKey(owned) === itemKey && Number(owned?.itype || 0) === 1);
  if (existingIndex < 0) return { result: false, err: [1] };

  const itemData = withWeaponUpgradeDuration(upgrade, account.inventory[existingIndex]);
  account.inventory[existingIndex] = itemData;
  account.money -= price;
  recordPurchase(account, itemData, price);
  persist(account);
  console.log(`[buy-weapon-upgrade] json player=${account.id} key=${itemKey} item=${inventoryItemId(itemData)} price=${price} before=${account.money + price} after=${account.money}`);
  return ok({ req: "", vcur: account.money });
}

function requestedViewSelection(url, baseView = {}) {
  const view = { ...baseView };
  for (const key of viewWearKeys) {
    if (url.searchParams.has(key)) view[key] = Number(url.searchParams.get(key) || 0);
  }
  return view;
}

function viewSelectionSummary(view = {}) {
  return viewWearKeys.map((key) => `${key}:${Number(view?.[key] || 0)}`).join(",");
}

async function saveViewPostgres(account, requestedView, saveVersion) {
  return enqueuePostgresMutation(async () => {
    if (!isLatestViewSelectionSaveVersion(account.id, saveVersion)) {
      console.log(`[save] sview skip stale id=${account.id} version=${saveVersion} req=${viewSelectionSummary(requestedView)}`);
      return ok();
    }

    let client = null;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      if (!isLatestViewSelectionSaveVersion(account.id, saveVersion)) {
        await client.query("ROLLBACK");
        console.log(`[save] sview skip stale id=${account.id} version=${saveVersion} req=${viewSelectionSummary(requestedView)}`);
        return ok();
      }

      const inventoryRows = await client.query(
        "SELECT item_data FROM player_inventory WHERE player_id = $1 ORDER BY created_at, item_key FOR UPDATE",
        [Number(account.id)]
      );
      const inventory = inventoryRows.rows.map((itemRow) => jsonValue(itemRow.item_data, {}));
      const current = accountFromPostgresRow(row, inventory);
      const normalized = normalizeViewInventory(requestedView, current.inventory || []);
      const now = new Date().toISOString();

      await client.query(
        "UPDATE players SET view = $2::jsonb, updated_at = $3 WHERE id = $1",
        [Number(account.id), JSON.stringify(normalized.view), now]
      );
      await client.query(
        `INSERT INTO player_equipment (player_id, view, weap, taun, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, now())
         ON CONFLICT (player_id) DO UPDATE SET
           view = EXCLUDED.view,
           updated_at = now()`,
        [Number(account.id), JSON.stringify(normalized.view), JSON.stringify(current.weap || {}), JSON.stringify(current.taun || {})]
      );

      for (const item of normalized.inventory || []) {
        const itemKey = inventoryItemKey(item);
        if (!itemKey) continue;
        await client.query(
          `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, now())
           ON CONFLICT (player_id, item_key) DO UPDATE SET
             item_type = EXCLUDED.item_type,
             item_data = EXCLUDED.item_data,
             updated_at = now()`,
          [Number(account.id), itemKey, Number(item?.itype || 0), JSON.stringify(item)]
        );
      }

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      const saved = fresh || { ...current, view: normalized.view, inventory: normalized.inventory };
      store.accounts[String(saved.id)] = saved;
      console.log(`[save] sview ok id=${saved.id} version=${saveVersion} req=${viewSelectionSummary(requestedView)} saved=${viewSelectionSummary(saved.view)}`);
      return ok({ view: clone(saved.view) });
    } catch (error) {
      try {
        await client?.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] save view failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function saveView(account, url) {
  const requestedView = requestedViewSelection(url, account.view || {});
  const saveVersion = nextViewSelectionSaveVersion(account.id);

  if (pgPool) {
    return saveViewPostgres(account, requestedView, saveVersion);
  }

  if (!isLatestViewSelectionSaveVersion(account.id, saveVersion)) {
    console.log(`[save] sview skip stale id=${account.id} version=${saveVersion} req=${viewSelectionSummary(requestedView)}`);
    return ok();
  }

  const normalized = normalizeViewInventory(requestedView, account.inventory || []);
  account.view = normalized.view;
  account.inventory = normalized.inventory;
  persist(account);
  console.log(`[save] sview ok id=${account.id} version=${saveVersion} req=${viewSelectionSummary(requestedView)} saved=${viewSelectionSummary(account.view)}`);
  return ok({ view: clone(account.view) });
}

function requestedWeaponSelection(url, baseSelection = {}) {
  const selection = { ...baseSelection };
  for (let i = 1; i <= 7; i += 1) {
    if (url.searchParams.has(`i${i}`)) selection[`id${i}`] = Number(url.searchParams.get(`i${i}`) || 0);
  }
  return selection;
}

function weaponSelectionSummary(selection = {}) {
  return Array.from({ length: 7 }, (_, index) => {
    const slot = index + 1;
    return `${slot}:${Number(selection?.[`id${slot}`] || 0)}`;
  }).join(",");
}

async function saveWeaponsPostgres(account, requestedSelection, saveVersion) {
  return enqueuePostgresMutation(async () => {
    if (!isLatestWeaponSelectionSaveVersion(account.id, saveVersion)) {
      console.log(`[save] sweap skip stale id=${account.id} version=${saveVersion} req=${weaponSelectionSummary(requestedSelection)}`);
      return ok();
    }

    let client = null;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      if (!isLatestWeaponSelectionSaveVersion(account.id, saveVersion)) {
        await client.query("ROLLBACK");
        console.log(`[save] sweap skip stale id=${account.id} version=${saveVersion} req=${weaponSelectionSummary(requestedSelection)}`);
        return ok();
      }

      const inventoryRows = await client.query(
        "SELECT item_data FROM player_inventory WHERE player_id = $1 ORDER BY created_at, item_key FOR UPDATE",
        [Number(account.id)]
      );
      const inventory = inventoryRows.rows.map((itemRow) => jsonValue(itemRow.item_data, {}));
      const current = accountFromPostgresRow(row, inventory);
      const normalized = normalizeLoadoutInventory(requestedSelection, current.inventory || []);
      const now = new Date().toISOString();

      await client.query(
        "UPDATE players SET weap = $2::jsonb, updated_at = $3 WHERE id = $1",
        [Number(account.id), JSON.stringify(normalized.weap), now]
      );
      await client.query(
        `INSERT INTO player_equipment (player_id, view, weap, taun, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, now())
         ON CONFLICT (player_id) DO UPDATE SET
           weap = EXCLUDED.weap,
           updated_at = now()`,
        [Number(account.id), JSON.stringify(current.view || {}), JSON.stringify(normalized.weap), JSON.stringify(current.taun || {})]
      );

      for (const item of normalized.inventory || []) {
        const itemKey = inventoryItemKey(item);
        if (!itemKey) continue;
        await client.query(
          `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, now())
           ON CONFLICT (player_id, item_key) DO UPDATE SET
             item_type = EXCLUDED.item_type,
             item_data = EXCLUDED.item_data,
             updated_at = now()`,
          [Number(account.id), itemKey, Number(item?.itype || 0), JSON.stringify(item)]
        );
      }

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      const saved = fresh || { ...current, weap: normalized.weap, inventory: normalized.inventory };
      store.accounts[String(saved.id)] = saved;
      console.log(`[save] sweap ok id=${saved.id} version=${saveVersion} req=${weaponSelectionSummary(requestedSelection)} saved=${weaponSelectionSummary(saved.weap)}`);
      return ok({ weap: clone(saved.weap) });
    } catch (error) {
      try {
        await client?.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] save weapons failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function saveWeapons(account, url) {
  const requestedSelection = requestedWeaponSelection(url, account.weap || {});
  const saveVersion = nextWeaponSelectionSaveVersion(account.id);

  if (pgPool) {
    return saveWeaponsPostgres(account, requestedSelection, saveVersion);
  }

  if (!isLatestWeaponSelectionSaveVersion(account.id, saveVersion)) {
    console.log(`[save] sweap skip stale id=${account.id} version=${saveVersion} req=${weaponSelectionSummary(requestedSelection)}`);
    return ok();
  }

  const normalized = normalizeLoadoutInventory(requestedSelection, account.inventory || []);
  account.weap = normalized.weap;
  account.inventory = normalized.inventory;
  persist(account);
  console.log(`[save] sweap ok id=${account.id} version=${saveVersion} req=${weaponSelectionSummary(requestedSelection)} saved=${weaponSelectionSummary(account.weap)}`);
  return ok({ weap: clone(account.weap) });
}

function saveTaunts(account, url) {
  for (let i = 1; i <= 3; i += 1) {
    if (url.searchParams.has(`i${i}`)) account.taun[`i${i - 1}`] = Number(url.searchParams.get(`i${i}`) || 0);
  }
  persist(account);
  return ok();
}

async function changeName(account, url) {
  const { act: action } = normalizedAjaxRoute(url);
  const initialSetRequested = action === "cname" && url.searchParams.get("set") === "1";
  const paidSetRequested = action === "cpname";
  const setRequested = initialSetRequested || paidSetRequested;
  const requestedName = String(
    url.searchParams.get("ve") ||
    url.searchParams.get("v") ||
    url.searchParams.get("name") ||
    url.searchParams.get("un") ||
    account.name
  ).trim();
  const name = requestedName.slice(0, 16);
  if (action === "searcname") {
    return searchPlayersByName(account, requestedName);
  }
  const invalidLength = requestedName.length < 3 || requestedName.length > 16;
  const accounts = await allAccountsForStats();
  const nameExists = accounts.some((candidate) =>
    Number(candidate.id) !== Number(account.id) &&
    String(candidate.name || "").trim().toLowerCase() === requestedName.toLowerCase()
  );
  if (!setRequested && action === "cname") {
    if (invalidLength) return { result: false, names: [], err: [{ n: 301 }] };
    if (nameExists) return { result: false, names: [], err: [{ n: 302 }] };
    return ok({ names: [] });
  }
  if (initialSetRequested && !account.namePending) return { result: false, names: [], err: [{ n: 1 }] };
  if (invalidLength) return { result: false, names: [], err: [{ n: 301 }] };
  if (nameExists) return { result: false, names: [], err: [{ n: 302 }] };
  account.name = name;
  if (initialSetRequested) account.namePending = false;
  persist(account);
  refreshAllAccountClanSummaries(store);
  saveStore(store);
  return ok({
    names: [],
    name: account.name,
    un: account.name,
    info: {
      u_id: account.id,
      un: account.name,
      lvl: account.level,
      vcur: account.money,
      exp: {
        cur: account.exp,
        min: account.expMin,
        max: account.expMax
      }
    }
  });
}

async function buyAbilityPostgres(account, url) {
  const id = Number(url.searchParams.get("id") || 0);
  return enqueuePostgresMutation(async () => {
    let client = null;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const player = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const row = player.rows[0];
      if (!row || row.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const ownedAbilities = await client.query("SELECT ability_id, ability_level FROM player_abilities WHERE player_id = $1", [Number(account.id)]);
      const abilities = ownedAbilities.rows.map((abilityRow) => ({
        i: Number(abilityRow.ability_id),
        l: Number(abilityRow.ability_level)
      }));
      const next = abilityCatalog.find(
        (ability) => Number(ability.i) === id && !abilities.some((owned) => Number(owned.i) === id && Number(owned.l) >= Number(ability.l))
      );
      if (!next) {
        await client.query("ROLLBACK");
        return ok({ req: "" });
      }

      const price = itemPrice(next);
      const money = Number(row.money || 0);
      if (money < price) {
        await client.query("ROLLBACK");
        return { result: false, err: [2] };
      }

      const nextMoney = money - price;
      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextMoney]);
      await client.query("DELETE FROM player_abilities WHERE player_id = $1 AND ability_id = $2", [Number(account.id), id]);
      await client.query(
        `INSERT INTO player_abilities (player_id, ability_id, ability_level, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (player_id, ability_id) DO UPDATE SET
           ability_level = EXCLUDED.ability_level,
           updated_at = now()`,
        [Number(account.id), Number(next.i), Number(next.l)]
      );

      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
      }

      return ok({ req: "", vcur: nextMoney });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original error is more useful for diagnostics.
      }
      console.error("[postgres] buy ability failed", error);
      return { result: false, err: [1] };
    } finally {
      if (client) client.release();
    }
  });
}

async function buyAbility(account, url) {
  if (pgPool) return buyAbilityPostgres(account, url);
  const id = Number(url.searchParams.get("id") || 0);
  const next = abilityCatalog.find((ability) => Number(ability.i) === id && !account.abilities.some((owned) => Number(owned.i) === id && Number(owned.l) >= Number(ability.l)));
  if (!next) return ok({ req: "" });
  const price = itemPrice(next);
  if (account.money < price) return { result: false, err: [2] };
  account.money -= price;
  account.abilities = account.abilities.filter((owned) => Number(owned.i) !== id);
  account.abilities.push({ i: next.i, l: next.l });
  persist(account);
  return ok({ req: "" });
}

async function routeAjax(url, resolvedAccount = null, requestOrigin = null) {
  const { page, act } = normalizedAjaxRoute(url);
  let account = resolvedAccount || accountFrom(url);
  if (!account) {
    return { result: false, error: "1" };
  }
  if (!resolvedAccount && !isEquipmentSelectionSaveRequest(url)) account = await refreshAccountFromPostgres(account);

  if (page === "auth" && act === "g") {
    return ok({ user_id: String(account.id), key: account.key });
  }

  if (page === "account") {
    if (act === "login") return ok({ auth: { id: account.id, key: account.key } });
    if (act === "searcname") return searchPlayersByName(account, url.searchParams.get("v"));
    if (act === "cname" || act === "cpname") return changeName(account, url);
  }

  if (page === "pl") {
    if (act === "i") {
      const objectLoadout = usesProfileObjectLoadout(account, url);
      return advancedStatsPayload(await profileAccountForView(account, url), { objectLoadout });
    }
    if (act === "inv") return inventoryPayload(account);
    if (act === "map") return mapsPayload();
    if (act === "ach") return achievementsPayload(account);
    if (act === "abil") return abilitiesPayload(account);
    if (act === "sview") return saveView(account, url);
    if (act === "sweap") return saveWeapons(account, url);
    if (act === "staunt") return saveTaunts(account, url);
    if (["uid", "cev", "tmap"].includes(act)) return ok();
  }

  if (page === "shop") {
    if (act === "items") {
      logShopItemsPayload(account, act);
      return shopPayload();
    }
    if (act === "assemb") return ok({ assemblage: clone(shopAssemblages) });
    if (["wear", "weap", "weapinf", "act"].includes(act)) {
      logShopItemsPayload(account, act);
      return shopPayload();
    }
  }

  if (page === "buy") {
    const id = Number(url.searchParams.get("id") || url.searchParams.get("i") || 0);
    if (act === "bweap") return await buyItem(account, findShopItem(shopWeapons, "w_id", id));
    if (act === "bweapupg") return await buyWeaponUpgrade(account, shopWeaponUpgradesById.get(id));
    if (act === "bwear") return await buyItem(account, findShopItem(shopWears, "w_id", id));
    if (act === "btaunt") return await buyItem(account, findShopItem(shopTaunts, "t_id", id));
    if (act === "benh") return await buyEnhancer(account, findShopItem(shopEnhancers, "e_id", id), url.searchParams.get("dur"));
    if (act === "babil") return await buyAbility(account, url);
    if (act === "bmap") return ok({ req: "" });
    return { result: false, err: [1] };
  }

  if (page === "stats") {
    if (act === "league") return await leaguePayload(account);
    if (act === "ybest") return await yesterdayBestPayload(account);
    if (act === "rat") return await ratingPayload(account, url);
    if (act === "reset") return ok({ req: "" });
  }

  if (page === "clan") {
    return await routeClan(account, url, act, requestOrigin);
  }

  return ok();
}

function requestPublicOrigin(req, url) {
  const forwardedHost = TRUST_PROXY_HEADERS
    ? String(req.headers["x-forwarded-host"] || "").split(",")[0].trim()
    : "";
  const host = forwardedHost || String(req.headers.host || "").split(",")[0].trim();
  if (!host) return url.origin;
  const forwardedProto = TRUST_PROXY_HEADERS
    ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    : "";
  const proto = forwardedProto || url.protocol.replace(/:$/, "") || "http";
  return `${proto}://${host}`;
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-resource-policy": "same-site"
  };
}

function sendJson(res, payload, status = 200, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "content-length": String(Buffer.byteLength(body)),
    ...headers
  });
  res.end(body);
}

function sendHtml(res, html, status = 200, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    "content-length": String(Buffer.byteLength(html)),
    ...headers
  });
  res.end(html);
}

async function createAccountPage(url, requestOrigin = null) {
  const code = url.searchParams.get("code") || "";
  const name = cleanName(url.searchParams.get("name") || "");
  if (code && !safeTokenEquals(code, CREATE_CODE)) {
    return {
      status: 403,
      html: "<h1>\u041a\u043e\u0434 \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u0439</h1><p>\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043a\u043e\u0434 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.</p>"
    };
  }

  if (safeTokenEquals(code, CREATE_CODE) && name) {
    let account;
    try {
      account = await createNewAccount(name);
    } catch (error) {
      console.error("[game-link] create failed", error);
      return {
        status: 500,
        html: "<h1>\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d</h1><p>\u0417\u0430\u043f\u0438\u0441\u044c \u0432 \u0431\u0430\u0437\u0443 \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043b\u043e\u0433 API.</p>"
      };
    }
    const session = sessionPayload(account, requestOrigin);
    console.log(`[game-link] create player=${account.id} name=${account.name} link=${session.loginLink}`);
    return {
      status: 200,
      html: `<h1>\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0441\u043e\u0437\u0434\u0430\u043d</h1>
<p>\u041d\u0438\u043a: <b>${escapeHtml(account.name)}</b></p>
<p>\u0421\u0442\u0430\u0440\u0442: \u0443\u0440\u043e\u0432\u0435\u043d\u044c ${account.level}, \u043c\u043e\u043d\u0435\u0442\u044b ${account.money}, \u043e\u043f\u044b\u0442 ${account.exp}</p>
<p>\u0418\u0433\u0440\u043e\u0432\u0430\u044f \u0441\u0441\u044b\u043b\u043a\u0430:</p>
<p><code>${escapeHtml(session.loginLink)}</code></p>
<p>SessionAuth:</p>
<p><code>${escapeHtml(session.sessionAuth)}</code></p>
<p>\u0412 \u043a\u043b\u0438\u0435\u043d\u0442\u0435 \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0432\u0445\u043e\u0434 \u0447\u0435\u0440\u0435\u0437 \u043f\u043e\u043b\u043d\u0443\u044e \u0441\u0441\u044b\u043b\u043a\u0443 \u0438\u043b\u0438 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u0443\u044e \u0441\u0441\u044b\u043b\u043a\u0443, \u0432\u0441\u0442\u0430\u0432\u044c\u0442\u0435 \u044d\u0442\u0443 \u0441\u0441\u044b\u043b\u043a\u0443 \u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 "\u0412\u043e\u0439\u0442\u0438".</p>`
    };
  }

  return {
    status: 200,
    html: `<h1>\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430 Contra City</h1>
<form method="GET" action="/create">
  <label>\u041a\u043e\u0434<br><input name="code" value="${escapeHtml(code)}" style="width:320px"></label><br><br>
  <label>\u041d\u0438\u043a<br><input name="name" value="ContraCity" maxlength="24" style="width:320px"></label><br><br>
  <button type="submit">\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442</button>
</form>`
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tryServeAssetBundle(req, res, url) {
  const rawPath = decodeURIComponent(url.pathname || "/").replace(/^\/+/, "");
  if (!rawPath.toLowerCase().startsWith("assetbundles/") && !rawPath.toLowerCase().endsWith(".unity3d")) {
    return false;
  }

  const fileName = path.basename(rawPath);
  if (!fileName || fileName.includes("..") || !fileName.toLowerCase().endsWith(".unity3d")) {
    sendJson(res, { ok: false, error: "invalid_asset_bundle" }, 400);
    return true;
  }

  if (!ASSET_BUNDLE_NAMES.has(fileName.toLowerCase())) {
    sendJson(res, { ok: false, error: "asset_bundle_not_allowed", file: fileName }, 404);
    return true;
  }

  const filePath = path.join(ASSET_BUNDLE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, { ok: false, error: "asset_bundle_not_found", file: fileName }, 404);
    return true;
  }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": "no-store, no-cache, must-revalidate",
    "pragma": "no-cache",
    "expires": "0"
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartForm(raw, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = match?.[1] || match?.[2] || "";
  if (!boundary) return new URLSearchParams();
  const text = raw.toString("utf8");
  const result = new URLSearchParams();
  for (const part of text.split(`--${boundary}`)) {
    if (!part || part === "--" || part === "--\r\n") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (!nameMatch) continue;
    let value = part.slice(headerEnd + 4);
    value = value.replace(/\r\n--$/, "").replace(/\r\n$/, "");
    result.set(nameMatch[1], value);
  }
  return result;
}

async function mergeAjaxBodyParams(req, url) {
  if (req.method !== "POST") return url;
  const raw = await readRawBody(req, 512 * 1024);
  if (!raw.length) return url;
  const contentType = String(req.headers["content-type"] || "");
  let params = new URLSearchParams();
  if (contentType.includes("multipart/form-data")) {
    params = parseMultipartForm(raw, contentType);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(raw.toString("utf8"));
  } else {
    params = new URLSearchParams(raw.toString("utf8"));
  }
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  return url;
}

function tryServeClanArm(req, res, url) {
  if (!url.pathname.startsWith("/clan-arm/") || !url.pathname.endsWith(".png")) return false;
  const armId = normalizeClanArmId(url.pathname.match(/\/clan-arm\/(\d+)\.png$/)?.[1]);
  const filePath = clanArmAssetPath(armId);
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end("clan arm not found");
    return true;
  }
  const png = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": "image/png",
    "content-length": String(png.length),
    "cache-control": "no-store"
  });
  res.end(png);
  return true;
}

function asBattleJson(value) {
  if (value && typeof value === "object") return value;
  return {};
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function eventNumber(event, details, key, fallback = 0) {
  return statNumber(event?.[key] ?? details?.[key], fallback);
}

function battleEventPlayerName(event, details, playerId, fallbackName = "") {
  const id = Number(playerId || 0);
  const currentId = Number(event?.playerId || 0);
  const killerId = Number(event?.killerPlayerId || details?.killerPlayerId || 0);
  const victimId = Number(event?.victimPlayerId || details?.victimPlayerId || 0);
  const playerData = asBattleJson(event?.playerData);
  const candidates = [
    id === currentId ? event?.playerName : "",
    id === killerId ? (event?.killerPlayerName || details?.killerPlayerName) : "",
    id === victimId ? (event?.victimPlayerName || details?.victimPlayerName) : "",
    id === currentId ? (playerData.name || playerData.n || playerData.un) : "",
    fallbackName
  ];
  const name = candidates.map((value) => String(value || "").trim()).find(Boolean);
  return cleanName(name || `Player ${id || 1}`);
}

function battleEventPlayerKey(event, details, playerId, account = null) {
  const id = Number(playerId || 0);
  if (account && Number(account.id) === id) return account.key;
  const currentId = Number(event?.playerId || 0);
  if (id === currentId) {
    const key = String(event?.playerAuthKey || event?.playerKey || event?.cckey || "").trim();
    if (key) return key.slice(0, 128);
  }
  const detailsKey = String(details?.playerAuthKey || details?.playerKey || "").trim();
  return (detailsKey || `battle-player-${id}`).slice(0, 128);
}

async function upsertBattleEventPlayer(client, event, details, playerId, account = null) {
  const id = Number(playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return;

  const isAccount = account && Number(account.id) === id;
  const name = battleEventPlayerName(event, details, id, isAccount ? account.name : "");
  const cckey = battleEventPlayerKey(event, details, id, isAccount ? account : null);
  const level = isAccount ? statNumber(account.level, START_LEVEL) : statNumber(event.playerLevel ?? details.playerLevel, START_LEVEL);
  const exp = isAccount ? statNumber(account.exp, START_EXP) : statNumber(event.playerExp ?? details.playerExp, START_EXP);
  const expState = levelStateForExp(exp, level);
  const money = isAccount ? statNumber(account.money, START_MONEY) : 0;

  await client.query(
    `INSERT INTO players (id, cckey, name, full_name, level, exp, exp_min, exp_max, money, view, weap, taun, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       cckey = CASE
         WHEN players.cckey LIKE 'battle-player-%' AND EXCLUDED.cckey NOT LIKE 'battle-player-%' THEN EXCLUDED.cckey
         ELSE players.cckey
       END,
       name = CASE
         WHEN players.name LIKE 'Player %' AND EXCLUDED.name <> '' THEN EXCLUDED.name
         ELSE players.name
       END,
       full_name = CASE
         WHEN players.full_name LIKE 'Player %' AND EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
         ELSE players.full_name
       END,
       level = GREATEST(players.level, EXCLUDED.level),
       exp = GREATEST(players.exp, EXCLUDED.exp),
       exp_min = GREATEST(players.exp_min, EXCLUDED.exp_min),
       exp_max = GREATEST(players.exp_max, EXCLUDED.exp_max),
       updated_at = now()`,
    [id, cckey, name, name, expState.level, expState.exp, expState.expMin, expState.expMax, money]
  );
}

async function incrementPlayerStats(client, playerId, delta, maxValues = {}) {
  const id = Number(playerId || 0);
  if (!Number.isInteger(id) || id <= 0) return;

  const row = await client.query("SELECT stats FROM players WHERE id = $1 FOR UPDATE", [id]);
  if (!row.rows[0]) return;

  const nextStats = normalizePlayerStats(jsonValue(row.rows[0].stats, {}));
  for (const [key, value] of Object.entries(delta || {})) {
    if (!playerStatKeys.includes(key)) continue;
    nextStats[key] = statNumber(nextStats[key], 0) + statNumber(value, 0);
  }
  for (const [key, value] of Object.entries(maxValues || {})) {
    if (!playerStatKeys.includes(key)) continue;
    nextStats[key] = Math.max(statNumber(nextStats[key], 0), statNumber(value, 0));
  }

  await client.query(
    "UPDATE players SET stats = $2::jsonb, updated_at = now() WHERE id = $1",
    [id, JSON.stringify(nextStats)]
  );
}

async function incrementWeaponStats(client, playerId, event, details, delta) {
  const id = Number(playerId || 0);
  const weaponId = Number(event.weaponId ?? details.weaponId ?? event.weaponType ?? details.weaponType ?? 0);
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(weaponId) || weaponId <= 0) return;

  const weaponType = Number(event.weaponType ?? details.weaponType ?? 0);
  const systemName = String(event.weaponSystemName || details.weaponSystemName || details.systemName || "").slice(0, 120);
  const kills = statNumber(delta.kills, 0);
  const headshots = statNumber(delta.headshots, 0);
  const nuts = statNumber(delta.nuts, 0);
  const shots = statNumber(delta.shots, 0);
  const hits = statNumber(delta.hits, 0);

  if (!kills && !headshots && !nuts && !shots && !hits) return;

  await client.query(
    `INSERT INTO player_weapon_stats (player_id, weapon_id, weapon_type, system_name, kills, headshots, nuts, shots, hits, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (player_id, weapon_id) DO UPDATE SET
       weapon_type = CASE WHEN EXCLUDED.weapon_type <> 0 THEN EXCLUDED.weapon_type ELSE player_weapon_stats.weapon_type END,
       system_name = CASE WHEN EXCLUDED.system_name <> '' THEN EXCLUDED.system_name ELSE player_weapon_stats.system_name END,
       kills = player_weapon_stats.kills + EXCLUDED.kills,
       headshots = player_weapon_stats.headshots + EXCLUDED.headshots,
       nuts = player_weapon_stats.nuts + EXCLUDED.nuts,
       shots = player_weapon_stats.shots + EXCLUDED.shots,
       hits = player_weapon_stats.hits + EXCLUDED.hits,
       updated_at = now()`,
    [id, Math.trunc(weaponId), statNumber(weaponType, 0), systemName, kills, headshots, nuts, shots, hits]
  );
}

async function recordStatEvent(client, roomId, event, type, playerId, mapName, mode, details) {
  if (type === "shot") {
    const shots = eventNumber(event, details, "shots", 0);
    const hits = eventNumber(event, details, "hits", 0);
    await incrementPlayerStats(client, playerId, { sh: shots, hi: hits });
    await incrementWeaponStats(client, playerId, event, details, { shots, hits });
    return;
  }

  if (type === "death" || type === "score") {
    const killerPlayerId = Number(event.killerPlayerId || details.killerPlayerId || playerId || 0);
    const victimPlayerId = Number(event.victimPlayerId || details.victimPlayerId || playerId || 0);
    const hitZone = Number(event.hitZone ?? details.hitZone ?? 0);
    const headshot = hitZone === 32 ? 1 : 0;
    const nuts = hitZone === 16 ? 1 : 0;
    const suicide = killerPlayerId > 0 && killerPlayerId === victimPlayerId;
    const expAwarded = eventNumber(event, details, "expAwarded", 0);
    const domination = eventNumber(event, details, "domination", 0);
    const revenge = eventNumber(event, details, "revenge", 0);
    const dominationStreak = eventNumber(event, details, "dominationStreak", 0);
    const revengeStreak = eventNumber(event, details, "revengeStreak", 0);
    details.domination = domination;
    details.revenge = revenge;
    details.dominationStreak = dominationStreak;
    details.revengeStreak = revengeStreak;

    if (victimPlayerId > 0) {
      await incrementPlayerStats(client, victimPlayerId, {
        d: 1,
        s: suicide ? 1 : 0,
        dhs: headshot,
        dns: nuts
      });
    }
    if (!suicide && killerPlayerId > 0) {
      await incrementPlayerStats(client, killerPlayerId, {
        k: 1,
        hs: headshot,
        ns: nuts,
        do: domination,
        re: revenge
      }, {
        mdo: dominationStreak,
        mre: revengeStreak
      });
      await incrementWeaponStats(client, killerPlayerId, event, details, {
        kills: 1,
        headshots: headshot,
        nuts
      });
      if (expAwarded > 0) {
        const expResult = await awardPlayerExperience(client, killerPlayerId, expAwarded);
        if (expResult) {
          details.expAwarded = expAwarded;
          details.expResult = expResult;
        }
        const clan = playerClanRecord(killerPlayerId);
        const member = clan?.members?.[String(killerPlayerId)];
        const exp2clan = eventNumber(event, details, "exp2clan", 0) || Math.round(expAwarded * Number(member?.expKoef || 0) / 100);
        if (exp2clan > 0) {
          const clanExpResult = await awardClanExperience(client, killerPlayerId, exp2clan);
          if (clanExpResult) {
            details.exp2clan = exp2clan;
            details.clanExpResult = clanExpResult;
          }
        }
      }
    }

    await client.query(
      `INSERT INTO battle_score_events (room_id, killer_player_id, victim_player_id, weapon_id, hit_zone, event_data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [roomId, killerPlayerId || playerId, victimPlayerId || playerId, Number(event.weaponId || details.weaponId || event.weaponType || details.weaponType || 0), hitZone, JSON.stringify(details)]
    );
    return;
  }

  if (type === "summary") {
    const playTimeMinutes = eventNumber(event, details, "playTimeMinutes", 0);
    const kills = eventNumber(event, details, "kills", 0);
    const deaths = eventNumber(event, details, "deaths", 0);
    const headshots = eventNumber(event, details, "headshots", 0);
    const hasWon = hasOwn(event, "won") || hasOwn(details, "won");
    const won = Boolean(event.won ?? details.won);
    const statDelta = { pt: playTimeMinutes };
    if (hasWon) statDelta[won ? "w" : "l"] = 1;
    await incrementPlayerStats(client, playerId, statDelta);

    if (playTimeMinutes > 0 || kills > 0 || deaths > 0 || headshots > 0 || hasWon) {
      await client.query(
        `INSERT INTO player_match_stats (player_id, map_name, mode, kills, deaths, headshots, play_time, won)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [playerId, mapName, mode, kills, deaths, headshots, playTimeMinutes, hasWon ? won : false]
      );
    }
  }
}

async function recordBattleEvent(event) {
  const account = ensureDesktopAccount();
  if (!pgPool) {
    return { ok: true, storage: "json-file", skipped: "postgres_disabled" };
  }

  const roomName = String(event.roomName || event.room || "restore-room").slice(0, 80);
  const mapName = String(event.mapName || event.map || "Arena_3lvl").slice(0, 80);
  const mode = normalizeStatsMode(event.mode || 2);
  const maxPlayers = Number(event.maxPlayers || 8);
  const playerId = Number(event.playerId || account.id || 1);
  const actorId = Number(event.actorId || 1);
  const team = Number(event.team ?? -1);
  const health = Number(event.health ?? 100);
  const energy = Number(event.energy ?? 100);
  const serverHost = String(event.serverHost || BATTLE_HOST || "").slice(0, 128);
  const serverPort = Number(event.serverPort || 5055);
  const roomSettings = JSON.stringify(asBattleJson(event.roomSettings));
  const playerData = JSON.stringify(asBattleJson(event.playerData));
  const transform = JSON.stringify(asBattleJson(event.transform));
  const details = asBattleJson(event.eventData);
  const type = String(event.type || "event");

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await upsertBattleEventPlayer(client, event, details, account.id, account);
    await upsertBattleEventPlayer(client, event, details, playerId, Number(playerId) === Number(account.id) ? account : null);
    if (type === "death" || type === "score") {
      await upsertBattleEventPlayer(client, event, details, Number(event.killerPlayerId || details.killerPlayerId || 0));
      await upsertBattleEventPlayer(client, event, details, Number(event.victimPlayerId || details.victimPlayerId || 0));
    }

    const room = await client.query(
      `INSERT INTO battle_rooms (
         room_name, map_name, mode, max_players, friendly_fire, status, host_player_id,
         server_host, server_port, room_settings, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
       ON CONFLICT (room_name) DO UPDATE SET
         map_name = EXCLUDED.map_name,
         mode = EXCLUDED.mode,
         max_players = EXCLUDED.max_players,
         friendly_fire = EXCLUDED.friendly_fire,
         status = EXCLUDED.status,
         host_player_id = EXCLUDED.host_player_id,
         server_host = EXCLUDED.server_host,
         server_port = EXCLUDED.server_port,
         room_settings = EXCLUDED.room_settings,
         updated_at = now()
       RETURNING id`,
      [roomName, mapName, mode, maxPlayers, Boolean(event.friendlyFire), type === "leave" ? "closed" : "running", playerId, serverHost, serverPort, roomSettings]
    );

    const roomId = room.rows[0].id;
    await client.query(
      `INSERT INTO battle_room_players (
         room_id, player_id, actor_id, team, health, energy, ping, connected, player_data, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       ON CONFLICT (room_id, player_id) DO UPDATE SET
         actor_id = EXCLUDED.actor_id,
         team = EXCLUDED.team,
         health = EXCLUDED.health,
         energy = EXCLUDED.energy,
         ping = EXCLUDED.ping,
         connected = EXCLUDED.connected,
         player_data = EXCLUDED.player_data,
         updated_at = now()`,
      [roomId, playerId, actorId, team, health, energy, Number(event.ping || 0), type !== "leave", playerData]
    );

    if (type === "spawn") {
      await client.query(
        `INSERT INTO battle_spawn_events (room_id, player_id, actor_id, team, health, energy, transform)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [roomId, playerId, actorId, team, health, energy, transform]
      );
    } else if (type === "chat" && event.message) {
      await client.query(
        `INSERT INTO battle_chat_events (room_id, player_id, actor_id, channel, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [roomId, playerId, actorId, Number(event.channel || 0), String(event.message).slice(0, 500)]
      );
    }

    await recordStatEvent(client, roomId, event, type, playerId, mapName, mode, details);

    const achievements = [];
    const achievementPlayerIds = new Set();
    if (type === "death" || type === "score") {
      const killerPlayerId = Number(event.killerPlayerId || details.killerPlayerId || playerId || 0);
      const victimPlayerId = Number(event.victimPlayerId || details.victimPlayerId || 0);
      if (killerPlayerId > 0 && killerPlayerId !== victimPlayerId) achievementPlayerIds.add(killerPlayerId);
    } else if (type === "summary") {
      achievementPlayerIds.add(playerId);
    }
    for (const achievementPlayerId of achievementPlayerIds) {
      achievements.push(...await syncPostgresAchievements(client, achievementPlayerId));
    }

    await client.query("COMMIT");
    return { ok: true, storage: "postgres", roomId, type, achievements };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

ensureDesktopAccount();

const server = http.createServer(async (req, res) => {
  if (Buffer.byteLength(req.url || "", "utf8") > MAX_REQUEST_URL_BYTES) {
    sendJson(res, { ok: false, error: "uri_too_long" }, 414);
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (!allowHttpRequest(req, url.pathname)) {
    sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
    return;
  }
  const requestOrigin = requestPublicOrigin(req, url);

  if (url.pathname === "/" || url.pathname === "/auth") {
    sendHtml(res, "<h1>Contra City legacy API</h1><p>API online.</p>");
    return;
  }

  if (tryServeAssetBundle(req, res, url)) {
    return;
  }

  if (tryServeClanArm(req, res, url)) {
    return;
  }

  if (url.pathname === "/" || url.pathname === "/auth") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    const link = loginLink(account, requestOrigin);
    sendHtml(
      res,
      `<h1>Contra City legacy API</h1>
<p>API СЂР°Р±РѕС‚Р°РµС‚.</p>
<p>РҐСЂР°РЅРёР»РёС‰Рµ: <b>${pgPool ? "PostgreSQL" : "JSON fallback"}</b></p>
<p>РЎРѕР·РґР°С‚СЊ/СЃР±СЂРѕСЃРёС‚СЊ Р°РєРєР°СѓРЅС‚: <a href="/create?code=${encodeURIComponent(CREATE_CODE)}">/create</a></p>
<p>РўРµРєСѓС‰РёР№ Р°РєРєР°СѓРЅС‚: ${escapeHtml(account.name)}, СѓСЂРѕРІРµРЅСЊ ${account.level}, РјРѕРЅРµС‚С‹ ${account.money}</p>
<p>РЎСЃС‹Р»РєР° РґР»СЏ РІС…РѕРґР°: <code>${escapeHtml(link)}</code></p>`
    );
    return;
  }

  if (url.pathname === "/launcher-device/challenge") {
    if (req.method !== "POST") {
      sendJson(res, { result: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const account = await accountFromLauncherDeviceBody(body, url);
      if (!account) {
        sendJson(res, { result: false, error: "invalid_session" }, 403);
        return;
      }
      const device = await loadLauncherDevice(account.id);
      const deviceKeyId = normalizeLauncherDeviceKeyId(body?.deviceKeyId);
      if (!device || !deviceKeyId || device.deviceKeyId !== deviceKeyId) {
        sendJson(res, { result: false, error: "device_signature_required" }, 403);
        return;
      }
      const challenge = createLauncherDeviceChallenge(account, deviceKeyId);
      sendJson(res, { result: true, ...challenge });
    } catch (error) {
      sendJson(res, { result: false, error: error.message || "device_challenge_failed" }, 500);
    }
    return;
  }

  if (url.pathname === "/admin/device-reset") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    if (!hasValidAdminToken(req)) {
      sendJson(res, { ok: false, error: "not_found" }, 404);
      return;
    }
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const ccid = Number(body?.ccid || body?.playerId || 0);
      if (!Number.isInteger(ccid) || ccid <= 0) {
        sendJson(res, { ok: false, error: "invalid_ccid" }, 400);
        return;
      }
      const removed = await resetLauncherDeviceBinding(ccid);
      console.log(`[launcher-device] admin reset player=${ccid} removed=${removed}`);
      sendJson(res, { ok: true, ccid, removed });
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "device_reset_failed" }, 500);
    }
    return;
  }

  if (url.pathname === "/launcher-state") {
    let body = {};
    if (req.method === "POST") {
      try {
        body = await readJsonBody(req, 32 * 1024);
      } catch (error) {
        sendJson(res, { result: false, error: error.message || "invalid_json", news: launcherNewsPayload() }, 400);
        return;
      }
    }

    const account = req.method === "POST"
      ? await accountFromLauncherDeviceBody(body, url)
      : await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "invalid_session", news: launcherNewsPayload() }, 403);
      return;
    }

    let deviceAccess;
    try {
      deviceAccess = await verifyLauncherDeviceAccess(account, body, req);
    } catch (error) {
      console.error("[launcher-device] access check failed", error);
      sendJson(res, { result: false, error: "device_binding_failed", news: launcherNewsPayload() }, 500);
      return;
    }
    if (!deviceAccess.ok) {
      sendJson(res, { result: false, error: deviceAccess.error, news: launcherNewsPayload() }, deviceAccess.status || 403);
      return;
    }

    sendJson(res, launcherStatePayload(account), 200, { "Set-Cookie": cookieHeaders(account) });
    return;
  }

  if (url.pathname === "/launcher-session") {
    const account = await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "invalid_session" }, 403);
      return;
    }

    const launcherSession = createLauncherSession(account);
    sendJson(res, {
      result: true,
      ccid: account.id,
      cckey: account.key,
      sessionAuth: sessionAuth(account),
      token: launcherSession.token,
      expiresInSeconds: launcherSession.expiresInSeconds
    }, 200, { "Set-Cookie": cookieHeaders(account) });
    return;
  }

  if (url.pathname === "/session") {
    const account = await loginAccountFromUrl(url);
    if (!account) {
      sendJson(res, { result: false, error: "invalid_session" }, 403);
      return;
    }
    sendJson(res, {
      result: true,
      ...sessionPayload(account, requestOrigin)
    });
    return;
  }

  if (url.pathname === "/vk-login" || url.pathname === "/login-link") {
    const account = await loginAccountFromUrl(url);
    if (!account) {
      sendHtml(res, "<h1>Contra City login</h1><p>РЎСЃС‹Р»РєР° РІС…РѕРґР° РЅРµРґРµР№СЃС‚РІРёС‚РµР»СЊРЅР°.</p>", 403);
      return;
    }
    sendHtml(
      res,
      `<h1>Contra City login</h1><p>РЎСЃС‹Р»РєР° Р°РєС‚РёРІРЅР° РґР»СЏ ${escapeHtml(account.name)} (#${account.id}).</p>`,
      200,
      { "Set-Cookie": cookieHeaders(account) }
    );
    return;
  }

  if (url.pathname === "/create") {
    const result = await createAccountPage(url, requestOrigin);
    sendHtml(res, result.html, result.status);
    return;
  }

  if (url.pathname.endsWith("/ajax.php")) {
    await mergeAjaxBodyParams(req, url);
    const account = await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "1" }, 403);
      return;
    }
    sendJson(res, await routeAjax(url, account, requestOrigin), 200, { "Set-Cookie": cookieHeaders(account) });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, { ok: true, build: API_BUILD_ID, storage: pgPool ? "postgres" : "json-file" });
    return;
  }

  if (url.pathname === "/battle/social") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 128 * 1024);
      if (!hasValidBattleServiceToken(req, body)) {
        sendJson(res, { ok: false, error: "invalid_token" }, 403);
        return;
      }
      const result = await battleSocialRequest(body);
      sendJson(res, result, result.status || (result.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "battle_social_failed" }, 500);
    }
    return;
  }

  if (url.pathname === "/battle/event") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 256 * 1024);
      if (!hasValidBattleServiceToken(req, body)) {
        sendJson(res, { ok: false, error: "invalid_token" }, 403);
        return;
      }
      const result = await recordBattleEvent(body);
      sendJson(res, result, result.status || (result.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "battle_event_failed" }, 500);
    }
    return;
  }

  if (url.pathname === "/db") {
    if (!hasValidAdminToken(req)) {
      sendJson(res, { ok: false, error: "not_found" }, 404);
      return;
    }
    sendJson(res, {
      ok: true,
      storage: pgPool ? "postgres" : "json-file",
      schema: pgPool
        ? "players/player_inventory/player_abilities/player_equipment/purchase_history/player_weapon_stats/player_achievements/player_match_stats/clans/clan_members/player_friends/catalog_items/battle_rooms/battle_room_players/battle_spawn_events/battle_score_events/battle_chat_events"
        : "accounts-json",
      accounts: Object.keys(store.accounts).length,
      databaseUrlConfigured: Boolean(DATABASE_URL)
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Contra City legacy API listening on ${PORT} build=${API_BUILD_ID}`);
  if (!BATTLE_EVENT_TOKEN) console.warn("[security] BATTLE_EVENT_TOKEN is missing; battle service endpoints reject all calls");
  if (!ADMIN_API_TOKEN) console.warn("[security] ADMIN_API_TOKEN is missing; /db is disabled");
  if (!CREATE_CODE) console.warn("[security] CREATE_CODE is not set; /create account creation is disabled.");
  if (CREATE_CODE === "CONTRA-REVIVE-2026") console.warn("[security] CREATE_CODE still uses the public fallback; rotate it");
  if (DEFAULT_KEY === "contra-revive-key") console.warn("[security] DEFAULT_KEY still uses the public fallback; rotate it");
});
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(HTTP_HEADERS_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS);
server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.maxHeadersCount = 64;
server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});


