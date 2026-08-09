import crypto from "node:crypto";

export const SUMMER_CASE_LEGENDARY_MIN_BPS = 100;
export const SUMMER_CASE_LEGENDARY_MAX_BPS = 500;
export const SUMMER_CASE_EPIC_BPS = 1700;
export const TROPICAL_CASE_BUNDLE_BPS = 500;
export const TROPICAL_CASE_20_BPS = 10;
export const TROPICAL_CASE_LEGENDARY_MIN_BPS = 100;
export const TROPICAL_CASE_LEGENDARY_MAX_BPS = 500;
export const TROPICAL_CASE_EPIC_BPS = 1700;

export const SUMMER_CASE_REWARDS = Object.freeze([
  Object.freeze({
    key: "hawaiian_hat",
    name: "ГАВАЙСКАЯ КЕПКА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Hats", sname: "capgavaimag" })
  }),
  Object.freeze({
    key: "hawaiian_mask",
    name: "ГАВАЙСКАЯ БАНДАНА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Masks", sname: "gavaibandana" })
  }),
  Object.freeze({
    key: "hawaiian_shirt",
    name: "ГАВАЙСКАЯ ТОЛСТОВКА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Shirts", sname: "gavaihoodie" })
  }),
  Object.freeze({
    key: "hawaiian_pants",
    name: "ГАВАЙСКИЕ ШОРТЫ",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Pants", sname: "shortigavai" })
  }),
  Object.freeze({
    key: "hawaiian_gloves",
    name: "ГАВАЙСКИЕ ПЕРЧАТКИ",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Gloves", sname: "gavaigloves" })
  }),
  Object.freeze({
    key: "hawaiian_boots",
    name: "ГАВАЙСКИЕ ТАПОЧКИ",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Boots", sname: "gavaibootsmag" })
  }),
  Object.freeze({
    key: "hawaiian_backpack",
    name: "ПОПУГАЙ АЛОХА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Backpacks", sname: "popugagavai" })
  }),
  Object.freeze({
    key: "advisor",
    name: "ДРОБОВИК «СОВЕТНИК»",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "weapon", id: 109 })
  }),
  Object.freeze({
    key: "summer_cases_20",
    name: "20 КЕЙСОВ ЛЕТА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "case_stock", caseKind: "summer", amount: 20 })
  }),
  Object.freeze({
    key: "summer_cases_10",
    name: "10 КЕЙСОВ ЛЕТА",
    rarity: "legendary",
    weight: 1,
    grant: Object.freeze({ kind: "case_stock", caseKind: "summer", amount: 10 })
  }),
  Object.freeze({
    key: "nonfreezer",
    name: "ТОРС «НЕМЕРЗЛЯК»",
    rarity: "epic",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Shirts", sname: "singl01" })
  }),
  Object.freeze({
    key: "azure",
    name: "ТОРС «ЛАЗУРЬ»",
    rarity: "epic",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Shirts", sname: "shirtB08" })
  }),
  Object.freeze({
    key: "flip_flops",
    name: "БОТИНКИ «ШЛЕПАНЫ»",
    rarity: "epic",
    weight: 1,
    grant: Object.freeze({ kind: "wear", slot: "Boots", sname: "slip99" })
  }),
  Object.freeze({
    key: "skif",
    name: "ПИСТОЛЕТ «СКИФ»",
    rarity: "epic",
    weight: 1,
    grant: Object.freeze({ kind: "weapon", id: 105 })
  }),
  Object.freeze({
    key: "special_fragments_50",
    name: "50 ОСКОЛКОВ ОСОБОГО КЕЙСА",
    rarity: "common",
    weight: 1,
    grant: Object.freeze({ kind: "special_fragments", amount: 50 })
  }),
  Object.freeze({
    key: "special_fragments_5",
    name: "5 ОСКОЛКОВ ОСОБОГО КЕЙСА",
    rarity: "common",
    weight: 18,
    grant: Object.freeze({ kind: "special_fragments", amount: 5 })
  }),
  Object.freeze({
    key: "coins_500",
    name: "500 КОНТРАБАКСОВ",
    rarity: "common",
    weight: 30,
    grant: Object.freeze({ kind: "coins", amount: 500 })
  }),
  Object.freeze({
    key: "coins_1000",
    name: "1 000 КОНТРАБАКСОВ",
    rarity: "common",
    weight: 12,
    grant: Object.freeze({ kind: "coins", amount: 1000 })
  }),
  Object.freeze({
    key: "coins_2500",
    name: "2 500 КОНТРАБАКСОВ",
    rarity: "common",
    weight: 3,
    grant: Object.freeze({ kind: "coins", amount: 2500 })
  }),
  Object.freeze({
    key: "xp_500",
    name: "500 ОПЫТА",
    rarity: "common",
    weight: 30,
    grant: Object.freeze({ kind: "experience", amount: 500 })
  }),
  Object.freeze({
    key: "xp_1000",
    name: "1 000 ОПЫТА",
    rarity: "common",
    weight: 12,
    grant: Object.freeze({ kind: "experience", amount: 1000 })
  }),
  Object.freeze({
    key: "xp_2500",
    name: "2 500 ОПЫТА",
    rarity: "common",
    weight: 3,
    grant: Object.freeze({ kind: "experience", amount: 2500 })
  })
]);

