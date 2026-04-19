import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  slackAppId: process.env.SLACK_APP_ID || "",
  slackClientId: process.env.SLACK_CLIENT_ID || "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET || "",
  slackVerificationToken: process.env.SLACK_VERIFICATION_TOKEN || "",
  slackBotToken: required("SLACK_BOT_TOKEN"),
  slackSigningSecret: required("SLACK_SIGNING_SECRET"),
  slackBugChannelId: required("SLACK_BUG_CHANNEL_ID"),
  slackModeratorIds: (process.env.SLACK_MODERATOR_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  googleServiceAccountKeyFile:
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
    "bug-report-bot-493711-c518a0fded50.json",
  googleSheetsSpreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
  googleClientEmail: process.env.GOOGLE_CLIENT_EMAIL || "",
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY || "",
  googleProjectId: process.env.GOOGLE_PROJECT_ID || "",
  reportTimezone: process.env.REPORT_TIMEZONE || "Asia/Tashkent",
  internalApiToken: process.env.INTERNAL_API_TOKEN || "",
};
