# R2 Turn 7 — Ring R Projectile Capture and Allegiance Transfer

## 목표

Player projectile를 포획하고 동일한 logical projectile를 Hostile로 재방출한다.

## 시작

```text
r2t7 수행 완료.
```

## 1. R content

Visual:

```text
hollow ring
funnel intake sector
```

Navigation:

```text
Core route
common contact/Core impact
```

Capture slot baseline:

```text
one captured projectile per R
```

Data-owned delay/release policy.

## 2. Capture eligibility

Projectile must:

```text
Team PLAYER
enter funnel angular sector
not already captured
capturable policy true
```

Body contact elsewhere does not capture unless data says.

## 3. Same logical projectile

Preserve exact logical identity whenever feasible:

```text
entityId/incarnation
archetype
word/tag metadata
modifiers
damage
size
generation
ability/source relationships
```

Captured state:

```text
inactive for normal movement/contact
hidden or visibly stored
attached to R exact handle
timer
```

Do not despawn/recreate as a new generic projectile if that would break subject relations.

## 4. Release

At release:

```text
Team → HOSTILE
owner/source → R
target policy → PLAYER_DAMAGEABLE_AND_TERRAIN
position → funnel exit
velocity/target → exact living Tower, otherwise stored forward
```

The current profile deliberately has no Core targeting fallback: the Core proxy is not player-damageable and
changing only a target handle would not create a valid reciprocal damage policy.

Captured Fireball remains a Fireball for subject selectors.

Future `Fireballs emit Lightning Bolts` relation remains valid.

## 5. R death baseline

Use a data-owned policy and document it.
Technical default:

```text
RELEASE_HOSTILE_FORWARD
```

If R dies while holding:
- release the captured projectile once,
- preserve metadata,
- no duplicate capture/cleanup.

## 6. Protocol

Capture, attach, mutation, release are exact and atomic.

Normal stale captor/projectile → cleanup/no recovery.
Old generation cannot release.

No full-body readback.

Implemented authority:

```text
Body ABI v8
ProjectileCaptureState 48 bytes + candidate 16 bytes
Projectile Capture Runtime ABI v1
capture/release header 64 bytes, completion/release record 96 bytes
profile 32 bytes, Tower target config 16 bytes
all compute/render profiles <= 9 storage bindings
```

Capture changes bilateral GPU state and the host R roster but does not mutate registry metadata. The
`PROJECTILE_CAPTURED` Simulation bit is only an exact mirror used to skip held projectile movement, grid,
contact, solver, source-control, and render work. Peer slot/entity/incarnation, phase, sequence, timer, and
generation live in `ProjectileCaptureState`; any bilateral/mirror mismatch is recovery corruption.

Release preserves the projectile slot/entity/incarnation. `WorldRegistry` owns a privileged one-shot active
metadata CAS token binding exact record identity, metadata revision, immutable origin provenance, and the next
logical metadata snapshot. Lifecycle order is despawn → H atomic → J atomic → projectile release → spawn.
The backend is armed before registry publication and committed after it; failure before publication cancels
zero-partially, while a post-publication mismatch requires recovery.

Capture completion and generic event streams are published through a coherent source-tick watermark so death
or Core evidence cannot overtake capture evidence. Per projectile the final action priority is expiry/despawn,
then authenticated Core/death/normal release, then held capture. R Core impact and death release stored-forward
once. Terminal cleanup tombstones unpublished held projectiles and cancels unpublished release work; an already
lifecycle-published `commitRequested` release completes GPU commit and async readback before terminal seal.
Replacement clears all capture state, proofs, rosters, queues/readbacks, metadata-mutation authority, and stale
ports.

## 7. Tests to author, not execute

```text
funnel sector
capture capacity
metadata identity preservation
Team/owner/target transfer
Fireball relation preservation
captor death release
captor Core-impact release
projectile death while pending
ABA/generation
capture + O/P/H/J coexistence
coherent capture-before-generic watermark/replay
same-identity release metadata CAS and revision
terminal unpublished cleanup / published release settlement
replacement and stale-port rejection
```

The dedicated `enemy-ring-projectile-capture` Node/static/NW fixture is authored under the restricted cadence.
It is not acceptance evidence until Turn 9 explicitly executes the cumulative gates.

## 8. 위생 검사

```text
node --check
git diff --check
```

## 9. 완료

```text
r2t7 수행 완료.
```

후 Turn 8.
