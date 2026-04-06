#!/usr/bin/env node

/**
 * gemini-companion.mjs — Main CLI entry point for the Gemini plugin.
 *
 * Subcommands: setup, review, adversarial-review, task, task-worker,
 *              status, result, cancel
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import {
  acquireGeminiLock,
  getGeminiAvailability,
  getGeminiEndpointConfig,
  interruptGeminiTask,
  probeGeminiAuth,
  readOutputSchema,
  releaseGeminiLock,
  releaseGeminiLockIfOwner,
  runGeminiReview,
  runGeminiTask,
} from "./lib/gemini.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { normalizeGeminiCliError, resolveConfiguredModel, resolveRequestedModel } from "./lib/models.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  generateJobId,
  getConfig,
  resolveStateDir,
  setConfig,
  upsertJob,
  writeJobFile,
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderCancelReport,
  renderGeminiFailure,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2_000;

// ── Helpers ────────────────────────────────────────────────────────────

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/gemini-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/gemini-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/gemini-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]",
      "  node scripts/gemini-companion.mjs task [--background] [--write] [-m <model>] [prompt]",
      "  node scripts/gemini-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/gemini-companion.mjs result [job-id] [--json]",
      "  node scripts/gemini-companion.mjs cancel [job-id] [--json]",
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: { C: "cwd", ...(config.aliasMap ?? {}) },
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "").split(/\r?\n/).map((v) => v.trim()).find(Boolean);
  return line ?? fallback;
}

// ── Setup ──────────────────────────────────────────────────────────────

function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const geminiStatus = getGeminiAvailability(cwd);
  const authStatus = probeGeminiAuth(cwd);
  const config = getConfig(workspaceRoot);
  const endpoint = getGeminiEndpointConfig();

  const nextSteps = [];
  if (!geminiStatus.available) {
    nextSteps.push("Install Gemini CLI with `npm install -g @google/gemini-cli`.");
  }
  if (geminiStatus.available && !authStatus.ready) {
    nextSteps.push("Set up authentication: run `gemini` interactively, or set `GEMINI_API_KEY` environment variable.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/gemini:setup --enable-review-gate` to require a review before stop.");
  }

  return {
    ready: nodeStatus.available && geminiStatus.available && authStatus.ready,
    node: nodeStatus,
    npm: npmStatus,
    gemini: geminiStatus,
    auth: { available: authStatus.available, loggedIn: authStatus.ready, detail: authStatus.detail },
    endpoint,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps,
  };
}

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

// ── Review ─────────────────────────────────────────────────────────────

function buildAdversarialReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.content,
  });
}

function buildReviewPrompt(context) {
  const template = loadPromptTemplate(ROOT_DIR, "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    REVIEW_INPUT: context.content,
  });
}

function buildNoChangesReviewResult(reviewName, context, summary) {
  const parsed = {
    verdict: "approve",
    summary,
    findings: [],
    next_steps: [],
  };
  const targetLabel = context.target.label;

  return {
    exitStatus: 0,
    payload: {
      review: reviewName,
      target: context.target,
      context: {
        repoRoot: context.repoRoot,
        branch: context.branch,
        summary: context.summary,
      },
      result: parsed,
      rawOutput: "",
      parseError: null,
    },
    rendered: renderReviewResult(
      { parsed, parseError: null, rawOutput: "" },
      { reviewLabel: reviewName, targetLabel }
    ),
    summary,
    jobTitle: `Gemini ${reviewName}`,
    jobClass: "review",
    targetLabel,
  };
}

function ensureGeminiReady(cwd) {
  const avail = getGeminiAvailability(cwd);
  if (!avail.available) {
    throw new Error(
      "Gemini CLI is not installed. Install with `npm install -g @google/gemini-cli`, then rerun `/gemini:setup`."
    );
  }
}

function selectExecutionModel(requestedModel, configuredModel) {
  return requestedModel ?? resolveConfiguredModel(configuredModel);
}

function buildReviewRequest(cwd, options, reviewName, focusText, extra = {}) {
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  return {
    target,
    request: {
      cwd,
      target,
      model: resolveRequestedModel(options.model),
      focusText,
      reviewName,
      ...extra,
    },
  };
}

async function executeReviewRun(request) {
  ensureGeminiReady(request.cwd);
  ensureGitRepository(request.cwd);

  const target = request.target ?? resolveReviewTarget(request.cwd, { base: request.base, scope: request.scope });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const context = collectReviewContext(request.cwd, target);
  const stateDir = resolveStateDir(request.cwd);
  const config = getConfig(resolveWorkspaceRoot(request.cwd));
  const selectedModel = selectExecutionModel(request.model, config.defaultModel);

  if (!context.hasChanges) {
    const summary = target.mode === "branch"
      ? `No commits or file changes found between the current branch and ${target.baseRef}.`
      : "No staged, unstaged, or untracked changes found in the working tree.";
    return buildNoChangesReviewResult(reviewName, context, summary);
  }

  const prompt = reviewName === "Adversarial Review"
    ? buildAdversarialReviewPrompt(context, focusText)
    : buildReviewPrompt(context);

  // Acquire lock for serialized access (with job ownership tracking)
  const lockPath = acquireGeminiLock(stateDir, request.jobId ?? null);
  try {
    const result = await runGeminiReview(
      { content: context.content, summary: context.summary, target },
      {
        promptTemplate: prompt,
        model: selectedModel,
        cwd: context.repoRoot,
        timeoutMs: config.defaultTimeoutMs,
        apiBase: config.apiBase,
        schema: readOutputSchema(REVIEW_SCHEMA),
        onEvent: (ev) => request.onProgress?.(`Gemini: ${ev.type ?? "event"}`),
      }
    );
    const executionError = normalizeGeminiCliError(result.error, {
      model: request.model,
      configuredModel: config.defaultModel,
    });

    if (executionError && !result.rawOutput) {
      return {
        exitStatus: result.status,
        payload: {
          review: reviewName,
          target,
          context: { repoRoot: context.repoRoot, branch: context.branch, summary: context.summary },
          result: null,
          rawOutput: "",
          parseError: result.parseError,
          error: executionError,
        },
        rendered: renderGeminiFailure(executionError),
        summary: executionError.message,
        jobTitle: `Gemini ${reviewName}`,
        jobClass: "review",
        targetLabel: context.target.label,
      };
    }

    const payload = {
      review: reviewName,
      target,
      context: { repoRoot: context.repoRoot, branch: context.branch, summary: context.summary },
      result: result.parsed,
      rawOutput: result.rawOutput,
      parseError: result.parseError,
      error: executionError,
    };

    return {
      exitStatus: result.status,
      payload,
      rendered: renderReviewResult(
        { parsed: result.parsed, parseError: result.parseError, rawOutput: result.rawOutput },
        { reviewLabel: reviewName, targetLabel: context.target.label }
      ),
      summary: result.parsed?.summary ?? result.parseError ?? firstMeaningfulLine(result.rawOutput, `${reviewName} finished.`),
      jobTitle: `Gemini ${reviewName}`,
      jobClass: "review",
      targetLabel: context.target.label,
    };
  } finally {
    releaseGeminiLock(lockPath);
  }
}

// ── Task ───────────────────────────────────────────────────────────────

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureGeminiReady(request.cwd);
  const config = getConfig(workspaceRoot);
  const stateDir = resolveStateDir(request.cwd);
  const selectedModel = selectExecutionModel(request.model, config.defaultModel);
  const sandboxMode = request.write ? false : (config.defaultSandbox ?? true);

  if (!request.prompt) {
    throw new Error("Provide a prompt, a prompt file, or piped stdin.");
  }

  const lockPath = acquireGeminiLock(stateDir, request.jobId ?? null);
  try {
    const result = await runGeminiTask(request.prompt, {
      model: selectedModel,
      sandbox: sandboxMode,
      cwd: workspaceRoot,
      timeoutMs: config.defaultTimeoutMs,
      apiBase: config.apiBase,
      onEvent: (ev) => request.onProgress?.(`Gemini: ${ev.type ?? "event"}`),
    });

    const rawOutput = typeof result.response === "string" ? result.response : "";
    const executionError = normalizeGeminiCliError(result.error, {
      model: request.model,
      configuredModel: config.defaultModel,
    });
    const failureMessage = executionError ? renderGeminiFailure(executionError).trimEnd() : result.error;
    const rendered = renderTaskResult({ rawOutput, failureMessage });
    const payload = {
      status: result.status,
      rawOutput,
      error: executionError,
      errorDetail: result.error ?? null,
    };

    return {
      exitStatus: result.status,
      payload,
      rendered,
      summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(executionError?.message ?? result.error, "Task finished.")),
      jobTitle: "Gemini Task",
      jobClass: "task",
      write: Boolean(request.write),
    };
  } finally {
    releaseGeminiLock(lockPath);
  }
}

// ── Job Helpers ────────────────────────────────────────────────────────

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: `Gemini ${reviewName}`,
    summary: `${reviewName} ${target.label}`,
  };
}

function buildTaskRunMetadata({ prompt }) {
  return { title: "Gemini Task", summary: shorten(prompt || "Task") };
}

function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check /gemini:status ${payload.jobId} for progress.\n`;
}

function getJobKindLabel(kind) {
  if (kind === "adversarial-review") return "adversarial-review";
  if (kind === "review") return "review";
  return "rescue";
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: getJobKindLabel(kind),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write,
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id),
    }),
  };
}

function buildTaskJob(workspaceRoot, taskMetadata, write) {
  return createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write,
  });
}

function readTaskPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }
  const positionalPrompt = positionals.join(" ");
  return positionalPrompt || readStdinIfPiped();
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, { logFile: options.logFile, stderr: !options.json });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) process.exitCode = execution.exitStatus;
  return execution;
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "gemini-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd, job, request) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Queued for background execution.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = { ...job, status: "queued", phase: "queued", pid: child.pid ?? null, logFile, request };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: { jobId: job.id, status: "queued", title: job.title, summary: job.summary, logFile },
    logFile,
  };
}

// ── Subcommand Handlers ────────────────────────────────────────────────

async function handleReviewCommand(argv, config) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: { m: "model" },
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const { target, request } = buildReviewRequest(cwd, options, config.reviewName, focusText);

  const metadata = buildReviewJobMetadata(config.reviewName, target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary,
  });

  await runForegroundCommand(
    job,
    (progress) =>
      executeReviewRun({
        ...request,
        jobId: job.id,
        onProgress: progress,
      }),
    { json: options.json }
  );
}

async function handleReview(argv) {
  return handleReviewCommand(argv, { reviewName: "Review" });
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "prompt-file"],
    booleanOptions: ["json", "write", "background"],
    aliasMap: { m: "model" },
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = resolveRequestedModel(options.model);
  const prompt = readTaskPrompt(cwd, options, positionals);
  const write = Boolean(options.write);
  const taskMetadata = buildTaskRunMetadata({ prompt });

  if (options.background) {
    ensureGeminiReady(cwd);
    if (!prompt) throw new Error("Provide a prompt, a prompt file, or piped stdin.");

    const job = buildTaskJob(workspaceRoot, taskMetadata, write);
    const request = { cwd, model, prompt, write, jobId: job.id };
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const job = buildTaskJob(workspaceRoot, taskMetadata, write);
  await runForegroundCommand(
    job,
    (progress) => executeTaskRun({ cwd, model, prompt, write, jobId: job.id, onProgress: progress }),
    { json: options.json }
  );
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, { valueOptions: ["cwd", "job-id"] });

  if (!options["job-id"]) throw new Error("Missing required --job-id for task-worker.");

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) throw new Error(`No stored job found for ${options["job-id"]}.`);

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }

  const { logFile, progress } = createTrackedProgress(
    { ...storedJob, workspaceRoot },
    { logFile: storedJob.logFile ?? null }
  );
  await runTrackedJob(
    { ...storedJob, workspaceRoot, logFile },
    () => executeTaskRun({ ...request, onProgress: progress }),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";

  if (reference) {
    let snapshot;
    if (options.wait) {
      const timeoutMs = Math.max(0, Number(options["timeout-ms"]) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
      const pollMs = Math.max(100, Number(options["poll-interval-ms"]) || DEFAULT_STATUS_POLL_INTERVAL_MS);
      const deadline = Date.now() + timeoutMs;
      snapshot = buildSingleJobSnapshot(cwd, reference);
      while ((snapshot.job.status === "queued" || snapshot.job.status === "running") && Date.now() < deadline) {
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
        snapshot = buildSingleJobSnapshot(cwd, reference);
      }
    } else {
      snapshot = buildSingleJobSnapshot(cwd, reference);
    }
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) throw new Error("`status --wait` requires a job id.");

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  outputCommandResult({ job, storedJob }, renderStoredJobResult(job, storedJob), options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  // Two-stage interrupt: SIGTERM → 3s → SIGKILL
  if (job.pid) {
    const { interrupted } = await interruptGeminiTask(job.pid);
    appendLogLine(job.logFile, interrupted ? "Gemini process interrupted." : "Gemini interrupt failed.");
  }

  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");

  // Release the lock only if it belongs to this job (F3 fix)
  const stateDir = resolveStateDir(cwd);
  releaseGeminiLockIfOwner(path.join(stateDir, "gemini.lock"), job.id);

  const completedAt = nowIso();
  const nextJob = { ...job, status: "cancelled", phase: "cancelled", pid: null, completedAt, errorMessage: "Cancelled by user." };
  writeJobFile(workspaceRoot, job.id, { ...existing, ...nextJob, cancelledAt: completedAt });
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled", pid: null, errorMessage: "Cancelled by user.", completedAt });

  outputCommandResult(
    { jobId: job.id, status: "cancelled", title: job.title },
    renderCancelReport(nextJob),
    options.json
  );
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup": handleSetup(argv); break;
    case "review": await handleReview(argv); break;
    case "adversarial-review": await handleReviewCommand(argv, { reviewName: "Adversarial Review" }); break;
    case "task": await handleTask(argv); break;
    case "task-worker": await handleTaskWorker(argv); break;
    case "status": await handleStatus(argv); break;
    case "result": handleResult(argv); break;
    case "cancel": await handleCancel(argv); break;
    default: throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = normalizeGeminiCliError(message);
  process.stderr.write(normalized ? renderGeminiFailure(normalized) : `${message}\n`);
  process.exitCode = 1;
});
