# Hexa-Hive Enemy

This guide describes the current R2 Turn 4 H/HX runtime. The older CPU prototype rules (eight members,
continuous-contact timers, `0.95` per-merge speed, multi-part SAT/circle layouts, and floating-point HP bonus)
are historical and are not production authority.

## Identity and independent Formation domain

- Formation is independent from the mutually exclusive `ENEMY_BEHAVIOR_STATE` movement/attack union.
- Natural n1 H is `basic_hexa_01`.
- Every committed merge consumes exactly two live H/group sources and creates one destination body.
- n2..5 destinations are transform-private `basic_hexa_group_01`; n6 is transform-private
  `basic_hexa_hive_01` (HX). Direct authored group/HX spawn is forbidden.
- All three definitions use canonical `shapeDefinitionId: 'hexa'`. Group/HX differences live in Formation
  state and presentation, not new shape codes.
- `FormationRuntimeDirector` stores 1..6 sorted original exact `(entityId, incarnation)` handles in bounded
  SoA lineage. Registry/GPU `formationLineageHash` is correlation only and never replaces exact lineage.

The stable Formation ports are `IFormationCoordinateSystem`, `IFormationSlotGraph`,
`IFormationMembership`, `IFormationMotionPolicy`, and `IFormationAtomicTransform`. No per-member JS AI object
or per-group object is allocated.

## Authoring and six-ring state

Authored formation input uses separate `memberCount`, `rows`, and `columns`. Dimensions are explicit or exactly
derived from the rectangular layout; `memberCount` is the non-dot live-member count, not a grid dimension.
Legacy `size` and every member/dimension/layout mismatch fail before mutation. Persistent `keepFormation=true`
is valid only for natural H with exact `HEX_AXIAL` six-ring provenance.

Lifecycle publication keeps a bounded authored-provenance ledger keyed by `(waveId, formationGroupId)`. Across
batches it requires identical coordinate/dimensions/member-count/occupied-mask facts and unique authored member
and member-slot indexes. This ledger validates authoring only; it is not runtime group identity.

Runtime identity is the exact live group handle. Authored `formationGroupId` is provenance only and may differ
between groups that later merge. Natural n1 starts at generation 1; a destination uses
`max(sourceGenerationA, sourceGenerationB) + 1`, with uint32 exhaustion rejected atomically. Occupied slots use
the bounded six-bit ring mask and must remain connected.

## Atomic merge and lifecycle

GPU Formation prepare for tick N can publish only at CPU boundary N+1. A late completion is discarded without
mutation and must be prepared again. The sequence is:

The identity root is the lower exact source entity identity; destination identity reuses that entityId with
`incarnation + 1` after no-wrap/no-collision validation. Identity root and GPU motion-source selection are
separate authenticated facts.

```text
whole-tick GPU prepare (sources unchanged)
→ exact reciprocal pair/health/state/protocol authentication
→ privileged lifecycle preflight + opaque single-use WorldRegistry token
→ backend arm
→ one atomic registry publication
   spawned: destination
   despawned: source A, source B
→ GPU commit/Effect rekey in the same fixed submit
→ authenticated transform completion
```

Regular death or Core-impact cleanup wins before publication and cancels the conflicting proposal. Successful
source dispositions are `MERGE_CONSUMED` or `TRANSFORM_CONSUMED`; neither emits an ordinary kill bounty. A GPU
failure after CPU publication is hard recovery with no rollback.

## HP and fixed n-table stats

Current and maximum HP remain signed-int32 centi-HP. For each merge and for current/max independently:

```text
sum = sourceA + sourceB
merged = sum + trunc(sum / 10)
```

Sources must be alive and positive, each current must not exceed max, the exact integer operation must not
overflow, and destination current must not exceed max. No f32 `1.1` path is allowed.

H/HX stats are absolute n-table values from n1 onward; map/wave modifiers are rejected rather than ignored.
Only Tower contact attack scales, Core impact remains 1, and bounty is exact:

| n | Tower contact | Speed | Weight | Core impact | Bounty budget |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.1 | 5 | 1 | 1 | 1 |
| 2 | 0.12 | 4.5 | 2 | 1 | 2 |
| 3 | 0.144 | 4.05 | 4 | 1 | 4 |
| 4 | 0.1728 | 3.645 | 8 | 1 | 6 |
| 5 | 0.20736 | 3.2805 | 16 | 1 | 8 |
| 6 | 0.248832 | 2.95245 | 32 | 1 | 10 |

Final GPU-bound floating values are quantized once. Stats are not accumulated from source bodies at merge.

## Motion, effects, and presentation

Join selection uses tick-start bounded-grid data. Route progress accepts a reachable later stage or a same-stage
integration cost that does not increase; reverse progress, invalid SDF64 reachability, and grid overflow fail
closed. Eligible candidates use the canonical ascending tuple: distance squared, forward-stage delta,
forward-cost delta, root entity/incarnation, slot, then rotation. CPU pose readback and naive H×N² scans are
forbidden.

Formation ABI v1 universally rekeys every target-tick half-open active Effect instance to the destination,
preserving instance ID/incarnation, source, applied/expiry ticks, and payload independently. It never aggregates,
refreshes, or silently drops Boost. Prepared and actual `effectRekeyCount` must match before completion is
accepted.

One destination body owns authoritative transform, HP, stats, contact/Core interaction, and render identity.
Natural n1 is rendered as one centered, normal-enemy-sized Hex body. Only n2..6 render their connected occupied
cells; empty reservation cells and the former cyan grid guide are deliberately invisible. The separate HX
health bar/status still derives from bounded Formation state, and presentation never creates gameplay members.

## Terminal, replacement, and checkpoint status

Core depletion closes Formation stage ingress, cancels prepared/armed/program/readback work, permits the final
authentic lifecycle observation exactly once, and requires final tick/count/pending-zero evidence. No transform
runs on the terminal submit. GPU-world replacement preserves Tower HP only and resets every Formation group,
exact-lineage roster, pending transaction/lease, Effect pool, and presentation summary; stale ports are revoked.

The dedicated hardware stage is `enemy-hexa-formation`. The 2026-08-10 Turn 4 checkpoint passed full Node,
default WebGPU and all five routed hardware stages, both WASM reproducibility checks, the 1,000-case flow-field
stress check, and the audited render-golden check. The H/HX stage proved the bounded five-merge n1→n6/HX chain,
exact lineage and Effect rekey, zero-partial atomic rejection, ABA/replacement reset, route/SDF/overflow behavior,
and bounded presentation/storage evidence. Repeated H/R2 soak is still assigned to Turn 9, and optional manual
smoke was not run or claimed as PASS.
