import crypto from "node:crypto";
import { config } from "../config.js";
import { googleSheetsService } from "../google/sheets.js";
import { bugStore } from "../store/bug-store.js";
import { launcherStore } from "../store/launcher-store.js";
import { buildBugBlocks, buildLauncherBlocks } from "./blocks.js";
import { slackClient } from "./client.js";
import { ACTIONS, CALLBACKS } from "./constants.js";
import {
  decodeActionValue,
  extractPlainTextValue,
  extractSelectedOptionValue,
  extractStaticValue,
} from "./helpers.js";
import {
  buildBugReportModal,
  buildDuplicateModal,
  buildLinkJiraModal,
  buildRejectModal,
} from "./views.js";

function parseMetadata(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function validateSlackSignature(rawBody, timestamp, signature) {
  if (!timestamp || !signature) {
    return false;
  }

  const fiveMinutes = 60 * 5;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > fiveMinutes) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto
    .createHmac("sha256", config.slackSigningSecret)
    .update(baseString)
    .digest("hex")}`;

  if (digest.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function ensureModerator(userId, moderatorIds) {
  if (!moderatorIds.includes(userId)) {
    const error = new Error("Only moderators can use this action.");
    error.statusCode = 403;
    throw error;
  }
}

function normalizeBugFromSubmission(view, user) {
  const state = view.state;
  return {
    clinicId: extractPlainTextValue(state, "clinic_id_block", "clinic_id_input"),
    product: extractStaticValue(state, "product_block", "product_select"),
    description: extractPlainTextValue(state, "description_block", "description_input"),
    priority: extractStaticValue(state, "priority_block", "priority_select"),
    section: extractPlainTextValue(state, "section_block", "section_input"),
    attachmentNote: extractPlainTextValue(
      state,
      "attachment_note_block",
      "attachment_note_input"
    ),
    reporterId: user.id,
    reporterName: user.username || user.name || user.id,
  };
}

function moderatorPatch(user, extra = {}) {
  return {
    assignedModeratorId: user.id,
    assignedModeratorName: user.username || user.name || user.id,
    ...extra,
  };
}

async function publishBugCard(bug, channelId) {
  const response = await slackClient.chat.postMessage({
    channel: channelId,
    text: `#${bug.bugId} Баг-репорт`,
    blocks: buildBugBlocks(bug),
  });

  const updated = bugStore.update(bug.bugId, {
    channelId: response.channel,
    messageTs: response.ts,
    threadTs: response.ts,
  });

  await googleSheetsService.syncBug(updated);
  return updated;
}

function runInBackground(task) {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        console.error("Background task failed", error);
      });
  });
}

async function refreshBugCard(bug) {
  if (!bug.channelId || !bug.messageTs) {
    return bug;
  }

  await slackClient.chat.update({
    channel: bug.channelId,
    ts: bug.messageTs,
    text: `#${bug.bugId} Баг-репорт`,
    blocks: buildBugBlocks(bug),
  });

  return bug;
}

async function notifyInThread(bug, text) {
  if (!bug.channelId || !bug.threadTs) {
    return;
  }

  await slackClient.chat.postMessage({
    channel: bug.channelId,
    thread_ts: bug.threadTs,
    text,
  });
}

async function notifyReporterDM(bug, text) {
  if (!bug.reporterId) {
    return;
  }

  await slackClient.chat.postMessage({
    channel: bug.reporterId,
    text,
  });
}

async function openModal(triggerId, view) {
  await slackClient.views.open({
    trigger_id: triggerId,
    view,
  });
}

async function warmLauncherStore() {
  if (!googleSheetsService.enabled) {
    return;
  }

  const persistedLauncher = await googleSheetsService.getPersistedLauncher();
  if (persistedLauncher?.channelId && persistedLauncher?.messageTs) {
    launcherStore.set(persistedLauncher.channelId, persistedLauncher);
  }
}

