const DAY_MS = 86400000;
const MOSCOW_OFFSET_MS = 3 * 3600000;

// Fixed calendar days in Europe/Moscow, independent of the API host timezone.
export function playerActivityWindow(period, now = new Date()) {
  const days = period === "1d" ? 1 : period === "30d" ? 30 : 7;
  const localDay = new Date(now.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
  const today = Date.parse(`${localDay}T00:00:00Z`) - MOSCOW_OFFSET_MS;
  return {
    period: `${days}d`, days, timeZone: "Europe/Moscow",
    from: new Date(today - (days - 1) * DAY_MS).toISOString(),
    to: now.toISOString()
  };
}

export function summarizePlayerActivity(rows, window) {
  const daily = Array.from({ length: window.days }, (_, index) => ({
    date: new Date(Date.parse(window.from) + index * DAY_MS + MOSCOW_OFFSET_MS).toISOString().slice(0, 10),
    minutes: 0, records: 0
  }));
  const days = new Map(daily.map(day => [day.date, day]));
  const maps = new Map();
  const modes = new Map();
  const add = (target, key, minutes, records) => {
    const entry = target.get(key) || { name: key, minutes: 0, records: 0 };
    entry.minutes += minutes;
    entry.records += records;
    target.set(key, entry);
  };
  for (const row of rows) {
    const day = days.get(row.day);
    if (!day) continue;
    const minutes = Math.max(0, Number(row.minutes) || 0);
    const records = Math.max(0, Number(row.records) || 0);
    day.minutes += minutes;
    day.records += records;
    add(maps, String(row.map_name || "Неизвестная карта"), minutes, records);
    add(modes, String(row.mode), minutes, records);
  }
  const ranked = entries => [...entries.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return {
    ...window,
    minutes: daily.reduce((sum, day) => sum + day.minutes, 0),
    records: daily.reduce((sum, day) => sum + day.records, 0),
    activeDays: daily.filter(day => day.minutes > 0).length,
    daily, maps: ranked(maps), modes: ranked(modes)
  };
}

export async function loadPlayerActivity(pool, playerId, window) {
  const result = await pool.query(
    `SELECT to_char(created_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day,
            map_name, mode, COALESCE(sum(GREATEST(play_time, 0)), 0)::bigint AS minutes,
            count(*)::int AS records
     FROM player_match_stats
     WHERE player_id = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
     GROUP BY 1, map_name, mode`,
    [playerId, window.from, window.to]
  );
  return summarizePlayerActivity(result.rows, window);
}
