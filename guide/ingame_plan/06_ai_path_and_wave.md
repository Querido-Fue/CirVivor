# 06. AI, Paths, and Waves

## Navigation authority

Existing TileMap routes, flow-field atlas, authored goal positions, and GPU route-stage progression
remain authority. New AI policy chooses objectives/attacks without replacing the proven route data.
Optional routeGraph v1 adds immutable route-set/switch/closure indices over that atlas; dynamic availability
changes route selection and forward stage transitions only, never the TileMap/SDF/flow identity.

## Enemy policies

See [`../gameplay/04_enemy_behavior_and_combat.md`](../gameplay/04_enemy_behavior_and_combat.md).

Required initial policies:

```text
CORE_ONLY
TOWER_ONLY
CORE_WITH_TOWER_HARASS
```

Targeting, navigation objective, attack behavior, and physical response are separate fields.

## R2 EnemyDefinition/profile/capability authority

Each production EnemyDefinition references immutable physics, combat, and behavior profile IDs plus
`shapeDefinitionId` and stable `capabilityIds`. Spawn converts capabilities to a registry mask; current
universal production requirements are `enemy-contact-combat` and `enemy-core-impact`, while Archer's existing
producer and Diamond M additionally consume targeting, while only `basic_arrow_01` consumes the stable
`enemy-charge` capability, only Pentagon P consumes `enemy-effect-emitter`, H/group consume
`enemy-formation + enemy-atomic-transform`, HX consumes `enemy-formation`, and only O consumes the paired
`enemy-orbit + enemy-directional-defense`. Natural J and transform-private C′ consume
`enemy-atomic-transform` through a Jorang lineage roster distinct from H Formation. Only the canonical H
natural/group, J, and private C′ atomic profiles route to an implementation; arbitrary profiles fail closed.
Natural Ring R alone consumes `enemy-projectile-capture` through its capture roster and same-identity release
transaction.
Natural Cork Z alone consumes `enemy-route-closure` through independent GPU RouteRuntime/availability and a
bounded exact-lease host roster.
Only real runtime implementations are registered. Future vocabulary must not create
empty capability classes, and no spawn may allocate a per-Enemy JavaScript AI object.

Turn 2 production policies are exact profile compositions:

```text
C: HP 1, speed 2.5, weight 1, ordinary Core route/contact
T: HP 0.7, speed 3.5, weight 0.6, ordinary Core route/contact
A: exact Tower seek/windup/non-homing charge/contact recoil/recover, Core route fallback
M: Core-first inclusive range 8, persistent stop + selected projectile, no-target route resume
Archer: existing Tower-only ranged producer, no Core fallback shot
```

A's state and telegraph come from the GPU behavior side-plane; no CPU pose or shape-to-AI inference is
permitted. M receives only exact Core/Tower handles. GPU tick-start control chooses the target, and the bound
selected-target spawn emits typed CPU Core damage or validates the exact Tower before ordinary damage handling.

Arrow gameplay is now separated from `tracked_pose_config`. Tracked pose is presentation/camera/diagnostic-only,
while Tower selection, validity, charge, and aim use the dedicated exact 16-byte GPU Tower-target binding/port.

### Octagon O orbit navigation

O uses the same dedicated exact Tower-target binding and never reads a CPU Tower pose. The lifecycle owner
assigns one persistent slot from the fixed eight-slot `RING_SLOTS` spread order before backend publication;
survivors are not compacted, and despawn releases a slot for deterministic reuse. Slot capacity is a normal
whole-due-spawn-batch rejection with zero registry/backend mutation, while corrupt active lease metadata is
recovery.

Host packing starts program 3 in `SEEK_TOWER` with invalid target and flags `0`. A valid Tower binds the exact
target, updates the Tower-facing vector, sets only `TARGET_VALID`, and leaves authored route flow enabled.
Tick-start distance `<= 6` captures once into `ORBIT_TOWER`, disables flow, and activates armor/defense. The
60Hz target phase is `0x80000000 + slot × 1/8 turn + global fixed-tick step`, so slot 0 starts west; capture
settling rotates the current radial vector by a bounded shortest-angle step instead of crossing the Tower center.
The same facing is the armor/render authority only after capture. Tower loss from SEEK or ORBIT latches the body
into ordinary Core-route flow, disables defense, and never treats Core as an orbit center. The slot remains a
lifecycle lease until that exact O despawns; no host group/pose/controller is introduced.

