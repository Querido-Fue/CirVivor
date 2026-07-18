# Simulation Worker, WASM, Native Acceleration Guide

> 목적: 800개 이상 적의 fixed simulation을 확장할 때 Web Worker, WebAssembly, 멀티코어, C++을 어떤 순서와 계약으로 도입할지 정의합니다. 현재 JS 구현은 800명·실시간 blur에서 게임 rAF 60 FPS 이상과 실제 fixed 60 tick/s를 함께 통과한 기준 구현입니다.

## 0. 현재 결정과 측정 상태

2026-07-13 release profiler는 기존 compositor 수치와 실제 게임 처리율을 분리했다. `576953e` 기준 활성 적 815개는 게임 rAF/fixed가 약 44/44였고 fixed CPU p95가 약 23.3ms여서 실제 simulation gate에 실패했다. 내장 구간 profiler에서는 collision이 fixed object 시간의 약 89%를 차지했다.

`59d253c`는 candidate sweep AABB·center·relation radius·pad를 body당 한 번 Float64 SoA로 기록하고 enemy prefix raw 후보 루프에서 직접 비교한다. clean run의 활성 적 824개에서 rAF 119 FPS/fixed 60.0 tick/s, 10초 뒤 활성 적 811개에서 rAF 109 FPS/fixed 60.0 tick/s, fixed CPU p50/p95/p99 13.2/14.7/15.4ms, debt 0, lost 0을 확인했다. `ExitOverlay`의 `blurUpdateMode: 'always'`를 유지한 채 3.5초 간격으로 적 배치와 활성 수 766→765가 바뀌어 실시간 backdrop 갱신도 확인했다.

따라서 현재 결론은 다음과 같다.

- 800개 이상 적과 실시간 blur에서 **게임 rAF 60 FPS + actual fixed 60 tick/s gate를 통과**했다.
- 10초 profiler window의 fixed p99 15.4ms와 debt/lost 0은 통과했지만, 더 긴 soak와 1200명·projectile burst·stacked overlay matrix는 별도로 측정합니다.
- 현재 목표를 JS SoA fast path가 달성했으므로 게임 전체 C++ 재작성과 Worker/fixed-simulation authority 이전은 즉시 진행하지 않습니다. 다만 독립적인 순수 precompute인 Enemy AI flow field는 2026-07-19부터 cache miss에 한정해 single-thread WASM을 사용합니다. 전체 authority 승격은 deterministic replay와 canonical SoA 경계를 먼저 준비하고 1200명 이상 확장이나 새 콘텐츠로 gate가 다시 실패할 때 shadow JS Worker와 shadow WASM/SIMD를 비교합니다.
- 멀티코어는 single-thread Worker/WASM의 전송·authority·정합성 gate를 통과한 뒤, deterministic reduction과 SAB/thread capability가 실제 패키지에서 확인될 때만 승격한다.
- C++의 최대 범위도 우선 fixed simulation core다. Chromium/WebGL 기반 렌더, UI, overlay와 실시간 blur는 메인/GPU에 유지한다.

### 0.1 현재 채택된 Enemy AI flow-field WASM

이 커널은 fixed simulation authority 이전이 아니라, 기존 bounded LRU flow-field cache의 miss를 계산하는 순수 함수 경계입니다.

- 기준 구현: `_enemy_ai_navigation.js`의 기존 indexed-heap JS `buildFlowField()`
- 선택 경계: `wasm/_enemy_ai_flow_field_backend.js`; grid가 1,024셀 이상일 때만 WASM 사용
- ABI/runtime: blocked byte plane을 linear memory에 복사하고 WAT export를 한 번 호출한 뒤 integration/direction plane을 새 typed array로 복사
- 실패 정책: capability/compile/instantiate 실패는 즉시 영구 JS 모드, 실행 trap은 현재 호출부터 JS로 복구한 뒤 영구 JS 모드. 최초 실패 단계·오류 이름·메시지는 backend 상태에 보존
- 권한 보존: cache key, LRU, LOS 판정, goal 선택, 적 상태와 steering 적용은 기존 JS가 계속 소유
- 도구체인: `wabt@1.0.39`를 lockfile로 고정하고 WAT와 저장소 byte artifact의 재현성을 `npm run check:wasm:flow-field`로 강제

