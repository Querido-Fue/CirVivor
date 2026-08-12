# R2 Turn 4 — Persistent Formation Runtime and H/HX Checkpoint

이 턴은 첫 번째 R2 누적 전체 검증 체크포인트다. Production/author-test 구현 사실과 실제 checkpoint
PASS를 구분한다.

## Current status

```text
r2t4 수행 완료.
```

Arrow correction, formation schema correction, independent Formation ABI/runtime, H/HX transform, and their
focused author fixtures are implemented. On 2026-08-10 the cumulative Turn 1–4 checkpoint passed changed-file
syntax 42/42, Node 1245/1245, default WebGPU plus all five dedicated hardware stages, both WASM checks, the
1,000-case flow-field stress check, the audited render-golden check, and `git diff --check`. Repeated H/R2
stress/churn remains Turn 9 scope, and the optional manual smoke was not run or claimed as PASS.

## 1. Mandatory carry-forward corrections — implemented and validated

1. Arrow gameplay targeting is separate from `tracked_pose_config` and tracked-pose readback. Tracked pose is
   presentation/camera/diagnostic-only. Gameplay selection, validity, charge, and aim use the dedicated exact
   16-byte `TOWER_GAMEPLAY_TARGET_CONFIG` binding/port. Gameplay target clear is a hard gate; terminal keeps the
   last committed tracked presentation snapshot frozen.
2. Formation authoring uses `memberCount` for live members and separate `rows`/`columns`, explicit or exactly
   derived from the rectangular layout. `memberCount` is not a grid dimension. Legacy `size`, partial dimension,
   layout/member, symbol, route, and walkability mismatch fail before mutation.
3. `ENEMY_BEHAVIOR_STATE` remains the exclusive basic movement/attack-program union. Effect/P and
   Formation/H/HX are independent capability/state domains and do not append variants to that union.

Minimum correction audit surfaces:

```text
Arrow exact gameplay target binding
  project/game/script/module/ingame/physics/gpu/gpu_fixed_primitive_abi.js
  project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js
  project/game/script/module/ingame/physics/gpu/gpu_collision_shaders.js
  project/game/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js
  project/game/script/module/ingame/object/game_object_system.js
  project/game/test/gpu_enemy_arrow_charge_contract.test.mjs
  project/game/test/gpu_circle_body_simulation_contract.test.mjs

Formation member/dimension schema
  project/game/script/module/ingame/flow/authored_wave_timeline_contract.js
  project/game/script/module/ingame/flow/wave_director.js
  project/game/test/authored_wave_timeline_formation.test.mjs

State-domain independence
  project/game/script/module/ingame/contract/enemy_formation_contract.js
  project/game/script/module/ingame/physics/gpu/gpu_formation_runtime_abi.js
  project/game/test/enemy_profile_capability_resolved_spawn_stats.test.mjs
  project/game/test/enemy_formation_contract_data.test.mjs
```

These paths are an audit floor, not permission to ignore other call sites found by `rg`.

## 2. Independent Formation runtime

Stable real interfaces:

```text
IFormationCoordinateSystem
IFormationSlotGraph
IFormationMembership
IFormationMotionPolicy
IFormationAtomicTransform
```

`GameObjectSystem` owns one bounded `FormationRuntimeDirector` primitive SoA. It stores active formation facts
and 1..6 sorted original exact handles without per-member/per-group JS AI objects. The endpoint owns one bounded
generic `GpuFormationCommandOwner` for whole-tick prepare, replay/protocol authentication, arm/commit,
completion, terminal cancel, and recovery evidence. Exact handle→slot resolution remains private to GPU
simulation.

Formation ABI v1 byte authority:

| Plane/program | Layout |
| --- | ---: |
| body state | 80 bytes |
| candidate state | 48 bytes |
| prepare | 48-byte header + 144-byte records |
| transform | 64-byte header + 192-byte records |

Storage-buffer maxima are prepare-select `9`, transform-auxiliary `8`, and render `8`; the platform policy stays
`<= 9`. The routed WebGPU gates validated these bounded layouts on hardware.

Backend seam:

```text
stageFormationPrepareBatch
drainCompletedFormationPrepareBatches
armPreparedFormationTransformBatch
commitArmedFormationTransformBatch
cancelArmedFormationTransformBatch
cancelPendingFormationProgramsForTerminal
getFormationRuntimeStatus
```

## 3. H/HX identity and authored provenance

```text
n1 natural                basic_hexa_01
n2..5 transform-private   basic_hexa_group_01
n6 transform-private HX   basic_hexa_hive_01
formation                 hexa-hive-six-ring-01
shapeDefinitionId         hexa
```

Natural/direct spawn of group/HX is forbidden. H/group carry `enemy-formation + enemy-atomic-transform`; HX
keeps `enemy-formation` and has no further transform capability. `keepFormation=true` authoring is accepted only
for natural H with exact `HEX_AXIAL` six-ring provenance. Non-Formation keep requests fail closed.

