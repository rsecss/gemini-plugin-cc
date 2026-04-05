/**
 * job-control.mjs — Job status queries, result retrieval, and cancel resolution.
 */

import fs from "node:fs";

import { getConfig, listJobs, readJobFile, resolveJobFile } from "./state.mjs";
import { SESSION_ID_ENV } from "./tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

export const DEFAULT_MAX_STATUS_JOBS = 8;
export const DEFAULT_MAX_PROGRESS_LINES = 4;

/** Sort jobs newest-first by updatedAt. */
export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function getCurrentSessionId(options = {}) {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentSession(jobs, options = {}) {
  const sessionId = getCurrentSessionId(options);
  if (!sessionId) return jobs;
  return jobs.filter((j) => j.sessionId === sessionId);
}

function getJobTypeLabel(job) {
  if (typeof job.kindLabel === "string" && job.kindLabel) return job.kindLabel;
  if (job.kind === "adversarial-review") return "adversarial-review";
  if (job.kind === "review") return "review";
  if (job.kind === "task") return "rescue";
  return "job";
}

function stripLogPrefix(line) {
  return line.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function isProgressBlockTitle(line) {
  return (
    ["Final output", "Assistant message", "Reasoning summary"].includes(line) ||
    /^Subagent .+ message$/.test(line)
  );
}

/**
 * Read last N progress lines from a job log file.
 * @param {string | null} logFile
 * @param {number} maxLines
 * @returns {string[]}
 */
export function readJobProgressPreview(logFile, maxLines = DEFAULT_MAX_PROGRESS_LINES) {
  if (!logFile || !fs.existsSync(logFile)) return [];

  const lines = fs
    .readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .filter((l) => l.startsWith("["))
    .map(stripLogPrefix)
    .filter((l) => l && !isProgressBlockTitle(l));

  return lines.slice(-maxLines);
}

function formatElapsedDuration(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) return null;

  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) return null;

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function inferJobPhase(job, progressPreview = []) {
  switch (job.status) {
    case "queued": return "queued";
    case "cancelled": return "cancelled";
    case "failed": return "failed";
    case "completed": return "done";
    default: break;
  }

  for (let i = progressPreview.length - 1; i >= 0; i--) {
    const line = progressPreview[i].toLowerCase();
    if (line.startsWith("starting gemini") || line.startsWith("running gemini")) return "starting";
    if (line.includes("review")) return "reviewing";
    if (line.startsWith("gemini error:") || line.startsWith("failed:")) return "failed";
  }

  return job.kind === "review" || job.kind === "adversarial-review" ? "reviewing" : "running";
}

/**
 * Enrich a job with computed fields: kindLabel, progressPreview, elapsed, phase.
 * @param {object} job
 * @param {{ maxProgressLines?: number }} options
 * @returns {object}
 */
export function enrichJob(job, options = {}) {
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;
  const enriched = {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview:
      job.status === "queued" || job.status === "running" || job.status === "failed"
        ? readJobProgressPreview(job.logFile, maxProgressLines)
        : [],
    elapsed: formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? null),
    duration:
      job.status === "completed" || job.status === "failed" || job.status === "cancelled"
        ? formatElapsedDuration(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt)
        : null,
  };

  return { ...enriched, phase: enriched.phase ?? inferJobPhase(enriched, enriched.progressPreview) };
}

/**
 * Read a stored job file, or null if not found.
 * @param {string} workspaceRoot
 * @param {string} jobId
 */
export function readStoredJob(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) return null;
  try { return readJobFile(jobFile); } catch { return null; }
}

/**
 * Match a job reference (exact ID, prefix, or latest).
 * @param {object[]} jobs
 * @param {string | null} reference
 * @param {(job: object) => boolean} predicate
 */
function matchJobReference(jobs, reference, predicate = () => true) {
  const filtered = jobs.filter(predicate);
  if (!reference) return filtered[0] ?? null;

  const exact = filtered.find((j) => j.id === reference);
  if (exact) return exact;

  const prefixMatches = filtered.filter((j) => j.id.startsWith(reference));
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  }

  throw new Error(`No job found for "${reference}". Run /gemini:status to list known jobs.`);
}

/**
 * Build a status snapshot: running, latestFinished, recent jobs.
 * @param {string} cwd
 * @param {object} options
 */
export function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);
  const jobs = sortJobsNewestFirst(filterJobsForCurrentSession(listJobs(workspaceRoot), options));
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;
  const maxProgressLines = options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;

  const running = jobs
    .filter((j) => j.status === "queued" || j.status === "running")
    .map((j) => enrichJob(j, { maxProgressLines }));

  const latestFinishedRaw = jobs.find((j) => j.status !== "queued" && j.status !== "running") ?? null;
  const latestFinished = latestFinishedRaw ? enrichJob(latestFinishedRaw, { maxProgressLines }) : null;

  const recent = (options.all ? jobs : jobs.slice(0, maxJobs))
    .filter((j) => j.status !== "queued" && j.status !== "running" && j.id !== latestFinished?.id)
    .map((j) => enrichJob(j, { maxProgressLines }));

  return {
    workspaceRoot,
    config,
    running,
    latestFinished,
    recent,
    needsReview: Boolean(config.stopReviewGate),
  };
}

/**
 * Build a single-job status snapshot.
 * @param {string} cwd
 * @param {string} reference
 * @param {object} options
 */
export function buildSingleJobSnapshot(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const selected = matchJobReference(jobs, reference);
  if (!selected) throw new Error(`No job found for "${reference}". Run /gemini:status to inspect known jobs.`);
  return { workspaceRoot, job: enrichJob(selected, { maxProgressLines: options.maxProgressLines }) };
}

/**
 * Resolve a finished job for result retrieval.
 * @param {string} cwd
 * @param {string | null} reference
 */
export function resolveResultJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(
    reference ? listJobs(workspaceRoot) : filterJobsForCurrentSession(listJobs(workspaceRoot))
  );

  const selected = matchJobReference(
    jobs, reference,
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
  );

  if (selected) return { workspaceRoot, job: selected };

  const active = matchJobReference(jobs, reference, (j) => j.status === "queued" || j.status === "running");
  if (active) {
    throw new Error(`Job ${active.id} is still ${active.status}. Check /gemini:status and try again once it finishes.`);
  }

  if (reference) {
    throw new Error(`No finished job found for "${reference}". Run /gemini:status to inspect active jobs.`);
  }
  throw new Error("No finished Gemini jobs found for this repository yet.");
}

/**
 * Resolve a cancelable (active) job.
 * @param {string} cwd
 * @param {string | null} reference
 */
export function resolveCancelableJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");

  if (reference) {
    const selected = matchJobReference(activeJobs, reference);
    if (!selected) throw new Error(`No active job found for "${reference}".`);
    return { workspaceRoot, job: selected };
  }

  if (activeJobs.length === 1) return { workspaceRoot, job: activeJobs[0] };
  if (activeJobs.length > 1) throw new Error("Multiple Gemini jobs are active. Pass a job id to /gemini:cancel.");
  throw new Error("No active Gemini jobs to cancel.");
}
