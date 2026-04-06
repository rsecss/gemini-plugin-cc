const DEFAULT_MODEL = "auto";
const SUPPORTED_MODEL_ALIASES = Object.freeze(["auto", "pro", "flash", "flash-lite"]);

export { DEFAULT_MODEL };

export const MODEL_ALIASES = new Map(
  SUPPORTED_MODEL_ALIASES.map((alias) => [alias, alias])
);

function normalizeModelToken(input) {
  if (input == null) return "";
  return String(input).trim();
}

function resolveModelAlias(input) {
  const normalized = normalizeModelToken(input);
  if (!normalized) return "";
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function extractModelHint(detail) {
  const patterns = [
    /\bmodel\s+([A-Za-z0-9._:-]+)/i,
    /\baccess to model\s+([A-Za-z0-9._:-]+)/i,
    /\busing model\s+([A-Za-z0-9._:-]+)/i,
    /\bmodel\s+`([^`]+)`/i,
    /\bmodel\s+"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = detail.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function detectFailedAlias(failedModel) {
  const resolved = resolveModelAlias(failedModel).toLowerCase();
  const exactAlias = SUPPORTED_MODEL_ALIASES.find((alias) => alias.toLowerCase() === resolved);
  if (exactAlias) return exactAlias;

  const normalizedFailed = normalizeModelToken(failedModel).toLowerCase();
  return [...SUPPORTED_MODEL_ALIASES]
    .sort((left, right) => right.length - left.length)
    .find((alias) => normalizedFailed.includes(alias.toLowerCase())) ?? null;
}

export function resolveRequestedModel(input) {
  const resolved = resolveModelAlias(input);
  return resolved || null;
}

export function resolveConfiguredModel(input) {
  const resolved = resolveModelAlias(input);
  return resolved || DEFAULT_MODEL;
}

export function suggestAlternativeModels(failedModel) {
  const failedAlias = detectFailedAlias(failedModel);
  const suggestions = SUPPORTED_MODEL_ALIASES.filter((alias) => alias !== failedAlias);
  return suggestions.length > 0 ? suggestions : [...SUPPORTED_MODEL_ALIASES];
}

export function normalizeGeminiCliError(detail, options = {}) {
  const normalizedDetail = String(detail ?? "").trim();
  if (!normalizedDetail) return null;

  const requestedModel = resolveRequestedModel(options.model);
  const configuredModel = resolveConfiguredModel(options.configuredModel);
  const hintedModel = extractModelHint(normalizedDetail);
  const model = requestedModel ?? hintedModel ?? configuredModel ?? null;

  if (/\b(429|rate limit|too many requests|resource[_ -]?exhausted|quota)\b/i.test(normalizedDetail)) {
    return {
      code: "RATE_LIMITED",
      status: "rate limited",
      model,
      message: model
        ? `Gemini model \`${model}\` is rate limited for the current credentials.`
        : "Gemini is rate limited for the current credentials.",
      detail: normalizedDetail,
      suggestions: suggestAlternativeModels(model),
    };
  }

  if (/\b(403|forbidden|permission denied|access denied|no access to model|not available for your account)\b/i.test(normalizedDetail)) {
    return {
      code: "MODEL_UNAVAILABLE",
      status: "unavailable",
      model,
      message: model
        ? `Gemini model \`${model}\` is unavailable for the current credentials.`
        : "The requested Gemini model is unavailable for the current credentials.",
      detail: normalizedDetail,
      suggestions: suggestAlternativeModels(model),
    };
  }

  return null;
}
