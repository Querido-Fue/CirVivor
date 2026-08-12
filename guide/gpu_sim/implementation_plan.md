> **Current gameplay extension notice**
>
> GPU migration is complete. Current gameplay authority now requires Tower HP/death, multi-Tower
> share, Enemy Subject/Payload, hostile Tower targeting, and actor creation/merge transactions. Read
> `../gameplay/README.md`. Historical no-HP statements below are phase-scope records only.

# GPU 시뮬레이션 이식 계획

상태: Tower/Core/Projectile migration **Phase 5/5 COMPLETE — GPU migration COMPLETE**.
ready GameScene의 Tower physics/SDF collision/direct render, invisible Core interaction proxy,
enemy와 production Basic Bullet의 physics/contact/lifetime/death/direct render가 mixed-body
ABI v3 GPU World에 연결됐다. `CoreIntegrity`와 Tower input/camera facade는 CPU domain에
남고 unsupported session의 CPU Tower는 fallback-only다. (2026-08-08)

적용 대상: 신규 플레이 `GameScene → GameSystem → GameObjectSystem` 및 `BenchmarkScene → enemyWaveEnabled:false child GameScene`

기준 런타임: NW.js `0.108.0` / Chromium `145` / Windows

참고 구현: [`gpu_physics`](gpu_physics/README.md), [`projectile_contact`](projectile_contact/README.md), [`render_frame_interpolation`](render_frame_interpolation/README.md)

## 구현 진행 기록

현재 코드에 반영된 범위:

- Display-owned WebGPU capability probe, 투명 `gpu-object` surface, resize, device-loss generation, session port
- contact compute의 storage buffer 9개 요구를 adapter limit에서 검증하고 `requestDevice.requiredLimits.maxStorageBuffersPerShaderStage = 9`로 명시하는 platform negotiation. 기본 device limit 8에 의존하면 validation 실패
- NW.js 실런타임에서 storage/atomic/indirect compute·draw, collision/presentation/contact WGSL pipeline 검증 완료. NVIDIA Lovelace adapter limit `10`에서 device limit `9`를 요청했고 physics/body-contact/world-contact/contact-handling/fixed-control/source-resolve/tracked-pose layout은 각각 storage buffer `8/9/7/9/5/5/6`, uncaptured error는 `0`
- 명시적 body ABI v3. BodyCounts `+12` version gate, Physics `+24` physical meta와 `+28` interaction meta, Simulation `+8` gameplay meta와 `+12` flags-only, GridBody `+28` interaction meta를 사용하며 모든 기존 32-byte stride를 유지한다. V2/V3 live migration은 없고 mismatch compute/draw/event decode는 fail closed한다.
- interaction-radius small/big grid, cap 64, 모든 count 소비 clamp, tick당 grid 1회와 6회 Jacobi/PBD 해소
- 원본 결함 보완: spawn/OOB `gridIndex=-1`, identity 기반 deterministic zero-distance normal, dynamic big body 거부, world AABB SDF 합성
- `TileMap.navigationGrid.blocked`에서 기본 원본 JFA 규칙으로 생성하고 signed half-SDF-cell bias로 authored cell face를 zero contour에 맞춘 world-unit SDF. benchmark는 8배 세분화 + setup-only exact EDT로 측정된 작은 enemy corner contact 오차를 약 `0.026 world`로 제한
- corrected position 기반 속도 재구성, GPU indirect dispatch/draw, frame-path 전체 body readback 0 byte
- strict/reference-clock/capped presentation profile과 원본 `u32` millisecond clock 규칙
- 기본 capacity `16,384`, 빈 세션 GPU 할당 지연, 비지원/초과 spawn의 명시적 거부
- overflow 발생 tick의 GPU-side rollback, 누적 sticky counter, 4-slot 비동기 telemetry와 최대 60-tick backpressure 경계
- pause epoch마다 presentation clock 동기화, live device-generation 변경 시 `requires-rebuild`
- 기존 JS/WASM flow builder 결과를 route waypoint별 24-layer `rg32float` atlas로 고정하고 GPU nearest-cell sample, source steering, stage 전환 적용
- `(entityId, incarnation)` GPU ABI와 fixed-capacity stable-slot/free-list spawn/despawn, inactive-hole pass 제외, survivor state 비재업로드
- overflow tick의 position과 route field index 동시 rollback, GPU identity 기반 race-safe 진단 readback
- `GameObjectSystem` 소유 `EnemySimulationBackend`와 backpressure 중 mixed GPU World/presentation 동시 정지 경계. backend 이름은 legacy지만 같은 session이 Tower/Core proxy/enemy/projectile mixed bodies를 처리
- CPU `WorldRegistry`의 reserve/activate/cancel/remove와 ID 재사용 시 incarnation 증가
- `EnemyLifecycleCommandOwner`의 next-fixed despawn→spawn batch commit, 거부 시 예약 rollback, upload fault 후 registry 반영·세션 freeze
- production square/triangle/arrow/penta/hexa/gen 6종과 별도 Archer 데이터, `corridor_eight_wave_01` 단일 phase/group의 32-body/five-tick seven-ID 순환 schedule, 실제 `gateId/pathId/waypointIndex` spawn mapping. Archer는 indexes `6/13/20/27`, local ticks `31/66/101/136`에 들어간다. 일곱 definition은 같은 `0.29698484809834995 world` 원형 collider authority를 공유하고 render-only shape code로 한 indirect draw 안에서 분석형 silhouette를 사용
- `GameSystem.enter()`가 `GPU_WORLD`/`CPU_NO_WAVE_FALLBACK`을 불변으로 고정한다. GPU mode는 lifecycle/fixed-command commit과 one mixed-world submit이 성공한 tick만 확정하고, fallback은 기존 CPU Tower fixed/tile solve를 유지한다.
- 일시 unavailable spawn은 command를 보존해 같은 tick에 재시도한다. hard GPU failure는 `GameScene`이 같은 `GameSystem`/`CoreIntegrity`/input/camera/fixed tick을 보존한 채 endpoint/registry/backend/wave만 한 generation에 한 번 교체하고 global `N+1`에서 re-arm한다.
- `GpuSimulationEndpoint`가 backend·`WorldRegistry`·next-fixed lifecycle/fixed owner를 한 session facade로 묶고 Tower/Core proxy/enemy/projectile이 같은 stable-slot pool/grid를 사용한다. `GpuEnemySimulationEndpoint`는 constructor identity를 공유하는 legacy alias다.
- 안정 import `ingame/gpu_simulation_endpoint.js`에서 generic/legacy endpoint factory, mode, Tower/Core adapter, presentation profile, enemy spawn adapter, data-driven `GpuProjectileSpawnAdapter`, canonical gameplay-team contract를 재노출한다. canonical accessor는 `GameScene.getGpuSimulationEndpoint()`와 `getNextGpuLifecycleFixedTick()`이며 enemy 이름 accessor는 호환 alias다. lifecycle tick API는 정상 시 `fixedTick + 1`, 이미 commit한 `N + 1` submit 재시도 중에는 열린 `N + 2`를 반환한다.
- contact handler f32 gameplay damage를 host/WGSL 공통 `f32(value) × f32(100) → f32 → trunc`로 health atomic에 변환한다(`0.29/0.57/1.15 → 29/57/115`). projectile penetration을 target damage 전에 선예약하고 target damage 미적용 시 refund한다.
- physical pair는 양쪽 `collisionMask ↔ bodyLayer`, interaction pair는 양쪽 `interactionMask ↔ interactionLayer`가 모두 맞아야 성립한다. sensor/policy 존재만으로 physical solver를 끄지 않으며 effect 방향은 explicit enter-only/continuous handler를 가진 subject가 소유한다. gameplay noun은 `kindId/definitionId`에 남는다.
- Tower/Core proxy/enemy/projectile/benchmark proxy production producer는 collision/interaction metadata와 별개인 canonical `teamId/allegiancePolicy`를 명시한다. Tower는 PLAYER/FIXED_PLAYER, Enemy는 HOSTILE/FIXED_HOSTILE, Core proxy는 NEUTRAL/EXPLICIT_OVERRIDE이며 source-relative projectile은 exact source registry team을 INHERIT_SUBJECT로 주입·검증한다. legacy `layerMask/sensorMask`는 public ingress에서 V1 target acceptance와 enter-only 의미를 canonical 값으로 승격한 뒤 제거한다.
- predicted-position body/world contact, projectile previous-overlap 억제, deterministic `CLOSEST_ONLY`, terrain interaction/kill 분리, health/lifetime death와 GPU immediate hide를 구현했다. small primary는 `2r <= min(cell)`이고 큰 static candidate는 `radius + maximumSmallRadius` 범위에 복제된다.
- counted contact/applied/death readback은 header와 element capacity를 분리한 bounded leased ring, exact `(sessionGeneration, deviceGeneration, authoritativeEpoch, entityId, incarnation, sourceTick, sequence, eventType)` dedupe identity, drain-time protocol provenance, per-epoch predecessor chain과 completion watermark를 사용한다. facade는 generation/epoch, future tick, sequence/predecessor gap, exact batch replay fingerprint, incomplete watermark와 stale exact identity를 side effect 전에 전체 검증한다.
- exact-identity death event는 CPU lifecycle owner의 next-fixed despawn으로 바뀌며 `WorldRegistry` 제거와 stable slot 회수는 GPU 참조가 끝난 경계에서 수행한다. 마지막 body의 일반 despawn도 pending event/overflow readback 또는 undrained completion batch가 있으면 GPU epoch/resource를 release하지 않고, 그 전에 respawn하면 같은 epoch를 잇는다. 원본 dense removal/sort를 live 경로에서 흉내 내지 않는다.
- `module/scene/benchmark/BenchmarkScene`은 `enemyWaveEnabled:false`, `gameplayWorldActorsEnabled:false`인 실제 child `GameScene`을 소유한다. 세션 생성 시 중앙 player와 같은 위치/반경의 hidden static proxy를 먼저 예약하고, `Spawn 100 Enemies`와 중앙 cyan 방사형 `Spawn 10 Projectiles` command를 frame-end drain에서 같은 공개 endpoint의 다음 fixed tick으로 예약한다. strict/reference/capped profile 변경은 child session 전체 재시작이며 CPU 적 비교 모드는 없다.
- viewport-relative CPU player와 initial/static wall/box, dynamic Spawn Box, profiler 버튼은 유지한다. CPU projectile 배열은 비어 있다. player의 충돌 권위만 `KINEMATIC_OBSTACLE` GPU proxy가 담당하며, initial arena walls/boxes만 GPU SDF에 포함되고 동적 Spawn Box는 CPU-only라 GPU SDF/접촉에 반영되지 않는다.
- `idle/probing/lost` 계열의 pre-submit 준비 지연과 `unsupported/destroyed`·port 부재를 분리한다. zero-accept의 일시 unavailable command는 같은 tick에 재시도하고, `requiresRecovery()` gate에서 retryable한 상태는 telemetry `gpu-backpressure`뿐이다. terminal 상태는 GPU wave/pending/active body가 있을 때 hard failure다. unsupported enter는 별도 CPU Tower/Core no-wave session을 선택하며 GPU gameplay request를 만들지 않는다.
- Production GameScene status is a bounded deep-frozen `GameSystem` mirror: Tower values are committed `TowerCombatRoster` scalars, Core values are CPU `CoreIntegrity`, and no full-body GPU readback is allowed. The canonical layout renderer runs only on full GameScene draw; CPU fallback shows `TOWER N/A`, while benchmark/tool children omit the status port.
- 기존 physics/SDF/flow/render/stable-slot/fault/sparse/overflow와 NVIDIA Lovelace NW WebGPU production-adapter smoke는 PASS. Phase 5 실제 fixture는 Phase 4 Tower/Core/SDF/tracked-pose 증거에 더해 Basic Bullet tick-start aim, same-submit control, direct render, damage/terrain/lifetime cleanup, 네 pressure domain의 control 보존, generation retirement/rebind를 검증했다. R1 Turn 3 fixture는 moving source/target의 tick-start exact aim, nonzero target offset, source-velocity/+X/behind-target 방향, target-death/slot-ABA cleanup, aim과 Team/target-policy 분리, targeted pressure의 control 보존을 추가했다. R1 Turn 4 fixture는 lifecycle 등록 Archer의 completion-based first/repeat shot, exact living-Tower target, HP `30→25→20→15→10→5→0`, hostile/Core isolation, terrain/lifetime cleanup, target-invalid no-cooldown, Tower 사망 후 shot 0과 flow 진행을 추가했다. R1 Turn 5 fixture는 production wave 32/4 Archer schedule, first/repeat completion, actual GPU HP `30→25→20→15→10→5→0`, exact render exclusion, 30 post-death ticks, LMB disable, and zero final active/reserved/pending counts를 추가했다. 이 production-wave hardware fixture는 technical Tower `(3,12)`를 사용하며 GameScene spawn `(45,15)` 기하 증거가 아니고, CPU domain sentinel도 `coreIntegrityRuntimeBound=false`다. finite 2초 lifetime은 f32 source tick 121에서 `lifetime` death 1회, boundary 122 cleanup이며 immortal `-1`은 tick 130까지 유지됐다. `uncapturedErrorCount=0`, explicit teardown `deviceLostReason='destroyed'`다. render golden baseline은 변경하지 않았다.
- `GpuFixedCommandOwner`가 exact `(entityId, incarnation)` move-only command와 source-relative
  spawn request를 bounded next-fixed inbox/history로 소유한다. 동일 command ID/payload replay는
  idempotent이고 다른 payload 재사용은 fail-fast다. 같은 body/tick의 같은 payload는 한
  canonical command로 coalesce하며 다른 payload끼리는 둘 다 적용하지 않는다. Raw
  source-relative command는 getter/Proxy 재평가로 source/target identity와 team이 갈라지지 않도록
  단 한 번 immutable plain-data snapshot으로 만든 뒤 fingerprint, registry lookup, 정규화에 공유한다.
