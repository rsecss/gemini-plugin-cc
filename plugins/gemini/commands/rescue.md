---
description: Delegate investigation, fix, or follow-up work to the Gemini rescue subagent
argument-hint: "[--background|--wait] [-m <model>] [what Gemini should investigate, solve, or continue]"
context: fork
allowed-tools: Bash(node:*), AskUserQuestion
---

Route this request to the `gemini:gemini-rescue` subagent.
The final user-visible response must be Gemini's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `gemini:gemini-rescue` subagent in the background.
- If the request includes `--wait`, run the `gemini:gemini-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model` / `-m` is a runtime-selection flag. Preserve it for the forwarded `task` call, but do not treat it as part of the natural-language task text.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Gemini companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/gemini:status`, fetch `/gemini:result`, call `/gemini:cancel`, summarize output, or do follow-up work of its own.
- Leave model unset unless the user explicitly asks for one.
- Default to a write-capable Gemini run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.
- If the helper reports that Gemini is missing or unauthenticated, stop and tell the user to run `/gemini:setup`.
- If the user did not supply a request, ask what Gemini should investigate or fix.