O is authored only for maps whose exact Tower has all eight radius-6 slot centers on walkable space with enough
SDF clearance. The injection-only R2 showcase supplies a compatible open-ring region and uses four simultaneous
O actors. The current corridor fails that invariant, so its production wave remains unchanged and contains no O.

The current Tower-loss `LATCH_CORE_FALLBACK` is a single-Tower baseline. Future Tower reappearance/multi-Tower
content must reacquire at a roster-change boundary and select lowest exact living entity ID, then incarnation;
that policy is inactive today. Capacity is eight. A >8 fixed-tick due batch is rejected whole with zero mutation
and `recovery=false`, then retried through data-authored staggering after a slot becomes available.

### Pentagon P navigation

P's Effect emitter is independent from the exclusive behavior-program union. Its exact-handle SoA roster and
pulse cadence are host-owned, while movement candidates and Effect application remain GPU-authoritative.
At each fixed-tick start the GPU uses the bounded collision/spatial grid rather than a P×N² scan, scores only
eligible hostile cluster candidates, and applies the authored route constraints: a same-stage candidate must
not increase integration cost, a later reachable stage is allowed, and route-width, no-reverse, and bounded
SDF reachability gates must all pass. Invalid atlas/SDF data fails closed. No CPU pose readback participates.

### H/HX Formation navigation

Formation is independent from the exclusive behavior-program union. Natural H and composite groups seek
eligible H/group candidates from tick-start bounded-grid state; HX keeps the Core route. Route policy admits a
reachable later stage or non-increasing same-stage integration cost and rejects reverse progress, invalid SDF64,
grid overflow, and naive H×N² scans. Eligible join candidates compare distance², forward-stage delta,
forward-cost delta, root entity/incarnation, slot, and rotation ascending. GPU prepare at tick N may publish an
atomic two-source→one-destination transform only at N+1; no CPU pose participates.

### J/C′ split-lineage navigation

Natural compatibility identity `basic_gen_01` J and transform-private `basic_circle_prime_01` C′ both use the
ordinary common-C Core route. J is dedicated shape `jorang`, bounty `12`, and NATURAL; C′ is shape `circle`, uses common-C
HP/speed/weight/Tower/Core values `1/2.5/1/0.1/1`, and cannot be authored or publicly spawned.

Navigation never infers the transform from shape. `FIRST_VALID_POSITIVE_DAMAGE_HIT` is a producer-neutral
one-shot seam over source body, damaged target, final positive damage, producer kind, producer-policy-validated,
and expected phase. Projectile is the current caller after its own `CLOSEST_ONLY`/team/target/budget validation;
explosion/Effect/direct/melee are future independent callers and are not claimed as executed. One accepted hit
enters `SPLIT_PENDING`; further same-valid hits consume neither damage, budget, nor event.

The J transform is atomic 1→2: both C′ copy exact GPU pose/velocity/flow and start fresh full HP. Bounty is
uint32 child0-ceil/child1-floor, every active Effect instance moves exactly once under its `EffectDefinition`
policy (Penta Boost: stable instance ID modulo destination count), and both carry the natural
root exact `(entityId, incarnation)` pair with transaction-local child order `0/1`. Each surviving C′ follows
its route independently and, exactly 60 ticks after publication, can return 1→1 J only from authentic T-1→T
evidence while preserving exact pose/velocity/flow, current/max HP, Effect instances, branch budget, and root
pair. Core impact consumes that branch with no bounty or return.

GPU marker admission is not capped by the host start quota. The bounded director orders due C′ first, then
due tick/root pair/source exact handle ascending and starts at most four J-lineage transforms per fixed tick;
H retains a separate Formation cadence. Normal capacity rejection keeps PENDING/backlog and restages a fresh
proof/command on the next boundary without recovery or a half child.

