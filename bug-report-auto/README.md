# bug-report-auto

Минимальный Slack backend для приема баг-репортов через `/bug`, публикации карточек в канал и обработки кнопок модератора.

## Что уже есть

- slash-команда `/bug`
- launcher-сообщение в канале с кнопкой `Report Bug`
- modal с обязательными полями
- публикация карточки бага в канал
- кнопки модератора: `В работу`, `Отклонить`, `Дубликат`, `Связать с Jira`
- модальные окна для `Отклонить`, `Дубликат`, `Связать с Jira`
- in-memory реестр для быстрого старта

## Как запустить

1. Скопируйте `.env.example` в `.env`
2. Укажите Slack bot token, signing secret, id канала и Slack ID модераторов
3. Установите зависимости: `npm install`
4. Запустите сервис: `npm run dev`

## Slack setup

Нужны:

- Slash command `/bug` -> `POST https://your-domain/slack/commands`
- Interactivity Request URL -> `POST https://your-domain/slack/interactions`

Scopes для бота минимум:

- `commands`
- `chat:write`
- `chat:write.public`
- `channels:read`
- `groups:read`

## Важно

Сейчас данные хранятся в памяти процесса. После рестарта сервера записи исчезнут. Это нормально для первого шага. Следующим этапом можно подключить Google Sheets или PostgreSQL без переписывания Slack-слоя.

## Launcher в канале

Чтобы опубликовать или обновить одно launcher-сообщение с кнопкой `Report Bug`, вызовите:

```powershell
Invoke-WebRequest -Method POST http://127.0.0.1:3000/internal/publish-launcher
```

Если launcher уже был опубликован этим процессом, бот обновит его, а не создаст новый дубликат.
