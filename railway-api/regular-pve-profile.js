import {loadoutAction,distributeExtraction} from "./regular-pve-loadout.js";
export async function regularProfile(pool,{playerId,profile,operation,action,extraction}){
  if(!pool)throw new Error("PostgreSQL unavailable");
  if(!/^[1-9][0-9]{0,16}$/.test(String(playerId)))throw new Error("Invalid player");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("INSERT INTO regular_pve_profiles(player_id) VALUES($1) ON CONFLICT DO NOTHING",[playerId]);
    const get=()=>client.query("SELECT level,xp,revision,storage_rows_2,storage_rows_3,yield_rank AS yield,speed_rank AS speed,loss_rank AS loss,extra_rank AS extra FROM regular_pve_profiles WHERE player_id=$1 FOR UPDATE",[playerId]);
    let row=(await get()).rows[0];
    let extra={};
    if(action){extra=await loadoutAction(client,playerId,row,action);
      if(extra.error)Object.assign(extra,await loadoutAction(client,playerId,row,{type:"read"}));
      row=(await get()).rows[0];}
    if(profile){
      if(typeof operation!=="string" || operation.length>150 || !operation.length)throw new Error("Invalid operation");
      const inserted=await client.query("INSERT INTO regular_pve_operations VALUES($1,$2) ON CONFLICT DO NOTHING",[playerId,operation]);
      if(inserted.rowCount){
        if(profile.revision!==row.revision)throw new Error("Stale profile revision");
        await client.query("UPDATE regular_pve_profiles SET level=$2,xp=$3,yield_rank=$4,speed_rank=$5,loss_rank=$6,extra_rank=$7,revision=revision+1 WHERE player_id=$1",[playerId,profile.level,profile.xp,profile.yield,profile.speed,profile.loss,profile.extra]);
        const quantities=[];
        const warehouse=extraction?await distributeExtraction(client,playerId,row,profile.extractedStock,extraction.stacks):profile.extractedStock||{};
        const groups={...profile.contributions,warehouse};
        for(const [purpose,materials] of Object.entries(groups)){
          for(const [key,count] of Object.entries(materials)){
            if(!Number.isSafeInteger(count)||count<0)throw new Error("Invalid count");
            if(count)quantities.push([purpose,key,count]);
          }
        }
        await client.query("DELETE FROM regular_pve_materials WHERE player_id=$1",[playerId]);
        if(quantities.length)await client.query("INSERT INTO regular_pve_materials SELECT $1, * FROM unnest($2::text[],$3::text[],$4::bigint[])",[playerId,...[0,1,2].map(i=>quantities.map(entry=>entry[i]))]);
        if(extraction && operation.endsWith("/evac"))
          await client.query("INSERT INTO regular_pve_raid_history(player_id,run_id,finished_at,seconds) VALUES($1,$2,to_timestamp($3::double precision/1000),$4)",[playerId,operation,extraction.ended,extraction.seconds]);
        row=(await get()).rows[0];
      }
    }
    const result={...row,xp:Number(row.xp),extractedStock:{},contributions:{}};
    const items=await client.query("SELECT purpose,material,quantity FROM regular_pve_materials WHERE player_id=$1",[playerId]);
    for(const item of items.rows){
      const dest=item.purpose==="warehouse"?result.extractedStock:(result.contributions[item.purpose]||={});
      dest[item.material]=Number(item.quantity);
    }
    if(action && action.type!=="depart"){
      const stats=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE finished_at >= (date_trunc('day',now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'))::int AS today FROM regular_pve_raid_history WHERE player_id=$1",[playerId])).rows[0];
      const wallet=(await client.query("SELECT money FROM players WHERE id=$1",[playerId])).rows[0];
      Object.assign(extra,stats,{money:Number(wallet?.money||0),rows:{2:row.storage_rows_2,3:row.storage_rows_3}});
    }
    await client.query("COMMIT");return {...result,...extra};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
