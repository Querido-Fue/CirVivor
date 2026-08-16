# 02. Team, Ownership, Targeting, and Action Semantics

## R3 implementation status (2026-08-16)

R3 materializes only a fixed-HOSTILE Enemy payload. Q uses the living Tower subject and shared world Aim Point;
E uses living hostile Enemy subjects and the current hostile target/facing policy. Every child is a persistent
Enemy with exact owner, source ability/execution, generation, bounty, Siege, and target metadata. Team and noun
identity remain independent from physical/interaction layers.

The table and verb sections below remain the full design contract. Player Tower payload creation—including
`Enemies shoot The Tower`—and Throw/Emit/Summon/Merge actor execution are not implemented in R3.

## 1. Required gameplay metadata

Collision capability and gameplay allegiance are different dimensions.

```text
bodyLayer / collisionMask
interactionLayer / interactionMask
teamId
ownerEntityId / ownerIncarnation
sourceAbilityId
definitionId
archetype/tag data
targetPolicyId
```

Do not encode `Player`, `Hostile`, `Fire`, `Tower`, or `Enemy` solely as collision bits.

## 2. Team values

```text
PLAYER
HOSTILE
NEUTRAL
```

Payload allegiance policy:

```text
FIXED_PLAYER
FIXED_HOSTILE
INHERIT_SUBJECT
EXPLICIT_OVERRIDE
```

Examples:

| Sentence | Result team |
| --- | --- |
| The Tower shoots Fireballs | Player Fireballs |
| Enemies shoot Fireballs | Hostile Fireballs |
| The Tower shoots Enemies | Hostile Enemies |
| Enemies shoot The Tower | Player Towers |

## 3. Default damage acceptance

Baseline:

```text
Player attack → Hostile actor/hostile structure
Hostile attack → Player Tower/player structure
Player attack → Player object: no damage
Hostile attack → Hostile object: no damage
Neutral: definition policy
```

Reflect, convert, charm, or betrayal effects may change team/owner explicitly. They must not merely
flip a collision mask while leaving target and reward ownership stale.

## 4. Player Subject targeting

Player Subjects normally use the shared world Aim Point.

```text
direction = normalize(aimWorldPoint - subjectPosition)
```

With multiple Towers each Tower resolves direction from its own GPU-authoritative position to the same
Aim Point.

Modifiers may replace targeting:

- homing nearest hostile;
- outward;
- random deterministic target;
- nearest-to-Core hostile;
- strongest/weakest;
- same-lane hostile.

## 5. Hostile Subject targeting

Default hostile target policy:

1. nearest living Tower accepted by the action;
2. if no Tower exists, the Core;
3. if neither is targetable, the Subject's current facing/route direction.

Deterministic tie-break baseline:

```text
distance
→ higher Tower share
→ lower entityId
```

A verb can snapshot its target at cast start or continuously update it. This must be explicit.

## 6. Verb differences

### Shoot

- Straight launch from Subject.
- Player Subject: shared Aim Point unless modifier overrides.
- Hostile Subject: target position at launch time.
- Existing projectile keeps its launch direction if the target dies.

### Throw

- Uses a landing/impact target.
- Hostile baseline may lead the Tower using current velocity and flight duration.
- Displays a landing telegraph.
- Airborne payload collision/AI policy is payload-specific.

### Emit

- Creates payload at or around the Subject.
- Hostile instant effects choose the current target according to policy.
- May use same-lane or nearest target defaults.

### Summon

- Creates payload at a validated target point.
- Must enforce terrain, minimum-distance, and overlap rules.
- Does not silently use the Subject's position if the requested point is invalid.

### Merge

- Selects compatible live Subjects and applies a conservation policy.
- Merge is not a generic delete-and-spawn shortcut; conserved values are defined per entity kind.
- Tower Merge is specified in `03_tower_health_share_split_merge.md`.

## 7. Target loss

- Snapshot projectile: continues with existing velocity.
- Homing projectile: retargets according to deterministic policy.
- Channeled action: cancels, retargets, or completes at last position according to verb policy.
- Hostile action with no Tower may target Core if allowed.
- Player action with no Tower can still execute if its Subject exists.

## 8. Spawn grace

Actor payloads may need source-pair grace to avoid immediate self-overlap contact.

The grace policy must be narrow:

```text
source exact identity
new actor exact identity
grace expiry tick
which collision/interaction pairs are suppressed
```

It must not make the actor globally invulnerable or untargetable unless the content says so.

The current Enemy payload uses a data-owned positive `surfaceGap` at materialization and does not add a general
invulnerability window. A future payload that still needs pair grace must implement the exact narrow contract
above rather than broad collision or damage immunity.

## 9. Damage snapshot

A projectile snapshots its damage budget at spawn/materialization.

```text
sourcePower at spawn
× noun modifier
× sentence modifiers
× generation modifier
```

Later Tower death, split, merge, or Power changes do not retroactively alter an existing projectile.
This enables a projectile to win after all Towers are gone.
