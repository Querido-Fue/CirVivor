# 02. Game State and Flow

## 1. 상태 모델 원칙

- 저장되는 canonical state와 화면용 view model을 분리한다.
- boolean 조합 대신 enum 상태 머신을 사용한다.
- `isPaused`, `isShopOpen`, `canUseSkill`은 selector로 계산한다.
- Tower Health 필드는 어떤 상태에도 존재하지 않는다.
- 모든 phase 전이는 이전 상태, command, 결과 event를 기록한다.

## 2. GameState 개요

```text
GameState
├─ schemaRevision
├─ session
│  ├─ runId
│  ├─ seed
│  ├─ fixedTick
│  ├─ phase
│  └─ outcome
├─ campaign
│  ├─ campaignId
│  ├─ difficultyId
│  ├─ currentMapIndex
│  ├─ currentMapId
│  ├─ completedWaveIndex
│  └─ nextWaveIndex
├─ core
│  ├─ integrityCurrent
│  ├─ integrityMax
│  └─ state
├─ tower
│  ├─ entityId
│  ├─ power
│  ├─ controlState
│  └─ runModifierIds
├─ wave
│  ├─ waveId
│  ├─ state
│  ├─ spawnCursor
│  ├─ pendingSpawnCount
│  ├─ aliveHostileCount
│  └─ completionRevision
├─ economy
│  └─ gold
├─ dictionary
│  ├─ activeWordIds
│  ├─ wordInstances
│  ├─ wordProgress
│  └─ sentenceBoard
├─ shop
│  └─ session | null
├─ progression
│  ├─ pityState
│  └─ awardedGrantIds
├─ statistics
│  └─ run aggregates
└─ checkpoint
   ├─ lastCommittedRevision
   ├─ status
   └─ errorCode | null
```

Tower의 위치·속도·aim point는 전투 월드의 런타임 component다. 웨이브 경계
체크포인트에서는 다음 웨이브의 map-defined spawn으로 다시 생성하므로 저장하지
않는다.

## 3. 상위 GamePhase

```text
BOOTSTRAPPING
MAP_SETUP
WAVE_PREVIEW
WAVE_COUNTDOWN
COMBAT
WAVE_CLEANUP
WAVE_SETTLEMENT
CHECKPOINTING
SHOP
MAP_TRANSITION
RUN_COMPLETED
RUN_FAILED
SAVE_ERROR
DESTROYED
```

허용 전이:

```text
BOOTSTRAPPING
→ MAP_SETUP
→ WAVE_PREVIEW
→ WAVE_COUNTDOWN
→ COMBAT
→ WAVE_CLEANUP
→ WAVE_SETTLEMENT
→ CHECKPOINTING
→ SHOP
→ WAVE_PREVIEW | MAP_TRANSITION

MAP_TRANSITION → MAP_SETUP
COMBAT | WAVE_CLEANUP → RUN_FAILED
SHOP | MAP_TRANSITION → RUN_COMPLETED
CHECKPOINTING → SAVE_ERROR → CHECKPOINTING
any live phase → DESTROYED
```

## 4. WaveState

```text
INACTIVE
PREVIEW
COUNTDOWN
SPAWNING
CLEANUP
COMPLETED
FAILED
```

완료 조건:

1. 모든 SpawnGroup이 소진되었다.
2. 예약된 spawn intent가 없다.
3. `requireAllEnemiesDefeated`이면 hostile entity가 0이다.
4. Core가 파괴되지 않았다.
5. 같은 `completionRevision`을 이미 처리하지 않았다.

`WaveCompleted` event는 한 번만 발행한다. 웨이브 보상과 ShopSession 생성은
이 event를 다시 명령으로 순환시키지 않고 `WAVE_SETTLEMENT` 트랜잭션에서
직접 처리한다.

## 5. 웨이브 완료 트랜잭션

```text
WAVE_CLEANUP
→ 완료 조건 검증
→ simulation spawn/skill command 수락 중지
→ 남은 Gold 가치 자동 회수
→ wave reward ID 멱등 적용
→ 전투 통계 final snapshot
→ 일시 엔티티 정리
→ completedWaveIndex 확정
→ nextWaveIndex 또는 nextMap 계산
→ ShopSession 생성
→ checkpoint snapshot 생성
→ CHECKPOINTING
→ ingame.dat atomic commit
→ CheckpointCommitted
→ SHOP 입력 scope 활성화
```

저장 성공 전에는 구매·reroll·문장 편집 command를 받지 않는다. 저장이 실패하면
`SAVE_ERROR`로 전환하되 메모리의 settlement 결과는 유지한다. 재시도는 같은
`checkpointId`와 revision을 사용해 중복 보상을 만들지 않는다.

