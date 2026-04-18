import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";

const SHEETS = {
  bugs: "Реестр багов",
  dashboard: "Сводка",
  settings: "Настройки",
  moderators: "Модераторы",
};

const BUG_HEADERS = [
  "ID бага",
  "Создан",
  "Обновлен",
  "Статус",
  "Модератор",
  "Айди клиники",
  "Приоритет",
  "Раздел",
  "Описание",
  "Комментарий к файлу",
  "Репортер",
  "Исправлен",
  "Jira Key",
  "Jira URL",
  "Дубликат",
  "Причина отклонения",
];

const SETTINGS_HEADERS = ["Ключ", "Значение", "Описание"];
const MODERATOR_HEADERS = ["Slack ID", "Имя / комментарий", "Активен"];

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

function formatDisplayDate(dateValue) {
  return new Date(dateValue).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function parseDisplayDate(value) {
  if (!value) {
    return null;
  }

  const isoDate = new Date(value);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const match = String(value).match(
    /^(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function formatStatus(status) {
  const normalized = String(status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "—";
}

function formatPriority(priority) {
  const normalized = String(priority || "").trim();
  return PRIORITY_LABELS[normalized] || normalized || "—";
}

function asSheetRow(bug) {
  return [
    bug.bugId,
    formatDisplayDate(bug.createdAt),
    formatDisplayDate(bug.updatedAt),
    formatStatus(bug.status),
    bug.assignedModeratorName || bug.assignedModeratorId || "",
    bug.clinicId || "",
    formatPriority(bug.priority),
    bug.section || "",
    bug.description || "",
    bug.attachmentNote || "",
    bug.reporterName || bug.reporterId || "",
    bug.fixedAt ? formatDisplayDate(bug.fixedAt) : "",
    bug.jiraKey || "",
    bug.jiraUrl || "",
    bug.duplicateOf || "",
    bug.rejectionReason || "",
  ];
}

function normalizeBoolean(value) {
  return String(value || "").trim().toLowerCase() !== "false";
}

function rowsToBugEntries(rows) {
  return rows
    .filter((row) => row[0])
    .map((row) => ({
      bugId: row[0] || "",
      createdAt: row[1] || "",
      updatedAt: row[2] || "",
      status: row[3] || "",
      moderator: row[4] || "",
      clinicId: row[5] || "",
      priority: row[6] || "",
      section: row[7] || "",
      description: row[8] || "",
      attachmentNote: row[9] || "",
      reporter: row[10] || "",
      fixedAt: row[11] || "",
      jiraKey: row[12] || "",
      jiraUrl: row[13] || "",
      duplicateOf: row[14] || "",
      rejectionReason: row[15] || "",
    }));
}

function buildDashboardValues(entries) {
  const sectionCounts = new Map();
  for (const entry of entries) {
    const section = entry.section || "Не указан";
    sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
  }

  const sortedSections = Array.from(sectionCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topSections = sortedSections.slice(0, 4);
  while (topSections.length < 4) {
    topSections.push(["—", 0]);
  }

  const latest = entries
    .slice()
    .sort((a, b) => {
      const left = parseDisplayDate(a.createdAt)?.getTime() || 0;
      const right = parseDisplayDate(b.createdAt)?.getTime() || 0;
      return right - left;
    })
    .slice(0, 10);

  const values = [
    ["Центр отчетности багов", "", "", "", "", "", "", ""],
    ["Последнее обновление", formatDisplayDate(new Date()), "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["Всего багов", entries.length, "", "", "", "", "", ""],
    ["Новые", entries.filter((entry) => entry.status === "Новый").length, "", "", "", "", "", ""],
    ["В работе", entries.filter((entry) => entry.status === "В работе").length, "", "", "", "", "", ""],
    ["Отклоненные", entries.filter((entry) => entry.status === "Отклонен").length, "", "", "", "", "", ""],
    ["Дубликаты", entries.filter((entry) => entry.status === "Дубликат").length, "", "", "", "", "", ""],
    ["Исправленные", entries.filter((entry) => entry.status === "Исправлено").length, "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["Статусы", "Количество", "", "Приоритеты", "Количество", "", "Разделы", "Количество"],
    ["Новый", entries.filter((entry) => entry.status === "Новый").length, "", "Очень высокий", entries.filter((entry) => entry.priority === "Очень высокий").length, "", topSections[0][0], topSections[0][1]],
    ["В работе", entries.filter((entry) => entry.status === "В работе").length, "", "Высокий", entries.filter((entry) => entry.priority === "Высокий").length, "", topSections[1][0], topSections[1][1]],
    ["Отклонен", entries.filter((entry) => entry.status === "Отклонен").length, "", "Средний", entries.filter((entry) => entry.priority === "Средний").length, "", topSections[2][0], topSections[2][1]],
    ["Дубликат", entries.filter((entry) => entry.status === "Дубликат").length, "", "Низкий", entries.filter((entry) => entry.priority === "Низкий").length, "", topSections[3][0], topSections[3][1]],
    ["", "", "", "", "", "", "", ""],
    ["Последние 10 багов", "", "", "", "", "", "", ""],
    ["ID бага", "Статус", "Клиника", "Приоритет", "Раздел", "Создан", "", ""],
  ];

  for (const entry of latest) {
    values.push([
      entry.bugId,
      entry.status,
      entry.clinicId,
      entry.priority,
      entry.section,
      entry.createdAt,
      "",
      "",
    ]);
  }

  while (values.length < 28) {
    values.push(["", "", "", "", "", "", "", ""]);
  }

  return values;
}

class GoogleSheetsService {
  constructor() {
    this.enabled = Boolean(config.googleSheetsSpreadsheetId);
    this.spreadsheetId = config.googleSheetsSpreadsheetId;
    this.keyFile = path.resolve(process.cwd(), config.googleServiceAccountKeyFile);
    this.useEnvCredentials = Boolean(config.googleClientEmail && config.googlePrivateKey);
    this.sheetIds = {};
    this.initialized = false;
    this.sheetsApi = null;
  }

  async initialize() {
    if (!this.enabled || this.initialized) {
      return;
    }

    const auth = this.useEnvCredentials
      ? new google.auth.GoogleAuth({
          credentials: {
            client_email: config.googleClientEmail,
            private_key: config.googlePrivateKey.replace(/\\n/g, "\n"),
            project_id: config.googleProjectId || undefined,
          },
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        })
      : new google.auth.GoogleAuth({
          keyFile: this.keyFile,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

    this.sheetsApi = google.sheets({
      version: "v4",
      auth,
    });

    const metadata = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    await this.ensureSheets(metadata.data.sheets || []);
    this.initialized = true;
  }

  async ensureSheets(existingSheets) {
    const byTitle = new Map(
      existingSheets.map((sheet) => [sheet.properties?.title, sheet.properties])
    );
    const requests = [];

    for (const title of Object.values(SHEETS)) {
      if (!byTitle.has(title)) {
        const columnCount =
          title === SHEETS.dashboard
            ? 8
            : title === SHEETS.settings
              ? 3
              : title === SHEETS.moderators
                ? 3
                : BUG_HEADERS.length;
        requests.push({
          addSheet: {
            properties: {
              title,
              gridProperties: {
                rowCount: title === SHEETS.dashboard ? 80 : 1000,
                columnCount,
                frozenRowCount: title === SHEETS.dashboard ? 3 : 1,
              },
            },
          },
        });
      }
    }

    if (requests.length > 0) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      });
    }

    const refreshed = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    for (const sheet of refreshed.data.sheets || []) {
      this.sheetIds[sheet.properties.title] = sheet.properties.sheetId;
    }

    await this.ensureBugHeaders();
    await this.ensureSettingsSheet();
    await this.ensureModeratorsSheet();
    await this.refreshDashboard();
    await this.applyFormatting();
  }

  async ensureBugHeaders() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A1:P1`,
      valueInputOption: "RAW",
      requestBody: { values: [BUG_HEADERS] },
    });
  }

  async ensureSettingsSheet() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.settings}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: { values: [SETTINGS_HEADERS] },
    });

    const existing = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.settings}!A2:C100`,
    });

    const rows = existing.data.values || [];
    const existingKeys = new Set(rows.map((row) => row[0]).filter(Boolean));
    const rowsToAdd = [];

    if (!existingKeys.has("slack_bug_channel_id")) {
      rowsToAdd.push([
        "slack_bug_channel_id",
        config.slackBugChannelId || "",
        "Канал Slack, куда бот публикует баги и отчеты",
      ]);
    }

    if (!existingKeys.has("weekly_report_enabled")) {
      rowsToAdd.push([
        "weekly_report_enabled",
        "TRUE",
        "Отправлять еженедельный отчет автоматически",
      ]);
    }

    if (!existingKeys.has("weekly_report_time")) {
      rowsToAdd.push([
        "weekly_report_time",
        "09:00",
        "Время отправки еженедельного отчета",
      ]);
    }

    if (!existingKeys.has("weekly_report_timezone")) {
      rowsToAdd.push([
        "weekly_report_timezone",
        config.reportTimezone,
        "Таймзона для автоматического еженедельного отчета",
      ]);
    }

    if (!existingKeys.has("last_weekly_report_at")) {
      rowsToAdd.push([
        "last_weekly_report_at",
        "",
        "Служебное поле: когда еженедельный отчет был отправлен в последний раз",
      ]);
    }

    if (rowsToAdd.length > 0) {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.settings}!A:C`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: rowsToAdd,
        },
      });
    }
  }

  async ensureModeratorsSheet() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.moderators}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: { values: [MODERATOR_HEADERS] },
    });

    const existing = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.moderators}!A2:C100`,
    });

    const rows = existing.data.values || [];
    const existingIds = new Set(rows.map((row) => row[0]).filter(Boolean));
    const rowsToAdd = config.slackModeratorIds
      .filter((id) => !existingIds.has(id))
      .map((id) => [id, "Основной модератор", "TRUE"]);

    if (rowsToAdd.length > 0) {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.moderators}!A:C`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rowsToAdd },
      });
    }
  }

  async applyFormatting() {
    await this.resetBugConditionalFormatting();

    const requests = [
      {
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.bugs], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.1, green: 0.56, blue: 0.48 } },
              textFormat: {
                foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                bold: true,
              },
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.dashboard], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.18, green: 0.41, blue: 0.73 } },
              textFormat: {
                foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                bold: true,
                fontSize: 16,
              },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.settings], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.98, green: 0.89, blue: 0.7 } },
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.moderators], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.89, green: 0.95, blue: 0.89 } },
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [
              {
                sheetId: this.sheetIds[SHEETS.bugs],
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: BUG_HEADERS.length,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$D2=\"В работе\"" }],
              },
              format: {
                backgroundColorStyle: {
                  rgbColor: { red: 1, green: 0.96, blue: 0.74 },
                },
              },
            },
          },
        },
      },
      {
        addConditionalFormatRule: {
          index: 1,
          rule: {
            ranges: [
              {
                sheetId: this.sheetIds[SHEETS.bugs],
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: BUG_HEADERS.length,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$D2=\"Дубликат\"" }],
              },
              format: {
                backgroundColorStyle: {
                  rgbColor: { red: 1, green: 1, blue: 1 },
                },
              },
            },
          },
        },
      },
      {
        addConditionalFormatRule: {
          index: 2,
          rule: {
            ranges: [
              {
                sheetId: this.sheetIds[SHEETS.bugs],
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: BUG_HEADERS.length,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$D2=\"Отклонен\"" }],
              },
              format: {
                backgroundColorStyle: {
                  rgbColor: { red: 0.98, green: 0.84, blue: 0.84 },
                },
              },
            },
          },
        },
      },
      {
        addConditionalFormatRule: {
          index: 3,
          rule: {
            ranges: [
              {
                sheetId: this.sheetIds[SHEETS.bugs],
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: BUG_HEADERS.length,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$D2=\"Исправлено\"" }],
              },
              format: {
                backgroundColorStyle: {
                  rgbColor: { red: 0.85, green: 0.94, blue: 0.85 },
                },
              },
            },
          },
        },
      },
      {
        mergeCells: {
          range: {
            sheetId: this.sheetIds[SHEETS.dashboard],
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
          mergeType: "MERGE_ALL",
        },
      },
    ];

    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      });
    } catch (_error) {
      // Safe to ignore when formatting is already present.
    }
  }

  async resetBugConditionalFormatting() {
    const spreadsheet = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: "sheets(properties(sheetId,title),conditionalFormats)",
    });

    const bugSheet = (spreadsheet.data.sheets || []).find(
      (sheet) => sheet.properties?.sheetId === this.sheetIds[SHEETS.bugs]
    );

    const ruleCount = bugSheet?.conditionalFormats?.length || 0;
    if (ruleCount === 0) {
      return;
    }

    const requests = [];
    for (let index = ruleCount - 1; index >= 0; index -= 1) {
      requests.push({
        deleteConditionalFormatRule: {
          sheetId: this.sheetIds[SHEETS.bugs],
          index,
        },
      });
    }

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  async getBugRows() {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A2:P`,
    });

    return rowsToBugEntries(response.data.values || []);
  }

  async refreshDashboard() {
    if (!this.enabled) {
      return;
    }

    const entries = await this.getBugRows();
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.dashboard}!A1:H40`,
      valueInputOption: "RAW",
      requestBody: { values: buildDashboardValues(entries) },
    });
  }

  async getNextSequence() {
    if (!this.enabled) {
      return 1;
    }

    await this.initialize();

    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A2:A`,
    });

    const rows = response.data.values || [];
    let max = 0;

    for (const [bugId] of rows) {
      const match = String(bugId || "").match(/^BUG-(\d+)$/);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    }

    return max + 1;
  }

  async findBugRow(bugId) {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A2:A`,
    });

    const rows = response.data.values || [];
    const index = rows.findIndex(([value]) => value === bugId);
    return index === -1 ? null : index + 2;
  }

  async syncBug(bug) {
    if (!this.enabled) {
      return null;
    }

    await this.initialize();

    const row = asSheetRow(bug);
    const existingRow = await this.findBugRow(bug.bugId);

    if (existingRow) {
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A${existingRow}:P${existingRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
    } else {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A:P`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
    }

    await this.refreshDashboard();
  }

  async getRuntimeConfig() {
    await this.initialize();

    const settingsResponse = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.settings}!A2:C100`,
    });
    const moderatorResponse = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.moderators}!A2:C100`,
    });

    const settingsMap = new Map(
      (settingsResponse.data.values || [])
        .filter((row) => row[0])
        .map((row) => [row[0], row[1] || ""])
    );

    const moderatorIds = (moderatorResponse.data.values || [])
      .filter((row) => row[0] && normalizeBoolean(row[2]))
      .map((row) => row[0]);

    return {
      channelId: settingsMap.get("slack_bug_channel_id") || config.slackBugChannelId,
      moderatorIds: moderatorIds.length > 0 ? moderatorIds : config.slackModeratorIds,
      weeklyReportEnabled: normalizeBoolean(settingsMap.get("weekly_report_enabled")),
      weeklyReportTime: settingsMap.get("weekly_report_time") || "09:00",
      weeklyReportTimezone: settingsMap.get("weekly_report_timezone") || config.reportTimezone,
      lastWeeklyReportAt: settingsMap.get("last_weekly_report_at") || "",
    };
  }

  async upsertSetting(key, value) {
    await this.initialize();

    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.settings}!A2:C100`,
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === key);

    if (rowIndex >= 0) {
      const actualRow = rowIndex + 2;
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.settings}!B${actualRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[value]] },
      });
      return;
    }

    await this.sheetsApi.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.settings}!A:C`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[key, value, "Добавлено автоматически"]] },
    });
  }

  async buildReportSummary({ startDate = null, endDate = null } = {}) {
    await this.initialize();
    const entries = await this.getBugRows();
    const filtered = entries.filter((entry) => {
      const createdAt = parseDisplayDate(entry.createdAt);
      if (!createdAt) {
        return false;
      }
      if (startDate && createdAt < startDate) {
        return false;
      }
      if (endDate && createdAt > endDate) {
        return false;
      }
      return true;
    });

    const countBy = (field, value) => filtered.filter((entry) => entry[field] === value).length;
    const sections = new Map();
    for (const entry of filtered) {
      const section = entry.section || "Не указан";
      sections.set(section, (sections.get(section) || 0) + 1);
    }

    const topSections = Array.from(sections.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `• ${name}: ${count}`)
      .join("\n");

    const periodLabel =
      startDate && endDate
        ? `${formatDisplayDate(startDate)} — ${formatDisplayDate(endDate)}`
        : "за все время";

    return [
      `*Отчет по багам*`,
      `Период: ${periodLabel}`,
      `Всего: ${filtered.length}`,
      `Новые: ${countBy("status", "Новый")}`,
      `В работе: ${countBy("status", "В работе")}`,
      `Отклоненные: ${countBy("status", "Отклонен")}`,
      `Дубликаты: ${countBy("status", "Дубликат")}`,
      `Исправленные: ${countBy("status", "Исправлено")}`,
      `Очень высокий приоритет: ${countBy("priority", "Очень высокий")}`,
      `Высокий приоритет: ${countBy("priority", "Высокий")}`,
      `Средний приоритет: ${countBy("priority", "Средний")}`,
      `Низкий приоритет: ${countBy("priority", "Низкий")}`,
      topSections ? `Топ разделов:\n${topSections}` : "Топ разделов: нет данных",
    ].join("\n");
  }
}

export const googleSheetsService = new GoogleSheetsService();
