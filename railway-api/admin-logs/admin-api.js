import crypto from "node:crypto";
import {
  ADMIN_ROLES,
  ensureOwnerAccount,
  hashAdminPassword,
  verifyAdminPassword,
  writeAuditEvent
} from "./audit-store.js";

const SESSION_TTL_HOURS = Math.max(1, Math.min(72, Number(process.env.LOG_PANEL_SESSION_TTL_HOURS || 12)));
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;
const loginFailures = new Map();

const ROLE_PERMISSIONS = Object.freeze({
  owner: ["read", "export", "review", "manual_action", "manage_admins"],
  head_admin: ["read", "export", "review", "manual_action"],
  admin: ["read", "export", "review", "manual_action"],
  moderator: ["read", "review"],
  viewer: ["read"]
});

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function numberId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  return match ? match[1].trim() : "";
}

function allowedOrigins() {
  return String(process.env.LOG_PANEL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(req) {
  const origin = cleanText(req.headers.origin, 300).replace(/\/+$/, "");
  const allowed = allowedOrigins();
  const originAllowed = !origin || allowed.includes(origin) || allowed.includes("*");
  return {
    allowed: originAllowed,
    headers: origin && originAllowed
      ? {
          "access-control-allow-origin": allowed.includes("*") ? "*" : origin,
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-max-age": "600",
          vary: "Origin"
        }
      : {}
  };
}

function sendJson(res, payload, status = 200, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-length": String(Buffer.byteLength(body)),
    ...headers
  });
  res.end(body);
}

function hasPermission(admin, permission) {
  return Boolean(admin?.active) && (ROLE_PERMISSIONS[admin.role] || []).includes(permission);
}

function publicAdmin(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    login: row.login,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    permissions: ROLE_PERMISSIONS[row.role] || []
  };
}

function eventDto(row) {
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    playerId: row.player_id == null ? null : Number(row.player_id),
    playerName: row.player_name || "",
    clanId: row.clan_id == null ? null : Number(row.clan_id),
    clanName: row.clan_name || "",
    eventType: row.event_type,
    category: row.category,
    severity: row.severity,
    suspicious: Boolean(row.suspicious),
    description: row.description,
    oldValue: row.old_value,
    newValue: row.new_value,
    source: row.source,
    ipAddress: row.ip_address || "",
    device: row.device || "",
    admin: row.admin_login
      ? { id: Number(row.admin_user_id), login: row.admin_login, displayName: row.admin_display_name || row.admin_login }
      : null,
    metadata: row.metadata || {},
    reviewStatus: row.review_status,
    adminNote: row.admin_note || "",
    reviewedBy: row.reviewer_login || "",
    reviewedAt: row.reviewed_at
  };
}

