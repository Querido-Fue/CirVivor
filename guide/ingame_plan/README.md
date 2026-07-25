# Ingame Architecture Plan

> **상태**: 인게임 재설계의 기준 문서
>
> **적용 범위**: `GameScene` 진입부터 웨이브, 상점, 재개 체크포인트, 런 종료까지
>
> **핵심 결정**: Tower는 체력이 없고, 기존 play 구현은 기술 커널만 선별 보존한 뒤 재구축한다.

이 디렉터리는 인게임 구현 작업의 라우터다. 이 파일에는 세부 규칙을 중복해서
적지 않고, 작업 종류에 맞는 문서만 연결한다.

## 1. 먼저 적용할 권한 순서

1. 현재 사용자 요구사항
2. 이 디렉터리의 확정 계약
3. 루트 `AGENT_GUIDE.md`의 현재 런타임 계약
4. `guide/game structure/`의 제품·콘텐츠 설계
5. 기존 placeholder/benchmark 코드의 관찰된 동작

충돌 시 [`00_authority_and_scope.md`](./00_authority_and_scope.md)를 따른다.
특히 기존 문서의 Tower HP, Tower Down, Reboot 항목은 더 이상 인게임 구현
근거로 사용하지 않는다.

## 2. 작업별 라우팅

| 작업 | 먼저 읽을 문서 |
| --- | --- |
| 현재 구현 완료 범위, 미구현, 임시 우회, 다음 작업 | [`game_implement_progress.md`](./game_implement_progress.md) |
| 확정 결정, 범위, 기존 문서와의 충돌 | [`00_authority_and_scope.md`](./00_authority_and_scope.md) |
| 전체 계층, 소유권, 폴더 구조 | [`01_target_architecture.md`](./01_target_architecture.md) |
| Core, 웨이브, 상점, 일시정지, 런 상태 | [`02_game_state_and_flow.md`](./02_game_state_and_flow.md) |
| GameSystem과 5개 하위 시스템의 인터페이스 | [`03_system_contracts.md`](./03_system_contracts.md) |
| 키 바인딩, 의미 action, UI 포커스, PlayerControllable, wheel 카메라 zoom | [`04_input_and_control.md`](./04_input_and_control.md) |
| 오브젝트, 풀, 충돌, WASM 충돌 커널 | [`05_object_and_collision.md`](./05_object_and_collision.md) |
| Core 지향 AI, Path/Lane, Flow Field, WaveDirector | [`06_ai_path_and_wave.md`](./06_ai_path_and_wave.md) |
| 타일 월드 단위, 해상도 독립 projection, 6타일 경로, 복수 적 Gate와 방향 route | [`05_object_and_collision.md`](./05_object_and_collision.md), [`06_ai_path_and_wave.md`](./06_ai_path_and_wave.md) |
| 단어 문장, 능력 실행, 전투 판정 | [`07_word_and_combat.md`](./07_word_and_combat.md) |
| 이벤트 로그, 대미지 및 런 통계 | [`08_log_and_statistics.md`](./08_log_and_statistics.md) |
| HUD, 상점, 문장 편집 UI | [`09_game_ui.md`](./09_game_ui.md) |
| `ingame.dat`, 웨이브 체크포인트, 복구·마이그레이션 | [`10_ingame_checkpoint.md`](./10_ingame_checkpoint.md) |
| 기존 코드 보존/폐기 판단과 전환 전략 | [`11_legacy_reuse_and_cutover.md`](./11_legacy_reuse_and_cutover.md) |
| 구현 단계, 의존 순서, 완료 게이트 | [`12_implementation_roadmap.md`](./12_implementation_roadmap.md) |
| 단위·통합·저장 장애·성능 검증 | [`13_testing_and_acceptance.md`](./13_testing_and_acceptance.md) |
| 아직 결정하지 않아도 되는 정책 | [`14_open_decisions.md`](./14_open_decisions.md) |

## 3. 최소 읽기 조합

### GameSystem 골격 작업

1. `00_authority_and_scope.md`
2. `01_target_architecture.md`
3. `02_game_state_and_flow.md`
4. `03_system_contracts.md`

### 저장과 이어하기 작업

1. `00_authority_and_scope.md`
2. `02_game_state_and_flow.md`
3. `10_ingame_checkpoint.md`
4. `13_testing_and_acceptance.md`

### 전투 런타임 작업

1. `03_system_contracts.md`
2. `05_object_and_collision.md`
3. `06_ai_path_and_wave.md`
4. `07_word_and_combat.md`

### UI 작업

1. `02_game_state_and_flow.md`
2. `04_input_and_control.md`
3. `09_game_ui.md`
4. `10_ingame_checkpoint.md`

