# Module Architecture Guide

## 1. 시스템 개요

| 모듈 | 책임 | 세부 문서 |
| --- | --- | --- |
| `main.js` | App 진입점, rAF 루프, 고정 스텝 accumulator, 창 비활성 정책 연결 | [`core_architecture_guide.md`](./core_architecture_guide.md) |
| `system_handler.js` | 시스템 생성, 초기화, update/draw 순서, pause policy 병합 | [`core_architecture_guide.md`](./core_architecture_guide.md) |
| `animation/` | 표준/지속/혼합 애니메이션, 고정/가변 tick 분리 | [`ui_overlay_guide.md`](./ui_overlay_guide.md) |
| `display/` | 정적 레이어, 동적 surface, 2D/WebGL 렌더 명령, 테마 반영 | [`reference/render_command_guide.md`](./reference/render_command_guide.md) |
| `input/` | 마우스/키보드 상태, 포커스 레이어, 단발성 클릭 소비, debug mode 가운데 클릭 제스처 | - |
| `debug/` | 프레임타임·풀·히트박스 표시 제어, DevTools 수동 실행, 애니메이션 정지·1프레임 진행 | [`core_architecture_guide.md`](./core_architecture_guide.md) |
| `object/` | 적 풀과 ID, fixed update, AI 문맥, flow-field backend 선택, 충돌 호출, 합체 오케스트레이션, 렌더 보간 | [`domain/enemy_ai_guide.md`](./domain/enemy_ai_guide.md), [`domain/hexa_hive_enemy_guide.md`](./domain/hexa_hive_enemy_guide.md) |
| `physics/` | spatial grid broad phase, SoA 버퍼, narrow phase, pair budget/solve, projectile sweep, 계측 | [`domain/collision_pipeline_guide.md`](./domain/collision_pipeline_guide.md) |
| `scene/` | 활성 씬 보관, title/play/benchmark 전환, simulation command 적용 | [`reference/scene_lifecycle_guide.md`](./reference/scene_lifecycle_guide.md), [`domain/game_scene_simulation_guide.md`](./domain/game_scene_simulation_guide.md) |
| `simulation/` | 메인 스레드 로컬 런타임 스냅샷과 프레임 경계 명령 큐 | [`domain/game_scene_simulation_guide.md`](./domain/game_scene_simulation_guide.md) |
| `overlay/` | 동적 surface 기반 오버레이 세션, glass blur, 패널 효과 | [`ui_overlay_guide.md`](./ui_overlay_guide.md) |
| `ui/` | UI 요소 팩토리, UI 풀, LayoutHandler, 다국어 | [`ui_overlay_guide.md`](./ui_overlay_guide.md) |
| `save/` | NW.js `fs.promises` 기반 설정/진행도/인게임 저장 | - |
| `sound/` | BGM, 볼륨, 사용자 인터랙션 후 AudioContext 잠금 해제 | - |
| `data/` | 정적 상수와 테마 데이터 | [`reference/data_theme_guide.md`](./reference/data_theme_guide.md) |

## 2. 오브젝트 풀 원칙

- 적, 투사체, UI 요소, 애니메이션은 가능한 풀에서 가져오고 `release()` 계열 메서드로 반환합니다.
- 배열 제거는 hot path에서 `filter()`보다 swap-and-pop 또는 compaction 패턴을 우선합니다.
- 씬 전환 시 풀 반환과 애니메이션 제거는 `destroy()`에서 처리합니다.
- `ObjectPool`은 `maxRetained`로 유휴 객체 최고점을 제한할 수 있으며, `liveCount`/`inUseCount`/`discardedCount`를 누적 생성 수와 분리해 관리합니다. 적 풀은 타입별 상한을 적용합니다.
- 적은 풀 반납 시 한 번 reset하고 `__poolResetReady`를 표시합니다. 재획득 직후 `init()`은 이미 정리된 인스턴스를 중복 reset하지 않되, 새 ID의 collision sleep/previous-position/cache 상태를 반드시 초기화합니다.
- 충돌 핸들러는 grid용 broad SoA와 enemy-enemy relation SoA fast path를 함께 유지하므로 위치 보정 시 body와 SoA 버퍼를 같이 갱신합니다.

## 3. 렌더 레이어

캔버스 레이어 순서는 아래에서 위로 쌓입니다.

```text
background(WebGL)
→ object(WebGL)
→ effect(WebGL)
→ texteffect(2D)
→ ui(2D)
→ vignette(2D)
→ 동적 오버레이 surface(host)
→ top(2D)
```

