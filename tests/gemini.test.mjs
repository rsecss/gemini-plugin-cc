import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  createActivityTimeout,
  extractStructuredJson,
  parseGeminiOutput,
  parseStructuredOutput,
  probeGeminiAuth,
  runGeminiHeadless,
  runGeminiReview,
} from "../plugins/gemini/scripts/lib/gemini.mjs";

const FAKE_GEMINI_SCRIPT = [
  'import fs from "node:fs";',
  'import process from "node:process";',
  "",
  "const args = process.argv.slice(2);",
  'if (args.includes("--version")) {',
  '  process.stdout.write("0.36.0\\n");',
  "  process.exit(0);",
  "}",
  'if (args.includes("-p")) {',
  '  process.stderr.write("unexpected -p\\n");',
  "  process.exit(42);",
  "}",
  'const outputIndex = args.indexOf("-o");',
  'const outputMode = outputIndex === -1 ? "" : args[outputIndex + 1];',
  'const sandboxIndex = args.indexOf("--sandbox");',
  'if (args.includes("-s") && args[args.indexOf("-s") + 1] === "sandbox") {',
  '  process.stderr.write("legacy sandbox flag syntax\\n");',
  '  process.exit(43);',
  '}',
  'if (sandboxIndex !== -1 && args[sandboxIndex + 1] === "sandbox") {',
  '  process.stderr.write("boolean sandbox flag received a legacy value\\n");',
  '  process.exit(44);',
  '}',
  'const input = fs.readFileSync(0, "utf8");',
  "",
  'if (outputMode === "json") {',
  '  process.stdout.write(JSON.stringify({ response: input.trim() || "ok" }));',
  "  process.exit(0);",
  "}",
  'if (outputMode === "stream-json") {',
  '  if (input.includes("RETURN_STRUCTURED_REVIEW")) {',
  '    process.stdout.write(`${JSON.stringify({ type: "result", response: "```json\\n{\\"verdict\\":\\"approve\\",\\"summary\\":\\"all good\\",\\"findings\\":[],\\"next_steps\\":[]}\\n```" })}\\n`);',
  "    process.exit(0);",
  "  }",
  '  if (input.includes("RETURN_PLAIN_REVIEW")) {',
  '    process.stdout.write(`${JSON.stringify({ type: "result", response: "plain text review output" })}\\n`);',
  "    process.exit(0);",
  "  }",
  '  if (input.includes("RETURN_ASSISTANT_CONTENT_ONLY")) {',
  '    process.stdout.write(`${JSON.stringify({ type: "init", session_id: "test-session", model: "fake-model" })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "message", role: "user", content: input })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "message", role: "assistant", content: "ACK:", delta: true })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "message", role: "assistant", content: input, delta: true })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 1 } })}\\n`);',
  "    process.exit(0);",
  "  }",
  '  if (input.includes("RETURN_GENERIC_CONTENT_ONLY")) {',
  '    process.stdout.write(`${JSON.stringify({ type: "message", content: "ACK:", delta: true })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "message", content: input, delta: true })}\\n`);',
  '    process.stdout.write(`${JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 1 } })}\\n`);',
  "    process.exit(0);",
  "  }",
  '  process.stdout.write(`${JSON.stringify({ type: "message", text: input })}\\n`);',
  '  process.stdout.write(`${JSON.stringify({ type: "result", response: "ACK:" + input })}\\n`);',
  "  process.exit(0);",
  "}",
  'process.stderr.write(`unexpected args: ${args.join(" ")}\\n`);',
  "process.exit(1);",
  "",
].join("\n");

