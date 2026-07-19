# 2026-07-19 최적화 진행 기록

## 운영 원칙

- 작업 브랜치: `codex/wasm-render-optimization`
- 물리, AI, 렌더 변경은 기존 JS 기준 구현과 별도 회귀 테스트를 먼저 고정합니다.
- WASM 결과는 정상·경계·대규모·결정성 케이스에서 JS 결과와 필드별로 비교하고, 불일치가 하나라도 있으면 런타임 전환을 허용하지 않습니다.
- 렌더 최적화는 픽셀 결과, 레이어 순서, 실시간 blur, context restore 계약을 보존합니다.
- 재사용성·SRP 변경에서 완전 동일성을 입증하기 어려운 항목은 수정하지 않고 `report0719.md`에 기록합니다.
- 각 작업 단위는 자동 검사, 게임 GUI 확인, GitHub Desktop 커밋·푸시 순서로 종료합니다.

## 기준 상태

- 기준 커밋: `dc50927 Added map select`
- 기준 브랜치 상태: `main`과 `origin/main` 일치, 작업 트리 깨끗함
- JavaScript 파일: 315개
- 전체 JavaScript `node --check`: 315개 통과
- 자동 테스트 최초 결과: 19개 중 18개 통과, 1개 실패
- 실패 원인: `overlay_presentation_animation.test.mjs`가 같은 커밋에서 변경된 실제 기본 프리셋(0.5초, blur 10)을 이전 기대값(0.6초, blur 20)으로 검사함
- WASM 도구체인: 저장소 및 시스템에 Emscripten, Rust, WABT, Binaryen, LLVM WASM 도구가 없음
- 가이드 상태: 정리 진행표는 307개 JS를 기준으로 하며, 최근 맵 선택·애니메이션·오버레이 변경이 아직 반영되지 않음

## 작업 단위

### 1. 검증 기반 정비 — 완료

- [x] 전체 가이드와 기존 정리 이력 확인
- [x] 전체 JavaScript 문법 기준선 확인
- [x] 전체 자동 테스트 기준선 확인
- [x] 테스트 실행에 필요한 Node VM modules 플래그 식별
- [x] 현재 런타임 프리셋을 변경하지 않고 stale 테스트 기대값 갱신
- [x] 반복 가능한 `npm test` 스크립트 추가
- [x] `npm test`: 19개 전체 통과
- [x] Computer Use로 2560×1440 타이틀 설정 오버레이 진입·종료 중간/완료 상태 확인
- [x] GitHub Desktop 커밋 및 푸시: `4958f7a Stabilize baseline test workflow`

검증 메모:

- 기본 프리셋의 0.5초 alpha/scale/blur 트랙이 실제 설정 오버레이에서 정상 동작했습니다.
- 진입 완료 후 패널 blur·dim·glass 표현이 정상이고, 취소 종료 후 타이틀 메뉴와 입력 포커스가 복원됐습니다.
- 런타임 프리셋 값과 표시 결과는 변경하지 않았습니다.

### 2. 물리·AI WASM 경계와 동일성 하네스 — 완료

- [x] 실제 hot path와 순수 커널 후보 확정: LOS 차단 시 bounded LRU cache miss에서 생성하는 Enemy AI flow field
- [x] 재현 가능한 WASM 빌드 도구 고정: `wabt@1.0.39` exact dependency와 lockfile, WAT→byte artifact 일치 검사
- [x] JS reference와 WASM parity 테스트 작성
- [x] JS fallback 및 capability gate 구현: 1,024셀 임계값, 초기화/실행 실패 후 영구 JS fallback과 최초 실패 진단 보존
- [x] 성능 기준선과 전환 게이트 검증
- [x] `npm test`: 41개 전체 통과, flow-field parity 16개 subtest 포함
- [x] 1×1~3×3 모든 크기·blocked mask·goal 조합 5,506개 원시 바이트 exact
- [x] heap 동률/decrease-key, corner cut, blocked/unreachable goal, 단일 축, 축 길이 4,097, 49,601셀, 결정적 무작위, invalid input, memory growth edge case 검증
- [x] 별도 stress: 고정 seed 1,000건·3,824,454셀 raw-byte exact와 1×1/32×32/257×193 ABI padding·guard-tail canary, 2회 PASS
- [x] Node same-realm production JS/WASM 9개 시나리오×15쌍, 총 135쌍/270회 timed call 모두 exact; p50 1.18~1.33배
- [x] Computer Use로 실제 배포 NW.js 0.108.0에서 3×3 전수+49,601셀 총 4,609개 exact PASS 확인
- [x] 실제 배포 production backend 두 clean process: 1,023셀→JS, 1,024셀→WASM, 80×45 첫 memory growth exact
- [x] 실제 NW.js p50 두 번 동일: 32×32 JS 0.237ms/WASM 0.113ms(2.11배), 80×45 JS 0.925ms/WASM 0.475ms(1.95배)
- [x] Computer Use 실제 게임 맵 선택·플레이 진입과 benchmark 100개 스폰 확인: 활성 적 92→86 우회 이동, 180~181 FPS, fixed 60.0 tick/s, debt 0
- [x] GitHub Desktop 커밋 및 푸시: `4bb7891 Accelerate enemy flow fields with WebAssembly` + stress verification 후속 커밋

동일성 메모:

- integration/dirX/dirY 세 `Float32Array` 모두 tolerance를 두지 않고 JS/WASM의 전체 원시 바이트를 비교합니다.
- 기존 indexed-heap JS 구현은 삭제하지 않고 oracle과 정상 fallback으로 유지했습니다.
- WASM 결과는 linear memory에서 복사하므로 이후 memory growth가 캐시된 field를 변경하지 않습니다.
- flow field만 순수 precompute로 이전했으며 cache/LOS/goal/steering/fixed authority는 기존 JS에 남겼습니다.

### 3. 렌더 파이프라인 — 구현 중

- [x] WebGL/Canvas 상태 변경·할당·flush·합성 경로 감사
- [x] 품질 동일성을 증명할 시각 회귀 기준 마련
- [x] 기본 FBO 명시 바인딩과 overlay 중복 clear 제거
- [x] GL 호출 계약 테스트: `bind → viewport → clear → beginFrame`, 레이어당 clear 1회
- [x] 신규 계약 테스트 10회 및 전체 `npm test` 6회 연속 통과
- [x] Computer Use로 게임 완전 재실행 후 2560×1440 설정 오버레이 진입·완료·취소 확인
- [x] GitHub Desktop 커밋 및 푸시: `90bcc1e Eliminate duplicate overlay frame clears`
- [x] `WebGLBatch.begin()`의 draw 없는 상태 바인딩 13회 제거: 정적 background/object 두 batch 기준 프레임당 26회 중복 GL 호출 제거
- [x] 별도 fake GL oracle 테스트 6개: 빈 frame, shape/image 전환, capacity 자동 flush, 외부 상태 오염, resize·미제출 큐 초기화의 draw 상태·호출 trace·`Float32Array` 업로드 원시 바이트 exact
- [x] 실제 NW.js WebGL1 픽셀 oracle 2회 연속 통과: alpha on/off, 홀수 해상도, 소수 transform, 반투명 overlap, capacity 자동 flush, 외부 상태 오염의 `readPixels` RGBA 198,336바이트 exact
- [x] 전체 `npm test` 47개, JS/MJS 347개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary 통과
- [x] Computer Use로 일반 타이틀 복원과 benchmark 100개 스폰 확인: 179~181 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s
- [x] GitHub Desktop 커밋 및 푸시: `95c736e Defer WebGL batch state binding until flush`

동일성 메모:

- 제거된 두 번째 clear 사이에는 draw 호출이 없으며 두 clear 모두 투명 기본 FBO 전체를 대상으로 했습니다.
- 셰이더, blend 함수, 명령 순서, blur pass, viewport 크기와 최종 합성 데이터는 변경하지 않았습니다.
- 이전 오프스크린 FBO가 남아 있는 경우에도 handler가 기본 FBO를 먼저 선택하도록 계약을 강화했습니다.
- `begin()`에서 제거한 13개 호출은 모든 실제 draw 직전 `flush()`가 같은 순서로 다시 수행하던 상태 복구 블록입니다. vertex 생성, texture 전환, upload, draw 호출은 변경하지 않았습니다.
- 실제 NW.js 검증의 6개 장면은 모두 clear 색과 다른 픽셀을 만들었으며, 기준/후보의 전체 framebuffer 바이트와 `gl.getError()` 결과가 일치했습니다.

#### 3.1 Canvas 2D 프레임 reset 비공개 계약 단순화 — 완료

- [x] `DrawHandler2D.clearAll()`이 활성 렌더 프레임마다 호출되고, 정상 화면 4개·일반 오버레이 6개·중첩 오버레이 8개 비지속 2D 레이어를 reset하는 경로 감사
- [x] 두 실제 호출이 모두 `applyTransform: false`를 넘긴 뒤 곧바로 별도 transform을 복원함을 확인하고, 매 호출의 옵션 객체 리터럴과 비공개 기본 인자·죽은 transform 분기 제거
- [x] 생산 코드 변경 전 행동 동등성 7개 green·구조 가드 1개 red를 확인하고, `clearAll()` 중단 예외 회귀까지 보강한 변경 후 9개 전체 green으로 고정
- [x] 실제 `_draw_handler_2d.js` 전체 소스를 격리 VM에서 평가하고 exact source block 치환으로 만든 legacy/후보 클래스의 Canvas 접근 trace·상태를 비교
- [x] `resetTransform`/`setTransform` fallback, 11개 reset setter, `clearRect`의 method/canvas/width/height 조회, transform 복원과 callback 순서를 독립 oracle로 검증
- [x] 모든 clear trace 위치의 예외와 후속 render 부분 상태, persistent skip, live Map iterator의 unregister/re-register, 첫 레이어 예외 뒤 즉시 중단, reset setter 재진입을 exact 비교
- [x] `render()` 중 스타일 getter가 `clear()`를 재진입하는 결정적 반례로 fresh 스타일 캐시 교체가 진행 중 옛 캐시 쓰기를 격리하는 표시 정확성 계약임을 확인하고, 위험한 캐시 재사용은 `report0719.md` 5.7로 보류
- [x] register/unregister/transform/shadow/render/clear/clearAll과 모든 shape·gradient를 섞은 고정 seed 50,000개 명령에서 legacy/후보 trace와 최종 컨텍스트 상태 exact 일치
- [x] 실제 전체 클래스 합성 벤치 20회 교차 측정은 4/6/8 레이어 모두 IQR 중첩, paired 중앙값 후보 +0.068%/+0.329%/+0.488%로 성능상 중립 판정; 속도·heap 개선으로 주장하지 않고 276 source byte와 죽은 private API 제거로만 평가
- [x] `npm test` 75개, JS/MJS 353개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] 독립 리뷰에서 production·source variant·예외·재진입 하네스 blocker 없음 확인
- [x] Computer Use 완전 재실행 후 타이틀·설정 glass 오버레이 표시 정상; benchmark 적 100개 생성 후 활성 98개, 179 FPS, fixed 60.0/s, SIM 100.1%, debt 0.0/s; 재실행해 정상 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `ea22d47 Simplify 2D frame reset contract`

#### 3.2 Canvas 2D 기본 그림자 상태 공유 — 완료

