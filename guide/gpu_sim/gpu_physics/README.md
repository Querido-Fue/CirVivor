# GPU 물리 구현 가이드

## 범위

이 구현은 Godot의 `RigidBody2D`를 적마다 생성하지 않는다. 모든 바디를 GPU 저장 버퍼의 원형 입자로 표현하고, 컴퓨트 셰이더에서 이동 예측·공간 분할·충돌 보정을 처리한다. 이 문서는 10,000마리 규모에 직접 관련된 이동과 물리 분리만 다룬다. 데미지 이벤트, 시체, 화염과 같은 게임플레이 효과 패스는 제외했다.

## 전체 파이프라인

```text
CPU 생성 요청 직렬화
  → GPU 바디 버퍼에 추가
  → 속도 적분 및 다음 위치 예측
  → 균일 그리드 초기화·구축
  → 6 × (보정값 초기화 → 바디/바디·바디/지형 해결 → 보정 적용)
  → 보정된 위치로 속도 재계산
  → 감쇠·최대 속도 적용
```

실제 패스 순서는 [globals/gpu_sim.gd](source/globals/gpu_sim.gd)의 `_physics_process()` 621~778행, 특히 724~758행에서 확인할 수 있다.

## 구현 방법

### 1. 노드 대신 연속 데이터로 바디를 표현한다

GPU와 CPU가 동일한 메모리 배치를 사용해야 한다.

- `RB_Physics`: 위치, 속도, 반지름, 역질량, 충돌 메타데이터
- `RB_Sim`: 체력, 수명, 상태 효과와 게임 상태
- `RB_Tmp`: 이전 위치, 예측 위치, 누적 위치 보정, 그리드 인덱스
- `RB_ContactHandler`: 데미지 등 접촉 이벤트 데이터

GLSL 구조체와 바인딩은 [shaders/bindings.gdshaderinc](source/shaders/bindings.gdshaderinc), CPU 직렬화 형식은 [gpu_sim/rigidbody.gd](source/gpu_sim/rigidbody.gd)에서 확인한다. 구조체 패딩과 stride가 한 바이트라도 다르면 잘못된 바디를 읽게 된다. 이 구현은 주요 상태 구조체에 32바이트, 바디 추가 레코드에 80바이트 stride를 사용한다.

적 생성기는 일시적인 CPU 객체를 만든 뒤 한 번에 업로드한다. 예시는 [battle/enemy_spawner.gd](source/battle/enemy_spawner.gd), GPU 추가 패스는 [addition.glsl](source/shaders/rigidbody/addition.glsl)이다.

### 2. RenderingDevice 자원을 한 번 만들고 재사용한다

[gpu_sim/gpu.gd](source/gpu_sim/gpu.gd)에서 다음 래퍼를 확인할 수 있다.

- 고정 용량 storage buffer 생성
- 셰이더와 compute pipeline 생성
- uniform set 캐시
- 직접·간접 dispatch
- 링 버퍼 기반 비동기 readback

현재 구현은 최대 262,144개 바디를 미리 수용한다. 매 프레임 버퍼를 재할당하지 않고 실제 바디 개수만 GPU 버퍼에 유지한다. [update_dispatch.glsl](source/shaders/update_dispatch.glsl)이 GPU상의 개수로 워크그룹 수를 계산하므로 CPU 동기 readback이 필요 없다.

### 3. 이동을 적분해 예측 위치를 만든다

[integrate.glsl](source/shaders/rigidbody/integrate.glsl)의 `main()` 275행부터 각 바디를 한 스레드가 처리한다.

```glsl
previous_position = position;
predicted_position = position + velocity * dt;
```

적의 이동 방향은 바디마다 A*를 실행하지 않고 미리 만든 flow-field 텍스처에서 가져온다. 상태 효과와 속도 제한도 이 패스에서 반영한다.

### 4. 균일 그리드로 충돌 후보를 제한한다

설정은 [globals/gpu_sim.gd](source/globals/gpu_sim.gd) 12~19행에 있다.

- 셀 크기: `12 × 12`
- 셀당 저장 상한: 64개
- 일반 적 반지름: 2~4, 최대 지름 8

[clear_grid.glsl](source/shaders/rigidbody/clear_grid.glsl)이 셀 카운터를 비우고, [build_grid.glsl](source/shaders/rigidbody/build_grid.glsl) 190~298행이 `floor(position / cell_size)`로 셀을 정한다. 작은 바디는 중심 셀 하나에, 큰 바디는 AABB가 닿는 모든 셀에 넣는다. 삽입 인덱스는 `atomicAdd`로 확보한다.

작은 적의 최대 지름이 셀 크기보다 작으므로 자기 셀과 주변 8개 셀만 검사해도 겹칠 수 있는 적을 찾을 수 있다. 후보 수는 일반 적 기준 최대 `9 × 64 = 576`개다.

### 5. Jacobi 방식의 위치 기반 솔버를 반복한다

[solve_body_body.glsl](source/shaders/rigidbody/solve_body_body.glsl)은 셀 하나당 64스레드 워크그룹 하나를 실행한다. 각 스레드는 원 충돌의 침투 깊이를 계산하고 자기 바디의 보정값만 누적한다.

