# 07. Word and Combat Runtime

## 1. WordSystem 목적

WordSystem은 단어 콘텐츠, 문장 편집, 컴파일, 능력 실행을 하나의 공개 facade
뒤에 모으되 내부 책임은 분리한다.

```text
WordSystem
├─ WordCatalogView
├─ SentenceAuthoringService
├─ SentenceCompiler
├─ CompiledAbilityCache
├─ AbilityEstimator
├─ AbilityRuntime
├─ SubjectQueryService
├─ TargetingService
├─ ActionExecutorRegistry
└─ SpawnBudgetService
```

## 2. 데이터 경계

`data/`:

- WordDefinition
- 역할/태그/희귀도/가격
- 레벨별 수치
- action executor ID
- target/subject compatibility
- 현지화 키
- 콘텐츠상 entity cap/lifetime

코드:

- schema validation
- 문장 컴파일 알고리즘
- modifier 적용 순서
- executor 구현
- subject snapshot
- command/generation/work budget
- cache key와 무효화

WordDefinition이 함수나 엔진 객체를 직접 보관하지 않는다.

## 3. 문장 편집

```text
UI edit intent
→ BeginSentenceEdit
→ tentative SentenceDefinition
→ slot/instance compatibility 검증
→ SentenceCompiler
→ AbilityEstimator
→ preview
→ CommitSentenceEdit(expectedRevision)
→ RunState 반영
→ compiled cache 교체
→ checkpoint dirty
```

UI가 WordInstance의 `boundSentenceId`나 Gold를 직접 바꾸지 않는다.

## 4. SentenceCompiler

입력:

```text
SentenceDefinition
WordInstance snapshot
RunWordProgress snapshot
ContentRegistry
FeatureFlags
```

출력:

```text
CompiledAbility
또는 ValidationError[]
```

CompiledAbility:

```text
abilityId
sourceSentenceId
sourceRevision
subjectQueryPlan
actionPlan
payloadPlan
resolvedModifiers
cooldownTicks
targetingSpec
spawnBudgetSpec
combatFormulaSpec
```

컴파일 결과는 불변이며 전투 중 문자열 검색을 하지 않는다.

## 5. 캐시

cache key:

```text
sentenceRevision
wordProgressRevision
runModifierRevision
featureFlagRevision
contentVersion
```

무효화:

- 문장 commit
- 단어 강화
- 관련 런 modifier 변경
- 콘텐츠 migration/hot reload

CompiledAbility는 체크포인트에 저장하지 않고 재개 시 다시 컴파일한다.

## 6. 능력 실행

```text
UseSkillCommand
→ phase/control/cooldown precheck
→ SubjectQueryService snapshot
→ generation/command limit
→ TargetingService
→ ActionExecutor
→ Spawn/Hit/Placement intents
→ GameObjectSystem/CombatResolver
→ committed events
→ cooldown start
```

NoSubject, wrong phase, invalid sentence, cap 전면 거절은 cooldown을 소비하지 않는다.
일부 subject가 실행 중 사라진 partial success는 적어도 하나가 행동했을 때
cooldown을 시작한다.

## 7. Subject Snapshot

```text
executionId
subjectKindId
entityHandles[]
selectionCountBeforeLimit
selectionCountAfterLimit
createdAtTick
```

- 시작 시 entity ID/incarnation 순으로 고정한다.
- 같은 execution에서 생성된 entity는 현재 snapshot에 들어오지 않는다.
- 실행 차례에는 handle validity만 다시 검사한다.
- snapshot 배열은 pooled buffer를 사용하고 execution 종료 뒤 반환한다.

## 8. 안전 상한

기본 구조 상한:

```text
CommandLimit
MaxGeneration
MaxSpawnedEntitiesPerExecution
MaxDamageEventsPerExecution
MaxChainHitsPerExecution
MaxPlayerSpawnsPerFixedTick
PerEntityKindCap
```

재귀 호출 금지:

```text
spawn() 내부에서 ability execute 호출
```

허용:

```text
AbilityRuntime
→ intent queue
→ entity commit
→ 이후 별도 command/execution에서 subject query
```

## 9. ActionExecutorRegistry

예:

```text
ShootExecutor
ThrowExecutor
EmitExecutor
SummonExecutor
ExplodeExecutor
DashExecutor
PlaceExecutor
```

WordDefinition은 `executorId`를 참조한다. registry에 없는 ID는 콘텐츠 로드
오류이며 fallback executor로 조용히 바꾸지 않는다.

동사별 중앙 거대 switch를 만들지 않되 registry 등록은 허용 목록을 사용한다.

## 10. Targeting

지원:

- Tower aim direction
- lane affinity 우선
- Core progress 우선 적
- 구조물/투사체 subject의 자동 타깃
- homing retarget
- placement zone

`Enemy`는 구매 가능한 단어가 아니며 target filter tag로만 사용한다.

## 11. CombatResolver

```text
HitIntent
→ source/target handle 검증
→ team/filter
→ formula
→ mitigation/status
→ applied amount
→ target state mutation
→ DamageApplied
→ death/core destroyed 판정
```

대상:

```text
Enemy Damageable
Player-owned Structure Damageable
Core CoreIntegrity
```

Tower는 대상 목록에 없다. `HealTower`, `DamageTower`, `TowerHealthChanged`
effect/event는 정의하지 않는다.

회복/수리 의미:

- `RepairCore`: Core Integrity 회복 정책
- `RepairStructure`: 구조물 내구도 회복
- Tower 대상 회복: 콘텐츠 validation 오류

## 12. Damage source metadata

모든 damage는 가능한 경우 다음을 유지한다.

```text
sourceEntityId
ownerTowerId
sourceAbilityId
sourceSentenceId
payloadWordId
executionId
generation
laneId
```

이 metadata가 LogSystem의 단어별·문장별 대미지 통계 기준이다.

## 13. cooldown

- simulation fixed tick을 사용한다.
- pause/shop/checkpoint error 동안 진행하지 않는다.
- 체크포인트는 active cooldown을 저장하지 않는다. 웨이브 경계 재개 시 초기화한다.
- UI preview와 runtime은 같은 tick/초 변환 규칙을 사용한다.

## 14. checkpoint contribution

저장:

- Active Dictionary ID
- WordInstance
- RunWordProgress
- SentenceDefinition/Revision/SkillSlot
- 관련 런 modifier ID

저장하지 않음:

- CompiledAbility
- cooldown
- SubjectSnapshot
- 실행 중 intent
- target cache
- pooled scratch

재개 시 콘텐츠 검증 → 문장 검증 → 전 슬롯 재컴파일 순서로 복원한다.

## 15. 테스트 계약

- Tower + Shoot + Fireball이 컴파일·실행된다.
- Fireballs + Throw + Fireball에서 신규 Fireball은 같은 execution에 참여하지 않는다.
- Tower 대상 heal/damage WordDefinition은 로드 단계에서 거절된다.
- 같은 WordInstance를 두 payload slot에 중복 binding할 수 없다.
- generation/cap 결과가 seed나 FPS와 무관하게 결정적이다.
- preview formula와 실제 단일 대상 결과가 같다.
- 저장 round-trip 후 compiled result와 cooldown 초기화 정책이 일치한다.