- [x] `DrawHandler2D`의 `registerLayer()`·`shadowOff()`·누락 fallback이 같은 불변 기본 그림자 값마다 새 객체를 만들던 세 경로와 실제 overlay/UI 호출자를 감사
- [x] 외부로 identity가 노출되지 않는 모듈 비공개 기본 상태 하나를 세 경로에서 공유하고, `shadowOn()` custom 상태와 공개 `createDrawShadowState()`의 호출별 fresh·mutable 계약은 유지
- [x] `Object.freeze()`는 변조 가능한 전역 호출이라는 새 관찰 지점을 만들므로 사용하지 않고, 비공개 객체를 외부에 노출하거나 내부에서 변경하지 않는 불변식을 별도 구조 테스트와 가이드에 고정
- [x] 생산 변경 전 신규 테스트의 행동 비교 5개 green·구조 가드 1개 red를 확인하고, 독립 리뷰 보강 뒤 변경 후 8개 전체 green으로 고정
- [x] 실제 `_draw_handler_2d.js`와 의존 모듈을 격리 VM에서 평가하고 exact source 역변환으로 만든 호출별 할당 legacy와 공유 후보의 trace·상태·예외 토큰을 비교
- [x] 모든 shape, linear gradient·color stop, 등록·해제·재등록·clear·measureText와 사용자 style/shape getter 및 Canvas 모든 관찰 지점 예외의 부분 캐시·후속 렌더를 exact 비교
- [x] shadow setter·style getter 재진입, 현재 호출 custom snapshot과 다음 호출 기본 복귀, 두 레이어 shared-default/per-command override 격리, VM `Object.prototype` 오염·정리 후 custom 상태 복구를 독립 기대값으로 고정
- [x] register/unregister/transform/shadow/render/clear/clearAll과 모든 shape를 섞은 고정 seed 50,000개 명령에서 legacy/후보 trace와 네 레이어 최종 컨텍스트 상태 exact 일치
- [x] 5,000,000회 Map 상태 교체를 7회 교차 측정한 격리 벤치 중앙값은 호출별 생성 85.857ms, 공유 상태 67.724ms로 해당 경로 약 21.12% 단축; 전체 게임 FPS 향상으로 확대 해석하지 않음
- [x] `npm test` 93개, JS/MJS 355개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] 독립 리뷰 3건에서 비공개 identity·custom 상태·source variant·getter/Canvas 예외·재진입·prototype 오염·다중 레이어 하네스 blocker 없음 확인
- [x] Computer Use cold start 후 타이틀 커서·카드 그림자와 설정 glass 오버레이 정상; benchmark 기본 181 FPS, 적 100개 생성 후 활성 97→92개에서 180 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 재실행해 정상 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `49d369d Reuse the default Canvas shadow state`

### 4. 코드베이스·JSDoc·재사용성·SRP — 감사 완료, 안전 수정 대기

- [x] 최근 추가 파일을 포함한 345개 JS/MJS 인벤토리 갱신 및 전체 `node --check` 통과
- [x] JSDoc 누락·오래된 계약 식별
- [x] 중복 구현과 기존 기능 미재사용 식별
- [x] 안전 수정과 보고 전용 항목 분리
- [x] 동일성 미확정 후보를 `report0719.md`에 파일별 위험·선행 테스트와 함께 기록
- [x] GitHub Desktop 커밋 및 푸시: `9b63ce3 Document deferred refactoring risks`

#### 4.1 핵심 오브젝트·물리 API JSDoc 사실성 정비 — 완료

- [x] `ObjectSystem`의 실제 적 전용 update/draw 범위, pool/live 배열, 합체·충돌 변이와 최신 인스턴스 nullable 계약 문서화
- [x] `PhysicsSystem`의 fixed-tick 시작 부수효과, live wall 배열, 충돌 통계 스냅샷 및 충돌 API 변이 계약 문서화
- [x] `BaseEnemy`의 풀 초기화 반환, AI reset/init·임의 훅 반환, transform 동기화, 내부 가변 speed와 중심점 판정 계약 문서화
- [x] 수정된 세 파일의 추가·삭제 행이 JSDoc/주석뿐인지 검사: `COMMENT_ONLY_EXECUTABLE_SOURCE_IDENTICAL`
- [x] 전체 JS/MJS 345개 `node --check`, `npm test` 41개, WASM stress 1,000건·3,824,454셀 및 ABI canary 모두 통과
- [x] Computer Use로 설정 오버레이와 benchmark 진입, 적 100개 스폰 확인: 181 FPS, fixed 60.0/s, SIM 100.1%, debt 0; 종료 후 타이틀 정상 복원
- [x] GitHub Desktop 커밋 및 푸시 완료

#### 4.2 동일성 미확정 SRP 후보 보고 확장 — 완료

- [x] `BaseEnemy`의 풀 수명주기·transform·합체 표시·물리 저항·AI·피격·상태 책임 집중과 필요한 전체 replay gate 기록
- [x] `SystemHandler`의 boot·pause·scheduler·profiler·snapshot·설정·렌더 flush 책임 집중과 필요한 호출 trace/pixel gate 기록
- [x] 생산 코드는 변경하지 않고 `report0719.md`에 3.8·3.9 항목만 추가
- [x] Computer Use로 정상 배포 타이틀 상태 유지 확인
- [x] GitHub Desktop 커밋 및 푸시 완료

#### 4.3 적 도형 각도 정규화 공용 기능 재사용 — 완료

- [x] `_shape_enemy.js`의 로컬 `#normalizeAngle()`와 `util/math_util.js`의 `normalizeDegrees()` 입력·연산 순서 감사
- [x] 별도 legacy 오라클 테스트를 생산 코드 변경 전 red → 변경 후 green으로 고정
- [x] 명시값 23개, 180도 경계 인접값 24,579개, raw Float64 비트 패턴 200,000개, 임의 각도 차 200,000개 — 총 424,602개를 `Object.is`로 exact 비교
- [x] `_shape_enemy.js`가 공용 `normalizeDegrees()`를 재사용하도록 변경하고 로컬 구현과 미사용 `STRAIGHT_DEG` 제거
- [x] `BaseEnemy` 직접 치환의 양방향 극값 오버플로 차이(기존 `NaN`, 공용 `0`)를 실제 클래스 테스트와 `report0719.md` 4.12에 고정하고 생산 코드는 유지
- [x] `npm test` 48개, JS/MJS 348개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary 통과
- [x] Computer Use로 완전 재실행 후 benchmark 적 100개 생성: 방향 추적 도형 회전 정상, 180 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 종료 후 타이틀 정상 복원
- [x] GitHub Desktop 커밋 및 푸시: `850e6f5 Reuse shared enemy angle normalization`

#### 4.4 시뮬레이션 숫자 정규화 공용 기능 재사용 — 완료

- [x] `simulation_runtime.js`의 비공개 `normalizeNumber()`와 `util/number_util.js`의 `resolveFiniteNumber()` 본문·fallback·getter 평가·import 부수효과 감사
- [x] 기존 16개 호출 모두 명시적 fallback을 전달함을 확인하고, 별도 legacy 오라클 테스트를 변경 전 structural red → 변경 후 green으로 고정
- [x] 명시값/fallback 224쌍, raw Float64 250,000쌍, 실제 런타임 명시값 28개·raw 값 25,000개 — 총 275,252개 exact 비교와 accessor 8회 계약 검증
- [x] 로컬 구현 제거 후 16개 호출을 공용 `resolveFiniteNumber()`로 직접 통합
- [x] 공용 함수 JSDoc에 숫자 primitive만 허용하며 coercion하지 않는 실제 계약 반영
- [x] `npm test` 49개, JS/MJS 349개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary 통과
- [x] Computer Use 완전 재실행, 설정·benchmark 진입·적 100개 생성: 179–181 FPS, fixed 60.0/s(한 표본 61.0/s), SIM 100.0% 전후, debt 0.0/s; 종료 후 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `51be299 Reuse shared simulation number normalization`

#### 4.5 공간 인덱스 셀 clamp 공용화 — 보고 전용

- [x] `EnemySpatialIndex`의 로컬 `clampCellIndex()`와 공용 `clampNumber()`의 본문, 밀도 X/Y 두 호출 도메인, import 부수효과를 감사
- [x] ±0·subnormal·±최대값·±Infinity·`NaN` 명시값 96건과 raw Float64 1,000,000건 — 총 1,000,096건은 기본 `Math`에서 `Object.is` exact 일치 확인
- [x] mutable `Math.min/max` 진단에서 기존 호출 순서 `max → min`, 공용 호출 순서 `min → max`, 상태형 반환 `2` 대 `20`, throw 전 trace `max` 대 `min → max`의 결정적 반례 확인
- [x] 실제 전체 `EnemySpatialIndex` legacy/공용 후보를 VM에서 실행한 반례에서 property/get 호출 순서와 nonzero density index `6` 대 `5`, getter 예외 `min-get` 대 `max-get` 차이 확인
- [x] 사용자 지시 5의 완전 동일성 기준에 따라 생산 코드와 테스트 파일은 변경하지 않고 `report0719.md` 4.18에 위험·선행 계약만 기록

#### 4.6 HUD metrics scalar화 — 보고 전용

- [x] `game_scene_hud_renderer.js` 전체와 직접 호출자를 감사해 metrics identity가 외부로 노출되지 않고 프레임당 ordinary object 1개가 생성되는 후보 확인
- [x] 실제 production 전체 legacy/인라인 후보를 격리 VM에 로드해 native intrinsic 환경의 6개 render command 직렬화 결과 exact 일치 확인
- [x] stack-sensitive mutable `Math.max` 반례에서 기존 helper frame 판정 `[true, true]`, scalar 후보 `[false, false]` 및 반환값 분기에 따른 최종 render command 차이 확인
- [x] 실제 `font_util.js`의 stack-sensitive `Number.isFinite` 반례에서 기존 계산 폰트 2개가 후보의 fallback `12px`로 바뀌고, 재진입 render 반례에서 완료 명령 `0` 대 `12` 및 sentinel 전파 차이 확인
- [x] renderer 인라인 시 교체된 `render()`의 helper frame 관찰 차이와 OOM·heap 관찰 위험까지 교차 감사
- [x] 모든 edge case의 완전 동일성을 보장할 수 없어 생산 코드와 테스트 파일은 변경하지 않고 `report0719.md` 4.19에 위험·선행 계약만 기록

#### 4.7 신규 SRP·숫자 helper 재사용 후보 — 보고 전용

- [x] 670줄 `UIElementFactory`의 타입 dispatch·8종 생성·버튼 측정·pool·accessor/legacy props 책임 집중과 유일한 생산 호출 경로를 감사
- [x] `handler.call(this)`, dummy/실제 요소의 pool 획득 순서, `item.props.font` mutation, getter·Proxy·`delete` 예외 전 부분 상태를 완전히 고정할 전용 테스트가 없어 구조 분리를 보류하고 `report0719.md` 3.10에 기록
- [x] `ReleaseSimulationProfiler.#publishSnapshot()`의 ring 탐색·typed-array 정렬·rate/quantile·live snapshot 갱신·counter reset 결합을 감사
- [x] capacity wrap·임계 timestamp 동률·역행 시간·집계 예외/재진입의 exact 계약이 없어 구조 분리를 보류하고 `report0719.md` 3.11에 기록
- [x] `GameMapGrid.resolvePositiveNumber()`와 양수 조건을 유지한 공용 `resolveFiniteNumber()` wrapper 위임 후보를 일반·특수 입력 126건에서 비교해 일치를 확인했지만, stack-sensitive mutable `Number.isFinite`의 `(7, 1)` 반례에서 기존 `7`·위임 후보 `1` 차이를 확인
- [x] 사용자 지시 5·6의 완전 동일성 기준에 따라 세 후보 모두 생산 코드·테스트를 변경하지 않고 상세 위험과 선행 gate만 `report0719.md`에 기록
- [x] 문서 반영 후 전체 `npm test` 170개, JS/MJS 367개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use 실제 게임 cold start에서 타이틀·동적 도형, 설정 glass 오버레이, 취소 뒤 타이틀 렌더 복원, 종료 확인 오버레이와 정상 프로세스 종료 확인
- [x] 보고서만 확장하고 실행 구조를 바꾸지 않았으므로 `AGENT_GUIDE.md` 갱신 불필요
- [x] GitHub Desktop 커밋 및 푸시: `d315084 Document audited optimization gates`

#### 4.8 타이틀 메뉴·설정 overlay·parallax 정밀 감사 — 보고 전용

