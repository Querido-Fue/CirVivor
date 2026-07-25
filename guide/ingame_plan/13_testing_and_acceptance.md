# 13. Testing and Acceptance

## 1. 테스트 계층

```text
Static contract/content validation
→ Unit
→ Property/Fuzz
→ Headless integration
→ Save crash/recovery
→ Scene/UI
→ WASM parity
→ Performance
→ Long-run soak
→ Manual playtest
```

핵심 규칙은 가능한 가장 낮은 계층에서 검증한다.

## 2. 제안 테스트 경로

```text
project/game/test/
├─ ingame_game_state.test.mjs
├─ ingame_command_router.test.mjs
├─ ingame_input_router.test.mjs
├─ ingame_world_registry.test.mjs
├─ ingame_core_combat.test.mjs
├─ ingame_wave_director.test.mjs
├─ ingame_word_runtime.test.mjs
├─ ingame_log_statistics.test.mjs
├─ ingame_checkpoint_schema.test.mjs
├─ ingame_checkpoint_atomicity.test.mjs
├─ ingame_checkpoint_migration.test.mjs
├─ ingame_resume_flow.test.mjs
└─ ingame_vertical_slice.test.mjs
```

## 3. Tower 무체력 구조 검증

정적:

- Tower component definition에 Health/Damageable 없음
- `towerHealth`, `TowerDown`, `Reboot` 신규 production 참조 금지
- 저장 schema에 Tower health key 금지
- HUD에 Tower HP presenter 금지

런타임:

- 적 접촉·projectile hit가 Tower damage event를 만들지 않음
- Tower 대상 damage/heal action이 validation에서 실패
- Core Integrity 0만 기본 패배 전이를 발생
- Tower stun/knockback이 Core 및 다른 damage 결과를 오염시키지 않음

## 4. 상태 머신

- 허용 전이 전수
- 잘못된 phase command 상태 불변
- WaveCompleted 중복 방지
- CoreDestroyed/RunFailed 중복 방지
- CHECKPOINTING 동안 Shop command 차단
- SAVE_ERROR 재시도가 같은 settlement/reward를 재적용하지 않음
- destroy 뒤 command 거절

## 5. Command와 입력

- command payload/schema/revision/idempotency
- 같은 frame 5개 skill 고정 순서
- catch-up fixed tick에서 edge 중복 없음
- modal/shop/pause가 gameplay click 소비
- pause 복귀 movement clear
- resize 중 pointer capture 정리
- stale ShopSession revision 구매 거절

## 6. World와 충돌

- entity ID/incarnation과 stale handle
- pool reset 필드 전수
- swap-and-pop/index 일관성
- spawn/despawn iteration 안정성
- circle/rect/circleParts 조합
- projectile swept collision
- player/world/enemy 위치 해소
- Core body 고정
- hexa contact-before-solve와 merge
- solver가 prev render position을 이동하지 않음

## 7. AI/Path/Wave

- 모든 Gate→Core path 연결
- distance table 단조 증가
- Corebound가 Tower를 추적하지 않음
- Hunter가 Tower에 damage를 주지 않음
- blocker 파괴 후 경로 재개
- 같은 seed path/spawn 선택 동일
- pause에서 spawn/AI attack timer 정지
- cleanup의 hostile 0 완료
- boss/requireAllEnemiesDefeated 조건

## 8. Word/Combat/Log

- compiler compatibility matrix
- Subject Snapshot 신규 생성물 제외
- generation/command/spawn/damage cap
- NoSubject cooldown 미소비
- partial success cooldown
- preview/runtime formula 일치
- HitIntent → DamageApplied → death 순서
- damage source metadata 완전성
- Log aggregate exactly once
- journal wrap 뒤 aggregate 보존

## 9. checkpoint schema

- current v1 round-trip
- key order가 달라도 canonical checksum 동일
- NaN/Infinity/BigInt/cycle 거절
- unknown/prototype object 거절
- Core/Gold/index 범위
- ID uniqueness/reference
- ShopSession/resume 위치 일치
- Tower health/down key 거절
- 최대 크기/깊이/배열 길이

