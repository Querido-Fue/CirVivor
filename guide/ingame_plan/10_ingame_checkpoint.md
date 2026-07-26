# 10. Ingame Checkpoint and `ingame.dat`

## 1. 목적

`ingame.dat`은 현재 런을 안전한 웨이브 경계에서 이어하기 위한 단일 primary
체크포인트다.

보장:

- 웨이브 완료 후 종료해도 정산된 상태로 이어한다.
- 상점 구매·강화·reroll·문장 편집이 중복되거나 유실되지 않는다.
- 손상된 primary에서 backup으로 복구할 수 있다.
- schema/content version을 검증하고 순차 migration할 수 있다.
- 저장 실패를 새 런 데이터로 조용히 덮어쓰지 않는다.

보장하지 않음:

- 전투 도중 적·투사체 위치 복원
- 악의적 파일 변조 방지
- 기기 간 cloud conflict merge

## 2. 현재 IngameHandler 교체 판단

현재 `_ingame_handler.js`는 다음 이유로 새 checkpoint repository로 교체한다.

- placeholder `current_level/current_xp/items` 구조
- schema/content version 없음
- JSON root와 중첩 필드 검증 없음
- live 객체 참조를 외부에 노출
- 직접 `writeFile(primary)`하여 부분 쓰기 위험
- temp/backup/checksum 없음
- 로드 실패를 기본값으로 축약해 손상을 숨김
- 파일 부재 시 의미 없는 새 인게임 파일을 즉시 생성

`SaveSystem`의 settings/progress handler와 생명주기는 유지할 수 있지만
IngameHandler 공개 API는 호환 대상으로 보지 않는다.

## 3. 파일 집합

```text
save/
├─ ingame.dat             primary committed checkpoint
├─ ingame.dat.tmp         다음 revision의 완전 검증 전 임시 파일
├─ ingame.dat.bak         직전 유효 primary
└─ quarantine/            손상·지원 불가 파일 보존, 자동 생성 가능
```

사용자가 요구한 실제 재개 데이터는 `ingame.dat`에 있다. `.tmp`와 `.bak`은
원자적 교체와 복구를 위한 보조 파일이다.

## 4. Envelope

```json
{
    "format": "cirvivor.ingame.checkpoint",
    "schemaVersion": 1,
    "contentVersion": 1,
    "buildVersion": "0.4",
    "runId": "run.01J...",
    "checkpointId": "checkpoint.run.01J.0000042",
    "revision": 42,
    "reason": "WAVE_COMPLETED",
    "createdAtUtc": "2026-07-26T12:34:56.000Z",
    "payload": {},
    "checksum": {
        "algorithm": "sha256",
        "value": "..."
    }
}
```

checksum은 `checksum` 필드를 제외한 envelope을 canonical JSON으로 직렬화한
UTF-8 bytes에 대해 계산한다.

canonical JSON 규칙:

- object key는 code-point 기준 오름차순
- array 순서 보존
- finite number만 허용
- `undefined`, 함수, Symbol, BigInt, 순환 참조 거절
- `NaN`, `Infinity`, `-Infinity`를 `null`로 바꾸지 않고 거절
- 날짜는 호출 전에 ISO 문자열로 정규화

checksum은 우발적 손상 탐지용이며 신뢰할 수 있는 서명이 아니다.

## 5. Payload schema

```text
payload
├─ resume
│  ├─ kind: AT_SHOP | BEFORE_WAVE | MAP_TRANSITION | RUN_RESULT
│  ├─ campaignId
│  ├─ difficultyId
│  ├─ currentMapIndex
│  ├─ currentMapId
│  ├─ completedWaveIndex
│  ├─ nextWaveIndex
│  └─ nextWaveId
├─ rng
│  ├─ runSeed
│  └─ namedStreamStates
├─ core
│  ├─ integrityCurrent
│  └─ integrityMax
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
│  ├─ runModifierIds
│  └─ awardedGrantIds
├─ statistics
│  ├─ runAggregate
│  └─ completedWaveSummaries
└─ transactions
   ├─ appliedShopTransactionIds
   └─ appliedWaveSettlementIds
```

Tower health, Tower down state, Tower position은 존재하지 않는다.

## 6. 저장하지 않는 런타임 상태

- 적·투사체·코인·구조물의 현재 위치와 HP
- Tower 위치·속도·aim point
- collision body/grid/contact/sleep
- AI decision cache, LOS cache, Flow Field cache
- active cooldown
- SubjectSnapshot, Execution, intent queue
- CompiledAbility
- VFX/Audio/UI animation
- raw EventJournal
- pause reason
- benchmark/profiler sample

재개 시 다음 웨이브는 깨끗한 월드와 초기화된 cooldown에서 시작한다.

## 7. 필수 저장 시점

### 7.1 웨이브 완료