같은 realm의 production JS와 비교한 64²/128²/223², open/결정적 약 20% blocked/구조적 50% blocked의 9개 시나리오에서 측정 중앙값은 모두 WASM이 빨랐고 최근 측정 범위는 1.18~1.33배입니다. 이는 cache miss 커널의 제한적 채택 근거이며, 아래 G5의 전체 fixed-simulation authority 승격을 통과했다는 뜻은 아닙니다.

실제 배포 NW.js 0.108.0/Chrome 145에서도 production backend를 두 clean process로 실행했습니다. 1,023셀은 JS, 1,024셀은 WASM으로 선택됐고, 결정적 약 20% blocked 입력의 p50은 32×32에서 2.11배, 최소 viewport 대표 80×45에서 1.95배였습니다. 첫 runtime 초기화는 두 번 모두 약 0.7ms, 첫 32×32 cache miss는 0.8~1.1ms, 첫 80×45 memory growth 포함 호출은 1.6~1.7ms였습니다. 이 역시 커널+입출력 복사 측정이며 전체 frame 향상 수치가 아닙니다.

## 1. 결론과 불변식

권장 승격 순서는 다음과 같습니다.

```text
JS 기준 구현과 replay 고정
→ canonical SoA 경계
→ shadow JS Worker와 shadow WASM/SIMD A/B
→ deadline을 만족한 단일 authoritative Worker backend
→ capability가 확인된 경우에만 WASM threads
→ 그래도 목표 미달이면 Node Worker + Node-API C++
→ 최후에 fixed simulation core 전체 C++
```

항상 지켜야 할 불변식:

- `DisplaySystem`, Canvas 2D, WebGL, UI, overlay, 입력, 저장, 오디오는 메인 Chromium이 소유합니다.
- `blurUpdateMode: 'always'` 실시간 blur와 overlay composite는 메인/GPU에 남깁니다.
- 메인 스레드는 Worker/native 완료를 `Atomics.wait`, busy loop, 동기 join으로 기다리지 않습니다.
- 표시 FPS와 실제 fixed tick/s를 별도 지표로 판단합니다. debt를 버려 표시 FPS만 회복한 상태를 simulation 목표 통과로 선언하지 않습니다.
- 적 객체 그래프를 tick마다 structured clone/JSON으로 보내지 않습니다.
- authoritative fixed-simulation backend는 fixed tick 도중 조용히 전환하거나 두 backend가 동시에 authority를 갖지 않습니다. 비권한 pure precompute인 flow field는 실패한 cache miss만 JS로 즉시 재계산할 수 있습니다.
- C++로 옮겨도 알고리즘의 O(N²) 경로는 사라지지 않습니다. 먼저 JS에서 작업량 상한과 데이터 경계를 해결합니다.

## 2. 현재 구조

```text
App accumulator
→ TimeHandler fixed
→ AnimationSystem fixed
→ ObjectSystem AI/movement/contact/collision/projectile/lifecycle
→ SceneSystem.fixedUpdate
→ GameManager.fixedUpdate
→ variable update와 보간
→ main Canvas/WebGL draw
→ overlay composite와 always blur
```

- fixed 순서의 중심은 `SystemHandler.#runFixedStep()`과 `ObjectSystem.fixedUpdate()`이지만, Animation/Scene/GameManager hook도 같은 tick에 참여합니다. Worker 이전 전 각 hook을 presentation-only와 simulation-owned 상태로 분류하는 audit가 필수입니다.
- `SimulationRuntime`은 현재 메인 스레드용 viewport/input/settings 복제본이며 Worker authority 계층이 아닙니다.
- `SimulationCommandQueue`는 같은 렌더 프레임 말미에 메인 씬이 직접 적용합니다.
- 충돌의 typed array는 좋은 출발점이지만 `BROAD_STRIDE=14`, `RELATION_BROAD_STRIDE=8`은 record가 연속된 packed layout입니다. Worker/WASM ABI용 canonical SoA는 축별 plane으로 분리합니다.
- 배포 런타임은 NW.js 0.108.0 win-x64이며 내부 문서 URL은 `chrome-extension:`일 수 있습니다. `file:`만 가정하거나 절대 URL을 하드코딩하지 않습니다.

## 3. 선택 행렬

