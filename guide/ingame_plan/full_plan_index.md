# Ingame Architecture Plan Router

> **Current product authority:** [`../gameplay/README.md`](../gameplay/README.md)
>
> **Current implementation authority:** [`status.md`](status.md)

The numbered files in this directory describe implementation ownership and roadmap. They must not
reintroduce superseded product assumptions such as no Tower HP or Enemy exclusion.

## Task routing

| Task | Read |
| --- | --- |
| Decisions/scope | [`00_authority_and_scope.md`](00_authority_and_scope.md), [`../gameplay/00_design_authority.md`](../gameplay/00_design_authority.md) |
| Architecture | [`01_target_architecture.md`](01_target_architecture.md) |
| Phase/wave/shop/run flow | [`02_game_state_and_flow.md`](02_game_state_and_flow.md) |
| System interfaces | [`03_system_contracts.md`](03_system_contracts.md) |
| Input/group control/camera | [`04_input_and_control.md`](04_input_and_control.md) |
| GPU objects/collision/team metadata | [`05_object_and_collision.md`](05_object_and_collision.md) |
| Enemy AI/path/wave | [`06_ai_path_and_wave.md`](06_ai_path_and_wave.md) |
| Words/ability/combat | [`07_word_and_combat.md`](07_word_and_combat.md) |
| Logs/statistics | [`08_log_and_statistics.md`](08_log_and_statistics.md) |
| HUD/shop/editor | [`09_game_ui.md`](09_game_ui.md) |
| Checkpoint/continue | [`10_ingame_checkpoint.md`](10_ingame_checkpoint.md) |
| Legacy cutover | [`11_legacy_reuse_and_cutover.md`](11_legacy_reuse_and_cutover.md) |
| Roadmap | [`12_implementation_roadmap.md`](12_implementation_roadmap.md) |
| Tests/acceptance | [`13_testing_and_acceptance.md`](13_testing_and_acceptance.md) |
| Open implementation decisions | [`14_open_decisions.md`](14_open_decisions.md), [`../gameplay/09_open_decisions.md`](../gameplay/09_open_decisions.md) |

## Current target systems

```text
GameScene
└─ GameSystem
   ├─ CPU run domain
   │  ├─ CoreIntegrity
   │  ├─ TowerGroupState / LostShare ledger
   │  ├─ Gold / Words / SentenceBoard
   │  ├─ Wave/Overtime/Shop/Run state
   │  └─ statistics/checkpoint
   └─ GameObjectSystem
      ├─ generic GPU World endpoint owner
      ├─ ability/subject execution command owner
      ├─ gameplay event router
      └─ bounded presentation summaries
```

## Core rules

- Tower HP and death are part of combat.
- Only Core depletion is the default defeat condition.
- Enemy and Tower are both Entity Words with Subject/Payload roles.
- Tower creation conserves remaining living share; death makes share permanently Lost for the run.
- Valid sentences execute literally.
- Player-created enemies are reward-bearing hostile actors and Overtime pressure.
- Large actor results require GPU selector/allocator/transactions, not per-entity CPU objects.
- Safe-boundary save remains the current checkpoint policy.