필수 full checkpoint:

```text
WaveCompleted
→ settlement draft
→ reward/Gold/statistics
→ ShopSession
→ resume.kind = AT_SHOP
→ commit
→ canonical state publish
→ Shop open
```

### 7.2 상점 transaction

구매, 강화, reroll은 각각 durable commit을 마친 뒤 성공으로 표시한다.

### 7.3 문장 commit

상점에서 SentenceBoard가 바뀌면 같은 repository로 저장한다. 빠른 연속 drag
중에는 tentative edit를 저장하지 않고 최종 commit만 저장한다.

### 7.4 다음 웨이브 시작

StartNextWave command:

```text
Shop close draft
→ resume.kind = BEFORE_WAVE
→ nextWaveId 고정
→ commit
→ countdown 진입
```

이 저장은 다음 웨이브를 일부 본 뒤 상점으로 되돌아가는 악용과 ShopSession
재실행을 막는다.

### 7.5 맵 전환과 런 결과

- 맵 보상 grant가 적용된 뒤 `MAP_TRANSITION`
- 최종 결과와 account grant 연결이 확정된 뒤 `RUN_RESULT`
- account save 성공 전에 checkpoint를 삭제하지 않는다.

## 8. Two-phase 상태 commit

디스크 저장과 메모리 상태가 어긋나지 않게 다음 절차를 사용한다.

```text
현재 canonical state
→ command 검증
→ next-state draft 생성
→ invariant/schema 검증
→ checkpoint snapshot deep copy/freeze
→ repository.commit(snapshot)
→ 성공: canonical state를 draft로 교체, event publish
→ 실패: draft를 pending retry로 보관, canonical state 유지
```

웨이브 정산도 같은 원칙을 사용한다. 저장 실패 시 pending settlement draft를
메모리에 보관하고 같은 checkpoint ID로 재시도한다. reward와 ShopSession을
다시 생성하지 않는다.

전투 fixed tick마다 deep copy하지 않는다. 이 transaction은 전투가 멈춘
웨이브/상점 경계에서만 사용한다.

## 9. Repository API

```text
load() -> Promise<LoadCheckpointResult>
commit(checkpointDraft, reason) -> Promise<CommitCheckpointResult>
clear(expectedRunId) -> Promise<ClearCheckpointResult>
inspect() -> Promise<CheckpointMetadataResult>
quarantine(candidate, reason) -> Promise<void>
```

결과 코드는 예외 문자열을 UI에 직접 노출하지 않는다.

```text
LOAD_NONE
LOAD_PRIMARY
LOAD_RECOVERED_TEMP
LOAD_RECOVERED_BACKUP
LOAD_UNSUPPORTED_SCHEMA
LOAD_CORRUPT
COMMIT_OK
COMMIT_VALIDATION_FAILED
COMMIT_SERIALIZE_FAILED
COMMIT_IO_FAILED
COMMIT_STALE_REVISION
CLEAR_OK
CLEAR_RUN_ID_MISMATCH
```

진단 객체에는 `stage`, Node error name/code, candidate path kind, revision을
포함하되 사용자 경로 전체를 원격 로그로 전송하지 않는다.

## 10. Commit 알고리즘

동일 repository의 commit은 단일 Promise queue로 직렬화한다.

1. `revision > lastCommittedRevision`과 checkpoint ID를 검증한다.
2. live state와 분리된 snapshot을 schema 검증한다.
3. canonical serialize와 SHA-256을 계산한다.
4. 최대 파일 크기와 배열 상한을 확인한다.
5. 저장 경로가 실제 디렉터리인지 `stat()`으로 확인하거나 생성한다.
6. `ingame.dat.tmp`을 `open('w')`하고 전체 bytes를 쓴다.
7. temp file handle을 `sync()`한 뒤 닫는다.
8. temp를 다시 읽어 parse/schema/checksum/revision을 검증한다.
9. 기존 primary가 유효하면 오래된 backup을 제거하고
   `rename(primary, backup)`한다.
10. `rename(temp, primary)`로 새 revision을 publish한다.
11. 가능한 런타임에서는 디렉터리 metadata sync를 best effort로 수행한다.
12. primary를 다시 검증하고 commit 성공을 반환한다.

Windows에서 기존 destination 위 rename 동작에 기대지 않는다. primary를 먼저
backup 이름으로 옮긴 뒤 temp를 primary로 옮긴다. 9단계 이후 실패하면:

- primary가 없고 backup이 있으면 backup을 primary로 복원 시도
- temp는 진단과 다음 load 복구를 위해 보존
- 성공 결과를 반환하지 않음

기존 primary가 손상되었다면 backup으로 회전하지 않고 quarantine 후보로
보존한다.

## 11. Load와 crash recovery

각 candidate를 독립적으로 읽고 다음을 검증한다.

