# 06. GPU Runtime and Transaction Requirements

## R5 Turn 2 GPU placement boundary (2026-08-19)

ActorActionPlacement ABI v1 is an independent side-plane rather than an extension of Body ABI v8 or the R3
Enemy materializer. Its program header, lease, aggregate, placement record, transit record, and indirect-dispatch
strides are `224/32/96/144/80/16` bytes. Initialize, parallel resolve, parallel validate, and aggregate passes
freeze cast-start source/target/direction, validate finite/SDF placement, author deterministic Summon stable-rank
lattice offsets, and initialize Throw landing/duration without advancing transit. Every stage stays at or below
nine storage buffers.

ActorAction profile ABI v2 computes `actorActionProfileFingerprint` over every semantic field, including profile
identity, target/placement/activation policies, all float/tick parameters, and every transit flag. The compiler,
AbilityExecutionCommand ABI v2/fingerprint, GPU program header, 96-byte aggregate completion, and retained
binding must all carry the same value. A stale or substituted profile is rejected before GPU submission.

Throw's `travelDurationFixedTicks` is authoritative. The GPU derives ground velocity as
`(landing - spawn) × 60 / duration`; authored `travelSpeed` must remain zero. Both the source-surface spawn and
landing point pass finite/world/SDF validation in the same aggregate-gated batch. Either invalid endpoint yields
normal `SDF_REJECTED` with no consumable token or mutation.

The runtime maps only the fixed 96-byte aggregate. Successful output remains in GPU storage behind a
generation-qualified placement token; no per-subject record or body array is read back. Exact and one-invalid
SDF batches, one-short capacity, stale device/destination identity, and protocol corruption all fail closed with
zero body/Tower mutation. `cancel`, `rebind`, and `destroy` revoke pending/in-flight/retained tokens.

This Turn 2 side-plane is intentionally not registered in the endpoint fixed loop and does not replace the R3
materializer. It commits no body, Tower record, Share, cooldown, or lifecycle event. Turn 3 owns the atomic Tower
payload transaction that will consume the token; Turn 5 owns Throw transit advance. Production therefore keeps
the R3 Q/E loadout, leaving SHIFT/SPACE empty until the Turn 4 vertical slice rather than routing unavailable
Tower Payload into `AbilityRuntime`.

## Post-R3 implementation status (2026-08-17)

R3 Enemy Entity Word is now a concrete GPU runtime, not a future seam. CPU code submits one semantic execution;
the GPU snapshots exact eligible subjects into deterministic order and returns only aggregate evidence. The
Enemy actor payload then preleases exactly N identities/body slots, uploads contiguous prelease ranges, and
materializes all N persistent actors or zero. GPU source metadata is the generation authority and writes every
child as `source generation + 1`; generated children become visible to a later execution only. No per-subject
result readback, per-child JS object, or full-body readback was introduced.

The actor-payload ABI now executes initialize (`1` invocation), parallel validate (`64`-wide), aggregate
(`1` invocation), and parallel materialize (`64`-wide) as separate passes. Validate checks source, destination,
generation, exact Tower/Core target, and SDF placement into a bounded scratch record; it does not scan body
capacity per Subject. Aggregate gates the final materialization, so no body mutation occurs unless every record
is valid. CPU maps only the fixed 64-byte aggregate. The lease header is 176 bytes, validation records are
32 bytes, and the complete profile remains at most 9 storage buffers per shader stage.

Generation selection is strictly `sourceGeneration < generationLimit`. `limit - 1` is eligible and writes a
child at `limit`; a source already at `limit` is excluded without recovery. Exact Tower target is preferred,
then the canonical GPU Core proxy handle, then facing fallback.

This implementation is deliberately Enemy-only. Tower Payload, Tower group broadcast/share, other actor nouns
and verbs, full modifier grammar, and general-purpose child allocation remain future extensions.

## 1. Existing foundation

The current GPU World already owns Tower, Core proxy, enemies, Basic Bullet, collision, health storage,
lifetime, typed contact/death events, exact identity, stable slots, bounded readbacks, source-relative
aim, and session recovery. New gameplay must extend these public seams rather than reintroducing CPU
physics or full-body readback.

