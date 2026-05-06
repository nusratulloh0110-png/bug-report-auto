import crypto from "node:crypto";
import { config } from "../config.js";
import { googleSheetsService } from "../google/sheets.js";
import { jiraClient } from "../jira/client.js";
import { sanitizeBugPersonalData } from "../privacy/sanitize.js";
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
    userRole: extractPlainTextValue(state, "user_role_block", "user_role_input"),
    description: extractPlainTextValue(state, "description_block", "description_input"),
    reproductionSteps: extractPlainTextValue(
      state,
      "reproduction_steps_block",
      "reproduction_steps_input"
    ),
    expectedResult: extractPlainTextValue(
      state,
      "expected_result_block",
      "expected_result_input"
    ),
    actualResult: extractPlainTextValue(state, "actual_result_block", "actual_result_input"),
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

function buildPersonalDataRemovedNotice() {
  return (
    "Из-за требований информационной безопасности персональные данные, включая ПИНФЛ и номера телефонов, " +
    "нельзя публиковать в общих каналах. Такие данные были удалены из карточки бага. " +
    "Если они необходимы для диагностики, передайте их через согласованный защищенный канал."
  );
}

function normalizeJiraProjectKey(value) {
  return String(value || "").trim().toUpperCase();
}

function getMappedJiraProjectKeyForBug(bug, runtimeConfig) {
  const normalizedProduct = String(bug.product || "").trim().toLowerCase();
  const mappedEntry = Object.entries(runtimeConfig?.jiraProjectKeys || {}).find(
    ([product]) => String(product || "").trim().toLowerCase() === normalizedProduct
  );

  return normalizeJiraProjectKey(mappedEntry?.[1]);
}

function findJiraProjectByProduct(bug, runtimeConfig) {
  const normalizedProduct = String(bug.product || "").trim().toLowerCase();
  if (!normalizedProduct) {
    return null;
  }

  return (runtimeConfig?.jiraProjects || []).find((candidate) => {
    const key = String(candidate.key || "").trim().toLowerCase();
    const name = String(candidate.name || "").trim().toLowerCase();
    return key === normalizedProduct || name === normalizedProduct;
  });
}

function getJiraProjectKeyForBug(bug, runtimeConfig) {
  const mappedKey = getMappedJiraProjectKeyForBug(bug, runtimeConfig);
  if (mappedKey) {
    return mappedKey;
  }

  const matchedProject = findJiraProjectByProduct(bug, runtimeConfig);
  if (matchedProject?.key) {
    return normalizeJiraProjectKey(matchedProject.key);
  }

  return normalizeJiraProjectKey(config.jiraProjectKey);
}

function buildJiraModalOptions(bug, runtimeConfig) {
  return {
    projectKey: getJiraProjectKeyForBug(bug, runtimeConfig),
    mappedProjectKey: getMappedJiraProjectKeyForBug(bug, runtimeConfig),
    jiraProjects: runtimeConfig?.jiraProjects || [],
  };
}

function isReadyForJiraStatusSync(bug) {
  return bug.jiraKey && bug.status !== "fixed" && bug.status !== "rejected" && bug.status !== "duplicate";
}