## 6. Core 상태

```text
CoreState = ACTIVE | CRITICAL | DESTROYED
```

- Integrity만 전투 생존 자원이다.
- 신규 런의 최대/초기 Integrity 기본값은
  `data/object/core/the_core_data.js`의 `THE_CORE_DATA.MAX_INTEGRITY = 100`이다.
- `current <= 0`이면 `DESTROYED`로 clamp하고 `RunFailed`를 한 번 발행한다.
- Critical 임계값은 UI selector가 계산한다.
- Core 수리는 명시적 effect/policy를 통해서만 수행한다.
- Tower와 Core의 피해 API를 하나로 합치지 않는다.

## 7. Tower 상태

```text
TowerControlState =
    ACTIVE
    | STUNNED
    | TRANSITIONING
    | UI_BLOCKED
    | PAUSED
```

Tower는 `IDamageable`을 구현하지 않는다. 적과의 접촉은 다음 중 명시된 결과만
가질 수 있다.

- 위치 분리
- 밀침
- 짧은 `STUNNED`
- 적의 Core 진행 지연 없이 통과

어떤 경우에도 HP 감소, 사망, Down, Reboot 전이를 만들지 않는다.

## 8. 일시정지

일시정지는 GamePhase와 직교하는 실행 정책이다. 유일한 실행 권한은 기존
`SystemHandler`의 pause reason 병합에 둔다.

권장 reason:

```text
app-inactive
game:user-pause
game:shop
game:checkpoint-error
game:modal
debug:frame-control
```

GameState에는 파일로 저장할 pause boolean을 두지 않는다. UI에 필요한 경우
`PauseView { activeReasons, effectivePolicy }` snapshot만 제공한다.

상점 정책:

```text
runFixedStep = false
runInputUpdate = true
runUiUpdate = true
runOverlayUpdate = true
renderFrame = true
pauseBgm = policy-defined
```

## 9. ShopSession

```text
ShopSession
├─ sessionId
├─ revision
├─ sourceCompletedWaveId
├─ offers[5]
├─ rerollCount
├─ upgradeUsed
├─ pinnedOfferId | null
├─ appliedTransactionIds
└─ nextWavePreview
```

구매·강화·reroll·문장 commit은 command 하나당:

1. phase와 revision 검증
2. 메모리 상태 원자적 변경
3. transaction ID 기록
4. checkpoint revision 증가
5. 디스크 commit
6. UI result 반환

저장 중 같은 control의 중복 입력은 잠근다. 서로 독립적인 command도 저장
repository의 단일 직렬 큐를 통과한다.

## 10. 런 재개

```text
Title Continue
→ repository.load()
→ envelope/checksum/schema/content validation
→ migration
→ GameState 생성
→ map definition resolve
→ WordSystem compiled cache 재생성
→ ShopSession 복원
→ 전투 엔티티가 없는 깨끗한 월드 생성
→ SHOP 또는 WAVE_PREVIEW 진입
```

체크포인트가 `AT_SHOP`이면 같은 offer와 transaction ledger를 복원한다.
`BEFORE_WAVE`이면 저장된 nextWaveId의 countdown부터 시작한다.

## 11. 런 종료와 체크포인트 제거

성공:

```text
최종 웨이브 settlement
→ 최종 checkpoint commit
→ 계정 보상 grant commit
→ 결과 화면
→ 사용자 확인 또는 새 런 시작 시 ingame checkpoint clear
```

실패:

```text
Core Destroyed
→ RunResult 계산
→ 필요한 계정 결과 저장
→ 실패 결과 화면
→ 실패 처리 저장 성공 뒤 checkpoint clear
```

계정 보상 저장과 checkpoint 제거 순서를 바꾸지 않는다. checkpoint를 먼저
삭제하면 보상 저장 실패 시 런 결과를 복구할 근거가 사라진다.

## 12. 핵심 불변식

- `tower.health` 필드는 존재하지 않는다.
- `phase === SHOP`이면 유효한 ShopSession과 committed checkpoint가 있다.
- `phase === COMBAT`이면 wave state는 `SPAWNING` 또는 `CLEANUP`만 허용한다.
- `CoreState.DESTROYED` 뒤 신규 spawn·skill command를 수락하지 않는다.
- `completedWaveIndex < nextWaveIndex` 관계는 campaign 데이터 범위에서만 성립한다.
- transaction ID와 reward grant ID는 한 런에서 중복 적용하지 않는다.
- 디스크 revision은 마지막 성공 commit보다 감소하지 않는다.
