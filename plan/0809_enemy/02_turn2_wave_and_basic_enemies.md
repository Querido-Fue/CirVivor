# R2 Turn 2 — Authored Waves, Formation Schema, and C/T/A/M

## 목표

```text
authored wave timeline
formation spawn schema
coordinate-system abstraction
C/T/A/M production behaviors
```

Persistent hive formation runtime은 Turn 4가 소유한다.

## 시작

진행 파일을 `r2t2 수행 중.`으로 바꾼다.

## 1. Wave timeline

지원:

```text
SPAWN_FOR_DURATION
WAIT
SPAWN_GROUP
SPAWN_FORMATION
```

Data example:

```text
for 2 sec 10 C
wait 1 sec
for 2 sec 10 C + 6 P
```

60Hz fixed tick으로 compile한다.
Command identity는 authored timeline identity를 포함한다.
Randomness 금지.

같은 fixed tick에 compile된 모든 spawn은 하나의 `requestSpawnBatch`로 atomic하게 요청한다.
Batch가 거절되면 schedule cursor를 전진하지 않으며 wave/timeline/group/member가 포함된 동일한
command identity로 재시도한다. Queue boundary에서 resolved stat을 정확히 한 번 만든다.

## 2. Formation schema

```text
groupId
size
coordinateSystem
spawnMode
rowDelayTicks
keepFormation
layout rows
symbolMap
route/path binding
```

Turn 2 supports initial formation offsets and sequential-row spawn.

`keepFormation=true`는 schema-valid하지만 production에서 Turn 4 runtime 이전 사용 금지 또는 explicit pending-capability failure.

Coordinate-system port:

```text
LINEAR_GRID
HEX_AXIAL
HEX_OFFSET
RING_SLOTS
PATH_RELATIVE
```

Turn 2에서 LINEAR_GRID와 PATH_RELATIVE initial spawn을 실제 구현한다. LINEAR_GRID는 authored
world-axis row/column offset이고, PATH_RELATIVE는 route 첫 segment의 forward/normal basis로 같은
offset을 변환한다. `ALL_AT_ONCE`는 `rowDelayTicks=0`, `SEQUENTIAL_ROWS`는 양수 row delay를
요구한다. Exact gate/path binding과 모든 member의 walkable spawn tile을 compile 시 검증한다.
다른 시스템은 contract/test fixture로 준비한다.

## 3. Circle C

```text
Core route
baseline HP/speed/damage/weight
no special capability
```

Resolved baseline:

```text
maxHealth 1
moveSpeedTilesPerSecond 2.5
weight 1
towerContactDamage 0.1
coreImpactDamage 1
```

## 4. Triangle T

```text
Core route
lower HP
higher speed
lower weight
```

Common contact/Core impact만 사용.

Resolved profile:

```text
maxHealth 0.7
moveSpeedTilesPerSecond 3.5
weight 0.6
towerContactDamage 0.1
coreImpactDamage 1
```

## 5. Arrow A

State machine capability:

```text
SEEK_TOWER
WINDUP
CHARGE
CONTACT_RECOIL
RECOVER
```

Tower absent:

```text
CORE_FALLBACK
```

Requirements:

```text
GPU exact Tower target
no CPU pose
charge telegraph data/event
contact uses common damage window
recoil impulse opposite charge
repeated charge after recovery
Tower absent → Core route/direct fallback
```

Arrow shape does not imply charge; definition capability does.

`basic_arrow_01`만 stable `enemy-charge` capability를 선언한다. GPU는 exact tracked Tower를
`SEEK_TOWER → WINDUP → CHARGE → CONTACT_RECOIL → RECOVER`로 처리한다. Windup 종료 때 charge
방향을 고정하므로 charge 중 homing하지 않는다. Contact marker가 common damage-window 후보와
반대 방향 recoil을 연결하고, render는 authoritative behavior state에서 telegraph를 만든다.
Tower가 없거나 exact handle이 stale이면 `CORE_FALLBACK` route control로 전환한다.
Arrow contact가 active peak를 높여도 최초 accepted tick `N + 60` expiry는 절대 연장하지 않는다.

## 6. Diamond M

Core-priority ranged attacker.

Target priority:

```text
1. Core if in range
2. Tower if Core out of range and Tower in range
3. otherwise Core route movement
```

Attack in range:

```text
stop movement
fire projectile
resume when no target in range
```

Implement generic hostile ranged target selection with explicit Core/Tower target IDs.

Core projectile impact uses a typed CPU Core damage request, not GPU health mutation.

Tower projectile uses existing PLAYER_DAMAGEABLE path.

Production M baseline은 range `8` tiles의 tick-start center-distance inclusive 판정, initial delay
`30`, interval `90`, launch speed `12`, global starts budget `4`다. BodyControlProgram은 explicit
Core/Tower exact handle만 받아 Core-first 선택과 persistent stop/resume을 GPU에서 결정한다.
선택 결과와 same source/tick fingerprint에 결합된 SpawnProgram만 projectile을 활성화한다. Core
branch는 typed positive CPU damage request를 내고 GPU Core HP를 만들지 않으며, Tower branch는
exact selected Tower를 검증한 뒤 common Maximum Damage Window로 들어간다.

Current ABI:

```text
Body ABI v6
EnemyBehaviorState 80 bytes
BodyControlProgram v2: record 96 / state 64 bytes
SpawnProgram v4: record 96 bytes
max storage buffers per shader stage 9
```

## 7. Production wave

Migrate authored production/test wave to timeline schema and include a modest C/T/A/M mixture without removing Archer.

Production remains 32 spawns at five-tick intervals with cycle:

```text
C → T → A → M → C → T → Archer
```

Archer remains at indexes `6/13/20/27` and local ticks `31/66/101/136`.

Do not add P/H/O/J/R/Z yet.

## 8. Tests to author, not execute

```text
timeline compilation
wait/duration exact ticks
formation row delays/offsets
coordinate-system contracts
C/T resolved stats
A state transitions/fallback/recoil
M Core-first priority and stop/fire/resume
Core projectile damage exact/dedupe
R1 common contact/defeat regression
```

## 9. 위생 검사

```text
node --check changed production JS/MJS
git diff --check
```

No behavioral/full test execution.

## 10. 완료

```text
r2t2 수행 완료.
```

로 갱신하고 Turn 3으로 계속한다.
