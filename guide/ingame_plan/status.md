# Current Ingame Status

Source baseline: accepted R1 checkpoint `68255d2fc4b8d1accca3ecb9c3f149cfee05fd08` plus the
committed Pre-R2 stabilization checkpoint `649806d25dfc541e58551515a0faf70733def3ec` and the gameplay
decisions documented in `guide/gameplay/`. Verify code when later changes land.

**R1 is complete as of 2026-08-09. R2 Enemy Ecosystem Turns 1–9 and final cumulative acceptance are complete as
of 2026-08-12.** The final runner exited `0`: changed-production syntax `38/38`, Node `1402/1402`, default
actual WebGPU plus exact nine selected stages, both WASM checks, flow stress, audited render golden, two title
GPU smokes, diff hygiene, and 3/3 single-device/session O/J/R/Z/H/P/projectile churn all passed. All ten
hardware receipts directly report NW.js `0.108.0`, effective storage maximum 9, `uncapturedErrorCount=0`, and
orderly `deviceLostReason=destroyed`. Full/Arrow/Maximum/Rhom additionally identify NVIDIA Lovelace/adapter
limit 10; Ring/Cork explicitly report adapter/requested/device `10/9/9`. Manual showcase remains
`automatedResult:false`: the cumulative run was non-interactive and no human visual/pause-resume session was
executed. Economy, Word, and multi-Tower capabilities remain outside this R2 slice. Progress is `r2 완료.`.

## Implemented runtime foundation

- Tower/Core/Basic Bullet mixed GPU World migration is complete.
- GPU World owns one authoritative Tower body, Core proxy, enemies, projectiles, collision, HP storage,
  lifetime, render, exact identity, and typed contact/death events.
- Production LMB Basic Bullet uses exact GPU Tower source and GPU aim-point resolution.
- **R1 team metadata foundation complete** (Turn 1/5): canonical numeric
  `NEUTRAL=0`, `PLAYER=1`, `HOSTILE=2` IDs now propagate through spawn, active registry metadata,
  source-relative provenance, and GPU damage handling. Tower/Enemy/Core are
  PLAYER/HOSTILE/NEUTRAL, and Basic Bullet inherits the exact source generation's team.
- Current R2 production is Body ABI v8. Established primary strides and the 40-byte `CombatState` side-plane
  remain stable; a versioned 80-byte `EnemyBehaviorState` side-plane owns one mutually exclusive Arrow charge,
  selected-target projectile, or O Tower-orbit program. BodyControlProgram v2 uses 96-byte records/64-byte result states and SpawnProgram v4 uses
  96-byte records. Compute storage remains bounded to 9 per shader stage, with the dedicated
  maximum-damage-window profile using 9.
- Turn 3 adds independent versioned Effect ABIs with bounded GPU A/B instance pools, per-body Effect Summary,
  and PEmitter state. Effect passes and the current platform contract remain bounded to 9 storage buffers per
  shader stage; Effect/P state is not appended to `EnemyBehaviorState`.
- Turn 4 adds independent Formation ABI v1: body/candidate state `80/48` bytes, prepare header/record
  `48/144`, transform header/record `64/192`. Prepare-select, transform-auxiliary, and render peak at `9/8/8`
  storage buffers. Formation/H/HX state is not appended to `EnemyBehaviorState`.
- Turn 6 adds independent J/C′ Atomic Transform state: a 48-byte persistent `AtomicTransformState`, 16-byte
  tick-local candidate plane, prepare `32 + 64N`, and transform `48 + 80N`. Its storage profile requires at
  most 9, the atomic first-hit contact profile is exact 9, and it does not append to `CombatState` or
  `EnemyBehaviorState`.
- Turn 7 adds independent R/projectile capture state: a 48-byte persistent bilateral
  `ProjectileCaptureState`, 16-byte tick-local candidate plane, 64-byte capture/release headers, 96-byte
  completion/release records, 32-byte profile, and 16-byte Tower-target config. Capture/R render profiles stay
  at or below 9 and do not append to `CombatState` or `EnemyBehaviorState`.
- Turn 8 keeps Body ABI v8 and adds independent Route Runtime ABI v1: 64-byte per-body state, 96-byte immutable
  topology header, availability header/record `64/32`, and cleanup header/record `32/32`. Route advance/finalize
  uses 9 storage buffers and does not append to `CombatState` or `EnemyBehaviorState`.
- Default GPU damage permits PLAYER→HOSTILE and HOSTILE→PLAYER only. Same-team and Neutral pairs
  preserve non-damage interaction/physics while consuming no target HP or projectile penetration.
- **R1 single-Tower HP/death foundation complete** (Turn 2/5):
  - GPU Tower HP 30
  - Team-aware hostile damage
  - zero Towers does not fail run
  - current HP survives GPU-world replacement
- R1 exact source-to-target projectile primitive complete
  - authoritative GPU tick-start source/target aim
  - target identity/provenance
  - target-invalid normal cleanup
  - aim target separated from Team/target policy
- R1 Archer hostile attack producer complete
  - data-authored Archer/hostile Bullet/attack
  - lifecycle-driven exact Archer roster
  - GPU exact source→Tower target shot
  - completion-based cooldown
  - production wave integration with the exact seven-ID cycle
