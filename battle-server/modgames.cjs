"use strict";

// ModGames is an opt-in extension to mode 64. No legacy Photon payload lives
// here: server.js owns authentication, wire encoding and ordinary combat.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = 1;
const MAX_EVENTS = 24;
const MAX_POINTS = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PICKUP_RADIUS = 2.25;
const MIN_FALL_HEIGHT = 100;
const DECAY_SECONDS = 5;
const EMPTY = Object.freeze({ speed: 1, jump: 1, gravity: 1, fireRate: 1, reloadRate: 1,
  damage: 1, vampirism: 0, frozen: false, infiniteMagazine: false, invisible: false,
  doubleJump: false, opacity: 1, dashCharges: 0 });

const parameter = (key, label, value, min, max, step = 1) => ({ key, label, value, min, max, step });
function definition(id, name, description, team, duration, parameters, rarity = "common") {
  return Object.freeze({ id, name, description, icon: id, team, rarity,
    duration, weight: rarity === "legendary" ? 1 : rarity === "rare" ? 3 : 10,
    params: Object.fromEntries(parameters.map(p => [p.key, p.value])),
    parameters: parameters.map(({ value, ...p }) => p) });
}
const pct = (key, label, value, max = 300) => parameter(key, label, value, 0, max, 1);
const hp = (value) => parameter("health", "Дополнительные HP", value, 1, 20000);
const speed = value => pct("speedPercent", "Скорость, %", value);
const jump = value => pct("jumpPercent", "Высота прыжка, %", value, 500);
const reload = value => pct("reloadPercent", "Скорость перезарядки, %", value, 1900);
const charges = value => parameter("charges", "Заряды", value, 1, 10);
const CATALOG = Object.freeze([
  definition("highJump", "Высокий прыжок", "Увеличивает высоту обычного прыжка.", "human", 40, [jump(85)]),
  definition("ultraJump", "Ультра-прыжок", "Редкий прыжок на крыши и контейнеры.", "human", 12, [jump(200)], "rare"),
  definition("sprinter", "Спринтер", "Ускоряет обычный бег.", "human", 30, [speed(35)]),
  definition("adrenaline", "Адреналин", "Быстрее движение и перезарядка.", "human", 20, [speed(20), reload(20)]),
  definition("doubleJump", "Двойной прыжок", "Быстро нажмите пробел ещё раз в воздухе.", "human", 30, []),
  definition("dash", "Рывок", "Дважды W: рывок вперёд. Заряды ограничены.", "human", 30, [charges(3)]),
  definition("antigravity", "Антигравитация", "Выше прыжок и медленнее падение.", "human", 25,
    [jump(60), parameter("gravityPercent", "Гравитация от обычной, %", 55, 20, 100)]),
  definition("berserk", "Берсерк", "Дополнительный урон относительно обычного урона.", "human", 30, [pct("damagePercent", "Урон, %", 25)]),
  definition("rapidFire", "Скорострел", "Выше скорострельность, без изменения базового оружия.", "human", 25, [pct("fireRatePercent", "Скорострельность, %", 30)]),
  definition("fastHands", "Быстрые руки", "Очень быстрая перезарядка.", "human", 20, [reload(900)]),
  definition("shockRounds", "Шоковые патроны", "Попадание может ненадолго остановить заражённого.", "human", 25,
    [parameter("chancePercent", "Шанс, %", 25, 0, 100), parameter("freezeSeconds", "Заморозка, сек", 0.75, 0.1, 3, 0.05)]),
  definition("infiniteMagazine", "Бесконечный магазин", "Стрельба не расходует патроны в магазине.", "human", 10, [], "rare"),
  definition("lastHero", "Последний герой", "Меньше HP — больше урон; прибавка ограничена на весь выстрел.", "human", 30,
    [parameter("maxBonus", "Максимальная прибавка за выстрел", 100, 0, 100)]),
  definition("armor", "Броня", "Временные HP. После окончания лишний запас плавно убывает.", "human", 30, [hp(150)]),
  definition("shield", "Щит", "Игнорирует несколько ударов заражённого, кроме усиленной Инфекции.", "human", 30, [charges(3)]),
  definition("regeneration", "Регенерация", "Постепенно лечит до обычного максимума HP.", "human", 25,
    [parameter("healthPerSecond", "HP в секунду", 10, 1, 1000)]),
  definition("secondLife", "Вторая жизнь", "Один раз спасает от смертельного урона, оставляя 1 HP. Инфекция пробивает.", "human", 45, [], "rare"),
  definition("vampirism", "Вампиризм", "Возвращает часть реального нанесённого урона в HP.", "human", 30, [pct("healPercent", "Возврат урона в HP, %", 15, 100)]),
  definition("invisibility", "Невидимость", "Краткая невидимость до первого выстрела.", "human", 6, [], "rare"),
  definition("timeDilation", "Замедление времени", "Только ваше движение и перезарядка ускорены; время матча не меняется.", "human", 20, [speed(25), reload(30)]),
  definition("turbo", "Турбо-режим", "Золотой дроп: скорость, прыжок и скорострельность.", "human", 9,
    [speed(40), jump(100), pct("fireRatePercent", "Скорострельность, %", 40)], "legendary"),
  definition("jumper", "Прыгун", "Дополнительная высота обычного прыжка заражённого.", "zombie", 30, [jump(40)]),
  definition("hunter", "Охотник", "Быстрее обычного заражённого.", "zombie", 30, [speed(35)]),
  definition("tank", "Танк", "Дополнительные HP ценой скорости.", "zombie", 30,
    [hp(1000), parameter("slowPercent", "Снижение скорости, %", 15, 0, 70)]),
  definition("rage", "Ярость", "Большой урон за короткое время временно ускоряет.", "zombie", 30,
    [parameter("damageThreshold", "Порог урона", 300, 1, 20000), parameter("windowSeconds", "Окно урона, сек", 2, 0.25, 10, 0.25),
      parameter("speedSeconds", "Ускорение, сек", 3, 0.5, 10, 0.5), speed(40)]),
  definition("ghost", "Призрак", "На короткое время становится полупрозрачным.", "zombie", 7,
    [parameter("opacityPercent", "Видимость, %", 25, 5, 90)]),
  definition("zombieDash", "Рывок заражённого", "Дважды W: быстрый рывок вперёд.", "zombie", 30, [charges(3)]),
  definition("packCall", "Зов стаи", "Все заражённые получают ускорение, включая вошедших позже.", "zombie", 10, [speed(25)], "rare"),
  definition("parasite", "Паразит", "Удар временно замедляет человека и снижает его прыжок.", "zombie", 25,
    [parameter("slowPercent", "Снижение скорости, %", 25, 0, 80), parameter("jumpSlowPercent", "Снижение прыжка, %", 30, 0, 80),
      parameter("effectSeconds", "Ослабление, сек", 4, 0.5, 20, 0.5)]),
  definition("alpha", "Альфа-заражённый", "Большой запас HP, ускорение и усиленный прыжок.", "zombie", 30,
    [hp(2500), speed(30), jump(50)], "legendary"),
  definition("infection", "Инфекция", "Следующий удар сразу заражает человека через Щит и Вторую жизнь.", "zombie", 30, [], "rare"),
  definition("apocalypse", "Апокалипсис", "Временно подавляет баффы людей и ускоряет всех заражённых.", "zombie", 10, [speed(30)], "legendary"),
  definition("predator", "Хищник", "Невидимость и скорость до первой атаки или окончания эффекта.", "zombie", 15, [speed(30)], "rare"),
]);
const DEFINITIONS = new Map(CATALOG.map(b => [b.id, b]));
const copy = value => JSON.parse(JSON.stringify(value));
const DEFAULT_CONFIG = Object.freeze({ name: "Заражение · ModGames", map: "Zombi", durationSeconds: 3600, slots: 20,
  firstDropSeconds: 60, intervalSeconds: 180, dropCount: 4, dropLifetimeSeconds: 120,
  fallSeconds: 4, fallHeight: MIN_FALL_HEIGHT, warningSeconds: 50,
  buffs: CATALOG.map(({ id, weight, duration, params }) => ({ id, weight, duration, params })) });

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}: ожидается объект`);
}
function number(value, label, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail(`${label}: допустимо ${min}–${max}${integer ? ", целое число" : ""}`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: неизвестное поле ${key}`);
}
function readJson(filename) {
  const size = fs.statSync(filename).size;
  if (size > MAX_FILE_BYTES) fail("Слишком большой файл ModGames");
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

function createModGames(options) {
  object(options, "options");
  const o = options;
  for (const callback of ["createRoom", "findRoom", "removeRoom", "onChanged", "emit", "isZombie", "baseMaxHealth", "syncHealth", "onModifiers", "canAct", "onRoundExpired"])
    if (typeof o[callback] !== "function") fail(`ModGames: отсутствует callback ${callback}`);
  if (!path.isAbsolute(o.directory || "") || !path.isAbsolute(o.pointsDirectory || "")) fail("ModGames directories must be absolute");
  const now = o.now || Date.now;
  const random = o.random || Math.random;
  const log = typeof o.log === "function" ? o.log : () => {};
  const events = new Map();
  const maps = new Map();
  const states = new Map();
  let initialized = false;
  let sequence = 0;
  const filename = path.join(o.directory, "events-v1.json");
  const rnd = () => Math.max(0, Math.min(0.999999999999, Number(random()) || 0));
  const base = session => Math.max(1, Math.min(1000000, Number(o.baseMaxHealth(session)) || 1));
  const roomOf = session => typeof session?.room === "string" ? o.findRoom(session.room) : session?.room;
  const eventFor = room => {
    if (typeof room === "string") room = o.findRoom(room);
    const event = room && events.get(room.modGameId);
    return event && !event.closed && event.room === room ? event : null;
  };
  const requireEvent = room => eventFor(room) || fail("Это не активный бой ModGames");
  const send = (event, data, target) => o.emit(event.room, { v: VERSION, serverNow: now(), id: event.id, ...data }, target);
  const notice = (event, text, icon = "", target, seconds = 4) => send(event,
    { type: "notice", actor: target ? target.actorId : 0, text, icon, seconds }, target);
  const roomPacket = event => ({ type: "room", name: event.config.name, roomName: event.roomName, map: event.config.map,
    endsAt: event.endsAt, durationSeconds: event.config.durationSeconds, nextDropAt: event.nextDropAt, nextCount: event.nextCount, config: copy(event.config) });
  const metadata = event => ({ id: event.id, name: event.config.name, map: event.config.map, roomName: event.roomName,
    createdAt: event.createdAt, endsAt: event.endsAt, nextDropAt: event.nextDropAt, nextCount: event.nextCount, config: copy(event.config) });
  const persistRecord = event => ({ ...metadata(event), requestKey: event.requestKey || "" });

  function write(records) {
    fs.mkdirSync(o.directory, { recursive: true });
    const body = JSON.stringify({ schemaVersion: VERSION, events: records });
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) fail("Слишком много настроек ModGames");
    const temp = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, body, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, filename);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  const records = () => [...events.values()].filter(e => !e.closed).map(persistRecord);
  function loadMaps() {
    if (!fs.existsSync(o.pointsDirectory)) { log("[modgames] no points directory; creation unavailable"); return; }
    for (const entry of fs.readdirSync(o.pointsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-z0-9_-]+\.json$/i.test(entry.name)) continue;
      const document = readJson(path.join(o.pointsDirectory, entry.name));
      object(document, "Точки");
      if (document.schemaVersion !== 1 || document.coordinateSpace !== "Unity world" ||
          !/^[a-z0-9_-]{1,80}$/i.test(document.mapId || "") || !Array.isArray(document.points) ||
          !document.points.length || document.points.length > MAX_POINTS) fail(`Неверный файл точек ${entry.name}`);
      if (entry.name.slice(0, -5).toLowerCase() !== document.mapId.toLowerCase()) fail("Имя файла точек не совпадает с mapId");
      if (maps.has(document.mapId.toLowerCase())) fail("Повторная карта ModGames");
      const ids = new Set();
      const points = document.points.map(p => {
        object(p, "Точка"); number(p.id, "ID точки", 1, 2147483647, true);
        if (ids.has(p.id)) fail("Повторный ID точки"); ids.add(p.id);
        if (p.type !== "ground") fail("Дропы поддерживают только точки ground");
        for (const k of ["x", "y", "z"]) number(p[k], k, -100000, 100000);
        for (const k of ["normalX", "normalY", "normalZ"]) number(p[k], k, -1.001, 1.001);
        if (p.normalY < 0.5 || Math.abs(Math.hypot(p.normalX, p.normalY, p.normalZ) - 1) > 0.02) fail("Неверная нормаль поверхности");
        number(p.clearance, "Просвет", 0, 10000);
        if (typeof p.airClear !== "boolean") fail("Неверный признак просвета");
        return { id: p.id, x: p.x, y: p.y, z: p.z, normalX: p.normalX, normalY: p.normalY,
          normalZ: p.normalZ, clearance: p.clearance, airClear: p.airClear };
      });
      maps.set(document.mapId.toLowerCase(), { mapId: document.mapId,
        mapName: String(document.mapName || document.mapId).slice(0, 128), points });
    }
  }
  function validateConfig(input) {
    keys(input, Object.keys(DEFAULT_CONFIG), "Настройки");
    const c = { ...copy(DEFAULT_CONFIG), ...copy(input) };
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 64 || /[\u0000-\u001f\u007f]/.test(c.name)) fail("Название: 1–64 символа");
    c.name = c.name.trim();
    if (typeof c.map !== "string" || !maps.has(c.map.toLowerCase())) fail("Для этой карты нет проверенных точек на сервере");
    const map = maps.get(c.map.toLowerCase()); c.map = map.mapId;
    number(c.durationSeconds, "Длительность", 10, 604800);
    number(c.slots, "Слоты", 1, 64, true);
    number(c.firstDropSeconds, "Первый дроп", 0, 604800);
    number(c.intervalSeconds, "Интервал", 1, 604800);
    number(c.dropCount, "Количество дропов", 1, map.points.length, true);
    number(c.dropLifetimeSeconds, "Время жизни дропа", 1, 3600);
    number(c.fallSeconds, "Длительность спуска", 0.5, 30);
    number(c.fallHeight, "Высота спуска", 1, 100);
    number(c.warningSeconds, "Предупреждение", 0, 3600);
    // Legacy clearance scanned only 30m, including invisible colliders. It is not a flight ceiling.
    c.fallHeight = Math.max(MIN_FALL_HEIGHT, c.fallHeight);
    if (!Array.isArray(c.buffs) || !c.buffs.length || c.buffs.length > CATALOG.length) fail("Нужен хотя бы один бафф");
    const ids = new Set();
    c.buffs = c.buffs.map(inputBuff => {
      keys(inputBuff, ["id", "weight", "duration", "params"], "Бафф");
      const def = DEFINITIONS.get(inputBuff.id);
      if (!def || ids.has(def.id)) fail("Неизвестный или повторный бафф"); ids.add(def.id);
      const b = { id: def.id, weight: def.weight, duration: def.duration, params: copy(def.params), ...inputBuff };
      number(b.weight, "Вес баффа", 0.01, 1000);
      number(b.duration, "Длительность баффа", 0.5, 3600);
      keys(b.params, Object.keys(def.params), "Параметры баффа");
      b.params = { ...def.params, ...b.params };
      for (const p of def.parameters) number(b.params[p.key], p.label, p.min, p.max, p.key === "charges");
      return copy(b);
    });
    return c;
  }
  function runtime(record) {
    // Persist the room configuration, never resume a round without its players.
    return { ...record, endsAt: 0, nextDropAt: 0, nextCount: record.config.dropCount,
      nextDelaySeconds: record.config.firstDropSeconds, closed: false,
      drops: new Map(), globals: new Map(), warned: new Set(), room: null, lastTick: now() };
  }
  function makeRoom(event) {
    if (o.findRoom(event.roomName)) fail("Имя боя уже занято");
    const room = o.createRoom({ name: event.roomName, displayName: event.config.name, map: event.config.map,
      mode: 64, slots: event.config.slots, timeLimit: event.config.durationSeconds, modGameId: event.id, modGameConfig: copy(event.config) });
    if (!room || !room.players || typeof room.players.values !== "function") fail("createRoom must return room with players Map");
    event.room = room; room.modGameId = event.id;
  }
  function initialize() {
    if (initialized) return list();
    loadMaps();
    let stored = [];
    if (fs.existsSync(filename)) {
      const document = readJson(filename);
      if (!document || document.schemaVersion !== VERSION || !Array.isArray(document.events) || document.events.length > MAX_EVENTS) fail("Повреждён журнал ModGames; файл сохранён без изменений");
      const ids = new Set();
      stored = document.events.map(r => {
        object(r, "Сохранённый бой");
        if (!/^[a-f0-9]{24}$/.test(r.id || "") || ids.has(r.id) || r.roomName !== `modgame-${r.id}`) fail("Повреждён ID ModGames");
        ids.add(r.id);
        for (const k of ["createdAt", "endsAt", "nextDropAt"]) number(r[k], k, 0, Number.MAX_SAFE_INTEGER);
        number(r.nextCount, "Следующая волна", 1, MAX_POINTS, true);
        if (r.requestKey && (typeof r.requestKey !== "string" || r.requestKey.length > 160)) fail("Повреждён ключ запроса");
        // v1 timestamps used to expire the room. Rooms are now persistent;
        // even old elapsed records restart in WAIT_FOR_PLAYERS.
        return runtime({ ...r, config: validateConfig(r.config) });
      }).filter(Boolean);
    }
    const created = [];
    try {
      for (const event of stored) { makeRoom(event); events.set(event.id, event); created.push(event); }
      if (fs.existsSync(filename)) write(records());
    } catch (error) {
      for (const event of created) { events.delete(event.id); o.removeRoom(event.room); }
      throw error;
    }
    initialized = true;
    o.onChanged();
    log(`[modgames] ready maps=${maps.size} events=${events.size}`);
    return list();
  }
  function list() {
    return { maps: [...maps.values()].map(m => ({ mapId: m.mapId, mapName: m.mapName, count: m.points.length })),
      events: [...events.values()].filter(e => !e.closed).map(metadata), catalog: copy(CATALOG), defaultConfig: copy(DEFAULT_CONFIG) };
  }
  function create(input, requestKey = "") {
    if (!initialized) fail("ModGames не инициализирован");
    if (typeof requestKey !== "string" || requestKey.length > 160) fail("Неверный ключ запроса");
    if (requestKey) { const prior = [...events.values()].find(e => e.requestKey === requestKey); if (prior) return metadata(prior); }
    if (events.size >= MAX_EVENTS) fail(`Максимум ${MAX_EVENTS} активных ModGames`);
    const config = validateConfig(input);
    const id = crypto.randomBytes(12).toString("hex");
    const time = now();
    const event = runtime({ id, roomName: `modgame-${id}`, requestKey, config, createdAt: time,
      endsAt: 0, nextDropAt: 0, nextCount: config.dropCount });
    const previous = records();
    write([...previous, persistRecord(event)]);
    try { makeRoom(event); }
    catch (error) { write(previous); throw error; }
    events.set(id, event);
    o.onChanged();
    log(`[modgames] created id=${id} map=${config.map} points=${maps.get(config.map.toLowerCase()).points.length}`);
    return metadata(event);
  }

  function getState(session, createIfMissing = false) {
    const event = eventFor(roomOf(session));
    if (!event) return null;
    let state = states.get(session);
    const zombie = !!o.isZombie(session);
    if (state && (state.event !== event || state.zombie !== zombie)) { reset(session); state = null; }
    if (!state && createIfMissing) {
      state = { session, event, zombie, buffs: new Map(), decay: [], lastTick: now(), lastModifiers: "", lastBuffs: "",
        healFraction: 0, lastDashAt: -Infinity, lastDoubleJumpAt: -Infinity, shotSequence: 0, shots: new Map(), rageHits: [] };
      states.set(session, state);
    }
    return state;
  }
  const activeGlobal = (event, id) => { const b = event.globals.get(id); return b && b.expiresAt > now() ? b : null; };
  const suppressed = state => !state.zombie && !!activeGlobal(state.event, "apocalypse");
  function activeBuff(state, id) {
    if (!state) return null;
    const b = state.buffs.get(id);
    if (!b || b.expiresAt <= now() || (suppressed(state) && !id.startsWith("_"))) return null;
    return b;
  }
  function modifiers(session) {
    const state = getState(session);
    const m = { ...EMPTY };
    if (!state) return m;
    const off = suppressed(state);
    const time = now();
    for (const b of state.buffs.values()) {
      if (b.expiresAt <= time || (off && !b.id.startsWith("_"))) continue;
      const p = b.params;
      if (b.id !== "rage" || b.triggerUntil > time) m.speed += (p.speedPercent || 0) / 100;
      m.jump += (p.jumpPercent || 0) / 100;
      m.fireRate += (p.fireRatePercent || 0) / 100;
      m.reloadRate += (p.reloadPercent || 0) / 100;
      m.damage += (p.damagePercent || 0) / 100;
      m.speed -= (p.slowPercent || 0) / 100;
      m.jump -= (p.jumpSlowPercent || 0) / 100;
      if (p.gravityPercent !== undefined) m.gravity = Math.min(m.gravity, p.gravityPercent / 100);
      if (p.opacityPercent !== undefined) m.opacity = Math.min(m.opacity, p.opacityPercent / 100);
      if (b.id === "vampirism") m.vampirism += p.healPercent / 100;
      if (b.id === "doubleJump") m.doubleJump = true;
      if (b.id === "infiniteMagazine") m.infiniteMagazine = true;
      if (b.id === "invisibility" || b.id === "predator") m.invisible = true;
      if (b.id === "dash" || b.id === "zombieDash") m.dashCharges += b.charges;
      if (b.id === "_shock") m.frozen = true;
    }
    if (state.zombie) for (const id of ["packCall", "apocalypse"]) {
      const b = activeGlobal(state.event, id); if (b) m.speed += b.params.speedPercent / 100;
    }
    // Bounds are guardrails for combinations; ordinary stats remain untouched.
    m.speed = Math.max(0.15, Math.min(10, m.speed));
    m.jump = Math.max(0.15, Math.min(20, m.jump));
    m.fireRate = Math.min(10, m.fireRate); m.reloadRate = Math.min(30, m.reloadRate);
    m.damage = Math.min(10, m.damage); m.vampirism = Math.min(1, m.vampirism);
    return m;
  }
  function healthCap(session) {
    const ordinary = base(session);
    const state = getState(session);
    if (!state || suppressed(state)) return ordinary;
    let bonus = 0;
    for (const b of state.buffs.values()) {
      if (!b.params.health) continue;
      if (b.expiresAt > now()) bonus += b.params.health;
      else bonus += Math.max(0, b.params.health * (1 - (now() - b.expiresAt) / (DECAY_SECONDS * 1000)));
    }
    for (const d of state.decay) bonus += Math.max(0, d.health * (1 - (now() - d.start) / (DECAY_SECONDS * 1000)));
    return Math.ceil(ordinary + bonus);
  }
  function instance(b, off = false) {
    const def = DEFINITIONS.get(b.id);
    return { id: b.id, name: def ? def.name : b.id === "_shock" ? "Шоковые патроны" : "Паразит",
      description: def ? describe(b) : b.id === "_shock" ? "Движение временно остановлено" : "Скорость и прыжок временно снижены",
      icon: def ? def.icon : b.id === "_shock" ? "shockRounds" : "parasite",
      expiresAt: b.expiresAt, charges: b.charges || 0, suppressed: off };
  }
  function describe(b) {
    const def = DEFINITIONS.get(b.id);
    const detail = def.parameters.map(p => `${p.label}: ${b.params[p.key]}`).join(" · ");
    return def.description + (detail ? ` ${detail}` : "");
  }
  function buffList(state) {
    const off = suppressed(state);
    const result = [...state.buffs.values()].filter(b => b.expiresAt > now()).map(b => instance(b, off && !b.id.startsWith("_")));
    for (const id of ["packCall", "apocalypse"]) {
      const b = activeGlobal(state.event, id);
      if (b && (state.zombie || id === "apocalypse")) result.push(instance(b, !state.zombie));
    }
    return result;
  }
  function publish(state, target, force = false) {
    const m = modifiers(state.session);
    const buffs = buffList(state);
    const ms = JSON.stringify(m), bs = JSON.stringify([buffs, healthCap(state.session)]);
    if (ms !== state.lastModifiers) o.onModifiers(state.session, m);
    if (force || target || ms !== state.lastModifiers || bs !== state.lastBuffs)
      send(state.event, { type: "actor", actor: state.session.actorId, zombie: state.zombie, modifiers: m, buffs,
        baseHealth: base(state.session), healthCap: healthCap(state.session) }, target);
    state.lastModifiers = ms; state.lastBuffs = bs;
  }
  function clampHealth(session, healthDecay = false) {
    const cap = healthCap(session);
    if (session.health > cap) {
      session.health = cap;
      o.syncHealth(session, healthDecay ? "modgame-health-decay" : undefined);
    }
  }
  function heal(state, amount) {
    if (!o.canAct(state.session) || amount <= 0) return;
    if (state.session.health >= base(state.session)) { state.healFraction = 0; return; }
    state.healFraction += amount;
    const add = Math.floor(state.healFraction);
    if (add > 0) {
      state.healFraction -= add;
      state.session.health = Math.min(base(state.session), state.session.health + add);
      o.syncHealth(state.session);
    }
  }
  function grant(session, setting) {
    const event = requireEvent(roomOf(session));
    const def = DEFINITIONS.get(setting.id);
    if (!def || def.team !== (o.isZombie(session) ? "zombie" : "human")) return false;
    const state = getState(session, true);
    const b = { id: def.id, params: copy(setting.params), expiresAt: now() + setting.duration * 1000,
      charges: setting.params.charges || (def.id === "secondLife" || def.id === "infection" ? 1 : 0) };
    if (def.id === "packCall" || def.id === "apocalypse") {
      event.globals.set(def.id, b);
      for (const player of event.room.players.values()) {
        const recipient = getState(player, true); if (recipient) { clampHealth(player); publish(recipient); }
      }
      notice(event, `${def.name}: ${def.description}`, def.icon);
    } else {
      const previous = state.buffs.get(b.id);
      state.buffs.set(b.id, b);
      if (b.params.health && !previous) {
        session.health = Math.min(healthCap(session), session.health + b.params.health);
        o.syncHealth(session);
      }
      publish(state);
    }
    notice(event, `${def.name} · ${describe(b)}`, def.icon, session, 5);
    return true;
  }
  function choose(buffs) {
    if (!buffs.length) return null;
    let roll = rnd() * buffs.reduce((sum, b) => sum + b.weight, 0);
    for (const b of buffs) { roll -= b.weight; if (roll < 0) return b; }
    return buffs[buffs.length - 1];
  }
  function sendDrops(event, drops, target, replace = false) {
    if (!drops.length && replace) send(event, { type: "drops", replace: true, drops: [] }, target);
    for (let start = 0; start < drops.length; start += 32)
      send(event, { type: "drops", replace: replace && start === 0, drops: drops.slice(start, start + 32) }, target);
  }
  function spawn(event, count, explicitBuff, all = false) {
    const c = event.config, time = now();
    const occupied = new Set([...event.drops.values()].map(d => d.pointId));
    const points = maps.get(c.map.toLowerCase()).points.filter(p => all || !occupied.has(p.id));
    if (!all) for (let i = points.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [points[i], points[j]] = [points[j], points[i]]; }
    const explicit = explicitBuff && DEFINITIONS.get(explicitBuff);
    const explicitSetting = explicit && (c.buffs.find(b => b.id === explicit.id) || { id: explicit.id, duration: explicit.duration, params: copy(explicit.params), weight: explicit.weight });
    const humans = c.buffs.filter(b => DEFINITIONS.get(b.id).team === "human");
    const zombies = c.buffs.filter(b => DEFINITIONS.get(b.id).team === "zombie");
    const created = [];
    for (const p of points.slice(0, count)) {
      const h = explicit ? (explicit.team === "human" ? explicitSetting : null) : choose(humans);
      const z = explicit ? (explicit.team === "zombie" ? explicitSetting : null) : choose(zombies);
      const representative = [h, z].filter(Boolean).sort((a, b) => DEFINITIONS.get(a.id).weight - DEFINITIONS.get(b.id).weight)[0];
      if (!representative) continue;
      const drop = { id: `${event.id}-${++sequence}`, pointId: p.id, x: p.x, y: p.y, z: p.z,
        normalX: p.normalX, normalY: p.normalY, normalZ: p.normalZ, spawnAt: time,
        landAt: time + c.fallSeconds * 1000, expiresAt: time + (c.fallSeconds + c.dropLifetimeSeconds) * 1000,
        height: Math.max(MIN_FALL_HEIGHT, c.fallHeight), buff: representative.id,
        team: h && z ? "any" : h ? "human" : "zombie", rarity: DEFINITIONS.get(representative.id).rarity,
        humanBuff: h ? h.id : "", zombieBuff: z ? z.id : "" };
      // Non-enumerable server settings never enter public protocol JSON.
      Object.defineProperty(drop, "settings", { value: { human: h, zombie: z } });
      event.drops.set(drop.id, drop); created.push(drop);
    }
    sendDrops(event, created);
    if (created.length) notice(event, `Дропы в пути: ${created.length}. Приземление через ${c.fallSeconds} сек.`, "drop");
    return created.length;
  }
  function testAll(room, buff) {
    const event = requireEvent(room);
    if (buff !== undefined && buff !== "" && !DEFINITIONS.has(buff)) fail("Неизвестный тестовый бафф");
    if (event.lastTestAt !== undefined && now() - event.lastTestAt < 1000) fail("Тест уже запущен. Подождите секунду");
    const map = maps.get(event.config.map.toLowerCase());
    event.lastTestAt = now();
    event.drops.clear(); sendDrops(event, [], undefined, true);
    return spawn(event, map.points.length, buff, true);
  }
  function next(room, delaySeconds, count) {
    const event = requireEvent(room);
    number(delaySeconds, "Задержка", 0, 604800);
    number(count, "Количество", 1, maps.get(event.config.map.toLowerCase()).points.length, true);
    const updated = { ...persistRecord(event), nextDropAt: event.endsAt > 0 ? now() + delaySeconds * 1000 : 0, nextCount: count };
    write(records().map(r => r.id === event.id ? updated : r));
    event.nextDropAt = updated.nextDropAt; event.nextDelaySeconds = delaySeconds; event.nextCount = count; event.warned.clear();
    send(event, roomPacket(event));
    notice(event, event.endsAt > 0 ? `Следующая волна: ${count} дропов через ${delaySeconds} сек.`
      : `После старта раунда: ${count} дропов через ${delaySeconds} сек.`, "drop");
    o.onChanged();
    return metadata(event);
  }
  function move(session, point) {
    const event = eventFor(roomOf(session));
    if (!event || !o.canAct(session) || !point || ![point.x, point.y, point.z].every(Number.isFinite)) return false;
    const state = getState(session, true);
    if (modifiers(session).frozen) return false;
    const time = now();
    let nearest, distance = Infinity;
    for (const drop of event.drops.values()) {
      if (time < drop.spawnAt || time >= drop.expiresAt) continue;
      const setting = drop.settings[state.zombie ? "zombie" : "human"];
      // Match ModGameDropVisual.Tick's SmoothStep descent. Keep the original
      // pickup window relative to the crate's base (visual center is base + 1).
      const progress = Math.max(0, Math.min(1, (time - drop.spawnAt) / Math.max(1, drop.landAt - drop.spawnAt)));
      const dropY = drop.y + drop.height * (1 - progress * progress * (3 - 2 * progress));
      if (!setting || point.y < dropY - 0.75 || point.y > dropY + 3) continue;
      const d = (point.x - drop.x) ** 2 + (point.z - drop.z) ** 2;
      if (d <= PICKUP_RADIUS ** 2 && d < distance) { nearest = drop; distance = d; }
    }
    if (!nearest) return false;
    // Delete synchronously BEFORE invoking callbacks, preventing double pickup.
    event.drops.delete(nearest.id);
    send(event, { type: "removeDrops", ids: [nearest.id] });
    grant(session, nearest.settings[state.zombie ? "zombie" : "human"]);
    log(`[modgames] pickup id=${event.id} actor=${session.actorId} point=${nearest.pointId} buff=${nearest.settings[state.zombie ? "zombie" : "human"].id} phase=${time < nearest.landAt ? "air" : "ground"}`);
    return true;
  }
  function shot(session) {
    const state = getState(session);
    if (!state) return "";
    let changed = false;
    for (const id of ["invisibility", "predator"]) if (state.buffs.delete(id)) changed = true;
    state.shotSequence++;
    state.currentShot = `${session.actorId}:${state.shotSequence}`;
    if (changed) publish(state);
    return state.currentShot;
  }
  function beforeDamage(shooter, target, amount, context = {}) {
    const result = { damage: Math.max(0, Number.isFinite(amount) ? amount : 0), forceInfection: false, shielded: false };
    const event = eventFor(roomOf(target));
    if (!event || event !== eventFor(roomOf(shooter)) || shooter === target) return result;
    const attacker = getState(shooter, true), defender = getState(target, true);
    if (!o.canAct(shooter) || !o.canAct(target) || modifiers(shooter).frozen) { result.damage = 0; return result; }
    if (context.infectionHit && attacker.zombie && !defender.zombie) {
      const infection = activeBuff(attacker, "infection");
      if (infection) {
        attacker.buffs.delete("infection"); publish(attacker);
        result.forceInfection = true;
        notice(event, "Инфекция пробила защиту", "infection", target);
        return result;
      }
      const shield = activeBuff(defender, "shield");
      if (shield) {
        shield.charges--;
        if (shield.charges <= 0) defender.buffs.delete("shield");
        publish(defender);
        result.damage = 0; result.shielded = true;
        notice(event, `Щит поглотил удар. Зарядов: ${Math.max(0, shield.charges)}`, "shield", target);
        return result;
      }
      if (context.bossInfectionHit) {
        // Boss claws are lethal, but only the Infection buff bypasses Second Life.
        result.lethalInfection = true;
        return result;
      }
    }
    result.damage *= modifiers(shooter).damage;
    const hero = activeBuff(attacker, "lastHero");
    if (hero && result.damage > 0) {
      const key = typeof context.shotId === "string" || typeof context.shotId === "number" ? String(context.shotId) : attacker.currentShot;
      // Integration supplies one stable key across pellets/targets of a shot.
      if (key) {
        let budget = attacker.shots.get(key);
        if (!budget) {
          budget = { remaining: hero.params.maxBonus * Math.max(0, 1 - shooter.health / base(shooter)), at: now() };
          attacker.shots.set(key, budget);
        }
        const bonus = Math.min(budget.remaining, hero.params.maxBonus);
        result.damage += bonus; budget.remaining -= bonus;
        while (attacker.shots.size > 64) attacker.shots.delete(attacker.shots.keys().next().value);
      }
    }
    result.damage = Math.max(0, Math.round(result.damage));
    return result;
  }
  function debuff(state, id, duration, params) {
    state.buffs.set(id, { id, expiresAt: now() + duration * 1000, params, charges: 0 });
    publish(state);
  }
  function afterDamage(shooter, target, dealt) {
    if (!Number.isFinite(dealt) || dealt <= 0) return;
    const attacker = getState(shooter), defender = getState(target);
    if (!attacker || !defender || attacker.event !== defender.event || shooter === target) return;
    const m = modifiers(shooter);
    if (m.vampirism > 0) heal(attacker, dealt * m.vampirism);
    if (o.canAct(target) && !attacker.zombie && defender.zombie) {
      const shock = activeBuff(attacker, "shockRounds");
      if (shock && rnd() * 100 < shock.params.chancePercent) {
        debuff(defender, "_shock", shock.params.freezeSeconds, {});
        notice(defender.event, `Шоковые патроны: остановка на ${shock.params.freezeSeconds} сек.`, "shockRounds", target);
      }
    }
    if (o.canAct(target) && attacker.zombie && !defender.zombie) {
      const parasite = activeBuff(attacker, "parasite");
      if (parasite) {
        debuff(defender, "_parasite", parasite.params.effectSeconds,
          { slowPercent: parasite.params.slowPercent, jumpSlowPercent: parasite.params.jumpSlowPercent });
        notice(defender.event, "Паразит: скорость и прыжок временно снижены", "parasite", target);
      }
    }
    const rage = activeBuff(defender, "rage");
    if (rage && o.canAct(target)) {
      defender.rageHits = defender.rageHits.filter(h => now() - h.at <= rage.params.windowSeconds * 1000);
      defender.rageHits.push({ at: now(), damage: dealt });
      if (defender.rageHits.reduce((sum, h) => sum + h.damage, 0) >= rage.params.damageThreshold) {
        rage.triggerUntil = now() + rage.params.speedSeconds * 1000; defender.rageHits = [];
        publish(defender); notice(defender.event, "Ярость: временное ускорение", "rage", target);
      }
    }
  }
  function preventLethal(session, { infectionBypass = false } = {}) {
    const state = getState(session);
    if (!state || state.zombie || infectionBypass || !activeBuff(state, "secondLife")) return false;
    state.buffs.delete("secondLife"); session.health = 1;
    o.syncHealth(session); publish(state);
    notice(state.event, "Вторая жизнь: вы остались человеком с 1 HP", "secondLife", session);
    return true;
  }
  function ability(session, id) {
    const state = getState(session);
    if (!state || !o.canAct(session) || modifiers(session).frozen) return false;
    if (id === "dash") {
      const b = activeBuff(state, state.zombie ? "zombieDash" : "dash");
      if (!b || b.charges <= 0 || now() - state.lastDashAt < 900) return false;
      state.lastDashAt = now(); b.charges--;
      if (!b.charges) state.buffs.delete(b.id);
      publish(state);
    } else if (id === "doubleJump") {
      if (!activeBuff(state, "doubleJump") || now() - state.lastDoubleJumpAt < 900) return false;
      state.lastDoubleJumpAt = now();
    } else return false;
    send(state.event, { type: "ability", actor: session.actorId, ability: id });
    return true;
  }
  function reset(session) {
    const state = states.get(session);
    if (!state) return;
    states.delete(session);
    o.onModifiers(session, { ...EMPTY });
    if (session.health > base(session)) { session.health = base(session); o.syncHealth(session); }
    if (!state.event.closed) send(state.event, { type: "actor", actor: session.actorId, zombie: !!o.isZombie(session), modifiers: { ...EMPTY }, buffs: [],baseHealth:base(session),healthCap:base(session) });
  }
  function resetRound(room) {
    const event=eventFor(room);if(!event)return;
    event.endsAt=0;event.nextDropAt=0;event.nextCount=event.config.dropCount;
    event.nextDelaySeconds=event.config.firstDropSeconds;event.warned.clear();event.lastTick=now();
    event.globals.clear();event.drops.clear();sendDrops(event,[],undefined,true);
    for(const player of room.players.values())reset(player);
    send(event, roomPacket(event));
    notice(event, "", "", undefined, 1);
    o.onChanged();
  }
  function startRound(room) {
    const event=eventFor(room);if(!event || event.endsAt>0)return false;
    const time=now();
    event.endsAt=time+event.config.durationSeconds*1000;
    event.nextDropAt=time+event.nextDelaySeconds*1000;
    event.warned.clear();event.lastTick=time;
    send(event, roomPacket(event));
    o.onChanged();
    log(`[modgames] round-start id=${event.id} duration=${event.config.durationSeconds}s firstDrop=${event.nextDelaySeconds}s`);
    return true;
  }
  function sync(session) {
    const event = eventFor(roomOf(session));
    if (!event) return false;
    send(event, roomPacket(event), session);
    sendDrops(event, [...event.drops.values()], session, true);
    for (const player of event.room.players.values()) {
      const state = getState(player, true);
      if (state) publish(state, session, true);
    }
    return true;
  }
  function close(event, reason) {
    // Persist first: an IO failure keeps the current event fully usable.
    write(records().filter(r => r.id !== event.id));
    event.closed = true;
    send(event, { type: "end", reason });
    for (const [session, state] of states) if (state.event === event) reset(session);
    event.drops.clear(); event.globals.clear();
    events.delete(event.id);
    o.removeRoom(event.room);
    o.onChanged();
    log(`[modgames] ended id=${event.id} reason=${reason}`);
  }
  function remove(id) {
    if (typeof id !== "string") fail("Неверный ID ModGames");
    const event = events.get(id); if (!event) return false;
    close(event, "removed"); return true;
  }
  function tick() {
    const time = now();
    for (const event of [...events.values()]) {
      if (event.endsAt > 0 && time >= event.endsAt) {
        // The zombie lifecycle owns results/restart. Do not delete its room.
        o.onRoundExpired(event.room);
        continue;
      }
      let globalsChanged = false;
      for (const [id, b] of event.globals) if (b.expiresAt <= time) { event.globals.delete(id); globalsChanged = true; }
      const removed = [];
      for (const [id, d] of event.drops) if (d.expiresAt <= time) { event.drops.delete(id); removed.push(id); }
      for (let i = 0; i < removed.length; i += 128) send(event, { type: "removeDrops", ids: removed.slice(i, i + 128) });
      if (event.endsAt > 0 && event.nextDropAt > 0 && time >= event.nextDropAt) {
        const nextAt = time + event.config.intervalSeconds * 1000;
        const updated = { ...persistRecord(event), nextDropAt: nextAt, nextCount: event.config.dropCount };
        try {
          write(records().map(r => r.id === event.id ? updated : r));
          const count = event.nextCount;
          event.nextDropAt = nextAt; event.nextCount = event.config.dropCount; event.warned.clear();
          spawn(event, count);
          send(event, roomPacket(event));
          o.onChanged();
        } catch (error) {
          if (!event.lastIoErrorAt || time - event.lastIoErrorAt > 5000) { log(`[modgames] wave persistence failed: ${error.message}`); event.lastIoErrorAt = time; }
        }
      } else if (event.endsAt > 0 && event.nextDropAt > 0) {
        const remaining = Math.ceil((event.nextDropAt - time) / 1000);
        for (const threshold of [event.config.warningSeconds, 3, 2, 1]) {
          if (threshold > 0 && remaining <= threshold && !event.warned.has(threshold)) {
            event.warned.add(threshold);
            // If the clock advances across several boundaries, announce only
            // the current number once, never a burst of stale countdowns.
            if (!event.warned.has(`announced:${remaining}`)) {
              event.warned.add(`announced:${remaining}`);
              notice(event, `Следующий дроп через ${remaining} сек.`, "drop", undefined, remaining <= 3 ? 1 : 4);
            }
          }
        }
      }
      for (const player of event.room.players.values()) {
        const state = getState(player, true); if (!state) continue;
        if (!o.canAct(player)) { if (state.buffs.size || state.decay.length) reset(player); continue; }
        const elapsed = Math.max(0, (time - state.lastTick) / 1000); state.lastTick = time;
        // Capture the final decay tick before expired entries are removed below.
        const healthDecay = !suppressed(state) && (state.decay.length > 0 ||
          [...state.buffs.values()].some(b => b.params.health && b.expiresAt <= time));
        for (const [id, b] of state.buffs) if (b.expiresAt <= time) {
          state.buffs.delete(id);
          if (b.params.health) state.decay.push({ health: b.params.health, start: b.expiresAt });
        }
        state.decay = state.decay.filter(d => time - d.start < DECAY_SECONDS * 1000);
        for (const [key, shotBudget] of state.shots) if (time - shotBudget.at > 30000) state.shots.delete(key);
        clampHealth(player, healthDecay);
        const regen = activeBuff(state, "regeneration");
        if (regen) heal(state, Math.min(elapsed, 1) * regen.params.healthPerSecond);
        publish(state, undefined, globalsChanged);
      }
      event.lastTick = time;
    }
    // Integration calls reset on leave; this also catches unexpected disconnects.
    for (const [session, state] of states) if (eventFor(roomOf(session)) !== state.event || ![...state.event.room.players.values()].includes(session)) reset(session);
  }
  return { initialize, list, create, remove, testAll, next, sync, tick, move, beforeDamage, afterDamage,
    preventLethal, shot, reset, resetRound, startRound, ability, modifiers, healthCap,
    isActive: room => !!eventFor(room), retain: room => !!eventFor(room) };
}

module.exports = { createModGames, CATALOG, DEFAULT_CONFIG };
