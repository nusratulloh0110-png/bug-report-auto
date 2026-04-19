import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";

const SHEETS = {
  bugs: "Реестр багов",
  dashboard: "Сводка",
  settings: "Настройки",
  moderators: "Модераторы",
  products: "Продукты",
  system: "Служебные данные",
};

const LEGACY_SHEET_TITLES = {
  "Р РµРµСЃС‚СЂ Р±Р°РіРѕРІ": SHEETS.bugs,
  "РЎРІРѕРґРєР°": SHEETS.dashboard,
  "РќР°СЃС‚СЂРѕР№РєРё": SHEETS.settings,
  "РњРѕРґРµСЂР°С‚РѕСЂС‹": SHEETS.moderators,
  "РџСЂРѕРґСѓРєС‚С‹": SHEETS.products,
  "РЎР»СѓР¶РµР±РЅС‹Рµ РґР°РЅРЅС‹Рµ": SHEETS.system,
};

const BUG_HEADERS = [
  "ID бага",
  "Создан",
  "Обновлен",
  "Статус",
  "Модератор",
  "Продукт",
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
const PRODUCT_HEADERS = ["Продукт", "Активен", "Комментарий"];
const SYSTEM_HEADERS = [
  "Bug ID",
  "Reporter ID",
  "Reporter Name",
  "Slack Channel ID",
  "Slack Message TS",
  "Slack Thread TS",
  "Assigned Moderator ID",
  "Assigned Moderator Name",
  "Status Raw",
  "Priority Raw",
  "Product",
  "Fixed At ISO",
  "Created At ISO",
  "Updated At ISO",
];

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

const LEGACY_STATUS_LABELS = {
  "РќРѕРІС‹Р№": "Новый",
  "Р’ СЂР°Р±РѕС‚Рµ": "В работе",
  "РћС‚РєР»РѕРЅРµРЅ": "Отклонен",
  "Р”СѓР±Р»РёРєР°С‚": "Дубликат",
  "РСЃРїСЂР°РІР»РµРЅРѕ": "Исправлено",
};

const LEGACY_PRIORITY_LABELS = {
  "РћС‡РµРЅСЊ РІС‹СЃРѕРєРёР№": "Очень высокий",
  "Р’С‹СЃРѕРєРёР№": "Высокий",
  "РЎСЂРµРґРЅРёР№": "Средний",
  "РќРёР·РєРёР№": "Низкий",
};

const LEGACY_PRODUCT_LABELS = {
  "Р›РРЎ": "ЛИС",
  "РЎРєР»Р°Рґ": "Склад",
  "РљР°СЃСЃР°": "Касса",
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

function normalizeLegacyStatus(status) {
  const normalized = String(status || "").trim();
  return LEGACY_STATUS_LABELS[normalized] || normalized;
}

function normalizeLegacyPriority(priority) {
  const normalized = String(priority || "").trim();
  return LEGACY_PRIORITY_LABELS[normalized] || normalized;
}

function normalizeLegacyProduct(product) {
  const normalized = String(product || "").trim();
  return LEGACY_PRODUCT_LABELS[normalized] || normalized;
}

function asSheetRow(bug) {
  return [
    bug.bugId,
    formatDisplayDate(bug.createdAt),
    formatDisplayDate(bug.updatedAt),
    formatStatus(bug.status),
    bug.assignedModeratorName || bug.assignedModeratorId || "",
    bug.product || "",
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
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

function rowsToBugEntries(rows) {
  return rows
    .filter((row) => row[0])
    .map((row) => ({
      bugId: row[0] || "",
      createdAt: row[1] || "",
      updatedAt: row[2] || "",
      status: normalizeLegacyStatus(row[3] || ""),
      moderator: row[4] || "",
      product: normalizeLegacyProduct(row[5] || ""),
      clinicId: row[6] || "",
      priority: normalizeLegacyPriority(row[7] || ""),
      section: row[8] || "",
      description: row[9] || "",
      attachmentNote: row[10] || "",
      reporter: row[11] || "",
      fixedAt: row[12] || "",
      jiraKey: row[13] || "",
      jiraUrl: row[14] || "",
      duplicateOf: row[15] || "",
      rejectionReason: row[16] || "",
    }));
}

function asSystemRow(bug) {
  return [
    bug.bugId,
    bug.reporterId || "",
    bug.reporterName || "",
    bug.channelId || "",
    bug.messageTs || "",
    bug.threadTs || "",
    bug.assignedModeratorId || "",
    bug.assignedModeratorName || "",
    bug.status || "",
    bug.priority || "",
    bug.product || "",
    bug.fixedAt || "",
    bug.createdAt || "",
    bug.updatedAt || "",
  ];
}

function rowsToSystemBugs(rows) {
  return rows
    .filter((row) => row[0])
    .map((row) => ({
      bugId: row[0] || "",
      reporterId: row[1] || "",
      reporterName: row[2] || "",
      channelId: row[3] || "",
      messageTs: row[4] || "",
      threadTs: row[5] || "",
      assignedModeratorId: row[6] || null,
      assignedModeratorName: row[7] || null,
      status: row[8] || "new",
      priority: row[9] || "",
      product: row[10] || "",
      fixedAt: row[11] || null,
      createdAt: row[12] || "",
      updatedAt: row[13] || "",
    }));
}

function buildDashboardValues(entries) {
  const productCounts = new Map();
  for (const entry of entries) {
    const product = entry.product || "Не указан";
    productCounts.set(product, (productCounts.get(product) || 0) + 1);
  }

  const sortedProducts = Array.from(productCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topProducts = sortedProducts.slice(0, 4);
  while (topProducts.length < 4) {
    topProducts.push(["—", 0]);
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
    ["Статусы", "Количество", "", "Приоритеты", "Количество", "", "Продукты", "Количество"],
    ["Новый", entries.filter((entry) => entry.status === "Новый").length, "", "Очень высокий", entries.filter((entry) => entry.priority === "Очень высокий").length, "", topProducts[0][0], topProducts[0][1]],
    ["В работе", entries.filter((entry) => entry.status === "В работе").length, "", "Высокий", entries.filter((entry) => entry.priority === "Высокий").length, "", topProducts[1][0], topProducts[1][1]],
    ["Отклонен", entries.filter((entry) => entry.status === "Отклонен").length, "", "Средний", entries.filter((entry) => entry.priority === "Средний").length, "", topProducts[2][0], topProducts[2][1]],
    ["Дубликат", entries.filter((entry) => entry.status === "Дубликат").length, "", "Низкий", entries.filter((entry) => entry.priority === "Низкий").length, "", topProducts[3][0], topProducts[3][1]],
    ["Исправлено", entries.filter((entry) => entry.status === "Исправлено").length, "", "", "", "", "", ""],
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
      `${entry.product ? `${entry.product} / ` : ""}${entry.section}`,
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

    for (const [legacyTitle, normalizedTitle] of Object.entries(LEGACY_SHEET_TITLES)) {
      if (byTitle.has(legacyTitle) && !byTitle.has(normalizedTitle)) {
        const properties = byTitle.get(legacyTitle);
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: properties.sheetId,
              title: normalizedTitle,
            },
            fields: "title",
          },
        });
        byTitle.set(normalizedTitle, properties);
      }
    }

    for (const title of Object.values(SHEETS)) {
      if (!byTitle.has(title)) {
        const columnCount =
          title === SHEETS.dashboard
            ? 8
            : title === SHEETS.settings
              ? 3
              : title === SHEETS.moderators
                ? 3
                : title === SHEETS.products
                  ? 3
                  : title === SHEETS.system
                    ? SYSTEM_HEADERS.length
                : BUG_HEADERS.length;
        requests.push({
          addSheet: {
            properties: {
              title,
              hidden: title === SHEETS.system,
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
    await this.ensureProductsSheet();
    await this.ensureSystemSheet();
    await this.migrateLegacyBugRows();
    await this.refreshDashboard();
    await this.applyFormatting();
  }

  async ensureBugHeaders() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A1:Q1`,
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

    if (!existingKeys.has("launcher_channel_id")) {
      rowsToAdd.push([
        "launcher_channel_id",
        config.slackBugChannelId || "",
        "Служебное поле: канал с launcher-сообщением",
      ]);
    }

    if (!existingKeys.has("launcher_message_ts")) {
      rowsToAdd.push([
        "launcher_message_ts",
        "",
        "Служебное поле: TS launcher-сообщения в Slack",
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

  async ensureProductsSheet() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.products}!A1:C1`,
      valueInputOption: "RAW",
      requestBody: { values: [PRODUCT_HEADERS] },
    });

    const existing = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.products}!A2:C100`,
    });

    const rows = existing.data.values || [];
    const existingProducts = new Set(rows.map((row) => row[0]).filter(Boolean));
    const defaults = ["ЛИС", "Склад", "Касса"]
      .filter((product) => !existingProducts.has(product))
      .map((product) => [product, "TRUE", "Базовый продукт"]);

    if (defaults.length > 0) {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.products}!A:C`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: defaults },
      });
    }
  }

  async ensureSystemSheet() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.system}!A1:N1`,
      valueInputOption: "RAW",
      requestBody: { values: [SYSTEM_HEADERS] },
    });
  }

  async migrateLegacyBugRows() {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A2:Q`,
    });

    const rows = response.data.values || [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const nextStatus = normalizeLegacyStatus(row[3] || "");
      const nextProduct = normalizeLegacyProduct(row[5] || "");
      const nextPriority = normalizeLegacyPriority(row[7] || "");

      if (nextStatus === (row[3] || "") && nextProduct === (row[5] || "") && nextPriority === (row[7] || "")) {
        continue;
      }

      const updatedRow = [...row];
      updatedRow[3] = nextStatus;
      updatedRow[5] = nextProduct;
      updatedRow[7] = nextPriority;

      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A${index + 2}:Q${index + 2}`,
        valueInputOption: "RAW",
        requestBody: { values: [updatedRow] },
      });
    }
  }

  async applyFormatting() {
    try {
      await this.resetBugConditionalFormatting();
    } catch (error) {
      console.error("Failed to reset conditional formatting", error);
    }

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
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.products], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.9, green: 0.9, blue: 0.98 } },
              textFormat: { bold: true },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        repeatCell: {
          range: { sheetId: this.sheetIds[SHEETS.system], startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: { red: 0.92, green: 0.92, blue: 0.92 } },
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
                backgroundColor: { red: 1, green: 0.96, blue: 0.74 },
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
                backgroundColor: { red: 1, green: 1, blue: 1 },
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
                backgroundColor: { red: 0.98, green: 0.84, blue: 0.84 },
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
                backgroundColor: { red: 0.85, green: 0.94, blue: 0.85 },
              },
            },
          },
        },
      },
    ];

    // Leave bug row background coloring to syncBug(), otherwise conditional rules
    // can override per-row colors after updates.
    requests.splice(6);

    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      });
    } catch (error) {
      console.error("Failed to apply sheet formatting", error);
      return;
    }

    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
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
          ],
        },
      });
    } catch (_error) {
      // Ignore only the repeated merge conflict.
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

  async reapplyFormatting() {
    if (!this.enabled) {
      return;
    }

    await this.initialize();
    await this.applyFormatting();
  }

  async getBugRows() {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.bugs}!A2:Q`,
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

  async ensureFreshSequence(bugStore) {
    if (!this.enabled) {
      return;
    }

    const nextSequence = await this.getNextSequence();
    bugStore.syncSequence(nextSequence);
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

  async findSystemRow(bugId) {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.system}!A2:A`,
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
    const systemRow = asSystemRow(bug);
    const [existingBugRow, existingSystemRow] = await Promise.all([
      this.findBugRow(bug.bugId),
      this.findSystemRow(bug.bugId),
    ]);
    const statusColors = {
      new: { red: 0.85, green: 0.93, blue: 1 },
      triage: { red: 1, green: 0.95, blue: 0.6 },
      fixed: { red: 0.72, green: 0.93, blue: 0.75 },
      rejected: { red: 0.96, green: 0.8, blue: 0.8 },
      duplicate: { red: 0.9, green: 0.9, blue: 0.9 },
    };
    let bugRowNumber = existingBugRow;

    if (existingBugRow) {
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A${existingBugRow}:Q${existingBugRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
    } else {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A:Q`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
      bugRowNumber = await this.findBugRow(bug.bugId);
    }

    if (existingSystemRow) {
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.system}!A${existingSystemRow}:N${existingSystemRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [systemRow] },
      });
    } else {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.system}!A:N`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [systemRow] },
      });
    }

    const backgroundColor = statusColors[bug.status] || { red: 1, green: 1, blue: 1 };
    if (bugRowNumber) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: this.sheetIds[SHEETS.bugs],
                  startRowIndex: bugRowNumber - 1,
                  endRowIndex: bugRowNumber,
                  startColumnIndex: 0,
                  endColumnIndex: BUG_HEADERS.length,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor,
                  },
                },
                fields: "userEnteredFormat.backgroundColor",
              },
            },
          ],
        },
      });
    }

    await this.refreshDashboard();
  }

  async loadPersistedBugs() {
    if (!this.enabled) {
      return [];
    }

    await this.initialize();

    const [visibleResponse, systemResponse] = await Promise.all([
      this.sheetsApi.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.bugs}!A2:Q`,
      }),
      this.sheetsApi.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEETS.system}!A2:N`,
      }),
    ]);

    const visibleEntries = rowsToBugEntries(visibleResponse.data.values || []);
    const systemEntries = rowsToSystemBugs(systemResponse.data.values || []);
    const visibleById = new Map(visibleEntries.map((entry) => [entry.bugId, entry]));
    const systemById = new Map(systemEntries.map((entry) => [entry.bugId, entry]));
    const allBugIds = new Set([...visibleById.keys(), ...systemById.keys()]);

    return Array.from(allBugIds).map((bugId) => {
      const entry = visibleById.get(bugId) || {};
      const system = systemById.get(bugId) || {};
      return {
        bugId,
        createdAt: system.createdAt || parseDisplayDate(entry.createdAt)?.toISOString() || new Date().toISOString(),
        updatedAt: system.updatedAt || parseDisplayDate(entry.updatedAt)?.toISOString() || new Date().toISOString(),
        status: system.status || "new",
        assignedModeratorId: system.assignedModeratorId || null,
        assignedModeratorName: system.assignedModeratorName || entry.moderator || null,
        product: system.product || entry.product || "",
        clinicId: entry.clinicId || "",
        priority: system.priority || "",
        section: entry.section || "",
        description: entry.description || "",
        attachmentNote: entry.attachmentNote || "",
        reporterId: system.reporterId || "",
        reporterName: system.reporterName || entry.reporter || "",
        fixedAt: system.fixedAt || null,
        jiraKey: entry.jiraKey || "",
        jiraUrl: entry.jiraUrl || "",
        duplicateOf: entry.duplicateOf || null,
        rejectionReason: entry.rejectionReason || null,
        channelId: system.channelId || "",
        messageTs: system.messageTs || "",
        threadTs: system.threadTs || "",
      };
    });
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
    const productResponse = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEETS.products}!A2:C100`,
    });

    const settingsMap = new Map(
      (settingsResponse.data.values || [])
        .filter((row) => row[0])
        .map((row) => [row[0], row[1] || ""])
    );

    const moderatorIds = (moderatorResponse.data.values || [])
      .filter((row) => row[0] && normalizeBoolean(row[2]))
      .map((row) => row[0]);
    const products = (productResponse.data.values || [])
      .filter((row) => row[0] && normalizeBoolean(row[1]))
      .map((row) => row[0]);

    return {
      channelId: settingsMap.get("slack_bug_channel_id") || config.slackBugChannelId,
      moderatorIds: moderatorIds.length > 0 ? moderatorIds : config.slackModeratorIds,
      products: products.length > 0 ? products : ["ЛИС", "Склад", "Касса"],
      weeklyReportEnabled: normalizeBoolean(settingsMap.get("weekly_report_enabled")),
      weeklyReportTime: settingsMap.get("weekly_report_time") || "09:00",
      weeklyReportTimezone: settingsMap.get("weekly_report_timezone") || config.reportTimezone,
      lastWeeklyReportAt: settingsMap.get("last_weekly_report_at") || "",
      launcherChannelId: settingsMap.get("launcher_channel_id") || "",
      launcherMessageTs: settingsMap.get("launcher_message_ts") || "",
    };
  }

  async getPersistedLauncher() {
    const runtimeConfig = await this.getRuntimeConfig();
    if (!runtimeConfig.launcherChannelId || !runtimeConfig.launcherMessageTs) {
      return null;
    }

    return {
      channelId: runtimeConfig.launcherChannelId,
      messageTs: runtimeConfig.launcherMessageTs,
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

  async persistLauncher(channelId, messageTs) {
    await this.upsertSetting("launcher_channel_id", channelId || "");
    await this.upsertSetting("launcher_message_ts", messageTs || "");
  }

  async buildReportSummary({ startDate = null, endDate = null, product = null } = {}) {
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
      if (
        product &&
        String(entry.product || "").trim().toLowerCase() !== String(product).trim().toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    const countBy = (field, value) => filtered.filter((entry) => entry[field] === value).length;
    const products = new Map();
    for (const entry of filtered) {
      const product = entry.product || "Не указан";
      products.set(product, (products.get(product) || 0) + 1);
    }

    const topProducts = Array.from(products.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `• ${name}: ${count}`)
      .join("\n");

    const periodLabel =
      startDate && endDate
        ? `${formatDisplayDate(startDate)} — ${formatDisplayDate(endDate)}`
        : "за все время";

    const productLabel = product ? `Продукт: ${product}` : null;

    return [
      `*Отчет по багам*`,
      `Период: ${periodLabel}`,
      ...(productLabel ? [productLabel] : []),
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
      topProducts ? `Топ продуктов:\n${topProducts}` : "Топ продуктов: нет данных",
    ].join("\n");
  }
}

export const googleSheetsService = new GoogleSheetsService();

