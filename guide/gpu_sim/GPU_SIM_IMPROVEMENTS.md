# GPU Sim 개선 항목

## 평가 범위

복구된 GPU 시뮬레이션의 실행 의미를 기준으로 정리했다. 디컴파일 과정에서 바뀐 식별자와 코드 모양은 평가 대상에서 제외한다. 아래 항목은 원본 위험과 CirVivor adaptation 상태를 함께 기록한다. 현재 1~6과 bounded event readback 계약은 코드와 Node contract test에 반영됐고 실제 NW.js contact hardware smoke도 통과했다. 10k, 장시간 stress와 수동 시각 승인은 진행 중이다.

## P1: 우선 수정

### 1. 그리드 카운트를 저장 용량으로 제한한다 — 반영

[build_grid.glsl](gpu_physics/source/shaders/rigidbody/build_grid.glsl)은 `atomicAdd`로 셀 카운트를 증가시킨 뒤 64개를 넘은 항목의 저장만 생략한다. 따라서 카운터 자체는 64보다 커질 수 있다. 그런데 다음 소비 경로 일부는 이 값을 clamp하지 않고 순회한다.

- 큰 바디 솔버: [solve_body_body.glsl](gpu_physics/source/shaders/rigidbody/solve_body_body.glsl)
- 큰 바디 접촉: [contacts_big_body_body.glsl](projectile_contact/source/shaders/rigidbody/contacts_big_body_body.glsl)
- 레이저 접촉: 원본 `shaders/rigidbody/contacts_body_laser.glsl`

CirVivor의 body/contact 경로는 모든 소비 지점에서 `min(raw_count, capacity)`를 사용하고 초과 횟수를 별도 telemetry로 기록한다. overflow tick은 부분 결과를 계속 사용하지 않고 authoritative rollback/recovery 경계로 승격한다. 레이저 경로는 현재 포트하지 않았으므로 원본 laser parity를 요구할 때 같은 clamp를 별도로 적용한다.

### 2. 매 그리드 구축 전에 `grid_index = -1`로 초기화한다 — 반영

[build_grid.glsl](gpu_physics/source/shaders/rigidbody/build_grid.glsl)은 월드 밖이거나 셀이 가득 차면 성공 인덱스를 기록하기 전에 반환한다. 이때 이전 틱의 `grid_index`가 남을 수 있고, [apply_deltas.glsl](gpu_physics/source/shaders/rigidbody/apply_deltas.glsl)이 그 낡은 슬롯에 새 위치를 쓴다.

CirVivor는 다음 두 가지를 적용했다.

1. `build_grid` 시작 시 현재 바디의 `grid_index`를 무조건 `-1`로 설정한다.
2. 삽입 성공 후에만 실제 인덱스를 기록한다. 디버그 빌드에서는 적용 전에 슬롯의 `body_id`도 검증한다.

### 3. counted readback의 헤더 공간을 별도로 할당한다 — 반영

[gpu.gd](gpu_physics/source/gpu_sim/gpu.gd)의 `ReadbackBuffer`는 링 슬롯을 `element_stride × element_count`로 잡는다. 하지만 사망 리드백은 같은 슬롯의 첫 16바이트를 카운터로 사용하면서 1,024개 요소까지 기록한다. 현재 배치에서는 실질 데이터 용량이 1,023개라 마지막 기록이 다음 슬롯 또는 버퍼 끝을 침범한다.

슬롯 크기를 아래처럼 분리하고 CPU에서 읽는 개수도 반드시 clamp한다.

```text
slot_size = aligned_count_header + element_stride × element_capacity
read_count = min(raw_count, element_capacity)
```

CirVivor contact/applied/death readback은 이 layout의 고정 크기 slot을 bounded ring으로 lease한다. dedupe key `(sessionGeneration, deviceGeneration, entityId, incarnation, sourceTick, sequence, type)`를 보존하고, 모든 event와 completion record가 확인된 연속 `completedThroughTick`까지만 CPU commit한다. overflow·불완전 batch·lease age 초과 시 watermark를 전진시키지 않으며 overwrite, silent drop, frame-path ring 증설을 금지한다. 마지막 body의 일반 despawn도 pending readback/0-event completion이 있으면 epoch/resource release를 보류하며, drain 전 respawn은 같은 epoch를 이어가고 contiguous drain 뒤 watermark를 보존해 idle release한다.

## P2: 판정 정확도

### 4. 투사체 관통 횟수를 피해보다 먼저 예약한다 — 반영

[contacts_body_body.glsl](projectile_contact/source/shaders/rigidbody/contacts_body_body.glsl)은 일반 투사체와 겹친 모든 적의 접촉을 생성한다. [handle_contacts.glsl](projectile_contact/source/shaders/rigidbody/handle_contacts.glsl)은 적에게 먼저 피해를 주고 나중에 투사체 체력을 차감한다. 병렬 접촉이 동시에 실행되므로 관통력 1인 총알도 같은 틱에 여러 적을 공격할 수 있다.

