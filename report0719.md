# 2026-07-19 동작 동일성 미확정 리팩터링 후보 보고서

## 1. 문서 성격과 적용 원칙

이 문서는 2026-07-19 정적 감사 시점에 발견한 기능 재사용, 코딩 컨벤션, 단일 책임 원칙(SRP), 렌더 구조 개선 후보 가운데 **현재 테스트만으로는 기존 동작과 완벽히 동일하다고 보장할 수 없어 수정하지 않은 항목**을 기록한다.

- 아래 내용은 확정 버그 판정이 아니다. 코드 구조, 중복, 수명 주기 및 테스트 공백에서 파생된 위험 후보이다.
- 단순히 코드가 유사하다는 이유만으로 통합하지 않는다. 입력 경계, 호출 순서, 부동소수점 연산 순서, 랜덤 소비 순서, WebGL 상태, 합성 픽셀이 동일하다는 별도 증거가 필요하다.
- 기능 재사용과 SRP 개선은 사용자 지시 5·6의 대상이지만, 선행 동일성 테스트가 없는 항목은 이 보고서에만 남기고 런타임 코드는 변경하지 않는다.
- 향후 수정 시에는 항목별 테스트를 먼저 추가하고, 기존 구현과 후보 구현을 같은 입력으로 병렬 실행하는 shadow 비교를 거쳐야 한다.

## 2. 공통 선행 검증 기준

다음 기준을 충족하기 전에는 이 문서의 후보를 동작 경로에 반영하지 않는다.

1. 물리·AI·fixed-step 코드는 seed가 고정된 장시간 replay에서 매 tick의 위치, 속도, 회전, 상태 전이, 후보/해결 순서, 생성·회수 이벤트가 기준 구현과 정확히 일치해야 한다.
2. 입력 코드는 사각형 네 변과 네 꼭짓점, 변 바로 안/밖, 투영 quad, 둥근 모서리, 음수/0 크기, `NaN`/무한대 입력을 포함한 경계 테스트를 통과해야 한다.
3. 렌더 코드는 시간, seed, viewport, DPR, UI scale, render scale, 테마, 오버레이 진행률을 고정한 뒤 각 surface의 `readPixels`/`getImageData`와 최종 합성 화면을 바이트 단위로 비교해야 한다.
4. WebGL 코드는 정상 초기화뿐 아니라 resize, FBO 불완전, context loss/restore, surface release/reacquire, scene 전환 및 반복 destroy를 포함해야 한다.
5. 랜덤 기반 효과는 동일 seed에서 호출 횟수와 호출 순서까지 비교해야 한다. 분포가 같다는 사실만으로 동일성을 인정하지 않는다.

## 3. 단일 책임 원칙 및 대형 구조 분리 보류

### 3.1 충돌 파이프라인 총괄 클래스

- **파일 경로:** `project/game/script/module/physics/_collision_handler.js`
- **문제 후보:** broad phase 후보 수집, sweep 보정, pair 순회, 빠른 경로/일반 경로 분기, 위치 해결, 통계와 scratch 수명 관리가 한 파일에 강하게 결합되어 있다. 책임 분리와 중복 제거 여지는 크지만 처리 순서 자체가 물리 의미의 일부이다.
- **동일성 위험:** 후보 순서나 pair 해결 순서가 한 번만 달라져도 이후 body 위치와 다음 pair 입력이 달라질 수 있다. `Float64`/typed-array 기록 시점, sleep 상태, budget 중단 지점, 관계 데이터 갱신 순서 변경도 장시간 결과를 발산시킬 수 있다.
- **선행 테스트/권장 방향:** grid 생성부터 ordered pair 해결까지의 canonical snapshot을 저장하는 seeded replay를 먼저 만든다. 최소·최대 반지름, 완전 중첩, 접선, 고속 이동, sleep/wake, pair budget 경계, 밀집 군집을 포함해 매 tick 배열을 비교한 뒤 순수 계산 kernel부터 단계적으로 추출한다.

### 3.2 UI 레이아웃 총괄 클래스

- **파일 경로:** `project/game/script/module/ui/layout/_layout_handler.js`
- **문제 후보:** 레이아웃 트리 구성, 측정/배치, 스타일 해석, 요소 생성 및 갱신 책임이 집중되어 있어 변경 영향 범위가 넓다.
- **동일성 위험:** 반올림 시점, 부모/자식 계산 순서, 누락 값 fallback, 동적 크기 재계산이 달라지면 클릭 영역과 최종 픽셀이 동시에 변할 수 있다. 화면상 차이가 작아도 hit-test 계약은 달라질 수 있다.
- **선행 테스트/권장 방향:** 실제 오버레이별 레이아웃 snapshot과 렌더 pixel golden을 viewport/DPR/UI scale 행렬로 만든다. 측정, 배치, 요소 materialization을 분리하되 각 단계의 중간 snapshot이 기존과 정확히 같을 때만 반영한다.

### 3.3 오버레이 WebGL 효과 렌더러

- **파일 경로:** `project/game/script/module/display/webgl/_overlay_effect_renderer.js`
- **문제 후보:** shader/program 생성, FBO/texture 관리, Kawase blur, 캐시 signature, frame 상태, 패널 합성을 한 클래스가 담당한다.
- **동일성 위험:** GL bind/clear 순서, texture filter, pass 개수, viewport, blend 상태 또는 캐시 무효화 조건의 사소한 변경도 최종 픽셀에 영향을 준다. 분리는 가능해 보여도 숨은 GL 상태 의존성이 존재할 수 있다.
- **선행 테스트/권장 방향:** 각 pass 출력과 최종 compositor 출력을 모두 바이트 비교하고, GL 상태 snapshot 및 context restore 시나리오를 추가한다. resource owner, blur graph, composite pass를 분리할 때는 기존 호출 순서를 보존하는 adapter를 먼저 둔다.

### 3.4 AI navigation과 policy 책임

- **파일 경로:** `project/game/script/module/object/enemy/ai/_enemy_ai_navigation.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_policy_intent.js`
- **문제 후보:** navigation 파일은 LOS/flow-field/cache/heap/경로 선택을, policy 파일은 목표 탐색·점수·TTL·hexa 합체 접근 정책을 폭넓게 담당한다. 상수 fallback과 벡터 계산도 곳곳에 섞여 있다.
- **동일성 위험:** heap tie-break, 이웃 순회 순서, `Float32` 반올림, cache key/TTL, 목표 후보 동점 처리, 공간 인덱스 조회 순서가 바뀌면 동일 seed에서도 적 경로와 합체 대상이 달라진다.
- **선행 테스트/권장 방향:** 장애물/막힌 목표/대각선 corner-cut/동점 경로/도달 불가/캐시 만료를 포함한 flow-field 배열 비교와 장시간 AI replay를 구축한다. navigation kernel과 policy orchestration을 분리하되 목표 ID, 방향 벡터의 원시 비트, 상태 전이 tick을 비교한다.