- [x] 여섯 title menu 파일의 UI scale 정규화 6개·정적 호출 지점 16곳을 전수 확인하고 native 16개 edge 입력에서는 반환·예외 parity가 일치함을 검증
- [x] 공용 위임 시 mutable `Number.isFinite`의 stack/import 경계, font·pane rectangle·render state·texture signature와 최종 픽셀까지 달라질 수 있어 생산 통합을 보류하고 `report0719.md` 4.29에 기록
- [x] 558줄 `SettingsOverlay`의 layout 조립, control callback, preview queue·cancel·save·runtime apply·close rollback 책임과 빈 keybindings 진입점을 감사
- [x] 기존 keybindings route가 없고 overlay 동작 회귀 테스트도 없어 임의 구현·SRP 분리를 보류하고 `report0719.md` 3.12에 exact trace·pixel 선행 gate를 기록
- [x] steady-state 목표 378개 parallax 적이 모두 존재하는 frame에서 softness 색 혼합 378회·`cssToRgb` 756회와 draw override literal 756개/frame이 발생함을 실제 상수·호출 경로로 재계산
- [x] live `ColorSchemes`·최신 `ColorUtil`·mutable intrinsic, 가변 profile/getter, custom draw의 override 보관·변경·재진입 때문에 blind cache/scratch 재사용은 NO-GO로 판정하고 새 불변 계약·조건부 fast path·0바이트 pixel gate를 `report0719.md` 5.8·5.9에 기록
- [x] 사용자 지시 5·6의 완전 동일성 기준에 따라 생산 코드와 테스트는 변경하지 않고 보고서·진행 기록만 갱신
- [x] 독립 리뷰 3건 승인, 전체 `npm test` 181개, JS/MJS 368개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary 3종, `git diff --check` 통과
- [x] Computer Use 실제 게임 cold start에서 타이틀 동적 도형, 설정 glass·blur·scale·alpha, 취소 뒤 타이틀 복원, 맵 preview·취소 복원, 종료 확인 overlay와 정상 프로세스 종료 확인
- [x] 실행 구조 변경이 없으므로 `AGENT_GUIDE.md` 갱신 불필요
- [x] GitHub Desktop 커밋 및 푸시: `e5bb5ca Document title rendering audit gates`

## 5. JSDoc 정합성 정비

#### 5.1 공간 broad-phase 및 마우스 포커스 계약 정정 — 완료

- [x] `EnemySpatialIndex.forEachInCircle()` 구현과 직접 호출자를 대조해 AABB 셀 broad-phase, visitor 원형 판정, 무효 입력, `false` 조기 종료 및 방문 수 계약을 정확히 문서화
- [x] `getMouseFocus()` 직접 호출 경로를 대조해 `string[]` 내부 참조, 스택 top, 제자리 변경·새 배열 교체 및 참조 수명 계약을 문서화
- [x] `setMouseFocus()`와 `MouseInputHandler.setFocus()`의 `string|string[]`, 배열 얕은 복제, 단일 문자열 래핑 및 전체 교체 계약을 동기화
- [x] 세 파일의 모든 JSDoc 블록을 제거한 실행 본문이 `HEAD` 기준과 byte-for-byte 동일함을 별도 비교로 확인
- [x] `npm test` 49개, JS/MJS 349개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary 통과
- [x] Computer Use 완전 재실행, 설정·benchmark 진입·적 100개 생성: 181 FPS, fixed 60.0/s, SIM 99.8–99.9%, debt 0.0/s; 종료 후 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `4a42e1a Correct spatial and input API documentation`

#### 5.2 설정 저장·미리보기 계약 정정 — 완료

- [x] `SettingHandler`, `SaveSystem`, `SettingsPreviewQueue`, `SettingsOverlay` 구현과 직접 호출자를 전체 대조해 현재값 복사, 타입 보정, 조건부 hidden 저장 및 Promise 반환 계약을 문서화
- [x] schema 조회가 복제본이 아닌 live 내부 참조임을 명시하고, 미리보기 호출 자체의 무저장과 메모리 값의 후속 저장 가능성을 구분
- [x] theme 즉시 효과, 같은 대기 묶음의 last-value-wins, cancel 비저장 원복, overlay 저장 결과가 초기/임시 상태 비교 결과임을 정확히 반영
- [x] 추가·삭제 206개 행이 모두 JSDoc/주석임을 확인: `COMMENT_ONLY_EXECUTABLE_SOURCE_IDENTICAL`
- [x] `npm test` 50개, JS/MJS 350개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] Computer Use로 설정 오버레이에서 `어둡게 → 밝게` 즉시 미리보기와 `취소` 후 원래 어두운 테마·정상 타이틀 복원을 확인
- [x] GitHub Desktop 커밋 및 푸시: `06146d6 Correct settings persistence documentation`

#### 5.3 진행도·인게임 저장 및 파일 helper 계약 정정 — 완료

- [x] `ProgressHandler`, `IngameHandler`, `_save_file_helper.js`와 직접 호출자를 전체 대조해 생성자 경로, `Promise<void>`, live/stale 참조, 자동 저장 여부와 오류 전파 계약 문서화
- [x] production 변경 전 실행 계약 8개 green·JSDoc 구조 1개 red를 확인하고, 독립 리뷰에서 찾은 선언 선행 JSDoc false-positive와 typed-array realm 공백을 보강해 변경 후 10개 전체 green으로 고정
- [x] 세 실제 production 파일 전체를 `vm.SourceTextModule`로 실행하고 `nw_bridge.js`의 파일 시스템만 synthetic으로 교체해 실제 분기와 호출 순서를 검증
- [x] `access()`의 모든 오류 축약, 디렉터리 타입 미확인, recursive mkdir 실패, JSON round-trip 손실·직렬화 훅·순환·`BigInt`·최상위 미지원 값 예외를 고정
- [x] 진행도 길이 0/1/127/128/129/4,096, 자르기·기본값 padding, 잘못된 입력, 파일 부재·읽기 실패, same-realm/foreign `Uint8Array`·Buffer·foreign 일반 배열 경계를 검증
- [x] 인게임 `null`/false/0·알 수 없는 키 보존, 최상위 키만 보완, 중첩 미병합, live/stale 참조, 파일 부재·잘못된 JSON·배열 root·자동 보완 저장 실패·직렬화 실패를 검증
- [x] 세 production 파일의 JSDoc 제외 실행 소스 SHA-256이 기존 기준과 exact 일치하고 one-off 주석 제거 본문도 `COMMENT_ONLY_EXECUTABLE_SOURCE_IDENTICAL` 확인
- [x] `npm test` 85개, JS/MJS 354개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] 독립 재검토에서 각 선언 바로 앞 JSDoc 오라클과 isolated typed-array realm 테스트 blocker 없음 확인
- [x] Computer Use cold start 후 타이틀·설정 glass 오버레이 정상; benchmark 적 100개 생성 후 활성 97개, 181 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 재실행해 정상 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `adefbb8 Correct save handler API documentation`

#### 5.4 월드 렌더 상태·void 반환 계약 정정 — 완료

- [x] `game_scene_world_renderer.js` 전체와 직접 호출자를 대조해 `resolveWorldRenderState(options, out)`의 writable caller-owned `out`, same identity 반환, snapshot 우선 및 제자리 기록 계약을 문서화
- [x] 선택된 맵·플레이어 객체와 유효 입력 배열의 live 참조, 기존 extra field 유지, shared frozen empty fallback 및 예외 전 순차 부분 쓰기를 JSDoc에 명시
- [x] 반환이 `void`인 `renderGameMap`, `renderWall`, `renderCircleEntity`, `renderPlayer`, `renderProjectile`, `drawGameSceneWorldObjects` 6곳의 누락 `@returns` 보완
- [x] production JSDoc 제거 실행 소스 SHA-256 `186b680c56fe506a4d57def6e20bbc8f26506eeb06b9be701be1a4818adced0d` exact 보존
- [x] 실제 world renderer와 실제 `game_scene_snapshot_utils.js`를 VM에 링크해 same out identity, 맵·플레이어·배열 live 참조, invalid snapshot 배열 fallback, extra field, shared frozen empty, ±0·비유한·문자열 offset 및 배열 getter 두 번째 접근 예외의 부분 쓰기 검증
- [x] 별도 계약 테스트 4개와 전체 `npm test` 97개, JS/MJS 356개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] 두 독립 리뷰에서 빈 `{}` out 허용, live 객체 범위, getter 2회 평가, cross-realm 예외 및 actual snapshot utility 연결을 보강한 뒤 blocker 없음 확인
- [x] Computer Use cold start·설정 benchmark 진입: 기본 181 FPS, 박스·투사체·적 100개 생성 후 178–179 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 벽·박스·투사체·적·HUD 정상 렌더 및 정상 종료 확인
- [x] GitHub Desktop 커밋 및 푸시: `bd83447 Document world render state contracts`

#### 5.5 디버그 오류 처리 계약 정정 — 완료

- [x] `DebugSystem.errThrow()`와 `ErrorHandler.errThrow()` 구현·직접 호출자를 대조해 message 문자열화, strict level 분기, console 호출 순서, 오류 identity 및 throw 계약을 문서화
- [x] 공개 adapter가 인스턴스 생성 전·초기화 전에는 `TypeError`를 던지고, 초기화 후에는 현재 handler를 receiver로 동기 위임하되 반환값을 버리는 실제 수명주기 계약을 보완
- [x] 생산 변경 전 행동 계약 6개 green·JSDoc 구조 1개 red를 확인하고, 경계·수명주기 검증을 확장해 변경 후 actual-source 테스트 9개 전체 green으로 고정
- [x] `undefined`·`null`·false·±0·`NaN`·`BigInt`·`Symbol`·custom coercion·null-prototype·revoked Proxy, 미지원/boxed level, console·`captureStackTrace` 예외와 truthy/falsy 오류 값을 검증
- [x] console prefix/두 번째 인수의 호출 순서, 각 호출 지점 예외, 전달 오류의 same identity 재던지기, falsy 오류의 새 `Error`, `captureStackTrace(error, ErrorHandler._throwError)` 인수를 exact 비교
- [x] JSDoc 전체 블록을 제거한 생산 실행 소스 SHA-256이 `debug_system.js`의 `ada62833709160de3fdd1e0fbfd930537a7d3eaa4f7766fa88bfa0cec5d07737`, `_error_handler.js`의 `72e14003640956d4818134babcb04dda2c74afde326ab93fd194f5b058e761dd`로 기존 기준과 exact 일치
- [x] Computer Use로 실제 배포 NW.js Chromium 145에서 `document.all`의 falsy IsHTMLDDA·비-nullish 특성, message 문자열화, 오류 대체·identity·로그 순서·stack capture를 actual production handler로 검증: `PASS — Debug error contract`
- [x] `npm test` 116개, JS/MJS 361개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] 독립 리뷰에서 production JSDoc·actual-source 하네스·NW runner에 blocker 없음 확인
- [x] GitHub Desktop 커밋 및 푸시: `d909405 Correct debug error API documentation`

#### 5.6 시간 델타·보간·current instance 계약 정정 — 완료

