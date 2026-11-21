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
export async function distributeExtraction(db,id,row,requested,stacks){
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
  if(weight>layout.capacityGrams || Object.values(remaining).some(n=>n!==0))throw Object.assign(new Error("Raid backpack out of sync"),{status:422});
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
      await db.query("INSERT INTO regular_pve_departure_items SELECT player_id,$2,slot,material,quantity,rotated FROM regular_pve_loadout WHERE player_id=$1",[id,action.run]);
      await db.query("DELETE FROM regular_pve_loadout WHERE player_id=$1",[id]);
      if(bag.length)await db.query("UPDATE regular_pve_profiles SET revision=revision+1 WHERE player_id=$1",[id]);
    }
    return {layout,departure:(await db.query("SELECT slot,material AS key,quantity AS count,rotated FROM regular_pve_departure_items WHERE player_id=$1 AND run_id=$2 ORDER BY slot",[id,action.run])).rows};
  }
  if(action.type==="buy_row"){
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
      if(500+bag.reduce((n,i)=>n+catalog[i.key].grams*i.count,0)+def.grams*count>70000)return {error:"Превышен вес рюкзака."};
      const stock=(await db.query("SELECT quantity FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key])).rows[0];
      if(!stock||Number(stock.quantity)<count)return {error:"Недостаточно материала на складе."};
      if(Number(stock.quantity)===count)await db.query("DELETE FROM regular_pve_materials WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key]);
      else await db.query("UPDATE regular_pve_materials SET quantity=quantity-$3 WHERE player_id=$1 AND purpose='warehouse' AND material=$2",[id,key,count]);
      await db.query("INSERT INTO regular_pve_loadout VALUES($1,$2,$3,$4,$5) ON CONFLICT(player_id,slot) DO UPDATE SET quantity=regular_pve_loadout.quantity+excluded.quantity",[id,slot,key,count,rotated]);
    }else return {error:"Выберите свободное место для предмета."};
    await db.query("UPDATE regular_pve_profiles SET revision=revision+1 WHERE player_id=$1",[id]);
  }
  return {layout,bag:(await db.query(selectBag,[id])).rows};
}
