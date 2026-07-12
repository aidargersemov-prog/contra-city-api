const CONFIG = window.__LOG_PANEL_CONFIG__ || {};
const API_BASE = String(CONFIG.apiBaseUrl || "https://contra-city-api-production.up.railway.app").replace(/\/+$/, "");
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
  session: "Сессии", economy: "Экономика", weapons: "Оружие", workshop: "Мастерская",
  clothes: "Одежда", taunts: "Насмешки", enhancers: "Усилители", abilities: "Способности",
  inventory: "Инвентарь", progress: "Прогресс", clan: "Кланы", battle: "Бой",
  profile: "Профиль", security: "Безопасность", moderation: "Модерация", system: "Система"
};
const TYPE_LABELS = {
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
  latestEventId: 0
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
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
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
  return events.map((event) => {
    const category = event.category || "system";
    const type = TYPE_LABELS[event.eventType] || event.eventType.replaceAll("_", " ");
    return `<article class="event-row category-${escapeHtml(category)} ${event.suspicious ? "suspicious" : ""}" data-event-id="${event.id}" tabindex="0">
      <span class="event-icon">${escapeHtml(CATEGORY_ICONS[category] || "·")}</span>
      <span class="event-person" ${event.playerId ? `data-player-id="${event.playerId}"` : ""}><b>${escapeHtml(event.playerName || (event.playerId ? `Игрок #${event.playerId}` : "Игра"))}</b><small>${event.playerId ? `ID ${event.playerId}` : "Событие игры"}</small></span>
      <span class="event-clan" ${event.clanId ? `data-clan-id="${event.clanId}"` : ""}><b>${escapeHtml(event.clanName || "Без клана")}</b><small>${event.clanId ? `КЛАН #${event.clanId}` : "—"}</small></span>
      <span class="event-description"><span class="event-type">${escapeHtml(type)}</span><p>${escapeHtml(eventDescription(event))}</p></span>
      <span class="event-value ${event.suspicious ? "risk-flag" : ""}">${escapeHtml(eventValue(event))}</span>
      <time class="event-time" datetime="${escapeHtml(event.createdAt)}">${escapeHtml(formatDate(event.createdAt, true))}${event.reviewStatus !== "unchecked" ? `<br>${escapeHtml(reviewLabel(event.reviewStatus))}` : ""}</time>
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
    $("#sync-time").textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
  if (!silent) $("#event-list").innerHTML = Array(8).fill('<div class="skeleton"></div>').join("");
  try {
    const data = await api("/admin/logs/events", { query: eventQuery() });
    state.events = data.items;
    state.total = data.total;
    state.pages = data.pages;
    state.page = data.page;
    $("#event-list").innerHTML = renderEventRows(state.events);
    $("#event-total").textContent = formatNumber(state.total);
    renderPagination();
  } catch (error) {
    $("#event-list").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderPagination() {
  const pages = new Set([1, state.pages, state.page - 1, state.page, state.page + 1]);
  const visible = [...pages].filter((page) => page >= 1 && page <= state.pages).sort((a, b) => a - b);
  $("#pagination").innerHTML = `<button class="page-button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>←</button>${visible.map((page, index) => `${index && page - visible[index - 1] > 1 ? '<span class="page-button">…</span>' : ""}<button class="page-button ${page === state.page ? "active" : ""}" data-page="${page}">${page}</button>`).join("")}<button class="page-button" data-page="${state.page + 1}" ${state.page >= state.pages ? "disabled" : ""}>→</button>`;
}

async function openPlayer(playerId) {
  openModalLoading("История игрока");
  try {
    const data = await api(`/admin/logs/players/${playerId}`, { query: { pageSize: 50 } });
    const p = data.profile;
    showModal(`<div class="modal-header"><div><h2>${escapeHtml(p.name)}</h2><p class="modal-subtitle">Игрок #${p.id}</p></div><button class="modal-close" aria-label="Закрыть">×</button></div><div class="modal-body">
      <div class="profile-summary"><div class="mini-stat"><span>УРОВЕНЬ</span><b>${formatNumber(p.level)}</b></div><div class="mini-stat"><span>ОПЫТ</span><b>${formatNumber(p.exp)}</b></div><div class="mini-stat"><span>БАЛАНС</span><b>${formatNumber(p.money)}</b></div><div class="mini-stat"><span>КЛАН</span><b>${escapeHtml(p.clan_name || "—")}</b></div><div class="mini-stat"><span>ПОСЛЕДНЯЯ АКТИВНОСТЬ</span><b>${escapeHtml(relativeTime(p.last_seen_at))}</b></div></div>
      <div class="detail-grid"><div class="detail-box"><span>ПОСЛЕДНИЙ ВХОД</span><code>${escapeHtml(formatDate(p.last_login_at))}</code></div><div class="detail-box"><span>ПОСЛЕДНИЙ ВЫХОД</span><code>${escapeHtml(formatDate(p.last_logout_at))}</code></div><div class="detail-box"><span>ПОСЛЕДНИЙ IP</span><code>${escapeHtml(p.last_ip_address || "нет данных")}</code></div><div class="detail-box"><span>УСТРОЙСТВО</span><code>${escapeHtml(p.last_device || "нет данных")}</code></div></div>
      <h3 class="section-title">Полная история · ${formatNumber(data.events.total)} событий</h3><div class="event-list">${renderEventRows(data.events.items)}</div>
    </div>`);
  } catch (error) { showModalError(error.message); }
}

async function openClan(clanId) {
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
  const event = [...state.events, ...(state.stats?.latest || [])].find((item) => Number(item.id) === Number(eventId));
  if (!event) {
    switchView("events");
    state.search = String(eventId);
    $("#search-input").value = state.search;
    await loadEvents();
    return;
  }
  const canReview = state.admin.permissions.includes("review");
  showModal(`<div class="modal-header"><div><h2>${escapeHtml(TYPE_LABELS[event.eventType] || event.eventType)}</h2><p class="modal-subtitle">Событие #${event.id}</p></div><button class="modal-close" aria-label="Закрыть">×</button></div><div class="modal-body">
    <div class="profile-summary"><div class="mini-stat"><span>ИГРОК</span><b>${escapeHtml(event.playerName || "—")}</b></div><div class="mini-stat"><span>ID</span><b>${event.playerId || "—"}</b></div><div class="mini-stat"><span>КЛАН</span><b>${escapeHtml(event.clanName || "—")}</b></div><div class="mini-stat"><span>ВАЖНОСТЬ</span><b>${escapeHtml(event.severity)}</b></div><div class="mini-stat"><span>ВРЕМЯ</span><b>${escapeHtml(formatDate(event.createdAt, true))}</b></div></div>
    <p>${escapeHtml(event.description)}</p><div class="detail-grid"><div class="detail-box"><span>СТАРОЕ ЗНАЧЕНИЕ</span><code>${escapeHtml(JSON.stringify(event.oldValue, null, 2) || "—")}</code></div><div class="detail-box"><span>НОВОЕ ЗНАЧЕНИЕ</span><code>${escapeHtml(JSON.stringify(event.newValue, null, 2) || "—")}</code></div><div class="detail-box"><span>IP / УСТРОЙСТВО</span><code>${escapeHtml(`${event.ipAddress || "—"}\n${event.device || "—"}`)}</code></div><div class="detail-box"><span>МЕТАДАННЫЕ</span><code>${escapeHtml(JSON.stringify(event.metadata, null, 2) || "—")}</code></div></div>
    ${canReview ? `<form id="review-form" class="review-form" data-event-id="${event.id}"><label>Решение<div class="review-options">${["unchecked","checked","suspicious","violation"].map((status) => `<label class="review-choice"><input type="radio" name="reviewStatus" value="${status}" ${event.reviewStatus === status ? "checked" : ""}>${reviewLabel(status)}</label>`).join("")}</div></label><label>Заметка администратора<textarea name="adminNote" maxlength="2000" placeholder="Контекст проверки, доказательства, решение…">${escapeHtml(event.adminNote || "")}</textarea></label><button class="button primary" type="submit">Сохранить проверку</button></form>` : `<div class="detail-box"><span>РЕЗУЛЬТАТ ПРОВЕРКИ</span><code>${escapeHtml(reviewLabel(event.reviewStatus))}\n${escapeHtml(event.adminNote || "Без заметки")}</code></div>`}
  </div>`);
}

function openModalLoading(title) { showModal(`<div class="modal-header"><h2>${escapeHtml(title)}</h2><button class="modal-close">×</button></div><div class="modal-body"><div class="skeleton"></div><br><div class="skeleton"></div></div>`); }
function showModalError(message) { showModal(`<div class="modal-header"><h2>Ошибка</h2><button class="modal-close">×</button></div><div class="modal-body"><div class="empty-state">${escapeHtml(message)}</div></div>`); }
function showModal(html) { $("#detail-content").innerHTML = `<div class="modal-shell">${html}</div>`; const modal = $("#detail-modal"); if (!modal.open) modal.showModal(); }

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
    const eventNode = event.target.closest("[data-event-id]");
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
      $("#active-filter-label").textContent = "Подозрительные события";
      switchView("events", { nav: riskNav, title: "Подозрительные события" });
    }
  });
}

boot();
