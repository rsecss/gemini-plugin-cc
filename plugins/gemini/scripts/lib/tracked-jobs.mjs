/**
 * tracked-jobs.mjs — Job execution tracking with progress reporting.
 */

import fs from "node:fs";
import process from "node:process";

import { readJobFile, resolveJobFile, resolveJobLogFile, upsertJob, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      stderrMessage: value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd(),
    };
  }

  return {
    message: String(value ?? "").trim(),
    phase: null,
    stderrMessage: String(value ?? "").trim(),
    logTitle: null,
    logBody: null,
  };
}

/**
 * Append a timestamped single line to a log file.
 * @param {string | null} logFile
 * @param {string} message
 */
export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) return;
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

/**
 * Append a titled block to a log file.
 * @param {string | null} logFile
 * @param {string} title
 * @param {string} body
 */
export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) return;
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

/**
 * Create an empty log file for a job.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @param {string} [title]
 * @returns {string} log file path
 */
export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  if (title) appendLogLine(logFile, `Starting ${title}.`);
  return logFile;
}

/**
 * Create a job record with timestamps and session ID.
 * @param {object} base
 * @param {{ env?: NodeJS.ProcessEnv, sessionIdEnv?: string }} options
 * @returns {object}
 */
export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {}),
  };
}

/**
 * Create a progress updater that writes phase changes to state.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @returns {(event: any) => void}
 */
export function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    if (!normalized.phase || normalized.phase === lastPhase) return;

    lastPhase = normalized.phase;
    const patch = { id: jobId, phase: normalized.phase };
    upsertJob(workspaceRoot, patch);

    const jobFile = resolveJobFile(workspaceRoot, jobId);
    if (!fs.existsSync(jobFile)) return;

    try {
      const storedJob = readJobFile(jobFile);
      writeJobFile(workspaceRoot, jobId, { ...storedJob, ...patch });
    } catch { /* ignore race */ }
  };
}

/**
 * Create a progress reporter that writes to stderr, log file, and/or callback.
 * @param {{ stderr?: boolean, logFile?: string | null, onEvent?: Function | null }} options
 * @returns {((event: any) => void) | null}
 */
export function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  if (!stderr && !logFile && !onEvent) return null;

  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      process.stderr.write(`[gemini] ${stderrMessage}\n`);
    }
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}

function readStoredJobOrNull(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) return null;
  try { return readJobFile(jobFile); } catch { return null; }
}

/**
 * Execute a job with full state tracking (running → completed/failed).
 * @param {object} job - Must include `id` and `workspaceRoot`
 * @param {() => Promise<{ exitStatus: number, payload?: any, rendered?: string, summary?: string }>} runner
 * @param {{ logFile?: string | null }} options
 */
export async function runTrackedJob(job, runner, options = {}) {
  const runningRecord = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    phase: "starting",
    pid: process.pid,
    logFile: options.logFile ?? job.logFile ?? null,
  };
  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  upsertJob(job.workspaceRoot, runningRecord);

  try {
    const execution = await runner();
    const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
    const completedAt = nowIso();

    writeJobFile(job.workspaceRoot, job.id, {
      ...runningRecord,
      status: completionStatus,
      pid: null,
      phase: completionStatus === "completed" ? "done" : "failed",
      completedAt,
      result: execution.payload,
      rendered: execution.rendered,
    });
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: completionStatus,
      summary: execution.summary,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt,
    });
    appendLogBlock(options.logFile ?? job.logFile ?? null, "Final output", execution.rendered);
    return execution;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const existing = readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;
    const completedAt = nowIso();

    writeJobFile(job.workspaceRoot, job.id, {
      ...existing,
      status: "failed",
      phase: "failed",
      errorMessage,
      pid: null,
      completedAt,
      logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null,
    });
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: "failed",
      phase: "failed",
      pid: null,
      errorMessage,
      completedAt,
    });
    throw error;
  }
}
