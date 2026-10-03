import { isIP } from 'node:net';

export function auditClientAddress(address) {
  const ip=String(address || '').replace(/^::ffff:/i,'');
  const parts=ip.split('.').map(Number);
  if (ip==='::1' || /^(fc|fd|fe80):/i.test(ip) || (parts.length===4 &&
    (parts[0]===10 || parts[0]===127 || (parts[0]===192 && parts[1]===168) ||
     (parts[0]===172 && parts[1]>=16 && parts[1]<=31) || (parts[0]===100 && parts[1]>=64 && parts[1]<=127)))) return '';
  return isIP(ip) ? ip : '';
}

// Used only for audit display. Authentication, IP bans and rate limits keep
// their existing stricter requestClientIp contract.
export function auditNetworkInfo(req, railway = Boolean(process.env.RAILWAY_ENVIRONMENT_ID), relays = []) {
  const peer=String(req.socket?.remoteAddress || '').replace(/^::ffff:/i,'');
  const railwayPeer=/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(peer);
  if (railway && railwayPeer) {
    // Railway's edge supplies X-Real-IP. Only the configured game relay may
    // supply a forwarded client chain; never trust an arbitrary XFF prefix.
    const edge=auditClientAddress(req.headers['x-real-ip']);
    if (edge && relays.includes(edge)) {
      const chain=String(req.headers['x-forwarded-for'] || '').split(',').map(v=>v.trim().replace(/^::ffff:/i,''));
      for (let i=chain.length-1;i>=0;i--) {
        if (relays.includes(chain[i]) || !auditClientAddress(chain[i])) continue;
        return {ip:auditClientAddress(chain[i]),source:'trusted_game_relay'};
      }
      return {ip:'',source:'relay_without_client_ip'};
    }
    if (edge) return {ip:edge,source:'railway_edge'};
  }
  return {ip:auditClientAddress(peer),source:'socket'};
}

export function deviceLabel(userAgent) {
  const ua=String(userAgent || '');
  if (!ua || /^(node|undici)$/i.test(ua)) return 'Нет данных клиента';
  const os=/Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac OS|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const unity=/UnityPlayer\/([^\s]+)/i.exec(ua);
  const app=unity ? `Игровой клиент · Unity ${unity[1]}` : /launcher/i.test(ua) ? 'Лаунчер Contra City' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua.slice(0,100);
  return [os,app].filter(Boolean).join(' · ');
}

// The visit key contains no IP: Railway proxy addresses rotate between requests.
// Persisted, atomic deduplication also works across API restarts/replicas.
export async function claimGameVisit(db, playerId, deviceKey, idleMs, now = new Date()) {
  const result = await db.query(
    `INSERT INTO game_audit_visits (player_id, device_key, last_seen_at, emit_login)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (player_id, device_key) DO UPDATE SET
       emit_login = game_audit_visits.last_seen_at < $3::timestamptz - ($4::double precision * interval '1 millisecond'),
       last_seen_at = GREATEST(game_audit_visits.last_seen_at, EXCLUDED.last_seen_at)
     RETURNING emit_login`, [playerId, deviceKey, now.toISOString(), idleMs]
  );
  return result.rows[0]?.emit_login === true;
}
