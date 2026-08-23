import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { URL, fileURLToPath } from "node:url";
import { createAdminLogsApi } from "./admin-logs/admin-api.js";
import { touchPlayerActivity, writeAuditEvent } from "./admin-logs/audit-store.js";
import { CLAN_ENHANCER_PRICES, PLAYER_ENHANCER_PRICES, TAUNT_PRICES } from "./shop-prices.js";
import {
  executeBattleStaffAction,
  legacyPermissionPayload,
  loadActiveStaffRole,
  staffAjaxPayload,
  staffProfilePayload,
} from "./staff-system.js";
import {
  SUMMER_CASE_REWARDS,
  TROPICAL_CASE_REWARDS,
  rollSummerCaseReward,
  rollTropicalCaseReward,
} from "./case-loot.js";

const PORT = Number(process.env.PORT || 3000);
const API_BUILD_ID = "railway-api-2026-08-24-promzona-current-v88";
const CREATE_CODE = process.env.CREATE_CODE || "";
const DEFAULT_KEY = process.env.DEFAULT_KEY || "contra-revive-key";
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data", "accounts.json");
const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSET_BUNDLE_DIR = path.join(API_DIR, "assetbundles");
const LAUNCHER_RELEASE_DIR = path.join(API_DIR, "launcher-releases");
const ASSET_BUNDLE_NAMES = new Set([
  "arena_3lvl.unity3d",
  "zombi_2.unity3d",
  "zombi.unity3d",
  "arenaring.unity3d",
  "bit_map.unity3d",
  "legoturnament.unity3d",
  "inferno.unity3d",
  "promzona.unity3d"
  //"dashguard.unity3d"
]);
const REMOTE_ASSET_BUNDLE_URLS = new Map([
  [
    "promzona.unity3d",
    "https://media.githubusercontent.com/media/aidargersemov-prog/contra-city-api/2ebca6247262a05512339d46b914ab60f08cfc29/railway-api/assetbundles/promzona.unity3d"
  ]
]);
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");
const DATABASE_URL = process.env.DATABASE_URL || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://dii1ba1dxl2lq.cloudfront.net").replace(/\/+$/, "");
const ALLOW_DYNAMIC_PUBLIC_ORIGIN = process.env.ALLOW_DYNAMIC_PUBLIC_ORIGIN === "1";
const SUMMER_CASE_ACCESS_TTL_MS = 10 * 60 * 1000;
const BATTLE_PASS_XP_PER_LEVEL = 1000;
const BATTLE_PASS_TASK_CYCLE_MS = 24 * 60 * 60 * 1000;

const START_MONEY = Number(process.env.START_MONEY || 1000);
const START_LEVEL = Number(process.env.START_LEVEL || 1);
const START_EXP = Number(process.env.START_EXP || 0);
const START_EXP_MAX = Number(process.env.START_EXP_MAX || 1000);
const LEVEL_EXP_STEP = Math.max(1, Number(process.env.LEVEL_EXP_STEP || START_EXP_MAX || 1000));
// Базовая цена одежды и fallback-каталога. Цены насмешек и усилителей
// настраиваются независимо в shop-prices.js.
const SHOP_PRICE = 100;
const RETIRED_BATTLE_HOST = "54.145.212.225";
const DEFAULT_BATTLE_HOST = "3.76.0.237";
const CONFIGURED_BATTLE_HOST = String(process.env.BATTLE_HOST || "").trim();
const BATTLE_HOST = !CONFIGURED_BATTLE_HOST || CONFIGURED_BATTLE_HOST === RETIRED_BATTLE_HOST
  ? DEFAULT_BATTLE_HOST
  : CONFIGURED_BATTLE_HOST;
const BATTLE_NAME = process.env.BATTLE_NAME || "Contra City";
const BATTLE_EVENT_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const PROMO_ADMIN_TOKEN = process.env.PROMO_ADMIN_TOKEN || "";
const TELEGRAM_LINK_API_TOKEN = process.env.TELEGRAM_LINK_API_TOKEN || "";
const TELEGRAM_ADMIN_ID = Number(process.env.TELEGRAM_ADMIN_ID || 1656163678);
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "ContraCityGame_Bot")
  .trim()
  .replace(/^@/, "");
const CLOUDFRONT_ORIGIN_SECRET = process.env.CLOUDFRONT_ORIGIN_SECRET || "";
const CLOUDFRONT_ORIGIN_HEADER = String(process.env.CLOUDFRONT_ORIGIN_HEADER || "x-contra-origin").toLowerCase();
const ORIGIN_GUARD_MODE = ["off", "audit", "enforce"].includes(String(process.env.ORIGIN_GUARD_MODE || "").toLowerCase())
  ? String(process.env.ORIGIN_GUARD_MODE).toLowerCase()
  : (CLOUDFRONT_ORIGIN_SECRET ? "enforce" : "audit");
const MAX_REQUEST_URL_BYTES = Math.max(1024, Number(process.env.MAX_REQUEST_URL_BYTES || 16384));
const HTTP_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 15000));
const HTTP_HEADERS_TIMEOUT_MS = Math.max(5000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 10000));
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Math.max(1000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 5000));
const RATE_LIMIT_WINDOW_MS = Math.max(250, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const RATE_LIMIT_REQUESTS = Math.max(1, Number(process.env.RATE_LIMIT_REQUESTS || 600));
const BATTLE_RATE_LIMIT_REQUESTS = Math.max(1, Number(process.env.BATTLE_RATE_LIMIT_REQUESTS || 60000));
const ACCOUNT_RATE_LIMIT_REQUESTS = Math.max(1, Number(process.env.ACCOUNT_RATE_LIMIT_REQUESTS || 1200));
const SESSION_RATE_LIMIT_REQUESTS = Math.max(1, Number(process.env.SESSION_RATE_LIMIT_REQUESTS || 900));
const DEVICE_RATE_LIMIT_REQUESTS = Math.max(1, Number(process.env.DEVICE_RATE_LIMIT_REQUESTS || 900));
const RATE_LIMIT_BUCKET_CAP = Math.max(128, Number(process.env.RATE_LIMIT_BUCKET_CAP || 8192));
const MAX_HTTP_IN_FLIGHT = Math.max(1, Number(process.env.MAX_HTTP_IN_FLIGHT || 256));
const MAX_HTTP_IN_FLIGHT_PER_IP = Math.max(1, Number(process.env.MAX_HTTP_IN_FLIGHT_PER_IP || 32));
const MAX_HTTP_CONNECTIONS = Math.max(16, Number(process.env.MAX_HTTP_CONNECTIONS || 512));
const POSTGRES_POOL_MAX = Math.max(1, Number(process.env.POSTGRES_POOL_MAX || 10));
const POSTGRES_CONNECT_TIMEOUT_MS = Math.max(250, Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 3000));
const POSTGRES_IDLE_TIMEOUT_MS = Math.max(1000, Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 10000));
const POSTGRES_QUERY_TIMEOUT_MS = Math.max(250, Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 5000));
const POSTGRES_MIGRATION_TIMEOUT_MS = Math.max(5000, Number(process.env.POSTGRES_MIGRATION_TIMEOUT_MS || 60000));
const POSTGRES_MUTATION_QUEUE_MAX = Math.max(1, Number(process.env.POSTGRES_MUTATION_QUEUE_MAX || 256));
const rateLimitBuckets = new Map();
const httpInFlightByIp = new Map();
let httpInFlight = 0;
let postgresMutationQueueDepth = 0;
let originGuardAuditWindowStartedAt = 0;
let originGuardAuditCount = 0;
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
const TELEGRAM_LINK_FLOW_TTL_MS = Math.max(120000, Math.min(
  30 * 60 * 1000,
  Number(process.env.TELEGRAM_LINK_FLOW_TTL_MS || 10 * 60 * 1000)
));
const TELEGRAM_PAIRING_CODE_TTL_MS = Math.max(120000, Math.min(
  30 * 60 * 1000,
  Number(process.env.TELEGRAM_PAIRING_CODE_TTL_MS || 10 * 60 * 1000)
));
const TELEGRAM_LOGIN_REQUEST_TTL_MS = Math.max(120000, Math.min(
  30 * 60 * 1000,
  Number(process.env.TELEGRAM_LOGIN_REQUEST_TTL_MS || 15 * 60 * 1000)
));
const TELEGRAM_RESET_CONFIRM_TTL_MS = Math.max(30000, Math.min(
  5 * 60 * 1000,
  Number(process.env.TELEGRAM_RESET_CONFIRM_TTL_MS || 60 * 1000)
));
const DONATE_ORDER_TTL_MS = Math.max(5 * 60 * 1000, Math.min(
  60 * 60 * 1000,
  Number(process.env.DONATE_ORDER_TTL_MS || 20 * 60 * 1000)
));
const TELEGRAM_CLEANUP_INTERVAL_MS = Math.max(60000, Number(
  process.env.TELEGRAM_CLEANUP_INTERVAL_MS || 5 * 60 * 1000
));
const TELEGRAM_PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TELEGRAM_CLEANUP_ADVISORY_LOCK = 741963521;
const TELEGRAM_RESET_ADVISORY_LOCK = 741963522;
const launcherSessions = new Map();
const launcherDeviceChallenges = new Map();
const revokedGameLinkKeys = new Map();
const gameLoginSeen = new Map();
const GAME_LOGIN_DEDUPE_TTL_MS = Math.max(60000, Number(process.env.GAME_LOGIN_DEDUPE_TTL_MS || 30 * 60 * 1000));
const playerBanCache = new Map();
const PLAYER_BAN_CACHE_TTL_MS = Math.max(1000, Number(process.env.PLAYER_BAN_CACHE_TTL_MS || 15000));
const requestAuditContext = new AsyncLocalStorage();

function currentAuditContext() {
  return requestAuditContext.getStore() || {};
}

async function auditGameEvent(db, event) {
  if (!db?.query) return null;
  const context = currentAuditContext();
  return writeAuditEvent(db, {
    ipAddress: context.ipAddress || "",
    device: context.device || "",
    geo: context.geo || {},
    source: context.source || "game_api",
    ...event
  });
}

async function recordPlayerAccess(account, req, kind, source) {
  if (!pgPool || !account?.id) return;
  const ipAddress = requestClientIp(req);
  const geo = requestGeo(req);
  const device = String(req.headers["user-agent"] || "").slice(0, 300);
  try {
    const previousResult = await pgPool.query(
      `SELECT last_ip_address, last_device, last_geo
       FROM player_activity
       WHERE player_id = $1`,
      [Number(account.id)]
    );
    const previous = previousResult.rows[0] || null;
    const ipChanged = Boolean(previous?.last_ip_address && ipAddress && previous.last_ip_address !== ipAddress);
    const deviceChanged = Boolean(previous?.last_device && device && previous.last_device !== device);
    const previousCountry = String(previous?.last_geo?.countryCode || "");
    const countryChanged = Boolean(previousCountry && geo.countryCode && previousCountry !== geo.countryCode);
    await touchPlayerActivity(pgPool, { playerId: account.id, kind, ipAddress, device, source, geo });
    await writeAuditEvent(pgPool, {
      playerId: account.id,
      eventType: kind === "logout" ? "player_logout" : "player_login",
      category: "session",
      severity: kind !== "logout" && (countryChanged || deviceChanged) ? "notice" : "info",
      suspicious: kind !== "logout" && (countryChanged || deviceChanged),
      description: kind === "logout" ? "Игрок вышел" : "Игрок вошёл",
      source,
      ipAddress,
      device,
      geo,
      metadata: {
        accessSource: source,
        geoSource: geo.source || "socket",
        ipChanged,
        deviceChanged,
        countryChanged,
        previousIpAddress: ipChanged ? previous.last_ip_address : "",
        previousCountryCode: countryChanged ? previousCountry : "",
      }
    });
  } catch (error) {
    console.error(`[admin-logs] player access audit failed player=${account.id} kind=${kind}`, error);
  }
}

function safeTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hasValidCloudFrontOrigin(req) {
  return Boolean(CLOUDFRONT_ORIGIN_SECRET) &&
    safeTokenEquals(req?.headers?.[CLOUDFRONT_ORIGIN_HEADER], CLOUDFRONT_ORIGIN_SECRET);
}

async function recordGameLoginOnce(account, req) {
  if (!account?.id) return;
  const now = Date.now();
  const ip = requestClientIp(req);
  const deviceKey = stableIdentityHash(req.headers["user-agent"] || "unknown");
  const key = `${account.id}:${ip}:${deviceKey}`;
  const previous = Number(gameLoginSeen.get(key) || 0);
  if (now - previous < GAME_LOGIN_DEDUPE_TTL_MS) return;
  if (gameLoginSeen.has(key)) gameLoginSeen.delete(key);
  gameLoginSeen.set(key, now);
  while (gameLoginSeen.size > 10000) gameLoginSeen.delete(gameLoginSeen.keys().next().value);
  await recordPlayerAccess(account, req, "login", "game_api_login");
}

function decodeCloudFrontHeader(value, maxLength = 160) {
  const raw = String(value || "").slice(0, maxLength * 3);
  try {
    return decodeURIComponent(raw).slice(0, maxLength);
  } catch {
    return raw.slice(0, maxLength);
  }
}

function addressWithoutPort(value) {
  const address = String(value || "").trim().slice(0, 160);
  if (!address || address.length > 160) return "";
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    return end > 1 ? address.slice(1, end) : "";
  }
  const colon = address.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(address.slice(colon + 1))) return address.slice(0, colon);
  return address.toLowerCase();
}

function cloudFrontViewerIp(req) {
  if (!hasValidCloudFrontOrigin(req)) return "";
  return addressWithoutPort(req.headers["cloudfront-viewer-address"]);
}

function requestClientIp(req) {
  // CloudFront-Viewer-Address is generated by CloudFront. X-Forwarded-For is
  // intentionally ignored because a viewer-controlled prefix survives proxying.
  return cloudFrontViewerIp(req) || req.socket?.remoteAddress || "unknown";
}

function launcherRequestIp(req) {
  const trustedCloudFrontIp = cloudFrontViewerIp(req);
  if (trustedCloudFrontIp) return trustedCloudFrontIp;

  // Launcher requests are already authenticated by the device ECDSA key. In
  // audit mode we still consume CloudFront's generated viewer address so IP
  // re-verification works while the origin secret is being restored.
  const forwardedCloudFrontIp = addressWithoutPort(req.headers["cloudfront-viewer-address"]);
  if (forwardedCloudFrontIp) return forwardedCloudFrontIp;

  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((part) => addressWithoutPort(part))
    .find(Boolean);
  return forwarded || addressWithoutPort(req.socket?.remoteAddress) || "unknown";
}

function launcherIpHash(req) {
  if (!TELEGRAM_LINK_API_TOKEN) return "";
  return crypto
    .createHmac("sha256", TELEGRAM_LINK_API_TOKEN)
    .update(launcherRequestIp(req), "utf8")
    .digest("hex");
}

function requestGeo(req) {
  const trusted = hasValidCloudFrontOrigin(req);
  return {
    ip: requestClientIp(req),
    source: trusted && req.headers["cloudfront-viewer-address"] ? "cloudfront" : "socket",
    countryCode: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-country"], 8) : "",
    country: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-country-name"], 120) : "",
    regionCode: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-country-region"], 32) : "",
    region: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-country-region-name"], 120) : "",
    city: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-city"], 120) : "",
    postalCode: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-postal-code"], 32) : "",
    timeZone: trusted ? decodeCloudFrontHeader(req.headers["cloudfront-viewer-time-zone"], 80) : "",
    asn: trusted ? Number(req.headers["cloudfront-viewer-asn"] || 0) || 0 : 0,
  };
}

function isOriginGuardExempt(pathname) {
  return pathname === "/health" ||
    pathname === "/donate/catalog" ||
    pathname.startsWith("/battle/") ||
    pathname.startsWith("/admin/promocodes") ||
    pathname.startsWith("/bot/telegram") ||
    pathname === "/launcher/promo/redeem" ||
    pathname === "/admin/device-reset" ||
    pathname === "/db";
}

function allowPlayerFacingOrigin(req, pathname) {
  if (ORIGIN_GUARD_MODE === "off" || isOriginGuardExempt(pathname) || hasValidCloudFrontOrigin(req)) return true;
  if (ORIGIN_GUARD_MODE === "audit") {
    const now = Date.now();
    if (!originGuardAuditWindowStartedAt || now - originGuardAuditWindowStartedAt >= 60000) {
      if (originGuardAuditCount > 0) {
        console.warn(`[security] origin guard audit suppressed=${originGuardAuditCount} previousWindowMs=${now - originGuardAuditWindowStartedAt}`);
      }
      originGuardAuditWindowStartedAt = now;
      originGuardAuditCount = 0;
      console.warn(`[security] origin guard audit path=${pathname} remote=${req.socket?.remoteAddress || "unknown"}`);
    } else {
      originGuardAuditCount += 1;
    }
    return true;
  }
  return false;
}

function requestRatePolicy(pathname) {
  if (pathname === "/create") return { windowMs: 10 * 60 * 1000, limit: 10 };
  if (pathname === "/battle-pass/case/open" || pathname === "/battle-pass/case/resolve") {
    return { windowMs: 60000, limit: 120 };
  }
  if (pathname === "/admin/logs/auth/login") return { windowMs: 15 * 60 * 1000, limit: 20 };
  if (pathname.startsWith("/admin/promocodes")) return { windowMs: 60000, limit: 120 };
  if (pathname.startsWith("/bot/telegram")) {
    // Every private bot request originates from the same Railway container.
    // The service token is the perimeter; per-Telegram limits are enforced
    // after parsing the authenticated request body.
    return { windowMs: 60000, limit: 2400 };
  }
  if (pathname.startsWith("/launcher/telegram/")) {
    // Do not let players behind the same carrier/NAT block each other.
    // Account/session/device limits and the persisted five-attempt gate are
    // the effective launcher boundaries.
    return { windowMs: 60000, limit: 1200 };
  }
  if (pathname === "/launcher/promo/redeem") return { windowMs: 60000, limit: 20 };
  // Both endpoints are called by the single battle VPS for all online players.
  // Keep the service token as the real authorization boundary and avoid throttling
  // legitimate aggregate battle/social traffic.
  if (pathname === "/battle/event" || pathname === "/battle/security" || pathname === "/battle/social" || pathname === "/battle/clan-events" || pathname === "/battle/admin/action") {
    return { windowMs: 60000, limit: BATTLE_RATE_LIMIT_REQUESTS };
  }
  if (pathname === "/launcher-session" || pathname === "/launcher-device/challenge" || pathname === "/session" || pathname === "/vk-login") {
    return { windowMs: 60000, limit: 120 };
  }
  return { windowMs: RATE_LIMIT_WINDOW_MS, limit: RATE_LIMIT_REQUESTS };
}

function boundedRateBucket(key, policy, now) {
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= policy.windowMs) {
    bucket = { startedAt: now, count: 0, lastSeenAt: now };
  }
  bucket.count += 1;
  bucket.lastSeenAt = now;
  if (rateLimitBuckets.has(key)) rateLimitBuckets.delete(key);
  rateLimitBuckets.set(key, bucket);
  while (rateLimitBuckets.size > RATE_LIMIT_BUCKET_CAP) {
    rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
  }
  return bucket.count <= policy.limit;
}

function stableIdentityHash(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function requestRateIdentities(req, url) {
  const accountId = Number(url.searchParams.get("ccid") || url.searchParams.get("playerId") || url.searchParams.get("userId") || 0);
  const session = url.searchParams.get("sessionAuth") || url.searchParams.get("token") || req.headers["x-session-token"] || "";
  const device = req.headers["x-device-key-id"] || req.headers["x-launcher-device"] || url.searchParams.get("deviceKeyId") || "";
  return {
    account: Number.isInteger(accountId) && accountId > 0 ? String(accountId) : "",
    session: stableIdentityHash(session),
    device: stableIdentityHash(device),
  };
}

function allowRequestIdentityBucket(req, key, policy, now = Date.now()) {
  if (!key) return true;
  if (!(req.securityRateKeys instanceof Set)) req.securityRateKeys = new Set();
  if (req.securityRateKeys.has(key)) return true;
  req.securityRateKeys.add(key);
  return boundedRateBucket(key, policy, now);
}

function allowResolvedIdentityRequest(req, account, body = {}) {
  const now = Date.now();
  const accountId = Number(account?.id || body?.ccid || body?.playerId || 0);
  const session = stableIdentityHash(body?.token || body?.sessionToken || body?.sessionAuth || "");
  const device = stableIdentityHash(body?.deviceKeyId || body?.launcherDevice || "");
  if (Number.isInteger(accountId) && accountId > 0 && !allowRequestIdentityBucket(req, `account:${accountId}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: ACCOUNT_RATE_LIMIT_REQUESTS }, now)) return false;
  if (session && !allowRequestIdentityBucket(req, `session:${session}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: SESSION_RATE_LIMIT_REQUESTS }, now)) return false;
  if (device && !allowRequestIdentityBucket(req, `device:${device}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: DEVICE_RATE_LIMIT_REQUESTS }, now)) return false;
  return true;
}

function allowTelegramIdentityRequest(req, telegramUserId, action, {
  windowMs = 60000,
  limit = 120
} = {}) {
  const id = Number(telegramUserId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return allowRequestIdentityBucket(
    req,
    `telegram:${id}:${String(action || "request")}`,
    { windowMs, limit },
    Date.now()
  );
}

function allowHttpRequest(req, url) {
  const now = Date.now();
  const pathname = url.pathname;
  const policy = requestRatePolicy(pathname);
  if (!boundedRateBucket(`ip:${requestClientIp(req)}|${pathname}`, policy, now)) return false;
  const identities = requestRateIdentities(req, url);
  if (identities.account && !allowRequestIdentityBucket(req, `account:${identities.account}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: ACCOUNT_RATE_LIMIT_REQUESTS }, now)) return false;
  if (identities.session && !allowRequestIdentityBucket(req, `session:${identities.session}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: SESSION_RATE_LIMIT_REQUESTS }, now)) return false;
  if (identities.device && !allowRequestIdentityBucket(req, `device:${identities.device}`, { windowMs: RATE_LIMIT_WINDOW_MS, limit: DEVICE_RATE_LIMIT_REQUESTS }, now)) return false;
  return true;
}

function hasValidBattleServiceToken(req, body) {
  const presented = req.headers["x-battle-token"] || body?.token || "";
  return Boolean(BATTLE_EVENT_TOKEN) && safeTokenEquals(presented, BATTLE_EVENT_TOKEN);
}

function hasValidAdminToken(req) {
  return Boolean(ADMIN_API_TOKEN) && safeTokenEquals(req.headers["x-admin-token"], ADMIN_API_TOKEN);
}

function hasValidPromoAdminToken(req) {
  return Boolean(PROMO_ADMIN_TOKEN) &&
    safeTokenEquals(req.headers["x-promo-admin-token"], PROMO_ADMIN_TOKEN);
}

function hasValidTelegramLinkApiToken(req) {
  return Boolean(TELEGRAM_LINK_API_TOKEN) &&
    safeTokenEquals(req.headers["x-telegram-link-token"], TELEGRAM_LINK_API_TOKEN);
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
// Enhancers 3 ("Лёгкое приземление") and 36 ("Меркурий") are deliberately
// hidden from the ordinary shop. Existing inventory rows are preserved, but
// new listing/buying is disabled and the battle server ignores both IDs.
const priceConfigIds = (config) => Object.freeze(Object.keys(config).map(Number));
const PLAYER_ENHANCER_IDS = priceConfigIds(PLAYER_ENHANCER_PRICES);
const CLAN_ENHANCER_IDS = priceConfigIds(CLAN_ENHANCER_PRICES);
const SHOP_ENHANCER_IDS = Object.freeze([...PLAYER_ENHANCER_IDS, ...CLAN_ENHANCER_IDS]);
const CLAN_ENHANCER_ID_SET = new Set(CLAN_ENHANCER_IDS);
const ENHANCER_PRICES = Object.freeze({
  ...PLAYER_ENHANCER_PRICES,
  ...CLAN_ENHANCER_PRICES
});

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

const TIMED_PRICE_FIELDS = Object.freeze([
  ["day", "t1v", "t1r", "t1p"],
  ["week", "t7v", "t7r", "t7p"],
  ["month", "t30v", "t30r", "t30p"]
]);

function timedCost(id, configuredPrices = 100) {
  const prices = typeof configuredPrices === "number"
    ? {
        day: configuredPrices,
        week: configuredPrices,
        month: configuredPrices
      }
    : configuredPrices;
  const result = { sc_id: String(id) };

  for (const [configKey, vcurKey, rcurrencyKey, pvpCurrencyKey] of TIMED_PRICE_FIELDS) {
    const value = prices?.[configKey];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Invalid timed shop price: sc_id=${id} duration=${configKey} value=${value}`);
    }
    result[vcurKey] = value;
    result[rcurrencyKey] = 0;
    result[pvpCurrencyKey] = 0;
  }

  return result;
}

const weaponTitleById = {
  1: "Бита",
  2: "Партизан",
  3: "Комрад-47",
  4: "Стаханов",
  5: "ВыньЧестер",
  6: "Аврора",
  7: "Компостер",
  10: "ГОСТ Бита",
  11: "ГОСТ Партизан",
  12: "ГОСТ Комрад-47",
  13: "ГОСТ Стаханов",
  14: "ГОСТ ВыньЧестер ",
  15: "ГОСТ Аврора ",
  16: "ГОСТ Компостер",
  17: "Лом",
  18: "Комиссар",
  19: "МММ-16",
  20: "Берия",
  21: "Егерь",
  22: "Мини Катюша",
  23: "Серп",
  24: "СверхДембель",
  25: "Примус",
  26: "Начальник",
  27: "Дружинник",
  28: "Политрук",
  29: "Кладенец",
  30: "Полкан",
  31: "Побарабанщик",
  32: "Рык",
  33: "Бюрократ",
  34: "Наводка",
  35: "Дальнобойщик",
  36: "Клык",
  37: "Дон",
  38: "Сибиряк",
  39: "ГОСТ Примус",
  40: "Светоч",
  41: "Самурай",
  42: "Косарь",
  43: "МЭЛС",
  44: "Гранатин",
  45: "Гадюка",
  46: "Павлик М.",
  47: "Вьюга",
  48: "Ледовик",
  50: "Писец",
  53: "Сокол",
  55: "Убойник",
  57: "Сторож",
  58: "Провокатор",
  59: "Троллебузина",
  60: "Засад",
  61: "Звездочет",
  62: "Смертобой",
  63: "Йож",
  64: "Репей",
  65: "Максимыч выкл.",
  66: "Максимыч",
  67: "Рой",
  68: "Спекулянт",
  69: "Пустынный Орел",
  70: "Крик",
  71: "Новогодняя Карамель",
  72: "Огненная Карамель",
  73: "Вождь",
  74: "Росомаха",
  75: "Шершень",
  76: "Большевик",
  77: "Вектор",
  78: "Буран",
  79: "Кобра",
  80: "Повстанец",
  92: "Ликвидатор",
  100: "Страж",
  101: "Адвокат",
  102: "Барс",
  103: "Анаконда",
  104: "Ворчун",
  105: "Скиф",
  106: "Кабан",
  107: "Вымпел",
  108: "Палач",
  109: "Советник",
  110: "Бастион"
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
    name: weaponTitleById[id] || `Оружие ${id}`,
    nlvl: 1,
    iS: 0,
    sc: cost(1000 + id, price),
    ...extra
  };
}

function wear(id, wt, sname, price = 50, slot = null, extra = {}) {
  const text = wearTextFor(slot, sname);

  return {
    itype: 3,
    id,
    w_id: id,
    wt,
    sname,
    sn: sname,
    nlvl: 1,
    iS: 0,
    sc: cost(2000 + id, price),
    ...text,
    ...extra
  };
}

function taunt(id, prices = 100) {
  return {
    itype: 4,
    t_id: id,
    sname: `taunt_${id}`,
    sn: `taunt_${id}`,
    nlvl: 1,
    iS: 1,
    sc: timedCost(3000 + id, prices)
  };
}

function isClanEnhancerId(id) {
  return CLAN_ENHANCER_ID_SET.has(Number(id));
}

function enhancer(id, prices = 120) {
  return {
    itype: 2,
    e_id: id,
    sname: `enhancer_${id}`,
    sn: `enhancer_${id}`,
    nlvl: 1,
    iS: 1,
    iC: isClanEnhancerId(id) ? 1 : 0,
    sc: timedCost(4000 + id, prices)
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
  //{ id: 10, slot: 1, sname: "ohca_basebalbat", name: "ГОСТ Бита", price: 100, stRa: 2, stDa: 2, ammo: 0, ammo_tot: 0, iS: 0 },
  { id: 72, slot: 1, sname: "ohca_candy", name: "Огненная Карамель", price: 900, stRa: 2, stDa: 4, ammo: 0, ammo_tot: 0, iS: 0, nlvl: 12 },
  { id: 71, slot: 1, sname: "ohca_candy2", name: "Новогодняя Карамель", price: 900, stRa: 2, stDa: 3, ammo: 0, ammo_tot: 0, iS: 0, nlvl: 12 },
  { id: 17, slot: 1, sname: "OHCA_Crowbar", name: "Лом", price: 450, stRa: 2, stDa: 3, ammo: 0, ammo_tot: 0, iS: 0, nlvl: 6 },
  { id: 42, slot: 1, sname: "THCA_Scythe_B", name: "Косарь", price: 600, stRa: 3, stDa: 3, ammo: 0, ammo_tot: 0, iS: 0, nlvl: 8 },


  { id: 108, slot: 2, sname: "hg_taurus", name: "Палач", price: 1900, stRa: 3, stDi: 3, stDa: 5, ammo: 6, ammo_tot: 38, iS: 0, nlvl: 40 },
  { id: 105, slot: 2, sname: "hg_usp", name: "Скиф", price: 1500, stRa: 3, stDi: 3, stDa: 3, ammo: 13, ammo_tot: 45, iS: 0 },
  { id: 69, slot: 2, sname: "HG_DesertB01", name: "Пустынный Орел", price: 1000, stRa: 2, stDi: 3, stDa: 5, ammo: 7, ammo_tot: 42, iS: 0, nlvl: 45 },
  { id: 53, slot: 2, sname: "HG_Desert", name: "Сокол", price: 1000, stRa: 3, stDi: 3, stDa: 4, ammo: 7, ammo_tot: 42, iS: 0, nlvl: 30 },
  { id: 68, slot: 2, sname: "HG_GlockB01_S", name: "Спекулянт", price: 1000, stRa: 5, stDi: 2, stDa: 3, ammo: 18, ammo_tot: 108, iS: 0, nlvl: 22 },

  { id: 101, slot: 3, sname: "mg_assaultrifle02", name: "Адвокат", price: 2200, stRa: 4, stDi: 4, stDa: 4, ammo: 35, ammo_tot: 175, iS: 0, nlvl: 50 },
  { id: 73, slot: 3, sname: "mg_ump45vkks_o", name: "Вождь", price: 2100, stRa: 4, stDi: 4, stDa: 5, ammo: 35, ammo_tot: 210, iS: 0 },
  { id: 76, slot: 3, sname: "MG_AUG1_O", name: "Большевик", price: 1000, stRa: 4, stDi: 4, stDa: 4, ammo: 30, ammo_tot: 180, iS: 0, nlvl: 40 },
  { id: 80, slot: 3, sname: "mg_aug5_o", name: "Повстанец", price: 2300, stRa: 5, stDa: 4, ammo: 30, ammo_tot: 132, iS: 0 },
  { id: 79, slot: 3, sname: "mg_aug4_o", name: "Кобра", price: 2300, stRa: 5, stDi: 4, stDa: 4, ammo: 30, ammo_tot: 168, iS: 0, nlvl: 28 },

  { id: 110, slot: 4, sname: "gg_fnmag", name: "Бастион", price: 2600, stRa: 5, stDi: 3, stDa: 5, ammo: 90, ammo_tot: 270, iS: 0 },
  { id: 67, slot: 4, sname: "gg_m134b03", name: "Рой", price: 2400, stRa: 5, stDi: 2, stDa: 4, ammo: 100, ammo_tot: 300, iS: 0, nlvl: 32 },

  { id: 109, slot: 5, sname: "sg_remington", name: "Советник", price: 2200, stRa: 2, stDi: 2, stDa: 5, ammo: 3, ammo_tot: 11, iS: 0 },
  { id: 106, slot: 5, sname: "sg_spas", name: "Кабан", price: 2100, stRa: 2, stDi: 3, stDa: 5, ammo: 5, ammo_tot: 24, iS: 0, nlvl: 38 },

  { id: 43, slot: 6, sname: "rl_m202a1", name: "МЭЛС", price: 2500, stRa: 2, stDi: 5, stDa: 5, ammo: 4, ammo_tot: 16, iS: 0, nlvl: 24 },
  { id: 44, slot: 6, sname: "gl_milkor", name: "Гранатин", price: 2000, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 30, iS: 0, nlvl: 20 },
  { id: 104, slot: 6, sname: "gl_grenadelauncher03", name: "Ворчун", price: 2300, stRa: 3, stDi: 4, stDa: 4, ammo: 3, ammo_tot: 18, iS: 0, nlvl: 45},
  { id: 59, slot: 6, sname: "rl_rpg7b02", name: "Троллебузина", price: 2600, stRa: 1, stDi: 5, stDa: 5, ammo: 1, ammo_tot: 9, iS: 0, nlvl: 15 },
  { id: 45, slot: 6, sname: "gl_milkor_a", name: "Гадюка", price: 2200, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 36, iS: 0, nlvl: 30 },

  { id: 107, slot: 7, sname: "sr_vintorez", name: "Вымпел", price: 2400, stRa: 4, stDi: 5, stDa: 4, ammo: 20, ammo_tot: 100, iS: 0, nlvl: 28 },
  { id: 103, slot: 7, sname: "sr_sniperrifle03", name: "Анаконда", price: 2300, stRa: 1, stDi: 5, stDa: 5, ammo: 5, ammo_tot: 35, iS: 0, nlvl: 40 },
  { id: 74, slot: 7, sname: "sr_wildcat1", name: "Росомаха", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16, iS: 0, nlvl: 30 },
  { id: 75, slot: 7, sname: "sr_wildcat2", name: "Шершень", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16, iS: 0, nlvl: 35 },
  { id: 50, slot: 7, sname: "sr_Arctic", name: "Писец", price: 1000, stRa: 2, stDi: 4, ammo: 6, ammo_tot: 9, iS: 0, nlvl: 11},
  { id: 23, slot: 7, sname: "sr_steyr", name: "Серп", price: 225, stRa: 2, stDi: 4, ammo: 1, ammo_tot: 4, iS: 0, nlvl: 4 },
  { id: 70, slot: 7, sname: "sr_arcticb01", name: "Крик", price: 1200, stRa: 3, stDi: 4, ammo: 1, ammo_tot: 12, iS: 0, nlvl: 14 }
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
  sr_wildcat2: 2333,
  sr_arcticb01: 2650,
  sr_steyr: 2333,
  sr_arctic: 2333,
  thca_scythe_b: 0
};

// Manual restore balance: no original damage table is available, so these
// values follow the recovered client formulas plus the gameplay hierarchy.
const canonicalShopWeaponStats = {
  ohca_candy: { rap: 330, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 10, ammo: 0, ammo_tot: 0, smindam: 20, smaxdam: 35, mmindam: 14, mmaxdam: 24, lmindam: 9, lmaxdam: 15 },
  ohca_candy2: { rap: 335, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 9, ammo: 0, ammo_tot: 0, smindam: 20, smaxdam: 35, mmindam: 13, mmaxdam: 24, lmindam: 9, lmaxdam: 16 },
  ohca_crowbar: { rap: 335, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 5, ammo: 0, ammo_tot: 0, smindam: 15, smaxdam: 22, mmindam: 10, mmaxdam: 19, lmindam: 5, lmaxdam: 8 },
  thca_scythe_b: { rap: 1111, rt: 0, lt: 250, vel: 100, rad: 8, ang: 0, dev: 2, krit: 12, ammo: 0, ammo_tot: 0, smindam: 34, smaxdam: 48, mmindam: 24, mmaxdam: 36, lmindam: 14, lmaxdam: 24 },
  
  hg_taurus: { rap: 460, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 6, krit: 10, ammo: 6, ammo_tot: 38, smindam: 28, smaxdam: 42, mmindam: 20, mmaxdam: 31, lmindam: 13, lmaxdam: 22 },
  hg_usp: { rap: 240, rt: 2667, lt: 520, vel: 100, rad: 10, ang: 0, dev: 5, krit: 9, ammo: 13, ammo_tot: 45, smindam: 22, smaxdam: 34, mmindam: 17, mmaxdam: 27, lmindam: 11, lmaxdam: 19 },
  hg_desertb01: { rap: 370, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 6, krit: 10, ammo: 7, ammo_tot: 42, smindam: 24, smaxdam: 37, mmindam: 20, mmaxdam: 29, lmindam: 12, lmaxdam: 19 },
  hg_desert: { rap: 370, rt: 2533, lt: 520, vel: 100, rad: 10, ang: 0, dev: 7, krit: 9, ammo: 7, ammo_tot: 42, smindam: 21, smaxdam: 31, mmindam: 14, mmaxdam: 21, lmindam: 11, lmaxdam: 21 },
  hg_glockb01_s: { rap: 150, rt: 2667, lt: 520, vel: 100, rad: 10, ang: 0, dev: 9, krit: 6, ammo: 18, ammo_tot: 108, smindam: 17, smaxdam: 25, mmindam: 12, mmaxdam: 19, lmindam: 9, lmaxdam: 16 },

  mg_assaultrifle02: { rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 9, krit: 6, ammo: 35, ammo_tot: 175, smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19 },
  mg_ump45vkks_o: { rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 6, krit: 8, ammo: 35, ammo_tot: 210, smindam: 29, smaxdam: 34, mmindam: 21, mmaxdam: 27, lmindam: 26, lmaxdam: 31 },
  mg_aug1_o: { desc: "Революционные технологии победы.", desca: "- Наносит периодический урон типа \"яд\"", rap: 145, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 9, krit: 6, ammo: 30, ammo_tot: 180, smindam: 18, smaxdam: 29, mmindam: 15, mmaxdam: 24, lmindam: 11, lmaxdam: 19 },
  mg_aug5_o: { rap: 135, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 8, krit: 8, ammo: 30, ammo_tot: 132, smindam: 21, smaxdam: 33, mmindam: 18, mmaxdam: 29, lmindam: 14, lmaxdam: 24 },
  mg_aug4_o: { rap: 130, rt: 3000, lt: 650, vel: 100, rad: 12, ang: 0, dev: 6, krit: 8, ammo: 30, ammo_tot: 168, smindam: 20, smaxdam: 32, mmindam: 17, mmaxdam: 28, lmindam: 13, lmaxdam: 23 },

  gg_fnmag: { rap: 125, rt: 4000, lt: 1100, vel: 100, rad: 14, ang: 0, dev: 14, krit: 6, ammo: 90, ammo_tot: 270, smindam: 17, smaxdam: 29, mmindam: 15, mmaxdam: 25, lmindam: 11, lmaxdam: 19 },
  gg_m134b03: { rap: 115, rt: 800, lt: 1100, vel: 100, rad: 14, ang: 0, dev: 20, krit: 4, ammo: 100, ammo_tot: 300, smindam: 15, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 10, lmaxdam: 17 },

  sg_remington: {
    desc: "Хороший или плохой советчик - решать вам.",
    desca: "- Наносит периодический урон типа \"кровотечение\"",
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
  sg_spas: { rap: 860, rt: 3500, lt: 900, vel: 100, rad: 18, ang: 0, dev: 22, krit: 8, ammo: 6, ammo_tot: 36, smindam: 48, smaxdam: 72, mmindam: 28, mmaxdam: 44, lmindam: 9, lmaxdam: 16 },

  rl_m202a1: {
    desc: "Карающая длань Четырех Вождей Красного Фронта.",
    desca: "Четырехзарядная ракетница",
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
  gl_milkor_a: { rap: 900, rt: 6667, lt: ARCING_LAUNCHER_LIFE, vel: ARCING_LAUNCHER_VELOCITY, rad: ARCING_LAUNCHER_DISTANCE, ang: 0, dev: 6, krit: 3, ammo: 6, ammo_tot: 36, smindam: 36, smaxdam: 56, mmindam: 55, mmaxdam: 68, lmindam: 56, lmaxdam: 75 },

  sr_vintorez: { rap: 700, rt: 3167, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 3, krit: 10, ammo: 20, ammo_tot: 100, smindam: 74, smaxdam: 98, mmindam: 78, mmaxdam: 104, lmindam: 90, lmaxdam: 124 },
  sr_sniperrifle03: { rap: 950, rt: 3667, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 14, ammo: 5, ammo_tot: 35, smindam: 100, smaxdam: 120, mmindam: 110, mmaxdam: 132, lmindam: 120, lmaxdam: 150 },
  sr_wildcat1: { rap: 980, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 12, ammo: 1, ammo_tot: 16, smindam: 72, smaxdam: 96, mmindam: 76, mmaxdam: 102, lmindam: 88, lmaxdam: 122 },
  sr_wildcat2: { rap: 980, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 11, ammo: 1, ammo_tot: 16, smindam: 70, smaxdam: 90, mmindam: 74, mmaxdam: 98, lmindam: 82, lmaxdam: 108 },
  sr_arcticb01: { rap: 1120, rt: 2650, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 11, ammo: 4, ammo_tot: 12, smindam: 68, smaxdam: 88, mmindam: 72, mmaxdam: 94, lmindam: 80, lmaxdam: 104 },
  sr_steyr: { rap: 1000, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 7, ammo: 1, ammo_tot: 4, smindam: 45, smaxdam: 55, mmindam: 60, mmaxdam: 70, lmindam: 77, lmaxdam: 98 },
  sr_arctic: { rap: 1000, rt: 2333, lt: 1000, vel: 100, rad: 10, ang: 0, dev: 2, krit: 9, ammo: 6, ammo_tot: 9, smindam: 60, smaxdam: 78, mmindam: 66, mmaxdam: 86, lmindam: 74, lmaxdam: 96 }
};

function withCanonicalShopWeaponStats(item) {
  const key = String(item?.sname || item?.sn || "").toLowerCase();
  const stats = canonicalShopWeaponStats[key] || {};
  const reloadTime = originalReloadTimeMs[key];
  return reloadTime === undefined ? { ...item, ...stats } : { ...item, ...stats, rt: reloadTime };
}

// The live weapon shop is the vetted resources.assets subset only.
const hiddenShopWeaponIds = new Set([10]); // ГОСТ Бита
const canonicalShopWeaponCatalog = rebuiltShopWeaponCatalog.map(withCanonicalShopWeaponStats);

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
    "shake",
    "nlvl",
    "iS"
  ]) {
    if (item[key] !== undefined) extra[key] = item[key];
  }
  return extra;
}