Current R2 production runs Body ABI v8. Established primary body-plane strides and the versioned 40-byte
`CombatState` side-plane remain stable; `CombatState` carries target interaction layer policy, Maximum Damage
Window duration/peak/expiry, winning source provenance, and reserved expansion fields. A new versioned 80-byte
`EnemyBehaviorState` side-plane carries one mutually exclusive Arrow charge, selected-target-projectile, or
Octagon Tower-orbit program. BodyControlProgram
v2 uses 96-byte command records and 64-byte result states; SpawnProgram v4 uses 96-byte records. Host/WGSL
version or stride mismatch fails closed. The dedicated maximum-damage-window compute profile uses 9 storage
buffers, contact handling remains 9, and the platform/device requirement and global maximum stay exactly 9
buffers per shader stage.

Turn 3 adds a separate versioned Effect Runtime ABI rather than expanding `EnemyBehaviorState`. The GPU owns
bounded A/B Effect-instance pools, per-body Effect Summary, and per-body PEmitter state. The endpoint owns one
bounded generic Effect command owner, and `GameObjectSystem` owns one Pentagon exact-handle SoA director.
Effect passes remain at or below 9 storage buffers per shader stage, and no Effect-instance or body-state
frame readback is introduced.

Turn 4 adds independent Formation ABI v1, also without expanding `EnemyBehaviorState`. Its byte authority is
80-byte body state, 48-byte candidate state, a 48-byte prepare header plus 144-byte records, and a 64-byte
transform header plus 192-byte records. The peak storage profiles are prepare-select `9`, transform-auxiliary
`8`, and render `8`; the platform maximum remains 9.

Turn 5 kept Body ABI v6 and the 80-byte behavior stride. Program 3 aliases the existing behavior bytes for
O's exact Tower target, single facing, radius, `RING_SLOTS` lease, Q32 step, integer reduction, and 3/8 facet
configuration; `CombatState` reserved words remain zero. Lifecycle materializes the raw unassigned slot into
one fixed lease and stores the same primitive lease in `WorldRegistry`. Host packing begins in `SEEK_TOWER`
with invalid target/zero flags. A valid Tower keeps route flow while publishing exact target/facing, and only
an inclusive tick-start radius-6 capture enters `ORBIT_TOWER`, disables flow, and activates defense. The phase
uses a west-facing `0x80000000` base plus slot eighth-turn and global fixed-tick step; radial-angle settling is
bounded and never crosses the Tower center. GPU orbit uses the existing
enemy-behavior profile, while the predicted-position contact classifier uses a dedicated exact profile; each is
8 storage buffers. Contact handling stays at 9: classification writes a
tick-local quiet-NaN marker only after contact generation, then the existing handler validates target/team,
reserves source budget, subtracts the fixed reduction, and resolves or emits an observable zero-value absorbed
hit. Rendering reads the same behavior-facing value only after capture; no CPU Tower pose or duplicate facing
plane is allowed.

Turn 6 advances only the shared circle-body version to ABI v7. Existing primary/Combat/80-byte behavior
strides remain unchanged. J/C′ owns a separate 48-byte persistent `AtomicTransformState` plus a 16-byte
tick-local first-hit candidate plane; it never consumes `CombatState` reserved words or the exclusive behavior
union. Program/phase vocabulary is `J_SPLIT_FIRST_HIT`/`C_PRIME_DELAYED_RECOMBINE` and
`ARMED`/`SPLIT_PENDING`/`CHILD_DELAYED`/`TRANSFORM_ARMED`. Atomic Transform Runtime ABI v1 uses prepare
`32 + 64N` and transform `48 + 80N` byte layouts. Its storage profile is prepare `5`, transform bodies `9`,
state `7`, auxiliary `9`, control `5`, Effect rekey `3`, required maximum `9`; the platform maximum does not
increase. The separate atomic first-hit contact profile is exactly 9 transitive storage bindings; the existing
contact profile remains 9 and does not import the AtomicTransformState plane.

Turn 7 advances only the shared body version to ABI v8. Existing primary/Combat/80-byte behavior and
AtomicTransformState strides remain unchanged. R and capturable projectiles use an independent 48-byte
bilateral `ProjectileCaptureState` plus a 16-byte tick-local candidate plane. The Simulation
`PROJECTILE_CAPTURED` bit is an exact mirror used by existing movement/grid/contact/solver/source/render paths,
not peer/timer/provenance authority. Projectile Capture Runtime ABI v1 uses 64-byte capture and release headers,
96-byte completion and release records, a 32-byte profile, and a 16-byte Tower-target config. All compute and
R render layouts stay at or below the platform maximum 9 storage bindings; no full-body frame readback is added.