| Backend | 메인 스레드 해방 | SIMD | 멀티코어 | 배포 위험 | 권장 용도 |
| --- | --- | --- | --- | --- | --- |
| JS main | 아니오 | V8 자동 | 아니오 | 최소 | 기준 구현과 fallback |
| WASM main | 아니오 | 가능 | 기본 아니오 | 낮음 | 순수 kernel A/B만 |
| Web Worker JS | 예 | V8 자동 | Worker 1코어 | 낮음 | transport와 authority 검증 |
| Web Worker + WASM | 예 | 예 | 기본 1코어 | 낮음~중간 | 기본 가속 후보 |
| WASM threads | 예 | 예 | 예 | SAB/origin/toolchain 높음 | capability gate 통과 시 |
| Node Worker + Node-API C++ | 예 | native | 내부 병렬화 가능 | NW ABI/배포 높음 | WASM으로 목표 미달 시 |
| main-thread C++ addon | 아니오 | native | join 위험 | 높음 | 채택 금지 |

## 4. 결정 게이트

| Gate | 통과 조건 | 실패 시 |
| --- | --- | --- |
| G0 관측성/병목 | release profiler로 실제 fixed tick/s, dropped debt, sim p95/p99를 얻고, 후보 kernel이 frame CPU의 25% 이상 또는 p95 4.17ms 이상 | 통과: collision이 약 89%였으나 JS SoA 최적화로 현재 800명 gate 달성, native 승격은 보류 |
| G1 순수성 | DOM/display/input/save/NW 객체 없이 scalar+typed array만으로 같은 결과 | 경계 재설계 |
| G2 전송 | main pack→queue→worker view/JS↔WASM copy→output return까지 end-to-end p95 0.75ms 이하이자 sim p95의 10% 이하, hot path 신규 ArrayBuffer/JSON 0 | SoA ownership/버퍼 pool 개선 |
| G3 정합성 | JS replay와 명령·ID/generation·lifecycle event가 같고 사전에 고정한 float 허용오차·누적 drift 한도 통과 | authority 이전 금지 |
| G4 Worker | 메인이 기다리지 않고 sim p99 16.67ms 이하, `requested-completed≤2`, snapshot age p99≤1 tick, command ack≤2 ticks, 5분 무단 tick drop 0 | clock/backpressure 또는 backend 최적화 |
| G5 WASM | kernel p95 1.3배 이상, 전체 fixed p95 15% 이상 개선, 400명 회귀 5% 이하 | JS Worker 유지 |
| G6 멀티코어 | SAB/thread probe와 결정적 reduction 통과, 전체 fixed p95 20% 추가 개선 | single-thread WASM 유지 |
| G7 native | Worker+WASM으로 목표 미달, NW별 빌드/CI/서명 유지비 승인 | native 금지 |
| G8 full C++ | tick당 JS↔native 왕복이 commands/step/snapshot 각 1회 수준이며 parity/fallback 완료 | 부분 core에서 중단 |

권장 장기 예산은 simulation p95 8.33ms 이하, p99 12ms 이하, 실제 fixed 처리율 60 tick/s, 전체 frame p95 16.67ms 이하입니다. 현재 800명 측정은 실제 fixed 60 tick/s와 frame/fixed 16.67ms 이내를 통과했지만 fixed p95/p99는 14.7/15.4ms로 장기 여유 목표보다 높습니다. native 승격보다 JS 회귀 방지와 원형 pair fused kernel 같은 후속 여유 확보를 우선합니다.

G5는 fixed simulation 전체 또는 authoritative Worker backend 승격 기준입니다. cache miss의 독립 pure precompute는 `원시 바이트 exact parity + 실제 배포 NW.js 검증 + 측정한 모든 대표 시나리오에서 비열세 + 즉시 JS fallback`을 별도 로컬 gate로 사용합니다.

## 5. 단계별 도입

### 5.1 Capability와 replay 고정

- `process.versions.nw/node/chromium`, platform/arch, Web Worker, WASM, SIMD, `SharedArrayBuffer`, `crossOriginIsolated`, shared `WebAssembly.Memory`를 실제 패키지에서 기록합니다.
- `hardwareConcurrency`만 보고 thread backend를 선택하지 않습니다.
- seed, viewport, settings, command log로 10,000 fixed tick을 재생하는 JS reference를 먼저 만듭니다.
- core의 `Math.random()`을 authority가 소유하는 명시적 RNG state로 교체합니다.

