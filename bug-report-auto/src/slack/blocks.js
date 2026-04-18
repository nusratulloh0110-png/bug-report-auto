import { ACTIONS } from "./constants.js";
import { encodeActionValue, plainText } from "./helpers.js";

const STATUS_LABELS = {
  new: "Новый",
  triage: "В работе",
  rejected: "Отклонен",
  duplicate: "Дубликат",
};

const PRIORITY_LABELS = {
  very_high: "Очень высокий",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

function formatMultiline(text) {
  return text ? text.replace(/\n/g, "\n> ") : "—";
}

export function buildBugBlocks(bug) {
  const jiraText = bug.jiraKey
    ? bug.jiraUrl
      ? `<${bug.jiraUrl}|${bug.jiraKey}>`
      : bug.jiraKey
    : "Не привязано";

  const duplicateText = bug.duplicateOf ? bug.duplicateOf : "—";
  const rejectionText = bug.rejectionReason || "—";

  return [
    {
      type: "header",
      text: plainText(`#${bug.bugId} Bug Report`),
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Статус:*\n${STATUS_LABELS[bug.status] || bug.status}` },
        { type: "mrkdwn", text: `*Приоритет:*\n${PRIORITY_LABELS[bug.priority] || bug.priority}` },
        { type: "mrkdwn", text: `*Автор:*\n<@${bug.reporterId}>` },
        { type: "mrkdwn", text: `*Айди клиники:*\n${bug.clinicId}` },
        { type: "mrkdwn", text: `*Раздел:*\n${bug.section}` },
        { type: "mrkdwn", text: `*Jira:*\n${jiraText}` },
        { type: "mrkdwn", text: `*Дубликат:*\n${duplicateText}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Описание*\n> ${formatMultiline(bug.description)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Комментарий к вложению*\n${bug.attachmentNote || "—"}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Создан: ${new Date(bug.createdAt).toLocaleString("ru-RU")}`,
        },
        {
          type: "mrkdwn",
          text: `Причина отклонения: ${rejectionText}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTIONS.TAKE_IN_WORK,
          text: plainText("В работу"),
          style: "primary",
          value: encodeActionValue({ bugId: bug.bugId }),
        },
        {
          type: "button",
          action_id: ACTIONS.OPEN_REJECT_MODAL,
          text: plainText("Отклонить"),
          style: "danger",
          value: encodeActionValue({ bugId: bug.bugId }),
        },
        {
          type: "button",
          action_id: ACTIONS.OPEN_DUPLICATE_MODAL,
          text: plainText("Дубликат"),
          value: encodeActionValue({ bugId: bug.bugId }),
        },
        {
          type: "button",
          action_id: ACTIONS.OPEN_LINK_JIRA_MODAL,
          text: plainText("Связать с Jira"),
          value: encodeActionValue({ bugId: bug.bugId }),
        },
      ],
    },
  ];
}

export function buildLauncherBlocks() {
  return [
    {
      type: "header",
      text: plainText("Bug Report Center"),
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Bug intake*\nНажмите `Report Bug`, чтобы открыть форму, заполнить данные по багу и затем при необходимости приложить файлы в тред.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTIONS.OPEN_BUG_MODAL,
          text: plainText("Report Bug"),
          style: "primary",
          value: encodeActionValue({ source: "launcher" }),
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Резервный вариант: используйте `/bug`, если кнопка недоступна.",
        },
      ],
    },
  ];
}
