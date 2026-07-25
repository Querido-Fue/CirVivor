# 06. AI, Path, Flow Field, and Wave

## 1. 목표

- 일반 적의 기본 목표를 Tower가 아니라 Core로 전환한다.
- Path/Lane 진행과 장애물·국소 회피를 분리한다.
- 기존 LOS/Flow Field 캐시와 WASM kernel을 재사용한다.
- WaveDefinition과 seed로 spawn 순서를 재현한다.
- AI가 entity 생명주기, Core damage, UI를 직접 소유하지 않게 한다.

## 2. AISystem 구조

```text
AISystem
├─ AIContextBuilder
├─ EnemyPolicyRegistry
├─ EnemyDecisionScheduler
├─ EnemySpatialIndex
├─ PathService
├─ TargetPolicyService
├─ LocalSteeringService
└─ FlowFieldService
   ├─ NavGridCache
   ├─ FlowFieldCache
   ├─ JS oracle
   └─ WASM backend
```

입력:

- read-only WorldQuery
- map path/lane snapshot
- fixed tick/delta
- wall version
- Core handle/position
- named RNG stream

출력:

```text
MoveIntent
AttackIntent
PathChangeIntent
StatusIntent
```

방향 경로를 따르는 적은 최소한 다음 진행 상태를 가진다.

```text
gateId
pathId
waypointIndex
```

같은 위치를 여러 번 통과하는 8자 교차점에서는 좌표만으로 다음 방향을
복원할 수 없으므로 `waypointIndex`를 spawn부터 despawn까지 유지한다.

## 3. 기본 적 목표 정책

```text
COREBOUND
→ assigned Path를 따라 Core attack point로 이동
→ blocker가 있으면 blocker 공격
→ Tower 접촉은 위치 해소/선택적 제어만 수행
→ Tower를 장거리 추적하지 않음
```

특수 정책:

```text
HUNTER          Tower 위치 압박, 피해는 주지 않고 제어/이동 방해
SAPPER          플레이어 구조물 우선
ARTILLERY       Core 또는 구조물 원거리 공격
FORMATION       leader/path anchor 추종
CLUSTER_JOIN    동종 밀도 합류
```

Tower가 사라지는 상태는 없으므로 `Tower Down → Core fallback` 분기를 만들지
않는다. Tower handle이 맵 전환 등으로 일시 부재하면 policy별 명시 fallback만
사용한다.

## 4. PathService

필수 API:

```text
resolveSpawnPath(gateId, policy, rng)
samplePosition(pathId, distance)
getTangent(pathId, distance)
getRemainingDistance(pathId, distance)
findNearestDistance(pathId, worldPosition)
queryBlockerAhead(pathId, distance)
getLaneId(pathId)
getCoreAttackPoint(pathId)
```

맵 로드 시:

- `enemySpawnRoutes[]`의 모든 Gate ID와 Path ID 중복 검증
- 모든 Gate→Core 연결과 직교 인접 waypoint 검증
- segment 누적 길이 table 생성
- Lane mapping 생성
- placement/blocker index 생성
- invalid path면 개발 빌드 로드 실패

적마다 매 tick nearest path 전체 검색을 하지 않는다.

Gate는 단일 필드가 아니다. WaveDefinition의 `gateId`가 맵의 여러
`enemySpawnRoutes[]` 중 하나를 선택하고, 서로 다른 Gate route는 합류 구간과
같은 Core attack point를 공유할 수 있다.

## 5. Flow Field 사용 경계

Path 진행이 기본이고 Flow Field는 다음에 사용한다.

- 국소 장애물 우회
- 합류 구간의 다수 적 조향
- authored free-navigation 영역
- Path가 일시 차단된 fallback

방향 route가 교차하거나 이전 셀을 다시 지나는 맵에서 Core 하나를 goal로 한
전역 Flow Field를 사용하면 적이 authored 순서를 생략하는 지름길을 선택한다.
이 경우 PathFollower의 다음 waypoint 또는 합류 stage를 Flow Field goal로
사용하고, stage 완료 뒤 다음 field로 전환한다. 타일 `blocked` grid는
공유하지만 진행 index는 field 밖의 적 상태로 유지한다.

직선/Path steering으로 충분하면 Flow Field를 만들지 않는다.

보존 계약:

- 기존 JS `buildFlowField()`는 oracle로 유지
- grid 1,024셀 이상 WASM dispatch 기준은 측정 전까지 유지
- cache key에 map/wall/grid/clearance/goal version 포함
- 결과 typed array를 WASM memory에서 복사
- 실패 뒤 프로세스 수명 동안 JS fallback
- byte-exact parity test 유지

현재 첫 맵의 grid 계약은 다음과 같다.

```text
cellSize: 1 tile world unit
cols × rows: 54 × 30
size: 1620
blocked: Uint8Array(1620)
```

기존 WASM backend의 1,024셀 dispatch 기준을 넘으므로 별도 grid 변환 없이
동일 ABI로 전달한다.

첫 route는 6타일 폭이며 `위→아래→오른쪽`의 왼쪽 ㄴ자 진입, 중앙 8자,
`오른쪽→아래`의 오른쪽 ㄱ자 Core 진입 순서다. 화면 해상도는 grid, waypoint,
Flow Field 결과에 영향을 주지 않는다.

## 6. Decision budget

- 모든 적은 movement integration을 매 fixed tick 수행한다.
- expensive decision은 ID 기반 group 또는 거리 tier로 분산한다.
- Core 근접, blocker 접촉, attack windup 적은 우선 갱신한다.
- decision 간 steering state는 재사용한다.
- tie-break는 entity ID, path order, spawn sequence로 고정한다.

## 7. WaveDirector 위치

WaveDirector는 GameSystem이 소유하는 application service이며 AISystem의 일부가
아니다. 다만 spawn된 적에게 path/lane/policy ID를 배정하기 위해 AISystem의
resolver port를 사용한다.

```text
WaveDefinition
→ WaveDirector schedule
→ SpawnIntent
→ GameObjectSystem
→ AISystem policy/path binding
```

## 8. WaveDefinition 최소 계약

```text
waveId
mapId
preview
phases[]
  startTick
  durationTicks
  spawnGroups[]
    enemyDefinitionId
    gateId
    pathChoicePolicy
    count
    intervalTicks
    policyId
completion
rewards
threatBudget
```

런타임 핵심 타이머는 초 float보다 fixed tick 정수를 우선한다. 콘텐츠 로드
시 초 단위를 tick으로 정규화할 수 있다.

## 9. Spawn 결정성

이름 있는 RNG stream:

```text
WaveSpawn
WavePathChoice
EnemyVariant
```

Shop, CombatSpread, VFX RNG와 분리한다.

동일한 조건:

```text
contentVersion
run seed
map/wave ID
command log
```

에서 enemy kind, spawn tick, gate/path 선택, tie-break가 같아야 한다.

## 10. Wave 완료와 저장 연결

WaveDirector는 완료 사실만 확정한다.

```text
WaveCompleted
→ GameSystem WAVE_SETTLEMENT
→ reward/Gold/statistics/ShopSession
→ CheckpointCoordinator
→ ingame.dat commit
→ SHOP
```

WaveDirector가 SaveSystem을 직접 호출하지 않는다. 저장 실패로 재시도해도
WaveDirector의 spawn cursor나 reward가 다시 실행되지 않도록
`completionRevision`을 사용한다.

## 11. Core 공격

적별 `CoreAttackBehavior`:

```text
IMPACT_AND_DESPAWN
ATTACK_IN_PLACE
RANGED_FROM_PATH
BOSS_SCRIPT
```

공통 흐름:

```text
AI AttackIntent
→ target Core 확인
→ CombatResolver
→ CoreDamaged event
→ Core Integrity 변경
→ destroyed 검사
```

AI가 Core 값을 직접 감소시키지 않는다.

## 12. 테스트 계약

- 일반 적은 Tower가 가까워도 assigned Path를 따라 Core로 진행한다.
- HUNTER가 Tower를 압박해도 Tower damage event가 발생하지 않는다.
- blocker 파괴 뒤 같은 Path 진행을 재개한다.
- 같은 seed에서 spawn/path 선택이 동일하다.
- pause 중 wave tick과 attack cooldown이 진행되지 않는다.
- 모든 Gate에서 Core까지 유효 경로가 있다.
- Flow Field JS/WASM 결과가 byte exact다.
- WaveCompleted와 reward/checkpoint가 한 번만 발생한다.
