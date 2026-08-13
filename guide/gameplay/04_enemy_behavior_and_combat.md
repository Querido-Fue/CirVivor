# 04. Enemy Behavior and Hostile Combat

## 1. EnemyDefinition separates navigation and engagement

R2 runtime stores this separation as immutable profile references plus stable capability IDs:

```text
EnemyDefinition
├─ shapeDefinitionId
├─ physicsProfileId  → collisionRadiusTiles, weight, pairCollisionRadiusScale
├─ combatProfileId   → maxHealth, towerContactDamage, coreImpactDamage, bountyBudget
├─ behaviorProfileId → navigation/target/fallback/formation policy
├─ atomicTransformProfileId → exact profile-discriminated topology/policies or null
└─ capabilityIds     → stable capabilityMask at spawn/registry
```

The universal live capabilities are `enemy-contact-combat` and `enemy-core-impact`; Archer/M also use the
current targeting implementation, only `basic_arrow_01` uses `enemy-charge`, only Pentagon P uses
`enemy-effect-emitter`, H/group use `enemy-formation` plus `enemy-atomic-transform`, and HX retains
`enemy-formation` without another transform capability. Natural J and transform-private C′ use
`enemy-atomic-transform` through a distinct Jorang lineage roster. The implementation router accepts only the
canonical H natural/group, J natural, and C′ private profile families and rejects arbitrary atomic profiles.
Natural Cork Z alone uses `enemy-route-closure` through the independent RouteRuntime/availability domain.
`EnemyCapabilityRegistry` validates real implementation seams and the
minimal `IEnemyLifecycleObserver`, `IEnemyFixedCommandProducer`, and `IEnemyGameplayEventConsumer` ports.
Do not create per-Enemy JavaScript controllers or empty classes for future capability vocabulary.

```yaml
navigation:
  objectivePolicy: core | tower | route_then_core | structure_then_core
  pathPolicy: assigned_route | free_navigation

towerEngagement:
  policy: ignore | harass_in_range | hunt | intercept | block_and_attack
  aggroRange: ...
  chaseRange: ...
  physicalResponse: pass_through | separate | block

attack:
  action/compiledSentence
  cooldown
  windup
  targetPolicy
  targetSnapshotPolicy

coreAttack:
  policy
  damage
  interval
```

AI chooses intents. Combat/domain owners apply HP/Core mutation and lifecycle transitions.

## 2. Baseline behavior families

### Corebound

- follows assigned route to Core;
- ignores Towers for targeting;
- targeting policy does not disable the current weight-based Tower physical pair or universal contact damage;
- attacks Core after reaching the Core attack area.

### Corebound Harasser

- keeps route/Core movement objective;
- attacks a Tower in range;
- does not chase off route;
- resumes/continues route after windup or attack.

### Tower Hunter

- selects a living Tower and leaves the route;
- retargets deterministically if target dies;
- falls back to Core when no Tower exists.

### Interceptor

- follows route normally;
- temporarily chases a Tower entering aggro range;
- returns to route when leash/time expires.

### Structure Sapper

- prioritizes blocking/player structures;
- then returns to Core or Tower policy;
- structure priority does not imply automatic Tower targeting.

### Artillery

- moves to authored firing position or range band;
- uses Throw/area attacks on Tower or Tower-group target;
- falls back to Core when no Tower is targetable.

## 3. Behavior-family design targets

| Enemy | Movement objective | Tower behavior | Attack |
| --- | --- | --- | --- |
| Walker | Core | ignore target / weight pair | Core attack only |
| Hunter | Tower, then Core | hunt | repeated melee or short-range hit |
| Archer | Core route | harass in range | hostile Bullet toward Tower |

R2 Turn 2 concrete production mapping is:

