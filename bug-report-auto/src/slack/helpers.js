export function plainText(text, emoji = false) {
  return {
    type: "plain_text",
    text,
    emoji,
  };
}

export function extractPlainTextValue(viewState, blockId, actionId) {
  return viewState.values?.[blockId]?.[actionId]?.value?.trim() || "";
}

export function extractStaticValue(viewState, blockId, actionId) {
  return (
    viewState.values?.[blockId]?.[actionId]?.selected_option?.value?.trim() || ""
  );
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
