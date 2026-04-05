---
name: gemini-result-handling
description: Internal guidance for presenting Gemini output back to the user
user-invocable: false
---

# Gemini Result Handling

## Principles

- Preserve verdict, summary, findings, next steps structure.
- Keep findings ordered by severity (critical > high > medium > low).
- Use file paths and line numbers exactly as reported.
- Preserve evidence boundaries and uncertainty labels.
- If no findings, state explicitly.
- Do not auto-apply fixes from review (ask user first).
- Report Gemini failures; do not substitute Claude analysis.

## Critical rule

> After presenting review findings, STOP. Do not make any code changes. Do not fix any issues. You MUST explicitly ask the user which issues, if any, they want fixed before touching a single file.

## Fallback handling

If Gemini returns unstructured text instead of JSON:
- Present the raw text as-is in a code block.
- Note that structured parsing failed.
- Do not attempt to re-parse or reinterpret the output.
