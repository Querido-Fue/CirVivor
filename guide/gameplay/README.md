# Gameplay Design Guide

This directory is the current product/runtime authority for the sandbox sentence game.
Read only the smallest route needed for the task.

## Authority order

1. Current user requirement.
2. This `guide/gameplay/` document set.
3. Current production code and tests for already implemented behavior.
4. `guide/ingame_plan/status.md` for implementation status.
5. Historical migration and legacy guides only as technical evidence.

Code and tests are runtime truth for existing implementation. They do **not** override a newer
product decision that has not been implemented yet; in that case the mismatch must be recorded in
`ingame_plan/status.md` and the implementation must follow this directory.

## Routes

| Task | Read |
| --- | --- |
| Locked, baseline, and open decisions | [`00_design_authority.md`](00_design_authority.md) |
| Sentence grammar, Enemy/Tower as subject and payload | [`01_sentence_and_entity_words.md`](01_sentence_and_entity_words.md) |
| Team, ownership, targeting, Shoot/Throw/Emit/Summon | [`02_team_targeting_and_actions.md`](02_team_targeting_and_actions.md) |
| Tower HP, stat share, split, death loss, merge | [`03_tower_health_share_split_merge.md`](03_tower_health_share_split_merge.md) |
| Enemy behavior families and hostile attacks | [`04_enemy_behavior_and_combat.md`](04_enemy_behavior_and_combat.md) |
| Wave timer, Gold farming, Overtime, victory/defeat | [`05_wave_overtime_economy.md`](05_wave_overtime_economy.md) |
| GPU/runtime transactions and bounded execution | [`06_gpu_runtime_requirements.md`](06_gpu_runtime_requirements.md) |
| Sentence preview, warnings, HUD, sandbox feedback | [`07_ui_preview_and_feedback.md`](07_ui_preview_and_feedback.md) |
| Save, telemetry, deterministic tests | [`08_save_telemetry_testing.md`](08_save_telemetry_testing.md) |
| Unresolved tuning and policy | [`09_open_decisions.md`](09_open_decisions.md) |

## Minimum read sets

### Word or sentence implementation

1. `00_design_authority.md`
2. `01_sentence_and_entity_words.md`
3. `02_team_targeting_and_actions.md`
4. `06_gpu_runtime_requirements.md`

### Tower HP, split, or merge

1. `00_design_authority.md`
2. `03_tower_health_share_split_merge.md`
3. `06_gpu_runtime_requirements.md`
4. `08_save_telemetry_testing.md`

### Enemy AI or hostile projectile

1. `02_team_targeting_and_actions.md`
2. `04_enemy_behavior_and_combat.md`
3. `05_wave_overtime_economy.md`

### Wave, Gold, or victory logic

1. `00_design_authority.md`
2. `05_wave_overtime_economy.md`
3. `08_save_telemetry_testing.md`

## Status labels

- `LOCKED`: explicitly decided product rule. Do not silently substitute a safer rule.
- `BASELINE`: first implementation contract. Keep data/policy replaceable.
- `OPEN`: do not hard-code without a decision.
- `EXAMPLE`: explanatory content, not a balance commitment.

## Core sandbox rule

A sentence is not classified as beneficial or harmful. If it is grammatically valid, its execution
is defined, and the world has capacity for the atomic result, it executes literally. Preview and
warnings explain consequences; they do not disable a valid self-destructive or economy-oriented
sentence.
