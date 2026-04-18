import { config } from "../config.js";

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function buildSlotId(parts) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function toMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return 9 * 60;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function startWeeklyReportScheduler(slackService, googleSheetsService, logger) {
  const intervalMs = 60 * 1000;

  async function tick() {
    try {
      const runtimeConfig = await slackService.refreshRuntimeConfig();
      if (!runtimeConfig.weeklyReportEnabled) {
        return;
      }

      const timeZone = runtimeConfig.weeklyReportTimezone || config.reportTimezone;
      const current = new Date();
      const parts = getZonedParts(current, timeZone);
      const targetTime = runtimeConfig.weeklyReportTime || "09:00";

      if (parts.weekday !== "Mon") {
        return;
      }

      const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
      const targetMinutes = toMinutes(targetTime);
      if (currentMinutes < targetMinutes) {
        return;
      }

      const slotId = `${parts.year}-${parts.month}-${parts.day}`;
      if (runtimeConfig.lastWeeklyReportAt === slotId) {
        return;
      }

      const endDate = current;
      const startDate = new Date(current.getTime() - 7 * 24 * 60 * 60 * 1000);
      const text = await googleSheetsService.buildReportSummary({
        startDate,
        endDate,
      });

      await slackService.postTextToRuntimeChannel(text);
      await googleSheetsService.upsertSetting("last_weekly_report_at", slotId);

      logger?.info?.({ slotId, timeZone }, "Weekly report posted");
    } catch (error) {
      logger?.error?.(
        { message: error.message, stack: error.stack },
        "Weekly report scheduler failed"
      );
    }
  }

  const timer = setInterval(tick, intervalMs);
  setTimeout(tick, 5000);
  return timer;
}