- `corridor_eight_wave_01` remains 32 spawns at five-tick intervals. Its current exact cycle is
  `C → T → A → M → C → T → Archer`; Archer indexes are
  `[6, 13, 20, 27]`, with local spawn ticks `[31, 66, 101, 136]`.
- Production GameScene status uses a bounded, deep-frozen `GameSystem.getGameplayStatus()` snapshot.
  It renders committed `TOWER current / 30 ALIVE|DEAD` (plus `RECOVERY` when applicable) and
  CPU-authoritative `CORE current / max` through the canonical `LayoutHandler`/`PositioningHandler`
  UI path. It performs no raw GPU body readback. CPU fallback reports `TOWER N/A`; benchmark/tool
  children do not receive this HUD port.
- finite lifetime clamps to zero; 2-second bullet expires at f32 source tick 121; immortal `-1` remains.
- CPU domain preserves Core Integrity and session state across GPU-world restart. Replacement restores
  only committed Tower HP and resets the transient Maximum Damage Window.
- Current R1 production behavior still assumes one Tower; Tower Share, multiple Towers, and broader
  hostile attack selection remain future work.
- Current `WaveDirector` remains spawn-schedule-only. It compiles the four-command authored 60Hz timeline,
  resolves immutable Enemy spawn stats once at queue time, and sends every same-tick set through one atomic
  batch whose rejection preserves schedule cursor/identity. Core impact/depletion is connected through the
  separate `EnemyCoreImpactDirector` and `RunOutcome`; Gold, wave completion, Shop, and Word runtime remain
  unconnected.
- Formation authoring now uses independent `memberCount` and explicit/layout-derived `rows/columns`; legacy
  `size` is rejected. `keepFormation=true` is live only for natural H exact six-ring provenance. The dedicated
  `enemy-hexa-formation` checkpoint fixture does not alter the production 32-spawn/five-tick wave.
- Turn 5 adds `basic-octa-enemy` with exact capability mask `0xA47`, weight `2.5`, route-flow Tower SEEK followed
  by radius-6 capture/orbit, and 3/8 front flat defense. Lifecycle owns one persistent slot from
  `[0,4,2,6,1,5,3,7]`; GPU behavior owns Q32 phase/facing/fallback. The directional classifier uses 8 storage buffers and the existing handler stays
  at 9, so its 80-byte behavior stride and the global maximum remain unchanged. The production corridor wave is intentionally
  unchanged because that map cannot keep all eight radius-6 slots walkable/SDF-clear. A dedicated routed NW
  fixture uses a compatible open-ring map; default-corridor enablement is a Turn 9 map-compatibility gate.
- Turn 8 adds `basic_cork_01` Z with common-C stats, analytic circle, helper count 0, exact route lease, anchored
  60-tick expansion to radius 3, Enemy/Tower-only physical blocking, and projectile damage/penetration pass-through.
  Optional routeGraph v1 compiles over immutable flow/SDF; the dedicated dual-route map/wave is injection-only.
- Turn 9 authored a separate dual-route/open-ring showcase in three stages (C/T/A/M/P + rows; H→HX/O/J/R;
  Z + route-availability formation). Its original checkpoint placement was injection-only and did not modify
  the default 32-spawn corridor data. Post-R2 product routing now opens this showcase Wave 1 from the first
  title map card while preserving that card's corridor preview/selection identity. Showcase uses 4 simultaneous
  O actors, below fixed capacity 8.

## Pre-R2 Stabilization COMPLETE (2026-08-09)

- Tower death no longer escalates a valid in-flight exact dead-body control into GPU World recovery.
  Fixed-control validation keeps structural/range/entity/incarnation/flow/move corruption as hard
  `RECORD_INVALID`, but an otherwise exact body whose ALIVE bit is already clear is a bounded no-op.
- Recovery replacement now accepts the production backend's healthy lazy `gpu-deferred` state as well as
  `gpu-ready`, independent of the legacy `init()` boolean. Unavailable/failed/recovery candidates are still
  rejected before the old endpoint, registry, Director, or CPU run-domain state is mutated.
- The camera presentation target remains stable: committed living Tower first, terminal zero-Tower Core
  fallback second. This presentation policy does not change GPU physics, flow, or tracked-pose authority.
- Tooltip delay is canonical `0.30`, range `0.00..2.00`, step `0.01`, precision `2` from one settings schema.
  Mouse drag, display retarget/rollback, and hover-owned semantic `MOVE_LEFT`/`MOVE_RIGHT` keyboard input
  all use the same step quantizer; the keyboard path preserves `0.27→0.28→0.27` and commits once per edge.
- Animation ingress uses the separate frozen `animationCategory` values `UI`, `GAME_MECHANIC`, and `EFFECT`;
  easing remains `type`. Hidden `uiAnimationDurationScale` defaults to `1.0`, clamps to `0.1..4.0`, and
  divides only UI animation delta. Tooltip seconds, camera/gameplay animation, effects, and fixed timing are unchanged.
