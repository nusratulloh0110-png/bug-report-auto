export function plainText(text, emoji = false) {
  return {
    type: "plain_text",
    text,
    emoji,
  };
}

export function formatDisplayDate(dateValue) {
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

export function extractPlainTextValue(viewState, blockId, actionId) {
  return viewState.values?.[blockId]?.[actionId]?.value?.trim() || "";
}

export function extractStaticValue(viewState, blockId, actionId) {
  return (
    viewState.values?.[blockId]?.[actionId]?.selected_option?.value?.trim() || ""
  );
}

export function extractFileIds(viewState, blockId, actionId) {
  const input = viewState.values?.[blockId]?.[actionId] || {};
  const files = Array.isArray(input.files)
    ? input.files
    : Array.isArray(input.value)
      ? input.value
      : [];

  return files
    .map((file) => (typeof file === "string" ? file : file?.id))
    .filter(Boolean);
}

export function encodeActionValue(payload) {
  return JSON.stringify(payload);
}

export function decodeActionValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function extractSelectedOptionValue(action) {
  return action?.selected_option?.value || "";
}
