# 03. GameSystem and Subsystem Contracts

## 1. 상속이 아닌 조합

목표 관계:

```text
GameScene extends BaseScene
GameScene owns GameSystem
GameSystem owns five subsystem instances
subsystems implement contracts
```

금지 관계:

```text
GameScene extends GameSystem
ObjectSystem extends GameSystem
UISystem extends GameSystem
entity extends every capability base class
```

JavaScript의 단일 상속과 기존 UI/적 base class를 고려하면 시스템 상속은 재사용을
늘리지 않고 결합만 만든다.

## 2. 공통 subsystem 계약

개념 계약:

```javascript
/**
 * @typedef {object} IGameSubsystem
 * @property {(context: GameInitContext) => void|Promise<void>} init
 * @property {(context: FixedGameContext) => void} [fixedUpdate]
 * @property {(context: FrameGameContext) => void} [update]
 * @property {() => void|Promise<void>} destroy
 */
```

규칙:

- 생성자는 값 할당과 dependency 보관만 한다.
- 다른 subsystem의 `init()`을 생성자에서 호출하지 않는다.
- `fixedUpdate()`는 fixed delta와 tick만 사용한다.
- `update()`는 보간·UI·표현에만 frame delta를 사용한다.
- `destroy()`는 멱등이어야 하며 등록 token, listener, pool lease를 해제한다.
- optional method 존재 여부는 초기 등록 시 한 번 분류하고 hot path에서 매번
  duck typing하지 않는다.

## 3. Dependency Bundle

GameScene은 singleton getter를 하위 시스템에 퍼뜨리지 않고 한 번 조립한다.

```text
GameDependencies
├─ timePort
├─ pausePort
├─ inputActionSource
├─ displayPort
├─ uiHostPort
├─ soundPort
├─ checkpointRepository
├─ contentRegistry
├─ profilerPort
└─ runtimeSettingsView
```

테스트에서는 위 port를 메모리 구현으로 교체한다.

## 4. GameSystem 공개 계약

```text
enter(startRequest) -> Promise<EnterResult>
fixedUpdate(fixedContext) -> void
update(frameContext) -> void
handleCommands(commands) -> CommandResult[]
resize(viewportSnapshot) -> void
getView() -> IGameStateView
requestCheckpoint(reason) -> Promise<CheckpointResult>
destroy() -> Promise<void>
```

`startRequest`:

```text
NewRunRequest
ContinueRunRequest
BenchmarkRequest
HeadlessTestRequest
```

Benchmark는 실제 play GameSystem에 버튼 분기를 섞지 않고 dependency와 초기
콘텐츠를 바꾼 별도 진입 요청 또는 `BenchmarkScene`으로 유지한다.

## 5. 5개 하위 시스템

### 5.1 GameObjectSystem

제공:

```text
IWorldQuery
IWorldMutationSink
IEntityFactory
ICollisionQuery
ISpawnBudgetPort
IWorldView
```

책임:

- 모든 전투 entity의 ID, component, 풀, 생성·제거
- fixed integration
- PhysicsSystem과 CollisionHandler 소유
- AI/Word가 만든 intent 적용
- 전투 월드 snapshot과 렌더 view 제공

금지:

- Gold·Shop·SentenceBoard 직접 변경
- UI element 생성
- 저장 파일 접근

### 5.2 AISystem

제공:

```text
IAIDecisionService
IPathService
INavigationFieldService
```

책임:

- Core/Path/Lane 기반 목표 선택
- 정책별 decision과 steering intent
- Flow Field/LOS cache
- decision group과 공간 인덱스

금지:

- entity 배열 직접 제거
- Core Integrity 직접 감소
- presentation 상태 접근

### 5.3 LogSystem

제공:

```text
IGameEventSink
IStatisticsView
IDebugEventQuery
```

책임:

- 확정 event의 bounded journal
- damage, ability, word, wave, lane 통계
- 체크포인트용 aggregate snapshot

금지:

- event를 다시 command로 발행해 상태 변경
- 엔티티 객체 참조 장기 보관
- 매 hit 문자열 생성 또는 console 출력

### 5.4 WordSystem

제공:

```text
ISentenceAuthoring
ISentenceCompiler
IAbilityRuntime
IAbilityEstimator
ICompiledAbilityView
```

책임:

- WordDefinition/Instance 참조 검증
- 문장 편집 transaction
- 불변 CompiledAbility 생성·캐시
- subject snapshot, target/action/spawn 계획
- cooldown과 generation/work budget

