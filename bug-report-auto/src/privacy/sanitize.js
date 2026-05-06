const PINFL_REGEX = /(^|[^\d])((?:\d[ \t.-]*){13}\d)(?!\d)/g;
const PHONE_WITH_COUNTRY_REGEX = /(^|[^\d+])(\+?998[ \t().-]*(?:\d[ \t().-]*){8}\d)(?!\d)/g;
const LOCAL_PHONE_REGEX =
  /(^|[^\d])(\(?(?:33|50|55|71|77|88|90|91|93|94|95|97|98|99)\)?[ \t().-]*(?:\d[ \t().-]*){6}\d)(?!\d)/g;

const BUG_TEXT_FIELDS = [
  "clinicId",
  "userRole",
  "description",
  "reproductionSteps",
  "expectedResult",
  "actualResult",
  "section",
  "attachmentNote",
];

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function cleanupAfterRemoval(value) {
  return value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function removeMatches(value, regex, predicate) {
  let removed = false;
  const sanitized = value.replace(regex, (match, prefix, candidate) => {
    if (!predicate(digitsOnly(candidate))) {
      return match;
    }

    removed = true;
    return prefix;
  });

  return {
    value: removed ? cleanupAfterRemoval(sanitized) : value,
    removed,
  };
}

export function sanitizePersonalDataText(value) {
  let next = String(value || "");
  let removed = false;

  for (const [regex, predicate] of [
    [PINFL_REGEX, (digits) => digits.length === 14],
    [PHONE_WITH_COUNTRY_REGEX, (digits) => digits.length === 12 && digits.startsWith("998")],
    [LOCAL_PHONE_REGEX, (digits) => digits.length === 9],
  ]) {
    const result = removeMatches(next, regex, predicate);
    next = result.value;
    removed = removed || result.removed;
  }

  return {
    value: next,
    removed,
  };
}

export function sanitizeBugPersonalData(bug) {
  const sanitizedBug = { ...bug };
  let removed = false;

  for (const field of BUG_TEXT_FIELDS) {
    if (typeof sanitizedBug[field] !== "string" || !sanitizedBug[field]) {
      continue;
    }

    const result = sanitizePersonalDataText(sanitizedBug[field]);
    sanitizedBug[field] = result.value;
    removed = removed || result.removed;
  }

  return {
    bug: sanitizedBug,
    removed,
  };
}
