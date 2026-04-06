# Changelog

## [Unreleased]

## 1.1.0 (2026-04-06)

### Fixed

- Remove `-p` flag from Gemini CLI calls, rely on non-TTY stdin for headless mode
- Add integration tests for `probeGeminiAuth` and `runGeminiHeadless` with fake Gemini binary
- Make `/gemini:review` use a dedicated structured-output prompt instead of a plain-text inline prompt
- Stop treating unstructured review output as an empty finding set with `No material findings.`
- Render unstructured review results as contract failures so they are not mistaken for approval
- Add regression tests for structured review parsing and unstructured review rendering
- Extract assistant text from Gemini 0.36.0 `stream-json` `message.content` events when the final `result` event has no `response`
- Add compatibility fallback for older `stream-json` message events that omit role metadata
- Short-circuit `/gemini:review --base <ref>` and clean working-tree reviews when there is no reviewable diff, instead of invoking Gemini on an empty target
- Extract model alias/default resolution into `lib/models.mjs` instead of keeping that logic inside `gemini-companion.mjs`
- Normalize Gemini 403/429 model failures into concise user-facing errors with suggested alternative aliases
- Reuse resolved review targets across command setup and execution instead of resolving them twice
- Add regression tests for model normalization, alternative suggestions, and Gemini failure rendering
- Normalize the Gemini `--sandbox` flag for CLI 0.36.0 so task runs use a boolean flag instead of the broken legacy `-s sandbox` syntax
- Add a regression test for legacy `"sandbox"` config values and verify real Gemini task execution through the plugin entrypoint
- Keep no-change review payloads schema-compatible with normal review results by preserving full `target` and `context`
- Restrict model-name extraction to model-scoped error patterns so unrelated quoted text is not misreported as a failing model
- Reset the configured inactivity timeout on each Gemini stream event instead of shrinking the window to 5 minutes after the first event
- Add regression coverage for activity-timeout renewal and quoted-text rate-limit errors

## 1.0.0 (2026-04-05)

Initial release with adversarial review fixes applied.

### Features

- Code review via `/gemini:review`
- Adversarial review via `/gemini:adversarial-review`
- Task delegation via `/gemini:rescue`
- Setup and readiness checking via `/gemini:setup`
- Job status, result, and cancel via `/gemini:status`, `/gemini:result`, `/gemini:cancel`
- File-lock concurrency control (no Broker)
- Three-layer JSON extraction for structured output
- Activity-based timeout renewal
- Full Windows compatibility fixes (UNC paths, shell spawning, EAGAIN)
- Stop-time review gate (optional)

### Bug Fixes (from adversarial review)

- **F1**: Replace non-existent `gemini auth status` with env-var + headless probe auth detection
- **F2**: Fix review context being injected twice into prompt (doubled token cost)
- **F3**: Cancel now only releases lock owned by the cancelled job, not global lock
- **F4**: Remove non-functional "resume Gemini thread" interaction
- **F5**: Remove unfulfilled `partialEvents` promise from interrupt logic
- **F6**: Add file lock to `updateState()` to prevent concurrent state corruption
- **F7**: Add 57 unit tests across 5 test files (args, fs, process, state, gemini)
- **F8**: Remove unused `confidence` field from review schema and prompt template