const canonicalShopWeapons = canonicalShopWeaponCatalog.map((item) =>
  weapon(item.id, weaponTypeForSname(item.sname), item.slot, item.sname, item.price ?? SHOP_PRICE, shopWeaponExtra(item))
);
const shopWeapons = canonicalShopWeapons.filter((item) => !hiddenShopWeaponIds.has(Number(item.w_id)));

function numericField(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function scaledStat(value, multiplier, fallback = 0) {
  return Math.max(0, Math.round(numericField(value, fallback) * multiplier));
}

const workshopPriceOverrides = Object.freeze({
  73: 25,  // Вождь
  75: 15,  // Шершень
  80: 25,  // Повстанец
  104: 25, // Ворчун
  105: 25, // Скиф
  107: 25, // Вымпел
  108: 30, // Палач
  109: 15  // Советник
});

const workshopAmmoOverrides = Object.freeze({
  80: Object.freeze({ ammo: 35, ammo_tot: 206 }),   // Повстанец
  104: Object.freeze({ ammo: 5, ammo_tot: 14 }),    // Ворчун
  105: Object.freeze({ ammo: 16, ammo_tot: 48 }),   // Скиф
  107: Object.freeze({ ammo: 8, ammo_tot: 41 }),    // Вымпел
  109: Object.freeze({ ammo: 3, ammo_tot: 17 })     // Советник
});

function stableWorkshopPrice(weaponId) {
  const id = Math.max(0, Math.trunc(numericField(weaponId, 0)));
  return workshopPriceOverrides[id] ?? (10 + ((id * 17 + 11) % 31));
}

const workshopUpgradeTextFallbacks = {
  10: "Повышенный шанс крит. урона",
  43: "Увеличенный общий боезапас",
  44: "Увеличенный урон\nУвеличенная длительность замедления\nУвеличенный общий боезапас",
  45: "Увеличенный общий боезапас\nУвеличенный урон",
  53: "Увеличенный урон на средней и дальней дист.\nПовышает скорость передвижения\nУвеличенный общий боезапас\nУскоренная перезарядка",
  59: "Увеличенный общий боезапас\nУвеличенный шанс крит. урона",
  67: "Увеличенный урон на всех дист.\nУвеличенный шанс крит. урона",
  68: "Повышает скорость передвижения\nУвеличенный общий боезапас\nНаносит периодический урон типа кровотечение",
  69: "Увеличенный урон на средней и дальней дист.\nПовышает скорость передвижения\nУвеличенный общий боезапас",
  71: "Повышенный шанс крит. урона\nУвеличенный радиус поражения",
  72: "Повышенный шанс крит. урона\nУвеличенный урон",
  73: "Повышенный шанс крит. урона\nУвеличенный общий боезапас\nПовышает скорость передвижения",
  74: "Повышенный шанс крит. урона\nУвеличенный боезапас\nПовышает скорость передвижения",
  75: "Повышенный шанс крит. урона\nУвеличенный боезапас\nПовышает скорость передвижения",
  76: "Ускоренная перезарядка\nУвеличенные скорость передвижения и боезапас\nБолее продолжительный урон от яда",
  79: "Повышенный шанс крит. урона\nУвеличенный общий боезапас\nУвеличивает скорость передвижения",
  80: "Повышенный шанс крит. урона\nУвеличивает скорость передвижения\nУвеличенная обойма и боезапас\nУвеличенный урон от огня",
  101: "Увеличенный урон на средней и дальней дистанции\nУвеличивает скорость передвижения\nУвеличенная обойма и боезапас\nУскоренная перезарядка",
  103: "Повышенный шанс крит. урона\nУвеличенный боезапас\nУвеличенный урон на средней и дальней дистанции",
  104: "Повышенный шанс крит. урона\nУвеличенная обойма\nВремя поражения огнем увеличено",
  105: "Повышенный шанс крит. урона\nУвеличенная обойма и общий боезапас\nУвеличивает скорость передвижения\nНаносит периодический урон типа яд",
  106: "Повышенный шанс крит. урона\nУвеличенный урон на ближней и средней дистанции\nУвеличенный общий боезапас\nУвеличенный радиус поражения",
  107: "Повышенный шанс крит. урона\nУвеличенная обойма и общий боезапас\nУвеличивает скорость передвижения",
  108: "Повышенный шанс крит. урона\nУвеличенный общий боезапас\nУвеличенная скорострельность\nУвеличенный урон на средней дистанции",
  109: "Повышенный шанс крит. урона\nУвеличенный общий боезапас\nУвеличивает скорость передвижения\nУвеличенный урон на ближней дистанции\nУвеличенный урон типа кровотечение",
  110: "Повышенный шанс крит. урона\nУвеличенная обойма и общий боезапас\nУвеличивает скорость передвижения"
};

function workshopUpgradeContract(weaponId) {
  const text = String(
    wearTextTranslations.get(`w_${weaponId}_descupgrade`)
    || workshopUpgradeTextFallbacks[weaponId]
    || ""
  ).toLowerCase();
  const damageAll = /увеличен(?:ный|ная|ное|ные|нный)\s+урон(?:\s+на\s+всех\s+дист|\s+на\s+всех\s+дистанц)?(?:\.|$|\n)/m.test(text)
    && !/урон\s+от|урон\s+типа/.test(text);
  const damageShort = damageAll || /урон\s+на\s+ближн/.test(text);
  const damageMedium = damageAll || /урон\s+на\s+(?:средн|ближней\s+и\s+средн)/.test(text);
  const damageLong = damageAll || /урон\s+на\s+(?:дальн|средн.*и\s+дальн|ближн.*и\s+дальн)/.test(text);
  const impactType = /тип[а]?\s*[\"«]?огонь|урон\s+от\s+огн|горени|поражения\s+огнем/.test(text) ? "fire"
    : (/тип[а]?\s*[\"«]?кров|кровотеч/.test(text) ? "blood"
      : (/тип[а]?\s*[\"«]?яд|урон\s+от\s+яда/.test(text) ? "poison"
        : (/замороз|замедлен/.test(text) ? "frost" : "")));
  return {
    text,
    damageShort,
    damageMedium,
    damageLong,
    crit: /крит/.test(text),
    magazine: /обойм/.test(text),
    reserve: /боезапас/.test(text),
    rapidity: /скорострель|скорость\s+атаки/.test(text),
    accuracy: /кучност|разброс/.test(text),
    reload: /перезаряд/.test(text),
    radius: /радиус\s+поражения/.test(text),
    speed: /скорост[ьи]\s+передвижения/.test(text),
    impactType,
    impactDamage: /урон\s+от\s+(?:огня|яда|замороз)|урон\s+типа|урон\s+от\s+горени|длительность\s+и\s+урон/.test(text),
    impactDuration: /длительн|продолжительн|время\s+поражения/.test(text)
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
    sc: timedCost(5000 + weaponId, stableWorkshopPrice(weaponId)),
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
  const ammoOverride = workshopAmmoOverrides[weaponId];
  if (ammoOverride) {
    upgraded.ammo = ammoOverride.ammo;
    upgraded.ammo_tot = ammoOverride.ammo_tot;
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
  "Hats:biker": wearText("Скулкеп", "Чтобы пугать снайпера, смотрящего в прицел.", "+5% защита от снайперок\n+5% защита от пистолетов\n+10% защита от огнеметов"),
  "Shirts:biker": wearText("Байкер", "Для летящих вдаль странников.", "+10% защита от оружия ближнего боя\n+5% защита от снайперок\n+20% защита от дробовиков\n+5% защита от пистолетов\n+20 к броне"),
  "Pants:jeansB02": wearText("Келвины", "Стильно смотрятся на железном коне.", "+5% защита от пистолетов\n+10% защита от дробовиков\n+25% защита от огнеметов\n+5% защита от оружия ближнего боя"),
  "Gloves:biker": wearText("Железохук", "Реально свалить даже бизона.", "+5% защита от пулеметов\n+2% защита от автоматов\n+5% защита от пистолетов\n+5% защита от оружия ближнего боя"),
  "Boots:sneakV201": wearText("Чопкроссы", "С ними можно затормозить байк одной лишь ногой.", "+5% защита от оружия ближнего боя\n+10% защита от пистолетов\n+8% к скорости\nБольшой бонус к прыжку после выстрела из дробовика"),

  "Hats:business": wearText("Шляпа Дона Корлеоне", "Ты просишь контрабаксы, но делаешь это без уважения.", "+3% защита от автоматов\n+5% защита от пистолетов\n+1% к здоровью"),
  "Masks:businessgoogles": wearText("Скайфолы", "Те самые очки Джеймса Бонда.", "+5% защита от пулеметов\n+5% защита от пистолетов\n+6% защита от дробовиков"),
  "Shirts:business": wearText("Смокинговский", "Смокинг для агентов Контра Сити.", "+7% защита от пистолетов\n+15% защита от автоматов\n+20 к броне\n+3% к здоровью"),
  "Pants:business": wearText("Бондобрюки", "Слишком деловой скилл.", "+10% защита от автоматов\n+5% защита от пулеметов\n+5% защита от ракетниц"),
  "Gloves:business": wearText("Перчатки Гудини", "Много секретов и отмычек хранят эти перчатки.", "+2% защита от дробовиков\n+5% защита от пистолетов\n+5% защита от оружия ближнего боя"),
  "Boots:business": wearText("Подпольники", "", "+5% защита от снайперок\n+3% защита от пистолетов\n+2% защита от дробовиков\nБольшой бонус к прыжку после выстрела из дробовика"),
  "Boots:boot02": wearText("Танжеры", "Идеальны для жарких спецопераций.", "+3% защита от пистолетов\n+3% к скорости\nБольшой бонус к прыжку после выстрела из дробовика"),
  "Boots:sneakV2B03": wearText("Крикеты", "Специально для элитной игры на траве.", "+2% защита от автоматов\n+1% к скорости передвижения"),
  "Boots:sneakV2B04": wearText("Дуплекскроссы", "Для безопасного преодоления программных ловушек.", "+3% защита от автоматов\n+1% к скорости"),
  "Boots:anarch": wearText("Кедоны", "Для свежего контраста с пыльной дорогой.", "Большой бонус к прыжку после выстрела из дробовика\n+5% к скорости"),
  "Boots:zadira": wearText("Кростильники", "Можно даже наподдать, пока не видит директор.", "+4% защита от автоматов\n+2% защита от оружия ближнего боя\n+1% к скорости\nБольшой бонус к прыжку после выстрела из дробовика"),
  "Boots:prizrak": wearText("Бесшуберцы", "Очень тихая поступь обеспечена.", "+1% защита от снайперок\n+3% к скорости\nБольшой бонус к прыжку после выстрела из дробовика"),

  "Hats:stalker": wearText("Капюшонка", "Укрывает от дождя вражеских пуль.", "+5% защита от снайперок\n+5% защита от дробовиков\n+2% к здоровью"),
  "Masks:stalkergasmask": wearText("Антирад", "Секретная разработка федерации.", "+5% защита от снайперок\n+5% защита от ракетниц\n+1% к здоровью"),
  "Shirts:stalker": wearText("Разрушитель", "Артефакт прямиком из Чернобыля.", "+15% защита от снайперок\n+4% защита от автоматов\n+5% защита от огнеметов\n+20 к броне"),
  "Pants:stalker": wearText("Милитарники", "Кевларовые штаны. Не только греют, но и защищают.", "+15% защита от снайперок\n+10% защита от дробовиков\n+5% защита от огнеметов"),
  "Gloves:stalker": wearText("Нитриловые перчи", "Защита от любого вида лезвия.", "+4% защита от автоматов\n+5% защита от пистолетов\n+5% защита от дробовиков"),
  "Boots:stalker": wearText("Странники", "", "+10% защита от ракетниц\n+10% защита от огнеметов\n+2% к скорости\nБольшой бонус к прыжку после выстрела из дробовика"),

  "Heads:thanos": wearText("Камень Старцева", "Данный камень испытывает голод, который можно уталить только душами поверженных врагов.", "+9% защита от автоматов\n+5% защита от пистолетов\n+8% защита от ракетниц\n+3% к здоровью"),
  "Masks:thanos": wearText("Камень Кудряшова", "Полная власть над временем - можно увидеть все возможные исходы битвы.", "+5% защита от оружия ближнего боя\n+7% защита от ракетниц\n+5% защита от дробовиков\n+20% защита от снайперки Анаконда"),
  "Shirts:thanos": wearText("Камень Легендарного", "Камень, который позволяет читать мысли и овладевать разумом соперников.", "+10% защита от автоматов\n+10% защита от ракетниц\n+10% защита от гранатометов\n+4% к здоровью"),
  "Pants:thanos": wearText("Камень Комиссара", "Оглянись вокруг - ты и вправду думаешь, что все это реально?", "+9% защита от автоматов\n+15% защита от оружия ближнего боя\n+5% защита от пистолетов\n+10% защита от ракетницы Троллебузина"),
  "Gloves:thanos": wearText("Перчатка Зонга", "Одним щелчком ты можешь превратить половину своих врагов в прах.", "+10% защита от оружия ближнего боя\n+15% защита от снайперок\n+10% защита от ракетниц\n+20 к броне"),
  "Boots:thanos": wearText("Камень Андроита", "Придает силы любому оружию, взятому в руки.", "+5% защита от пулеметов\n+5% защита от пистолетов\n+10% защита от гранатометов\nБольшой бонус к прыжку после выстрела из дробовика"),
  "Backpacks:thanos": wearText("Камень Зната", "Враг даже не подозревает, что ты уже стоишь у него за спиной.", "+10% защита от пулеметов\n+15% защита от оружия ближнего боя\n+10% защита от снайперок\n+15% защита от гранатомета Гранатин")
};

const BLUE_SOLDIER_SLIP99_SHOTGUN_JUMP_BONUS = "+40% к прыжку после выстрела из дробовика";

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
  Hats: ["hat01", "hat02", "hat03", "cap01", "cap02", "vietnam", "indiana02", "pharaoh", "tophat", "beret01", "beret02", "beret03", "beret04", "tactichelm01", "tactichelm02", "milcap01", "milcap02", "milcap03", "Witchhat", "Jacklantern", "santa", "santa2", "Olympic", "capVKKS01", "capVKKS02", "capVKKS03", "tacticalB01", "capB04", "capB08", "hatB08", "capB06", "capB05", "infernal", "hatB01", "capB07", "capB01", "avenger", "hatB06", "biker", "business", "stalker", "ushanka2", "capgavaimag"],
  Masks: ["goog01", "goog02", "goog03", "mask01", "band01", "band02", "band03", "klava01", "klava02", "klava03", "mummy_H", "bandB08", "skeleton_H", "gasmask01", "gasmask02", "aviaglass", "santa", "santa2", "SnowGoggles", "maskB01", "bandB03", "bandB07", "googB01", "googB03", "infernal_H", "franky", "maskB02", "bandB05", "bandB01", "googB02", "avenger", "bandB04", "klavaB01", "businessgoogles", "stalkergasmask", "thanos", "gavaibandana"],
  Gloves: ["glov01", "bint01", "bint02", "clock01", "clock02", "glov02", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "Olympic", "tacticalB01", "infernal", "franky", "wristwrapB03", "avenger", "prizrak", "biker", "business", "stalker", "thanos", "glov022", "gavaigloves"],
  Shirts: ["armor01", "armor02", "armor03", "armor04", "hood01", "hood02", "hood03", "hood04", "hood05", "jack01", "singl05", "singl06", "jack02", "jack03", "shirt01", "shirt02", "shirt03", "shirt04", "singl01", "singl04", "shirtB08", "chood01", "chood02", "chood03", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "hoodOlimpic", "hoodZong", "tacticB01", "hoodB03", "hoodB08", "hoodB10", "shirtB09", "shirtB04", "infernal", "franky", "hoodB05", "hoodB01", "hoodB04", "anarch", "avenger", "hoodB06", "prizrak", "biker", "business", "stalker", "thanos", "trooper2", "gavaihoodie"],
  Pants: ["sport01", "sport02", "sport03", "sport04", "short01", "short02", "short03", "short04", "short05", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "Olympic", "sportVKKS01", "sportVKKS02", "sportVKKS03", "tacticB01", "sportB03", "sportB08", "sportB10", "shortB12", "shortB14", "infernal", "franky", "sportB05", "sportB01", "sportB04", "jeansB03", "avenger", "sportB06", "prizrak", "jeansB02", "business", "stalker", "thanos", "pant032", "shortigavai"],
  Boots: ["boot01", "bear", "boot02", "slip01", "sneak01", "sneak02", "sneakV201", "sneakV202", "sneakV203", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "sneakOlimpic", "tacticalB01", "sneakV2B05", "sneakV2B02", "sneakV2B06", "sneakV2B07", "sneakV2B03", "infernal", "franky", "sneakV2B04", "sneakV2B10", "anarch", "avenger", "zadira", "prizrak", "business", "stalker", "thanos", "slip99", "gavaibootsmag"],
  Backpacks: ["parr01", "back01", "back02", "guit01", "guit02", "turt01", "octopus", "arrows", "darts", "rocket01", "rocket02", "rec", "shield", "extinguisher", "sarcophagus", "tomb", "Morte", "Raven", "Scarecrow", "santa", "santa2", "Snowboard", "VampireBat", "infernalRaven", "frankyOctopus", "snake01", "thanos", "rec2", "popugagavai"],
  Others: ["maz", "icecream01", "icecream02", "icecream03", "cola01", "cola02", "cola03", "skrab", "coins", "santa", "santa2", "medal", "medalgold", "medalsilver", "medalbronze", "smertik", "badboy", "infernal", "franky", "newyearball", "schelkunchik", "spingreen", "spinyellow", "spinblue", "burger", "teeth", "spider", "vodka"],
  Heads: ["bald01", "bald02", "black01", "black02", "black03", "black04", "blond01", "blond02", "blond03", "brown01", "brown02", "brown03", "brown04", "spec01", "spec02", "spec03", "spec04", "franky", "thanos", "spec99"]
};
const wearPrices = {
  //biker
  "Shirts:biker": { price: 1200, nlvl: 25, iS: 0 },
  "Pants:jeansB02": { price: 550, nlvl: 25, iS: 0 }, 
  "Hats:biker": { price: 250, nlvl: 25, iS: 0 },
  "Gloves:biker": { price: 900, nlvl: 25, iS: 0 },
  "Boots:sneakV201": { price: 600, nlvl: 25, iS: 0 },
  //mummy
  "Hats:pharaoh": { price: 300, nlvl: 20, iS: 0 },
  "Shirts:mummy": { price: 300, nlvl: 20, iS: 0 },
  "Backpacks:sarcophagus": { price: 99999, nlvl: 999, iS: 0 },
  "Gloves:mummy": { price: 150, nlvl: 20, iS: 0 },
  "Pants:mummy": { price: 275, nlvl: 20, iS: 0 },
  "Boots:mummy": { price: 150, nlvl: 20, iS: 0 },
  "Masks:mummy_H": { price: 300, nlvl: 20, iS: 0 },
  "Others:skrab": { price: 99999, nlvl: 999, iS: 0 },
  //dead moroz
  "Hats:santa": { price: 300, nlvl: 14, iS: 0 },
  "Masks:santa": { price: 300, nlvl: 14, iS: 0 },
  "Shirts:santa": { price: 200, nlvl: 14, iS: 0 },
  "Backpacks:santa": { price: 400, nlvl: 14, iS: 0 },
  "Gloves:santa": { price: 350, nlvl: 14, iS: 0 },
  "Pants:santa": { price: 200, nlvl: 14, iS: 0 },
  "Boots:santa": { price: 350, nlvl: 14, iS: 0 },
  "Others:santa": { price: 300, nlvl: 14, iS: 0 },
  //zaxvatchik
  "Shirts:tactic03": { price: 950, nlvl: 31, iS: 0 },
  "Pants:tactic03": { price: 780, nlvl: 31, iS: 0 },
  "Boots:boot02": { price: 390, nlvl: 31, iS: 0 },
  "Masks:googB02": { price: 690, nlvl: 31, iS: 0 },
  "Hats:beret01": { price: 720, nlvl: 31, iS: 0 },
  //delta
  "Hats:tacticalB01": { price: 600, nlvl: 40, iS: 0 },
  "Shirts:tacticB01": { price: 925, nlvl: 40, iS: 0 },
  "Pants:tacticB01": { price: 700, nlvl: 40, iS: 0 },
  "Gloves:tacticalB01": { price: 400, nlvl: 40, iS: 0 },
  "Boots:tacticalB01": { price: 500, nlvl: 40, iS: 0 },
  "Others:smertik": { price: 550, nlvl: 40, iS: 0 },
  //lych
  "Shirts:hoodB08": { price: 450, nlvl: 27, iS: 0 },
  "Pants:sportB08": { price: 300, nlvl: 27, iS: 0 },
  "Boots:sneakV2B02": { price: 150, nlvl: 27, iS: 0 },
  "Hats:capB08": { price: 150, nlvl: 27, iS: 0 },
  "Masks:bandB07": { price: 525, nlvl: 27, iS: 0 },
  //ploxish
  "Shirts:hoodB03": { price: 925, nlvl: 35, iS: 0 },
  "Pants:sportB03": { price: 700, nlvl: 35, iS: 0 },
  "Others:badboy": { price: 550, nlvl: 35, iS: 0 },
  "Boots:sneakV2B05": { price: 500, nlvl: 35, iS: 0 },
  "Masks:maskB01": { price: 500, nlvl: 35, iS: 0 },
  "Hats:capB04": { price: 550, nlvl: 35, iS: 0 },
  //kislotniy voin
  "Hats:hatB08": { price: 550, nlvl: 35, iS: 0 },
  "Shirts:hoodB10": { price: 950, nlvl: 35, iS: 0 },
  "Pants:sportB10": { price: 700, nlvl: 35, iS: 0 },
  "Boots:sneakV2B06": { price: 500, nlvl: 35, iS: 0 },
  "Masks:bandB03": { price: 525, nlvl: 35, iS: 0 },
  //stuzha
  "Hats:santa2": { price: 550, nlvl: 33, iS: 0 },
  "Masks:santa2": { price: 550, nlvl: 33, iS: 0 },
  "Shirts:santa2": { price: 550, nlvl: 33, iS: 0 },
  "Backpacks:santa": { price: 600, nlvl: 33, iS: 0 },
  "Gloves:santa2": { price: 350, nlvl: 33, iS: 0 },
  "Pants:santa2": { price: 550, nlvl: 33, iS: 0 },
  "Boots:santa2": { price: 500, nlvl: 33, iS: 0 },
  "Others:santa2": { price: 450, nlvl: 33, iS: 0 },
  //nekrovoin
  "Heads:franky": { price: 600, nlvl: 35, iS: 0 },
  "Masks:franky": { price: 600, nlvl: 35, iS: 0 },
  "Shirts:franky": { price: 1000, nlvl: 35, iS: 0 },
  "Pants:franky": { price: 500, nlvl: 35, iS: 0 },
  "Boots:franky": { price: 600, nlvl: 35, iS: 0 },
  "Gloves:franky": { price: 400, nlvl: 35, iS: 0 },
  "Others:franky": { price: 600, nlvl: 35, iS: 0 },
  "Backpacks:frankyOctopus": { price: 700, nlvl: 35, iS: 0 },
  //infernal
  "Hats:infernal": { price: 500, nlvl: 42, iS: 0 },
  "Shirts:infernal": { price: 800, nlvl: 42, iS: 0 },
  "Pants:infernal": { price: 500, nlvl: 42, iS: 0 },
  "Boots:infernal": { price: 500, nlvl: 42, iS: 0 },
  "Gloves:infernal": { price: 400, nlvl: 42, iS: 0 },
  "Masks:infernal_H": { price: 600, nlvl: 42, iS: 0 },
  "Others:infernal": { price: 600, nlvl: 42, iS: 0 },
  "Backpacks:infernalRaven": { price: 600, nlvl: 42, iS: 0 },
  //kiborg
  "Masks:maskB02": { price: 99999, nlvl: 999, iS: 0 },
  "Shirts:hoodB05": { price: 99999, nlvl: 999, iS: 0 },
  "Pants:sportB05": { price: 9999, nlvl: 999, iS: 0 },
  "Boots:sneakV2B04": { price: 9999, nlvl: 999, iS: 0 },
  //strannik
  "Hats:hatB01": { price: 340, nlvl: 21, iS: 0 },
  "Masks:bandB05": { price: 245, nlvl: 21, iS: 0 },
  "Shirts:hoodB01": { price: 550, nlvl: 21, iS: 0 },
  "Pants:sportB01": { price: 350, nlvl: 21, iS: 0 },
  "Boots:sneakV2B10": { price: 325, nlvl: 21, iS: 0 },
  //zmeelov
  "Masks:bandB01": { price: 525, nlvl: 27, iS: 0 },
  "Shirts:hoodB04": { price: 600, nlvl: 27, iS: 0 },
  "Pants:sportB04": { price: 400, nlvl: 27, iS: 0 },
  "Hats:capB07": { price: 575, nlvl: 27, iS: 0 },
  "Backpacks:snake01": { price: 400, nlvl: 27, iS: 0 },
  //prizrak
  "Masks:klavaB01": { price: 600, nlvl: 21, iS: 0 },
  "Shirts:prizrak": { price: 700, nlvl: 21, iS: 0 },
  "Pants:prizrak": { price: 500, nlvl: 21, iS: 0 },
  "Gloves:prizrak": { price: 300, nlvl: 21, iS: 0 },
  "Boots:prizrak": { price: 400, nlvl: 21, iS: 0 },
  //anarchist
  "Hats:capB01": { price: 600, nlvl: 34, iS: 0 },
  "Shirts:anarch": { price: 850, nlvl: 34, iS: 0 },
  "Pants:jeansB03": { price: 600, nlvl: 34, iS: 0 },
  "Gloves:wristwrapB03": { price: 600, nlvl: 34, iS: 0 },
  "Boots:anarch": { price: 450, nlvl: 34, iS: 0 },
  "Others:spinyellow": { price: 750, nlvl: 34, iS: 0 },
  //zadira
  "Hats:hatB06": { price: 800, nlvl: 30, iS: 0 },
  "Masks:bandB04": { price: 9999, nlvl: 30, iS: 0 }, // za donat
  "Shirts:hoodB60": { price: 1000, nlvl: 30, iS: 0 },
  "Pants:sportB06": { price: 800, nlvl: 30, iS: 0 },
  "Boots:zadira": { price: 800, nlvl: 30, iS: 0 },
  "Others:burger": { price: 500, nlvl: 30, iS: 0 },
  //thanos
  "Heads:thanos": { price: 300, nlvl: 30, iS: 0 }, // za donat
  "Masks:thanos": { price: 300, nlvl: 30, iS: 0 },
  "Shirts:thanos": { price: 700, nlvl: 30, iS: 0 },
  "Pants:thanos": { price: 500, nlvl: 30, iS: 0 },
  "Gloves:thanos": { price: 1200, nlvl: 30, iS: 0 }, // za donat
  "Boots:thanos": { price: 200, nlvl: 30, iS: 0 },
  "Backpacks:thanos": { price: 300, nlvl: 30, iS: 0 },
  //barhan
  "Hats:milcap03": { price: 550, nlvl: 30, iS: 0 },
  "Shirts:tactic04": { price: 825, nlvl: 30, iS: 0 },
  "Gloves:tactical02": { price: 375, nlvl: 30, iS: 0 },
  "Pants:tactic04": { price: 650, nlvl: 30, iS: 0 },
  //custom
  "Hats:capgavaimag": { price: 220000, nlvl: 299, iS: 0 },
  "Masks:gavaibandana": { price: 220000, nlvl: 299, iS: 0 },
  "Shirts:gavaihoodie": { price: 220000, nlvl: 299, iS: 0 },
  "Pants:shortigavai": { price: 220000, nlvl: 299, iS: 0 },
  "Boots:gavaibootsmag": { price: 220000, nlvl: 299, iS: 0 },
  "Backpacks:popugagavai": { price: 220000, nlvl: 299, iS: 0 },  
  "Gloves:gavaigloves": { price: 220000, nlvl: 299, iS: 0 },
  //default shirts
  "Shirts:hood05": { price: 325, nlvl: 3, iS: 0 },
  "Shirts:hood01": { price: 210, nlvl: 3, iS: 0 },
  "Shirts:hood02": { price: 255, nlvl: 3, iS: 0 },
  "Shirts:shirtB08": { price: 3999, nlvl: 42, iS: 0 },
  //default pants
  "Pants:sport04": { price: 325, nlvl: 3, iS: 0 },
  "Pants:sport01": { price: 310, nlvl: 3, iS: 0 }
};
const legacyShopWears = Object.entries(shopWearCatalog).flatMap(([slot, names]) =>
  names.map((sname, index) => {
    const key = `${slot}:${sname}`;
    const config = wearPrices[key] ?? {};

    return wear(
      10000 + wearSlotIds[slot] * 1000 + index + 1,
      wearSlotIds[slot],
      sname,
      config.price ?? SHOP_PRICE,
      slot,
      {
        nlvl: config.nlvl ?? 1,
        iS: config.iS ?? 0
      }
    );
  })
);

const wearSlotNamesById = new Map(Object.entries(wearSlotIds).map(([slot, id]) => [Number(id), slot]));
const standaloneHiddenShopWearKeys = new Set([
  "Shirts:armor01", // Работник органов
  "Shirts:armor02", // Законник
  "Shirts:armor03", // Жилет агента
  "Shirts:armor04", // Комплект агента
  "Shirts:jack01",  // Кожанка
  "Shirts:singl05", // Натуралитет
  "Shirts:singl06", // БезрукOFF
  "Shirts:jack02",  // Куртка бойца
  "Shirts:jack03",  // Байкерский куртяк
  "Shirts:shirt01", // Кожа крокодила
  "Shirts:shirt02", // Классика
  "Shirts:shirt03", // Шахтерка
  "Shirts:shirt04", // Улыбака
  "Shirts:singl04"  // Чисточел
]);

function findWearCatalogItem(slot, sname) {
  const wt = wearSlotIds[slot];
  const item = legacyShopWears.find((wearItem) => Number(wearItem.wt) === Number(wt) && String(wearItem.sname) === String(sname));
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
    name: "Байкер",
    desca: "+10% защиты от дробовиков\n+5% защиты от снайперок\n+5% защиты от ракетниц\n+10% защиты от огнеметов\n+5% защиты от гранатометов\n+20% защиты от оружия ближнего боя\n+15% к здоровью\n+2% к скорости\nурон снайперок на средней дистанции +2\nурон автоматов на дальней дистанции +4",
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
    name: "Шпион",
    desca: "+10% защиты от пистолетов\n+10% защиты от снайперок\n+9% к здоровью\nурон пистолетов на средней дистанции +7\nурон автоматов на средней дистанции +6",
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
    name: "Сталкер",
    desca: "+15% защиты от дробовиков\n+15% защиты от огнеметов\n+5% защиты от снайперок\n+5% защиты от оружия ближнего боя\n+12% к здоровью\nурон дробовиков на средней дистанции +6\nурон автоматов на дальней дистанции +5",
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
    name: "конТрАНОС",
    desca: "+10% защиты от автоматов\n+5% защиты от снайперок\n+4% защиты от пистолетов\n+15% защиты от оружия ближнего боя\n+15% защиты от ракетниц\n+15% защиты от гранатометов\n+5% защиты от дробовиков\n+4% к здоровью\nурон ракетниц на дальней дистанции +6\nурон автоматов на средней дистанции +3",
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
  { id: 38, code: "blue_soldier", items: [["Heads", "spec99"], ["Hats", "ushanka2"], ["Shirts", "trooper2"], ["Pants", "pant032"], ["Gloves", "glov022"], ["Boots", "slip99"], ["Backpacks", "rec2"], ["Others", "vodka"]] },
  { id: 39, code: "gavai", items: [["Hats", "capgavaimag"], ["Masks", "gavaibandana"], ["Shirts", "gavaihoodie"], ["Pants", "shortigavai"], ["Gloves", "gavaigloves"], ["Boots", "gavaibootsmag"], ["Backpacks", "popugagavai"]] }
];

const donateWearSetsById = new Map([
  [25, {
    id: 25,
    items: [
      ["Heads", "franky"],
      ["Masks", "franky"],
      ["Shirts", "franky"],
      ["Pants", "franky"],
      ["Boots", "franky"],
      ["Gloves", "franky"],
      ["Others", "franky"],
      ["Backpacks", "frankyOctopus"]
    ]
  }],
  [34, {
    id: 34,
    items: [
      ["Hats", "avenger"],
      ["Masks", "avenger"],
      ["Shirts", "avenger"],
      ["Pants", "avenger"],
      ["Gloves", "avenger"],
      ["Boots", "avenger"]
    ]
  }],
  [35, {
    id: 35,
    items: [
      ["Hats", "stalker"],
      ["Masks", "stalkergasmask"],
      ["Shirts", "stalker"],
      ["Pants", "stalker"],
      ["Gloves", "stalker"],
      ["Boots", "stalker"]
    ]
  }],
  [36, {
    id: 36,
    items: [
      ["Hats", "business"],
      ["Masks", "businessgoogles"],
      ["Shirts", "business"],
      ["Pants", "business"],
      ["Gloves", "business"],
      ["Boots", "business"]
    ]
  }]
]);

function donateWearSetItems(setIdValue) {
  const definition = donateWearSetsById.get(Number(setIdValue));
  if (!definition) return null;
  return definition.items.map(([slot, sname]) => {
    const item = clone(findWearCatalogItem(slot, sname));
    item.eD = 0;
    return item;
  });
}

// Assemblages 4 (ШТУРМОВИК) and 5 (ЭКОТЕРРОР) have no recoverable original item lists.
// Keep them out of the shop response instead of exposing sets the battle server cannot complete.
// The other IDs below are intentionally retired from the live shop; their item
// definitions stay canonical so already owned/equipped pieces remain valid.
const removedAssemblageIds = new Set([
  1,  // ПИКОВЫЙ ЖНЕЦ
  2,  // ВОРОН
  4,  // ШТУРМОВИК: исходный состав не восстановлен
  5,  // ЭКОТЕРРОР: исходный состав не восстановлен
  8,  // РАЗВЕД
  10, // ВДВ
  14, // Олимпиец
  23, // Красная жара
  24  // Прохладный бриз
]);
const hiddenAssemblageWearKeys = new Set(
  restoredAssemblageDefinitions
    .filter((definition) => removedAssemblageIds.has(definition.id))
    .flatMap((definition) => definition.items.map(([slot, sname]) => `${slot}:${sname}`))
);
const hiddenShopWearKeys = new Set([...standaloneHiddenShopWearKeys, ...hiddenAssemblageWearKeys]);
const shopWears = legacyShopWears.filter((item) => {
  const slot = wearSlotNamesById.get(Number(item.wt)) || "";
  return !hiddenShopWearKeys.has(`${slot}:${item.sname}`);
});
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

// Hidden from the live shop: 2 "Лимонадный глоток", 6 "Пальцестрел",
// 9 "Самолеты", 10 "Секир-башка", 11 "Подозрительность".
const canonicalTaunts = Object.entries(TAUNT_PRICES).map(([id, prices]) => taunt(Number(id), prices));
const hiddenShopTauntIds = new Set([9]);
const shopTaunts = canonicalTaunts.filter((item) => !hiddenShopTauntIds.has(Number(item.t_id)));
const shopEnhancers = SHOP_ENHANCER_IDS.map((id) =>
  enhancer(id, ENHANCER_PRICES[id])
);
const canonicalWeaponsById = new Map([...defaultWeapons, ...canonicalShopWeapons].map((item) => [Number(item.w_id), item]));
const weaponSnameKey = (item) => String(item?.sn || item?.sname || "").toLowerCase();
const canonicalWeaponsBySname = new Map([...defaultWeapons, ...canonicalShopWeapons].map((item) => [weaponSnameKey(item), item]).filter(([key]) => key));
const canonicalWearsById = new Map(legacyShopWears.map((item) => [Number(item.w_id), item]));
const canonicalTauntsById = new Map(canonicalTaunts.map((item) => [Number(item.t_id), item]));
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

// Пять цен: для 1, 2, 3, 4 и 5 уровня способности.
const abilityPrices = {
  1: [100, 150, 200, 400, 1200],
  2: [100, 150, 200, 400, 1200],
  3: [180, 200, 300, 600, 1800],
  4: [180, 250, 350, 700, 2100],
  5: [180, 200, 300, 600, 1800],
  6: [130, 160, 210, 420, 1260],
  7: [180, 250, 350, 700, 2100], // Барахольщик
  8: [130, 160, 210, 420, 1260], // Немаленький
  9: [130, 160, 210, 420, 1260], // Максималист
  10: [180, 200, 300, 600, 1800], // Точность по ГОСТу
  11: [130, 160, 210, 420, 1260] // Охотник за головами
};
const abilityCatalog = [];

for (const [abilityIdText, definition] of Object.entries(abilityValueDefinitions)) {
  const abilityId = Number(abilityIdText);

  for (let level = 1; level <= definition.values.length; level += 1) {
    abilityCatalog.push({
      i: abilityId,
      l: level,
      v: JSON.stringify([{ t: definition.type, [definition.key]: String(definition.values[level - 1]) }]),
      sc: cost(
        5000 + abilityId * 10 + level,
        abilityPrices[abilityId]?.[level - 1] ?? 100 * level
      )
    });
  }
}

const mapPlayers = "4,6,8,10,12,14,16";
const MAP_MODE_DEATHMATCH = 1;
const MAP_MODE_TEAM_DEATHMATCH = 2;
const MAP_MODE_CAPTURE_THE_FLAG = 4;
const MAP_MODE_CONTROL_POINTS = 8;
// Client mode 16 initializes the Campaign NPC container. For Dashguard it is
// presented as the dedicated Event mode rather than the legacy tower UI.
//const MAP_MODE_DASHGUARD_EVENT = 16;
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
  mapEntry(18, "Inferno", MAP_MODE_DEATHMATCH | MAP_MODE_TEAM_DEATHMATCH),
  mapEntry(19, "promzona", MAP_MODE_DEATHMATCH),
  //mapEntry(19, "Dashguard", MAP_MODE_DEATHMATCH | MAP_MODE_DASHGUARD_EVENT)
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
  if (postgresMutationQueueDepth >= POSTGRES_MUTATION_QUEUE_MAX) {
    const error = new Error("database_busy");
    error.code = "DATABASE_BUSY";
    return Promise.reject(error);
  }
  postgresMutationQueueDepth += 1;
  const run = pgSaveChain.catch(() => {}).then(operation).finally(() => {
    postgresMutationQueueDepth = Math.max(0, postgresMutationQueueDepth - 1);
  });
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
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(POSTGRES_MIGRATION_TIMEOUT_MS)}`);
      await client.query({ text: sql, query_timeout: POSTGRES_MIGRATION_TIMEOUT_MS });
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

async function ensureAuditSecuritySchema() {
  // Keep these columns as startup invariants as well as migration 014. Railway
  // deployments can retain a stale schema_migrations row or omit migration
  // assets while still deploying server.js; either case must not break login
  // audit on an otherwise healthy game API.
  await pgPool.query("ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS geo JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pgPool.query("ALTER TABLE player_activity ADD COLUMN IF NOT EXISTS last_geo JSONB NOT NULL DEFAULT '{}'::jsonb");
}

async function ensureTelegramSystemState(executor = pgPool) {
  if (!executor) return;
  await executor.query(
    `INSERT INTO launcher_telegram_system_state (id, binding_epoch)
     VALUES (1, 1)
     ON CONFLICT (id) DO NOTHING`
  );
}

async function ensureLauncherDeviceSchema() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS launcher_devices (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      device_key_id TEXT NOT NULL,
      device_public_key TEXT NOT NULL,
      link_key_hash TEXT NOT NULL DEFAULT '',
      hwid_hash TEXT NOT NULL DEFAULT '',
      risk JSONB NOT NULL DEFAULT '{}'::jsonb,
      bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reset_at TIMESTAMPTZ
    )
  `);
  await pgPool.query("ALTER TABLE launcher_devices ADD COLUMN IF NOT EXISTS link_key_hash TEXT NOT NULL DEFAULT ''");
  await pgPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS launcher_devices_device_key_id_idx
      ON launcher_devices (device_key_id)
  `);

  const legacyBindings = await pgPool.query(`
    SELECT d.player_id, p.cckey
    FROM launcher_devices d
    JOIN players p ON p.id = d.player_id
    WHERE d.link_key_hash = ''
  `);
  if (legacyBindings.rowCount) {
    const playerIds = legacyBindings.rows.map((row) => Number(row.player_id));
    const linkKeyHashes = legacyBindings.rows.map((row) => launcherLinkKeyHash(row.cckey));
    await pgPool.query(
      `UPDATE launcher_devices d
       SET link_key_hash = source.link_key_hash
       FROM unnest($1::integer[], $2::text[]) AS source(player_id, link_key_hash)
       WHERE d.player_id = source.player_id
         AND d.link_key_hash = ''`,
      [playerIds, linkKeyHashes]
    );
    console.log(`[launcher-device] backfilled link generation bindings=${legacyBindings.rowCount}`);
  }
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
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    max: POSTGRES_POOL_MAX,
    connectionTimeoutMillis: POSTGRES_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: POSTGRES_IDLE_TIMEOUT_MS,
    statement_timeout: POSTGRES_QUERY_TIMEOUT_MS,
    query_timeout: POSTGRES_QUERY_TIMEOUT_MS,
    application_name: "contra-city-api",
  });

  await runMigrations();
  await ensureAuditSecuritySchema();
  await ensureTelegramSystemState();
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
if (pgPool && TELEGRAM_LINK_API_TOKEN) {
  cleanupTelegramPairingState().catch((error) => {
    console.error("[telegram-pairing] initial cleanup failed", error);
  });
  const telegramCleanupTimer = setInterval(() => {
    cleanupTelegramPairingState().catch((error) => {
      console.error("[telegram-pairing] scheduled cleanup failed", error);
    });
  }, TELEGRAM_CLEANUP_INTERVAL_MS);
  telegramCleanupTimer.unref();
}

const adminLogsApi = createAdminLogsApi({
  getPool: () => pgPool,
  readJsonBody,
  requestIp: requestClientIp,
  requestGeo,
  onPlayerChanged: async (playerId) => {
    if (!pgPool) return;
    playerBanCache.delete(Number(playerId));
    const fresh = await loadPostgresAccount(playerId);
    if (fresh) store.accounts[String(playerId)] = fresh;
  }
});
const adminLogsStatus = await adminLogsApi.initialize();

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
  const normalized = {
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
  if (normalized.launcherDevice) {
    normalized.launcherDevice = {
      ...normalized.launcherDevice,
      linkKeyHash: normalized.launcherDevice.linkKeyHash || launcherLinkKeyHash(normalized.key)
    };
  }
  return normalized;
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

function createLauncherSession(account, deviceKeyId = "") {
  pruneLauncherSessions();
  const token = randomLauncherToken();
  const expiresAt = Date.now() + LAUNCHER_SESSION_TTL_MS;
  launcherSessions.set(token, {
    id: String(account.id),
    key: String(account.key),
    deviceKeyId: normalizeLauncherDeviceKeyId(deviceKeyId),
    expiresAt
  });
  return {
    token,
    expiresInSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))
  };
}

function launcherSessionRecord(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  pruneLauncherSessions();
  const session = launcherSessions.get(token);
  if (!session) return null;
  return { token, ...session };
}

function launcherSessionCredentials(rawToken) {
  const session = launcherSessionRecord(rawToken);
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
  const current = store.accounts[String(account.id)];
  if (current?.key && account.key !== current.key && isRevokedGameLinkKey(account.id, account.key)) {
    account.key = current.key;
  }
  account.updatedAt = new Date().toISOString();
  store.accounts[String(account.id)] = normalizeAccount(account);
  saveStore(store);
}

async function accountFromRequestUnchecked(url) {
  const requestStartedAt = Date.now();
  const requestPage = String(url.searchParams.get("page") || "").toLowerCase();
  const requestAction = String(url.searchParams.get("act") || url.searchParams.get("action") || "").toLowerCase();
  const traceClanRequest = requestPage === "clan" && ["join", "m", "inv", "accept", "reject", "remove", "leave", "gevnt"].includes(requestAction);
  const logClanPreRoute = (source) => {
    if (!traceClanRequest) return;
    console.log(`[clan-request] pre-route act=${requestAction} source=${source} duration=${Date.now() - requestStartedAt}ms`);
  };
  const credentials = accountCredentialsFrom(url);
  if (!credentials) {
    return null;
  }
  if (isRevokedGameLinkKey(credentials.id, credentials.key)) {
    return null;
  }

  const skipPreRefresh = isEquipmentSelectionSaveRequest(url);
  const cached = store.accounts[credentials.id] ? normalizeAccount(store.accounts[credentials.id]) : null;
  if (cached && cached.key === credentials.key) {
    store.accounts[credentials.id] = cached;
    const resolved = skipPreRefresh ? cached : await refreshAccountFromPostgres(cached);
    logClanPreRoute(skipPreRefresh ? "cache" : "cache-pg-refresh");
    return resolved;
  }

  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const fresh = await loadPostgresAccount(credentials.id);
      if (fresh && fresh.key === credentials.key) {
        store.accounts[credentials.id] = fresh;
        logClanPreRoute("postgres-load");
        return fresh;
      }
    } catch (error) {
      console.error("[postgres] account lookup failed", error);
    }
  }

  const account = accountFrom(url);
  const resolved = skipPreRefresh ? account : await refreshAccountFromPostgres(account);
  logClanPreRoute(skipPreRefresh ? "fallback-cache" : "fallback-pg-refresh");
  return resolved;
}

async function activePlayerBan(playerId, executor = pgPool) {
  const id = Number(playerId || 0);
  if (!executor?.query || !Number.isInteger(id) || id <= 0) return null;
  const now = Date.now();
  const cached = playerBanCache.get(id);
  if (cached && now - cached.loadedAt < PLAYER_BAN_CACHE_TTL_MS) return cached.ban;
  const result = await executor.query(
    `SELECT id, reason, expires_at
     FROM admin_punishments
     WHERE player_id = $1
       AND punishment_type = 'ban'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  const ban = result.rows[0] || null;
  if (playerBanCache.has(id)) playerBanCache.delete(id);
  playerBanCache.set(id, { loadedAt: now, ban });
  while (playerBanCache.size > 10000) playerBanCache.delete(playerBanCache.keys().next().value);
  return ban;
}

async function accountFromRequest(url) {
  const account = await accountFromRequestUnchecked(url);
  if (!account) return null;
  return (await activePlayerBan(account.id)) ? null : account;
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
  const staffRole = await loadActiveStaffRole(pgPool, Number(row.id));

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
  account.staffRole = staffRole;
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
        account.money = nextPlayerMoney;
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
      title: `\u0421\u0432\u0435\u0436\u0430\u044f \u0441\u0431\u043e\u0440\u043a\u0430 v${LAUNCHER_VERSION}`,
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

function launcherLinkKeyHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function launcherDeviceKeyMatchesPublicKey(deviceKeyId, publicKey) {
  const expected = String(deviceKeyId || "").toLowerCase();
  if (!expected.startsWith("win.")) return false;
  const pemVariants = [publicKey, `${publicKey}\n`, `${publicKey}\r\n`];
  return pemVariants.some((pem) => {
    const hash = crypto.createHash("sha256").update(pem, "utf8").digest("hex").slice(0, 32);
    return safeTokenEquals(expected, `win.${hash}`);
  });
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
      linkKeyHash: row.link_key_hash || "",
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

function normalizePromoCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isValidPromoCode(value) {
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(String(value || ""));
}

function promoCodePayload(row) {
  if (!row) return null;
  const maxRedemptions = row.max_redemptions == null ? null : Number(row.max_redemptions);
  const redemptionCount = Number(row.redemption_count || 0);
  return {
    id: Number(row.id),
    code: String(row.code || row.code_normalized || ""),
    rewardType: String(row.reward_type || "contrabucks"),
    rewardAmount: Number(row.reward_amount || 0),
    maxRedemptions,
    redemptionCount,
    remainingRedemptions: maxRedemptions == null ? null : Math.max(0, maxRedemptions - redemptionCount),
    active: Boolean(row.active),
    expiresAt: postgresTimestamp(row.expires_at) || null,
    createdByTelegramId: row.created_by_telegram_id == null ? null : Number(row.created_by_telegram_id),
    createdByLabel: String(row.created_by_label || ""),
    createdAt: postgresTimestamp(row.created_at),
    updatedAt: postgresTimestamp(row.updated_at)
  };
}

function normalizedPositiveInteger(value, maxValue, nullable = false) {
  if (nullable && (value == null || value === "" || Number(value) === 0)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maxValue) return undefined;
  return number;
}

async function createPromoCode(body) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const code = normalizePromoCode(body?.code);
  if (!isValidPromoCode(code)) {
    return { ok: false, status: 400, error: "invalid_code" };
  }

  const rewardAmount = normalizedPositiveInteger(body?.rewardAmount ?? body?.contrabucks, 10_000_000);
  if (rewardAmount === undefined) {
    return { ok: false, status: 400, error: "invalid_reward_amount" };
  }

  const maxRedemptions = normalizedPositiveInteger(body?.maxRedemptions, 1_000_000, true);
  if (maxRedemptions === undefined) {
    return { ok: false, status: 400, error: "invalid_max_redemptions" };
  }

  const expiresInDays = normalizedPositiveInteger(body?.expiresInDays, 3650, true);
  if (expiresInDays === undefined) {
    return { ok: false, status: 400, error: "invalid_expiry" };
  }
  const expiresAt = expiresInDays == null
    ? null
    : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const creatorTelegramId = Number(body?.createdByTelegramId || 0);
  const creatorLabel = String(body?.createdByLabel || "").trim().slice(0, 160);

  const inserted = await pgPool.query(
    `INSERT INTO promo_codes (
       code, code_normalized, reward_type, reward_amount, max_redemptions,
       active, expires_at, created_by_telegram_id, created_by_label
     )
     VALUES ($1, $1, 'contrabucks', $2, $3, TRUE, $4, $5, $6)
     ON CONFLICT (code_normalized) DO NOTHING
     RETURNING *`,
    [
      code,
      rewardAmount,
      maxRedemptions,
      expiresAt,
      Number.isSafeInteger(creatorTelegramId) && creatorTelegramId > 0 ? creatorTelegramId : null,
      creatorLabel
    ]
  );
  if (!inserted.rowCount) {
    const existing = await pgPool.query(
      "SELECT * FROM promo_codes WHERE code_normalized = $1",
      [code]
    );
    return { ok: false, status: 409, error: "code_exists", promo: promoCodePayload(existing.rows[0]) };
  }

  return { ok: true, created: true, promo: promoCodePayload(inserted.rows[0]) };
}

async function listPromoCodes(limitValue = 20) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const limit = Math.max(1, Math.min(100, Number(limitValue) || 20));
  const result = await pgPool.query(
    `SELECT *
     FROM promo_codes
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return { ok: true, promos: result.rows.map(promoCodePayload) };
}

async function setPromoCodeActive(body) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const id = Number(body?.id || 0);
  const code = normalizePromoCode(body?.code);
  const active = body?.active === true;
  if ((!Number.isSafeInteger(id) || id <= 0) && !isValidPromoCode(code)) {
    return { ok: false, status: 400, error: "invalid_promo_reference" };
  }

  const result = Number.isSafeInteger(id) && id > 0
    ? await pgPool.query(
      `UPDATE promo_codes
       SET active = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, active]
    )
    : await pgPool.query(
      `UPDATE promo_codes
       SET active = $2, updated_at = now()
       WHERE code_normalized = $1
       RETURNING *`,
      [code, active]
    );
  if (!result.rowCount) return { ok: false, status: 404, error: "promo_not_found" };
  return { ok: true, promo: promoCodePayload(result.rows[0]) };
}

async function accountFromLauncherSessionBody(body) {
  const session = launcherSessionRecord(body?.sessionToken);
  const deviceKeyId = normalizeLauncherDeviceKeyId(body?.deviceKeyId);
  if (!session || !session.deviceKeyId || !deviceKeyId || session.deviceKeyId !== deviceKeyId) {
    return { ok: false, status: 403, error: "launcher_session_invalid" };
  }

  const sessionUrl = new URL("https://launcher.local/promo");
  sessionUrl.searchParams.set("ccsession", session.token);
  const account = await accountFromRequest(sessionUrl);
  if (!account) return { ok: false, status: 403, error: "launcher_session_invalid" };

  const device = await loadLauncherDevice(account.id);
  const currentLinkKeyHash = launcherLinkKeyHash(account.key);
  if (!device ||
      device.deviceKeyId !== deviceKeyId ||
      !safeTokenEquals(device.linkKeyHash, currentLinkKeyHash)) {
    return { ok: false, status: 403, error: "device_signature_required" };
  }

  return { ok: true, account, session, device };
}

function normalizeTelegramIdentity(rawUser) {
  const id = Number(rawUser?.id || rawUser?.telegramUserId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    username: String(rawUser?.username || "").trim().replace(/^@/, "").slice(0, 64),
    firstName: String(rawUser?.firstName || rawUser?.first_name || "").trim().slice(0, 80),
    lastName: String(rawUser?.lastName || rawUser?.last_name || "").trim().slice(0, 80)
  };
}

function telegramUserPayload(row) {
  if (!row?.telegram_user_id) return null;
  return {
    id: Number(row.telegram_user_id),
    username: String(row.telegram_username || ""),
    firstName: String(row.telegram_first_name || ""),
    lastName: String(row.telegram_last_name || "")
  };
}

function telegramLinkTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function normalizeTelegramStartToken(value) {
  const token = String(value || "").trim();
  return /^cc_[A-Za-z0-9_-]{40,60}$/.test(token) ? token : "";
}

async function loadTelegramBinding(accountId, executor = pgPool) {
  if (!executor || !accountId) return null;
  const result = await executor.query(
    `SELECT b.*, p.name AS player_name
     FROM launcher_telegram_bindings b
     JOIN players p ON p.id = b.player_id
     WHERE b.player_id = $1`,
    [Number(accountId)]
  );
  return result.rows[0] || null;
}

async function launcherTelegramStatus(account, req, executor = pgPool) {
  if (!executor || !TELEGRAM_LINK_API_TOKEN) {
    return {
      available: false,
      required: true,
      verified: false,
      linked: false,
      reason: "service_unavailable",
      state: "unavailable",
      user: null
    };
  }

  const systemState = await telegramSystemState(executor);
  if (!systemState) {
    return {
      available: false,
      required: true,
      verified: false,
      linked: false,
      reason: "service_unavailable",
      state: "unavailable",
      user: null
    };
  }
  const currentLinkKeyHash = launcherLinkKeyHash(account.key);
  let binding = await loadTelegramBinding(account.id, executor);
  if (binding && (
      Number(binding.binding_epoch || 0) !== Number(systemState.binding_epoch) ||
      (binding.link_key_hash && !safeTokenEquals(binding.link_key_hash, currentLinkKeyHash))
    )) {
    await executor.query("DELETE FROM launcher_telegram_bindings WHERE player_id = $1", [Number(account.id)]);
    await executor.query(
      `UPDATE launcher_telegram_login_requests
       SET state = 'cancelled', updated_at = now()
       WHERE player_id = $1 AND state IN ('pending', 'claimed')`,
      [Number(account.id)]
    );
    await executor.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = 'cancelled', updated_at = now()
       WHERE (player_id = $1 OR expected_player_id = $1)
         AND state IN ('issued', 'claimed')`,
      [Number(account.id)]
    );
    binding = null;
  }

  const ipHash = launcherIpHash(req);
  const linked = Boolean(binding);
  const verified = linked && Boolean(ipHash) && safeTokenEquals(binding.last_ip_hash, ipHash);
  return {
    available: true,
    required: !verified,
    verified,
    linked,
    reason: verified ? "verified" : (linked ? "ip_changed" : "not_linked"),
    state: verified ? "confirmed" : "required",
    user: telegramUserPayload(binding),
    confirmedAt: postgresTimestamp(binding?.confirmed_at) || null,
    lastVerifiedAt: postgresTimestamp(binding?.last_verified_at) || null,
    ipHash
  };
}

function telegramStatusPayload(status) {
  return {
    available: Boolean(status?.available),
    required: Boolean(status?.required),
    verified: Boolean(status?.verified),
    linked: Boolean(status?.linked),
    reason: String(status?.reason || "not_linked"),
    state: String(status?.state || "required"),
    user: status?.user || null,
    confirmedAt: status?.confirmedAt || null,
    lastVerifiedAt: status?.lastVerifiedAt || null
  };
}

async function listTelegramBindings(limitValue = 50) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const limit = Math.max(1, Math.min(100, Number(limitValue) || 50));
  const [result, countResult] = await Promise.all([
    pgPool.query(
      `SELECT b.*, p.name AS player_name
       FROM launcher_telegram_bindings b
       JOIN players p ON p.id = b.player_id
       ORDER BY b.updated_at DESC
       LIMIT $1`,
      [limit]
    ),
    pgPool.query("SELECT COUNT(*)::integer AS count FROM launcher_telegram_bindings")
  ]);
  return {
    ok: true,
    total: Number(countResult.rows[0]?.count || 0),
    links: result.rows.map((row) => ({
      playerId: Number(row.player_id),
      playerName: String(row.player_name || ""),
      telegram: telegramUserPayload(row),
      confirmedAt: postgresTimestamp(row.confirmed_at),
      lastVerifiedAt: postgresTimestamp(row.last_verified_at)
    }))
  };
}

function randomOpaqueId(prefix, byteLength = 18) {
  return `${prefix}_${crypto.randomBytes(byteLength).toString("base64url")}`;
}

function normalizeTelegramPairingCode(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return "";
  for (const character of compact) {
    if (!TELEGRAM_PAIRING_CODE_ALPHABET.includes(character)) return "";
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function createTelegramPairingCodeValue() {
  let compact = "";
  for (let index = 0; index < 8; index += 1) {
    compact += TELEGRAM_PAIRING_CODE_ALPHABET[
      crypto.randomInt(0, TELEGRAM_PAIRING_CODE_ALPHABET.length)
    ];
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function telegramPairingCodeHash(value) {
  const normalized = normalizeTelegramPairingCode(value);
  if (!normalized || !TELEGRAM_LINK_API_TOKEN) return "";
  return crypto
    .createHmac("sha256", TELEGRAM_LINK_API_TOKEN)
    .update(`pairing-code:${normalized}`, "utf8")
    .digest("hex");
}

function normalizeTelegramPairingRequestId(value, prefixes = ["pc", "lr", "ga"]) {
  const requestId = String(value || "").trim();
  const prefix = requestId.split("_", 1)[0];
  if (!prefixes.includes(prefix)) return "";
  return /^[a-z]{2}_[A-Za-z0-9_-]{20,60}$/.test(requestId) ? requestId : "";
}

async function telegramSystemState(executor = pgPool, { lock = false } = {}) {
  if (!executor) return null;
  await ensureTelegramSystemState(executor);
  const result = await executor.query(
    `SELECT id, binding_epoch, last_reset_at, last_reset_by_telegram_id, updated_at
     FROM launcher_telegram_system_state
     WHERE id = 1
     ${lock ? "FOR UPDATE" : ""}`
  );
  return result.rows[0] || null;
}

function telegramPairingPurpose(status) {
  return status?.linked ? "ip_reverify" : "link";
}

async function createTelegramLoginRequest(account, device, req) {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const bindingStatus = await launcherTelegramStatus(account, req);
  if (!bindingStatus.available) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  if (bindingStatus.verified) {
    return {
      ok: true,
      status: "confirmed",
      loginRequestId: null,
      expiresAt: null,
      remainingAttempts: 5,
      telegram: telegramStatusPayload(bindingStatus)
    };
  }

  const ipHash = bindingStatus.ipHash;
  if (!ipHash) return { ok: false, status: 503, error: "launcher_ip_unavailable" };
  const purpose = telegramPairingPurpose(bindingStatus);
  const linkKeyHash = launcherLinkKeyHash(account.key);
  const expectedTelegramUserId = Number(bindingStatus.user?.id || 0) || null;
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
    await client.query(
      "SELECT pg_advisory_xact_lock_shared($1)",
      [TELEGRAM_RESET_ADVISORY_LOCK]
    );
    const systemState = await telegramSystemState(client);
    if (!systemState) throw new Error("telegram_system_state_missing");
    const bindingEpoch = Number(systemState.binding_epoch);

    const existingResult = await client.query(
      `SELECT r.*,
              c.state AS code_state,
              c.telegram_user_id,
              c.telegram_username,
              c.telegram_first_name,
              c.telegram_last_name
       FROM launcher_telegram_login_requests r
       LEFT JOIN launcher_telegram_pairing_codes c ON c.login_request_id = r.request_id
       WHERE r.player_id = $1
         AND r.device_key_id = $2
         AND r.link_key_hash = $3
         AND r.launcher_ip_hash = $4
         AND r.binding_epoch = $5
         AND r.state IN ('pending', 'claimed')
       ORDER BY r.created_at DESC
       LIMIT 1
       FOR UPDATE OF r`,
      [
        Number(account.id),
        device.deviceKeyId,
        linkKeyHash,
        ipHash,
        bindingEpoch
      ]
    );
    const existing = existingResult.rows[0];
    if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
      await client.query("COMMIT");
      const codeUser = telegramUserPayload(existing);
      return {
        ok: true,
        status: existing.state === "claimed" ? "claimed" : "required",
        loginRequestId: String(existing.request_id),
        expiresAt: postgresTimestamp(existing.expires_at),
        remainingAttempts: Math.max(0, 5 - Number(existing.failed_attempts || 0)),
        telegram: {
          ...telegramStatusPayload(bindingStatus),
          state: existing.state === "claimed" ? "claimed" : "required",
          user: codeUser || bindingStatus.user
        }
      };
    }

    await client.query(
      `UPDATE launcher_telegram_login_requests
       SET state = CASE
         WHEN expires_at <= now() THEN 'expired'
         ELSE 'cancelled'
       END,
       updated_at = now()
       WHERE player_id = $1
         AND state IN ('pending', 'claimed')`,
      [Number(account.id)]
    );
    await client.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = CASE
         WHEN expires_at <= now() THEN 'expired'
         ELSE 'cancelled'
       END,
       updated_at = now()
       WHERE login_request_id IN (
         SELECT request_id
         FROM launcher_telegram_login_requests
         WHERE player_id = $1
           AND state IN ('expired', 'cancelled')
       )
         AND state IN ('issued', 'claimed')`,
      [Number(account.id)]
    );

    const loginRequestId = randomOpaqueId("lr");
    const expiresAt = new Date(Date.now() + TELEGRAM_LOGIN_REQUEST_TTL_MS);
    await client.query(
      `INSERT INTO launcher_telegram_login_requests (
         request_id, player_id, purpose, expected_telegram_user_id,
         device_key_id, link_key_hash, launcher_ip_hash,
         binding_epoch, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        loginRequestId,
        Number(account.id),
        purpose,
        expectedTelegramUserId,
        device.deviceKeyId,
        linkKeyHash,
        ipHash,
        bindingEpoch,
        expiresAt.toISOString()
      ]
    );
    await client.query("COMMIT");
    return {
      ok: true,
      status: "required",
      loginRequestId,
      expiresAt: expiresAt.toISOString(),
      remainingAttempts: 5,
      telegram: {
        ...telegramStatusPayload(bindingStatus),
        state: "required"
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function latestTelegramPairingStatus(account, device, req, loginRequestIdValue = "") {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const bindingStatus = await launcherTelegramStatus(account, req);
  if (!bindingStatus.available) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  if (bindingStatus.verified) {
    return {
      ok: true,
      status: "confirmed",
      loginRequestId: null,
      expiresAt: null,
      remainingAttempts: 5,
      telegram: telegramStatusPayload(bindingStatus)
    };
  }

  const loginRequestId = normalizeTelegramPairingRequestId(loginRequestIdValue, ["lr"]);
  const values = [
    Number(account.id),
    device.deviceKeyId,
    launcherLinkKeyHash(account.key),
    bindingStatus.ipHash
  ];
  const requestFilter = loginRequestId
    ? "AND r.request_id = $5"
    : "";
  if (loginRequestId) values.push(loginRequestId);
  const result = await pgPool.query(
    `SELECT r.*,
            c.request_id AS pairing_request_id,
            c.state AS code_state,
            c.telegram_user_id,
            c.telegram_username,
            c.telegram_first_name,
            c.telegram_last_name
     FROM launcher_telegram_login_requests r
     LEFT JOIN launcher_telegram_pairing_codes c ON c.login_request_id = r.request_id
     WHERE r.player_id = $1
       AND r.device_key_id = $2
       AND r.link_key_hash = $3
       AND r.launcher_ip_hash = $4
       ${requestFilter}
     ORDER BY r.created_at DESC
     LIMIT 1`,
    values
  );
  const loginRequest = result.rows[0];
  if (!loginRequest) {
    return {
      ok: true,
      status: "required",
      loginRequestId: null,
      expiresAt: null,
      remainingAttempts: 5,
      telegram: telegramStatusPayload(bindingStatus)
    };
  }

  const expired = new Date(loginRequest.expires_at).getTime() <= Date.now();
  if (expired && ["pending", "claimed"].includes(loginRequest.state)) {
    await pgPool.query(
      `UPDATE launcher_telegram_login_requests
       SET state = 'expired', updated_at = now()
       WHERE request_id = $1 AND state IN ('pending', 'claimed')`,
      [String(loginRequest.request_id)]
    );
    await pgPool.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = 'expired', updated_at = now()
       WHERE login_request_id = $1 AND state IN ('issued', 'claimed')`,
      [String(loginRequest.request_id)]
    );
    loginRequest.state = "expired";
  }

  const state = loginRequest.state === "claimed"
    ? "claimed"
    : String(loginRequest.state || "required");
  return {
    ok: true,
    status: state === "pending" ? "required" : state,
    loginRequestId: String(loginRequest.request_id),
    pairingRequestId: loginRequest.pairing_request_id
      ? String(loginRequest.pairing_request_id)
      : null,
    expiresAt: postgresTimestamp(loginRequest.expires_at),
    remainingAttempts: Math.max(0, 5 - Number(loginRequest.failed_attempts || 0)),
    telegram: {
      ...telegramStatusPayload(bindingStatus),
      state: state === "pending" ? "required" : state,
      user: telegramUserPayload(loginRequest) || bindingStatus.user
    }
  };
}

