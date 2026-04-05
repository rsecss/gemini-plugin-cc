/**
 * gemini.mjs — Gemini CLI integration core.
 *
 * Replaces Codex's codex.mjs + app-server.mjs with direct CLI headless calls.
 * Key design: no Broker, file-lock concurrency, three-layer JSON extraction,
 * activity-based timeout renewal, env passthrough for API base/proxy.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { readJsonFile } from "./fs.mjs";
import { binaryAvailable, runCommand, terminateProcessTree } from "./process.mjs";

// ── Constants ──────────────────────────────────────────────────────────

const MIN_GEMINI_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes
const ACTIVITY_EXTEND_MS = 5 * 60 * 1000;    // 5 minutes per activity event
const LOCK_TIMEOUT_MS = 60_000;               // 60 seconds lock wait
const LOCK_POLL_MS = 500;
const SIGTERM_GRACE_MS = 3_000;

// ── Availability & Auth ────────────────────────────────────────────────

/**
 * Check if `gemini` CLI is installed and meets the minimum version.
 * @param {string} [cwd]
 * @returns {{ available: boolean, detail: string, version?: string }}
 */
export function getGeminiAvailability(cwd) {
  const status = binaryAvailable("gemini", ["--version"], { cwd });
  if (!status.available) return status;

  const parsed = parseGeminiVersion(status.detail);
  if (!parsed.compatible) {
    return {
      available: false,
      detail: `Gemini CLI version ${parsed.version ?? "unknown"} is below minimum ${MIN_GEMINI_VERSION}. ${parsed.detail}`,
    };
  }
  return { available: true, detail: status.detail, version: parsed.version };
}

/**
 * Probe Gemini CLI authentication readiness.
 *
 * Strategy:
 * 1. Quick pre-check: GEMINI_API_KEY or Google Cloud credential env vars
 * 2. Minimal headless probe (`echo "ok" | gemini -p -o json`) with short timeout
 *
 * Does NOT rely on non-existent `gemini auth status` or `gemini auth login`.
 *
 * @param {string} [cwd]
 * @returns {{ available: boolean, ready: boolean, detail: string }}
 */
export function probeGeminiAuth(cwd) {
  const avail = getGeminiAvailability(cwd);
  if (!avail.available) {
    return { available: false, ready: false, detail: avail.detail };
  }

  if (process.env.GEMINI_API_KEY) {
    return { available: true, ready: true, detail: "GEMINI_API_KEY is configured" };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT) {
    return { available: true, ready: true, detail: "Google Cloud credentials detected" };
  }

  const result = runCommand("gemini", ["-p", "-o", "json"], {
    cwd,
    input: "reply with exactly: ok",
    timeout: 15_000,
  });

  if (result.status === 0) {
    return { available: true, ready: true, detail: "authenticated" };
  }

  const errorText = (result.stderr || result.stdout || "").trim();
  return {
    available: true,
    ready: false,
    detail: errorText || "Authentication not configured. Run `gemini` interactively to authenticate, or set GEMINI_API_KEY.",
  };
}

/**
 * Detect current API endpoint and proxy configuration.
 * @returns {{ apiBase: string | null, proxy: string | null, customEndpoint: boolean }}
 */
export function getGeminiEndpointConfig() {
  const apiBase = process.env.GEMINI_API_BASE || null;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
  return {
    apiBase,
    proxy,
    customEndpoint: apiBase !== null,
  };
}

// ── Version Parsing ────────────────────────────────────────────────────

/**
 * Parse and compare version against MIN_GEMINI_VERSION.
 * @param {string} versionOutput
 * @returns {{ compatible: boolean, version?: string, detail: string }}
 */
function parseGeminiVersion(versionOutput) {
  const match = String(versionOutput).match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    // Cannot parse → assume compatible (don't block on unknown format)
    return { compatible: true, version: null, detail: "cannot parse version, assuming compatible" };
  }
  const version = match[1];
  const [major, minor, patch] = version.split(".").map(Number);
  const [minMajor, minMinor, minPatch] = MIN_GEMINI_VERSION.split(".").map(Number);

  const compatible =
    major > minMajor ||
    (major === minMajor && minor > minMinor) ||
    (major === minMajor && minor === minMinor && patch >= minPatch);

  return {
    compatible,
    version,
    detail: compatible
      ? `version ${version} meets minimum ${MIN_GEMINI_VERSION}`
      : `Upgrade with: npm install -g @google/gemini-cli`,
  };
}