- R2 Turns 1–3 behavior tests/fixtures were authored under the restricted per-turn cadence and received their
  cumulative acceptance at the 2026-08-10 Turn 4 checkpoint.

## R2 Enemy Ecosystem Turn 1 implemented

- Canonical immutable `EnemyPhysicsProfile`, `EnemyCombatProfile`, and `EnemyBehaviorProfile` records are
  referenced from each current EnemyDefinition. Runtime spawns carry stable profile IDs, capability mask,
  and resolved metadata without allocating a per-Enemy JavaScript AI object.
- Stable capabilities include `enemy-contact-combat` and `enemy-core-impact`. A validated implementation
  registry and minimal lifecycle/fixed-command/gameplay-event port assertions expose only current runtime
  systems; future capability vocabulary does not create empty classes.
- Resolved stats compile once at spawn: base × map global × map per-definition × wave global × wave
  per-definition, then absolute override with the same low-to-high precedence, then one final validation/f32
  quantization. There is no intermediate rounding or live re-resolution.
- Every current Enemy can continuously produce an Enemy→Tower contact candidate while overlapping. Damage
  order is raw → source modifier → armor/resistance/directional/status → final → same-tick maximum → Tower
  Maximum Damage Window → GPU HP mutation.
- The Tower Maximum Damage Window uses exact expiry `N + 60`: candidate `T < expiresAtFixedTick` is active,
  `T >= expiresAtFixedTick` is expired. Same-Tower/source-tick candidates are order-independent; maximum
  final damage wins, with equal maxima resolved by source entityId then incarnation ascending. `DAMAGE_APPLIED`
  reports the actual HP delta, including zero for a valid suppressed hit. A larger active maximum applies only
  the peak delta and never extends the original first-tick expiry.
- A valid projectile hit consumes penetration/self-hit budget even when the window applies zero HP damage.
  Friendly fire, stale/invalid target, miss, capture, or reflect rejection consumes nothing.
- Weight is physical mass (`inverseMass = 1 / weight`); the Tower baseline is data-authored `10`, and
  Tower↔Enemy physical separation remains independent from damage interaction.
- Exact Core proxy impact applies resolved `coreImpactDamage`, stages exact `CORE_IMPACT` despawn, and forfeits
  bounty. Core depletion blocks new gameplay ingress immediately, completes the same boundary's single final
  lifecycle commit/GPU submit (including the exact impact cleanup), and emits `RunFailed` once. The versioned
  terminal seam tombstones unpublished CPU/GPU work; a J/C′ transform already lifecycle-published with backend
  `commitRequested` completes its GPU commit and async readback on that submit instead of rolling back.
  `SEALED` requires matching owner/backend pending-zero evidence plus settled prior/current readbacks; any
  cancel/submit/readback/evidence failure or partial completion is `SEALED_FAILED`. Late callbacks are no-ops,
  and both terminal states keep the last
  presentation/draw/status snapshot. A successful seal freezes completed fixed/presentation clocks and camera
  follow, then later fixed updates are successful no-ops.

## R2 Enemy Ecosystem Turn 2 implemented

- Authored waves compile exactly at 60Hz from `SPAWN_FOR_DURATION`, `WAIT`, `SPAWN_GROUP`, and
  `SPAWN_FORMATION`. Wave/timeline/group/member provenance is stable command identity; no randomness is used.
  Same-tick spawns are one atomic batch and a rejected batch retries without advancing the schedule cursor.
- Turn 2's initial `LINEAR_GRID`/`PATH_RELATIVE` all-at-once/sequential-row formation materialization remains.
  Its historical pending `keepFormation`/legacy `size` boundary is superseded by the Turn 4 independent
  `memberCount + rows/columns` schema and H Formation runtime.
- C uses resolved HP/speed/weight/Tower/Core damage `1/2.5/1/0.1/1`. T uses the separate fast/light profile
  `0.7/3.5/0.6/0.1/1`. Both use universal contact/Core-impact behavior.
- Only `basic_arrow_01` declares `enemy-charge`. Its GPU side-plane runs exact-Tower
  `SEEK_TOWER → WINDUP → CHARGE → CONTACT_RECOIL → RECOVER`, locks a non-homing charge direction,
  drives the telegraph, applies opposite recoil, repeats after recovery, and uses `CORE_FALLBACK` without a
  living exact Tower or CPU pose.
- Diamond M performs tick-start inclusive Core-first, Tower-second selection from explicit exact handles.
  In range it persistently stops and binds the selection/fingerprint to one selected-target projectile; no
  target resumes route movement. Its Core branch emits typed authenticated CPU damage with no GPU Core HP;
  its Tower branch verifies the exact selected Tower before projectile budget/common damage-window handling.
- The bounded `HostileAttackDirector` now covers Archer and M under one data-authored global start budget of
  four per fixed tick. Completion, not request, owns selection sequence/cooldown; stale/invalid ordinary
  outcomes do not create recovery.
- Turn 2 tests and NW fixtures were authored under the restricted cadence; the 2026-08-10 Turn 4 cumulative
  gate supplied their first behavior and hardware acceptance.

## R2 Enemy Ecosystem Turn 3 implemented

