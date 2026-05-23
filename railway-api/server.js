import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const CREATE_CODE = process.env.CREATE_CODE || "CONTRA-REVIVE-2026";
const DEFAULT_KEY = process.env.DEFAULT_KEY || "contra-revive-key";
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data", "accounts.json");
const ASSET_BUNDLE_DIR = path.join(process.cwd(), "assetbundles");
const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
const DATABASE_URL = process.env.DATABASE_URL || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://contra-city-api.onrender.com").replace(/\/+$/, "");
const LAUNCHER_MANIFEST_PATH = path.resolve(
  process.env.LAUNCHER_MANIFEST_PATH ||
    firstExistingPath([
      path.join(process.cwd(), "launcher", "manifest.json"),
      path.join(process.cwd(), "..", "launcher", "manifest.json"),
      path.join(process.cwd(), "launcher-manifest.json")
    ]) ||
    path.join(process.cwd(), "launcher-manifest.json")
);
const LAUNCHER_UPDATE_DIR = path.resolve(
  process.env.LAUNCHER_UPDATE_DIR ||
    firstExistingPath([
      path.join(process.cwd(), "contra2build"),
      path.join(process.cwd(), "..", "contra2build"),
      path.join(process.cwd(), "update-files")
    ]) ||
    path.join(process.cwd(), "update-files")
);

const START_MONEY = Number(process.env.START_MONEY || 1000);
const START_LEVEL = Number(process.env.START_LEVEL || 1);
const START_EXP = Number(process.env.START_EXP || 0);
const START_EXP_MAX = Number(process.env.START_EXP_MAX || 1000);
const SHOP_PRICE = 100;
const BATTLE_HOST = process.env.BATTLE_HOST || "";
const BATTLE_NAME = process.env.BATTLE_NAME || "Contra City";
const BATTLE_EVENT_TOKEN = process.env.BATTLE_EVENT_TOKEN || "";

function firstExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

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

const timedPermanentCost = (id, value = 100) => ({
  sc_id: String(id),
  t1v: value,
  t1r: 0,
  t1p: 0,
  t7v: value,
  t7r: 0,
  t7p: 0,
  t30v: value,
  t30r: 0,
  t30p: 0,
  tPv: value,
  tPr: 0,
  tPp: 0
});

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

function weaponBalance(slot, wt, id) {
  const bySlot = {
    1: { ammo: 1, ammo_tot: 1, rap: 340, rt: 0, lt: 250, dev: 2, rad: 8, krit: 8, smindam: 18, smaxdam: 34, mmindam: 12, mmaxdam: 22, lmindam: 8, lmaxdam: 14 },
    2: { ammo: 12, ammo_tot: 60, rap: 240, rt: 2967, lt: 520, dev: 8, rad: 10, krit: 7, smindam: 18, smaxdam: 28, mmindam: 13, mmaxdam: 21, lmindam: 8, lmaxdam: 15 },
    3: { ammo: 30, ammo_tot: 90, rap: 150, rt: 2967, lt: 650, dev: 12, rad: 12, krit: 5, smindam: 16, smaxdam: 25, mmindam: 13, mmaxdam: 21, lmindam: 9, lmaxdam: 17 },
    4: { ammo: 90, ammo_tot: 180, rap: 125, rt: 800, lt: 1100, dev: 18, rad: 14, krit: 4, smindam: 13, smaxdam: 22, mmindam: 11, mmaxdam: 18, lmindam: 8, lmaxdam: 14 },
    5: { ammo: 6, ammo_tot: 36, rap: 620, rt: 4500, lt: 900, dev: 24, rad: 18, krit: 6, smindam: 55, smaxdam: 82, mmindam: 30, mmaxdam: 48, lmindam: 10, lmaxdam: 18 },
    6: { ammo: 1, ammo_tot: 8, rap: 900, rt: 2300, lt: 1150, dev: 6, rad: 28, krit: 3, smindam: 78, smaxdam: 120, mmindam: 62, mmaxdam: 95, lmindam: 40, lmaxdam: 72 },
    7: { ammo: 10, ammo_tot: 40, rap: 850, rt: 2967, lt: 1000, dev: 3, rad: 10, krit: 12, smindam: 65, smaxdam: 95, mmindam: 72, mmaxdam: 110, lmindam: 82, lmaxdam: 135 }
  };
  const base = bySlot[slot] || bySlot[3];
  const variant = Number(id % 5);
  return {
    ...base,
    smindam: base.smindam + variant,
    smaxdam: base.smaxdam + variant,
    mmindam: base.mmindam + variant,
    mmaxdam: base.mmaxdam + variant,
    lmindam: base.lmindam + variant,
    lmaxdam: base.lmaxdam + variant,
    vel: wt === 8 || wt === 9 || wt === 15 ? 65 : 100,
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
    iS: 1,
    sc: cost(1000 + id, price),
    ...extra
  };
}

function wear(id, wt, sname, price = 50, slot = null) {
  const text = wearTextFor(slot, sname);
  return {
    itype: 3,
    id,
    w_id: id,
    wt,
    sname,
    sn: sname,
    nlvl: 1,
    iS: 1,
    sc: cost(2000 + id, price),
    ...text
  };
}

function taunt(id, price = 100) {
  return {
    itype: 4,
    t_id: id,
    sname: `taunt_${id}`,
    sn: `taunt_${id}`,
    nlvl: 1,
    iS: 1,
    sc: timedPermanentCost(3000 + id, price)
  };
}

function enhancer(id, price = 120) {
  return {
    itype: 2,
    e_id: id,
    sname: `enhancer_${id}`,
    sn: `enhancer_${id}`,
    nlvl: 1,
    iS: 1,
    iC: 0,
    sc: timedPermanentCost(4000 + id, price)
  };
}

const defaultWeapons = [
  weapon(1, 1, 1, "ohca_basebalbat", 0, { ammo: 0, ammo_tot: 0 }),
  weapon(2, 3, 2, "hg_makarov", 0),
  weapon(3, 4, 3, "mg_ak47", 0),
  weapon(4, 6, 4, "gg_m134", 0),
  weapon(5, 7, 5, "sg_winchester1887", 0),
  weapon(6, 8, 6, "rl_rpg26", 0),
  weapon(7, 10, 7, "sr_svd", 0)
];