| Enemy | Resolved movement/combat | Current behavior |
| --- | --- | --- |
| C | HP `1`, speed `2.5`, weight `1`, Tower/Core damage `0.1/1` | ordinary Core route/contact |
| T | HP `0.7`, speed `3.5`, weight `0.6`, Tower/Core damage `0.1/1` | fast/light Core route/contact |
| A | speed `2.5`, stable `enemy-charge` capability | exact-Tower charge loop, then Core route fallback |
| M | Core-first inclusive range `8` | stop, selected-target projectile, resume route when no target |
| Archer | Core route | exact living-Tower hostile Bullet; no Core fallback shot |
| H/HX | independent six-ring Formation domain | n1 natural H, atomic n2..5 group, n6 HX; Core route/contact |
| O | route-flow SEEK then data-owned radius-6 `RING_SLOTS` orbit | exact-Tower capture/tidal lock, 3/8 directional flat defense; latched Core fallback |
| J/C′ | common Core route, independent Atomic Transform domain | producer-neutral first valid positive-damage hit J 1→2 C′; each survivor returns 1→1 J after 60 ticks |
| R | common Core route, independent Projectile Capture domain | one valid inbound/closing player projectile held, then same-identity hostile release after 60 ticks |
| Z | common-C route-set entry, independent Route Runtime domain | exact route lease, 60-tick radius-3 expansion, forward reroute/clearance wait/reopen |

These are definition/profile/capability compositions, not shape-driven classes. Pentagon P uses the independent
Effect capability, H/HX use the independent Formation capability, and O pairs the basic behavior-union
`enemy-orbit` program with `enemy-directional-defense`. J/C′ uses an independent AtomicTransformState plane;
R uses an independent bilateral ProjectileCaptureState plane; Z uses an independent RouteRuntime state and
GPU availability plane. None extends the exclusive behavior union.

Arrow A stores `SEEK_TOWER`, `WINDUP`, `CHARGE`, `CONTACT_RECOIL`, `RECOVER`, and `CORE_FALLBACK`
in the GPU behavior side-plane. Windup locks one exact charge direction, so the charge does not home after
launch. Authoritative state drives the telegraph; an authenticated charge-contact marker enters common Tower
damage aggregation and applies recoil opposite that locked direction before recovery/repeat. Missing or stale
Tower identity returns A to Core route/direct fallback without CPU pose sampling.

Arrow gameplay selection, validity, charge, and aim now use the dedicated 16-byte exact GPU
`TOWER_GAMEPLAY_TARGET_CONFIG` binding. `tracked_pose_config` and its readback are presentation,
camera, and diagnostic-only; clearing or changing tracked presentation cannot select a gameplay Tower.

Arrow's direct Tower motion is conditional on a bounded terrain-SDF segment check. A wall-occluded SEEK keeps
the immutable route-flow authority instead of repeatedly steering into the wall, WINDUP rechecks the same
visibility before locking, and a terrain-blocked CHARGE enters ordinary recovery without manufacturing a
Tower contact/recoil/damage marker. CHARGE and CONTACT_RECOIL displacement use a fixed-tick finite difference
of the endpoint-normalized bounded Expo-out curve
`E(t) = (1 - 2^(-0.5t)) / (1 - 2^(-0.5))`. The curve preserves the authored total distance and phase deadlines;
render-frame cadence never owns gameplay movement.

Diamond M's selected-target spawn is bound to the same source/tick/selection fingerprint as its GPU control.
The Core branch emits typed CPU Core damage and never mutates fictitious GPU Core HP. The Tower branch must
match the exact selected Tower before consuming projectile budget and entering the common Maximum Damage
Window; a wrong/stale Tower is a rejected hit and consumes nothing.

Once a Tower-selected M projectile has resolved as a live body, its exact target identity, hit budget, and
attack damage are launch-time projectile authority. Later death/despawn of the source M removes only that
source and cancels only unresolved source work; it must not revoke, retarget, or zero an already launched
projectile. A later exact Tower hit therefore still enters the ordinary Maximum Damage Window and HP path.

### Octagon O orbit and directional defense

Natural `basic-octa-enemy` is an OCTA presentation over the ordinary circle physics body. The lifecycle owner,
not a per-O director, assigns one persistent slot from the fixed eight-slot spread order
`[0,4,2,6,1,5,3,7]`. Registry metadata and the GPU behavior record carry the same primitive `RING_SLOTS`
coordinate code, slot, and capacity. The raw public intent must carry the unassigned sentinel; duplicate,
partial, out-of-range, or definition/capability-mismatched active metadata is recovery corruption, while a
normal full ring rejects the whole due spawn batch before registry/backend mutation.

Host packing starts program 3 in `SEEK_TOWER` with invalid target and flags `0`. While the exact Tower remains
valid, SEEK writes that target and the O-to-Tower facing, sets only `TARGET_VALID`, and keeps authored route
flow enabled. Tick-start distance `<= Tower radius × 12 = 6` performs the one-way capture into `ORBIT_TOWER`,
turns route flow off, and activates directional defense. The 60Hz Q32 target phase is
`0x80000000 + slot × 1/8 turn + global fixed-tick step`, so slot 0 starts west of the Tower. Capture settling
rotates the current radial vector by a bounded shortest-angle step rather than steering along a chord through
the Tower center.

