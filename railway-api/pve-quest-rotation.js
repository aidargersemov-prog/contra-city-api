import crypto from 'node:crypto';

// This module selects quests only. Gameplay events, progress and payouts are
// deliberately outside this API until the battle service supplies them.
const define = (id, title, description, target, reward, metric) => Object.freeze({
  id, title, description, target, reward, metric,
});

export const DAILY_QUESTS = Object.freeze([
  define('first_blood', 'Первая кровь', 'Уничтожить 50 противников', 50, 150, 'kills'),
  define('cleanup', 'Зачистка', 'Уничтожить 150 противников', 150, 300, 'kills'),
  define('exterminator', 'Истребитель', 'Уничтожить 300 противников', 300, 450, 'kills'),
  define('first_ten', 'Первая десятка', 'Достигнуть 3-й волны', 3, 540, 'highest_wave'),
  define('at_the_limit', 'На пределе', 'Достигнуть 6-й волны', 6, 850, 'highest_wave'),
  define('survivor', 'Выживший', 'Пройти суммарно 15 волн', 15, 1200, 'waves_total'),
  define('return', 'Возвращение', 'Успешно эвакуироваться 1 раз', 1, 200, 'evacuations'),
  define('experienced_fighter', 'Опытный боец', 'Успешно эвакуироваться 3 раза', 3, 400, 'evacuations'),
  define('collector', 'Сборщик', 'Собрать 50 единиц полимеров', 50, 250, 'polymers'),
  define('supplier', 'Снабженец', 'Собрать 100 единиц ткани', 100, 400, 'fabric'),
  define('metalworker', 'Металлист', 'Добыть 30 единиц металлолома', 30, 250, 'scrap_metal'),
  define('recycler', 'Переработчик', 'Переработать 50 единиц сырья', 50, 300, 'recycled_raw'),
  define('full_backpack', 'Полный рюкзак', 'Эвакуировать 50 ресурсов за одну вылазку', 50, 400, 'evacuated_resources_single'),
  define('comrades', 'Боевые товарищи', 'Успешно завершить вылазку с союзником', 1, 300, 'allied_runs'),
  define('no_losses', 'Без потерь', 'Пройти 5 волн без смерти', 5, 350, 'deathless_waves'),
]);

export const WEEKLY_QUESTS = Object.freeze([
  define('mass_cleanup', 'Массовая зачистка', 'Уничтожить 10 000 противников', 10000, 2000, 'kills'),
  define('extermination', 'Истребление', 'Уничтожить 25 500 противников', 25500, 6000, 'kills'),
  define('promzona_veteran', 'Ветеран Промзоны', 'Достигнуть 20-й волны', 20, 25000, 'highest_wave'),
  define('last_frontier', 'Последний рубеж', 'Достигнуть 30-й волны', 30, 50000, 'highest_wave'),
  define('indestructible', 'Несокрушимый', 'Пройти 15 волн без смерти', 15, 15000, 'deathless_waves'),
  define('survival_marathon', 'Марафон выживания', 'Пройти суммарно 150 волн', 150, 5500, 'waves_total'),
  define('experienced_survivor', 'Опытный выживший', 'Успешно эвакуироваться 10 раз', 10, 2500, 'evacuations'),
  define('risk_paid_off', 'Риск оправдан', 'Эвакуироваться после 15-й волны 3 раза', 3, 9500, 'evacuations_after_15'),
  define('large_delivery', 'Крупная поставка', 'Эвакуировать суммарно 500 ресурсов', 500, 9999, 'evacuated_resources_total'),
  define('supply', 'Снабжение', 'Собрать 750 единиц сырья', 750, 12000, 'raw_collected'),
  define('industrialist', 'Промышленник', 'Переработать 300 единиц сырья', 300, 25000, 'recycled_raw'),
  define('recycling_master', 'Мастер переработки', 'Получить 30 материалов редкого качества', 30, 350000, 'rare_materials'),
  define('teamwork', 'Командная работа', 'Успешно завершить 5 вылазок с союзниками', 5, 3000, 'allied_runs'),
  define('salvager', 'Добытчик', 'Собрать 100 единиц электронного лома', 100, 3000, 'electronic_scrap'),
]);