### 5.2 Canonical SoA JS backend

- main에서 먼저 같은 결과를 내는 `JsMainBackend`를 만듭니다.
- identity, transform, body, AI, gameplay, aggregate parts, commands, events, render snapshot을 plane별 typed array로 나눕니다.
- 현재 객체/stride buffer와의 adapter는 이행용이며 tick마다 이중 pack하는 구조를 최종 상태로 남기지 않습니다.

### 5.3 Shadow Worker

- gameplay authority는 main에 둔 채 같은 입력을 JS Worker와 single-thread WASM Worker 후보에도 전달합니다.
- 결과 hash, tick 지연, end-to-end pack/queue/copy/return 시간을 비교합니다.
- shadow 결과는 게임 상태에 적용하지 않으므로 실패해도 플레이에 영향을 주지 않습니다.
- JS Worker가 deadline을 넘더라도 WASM shadow가 통과할 수 있으므로 JS authoritative 전환을 WASM 성능 A/B의 필수 선행 gate로 두지 않습니다.

### 5.4 Worker authority

- 부분 충돌 결과를 늦게 되돌려 쓰기보다 fixed simulation 전체 또는 독립적인 pure precompute 하나를 이전합니다.
- Time/Animation/Object/Scene/GameManager fixed hook가 만지는 상태를 audit하고, simulation animation/timer는 backend state나 command로 이전합니다. presentation-only animation만 main에 남깁니다.
- 메인은 마지막으로 완료된 두 snapshot만 읽어 보간합니다.
- Worker가 늦으면 메인은 기다리지 않고 마지막 완료 snapshot을 유지합니다.

Clock/backpressure 계약:

- 메인의 `SimulationClockController`가 wall-clock accumulator와 request 생성을 소유하고 Worker가 authoritative state와 `completedTick`을 소유합니다.
- `maxQueuedTicks=2`를 기본값으로 두고 `REQUEST_TICKS`를 coalesce합니다. Worker는 이미 승인된 tick이나 command를 조용히 버리지 않습니다.
- `requestedTick-completedTick`이 상한을 넘으면 clock controller만 debt를 drop하며, drop 수와 잃은 simulation seconds를 release stats에 기록합니다.
- Worker 이전 뒤에는 main frame CPU 비율로 Worker 포화를 판정하지 않습니다. Worker sim time, queue depth, snapshot age를 사용합니다.
- 30Hz render에서는 여유가 있을 때 한 request에 2틱을 처리할 수 있어야 합니다. pause/resume/reset은 epoch, accumulator, pending request, CPU/backlog baseline을 함께 초기화합니다.
- command `applyTick`은 coalesce와 debt drop 뒤에도 바뀌지 않으며 적용/거부 seq를 ack합니다. 목표는 snapshot age p99 1틱 이하, command ack 2틱 이하입니다.

### 5.5 WASM과 멀티코어

- 독립 precompute인 Enemy AI flow field는 cache miss 한 번당 coarse WASM 호출 하나로 먼저 채택했습니다. 셀별 JS↔WASM 호출은 금지합니다.
- fixed simulation authority를 처음 옮길 coarse kernel 후보는 여전히 `grid → candidate → narrowphase → resolve` 전체입니다. pair별 JS↔WASM 호출은 금지합니다.
- single-thread WASM/SIMD가 JS Worker보다 실제로 빠른지 먼저 A/B합니다.
- canonical SoA plane은 최종 authoritative backend가 직접 소유합니다. JS typed array와 WASM memory 사이의 tick별 pack/unpack을 최종 구조로 남기지 않습니다.
- 멀티코어는 AI intent, body/AABB 계산, grid histogram, 후보 판정을 immutable tick snapshot 기준으로 나눕니다.
- 위치 solve와 damage/lifecycle/merge commit은 처음에는 결정적 직렬 순서를 유지합니다.
- shared flow/density/policy cache는 병렬 intent 전에 immutable prepass로 만들거나 thread-local 결과를 고정 순서로 merge합니다. main/GPU driver/audio용 코어를 남기고 oversubscription을 측정합니다.

### 5.6 C++

