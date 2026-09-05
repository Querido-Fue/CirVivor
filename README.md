## 실행 방법
1. nw.js를 다운로드 받습니다.
2. 코드를 다운받은 후, 압축을 해제합니다.
3. project 파일의 내용물(package.json / game 폴더...)을 nw.exe와 같은 경로에 배치합니다.
* GPU 기반 물리 시뮬레이션을 수행하므로 GPU가 없는 환경에서는 게임 플레이가 불가능합니다.

## 개발 검증

저장소 루트에서 `npm test`를 실행합니다. 테스트와 실행 도구는 [`test/`](test/README.md)에 있습니다.
WASM 빌드 및 실제 GPU 검증 명령은 `project/package.json`을 참고합니다.