## 4. 한눈에 보는 목표 구조

```text
GameScene
└─ GameSystem
   ├─ GameObjectSystem
   │  └─ PhysicsSystem
   │     └─ CollisionHandler
   ├─ AISystem
   ├─ LogSystem
   ├─ WordSystem
   └─ GameUISystem
```

위 트리는 클래스 상속도가 아니라 **소유·조합 관계**다. `GameScene`만
`BaseScene`을 상속한다. 하위 시스템은 작은 인터페이스와 생성자 주입으로
연결한다.

## 5. 확정된 핵심 규칙

- Tower에는 HP, 피해, 사망, Down, Reboot가 없다.
- Core Integrity가 전투의 생존 자원이며 기본 패배 조건이다.
- 기존 `GameScene` play 경로는 placeholder로 보고 호환성보다 재설계를 우선한다.
- 한 실제 타일은 1 월드 단위이고 Tower 지름은 1타일이다. 물리·AI·저장
  좌표는 viewport와 무관하다.
- 모든 production 게임 요소는 고정 픽셀 크기를 선언하지 않는다. 월드는
  `IWorldViewProjection2D`, UI는 비율 단위와 anchor를 통해 표시한다.
- `WorldCamera2D`의 기준 배율은 전체 맵 contain 결과이며 기본 zoom은
  `0.7`이다. 기본 상태는 맵 중심을 표시하고, 그보다 확대되면 보간된 Tower
  좌표를 화면 중앙에서 추종한다. 맵 경계에서도 offset을 clamp하지 않아 월드
  밖 배경을 표시한다. 정적 타일 projection은 최초 draw와 projection
  revision 변경 때만 갱신한다.
- 첫 맵 통로 폭은 6타일이며 왼쪽 진입 복도는 ㄴ자, 오른쪽 Core 복도는
  ㄱ자다.
- 맵은 `enemySpawnRoutes[]`로 복수 Gate를 지원한다. 각 route는
  `gateId`, `pathId`, 순서가 있는 waypoint를 가지며 모두 Core attack point로
  연결되어야 한다.
- 8자 교차점처럼 같은 위치를 다시 통과하는 경로는 전역 Core Flow Field 하나로
  진행 방향을 결정하지 않는다. 적의 `waypointIndex`와 다음 경로 목표를 함께
  사용한다.
- 검증된 fixed-step, 렌더, 풀, WASM 충돌·Flow Field 커널은 계약 테스트 후 재사용한다.
- 물리 `KeyboardEvent.code`는 input 모듈 밖으로 누출하지 않는다. UI와
  시뮬레이션은 의미 action과 snapshot/Command/View 경계를 사용한다.
- wheel은 정규화된 누적 합계를 snapshot으로 전달하고 각 소비 adapter가
  직전 합계와의 차이를 한 번만 처리한다.
- 웨이브 완료 상태는 후처리와 ShopSession 생성까지 끝난 뒤 `ingame.dat`에 저장한다.
- 전투 중 엔티티 위치는 저장하지 않으며 마지막 안전한 웨이브 경계에서 재개한다.
- 저장 실패를 성공처럼 처리하거나 손상 파일을 조용히 새 런으로 덮어쓰지 않는다.

## 6. 문서 유지 규칙

- **인게임 코드를 구현·수정한 모든 작업은 종료 전에
  [`game_implement_progress.md`](./game_implement_progress.md)를 반드시 갱신한다.**
  완료 범위, 미구현 범위, 새로 추가하거나 제거한 임시 우회, 검증 결과, 다음
  구현 순서를 실제 코드 기준으로 기록한다.
- 골격이나 no-op 메서드는 완료로 표시하지 않는다. 부분 구현은 실제 동작 범위와
  완료 게이트의 남은 항목을 함께 적는다.
- 구조나 권한이 바뀌면 먼저 `00`~`03` 문서를 갱신한다.
- 저장 스키마 변경은 `10`과 `13`을 함께 갱신한다.
- 구현 단계가 완료되면 `12`의 상태와 실제 파일 경로를 갱신한다.
- 수치만 바뀌면 해당 콘텐츠 데이터와 조정 문서에 기록하고 구조 문서를 수정하지 않는다.
- Tower 이동·물리 수치, Core Integrity, 맵 경로 폭·route 같은 게임플레이
  선언값은 `project/game/script/data/`만 수정한다. 구현 모듈에 fallback 숫자를
  복제하지 않는다.
- 정식 진행 기록은 `game_implement_progress.md` 하나만 사용한다. 그 밖의 임시
  메모 파일은 늘리지 않고 가장 가까운 세부 문서에 흡수한다.
