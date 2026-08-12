# 08. Save, Telemetry, and Testing

## 1. Safe checkpoint data

Safe-boundary save should include:

```text
Core Integrity
Gold
map/wave/shop phase
RNG streams
Word Library/Active Dictionary/Word Instances
Sentence Board and upgrades
TowerGroup ledger:
  runBaseMaxHp
  runBasePower
  lostShare
  safe-boundary living Tower aggregate/records as policy requires
ShopSession and transaction IDs
run statistics
```

Mid-wave Tower/enemy/projectile transforms remain excluded until an authoritative GPU checkpoint
format is explicitly designed.

## 2. Schema changes from the old guide

The save validator must no longer reject all Tower health/share keys. It must instead validate the
new TowerGroup schema at safe boundaries.

Required checks:

- finite/base stat ranges;
- share fixed-point sum invariant;
- `livingShare + lostShare == totalShareBudget`;
- unique exact Tower records if living Towers are persisted;
- current HP within derived Max HP;
- zero living Towers allowed;
- no Lost Share restoration during migration/load;
- schema migration from pre-HP saves initializes one full-share Tower at the safe spawn boundary.

## 3. Domain events

Suggested typed events:

```text
TowerDamageApplied
TowerDied
TowerShareLost
TowerCreationRequested/Committed/Rejected
TowerMergeStarted/Committed/Interrupted
EnemyCreated
EnemyKilled
BountyGranted
OvertimeStarted
SiegePressureChanged
CoreOvertimeDamageApplied
NoLivingTowers
WaveCleared
MapVictory
CoreDestroyed
```

Every event carries exact identity/provenance where applicable and is applied exactly once.

## 4. Statistics

Track at least:

- maximum living Tower count;
- minimum average Tower share;
- total Lost Share;
- Tower deaths by source ability/enemy;
- player-created enemies;
- Gold earned from player-created enemies;
- maximum hostile count;
- maximum Siege Weight;
- Overtime duration and Core damage;
- sentence subject count and generated count;
- atomic capacity rejections;
- victories with zero living Towers;
- final kill source after last Tower death.

## 5. Determinism

Same seed, input commands, and content version should produce the same:

- subject snapshot order;
- Tower share remainder distribution;
- hostile target tie-break;
- split/merge result;
- bounty and Overtime aggregate;
- victory/defeat transition.

## 6. Required scenario tests

1. Walker ignores Tower and reaches Core.
2. Hunter targets nearest Tower and falls back to Core with zero Towers.
3. Archer follows Core route while shooting Tower.
4. Player projectile cannot damage Tower.
5. Hostile projectile cannot damage Enemy.
6. `30/30` Tower creates one new Tower → two `15/15`, Power 5.
7. `18/30` Tower creates one new Tower → two `9/15`.
8. One 50% Tower dies → survivor remains 50%, Lost becomes 50%.
9. Survivor splits → two 25%, Lost remains 50%.
10. Two living shares 50%+25% merge → 75%; Lost unchanged.
11. Child capacity failure leaves every parent unchanged and consumes no cooldown.
12. Merge interruption by death excludes dead share and records it Lost.
13. Zero Tower count does not emit RunFailed.
14. Existing projectile kills final enemy with zero Towers → victory.
15. `The Tower shoots Enemies` creates real bounty/pressure enemies.
16. `Enemies shoot The Tower` creates Player Towers and dilutes all living stats.
17. `Enemies shoot Enemies` doubles across executions but not recursively within one execution.
18. Timer expiry with enemies starts Overtime and Core DOT.
19. Killing enemies during Overtime reduces pressure.
20. Creating enemies during Overtime increases pressure.
21. Capacity failure is all-or-nothing for hundreds of actors.
22. GPU recovery preserves Lost Share/Core/Gold/words and discards transient executions.

## 7. Property tests

- arbitrary split/merge/death sequence conserves total share budget;
- current HP is conserved by creation dilution and living merge;
- Lost Share is monotonic nondecreasing during a run;
- no operation yields negative share/HP or share above total;
- exact identity reuse cannot transfer death/share to a replacement Tower;
- subject snapshot never includes bodies created by that execution;
- capacity rejection never partially mutates world or ledger.

## 8. Hardware tests

Actual WebGPU fixtures should cover:

- hostile projectile → Tower damage/death;
- multiple Tower selector/broadcast movement;
- Tower target query and deterministic tie-break;
- large actor creation transaction;
- Tower death readback and exact share lookup;
- no full-body frame readback;
- storage-buffer limits and uncaptured error zero;
- old generation event isolation.
