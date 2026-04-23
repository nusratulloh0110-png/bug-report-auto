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
    `Bug ID: ${bug.bugId}`,
    `Reporter Slack ID: ${bug.reporterId || "n/a"}`,
    `Reporter name: ${bug.reporterName || "n/a"}`,
    `Product: ${bug.product || "n/a"}`,
    `Clinic ID: ${bug.clinicId || "n/a"}`,
    `Priority: ${bug.priority || "n/a"}`,
    `Section: ${bug.section || "n/a"}`,
    `Attachment note: ${bug.attachmentNote || "n/a"}`,
    `Created at: ${bug.createdAt || "n/a"}`,
  ];

  if (options.moderatorName) {
    items.push(`Created from Slack by moderator: ${options.moderatorName}`);
  }

  const content = [
    paragraph("Bug report imported from Slack."),
    bulletList(items),
    paragraph("Description"),
    paragraph(bug.description || "No description provided."),
  ];

  if (options.extraContext) {
    content.push(paragraph("Additional moderator note"));
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

  return parts.slice(0, 255) || `Slack bug ${bug.bugId}`;
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

  let errorText = `Jira API request failed with status ${response.status}.`;

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
      throw new Error("Jira integration is not configured in environment variables.");
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
      throw new Error("Jira integration is not configured in environment variables.");
    }

    return jiraRequest("/rest/api/3/myself");
  },
};