The direction from O to Tower is stored once in the behavior plane and, after capture, drives both OCTA
orientation/armor highlighting and hit classification. Before capture, shape presentation follows route
movement while the armor rim and directional classifier are inactive.
The inclusive front sector is three consecutive facets (`7,0,1`, or ±67.5° about facing). Its centi-int flat
reduction is applied after source/target/team validity and projectile/self-budget reservation; the result clamps
at zero with no minimum floor. A fully absorbed valid hit still consumes its source budget and emits a typed
zero-value directional event. Rear/side and zero-direction cases use normal damage, so returned or reflected
projectiles preserve their physical-origin counterplay.

Tower invalidation in either SEEK or ORBIT is normal behavior, not recovery. O keeps its lifecycle slot until despawn, latches
`CORE_FALLBACK`, clears exact Tower/defense state, resumes authored Core-route flow, and does not orbit the Core
or a later Tower in the same GPU world. Weight `2.5` supplies the ordinary physical shield/push response; no
CPU Tower pose, O group object, or special Tower imprisonment path exists.

This `LATCH_CORE_FALLBACK` behavior is the current single-Tower R2 baseline. Future Tower reappearance or
multi-Tower gameplay must reacquire on a Tower-roster change and choose the exact living Tower by lowest
entity ID, then incarnation; that policy is documented but inactive in the current runtime. Orbit lease capacity
is exactly eight, and showcase Wave 2 uses four simultaneous O actors. A >8 due batch is one
normal whole-fixed-tick rejection with zero registry/backend mutation and `recovery=false`; content retries by
data-authored staggering after a slot becomes available.

### Pentagon P and the independent Effect domain

P is not another `ENEMY_BEHAVIOR_STATE` variant. That union remains limited to one body's mutually exclusive
basic movement/attack program. Effect and current Formation state are independent capability domains.

The endpoint owns one bounded generic Effect command owner, while `GameObjectSystem` owns one
`PentagonEffectDirector` with an exact-handle primitive SoA roster and no per-P/per-effect JavaScript objects.
The GPU owns double-buffered A/B Effect-instance pools, one per-body Effect Summary, and one per-body PEmitter
state. Every P pulse due at the same `targetFixedTick` is staged in one deterministic whole-tick batch; every
preflight is zero-partial. A valid pulse with no eligible target still completes and advances that source's
cadence. Authentic `CAPACITY_REJECTED` caused only by candidate/instance/event or pulse-grid capacity is a
normal completion: protocol watermark advances, but sequence/cadence and HP/Summary/events do not, and the
logical pulse retries deterministically. ABI/record/program-capacity/instance-ID or mixed evidence is recovery.

Effect lifetime is half-open: an instance is active only while
`appliedTick <= fixedTick < expiresAtTick`; it is expired at `fixedTick >= expiresAtTick`. Independent Boost
instances are never collapsed into one refreshed timer. The active Boost count drives data-authored thresholds:

```text
1+ stacks → HP regeneration
2+ stacks → HP regeneration + attack multiplier
```

P navigation evaluates tick-start GPU state through a bounded spatial grid. Candidate clusters must remain
within the authored route/SDF reachability contract: same-stage integration cost may not increase, a later
reachable route stage is allowed, and reverse or unreachable movement fails closed. No CPU pose readback is
used. The Effect contract/catalog can describe Poison, Burn, and Freeze, but Turn 3 creates no empty production
runtime class for those future families.

Effect damage integration always starts from immutable base data. Contact-handler damage is recomputed from
the authored/resolved base each fixed tick, and projectile damage is snapshotted once at spawn; neither path
feeds a previously multiplied value back into the next tick. P's current Boost may modify Tower contact and
Tower projectile damage only through the explicit channel flags. Direct Core impact and typed projectile Core
damage remain unmodified.

Effect target nouns come from interaction metadata and Team, never from the current physical `bodyLayer`.
Consequently a Cork Z in `BLOCKING` remains a hostile Enemy eligible for P Boost even though its solver role is
`ROUTE_BLOCKER`.

### H/HX and the independent Formation domain

