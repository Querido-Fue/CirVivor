# 05. Wave Timer, Overtime, Gold, Victory, and Defeat

## R3 implementation status (2026-08-16)

R3 connects the CPU run-domain `GoldLedger`, exact `BountyRewardDirector`, and bounded
`HostileParticipationTracker`. Natural and player-created hostile Enemies contribute to live/pending hostile
count, bounty potential, and Siege Weight. An authenticated lethal PLAYER hit must match the same-boundary exact
`PLAYER_KILL` lifecycle commit before one deduplicated bounty credit is allowed. Core impact, ordinary despawn,
transform consumption, non-Player kills, replay, and stale/ABA identities award zero Gold.

The combat timer, Overtime phase transition, Siege Pressure Core DOT/escalation, Wave Clear/settlement, Shop,
and save boundary below remain design targets. R3 provides their participation inputs but does not implement
those phase owners.

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

### 2.1 Stage 1 performance wave

The first production map card currently routes to a deterministic long-run performance wave:

- exactly 10,000 spawn requests;
- one request every five authoritative 60 Hz fixed ticks;
- an opening census containing every R2 showcase type `C/T/A/M/P/H/O/J/R/Z`;
- a bulk stream over the eight types without global actor-capacity ownership;
- exactly eight O actors total and two Z actors total, with the second Z as the final request.

The last authored spawn tick is `49,996` (about 13 minutes 53 seconds without fixed-step stalls). Stage 1 alone
uses Tower HP and Core Integrity `20,000,000` so the performance stream is not cut short by ordinary combat.
The values remain inside the signed GPU centi-HP range. Other maps and the historical corridor wave keep their
normal combat values. Arrow movement remains GPU fixed-authoritative `easeOutExpo` (`lambda = 10`); the wave
does not implement or duplicate easing.

### 2.2 Map 2 real-load wave

The second production map card is a separate bounded acceptance session rather than a preview alias:

- map ID `performance_serpentine_02`, a `120×170` navigation grid with nine alternating horizontal runs;
- exactly 10 tiles of traversable corridor width and one connected serpentine route;
- exactly 10,000 sequential spawn requests at one request per authoritative fixed tick;
- opening census `C/T/A/M/P/H/O/J/R/Z`, so every natural R2 enemy is executed;
- remaining 9,990 requests cycle `C/T/A`, avoiding abuse of bounded H/O/J/R/Z domain capacities;
- Tower HP and Core Integrity `20,000,000` for a non-terminal load run.

The acceptance target counts Tower and Core separately, so completion is exactly 10,002 active GPU bodies,
10,000 queued enemies, and zero remaining requests. The 2026-08-15 NW.js run completed that target with no
GPU-world restart, recovery, or protocol failure; active-simulation throughput was 58.89 fixed ticks/s and
frame CPU p99 was 12.1 ms. Short diagnostic soaks may end before all spawns are queued and are not substitutes
for this complete receipt.

## 3. Player-created enemy bounty

This section is implemented in R3 for the Enemy actor payload and exact Player-kill reward path.

A player-created Enemy:

- has ordinary bounty;
- drops/awards Gold on valid kill;
- is attributed to its source sentence/ability;
- increases hostile count and Siege Pressure;
- can attack Tower/Core;
- can be selected by later Enemy-subject sentences.

The economy is balanced by risk and time, not a hidden bounty exception.

## 4. Overtime trigger

Not implemented in R3. The live/pending hostile and Siege aggregate inputs exist; no timer or Core DOT consumes
them yet.

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

Current reward settlement additionally requires authentic lethal GPU evidence from an exact Player source and
the matching same-boundary lifecycle disposition. Either proof alone is insufficient.

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
