# CirVivor AI Agent Guide

> **기준 코드**: 0.48 연속 UI interaction retarget 베이스라인 | **런타임**: NW.js 데스크톱 | **렌더링**: Canvas 2D + WebGL
> 이 문서는 진입 인덱스만 담당합니다. 작업에 필요한 문서만 골라 읽고, 수정 대상 파일은 반드시 전체 내용을 확인한 뒤 변경합니다.

---

## 1. 항상 먼저 확인할 것

1. 이 파일에서 작업 유형에 맞는 가이드를 고릅니다.
2. 코드 수정 전에는 수정 대상 파일 전체를 읽습니다.
3. 코드 수정 후에는 `git diff --check`로 공백 오류와 충돌 마커를 확인합니다.
4. 가이드 변경은 구조, 핵심 로직, 아키텍처 패턴이 바뀔 때만 반영합니다.
5. `.gitignore`에 포함된 로컬 파일이나 폴더까지 탐색해야 할 때는 일반 `rg --files` 대신 `rg --files -uu`를 사용합니다.

---

## 2. 작업별 가이드 라우팅

| 작업 | 먼저 읽을 문서 |
| --- | --- |
| 프로젝트 경로 파악 | [`project_structure_guide.md`](C:/CirVivor/guide/project_structure_guide.md) |
| 시스템 책임/오브젝트 풀/렌더 레이어 파악 | [`module_architecture_guide.md`](C:/CirVivor/guide/module_architecture_guide.md) |
| 초기화, 메인 루프, 고정 스텝, importmap 수정 | [`core_architecture_guide.md`](C:/CirVivor/guide/core_architecture_guide.md) |
| 코딩 컨벤션, 데이터/구현 상수 경계, 주석 규칙 | [`coding_conventions_guide.md`](C:/CirVivor/guide/coding_conventions_guide.md) |
| 코드 정리, 책임 분할, 최적화 후보 확인 | [`domain/code_cleanup.md`](C:/CirVivor/guide/domain/code_cleanup.md), [`progress/code_cleanup_progress.md`](C:/CirVivor/guide/progress/code_cleanup_progress.md) |
| 오버레이/UI 레이아웃 수정 | [`ui_overlay_guide.md`](C:/CirVivor/guide/ui_overlay_guide.md), [`reference/overlay_contract_guide.md`](C:/CirVivor/guide/reference/overlay_contract_guide.md) |
| 연속 입력 애니메이션, slider retarget, tilt smoothing 수정 | [`ui_overlay_guide.md`](C:/CirVivor/guide/ui_overlay_guide.md), [`module_architecture_guide.md`](C:/CirVivor/guide/module_architecture_guide.md) |
| 렌더 커맨드, WebGL/2D 레이어 사용 | [`reference/render_command_guide.md`](C:/CirVivor/guide/reference/render_command_guide.md) |
| 화면 좌표계, UI 기준 폭, 오브젝트 월드 높이 | [`reference/display_viewport_guide.md`](C:/CirVivor/guide/reference/display_viewport_guide.md) |
| 선언형 data, 직접 import, ColorSchemes, 테마 토큰 | [`reference/data_theme_guide.md`](C:/CirVivor/guide/reference/data_theme_guide.md) |
| 씬 전환, destroy 정리 | [`reference/scene_lifecycle_guide.md`](C:/CirVivor/guide/reference/scene_lifecycle_guide.md) |
| 게임 씬 play/benchmark, 시뮬레이션 스냅샷과 명령 큐 | [`domain/game_scene_simulation_guide.md`](C:/CirVivor/guide/domain/game_scene_simulation_guide.md) |
| 신규 인게임 GameSystem, 웨이브/상점/단어/UI, `ingame.dat` 이어하기 재설계 | [`ingame_plan/README.md`](C:/CirVivor/guide/ingame_plan/README.md) |
| 신규 인게임 실제 완료 범위와 임시 우회 확인 | [`ingame_plan/game_implement_progress.md`](C:/CirVivor/guide/ingame_plan/game_implement_progress.md) |
| 키 바인딩, 의미 action, wheel, PlayerControllable 카메라 zoom | [`ingame_plan/04_input_and_control.md`](C:/CirVivor/guide/ingame_plan/04_input_and_control.md), [`ingame_plan/game_implement_progress.md`](C:/CirVivor/guide/ingame_plan/game_implement_progress.md) |
| 인게임 타일맵, 6타일 경로, 복수 Gate, 방향 Path/Flow Field | [`ingame_plan/05_object_and_collision.md`](C:/CirVivor/guide/ingame_plan/05_object_and_collision.md), [`ingame_plan/06_ai_path_and_wave.md`](C:/CirVivor/guide/ingame_plan/06_ai_path_and_wave.md) |
| 충돌 broad phase, narrow phase, solve, 계측 | [`domain/collision_pipeline_guide.md`](C:/CirVivor/guide/domain/collision_pipeline_guide.md) |
| 적 AI/pathfinding 구조 | [`domain/enemy_ai_guide.md`](C:/CirVivor/guide/domain/enemy_ai_guide.md) |
| 육각형 합체 적 구조 | [`domain/hexa_hive_enemy_guide.md`](C:/CirVivor/guide/domain/hexa_hive_enemy_guide.md) |
| Worker, WASM, 멀티코어, native C++ 시뮬레이션 가속 | [`domain/simulation_native_acceleration_guide.md`](C:/CirVivor/guide/domain/simulation_native_acceleration_guide.md), [`core_architecture_guide.md`](C:/CirVivor/guide/core_architecture_guide.md), [`domain/game_scene_simulation_guide.md`](C:/CirVivor/guide/domain/game_scene_simulation_guide.md), [`domain/collision_pipeline_guide.md`](C:/CirVivor/guide/domain/collision_pipeline_guide.md) |
| GitHub Desktop, 게임 실행, 성능 벤치마크 Windows 조작 | [`computer-use-guide.md`](C:/CirVivor/guide/computer-use-guide.md) |
| 에이전트 실수 방지 체크 | [`agent_pitfalls_guide.md`](C:/CirVivor/guide/agent_pitfalls_guide.md) |