These J contracts passed their explicitly selected actual WebGPU stage and the final cumulative R2 acceptance.
Only projectile producer ingress is currently connected; future producer vocabulary is not reported as executed.

### Ring R projectile capture navigation

Natural `basic_ring_01` R follows the ordinary common-C Core route. Its funnel direction is the last nonzero
route velocity, not a CPU pose sample. A deterministic inclusive ±45° one-slot match captures only an exact
PLAYER projectile whose policy is capturable and whose relative velocity is strictly closing. Inside-cone
outbound overlap is rejected. The same projectile identity is held for 60 ticks with lifetime
continuing but movement/grid/contact/solver/source/render disabled through the exact Simulation mirror.

Release keeps the same slot/entity/incarnation, preserves speed magnitude, and places the projectile outside
both radii by 1/1024 tile. It aims at an exact living Tower when available and otherwise uses stored forward;
the no-Tower target handle is null and Core is not a fallback target. R death or Core impact releases forward once, while projectile expiry clears the
slot without release. Capture/release state never changes the authored route or allocates a per-R controller.

Capture-completion/release capacity exhaustion is a normal whole-batch zero-mutation result with
`recovery=false` and later retry/backoff; ABI/identity/fingerprint/bilateral corruption remains recovery. Exact
logical projectile/origin provenance is preserved for a future GPU Subject/Sentence Fireball relationship, but
no end-to-end Sentence execution is claimed.

Turn 9 explicitly passed the selected `enemy-ring-projectile-capture` hardware stage with zero uncaptured
errors/orderly destroyed teardown, then passed the final cumulative Node/hardware/golden/title/churn/hygiene
runner. This does not change the no-Core stored-forward contract or make provenance an end-to-end Sentence claim.

### Cork Z route closure navigation

Natural `basic_cork_01` uses analytic `circle`, common-C stats, one logical body, helper count 0, and exact
`cork-route-closure-01`. GPU RouteRuntime deterministically chooses the lowest-priority open closure in its
route set, authenticates one exact `(entityId, incarnation, leaseGeneration)`, and moves Z to the authored
closure entrance. A competing Z waits when no unleased candidate exists.

At the entrance Z anchors and visibly expands for 60 fixed ticks to radius 3, equal to the six-tile route width,
while physical pairing remains nonblocking. Only expansion completion publishes route `CLOSED` and enables
`ROUTE_BLOCKER` together. Interaction metadata/Team keep BLOCKING Z a hostile Enemy noun. An upstream actor observes the availability version and changes path only
at the next authored forward switch. An actor already beyond the switch advances to its clearance field and
waits without reverse; route movement stops but independent attack, Effect, and Formation behavior continues.

Future Wave spawns bound to `routeSetId` use the latest authenticated availability snapshot. Lowest priority,
then stable path identity, selects an open path. If every candidate is closed, the exact compiled spawn command
stays in backlog and the schedule cursor does not advance. Exact Z death/despawn reopens and cleans only its
lease; terminal/replacement returns the graph to all-open. Legacy graph-null maps retain fixed path binding and
need no RouteRuntime actor state.

The selected Cork hardware stage passed the exact navigation cross-gate: EXPAND remained LEASED and physically
nonblocking through tick 61, tick 62 atomically activated CLOSED plus ROUTE_BLOCKER, a mid-spawn formation kept
its original-path two-member backlog and reopened in one batch, Arrow/M/O waited under route ownership, and
R/J/H rerouted with independent state preserved and `recovery=false`. Exact lease/incarnation cleanup, capacity
8, all-open terminal/replacement state, and storage maximum 9 also passed.

## Spawn-time stat resolution

`WaveDirector` freezes map/wave modifier snapshots and resolves each spawn once:

```text
base
× map global
× map per-definition
× wave global
× wave per-definition
→ absolute override
→ final validation/quantization
```

