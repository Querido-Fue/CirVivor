# 03. Tower Health, Share, Split, Death Loss, and Merge

## 1. State model

CPU run-domain state owns the conserved ledger and exact Tower records; GPU bodies own authoritative
combat HP, transform, collision, and death.

```yaml
towerGroup:
  runBaseMaxHp: 30
  runBasePower: 10
  livingShare: 1.0
  lostShare: 0.0
  towers:
    - handle: { entityId: 10, incarnation: 1 }
      share: 1.0
```

Invariant:

```text
sum(living Tower shares) + lostShare = 1.0
```

R4 locks Share to the integer fixed-point scale below:

```text
TOWER_SHARE_SCALE = 1_000_000_000
sum(living Tower share units) + lostShareUnits = TOWER_SHARE_SCALE
```

Dilution uses deterministic cap-aware largest-remainder allocation. Each raw quotient is floored and
clamped to that claim's cap. Residual units are distributed by remainder descending, then logical Tower
ordinal, entity ID, incarnation, and logical ID ascending. If an explicit preserved target is below the
sum of the bounded floors, units are removed in the exact reverse priority. The result is independent of
input array order and never uses cumulative f32 Share arithmetic.

## 2. Derived stats

For Tower `i`:

```text
MaxHP_i = RunBaseMaxHP × Share_i
Power_i = RunBasePower × Share_i
```

Run-global upgrades change base values; they do not restore Lost Share.

```text
RunBasePower 10 → 12
Share 0.5
Power = 6
```

## 3. Creating K Towers from N living Towers

Let:

```text
N = current living Tower count
K = number of new Towers to create
R = current living share
H = sum current HP of living Towers
```

Baseline uniform dilution:

```text
existing dilution factor = N / (N + K)
new existing share_i = old share_i × dilution factor
new existing currentHP_i = old currentHP_i × dilution factor
new Tower share = R / (N + K)
new Tower currentHP = H / (N + K)
```

This preserves living share and total current HP.

The shared CPU planner/preview must reject before reservation when any resulting Tower would have
`currentHpFixedPoint <= 0`. The explicit result/reason is
`REJECTED_NON_VIABLE_CURRENT_HP / NON_VIABLE_DERIVED_CURRENT_HP`; execution is disabled, child/reservation/GPU
submission/existing mutation are all zero, and recovery remains false. The spawn adapter keeps its positive-HP
check as a fail-closed defense. At the fixed-point HP scale, 0.01 HP split 1→2 rejects, while 0.02 HP split 1→2
is viable as exact 0.01 + 0.01.

### Example: one full Tower to two

```text
Before: 30/30 HP, Power 10, Share 100%
After:  two Towers, each 15/15 HP, Power 5, Share 50%
```

### Example: damaged split

```text
Before: 18/30 HP
After:  two Towers, each 9/15 HP
```

### Example: 99 enemies shoot The Tower

```text
N=1, K=99, R=1
Result count=100
Average MaxHP=0.3
Average Power=0.1
```

The sentence is valid even if the result is strategically disastrous.

## 4. Atomic creation transaction

Tower creation must be all-or-nothing.

1. Freeze exact source subjects and requested child count.
2. Calculate resulting ledger and stats.
3. Preflight GPU body/identity/command capacity.
4. Reserve every new Tower identity and slot.
5. Stage parent mutation and child initialization in one transaction domain.
6. Validate source identities again on GPU.
7. Apply child activation and parent dilution atomically.
8. Commit CPU ledger only after the GPU outcome is accepted.

Failure behavior:

```text
child capacity failure
→ create zero children
→ parent HP/share unchanged
→ cooldown not consumed
→ no partial living-share mutation
```

`transactionId` replay is exact and payload-bound. The canonical fingerprint includes sorted child descriptors,
child count, and requested fixed tick. Same ID plus the same fingerprint returns the exact existing queued,
pending, completed, or ordinary-rejection receipt and performs no new prelease, GPU submission, or ledger commit.
Same ID plus a different fingerprint is `TRANSACTION_FINGERPRINT_MISMATCH`, never an idempotent success. Completed
receipt retention is bounded; active transactions are not eviction candidates.

