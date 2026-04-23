import { Buffer } from "node:buffer";
import { config } from "../config.js";

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

function textNode(text) {
  return {
    type: "text",
    text: String(text || ""),
  };
}

function paragraph(text) {
  return {
    type: "paragraph",
    content: [textNode(text)],
  };
}

function bulletList(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [textNode(item)],
        },
      ],
    })),
  };
}

function buildDescriptionDocument(bug, options = {}) {
  const items = [
    `ID бага: ${bug.bugId}`,
    `Slack ID репортера: ${bug.reporterId || "не указан"}`,
    `Имя репортера: ${bug.reporterName || "не указано"}`,
    `Продукт: ${bug.product || "не указан"}`,
    `ID клиники: ${bug.clinicId || "не указан"}`,
    `Приоритет: ${bug.priority || "не указан"}`,
    `Раздел: ${bug.section || "не указан"}`,
    `Комментарий к вложению: ${bug.attachmentNote || "не указан"}`,
    `Создано: ${bug.createdAt || "не указано"}`,
  ];

  if (options.moderatorName) {
    items.push(`Создано из Slack модератором: ${options.moderatorName}`);
  }

  const content = [
    paragraph("Баг-репорт импортирован из Slack."),
    bulletList(items),
    paragraph("Описание"),
    paragraph(bug.description || "Описание не указано."),
  ];

  if (options.extraContext) {
    content.push(paragraph("Комментарий модератора"));
    content.push(paragraph(options.extraContext));
  }

  return {
    version: 1,
    type: "doc",
    content,
  };
}

function buildSummary(bug, summaryOverride = "") {
  const custom = String(summaryOverride || "").trim();
  if (custom) {
    return custom.slice(0, 255);
  }

  const parts = [bug.bugId, bug.product, bug.section, bug.description]
    .filter(Boolean)
    .join(" | ");

  return parts.slice(0, 255) || `Баг из Slack ${bug.bugId}`;
}

async function jiraRequest(path, body) {
  const response = await fetch(`${config.jiraBaseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${config.jiraEmail}:${config.jiraApiToken}`
      ).toString("base64")}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.ok) {
    return response.json();
  }

  let errorText = `Ошибка Jira API: статус ${response.status}.`;

  try {
    const payload = await response.json();
    const messages = [
      ...(Array.isArray(payload.errorMessages) ? payload.errorMessages : []),
      ...Object.values(payload.errors || {}),
    ].filter(Boolean);
    if (messages.length > 0) {
      errorText = messages.join(" ");
    }
  } catch {
    // Ignore non-JSON error bodies.
  }

  throw new Error(errorText);
}

export const jiraClient = {
  isConfigured() {
    return Boolean(
      config.jiraBaseUrl &&
        config.jiraEmail &&
        config.jiraApiToken &&
        config.jiraProjectKey &&
        config.jiraIssueTypeName
    );
  },

  getIssueUrl(issueKey) {
    return `${config.jiraBaseUrl}/browse/${issueKey}`;
  },

  async createIssueFromBug(bug, options = {}) {
    if (!this.isConfigured()) {
      throw new Error("Интеграция Jira не настроена в переменных окружения.");
    }

    const labels = ["slack-bug-report", normalizeLabel(bug.bugId), normalizeLabel(bug.product)]
      .filter(Boolean)
      .slice(0, 10);

    const payload = await jiraRequest("/rest/api/3/issue", {
      fields: {
        project: {
          key: config.jiraProjectKey,
        },
        issuetype: {
          name: config.jiraIssueTypeName,
        },
        summary: buildSummary(bug, options.summary),
        description: buildDescriptionDocument(bug, {
          moderatorName: options.moderatorName,
          extraContext: options.extraContext,
        }),
        labels,
      },
    });

    return {
      key: payload.key,
      url: this.getIssueUrl(payload.key),
      id: payload.id,
    };
  },

  async validateConnection() {
    if (!this.isConfigured()) {
      throw new Error("Интеграция Jira не настроена в переменных окружения.");
    }

    return jiraRequest("/rest/api/3/myself");
  },
};