async function claimTelegramPairingCode(account, device, req, body) {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const loginRequestId = normalizeTelegramPairingRequestId(body?.loginRequestId, ["lr"]);
  const code = normalizeTelegramPairingCode(body?.code);
  if (!loginRequestId) {
    return { ok: false, status: 400, error: "telegram_login_request_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock_shared($1)",
      [TELEGRAM_RESET_ADVISORY_LOCK]
    );
    const systemState = await telegramSystemState(client);
    if (!systemState) throw new Error("telegram_system_state_missing");
    const loginResult = await client.query(
      `SELECT *
       FROM launcher_telegram_login_requests
       WHERE request_id = $1
       FOR UPDATE`,
      [loginRequestId]
    );
    const loginRequest = loginResult.rows[0];
    const currentIpHash = launcherIpHash(req);
    const currentLinkHash = launcherLinkKeyHash(account.key);
    if (!loginRequest ||
        Number(loginRequest.player_id) !== Number(account.id) ||
        loginRequest.device_key_id !== device.deviceKeyId ||
        !safeTokenEquals(loginRequest.link_key_hash, currentLinkHash) ||
        !safeTokenEquals(loginRequest.launcher_ip_hash, currentIpHash)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "telegram_login_request_invalid" };
    }
    if (Number(loginRequest.binding_epoch) !== Number(systemState.binding_epoch)) {
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET state = 'cancelled', updated_at = now()
         WHERE request_id = $1`,
        [loginRequestId]
      );
      await client.query("COMMIT");
      return { ok: false, status: 409, error: "telegram_binding_reset" };
    }
    if (new Date(loginRequest.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET state = 'expired', updated_at = now()
         WHERE request_id = $1`,
        [loginRequestId]
      );
      await client.query("COMMIT");
      return { ok: false, status: 410, error: "telegram_code_expired" };
    }
    if (loginRequest.state === "locked" || Number(loginRequest.failed_attempts || 0) >= 5) {
      await client.query("ROLLBACK");
      return { ok: false, status: 429, error: "telegram_code_attempts_exceeded", remainingAttempts: 0 };
    }
    if (loginRequest.state === "claimed") {
      const existingClaim = await client.query(
        `SELECT *
         FROM launcher_telegram_pairing_codes
         WHERE login_request_id = $1
         LIMIT 1`,
        [loginRequestId]
      );
      await client.query("ROLLBACK");
      if (existingClaim.rowCount) {
        return {
          ok: true,
          status: "claimed",
          loginRequestId,
          remainingAttempts: Math.max(0, 5 - Number(loginRequest.failed_attempts || 0)),
          telegram: {
            available: true,
            required: true,
            verified: false,
            linked: loginRequest.purpose === "ip_reverify",
            reason: loginRequest.purpose === "ip_reverify" ? "ip_changed" : "not_linked",
            state: "claimed",
            user: telegramUserPayload(existingClaim.rows[0])
          }
        };
      }
      return { ok: false, status: 409, error: "telegram_code_already_used" };
    }
    if (loginRequest.state !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: `telegram_request_${loginRequest.state}` };
    }

    const codeHash = telegramPairingCodeHash(code);
    const codeResult = codeHash
      ? await client.query(
        `SELECT *
         FROM launcher_telegram_pairing_codes
         WHERE code_hash = $1
         FOR UPDATE`,
        [codeHash]
      )
      : { rows: [], rowCount: 0 };
    const pairing = codeResult.rows[0];
    const pairingValid = pairing &&
      pairing.state === "issued" &&
      new Date(pairing.expires_at).getTime() > Date.now() &&
      Number(pairing.binding_epoch) === Number(systemState.binding_epoch);
    if (!pairingValid) {
      const codeWasAlreadyUsed = Boolean(pairing && pairing.state !== "issued");
      const failedAttempts = Math.min(5, Number(loginRequest.failed_attempts || 0) + 1);
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET failed_attempts = $2,
             state = CASE WHEN $2 >= 5 THEN 'locked' ELSE state END,
             updated_at = now()
         WHERE request_id = $1`,
        [loginRequestId, failedAttempts]
      );
      await client.query("COMMIT");
      return {
        ok: false,
        status: failedAttempts >= 5 ? 429 : 400,
        error: failedAttempts >= 5
          ? "telegram_code_attempts_exceeded"
          : (codeWasAlreadyUsed ? "telegram_code_already_used" : "telegram_code_invalid"),
        remainingAttempts: Math.max(0, 5 - failedAttempts)
      };
    }

    const bindingResult = await client.query(
      `SELECT *
       FROM launcher_telegram_bindings
       WHERE player_id = $1 OR telegram_user_id = $2
       FOR UPDATE`,
      [Number(account.id), Number(pairing.telegram_user_id)]
    );
    const playerBinding = bindingResult.rows.find(
      (row) => Number(row.player_id) === Number(account.id)
    );
    const telegramBinding = bindingResult.rows.find(
      (row) => Number(row.telegram_user_id) === Number(pairing.telegram_user_id)
    );

    if (loginRequest.purpose === "link") {
      if (pairing.purpose !== "link" ||
          pairing.expected_player_id ||
          playerBinding ||
          telegramBinding) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          error: playerBinding ? "telegram_player_already_bound" : "telegram_already_bound"
        };
      }
    } else {
      const expectedTelegramUserId = Number(loginRequest.expected_telegram_user_id || 0);
      if (pairing.purpose !== "ip_reverify" ||
          Number(pairing.expected_player_id || 0) !== Number(account.id) ||
          Number(pairing.telegram_user_id) !== expectedTelegramUserId ||
          !playerBinding ||
          Number(playerBinding.telegram_user_id) !== expectedTelegramUserId ||
          !telegramBinding ||
          Number(telegramBinding.player_id) !== Number(account.id)) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "telegram_account_mismatch" };
      }
    }

    await client.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = 'claimed',
           login_request_id = $2,
           player_id = $3,
           device_key_id = $4,
           link_key_hash = $5,
           launcher_ip_hash = $6,
           claimed_at = now(),
           updated_at = now()
       WHERE request_id = $1 AND state = 'issued'`,
      [
        String(pairing.request_id),
        loginRequestId,
        Number(account.id),
        device.deviceKeyId,
        currentLinkHash,
        currentIpHash
      ]
    );
    await client.query(
      `UPDATE launcher_telegram_login_requests
       SET state = 'claimed', claimed_at = now(), updated_at = now()
       WHERE request_id = $1 AND state = 'pending'`,
      [loginRequestId]
    );
    await client.query("COMMIT");
    return {
      ok: true,
      status: "claimed",
      loginRequestId,
      pairingRequestId: String(pairing.request_id),
      expiresAt: postgresTimestamp(loginRequest.expires_at),
      remainingAttempts: Math.max(0, 5 - Number(loginRequest.failed_attempts || 0)),
      telegram: {
        available: true,
        required: true,
        verified: false,
        linked: loginRequest.purpose === "ip_reverify",
        reason: loginRequest.purpose === "ip_reverify" ? "ip_changed" : "not_linked",
        state: "claimed",
        user: telegramUserPayload(pairing)
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") {
      return { ok: false, status: 409, error: "telegram_code_already_used" };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function botTelegramAccountStatus(telegramUserIdValue) {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const telegramUserId = Number(telegramUserIdValue || 0);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    return { ok: false, status: 400, error: "telegram_user_invalid" };
  }
  const bindingResult = await pgPool.query(
    `SELECT b.*,
            p.name AS player_name,
            p.level AS player_level,
            p.money AS player_money,
            p.cckey AS player_key,
            s.binding_epoch AS current_binding_epoch
     FROM launcher_telegram_bindings b
     JOIN players p ON p.id = b.player_id
     JOIN launcher_telegram_system_state s ON s.id = 1
     WHERE b.telegram_user_id = $1`,
    [telegramUserId]
  );
  const rawBinding = bindingResult.rows[0] || null;
  const binding = rawBinding &&
      Number(rawBinding.binding_epoch || 0) === Number(rawBinding.current_binding_epoch || 0) &&
      safeTokenEquals(
        String(rawBinding.link_key_hash || ""),
        launcherLinkKeyHash(rawBinding.player_key)
      )
    ? rawBinding
    : null;
  const loginResult = binding
    ? await pgPool.query(
      `SELECT *
       FROM launcher_telegram_login_requests
       WHERE player_id = $1
         AND expected_telegram_user_id = $2
         AND purpose = 'ip_reverify'
         AND state IN ('pending', 'claimed')
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1`,
      [Number(binding.player_id), telegramUserId]
    )
    : { rows: [] };
  const loginRequest = loginResult.rows[0] || null;
  const codeResult = await pgPool.query(
    `SELECT request_id, purpose, state, expires_at
     FROM launcher_telegram_pairing_codes
     WHERE telegram_user_id = $1
       AND state IN ('issued', 'claimed')
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [telegramUserId]
  );
  const activeCode = codeResult.rows[0] || null;
  return {
    ok: true,
    linked: Boolean(binding),
    player: binding ? {
      id: Number(binding.player_id),
      name: String(binding.player_name || ""),
      level: Number(binding.player_level || 1),
      money: Number(binding.player_money || 0),
      gameLink: loginLink({
        id: Number(binding.player_id),
        key: String(binding.player_key || "")
      })
    } : null,
    pendingLogin: loginRequest ? {
      requestId: String(loginRequest.request_id),
      expiresAt: postgresTimestamp(loginRequest.expires_at)
    } : null,
    activePairing: activeCode ? {
      requestId: String(activeCode.request_id),
      purpose: String(activeCode.purpose),
      state: String(activeCode.state),
      expiresAt: postgresTimestamp(activeCode.expires_at)
    } : null
  };
}

function normalizeDonateProductId(value) {
  const productId = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,50}$/.test(productId) ? productId : "";
}

function normalizeDonateOrderId(value) {
  const orderId = String(value || "").trim();
  return /^do_[A-Za-z0-9_-]{20,80}$/.test(orderId) ? orderId : "";
}

function donateProductPayload(row) {
  const stockCapacity = Number(row.stock_capacity || 0);
  const stockRemaining = stockCapacity > 0
    ? Math.max(0, Number(row.stock_remaining || 0))
    : null;
  return {
    id: String(row.id),
    title: String(row.title || ""),
    rewardKind: String(row.reward_kind || "coins"),
    rewardAmount: Number(row.reward_amount || row.coins || 0),
    coins: Number(row.coins),
    rubles: Number(row.rubles),
    stars: Number(row.stars),
    active: Boolean(row.active),
    stock: stockCapacity > 0
      ? {
          remaining: stockRemaining,
          capacity: stockCapacity,
          soldOut: stockRemaining <= 0
        }
      : null
  };
}

function donateOrderPayload(row) {
  const stockCapacity = Number(row.stock_capacity || 0);
  const stockRemaining = stockCapacity > 0
    ? Math.max(0, Number(row.stock_remaining || 0))
    : null;
  return {
    id: String(row.id),
    status: String(row.status),
    player: {
      id: Number(row.player_id),
      name: String(row.player_name || "")
    },
    telegramUserId: Number(row.telegram_user_id),
    product: {
      id: String(row.product_id),
      title: String(row.product_title || ""),
      rewardKind: String(row.reward_kind || "coins"),
      rewardAmount: Number(row.reward_amount || row.coins || 0),
      coins: Number(row.coins),
      rubles: Number(row.rubles),
      stars: Number(row.stars),
      stock: stockCapacity > 0
        ? {
            remaining: stockRemaining,
            capacity: stockCapacity,
            soldOut: stockRemaining <= 0
          }
        : null
    },
    expiresAt: postgresTimestamp(row.expires_at),
    paidAt: postgresTimestamp(row.paid_at)
  };
}

async function listDonateProducts() {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const result = await pgPool.query(
    `SELECT p.id, p.title, p.reward_kind, p.reward_amount,
            p.coins, p.rubles, p.stars, p.active,
            stock.remaining AS stock_remaining,
            stock.capacity AS stock_capacity
     FROM donate_products p
     LEFT JOIN donate_limited_stock stock ON stock.product_id = p.id
     WHERE p.active = TRUE
     ORDER BY p.display_order ASC, p.id ASC`
  );
  return {
    ok: true,
    currency: "XTR",
    products: result.rows.map(donateProductPayload)
  };
}

async function resetDonateLimitedStock(adminTelegramIdValue, rawProductId) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const adminTelegramId = Number(adminTelegramIdValue || 0);
  const productId = normalizeDonateProductId(rawProductId);
  if (adminTelegramId !== TELEGRAM_ADMIN_ID) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!productId) {
    return { ok: false, status: 400, error: "donate_product_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const stockResult = await client.query(
      `SELECT stock.product_id, stock.capacity, stock.remaining, product.title
       FROM donate_limited_stock stock
       JOIN donate_products product ON product.id = stock.product_id
       WHERE stock.product_id = $1
       FOR UPDATE OF stock`,
      [productId]
    );
    const stock = stockResult.rows[0] || null;
    if (!stock) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "donate_stock_not_found" };
    }
    const reservations = await client.query(
      `SELECT COUNT(*)::integer AS count
       FROM donate_orders
       WHERE product_id = $1
         AND status = 'pending'
         AND limited_stock_reserved_at IS NOT NULL
         AND limited_stock_consumed_at IS NULL`,
      [productId]
    );
    if (Number(reservations.rows[0]?.count || 0) > 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: "donate_stock_reservations_pending"
      };
    }
    const updatedResult = await client.query(
      `UPDATE donate_limited_stock
       SET remaining = capacity,
           updated_at = now()
       WHERE product_id = $1
       RETURNING capacity, remaining`,
      [productId]
    );
    const updated = updatedResult.rows[0];
    await writeAuditEvent(client, {
      eventType: "donate_stock_reset",
      category: "economy",
      severity: "notice",
      description:
        `Лимит «${String(stock.title || productId)}» восстановлен ` +
        `до ${Number(updated.remaining)}/${Number(updated.capacity)}`,
      source: "telegram_admin",
      oldValue: {
        productId,
        remaining: Number(stock.remaining),
        capacity: Number(stock.capacity)
      },
      newValue: {
        productId,
        remaining: Number(updated.remaining),
        capacity: Number(updated.capacity)
      },
      metadata: { telegramAdminId: adminTelegramId }
    });
    await client.query("COMMIT");
    return {
      ok: true,
      product: {
        id: productId,
        title: String(stock.title || ""),
        stock: {
          remaining: Number(updated.remaining),
          capacity: Number(updated.capacity),
          soldOut: false
        }
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

let battlePassSeasonCache = null;
let battlePassSeasonCacheUntil = 0;

async function loadActiveBattlePassSeason(client, now = Date.now()) {
  if (battlePassSeasonCache && now < battlePassSeasonCacheUntil) {
    return battlePassSeasonCache;
  }
  const result = await client.query(
    `SELECT season_id, title, starts_at, ends_at, task_cycle_anchor_at
     FROM battle_pass_seasons
     WHERE active = TRUE
     ORDER BY season_id DESC
     LIMIT 1`
  );
  battlePassSeasonCache = result.rows[0] || null;
  battlePassSeasonCacheUntil = now + 60 * 1000;
  return battlePassSeasonCache;
}

function timestampIso(value, fallbackMs) {
  const parsed = Date.parse(String(value || ""));
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString();
}

function nextBattlePassTaskResetAt(season, now = Date.now()) {
  const anchor = Date.parse(String(season?.task_cycle_anchor_at || ""));
  const safeAnchor = Number.isFinite(anchor) ? anchor : now;
  const cycle = now < safeAnchor
    ? 0
    : Math.floor((now - safeAnchor) / BATTLE_PASS_TASK_CYCLE_MS) + 1;
  let resetAt = safeAnchor + cycle * BATTLE_PASS_TASK_CYCLE_MS;
  const seasonEndsAt = Date.parse(String(season?.ends_at || ""));
  if (Number.isFinite(seasonEndsAt)) {
    resetAt = Math.min(resetAt, seasonEndsAt);
  }
  return new Date(resetAt).toISOString();
}

function storeEntitlementPayload(row, season = null, now = Date.now()) {
  const payload = {
    battlePassSeason: Number(row.battle_pass_season || 1),
    battlePassLevel: Number(row.battle_pass_level || 1),
    battlePassXp: Number(row.battle_pass_xp || 0),
    battlePassXpMax: BATTLE_PASS_XP_PER_LEVEL,
    battlePassPremium: Boolean(row.battle_pass_premium),
    battlePassPremiumPlus: Boolean(row.battle_pass_premium_plus),
    tropicalCases: Number(row.tropical_cases || 0),
    summerCases: Number(row.summer_cases || 0),
    specialCaseFragments: Number(row.special_case_fragments || 0),
    summerCaseProgress: Number(row.special_case_fragments || row.summer_case_progress || 0),
    tropicalCaseProgress: Number(row.special_case_fragments || row.tropical_case_progress || 0)
  };
  if (season) {
    payload.seasonTitle = String(season.title || "Летний сезон 1");
    payload.seasonStartsAt = timestampIso(season.starts_at, now);
    payload.seasonEndsAt = timestampIso(season.ends_at, now);
    payload.tasksResetAt = nextBattlePassTaskResetAt(season, now);
    payload.serverTime = new Date(now).toISOString();
  }
  return payload;
}

async function loadStoreEntitlements(client, playerId, lock = false) {
  const season = await loadActiveBattlePassSeason(client);
  const seasonId = Number(season?.season_id || 1);
  await client.query(
    `INSERT INTO player_store_entitlements (
       player_id, battle_pass_season, battle_pass_level, battle_pass_xp
     )
     SELECT id, $2, 1, 0
     FROM players
     WHERE id = $1
     ON CONFLICT (player_id) DO NOTHING`,
    [playerId, seasonId]
  );
  await client.query(
    `UPDATE player_store_entitlements
     SET battle_pass_season = $2,
         battle_pass_level = 1,
         battle_pass_xp = 0,
         battle_pass_premium = FALSE,
         battle_pass_premium_plus = FALSE,
         updated_at = now()
     WHERE player_id = $1
       AND battle_pass_season <> $2`,
    [playerId, seasonId]
  );
  const result = await client.query(
    `SELECT *
     FROM player_store_entitlements
     WHERE player_id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [playerId]
  );
  return result.rows[0] || null;
}

function summerCaseAccessSignature(payload, accountKey) {
  return crypto
    .createHmac("sha256", `${DEFAULT_KEY}\0${String(accountKey || "")}`)
    .update(payload, "utf8")
    .digest("base64url");
}

function issueSummerCaseAccessToken(account, now = Date.now()) {
  const expiresAt = now + SUMMER_CASE_ACCESS_TTL_MS;
  const payload = `v1:${Number(account.id)}:${expiresAt}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = summerCaseAccessSignature(payload, account.key);
  return { token: `${encoded}.${signature}`, expiresAt };
}

function parseSummerCaseAccessToken(value, now = Date.now()) {
  const token = String(value || "").trim();
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let payload;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const match = /^v1:(\d+):(\d+)$/.exec(payload);
  if (!match) return null;
  const playerId = Number(match[1]);
  const expiresAt = Number(match[2]);
  if (!Number.isSafeInteger(playerId) || playerId <= 0 ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return null;
  }
  return { token, payload, signature: parts[1], playerId, expiresAt };
}

function verifyParsedSummerCaseAccessToken(parsed, accountKey) {
  return Boolean(parsed) && safeTokenEquals(
    parsed.signature,
    summerCaseAccessSignature(parsed.payload, accountKey)
  );
}

function battlePassCaseAccessPayload(account, requestOrigin = null) {
  const access = issueSummerCaseAccessToken(account);
  const origin = String(requestOrigin || PUBLIC_BASE_URL).replace(/\/+$/, "");
  return {
    url: `${origin}/battle-pass/case/open`,
    resolveUrl: `${origin}/battle-pass/case/resolve`,
    token: access.token,
    expiresAt: new Date(access.expiresAt).toISOString()
  };
}

function normalizeSummerCaseRequestId(value) {
  const requestId = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)
    ? requestId
    : "";
}

function caseOpenConfig(caseKind) {
  if (caseKind === "summer") {
    return {
      kind: "summer",
      title: "кейс лета",
      rewards: SUMMER_CASE_REWARDS,
      roll: rollSummerCaseReward,
      stockColumn: "summer_cases",
      stockPayloadKey: "summerCases"
    };
  }
  if (caseKind === "tropical") {
    return {
      kind: "tropical",
      title: "тропический кейс",
      rewards: TROPICAL_CASE_REWARDS,
      roll: rollTropicalCaseReward,
      stockColumn: "tropical_cases",
      stockPayloadKey: "tropicalCases"
    };
  }
  return null;
}

function caseGrantCatalogItem(grant) {
  if (grant?.kind === "wear") {
    return clone(findWearCatalogItem(grant.slot, grant.sname));
  }
  if (grant?.kind === "weapon") {
    const item = canonicalWeaponsById.get(Number(grant.id));
    if (!item) throw new Error(`Case weapon not found: ${grant.id}`);
    return clone(item);
  }
  return null;
}

function caseRewardCatalogItems(reward) {
  const grants = reward?.grant?.kind === "bundle"
    ? reward.grant.items
    : [reward?.grant];
  return (grants || [])
    .map(caseGrantCatalogItem)
    .filter(Boolean);
}

function caseDismantleYield(rarity) {
  const ranges = rarity === "common"
    ? { coins: [150, 300], experience: [150, 300], fragments: [10, 20] }
    : (rarity === "epic"
      ? { coins: [750, 1500], experience: [750, 1500], fragments: [50, 100] }
      : { coins: [2000, 4000], experience: [2000, 4000], fragments: [200, 400] });
  return {
    coins: crypto.randomInt(ranges.coins[0], ranges.coins[1] + 1),
    experience: crypto.randomInt(ranges.experience[0], ranges.experience[1] + 1),
    fragments: crypto.randomInt(ranges.fragments[0], ranges.fragments[1] + 1)
  };
}

function caseDropPayload(reward, awardedItems = [], chanceBasisPoints = 0) {
  const itemKeys = awardedItems.map(inventoryItemKey);
  const dismantle = caseDismantleYield(reward.rarity);
  if (reward?.grant?.kind === "special_fragments") {
    dismantle.fragments = Math.min(
      dismantle.fragments,
      Math.max(0, Math.trunc(Number(reward.grant.amount || 0)))
    );
  }
  const payload = {
    key: reward.key,
    name: reward.name,
    rarity: reward.rarity,
    kind: reward.grant.kind,
    chanceBasisPoints: Number(chanceBasisPoints),
    itemKeys,
    dismantle,
    resolution: null
  };
  if (itemKeys.length === 1) payload.itemKey = itemKeys[0];
  if (["coins", "experience", "special_fragments", "case_stock"].includes(reward.grant.kind)) {
    payload.amount = Number(reward.grant.amount);
  }
  if (reward.grant.kind === "case_stock") payload.caseKind = reward.grant.caseKind;
  return payload;
}

function caseOpeningResolutionData(value) {
  const parsed = jsonValue(value, {});
  const decisions = parsed.decisions && typeof parsed.decisions === "object"
    ? parsed.decisions
    : {};
  return { ...parsed, decisions };
}

function caseOpeningPayload(resultData, resolutionData) {
  const result = jsonValue(resultData, {});
  const opening = result.caseOpening && typeof result.caseOpening === "object"
    ? result.caseOpening
    : null;
  if (!opening || !Array.isArray(opening.drops)) return null;
  const resolution = caseOpeningResolutionData(resolutionData);
  const legacyDecision = resolution.legacyGranted
    ? { action: "claim", legacyGranted: true, resolvedAt: resolution.legacyGrantedAt || null }
    : null;
  const drops = opening.drops.map((drop, index) => {
    const dismantle = drop?.dismantle && typeof drop.dismantle === "object"
      ? { ...drop.dismantle }
      : {};
    if (String(drop?.kind || "") === "special_fragments") {
      dismantle.fragments = Math.min(
        Math.max(0, Math.trunc(Number(dismantle.fragments || 0))),
        Math.max(0, Math.trunc(Number(drop.amount || 0)))
      );
    }
    return {
      ...drop,
      dismantle,
      resolution: resolution.decisions[String(index)] || legacyDecision
    };
  });
  const resolvedCount = drops.filter((drop) => drop.resolution).length;
  return {
    ...opening,
    drops,
    resolvedCount,
    pendingCount: drops.length - resolvedCount,
    completed: resolvedCount === drops.length
  };
}

async function pendingCaseOpeningForPlayer(client, playerId) {
  const result = await client.query(
    `SELECT result_data, resolution_data
     FROM player_case_openings
     WHERE player_id = $1 AND resolved_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [Number(playerId)]
  );
  const row = result.rows[0] || null;
  return row ? caseOpeningPayload(row.result_data, row.resolution_data) : null;
}

