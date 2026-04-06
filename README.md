<div align="center">

# Gemini Plugin for Claude Code

Use Gemini from inside Claude Code for code reviews or to delegate tasks to Gemini.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.18.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Version](https://img.shields.io/badge/version-1.0.0-green.svg)]() [![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-7C3AED?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code) [![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Integration-4285F4?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)

</div>

---

This plugin is for Claude Code users who want an easy way to use Google Gemini from the workflow they already have.

## What You Get

- `/gemini:review` for a normal read-only Gemini review
- `/gemini:adversarial-review` for a steerable challenge review
- `/gemini:rescue`, `/gemini:status`, `/gemini:result`, and `/gemini:cancel` to delegate work and manage background jobs

## Requirements

- **Google Gemini CLI** — installed globally via `npm install -g @google/gemini-cli`
  - Authenticate by running `gemini` interactively or setting the `GEMINI_API_KEY` environment variable
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```shell
/plugin marketplace add rsecss/gemini-plugin-cc
```

Install the plugin:

```shell
/plugin install gemini@gemini-plugin
```

Reload plugins:

```shell
/reload-plugins
```

Then run:

```shell
/gemini:setup
```

`/gemini:setup` will tell you whether Gemini CLI is ready. If it is missing and npm is available, it can offer to install it for you.

If you prefer to install Gemini CLI yourself:

```shell
npm install -g @google/gemini-cli
```

If Gemini CLI is installed but not authenticated, run `gemini` interactively to complete the login flow, or set the `GEMINI_API_KEY` environment variable.

After install, you should see:

- the slash commands listed below
- the `gemini:gemini-rescue` subagent in `/agents`

A simple first run:

```shell
/gemini:review --background
/gemini:status
/gemini:result
```

## Usage

### `/gemini:review`

Runs a normal Gemini review on your current work.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait`, `--background`, and `-m <model>`. It is not steerable and does not take custom focus text. Use [`/gemini:adversarial-review`](#gemini-adversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```shell
/gemini:review
/gemini:review --base main
/gemini:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gemini:status`](#geministatus) to check on progress and [`/gemini:cancel`](#geminicancel) to cancel the ongoing task.

### `/gemini:adversarial-review`

Runs a **steerable** review that challenges the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gemini:review`, including `--base <ref>` for branch review. It also supports `--wait`, `--background`, and `-m <model>`. Unlike `/gemini:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```shell
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge whether this was the right caching design
/gemini:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gemini:rescue`

Hands a task to Gemini through the `gemini:gemini-rescue` subagent.

Use it when you want Gemini to:

- investigate a bug
- try a fix
- take a different pass at a problem

> [!NOTE]
> Depending on the task and the model you choose, these tasks might take a long time. It's generally recommended to run them in the background.

It supports `--background`, `--wait`, and `-m <model>`.

Examples:

```shell
/gemini:rescue investigate why the tests started failing
/gemini:rescue fix the failing test with the smallest safe patch
/gemini:rescue -m flash investigate the flaky integration test
/gemini:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Gemini:

```
Ask Gemini to redesign the database connection to be more resilient.
```

### `/gemini:status`

Shows running and recent Gemini jobs for the current repository.

Examples:

```shell
/gemini:status
/gemini:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/gemini:result`

Shows the final stored Gemini output for a finished job.

Examples:

```shell
/gemini:result
/gemini:result task-abc123
```

### `/gemini:cancel`

Cancels an active background Gemini job.

Examples:

```shell
/gemini:cancel
/gemini:cancel task-abc123
```

### `/gemini:setup`

Checks whether Gemini CLI is installed and authenticated. If Gemini CLI is missing and npm is available, it can offer to install it for you.

You can also use `/gemini:setup` to manage the optional review gate.

#### Enabling review gate

```shell
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Gemini review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Gemini loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```shell
/gemini:review
```

### Hand A Problem To Gemini

```shell
/gemini:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```shell
/gemini:adversarial-review --background
/gemini:rescue --background investigate the flaky test
```

Then check in with:

```shell
/gemini:status
/gemini:result
```

## Architecture

This plugin follows a **thin-forwarder** pattern:

```
Slash command (MD) → gemini-companion.mjs → lib/models.mjs + lib/gemini.mjs → gemini -o stream-json (prompt via stdin)
```

Key design decisions:

- **No Broker** — Unlike the Codex plugin, Gemini CLI is stateless. Concurrent requests are serialized via a file lock (`gemini.lock`) instead of a broker process.
- **Dedicated model layer** — Model aliases, default resolution, and model-specific error normalization live in `lib/models.mjs` instead of being scattered through the CLI entrypoint.
- **Three-layer JSON extraction** — Gemini responses are free-form text, so the plugin uses prompt engineering → JSON block extraction → plain-text fallback to reliably parse structured output.
- **Activity-based timeout** — The stream-json event stream resets the timeout on each output event, with a configurable hard ceiling (default 30 minutes).
- **Full Windows compatibility** — Shell spawning with `shell: true`, UNC path handling, `taskkill` for process cleanup, and EAGAIN-safe stdin reads.

## FAQ

### Do I need a separate account for this plugin?

This plugin uses your local Gemini CLI authentication. If you are already signed into Gemini CLI on this machine, it works immediately. If not, run `gemini` interactively to authenticate or set the `GEMINI_API_KEY` environment variable.

### Does the plugin use a separate runtime?

No. The plugin delegates through your locally installed [Gemini CLI](https://github.com/google-gemini/gemini-cli). It uses the same install, authentication state, and repository checkout on your machine.

### Can I choose a different model?

Yes. Pass `-m <model>` to any command. The plugin normalizes the built-in aliases `auto`, `pro`, `flash`, and `flash-lite`, while still allowing explicit Gemini model IDs. If omitted, the plugin uses the configured default model (`auto` by default). When Gemini rejects a model because of access or rate limits, the plugin now suggests alternative aliases instead of surfacing only the raw CLI stderr.

## Acknowledgments

This plugin is designed and developed based on [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) — the Codex plugin for Claude Code by OpenAI. The architecture, command structure, and plugin conventions are derived from that project. Key adaptations include replacing the Broker/JSON-RPC model with direct Gemini CLI invocation via file-lock concurrency, adding three-layer JSON extraction for Gemini's free-form output, and comprehensive Windows compatibility fixes.

## License

This project is licensed under the [Apache License 2.0](LICENSE), the same license as the original [codex-plugin-cc](https://github.com/openai/codex-plugin-cc).
