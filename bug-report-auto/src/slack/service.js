import crypto from "node:crypto";
import { config } from "../config.js";
import { bugStore } from "../store/bug-store.js";
import { launcherStore } from "../store/launcher-store.js";
import { buildBugBlocks, buildLauncherBlocks } from "./blocks.js";
import { slackClient } from "./client.js";
import { ACTIONS, CALLBACKS } from "./constants.js";
import { decodeActionValue, extractPlainTextValue, extractStaticValue } from "./helpers.js";
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

function ensureModerator(userId) {
  if (!config.slackModeratorIds.includes(userId)) {
    const error = new Error("Only moderators can use this action.");
    error.statusCode = 403;
    throw error;
  }
}

function normalizeBugFromSubmission(view, user) {
  const state = view.state;
  return {
    clinicId: extractPlainTextValue(state, "clinic_id_block", "clinic_id_input"),
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

async function publishBugCard(bug) {
  const response = await slackClient.chat.postMessage({
    channel: config.slackBugChannelId,
    text: `#${bug.bugId} Bug Report`,
    blocks: buildBugBlocks(bug),
  });

  const updated = bugStore.update(bug.bugId, {
    channelId: response.channel,
    messageTs: response.ts,
    threadTs: response.ts,
  });

  return updated;
}

async function refreshBugCard(bug) {
  if (!bug.channelId || !bug.messageTs) {
    return bug;
  }

  await slackClient.chat.update({
    channel: bug.channelId,
    ts: bug.messageTs,
    text: `#${bug.bugId} Bug Report`,
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

async function openModal(triggerId, view) {
  await slackClient.views.open({
    trigger_id: triggerId,
    view,
  });
}

async function publishOrUpdateLauncher(channelId) {
  const existing = launcherStore.get(channelId);

  if (existing?.messageTs) {
    try {
      await slackClient.chat.update({
        channel: channelId,
        ts: existing.messageTs,
        text: "Report Bug",
        blocks: buildLauncherBlocks(),
      });

      return existing;
    } catch (_error) {
      // If the old launcher message is gone, publish a new one below.
    }
  }

  const response = await slackClient.chat.postMessage({
    channel: channelId,
    text: "Report Bug",
    blocks: buildLauncherBlocks(),
  });

  return launcherStore.set(channelId, {
    channelId,
    messageTs: response.ts,
  });
}

async function updateBugStatusFromAction(bugId, patch, threadMessage) {
  const bug = bugStore.update(bugId, patch);
  if (!bug) {
    throw new Error(`Bug not found: ${bugId}`);
  }

  await refreshBugCard(bug);
  if (threadMessage) {
    await notifyInThread(bug, threadMessage);
  }
}

export const slackService = {
  validateSlackRequest(rawBody, headers) {
    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];
    return validateSlackSignature(rawBody, timestamp, signature);
  },

  async handleSlashCommand(command) {
    if (command.command !== "/bug") {
      return {
        response_type: "ephemeral",
        text: `Unsupported command: ${command.command}`,
      };
    }

    await openModal(command.trigger_id, buildBugReportModal());

    return {
      response_type: "ephemeral",
      text: "Форма создания бага открыта.",
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
      const bug = bugStore.create(normalizeBugFromSubmission(payload.view, payload.user));
      const publishedBug = await publishBugCard(bug);

      await notifyInThread(
        publishedBug,
        `Баг зарегистрирован как *#${publishedBug.bugId}*. Если нужно, прикрепите сюда скриншоты, видео или файлы отдельным сообщением в этот тред.`
      );

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

    ensureModerator(payload.user.id);

    if (callbackId === CALLBACKS.REJECT_MODAL) {
      const reason = extractPlainTextValue(payload.view.state, "reason_block", "reason_input");
      await updateBugStatusFromAction(
        bug.bugId,
        { status: "rejected", rejectionReason: reason },
        `Баг *#${bug.bugId}* отклонен. Причина: ${reason}`
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

      if (!masterBug) {
        return {
          response_action: "errors",
          errors: {
            master_bug_block: "Такого BUG-ID нет в реестре.",
          },
        };
      }

      await updateBugStatusFromAction(
        bug.bugId,
        { status: "duplicate", duplicateOf: masterBugId },
        `Баг *#${bug.bugId}* помечен как дубликат *#${masterBugId}*.`
      );
      return { response_action: "clear" };
    }

    if (callbackId === CALLBACKS.LINK_JIRA_MODAL) {
      const jiraKey = extractPlainTextValue(payload.view.state, "jira_key_block", "jira_key_input");
      const jiraUrl = extractPlainTextValue(payload.view.state, "jira_url_block", "jira_url_input");
      await updateBugStatusFromAction(
        bug.bugId,
        { jiraKey, jiraUrl: jiraUrl || null },
        `Для бага *#${bug.bugId}* сохранена связь с Jira: ${jiraKey}`
      );
      return { response_action: "clear" };
    }

    return { response_action: "clear" };
  },

  async handleBlockActions(payload) {
    const action = payload.actions?.[0];
    
    if (action.action_id === ACTIONS.OPEN_BUG_MODAL) {
      await openModal(payload.trigger_id, buildBugReportModal());
      return {};
    }

    const { bugId } = decodeActionValue(action?.value);
    const bug = bugStore.get(bugId);

    if (!bug) {
      return {
        response_type: "ephemeral",
        text: "Баг не найден.",
      };
    }

    ensureModerator(payload.user.id);

    if (action.action_id === ACTIONS.TAKE_IN_WORK) {
      await updateBugStatusFromAction(
        bug.bugId,
        { status: "triage" },
        `Баг *#${bug.bugId}* взят в работу модератором <@${payload.user.id}>.`
      );
      return {
        response_type: "ephemeral",
        text: `Статус #${bug.bugId} обновлен на "В работе".`,
      };
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

  async postLauncherMessage(channelId = config.slackBugChannelId) {
    return publishOrUpdateLauncher(channelId);
  },
};