async function openBattlePassCase(body = {}) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const parsedAccess = parseSummerCaseAccessToken(body.token);
  const requestId = normalizeSummerCaseRequestId(body.requestId);
  const caseKind = String(body.caseKind || "summer");
  const config = caseOpenConfig(caseKind);
  const amount = Number(body.amount || 1);
  if (!parsedAccess) return { ok: false, status: 403, error: "case_access_invalid" };
  if (!requestId || !config || ![1, 10].includes(amount)) {
    return { ok: false, status: 400, error: "case_open_request_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const playerResult = await client.query(
      `SELECT id, name, cckey, money, level, exp
       FROM players
       WHERE id = $1
       FOR UPDATE`,
      [parsedAccess.playerId]
    );
    const player = playerResult.rows[0] || null;
    if (!player || !verifyParsedSummerCaseAccessToken(parsedAccess, player.cckey)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "case_access_invalid" };
    }
    if (await activePlayerBan(parsedAccess.playerId, client)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "account_banned" };
    }

    const state = await loadStoreEntitlements(client, parsedAccess.playerId, true);
    if (!state) {
      await client.query("ROLLBACK");
      return { ok: false, status: 500, error: "store_entitlement_unavailable" };
    }

    const previousResult = await client.query(
      `SELECT case_kind, case_amount, result_data, resolution_data
       FROM player_case_openings
       WHERE player_id = $1 AND request_id = $2`,
      [parsedAccess.playerId, requestId]
    );
    const previous = previousResult.rows[0] || null;
    if (previous) {
      if (String(previous.case_kind) !== caseKind || Number(previous.case_amount) !== amount) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "case_request_conflict" };
      }
      const caseOpening = caseOpeningPayload(previous.result_data, previous.resolution_data);
      await client.query("COMMIT");
      return {
        ...jsonValue(previous.result_data, {}),
        caseOpening,
        battlePass: storeEntitlementPayload(state),
        replayed: true
      };
    }

    const pendingOpening = await pendingCaseOpeningForPlayer(client, parsedAccess.playerId);
    if (pendingOpening) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: "case_opening_pending",
        battlePass: storeEntitlementPayload(state),
        caseOpening: pendingOpening
      };
    }

    const stockBefore = Number(state[config.stockColumn] || 0);
    if (stockBefore < amount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: `${caseKind}_case_stock_insufficient` };
    }

    const openingResult = await client.query(
      `INSERT INTO player_case_openings (
         player_id, request_id, case_kind, case_amount, result_data
       )
       VALUES ($1, $2, $3, $4, '{}'::jsonb)
       RETURNING id`,
      [parsedAccess.playerId, requestId, caseKind, amount]
    );
    const openingId = Number(openingResult.rows[0].id);

    const rewardItems = new Map();
    for (const reward of config.rewards) {
      const items = caseRewardCatalogItems(reward);
      if (items.length) rewardItems.set(reward.key, items);
    }
    const uniqueItemKeys = [...new Set(
      [...rewardItems.values()].flat().map(inventoryItemKey)
    )];
    const ownedResult = await client.query(
      `SELECT item_key
       FROM player_inventory
       WHERE player_id = $1 AND item_key = ANY($2::text[])`,
      [parsedAccess.playerId, uniqueItemKeys]
    );
    const unavailableItemKeys = new Set(
      ownedResult.rows.map((row) => String(row.item_key))
    );

    const drops = [];
    const chanceBasisPoints = [];
    for (let index = 0; index < amount; index += 1) {
      const rolled = config.roll({
        isAvailable: (reward) => {
          const items = rewardItems.get(reward.key) || [];
          return !items.length || items.some(
            item => !unavailableItemKeys.has(inventoryItemKey(item))
          );
        }
      });
      const reward = rolled.reward;
      const selectedItems = (rewardItems.get(reward.key) || []).filter(
        item => !unavailableItemKeys.has(inventoryItemKey(item))
      );
      const rolledChanceBasisPoints = Number(
        rolled.selectedTierChanceBasisPoints ??
        rolled.legendaryChanceBasisPoints ??
        rolled.bundleChanceBasisPoints ??
        0
      );
      chanceBasisPoints.push(rolledChanceBasisPoints);
      drops.push(caseDropPayload(reward, selectedItems, rolledChanceBasisPoints));
      if (selectedItems.length) {
        for (const item of selectedItems) {
          const itemKey = inventoryItemKey(item);
          unavailableItemKeys.add(itemKey);
        }
      }
    }

    const stateResult = await client.query(
      `UPDATE player_store_entitlements
       SET ${config.stockColumn} = ${config.stockColumn} - $2,
           updated_at = now()
       WHERE player_id = $1
       RETURNING *`,
      [parsedAccess.playerId, amount]
    );
    const battlePass = storeEntitlementPayload(stateResult.rows[0]);
    const response = {
      ok: true,
      battlePass,
      caseOpening: {
        requestId,
        caseKind,
        amount,
        drops,
        chanceBasisPoints,
        resolvedCount: 0,
        pendingCount: drops.length,
        completed: false
      }
    };
    await client.query(
      `UPDATE player_case_openings
       SET result_data = $2::jsonb
       WHERE id = $1`,
      [openingId, JSON.stringify(response)]
    );
    await auditGameEvent(client, {
      playerId: parsedAccess.playerId,
      playerName: String(player.name || ""),
      eventType: `${caseKind}_case_opened`,
      category: "economy",
      severity: drops.some((drop) => ["bundle", "legendary"].includes(drop.rarity)) ? "notice" : "info",
      description: `Открыт ${config.title} x${amount}`,
      oldValue: {
        [config.stockPayloadKey]: stockBefore
      },
      newValue: {
        [config.stockPayloadKey]: battlePass[config.stockPayloadKey],
        drops
      },
      metadata: { requestId, openingId, caseKind, chanceBasisPoints }
    });
    await client.query("COMMIT");

    const fresh = await loadPostgresAccount(parsedAccess.playerId);
    if (fresh) store.accounts[String(fresh.id)] = fresh;
    console.log(
      `[case-open] player=${parsedAccess.playerId} request=${requestId} kind=${caseKind} amount=${amount} ` +
      `drops=${drops.map((drop) => drop.key).join(",")} cases=${stockBefore}->${battlePass[config.stockPayloadKey]} ` +
      "resolution=pending"
    );
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[case-open] failed player=${parsedAccess.playerId} request=${requestId} kind=${caseKind}`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function resolveBattlePassCaseReward(body = {}) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const parsedAccess = parseSummerCaseAccessToken(body.token);
  const requestId = normalizeSummerCaseRequestId(body.requestId);
  const dropIndex = Number(body.dropIndex);
  const action = String(body.action || "");
  if (!parsedAccess) return { ok: false, status: 403, error: "case_access_invalid" };
  if (!requestId || !Number.isInteger(dropIndex) || dropIndex < 0 ||
      !["claim", "dismantle"].includes(action)) {
    return { ok: false, status: 400, error: "case_resolution_request_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const playerResult = await client.query(
      `SELECT id, name, cckey, money, level, exp
       FROM players
       WHERE id = $1
       FOR UPDATE`,
      [parsedAccess.playerId]
    );
    const player = playerResult.rows[0] || null;
    if (!player || !verifyParsedSummerCaseAccessToken(parsedAccess, player.cckey)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "case_access_invalid" };
    }
    if (await activePlayerBan(parsedAccess.playerId, client)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "account_banned" };
    }

    const state = await loadStoreEntitlements(client, parsedAccess.playerId, true);
    const openingResult = await client.query(
      `SELECT id, case_kind, case_amount, result_data, resolution_data, resolved_at
       FROM player_case_openings
       WHERE player_id = $1 AND request_id = $2
       FOR UPDATE`,
      [parsedAccess.playerId, requestId]
    );
    const openingRow = openingResult.rows[0] || null;
    if (!state || !openingRow) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "case_opening_not_found" };
    }

    const config = caseOpenConfig(String(openingRow.case_kind));
    const resultData = jsonValue(openingRow.result_data, {});
    const opening = resultData.caseOpening;
    const drops = Array.isArray(opening?.drops) ? opening.drops : [];
    if (!config || dropIndex >= drops.length || drops.length !== Number(openingRow.case_amount)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "case_opening_data_invalid" };
    }

    const resolutionData = caseOpeningResolutionData(openingRow.resolution_data);
    const decisionKey = String(dropIndex);
    const existingDecision = resolutionData.decisions[decisionKey] || null;
    if (existingDecision) {
      const caseOpening = caseOpeningPayload(resultData, resolutionData);
      await client.query("COMMIT");
      return {
        ok: true,
        replayed: true,
        battlePass: storeEntitlementPayload(state),
        caseOpening,
        caseResolution: existingDecision
      };
    }

    const drop = drops[dropIndex];
    const reward = config.rewards.find((entry) => entry.key === String(drop.key || ""));
    if (!reward || reward.grant.kind !== String(drop.kind || "")) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "case_reward_contract_invalid" };
    }

    let coinsAdded = 0;
    let experienceAdded = 0;
    let fragmentsRequested = 0;
    let summerCasesAdded = 0;
    let tropicalCasesAdded = 0;
    const itemGrants = [];
    if (action === "dismantle") {
      coinsAdded = Math.max(0, Math.trunc(Number(drop.dismantle?.coins || 0)));
      experienceAdded = Math.max(0, Math.trunc(Number(drop.dismantle?.experience || 0)));
      fragmentsRequested = Math.max(0, Math.trunc(Number(drop.dismantle?.fragments || 0)));
      if (reward.grant.kind === "special_fragments") {
        fragmentsRequested = Math.min(
          fragmentsRequested,
          Math.max(0, Math.trunc(Number(reward.grant.amount || 0)))
        );
      }
      if (coinsAdded > 4000 || experienceAdded > 4000 || fragmentsRequested > 400) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "case_dismantle_contract_invalid" };
      }
    } else if (["wear", "weapon", "bundle"].includes(reward.grant.kind)) {
      const allowedItemKeys = new Set((drop.itemKeys || []).map(String));
      for (const item of caseRewardCatalogItems(reward)) {
        const itemKey = inventoryItemKey(item);
        if (allowedItemKeys.has(itemKey)) itemGrants.push({ item, itemKey });
      }
    } else if (reward.grant.kind === "coins") {
      coinsAdded = Number(reward.grant.amount);
    } else if (reward.grant.kind === "experience") {
      experienceAdded = Number(reward.grant.amount);
    } else if (reward.grant.kind === "special_fragments") {
      fragmentsRequested = Number(reward.grant.amount);
    } else if (reward.grant.kind === "case_stock") {
      if (reward.grant.caseKind === "summer") summerCasesAdded = Number(reward.grant.amount);
      if (reward.grant.caseKind === "tropical") tropicalCasesAdded = Number(reward.grant.amount);
    } else {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "case_reward_grant_unsupported" };
    }

    const balanceBefore = Number(player.money || 0);
    const balanceAfter = balanceBefore + coinsAdded;
    const expBefore = Number(player.exp || 0);
    const summerCasesAfter = Number(state.summer_cases || 0) + summerCasesAdded;
    const tropicalCasesAfter = Number(state.tropical_cases || 0) + tropicalCasesAdded;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter > 2_147_483_647 ||
        !Number.isSafeInteger(expBefore + experienceAdded) || expBefore + experienceAdded > 2_147_483_647 ||
        !Number.isSafeInteger(summerCasesAfter) || summerCasesAfter > 2_147_483_647 ||
        !Number.isSafeInteger(tropicalCasesAfter) || tropicalCasesAfter > 2_147_483_647) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "account_progress_limit_reached" };
    }

    for (const grant of itemGrants) {
      await client.query(
        `INSERT INTO player_inventory (
           player_id, item_key, item_type, item_data, updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [parsedAccess.playerId, grant.itemKey, Number(grant.item.itype), JSON.stringify(grant.item)]
      );
      await client.query(
        `INSERT INTO player_pending_inventory_deliveries (
           player_id, order_id, case_opening_id, item_key, item_data
         )
         VALUES ($1, NULL, $2, $3, $4::jsonb)
         ON CONFLICT (case_opening_id, item_key)
           WHERE case_opening_id IS NOT NULL
         DO NOTHING`,
        [parsedAccess.playerId, Number(openingRow.id), grant.itemKey, JSON.stringify(grant.item)]
      );
      await client.query(
        `INSERT INTO purchase_history (
           player_id, item_key, item_type, item_id, price, currency, item_data
         )
         VALUES ($1, $2, $3, $4, 0, 'case', $5::jsonb)`,
        [
          parsedAccess.playerId,
          grant.itemKey,
          Number(grant.item.itype),
          inventoryItemId(grant.item),
          JSON.stringify(grant.item)
        ]
      );
    }

    if (coinsAdded > 0) {
      await client.query(
        "UPDATE players SET money = $2, updated_at = now() WHERE id = $1",
        [parsedAccess.playerId, balanceAfter]
      );
    }
    const experienceState = experienceAdded > 0
      ? await awardPlayerExperience(
        client,
        parsedAccess.playerId,
        experienceAdded,
        action === "dismantle" ? "case_dismantle" : `${config.kind}_case_claim`
      )
      : null;

    const fragmentsBefore = Number(state.special_case_fragments || 0);
    const fragmentsAfter = Math.min(2000, fragmentsBefore + fragmentsRequested);
    const fragmentsAdded = fragmentsAfter - fragmentsBefore;
    const stateResult = await client.query(
      `UPDATE player_store_entitlements
       SET summer_cases = summer_cases + $2,
           tropical_cases = tropical_cases + $3,
           special_case_fragments = $4,
           updated_at = now()
       WHERE player_id = $1
       RETURNING *`,
      [
        parsedAccess.playerId,
        summerCasesAdded,
        tropicalCasesAdded,
        fragmentsAfter
      ]
    );
    const battlePass = storeEntitlementPayload(stateResult.rows[0]);
    const decision = {
      dropIndex,
      action,
      rewardKey: reward.key,
      rewardName: reward.name,
      resolvedAt: new Date().toISOString(),
      award: {
        itemKeys: itemGrants.map((grant) => grant.itemKey),
        coins: coinsAdded,
        experience: experienceAdded,
        fragments: fragmentsAdded,
        cases: summerCasesAdded > 0
          ? { caseKind: "summer", amount: summerCasesAdded }
          : (tropicalCasesAdded > 0
            ? { caseKind: "tropical", amount: tropicalCasesAdded }
            : null)
      }
    };
    resolutionData.decisions[decisionKey] = decision;
    const resolvedCount = Object.keys(resolutionData.decisions).length;
    const completed = resolvedCount === drops.length;
    await client.query(
      `UPDATE player_case_openings
       SET resolution_data = $2::jsonb,
           resolved_at = CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id = $1`,
      [Number(openingRow.id), JSON.stringify(resolutionData), completed]
    );

    const caseOpening = caseOpeningPayload(resultData, resolutionData);
    await auditGameEvent(client, {
      playerId: parsedAccess.playerId,
      playerName: String(player.name || ""),
      eventType: action === "dismantle" ? "case_reward_dismantled" : "case_reward_claimed",
      category: "economy",
      severity: ["bundle", "legendary"].includes(reward.rarity) ? "notice" : "info",
      description: action === "dismantle"
        ? `Разобрана награда ${reward.name}`
        : `Получена награда ${reward.name}`,
      oldValue: {
        balance: balanceBefore,
        exp: expBefore,
        specialCaseFragments: fragmentsBefore
      },
      newValue: {
        balance: balanceAfter,
        exp: experienceState?.exp ?? expBefore,
        specialCaseFragments: fragmentsAfter,
        award: decision.award
      },
      metadata: { requestId, openingId: Number(openingRow.id), dropIndex, action }
    });
    await client.query("COMMIT");

    const fresh = await loadPostgresAccount(parsedAccess.playerId);
    if (fresh) store.accounts[String(fresh.id)] = fresh;
    console.log(
      `[case-resolve] player=${parsedAccess.playerId} request=${requestId} index=${dropIndex} ` +
      `action=${action} reward=${reward.key} coins=${coinsAdded} xp=${experienceAdded} ` +
      `fragments=${fragmentsAdded} completed=${completed}`
    );
    return {
      ok: true,
      battlePass,
      caseOpening,
      caseResolution: decision
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(
      `[case-resolve] failed player=${parsedAccess.playerId} request=${requestId} index=${dropIndex}`,
      error
    );
    throw error;
  } finally {
    client.release();
  }
}