Turn 8 keeps Body ABI v8 and adds independent Route Runtime ABI v1 rather than extending the behavior union.
Per-body route state is 64 bytes. The immutable compiled topology begins with a 96-byte header; GPU availability
uses a 64-byte header plus 32-byte exact-lease records, and lifecycle cleanup uses a 32-byte header plus 32-byte
records. Route advance/finalize share a 9-storage profile, so the platform maximum remains 9. Optional graph-null
maps use a disabled/all-open topology and retain their existing flow behavior.

Turn 9 keeps those ABIs and completes the producer-neutral J hit seam, dedicated `jorang` presentation,
EffectDefinition-owned transfer distribution, inbound Ring capture/capacity rejection, exact O future-policy
metadata, injection-only showcase content, Cork/Formation cross fixtures, and the final acceptance orchestrator.
The 2026-08-12 cumulative runner exited `0`: changed-production syntax passed `38/38`, full Node passed
`1402/1402`, default actual WebGPU plus all nine explicitly selected stages passed, both WASM checks and flow
stress passed, audited render golden and both title GPU smokes passed, diff hygiene passed, and the version-2
single-device/session O/J/R/Z/H/P/projectile churn completed all three cycles. Every hardware receipt directly
reported NW.js `0.108.0`, effective storage maximum 9, `uncapturedErrorCount=0`, and orderly `destroyed`
teardown. Full/Arrow/Maximum/Rhom additionally reported NVIDIA Lovelace with adapter limit 10; Ring/Cork
explicitly reported adapter/requested/device `10/9/9`. The global per-stage maximum remains 9.

The public backend seam is:

```text
stageEffectPulseProgramBatch
drainCompletedEffectProgramBatches
cancelPendingEffectProgramsForTerminal
getEffectRuntimeStatus
```

All P sources due on one fixed tick form one ordered command identity, but host validation, exact private
handle-to-slot revalidation, capacity demand, and mutation are atomic per pulse. Each pulse reports `APPLIED`,
`ZERO_TARGET`, `SOURCE_INVALID`, or `DEFERRED_CAPACITY`; an admitted earlier pulse may commit while a later pulse
defers, but no pulse may partially apply its target set. The endpoint resolves one shared capacity (`explicit`
or `min(bodyCapacity, 256)`) for owner and backend. Command/replay evidence binds session, target tick, exact
source handle, pulse sequence, ordered-source fingerprint, device generation, and authoritative epoch. Protocol
comparison is hierarchical (`session → device → epoch`), not component-wise.

Candidate/instance/event demands are admitted in deterministic rotating sequence order. A
`DEFERRED_CAPACITY` pulse has zero candidate/application/event mutation, advances neither its logical sequence
nor cadence, keeps `recovery=false`, and retries with that same sequence; rotating the next admission origin
provides starvation-free progress under repeated pressure. Program capacity, ABI/record corruption,
instance-ID exhaustion, or partial/mixed evidence is hard recovery. A valid single pulse whose demand exceeds
the current candidate/instance/event capacity is `DEFERRED_CAPACITY`, does not block smaller later pulses, and
remains retryable until capacity or its live target set changes.

The Formation backend seam is:

```text
stageFormationPrepareBatch
drainCompletedFormationPrepareBatches
armPreparedFormationTransformBatch
commitArmedFormationTransformBatch
cancelArmedFormationTransformBatch
cancelPendingFormationProgramsForTerminal
getFormationRuntimeStatus
```

The host passes exact handles, never public slots. GPU prepare for source tick N creates no body mutation and may
be published only at N+1. The lifecycle owner alone receives the privileged transform port; `WorldRegistry`
requires a private authority and opaque generation-bound single-use preflight token. One authentic lifecycle
commit atomically removes two sources and activates one destination before the armed GPU transform is committed
in that boundary's submit. A post-publication GPU mismatch is hard recovery, never CPU rollback.

The independent Atomic Transform backend seam is:

```text
stageAtomicTransformPrepareBatch
drainCompletedAtomicTransformPrepareBatches
armPreparedAtomicTransformBatch
commitArmedAtomicTransformBatch
cancelArmedAtomicTransformBatch
cancelPendingAtomicTransformProgramsForTerminal
getAtomicTransformRuntimeStatus
```

The public endpoint exposes `getAtomicTransformCommandPort()` and commits completed programs only at a fixed
boundary. `JorangSplitLineageDirector` submits bounded prepare records for current pending/due sources, consumes
only authentic T-1 prepare evidence, and promotes at most four actual J-lineage lifecycle starts per fixed tick.
C′ returns sort before J splits, followed by due tick, lineage root pair, and source exact handle ascending.
GPU first-hit admission is deliberately not limited by four; a fifth same-tick ENTER_ONLY winner remains
PENDING/backlogged and starts on the next boundary rather than being lost to sustained overlap.

