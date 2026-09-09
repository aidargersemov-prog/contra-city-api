import crypto from 'node:crypto';

// Versioned, persisted daily definitions. No client-supplied progress is accepted.
export const QUEST_MAPS = Object.freeze([
  { id:'Arena_3lvl', name:'Ангар, задний двор' }, { id:'ArenaRing', name:'Форпост' },
  { id:'Bit_map', name:'Комиссариат' }, { id:'LegoTurnament', name:'Рубеж' }, { id:'Inferno', name:'Урбан' }
]);
export const QUEST_MODES = Object.freeze([{id:1,name:'Deathmatch'},{id:2,name:'Командный бой'},{id:4,name:'Захват флага'},{id:8,name:'Контроль точек'}]);
const classes = [{id:3,name:'пистолеты'},{id:4,name:'автоматы'},{id:6,name:'пулемёты'},{id:7,name:'дробовики'},{id:10,name:'снайперские винтовки'}];
const difficultyNames = ['Лёгкий','Средний','Тяжёлый'];
// Each range is inclusive; thresholds are selected once, not on every state read.
const definitions = [
  ['kills','Работа по цели','Убить {n} противников',[[30,50],[100,150],[250,350]],'kills'],
  ['kills_match','Один бой — один приказ','Убить {n} противников за один бой',[[8,12],[20,25],[35,45]],'kills','best'],
  ['damage','Огневое давление','Нанести {n} урона здоровью противников',[[3000,5000],[12000,18000],[35000,50000]],'damage'],
  ['damage_match','Шквал огня','Нанести {n} урона здоровью за один бой',[[1000,1500],[3000,4000],[6000,8000]],'damage','best'],
  ['headshots','Точный огонь','Совершить {n} убийств в голову',[[8,12],[30,45],[80,110]],'headshots'],
  ['groin','Ниже пояса','Совершить {n} убийств в пах',[[4,6],[15,22],[40,55]],'groinKills'],
  ['low_health','На последнем дыхании','Совершить {n} убийств, имея не больше {hp} HP',[[4,6],[12,18],[25,35]],'lowHealthKills'],
  ['kill_streak','Неостановимый','Совершить {n} убийств без смерти',[[4,5],[8,10],[15,20]],'maxKillStreak','best'],
  ['first_blood','Первая кровь','Сделать первую кровь в {n} боях',[[1,1],[3,4],[7,10]],'firstBlood'],
  ['class_kills','Мастер класса','Убить {n} противников: {class}',[[15,25],[60,90],[150,220]],'killsByClass'],
  ['class_headshots','Точность по профилю','Сделать {n} убийств в голову: {class}',[[5,8],[20,30],[55,75]],'headshotsByClass'],
  ['class_groin','Удар по слабому месту','Сделать {n} убийств в пах: {class}',[[3,4],[10,15],[25,35]],'groinKillsByClass'],
  ['two_weapons','Двойной арсенал','Сделать минимум по {n} убийств двумя разными моделями оружия за один бой',[[3,4],[7,10],[15,20]],'weaponKinds','best'],
  ['double','Двойной удар','Сделать {n} двойных убийств',[[2,3],[8,12],[20,30]],'doubleKills'],
  ['triple','Тройной удар','Сделать {n} тройных убийств',[[1,2],[4,6],[10,15]],'tripleKills'],
  ['quad','Четверной удар','Сделать {n} четверных убийств',[[1,1],[2,3],[5,7]],'quadKills'],
  ['head_streak','Хирургическая точность','Сделать серию из {n} убийств в голову',[[2,2],[3,4],[5,7]],'maxHeadshotStreak','best'],
  ['groin_streak','Запрещённый приём','Сделать серию из {n} убийств в пах',[[2,2],[3,3],[4,5]],'maxGroinStreak','best'],
  ['played','На передовой','Сыграть {n} боёв (не менее минуты в каждом)',[[3,5],[10,14],[25,35]],'played'],
  ['completed','До последней секунды','Доиграть до конца {n} боёв',[[3,4],[8,12],[18,25]],'completed'],
  ['wins','Взять рубеж','Победить {n} раз',[[2,3],[6,9],[15,20]],'wins'],
  ['minutes','Боевая смена','Сыграть {n} минут',[[20,30],[90,120],[240,300]],'playedSeconds'],
  ['win_streak','Без права на поражение','Победить в {n} боях подряд одним участником',[[2,2],[3,4],[5,7]],'winStreak','best'],
  ['win_kills','Результативная победа','Победить с минимум {n} убийствами за бой',[[8,12],[20,25],[35,45]],'winKills','best'],
  ['positive_kd','Положительный баланс','Завершить {n} боёв с убийствами больше смертей',[[1,2],[4,6],[10,14]],'positiveKD'],
  ['dm_first','Первый среди равных','Занять первое место в Deathmatch {n} раз',[[1,1],[3,4],[7,10]],'dmFirst'],
  ['mode_played','Специализация','Сыграть {n} боёв в режиме «{mode}» (не менее минуты)',[[3,4],[8,10],[18,25]],'played'],
  ['mode_wins','Хозяева режима','Победить {n} раз в режиме «{mode}»',[[2,3],[5,7],[12,16]],'wins'],
  ['mode_kills','Режим устранения','Совершить {n} убийств в режиме «{mode}»',[[20,30],[75,100],[180,250]],'kills'],
  ['mode_damage','Подавление','Нанести {n} урона здоровью в режиме «{mode}»',[[2000,3000],[8000,12000],[22000,30000]],'damage'],
  ['map_played','Знакомая территория','Сыграть {n} боёв на карте «{map}» (не менее минуты)',[[2,3],[6,8],[14,18]],'played'],
  ['map_wins','Контроль территории','Победить {n} раз на карте «{map}»',[[1,2],[4,6],[10,14]],'wins'],
  ['map_kills','Зачистка','Совершить {n} убийств на карте «{map}»',[[20,30],[70,100],[180,240]],'kills'],
  ['different_maps','География боя','Сыграть на {n} разных картах (не менее минуты на каждой)',[[2,2],[3,4],[5,5]],'differentMaps'],
  ['different_modes','Универсальный состав','Победить в {n} разных режимах',[[2,2],[3,3],[4,4]],'differentModes'],
  ['flag_take','Налёт на базу','Взять вражеский флаг {n} раз',[[2,3],[8,12],[20,30]],'flagsTaken'],
  ['flag_capture','Доставка под огнём','Доставить вражеский флаг {n} раз',[[1,2],[5,7],[12,18]],'flagsCaptured'],
  ['flag_return','Свой флаг не отдаём','Вернуть флаг своей команды {n} раз',[[2,3],[6,9],[15,22]],'flagsReturned'],
  ['ctf_wins','Знамя победы','Победить в CTF {n} раз',[[1,2],[4,6],[10,14]],'wins'],
  ['carrier_kills','Вооружённый знаменосец','Убить {n} противников, неся вражеский флаг',[[2,3],[8,12],[20,30]],'flagCarrierKills'],
  ['ctf_kills','Прикрытие флага','Совершить {n} убийств в CTF',[[20,30],[70,100],[180,240]],'kills'],
  ['capture_win','От флага до победы','Доставить флаг и победить в том же бою {n} раз',[[1,1],[3,4],[7,10]],'captureWin']
];
export const QUEST_DEFINITIONS = Object.freeze(definitions.map(([key,title,text,ranges,metric,aggregation='sum']) => Object.freeze({key,title,text,ranges,metric,aggregation})));
const byKey = new Map(QUEST_DEFINITIONS.map(d=>[d.key,d]));
const integer = v => Number.isFinite(Number(v)) ? Math.max(0,Math.min(100000000,Math.trunc(Number(v)))) : 0;
function seeded(seed) { let counter=0; return max=>crypto.createHash('sha256').update(seed+':'+counter++).digest().readUInt32BE(0)%max; }

