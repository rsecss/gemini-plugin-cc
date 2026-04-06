import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderGeminiFailure, renderReviewResult } from "../plugins/gemini/scripts/lib/render.mjs";

describe("renderReviewResult", () => {
  it("warns clearly when the review output is not structured JSON", () => {
    const rendered = renderReviewResult(
      {
        parsed: null,
        parseError: "No valid JSON found in response",
        rawOutput: "plain text review output",
      },
      {
        reviewLabel: "Review",
        targetLabel: "working tree diff",
      }
    );

    assert.match(rendered, /did not return valid structured JSON/i);
    assert.match(rendered, /Do not treat this result as approval/i);
    assert.doesNotMatch(rendered, /No material findings\./);
  });

  it("shows 'No material findings.' only for valid structured approve output", () => {
    const rendered = renderReviewResult(
      {
        parsed: {
          verdict: "approve",
          summary: "Looks safe to ship.",
          findings: [],
          next_steps: [],
        },
        parseError: null,
        rawOutput: "",
      },
      {
        reviewLabel: "Review",
        targetLabel: "working tree diff",
      }
    );

    assert.match(rendered, /No material findings\./);
  });
});

describe("renderGeminiFailure", () => {
  it("renders a normalized Gemini CLI failure with suggestions and raw detail", () => {
    const rendered = renderGeminiFailure({
      status: "unavailable",
      model: "flash-lite",
      message: "Gemini model `flash-lite` is unavailable for the current credentials.",
      detail: "403 Forbidden: This token has no access to model gemini-3.1-flash-lite-preview",
      suggestions: ["auto", "pro", "flash"],
    });

    assert.match(rendered, /# Gemini Error/);
    assert.match(rendered, /Model: flash-lite/);
    assert.match(rendered, /Status: unavailable/);
    assert.match(rendered, /Try instead:/);
    assert.match(rendered, /--model flash/);
    assert.match(rendered, /Raw error:/);
  });
});
