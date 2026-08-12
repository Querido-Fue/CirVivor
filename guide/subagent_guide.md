# Subagent Guide

This guide applies only when the primary agent is Sol. Do not use Luna.

## Dispatch rules

- Dispatch only bounded, independent work. Sol defines the objective, non-goals, allowed scope, and acceptance criteria before dispatch.
- Give each writable file a single active owner. Do not send concurrent agents to edit the same file.
- The delegate must report changed files, verification run, results, and remaining risks to Sol.
- Escalate to Sol before crossing a public API, data schema, module contract, or subsystem boundary; changing dependencies; deleting files; changing Git branches; or taking an external action.

## Agent names

Use this human-readable dispatch title format:

```text
<Model> <reasoning effort> | <Concise task title>
```

Examples:

```text
Terra max | Map Collision Pipeline
Terra max | Add Wave Spawn Tests
Sol xhigh | Integrate Scene Lifecycle Refactor
```

If the dispatch tool accepts only a machine-safe task identifier, use the equivalent lowercase identifier (for example, `terra_max_map_collision_pipeline`) and put the human-readable title as the first line of the subagent prompt.

## Ownership

| Work | Owner |
| --- | --- |
| Requirements, design, task decomposition, non-goals, and acceptance criteria | Sol |
| Codebase mapping and relevant-file discovery | Terra `max`; Sol confirms architectural conclusions |
| Well-scoped frontend or backend implementation | Terra `max` |
| Unit and integration test writing, test execution, failure reproduction, and benchmark evidence | Terra `max` |
| Reproducible Computer Use and visual QA | Terra `max` |
| Complex UI state, multi-system contracts, large refactors, security, performance, and data-contract decisions | Sol |
| Final integration, review, verification decision, and completion judgment | Sol |
| File deletion, Git branch management, staging, commits, and pushes | Sol |
| Durable architecture and ownership guide updates | Sol |

## Escalation

Terra must stop and return the work to Sol when the approved scope no longer fits, a change affects several subsystems, a test failure cannot be reproduced or explained, or an action may alter repository history, user data, credentials, or an external service.
