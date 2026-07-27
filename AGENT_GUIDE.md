# CirVivor AI Agent Guide

> **기준 코드**: 0.51 native title overlay breadth + title→playable slice | **전환 상태**: NW.js read-only oracle + Windows C++20/SDL3 rewrite 병행 | **렌더링**: Canvas 2D + WebGL oracle, SDL_GPU/GLES/Software native 경로 병행
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
| SDL3 Desktop/Android/iOS 포트, CMake, native core/render/platform | [`native_port/README.md`](C:/CirVivor/guide/native_port/README.md), [`sdl3_desktop_android_ios_porting_plan.md`](C:/CirVivor/guide/sdl3_desktop_android_ios_porting_plan.md), [`sdl_progess.md`](C:/CirVivor/sdl_progess.md) |
| GitHub Desktop, 게임 실행, 성능 벤치마크 Windows 조작 | [`computer-use-guide.md`](C:/CirVivor/guide/computer-use-guide.md) |
| 에이전트 실수 방지 체크 | [`agent_pitfalls_guide.md`](C:/CirVivor/guide/agent_pitfalls_guide.md) |

---

## 3. 빠른 판단 기준

- **게임 로직/물리/AI**는 fixed step 기준으로 판단합니다.
- **UI/오버레이/렌더링**은 가변 프레임과 표시 좌표계를 기준으로 판단합니다.
- native 포트는 Windows Desktop을 대상으로 독립 실행되는 C++20 rewrite입니다. Android와 iOS는 현재 범위에서 제외합니다. `project/`의 JavaScript/NW.js는 관찰 가능한 화면·입력·상태와 fixture를 얻는 read-only oracle일 뿐이며, native 제품에 JavaScript engine/interpreter를 넣거나 Promise·microtask·부동소수점 같은 ECMAScript 런타임 세부 동작을 에뮬레이션하지 않습니다. C++ 내부 구조와 실행 순서를 JS에 원자적으로 맞출 필요는 없습니다.
- SDL3 전환 중에는 기존 `project/` 경로를 parity oracle로 보존합니다. `native/src/core/`와 `native/src/engine/`에는 SDL 헤더·handle·OS 경로 타입을 넣지 않고, 플랫폼 경계는 `native/src/platform/`, application 조립은 `native/src/app/`에 둡니다.
- native authoritative 물리는 `native/src/core/physics/BodySoA`의 setup-time 고정 capacity와 `double` 배열을 사용합니다. fixed tick에서 배열 성장과 heap allocation을 금지하고, JS `Math.exp` parity가 필요한 적분에는 플랫폼 CRT 대신 `native/src/core/math/deterministic_math.*`의 V8/fdlibm 호환 함수를 사용합니다.
- native `FlowFieldScalar`와 `PreparedContactScalar`는 production WAT의 scalar reference이며 생성 시 scratch capacity를 고정하고 caller span만 사용합니다. prepared-contact boolean은 범용 spatial grid·position solve·projectile 이식 완료를 뜻하지 않습니다.
- legacy 일반 충돌 parity는 `legacy_collision_projectile_baseline_v1.json`의 실제 `ObjectSystem.fixedUpdate()` 60틱 순서와 raw f32/f64 plane을 기준으로 합니다. `CollisionHandler.setDeterministicOracleTraceSink()`는 fixture 전용 opt-in seam이므로 제품 경로에서 활성화하거나 production 정책 API로 승격하지 않습니다.
- native 세션 조립은 `native/src/game/GameSystem`이 의미 입력을 Tower intent로 바꾸고 60Hz BodySoA·타일 충돌을 실행한 뒤 Core/Tower canonical snapshot을 만듭니다. 현재 480-tick JS replay 범위를 넘어 RNG·투사체·일반 contact/event가 구현된 것으로 가정하지 않습니다.
- native 제품 실행은 `Application`이 기본적으로 순수 C++ title runtime과 `title_scene`을 빌드합니다. Start 카드의 MapSelect에서 단일 권위 map ID를 확인한 뒤 후보 `GameSystem`을 먼저 만들고, 성공할 때만 title 상태를 정리해 `playable_game_scene`으로 전환합니다. 실패하면 MapSelect를 유지하고 입력을 다시 열어 재시도할 수 있습니다. `--playable-scene`은 개발용 직접 진입, synthetic scene은 smoke와 `--diagnostic-scene` 전용입니다. `app_runtime`의 `MovementInputBuffer`는 물리 source alias를 합성하고 짧은 press를 첫 fixed tick까지 보존하며 focus/background 전환과 세션 전환에서 held/pending을 함께 지웁니다.
- native 타이틀 화면과 production에서 도달 가능한 기존 overlay는 JS/NW.js를 시각·입력·상태 전이 oracle로 사용합니다. 21개 `ui_visual/scenarios_v1.json` 계약은 타이틀 전환, title factory 8종, manager/global 3종과 중첩·floating 상태를 고정하며, 진입점 없는 `CollectionOverlay`는 orphan inventory로 분리합니다. 기존 제품에 없는 HUD·pause·game-over 등을 동일 포팅 완료 항목으로 가장하지 않고 별도 제품 설계로 다룹니다.
- native UI 구현은 Windows의 title→메뉴/overlay→playable→종료 전체 기능 흐름을 먼저 연결하는 breadth-first 순서를 사용한 뒤, 실행 결과를 21개 oracle 상태와 비교해 화면별 fidelity를 보완합니다. 이 순서는 임시 shell이나 placeholder를 최종 완료로 인정한다는 뜻이 아닙니다.
- native UI 상태는 `ui_runtime`의 `TitleOverlayStateMachine::advance(deltaSeconds)`가 가변 표시 시간으로 진행하며 60Hz `tick()`은 테스트 adapter일 뿐입니다. `Application`은 이를 title display frame마다 한 번 진행하고 `title_scene` presenter로 `FramePacket`을 만듭니다. 버전과 credits를 포함한 외부 URL은 warning overlay의 sequence가 있는 effect를 플랫폼에 넘긴 뒤 success/failure acknowledge를 받아야 합니다. Credits의 다섯 stable control ID는 고정 HTTPS URL로만 resolve하고 같은 overlay sequence·control ID의 pointer down/up에서 warning을 엽니다. 종료 확인은 one-shot latch 하나만 권위로 사용합니다. MapSelect의 playable effect도 overlay sequence와 강타입 map ID를 사용하며 실패 acknowledge에서 interaction lock을 해제합니다. 레이아웃은 논리 safe-area inset을 먼저 제외하고 light/dark 토큰과 타이틀 entrance/overlay geometry를 계산합니다. `TitleOverlayPresentationSet`은 상태·레이아웃 revision에 결합된 fixed-capacity DTO이며 `Application`이 한 번 구성해 controller hit-test와 `title_scene` 렌더에 함께 전달합니다. 11종 overlay 본문과 공통 Close/Cancel, Map preview는 렌더되지만 Settings Save/control과 Debug 진입 gesture/toggle은 다음 기능 배치까지 의도적으로 passive이며 logo·utility icon·GPU glyph/effect와 세부 시각 fidelity도 남아 있습니다.
- native UI 입력 경계는 `PlatformEvent`의 SDL 비의존 mouse/touch/cancel/wheel/고정 UTF-8·IME payload를 사용합니다. `SDL_EVENT_WINDOW_CLOSE_REQUESTED`는 `windowCloseRequested`로 번역하며 title 모드에서는 exit-confirm overlay가 소비합니다. 개발용 playable/diagnostic 모드만 기존 즉시 종료 fallback을 유지합니다.
- native renderer는 한 SDL window에 여러 그래픽 API 자원을 동시에 붙이지 않습니다. `Application`의 Router factory가 후보마다 숨김 창을 재생성하며, `neutral → SDL_GPU`, `SDL_WINDOW_OPENGL + 사전 GL attributes → GLES ES3/ES2`, `neutral → Software` 순서로 하나의 backend만 소유하게 합니다. 종료는 backend를 먼저 내린 뒤 window를 파괴합니다.
- SDL dependency는 `native/third_party/manifest.lock`과 `native/cmake/Dependencies.cmake`의 version·tag·commit·archive hash를 함께 고정합니다. 임의의 system SDL이나 floating branch로 대체하지 않습니다.
- native text stack은 `native/cmake/TextDependencies.cmake`가 고정한 Brotli 1.2.0 → FreeType 2.14.3(WOFF2) → HarfBuzz 14.2.1(hb-ft) 정적 그래프와 `native/src/render/text/FontFace` Pimpl 경계를 사용합니다. 원본 `PretendardVariable.woff2`와 OFL은 `TextAssets.cmake`에서 SHA-256을 확인해 무변환 복사하고 Desktop 실행 파일 옆 `runtime_assets`에 배치하며, third-party 타입을 public render/core 계약에 노출하지 않습니다. `FontFace`는 variable weight·no-hinting grayscale raster를 제공하고, `GlyphAtlas`는 font source fingerprint+glyph+pixel size+weight key의 고정-capacity 1-channel atlas를 초기화 단계에서 채웁니다. `ShapedTextCache`는 고정 UI 문자열의 shape 결과와 64px A8 atlas를 하나의 immutable generation snapshot으로 만들며 `RenderResourcesView`는 동기 `render()` 호출 동안만 빌려 줍니다. Pretendard에 없는 U+1F3C6/U+1F4D6은 시스템 font fallback이 아니라 고정 trophy/book asset 대상으로 취급합니다.
- native `FramePacket` schema v2는 기존 kind 0~6과 capacity prefix를 보존하면서 glyph run, projective textured mesh, gradient, clip stack, offscreen pass 명령과 부속 고정 용량 저장소를 소유합니다. codec은 little-endian canonical v2만 decode하고 v1 fixture는 migration 기준으로만 보존합니다. Software backend는 gradient·clip과 resource-backed A8 glyph run을 실제 raster하며 누락/잘못된 glyph resource를 프레임 실패로 보고합니다. SDL_GPU/GLES의 glyph atlas와 고급 명령, Software의 textured mesh/pass는 아직 placeholder이므로 production UI의 `placeholderCommands`가 0이 되기 전에는 타이틀·오버레이 렌더 완료로 판정하지 않습니다. 현재 title은 glyph-atlas capability gate 때문에 auto 선택에서 Software로 내려갑니다.
- native simulation 또는 render 계약을 변경한 작업은 종료 전에 `sdl_progess.md`를 실제 완료 범위와 검증 결과에 맞게 갱신합니다.
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