export function buildQuestSet(clanId,cycleKey) {
  const pick=seeded(`clan-contracts:v2:${clanId}:${cycleKey}`), pool=QUEST_DEFINITIONS.slice();
  return [0,1,2].map(tier=>{
    const d=pool.splice(pick(pool.length),1)[0], [low,high]=d.ranges[tier];
    const step=d.metric==='damage'?100:1;
    const target=low+pick(Math.floor((high-low)/step)+1)*step;
    const spec={version:2,difficulty:tier+1,metric:d.metric,aggregation:d.aggregation};
    if(d.key.startsWith('map_'))spec.map=QUEST_MAPS[pick(QUEST_MAPS.length)].id;
    if(d.key.startsWith('mode_'))spec.mode=QUEST_MODES[pick(QUEST_MODES.length)].id;
    if(d.key.startsWith('class_'))spec.weaponClass=classes[pick(classes.length)].id;
    if(d.key==='low_health')spec.health=[50,25,10][tier];
    if(['flag_take','flag_capture','flag_return','ctf_wins','carrier_kills','ctf_kills','capture_win'].includes(d.key))spec.mode=4;
    return {key:d.key,target,reward:[8,18,36][tier],spec};
  });
}

export function questPresentation(entry) {
  const spec=entry.objective_spec, d=byKey.get(entry.objective_key);
  if(!d||spec?.version!==2)return {};
  const map=QUEST_MAPS.find(m=>m.id===spec.map), mode=QUEST_MODES.find(m=>m.id===spec.mode), wc=classes.find(c=>c.id===spec.weaponClass);
  const text=d.text.replace('{n}',String(entry.target_value)).replace('{hp}',String(spec.health||0)).replace('{map}',map?.name||'').replace('{mode}',mode?.name||'').replace('{class}',wc?.name||'');
  let rule=spec.aggregation==='best'?'Лучший результат одного участника. Разные бои и игроки не суммируются.':'Общий прогресс участников клана.';
  if(['double','triple','quad','head_streak','groin_streak'].includes(d.key))rule+=' Между убийствами — меньше 10 секунд.';
  if(['head_streak','groin_streak'].includes(d.key))rule+=' Убийство в другую зону прерывает серию.';
  if(d.key==='win_streak')rule+=' Поражение, ничья или выход из боя прерывают серию.';
  return {title:d.title,text,difficulty:spec.difficulty,difficultyLabel:difficultyNames[spec.difficulty-1],rule,
    art:map?{kind:'map',id:map.id}:wc?{kind:'weapon',id:String(wc.id)}:{kind:'objective',id:spec.mode===4?'flag':d.metric==='damage'?'damage':d.metric.includes('Streak')?'streak':d.metric.includes('head')?'headshot':d.metric.includes('groin')?'groin':d.metric==='wins'?'victory':'combat'}};
}