- 같은 C++17 headless core를 Emscripten WASM과 Node-API adapter가 공유합니다.
- Node addon은 전용 Node Worker 하나가 로드하고, core는 `napi_*`, DOM, NW API를 모릅니다.
- 전면 C++의 범위는 AI/physics/projectile/lifecycle fixed simulation core입니다. 렌더/UI/blur 포팅을 뜻하지 않습니다.
- 전면 포팅은 `(현재 simulation tick-rate/p95 목표를 Worker+WASM으로도 미달) 또는 (5천~2만 개체, 120/144Hz, rollback/network, 콘솔·모바일 같은 새 목표)` 중 하나가 성립하고, native prototype의 전체-frame 이득과 유지비를 별도로 승인할 때만 진행합니다.

## 6. Backend와 메시지 계약

```text
SimulationBackend
- init(config, capacities) -> Promise<Capabilities>
- reset(worldBinary, epoch) -> Promise<Ack>
- enqueueCommandBatch(commandBuffer, epoch, applyTick)
- requestTicks(count, fixedDelta, inputSlot, epoch)
- acquireCompletedSnapshot() -> SnapshotLease|null
- releaseSnapshot(snapshotToken)
- pause(epoch) / resume(epoch)
- destroy() -> Promise<void>
- getStats() -> tick/queue/transfer/backlog/backend stats
```

구현 후보:

- `JsMainBackend`
- `JsWorkerBackend`
- `WasmWorkerBackend`
- `NativeWorkerBackend`

메시지는 `HELLO`, `INIT`, `RESET`, `COMMAND_BATCH`, `REQUEST_TICKS`, `SNAPSHOT_READY`, `PAUSE`, `RESUME`, `STOP`, `FAULT`로 제한합니다. 모든 메시지에는 `protocolMajor/minor`, `layoutHash`, `epoch`, `sequence`, `tickId`가 있어야 합니다.

- scene reset/resize/backend restart 시 `epoch`를 올리고 이전 epoch 결과를 버립니다.
- command는 `commandSeq`, `applyTick`을 가지며 Worker가 마지막 적용 seq를 ack합니다.
- snapshot lease는 `token`, `slot`, `generation`, `completedTick`, `previousTick`, `overflowFlags`, `droppedRequestCount`를 포함합니다.
- transferable은 authoritative state와 분리된 출력 slot을 최소 3개 둡니다. main이 보간용 두 snapshot을 release할 때까지 Worker가 해당 slot을 detach/overwrite하지 않습니다.
- SAB도 `OUTPUT_READY` 하나만 덮어쓰지 않고 lease/refcount 또는 reader-held generation을 피해 쓰는 triple-slot protocol을 사용합니다.
- authoritative fixed-simulation backend의 active world 중 silent fallback은 금지합니다. pause와 checkpoint reset을 거쳐 명시적으로 전환합니다. 비권한 flow-field precompute의 동일 cache miss JS 복구는 이 authority 전환에 해당하지 않습니다.

## 7. Binary ABI

버퍼는 little-endian, 64-byte 정렬을 사용합니다.

```text
magic='CVSM'
abiMajor:u16, abiMinor:u16, layoutHash:u32
byteLength:u32, flags:u32, status:i32
epoch:u32, sequence:u32, requestedTick:u32, completedTick:u32
entityCount:u32, entityCapacity:u32
partCount:u32, partCapacity:u32
commandCount:u32, eventCount:u32
planeCount:u32, planeOffsets[planeCount]:u32
```

- ABI major 또는 `layoutHash` 불일치는 즉시 거부합니다.
- offset, length, alignment, detached buffer, capacity overflow를 JS와 native 양쪽에서 검증합니다.
- raw C++ pointer를 JS에 노출하지 않고 `uint32` handle/offset만 사용합니다.
- authoritative fixed-simulation backend는 active scene 중 WASM memory grow와 SoA capacity grow를 금지합니다. 초과는 명시적 `CAPACITY_EXCEEDED`로 처리하고 epoch 경계에서 재할당합니다.
- 비권한 flow-field scratch memory는 cache miss에서 필요한 크기까지 grow할 수 있습니다. 결과를 별도 typed array로 복사하므로 이전 cache entry는 분리되며, small→large→small 재호출과 이전 결과 불변성을 회귀 테스트로 고정합니다.

