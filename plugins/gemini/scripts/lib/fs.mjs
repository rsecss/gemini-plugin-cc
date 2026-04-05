import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve a path to absolute, using `cwd` as base if relative.
 * @param {string} cwd
 * @param {string} maybePath
 * @returns {string}
 */
export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

/**
 * Create a temporary directory with the given prefix.
 * @param {string} prefix
 * @returns {string}
 */
export function createTempDir(prefix = "gemini-plugin-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Read and parse a JSON file.
 * @param {string} filePath
 * @returns {any}
 */
export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Atomically write a JSON file (write to .tmp then rename).
 * @param {string} filePath
 * @param {any} value
 */
export function writeJsonFile(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Read a file, returning empty string if it does not exist.
 * @param {string} filePath
 * @returns {string}
 */
export function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return "";
    throw e;
  }
}

/**
 * Heuristic: check if a buffer looks like text (no null bytes in first 4KB).
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isProbablyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const value of sample) {
    if (value === 0) return false;
  }
  return true;
}

/**
 * Read stdin if piped (non-TTY). Handles EAGAIN safely (fix for Codex #120).
 * @returns {string}
 */
export function readStdinIfPiped() {
  if (process.stdin.isTTY) return "";
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    if (e.code === "EAGAIN" || e.code === "EOF") return "";
    throw e;
  }
}

/**
 * Safe lstat — returns null for broken symlinks or inaccessible entries
 * (fix for Codex #65, #69).
 * @param {string} filePath
 * @returns {fs.Stats | null}
 */
export function safeStatFile(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Check if a path points to a readable regular file.
 * @param {string} entry
 * @returns {boolean}
 */
export function isReadableFile(entry) {
  const stat = safeStatFile(entry);
  return stat !== null && stat.isFile();
}
