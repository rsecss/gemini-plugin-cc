import fs from "node:fs";
import path from "node:path";

import { isProbablyText, safeStatFile } from "./fs.mjs";
import { runCommand, runCommandChecked } from "./process.mjs";

/** Max bytes per untracked file to inline in review context */
const MAX_UNTRACKED_BYTES = 24 * 1024;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

/** @param {string} cwd @param {string[]} args */
function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options });
}

/**
 * Verify `cwd` is inside a git repo. Returns the repo root path.
 * @param {string} cwd
 * @returns {string}
 */
export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

/** @param {string} cwd @returns {string} */
export function getRepoRoot(cwd) {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

/**
 * Detect the repository default branch (main/master/trunk).
 * @param {string} cwd
 * @returns {string}
 */
export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "");
    }
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) return candidate;
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) return `origin/${candidate}`;
  }

  throw new Error(
    "Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree."
  );
}

/** @param {string} cwd @returns {string} */
export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

/**
 * Get the working tree state: staged, unstaged, untracked files.
 * @param {string} cwd
 * @returns {{ staged: string[], unstaged: string[], untracked: string[], isDirty: boolean }}
 */
export function getWorkingTreeState(cwd) {
  const staged = gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const unstaged = gitChecked(cwd, ["diff", "--name-only"]).stdout.trim().split("\n").filter(Boolean);
  const untracked = gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim().split("\n").filter(Boolean);

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

/**
 * Determine what to review based on scope and base ref.
 * @param {string} cwd
 * @param {{ scope?: string, base?: string | null }} options
 * @returns {{ mode: string, label: string, baseRef?: string, explicit: boolean }}
 */
export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);

  const requestedScope = options.scope ?? "auto";
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = new Set(["auto", "working-tree", "branch"]);

  if (baseRef) {
    return { mode: "branch", label: `branch diff against ${baseRef}`, baseRef, explicit: true };
  }

  if (requestedScope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }

  if (requestedScope === "branch") {
    const detectedBase = detectDefaultBranch(cwd);
    return { mode: "branch", label: `branch diff against ${detectedBase}`, baseRef: detectedBase, explicit: true };
  }

  // auto mode: working-tree if dirty, else branch
  if (state.isDirty) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }

  const detectedBase = detectDefaultBranch(cwd);
  return { mode: "branch", label: `branch diff against ${detectedBase}`, baseRef: detectedBase, explicit: false };
}

/** @param {string} title @param {string} body */
function formatSection(title, body) {
  return [`## ${title}`, "", body.trim() ? body.trim() : "(none)", ""].join("\n");
}

/**
 * Format an untracked file for inclusion in review context.
 * Uses safeStatFile to handle broken symlinks (fix for Codex #65, #69).
 * @param {string} cwd
 * @param {string} relativePath
 * @returns {string}
 */
function formatUntrackedFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);

  // Fix Codex #65/#69: safe stat to handle broken symlinks and EISDIR
  const stat = safeStatFile(absolutePath);
  if (!stat) {
    return `### ${relativePath}\n(skipped: inaccessible or broken symlink)`;
  }
  if (!stat.isFile()) {
    return `### ${relativePath}\n(skipped: not a regular file)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }

  const buffer = fs.readFileSync(absolutePath);
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }

  return [`### ${relativePath}`, "```", buffer.toString("utf8").trimEnd(), "```"].join("\n");
}

function collectWorkingTreeContext(cwd, state) {
  const status = gitChecked(cwd, ["status", "--short"]).stdout.trim();
  const stagedDiff = gitChecked(cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const unstagedDiff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"]).stdout;
  const untrackedBody = state.untracked.map((file) => formatUntrackedFile(cwd, file)).join("\n\n");

  return {
    mode: "working-tree",
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: [
      formatSection("Git Status", status),
      formatSection("Staged Diff", stagedDiff),
      formatSection("Unstaged Diff", unstagedDiff),
      formatSection("Untracked Files", untrackedBody),
    ].join("\n"),
  };
}

function collectBranchContext(cwd, baseRef) {
  const mergeBase = gitChecked(cwd, ["merge-base", "HEAD", baseRef]).stdout.trim();
  const commitRange = `${mergeBase}..HEAD`;
  const currentBranch = getCurrentBranch(cwd);
  const logOutput = gitChecked(cwd, ["log", "--oneline", "--decorate", commitRange]).stdout.trim();
  const diffStat = gitChecked(cwd, ["diff", "--stat", commitRange]).stdout.trim();
  const diff = gitChecked(cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", commitRange]).stdout;

  return {
    mode: "branch",
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${mergeBase}.`,
    content: [
      formatSection("Commit Log", logOutput),
      formatSection("Diff Stat", diffStat),
      formatSection("Branch Diff", diff),
    ].join("\n"),
  };
}

/**
 * Collect full review context (diff, commit log, etc.) for the given target.
 * @param {string} cwd
 * @param {{ mode: string, baseRef?: string }} target
 */
export function collectReviewContext(cwd, target) {
  const repoRoot = getRepoRoot(cwd);
  const state = getWorkingTreeState(cwd);
  const currentBranch = getCurrentBranch(cwd);

  const details = target.mode === "working-tree"
    ? collectWorkingTreeContext(repoRoot, state)
    : collectBranchContext(repoRoot, target.baseRef);

  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    ...details,
  };
}
