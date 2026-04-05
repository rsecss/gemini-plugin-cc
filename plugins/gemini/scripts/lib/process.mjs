import { spawnSync } from "node:child_process";
import process from "node:process";

/** @type {number} 50 MB — prevents ENOBUFS on large diffs (fix for Codex #151) */
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * Run a command synchronously and capture output.
 * Handles Windows compatibility (shell, windowsHide, UNC paths).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string, stdio?: any, maxBuffer?: number }} options
 * @returns {{ command: string, args: string[], status: number, signal: string | null, stdout: string, stderr: string, error: Error | null }}
 */
export function runCommand(command, args = [], options = {}) {
  const finalArgs = [...args];
  const finalOpts = {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32",
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    ...(options.timeout != null ? { timeout: options.timeout } : {}),
  };

  // Fix Codex #70 — UNC paths are incompatible with cmd.exe cwd
  if (process.platform === "win32" && finalOpts.cwd && finalOpts.cwd.startsWith("\\\\")) {
    if (command === "git") {
      // git supports -C to specify repo path; keep UNC path accurate
      finalArgs.unshift("-C", finalOpts.cwd);
      finalOpts.cwd = process.env.TEMP || process.env.USERPROFILE || "C:\\";
    } else {
      // non-git commands fall back to a safe temp directory
      finalOpts.cwd = process.env.TEMP || process.env.USERPROFILE || "C:\\";
    }
  }

  const result = spawnSync(command, finalArgs, finalOpts);

  return {
    command,
    args: finalArgs,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

/**
 * Run a command and throw on failure.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options — same as {@link runCommand}
 * @returns {ReturnType<typeof runCommand>}
 */
export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(formatCommandFailure(result));
  return result;
}

/**
 * Check whether a CLI binary is available.
 *
 * @param {string} command
 * @param {string[]} versionArgs
 * @param {object} options
 * @returns {{ available: boolean, detail: string }}
 */
export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);

  if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    return { available: false, detail };
  }
  return { available: true, detail: result.stdout.trim() || result.stderr.trim() || "ok" };
}

/**
 * Heuristic to detect "process not found" messages from taskkill / kill.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeMissingProcessMessage(text) {
  return /not found|no running instance|cannot find|does not exist|no such process/i.test(text);
}

/**
 * Terminate a process and its entire tree.
 * - Windows: `taskkill /T /F`, fallback to `process.kill`
 * - Unix: `SIGTERM` to process group (`-pid`), fallback to direct `SIGTERM`
 *
 * @param {number} pid
 * @param {{ platform?: string, cwd?: string, env?: NodeJS.ProcessEnv, runCommandImpl?: Function, killImpl?: Function }} options
 * @returns {{ attempted: boolean, delivered: boolean, method: string | null, result?: any }}
 */
export function terminateProcessTree(pid, options = {}) {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === "win32") {
    const result = runCommandImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: options.cwd,
      env: options.env,
    });

    if (!result.error && result.status === 0) {
      return { attempted: true, delivered: true, method: "taskkill", result };
    }

    const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
    if (!result.error && looksLikeMissingProcessMessage(combinedOutput)) {
      return { attempted: true, delivered: false, method: "taskkill", result };
    }

    // taskkill not available — fallback to process.kill
    if (result.error?.code === "ENOENT") {
      try {
        killImpl(pid);
        return { attempted: true, delivered: true, method: "kill" };
      } catch (error) {
        if (error?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "kill" };
        }
        throw error;
      }
    }

    if (result.error) throw result.error;
    throw new Error(formatCommandFailure(result));
  }

  // Unix: try process group first, then individual process
  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }
    return { attempted: true, delivered: false, method: "process-group" };
  }
}

/**
 * Format a failed command result into a human-readable message.
 * @param {{ command: string, args: string[], status: number, signal: string | null, stdout: string, stderr: string }} result
 * @returns {string}
 */
export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}