### 3.5 hexa 합체와 레이아웃 책임

- **파일 경로:** `project/game/script/module/object/enemy/_hexa_hive_merge.js`, `project/game/script/module/object/enemy/_hexa_hive_layout.js`, `project/game/script/module/object/object_system_hexa_hive_orchestration.js`, `project/game/script/module/object/object_system_hexa_hive_presentation.js`
- **문제 후보:** 접촉 시간, 그룹 구성, 합체 결과, 질량 중심, pull/settle presentation offset, cell layout 및 effect command 생성의 경계가 여러 파일에 걸쳐 중첩된다.
- **동일성 위험:** pair/group 순회 순서나 중심 계산의 덧셈 순서가 바뀌면 새 hive의 위치, cell 순서, 회전, weight/HP 및 합체 애니메이션이 달라질 수 있다. 논리 위치와 표시 위치를 섞어 통합하면 물리와 화면 모두 변한다.
- **선행 테스트/권장 방향:** 2개부터 최대 cell 수까지의 합체 순열, 다중 동시 그룹, 중단/재접촉, 회전, pull/settle 전체 시간축을 replay한다. 논리 merge 결과와 presentation command를 별도 snapshot으로 고정한 뒤 책임을 분리한다.

### 3.6 display 수명 주기와 draw 책임

- **파일 경로:** `project/game/script/module/display/display_system.js`, `project/game/script/module/display/_draw_handler_2d.js`, `project/game/script/module/display/webgl/_webgl_handler.js`, `project/game/script/module/display/webgl/_webgl_layer_renderer.js`
- **문제 후보:** surface 생성/풀링/레이어 등록, frame clear, 커맨드 실행, WebGL renderer 캐시와 context 복구가 상호 의존한다.
- **동일성 위험:** 레이어 순서, clear 소유자, 2D context reset, WebGL state 재바인딩 또는 surface 재사용 시점이 달라지면 투명도·합성 순서·잔상이 바뀔 수 있다.
- **선행 테스트/권장 방향:** 모든 레이어의 명령 순서 snapshot과 layer별/최종 pixel golden을 만든다. surface registry, frame orchestration, backend executor의 경계를 문서화하고 기존 순서를 그대로 위임하는 facade 방식으로만 분리한다.

### 3.7 base overlay와 title menu orchestration

- **파일 경로:** `project/game/script/module/overlay/_base_overlay.js`, `project/game/script/module/scene/title/_title_menu.js`, `project/game/script/module/scene/title/menu/`
- **문제 후보:** base overlay에는 수명 주기, layout, animation, blur/focus, 입력과 표시 상태 계약이 모여 있다. title menu는 하위 모듈로 일부 분리되었지만 카드/패널/효과/상호작용/오버레이 session orchestration이 여전히 강하게 연결되어 있다.
- **동일성 위험:** open/close 중간 프레임, focus 반환, blur 동기화, pointer 활성 tick, 효과 particle 시간축 가운데 하나만 달라져도 체감 동작과 최종 화면이 달라진다.
- **선행 테스트/권장 방향:** open/close/reopen/scene 전환/중간 취소를 1-frame 단위로 기록하고 focus stack, presentation 값, surface pixel을 비교한다. state machine을 먼저 명시한 뒤 view/effect/input adapter를 분리한다.

### 3.8 `BaseEnemy` 책임 집중

- **파일 경로:** `project/game/script/module/object/enemy/_base_enemy.js`
- **문제 후보:** 풀 획득·초기화·reset 수명 주기, 물리·렌더 transform과 보간, 합체 pull/settle presentation, 축 저항과 각운동, AI 수명 주기, 투사체 피격, 상태 이상 및 화면 이탈 판정이 하나의 기반 클래스에 집중되어 있다. `object_system_fixed_update_helpers.js`가 status와 fixed transform을, `object_system_update_helpers.js`가 보간과 settle을, `_shape_enemy.js`가 AI·저항·각운동을, 충돌 모듈이 축 저항·각충격·피격을 각각 호출하므로 변경 영향이 여러 실행 경계에 걸친다.
- **동일성 위험:** 책임 분리 과정에서 reset 필드 순서, 재사용 객체 identity, AI reset/init 순서, fixed 상태와 render 상태의 기록 시점 또는 subclass override 계약이 달라질 수 있다. 개별 메서드 테스트만으로 풀 획득부터 충돌·보간·반납까지의 완전 동일성을 보장할 수 없다.
- **선행 테스트/권장 방향:** 모든 적 subclass에 대해 acquire→init→다중 fixed tick→충돌 보정→가변 보간→release→재획득 replay를 만들고 매 단계의 전체 필드, 재사용 객체 identity, AI hook 순서를 비교한다. 그 전에는 순수 숫자 helper 재사용만 허용하고 클래스 분리는 보류한다.

### 3.9 `SystemHandler` 책임 집중

- **파일 경로:** `project/game/script/module/system_handler.js`
- **문제 후보:** 서브 시스템의 생성·초기화, pause policy 병합과 사운드 side effect, fixed/variable scheduler, 성능 계측, 렌더 clear/flush 순서, 시뮬레이션 snapshot adapter, resize 및 런타임 설정 전파가 한 클래스에 결합되어 있다. `main.js`가 생성·tick·resize를 호출하고 설정 overlay와 debug 입력이 `applyRuntimeSettings()`를, App의 pause 경로가 `setPauseReason()`을 호출하므로 boot·simulation·display·설정 생명 주기가 동시에 연결된다.
- **동일성 위험:** 모듈 분리 시 fixed step 계측의 `try/finally`, simulation snapshot 동기화 시점, pause 진입 input reset, BGM side effect, overlay backdrop용 중간 WebGL flush 가운데 하나라도 이동하면 시뮬레이션 상태나 최종 픽셀이 달라질 수 있다.
- **선행 테스트/권장 방향:** 시스템 호출 trace를 기록하는 spy harness로 init/tick/pause/debug-step/resize/settings 변경의 정확한 호출 순서와 인자를 고정한다. WebGL flush와 최종 surface의 pixel golden까지 확보한 뒤 boot composition·pause policy·snapshot adapter를 기존 순서를 보존하는 위임 객체로 한 축씩 분리한다.