export const CLAN_QUESTS = Object.freeze([
  define('clan_operation', 'Клановая операция', 'Завершить 10 совместных вылазок', 10, 5000, 'clan_runs'),
  define('brothers_in_arms', 'Братство оружия', 'Уничтожить 2 500 противников', 2500, 6000, 'kills'),
  define('total_cleanup', 'Полная зачистка', 'Уничтожить 5 000 противников', 5000, 10000, 'kills'),
  define('iron_discipline', 'Железная дисциплина', 'Достигнуть 15-й волны 5 раз', 5, 7000, 'wave_15_runs'),
  define('last_bastion', 'Последний бастион', 'Достигнуть 25-й волны 3 раза', 3, 10000, 'wave_25_runs'),
  define('joint_supply', 'Совместное снабжение', 'Собрать 1 000 единиц сырья', 1000, 5000, 'raw_collected'),
  define('industrial_scale', 'Промышленный масштаб', 'Собрать 2 500 единиц сырья', 2500, 9000, 'raw_collected'),
  define('clan_evacuation', 'Клановая эвакуация', 'Совершить 20 успешных эвакуаций', 20, 7000, 'evacuations'),
  define('indestructible_squad', 'Несокрушимый отряд', 'Пройти 10 волн без смерти участников отряда', 10, 8000, 'squad_deathless_waves'),
  define('promzona_veterans', 'Ветераны Промзоны', 'Пройти суммарно 300 волн', 300, 10000, 'waves_total'),
  define('common_victory', 'Общая победа', 'Эвакуироваться после 20-й волны 5 раз', 5, 10000, 'evacuations_after_20'),
  define('combat_brotherhood', 'Боевое братство', 'Провести суммарно 10 часов в клановых вылазках', 600, 6000, 'clan_run_minutes'),
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const dateKey = day => new Date(day * DAY_MS).toISOString().slice(0, 10);
const rank = (scope, owner, period, id) => crypto.createHash('sha256')
  .update(`pve-quest:v1:${scope}:${owner}:${period}:${id}`).digest('hex');

function ordered(pool, scope, owner, period) {
  return [...pool].sort((a, b) => rank(scope, owner, period, a.id).localeCompare(rank(scope, owner, period, b.id)));
}

export function questWindows(now = new Date()) {
  const localDay = Math.floor((now.getTime() + MOSCOW_OFFSET_MS) / DAY_MS);
  const dayOfWeek = new Date(localDay * DAY_MS).getUTCDay();
  const monday = localDay - ((dayOfWeek + 6) % 7);
  return {
    daily: { key: dateKey(localDay), resetAt: new Date((localDay + 1) * DAY_MS - MOSCOW_OFFSET_MS).toISOString(), day: localDay },
    weekly: { key: dateKey(monday), resetAt: new Date((monday + 7) * DAY_MS - MOSCOW_OFFSET_MS).toISOString() },
  };
}

export function questRotation(playerId, clanId = 0, now = new Date()) {
  const windows = questWindows(now);
  const player = String(playerId);
  // Stable, disjoint halves make back-to-back daily repeats impossible even
  // when the player does not log in on the previous day.
  const split = ordered(DAILY_QUESTS, 'daily-partition', player, 'all');
  const half = Math.ceil(split.length / 2);
  const dailyPool = windows.daily.day % 2 ? split.slice(0, half) : split.slice(half);
  const daily = ordered(dailyPool, 'daily', player, windows.daily.key).slice(0, 3);
  const weekly = ordered(WEEKLY_QUESTS, 'weekly', player, windows.weekly.key).slice(0, 3);
  const clan = Number(clanId) > 0
    ? ordered(CLAN_QUESTS, 'clan', String(clanId), windows.weekly.key).slice(0, 1) : [];
  return {
    serverNow: now.toISOString(),
    progressEnabled: false,
    daily: { cycleKey: windows.daily.key, resetAt: windows.daily.resetAt, entries: daily },
    weekly: { cycleKey: windows.weekly.key, resetAt: windows.weekly.resetAt, entries: weekly },
    clan: { cycleKey: windows.weekly.key, resetAt: windows.weekly.resetAt, entries: clan },
  };
}
