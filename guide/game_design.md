# Game Design Authority

The current detailed authority is [`gameplay/README.md`](gameplay/README.md). This file is the concise
product summary used by broad tasks.

## Locked product rules

- The mobile Tower defends a fixed Core across authored routes and increasingly complex maps.
- WASD controls the living Tower group; mouse defines a shared world Aim Point. Active sentence slots
  map to LMB, Shift, Space, Q, and E through semantic input.
- The Tower has HP and can die. Tower count reaching zero is **not** a defeat condition; Core Integrity
  reaching zero is the default defeat condition.
- Every living Tower owns a share of the remaining Tower stat budget. Creating Towers dilutes living
  Max HP and Power; a dead Tower's share becomes Lost Share for the rest of the run. Merge combines
  living share only.
- Skills are data-authored word sentences. Localized text never drives gameplay logic.
- `Enemy` is an ordinary obtainable Entity Word and may be a Subject or Payload.
- Valid sentences execute literally even when they are self-destructive or create hostile actors.
- Objects created by an execution do not join that same execution's subject snapshot.
- Player-created enemies are real hostiles: they can attack Tower/Core, grant ordinary bounty, block
  wave cleanup, and add Overtime Siege Pressure.
- Enemy behavior is definition-specific: Corebound, Harasser, Hunter, Interceptor, Sapper, Artillery,
  and future policies may coexist.
- Enemies drop Gold. Wave-end Shop offers five words plus reroll and upgrade actions.
- A run spans multiple maps; later maps may use multiple gates/routes.

## Implementation rules

- Use stable IDs for words, actors, maps, waves, abilities, executions, and saves.
- Gameplay data lives in `project/game/script/data/`.
- Preview and runtime share formulas and allocation policy.
- Bound commands, generations, objects, hits, and journals, but do not impose an arbitrary small
  gameplay cap on valid sandbox results.
- Capacity failure is atomic: zero partial spawn/mutation and no cooldown consumption.
- Separate Library, Active Dictionary, Word Instances, Sentence Board, and immutable Compiled Ability.
- Separate physical/interaction capability from team, ownership, noun/tag, target policy, and reward.

Unresolved policy belongs in [`gameplay/09_open_decisions.md`](gameplay/09_open_decisions.md).
