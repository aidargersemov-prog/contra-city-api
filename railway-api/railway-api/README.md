# Contra City Legacy API

Минимальный совместимый backend для старого клиента Contra City.

Он не меняет клиентский дизайн, сцены, модели, текстуры или UI. Задача этого сервера — отвечать на старый `ajax.php` формат, чтобы клиент получил профиль, деньги, инвентарь, магазин, карты и базовые успешные ответы.

## Локальный запуск

```powershell
cd "C:\Users\777\Desktop\contra city\railway-api"
npm start
```

Проверка:

```text
http://localhost:3000/health
http://localhost:3000/ajax.php?ccid=1&cckey=local-dev-key&page=pl&act=i&v=1&w=1&t=1
```

## Railway

1. Создайте новый проект в Railway.
2. Загрузите эту папку как Node.js service.
3. Start command: `npm start`.
4. После деплоя Railway даст URL вида:

```text
https://your-service.up.railway.app
```

Для клиента нужен endpoint:

```text
https://your-service.up.railway.app/ajax.php?
```

## Важно

Клиент все еще надо направить на этот URL. Это отдельный маленький патч в `il.xp` внутри `Assembly-CSharp.dll`.

Визуальные ресурсы не трогаются.