const rebuiltShopWeaponCatalog = [
  { id: 10, slot: 1, sname: "ohca_basebalbat", name: "ГОСТ Бита", price: 100, stRa: 2, stDa: 2, ammo: 0, ammo_tot: 0 },
  { id: 72, slot: 1, sname: "ohca_candy", name: "Огненная Карамель", price: 900, stRa: 2, stDa: 4, ammo: 0, ammo_tot: 0 },
  { id: 71, slot: 1, sname: "ohca_candy2", name: "Новогодняя Карамель", price: 900, stRa: 2, stDa: 3, ammo: 0, ammo_tot: 0 },

  { id: 108, slot: 2, sname: "hg_taurus", name: "Палач", price: 1900, stRa: 3, stDi: 3, stDa: 5, ammo: 6, ammo_tot: 42 },
  { id: 105, slot: 2, sname: "hg_usp", name: "Скиф", price: 1500, stRa: 3, stDi: 3, stDa: 3, ammo: 12, ammo_tot: 72 },

  { id: 101, slot: 3, sname: "mg_assaultrifle02", name: "Адвокат", price: 2200, stRa: 4, stDi: 4, stDa: 4, ammo: 35, ammo_tot: 175 },
  { id: 73, slot: 3, sname: "mg_ump45vkks_o", name: "Вождь", price: 2100, stRa: 4, stDi: 4, stDa: 5, ammo: 30, ammo_tot: 120 },
  { id: 80, slot: 3, sname: "mg_aug5_o", name: "Повстанец", price: 2300, stRa: 5, stDa: 4, ammo: 35, ammo_tot: 224 },
  { id: 79, slot: 3, sname: "mg_aug4_o", name: "Кобра", price: 2300, stRa: 5, stDi: 4, stDa: 4, ammo: 35, ammo_tot: 189 },

  { id: 110, slot: 4, sname: "gg_fnmag", name: "Бастион", price: 2600, stRa: 5, stDi: 3, stDa: 5, ammo: 90, ammo_tot: 270 },
  { id: 67, slot: 4, sname: "gg_m134b03", name: "Рой", price: 2400, stRa: 5, stDi: 2, stDa: 4, ammo: 100, ammo_tot: 300 },

  { id: 109, slot: 5, sname: "sg_remington", name: "Советник", price: 2200, stRa: 2, stDi: 2, stDa: 5, ammo: 8, ammo_tot: 48 },
  { id: 106, slot: 5, sname: "sg_spas", name: "Кабан", price: 2100, stRa: 2, stDi: 3, stDa: 5, ammo: 6, ammo_tot: 36 },

  { id: 43, slot: 6, sname: "rl_m202a1", name: "МЭЛС", price: 2500, stRa: 2, stDi: 5, stDa: 5, ammo: 4, ammo_tot: 16 },
  { id: 44, slot: 6, sname: "gl_milkor", name: "Гранатин", price: 2000, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 30 },
  { id: 104, slot: 6, sname: "gl_grenadelauncher03", name: "Ворчун", price: 2300, stRa: 3, stDi: 4, stDa: 4, ammo: 3, ammo_tot: 18 },
  { id: 59, slot: 6, sname: "rl_rpg7b02", name: "Троллебузина", price: 2600, stRa: 1, stDi: 5, stDa: 5, ammo: 1, ammo_tot: 9 },
  { id: 45, slot: 6, sname: "gl_milkor_a", name: "Гадюка", price: 2200, stRa: 3, stDi: 4, stDa: 4, ammo: 6, ammo_tot: 36 },

  { id: 107, slot: 7, sname: "sr_vintorez", name: "Вымпел", price: 2400, stRa: 4, stDi: 5, stDa: 4, ammo: 20, ammo_tot: 100 },
  { id: 103, slot: 7, sname: "sr_sniperrifle03", name: "Анаконда", price: 2300, stRa: 1, stDi: 5, stDa: 5, ammo: 5, ammo_tot: 35 },
  { id: 74, slot: 7, sname: "sr_wildcat1", name: "Росомаха", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16 },
  { id: 75, slot: 7, sname: "sr_wildcat2", name: "Шершень", price: 2200, stRa: 2, stDi: 4, stDa: 4, ammo: 1, ammo_tot: 16 }
];

const originalReloadTimeMs = {
  ohca_basebalbat: 0,
  ohca_candy: 0,
  ohca_candy2: 0,
  hg_taurus: 2533,
  hg_usp: 2667,
  mg_assaultrifle02: 3000,
  mg_ump45vkks_o: 3000,
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
  sr_wildcat2: 2333
};

const canonicalShopWeaponStats = {
  sg_remington: {
    desc: "Хороший или плохой советчик - решать вам.",
    desca: "- Наносит периодический урон типа \"кровотечение\"",
    rap: 650,
    rt: 3864,
    lt: 900,
    vel: 100,
    rad: 18,
    ang: 0,
    dev: 30,
    krit: 10,
    ammo: 8,
    ammo_tot: 48,
    smindam: 62,
    smaxdam: 90,
    mmindam: 34,
    mmaxdam: 54,
    lmindam: 10,
    lmaxdam: 18,
    wsp: 15,
    shake: 1
  },
  rl_m202a1: {
    desc: "Карающая длань Четырех Вождей Красного Фронта.",
    desca: "Четырехзарядная ракетница",
    rap: 920,
    rt: 960,
    lt: 1200,
    vel: 60,
    rad: 30,
    ang: 0,
    dev: 7,
    krit: 3,
    ammo: 4,
    ammo_tot: 16,
    smindam: 82,
    smaxdam: 126,
    mmindam: 66,
    mmaxdam: 102,
    lmindam: 44,
    lmaxdam: 79,
    wsp: -15,
    launch: 1,
    shake: 1
  }
};

function withCanonicalShopWeaponStats(item) {
  const key = String(item?.sname || item?.sn || "").toLowerCase();
  const stats = canonicalShopWeaponStats[key] || {};
  const reloadTime = originalReloadTimeMs[key];
  return reloadTime === undefined ? { ...item, ...stats } : { ...item, ...stats, rt: reloadTime };
}

