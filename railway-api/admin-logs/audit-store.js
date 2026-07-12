import crypto from "node:crypto";

export const ADMIN_ROLES = Object.freeze(["owner", "head_admin", "admin", "moderator", "viewer"]);

const SUSPICION_RULES = Object.freeze({
  purchase: { minutes: 5, count: 8 },
  weapon_upgrade: { minutes: 10, count: 5 },
  daily_quest_claim: { minutes: 60, count: 4 },
  achievement_complete: { minutes: 10, count: 8 },
  balance_change: { minutes: 10, count: 6 },
  inventory_change: { minutes: 10, count: 10 },
  clan_treasury_deposit: { minutes: 10, count: 6 },
  admin_action: { minutes: 10, count: 10 }
});

function asJson(value) {
  if (value === undefined) return null;
  return value;
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanSeverity(value) {
  return ["info", "notice", "warning", "critical"].includes(value) ? value : "info";
}

async function automaticSuspicion(db, event) {
  const rule = SUSPICION_RULES[event.eventType];
  const playerId = cleanId(event.playerId);
  if (!rule || !playerId) return false;

  const recent = await db.query(
    `SELECT count(*)::int AS count
     FROM audit_events
     WHERE player_id = $1
       AND event_type = $2
       AND created_at >= now() - ($3::int * interval '1 minute')`,
    [playerId, event.eventType, rule.minutes]
  );
  return Number(recent.rows[0]?.count || 0) + 1 >= rule.count;
}

export async function writeAuditEvent(db, rawEvent = {}) {
  if (!db?.query) return null;
  const event = {
    eventType: cleanText(rawEvent.eventType || "unknown", 80),
    category: cleanText(rawEvent.category || "system", 50),
    description: cleanText(rawEvent.description || rawEvent.eventType || "Событие", 1000),
    playerId: cleanId(rawEvent.playerId),
    playerName: cleanText(rawEvent.playerName, 80),
    clanId: cleanId(rawEvent.clanId),
    clanName: cleanText(rawEvent.clanName, 120),
    severity: cleanSeverity(rawEvent.severity),
    suspicious: Boolean(rawEvent.suspicious),
    oldValue: asJson(rawEvent.oldValue),
    newValue: asJson(rawEvent.newValue),
    source: cleanText(rawEvent.source || "game_api", 80),
    ipAddress: cleanText(rawEvent.ipAddress, 128),
    device: cleanText(rawEvent.device, 300),
    adminUserId: cleanId(rawEvent.adminUserId),
    metadata: rawEvent.metadata && typeof rawEvent.metadata === "object" ? rawEvent.metadata : {}
  };

  if (!event.suspicious) event.suspicious = await automaticSuspicion(db, event);
  if (event.eventType === "balance_change") {
    const before = Number(event.oldValue?.balance ?? event.oldValue ?? 0);
    const after = Number(event.newValue?.balance ?? event.newValue ?? 0);
    if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) >= 10000) {
      event.suspicious = true;
      event.severity = event.severity === "critical" ? "critical" : "warning";
    }
  }

  if (event.playerId && !["admin_panel", "legacy_admin_token", "history_backfill"].includes(event.source)) {
    await touchPlayerActivity(db, {
      playerId: event.playerId,
      kind: "seen",
      ipAddress: event.ipAddress,
      device: event.device,
      source: event.source
    });
  }

  const result = await db.query(
    `INSERT INTO audit_events (
       player_id, player_name, clan_id, clan_name, event_type, category, severity,
       suspicious, description, old_value, new_value, source, ip_address, device,
       admin_user_id, metadata
     )
     VALUES (
       $1,
       COALESCE(NULLIF($2, ''), (SELECT name FROM players WHERE id = $1), ''),
       $3,
       COALESCE(NULLIF($4, ''), (SELECT name FROM clans WHERE id = $3), ''),
       $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb
     )
     RETURNING id, created_at, suspicious, severity`,
    [
      event.playerId,
      event.playerName,
      event.clanId,
      event.clanName,
      event.eventType,
      event.category,
      event.severity,
      event.suspicious,
      event.description,
      JSON.stringify(event.oldValue),
      JSON.stringify(event.newValue),
      event.source,
      event.ipAddress,
      event.device,
      event.adminUserId,
      JSON.stringify(event.metadata)
    ]
  );
  return result.rows[0] || null;
}