Authored `formationGroupId` is provenance only and may differ between future merge partners. Runtime formation
identity is the exact live group/destination handle. Natural n1 generation is 1; destination generation is
`max(sourceGenerationA, sourceGenerationB) + 1`, with uint32/sentinel exhaustion rejected before mutation.
Identity root is the lower ordered exact source identity; destination uses the same entityId and
`root incarnation + 1` after no-wrap/no-collision validation. Identity root and GPU motion source are separate
authenticated facts.

The director's bounded SoA is the exact consumed-lineage authority. It sorts and preserves every original
`(entityId, incarnation)` handle. Registry/GPU `formationLineageHash` is correlation only and never substitutes
for the exact handle array.

Lifecycle maintains a bounded authored-provenance ledger keyed by `(waveId, formationGroupId)`. It validates
cross-batch coordinate/dimension/member-count/occupied-mask consistency and unique authored member/member-slot
indexes only after a whole request succeeds; it never becomes runtime merge identity.

## 4. Tick-start navigation and deterministic joining

Natural H and n2..5 groups seek merge candidates; HX follows the Core route. Candidate generation uses the
tick-start bounded grid, uploaded route integration cost/stage, and bounded SDF64 reachability. It allows a
reachable later stage or same-stage non-increasing cost and rejects reverse progress, unreachable/SDF-invalid
movement, grid overflow, and naive H×N² scans.

Eligible candidates use one ascending tuple:

```text
distanceSquared
→ forwardStageDelta
→ forwardCostDelta
→ root entityId/incarnation
→ slotIndex
→ rotationStep
```

Occupied six-ring masks remain connected. Rotation is GPU Formation state, not a CPU pose/readback decision.

## 5. Atomic prepare → publication → transform

Every committed merge consumes exactly two live source entities/groups and creates one composite destination
body. GPU prepare source tick N may publish only at CPU boundary N+1. Missing N+1 completion normally expires
the proposal without mutation; an N+2 callback is discarded and GPU must prepare again.

```text
whole-tick GPU prepare, sources unchanged
→ reciprocal pair/state/HP/protocol/exact-lineage authentication
→ privileged lifecycle preflight
→ private WorldRegistry authority + opaque generation-bound single-use token
→ backend arm
→ one authentic atomic lifecycle commit
   spawned: destination
   despawned: source A, source B
→ GPU transform + Effect rekey in the same submit
→ transform completion authentication
```

No public raw lifecycle payload can request `MERGE_CONSUMED` or `TRANSFORM_CONSUMED`. The lifecycle owner creates
distinct canonical child command IDs and publishes no second synthetic lifecycle result. Regular death or Core
impact cleanup wins before publication and cancels the conflicting proposal. Pre-publication failure is
zero-partial. GPU failure after CPU publication is hard recovery with no rollback.

Formation prepare source invalidation is reason-qualified. Authenticated lifecycle removal may use
`ALLOW_SOURCE_INVALID + LIFECYCLE_REMOVED`; an exact body that dies after a live no-ALLOW stage may return
`DIED_AFTER_STAGE`. Live/non-invalid outcomes require reason `NONE`; forged combinations fail closed.

## 6. HP, stats, Core damage, and bounty

Current and maximum HP remain positive signed-int32 centi-HP. For each committed merge and independently for
current/max:

```text
sum = sourceA + sourceB
merged = sum + trunc(sum / 10)
```

All source alive/positive/current≤max, sum+bonus overflow, and destination current≤max checks complete before
mutation. CPU and WGSL use this integer formula; an f32 `1.1` path is forbidden.

Natural n1 through HX n6 use an absolute fixed n-table. Map/wave modifiers are rejected rather than ignored.
Only Tower-contact attack changes, Core impact remains 1, and no stat is accumulated from the source snapshots.

| n | Tower contact | Speed | Weight | Core impact | Bounty budget |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.1 | 2.5 | 1 | 1 | 1 |
| 2 | 0.12 | 2.25 | 2 | 1 | 2 |
| 3 | 0.144 | 2.025 | 4 | 1 | 4 |
| 4 | 0.1728 | 1.8225 | 8 | 1 | 6 |
| 5 | 0.20736 | 1.64025 | 16 | 1 | 8 |
| 6 | 0.248832 | 1.476225 | 32 | 1 | 10 |

Final GPU-bound floats are quantized once. `MERGE_CONSUMED`/`TRANSFORM_CONSUMED` sources produce no ordinary
kill bounty; Gold payout remains outside this R2 slice.

## 7. Universal active Effect rekey

Formation ABI v1 does not expose a data-selectable transfer policy. Every Effect instance active at the target
tick under the half-open rule `appliedTick <= T < expiresAtTick` is independently rekeyed from either source to
the destination in place. Instance ID/incarnation, source, applied/expiry ticks, and payload remain exact.

No aggregate, refresh, new allocation, or silent loss is allowed. The transform header/records expose both
prepared and actual `effectRekeyCount`; every record and aggregate must match before the completion is accepted.