// The live weapon shop is the vetted resources.assets subset only.
const shopWeaponCatalog = rebuiltShopWeaponCatalog.map(withCanonicalShopWeaponStats);

function weaponTypeForSname(sname) {
  const prefix = sname.split("_")[0];
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
    "shake"
  ]) {
    if (item[key] !== undefined) extra[key] = item[key];
  }
  return extra;
}

const shopWeapons = shopWeaponCatalog.map((item) =>
  weapon(item.id, weaponTypeForSname(item.sname), item.slot, item.sname, item.price ?? SHOP_PRICE, shopWeaponExtra(item))
);

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

function wearTextFor(slot, sname) {
  const key = `${slot || ""}:${String(sname || "")}`;
  return wearTextOverrides[key] || {};
}

const shopWearCatalog = {
  Hats: ["hat01", "hat02", "hat03", "helm02", "cap01", "cap02", "helm01", "vietnam", "pilothelm", "budenka", "ushmil", "ushanka", "party02", "party01", "english", "indiana02", "indiana01", "indiana03", "pharaoh", "tophat", "beret01", "beret02", "beret03", "beret04", "tactichelm01", "tactichelm02", "milcap01", "milcap02", "milcap03", "Witchhat", "Jacklantern", "santa", "santa2", "Olympic", "capVKKS01", "capVKKS02", "capVKKS03", "tacticalB01", "capB04", "capB08", "hatB08", "capB06", "capB05", "infernal", "hatB01", "capB07", "capB01", "avenger", "hatB06", "biker", "business", "stalker", "ushanka2"],
  Masks: ["goog01", "goog02", "goog03", "mask01", "band01", "band02", "band03", "klava01", "klava02", "klava03", "mummy_H", "bandB08", "skeleton_H", "gasmask01", "gasmask02", "aviaglass", "santa", "santa2", "SnowGoggles", "maskB01", "bandB03", "bandB07", "googB01", "googB03", "infernal_H", "franky", "maskB02", "bandB05", "bandB01", "googB02", "avenger", "bandB04", "klavaB01", "businessgoogles", "stalkergasmask", "thanos"],
  Gloves: ["glov01", "bint01", "bint02", "clock01", "clock02", "glov02", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "Olympic", "tacticalB01", "infernal", "franky", "wristwrapB03", "avenger", "prizrak", "biker", "business", "stalker", "thanos", "glov022"],
  Shirts: ["armor01", "armor02", "armor03", "armor04", "hood01", "hood02", "hood03", "hood04", "hood05", "jack01", "singl05", "singl06", "jack02", "jack03", "shirt01", "shirt02", "shirt03", "shirt04", "singl01", "singl02", "singl03", "singl04", "shirtB08", "chood01", "chood02", "chood03", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "hoodOlimpic", "hoodZong", "tacticB01", "hoodB03", "hoodB08", "hoodB10", "shirtB09", "shirtB04", "infernal", "franky", "hoodB05", "hoodB01", "hoodB04", "anarch", "avenger", "hoodB06", "prizrak", "biker", "business", "stalker", "thanos", "trooper2"],
  Pants: ["jeans01", "jeans02", "pant01", "pant02", "pant03", "sport01", "sport02", "sport03", "sport04", "short01", "short02", "short03", "short04", "short05", "mummy", "skeleton", "trooper", "tactic01", "tactic02", "tactic03", "tactic04", "santa", "santa2", "Olympic", "sportVKKS01", "sportVKKS02", "sportVKKS03", "tacticB01", "sportB03", "sportB08", "sportB10", "shortB12", "shortB14", "infernal", "franky", "sportB05", "sportB01", "sportB04", "jeansB03", "avenger", "sportB06", "prizrak", "jeansB02", "business", "stalker", "thanos", "pant032"],
  Boots: ["boot01", "bear", "boot02", "slip01", "sneak01", "sneak02", "sneakV201", "sneakV202", "sneakV203", "mummy", "skeleton", "tactical01", "tactical02", "santa", "santa2", "sneakOlimpic", "tacticalB01", "sneakV2B05", "sneakV2B02", "sneakV2B06", "sneakV2B07", "sneakV2B03", "infernal", "franky", "sneakV2B04", "sneakV2B10", "anarch", "avenger", "zadira", "prizrak", "business", "stalker", "thanos", "slip99"],
  Backpacks: ["parr01", "back01", "back02", "guit01", "guit02", "turt01", "octopus", "arrows", "darts", "rocket01", "rocket02", "rec", "shield", "extinguisher", "sarcophagus", "tomb", "Morte", "Raven", "Scarecrow", "santa", "santa2", "Snowboard", "VampireBat", "infernalRaven", "frankyOctopus", "snake01", "thanos", "rec2"],
  Others: ["maz", "icecream01", "icecream02", "icecream03", "cola01", "cola02", "cola03", "skrab", "coins", "santa", "santa2", "medal", "medalgold", "medalsilver", "medalbronze", "smertik", "badboy", "infernal", "franky", "newyearball", "schelkunchik", "spingreen", "spinyellow", "spinblue", "burger", "teeth", "spider", "vodka"],
  Heads: ["bald01", "bald02", "black01", "black02", "black03", "black04", "blond01", "blond02", "blond03", "brown01", "brown02", "brown03", "brown04", "spec01", "spec02", "spec03", "spec04", "franky", "thanos", "spec99"]
};

const shopWears = Object.entries(shopWearCatalog).flatMap(([slot, names]) =>
  names.map((sname, index) => wear(10000 + wearSlotIds[slot] * 1000 + index + 1, wearSlotIds[slot], sname, SHOP_PRICE, slot))
);