- Stable `enemy-effect-emitter` is live only for Pentagon P. Effect definitions/emitter profiles are immutable
  catalog records; Poison/Burn/Freeze exist only as generic data/contract/non-production fixture vocabulary,
  with no empty production capability classes.
- The endpoint owns one bounded generic Effect command owner and `GameObjectSystem` owns one
  `PentagonEffectDirector` with an exact-handle primitive SoA roster. Every same-tick due P is one ordered
  whole-tick batch and validation is zero-partial. Explicit zero-target advances cadence. Authentic candidate/
  instance/event/pulse-grid `CAPACITY_REJECTED` advances only the protocol watermark, consumes no sequence or
  cadence, and retries without pausing the fixed world; program-capacity/ABI/record/ID or mixed evidence is
  recovery. Owner/backend share the same resolved capacity.
- GPU A/B Effect pools preserve independent exact source/target instances and half-open expiration. Per-body
  Summary implements `1+` Boost regeneration and `2+` attack multiplication; PEmitter state owns pulse and
  retarget cadence independently from the basic behavior-program union.
- P navigation consumes tick-start bounded-grid candidates and uploaded route integration-cost/SDF data. It
  admits only non-increasing same-stage cost or a reachable later stage, rejects reverse/unreachable movement,
  and performs no CPU pose readback or naive P×N² scan.
- Contact handlers recompute from immutable authored/resolved base damage and projectiles snapshot damage once
  at spawn. Explicit flags permit current Effect attack modification only for Tower contact/projectile channels;
  direct Core impact and typed projectile Core damage remain unmodified.
- Core terminal close now also cancels/tombstones Effect work, retires readback leases, skips terminal
  pulse/regen, observes the final P lifecycle removal, and requires matching Effect ABI/tick/count/pending-zero
  plus roster-seal evidence. GPU-world replacement preserves Tower HP only and resets every transient
  Maximum-Damage-Window/Effect/P roster/timer state while revoking stale ports.
- Turn 3 production/tests/NW support were statically authored under the restricted cadence; the routed
  2026-08-10 Turn 4 checkpoint supplied cumulative Node/NW.js/WebGPU/WASM/render-golden acceptance. Optional
  manual smoke was not run.
- Arrow gameplay now uses a dedicated 16-byte exact Tower-target binding. `tracked_pose_config` is presentation/
  camera/diagnostic-only; terminal gameplay-target clear does not invalidate the frozen tracked presentation.

## R2 Enemy Ecosystem Turn 4 complete (2026-08-10)

- Natural `basic_hexa_01` is n1. Every merge consumes two exact live H/group bodies and creates one
  transform-private `basic_hexa_group_01` for n2..5 or `basic_hexa_hive_01` for n6; all use shape `hexa`.
- The endpoint owns one bounded `GpuFormationCommandOwner`; `GameObjectSystem` owns one bounded
  `FormationRuntimeDirector` primitive SoA. Stable Formation coordinate/slot/membership/motion/atomic-transform
  ports are real implementations independent from the behavior union.
- The host SoA preserves sorted original exact handles 1..6. Registry/GPU `formationLineageHash` is correlation
  only. Natural generation is 1; destination generation is `max(A,B)+1` with overflow rejection.
- GPU prepare tick N may publish only at N+1 through privileged lifecycle ingress and a private opaque single-use
  `WorldRegistry` token. One authentic lifecycle commit removes both sources and activates one destination;
  ordinary death/Core cleanup wins before publication.
- Current/max signed-int32 centi-HP each merge as `sum + trunc(sum/10)`. H/HX uses the fixed absolute n-table,
  rejects map/wave modifiers, changes Tower contact only, keeps Core impact 1, and uses bounty budgets
  `[1,2,4,6,8,10]`. Consumed sources have no kill bounty.
- Every target-tick half-open active Effect instance rekeys independently to the destination with exact identity,
  provenance, and applied/expiry ticks. Prepared/actual counts must match; aggregate/refresh/silent loss is forbidden.
- Core terminal cancel now covers Formation prepared/armed/program/readback work and forbids a final transform.
  GPU-world replacement preserves Tower HP only and resets Maximum Damage Window, Effect/P, and all Formation
  roster/lineage/transaction/presentation state while revoking stale ports.
- The dedicated actual-hardware stages (`maximum-damage-window`, `enemy-arrow-charge`,
  `enemy-rhom-priority`, `enemy-pentagon-effect`, `enemy-hexa-formation`) all passed, as did the default WebGPU
  route. Changed JS/MJS syntax passed 42/42, full Node passed 1245/1245, both WASM checks passed, and flow-field
  stress passed seed `0x71c0ffee` over 1,000 cases/3,824,454 cells/3 ABI-canary layouts.