Effect pulse capacity remains a separate normal-path contract: authentic candidate/instance/event/pulse-grid
`CAPACITY_REJECTED` is zero-partial, advances only protocol watermark, consumes no logical sequence/cadence, and
retries deterministically. Program capacity, ABI/record/ID exhaustion, or forged/mixed evidence is recovery.

## 8. Terminal, replacement, teardown, and presentation

Core depletion closes new Formation stage ingress and cancels staged/prepared/armed/program/readback work plus
private transaction leases. The final authentic lifecycle commit is observed exactly once, but no Formation
transform, pulse, or regeneration runs on the readback-less terminal submit. Seal requires matching fixed,
Effect, and Formation ABI/final/submitted tick/count/pending-zero evidence and sealed rosters; otherwise it is
`SEALED_FAILED`. Late callbacks are terminal no-ops.

GPU-world replacement preserves committed Tower HP only. It resets the Maximum Damage Window, Effect A/B pools,
P roster/cadence, Formation body/group state, exact-lineage roster, prepared/armed work, registry transaction
authority, HX status, and presentation summaries; stale owner/director/transaction ports are revoked.

One destination body owns transform, HP, stats, contact/Core interaction, and render identity. Occupied cells,
reservation/merge cues, group status, and the separate HX health bar derive from bounded Formation presentation
state and are resolution independent. Presentation never creates gameplay members.

## 9. Implementation and validated-test evidence

Production surfaces:

```text
project/game/script/data/object/enemy/basic_hexa_enemy_data.js
project/game/script/data/object/enemy/enemy_formation_catalog_data.js
project/game/script/module/ingame/contract/enemy_formation_contract.js
project/game/script/module/ingame/object/enemy/formation_runtime_director.js
project/game/script/module/ingame/object/enemy/gpu_formation_command_owner.js
project/game/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js
project/game/script/module/ingame/object/world_registry.js
project/game/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js
project/game/script/module/ingame/object/game_object_system.js
project/game/script/module/ingame/physics/gpu/gpu_formation_runtime_abi.js
project/game/script/module/ingame/physics/gpu/gpu_formation_runtime_shaders.js
project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js
```

Focused author surfaces:

```text
project/game/test/authored_wave_timeline_formation.test.mjs
project/game/test/enemy_formation_contract_data.test.mjs
project/game/test/world_registry_atomic_formation.test.mjs
project/game/test/formation_runtime_director_contract.test.mjs
project/game/test/gpu_formation_command_owner_contract.test.mjs
project/game/test/gpu_effect_host_contract.test.mjs
project/game/test/nw_webgpu_capability/runner.js
project/game/test/support/run_nw_webgpu_capability.mjs
```

Source presence alone is not a test result; the checkpoint results below are the acceptance evidence.

## 10. Full checkpoint validation — PASS (2026-08-10)

Five dedicated actual-hardware stages:

```text
maximum-damage-window
enemy-arrow-charge
enemy-rhom-priority
enemy-pentagon-effect
enemy-hexa-formation
```

The production `corridor_eight_wave_01` remains exactly 32 spawns at five-tick intervals. The dedicated
`enemy-hexa-formation` stage is isolated support and must not mutate that baseline.

Executed cumulative commands and checks:

```bash
npm test
npm run test:webgpu:capability
npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:wasm:flow-field:stress
npm run update:render:golden
npm run test:render:golden
git diff --check
```

Results:

- changed JS/MJS `node --check`: 42/42 PASS;
- full Node: 1245/1245 PASS;
- default WebGPU and `maximum-damage-window`, `enemy-arrow-charge`, `enemy-rhom-priority`,
  `enemy-pentagon-effect`, `enemy-hexa-formation`: PASS;
- WASM flow/collision reproducibility: PASS;
- flow-field stress: seed `0x71c0ffee`, 1,000 cases, 3,824,454 cells, ABI canary 3 layouts, PASS;
- render golden: 10 surfaces, 3 cases, final SHA
  `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`, PASS;
- `git diff --check`: PASS.

The H/HX stage is a bounded deterministic hardware scenario, not a repeated soak script. `R2_GOAL.md` assigns
full stress/churn to Turn 9. The optional manual smoke was not run and is not reported as PASS.

The golden baseline refresh was explicitly audited and authorized through the official update command. It does
not represent a Turn4 visual change: commit `57f60a3` had intentionally included vignette in the backdrop after
the older baseline was recorded. The update synchronized only that historical intended composition, and the
subsequent check passed.

Checkpoint report path:

```text
plan/0809_enemy/r2t4_checkpoint_report.md
```

The report contains the exact completed gate matrix, historical golden provenance, and the explicit non-PASS
status of optional manual and Turn9 soak work.

## 11. Completion boundary

Every required Turn4 checkpoint gate succeeded, so progress is:

```text
r2t4 수행 완료.
```

Turn 5 has not started. Repeated R2 stress/churn and possible manual sandbox QA remain later acceptance work.
