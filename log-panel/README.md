# Contra City Log Panel

Отдельный Railway-сервис интерфейса логов. Он не содержит игровой логики и не подключается к PostgreSQL напрямую: все данные и права проходят через защищённые маршруты основного API `/admin/logs/*`.

## Railway: основной API

В существующем API-сервисе с доменом `https://contra-city-api-production.up.railway.app` добавьте Variables:

```text
LOG_PANEL_OWNER_LOGIN=<логин владельца>
LOG_PANEL_OWNER_PASSWORD=<сложный пароль, минимум 12 символов>
LOG_PANEL_OWNER_NAME=<отображаемое имя>
LOG_PANEL_ALLOWED_ORIGINS=https://<домен-панели>.up.railway.app
LOG_PANEL_SESSION_TTL_HOURS=12
```

`DATABASE_URL` уже должен быть подключён к PostgreSQL. При следующем deploy автоматически применятся миграции `010_admin_audit_logs.sql`, `011_admin_audit_history_backfill.sql` и `012_admin_audit_database_guards.sql`.

Владелец создаётся один раз. Для принудительной синхронизации пароля владельца из Railway Variables на один deploy добавьте `LOG_PANEL_SYNC_OWNER_PASSWORD=1`, затем удалите эту переменную и redeploy.

## Railway: отдельный сервис панели

1. В том же Railway Project создайте новый Empty Service из того же репозитория.
2. В Settings задайте `Root Directory` равным `/log-panel`.
3. Добавьте Variable:

```text
LOG_API_BASE_URL=https://contra-city-api-production.up.railway.app
```

4. Нажмите Deploy и затем Generate Domain.
5. Полученный домен панели внесите без завершающего `/` в `LOG_PANEL_ALLOWED_ORIGINS` у API-сервиса и redeploy API.
6. Откройте домен панели и войдите данными `LOG_PANEL_OWNER_LOGIN` / `LOG_PANEL_OWNER_PASSWORD`.

## Проверка

- API: `/health` должен вернуть build `railway-api-2026-07-12-admin-audit-panel-v42` и `storage=postgres`.
- Панель: `/health` должна вернуть `service=contra-city-log-panel` и правильный адрес API.
- После входа в логах API должна появиться строка `[admin-logs] owner ready id=...`.
- После входа игрока, покупки, улучшения оружия или кланового действия запись должна появиться в панели автоматически не позднее 10 секунд.

Никогда не размещайте `LOG_PANEL_OWNER_PASSWORD`, `DATABASE_URL`, `ADMIN_API_TOKEN` или `BATTLE_EVENT_TOKEN` в переменных сервиса панели. Они должны находиться только в API/battle services.
