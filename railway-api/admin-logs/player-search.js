export async function searchPlayers(pool, url) {
  const q=String(url.searchParams.get('q') || '').trim().slice(0,80).replace(/^@/, '');
  const linked=url.searchParams.get('linked')==='1';
  const page=Math.max(1,Math.min(100000,Math.trunc(Number(url.searchParams.get('page')) || 1)));
  const pageSize=30;
  if (!q && !linked) return {items:[],total:0,page:1,pages:1};
  const pattern=`%${q.replace(/[\\%_]/g,'\\$&')}%`;
  const where=`WHERE ($1='' OR p.name ILIKE $2 OR p.id::text=$1
    OR t.telegram_user_id::text=$1 OR t.telegram_username ILIKE $2
    OR concat_ws(' ',t.telegram_first_name,t.telegram_last_name) ILIKE $2)
    AND (NOT $3::boolean OR t.player_id IS NOT NULL)`;
  const from=`FROM players p LEFT JOIN launcher_telegram_bindings t ON t.player_id=p.id`;
  const values=[q,pattern,linked];
  const count=await pool.query(`SELECT count(*)::int total ${from} ${where}`,values);
  const result=await pool.query(`SELECT p.id,p.name,p.level,
    t.telegram_user_id::text AS telegram_id,t.telegram_username,
    t.telegram_first_name,t.telegram_last_name,t.confirmed_at AS telegram_linked_at
    ${from} ${where} ORDER BY (p.id::text=$1) DESC,(lower(p.name)=lower($1)) DESC,p.name,p.id
    LIMIT $4 OFFSET $5`,[...values,pageSize,(page-1)*pageSize]);
  return {items:result.rows.map(row=>({...row,id:Number(row.id)})),total:count.rows[0].total,page,pages:Math.max(1,Math.ceil(count.rows[0].total/pageSize))};
}

export async function playerTelegramBinding(pool,playerId) {
  const result=await pool.query(`SELECT telegram_user_id::text AS telegram_id,telegram_username,
    telegram_first_name,telegram_last_name,confirmed_at AS telegram_linked_at,last_verified_at
    FROM launcher_telegram_bindings WHERE player_id=$1`,[playerId]);
  return result.rows[0] || null;
}