## 5. Tower death

On exact Tower death:

```text
lostShare += deadTower.share
remove dead Tower record
livingShare -= deadTower.share
```

Other Towers are not rescaled upward.

```text
50% + 50%
second Tower dies
→ survivor remains 50%
→ lostShare becomes 50%
```

Death event processing must read the dead Tower's exact registry/domain metadata before lifecycle
cleanup makes it unavailable.

## 6. Zero living Towers

Zero Towers does not end the run.

```text
livingShare = 0
lostShare = 1
```

Player commands whose Subjects still exist remain available. The Core remains the defeat authority.

Creating a Tower when living share is zero cannot restore lost stats. Baseline result:

```text
new Tower share = 0
MaxHP = 0
Power = 0
```

The R4 technical creation policy rejects this as non-viable in the shared planner because derived current HP is
not positive. It must never materialize briefly or restore positive Share.

## 7. Shared control

Baseline:

- one Tower-group controller receives semantic movement and Aim Point;
- GPU broadcasts movement intent to all live Player Tower bodies;
- each Tower collides independently;
- each Tower shoots from its own authoritative position;
- skill cooldowns and Sentence Board are group-level;
- current HP, share, transform, and hit state are per Tower.

Do not register hundreds of Tower facades that each consume the same action. Use one group capability
and GPU selector/broadcast.

## 8. Camera summary

Preferred summary:

```text
livingCount
livingShare
share-weighted centroid
bounds min/max
primary Tower handle
```

Centroid:

```text
sum(position_i × share_i) / sum(share_i)
```

The GPU computes the bounded summary. CPU consumes presentation-only data. No full-body frame readback.
If no Tower lives, current production camera falls back directly to the CPU Core position. A future non-Tower
player-owned camera summary may be inserted only through an explicit policy change.

## 9. Merge

`The Towers merge` combines selected living Towers.

```text
MergedShare = sum(selected shares)
MergedCurrentHP = sum(selected current HP)
MergedMaxHP = RunBaseMaxHP × MergedShare
MergedPower = RunBasePower × MergedShare
LostShare = unchanged
```

Example:

```text
25% Tower 6/7.5 + 25% Tower 3/7.5
→ 50% Tower 9/15, Power 5
Lost 50% remains lost
```

Merge position baseline:

```text
sum(position_i × share_i) / sum(share_i)
```

## 10. Merge execution

Baseline staged merge:

1. Freeze compatible Tower subjects.
2. Compute merge centroid and conserved totals.
3. Enter merge travel/channel state.
4. Towers move toward merge point and cannot start conflicting split/merge transactions.
5. When completion condition is met, reserve merged identity if needed.
6. Revalidate survivors.
7. Dead subjects move their share to Lost Share and are excluded.
8. Atomically replace remaining subjects with merged Tower.

Instant merge, travel speed, interruption, and defense during merge remain tunable/open.

## 11. No low gameplay count cap

There is no default design cap of four Towers. Hundreds are a valid sandbox result if technical
capacity permits.

Technical capacity remains mandatory. The current production member-count authority is
`THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY = 256`; creation preview, technical runtime status, gameplay
diagnostics, and acceptance receipts consume the same value. GPU body stable-slot capacity is a separate address
range, and an injected runtime-only 1,000-Tower group-control test does not raise the production creation limit.

```text
required Tower count <= 256
→ normal planning

required Tower count > 256
→ atomic REJECTED_CAPACITY
→ generated 0
→ existing mutation 0
```

Body and other technical capacity also remain mandatory:

```text
required bodies > available bodies
→ atomic execution rejection
→ cooldown not consumed
```

The UI must display required and available capacity. Do not silently create only a prefix.
