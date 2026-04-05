import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  generateJobId,
  loadState,
  saveState,
  updateState,
  upsertJob,
  listJobs,
  setConfig,
  getConfig,
  writeJobFile,
  readJobFile,
  resolveJobFile,
} from "../plugins/gemini/scripts/lib/state.mjs";

// Use a temp directory as workspace root to avoid polluting real state
let tmpDir;

function makeTmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-state-test-"));
  // Create .git to make resolveWorkspaceRoot find this as root
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpDir = makeTmpWorkspace();
  // Set CLAUDE_PLUGIN_DATA so state goes to a predictable temp location
  process.env.CLAUDE_PLUGIN_DATA = path.join(tmpDir, ".plugin-data");
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateJobId", () => {
  it("generates unique IDs with prefix", () => {
    const id1 = generateJobId("review");
    const id2 = generateJobId("review");
    assert.ok(id1.startsWith("review-"));
    assert.ok(id2.startsWith("review-"));
    assert.notEqual(id1, id2);
  });

  it("uses default prefix", () => {
    const id = generateJobId();
    assert.ok(id.startsWith("gem-"));
  });
});

describe("loadState / saveState", () => {
  it("returns default state for new workspace", () => {
    const state = loadState(tmpDir);
    assert.equal(state.version, 1);
    assert.ok(Array.isArray(state.jobs));
    assert.equal(state.jobs.length, 0);
    assert.equal(state.config.stopReviewGate, false);
  });

  it("round-trips state through save/load", () => {
    const state = loadState(tmpDir);
    state.config.stopReviewGate = true;
    state.jobs.push({ id: "test-1", status: "completed", updatedAt: new Date().toISOString() });
    saveState(tmpDir, state);

    const loaded = loadState(tmpDir);
    assert.equal(loaded.config.stopReviewGate, true);
    assert.equal(loaded.jobs.length, 1);
    assert.equal(loaded.jobs[0].id, "test-1");
  });
});

describe("updateState", () => {
  it("atomically mutates state", () => {
    updateState(tmpDir, (state) => {
      state.config.defaultModel = "flash";
    });
    const state = loadState(tmpDir);
    assert.equal(state.config.defaultModel, "flash");
  });
});

describe("upsertJob", () => {
  it("inserts a new job", () => {
    upsertJob(tmpDir, { id: "job-1", status: "running" });
    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "job-1");
    assert.equal(jobs[0].status, "running");
  });

  it("updates an existing job", () => {
    upsertJob(tmpDir, { id: "job-1", status: "running" });
    upsertJob(tmpDir, { id: "job-1", status: "completed" });
    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "completed");
  });
});

describe("setConfig / getConfig", () => {
  it("sets and retrieves config values", () => {
    setConfig(tmpDir, "stopReviewGate", true);
    const config = getConfig(tmpDir);
    assert.equal(config.stopReviewGate, true);
  });
});

describe("writeJobFile / readJobFile", () => {
  it("round-trips job data through file", () => {
    const jobData = { id: "job-file-1", status: "completed", result: { foo: "bar" } };
    writeJobFile(tmpDir, "job-file-1", jobData);

    const jobFile = resolveJobFile(tmpDir, "job-file-1");
    const loaded = readJobFile(jobFile);
    assert.deepEqual(loaded, jobData);
  });
});
