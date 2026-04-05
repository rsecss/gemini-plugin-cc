# Gemini Prompt Antipatterns

## 1. Vague task framing

**Bad:** "Let me know what you think about this code."
**Good:** "Review this diff for data-loss risks and return findings as JSON."

## 2. Missing output contract

**Bad:** "Investigate and report back."
**Good:** "Return: root cause, evidence, recommended fix."

## 3. No follow-through default

**Bad:** "Debug this error."
**Good:** "Debug this error. If you find the root cause, propose a minimal fix."

## 4. Mixing unrelated jobs

**Bad:** "Review the auth changes AND also optimize the database queries."
**Good:** Split into two separate Gemini runs.

## 5. Unsupported certainty

**Bad:** "Tell me exactly why this fails."
**Good:** "Investigate why this fails. Ground claims in the code; flag inferences."

## 6. Over-specifying steps

**Bad:** "First read file X, then grep for Y, then check Z..."
**Good:** "Find the root cause of the auth failure. Start from the error trace."
