import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";

const BUGS_SHEET_TITLE = "Bugs";
const DASHBOARD_SHEET_TITLE = "Dashboard";

const BUG_HEADERS = [
  "Bug ID",
  "Created At",
  "Updated At",
  "Status",
  "Clinic ID",
  "Priority",
  "Section",
  "Description",
  "Attachment Note",
  "Reporter ID",
  "Reporter Name",
  "Slack Channel ID",
  "Slack Message TS",
  "Slack Thread TS",
  "Jira Key",
  "Jira URL",
  "Duplicate Of",
  "Rejection Reason",
];

function asSheetRow(bug) {
  return [
    bug.bugId,
    bug.createdAt,
    bug.updatedAt,
    bug.status,
    bug.clinicId || "",
    bug.priority || "",
    bug.section || "",
    bug.description || "",
    bug.attachmentNote || "",
    bug.reporterId || "",
    bug.reporterName || "",
    bug.channelId || "",
    bug.messageTs || "",
    bug.threadTs || "",
    bug.jiraKey || "",
    bug.jiraUrl || "",
    bug.duplicateOf || "",
    bug.rejectionReason || "",
  ];
}

function escapeSheetTitle(value) {
  return `'${value.replace(/'/g, "''")}'`;
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

    if (!byTitle.has(BUGS_SHEET_TITLE)) {
      requests.push({
        addSheet: {
          properties: {
            title: BUGS_SHEET_TITLE,
            gridProperties: {
              rowCount: 1000,
              columnCount: BUG_HEADERS.length + 2,
              frozenRowCount: 1,
            },
            tabColorStyle: {
              rgbColor: { red: 0.11, green: 0.56, blue: 0.48 },
            },
          },
        },
      });
    }

    if (!byTitle.has(DASHBOARD_SHEET_TITLE)) {
      requests.push({
        addSheet: {
          properties: {
            title: DASHBOARD_SHEET_TITLE,
            gridProperties: {
              rowCount: 80,
              columnCount: 8,
              frozenRowCount: 3,
            },
            tabColorStyle: {
              rgbColor: { red: 0.18, green: 0.41, blue: 0.73 },
            },
          },
        },
      });
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
    await this.ensureDashboard();
    await this.applyFormatting();
  }

  async ensureBugHeaders() {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${BUGS_SHEET_TITLE}!A1:R1`,
      valueInputOption: "RAW",
      requestBody: { values: [BUG_HEADERS] },
    });
  }

  async ensureDashboard() {
    const bugsRef = escapeSheetTitle(BUGS_SHEET_TITLE);
    const values = [
      ["Bug Report Dashboard", "", "", "", "", "", "", ""],
      ["Последнее обновление", new Date().toISOString(), "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["Общее количество", `=COUNTA(${bugsRef}!A2:A)`],
      ["Активные", `=COUNTIF(${bugsRef}!D2:D,"triage")`],
      ["Новые", `=COUNTIF(${bugsRef}!D2:D,"new")`],
      ["Отклоненные", `=COUNTIF(${bugsRef}!D2:D,"rejected")`],
      ["Дубликаты", `=COUNTIF(${bugsRef}!D2:D,"duplicate")`],
      ["", "", "", "", "", "", "", ""],
      ["Статусы", "Количество", "", "Приоритеты", "Количество", "", "Разделы", "Количество"],
      ["new", `=COUNTIF(${bugsRef}!D2:D,"new")`, "", "very_high", `=COUNTIF(${bugsRef}!F2:F,"very_high")`, "", "Касса", `=COUNTIF(${bugsRef}!G2:G,"Касса")`],
      ["triage", `=COUNTIF(${bugsRef}!D2:D,"triage")`, "", "high", `=COUNTIF(${bugsRef}!F2:F,"high")`, "", "Склад", `=COUNTIF(${bugsRef}!G2:G,"Склад")`],
      ["rejected", `=COUNTIF(${bugsRef}!D2:D,"rejected")`, "", "medium", `=COUNTIF(${bugsRef}!F2:F,"medium")`, "", "ЛИС", `=COUNTIF(${bugsRef}!G2:G,"ЛИС")`],
      ["duplicate", `=COUNTIF(${bugsRef}!D2:D,"duplicate")`, "", "low", `=COUNTIF(${bugsRef}!F2:F,"low")`, "", "Другие", `=COUNTA(${bugsRef}!G2:G)-COUNTIF(${bugsRef}!G2:G,"Касса")-COUNTIF(${bugsRef}!G2:G,"Склад")-COUNTIF(${bugsRef}!G2:G,"ЛИС")`],
      ["", "", "", "", "", "", "", ""],
      ["Последние 10 багов", "", "", "", "", "", "", ""],
      [
        `=ARRAYFORMULA(IFERROR(QUERY({${bugsRef}!A2:A,${bugsRef}!D2:D,${bugsRef}!E2:E,${bugsRef}!F2:F,${bugsRef}!G2:G,${bugsRef}!B2:B},"select Col1,Col2,Col3,Col4,Col5,Col6 where Col1 is not null order by Col6 desc limit 10",0), ""))`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];

    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${DASHBOARD_SHEET_TITLE}!A1:H25`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }

  async applyFormatting() {
    const bugsSheetId = this.sheetIds[BUGS_SHEET_TITLE];
    const dashboardSheetId = this.sheetIds[DASHBOARD_SHEET_TITLE];

    const requests = [
      {
        repeatCell: {
          range: {
            sheetId: bugsSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: {
                rgbColor: { red: 0.11, green: 0.56, blue: 0.48 },
              },
              textFormat: {
                foregroundColorStyle: {
                  rgbColor: { red: 1, green: 1, blue: 1 },
                },
                bold: true,
              },
              horizontalAlignment: "CENTER",
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: bugsSheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: BUG_HEADERS.length,
          },
          properties: {
            pixelSize: 160,
          },
          fields: "pixelSize",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: dashboardSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: {
                rgbColor: { red: 0.18, green: 0.41, blue: 0.73 },
              },
              textFormat: {
                foregroundColorStyle: {
                  rgbColor: { red: 1, green: 1, blue: 1 },
                },
                fontSize: 16,
                bold: true,
              },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: dashboardSheetId,
            startRowIndex: 3,
            endRowIndex: 8,
            startColumnIndex: 0,
            endColumnIndex: 2,
          },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: {
                rgbColor: { red: 0.93, green: 0.97, blue: 1 },
              },
              textFormat: {
                bold: true,
              },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: dashboardSheetId,
            startRowIndex: 9,
            endRowIndex: 14,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: {
                rgbColor: { red: 0.95, green: 0.95, blue: 0.95 },
              },
              textFormat: {
                bold: true,
              },
            },
          },
          fields: "userEnteredFormat(backgroundColorStyle,textFormat)",
        },
      },
      {
        mergeCells: {
          range: {
            sheetId: dashboardSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
          mergeType: "MERGE_ALL",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: dashboardSheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: 8,
          },
          properties: {
            pixelSize: 150,
          },
          fields: "pixelSize",
        },
      },
    ];

    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      });
    } catch (_error) {
      // Ignore merge/formatting conflicts if the layout already exists.
    }
  }

  async getNextSequence() {
    if (!this.enabled) {
      return 1;
    }

    await this.initialize();

    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${BUGS_SHEET_TITLE}!A2:A`,
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
      range: `${BUGS_SHEET_TITLE}!A2:A`,
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
        range: `${BUGS_SHEET_TITLE}!A${existingRow}:R${existingRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
    } else {
      await this.sheetsApi.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${BUGS_SHEET_TITLE}!A:R`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
    }

    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${DASHBOARD_SHEET_TITLE}!B2`,
      valueInputOption: "RAW",
      requestBody: { values: [[new Date().toISOString()]] },
    });
  }
}

export const googleSheetsService = new GoogleSheetsService();
