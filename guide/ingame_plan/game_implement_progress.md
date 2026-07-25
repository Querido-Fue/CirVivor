# Game Implementation Progress

> **문서 역할**: 신규 인게임 구현의 실제 완료 범위, 미구현 범위, 임시 우회,
> 검증 결과를 기록하는 단일 진행 기준
>
> **마지막 갱신**: 2026-07-26
>
> **현재 슬라이스**: 해상도 독립 타일 월드 + 6타일 ㄴ/8자/ㄱ 맵 +
> 복수 Gate 계약 + The Core Integrity 100 + Tower 타일 충돌·가속 이동

## 1. 갱신 규칙

인게임 코드를 구현하거나 기존 인게임 경로를 변경한 모든 작업은 종료 전에 이
파일을 함께 갱신한다.

반드시 확인할 항목:

1. 실제로 실행되는 완료 범위
2. 파일만 있거나 no-op인 부분을 포함한 미구현 범위
3. 임시 우회와 레거시 의존, 제거 조건
4. 새로 통과한 테스트와 아직 수행하지 않은 검증
5. 다음 구현자가 이어갈 권장 순서

`GameSystem`에 메서드가 존재한다는 이유만으로 해당 기능을 완료로 표시하지
않는다. 사용자 입력부터 상태 변경 또는 화면 출력까지 연결된 범위만 완료로
간주한다.

## 2. 전체 단계 현황

| 단계 | 상태 | 이번 시점의 실제 범위 |
| --- | --- | --- |
| P0 권한·baseline | NOT_STARTED | 설계 문서는 있으나 기존 가이드 충돌 정리와 WASM baseline 고정은 미완료 |
| P1 GameSystem 기반 | IN_PROGRESS | 세션 shell, dependency port, PlayerControllable/PhysicsBody 계약 구현 |
| P2 체크포인트 저장 | NOT_STARTED | `ingame.dat` 신규 repository와 atomic save 미구현 |
| P3 월드·충돌 | IN_PROGRESS | 타일 월드 TileMap, contain projection, 정적 타일 cache, CircleCollider2D, Tower 정적 타일 충돌 구현. WorldRegistry/일반 CollisionHandler 미구현 |
| P4 Tower/Core/Input | IN_PROGRESS | 타일 단위 Tower 가속·마찰 이동과 Core Integrity 100 수직 연결. aim/pause/HUD 미구현 |
| P5 AI·Wave | IN_PROGRESS | 6타일 복수 Gate 방향 route와 54×30 Flow Field grid ABI 구현. 적/PathFollower/WaveDirector 미구현 |
| P6 Word·Combat·Log | NOT_STARTED | 미구현 |
| P7 Shop·UI·Continue | NOT_STARTED | 미구현 |
| P8 production cutover | IN_PROGRESS | play GameScene이 선택 mapId로 신규 TileMap 생성, BenchmarkScene 분리 완료. 전역 ObjectSystem cutover 미완료 |
| P9 hardening | NOT_STARTED | 미구현 |

## 3. 구현 완료 범위

### 3.1 플레이 씬과 세션 소유권

- `GameScene`은 더 이상 기존 맵/스폰/벤치마크 상태를 직접 소유하지 않는다.
- 플레이 진입은 `GameScene → GameSystem → GameObjectSystem` 조합으로 동작한다.
- `GameScene.fixedUpdate/update/draw/resize/destroy`가 세션 `GameSystem`에
  lifecycle을 전달한다.
- resize는 월드를 다시 만들거나 Tower를 중앙으로 초기화하지 않는다. 물리
  좌표는 유지하고 `IWorldViewProjection2D` revision과 정적 타일 cache만
  갱신한다.
- `GameScene`이 받은 `mapId`는 `GameSystem → GameObjectSystem`으로 전달되어
  실제 인게임 TileMap 선택에 사용된다. 알 수 없는 ID는 기본 맵으로 대체한다.
- 기존 성능 측정 코드는 `_benchmark_scene.js`의 `BenchmarkScene`으로 이동했고
  `SceneSystem.benchmarkStart()`가 별도로 진입한다.

실제 파일:

```text
project/game/script/module/scene/game/_game_scene.js
project/game/script/module/scene/game/_benchmark_scene.js
project/game/script/module/scene/game/game_scene_dependency_factory.js
project/game/script/module/ingame/game_system.js
```

### 3.2 PlayerControllable 입력 경로

현재 입력 흐름:

```text
DOM W/A/S/D
→ KeyboardInputHandler의 up/left/down/right 상태
→ SimulationRuntime snapshot
→ InputActionMapper의 MOVE_VECTOR
→ PlayerControlRouter
→ TowerPlayerController (IPlayerControllable)
→ TheTower move intent
→ IPhysicsBody2D control acceleration
→ PhysicsBody2D 마찰·속도·위치 fixed 적분
```

구현된 계약:

- 공개 계약명은 `IPlayerControllable`이며 JS 런타임에서는
  `isPlayerControllable`/`assertPlayerControllable`로 검사한다.
- 초기 요구 명칭 호환을 위해 `isPlayerControllerable` 별칭을 제공한다.
- 라우터는 context 역순, priority 내림차순, 등록 sequence 오름차순으로
  결정적으로 전달한다.
- 대각선 이동 벡터를 정규화하여 축 이동보다 빠르지 않다.
- 이동 키가 모두 해제된 fixed tick에는 0 벡터를 전달해 새 가속을 중단하며,
  기존 속도는 선형 마찰로 감속한 뒤 정지한다.
- 소문자와 Shift가 눌린 대문자 `W/A/S/D`를 모두 인식한다.

실제 파일:

```text
project/game/script/module/ingame/contract/player_controllable_contract.js
project/game/script/module/ingame/contract/physics_body_contract.js
project/game/script/module/ingame/input/input_action_mapper.js
project/game/script/module/ingame/input/player_control_router.js
project/game/script/module/ingame/object/tower_player_controller.js
project/game/script/module/input/_keyboard_input_handler.js
project/game/script/module/simulation/simulation_runtime.js
```

### 3.3 The Tower

- 첫 맵의 오른쪽 ㄱ자 코너 직전에 Tower 한 개를 생성한다.
- Tower는 파란 원(`#2785ff`)으로 `object` WebGL 레이어에 그린다.
- Tower에는 `hp`, `health`, damage/death 상태가 없다.
- 기본 반지름은 0.5타일, 목표 이동 속도는 초당 7.8타일, control
  acceleration은 초당 제곱 78타일, 선형 마찰 계수는 초당 10이다.
- 위 수치는 `data/object/tower/the_tower_data.js`가 유일한 권한이며
  `_TILES` 단위 필드로 명시하고 구현 모듈은 직접 import한다.
- Tower는 질량 1의 dynamic `PhysicsBody2D`를 조합으로 소유하고
  `getPhysicsBody()`로 노출한다.
- 키 입력은 속도를 직접 지정하지 않고 control acceleration을 누적한다.
- 키 해제 후 관성 속도는 fixed delta 기반 지수 마찰로 감소하며 sleep
  임계값 아래에서 0이 된다.
- 위치 변경은 fixed delta만 사용하고, 가변 update는 이전/현재 fixed 위치의
  렌더 보간만 계산한다.
- 원 전체가 보행 가능 타일 안에 남도록 인접 막힌 타일과 위치를 해소한다.
- 엔티티가 raw keyboard나 WebGL API를 직접 import하지 않는다.
- 스킬 반동과 향후 충돌 반응은 같은 `applyImpulse()` 경로를 사용한다.
- 충돌 침투 해소는 이전 위치를 보존하는 `applyPositionCorrection()` 경로를
  사용한다.

실제 파일:

```text
project/game/script/module/ingame/object/the_tower.js
project/game/script/module/ingame/object/the_tower_renderer.js
project/game/script/module/ingame/object/game_object_system.js
project/game/script/module/ingame/physics/physics_body_2d.js
project/game/script/module/ingame/physics/circle_collider_2d.js
project/game/script/data/object/tower/the_tower_data.js
```

### 3.4 타일 맵, 방향 경로와 복수 Gate

- 한 실제 타일은 1 월드 단위이며 Tower 외접사각형 한 변은 1타일이다.
- 첫 맵은 `54 × 30 = 1,620` 실제 타일이며 보행 가능 타일은 828개다.
- `5 × 9` 방향 blueprint는 왼쪽 `위→아래→오른쪽` ㄴ자 진입, 중앙 8자,
  오른쪽 `오른쪽→아래` ㄱ자 Core 진입을 표현한다.
- 실제 route는 직교 인접 waypoint 25개로 컴파일한다.
- route의 각 매크로 셀을 `6 × 6` 실제 타일로 확장해 모든 직선 구간 폭을
  정확히 6타일로 유지한다.
- 짝수 폭 waypoint는 블록의 기하학적 중앙을 사용하고 Flow Field 대표
  row/column은 아래·오른쪽 중앙 tile을 결정적으로 선택한다.