Absolute override precedence is map global < map per-definition < wave global < wave per-definition.
Multiplication uses full JavaScript numeric precision with no intermediate rounding; GPU-bound values are
quantized once at the end. Resolved stats and profile/capability metadata remain immutable after spawn.
`bountyBudget` is an exact uint32 at profile, resolved-stat, and spawn-intent boundaries; fractional, negative,
or overflow values fail before reservation, while zero remains a legitimate lineage branch.

H/HX is the explicit exception to general map/wave multiplication: its natural n1 and composite n2..6 values
come from one absolute member-count table, and any map/wave modifier is rejected before publication rather than
ignored or applied at the first merge. Final GPU-bound floats are still quantized once.

## Player-created enemies

- receive a real EnemyDefinition;
- join hostile actor count;
- receive route/free-navigation state according to definition;
- grant bounty;
- contribute Siege Pressure;
- are selectable by Enemy Subject sentences.

## WaveDirector

WaveDirector remains schedule/spawn authority, not the sole hostile-count authority. Hostile actors can
also be created by sentences.

Authored R2 waves are data timelines rather than random selection. Current production owns independent
`memberCount`, `rows`, `columns`, coordinate system, spawn mode, row delay, `keepFormation`, layout/symbol map,
and route binding; runtime
systems consume those records without inferring formation from render shape. The 60Hz compiler supports
`SPAWN_FOR_DURATION`, `WAIT`, `SPAWN_GROUP`, and `SPAWN_FORMATION`. Wave/timeline/group/member provenance
forms stable command identity. All spawns due on one fixed tick are queued in one atomic batch; rejection
preserves both cursor and identity for retry.

For optional routeGraph content, a group may own exact `routeSetId` instead of a fixed path. Resolution uses the
versioned availability mirror immediately before queueing. An all-closed result is a normal retained backlog,
not an invalid path, partial batch, random fallback, or GPU recovery.

If a formation entry has already begun materializing, its chosen original path stays pinned for every
unpublished remaining member. Closure retains the whole remaining entry/group and publishes no partial row 0;
reopen publishes the remaining rows on that same path in one batch. This does not pin actors already published,
which retain the ordinary forward-switch reroute/clearance-wait policy.

`memberCount` is the authored live-member count and is never a grid dimension. `rows`/`columns` are explicit or
exactly derived from the rectangular layout; explicit dimensions must match the layout and every mismatch fails
before mutation. Legacy `size` is rejected.

Turn 2 materializes `LINEAR_GRID` offsets in authored world axes and `PATH_RELATIVE` offsets in the first
route segment's forward/normal basis. Both `ALL_AT_ONCE` and positive-delay `SEQUENTIAL_ROWS` are supported;
every exact gate/path binding and member walkability is checked during compile. Turn 4 accepts
`keepFormation=true` only for natural H with exact `HEX_AXIAL` six-ring provenance; non-Formation keep requests
and direct transform-private group/HX authored spawns fail closed.

The production corridor schedule remains 32 spawns at five-tick intervals with deterministic cycle
`C → T → A → M → C → T → Archer`. Archer stays at indexes `6/13/20/27` and local ticks
`31/66/101/136`. The dedicated `enemy-hexa-formation` checkpoint stage and authored
`enemy-jorang-split-lineage` support stage do not alter this production wave; neither J nor C′ is silently
inserted, and C′ remains transform-private. The authored `enemy-ring-projectile-capture` stage likewise does
not insert R into the production corridor wave. Dedicated `cork_dual_route_01`/
`cork_dual_route_wave_01` and `enemy-cork-route-closure` support remain injection-only and do not add Z or a
routeGraph to the production figure-eight content.

The separate injected R2 showcase uses three staged waves over a dual-route/open-ring map: C/T/A/M/P plus rows,
then H→HX/O/J/R, then Z with route-availability formation. It never mutates the default corridor definitions.

Wave completion reads:

```text
scheduled remaining
pending hostile actor creation
live hostile actor count
wave timer / Overtime state
```

## Overtime

See [`../gameplay/05_wave_overtime_economy.md`](../gameplay/05_wave_overtime_economy.md).
Overtime Core damage is a domain system, not inferred inside flow-field or WaveDirector code.