- [x] `time_handler.js`, 실제 숫자 유틸과 14개 직접 import 경로를 대조해 분리돼 있던 클래스 JSDoc을 선언에 연결하고, 엄밀한 단일 인스턴스가 아닌 “가장 최근에 생성이 시작된 current instance” 계약으로 정정
- [x] 생성 전 `handler=null`·frame/fixed delta 0·alpha 1, 정상 생성 직후 delta `1 / 60`·alpha 0, 생성 교체·clock 재진입·clock 예외 뒤 부분 초기화 인스턴스 노출을 actual-source로 검증
- [x] `update()`의 `Number()` coercion, 양수 유한 주입, clock fallback, 2~100ms clamp, 주입 시 `timeBefore` 불변, 역행·비유한 clock, 정규화 예외 전 부분 쓰기와 custom coercion·재진입을 고정
- [x] `updateFixed()`의 명시값·기본 인수·비유한 fallback과 `fixedStepSeconds` getter 0/1/2/3회 평가, eager getter·coercion 예외 identity를 검증하고 JSDoc에 실제 좌→우 평가 순서 반영
- [x] 보간 alpha와 `_normalizeDeltaMs()`의 ±0·subnormal·±최대값·±Infinity·`NaN`·문자열·boolean·`BigInt`·`Symbol`·null-prototype·revoked Proxy 경계, 공개 getter의 live identity·예외 전파 검증
- [x] 생산 변경 전 정정된 하네스에서 행동 8개 green·JSDoc 구조 1개 red를 확인하고, 독립 리뷰 보강 뒤 actual production `time_handler.js`+`number_util.js` 계약 12개 전체 green으로 고정
- [x] JSDoc 전체 블록을 제거한 production 실행 소스 SHA-256 `bd148937177cb73c7b6b648db02ca23e683ac5408f8649d206a62e423582f15d`를 기존 기준과 exact 유지
- [x] Computer Use 실제 NW.js Chromium 145에서 falsy·strict non-nullish `document.all`의 `Number(...) = NaN`, 생성 전/후 기본값, 2ms 정규화, fixed `1 / 60`, alpha 0, clock fallback 100ms 상한을 actual production 모듈로 확인: `PASS — TimeHandler contract`
- [x] `npm test` 128개, JS/MJS 363개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use 정상 게임 cold start·타이틀 복원과 benchmark 확인: 기본/적 100개 후 181 FPS, fixed 60.0/s, SIM 100.0~100.6%, debt 0.0/s, 활성 적 93개 및 이동·합체·렌더 정상
- [x] 독립 리뷰가 `-0` 검사 위치, eager getter 예외, 변환 실패 0회, 생략 3회, 정규화 예외 문서 누락을 찾아 보강했으며 최종 blocker 없음 확인
- [x] 완전 동일성을 깨는 생성 실패·오래된 clock·초대형 delta·mutable fixed fallback 개선은 생산 코드 대신 `report0719.md` 4.22에 기록
- [x] GitHub Desktop 커밋 및 푸시: `10355d0 Correct TimeHandler API documentation`

#### 5.7 애니메이션 완료·지연 정리·공개 adapter 계약 정정 — 완료

- [x] `animation_system.js`, 실제 animation base/standard/persistent/mixed 구현과 `ObjectPool`을 전체 대조해 `remove()`가 즉시 삭제가 아니라 `complete()` 동기 호출만 수행하는 계약으로 JSDoc 정정
- [x] 생산 변경 전 actual-source 행동 9개 green·JSDoc 구조 1개 red를 확인하고, 독립 리뷰의 Map/complete 접근·호출, 역순 순회, adapter 반환 지적을 보강해 변경 후 11개 전체 green으로 고정
- [x] 이미 획득한 Promise resolver의 동기 호출과 반응 콜백의 마이크로태스크 실행, owner 속성/endValue 불변, Map·activeAnimations·표준 풀 반환의 후속 `update()` 지연을 실제 모듈 그래프로 검증
- [x] delta 해석 예외 시 순회 전 보류, tick 모드 불일치·0 delta에서도 FINISHED 우선 정리, 역순 update 재진입에서 미순회 대상은 현재·이미 순회한 대상은 다음 update에 정리되는 순서를 exact 검증
- [x] 음수·`-0`·문자열 `"0"`·`0n`·`NaN`·±Infinity·`Symbol`·throwing coercion, ID Map property/get 접근 및 `complete` property/call 예외 identity와 부분 등록 상태를 검증
- [x] 공개 adapter의 생성 전 `TypeError`, 가장 최근 시스템 위임, 시스템별 ID 충돌, 교체된 `remove` getter 예외와 반환값 passthrough를 실제 production export로 고정
- [x] JSDoc 전체 블록을 제거한 production 실행 소스 SHA-256 `532335a71bcd27249ce9044fc5a34fa135543251873aa771aefeaf1a77299b73`을 기존 기준과 exact 유지
- [x] `npm test` 139개, JS/MJS 364개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use cold start 후 타이틀·설정 전환 정상; benchmark 기본 181 FPS/fixed 60.0/s/SIM 100.2%/debt 0, 적 100개 생성 후 활성 96개에서 181 FPS/fixed 60.0/s/SIM 100.0%/debt 0 및 이동·합체·렌더 정상, 종료 확인 대화상자로 정상 종료
- [x] 두 차례 독립 최종 리뷰에서 “정리 예약” 과장, Map·complete 접근 예외, adapter live 반환 계약을 보강한 뒤 blocker 없음 확인
- [x] pooled animation의 이전 owner 보존·과거 handle Promise 별칭·변조 ID stale Map·최신 시스템 ID 충돌 개선은 완전 동일성을 보장할 수 없어 생산 코드 대신 `report0719.md` 4.23에 기록
- [x] GitHub Desktop 커밋 및 푸시: `bf02bae Correct animation removal API documentation`

#### 5.8 유틸리티 최신 인스턴스·nullable 계약 정정 — 검증 완료

- [x] `math_util.js`, `color_util.js`, `runtime_tool.js` 전체와 생성·소비 경로를 감사해 엄밀한 단일 싱글톤이 아니라 생성 전 `null`, 생성 후 가장 최근 인스턴스의 live identity를 반환하는 계약 확인
- [x] `MathUtil`의 실제 구현에 없는 `Simplex Noise` 설명을 제거하고 시드 기반 난수, 각도·벡터 변환, 감쇠와 범위 제한이라는 현재 기능으로 정정
- [x] 세 accessor의 반환형을 `MathUtil|null`, `ColorUtil|null`, `RuntimeTool|null`로 정정하고 다중 생성 시 최신 인스턴스로 교체되는 사실을 문서화
- [x] `RuntimeTool`은 생성자 첫 문장에서 등록된 뒤 `_externalURLHandler`를 초기화하므로 setter 예외 시 부분 인스턴스가 남고, 초기화 재진입 시 가장 나중에 등록된 내부 인스턴스가 유지되는 계약까지 문서·테스트에 반영
- [x] 생산 변경 전 실행 해시·행동 4개 green·JSDoc 구조 1개 red를 확인하고, 변경 후 accessor name/length, 생성 전 null, 첫/둘째 identity, 이전 상태 보존, `new` 없는 호출, handler 비승계, 초기화 예외·재진입을 포함한 actual-source 6개 전체 green
- [x] JSDoc 제거 production 실행 소스 SHA-256 exact 보존: MathUtil `b9b2376f1d0a5636d9cf818451514cf23a5566afe79aa51204d15379655ec54d`, ColorUtil `2eef69a1a3bc8291e13a3576481676f25029d35f07aa8fe61ea90063d7b8ebf4`, RuntimeTool `edffe87defef7d1af5ed3256459ec4df42683cb004bd45f873a3847eab5a803b`
- [x] `npm test` 145개, JS/MJS 365개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] 독립 감사에서 호출자 nullable 가정·다중 생성·부분 초기화·handler 비승계와 production/test diff를 재검토해 blocker·과장 없음 확인; 구조 변경이 없어 `AGENT_GUIDE.md` 갱신 불필요
- [x] Computer Use 실제 게임 cold start에서 타이틀 렌더링, 설정 glass 오버레이 진입·취소 후 타이틀 복원, 종료 확인 오버레이와 정상 종료까지 확인
- [x] GitHub Desktop 커밋 및 푸시: `53f19e9 Correct utility singleton API documentation`

#### 5.9 BaseOverlay 확장 훅 JSDoc·가이드 계약 정정 — 검증 완료

- [x] `_base_overlay.js` 전체와 하위 클래스·내부 dispatch를 감사해 `_calculateGeometry`, `_onResize`, `_generateLayout`의 잘못된 `@private`를 `@protected`로 정정하고 `_getPanelDefinitions`, `_drawOverlayDecorations`, `onCloseComplete`의 누락된 `@protected`를 추가
- [x] 값 없이 종료하는 여섯 확장 훅에 `@returns {void}`를 명시하고, `_releaseElements`의 누락 반환 계약까지 보강
- [x] production 변경 전 실행 해시와 하위 클래스 소스·내부 dispatch 2개 green, JSDoc 구조 1개 red를 확인한 뒤 누락 훅 보강 RED 2건을 추가 확인하고 최종 actual-source 전용 4개 전체 green
- [x] JSDoc 제거 production 실행 소스 SHA-256 exact 보존: BaseOverlay `d050e03b4e345ef4608fb563bd9da575c77cae81d88dbfbfbd667ae69d430933`
- [x] 로컬 `ui_overlay_guide.md`, `reference/overlay_contract_guide.md`를 실제 기본 프리셋 `0.5초`·`10px`·`easeOutExpo/easeInExpo`, 선택 hook, Start→`mapSelect` 흐름으로 갱신하고 actual-source 대조 임시 테스트를 1/4 RED에서 4/4 GREEN으로 확인
- [x] 두 로컬 overlay 가이드는 기존 allowlist형 `.gitignore` 정책상 비추적 문서이므로 저장소 정책과 검증 범위 밖 기존 문서를 원격에 새로 추가하지 않고, 커밋되는 테스트도 ignored 파일에 의존하지 않도록 정리
- [x] 최종 `npm test` 149개, JS/MJS 366개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] 독립 감사에서 7개 protected 훅·6개 void 훅, 하위 클래스 사용, 기본 프리셋과 맵 선택 흐름을 재검토해 blocker·과장 없음 확인; 실행 구조 변경이 없어 `AGENT_GUIDE.md` 갱신 불필요
- [x] Computer Use 실제 게임 cold start에서 설정 overlay 열기·취소, 맵 선택 overlay의 glass·미리보기 장식 렌더와 취소, 타이틀 복원, 종료 overlay 및 정상 종료 확인
- [x] GitHub Desktop 커밋 및 푸시: `063979c Correct BaseOverlay extension hook documentation`

#### 5.10 ThemeHandler live palette·최신 adapter 계약 정정 — 검증 완료

- [x] `_theme_handler.js` 전체와 초기화·설정 호출 경로를 감사해 `ColorSchemes`가 초기 빈 객체이고 모든 import가 같은 identity를 공유하며, 테마의 최상위 enumerable 자체 문자열·Symbol 속성만 얕게 복사하는 실제 계약을 문서화
- [x] `ThemeHandler` 생성자가 기본 필드 쓰기보다 먼저 자신을 최신 module adapter 대상으로 등록하고, 공개 `setTheme()`은 생성 전 no-op·생성 후 가장 최근 인스턴스에 위임하며 `getCurrentThemeKey()`는 인스턴스·메서드·반환값이 없을 때 기본 키로 복구하는 계약을 정정
- [x] `init()`의 `Promise<void>`, instance/exported `setTheme()`과 `updateBackgroundColor()`의 `void` 반환 및 파일 오류 복구와 테마 적용 예외 전파를 JSDoc에 추가
- [x] production 변경 전 실행 해시·행동 4개 green과 JSDoc 구조 1개 red를 확인하고, 독립 감사에서 지적한 setter/getter·Proxy·재진입·부분 실패 경계를 보강해 actual-source VM 계약 21개 전체 green으로 고정
- [x] primitive boolean/string 정규화, boxed string·객체 Proxy·Symbol·상속 key fallback, display 인수 truthiness, 생성 실패·constructor setter 재진입과 최신 인스턴스 교체를 검증
- [x] enumerable 문자열 삭제, 비열거·Symbol 잔존과 같은 Symbol overwrite, non-configurable/seal/preventExtensions, 비열거 setter, prototype Proxy의 true·false·throw·재진입 결과를 exact 검증
- [x] source Proxy의 `ownKeys→descriptor→get` 순서, getter 예외의 부분 복사, getter·resolver 재진입의 hybrid/split state, 배경 getter 2회 평가·falsy 단락·RGB 비유한 passthrough와 color/display 예외 후 롤백 부재를 검증
- [x] 정상 settings 파일의 `theme` 문자열 우선·legacy `darkMode` 변환·invalid theme 기본 키 정규화와 현재 키 adapter의 메서드 부재·property/call 예외 전파를 검증
- [x] JSDoc 전체 블록을 제거한 production 실행 소스 SHA-256 `5c0a51f5c1b5558e010a50a9e0ae51b3a033aed5d5f4501c2581daa87fc9c560` exact 보존
- [x] 독립 재감사에서 A~G edge 전체 해소, 잘못 고정된 기대값·blocker 없음 확인 후 마지막 settings/상속 key 공백까지 추가 보강
- [x] 최종 `npm test` 170개, JS/MJS 367개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use 실제 게임 cold start에서 설정 overlay의 어두운→밝은 테마 즉시 전환, 취소 뒤 어두운 테마·타이틀 렌더 복원, 종료 overlay와 정상 프로세스 종료 확인
- [x] GitHub Desktop 커밋 및 푸시: `f94199c Document live theme palette contracts`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.11 overlay animation preset 직접 조회 계약 정정 — 검증 완료

