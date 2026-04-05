---
name: gemini-prompting
description: Internal guidance for composing Gemini prompts for coding, review, diagnosis, and research tasks
user-invocable: false
---

# Gemini Prompting Guide

## Core principle

Prompt as operator, not collaborator. Give Gemini a concrete task, expected output shape, and follow-through defaults.

## Prompt structure

- `<task>`: Concrete job and expected end state
- `<structured_output_contract>`: Output shape (JSON schema reference)
- `<compact_output_contract>`: Concise prose format
- `<grounding_rules>`: Ground claims in context
- `<action_safety>`: Keep changes scoped

## When to use built-in commands

- `/gemini:review` or `/gemini:adversarial-review` for reviewing git changes.
- `task` for diagnosis, planning, research, or implementation with custom prompts.

## Model selection

| Model | Best for |
|-------|----------|
| `auto` | General tasks (default) |
| `pro` | Complex reasoning, long context |
| `flash` | Fast tasks, shorter context |
| `flash-lite` | Quick lookups, minimal cost |

## Template checklist

1. Define exact task in `<task>`
2. Choose smallest output contract
3. Decide default follow-through
4. Add verification/grounding/safety tags only as needed
5. Remove redundant instructions
