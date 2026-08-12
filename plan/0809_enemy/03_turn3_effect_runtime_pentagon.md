# R2 Turn 3 — Generic Effect Runtime and Pentagon P

## 목표

Poison/Burn/Freeze/Boost가 공유할 수 있는 Effect Runtime과 P를 구현한다.

## 시작

진행 파일:

```text
r2t3 수행 중.
```

## 1. Effect contracts

Stable concepts:

```text
EffectDefinition
EffectInstance
EffectFamily
StackPolicy
EffectApplicationPolicy
```

Every instance:

```text
effectInstanceId
effectDefinitionId
family
source exact handle
target exact handle
appliedTick
expiresAtTick
magnitude/payload
tags
```

Independent timers.

No per-entity JS effect object.
Use bounded pool/records and exact identity.

## 2. Authority

Effects modifying health/speed/attack must affect GPU-authoritative gameplay.

Design one of:

```text
GPU effect-instance pool + per-body summary
or
bounded CPU command pool with GPU summary pass
```

No frame readback.
Storage max 9.

Effect instance/summary state is an independent capability state domain. Do not append P or Effect state
to the exclusive basic movement/attack `ENEMY_BEHAVIOR_STATE` union.

## 3. Boost family

Independent Boost instances.

```text
boostStackCount = active Boost instances
```

Thresholds data-owned:

```text
1+ stack → HP regeneration
2+ stack → HP regeneration + Attack multiplier
```

Each instance expiration immediately changes stack.

Do not collapse instances into one refreshed timer.

## 4. Future families

Contract and non-production fixtures:

```text
Poison
Burn
Freeze
```

No final balance required.
Ensure stack policies can differ by family.

## 5. Pentagon P

Navigation:

```text
Core-forward
no reverse
within route width
seek densest reachable Enemy cluster
may slow/wait
```

Pulse:

```text
every authored interval
→ all eligible nearby Hostile Enemy targets
→ one independent Boost instance each
```

P may affect other P according to data policy.

No CPU position readback; use GPU range/candidate pass.

## 6. Combat integration

Effect summary modifies:

```text
health regeneration
attack multiplier
move speed if future effect
```

Final damage order remains shared contract.

The chosen production policy is explicit: current Boost may modify Tower contact and Tower projectile channels
only through their authored flags. Direct Core impact and typed projectile Core damage are unmodified.
Contact handlers recompute from immutable authored/resolved base damage; projectiles snapshot resolved damage
once at spawn, so a current multiplier cannot compound a previously multiplied value. The host sets
SpawnProgram `TOWER_DAMAGE_CHANNEL` only for the canonical Archer exact-Tower target-entity request after
source/Tower definition and attack/projectile-policy validation; `PLAYER_DAMAGEABLE` alone is insufficient and
M retains its selected-Tower GPU branch.

## 7. Presentation seam

Add bounded effect stack status and minimal P pulse/boost visual data.
Do not build final HUD.

### 7.1 Current production architecture (static authorship)

```text
GameObjectSystem
└─ PentagonEffectDirector
   └─ exact-handle primitive SoA roster/cadence; no per-P/effect object

GpuSimulationEndpoint
└─ one bounded generic GpuEffectCommandOwner
   └─ session/tick/source/pulse/fingerprint replay owner

GPU
├─ Effect instance pool A/B
├─ per-body Effect Summary
└─ per-body PEmitter state
```

Backend API names are locked:

```text
stageEffectPulseProgramBatch
drainCompletedEffectProgramBatches
cancelPendingEffectProgramsForTerminal
getEffectRuntimeStatus
```

All P sources due at one `targetFixedTick` are ordered into one whole-tick request. Host/backend share one
resolved capacity (`explicit` or `min(bodyCapacity, 256)`); validation, private exact handle-to-slot resolve,
and capacity preflight are zero-partial. A zero-target pulse produces an authenticated completion and advances
cadence. Protocol/replay comparison is hierarchical session→device→epoch and binds the exact source handle,
pulse sequence, source tick, and ordered batch fingerprint. Deferred future batches keep the protocol snapshot
captured when drained; old generation/ABA callbacks cannot mutate a new world.

Effect instance lifetime is half-open (`appliedTick <= T < expiresAtTick`). GPU summary thresholds are exact:
`1+` Boost regenerates HP and `2+` also applies attack multiplication. All expiration, summary, regeneration,
PEmitter update, and pulse application operate on GPU-authoritative state without frame readback. Effect passes
remain within the platform maximum of 9 storage buffers per stage.

P movement uses tick-start bounded-grid candidates plus the uploaded route integration-cost plane, ordered
route stages, and a bounded SDF gate. Same-stage integration cost cannot increase; only a reachable later stage
may advance. Reverse/unreachable/SDF-invalid candidates fail closed, and naive P×N²/CPU-pose selection is
forbidden.

Terminal close arms Effect cancellation alongside fixed-program cancellation. The final lifecycle commit still
removes an exact Core-impact P, but the final readback-less submit runs no pulse or regeneration. Successful
seal requires Effect ABI/final/submitted tick/count equality, pending program/readback zero, and the final
Pentagon roster seal; missing evidence is `SEALED_FAILED` and late callbacks are no-ops. GPU-world replacement
preserves committed Tower HP only and resets the Maximum Damage Window, Effect pools/Summary/PEmitter,
Pentagon roster/timers, pending/readbacks, and stale ports.

This section records production and author-fixture truth only. No Turn 3 behavior, npm, actual NW/WebGPU,
WASM, render-golden, or manual acceptance has run; progress remains `r2t3 수행 중.` until the root static audit
closes the turn.

## 8. Tests to author, not execute

```text
effect instance identity/timing
independent expiration
Boost stack threshold transitions
regen and attack summary
P pulse range/source/target
no-reverse dense-cluster movement
old generation/ABA cleanup
pool capacity/zero-partial
storage contracts
C/T/A/M regressions
```

## 9. 위생 검사

```text
node --check changed production JS/MJS
git diff --check
```

## 10. 완료

```text
r2t3 수행 완료.
```

후 Turn 4로 계속한다.