- [x] `overlay_animation_presets.js`와 유일한 실제 소비자 `BaseOverlay`, `DATA_REGISTRY` 호환 파사드를 전체 감사해 현재 호출은 `undefined` 기본 경로만 사용하지만 공개 resolver 자체는 임의 입력을 그대로 프로퍼티 키로 사용하는 사실을 확인
- [x] 기존의 “유효하지 않은 문자열이면 기본 프리셋” 설명을 truthy 직접 조회, falsy fallback, own-key/type 검증 부재, 성공 경로의 두 번째 조회 및 키 변환·예외·두 조회 사이 결과 보존 계약으로 정정
- [x] production 변경 전 actual-source 행동 10개 green과 JSDoc 구조 1개 red를 확인하고 문서만 바꾼 뒤 전용 11개 계약 전체 green으로 고정
- [x] 유효 키 3종, 표준 falsy 8종, truthy 미등록 문자열·숫자·boolean·Symbol, boxed string, `toString`·`constructor`·`__proto__`·`hasOwnProperty` 상속 키를 exact identity로 검증
- [x] `Symbol.toPrimitive` 첫 성공/둘째 다른 키·미등록 키, 첫 실패의 단일 변환, 첫째·둘째 변환 예외 identity와 null-prototype 키의 cross-realm `TypeError`를 검증
- [x] 호환 파사드의 기본 키·프리셋 테이블·resolver가 data 모듈 및 `getData()` 결과와 같은 production 참조임을 검증
- [x] 독립된 세 JSDoc 블록만 제거한 actual production source SHA-256 `69f9153afc6f0a811dba8afacb3494ad2ccd220638ddc3b6813315be6e76468b` exact 보존
- [x] 전체 `npm test` 181개, JS/MJS 368개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary 모두 통과
- [x] 실행 구조 변경이 없는 6줄 JSDoc 교체이고 이후 실행 코드 행 번호도 보존했으므로 `AGENT_GUIDE.md` 갱신 불필요
- [x] Computer Use 실제 게임 cold start에서 설정·맵 선택 오버레이의 기본 프리셋 열림/닫힘, glass·blur·scale·alpha 렌더, 타이틀 복원, 종료 확인 오버레이와 정상 프로세스 종료 확인
- [x] GitHub Desktop 커밋 및 푸시: `68ac193 Correct overlay preset resolver documentation`

#### 5.12 `UISystem.init()` 순차 부트·Promise 계약 정정 — 검증 완료

- [x] `ui_system.js`와 유일한 production caller `SystemHandler.init()`을 전체 대조해 기존 JSDoc이 cursor만 언급하고 tooltip 순차 대기·live 재조회·Promise/오류 계약을 누락한 사실을 확인
- [x] production 변경 전 actual-source 행동·해시 8개 green/JSDoc 구조 1개 red, 리뷰 보강 뒤 행동·해시 9개 green/JSDoc 1개 red를 확인하고 최종 전용 계약 10개 전체 green으로 고정
- [x] cursor→tooltip deferred 순서, 원래 receiver, property/init getter 1회, 하위 반환값 폐기와 최종 `undefined`, 호출별·하위와 다른 Promise identity를 검증
- [x] cursor/tooltip property 접근·init 접근·동기 호출·then getter/본체 선행 throw·thenable/native Promise reject의 동기 throw 부재와 같은 오류 identity rejection, 첫 단계 실패 시 tooltip 미호출을 검증
- [x] 두 단계 모두 thenable이 resolve한 뒤 throw하는 값을 first-settlement-wins 규칙으로 무시하고 최종 `undefined`로 이행하는 경계를 검증
- [x] 첫 await 중 tooltip 교체, 동시 2회 호출, cursor 재진입과 중복 guard 부재, null receiver의 비동기 `TypeError`를 actual production 모듈로 검증
- [x] 실제 `SystemHandler` production 소스를 VM에서 실행해 UI init 이행 전 `UISystem 로드` 로그와 ObjectSystem 생성·초기화가 진행되지 않는 부트 경계를 검증
- [x] standalone JSDoc 11개와 종결 개행을 제거한 production 실행 소스 SHA-256 `75b73fa1387573634ca1c26941b1647b97cc401a78bc103907863a449da472a5` exact 보존
- [x] 독립 리뷰에서 first-settlement-wins 과장을 발견해 문서·오라클을 보강하고 최종 blocker 없음 승인; 전체 `npm test` 191개, JS/MJS 369개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀, ABI canary 3종, `git diff --check` 통과
- [x] Computer Use 실제 게임 2560×1440 cold start에서 타이틀/UI 초기화, 설정 glass overlay 진입·취소, 맵 선택 preview 진입·취소, 각 타이틀 복원, 종료 확인 overlay와 정상 프로세스 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `a198eaa Document UISystem initialization contract`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.13 `DisplaySystem.init()` 렌더 surface 부트·Promise 계약 정정 — 검증 완료

- [x] `display_system.js`, 실제 surface descriptor/data 모듈과 유일한 production caller `SystemHandler.init()`을 전체 감사해 기존 한 줄 JSDoc이 두 await gate, 7개 surface 등록, backing 동기화, live 조회·Promise·부분 실패 계약을 누락한 사실을 확인
- [x] production 변경 전 actual-source 실행 계약 10개 green/JSDoc 구조 1개 red를 확인하고, 독립 리뷰 보강 뒤 실행 계약 11개 green/JSDoc 구조 1개 red를 다시 확립한 다음 JSDoc만 정정해 전용 계약 12개 전체 green으로 고정
- [x] theme 이행→저장 테마 적용→overlay host→`background`·`object`·`effect`·`texteffect`·`ui`·`vignette`·`top` 등록→배경색→screen 이행→backing→resize의 exact 순서와 surface order/mode/persistent/composite/revision을 검증
- [x] `ColorSchemes.Background` 첫 조회가 falsy이면 1회만 읽고 모든 색상 의존성을 건너뛰며, truthy이면 변환 인수로 다시 live 조회하는 조건부 2회 계약과 `colorUtil`/`cssToRgb`·캡처된 WebGL callee·`r→g→b` 숫자 변환·255 나눗셈·clamp 부재를 검증
- [x] screen await 중 handler·`surfaceMap` 변경, `surfaceMap.values()` live iterator의 새 키 방문·미방문 키 삭제 skip·삭제 후 재삽입 tail 방문과 Map 프로퍼티 교체 뒤 기존 iterator 유지, backing canvas 부분 쓰기, 마지막 live `resize()` 및 반환 thenable 폐기를 검증
- [x] theme/screen property·method 접근, 호출, then getter/본체, inner Promise 거부가 호출 시 동기 throw 없이 같은 오류 identity로 reject하고, 정확한 thenable receiver 및 첫 resolve/reject 호출 뒤 adopted 값이 pending이어도 추가 결과·throw를 무시하는 경계를 검증
- [x] 등록·backing·resize 각 실패가 이미 반영된 surface/revision/canvas 부분 상태를 rollback하지 않는 사실과, 동시 `init()` 두 호출이 독립 Promise·중복 등록을 만들고 두 순회 모두 최종 revision 8~14 descriptor 세대를 방문하는 재진입 guard 부재를 직접 계측
- [x] 실제 `SystemHandler` production 소스를 VM에서 실행해 Display init 정착 전 `DisplaySystem 로드` 로그와 `AnimationSystem` 생성 단계로 진행하지 않는 부트 경계를 검증
- [x] standalone JSDoc과 CRLF를 제거·정규화한 production 실행 소스 SHA-256 `9c66acfec48a4f9521e6f4ceeddc41d67a244842bcfe98989a0558fe0c58263b` exact 보존
- [x] 두 독립 최종 리뷰가 조건부 조회·first-call thenable·전체 event 순서·Map 변이·동시 최종 descriptor 세대 검증을 재검토해 blocker 없음 승인
- [x] 전체 `npm test` 203개, JS/MJS 370개 `node --check`, WASM 전용 16개, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary 3종, `git diff --check` 모두 통과
- [x] Computer Use 완전 재실행으로 2560×1440 타이틀 렌더, 설정 glass overlay 진입·취소, `ㄷ자 회랑` 맵 선택 preview 진입·취소, 각 타이틀 복원, 종료 확인 overlay와 정상 프로세스 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `01edb73 Document DisplaySystem initialization contract`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.14 WebGL layer alias resolver PropertyKey·fallback 계약 정정 — 검증 완료

- [x] `display_surface_descriptor.js`, 실제 frozen `display_surface_data.js`와 `DisplaySystem`의 `renderGL()`·`renderGLShapeInstances()`를 대조해 기존 `{string}` 문서가 실제 임의 입력·비문자열 반환·상속 조회·예외 계약을 누락한 사실을 확인
- [x] production 변경 전 실행 계약 10개 green/JSDoc 구조 1개 red를 확립하고, 세 방향 독립 리뷰에서 찾은 actual data drift·문서 polarity·bulk 대칭 오류·재진입 reachability·입력 pass-through false-green을 모두 보강한 뒤 JSDoc만 정정해 전용 11개 전체 green으로 고정
- [x] 실제 alias 4종과 ordinary prototype의 `toString`·`valueOf`·`constructor`·`__proto__`, truthy 객체·모든 표준 falsy 값, `null`·`undefined`·±0·`NaN`·±Infinity·BigInt·boolean·Symbol·객체 key의 반환 identity를 검증
- [x] 표준 `ToPropertyKey`의 `toString → valueOf` fallback·Symbol 생성·비원시 반환 `TypeError`, Proxy/getter receiver, coercion·map get 양쪽 재진입, live own→prototype 값 변경과 key/map 오류의 same identity 동기 전파를 actual production resolver로 검증
- [x] 두 실제 render caller가 resolver 완료 뒤 최신 singleton의 handler→method를 live 조회하고 정확한 receiver·인자 수·strict identity·반환 계약을 보존하며, handler/method/call 오류와 non-callable `TypeError`를 변환하지 않음을 검증
- [x] production에서 가능한 object key의 `Symbol.toPrimitive` 중 `DisplaySystem` 교체로 단일·bulk caller가 최신 singleton을 사용하는 순서를 고정하고, key 변환 오류 시 handler getter가 실행되지 않는 gate를 검증
- [x] JSDoc 전체 블록을 제거한 production 실행 소스 SHA-256 `76be28d1edda8705df26284b47aa4b6c0657d7db22d902e0dcc6c9d08c6a215f` exact 보존; 세 독립 최종 리뷰가 문서·실행·하네스 blocker 없음 승인
- [x] 전체 `npm test` 214개, JS/MJS 371개 `node --check`, WASM 전용 16개, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary 3종, `git diff --check` 모두 통과
- [x] Computer Use 실제 게임 2560×1440 cold start에서 타이틀 렌더, 설정 glass overlay 진입·취소, `ㄷ자 회랑` 맵 선택 preview 진입·취소, 각 타이틀 복원, 종료 확인 overlay와 정상 프로세스 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `a7c4296 Document WebGL layer alias contract`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.15 정적 surface 기본 order PropertyKey·fallback 계약 정정 — 검증 완료