async function publishOrUpdateLauncher(channelId) {
  const existing = launcherStore.get(channelId);

  if (existing?.messageTs) {
    try {
      await slackClient.chat.update({
        channel: channelId,
        ts: existing.messageTs,
        text: "Сообщить о баге",
        blocks: buildLauncherBlocks(),
      });

      if (googleSheetsService.enabled) {
        await googleSheetsService.persistLauncher(channelId, existing.messageTs);
      }

      return existing;
    } catch (_error) {
      // If the old launcher message is gone, publish a new one below.
    }
  }

  const response = await slackClient.chat.postMessage({
    channel: channelId,
    text: "Сообщить о баге",
    blocks: buildLauncherBlocks(),
  });

  const launcher = launcherStore.set(channelId, {
    channelId,
    messageTs: response.ts,
  });

  if (googleSheetsService.enabled) {
    await googleSheetsService.persistLauncher(channelId, response.ts);
  }

  return launcher;
}

async function updateBugStatusFromAction(bugId, patch, threadMessage) {
  const bug = bugStore.update(bugId, patch);
  if (!bug) {
    throw new Error(`Bug not found: ${bugId}`);
  }

  await refreshBugCard(bug);
  await googleSheetsService.syncBug(bug);
  if (threadMessage) {
    await notifyInThread(bug, threadMessage);
  }
}

function mentionReporter(bug, message) {
  return `<@${bug.reporterId}> ${message}`;
}

