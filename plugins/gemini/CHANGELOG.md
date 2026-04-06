# Changelog

## [Unreleased]

### :wrench: CI/CD

* Add Pull Request CI workflow (Node.js 22, npm test)
* Add release-please automated release workflow
* Fix `marketplace.json` version drift (1.0.0 → 1.1.0)
* Rewrite CHANGELOG to GitHub Release style with emoji category headers
* Remove `docs/log.md` from version control (local-only dev log)

## [1.1.0](https://github.com/rsecss/gemini-plugin-cc/releases/tag/v1.1.0) (2026-04-06)

### What's New in v1.1.0

#### :hammer_and_wrench: Refactor

* Extract model alias/default resolution into `lib/models.mjs` instead of keeping that logic inside `gemini-companion.mjs`

#### :bug: Fixes

* Remove `-p` flag from Gemini CLI calls, rely on non-TTY stdin for headless mode
* Make `/gemini:review` use a dedicated structured-output prompt instead of a plain-text inline prompt
* Stop treating unstructured review output as an empty finding set with `No material findings.`
* Render unstructured review results as contract failures so they are not mistaken for approval
* Extract assistant text from Gemini 0.36.0 `stream-json` `message.content` events when the final `result` event has no `response`
* Add compatibility fallback for older `stream-json` message events that omit role metadata
* Short-circuit `/gemini:review --base <ref>` and clean working-tree reviews when there is no reviewable diff
* Normalize Gemini 403/429 model failures into concise user-facing errors with suggested alternative aliases
* Normalize the Gemini `--sandbox` flag for CLI 0.36.0 so task runs use a boolean flag instead of the broken legacy `-s sandbox` syntax
* Keep no-change review payloads schema-compatible with normal review results by preserving full `target` and `context`
* Restrict model-name extraction to model-scoped error patterns so unrelated quoted text is not misreported as a failing model
* Reset the configured inactivity timeout on each Gemini stream event instead of shrinking the window to 5 minutes after the first event

#### :white_check_mark: Tests

* Add integration tests for `probeGeminiAuth` and `runGeminiHeadless` with fake Gemini binary
* Add regression tests for structured review parsing and unstructured review rendering
* Add regression tests for model normalization, alternative suggestions, and Gemini failure rendering
* Add regression test for legacy `"sandbox"` config values and real Gemini task execution
* Add regression coverage for activity-timeout renewal and quoted-text rate-limit errors

---

## [1.0.0](https://github.com/rsecss/gemini-plugin-cc/releases/tag/v1.0.0) (2026-04-05)

### What's New in v1.0.0

Initial release — Gemini CLI integration for Claude Code.

#### :sparkles: Features

* Code review via `/gemini:review`
* Adversarial review via `/gemini:adversarial-review`
* Task delegation via `/gemini:rescue`
* Setup and readiness checking via `/gemini:setup`
* Job status, result, and cancel via `/gemini:status`, `/gemini:result`, `/gemini:cancel`
* File-lock concurrency control (no Broker)
* Three-layer JSON extraction for structured output
* Activity-based timeout renewal
* Full Windows compatibility fixes (UNC paths, shell spawning, EAGAIN)
* Stop-time review gate (optional)

#### :bug: Fixes (from adversarial review)

* **F1**: Replace non-existent `gemini auth status` with env-var + headless probe auth detection
* **F2**: Fix review context being injected twice into prompt (doubled token cost)
* **F3**: Cancel now only releases lock owned by the cancelled job, not global lock
* **F4**: Remove non-functional "resume Gemini thread" interaction
* **F5**: Remove unfulfilled `partialEvents` promise from interrupt logic
* **F6**: Add file lock to `updateState()` to prevent concurrent state corruption

#### :white_check_mark: Tests

* **F7**: Add 57 unit tests across 5 test files (args, fs, process, state, gemini)

#### :memo: Docs

* **F8**: Remove unused `confidence` field from review schema and prompt template