function findWearCatalogItem(slot, sname) {
  const wt = wearSlotIds[slot];
  const item = shopWears.find((wearItem) => Number(wearItem.wt) === Number(wt) && String(wearItem.sname) === String(sname));
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

const shopAssemblages = assemblageDefinitions.map((definition) => ({
  id: definition.id,
  name: definition.name,
  desca: definition.desca,
  ndesca: definition.ndesca || "",
  items: JSON.stringify(definition.items.map(([slot, sname]) => assemblageWear(slot, sname)))
}));

const shopTaunts = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => taunt(id, SHOP_PRICE));
const shopEnhancers = [1, 2, 3, 4, 5, 10, 11, 12, 13, 30, 31, 32, 33, 34, 35, 36, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210].map((id) =>
  enhancer(id, SHOP_PRICE)
);
const canonicalWeaponsById = new Map([...defaultWeapons, ...shopWeapons].map((item) => [Number(item.w_id), item]));
const weaponSnameKey = (item) => String(item?.sn || item?.sname || "").toLowerCase();
const canonicalWeaponsBySname = new Map([...defaultWeapons, ...shopWeapons].map((item) => [weaponSnameKey(item), item]).filter(([key]) => key));
const canonicalWearsById = new Map(shopWears.map((item) => [Number(item.w_id), item]));
const canonicalTauntsById = new Map(shopTaunts.map((item) => [Number(item.t_id), item]));
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
  9: { type: "1", key: "wmxdam", values: [1, 2, 3, 4, 5] }
};

const abilityCatalog = [];
for (const [abilityIdText, definition] of Object.entries(abilityValueDefinitions)) {
  const abilityId = Number(abilityIdText);
  for (let level = 1; level <= definition.values.length; level += 1) {
    abilityCatalog.push({
      i: abilityId,
      l: level,
      v: JSON.stringify([{ t: definition.type, [definition.key]: String(definition.values[level - 1]) }]),
      sc: cost(5000 + abilityId * 10 + level, 100 * level)
    });
  }
}

const mapPlayers = "4,6,8,10,12,14,16";
const mapEntry = (id, systemName, modes = 3) => ({ i: id, n: systemName, m: modes, p: mapPlayers, dp: 4 });

const maps = [
  mapEntry(1, "Arena_3lvl"),
  mapEntry(2, "7000"),
  mapEntry(3, "ArenaRing"),
  mapEntry(4, "Arena_well"),
  mapEntry(5, "Bit_map"),
  mapEntry(6, "Cache"),
  mapEntry(7, "Dedust"),
  mapEntry(8, "Faccility"),
  mapEntry(9, "Inferno"),
  mapEntry(10, "LegoTurnament"),
  mapEntry(11, "Sniper_night"),
  mapEntry(12, "TF3_Arena_map"),
  mapEntry(13, "Zombi_2", 1),
  mapEntry(14, "Zombi")
];

function starterAccount(name = "ContraCity") {
  return {
    id: 1,
    key: DEFAULT_KEY,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function cleanName(value) {
  const name = String(value || "").trim().slice(0, 24);
  return name || "ContraCity";
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.accounts) {
      return parsed;
    }
  } catch {
    // First run on Railway has no data file yet.
  }
  return { accounts: {} };
}

function saveStore(store) {
  if (pgPool) {
    const snapshot = clone(store);
    pgSaveChain = pgSaveChain.then(() => savePostgresStore(snapshot));
    return;
  }

  ensureStoreDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
}

let pgPool = null;
let pgSaveChain = Promise.resolve();
const MANAGED_CATALOG_ITEM_TYPES = [1, 2, 3, 4];

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

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
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

  return { accounts };
}

async function initStore() {
  if (!DATABASE_URL) {
    return loadStore();
  }

  const { Pool } = await import("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
  });

  await runMigrations();
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

  return { accounts: {} };
}