- 경로는 중앙 교차점을 두 번 통과하므로 동일 위치에서도
  `gateId/pathId/waypointIndex`로 다음 진행 방향을 보존한다.
- 맵은 단일 spawn 좌표 대신 `enemySpawnRoutes[]`를 사용한다. 현재
  `west-gate-01` 하나가 있고, 여러 Gate가 같은 Core attack point로 합류할
  수 있는 계약 테스트를 포함한다.
- `TileMap.getNavigationGrid()`는 기존 JS/WASM Flow Field ABI와 같은
  `{cols, rows, size, cellSize, blocked}`를 반환한다.
- `WorldCamera2D`는 실제 표시 `WW × WH`에서 전체 맵을 균일 contain하고
  물리·AI 좌표를 변경하지 않는다.
- `TileMapRenderer`는 828개 정적 타일의 viewport 좌표와 크기를 최초 draw와
  projection revision 변경 시에만 다시 계산한다. 매 프레임 cache를 WebGL
  background batch로 제출한다.
- Tower/Core처럼 동적인 요소는 draw 시 동일 projection으로 좌표와 지름을
  계산하며 고정 픽셀 크기를 사용하지 않는다.
- 제목 맵 선택 preview와 기본 mapId도 `corridor_eight_01`로 교체했다.

실제 파일:

```text
project/game/script/data/scene/game/corridor_eight_map_data.js
project/game/script/module/ingame/contract/tile_navigation_contract.js
project/game/script/module/ingame/map/tile_map.js
project/game/script/module/ingame/map/tile_map_collision_resolver.js
project/game/script/module/ingame/map/tile_map_renderer.js
project/game/script/module/ingame/map/world_camera_2d.js
```

### 3.5 The Core와 Integrity

- The Core는 첫 맵 route의 마지막 `w` 위치에 고정형 주황 원으로 생성한다.
- 최대/초기 Integrity는 `data/object/core/the_core_data.js`의 100이다.
- Tower와 달리 `ICoreIntegrity` component를 가지며 GameSystem이 세션
  생존 자원으로 소유하고 The Core entity에 주입한다.
- Core는 static IPhysicsBody2D와 CircleCollider2D를 제공해 향후 적 공격과
  object-object CollisionHandler에 연결할 경계를 확보했다.

실제 파일:

```text
project/game/script/data/object/core/the_core_data.js
project/game/script/module/ingame/contract/core_integrity_contract.js
project/game/script/module/ingame/state/core_integrity.js
project/game/script/module/ingame/object/the_core.js
project/game/script/module/ingame/object/the_core_renderer.js
```

### 3.6 import와 테스트 기반

- 브라우저 importmap과 Node source-module test loader에 `ingame/` 별칭을
  추가했다.
- 신규 계약 테스트가 가속, 마찰 정지, force/impulse, 충돌 위치 보정, 보간,
  경계, 해상도 비례 projection, 정적 타일 cache, 파란 원 렌더 payload,
  HP 부재, WASD 대소문자 입력을 검증한다.
- `main`의 데이터/테마/UI 구조 개선과 신규 플레이 구조를 통합했다.
  `GameScene`은 플레이 전용 adapter로 유지하고, 기존 진단 월드는 별도
  `BenchmarkScene`으로 라우팅한다.
- `BenchmarkScene`은 삭제된 `data_handler.js`를 참조하지 않는다. 적 catalog는
  직접 import하고 버튼 배치·action은 feature-local 구현 상수로 소유한다.
- `SimulationRuntime`은 `main`의 feature-local 기본값과 신규 keyboard snapshot
  접근자를 함께 보존한다.

## 4. 미구현 범위

다음 항목은 아직 구현되지 않았다.

- `GameStateStore`, GamePhase, WaveState와 Core Integrity store 이관
- CombatResolver를 통한 Core 피해/패배 phase 전이
- 다섯 하위 시스템 중 `AISystem`, `LogSystem`, `WordSystem`, `GameUISystem`
- `GameObjectSystem`의 WorldRegistry, entity handle/pool, spawn/despawn
- 일반 object-object `CollisionHandler`와 기존 JS/WASM 충돌 커널 adapter
- aim, 스킬, pointer, edge FIFO, key rebinding
- 상점/modal/pause context의 실제 target과 gameplay 입력 차단 정책
- WaveDirector, 실제 적 spawn, waypoint PathFollower, stage Flow Field AI,
  한 웨이브 완료 판정