async function loadDonateLimitedStock(client, productIdValue, lock = false) {
  const productId = normalizeDonateProductId(productIdValue);
  if (!productId) return null;
  const result = await client.query(
    `SELECT product_id, capacity, remaining, updated_at
     FROM donate_limited_stock
     WHERE product_id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [productId]
  );
  return result.rows[0] || null;
}

async function ownedDonateWearSetKeys(client, playerId, setItems) {
  const itemKeys = setItems.map(inventoryItemKey);
  if (!itemKeys.length) return [];
  const result = await client.query(
    `SELECT item_key
     FROM player_inventory
     WHERE player_id = $1
       AND item_key = ANY($2::text[])`,
    [Number(playerId), itemKeys]
  );
  return result.rows.map((row) => String(row.item_key));
}

async function validateStoreProductEligibility(client, playerId, product) {
  const rewardKind = String(product.reward_kind || "coins");
  const rewardAmount = Number(product.reward_amount || product.coins || 0);
  if (rewardKind === "coins" ||
      rewardKind === "case_tropical" ||
      rewardKind === "case_summer") {
    return { ok: true };
  }

  if (rewardKind === "wear_set") {
    const setItems = donateWearSetItems(rewardAmount);
    if (!setItems?.length) {
      return { ok: false, status: 409, error: "store_reward_unsupported" };
    }
    const ownedKeys = await ownedDonateWearSetKeys(client, playerId, setItems);
    if (ownedKeys.length === setItems.length) {
      return { ok: false, status: 409, error: "clothing_set_already_owned" };
    }
    return { ok: true };
  }

  const state = await loadStoreEntitlements(client, playerId, true);
  if (!state) {
    return { ok: false, status: 500, error: "store_entitlement_unavailable" };
  }
  if (rewardKind === "battle_pass_premium" &&
      Boolean(state.battle_pass_premium)) {
    return { ok: false, status: 409, error: "battle_pass_already_owned" };
  }
  if (rewardKind === "battle_pass_premium_plus" &&
      Boolean(state.battle_pass_premium_plus)) {
    return { ok: false, status: 409, error: "battle_pass_plus_already_owned" };
  }
  if ((rewardKind === "battle_pass_levels" ||
       rewardKind === "battle_pass_premium_plus") &&
      Number(state.battle_pass_level) + rewardAmount > 100) {
    return { ok: false, status: 409, error: "battle_pass_level_limit" };
  }
  return { ok: true };
}

async function createDonateOrder(telegramUserIdValue, rawProductId) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const telegramUserId = Number(telegramUserIdValue || 0);
  const productId = normalizeDonateProductId(rawProductId);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    return { ok: false, status: 400, error: "telegram_user_invalid" };
  }
  if (!productId) return { ok: false, status: 400, error: "donate_product_invalid" };

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE donate_orders
       SET status = CASE
             WHEN expires_at <= now() THEN 'expired'
             ELSE 'cancelled'
           END,
           updated_at = now()
       WHERE telegram_user_id = $1
          AND status = 'pending'
          AND limited_stock_reserved_at IS NULL`,
      [telegramUserId]
    );
    const bindingResult = await client.query(
      `SELECT b.player_id, p.name AS player_name
       FROM launcher_telegram_bindings b
       JOIN players p ON p.id = b.player_id
       WHERE b.telegram_user_id = $1
       FOR UPDATE OF b`,
      [telegramUserId]
    );
    const binding = bindingResult.rows[0] || null;
    if (!binding) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "telegram_account_not_linked" };
    }
    const productResult = await client.query(
      `SELECT p.id, p.title, p.reward_kind, p.reward_amount,
              p.coins, p.rubles, p.stars, p.active,
              stock.remaining AS stock_remaining,
              stock.capacity AS stock_capacity
       FROM donate_products p
       LEFT JOIN donate_limited_stock stock ON stock.product_id = p.id
       WHERE p.id = $1
       FOR SHARE OF p`,
      [productId]
    );
    const product = productResult.rows[0] || null;
    if (!product || !product.active) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "donate_product_not_found" };
    }
    if (String(product.reward_kind) === "wear_set") {
      if (Number(product.stock_capacity || 0) <= 0) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "donate_stock_unavailable" };
      }
      if (Number(product.stock_remaining || 0) <= 0) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "donate_product_sold_out" };
      }
      const reservedResult = await client.query(
        `SELECT 1
         FROM donate_orders
         WHERE player_id = $1
           AND product_id = $2
           AND status = 'pending'
           AND limited_stock_reserved_at IS NOT NULL
         LIMIT 1`,
        [Number(binding.player_id), productId]
      );
      if (reservedResult.rowCount > 0) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "donate_checkout_pending" };
      }
    }
    const eligibility = await validateStoreProductEligibility(
      client,
      Number(binding.player_id),
      product
    );
    if (!eligibility.ok) {
      await client.query("ROLLBACK");
      return eligibility;
    }

    const orderId = randomOpaqueId("do");
    const expiresAt = new Date(Date.now() + DONATE_ORDER_TTL_MS);
    const orderResult = await client.query(
       `INSERT INTO donate_orders (
         id, player_id, telegram_user_id, product_id,
         product_title, reward_kind, reward_amount,
         coins, rubles, stars, status, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
       RETURNING *`,
      [
        orderId,
        Number(binding.player_id),
        telegramUserId,
        String(product.id),
        String(product.title),
        String(product.reward_kind),
        Number(product.reward_amount),
        Number(product.coins),
        Number(product.rubles),
        Number(product.stars),
        expiresAt
      ]
    );
    await client.query("COMMIT");
    return {
      ok: true,
       order: donateOrderPayload({
         ...orderResult.rows[0],
         player_name: binding.player_name,
         stock_remaining: product.stock_remaining,
         stock_capacity: product.stock_capacity
       })
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function reserveLimitedStockForOrder(client, order) {
  if (String(order.reward_kind || "") !== "wear_set") {
    return { ok: true, stock: null };
  }

  const stock = await loadDonateLimitedStock(
    client,
    String(order.product_id || ""),
    true
  );
  if (!stock) {
    return { ok: false, status: 409, error: "donate_stock_unavailable" };
  }

  if (order.limited_stock_reserved_at) {
    return {
      ok: true,
      stock: {
        remaining: Number(stock.remaining),
        capacity: Number(stock.capacity)
      }
    };
  }
  if (Number(stock.remaining) <= 0) {
    return { ok: false, status: 409, error: "donate_product_sold_out" };
  }

  const stockResult = await client.query(
    `UPDATE donate_limited_stock
     SET remaining = remaining - 1,
         updated_at = now()
     WHERE product_id = $1
       AND remaining > 0
     RETURNING remaining, capacity`,
    [String(order.product_id)]
  );
  const updatedStock = stockResult.rows[0] || null;
  if (!updatedStock) {
    return { ok: false, status: 409, error: "donate_product_sold_out" };
  }

  const reservationResult = await client.query(
    `UPDATE donate_orders
     SET limited_stock_reserved_at = now(),
         updated_at = now()
     WHERE id = $1
       AND limited_stock_reserved_at IS NULL
     RETURNING limited_stock_reserved_at`,
    [String(order.id)]
  );
  const reservation = reservationResult.rows[0] || null;
  if (!reservation) {
    throw new Error("donate_stock_reservation_conflict");
  }
  order.limited_stock_reserved_at = reservation.limited_stock_reserved_at;
  return {
    ok: true,
    stock: {
      remaining: Number(updatedStock.remaining),
      capacity: Number(updatedStock.capacity)
    }
  };
}

async function validateDonateCheckout(orderIdValue, telegramUserIdValue, currencyValue, totalAmountValue) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const orderId = normalizeDonateOrderId(orderIdValue);
  const telegramUserId = Number(telegramUserIdValue || 0);
  const currency = String(currencyValue || "");
  const totalAmount = Number(totalAmountValue || 0);
  if (!orderId ||
      !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 ||
      currency !== "XTR" ||
      !Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    return { ok: false, status: 400, error: "donate_checkout_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT o.*, p.name AS player_name
       FROM donate_orders o
       JOIN players p ON p.id = o.player_id
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId]
    );
    const order = result.rows[0] || null;
    if (!order) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "donate_order_not_found" };
    }
    if (order.status !== "pending") {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: order.status === "paid" ? "donate_order_already_paid" : "donate_order_unavailable"
      };
    }
    if (!order.limited_stock_reserved_at &&
        new Date(order.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE donate_orders
         SET status = 'expired', updated_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [orderId]
      );
      await client.query("COMMIT");
      return { ok: false, status: 410, error: "donate_order_expired" };
    }
    if (Number(order.telegram_user_id) !== telegramUserId ||
        Number(order.stars) !== totalAmount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "donate_checkout_mismatch" };
    }
    const eligibility = await validateStoreProductEligibility(
      client,
      Number(order.player_id),
      order
    );
    if (!eligibility.ok) {
      await client.query("ROLLBACK");
      return eligibility;
    }
    const reservation = await reserveLimitedStockForOrder(client, order);
    if (!reservation.ok) {
      await client.query("ROLLBACK");
      return reservation;
    }
    if (reservation.stock) {
      order.stock_remaining = reservation.stock.remaining;
      order.stock_capacity = reservation.stock.capacity;
    }
    await client.query("COMMIT");
    return { ok: true, order: donateOrderPayload(order) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function donatePaymentPayload(row, duplicate = false) {
  return {
    ok: true,
    duplicate,
    orderId: String(row.order_id),
    telegramPaymentChargeId: String(row.telegram_payment_charge_id),
    player: {
      id: Number(row.player_id),
      name: String(row.player_name || "")
    },
    product: {
      id: String(row.product_id),
      title: String(row.product_title || ""),
      rewardKind: String(row.reward_kind || "coins"),
      rewardAmount: Number(row.reward_amount || row.coins || 0),
      coins: Number(row.coins),
      rubles: Number(row.rubles),
      stars: Number(row.stars)
    },
    rewardBefore: row.reward_before || {},
    rewardAfter: row.reward_after || {},
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    paidAt: postgresTimestamp(row.telegram_paid_at)
  };
}

async function loadDonatePaymentByCharge(chargeId, executor = pgPool) {
  const result = await executor.query(
    `SELECT dp.*, p.name AS player_name
     FROM donate_payments dp
     JOIN players p ON p.id = dp.player_id
     WHERE dp.telegram_payment_charge_id = $1`,
    [chargeId]
  );
  return result.rows[0] || null;
}

async function applyStoreReward(client, order, player) {
  const rewardKind = String(order.reward_kind || "coins");
  const rewardAmount = Number(order.reward_amount || order.coins || 0);
  const balanceBefore = Number(player.money || 0);

  if (rewardKind === "coins") {
    const balanceAfter = balanceBefore + Number(order.coins);
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter > 2_147_483_647) {
      return { ok: false, status: 409, error: "balance_limit_reached" };
    }
    await client.query(
      "UPDATE players SET money = $2, updated_at = now() WHERE id = $1",
      [Number(order.player_id), balanceAfter]
    );
    return {
      ok: true,
      balanceBefore,
      balanceAfter,
      rewardBefore: { coins: balanceBefore },
      rewardAfter: { coins: balanceAfter }
    };
  }

  if (rewardKind === "wear_set") {
    const setItems = donateWearSetItems(rewardAmount);
    if (!setItems?.length) {
      return { ok: false, status: 409, error: "store_reward_unsupported" };
    }
    const ownedBefore = await ownedDonateWearSetKeys(
      client,
      Number(order.player_id),
      setItems
    );
    const awardedItemKeys = [];
    for (const item of setItems) {
      const itemKey = inventoryItemKey(item);
      awardedItemKeys.push(itemKey);
      await client.query(
        `INSERT INTO player_inventory (
           player_id, item_key, item_type, item_data, updated_at
         )
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET
           item_type = EXCLUDED.item_type,
           item_data = EXCLUDED.item_data,
           updated_at = now()`,
        [
          Number(order.player_id),
          itemKey,
          Number(item.itype),
          JSON.stringify(item)
        ]
      );
      await client.query(
        `INSERT INTO player_pending_inventory_deliveries (
           player_id, order_id, item_key, item_data
         )
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (order_id, item_key) DO NOTHING`,
        [
          Number(order.player_id),
          String(order.id),
          itemKey,
          JSON.stringify(item)
        ]
      );
      await client.query(
        `INSERT INTO purchase_history (
           player_id, item_key, item_type, item_id,
           price, currency, item_data
         )
         VALUES ($1, $2, $3, $4, 0, 'XTR', $5::jsonb)`,
        [
          Number(order.player_id),
          itemKey,
          Number(item.itype),
          inventoryItemId(item),
          JSON.stringify(item)
        ]
      );
    }
    return {
      ok: true,
      balanceBefore,
      balanceAfter: balanceBefore,
      rewardBefore: {
        wearSetId: rewardAmount,
        ownedItemKeys: ownedBefore
      },
      rewardAfter: {
        wearSetId: rewardAmount,
        awardedItemKeys,
        ownedItemCount: awardedItemKeys.length
      }
    };
  }

  const stateRow = await loadStoreEntitlements(
    client,
    Number(order.player_id),
    true
  );
  if (!stateRow) {
    return { ok: false, status: 500, error: "store_entitlement_unavailable" };
  }

  const before = storeEntitlementPayload(stateRow);
  const after = { ...before };
  if (rewardKind === "battle_pass_premium") {
    if (before.battlePassPremium) {
      return { ok: false, status: 409, error: "battle_pass_already_owned" };
    }
    after.battlePassPremium = true;
  } else if (rewardKind === "battle_pass_premium_plus") {
    if (before.battlePassPremiumPlus) {
      return { ok: false, status: 409, error: "battle_pass_plus_already_owned" };
    }
    if (before.battlePassLevel + rewardAmount > 100) {
      return { ok: false, status: 409, error: "battle_pass_level_limit" };
    }
    after.battlePassPremium = true;
    after.battlePassPremiumPlus = true;
    after.battlePassLevel += rewardAmount;
  } else if (rewardKind === "battle_pass_levels") {
    if (before.battlePassLevel + rewardAmount > 100) {
      return { ok: false, status: 409, error: "battle_pass_level_limit" };
    }
    after.battlePassLevel += rewardAmount;
  } else if (rewardKind === "case_tropical") {
    after.tropicalCases += rewardAmount;
  } else if (rewardKind === "case_summer") {
    after.summerCases += rewardAmount;
  } else {
    return { ok: false, status: 409, error: "store_reward_unsupported" };
  }

  if (!Number.isSafeInteger(after.tropicalCases) ||
      !Number.isSafeInteger(after.summerCases) ||
      after.tropicalCases > 2_147_483_647 ||
      after.summerCases > 2_147_483_647) {
    return { ok: false, status: 409, error: "store_inventory_limit" };
  }

  await client.query(
    `UPDATE player_store_entitlements
     SET battle_pass_level = $2,
         battle_pass_premium = $3,
         battle_pass_premium_plus = $4,
         tropical_cases = $5,
         summer_cases = $6,
         updated_at = now()
     WHERE player_id = $1`,
    [
      Number(order.player_id),
      after.battlePassLevel,
      after.battlePassPremium,
      after.battlePassPremiumPlus,
      after.tropicalCases,
      after.summerCases
    ]
  );
  return {
    ok: true,
    balanceBefore,
    balanceAfter: balanceBefore,
    rewardBefore: before,
    rewardAfter: after
  };
}

async function settleDonatePayment(body) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const orderId = normalizeDonateOrderId(body?.orderId);
  const telegramUserId = Number(body?.telegramUserId || 0);
  const currency = String(body?.currency || "");
  const totalAmount = Number(body?.totalAmount || 0);
  const telegramPaymentChargeId = String(body?.telegramPaymentChargeId || "").trim();
  const providerPaymentChargeId = String(body?.providerPaymentChargeId || "").trim();
  const telegramPaidAtValue = String(body?.paidAt || "");
  const telegramPaidAtMs = Date.parse(telegramPaidAtValue);
  if (!orderId ||
      !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 ||
      currency !== "XTR" ||
      !Number.isSafeInteger(totalAmount) || totalAmount <= 0 ||
      !telegramPaymentChargeId || telegramPaymentChargeId.length > 512 ||
      providerPaymentChargeId.length > 512 ||
      !Number.isFinite(telegramPaidAtMs)) {
    return { ok: false, status: 400, error: "donate_payment_invalid" };
  }

  const client = await pgPool.connect();
  let committedPayment = null;
  try {
    await client.query("BEGIN");
    const duplicate = await loadDonatePaymentByCharge(telegramPaymentChargeId, client);
    if (duplicate) {
      if (String(duplicate.order_id) !== orderId ||
          Number(duplicate.telegram_user_id) !== telegramUserId ||
          Number(duplicate.stars) !== totalAmount) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "donate_payment_charge_conflict" };
      }
      await client.query("COMMIT");
      return donatePaymentPayload(duplicate, true);
    }

    const orderResult = await client.query(
      `SELECT o.*, p.name AS player_name
       FROM donate_orders o
       JOIN players p ON p.id = o.player_id
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId]
    );
    const order = orderResult.rows[0] || null;
    if (!order) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "donate_order_not_found" };
    }
    if (order.status === "paid") {
      const previousResult = await client.query(
        `SELECT dp.*, p.name AS player_name
         FROM donate_payments dp
         JOIN players p ON p.id = dp.player_id
         WHERE dp.order_id = $1`,
        [orderId]
      );
      const previous = previousResult.rows[0] || null;
      await client.query("COMMIT");
      if (previous &&
          String(previous.telegram_payment_charge_id) === telegramPaymentChargeId &&
          Number(previous.telegram_user_id) === telegramUserId &&
          Number(previous.stars) === totalAmount) {
        return donatePaymentPayload(previous, true);
      }
      return { ok: false, status: 409, error: "donate_order_already_paid" };
    }
    if ((order.status !== "pending" && order.status !== "expired") ||
        Number(order.telegram_user_id) !== telegramUserId ||
        Number(order.stars) !== totalAmount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "donate_payment_mismatch" };
    }

    const reservation = await reserveLimitedStockForOrder(client, order);
    if (!reservation.ok) {
      await client.query("ROLLBACK");
      return reservation;
    }

    const playerResult = await client.query(
      "SELECT id, name, money FROM players WHERE id = $1 FOR UPDATE",
      [Number(order.player_id)]
    );
    const player = playerResult.rows[0] || null;
    if (!player) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "player_not_found" };
    }
    const reward = await applyStoreReward(client, order, player);
    if (!reward.ok) {
      await client.query("ROLLBACK");
      return reward;
    }
    if (reservation.stock) {
      reward.rewardAfter = {
        ...reward.rewardAfter,
        stock: reservation.stock
      };
    }
    const balanceBefore = reward.balanceBefore;
    const balanceAfter = reward.balanceAfter;
    const paymentResult = await client.query(
      `INSERT INTO donate_payments (
         telegram_payment_charge_id, provider_payment_charge_id,
         order_id, player_id, telegram_user_id, product_id,
         product_title, reward_kind, reward_amount,
         currency, stars, coins, rubles,
         reward_before, reward_after,
         balance_before, balance_after, telegram_paid_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         'XTR', $10, $11, $12,
         $13, $14,
         $15, $16, $17
       )
       RETURNING *`,
      [
        telegramPaymentChargeId,
        providerPaymentChargeId,
        orderId,
        Number(order.player_id),
        telegramUserId,
        String(order.product_id),
        String(order.product_title),
        String(order.reward_kind),
        Number(order.reward_amount),
        Number(order.stars),
        Number(order.coins),
        Number(order.rubles),
        reward.rewardBefore,
        reward.rewardAfter,
        balanceBefore,
        balanceAfter,
        new Date(telegramPaidAtMs)
      ]
    );
    await client.query(
      `UPDATE donate_orders
       SET status = 'paid',
           telegram_payment_charge_id = $2,
           paid_at = $3,
           limited_stock_consumed_at = CASE
             WHEN $4::boolean THEN COALESCE(limited_stock_consumed_at, now())
             ELSE limited_stock_consumed_at
           END,
           updated_at = now()
       WHERE id = $1`,
      [
        orderId,
        telegramPaymentChargeId,
        new Date(telegramPaidAtMs),
        String(order.reward_kind) === "wear_set"
      ]
    );
    await writeAuditEvent(client, {
      playerId: Number(order.player_id),
      playerName: String(player.name || order.player_name || ""),
      eventType: "telegram_stars_donate",
      category: "economy",
      severity: "notice",
      description:
        `Telegram Stars: выдано «${String(order.product_title)}» ` +
        `за ${Number(order.stars)} ⭐`,
      oldValue: reward.rewardBefore,
      newValue: {
        ...reward.rewardAfter,
        productId: String(order.product_id)
      },
      source: "telegram_stars",
      metadata: {
        orderId,
        telegramUserId,
        telegramPaymentChargeId,
        stars: Number(order.stars),
        rubles: Number(order.rubles),
        rewardKind: String(order.reward_kind),
        rewardAmount: Number(order.reward_amount)
      }
    });
    await client.query("COMMIT");
    committedPayment = {
      ...paymentResult.rows[0],
      player_name: player.name
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") {
      const duplicate = await loadDonatePaymentByCharge(telegramPaymentChargeId);
      if (duplicate) {
        if (String(duplicate.order_id) === orderId &&
            Number(duplicate.telegram_user_id) === telegramUserId &&
            Number(duplicate.stars) === totalAmount) {
          return donatePaymentPayload(duplicate, true);
        }
        return {
          ok: false,
          status: 409,
          error: "donate_payment_charge_conflict"
        };
      }
    }
    throw error;
  } finally {
    client.release();
  }

  if (String(committedPayment.reward_kind) === "wear_set") {
    const fresh = await loadPostgresAccount(Number(committedPayment.player_id));
    if (fresh) {
      store.accounts[String(fresh.id)] = fresh;
    }
  } else {
    const cached = store.accounts[String(committedPayment.player_id)];
    if (cached) {
      cached.money = Number(committedPayment.balance_after);
      cached.updatedAt = new Date().toISOString();
    }
  }
  console.log(
    `[store] player=${committedPayment.player_id} order=${orderId} ` +
    `product=${committedPayment.product_id} stars=${committedPayment.stars} ` +
    `reward=${committedPayment.reward_kind}:${committedPayment.reward_amount} ` +
    `balance=${committedPayment.balance_after}`
  );
  return donatePaymentPayload(committedPayment, false);
}

async function createBotTelegramPairingCode(rawUser, chatIdValue) {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const telegramUser = normalizeTelegramIdentity(rawUser);
  const chatId = Number(chatIdValue || 0);
  if (!telegramUser || !Number.isSafeInteger(chatId) || chatId <= 0) {
    return { ok: false, status: 400, error: "telegram_user_invalid" };
  }

  for (let collisionAttempt = 0; collisionAttempt < 4; collisionAttempt += 1) {
    const code = createTelegramPairingCodeValue();
    const codeHash = telegramPairingCodeHash(code);
    const requestId = randomOpaqueId("pc");
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock_shared($1)",
        [TELEGRAM_RESET_ADVISORY_LOCK]
      );
      const systemState = await telegramSystemState(client);
      if (!systemState) throw new Error("telegram_system_state_missing");
      const bindingResult = await client.query(
        `SELECT b.*, p.name AS player_name
         FROM launcher_telegram_bindings b
         JOIN players p ON p.id = b.player_id
         WHERE b.telegram_user_id = $1
         FOR UPDATE OF b`,
        [telegramUser.id]
      );
      const binding = bindingResult.rows[0] || null;
      let purpose = "link";
      let expectedPlayerId = null;
      let loginRequestId = null;
      if (binding) {
        const loginResult = await client.query(
          `SELECT *
           FROM launcher_telegram_login_requests
           WHERE player_id = $1
             AND expected_telegram_user_id = $2
             AND purpose = 'ip_reverify'
             AND state IN ('pending', 'claimed')
             AND expires_at > now()
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [Number(binding.player_id), telegramUser.id]
        );
        const loginRequest = loginResult.rows[0];
        if (!loginRequest) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            status: 409,
            error: "telegram_already_bound",
            player: {
              id: Number(binding.player_id),
              name: String(binding.player_name || "")
            }
          };
        }
        if (loginRequest.state === "claimed") {
          const claimedResult = await client.query(
            `SELECT request_id, state, expires_at
             FROM launcher_telegram_pairing_codes
             WHERE login_request_id = $1
               AND state = 'claimed'
             LIMIT 1`,
            [String(loginRequest.request_id)]
          );
          await client.query("ROLLBACK");
          return {
            ok: false,
            status: 409,
            error: "telegram_confirmation_pending",
            pairing: claimedResult.rows[0] ? {
              requestId: String(claimedResult.rows[0].request_id),
              state: "claimed",
              expiresAt: postgresTimestamp(claimedResult.rows[0].expires_at)
            } : null
          };
        }
        purpose = "ip_reverify";
        expectedPlayerId = Number(binding.player_id);
        loginRequestId = String(loginRequest.request_id);
      }

      const claimedResult = await client.query(
        `SELECT request_id, state, expires_at
         FROM launcher_telegram_pairing_codes
         WHERE telegram_user_id = $1
           AND state = 'claimed'
           AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 1`,
        [telegramUser.id]
      );
      if (claimedResult.rowCount) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          error: "telegram_confirmation_pending",
          pairing: {
            requestId: String(claimedResult.rows[0].request_id),
            state: "claimed",
            expiresAt: postgresTimestamp(claimedResult.rows[0].expires_at)
          }
        };
      }

      await client.query(
        `UPDATE launcher_telegram_pairing_codes
         SET state = CASE
           WHEN expires_at <= now() THEN 'expired'
           ELSE 'cancelled'
         END,
         updated_at = now()
         WHERE telegram_user_id = $1
           AND state = 'issued'`,
        [telegramUser.id]
      );

      const expiresAt = new Date(Date.now() + TELEGRAM_PAIRING_CODE_TTL_MS);
      await client.query(
        `INSERT INTO launcher_telegram_pairing_codes (
           request_id, code_hash, telegram_user_id,
           telegram_username, telegram_first_name, telegram_last_name,
           purpose, expected_player_id, login_request_id,
           binding_epoch, bot_chat_id, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          requestId,
          codeHash,
          telegramUser.id,
          telegramUser.username,
          telegramUser.firstName,
          telegramUser.lastName,
          purpose,
          expectedPlayerId,
          loginRequestId,
          Number(systemState.binding_epoch),
          chatId,
          expiresAt.toISOString()
        ]
      );
      await client.query("COMMIT");
      return {
        ok: true,
        status: "issued",
        requestId,
        code,
        purpose,
        expiresAt: expiresAt.toISOString(),
        player: binding ? {
          id: Number(binding.player_id),
          name: String(binding.player_name || "")
        } : null
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error?.code === "23505" && collisionAttempt < 3) continue;
      throw error;
    } finally {
      client.release();
    }
  }
  return { ok: false, status: 503, error: "telegram_code_generation_failed" };
}

async function attachBotTelegramPairingMessage(body) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const requestId = normalizeTelegramPairingRequestId(body?.requestId, ["pc"]);
  const telegramUserId = Number(body?.telegramUserId || 0);
  const chatId = Number(body?.chatId || 0);
  const messageId = Number(body?.messageId || 0);
  if (!requestId ||
      !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 ||
      !Number.isSafeInteger(chatId) || chatId <= 0 ||
      !Number.isSafeInteger(messageId) || messageId <= 0) {
    return { ok: false, status: 400, error: "telegram_message_invalid" };
  }
  const result = await pgPool.query(
    `UPDATE launcher_telegram_pairing_codes
     SET bot_chat_id = $3,
         bot_message_id = $4,
         updated_at = now()
     WHERE request_id = $1
       AND telegram_user_id = $2
       AND state IN ('issued', 'claimed')
     RETURNING request_id, state`,
    [requestId, telegramUserId, chatId, messageId]
  );
  if (!result.rowCount) {
    return { ok: false, status: 404, error: "telegram_pairing_not_found" };
  }
  return { ok: true, requestId, state: String(result.rows[0].state) };
}

async function listBotTelegramConfirmations(limitValue = 20) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const limit = Math.max(1, Math.min(100, Number(limitValue) || 20));
  const systemState = await telegramSystemState();
  if (!systemState) return { ok: false, status: 503, error: "telegram_system_state_missing" };
  const result = await pgPool.query(
    `SELECT c.*, p.name AS player_name
     FROM launcher_telegram_pairing_codes c
     JOIN players p ON p.id = c.player_id
     WHERE c.state = 'claimed'
       AND c.confirmation_notified_at IS NULL
       AND c.expires_at > now()
       AND c.binding_epoch = $1
     ORDER BY c.claimed_at ASC
     LIMIT $2`,
    [Number(systemState.binding_epoch), limit]
  );
  return {
    ok: true,
    confirmations: result.rows.map((row) => ({
      requestId: String(row.request_id),
      purpose: String(row.purpose),
      chatId: Number(row.bot_chat_id),
      messageId: row.bot_message_id == null ? null : Number(row.bot_message_id),
      player: {
        id: Number(row.player_id),
        name: String(row.player_name || "")
      },
      telegram: telegramUserPayload(row),
      expiresAt: postgresTimestamp(row.expires_at)
    }))
  };
}

async function markBotTelegramConfirmationNotified(body) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const requestId = normalizeTelegramPairingRequestId(body?.requestId, ["pc"]);
  const telegramUserId = Number(body?.telegramUserId || 0);
  const chatId = Number(body?.chatId || 0);
  const messageId = Number(body?.messageId || 0);
  if (!requestId ||
      !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 ||
      !Number.isSafeInteger(chatId) || chatId <= 0 ||
      !Number.isSafeInteger(messageId) || messageId <= 0) {
    return { ok: false, status: 400, error: "telegram_message_invalid" };
  }
  const result = await pgPool.query(
    `UPDATE launcher_telegram_pairing_codes
     SET bot_chat_id = $3,
         bot_message_id = $4,
         confirmation_notified_at = COALESCE(confirmation_notified_at, now()),
         updated_at = now()
     WHERE request_id = $1
       AND telegram_user_id = $2
       AND state = 'claimed'
     RETURNING request_id`,
    [requestId, telegramUserId, chatId, messageId]
  );
  if (!result.rowCount) {
    return { ok: false, status: 404, error: "telegram_pairing_not_found" };
  }
  return { ok: true, requestId };
}

async function decideTelegramPairing(requestIdValue, rawUser, decisionValue) {
  if (!pgPool || !TELEGRAM_LINK_API_TOKEN) {
    return { ok: false, status: 503, error: "telegram_link_unavailable" };
  }
  const requestId = normalizeTelegramPairingRequestId(requestIdValue, ["pc"]);
  const telegramUser = normalizeTelegramIdentity(rawUser);
  const decision = String(decisionValue || "").toLowerCase();
  if (!requestId || !telegramUser || !["confirm", "reject"].includes(decision)) {
    return { ok: false, status: 400, error: "telegram_pairing_invalid" };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock_shared($1)",
      [TELEGRAM_RESET_ADVISORY_LOCK]
    );
    const systemState = await telegramSystemState(client);
    if (!systemState) throw new Error("telegram_system_state_missing");
    const result = await client.query(
      `SELECT c.*, r.state AS login_state, r.expires_at AS login_expires_at,
              p.cckey, p.name AS player_name,
              d.device_key_id AS bound_device_key_id,
              d.link_key_hash AS device_link_key_hash
       FROM launcher_telegram_pairing_codes c
       JOIN launcher_telegram_login_requests r ON r.request_id = c.login_request_id
       JOIN players p ON p.id = c.player_id
       LEFT JOIN launcher_devices d ON d.player_id = c.player_id
       WHERE c.request_id = $1
       FOR UPDATE OF c, r, p`,
      [requestId]
    );
    const pairing = result.rows[0];
    if (pairing &&
        Number(pairing.telegram_user_id) === telegramUser.id &&
        ["confirmed", "rejected"].includes(pairing.state) &&
        pairing.login_state === pairing.state) {
      await client.query("ROLLBACK");
      return {
        ok: true,
        status: String(pairing.state),
        purpose: String(pairing.purpose),
        player: {
          id: Number(pairing.player_id),
          name: String(pairing.player_name || "")
        },
        telegram: telegramUser
      };
    }
    if (!pairing ||
        pairing.state !== "claimed" ||
        pairing.login_state !== "claimed") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "telegram_pairing_not_claimed" };
    }
    if (Number(pairing.telegram_user_id) !== telegramUser.id) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "telegram_account_mismatch" };
    }
    if (Number(pairing.binding_epoch) !== Number(systemState.binding_epoch)) {
      await client.query(
        `UPDATE launcher_telegram_pairing_codes
         SET state = 'cancelled', updated_at = now()
         WHERE request_id = $1`,
        [requestId]
      );
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET state = 'cancelled', updated_at = now()
         WHERE request_id = $1`,
        [String(pairing.login_request_id)]
      );
      await client.query("COMMIT");
      return { ok: false, status: 409, error: "telegram_binding_reset" };
    }
    if (new Date(pairing.expires_at).getTime() <= Date.now() ||
        new Date(pairing.login_expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE launcher_telegram_pairing_codes
         SET state = 'expired', updated_at = now()
         WHERE request_id = $1`,
        [requestId]
      );
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET state = 'expired', updated_at = now()
         WHERE request_id = $1`,
        [String(pairing.login_request_id)]
      );
      await client.query("COMMIT");
      return { ok: false, status: 410, error: "telegram_code_expired" };
    }
    if (decision === "reject") {
      await client.query(
        `UPDATE launcher_telegram_pairing_codes
         SET state = 'rejected', rejected_at = now(), updated_at = now()
         WHERE request_id = $1`,
        [requestId]
      );
      await client.query(
        `UPDATE launcher_telegram_login_requests
         SET state = 'rejected', rejected_at = now(), updated_at = now()
         WHERE request_id = $1`,
        [String(pairing.login_request_id)]
      );
      await writeAuditEvent(client, {
        playerId: Number(pairing.player_id),
        playerName: String(pairing.player_name || ""),
        eventType: "telegram_pairing_rejected",
        category: "security",
        severity: "notice",
        description: `Telegram ${telegramUser.username ? `@${telegramUser.username}` : telegramUser.id} отклонил привязку`,
        source: "telegram_bot",
        device: String(pairing.device_key_id || ""),
        metadata: { purpose: String(pairing.purpose) }
      });
      await client.query("COMMIT");
      return {
        ok: true,
        status: "rejected",
        player: {
          id: Number(pairing.player_id),
          name: String(pairing.player_name || "")
        }
      };
    }

    const currentLinkHash = launcherLinkKeyHash(pairing.cckey);
    if (!pairing.bound_device_key_id ||
        pairing.bound_device_key_id !== pairing.device_key_id ||
        !safeTokenEquals(pairing.link_key_hash, currentLinkHash) ||
        !safeTokenEquals(pairing.device_link_key_hash, currentLinkHash)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "telegram_link_stale" };
    }

    const bindingResult = await client.query(
      `SELECT *
       FROM launcher_telegram_bindings
       WHERE player_id = $1 OR telegram_user_id = $2
       FOR UPDATE`,
      [Number(pairing.player_id), telegramUser.id]
    );
    const playerBinding = bindingResult.rows.find(
      (row) => Number(row.player_id) === Number(pairing.player_id)
    );
    const telegramBinding = bindingResult.rows.find(
      (row) => Number(row.telegram_user_id) === telegramUser.id
    );
    if (pairing.purpose === "link") {
      if (playerBinding || telegramBinding) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          error: playerBinding ? "telegram_player_already_bound" : "telegram_already_bound"
        };
      }
      await client.query(
        `INSERT INTO launcher_telegram_bindings (
           player_id, telegram_user_id, telegram_username,
           telegram_first_name, telegram_last_name, link_key_hash,
           last_ip_hash, binding_epoch,
           confirmed_at, last_verified_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())`,
        [
          Number(pairing.player_id),
          telegramUser.id,
          telegramUser.username,
          telegramUser.firstName,
          telegramUser.lastName,
          currentLinkHash,
          String(pairing.launcher_ip_hash),
          Number(systemState.binding_epoch)
        ]
      );
    } else {
      if (!playerBinding ||
          !telegramBinding ||
          Number(playerBinding.telegram_user_id) !== telegramUser.id ||
          Number(telegramBinding.player_id) !== Number(pairing.player_id) ||
          Number(pairing.expected_player_id || 0) !== Number(pairing.player_id)) {
        await client.query("ROLLBACK");
        return { ok: false, status: 409, error: "telegram_account_mismatch" };
      }
      await client.query(
        `UPDATE launcher_telegram_bindings
         SET telegram_username = $2,
             telegram_first_name = $3,
             telegram_last_name = $4,
             link_key_hash = $5,
             last_ip_hash = $6,
             binding_epoch = $7,
             last_verified_at = now(),
             updated_at = now()
         WHERE player_id = $1`,
        [
          Number(pairing.player_id),
          telegramUser.username,
          telegramUser.firstName,
          telegramUser.lastName,
          currentLinkHash,
          String(pairing.launcher_ip_hash),
          Number(systemState.binding_epoch)
        ]
      );
    }
    await client.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = 'confirmed', confirmed_at = now(), updated_at = now()
       WHERE request_id = $1`,
      [requestId]
    );
    await client.query(
      `UPDATE launcher_telegram_login_requests
       SET state = 'confirmed', confirmed_at = now(), updated_at = now()
       WHERE request_id = $1`,
      [String(pairing.login_request_id)]
    );
    await writeAuditEvent(client, {
      playerId: Number(pairing.player_id),
      playerName: String(pairing.player_name || ""),
      eventType: pairing.purpose === "ip_reverify"
        ? "telegram_ip_reverified"
        : "telegram_link_confirmed",
      category: "security",
      severity: "notice",
      description: pairing.purpose === "ip_reverify"
        ? `Telegram ${telegramUser.username ? `@${telegramUser.username}` : telegramUser.id} подтвердил новый IP`
        : `Telegram ${telegramUser.username ? `@${telegramUser.username}` : telegramUser.id} подтверждён для лаунчера`,
      source: "telegram_bot",
      device: String(pairing.device_key_id || ""),
      newValue: {
        telegramUserId: telegramUser.id,
        telegramUsername: telegramUser.username,
        purpose: String(pairing.purpose),
        bindingEpoch: Number(systemState.binding_epoch)
      }
    });
    await client.query("COMMIT");
    return {
      ok: true,
      status: "confirmed",
      purpose: String(pairing.purpose),
      player: {
        id: Number(pairing.player_id),
        name: String(pairing.player_name || "")
      },
      telegram: telegramUser
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") {
      return { ok: false, status: 409, error: "telegram_already_bound" };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function resetTelegramBindingForPlayer(playerIdValue, adminTelegramIdValue) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const playerId = Number(playerIdValue || 0);
  const adminTelegramId = Number(adminTelegramIdValue || 0);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    return { ok: false, status: 400, error: "invalid_player_id" };
  }
  if (adminTelegramId !== TELEGRAM_ADMIN_ID) {
    return { ok: false, status: 403, error: "admin_forbidden" };
  }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const playerResult = await client.query(
      "SELECT id, name FROM players WHERE id = $1 FOR UPDATE",
      [playerId]
    );
    if (!playerResult.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "player_not_found" };
    }
    const bindingResult = await client.query(
      "DELETE FROM launcher_telegram_bindings WHERE player_id = $1",
      [playerId]
    );
    const codeResult = await client.query(
      "DELETE FROM launcher_telegram_pairing_codes WHERE player_id = $1 OR expected_player_id = $1",
      [playerId]
    );
    const requestResult = await client.query(
      "DELETE FROM launcher_telegram_login_requests WHERE player_id = $1",
      [playerId]
    );
    await writeAuditEvent(client, {
      playerId,
      playerName: String(playerResult.rows[0].name || ""),
      eventType: "telegram_binding_admin_reset",
      category: "security",
      severity: "warning",
      description: "Администратор сбросил Telegram-привязку игрока",
      source: "telegram_admin",
      metadata: {
        adminTelegramId,
        removedBinding: bindingResult.rowCount,
        removedCodes: codeResult.rowCount,
        removedLoginRequests: requestResult.rowCount
      }
    });
    await client.query("COMMIT");
    return {
      ok: true,
      player: {
        id: playerId,
        name: String(playerResult.rows[0].name || "")
      },
      removed: {
        bindings: bindingResult.rowCount,
        codes: codeResult.rowCount,
        loginRequests: requestResult.rowCount
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function resetLauncherGameLinkForTelegramAdmin(
  playerIdValue,
  adminTelegramIdValue,
  requestOrigin = null
) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const playerId = Number(playerIdValue || 0);
  const adminTelegramId = Number(adminTelegramIdValue || 0);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    return { ok: false, status: 400, error: "invalid_player_id" };
  }
  if (adminTelegramId !== TELEGRAM_ADMIN_ID) {
    return { ok: false, status: 403, error: "admin_forbidden" };
  }

  const rotated = await rotateLauncherGameLink(playerId);
  if (!rotated?.account) {
    return { ok: false, status: 404, error: "player_not_found" };
  }

  await writeAuditEvent(pgPool, {
    playerId,
    playerName: String(rotated.account.name || ""),
    eventType: "admin_game_link_reset",
    category: "security",
    severity: "warning",
    description: "Администратор удалил старую игровую ссылку, привязку устройства и Telegram",
    source: "telegram_admin",
    newValue: {
      linkRotated: true,
      deviceBindingRemoved: rotated.bindingRemoved,
      telegramBindingRemoved: rotated.telegramBindingRemoved
    },
    metadata: { adminTelegramId }
  });

  return {
    ok: true,
    player: {
      id: playerId,
      name: String(rotated.account.name || "")
    },
    removed: {
      device: Boolean(rotated.bindingRemoved),
      telegram: Boolean(rotated.telegramBindingRemoved)
    },
    linkRotated: true,
    loginLink: loginLink(rotated.account, requestOrigin)
  };
}

async function prepareGlobalTelegramBindingReset(adminTelegramIdValue) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const adminTelegramId = Number(adminTelegramIdValue || 0);
  if (adminTelegramId !== TELEGRAM_ADMIN_ID) {
    return { ok: false, status: 403, error: "admin_forbidden" };
  }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock_shared($1)",
      [TELEGRAM_RESET_ADVISORY_LOCK]
    );
    const systemState = await telegramSystemState(client);
    if (!systemState) throw new Error("telegram_system_state_missing");
    await client.query(
      `UPDATE launcher_telegram_admin_actions
       SET state = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'cancelled' END,
           updated_at = now()
       WHERE admin_telegram_user_id = $1
         AND action = 'reset_all'
         AND state = 'prepared'`,
      [adminTelegramId]
    );
    const countResult = await client.query(
      "SELECT COUNT(*)::integer AS count FROM launcher_telegram_bindings"
    );
    const affectedCount = Number(countResult.rows[0]?.count || 0);
    const requestId = randomOpaqueId("ga");
    const expiresAt = new Date(Date.now() + TELEGRAM_RESET_CONFIRM_TTL_MS);
    await client.query(
      `INSERT INTO launcher_telegram_admin_actions (
         request_id, action, admin_telegram_user_id,
         binding_epoch, affected_count, expires_at
       )
       VALUES ($1, 'reset_all', $2, $3, $4, $5)`,
      [
        requestId,
        adminTelegramId,
        Number(systemState.binding_epoch),
        affectedCount,
        expiresAt.toISOString()
      ]
    );
    await client.query("COMMIT");
    return {
      ok: true,
      requestId,
      affectedCount,
      expiresAt: expiresAt.toISOString()
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function executeGlobalTelegramBindingReset(requestIdValue, adminTelegramIdValue) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const requestId = normalizeTelegramPairingRequestId(requestIdValue, ["ga"]);
  const adminTelegramId = Number(adminTelegramIdValue || 0);
  if (!requestId) return { ok: false, status: 400, error: "reset_confirmation_invalid" };
  if (adminTelegramId !== TELEGRAM_ADMIN_ID) {
    return { ok: false, status: 403, error: "admin_forbidden" };
  }
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [TELEGRAM_RESET_ADVISORY_LOCK]);
    const systemState = await telegramSystemState(client, { lock: true });
    if (!systemState) throw new Error("telegram_system_state_missing");
    const actionResult = await client.query(
      `SELECT *
       FROM launcher_telegram_admin_actions
       WHERE request_id = $1
       FOR UPDATE`,
      [requestId]
    );
    const action = actionResult.rows[0];
    if (!action ||
        action.action !== "reset_all" ||
        Number(action.admin_telegram_user_id) !== adminTelegramId ||
        action.state !== "prepared" ||
        Number(action.binding_epoch) !== Number(systemState.binding_epoch)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "reset_confirmation_invalid" };
    }
    if (new Date(action.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE launcher_telegram_admin_actions
         SET state = 'expired', updated_at = now()
         WHERE request_id = $1`,
        [requestId]
      );
      await client.query("COMMIT");
      return { ok: false, status: 410, error: "reset_confirmation_expired" };
    }

    const bindingResult = await client.query("DELETE FROM launcher_telegram_bindings");
    const codeResult = await client.query("DELETE FROM launcher_telegram_pairing_codes");
    const loginResult = await client.query("DELETE FROM launcher_telegram_login_requests");
    const nextEpoch = Number(systemState.binding_epoch) + 1;
    await client.query(
      `UPDATE launcher_telegram_system_state
       SET binding_epoch = $1,
           last_reset_at = now(),
           last_reset_by_telegram_id = $2,
           updated_at = now()
       WHERE id = 1`,
      [nextEpoch, adminTelegramId]
    );
    await client.query(
      `UPDATE launcher_telegram_admin_actions
       SET state = 'executed', executed_at = now(), updated_at = now()
       WHERE request_id = $1`,
      [requestId]
    );
    await client.query(
      `UPDATE launcher_telegram_admin_actions
       SET state = 'cancelled', updated_at = now()
       WHERE request_id <> $1
         AND state = 'prepared'`,
      [requestId]
    );
    await writeAuditEvent(client, {
      eventType: "telegram_bindings_global_reset",
      category: "security",
      severity: "critical",
      description: `Администратор глобально сбросил ${bindingResult.rowCount} Telegram-привязок`,
      source: "telegram_admin",
      metadata: {
        adminTelegramId,
        previousEpoch: Number(systemState.binding_epoch),
        nextEpoch,
        removedBindings: bindingResult.rowCount,
        removedCodes: codeResult.rowCount,
        removedLoginRequests: loginResult.rowCount
      }
    });
    await client.query("COMMIT");
    return {
      ok: true,
      bindingEpoch: nextEpoch,
      removed: {
        bindings: bindingResult.rowCount,
        codes: codeResult.rowCount,
        loginRequests: loginResult.rowCount
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupTelegramPairingState() {
  if (!pgPool) return;
  const client = await pgPool.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [TELEGRAM_CLEANUP_ADVISORY_LOCK]
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) return;
    await client.query("BEGIN");
    await client.query(
      `UPDATE launcher_telegram_pairing_codes
       SET state = 'expired', updated_at = now()
       WHERE state IN ('issued', 'claimed')
         AND expires_at <= now()`
    );
    await client.query(
      `UPDATE launcher_telegram_login_requests
       SET state = 'expired', updated_at = now()
       WHERE state IN ('pending', 'claimed')
         AND expires_at <= now()`
    );
    await client.query(
      `UPDATE launcher_telegram_admin_actions
       SET state = 'expired', updated_at = now()
       WHERE state = 'prepared'
         AND expires_at <= now()`
    );
    await client.query(
      `DELETE FROM launcher_telegram_pairing_codes
       WHERE state IN ('confirmed', 'rejected', 'cancelled', 'expired')
         AND updated_at < now() - interval '24 hours'`
    );
    await client.query(
      `DELETE FROM launcher_telegram_login_requests
       WHERE state IN ('confirmed', 'rejected', 'cancelled', 'expired', 'locked')
         AND updated_at < now() - interval '24 hours'`
    );
    await client.query(
      `DELETE FROM launcher_telegram_admin_actions
       WHERE state IN ('executed', 'cancelled', 'expired')
         AND updated_at < now() - interval '24 hours'`
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[telegram-pairing] cleanup failed", error);
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [TELEGRAM_CLEANUP_ADVISORY_LOCK]).catch(() => {});
    }
    client.release();
  }
}

