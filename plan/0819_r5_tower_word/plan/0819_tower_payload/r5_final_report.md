# R5 Tower Payload / Actor Verbs 최종 보고서

- 기준일: 2026-08-19
- 결과: **R5 COMPLETE**
- 다음 단계: **R6 Merge NEXT**
- 수동 GameScene 플레이: **NOT EXECUTED**

## 결과 요약

R5의 Tower Payload ActorAction 수직 슬라이스와 Shoot/Throw/Emit/Summon 공유 런타임,
원자적 Tower 생성, Throw 이동, 복구·재실행, 미리보기 경계, 계측 및 실제 NW/WebGPU
스트레스 인수를 완료했다. R6 작업은 시작하지 않았다.

생산 로드아웃은 Q/E의 R3 정체성을 보존하고 SHIFT/SPACE에 R5 Shoot + Tower Payload를
연결한다. Tower Payload materialization이 이용 불가능하면 명시적
`RUNTIME_UNAVAILABLE` 미리보기 게이트에서 `AbilityRuntime` 진입 전에 정지한다. 이 결과는
정상적인 전체 0-변이이며 `PROTOCOL_REJECTED`가 아니다. Throw/Emit/Summon은 최종 R5 생산
키 배치를 늘리지 않고 주입 및 공유 런타임 인수 경로로 검증했다.

## 핵심 계약 인수

| 계약 | 구현·검증 결과 |
| --- | --- |
| 생산 입력 가능성 | 지원 불가능 시 `RUNTIME_UNAVAILABLE`, 실행 ordinal/스냅샷/쿨다운 변이 0 |
| 프로필 정체성 | 모든 의미 필드의 canonical `actorActionProfileFingerprint`를 CompiledAbility, execution command, GPU program, completion, recovery/replay에 결합 |
| Throw 권한 | `travelDurationFixedTicks`가 권위값이고, 지면 속도는 거리/기간으로 파생; source spawn과 landing SDF를 한 배치로 원자적 검증 |
| 미리보기 경계 | 미상 Subject 수는 `SUBJECT_COUNT_NOT_EXACT`, 정확한 0은 `ZERO_SUBJECT`; 모두 `executionEnabled=false`, 쿨다운 미소비 |
| 동사별 정규화 | Shoot/Throw/Emit/Summon의 필수·허용 필드, 정수/유한성/범위, 교차 계약을 WGSL 인코딩 전에 검증; 부정 fixture 포함 |
| 생성 원자성 | Body/Tower 사전 할당, GPU placement, Share/HP/Power, ALIVE-last 공개를 전체 N 또는 0으로 처리 |
| 재실행·복구 | 보류 요청은 최초 frozen command를 재사용; 세대 교체 시 durable Tower descriptor를 map anchor의 일반 active actor로 복원 |
| 쿨다운 | 인증된 `COMMITTED`만 소비; 용량/SDF/런타임 불가/정확한 0/미상 수/복구 취소는 미소비 |

## 실제 NW/WebGPU 스트레스

| 시나리오 | 결과 |
| --- | --- |
| 정확한 Subject 0 | `ZERO_SUBJECT`, 실행 비활성, 생성 0, 쿨다운 미소비 |
| Enemy 100 → Tower | Tower 100 원자적 커밋 |
| 반복 Tower Shoot | 1→2→4→8→16→32→64→128→256 정확 증가 |
| Hostile 1,000 + Tower 256 | 정확 Subject 1,000, 생성 0, Tower 256 보존, 쿨다운 미소비 |
| Enemy Throw 256 | 생성 256, AIRBORNE 동시 high-water 256, CPU per-actor controller 0 |
| Enemy Summon 256 | 생성 256, deterministic stable-rank lattice, transit 0 |
| 혼합 churn 3회 | 매 회 Shoot 1, Throw 4/landing 4, Emit 2, Summon 2; 정확 정리 |
| device-generation 복구 | Throw Tower의 execution/profile fingerprint·세대·쿨다운 보존, map anchor `(64,64)` 복원, 속도 0, stale transit 미복원 |

256 Throw fixture는 계획이 요구한 동시 AIRBORNE 256을 실측했다. 동일한 인공 fixture에서 원본과
자식 512개를 한 landing 셀에 강제로 모으지 않았으며, Throw landing은 혼합 churn 3회와 전용 Node
fixture에서 source/landing 정체성·원자성과 함께 검증했다.

## 자원 경계 계측

- active body high-water: `1,256`
- Tower / Enemy high-water: `256 / 1,000`
- placement Subject / transit actor high-water: `256 / 256`
- 고정 readback: Ability Subject `64 B`, payload `72 B`, placement `96 B`, transit `64 B`, Tower creation `96 B`
- Tower metadata-only commit record: `32 B`, 최대 `8,192 B` (`256 × 32 B`)
- storage buffers per shader stage: Ability Subject `9`, placement `9`, transit `7`, Tower creation `9`; 최대 `9`
- per-Subject transform readback / CPU spawn command: `0 / 0`
- per-actor CPU advance / JS controller: `0 / 0`
- partial creation / lost-share restoration / same-execution recursion / protocol failure: 모두 `0`
- 종료 시 Registry reservation / pending command: `0 / 0`
- serialized acceptance harness의 dropped fixed tick / lost fixed time: `0 / 0 ms`

## GPU 타이밍 증거

NVIDIA Lovelace의 `timestamp-query`로 serialized fixed-boundary GPU submission 주변에 marker를 두었다.

| 범주 | 샘플 | p50 | p95 |
| --- | ---: | ---: | ---: |
| action | 102 | 1.6384 ms | 2.162688 ms |
| placement | 36 | 1.572864 ms | 2.031616 ms |
| transit | 83 | 1.769472 ms | 2.031616 ms |
| full fixed boundary wall | 221 | 4.7 ms | 99.5 ms |

full-boundary wall 값은 CPU 오케스트레이션, queue wait, 초기 pipeline 비용을 포함한 진단값이며
프레임 예산 통과를 주장하는 수치가 아니다.

## 최종 게이트

| 게이트 | 결과 |
| --- | --- |
| `npm test` | PASS, `1,644/1,644` |
| flow-field WAT/WASM reproducibility | PASS |
| collision-contact WAT/WASM reproducibility | PASS |
| NW WebGPU capability | PASS, NVIDIA Lovelace, `timestamp-query` 지원 |
| R3 Enemy Word actual NW/WebGPU | PASS, uncaptured error 0, orderly destroyed |
| R4 Tower Group actual NW/WebGPU | PASS, uncaptured error 0, orderly destroyed |
| R5 Actor Verbs actual NW/WebGPU | PASS, recovery/protocol/uncaptured error 0, orderly destroyed |
| render golden check | PASS, 10 surfaces / 3 cases, baseline 미변경, SHA-256 `3acaa4a58bc7e8d6a6573d6283816f317203aed4575e1f917554d0d7c9663aaf` |
| title GPU smoke | PASS, T0–T5 예산 통과 |
| manual GameScene play | **NOT EXECUTED** |

## 후속 범위

R6 Merge, modifier grammar, Shop/editor, save/checkpoint, Overtime/wave completion, multi-Tower primary bullet
fanout, 장시간 soak, 수동 sandbox QA는 R5에 포함하지 않았다.
