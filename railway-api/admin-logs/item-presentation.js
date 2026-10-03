import fs from "node:fs";

const text = JSON.parse(fs.readFileSync(new URL("./item-names.ru.json", import.meta.url), "utf8"));
const slots = ["None", "Hats", "Masks", "Gloves", "Shirts", "Pants", "Boots", "Backpacks", "Others", "Heads"];
const slotNames = ["Одежда", "Головной убор", "Маска", "Перчатки", "Верх", "Брюки", "Обувь", "Рюкзак", "Аксессуар", "Голова"];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function auditItemKey(row) {
  const meta = object(row.metadata), next = object(row.new_value), old = object(row.old_value);
  const explicit = meta.itemKey || next.itemKey || old.itemKey;
  if (/^\d+:\d+$/.test(String(explicit || ""))) return String(explicit);
  const item = object(meta.item || next.item || old.item || row.new_value || row.old_value);
  const type = Number(item.itype || next.itemType || old.itemType);
  const id = Number(item.w_id ?? item.t_id ?? item.e_id ?? item.id ?? next.itemId ?? old.itemId);
  return type > 0 && Number.isSafeInteger(id) && id > 0 ? `${type}:${id}` : "";
}

export function describeAuditItem(row) {
  if (!["inventory_change", "purchase", "weapon_upgrade", "clan_purchase"].includes(row.event_type)) return null;
  const key = auditItemKey(row);
  const meta = object(row.metadata), next = object(row.new_value), old = object(row.old_value);
  const snapshot = object(meta.item || next.item || old.item || row.new_value || row.old_value);
  const item = { ...object(row.catalog_item), ...snapshot };
  const type = Number(item.itype || key.split(":")[0]);
  const id = Number(item.w_id ?? item.t_id ?? item.e_id ?? item.id ?? key.split(":")[1]);
  if (!key && !id && !item.name) return null;
  const sn = String(item.sn || item.sname || row.catalog_system_name || "");
  const localizationKey = type === 3 ? `wear_${slots[Number(item.wt)]}_${sn}_name`
    : type === 4 ? `taunt_${id}_name` : type === 2 ? `enhancer_${id}_name` : `w_${id}_name`;
  const rawName = String(item.name || "");
  const unresolvedKey = /^(wear_|w_\d+_|taunt_|enhancer_)/.test(rawName);
  const name = text[rawName] || (rawName && !unresolvedKey ? rawName : "") || text[localizationKey];
  const operation = String(meta.operation || "").toLowerCase();
  const action = row.event_type === "purchase" || row.event_type === "clan_purchase" ? "Куплен"
    : row.event_type === "weapon_upgrade" ? "Улучшен"
    : ({ insert: "Добавлен", delete: "Удалён", update: "Изменён" }[operation] || "Изменён");
  return {
    key, id, type, systemName: sn, name: name || (sn ? `${sn} · название не найдено` : `Предмет ${key || id}`),
    resolved: Boolean(name), action,
    typeLabel: type === 3 ? slotNames[Number(item.wt)] || "Одежда" : ({1:"Оружие",2:"Усилитель",4:"Насмешка",5:"Вооружение клана"}[type] || "Предмет"),
    nameSource: snapshot.name ? "snapshot" : row.catalog_item?.name ? "catalog" : name ? "client_localization" : "unresolved"
  };
}

// Resolve one catalog batch per page, never one query per event. Stored audit
// descriptions/snapshots are retained; presentation enriches historical rows.
export async function enrichAuditItems(pool, rows) {
  const keys = [...new Set(rows.map(auditItemKey).filter(Boolean))];
  if (!keys.length) return rows;
  const result = await pool.query("SELECT item_key, item_data, system_name FROM catalog_items WHERE item_key = ANY($1::text[])", [keys]);
  const catalog = new Map(result.rows.map(item => [item.item_key, item]));
  return rows.map(row => {
    const item = catalog.get(auditItemKey(row));
    return item ? { ...row, catalog_item: item.item_data, catalog_system_name: item.system_name } : row;
  });
}