export async function touchPlayerActivity(db, rawActivity = {}) {
  if (!db?.query) return;
  const playerId = cleanId(rawActivity.playerId);
  if (!playerId) return;
  const kind = ["login", "logout", "seen"].includes(rawActivity.kind) ? rawActivity.kind : "seen";
  await db.query(
    `INSERT INTO player_activity (
       player_id, last_seen_at, last_login_at, last_logout_at,
       last_ip_address, last_device, last_source, updated_at
     )
     VALUES (
       $1, now(),
       CASE WHEN $2 = 'login' THEN now() ELSE NULL END,
       CASE WHEN $2 = 'logout' THEN now() ELSE NULL END,
       $3, $4, $5, now()
     )
     ON CONFLICT (player_id) DO UPDATE SET
       last_seen_at = now(),
       last_login_at = CASE WHEN $2 = 'login' THEN now() ELSE player_activity.last_login_at END,
       last_logout_at = CASE WHEN $2 = 'logout' THEN now() ELSE player_activity.last_logout_at END,
       last_ip_address = CASE WHEN $3 <> '' THEN $3 ELSE player_activity.last_ip_address END,
       last_device = CASE WHEN $4 <> '' THEN $4 ELSE player_activity.last_device END,
       last_source = CASE WHEN $5 <> '' THEN $5 ELSE player_activity.last_source END,
       updated_at = now()`,
    [
      playerId,
      kind,
      cleanText(rawActivity.ipAddress, 128),
      cleanText(rawActivity.device, 300),
      cleanText(rawActivity.source, 80)
    ]
  );
}

export function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const normalized = String(password || "");
  if (normalized.length < 12 || normalized.length > 200) {
    throw new Error("admin_password_length");
  }
  const hash = crypto.scryptSync(normalized, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return { salt, hash };
}

export function verifyAdminPassword(password, salt, expectedHash) {
  try {
    const actual = Buffer.from(hashAdminPassword(password, salt).hash, "hex");
    const expected = Buffer.from(String(expectedHash || ""), "hex");
    return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function ensureOwnerAccount(pool, env = process.env) {
  if (!pool?.query) return { configured: false, reason: "postgres_disabled" };
  const login = cleanText(env.LOG_PANEL_OWNER_LOGIN, 64).toLowerCase();
  const password = String(env.LOG_PANEL_OWNER_PASSWORD || "");
  const displayName = cleanText(env.LOG_PANEL_OWNER_NAME || "Владелец", 80);
  if (!login || !password) return { configured: false, reason: "owner_env_missing" };

  const existing = await pool.query("SELECT id, login FROM admin_users WHERE role = 'owner' AND active = TRUE LIMIT 1");
  const passwordData = hashAdminPassword(password);
  if (existing.rowCount) {
    const owner = existing.rows[0];
    if (String(owner.login).toLowerCase() !== login) {
      return { configured: true, ownerId: Number(owner.id), preservedExistingOwner: true };
    }
    if (env.LOG_PANEL_SYNC_OWNER_PASSWORD === "1") {
      await pool.query(
        `UPDATE admin_users SET display_name = $2, password_salt = $3, password_hash = $4, updated_at = now() WHERE id = $1`,
        [Number(owner.id), displayName, passwordData.salt, passwordData.hash]
      );
    }
    return { configured: true, ownerId: Number(owner.id) };
  }

  const inserted = await pool.query(
    `INSERT INTO admin_users (login, display_name, password_salt, password_hash, role)
     VALUES ($1, $2, $3, $4, 'owner') RETURNING id`,
    [login, displayName, passwordData.salt, passwordData.hash]
  );
  return { configured: true, ownerId: Number(inserted.rows[0].id), created: true };
}