- [x] `display_surface_descriptor.js`, 실제 frozen `display_surface_data.js`와 factory caller `createDisplaySurfaceDescriptor()`를 대조해 기존 `{string}`→`{number}` 문서가 실제 PropertyKey 변환·상속 조회·비숫자 반환·예외 계약을 누락한 사실을 확인
- [x] production 변경 전 실행 계약 7개 green/JSDoc 구조 1개 red를 확립하고, 독립 리뷰에서 찾은 actual map의 falsy drift·key 변환 재진입·오류 경계를 보강한 뒤 JSDoc만 정정해 전용 8개 전체 green, alias resolver와의 결합 19개 전체 green으로 고정
- [x] 실제 frozen order 맵의 own key·값 `background: 0`, `object: 10`, `effect: 20`, `texteffect: 30`, `ui: 40`, `top: 1000`과 ordinary prototype의 `toString`·`valueOf`·`constructor`·`__proto__` 상속 결과를 map 자체와 production resolver 양쪽에서 직접 검증
- [x] 문자열·Symbol·primitive·객체 입력의 표준 `ToPropertyKey`, `Symbol.toPrimitive` hint와 단락, `toString → valueOf` fallback, 변환 중 재진입, 비원시 반환 `TypeError`, 변환 오류의 same identity 동기 전파를 검증
- [x] actual VM `Object.prototype`의 live Symbol getter로 정확한 receiver·1회 조회·truthy identity·모든 falsy의 숫자 +0 fallback·재진입·getter 오류·coercion→get 순서를 검증하고 `finally` cleanup 뒤 잔존 프로퍼티가 없음을 확인
- [x] 실제 factory caller에서 기본 order 조회, 객체 id의 두 차례 변환, 명시적 finite `-0`의 resolver 우회와 1회 변환, 상속 객체 결과 identity 및 오류 identity를 직접 고정
- [x] JSDoc 전체 블록을 제거한 production 실행 소스 SHA-256 `76be28d1edda8705df26284b47aa4b6c0657d7db22d902e0dcc6c9d08c6a215f` exact 보존; 두 독립 최종 리뷰가 문서·실행·cleanup blocker 없음 승인
- [x] 전체 `npm test` 222개, JS/MJS 372개 `node --check`, WASM 전용 16개, WAT/WASM 재현성, stress seed `0x71c0ffee` 1,000건·3,824,454셀 및 ABI canary 3종 모두 통과
- [x] Computer Use 실제 게임 2560×1440 cold start에서 타이틀 렌더, 설정 glass/blur overlay 진입·취소, `ㄷ자 회랑` 맵 선택 preview 진입·취소, 각 타이틀 복원, 종료 확인 overlay와 `예` 선택 뒤 프로세스 정상 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `2aa2329 Document static surface order contract`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.16 `WebGLHandler.render()` SameValueZero·live callback 계약 정정 — 검증 완료

- [x] `_webgl_handler.js`, `_webgl_layer_renderer.js`, 실제 renderer 3종, `DisplaySystem.renderGL()`과 7개 외부 모듈의 8개 호출 지점을 전체 감사해 기존 `{string}`·`{object}` JSDoc이 hot-path dispatch의 key·gate·callback·오류·반환 계약을 누락한 사실을 확인
- [x] production 변경 전 actual-class 실행 계약 10개 green/JSDoc 구조 1개 red를 확립한 뒤 JSDoc만 정정해 전용 11개 전체 green, 기존 alias/order 계약과의 결합 30개 전체 green으로 고정
- [x] 문자열·객체·Symbol·`NaN`·±0·`undefined`·`null`·BigInt key를 실제 Set/Map SameValueZero로 조회하고 throwing coercion 객체를 PropertyKey로 변환하지 않으며, primitive·함수·inspection 거부 Proxy를 포함한 임의 options identity를 exact 1개 인자로 전달함을 검증
- [x] context-lost, missing renderer와 `undefined`·`null`·`false`·±0·0n·`NaN`·빈 문자열 renderer가 이후 renderer/callback lookup을 완전히 차단하고 항상 `undefined`를 반환함을 검증
- [x] handler field→`has`→renderer Map `get`→live `render` getter/call→최신 callback Map `get`→live `onDraw` getter/call의 exact 순서, 각 receiver·인자 수, renderer 완료 뒤 callback lookup을 직접 계측
- [x] 하위 renderer가 내부 no-op으로 정상 반환해도 `onDraw`를 정확히 1회 호출하며 object·Promise·throwing thenable을 포함한 renderer/callback 반환값을 관찰하지 않고 폐기함을 검증; 독립 리뷰가 실제 `WebGLBatch`·`EffectRenderer`·`OverlayEffectRenderer` prototype no-op 3종도 3/3 확인
- [x] callback record/onDraw의 nullish skip과 non-callable `TypeError`, 모든 field/method getter·호출 오류의 same identity 동기 전파, renderer 성공 뒤 callback 오류가 앞선 부수효과를 rollback하지 않는 부분 상태를 검증
- [x] renderer·onDraw 양쪽 중첩 재진입에 guard가 없고 renderer 도중 callback Map 교체는 새 callback, 같은 Map의 callback 삭제는 skip으로 반영되는 live 상태를 검증
- [x] 14개 standalone JSDoc을 제거한 production 실행 소스 SHA-256 `add9444c8b96515c2c8580c070c1b05dda06d2cb16d4d9c1f535dd1eda611b06` exact 보존; 두 독립 최종 리뷰가 false-green·blocker 없음 승인
- [x] 전체 `npm test` 233개, JS/MJS 373개 `node --check`, WASM backend+kernel 전용 20개, WAT/WASM 재현성, stress seed `0x71c0ffee` 1,000건·3,824,454셀 및 ABI canary 3종, `git diff --check` 모두 통과
- [x] Computer Use 실제 게임 2560×1440 cold start에서 타이틀 WebGL 파티클, 설정 glass/blur overlay 진입·취소, `ㄷ자 회랑` 맵 preview 진입·취소, 종료 확인 overlay와 `예` 선택 뒤 프로세스 정상 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `5b93bc8 Document WebGL render dispatch contract`
- [x] 실행 구조 변경이 없는 JSDoc 정정이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 5.17 `EffectRenderer.resize()` 수치 변환·부분 상태 계약 정정 — 검증 완료

- `project/game/script/module/display/webgl/_effect_renderer.js`를 끝까지 감사하고, 현재 구현이 단순한 "최소 정수 크기" 계약이 아니라 `Math.floor`의 ToNumber 변환 뒤 `Math.max(1, value)`를 순차 적용한다는 사실에 맞춰 normalizer와 `resize()` JSDoc만 정정했다. 실행문은 변경하지 않았다.
- `render()`/`flush()`는 live command queue·registry·재진입·예외 시 큐 보존까지 별도 관찰 지점이 많아 허위 동일성 판정을 막기 위해 다음 독립 단위로 분리했다.
- 새 `project/game/test/effect_renderer_resize_jsdoc_contract.test.mjs`는 변경 전 런타임 계약 8건 통과/JSDoc 계약 1건 실패를 재현했고, 문서 정정 뒤 9/9를 통과했다.
- 독립 edge oracle로 `NaN`, `+/-Infinity`, `-0`, 1 경계 인접 실수, 최대·최소 수, 숫자·공백·16진·Infinity 문자열, `null`/boolean을 양축에서 검증했다.
- 객체 ToPrimitive의 number hint, `valueOf -> toString` fallback, Symbol·BigInt·비원시 반환 TypeError, 원래 예외 identity를 실제 `EffectRenderer.prototype.resize` 경로로 고정했다.
- Proxy receiver로 `width 변환 -> width 대입 -> height 변환 -> height 대입` 순서와 정확한 receiver를 검증했다. width/height 변환·setter 실패 시 후속 관찰 차단과 height 실패 뒤 width 부분 갱신이 rollback되지 않는 계약도 고정했다.
- 변환 getter가 중첩 `resize()`를 재진입하는 경우 guard가 없고, 바깥 호출의 후속 순차 대입이 최종 상태를 덮는 현행 의미까지 검증했다.
- JSDoc 제거 후 production 실행 소스 SHA-256은 변경 전·후 모두 `3061368b977709677eee734e14c12470c89cd325c3c658d9ec7d712c8076e439`로 동일하다. 독립 사후 검토에서도 blocker와 false-green이 없고 production diff가 두 JSDoc뿐임을 확인했다.
- 연관 렌더 계약 묶음 39/39와 전체 `npm test` 242/242, JS/MJS 374개 `node --check`, WASM backend+kernel 20/20, WAT/WASM 재현성 검사를 모두 통과했다.
- 고정 seed `0x71c0ffee` WASM 스트레스 1,000건/3,824,454 cells와 ABI canary 3 layouts도 통과했다.
- Computer Use로 실제 `lonely tower.exe`를 콜드 실행해 타이틀, 설정, 설정 취소, 맵 선택, 맵 취소, 종료 확인 대화상자의 렌더와 상호작용을 확인했고, 종료 후 프로세스가 사라짐을 확인했다.
- GitHub Desktop GUI 커밋 및 푸시: `284f3ba Document EffectRenderer resize contract`.
- 구조·핵심 실행 로직 변화가 없는 JSDoc 정정 단위이므로 `AGENT_GUIDE.md` 갱신은 불필요하다고 판정했다.

#### 5.18 `EffectRenderer.flush()` live queue·double draw 계약 정정 — 검증 완료

- `project/game/script/module/display/webgl/_effect_renderer.js`를 끝까지 감사하고, `beginFrame()`·`render()`·`destroy()`와 분리해 `flush()`의 live queue dispatch 계약만 독립 단위로 고정했다. production 실행문은 변경하지 않았다.
- 변경 전 actual prototype 실행 계약 14건 통과/JSDoc 계약 1건 실패를 재현했고, 새 `project/game/test/effect_renderer_flush_jsdoc_contract.test.mjs`의 문서 정정·edge 보강 뒤 15/15를 통과했다.
- 초기 `commands.length === 0` 엄격 비교와 `width <= 0 -> height <= 0` coercion 순서, `NaN`·`+Infinity` guard 통과, 최초 commands/length getter와 양축 coercion 오류 identity를 직접 검증했다.
- truthy `effectType` 우선과 모든 falsy의 live `shape` fallback, 객체·Symbol·`NaN`·±0의 actual Map exact key, missing/falsy pass와 첫 non-function `draw`의 1회 조회 skip을 고정했다.
- commands/registry/pass/dimensions의 정확한 live getter receiver와 조회 순서, `draw` getter 2회, 두 번째 값을 재검사하지 않는 호출식, width·height 인자 선평가, pass receiver, hostile thenable 반환 미관찰을 검증했다.
- append·truncate·reorder·queue 교체, 앞선 draw의 registry·dimensions 교체, 동일 queue 및 교체 queue 재진입을 직접 실행해 nested clear가 outer loop를 끝내거나 버려진 outer array를 남기는 현행 의미를 고정했다.
- 모든 조회·getter·coercion·lookup·draw 호출 오류의 same identity 동기 전파, 성공했던 draw의 rollback 부재와 retry 중복, guard/final `length = 0` 실패 및 non-configurable index의 ECMAScript 부분 축소 상태를 검증했다.
- 최초 독립 리뷰가 guard clear 실패와 두 번째 non-callable `draw` 문구의 false-green 2건을 찾아 문서·assertion을 수정했고, 동일 queue 재진입·최초 getter·height coercion·receiver 검증까지 보강한 최종 독립 재검토에서 blocker 없음 승인을 받았다.
- 9개 standalone JSDoc을 제거한 production 실행 소스 SHA-256은 변경 전·후 모두 `3061368b977709677eee734e14c12470c89cd325c3c658d9ec7d712c8076e439`로 exact 보존했다.
- 연관 렌더 계약 묶음 54/54와 전체 `npm test` 257/257, JS/MJS 375개 `node --check`, WASM backend+kernel 20/20, WAT/WASM 재현성, `git diff --check`를 모두 통과했다.
- 고정 seed `0x71c0ffee` WASM 스트레스 1,000건/3,824,454 cells와 ABI canary 3 layouts도 통과했다.
- Computer Use로 실제 `lonely tower.exe`를 2560×1440 cold start해 타이틀 WebGL 배경과 설정 overlay 진입·취소, 타이틀 복원, 종료 확인 대화상자와 `예` 선택을 검증했고 종료 뒤 프로세스가 사라짐을 확인했다.
- GitHub Desktop GUI 커밋 및 푸시: `e525cff Document EffectRenderer flush contract`.
- 구조·핵심 실행 로직 변화가 없는 JSDoc 정정 단위이므로 `AGENT_GUIDE.md` 갱신은 불필요하다고 판정했다.

## 6. 일반 성능 최적화

