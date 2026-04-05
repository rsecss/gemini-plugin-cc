import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractStructuredJson,
  parseGeminiOutput,
  parseStructuredOutput,
} from "../plugins/gemini/scripts/lib/gemini.mjs";

describe("extractStructuredJson", () => {
  it("extracts JSON from ```json code block", () => {
    const text = 'Some preamble\n```json\n{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}\n```\nAfter';
    const result = extractStructuredJson(text);
    assert.equal(result.fallback, false);
    assert.equal(result.parsed.verdict, "approve");
    assert.equal(result.parseError, null);
  });

  it("extracts bare JSON object from response", () => {
    const text = 'Here is the result: {"verdict":"needs-attention","summary":"issues found","findings":[],"next_steps":[]}';
    const result = extractStructuredJson(text);
    assert.equal(result.fallback, false);
    assert.equal(result.parsed.verdict, "needs-attention");
  });

  it("parses entire response as JSON", () => {
    const text = '{"verdict":"approve","summary":"all good","findings":[],"next_steps":[]}';
    const result = extractStructuredJson(text);
    assert.equal(result.fallback, false);
    assert.deepEqual(result.parsed.findings, []);
  });

  it("falls back for plain text", () => {
    const text = "This is just a plain text response with no JSON.";
    const result = extractStructuredJson(text);
    assert.equal(result.fallback, true);
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });

  it("falls back for empty response", () => {
    const result = extractStructuredJson("");
    assert.equal(result.fallback, true);
    assert.equal(result.parsed, null);
  });

  it("falls back for null response", () => {
    const result = extractStructuredJson(null);
    assert.equal(result.fallback, true);
  });

  it("handles malformed JSON in code block gracefully", () => {
    const text = '```json\n{broken json\n```';
    const result = extractStructuredJson(text);
    // Should try other layers and ultimately fall back
    assert.equal(result.parsed, null);
    assert.equal(result.fallback, true);
  });
});

describe("parseGeminiOutput", () => {
  it("parses valid JSON output", () => {
    const raw = JSON.stringify({ response: "hello", stats: { tokens: 10 } });
    const result = parseGeminiOutput(raw);
    assert.equal(result.response, "hello");
    assert.deepEqual(result.stats, { tokens: 10 });
    assert.equal(result.error, null);
  });

  it("returns raw as response for non-JSON", () => {
    const result = parseGeminiOutput("plain text output");
    assert.equal(result.response, "plain text output");
    assert.equal(result.stats, null);
    assert.equal(result.error, null);
  });

  it("handles empty output", () => {
    const result = parseGeminiOutput("");
    assert.equal(result.response, null);
    assert.ok(result.error);
  });

  it("handles null output", () => {
    const result = parseGeminiOutput(null);
    assert.equal(result.response, null);
    assert.ok(result.error);
  });
});

describe("parseStructuredOutput", () => {
  it("parses valid structured output", () => {
    const raw = '{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}';
    const result = parseStructuredOutput(raw);
    assert.ok(result.parsed);
    assert.equal(result.parsed.verdict, "approve");
    assert.equal(result.parseError, null);
  });

  it("returns fallback for empty input", () => {
    const result = parseStructuredOutput("", { failureMessage: "No output" });
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });

  it("returns fallback for null input", () => {
    const result = parseStructuredOutput(null);
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });
});