Natural `basic_hexa_01` starts as n1. Each successful transform consumes exactly two live H/group bodies and
publishes one transform-private destination: `basic_hexa_group_01` for n2..5, or
`basic_hexa_hive_01` for n6. All use shape `hexa`; group/HX behavior and presentation come from Formation state,
not shape switching. Direct authored group/HX spawn is forbidden.

`FormationRuntimeDirector` keeps a bounded exact-handle SoA roster and the sorted original lineage of 1..6
handles. The registry/GPU lineage hash is correlation only. GPU prepare at N may publish only at N+1 through
the privileged lifecycle/opaque single-use registry transaction; the one authentic lifecycle result contains
one destination spawn and both source despawns. Death/Core cleanup wins before publication.

Current/max signed-int32 centi-HP each merge as `sum + trunc(sum / 10)` after complete overflow/alive/current≤max
preflight. Absolute n-table stats apply from natural n1 through HX: only Tower-contact attack changes, Core
impact stays 1, and bounty budgets are `[1,2,4,6,8,10]`. Map/wave modifiers for H/HX are rejected. Every active
half-open Effect instance is independently rekeyed to the destination with exact ID/provenance/ticks preserved;
no aggregate, refresh, or silent loss is allowed.

### J/C′ and the independent Atomic Transform domain

Natural J keeps `basic_gen_01` as its compatibility identity but uses the analytic/legacy joraengi-rice-cake
silhouette: two regular-octagon lobes joined by one narrow connector from the shared legacy/title/ingame geometry
authority. It keeps the common C physics/route family and exact uint32 bounty `12`. It does not use the old `gen`
hollow-square presentation. C′ is transform-private `basic_circle_prime_01` (`circle`, TRANSFORM_PRIVATE) with common-C
HP/speed/weight/Tower/Core values `1/2.5/1/0.1/1`; it cannot enter authored waves or public spawn ingress.
The two canonical profiles are `jorang-one-to-many-01` and `circle-prime-return-delayed-01`. Their complete
topology/source/destination/trigger/kinematics/health/bounty/Effect/lineage/pending/forfeit combinations are
fail-closed, so individual known policy words cannot be recombined into a new runtime profile.