- Body/event ABI v3 stride를 바꾸지 않는 별도 fixed primitive 계약을 추가했다. body control은
  ABI v1의 16-byte header + 32-byte record이고, SpawnProgram은 ABI v3의 16-byte header +
  80-byte record 안에서 source-relative velocity, world aim-point, exact target-entity mode를 구분한다.
  source-relative destination은 resolve 전 inactive/hidden/non-contact다. GPU result는 4-slot
  bounded ring으로 회수해 `RESOLVED`만 registry를 활성화하고 `SOURCE_INVALID`와
  `TARGET_INVALID`는 exact reservation/stable slot을 정상 정리한다.
- session당 exact body 하나의 tracked pose를 finalize 뒤 GPU에서 32-byte record로 pack하고
  4-slot lossy ring에 copy한다. lease envelope가 session/device/epoch/source/submitted tick과
  revision을 검증하며, 포화는 sample만 drop하고 fixed/event/lifecycle을 막지 않는다.
- production `GpuPrimaryProjectileController`는 semantic primary-pointer hold와 copied world aim을
  exact Tower GPU handle에 결합해 named Basic Bullet data로 same-boundary request를 만든다.
  정상 spawn pressure에서는 cooldown/sequence를 소비하지 않고 재시도하며, commit된 shot만
  cooldown을 확정한다. tracked pose와 CPU source position은 발사 계산에 사용하지 않는다.
- finite lifetime host 값은 `-1` immortal 또는 `>=0`만 허용한다. `prepare_bodies`는
  `max(previous - dt, 0)`으로 canonical zero를 만들고 contact/damage 뒤 `mark_dead`가 health와
  lifetime reason을 합쳐 ALIVE clear/death append를 한 번만 수행한다.
- Phase 5 실제 hardware profile은 fixed-control/source-resolve/tracked-pose `5/5/6`이고 기존
  physics/body/world/contact `8/9/7/9`와 required maximum 9를 유지한다. NVIDIA Lovelace에서
  production Tower wall/corner/out-of-map, Core enter/no-response, exact `2r == cell`, source-invalid cleanup, pose saturation을 포함해
  uncaptured error 0으로 통과했다.

아직 남은 범위:

- Core raw enter event의 gameplay consumer, kill/reward/웨이브 완료 계약
- swept CCD 필요성 결정. 현재 previous-overlap suppression은 반복 피해를 막지만 고속 이동 구간 전체를 검사하지 않는다.
- live body의 mid-wave 연속 복구에 필요한 authoritative checkpoint. 현재 정책은 stale spawn replay가 아닌 전체 wave 안전 재시작
- 장시간 body/body·terrain·closest·death/cleanup readback/overflow stress
- `normal-10k-v1` 고정 fixture 성능 수치, benchmark scene 수동 시각 승인과 CPU fallback 선택
- primary Basic Bullet 외 Word/Sentence/Skill weapon producer와 GPU subject selector/child allocator

| 단계 | 현재 상태 | 남은 핵심 |
|---|---|---|
| Phase 0 | 기존 실기 capability/pipeline/overflow/generation 및 contact storage-limit 9 negotiation/hardware smoke 완료 | 고정 10k fixture 성능 수치 |
| Phase 1 | `WorldRegistry`·next-fixed command owner·bounded event watermark/timeline 계약 완료 | 실제 Core/weapon commit owner |
| Phase 2 | 완료 | benchmark/overlay 수동 합성 승인 |
| Phase 3 | production enemy spawn→physics→presentation→draw 및 benchmark QA 진입 완료 | 수동 시각 승인 |
| Phase 4 | 실제 wave route flow atlas/sample/stage progress 완료 | arrival event와 10k fixture |
| Phase 5 | 6회 solver와 overflow 안전 경계 완료 | 10k production fixture 승인 |
| Phase 6 | 세 presentation profile, pause 동기화, GPU mixed-body interactive benchmark UI 완료 | 수동 비교와 기본 profile 확정 |
| Phase 7 | stable-slot과 fixed command/death cleanup lifecycle 완료 | 장기 churn; dense parity는 선택 사항 |
| Phase 8 | body/world contact·피해·death readback 수직 슬라이스 Node/NW hardware smoke 완료 | 장시간 stress, Core/weapon/gameplay commit |
| Phase 9 | 미착수 | fallback, 10k rollout/최적화 |

## 1. 결론

이번 작업의 목표는 CirVivor의 기존 CPU 충돌 코드를 GPU로 그대로 옮기는 것이 아니다. 외부 게임에서 검증된 다음 로직을 **기준 구현(reference profile)** 으로 삼고, CirVivor의 세션·맵·입력·게임 규칙 계약에 필요한 부분만 어댑트한다.

- 연속 storage buffer 기반 바디 저장
- CPU next-fixed 배치 생성 요청과 GPU 측 stable-slot body planes (원본 reference는 dense 배열)
- flow field를 샘플링하는 속도 조향
- SDF 기반 지형 충돌
- 균일 그리드 broad phase
- 6회 Jacobi/PBD 위치 보정
- 보정된 위치로 속도 재구성
- GPU count 기반 indirect dispatch/draw
- 물리 버퍼를 직접 읽는 GPU 인스턴스 렌더
- 비동기 링 버퍼 readback
- 물리 프레임과 렌더 프레임 사이의 전방 예측

현재 렌더러는 `canvas.getContext('webgl')` 기반 WebGL 1이므로 GLSL 450 compute/SSBO/atomic/indirect 명령을 직접 실행할 수 없다. 이식 API는 **WebGPU + WGSL**로 고정한다. WebGL 2 텍스처 ping-pong으로 유사 기능을 새로 설계하는 경로는 원본 로직 이식이 아니며 초기 범위에서 제외한다.

GPU 이식의 첫 물리 대상은 **대량의 일반 원형 collider 적**이었고, projectile과 production Tower/Core proxy도 같은 endpoint/session/grid로 확장됐다. Tower 위치·속도·SDF 충돌·render transform은 GPU 권위이며, 입력은 command sink, 카메라는 bounded observed pose source로 분리된다. Core Integrity는 CPU 권위이고 invisible proxy만 GPU interaction에 참여한다.

레거시 전역 `ObjectSystem`은 이식 대상이 아니다. 타이틀과 벤치마크의 CPU 보조 player/box fixture에만 사용하며, 벤치마크를 포함한 enemy/projectile 권위와 GPU 월드는 세션 `GameObjectSystem`이 소유한다. benchmark의 CPU projectile 목록은 비워 둔다. 초기 arena wall/box는 navigation snapshot으로 GPU SDF에 들어가지만 실행 중 추가한 CPU box는 SDF를 재생성하지 않는다.

## 2. 구현 전에 확인된 제약

### 2.1 현재 신규 플레이의 일반 적 월드는 물리 수직 슬라이스까지 연결됐다

현재 [`GameObjectSystem`](../../project/game/script/module/ingame/object/game_object_system.js)은 TileMap, Tower/Core facade, `WaveDirector`와 함께 [`GpuSimulationEndpoint`](../../project/game/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js)를 세션 단위로 소유한다. `GPU_WORLD`에서 endpoint 내부 registry/lifecycle/fixed owner/backend가 Tower/Core proxy/enemy/projectile을 같은 slot/grid에서 처리하고, owner만 event→wave/actor request→commit→one submit→presentation/draw를 호출한다. fallback에서는 기존 CPU Tower/Core 경로만 실행한다.

첫 production 적과 웨이브는 실제 map route의 `gateId/pathId/waypointIndex=1`을 사용한다. projectile은 route/flow를 요구하지 않는다. CPU registry는 identity/content metadata만 소유하고, 위치·속도·flow stage는 fixed tick 사이 GPU 권위다. hard GPU failure에서는 같은 `GameSystem`의 CPU domain을 유지하고 restartable GPU world만 교체한다. 같은 device generation의 replacement가 한 tick도 성공하지 못하면 반복 재시작하지 않는다. 아직 없는 계약은 Core raw event consumer, 실제 weapon/gameplay owner, 선택적인 mid-wave body checkpoint다.

### 2.2 참고 구현은 완전한 독립 소스가 아니다

