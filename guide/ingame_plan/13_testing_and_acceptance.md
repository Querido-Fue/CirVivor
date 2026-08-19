# 13. Testing and Acceptance

Current gameplay scenarios and save/event requirements are defined in
[`../gameplay/08_save_telemetry_testing.md`](../gameplay/08_save_telemetry_testing.md).
This file adds implementation gates and the minimum regression matrix.

## 1. Test layers

```text
Static contract/content validation
→ Unit
→ Property/Fuzz
→ Headless integration
→ Save crash/recovery
→ Scene/UI
→ WASM parity
→ Actual WebGPU
→ Performance/soak
→ Manual sandbox playtest
```

## 2. Design-authority regression

Static tests must fail if production guides/contracts silently reintroduce:

- Tower has no HP/death;
- Enemy is not an obtainable word;
- zero Towers automatically fail the run;
- player-created enemies have hidden no-bounty/no-wave flags;
- valid self-destructive sentences are rejected for strategy reasons;
- a small fixed Tower cap is treated as product law.

## 3. Tower HP and share

- Tower receives hostile damage and emits exact typed damage/death events.
- Tower death updates Lost Share exactly once.
- Lost Share is monotonic during the run.
- zero living Towers does not emit RunFailed.
- Core Integrity zero emits one RunFailed.
- `30/30` one-to-two creation produces two `15/15`, Power 5.
- `18/30` produces two `9/15`.
- arbitrary split/merge/death property test conserves total share budget.
- capacity rejection leaves parent/share/HP/cooldown unchanged.
- exact identity reuse cannot transfer share loss to replacement Tower.
- any derived `currentHpFixedPoint <= 0` rejects in the shared preview/planner before reservation or GPU work.
- same transaction ID replays only when its canonical descriptor/count/fixed-tick fingerprint is identical.

### Post-R4 stabilization evidence (2026-08-18)

- Focused TowerGroup/creation/recovery Node: `37/37` PASS; full Node: `1589/1589` PASS, fail 0.
- Low-current-HP 0.01 1→2 returns `REJECTED_NON_VIABLE_CURRENT_HP` /
  `NON_VIABLE_DERIVED_CURRENT_HP`; preview/runtime reason match and child/reservation/submission/existing mutation
  are zero with recovery false. Actual GPU 0.02 1→2 commits exact current HP 0.01 + 0.01.
- Production member-count authority is `THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY=256`, consumed by
  preview/preflight, runtime/gameplay status, and receipts. Actual required 256 commits all 256 Tower records;
  required 257 is an atomic capacity rejection with mutation/pending/readback zero. Body stable-slot capacity is
  separate, and the runtime-only 1,000-Tower control fixture is not production creation evidence.
- Same-ID/same-fingerprint queued, pending, and completed replay returns the exact existing receipt. The actual
  GPU replay has one prelease, one backend submission, one ledger commit, two living Towers, replay count 3, and
  protocol/recovery 0. Same ID with any altered descriptor/count/tick reports
  `TRANSACTION_FINGERPRINT_MISMATCH`; bounded completed-history eviction excludes active transactions.
- Actual creation covers 30/30 1→2 at 15/15, 18/30 1→2 at 9/15, 1→100 at current HP 0.30 each, and R3 Q Subject
  count 100. Across the fixture: requested/applied/rejected `15/13/2`, partial creation 0, reservation/readback
  leaks 0, full-body readback 0, protocol failure 0, storage maximum 9.
- Actual target query covers exact ordering distance → higher Share → lower entity ID → lower incarnation and O
  same-identity behavior. Hostile 256 × Tower 256 and Hostile 1,000 × Tower 256 have valid targets `256/1000`,
  correctness mismatch 0, GPU p50/p95 `0.196608/0.262144 ms` over 30 samples, serialized fixed-boundary p95
  `5.0/3.6 ms`, and `323.6/311.5` ticks/s. Fixed-step budget is met with dropped steps/lost time 0, storage 9,
  and no CPU roster/pose readback.
- The 256- and injected 1,000-Tower group-control cases use one command, zero per-Tower CPU commands, zero
  full-body readback, storage 7, and exact living Share `1_000_000_000`. Death moves Share to Lost Share exactly
  once. Primary death promotes/rebinds the lowest living ordinal; zero Tower reports Lost Share
  `1_000_000_000`, `NoLivingTowers`, no run failure, and Core camera fallback `(51,-27)`.
