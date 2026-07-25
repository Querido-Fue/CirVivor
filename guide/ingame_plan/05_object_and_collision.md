# 05. Object and Collision System

## 1. 책임

GameObjectSystem은 인게임 월드에 존재하는 모든 entity의 유일한 생명주기
권한이다.

```text
GameObjectSystem
├─ WorldRegistry
├─ TileMap / WorldCamera2D
├─ EntityIdAllocator
├─ CapabilityIndexes
├─ EntityFactoryRegistry
├─ PoolManager
├─ Spawn/DespawnCommandBuffer
├─ RenderViewBuilder
└─ PhysicsSystem
   └─ CollisionHandler
      ├─ TileMapCollisionResolver
      ├─ body builders
      ├─ broad-phase SoA/grid
      ├─ narrow phase/manifold
      ├─ position solver
      ├─ projectile sweep
      └─ WASM contact backend
```

## 2. Entity 모델

상속 트리보다 component/capability를 사용한다.

공통 identity:

```text
entityId
incarnation
kindId
active
createdAtTick
```

`incarnation`은 풀 재사용 뒤 오래된 handle이 새 entity를 가리키는 문제를 막는다.

권장 component:

```text
Transform
Motion
Collider
Renderable
Team
EnemyState
PathFollower
CoreIntegrity
TowerControl
Damageable
Projectile
Structure
Lifetime
PlayerOwned
SubjectEligibility
Generation
LaneAffinity
```

Tower에는 `Damageable`과 `Health`를 붙이지 않는다. Core는 일반 Health가 아니라
명시적 `CoreIntegrity`를 사용한다.

### 2.1 PhysicsBody와 Collider 계약 분리

물리 운동과 충돌 형상은 하나의 거대한 인터페이스나 상속 계층으로 합치지 않는다.

```text
Entity
├─ IPhysicsBody2D
│  ├─ position / previousPosition / velocity
│  ├─ mass / inverseMass
│  ├─ acceleration / force accumulator
│  ├─ applyImpulse
│  ├─ applyPositionCorrection
│  └─ fixed integration / linear friction
└─ ICollidable                    future
   ├─ shape / bounds
   ├─ collision layer / mask
   ├─ contact material
   └─ getPhysicsBody() optional
```

분리 원칙:

- Collider는 질량과 속도를 복제하지 않고 동적 대상일 때 같은
  `IPhysicsBody2D`를 참조한다.
- PhysicsBody는 원·사각형 같은 충돌 형상이나 damage 규칙을 알지 않는다.
- CollisionHandler는 반환된 위치·속도 객체를 직접 변경하지 않고
  `applyImpulse()`와 `applyPositionCorrection()`을 사용한다.
- 스킬 반동도 `applyImpulse()`를 사용하여 충돌 반응과 동일한 운동량 경로에
  합성한다.
- `linearFriction`은 월드 이동 감쇠이고, 향후 Collider의 접촉면 friction은
  별도 material 값으로 둔다.

현재 최소 구현:

```text
module/ingame/contract/physics_body_contract.js
module/ingame/physics/physics_body_2d.js
TheTower.getPhysicsBody()
GameObjectSystem.getPhysicsBodies()
module/ingame/contract/collidable_contract.js
module/ingame/physics/circle_collider_2d.js
GameObjectSystem.getCollidables()
```

`PhysicsBody2D`는 fixed delta 기반 지수 감쇠를 사용한다. 키 해제는 속도를
직접 0으로 바꾸지 않으며 sleep 임계값 아래까지 마찰로 감속한 뒤 정지한다.

### 2.2 해상도 독립 타일 월드와 projection 계약

- 한 실제 타일은 1 월드 단위이며 Tower 지름은 1타일이다. Tower/Core 크기와
  이동 수치는 `_TILES` 단위의 data가 유일한 권한이다.
- 물리·AI·저장 좌표는 렌더 픽셀을 사용하지 않고 viewport resize로
  확대·축소하지 않는다.
- authored route의 한 매크로 셀은 `pathWidthTiles × pathWidthTiles` 실제
  타일 블록으로 확장한다. 첫 맵의 모든 길 폭은 6타일이다.
