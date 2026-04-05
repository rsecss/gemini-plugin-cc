import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../plugins/gemini/scripts/lib/args.mjs";

describe("parseArgs", () => {
  it("parses boolean options", () => {
    const { options } = parseArgs(["--json", "--all"], {
      booleanOptions: ["json", "all"],
    });
    assert.equal(options.json, true);
    assert.equal(options.all, true);
  });

  it("parses value options", () => {
    const { options } = parseArgs(["--model", "pro", "--base", "main"], {
      valueOptions: ["model", "base"],
    });
    assert.equal(options.model, "pro");
    assert.equal(options.base, "main");
  });

  it("parses value options with = syntax", () => {
    const { options } = parseArgs(["--model=flash"], {
      valueOptions: ["model"],
    });
    assert.equal(options.model, "flash");
  });

  it("collects positionals", () => {
    const { positionals } = parseArgs(["hello", "world"], {});
    assert.deepEqual(positionals, ["hello", "world"]);
  });

  it("resolves aliases", () => {
    const { options } = parseArgs(["-m", "pro"], {
      valueOptions: ["model"],
      aliasMap: { m: "model" },
    });
    assert.equal(options.model, "pro");
  });

  it("handles -- passthrough", () => {
    const { options, positionals } = parseArgs(["--json", "--", "--not-an-option"], {
      booleanOptions: ["json"],
    });
    assert.equal(options.json, true);
    assert.deepEqual(positionals, ["--not-an-option"]);
  });

  it("throws on missing value", () => {
    assert.throws(
      () => parseArgs(["--model"], { valueOptions: ["model"] }),
      /Missing value for --model/
    );
  });

  it("treats unknown flags as positionals", () => {
    const { positionals } = parseArgs(["--unknown"], {});
    assert.deepEqual(positionals, ["--unknown"]);
  });
});

describe("splitRawArgumentString", () => {
  it("splits simple tokens", () => {
    assert.deepEqual(splitRawArgumentString("hello world"), ["hello", "world"]);
  });

  it("handles quoted strings", () => {
    assert.deepEqual(splitRawArgumentString('hello "big world"'), ["hello", "big world"]);
  });

  it("handles single quotes", () => {
    assert.deepEqual(splitRawArgumentString("hello 'big world'"), ["hello", "big world"]);
  });

  it("handles backslash escapes", () => {
    assert.deepEqual(splitRawArgumentString("hello\\ world"), ["hello world"]);
  });

  it("handles empty string", () => {
    assert.deepEqual(splitRawArgumentString(""), []);
  });

  it("handles trailing backslash", () => {
    assert.deepEqual(splitRawArgumentString("hello\\"), ["hello\\"]);
  });
});