The Projectile Capture endpoint seam is:

```text
getProjectileCaptureCommandPort
commitCompletedProjectileCaptureProgramsAtFixedBoundary
commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary
getProjectileCaptureRuntimeStatus
getTerminalProjectileCaptureProgramCancelStatus
```

The frozen command port exposes only `requestPreparedReleaseBatch`, `discardPreparedBatch`, and
`requestTerminalHeldProjectileDespawn`. Capture completion snapshots carry exact ABI/session/device/epoch/
source/completed-through/status/error/fingerprint/pending/protocol fields plus typed captures, release
preparations, and cleanups. Release snapshots carry the same authentication header plus publication tick and
15-field `releaseCompletions`. Normal proof is T-1→T; terminal proof is exact T. Canonical replay caching is
device/epoch guarded, and a pending or `commitRequested` program must never be hidden behind an older idle
snapshot.

Capture itself changes bilateral GPU state and host roster only. Release uses a privileged lifecycle request
and a private `WorldRegistry` active-metadata mutation authority. The one-shot token binds exact handle,
record/metadata object identity, metadata revision, immutable origin provenance, next primitive metadata, and
the authenticated backend evidence. The backend is armed before registry publication and committed after it;
pre-publication failure cancels without mutation, while post-publication failure is recovery. The body remains
in the same slot/entity/incarnation throughout.

No-Tower release continues to use stored forward with a null target handle and never synthesizes Core targeting from
`PLAYER_DAMAGEABLE_AND_TERRAIN`. Immutable logical projectile/origin provenance remains available for a future
GPU Subject/Sentence runtime to continue Fireball relationships; the current runtime does not claim end-to-end
Sentence execution.

Capture match additionally requires strictly closing relative velocity; inclusive funnel overlap while outbound
is rejected. Capture-completion and release capacity exhaustion are normal whole-batch zero-mutation results:
`recovery=false`, no bilateral/metadata mutation, and retry or data-owned backoff on a later tick. ABI, identity,
fingerprint, or bilateral corruption remains recovery. Capture preflight may write only the transient
`PROJECTILE_CAPTURE_PREPARED_SHIELD` marker so generic damage cannot run before late seal; even capacity rejection
must leave all persistent capture and metadata state unchanged. Actual hardware acceptance distinguishes
inside-inbound, boundary-inbound, outside, and inside-outbound.

When at least one captor exists but there is no capturable projectile and no HELD/release/retry maintenance,
the backend publishes an authenticated zero-capture completion without allocating or mapping a capture readback.
This advances the exact source watermark only; it may not invent a capture, mutate bilateral state, or hide
maintenance work. The endpoint validates the same ABI/session/device/epoch/source tick as an ordinary completion.

Route Runtime compiles optional routeGraph v1 indices from the existing Flow Field atlas and reads the same
immutable stage goals/directions. It never edits TileMap blocked cells, SDF data, or flow planes. One GPU
availability record moves `OPEN → LEASED → CLOSED → OPEN` under an exact owner slot/entity/incarnation/
lease generation. The authenticated bounded completion stream publishes assignment, close, reopen, and cleanup
facts; `CorkRouteClosureDirector` mirrors them only after graph-content/session/device/epoch/tick/version/
fingerprint and roster cardinality validation.

Natural `basic_cork_01` is a single common-C circle with helper count 0. It remains a hostile Enemy noun through
interaction metadata/hostile Team regardless of physical `bodyLayer`. It anchors at its leased entrance and
visibly expands for 60 ticks to radius 3 while physical pairing remains nonblocking. Only the completion boundary
publishes availability `CLOSED` and enables the Enemy/Tower-only `ROUTE_BLOCKER` together. Projectile physical pairing is
excluded, while ordinary projectile→Z damage and self-hit/penetration consumption remain enabled. Actor route
state chooses an open routeSet candidate, switches only at an authored forward transition, or advances to
clearance and waits with other capabilities intact. All-closed future spawns remain host-backlogged rather than
being published with a stale path.

A formation command that has started materialization retains its original selected path for every unpublished
remaining entry. Closure preserves the whole remaining group/rows as one backlog and publishes no partial row 0;
reopen submits that remaining entry on the same path in one batch. This does not disable the ordinary runtime
reroute policy for actors already published. Any future remaining-formation reroute policy must move the whole
remaining formation atomically.

