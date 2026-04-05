import { ensureGitRepository } from "./git.mjs";

/**
 * Resolve the workspace root for the given directory.
 * Falls back to `cwd` itself if not inside a git repository.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveWorkspaceRoot(cwd) {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return cwd;
  }
}