export const slackService = {
  runtimeConfig: {
    channelId: config.slackBugChannelId,
    moderatorIds: config.slackModeratorIds,
    products: ["ЛИС", "Склад", "Касса"],
    jiraProjectKeys: {},
    jiraProjects: [],
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
    if (googleSheetsService.enabled) {
      this.runtimeConfig = await googleSheetsService.getRuntimeConfig();
    }

    if (jiraClient.isConfigured()) {
      try {
        this.runtimeConfig.jiraProjects = await jiraClient.listProjectsSupportingIssueType();
      } catch (error) {
        console.error("Failed to load Jira projects", error);
        this.runtimeConfig.jiraProjects = this.runtimeConfig.jiraProjects || [];
      }
    }
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
    if (!payload.view?.callback_id) {
      return { response_action: "clear" };
    }
    const callbackId = payload.view.callback_id;

    if (callbackId === CALLBACKS.BUG_CREATE_MODAL) {
      const reporterId = payload.user?.id;
      runInBackground(async () => {
        try {
          await this.refreshRuntimeConfig();
          await googleSheetsService.ensureFreshSequence(bugStore);
          const sanitized = sanitizeBugPersonalData(
            normalizeBugFromSubmission(payload.view, payload.user)
          );
          const bug = bugStore.create(sanitized.bug);
          const publishedBug = await publishBugCard(bug, this.runtimeConfig.channelId);

          await notifyInThread(
            publishedBug,
            `Баг зарегистрирован как *#${publishedBug.bugId}*. Если нужно, прикрепите сюда скриншоты, видео или файлы отдельным сообщением в этот тред.`
          );
          if (sanitized.removed) {
            await notifyInThread(publishedBug, buildPersonalDataRemovedNotice());
          }
        } catch (error) {
          console.error("Failed to create bug", error);
          if (reporterId) {
            await slackClient.chat.postMessage({
              channel: reporterId,
              text: "Не удалось зарегистрировать баг. Пожалуйста, попробуйте ещё раз или обратитесь к администратору.",
            }).catch(() => {});
          }
        }
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
      if (!reason) {
        return {
          response_action: "errors",
          errors: { reason_block: "Укажите причину отклонения." },
        };
      }
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
      if (!masterBugId) {
        return {
          response_action: "errors",
          errors: { master_bug_block: "Укажите BUG-ID оригинального бага." },
        };
      }
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
      if (bug.jiraKey) {
        return {
          response_action: "errors",
          errors: {
            jira_summary_block: `Для бага уже сохранена Jira-задача: ${bug.jiraKey}`,
          },
        };
      }

      const jiraProjectKey = extractPlainTextValue(
        payload.view.state,
        "jira_project_key_block",
        "jira_project_key_input"
      ) || extractStaticValue(
        payload.view.state,
        "jira_project_key_block",
        "jira_project_key_select"
      ) || metadata.defaultProjectKey || "";
      const normalizedJiraProjectKey = normalizeJiraProjectKey(jiraProjectKey);
      if (!normalizedJiraProjectKey) {
        return {
          response_action: "errors",
          errors: {
            jira_project_key_block:
              "Укажите ключ проекта Jira или настройте лист \"Ключ Jira\" в Google Sheets.",
          },
        };
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(normalizedJiraProjectKey)) {
        return {
          response_action: "errors",
          errors: {
            jira_project_key_block:
              "Ключ проекта Jira должен быть латиницей и может содержать только буквы, цифры и _. ",
          },
        };
      }

      const summary = extractPlainTextValue(
        payload.view.state,
        "jira_summary_block",
        "jira_summary_input"
      );
      const note = extractPlainTextValue(payload.view.state, "jira_note_block", "jira_note_input");
      runInBackground(async () => {
        try {
          const currentBug = bugStore.get(bug.bugId);
          if (currentBug?.jiraKey) {
            return;
          }

          const issue = await jiraClient.createIssueFromBug(bug, {
            projectKey: normalizedJiraProjectKey,
            summary,
            extraContext: note,
            moderatorName: payload.user.username || payload.user.name || payload.user.id,
          });

          await updateBugStatusFromAction(
            bug.bugId,
            moderatorPatch(payload.user, {
              jiraKey: issue.key,
              jiraUrl: issue.url,
            }),
            `Для бага *#${bug.bugId}* создана Jira-задача: <${issue.url}|${issue.key}>`
          );
        } catch (error) {
          console.error("Failed to create Jira issue", error);
          await slackClient.chat
            .postMessage({
              channel: payload.user.id,
              text: `Не удалось создать Jira-задачу для бага *#${bug.bugId}*: ${error.message}`,
            })
            .catch(() => {});
        }
      });
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
    const bugId = actionValue?.bugId;
    if (!bugId) {
      return {
        response_type: "ephemeral",
        text: "Не удалось обработать действие. Попробуйте еще раз.",
      };
    }
    const bug = bugStore.get(bugId);

    if (!bug) {
      return {
        response_type: "ephemeral",
        text: "Баг не найден.",
      };
    }

    if (action.action_id === ACTIONS.OPEN_JIRA_URL) {
      return {};
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
        await openModal(
          payload.trigger_id,
          buildLinkJiraModal(bug.bugId, buildJiraModalOptions(bug, this.runtimeConfig))
        );
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
      await openModal(
        payload.trigger_id,
        buildLinkJiraModal(bug.bugId, buildJiraModalOptions(bug, this.runtimeConfig))
      );
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
    const range = {
      startDate,
      endDate: now,
    };
    const text = googleSheetsService.enabled
      ? await googleSheetsService.buildReportSummary(range)
      : buildInMemoryReportSummary(bugStore.list(), range);

    await this.postTextToRuntimeChannel(text);
  },

  async syncJiraStatuses() {
    if (!jiraClient.isConfigured()) {
      return { checked: 0, updated: 0 };
    }

    const linkedBugs = bugStore.list().filter(isReadyForJiraStatusSync);
    let updated = 0;

    for (const bug of linkedBugs) {
      try {
        const jiraStatus = await jiraClient.getIssueStatus(bug.jiraKey);
        if (!jiraClient.isDoneStatus(jiraStatus)) {
          continue;
        }

        await updateBugStatusFromAction(
          bug.bugId,
          {
            status: "fixed",
            fixedAt: new Date().toISOString(),
          },
          `Статус бага *#${bug.bugId}* автоматически обновлен: Jira-задача *${bug.jiraKey}* перешла в статус *${jiraStatus.name}*.`
        );
        updated += 1;
      } catch (error) {
        console.error(`Failed to sync Jira status for ${bug.bugId}`, error);
      }
    }

    return { checked: linkedBugs.length, updated };
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
    ...productHeader,
    `*Отчет по багам*`,
    `Всего: ${filtered.length}`,
    `Новые: ${countBy("status", "new")}`,
    `В работе: ${countBy("status", "triage")}`,
    `Отклоненные: ${countBy("status", "rejected")}`,
    `Дубликаты: ${countBy("status", "duplicate")}`,
    `Исправленные: ${countBy("status", "fixed")}`,
  ].join("\n");
}