```text
size
UTF-8/JSON parse
plain object root
format
schemaVersion
checksum
revision/runId
payload schema
content references
```

선택 순서:

1. primary가 유효하면 primary 사용
2. primary가 없거나 무효이고 temp가 유효하면 temp 복구·primary 승격
3. 그렇지 않고 backup이 유효하면 backup 복구·primary 복사/승격
4. 모두 무효면 `LOAD_CORRUPT`

primary가 유효할 때 더 높은 revision의 temp가 있더라도 자동 사용하지 않는다.
temp는 commit publish 전 crash일 수 있기 때문이다.

복구 성공 시:

- 결과에 recovery source를 표시
- 원본 손상 파일을 quarantine
- 복구한 bytes를 새 primary로 원자적 재작성
- 사용자에게 비차단 복구 알림

## 12. Validation

Envelope:

- 정확한 format
- 지원 schema range
- revision은 0 이상의 safe integer
- run/checkpoint ID 길이와 문자 제한
- timestamp parse 가능

Payload:

- Core Integrity finite, `0 <= current <= max`
- Gold와 index safe integer, 음수 금지
- map/wave/content ID resolve
- WordInstance ID uniqueness
- Sentence slot과 instance reference 일관성
- transaction/grant ID uniqueness
- ShopSession source wave와 resume 위치 일치
- Tower health/down/reboot key가 있으면 v1 schema에서는 거절
- 알려지지 않은 임의 prototype/object 금지

검증은 입력 객체를 mutate하거나 누락 키를 조용히 기본값으로 채우지 않는다.
기본값 추가는 명시적 migration에서만 수행한다.

## 13. Schema migration

```text
read raw
→ envelope/basic checksum
→ vN validator
→ migrate vN → vN+1
→ 각 단계 validation
→ current schema validation
→ 새 revision으로 commit
```

규칙:

- 순차 migration만 허용
- 원본 candidate 보존
- migration은 순수 함수
- ID alias map은 콘텐츠 migration 데이터에서 직접 import
- retired Word는 명시적 placeholder/refund 정책
- migration 실패 시 원본을 새 게임 데이터로 덮어쓰지 않음

## 14. 현재 placeholder 파일 처리

다음 shape는 legacy v0로 식별한다.

```text
current_level
current_xp
items
```

이 데이터는 실제 런 의미가 없으므로 새 checkpoint로 추정 변환하지 않는다.

처리:

1. 파일 bytes를 `quarantine/ingame.legacy-v0.<timestamp>.dat`로 보존
2. `LOAD_NONE`과 별도 `legacyDetected` 진단 반환
3. 사용자에게 새 런 시작 안내
4. 새 런 생성만으로 빈 `ingame.dat`을 미리 쓰지 않음
5. 첫 의미 있는 run checkpoint에서 v1 primary 생성

## 15. Clear 정책

`clear(expectedRunId)`는 현재 primary의 runId가 예상과 일치할 때만 수행한다.

순서:

1. account reward/save 성공 확인
2. primary/backup/temp metadata 확인
3. primary를 완료 archive 또는 trash 경로로 이동
4. backup/temp 정리
5. 메모리 checkpoint metadata 초기화

개발·진단 빌드에서는 최근 완료 checkpoint 하나를 보존할 수 있다.

## 16. 파일 크기와 자원 상한

초기 제안:

```text
maxCheckpointBytes = 4 MiB
maxWordInstances = 512
maxSentenceSlots = 5
maxCompletedWaveSummaries = campaign wave count
maxTransactionIds = bounded by current run shop count
maxStringLength = field-specific
maxObjectDepth = 32
```

실제 campaign 상한과 함께 조정한다. 무제한 unknown key 보존은 하지 않는다.

## 17. SaveSystem 통합

권장:

```text
SaveSystem
├─ SettingHandler
├─ ProgressHandler 또는 향후 AccountRepository
└─ RunCheckpointRepository
```

GameSystem은 `getSaveSystemInstance().ingameHandler` live 참조를 사용하지 않고
생성 시 `IRunCheckpointRepository`를 주입받는다.

`saveAll()`은 설정/계정과 런 checkpoint의 서로 다른 transaction 의미를
숨기므로 GameSystem의 웨이브 저장 경로에서는 사용하지 않는다.

## 18. 필수 장애 주입 테스트

각 단계에서 실패:

```text
mkdir/stat
temp open
partial write
file sync
temp close
temp reread
backup unlink
primary→backup rename
temp→primary rename
primary reread
checksum mismatch
disk full
permission denied
process crash after each rename boundary
```

모든 경우 다음 중 하나여야 한다.

- 새 checkpoint가 완전히 커밋됨
- 이전 checkpoint가 로드됨
- 명시적 손상 오류와 원본 보존

빈 기본 런으로 조용히 전환되는 결과는 허용하지 않는다.

