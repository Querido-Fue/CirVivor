# 테스트

저장소 루트에서 `npm test`를 실행한다. 게임 패키지 디렉터리에서도 `npm test`를 사용할 수 있다.

- `*.test.mjs`: Node 계약·동작·회귀 테스트
- `support/`: import-map 로더, WASM 빌드와 NW.js 실행 도구
- `nw_*/`: NW.js 실제 렌더링·WebGPU 하네스
- `fixtures/`: 공유 검증 데이터
- `benchmark/`, `stress/`: 비교 측정과 장시간 부하 검사
- `local/`: Git에서 제외하는 임시 검증 스크립트, 과거 정리 도구와 작업 자료

게임 런타임은 `../project/game/`에 있다. WABT 의존성은 `project/`에서 `npm ci`로 설치한다. GPU·골든 검사는 해당 NW.js 런타임이 필요하며 `project/package.json`의 별도 명령으로 실행한다. 임시 하네스 안의 경로는 실행 도구가 구성한다.

임시 검증 파일은 `local/`에 두고, 실행 로그는 운영체제 임시 디렉터리에 저장한다. 저장소 루트에는 테스트 스크립트나 실행 로그를 만들지 않는다.

테스트는 동작과 외부 계약을 검증한다. 리팩터링을 막는 실행 소스 해시나 특정 JSDoc 문구를 정답으로 고정하지 않는다. 과거 릴리스 이름이 붙어 있어도 현재 게임 규칙을 검증하는 테스트는 유지한다.

입체 그래픽의 실제 게임 통합 검사는 루트의 `npm run test:ceramic:nw`다. 원래 App/Display와 게임 시작 경로를 임시 NW 앱·저장 경로에서 실행하고 입력, 줌, 리사이즈, safe-wave 재생성, 씬 전환을 확인한다. `npm run prototype:lab -- --qa`는 별도 실험실의 시점·부하 검사다.
