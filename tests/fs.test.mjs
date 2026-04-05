import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureAbsolutePath,
  createTempDir,
  readJsonFile,
  writeJsonFile,
  safeReadFile,
  isProbablyText,
  safeStatFile,
  isReadableFile,
} from "../plugins/gemini/scripts/lib/fs.mjs";

describe("ensureAbsolutePath", () => {
  it("returns absolute path unchanged", () => {
    const abs = path.resolve("/usr/local/bin");
    assert.equal(ensureAbsolutePath("/tmp", abs), abs);
  });

  it("resolves relative path against cwd", () => {
    const result = ensureAbsolutePath("/base", "sub/file.txt");
    assert.equal(result, path.resolve("/base", "sub/file.txt"));
  });
});

describe("createTempDir", () => {
  it("creates a directory that exists", () => {
    const dir = createTempDir("test-gemini-");
    assert.ok(fs.existsSync(dir));
    fs.rmdirSync(dir);
  });
});

describe("readJsonFile / writeJsonFile", () => {
  it("round-trips JSON data", () => {
    const dir = createTempDir("test-json-");
    const filePath = path.join(dir, "data.json");
    const data = { foo: "bar", num: 42, arr: [1, 2, 3] };

    writeJsonFile(filePath, data);
    const result = readJsonFile(filePath);

    assert.deepEqual(result, data);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("safeReadFile", () => {
  it("returns empty string for non-existent file", () => {
    assert.equal(safeReadFile("/nonexistent/path/file.txt"), "");
  });

  it("returns file content for existing file", () => {
    const dir = createTempDir("test-safe-read-");
    const filePath = path.join(dir, "test.txt");
    fs.writeFileSync(filePath, "hello", "utf8");

    assert.equal(safeReadFile(filePath), "hello");
    fs.rmSync(dir, { recursive: true });
  });
});

describe("isProbablyText", () => {
  it("returns true for text buffer", () => {
    assert.equal(isProbablyText(Buffer.from("hello world")), true);
  });

  it("returns false for buffer with null bytes", () => {
    assert.equal(isProbablyText(Buffer.from([0x48, 0x00, 0x65])), false);
  });
});

describe("safeStatFile", () => {
  it("returns null for non-existent path", () => {
    assert.equal(safeStatFile("/nonexistent/path"), null);
  });

  it("returns stats for existing file", () => {
    const dir = createTempDir("test-stat-");
    const filePath = path.join(dir, "test.txt");
    fs.writeFileSync(filePath, "x", "utf8");

    const stat = safeStatFile(filePath);
    assert.ok(stat);
    assert.ok(stat.isFile());
    fs.rmSync(dir, { recursive: true });
  });
});

describe("isReadableFile", () => {
  it("returns false for non-existent path", () => {
    assert.equal(isReadableFile("/nonexistent/path"), false);
  });

  it("returns true for a regular file", () => {
    const dir = createTempDir("test-readable-");
    const filePath = path.join(dir, "test.txt");
    fs.writeFileSync(filePath, "data", "utf8");

    assert.equal(isReadableFile(filePath), true);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns false for a directory", () => {
    const dir = createTempDir("test-readable-dir-");
    assert.equal(isReadableFile(dir), false);
    fs.rmdirSync(dir);
  });
});
