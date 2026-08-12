# 07. Word, Ability, and Combat Runtime

## Current authority

Read:

- [`../gameplay/01_sentence_and_entity_words.md`](../gameplay/01_sentence_and_entity_words.md)
- [`../gameplay/02_team_targeting_and_actions.md`](../gameplay/02_team_targeting_and_actions.md)
- [`../gameplay/03_tower_health_share_split_merge.md`](../gameplay/03_tower_health_share_split_merge.md)

## Core compiler model

```text
Word Instances
→ SentenceDefinition
→ validation/type resolution
→ immutable CompiledAbility
→ fixed AbilityExecutionCommand
→ GPU subject snapshot/action execution
→ typed outcomes/domain events
```

## Required Entity Words

```text
The Tower / The Towers: Subject + Player Tower Payload
Enemy / Enemies: Subject + Hostile Enemy Payload
```

Enemy is a normal purchasable word. Do not route it into a mandatory curse system.

## Literal sandbox contract

Valid harmful/self-destructive sentences execute. Preview warns but does not block.

Required examples:

```text
The Tower shoots Enemies
Enemies shoot The Tower
Enemies shoot Enemies
The Towers merge
```

## Subject snapshot

Generated bodies never rejoin the same execution. Exact identity and deterministic order are required.

## Combat

- Team/target policy is separate from collision capability.
- Projectile damage snapshots source Power/share at materialization.
- Tower takes damage and can die.
- Tower death updates Lost Share exactly once.
- Tower count zero does not create failure.

## Runtime budgets

Bound subject count, generated count, generation depth, commands, contacts, and GPU capacity. A hard
capacity rejection is atomic and consumes no cooldown; it is not a strategic veto.
