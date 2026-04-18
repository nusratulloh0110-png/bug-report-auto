import { WebClient } from "@slack/web-api";
import { config } from "../config.js";

export const slackClient = new WebClient(config.slackBotToken);