## 10. 파일 장애 matrix

가짜 fs adapter로 각 단계 실패를 주입한다.

| 실패 단계 | 기대 |
| --- | --- |
| temp open/write/sync | 기존 primary 유지 |
| temp 검증 | 기존 primary 유지, temp 진단 |
| old backup 제거 | primary 유지 |
| primary→backup | commit 실패, primary 또는 backup 유효 |
| temp→primary | backup 복원 또는 load recovery |
| primary 재검증 | 성공 반환 금지, backup/temp 보존 |
| checksum mismatch | candidate 거절 |
| ENOSPC/EACCES/EIO | SAVE_ERROR와 재시도 가능 |

프로세스 crash fixture:

```text
temp write 전/후
temp sync 후
primary→backup 전/후
temp→primary 전/후
```

재시작 시 항상 새 revision, 이전 revision, 명시적 손상 중 하나여야 한다.

## 11. resume 통합 시나리오

### R1 — 웨이브 완료

```text
Wave 1 완료
→ checkpoint commit
→ 프로세스 종료
→ Continue
→ 같은 Gold/Core/Word/Shop offers
```

### R2 — 구매 완료

```text
Word 구매 commit
→ 종료
→ Continue
→ Gold 1회 차감, WordInstance 1개
```

### R3 — 저장 실패

```text
Wave settlement
→ temp rename 실패
→ SAVE_ERROR
→ retry
→ reward/ShopSession 1회
```

### R4 — 다음 웨이브

```text
StartNextWave commit
→ 전투 중 종료
→ Continue
→ BEFORE_WAVE countdown
→ 이전 상점 재이용 불가
```

### R5 — 손상 복구

```text
primary checksum 손상
→ backup valid
→ Continue
→ recovery 알림과 정상 상태
```

## 12. 수직 슬라이스 인수 기준

- Tower 이동·조준과 1개 유효 문장
- 적이 Path를 따라 Core 공격
- Core damage/파괴
- 한 Wave schedule/cleanup/completion
- Gold 정산과 5개 Shop offer
- 구매 또는 reroll 1개
- `ingame.dat` 저장
- 앱 재시작 Continue
- 같은 ShopSession에서 다음 Wave 시작
- Tower HP 관련 코드/UI/save 없음

## 13. WASM과 기존 회귀

프로젝트 루트 `project/`에서:

```text
npm test
npm run check:wasm:flow-field
npm run test:wasm:flow-field:stress
npm run check:wasm:collision-contact
npm run benchmark:wasm:flow-field
npm run benchmark:wasm:collision-contact
```

성능 benchmark는 동일 기기, 동일 build, warmup, AB/BA 순서를 사용한다.

## 14. 성능 지표

- actual fixed tick/s
- dropped fixed-step debt/lost simulation seconds
- frame/fixed/collision p95/p99
- active entity by kind
- spawn requested/accepted/suppressed
- AI decision tier count
- collision candidates/narrow/solve
- event count와 journal drop
- checkpoint bytes/serialize/write/commit duration
- pool miss/discard
- map transition 후 heap/active count

표시 FPS 개선만으로 승인하지 않는다.

## 15. Soak

자동:

- 100회 Wave→Shop→Continue
- 20회 Map transition
- 반복 save/reload/migration
- 100~500 hostile
- recursive word stress
- 저장 directory에 stale temp/backup 조합

완료:

- entity/UI/listener 누수 없음
- checkpoint revision 단조 증가
- transaction/reward 중복 없음
- 메모리 사용량이 안정 범위로 수렴

## 16. CI 게이트

PR:

- syntax/static checks
- content/schema validation
- unit/integration
- checkpoint failure subset
- WASM deterministic check
- `git diff --check`

주기:

- full crash matrix
- fuzz
- WASM stress/benchmark
- long-run soak
- NW.js scene/UI golden

## 17. 완료 보고

각 구현 단계 완료 시 다음을 남긴다.

- 변경된 계약
- 실행한 명령과 결과
- 새/갱신 test
- 성능 비교
- 남은 open decision
- 실제 코드 경로와 가이드 링크