```text
penetration = radius_a + radius_b - distance
alpha       = compliance / (dt² × iteration_count)
deltaλ      = penetration / (inverse_mass_a + inverse_mass_b + alpha)
correction  = normal × deltaλ × inverse_mass_a
```

다른 바디의 위치를 직접 쓰지 않기 때문에 GPU 쓰기 경쟁이 없다. [clear_deltas.glsl](source/shaders/rigidbody/clear_deltas.glsl)로 누적값을 비우고, [apply_deltas.glsl](source/shaders/rigidbody/apply_deltas.glsl)이 한꺼번에 예측 위치에 적용한다. 이 순서를 6회 반복한다.

지형은 [solve_body_world.glsl](source/shaders/rigidbody/solve_body_world.glsl)에서 SDF 거리와 기울기를 샘플링해 일정한 비용으로 해결한다. 폴리곤을 적마다 순회하지 않는다.

### 6. 보정된 위치로 속도를 다시 만든다

[update_velocities_from_positions.glsl](source/shaders/rigidbody/update_velocities_from_positions.glsl)은 다음 식으로 충돌 결과를 속도에 반영한다.

```glsl
velocity = (predicted_position - previous_position) / dt;
position = predicted_position;
```

[finalize.glsl](source/shaders/rigidbody/finalize.glsl)은 감쇠와 최대 속도를 적용한다. 렌더 외삽도 이 최종 속도를 사용하므로 물리 보정과 화면 이동이 서로 맞는다.

### 7. 지형 텍스처를 월드 생성 시 미리 계산한다

[levels/world/world_gen.gd](source/levels/world/world_gen.gd)와 [gpu_sim/gpu.gd](source/gpu_sim/gpu.gd)의 월드 생성 코드가 다음 텍스처를 한 번 만든다.

- SDF: [seed](source/shaders/world_gen/sdf/seed.glsl) → [jump flood](source/shaders/world_gen/sdf/jump_flood.glsl) → [finalize](source/shaders/world_gen/sdf/finalize.glsl)
- Flow field: [seed](source/shaders/world_gen/flow_field/seed.glsl) → [extend](source/shaders/world_gen/flow_field/extend.glsl) → [finalize](source/shaders/world_gen/flow_field/finalize.glsl)

런타임 적 하나당 필요한 것은 텍스처 몇 회 샘플링뿐이다.

## 새 프로젝트에 적용하는 권장 순서

1. 원형 바디 하나를 storage buffer에 넣고 `integrate`만 실행한다.
2. GPU 결과를 비동기로 읽어 위치가 맞는지 검증한다.
3. 균일 그리드와 디버그 셀 카운터를 추가한다.
4. 바디/바디 보정 한 번을 구현한 뒤 반복 횟수를 늘린다.
5. SDF 지형 충돌을 추가한다.
6. 바디 수와 dispatch 수를 GPU에서 계산하도록 바꾼다.
7. 마지막에 데미지·센서 같은 접촉 이벤트를 물리 분리 패스와 별도로 추가한다.

## 성능과 정확도 한계

- 셀에 64개가 넘으면 초과 바디는 그 틱의 후보 목록에 저장되지 않는다. 프레임 비용을 제한하는 대신 극단적인 과밀 상태에서 충돌을 놓칠 수 있다.
- 그리드는 물리 틱마다 한 번만 다시 만든다. 6회 보정 중 셀 경계를 넘어간 바디는 다음 틱에 새 셀로 이동한다.
- 큰 바디 경로를 재사용할 때는 셀 개수를 반드시 64로 clamp해야 한다. 원본 솔버의 큰 바디 반복문은 이 방어가 약하다.
- 셀 크기, 최대 반지름, 셀당 상한은 함께 튜닝해야 한다. 셀만 작게 만들면 누락이 생기고, 크게 만들면 후보 비교가 늘어난다.
- 고정 최대 용량은 재할당을 없애지만 초기 GPU 메모리 사용량을 증가시킨다.

## 주요 파일 빠른 찾기

| 목적 | 파일 |
|---|---|
| 전체 패스 순서·상수·버퍼 구성 | [globals/gpu_sim.gd](source/globals/gpu_sim.gd) |
| RenderingDevice·compute·readback 래퍼 | [gpu_sim/gpu.gd](source/gpu_sim/gpu.gd) |
| CPU 바디 직렬화 | [gpu_sim/rigidbody.gd](source/gpu_sim/rigidbody.gd) |
| 바디/셰이더 메모리 배치 | [shaders/bindings.gdshaderinc](source/shaders/bindings.gdshaderinc) |
| 이동 예측 | [integrate.glsl](source/shaders/rigidbody/integrate.glsl) |
| 공간 그리드 | [build_grid.glsl](source/shaders/rigidbody/build_grid.glsl) |
| 원형 바디 충돌 | [solve_body_body.glsl](source/shaders/rigidbody/solve_body_body.glsl) |
| SDF 지형 충돌 | [solve_body_world.glsl](source/shaders/rigidbody/solve_body_world.glsl) |
| 위치 적용·속도 갱신 | [apply_deltas.glsl](source/shaders/rigidbody/apply_deltas.glsl), [update_velocities_from_positions.glsl](source/shaders/rigidbody/update_velocities_from_positions.glsl) |