- `npm test`, both WASM reproducibility checks, default capability, R3 and R4 actual WebGPU, unchanged render
  golden (10 surfaces/3 cases, SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`), Title GPU smoke, syntax, and diff
  hygiene pass. R4 reports `uncapturedErrorCount=0`, `deviceLostReason=destroyed`, storage maximum 9, and
  protocol/recovery failure 0.
- Manual interactive GameScene smoke: `NOT EXECUTED`. Automated GPU PASS is not a manual visual PASS.

## 4. Sentence sandbox

- Enemy is accepted as Subject and Payload.
- The Tower is accepted as Subject and Payload.
- `The Tower shoots Enemies` creates real hostile actors.
- `Enemies shoot The Tower` creates Player Towers and dilutes all living stats.
- `Enemies shoot Enemies` grows between executions, not recursively within one execution.
- no-subject consumes no cooldown.
- preview/runtime subject and generated counts match.
- a dangerous valid sentence remains executable.
- atomic world-capacity failure creates zero result bodies.

### R5 Turn 1 typed-contract evidence (2026-08-19)

- Shoot/Enemy/Tower existing numeric identities remain `1/1/2`; Throw/Emit/Summon append `2/3/4`.
- All 16 Tower/Enemy Subject × four verbs × Tower/Enemy Payload combinations compile into deep-frozen plans.
- Tower Payload is canonical fixed Player; Enemy remains fixed Hostile. R3 Q/E compiled IDs and command
  fingerprint replay remain exact, while different verb profiles produce distinct identities/fingerprints.
- The R5 candidate loadout is SHIFT Tower→Tower and SPACE Enemies→Tower, but production retains only unchanged
  R3 Q/E and empty SHIFT/SPACE until the Turn 4 vertical slice. Localized display text does not affect semantic
  identity; modifiers remain structurally invalid.
- Tower preview calls the R4 creation-preview seam only for an exact Subject count and always reports GPU
  placement as non-exact. Dilution danger does not itself disable an otherwise technically valid plan.
- Focused Node `31/31`, changed production syntax `11/11`, and `git diff --check` pass. No GPU, WASM, golden,
  full Node, or manual acceptance is claimed by this restricted Turn 1 checkpoint.

### R5 Turn 2 GPU actor-placement evidence (2026-08-19)

- ActorAction profile ABI v2 normalizes each verb before WGSL encoding and computes one canonical nonzero
  fingerprint over every semantic field. CompiledAbility, AbilityExecutionCommand ABI v2/fingerprint, GPU program,
  96-byte aggregate completion, and retained token all bind the same value; replay preserves it and a valid
  semantic profile variation changes command identity.
- Production route uses the R3 Q/E loadout. SHIFT/SPACE return `EMPTY_SLOT`, queue no activation request, and
  leave cooldown at zero. No unavailable Tower Payload reaches `AbilityRuntime`, and this is not represented as
  `PROTOCOL_REJECTED`.
- Unknown Subject count previews return `SUBJECT_COUNT_NOT_EXACT`; exact zero returns `ZERO_SUBJECT`. Both set
  `executionEnabled=false`, skip Tower creation preview, and retain cooldown zero.
- Placement ABI v1 uses program/lease/aggregate/placement/transit/dispatch strides
  `224/32/96/144/80/16`. Initialize → resolve → validate → aggregate keeps records GPU-resident and CPU maps only
  the fixed aggregate. No body/Tower state is written and every stage uses at most nine storage buffers.
- Actual WebGPU passes Shoot/Emit/Summon/Throw; shared Aim; nearest Tower/Core/facing; target→velocity→facing/
  route→`+X`; source-death snapshot survival; stable rank; one-short/capacity/stale device/destination rejection;
  and exact/one-invalid all-or-nothing SDF. Throw duration 30 derives velocity from spawn-to-landing distance;
  exact source+landing SDF completes, while either invalid endpoint returns `SDF_REJECTED` with no token.
- Focused Node `45/45` PASS. Dedicated NW.js `0.108.0` receipt reports adapter/requested/device storage
  `10/9/9`, aggregate readback 96, profile fingerprint bound, record readback false, body commit 0,
  `uncapturedErrorCount=0`, and `deviceLostReason=destroyed`. Full Node, WASM, golden, and manual gates were not
  run or claimed for this restricted Turn 2 checkpoint. The separate existing R3 Enemy Word actual route also
  passed AbilityExecutionCommand ABI v2 with zero protocol/recovery/uncaptured errors and destroyed teardown.

### Post-R3 stabilization evidence (2026-08-17)

- Changed JS/MJS syntax: `34/34` PASS; full Node: `1543/1543` PASS, fail 0.
- Actor payload is initialize → parallel validate → aggregate → parallel materialize. CPU readback is the fixed
  aggregate only, storage maximum is 9, and any invalid record keeps publication at exact 0/N.
- Three actual-WebGPU runs measured fanout-256 materialization `6.3/5.4/8.5 ms` (median `6.3 ms`) and
  fanout-1000 `5.1/5.2/6.3 ms` (median `5.2 ms`). The pre-change three-run medians were `165.8 ms` and
  `1371.0 ms`, so the respective speedups are about `26.3×` and `263.7×`.
- Exact capacity commits N; one-short returns generated/cooldown/reserved/prelease 0. Preview preserves
  raw/eligible counts: 999 and 1000 execute exactly, while 1001 previews/creates 0 and reports
  `SUBJECT_BUDGET_EXCEEDED` rather than clamping.
- All ordinary Enemy definitions own explicit `siegeWeight`. J split/C′ return and H transforms conserve it;
  no tracker or adapter derives it from physics `weight`.
- A deterministic 256-step property test covers lifecycle/publication replay and exact-handle ABA reuse. The
  incremental tracker matches a fresh full-registry audit at every step and performs only its initial full scan.
- Actual generation-limit GPU coverage proves `limit - 1` is eligible, its child at `limit` is excluded from the
  next execution, a source at `limit` is excluded, and an all-excluded set returns ZERO with cooldown 0 and no
  recovery.
- Actual generated-Enemy Player kill produces exact `PLAYER_KILL`, bounty/Gold 1 once, replay 0, and complete
  registry/body cleanup. Actual generated-Enemy Core impact produces exact `CORE_IMPACT`, Gold 0, Core Integrity
  `100→99`, and complete cleanup.
- `npm test`, both WASM reproducibility checks, default WebGPU capability, three R3 actual-WebGPU runs, and the
  unchanged render golden (10 surfaces/3 cases, SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`) pass. Every R3 run reports
  protocol/recovery 0, `uncapturedErrorCount=0`, and `deviceLostReason=destroyed`.
- Manual interactive GameScene smoke: NOT EXECUTED. Automated GPU PASS is not a manual visual PASS.

### R3 Enemy Entity Word completion evidence (historical, 2026-08-16)

R3's current executable subset is `The Tower shoots Enemies` and `Enemies shoot Enemies`. Tower Payload,
`Enemies shoot The Tower`, Tower Share/group control, and Merge remain later gates even though their design
acceptance rows are retained above.

- Focused R3 Node: `42/42` PASS; full Node: `1540/1540` PASS, fail 0.
- Changed production JS/MJS syntax: `28/28` PASS.
- Tower 1→Enemy 1 completes exact states `REQUESTED → SUBJECT_SNAPSHOT_PENDING →
  DESTINATION_PRELEASE_PENDING → GPU_MATERIALIZATION_PENDING → COMMITTED`; source death after snapshot does not
  change the frozen set, and cooldown is consumed only at committed completion.
- Tower 0 returns `ZERO_SUBJECT`, generated 0, cooldown 0. Exact-capacity succeeds; one-short returns
  `REJECTED_CAPACITY`, generated 0, cooldown 0, and reservation 0.
- Enemy recursion is inter-execution only: actual GPU counts `10→20→40`, with generated `10,20`; children from
  one execution do not enter that execution's Subject set.
- Actual GPU fanout 256 produces active 512; the final-run snapshot/materialization latency is `6.3/100.9 ms`,
  body high-water 512, prelease high-water 256, one prelease transaction, hostile/Siege 512, protocol failures
  0, recovery false.
- Actual GPU fanout 1000 produces active 2000; the final-run snapshot/materialization latency is `6.0/1366.4
  ms`, body high-water 2000, prelease high-water 1000, one prelease transaction, hostile/Siege 2000, protocol
  failures 0, recovery false. Both fanouts hold ability-command/readback and payload-command/readback high-water
  at `1/1/1/1`, with payload stage retries 0.
- Repeated capacity-1000 doubling reaches counts `[10,20,40,80,160,320,640]`; generated counts are
  `[10,20,40,80,160,320,0]`. The 640-child request rejects atomically with cooldown 0 and reserved count 0.
- Every R3 actual-GPU path reports storage maximum 9, `uncapturedErrorCount=0`, and teardown
  `deviceLostReason=destroyed`. The independent default WebGPU capability gate also passes on NVIDIA Lovelace
  with adapter storage limit 10.
- The current R3 worktree also passes all exact nine R2 routed hardware stages: Arrow charge, Maximum Damage
  Window, Rhom priority, Pentagon Effect, Hexa Formation, Octagon defense, Jorang split, Ring capture, and Cork
  closure. The supplemental Rhom source-death projectile stage passes as well. Final integration updated stale
  fixture cadence/geometry/ABI expectations without weakening production fail-closed policy.
- Exact Player-kill dual proof, natural and sentence-created bounty, Core/transform zero-payout, replay/ABA
  rejection, live/pending hostile and Siege participation, shared preview formula, and recovery preservation of
  words/slots/Gold are covered by the focused suite.
