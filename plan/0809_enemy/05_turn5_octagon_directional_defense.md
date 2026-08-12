# R2 Turn 5 — Octagon O, Orbit, and Directional Defense

## 목표

```text
orbit capability
directional-defense capability
O Tower orbit
three armored faces
Tower-facing tidal lock
flat reduction
Tower absent → Core rush
```

## 시작

```text
r2t5 수행 중.
```

## 1. Orbit runtime

Use actual `RING_SLOTS` coordinate system.

O creates/joins an orbit group:

```text
center target = Tower exact handle
radius = data-owned, baseline Tower radius × 12
angular speed = data-owned
slot reservation for multiple O
```

No CPU Tower pose.

GPU exact target position.

Map authoring boundary for this turn:

```text
all 8 radius-6 slot centers must be walkable and SDF-clear
current corridor map is incompatible and has no production-wave O
dedicated fixture uses a compatible open-ring map
default-corridor enablement is a Turn 9 map-compatibility gate
```

## 2. Tidal orientation

O facing is synchronized so three consecutive armored facets face Tower.

```text
orbit angle changes
body facing updates
armored sector center = direction to Tower
```

Visual and damage orientation use same authoritative facing.

## 3. Directional defense

Generic incoming hit context:

```text
incoming direction
target facing
armored angular sectors
flat reduction
minimum/normal damage policy
```

For O:

```text
armored 3/8 facets → flat reduction
other facets → normal damage
```

No generic minimum-damage rule unless data specifies it.
The counterplay is directional attack.

Reflecting/returning/projectiles from other origins naturally hit rear/side.

## 4. Tower absence

```text
Tower invalid/dead
→ leave orbit
→ Core fallback
→ do not orbit Core
```

Transition must be normal target loss, no recovery.

## 5. Protection role

O physical body/projectile interaction may shield enemies behind it.
Do not physically imprison Tower.
Tower can push/escape according to Weight.

## 6. Tests to author, not execute

```text
ring slot allocation
multiple O orbit
exact GPU target
tidal facing
facet angle classification
flat reduction
rear hit normal damage
reflecting origin counterplay fixture
Tower loss Core rush
no recovery
H/P/common regressions
```

## 7. 위생 검사

```text
node --check
git diff --check
```

No full tests.

## 8. 완료

```text
r2t5 수행 완료.
```

후 Turn 6.
