> **2026-08-19 R5 Turn 3 authority update**
>
> Tower HP/death, Enemy Entity Word, and multi-Tower Share/group control are implemented. Canonical logical
> Tower state belongs to CPU `TowerGroupState`/`TowerShareLedger`; GPU bodies own combat/transform and compact
> roster/control/summary/query/creation runtimes. R5 Turn 3 adds a typed consumer that joins the retained GPU
> actor-placement token to the R4 0/N Tower creation transaction, bounded metadata-only CPU commit, and durable
> map recovery descriptors. Production input remains gated until Turn 4. Transit advance, Merge, Overtime, Shop,
> and checkpoint remain target systems. Read
> `../gameplay/README.md`; any no-HP/no-Enemy/single-Tower authority is superseded.

# 01. Target Architecture

## 1. 설계 목표

- 실제 게임 규칙과 엔진 전역 서비스를 분리한다.
- GameScene 교체만으로 한 게임 세션 전체를 생성·파괴할 수 있게 한다.
- Core/웨이브/상점/단어 규칙을 headless 환경에서 검증할 수 있게 한다.
- 기존 고성능 커널을 새 도메인 권한 아래에서 재사용한다.
- UI, 저장, 로그가 live 오브젝트 배열을 직접 읽지 않게 한다.
- 시스템 추가가 `GameSystem`의 거대한 switch나 전역 singleton 접근 증가로 이어지지 않게 한다.

## 2. 전체 계층

```text
Engine Shell
├─ App / TimeHandler
├─ SystemHandler
├─ Display / Animation / Input / Sound
├─ global UISystem / Overlay / Debug
└─ SceneSystem
   └─ GameScene
      └─ GameSystem                         per-session authority
         ├─ GameStateStore
         ├─ GameCommandRouter
         ├─ GameEventStream
         ├─ TowerGroupState / TowerShareLedger
         ├─ RunRngService
         ├─ WaveDirector
         ├─ ShopCoordinator
         ├─ CheckpointCoordinator
         ├─ GameObjectSystem
         │  ├─ WorldRegistry
         │  ├─ EntityFactory / PoolManager
         │  ├─ TileMap / WorldCamera2D
         │  └─ PhysicsSystem
         │     └─ CollisionHandler
         │        └─ TileMapCollisionResolver
         ├─ AISystem
         │  ├─ EnemyPolicyRegistry
         │  ├─ PathService
         │  └─ FlowFieldService
         ├─ LogSystem
         │  ├─ EventJournal
         │  └─ StatisticsAggregator
         ├─ WordSystem
         │  ├─ SentenceAuthoringService
         │  ├─ SentenceCompiler
         │  ├─ AbilityRuntime
         │  └─ ActionExecutorRegistry
         └─ GameUISystem
            ├─ HUDPresenter
            ├─ ShopPresenter
            └─ SentenceBoardPresenter
```

`WaveDirector`, `ShopCoordinator`, `CheckpointCoordinator`는 여섯 번째 상위
시스템이 아니라 GameSystem이 직접 소유하는 application service다.

현재 R5 Turn 3 slice는 이 계층을 축소해 유지한다. `GameScene`은 하나의 `GameSystem`을 계속 소유하고,
`GameSystem`은 CPU `CoreIntegrity`, canonical `TowerGroupState`/`TowerShareLedger`, input/router/camera,
`WordSystem`, 다섯 Sentence slot/cooldown, `GoldLedger`, 그리고 `GameObjectSystem`을 소유한다. ready
session의 `GameObjectSystem` 안에는 교체 가능한 단일 mixed GPU World가 있으며 모든 living Tower,
Core proxy, Enemy, projectile, collision, transient HP window, compact Tower roster/control/summary, atomic
technical creation, source-local target query, and R3 actor materialization을 함께 처리한다. unsupported
session은 별도 `CPU_NO_WAVE_FALLBACK`으로 시작한다. Device recovery는 CPU run domain을 재생성하지 않고
GPU world만 교체하며 모든 committed living Tower를 새 exact handle에 재바인딩한다.