async function withFakeGemini(testFn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-test-"));
  const scriptPath = path.join(tempDir, "fake-gemini.mjs");
  const launcherPath = process.platform === "win32" ? path.join(tempDir, "gemini.cmd") : path.join(tempDir, "gemini");
  const originalEnv = {
    PATH: process.env.PATH,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  };

  fs.writeFileSync(scriptPath, `${FAKE_GEMINI_SCRIPT}\n`, "utf8");
  if (process.platform === "win32") {
    fs.writeFileSync(launcherPath, '@echo off\nnode "%~dp0fake-gemini.mjs" %*\n', "utf8");
  } else {
    fs.writeFileSync(launcherPath, '#!/bin/sh\nnode "$(dirname "$0")/fake-gemini.mjs" "$@"\n', "utf8");
    fs.chmodSync(launcherPath, 0o755);
  }

  process.env.PATH = `${tempDir}${path.delimiter}${originalEnv.PATH ?? ""}`;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_CLOUD_PROJECT;

  try {
    return await testFn();
  } finally {
    if (originalEnv.PATH == null) delete process.env.PATH;
    else process.env.PATH = originalEnv.PATH;
    if (originalEnv.GEMINI_API_KEY == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    if (originalEnv.GOOGLE_APPLICATION_CREDENTIALS == null) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = originalEnv.GOOGLE_APPLICATION_CREDENTIALS;
    if (originalEnv.GOOGLE_CLOUD_PROJECT == null) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = originalEnv.GOOGLE_CLOUD_PROJECT;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

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

describe("probeGeminiAuth", () => {
  it("accepts a successful stdin-only headless probe", async () => {
    await withFakeGemini(async () => {
      const result = probeGeminiAuth(process.cwd());
      assert.equal(result.available, true);
      assert.equal(result.ready, true);
      assert.equal(result.detail, "authenticated");
    });
  });
});

describe("createActivityTimeout", () => {
  it("resets to the configured inactivity timeout after each event", async () => {
    let fired = false;
    const timer = createActivityTimeout(50, () => {
      fired = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    timer.extend();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(fired, false);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(fired, true);
    timer.clear();
  });
});

describe("runGeminiHeadless", () => {
  it("streams the prompt through stdin without requiring -p", async () => {
    await withFakeGemini(async () => {
      const prompt = "review this diff";
      const result = await runGeminiHeadless(prompt, {
        cwd: process.cwd(),
        timeoutMs: 5_000,
      });

      assert.equal(result.status, 0);
      assert.equal(result.error, null);
      assert.equal(result.response, `ACK:${prompt}`);
    });
  });

  it("extracts assistant content when the result event has no response field", async () => {
    await withFakeGemini(async () => {
      const prompt = "RETURN_ASSISTANT_CONTENT_ONLY";
      const result = await runGeminiHeadless(prompt, {
        cwd: process.cwd(),
        timeoutMs: 5_000,
      });

      assert.equal(result.status, 0);
      assert.equal(result.error, null);
      assert.equal(result.response, `ACK:${prompt}`);
    });
  });

  it("falls back to generic delta content for legacy message events without role metadata", async () => {
    await withFakeGemini(async () => {
      const prompt = "RETURN_GENERIC_CONTENT_ONLY";
      const result = await runGeminiHeadless(prompt, {
        cwd: process.cwd(),
        timeoutMs: 5_000,
      });

      assert.equal(result.status, 0);
      assert.equal(result.error, null);
      assert.equal(result.response, `ACK:${prompt}`);
    });
  });

  it("treats sandbox as a boolean CLI flag and accepts the legacy 'sandbox' config value", async () => {
    await withFakeGemini(async () => {
      const prompt = "sandboxed request";
      const result = await runGeminiHeadless(prompt, {
        cwd: process.cwd(),
        timeoutMs: 5_000,
        sandbox: "sandbox",
      });

      assert.equal(result.status, 0);
      assert.equal(result.error, null);
      assert.equal(result.response, `ACK:${prompt}`);
    });
  });
});

describe("runGeminiReview", () => {
  it("parses structured review JSON when Gemini follows the contract", async () => {
    await withFakeGemini(async () => {
      const result = await runGeminiReview(
        { content: "RETURN_STRUCTURED_REVIEW", summary: "", target: {} },
        { cwd: process.cwd() }
      );

      assert.equal(result.fallback, false);
      assert.ok(result.parsed);
      assert.equal(result.parsed.verdict, "approve");
      assert.equal(result.parseError, null);
    });
  });

  it("does not fabricate an empty finding set from plain-text review output", async () => {
    await withFakeGemini(async () => {
      const result = await runGeminiReview(
        { content: "RETURN_PLAIN_REVIEW", summary: "", target: {} },
        { cwd: process.cwd() }
      );

      assert.equal(result.fallback, true);
      assert.equal(result.parsed, null);
      assert.match(result.parseError, /No valid JSON found/i);
      assert.equal(result.rawOutput, "plain text review output");
    });
  });
});