- Both WASM reproducibility checks, default WebGPU capability, render golden 10 surfaces/3 cases with SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`, and diff hygiene pass.
- Manual interactive GameScene smoke: NOT EXECUTED. Automated GPU PASS is not a manual visual PASS.

## 5. Team, targeting, and enemy AI

- Player projectiles do not damage Player Towers.
- Hostile projectiles do not damage Hostile enemies.
- Walker ignores Towers and reaches/attacks Core.
- Hunter chooses Tower, retargets, and falls back to Core at zero Towers.
- Archer continues Core route while shooting Tower.
- hostile target tie-break is deterministic.
- Shoot/Throw/Emit target snapshot policies match content.

### R2 Turn 1 common-runtime coverage

- every current EnemyDefinition resolves canonical physics/combat/behavior profiles and mandatory
  `enemy-contact-combat`/`enemy-core-impact` capability IDs;
- implementation registry and minimal lifecycle/fixed-command/gameplay-event assertions reject missing or
  mismatched methods without instantiating empty future capability classes;
- production spawn path creates no per-Enemy JavaScript AI/controller object;
- stat multiplier order is base × map-global × map-per-definition × wave-global × wave-per-definition,
  followed by absolute override in the same low-to-high precedence and one final quantization only;
- same-Tower/source-tick final-damage permutations produce one deterministic maximum; equal maxima choose
  source entityId/incarnation ascending regardless of append order;
- first tick `N` expires exactly at `N + 60`; `T < expiry` is active and `T >= expiry` is expired;
- active-window lower/equal damage applies zero without rearming; a higher maximum applies only the peak delta
  and resets expiry to the winning tick plus 60;
- `DAMAGE_APPLIED.value` equals actual HP decrement, including zero and lethal HP clamp;
- a valid suppressed projectile consumes penetration/self-hit, while friendly/stale/invalid/miss/capture/
  reflect rejection consumes neither;
- continuous Enemy overlap can submit a candidate every fixed tick; Tower weight `10` and light/heavy
  inverse-mass displacement remain independent from interaction damage;
- exact Core impact applies resolved damage once, authenticates `CORE_IMPACT` cleanup, and forfeits bounty;
- same/future command collision, stale cleanup port, duplicate event, and exact-handle ABA cannot steal or
  replay the Core-impact lifecycle result;
- Core depletion closes ingress immediately, version-cancels/tombstones the exact CPU/GPU fixed-program set,
  retires all destination/control leases, completes one final cleanup commit/GPU submit, emits one `RunFailed`,
  then preserves terminal presentation/draw/status. Ordinary frame readback is absent; an already-published
  Atomic Transform or Projectile Capture release must settle its required completion readback;
- GPU-world replacement restores committed Tower HP and resets peak/expiry/provenance for the transient window.

### R2 Turn 2 coverage (validated by the Turn 4 checkpoint)

- exact 60Hz compilation of `SPAWN_FOR_DURATION`, `WAIT`, `SPAWN_GROUP`, and `SPAWN_FORMATION`, including
  authored identity, integer duration conversion, bounds, exact gate/path binding, and walkability failure;
- all same-tick spawns use one atomic batch, and rejection retries the unchanged schedule cursor/command IDs;
- `LINEAR_GRID` and `PATH_RELATIVE` initial offsets and all-at-once/sequential row timing; the Turn 2
  pending-capability behavior for `keepFormation=true` is historical and superseded by Turn 4 H Formation;
- C resolves HP/speed/weight/Tower/Core damage `1/2.5/1/0.1/1`; T resolves
  `0.7/3.5/0.6/0.1/1`, with one final spawn quantization only;
- Arrow's exact-Tower `SEEK_TOWER → WINDUP → CHARGE → CONTACT_RECOIL → RECOVER` transitions, locked
  non-homing charge direction, authoritative telegraph, opposite recoil, repeat, stale/dead Tower handling, and
  `CORE_FALLBACK` route behavior without CPU pose;
- Diamond's tick-start inclusive Core-first/Tower-second selection, persistent stop/resume, exact-handle
  invalidation, same-source/tick control-to-spawn binding, and bounded fairness/global start budget;
- selected Core projectile typed positive CPU damage is exact, atomic, deduped, and never GPU Core HP; selected
  Tower projectile must match the exact GPU winner before budget consumption/common damage-window handling;
- current authored production cycle is `C → T → A → M → C → T → Archer`, 32 spawns at five-tick intervals,
  with Archer still at indexes `6/13/20/27` and local ticks `31/66/101/136`;
- terminal cancel covers unpublished CPU requested/reserved/pending exact destination/control programs;
  lifecycle-published backend-`commitRequested` Atomic Transform work completes GPU commit/readback instead,
  and generation-qualified late callbacks are no-ops after tombstone/lease retire;
- `SEALED` requires matching owner/backend pending-zero evidence and every applicable settled readback for the
  final submit; cancel/submit/readback/evidence failure or partial completion produces `SEALED_FAILED` without losing the
  last completed fixed tick, presentation clock, camera target, or readable draw/status snapshot.

These tests/fixtures were authored in Turn 2 and received their routed cumulative behavior/hardware acceptance
at the 2026-08-10 Turn 4 checkpoint.

### Post-R2 Stage 1 combat and product-route regression

- Arrow direct Tower ownership requires a bounded current terrain-SDF segment. A wall-occluded SEEK must retain
  route flow and make bounded route progress; occluded WINDUP cannot lock a charge, and terrain-blocked CHARGE
  must enter recovery without a Tower recoil event, damage candidate, or GPU-world recovery.
- Arrow CHARGE and CONTACT_RECOIL use the endpoint-normalized bounded Expo-out finite difference with lambda
  `10` at fixed 60 Hz. Actual GPU samples must match charge `k=0/1`, recoil contact preload and physical
  `S+1 k=0`, and `S+2 k=1`; the first charge displacement remains below the `1/8`-tile SDF texel.
- A Tower-selected M projectile is sampled after canonical T+1 completion publication. After its source M alone
  is despawned, exact target identity, launch damage snapshot, self-hit budget, and live registry/GPU body remain
  unchanged. Its later exact contact must enter the common same-tick maximum/window path, reduce the selected
  Tower from `30` to `25`, leave the wrong Tower and Core unchanged, then clean the projectile once without
  recovery.
- The first title map card preserves the corridor preview ID but creates the R2 showcase map and authored Wave 1
  in the production `GameScene`. The map-select overlay must release its title overlay session before routing;
  other explicit map IDs and omitted direct-start IDs keep the legacy resolver path.

### R2 Turn 3 coverage (validated by the Turn 4 checkpoint)

- Effect contract/catalog has stable definition/emitter IDs and codes; P alone has
  `enemy-effect-emitter`, while Poison/Burn/Freeze remain data/contract/non-production fixtures with no empty
  production runtime class.
- GPU Effect A/B pools, per-body Summary, and PEmitter state are independent from the exclusive
  `EnemyBehaviorState` union. Half-open expiry is active only for
  `appliedTick <= T < expiresAtTick`; independent expirations drive Boost transitions `0↔1↔2+`.
- `1+` Boost enables regeneration and `2+` adds attack multiplication. Contact/direct damage recomputes from an
  immutable authored/resolved base, projectile damage snapshots once at spawn, and all four hostile Tower/Core
  contact/projectile channels consume the explicit Attack modifier.
- Every same-tick due P is one ordered command, with zero-partial validation and capacity commit per pulse.
  `APPLIED`, `ZERO_TARGET`, and `SOURCE_INVALID` settle only that pulse. `DEFERRED_CAPACITY` consumes no sequence/
  cadence, applies no mutation, keeps `recovery=false`, and retries the same sequence under deterministic rotating
  admission. Tests cover an admitted prefix with a deferred suffix, next-tick progress, source death/ABA,
  oversized single-pulse demand, repeated fairness, and candidate/instance/event capacity boundaries.
- Completion validation covers hierarchical session→device→epoch comparison, future-batch protocol snapshot,
  contiguous tick equality, exact APPLIED/ZERO_TARGET/SOURCE_INVALID result/count combinations, one pulse event
  per valid pulse, exact instance-event cardinality, and duplicate/missing/extra provenance rejection before
  cadence mutation.
- P cluster navigation uses tick-start bounded-grid candidates, route integration-cost/stage monotonicity, and
  bounded SDF reachability; reverse, unreachable, stale-source, and naive P×N² paths are rejected.
- Terminal fixtures cover Effect tombstone/readback retirement, no terminal pulse/regen, one final submit with
  no ordinary frame readback, matching ABI/tick/count/pending-zero evidence, and a Core-impact P removed by the
  final lifecycle commit before roster seal. Published Atomic Transform/Projectile Capture work is the explicit
  completion-readback exception. Replacement fixtures reset all Effect/P state and reject old ports/callbacks.
- The authored NW support fixture requires the Effect storage profile to remain at most 9 and teardown to leave
  zero pending programs/readbacks/roster entries and zero uncaptured WebGPU errors.

These were Turn 3 source-authorship targets and received routed cumulative acceptance at the 2026-08-10 Turn 4
checkpoint. Production separates Arrow gameplay from tracked pose, replaces formation `size` with
`memberCount + rows/columns`, and keeps Effect/P and Formation/H outside `EnemyBehaviorState`.

### R2 Turn 4 implementation and validated coverage

- Arrow gameplay uses dedicated 16-byte exact Tower-target configuration; tracked pose remains presentation/
  camera/diagnostic-only, gameplay clear is a hard gate, and terminal preserves the last tracked snapshot.
- Formation ABI v1 is independent: body/candidate strides `80/48`, prepare `48 + 144N`, transform `64 + 192N`;
  peak prepare-select/transform-aux/render storage is `9/8/8`.
- Authored formations use independent `memberCount`, explicit or layout-derived `rows/columns`, and reject
  legacy `size`; persistent keep-formation is allowed only for natural H with exact six-ring provenance.
- Natural n1 `basic_hexa_01`, transform-private n2..5 `basic_hexa_group_01`, and transform-private n6
  `basic_hexa_hive_01` all use shape `hexa`. Each merge consumes exactly two live sources and creates one body.
- The bounded Formation SoA preserves sorted original exact handles 1..6; lineage hash is correlation only.
  Natural generation is 1 and destination generation is `max(A,B)+1` with overflow rejection.
- Prepare tick N can publish only at N+1 through privileged lifecycle ingress and private opaque single-use
  WorldRegistry token. The one authentic lifecycle result is one destination spawn plus both source despawns;
  death/Core cleanup wins pre-publication and post-publication GPU failure is recovery without rollback.
- Current/max positive signed-int32 centi-HP each use `sum + trunc(sum/10)` once. H/HX uses the absolute n-table,
  permits no map/wave modifier, scales Tower contact as `[0.1,0.12,0.144,0.1728,0.20736,0.248832]`, scales
  direct Core impact as `[1,1.2,1.44,1.728,2.0736,2.48832]`, and uses bounty `[1,2,4,6,8,10]`; merge/transform
  dispositions pay no kill bounty.
- Tick-start bounded-grid/route-integration/SDF64 join selection rejects reverse progress, overflow, and naive
  H×N². Candidate order is distance²/stage delta/cost delta/root identity/slot/rotation ascending.
- Every target-tick half-open active Effect instance is independently rekeyed with exact identity/provenance/
  applied/expiry preserved. Prepared and actual counts must match; no aggregate, refresh, or silent loss.
- Terminal cancel covers prepared/armed/program/readback Formation work and forbids a final transform.
  Replacement preserves Tower HP only and resets Formation lineage/roster/transactions/presentation together
  with Maximum Damage Window and Effect/P state.
- The dedicated `enemy-hexa-formation` support stage is authored without changing the production 32-spawn,
  five-tick corridor wave.

The 2026-08-10 cumulative checkpoint validated this list through full Node, default WebGPU and all five routed
hardware stages, both WASM checks, bounded flow-field stress, audited render golden, and diff hygiene. Turn 9
subsequently passed the H-inclusive mixed churn gate; optional manual smoke was not run.

### R2 Turn 5 coverage (accepted at Turn 9)

- the O stage uses a compatible open-ring map and proves every radius-6 slot center is walkable and SDF-clear;
  the default corridor is known incompatible, has no production-wave O, and remains forbidden until Turn 9
  supplies explicit map-compatibility acceptance;
- natural O starts in route-flow `SEEK_TOWER` with invalid target/zero flags, binds the exact Tower and facing
  without enabling armor, and captures only at inclusive tick-start radius `6`;
- capture enters `ORBIT_TOWER`, disables flow, enables defense, and follows
  `0x80000000 + slot × 1/8 turn + global fixed-tick step`; slot 0 begins west and radial-angle settling never
  crosses the Tower center;
- lifecycle assigns persistent fixed-eight `RING_SLOTS` leases in `[0,4,2,6,1,5,3,7]`, reuses a same-boundary
  despawned slot, rejects full-ring due batches zero-partially without recovery, and fails corrupt/ABA metadata
  closed before reservation;
- render and the 8-storage directional classifier consume the same behavior-facing authority only after capture;
  front 3/8 hits use centi-int flat reduction `50`, fully absorbed valid hits consume projectile/self budget and
  emit a zero-value directional event, while rear/side, zero-direction, friendly, stale, and invalid cases retain
  their normal/rejected semantics;
- Tower loss from SEEK or ORBIT latches `CORE_FALLBACK`, preserves the lifecycle lease until despawn, clears
  target/defense state, resumes Core-route flow, and never reorbits in the same GPU world;
- future Tower reappearance/multi-Tower policy is roster-change reacquisition of the exact living Tower with
  lowest entity ID then incarnation, but remains inactive in the single-Tower runtime;
- >8 due O actors reject the whole fixed-tick spawn batch with zero mutation/`recovery=false` and retry by
  data-authored staggering after slot availability; showcase simultaneous O count is exactly 4;
- terminal and replacement fixtures require zero O command/readback/roster leakage, exact old-port rejection,
  fresh sentinel materialization, global storage maximum `9`, and zero uncaptured WebGPU errors.

The dedicated `enemy-octagon-directional-defense` routed NW stage and its Node/source-contract fixtures passed
at Turn 9, including the explicit compatible-map boundary above. The default corridor remains unchanged.

### R2 Turn 6 coverage (accepted at Turn 9)

- natural compatibility identity `basic_gen_01` J renders the analytic/legacy joraengi-rice-cake silhouette from
  two regular-octagon lobes and one narrow connector; transform-private
  `basic_circle_prime_01` C′ preserves its exact circle identity,
  spawn policies, canonical profiles/capabilities, common-C `1/2.5/1/0.1/1` stats, J bounty `12`, delay `60`,
  and J-lineage host start cap `4`; C′ is absent from public catalog/wave ingress;
- J/C′ profile normalization locks exact topology/source/destination/trigger/kinematics/health/bounty/Effect/
  lineage/pending/forfeit combinations and rejects cross-combination phantom profiles, accessor inputs without
  invoking getters, symbol keys, non-enumerable extras, and catalog array extras;
- Body ABI v7 host/WGSL version and offsets include independent 48-byte AtomicTransformState/16-byte candidate
  planes while prior primary/Combat/80-byte behavior strides remain unchanged; Atomic Transform Runtime ABI v1
  prepare `32+64N`, transform `48+80N`, every routed entrypoint/profile stays at required maximum `9`, and the
  atomic first-hit contact profile exposes exact transitive storage count `9`;
- producer-neutral seam fixtures prove exact source body/target/final positive damage/producer kind/
  already-validated policy/expected phase form the common ABI without projectile identity or contact-budget
  dependency. Projectile actually calls it only after `CLOSEST_ONLY`, team/target, self-hit-budget, and final
  damage validation; explosion/Effect/direct/melee remain independently callable future kinds and are not
  reported as executed;
- after the winner, `SPLIT_PENDING` shields subsequent same-valid contacts with damage `0`, source-budget `0`,
  and event `0` until success/terminal/cancel; no generic invalid contact silently gains immunity;
- one J publishes exactly two private C′ bodies or zero mutation. Both copy exact GPU pose/velocity/flow and
  start fresh full HP `1/1`; child0 receives ceil/remainder uint32 bounty, while each Effect instance moves once
  according to its `EffectDefinition`. Penta Boost uses stable instance ID modulo destination count; the legacy
  destination word remains reserved zero and no global child0-only rule remains;
- exact lineage uses the natural root `(entityId, incarnation)` pair. `branchIndex` is local split order `0/1`,
  not a lineage-global identity; bounty edges include `12→[6,6]`, `1→[1,0]`, `0→[0,0]`, recursive
  zero-budget return/resplit, and rejection of fractional/negative/overflow values before mutation;
- each living C′ independently prepares at `T-1` and returns 1→1 at `T=publication+60`, preserving exact
  pose/velocity/flow, current/max HP, Effect instances, branch budget, root pair, and local branch order.
  Two/one/no survivors return two/one/no J; Core impact consumes a branch without bounty or return;
- five or more same-tick valid ENTER_ONLY hits all produce first-hit marker/PENDING and consume each projectile
  budget once. GPU admission is not max4; authentic preparation orders C′ due first, then due tick/root pair/
  source handle ascending, and actual host starts are `4` then the remaining `1` next tick;
- pending prepare readback is an authoritative `T` publication prerequisite, not recovery: the fixed world
  stalls/retries the same `T` until that readback is available;
- normal capacity rejection is zero-partial, `recovery=false`, preserves source PENDING/logical backlog, consumes
  the current `T` attempted command/proof, and uses a fixed-tail fresh prepare for a new `T+1` command. It does
  not replay old evidence, create a half child, or collide with H's separate Formation seam;
- terminal/replacement/ABA fixtures reject old generation callbacks and identities. They cancel unpublished
  prepared/armed work, but require a lifecycle-published backend-`commitRequested` split/return to finish GPU
  commit plus async readback on the terminal final submit. Prior/current readbacks and owner/backend
  ABI/tick/pending-zero evidence must settle with fixed/lifecycle/roster seal; mismatch is `SEALED_FAILED`.
- shared generic topology/transaction tests retain H `MANY_TO_ONE` exact behavior while separately asserting
  J `ONE_TO_MANY`/C′ `ONE_TO_ONE_DELAYED`, per-definition non-duplicating Effect distribution and reserved
  legacy destination word `0`, and profile-discriminated
  capability roster routing.

The dedicated `enemy-jorang-split-lineage` routed NW stage and its contract/data/lifecycle/director/GPU ABI/
WGSL/static/Node fixtures passed at Turn 9, including bounded capacity/incarnation churn. Projectile is the
only connected producer; future producer kinds are not reported as executed.

### R2 Turn 7 coverage (accepted at Turn 9)

- `basic_ring_01`/`ring-projectile-capture-01` owns exact common-C stats, one capture slot, delay `60`,
  inclusive ±45° funnel plus strictly-closing relative velocity, last-nonzero-route facing, hidden held presentation, continued lifetime, preserved
  speed, exact living-Tower-then-stored-forward aim, no Core target fallback, radii+1/1024 exit, forward
  death/Core release, expiry without release, and terminal unpublished cleanup;
- Body ABI v8 preserves all prior strides and adds exact 48-byte bilateral ProjectileCaptureState/16-byte
  candidate planes. Runtime ABI v1 fixes capture/release headers at 64 bytes, completion/release records at 96,
  profile at 32, Tower config at 16, all field offsets/enums, and every compute/render profile at maximum `9`;
- actual GPU capture proves deterministic one-slot matching, inclusive funnel boundaries, bilateral peer
  slot/entity/incarnation/phase/sequence/generation, exact Simulation mirror, continued lifetime, and exclusion
  from held movement/grid/contact/solver/source/render paths;
- host/shader/actual WebGPU fixtures distinguish inside-inbound, boundary-inbound, outside, and inside-outbound;
  outbound overlap cannot capture;
- release keeps the same slot/entity/incarnation and immutable origin provenance while exact registry
  metadataRevision CAS changes current Team/owner/source/target policy. Speed magnitude, exit clearance,
  living-Tower aim, and stored-forward fallback with null target handle are checked without a despawn/spawn
  identity reset; Core is not inferred through `PLAYER_DAMAGEABLE_AND_TERRAIN`;
- capture-completion and release capacity exhaustion reject the whole batch with no bilateral or metadata
  mutation and `recovery=false`, then retry/backoff later. ABI/identity/fingerprint/bilateral corruption remains
  recovery, and the transient prepared shield prevents generic damage before late seal;
- capture retry treats retained exact pairs as bounded fairness metadata, not current gameplay authority. Every
  retry reauthenticates current contact, live identities, predicted geometry, captor facing, relative velocity,
  inclusive funnel, and strict closing; invalid/no-contact/outbound/dead/ABA pairs contribute zero demand and
  the next normal tick clears their Candidate16 state without recovery;
- logical projectile/origin provenance remains exact across capture/release for a future GPU Subject/Sentence
  Fireball relationship, but no end-to-end Subject/Sentence execution is claimed;
- capture completion is authenticated before generic death/Core events from the same source tick. Expiry/
  tombstone wins over release, authenticated release wins over held capture, and contradictory duplicates or
  bilateral/mirror mismatch fail recovery rather than partially mutate;
- R death and reciprocal Core impact release exactly once, while projectile expiry clears the slot without
  release. Stale Tower loss restages a fresh stored-forward proof; old evidence is never replayed as a new
  transaction;
- terminal fixtures distinguish unpublished held/prepared cleanup from lifecycle-published
  `commitRequested` release completion. Prior/current readbacks, owner/backend/host-cleanup counts, fixed/
  lifecycle/roster observations, and pending zero must settle before seal; replacement revokes old ports and
  clears capture/proof/replay/readback/metadata-mutation state;
- coexistence and slot-reuse fixtures retain O/P/H/J behavior, clear old peer/sequence/candidate words on
  tombstone/reuse, keep global storage maximum `9`, and require `uncapturedErrorCount=0`.

The dedicated `enemy-ring-projectile-capture` routed NW stage and its contract/data/lifecycle/director/GPU
ABI/WGSL/static/Node fixtures passed at Turn 9, with `uncapturedErrorCount=0` and teardown
`deviceLostReason=destroyed`. The subsequent cumulative runner passed all remaining R2 gates. No-Tower release
still keeps stored forward with a null target and no Core inference; provenance is not end-to-end Sentence proof.

### R2 Turn 8 coverage (accepted at Turn 9)

- optional routeGraph v1 normalization covers exact route sets, node memberships, forward switches,
  closure/clearance/merge ordering, stable priorities, duplicate/unknown references, and legacy graph-null
  all-open compatibility without changing TileMap blocked/SDF/flow authority;
- dedicated `cork_dual_route_01` has two paths with one shared entry/switch and downstream merge, while its
  injection-only wave binds one Z plus two future C actors to a routeSet. Production figure-eight map/wave remains
  graph-null and contains no Z;
- `basic_cork_01`/`cork-route-closure-01` owns exact common-C stats, circle shape, helper count `0`, radius `3`,
  expansion `60`, deterministic lowest-open policy, duplicate-wait conflict policy, exact-owner-death reopen,
  clearance-wait policy, and bounded host roster capacity `8`;
- Route Runtime ABI v1 fixes body state at 64 bytes, topology header at 96, availability header/record at 64/32,
  cleanup header/record at 32/32, host/WGSL enum/offset parity, graph content fingerprint, and a maximum of 9
  storage buffers for advance/finalize;
- lifecycle spawn atomically registers the Z exact roster/binding and whole-batch capacity rejects before
  registry/backend mutation. Despawn reopens then cleans the exact `(entityId, incarnation, leaseGeneration)`;
  stale incarnation, ABA, replay, duplicate owner, version regression/exhaustion, and partial evidence fail closed;
- actual GPU behavior covers SELECT_ROUTE/TRAVEL/EXPAND/READY_TO_CLOSE/BLOCKING, exact 60-tick radius growth,
  anchored position/inverse mass, one close event, no helper body, and deterministic second-Z waiting;
- EXPAND is visually growing but physically nonblocking; one explicit completion-boundary assertion requires
  availability `CLOSED` and `ROUTE_BLOCKER` physical activation together, with neither observable early;
- future routeSet spawn chooses the open alternative from the authenticated availability snapshot; all-closed
  keeps the exact Wave command/cursor. An active upstream actor reroutes only at the authored forward switch,
  while one past it reaches clearance, waits without reverse, and keeps other capability state;
- expanded Z blocks Enemy and Player Tower physical pairs but not projectile physical movement. Projectile damage
  still applies to Z, normal self-hit/penetration is consumed once, and remaining penetration continues;
- blocking Z remains a hostile Enemy noun by interaction metadata/Team rather than physical bodyLayer; actual P
  Boost-on-blocking-Z covers this regression;
- a formation entry that closes mid-spawn keeps its original route and the whole unpublished group/rows in
  backlog, publishes no partial row 0, then reopens into one same-path batch. Already published actors retain
  ordinary forward-switch routing; any future remaining-formation reroute must be whole-formation atomic;
- cross fixtures keep Formation state across closure, Arrow/M/O capabilities active during route WAIT, and
  R/J/H state intact during reroute/wait with `recovery=false`;
- exact death reopens once and wakes/reroutes dependent actors. Terminal/replacement tests require all-open
  availability, zero roster/staged/readback/cleanup/backlog binding, old-port rejection, global storage maximum 9,
  and `uncapturedErrorCount=0`.

The dedicated `enemy-cork-route-closure` routed NW stage and its contract/data/lifecycle/director/GPU ABI/WGSL/
static/Node fixtures passed when Turn 9 explicitly selected the stage. Actual evidence includes hostile-Team/
Enemy-interaction P targeting of physical `ROUTE_BLOCKER` Z, nonblocking LEASED tick 61 followed by atomic
CLOSED+blocker tick 62, two-member original-path formation backlog/reopen with no partial row, Arrow/M/O WAIT,
R/J/H state-preserving reroute, exact cleanup/capacity 8, all-open terminal/replacement, and storage maximum 9.

The J/O/R/Z carry-forward contracts above and their support/actual fixtures are accepted. Together with the
final cumulative runner, this section records R2 COMPLETE while preserving the explicit future-only seams.

## 6. Wave and Overtime

R3 implements the player-created Enemy bounty and live/pending hostile/Siege participation inputs in the list
below. Timer expiry, Overtime transition/DOT, Wave Clear, and final victory consumption remain future acceptance.

- timer expiry with live/pending hostiles enters Overtime once.
- player-created enemies count toward hostile cleanup and Siege Pressure.
- player-created enemy kill grants ordinary bounty exactly once.
- enemy death during Overtime reduces pressure.
- enemy creation during Overtime increases pressure.
- Wave Clear requires timer expired plus live/pending hostile actors zero.
- transient hostile projectiles are cleaned according to explicit policy.
- final projectile can win after last Tower death.
- Tower count never blocks Wave Clear/Victory.

## 7. Merge

- H merge accepts only two exact live n1..5 sources whose combined count is at most six.
- current/max centi-HP each use exact `sum + trunc(sum/10)` and reject overflow/current>max/dead sources before mutation.
- n2..5 produces one transform-private group; n6 produces one transform-private HX; direct authored destinations fail.
- sorted exact original lineage is preserved; duplicate/stale/ABA sources and lineage/hash drift fail atomically.
- every half-open active Effect instance rekeys independently and count mismatch leaves no successful transform.
- `MERGE_CONSUMED`/`TRANSFORM_CONSUMED` sources do not emit ordinary kill bounty.

## 8. Save schema

- safe-boundary TowerGroup ledger round-trip.
- `livingShare + lostShare == totalShareBudget`.
- zero living Towers is valid.
- current HP fits derived Max HP.
- pre-HP schema migration initializes safe full-share state without resurrecting an in-run loss.
- mid-wave transforms/projectiles/executions remain excluded.
- save failure never reapplies settlement, reward, or shop transaction.

## 9. GPU acceptance

R3 completes the Enemy-only actor child allocation rows. R4 completes Tower group movement/share, technical
creation, source-local targeting, and recovery rows. R5 Turn 2 completes actor placement evidence only; Tower
actor-payload token consumption/body+Share publication remains a later R5 gate.

- team/target/share metadata host/WGSL compatibility.
- GPU Tower HP/death and hostile projectile contact on actual NW.js/WebGPU.
- group movement/aim selector works for many Towers without per-body CPU commands.
- actor child allocation is all-or-nothing and leak-free.
- Tower death event resolves exact share metadata before cleanup.
- no full-body frame readback.
- old generation event/result/summary cannot mutate current domain.
- an exact control that races after GPU death is a normal no-op, while structural/identity corruption remains a hard failure.
- lazy recovery replacement accepts healthy `gpu-deferred` initialization without replacing or replaying survivors mid-wave.
- storage-buffer count stays within platform policy.
- Body ABI v8 host/WGSL mismatch fails closed; the 40-byte `CombatState`, 80-byte `EnemyBehaviorState`,
  48-byte `AtomicTransformState`, 48-byte `ProjectileCaptureState`, and both 16-byte candidate side-planes are
  sized/versioned exactly.
- BodyControlProgram v2 record/state strides are exactly `96/64`; SpawnProgram v4 record stride is exactly
  `96`, and selected-target control/spawn readback rejects generation/epoch/fingerprint drift.
- maximum-damage-window storage profile is 9 and no compute profile exceeds 9.
- Effect Runtime ABI/version/stride and A/B pool/Summary/PEmitter layouts match host/WGSL; every Effect compute
  profile uses at most 9 storage buffers and the pulse/navigation path has no full-body readback.
- Effect terminal evidence matches final/submitted tick, armed/submitted count, and pending program/readback
  zero before `SEALED`; old session/device/epoch callbacks are no-ops after replacement or terminal cancel.
- Formation ABI v1 host/WGSL stride/version mismatch fails closed; prepare-select/transform-aux/render storage
  stays within `9/8/8`, exact N→N+1 publication and transform/effect-rekey completion are authenticated, and
  terminal/replacement leave zero prepared/armed/readback/lineage leaks.
- Atomic Transform Runtime ABI v1 host/WGSL stride/version mismatch fails closed; prepare/transform layouts are
  `32+64N`/`48+80N`, routed profiles require at most 9 storage buffers, exact T-1→T publication/effect rekey is
  authenticated, and terminal/replacement leave zero pending/due/prepared/armed/readback/lineage leaks.
- Projectile Capture Runtime ABI v1 host/WGSL stride/version mismatch fails closed; capture/release headers are
  64 bytes, completion/release records are 96, profile/Tower config are 32/16, routed compute/render profiles
  require at most 9, and terminal/replacement leave zero held/prepared/armed/readback/roster/metadata-CAS leaks.
- Route Runtime ABI v1 host/WGSL stride/version mismatch fails closed; 64-byte body state, 96-byte topology
  header, 64/32 availability and 32/32 cleanup layouts match exactly, advance/finalize requires at most 9 storage
  buffers, and terminal/replacement leave all routes open with zero Z roster/staged/readback/cleanup leaks.
- ActorAction profile ABI v2 fingerprint covers every semantic field and matches CompiledAbility, execution
  command, ActorActionPlacement program, aggregate completion, and retained token. Placement ABI v1 strides are
  `224/32/96/144/80/16`; compute peaks at 9 storage buffers, reads back only 96 bytes, and writes no body state.
- Throw treats duration as authority, derives ground velocity from spawn-to-landing distance, and validates both
  endpoints against finite/world/SDF gates before the all-or-nothing aggregate can complete.
- actual hardware fixture covers order-independent Maximum Damage Window, valid-zero projectile budget,
  continuous overlap/expiry, weight displacement, capacity preflight atomicity, exact Core cleanup, and terminal seal.
- D1 mixed-producer hardware coverage requires contact, Arrow/Archer, and M Tower candidates to select one
  deterministic same-tick winner, requires a higher active peak to reset expiry, and rejects any M direct-HP
  bypass. Its separate Core direct-request pass and every Effect profile must keep the global storage maximum 9.
- Turn 2 hardware fixture additionally covers Arrow charge/telegraph/non-homing/recoil/Core fallback and M's
  exact Core-first/Tower-selected projectile branches, typed Core request, persistent stop/resume, stale-target
  rejection, and zero final active/reserved/pending counts.
- terminal fixture proves versioned cancellation of unpublished CPU/GPU programs, unpublished-held projectile
  cleanup, and exact destination/control lease retirement, while an already lifecycle-published backend-
  `commitRequested` Atomic Transform or projectile release completes on the final submit and settles its async
  readback. It requires owner-armed/backend-submitted/host-cleanup/pending-zero, preserved director fixed/
  lifecycle observations and roster seal, late-callback no-op, and fail-closed `SEALED_FAILED` for any partial
  or mismatched evidence.
- `uncapturedErrorCount=0`.

## 10. Existing engine gates

From project root:

```text
npm test
npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:webgpu:capability
npm run test:webgpu:r3-enemy-word
npm run test:webgpu:r4-tower-group
$env:CIRVIVOR_WEBGPU_FIXTURE_STAGE='actor-action-placement'; node project/game/test/support/run_nw_webgpu_capability.mjs
npm run test:render:golden
npm run test:title-gpu:smoke
git diff --check
```

The render-golden baseline must not be silently updated. Turn 4 explicitly audited the stale `overlay.effect`
baseline to historical commit `57f60a3` (vignette intentionally included in the backdrop), used the official
update command, and reran the check. This was historical baseline synchronization, not a Turn4 visual change.

### R2 routed validation cadence

```text
Turns 1, 2, 3, 5, 6, 7, 8
  author production/tests/fixtures
  run changed production JS/MJS node --check
  run git diff --check
  do not run behavior suites, npm test, NW/WebGPU, WASM, golden, or manual smoke