export const slackService = {
  runtimeConfig: {
    channelId: config.slackBugChannelId,
    moderatorIds: config.slackModeratorIds,
    products: ["ЛИС", "Склад", "Касса"],
  },

  async initialize() {
    await googleSheetsService.initialize();
    const persistedBugs = await googleSheetsService.loadPersistedBugs();
    bugStore.load(persistedBugs);
    const nextSequence = await googleSheetsService.getNextSequence();
    bugStore.syncSequence(nextSequence);
    await this.refreshRuntimeConfig();
    await warmLauncherStore();
  },

  async refreshRuntimeConfig() {
    if (!googleSheetsService.enabled) {
      return this.runtimeConfig;
    }

    this.runtimeConfig = await googleSheetsService.getRuntimeConfig();
    return this.runtimeConfig;
  },

  validateSlackRequest(rawBody, headers) {
    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];
    return validateSlackSignature(rawBody, timestamp, signature);
  },

  async handleSlashCommand(command) {
    await this.refreshRuntimeConfig();

    if (command.command === "/report") {
      return this.handleReportCommand(command);
    }

    if (command.command !== "/bug") {
      return {
        response_type: "ephemeral",
        text: `Команда не поддерживается: ${command.command}`,
      };
    }

    await openModal(command.trigger_id, buildBugReportModal(this.runtimeConfig.products));

    return {
      response_type: "ephemeral",
      text: "Форма создания бага открыта.",
    };
  },

  async handleReportCommand(command) {
    const range = parseReportRange(command.text || "");
    const reportText = googleSheetsService.enabled
      ? await googleSheetsService.buildReportSummary(range)
      : buildInMemoryReportSummary(bugStore.list(), range);

    return {
      response_type: "in_channel",
      text: reportText,
    };
  },

  async handleInteraction(payload) {
    if (payload.type === "view_submission") {
      return this.handleViewSubmission(payload);
    }

    if (payload.type === "block_actions") {
      return this.handleBlockActions(payload);
    }

    return {};
  },

  async handleViewSubmission(payload) {
    const callbackId = payload.view.callback_id;

    if (callbackId === CALLBACKS.BUG_CREATE_MODAL) {
      runInBackground(async () => {
        await this.refreshRuntimeConfig();
        await googleSheetsService.ensureFreshSequence(bugStore);
        const bug = bugStore.create(normalizeBugFromSubmission(payload.view, payload.user));
        const publishedBug = await publishBugCard(bug, this.runtimeConfig.channelId);

        await notifyInThread(
          publishedBug,
          `Баг зарегистрирован как *#${publishedBug.bugId}*. Если нужно, прикрепите сюда скриншоты, видео или файлы отдельным сообщением в этот тред.`
        );
      });

      return {
        response_action: "clear",
      };
    }

    const metadata = parseMetadata(payload.view.private_metadata);
    const bug = bugStore.get(metadata.bugId);
    if (!bug) {
      return {
        response_action: "errors",
        errors: {
          reason_block: "Баг не найден.",
        },
      };
    }

    await this.refreshRuntimeConfig();
    ensureModerator(payload.user.id, this.runtimeConfig.moderatorIds);

    if (callbackId === CALLBACKS.REJECT_MODAL) {
      const reason = extractPlainTextValue(payload.view.state, "reason_block", "reason_input");
      runInBackground(() =>
        notifyReporterDM(bug, `Ваш баг *#${bug.bugId}* был отклонён. Причина: ${reason}`)
      );
      runInBackground(async () =>
        updateBugStatusFromAction(
          bug.bugId,
          moderatorPatch(payload.user, {
            status: "rejected",
            rejectionReason: reason,
          }),
          mentionReporter(bug, `баг *#${bug.bugId}* отклонен. Причина: ${reason}`)
        )
      );
      return { response_action: "clear" };
    }

    if (callbackId === CALLBACKS.DUPLICATE_MODAL) {
      const masterBugId = extractPlainTextValue(
        payload.view.state,
        "master_bug_block",
        "master_bug_input"
      ).toUpperCase();
      const masterBug = bugStore.get(masterBugId);
      const masterBugRow = masterBug ? 1 : await googleSheetsService.findBugRow(masterBugId);

      if (!masterBug && masterBugRow == null) {
        return {
          response_action: "errors",
          errors: {
            master_bug_block: "Такого BUG-ID нет в реестре.",
          },
        };
      }

      runInBackground(async () =>
        updateBugStatusFromAction(
          bug.bugId,
          moderatorPatch(payload.user, {
            status: "duplicate",
            duplicateOf: masterBugId,
          }),
          mentionReporter(bug, `баг *#${bug.bugId}* помечен как дубликат *#${masterBugId}*.`)
        )
      );
      return { response_action: "clear" };
    }

    if (callbackId === CALLBACKS.LINK_JIRA_MODAL) {
      const jiraKey = extractPlainTextValue(payload.view.state, "jira_key_block", "jira_key_input");
      const jiraUrl = extractPlainTextValue(payload.view.state, "jira_url_block", "jira_url_input");
      runInBackground(() =>
        updateBugStatusFromAction(
          bug.bugId,
          moderatorPatch(payload.user, {
            jiraKey,
            jiraUrl: jiraUrl || null,
          }),
          `Для бага *#${bug.bugId}* сохранена связь с Jira: ${jiraKey}`
        )
      );
      return { response_action: "clear" };
    }

    return { response_action: "clear" };
  },

  async handleBlockActions(payload) {
    const action = payload.actions?.[0];
    if (!action?.action_id) {
      return {
        response_type: "ephemeral",
        text: "Не удалось обработать действие. Попробуйте еще раз.",
      };
    }
    
    if (action.action_id === ACTIONS.OPEN_BUG_MODAL) {
      await this.refreshRuntimeConfig();
      await openModal(payload.trigger_id, buildBugReportModal(this.runtimeConfig.products));
      return {};
    }

    const actionValue =
      action.action_id === ACTIONS.MODERATOR_MORE
        ? decodeActionValue(extractSelectedOptionValue(action))
        : decodeActionValue(action?.value);
    const { bugId } = actionValue;
    const bug = bugStore.get(bugId);

    if (!bug) {
      return {
        response_type: "ephemeral",
        text: "Баг не найден.",
      };
    }

    await this.refreshRuntimeConfig();
    ensureModerator(payload.user.id, this.runtimeConfig.moderatorIds);

    if (action.action_id === ACTIONS.TAKE_IN_WORK) {
      runInBackground(() =>
        updateBugStatusFromAction(
          bug.bugId,
          moderatorPatch(payload.user, {
            status: "triage",
          }),
          mentionReporter(
            bug,
            `баг *#${bug.bugId}* взят в работу модератором <@${payload.user.id}>.`
          )
        )
      );
      return {
        response_type: "ephemeral",
        text: `Статус #${bug.bugId} обновлен на "В работе".`,
      };
    }

    if (action.action_id === ACTIONS.MARK_FIXED) {
      runInBackground(() => notifyReporterDM(bug, `Ваш баг *#${bug.bugId}* исправлен ✅`));
      runInBackground(() =>
        updateBugStatusFromAction(
          bug.bugId,
          moderatorPatch(payload.user, {
            status: "fixed",
            fixedAt: new Date().toISOString(),
          }),
          mentionReporter(bug, `баг *#${bug.bugId}* исправлен.`)
        )
      );
      return {
        response_type: "ephemeral",
        text: `Статус #${bug.bugId} обновлен на "Исправлено".`,
      };
    }

    if (action.action_id === ACTIONS.MODERATOR_MORE) {
      const selectedAction = actionValue.action;

      if (selectedAction === ACTIONS.OPEN_REJECT_MODAL) {
        await openModal(payload.trigger_id, buildRejectModal(bug.bugId));
        return {};
      }

      if (selectedAction === ACTIONS.OPEN_DUPLICATE_MODAL) {
        await openModal(payload.trigger_id, buildDuplicateModal(bug.bugId));
        return {};
      }

      if (selectedAction === ACTIONS.OPEN_LINK_JIRA_MODAL) {
        await openModal(payload.trigger_id, buildLinkJiraModal(bug.bugId));
        return {};
      }
    }

    if (action.action_id === ACTIONS.OPEN_REJECT_MODAL) {
      await openModal(payload.trigger_id, buildRejectModal(bug.bugId));
      return {};
    }

    if (action.action_id === ACTIONS.OPEN_DUPLICATE_MODAL) {
      await openModal(payload.trigger_id, buildDuplicateModal(bug.bugId));
      return {};
    }

    if (action.action_id === ACTIONS.OPEN_LINK_JIRA_MODAL) {
      await openModal(payload.trigger_id, buildLinkJiraModal(bug.bugId));
      return {};
    }

    return {};
  },

  async postLauncherMessage(channelId) {
    await this.refreshRuntimeConfig();
    return publishOrUpdateLauncher(channelId ?? this.runtimeConfig.channelId);
  },

  async postPeriodicReport(kind = "weekly") {
    await this.refreshRuntimeConfig();
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - (kind === "monthly" ? 30 : 7));
    const text = await googleSheetsService.buildReportSummary({
      startDate,
      endDate: now,
    });

    await this.postTextToRuntimeChannel(text);
  },

  async postTextToRuntimeChannel(text) {
    await this.refreshRuntimeConfig();
    await slackClient.chat.postMessage({
      channel: this.runtimeConfig.channelId,
      text,
    });
  },
};