CirVivor는 `damage_self > 0`인 접촉에서 projectile health budget을 atomic으로 먼저 예약하고 성공한 invocation만 target 피해를 처리한다. target identity가 stale하거나 실제 피해가 적용되지 않은 경우 예약을 refund한다. gameplay intent는 `penetration`, `damageSelf`, `damageOther`를 원 단위 f32로 보존하고 host/WGSL 모두 `f32(value) × f32(100) → f32 → trunc`로 한 번만 변환한다. 따라서 `0.29/0.57/1.15`는 `29/57/115`다.

### 5. 작은 바디 판정 기준을 상호작용 반경으로 정한다 — 반영

현재는 반경이 셀 크기 12보다 작으면 중심 셀 하나에만 저장한다. 하지만 완전한 3×3 검색 조건은 대략 다음과 같다.

```text
self_radius + maximum_target_radius <= cell_width
```

적 최대 반경은 4이고 폭발 오크의 기본 폭발 반경은 10이므로 합이 14다. CirVivor는 단순 self radius 대신 `self_radius + maximum_interaction_target_radius`로 small/big grid 경로를 분류한다. raw cell count는 어느 경로에서도 저장 cap을 넘겨 순회하지 않는다.

### 6. 동일 좌표에서 ID 기반 분리 방향을 만든다 — 반영

[solve_body_body.glsl](gpu_physics/source/shaders/rigidbody/solve_body_body.glsl)은 거리가 0일 때 고정된 `+X` normal을 사용한다. 동일 질량의 두 바디가 같은 방향으로 이동해 계속 겹칠 수 있고, 큰 바디 분기는 침투량이 0이 된다.

CirVivor는 exact body identity에서 결정한 normal을 사용해 pair 순서를 뒤집으면 정확히 반대가 되게 하고, 거리 0일 때도 침투량을 `radius_a + radius_b`로 유지한다.

## P3: 안정성과 관측성 — 현재 adaptation

- Spawn은 fixed 경계의 bounded capacity preflight를 거치며 일부 초과 batch를 조용히 버리지 않는다. `getNextGpuLifecycleFixedTick()`은 정상 시 `fixedTick + 1`, 이미 commit한 `N + 1` submit 재시도 중에는 열린 `N + 2`를 반환하고 benchmark/gameplay caller는 tick을 직접 계산하지 않는다. 신규/reused stable slot은 physics/simulation/temporary/contact plane을 완전히 초기화한다.
- reference profile은 원본처럼 tick당 grid 1회를 유지한다. 고속·고밀도 결과가 중간 rebuild 필요성을 증명할 때만 별도 profile로 비교한다.
- presentation은 `strict-interpolation`, 원본 clock의 `reference-clock-extrapolation`, 한 tick으로 제한한 `capped-accumulator-extrapolation`을 분리한다.
- grid/contact/applied/death overflow와 readback pending/ring/backpressure/watermark를 별도 status로 노출한다.
- projectile의 이전 겹침 pair는 반복 피해를 막기 위해 억제하고, `CLOSEST_ONLY`와 terrain kill을 deterministic하게 처리한다. 이는 이동 구간을 검사하는 swept CCD가 아니다.
- GPU death는 즉시 draw/grid에서 숨기되 exact-identity death event를 받은 CPU가 next fixed despawn으로 registry와 stable slot을 회수한다.

## 의도적으로 제외한 원본 producer

CirVivor 무기는 다른 규칙으로 만들 예정이므로 laser, Tesla, fire, freeze, chaining과 원작의 특수 addition producer는 현재 이식하지 않는다. `removal/sort`와 laser source는 원본 dense/special parity를 목표로 할 때 필요하지만 현재 stable-slot vertical slice의 blocker가 아니다.

## NW.js contact hardware smoke — PASS

- NVIDIA Lovelace adapter: `maxStorageBuffersPerShaderStage=10`, requested device limit `9`
- compute layout storage buffers: physics `8`, body-contact `9`, world-contact `7`, contact-handling `9`
- `uncapturedErrorCount=0`
- direct mixed contact: authored enemy `health/damageOther=0.57`, projectile `health/damageSelf=0.29`; `applied=1`, `damageFixedPoint=57`/`damage=0.57`, exact `death=2`, `alive=0`, `sourceTick=completedThroughTick=37`
- public endpoint: enemy/projectile `1/1`에서 exact death 처리 후 next-fixed cleanup으로 `0/0`
- 기존 physics/SDF/flow/render/stable-slot/fault/sparse/overflow probe: 모두 PASS

남은 제품 작업은 swept CCD 여부 결정, Core arrival, 실제 weapon integration, `normal-10k-v1`, 장기 stress/churn과 수동 시각 QA다.

## 남은 검증 순서

1. 과밀·대량 사망·readback 지연/overflow recovery 장시간 스트레스
2. 실제 CirVivor weapon producer와 Core arrival 계약
3. swept CCD 필요성 및 고속 tunneling fixture 결정
4. `normal-10k-v1`/장기 stable-slot churn 승인
5. benchmark와 실제 게임의 수동 시각 QA