// ── Environment ────────────────────────────────────────────────────────

/**
 * Build environment variables for spawning Gemini CLI.
 * Transparent passthrough of proxy/mirror config.
 * @param {{ apiBase?: string, apiKey?: string }} opts
 * @returns {NodeJS.ProcessEnv}
 */
export function buildGeminiEnv(opts = {}) {
  const env = { ...process.env };
  if (opts.apiBase) env.GEMINI_API_BASE = opts.apiBase;
  if (opts.apiKey) env.GEMINI_API_KEY = opts.apiKey;
  // HTTPS_PROXY, HTTP_PROXY, NO_PROXY inherit from process.env
  return env;
}

// ── File Lock (concurrency control) ───────────────────────────────────

/**
 * Acquire an exclusive file lock. Waits up to LOCK_TIMEOUT_MS, detecting
 * orphan locks (holder PID no longer running).
 * @param {string} stateDir
 * @param {string | null} [jobId] - Optional job ID for ownership tracking
 * @returns {string} lock file path
 */
export function acquireGeminiLock(stateDir, jobId = null) {
  const lockPath = path.join(stateDir, "gemini.lock");
  fs.mkdirSync(stateDir, { recursive: true });
  const start = Date.now();

  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now(), jobId }), { flag: "wx" });
      return lockPath;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;

      // Check for orphan lock
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        process.kill(lock.pid, 0); // throws if process doesn't exist
      } catch {
        // Holder is gone — clean up orphan
        try { fs.unlinkSync(lockPath); } catch { /* race ok */ }
        continue;
      }

      // Holder is alive — wait and retry
      const elapsed = Date.now() - start;
      if (elapsed + LOCK_POLL_MS >= LOCK_TIMEOUT_MS) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }

  throw new Error("gemini lock acquisition timed out (60s) — another task may be stuck");
}

/**
 * Release the file lock unconditionally.
 * @param {string} lockPath
 */
export function releaseGeminiLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already released */ }
}

/**
 * Release the lock only if it is owned by the given jobId.
 * Prevents cancel from destroying another task's lock (F3 fix).
 * @param {string} lockPath
 * @param {string | null} jobId
 * @returns {boolean} true if released
 */
