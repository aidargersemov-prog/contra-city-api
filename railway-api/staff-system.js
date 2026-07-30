import { writeAuditEvent } from "./admin-logs/audit-store.js";

export const STAFF_ROLE_RANK = Object.freeze({
  none: 0,
  helper: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
  developer: 4,
});

const STAFF_ROLE_META = Object.freeze({
  none: Object.freeze({ prefix: "", color: "", panelEnabled: false }),
  helper: Object.freeze({ prefix: "[HELPER]", color: "#3BA7FF", panelEnabled: false }),
  moderator: Object.freeze({ prefix: "[MODER]", color: "#2ECC71", panelEnabled: true }),
  admin: Object.freeze({ prefix: "[ADMIN]", color: "#F5A623", panelEnabled: true }),
  owner: Object.freeze({ prefix: "[OWNER]", color: "#E53935", panelEnabled: true }),
  developer: Object.freeze({ prefix: "[DEVELOPER]", color: "#8E44FF", panelEnabled: true }),
});

const MAX_BAN_MINUTES = 5_256_000;
const MAX_REASON_LENGTH = 300;
const MAX_STAFF_CHAT_LENGTH = 500;

export function normalizeStaffRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "moder") return "moderator";
  if (role === "administrator") return "admin";
  if (role === "dev") return "developer";
  return Object.hasOwn(STAFF_ROLE_RANK, role) ? role : "none";
}

