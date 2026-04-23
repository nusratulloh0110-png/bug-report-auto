import { ACTIONS } from "./constants.js";
import { encodeActionValue, formatDisplayDate, plainText } from "./helpers.js";

const STATUS_LABELS = {
  new: "Новый",
  triage: "В работе",
  rejected: "Отклонен",
  duplicate: "Дубликат",
  fixed: "Исправлено",
};

const PRIORITY_LABELS = {
  very_high: "Очень высокий",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

function buildNewBugActions(bug) {
  return {
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
        type: "overflow",
        action_id: ACTIONS.MODERATOR_MORE,
        options: [
          {
            text: plainText("Отклонить"),
            value: encodeActionValue({ bugId: bug.bugId, action: ACTIONS.OPEN_REJECT_MODAL }),
          },
          {
            text: plainText("Дубликат"),
            value: encodeActionValue({ bugId: bug.bugId, action: ACTIONS.OPEN_DUPLICATE_MODAL }),
          },
          {
            text: plainText("Создать в Jira"),
            value: encodeActionValue({ bugId: bug.bugId, action: ACTIONS.OPEN_LINK_JIRA_MODAL }),
          },
        ],
      },
    ],
  };
}

function buildTriageActions(bug) {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: ACTIONS.MARK_FIXED,
        text: plainText("Исправлено"),
        style: "primary",
        value: encodeActionValue({ bugId: bug.bugId }),
      },
    ],
  };
}

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
  const moderatorText = bug.assignedModeratorId ? `<@${bug.assignedModeratorId}>` : "—";
  const fixedText = bug.fixedAt ? formatDisplayDate(bug.fixedAt) : "—";

  const blocks = [
    {
      type: "header",
      text: plainText(`#${bug.bugId} Баг-репорт`),
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Статус:*\n${STATUS_LABELS[bug.status] || bug.status}` },
        { type: "mrkdwn", text: `*Приоритет:*\n${PRIORITY_LABELS[bug.priority] || bug.priority}` },
        { type: "mrkdwn", text: `*Репортер:*\n<@${bug.reporterId}>` },
        { type: "mrkdwn", text: `*Модератор:*\n${moderatorText}` },
        { type: "mrkdwn", text: `*Продукт:*\n${bug.product || "—"}` },
        { type: "mrkdwn", text: `*Айди клиники:*\n${bug.clinicId || "—"}` },
        { type: "mrkdwn", text: `*Роль пользователя:*\n${bug.userRole || "—"}` },
        { type: "mrkdwn", text: `*Раздел:*\n${bug.section || "—"}` },
        { type: "mrkdwn", text: `*Связь с Jira:*\n${jiraText}` },
        { type: "mrkdwn", text: `*Дубликат:*\n${duplicateText}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Шаги воспроизведения*\n> ${formatMultiline(bug.reproductionSteps)}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Ожидаемый результат*\n> ${formatMultiline(bug.expectedResult)}`,
        },
        {
          type: "mrkdwn",
          text: `*Фактический результат*\n> ${formatMultiline(bug.actualResult)}`,
        },
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
          text: `Создан: ${formatDisplayDate(bug.createdAt)}`,
        },
        {
          type: "mrkdwn",
          text: `Причина отклонения: ${rejectionText}`,
        },
        {
          type: "mrkdwn",
          text: `Исправлен: ${fixedText}`,
        },
      ],
    },
  ];

  if (bug.status === "new") {
    blocks.push(buildNewBugActions(bug));
  }

  if (bug.status === "triage") {
    blocks.push(buildTriageActions(bug));
  }

  return blocks;
}

export function buildLauncherBlocks() {
  return [
    {
      type: "header",
      text: plainText("Центр баг-репортов"),
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Подача бага*\nНажмите кнопку ниже, чтобы открыть форму, заполнить данные по багу и затем при необходимости приложить файлы в тред.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: ACTIONS.OPEN_BUG_MODAL,
          text: plainText("Сообщить о баге"),
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