async function authenticate(pool, req) {
  const token = bearerToken(req);
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.*, s.id AS session_id
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.active = TRUE
     LIMIT 1`,
    [tokenHash(token)]
  );
  const admin = result.rows[0];
  if (!admin) return null;
  await pool.query(
    `UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`,
    [admin.session_id]
  );
  return admin;
}

function requirePermission(res, headers, admin, permission) {
  if (!admin) {
    sendJson(res, { ok: false, error: "unauthorized" }, 401, headers);
    return false;
  }
  if (!hasPermission(admin, permission)) {
    sendJson(res, { ok: false, error: "forbidden" }, 403, headers);
    return false;
  }
  return true;
}

function loginBucketKey(req, requestIp) {
  return cleanText(requestIp?.(req) || req.socket?.remoteAddress || "unknown", 128);
}

function loginBlocked(key) {
  const now = Date.now();
  const bucket = loginFailures.get(key);
  if (!bucket || now - bucket.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.set(key, { startedAt: now, count: 0 });
    return false;
  }
  return bucket.count >= LOGIN_FAILURE_LIMIT;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const bucket = loginFailures.get(key);
  if (!bucket || now - bucket.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailures.set(key, { startedAt: now, count: 1 });
  } else {
    bucket.count += 1;
  }
}

function addFilter(conditions, values, sql, value) {
  values.push(value);
  conditions.push(sql.replace("?", `$${values.length}`));
}

function dateFromPeriod(period) {
  const duration = { "1h": 3600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 }[period];
  return duration ? new Date(Date.now() - duration).toISOString() : "";
}

function eventFilterSql(url, { includePagination = true } = {}) {
  const conditions = [];
  const values = [];
  const q = cleanText(url.searchParams.get("q"), 120);
  if (q) {
    values.push(`%${q}%`);
    conditions.push(`(
      e.player_name ILIKE $${values.length}
      OR e.clan_name ILIKE $${values.length}
      OR e.event_type ILIKE $${values.length}
      OR e.description ILIKE $${values.length}
      OR CAST(e.id AS text) ILIKE $${values.length}
      OR CAST(e.player_id AS text) ILIKE $${values.length}
    )`);
  }
  const exactFilters = [
    ["playerId", "e.player_id = ?", Number],
    ["clanId", "e.clan_id = ?", Number],
    ["eventType", "e.event_type = ?", String],
    ["category", "e.category = ?", String],
    ["severity", "e.severity = ?", String],
    ["reviewStatus", "e.review_status = ?", String]
  ];
  for (const [key, sql, convert] of exactFilters) {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === "") continue;
    const value = convert(raw);
    if (convert === Number && (!Number.isInteger(value) || value <= 0)) continue;
    addFilter(conditions, values, sql, value);
  }
  const categories = cleanText(url.searchParams.get("categories"), 300)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[a-z0-9_]{1,50}$/i.test(value))
    .slice(0, 20);
  if (categories.length) addFilter(conditions, values, "e.category = ANY(?::text[])", categories);
  const suspicious = url.searchParams.get("suspicious");
  if (suspicious === "true" || suspicious === "false") addFilter(conditions, values, "e.suspicious = ?", suspicious === "true");
  const from = cleanText(url.searchParams.get("dateFrom") || dateFromPeriod(url.searchParams.get("period")), 40);
  const to = cleanText(url.searchParams.get("dateTo"), 40);
  if (from && !Number.isNaN(Date.parse(from))) addFilter(conditions, values, "e.created_at >= ?", new Date(from).toISOString());
  if (to && !Number.isNaN(Date.parse(to))) addFilter(conditions, values, "e.created_at <= ?", new Date(to).toISOString());
  const sinceId = numberId(url.searchParams.get("sinceId"));
  if (sinceId) addFilter(conditions, values, "e.id > ?", sinceId);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values, includePagination };
}

const EVENT_SELECT = `
  SELECT e.*, a.login AS admin_login, a.display_name AS admin_display_name,
         reviewer.login AS reviewer_login
  FROM audit_events e
  LEFT JOIN admin_users a ON a.id = e.admin_user_id
  LEFT JOIN admin_users reviewer ON reviewer.id = e.reviewed_by`;

async function listEvents(pool, url, maximum = 100) {
  const filter = eventFilterSql(url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.max(1, Math.min(maximum, Number(url.searchParams.get("pageSize") || 30)));
  const offset = (page - 1) * pageSize;
  const count = await pool.query(`SELECT count(*)::int AS count FROM audit_events e ${filter.where}`, filter.values);
  const values = [...filter.values, pageSize, offset];
  const rows = await pool.query(
    `${EVENT_SELECT} ${filter.where}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  const total = Number(count.rows[0]?.count || 0);
  return { items: rows.rows.map(eventDto), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

function csvCell(value) {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportEvents(pool, url) {
  const filter = eventFilterSql(url, { includePagination: false });
  const rows = await pool.query(`${EVENT_SELECT} ${filter.where} ORDER BY e.created_at DESC, e.id DESC LIMIT 50000`, filter.values);
  const columns = [
    "id", "created_at", "player_name", "player_id", "clan_name", "clan_id", "event_type", "category",
    "severity", "suspicious", "description", "old_value", "new_value", "source", "ip_address", "device",
    "admin_login", "review_status", "admin_note", "reviewer_login", "reviewed_at"
  ];
  return `\ufeff${columns.join(",")}\r\n${rows.rows.map((row) => columns.map((key) => csvCell(row[key])).join(",")).join("\r\n")}`;
}

async function dashboardStats(pool, url) {
  const period = cleanText(url.searchParams.get("period") || "24h", 10);
  const from = dateFromPeriod(period) || dateFromPeriod("24h");
  const [summary, categories, activity, clans, latest] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS events,
              count(DISTINCT player_id)::int AS players,
              count(DISTINCT clan_id)::int AS clans,
              count(*) FILTER (WHERE suspicious)::int AS suspicious,
              count(*) FILTER (WHERE review_status = 'violation')::int AS violations
       FROM audit_events WHERE created_at >= $1`,
      [from]
    ),
    pool.query(
      `SELECT category, count(*)::int AS count
       FROM audit_events WHERE created_at >= $1 GROUP BY category ORDER BY count DESC`,
      [from]
    ),
    pool.query(
      `SELECT date_trunc('hour', created_at) AS bucket, count(*)::int AS count,
              count(*) FILTER (WHERE suspicious)::int AS suspicious
       FROM audit_events WHERE created_at >= $1
       GROUP BY bucket ORDER BY bucket`,
      [from]
    ),
    pool.query(
      `SELECT c.id, c.name, c.tag, c.money, c.level, count(DISTINCT cm.player_id)::int AS members,
              max(e.created_at) AS last_event_at, count(DISTINCT e.id)::int AS events
       FROM clans c
       LEFT JOIN clan_members cm ON cm.clan_id = c.id
       LEFT JOIN audit_events e ON e.clan_id = c.id AND e.created_at >= $1
       WHERE c.deleted_at IS NULL
       GROUP BY c.id ORDER BY events DESC, c.money DESC LIMIT 6`,
      [from]
    ),
    pool.query(`${EVENT_SELECT} ORDER BY e.created_at DESC, e.id DESC LIMIT 8`)
  ]);
  return {
    period,
    summary: summary.rows[0] || {},
    categories: categories.rows,
    activity: activity.rows,
    clans: clans.rows.map((row) => ({ ...row, id: Number(row.id), money: Number(row.money), level: Number(row.level) })),
    latest: latest.rows.map(eventDto),
    serverTime: new Date().toISOString()
  };
}

async function playerDetails(pool, playerId, url) {
  const profile = await pool.query(
    `SELECT p.id, p.name, p.level, p.exp, p.money, p.stats, p.created_at, p.updated_at,
            pa.last_seen_at, pa.last_login_at, pa.last_logout_at, pa.last_ip_address, pa.last_device,
            c.id AS clan_id, c.name AS clan_name, c.tag AS clan_tag
     FROM players p
     LEFT JOIN player_activity pa ON pa.player_id = p.id
     LEFT JOIN clan_members cm ON cm.player_id = p.id
     LEFT JOIN clans c ON c.id = cm.clan_id AND c.deleted_at IS NULL
     WHERE p.id = $1`,
    [playerId]
  );
  if (!profile.rowCount) return null;
  const eventUrl = new URL(url);
  eventUrl.searchParams.set("playerId", String(playerId));
  eventUrl.searchParams.set("pageSize", String(Math.min(100, Number(url.searchParams.get("pageSize") || 50))));
  const [events, totals, purchases] = await Promise.all([
    listEvents(pool, eventUrl, 100),
    pool.query(
      `SELECT count(*)::int AS events,
              count(*) FILTER (WHERE suspicious)::int AS suspicious,
              count(*) FILTER (WHERE review_status = 'violation')::int AS violations
       FROM audit_events WHERE player_id = $1`,
      [playerId]
    ),
    pool.query(`SELECT count(*)::int AS count, COALESCE(sum(price), 0)::bigint AS spent FROM purchase_history WHERE player_id = $1`, [playerId])
  ]);
  return { profile: profile.rows[0], summary: { ...totals.rows[0], purchases: purchases.rows[0] }, events };
}

async function clanDetails(pool, clanId, url) {
  const profile = await pool.query(
    `SELECT c.*, p.name AS owner_name,
            count(cm.player_id)::int AS members
     FROM clans c
     LEFT JOIN players p ON p.id = c.owner_player_id
     LEFT JOIN clan_members cm ON cm.clan_id = c.id
     WHERE c.id = $1
     GROUP BY c.id, p.name`,
    [clanId]
  );
  if (!profile.rowCount) return null;
  const eventUrl = new URL(url);
  eventUrl.searchParams.set("clanId", String(clanId));
  eventUrl.searchParams.set("pageSize", String(Math.min(100, Number(url.searchParams.get("pageSize") || 50))));
  const [events, members, treasury] = await Promise.all([
    listEvents(pool, eventUrl, 100),
    pool.query(
      `SELECT p.id, p.name, p.level, cm.role, cm.member_level, cm.money, cm.clan_exp, cm.joined_at,
              pa.last_seen_at
       FROM clan_members cm JOIN players p ON p.id = cm.player_id
       LEFT JOIN player_activity pa ON pa.player_id = p.id
       WHERE cm.clan_id = $1 ORDER BY cm.member_level DESC, cm.clan_exp DESC`,
      [clanId]
    ),
    pool.query(
      `SELECT count(*)::int AS operations,
              COALESCE(sum(CASE WHEN event_type = 1 THEN money ELSE -money END), 0)::bigint AS net
       FROM clan_treasury_events WHERE clan_id = $1`,
      [clanId]
    )
  ]);
  return { profile: profile.rows[0], members: members.rows, treasury: treasury.rows[0], events };
}

async function manualAction(pool, admin, body, onPlayerChanged) {
  const playerId = numberId(body.playerId);
  if (!playerId) throw new Error("invalid_player_id");
  const action = cleanText(body.action, 40);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const playerResult = await client.query("SELECT id, name, money FROM players WHERE id = $1 FOR UPDATE", [playerId]);
    const player = playerResult.rows[0];
    if (!player) throw new Error("player_not_found");

    let result;
    if (action === "adjust_currency") {
      const amount = Math.trunc(Number(body.amount || 0));
      if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) throw new Error("invalid_amount");
      const before = Number(player.money || 0);
      const after = Math.max(0, before + amount);
      await client.query("UPDATE players SET money = $2, updated_at = now() WHERE id = $1", [playerId, after]);
      await writeAuditEvent(client, {
        playerId,
        eventType: "balance_change",
        category: "economy",
        severity: Math.abs(amount) >= 10000 ? "warning" : "notice",
        description: `${amount > 0 ? "Начисление" : "Списание"} ${Math.abs(amount)} монет администратором`,
        oldValue: { balance: before },
        newValue: { balance: after, delta: amount },
        source: "admin_panel",
        adminUserId: admin.id,
        metadata: { reason: cleanText(body.reason, 500) }
      });
      result = { action, playerId, balance: after };
    } else if (action === "grant_item") {
      const itemKey = cleanText(body.itemKey, 80);
      const item = await client.query("SELECT item_key, item_type, item_id, item_data FROM catalog_items WHERE item_key = $1", [itemKey]);
      if (!item.rowCount) throw new Error("catalog_item_not_found");
      const existing = await client.query("SELECT item_data FROM player_inventory WHERE player_id = $1 AND item_key = $2", [playerId, itemKey]);
      await client.query(
        `INSERT INTO player_inventory (player_id, item_key, item_type, item_data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (player_id, item_key) DO UPDATE SET item_data = EXCLUDED.item_data, updated_at = now()`,
        [playerId, itemKey, Number(item.rows[0].item_type), JSON.stringify(item.rows[0].item_data)]
      );
      await writeAuditEvent(client, {
        playerId,
        eventType: "inventory_change",
        category: "inventory",
        severity: "notice",
        description: `Выдан предмет ${itemKey} администратором`,
        oldValue: existing.rows[0]?.item_data || null,
        newValue: item.rows[0].item_data,
        source: "admin_panel",
        adminUserId: admin.id,
        metadata: { reason: cleanText(body.reason, 500), itemKey }
      });
      result = { action, playerId, itemKey };
    } else if (action === "punishment") {
      const punishmentType = cleanText(body.punishmentType, 20);
      const reason = cleanText(body.reason, 1000);
      if (!['warning', 'mute', 'ban'].includes(punishmentType) || !reason) throw new Error("invalid_punishment");
      const expiresAt = body.expiresAt && !Number.isNaN(Date.parse(body.expiresAt)) ? new Date(body.expiresAt).toISOString() : null;
      const punishment = await client.query(
        `INSERT INTO admin_punishments (player_id, punishment_type, reason, issued_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [playerId, punishmentType, reason, admin.id, expiresAt]
      );
      await writeAuditEvent(client, {
        playerId,
        eventType: "admin_punishment",
        category: "moderation",
        severity: punishmentType === "ban" ? "critical" : "warning",
        description: `Наказание: ${punishmentType}. ${reason}`,
        newValue: { punishmentId: Number(punishment.rows[0].id), punishmentType, expiresAt },
        source: "admin_panel",
        adminUserId: admin.id
      });
      result = { action, playerId, punishmentId: Number(punishment.rows[0].id) };
    } else {
      throw new Error("unknown_action");
    }

    await client.query("COMMIT");
    if (typeof onPlayerChanged === "function") {
      try {
        await onPlayerChanged(playerId);
      } catch (error) {
        console.error(`[admin-logs] player cache refresh failed player=${playerId}`, error);
      }
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createAdminLogsApi({ getPool, readJsonBody, requestIp, onPlayerChanged } = {}) {
  return {
    async initialize() {
      const pool = getPool?.();
      return ensureOwnerAccount(pool);
    },

    async handle(req, res, url) {
      if (!url.pathname.startsWith("/admin/logs")) return false;
      const cors = corsHeaders(req);
      if (!cors.allowed) {
        sendJson(res, { ok: false, error: "origin_not_allowed" }, 403);
        return true;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors.headers);
        res.end();
        return true;
      }

      const pool = getPool?.();
      if (!pool) {
        sendJson(res, { ok: false, error: "postgres_required" }, 503, cors.headers);
        return true;
      }

      try {
        const path = url.pathname.replace(/\/+$/, "") || "/admin/logs";
        if (path === "/admin/logs/auth/login" && req.method === "POST") {
          const key = loginBucketKey(req, requestIp);
          if (loginBlocked(key)) {
            sendJson(res, { ok: false, error: "login_rate_limited" }, 429, cors.headers);
            return true;
          }
          const body = await readJsonBody(req, 16 * 1024);
          const login = cleanText(body.login, 64).toLowerCase();
          const result = await pool.query("SELECT * FROM admin_users WHERE lower(login) = $1 AND active = TRUE LIMIT 1", [login]);
          const admin = result.rows[0];
          if (!admin || !verifyAdminPassword(body.password, admin.password_salt, admin.password_hash)) {
            recordLoginFailure(key);
            sendJson(res, { ok: false, error: "invalid_credentials" }, 401, cors.headers);
            return true;
          }
          loginFailures.delete(key);
          const token = crypto.randomBytes(32).toString("base64url");
          const sessionId = crypto.randomUUID();
          const device = cleanText(req.headers["user-agent"], 300);
          const ipAddress = cleanText(requestIp?.(req) || req.socket?.remoteAddress, 128);
          await pool.query(
            `INSERT INTO admin_sessions (id, admin_user_id, token_hash, ip_address, device, expires_at)
             VALUES ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 hour'))`,
            [sessionId, admin.id, tokenHash(token), ipAddress, device, SESSION_TTL_HOURS]
          );
          await pool.query("UPDATE admin_users SET last_login_at = now(), updated_at = now() WHERE id = $1", [admin.id]);
          await writeAuditEvent(pool, {
            eventType: "admin_login",
            category: "security",
            description: `Вход администратора ${admin.login}`,
            source: "admin_panel",
            ipAddress,
            device,
            adminUserId: admin.id
          });
          sendJson(res, { ok: true, token, expiresInSeconds: SESSION_TTL_HOURS * 3600, admin: publicAdmin(admin) }, 200, cors.headers);
          return true;
        }

        const admin = await authenticate(pool, req);
        if (path === "/admin/logs/auth/me" && req.method === "GET") {
          if (!requirePermission(res, cors.headers, admin, "read")) return true;
          sendJson(res, { ok: true, admin: publicAdmin(admin) }, 200, cors.headers);
          return true;
        }
        if (path === "/admin/logs/auth/logout" && req.method === "POST") {
          if (!admin) {
            sendJson(res, { ok: true }, 200, cors.headers);
            return true;
          }
          await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE id = $1", [admin.session_id]);
          sendJson(res, { ok: true }, 200, cors.headers);
          return true;
        }
        if (!requirePermission(res, cors.headers, admin, "read")) return true;

        if (path === "/admin/logs/meta" && req.method === "GET") {
          const result = await pool.query(
            `SELECT array_agg(DISTINCT event_type ORDER BY event_type) AS event_types,
                    array_agg(DISTINCT category ORDER BY category) AS categories
             FROM audit_events`
          );
          sendJson(res, { ok: true, ...result.rows[0], roles: ADMIN_ROLES, permissions: ROLE_PERMISSIONS }, 200, cors.headers);
          return true;
        }
        if (path === "/admin/logs/stats" && req.method === "GET") {
          sendJson(res, { ok: true, ...(await dashboardStats(pool, url)) }, 200, cors.headers);
          return true;
        }
        if (path === "/admin/logs/events" && req.method === "GET") {
          sendJson(res, { ok: true, ...(await listEvents(pool, url)) }, 200, cors.headers);
          return true;
        }
        if (path === "/admin/logs/export.csv" && req.method === "GET") {
          if (!requirePermission(res, cors.headers, admin, "export")) return true;
          const csv = await exportEvents(pool, url);
          res.writeHead(200, {
            ...cors.headers,
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="contra-city-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
            "cache-control": "no-store",
            "content-length": String(Buffer.byteLength(csv))
          });
          res.end(csv);
          return true;
        }

        const playerMatch = /^\/admin\/logs\/players\/(\d+)$/.exec(path);
        if (playerMatch && req.method === "GET") {
          const details = await playerDetails(pool, Number(playerMatch[1]), url);
          sendJson(res, details ? { ok: true, ...details } : { ok: false, error: "player_not_found" }, details ? 200 : 404, cors.headers);
          return true;
        }
        const clanMatch = /^\/admin\/logs\/clans\/(\d+)$/.exec(path);
        if (clanMatch && req.method === "GET") {
          const details = await clanDetails(pool, Number(clanMatch[1]), url);
          sendJson(res, details ? { ok: true, ...details } : { ok: false, error: "clan_not_found" }, details ? 200 : 404, cors.headers);
          return true;
        }
        const reviewMatch = /^\/admin\/logs\/events\/(\d+)$/.exec(path);
        if (reviewMatch && req.method === "PATCH") {
          if (!requirePermission(res, cors.headers, admin, "review")) return true;
          const body = await readJsonBody(req, 16 * 1024);
          const status = cleanText(body.reviewStatus, 20);
          if (!["unchecked", "checked", "suspicious", "violation"].includes(status)) {
            sendJson(res, { ok: false, error: "invalid_review_status" }, 400, cors.headers);
            return true;
          }
          const result = await pool.query(
            `UPDATE audit_events
             SET review_status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = now(),
                 suspicious = suspicious OR $2 IN ('suspicious', 'violation')
             WHERE id = $1 RETURNING *`,
            [Number(reviewMatch[1]), status, cleanText(body.adminNote, 2000), admin.id]
          );
          sendJson(res, result.rowCount ? { ok: true, event: eventDto(result.rows[0]) } : { ok: false, error: "event_not_found" }, result.rowCount ? 200 : 404, cors.headers);
          return true;
        }

        if (path === "/admin/logs/admins" && req.method === "GET") {
          if (!requirePermission(res, cors.headers, admin, "manage_admins")) return true;
          const result = await pool.query("SELECT * FROM admin_users ORDER BY active DESC, id");
          sendJson(res, { ok: true, items: result.rows.map(publicAdmin) }, 200, cors.headers);
          return true;
        }
        if (path === "/admin/logs/admins" && req.method === "POST") {
          if (!requirePermission(res, cors.headers, admin, "manage_admins")) return true;
          const body = await readJsonBody(req, 16 * 1024);
          const login = cleanText(body.login, 64).toLowerCase();
          const role = cleanText(body.role, 20);
          if (!login || !ADMIN_ROLES.includes(role) || role === "owner") throw new Error("invalid_admin_account");
          const password = hashAdminPassword(body.password);
          const result = await pool.query(
            `INSERT INTO admin_users (login, display_name, password_salt, password_hash, role, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [login, cleanText(body.displayName || login, 80), password.salt, password.hash, role, admin.id]
          );
          await writeAuditEvent(pool, {
            eventType: "admin_permissions_change",
            category: "security",
            severity: "warning",
            description: `Создан администратор ${login} с ролью ${role}`,
            source: "admin_panel",
            adminUserId: admin.id,
            newValue: { adminId: Number(result.rows[0].id), login, role }
          });
          sendJson(res, { ok: true, admin: publicAdmin(result.rows[0]) }, 201, cors.headers);
          return true;
        }
        const adminMatch = /^\/admin\/logs\/admins\/(\d+)$/.exec(path);
        if (adminMatch && req.method === "PATCH") {
          if (!requirePermission(res, cors.headers, admin, "manage_admins")) return true;
          const targetId = Number(adminMatch[1]);
          const targetResult = await pool.query("SELECT * FROM admin_users WHERE id = $1", [targetId]);
          const target = targetResult.rows[0];
          if (!target || target.role === "owner") throw new Error("protected_admin_account");
          const body = await readJsonBody(req, 16 * 1024);
          const role = body.role == null ? target.role : cleanText(body.role, 20);
          if (!ADMIN_ROLES.includes(role) || role === "owner") throw new Error("invalid_admin_role");
          let salt = target.password_salt;
          let hash = target.password_hash;
          if (body.password) ({ salt, hash } = hashAdminPassword(body.password));
          const updated = await pool.query(
            `UPDATE admin_users SET display_name = $2, role = $3, active = $4,
             password_salt = $5, password_hash = $6, updated_at = now()
             WHERE id = $1 RETURNING *`,
            [targetId, cleanText(body.displayName ?? target.display_name, 80), role, body.active == null ? target.active : Boolean(body.active), salt, hash]
          );
          if (!updated.rows[0].active) await pool.query("UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = $1 AND revoked_at IS NULL", [targetId]);
          await writeAuditEvent(pool, {
            eventType: "admin_permissions_change",
            category: "security",
            severity: "warning",
            description: `Изменены права администратора ${target.login}`,
            source: "admin_panel",
            adminUserId: admin.id,
            oldValue: { role: target.role, active: target.active },
            newValue: { role: updated.rows[0].role, active: updated.rows[0].active }
          });
          sendJson(res, { ok: true, admin: publicAdmin(updated.rows[0]) }, 200, cors.headers);
          return true;
        }

        if (path === "/admin/logs/actions" && req.method === "POST") {
          if (!requirePermission(res, cors.headers, admin, "manual_action")) return true;
          const body = await readJsonBody(req, 32 * 1024);
          sendJson(res, { ok: true, result: await manualAction(pool, admin, body, onPlayerChanged) }, 200, cors.headers);
          return true;
        }

        sendJson(res, { ok: false, error: "not_found" }, 404, cors.headers);
        return true;
      } catch (error) {
        const known = new Set([
          "admin_password_length", "invalid_admin_account", "protected_admin_account", "invalid_admin_role",
          "invalid_player_id", "player_not_found", "invalid_amount", "catalog_item_not_found", "invalid_punishment", "unknown_action"
        ]);
        const message = error?.message || "admin_logs_failed";
        const status = known.has(message) ? 400 : message.includes("unique") ? 409 : 500;
        if (status === 500) console.error("[admin-logs] request failed", error);
        sendJson(res, { ok: false, error: status === 500 ? "admin_logs_failed" : message }, status, cors.headers);
        return true;
      }
    }
  };
}
