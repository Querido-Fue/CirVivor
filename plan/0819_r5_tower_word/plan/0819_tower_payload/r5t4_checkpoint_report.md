# R5 Turn 4 Checkpoint Report

검증일: 2026-08-19

상태: **COMPLETE**

## 구현 범위

- production `SHIFT`: `The Tower shoots The Tower`
- production `SPACE`: `Enemies shoot The Tower`
- Tower Payload runtime 미제공 시 `RUNTIME_UNAVAILABLE` 정상 0-mutation ingress
- GPU Subject snapshot → ActorAction placement → Tower creation transaction → authentic completion → cooldown 연결
- Tower creation `COMMITTED`에서만 cooldown 소비
- actorActionProfileFingerprint completion identity/replay 연결
- frozen Subject count, capacity 256/257, source-death, zero-Share 시나리오 추가
- pending ActorAction placement 중 GPU recovery 감지 순서 보강
- NW timeout 시 exact child + renderer process tree 강제 종료 및 마지막 checkpoint 진단 보존
- Tower Payload prelease body를 pending 상태로 격리하고 authentic commit에서만 active로 승격
- body storage capacity와 논리 Tower capacity를 분리해 256 Tower 경계를 유지

## 통과한 검증

| 검증 | 결과 | 증거 |
|---|---:|---|
| Focused R5/runner-guard Node tests | PASS | 26 tests, 26 pass, 0 fail |
| `npm test` | PASS | 1,627 tests, 1,627 pass, 0 fail |
| `npm run check:wasm:flow-field` | PASS | WAT/WASM 재현성 검사 통과 |
| `npm run check:wasm:collision-contact` | PASS | collision contact WAT/WASM 재현성 검사 통과 |
| 변경 JS/MJS `node --check` | PASS | 모든 변경 파일 exit 0 |
| `npm run test:webgpu:capability` | PASS | exit 0, uncaptured error 0, destroyed teardown |
| `npm run test:webgpu:r3-enemy-word` | PASS | exit 0, storage maximum 9, recovery false |
| `npm run test:webgpu:r4-tower-group` | PASS | exit 0, 256 exact/257 reject, replay no duplicate, uncaptured error 0 |
| `npm run test:webgpu:r5-actor-verbs` | PASS | exit 0, R5 minimum matrix 전부 통과 |
| `npm run test:render:golden` | PASS | 10 surfaces / 3 cases, baseline 변경 없음 |
| `git diff --check` | PASS | 출력 없음, exit 0 |

## Actual GPU R5 결과

NW 0.108.0 actual-GPU 실행에서 다음 경계를 확인했다.

| 시나리오 | 결과 |
|---|---:|
| Tower 1 → 2 | PASS |
| Tower 2 → 4 | PASS |
| Enemy 10 → Tower 11 | PASS, Subject/generated 10 |
| Enemy 255 + Tower 1 | PASS, Tower 256 commit |
| Enemy 256 + Tower 1 | PASS, atomic reject / generated 0 / cooldown 미소비 |
| Enemy source death after snapshot | PASS, frozen child materialization |
| Tower source death with survivor | PASS, Subject/generated 2 / Tower 3 / Lost Share 보존 |
| only living Tower death | PASS, `REJECTED_ZERO_SHARE` / generated 0 / cooldown 미소비 |
| same-execution recursion | PASS, 0 |
| profile fingerprint binding | PASS |
| storage / recovery / teardown | maximum 9 / recovery false / destroyed |
| uncaptured GPU error | 0 |

ActorAction actual-GPU 러너의 polling window는 최대 약 5초로 늘리고 runtime failure/status를 즉시 보고하도록 진단을 보강했다. 공통 NW child guard는 timeout 시 Windows `taskkill /t /f`로 격리된 exact PID의 renderer descendant까지 종료하고 마지막 JSON checkpoint를 오류에 포함한다. 정상 종료/timeout 종료/invalid timeout의 headless Node 검증 3개가 통과했다.

R5 actual-GPU 러너가 사용하는 제한 production manifest의 transitive import closure도 정적으로 검증한다. R5 runner에서 도달하는 모든 production module이 격리 앱 목록에 포함됨을 확인했으며 누락은 0이다.

R5 bootstrap은 result-path 누락이나 첫 checkpoint write 실패도 catch 범위 안에서 진단하고 `nw.App.quit()`한다. 두 실패 fixture가 앱을 열린 채 남기지 않고 정확히 한 번 종료함을 VM 테스트로 검증했다.

초기 NW 실패를 재현 가능한 계약 위반으로 분해해 수정했다. R4 fixture에는 canonical Shoot profile identity를 결합했고, Tower prelease는 active spawn API 이후 pending slot으로 격리했다. R5 fixture의 canonical Subject budget과 SDF 좌표를 바로잡았으며, logical Tower capacity와 body storage capacity를 분리했다. source-death fixture는 roster commit을 동기화하고, zero-Share는 snapshot binding보다 먼저 canonical preview preflight를 수행해 `REJECTED_ZERO_SHARE`를 보존한다. 수정 후 capability/R3/R4/R5를 모두 실제 NW에서 재실행했고 남은 NW/Node 프로세스가 없음을 확인했다.

Render golden receipt는 profile `win32-x64-nw0.108.0-dpr1-7eb3079ce6d3`, 10 surfaces / 3 cases, SHA-256 `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf`이다. baseline 파일은 갱신하지 않았다.

## 완료 판정

Turn 4의 full Node/WASM/capability/R3/R4/R5 WebGPU/golden 및 diff 검증이 모두 통과했다. 진행 파일을 `r5t4 수행 완료.`로 갱신하고 Turn 4 변경을 하나의 커밋으로 봉인한다.