- `background`, `object`, `effect`는 WebGL 경로를 사용합니다.
- `texteffect`, `ui`, `vignette`, `top`은 네이티브 해상도 2D Canvas 경로를 사용합니다.
- 오버레이는 dim/effect/ui 동적 surface를 별도로 점유합니다.
- 동적 surface는 정적 surface 뒤, `top` 앞에 정렬됩니다. CSS 기준으로 overlay host는 vignette보다 위에 있습니다.
- display surface는 frame draw 수, empty 상태, content revision을 기록합니다. Glass backdrop 합성은 정렬 캐시와 이 메타데이터를 사용해 빈 surface를 제외합니다.
- DisplaySystem이 소유한 WebGL 레이어 renderer는 context restore 시 프로그램, 버퍼, 텍스처/FBO를 다시 생성합니다. 같은 context에 scene이 별도로 만든 GPU 자원은 해당 소유자가 복구해야 합니다.
- 동일 shape/style의 합체 적 셀은 `renderGLShapeInstances()`가 한 번의 texture/color/회전 준비 후 기존 batch typed vertex buffer에 연속 기록합니다.
- WebGL batch의 `begin()`은 프레임 크기와 CPU 큐만 초기화합니다. 실제 `flush()`가 draw 직전에 framebuffer, blend, program, buffer와 attribute 상태를 다시 바인딩하므로, 같은 context를 쓰는 외부 pass가 중간 상태를 바꿔도 batch 제출은 자체 상태를 복구합니다.
- 비지속 2D 레이어의 프레임 clear 순서는 `context 상태 reset → fresh 스타일 캐시 교체 → clearRect → transform 복원 → onFrameClear`입니다. fresh 캐시는 진행 중 `render()`에서 clear가 재진입해도 이전 render의 후속 캐시 쓰기를 다음 프레임 캐시와 격리하므로 scratch 객체나 `undefined`/`delete` 초기화로 재사용하지 않습니다.
- persistent 2D 레이어는 위 프레임 clear 경로를 건너뛰며, `clearAll()`은 등록 Map의 live iteration 순서와 첫 예외에서 즉시 중단하는 계약을 유지합니다.
- 마우스 좌표 변환 핫패스는 `getCanvasOffsetX()`/`getCanvasOffsetY()`로 CSS 오프셋 원시값을 읽습니다. 기존 `getCanvasOffset()`은 매 호출 새 `{x, y}`를 반환하는 공개 계약으로 유지하며, 입력 경로는 X/Y 원시값을 모두 읽은 뒤 숫자로 변환해 getter 평가 순서를 보존합니다.
- 렌더 명령 규격은 [`reference/render_command_guide.md`](./reference/render_command_guide.md)를 확인합니다.

## 4. fixed step과 보간 책임

- AI, 물리, 충돌, 상태 타이머는 `fixedUpdate()`에서 처리합니다.
- 화면 표시용 보간은 가변 프레임 `update()`에서 처리합니다.
- `draw()`는 보간된 렌더 좌표를 사용해야 합니다.
- 고정 스텝 상세 흐름은 [`core_architecture_guide.md`](./core_architecture_guide.md)를 확인합니다.

### 4.1 Enemy AI flow-field 가속 경계

- `_enemy_ai_navigation.js`는 cache와 기존 JS 기준 알고리즘을 소유합니다.
- `wasm/_enemy_ai_flow_field_backend.js`는 grid 크기·capability·실패 상태에 따라 WASM 또는 JS를 선택하는 책임만 가집니다.
- `wasm/_enemy_ai_flow_field_wasm_runtime.js`는 linear-memory ABI, 입력 복사, export 호출과 결과 복사를 소유합니다.
- `_enemy_ai_flow_field.wat`는 순수 grid 입력에서 integration/direction field만 계산하며 게임 객체나 렌더 상태를 알지 못합니다.
- backend 전환은 cache miss 경계에서만 일어나므로 이미 캐시된 결과와 적별 steering 순서를 바꾸지 않습니다.

## 5. 저장 데이터 계약

- `ProgressHandler`는 기본 128바이트 `Uint8Array`를 사용합니다. `getData()`는 live 참조이고 자동 저장하지 않으며, `init()`과 `setData()`가 새 배열로 교체하면 이전 참조는 stale 상태가 됩니다.
- 진행도 입력은 현재 realm의 `Uint8Array`, 일반 배열 또는 식별 가능한 Buffer만 복제·정규화합니다. 다른 realm의 일반 typed array와 미지원 값은 기본 데이터로 대체합니다.
- `IngameHandler`는 로드한 JSON에서 값이 `undefined`인 기본 최상위 키만 보완합니다. 중첩 병합은 하지 않고 기존 `null`·`false`·`0`과 알 수 없는 키를 보존하며, `getData()`/`getValue()`의 객체·배열은 live 참조입니다.
- 저장 setter와 live 참조 변경은 자동 저장하지 않습니다. 파일 반영은 해당 `save()` 또는 `SaveSystem.saveAll()` 경계에서 수행합니다.
- `pathExists()`는 모든 `fsPromises.access()` 실패를 `false`로 축약하고, `ensureSaveDirectory()`는 접근 가능한 경로의 디렉터리 타입을 확인하지 않습니다. `cloneJsonData()`는 JSON stringify/parse 왕복의 손실 변환과 예외를 그대로 따릅니다.
- 저장 로직을 변경할 때는 `save_handler_jsdoc_contract.test.mjs`의 파일 오류, live/stale 참조, 길이·realm, JSON root·직렬화 edge case를 먼저 갱신하고 새 persistence 계약을 명시합니다.

## 6. 현재 주의할 특수 영역

| 영역 | 기준 문서 |
| --- | --- |
| 적 AI/pathfinding 정책 | [`domain/enemy_ai_guide.md`](./domain/enemy_ai_guide.md) |
| 육각형 합체 적 | [`domain/hexa_hive_enemy_guide.md`](./domain/hexa_hive_enemy_guide.md) |
| 게임 씬/시뮬레이션 명령 | [`domain/game_scene_simulation_guide.md`](./domain/game_scene_simulation_guide.md) |
| 충돌 파이프라인 | [`domain/collision_pipeline_guide.md`](./domain/collision_pipeline_guide.md) |
| 오버레이 패널 계약 | [`reference/overlay_contract_guide.md`](./reference/overlay_contract_guide.md) |
