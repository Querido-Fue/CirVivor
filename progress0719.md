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

## 발견된 위험

- 테스트는 `--experimental-vm-modules` 없이 실행하면 모든 파일이 로더 단계에서 실패합니다.
- 시작 시 없던 WASM 빌드 경로는 exact `wabt@1.0.39`, lockfile, WAT/artifact hash와 재빌드 검사로 해소했습니다.
- 최근 `main` 변경 75개 파일이 기존 2026-07-12 가이드 기준 이후에 추가되어 문서와 코드 사이에 차이가 있습니다.
- WASM 수치는 flow-field cache miss 커널에만 해당하며 전체 fixed/frame 향상으로 확대 해석하지 않습니다. 물리/fixed authority 승격은 별도 replay와 end-to-end gate가 필요합니다.