Turn 4
  run cumulative Turns 1–4 focused/full Node
  actual NW.js/WebGPU, both WASM checks, render golden, possible manual smoke
  git diff --check

Turn 9
  run full R2 focused/full Node and changed-production JS/MJS node --check
  run actual NW.js/WebGPU default capability route
  explicitly run enemy-arrow-charge, maximum-damage-window, enemy-rhom-priority,
    enemy-pentagon-effect, enemy-hexa-formation, enemy-octagon-directional-defense,
    enemy-jorang-split-lineage, enemy-ring-projectile-capture, enemy-cork-route-closure
  both WASM checks, flow-field stress, render golden, title GPU smoke
  run O/J/R/Z/H/P mixed churn three times
  possible manual smoke; unavailable is exact reason + automatedResult:false, never a fabricated PASS
  git diff --check
```

`project/game/test/support/run_r2_final_acceptance.mjs` authors this final sequence and uses the platform Node
executable to launch the NW wrapper on Windows. The Ring stage must be selected explicitly with
`CIRVIVOR_WEBGPU_FIXTURE_STAGE=enemy-ring-projectile-capture npm run test:webgpu:capability` in addition to the
default capability command. The final 2026-08-12 cumulative execution exited `0` and recorded:

- changed production JS/MJS syntax: `38/38` PASS;
- full Node: `1402/1402` PASS, fail 0;
- actual WebGPU default plus all nine selected stages: PASS; every receipt directly reports NW.js `0.108.0`,
  effective storage maximum 9, `uncapturedErrorCount=0`, and teardown `deviceLostReason=destroyed`;
- direct adapter detail: Full/Arrow/Maximum/Rhom identify NVIDIA Lovelace with adapter limit 10; Ring/Cork
  explicitly report adapter/requested/device storage `10/9/9`;
- both WASM reproducibility gates: PASS;
- flow stress: seed `0x71c0ffee`, 1,000 cases, 3,824,454 cells, 3 ABI canaries, PASS;
- mixed churn v2: one device/session, 3/3 cycles, stable generation tuple and exact incarnation reuse,
  peak active 8, final churn/reserved/pending 0, route all-open, recovery false, storage maximum 9;
- render golden: 10 surfaces, 3 cases, SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`, PASS with no baseline update;
- title UI `webgpu-kawase + cpu` smoke and explicit production `webgpu-gaussian + gpu` smoke: PASS; both
  receipts set `budgetRequired:false`, so raw p99 remains diagnostic rather than a 1 ms acceptance claim;