#### 6.1 게임 씬 투사체 컬링 경계 할당 제거 — 완료

- [x] 변경 전 프레임마다 경계 객체를 생성하던 legacy 구현을 독립 오라클로 고정하고, 생산 코드 변경 전 구조적 red → 변경 후 green 확인
- [x] 정확한 min/max 경계와 인접 Float64, `NaN`·±`Infinity`·±0·primitive·비활성/무효 투사체 및 결정적 raw IEEE-754 50,000건 exact 비교
- [x] getter/Proxy 평가 순서와 횟수, 호출마다 달라지는 배열, coercion·getter·splice 예외, revoked Proxy, `Symbol.species`, sparse/frozen/sealed/preventExtensions/subclass/inherited-index/부분 변이 예외 및 재진입 계약 exact 비교
- [x] `ObjectSystem`과 공유하는 live 배열 identity, 역순 `splice`, 기존 단락 평가와 `scene.projectiles` getter `2 + N + C`회 계약을 보존하면서 가변 프레임마다 생성되던 경계 객체 1개 제거
- [x] `npm test` 50개, JS/MJS 350개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] Computer Use 완전 재실행 후 benchmark 적 100개와 투사체 80개 연속 생성: 투사체 이동·충돌·화면 밖 컬링 및 잔상 없음, 178–181 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 종료 후 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `4a734b0 Eliminate projectile cull boundary allocation`

#### 6.2 마우스 입력 캔버스 오프셋 aggregate 객체 경로 제거 — 완료

- [x] `MouseInputHandler`의 window/document `mousemove`와 window `mousedown`/`mouseup`이 이벤트마다 `getCanvasOffset()`의 `{x, y}`를 생성하던 경로를 감사
- [x] 기존 공개 `getCanvasOffset()`의 매 호출 fresh ordinary object, own key/descriptor, extra-argument 무시·무변형 계약은 그대로 유지하고, 객체가 필요 없는 입력 경로용 `getCanvasOffsetX()`/`getCanvasOffsetY()` 추가
- [x] 기존 평가 순서 `scale → raw X → raw Y → X coercion → Y coercion → client X/Y → mousePos X/Y`를 유지하도록 두 원시 오프셋을 모두 읽은 뒤 숫자로 변환
- [x] 생산 코드 변경 전 7개 parity subtest의 구조·행동 red를 확인하고 변경 후 green으로 고정
- [x] 실제 `display_system.js` 전체 모듈을 VM에서 링크해 공개 aggregate API, 축별 singleton 재조회, getter 중 DisplaySystem 교체 및 함수 shape 검증
- [x] `NaN`·±`Infinity`·±0·최대/최소·subnormal을 포함한 결정적 raw IEEE-754 50,000건과 string/null/boolean/BigInt/boxed number/custom coercion/Symbol 예외를 `Object.is` 및 예외 name/message/constructor로 exact 비교
- [x] getter/coercion/예외/부분 기록 trace, 실패 시 버튼 큐 미호출, 4개 DOM listener 경로, 같은 핸들러와 서로 다른 핸들러의 중첩 재진입을 독립 legacy 오라클과 exact 비교
- [x] V8 비표준 `Error.stack`은 함수명·행 번호에 의존하므로 비교 대상에서 명시적으로 제외하고, 게임이 분기하는 값·예외·부수효과·상태 계약은 모두 고정
- [x] `module_architecture_guide.md`와 관련 JSDoc에 공개 aggregate/입력 scalar 경계 및 평가 순서 불변조건 반영
- [x] `npm test` 57개, JS/MJS 351개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] Computer Use 완전 재실행 후 2560×1440 타이틀에서 마우스로 설정 오버레이 진입·취소, hover 효과·좌표 변환·정상 타이틀 복원 확인
- [x] 독립 리뷰 2건에서 프로덕션 평가 순서·공개 API·재진입·테스트 하네스 blocker 없음 확인
- [x] GitHub Desktop 커밋 및 푸시: `c684b29 Eliminate mouse offset event object`

#### 6.3 타이틀 AI 속도 상한 결과 객체 할당 제거 — 완료

- [x] 최대 420개 타이틀 적의 매 고정 틱에서 속도 상한 helper가 `{x, y}`를 만들던 경로를 감사하고, 스칼라 배율과 X/Y 지역값으로 동일 계산을 유지
- [x] 생산 코드 변경 전 8개 parity subtest 중 행동 검증 7개 통과·구조 가드 1개 red를 확인하고, 실제 1-ULP 경계와 coercion 보강 후 변경 뒤 9개 전체 green으로 고정
- [x] 실제 `_title_ai.js` 전체 소스를 `vm.SourceTextModule`로 평가하고, 생산 scalar 소스에서 legacy helper·`fixedUpdate` 블록을 정확히 한 번 역변환한 독립 비교 모듈 사용
- [x] 정확한 5의 nextDown/nextUp, `NaN`·±`Infinity`·±0·최대/최소·subnormal을 포함한 명시값과 결정적 raw IEEE-754 tuple 100,000개를 `Object.is`로 비교
- [x] raw Float64 상태 2,048개의 전체 `fixedUpdate` 상태·호출 결과와 최종 `setAcc` 인수의 64비트 표현을 legacy와 exact 비교
- [x] boxed number·numeric string·Symbol·BigInt·custom coercion/throw/reentry, `setAcc → speed.x → speed.y` getter 순서, 각 지점 예외의 부분 상태 및 `speed.x` 중첩 재진입 계약 exact 비교
- [x] 두 clamped scalar를 `enemy.setAcc` member와 `enemy.speed` getter보다 먼저 계산해 기존 객체 생성 시점의 산술 순서를 유지하고, 관련 helper JSDoc 반환 계약 갱신
- [x] 10,000,000회 합성 helper loop 5회 교차 측정: legacy 중앙값 777.66ms, scalar 중앙값 680.90ms(약 12.4% 단축). 실제 전체 프레임 향상으로 확대 해석하지 않음
- [x] `npm test` 66개, JS/MJS 352개 `node --check`, WASM stress 1,000건·3,824,454셀 및 ABI canary, WAT/WASM 재현성, `git diff --check` 모두 통과
- [x] 독립 리뷰에서 실제 ULP 경계 누락을 발견해 테스트를 보강했으며, 재검토 결과 production·테스트 blocker 없음 확인
- [x] Computer Use 완전 재실행 후 타이틀 적의 마우스 클릭 지점 자석 반응과 정상 이동 확인; benchmark 적 100개 생성 후 활성 94개, 181 FPS, fixed 60.0/s, SIM 100.0%, debt 0.0/s; 재실행해 정상 타이틀 복원
- [x] GitHub Desktop 커밋 및 푸시: `4b60f59 Eliminate title AI velocity object allocation`

#### 6.4 적 AI steering options 객체 할당 제거 — 완료

- [x] 모든 적의 매 fixed tick에서 14개 property options object를 생성하던 `_enemy_ai_core.js` → `_enemy_ai_steering.js` 호출 경로 감사
- [x] 기존 공개 options object API는 유지하고, 내부 함수 identity token이 정확히 일치하는 core 호출만 기존 property value 평가 순서의 positional 경로를 사용하도록 변경
- [x] 생산 코드 변경 전 actual-source parity 10개 중 구조 가드 1개 red를 확인하고 변경 후 10개 전체 green으로 고정
- [x] direct/arrival/flow/blocked/hexa/numeric 경로, 14개 공개 getter 순서·각 throw 지점, 상속 accessor·Proxy receiver·재진입, null/undefined/primitive/revoked Proxy 예외를 exact 비교
- [x] 공개 함수의 name·length 1·constructability·own descriptor와 잘못된 내부 token fallback, steering/core namespace를 기존과 동일하게 고정
- [x] 실제 core `updateFrame` getter/setter 평가 순서·각 throw 지점·인수 평가 중 재진입과 10,000 fixed tick의 상태를 raw Float64 기준으로 exact 비교
- [x] 실제 NW.js Chromium의 `document.all` IsHTMLDDA 입력을 포함해 strict null/undefined 분기와 공개 getter trace가 기존과 동일함을 확인
- [x] 최종 production 소스를 읽은 두 clean process·case별 61개 교차 표본에서 모두 mixed 3:1 p50 1.066배로 1.05배 gate 통과. 첫 실행 direct 88.6→84.6ns, flow 117.6→114.9ns, mixed 103.7→97.3ns; 둘째 실행 direct 88.8→83.6ns, flow 117.4→114.7ns, mixed 103.1→96.7ns. 호출 경로 microbenchmark이며 전체 frame 향상으로 확대 해석하지 않음
- [x] `npm test` 107개, JS/MJS 359개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use 변경 후 benchmark: 적 800회 생성·활성 725개 안정화에서 122 FPS, fixed 60.0/s, SIM 100.0%, frame p50/p95/p99 9.5/9.9/11.2ms, fixed CPU 11.1/12.4/14.1ms, debt/lost 0; 이동·합체·렌더 정상 및 변경 전 활성 710개 기준 비퇴행 확인
- [x] `Error.stack`, `Function#toString()`/소스 위치, OOM·heap 관찰은 실행 계약 비교 대상에서 제외
- [x] GitHub Desktop 커밋 및 푸시: `61c090d Optimize enemy AI steering call path`

#### 6.5 navigation grid raster WASM 후보 — 보고 전용

- [x] 완전 동일성을 유지할 수 있는 최소 경계를 JS에서 계산한 정수 rectangle 범위의 blocked mask fill로 제한
- [x] 벽 getter·bounds 해석·clearance 확장·floor/clamp를 WASM으로 옮기면 평가 순서와 coercion·예외 계약이 달라질 수 있어 JS에 유지
- [x] 기존 JS 대비 pack→WASM→copy 후보 측정: 벽 5개 0.65배, 32개 0.97배, 128개 1.04배, 512개 1.08배이며 512개 p95도 후보가 더 느림
- [x] raster는 nav-grid LRU miss에서만 실행되고 flow-field miss 비용의 약 1~3%여서 1.3배 전환 gate를 충족하지 못함
- [x] 생산 코드는 변경하지 않고 WASM 보류 근거를 `report0719.md` 4.20에 기록
- [x] nav-grid cache key의 별도 잠재 위험은 도달 가능성과 새 계약이 미확정이므로 `report0719.md` 4.21에만 기록

#### 6.6 타이틀 자기장 options 객체 할당 제거 후보 — 성능 게이트 실패·미채택

- [x] 최대 420개 타이틀 적의 매 fixed tick에서 `applyMagneticEffect()` 호출용 options 객체가 생성되는 경로를 감사하고, 정상 약 378개에서 초당 약 22,680개·최대치에서 약 25,200개의 source-level 객체 리터럴 후보를 확인
- [x] 공개 5인수+options API의 arrow/name/length/descriptor와 모든 getter·coercion·예외 계약을 유지하면서, 정확한 비공개 identity token을 전달하는 타이틀 내부 호출만 3개 scalar 값을 positional로 넘기는 실험 후보 구현
- [x] 생산 코드 변경 전 행동 8개 green·구조 가드 1개 red를 확인하고, 후보에서는 actual-source 양방향 legacy 비교 11개 전체 green과 기존 타이틀 속도 parity 9개 전체 green으로 고정
- [x] `null`/`undefined`/primitive/revoked Proxy/잘못된 token, public options와 exact token 충돌, getter·setter throw 및 부분 쓰기, 재진입, undefined velocity fallback, 호출마다 달라지는 motion, 명시 IEEE-754 경계와 결정적 10,000 tuple, 실제 title `fixedUpdate()` 전체 상태를 exact 비교
- [x] 실제 NW.js Chromium 145의 falsy·strict non-nullish `document.all`과 raw/accessor 설치 경로, 공개 API, 420개 적의 완전한 title tick 결과가 legacy와 exact 일치함을 확인
- [x] 후보 상태 전체 `npm test` 150개 통과 및 독립 리뷰에서 blocker 없음 확인
- [x] Computer Use로 두 clean process와 AB/BA 역순 61쌍을 측정한 결과 dual 중앙값 비율이 각각 0.948·0.947, mixed 중앙값 비율이 각각 0.962·0.963으로 후보가 약 3~5% 느려 1.05배 성능 gate 실패
- [x] 첫 실행의 legacy→candidate p50/p95는 inactive 178.2/182.1→183.7/186.4ns, single 221.6/225.5→232.5/236.0ns, dual 260.4/263.9→274.8/278.6ns, mixed 200.7/203.7→208.6/211.6ns per enemy
- [x] 역순 실행의 legacy→candidate p50/p95도 mixed 200.7/207.2→208.3/212.1ns, dual 260.2/266.2→274.8/278.8ns, single 220.7/224.1→229.7/232.0ns, inactive 176.1/178.1→181.7/184.0ns per enemy로 같은 역행을 재현
- [x] 성능 이득이 없으므로 생산 소스·manifest·기존 테스트를 실험 전 상태로 exact 원복하고, 추적되지 않은 후보 token 모듈·parity/NW runner를 제거; 원복 후 기존 타이틀 parity 9개 통과
- [x] 원복 상태 전체 `npm test` 139개, JS/MJS 364개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary, `git diff --check` 모두 통과
- [x] Computer Use 실제 게임 cold start에서 2560×1440 타이틀 합성·카드·동적 도형 정상, 배경 클릭 뒤 파란 자기장 표시와 도형 군집 반응, 종료 확인 오버레이 및 정상 종료 확인
- [x] 미채택 근거와 재검토 조건을 `report0719.md` 4.24에 기록
- [x] GitHub Desktop 커밋 및 푸시: `b63dc0d Document magnetic optimization no-go`