- 짝수 폭 매크로 셀의 waypoint는 블록의 기하학적 중앙에 두고, Flow Field
  대표 tile은 중앙 경계의 아래·오른쪽 셀을 결정적으로 선택한다.
- `TileMap`이 소유하는 `blocked: Uint8Array`가 플레이어 정적 충돌과
  JS/WASM Flow Field의 공통 지형 권한이다.
- `TileMapCollisionResolver`는 원형 collider 주변 타일만 조회하고,
  `IPhysicsBody2D.applyPositionCorrection()`과 `setVelocity()`로 침투와
  벽 안쪽 속도를 해소한다.
- 맵 전체를 매 fixed tick 훑거나 타일마다 entity 객체를 만들지 않는다.
- `IWorldViewProjection2D`가 simulation과 renderer 사이 좌표 경계다.
  `WorldCamera2D`는 실제 표시 `WW × WH`에 전체 맵을 contain한다.
- resize는 projection revision만 변경하며 맵, Core, Tower 좌표를
  재생성하지 않는다.
- `TileMapRenderer`는 정적 타일의 viewport 중심과 크기를 최초 draw/resize
  때만 계산한다. 동적 entity만 매 draw 투영하며 대량 entity 단계에서는 같은
  계약을 GPU view-projection uniform으로 이관할 수 있다.

## 3. Capability index

WorldRegistry는 등록 시 capability별 dense index를 만든다.

```text
fixedUpdatables
renderablesByLayer
collidables
damageables
hostiles
projectiles
subjectEligibleByKind
pathFollowersByLane
```

외부에는 배열을 반환하지 않고 다음 port를 제공한다.

```text
queryById(handle)
forEachHostile(callback, scratch)
copySubjectIdsInto(kindId, out)
getActiveCount(kindId)
getCoreHandle()
getTowerHandle()
```

hot path 내부 배열은 live여도 되지만 호출자에게 길이·순서 변경 권한을 주지 않는다.

## 4. 생성과 제거

모든 생성은 `SpawnIntent`를 통과한다.

```text
sourceEntityId
sourceAbilityId
executionId
kindId
generation
position/rotation
laneAffinity
resolvedStats
```

순서:

1. payload schema 검증
2. generation과 execution budget 검증
3. kind별 entity cap 정책
4. pool acquire
5. 모든 component 완전 초기화
6. WorldRegistry 등록
7. `EntitySpawned` event

제거는 fixed iteration 중 배열을 직접 splice하지 않고 buffer에 넣어 phase
끝에서 stable ordering으로 commit한다.

## 5. Pool 계약

재사용 시 반드시 초기화:

- entity ID/incarnation
- source/owner/execution IDs
- generation과 lane affinity
- transform 이전/현재/렌더 좌표
- velocity와 collision sleep
- hit history와 target set
- lifetime/cooldown/status
- event/listener token
- AI state/cache reference

풀 부족 정책은 kind definition에 둔다.

```text
RejectNew
ReplaceOldest
ReplaceLowestGeneration
```

결과를 `SpawnSuppressed` 또는 `EntityReplaced` event로 기록한다.

## 6. CollisionHandler 경계

CollisionHandler는 기하와 위치 해소를 소유한다.

소유:

- collision body 작성
- broad phase 후보
- exact contact/manifold
- 위치 보정과 충돌 sleep
- projectile sweep의 접촉 시점/대상 판정

소유하지 않음:

- 최종 damage formula
- Gold drop
- Word effect
- Wave 완료
- UI/VFX

projectile 충돌 결과는 `HitIntent`로 CombatResolver에 전달한다.

동적 접촉 해소 순서:

```text
contact manifold
→ 두 바디 inverseMass 조회
→ 법선 impulse 계산
→ IPhysicsBody2D.applyImpulse
→ 침투 깊이 위치 보정 계산
→ IPhysicsBody2D.applyPositionCorrection
```

```text
projectileHandle
targetHandle
contactPoint
contactNormal
timeOfImpact
sourceAbilityId
executionId
```

기존 코드가 직접 enemy hit count나 active 상태를 바꾸는 경로는 adapter 단계에서
event를 함께 기록하고, 최종 cutover에서 CombatResolver 권한으로 이동한다.