- `git diff --check`: PASS.

The aggregate stderr may also contain Chromium
`command_buffer_proxy_impl: GPU state invalid after WaitForGetOffsetInRange` lines at independent NW process
teardown boundaries (`device.destroy → lost: destroyed → result publication → App.quit`). The fixture wrapper
waited for each process close, every corresponding result remained PASS with exact
`uncapturedErrorCount=0`/`deviceLostReason=destroyed`, and the cumulative runner exited `0`. This is classified as
Chromium teardown IPC noise, not a WebGPU uncaptured-error or acceptance blocker. Its line count is run/process
dependent and is not an acceptance metric. Do not claim aggregate stderr was empty or clean.

Manual showcase evidence is `automatedResult:false`. Exact reason: the cumulative runner was non-interactive,
and no human showcase play/visual verification or pause/resume session was executed. Automated hardware PASS is
not substituted for manual visual PASS.

Therefore Turn 1 test authorship plus static hygiene was not itself behavior/hardware acceptance. The first
new R2 cumulative PASS was recorded only after the Turn 4 checkpoint succeeded on 2026-08-10.

Turn 4 actual-hardware stages all passed:

```text
maximum-damage-window
enemy-arrow-charge
enemy-rhom-priority
enemy-pentagon-effect
enemy-hexa-formation
```

