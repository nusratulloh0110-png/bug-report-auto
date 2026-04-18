# bug-report-auto

Минимальный Slack backend для приема баг-репортов через `/bug`, публикации карточек в канал и обработки кнопок модератора.

## Что уже есть

- slash-команда `/bug`
- launcher-сообщение в канале с кнопкой `Report Bug`
- modal с обязательными полями
- публикация карточки бага в канал
- кнопки модератора: `В работу`, `Отклонить`, `Дубликат`, `Связать с Jira`
- модальные окна для `Отклонить`, `Дубликат`, `Связать с Jira`
- запись багов в Google Sheets
- вкладка `Dashboard` с автоматической сводкой

## Как запустить

1. Скопируйте `.env.example` в `.env`
2. Укажите Slack bot token, signing secret, id канала и Slack ID модераторов
3. Укажите `GOOGLE_SHEETS_SPREADSHEET_ID` и Google service account credentials в `.env`
4. Установите зависимости: `npm install`
5. Запустите сервис: `npm run dev`

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

Slack-данные остаются в памяти процесса для быстрого доступа, а реестр и отчетность пишутся в Google Sheets. После рестарта процесс не теряет исторические баги в таблице, но in-memory индекс текущей сессии собирается заново.

Google credentials можно передавать либо через `.env`, либо через локальный JSON-файл. Для GitHub безопаснее использовать `.env` и не коммитить JSON-ключ.

## Launcher в канале

Чтобы опубликовать или обновить одно launcher-сообщение с кнопкой `Report Bug`, вызовите:

```powershell
Invoke-WebRequest -Method POST http://127.0.0.1:3000/internal/publish-launcher
```

Если launcher уже был опубликован этим процессом, бот обновит его, а не создаст новый дубликат.