A CLOSED steady state still executes Route Runtime GPU passes so the GPU remains authoritative, but it does not
map a route readback when all exact leases are closed, no route cleanup or terminal submit is staged, and no
physical projectile has an interaction mask capable of affecting Enemy. The backend publishes a zero-event
completion with `readbackBypassed=true`, the immutable final records, and the exact queue-front source tick.
The endpoint may accept it before the generic event stream catches up only when current runtime status independently
reports the same source tick and `readbackBypassEligible=true`, and only with event base/count `0/0`. A normal GPU
readback, a terminal batch, projectile threat, cleanup, mismatched marker, or mismatched source tick keeps the
original generic-event coherence gate and fails closed on contradictory evidence.

## 2. Ability metadata

R3 uses GPU-resident or GPU-queryable metadata for Enemy Subject/Payload execution. Tower share and broader
actor-state fields in this list remain future consumers:

```text
teamId
archetypeId / definitionId
tagMask
owner entity/incarnation
source ability ID
source execution ID
generation
Tower share (fixed-point)
target policy
actor state/motion mode
bounty/siege references or stable definition lookup
enemy profile IDs and stable capabilityMask
```

Do not conflate this with physical/interaction layers.

## 3. GPU subject selector

Large sandbox sentences cannot read all subject positions back to CPU.

Current R3 command concept:

```text
AbilityExecutionCommand
- exact compiled ability/program ID
- subject selector
- world aim point / target parameters
- execution ID
- subject limit/budget
- generation limit
```

GPU responsibilities:

1. Freeze eligible subjects at execution start.
2. Determine deterministic subject order.
3. Resolve action/payload from authoritative GPU state.
4. Reserve/allocate generated bodies atomically.
5. Prevent generated bodies joining the current execution.
6. Emit bounded critical outcomes.

The current completion is aggregate-only: authenticated ABI/session/device/epoch/execution identity, selected
count, ordered-set fingerprint, source-generation range evidence, and capacity/protocol status. Exact subject
records stay GPU-resident for the matching materialization transaction. Zero subjects is a successful no-op;
it consumes no cooldown. Snapshot protocol mismatch or stale generation is recovery.

## 4. GPU child identity and allocation

The current CPU-preleased source-relative/selected-target SpawnProgram is sufficient for low-rate Basic
Bullet, Archer, and Diamond M, but not for `Enemies shoot The Tower` with hundreds of subjects. M's Program 2
activation is bound to same-source/tick BodyControlProgram evidence and one preflighted destination; it is not
a general GPU child allocator.

R3 Enemy-only extension:

- GPU-resident child slot allocator or bounded preleased range;
- exact entity/incarnation allocation contract;
- all-or-nothing batch result;
- priority/reserved capacity for persistent Tower/Core/enemy actors;
- no per-child JS object;
- no per-child result readback;
- aggregate completion plus critical identity events.

The R3 endpoint implements this as a bounded actor-payload prelease/materialization ABI. True body-capacity
shortfall is an exact 0/N normal rejection; temporary event/telemetry backpressure retains the same snapshot and
retries after the completion boundary. Identity/ABI/generation drift is recovery. Registry publication records
GPU generation authority/provenance without reading every child generation back. General Tower/other-noun child
allocation is still future work.

## 5. Tower group command

Movement cannot enqueue one CPU command per Tower for hundreds of Towers.

Use a GPU selector/broadcast:

```text
team=PLAYER AND tag=TOWER AND alive
→ apply shared move intent
```

Aim is one world point; each Tower resolves direction from its own position.

## 6. Tower share representation

Use deterministic fixed-point share units, for example a large integer budget, rather than repeated
unbounded f32 division.

Requirements:

- conserved total;
- deterministic division/remainder policy;
- no share creation on split/merge;
- exact death transfer to Lost Share;
- CPU and GPU representations agree;
- preview uses the same allocation implementation.

The exact scale is `OPEN` and must be capacity-tested for hundreds of Towers.

## 7. Split transaction

Atomic domains:

```text
source snapshot
child capacity reservation
new share/current HP calculation
parent mutation
child activation
CPU ledger commit
```

Normal capacity rejection is not GPU recovery. Protocol/identity mismatch is recovery.

