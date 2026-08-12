# R2 Turn 8 — Cork Z Dynamic Route Closure

## 목표

```text
route availability runtime
Z route entrance selection
Z expansion/cork state
Enemy rerouting
trapped Enemy local behavior
Tower physical blocking
projectile hit with remaining penetration
route reopen on Z death
```

## 시작

```text
r2t8 수행 중.
```

## 1. Route graph

Turn 8 uses an optional normalized `routeGraph` v1 layered over the existing immutable Flow Field atlas:

```text
route IDs
entrance nodes
merge/switch nodes
forward-only alternatives
closure/clearance nodes
path-relative progress
```

Legacy maps omit `routeGraph` and remain graph-null/all-open. `TileMap.blocked`, terrain SDF, uploaded flow
directions, stage goal positions, and next-field links remain immutable. RouteRuntime compiles only graph
indices/topology and changes availability, route selection, and authored forward transition state; it does not
generate a second field or dynamic SDF.

The dedicated `cork_dual_route_01` injection map has two paths with a shared entry/switch and downstream merge.
The existing figure-eight production map/wave remains unchanged and graph-null.

## 2. Z behavior

Natural Z is `basic_cork_01`, analytic `circle`, common-C stats, stable `enemy-route-closure`, and exact
`cork-route-closure-01`. State is GPU-authoritative RouteRuntime ABI v1:

```text
SELECT_ROUTE
TRAVEL
EXPAND
READY_TO_CLOSE
BLOCKING
WAITING
DEAD
```

The policy is lowest open priority then stable path/closure identity. One exact
`(entityId, incarnation, leaseGeneration)` owns a closure. A competing Z waits rather than sharing or stealing
the lease, and an old incarnation cannot reopen a replacement's route.

The host `CorkRouteClosureDirector` mirrors authenticated assignment/close/reopen/cleanup completions in a
bounded exact-handle roster of 8; GPU availability and its monotonic version remain authority. The dedicated
wave authors one Z and two later C actors only.

## 3. Expansion

Z anchors at the authored closure entrance and expands for exactly 60 fixed ticks from its common travel radius
to radius 3, equal to the authored six-tile path width. It remains one logical/physical body with helper count 0.

Physical:

```text
blocks Enemy
blocks Player Tower
does not physically block projectiles
```

Projectile interaction:

```text
damages Z
penetration remaining → continues through
```

The active blocker physical layer accepts Enemy and Player Tower bodies but not projectile physical collision.
Projectile contact still runs ordinary target/team/hit policy, damages Z, consumes its normal self-hit and
penetration budget, and continues through when penetration remains.

## 4. Rerouting

Future spawns:

```text
routeSetId → latest authenticated availability snapshot
→ lowest-priority open route
all routes closed → exact Wave command/backlog retained, cursor unchanged
```

Already moving enemies:

```text
at next reachable route switch/merge node
→ move to open alternative
```

Enemies trapped behind closure:

```text
advance to entrance clearance
→ wait
→ use best local attack/effect/formation behavior
```

No reverse unless route graph explicitly requires a legal forward switch.

Actors before the authored switch change path only at that next reachable forward switch. Actors already past
it advance to the closure clearance field, wait there with route movement disabled, and keep independent local
attack/Effect/Formation capabilities available. Reopen re-enables the original path without a reverse move.

## 5. Reopen

Z exact death/despawn:

```text
route availability open
waiting/rerouted state updated
future spawn selection restored
helper body count remains 0
```

Old Z incarnation cannot reopen a replacement's closure.

Lifecycle spawn registers the exact roster entry atomically with body publication; despawn stages exact reopen
and cleanup before slot reclamation. Terminal final submit and GPU-world replacement restore every closure to
open, empty pending/roster/readback state, and revoke stale route-runtime/director authority.

## 6. Map content

`cork_dual_route_01` and `cork_dual_route_wave_01` are dedicated injection-only acceptance content with two
independent paths. They are not registered as the default production map/wave.

Do not distort the existing figure-eight map solely for Z.

Turn 9 decides final production showcase integration.

## 7. Tests to author, not execute

```text
route graph compile
closure selection
future spawn reroute
active enemy switch
trapped wait
Tower physical block
projectile penetration
reopen exact death
multiple Z conflict policy
ABA/recovery
all previous systems coexist
```

These tests and fixtures are authored under the restricted Turn 8 cadence and are not executed in this turn.
Only changed production JS/MJS syntax and diff hygiene may be checked; behavior, Node, NW/WebGPU, WASM,
render-golden, stress, and manual acceptance remain Turn 9 work. The dedicated actual-hardware stage name is
`enemy-cork-route-closure`; Turn 9 must select and execute it explicitly.

## 8. 위생 검사

```text
node --check
git diff --check
```

## 9. 완료

```text
r2t8 수행 완료.
```

후 Turn 9.
