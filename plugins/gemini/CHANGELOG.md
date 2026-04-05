# Changelog

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