export function staffRoleRank(value) {
  return Number(STAFF_ROLE_RANK[normalizeStaffRole(value)] || 0);
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeRichText(value, maxLength) {
  return cleanText(value, maxLength)
    .replace(/</g, "＜")
    .replace(/>/g, "＞");
}

function positivePlayerId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export function staffProfilePayload(roleValue, displayName = "") {
  const role = normalizeStaffRole(roleValue);
  const rank = staffRoleRank(role);
  const meta = STAFF_ROLE_META[role];
  const plainName = safeRichText(displayName, 80);
  const battleName = role === "none" || !plainName
    ? plainName
    : `<color=${meta.color}>${meta.prefix}</color> <color=${meta.color}>${plainName}</color>`;
  return {
    role,
    rank,
    prefix: meta.prefix,
    color: meta.color,
    displayName: plainName,
    battleName,
    panelEnabled: meta.panelEnabled,
    canKick: rank >= STAFF_ROLE_RANK.helper,
    canCreatePrivateRooms: rank >= STAFF_ROLE_RANK.moderator,
    canBan: rank >= STAFF_ROLE_RANK.admin,
    canSpectate: rank >= STAFF_ROLE_RANK.moderator,
  };
}

export function legacyPermissionPayload(roleValue) {
  const rank = staffRoleRank(roleValue);
  return {
    a: 0,
    p: rank >= STAFF_ROLE_RANK.moderator ? 1 : 0,
    k: rank >= STAFF_ROLE_RANK.helper ? 1 : 0,
    g: rank >= STAFF_ROLE_RANK.moderator ? 1 : 0,
  };
}

export async function loadActiveStaffRole(db, playerId, executor = db) {
  const id = positivePlayerId(playerId);
  if (!executor?.query || !id) return "none";
  const result = await executor.query(
    `SELECT role
     FROM player_staff_roles
     WHERE player_id = $1
       AND active = true
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [id]
  );
  return normalizeStaffRole(result.rows[0]?.role);
}

function staffFailure(error, status = 403) {
  return { result: false, ok: false, status, error };
}

async function requirePanelStaff(db, account) {
  const role = await loadActiveStaffRole(db, account?.id);
  const profile = staffProfilePayload(role, account?.name);
  return profile.panelEnabled ? profile : null;
}

function staffChatRow(row) {
  return {
    id: Number(row.id),
    playerId: Number(row.player_id),
    displayName: String(row.player_name || ""),
    role: normalizeStaffRole(row.role),
    message: String(row.message || ""),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
  };
}

function staffActionRow(row) {
  return {
    id: Number(row.id),
    actorPlayerId: Number(row.actor_player_id),
    actorName: String(row.actor_name || ""),
    actorRole: normalizeStaffRole(row.actor_role),
    targetPlayerId: Number(row.target_player_id),
    targetName: String(row.target_name || ""),
    targetRole: normalizeStaffRole(row.target_role),
    action: String(row.action || ""),
    reason: String(row.reason || ""),
    durationMinutes: Number(row.duration_minutes || 0),
    source: String(row.source || ""),
    roomName: String(row.room_name || ""),
    mapName: String(row.map_name || ""),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
  };
}

export async function staffAjaxPayload(db, account, act, searchParams) {
  if (!db?.query) return staffFailure("postgres_required", 503);
  const normalizedAct = String(act || "").trim().toLowerCase();
  const role = await loadActiveStaffRole(db, account?.id);
  const profile = staffProfilePayload(role, account?.name);

  if (normalizedAct === "me") {
    return { result: true, ok: true, staff: profile };
  }

  if (!profile.panelEnabled) return staffFailure("staff_role_required");

  if (normalizedAct === "chat_list" || normalizedAct === "list") {
    const requestedAfter = Number(searchParams.get("after_id") || searchParams.get("after") || 0);
    const afterId = Number.isSafeInteger(requestedAfter) && requestedAfter > 0 ? requestedAfter : 0;
    const result = afterId > 0
      ? await db.query(
        `SELECT id, player_id, player_name, role, message, created_at
         FROM player_staff_chat_messages
         WHERE id > $1
         ORDER BY id ASC
         LIMIT 100`,
        [afterId]
      )
      : await db.query(
        `SELECT *
         FROM (
           SELECT id, player_id, player_name, role, message, created_at
           FROM player_staff_chat_messages
           ORDER BY id DESC
           LIMIT 100
         ) recent
         ORDER BY id ASC`
      );
    return { result: true, ok: true, messages: result.rows.map(staffChatRow) };
  }

  if (normalizedAct === "chat_send" || normalizedAct === "send") {
    const message = safeRichText(
      searchParams.get("message") || searchParams.get("text"),
      MAX_STAFF_CHAT_LENGTH
    );
    if (!message) return staffFailure("message_required", 400);
    const inserted = await db.query(
      `INSERT INTO player_staff_chat_messages (player_id, player_name, role, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, player_id, player_name, role, message, created_at`,
      [Number(account.id), cleanText(account.name, 80), profile.role, message]
    );
    return { result: true, ok: true, messages: inserted.rows.map(staffChatRow) };
  }

  if (normalizedAct === "action_list" || normalizedAct === "logs") {
    const result = await db.query(
      `SELECT
         action_log.*,
         actor.name AS actor_name,
         target.name AS target_name
       FROM player_staff_actions action_log
       JOIN players actor ON actor.id = action_log.actor_player_id
       JOIN players target ON target.id = action_log.target_player_id
       WHERE action_log.action IN ('kick', 'ban')
       ORDER BY action_log.id DESC
       LIMIT 100`
    );
    return { result: true, ok: true, actions: result.rows.map(staffActionRow) };
  }

  return staffFailure("unknown_staff_action", 404);
}

function battleActionContract(body) {
  const action = String(body?.action || "").trim().toLowerCase();
  const source = String(body?.source || "").trim().toLowerCase();
  if (action === "kick" && source === "event70") {
    return { action, source, minimumRole: "helper" };
  }
  if (action === "kick" && source === "panel") {
    return { action, source, minimumRole: "moderator" };
  }
  if (action === "ban" && source === "panel") {
    return { action, source, minimumRole: "admin" };
  }
  return null;
}

export async function executeBattleStaffAction(db, body) {
  if (!db?.connect) return staffFailure("postgres_required", 503);
  const contract = battleActionContract(body);
  if (!contract) return staffFailure("invalid_staff_action", 400);
  const authorizeOnly = body?.authorizeOnly === true;
  if (authorizeOnly && (contract.action !== "kick" || contract.source !== "event70")) {
    return staffFailure("invalid_staff_authorization", 400);
  }

  const actorPlayerId = positivePlayerId(body?.actorPlayerId);
  const targetPlayerId = positivePlayerId(body?.targetPlayerId);
  const reason = cleanText(body?.reason, MAX_REASON_LENGTH);
  const durationMinutes = Number(body?.durationMinutes || 0);
  const roomName = cleanText(body?.roomName, 120);
  const mapName = cleanText(body?.mapName, 120);
  if (!actorPlayerId || !targetPlayerId || actorPlayerId === targetPlayerId) {
    return staffFailure("invalid_staff_target", 400);
  }
  if (!reason) return staffFailure("reason_required", 400);
  if (
    contract.action === "ban" &&
    (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > MAX_BAN_MINUTES)
  ) {
    return staffFailure("invalid_ban_duration", 400);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const players = await client.query(
      `SELECT
         p.id,
         p.name,
         COALESCE(
           CASE
             WHEN sr.active = true AND (sr.expires_at IS NULL OR sr.expires_at > now())
             THEN sr.role
             ELSE 'none'
           END,
           'none'
         ) AS role
       FROM players p
       LEFT JOIN player_staff_roles sr ON sr.player_id = p.id
       WHERE p.id = ANY($1::int[])
       ORDER BY p.id
       FOR SHARE OF p`,
      [[actorPlayerId, targetPlayerId]]
    );
    const actor = players.rows.find((row) => Number(row.id) === actorPlayerId);
    const target = players.rows.find((row) => Number(row.id) === targetPlayerId);
    if (!actor || !target) {
      await client.query("ROLLBACK");
      return staffFailure("player_not_found", 404);
    }

    const actorRole = normalizeStaffRole(actor.role);
    const targetRole = normalizeStaffRole(target.role);
    if (staffRoleRank(actorRole) < staffRoleRank(contract.minimumRole)) {
      await client.query("ROLLBACK");
      return staffFailure("staff_role_required");
    }
    if (staffRoleRank(actorRole) <= staffRoleRank(targetRole)) {
      await client.query("ROLLBACK");
      return staffFailure("staff_target_protected");
    }
    if (authorizeOnly) {
      await client.query("ROLLBACK");
      return {
        result: true,
        ok: true,
        action: contract.action,
        authorizedOnly: true,
        actor: { playerId: actorPlayerId, role: actorRole },
        target: { playerId: targetPlayerId, role: targetRole },
      };
    }

    if (contract.action === "ban") {
      await client.query(
        `INSERT INTO admin_punishments (
           player_id, punishment_type, reason, issued_by, issued_by_player_id, expires_at
         )
         VALUES (
           $1, 'ban', $2, NULL, $3,
           CASE WHEN $4::int = 0 THEN NULL ELSE now() + ($4::int * interval '1 minute') END
         )`,
        [targetPlayerId, reason, actorPlayerId, durationMinutes]
      );
    }

    await client.query(
      `INSERT INTO player_staff_actions (
         actor_player_id, actor_role, target_player_id, target_role,
         action, reason, duration_minutes, source, room_name, map_name
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        actorPlayerId,
        actorRole,
        targetPlayerId,
        targetRole,
        contract.action,
        reason,
        contract.action === "ban" ? durationMinutes : 0,
        contract.source,
        roomName,
        mapName,
      ]
    );
    await writeAuditEvent(client, {
      playerId: targetPlayerId,
      playerName: target.name,
      eventType: contract.action === "ban" ? "staff_ban" : "staff_kick",
      category: "moderation",
      severity: contract.action === "ban" ? "critical" : "warning",
      description: `${contract.action === "ban" ? "Бан" : "Кик"} от ${actor.name}`,
      source: "battle_staff",
      metadata: {
        actorPlayerId,
        actorName: String(actor.name || ""),
        actorRole,
        targetRole,
        reason,
        durationMinutes: contract.action === "ban" ? durationMinutes : 0,
        permanent: contract.action === "ban" && durationMinutes === 0,
        roomName,
        mapName,
        commandSource: contract.source,
      },
    });
    await client.query("COMMIT");
    return {
      result: true,
      ok: true,
      action: contract.action,
      actor: { playerId: actorPlayerId, role: actorRole },
      target: { playerId: targetPlayerId, role: targetRole },
      invalidateBanPlayerId: contract.action === "ban" ? targetPlayerId : 0,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    console.error("[staff] battle action failed", error);
    return staffFailure("staff_action_failed", 503);
  } finally {
    client.release();
  }
}
