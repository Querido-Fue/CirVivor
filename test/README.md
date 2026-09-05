# 테스트

저장소 루트에서 `npm test`를 실행한다. 게임 패키지 디렉터리에서도 `npm test`를 사용할 수 있다.

- `*.test.mjs`: Node 계약·동작·회귀 테스트
- `support/`: import-map 로더, WASM 빌드와 NW.js 실행 도구
- `nw_*/`: NW.js 실제 렌더링·WebGPU 하네스
- `fixtures/`: 공유 검증 데이터
- `benchmark/`, `stress/`: 비교 측정과 장시간 부하 검사

게임 런타임은 `../project/game/`에 있다. WABT 의존성은 `project/`에서 `npm ci`로 설치한다. GPU·골든 검사는 해당 NW.js 런타임이 필요하며 `project/package.json`의 별도 명령으로 실행한다. 임시 하네스 안의 경로는 실행 도구가 구성한다.

테스트는 동작과 외부 계약을 검증한다. 리팩터링을 막는 실행 소스 해시나 특정 JSDoc 문구를 정답으로 고정하지 않는다. 과거 릴리스 이름이 붙어 있어도 현재 게임 규칙을 검증하는 테스트는 유지한다.
