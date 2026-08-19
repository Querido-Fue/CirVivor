# 12. Implementation Roadmap

## R0 — Guide and contract cutover

- remove no-Tower-HP and no-Enemy-word authority;
- add gameplay router and status split;
- add regression tests that reject reintroduction of superseded contracts.

## R1 — Team metadata + single Tower HP — COMPLETE (2026-08-09)

- Player/Hostile/Neutral team and target policy;
- GPU Tower authored HP 30;
- hostile projectile → Tower damage/death;
- Tower death typed event;
- zero Tower count does not fail run;
- exact source→target GPU projectile primitive with target-invalid cleanup;
- data-authored Archer/Hostile Bullet plus lifecycle-owned `HostileAttackDirector`;
- production 32-spawn/five-tick seven-ID cycle with Archer at indexes `6/13/20/27`;
- bounded production status for committed Tower HP/death and CPU Core Integrity.

Gate: PASS. Archer Bullet damages Tower `30→25→20→15→10→5→0`; last Tower death leaves
simulation running, and final registry/reservation/pending counts are zero. Actual hardware evidence uses
the production wave/Director with a technical contact Tower `(3,12)`; production GameScene placement and
CPU CoreIntegrity are covered separately by headless/UI tests. R1 completion does not complete R2.

## R2 — Enemy ecosystem — COMPLETE (2026-08-12)

Authority and routing are `plan/0809_enemy/R2_GOAL.md`, its shared contracts, and exactly one current-turn
file. The campaign is intentionally split into nine commits/checkpoints:

1. common EnemyDefinition profile/capability runtime, spawn-time stat resolution, Tower Maximum Damage
   Window/weight/contact, exact Core impact, Core depletion/terminal boundary — complete through Turn 4 gate;
2. authored wave/formation foundation and basic enemies — complete through Turn 4 gate;
3. A/M/P capability behaviors — complete through Turn 4 gate;
4. H/HX formation/merge/transform plus the cumulative Turn 1–4 validation checkpoint — complete 2026-08-10;
5. O route-flow approach, radius capture, orbit, directional defense, current `LATCH_CORE_FALLBACK`, exact future
   roster-change reacquisition contract, and whole-batch 8-slot overflow policy — complete and accepted;
