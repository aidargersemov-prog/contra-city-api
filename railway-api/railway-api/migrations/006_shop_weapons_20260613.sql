INSERT INTO catalog_items (item_key, item_type, item_id, system_name, item_data, updated_at)
VALUES
  (
    '1:69',
    1,
    69,
    'hg_desertb01',
    '{"itype":1,"id":69,"w_id":69,"wt":3,"ws":2,"ammo":7,"ammo_tot":42,"rap":280,"rt":2533,"lt":520,"dev":6,"rad":10,"krit":10,"smindam":24,"smaxdam":37,"mmindam":20,"mmaxdam":29,"lmindam":12,"lmaxdam":19,"vel":100,"ang":0,"sname":"hg_desertb01","sn":"hg_desertb01","name":"\u041f\u0443\u0441\u0442\u044b\u043d\u043d\u044b\u0439 \u041e\u0440\u0435\u043b","nlvl":1,"iS":1,"sc":{"sc_id":"1069","tPv":1000,"tPr":0,"tPp":0}}'::jsonb,
    now()
  ),
  (
    '1:53',
    1,
    53,
    'hg_desert',
    '{"itype":1,"id":53,"w_id":53,"wt":3,"ws":2,"ammo":7,"ammo_tot":42,"rap":260,"rt":2533,"lt":520,"dev":7,"rad":10,"krit":9,"smindam":21,"smaxdam":31,"mmindam":14,"mmaxdam":21,"lmindam":11,"lmaxdam":21,"vel":100,"ang":0,"sname":"hg_desert","sn":"hg_desert","name":"\u0421\u043e\u043a\u043e\u043b","nlvl":1,"iS":1,"sc":{"sc_id":"1053","tPv":1000,"tPr":0,"tPp":0}}'::jsonb,
    now()
  ),
  (
    '1:68',
    1,
    68,
    'hg_glockb01_s',
    '{"itype":1,"id":68,"w_id":68,"wt":3,"ws":2,"ammo":18,"ammo_tot":108,"rap":150,"rt":2667,"lt":520,"dev":9,"rad":10,"krit":6,"smindam":17,"smaxdam":25,"mmindam":12,"mmaxdam":19,"lmindam":9,"lmaxdam":16,"vel":100,"ang":0,"sname":"hg_glockb01_s","sn":"hg_glockb01_s","name":"\u0421\u043f\u0435\u043a\u0443\u043b\u044f\u043d\u0442","nlvl":1,"iS":1,"sc":{"sc_id":"1068","tPv":1000,"tPr":0,"tPp":0}}'::jsonb,
    now()
  ),
  (
    '1:76',
    1,
    76,
    'mg_aug1_o',
    '{"itype":1,"id":76,"w_id":76,"wt":4,"ws":3,"ammo":35,"ammo_tot":175,"rap":145,"rt":3000,"lt":650,"dev":9,"rad":12,"krit":6,"smindam":18,"smaxdam":29,"mmindam":15,"mmaxdam":24,"lmindam":11,"lmaxdam":19,"vel":100,"ang":0,"sname":"mg_aug1_o","sn":"mg_aug1_o","name":"\u0411\u043e\u043b\u044c\u0448\u0435\u0432\u0438\u043a","desc":"\u0420\u0435\u0432\u043e\u043b\u044e\u0446\u0438\u043e\u043d\u043d\u044b\u0435 \u0442\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0438\u0438 \u043f\u043e\u0431\u0435\u0434\u044b.","desca":"- \u041d\u0430\u043d\u043e\u0441\u0438\u0442 \u043f\u0435\u0440\u0438\u043e\u0434\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0443\u0440\u043e\u043d \u0442\u0438\u043f\u0430 \"\u044f\u0434\"","nlvl":1,"iS":1,"sc":{"sc_id":"1076","tPv":1000,"tPr":0,"tPp":0}}'::jsonb,
    now()
  )
ON CONFLICT (item_key) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  item_id = EXCLUDED.item_id,
  system_name = EXCLUDED.system_name,
  item_data = EXCLUDED.item_data,
  updated_at = now();
