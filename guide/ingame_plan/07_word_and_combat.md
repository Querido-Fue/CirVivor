# 07. Word, Ability, and Combat Runtime

## R3 current implementation (2026-08-16)

- `WordSystem` owns a typed catalog/compiler, five slots, semantic fixed activation requests, and completion-only
  cooldown settlement in the CPU run domain.
- Q is `The Tower shoots Enemies`; E is `Enemies shoot Enemies` in the production showcase.
- `AbilityRuntime` creates one aggregate-only GPU execution-start Subject snapshot. Exact subject records are not
  read back to CPU and generated bodies cannot join the same execution.
- `ActorPayloadMaterializer` supports only `Shoot + Enemy`: exact 0/N prelease, contiguous body upload, one
  lifecycle publication, and persistent ordinary hostile actors active from the next fixed tick.
- The GPU is the child-generation authority (`source + 1`). CPU registry metadata records that authority and
  provenance without per-child generation readback.
- Zero subjects, true capacity rejection, and retryable event/telemetry backpressure consume no cooldown or
  partial actor result. Protocol/identity/generation mismatch is recovery.
- `GoldLedger` and exact dual-proof bounty settlement are connected; player-created Enemies contribute to
  live/pending hostile count, bounty potential, and Siege Weight.

Tower Payload/`Enemies shoot The Tower`, Tower Share/group control, Merge, other verbs/nouns, full modifier
grammar, Overtime phase/DOT, Shop/editor UI, and save integration remain future milestones.

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

Enemy is current as both Subject and Payload. The Tower is current as a Subject; its Payload role is typed in the
design contract but not materialized until the Tower Payload milestone.

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

Only the first and third examples are current R3 end-to-end actor execution. The second and fourth remain
literal future contracts and must not be presented as implemented.

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