## 4. 기존 게임 기능 재사용 후보 보류

### 4.1 `CollectionOverlay`와 `DeckOverlay` 중복

- **파일 경로:** `project/game/script/module/overlay/title/_collection.js`, `project/game/script/module/overlay/title/_deck.js`, `project/game/script/module/overlay/overlay_system.js`
- **문제 후보:** 두 overlay의 layout과 콘텐츠 구조가 매우 유사하며, 현재 overlay system에서는 `DeckOverlay`만 등록되어 `CollectionOverlay`가 legacy/dead 경로일 가능성이 있다.
- **동일성 위험:** 즉시 삭제하거나 공통 base로 합치면 저장 키, 번역 키, 향후 숨은 import, title icon, open/close 수명 주기 차이를 놓칠 수 있다. 정적 import 부재만으로 런타임 미사용을 완전히 증명할 수 없다.
- **선행 테스트/권장 방향:** overlay route 전수 조사와 실행 coverage를 먼저 확보한다. 두 클래스의 layout tree/open-close snapshot을 비교한 뒤, 완전 동일하면 데이터 descriptor 기반 단일 구현으로 옮기고 legacy alias는 한 릴리스 동안 유지한다.

### 4.2 generic overlay와 title menu의 패널 기능 중복

- **파일 경로:** `project/game/script/module/overlay/overlay_panel_interaction_update.js`, `project/game/script/module/overlay/_panel_effect_math.js`, `project/game/script/module/scene/title/menu/_title_menu_interaction.js`, `project/game/script/module/scene/title/menu/_title_menu_effect_state.js`, `project/game/script/module/scene/title/menu/_title_menu_effect_render.js`
- **문제 후보:** projected quad/rounded-rect hit-test, ripple/particle 상태, spotlight 및 패널 효과에 평행 구현이 존재한다. 게임의 generic overlay 기능을 title menu가 일부 자체 구현한다.
- **동일성 위험:** 양쪽의 좌표계, reveal 조건, alpha 곡선, 랜덤 호출 순서, pointer 허용 시점이 완전히 같다고 확인되지 않았다. 섣부른 공통화는 title 전용 연출 또는 generic overlay 동작을 바꿀 수 있다.
- **선행 테스트/권장 방향:** 같은 panel descriptor와 고정 seed/time을 두 구현에 입력해 local point, hovered/pressed 결과, effect state와 픽셀을 비교한다. 공통화 가능한 순수 geometry/math만 먼저 추출하고 연출 정책은 adapter로 남긴다.

### 4.3 hit-test 경계 계약 불일치 가능성

- **파일 경로:** `project/game/script/module/ui/element/_button.js`, `project/game/script/module/ui/element/_dropdown.js`, `project/game/script/module/overlay/_panel_effect_math.js`, `project/game/script/module/overlay/overlay_panel_interaction_update.js`, `project/game/script/module/scene/title/menu/_title_menu_interaction.js`, `project/game/script/module/scene/title/menu/_title_menu_version_link.js`
- **문제 후보:** 사각형, 둥근 사각형, quad 판정이 여러 위치에 있으며 `>=`/`<=` 또는 조기 배제 조건의 경계 포함 규칙이 공통 계약으로 고정되어 있지 않다.
- **동일성 위험:** 공통 helper로 교체할 때 정확히 변 위에 있는 pointer와 투영/반올림된 좌표의 판정이 달라질 수 있다. 이는 hover뿐 아니라 click 소비 순서와 focus까지 바꾼다.
- **선행 테스트/권장 방향:** 네 변·꼭짓점·radius 접점·epsilon 안/밖·변환된 quad를 포함하는 표 기반 테스트를 각 기존 구현에 먼저 적용한다. 기존 계약이 서로 다르면 하나로 합치지 말고 명시적인 boundary mode를 제공한다.

### 4.4 `clickAble` 호환 이름

- **파일 경로:** `project/game/script/module/ui/element/_base_element.js`, `project/game/script/module/ui/element/_button.js`, `project/game/script/module/ui/element/_segment_control.js`
- **문제 후보:** 일반적인 `clickable` 대신 기존 공개 속성 `clickAble`이 생성 옵션과 런타임 판정에 사용된다. 컨벤션상 이름 수정 후보지만 사실상 호환 API이다.
- **동일성 위험:** 일괄 rename은 동적 property 접근, layout descriptor, 저장된 구성 또는 외부 플러그인성 코드에서 조용히 기본값 `true`로 되돌아갈 수 있다.
- **선행 테스트/권장 방향:** 모든 descriptor/property 사용처와 런타임 reflection을 조사한다. 변경한다면 `clickAble` getter/setter alias와 deprecation 기간을 두고, 두 이름의 우선순위 및 `undefined`/`false` 조합을 테스트한다.

### 4.5 collision sweep pad 계산 중복

- **파일 경로:** `project/game/script/module/physics/_collision_handler.js`, `project/game/script/module/physics/collision_broadphase_buffer.js`, `project/game/script/module/physics/collision_enemy_body_builder.js`, `project/game/script/module/physics/collision_player_body_builder.js`, `project/game/script/module/physics/_collision_resolve_tuning.js`
- **문제 후보:** sweep 범위와 candidate pad의 계산/추출 논리가 handler와 broadphase buffer에 중복되어 있고 enemy/player body builder에도 유사한 padding 조립이 있다.
- **동일성 위험:** 유사해 보여도 각 경로의 sleep 처리, frame resolve pad, scale 적용 단계가 다를 수 있다. 통합 과정에서 scale을 두 번 적용하거나 한 번 빠뜨리면 tunneling과 후보 수가 바뀐다.
- **선행 테스트/권장 방향:** 정지/고속/음수 속도/sleep/큰 delta/밀집 상태의 body·candidate 배열을 원시 값으로 비교한다. 각 함수의 입력 단위와 scale 적용 책임을 먼저 명문화한 뒤 완전히 동일한 수식만 순수 helper로 이동한다.

### 4.6 hexa presentation offset 중복