export function releaseGeminiLockIfOwner(lockPath, jobId) {
  if (!jobId) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (lock.jobId === jobId) {
      fs.unlinkSync(lockPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Activity Timeout ───────────────────────────────────────────────────

/**
 * Create a timeout that can be extended on activity.
 * @param {number} timeoutMs
 * @param {() => void} onTimeout
 */
function createActivityTimeout(timeoutMs, onTimeout) {
  let timer = setTimeout(onTimeout, timeoutMs);
  return {
    extend() {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, ACTIVITY_EXTEND_MS);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

// ── Core Headless Execution ────────────────────────────────────────────

/**
 * Run Gemini CLI in headless mode with stream-json output.
 * Returns a promise that resolves with the full result.
 *
 * @param {string} prompt
 * @param {{
 *   model?: string,
 *   outputMode?: string,
 *   sandbox?: string,
 *   approvalMode?: string,
 *   sessionId?: string,
 *   apiBase?: string,
 *   apiKey?: string,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   onEvent?: (event: object) => void,
 * }} opts
 * @returns {Promise<{ status: number, events: object[], response: string, error: string | null, pid: number }>}
 */
export function runGeminiHeadless(prompt, opts = {}) {
  const outputMode = opts.outputMode ?? "stream-json";
  const args = ["-p", "-o", outputMode];
  if (opts.model) args.push("-m", opts.model);
  if (opts.sandbox) args.push("-s", opts.sandbox);
  if (opts.approvalMode) args.push("--approval-mode", opts.approvalMode);
  if (opts.sessionId) args.push("-r", opts.sessionId);

  const env = buildGeminiEnv(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn("gemini", args, {
      shell: process.platform === "win32",
      windowsHide: true,
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const events = [];
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      activityTimer.clear();
      resolve(value);
    };

    const activityTimer = createActivityTimeout(timeoutMs, () => {
      if (settled) return;
      stderr += "\n[gemini-plugin] Hard timeout reached, terminating.\n";
      terminateProcessTree(child.pid);
      settle({
        status: 1,
        events,
        response: extractResponseFromEvents(events),
        error: `Gemini task timed out after ${Math.round(timeoutMs / 1000)}s of inactivity.`,
        pid: child.pid,
      });
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      activityTimer.extend();

      if (outputMode === "stream-json") {
        // Parse newline-delimited JSON events
        const lines = stdout.split("\n");
        stdout = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            events.push(event);
            opts.onEvent?.(event);
          } catch { /* partial line, ignore */ }
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      settle({
        status: 1,
        events,
        response: "",
        error: err.message,
        pid: child.pid,
      });
    });

    child.on("close", (code) => {
      // Process any remaining stdout
      if (outputMode === "stream-json" && stdout.trim()) {
        try {
          const event = JSON.parse(stdout.trim());
          events.push(event);
          opts.onEvent?.(event);
        } catch { /* ignore */ }
      } else if (outputMode === "json" && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          events.push(parsed);
        } catch { /* ignore */ }
      }

      const response = outputMode === "stream-json"
        ? extractResponseFromEvents(events)
        : (outputMode === "json" ? (events[0]?.response ?? stdout) : stdout);

      settle({
        status: code ?? 0,
        events,
        response,
        error: code !== 0 ? (stderr.trim() || `gemini exited with code ${code}`) : null,
        pid: child.pid,
      });
    });

    // Write prompt to stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ── Stream Event Helpers ───────────────────────────────────────────────

/**
 * Extract the final response text from stream-json events.
 * @param {object[]} events
 * @returns {string}
 */
function extractResponseFromEvents(events) {
  // Look for the `result` event type first
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "result" && ev.response) return ev.response;
  }

  // Fallback: concatenate message events' text
  const messageParts = [];
  for (const ev of events) {
    if (ev.type === "message" && ev.text) messageParts.push(ev.text);
  }
  return messageParts.join("");
}

// ── Structured JSON Extraction (Three-Layer Strategy) ─────────────────

/**
 * Extract structured JSON from Gemini's free-text response.
 *
 * Layer 1: Look for ```json ... ``` code blocks
 * Layer 2: Try to parse the entire response as JSON
 * Layer 3: Fallback to plain text with default structure
 *
 * @param {string} responseText
 * @param {object} [schema] - JSON schema for validation (unused for strict validation, just shape checking)
 * @returns {{ parsed: object | null, parseError: string | null, rawOutput: string, fallback: boolean }}
 */
export function extractStructuredJson(responseText, schema) {
  if (!responseText || !responseText.trim()) {
    return { parsed: null, parseError: "Empty response", rawOutput: responseText ?? "", fallback: true };
  }

  // Layer 1: Extract JSON from ```json ... ``` code blocks
  const jsonBlockMatch = responseText.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      return { parsed, parseError: null, rawOutput: responseText, fallback: false };
    } catch { /* continue to layer 2 */ }
  }

  // Layer 1b: Look for bare JSON object in response (first { ... } block)
  const braceMatch = responseText.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      return { parsed, parseError: null, rawOutput: responseText, fallback: false };
    } catch { /* continue to layer 2 */ }
  }

  // Layer 2: Try entire response as JSON
  try {
    const parsed = JSON.parse(responseText.trim());
    return { parsed, parseError: null, rawOutput: responseText, fallback: false };
  } catch { /* continue to layer 3 */ }

  // Layer 3: Fallback — treat as plain text
  return {
    parsed: null,
    parseError: "No valid JSON found in response",
    rawOutput: responseText,
    fallback: true,
  };
}

// ── Review ─────────────────────────────────────────────────────────────

/**
 * Run a structured code review via Gemini CLI.
 * @param {{ content: string, summary: string, target: object }} reviewContext
 * @param {object} opts - Same as runGeminiHeadless opts, plus `promptTemplate`, `schema`
 * @returns {Promise<{ status: number, parsed: object | null, parseError: string | null, rawOutput: string, fallback: boolean, error: string | null, events: object[] }>}
 */
export async function runGeminiReview(reviewContext, opts = {}) {
  // When promptTemplate is provided, it already contains the review context —
  // do NOT append reviewContext.content again (fixes double-injection, F2).
  const prompt = opts.promptTemplate ?? reviewContext.content;

  const result = await runGeminiHeadless(prompt, opts);

  if (result.error && !result.response) {
    return {
      status: result.status,
      parsed: null,
      parseError: result.error,
      rawOutput: "",
      fallback: true,
      error: result.error,
      events: result.events,
    };
  }

  const extracted = extractStructuredJson(result.response, opts.schema);

  // If JSON extraction failed, build a fallback review structure
  if (extracted.fallback || !extracted.parsed) {
    return {
      status: result.status,
      parsed: {
        verdict: "needs-attention",
        summary: result.response.slice(0, 2000) || "Review completed but output was not structured JSON.",
        findings: [],
        next_steps: [],
      },
      parseError: extracted.parseError,
      rawOutput: result.response,
      fallback: true,
      error: result.error,
      events: result.events,
    };
  }

  return {
    status: result.status,
    parsed: extracted.parsed,
    parseError: null,
    rawOutput: result.response,
    fallback: false,
    error: result.error,
    events: result.events,
  };
}

// ── Task ───────────────────────────────────────────────────────────────

/**
 * Run a general-purpose task via Gemini CLI.
 * @param {string} taskPrompt
 * @param {object} opts - Same as runGeminiHeadless
 * @returns {Promise<{ status: number, response: string, error: string | null, events: object[], pid: number }>}
 */
export async function runGeminiTask(taskPrompt, opts = {}) {
  return runGeminiHeadless(taskPrompt, opts);
}

// ── Interrupt ──────────────────────────────────────────────────────────

/**
 * Interrupt a running Gemini task. Two-stage: SIGTERM → wait → SIGKILL.
 * Best-effort process termination — does not capture partial results.
 * @param {number} pid
 * @returns {Promise<{ interrupted: boolean }>}
 */
export async function interruptGeminiTask(pid) {
  if (!pid || !Number.isFinite(pid)) {
    return { interrupted: false };
  }

  // Stage 1: SIGTERM
  const termResult = terminateProcessTree(pid);
  if (!termResult.delivered) {
    return { interrupted: false };
  }

  // Stage 2: Wait grace period, then SIGKILL if still alive
  await new Promise((r) => setTimeout(r, SIGTERM_GRACE_MS));
  try {
    process.kill(pid, 0);
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  } catch { /* already exited */ }

  return { interrupted: true };
}

// ── Output Parsing ─────────────────────────────────────────────────────

/**
 * Parse raw JSON output from Gemini `-o json` mode.
 * @param {string} raw
 * @returns {{ response: string | null, stats: object | null, error: string | null }}
 */
export function parseGeminiOutput(raw) {
  if (!raw || !raw.trim()) {
    return { response: null, stats: null, error: "Empty output" };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      response: parsed.response ?? null,
      stats: parsed.stats ?? null,
      error: parsed.error ?? null,
    };
  } catch (e) {
    return { response: raw, stats: null, error: null };
  }
}

/**
 * Read and parse the review output JSON schema.
 * @param {string} schemaPath
 * @returns {object}
 */
export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

/**
 * Parse structured output with fallback (mirrors Codex's parseStructuredOutput).
 * @param {string} rawOutput
 * @param {object} fallback
 */
export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Gemini did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback,
    };
  }

  const extracted = extractStructuredJson(rawOutput);
  if (extracted.parsed) {
    return { parsed: extracted.parsed, parseError: null, rawOutput, ...fallback };
  }
  return { parsed: null, parseError: extracted.parseError, rawOutput, ...fallback };
}