공용 C++ core ABI는 native pointer/span을 사용하고, WASM export adapter만 linear-memory offset을 사용합니다. `size_t` 폭과 64-byte base alignment는 각 adapter가 검증합니다.

권장 native core ABI:

```c
typedef struct {
    void* base;
    uint64_t byte_length;
} CvByteSpan;

uint32_t cv_sim_abi_version(void);
uint32_t cv_sim_layout_hash(void);
uint64_t cv_sim_required_bytes(const CvSimCapacities* caps);
int32_t  cv_sim_create(CvByteSpan memory, const CvSimConfig* config,
                       uint32_t* out_handle);
int32_t  cv_sim_reset(uint32_t handle, CvByteSpan input);
int32_t  cv_sim_step(uint32_t handle, CvByteSpan input, CvByteSpan output);
void     cv_sim_destroy(uint32_t handle);
```

WASM adapter export:

```c
uint32_t cv_sim_abi_version(void);
uint32_t cv_sim_layout_hash(void);
uint32_t cv_wasm_sim_required_bytes(uint32_t capacities_offset);
int32_t  cv_wasm_sim_create(uint32_t memory_offset, uint32_t memory_bytes,
                            uint32_t config_offset, uint32_t out_handle_offset);
int32_t  cv_wasm_sim_reset(uint32_t handle, uint32_t input_header_offset);
int32_t  cv_wasm_sim_step(uint32_t handle, uint32_t input_header_offset,
                          uint32_t output_header_offset);
void     cv_sim_destroy(uint32_t handle);
```

JS에는 native pointer를 노출하지 않습니다. Node-API adapter는 ArrayBuffer backing store를 `CvByteSpan`으로 매핑하고, WASM adapter는 명시된 memory base 상대 offset만 core pointer로 변환합니다.

## 8. SoA 레이아웃

| 그룹 | 주요 plane | 계약 |
| --- | --- | --- |
| identity | `id:u32`, `generation:u16`, `type:u16`, `flags:u32` | `(id,generation)`이 presentation key |
| kinematics | `pos/prev/vel/acc X,Y`, rotation | authoritative 계산은 f64 우선 |
| body | radius/boundRadius/weight, kind/shape | hot scalar plane 분리 |
| broad/relation | AABB/sweep/center/relation radius | 현재 stride 의미를 plane으로 이전 |
| AI | policy/decisionGroup/targetSlot/dir/timer/cache | tick-start input과 intent output 분리 |
| gameplay | hp/atk/status/timer/cooldown | hot/cold 분리 |
| aggregate | `partStart`, `partCount`, packed part X/Y/radius | hexa part가 객체 pointer를 갖지 않음 |
| scratch | candidate low/high, priority pair, counts | chunk-local 후 고정 순서 merge |
| commands/events | type/seq/entity/payload offset | variable object 금지 |
| render snapshot | id/gen/type/flags + prev/current transform/visual | 메인은 이 view만 읽음 |

## 9. 결정적 병렬 스케줄

```text
immutable tick snapshot
→ slot range별 AI intent
→ slot/ID 오름차순 movement commit
→ chunk별 body/AABB/grid count
→ prefix와 고정 chunk 순서로 grid/pair merge
→ chunk-local narrowphase 판정
→ (pass, frame/admission epoch, admission ordinal, priority, low, high) 의미 보존 키 merge
→ 직렬 position/damage/lifecycle/merge commit
→ render snapshot pack과 publish
```

같은 body를 여러 pair가 동시에 이동시키면 data race와 순서 차이가 생깁니다. position solve를 병렬화하려면 별도 graph coloring/independent-set gate가 필요합니다. 현재 frame-token/scan-epoch 기반 후보 공정성과 pass budget 의미도 정렬 키에 보존합니다. `-ffast-math`를 사용하지 않고, replay는 discrete exact hash와 quantized float hash를 함께 검사합니다.

## 10. Transport

- SAB가 검증되지 않으면 authoritative state와 분리된 3개 이상의 transferable output `ArrayBuffer` pool로 시작합니다.
- 전송 시 detach되므로 snapshot lease/release로 반환 buffer를 재사용하고, main이 보간 중인 두 generation은 writer가 건드리지 않습니다.
- SAB를 쓸 때 control block만 `Int32Array` Atomics로 관리하고 float plane은 ownership 전환 전 비원자적으로 씁니다.
- `IDLE`, `INPUT_READY`, `RUNNING`, `OUTPUT_READY`, `FAULT`, `STOP` 상태와 epoch/sequence를 명시합니다.
- 메인에서 `Atomics.wait`는 금지합니다.

