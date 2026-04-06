import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGeminiCliError,
  resolveConfiguredModel,
  resolveRequestedModel,
  suggestAlternativeModels,
} from "../plugins/gemini/scripts/lib/models.mjs";

describe("resolveRequestedModel", () => {
  it("returns null for empty CLI input", () => {
    assert.equal(resolveRequestedModel(undefined), null);
    assert.equal(resolveRequestedModel(""), null);
    assert.equal(resolveRequestedModel("   "), null);
  });

  it("normalizes supported aliases and preserves explicit model ids", () => {
    assert.equal(resolveRequestedModel("flash"), "flash");
    assert.equal(resolveRequestedModel("FLASH-LITE"), "flash-lite");
    assert.equal(resolveRequestedModel("gemini-3-pro-preview"), "gemini-3-pro-preview");
  });
});

describe("resolveConfiguredModel", () => {
  it("falls back to auto for empty config values", () => {
    assert.equal(resolveConfiguredModel(undefined), "auto");
    assert.equal(resolveConfiguredModel(""), "auto");
  });
});

describe("suggestAlternativeModels", () => {
  it("omits the failed alias from suggestions", () => {
    assert.deepEqual(suggestAlternativeModels("flash-lite"), ["auto", "pro", "flash"]);
  });

  it("recognizes full model ids that contain a known alias", () => {
    assert.deepEqual(suggestAlternativeModels("gemini-3.1-flash-lite-preview"), ["auto", "pro", "flash"]);
  });
});

describe("normalizeGeminiCliError", () => {
  it("maps 403 model access failures to a stable error shape", () => {
    const failure = normalizeGeminiCliError(
      "403 Forbidden: This token has no access to model gemini-3.1-flash-lite-preview",
      { configuredModel: "auto" }
    );

    assert.deepEqual(failure, {
      code: "MODEL_UNAVAILABLE",
      status: "unavailable",
      model: "gemini-3.1-flash-lite-preview",
      message: "Gemini model `gemini-3.1-flash-lite-preview` is unavailable for the current credentials.",
      detail: "403 Forbidden: This token has no access to model gemini-3.1-flash-lite-preview",
      suggestions: ["auto", "pro", "flash"],
    });
  });

  it("maps 429 rate limits and prefers the explicit requested model", () => {
    const failure = normalizeGeminiCliError(
      "429 RESOURCE_EXHAUSTED: quota exceeded for this model",
      { model: "pro", configuredModel: "flash" }
    );

    assert.deepEqual(failure, {
      code: "RATE_LIMITED",
      status: "rate limited",
      model: "pro",
      message: "Gemini model `pro` is rate limited for the current credentials.",
      detail: "429 RESOURCE_EXHAUSTED: quota exceeded for this model",
      suggestions: ["auto", "flash", "flash-lite"],
    });
  });

  it("does not mistake unrelated quoted text for a model identifier", () => {
    const failure = normalizeGeminiCliError(
      "429 Quota exceeded for \"my-project-id\"",
      { configuredModel: "flash" }
    );

    assert.deepEqual(failure, {
      code: "RATE_LIMITED",
      status: "rate limited",
      model: "flash",
      message: "Gemini model `flash` is rate limited for the current credentials.",
      detail: "429 Quota exceeded for \"my-project-id\"",
      suggestions: ["auto", "pro", "flash-lite"],
    });
  });

  it("returns null for unrelated failures", () => {
    assert.equal(normalizeGeminiCliError("socket hang up"), null);
  });
});
