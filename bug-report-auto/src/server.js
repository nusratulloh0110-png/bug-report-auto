import Fastify from "fastify";
import crypto from "node:crypto";
import { config } from "./config.js";
import { googleSheetsService } from "./google/sheets.js";
import { startJiraStatusSyncScheduler, startWeeklyReportScheduler } from "./reports/scheduler.js";
import { slackService } from "./slack/service.js";

const app = Fastify({
  logger: true,
});

const INTERNAL_API_TOKEN_PLACEHOLDER = "replace-with-a-long-random-token";

function getHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function tokenEquals(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));

  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function hasConfiguredInternalToken() {
  return Boolean(
    config.internalApiToken && config.internalApiToken !== INTERNAL_API_TOKEN_PLACEHOLDER
  );
}

function authorizeInternal(request, reply) {
  if (!hasConfiguredInternalToken()) {
    request.log.error("INTERNAL_API_TOKEN is not configured; rejecting internal API request");
    reply.code(503).send({ ok: false, error: "Internal API token is not configured" });
    return false;
  }

  const provided = getHeaderValue(request.headers["x-internal-token"]);
  if (!provided || !tokenEquals(provided, config.internalApiToken)) {
    reply.code(401).send({ ok: false, error: "Unauthorized" });
    return false;
  }

  return true;
}

app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (request, body, done) => {
    request.rawBody = body;
    done(null, Object.fromEntries(new URLSearchParams(body)));
  }
);

app.get("/health", async () => {
  return { ok: true };
});

app.post("/internal/publish-launcher", async (_request, reply) => {
  if (!authorizeInternal(_request, reply)) {
    return;
  }
  await slackService.postLauncherMessage();
  return reply.send({ ok: true });
});

app.post("/internal/post-weekly-report", async (_request, reply) => {
  if (!authorizeInternal(_request, reply)) {
    return;
  }
  await slackService.postPeriodicReport("weekly");
  return reply.send({ ok: true });
});

app.post("/internal/post-monthly-report", async (_request, reply) => {
  if (!authorizeInternal(_request, reply)) {
    return;
  }
  await slackService.postPeriodicReport("monthly");
  return reply.send({ ok: true });
});

app.post("/internal/reapply-sheet-formatting", async (_request, reply) => {
  if (!authorizeInternal(_request, reply)) {
    return;
  }
  await googleSheetsService.reapplyFormatting();
  return reply.send({ ok: true });
});

app.post("/slack/commands", async (request, reply) => {
  const rawBody = request.rawBody || "";

  if (!slackService.validateSlackRequest(rawBody, request.headers)) {
    return reply.code(401).send({ ok: false, error: "Invalid Slack signature" });
  }

  const response = await slackService.handleSlashCommand(request.body);
  return reply.send(response);
});

app.post("/slack/interactions", async (request, reply) => {
  const rawBody = request.rawBody || "";

  if (!slackService.validateSlackRequest(rawBody, request.headers)) {
    return reply.code(401).send({ ok: false, error: "Invalid Slack signature" });
  }

  const payload = JSON.parse(request.body.payload);
  const response = await slackService.handleInteraction(payload);
  return reply.send(response);
});

app.setErrorHandler((error, _request, reply) => {
  requestSafeLog(app, error);

  if (error.statusCode === 403) {
    return reply.code(200).send({
      response_type: "ephemeral",
      text: "Это действие доступно только модераторам.",
    });
  }

  return reply.code(error.statusCode || 500).send({
    ok: false,
    error: error.message || "Internal Server Error",
  });
});

function requestSafeLog(instance, error) {
  instance.log.error(
    {
      message: error.message,
      stack: error.stack,
    },
    "Unhandled application error"
  );
}

await slackService.initialize();
startWeeklyReportScheduler(slackService, googleSheetsService, app.log);
startJiraStatusSyncScheduler(slackService, app.log);

const address = await app.listen({
  port: config.port,
  host: "0.0.0.0",
});

app.log.info(`Server listening on ${address}`);