#### 6.7 적 LOS WAT 후보 — 성능 게이트 실패·미채택

- [x] `_enemy_ai_navigation.js`·`_enemy_ai_steering.js`·`_enemy_ai_policy_intent.js` 경로에서 적당 1 query/tick의 단순 기준 부하가 적 800개·60Hz 약 48,000 query/s임을 확인; policy sample과 final/direct-path 검사로 실제 호출 수는 더 커질 수 있어 최대치로 사용하지 않음
- [x] in-memory WAT 탐색 구현이 정상 유한 입력 16,384개에서 기존 JS boolean 결과와 exact 일치
- [x] 벽 1/8/32/128개 p50 속도는 각각 0.975/1.156/1.233/1.325배였으며 기본 맵 8개는 1.3배 gate 실패
- [x] 800 query/tick의 kernel-only 절감도 약 0.0086ms이므로 생산 코드·테스트·artifact를 변경하지 않고 NO-GO 처리
- [x] 벽 128개 이상 지속 또는 batch/memory 상주 조건에서 release edge parity와 실제 NW.js AB/BA 1.3배를 재검증하고 상세 근거는 `report0719.md` 4.26에 기록

#### 6.8 `EnemySpatialIndex.rebuild()` WASM 후보 — 비용·경계 게이트 실패·미채택

- [x] `object_system_fixed_update_helpers.js`·`enemy_spatial_index.js`를 감사해 fixed tick마다 JS Map·객체 참조·density를 함께 재구성함을 확인
- [x] 실제 production 모듈의 적 800개·약 10% hive 입력 rebuild p50/p95는 0.1495/0.1711ms
- [x] 단순 bounds 100/400/800/1,200개 p95도 각각 0.060554/0.098675/0.169770/0.253185ms로 작음
- [x] 실제 fixed p95 대비 방향성 비율 약 1.16%이고 4.17ms·25% gate에 미달하며 rebuild-only WASM은 JS 구조를 중복하므로 NO-GO 처리
- [x] canonical numeric slot과 batch query가 마련되거나 profiler gate를 넘을 때만 exact 방문·dedupe·density·generation 하네스로 재검토하고 상세 근거는 `report0719.md` 4.27에 기록

#### 6.9 hexa 합체 contact batched narrowphase WASM 후보 — 조건부 실험 대기

- [x] `object_system_hexa_hive_orchestration.js`, `_hexa_hive_layout.js`, `_collision_handler.js`, `collision_enemy_body_builder.js`, `collision_body_detector.js`를 감사해 circleParts pair의 실제 `countA × countB` primitive 검사를 batch 후보로 확인
- [x] 독립 재검토에서 구성원 최대 8개와 collision part 상한을 등치한 오류를 발견하고, hole을 포함하는 `filledLocalCenters.length`가 `circlePartCount`가 되므로 실제 layout 전수 상한을 먼저 계측하도록 정정
- [x] JS가 body/grid/dedupe/pair 순서를 유지하고 WAT는 한 tick의 numeric 후보에 대한 `Uint8` contact flag만 반환하는 최소 경계를 확정
- [x] 전용 contact parity 테스트와 `fixed.object.contact`/`contactPairScanMs` 대표 실측이 없어 생산 구현은 보류
- [x] hole 포함 실제 `circlePartCount`의 0·1·전수 상한·상한 인접값, 접선 1-ULP·비유한 입력·cell dedupe·pair identity와 10,000 tick merge/spawn/release exact replay를 선행 gate로 지정
- [x] 실제 NW.js에서 packing 포함 기존 detector와 boolean-only JS 대비 1.3배 이상이고 p95·소규모가 비퇴행할 때만 승격하며 상세 조건은 `report0719.md` 4.28에 기록

#### 6.10 비네트 ordered-dither offset 사전 계산 후보 — 동일성·성능 게이트 실패·미채택

- [x] `_vignette_renderer.js`의 dirty-cache `_colorizeBlur()`에서 alpha가 0보다 큰 픽셀마다 실행되는 4×4 Bayer offset의 `/ 16 - 0.46875`를 감사
- [x] 16개 offset이 모두 `(2m - 15) / 32`의 exact dyadic이라 native intrinsic·불변 행렬 계약에서는 직접 2D offset table의 `Math.round()` 입력과 RGBA가 binary64/byte 단위로 같음을 확인
- [x] patched `Object.freeze`가 원래 4개 행과 외부 배열을 캡처하고 freeze를 no-op으로 만든 뒤 첫 셀을 `8`로 변경하는 actual-source 반례에서 alpha 93의 byte가 변이 전 양쪽 `92`, 변경 뒤 legacy `93`·table 후보 `102`로 불일치함을 확인
- [x] 원래 정수 행렬 조회와 exotic cell fallback을 유지하는 switch 후보도 검토해 getter·coercion·mutation 의미를 보존하는 최소 경계를 확정
- [x] 실제 production source SHA-256 `4109cd5e6a039d42ee7241587342926187949b470662962396853e3efeeae39a` 기반 Node 22.19.0/V8 12.4.254.21, 1920×1080, warmup 7쌍, AB/BA 31쌍 측정 수행
- [x] 단순 2D table은 resolver p50/p95 0.9706/0.9784배로 악화됐고 39.9853%/100% alpha 점유 colorize loop만 각각 1.0311/1.0320배·1.0448/1.0452배; 측정 전후 8,294,400 RGBA byte는 native 정상 환경에서 exact 일치
- [x] 호환 switch 후보는 resolver p50/p95 0.8347/0.8243배, 39.9853%/100% colorize loop 0.8983/0.8935배·0.8357/0.8424배로 명확히 악화되어 성능 gate 실패
- [x] 단순 table은 완전 동일성 gate를, switch는 성능 gate를 각각 실패했으므로 production·test·WASM artifact를 변경하지 않고 `report0719.md` 5.10에 NO-GO 근거와 재검토 조건 기록
- [x] 전체 `npm test` 191개, JS/MJS 369개 `node --check`, WAT/WASM 재현성, stress 1,000건·3,824,454셀 및 ABI canary 3종, `git diff --check` 통과
- [x] Computer Use 실제 게임 2560×1440 cold start에서 타이틀 가장자리 비네트·동적 배경, 설정 glass overlay 진입·취소, 맵 선택 preview 진입·취소, 종료 확인 overlay와 정상 프로세스 종료를 검증
- [x] GitHub Desktop GUI 커밋 및 푸시: `8ea8c6f Document vignette optimization no-go`
- [x] 생산 구조·핵심 로직 변경이 없는 보고 전용 감사이므로 `AGENT_GUIDE.md` 갱신 불필요

#### 6.11 enemy-enemy ordered circle resolve WASM 후보 — 동일성 경계 실패·보고 전용

- [x] `_collision_handler.js`, candidate admission/processor/budget, circle SoA narrowphase, pair resolver, body translation, broadphase와 기존 fast-path 테스트를 끝까지 대조해 최대 3개 회전 pass의 live 순차 상태를 감사
- [x] 적 800개 all-normal circle의 active candidate tail-adjusted combinatorial 상한을 `786 × 14 + Σ(1..13) = 11,095` pair/rebuild로 재계산하고, 이전 초안의 느슨한 `11,186` 수치를 폐기
- [x] player/wall guaranteed pair를 제외한 세 pass enemy-enemy admitted-pair processing loop iteration 최대 33,285회/tick과 normal circle process-attempt 정적 상한 `5,600 + 4,000 + 4,000 = 13,600`회/tick(60Hz 816,000회/s)을 실측값과 분리해 기록하고, non-enemy pair가 전체 priority/normal loop에 별도 추가됨을 명시
- [x] `252KiB` hard lower 및 `0.5~0.65MiB` exact-state 추정은 ABI·필드 방향 가정이 섞여 방어할 수 없으므로 폐기하고, 현행 plane에서 직접 계산 가능한 one-way snapshot 예시 182.0KiB와 candidate sweep 포함 232.8KiB만 비실측 시나리오로 명시
- [x] `Math.hypot`/`Math.pow` raw bit, pair별 Float32 반올림, mixed fallback·budget·sleep, JS callback throw의 부분 상태와 WASM trap 복구가 exact 이전을 막음을 확인
- [x] 기존 `collision_enemy_fast_path.test.mjs`가 `1e-8`/`1e-5` 허용 오차 기반이라 raw-bit·3-pass·mixed·throw/trap authority oracle로 부족함을 확인
- [x] pair별 export와 JS-owned circle batch를 NO-GO 처리하고, fresh G0 뒤 WASM-owned `grid → candidate → 전체 narrowphase → ordered resolve` coarse authority만 재검토하도록 `report0719.md` 4.30과 `guide/domain/simulation_native_acceleration_guide.md` 5.5.1을 갱신
- [x] 생산 실행 코드·테스트·WASM artifact는 변경하지 않음
- [x] 독립 감사 2건에서 느슨한 11,186 수치, 방어 불가능한 252KiB/0.5~0.65MiB 추정, non-enemy budget·33,285 loop 범위·batch 불가능 단정을 차례로 교정하고 최신 diff 최종 재검토에서 사실 blocker 없음 확인
- [x] 관련 충돌 계약 6/6, 전체 `npm test` 257/257, JS/MJS 375개 `node --check`, WASM backend+kernel 20/20, WAT/WASM 재현성과 `git diff --check` 통과
- [x] 고정 seed `0x71c0ffee` WASM stress 1,000건/3,824,454 cells와 ABI canary 3 layouts 통과
- [x] Computer Use로 실제 `lonely tower.exe`를 2560×1440 cold start해 타이틀 WebGL 합성, 설정 glass overlay 진입·취소와 타이틀 복원, 종료 확인 대화상자와 `예` 선택, 종료 뒤 프로세스 제거를 확인
- [x] production 구조·핵심 로직 변화가 없어 `AGENT_GUIDE.md`는 유지하고, 관련 acceleration 결정만 domain guide에 최신화

## 발견된 위험

- 테스트는 `--experimental-vm-modules` 없이 실행하면 모든 파일이 로더 단계에서 실패합니다.
- 시작 시 없던 WASM 빌드 경로는 exact `wabt@1.0.39`, lockfile, WAT/artifact hash와 재빌드 검사로 해소했습니다.
- 최근 `main` 변경 75개 파일이 기존 2026-07-12 가이드 기준 이후에 추가되어 문서와 코드 사이에 차이가 있습니다.
- WASM 수치는 flow-field cache miss 커널에만 해당하며 전체 fixed/frame 향상으로 확대 해석하지 않습니다. 물리/fixed authority 승격은 별도 replay와 end-to-end gate가 필요합니다.