- **파일 경로:** `project/game/script/module/object/enemy/_shape_enemy.js`, `project/game/script/module/object/enemy/_hexa_hive_enemy.js`, `project/game/script/module/object/enemy/_base_enemy.js`, `project/game/script/module/object/enemy/_hexa_hive_merge.js`
- **문제 후보:** `mergePullOffset`과 `mergeSettleOffset`의 유효성 fallback 및 합산, object Y offset 적용이 일반 shape와 hive draw/merge 계산에 반복된다.
- **동일성 위험:** 일부 경로는 draw override를 추가하고, 일부는 질량 중심 계산용 presentation 위치를 구한다. 공통화 시 Y축 부호나 보간 시점이 바뀌면 합체 중심과 화면 위치가 어긋난다.
- **선행 테스트/권장 방향:** pull-only, settle-only, 동시 적용, 0/비정상 값, 회전 및 draw override 조합의 논리/렌더 좌표 snapshot을 만든다. 좌표 용도를 `logical`, `presentation`, `draw override`로 구분한 API를 설계한 뒤 재사용한다.

### 4.7 raw hexa type 판정과 helper 미재사용

- **파일 경로:** `project/game/script/module/object/enemy/_hexa_hive_layout.js`, `project/game/script/module/object/enemy/_hexa_hive_layout_accessors.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_fixed_update_context.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_footprint.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_navigation.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_rotation.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_steering.js`
- **문제 후보:** 이미 hexa type/helper가 존재하지만 일부 accessor는 raw `'hexa'`와 hive type을 직접 비교하고, 여러 AI 모듈이 `getHexaHiveType()` 결과와 직접 비교한다.
- **동일성 위험:** raw `hexa`와 합체 hive는 layout 접근에서 의도적으로 함께 허용되지만 AI 정책에서는 구분될 수 있다. 하나의 광범위한 helper로 치환하면 허용 범위가 넓어져 행동이 달라질 수 있다.
- **선행 테스트/권장 방향:** raw hexa, hive, 비활성 객체, layout 미생성 객체에 대해 각 호출 지점의 기대 truth table을 만든다. 의미가 다른 `isRawHexa`, `isHexaHive`, `supportsHexaLayout` 계약으로 분리하고 정확히 같은 계약에서만 재사용한다.

### 4.8 AI 상수 fallback과 벡터 helper 중복

- **파일 경로:** `project/game/script/data/object/enemy/enemy_ai_constants.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_core.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_policy_intent.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_steering.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_rotation.js`, `project/game/script/module/object/enemy/ai/_enemy_ai_navigation.js`
- **문제 후보:** `EPSILON`, 거리/길이, normalize, profile 숫자 정규화 및 `640`/`1280`/`0.15` 같은 fallback 성격 숫자가 여러 모듈에 반복된다.
- **동일성 위험:** helper 통합 시 zero-vector 처리, epsilon 비교 방향, output object 재사용, `Math.hypot` 호출/반올림 순서, profile 누락 fallback이 달라질 수 있다. fallback 숫자가 의도적으로 이전 데이터와의 호환을 보장할 가능성도 있다.
- **선행 테스트/권장 방향:** 0, subnormal, epsilon 경계, 매우 큰 값, `NaN`/무한대 및 profile 누락을 포함해 기존 helper별 결과를 기록한다. 의미가 동일한 상수는 data registry에서 단일화하고, 벡터 함수는 allocation/output 및 정규화 실패 계약까지 명시한다.

### 4.9 fixed-step 기준 숫자 중복

- **파일 경로:** `project/game/script/main.js`, `project/game/script/time_handler.js`, `project/game/script/module/simulation/fixed_step_catch_up_policy.js`, 관련 테스트 파일의 `1 / 60` 사용처
- **문제 후보:** 기본 fixed step `1 / 60`이 여러 런타임/테스트 위치에 직접 정의되어 있어 기준값 변경 시 drift 가능성이 있다.
- **동일성 위험:** 무조건 공통 상수로 바꾸면 테스트가 독립적인 oracle이 아니라 구현 상수를 그대로 읽게 되어 회귀 탐지력이 약해질 수 있다. 초기화 순서나 override fallback도 달라질 수 있다.
- **선행 테스트/권장 방향:** 런타임 canonical default와 외부 override 계약을 먼저 정한다. 프로덕션은 단일 상수를 사용하되 테스트의 기대값 일부는 독립 literal/oracle로 유지하고 30/60/120Hz 및 비정상 delta를 검증한다.

### 4.10 debug option schema와 label 중복

- **파일 경로:** `project/game/script/module/debug/debug_system.js`, `project/game/script/module/overlay/_debug_overlay.js`, `project/game/script/data/debug/debug_constants.js`
- **문제 후보:** `frameTime`, `poolInfo`, `hitboxes`, `animationDebug` option key/default/schema와 표시 label이 system 및 overlay에 나뉘어 수동 동기화된다.
- **동일성 위험:** descriptor 통합 시 초기 default, debug mode 해제 시 reset, option별 side effect, 표시 순서 또는 번역되지 않은 기존 label이 달라질 수 있다.
- **선행 테스트/권장 방향:** toggle 전이, debug mode on/off, scene 전환, 잘못된 key, overlay 재생성에 대한 state snapshot을 만든다. key/default/label을 data descriptor로 옮기되 system side effect callback과 UI 순서는 기존 그대로 보존한다.

### 4.11 `Math.random` 직접 사용과 random helper 미재사용

- **파일 경로:** `project/game/script/util/random_util.js`, `project/game/script/util/math_util.js`, `project/game/script/module/overlay/overlay_panel_interaction_update.js`, `project/game/script/module/scene/title/menu/_title_menu_effect_state.js`, `project/game/script/module/scene/title/center_circle/_title_center_circle_glow_canvas.js`
- **문제 후보:** 공용 random 관련 유틸리티가 존재하지만 패널 particle과 title 효과는 `Math.random()`을 직접 사용한다. generic/title 구현에는 거의 같은 랜덤 식도 반복된다.
- **동일성 위험:** helper 치환은 수학식이 같아도 random 호출 횟수나 순서, 정수 구간의 끝점, seed 주입 여부를 바꿀 수 있어 시각 결과가 달라진다.
- **선행 테스트/권장 방향:** 주입 가능한 RNG로 기존 호출 trace를 먼저 고정하고 particle 한 개당 소비 횟수와 각 결과를 비교한다. helper는 RNG 인자를 허용하되 기존 `Math.random` fallback과 정확한 구간 계약을 보존한다.

### 4.12 `BaseEnemy` 렌더 회전 델타의 공용 각도 함수 직접 치환