금지:

- raw input polling
- Canvas 텍스트 생성
- CollisionHandler 내부 호출

### 5.5 GameUISystem

제공:

```text
IGameUIPresenter
IPlayerControllable registrations
IGameViewConsumer
```

책임:

- HUD, 상점, 문장 편집, 저장 오류 화면
- global UISystem의 primitive/layout 사용
- view snapshot과 event를 표시 데이터로 변환
- UI action을 semantic command로 변환

금지:

- GameState live 참조 수정
- 파일 I/O
- 전투 시간축으로 UI 애니메이션 진행

## 6. Application service

### WaveDirector

GameState의 wave slice만 변경하며 GameObjectSystem에 spawn intent를 보낸다.

### ShopCoordinator

offer 생성, 가격, transaction, WordSystem 재컴파일 무효화를 조정한다.

### CheckpointCoordinator

현재 GameState와 각 subsystem의 checkpoint contribution을 모아 repository에
커밋한다. 파일 시스템 세부 구현을 알지 않는다.

### CombatResolver

Collision/Ability가 만든 hit intent를 받아 피해와 사망을 확정한다. Core와
적·구조물 대상 규칙을 분리하고 Tower를 피해 대상으로 받지 않는다.

## 7. Command 계약

모든 command envelope:

```text
type
commandId
requestedAtFrame
targetFixedTick
expectedStateRevision optional
payload
```

결과:

```text
ACCEPTED
REJECTED_INVALID_PAYLOAD
REJECTED_WRONG_PHASE
REJECTED_STALE_REVISION
REJECTED_DUPLICATE
REJECTED_NO_SUBJECT
REJECTED_COOLDOWN
REJECTED_CAP
REJECTED_SAVE_PENDING
```

Command는 거절될 수 있다. 거절된 command는 상태와 cooldown을 바꾸지 않는다.
현재 command queue처럼 `type` 문자열 존재만 검사하는 계약은 새 인게임
command에 사용하지 않는다.

## 8. Event 계약

모든 committed event envelope:

```text
eventType
eventId
sequence
fixedTick
runId
mapId
waveId
payload
```

규칙:

- event는 이미 확정된 사실이다.
- sequence는 같은 fixed tick 안에서 단조 증가한다.
- 객체 대신 안정 ID를 담는다.
- 대량 hit는 batch event를 허용하되 원래 결정 순서를 보존한다.
- UI/VFX/Log가 구독하며 전투 권한은 event 구독 순서에 의존하지 않는다.

## 9. fixed-step 실행 순서

```text
GameSystem.fixedUpdate
├─ fixed tick 증가
├─ target tick Command drain/validate
├─ GameEventStream.beginTick()
├─ phase guard
├─ WaveDirector가 spawn intent 생성
├─ WordSystem이 skill command와 ability intent 처리
├─ GameObjectSystem.fixedUpdate
│  ├─ player/item/projectile begin step
│  ├─ AISystem decision/steering 호출
│  ├─ enemy movement integration
│  ├─ collision frame/contact/solve
│  ├─ projectile hit intent
│  └─ merge/spawn/despawn commit
├─ CombatResolver hit/damage/death 확정
├─ WaveDirector completion 검사
├─ GameState invariant 검사
├─ GameEventStream.commitTick()
└─ LogSystem aggregate 반영
```

기존 hexa contact → 위치 solve → projectile → merge finalize의 의미 순서는
`05_object_and_collision.md`에 적힌 보존 경계를 따른다.

## 10. 가변 frame 순서

```text
InputSystem raw state update
→ InputActionMapper
→ PlayerControlRouter
→ semantic command enqueue
→ GameSystem.update
   ├─ object render interpolation
   ├─ GameUISystem view binding
   └─ 표현 event 전달
→ draw command 발행
```

가변 update에서 Core, Gold, cooldown, wave timer를 변경하지 않는다.

## 11. 초기화 실패와 파괴

- 중간 subsystem init 실패 시 이미 초기화된 항목만 역순 destroy한다.
- UI/input registration token은 GameSystem이 별도 목록으로 보관한다.
- pending checkpoint가 있으면 완료 결과를 받은 뒤 scene transition을 확정한다.
- destroy 이후 command는 `REJECTED_WRONG_PHASE`가 아니라
  `REJECTED_SESSION_DESTROYED`로 진단한다.
- destroy는 `WorldRegistry` active count와 event subscriber count가 0인지
  debug build에서 확인한다.

