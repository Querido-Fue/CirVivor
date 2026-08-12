> **2026-08-08 gameplay authority update**
>
> Tower damage/death/share-loss, player-created enemy bounty, Overtime pressure, zero-Tower victory,
> split, and merge events are now required. Read `../gameplay/08_save_telemetry_testing.md`.

# 08. Log and Statistics System

## 1. 목적

LogSystem은 게임에서 이미 발생한 사실을 기록하고 통계를 제공한다.

주요 소비자:

- HUD와 결과 화면
- 대미지/단어/문장 통계
- 웨이브 정산
- 디버그 타임라인
- 로컬 replay bundle
- 선택적 aggregate telemetry

LogSystem은 상태 변경 권한이 아니다.

## 2. 구조

```text
LogSystem
├─ EventJournal
├─ DamageStatisticsAggregator
├─ AbilityStatisticsAggregator
├─ WaveStatisticsAggregator
├─ EconomyStatisticsAggregator
├─ LaneStatisticsAggregator
└─ StatisticsSnapshotBuilder
```

## 3. Event envelope

```text
eventType
eventId
sequence
fixedTick
runId
mapId
waveId
executionId optional
payload
```

event ID 예:

```text
evt.<runId>.<fixedTick>.<sequence>
```

장기 저장 event에는 객체 identity나 현지화 문자열을 넣지 않는다.

## 4. 핵심 이벤트

### 런과 상태

```text
RunStarted
RunResumed
MapEntered
WaveStarted
WaveCompleted
WaveSettlementCompleted
CheckpointCommitted
CheckpointFailed
ShopOpened
MapCleared
CoreDamaged
CoreDestroyed
RunCompleted
RunFailed
```

### 전투

```text
AbilityExecutionStarted
AbilityExecutionFinished
EntitySpawned
SpawnSuppressed
HitOccurred
DamageApplied
EntityDied
StructureDestroyed
GoldDropped
GoldCollected
```

### 단어·상점

```text
SentenceCommitted
WordPurchased
WordUpgraded
ShopRerolled
ShopTransactionCommitted
```

TowerDamageApplied, TowerDied, TowerShareLost 이벤트가 필요하다. 자동 reboot로 Lost Share를 복구하지 않는다.

## 5. DamageApplied payload

```text
sourceEntityId
targetEntityId
targetKindId
sourceAbilityId
sourceSentenceId
payloadWordId
executionId
generation
laneId
rawAmount
mitigatedAmount
appliedAmount
overkillAmount
critical
damageTags
```

Core 대상이면 `targetKindId = core`이고 Core-specific summary에도 반영한다.

## 6. 대미지 통계

집계 축:

```text
byAbilityId
bySentenceId
byPayloadWordId
byEntityKind
byGeneration
byLane
byWave
```

각 bucket:

```text
executionCount
hitCount
damageApplied
overkill
killCount
spawnRequested
spawnAccepted
spawnSuppressed
maxGeneration
```

UI는 raw event 전체를 매 frame 순회하지 않고 revision이 붙은 aggregate snapshot을
읽는다.

## 7. EventJournal

- debug용 고정 용량 ring buffer를 사용한다.
- production 기본은 aggregate에 필요한 최소 event만 보존한다.
- 오래된 raw event가 제거되어도 누적 통계는 유지한다.
- payload 크기와 batch item 수를 제한한다.
- 문자열 formatting은 디버그 UI가 요청할 때 수행한다.

권장 진단 필드:

```text
droppedJournalEventCount
batchedHitCount
unknownEventCount
maxEventsPerTick
```

## 8. 처리 순서

```text
시스템이 pending event 작성
→ GameEventStream commitTick
→ event sequence 확정
→ LogSystem aggregate
→ UI/VFX subscriber 통지
```

LogSystem subscriber 순서가 combat 결과를 바꾸지 않아야 한다. 통계 처리 실패는
전투 mutation을 rollback하지 않지만 개발 빌드에서 즉시 진단한다.

## 9. 웨이브 정산 snapshot

WaveStatistics:

```text
waveId
startedAtTick
completedAtTick
durationTicks
spawnedByKind
killedByKind
damageByAbility
coreDamageTaken
goldDropped
goldCollected
capSuppressions
peakEntities
peakCollisionCandidates
```

WaveDirector가 완료를 확정하면 LogSystem은 동일 completion revision의 snapshot을
한 번만 freeze한다. CheckpointCoordinator는 frozen snapshot만 저장한다.

## 10. 런 체크포인트

저장:

- 누적 run aggregate
- 완료 웨이브 summary
- 필요한 pity/경제 계산용 counter

기본적으로 저장하지 않음:

- raw EventJournal
- 매 hit 상세
- Canvas 표시 문자열
- profiler 원시 sample

버그 재현 export 기능은 별도 명시적 사용자 동작으로 raw journal을 포함할 수 있다.

## 11. 텔레메트리 경계

LogSystem은 로컬 사실과 통계를 제공한다. 원격 전송은 별도 infrastructure sink다.

- 개별 hit를 원격 전송하지 않는다.
- 개인 식별 정보와 파일 경로를 기록하지 않는다.
- opt-out과 오프라인 동작을 보장한다.
- 전송 실패가 저장이나 웨이브 완료를 막지 않는다.

## 12. 성능

- hot event payload는 pooled record 또는 struct-like object를 사용한다.
- 실행별/틱별 상한을 둔다.
- 숫자 ID를 우선하고 문자열 label은 view 단계에서 resolve한다.
- aggregate map key가 무제한 증가하지 않도록 content ID 기반으로 제한한다.
- checkpoint snapshot 생성 시 live accumulator를 직접 노출하지 않는다.

## 13. 테스트 계약

- 한 DamageApplied가 모든 관련 aggregate에 정확히 한 번 반영된다.
- overkill과 applied damage가 분리된다.
- 같은 checkpoint/reward event 재처리가 누적 통계를 늘리지 않는다.
- ring buffer wrap 뒤 누적 통계는 유지된다.
- Tower damage 계열 event를 입력하면 schema validation이 실패한다.
- VFX/telemetry subscriber를 끄거나 켜도 전투 결과가 같다.
