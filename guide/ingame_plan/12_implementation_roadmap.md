# 12. Implementation Roadmap

## 1. 진행 상태

상태 표기:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
DONE
```

현재 세부 완료 범위와 임시 우회는
[`game_implement_progress.md`](./game_implement_progress.md)를 단일 기준으로
삼는다. 문서 설계나 빈 골격을 코드 구현 완료로 표시하지 않는다.

## 2. 단계 요약

| 단계 | 목표 | 상태 |
| --- | --- | --- |
| P0 | 권한·문서·characterization 정리 | NOT_STARTED |
| P1 | GameSystem 계약과 headless 기반 | IN_PROGRESS |
| P2 | 원자적 RunCheckpointRepository | NOT_STARTED |
| P3 | WorldRegistry와 충돌 kernel adapter | IN_PROGRESS |
| P4 | Tower/Core/Input 수직 골격 | IN_PROGRESS |
| P5 | Path/AI/Wave 한 웨이브 | NOT_STARTED |
| P6 | Word/Combat/Log 수직 슬라이스 | NOT_STARTED |
| P7 | Shop/GameUI/체크포인트/Continue | NOT_STARTED |
| P8 | production cutover와 benchmark 분리 | IN_PROGRESS |
| P9 | 성능·장애·장기 런 hardening | NOT_STARTED |

## 3. P0 — 권한과 baseline 고정

작업:

1. `guide/game structure/`의 Tower HP/Down/Reboot 항목을 현재 결정과 일치시킨다.
2. 기존 GameScene resize reset 회귀 테스트를 추가한다.
3. 기존 ObjectSystem fixed 순서와 hexa contact-before-solve characterization을 고정한다.
4. 현재 WASM parity/benchmark 결과를 baseline artifact로 기록한다.
5. placeholder `ingame.dat` shape와 테스트를 legacy v0 fixture로 보존한다.
6. dirty worktree의 기존 사용자 변경과 작업 범위를 분리한다.

완료 게이트:

- 문서에서 Tower HP 구현 지시가 제거됨
- 현행 테스트와 WASM check 통과
- 보존/교체 대상 파일 목록 확정

## 4. P1 — GameSystem 기반

예상 파일:

```text
module/ingame/game_system.js
module/ingame/contract/*
module/ingame/state/*
module/ingame/command/*
module/ingame/event/*
```

작업:

1. `ingame/` importmap alias 추가
2. GamePhase/WaveState/CoreState schema
3. GameStateStore와 selector
4. command envelope/router/fixed buffer
5. event stream과 sequence
6. IGameSubsystem lifecycle
7. dependency factory와 memory test adapters
8. invariant checker

완료 게이트:

- DOM/NW.js 없이 GameSystem 생성·phase 전이 테스트 가능
- Tower state에 health key가 없음
- invalid/stale/duplicate command가 상태를 바꾸지 않음
- init failure 역순 destroy 검증

## 5. P2 — RunCheckpointRepository

예상 파일:

```text
module/save/ingame/run_checkpoint_repository.js
module/save/ingame/run_checkpoint_schema.js
module/save/ingame/run_checkpoint_validator.js
module/save/ingame/run_checkpoint_serializer.js
module/save/ingame/run_checkpoint_atomic_writer.js
module/save/ingame/migrations/*
```

작업:

1. crypto/fs bridge에 필요한 최소 Node API 추가
2. canonical serializer와 checksum
3. v1 schema/validator
4. temp-write/sync/verify/rotate/rename
5. primary/temp/backup load recovery
6. monotonic revision 직렬 commit queue
7. legacy v0 quarantine
8. SaveSystem에 repository 조립
9. 기존 JSDoc hash test를 새 동작 계약 test로 교체

완료 게이트:

- 모든 파일 연산 장애 주입에서 이전 또는 새 save 복구
- 손상 primary → backup
- 유효 primary + 미완료 temp에서는 primary 선택
- live state 참조가 저장 모듈 밖으로 노출되지 않음

## 6. P3 — WorldRegistry와 충돌 adapter

작업:

1. entity handle/id/incarnation
2. capability indexes
3. spawn/despawn buffer
4. pool reset contract
5. Tower/Core/Enemy/Projectile 최소 component
6. 기존 collision body adapter
7. HitIntent output
8. render interpolation view
9. scene/map destroy leak counters

완료 게이트:

- Tower에 Damageable/Health 없음
- 새 WorldRegistry의 projectile-enemy sweep 동작
- collision JS/WASM parity 유지
- stale pooled handle 거절
- resize가 world snapshot을 바꾸지 않음

## 7. P4 — Tower/Core/Input

작업:

1. InputActionMapper
2. PlayerControlRouter와 context stack
3. Tower controllable
4. movement/aim fixed command
5. Core Integrity와 CombatResolver 최소 경로
6. pause port와 `game:user-pause`
7. HUD용 최소 GameView

완료 게이트:

- WASD/aim과 UI focus가 충돌하지 않음
- Tower contact는 위치/제어만 발생
- Core damage와 단일 RunFailed 전이
- pause 복귀 시 입력/catch-up 누적 없음

## 8. P5 — Path/AI/Wave

작업:

1. MapDefinition/Path/Lane validator
2. Path sampling과 blocker index
3. AISystem context와 policy registry
4. 기존 Flow Field backend adapter
5. Corebound policy
6. WaveDefinition fixed tick schedule
7. named RNG stream
8. Wave cleanup/completion revision

완료 게이트:

- 한 Gate에서 적이 Core까지 진행
- 같은 seed spawn/path 동일
- pause에서 wave 정지
- WaveCompleted 한 번
- Tower가 적 목표 fallback의 생존 조건이 아님

## 9. P6 — Word/Combat/Log

작업:

1. 최소 Word catalog/schema
2. SentenceDefinition/Compiler
3. AbilityRuntime/SubjectSnapshot
4. Shoot/Fireball executor
5. generation/spawn/work budget
6. CombatResolver 전체 event metadata
7. LogSystem damage/ability/wave aggregate
8. CompiledAbility cache/invalidator

완료 게이트:

- Tower shoots Fireballs
- Fireballs throw Fireballs의 같은 execution 재참여 금지
- damage stats가 ability/word/execution에 귀속
- Tower 대상 damage/heal 콘텐츠 거절
- cap stress에서 hang 없음

## 10. P7 — Shop, UI, Checkpoint, Continue

작업:

1. ShopSession과 offer generation
2. 구매/reroll/upgrade transaction
3. SentenceBoard UI
4. Wave settlement draft
5. CheckpointCoordinator
6. `WAVE_COMPLETED` atomic commit
7. Shop transaction commit
8. `BEFORE_WAVE` commit
9. Title Continue metadata
10. resume load/recompile/map setup
11. SAVE_ERROR retry UI

완료 게이트:

- 웨이브 완료 직후 강제 종료·재시작 후 같은 상점
- 구매 직후 종료 후 Gold/Word 중복 없음
- StartNextWave 뒤 종료 시 상점 재이용 불가
- 저장 실패에서 성공 UI를 표시하지 않음

## 11. P8 — Production cutover

작업:

1. GameScene을 얇은 adapter로 교체
2. SystemHandler의 기존 gameplay ObjectSystem double tick 제거
3. BenchmarkScene 분리
4. placeholder command builders/renderers 제거
5. legacy Player/Wall/Projectile 제거 또는 infrastructure로 축소
6. importmap/dead export 정리
7. scene transition/destroy 통합
8. 현재 구조 가이드 실제 경로 갱신

완료 게이트:

- play 경로에서 legacy GameScene state mutation 0
- title/loading/benchmark 회귀 없음
- scene destroy 뒤 entity/UI/listener 0
- 전체 테스트 통과

## 12. P9 — Hardening

작업:

1. 100~500 hostile와 player entity flood 측정
2. actual fixed tick/s/debt/p95/p99
3. checkpoint 최대 크기/장기 run
4. 100회 wave/shop/continue soak
5. save crash matrix 자동화
6. deterministic command log 비교
7. VFX/audio suppression
8. localization/accessibility/manual playtest

완료 게이트:

- stress scenario hang/crash 없음
- 저장·맵 전환 memory 증가가 안정화
- 같은 seed 핵심 aggregate 동일
- VFX/telemetry on/off 결과 동일
- 사용자가 save/recovery 상태를 이해할 수 있음

## 13. 원자적 구현 단위

한 PR/변경 배치는 가능한 한 다음 중 하나만 완결한다.

- schema + validator + unit tests
- command + handler + result tests
- system port + adapter + characterization
- UI presenter + view selector + interaction tests
- migration + fixture + round-trip

서로 다른 phase의 반쯤 연결된 코드를 feature flag로 오래 유지하지 않는다.

## 14. 문서 갱신 시점

- 모든 구현 변경: `game_implement_progress.md`의 완료/미구현/임시 우회/검증을 갱신
- P1 완료: 실제 공개 export와 폴더 경로 반영
- P2 완료: `10_ingame_checkpoint.md`에 실제 fs 단계와 schema version 반영
- P3/P5 완료: 기존 collision/AI 가이드의 새 owner 반영
- P7 완료: resume 화면과 저장 오류 UX 반영
- P8 완료: 기존 placeholder 가이드와 진행 문서 정리