async function savePostgresStore(nextStore) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");

    for (const rawAccount of Object.values(nextStore.accounts || {})) {
      const account = normalizeAccount(rawAccount);
      const createdAt = account.createdAt || new Date().toISOString();
      const updatedAt = account.updatedAt || new Date().toISOString();

      await client.query(
        `INSERT INTO players (
          id, cckey, name, full_name, level, exp, exp_min, exp_max, money,
          view, weap, taun, stats, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          cckey = EXCLUDED.cckey,
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
      for (const weaponItem of ownedWeapons) {
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
            Number(weaponItem.w_id || weaponItem.id || 0),
            Number(weaponItem.wt || 0),
            String(weaponItem.sn || weaponItem.sname || ""),
            Number(account.stats?.k || 0),
            Number(account.stats?.hs || 0),
            Number(account.stats?.ns || 0),
            Number(account.stats?.sh || 0),
            Number(account.stats?.hi || 0)
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
          [account.id, Number(achievementId), Number(progress.c || 0), Number(progress.v || 0)]
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

function normalizeInventoryItem(item) {
  const type = Number(item?.itype || 0);
  if (type === 1) {
    const canonical = canonicalWeaponForRawItem(item);
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
  for (const raw of rawInventory) {
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

function hasInventoryWear(inventory, wearId) {
  return inventory.some((item) => Number(item?.itype || 0) === 3 && inventoryWearId(item) === Number(wearId));
}

function normalizeLoadoutInventory(selection, rawInventory = []) {
  const inventory = rawInventory.map(normalizeInventoryItem);
  const weap = normalizeWeaponSelection(selection, rawInventory);

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

function normalizeAccount(account) {
  const fresh = starterAccount(account?.name);
  const rawInventory = Array.isArray(account?.inventory) ? account.inventory : [];
  const loadoutInventory = normalizeLoadoutInventory({ ...fresh.weap, ...(account?.weap || {}) }, rawInventory);
  const viewInventory = normalizeViewInventory({ ...fresh.view, ...(account?.view || {}) }, loadoutInventory.inventory);
  return {
    ...fresh,
    ...account,
    view: viewInventory.view,
    weap: loadoutInventory.weap,
    taun: { ...fresh.taun, ...(account?.taun || {}) },
    stats: { ...fresh.stats, ...(account?.stats || {}) },
    inventory: viewInventory.inventory,
    abilities: Array.isArray(account?.abilities) ? account.abilities : []
  };
}

function ensureDesktopAccount() {
  const existing = store.accounts["1"];
  const shouldCreate = !existing;
  store.accounts["1"] = normalizeAccount(existing || starterAccount(process.env.PLAYER_NAME || "ContraCity"));
  store.accounts["1"].id = 1;
  store.accounts["1"].key = DEFAULT_KEY;
  if (shouldCreate) saveStore(store);
  return store.accounts["1"];
}

function accountFrom(url) {
  const id = String(Number(url.searchParams.get("ccid") || 1));
  const key = url.searchParams.get("cckey") || DEFAULT_KEY;
  const account = store.accounts[id] ? normalizeAccount(store.accounts[id]) : null;
  if (!account || account.key !== key) {
    return ensureDesktopAccount();
  }
  store.accounts[id] = account;
  return account;
}

function persist(account) {
  account.updatedAt = new Date().toISOString();
  store.accounts[String(account.id)] = normalizeAccount(account);
  saveStore(store);
}

async function accountFromRequest(url) {
  const id = String(Number(url.searchParams.get("ccid") || 1));
  const key = url.searchParams.get("cckey") || DEFAULT_KEY;
  const cached = store.accounts[id] ? normalizeAccount(store.accounts[id]) : null;
  if (cached && cached.key === key) {
    store.accounts[id] = cached;
    return refreshAccountFromPostgres(cached);
  }

  if (pgPool) {
    try {
      await pgSaveChain.catch(() => {});
      const fresh = await loadPostgresAccount(id);
      if (fresh && fresh.key === key) {
        store.accounts[id] = fresh;
        return fresh;
      }
    } catch (error) {
      console.error("[postgres] account lookup failed", error);
    }
  }

  return refreshAccountFromPostgres(accountFrom(url));
}

function postgresTimestamp(value) {
  return value?.toISOString?.() || value;
}

function accountFromPostgresRow(row, inventory = [], abilities = []) {
  return normalizeAccount({
    id: Number(row.id),
    key: row.cckey,
    name: row.name,
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

  return accountFromPostgresRow(
    row,
    inventory.rows.map((itemRow) => jsonValue(itemRow.item_data, {})),
    abilities.rows.map((abilityRow) => ({ i: Number(abilityRow.ability_id), l: Number(abilityRow.ability_level) }))
  );
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

function sessionAuth(account) {
  return `ccid=${account.id}&cckey=${account.key}&`;
}

function loginLink(account) {
  return `${PUBLIC_BASE_URL}/vk-login?${sessionAuth(account)}`;
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

function profilePayload(account, full = false) {
  const payload = {
    result: true,
    info: {
      u_id: account.id,
      un: account.name,
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
      }
    }
  };

  if (full) {
    payload.view = clone(account.view);
    payload.weap = clone(account.weap);
    payload.taun = clone(account.taun);
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
      items: JSON.stringify(account.inventory || []),
      dw: clone(defaultWeapons)
    }
  };
}

function shopPayload() {
  return {
    result: true,
    weap: {
      upg: [],
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

function abilitiesPayload(account) {
  return {
    result: true,
    b: clone(abilityCatalog),
    u: clone(account.abilities || [])
  };
}

function mapsPayload() {
  const battleServers = BATTLE_HOST
    ? [
        { h: BATTLE_HOST, p: process.env.BATTLE_PORTS || "5055,5056,5057,5255", n: BATTLE_NAME, pL: "100", lM: "0", lMa: "100", m: "0" }
      ]
    : [];
  const gameMasters = BATTLE_HOST
    ? [
        { h: BATTLE_HOST, p: process.env.GAME_MASTER_PORT || "5058", n: BATTLE_NAME, pL: "100", lM: "0", lMa: "100", m: "1", iD: "1" }
      ]
    : [];

  return {
    result: true,
    s: battleServers,
    gm: gameMasters,
    b: clone(maps)
  };
}

const achievementBase = [
  { id: 1, i: 1, v: 10, r: 25, ul: 1 },
  { id: 2, i: 2, v: 25, r: 50, ul: 1 },
  { id: 3, i: 3, v: 50, r: 75, ul: 1 },
  { id: 4, i: 4, v: 5, r: 50, ul: 1 },
  { id: 5, i: 5, v: 10, r: 100, ul: 1 },
  { id: 6, i: 6, v: 15, r: 100, ul: 1 },
  { id: 7, i: 7, v: 3, r: 75, ul: 1 },
  { id: 8, i: 8, v: 7, r: 125, ul: 1 }
];

function achievementProgressFor(account) {
  const stats = playerStats(account);
  const values = {
    1: stats.k,
    2: stats.k,
    3: stats.k,
    4: stats.hs,
    5: stats.w,
    6: stats.pt,
    7: (account.inventory || []).filter((item) => Number(item.itype) === 1).length,
    8: (account.inventory || []).filter((item) => Number(item.itype) === 3).length
  };
  return Object.fromEntries(
    achievementBase.map((achievement) => [
      String(achievement.id),
      {
        c: Math.max(0, Number(values[achievement.id] || 0)),
        v: Number(values[achievement.id] || 0) >= Number(achievement.v || 0) ? 1 : 0
      }
    ])
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

function leaguePayload(account) {
  const stats = playerStats(account);
  const me = {
    id: account.id,
    name: account.name,
    lvl: account.level,
    exp: account.exp,
    kill: stats.k,
    death: stats.d,
    h: stats.hs,
    f: 0,
    p: 0,
    do: stats.do,
    nu: stats.ns,
    a: 0
  };
  const ls = {};
  for (let i = 1; i <= 15; i += 1) {
    ls[String(i)] = [(i - 1) * 10000, i * 10000];
  }
  return {
    result: true,
    u: me,
    ls,
    ...Object.fromEntries(Array.from({ length: 15 }, (_, idx) => [`l${idx + 1}`, idx === 0 ? [me] : []]))
  };
}

function playerStats(account) {
  return {
    k: Number(account.stats?.k || 1),
    d: Number(account.stats?.d || 0),
    s: Number(account.stats?.s || 0),
    hs: Number(account.stats?.hs || 1),
    ns: Number(account.stats?.ns || 0),
    pt: Number(account.stats?.pt || 12),
    w: Number(account.stats?.w || 1),
    l: Number(account.stats?.l || 0),
    dhs: Number(account.stats?.dhs || 0),
    dns: Number(account.stats?.dns || 0),
    do: Number(account.stats?.do || 0),
    re: Number(account.stats?.re || 0),
    mdo: Number(account.stats?.mdo || 0),
    mre: Number(account.stats?.mre || 0),
    sh: Number(account.stats?.sh || 25),
    hi: Number(account.stats?.hi || 9)
  };
}

function weaponStatItems(account) {
  const owned = [...defaultWeapons, ...(account.inventory || []).filter((item) => Number(item.itype) === 1)];
  const seen = new Set();
  return owned
    .filter((item) => {
      const key = Number(item.w_id || item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => ({
      wid: Number(item.w_id || item.id),
      wt: Number(item.wt || 0),
      sn: item.sn || item.sname || `weapon_${item.w_id || item.id}`,
      k: index === 0 ? 1 : 0,
      hs: index === 0 ? 1 : 0,
      ns: 0,
      sh: index === 0 ? 25 : 0,
      hi: index === 0 ? 9 : 0
    }));
}

function gameModeStatItems() {
  return [
    { m: 1, w: 1, l: 0, pt: 12 },
    { m: 2, w: 0, l: 0, pt: 0 },
    { m: 3, w: 0, l: 0, pt: 0 }
  ];
}

function mapStatItems() {
  return maps.map((map, index) => ({
    n: map.n,
    w: index === 0 ? 1 : 0,
    l: 0,
    pt: index === 0 ? 12 : 0
  }));
}

function statsBlock(account) {
  return {
    wd: JSON.stringify(weaponStatItems(account)),
    ud: JSON.stringify(playerStats(account)),
    md: JSON.stringify(gameModeStatItems()),
    mad: JSON.stringify(mapStatItems())
  };
}

function advancedStatsPayload(account) {
  return {
    ...profilePayload(account, true),
    sA: statsBlock(account),
    vk: "0"
  };
}

function ratingUser(account, pos = 1, overrides = {}) {
  const stats = playerStats(account);
  const death = Number(overrides.death ?? stats.d);
  const kill = Number(overrides.kill ?? stats.k);
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
    kd: death > 0 ? Number((kill / death).toFixed(2)) : kill,
    h: Number(overrides.h ?? stats.hs),
    f: Number(overrides.f ?? 0),
    p: Number(overrides.p ?? 0),
    do: Number(overrides.do ?? stats.do),
    nu: Number(overrides.nu ?? stats.ns),
    a: Number(overrides.a ?? 0),
    ach: Number(overrides.ach ?? 0),
    ptime: Number(overrides.ptime ?? stats.pt)
  };
}

function ratingPayload(account) {
  const users = Object.values(store.accounts || {})
    .map((raw) => normalizeAccount(raw))
    .sort((a, b) => Number(b.exp || 0) - Number(a.exp || 0) || Number(playerStats(b).k || 0) - Number(playerStats(a).k || 0) || Number(a.id) - Number(b.id))
    .slice(0, 100)
    .map((ratedAccount, index) => ratingUser(ratedAccount, index + 1));
  if (!users.some((user) => Number(user.id) === Number(account.id))) {
    users.unshift(ratingUser(account, 1));
  }

  return {
    result: true,
    users,
    musers: String(users.length),
    uinfo: users[0]
  };
}

function yesterdayBestPayload(account) {
  return {
    result: true,
    yb: [
      { id: account.id, name: account.name, lvl: account.level, exp: account.exp, kill: 1, h: 1, f: 0, p: 0, do: 0, nu: 0, a: 0 }
    ]
  };
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

function buyItem(account, item) {
  if (!item) return { result: false, err: [1] };
  const price = itemPrice(item);
  if (account.money < price) return { result: false, err: [2] };
  if (!hasInventoryItem(account, item)) {
    account.inventory.push(clone(item));
  }
  account.money -= price;
  recordPurchase(account, item, price);
  persist(account);
  return ok({ req: "" });
}

function saveView(account, url) {
  for (const key of viewWearKeys) {
    if (url.searchParams.has(key)) account.view[key] = Number(url.searchParams.get(key) || 0);
  }
  persist(account);
  return ok();
}

function saveWeapons(account, url) {
  for (let i = 1; i <= 7; i += 1) {
    if (url.searchParams.has(`i${i}`)) account.weap[`id${i}`] = Number(url.searchParams.get(`i${i}`) || 0);
  }
  const normalized = normalizeLoadoutInventory(account.weap, account.inventory || []);
  account.weap = normalized.weap;
  account.inventory = normalized.inventory;
  persist(account);
  return ok();
}

function saveTaunts(account, url) {
  for (let i = 1; i <= 3; i += 1) {
    if (url.searchParams.has(`i${i}`)) account.taun[`i${i - 1}`] = Number(url.searchParams.get(`i${i}`) || 0);
  }
  persist(account);
  return ok();
}

function changeName(account, url) {
  const setRequested = url.searchParams.get("set") === "1" || url.searchParams.get("action") === "cpname";
  const name = cleanName(
    url.searchParams.get("ve") ||
    url.searchParams.get("v") ||
    url.searchParams.get("name") ||
    url.searchParams.get("un") ||
    account.name
  );
  if (url.searchParams.get("action") === "searcname") {
    return ok({ names: [] });
  }
  if (!setRequested && url.searchParams.get("action") === "cname") {
    return ok({ names: [] });
  }
  account.name = name;
  persist(account);
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

function buyAbility(account, url) {
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

async function routeAjax(url, resolvedAccount = null) {
  let page = url.searchParams.get("page") || "";
  let act = url.searchParams.get("act") || url.searchParams.get("action") || "";
  let account = resolvedAccount || accountFrom(url);
  if (!resolvedAccount) account = await refreshAccountFromPostgres(account);

  if (page === "sh") page = "shop";
  if (page === "ch") page = "pl";
  const actAliases = {
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
  act = actAliases[act] || act;

  if (page === "auth" && act === "g") {
    return ok({ user_id: String(account.id), key: account.key });
  }

  if (page === "account") {
    if (act === "login") return ok({ auth: { id: account.id, key: account.key } });
    if (act === "cname" || act === "cpname" || act === "searcname") return changeName(account, url);
  }

  if (page === "pl") {
    if (act === "i") {
      return advancedStatsPayload(account);
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
    if (act === "items") return shopPayload();
    if (act === "assemb") return ok({ assemblage: clone(shopAssemblages) });
    if (["wear", "weap", "weapinf", "act"].includes(act)) return shopPayload();
  }

  if (page === "buy") {
    const id = Number(url.searchParams.get("id") || url.searchParams.get("i") || 0);
    if (act === "bweap") return buyItem(account, findShopItem(shopWeapons, "w_id", id));
    if (act === "bwear") return buyItem(account, findShopItem(shopWears, "w_id", id));
    if (act === "btaunt") return buyItem(account, findShopItem(shopTaunts, "t_id", id));
    if (act === "benh") return buyItem(account, findShopItem(shopEnhancers, "e_id", id));
    if (act === "babil") return buyAbility(account, url);
    if (act === "bmap") return ok({ req: "" });
    return ok({ req: "" });
  }

  if (page === "stats") {
    if (act === "league") return leaguePayload(account);
    if (act === "ybest") return yesterdayBestPayload(account);
    if (act === "rat") return ratingPayload(account);
    if (act === "reset") return ok({ req: "" });
  }

  if (page === "clan") {
    return ok({ items: [], m: [], inv: [], ev: [] });
  }

  return ok();
}

function sendJson(res, payload, status = 200, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...headers
  });
  res.end(body);
}

function sendHtml(res, html, status = 200, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(html);
}

function createPage(url) {
  const code = url.searchParams.get("code") || "";
  const name = cleanName(url.searchParams.get("name") || "");
  if (code && code !== CREATE_CODE) {
    return {
      status: 403,
      html: "<h1>Код неверный</h1><p>Проверьте код создания аккаунта.</p>"
    };
  }

  if (code === CREATE_CODE && name) {
    const account = starterAccount(name);
    store.accounts["1"] = account;
    saveStore(store);
    return {
      status: 200,
      html: `<h1>Аккаунт создан</h1>
<p>Ник: <b>${escapeHtml(account.name)}</b></p>
<p>Старт: уровень ${account.level}, монеты ${account.money}, опыт ${account.exp}</p>
<p>Сессия клиента: <code>ccid=${account.id}&cckey=${account.key}&</code></p>
<p>Перезапустите игру, чтобы клиент забрал новые данные.</p>`
    };
  }

  return {
    status: 200,
    html: `<h1>Создание аккаунта Contra City</h1>
<form method="GET" action="/create">
  <label>Код<br><input name="code" value="${escapeHtml(code)}" style="width:320px"></label><br><br>
  <label>Ваш ник<br><input name="name" value="ContraCity" maxlength="24" style="width:320px"></label><br><br>
  <button type="submit">Создать аккаунт</button>
</form>`
  };
}

function createPageV2(url) {
  const code = url.searchParams.get("code") || "";
  const name = cleanName(url.searchParams.get("name") || "");
  if (code && code !== CREATE_CODE) {
    return {
      status: 403,
      html: "<h1>Код неверный</h1><p>Проверьте код создания аккаунта.</p>"
    };
  }

  if (code === CREATE_CODE && name) {
    const account = starterAccount(name);
    store.accounts["1"] = account;
    saveStore(store);
    const link = loginLink(account);
    return {
      status: 200,
      html: `<h1>Аккаунт создан</h1>
<p>Ник: <b>${escapeHtml(account.name)}</b></p>
<p>Старт: уровень ${account.level}, монеты ${account.money}, опыт ${account.exp}</p>
<p>Ссылка для входа:</p>
<p><code>${escapeHtml(link)}</code></p>
<p>В клиенте откройте "Вход через полные ссылки" или "Вход через вр.ссылки", вставьте эту ссылку и нажмите "Войти".</p>`
    };
  }

  return {
    status: 200,
    html: `<h1>Создание аккаунта Contra City</h1>
<form method="GET" action="/create">
  <label>Код<br><input name="code" value="${escapeHtml(code)}" style="width:320px"></label><br><br>
  <label>Ник<br><input name="name" value="ContraCity" maxlength="24" style="width:320px"></label><br><br>
  <button type="submit">Создать аккаунт</button>
</form>`
  };
}

function createPageV3(url) {
  const code = url.searchParams.get("code") || "";
  const name = cleanName(url.searchParams.get("name") || "");
  if (code && code !== CREATE_CODE) {
    return {
      status: 403,
      html: "<h1>\u041a\u043e\u0434 \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u0439</h1><p>\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043a\u043e\u0434 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430.</p>"
    };
  }

  if (code === CREATE_CODE && name) {
    const account = starterAccount(name);
    store.accounts["1"] = account;
    saveStore(store);
    const link = loginLink(account);
    return {
      status: 200,
      html: `<h1>\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0441\u043e\u0437\u0434\u0430\u043d</h1>
<p>\u041d\u0438\u043a: <b>${escapeHtml(account.name)}</b></p>
<p>\u0421\u0442\u0430\u0440\u0442: \u0443\u0440\u043e\u0432\u0435\u043d\u044c ${account.level}, \u043c\u043e\u043d\u0435\u0442\u044b ${account.money}, \u043e\u043f\u044b\u0442 ${account.exp}</p>
<p>\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0430:</p>
<p><code>${escapeHtml(link)}</code></p>
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

  const filePath = path.join(ASSET_BUNDLE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    sendJson(res, { ok: false, error: "asset_bundle_not_found", file: fileName }, 404);
    return true;
  }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": "public, max-age=31536000, immutable"
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function safeJoin(baseDir, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    return null;
  }

  const base = path.resolve(baseDir);
  const fullPath = path.resolve(base, normalized);
  if (fullPath !== base && !fullPath.startsWith(base + path.sep)) {
    return null;
  }

  return fullPath;
}

function tryServeLauncherUpdate(req, res, url) {
  const pathname = decodeURIComponent(url.pathname || "/");
  if (pathname === "/launcher/manifest.json") {
    if (!fs.existsSync(LAUNCHER_MANIFEST_PATH)) {
      sendJson(res, { ok: false, error: "launcher_manifest_not_found" }, 404);
      return true;
    }

    const stat = fs.statSync(LAUNCHER_MANIFEST_PATH);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(stat.size),
      "cache-control": "no-cache"
    });
    fs.createReadStream(LAUNCHER_MANIFEST_PATH).pipe(res);
    return true;
  }

  if (!pathname.startsWith("/launcher/files/")) {
    return false;
  }

  const relativePath = pathname.slice("/launcher/files/".length);
  const filePath = safeJoin(LAUNCHER_UPDATE_DIR, relativePath);
  if (!filePath) {
    sendJson(res, { ok: false, error: "invalid_update_path" }, 400);
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, { ok: false, error: "update_file_not_found", file: relativePath }, 404);
    return true;
  }

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(stat.size),
    "cache-control": "public, max-age=3600"
  });
  fs.createReadStream(filePath).pipe(res);
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

