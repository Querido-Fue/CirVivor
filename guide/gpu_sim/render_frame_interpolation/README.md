# 렌더 프레임 보간 가이드

## 먼저 알아둘 점

폴더 이름은 요청에 맞춰 `render_frame_interpolation`으로 두었지만, 이 게임의 실제 구현은 두 위치 사이를 섞는 보간(interpolation)이 아니다. 마지막 물리 위치에서 현재 속도만큼 앞을 예측하는 전방 외삽(extrapolation)이다.

## 전체 흐름

```text
물리 틱 시작
  → simulation_time += physics_delta
  → render_time = simulation_time

각 렌더 프레임
  → render_time += frame_delta
  → 두 시간을 push constant로 vertex 셰이더에 전달
  → render_position = physics_position + velocity × (render_time - simulation_time)
```

## 구현 방법

### 1. 물리 시간과 렌더 시간을 분리한다

[globals/gpu_sim.gd](source/globals/gpu_sim.gd)에서 다음 부분을 확인한다.

- 25행: `USE_RENDER_POSITION_INTERPOLATION = true`
- 327~328행: `simulation_time`, `render_time`
- 621~625행: 물리 틱에서 시뮬레이션 시간을 진행하고 렌더 시간을 다시 맞춤
- 776~778행: 물리 틱 사이의 렌더 프레임마다 렌더 시간만 진행
- 339~350행: 두 시간을 밀리초 단위 push constant로 인코딩

개념적으로는 다음과 같다.

```gdscript
func _physics_process(delta):
    simulation_time += delta
    render_time = simulation_time

func _process(delta):
    if USE_RENDER_POSITION_INTERPOLATION:
        render_time += delta
```

### 2. 드로우 직전에 두 시간을 GPU에 전달한다

[battle/rigidbodies_debug_texture_rect.gd](source/battle/rigidbodies_debug_texture_rect.gd) 116~124행은 GPU에서 instance count를 갱신한 뒤 한 번의 indirect draw를 실행한다. 이때 카메라 행렬, 월드 크기, 물리 시간, 렌더 시간을 push constant로 보낸다.

[update_draw_dispatch.glsl](source/shaders/update_draw_dispatch.glsl)은 GPU 바디 수를 draw의 `instance_count`로 바꾼다. 적마다 draw call을 만들지 않는다. 간접 드로우 구현은 [gpu_sim/gpu.gd](source/gpu_sim/gpu.gd)의 `SimpleDraw.draw_indirect()`에서 확인한다.

### 3. vertex 셰이더에서 전방 위치를 예측한다

복원된 [debug_draw.glsl](source/shaders/rigidbody/debug_draw.glsl)의 vertex 단계는 1~400행이다. 핵심은 231행과 256~257행이다.

```glsl
uint id = uint(gl_InstanceIndex);
vec2 body_position = physics.position;
vec2 velocity = physics.velocity;

float predict_dt = max(float(pc.time_render_ms - pc.time_ms) * 0.001, 0.0);
body_position += velocity * predict_dt;
```

이후 `gl_VertexIndex`로 6개 정점의 사각형과 UV를 만들고, 속도 방향으로 회전한 다음 카메라 행렬을 곱한다. 관련 코드는 345~398행이다.

## 왜 부드러워지는가

물리 위치는 고정 틱에서만 바뀌지만 렌더 시간은 매 프레임 증가한다. 따라서 렌더 위치가 물리 위치 사이에서 조금씩 전진해 계단식 움직임이 보이지 않는다. GPU 물리의 마지막 단계가 충돌 보정 후 속도를 다시 계산하므로 외삽 방향도 대체로 충돌 결과를 따른다.

이 방식은 이전 위치와 현재 위치를 `mix()`하지 않는다. 따라서 엄밀한 보간이 필요하다면 `previous_position`과 `current_position`을 저장하고 한 물리 틱 늦게 렌더하는 별도 설계가 필요하다.

## 새 프로젝트에 적용할 때 권장하는 형태

원본은 음수만 막지만, 프레임 정지나 디버거 중단 후 지나친 예측을 피하려면 상한도 두는 편이 안전하다.

```glsl
float predict_dt = clamp(render_time - simulation_time, 0.0, physics_dt);
vec2 render_position = simulation_position + velocity * predict_dt;
```

다음 상황에서는 예측 오차가 커질 수 있다.

- 급회전, 벽 충돌, 순간이동
- 속도가 한 프레임에 크게 바뀌는 넉백
- 물리 틱이 장시간 밀린 경우

순간이동 시에는 속도와 두 시간을 함께 재설정하고, 급격한 움직임이 많은 게임이라면 외삽 상한을 더 작게 잡는다.

## 주요 파일 빠른 찾기

| 목적 | 파일 |
|---|---|
| 물리·렌더 시간 관리 | [globals/gpu_sim.gd](source/globals/gpu_sim.gd) |
| push constant와 indirect draw 호출 | [battle/rigidbodies_debug_texture_rect.gd](source/battle/rigidbodies_debug_texture_rect.gd) |
| GPU draw 래퍼 | [gpu_sim/gpu.gd](source/gpu_sim/gpu.gd) |
| GPU instance count 생성 | [shaders/update_draw_dispatch.glsl](source/shaders/update_draw_dispatch.glsl) |
| 위치 외삽·쿼드 생성·카메라 변환 | [shaders/rigidbody/debug_draw.glsl](source/shaders/rigidbody/debug_draw.glsl) |
