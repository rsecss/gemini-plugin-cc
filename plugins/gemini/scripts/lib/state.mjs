import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "gemini-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false,
      apiBase: null,
      defaultModel: "auto",
      defaultTimeoutMs: 30 * 60 * 1000,
      defaultSandbox: null,
    },
    jobs: [],
  };
}

/**
 * Resolve the state directory for a workspace.
 * Path: `<CLAUDE_PLUGIN_DATA>/state/<slug>-<hash>` or `<tmpdir>/gemini-companion/<slug>-<hash>`
 * @param {string} cwd
 * @returns {string}
 */
export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

/** @param {string} cwd @returns {string} */
export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

/** @param {string} cwd @returns {string} */
export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

/** Ensure the state directory and jobs subdirectory exist. */
export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

/**
 * Load state from disk, merging with defaults for missing fields.
 * @param {string} cwd
 */
export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) return defaultState();

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: { ...defaultState().config, ...(parsed.config ?? {}) },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

/** Keep only the newest MAX_JOBS jobs. */
function pruneJobs(jobs) {
  return [...jobs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}

/**
 * Save state atomically (write .tmp then rename). Prunes old jobs and cleans up orphaned files.
 * @param {string} cwd
 * @param {object} state
 */
export function saveState(cwd, state) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);

  const nextJobs = pruneJobs(state.jobs ?? []);
  const nextState = {
    version: STATE_VERSION,
    config: { ...defaultState().config, ...(state.config ?? {}) },
    jobs: nextJobs,
  };

  // Clean up files for pruned jobs
  const retainedIds = new Set(nextJobs.map((j) => j.id));
  for (const job of previousJobs) {
    if (retainedIds.has(job.id)) continue;
    removeFileIfExists(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  // Atomic write: .tmp → rename
  const stateFile = resolveStateFile(cwd);
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, stateFile);
  return nextState;
}

const STATE_LOCK_TIMEOUT_MS = 5_000;
const STATE_LOCK_POLL_MS = 50;

/**
 * Acquire a file lock for state updates (prevents concurrent load→mutate→save races).
 * @param {string} stateDir
 * @returns {string} lock file path
 */
function acquireStateLock(stateDir) {
  const lockPath = path.join(stateDir, "state.lock");
  fs.mkdirSync(stateDir, { recursive: true });
  const start = Date.now();

  while (Date.now() - start < STATE_LOCK_TIMEOUT_MS) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return lockPath;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const pid = parseInt(fs.readFileSync(lockPath, "utf8"), 10);
        process.kill(pid, 0);
      } catch {
        try { fs.unlinkSync(lockPath); } catch { /* race ok */ }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_LOCK_POLL_MS);
    }
  }

  // Timeout — force release stale lock and retry once
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return lockPath;
  } catch {
    throw new Error("state lock acquisition timed out");
  }
}

function releaseStateLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already released */ }
}

/**
 * Load, mutate, save — atomic state update with file lock.
 * @param {string} cwd
 * @param {(state: object) => void} mutate
 */
export function updateState(cwd, mutate) {
  const stateDir = resolveStateDir(cwd);
  const lockPath = acquireStateLock(stateDir);
  try {
    const state = loadState(cwd);
    mutate(state);
    return saveState(cwd, state);
  } finally {
    releaseStateLock(lockPath);
  }
}

/**
 * Generate a unique job ID with timestamp and random suffix.
 * @param {string} prefix
 * @returns {string}
 */
export function generateJobId(prefix = "gem") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * Create or update a job in state.
 * @param {string} cwd
 * @param {object} jobPatch - Must include `id` field
 */
export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((j) => j.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({ createdAt: timestamp, updatedAt: timestamp, ...jobPatch });
    } else {
      state.jobs[existingIndex] = { ...state.jobs[existingIndex], ...jobPatch, updatedAt: timestamp };
    }
  });
}

/** @param {string} cwd @returns {object[]} */
export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

/** @param {string} cwd @param {string} key @param {any} value */
export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = { ...state.config, [key]: value };
  });
}

/** @param {string} cwd @returns {object} */
export function getConfig(cwd) {
  return loadState(cwd).config;
}

/**
 * Write a full job record to its own JSON file.
 * @param {string} cwd
 * @param {string} jobId
 * @param {object} payload
 * @returns {string} path to written file
 */
export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  const tmp = `${jobFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, jobFile);
  return jobFile;
}

/** @param {string} jobFile @returns {object} */
export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

/** @param {string} cwd @param {string} jobId @returns {string} */
export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

/** @param {string} cwd @param {string} jobId @returns {string} */
export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}