// Returns absolute progress so per-match goals never accumulate across matches.
// Called under the cycle/entry row lock, after an idempotent match receipt.
export function advanceQuest(entry,event,playerId) {
  const spec=entry.objective_spec, m=event.eventData?.contractMetrics;
  const before=integer(entry.current_value), saved=entry.objective_state||{};
  if(spec?.version!==2||m?.version!==2||![1,2,4,8].includes(Number(event.mode)))return {progress:before,state:saved};
  const mode=Number(event.mode), map=String(event.mapName||event.map||'').toLowerCase();
  if(spec.map&&spec.map.toLowerCase()!==map||spec.mode&&spec.mode!==mode)return {progress:before,state:saved};
  const n=k=>integer(m[k]), complete=m.completed===true, won=complete&&event.won===true, played=n('playedSeconds')>=60;
  let value=0, state=saved;
  switch(spec.metric) {
    case 'played': value=played?1:0;break;
    case 'completed':value=complete?1:0;break;
    case 'wins':value=won?1:0;break;
    case 'playedSeconds':value=n('playedSeconds');break;
    case 'lowHealthKills':value=integer(m.lowHealthKills?.[spec.health]);break;
    case 'killsByClass':case 'headshotsByClass':case 'groinKillsByClass':value=integer(m[spec.metric]?.[spec.weaponClass]);break;
    case 'weaponKinds':value=Object.values(m.weaponKinds||{}).map(integer).sort((a,b)=>b-a)[1]||0;break;
    case 'winKills':value=won?n('kills'):0;break;
    case 'positiveKD':value=complete&&n('kills')>n('deaths')?1:0;break;
    case 'dmFirst':value=mode===1&&won?1:0;break;
    case 'captureWin':value=won&&n('flagsCaptured')>0?1:0;break;
    case 'differentMaps':case 'differentModes': {
      state=JSON.parse(JSON.stringify(saved));state.seen=state.seen||{};
      if(spec.metric==='differentMaps'&&played&&QUEST_MAPS.some(v=>v.id.toLowerCase()===map))state.seen[map]=true;
      if(spec.metric==='differentModes'&&won)state.seen[String(mode)]=true;
      return {progress:Math.min(integer(entry.target_value),Object.keys(state.seen).length),state};
    }
    case 'winStreak': {
      const ended=Date.parse(m.endedAt);if(!Number.isFinite(ended))return {progress:before,state:saved};
      state=JSON.parse(JSON.stringify(saved));state.players=state.players||{};
      const rows=state.players[String(playerId)]||[];
      rows.push({id:String(event.matchInstanceId),previous:String(m.previousMatchInstanceId||''),at:ended,won});
      state.players[String(playerId)]=rows;
      // Never bridge a missing/lost match: its result could be a defeat.
      // A late predecessor may safely extend the chain, never revoke a reward.
      const index=new Map(rows.map(row=>[row.id,row]));
      let best=0;for(const row of rows){let run=0,current=row;const seen=new Set();while(current?.won&&!seen.has(current.id)){seen.add(current.id);run++;current=index.get(current.previous);}best=Math.max(best,run);}
      value=best;break;
    }
    default:value=n(spec.metric);
  }
  if(spec.metric==='playedSeconds') {
    state={...saved,seconds:integer(saved.seconds)+value};
    return {progress:Math.min(integer(entry.target_value),Math.floor(state.seconds/60)),state};
  }
  return {progress:Math.min(integer(entry.target_value),spec.aggregation==='best'?Math.max(before,value):before+value),state};
}