---

## 3. 빠른 판단 기준

- **게임 로직/물리/AI**는 fixed step 기준으로 판단합니다.
- **UI/오버레이/렌더링**은 가변 프레임과 표시 좌표계를 기준으로 판단합니다.
- 시작 인트로는 로고 완료까지 `LoadingScene`, 원·로고 이동과 적 spawn부터 `TitleScene`이 소유하며 presentation과 시각 컴포넌트 identity를 handoff합니다.
- `App`은 fixed step 횟수만 계산하고, 실제 실행 순서와 정책 적용은 `SystemHandler.tick()`이 담당합니다.
- 시뮬레이션 경로는 display/input/save 싱글톤 대신 `simulation_runtime.js`의 스냅샷을 우선 읽습니다.
- 물리 `KeyboardEvent.code`는 `input/` 원시 경계에서만 사용합니다. 게임·UI·디버그 소비자는 `INPUT_ACTION_IDS`의 의미 action을 읽고, 사용자 변경값은 `settings.json`의 `inputBindings` 오버라이드로 적용합니다.
- wheel 스냅샷은 소비형 event가 아니라 정규화된 누적 합계입니다. 씬 adapter가 직전 합계와의 차이를 한 번만 action으로 만들며 씬 진입 시 현재 합계를 기준점으로 잡습니다.
- 연속 입력으로 목표가 자주 바뀌는 표준 애니메이션은 handle의 `retarget(properties, speedEasing = false)`로 현재 표시값에서 이어갑니다. 매 입력마다 `remove()` 후 새 애니메이션을 만들지 않으며, 위치 연속성과 같은 ID·Promise를 보존합니다. 두 번째 인자 `speedEasing = true`는 별도 cubic Hermite 경로로 직전 순간 속도를 보존하지만, 일반 UI 호버·슬라이더·zoom의 기본값과 현재 placeholder는 `false`입니다.
- 공통 `BaseUIElement`의 hover/press scale과 hover color는 요소별 scale·hover handle을 하나씩 유지해 상태 반전 때 retarget합니다. 설정 control마다 별도 hover animation을 추가하지 않습니다.
- 신규 인게임 구현에서 Tower는 체력·피해·다운·재부팅 상태가 없으며, Core Integrity가 기본 생존 자원입니다.
- 현재 `GameScene` play 경로는 세션 `GameSystem`과 최소 `GameObjectSystem`으로 전환되었고, benchmark는 별도 `BenchmarkScene`에 보존되어 있습니다. 구현 전에는 `guide/ingame_plan/`의 권한 계약과 `game_implement_progress.md`의 미구현·임시 우회를 함께 확인합니다.
- 신규 인게임 코드를 변경한 작업은 종료 전에 `guide/ingame_plan/game_implement_progress.md`를 실제 코드와 검증 결과에 맞게 갱신합니다.
- **인게임 게임플레이 수치의 유일한 권한은 `project/game/script/data/`입니다.** Tower 크기·이동속도·가속도·마찰·물리 수치, Core Integrity, 맵 경로 폭과 방향 route를 변경하기 전에는 `project/game/script/data/README.md`와 해당 data 모듈을 먼저 확인합니다. 구현 코드에 같은 기본값을 복제하지 않습니다.
- **선언형 데이터와 구현 상수**를 구분합니다. 기본값·catalog·밸런스·테마·번역·리소스 메타데이터는 `data/`에서 직접 named import하고, 레이아웃·렌더·프로토콜·버퍼 크기·알고리즘 상수는 소유 코드에 둡니다.
- **게임 요소의 위치·크기·간격·선 두께·효과 반경을 고정 픽셀로 선언하지 않습니다.** 픽셀은 캔버스 backing store와 최종 viewport adapter에서만 결과 단위로 나타날 수 있습니다. 월드 요소는 타일 단위, UI는 `WW/WH/OW/OH` 비율과 anchor를 사용합니다.
- 신규 인게임은 `1 실제 타일 = 1 월드 단위`, `Tower 지름 = 1타일` 계약을 사용합니다. `WorldCamera2D`가 `min(viewportWidth / worldWidth, viewportHeight / worldHeight)` contain 배율을 resize 때 계산하고 기본 zoom `0.7`을 곱합니다. `0.7`보다 확대되면 `ICameraFollowTarget2D`의 보간된 Tower 좌표를 화면 중앙에서 추종하며, 맵 경계에서도 카메라 offset을 제한하지 않아 월드 밖 배경이 보입니다. 물리·AI·저장 좌표는 resize나 zoom으로 바꾸지 않습니다.
- 정적 타일의 viewport 좌표는 최초 draw와 projection revision 변경 때만 캐시를 다시 만듭니다. 확대 추종 중 Tower의 보간 좌표가 움직이면 매 가변 프레임 revision이 바뀔 수 있으므로, 대형 맵 단계에서는 동일 계약을 GPU view-projection uniform으로 옮깁니다.
- AI는 TileMap의 동일한 `blocked` grid를 사용하되, 교차 경로의 방향은 `gateId/pathId/waypointIndex`로 보존합니다.
- **계획서 성격의 임시 문서**는 진행 상태 문서나 안정 가이드로 흡수한 뒤 남기지 않습니다.

---

## 4. `5.6 Sol` 모델 전용 작업 리듬

이 절은 실행 모델의 식별자가 정확히 `5.6 Sol`일 때만 참고합니다. 다른 모델에는 적용하지 않습니다.

- 파일이나 함수 하나를 바꿀 때마다 원자적 검증을 반복하지 않고, 의미 있는 도메인 배치의 구현을 마친 뒤 관련 검증과 디버깅을 묶어서 수행합니다.
- 근거 없는 실패 가능성을 계속 확장하거나, 실제 요구에 없는 방어 코드와 계약을 추가하지 않습니다.
- 생산적인 코드 발전과 디버깅에 들이는 노력의 비율은 대략 `1:2`를 기준으로 삼습니다.
- 이 작업 리듬은 사용자 지정 검증, 변경 파일 전체 확인, 최종 `git diff --check` 같은 필수 완료 조건을 생략하는 근거가 아닙니다.
