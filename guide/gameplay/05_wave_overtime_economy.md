# 05. Wave Timer, Overtime, Gold, Victory, and Defeat

## 1. Phase flow

```text
Combat
→ Overtime (only if timer expired and hostiles remain)
→ Wave Clear
→ Settlement / Shop
```

## 2. Combat timer

- Scheduled enemies spawn according to WaveDirector.
- Player-created enemies are added to the same hostile world.
- The timer does not automatically end early because hostiles are zero.
- An optional `End Wave Early` command may be available only when scheduled and pending hostile
  creation is zero and no hostile actor lives.

## 3. Player-created enemy bounty

A player-created Enemy:

- has ordinary bounty;
- drops/awards Gold on valid kill;
- is attributed to its source sentence/ability;
- increases hostile count and Siege Pressure;
- can attack Tower/Core;
- can be selected by later Enemy-subject sentences.

The economy is balanced by risk and time, not a hidden bounty exception.

## 4. Overtime trigger

Overtime starts when:

```text
wave timer <= 0
AND (live hostile actors > 0 OR pending hostile actor creation > 0)
```

During Overtime:

- enemy AI and combat continue;
- scheduled spawning is normally finished;
- player may still execute sentences, including creating more enemies;
- aggregate Siege Pressure deals Core damage over time;
- pressure updates as enemies spawn, merge, or die;
- damage escalates with Overtime duration.

## 5. Siege Pressure

Each hostile actor definition has `siegeWeight`.

```text
SiegeWeight = sum(live hostile actor siegeWeight)
```

Prototype formula (`BASELINE`, data-owned):

```text
OvertimeCoreDps = (0.5 + SiegeWeight × 0.05) × Escalation
Escalation = 1 + floor(OvertimeSeconds / 10) × 0.25
```

Do not hard-code these numbers outside content/config.

Merge or transform must conserve relevant Siege Weight unless content explicitly changes it. Merging
100 enemies into one must not erase 99 enemies worth of Overtime burden by accident.

## 6. Wave clear

Baseline condition:

```text
Timer <= 0
AND live Hostile Actor count == 0
AND scheduled Hostile spawn count == 0
AND pending Hostile actor SpawnProgram count == 0
```

Hostile transient projectiles/effects need not block Wave Clear unless the content says they can create
new hostile actors. At clear, transient hostile projectiles may be removed by an explicit cleanup pass.

## 7. Final wave victory

```text
final wave clear condition
AND Core Integrity > 0
→ Map Victory
```

Living Tower count is not checked.

Example:

```text
last Tower fires Fireball
→ Tower dies
→ Fireball kills final Enemy
→ hostile actors reach zero
→ Map Victory
```

## 8. Defeat

Default defeat:

```text
Core Integrity <= 0
```

No-Tower is not defeat. A future challenge modifier may add another condition, but it must be explicit
and must not replace the default silently.

## 9. Core direct attacks vs Overtime damage

Two independent sources may damage Core:

1. Enemy direct Core attack after reaching/targeting Core.
2. Overtime Siege Pressure while hostiles remain after timer expiry.

Both require exactly-once fixed-domain events and must not double-count the same authored attack.

## 10. Reward integrity

A kill reward requires:

```text
exact hostile death identity
bounty metadata
reward eligibility
not already settled
```

Source provenance identifies player-created enemies but does not remove reward eligibility.

Potential future modifiers may change bounty (`Golden`, `Worthless`, `Summoned`), but the base Enemy
word does not carry a no-reward flag.

## 11. Save boundary

Safe checkpoint baseline:

- after Wave Clear settlement draft is committed;
- after Shop transaction commit;
- before next Wave begins.

Do not save a mid-wave snapshot merely to preserve an enemy-farming state until a full authoritative
GPU checkpoint design exists.