Turn 6/9's concrete split is canonical J `ONE_TO_MANY`, not the future Tower-share split. Admission is the
producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT` one-shot seam. Its ABI is source body, damaged target, final
positive damage, producer kind, producer-policy-already-validated, and expected phase; projectile identity and
contact-budget fields are not common-seam requirements. The currently connected projectile producer invokes it
only after exact `CLOSEST_ONLY`, team/target, positive reservable self-hit budget, and final-damage validation.
Explosion, Effect, direct, and melee are independently callable future producer kinds after their own policies,
but are not claimed as implemented/executed. The accepted hit transitions to `SPLIT_PENDING`; subsequent
same-valid hits are damage-0/budget-0/event-0 until success, terminal, or cancel.

Publication consumes one J and creates exactly two transform-private C′ bodies or mutates nothing. Both copy
the source's exact GPU pose/velocity/flow and start fresh full common-C HP `1/1`. Exact uint32 bounty splits
child0-ceil/child1-floor, including `1→[1,0]` and `0→[0,0]`; every exact active Effect instance rekeys exactly
once according to its own `EffectDefinition.atomicTransformTransferPolicy`. Penta Boost uses
`stable-instance-id-modulo-destination-count`, selecting `instanceId % destinationCount`; the legacy destination
record word remains reserved zero and does not select child 0. The natural root exact `(entityId, incarnation)` pair survives; `branchIndex` is transaction-local order
`0/1`, not a global lineage ID.

Each C′ independently uses `ONE_TO_ONE_DELAYED` exactly 60 fixed ticks after publication. Authentic prepare
at `T-1` alone permits publication at `T`; the returned J preserves exact pose/velocity/flow, current/max HP,
Effect instances, branch bounty, root pair, and local branch order. Two/one/no survivor yields two/one/no J.
Core impact consumes the branch without bounty or return. A pending prepare readback is the authoritative
`T` publication prerequisite: the fixed world stalls/retries that same `T`, but this is not recovery. Normal
capacity rejection is different: it consumes the current `T` attempt identity/proof, keeps J PENDING/logical
backlog with no half child or recovery, and stages a fresh prepare at the end of `T` for a new proof/command
at `T+1`. It never replays old evidence.

## 8. Merge transaction

- exact compatible source handles, registry views, Formation state, HP, lineage, and prepared GPU protocol;
- each H transform consumes exactly two live bodies and creates one composite destination;
- n2..5 uses transform-private `basic_hexa_group_01`; n6 uses transform-private
  `basic_hexa_hive_01`; natural group/HX spawn is forbidden;
- signed-int32 centi-HP current/max each use `sum + trunc(sum / 10)` once, with complete
  overflow/alive/current≤max preflight;
- fixed absolute n-table stats apply from natural n1; Tower-contact attack changes, Core impact remains 1, and
  bounty budget is `[1,2,4,6,8,10]`;
- ordinary death/Core cleanup wins before publication; successful sources use `MERGE_CONSUMED` or
  `TRANSFORM_CONSUMED` without kill bounty;
- sorted original exact lineage handles are retained in the bounded host SoA; lineage hash is correlation only;
- every target-tick half-open active Effect instance is universally rekeyed in place to the destination with
  exact ID/incarnation/source/applied/expiry preserved; prepared/actual rekey counts must match;
- any preflight/arm/publication-before-commit failure is zero-partial. Failure after CPU publication is recovery.

## 9. Team and target queries

Hostile projectiles need Tower target selection entirely from GPU authoritative state. Avoid a CPU
Tower target buffer populated by frame readback. If a compact GPU buffer is used, it is generated on
GPU from live Tower metadata.

CPU may receive a bounded group summary for camera/UI only.

The current M slice passes explicit exact Core/Tower handles without pose. BodyControlProgram v2 performs
tick-start center-distance, inclusive-range selection as Core first, then Tower, then none. It persists the
source's stopped state while a target remains selected and restores route movement when none is in range.
SpawnProgram v4 activates the projectile only from the matching control result/fingerprint.

## 10. Event policy

CPU readback should be limited to domain-critical events:

- Tower death and exact share metadata reference;
- Enemy death/bounty;
- Core hit/damage request;
- actor creation transaction result;
- split/merge result;
- wave-critical hostile-count changes if not computed GPU-side;
- diagnostics/aggregates.

Ordinary projectile hits that require no CPU domain mutation should remain GPU-local.

M's selected Core projectile produces a typed, positive, exact-provenance CPU Core damage request; GPU Core
health is never introduced. The exact source need not remain alive when a completed authenticated request is
consumed, but generation/epoch, source definition/capability/profile, target handle, tick/sequence/fingerprint,
policy, and dedupe identity must all validate before Core mutation.

Ordinary contact/projectile and Arrow `DAMAGE_APPLIED` records carry the actual HP delta after same-tick
maximum aggregation and the Maximum Damage Window, including zero for a valid suppressed candidate. The same
Tower/source-tick winner is selected independently of append order by final damage descending, then source
entityId/incarnation ascending. Raising an active peak applies only the delta and resets expiry to the winning
tick plus 60; a value at or below the peak applies zero and preserves expiry. Valid projectile contacts consume penetration/self-hit budget before this
target-side window; hit rejection (friendly/stale/invalid/miss/capture/reflect) consumes nothing.

M's exact selected-Tower projectile preserves its immutable launch-time target/damage/budget snapshot, and
source death after launch does not invalidate it. After target and hit-budget validation it enters the same
same-tick maximum and Maximum Damage Window as Enemy contact, Arrow charge, and Archer projectile candidates;
its event therefore reports `maximumDamageWindow=true`.

Effect Summary never becomes a new base-damage authority. GPU contact/direct handlers recompute from immutable
authored/resolved base damage each tick, while a projectile snapshots its resolved channel damage once at
spawn. `Attack` and P Boost attack multiplication apply to Tower contact, Tower projectile, direct Core impact,
and projectile Core channels. A narrower exception needs its own named data flag. A generic target-layer bit
alone is not proof of a Tower damage channel. SpawnProgram materializes channel identity only after live
source/target definition and policy checks; M continues to use its GPU selected-target evidence. Direct Core
impact conversion is isolated in `resolve_direct_core_damage_requests`, whose profile uses at most 8 storage
buffers, while typed Core requests remain CPU-domain mutations rather than fictitious GPU Core HP.

## 11. Capacity and priority

No low design cap is imposed, but technical capacity is bounded.

Recommended pool budgeting:

```text
persistent reserve: Core, Towers, bosses, required structures
hostile actor reserve
projectile/effect elastic budget
```

A projectile flood must not prevent a required Core proxy or existing persistent Tower transaction.
Capacity preflight must report exact required/available counts.

## 12. Recovery

On GPU generation replacement:

- preserve Core Integrity, Gold, words, Sentence Board, TowerShare ledger, wave/map/run state;
- preserve only committed Tower HP from GPU Tower combat state;
- initialize a fresh transient Tower Maximum Damage Window (do not restore peak, expiry, or provenance);
- initialize fresh Effect A/B pools, per-body summaries/PEmitter state, Pentagon roster/cadence, pending Effect
  programs/readbacks, and bounded Effect presentation status;
- initialize fresh Formation body/group state, exact-lineage roster, prepared/armed programs/readbacks,
  registry transaction authority, HX status, and Formation presentation summary;
- initialize a fresh AtomicTransformState plane, J first-hit pending/C′ due roster, prepared/armed
  programs/readbacks/transactions, command generation, and Atomic Transform presentation/status summary;
- initialize fresh ProjectileCaptureState/candidate planes, R held/release roster, capture/release
  programs/proofs/readbacks/replay caches, metadata-revision mutation authority, and capture status summary;
- initialize fresh RouteRuntime body state, all-open availability/lease records, Cork roster, cleanup/readback
  evidence, Wave availability mirror/backlog binding, and route-runtime status summary;
- discard transient bodies and pending executions;
- restart at a safe wave boundary until authoritative checkpointing exists;
- reject old generation events/results/poses;
- never continue GPU Tower physics from stale CPU pose;
- do not recreate Lost Share as living stats.

Current R3 concretely preserves `GoldLedger`, `WordSystem`, all five slot assignments, and committed cooldown
state in the CPU run domain. It cancels/revokes the old GPU-world `AbilityRuntime` subject snapshots and
`ActorPayloadMaterializer` prelease/materialization transactions, then binds fresh runtime/director/tracker
owners to the replacement endpoint. No transient actor child is reconstructed from CPU data. TowerShare remains
future state despite its place in the long-term preservation list above.

Old Atomic Transform and Projectile Capture endpoint/owner/director/transaction ports and generation-qualified
callbacks are revoked. Old Route Runtime/director/availability ports are revoked too. No J/C′ lineage, PENDING
state, held projectile, release transaction, closed route, or Z lease is reconstructed into the replacement world.

## 13. Fixed-step ordering target

```text
completed fixed/SpawnProgram outcomes
→ completed Projectile Capture/release evidence drain and coherent source-tick watermark gate
→ completed Atomic Transform first-hit/prepare/transform evidence drain and exact J/C′ lineage preflight
→ completed Effect batch/event drain and exact provenance/cardinality preflight
→ completed Formation prepare/transform evidence drain and exact protocol/lineage preflight
→ completed Route Availability assignment/close/reopen/cleanup evidence drain and exact Z lease mirror;
  an authenticated closed-steady zero-event queue-front may commit independently while generic events catch up
