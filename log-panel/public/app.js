const CONFIG = window.__LOG_PANEL_CONFIG__ || {};
const API_BASE = String(CONFIG.apiBaseUrl || "https://contra-city-api-production-fedf.up.railway.app").replace(/\/+$/, "");
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ROLE_LABELS = {
  owner: "Владелец",
  head_admin: "Главный администратор",
  admin: "Администратор",
  moderator: "Модератор",
  viewer: "Только просмотр"
};
const CATEGORY_LABELS = {
  chat: "Чат", session: "Сессии", economy: "Экономика", weapons: "Оружие", workshop: "Мастерская",
  clothes: "Одежда", taunts: "Насмешки", enhancers: "Усилители", abilities: "Способности",
  inventory: "Инвентарь", progress: "Прогресс", clan: "Кланы", battle: "Бой",
  profile: "Профиль", security: "Безопасность", moderation: "Модерация", system: "Система"
};
const TYPE_LABELS = {
  battle_chat: "Чат", player_report: "Жалоба на игрока",
  security_udp_quarantine: "UDP-карантин", security_pending_global_cap: "Лимит подключений", security_full_session_cap: "Лимит сессий", admin_login_bruteforce: "Подбор пароля администратора",
  player_login: "Вход", player_logout: "Выход", purchase: "Покупка", weapon_upgrade: "Улучшение оружия",
  daily_quest_progress: "Прогресс задания", daily_quest_claim: "Ежедневное задание", achievement_complete: "Достижение",
  clan_create: "Создание клана", clan_delete: "Удаление клана", clan_rename: "Переименование клана",
  clan_join_request: "Заявка в клан", clan_join: "Вступление в клан", clan_leave: "Выход из клана",
  clan_member_remove: "Исключение из клана", clan_treasury_deposit: "Казна клана", clan_purchase: "Покупка клана",
  experience_change: "Изменение опыта", level_change: "Новый уровень", statistics_change: "Статистика",
  battle_kill: "Убийство", battle_death: "Смерть", balance_change: "Изменение баланса",
  inventory_change: "Изменение инвентаря", admin_punishment: "Наказание", admin_login: "Вход администратора",
  admin_permissions_change: "Права администратора", admin_device_reset: "Сброс устройства",
  player_state_change: "Изменение игрока", clan_state_change: "Изменение клана",
  clan_treasury_spend: "Расходы клана", clan_owner_change: "Новый владелец клана",
  clan_tag_change: "Новый тег клана", clan_access_change: "Настройки клана"
};
const CATEGORY_ICONS = {
  session: "↳", economy: "◈", weapons: "⌁", workshop: "⌁", clothes: "◇", taunts: "☺",
  enhancers: "+", abilities: "✦", inventory: "□", progress: "◎", clan: "♜", battle: "×",
  profile: "●", security: "△", moderation: "!", system: "·"
};

const state = {
  token: sessionStorage.getItem("cc_log_token") || "",
  admin: null,
  currentView: "dashboard",
  meta: { categories: [], event_types: [] },
  stats: null,
  events: [],
  total: 0,
  pages: 1,
  page: 1,
  pageSize: 30,
  filters: {},
  search: "",
  latestEventId: 0,
  eventRequestId: 0,
  eventCache: new Map()
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toast-root").append(node);
  setTimeout(() => node.remove(), 3500);
}

