<div align="center">

# Gemini Plugin for Claude Code

Bring Google Gemini into your Claude Code workflow — code review, adversarial review, and task delegation, all from slash commands.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.18.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-7C3AED?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Integration-4285F4?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

## Why This Plugin?

Claude Code is great. Gemini is great. This plugin lets you use both without leaving your terminal.

- Get a **second opinion** on your code from Gemini before shipping
- **Challenge your design** with adversarial review — pressure-test assumptions, tradeoffs, and failure modes
- **Delegate tasks** to Gemini and keep working in Claude Code while it runs in the background

## Quick Start

### Prerequisites

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`
- Node.js 18.18+

### Install

```shell
/plugin marketplace add rsecss/gemini-plugin-cc
/plugin install gemini@gemini-plugin
/reload-plugins
/gemini:setup
```

### First Run

```shell
/gemini:review                    # review uncommitted changes
/gemini:review --base main        # review branch diff against main
/gemini:adversarial-review        # challenge your design decisions
/gemini:rescue investigate the bug  # hand a task to Gemini
```

## Commands

| Command | Description |
|---------|-------------|
| `/gemini:review` | Structured code review (read-only) |
| `/gemini:adversarial-review` | Steerable challenge review targeting design and tradeoffs |
| `/gemini:rescue` | Delegate a task to Gemini via subagent |
| `/gemini:setup` | Check readiness, manage review gate |
| `/gemini:status` | Show running and recent jobs |
| `/gemini:result` | Show output of a finished job |
| `/gemini:cancel` | Cancel an active background job |

All commands support `--background`, `--wait`, and `-m <model>` (aliases: `auto`, `pro`, `flash`, `flash-lite`).

### Code Review

```shell
/gemini:review                          # working tree changes
/gemini:review --base main              # branch diff
/gemini:review --background             # run in background
```

### Adversarial Review

Goes beyond code correctness — challenges design choices, hidden assumptions, and alternative approaches.

```shell
/gemini:adversarial-review
/gemini:adversarial-review --base main challenge the caching design
/gemini:adversarial-review --background look for race conditions
```

### Task Delegation

```shell
/gemini:rescue investigate why tests are failing
/gemini:rescue -m flash fix the flaky integration test
/gemini:rescue --background redesign the connection pool
```

Check progress with `/gemini:status`, get results with `/gemini:result`, cancel with `/gemini:cancel`.

## Review Gate (Optional)

When enabled, a `Stop` hook triggers a targeted Gemini review on each Claude response. If issues are found, the stop is blocked so Claude can address them first.

```shell
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

> **Warning:** This can create a long-running Claude/Gemini loop and may drain usage limits quickly. Only enable when actively monitoring.

## Architecture

Thin-forwarder pattern — no broker, no daemon:

```
Slash command → gemini-companion.mjs → lib/gemini.mjs → gemini -o stream-json (stdin)
```

- **File-lock concurrency** instead of a broker process
- **Three-layer JSON extraction**: prompt engineering → JSON block → plain-text fallback
- **Activity-based timeout**: resets on each stream event, 30min hard ceiling
- **Full Windows support**: shell spawning, UNC paths, taskkill, EAGAIN-safe reads

## FAQ

**Do I need a separate account?**
No. The plugin uses your local Gemini CLI authentication. Run `gemini` interactively to sign in, or set `GEMINI_API_KEY`.

**Can I choose a different model?**
Yes. Pass `-m <model>` to any command. If a model is unavailable, the plugin suggests alternatives.

## Community

This project is shared with the [LINUX DO](https://linux.do/) community.

## Acknowledgments

Built on the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc). Key adaptations: direct Gemini CLI invocation via file-lock concurrency, three-layer JSON extraction for free-form output, and comprehensive Windows compatibility fixes.

## License

[Apache License 2.0](LICENSE)
