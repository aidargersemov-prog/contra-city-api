// Grid, radio and unit weights from PvePlayerInventory and PveRegularMaterialCatalog.
const catalog={
  patroni:{w:2,h:1,grams:600},
  bint:{w:1,h:1,grams:100},
  aptechka:{w:2,h:1,grams:500},
  MetallDefault:{w:2,h:1,grams:1200},
  ChistiyMetall:{w:2,h:1,grams:1000},
  ProchniySplavMetall:{w:2,h:2,grams:1800},
  BronevoySplavMetall:{w:3,h:2,grams:2600},
  Tkan1:{w:2,h:1,grams:200},
  Tkan2:{w:2,h:2,grams:400},
  Tkan3:{w:3,h:2,grams:800},
  Tkan4:{w:3,h:2,grams:600},
  polimer1:{w:2,h:1,grams:300},
  polimer2:{w:2,h:1,grams:400},
  polimer3:{w:2,h:2,grams:600},
  polimer4:{w:2,h:2,grams:700},
  mexanika1:{w:1,h:1,grams:300},
  mexanika2:{w:2,h:1,grams:800},
  mexanika3:{w:2,h:2,grams:1500},
  mexanika4:{w:3,h:2,grams:2200},
  electronika1:{w:1,h:1,grams:100},
  electronika2:{w:1,h:1,grams:100},
  electronika3:{w:2,h:1,grams:200},
  electronika4:{w:2,h:2,grams:500},
};
const layout={columns:10,rows:7,capacityGrams:70000,radioGrams:500,catalog};
const selectBag="SELECT slot,material AS key,quantity AS count,rotated FROM regular_pve_loadout WHERE player_id=$1 ORDER BY slot";
function place(items,slot,key,rotated){
  if(!Number.isInteger(slot)||slot<1||slot>=70)return false;
  const item=catalog[key],x=slot%10,y=Math.floor(slot/10);
  const w=rotated?item.h:item.w,h=rotated?item.w:item.h;
  if(x+w>10||y+h>7)return false;
  return !items.some(other=>{
    const def=catalog[other.key],ox=other.slot%10,oy=Math.floor(other.slot/10);
    return x<ox+(other.rotated?def.h:def.w)&&x+w>ox&&y<oy+(other.rotated?def.w:def.h)&&y+h>oy;
  });
}
function capacity(row){return 63+9*(row.storage_rows_2+row.storage_rows_3);}
function freeFor(stock,key,limit){
  const used=Object.values(stock).reduce((n,q)=>n+Math.ceil(q/99),0);
  const current=stock[key]||0;
  return (Math.ceil(current/99)*99-current)+Math.max(0,limit-used)*99;
}
async function stockOf(db,id){
  const {rows}=await db.query("SELECT material,quantity FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse'",[id]);
  return Object.fromEntries(rows.map(r=>[r.material,Number(r.quantity)]));
}
const perkPrices = {
vitality: [
  [["Tkan1", 10], ["mexanika1", 5]],
  [["Tkan1", 18], ["mexanika1", 10]],
  [["Tkan2", 13], ["mexanika2", 7]],
  [["Tkan3", 10], ["mexanika3", 5]],
  [["Tkan4", 9], ["mexanika4", 5]]
],
hardened: [
  [["MetallDefault", 10], ["polimer1", 5]],
  [["MetallDefault", 18], ["polimer1", 10]],
  [["ChistiyMetall", 13], ["polimer2", 7]],
  [["ProchniySplavMetall", 10], ["polimer3", 5]],
  [["BronevoySplavMetall", 9], ["polimer4", 5]]
],
second_wind: [
  [["polimer1", 10], ["Tkan1", 5]],
  [["polimer1", 18], ["Tkan1", 10]],
  [["polimer2", 13], ["Tkan2", 7]],
  [["polimer3", 10], ["Tkan3", 5]],
  [["polimer4", 9], ["Tkan4", 5]]
],
adrenaline: [
  [["Tkan1", 10], ["electronika1", 5]],
  [["Tkan1", 18], ["electronika1", 10]],
  [["Tkan2", 13], ["electronika2", 7]],
  [["Tkan3", 10], ["electronika3", 5]],
  [["Tkan4", 9], ["electronika4", 5]]
],
vampirism: [
  [["electronika1", 10], ["polimer1", 5]],
  [["electronika1", 18], ["polimer1", 10]],
  [["electronika2", 13], ["polimer2", 7]],
  [["electronika3", 10], ["polimer3", 5]],
  [["electronika4", 9], ["polimer4", 5]]
],
berserk: [
  [["MetallDefault", 10], ["mexanika1", 5]],
  [["MetallDefault", 18], ["mexanika1", 10]],
  [["ChistiyMetall", 13], ["mexanika2", 7]],
  [["ProchniySplavMetall", 10], ["mexanika3", 5]],
  [["BronevoySplavMetall", 9], ["mexanika4", 5]]
],
ninja: [
  [["polimer1", 10], ["Tkan1", 5]],
  [["polimer1", 18], ["Tkan1", 10]],
  [["polimer2", 13], ["Tkan2", 7]],
  [["polimer3", 10], ["Tkan3", 5]],
  [["polimer4", 9], ["Tkan4", 5]]
],
collector: [
  [["mexanika1", 10], ["Tkan1", 5]],
  [["mexanika1", 18], ["Tkan1", 10]],
  [["mexanika2", 13], ["Tkan2", 7]],
  [["mexanika3", 10], ["Tkan3", 5]],
  [["mexanika4", 9], ["Tkan4", 5]]
],
economist: [
  [["electronika1", 10], ["MetallDefault", 5]],
  [["electronika1", 18], ["MetallDefault", 10]],
  [["electronika2", 13], ["ChistiyMetall", 7]],
  [["electronika3", 10], ["ProchniySplavMetall", 5]],
  [["electronika4", 9], ["BronevoySplavMetall", 5]]
],
marksman: [
  [["electronika1", 10], ["mexanika1", 5]],
  [["electronika1", 18], ["mexanika1", 10]],
  [["electronika2", 13], ["mexanika2", 7]],
  [["electronika3", 10], ["mexanika3", 5]],
  [["electronika4", 9], ["mexanika4", 5]]
],
double_strike: [
  [["mexanika1", 10], ["electronika1", 5]],
  [["mexanika1", 18], ["electronika1", 10]],
  [["mexanika2", 13], ["electronika2", 7]],
  [["mexanika3", 10], ["electronika3", 5]],
  [["mexanika4", 9], ["electronika4", 5]]
]
};
function perkOffer(perk, rank, stock) {
  const cost = (perkPrices[perk][rank] || []).map(([key, count]) => ({key, count, owned:stock[key] || 0}));
  return {rank, cost};
}
export function survivalOffers(row, stock) {
  return Object.fromEntries(Object.keys(perkPrices).map(perk => [perk, perkOffer(perk,row[perk+"_rank"],stock)]));
}
const outfits = {
  stalker: {
    price:{MetallDefault:5,Tkan1:6,polimer1:4,mexanika1:3,electronika1:2},
    bonuses:{armor:4,backpackGrams:3000}
  },
  technician: {
    price:{MetallDefault:5,Tkan1:3,polimer1:4,mexanika1:4,electronika1:3},
    bonuses:{bandageHp:5,backpackGrams:4000}
  },
  mercenary: {
    price:{ChistiyMetall:53,Tkan2:29,polimer2:30,mexanika2:26,electronika2:18},
    bonuses:{armor:7,mobDamageReductionPercent:2,backpackGrams:-3000}
  },
  scout: {
    price:{ChistiyMetall:35,Tkan2:42,polimer2:32,mexanika2:22,electronika2:15},
    bonuses:{runSpeedPercent:2,backpackGrams:5000}
  }
};
export function outfitBonuses(outfit){
  return Object.hasOwn(outfits,outfit) ? outfits[outfit].bonuses : {};
}
function outfitLayout(outfit){
  return {...layout,capacityGrams:layout.capacityGrams+(outfitBonuses(outfit).backpackGrams ?? 0)};
}
function bagWeight(bag){
  return bag.reduce((grams,stack)=>grams+catalog[stack.key].grams*stack.count,layout.radioGrams);
}
export async function outfitOffers(db,id,row,stock){
  const {rows}=await db.query("SELECT outfit FROM regular_pve_outfits WHERE player_id=$1",[id]);
  return Object.fromEntries(Object.entries(outfits).map(([outfit,{price,bonuses}])=>[outfit,{
    owned:rows.some(entry=>entry.outfit===outfit),equipped:row.equipped_outfit===outfit,
    bonuses,cost:Object.entries(price).map(([key,count])=>({key,count,owned:stock[key]||0}))
  }]));
}
async function changeOutfit(db,id,row,action,bag){
  const {type,key,revision}=action;
  if(revision!==row.revision)return {error:"Снаряжение изменилось. Повторите действие."};
  if(type==="unequip_outfit"){
    if(bagWeight(bag)>layout.capacityGrams)return {error:"Освободите рюкзак до "+layout.capacityGrams/1000+" кг, чтобы снять комплект."};
    if(row.equipped_outfit)
      await db.query("UPDATE regular_pve_profiles SET equipped_outfit=NULL,revision=revision+1 WHERE player_id=$1",[id]);
    return {};
  }
  if(typeof key!=="string" || !Object.hasOwn(outfits,key))return {error:"Этот комплект недоступен."};
  const owned=(await db.query("SELECT 1 FROM regular_pve_outfits WHERE player_id=$1 AND outfit=$2",[id,key])).rowCount;
  if(type==="equip_outfit"){
    if(!owned)return {error:"Сначала купите комплект."};
    const {capacityGrams}=outfitLayout(key);
    if(bagWeight(bag)>capacityGrams)return {error:"Освободите рюкзак до "+capacityGrams/1000+" кг, чтобы надеть этот комплект."};
    if(row.equipped_outfit!==key)
      await db.query("UPDATE regular_pve_profiles SET equipped_outfit=$2,revision=revision+1 WHERE player_id=$1",[id,key]);
    return {};
  }
  if(owned)return {};
  const stock=await stockOf(db,id), price=Object.entries(outfits[key].price);
  if(price.some(([material,count])=>(stock[material]||0)<count))return {error:"На складе не хватает материалов."};
  for(const [material,count] of price){
    if(stock[material]===count)
      await db.query("DELETE FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,material]);
    else
      await db.query("UPDATE regular_pve_materials SET quantity=quantity-$3 WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,material,count]);
  }
  await db.query("INSERT INTO regular_pve_outfits(player_id,outfit) VALUES($1,$2)",[id,key]);
  await db.query("UPDATE regular_pve_profiles SET revision=revision+1 WHERE player_id=$1",[id]);
  return {};
}
async function changePerkPreset(db,id,row,action){
  const {slot,key,type,revision}=action;
  if(revision!==row.revision)return {error:"Пресет изменился. Повторите действие."};
  if(!Number.isInteger(slot) || slot<1 || slot>4)return {error:"Укажите пресет от 1 до 4."};
  if(type==="select_perk_preset"){
    if(slot!==row.active_perk_preset)
      await db.query("UPDATE regular_pve_profiles SET active_perk_preset=$2,revision=revision+1 WHERE player_id=$1",[id,slot]);
    return {};
  }
  if(slot!==row.active_perk_preset)return {error:"Сначала выберите этот пресет."};
  if(typeof key!=="string" || !Object.hasOwn(perkPrices,key))return {error:"Этот перк недоступен."};
  const presets=row.perk_presets;
  const perks=presets[slot-1];
  if(type==="equip_perk"){
    if(!row[key+"_rank"])return {error:"Сначала откройте перк."};
    if(perks.includes(key))return {};
    if(perks.length>=4)return {error:"В пресете максимум четыре перка."};
    presets[slot-1]=[...perks,key];
  }else{
    if(!perks.includes(key))return {};
    presets[slot-1]=perks.filter(perk=>perk!==key);
  }
  await db.query("UPDATE regular_pve_profiles SET perk_presets=$2::jsonb,revision=revision+1 WHERE player_id=$1",
    [id,JSON.stringify(presets)]);
  return {};
}
export async function distributeExtraction(db,id,row,requested,stacks,outfit){
  const stock=await stockOf(db,id);
  const remaining={...requested},placed=[];
  let weight=layout.radioGrams;
  for(const [key,n] of Object.entries(stock))remaining[key]=(remaining[key]||0)-n;
  if(!Array.isArray(stacks)||stacks.length>69)throw Object.assign(new Error("Missing raid backpack"),{status:422});
  for(const item of stacks){
    const {key,count,slot,rotated}=item;
    if(!Object.hasOwn(catalog,key)||!Number.isInteger(count)||count<1||count>99||typeof rotated!=="boolean"||
       !place(placed,slot,key,rotated))throw Object.assign(new Error("Invalid raid backpack"),{status:422});
    remaining[key]=(remaining[key]||0)-count;
    weight+=catalog[key].grams*count;
    placed.push(item);
  }
  if(weight>outfitLayout(outfit).capacityGrams || Object.values(remaining).some(n=>n!==0))throw Object.assign(new Error("Raid backpack out of sync"),{status:422});
  const occupied=(await db.query(selectBag,[id])).rows;
  for(const {key,count,slot,rotated} of placed){
    const moved=Math.min(count,freeFor(stock,key,capacity(row)));
    stock[key]=(stock[key]||0)+moved;
    if(count===moved)continue;
    if(!place(occupied,slot,key,rotated))throw Object.assign(new Error("Concurrent loadout placement"),{status:409});
    await db.query("INSERT INTO regular_pve_loadout VALUES($1,$2,$3,$4,$5)",[id,slot,key,count-moved,rotated]);
    occupied.push({key,count:count-moved,slot,rotated});
  }
  return stock;
}
export async function loadoutAction(db,id,row,action){
  const bag=(await db.query(selectBag,[id])).rows;
  if(action.type==="depart"){
    const fresh=await db.query("INSERT INTO regular_pve_departures VALUES($1,$2) ON CONFLICT DO NOTHING",[id,action.run]);
    if(fresh.rowCount){
      if(bagWeight(bag)>outfitLayout(action.outfit).capacityGrams)
        throw Object.assign(new Error("Raid backpack exceeds departure capacity"),{status:422});
      await db.query("INSERT INTO regular_pve_departure_items SELECT player_id,$2,slot,material,quantity,rotated FROM regular_pve_loadout WHERE player_id=$1",[id,action.run]);
      await db.query("DELETE FROM regular_pve_loadout WHERE player_id=$1",[id]);
      if(bag.length)await db.query("UPDATE regular_pve_profiles SET revision=revision+1 WHERE player_id=$1",[id]);
    }
    return {layout:outfitLayout(action.outfit),departure:(await db.query("SELECT slot,material AS key,quantity AS count,rotated FROM regular_pve_departure_items WHERE player_id=$1 AND run_id=$2 ORDER BY slot",[id,action.run])).rows};
  }
  if(["buy_outfit","equip_outfit","unequip_outfit"].includes(action.type)){
    const result=await changeOutfit(db,id,row,action,bag);
    if(result.error)return result;
  }else if(["select_perk_preset","equip_perk","unequip_perk"].includes(action.type)){
    const result=await changePerkPreset(db,id,row,action);
    if(result.error)return result;
  }else if(action.type==="buy_vitality" || action.type==="buy_perk"){
    const perk=action.type==="buy_vitality"?"vitality":action.key;
    if(!Object.hasOwn(perkPrices,perk))return {error:"Этот перк недоступен."};
    const column=perk+"_rank";
    if(action.revision!==row.revision || action.slot!==row[column]+1)
      return {error:"Уровень или склад изменился. Проверьте цену."};
    const {cost}=perkOffer(perk,row[column],await stockOf(db,id));
    if(!cost.length)return {error:"Перк уже максимального уровня."};
    if(cost.some(({owned,count})=>owned<count))return {error:"На складе не хватает материалов."};
    for(const {key,count,owned} of cost){
      if(owned===count)
        await db.query("DELETE FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key]);
      else
        await db.query("UPDATE regular_pve_materials SET quantity=quantity-$3 WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key,count]);
    }
    await db.query("UPDATE regular_pve_profiles SET "+column+"="+column+"+1,revision=revision+1 WHERE player_id=$1",[id]);
  }else if(action.type==="buy_row"){
    if(row.revision!==action.revision)return {error:"Склад изменился. Проверьте число открытых рядов."};
    if(action.slot!==2 && action.slot!==3)return {error:"Выберите страницу 2 или 3."};
    const column=action.slot===2?"storage_rows_2":"storage_rows_3";
    if(row[column]>=7)return {error:"Все ряды страницы уже открыты."};
    const paid=await db.query("UPDATE players SET money=money-1000,updated_at=now() WHERE id=$1 AND money>=1000 RETURNING money",[id]);
    if(!paid.rowCount)return {error:"Недостаточно контрабаксов."};
    await db.query("UPDATE regular_pve_profiles SET "+column+"="+column+"+1,revision=revision+1 WHERE player_id=$1",[id]);
  }else if(action.type!=="read"){
    const {key,slot,from,rotated,count}=action,def=catalog[key];
    const source=bag.find(i=>i.slot===from && i.key===key);
    if(action.revision!==row.revision)return {error:"Состав изменился. Проверьте рюкзак."};
    if(!Object.hasOwn(catalog,key)||!Number.isInteger(count)||count<1||count>99||typeof rotated!=="boolean")return {error:"Неверное количество."};
    if(action.type==="unpack" && source){
      if(freeFor(await stockOf(db,id),key,capacity(row))<source.count)return {error:"На складе недостаточно места для этого стака."};
      await db.query("INSERT INTO regular_pve_materials VALUES($1,'warehouse',$2,$3) ON CONFLICT(player_id,purpose,material) DO UPDATE SET quantity=regular_pve_materials.quantity+excluded.quantity",[id,key,source.count]);
      await db.query("DELETE FROM regular_pve_loadout WHERE player_id=$1 AND slot=$2",[id,from]);
    }else if(action.type==="move" && source && place(bag.filter(i=>i!==source),slot,key,rotated)){
      await db.query("UPDATE regular_pve_loadout SET slot=$3,rotated=$4 WHERE player_id=$1 AND slot=$2",[id,from,slot,rotated]);
    }else if(action.type==="pack"){
      const dest=bag.find(i=>i.slot===slot);
      if(dest?(dest.key!==key||dest.count+count>99):!place(bag,slot,key,rotated))return {error:"Предмет не помещается в выбранные клетки."};
      if(bagWeight(bag)+def.grams*count>outfitLayout(row.equipped_outfit).capacityGrams)return {error:"Превышен вес рюкзака."};
      const stock=(await db.query("SELECT quantity FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key])).rows[0];
      if(!stock||Number(stock.quantity)<count)return {error:"Недостаточно материала на складе."};
      if(Number(stock.quantity)===count)await db.query("DELETE FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key]);
      else await db.query("UPDATE regular_pve_materials SET quantity=quantity-$3 WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key,count]);
      await db.query("INSERT INTO regular_pve_loadout VALUES($1,$2,$3,$4,$5) ON CONFLICT(player_id,slot) DO UPDATE SET quantity=regular_pve_loadout.quantity+excluded.quantity",[id,slot,key,count,rotated]);
    }else return {error:"Выберите свободное место для предмета."};
    await db.query("UPDATE regular_pve_profiles SET revision=revision+1 WHERE player_id=$1",[id]);
  }
  return {layout:outfitLayout(row.equipped_outfit),bag:(await db.query(selectBag,[id])).rows};
}