function parseSingleDate(value) {
  const trimmed = String(value || "").trim();
  const dotMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0);
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0);
  }

  return null;
}

function parseReportRange(text) {
  const rawText = String(text || "").trim();
  const matches = rawText.match(/\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}/g) || [];
  const product = rawText
    .replace(/\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (matches.length >= 2) {
    const startDate = parseSingleDate(matches[0]);
    const endDate = parseSingleDate(matches[1]);
    if (startDate && endDate) {
      endDate.setHours(23, 59, 59, 999);
      return { startDate, endDate, product: product || null };
    }
  }

  return {
    product: product || null,
  };
}

function buildInMemoryReportSummary(bugs, range) {
  const filtered = bugs.filter((bug) => {
    const createdAt = new Date(bug.createdAt);
    if (range.startDate && createdAt < range.startDate) {
      return false;
    }
    if (range.endDate && createdAt > range.endDate) {
      return false;
    }
    if (
      range.product &&
      String(bug.product || "").trim().toLowerCase() !== String(range.product).trim().toLowerCase()
    ) {
      return false;
    }
    return true;
  });

  const countBy = (field, value) => filtered.filter((bug) => bug[field] === value).length;
  const productHeader = range.product ? [`Продукт: ${range.product}`] : [];
  return [
    `*Отчет по багам*`,
    `Всего: ${filtered.length}`,
    `Новые: ${countBy("status", "new")}`,
    `В работе: ${countBy("status", "triage")}`,
    `Отклоненные: ${countBy("status", "rejected")}`,
    `Дубликаты: ${countBy("status", "duplicate")}`,
    `Исправленные: ${countBy("status", "fixed")}`,
  ].join("\n");
}