## 7. 보존할 fixed collision 순서

```text
PhysicsSystem.beginFrame
→ player/item/projectile fixed integration
→ enemy AI intent와 movement
→ enemy collision frame 준비
→ prepared hexa contact 수집
→ hexa merge 접촉 시간 갱신
→ enemy/player/wall 위치 충돌 해소
→ projectile sweep과 HitIntent 생성
→ CombatResolver
→ hexa merge presentation/finalize
→ buffered spawn/despawn commit
```

현재 hexa merge의 contact-before-solve 의미가 바뀌지 않게 characterization
test를 먼저 고정한다.

## 8. WASM 충돌 커널 보존

보존 대상:

- prepared hexa contact의 candidate 순서
- JS detector와 byte/boolean parity
- WAT → bytes deterministic build
- capability/초기화/실행 실패 시 영구 JS fallback
- Float32 part 입력을 기존 순서로 f64 연산하는 계약

재사용 방식:

```text
new WorldRegistry/Collider components
→ CollisionBodyAdapter
→ 기존 canonical SoA plane
→ 기존 JS/WASM backend
→ contact flags
→ 새 Hit/ContactIntent
```

WASM 코드가 새 entity 객체나 GameState를 직접 알게 하지 않는다.

## 9. Tower 충돌

Tower collision은 다음만 허용한다.

- 월드 경계·정적 장애물과 위치 해소
- 적과 겹침 방지 또는 약한 밀림
- 콘텐츠가 허용한 knockback/stun intent
- Tower 스킬 공격의 반대 방향 recoil impulse

금지:

- Tower damage event
- Tower HP body field
- 적이 Tower 처치를 기다리며 Core 진행을 영구 중단
- collision code에서 pause/패배 전이

현재 타일 슬라이스에서는 Tower 대 정적 타일 충돌만 수직 연결되어 있다.
Tower/Core collider는 capability index에 함께 등록되지만 일반 object-object
CollisionHandler가 아직 없으므로 Core와 Tower의 원형 접촉 해소는 후속
구현 범위다.

## 10. Core 충돌

Core는 고정형 target body 또는 Path 끝 attack zone으로 표현한다.

- 단순 접촉 자체가 즉시 damage인지 공격 state 진입인지는 적 behavior가 결정한다.
- damage는 CombatResolver를 통과한다.
- Core body는 movable pair budget에 포함하지 않는다.
- Core 파괴 뒤 신규 attack intent를 수락하지 않는다.

## 11. 렌더 보간

- fixed step 시작에 이전 Transform을 보관한다.
- solver correction은 현재 위치/body/SoA에 반영하되 이전 렌더 위치를 같이
  이동하지 않는다.
- 가변 update에서 alpha로 render transform을 계산한다.
- draw는 물리 Transform이 아니라 render Transform을 사용한다.
- resize는 viewport와 UI projection만 바꾸며 월드 entity를 다시 생성하지 않는다.
- spawn/teleport/resize처럼 보간을 의도적으로 끊는 경계만 현재/이전 위치를
  함께 동기화한다.

## 12. 성능 원칙

- interface validation은 등록 시 수행한다.
- inner collision loop는 숫자 kind/shape code와 SoA를 사용한다.
- query scratch와 candidate buffer를 재사용한다.
- 전체 projectile × enemy O(N²)를 허용하지 않는다.
- 이벤트 수가 많으면 HitBatch를 사용하되 damage 순서를 보존한다.
- debug recorder on/off가 시뮬레이션 결과를 바꾸지 않아야 한다.

## 13. 전환 완료 기준

- GameScene이 player/wall/projectile 배열을 직접 소유하지 않는다.
- 외부 호출자가 enemy live 배열을 변경할 수 없다.
- 플레이·benchmark 월드가 별도 WorldRegistry를 사용한다.
- Tower에 Health 관련 필드가 없다.
- WASM collision parity와 기존 고밀도 benchmark gate가 유지된다.
- 맵 전환과 scene destroy 뒤 active entity/listener가 0이다.
- production 월드 renderer에 고정 픽셀 크기·간격이 없고 2560×1440 및 다른
  해상도에서 동일한 월드 비율을 유지한다.