async function redeemPromoCode(account, rawCode, context = {}) {
  if (!pgPool) return { ok: false, status: 503, error: "postgres_required" };
  const code = normalizePromoCode(rawCode);
  if (!isValidPromoCode(code)) return { ok: false, status: 400, error: "invalid_code" };

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const promoResult = await client.query(
      "SELECT * FROM promo_codes WHERE code_normalized = $1 FOR UPDATE",
      [code]
    );
    const promo = promoResult.rows[0];
    if (!promo) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, error: "promo_not_found" };
    }

    const previous = await client.query(
      `SELECT reward_amount, balance_after, redeemed_at
       FROM promo_redemptions
       WHERE promo_code_id = $1 AND player_id = $2`,
      [Number(promo.id), Number(account.id)]
    );
    if (previous.rowCount) {
      const balanceResult = await client.query("SELECT money FROM players WHERE id = $1", [Number(account.id)]);
      await client.query("COMMIT");
      return {
        ok: true,
        alreadyRedeemed: true,
        status: "already_redeemed",
        promo: promoCodePayload(promo),
        rewardAmount: Number(previous.rows[0].reward_amount || promo.reward_amount || 0),
        balance: Number(balanceResult.rows[0]?.money ?? previous.rows[0].balance_after ?? account.money ?? 0),
        redeemedAt: postgresTimestamp(previous.rows[0].redeemed_at)
      };
    }

    if (!promo.active) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "promo_inactive" };
    }
    if (promo.expires_at && new Date(promo.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "promo_expired" };
    }
    if (promo.max_redemptions != null && Number(promo.redemption_count || 0) >= Number(promo.max_redemptions)) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "promo_limit_reached" };
    }

    const playerResult = await client.query(
      "SELECT money FROM players WHERE id = $1 FOR UPDATE",
      [Number(account.id)]
    );
    if (!playerResult.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "player_not_found" };
    }

    const balanceBefore = Number(playerResult.rows[0].money || 0);
    const rewardAmount = Number(promo.reward_amount || 0);
    const balanceAfter = balanceBefore + rewardAmount;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter > 2_147_483_647) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "balance_limit_reached" };
    }

    await client.query(
      "UPDATE players SET money = $2, updated_at = now() WHERE id = $1",
      [Number(account.id), balanceAfter]
    );
    const redemption = await client.query(
      `INSERT INTO promo_redemptions (
         promo_code_id, player_id, reward_type, reward_amount,
         balance_before, balance_after, device_key_id, link_key_hash
       )
       VALUES ($1, $2, 'contrabucks', $3, $4, $5, $6, $7)
       RETURNING redeemed_at`,
      [
        Number(promo.id),
        Number(account.id),
        rewardAmount,
        balanceBefore,
        balanceAfter,
        String(context.deviceKeyId || "").slice(0, 160),
        launcherLinkKeyHash(account.key)
      ]
    );
    const updatedPromo = await client.query(
      `UPDATE promo_codes
       SET redemption_count = redemption_count + 1, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [Number(promo.id)]
    );
    await writeAuditEvent(client, {
      playerId: Number(account.id),
      playerName: String(account.name || ""),
      eventType: "promo_redeemed",
      category: "economy",
      severity: "info",
      description: `Промокод ${code}: начислено ${rewardAmount} контрабаксов`,
      oldValue: { balance: balanceBefore },
      newValue: { balance: balanceAfter, delta: rewardAmount, promoCode: code },
      source: "launcher_promo",
      ipAddress: String(context.ipAddress || ""),
      device: String(context.deviceKeyId || ""),
      metadata: { promoCodeId: Number(promo.id), rewardType: "contrabucks" }
    });
    await client.query("COMMIT");

    return {
      ok: true,
      alreadyRedeemed: false,
      status: "redeemed",
      promo: promoCodePayload(updatedPromo.rows[0]),
      rewardAmount,
      balance: balanceAfter,
      redeemedAt: postgresTimestamp(redemption.rows[0]?.redeemed_at)
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function bindLauncherDevice(account, body, req) {
  const deviceKeyId = normalizeLauncherDeviceKeyId(body?.deviceKeyId);
  const publicKey = normalizeLauncherPublicKey(body?.devicePublicKey);
  const hwidHash = normalizeHwidRiskHash(body?.hwidRiskHash);
  if (!deviceKeyId || !publicKey || !hwidHash || !launcherDeviceKeyMatchesPublicKey(deviceKeyId, publicKey)) {
    return { ok: false, error: "device_bind_required" };
  }

  const now = new Date().toISOString();
  const linkKeyHash = launcherLinkKeyHash(account.key);
  const risk = { hwidChanged: false, ip: requestClientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 160) };
  if (pgPool) {
    const existingDevice = await pgPool.query(
      `SELECT player_id
       FROM launcher_devices
       WHERE player_id <> $2
         AND (device_key_id = $1 OR (hwid_hash <> '' AND hwid_hash = $3))
       LIMIT 1`,
      [deviceKeyId, Number(account.id), hwidHash]
    );
    if (existingDevice.rowCount) {
      return { ok: false, error: "device_already_bound" };
    }

    try {
      const inserted = await pgPool.query(
        `INSERT INTO launcher_devices (player_id, device_key_id, device_public_key, link_key_hash, hwid_hash, risk, bound_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
         ON CONFLICT (player_id) DO NOTHING
         RETURNING player_id`,
        [Number(account.id), deviceKeyId, publicKey, linkKeyHash, hwidHash, JSON.stringify(risk)]
      );
      if (!inserted.rowCount) {
        return { ok: false, error: "device_signature_required" };
      }
    } catch (error) {
      if (error?.code === "23505") {
        return { ok: false, error: "device_already_bound" };
      }
      throw error;
    }
  } else {
    for (const existing of Object.values(store.accounts || {})) {
      const existingDevice = existing?.launcherDevice;
      if (Number(existing?.id) !== Number(account.id) &&
          (existingDevice?.deviceKeyId === deviceKeyId || (existingDevice?.hwidHash && existingDevice.hwidHash === hwidHash))) {
        return { ok: false, error: "device_already_bound" };
      }
    }
    const normalized = normalizeAccount(account);
    normalized.launcherDevice = { playerId: Number(account.id), deviceKeyId, publicKey, linkKeyHash, hwidHash, risk, boundAt: now, lastSeenAt: now };
    store.accounts[String(account.id)] = normalized;
    await saveStore(store);
  }

  console.log(`[launcher-device] bound player=${account.id} keyId=${deviceKeyId}`);
  return { ok: true };
}

async function touchLauncherDevice(account, device, hwidHash, req) {
  const normalizedHash = normalizeHwidRiskHash(hwidHash);
  const linkKeyHash = launcherLinkKeyHash(account.key);
  const risk = {
    hwidChanged: Boolean(device?.hwidHash && normalizedHash && device.hwidHash !== normalizedHash),
    ip: requestClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 160)
  };

  if (pgPool) {
    await pgPool.query(
      `UPDATE launcher_devices
       SET link_key_hash = $2,
           hwid_hash = COALESCE(NULLIF($3, ''), hwid_hash),
           risk = $4::jsonb,
           last_seen_at = now()
       WHERE player_id = $1`,
      [Number(account.id), linkKeyHash, normalizedHash, JSON.stringify(risk)]
    );
  } else if (store.accounts[String(account.id)]?.launcherDevice) {
    const normalized = normalizeAccount(store.accounts[String(account.id)]);
    normalized.launcherDevice = {
      ...normalized.launcherDevice,
      linkKeyHash,
      hwidHash: normalizedHash || normalized.launcherDevice.hwidHash,
      risk,
      lastSeenAt: new Date().toISOString()
    };
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
  let current = await loadLauncherDevice(account.id);
  const currentLinkKeyHash = launcherLinkKeyHash(account.key);
  if (current?.linkKeyHash && !safeTokenEquals(current.linkKeyHash, currentLinkKeyHash)) {
    console.warn(`[launcher-device] stale link generation reset player=${account.id} keyId=${current.deviceKeyId}`);
    await deleteLauncherDeviceBinding(account.id);
    current = null;
  }
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

async function deleteLauncherDeviceBinding(accountId, client = null) {
  if (pgPool) {
    const executor = client || pgPool;
    const result = await executor.query("DELETE FROM launcher_devices WHERE player_id = $1", [Number(accountId)]);
    return result.rowCount > 0;
  }
  const account = store.accounts[String(accountId)];
  if (!account?.launcherDevice) return false;
  delete account.launcherDevice;
  store.accounts[String(accountId)] = account;
  await saveStore(store);
  return true;
}

function revokeLauncherCredentialsForPlayer(accountId) {
  const playerId = Number(accountId);
  for (const [token, session] of launcherSessions) {
    if (Number(session?.id) === playerId) launcherSessions.delete(token);
  }
  for (const [nonce, challenge] of launcherDeviceChallenges) {
    if (Number(challenge?.playerId) === playerId) launcherDeviceChallenges.delete(nonce);
  }
}

function rememberRevokedGameLinkKey(accountId, key) {
  const playerId = Number(accountId);
  if (!Number.isInteger(playerId) || playerId <= 0 || !key) return;
  const hashes = revokedGameLinkKeys.get(playerId) || [];
  hashes.push(launcherLinkKeyHash(key));
  revokedGameLinkKeys.set(playerId, hashes.slice(-8));
}

function isRevokedGameLinkKey(accountId, key) {
  const hashes = revokedGameLinkKeys.get(Number(accountId));
  if (!hashes?.length || !key) return false;
  const hash = launcherLinkKeyHash(key);
  return hashes.some((revokedHash) => safeTokenEquals(revokedHash, hash));
}

async function rotateLauncherGameLink(accountId) {
  const playerId = Number(accountId);
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  const nextKey = newAccountKey(playerId);
  let bindingRemoved = false;
  let telegramBindingRemoved = false;
  let account = null;
  let previousKey = "";

  if (pgPool) {
    await pgSaveChain.catch(() => {});
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT id, cckey FROM players WHERE id = $1 FOR UPDATE", [playerId]);
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      previousKey = String(existing.rows[0].cckey || "");
      bindingRemoved = await deleteLauncherDeviceBinding(playerId, client);
      const telegramBinding = await client.query(
        "DELETE FROM launcher_telegram_bindings WHERE player_id = $1",
        [playerId]
      );
      telegramBindingRemoved = telegramBinding.rowCount > 0;
      await client.query(
        "DELETE FROM launcher_telegram_pairing_codes WHERE player_id = $1 OR expected_player_id = $1",
        [playerId]
      );
      await client.query(
        "DELETE FROM launcher_telegram_login_requests WHERE player_id = $1",
        [playerId]
      );
      await client.query(
        "UPDATE players SET cckey = $2, updated_at = now() WHERE id = $1",
        [playerId, nextKey]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    account = await loadPostgresAccount(playerId);
    if (account) store.accounts[String(playerId)] = account;
  } else {
    const existing = store.accounts[String(playerId)];
    if (!existing) return null;
    const normalized = normalizeAccount(existing);
    previousKey = String(normalized.key || "");
    bindingRemoved = Boolean(normalized.launcherDevice);
    delete normalized.launcherDevice;
    normalized.key = nextKey;
    normalized.updatedAt = new Date().toISOString();
    store.accounts[String(playerId)] = normalized;
    await saveStore(store);
    account = normalized;
  }

  rememberRevokedGameLinkKey(playerId, previousKey);
  revokeLauncherCredentialsForPlayer(playerId);
  return { account, bindingRemoved, telegramBindingRemoved };
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

async function awardPlayerExperience(client, playerId, amount, source = "game_api") {
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
  await writeAuditEvent(client, {
    playerId: id,
    eventType: next.level !== oldLevel ? "level_change" : "experience_change",
    category: "progress",
    severity: next.level !== oldLevel ? "notice" : "info",
    description: next.level !== oldLevel
      ? `Уровень изменён: ${oldLevel} → ${next.level}`
      : `Начислено ${expGain} опыта`,
    oldValue: { exp: oldExp, level: oldLevel },
    newValue: { exp: next.exp, level: next.level, delta: expGain },
    source
  });
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

async function claimPendingInventoryDeliveries(playerId) {
  if (!pgPool) return [];
  const result = await pgPool.query(
    `WITH pending AS (
       SELECT id
       FROM player_pending_inventory_deliveries
       WHERE player_id = $1
         AND delivered_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 64
       FOR UPDATE SKIP LOCKED
     ),
     delivered AS (
       UPDATE player_pending_inventory_deliveries delivery
       SET delivered_at = now()
       FROM pending
       WHERE delivery.id = pending.id
       RETURNING delivery.id, delivery.item_data
     )
     SELECT id, item_data
     FROM delivered
     ORDER BY id ASC`,
    [Number(playerId)]
  );
  return result.rows.map((row) => jsonValue(row.item_data, {}));
}

function profilePayload(account, full = false) {
  const publicName = account.namePending ? "" : account.name;
  const staff = staffProfilePayload(account.staffRole, publicName);
  const payload = {
    result: true,
    info: {
      u_id: account.id,
      un: staff.battleName,
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
      },
      mdr: legacyPermissionPayload(staff.role),
      staff,
    },
    name_pending: Boolean(account.namePending)
  };

  if (full) {
    payload.view = clone(account.view);
    payload.weap = clone(account.weap);
    payload.taun = clone(account.taun);
  }

  // Clan membership is derived from the active clan/member store. account.clan
  // is only a cached projection and must not resurrect a deleted clan.
  const liveClan = clanSummaryForPlayer(account.id);
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
      items: JSON.stringify(
        (account.inventory || []).filter(
          (item) => !(Number(item?.itype || 0) === 2 && Number(item?.e_id ?? item?.id ?? 0) === 36)
        )
      ),
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
  for (const achievement of newlyCompleted) {
    await writeAuditEvent(client, {
      playerId: account.id,
      eventType: "achievement_complete",
      category: "progress",
      severity: "notice",
      description: `Выполнено достижение #${achievement.i}`,
      newValue: { current: achievement.currentValue, target: achievement.maxValue, reward: achievement.reward },
      source: "battle_server",
      metadata: { achievementId: achievement.id, originalId: achievement.i }
    });
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
  const liveClan = clanSummaryForPlayer(account.id);
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
const PURCHASABLE_TIMED_DURATIONS = new Set([
  SHOP_DURATION.DAY,
  SHOP_DURATION.WEEK,
  SHOP_DURATION.MONTH
]);
const SHOP_DAY_SECONDS = 86460;
// Enhancer.eD is read through SimpleJSON.JSONNode.AsInt on the original
// client. Permanent clan ownership is stored as eD=0, but clan inventory must
// expose a non-zero Int32 timestamp because ClanInventory.Refresh dereferences
// Enhancer.Duration without a null check.
const CLIENT_MAX_UNIX_SECONDS = 2147483647;

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
  // normalizeStore replaces every clan object. Re-running it while a mutation
  // holds a clan reference makes subsequent writes land on a detached copy.
  // The store is normalized at load and at the start of routeClan; only repair
  // the shape here when it is actually missing.
  if (
    store?.clans?.byId &&
    Number.isFinite(Number(store.clans.nextId)) &&
    Number.isFinite(Number(store.clans.nextEventId)) &&
    Number.isFinite(Number(store.clans.nextTreasuryEventId))
  ) {
    return store.clans;
  }
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

        let existing = { rows: [] };
        let becameAccepted = false;
        if (action === "request" || action === "confirm") {
          existing = await client.query(
            `SELECT player_id, friend_player_id, status
             FROM player_friends
             WHERE (player_id = $1 AND friend_player_id = $2) OR (player_id = $2 AND friend_player_id = $1)
             FOR UPDATE`,
            [id, target]
          );
        }

        if (action === "request") {
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
            becameAccepted = true;
          } else {
            await client.query(
              `INSERT INTO player_friends (player_id, friend_player_id, status)
               VALUES ($1, $2, 'pending')
               ON CONFLICT (player_id, friend_player_id) DO UPDATE SET status = EXCLUDED.status`,
              [id, target]
            );
          }
        } else if (action === "confirm") {
          becameAccepted = !existing.rows.some((row) => row.status === "accepted");
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
        return { ok: true, becameAccepted };
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

async function battleClanTreasuryEvents(body) {
  const afterId = Math.max(0, Math.trunc(Number(body?.afterId || 0)));
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(body?.limit || 100))));
  const initialize = body?.initialize === true;
  const exactEventId = Math.max(0, Math.trunc(Number(body?.eventId || 0)));
  const expectedClanId = Math.max(0, Math.trunc(Number(body?.clanId || 0)));
  const expectedPlayerId = Math.max(0, Math.trunc(Number(body?.playerId || 0)));

  if (exactEventId > 0) {
    if (expectedClanId <= 0 || expectedPlayerId <= 0) {
      return { ok: false, error: "invalid_clan_treasury_event_identity" };
    }

    let exactEvent = null;
    if (pgPool) {
      const result = await pgPool.query(
        `SELECT id, clan_id, player_id, player_name, money, event_type, created_at
         FROM clan_treasury_events
         WHERE id = $1 AND clan_id = $2 AND player_id = $3 AND event_type = $4
         LIMIT 1`,
        [exactEventId, expectedClanId, expectedPlayerId, CLAN_TREASURY_EVENT_TYPE.ADD]
      );
      const row = result.rows[0];
      if (row) {
        exactEvent = {
          id: Number(row.id),
          clanId: Number(row.clan_id),
          playerId: Number(row.player_id || 0),
          playerName: String(row.player_name || ""),
          money: Number(row.money || 0),
          type: Number(row.event_type || 0),
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || "")
        };
      }
    } else {
      exactEvent = Object.values(store.clans?.byId || {})
        .flatMap((clan) => clan?.treasuryEvents || [])
        .map(normalizeClanTreasuryRecord)
        .filter(Boolean)
        .find((event) => (
          Number(event.id) === exactEventId &&
          Number(event.clanId) === expectedClanId &&
          Number(event.playerId) === expectedPlayerId &&
          Number(event.type) === CLAN_TREASURY_EVENT_TYPE.ADD
        )) || null;
      if (exactEvent) {
        exactEvent = {
          id: Number(exactEvent.id),
          clanId: Number(exactEvent.clanId),
          playerId: Number(exactEvent.playerId || 0),
          playerName: String(exactEvent.playerName || ""),
          money: Number(exactEvent.money || 0),
          type: Number(exactEvent.type || 0),
          createdAt: String(exactEvent.createdAt || "")
        };
      }
    }

    console.log(`[clan-live] treasury-exact event=${exactEventId} clan=${expectedClanId} player=${expectedPlayerId} found=${exactEvent ? 1 : 0}`);
    return { ok: true, cursor: exactEventId, events: exactEvent ? [exactEvent] : [] };
  }

  if (initialize) {
    const cursor = pgPool
      ? Number((await pgPool.query(
          "SELECT COALESCE(MAX(id), 0)::int AS id FROM clan_treasury_events WHERE event_type = $1",
          [CLAN_TREASURY_EVENT_TYPE.ADD]
        )).rows[0]?.id || 0)
      : Object.values(store.clans?.byId || {})
          .flatMap((clan) => clan?.treasuryEvents || [])
          .filter((event) => Number(event?.type) === CLAN_TREASURY_EVENT_TYPE.ADD)
          .reduce((max, event) => Math.max(max, Number(event?.id || 0)), 0);
    return { ok: true, initialized: true, cursor, events: [] };
  }
  let events;

  if (pgPool) {
    const result = await pgPool.query(
      `SELECT id, clan_id, player_id, player_name, money, event_type, created_at
       FROM clan_treasury_events
       WHERE id > $1 AND event_type = $2
       ORDER BY id ASC
       LIMIT $3`,
      [afterId, CLAN_TREASURY_EVENT_TYPE.ADD, limit]
    );
    events = result.rows.map((row) => ({
      id: Number(row.id),
      clanId: Number(row.clan_id),
      playerId: Number(row.player_id || 0),
      playerName: String(row.player_name || ""),
      money: Number(row.money || 0),
      type: Number(row.event_type || 0),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || "")
    }));
  } else {
    events = Object.values(store.clans?.byId || {})
      .flatMap((clan) => clan?.treasuryEvents || [])
      .map(normalizeClanTreasuryRecord)
      .filter(Boolean)
      .filter((event) => Number(event.id) > afterId)
      .filter((event) => Number(event.type) === CLAN_TREASURY_EVENT_TYPE.ADD)
      .sort((left, right) => Number(left.id) - Number(right.id))
      .slice(0, limit)
      .map((event) => ({
        id: Number(event.id),
        clanId: Number(event.clanId),
        playerId: Number(event.playerId || 0),
        playerName: String(event.playerName || ""),
        money: Number(event.money || 0),
        type: Number(event.type || 0),
        createdAt: String(event.createdAt || "")
      }));
  }

  const cursor = events.length > 0 ? Number(events[events.length - 1].id) : afterId;
  if (events.length > 0) {
    console.log(`[clan-live] treasury-feed after=${afterId} events=${events.length} cursor=${cursor}`);
  }
  return { ok: true, cursor, events };
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

async function clanMemberListPostgres(clanId) {
  const id = Number(clanId || 0);
  if (!Number.isInteger(id) || id <= 0) return [];
  const startedAt = Date.now();
  try {
    const result = await pgPool.query(
      `SELECT cm.player_id, cm.role, cm.member_level, cm.money, cm.clan_exp,
              cm.exp_koef, cm.player_exp, cm.joined_at, p.level, p.name, p.exp
       FROM clan_members cm
       JOIN clans c ON c.id = cm.clan_id AND c.deleted_at IS NULL
       JOIN players p ON p.id = cm.player_id
       WHERE cm.clan_id = $1
       ORDER BY cm.clan_exp DESC, cm.joined_at, cm.player_id`,
      [id]
    );

    const memoryClan = clanById(id, { includeDeleted: true });
    if (memoryClan) {
      memoryClan.members = {};
      for (const row of result.rows) {
        memoryClan.members[String(row.player_id)] = normalizeClanMemberRecord({
          playerId: Number(row.player_id),
          memberLevel: Number(row.member_level || (row.role === "owner" ? 2 : 1)),
          money: Number(row.money || 0),
          clanExp: Number(row.clan_exp || 0),
          expKoef: Number(row.exp_koef || 0),
          playerExp: Number(row.player_exp ?? row.exp ?? 0),
          joinedAt: postgresTimestamp(row.joined_at)
        });
      }
    }

    const members = result.rows.map((row) => ({
      uid: Number(row.player_id),
      ul: Number(row.level || 1),
      n: String(row.name || `Player ${row.player_id}`),
      mlvl: Number(row.member_level || (row.role === "owner" ? 2 : 1)),
      m: Number(row.money || 0),
      e: Number(row.clan_exp || 0),
      ek: Number(row.exp_koef || 0),
      ue: Number(row.exp ?? row.player_exp ?? 0),
      date: formatClanDate(row.joined_at)
    }));
    console.log(`[clan-member] list clan=${id} members=${members.length} source=postgres duration=${Date.now() - startedAt}ms`);
    return members;
  } catch (error) {
    console.error(`[postgres] clan member list failed clan=${id}`, error);
    return null;
  }
}

function clanInviteList(clan, targetStore = store) {
  return Object.values(clan.invites || {}).map((invite) => clanInvitePayload(invite, targetStore));
}

