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
};