function asBattleJson(value) {
  if (value && typeof value === "object") return value;
  return {};
}

async function recordBattleEvent(event) {
  if (BATTLE_EVENT_TOKEN && event.token !== BATTLE_EVENT_TOKEN) {
    return { ok: false, error: "invalid_token", status: 403 };
  }

  const account = ensureDesktopAccount();
  if (!pgPool) {
    return { ok: true, storage: "json-file", skipped: "postgres_disabled" };
  }

  const roomName = String(event.roomName || event.room || "restore-room").slice(0, 80);
  const mapName = String(event.mapName || event.map || "Arena_3lvl").slice(0, 80);
  const mode = Number(event.mode || 2);
  const maxPlayers = Number(event.maxPlayers || 8);
  const playerId = Number(event.playerId || account.id || 1);
  const actorId = Number(event.actorId || 1);
  const team = Number(event.team ?? -1);
  const health = Number(event.health ?? 100);
  const energy = Number(event.energy ?? 100);
  const serverHost = String(event.serverHost || BATTLE_HOST || "").slice(0, 128);
  const serverPort = Number(event.serverPort || 5055);
  const roomSettings = JSON.stringify(asBattleJson(event.roomSettings));
  const playerData = JSON.stringify(asBattleJson(event.playerData));
  const transform = JSON.stringify(asBattleJson(event.transform));
  const eventData = JSON.stringify(asBattleJson(event.eventData));
  const type = String(event.type || "event");

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO players (id, cckey, name, full_name, level, exp, exp_min, exp_max, money, view, weap, taun, stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [account.id, account.key, account.name, account.fullName || account.name, account.level, account.exp, account.expMin, account.expMax, account.money]
    );

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
    } else if (type === "score") {
      await client.query(
        `INSERT INTO battle_score_events (room_id, killer_player_id, victim_player_id, weapon_id, hit_zone, event_data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [roomId, Number(event.killerPlayerId || playerId), Number(event.victimPlayerId || playerId), Number(event.weaponId || 0), Number(event.hitZone || 0), eventData]
      );
    } else if (type === "chat" && event.message) {
      await client.query(
        `INSERT INTO battle_chat_events (room_id, player_id, actor_id, channel, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [roomId, playerId, actorId, Number(event.channel || 0), String(event.message).slice(0, 500)]
      );
    }

    await client.query("COMMIT");
    return { ok: true, storage: "postgres", roomId, type };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

ensureDesktopAccount();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (tryServeLauncherUpdate(req, res, url)) {
    return;
  }

  if (tryServeAssetBundle(req, res, url)) {
    return;
  }

  if (url.pathname === "/" || url.pathname === "/auth") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    const link = loginLink(account);
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

  if (url.pathname === "/session") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    sendJson(res, {
      ccid: account.id,
      cckey: account.key,
      sessionAuth: sessionAuth(account),
      loginLink: loginLink(account),
      storage: pgPool ? "postgres" : "json-file"
    });
    return;
  }

  if (url.pathname === "/vk-login" || url.pathname === "/login-link") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    sendHtml(
      res,
      `<h1>Contra City login</h1><p>Ссылка активна для ${escapeHtml(account.name)}.</p>`,
      200,
      { "Set-Cookie": cookieHeaders(account) }
    );
    return;
  }

  if (url.pathname.endsWith("/ajax.php")) {
    const account = await accountFromRequest(url);
    sendJson(res, await routeAjax(url, account), 200, { "Set-Cookie": cookieHeaders(account) });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, { ok: true, storage: pgPool ? "postgres" : "json-file" });
    return;
  }

  if (url.pathname === "/battle/event") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "method_not_allowed" }, 405);
      return;
    }
    try {
      const body = await readJsonBody(req);
      const result = await recordBattleEvent(body);
      sendJson(res, result, result.status || (result.ok === false ? 400 : 200));
    } catch (error) {
      sendJson(res, { ok: false, error: error.message || "battle_event_failed" }, 500);
    }
    return;
  }

  if (url.pathname === "/db") {
    sendJson(res, {
      ok: true,
      storage: pgPool ? "postgres" : "json-file",
      schema: pgPool
        ? "players/player_inventory/player_abilities/player_equipment/purchase_history/player_weapon_stats/player_achievements/player_match_stats/clans/clan_members/player_friends/catalog_items/battle_rooms/battle_room_players/battle_spawn_events/battle_score_events/battle_chat_events"
        : "accounts-json",
      accounts: Object.keys(store.accounts).length,
      databaseUrlConfigured: Boolean(DATABASE_URL)
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/auth") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    sendHtml(
      res,
      `<h1>Contra City legacy API</h1>
<p>API работает.</p>
<p>Создать/сбросить аккаунт: <a href="/create?code=${encodeURIComponent(CREATE_CODE)}">/create</a></p>
<p>Текущий аккаунт: ${escapeHtml(account.name)}, уровень ${account.level}, монеты ${account.money}</p>`
    );
    return;
  }

  if (url.pathname === "/create") {
    const result = createPageV3(url);
    sendHtml(res, result.html, result.status);
    return;
  }

  if (url.pathname === "/session") {
    const account = await refreshAccountFromPostgres(ensureDesktopAccount());
    sendJson(res, { ccid: account.id, cckey: account.key, sessionAuth: `ccid=${account.id}&cckey=${account.key}&` });
    return;
  }

  if (url.pathname.endsWith("/ajax.php")) {
    sendJson(res, await routeAjax(url));
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, { ok: true });
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Contra City legacy API listening on ${PORT}`);
});