async function clanInviteListPostgres(clanId) {
  const id = Number(clanId || 0);
  if (!Number.isInteger(id) || id <= 0) return [];
  const startedAt = Date.now();
  try {
    const result = await pgPool.query(
      `SELECT ci.player_id, ci.created_at, p.level, p.name, p.exp
       FROM clan_invites ci
       JOIN clans c ON c.id = ci.clan_id AND c.deleted_at IS NULL
       JOIN players p ON p.id = ci.player_id
       WHERE ci.clan_id = $1
       ORDER BY ci.created_at, ci.player_id`,
      [id]
    );

    const memoryClan = clanById(id, { includeDeleted: true });
    if (memoryClan) {
      memoryClan.invites = {};
      for (const row of result.rows) {
        memoryClan.invites[String(row.player_id)] = {
          playerId: Number(row.player_id),
          createdAt: postgresTimestamp(row.created_at)
        };
      }
    }

    const invites = result.rows.map((row) => ({
      uid: Number(row.player_id),
      ul: Number(row.level || 1),
      n: String(row.name || `Player ${row.player_id}`),
      mlvl: 0,
      m: 0,
      e: 0,
      ek: 0,
      ue: Number(row.exp || 0),
      date: formatClanDate(row.created_at)
    }));
    console.log(`[clan-invite] list clan=${id} invites=${invites.length} source=postgres duration=${Date.now() - startedAt}ms`);
    return invites;
  } catch (error) {
    console.error(`[postgres] clan invite list failed clan=${id}`, error);
    return null;
  }
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

function clanTreasuryAddResponse(account, clan, eventId) {
  refreshAccountClan(account);
  return ok({
    id: Number(eventId),
    cid: Number(clan.id)
  });
}

function activeClanInventoryItems(clan, now = currentUnixSeconds()) {
  return (clan?.inventory || [])
    .filter((item) => Number(item?.itype ?? item?.it ?? 0) === 2)
    .filter((item) => Number(item?.iC || 0) === 1)
    .filter((item) => isActiveTimedItem(item, now))
    .map((item) => {
      const payload = clone(item);
      if (Number(payload.eD || 0) <= 0) payload.eD = CLIENT_MAX_UNIX_SECONDS;
      return payload;
    });
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

function refreshAccountClan(account, targetStore = store) {
  if (!account) return null;
  const summary = clanSummaryForPlayer(account.id, targetStore);
  account.clan = summary;
  const stored = targetStore.accounts?.[String(account.id)];
  if (stored && stored !== account) stored.clan = summary;
  return summary;
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

function clanCreateUniqueViolationCode(error) {
  if (String(error?.code || "") !== "23505") return 0;
  const constraint = String(error?.constraint || "");
  if (constraint === "clans_name_key" || constraint === "clans_name_active_lower_unique") {
    return CLAN_ERROR.CLAN_NAME_EXIST;
  }
  if (constraint === "clans_tag_lower_unique" || constraint === "clans_tag_active_lower_unique") {
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
        account.money = nextPlayerMoney;
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
      return clanTreasuryAddResponse(account, clanById(clanId, { includeDeleted: true }) || { id: clanId, money: nextClanMoney }, eventId);
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      if (committed) {
        console.error("[postgres] clan treasury memory sync failed", error);
        return clanTreasuryAddResponse(account, clanById(clanId, { includeDeleted: true }) || { id: clanId, money: nextClanMoney }, eventId);
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
  // gextra is a live clan view. Deleted records remain available only to the
  // event refresh path so ClanEventType.Delete can finish the client cleanup.
  const clan = clanById(clanId);
  if (!clan) return clanBaseResponse(account, { id: 0, cinfo: {} });
  return clanBaseResponse(account, {
    id: Number(clan.id),
    cinfo: clanPayload(clan, { full: true })
  });
}

async function createClanPostgres(account, name, tag, armId) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    let clan = null;
    let nextPlayerMoney = Number(account.money || 0);
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const playerResult = await client.query("SELECT * FROM players WHERE id = $1 FOR UPDATE", [Number(account.id)]);
      const playerRow = playerResult.rows[0];
      if (!playerRow || playerRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const membershipResult = await client.query(
        `SELECT 1
         FROM clan_members cm
         JOIN clans c ON c.id = cm.clan_id
         WHERE cm.player_id = $1 AND c.deleted_at IS NULL
         LIMIT 1`,
        [Number(account.id)]
      );
      if (membershipResult.rows.length) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
      }

      const duplicateNameResult = await client.query(
        `SELECT 1 FROM clans WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
        [name]
      );
      if (duplicateNameResult.rows.length) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_NAME_EXIST);
      }

      const duplicateTagResult = await client.query(
        `SELECT 1 FROM clans WHERE deleted_at IS NULL AND lower(tag) = lower($1) LIMIT 1`,
        [tag]
      );
      if (duplicateTagResult.rows.length) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_TAG_EXIST);
      }

      const playerMoney = Number(playerRow.money || 0);
      if (playerMoney < CLAN_COSTS.create) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.MISSING_MONEY);
      }

      const createdAt = new Date().toISOString();
      nextPlayerMoney = playerMoney - CLAN_COSTS.create;
      const nextClanIdResult = await client.query("SELECT COALESCE(MAX(id), 0)::int + 1 AS id FROM clans");
      const id = Number(nextClanIdResult.rows[0]?.id || 1);
      await client.query(
        `INSERT INTO clans (
          id, name, tag, owner_player_id, level, exp, money, arm_id,
          tag_color, homepage, description, access, access_level, max_members,
          deleted_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 1, 0, 0, $5, '', '', '', 1, $6, $7, NULL, $8, $8)`,
        [id, name, tag, Number(account.id), armId, CLAN_JOIN_LEVEL, CLAN_DEFAULT_MAX_MEMBERS, createdAt]
      );

      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextPlayerMoney]);
      await client.query(
        `INSERT INTO clan_members (
          clan_id, player_id, role, member_level, money, clan_exp, exp_koef, player_exp, joined_at
        )
        VALUES ($1, $2, 'owner', 2, 0, 0, 0, $3, $4)`,
        [id, Number(account.id), Number(account.exp || 0), createdAt]
      );

      await client.query("COMMIT");
      committed = true;

      account.money = nextPlayerMoney;
      account.updatedAt = createdAt;
      const fresh = await loadPostgresAccount(account.id);
      store.accounts[String(account.id)] = fresh ? { ...fresh, money: nextPlayerMoney } : normalizeAccount(account);

      clan = normalizeClanRecord({
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
      store.clans.nextId = Math.max(Number(store.clans.nextId || 1), id + 1);
      refreshAllAccountClanSummaries(store);
      refreshAccountClan(account);

      console.log(`[clan-create] pg player=${account.id} clan=${id} money=${nextPlayerMoney}`);
      return clanBaseResponse(account, {
        id,
        cinfo: clanPayload(clan, { full: true })
      });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      const duplicateCode = clanCreateUniqueViolationCode(error);
      if (duplicateCode) {
        console.log(`[clan-create] rejected player=${account.id} reason=${duplicateCode === CLAN_ERROR.CLAN_NAME_EXIST ? "name-exists" : "tag-exists"} constraint=${String(error.constraint || "unknown")}`);
        return clanError(duplicateCode);
      }
      console.error("[postgres] clan create failed", error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
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
  if (pgPool) return await createClanPostgres(account, name, tag, armId);

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

async function joinClanPostgres(account, clanId) {
  const id = Number(clanId || 0);
  const playerId = Number(account.id || 0);
  const startedAt = Date.now();
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const playerResult = await client.query(
        "SELECT id, cckey, level, exp, name FROM players WHERE id = $1 FOR UPDATE",
        [playerId]
      );
      const playerRow = playerResult.rows[0];
      if (!playerRow || playerRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }
      if (Number(playerRow.level || 1) < CLAN_JOIN_LEVEL) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_USER_LVL_LESS);
      }

      const clanResult = await client.query(
        `SELECT id, access, access_level, max_members
         FROM clans
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id]
      );
      const clanRow = clanResult.rows[0];
      if (!clanRow) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const membershipResult = await client.query(
        `SELECT cm.clan_id
         FROM clan_members cm
         JOIN clans c ON c.id = cm.clan_id
         WHERE cm.player_id = $1 AND c.deleted_at IS NULL
         LIMIT 1`,
        [playerId]
      );
      if (membershipResult.rows.length) {
        await client.query("ROLLBACK");
        console.log(`[clan-invite] join blocked player=${playerId} clan=${id} reason=already-member memberClan=${Number(membershipResult.rows[0].clan_id || 0)} source=postgres duration=${Date.now() - startedAt}ms`);
        return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
      }
      if (Number(clanRow.access || 0) === 0 || Number(clanRow.access_level || 0) > Number(playerRow.level || 0)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const memberCountResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM clan_members WHERE clan_id = $1",
        [id]
      );
      if (Number(memberCountResult.rows[0]?.count || 0) >= Number(clanRow.max_members || CLAN_DEFAULT_MAX_MEMBERS)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
      }

      const existingInviteResult = await client.query(
        "SELECT created_at FROM clan_invites WHERE clan_id = $1 AND player_id = $2",
        [id, playerId]
      );
      const inviteCountResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM clan_invites WHERE player_id = $1",
        [playerId]
      );
      if (!existingInviteResult.rows.length &&
          Number(inviteCountResult.rows[0]?.count || 0) >= Number(account.clanMaxRequest || 10)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const insertResult = await client.query(
        `INSERT INTO clan_invites (clan_id, player_id, created_at)
         VALUES ($1, $2, now())
         ON CONFLICT (clan_id, player_id) DO NOTHING
         RETURNING created_at`,
        [id, playerId]
      );
      let createdAt = insertResult.rows[0]?.created_at || existingInviteResult.rows[0]?.created_at;
      if (!createdAt) {
        const persistedInvite = await client.query(
          "SELECT created_at FROM clan_invites WHERE clan_id = $1 AND player_id = $2",
          [id, playerId]
        );
        createdAt = persistedInvite.rows[0]?.created_at;
      }

      await client.query("COMMIT");
      committed = true;

      const normalizedCreatedAt = postgresTimestamp(createdAt) || new Date().toISOString();
      const memoryClan = clanById(id, { includeDeleted: true });
      if (memoryClan) {
        memoryClan.invites[String(playerId)] = {
          playerId,
          createdAt: normalizedCreatedAt
        };
      }
      store.accounts[String(playerId)] = normalizeAccount({
        ...account,
        level: Number(playerRow.level || account.level || 1),
        exp: Number(playerRow.exp || account.exp || 0),
        name: String(playerRow.name || account.name || `Player ${playerId}`)
      });

      const inviteCount = Number(inviteCountResult.rows[0]?.count || 0) + (existingInviteResult.rows.length ? 0 : 1);
      console.log(`[clan-invite] join player=${playerId} clan=${id} invites=${inviteCount} source=postgres duration=${Date.now() - startedAt}ms`);
      return ok({ id });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      console.error(`[postgres] clan invite join failed player=${playerId} clan=${id}`, error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

async function joinClan(account, url) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  if (pgPool) return await joinClanPostgres(account, clanId);
  let clan = clanById(clanId);
  if (!clan) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(account.level || 1) < CLAN_JOIN_LEVEL) return clanError(CLAN_ERROR.CLAN_USER_LVL_LESS);
  if (playerClanRecord(account.id)) return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
  if (Number(clan.access || 0) === 0 || Number(clan.accessLevel || 0) > Number(account.level || 0)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Object.keys(clan.members || {}).length >= Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS)) return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
  const inviteClanIds = playerInviteClanIds(account.id);
  if (inviteClanIds.length >= Number(account.clanMaxRequest || 10) && !inviteClanIds.includes(clanId)) {
    return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  }
  // playerClanRecord()/playerInviteClanIds() normalize the JSON store and can
  // replace clan records. Reacquire the live object before mutating it.
  clan = clanById(clanId);
  if (!clan) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
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

async function acceptClanInvitePostgres(account, clanId, userId) {
  const id = Number(clanId || 0);
  const ownerId = Number(account.id || 0);
  const playerId = Number(userId || 0);
  const startedAt = Date.now();
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const ownerResult = await client.query(
        "SELECT id, cckey FROM players WHERE id = $1 FOR UPDATE",
        [ownerId]
      );
      const ownerRow = ownerResult.rows[0];
      if (!ownerRow || ownerRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const clanResult = await client.query(
        `SELECT id, owner_player_id, max_members
         FROM clans
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id]
      );
      const clanRow = clanResult.rows[0];
      if (!clanRow || Number(clanRow.owner_player_id || 0) !== ownerId) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const playerResult = await client.query(
        "SELECT id, cckey, level, exp, name FROM players WHERE id = $1 FOR UPDATE",
        [playerId]
      );
      const playerRow = playerResult.rows[0];
      if (!playerRow) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const inviteResult = await client.query(
        "SELECT created_at FROM clan_invites WHERE clan_id = $1 AND player_id = $2 FOR UPDATE",
        [id, playerId]
      );
      if (!inviteResult.rows.length) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const membershipResult = await client.query(
        `SELECT cm.clan_id
         FROM clan_members cm
         JOIN clans c ON c.id = cm.clan_id
         WHERE cm.player_id = $1 AND c.deleted_at IS NULL
         LIMIT 1`,
        [playerId]
      );
      if (membershipResult.rows.length) {
        await client.query(
          "DELETE FROM clan_invites WHERE clan_id = $1 AND player_id = $2",
          [id, playerId]
        );
        await client.query("COMMIT");
        committed = true;
        const memoryClan = clanById(id, { includeDeleted: true });
        if (memoryClan?.invites) delete memoryClan.invites[String(playerId)];
        console.log(`[clan-invite] accept blocked owner=${ownerId} player=${playerId} clan=${id} reason=already-member memberClan=${Number(membershipResult.rows[0].clan_id || 0)} source=postgres duration=${Date.now() - startedAt}ms`);
        return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
      }

      const memberCountResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM clan_members WHERE clan_id = $1",
        [id]
      );
      if (Number(memberCountResult.rows[0]?.count || 0) >= Number(clanRow.max_members || CLAN_DEFAULT_MAX_MEMBERS)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
      }

      const joinedAt = new Date();
      await client.query(
        `INSERT INTO clan_members (
           clan_id, player_id, role, member_level, money, clan_exp, exp_koef, player_exp, joined_at
         )
         VALUES ($1, $2, 'member', 1, 0, 0, 0, $3, $4)`,
        [id, playerId, Number(playerRow.exp || 0), joinedAt]
      );
      await client.query("DELETE FROM clan_invites WHERE player_id = $1", [playerId]);
      await client.query("COMMIT");
      committed = true;

      for (const memoryClan of activeClanRecords()) {
        if (memoryClan.invites?.[String(playerId)]) delete memoryClan.invites[String(playerId)];
      }
      const userAccount = normalizeAccount({
        ...(accountById(playerId) || {}),
        id: playerId,
        key: String(playerRow.cckey || ""),
        level: Number(playerRow.level || 1),
        exp: Number(playerRow.exp || 0),
        name: String(playerRow.name || `Player ${playerId}`)
      });
      store.accounts[String(playerId)] = userAccount;
      const member = normalizeClanMemberRecord({
        playerId,
        memberLevel: 1,
        money: 0,
        clanExp: 0,
        expKoef: 0,
        playerExp: Number(playerRow.exp || 0),
        joinedAt: joinedAt.toISOString()
      });
      const memoryClan = clanById(id, { includeDeleted: true });
      if (memoryClan) {
        memoryClan.members[String(playerId)] = member;
        memoryClan.updatedAt = joinedAt.toISOString();
      }
      refreshAccountClan(userAccount);

      console.log(`[clan-invite] accept owner=${ownerId} player=${playerId} clan=${id} source=postgres duration=${Date.now() - startedAt}ms`);
      return ok({
        id: playerId,
        i: clanMemberAccountPayload(member)
      });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      console.error(`[postgres] clan invite accept failed owner=${ownerId} player=${playerId} clan=${id}`, error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

async function acceptClanInvite(account, url) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  const userId = Number(url.searchParams.get("uid") || 0);
  if (pgPool) return await acceptClanInvitePostgres(account, clanId, userId);
  let clan = clanById(clanId);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const userAccount = accountById(userId);
  if (!userAccount) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const existingClan = playerClanRecord(userId);
  if (existingClan) {
    clan = clanById(clanId);
    if (clan?.invites?.[String(userId)]) {
      delete clan.invites[String(userId)];
      clan.updatedAt = new Date().toISOString();
      await saveClanState();
    }
    return clanError(CLAN_ERROR.CLAN_CREATE_YOU_ARE_IN_CLAN);
  }
  // activeClanRecords() performs the same normalization. Use only objects from
  // this fresh collection for the remaining checks and mutations.
  const clans = activeClanRecords();
  clan = clans.find((candidate) => Number(candidate.id) === clanId) || null;
  const invite = clan?.invites?.[String(userId)];
  if (!clan || !isClanOwner(account, clan) || !invite) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Object.keys(clan.members || {}).length >= Number(clan.maxMembers || CLAN_DEFAULT_MAX_MEMBERS)) {
    return clanError(CLAN_ERROR.CLAN_MEMBER_MAX_COUNT);
  }
  let removedInvites = 0;
  for (const otherClan of clans) {
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

async function rejectClanInvitePostgres(account, clanId, userId) {
  const id = Number(clanId || 0);
  const ownerId = Number(account.id || 0);
  const playerId = Number(userId || 0);
  const startedAt = Date.now();
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const ownerResult = await client.query(
        "SELECT id, cckey FROM players WHERE id = $1 FOR UPDATE",
        [ownerId]
      );
      const ownerRow = ownerResult.rows[0];
      if (!ownerRow || ownerRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const clanResult = await client.query(
        `SELECT id, owner_player_id
         FROM clans
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id]
      );
      const clanRow = clanResult.rows[0];
      if (!clanRow || Number(clanRow.owner_player_id || 0) !== ownerId) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const deleted = await client.query(
        "DELETE FROM clan_invites WHERE clan_id = $1 AND player_id = $2",
        [id, playerId]
      );
      await client.query("COMMIT");
      committed = true;

      const memoryClan = clanById(id, { includeDeleted: true });
      if (memoryClan?.invites) delete memoryClan.invites[String(playerId)];
      console.log(`[clan-invite] reject owner=${ownerId} player=${playerId} clan=${id} removed=${Number(deleted.rowCount || 0)} source=postgres duration=${Date.now() - startedAt}ms`);
      return ok({ id: playerId });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      console.error(`[postgres] clan invite reject failed owner=${ownerId} player=${playerId} clan=${id}`, error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

async function rejectClanInvite(account, url) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  const userId = Number(url.searchParams.get("uid") || 0);
  if (pgPool) return await rejectClanInvitePostgres(account, clanId, userId);
  const clan = clanById(clanId);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  delete clan.invites[String(userId)];
  clan.updatedAt = new Date().toISOString();
  await saveClanState();
  console.log(`[clan-invite] reject owner=${account.id} player=${userId} clan=${clan.id} invites=${Object.keys(clan.invites || {}).length}`);
  return ok({ id: userId });
}

async function removeClanMemberPostgres(account, clanId, userId, eventType) {
  const id = Number(clanId || 0);
  const actorId = Number(account.id || 0);
  const playerId = Number(userId || 0);
  const isLeave = Number(eventType) === CLAN_EVENT_TYPE.LEAVE_MEMBER;
  const startedAt = Date.now();
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const actorResult = await client.query(
        "SELECT id, cckey FROM players WHERE id = $1 FOR UPDATE",
        [actorId]
      );
      const actorRow = actorResult.rows[0];
      if (!actorRow || actorRow.cckey !== account.key) {
        await client.query("ROLLBACK");
        return { result: false, error: "1" };
      }

      const clanResult = await client.query(
        `SELECT id, owner_player_id
         FROM clans
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id]
      );
      const clanRow = clanResult.rows[0];
      if (!clanRow || (!isLeave && Number(clanRow.owner_player_id || 0) !== actorId)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }
      if (isLeave && playerId !== actorId) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }
      if (Number(clanRow.owner_player_id || 0) === playerId) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const memberResult = await client.query(
        "SELECT player_id FROM clan_members WHERE clan_id = $1 AND player_id = $2 FOR UPDATE",
        [id, playerId]
      );
      if (!memberResult.rows.length) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      await client.query(
        "DELETE FROM clan_members WHERE clan_id = $1 AND player_id = $2",
        [id, playerId]
      );
      const expResult = await client.query(
        "SELECT COALESCE(SUM(clan_exp), 0)::int AS exp FROM clan_members WHERE clan_id = $1",
        [id]
      );
      const nextClanExp = Number(expResult.rows[0]?.exp || 0);
      await client.query(
        "UPDATE clans SET exp = $2, updated_at = now() WHERE id = $1",
        [id, nextClanExp]
      );

      const expiresAt = new Date(Date.now() + 1000);
      const eventResult = await client.query(
        `INSERT INTO clan_events (clan_id, event_type, creator_player_id, data, expires_at, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, now())
         RETURNING id, created_at`,
        [id, Number(eventType), actorId, JSON.stringify({ uid: playerId }), expiresAt]
      );
      const eventRow = eventResult.rows[0];
      await client.query("COMMIT");
      committed = true;

      const memoryClan = clanById(id, { includeDeleted: true });
      if (memoryClan) {
        if (memoryClan.members?.[String(playerId)]) delete memoryClan.members[String(playerId)];
        memoryClan.exp = nextClanExp;
        memoryClan.updatedAt = new Date().toISOString();
        const event = normalizeClanEventRecord({
          id: Number(eventRow?.id || 0),
          clanId: id,
          type: Number(eventType),
          creatorPlayerId: actorId,
          data: { uid: playerId },
          expiresAt: expiresAt.toISOString(),
          createdAt: postgresTimestamp(eventRow?.created_at) || new Date().toISOString()
        });
        if (event) {
          memoryClan.events = (memoryClan.events || []).filter((current) => Number(current.id) !== Number(event.id));
          memoryClan.events.push(event);
          store.clans.nextEventId = Math.max(Number(store.clans.nextEventId || 1), Number(event.id) + 1);
        }
      }
      const targetAccount = playerId === actorId ? account : accountById(playerId);
      if (targetAccount) refreshAccountClan(targetAccount);
      console.log(`[clan-member] ${isLeave ? "leave" : "remove"} actor=${actorId} player=${playerId} clan=${id} members=${Object.keys(memoryClan?.members || {}).length} source=postgres duration=${Date.now() - startedAt}ms`);
      return ok();
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      console.error(`[postgres] clan member ${isLeave ? "leave" : "remove"} failed actor=${actorId} player=${playerId} clan=${id}`, error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

async function removeClanMember(account, url, eventType = CLAN_EVENT_TYPE.DELETE_MEMBER) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  const userId = eventType === CLAN_EVENT_TYPE.LEAVE_MEMBER ? Number(account.id) : Number(url.searchParams.get("uid") || 0);
  if (pgPool) return await removeClanMemberPostgres(account, clanId, userId, eventType);
  const clan = clanById(clanId);
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

async function deleteClanPostgres(account, clanId) {
  return enqueuePostgresMutation(async () => {
    let client = null;
    let committed = false;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      const clanResult = await client.query("SELECT * FROM clans WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [Number(clanId)]);
      const clanRow = clanResult.rows[0];
      if (!clanRow || Number(clanRow.owner_player_id || 0) !== Number(account.id)) {
        await client.query("ROLLBACK");
        return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
      }

      const expiresAt = new Date(Date.now() + 1000).toISOString();
      const eventResult = await client.query(
        `INSERT INTO clan_events (clan_id, event_type, creator_player_id, data, expires_at, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, now())
         RETURNING id, created_at`,
        [Number(clanId), CLAN_EVENT_TYPE.DELETE, Number(account.id), JSON.stringify({}), expiresAt]
      );
      await client.query("DELETE FROM clan_invites WHERE clan_id = $1", [Number(clanId)]);
      await client.query("DELETE FROM clan_members WHERE clan_id = $1", [Number(clanId)]);
      const deletedClanResult = await client.query(
        "UPDATE clans SET deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING deleted_at, updated_at",
        [Number(clanId)]
      );
      await client.query("COMMIT");
      committed = true;

      const clan = clanById(clanId, { includeDeleted: true });
      if (clan) {
        const eventRow = eventResult.rows[0];
        const event = normalizeClanEventRecord({
          id: Number(eventRow?.id || 0),
          clanId: Number(clanId),
          type: CLAN_EVENT_TYPE.DELETE,
          creatorPlayerId: Number(account.id),
          data: {},
          expiresAt,
          createdAt: postgresTimestamp(eventRow?.created_at) || new Date().toISOString()
        });
        if (event) {
          clan.events = (clan.events || []).filter((current) => Number(current.id) !== Number(event.id));
          clan.events.push(event);
          store.clans.nextEventId = Math.max(Number(store.clans.nextEventId || 1), Number(event.id) + 1);
        }
        clan.deletedAt = postgresTimestamp(deletedClanResult.rows[0]?.deleted_at) || new Date().toISOString();
        clan.members = {};
        clan.invites = {};
        clan.updatedAt = postgresTimestamp(deletedClanResult.rows[0]?.updated_at) || new Date().toISOString();
      }
      refreshAllAccountClanSummaries(store);
      refreshAccountClan(account);
      console.log(`[clan-delete] pg player=${account.id} clan=${clanId} event=${Number(eventResult.rows[0]?.id || 0)} membership=0 profileClan=${account.clan ? Number(account.clan.cid || 0) : 0}`);
      return clanBaseResponse(account, { id: 0, cinfo: {} });
    } catch (error) {
      try {
        if (client && !committed) await client.query("ROLLBACK");
      } catch {
        // Keep the original error visible.
      }
      if (committed) {
        // PostgreSQL is authoritative after COMMIT. Never tell the original
        // client that deletion failed or leave a stale process-local clan
        // projection alive because only the memory synchronization failed.
        const clan = clanById(clanId, { includeDeleted: true });
        if (clan) {
          clan.deletedAt = clan.deletedAt || new Date().toISOString();
          clan.members = {};
          clan.invites = {};
        }
        refreshAllAccountClanSummaries(store);
        refreshAccountClan(account);
        console.error("[postgres] clan delete memory sync failed after commit", error);
        return clanBaseResponse(account, { id: 0, cinfo: {} });
      }
      console.error("[postgres] clan delete failed", error);
      return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
    } finally {
      if (client) client.release();
    }
  });
}

function deleteClan(account, url) {
  account = ensureClanAccount(account);
  const clanId = Number(url.searchParams.get("cid") || 0);
  if (pgPool) return deleteClanPostgres(account, clanId);
  const clan = clanById(clanId);
  if (!clan || !isClanOwner(account, clan)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  addClanEvent(clan, CLAN_EVENT_TYPE.DELETE, {}, Number(account.id));
  clan.deletedAt = new Date().toISOString();
  clan.members = {};
  clan.invites = {};
  clan.updatedAt = new Date().toISOString();
  saveClanState();
  refreshAccountClan(account);
  return clanBaseResponse(account, { id: 0, cinfo: {} });
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
  return clanTreasuryAddResponse(account, clan, event.id);
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

async function buyClanEnhancer(account, url) {
  account = ensureClanAccount(account);
  const clan = clanById(url.searchParams.get("cid"));
  const enhancerId = Number(url.searchParams.get("id") || 0);
  const duration = normalizeShopDuration(url.searchParams.get("dur"));
  const item = canonicalEnhancersById.get(enhancerId);
  if (!clan || !isClanOwner(account, clan) || !item || Number(item.iC || 0) !== 1) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  const price = shopDurationPrice(item, duration);
  if (!isValidShopPrice(price)) return clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE);
  if (Number(clan.money || 0) < price) return clanError(CLAN_ERROR.MISSING_MONEY_TREASURY);
  clan.money = Number(clan.money || 0) - price;
  const key = `2:${enhancerId}`;
  const existingItem = (clan.inventory || []).find(
    (owned) => String(owned.itemKey || inventoryItemKey(owned)) === key
  );
  const purchasedItem = withPurchasedDuration(item, duration, existingItem);
  const inventoryItem = {
    ...purchasedItem,
    it: 2,
    itype: 2,
    iC: 1,
    itemKey: key,
    createdAt: existingItem?.createdAt || new Date().toISOString()
  };
  clan.inventory = (clan.inventory || []).filter((owned) => String(owned.itemKey || inventoryItemKey(owned)) !== key);
  clan.inventory.push(inventoryItem);
  addClanTreasuryEvent(clan, account.id, -price, CLAN_TREASURY_EVENT_TYPE.BUY_ENHANCER);
  clan.updatedAt = new Date().toISOString();
  await saveClanState();
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

function clanAuditSnapshot(clan, account = null) {
  if (!clan) return null;
  return {
    id: Number(clan.id),
    name: String(clan.name || ""),
    tag: String(clan.tag || ""),
    ownerPlayerId: Number(clan.ownerPlayerId || 0),
    money: Number(clan.money || 0),
    level: Number(clan.level || 1),
    exp: Number(clan.exp || 0),
    members: Object.keys(clan.members || {}).length,
    maxMembers: Number(clan.maxMembers || 0),
    armId: Number(clan.armId || 0),
    access: Number(clan.access || 0),
    accessLevel: Number(clan.accessLevel || 0),
    playerBalance: account ? Number(account.money || 0) : undefined
  };
}

async function auditClanMutation(account, url, act, response, beforeClan, beforePlayerMoney) {
  if (!pgPool || response?.result !== true) return;
  const requestedClanId = Number(url.searchParams.get("cid") || response.id || beforeClan?.id || 0);
  const afterClanRecord = clanById(requestedClanId, { includeDeleted: true });
  const afterClan = clanAuditSnapshot(afterClanRecord, account);
  const targetPlayerId = Number(url.searchParams.get("uid") || account.id || 0);
  const money = Number(url.searchParams.get("money") || 0);
  const config = {
    create: ["clan_create", "clan", `Создан клан ${afterClan?.name || response.id || ""}`],
    del: ["clan_delete", "clan", `Удалён клан ${beforeClan?.name || requestedClanId}`],
    join: ["clan_join_request", "clan", `Подана заявка на вступление в клан #${requestedClanId}`],
    accept: ["clan_join", "clan", `Игрок #${targetPlayerId} принят в клан`],
    reject: ["clan_join_reject", "clan", `Заявка игрока #${targetPlayerId} отклонена`],
    remove: ["clan_member_remove", "clan", `Игрок #${targetPlayerId} исключён из клана`],
    leave: ["clan_leave", "clan", "Игрок вышел из клана"],
    amoney: ["clan_treasury_deposit", "economy", `Внесено ${money} монет в казну клана`],
    cname: ["clan_rename", "clan", `Клан переименован: ${beforeClan?.name || ""} → ${afterClan?.name || ""}`],
    ctag: ["clan_tag_change", "clan", `Изменён тег клана: ${beforeClan?.tag || ""} → ${afterClan?.tag || ""}`],
    carm: ["clan_emblem_change", "clan", "Изменена эмблема клана"],
    cowner: ["clan_owner_change", "clan", `Переданы права владельца игроку #${Number(url.searchParams.get("nid") || 0)}`],
    expand: ["clan_capacity_change", "clan", "Увеличено максимальное число участников"],
    bench: ["clan_purchase", "clan", "Куплен клановый усилитель"],
    curl: ["clan_profile_change", "clan", "Изменена ссылка клана"],
    cdesc: ["clan_profile_change", "clan", "Изменено описание клана"],
    caccess: ["clan_access_change", "clan", "Изменён режим доступа клана"],
    caccesslvl: ["clan_access_change", "clan", "Изменён минимальный уровень вступления"],
    ckoef: ["clan_exp_share_change", "clan", "Изменён коэффициент опыта участника"],
    buyReq: ["clan_request_limit_purchase", "economy", "Куплены дополнительные заявки в кланы"]
  }[act];
  if (!config) return;
  const subjectPlayerId = ["accept", "reject", "remove"].includes(act) ? targetPlayerId : Number(account.id);
  await auditGameEvent(pgPool, {
    playerId: subjectPlayerId,
    clanId: requestedClanId || afterClan?.id || beforeClan?.id,
    clanName: afterClan?.name || beforeClan?.name || "",
    eventType: config[0],
    category: config[1],
    severity: ["del", "remove", "cowner"].includes(act) ? "warning" : "notice",
    description: config[2],
    oldValue: beforeClan ? { ...beforeClan, playerBalance: beforePlayerMoney } : { playerBalance: beforePlayerMoney },
    newValue: afterClan || { playerBalance: Number(account.money || 0) },
    metadata: { act, actorPlayerId: Number(account.id), requestedClanId }
  });
}

async function routeClan(account, url, act, requestOrigin = null) {
  ensureClanStore();
  account = ensureClanAccount(account);

  const mutationHandlers = {
    create: () => createClan(account, url),
    del: () => deleteClan(account, url),
    join: () => joinClan(account, url),
    accept: () => acceptClanInvite(account, url),
    reject: () => rejectClanInvite(account, url),
    buyReq: () => buyClanRequests(account),
    expand: () => expandClan(account, url),
    remove: () => removeClanMember(account, url, CLAN_EVENT_TYPE.DELETE_MEMBER),
    leave: () => removeClanMember(account, url, CLAN_EVENT_TYPE.LEAVE_MEMBER),
    bench: () => buyClanEnhancer(account, url),
    cname: () => changeClanName(account, url),
    ctag: () => changeClanTag(account, url),
    carm: () => changeClanArm(account, url),
    curl: () => changeClanText(account, url, "homepage"),
    cdesc: () => changeClanText(account, url, "desc"),
    cowner: () => changeClanOwner(account, url),
    caccess: () => changeClanAccess(account, url, "access"),
    caccesslvl: () => changeClanAccess(account, url, "accessLevel"),
    amoney: () => addClanMoney(account, url),
    ckoef: () => changeClanKoef(account, url)
  };
  if (mutationHandlers[act]) {
    const currentClan = playerClanRecord(account.id) || clanById(url.searchParams.get("cid"), { includeDeleted: true });
    const beforeClan = clanAuditSnapshot(currentClan, account);
    const beforePlayerMoney = Number(account.money || 0);
    const response = await mutationHandlers[act]();
    await auditClanMutation(account, url, act, response, beforeClan, beforePlayerMoney);
    return response;
  }

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
      const clanId = Number(url.searchParams.get("cid") || 0);
      if (pgPool) {
        const members = await clanMemberListPostgres(clanId);
        return members === null ? clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE) : ok({ mlist: members });
      }
      const clan = clanById(clanId, { includeDeleted: true });
      return ok({ mlist: clan ? clanMemberList(clan) : [] });
    }
    case "inv": {
      const clanId = Number(url.searchParams.get("cid") || 0);
      if (pgPool) {
        const invites = await clanInviteListPostgres(clanId);
        return invites === null ? clanError(CLAN_ERROR.CLAN_ACCESS_DISABLE) : ok({ inv: invites });
      }
      const clan = clanById(clanId, { includeDeleted: true });
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
      return await removeClanMember(account, url, CLAN_EVENT_TYPE.DELETE_MEMBER);
    case "leave":
      return await removeClanMember(account, url, CLAN_EVENT_TYPE.LEAVE_MEMBER);
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
      return await addClanMoney(account, url);
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
  return PURCHASABLE_TIMED_DURATIONS.has(duration) ? duration : null;
}

function shopDurationSeconds(duration) {
  switch (normalizeShopDuration(duration)) {
    case SHOP_DURATION.DAY:
      return SHOP_DAY_SECONDS;
    case SHOP_DURATION.WEEK:
      return SHOP_DAY_SECONDS * 7;
    case SHOP_DURATION.MONTH:
      return SHOP_DAY_SECONDS * 30;
    default:
      return 0;
  }
}

function shopDurationPrice(item, duration) {
  const sc = item?.sc || {};
  const keyByDuration = {
    [SHOP_DURATION.DAY]: "t1v",
    [SHOP_DURATION.WEEK]: "t7v",
    [SHOP_DURATION.MONTH]: "t30v"
  };
  const selectedDuration = normalizeShopDuration(duration);
  if (selectedDuration === null) return null;
  const value = Number(sc[keyByDuration[selectedDuration]]);
  return isValidShopPrice(value) ? value : null;
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
      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [Number(account.id), nextMoney]);
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
      await auditGameEvent(client, {
        playerId: account.id,
        eventType: "purchase",
        category: itemType === 1 ? "weapons" : itemType === 3 ? "clothes" : "inventory",
        description: `Покупка ${itemData.name || itemData.sn || inventoryItemKey(itemData)} за ${price} монет`,
        oldValue: { balance: money },
        newValue: { balance: nextMoney, itemKey: inventoryItemKey(itemData), itemId: inventoryItemId(itemData), itemType },
        metadata: { price: Number(price), item: itemData }
      });
      await client.query("COMMIT");

      const fresh = await loadPostgresAccount(account.id);
      if (fresh) {
        store.accounts[String(fresh.id)] = fresh;
      }

      console.log(`[buy-item] pg player=${account.id} type=${itemType} key=${inventoryItemKey(itemData)} item=${inventoryItemId(itemData)} price=${price} before=${money} after=${nextMoney}`);
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
  if (pgPool) {
    return buyItemPostgres(account, item, price);
  }
  if (isWeaponItem(item) && hasInventoryItem(account, item)) {
    return ok({ req: "", vcur: account.money });
  }
  if (account.money < price) return { result: false, err: [2] };
  if (!hasInventoryItem(account, item)) {
    account.inventory.push(clone(item));
  }
  const beforeMoney = Number(account.money || 0);
  account.money -= price;
  recordPurchase(account, item, price);
  persist(account);
  console.log(`[buy-item] json player=${account.id} type=${Number(item?.itype || 0)} key=${inventoryItemKey(item)} item=${inventoryItemId(item)} price=${price} before=${beforeMoney} after=${account.money}`);
  return ok({ req: "", vcur: account.money });
}

async function buyTimedItemPostgres(account, item, duration, price) {
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
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)
        `,
        [
          Number(account.id),
          itemKey,
          Number(itemData?.itype || 0),
          inventoryItemId(itemData),
          Number(price || 0),
          JSON.stringify(itemData)
        ]
      );
      await auditGameEvent(client, {
        playerId: account.id,
        eventType: "purchase",
        category: Number(itemData?.itype || 0) === 4 ? "taunts" : "enhancers",
        description: `Покупка ${itemData.name || itemData.sn || itemKey} на ${duration} за ${price} монет`,
        oldValue: { balance: money, item: jsonValue(existing.rows[0]?.item_data, null) },
        newValue: { balance: nextMoney, item: itemData },
        metadata: { price: Number(price), duration, itemKey }
      });

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
      console.error(`[postgres] buy timed item failed type=${Number(item?.itype || 0)} item=${inventoryItemId(item)}`, error);
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
  if (!isValidShopPrice(price)) return { result: false, err: [1] };
  if (pgPool) return buyTimedItemPostgres(account, item, selectedDuration, price);
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

async function buyTaunt(account, item, duration) {
  if (!item) return { result: false, err: [1] };
  const selectedDuration = normalizeShopDuration(duration);
  const price = shopDurationPrice(item, selectedDuration);
  if (!isValidShopPrice(price)) return { result: false, err: [1] };
  if (pgPool) {
    return buyTimedItemPostgres(account, item, selectedDuration, price);
  }
  if (account.money < price) return { result: false, err: [2] };
  if (!Array.isArray(account.inventory)) account.inventory = [];

  const existingItem = findOwnedInventoryItem(account, item);
  const itemData = withPurchasedDuration(item, selectedDuration, existingItem);
  const itemKey = inventoryItemKey(itemData);
  const existingIndex = account.inventory.findIndex((owned) => inventoryItemKey(owned) === itemKey);
  if (existingIndex >= 0) account.inventory[existingIndex] = itemData;
  else account.inventory.push(itemData);
  account.money -= price;
  recordPurchase(account, itemData, price);
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
         VALUES ($1, $2, $3, $4, $5, 'vcur', $6::jsonb)
        `,
        [
          Number(account.id),
          itemKey,
          Number(itemData?.itype || 0),
          inventoryItemId(itemData),
          Number(price || 0),
          JSON.stringify(itemData)
        ]
      );
      await auditGameEvent(client, {
        playerId: account.id,
        eventType: "weapon_upgrade",
        category: "workshop",
        severity: "notice",
        description: `Улучшение оружия ${itemData.name || itemData.sn || itemKey} за ${price} монет`,
        oldValue: { balance: money, item: existingItem },
        newValue: { balance: nextMoney, item: itemData },
        metadata: { price: Number(price), itemKey, upgradeId: inventoryItemId(itemData) }
      });

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
  if (pgPool) {
    return buyWeaponUpgradePostgres(account, upgrade, price);
  }
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
  const previousName = account.name;
  account.name = name;
  if (initialSetRequested) account.namePending = false;
  persist(account);
  refreshAllAccountClanSummaries(store);
  saveStore(store);
  await auditGameEvent(pgPool, {
    playerId: account.id,
    eventType: "player_name_change",
    category: "profile",
    severity: "notice",
    description: `Ник изменён: ${previousName} → ${account.name}`,
    oldValue: { name: previousName },
    newValue: { name: account.name }
  });
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

      await auditGameEvent(client, {
        playerId: account.id,
        eventType: "purchase",
        category: "abilities",
        description: `Покупка способности #${next.i}, уровень ${next.l} за ${price} монет`,
        oldValue: { balance: money, ability: abilities.find((owned) => Number(owned.i) === id) || null },
        newValue: { balance: nextMoney, ability: { id: Number(next.i), level: Number(next.l) } },
        metadata: { price: Number(price) }
      });

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

  if (page === "staff") {
    return staffAjaxPayload(pgPool, account, act, url.searchParams);
  }

  if (page === "auth" && act === "g") {
    return ok({ user_id: String(account.id), key: account.key });
  }

  if (page === "account") {
    if (act === "login") return ok({ auth: { id: account.id, key: account.key } });
    if (act === "searcname") return searchPlayersByName(account, url.searchParams.get("v"));
    if (act === "cname" || act === "cpname") return changeName(account, url);
  }

  if (page === "bp" && act === "state") {
    if (!pgPool) {
      return { result: false, error: "postgres_required" };
    }
    const state = await loadStoreEntitlements(pgPool, Number(account.id), false);
    const season = await loadActiveBattlePassSeason(pgPool);
    const casePending = await pendingCaseOpeningForPlayer(pgPool, Number(account.id));
    return ok({
      battlePass: storeEntitlementPayload(state, season),
      caseOpen: battlePassCaseAccessPayload(account, requestOrigin),
      casePending
    });
  }

  if (page === "pl") {
    if (act === "i") {
      const objectLoadout = usesProfileObjectLoadout(account, url);
      const payload = advancedStatsPayload(
        await profileAccountForView(account, url),
        { objectLoadout }
      );
      if (url.searchParams.get("ai") === "1") {
        const deliveredItems = await claimPendingInventoryDeliveries(account.id);
        if (deliveredItems.length) {
          payload.addItem = deliveredItems;
        }
      }
      return payload;
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
    if (act === "btaunt") return await buyTaunt(account, findShopItem(shopTaunts, "t_id", id), url.searchParams.get("dur"));
    if (act === "benh") {
      const enhancerItem = canonicalEnhancersById.get(id);
      return await buyEnhancer(
        account,
        enhancerItem && Number(enhancerItem.iC || 0) === 0 ? enhancerItem : null,
        url.searchParams.get("dur")
      );
    }
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
  const trustedCloudFront = hasValidCloudFrontOrigin(req);
  const forwardedHost = trustedCloudFront
    ? String(req.headers["x-forwarded-host"] || "").split(",")[0].trim()
    : "";
  const host = forwardedHost || String(req.headers.host || "").split(",")[0].trim();
  if (!host) return url.origin;
  const forwardedProto = trustedCloudFront
    ? String(req.headers["cloudfront-forwarded-proto"] || req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
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

function jsonAsciiEscape(body) {
  return body.replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function sendJson(res, payload, status = 200, headers = {}, options = {}) {
  const json = JSON.stringify(payload);
  const body = options.ascii ? jsonAsciiEscape(json) : json;
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

  const remoteUrl = REMOTE_ASSET_BUNDLE_URLS.get(fileName.toLowerCase());
  if (remoteUrl) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return true;
    }
    res.writeHead(302, {
      location: remoteUrl,
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
      expires: "0"
    });
    res.end();
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

function tryServeLauncherRelease(req, res, url) {
  const manifestRequest = url.pathname === "/launcher/update.json";
  const signatureRequest = url.pathname === "/launcher/update.json.sig";
  const releaseMatch = /^\/launcher\/releases\/([0-9A-Za-z._-]{1,64})\/ContraCityLauncher\.exe$/.exec(url.pathname);
  if (!manifestRequest && !signatureRequest && !releaseMatch) return false;

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
    return true;
  }

  let filePath;
  let contentType;
  let cacheControl;
  if (manifestRequest) {
    filePath = path.join(LAUNCHER_RELEASE_DIR, "update.json");
    contentType = "application/json; charset=utf-8";
    cacheControl = "no-store, no-cache, must-revalidate";
  } else if (signatureRequest) {
    filePath = path.join(LAUNCHER_RELEASE_DIR, "update.json.sig");
    contentType = "text/plain; charset=us-ascii";
    cacheControl = "no-store, no-cache, must-revalidate";
  } else {
    filePath = path.join(LAUNCHER_RELEASE_DIR, releaseMatch[1], "ContraCityLauncher.exe");
    contentType = "application/octet-stream";
    cacheControl = "public, max-age=31536000, immutable";
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, { ok: false, error: "launcher_release_not_found" }, 404);
    return true;
  }

  const stat = fs.statSync(filePath);
  const headers = {
    ...securityHeaders(),
    "content-type": contentType,
    "cache-control": cacheControl,
    "accept-ranges": "bytes",
    "last-modified": stat.mtime.toUTCString()
  };
  if (releaseMatch) headers["content-disposition"] = "attachment; filename=\"ContraCityLauncher.exe\"";

  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = String(req.headers.range || "").trim();
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}`, "content-length": "0" });
      res.end();
      return true;
    }
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}`, "content-length": "0" });
      res.end();
      return true;
    }
    end = Math.min(end, stat.size - 1);
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
  }

  headers["content-length"] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(filePath, { start, end }).pipe(res);
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
  const targetId = Number(event?.targetPlayerId || details?.targetPlayerId || 0);
  const playerData = asBattleJson(event?.playerData);
  const candidates = [
    id === currentId ? event?.playerName : "",
    id === killerId ? (event?.killerPlayerName || details?.killerPlayerName) : "",
    id === victimId ? (event?.victimPlayerName || details?.victimPlayerName) : "",
    id === targetId ? (event?.targetPlayerName || details?.targetPlayerName) : "",
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

  if (type === "exp") {
    const expAwarded = eventNumber(event, details, "expAwarded", 0);
    if (playerId > 0 && expAwarded > 0) {
      const expResult = await awardPlayerExperience(client, playerId, expAwarded, "battle_server_enhancer");
      if (expResult) {
        details.expAwarded = expAwarded;
        details.expResult = expResult;
      }
      const clan = playerClanRecord(playerId);
      const member = clan?.members?.[String(playerId)];
      const exp2clan = eventNumber(event, details, "exp2clan", 0)
        || Math.round(expAwarded * Number(member?.expKoef || 0) / 100);
      if (exp2clan > 0) {
        const clanExpResult = await awardClanExperience(client, playerId, exp2clan);
        if (clanExpResult) {
          details.exp2clan = exp2clan;
          details.clanExpResult = clanExpResult;
        }
      }
    }
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
        const expResult = await awardPlayerExperience(client, killerPlayerId, expAwarded, "battle_server");
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

async function recordBattleSecurityEvent(event = {}) {
  if (!pgPool) return { ok: true, storage: "json-file", ignored: true };
  const kind = String(event.kind || event.type || "udp_suspicious_activity").replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  const playerId = Number(event.playerId || event.accountId || 0);
  const ipAddress = String(event.ipAddress || event.ip || "").slice(0, 128);
  const severity = ["notice", "warning", "critical"].includes(event.severity) ? event.severity : "warning";
  await writeAuditEvent(pgPool, {
    playerId: Number.isInteger(playerId) && playerId > 0 ? playerId : null,
    eventType: `security_${kind}`,
    category: "security",
    severity,
    suspicious: true,
    description: String(event.description || `Подозрительная UDP-активность: ${kind}`).slice(0, 1000),
    source: "battle_server_security",
    ipAddress,
    metadata: {
      ...asBattleJson(event.metadata || event.details || {}),
      port: Number(event.port || 0),
      count: Number(event.count || 0),
      durationMs: Number(event.durationMs || 0),
      stage: String(event.stage || "preauth").slice(0, 40),
    },
  });
  return { ok: true, storage: "postgres", type: kind };
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
  if (await activePlayerBan(playerId)) {
    return { ok: false, status: 403, error: "account_banned" };
  }
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
    if (type === "player_report") {
      await upsertBattleEventPlayer(client, event, details, Number(event.targetPlayerId || details.targetPlayerId || 0));
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
    } else if (type === "player_report") {
      const targetPlayerId = Number(event.targetPlayerId || details.targetPlayerId || 0);
      const targetActorId = Number(event.targetActorId || details.targetActorId || 0);
      const reportReason = String(event.reportReason || details.reason || "").trim().toLowerCase();
      const reportDetails = String(event.reportDetails || details.details || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 700);
      if (!Number.isInteger(targetPlayerId) || targetPlayerId <= 0 || targetPlayerId === playerId) {
        throw new Error("invalid_player_report_target");
      }
      if (!["cheats", "abuse", "voice_abuse", "griefing", "other"].includes(reportReason)) {
        throw new Error("invalid_player_report_reason");
      }
      if (reportReason === "other" && reportDetails.length < 3) {
        throw new Error("player_report_details_required");
      }
      await client.query(
        `INSERT INTO player_reports (
           room_id, reporter_player_id, target_player_id, reporter_actor_id, target_actor_id,
           room_name, map_name, mode, reason, details
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [roomId, playerId, targetPlayerId, actorId, targetActorId, roomName, mapName, mode, reportReason, reportDetails]
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
      const newlyCompleted = await syncPostgresAchievements(client, achievementPlayerId);
      achievements.push(...newlyCompleted);
    }

    const remoteIp = String(event.playerData?.remote || details.remote || "").slice(0, 128);
    if (type === "join" || type === "leave") {
      await touchPlayerActivity(client, {
        playerId,
        kind: type === "join" ? "login" : "logout",
        ipAddress: remoteIp,
        source: "battle_server"
      });
      await writeAuditEvent(client, {
        playerId,
        playerName: event.playerName,
        eventType: type === "join" ? "player_login" : "player_logout",
        category: "session",
        severity: "info",
        description: type === "join" ? `Игрок вошёл в бой ${roomName}` : `Игрок вышел из боя ${roomName}`,
        source: "battle_server",
        ipAddress: remoteIp,
        metadata: { roomName, mapName, mode, actorId, serverPort }
      });
    }
    if (type === "summary") {
      await writeAuditEvent(client, {
        playerId,
        playerName: event.playerName,
        eventType: "statistics_change",
        category: "battle",
        description: `Обновлена статистика матча на карте ${mapName}`,
        newValue: details,
        source: "battle_server",
        metadata: { roomName, mapName, mode }
      });
    }
    if (type === "death" || type === "score") {
      const killerId = Number(event.killerPlayerId || details.killerPlayerId || 0);
      const victimId = Number(event.victimPlayerId || details.victimPlayerId || 0);
      const combatValue = {
        roomName,
        mapName,
        mode,
        weaponId: Number(event.weaponId || details.weaponId || 0),
        hitZone: Number(event.hitZone || details.hitZone || 0),
        killerPlayerId: killerId,
        victimPlayerId: victimId
      };
      if (killerId > 0 && killerId !== victimId) {
        await writeAuditEvent(client, {
          playerId: killerId,
          eventType: "battle_kill",
          category: "battle",
          description: `Убийство игрока #${victimId} на карте ${mapName}`,
          newValue: combatValue,
          source: "battle_server"
        });
      }
      if (victimId > 0) {
        await writeAuditEvent(client, {
          playerId: victimId,
          eventType: "battle_death",
          category: "battle",
          description: `Смерть от игрока #${killerId} на карте ${mapName}`,
          newValue: combatValue,
          source: "battle_server"
        });
      }
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

function acquireHttpRequestSlot(req, res) {
  const ip = requestClientIp(req);
  const ipActive = Number(httpInFlightByIp.get(ip) || 0);
  if (httpInFlight >= MAX_HTTP_IN_FLIGHT || ipActive >= MAX_HTTP_IN_FLIGHT_PER_IP) return false;
  httpInFlight += 1;
  httpInFlightByIp.set(ip, ipActive + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    httpInFlight = Math.max(0, httpInFlight - 1);
    const remaining = Number(httpInFlightByIp.get(ip) || 0) - 1;
    if (remaining > 0) httpInFlightByIp.set(ip, remaining);
    else httpInFlightByIp.delete(ip);
  };
  res.once("finish", release);
  res.once("close", release);
  return true;
}

function serviceErrorStatus(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  if (
    code === "DATABASE_BUSY" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code.startsWith("08") ||
    ["57P01", "57P02", "57P03", "53300", "53400"].includes(code) ||
    message.includes("database_busy") ||
    message.includes("timeout") ||
    message.includes("connection") ||
    message.includes("connect econn") ||
    message.includes("too many connections")
  ) return 503;
  if (message.includes("body_too_large")) return 413;
  if (message.includes("invalid_json")) return 400;
  return 500;
}

async function handleHttpRequest(req, res) {
  if (Buffer.byteLength(req.url || "", "utf8") > MAX_REQUEST_URL_BYTES) {
    sendJson(res, { ok: false, error: "uri_too_long" }, 414);
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (!allowPlayerFacingOrigin(req, url.pathname)) {
    sendJson(res, { ok: false, error: "not_found" }, 404);
    return;
  }
  if (!allowHttpRequest(req, url)) {
    sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
    return;
  }
  const requestOrigin = requestPublicOrigin(req, url);

  if (process.env.SECURITY_TEST_FORCE_DB_OUTAGE === "1" && url.pathname === "/__security-test/db-outage") {
    const error = new Error("connect ECONNREFUSED simulated runtime PostgreSQL outage");
    error.code = "ECONNREFUSED";
    throw error;
  }

  if (await adminLogsApi.handle(req, res, url)) {
    return;
  }

  if (url.pathname === "/" || url.pathname === "/auth") {
    sendHtml(res, "<h1>Contra City legacy API</h1><p>API online.</p>");
    return;
  }

  if (tryServeAssetBundle(req, res, url)) {
    return;
  }

  if (tryServeLauncherRelease(req, res, url)) {
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
<p>API работает.</p>
<p>Хранилище: <b>${pgPool ? "PostgreSQL" : "JSON fallback"}</b></p>
<p>Создать/сбросить аккаунт: <a href="/create?code=${encodeURIComponent(CREATE_CODE)}">/create</a></p>
<p>Текущий аккаунт: ${escapeHtml(account.name)}, уровень ${account.level}, монеты ${account.money}</p>
<p>Ссылка для входа: <code>${escapeHtml(link)}</code></p>`
    );
    return;
  }

  if (url.pathname === "/admin/promocodes" || url.pathname === "/admin/promocodes/status") {
    if (!hasValidPromoAdminToken(req)) {
      sendJson(res, { ok: false, error: "not_found" }, 404);
      return;
    }
    try {
      if (url.pathname === "/admin/promocodes" && req.method === "GET") {
        const result = await listPromoCodes(url.searchParams.get("limit"));
        sendJson(res, result, result.status || 200);
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
        return;
      }
      const body = await readJsonBody(req, 16 * 1024);
      const result = url.pathname === "/admin/promocodes"
        ? await createPromoCode(body)
        : await setPromoCodeActive(body);
      if (result.ok) {
        const promo = result.promo;
        await writeAuditEvent(pgPool, {
          eventType: url.pathname === "/admin/promocodes" ? "promo_created" : "promo_status_changed",
          category: "economy",
          severity: "notice",
          description: url.pathname === "/admin/promocodes"
            ? `Создан промокод ${promo.code}: ${promo.rewardAmount} контрабаксов`
            : `Промокод ${promo.code} ${promo.active ? "включён" : "выключен"}`,
          source: "telegram_admin",
          ipAddress: requestClientIp(req),
          device: String(req.headers["user-agent"] || "").slice(0, 300),
          newValue: promo,
          metadata: {
            telegramAdminId: Number(body?.createdByTelegramId || body?.adminTelegramId || 0) || null
          }
        });
      }
      sendJson(res, result, result.status || (result.ok ? 200 : 400));
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(res, { ok: false, error: status === 503 ? "service_unavailable" : (error.message || "promo_admin_failed") }, status);
    }
    return;
  }

  if (url.pathname === "/donate/catalog") {
    if (req.method !== "GET") {
      sendJson(
        res,
        { ok: false, error: "method_not_allowed" },
        405,
        { "access-control-allow-origin": "*" }
      );
      return;
    }
    try {
      const result = await listDonateProducts();
      sendJson(
        res,
        result,
        result.status || (result.ok ? 200 : 503),
        {
          "access-control-allow-origin": "*",
          "cache-control": "no-store"
        }
      );
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(
        res,
        {
          ok: false,
          error: status === 503
            ? "service_unavailable"
            : "donate_catalog_failed"
        },
        status,
        { "access-control-allow-origin": "*" }
      );
    }
    return;
  }

  if (url.pathname.startsWith("/bot/telegram")) {
    if (!hasValidTelegramLinkApiToken(req)) {
      sendJson(res, { ok: false, error: "not_found" }, 404);
      return;
    }
    try {
      let result;
      if (url.pathname === "/bot/telegram/account" ||
          url.pathname === "/bot/telegram/confirmations" ||
          url.pathname === "/bot/telegram/links" ||
          url.pathname === "/bot/telegram/store/catalog") {
        if (req.method !== "GET") {
          sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
          return;
        }
        if (url.pathname === "/bot/telegram/store/catalog") {
          result = await listDonateProducts();
        } else if (url.pathname === "/bot/telegram/account") {
          const telegramUserId = Number(url.searchParams.get("telegramUserId") || 0);
          if (!allowTelegramIdentityRequest(req, telegramUserId, "account", { limit: 120 })) {
            sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
            return;
          }
          result = await botTelegramAccountStatus(telegramUserId);
        } else if (url.pathname === "/bot/telegram/confirmations") {
          result = await listBotTelegramConfirmations(url.searchParams.get("limit"));
        } else {
          result = await listTelegramBindings(url.searchParams.get("limit"));
        }
      } else {
        if (req.method !== "POST") {
          sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
          return;
        }
        const body = await readJsonBody(req, 16 * 1024);
        const telegramUserId = Number(
          body?.telegram?.id || body?.telegramUserId || body?.adminTelegramId || 0
        );
        const codeCreation = url.pathname === "/bot/telegram/code/create";
        if (telegramUserId && !allowTelegramIdentityRequest(
          req,
          telegramUserId,
          codeCreation ? "code-create" : url.pathname,
          codeCreation
            ? { windowMs: 10 * 60 * 1000, limit: 5 }
            : { windowMs: 60000, limit: 120 }
        )) {
          sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
          return;
        }

        if (url.pathname === "/bot/telegram/code/create") {
          result = await createBotTelegramPairingCode(body?.telegram, body?.chatId);
        } else if (url.pathname === "/bot/telegram/store/order") {
          result = await createDonateOrder(body?.telegramUserId, body?.productId);
        } else if (url.pathname === "/bot/telegram/store/precheckout") {
          result = await validateDonateCheckout(
            body?.orderId,
            body?.telegramUserId,
            body?.currency,
            body?.totalAmount
          );
        } else if (url.pathname === "/bot/telegram/store/settle") {
          result = await settleDonatePayment(body);
        } else if (url.pathname === "/bot/telegram/store/admin/stock/reset") {
          result = await resetDonateLimitedStock(
            body?.adminTelegramId,
            body?.productId
          );
        } else if (url.pathname === "/bot/telegram/code/message") {
          result = await attachBotTelegramPairingMessage(body);
        } else if (url.pathname === "/bot/telegram/confirmation/notified") {
          result = await markBotTelegramConfirmationNotified(body);
        } else if (url.pathname === "/bot/telegram/code/decision") {
          result = await decideTelegramPairing(
            body?.requestId,
            body?.telegram,
            body?.decision
          );
        } else if (url.pathname === "/bot/telegram/admin/reset-player") {
          result = await resetTelegramBindingForPlayer(
            body?.playerId,
            body?.adminTelegramId
          );
        } else if (url.pathname === "/bot/telegram/admin/reset-link") {
          result = await resetLauncherGameLinkForTelegramAdmin(
            body?.playerId,
            body?.adminTelegramId,
            requestOrigin
          );
        } else if (url.pathname === "/bot/telegram/admin/reset-all/prepare") {
          result = await prepareGlobalTelegramBindingReset(body?.adminTelegramId);
        } else if (url.pathname === "/bot/telegram/admin/reset-all/execute") {
          result = await executeGlobalTelegramBindingReset(
            body?.requestId,
            body?.adminTelegramId
          );
        } else {
          sendJson(res, { ok: false, error: "not_found" }, 404);
          return;
        }
      }
      const responseStatus = !result.ok && Number.isInteger(result.status)
        ? result.status
        : 200;
      sendJson(res, result, responseStatus);
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(res, {
        ok: false,
        error: status === 503 ? "service_unavailable" : (error.message || "telegram_link_failed")
      }, status);
    }
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
      if (!allowResolvedIdentityRequest(req, account, body)) {
        sendJson(res, { result: false, error: "rate_limited" }, 429, { "retry-after": "60" });
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
      const status = serviceErrorStatus(error);
      sendJson(res, { result: false, error: status === 503 ? "service_unavailable" : (error.message || "device_challenge_failed") }, status);
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
      const rotated = await rotateLauncherGameLink(ccid);
      if (!rotated?.account) {
        sendJson(res, { ok: false, error: "player_not_found" }, 404);
        return;
      }
      console.log(
        `[game-link] admin rotated player=${ccid} deviceRemoved=${rotated.bindingRemoved} ` +
        `telegramRemoved=${rotated.telegramBindingRemoved ? 1 : 0}`
      );
      await writeAuditEvent(pgPool, {
        playerId: ccid,
        eventType: "admin_game_link_reset",
        category: "security",
        severity: "warning",
        description: `Администратор удалил старую игровую ссылку, привязку устройства и Telegram`,
        source: "legacy_admin_token",
        ipAddress: requestClientIp(req),
        device: String(req.headers["user-agent"] || "").slice(0, 300),
        newValue: {
          linkRotated: true,
          deviceBindingRemoved: rotated.bindingRemoved,
          telegramBindingRemoved: rotated.telegramBindingRemoved
        }
      });
      sendJson(res, {
        ok: true,
        ccid,
        removed: rotated.bindingRemoved,
        telegramRemoved: rotated.telegramBindingRemoved,
        linkRotated: true,
        loginLink: loginLink(rotated.account, requestOrigin)
      });
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(res, { ok: false, error: status === 503 ? "service_unavailable" : (error.message || "game_link_reset_failed") }, status);
    }
    return;
  }

  if (url.pathname === "/launcher/telegram/request" ||
      url.pathname === "/launcher/telegram/code/claim" ||
      url.pathname === "/launcher/telegram/status") {
    if (req.method !== "POST") {
      sendJson(res, { result: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const launcherAuth = await accountFromLauncherSessionBody(body);
      if (!launcherAuth.ok) {
        sendJson(res, { result: false, error: launcherAuth.error }, launcherAuth.status || 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, launcherAuth.account, body)) {
        sendJson(res, { result: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      let result;
      if (url.pathname === "/launcher/telegram/request") {
        result = await createTelegramLoginRequest(
          launcherAuth.account,
          launcherAuth.device,
          req
        );
      } else if (url.pathname === "/launcher/telegram/code/claim") {
        result = await claimTelegramPairingCode(
          launcherAuth.account,
          launcherAuth.device,
          req,
          body
        );
      } else {
        result = await latestTelegramPairingStatus(
          launcherAuth.account,
          launcherAuth.device,
          req,
          body?.loginRequestId
        );
      }
      if (!result.ok) {
        sendJson(res, {
          result: false,
          error: result.error,
          ...(Number.isFinite(Number(result.remainingAttempts))
            ? { remainingAttempts: Number(result.remainingAttempts) }
            : {})
        }, result.status || 400);
        return;
      }
      sendJson(res, { result: true, ...result }, 200, {}, { ascii: true });
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(res, {
        result: false,
        error: status === 503 ? "service_unavailable" : (error.message || "telegram_link_failed")
      }, status);
    }
    return;
  }

  if (url.pathname === "/launcher-state") {
    let body = {};
    if (req.method === "POST") {
      try {
        body = await readJsonBody(req, 32 * 1024);
      } catch (error) {
        sendJson(res, { result: false, error: error.message || "invalid_json", news: launcherNewsPayload() }, 400, {}, { ascii: true });
        return;
      }
    }

    const account = req.method === "POST"
      ? await accountFromLauncherDeviceBody(body, url)
      : await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "invalid_session", news: launcherNewsPayload() }, 403, {}, { ascii: true });
      return;
    }
    if (!allowResolvedIdentityRequest(req, account, body)) {
      sendJson(res, { result: false, error: "rate_limited", news: launcherNewsPayload() }, 429, { "retry-after": "60" }, { ascii: true });
      return;
    }

    let deviceAccess;
    try {
      deviceAccess = await verifyLauncherDeviceAccess(account, body, req);
    } catch (error) {
      console.error("[launcher-device] access check failed", error);
      const status = serviceErrorStatus(error);
      sendJson(res, { result: false, error: status === 503 ? "service_unavailable" : "device_binding_failed", news: launcherNewsPayload() }, status, {}, { ascii: true });
      return;
    }
    if (!deviceAccess.ok) {
      sendJson(res, { result: false, error: deviceAccess.error, news: launcherNewsPayload() }, deviceAccess.status || 403, {}, { ascii: true });
      return;
    }

    const telegram = await launcherTelegramStatus(account, req);
    const launcherSession = createLauncherSession(account, body?.deviceKeyId);
    sendJson(res, {
      ...launcherStatePayload(account),
      telegram: telegramStatusPayload(telegram),
      sessionToken: launcherSession.token,
      sessionExpiresInSeconds: launcherSession.expiresInSeconds
    }, 200, { "Set-Cookie": cookieHeaders(account) }, { ascii: true });
    return;
  }

  if (url.pathname === "/launcher/promo/redeem") {
    if (req.method !== "POST") {
      sendJson(res, { result: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const launcherAuth = await accountFromLauncherSessionBody(body);
      if (!launcherAuth.ok) {
        sendJson(res, { result: false, error: launcherAuth.error }, launcherAuth.status || 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, launcherAuth.account, body)) {
        sendJson(res, { result: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      const telegram = await launcherTelegramStatus(launcherAuth.account, req);
      if (!telegram.verified) {
        sendJson(res, { result: false, error: "telegram_verification_required" }, 403);
        return;
      }

      const redemption = await redeemPromoCode(launcherAuth.account, body?.code, {
        deviceKeyId: launcherAuth.device.deviceKeyId,
        ipAddress: requestClientIp(req)
      });
      if (!redemption.ok) {
        sendJson(res, { result: false, error: redemption.error }, redemption.status || 400);
        return;
      }

      launcherAuth.account.money = Number(redemption.balance);
      const cached = store.accounts[String(launcherAuth.account.id)];
      if (cached) {
        cached.money = Number(redemption.balance);
        cached.updatedAt = new Date().toISOString();
      }
      console.log(
        `[promo] player=${launcherAuth.account.id} code=${redemption.promo.code} ` +
        `reward=${redemption.rewardAmount} balance=${redemption.balance} ` +
        `already=${redemption.alreadyRedeemed ? 1 : 0}`
      );
      sendJson(res, {
        result: true,
        status: redemption.status,
        alreadyRedeemed: redemption.alreadyRedeemed,
        code: redemption.promo.code,
        reward: { contrabucks: redemption.rewardAmount },
        balance: redemption.balance,
        redeemedAt: redemption.redeemedAt
      }, 200, {}, { ascii: true });
    } catch (error) {
      const status = serviceErrorStatus(error);
      sendJson(res, { result: false, error: status === 503 ? "service_unavailable" : (error.message || "promo_redeem_failed") }, status);
    }
    return;
  }

  if (url.pathname === "/launcher-session") {
    const account = await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "invalid_session" }, 403);
      return;
    }

    const launcherSession = createLauncherSession(account);
    await recordPlayerAccess(account, req, "login", "launcher_session");
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
    await recordPlayerAccess(account, req, "login", "web_session");
    sendJson(res, {
      result: true,
      ...sessionPayload(account, requestOrigin)
    });
    return;
  }

  if (url.pathname === "/vk-login" || url.pathname === "/login-link") {
    const account = await loginAccountFromUrl(url);
    if (!account) {
      sendHtml(res, "<h1>Contra City login</h1><p>Ссылка входа недействительна.</p>", 403);
      return;
    }
    await recordPlayerAccess(account, req, "login", "login_link");
    sendHtml(
      res,
      `<h1>Contra City login</h1><p>Ссылка активна для ${escapeHtml(account.name)} (#${account.id}).</p>`,
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

  if (url.pathname === "/battle-pass/case/open") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 8 * 1024);
      const parsedAccess = parseSummerCaseAccessToken(body.token);
      if (!parsedAccess) {
        sendJson(res, { ok: false, error: "case_access_invalid" }, 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, { id: parsedAccess.playerId }, body)) {
        sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      const auditContext = {
        ipAddress: requestClientIp(req),
        device: String(req.headers["user-agent"] || "").slice(0, 300),
        geo: requestGeo(req),
        source: "battle_pass_case"
      };
      const result = await requestAuditContext.run(
        auditContext,
        () => openBattlePassCase(body)
      );
      const { status, ...payload } = result;
      sendJson(res, payload, status || (payload.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(
        res,
        { ok: false, error: error.message || "case_open_failed" },
        serviceErrorStatus(error)
      );
    }
    return;
  }

  if (url.pathname === "/battle-pass/case/resolve") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 8 * 1024);
      const parsedAccess = parseSummerCaseAccessToken(body.token);
      if (!parsedAccess) {
        sendJson(res, { ok: false, error: "case_access_invalid" }, 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, { id: parsedAccess.playerId }, body)) {
        sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      const auditContext = {
        ipAddress: requestClientIp(req),
        device: String(req.headers["user-agent"] || "").slice(0, 300),
        geo: requestGeo(req),
        source: "battle_pass_case_resolution"
      };
      const result = await requestAuditContext.run(
        auditContext,
        () => resolveBattlePassCaseReward(body)
      );
      const { status, ...payload } = result;
      sendJson(res, payload, status || (payload.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(
        res,
        { ok: false, error: error.message || "case_resolution_failed" },
        serviceErrorStatus(error)
      );
    }
    return;
  }

  if (url.pathname.endsWith("/ajax.php")) {
    await mergeAjaxBodyParams(req, url);
    const account = await accountFromRequest(url);
    if (!account) {
      sendJson(res, { result: false, error: "1" }, 403);
      return;
    }
    await recordGameLoginOnce(account, req);
    const auditContext = {
      ipAddress: requestClientIp(req),
      device: String(req.headers["user-agent"] || "").slice(0, 300),
      geo: requestGeo(req),
      source: "game_api"
    };
    const payload = await requestAuditContext.run(auditContext, () => routeAjax(url, account, requestOrigin));
    sendJson(res, payload, 200, { "Set-Cookie": cookieHeaders(account) });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, {
      ok: true,
      build: API_BUILD_ID,
      storage: pgPool ? "postgres" : "json-file",
      battleHost: BATTLE_HOST,
      ...(process.env.SECURITY_TEST_METRICS === "1" ? {
        securityMetrics: {
          rateLimitBuckets: rateLimitBuckets.size,
          httpInFlight,
          httpInFlightIps: httpInFlightByIp.size,
          postgresMutationQueueDepth,
        },
      } : {}),
    });
    return;
  }

  if (url.pathname === "/battle/admin/action") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 32 * 1024);
      if (!hasValidBattleServiceToken(req, body)) {
        sendJson(res, { ok: false, error: "invalid_token" }, 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, { id: Number(body.actorPlayerId || 0) }, body)) {
        sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      const result = await executeBattleStaffAction(pgPool, body);
      if (result.invalidateBanPlayerId) {
        playerBanCache.delete(Number(result.invalidateBanPlayerId));
      }
      const { status, invalidateBanPlayerId, ...payload } = result;
      sendJson(res, payload, status || (payload.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "staff_action_failed" }, serviceErrorStatus(error));
    }
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
      sendJson(res, { ok: false, error: error.message || "battle_social_failed" }, serviceErrorStatus(error));
    }
    return;
  }

  if (url.pathname === "/battle/clan-events") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 32 * 1024);
      if (!hasValidBattleServiceToken(req, body)) {
        sendJson(res, { ok: false, error: "invalid_token" }, 403);
        return;
      }
      sendJson(res, await battleClanTreasuryEvents(body));
    } catch (error) {
      console.error("[clan-live] treasury-feed failed", error);
      sendJson(res, { ok: false, error: error.message || "clan_treasury_feed_failed" }, serviceErrorStatus(error));
    }
    return;
  }

  if (url.pathname === "/battle/security") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req, 32 * 1024);
      if (!hasValidBattleServiceToken(req, body)) {
        sendJson(res, { ok: false, error: "invalid_token" }, 403);
        return;
      }
      if (!allowResolvedIdentityRequest(req, { id: Number(body.playerId || body.accountId || 0) }, body)) {
        sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      sendJson(res, await recordBattleSecurityEvent(body));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "battle_security_failed" }, serviceErrorStatus(error));
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
      if (!allowResolvedIdentityRequest(req, { id: Number(body.playerId || 0) }, body)) {
        sendJson(res, { ok: false, error: "rate_limited" }, 429, { "retry-after": "60" });
        return;
      }
      const result = await recordBattleEvent(body);
      sendJson(res, result, result.status || (result.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "battle_event_failed" }, serviceErrorStatus(error));
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
        ? "players/player_inventory/player_abilities/player_equipment/purchase_history/player_weapon_stats/player_achievements/player_match_stats/clans/clan_members/player_friends/catalog_items/battle_rooms/battle_room_players/battle_spawn_events/battle_score_events/battle_chat_events/player_reports/player_staff_roles/player_staff_chat_messages/player_staff_actions"
        : "accounts-json",
      accounts: Object.keys(store.accounts).length,
      databaseUrlConfigured: Boolean(DATABASE_URL)
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

