# Ingame Guide

Scope: play `GameScene` from session creation through combat, sandbox sentences, waves, shop,
checkpoints, and run completion.

## Authority

1. Current user requirement.
2. [`../gameplay/README.md`](../gameplay/README.md) for current product/runtime design.
3. Current code and tests for implemented behavior.
4. This directory for implementation status, architecture, migration, and acceptance.
5. Legacy guides only as explicit technical oracles.

## Read by task

| Task | Read |
| --- | --- |
| Current sandbox gameplay rule | [`../gameplay/README.md`](../gameplay/README.md) |
| What exists now and next safe step | [`status.md`](status.md) |
| Full implementation-plan router | [`full_plan_index.md`](full_plan_index.md) |
| Session ownership and contracts | [`runtime_contracts.md`](runtime_contracts.md), [`03_system_contracts.md`](03_system_contracts.md) |
| GPU/object/collision | [`05_object_and_collision.md`](05_object_and_collision.md), [`../gameplay/06_gpu_runtime_requirements.md`](../gameplay/06_gpu_runtime_requirements.md) |
| Enemy AI/routes/waves | [`06_ai_path_and_wave.md`](06_ai_path_and_wave.md), [`../gameplay/04_enemy_behavior_and_combat.md`](../gameplay/04_enemy_behavior_and_combat.md) |
| Words/combat | [`07_word_and_combat.md`](07_word_and_combat.md), [`../gameplay/01_sentence_and_entity_words.md`](../gameplay/01_sentence_and_entity_words.md) |
| Tower HP/split/merge | [`../gameplay/03_tower_health_share_split_merge.md`](../gameplay/03_tower_health_share_split_merge.md) |
| Overtime/Gold/victory | [`../gameplay/05_wave_overtime_economy.md`](../gameplay/05_wave_overtime_economy.md) |
| UI/preview | [`09_game_ui.md`](09_game_ui.md), [`../gameplay/07_ui_preview_and_feedback.md`](../gameplay/07_ui_preview_and_feedback.md) |
| Save/test | [`10_ingame_checkpoint.md`](10_ingame_checkpoint.md), [`13_testing_and_acceptance.md`](13_testing_and_acceptance.md) |

## Current locked corrections

- Tower HP/death is required gameplay, not prohibited.
- Enemy is a normal purchasable Subject/Payload word.
- Zero living Towers does not cause default defeat.
- Valid harmful/self-destructive sentences are allowed.
- Player-created enemies use real bounty, wave, and Overtime rules.
- GPU migration documents that prohibited Tower HP were phase-scope records, not current product rules.

Update `status.md` whenever implementation behavior, gaps, temporary adapters, or the next safe step
changes.