async function api(path, options = {}) {
  const url = new URL(`${API_BASE}${path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== "" && value !== null && value !== undefined && value !== false) url.searchParams.set(key, String(value));
    }
  }
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) };
  let response;
  try {
    response = await fetch(url, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  } catch {
    throw new Error("Не удалось подключиться к серверу");
  }
  const data = await response.json().catch(() => ({ ok: false, error: "invalid_response" }));
  if (response.status === 401 && !path.endsWith("/auth/login")) {
    signOut(false);
    throw new Error("Сессия истекла. Войдите снова.");
  }
  if (!response.ok || data.ok === false) throw new Error(errorLabel(data.error));
  return data;
}

function errorLabel(code) {
  const labels = {
    invalid_credentials: "Неверный логин или пароль",
    login_rate_limited: "Слишком много попыток. Подождите 15 минут",
    origin_not_allowed: "Сайт не подключён к серверу",
    postgres_required: "Логи временно недоступны",
    forbidden: "Недостаточно прав",
    admin_password_length: "Пароль должен содержать минимум 12 символов",
    admin_logs_failed: "Не удалось загрузить логи"
  };
  return labels[code] || code || "Неизвестная ошибка";
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function formatDate(value, compact = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", compact
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }
  ).format(date);
}

function relativeTime(value) {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60000) return "сейчас";
  if (delta < 3600000) return `${Math.floor(delta / 60000)} мин`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} ч`;
  return formatDate(value, true);
}

function eventValue(event) {
  const oldBalance = Number(event.oldValue?.balance);
  const newBalance = Number(event.newValue?.balance);
  if (Number.isFinite(oldBalance) && Number.isFinite(newBalance)) {
    const delta = newBalance - oldBalance;
    if (delta === 0) return "";
    return `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
  }
  const price = event.metadata?.price;
  if (price != null) return `−${formatNumber(price)}`;
  if (event.newValue?.rewardCoins) return `+${formatNumber(event.newValue.rewardCoins)}`;
  if (event.newValue?.delta) return `${Number(event.newValue.delta) > 0 ? "+" : ""}${formatNumber(event.newValue.delta)}`;
  return event.severity === "critical" ? "КРИТИЧНО" : event.suspicious ? "РИСК" : "";
}

function eventDescription(event) {
  const changedFields = Array.isArray(event.metadata?.changedFields) ? event.metadata.changedFields : [];
  if (event.eventType === "player_login" || event.eventType === "player_logout") {
    const place = [event.geo?.city, event.geo?.region, event.geo?.country || event.geo?.countryCode].filter(Boolean).join(", ");
    const access = [place, event.ipAddress].filter(Boolean).join(" · ");
    return access ? `${event.description} · ${access}` : event.description;
  }
  if (event.eventType === "player_state_change") {
    const labels = {
      balance: "баланс", experience: "опыт", level: "уровень", statistics: "статистика",
      view: "одежда", weapons: "выбранное оружие", taunts: "насмешки"
    };
    const changes = changedFields.map((field) => labels[field]).filter(Boolean);
    return changes.length ? `Изменено: ${changes.join(", ")}` : "Изменены данные игрока";
  }
  if (event.eventType === "clan_state_change") return "Изменены данные клана";
  return event.description;
}

function renderEventRows(events, compact = false) {
  if (!events.length) return `<div class="empty-state">Событий по выбранным условиям нет</div>`;
  for (const event of events) state.eventCache.set(String(event.id), event);
  while (state.eventCache.size > 500) state.eventCache.delete(state.eventCache.keys().next().value);
  return events.map((event) => {
    const type = TYPE_LABELS[event.eventType] || String(event.eventType || "Событие").replaceAll("_", " ");
    const status = event.reviewStatus || "unchecked";
    return `<article class="event-row ${event.suspicious ? "suspicious" : ""}" data-event-id="${event.id}" tabindex="0" role="button" aria-label="${escapeHtml(type)}: ${escapeHtml(event.playerName || "Игра")}">
      <time class="event-time" datetime="${escapeHtml(event.createdAt)}">${escapeHtml(formatDate(event.createdAt, true))}</time>
      <span class="event-person" ${event.playerId ? `data-player-id="${event.playerId}" role="button" tabindex="0"` : ""}><b>${escapeHtml(event.playerName || "Игра")}</b><small>${event.playerId ? `ID ${event.playerId}` : "Система"}${event.clanName ? ` · ${escapeHtml(event.clanName)}` : ""}</small></span>
      <span class="event-type">${escapeHtml(type)}</span>
      <span class="event-description" title="${escapeHtml(eventDescription(event))}">${escapeHtml(eventDescription(event))}${eventValue(event) ? ` <strong class="event-value">${escapeHtml(eventValue(event))}</strong>` : ""}</span>
      <span class="event-status status-${escapeHtml(status)}">${escapeHtml(reviewLabel(status))}</span>
    </article>`;
  }).join("");
}

function reviewLabel(value) {
  return { unchecked: "Не проверено", checked: "Проверено", suspicious: "Подозрительно", violation: "Нарушение" }[value] || value;
}

function setAuthenticated(admin) {
  state.admin = admin;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#admin-name").textContent = admin.displayName || admin.login;
  $("#admin-role").textContent = ROLE_LABELS[admin.role] || admin.role;
  $("#admin-avatar").textContent = (admin.displayName || admin.login || "A")[0].toUpperCase();
  $$(".owner-only").forEach((node) => node.classList.toggle("hidden", !admin.permissions.includes("manage_admins")));
  $$(".export-capability").forEach((node) => node.classList.toggle("hidden", !admin.permissions.includes("export")));
}

function signOut(callApi = true) {
  if (callApi && state.token) api("/admin/logs/auth/logout", { method: "POST" }).catch(() => {});
  state.token = "";
  state.admin = null;
  state.eventRequestId += 1;
  state.eventCache.clear();
  state.events = [];
  state.stats = null;
  state.filters = {};
  state.search = "";
  state.page = 1;
  state.currentView = "dashboard";
  $$(".content-view").forEach(node => node.classList.toggle("hidden", node.id !== "dashboard-view"));
  setActiveNav($(".nav-item[data-view=dashboard]"));
  $("#page-title").textContent = "Главная";
  $("#event-list").replaceChildren();
  $("#latest-events").replaceChildren();
  $("#detail-modal").close();
  sessionStorage.removeItem("cc_log_token");
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  $("#password-input").value = "";
}

async function boot() {
  bindUi();
  if (!state.token) return;
  try {
    const data = await api("/admin/logs/auth/me");
    setAuthenticated(data.admin);
    await loadInitialData();
  } catch (error) {
    signOut(false);
    $("#login-error").textContent = error.message;
  }
}

async function loadInitialData() {
  await Promise.all([loadMeta(), loadStats()]);
}

async function loadMeta() {
  state.meta = await api("/admin/logs/meta");
  const categories = state.meta.categories || state.meta.categories || [];
  $("#filter-category").innerHTML = `<option value="">Все категории</option>${categories.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(CATEGORY_LABELS[item] || item)}</option>`).join("")}`;
  const types = state.meta.event_types || [];
  $("#filter-event-type").innerHTML = `<option value="">Все события</option>${types.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(TYPE_LABELS[item] || item)}</option>`).join("")}`;
}

async function loadStats(silent = false) {
  if (!silent) $("#stat-grid").innerHTML = Array(5).fill('<div class="skeleton"></div>').join("");
  try {
    const period = $("#stats-period").value;
    const previousLatest = state.latestEventId;
    state.stats = await api("/admin/logs/stats", { query: { period } });
    renderStats();
    const newest = Number(state.stats.latest?.[0]?.id || 0);
    if (previousLatest && newest > previousLatest) {
      $("#new-events-badge").textContent = `${newest - previousLatest} новых`;
      $("#new-events-badge").classList.remove("hidden");
    }
    state.latestEventId = Math.max(previousLatest, newest);
    $("#sync-time").textContent = `Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;
  } catch (error) {
    if (!silent) toast(error.message, "error");
  }
}