→ generic gameplay event drain only after capture evidence publication for the same source tick
→ CPU domain event commit
→ exact Core-impact damage and authenticated cleanup staging
→ Core depletion check; close gameplay ingress immediately when depleted
→ if depleted: versioned exact fixed-program cancel/tombstone + destination/control lease retirement
→ if depleted: versioned Effect-program cancel, pending readback retirement, and final P roster observation
→ if depleted: versioned Formation prepare/arm/readback cancel and final Formation roster observation
→ if depleted: versioned Atomic Transform prepare/arm/readback cancel and final J/C′ roster observation
→ if depleted: versioned Projectile Capture prepare/release cancel, unpublished-held cleanup, and final R roster observation
→ if depleted: versioned Route Runtime ingress/cleanup/readback cancel and final all-open Z roster observation
→ input/ability commands
→ WordSystem activation drain and aggregate GPU subject snapshot
→ ActorPayloadMaterializer exact 0/N identity/body prelease
→ exact Arrow/M behavior/control production
→ if running: one ordered Pentagon command with per-pulse atomic/fair capacity admission
→ if running: one whole-tick Formation prepare batch stage
→ if running: one bounded J/C′ Atomic Transform prepare batch stage
→ subject snapshots
→ lifecycle/child reservations
→ R3 Enemy actor-payload publication/materialization; completion alone settles cooldown
→ on-time N→N+1 privileged atomic Formation publication and armed transform commit
→ authentic T-1→T J split/C′ return publication, capped to four J-lineage starts
→ authentic T-1→T same-identity projectile release metadata CAS and armed backend commit
→ source/action resolve
→ Effect expiry/summary/regen and pulse instance application
→ movement/AI
→ Route Runtime selection/forward-reroute/clearance-wait and Z expansion
→ Projectile Capture inbound match/preflight and transient prepared shield
→ collision/contact/final damage
→ every valid Tower producer: same-Tower/source-tick final-damage maximum aggregation
→ common Maximum Damage Window (higher peak resets expiry) → GPU HP mutation
→ death
→ Projectile Capture late whole-batch seal or zero-mutation capacity rejection
→ Route Runtime exact availability + physical blocker close/reopen/finalize
→ fixed submit
→ bounded presentation/domain readback
```

Exact pass decomposition must preserve storage-buffer limit 9 unless platform support policy changes.

At the Core-depletion boundary, close/revoke covers CPU queued requests, reservations, pending commands, the
exact destination/control set whose fixed programs are already GPU-submitted or readback-pending, and every
Effect, Formation, Atomic Transform, Projectile Capture, and Route Runtime program/lease. Work that has not reached registry/host publication is
version-canceled/tombstoned; generation-qualified late callbacks are no-ops. An Atomic J split or C′ return
whose lifecycle transaction is already published and whose backend receipt is `commitRequested` is not rolled
back. The same applies to a lifecycle-published projectile release. The terminal final submit completes that
GPU transform/release and starts/settles its async readback. Unpublished held projectiles use the privileged
terminal cleanup ledger. Unpublished pulse emission, Effect regeneration, Formation transform, J split, C′
return, and projectile release do not start on that submit.

Normal gameplay producers remain skipped, but the already authenticated Core-impact Enemy cleanup is included
in that boundary's one lifecycle commit. `SEALED` requires matching fixed-program, Effect-program,
Formation-program, Atomic Transform, Projectile Capture, and Route Runtime evidence: ABI and final/submitted tick match, submitted count matches
the armed/published count, prior and current readbacks have settled, pending program/readback counts are zero,
and final Pentagon/Formation, J/C′, R, and Z rosters preserve both fixed/lifecycle observations with no stale source;
route availability must be all-open.
Cancel/submit/readback failure or any missing/partial/mismatched evidence produces `SEALED_FAILED`; it must
never be reported as a successful terminal boundary. After either terminal state, presentation/draw/status keep
the last committed snapshot; a successful seal freezes the last completed fixed tick, presentation reference
clock, and camera-follow snapshot so terminal draws cannot extrapolate. A stale cleanup port or raw
fixed-command owner must not reopen ingress.