6. J producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT`, dedicated `jorang`, EffectDefinition-owned stable
   non-duplicating distribution, PENDING shield, atomic 1→2 split, delayed 1→1 return, and conserved lineage —
   complete and accepted; only projectile producer execution is current;
7. R inbound/strictly-closing same-identity projectile capture/release, normal capacity zero-mutation rejection,
   stored-forward no-Tower release, logical origin provenance, and active-metadata allegiance transfer —
   complete and accepted; no Core fallback and no end-to-end Sentence claim;
8. Z optional routeGraph/RouteRuntime exact lease, nonblocking visual expansion then atomic availability/physical
   close, hostile-Enemy noun preservation, pinned remaining-formation backlog, forward reroute/clearance wait, and
   Enemy/Tower-only blocking — complete and accepted;
9. injection-only three-stage showcase, final runner, cross fixtures, and three-cycle single-device/session mixed
   churn — complete and accepted.

Turn 1's runtime uses stable `enemy-contact-combat` and `enemy-core-impact` capabilities without per-Enemy
JavaScript controller objects or empty future capability classes. Turn 1 initially used Body ABI v5; current
production uses Body ABI v8 while retaining existing primary, 40-byte `CombatState`, and 80-byte behavior
strides. Turn 6 owns an independent 48-byte `AtomicTransformState` plus 16-byte candidate plane; Turn 7 owns an
independent 48-byte bilateral `ProjectileCaptureState` plus 16-byte candidate plane rather than reusing
reserved/behavior fields. The dedicated Maximum Damage
Window profile uses 9 storage buffers and the global maximum stays 9. GPU-world replacement preserves
committed Tower HP but resets the transient window, Effect/Formation state, all J/C′ pending/due/program/
readback/lineage state, and all R held/release/proof/readback/metadata-mutation state.
Turn 8 keeps Body ABI v8 and adds independent Route Runtime ABI v1 with 64-byte body state, immutable optional
graph topology, exact availability leases, bounded Z roster/readback, and all-open replacement reset.

Validation cadence is locked: Turns 1–3 and 5–8 run only changed-production `node --check` and
`git diff --check`, although behavior tests/fixtures are authored. Turn 4 runs the first cumulative focused,
full Node, actual NW.js/WebGPU, both WASM, render-golden, and possible manual gate. That 2026-08-10 checkpoint
passed 42/42 changed-file syntax checks, 1245/1245 Node tests, default WebGPU plus all five routed hardware
stages, both WASM checks, the 1,000-case flow-field stress check, audited render golden, and diff hygiene.
Optional manual smoke was not run. Turn 9 repeats the full R2 acceptance and adds repeated stress/churn. It
must execute the default capability route plus exact nine stages: `enemy-arrow-charge`,
`maximum-damage-window`, `enemy-rhom-priority`, `enemy-pentagon-effect`, `enemy-hexa-formation`,
`enemy-octagon-directional-defense`, `enemy-jorang-split-lineage`, `enemy-ring-projectile-capture`, and
`enemy-cork-route-closure`; full/focused Node, changed-production syntax, both WASM checks, flow stress, render
golden, title GPU smoke, diff hygiene, and three O/J/R/Z/H/P churn passes are also required. Manual results stay
explicit `automatedResult:false` when unavailable.
Turn 9 final cumulative execution passed changed-production syntax `38/38`, full Node `1402/1402`, default
actual WebGPU plus every one of the nine selected stages, both WASM reproducibility checks, flow stress, audited
render golden, both title GPU smokes, diff hygiene, and 3/3 single-device/session mixed churn cycles. All ten
hardware receipts report NW.js `0.108.0`, effective storage maximum 9, exact `uncapturedErrorCount=0`, and
orderly destroyed teardown. Full/Arrow/Maximum/Rhom directly identify NVIDIA Lovelace/adapter limit 10;
Ring/Cork directly report adapter/requested/device `10/9/9`. Manual showcase remains
`automatedResult:false` because no human interactive visual/pause-resume session was executed; it is not reported
as a manual PASS. R2 progress is `r2 완료.`.

## Post-R2 product milestones

## R3 — Enemy Entity Word — COMPLETE (2026-08-16)

- normal `shopEligible` catalog/offer metadata (full Shop UI remains R8);
- typed five-slot Word/Sentence compiler/runtime with Q/E production showcase binding;
- aggregate-only GPU Enemy/Tower Subject selector with same-execution recursion exclusion;
- exact 0/N GPU Enemy actor payload prelease/materialization with no per-child JS object/readback;
- `The Tower shoots Enemies` and `Enemies shoot Enemies`;
- exact Player-kill bounty → CPU Gold and live/pending hostile, bounty-potential, Siege-Weight participation;
- GPU-world recovery preserves words, slots/cooldowns, and Gold while canceling transient executions;
- focused Node, full engine, actual WebGPU 0/1/10/256/1000 plus doubling-to-capacity, both WASM, render golden,
  and diff-hygiene acceptance.

Gate: PASS. No same-execution recursion; player-created Enemy grants ordinary exact Player-kill Gold and creates
risk. Manual interactive smoke was not executed and is not claimed as PASS.

## R4 — TowerGroup + share ledger — COMPLETE (2026-08-17; stabilized 2026-08-18)

- multiple Tower bodies;
- one GPU group movement/Aim command;
- deterministic share representation;
- HP/Power dilution;
- death → Lost Share;
- bounded group camera summary;
- atomic technical creation with shared preview/planner, exact replay, and production member capacity 256;
- source-local GPU target query and complete-group GPU-world recovery/rebind.

Gate: PASS. Arbitrary split/death sequences conserve the exact `1_000_000_000` Share budget and allow zero
Towers. Actual GPU covers 30/30 and 18/30 1→2, 0.01 HP planner reject/0.02 HP allow, 1→100 plus R3 Q Subject
count 100, capacity 256 exact/257 atomic reject, exact transaction replay, 256/1,000 runtime group control,
Hostile 256 × Tower 256 and Hostile 1,000 × Tower 256 targeting, primary death/rebind, and Core camera fallback.
The runtime-only 1,000-Tower control fixture is not a production creation-cap increase. Manual interactive smoke
was not executed and is not claimed as PASS.

## R5 — Tower Payload + actor verbs — IN PROGRESS (Turns 1–3/8 complete, 2026-08-19)

Turn 1 complete:

- append-only Shoot/Throw/Emit/Summon typed IDs/codes and immutable data-owned profiles;
- canonical fixed-Player Tower Payload plus unchanged fixed-Hostile Enemy Payload;
- all 16 Tower/Enemy Subject × verb × Payload compiled plans;
- SHIFT/SPACE candidate loadout, with production R3 Q/E retained until the Turn 4 vertical slice;
- Tower preview schema prepared for exact R4 creation preview without claiming GPU placement exactness.

Turn 1 does not claim GPU placement/materialization or end-to-end Tower Payload execution.

Turn 2 complete:

- independent ActorActionPlacement ABI v1 and GPU initialize/resolve/validate/aggregate passes;
- ActorAction profile ABI v2 canonical all-field fingerprint bound through compile/command/program/completion;
- compact-roster nearest-Tower/Core/facing and shared-Player-Aim target/direction rules;
- deterministic Summon stable-rank lattice plus authoritative-duration Throw whose speed is derived and whose
  source/landing SDF validates atomically;
- finite/SDF all-or-nothing validation, indirect dispatch, and maximum nine storage buffers;
- fixed 96-byte CPU aggregate with generation-qualified GPU output token and no record/body readback;
- dedicated actual-WebGPU coverage for all four verbs, targeting/fallback, source death, rank permutation,
  SDF atomic rejection, one-short/capacity, ABA/stale identity, and zero body commit.

Turn 2 deliberately does not publish bodies or Towers, mutate Share/cooldown, advance Throw transit, or wire the
side-plane into the endpoint. Production SHIFT/SPACE remain empty, so unavailable Tower Payload cannot reach
`AbilityRuntime`. Those are later transaction/integration turns.

Turn 3 complete:

- canonical R5 Tower payload definition plus typed `GPU_SUBJECT_ACTOR_ACTION` coordinator mode;
- replay identity over exact snapshot token/fingerprint, frozen count, command/profile, payload, tick, SDF, and
  recovery policy;
- current-living-share R4 planning after snapshot and all destination Registry/body prelease;
- TowerCreation ABI v2 placement/profile completion identity and separate seven-storage placement apply before
  the existing nine-storage HP/Share/Power + `ALIVE`-last chain;
- at most 256 metadata-only 32-byte child records, with no Subject/position/velocity readback;
- durable logical/Registry execution, generation, action, profile, and map anchor/lattice recovery metadata;
- normal `RUNTIME_UNAVAILABLE`, SDF rejection, source/group drift, zero Share, and 257 capacity rollback with
  exact 0/N Registry/body/ledger mutation.

Turn 3 deliberately does not open the production endpoint capability or SHIFT/SPACE ingress. Turn 4 owns the
Shoot vertical slice and cooldown/lifecycle connection; Turn 5 owns Throw transit advance.

- The Tower shoots The Tower;
- Enemies shoot The Tower;
- actor Shoot/Throw/Emit/Summon semantics;
- production Tower payload token/cooldown/lifecycle connection;
- Throw transit advance and action activation;
- capacity all-or-nothing.

Gate: 1→2 and high-count enemy-created Tower scenarios pass without CPU per-body objects.

## R6 — Merge

- The Towers merge;
- staged/atomic merge transaction;
- current HP/share conservation;
- death during merge;
- Lost Share unchanged.

## R7 — Wave timer, Overtime, economy

- timer/Overtime phase;
- Siege Pressure Core DOT;
- consume the R3 player-created Enemy bounty/participation inputs in settlement and Overtime phase owners;
- hostile/pending cleanup condition;
- zero-Tower final projectile victory.

## R8 — Shop, UI, checkpoint

- five-offer purchase/reroll UI using the existing R3 Enemy offer metadata;
- preview/runtime shared formulas;
- Tower group HUD;
- safe-boundary TowerGroup save/migration;
- continue/recovery.

## R9 — Hardening

- hundreds/thousands actor stress;
- GPU allocation pressure;
- deterministic replays;
- save crash matrix;
- long-run Overtime/economy soak;
- manual sandbox playtests.
