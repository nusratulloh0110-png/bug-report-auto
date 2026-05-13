import { Buffer } from "node:buffer";
import { config } from "../config.js";

const PRIORITY_LABELS = {
  very_high: "Очень высокий",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

function formatPriority(priority) {
  return PRIORITY_LABELS[String(priority || "").trim()] || String(priority || "").trim() || "не указан";
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
    `Роль пользователя: ${bug.userRole || "не указана"}`,
    `Приоритет: ${formatPriority(bug.priority)}`,
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
    paragraph("Шаги воспроизведения"),
    paragraph(bug.reproductionSteps || "Не указаны."),
    paragraph("Ожидаемый результат"),
    paragraph(bug.expectedResult || "Не указан."),
    paragraph("Фактический результат"),
    paragraph(bug.actualResult || "Не указан."),
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

  const parts = [bug.bugId, bug.product, bug.section, bug.actualResult || bug.description]
    .filter(Boolean)
    .join(" | ");

  return parts.slice(0, 255) || `Баг из Slack ${bug.bugId}`;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueMessages(messages) {
  return Array.from(new Set(messages.map((message) => String(message || "").trim()).filter(Boolean)));
}

function translateJiraMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "";
  }

  if (/指定有效的事务类型|specify a valid issue type/i.test(text)) {
    return `Jira не приняла тип задачи "${config.jiraIssueTypeName}". Проверьте JIRA_ISSUE_TYPE_NAME/JIRA_ISSUE_TYPE_ID и убедитесь, что этот тип доступен в выбранном проекте.`;
  }

  const chineseProjectMatch = text.match(/没有找到有密钥[“"]([^”"]+)[”"]的项目/);
  if (chineseProjectMatch) {
    return `Jira не видит проект с ключом "${chineseProjectMatch[1]}". Проверьте ключ проекта и права API-пользователя.`;
  }

  if (/No project could be found with key/i.test(text)) {
    return `${text} Проверьте ключ проекта и права API-пользователя.`;
  }

  if (
    /您无法在此项目中创建事务|cannot create.*(?:issue|transaction).*project|не можете создавать задачи.*проект/i.test(
      text
    )
  ) {
    return "У API-пользователя Jira нет права создавать задачи в выбранном проекте.";
  }

  if (/未获得执行此操作的授权|not authorized|permission|нет прав.*выполн/i.test(text)) {
    return "Jira не авторизовала API-пользователя для этого действия. Проверьте email/API token и права проекта.";
  }

  return text;
}

function buildJiraErrorText(response, payload) {
  const messages = [
    ...(Array.isArray(payload?.errorMessages) ? payload.errorMessages : []),
    ...Object.values(payload?.errors || {}),
  ];
  const translated = uniqueMessages(messages.map(translateJiraMessage));

  if (translated.length > 0) {
    return translated.join(" ");
  }

  return `Ошибка Jira API: статус ${response.status}.`;
}

async function jiraRequest(path, body) {
  const response = await fetch(`${config.jiraBaseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${config.jiraEmail}:${config.jiraApiToken}`
      ).toString("base64")}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (response.ok) {
    return response.json();
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Ошибка Jira API: статус ${response.status}.`);
  }

  throw new Error(buildJiraErrorText(response, payload));
}

async function resolveIssueTypeForProject(projectKey) {
  if (config.jiraIssueTypeId) {
    return { id: config.jiraIssueTypeId };
  }

  const payload = await jiraRequest(
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`
  );
  const issueTypes = payload.issueTypes || [];
  if (issueTypes.length === 0) {
    throw new Error(
      `Jira не вернула доступные типы задач для проекта "${projectKey}". Проверьте ключ проекта и права API-пользователя на создание задач.`
    );
  }

  const expected = normalizeName(config.jiraIssueTypeName);
  const issueType = issueTypes.find((candidate) => {
    return (
      normalizeName(candidate.name) === expected ||
      normalizeName(candidate.untranslatedName) === expected
    );
  });

  if (!issueType) {
    const available = issueTypes
      .map((candidate) => candidate.name || candidate.untranslatedName)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `В проекте "${projectKey}" нет типа задачи "${config.jiraIssueTypeName}". Доступные типы: ${available || "не найдены"}.`
    );
  }

  return { id: issueType.id };
}

function normalizeStatusName(value) {
  return String(value || "").trim().toLowerCase();
}

function isDoneStatus(status) {
  const name = normalizeStatusName(status?.name);
  const categoryKey = normalizeStatusName(status?.statusCategory?.key);

  return (
    categoryKey === "done" ||
    ["готово", "done", "закрыто", "закрыт", "resolved", "выполнено"].includes(name)
  );
}

export const jiraClient = {
  isConfigured() {
    return Boolean(
      config.jiraBaseUrl &&
        config.jiraEmail &&
        config.jiraApiToken &&
        config.jiraIssueTypeName
    );
  },

  getIssueUrl(issueKey) {
    if (!config.jiraBaseUrl || !issueKey) {
      return "";
    }

    return `${config.jiraBaseUrl}/browse/${issueKey}`;
  },

  async createIssueFromBug(bug, options = {}) {
    if (!this.isConfigured()) {
      throw new Error("Интеграция Jira не настроена в переменных окружения.");
    }

    const projectKey = String(options.projectKey || config.jiraProjectKey || "").trim();
    if (!projectKey) {
      throw new Error("Не указан ключ проекта Jira.");
    }
    const issueType = await resolveIssueTypeForProject(projectKey);

    const labels = ["slack-bug-report", normalizeLabel(bug.bugId), normalizeLabel(bug.product)]
      .filter(Boolean)
      .slice(0, 10);

    const payload = await jiraRequest("/rest/api/3/issue", {
      fields: {
        project: {
          key: projectKey,
        },
        issuetype: issueType,
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

  async getIssueStatus(issueKey) {
    if (!this.isConfigured()) {
      throw new Error("Интеграция Jira не настроена в переменных окружения.");
    }

    const payload = await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`,
    );

    return payload.fields?.status || null;
  },

  isDoneStatus,

  async listProjects() {
    if (!this.isConfigured()) {
      return [];
    }

    const projects = [];
    let startAt = 0;
    const maxResults = 50;

    while (projects.length < 100) {
      const payload = await jiraRequest(
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}&orderBy=key`
      );
      const values = payload.values || [];
      projects.push(
        ...values.map((project) => ({
          key: project.key,
          name: project.name,
        }))
      );

      if (payload.isLast || values.length === 0) {
        break;
      }

      startAt += values.length;
    }

    return projects.filter((project) => project.key);
  },

  async listProjectsSupportingIssueType(issueTypeName = config.jiraIssueTypeName) {
    const projects = await this.listProjects();
    const supportedProjects = [];

    for (const project of projects) {
      try {
        const payload = await jiraRequest(
          `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(
            project.key
          )}&expand=projects.issuetypes`
        );
        const issueTypes = payload.projects?.[0]?.issuetypes || [];
        const supportsIssueType = issueTypes.some(
          (issueType) => issueType.name === issueTypeName
        );

        if (supportsIssueType) {
          supportedProjects.push(project);
        }
      } catch (error) {
        console.error(`Failed to load Jira issue types for ${project.key}`, error);
      }
    }

    return supportedProjects;
  },

  async validateConnection() {
    if (!this.isConfigured()) {
      throw new Error("Интеграция Jira не настроена в переменных окружения.");
    }

    return jiraRequest("/rest/api/3/myself");
  },
};
