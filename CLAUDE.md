# Gemini CLI Plugin for Claude Code

## Overview

A Claude Code plugin that integrates Google Gemini CLI for code review, adversarial review, and task delegation.
Thin-forwarder architecture: slash command → gemini-companion.mjs → lib/gemini.mjs → `gemini -o stream-json` (prompt via stdin).

## Directory Structure

```
gemini-plugin-cc/
├── .claude-plugin/marketplace.json        # Marketplace metadata
├── .github/workflows/
│   ├── pull-request-ci.yml                # PR CI (Node.js 22, npm test)
│   └── release-please.yml                 # Automated releases (release-please)
├── release-please-config.json             # release-please config
├── .release-please-manifest.json          # Version anchor
├── plugins/gemini/                        # Plugin core
│   ├── .claude-plugin/plugin.json
│   ├── agents/gemini-rescue.md            # Task delegation subagent
│   ├── commands/                          # 7 slash commands
│   │   ├── review.md                      # /gemini:review
│   │   ├── adversarial-review.md          # /gemini:adversarial-review
│   │   ├── rescue.md                      # /gemini:rescue
│   │   ├── setup.md                       # /gemini:setup
│   │   ├── status.md                      # /gemini:status
│   │   ├── result.md                      # /gemini:result
│   │   └── cancel.md                      # /gemini:cancel
│   ├── hooks/hooks.json                   # SessionStart/End/Stop lifecycle hooks
│   ├── prompts/
│   │   ├── review.md                      # Structured review prompt template
│   │   ├── adversarial-review.md          # Adversarial review prompt template
│   │   └── stop-review-gate.md            # Stop review gate prompt
│   ├── schemas/review-output.schema.json  # Review output JSON Schema
│   ├── scripts/
│   │   ├── gemini-companion.mjs           # Main CLI entry (subcommand dispatch)
│   │   ├── session-lifecycle-hook.mjs
│   │   ├── stop-review-gate-hook.mjs
│   │   └── lib/
│   │       ├── gemini.mjs                 # Gemini CLI core (headless, lock, JSON extraction)
│   │       ├── models.mjs                 # Model alias resolution and error normalization
│   │       ├── git.mjs                    # Git context collection
│   │       ├── state.mjs                  # State persistence
│   │       ├── process.mjs                # Cross-platform process management
│   │       ├── job-control.mjs            # Concurrency lock, two-phase cancel
│   │       ├── tracked-jobs.mjs           # Job state machine, progress reporting
│   │       ├── render.mjs                 # Markdown output rendering
│   │       ├── args.mjs                   # Argument parsing
│   │       ├── fs.mjs                     # File utilities (EAGAIN-safe reads)
│   │       ├── workspace.mjs              # Workspace detection
│   │       └── prompts.mjs                # Template loading and interpolation
│   ├── skills/
│   │   ├── gemini-cli-runtime/SKILL.md
│   │   ├── gemini-result-handling/SKILL.md
│   │   └── gemini-prompting/
│   │       ├── SKILL.md
│   │       └── references/
│   └── CHANGELOG.md
├── tests/                                 # Unit tests (7 files)
│   ├── args.test.mjs
│   ├── fs.test.mjs
│   ├── gemini.test.mjs
│   ├── models.test.mjs
│   ├── process.test.mjs
│   ├── render.test.mjs
│   └── state.test.mjs
├── docs/                                  # Design docs (gitignored)
├── package.json
├── README.md
└── LICENSE                                # Apache-2.0
```

## Architecture

- **Thin forwarder**: slash command (MD) → gemini-companion.mjs → lib/gemini.mjs → `gemini -o stream-json`
- **No broker**: Gemini CLI is stateless; file lock `gemini.lock` serializes concurrent requests
- **Three-layer JSON extraction**: prompt engineering → JSON block extraction → plain-text fallback
- **Activity-based timeout**: stream-json events reset the timer; 30-minute hard ceiling
- **Model layer**: `lib/models.mjs` centralizes alias resolution, default fallback, 403/429 error normalization

## Development Conventions

- **Runtime**: Node.js >= 18.18.0, ESM (`type: "module"`)
- **Encoding**: UTF-8 (no BOM), LF line endings
- **Module limits**: each lib module < 400 lines, gemini-companion.mjs < 600 lines
- **Security**: no API key leaks, no user input concatenation in spawn, no credentials in state files
- **Cross-platform**: Windows shell/UNC/taskkill, Unix process group SIGTERM
- **Testing**: `npm test` runs all unit tests; CI runs on every PR
- **Releases**: managed by release-please, driven by Conventional Commits; merge the Release PR to publish
- **Changelog**: `plugins/gemini/CHANGELOG.md`, auto-updated by release-please
- **Design docs**: `docs/` directory is gitignored, local reference only