function renderStats() {
  const summary = state.stats.summary || {};
  const cards = [
    ["Событий", summary.events, "за выбранный период", "orange"],
    ["Игроков", summary.players, "уникальная активность", "cyan"],
    ["Кланов", summary.clans, "в ленте событий", "violet"],
    ["Подозрительных", summary.suspicious, "требуют проверки", "red"],
    ["Нарушений", summary.violations, "подтверждено", "green"]
  ];
  $("#stat-grid").innerHTML = cards.map(([label, value, meta, color]) => `<article class="stat-card ${color}"><span class="stat-label">${label}</span><div class="stat-value">${formatNumber(value)}</div><div class="stat-meta">${meta}</div></article>`).join("");
  $("#nav-event-count").textContent = formatNumber(summary.events);
  $("#nav-risk-count").textContent = formatNumber(summary.suspicious);
  renderActivity();
  const risks = (state.stats.latest || []).filter((event) => event.suspicious || event.severity === "critical").slice(0, 5);
  $("#risk-list").innerHTML = risks.length ? risks.map((event) => `<button class="risk-item" data-event-id="${event.id}"><span class="risk-indicator"></span><span><b>${escapeHtml(event.playerName || "Системное событие")}</b><p>${escapeHtml(event.description)}</p></span><time>${escapeHtml(relativeTime(event.createdAt))}</time></button>`).join("") : `<div class="empty-state">Новых рисков нет</div>`;
  $("#clan-strip").innerHTML = (state.stats.clans || []).map((clan) => `<button class="clan-card" data-clan-id="${clan.id}"><span class="clan-card-top"><b>${escapeHtml(clan.name)}</b><span class="clan-tag">${escapeHtml(clan.tag || `#${clan.id}`)}</span></span><span class="clan-metrics"><span>КАЗНА<strong>${formatNumber(clan.money)}</strong></span><span>СОСТАВ<strong>${formatNumber(clan.members)}</strong></span><span>СОБЫТИЯ<strong>${formatNumber(clan.events)}</strong></span></span></button>`).join("") || `<div class="empty-state">Кланы не найдены</div>`;
  $("#latest-events").innerHTML = renderEventRows(state.stats.latest || [], true);
}

function renderActivity() {
  const rows = state.stats.activity || [];
  const max = Math.max(1, ...rows.map((row) => Number(row.count || 0)));
  $("#activity-chart").innerHTML = rows.length ? rows.map((row) => {
    const height = Math.max(2, Number(row.count || 0) / max * 100);
    return `<span class="chart-bar-wrap" title="${formatDate(row.bucket)} — ${row.count} событий"><i class="chart-bar ${Number(row.suspicious || 0) ? "suspicious" : ""}" style="height:${height}%"></i><small>${new Date(row.bucket).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small></span>`;
  }).join("") : `<div class="empty-state">Данных за период нет</div>`;
  $("#category-legend").innerHTML = (state.stats.categories || []).slice(0, 7).map((row, index) => `<span class="legend-item"><i style="filter:hue-rotate(${index * 42}deg)"></i>${escapeHtml(CATEGORY_LABELS[row.category] || row.category)} · ${formatNumber(row.count)}</span>`).join("");
}

function eventQuery() {
  return { ...state.filters, q: state.search, page: state.page, pageSize: state.pageSize };
}

async function loadEvents(silent = false) {
  const requestId = ++state.eventRequestId;
  if (!silent) $("#event-list").innerHTML = Array(8).fill('<div class="skeleton"></div>').join("");
  try {
    const data = await api("/admin/logs/events", { query: eventQuery() });
    if (requestId !== state.eventRequestId || !state.admin) return;
    state.events = data.items;
    state.total = data.total;
    state.pages = data.pages;
    state.page = data.page;
    $("#event-list").innerHTML = renderEventRows(state.events);
    $("#event-total").textContent = formatNumber(state.total);
    renderPagination();
    $("#sync-time").textContent = `Обновлено ${new Date().toLocaleTimeString("ru-RU")}`;
  } catch (error) {
    if (requestId !== state.eventRequestId) return;
    $("#pagination").innerHTML = "";
    $("#event-total").textContent = "—";
    $("#event-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderPagination() {
  const pages = new Set([1, state.pages, state.page - 1, state.page, state.page + 1]);
  const visible = [...pages].filter((page) => page >= 1 && page <= state.pages).sort((a, b) => a - b);
  $("#pagination").innerHTML = `<button class="page-button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>←</button>${visible.map((page, index) => `${index && page - visible[index - 1] > 1 ? '<span class="page-button">…</span>' : ""}<button class="page-button ${page === state.page ? "active" : ""}" data-page="${page}">${page}</button>`).join("")}<button class="page-button" data-page="${state.page + 1}" ${state.page >= state.pages ? "disabled" : ""}>→</button>`;
}

function formatPlaytime(minutes) {
  const value = Math.max(0, Math.floor(Number(minutes) || 0));
  return value >= 60 ? `${Math.floor(value / 60)} ч ${value % 60} мин` : `${value} мин`;
}

function renderPlayerActivity(activity) {
  if (!activity) return `<p class="activity-note">Статистика времени недоступна. Обновите API панели.</p>`;
  const modeNames = {1:"Каждый за себя",2:"Командный бой",4:"Захват флага",8:"Контроль точек",16:"Оборона",32:"Сопровождение",64:"Зомби",128:"Экспедиция"};
  const peak = Math.max(1, ...activity.daily.map(day => day.minutes));
  const ranking = (rows, modes = false) => rows.length ? rows.map(row => `<div class="activity-ranking-row"><span>${escapeHtml(modes ? modeNames[row.name] || `Режим ${row.name}` : row.name)}</span><b>${formatPlaytime(row.minutes)}</b></div>`).join("") : `<p class="activity-note">Нет сохранённых итогов боя за период</p>`;
  return `<div class="playtime-summary"><div><span>Время в боях</span><strong>${formatPlaytime(activity.minutes)}</strong></div><div><span>Активных дней</span><strong>${activity.activeDays} / ${activity.days}</strong></div><div><span>Сохранённых итогов</span><strong>${formatNumber(activity.records)}</strong></div></div>
    <h3 class="section-title">Активность по дням · МСК</h3>
    <div class="player-daily">${activity.daily.map(day => `<div class="player-day"><time datetime="${day.date}">${escapeHtml(day.date.slice(8) + "." + day.date.slice(5,7))}</time><div class="player-day-track"><i style="width:${Math.max(0,day.minutes / peak * 100)}%"></i></div><b>${formatPlaytime(day.minutes)}</b></div>`).join("")}</div>
    <div class="activity-breakdowns"><section><h3 class="section-title">Карты</h3>${ranking(activity.maps)}</section><section><h3 class="section-title">Режимы</h3>${ranking(activity.modes,true)}</section></div>
    <p class="activity-note">По сохранённым итогам боя, с округлением вверх до минуты. Время относится к дате записи итога; текущий бой и время в меню не включены.</p>`;
}

async function openPlayer(playerId, period = "7d", page = 1) {
  $("#detail-modal").classList.remove("event-inspector");
  openModalLoading("Статистика игрока");
  const revision = state.detailRevision;
  try {
    const data = await api(`/admin/logs/players/${playerId}`, { query: { period, page } });
    if (!$("#detail-modal").open || revision !== state.detailRevision || !state.admin) return;
    const p = data.profile;
    const selectedPeriod = data.activity?.period || period;
    showModal(`<div class="modal-header"><div><h2>${escapeHtml(p.name)}</h2><p class="modal-subtitle">Игрок #${p.id}</p></div><button class="modal-close" aria-label="Закрыть">×</button></div><div class="modal-body">
      <div class="player-period-row"><label for="player-period">Период статистики</label><select id="player-period" data-profile-id="${p.id}">${[["1d","Сегодня"],["7d","Последние 7 дней"],["30d","Последние 30 дней"]].map(([value,label])=>`<option value="${value}" ${selectedPeriod===value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      ${renderPlayerActivity(data.activity)}
      <h3 class="section-title">Профиль сейчас</h3>
      <div class="profile-summary"><div class="mini-stat"><span>УРОВЕНЬ</span><b>${formatNumber(p.level)}</b></div><div class="mini-stat"><span>ОПЫТ</span><b>${formatNumber(p.exp)}</b></div><div class="mini-stat"><span>БАЛАНС</span><b>${formatNumber(p.money)}</b></div><div class="mini-stat"><span>КЛАН</span><b>${escapeHtml(p.clan_name || "—")}</b></div><div class="mini-stat"><span>ПОСЛЕДНИЙ ВХОД</span><b>${escapeHtml(formatDate(p.last_login_at,true))}</b></div></div>
      <details class="raw-details"><summary>Входы и устройство</summary><div class="detail-grid"><div class="detail-box"><span>ПОСЛЕДНИЙ ВЫХОД</span><code>${escapeHtml(formatDate(p.last_logout_at))}</code></div><div class="detail-box"><span>ПОСЛЕДНЯЯ АКТИВНОСТЬ</span><code>${escapeHtml(formatDate(p.last_seen_at))}</code></div><div class="detail-box"><span>IP</span><code>${escapeHtml(p.last_ip_address || "нет данных")}</code></div><div class="detail-box"><span>УСТРОЙСТВО</span><code>${escapeHtml(p.last_device || "нет данных")}</code></div></div></details>
      <h3 class="section-title">События за период · ${formatNumber(data.events.total)}</h3><div class="player-history-scroll"><div class="event-list">${renderEventRows(data.events.items)}</div></div>
      <div class="player-history-pages"><button class="button secondary" data-profile-page="${data.events.page - 1}" data-profile-id="${p.id}" data-period="${selectedPeriod}" ${data.events.page <= 1 ? "disabled" : ""}>Назад</button><span>${data.events.page} / ${data.events.pages}</span><button class="button secondary" data-profile-page="${data.events.page + 1}" data-profile-id="${p.id}" data-period="${selectedPeriod}" ${data.events.page >= data.events.pages ? "disabled" : ""}>Далее</button></div>
    </div>`);
  } catch (error) {
    if ($("#detail-modal").open && revision === state.detailRevision) showModalError(error.message);
  }
}

async function openClan(clanId) {
  $("#detail-modal").classList.remove("event-inspector");
  openModalLoading("История клана");
  try {
    const data = await api(`/admin/logs/clans/${clanId}`, { query: { pageSize: 50 } });
    const c = data.profile;
    showModal(`<div class="modal-header"><div><h2>${escapeHtml(c.name)}</h2><p class="modal-subtitle">Клан #${c.id}${c.tag ? ` · ${escapeHtml(c.tag)}` : ""}</p></div><button class="modal-close" aria-label="Закрыть">×</button></div><div class="modal-body">
      <div class="profile-summary"><div class="mini-stat"><span>УРОВЕНЬ</span><b>${formatNumber(c.level)}</b></div><div class="mini-stat"><span>ОПЫТ</span><b>${formatNumber(c.exp)}</b></div><div class="mini-stat"><span>КАЗНА</span><b>${formatNumber(c.money)}</b></div><div class="mini-stat"><span>УЧАСТНИКИ</span><b>${formatNumber(c.members)} / ${formatNumber(c.max_members)}</b></div><div class="mini-stat"><span>ВЛАДЕЛЕЦ</span><b>${escapeHtml(c.owner_name || `#${c.owner_player_id}`)}</b></div></div>
      <h3 class="section-title">Состав клана</h3><table class="member-table"><thead><tr><th>Игрок</th><th>Уровень</th><th>Роль</th><th>Вклад</th><th>Активность</th></tr></thead><tbody>${data.members.map((m) => `<tr><td><button class="text-button" data-player-id="${m.id}">${escapeHtml(m.name)} #${m.id}</button></td><td>${formatNumber(m.level)}</td><td>${escapeHtml(m.role)}</td><td>${formatNumber(m.money)}</td><td>${escapeHtml(relativeTime(m.last_seen_at))}</td></tr>`).join("")}</tbody></table>
      <h3 class="section-title">История клана · ${formatNumber(data.events.total)} событий</h3><div class="event-list">${renderEventRows(data.events.items)}</div>
    </div>`);
  } catch (error) { showModalError(error.message); }
}

async function openEvent(eventId) {
  const event = state.eventCache.get(String(eventId));
  if (!event) {
    switchView("events");
    state.search = String(eventId);
    $("#search-input").value = state.search;
    await loadEvents();
    return;
  }
  $("#detail-modal").classList.add("event-inspector");
  const canReview = state.admin.permissions.includes("review");
  showModal(`<div class="modal-header"><div><h2>${escapeHtml(TYPE_LABELS[event.eventType] || event.eventType)}</h2><p class="modal-subtitle">Событие #${event.id}</p></div><button class="modal-close" aria-label="Закрыть">×</button></div><div class="modal-body">
    <div class="profile-summary"><div class="mini-stat"><span>ИГРОК</span><b>${escapeHtml(event.playerName || "—")}</b></div><div class="mini-stat"><span>ID</span><b>${event.playerId || "—"}</b></div><div class="mini-stat"><span>КЛАН</span><b>${escapeHtml(event.clanName || "—")}</b></div><div class="mini-stat"><span>ВАЖНОСТЬ</span><b>${escapeHtml({info:"Обычное",notice:"Важное",warning:"Предупреждение",critical:"Критическое"}[event.severity] || event.severity)}</b></div><div class="mini-stat"><span>ВРЕМЯ</span><b>${escapeHtml(formatDate(event.createdAt, true))}</b></div></div>
    <p class="event-full-description">${escapeHtml(event.description)}</p>
    <dl class="event-facts">${Object.entries({
      "Источник": {battle_server:"Сервер игры",game_api:"Игровой API",admin_panel:"Администрация"}[event.source] || event.source,
      "Карта": event.metadata?.mapName, "Комната": event.metadata?.roomName,
      "IP": event.ipAddress, "Устройство": event.device,
      "Причина": event.metadata?.reason, "Описание жалобы": event.metadata?.details
    }).filter(([,value])=>value != null && value !== "").map(([key,value])=>`<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    ${event.oldValue != null || event.newValue != null ? `<div class="detail-grid"><div class="detail-box"><span>ДО</span><code>${escapeHtml(event.oldValue == null ? "—" : JSON.stringify(event.oldValue,null,2))}</code></div><div class="detail-box"><span>ПОСЛЕ</span><code>${escapeHtml(event.newValue == null ? "—" : JSON.stringify(event.newValue,null,2))}</code></div></div>` : ""}
    <details class="raw-details"><summary>Технические данные</summary><code>${escapeHtml(JSON.stringify(event.metadata,null,2) || "—")}</code></details>
    ${canReview ? `<form id="review-form" class="review-form" data-event-id="${event.id}"><label>Решение<div class="review-options">${["unchecked","checked","suspicious","violation"].map((status) => `<label class="review-choice"><input type="radio" name="reviewStatus" value="${status}" ${event.reviewStatus === status ? "checked" : ""}>${reviewLabel(status)}</label>`).join("")}</div></label><label>Заметка администратора<textarea name="adminNote" maxlength="2000" placeholder="Контекст проверки, доказательства, решение…">${escapeHtml(event.adminNote || "")}</textarea></label><button class="button primary" type="submit">Сохранить проверку</button></form>` : `<div class="detail-box"><span>РЕЗУЛЬТАТ ПРОВЕРКИ</span><code>${escapeHtml(reviewLabel(event.reviewStatus))}\n${escapeHtml(event.adminNote || "Без заметки")}</code></div>`}
  </div>`);
}

function openModalLoading(title) { showModal(`<div class="modal-header"><h2>${escapeHtml(title)}</h2><button class="modal-close">×</button></div><div class="modal-body"><div class="skeleton"></div><br><div class="skeleton"></div></div>`); }
function showModalError(message) { showModal(`<div class="modal-header"><h2>Ошибка</h2><button class="modal-close">×</button></div><div class="modal-body"><div class="empty-state">${escapeHtml(message)}</div></div>`); }
function showModal(html) { state.detailRevision = (state.detailRevision || 0) + 1; $("#detail-content").innerHTML = `<div class="modal-shell">${html}</div>`; const modal = $("#detail-modal"); if (!modal.open) modal.showModal(); }

async function loadAdmins() {
  try {
    const data = await api("/admin/logs/admins");
    $("#admin-list").innerHTML = data.items.map((admin) => `<div class="admin-row ${admin.active ? "" : "inactive"}" data-admin-id="${admin.id}"><span class="avatar">${escapeHtml((admin.displayName || admin.login)[0].toUpperCase())}</span><span><b>${escapeHtml(admin.displayName || admin.login)}</b><small>${escapeHtml(admin.login)} · ${escapeHtml(formatDate(admin.lastLoginAt, true))}</small></span><select class="admin-role-select" ${admin.role === "owner" ? "disabled" : ""}>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${admin.role === role ? "selected" : ""} ${role === "owner" && admin.role !== "owner" ? "disabled" : ""}>${escapeHtml(label)}</option>`).join("")}</select><button class="admin-toggle" ${admin.role === "owner" ? "disabled" : ""}>${admin.active ? "Отключить" : "Включить"}</button></div>`).join("");
  } catch (error) { toast(error.message, "error"); }
}

function setActiveNav(activeNode) {
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node === activeNode));
}

function switchView(view, options = {}) {
  state.eventRequestId += 1;
  state.currentView = view;
  $$(".content-view").forEach((node) => node.classList.add("hidden"));
  $(`#${view}-view`)?.classList.remove("hidden");
  const titles = { dashboard: "Главная", events: "Все события", admins: "Администраторы" };
  const activeNode = options.nav || $(`.nav-item[data-view="${view}"]`);
  setActiveNav(activeNode);
  $("#page-title").textContent = options.title || titles[view] || titles.dashboard;
  $("#sidebar").classList.remove("open");
  if (view === "events") loadEvents();
  if (view === "admins") loadAdmins();
}

function openFilters() { $("#filter-drawer").classList.add("open"); $("#filter-drawer").setAttribute("aria-hidden", "false"); $("#drawer-backdrop").classList.remove("hidden"); }
function closeFilters() { $("#filter-drawer").classList.remove("open"); $("#filter-drawer").setAttribute("aria-hidden", "true"); $("#drawer-backdrop").classList.add("hidden"); }

function applyFiltersFromForm() {
  const data = new FormData($("#filter-form"));
  state.filters = Object.fromEntries([...data.entries()].filter(([, value]) => value !== ""));
  state.filters.suspicious = $("#filter-form [name=suspicious]").checked ? "true" : "";
  if (state.filters.dateFrom) state.filters.dateFrom = new Date(state.filters.dateFrom).toISOString();
  if (state.filters.dateTo) state.filters.dateTo = new Date(state.filters.dateTo).toISOString();
  state.page = 1;
  const count = Object.values(state.filters).filter(Boolean).length;
  $("#filter-count").textContent = count;
  $("#filter-count").classList.toggle("hidden", count === 0);
  $("#active-filter-label").textContent = count ? `Активных фильтров: ${count}` : "Все категории";
  setActiveNav($(".nav-item[data-view=\"events\"]"));
  $("#page-title").textContent = "Все события";
  closeFilters();
  loadEvents();
}

async function exportCsv() {
  try {
    const url = new URL(`${API_BASE}/admin/logs/export.csv`);
    for (const [key, value] of Object.entries({ ...state.filters, q: state.search })) if (value) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error("Экспорт недоступен");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `contra-city-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) { toast(error.message, "error"); }
}

function bindUi() {
  $("#player-lookup").addEventListener("submit", event => {
    event.preventDefault();
    const playerId = Number(new FormData(event.target).get("playerId"));
    if (Number.isSafeInteger(playerId) && playerId > 0) openPlayer(playerId);
  });
  $("#detail-modal").addEventListener("change", event => {
    if (event.target.id === "player-period") openPlayer(event.target.dataset.profileId, event.target.value);
  });
  $("#detail-modal").addEventListener("click", event => {
    const button = event.target.closest("[data-profile-page]");
    if (button && !button.disabled) openPlayer(button.dataset.profileId, button.dataset.period, Number(button.dataset.profilePage));
  });
  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-event-id][role=button], [data-player-id][role=button]")) {
      event.preventDefault(); event.target.click();
    }
    if (event.key === "Escape") { closeFilters(); $("#sidebar").classList.remove("open"); }
  });
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#login-error").textContent = "";
    const button = $("#login-form button");
    button.disabled = true;
    try {
      const data = await api("/admin/logs/auth/login", { method: "POST", body: { login: $("#login-input").value, password: $("#password-input").value } });
      state.token = data.token;
      sessionStorage.setItem("cc_log_token", state.token);
      setAuthenticated(data.admin);
      await loadInitialData();
    } catch (error) { $("#login-error").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#logout-button").addEventListener("click", () => signOut(true));
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#refresh-button").addEventListener("click", () => state.currentView === "dashboard" ? loadStats() : state.currentView === "events" ? loadEvents() : loadAdmins());
  $("#stats-period").addEventListener("change", () => loadStats());
  $("#export-button").addEventListener("click", exportCsv);
  $("#filter-button").addEventListener("click", openFilters);
  $(".drawer-close").addEventListener("click", closeFilters);
  $("#drawer-backdrop").addEventListener("click", closeFilters);
  $("#filter-form").addEventListener("submit", (event) => { event.preventDefault(); applyFiltersFromForm(); });
  $("#reset-filters").addEventListener("click", () => { $("#filter-form").reset(); state.filters = {}; applyFiltersFromForm(); });
  let searchTimer;
  $("#search-input").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value.trim(); state.page = 1; loadEvents(); }, 350); });
  $("#pagination").addEventListener("click", (event) => { const page = Number(event.target.closest("[data-page]")?.dataset.page || 0); if (page > 0 && page <= state.pages && page !== state.page) { state.page = page; loadEvents(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  $("#detail-modal").addEventListener("click", (event) => { if (event.target === $("#detail-modal") || event.target.closest(".modal-close")) $("#detail-modal").close(); });
  $("#detail-modal").addEventListener("submit", async (event) => {
    if (event.target.id !== "review-form") return;
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const data = await api(`/admin/logs/events/${event.target.dataset.eventId}`, { method: "PATCH", body: Object.fromEntries(form) });
      const index = state.events.findIndex((item) => item.id === data.event.id);
      if (index >= 0) state.events[index] = data.event;
      state.eventCache.set(String(data.event.id), data.event);
      toast("Результат проверки сохранён");
      $("#detail-modal").close();
      if (state.currentView === "events") loadEvents(true); else loadStats(true);
    } catch (error) { toast(error.message, "error"); }
  });
  $("#admin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    try { await api("/admin/logs/admins", { method: "POST", body }); event.target.reset(); toast("Доступ выдан"); loadAdmins(); }
    catch (error) { toast(error.message, "error"); }
  });
  $("#admin-list").addEventListener("change", async (event) => {
    if (!event.target.classList.contains("admin-role-select")) return;
    const row = event.target.closest("[data-admin-id]");
    try { await api(`/admin/logs/admins/${row.dataset.adminId}`, { method: "PATCH", body: { role: event.target.value } }); toast("Роль изменена"); loadAdmins(); }
    catch (error) { toast(error.message, "error"); loadAdmins(); }
  });
  $("#admin-list").addEventListener("click", async (event) => {
    const button = event.target.closest(".admin-toggle");
    if (!button) return;
    const row = button.closest("[data-admin-id]");
    try { await api(`/admin/logs/admins/${row.dataset.adminId}`, { method: "PATCH", body: { active: button.textContent.includes("Включить") } }); toast("Статус доступа изменён"); loadAdmins(); }
    catch (error) { toast(error.message, "error"); }
  });
  document.addEventListener("click", (event) => {
    const player = event.target.closest("[data-player-id]");
    if (player) { event.stopPropagation(); openPlayer(player.dataset.playerId); return; }
    const clan = event.target.closest("[data-clan-id]");
    if (clan) { event.stopPropagation(); openClan(clan.dataset.clanId); return; }
    const eventNode = event.target.closest(".event-row[data-event-id], .risk-item[data-event-id]");
    if (eventNode) { openEvent(eventNode.dataset.eventId); return; }
    const nav = event.target.closest(".nav-item[data-view]");
    if (nav) {
      if (nav.dataset.view === "events") {
        state.filters = {};
        state.search = "";
        state.page = 1;
        $("#search-input").value = "";
        $("#filter-form").reset();
        $("#filter-count").classList.add("hidden");
        $("#active-filter-label").textContent = "Все события";
      }
      switchView(nav.dataset.view, { nav });
      return;
    }
    const categoryGroup = event.target.closest(".nav-item[data-filter-categories]");
    if (categoryGroup) {
      state.filters = { categories: categoryGroup.dataset.filterCategories };
      state.search = "";
      state.page = 1;
      $("#search-input").value = "";
      $("#filter-form").reset();
      $("#filter-count").classList.add("hidden");
      $("#active-filter-label").textContent = categoryGroup.dataset.pageTitle;
      switchView("events", { nav: categoryGroup, title: categoryGroup.dataset.pageTitle });
      return;
    }
    const category = event.target.closest("[data-filter-category]");
    if (category) {
      state.filters = { category: category.dataset.filterCategory };
      state.page = 1;
      const matchingNav = $(`.nav-item[data-filter-categories="${category.dataset.filterCategory}"]`);
      const title = matchingNav?.dataset.pageTitle || "Все события";
      $("#active-filter-label").textContent = title;
      switchView("events", { nav: matchingNav || $(".nav-item[data-view=\"events\"]"), title });
      return;
    }
    const suspicious = event.target.closest("[data-suspicious]");
    if (suspicious) {
      state.filters = { suspicious: "true" };
      state.page = 1;
      const riskNav = $(".nav-item[data-suspicious=\"true\"]");
      $("#active-filter-label").textContent = "Подозрительная активность";
      switchView("events", { nav: riskNav, title: "Подозрительная активность" });
    }
  });
}

boot();