Additional Turn 4 evidence:

- changed JS/MJS syntax: 42/42 PASS;
- full Node: 1245/1245 PASS;
- default NW.js/WebGPU route: PASS;
- WASM flow and collision reproducibility: PASS;
- flow-field stress: seed `0x71c0ffee`, 1,000 cases, 3,824,454 cells, ABI canary 3 layouts, PASS;
- render golden: 10 surfaces, 3 cases, final SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`, PASS;
- `git diff --check`: PASS.

There is no separate repeated H stress/churn script in Turn 4. The bounded `enemy-hexa-formation` hardware
scenario passed; the final Turn 9 mixed churn subsequently completed 3/3 cycles. Optional manual smoke was not
run and is not reported as PASS.

### R1 completion evidence (2026-08-09)

- Exact production wave: seven-ID cycle, 32 spawns at five-tick intervals, Archer indexes
  `[6,13,20,27]` and local ticks `[31,66,101,136]`.
- Headless production GameSystem: four Archer lifecycle registrations, completion-only cooldown,
  Tower HP/death, zero-Tower continuation, alive/dead recovery, 12 exact-incarnation churn cycles,
  bounded terminal history, and no reservation/pending leak.
- Production status: bounded deep-frozen `GameSystem` snapshot; committed Tower roster HP/death and CPU
  CoreIntegrity only; canonical UI layout; CPU fallback `TOWER N/A`; benchmark child receives no HUD port.
- Actual NW.js/WebGPU: NW.js `0.108.0`, Chromium `145`, NVIDIA Lovelace; adapter storage limit `10`,
  requested/profile maximum `9`; Tower HP `[30,25,20,15,10,5,0]`; one death; 30 post-death ticks;
  final active/reserved/pending zero; `uncapturedErrorCount=0`; `deviceLostReason=destroyed`.
- Hardware fixture limitation: it uses the production wave/data/Director but a technical Tower at `(3,12)`,
  not the production GameScene spawn `(45,15)`. Its GPU Core proxy is verified unchanged, while its CPU
  domain sentinel is intentionally unwired (`coreIntegrityRuntimeBound=false`). Headless GameSystem tests
  separately prove CPU CoreIntegrity identity/value preservation.
- `npm test` passes `1051/1051`; both WASM reproducibility gates pass. `test:render:golden` continues to
  exit FAIL only for the historical `golden-check/overlay.effect` RGBA byte `71272`, `maxDelta=3`.
  The baseline is not updated and there is no new mismatch.
- Interactive smoke is recorded as not executed: the first approved Computer Use attempt rejected the NW
  window with a contradictory owner-ID mismatch, a later attempt was stopped by the user's physical Escape
  key before app input, and the final approved retry discovered apps but failed both explicit game launches
  with `node_repl exec context not found`. Automated hardware evidence is not substituted for manual visual PASS.

### Pre-R2 stabilization evidence (2026-08-09)

- Root cause classification: normal Tower death timing produced recovery/render disappearance, not Enemy-wide
  logical cleanup and not merely camera projection. The first broken invariant was the fixed-control header:
  an exact control submitted before CPU death readback saw ALIVE clear and was incorrectly encoded as
  `RECORD_INVALID`, causing `event-readback` authoritative rebuild and GPU canvas clear/skip.
- The shader now validates structural/range/exact identity/flow/move first, treats only the exact dead target as
  a no-op, and still applies live records in the same batch. Recovery preflight separately accepts healthy
  lazy `gpu-deferred|gpu-ready` endpoints and preserves the old world atomically on every rejected candidate.
- Actual NW.js/WebGPU no-settle fixture: lethal source tick `2`, dead-control source tick `3`, cleanup tick `4`;
  live control moved, selected Enemy identity and flow persisted, render alpha remained `213`, backend failure
  was `null`, recovery remained false, adapter storage was `10` with requested/profile maximum `9`,
  `uncapturedErrorCount=0`, and teardown reason was `destroyed`.
- Headless production GameSystem preserves exact Enemy handles, endpoint/session/registry identities, flow/draw
  progress, CoreIntegrity, and zero restart count for 30+ post-death ticks; pending requested, GPU-pending,
  target-invalid, and already-resolved projectile paths remain normal non-recovery outcomes.
- Tooltip schema is `default=0.30`, `min=0`, `max=2`, `step=0.01`, `precision=2`; midpoint quantization,
  preview/save/reload/cancel, two-decimal display, zero-delay eligibility, and unchanged fade are covered.
  The slider also consumes hover-owned semantic left/right edges through the same quantizer and directly
  verifies `0.27→0.28→0.27`, one change/commit per edge, and animated display settlement.
- Production animation callers are exactly `UI=13`, `GAME_MECHANIC=2`, `EFFECT=4`. Hidden
  `uiAnimationDurationScale` defaults to `1`, clamps to `0.1..4`, and only UI Standard/Mixed/Persistent/retarget
  time is scaled; gameplay/fixed/effect timing is unchanged.
- Changed-source `node --check` passed for 56 JS/MJS files; Node passed `1051/1051`, both WASM gates passed,
  actual NW.js/WebGPU passed, and `git diff --check` passed. Render golden reproduced only the known
  `overlay.effect` byte `71272`, `maxDelta=3` mismatch; the baseline was not changed.
- This is historical Pre-R2 stabilization evidence. R2 Turn 1 now implements the common Enemy profile/
  capability runtime, Tower Maximum Damage Window/weight/contact, exact Core impact, and Core defeat terminal
  boundary; later enemy-specific behavior, economy, multi-Tower/share, Word/Sentence, and other owners remain.

R2+ share, generalized hostile objectives beyond the current foundation, economy, Word/Sentence, and full UI
acceptance items below remain future gates rather than R1 or Turn 1 PASS claims.

## 11. Performance/soak

- 100–500 scheduled/player-created hostiles;
- hundreds of Towers from Enemy Subject execution;
- repeated Enemy↔Tower mutual creation under hard capacity;
- recursive multi-execution words;
- long Overtime and bounty farming;
- 100 Wave→Shop→Continue cycles;
- repeated split/merge/death/save/reload;
- stable entity/UI/listener/resource counts after map transition.

Approval requires actual fixed tick progress and p95/p99 data, not visual FPS alone.

For the current `performance_serpentine_02` / `performance_serpentine_wave_01` 10,000-request workload, the D1
receipt must bind HEAD commit/tree/worktree content and exact map/wave content keys. It records per-definition
spawn counts, body/projectile/effect/contact high-water, fixed completed/failed/dropped, lost simulation time,
simulation-progress ratio, frame/fixed CPU p50/p95/p99, GPU limits, storage maximum, overflow, recovery/restart/
protocol/uncaptured errors, and device-loss reason. PASS additionally requires the complete workload, fixed
failed/dropped/lost all zero, recovery/restart/protocol/uncaptured/overflow all zero, and storage maximum at most
9. A partial or diagnostic run is never promoted to performance PASS.
