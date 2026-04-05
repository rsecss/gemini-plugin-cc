# Gemini Prompt Recipes

## Diagnosis Recipe

```xml
<task>Diagnose root cause of the described issue.</task>
<compact_output_contract>Return: root cause, evidence, next step.</compact_output_contract>
<grounding_rules>Ground every claim in repo context. Do not guess facts.</grounding_rules>
```

## Narrow Fix Recipe

```xml
<task>Implement the smallest safe fix for the described issue.</task>
<structured_output_contract>Return: summary, touched files, verification steps, residual risks.</structured_output_contract>
<action_safety>Keep changes scoped. Do not refactor unrelated code.</action_safety>
```

## Root-Cause Review Recipe

```xml
<task>Analyze the code changes for correctness and regression risk.</task>
<structured_output_contract>Return: findings by severity, evidence, next steps.</structured_output_contract>
<grounding_rules>Ground every claim in the provided context.</grounding_rules>
```

## Research Recipe

```xml
<task>Research options and recommend the best path forward.</task>
<structured_output_contract>Return: facts, recommendation, tradeoffs, open questions.</structured_output_contract>
```
