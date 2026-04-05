#!/usr/bin/env node

/**
 * session-lifecycle-hook.mjs — Handles SessionStart and SessionEnd events.
 *
 * SessionStart: exports GEMINI_COMPANION_SESSION_ID to the Claude env file.
 * SessionEnd: terminates running jobs for this session, cleans up state and lock files.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { terminateProcessTree } from "./lib/process.mjs";
import { loadState, resolveStateDir, resolveStateFile, saveState } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

/**
 * Read hook input from stdin. Handles EAGAIN safely.
 * @returns {object}
 */
function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "EAGAIN" || e.code === "EOF") return {};
    // JSON parse failure
    return {};
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") return;
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

/**
 * Terminate running jobs for this session and remove them from state.
 * @param {string} cwd
 * @param {string} sessionId
 */
function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) return;

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) return;

  const state = loadState(workspaceRoot);
  const sessionJobs = state.jobs.filter((j) => j.sessionId === sessionId);
  if (sessionJobs.length === 0) return;

  // Terminate running jobs
  for (const job of sessionJobs) {
    if (job.status === "queued" || job.status === "running") {
      try { terminateProcessTree(job.pid ?? Number.NaN); } catch { /* ignore */ }
    }
  }

  // Remove session jobs from state
  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((j) => j.sessionId !== sessionId),
  });
}

/**
 * Clean up orphan lock files on session end.
 * @param {string} cwd
 */
function cleanupLockFile(cwd) {
  try {
    const stateDir = resolveStateDir(cwd);
    const lockPath = path.join(stateDir, "gemini.lock");
    if (fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      try { process.kill(lock.pid, 0); } catch {
        // Holder is dead — remove orphan lock
        fs.unlinkSync(lockPath);
      }
    }
  } catch { /* ignore */ }
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(PLUGIN_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
}

function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  cleanupSessionJobs(cwd, input.session_id || process.env[SESSION_ID_ENV]);
  cleanupLockFile(cwd);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
  } else if (eventName === "SessionEnd") {
    handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