const server = http.createServer((req, res) => {
  if (!acquireHttpRequestSlot(req, res)) {
    sendJson(res, { ok: false, error: "server_busy" }, 503, { "retry-after": "1" });
    return;
  }
  handleHttpRequest(req, res).catch((error) => {
    console.error("[http] unhandled request error", error);
    if (!res.headersSent) {
      sendJson(res, { ok: false, error: serviceErrorStatus(error) === 503 ? "service_unavailable" : "request_failed" }, serviceErrorStatus(error));
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Contra City legacy API listening on ${PORT} build=${API_BUILD_ID}`);
  if (!adminLogsStatus?.configured) console.warn(`[admin-logs] owner account is not configured reason=${adminLogsStatus?.reason || "unknown"}`);
  else console.log(`[admin-logs] owner ready id=${adminLogsStatus.ownerId}`);
  if (!BATTLE_EVENT_TOKEN) console.warn("[security] BATTLE_EVENT_TOKEN is missing; battle service endpoints reject all calls");
  if (!TELEGRAM_LINK_API_TOKEN) {
    console.warn("[security] TELEGRAM_LINK_API_TOKEN is missing; launcher Telegram verification is unavailable");
  }
  if (!Number.isSafeInteger(TELEGRAM_ADMIN_ID) || TELEGRAM_ADMIN_ID <= 0) {
    console.warn("[security] TELEGRAM_ADMIN_ID is invalid; Telegram binding resets are disabled");
  }
  if (!CLOUDFRONT_ORIGIN_SECRET) console.warn(`[security] CLOUDFRONT_ORIGIN_SECRET is missing; origin guard mode=${ORIGIN_GUARD_MODE}`);
  console.log(`[security] originGuard=${ORIGIN_GUARD_MODE} viewerIp=cloudfront-viewer-address rateBuckets=${RATE_LIMIT_BUCKET_CAP} connections=${MAX_HTTP_CONNECTIONS} inFlight=${MAX_HTTP_IN_FLIGHT}/ip${MAX_HTTP_IN_FLIGHT_PER_IP} pgPool=${POSTGRES_POOL_MAX} pgQueryTimeout=${POSTGRES_QUERY_TIMEOUT_MS}ms pgQueue=${POSTGRES_MUTATION_QUEUE_MAX}`);
  if (!ADMIN_API_TOKEN) console.warn("[security] ADMIN_API_TOKEN is missing; /db is disabled");
  if (!CREATE_CODE) console.warn("[security] CREATE_CODE is not set; /create account creation is disabled.");
  if (CREATE_CODE === "CONTRA-REVIVE-2026") console.warn("[security] CREATE_CODE still uses the public fallback; rotate it");
  if (DEFAULT_KEY === "contra-revive-key") console.warn("[security] DEFAULT_KEY still uses the public fallback; rotate it");
});
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(HTTP_HEADERS_TIMEOUT_MS, HTTP_REQUEST_TIMEOUT_MS);
server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.maxHeadersCount = 64;
server.maxConnections = MAX_HTTP_CONNECTIONS;
server.dropMaxConnection = true;
server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});