Turn 6 Body ABI v7 added a 48-byte persistent `AtomicTransformState` and 16-byte tick-local first-hit candidate
plane without changing `CombatState` or the 80-byte exclusive `EnemyBehaviorState`. Turn 9 generalizes admission
to producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT`. Its one-shot helper consumes only exact source body,
damaged target, final positive damage, producer kind, an already-validated producer-policy flag, and expected
phase; it does not require projectile identity or a contact-budget record. Projectile is the connected producer
and invokes this seam after its own `CLOSEST_ONLY`, exact team/target, positive reservable self-hit budget, and
final-damage validation. Explosion, Effect, direct, and melee can independently call the same seam after their
own policies, but those producers are not claimed as implemented or executed. The accepted hit moves J from
`ARMED` to `SPLIT_PENDING`; subsequent same-valid hits consume no damage, source budget, or event.

J publication is atomic 1→2. Both C′ children copy the source's exact GPU pose, velocity, and flow, but each
starts with fresh full HP `1/1`. Exact uint32 bounty splits child0-ceil/child1-floor, including legitimate
`1→[1,0]` and `0→[0,0]`. Every active exact Effect instance transfers exactly once according to its own
`EffectDefinition.atomicTransformTransferPolicy`. Current Penta Boost uses
`stable-instance-id-modulo-destination-count`, so destination is `effectInstanceId % 2`; no instance duplicates
and the legacy transform-record destination word remains reserved zero rather than selecting child 0. Lineage authority is the natural root exact `(entityId, incarnation)` pair. `branchIndex` is only the
local child order `0/1` for that split, not a lineage-global identifier.

Each C′ independently becomes due exactly 60 fixed ticks after publication. Authentic GPU evidence produced
at `T-1` may publish one 1→1 returned J only at `T`. That J preserves the C′ source's exact pose/velocity/flow,
current/max HP, exact Effect instances, branch bounty, root pair, and local branch index, then starts newly
`ARMED`. Two/one/no surviving C′ therefore yield two/one/no J. Core impact consumes the exact branch with no
bounty and no return.

GPU marker admission is independent of the host start budget. The bounded lineage backlog keeps every valid
trigger, while actual starts are ordered C′ return first, then due tick/root pair/source exact handle ascending,
and capped at four per fixed tick across J lineage only; H retains its separate Formation cadence. A pending
prepare readback is an authoritative `T` publication prerequisite, so the fixed world stalls/retries the same
`T` without entering recovery. Normal capacity rejection instead consumes the current `T` attempt, leaves the
exact source PENDING, creates no half child or recovery, and uses the fixed-tail prepare to author a fresh
proof/command for `T+1` rather than replaying old evidence.

These J contracts passed the explicitly selected `enemy-jorang-split-lineage` actual WebGPU stage and the
2026-08-12 final cumulative acceptance. Projectile remains the only connected producer; this result does not
claim execution by the future explosion/Effect/direct/melee producer kinds.

### Ring R projectile capture and same-identity release

Natural `basic_ring_01` uses analytic `ring` geometry, common-C stats, and profile
`ring-projectile-capture-01`. Body ABI v8 adds a 48-byte bilateral `ProjectileCaptureState` and 16-byte
tick-local candidate plane; the `PROJECTILE_CAPTURED` Simulation bit is an exact mirror only. The profile owns
one slot, a 60-fixed-tick delay, an inclusive ±45° funnel aligned to last nonzero route velocity, hidden held
presentation, continued projectile lifetime, preserved speed, and an exit outside both radii by 1/1024 tile.

A valid PLAYER projectile must carry capturable policy, enter the funnel, have strictly closing relative
velocity, and win the deterministic one-slot match. Merely overlapping inside the cone while outbound is not
capturable; inside-inbound, boundary-inbound, outside, and inside-outbound are separate acceptance cases.
Capture preserves its exact slot/entity/incarnation and immutable origin archetype/tag/modifier/
execution/generation/owner/source/target provenance. While held it is excluded from normal movement, grid,
contact, solver, source-control, and render paths. Bilateral peer slot/identity/role/phase/sequence and the
Simulation mirror are exact; partial or contradictory state is recovery corruption.

Capture-completion or release capacity exhaustion is a normal whole-batch zero-mutation rejection:
`recovery=false`, no bilateral state change, no metadata revision change, and a later retry/data-owned backoff.
ABI, identity, fingerprint, and bilateral-state corruption remain recovery. A transient prepared-shield marker
prevents the generic damage path from mutating a contact selected during preflight, including the capacity-reject
case, without becoming persistent gameplay metadata.

For the capture partition only, a retained rejected pair is deterministic fairness metadata rather than current
contact authority. Every retry clears ephemeral current-valid/peer-slot marks and reauthenticates the current
directed contact, exact live identities, predicted positions, captor facing, relative velocity, inclusive funnel,
and strict-closing dot before demand, rank, prefix, or commit. A no-contact, outside, outbound, dead, reincarnated,
or old-generation pair therefore captures nothing and leaves retry normally; already-HELD release/cleanup keeps
its separate persistent bilateral validation.

Release is not despawn/spawn. One privileged lifecycle transaction updates the active registry metadata
revision and the same GPU body: Team becomes HOSTILE, current owner/source becomes R, target policy becomes
player-damageable-and-terrain, speed magnitude is preserved, and aim is an exact living Tower or stored
forward. No-Tower stored-forward uses a null target handle; there is deliberately no Core target fallback.
R death or Core impact releases forward once;
projectile expiry clears the slot without release. Capture completions are coherently accepted before generic
death/Core events from the same source tick.

The immutable logical projectile/origin provenance is retained so a future GPU Subject/Sentence runtime can
continue Fireball relationships after capture. This is not end-to-end Sentence execution evidence.

Terminal closure cancels unpublished release work and removes unpublished held projectiles through the
privileged cleanup ledger. A release already lifecycle-published with backend `commitRequested` completes its
GPU commit and async readback before seal. Replacement resets capture state, roster, proof/readback queues,
metadata-mutation authority, and stale ports rather than reconstructing held projectiles.

Turn 9 final acceptance explicitly ran the selected `enemy-ring-projectile-capture` actual WebGPU stage and
the complete Node suite. Both passed; hardware teardown reported zero uncaptured errors and
`deviceLostReason=destroyed`. The final cumulative runner then passed every other hardware and automated gate,
so Ring is part of the completed R2 acceptance. Its provenance guarantee remains preparation for a future
Subject/Sentence runtime, not end-to-end Sentence execution.

### Cork Z route closure and forward reroute

Natural `basic_cork_01` currently uses the technical expanding-circle Cork presentation rather than dedicated
Cork/trapezoid geometry, with common-C HP/speed/weight/Tower/Core values
`1/2.5/1/0.1/1`, and exact `cork-route-closure-01`. It is one logical and physical body with helper count 0;
the independent RouteRuntime domain, not a per-Z JavaScript controller or `EnemyBehaviorState`, owns selection,
travel, expansion, blocking, waiting, and exact lease state.

An optional normalized `routeGraph` v1 adds route sets, shared forward switches, clearance/closure nodes, and
downstream merge topology over the existing immutable Flow Field atlas. Legacy maps omit this graph and stay
all-open. Runtime closure never mutates the TileMap collision grid, terrain SDF, flow vectors, goal positions,
or field-stage links. Future spawns bound to a `routeSetId` choose the lowest-priority open path from the latest
authenticated availability snapshot; when all candidates are closed, their exact authored command stays
backlogged without advancing the Wave cursor.

GPU availability assigns one closure to one exact `(entityId, incarnation, leaseGeneration)`. Z travels to its
authored entrance, anchors with zero inverse mass, and visibly expands for 60 fixed ticks to radius 3, equal to
the six-tile path width, while remaining physically nonblocking. Expansion completion publishes availability
`CLOSED` and enables the `ROUTE_BLOCKER` physical role in the same boundary. Duplicate Z actors wait and may not share
or steal a lease; stale incarnation/replay evidence cannot reopen a replacement's route. The bounded host mirror
holds at most eight exact Z leases and accepts only graph/session/device/epoch/tick/version/fingerprint-qualified
assignment, close, reopen, and cleanup completions.

An actor upstream of the shared switch reroutes only at that reachable forward switch. One already beyond the
switch advances to the authored clearance point, disables route movement, waits without reversing, and retains
independent attack, Effect, and Formation behavior. The expanded Z blocks Enemy and Player Tower physical pairs,
but not projectile physical movement. A projectile can still damage Z through ordinary team/hit policy, consume
its normal self-hit and penetration budget, and continue when penetration remains.

`BLOCKING` changes solver role, not gameplay noun: interaction metadata and hostile Team keep Z eligible as a
hostile Enemy for P Boost. If a route closes while a formation command is mid-spawn, the already selected
original route remains pinned for the unpublished remaining entry/group. All those members stay in one backlog,
no arbitrary partial row 0 publishes, and reopen materializes the remaining group/rows on that same route in one
batch. Already published actors keep the ordinary forward-switch reroute/clearance-wait behavior. A future
policy that moves the remaining formation to another route must move the whole remaining formation atomically.

Exact Z death/despawn reopens the owned route before cleanup and slot reclamation. Terminal final submit and
GPU-world replacement restore an all-open availability snapshot, empty route rosters/readbacks, and revoke stale
route authority. Dedicated `cork_dual_route_01`/`cork_dual_route_wave_01` content is injection-only; the default
figure-eight production map/wave remains unchanged.

The explicitly selected `enemy-cork-route-closure` actual WebGPU stage passed the complete Turn 9 cross-gate:
P Boost targeted physical-layer `ROUTE_BLOCKER` Z through hostile Team/Enemy interaction identity; tick 61
remained LEASED and physically nonblocking, while tick 62 published `CLOSED` plus blocker atomically; two
unspawned formation members stayed backlogged and reopened in one original-path batch with no partial row;
Arrow/M/O kept route-owned WAIT behavior; R/J/H retained their independent state through reroute; exact
capacity-8/lease-incarnation/terminal/replacement cleanup stayed non-recovery and storage maximum remained 9.

## 4. Enemy word does not overwrite AI

A player-triggered sentence such as:

```text
Enemies shoot Fireballs.
```

causes the current Enemy subject snapshot to execute the action once. After execution each Enemy
continues its ordinary EnemyDefinition AI. The sentence is not a permanent global enemy behavior
replacement unless an explicit modifier/verb says so.

## 5. Hostile attack target list

GPU/runtime needs a bounded live Tower target source. The target source must support many Towers
without CPU per-body frame readback.

Possible GPU-resident data:

```text
Tower team/tag selector
exact identity
position/velocity
share
HP ratio
targetable flags
```

Target selection occurs on GPU for large subject counts. A bounded summary may be read back for UI,
not for gameplay authority.

Current M does not read pose to CPU: the host supplies only explicit exact Core/Tower handles, and
BodyControlProgram chooses Core first, Tower second, or none from authoritative tick-start GPU transforms.
Its completion record is bounded control evidence, not a body-position mirror.

## 6. Hostile projectile behavior

- Hostile Bullet/Fireball uses `teamId=HOSTILE`.
- It damages Player Towers/structures, not hostile enemies.
- Target/fallback is action-specific: Archer requires a living Tower and emits no fallback shot; M selects
  Core first in inclusive range, then a living Tower, otherwise emits no shot and resumes Core-route movement.
- Existing launched projectiles do not disappear merely because all Towers die.
- Homing attacks may retarget Core or another Tower.

## 7. Tower HP application

A hostile hit generates typed damage with exact source/target identity and source ability metadata.

```text
GPU damage
→ exact Tower HP update
→ typed damage event
→ optional death event
→ CPU TowerShare domain consumes exact death once
→ next-boundary body cleanup
```

Tower death is not a run-failure event. Core depletion is.

### Tower Maximum Damage Window

The internal name is `TowerMaximumDamageWindow`, not invulnerability. Damage resolves in this locked order:

```text
raw
→ source modifiers
→ armor/resistance/directional defense/status
→ final damage
→ same-Tower/source-tick maximum aggregation
→ Tower Maximum Damage Window
→ GPU HP mutation
```

All valid candidates for one Tower/source tick are collected before submission. The greatest final damage
wins independently of GPU append order; an equal maximum chooses source entityId, then source incarnation,
ascending. If the first accepted tick is `N`, `expiresAtFixedTick = N + 60`; `T < expiresAtFixedTick` is
active and `T >= expiresAtFixedTick` is expired. During an active window, damage at or below the stored peak
applies zero without changing expiry, while a larger value applies only `D - peak`, updates the peak, and
updates winning provenance without extending the original `N + 60` expiry. `DAMAGE_APPLIED.value` is the
actual Tower HP decrement, never the unclamped source maximum.

A valid projectile contact consumes penetration/self-hit budget even when this window reduces applied HP
damage to zero. A rejected friendly-fire, stale/invalid-target, miss, capture, or reflect contact consumes no
budget. Enemy overlap remains a valid continuous candidate every fixed tick; separation is not the rearm rule.

## 8. Physical response

Targeting, damage, and physical collision are separate.

Examples:

```text
Walker:
  targets Core
  weight-solves against Tower
  emits Tower contact candidates while overlapping