## 11. NW.js 빌드와 로딩

- Chromium Web Worker는 `new URL('./worker/entry.js', import.meta.url)` 패키지 상대 경로와 browser ESM bootstrap을 사용합니다.
- Node `worker_threads`/native backend는 `window.require('node:worker_threads')` bridge, filesystem entry path, Node ESM/CommonJS resolver를 별도 bootstrap adapter로 둡니다. 두 context 사이에서는 `instanceof`를 신뢰하지 않고 primitive, ArrayBuffer, `ArrayBuffer.isView`로 검증합니다.
- local protocol/MIME 때문에 `WebAssembly.instantiateStreaming()`만 의존하지 않습니다. main에서 byte를 읽어 `WebAssembly.compile()`한 모듈 또는 검증된 bytes를 Worker로 전달합니다.
- single-thread와 threads WASM artifact, JS glue, pthread helper를 분리하고 `locateFile`로 local `chrome-extension:`/`file:`의 `.wasm`과 worker helper를 모두 해석합니다. 실제 pthread pool 생성→첫 job→shutdown smoke test까지 capability gate에 포함합니다.
- native addon은 NW.js 0.108.0/win-x64 target과 headers/toolchain(`nw-gyp` 필요 여부 포함)을 pin한 artifact manifest로 빌드하고 Node-API/context-aware cleanup 계약을 지킵니다. NW 업그레이드 때 addon rebuild와 ABI handshake를 CI가 강제합니다.
- 전체 simulation/Worker backend의 compile과 capability probe는 `SystemHandler.init()` warmup 또는 title idle에서 끝내 첫 적 spawn 중 compile stutter를 만들지 않습니다.
- 현재 flow-field backend는 모듈 초기화 때 byte artifact를 동기 compile/instantiate합니다. Node v22의 분리 측정에서는 compile 약 0.223ms, instance 약 0.01ms였고, 실제 배포 NW.js 두 clean process의 compile+instantiate runtime 초기화는 모두 약 0.7ms였습니다. 실패하면 원인을 기록하고 영구 JS backend로 고정됩니다.

## 12. 검증 기준

정합성:

- 일반/과밀/hexa merge/projectile/pause-resize를 포함한 10,000 tick replay
- command 순서, spawn/despawn ID+generation, hit/death/merge event, active count exact
- float gate는 authority 이전 전에 필드별 기준을 고정합니다. 기본 제안은 f64 position/velocity checkpoint 최대 절대오차 `1e-6`, quantized hash scale `1e6`, 10,000 tick 누적 drift `1e-5` 이하이며 backend에 맞춰 임의 확대하지 않습니다.
- NaN/Inf/OOB/capacity overflow 0
- Worker 수 1/2/4에서 같은 replay hash

현재 flow-field 커널의 별도 exact gate:

- 1×1~3×3 모든 폭·높이 조합의 모든 blocked mask×모든 goal 5,506개 원시 바이트 exact
- blocked goal, unreachable, corner cutting 금지, heap 동률/decrease-key, 단일 행·열, 축 길이 4,097, 49,601셀 대형, 결정적 무작위 밀도 exact
- invalid dimension/grid/goal/size mismatch에 대한 runtime wrapper의 명시적 reject 계약
- memory grow 뒤 재호출과 이전 반환 buffer 불변성
- 별도 stress 명령의 고정 seed 1,000건·3,824,454셀 exact와 1×1/32×32/257×193 ABI padding·guard-tail canary
- 잠금된 WABT 재빌드 artifact exact 및 `WebAssembly.validate()`
- 실제 배포 NW.js 0.108.0에서 3×3 전수 4,608개+49,601셀 1개, 총 4,609개 원시 바이트 exact
- 실제 배포 production backend의 1,023셀→JS/1,024셀→WASM dispatch와 80×45 첫 memory growth exact

성능:

