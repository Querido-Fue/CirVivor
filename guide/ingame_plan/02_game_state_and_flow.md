# 02. Game State and Flow

## Phase machine

```text
ENTERING
→ BEFORE_WAVE
→ COMBAT
→ OVERTIME (only while timer expired and hostiles remain)
→ WAVE_SETTLEMENT
→ SHOP
→ BEFORE_WAVE / MAP_TRANSITION / RESULT
```

Pause/modal overlays suspend fixed gameplay without changing the phase authority.

## Run-domain state

```text
CoreIntegrity
Gold
TowerGroupState:
  baseMaxHp
  basePower
  lostShare
  living Tower records/aggregate
Word Library / Active Dictionary / Instances
SentenceBoard / upgrades
Wave timer / scheduled spawn progress
Overtime elapsed / Siege Pressure
map/run/RNG/statistics
```

## Defeat

```text
CoreIntegrity <= 0
→ one RunFailed transition
```

Living Tower count zero is not defeat.

## Victory

Final wave victory requires final hostile cleanup and Core Integrity above zero. Existing projectiles or
other Subjects may complete the final kill after the last Tower dies.

## Combat and Overtime

See [`../gameplay/05_wave_overtime_economy.md`](../gameplay/05_wave_overtime_economy.md).

- Combat timer is fixed-step.
- Player-created enemies are part of the hostile world.
- Timer expiry with remaining/pending hostiles starts Overtime.
- Overtime Siege Pressure damages Core until hostile cleanup.
- Wave clear requires timer expired, hostile actors zero, and hostile actor creation pending zero.

## Safe checkpoints

Save at settlement/shop/before-wave boundaries. Do not serialize active GPU bodies until an explicit
authoritative checkpoint format exists.

## Recovery

Device-loss recovery preserves CPU run-domain state including Core Integrity, Gold, words,
TowerGroup/Lost Share, wave/map state, and statistics. It restarts transient GPU world state at a safe
wave boundary.