추가된 `projectile_contact` 추출본에는 body/body, body/world, closest filter, handle/mark/dead contact 의미가 포함돼 현재 stable-slot contact vertical slice를 구현하는 데 충분했다. 원본 dense `removal/sort`와 laser/special producer는 exact dense/special parity에만 필요하며 현재 blocker가 아니다. 원본과 같은 이동 trajectory까지 수치로 주장하려면 적 설정·spawn/path 계약과 원본 trace가 더 필요하지만, 이번 범위는 CirVivor의 기존 route-stage flow authority와 추출 collision/contact/presentation을 결합해 승인한다. 필요한 선택 자료는 [14. 추가로 필요한 소스와 계약](#14-추가로-필요한-소스와-계약)에 정리한다.

### 2.3 참고 자료의 “보간”은 실제로 외삽이다

참고 구현은 다음 식을 사용한다.

```text
renderPosition = currentPhysicsPosition
               + currentVelocity × (renderTime - simulationTime)
```

CirVivor의 현재 Tower와 레거시 적은 다음의 실제 보간을 사용한다.

```text
renderPosition = mix(previousPhysicsPosition, currentPhysicsPosition, fixedAlpha)
```

두 방식을 섞지 않는다. GPU 렌더러는 다음 profile을 분리해 구현하고 각 결과를 별도 기록한다.

1. `strict-interpolation`: 현재 엔진 계약과 수치 검증을 위한 기준 모드
2. `reference-clock-extrapolation`: 원본의 `simulation_time`, `render_time`, `last_rendered_frame`과 variable `_process(delta)` clock 규칙을 presentation-only state로 재현하는 충실도 목표 모드
3. `capped-accumulator-extrapolation`: CirVivor의 `fixedAlpha × fixedDt`를 `[0, fixedDt]`로 제한하는 안전한 adaptation 후보
4. source trace, 시각·충돌·정지 프레임 검증을 통과한 profile만 GPU 적의 기본값으로 전환

`fixedAlpha × fixedDt`가 원본 clock과 동치라고 가정하지 않는다. reference-clock profile은 원본 frame-id/clock trace와 30/60/120Hz에서 differential 검증한다. capped-accumulator profile은 디버거 정지·프레임 stall·`uint` underflow 위험을 막는 의도적 변경으로 따로 평가한다.

### 2.4 GPU 완료와 CPU fixed tick은 동기 경계가 아니다

WebGPU submit은 비동기다. 위치 전체를 fixed tick마다 CPU로 읽어오면 GPU 이식 효과가 사라진다. 따라서 다음 원칙을 고정한다.

- GPU는 적의 고빈도 물리 상태와 경로 진행 상태를 소유한다.
- CPU는 entity identity, authored route, wave/phase, 명령, 게임 규칙을 소유한다.
- CPU→GPU는 spawn/remove/status/proxy 명령만 배치 업로드한다.
- GPU→CPU는 접촉·도착·사망·통계 같은 작은 tick-stamped event만 staging ring으로 읽는다.
- readback을 `fixedUpdate()`나 `draw()`에서 `await`하지 않는다.
- 이벤트 dedupe 키는 `(sessionGeneration, deviceGeneration, authoritativeEpoch, entityId, incarnation, sourceTick, sequence, eventType)`로 고정한다.
- event-producing submission은 이벤트가 0개여도 `completedThroughTick` completion record를 전달한다. producer가 없는 tick 때문에 source tick이 sparse할 수 있으므로 batch마다 이전 event batch의 source/submitted tick을 명시하고 CPU는 그 chain과 watermark 이하만 확정한다.
- event overflow 또는 불완전한 readback batch가 감지되면 watermark를 전진시키지 않고 세션을 안전 pause/error 처리한다. 손실 가능성이 있는 tick을 정상 완료로 간주하지 않는다.
- 각 고정 개수 readback slot은 copy submit부터 `mapAsync` 완료와 commit/폐기까지 lease한다. lease 중인 slot은 덮어쓰거나 재사용하지 않는다.
- `completedThroughTick`은 해당 event-batch predecessor prefix의 모든 event와 completion record가 lease된 slot에 누락 없이 copy되고 CPU가 읽을 수 있을 때만 전진한다.
- 마지막 body를 일반 despawn해도 pending event/overflow readback 또는 0-event watermark batch가 있으면 epoch/resource release를 미룬다. drain 전 respawn은 같은 epoch를 이어가며 predecessor chain drain 뒤 기존 watermark를 보존한 채 idle release한다.
- free slot/event capacity가 없으면 event-producing GPU tick submit을 조용히 계속하지 않는다. `inFlightTicks`와 `readbackAge` 한계까지 backpressure를 계측하고, 한계를 넘으면 다음 안전 fixed 경계에서 GPU 의존 gameplay/session을 pause한다.
- staging ring의 무한 증설, slot/event overwrite, silent drop은 금지한다.
- watermark 이하 이벤트를 `sourceTick, sequence` 순으로 다음 fixed 경계에서 exactly-once commit한다. 이후 이벤트와 wave/phase 판정은 보류한다.
- 이미 commit한 키는 중복 제거하고, 현재 session/device generation과 다른 이벤트는 폐기한다. committed watermark보다 늦게 도착한 미지의 이벤트는 상태에 소급 적용하지 않고 오류로 기록한다.
- Core damage, arrival, wave-clear처럼 GPU 결과에 의존하는 판정은 해당 source tick이 watermark로 확정되기 전에 미래 CPU wave/phase 상태 위에서 실행하지 않는다.

## 3. 원본 충실도 정책

### 3.1 그대로 유지할 알고리즘

초기 reference profile에서는 다음을 임의로 튜닝하지 않는다.

- 물리 tick당 grid 1회 구축
- 일반 바디는 중심 셀 1개에 등록하고 주변 8개 셀 탐색
- 셀당 최대 64개 저장
- 6회 `clear delta → body/body solve → body/world solve → apply delta`
- Jacobi 방식으로 각 invocation이 자기 바디 보정만 기록
- `previous → predicted → corrected → velocity rebuild → finalize` 순서
- 기존 JS/WASM route-stage 방향장을 샘플링한 뒤 flow 방향으로 목표 속도를 만들고 `min(dt, 1)` 계열로 조향하는 원본 integrate 식
- GPU additions를 해당 tick 파이프라인 말미에 적용해 다음 tick부터 활성화
- indirect dispatch와 indirect draw의 count를 GPU가 생성
- CPU 전체 위치 readback 금지

수정이 필요하면 먼저 reference profile 결과를 보존하는 golden/trace를 만든 뒤 별도 profile로 비교한다.

추출본 오케스트레이터 [`gpu_sim.gd`](gpu_physics/source/globals/gpu_sim.gd)가 실제 dispatch하는 전체 순서는 다음과 같다.

```text
handle_dead
→ removal
→ sort_types
→ body-count/indirect-dispatch 갱신
→ integrate
→ clear/build grid
→ contacts body/body, big-body/body, body/world
→ filter_contacts
→ handle_contacts
→ mark_dead
→ 6 × (clear delta → body/body solve → body/world solve → apply delta)
→ update_velocity
→ finalize
→ readback/copy
→ addition
```

Phase 3~6은 위 순서의 `integrate → grid → 6회 solver → velocity/finalize`를 먼저 검증한 **physics-only adaptation profile**이었다. 현재 contact vertical slice는 `contacts → closest filter → handle → mark dead`의 상대 순서를 solver 앞에 복구했다. 원본의 다음-tick `handle_dead → removal → sort_types` dense 재배치는 stable-slot 계약에 맞게 **GPU immediate hide/exclusion → bounded exact-identity death readback → CPU next-fixed despawn/slot reclamation**으로 대체한다. 이 adaptation을 원본 dense reference와 동일하다고 부르지 않는다.

### 3.2 의도적으로 바꿀 부분

| 항목 | 변경 이유 | 이식 방침 |
|---|---|---|
| Godot `RenderingDevice` / GLSL 450 | 브라우저 런타임 불일치 | WebGPU / WGSL로 기능 등가 포팅 |
| `std430` 통합 binding set | WebGPU adapter binding limit | pass별 최소 bind group으로 분할 |
| 절대 월드 상수 `12`, 반지름 `2~4` | CirVivor는 `1 tile = 1 world unit` | 원본의 비율을 유지해 단위 변환 후 동결 |
| 원본 단일 Core flow 생성 | CirVivor의 기존 JS/WASM navigation 및 crossing route 계약과 충돌 | 기존 route-stage 방향 plane을 atlas로 업로드하고 body `fieldIndex` 사용 |
| flow가 0일 때 월드 중심 fallback | authored route 위반 가능 | 현재 route stage goal 방향으로 fallback |
| 큰 바디 cell count 미제한 | 원본의 범위 초과 위험 | 모든 cell count를 64 이하로 clamp하고 overflow 기록 |
| render clock/frame 계약 차이 | 원본 clock과 CirVivor accumulator가 동치가 아님 | reference-clock profile을 재현하고 capped-accumulator를 별도 안전 후보로 비교 |
| GPU dense index를 identity로 사용 | compaction 시 stale handle 위험 | `entityId + incarnation`과 dense index를 분리 |
| 고정 `MAX_BODIES = 262,144` | adapter limit·메모리 차이 | 목표 동시 수와 device limit로 session capacity 산정 |

### 3.3 초기 범위에서 옮기지 않을 것

- 전역 레거시 `ObjectSystem` 자체
- Tower 입력/카메라 권위 상태
- Core Integrity와 phase/wave/save 권위
- swept projectile CCD, Hexa Hive 합체, 화염/시체/lightning 시각 효과
- laser/Tesla/fire/freeze/chaining과 원작 무기별 특수 producer. CirVivor 무기 규칙은 별도 integration에서 정의
- mid-wave save snapshot
- WebGL/WebGL2 GPGPU fallback

이 항목들은 GPU 일반 적 수직 슬라이스가 안정화된 뒤 별도 단계에서 확장한다.

## 4. 목표 구조와 소유권

```text
DisplaySystem (app lifetime)
├─ 기존 2D/WebGL surfaces
└─ WebGpuPlatformService
   ├─ adapter/device/capabilities/device generation
   ├─ 전용 투명 gameplay canvas/context
   └─ device 세대별 immutable shader/pipeline cache

GameScene
└─ GameSystem (session authority)
   ├─ CPU CoreIntegrity + input/router/camera + fixed timeline
   ├─ immutable GPU_WORLD | CPU_NO_WAVE_FALLBACK mode
   ├─ WaveDirector / AISystem
   └─ GameObjectSystem
      ├─ Tower input/camera facade + CPU Core presentation
      ├─ CPU Tower/Core bodies (fallback only)
      └─ GpuSimulationEndpoint (`GpuEnemySimulationEndpoint` legacy alias)
         ├─ WorldRegistry (stable entity handle authority)
         ├─ EnemyLifecycleCommandOwner (next-fixed mutation)
         ├─ GpuFixedCommandOwner (bounded control/SpawnProgram reservation)
         └─ EnemySimulationBackend
            └─ GpuCircleBodySimulation (production target)

BenchmarkScene
├─ child GameScene (`enemyWaveEnabled: false`, `gameplayWorldActorsEnabled: false`)
│  └─ one GPU enemy/projectile/player-proxy endpoint/session/grid lifecycle
├─ session-start hidden player proxy + frame-boundary `Spawn 100` / radial `Spawn 10`
│  └─ public endpoint next-fixed request
└─ global ObjectSystem CPU auxiliary visible player/box + profiler
   └─ initial wall/box만 GPU SDF; dynamic Spawn Box는 CPU-only
```

### 4.1 DisplaySystem 소유

- `navigator.gpu` capability probe
- adapter/device 생성과 `device.lost` 감시
- 투명 WebGPU canvas의 configure/resize/show/hide
- device generation에 종속된 shader module/pipeline cache
- canvas content/composite revision 통지

DisplaySystem은 적, body count, route, 물리 tick을 알지 않는다.

### 4.2 GameObjectSystem / endpoint 세션 소유

- GPU body/state/tmp/grid/count/addition/removal/event/readback buffer
- 맵별 SDF/flow field texture 또는 buffer
- spawn/remove/status command upload queue
- 한 fixed tick의 compute pass 인코딩
- render uniform과 indirect draw
- idempotent destroy

`GameObjectSystem`은 위 자원을 직접 조립하지 않고 `GpuSimulationEndpoint` 하나를 소유한다. endpoint가 backend, registry, lifecycle/fixed command owner의 생성·상태·teardown 순서를 책임지고 `GameObjectSystem` 자체도 이 facade를 통해서만 fixed/presentation/draw를 호출한다. Tower/Core/enemy/projectile용 별도 endpoint/grid를 만들지 않는다.

세션 코드는 Display singleton을 직접 import하지 않는다. [`createGameSceneDependencies()`](../../project/game/script/module/scene/game/game_scene_dependency_factory.js)가 `gpuPlatformPort`를 주입한다.

### 4.3 CPU/GPU 권한 경계

| 상태 | 권위 | 비고 |
|---|---|---|
| `entityId`, incarnation, kind, content ID | CPU `WorldRegistry` | dense GPU index와 분리 |
| gate/path 할당과 route 정의 | CPU | immutable field atlas 생성 입력 |
| 활성 적의 고빈도 `fieldIndex`/waypoint progress | GPU | stage 전환·도착 event를 CPU에 전달 |
| 적 position/previous/predicted/velocity | GPU | 매 tick 전체 readback 금지 |
| radius/inverse mass/layer/mask/health/contact handler | GPU | gameplay-unit spawn data를 ABI 경계에서 pack |
| Tower position/previous/velocity/SDF collision | GPU | exact control command; tracked pose는 camera-only |
| Core presentation/Integrity | CPU | object identity/value는 GPU recovery에서도 보존 |
| invisible Core interaction proxy | GPU | static, physical response 0, raw enter-only event |
| body/body·body/world position solve | GPU | Tower-enemy response와 Core physical blocking은 현재 비활성 |
| wave/phase/Core Integrity/combat commit | CPU | GPU event를 안전한 fixed 경계에서 처리 |
| GPU 의존 gameplay finalized tick | CPU commit timeline | `completedThroughTick` watermark를 넘지 않음 |
| session/device generation | CPU platform/session | 이전 세션·소실 device의 command/event 폐기 기준 |
| render transform | GPU vertex shader | 물리 buffer 직접 사용 |

### 4.4 공개 GPU simulation endpoint

안정 import 경계는 [`ingame/gpu_simulation_endpoint.js`](../../project/game/script/module/ingame/gpu_simulation_endpoint.js)다. 실제 플레이에 이미 들어온 코드에서는 새 backend를 만들지 않고 현재 mixed-body session endpoint를 얻는다.

```js
import {
    createGpuEnemySpawnIntent
} from 'ingame/gpu_simulation_endpoint.js';

const gpuSim = gameScene.getGpuSimulationEndpoint();
const nextFixedTick = gameScene.getNextGpuLifecycleFixedTick();
const intent = createGpuEnemySpawnIntent({
    definition: enemyDefinition,
    route,
    spawnSequence,
    waveId,
    policyId
});

gpuSim.requestSpawn(intent, nextFixedTick, commandId);
```

기존 `getEnemySimulationEndpoint()`, `GpuEnemySimulationEndpoint`, `createGpuEnemySimulationEndpoint()`, `enemyDefinitionId`, `layerMask`는 호환 alias다. 새 generic intent는 `definitionId`, `bodyLayer`를 사용하며 enemy에만 gate/path/waypoint/flow가 필수다.

실제 projectile producer는 무기 class를 endpoint에 결합하지 않고 data-driven adapter를 사용한다.

```js
import {
    GPU_PROJECTILE_SPAWN_MODE,
    GpuProjectileSpawnAdapter
} from 'ingame/gpu_simulation_endpoint.js';

const gpuSim = gameScene.getGpuSimulationEndpoint();
const projectileSpawner = new GpuProjectileSpawnAdapter(gpuSim, {
    commandNamespace: 'gameplay-projectile'
});

projectileSpawner.requestProjectile({
    mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
    definition: projectileDefinition,
    sourceHandle: towerGpuHandle,
    positionOffset: authoredMuzzleOffset,
    aimWorldPoint: copiedSemanticPointerWorld,
    launchSpeed: projectileDefinition.speed,
    targetFixedTick: gameScene.getNextGpuLifecycleFixedTick(),
    spawnSequence,
    commandId
});
```

definition은 `id`, `collisionRadius` 또는 `radius`, `inverseMass` 또는 `mass`, `penetration`, `damage`, optional `damageSelf`(기본 `1`), finite lifetime, terrain/closest policy와 render style을 갖는다. `ABSOLUTE`, source-relative velocity, source-relative aim-point, source-relative target-entity는 서로의 forbidden field를 fail-fast한다. source-relative mode의 caller는 exact handle과 mode payload만 제공하며 source/target position이나 velocity를 CPU에서 쓰지 않는다. Target-entity mode는 exact `targetHandle`, optional zero-default `targetOffset`, positive `launchSpeed`를 사용하고 target identity를 aim provenance로만 보존한다. adapter intent는 gameplay-unit `health: penetration`과 f32 `damageSelf/damageOther`를 보존한다. caller가 `×100` 하거나 반올림하면 ABI/shader가 다시 scale해 이중 변환되므로 금지하며 host/WGSL의 단일 변환은 `f32(value) × f32(100) → f32 → trunc`다.

`GameScene`/`GameSystem`에 붙은 endpoint에서는 gameplay adapter가 `requestSpawn()`/`requestDespawn()`만 호출한다. `commitAtFixedBoundary()`, `fixedUpdate()`, `updatePresentation()`, `draw()`, `synchronizePresentation()`, `destroy()`는 session owner가 정확히 한 번 호출한다. variable update/draw에서 backend를 직접 mutate하거나 `replaceBodies()`를 쓰지 않는다.

Phase 3~5가 사용하는 generic primitive seam은 같은 endpoint의
`requestBodyControl(command, targetFixedTick, commandId)`,
`requestSourceRelativeSpawn(intent, targetFixedTick, commandId)`,
`configureTrackedBody(handleOrNull)`, `getObservedTrackedPose()`다. public request는 exact
handle만 받고 GPU stable slot은 endpoint/backend 내부에서만 해석한다. observed pose는
synchronous GPU authority가 아니라 immutable/copy-out bounded observation이다.

벤치마크도 이 attached-endpoint 규칙을 따른다. [`gpu_benchmark_player_proxy_spawn_adapter.js`](../../project/game/script/module/scene/benchmark/gpu_benchmark_player_proxy_spawn_adapter.js)는 child session마다 중앙 목표 `(32, 18)`에 반경 `0.72`, inverse mass `0`, hidden `KINEMATIC_OBSTACLE` body 하나를 먼저 예약한다. [`gpu_benchmark_enemy_spawn_adapter.js`](../../project/game/script/module/scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js)는 frame-end command drain에서 `getNextGpuLifecycleFixedTick()`이 연 fixed tick, route, capacity, session/batch/spawn identity를 검증하고 proxy 예약이 실패한 세션에서는 fail closed한다. [`gpu_benchmark_projectile_spawn_adapter.js`](../../project/game/script/module/scene/benchmark/gpu_benchmark_projectile_spawn_adapter.js)는 같은 endpoint에 중앙 목표에서 속력 약 `14 world/s`, 반경 `0.18`, 수명 `2.5s`인 cyan projectile 10개를 15° 위상·36° 간격으로 예약해 적, 고정 wall, initial box contact를 관찰하게 한다. 세 adapter 모두 `requestSpawn()`만 호출하며 안정 command ID를 사용하고, batch adapter는 zero-partial capacity preflight를 수행한다.

독립 tool session이 전체 lifecycle을 직접 소유해야 할 때만 `createGpuSimulationEndpoint({ webGpuPlatformPort }, { capacity, presentationProfile })`로 생성하고 `init → request/commit → fixed/update/draw → destroy` 순서를 책임진다. 현재 `BenchmarkScene`은 독립 endpoint owner가 아니라 child `GameScene`의 caller다. `getStatus()`는 registry kind별 active count, lifecycle, backend contact/event/overflow/watermark 상태를 합친 불변 진단 snapshot이며 전체 body 위치 readback을 만들지 않는다.

## 5. 데이터와 셰이더 ABI

원본의 책임 분리를 유지하되 CirVivor에 불필요한 gameplay 필드는 처음부터 모두 복사하지 않는다.

### 5.1 최소 body ABI

초기 ABI는 다음 논리 planes를 갖는다.

- `BodyPhysics`: current position, velocity, radius, inverse mass, collision meta
- `BodySimulation`: entity ID, incarnation, flags, route/field index, status scalar
- `BodyTemporary`: previous position, predicted position, accumulated correction, grid index
- `BodyCount`: active/addition/removal/event/overflow counts
- `BodyAddition`: 초기 physics/simulation 값을 직렬화한 append record
- `BodyRemoval`: stable handle 또는 dense slot removal request
- `ContactHandler`: f32 gameplay-unit self/other damage와 flags/status policy
- `ContactState/Event/Death`: counted header와 bounded contact/applied/death payload

원본의 32-byte 구조체 정렬을 우선 유지한다. JS `ArrayBuffer/DataView` packer와 WGSL struct의 offset/stride를 한 파일에서 선언하거나 생성해 중복 숫자를 만들지 않는다.

현재 physics/simulation/temporary/contact-handler plane은 모두 32-byte stride다. Body ABI v3는 shader와 host에서 실제 사용되지 않던 `BodySimulation +8`의 이전 timer word를 명시적 `gameplayMeta`로 재정의한다. low 8 bit는 stable `teamId`(`NEUTRAL=0`, `PLAYER=1`, `HOSTILE=2`), 다음 8 bit는 `damagePolicyId`(현재 `DEFAULT_TEAM_MATRIX=0`), high 16 bit는 0으로 검증하는 reserved 영역이다. `BodySimulation`의 마지막 8 byte에는 slot과 독립적인 `entityId/incarnation`을 저장하고, `BodyTemporary`의 마지막 4 byte에는 overflow tick에서 route 진행도 함께 되돌릴 `previousFlowFieldIndex`를 저장한다. `0xffffffff`는 identity/field invalid sentinel로 예약한다. `health`와 contact handler `damageSelf/damageOther`의 atomic 입력은 host와 WGSL 모두 `f32(value) × f32(100) → f32 → trunc`로 변환한다.

Phase 3 fixed primitive ABI는 body ABI와 독립적이다. control program은 ABI v1의 16-byte
header와 32-byte record, SpawnProgram은 ABI v3의 16-byte header와 80-byte record, tracked pose는
32-byte record다. SpawnProgram은 destination/source/target private slot과 exact integer identity,
mode/result/source tick, source position offset, target offset, mode vector/scalar를 담고 reserved
field를 0으로 검증한다. 비-target mode의 target identity는 `0xffffffff`, target offset은 zero다.
live mixed-version 또는 ABI/status mismatch는 activation/watermark 없이 recovery-required로
종료한다.

현재 수직 슬라이스는 CPU가 fixed 경계에서 빈 stable slot만 부분 업로드하고 survivor를 재업로드하지 않는다. 원본 dense removal/sort/compaction을 포트하지 않은 것은 결함이 아니라 identity·readback safety를 위한 현재 adaptation이다. exact dense parity를 목표로 할 때만 원본 removal/sort source와 relocation 계약이 추가로 필요하다.

필수 ABI 테스트:

- 각 필드 byte offset과 stride
- signed/unsigned bit packing
- `entityId + incarnation` round trip
- 최대/최소 float와 NaN 거부
- addition record pack/unpack
- gameplay `health/damage`의 단일 fixed-point 변환과 소수 f32 handler 보존
- counted header가 element capacity를 침범하지 않는 slot layout
- indirect dispatch/draw argument layout
- WGSL readback이 JS packer의 sentinel pattern과 일치

### 5.2 capacity 정책

- reference profile 목표: 동시 일반 적 `10,000`
- stress 단계: `25,000`, 이후 `50,000`
- 현재 backend 기본 capacity는 첫 목표를 수용하는 power-of-two `16,384`다. 실제 balance 최대치와 adapter limit가 확정되면 같은 정책으로 재산정한다.
- session capacity는 balance상의 최대 동시 적 수와 안전 여유를 입력으로 받아 power-of-two로 올린다.
- 최종 값은 `maxBufferSize`, `maxStorageBufferBindingSize`, grid/event buffer 비용을 모두 만족해야 한다.
- capacity를 초과한 spawn은 일부만 조용히 수용하지 않는다. 명시적인 reject count/event를 반환한다.
- grow가 필요하면 매 프레임 재할당하지 않고 wave/setup 안전 경계에서만 재생성한다.

## 6. 고정 tick과 render frame 실행 순서

### 6.1 fixed tick

현재 stable-slot mixed-body adaptation 순서는 다음과 같다. 원본 전체 pass 순서는 [3.1 그대로 유지할 알고리즘](#31-그대로-유지할-알고리즘)의 표를 기준으로 하며, 아래 CPU commit/upload와 event copy는 CirVivor 통합 경계다.

```text
완료된 과거 readback poll
→ completedThroughTick 이하 event를 sourceTick/sequence 순으로 CPU commit
→ exact-identity death를 next-fixed despawn command로 변환
→ 이번 tick due despawn→spawn lifecycle commit/partial slot upload
→ body count 기반 indirect dispatch 갱신
→ source-relative SpawnProgram validate/resolve (tick-start source and optional target transforms)
→ controlled-body command validate/scatter/move (같은 tick source resolve 뒤)
→ integrate
   - finite lifetime = max(previous - fixedDt, 0); immortal -1 unchanged
   - previous = current
   - route-stage flow sample
   - 속도 조향/상태 효과
   - predicted = current + velocity × fixedDt
→ clear grid
→ build grid
   - interaction radius로 small/big 경로 분류
   - raw count 소비를 저장 capacity로 clamp
→ contact state clear
→ body/body contact
   - sensor/layer mask
   - projectile previous-overlap suppression
   - optional CLOSEST_ONLY deterministic reduction
→ body/SDF world contact
→ handle contacts
   - projectile penetration budget 선예약
   - successful target damage 또는 failed-hit refund
   - terrain kill
→ contact/damage 뒤 canonical-zero lifetime과 health reason을 합쳐 exactly-once death 표시,
  GPU immediate hide/exclusion
→ 6 × (
     clear deltas
     → solve body/body
     → solve body/SDF world
     → apply deltas
   )
→ velocity = (corrected - previous) / fixedDt
→ current = corrected
→ damping / max speed finalize
→ controlled max-speed finalize
→ exact one-body tracked-pose pack/copy (최대 32 bytes)
→ SpawnProgram result copy
→ counted contact/applied/death + completion watermark copy 예약
→ command buffer submit
```

GPU death는 같은 tick의 draw/grid에서 보이지 않지만 CPU registry와 slot을 즉시 지우지 않는다. bounded readback에서 exact session/device/entity/incarnation death가 contiguous watermark로 확정된 뒤 CPU가 despawn을 예약하고 **다음 fixed 경계**에서만 registry 제거와 slot 회수를 수행한다. 이 순서는 GPU가 참조 중인 slot 재사용을 막는다.

원본의 `handle_dead → removal → sort_types`와 tick 말미 addition을 그대로 포트하려면 dense relocation identity/event 계약이 추가로 필요하다. 현재 stable-slot adaptation의 기능 blocker가 아니며, 임시 stable profile과 exact dense reference parity 결과를 섞지 않는다.

현재 구현된 `spawnBodies()`/`despawnBodies()`는 GPU survivor plane을 다시 쓰지 않는 저수준 stable-slot mutation이다. production에서는 `GpuSimulationEndpoint` 내부 `EnemyLifecycleCommandOwner`만 이를 `GameObjectSystem.fixedUpdate()` 시작점에서 despawn→spawn 순으로 호출한다. gameplay caller는 endpoint의 `requestSpawn()`/`requestDespawn()`만 사용한다. variable update와 draw는 mutation 권한이 없다.

한 render frame에 fixed tick이 여러 번 있으면 각 command buffer를 같은 `GPUQueue`에 순서대로 submit한다. GPU 순서는 보장되므로 CPU 완료를 기다리지 않는다. submit overhead가 실제 병목으로 확인된 뒤에만 frame 단위 encoder batching을 별도 최적화한다.

### 6.2 variable update

- `fixedAlpha`와 카메라 projection snapshot만 갱신한다.
- gameplay, body, path stage를 변경하지 않는다.
- GPU readback promise 완료 결과를 live array에 직접 반영하지 않고 다음 fixed commit queue에 넣는다.
- `reference-clock-extrapolation`의 render clock/frame ID는 presentation-only state로 갱신할 수 있다. physics, route, gameplay state는 변경하지 않는다.

### 6.3 draw

```text
WebGPU canvas alpha 0 clear
→ camera scale/offset/viewport uniform upload
→ render policy uniform upload
→ drawIndirect(vertexCount=6, instanceCount=slotHighWaterMark)
→ transparent premultiplied output
→ DisplaySystem content revision 표시
```

렌더 패스는 동일 device의 body buffer를 직접 읽는다. stable-slot 중간 profile은 high-water mark까지 draw하되 tombstone의 radius/visibility를 0으로 만들어 hole을 완전히 투명하게 한다. CPU position 배열이나 기존 `WebGLBatch`의 16,000 sprite CPU vertex path로 되돌리지 않는다. hole 비율이 커지면 wave/checkpoint 안전 경계에서만 dense rebuild하며 live compaction으로 identity를 흔들지 않는다.

## 7. 맵, SDF, 기존 flow field의 GPU 연결

### 7.1 입력 authority

terrain occupancy의 단일 authority는 [`TileMap.navigationGrid.blocked`](../../project/game/script/module/ingame/map/tile_map.js)다. SDF와 기존 JS/WASM route flow는 같은 navigation snapshot에서 파생되어야 한다. map 생성이 끝날 때 아래를 하나의 immutable `GpuNavigationMapSnapshot`으로 추출하고 GPU용 별도 상수나 좌표계를 만들지 않는다.

- blocked sample mask와 map outer-boundary collision 규칙
- world bounds, width/height, `1 tile = 1 world unit`
- row/column 순서, 원점, X/Y 축 방향, texel center/edge와 world-to-texel 변환
- gate/spawn 영역과 각 `pathId`의 순서화된 stage goal/waypoint
- 각 waypoint의 도달 반경과 stage 전환 임계값
- Core 최종 goal의 중심·반경/충돌 형상과 arrival 판정 임계값
- SDF의 부호·scale·padding 및 map 밖 sample 규칙

현재 `TileMap`이 소유하지 않는 route threshold와 goal geometry는 map/session 생성 계약에 명시적으로 추가하되, 같은 authored map data에서 snapshot과 CPU oracle을 함께 만든다. resize, DPR, render scale, camera zoom은 snapshot을 재생성하지 않는다.

SDF용 원본 world texture ABI는 다음과 같이 명시적으로 변환한다.

- CirVivor `blocked = 1` sample → input texture `B = 1`; 빈 공간은 `B = 0`
- SDF 결과는 blocked 내부가 음수, walkable 외부가 양수
- row/column orientation, world-to-texel center와 blocked channel mapping을 numeric golden으로 고정

flow 입력은 원본 RGB texture ABI를 재생성하지 않는다. 현재 JS/WASM producer가 확정한 stage별 `Float32` 방향 plane, 크기, 원점, cell size, goal/waypoint metadata를 별도 snapshot으로 받아 그대로 업로드한다.

### 7.2 SDF

원본의 `seed → jump flood → finalize` 수치 규칙을 map setup 전용 JS builder로 옮겨 현재 구현했다. 기본 source grid는 이 JFA 호환 경로를 유지한다. 선택적 `sdfSubdivisions > 1`은 source occupancy를 보존한 채 고해상도 plane으로 복제하고 setup-only exact squared-distance transform을 사용해 JFA의 O(N log N) 초기화 비용을 피한다. benchmark는 축별 8배(`512 × 288`, values 약 0.6MB)를 사용한다. 결과 world-unit distance plane만 GPU storage buffer에 한 번 업로드하며 fixed/render frame의 sample·dispatch 수는 변하지 않는다.

- 부호, 거리 단위, gradient 방향을 원본과 맞춘다.
- blocked/free cell-center distance에 각각 음/양 방향의 half-SDF-cell bias를 적용해 authored cell face가 zero contour가 되게 한다. 이 bias는 map setup에서만 계산한다.
- `r32float` texture filterability에 의존하지 않는다. 현재는 storage `array<f32>`에서 수동 bilinear sample/gradient를 계산한다.
- 생성은 map setup 시 한 번 수행하고 texture/buffer를 세션 동안 재사용한다.
- world solve는 같은 Jacobi iteration에서 누적된 body-body `position_delta`를 더한 candidate에서 SDF를 평가한다. 이를 위해 별도 final dispatch를 추가하지 않는다.
- SDF의 authored edge midpoint와 현재 exact tile resolver의 모서리 차이를 golden case로 기록한다.

### 7.3 기존 route-stage flow field atlas

CirVivor의 경로 authority와 field 생성은 기존 JS/WASM flow-field 구현을 유지한다. GPU에는 완성된 방향 plane만 올리고, body별 nearest-cell sample 이후의 목표 속도 생성·완만한 mix·speed clamp는 참고 게임의 integrate 식을 최대한 그대로 옮긴다.

현재 `route_flow_field_atlas.js`가 실제 `TileMap`의 ordered waypoint마다 기존 JS/WASM builder를 호출해 `54 × 30 × 24`개의 RG 방향 layer와 goal/next metadata를 결정적으로 만든다. `EnemySimulationBackend`는 `pathId + waypointIndex`를 검증해 field index로 바꾸며, WebGPU는 이를 `rg32float` 2D-array texture로 한 번 업로드한다. Node 테스트는 실제 맵의 24개 layer 내용·순서·교차점 재방문을 검증하고, NW 실기 테스트는 동일한 production shape(`54 × 30 × 24`, 311,040 bytes)의 row pitch/layer upload와 마지막 layer·마지막 cell sample, 정지 상태 조향, 목표 셀의 다음 layer 전환, stable-slot 재사용, overflow 시 이전 layer rollback까지 readback으로 검증한다. Core arrival event는 gameplay event 단계에 남는다.

- route의 각 waypoint/stage별 기존 방향 plane을 atlas layer 또는 연속 buffer slice로 업로드한다.
- field snapshot은 `width`, `height`, row-major 방향, world origin, cell size, stage goal과 content/version key를 함께 제공한다.
- body는 `pathId` 문자열 대신 CPU가 검증한 `fieldIndex`와 다음 waypoint 정보를 갖는다.
- stage goal 도달 시 GPU가 다음 `fieldIndex`로 전진하고, CPU에는 작은 tick-stamped progress/arrival event만 전달한다.
- 마지막 stage만 Core attack/arrival 계약으로 연결한다.
- field가 0이거나 snapshot 범위 밖이면 월드 중심이 아니라 현재 stage goal 방향을 사용한다.
- field 생성은 map/stage setup 경계에서만 수행하고, body별 query나 전체 position readback으로 JS/WASM을 호출하지 않는다.

통과 조건:

- 모든 gate에서 생성한 적이 지정 `pathId`의 waypoint를 순서대로 통과
- 교차점에서 다른 route로 shortcut하지 않음
- blocked cell로 진행 방향이 향하지 않음
- 같은 입력에서 JS/WASM snapshot과 GPU sample 결과가 반복 실행 간 동일
- route 종료/도착 event가 정확히 한 번 발생

## 8. WebGPU surface와 기존 렌더러 결합

### 8.1 전용 정적 canvas

기존 `object` canvas는 이미 WebGL context를 가졌으므로 WebGPU context로 바꿀 수 없다. 다음 정적 surface를 추가한다.

```text
background  WebGL  z=0
gpu-object  WebGPU z=5 또는 9
object      WebGL  z=10   (Tower/Core)
effect      WebGL  z=20
...
```

요구 사항:

- `pointer-events: none`
- 투명 CSS background
- `alphaMode: 'premultiplied'`
- 기존 render-scale backing 크기와 같은 canvas width/height
- CSS 크기와 offset은 다른 정적 canvas와 동일
- 매 draw에서 새 `getCurrentTexture()` 사용
- 플레이 밖에서는 숨김 또는 투명 clear

`DisplaySystem`에 `webgpu` surface type을 별도로 추가하며 `WebGLHandler`에는 등록하지 않는다.

### 8.2 overlay backdrop

현재 glass backdrop은 하위 canvas를 WebGL texture로 다시 캡처한다. WebGPU canvas를 같은 프레임 source로 가져오면 API 간 copy/stall이 생길 수 있다.

1. 최초 통합은 `includeInComposite: false`로 시작한다.
2. 별도 NW.js 시각 테스트에서 WebGPU canvas 캡처 가능 여부와 GPU stall을 측정한다.
3. 통과하면 overlay snapshot에 포함한다.
4. 실패하면 glass가 열린 동안의 대체 합성 정책을 별도 결정하며, 동기 readback으로 우회하지 않는다.

### 8.3 렌더 정책

`strict-interpolation`:

```wgsl
renderPosition = mix(previousPosition, currentPosition, fixedAlpha);
```

`reference-clock-extrapolation`:

```wgsl
let predictDt = reference_render_time - simulation_time;
renderPosition = currentPosition + velocity * predictDt;
```

이 profile의 clock/frame-id 갱신과 시간 단위는 원본 trace를 그대로 재현한다. 원본의 정상 frame 구간을 비교하는 reference 진단 profile과 production safety guard를 구분해 기록한다.

`capped-accumulator-extrapolation`:

```wgsl
let predictDt = clamp(fixedAlpha * fixedDt, 0.0, fixedDt);
renderPosition = currentPosition + velocity * predictDt;
```

spawn/teleport/reset에서는 current와 previous를 같은 값으로 맞추고 예측에 사용할 속도를 명시적으로 초기화한다. 급격한 충돌·넉백·경로 전환에서 외삽 오차를 측정하며, 외삽은 절대로 authoritative position을 수정하지 않는다.

외삽 profile을 기본 계약으로 채택하면 구현 완료 시 `AGENT_GUIDE.md`와 core architecture guide의 durable render-time 계약을 함께 갱신한다.

## 9. 단계별 구현 순서

### Phase 0 — 기준선과 WebGPU 런타임 스파이크

목적: 제품 코드에 GPU 물리를 연결하기 전에 배포 런타임이 필요한 기능과 합성 방식을 실제로 지원하는지 확인한다.

작업:

- NW.js 전용 capability runner 추가
- `process.versions.nw/chrome`, protocol, `isSecureContext`, `navigator.gpu` 기록
- adapter/device 획득과 limits/features 기록
- storage buffer write/read, atomic, 256-thread workgroup smoke test
- `dispatchWorkgroupsIndirect()` / `drawIndirect()` smoke test
- 필요한 world texture format 생성·storage write·sample test
- 투명 WebGPU canvas를 기존 WebGL canvas 사이에 합성
- resize/renderScale/DPR와 overlay backdrop 캡처 확인
- `device.destroy()`를 이용한 loss/recreate 경로 확인
- GPU 이식 전 CPU benchmark의 fixed tick/s, debt, p95/p99 기준선 저장
- versioned benchmark fixture schema와 content-hash 검증 도구 정의

필수 probe limits:

- `maxBufferSize`, `maxStorageBufferBindingSize`
- `maxStorageBuffersPerShaderStage`, `maxStorageTexturesPerShaderStage`
- `maxBindGroups`, `maxBindingsPerBindGroup`
- `maxComputeWorkgroupSizeX`, `maxComputeInvocationsPerWorkgroup`
- `maxComputeWorkgroupsPerDimension`, `maxComputeWorkgroupStorageSize`
- `maxTextureDimension2D`, storage/uniform alignment

mixed-body contact bind layout은 compute stage에서 storage buffer 9개를 사용한다. adapter가 `maxStorageBuffersPerShaderStage >= 9`인지 capability 단계에서 확인하고, device 생성 시에도 `requiredLimits.maxStorageBuffersPerShaderStage = 9`를 명시해야 한다. adapter가 더 높은 값을 지원하더라도 명시하지 않으면 Chromium 기본 device limit 8로 생성될 수 있으며 pipeline validation이 실패한다. 이 협상은 app-lifetime `WebGpuPlatformService` 책임이고 ingame session이 임의로 device를 다시 요청하지 않는다.

최종 NW.js 실기에서는 NVIDIA Lovelace adapter가 `maxStorageBuffersPerShaderStage=10`을 보고했고 device를 명시적으로 `9`로 요청했다. physics/body-contact/world-contact/contact-handling compute layout의 storage-buffer 수 `8/9/7/9`가 모두 validation을 통과했고 `uncapturedErrorCount=0`이었다. 기존 physics/SDF/flow/render/stable-slot/fault/sparse/overflow probe도 모두 PASS를 유지했다.

통과 조건:

- 제품용 강제 Chromium flag 없이 GPU adapter/device 획득
- compute/atomic/indirect compute/indirect draw 모두 성공
- contact pipeline의 9-storage-buffer bind layout이 negotiated device limit에서 validation 성공
- 투명 레이어 순서와 premultiplied alpha가 pixel test와 일치
- resize 후 world state 손실 없이 다시 그림
- capability 실패가 예외 루프 없이 wave 비활성 또는 명시적 terminal reason으로 귀결. CPU enemy backend 자동 선택은 Phase 9 후속 목표

실패 시: GPU gameplay cutover를 중단하고 CPU/WASM 경로만 유지한다. `--enable-unsafe-webgpu`, `--ignore-gpu-blocklist`는 진단용으로만 사용하며 제품 설정에 넣지 않는다.

### Phase 1 — 세션 entity/backend 계약

목적: GPU 배열 index가 gameplay entity identity가 되지 않도록 먼저 소유권을 고정한다.

작업:

- `WorldRegistry`의 ID + incarnation handle
- session/device generation을 포함한 command/event key
- 일반 원형 적의 spawn/despawn record
- `EnemySimulationBackend` 계약
- small-N `CpuEnemySimulation` 또는 Float32 reference oracle
- backend 선택 결과와 capability reason 노출
- command/event source tick 및 sequence 계약
- GPU submission/readback의 `completedThroughTick` watermark와 GPU 의존 gameplay commit timeline
- empty-event completion record와 overflow 시 watermark 정지 정책
- 고정 개수 readback slot의 lease/free 상태와 backpressure/pause 정책
- watermark 이하 정렬 commit, dedup, stale generation 폐기, late-event 오류 정책

통과 조건:

- pooled handle 재사용 시 stale command/event 거부
- out-of-order/중복 readback에서도 watermark 이하 event만 source 순서로 exactly-once commit
- slot을 인위적으로 지연해도 lease 중 overwrite·무한 ring growth·silent drop 0
- free slot 고갈 시 정해진 `inFlightTicks/readbackAge` 한계에서 안전 pause하고 watermark를 거짓 전진시키지 않음
- scene 재진입/device generation 변경 뒤 이전 event가 Core/wave/registry를 변경하지 않음
- GPU 결과가 확정되지 않은 tick의 arrival/wave-clear 판정 보류
- CPU backend로 1개 적 spawn → 이동 → remove 수직 슬라이스
- scene destroy/re-enter에서 중복 tick/draw/listener 없음

### Phase 2 — WebGPU 플랫폼/레이어 통합

목적: 앱 수명 device와 세션 수명 stateful resource를 분리한다.

작업:

- `DisplaySystem` 소유 `WebGpuPlatformService`
- 정적 `gpu-object` canvas와 descriptor
- Loading/System 초기화 중 non-fatal capability probe와 pipeline prewarm
- `createGameSceneDependencies()`의 `gpuPlatformPort`
- device generation cache와 `device.lost` 처리
- resize/content revision/show/hide lifecycle

통과 조건:

- title/benchmark pixel output 불변
- play enter/destroy 100회 후 canvas/device listener와 GPU session resource 증가 없음
- WebGPU 불가 환경에서 기존 초기화와 title 진입 성공

### Phase 3 — 한 바디 vertical slice

목적: CPU 생성 → GPU integrate → GPU 직접 렌더 → 비동기 검증을 가장 작은 상태로 연결한다.

작업:

- ABI packer/layout test
- counts/physics/simulation/temporary/addition buffer
- addition과 indirect dispatch 갱신 WGSL
- `integrate`, `update velocity`, `finalize`의 최소 포트
- draw indirect와 원/quad 인스턴스 vertex shader
- 구성으로 고정한 개수의 staging buffer readback ring과 slot lease state machine

통과 조건:

- 초기 위치/속도 sentinel이 GPU round trip과 byte 단위 일치
- 1, 10, 1,000 body의 600 tick Float32 oracle 오차가 승인 tolerance 이내
- fixed tick이 한 render frame에 0/1/2회일 때 최종 상태와 render 위치 정확
- fixed/update/draw에 `mapAsync`/`onSubmittedWorkDone` await 없음
- 느린/역순 `mapAsync` 완료를 주입해도 lease 중 slot 재사용, event overwrite, silent drop 0
- free slot 고갈 시 backpressure telemetry와 안전 pause가 재현됨

### Phase 4 — SDF와 기존 route-stage flow의 GPU 연결

목적: CirVivor의 기존 경로 생성 결과를 보존하면서 참고 게임의 GPU sample·속도 조향을 적용한다.

현재 상태: SDF, immutable route atlas, GPU upload/sample/steering/stage rollback과 production wave의 live enemy route 연결까지 구현·검증 완료. arrival event/10k fixture만 후속이다.

작업:

- `TileMap.navigationGrid.blocked` 기반 source-compatible SDF snapshot 생성 및 업로드
- 기존 JS/WASM flow producer의 immutable stage-plane snapshot API
- route-stage direction plane atlas upload와 content/version cache
- body별 field index/waypoint progress
- 원본 integrate의 nearest-cell flow sample, 방향 normalize, 목표 속도 mix, speed clamp
- field debug visualization과 numeric dump
- 원본 이동 자료와 production map snapshot으로 `normal-10k-v1` fixture 값 동결

통과 조건:

- [7. 맵, SDF, 기존 flow field의 GPU 연결](#7-맵-sdf-기존-flow-field의-gpu-연결)의 route 조건 모두 충족
- JS/WASM snapshot의 방향 plane과 GPU nearest-cell sample 일치
- channel/orientation/texel-center golden에서 SDF blocked 음수 및 flow 방향 일치
- field는 map setup에서만 생성되고 resize/zoom에 재생성되지 않음

### Phase 5 — 균일 그리드와 6회 물리 solver

목적: 참고 게임의 대량 적 분리 성능과 접촉 감각을 재현한다.

작업:

- clear/build grid WGSL
- 일반 바디 9-cell candidate scan
- 큰/고정 proxy 별도 경로
- per-cell occupancy/max/overflow telemetry
- clear/apply delta
- body/body compliance 식
- SDF world solve
- corrected position 기반 velocity rebuild와 finalize

검증 장면:

- 2 body 정면 overlap
- 서로 다른 inverse mass
- 3/16/64 body 압축
- 셀 경계와 월드 모서리
- 좁은 6-tile corridor의 양방향 밀집 흐름
- 10,000 body 이동/정지/집중 spawn
- cell cap을 의도적으로 넘는 overflow stress

통과 조건:

- `normal-10k-v1` fixture에서 overflow 0
- stress overflow는 count/event로 관측되고 OOB 접근 없음
- NaN/Infinity body 0
- solver correction이 previous position을 수정하지 않음
- 원본 6회 solver profile 후 residual penetration 기준 충족
- 그리드 rebuild는 기본 profile에서 tick당 정확히 1회

### Phase 6 — 원본 render clock/외삽과 시각 통합

목적: 물리 tick과 render frame 사이의 참고 게임 감각을 재현한다.

현재 상태: 세 presentation profile과 pause epoch 동기화가 구현됐다. `module/scene/benchmark/BenchmarkScene`은 자동 wave가 없는 실제 child `GameScene`을 실행하고, `Spawn 100 Enemies`와 중앙 방사형 `Spawn 10 Projectiles`를 frame-boundary command drain에서 같은 endpoint의 다음 fixed tick에 예약한다. strict/reference/capped 선택은 현재 body를 유지하는 live 변경이 아니라 child session을 tick 0부터 다시 만드는 reset이다. GPU HUD는 registry kind별 enemy/projectile active count와 backend contact/applied/death, overflow, submitted/completed watermark, recovery와 batch 결과를 optional-safe하게 표시한다. CPU player/box/profiler는 유지하지만 CPU projectile 배열은 비어 있다. initial wall/box는 GPU SDF에 있고 dynamic Spawn Box는 CPU-only다. NW contact hardware smoke는 통과했고 실제 플레이 화면의 수동 승인이 남았다.

작업:

- strict interpolation, reference-clock extrapolation, capped-accumulator extrapolation 구현
- 원본의 simulation/render clock과 last-rendered-frame presentation state 포트
- 카메라/viewport uniform
- spawn/teleport/collision/급회전/넉백 reset 규칙
- WebGPU canvas layer/golden/overlay 검증
- 30/60/120/144Hz 및 불규칙 frame pacing 비교
- 동일 source trace의 30/60/120Hz render position differential 비교
- benchmark manual GPU enemy/projectile batch, session 재시작과 strict/reference/capped reset UI
- 전체 body readback 없는 kind별 active/contact/event/overflow/watermark/recovery HUD와 CPU 보조 player/box/profiler controls

통과 조건:

- alpha `0/0.5/1` strict interpolation 수치 정확
- reference-clock profile의 clock/frame-id와 render position이 원본 trace tolerance 이내
- capped-accumulator profile의 `predictDt`가 항상 `[0, fixedDt]`
- pause/step/resume 후 과도한 예측 없음
- Tower/Core와 GPU 적 사이의 상대 위치 오차가 승인 범위 이내
- resize/DPR/renderScale/zoom이 physics/route state를 변경하지 않음
- 선택한 extrapolation profile의 source-trace/시각 QA가 strict interpolation보다 우수하고 wall overshoot 기준을 통과할 때만 기본 전환

### Phase 7 — stable-slot lifecycle과 production capacity

목적: 장시간 wave에서 stable-slot spawn/death/removal을 안정화하고, exact dense parity가 필요할 때만 별도 compaction 경계를 정의한다.

현재 상태: fixed-capacity stable-slot/free-list 경계, identity ABI, tombstone hole 제외, tail 축소, partial upload, stale-incarnation 거부, 실제 `WorldRegistry`와 fixed command owner를 구현했다. GPU immediate death hide와 exact-identity event를 통한 CPU next-fixed despawn/slot reclamation도 이 경계에 연결했다. Node contract와 실제 NW contact cleanup smoke는 통과했다. endpoint fixture에서 enemy/projectile `1/1`이 exact death event 뒤 next-fixed cleanup으로 `0/0`이 됐으며, 장시간 churn은 진행 중이다. 원본 dense compaction은 exact parity를 선택할 때만 후속이다.

작업:

- stable-slot 장기 churn과 death/readback 지연 중 slot 재사용 방지
- exact dense parity가 제품 목표가 될 때만 원본 `handle_dead → removal → sort_types`, tick 말미 addition, relocation event 포트
- batch spawn rejection와 capacity telemetry
- safe-boundary capacity growth
- selected-body/debug-only position readback

통과 조건:

- 반복 spawn/remove 1,000,000회에서 stale identity 및 누수 0
- swap/compaction 후 entity ID/incarnation 불변
- capacity 초과가 명시적으로 보고되고 기존 body 손상 없음
- readback staging buffer가 고정 개수로 재사용됨

### Phase 8 — contact/gameplay event 이식

목적: 물리 solver와 gameplay contact를 분리한 채 참고 구현의 대량 접촉 처리까지 확장한다.

현재 상태: ABI v3의 reciprocal physical/interaction pair와 별도 gameplay-team word, enter-only/continuous/closest/terrain policy, penetration 선예약/refund, typed damage/interaction applied event, canonical finite-lifetime death, bounded counted readback, exact generation/identity/watermark, immediate hide→next-fixed cleanup 수직 슬라이스의 Node 계약과 실제 NW hardware smoke를 통과했다. default damage matrix는 PLAYER→HOSTILE/HOSTILE→PLAYER만 허용하고 PLAYER→PLAYER/HOSTILE→HOSTILE/NEUTRAL→PLAYER/PLAYER→NEUTRAL은 HP·penetration·death/DAMAGE_APPLIED 소비 없이 non-damage interaction만 유지한다. NVIDIA Lovelace 실제 fixture에서 여섯 조합의 exact identity, gameplay meta, 무변위와 기존 Core enter/terrain kill을 함께 확인했고 `uncapturedErrorCount=0`이었다. 기존 direct mixed fixture는 authored enemy `health/damageOther=0.57`, projectile `health/damageSelf=0.29`에서 `DAMAGE_APPLIED=1`, `damageFixedPoint=57`/`damage=0.57`, exact `death=2`, `alive=0`, `sourceTick=completedThroughTick=37`을 유지한다. Phase 5는 primary LMB Basic Bullet producer와 source-relative aim, damage/terrain/lifetime/direct-render, pressure/rebind closure까지 완료했다. Core gameplay consumer와 장시간 stress는 진행 중이다.

작업:

- body/body/body-world/closest/terrain/death 경로의 장시간 readback/overflow stress
- Core arrival event와 CPU CombatResolver/Core Integrity/kill/reward/wave command로 변환
- primary Basic Bullet producer는 완료. 후속 Word/ability weapon producer를 같은 adapter seam에 연결
- swept CCD 필요성 결정과 고속 tunneling fixture
- 같은 event의 exactly-once commit 및 overflow recovery 장시간 stress 검증

통과 조건:

- 물리 보정 결과와 gameplay 접촉 결과의 책임 분리
- event overflow 0인 target workload
- readback 지연이 있어도 source tick/sequence 순서 보존
- out-of-order/중복/late/stale-generation event 정책 검증
- Core damage, kill, wave completion이 정확히 한 번 commit
- GPU failure 시 미완료 event를 stale state에 적용하지 않음
- GPU death가 즉시 숨고 registry/slot은 exact event 뒤 다음 fixed 경계에서 한 번만 제거

### Phase 9 — rollout과 최적화

작업:

- 개발용 `cpu | gpu | dual-compare` backend 선택
- capability 기반 production 자동 선택
- GPU pass timing(`timestamp-query` 지원 시)과 CPU profiler 통합
- 10k/25k/50k benchmark 시나리오 자동화
- reference profile을 보존한 상태에서만 workgroup/bind group/memory 최적화
- 최종 visual QA와 hardware matrix

cutover 조건은 [12. 완료 기준](#12-완료-기준)을 모두 만족하는 것이다.

## 10. 테스트와 계측 계획

### 10.1 기존 회귀 게이트

`project/`에서 실행한다.

```text
npm test
npm run check:wasm:flow-field
npm run check:wasm:collision-contact
npm run test:wasm:flow-field:stress
npm run benchmark:wasm:flow-field
npm run benchmark:wasm:collision-contact
npm run test:render:golden
```

기존 중요 계약:

- `ingame_tower_control.test.mjs`: previous/current 보존, tile correction, camera follow
- `ingame_tile_map.test.mjs`: world projection과 resize
- `enemy_render_interpolation.test.mjs`: solver correction과 render history
- `fixed_step_catch_up_policy.test.mjs`: fixed debt 정책
- `release_simulation_profiler.test.mjs`: 실제 fixed tick/s, dropped debt, p95/p99
- `webgl_*` tests: 기존 WebGL clear/flush/state 불변

### 10.2 신규 자동 테스트

- `webgpu_capability` NW runner
- ABI/layout/packer unit test
- WGSL shader compilation/validation test
- single-body integrate differential test
- flow/SDF numeric golden test
- grid occupancy/overflow test
- 2-body/dense solver invariant test
- stable handle/compaction test
- 실제 GPU stable-slot 재사용에서 survivor 위치 비재업로드, stale incarnation 거부, all-despawn 뒤 pre-tick device generation 재생성 test
- overflow tick의 position과 `flowFieldIndex` 동시 rollback test
- multi-fixed-step render state test
- strict interpolation/reference-clock/capped-accumulator extrapolation test
- device loss/recreate test
- play enter/destroy resource lifecycle test
- public endpoint next-fixed mutation/status/idempotent teardown와 pending `N + 1` submit 중 `N + 2` lifecycle 예약 통합 test
- generic/legacy endpoint alias와 mixed enemy/projectile lifecycle test
- data-driven projectile intent gameplay-unit damage/health와 ABI single-scale test
- contact order, previous-overlap, closest/terrain, penetration reserve/refund, interaction-radius/grid clamp, deterministic zero-distance normal test
- bounded counted event ring, exact identity, watermark, overflow/backpressure/recovery와 immediate-hide/next-fixed cleanup test
- fixed primitive ABI binary fixture, bounded command/history replay/conflict/capacity test
- CPU Tower 1/60 controlled movement Float32 oracle와 600-tick tolerance test
- 4-slot x 32-byte tracked pose saturation/out-of-order/generation/idle-release test
- SpawnProgram validate/resolve/source-invalid/target-invalid/source+target ABA/zero-partial/result-ring test
- benchmark wave-disabled child `GameScene`, Spawn 100/10 next-fixed same-endpoint request, CPU enemy/projectile 부재, auxiliary isolation, profile restart lifecycle test
- benchmark 10-projectile radial geometry, stable session/batch/spawn command ID, zero-partial capacity preflight와 mixed-body HUD test
- hard-recovery 뒤 선택 presentation profile 보존 test
- WebGPU/WebGL/2D canvas order visual golden
- 10k/25k/50k release benchmark
- versioned normal/overflow benchmark fixture schema와 hash 검증

### 10.3 고정 벤치마크 fixture

성능 숫자는 임의의 현재 장면이 아니라 versioned fixture에서만 승인한다. Phase 0에서 schema를 만들고, 원본 이동 데이터와 production map 계약이 확보되는 Phase 4에서 `normal-10k-v1`의 값을 동결한다. fixture 변경은 기존 파일을 덮지 않고 새 ID/version으로 추가한다.

각 fixture는 다음을 직렬화하고 content hash를 기록한다.

- map snapshot ID/data/hash, world bounds와 corridor 폭
- RNG algorithm/seed
- body 수, radius/mass/speed/status 분포
- gate별 spawn 수·순서·tick schedule과 route mix
- Tower/Core proxy 위치·크기·scripted motion/input
- solver/grid/cell-cap/physics profile 설정
- warmup tick/초와 정확히 120초인 측정 구간
- NW/Chromium build, adapter/device/driver와 render frame schedule

최소 두 fixture를 분리한다.

- `normal-10k-v1`: production 대표 분포. grid/event overflow 0과 성능·정확도 승인을 모두 요구한다.
- `concentrated-overflow-v1`: 같은 cell 또는 좁은 spawn 영역에 cap 초과를 의도한다. overflow 검출, backpressure와 memory safety를 검증하며 normal 성능 승인에 섞지 않는다.

### 10.4 필수 telemetry

- active/addition/removal body count
- GPU capacity와 사용률
- cell 평균/최대 occupancy와 overflow count
- candidate 검사 수와 residual penetration sample
- contact/applied/death count와 각각의 overflow, readback age(ticks)
- event submitted tick와 contiguous completed-through watermark
- staging slot free/leased count와 in-flight tick 수
- compute pass별 GPU time(지원 시)
- CPU submit/encode time
- actual fixed ticks/s, dropped debt, fixed/frame p50/p95/p99
- adapter/device generation, capability/fallback reason
- device loss/recovery count

FPS만으로 승인하지 않는다.

## 11. 성능·정확도 승인 기준

최종 숫자는 Phase 0에서 기록한 target hardware profile 및 [고정 벤치마크 fixture](#103-고정-벤치마크-fixture)의 ID/hash와 함께 저장한다. fixture가 동결되지 않았거나 hash가 다르면 승인 숫자로 사용하지 않는다. 최소 목표는 다음과 같다.

### 11.1 `normal-10k-v1` 기준

- 120초 측정에서 실제 fixed tick 평균 `≥ 59/s`
- warmup 이후 dropped fixed step `0`
- fixture에 고정된 normal scenario grid/event overflow `0`
- GPU compute p95가 fixed budget `16.67ms` 안에 있고 다른 시스템 예산을 남김
- CPU fixed encode/submit p95가 GPU 이전 CPU collision 기준보다 유의하게 낮음
- 프레임마다 body 전체 readback `0 byte`
- GPU memory가 wave 반복 후 기준치로 복귀하고 지속 증가 없음

### 11.2 정확도

- single body/flow integration은 Float32 oracle과 누적 tolerance 이내
- spawn/teleport에서 previous/current가 같은 값
- solver correction은 current/predicted만 변경
- route stage 순서와 도착 event 100% 일치
- normal density에서 NaN, world escape, missed collision 0
- overflow stress는 결과 저하가 관측 가능하며 memory safety를 유지
- strict interpolation은 alpha별 수치 일치
- 선택한 extrapolation profile은 source clock trace, wall/corner overshoot와 pause stall 기준 통과

정확한 epsilon과 residual penetration 비율은 Phase 3/5 golden 생성 시 body radius와 world unit 기준으로 고정한다. 임의로 테스트 tolerance를 넓혀 통과시키지 않는다.

## 12. 완료 기준

다음을 모두 충족해야 GPU 이식 완료로 본다.

- 신규 플레이의 일반 적 이동·flow field·적-적 분리·지형 충돌이 WebGPU에서 실행됨
- 참고 구현의 pass 순서와 6회 solver reference profile이 추적 가능함
- GPU body buffer를 직접 읽어 한 번의 indirect draw로 렌더함
- 고정 tick 외에는 gameplay state를 변경하지 않음
- 매 frame 동기 readback이 없음
- GPU 의존 gameplay가 completion watermark에 따라 순서대로 exactly-once commit됨
- enemy/projectile이 같은 endpoint/session/grid에서 충돌하고 GPU death hide→CPU next-fixed cleanup이 실기에서 검증됨
- authored route가 crossing에서 보존됨
- CPU fallback과 GPU 선택 사유가 명시적임
- device loss와 scene destroy 정책이 검증됨
- 10,000 적 성능 기준과 기존 회귀 테스트를 통과함
- reference-clock 또는 capped-accumulator extrapolation 채택 여부가 수치·시각 증거로 결정됨
- 합의된 stable-slot contact/lifecycle adaptation의 NW hardware smoke PASS가 기록되고 실제 weapon/Core owner 연결이 완료됨
- 구조/시간/소유권 계약 변경을 관련 guide에 반영함

## 13. 실패·폴백·롤백 정책

### capability 실패

현재 production은 `GameSystem.enter()`에서 capability snapshot으로 mode를 고정한다. 최초 비지원이면 `CPU_NO_WAVE_FALLBACK`이 기존 CPU Tower/Core를 소유하고 GPU gameplay request를 만들지 않는다. ready session은 `GPU_WORLD`로 고정되며 이후 device loss를 이유로 CPU Tower를 hot-resume하지 않는다. GPU 일부 초기화 후 조용히 CPU/GPU 혼합 실행하지 않는다.

### shader/pipeline/ABI 실패

해당 process에서는 GPU backend를 비활성화하고 원인을 기록한다. 일부 pass만 CPU로 왕복하는 hybrid fallback은 사용하지 않는다.

### device loss

GPU가 authoritative position을 잃은 뒤 stale CPU 값으로 mid-wave를 계속하지 않는다.

1. 새 submit과 event commit 중지
2. GPU canvas 투명 clear
3. 현재 wave를 안전 pause
4. adapter/device와 device-generation cache 재생성 시도
5. 성공 시 마지막 안전한 wave/checkpoint 경계에서 세션 재구축
6. 실패 시 CPU backend로 새 세션을 시작하거나 명시적 오류 처리

mid-wave 즉시 CPU 전환이 필요하다면 별도의 authoritative checkpoint/command log 설계를 먼저 승인해야 한다.

### readback backpressure/event overflow

free staging slot이나 event capacity가 없으면 slot을 덮어쓰거나 ring을 늘리지 않는다. 정해진 `inFlightTicks/readbackAge` 한계 전에는 신규 event-producing submit을 보류하고, 한계를 넘으면 다음 안전 fixed 경계에서 GPU 의존 gameplay/session을 pause한다. watermark는 마지막으로 누락 없이 commit 가능한 tick에 고정한다. 현재 session을 정확히 재개할 수 없으면 마지막 안전 checkpoint에서 재구축하거나 명시적으로 새 세션을 시작한다.

현재 구현된 collision-grid overflow telemetry는 미래 gameplay event ring과 구분한다. 셀 cap을 넘은 tick은 WGSL에서 즉시 이전 authoritative 위치와 `flowFieldIndex`로 rollback하고 finalize를 건너뛴다. current/누적 sticky counter는 4개의 고정 readback slot으로 최대 4 tick 간격에 샘플링하며, 모든 slot이 지연돼도 최대 60 tick까지만 계속한다. 실제 overflow 관측은 `overflow-degraded`와 authoritative rebuild를 요구한다. staging slot 지연은 `telemetry-backpressure`에서 physics를 잠시 멈추고 slot이 반환되면 같은 GPU state로 재개하며, readback 자체가 실패해 권위를 보장할 수 없을 때만 rebuild로 승격한다. 적 submit이 멈춘 동안 `GameObjectSystem`은 Tower fixed 적분과 GPU presentation clock도 함께 정지시켜 물리 없이 외삽만 진행하지 않게 한다.

### 성능 미달

reference profile을 보존한 채 pass별 계측으로 병목을 찾는다. 그리드 cap 축소, solver 반복 감소, 충돌 생략을 첫 대응으로 사용하지 않는다. 먼저 다음을 검토한다.

- pass별 bind group 최소화
- shader/pipeline cache
- command encoder batching
- 불필요한 buffer copy/readback 제거
- field/map resource 재사용
- workgroup size의 adapter별 측정
- grid cell 크기와 body 반지름 분포의 데이터 기반 조정

## 14. 추가로 필요한 소스와 계약

### 14.1 실제 플레이 연결에 확정한 CirVivor 코드/계약

이번 수직 슬라이스에서 다음 CirVivor 권한을 새로 확정했다.

- `basic_square_01`, `basic_triangle_01`, `basic_arrow_01`, `basic_penta_01`, `basic_hexa_01`, `basic_gen_01`: 공통 타일 단위 circle-collider radius/speed, inverse-mass 입력, RGBA, render-only shape code와 GPU collision layer/mask의 production 데이터. `basic_circle_01`은 같은 절반 반경의 독립 legacy compatibility definition으로 ID lookup에는 남지만 main 6종 배열과 wave에서는 제외
- `WorldRegistry`: stable `entityId + incarnation` 예약·활성·취소·제거·조회 권한
- `EnemyLifecycleCommandOwner`: fixed 경계의 despawn→spawn batch와 capacity/업로드 실패 처리
- `GpuSimulationEndpoint`: backend·registry·lifecycle/fixed owner를 묶고 Tower/Core proxy/enemy/projectile이 같은 session/grid를 공유하는 facade. `GpuEnemySimulationEndpoint`는 legacy alias
- `GpuProjectileSpawnAdapter`: 무기 class와 무관한 absolute/source-relative velocity/aim-point/target-entity projectile request 경계. Target handle은 aim-only이며 Team/target policy와 독립
- `GpuPrimaryProjectileController`: semantic held primary-pointer와 exact Tower GPU handle을 Basic Bullet next-fixed aim request로 변환하고 commit된 shot에만 cooldown을 적용
- `corridor_eight_wave_01` 및 `WaveDirector`: 실제 Gate/Path에 대한 32-spawn/five-tick schedule. 단일 `enemyDefinitionId` schema를 유지하면서 seven-ID `enemyDefinitionIds`를 spawn index로 순환하고 phase/group/command identity를 보존
- `GameSystem.fixedTick`: selected mode의 GPU submit 또는 CPU fallback Tower step이 성공한 tick만 확정하는 세션 clock

기존 JS/WASM stage plane snapshot과 GPU field atlas, projectile contact 추출본을 사용한 stable-slot contact 경계까지 구현되어 현재 vertical slice에는 추가 원본 소스가 필요하지 않다. 외부 코드는 안정 import `ingame/gpu_simulation_endpoint.js`, canonical `GameScene.getGpuSimulationEndpoint()`와 `getNextGpuLifecycleFixedTick()`을 사용한다. enemy 이름 accessor는 호환 alias다. `EnemySimulationBackend.spawnBodies()`/`despawnBodies()`는 endpoint 내부 저수준 port이고, `replaceBodies()`는 최초 진입과 authoritative rebuild 전용이다.

후속 gameplay에서 별도로 확정할 항목은 Core raw enter의 damage/arrival consumer, kill/reward/wave owner, Word/Sentence/Skill weapon producer, GPU subject selector/child allocator, swept CCD 필요성, wave 처음부터가 아닌 mid-wave body 연속 복구에 필요한 authoritative checkpoint다. Tower/Core/primary Basic Bullet GPU World migration은 완료됐다.

### 14.2 선택 검증 — 원본 이동·경로 parity 자료

collision/presentation 이식에는 현재 추출본이면 충분하다. CirVivor의 실제 이동은 기존 JS/WASM flow-field 접근을 유지하므로 아래 원본 자료는 구현 blocker가 아니다. 나중에 원본 게임의 이동 감각까지 별도 비교하려 할 때만 유용하다.

- 실제 enemy archetype의 spawn radius, movement speed, mass, collision layer/mask, status 계수와 type별 분기 데이터
- `EnemySpawnerData` 전체 구조, 실제 wave resource 예시, gate/path 할당과 spawn jitter/seed 코드
- 원본 world/map generator의 입력 texture 또는 원본 data, 채널 의미, orientation, 원점/축/texel 좌표 계약
- path/goal 설정 코드, gateway/waypoint/Core 도달 반경과 stage 전환 판정
- fixed dt, solver iteration, damping/max-speed, SDF/flow texture scale 등 실제 physics/project settings
- 동일 seed로 10~600 tick 동안 기록한 body position/previous/velocity/field index/flow sample trace
- 같은 장면의 30/60/120Hz별 `simulation_time`, `render_time`, `last_rendered_frame`, 최종 render position trace
- 1-body 경로, 2-body 분리, dense corridor, wall corner 장면의 초기 조건과 결과 캡처

이 자료가 없으면 원본 이동 trajectory와 동일하다고 주장하지 않으며, 현재 CirVivor flow-field 계약의 테스트로 승인한다.

### 14.3 선택 자료 — exact dense lifecycle parity

body/body, body/world, closest filter, contact handle/mark/dead 의미는 `projectile_contact` 추출본으로 확보돼 현재 stable-slot vertical slice에 반영했다. 아래 원본 파일은 현재 blocker가 아니다. stable slot 대신 참고 게임과 같은 dense compaction/relocation까지 수치 parity 목표로 바꾸는 경우에만 필요하다.

```text
shaders/rigidbody/removal.glsl
shaders/rigidbody/sort_types.glsl
```

exact dense parity를 진행한다면 이 셰이더가 사용하는 CPU측 removal queue, dense relocation mapping, addition/removal ordering, kill event 소비 코드도 함께 확보한다. 현재는 exact-identity death event→CPU next-fixed despawn으로 안전하게 어댑트하므로 임의의 dense relocation을 추가하지 않는다.

`sort_removals.glsl`은 추출 오케스트레이터에서 dispatch되는 것이 확인되지 않았다. 실제 다른 caller가 사용한다면 그 caller와 셰이더를 함께 제공받아 순서를 확인한 뒤 포함한다.

### 14.4 의도적으로 제외한 원작 특수 producer

```text
shaders/rigidbody/build_laser_grid.glsl
shaders/rigidbody/contacts_body_laser.glsl
shaders/rigidbody/update_readback_grid.glsl
shaders/other/update_explosions.glsl
shaders/other/update_lightnings.glsl
shaders/rigidbody/draw_corpses.glsl
shaders/rigidbody/draw_fire.glsl
```

CirVivor의 무기는 다른 규칙으로 만들 예정이므로 laser, Tesla, fire, freeze, chaining과 참고 게임의 특수 addition producer를 그대로 포트하지 않는다. 위 자료는 exact laser/special parity를 별도 목표로 정할 때만 필요하며 일반 mixed-body/contact vertical slice에는 필수가 아니다.

## 15. 구현된 파일 경계와 후속 책임

현재 구현은 아래 책임 경계를 따른다.

### 변경된 기존 파일

- `project/game/index.html`: 정적 WebGPU canvas
- `project/game/style.css`: layer/z-index/pointer/alpha style
- `project/game/script/module/display/display_system.js`: WebGPU surface/device adapter
- `project/game/script/module/display/display_surface_descriptor.js`: `webgpu` surface type/order
- `project/game/script/module/system_handler.js`: capability prewarm/clear-draw lifecycle이 필요할 때만 최소 hook
- `project/game/script/module/scene/game/game_scene_dependency_factory.js`: `gpuPlatformPort`
- `project/game/script/module/ingame/game_system.js`: 성공한 session fixed tick 확정
- `project/game/script/module/ingame/object/game_object_system.js`: wave와 공개 GPU endpoint orchestration
- `project/game/script/module/scene/benchmark/_benchmark_scene.js`: wave-disabled child GameScene, GPU mixed-body controls, CPU player/box auxiliary orchestration
- `project/game/script/module/scene/game/_game_scene.js`: presentation profile 보존과 endpoint 노출

### 구현된 신규 책임

- `module/display/webgpu/`: adapter/device/canvas/pipeline generation
- `module/ingame/physics/gpu/`: ABI, buffers, compute orchestration, readback ring
- `module/ingame/physics/gpu/gpu_collision_shaders.js`: production WGSL pass source
- `module/ingame/physics/gpu/gpu_circle_body_simulation.js`: buffer/session/submit/readback owner
- `module/ingame/physics/gpu/gpu_fixed_primitive_abi.js`: body-control/tracked-pose ABI v1과 SpawnProgram ABI v3/80-byte exact source-target record
- `module/ingame/physics/gpu/gpu_collision_reference.js`: Float32 CPU oracle
- `module/ingame/navigation/route_flow_field_atlas.js`: 기존 JS/WASM route-stage plane의 immutable GPU atlas adapter
- `module/ingame/object/enemy/enemy_simulation_backend.js`: session adapter
- `module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js`: generic `GpuSimulationEndpoint`와 legacy enemy alias를 함께 제공하는 registry/lifecycle/backend session facade
- `module/ingame/object/gpu_fixed_command_owner.js`: bounded next-fixed control/SpawnProgram owner
- `module/ingame/object/gpu_spawn_intent.js`: generic canonical spawn normalization/registry metadata
- `module/ingame/gpu_simulation_endpoint.js`: gameplay용 안정 import/re-export 경계
- `module/ingame/object/world_registry.js`: CPU stable entity handle authority
- `module/ingame/object/enemy/enemy_lifecycle_command_owner.js`: next-fixed spawn/despawn commit owner
- `module/ingame/object/enemy/gpu_enemy_spawn_adapter.js`: production data→GPU body protocol adapter
- `module/ingame/object/projectile/gpu_projectile_spawn_adapter.js`: data-driven projectile definition/world-state→next-fixed mixed-body request adapter
- `module/ingame/object/projectile/gpu_primary_projectile_controller.js`: primary-pointer/LMB hold, commit-only cooldown, recovery rebind owner
- `data/object/projectile/basic_bullet_data.js`: production Basic Bullet speed/radius/damage/penetration/lifetime/render authority
- `module/ingame/flow/wave_director.js`: fixed tick spawn schedule compiler
- `data/object/enemy/basic_circle_enemy_data.js`: historical filename 아래의 six-archetype production GPU enemy catalog와 독립 legacy circle compatibility definition
- `data/scene/game/corridor_eight_wave_01_data.js`: exact seven-ID cycle과 Archer indexes/ticks를 갖는 단일-phase 32-spawn/five-tick spawn-only wave definition
- `module/scene/benchmark/commands/`: GPU enemy/projectile batch와 CPU player/box auxiliary command protocol/builder/apply 경계
- `module/scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js`: next-fixed public endpoint request, route/capacity/session identity 검증
- `module/scene/benchmark/gpu_benchmark_projectile_spawn_adapter.js`: 중앙 방사형 10발 fixture, next-fixed request, capacity/session/batch/spawn identity 검증
- `module/scene/benchmark/gpu_benchmark_player_proxy_spawn_adapter.js`: visible CPU player와 일치하는 hidden static body를 session당 한 번 next-fixed 예약
- `module/scene/benchmark/render/`, `update/`: registry/event status GPU QA HUD와 CPU player/box controls/render/update
- `project/game/test/nw_webgpu_capability/`: 실제 NW/WebGPU 검증 runner

### 후속 책임 후보

- Core arrival와 실제 weapon/kill/reward/wave event owner, authoritative checkpoint owner
- versioned 10k/overflow benchmark fixture

새 파일은 distinct responsibility와 실제 caller가 확인될 때만 만든다. `GameSystem`이나 domain code가 Display/DOM/WebGPU singleton을 직접 import하는 구조는 만들지 않는다.

## 16. 실행 순서 요약

```text
Phase 0 WebGPU 실기 스파이크 ────────── contact limit 9와 hardware smoke 완료
Phase 2 플랫폼/레이어 ───────────────── 완료
Phase 3 physics/render vertical slice ─ 완료
Phase 4 SDF + route-stage flow ──────── 기반 완료
Phase 5 grid + 6회 solver ───────────── 완료
Phase 6 render clock/외삽/pause hook ── 기반 완료
Phase 7 stable-slot lifecycle ───────── death next-fixed cleanup 계약 완료
Phase 1 WorldRegistry/fixed command ─── bounded event watermark 계약 완료
실제 enemy 1종/wave/route 연결 ─────── 완료
공개 mixed endpoint + GPU enemy/projectile benchmark ─ 완료
Phase 8 contact/death event ─────────── Node contract와 NW hardware smoke 완료
Tower/Core/Projectile migration 5/5 ─ production LMB/Basic Bullet, lifetime, pressure/rebind 완료
  → stable-slot/contact 장기 churn; exact dense parity는 선택 사항
  → benchmark scene에서 live mixed-body 수동 시각·10k fixture 승인
  → Core arrival/gameplay commit, Word/Skill producers와 swept CCD 결정
  → Phase 9 rollout/최적화
```

Tower/Core/Projectile migration Phase 5/5는 완료됐다. production primary-pointer/LMB는 exact
Tower GPU handle과 `requestSourceRelativeSpawn()`의 aim-point mode를 사용하며 tracked camera
pose를 projectile origin으로 사용하지 않는다. R1 Turn 3은 별도 target-entity mode의 exact
tick-start source→target aim과 normal target-invalid cleanup을 확정했다. R1 Turn 4는 data-authored
Archer/hostile Bullet/attack과 lifecycle-driven `HostileAttackDirector`를 추가했다. Director는 exact
Archer spawn/death만 관찰하고 deterministic phase/order/budget으로 living Tower를 target하며,
`resolved` completion에서만 cooldown을 소비한다. R1 Turn 5는 production corridor wave를
32-spawn/five-tick seven-ID cycle로 확정하고 Archer를 indexes `6/13/20/27`에 삽입했으며 minimum
Tower/Core runtime status를 연결했다. Core damage/arrival, Gold/reward, wave completion,
shop, Word/Sentence/Skill runtime, GPU subject selector/child allocator, benchmark 장시간 stress와
`normal-10k-v1` 승인은 각각 별도 gameplay/성능 작업으로 남는다.

## 17. 외부 기술 근거

- [NW.js 0.108.0 / Chromium 145 릴리스](https://nwjs.io/blog/v0.108.0/)
- [Chrome WebGPU 기본 지원 안내](https://developer.chrome.com/blog/webgpu-release)
- [WebGPU 명세](https://gpuweb.github.io/gpuweb/)
- [GPUWeb canvas 설명](https://gpuweb.github.io/gpuweb/explainer/)

버전상 WebGPU 사용 가능성이 높더라도 실제 제품 활성화 여부는 Phase 0의 `navigator.gpu`, secure context, adapter/device, limits, shader smoke test 결과로만 결정한다.