R5의 `GpuActorActionPlacementRuntime`은 production world에 연결하기 전 단계의 독립 GPU side-plane이다. Frozen
R3 Subject snapshot, compact Tower roster/Core, shared Aim, immutable action profile, SDF를 입력받고 placement/
Throw-transit storage와 96-byte aggregate만 만든다. CPU는 aggregate와 generation-qualified token만 보며
body/Tower/Share를 직접 변경하지 않는다. Turn 3의 `GPU_SUBJECT_ACTOR_ACTION` coordinator mode만 token을
소비할 수 있다. 이 mode는 snapshot/token 수명, R4 Share plan, Registry/body prelease, placement identity,
TowerCreation ABI v2 completion, metadata-only child record를 한 replay envelope로 소유한다. 별도 7-storage
pass가 transform/generation을 쓰고 기존 9-storage pass가 HP/Share/Power와 `ALIVE`-last를 끝낸다. 아직
production endpoint capability는 열지 않았고 Turn 4 전까지 R3 Q/E만 주입하므로 SHIFT/SPACE는 empty-slot
정상 결과이며 `AbilityRuntime` ingress가 없다.

production primary-pointer/LMB는 CPU 물리 projectile을 만들지 않는다. 하나의
`GpuTowerGroupFacade`가 semantic movement/Aim을 group command로 보내고, primary compatibility action은
canonical lowest-living-ordinal Tower exact handle과 같은-tick GPU aim을 사용해 source-relative
SpawnProgram을 요청한다. 각 Tower pose/collision/projectile origin은 GPU-authoritative이며 CPU는 bounded
group summary만 presentation/camera에 소비한다. Primary death는 다음 living ordinal로 rebind하고, zero
living Towers는 Core camera fallback을 사용한다. R5 technical Tower Payload transaction/body commit은
준비됐지만 production input 연결, transit advance, Merge, wave completion/Overtime, Shop, checkpoint는 이
slice에 포함되지 않는다.

## 3. 의존 방향

```text
GameScene → GameSystem

GameSystem → subsystem interfaces
GameObjectSystem → collision/AI/combat ports
WordSystem → world query/combat/spawn/event ports
AISystem → read-only world/path query + intent writer
GameUISystem → read-only GameView + command sink
LogSystem → committed event stream
CheckpointCoordinator → checkpoint builder + repository port

Infrastructure adapters → interface implementations
Domain state/compiler/formula → 엔진 모듈을 import하지 않음
```

금지:

- 하위 시스템이 `GameScene`을 import
- 도메인 코드가 display/input/save singleton을 직접 조회
- UI가 Gold, Core Integrity, WordInstance를 직접 변경
- LogSystem 이벤트가 전투 상태 변경의 유일한 실행 경로가 됨
- CollisionHandler가 상점, 문장, 현지화 문자열을 앎

## 4. GameScene 책임

`GameScene`은 엔진 lifecycle을 인게임 세션으로 전달하는 얇은 adapter다.

```text
constructor
→ dependency bundle 확인
→ GameSystem 생성
→ GameSystem.enter(resumeRequest)

fixedUpdate
→ GameSystem.fixedUpdate(fixedContext)

update
→ GameSystem.update(frameContext)

draw
→ GameSystem이 등록한 world presenter 호출

resize
→ viewport snapshot 갱신
→ UI/layout 재계산
→ 월드 reset 금지

applySimulationCommands
→ GameCommandRouter에 전달

destroy
→ 입력/UI scope 해제
→ 대기 command 폐기
→ 세션 오브젝트 반환
→ GameSystem.destroy
```

## 5. GameSystem 책임

GameSystem은 세션의 조정자이며 모든 세부 로직을 직접 구현하지 않는다.

소유:

- GameStateStore와 현재 fixed tick
- phase 전이와 불변식
- subsystem 생성·초기화·파괴 순서
- command 수락/거절과 result code
- fixed phase 실행 순서
- committed event flush
- checkpoint 시작과 저장 실패 상태

소유하지 않음:

- 개별 적 AI 수학
- 충돌 manifold 계산
- 문장 컴파일 규칙의 세부 구현
- Canvas/WebGL draw API
- JSON 파일 I/O 세부 절차

## 6. 월드 권한

최종적으로 `WorldRegistry`가 모든 게임 엔티티의 canonical owner가 된다.

| 데이터 | 유일한 쓰기 권한 |
| --- | --- |
| Entity 생성·제거·ID | GameObjectSystem |
| 위치·속도·충돌 결과 | GameObjectSystem/Physics 단계 |
| Tower logical ID/ordinal, Share/Lost Share, derived HP/Power, primary 선택 | TowerGroupState/TowerShareLedger |
| Tower GPU exact binding, combat HP/transform/death | GameObjectSystem의 active GPU world |
| Core Integrity | CombatResolver를 통한 GameStateStore |
| 웨이브 진행 | WaveDirector |
| Gold·Lexicon·SentenceBoard | GameSystem의 command handler |
| CompiledAbility | WordSystem |
| ShopSession | ShopCoordinator |
| 이벤트 journal/통계 | LogSystem |
| 화면 표시 상태 | GameUISystem의 view model |
| 디스크 checkpoint | RunCheckpointRepository |