- **파일 경로:** `project/game/script/module/object/enemy/_base_enemy.js`, `project/game/script/util/math_util.js`
- **문제 후보:** `BaseEnemy.interpolatePosition()`의 `-180~180` 정규화 식은 `normalizeDegrees()`와 일반 입력에서 같은 역할을 하므로 공용 기능 재사용 후보로 보인다.
- **동일성 위험:** 이전·현재 회전은 각각 유한값으로 fallback되지만, `Number.MAX_VALUE - (-Number.MAX_VALUE)`처럼 두 유한 극값의 뺄셈이 무한대로 오버플로할 수 있다. 기존 식은 `Infinity % 360`의 결과인 `NaN`을 유지하지만 `normalizeDegrees(Infinity)`는 `0`을 반환하므로 직접 치환은 완전 동일하지 않다. `init(data.rotation)`과 공개 AI adapter가 회전값을 직접 공급할 수 있어 API 경계에서는 도달 가능하다. 별도 테스트에서 양방향 극값의 실제 `BaseEnemy.renderRotation === NaN` 계약을 고정했으며 생산 코드는 수정하지 않았다.
- **선행 테스트/권장 방향:** 렌더 보간 hot path의 추가 분기·함수 호출 비용까지 측정하면서 오버플로 결과를 그대로 보존하는 adapter가 필요한지 먼저 결정한다. 실사용 입력 범위를 제한하는 계약이 생기기 전에는 현재 inline 식을 유지한다. 반면 `_shape_enemy.js`의 로컬 구현은 비유한 값과 부호 있는 0을 포함한 424,602개 케이스에서 공용 함수와 `Object.is` 기준으로 일치해 별도 안전 변경 대상으로 처리했다.

### 4.13 설정 schema/API의 prototype chain 충돌