const tropicalSpyBundleItems = Object.freeze([
  Object.freeze({ kind: "wear", slot: "Hats", sname: "business" }),
  Object.freeze({ kind: "wear", slot: "Masks", sname: "businessgoogles" }),
  Object.freeze({ kind: "wear", slot: "Shirts", sname: "business" }),
  Object.freeze({ kind: "wear", slot: "Pants", sname: "business" }),
  Object.freeze({ kind: "wear", slot: "Gloves", sname: "business" }),
  Object.freeze({ kind: "wear", slot: "Boots", sname: "business" }),
  Object.freeze({ kind: "weapon", id: 80 }),
  Object.freeze({ kind: "weapon", id: 105 }),
  Object.freeze({ kind: "weapon", id: 75 })
]);

export const TROPICAL_CASE_REWARDS = Object.freeze([
  Object.freeze({
    key: "tropical_spy_strike_pack",
    name: "НАБОР «ШПИОНСКИЙ УДАР»",
    rarity: "bundle",
    weight: 1,
    grant: Object.freeze({ kind: "bundle", items: tropicalSpyBundleItems })
  }),
  Object.freeze({ key: "tropical_cases_20", name: "20 ТРОПИЧЕСКИХ КЕЙСОВ", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "case_stock", caseKind: "tropical", amount: 20 }) }),
  Object.freeze({ key: "tropical_cases_5", name: "5 ТРОПИЧЕСКИХ КЕЙСОВ", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "case_stock", caseKind: "tropical", amount: 5 }) }),
  Object.freeze({ key: "tropical_rebel", name: "АВТОМАТ «ПОВСТАНЕЦ»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 80 }) }),
  Object.freeze({ key: "tropical_cobra", name: "АВТОМАТ «КОБРА»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 79 }) }),
  Object.freeze({ key: "tropical_lawyer", name: "АВТОМАТ «АДВОКАТ»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 101 }) }),
  Object.freeze({ key: "tropical_bastion", name: "ПУЛЕМЁТ «БАСТИОН»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 110 }) }),
  Object.freeze({ key: "tropical_advisor", name: "ДРОБОВИК «СОВЕТНИК»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 109 }) }),
  Object.freeze({ key: "tropical_grumbler", name: "ГРАНАТОМЁТ «ВОРЧУН»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 104 }) }),
  Object.freeze({ key: "tropical_skif", name: "ПИСТОЛЕТ «СКИФ»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 105 }) }),
  Object.freeze({ key: "tropical_executioner", name: "ПИСТОЛЕТ «ПАЛАЧ»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 108 }) }),
  Object.freeze({ key: "tropical_anaconda", name: "СНАЙПЕРСКАЯ ВИНТОВКА «АНАКОНДА»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 103 }) }),
  Object.freeze({ key: "tropical_hornet", name: "СНАЙПЕРСКАЯ ВИНТОВКА «ШЕРШЕНЬ»", rarity: "legendary", weight: 1, grant: Object.freeze({ kind: "weapon", id: 75 }) }),
  Object.freeze({ key: "tropical_spy_hat", name: "ШЛЯПА ДОНА КОРЛЕОНЕ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Hats", sname: "business" }) }),
  Object.freeze({ key: "tropical_spy_mask", name: "ОЧКИ «СКАЙФОЛЫ»", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Masks", sname: "businessgoogles" }) }),
  Object.freeze({ key: "tropical_spy_shirt", name: "СМОКИНГОВСКИЙ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Shirts", sname: "business" }) }),
  Object.freeze({ key: "tropical_spy_pants", name: "БОНДОБРЮКИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Pants", sname: "business" }) }),
  Object.freeze({ key: "tropical_spy_gloves", name: "ПЕРЧАТКИ ГУДИНИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Gloves", sname: "business" }) }),
  Object.freeze({ key: "tropical_spy_boots", name: "ПОДПОЛЬНИКИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Boots", sname: "business" }) }),
  Object.freeze({ key: "tropical_stalker_hat", name: "КАПЮШОНКА", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Hats", sname: "stalker" }) }),
  Object.freeze({ key: "tropical_stalker_mask", name: "ПРОТИВОГАЗ «АНТИРАД»", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Masks", sname: "stalkergasmask" }) }),
  Object.freeze({ key: "tropical_stalker_shirt", name: "РАЗРУШИТЕЛЬ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Shirts", sname: "stalker" }) }),
  Object.freeze({ key: "tropical_stalker_pants", name: "МИЛИТАРНИКИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Pants", sname: "stalker" }) }),
  Object.freeze({ key: "tropical_stalker_gloves", name: "НИТРИЛОВЫЕ ПЕРЧИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Gloves", sname: "stalker" }) }),
  Object.freeze({ key: "tropical_stalker_boots", name: "СТРАННИКИ", rarity: "epic", weight: 1, grant: Object.freeze({ kind: "wear", slot: "Boots", sname: "stalker" }) }),
  Object.freeze({ key: "tropical_special_fragments_50", name: "50 ОСКОЛКОВ ОСОБОГО КЕЙСА", rarity: "common", weight: 1, grant: Object.freeze({ kind: "special_fragments", amount: 50 }) }),
  Object.freeze({ key: "tropical_special_fragments_5", name: "5 ОСКОЛКОВ ОСОБОГО КЕЙСА", rarity: "common", weight: 18, grant: Object.freeze({ kind: "special_fragments", amount: 5 }) }),
  Object.freeze({ key: "tropical_coins_1500", name: "1 500 КОНТРАБАКСОВ", rarity: "common", weight: 30, grant: Object.freeze({ kind: "coins", amount: 1500 }) }),
  Object.freeze({ key: "tropical_coins_3000", name: "3 000 КОНТРАБАКСОВ", rarity: "common", weight: 14, grant: Object.freeze({ kind: "coins", amount: 3000 }) }),
  Object.freeze({ key: "tropical_coins_5000", name: "5 000 КОНТРАБАКСОВ", rarity: "common", weight: 6, grant: Object.freeze({ kind: "coins", amount: 5000 }) }),
  Object.freeze({ key: "tropical_xp_1500", name: "1 500 ОПЫТА", rarity: "common", weight: 30, grant: Object.freeze({ kind: "experience", amount: 1500 }) }),
  Object.freeze({ key: "tropical_xp_3000", name: "3 000 ОПЫТА", rarity: "common", weight: 14, grant: Object.freeze({ kind: "experience", amount: 3000 }) }),
  Object.freeze({ key: "tropical_xp_5000", name: "5 000 ОПЫТА", rarity: "common", weight: 6, grant: Object.freeze({ kind: "experience", amount: 5000 }) })
]);

export function summerCaseRewardByKey(key) {
  return SUMMER_CASE_REWARDS.find((reward) => reward.key === String(key || "")) || null;
}

export function tropicalCaseRewardByKey(key) {
  return TROPICAL_CASE_REWARDS.find((reward) => reward.key === String(key || "")) || null;
}

function weightedPick(rewards, randomInt) {
  const totalWeight = rewards.reduce(
    (sum, reward) => sum + Math.max(1, Number(reward.weight || 1)),
    0
  );
  let roll = randomInt(0, totalWeight);
  for (const reward of rewards) {
    roll -= Math.max(1, Number(reward.weight || 1));
    if (roll < 0) return reward;
  }
  return rewards[rewards.length - 1];
}

export function rollSummerCaseReward(options = {}) {
  const randomInt = options.randomInt || crypto.randomInt;
  const isAvailable = options.isAvailable || (() => true);
  const legendaryChanceBasisPoints = randomInt(
    SUMMER_CASE_LEGENDARY_MIN_BPS,
    SUMMER_CASE_LEGENDARY_MAX_BPS + 1
  );
  const rarityRoll = randomInt(0, 10000);
  let rarity = "common";
  if (rarityRoll < legendaryChanceBasisPoints) {
    rarity = "legendary";
  } else if (rarityRoll < legendaryChanceBasisPoints + SUMMER_CASE_EPIC_BPS) {
    rarity = "epic";
  }

  let candidates = SUMMER_CASE_REWARDS.filter(
    (reward) => reward.rarity === rarity && isAvailable(reward)
  );
  if (!candidates.length) {
    rarity = "common";
    candidates = SUMMER_CASE_REWARDS.filter(
      (reward) => reward.rarity === "common"
    );
  }

  return {
    reward: weightedPick(candidates, randomInt),
    legendaryChanceBasisPoints
  };
}

export function rollTropicalCaseReward(options = {}) {
  const randomInt = options.randomInt || crypto.randomInt;
  const isAvailable = options.isAvailable || (() => true);
  const legendaryChanceBasisPoints = randomInt(
    TROPICAL_CASE_LEGENDARY_MIN_BPS,
    TROPICAL_CASE_LEGENDARY_MAX_BPS + 1
  );
  const tierRoll = randomInt(0, 10000);
  let candidates;
  let selectedTierChanceBasisPoints;
  if (tierRoll < TROPICAL_CASE_20_BPS) {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.key === "tropical_cases_20" && isAvailable(reward)
    );
    selectedTierChanceBasisPoints = TROPICAL_CASE_20_BPS;
  } else if (tierRoll < TROPICAL_CASE_20_BPS + TROPICAL_CASE_BUNDLE_BPS) {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.rarity === "bundle" && isAvailable(reward)
    );
    selectedTierChanceBasisPoints = TROPICAL_CASE_BUNDLE_BPS;
  } else if (tierRoll < TROPICAL_CASE_20_BPS + TROPICAL_CASE_BUNDLE_BPS + legendaryChanceBasisPoints) {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.rarity === "legendary" &&
        reward.key !== "tropical_cases_20" &&
        isAvailable(reward)
    );
    selectedTierChanceBasisPoints = legendaryChanceBasisPoints;
  } else if (tierRoll < TROPICAL_CASE_20_BPS + TROPICAL_CASE_BUNDLE_BPS + legendaryChanceBasisPoints + TROPICAL_CASE_EPIC_BPS) {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.rarity === "epic" && isAvailable(reward)
    );
    selectedTierChanceBasisPoints = TROPICAL_CASE_EPIC_BPS;
  } else {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.rarity === "common"
    );
    selectedTierChanceBasisPoints =
      10000 - TROPICAL_CASE_20_BPS - TROPICAL_CASE_BUNDLE_BPS -
      legendaryChanceBasisPoints - TROPICAL_CASE_EPIC_BPS;
  }
  if (!candidates.length) {
    candidates = TROPICAL_CASE_REWARDS.filter(
      reward => reward.rarity === "common"
    );
    selectedTierChanceBasisPoints =
      10000 - TROPICAL_CASE_20_BPS - TROPICAL_CASE_BUNDLE_BPS -
      legendaryChanceBasisPoints - TROPICAL_CASE_EPIC_BPS;
  }
  return {
    reward: weightedPick(candidates, randomInt),
    megaCaseChanceBasisPoints: TROPICAL_CASE_20_BPS,
    bundleChanceBasisPoints: TROPICAL_CASE_BUNDLE_BPS,
    legendaryChanceBasisPoints,
    selectedTierChanceBasisPoints
  };
}
