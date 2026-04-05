import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatCommandFailure, terminateProcessTree } from "../plugins/gemini/scripts/lib/process.mjs";

describe("formatCommandFailure", () => {
  it("formats exit code failure", () => {
    const result = formatCommandFailure({
      command: "gemini",
      args: ["--version"],
      status: 1,
      signal: null,
      stdout: "",
      stderr: "command failed",
    });
    assert.ok(result.includes("gemini --version"));
    assert.ok(result.includes("exit=1"));
    assert.ok(result.includes("command failed"));
  });

  it("formats signal failure", () => {
    const result = formatCommandFailure({
      command: "gemini",
      args: [],
      status: 0,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    });
    assert.ok(result.includes("signal=SIGTERM"));
  });

  it("uses stdout when stderr is empty", () => {
    const result = formatCommandFailure({
      command: "test",
      args: [],
      status: 1,
      signal: null,
      stdout: "stdout info",
      stderr: "",
    });
    assert.ok(result.includes("stdout info"));
  });
});

describe("terminateProcessTree", () => {
  it("returns attempted=false for NaN pid", () => {
    const result = terminateProcessTree(NaN);
    assert.equal(result.attempted, false);
    assert.equal(result.delivered, false);
  });

  it("returns attempted=false for non-finite pid", () => {
    const result = terminateProcessTree(Infinity);
    assert.equal(result.attempted, false);
  });

  it("handles ESRCH (no such process) on unix", () => {
    // Use a PID that almost certainly doesn't exist
    const result = terminateProcessTree(2147483647, {
      platform: "linux",
      killImpl: (pid, signal) => {
        const err = new Error("No such process");
        err.code = "ESRCH";
        throw err;
      },
    });
    assert.equal(result.attempted, true);
    assert.equal(result.delivered, false);
  });

  it("reports delivery on successful kill", () => {
    const result = terminateProcessTree(12345, {
      platform: "linux",
      killImpl: () => { /* success */ },
    });
    assert.equal(result.attempted, true);
    assert.equal(result.delivered, true);
    assert.equal(result.method, "process-group");
  });
});