외부 시스템은 live 배열 대신 `IWorldQuery`, `IGameStateView`,
`IStatisticsView`를 사용한다.

## 7. 제안 코드 경로

```text
project/game/script/module/
├─ scene/game/
│  ├─ _game_scene.js
│  └─ game_scene_dependency_factory.js
├─ ingame/
│  ├─ game_system.js
│  ├─ contract/
│  │  ├─ game_subsystem_contract.js
│  │  ├─ game_command_contract.js
│  │  ├─ game_event_contract.js
│  │  └─ player_controllable_contract.js
│  ├─ state/
│  │  ├─ game_state_store.js
│  │  ├─ game_state_schema.js
│  │  ├─ game_state_selectors.js
│  │  └─ game_phase_transition.js
│  ├─ command/
│  │  ├─ game_command_router.js
│  │  └─ fixed_command_buffer.js
│  ├─ event/
│  │  └─ game_event_stream.js
│  ├─ object/tower/
│  │  ├─ tower_group_state.js
│  │  ├─ tower_share_ledger.js
│  │  ├─ tower_creation_coordinator.js
│  │  └─ gpu_tower_group_facade.js
│  ├─ flow/
│  │  ├─ wave_director.js
│  │  ├─ shop_coordinator.js
│  │  └─ checkpoint_coordinator.js
│  ├─ object/
│  │  └─ projectile/gpu_primary_projectile_controller.js
│  ├─ map/
│  ├─ ai/
│  ├─ log/
│  ├─ word/
│  └─ ui/
└─ save/ingame/
   ├─ run_checkpoint_repository.js
   ├─ run_checkpoint_schema.js
   ├─ run_checkpoint_validator.js
   ├─ run_checkpoint_serializer.js
   ├─ run_checkpoint_atomic_writer.js
   └─ migrations/
```

구현 시 `index.html` importmap에 `ingame/` 별칭을 추가한다. `data/`에는
맵·웨이브·단어·적·밸런스처럼 코드와 독립적인 선언값만 둔다.

현재 타일 월드의 선언 데이터 경로:

```text
project/game/script/data/
├─ object/tower/the_tower_data.js
├─ object/core/the_core_data.js
├─ object/projectile/basic_bullet_data.js
└─ scene/game/corridor_eight_map_data.js
```

Tower 크기·이동·물리 수치와 production Tower member capacity 256, Core Integrity, Basic Bullet의 speed/radius/damage/
penetration/lifetime/render 수치, 맵 path width와 방향 route는
위 data 모듈이 유일한 권한이다. 구현 모듈은 직접 named import하고 같은
fallback 값을 다시 선언하지 않는다.

Production Tower capacity는 `THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY` 하나에서 preview,
technical creation status, gameplay diagnostics, and acceptance receipt로 흐른다. 이 member-count cap은
GPU body stable-slot 주소 범위와 별개이며, runtime-only 1,000-Tower group-control fixture가 상용 값을
1,000으로 올리지 않는다.

## 8. 초기화와 파괴 순서

```text
GameSystem.enter
→ checkpoint load/새 런 선택
→ 콘텐츠 ID와 schema 검증
→ GameStateStore 생성
→ GameEventStream
→ LogSystem
→ GameObjectSystem
→ AISystem 연결
→ WordSystem
→ Wave/Shop/Checkpoint coordinator
→ GameUISystem scope 등록
→ resume phase 또는 첫 map setup
→ TileMap blocked grid와 복수 Gate route 검증
```

파괴는 역순으로 수행한다. 저장 Promise가 진행 중일 때 씬이 파괴되면 임의
취소하지 않고 저장 coordinator가 완료·실패를 정리한 뒤 참조를 해제한다.

## 9. 스케줄러 전환 원칙

현재 `SystemHandler`가 `ObjectSystem.fixedUpdate()` 후
`SceneSystem.fixedUpdate()`를 호출하므로 새 GameSystem이 ObjectSystem을 다시
호출하면 이중 tick이 된다.

전환 중에는 둘 중 하나만 선택한다.

1. 임시 단계: 기존 ObjectSystem은 SystemHandler가 tick하고 GameSystem은
   `LegacyObjectPort`로 결과만 받는다.
2. 최종 단계: gameplay ObjectSystem을 GameSystem 내부로 옮기고
   SystemHandler의 전역 ObjectSystem tick을 제거한다.

두 경로를 동시에 활성화하는 feature flag는 허용하지 않는다. cutover는
테스트가 보호하는 단일 변경 경계로 수행한다.
