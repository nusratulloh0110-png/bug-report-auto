# bug-report-auto

Минимальный Slack backend для приема баг-репортов через `/bug`, публикации карточек в канал и обработки действий модератора.

## Что уже есть

- slash-команда `/bug`
- launcher-сообщение в канале с кнопкой `Report Bug`
- модальное окно для создания бага
- публикация карточки бага в Slack
- действия модератора: `В работу`, `Отклонить`, `Дубликат`, `Создать в Jira`
- запись багов в Google Sheets
- вкладка `Dashboard` с автоматической сводкой
- создание Jira issue прямо из карточки бага

## Как запустить

1. Скопируйте `.env.example` в `.env`
2. Укажите Slack bot token, signing secret, id канала и Slack ID модераторов
3. Укажите `GOOGLE_SHEETS_SPREADSHEET_ID` и Google service account credentials в `.env`
4. Для Jira заполните `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE_NAME`
5. Установите зависимости: `npm install`
6. Запустите сервис: `npm run dev`

## Slack setup

Нужны:

- Slash command `/bug` -> `POST https://your-domain/slack/commands`
- Interactivity Request URL -> `POST https://your-domain/slack/interactions`

Минимальные bot scopes:

- `commands`
- `chat:write`
- `chat:write.public`
- `channels:read`
- `groups:read`

## Jira

При выборе действия `Создать в Jira` модератор может оставить свой заголовок и комментарий, а если поля пустые, сервис сам соберет summary и description из bug card.

В Jira отправляются:

- проект по `JIRA_PROJECT_KEY`
- тип задачи по `JIRA_ISSUE_TYPE_NAME`
- summary
- description с основными полями бага
- ссылки `jiraKey` и `jiraUrl` сохраняются обратно в Slack карточку и Google Sheets

## Важно

Slack-данные хранятся в памяти процесса для быстрого доступа, а реестр и отчетность пишутся в Google Sheets. После рестарта исторические баги остаются в таблице, а in-memory индексы текущей сессии собираются заново.

Google credentials можно передавать либо через `.env`, либо через локальный JSON-файл. Безопаснее хранить их в `.env` и не коммитить JSON-ключ.

## Launcher в канале

Чтобы опубликовать или обновить launcher-сообщение с кнопкой `Report Bug`, вызовите:

```powershell
Invoke-WebRequest -Method POST http://127.0.0.1:3000/internal/publish-launcher
```

Если launcher уже был опубликован этим процессом, бот обновит его, а не создаст новый дубликат.