Hunter:
  targets Tower
  weight-solves against Tower

Archer:
  targets Core for movement
  targets Tower for projectile
  still has universal contact/core-impact capabilities
```

Do not infer one dimension from another.

Weight is physical mass, not rarity: `inverseMass = 1 / weight`. The Tower baseline is `weight = 10`.

## 9. Core impact and terminal boundary

Every current Enemy definition carries `enemy-core-impact`. An accepted exact Core-proxy impact applies the
spawn-resolved `coreImpactDamage`, requests exact Enemy despawn with disposition `CORE_IMPACT`, and forfeits
that branch's bounty. Friendly/stale/forged events never become an authenticated cleanup.

When Core Integrity reaches zero, new gameplay requests close immediately. The current fixed boundary still
performs exactly one last lifecycle commit and one GPU fixed submit so the authentic Core-impact Enemy is
cleaned. Fixed, Effect, Formation, Atomic Transform, and Projectile Capture owners cancel/tombstone unpublished
pending work; no unpublished pulse, regen, Formation transform, J split, C′ return, or projectile release starts
on the terminal submit. Unpublished held projectiles are cleaned exactly once. A J/C′ transform or R release
already lifecycle-published with a backend `commitRequested` receipt instead completes its GPU commit and async
readback there. Matching owner/backend pending-zero evidence, settled prior/current readbacks, and sealed J/C′
and R rosters are part of terminal success.
`RunFailed` is committed once; later fixed updates are
successful terminal no-ops, while status, presentation, and draw remain readable. The sealed no-op does not
advance the fixed/presentation reference clock; camera follow and the last committed render/status snapshot
stay frozen instead of extrapolating.

## 10. Player-created enemy

A spawned Enemy obtains:

- a real EnemyDefinition;
- Hostile team;
- ordinary navigation and engagement policy;
- bounty and Siege Weight;
- wave/Overtime participation;
- exact source provenance for telemetry.

It must not be marked as `fake`, `no-reward`, or excluded from cleanup unless an explicit word/content
definition says so.