- 단어 문장 compiler, ability/combat, 대미지 통계
- HUD, 상점, 문장 편집, pause UI
- command envelope/router/fixed buffer와 committed event stream
- `ingame.dat` v1 schema, 검증, checksum, 원자적 저장, backup 복구
- 웨이브 종료 저장, 상점 transaction 저장, Continue 진입
- 저장 실패 재시도 UI와 저장 중 씬 종료 조정
- Core Integrity HUD와 적의 Core attack point 진입/공격

`GameSystem.handleCommands()`는 현재 빈 결과를 반환하는 자리만 있으며 command
기능이 구현된 것으로 간주하지 않는다.

## 5. 임시 우회와 레거시 의존

| 임시 항목 | 현재 이유 | 제거 조건 |
| --- | --- | --- |
| `legacyWorldPort.clear()` | `SystemHandler`가 전역 `ObjectSystem`을 계속 fixed/update/draw하므로 이전 타이틀·placeholder 객체를 비워 이중 표시/업데이트를 막음 | gameplay 스케줄러가 세션 `GameObjectSystem`만 tick하도록 P8 cutover 완료 |
| Tower를 최소 `GameObjectSystem`이 직접 소유 | WorldRegistry와 entity factory가 아직 없음 | P3의 handle/incarnation/pool 계약 구현 |
| fixed tick에서 방향 snapshot을 바로 Action으로 변환 | edge command buffer와 frame-to-fixed 전달 계층이 아직 없음 | P1 command buffer 및 P4 입력 snapshot/edge FIFO 구현 |
| gameplay context만 활성 | 상점/modal/pause target이 아직 없음 | GameUISystem과 pause 상태 구현 |
| `TileMapCollisionResolver`가 Tower 대 타일만 직접 해소 | 일반 CollisionHandler/WorldRegistry가 아직 없음. ICollidable2D와 IPhysicsBody2D 경계는 최종 계약과 동일 | P3 CollisionHandler가 정적 타일과 object-object 접촉을 함께 조정 |
| Core/Tower collider를 등록하지만 상호 접촉은 미해소 | 현재 요구는 맵 벽 이동과 Core 상태 수직 연결까지이며 일반 pair solver가 없음 | object-object CollisionHandler 연결 |
| `CoreIntegrity`를 GameSystem component가 직접 소유 | 최소 생존 자원을 먼저 연결했고 GameStateStore/CombatResolver가 아직 없음 | P1 state store와 P4 combat authority로 이관 |
| 방향 route와 blocked grid만 제공하고 실제 적 AI는 없음 | PathFollower, 적 entity, WaveDirector가 아직 없음 | P5에서 `gateId/pathId/waypointIndex` 기반 적 이동 연결 |
| 기존 benchmark 구현 전체 보존 | WASM/충돌/AI 성능 확인 경로를 잃지 않기 위함 | 신규 benchmark dependency로 이식하고 characterization 통과 |
| 레거시 `BenchmarkScene`/전역 `ObjectSystem` 데이터에 `_PX` 단위가 남아 있음 | 신규 `GameSystem`과 격리된 기존 성능 fixture의 baseline을 이번 맵 작업에서 바꾸지 않음 | production cutover 전에 타일 월드 단위 adapter로 이식하거나 폐기. 신규 인게임에서 직접 import 금지 |

위 우회는 기능 완료로 숨기지 않는다. 새 우회를 추가하면 경로, 영향, 제거
조건을 이 표에 함께 기록한다.

## 6. 검증 현황

통과:

```text
cd project
npm test

node --experimental-vm-modules --test \
  game/test/ingame_tower_control.test.mjs \
  game/test/ingame_tile_map.test.mjs
node --experimental-vm-modules --test \
  game/test/title_loading_scene_handoff.test.mjs \
  game/test/map_select_flow.test.mjs

npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:wasm:flow-field:stress
```

전체 결과: `414` tests, `414` pass, `0` fail.

검증된 계약:

- MOVE_VECTOR 대각선 정규화와 상쇄 입력
- Tower fixed-step 가속과 목표 속도 수렴
- 키 해제 직후 관성 이동, 마찰 감속, sleep 정지
- 질량/역질량 기반 force와 impulse
- 스킬 반동용 impulse와 충돌 solver용 위치 보정
- GameObjectSystem 물리·collider capability 등록
- fixed interpolation alpha 적용
- background tile batch, object layer의 Core/Tower 원 렌더 payload
- Tower의 HP/health 필드 부재
- Core Integrity 초기/최대 100과 damage/restore clamp
- Tower 주변 막힌 타일 충돌과 경계 법선 속도 제거
- resize에서 월드 좌표 보존과 카메라 viewport 갱신
- `1타일 = 1월드 단위`, Tower 지름 1타일
- 6타일 직선 폭, 54×30/1,620셀 grid와 828개 보행 타일
- 왼쪽 ㄴ자, 중앙 8자, 오른쪽 ㄱ자 route 진행 순서
- 2560×1440 contain projection과 1280×720에서 정확한 1/2 표시 배율
- 정적 타일 projection이 연속 draw에서는 재계산되지 않고 resize에서만 갱신
- 8자 교차점의 반복 waypoint 진행 순서
- 두 Gate가 같은 Core에 합류하는 map 계약
- 신규 TileMap grid의 기존 WASM Flow Field backend dispatch ABI
- controller interface와 destroy 정리
- 소문자/대문자 WASD
- 기존 loading/title handoff, mapId 전달과 실제 TileMap 선택 계약
- play `GameScene`과 `BenchmarkScene`의 별도 생성·파괴 라우팅
- 삭제된 중앙 `data_handler.js` 없이 benchmark 직접 import 경계
- Flow Field 및 collision contact WAT/WASM 생성물 재현성
- Flow Field stress `1,000` cases / `3,824,454` cells와 ABI canary

아직 이 문서 갱신 시점에 수행하지 않은 검증:

- NW.js 실제 창에서 수동 WASD 이동과 화면 좌표 육안 확인
- 장기 입력/resize 반복 soak
- benchmark 화면 수동 회귀

## 7. 다음 권장 구현 순서

1. 실제 NW.js의 2560×1440 및 다른 종횡비에서 전체 맵, Core/Tower 위치와
   resize cache를 육안·profile로 확인한다.
2. `GameStateStore` 최소 schema로 현재 CoreIntegrity component를 이관한다.
3. fixed command buffer를 넣어 raw snapshot/action/command 경계를 완성한다.
4. WorldRegistry와 component/capability index로 현재 Core/Tower/body/collider 등록을 이관한다.
5. 일반 CollisionHandler가 현재 타일 resolver와 object-object pair를 조정하게 한다.
6. 기존 충돌 JS/WASM 커널을 새 CollisionHandler port 뒤에 연결한다.
7. pause context와 입력 초기화 계약을 구현한다.
8. 현재 `west-gate-01`에 첫 적과 waypoint PathFollower를 연결한다.
9. route stage별 Flow Field를 연결한 뒤 두 번째 Gate fixture를 실제 맵 콘텐츠로 확장한다.
10. WaveDirector와 한 웨이브 완료를 연결한다.
11. 웨이브 종료 `ingame.dat` atomic checkpoint를 구현한다.

## 8. 변경 이력

| 날짜 | 변경 |
| --- | --- |
| 2026-07-26 | 고정 픽셀 월드를 제거하고 `1타일 = 1월드 단위`와 `IWorldViewProjection2D` contain projection으로 전환. 정적 타일 projection cache와 2560×1440/1280×720 비례 검증 추가 |
| 2026-07-26 | 첫 맵을 6타일 폭 `5×9` ㄴ/8자/ㄱ blueprint와 54×30 Flow Field grid로 압축 |
| 2026-07-26 | Tower 목표 이동 속도를 `312 → 374.4`로 추가 20% 상향하고 control acceleration을 `3120 → 3744`로 조정 |
| 2026-07-26 | 방향 ASCII를 적 이동 route로 해석: 7타일 폭 TileMap, 복수 Gate 계약, 126×49 Flow Field grid, 카메라와 Tower 타일 충돌 구현 |
| 2026-07-26 | The Core와 GameSystem 소유 ICoreIntegrity 100, static PhysicsBody/Collider 및 렌더 구현 |
| 2026-07-26 | Tower/Core/맵 게임플레이 수치를 data 모듈로 이동하고 에이전트 상시 참조 규칙 추가 |
| 2026-07-26 | Tower 목표 이동 속도를 `260 → 312`로 20% 상향하고 동일 마찰의 종단 속도에 맞춰 control acceleration을 `2600 → 3120`으로 조정 |
| 2026-07-26 | `origin/main` 구조 개선 통합: 플레이/벤치마크 씬 분리 유지, BenchmarkScene 직접 import 전환, SimulationRuntime keyboard snapshot 병합 |
| 2026-07-26 | IPhysicsBody2D/PhysicsBody2D 추가, Tower 가속·마찰 이동, force/impulse/position correction 경계 구현 |
| 2026-07-26 | 첫 코드 슬라이스: GameScene/GameSystem/GameObjectSystem, 파란 The Tower, IPlayerControllable WASD 이동, BenchmarkScene 분리 |