- The audited render-golden update synchronized the historical `57f60a3` vignette-in-backdrop change rather
  than a Turn4 visual change. The check passed 10 surfaces/3 cases with final SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`; `git diff --check` also passed.
- The bounded H/HX hardware scenario passed, but no separate repeated H stress/churn script was run at Turn 4.
  Turn 9 later passed the H-inclusive 3-cycle mixed churn. Optional manual smoke was not run or claimed as PASS. At that checkpoint progress was
  `r2t4 수행 완료.`; the Turn 5 implementation status is recorded below.

## R2 Enemy Ecosystem Turn 5 implemented and accepted

- Turn 5 is compatible-open-ring-map capability content, not default-corridor enablement. The current corridor
  has blocked radius-6 slot centers and contains no O in its production wave; the accepted injection-only
  showcase supplies the required compatible map.
- `RING_SLOTS=4` and `enemy-orbit=0x800` are append-only vocabulary. O's exact capabilities are navigation,
  targeting, contact combat, Core impact, directional defense, and orbit (`0xA47`).
- Raw O spawn carries slot sentinel `0xffffffff`. At a fixed lifecycle boundary, the owner validates all active
  O metadata and materializes one spread slot into both registry primitives and the GPU behavior record. A full
  ring rejects and consumes the entire due spawn batch without mutation/recovery; malformed/duplicate lease
  metadata fails recovery before reservation. Same-boundary despawn makes its slot available for reuse.
- GPU behavior program 3 is packed as `SEEK_TOWER` with invalid target and zero flags. A valid Tower publishes
  the exact target/facing and `TARGET_VALID` while route flow remains active; inclusive tick-start distance
  `<= 6` captures once into `ORBIT_TOWER`, disables flow, and enables defense. Its 60Hz Q32 target phase is
  `0x80000000 + slot × 1/8 turn + global fixed-tick step`, giving slot 0 a west base. Capture settles along a
  bounded radial-angle path rather than a center-crossing chord. Tower loss from SEEK or ORBIT latches
  Core-route fallback with no recovery, no Core orbit, and no same-world re-orbit.
- The same facing drives OCTA presentation and the inclusive front 3/8 hit classifier after capture; both armor
  rim and reduction are inactive during SEEK. Valid front hits reserve
  projectile/self budget before centi-int flat reduction `50`; zero is allowed and observable, with no minimum
  floor. Rear/side hits retain normal damage. Physical shielding/push stays on ordinary circle collision and
  weights (`O=2.5`, Tower `10`).
- Turn 5 itself kept Body ABI v6/80-byte behavior stride and `CombatState` reserved fields unchanged; current
  production advanced to v7 for Turn 6's independent Atomic Transform planes and v8 for Turn 7's independent
  Projectile Capture planes. Orbit still uses the
  shared enemy-behavior profile. Post-R2 Arrow terrain visibility binds the existing world-SDF group to that
  profile, so its storage count is now 9; the classifier remains a separate exact 8-storage profile, and the
  global maximum remains 9. O's behavior ABI and orbit semantics are unchanged.
- The selected `enemy-octagon-directional-defense` actual hardware stage, full Node suite, and mixed churn passed
  at Turn 9. Manual visual play was not executed.

- Current O `LATCH_CORE_FALLBACK` is intentionally the single-Tower baseline. Tower reappearance or multi-Tower
  play requires future roster-change reacquisition of the exact living Tower selected by lowest entity ID then
  incarnation; it is inactive today. Capacity is fixed at eight. A >8 due batch rejects whole with zero mutation
  and `recovery=false`, then retries through data-authored staggering after slot availability. Showcase uses 4.

## R2 Enemy Ecosystem Turn 6 implemented and accepted

- Natural J keeps `basic_gen_01` as compatibility identity but renders the analytic/legacy joraengi-rice-cake silhouette from two regular-octagon lobes and one narrow connector, with common-C HP/speed/weight/Tower/Core values
  `1/2.5/1/0.1/1`, exact uint32 bounty `12`, and profile `jorang-one-to-many-01`. C′ is transform-private
  `basic_circle_prime_01` (`circle`) with profile `circle-prime-return-delayed-01`; it is absent from the public
  definition catalog and production corridor wave.
- Stable `enemy-atomic-transform` routing is profile-discriminated. H natural/group keeps its Formation roster,
  J/C′ uses `JorangSplitLineageDirector`, and arbitrary/incorrect source-destination-profile combinations fail
  closed. J/C′ profile normalizers require exact own data properties and reject accessor, symbol, hidden-extra,
  and dense-array-extra input without evaluating getters.
- Body ABI v7 preserves prior primary/Combat/80-byte behavior strides and adds an independent 48-byte
  `AtomicTransformState` plus 16-byte first-hit candidate plane. Program/phase state is exact-identity and
  generation-qualified; Atomic Transform Runtime ABI v1 prepare/transform layouts are `32+64N`/`48+80N`, with
  storage required maximum `9`.
- `FIRST_VALID_POSITIVE_DAMAGE_HIT` is producer-neutral over source body, damaged target, final positive damage,
  producer kind, already-validated producer policy, and expected phase. Projectile is the connected caller after
  its own exact `CLOSEST_ONLY`/team/target/self-budget/final-damage checks. Explosion/Effect/direct/melee remain
  independently callable future kinds and are not claimed as implemented or executed. One winner enters
  `SPLIT_PENDING`; subsequent same-valid hits remain damage-0/budget-0/event-0.
- J publication is atomic 1→2 or zero mutation. Both C′ copy exact GPU pose/velocity/flow and start fresh full
  HP `1/1`. Uint32 bounty splits child0-ceil/child1-floor, including valid `1→[1,0]` and `0→[0,0]`; every
  exact active Effect instance transfers once by its `EffectDefinition`. Penta Boost uses stable instance ID
  modulo destination count, while the legacy destination word remains reserved zero. The natural root exact `(entityId, incarnation)` pair
  is lineage authority, while `branchIndex` is transaction-local child order `0/1`.
- Each C′ independently returns 1→1 exactly 60 fixed ticks after publication. Authentic `T-1` prepare evidence
  alone may publish at `T`; returned J preserves exact pose/velocity/flow, current/max HP, Effect instances,
  branch budget, root pair, and local branch index. Two/one/no survivor yields two/one/no J. Core impact consumes
  that branch without bounty or return.
- GPU trigger admission is independent from host starts. A bounded backlog retains five or more same-tick
  markers; actual J-lineage starts sort C′-return first, then due tick/root pair/source handle ascending and cap
  at four per fixed tick, with H's Formation quota separate. Pending prepare readback is an authoritative `T`
  publication prerequisite: it stalls/retries the same `T` without recovery. Normal capacity rejection instead
  consumes the current `T` attempt, preserves PENDING/logical backlog with no half child or recovery, and uses
  a fixed-tail fresh prepare to create a new proof/command for `T+1`.
- Core terminal sealing cancels unpublished Atomic Transform work and requires pending-zero plus J/C′ roster
  evidence. A split/return already lifecycle-published with backend `commitRequested` completes its GPU commit
  and async readback on the terminal final submit; prior/current readbacks must settle before `SEALED`, and any
  mismatch is `SEALED_FAILED`. GPU-world replacement resets AtomicTransformState, pending/due rosters,
  programs, readbacks, transactions, and stale ports; it does not reconstruct old lineage.
- Contract/data/lifecycle/director/GPU ABI/WGSL/static/Node fixture and dedicated
  `enemy-jorang-split-lineage` NW stage passed at Turn 9 together with cumulative Node and churn gates. This
  acceptance covers projectile ingress only, not execution by future producer kinds.

## R2 Enemy Ecosystem Turn 7 implemented and accepted

- Natural `basic_ring_01` R uses analytic `ring` geometry, common-C HP/speed/weight/Tower/Core values
  `1/2.5/1/0.1/1`, capability `enemy-projectile-capture`, and exact profile
  `ring-projectile-capture-01`. It is GPU-only and deliberately absent from the legacy CPU pool shape roster.
- The profile owns one slot, delay `60`, inclusive ±45° last-route-facing funnel, hidden held presentation,
  continued projectile lifetime, preserved speed, exact living-Tower-then-stored-forward aim, no Core target
  fallback, radii plus 1/1024-tile exit, forward release on R death/Core impact, expiry without release, and
  terminal cleanup of unpublished held state.
- Capture additionally requires strictly closing relative velocity; inside-cone outbound overlap is rejected.
  Host/shader/actual fixtures separate inside-inbound, boundary-inbound, outside, and inside-outbound.
- Body ABI v8 preserves prior primary/Combat/behavior/Atomic strides and adds independent 48-byte
  `ProjectileCaptureState` and 16-byte candidate planes. Runtime ABI v1 uses 64-byte capture/release headers,
  96-byte completion/release records, 32-byte profile, and 16-byte Tower target; all compute/render profiles
  remain at required maximum `9`.
- Capture is deterministic and bilateral. The same projectile slot/entity/incarnation becomes HELD, immutable
  origin provenance/lifetime is preserved, and the Simulation captured bit mirrors—not replaces—the exact peer,
  phase, sequence, generation, and timer state. Held projectiles skip movement/grid/contact/solver/source/render.
- Release is not a respawn. A privileged active-metadata mutation token binds exact record identity,
  metadataRevision, immutable provenance, next current owner/team/source/target policy, and authentic T-1 GPU
  proof. Lifecycle order is despawn → H atomic → J atomic → release → spawn; backend arm precedes registry CAS,
  and backend commit follows publication. Post-publication mismatch is recovery.
- Capture completions gate generic event publication through one coherent source-tick watermark. Exact-action
  priority is expiry/despawn, authenticated release, then held capture. R death/Core impact releases once;
  contradictory or partial bilateral evidence fails closed.
- Capture completion/release capacity exhaustion is a normal whole-batch zero-mutation result with
  `recovery=false`, no bilateral or metadata change, and later retry/backoff. ABI/identity/fingerprint/bilateral
  corruption remains recovery; the transient prepared shield prevents generic damage before late seal.
- No-Tower release remains stored-forward with a null target handle and never infers Core from
  `PLAYER_DAMAGEABLE_AND_TERRAIN`. Logical projectile/origin provenance stays exact for a future GPU
  Subject/Sentence Fireball relationship, but end-to-end Sentence execution is not implemented or claimed.
- Terminal cancels unpublished release work and removes unpublished held projectiles. A release already
  lifecycle-published with `commitRequested` completes GPU commit/readback before seal. Replacement resets all
  capture state, rosters, proof/replay/readback queues, metadata-mutation authority, and stale ports.
- Contract/data/lifecycle/director/GPU ABI/WGSL/static/Node fixture and dedicated
  `enemy-ring-projectile-capture` NW stage passed with `uncapturedErrorCount=0` and
  `deviceLostReason=destroyed`, followed by the complete cumulative gate. This evidence is not an end-to-end
  Sentence claim.

## R2 Enemy Ecosystem Turn 8 implemented and accepted

- Optional normalized routeGraph v1 adds route sets, shared forward switches, clearance/closure nodes, and
  downstream merge topology over the existing immutable Flow Field atlas. Graph-null legacy maps stay all-open;
  runtime never rebuilds TileMap blocked cells, SDF, directions, stage goals, or field links.
- Natural `basic_cork_01` Z currently uses the technical expanding-circle Cork presentation, not dedicated Cork/trapezoid geometry, with common-C `1/2.5/1/0.1/1` values, stable
  `enemy-route-closure`, exact `cork-route-closure-01`, one logical body, and helper count 0.
- GPU RouteRuntime owns `SELECT_ROUTE/TRAVEL/EXPAND/READY_TO_CLOSE/BLOCKING/WAITING/DEAD` and availability
  `OPEN/LEASED/CLOSED`. One exact `(entityId, incarnation, leaseGeneration)` owns a closure; duplicate Z waits,
  stale incarnation/ABA cannot reopen, and the authenticated host roster is bounded to eight exact leases.
- Z anchors at the authored closure entrance and visibly expands for 60 fixed ticks to radius 3/path diameter 6
  while physically nonblocking. Completion atomically publishes availability `CLOSED` and enables the
  `ROUTE_BLOCKER`. The blocker physically accepts Enemy and Tower bodies but excludes projectile physical
  pairing; ordinary projectile damage and self-hit/penetration consumption still apply, so remaining penetration
  continues through.
- `BLOCKING` Z remains a hostile Enemy noun through interaction metadata/Team; Effect targeting never derives
  noun eligibility from physical `bodyLayer`, and P Boost-on-Z is an actual-stage regression requirement.
- Future routeSet spawns select the lowest-priority open path from the latest authenticated availability
  snapshot. All-closed commands remain exact Wave backlog. Active actors switch only at an authored forward
  switch; actors beyond it advance to clearance and wait without reverse while other capabilities continue.
- A formation entry mid-spawn retains its originally selected route for every unpublished remaining member.
  Closure keeps the whole remaining group/rows in backlog with no partial row 0; reopen publishes that remainder
  on the same path in one batch. Already published actors retain ordinary reroute/wait behavior.
- Lifecycle spawn/cleanup and assignment/close/reopen evidence are graph/session/device/epoch/tick/version/
  fingerprint-qualified. Exact Z death reopens then cleans its lease. Terminal final submit and replacement
  restore all-open state, empty roster/readback/backlog bindings, and revoke stale authority.
- Dedicated `cork_dual_route_01`/`cork_dual_route_wave_01` content and the
  `enemy-cork-route-closure` hardware stage do not change the production figure-eight map/wave. The selected
  stage passed hostile-Enemy P targeting, atomic close timing, original-route formation backlog, WAIT/reroute,
  exact lease/incarnation cleanup, capacity 8, all-open teardown, recovery false, and storage maximum 9.

## R2 Enemy Ecosystem Turn 9 complete

- The injection-only showcase map/wave uses an open-ring dual-route layout and three staged waves; default
  corridor production content is unchanged.
- Cross fixtures cover P on BLOCKING Z, atomic Z availability/physical activation, Formation closure/backlog,
  Arrow/M/O during WAIT, and R/J/H reroute/wait with `recovery=false`, plus exact lease/incarnation cleanup and
  storage maximum 9.
- `run_r2_final_acceptance.mjs` executes full Node, changed-production syntax, default WebGPU and exact nine
  routed stages, both WASM checks, flow stress, render golden, title GPU smoke, diff hygiene, and three O/J/R/Z/H/P
  mixed-churn cycles. Windows uses the platform Node executable for the NW wrapper.
- Final execution: syntax `38/38`, Node `1402/1402`, hardware default plus nine selected stages, two WASM
  reproducibility checks, flow stress, render golden 10 surfaces/3 cases, both title smokes, and diff hygiene PASS.
- Mixed churn v2 used one device/session for 3/3 cycles: exact entity IDs advanced incarnation `1→2→3`, peak
  active was 8, and final churn/reserved/pending counts were zero with all routes open, recovery false, storage 9.
- Manual evidence is `automatedResult:false`; the non-interactive final run did not include a human showcase
  visual/pause-resume session. It is not claimed as manual PASS. Progress is exactly `r2 완료.`.

## Post-R2 Stabilization S1 current product routing and combat corrections

- The first title map card keeps the corridor preview/selection ID, but selecting that card constructs the R2
  showcase map with authored Wave 1 in the real `GameScene`. Wave 1 is now a deterministic performance stream
  of exactly 10,000 sequential spawn requests at five-fixed-tick intervals (last authored tick `49,996`). Its
  opening census includes `C/T/A/M/P/H/O/J/R/Z`; the bulk repeats the eight types without global actor limits,
  while the tail keeps O at its exact capacity of eight and places the second Z last so both routes cannot close
  before the stream is authored. The Stage 1 session alone uses Tower HP/Core Integrity `20,000,000`, which is
  below the signed centi-HP GPU limit and prevents ordinary combat from terminating the long run early.
  Other explicit map IDs, including an omitted
  direct-start map ID, continue through the ordinary resolver path.
- Arrow direct Tower steering is admitted only after a bounded terrain-SDF segment check. Wall-occluded SEEK
  retains immutable route flow; blocked WINDUP/CHARGE cannot synthesize Tower recoil or damage. CHARGE and
  CONTACT_RECOIL use an endpoint-normalized bounded `easeOutExpo` finite difference with lambda `10` at the authoritative 60 Hz
  fixed tick, preserving total authored distance and phase deadlines.
- A resolved Tower-selected M projectile owns its exact target, self-hit budget, and snapshotted attack damage
  independently of later source-M death. Source cleanup cancels unresolved source work only; a live projectile
  still reaches the ordinary Tower Maximum Damage Window and HP path.
- This stabilization section does not start R3 Word/Sentence, economy, Tower Share, or multi-Tower work.

## Post-R2 locked target not yet implemented

- Enemy is a normal purchasable Subject/Payload word.
- hostile attacks target Towers according to EnemyDefinition/verb policy.
- player-created enemies are real bounty-bearing hostile actors and Overtime pressure.
- multiple Towers share a conserved living stat budget; death creates permanent Lost Share.
- `The Tower shoots The Tower`, `Enemies shoot The Tower`, and `The Towers merge` are valid.
- valid self-destructive sentences execute literally.
- wave timer expiry with hostiles enters Overtime Core DOT.

## Post-R2 implementation gap

The current GPU world still lacks the remaining gameplay policy and transaction layers required for:

```text
definition-level target-policy expansion beyond the locked default team matrix
Tower Share and multiple-Tower authored state
multiple Tower group control/camera summary
hostile attack policies beyond the production Archer/M producers
GPU subject selector
GPU actor child allocator
Tower-share split/merge transaction
bounty/Siege Pressure/Overtime
```

## Closed checkpoint boundary

The Turn 4 checkpoint and Turn 9 final acceptance from `plan/0809_enemy/R2_GOAL.md` are complete. Turns 5–8
production plus Turn 9 hardening, showcase, fixtures, and final runner were accepted on 2026-08-12. This status
does not start post-R2 Word, economy, Tower Share, general child-allocation, or end-to-end Sentence work. Manual
sandbox visual QA remains future evidence and was not substituted by automated hardware acceptance.

## R1 final acceptance evidence

- Node suite: `1051/1051` PASS.
- Actual NW.js/WebGPU: NW.js `0.108.0`, Chromium `145`, NVIDIA Lovelace; adapter storage limit `10`,
  requested/profile maximum `9`; production wave 32/4 Archer schedule and HP
  `30→25→20→15→10→5→0`; exact death once; post-death fixed progress 30; final active/reserved/pending
  counts zero; `uncapturedErrorCount=0`; teardown `deviceLostReason=destroyed`.
- The actual hardware production-wave fixture deliberately uses the production wave/Director/data with
  a technical corridor-contact Tower at `(3,12)`, not the production GameScene Tower spawn `(45,15)`.
  It reports `usesProductionTowerSpawnPosition=false`; do not present it as an end-to-end GameScene
  placement proof.
- Hardware directly verifies the GPU Core proxy remains unchanged. Its endpoint-only domain sentinel is
  not wired to `GameSystem` (`coreIntegrityRuntimeBound=false`); the separate headless GameSystem tests
  prove CPU `CoreIntegrity` identity/value preservation and status visibility.
- Both WASM reproducibility gates PASS. Render golden still exits FAIL only for the exact historical
  `golden-check/overlay.effect` mismatch at RGBA byte `71272`, `maxDelta=3`; no baseline was updated and
  no new mismatch appeared.
- The Pre-R2 actual GPU race fixture performs lethal tick `2` and dead-control tick `3` without an
  intervening settle. The exact Enemy remains active and rendered (`alpha=213`), flow position advances,
  backend failure is `null`, recovery is `false`, storage maximum remains `9`, and only the exact
  Tower/lethal projectile are removed at tick `4`.
- Interactive GameScene smoke remains not executed. The first approved Computer Use attempt rejected the
  selected NW window with a contradictory owner-ID mismatch; a later attempt was stopped by the user's
  physical Escape key before app input. On the final approved retry, app discovery worked but no game window
  was running, and both explicit `sky.launch_app()` attempts failed with `node_repl exec context not found`.
  No game UI input was issued, and automated hardware PASS is not reported as manual visual PASS.

## Known historical mismatch

Some GPU migration documents contain phase-scoped statements that Tower HP was forbidden. They are
historical migration acceptance constraints and are superseded for gameplay. Current authority is
`guide/gameplay/00_design_authority.md`.