- **파일 경로:** `project/game/script/module/save/_setting_handler.js`, `project/game/script/module/save/save_system.js`
- **문제 후보:** `schema`가 일반 객체이고 지원 키를 own-property가 아닌 `this.schema[key]`의 truthiness로 판정한다. `setBatch()`/`previewBatch()`는 `for...in`으로 입력의 상속된 열거 가능 속성까지 처리하며, 마지막 `settings.theme` 조회도 own-property 여부를 확인하지 않는다.
- **현재 동작과 영향:** `getSchema('__proto__')`는 `Object.prototype`을, `getSchema('constructor')`는 전역 `Object` 함수를 live 참조로 반환한다. 계산 속성, `JSON.parse()` 또는 null-prototype 객체의 own `__proto__`를 `set()`/batch API에 전달하면 지원 키처럼 처리되어 `Object.prototype.value`를 만들 수 있다. 상속된 정상 키도 batch 메모리 값과 테마 효과에 반영된다. 저장소 내부의 현재 호출자는 고정된 정상 키와 평범한 객체만 사용하므로 일반 게임 경로의 직접 발생은 확인되지 않았지만, 같은 NW.js renderer의 오용이나 향후 입력 확장 시 전역 객체 무결성과 저장 동작을 깨뜨릴 수 있다.
- **동일성 위험:** `Object.hasOwn` 검증, own-key 전용 순회, null-prototype schema, 복제·동결 중 어느 방식을 적용해도 현재 관찰 가능한 prototype 이름 처리, 상속 입력 처리, getter/Proxy 순서, 테마 호출, 저장 횟수 또는 live 참조 계약이 달라진다. 완전한 차단을 위해 public schema 참조까지 제한하면 정상 호출자의 mutation 가능성도 제거되므로 기존 모든 입력의 100% 동일 동작과 보안 수정은 동시에 성립하지 않는다. 따라서 생산 코드는 수정하지 않았다.
- **선행 테스트/권장 방향:** 전역 오염이 다른 테스트에 번지지 않도록 각 케이스를 별도 `vm.Context`나 자식 프로세스에서 실행한다. 정상 own 키와 `__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, 이미 오염된 임의 키를 모든 단일/batch/preview/get API에 적용하고, 객체 리터럴·계산 속성·JSON·null-prototype·상속 enumerable/non-enumerable·getter/Proxy·null/undefined 입력을 포함한다. 반환/예외/Promise, trap 순서, `setTheme`, 메모리, hidden 정책, 쓰기 횟수·JSON 바이트와 `Object.prototype` 전체 descriptor를 전후 비교한 뒤 prototype/상속 입력에 대한 별도 안전 계약을 승인해야 한다.

### 4.14 마우스 DOM listener 중복 처리와 해제 수명 주기

- **파일 경로:** `project/game/script/module/input/_mouse_input_handler.js`, `project/game/script/module/input/input_system.js`, `project/game/script/module/system_handler.js`
- **문제 후보:** `MouseInputHandler`는 `mousemove`를 `window`와 `document` 양쪽에 익명 함수로 등록하고, 모든 listener를 제거하는 `destroy()`/unsubscribe 경계를 제공하지 않는다. 실제 bubbling 경로에서는 한 포인터 이동이 document와 window에서 모두 처리될 수 있으며, `InputSystem`을 다시 만들면 이전 handler의 listener와 상태 머신도 남을 수 있다.
- **현재 범위:** 정상 `SystemHandler` 초기화는 `InputSystem`을 한 번만 만들므로 현재 일반 게임 수명 주기에서 인스턴스 누적 재생성은 확인되지 않았다. 양쪽 이동 listener는 같은 좌표 변환을 수행해 보통 최종 위치는 같지만, display/event getter와 coercion side effect, 예외 횟수, 사용자 정의 상태 머신 타이밍은 두 호출을 관찰할 수 있다.
- **동일성 위험:** 한 listener 제거, event identity dedupe, bound callback 저장 또는 `destroy()` 도입은 호출 횟수·순서·예외와 blur/visibility/mouseleave 후 상태 전이를 바꾼다. 현재 실제 이벤트 전파와 중복 호출을 포함한 브라우저 계약 없이 성능 목적으로 정리하면 완전 동일성을 보장할 수 없어 생산 코드는 수정하지 않았다.
- **선행 테스트/권장 방향:** 실제 NW.js DOM에서 element→document→window 전파 trace와 이벤트당 좌표/버튼 갱신 횟수를 먼저 기록한다. 단일·복수 handler, 생성/폐기 반복, blur·visibilitychange·mouseleave·mousedown/up 도중 destroy, listener 예외와 재진입을 포함해 기존 trace를 고정한다. 승인된 새 수명 주기 계약이 생기면 named callback과 idempotent `destroy()`를 추가하고 `InputSystem`/`SystemHandler`가 소유권을 명시적으로 위임하도록 변경한다.

### 4.15 인게임 저장 데이터 API의 prototype chain 충돌

- **파일 경로:** `project/game/script/module/save/_ingame_handler.js`
- **문제 후보:** 내부 데이터가 일반 객체이고 `setData(key, value)`와 `getValue(key)`가 own-property 검증 없이 bracket 접근을 사용한다. `setData('__proto__', object)`는 일반 데이터 프로퍼티를 만들지 않고 내부 객체의 prototype을 교체하며, `getValue('toString')`·`getValue('constructor')`는 저장되지 않은 상속값을 반환한다.
- **현재 범위:** 저장소 내부에는 이 두 공개 메서드의 외부 호출자가 없고 정상 파일 로드는 JSON parse 결과에 누락된 기본 최상위 키만 보충하므로, 현재 일반 게임 흐름에서 임의 키가 직접 유입되는 경로는 확인되지 않았다. 다만 향후 설정 UI나 플러그인성 호출자가 임의 키를 전달하면 저장 데이터 판정과 직렬화 대상의 prototype 의미가 달라질 수 있다.
- **동일성 위험:** `Object.hasOwn`, null-prototype 데이터, 허용 키 schema 또는 `Object.defineProperty`로 바꾸면 현재 관찰 가능한 `__proto__` 대입, 상속 키 조회, getter/Proxy 순서와 JSON 직렬화 결과가 달라진다. 정상 키만의 안전성은 높일 수 있어도 기존 모든 입력의 100% 동일 동작은 보장할 수 없으므로 생산 코드는 수정하지 않았다.
- **선행 테스트/권장 방향:** `__proto__`, `constructor`, `toString`, own/inherited enumerable 키, null-prototype 입력, getter/Proxy와 JSON round-trip을 별도 VM에서 검사한다. 임의 키를 허용할지 저장 schema만 허용할지 새 계약을 승인한 뒤, prototype 없는 레코드와 own-key 검증을 함께 도입한다.

### 4.16 overlay presentation 패널 결과 객체 재사용

- **파일 경로:** `project/game/script/module/overlay/overlay_panel_region.js`, `project/game/script/module/overlay/overlay_panel_interaction_update.js`, `project/game/script/module/overlay/_base_overlay.js`
- **문제 후보:** `getOverlayPresentedPanelRegion()`은 presentation scale이 1이 아닐 때 origin `{x, y}`와 spread 결과 패널 객체를 호출마다 만든다. update/draw의 패널별 경로라 scratch 객체 재사용 시 프레임 할당을 줄일 수 있다.
- **현재 동작과 영향:** 결과 패널은 hit-test에 쓰일 뿐 아니라 `panel.onClick({ panel, ... })` 콜백 payload로 외부 코드에 노출된다. 현재는 호출마다 새 identity와 그 시점의 own enumerable string/symbol 속성 snapshot을 제공하고, object spread가 getter·Proxy trap을 정해진 순서로 실행해 일반 data descriptor를 만든다.
- **동일성 위험:** 단일 scratch/out 객체를 재사용하면 콜백이 보관한 과거 패널이 다음 호출에서 변하고, 재진입·복수 패널이 같은 identity를 공유하며, 이전 호출에만 있던 키가 잔존할 수 있다. 명시적 필드 복사로 바꾸면 symbol·추가 enumerable 키, getter/Proxy 순서와 descriptor가 달라진다. 이 공개 snapshot 계약을 보존하면서 할당을 없앨 수 없어 생산 코드는 수정하지 않았다.
- **선행 테스트/권장 방향:** 결과 identity 보관, 같은 panel 연속 호출, 복수 패널, scale 0/1/비유한 값, 추가 string/symbol 키, getter/Proxy throw, 클릭 콜백 재진입과 payload 장기 보관을 고정한다. 새 API에서 caller-owned out 객체를 명시적으로 opt-in하게 하거나 내부 hit-test 전용 scalar 경로를 별도로 만들되, 기존 callback snapshot API는 유지하는 방향이 필요하다.

### 4.17 인게임 저장 JSON root와 자동 보완 실패 정책

- **파일 경로:** `project/game/script/module/save/_ingame_handler.js`, `project/game/script/module/save/_save_file_helper.js`
- **문제 후보:** `IngameHandler`는 파싱한 JSON root가 일반 레코드인지 검증하지 않고 누락된 기본 키를 대입한다. 배열 root에는 이름 있는 프로퍼티가 메모리에 붙지만 `JSON.stringify()`가 이를 생략해 자동 보완 저장 결과가 다시 `[]`가 된다. `null`이나 원시 root는 병합 중 예외가 발생해 기본값으로 복구된다.
- **현재 동작과 영향:** 기존 객체의 누락 키를 자동 보완하다 파일 쓰기가 실패하면 `save()`가 기록한 오류를 바깥 로드 `catch`가 다시 잡고, 방금 읽은 값까지 메모리 기본값으로 교체한 뒤 `init()`은 이행된다. 또한 `pathExists()`는 권한·I/O 오류까지 부재처럼 축약하고, `ensureSaveDirectory()`는 접근 가능한 경로가 실제 디렉터리인지 확인하지 않는다. 별도 VM 테스트가 배열 root의 `[]` 재저장, 보완 쓰기 실패의 이중 로그·값 교체·이행, 모든 access 오류를 현재 계약으로 고정했다.
- **동일성 위험:** plain-object root 검증, 자동 보완 실패 재전파, atomic write, 오류 코드 구분이나 `stat()` 확인을 추가하면 현재의 복구 값·Promise 결과·로그 횟수·파일 바이트가 바뀐다. 더 안전한 동작이지만 기존 모든 입력의 100% 동일 작동과 양립하지 않아 이번에는 생산 로직을 수정하지 않고 JSDoc과 회귀 테스트만 정정했다.
- **선행 테스트/권장 방향:** 저장 schema/version과 허용 root 타입, 손상 파일 격리·백업, 자동 repair 실패의 사용자 노출 정책을 먼저 확정한다. 승인된 새 계약 아래 object/array/null/원시/중첩·unknown 키, 권한·디스크 부족·부분 쓰기·동시 저장·process 종료를 포함한 실제 임시 파일 통합 테스트와 migration rollback을 마련한 뒤 변경한다.

### 4.18 `EnemySpatialIndex` 셀 clamp의 공용 함수 직접 치환

- **파일 경로:** `project/game/script/module/object/enemy/ai/enemy_spatial_index.js`, `project/game/script/util/number_util.js`
- **문제 후보:** 밀도 필드 X/Y 인덱스 두 곳은 로컬 `clampCellIndex(value, max)`를 사용하며, 공용 `clampNumber(value, min, max)`와 기본 숫자 환경에서 같은 0~max 제한 역할을 한다. 실제 호출 인수는 `Math.floor()` 결과와 1 이상의 유한 정수 최대값이므로 중복 제거 후보로 보인다.
- **확인된 정상 숫자 범위:** ±0·subnormal·±최대값·±Infinity·`NaN`을 포함한 명시값 96건과 raw Float64 1,000,000건을 실제 최대값 도메인 8종에 배치해 총 1,000,096건을 비교했으며 기본 `Math`에서는 모두 `Object.is` 기준으로 일치했다.
- **결정적 동일성 위험:** 로컬 식 `Math.min(max, Math.max(0, value))`은 outer `Math.min` 참조 뒤 `Math.max → Math.min`을 호출하지만, 공용 함수의 `Math.max(min, Math.min(max, value))`는 outer `Math.max` 참조 뒤 `Math.min → Math.max`를 호출한다. `globalThis.Math`와 두 메서드는 런타임에서 교체·getter화할 수 있으므로 property 접근, 호출, 반환 및 예외의 관찰 순서가 달라진다. 상태형 patch 진단에서 같은 `(5, 9)` 입력의 기존 결과는 `2`, 공용 결과는 `20`이었고, `Math.max`가 토큰을 던질 때 기존 trace는 `max` 한 번, 공용 trace는 `min → max`였다. 두 경로 모두 같은 토큰을 던져도 그 전 부수효과가 다르다.
- **실제 전체 모듈 반례:** 실제 `enemy_spatial_index.js` 전체 소스와 실제 `number_util.js`를 격리 VM에 링크한 뒤, 적 `id` getter가 density clamp 직전에 상태형 `Math` accessor를 설치하도록 했다. 같은 `rebuild()` 입력에서 기존 trace는 `get:min → get:max → call:max → call:min`이고 nonzero density index는 `6`이었지만, 공용 후보는 `get:max → get:min → call:min → call:max`와 index `5`를 만들었다. getter별 예외를 주입하면 먼저 던지는 오류도 기존 `min-get`, 후보 `max-get`으로 달라진다. 새 static import는 독립 loader에 의존성 edge도 추가한다.
- **현재 처리:** 저장소의 정상 게임 경로에서 `Math` 변조는 확인되지 않았지만, 사용자 지시 5의 모든 관찰 가능한 동작 완전 동일 기준에는 반례가 존재한다. 따라서 import 추가, 로컬 helper 제거 및 두 호출 치환을 모두 보류하고 생산 코드는 변경하지 않았다.
- **선행 테스트/권장 방향:** 현재 공용 `clampNumber()`를 그대로 재사용하려면 먼저 native `Math` 불변을 런타임 계약으로 명시해야 한다. 그렇지 않으면 기존 연산·property 접근·호출 순서를 보존하는 별도 공용 helper가 필요하며, `clampNumber()` 자체의 순서를 바꾸는 경우에는 모든 기존 호출자의 역전 범위, getter/Proxy, patched intrinsic, 예외와 부수효과를 별도로 exact 검증해야 한다.

## 5. 렌더 파이프라인 구조 개선 보류

### 5.1 title gradient의 `uTime`과 bake 무효화 계약

- **파일 경로:** `project/game/script/module/scene/title/_title_gradient_background.js`
- **문제 후보:** `update()`는 `elapsed`를 계속 변경하고 shader는 `uTime`을 사용하지만, bake texture는 해상도/팔레트/명시적 dirty 변화가 있을 때 주로 다시 생성된다. 정적 배경을 의도한 최적화인지, 시간 애니메이션이 bake 때문에 고정된 것인지 계약이 불명확하다.
- **동일성 위험:** `elapsed`마다 dirty로 바꾸면 의도된 정적 화면, GPU 비용, 픽셀이 모두 달라진다. 반대로 `uTime`을 제거하면 최초 bake 시점의 위상과 shader source가 바뀔 수 있다.
- **선행 테스트/권장 방향:** 현재 여러 프레임의 pixel capture와 기획상 기대 애니메이션을 먼저 대조한다. 정적 의도면 bake time을 명시적 상수/phase로 고정하고, 동적 의도면 허용 cadence와 pixel golden을 정한 뒤 변경한다.

### 5.2 pooled WebGL surface의 context loss 처리

- **파일 경로:** `project/game/script/module/display/_surface_pool.js`, `project/game/script/module/display/display_system.js`, `project/game/script/module/display/webgl/_webgl_handler.js`
- **문제 후보:** free list에 반환된 WebGL entry는 동일 `context` 객체로 재사용되며, pool 자체에는 context lost 상태를 검증하거나 손상 entry를 폐기하는 계약이 보이지 않는다.
- **동일성 위험:** acquire 때마다 context를 재생성하거나 강제 loss하면 정상 경로의 성능과 resource 수명이 변한다. 반대로 lost context를 재사용하면 특정 장치/scene 전환에서 빈 surface가 될 가능성이 있다.
- **선행 테스트/권장 방향:** `WEBGL_lose_context`를 이용해 active/free 상태 각각에서 loss/restore 후 release/reacquire를 반복하고 draw 결과와 pool 통계를 확인한다. health check와 폐기 정책을 pool API에 넣되 정상 context의 재사용 경로는 그대로 유지한다.

### 5.3 `WebGLBatch` teardown/resource ownership

- **파일 경로:** `project/game/script/module/display/webgl/_webgl_batch.js`, `project/game/script/module/display/webgl/_webgl_layer_renderer.js`, `project/game/script/module/display/webgl/_webgl_handler.js`
- **문제 후보:** batch는 buffer/program 등 GL resource를 소유하지만 명시적인 teardown 책임과 handler/layer renderer의 정상 destroy 경계가 충분히 드러나지 않는다.
- **동일성 위험:** 성급한 delete는 공유 중인 resource나 아직 flush되지 않은 command를 무효화할 수 있고, 아무 정리도 하지 않으면 scene/surface 반복 생성 시 누적 가능성이 있다.
- **선행 테스트/권장 방향:** 생성/등록/flush/destroy 순서를 계측하고 scene 전환 및 surface 교체를 수백 회 반복해 GL resource 개수와 출력 픽셀을 확인한다. resource 소유자를 하나로 정한 뒤 idempotent `destroy()`와 context-lost 전용 무삭제 경로를 분리한다.

### 5.4 FBO completeness 검증 공백

- **파일 경로:** `project/game/script/module/display/webgl/_overlay_effect_renderer.js`, `project/game/script/module/display/webgl/_title_loading_circle_effect_pass.js`
- **문제 후보:** blur target에 texture를 attach하는 경로는 있으나, title gradient와 달리 target별 `checkFramebufferStatus` 및 실패 fallback 계약이 명시적으로 확인되지 않았다.
- **동일성 위험:** 매 프레임 상태 검사를 추가하면 성능에 영향을 줄 수 있고, 실패 시 pass를 생략/2D fallback하는 정책은 기존의 빈 출력 또는 이전 texture 잔존 동작과 다를 수 있다.
- **선행 테스트/권장 방향:** 정상/0 크기/최대 texture 제한/resize/context restore에서 FBO 상태와 출력 픽셀을 검증한다. target 생성·크기 변경 시 한 번만 검사하고, 실패 정책을 렌더 계약으로 확정한 뒤 도입한다.

### 5.5 overlay와 title loading의 Kawase blur 중복

- **파일 경로:** `project/game/script/module/display/webgl/_overlay_effect_renderer.js`, `project/game/script/module/display/webgl/_title_loading_circle_effect_pass.js`, `project/game/script/data/display/overlay_render_constants.js`, shader source 모듈
- **문제 후보:** 두 구현이 같은 Kawase shader/상수를 사용하면서도 target 구축, pass 계획, uniform 설정 및 실행 코드를 각각 보유한다.
- **동일성 위험:** 공통 blur graph로 합치면 down/up target 크기 반올림, pass 순서, offset, viewport 복구, texture filter 및 캐시 signature 중 하나가 달라져 화면 품질이 변할 수 있다.
- **선행 테스트/권장 방향:** blur 반경 0/최소/중간/최대, 홀수 크기, 다양한 render scale에서 각 pass texture를 바이트 비교한다. target planner와 pass executor를 순수 공통 모듈로 추출하되 두 호출자의 기존 preset/signature를 입력으로 그대로 전달한다.

### 5.6 pixel-golden 회귀 테스트 부재

- **파일 경로:** `project/game/test/` 전반, `project/game/script/module/display/` 전반, `project/game/script/module/scene/title/` 전반, `project/game/script/module/overlay/` 전반
- **문제 후보:** 정적 감사 시점의 테스트는 로직/소스 계약 중심이며 Canvas 2D, WebGL pass, 최종 compositor를 바이트 단위로 고정하는 전용 pixel-golden 체계가 확인되지 않았다.
- **동일성 위험:** 육안 QA만으로는 alpha 1단계, blur kernel, subpixel 위치, blend/clear 순서 차이를 완벽히 검출할 수 없다. 반대로 장치 의존 screenshot만 golden으로 쓰면 driver/font 차이로 불안정해질 수 있다.
- **선행 테스트/권장 방향:** 결정론적 test scene, 고정 font/seed/time, 고정 viewport/DPR/theme/render scale을 마련한다. CPU 2D surface와 WebGL pass는 raw buffer exact 비교를 우선하고, 최종 화면은 동일 NW.js/장치 프로필의 exact golden과 허용 오차 없는 차이 이미지를 함께 저장한다.

### 5.7 `DrawHandler2D` 프레임 스타일 캐시 객체 재사용

- **파일 경로:** `project/game/script/module/display/_draw_handler_2d.js`, `project/game/script/module/display/draw_2d_layer_state.js`
- **문제 후보:** 비지속 2D 레이어는 `clear()`/`clearAll()`마다 스타일 캐시를 새 `{}`로 교체한다. 정상 화면은 프레임당 4개, 일반 오버레이는 보통 6개여서 기존 객체의 11개 스타일 필드를 무효화해 재사용하는 방안이 할당 최적화 후보로 보인다.
- **결정적 동일성 위험:** `render()`는 Map에서 읽은 캐시 C1을 지역 변수로 유지한 채 context setter를 실행한다. 이 setter나 styles getter가 같은 레이어의 `clear()`를 재진입하면 현재 구현은 Map 항목을 새 C2로 교체하고, 바깥 render가 재개된 뒤의 후속 캐시 쓰기는 Map에서 분리된 C1에만 남긴다. 다음 render는 빈 C2를 사용해 reset 뒤 필요한 Canvas 스타일을 모두 다시 설정한다. C1을 `undefined` 또는 `delete` 방식으로 재사용하면 바깥 render가 같은 객체를 다시 채우므로 다음 render가 setter를 잘못 생략할 수 있고, 그 사이 직접 변경된 context 상태가 그대로 픽셀에 반영된다. 별도 회귀 테스트에서 이 재진입 후 `fillStyle` 재적용과 실제 draw 시점 색을 고정했다.
- **추가 위험:** own `undefined`는 fresh 객체의 absent property와 다르며 `Object.prototype`의 동명 값/getter/setter, non-writable 속성에서 조회·부수효과·예외가 달라진다. `delete`는 prototype 조회 의미를 가깝게 보존하지만 진행 중 render가 보유한 cache identity 격리는 해결하지 못하고, 합성 벤치에서도 fresh 교체보다 현저히 느렸다.
- **현재 처리:** fresh 캐시 교체와 그 실행 위치(`resetDrawContextState()` 전체 성공 뒤, `clearRect` 전)는 생산 코드에 그대로 유지했다. 모든 호출이 사용하던 죽은 `applyTransform` 비공개 옵션과 분기만 exact 동등성 테스트 후 제거했으며, 해당 변경 자체는 4/6/8 레이어 교차 벤치에서 성능상 중립이라 속도 향상으로 기록하지 않았다.
- **선행 테스트/권장 방향:** 할당 제거를 다시 시도하려면 진행 중인 모든 render 참조와 새 frame cache를 세대별로 분리하고, 중첩 clear·render·register/unregister·모든 setter 예외·prototype 오염에서 legacy trace와 픽셀을 exact 비교해야 한다. 현재 fresh 객체 교체 비용보다 복잡도와 재진입 위험이 커서 현 구조를 유지한다.

## 6. 권장 처리 순서

1. pixel-golden, hit-test 경계, seeded fixed-step replay 기반을 먼저 만든다.
2. 확정 동작 계약이 가장 작은 순수 helper 후보부터 shadow 비교한다.
3. 렌더는 pass 출력과 최종 합성의 exact 비교가 모두 통과한 경우에만 공통화한다.
4. AI·충돌·hexa는 장시간 replay와 배열/이벤트 순서 동일성이 확보될 때까지 구조 분리를 보류한다.
5. legacy API(`clickAble`, `CollectionOverlay`)는 사용 경로와 호환 기간을 확인한 뒤 alias를 거쳐 정리한다.

현재 상태에서는 위 항목을 **보고만 하고 수정하지 않는 것**이 완벽 동일성 요구에 부합한다.