- 100/400/800/1200 적, 분산/한 셀 과밀/hexa 혼합/projectile burst
- always blur on/off를 각각 측정
- frame/sim/AI/grid/pair/solve/lifecycle/pack/transfer/snapshot age/backlog의 p50/p95/p99
- 현재 60Hz gate: 800명+always blur에서 실제 fixed 60 tick/s, dropped debt 0, fixed p99 16.67ms 이하
- 장기 120Hz headroom gate: simulation p95 8.33ms 이하, p99 12ms 이하
- transport p95 0.75ms 이하, active scene allocation/WASM grow 0
- `requestedTick-completedTick≤2`, snapshot age p99≤1 tick, command ack≤2 ticks, stale epoch 적용 0
- 100/400명 회귀 5% 이하

Node flow-field microbenchmark는 `npm run benchmark:wasm:flow-field`로 실행합니다. 64²/128²/223²와 세 blocked 패턴에서 같은 realm의 production JS/WASM을 번갈아 15쌍씩 측정하고, 총 135쌍의 모든 측정에서 결과 바이트도 함께 비교합니다. 최근 p50 속도 향상은 1.18~1.33배였습니다.

NW 하네스는 32×32를 sample당 8회, 80×45를 4회 묶고 warmup 8회 뒤 31개 sample의 실행 순서를 교차합니다. 두 clean process 모두 p50 2.11배/1.95배였고, 각 warmup 결과와 각 sample의 마지막 결과도 raw byte exact를 다시 확인했습니다. 어느 수치도 전체 frame 개선으로 해석하지 않습니다.

실시간 blur 검증:

- ExitOverlay 뒤 적이 계속 이동하는지 시간 간격을 둔 두 화면으로 확인합니다.
- `frame.flush.overlayComposite`, `frame.draw.overlay`, glass panel 경로를 유지합니다.
- GPU 완료 시간은 CPU section만으로 증명하지 않으므로 실제 Frame Rendering Stats와 시각 검증을 함께 사용합니다.

## 13. 도입 중단 기준

현재 JS 경로는 release profiler에서 800명+always blur의 표시 60 FPS와 실제 fixed 60 tick/s를 모두 통과했습니다. 따라서 즉시 전면 C++ 포팅을 진행하지 않으며, 다음 두 경로 중 하나와 ROI/유지비 조건이 함께 성립할 때 다시 검토합니다.

- 현재 800명 60Hz soak에서 fixed 60 tick/s·debt 0·fixed p99 16.67ms 이내가 다시 깨지고 JS fused kernel로 회복되지 않음
- 또는 목표가 5천~2만 개체, 120/144Hz, rollback/network, 추가 플랫폼으로 확대됨
- native prototype이 kernel뿐 아니라 전체 frame에서 2배 가까운 개선을 증명
- 6~12개월 이상의 멀티플랫폼 빌드/CI/정합성 유지 비용을 승인

## 14. 관련 공식 문서

- [NW.js command-line options와 Node Worker](https://docs.nwjs.io/References/Command%20Line%20Options/)
- [NW.js JavaScript contexts](https://docs.nwjs.io/For%20Users/Advanced/JavaScript%20Contexts%20in%20NW.js/)
- [NW.js native Node modules](https://docs.nwjs.io/For%20Users/Advanced/Use%20Native%20Node%20Modules/)
- [Node.js worker_threads](https://nodejs.org/api/worker_threads.html)
- [Node.js addon과 Worker 지원](https://nodejs.org/api/addons.html)
- [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html)

## 15. 변경 체크리스트

1. contact-before-solve, projectile, merge fixed 순서를 보존했는가.
2. main과 Worker가 동시에 authority를 갱신하지 않는가.
3. Canvas/WebGL command와 presentation 객체가 Worker/native ABI를 넘지 않는가.
4. pair/lifecycle commit 순서가 결정적인가.
5. always blur와 overlay composite를 성능 때문에 dirty/비활성 모드로 바꾸지 않았는가.
6. authoritative fixed-simulation fallback이 silent mid-tick authority 전환이 아닌가.
7. ABI/layout/epoch/capacity 오류를 명시적으로 처리하는가.
8. 표시 FPS와 fixed tick/s, dropped debt를 분리해 보고하는가.
9. clock/backpressure와 snapshot lease가 queue 증가·overwrite race를 막는가.
10. Chromium Worker와 Node Worker bootstrap을 섞지 않았는가.
