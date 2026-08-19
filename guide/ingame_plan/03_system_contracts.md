> **2026-08-08 gameplay authority update**
>
> Add `TowerGroupState`, gameplay event routing for Tower death/share, team/target policy, actor
> execution transactions, and Overtime domain owners as described in `../gameplay/`. Existing
> endpoint exactly-once ownership remains locked.

> **2026-08-09 R2 Turn 1 runtime update**
>
> `EnemyCapabilityRegistry` now validates only live capability implementations; the named lifecycle,
> fixed-command, and gameplay-event ports are minimal assertions rather than future empty classes.
> `EnemyCoreImpactDirector`, `RunOutcome`, and the terminal final-commit boundary are connected.

> **2026-08-09 R2 Turn 2 runtime update**
>
> `WaveDirector` now compiles the four-command 60Hz authored timeline and atomically queues each same-tick
> spawn batch. Arrow charge and Diamond selected-target behavior remain GPU-authoritative; Body ABI v6,
> BodyControlProgram v2, and SpawnProgram v4 are the current host/WGSL boundary.

> **2026-08-09 R2 Turn 3 runtime update**
>
> The endpoint now owns one bounded generic `GpuEffectCommandOwner`, while `GameObjectSystem` owns one
> `PentagonEffectDirector` with an exact-handle primitive SoA roster. GPU Effect A/B pools, per-body Summary,
> and PEmitter state are independent from the exclusive basic behavior-program union.

> **2026-08-10 R2 Turn 4 runtime/checkpoint complete**
>
> Arrow gameplay now uses a dedicated exact Tower-target binding and tracked pose is presentation-only.
> Formation authoring uses independent `memberCount + rows/columns`. The endpoint owns one bounded
> `GpuFormationCommandOwner`, `GameObjectSystem` owns one bounded `FormationRuntimeDirector`, and Formation ABI
> v1/state/atomic lifecycle transactions remain independent from `EnemyBehaviorState`. The cumulative checkpoint
> passed 42 changed-file syntax checks, 1245 Node tests, default WebGPU plus five routed hardware stages, both
> WASM checks, the 1,000-case flow-field stress check, audited render golden, and diff hygiene. Turn 9 retains
> repeated stress/churn; optional manual smoke was not run.

> **2026-08-12 R2 Turns 5–8 authored under restricted cadence**
>
> O uses lifecycle-owned fixed-eight orbit leases, J/C′ uses independent Atomic Transform state/director, and
> Ring R uses independent bilateral Projectile Capture state/director plus privileged active-metadata mutation.
> Cork Z uses independent RouteRuntime/availability exact leases over optional immutable routeGraph v1, with a
> bounded host roster and lifecycle cleanup. Their dedicated Node/static/NW fixtures are authored but
> intentionally unexecuted until Turn 9.

> **2026-08-12 R2 Turn 9 integration and final acceptance complete**
>
> J now uses a producer-neutral positive-damage seam, dedicated `jorang` presentation, and
> EffectDefinition-owned non-duplicating distribution. Ring capture requires inbound/closing motion and treats
> completion/release capacity exhaustion as normal whole-batch zero mutation. O future policy and overflow are
> data-owned, the showcase remains injection-only, and the final runner executes default plus nine hardware
> stages. Final cumulative evidence is syntax `38/38`, Node `1402/1402`, and all ten WebGPU routes PASS with
> NW.js `0.108.0`, effective storage maximum 9, exact `uncapturedErrorCount=0`, and destroyed teardown. Direct
> adapter evidence is NVIDIA Lovelace/limit 10 for Full/Arrow/Maximum/Rhom and `10/9/9` adapter/requested/device
> for Ring/Cork. Both WASM checks, flow stress, audited golden, two title GPU smokes, diff hygiene, and three stable single-device/session mixed-churn cycles passed. Manual showcase
> remains `automatedResult:false` because no human interactive visual/pause-resume session was executed.

> **2026-08-16 R3 Enemy Entity Word complete**
>
> `GameSystem` now owns the CPU run-domain `WordSystem`, five Sentence slots, `SentenceSlotController`, and
> `GoldLedger`. `GameObjectSystem` owns GPU-world-scoped `AbilityRuntime`, `ActorPayloadMaterializer`,
> `SentenceRuntimeEstimator`, `BountyRewardDirector`, and `HostileParticipationTracker`. Q executes
> `The Tower shoots Enemies`; E executes `Enemies shoot Enemies`. Subject selection is an aggregate-only GPU
> snapshot and Enemy actor creation is exact 0/N prelease/materialization. Gold requires matching authenticated
> lethal PLAYER evidence plus same-boundary `PLAYER_KILL` lifecycle publication. Recovery preserves CPU words,
> slots/cooldowns, and Gold while canceling transient R3 GPU execution. Tower Payload, Tower Share, Merge,
> Overtime, full Shop/editor UI, and save remain future work.

> **2026-08-18 R4 TowerGroup + Share Ledger complete and stabilized**
>
> `GameSystem` owns canonical CPU-run-domain `TowerGroupState`/`TowerShareLedger`; `TowerCombatRoster` is only
> the legacy primary-Tower compatibility view. Share is exact integer scale `1_000_000_000`. The active endpoint
> owns compact GPU roster/control/summary, atomic technical creation, and source-local target query. Production
> creation member capacity is one data-owned value, 256, separate from body stable-slot capacity and runtime-only
> 1,000-Tower fixtures. Shared preview rejects any non-positive derived current HP before reservation. Creation
> transaction replay is fingerprint-bound and exact; same-ID altered payload is protocol failure. Complete-group
> recovery rebinds every living logical Tower, primary death promotes the lowest living ordinal, and zero Towers
> uses Core camera fallback without default run failure. Tower Payload/actor verbs, Merge, Overtime, Shop, and save
> remain future work.

> **2026-08-19 R5 Turn 1 typed actor contract complete**
>
> Append-only Shoot/Throw/Emit/Summon vocabulary and immutable data-owned action profiles now compile all 16
> Tower/Enemy Subject/verb/Payload plans. Tower Payload binds canonical Tower identity and fixed Player
> allegiance. SHIFT/SPACE are assigned while Q/E and empty PRIMARY/LMB compatibility remain unchanged. The
> preview provider accepts an optional R4 Tower creation-preview port and never claims GPU placement exactness.
> No GPU actor placement, Tower Share transaction, transit, or new materialization owner is part of this turn.

# 03. GameSystem and Subsystem Contracts

## 1. 상속이 아닌 조합

목표 관계:

```text
GameScene extends BaseScene
GameScene owns GameSystem
GameSystem owns five subsystem instances
subsystems implement contracts
```

금지 관계:

```text
GameScene extends GameSystem
ObjectSystem extends GameSystem
UISystem extends GameSystem
entity extends every capability base class
```

JavaScript의 단일 상속과 기존 UI/적 base class를 고려하면 시스템 상속은 재사용을
늘리지 않고 결합만 만든다.

## 2. 공통 subsystem 계약

개념 계약:

```javascript
/**
 * @typedef {object} IGameSubsystem
 * @property {(context: GameInitContext) => void|Promise<void>} init
 * @property {(context: FixedGameContext) => void} [fixedUpdate]
 * @property {(context: FrameGameContext) => void} [update]
 * @property {() => void|Promise<void>} destroy
 */
```

규칙:

- 생성자는 값 할당과 dependency 보관만 한다.
- 다른 subsystem의 `init()`을 생성자에서 호출하지 않는다.
- `fixedUpdate()`는 fixed delta와 tick만 사용한다.
- `update()`는 보간·UI·표현에만 frame delta를 사용한다.
- `destroy()`는 멱등이어야 하며 등록 token, listener, pool lease를 해제한다.
- optional method 존재 여부는 초기 등록 시 한 번 분류하고 hot path에서 매번
  duck typing하지 않는다.

## 3. Dependency Bundle

GameScene은 singleton getter를 하위 시스템에 퍼뜨리지 않고 한 번 조립한다.

```text
GameDependencies
├─ timePort
├─ pausePort
├─ inputActionSource
├─ displayPort
├─ uiHostPort
├─ soundPort
├─ checkpointRepository
├─ contentRegistry
├─ profilerPort
└─ runtimeSettingsView
```

테스트에서는 위 port를 메모리 구현으로 교체한다.

## 4. GameSystem 공개 계약

```text
enter(startRequest) -> Promise<EnterResult>
fixedUpdate(fixedContext) -> void
update(frameContext) -> void
handleCommands(commands) -> CommandResult[]
resize(viewportSnapshot) -> void
getView() -> IGameStateView
requestCheckpoint(reason) -> Promise<CheckpointResult>
destroy() -> Promise<void>
```

`startRequest`:

```text
NewRunRequest
ContinueRunRequest
BenchmarkRequest
HeadlessTestRequest
```

Benchmark는 실제 play GameSystem에 버튼 분기를 섞지 않고 dependency와 초기
콘텐츠를 바꾼 별도 진입 요청 또는 `BenchmarkScene`으로 유지한다.

현재 Phase 5 runtime은 `enter()`에서 `GPU_WORLD` 또는
`CPU_NO_WAVE_FALLBACK`을 한 번 선택해 session 동안 고정한다. GPU recovery는
`GameSystem`을 재생성하지 않는다. `CoreIntegrity`, canonical `TowerGroupState`/`TowerShareLedger`,
input/router, camera/group facade와 global fixed tick을 보존하고 `GameObjectSystem` 내부의 endpoint/registry/
backend/wave GPU world만 교체한다. Committed living Tower logical IDs/ordinals, Share/Lost Share,
current/max HP, Power, primary selection, and recovery descriptors를 보존하고 Maximum Damage Window, Effect/P,
Formation/H/HX, Atomic J/C′, and Projectile Capture R rosters, pools, timers, metadata-mutation authority,
prepared/armed work, readbacks, and presentation summaries are reset. RouteRuntime body/availability state,
Z lease roster, route readbacks, and Wave availability binding reset to all-open too; stale ports are revoked. 같은 device generation에서 replacement tick이
성공하기 전에는 재시작을 반복하지 않는다.

R3의 `WordSystem`, 다섯 slot/cooldown, `SentenceSlotController`, `GoldLedger`도 같은 CPU run domain에 남는다.
반면 old endpoint에 묶인 subject snapshot, actor-payload prelease/materialization, bounty pending proof,
hostile aggregate mirror는 취소/폐기하고 새 `GameObjectSystem` owner에 다시 바인딩한다.

`GPU_WORLD`의 semantic movement/Aim은 하나의 `GpuTowerGroupFacade`가 group command로 보낸다.
primary-pointer/LMB compatibility action은 `GpuPrimaryProjectileController`가 canonical lowest-living-
ordinal Tower exact handle과 같은-tick world aim만 next-fixed source-relative request로 보내고, command
commit 뒤에만 cooldown을 확정한다. CPU Tower position이나 full roster readback은 projectile command
payload가 아니다. 정상 spawn pressure는 shot만 reject/defer하며 같은 tick의 mandatory Tower group
control이나 fixed submit을 거절하지 않는다.

## 5. 5개 하위 시스템

### 5.1 GameObjectSystem

제공:

```text
IWorldQuery
IWorldMutationSink
IEntityFactory
ICollisionQuery
ISpawnBudgetPort
IWorldView
EnemyCapabilityRegistry
IEnemyLifecycleObserver
IEnemyFixedCommandProducer
IEnemyGameplayEventConsumer
IFormationCoordinateSystem
IFormationSlotGraph
IFormationMembership
IFormationMotionPolicy
IFormationAtomicTransform
CorkRouteClosureDirector
```

책임:

- 모든 전투 entity의 ID, component, 풀, 생성·제거
- fixed integration
- PhysicsSystem과 CollisionHandler 소유
- AI/Word가 만든 intent 적용
- 전투 월드 snapshot과 렌더 view 제공

금지:

- Gold·Shop·SentenceBoard 직접 변경
- UI element 생성
- 저장 파일 접근

### 5.2 AISystem

제공:

```text
IAIDecisionService
IPathService
INavigationFieldService
```

책임:

- Core/Path/Lane 기반 목표 선택
- 정책별 decision과 steering intent
- Flow Field/LOS cache
- decision group과 공간 인덱스

금지:

- entity 배열 직접 제거
- Core Integrity 직접 감소
- presentation 상태 접근

### 5.3 LogSystem

제공:

```text
IGameEventSink
IStatisticsView
IDebugEventQuery
```

책임:

- 확정 event의 bounded journal
- damage, ability, word, wave, lane 통계
- 체크포인트용 aggregate snapshot

금지:

- event를 다시 command로 발행해 상태 변경
- 엔티티 객체 참조 장기 보관
- 매 hit 문자열 생성 또는 console 출력

### 5.4 WordSystem

제공:

```text
ISentenceAuthoring
ISentenceCompiler
IAbilityRuntime
IAbilityEstimator
ICompiledAbilityView
```

책임:

- WordDefinition/Instance 참조 검증
- 문장 편집 transaction
- 불변 CompiledAbility 생성·캐시
- subject snapshot, target/action/spawn 계획
- cooldown과 generation/work budget
- 다섯 slot의 원자 loadout/개별 sentence assignment와 bounded presentation view
- semantic activation request를 fixed boundary까지 보존하고 final execution outcome에서만 cooldown 확정

금지:

- raw input polling
- Canvas 텍스트 생성
- CollisionHandler 내부 호출
- raw GPU slot/subject record 또는 per-child 결과 readback

R3 ownership split에서 compiler/slot/cooldown은 `GameSystem`의 CPU `WordSystem`에 남는다. GPU subject
snapshot과 persistent actor materialization은 `GameObjectSystem`의 `AbilityRuntime`과
`ActorPayloadMaterializer`가 endpoint public seam으로 수행한다. `SentenceRuntimeEstimator`는 같은 selector/
capacity/hostile aggregate 공식을 preview에 제공하며 별도 UI 산술을 만들지 않는다.

### 5.5 GameUISystem

제공:

```text
IGameUIPresenter
IPlayerControllable registrations
IGameViewConsumer
```

책임:

- HUD, 상점, 문장 편집, 저장 오류 화면
- global UISystem의 primitive/layout 사용
- view snapshot과 event를 표시 데이터로 변환
- UI action을 semantic command로 변환

금지:

- GameState live 참조 수정
- 파일 I/O
- 전투 시간축으로 UI 애니메이션 진행

## 6. Application service

### WaveDirector

GameState의 wave slice만 변경하며 GameObjectSystem에 spawn intent를 보낸다. Current authored compiler
supports `SPAWN_FOR_DURATION`, `WAIT`, `SPAWN_GROUP`, and `SPAWN_FORMATION` at exact 60Hz with no
randomness. Identity includes wave/timeline/group/member provenance. Every spawn due on one fixed tick is one
atomic `requestSpawnBatch`; rejection leaves the schedule cursor and command identities unchanged for retry.
`LINEAR_GRID` and `PATH_RELATIVE` initial formation offsets plus sequential row delays are live; persistent
`keepFormation=true` is live only for natural H with exact six-ring Formation provenance. Authored Formation
uses `memberCount` separately from explicit or rectangular-layout-derived `rows`/`columns`; legacy `size`,
non-Formation keep requests, and direct transform-private group/HX spawns fail before mutation.

Optional routeGraph content may bind a group to one `routeSetId`. WaveDirector consults only the latest
authenticated Route Availability snapshot and resolves lowest-priority open path deterministically. If every
candidate is closed, the exact compiled command stays in backlog and the cursor does not advance. Legacy
graph-null content retains fixed gate/path binding and all-open behavior.

Once a formation entry begins materialization, its originally selected path is pinned for every unpublished
remaining member. A close preserves the whole remaining entry/group in backlog and publishes no arbitrary
partial row 0; reopen publishes those remaining rows on that same path in one atomic batch. Already published
actors continue to use the general forward-switch reroute/clearance-wait policy.

### HostileAttackDirector

The bounded exact-handle roster currently owns Archer and Diamond M production with one authored global
start budget. Archer keeps its Tower-only source-relative shot. M provides explicit exact Core/Tower handles
to BodyControlProgram v2, consumes completed GPU Core-first inclusive-range selection, and binds the result to
SpawnProgram v4 without CPU pose. No target resumes route movement; selected range keeps movement stopped.
Typed selected-Core damage is authenticated by `EnemyCoreImpactDirector` rather than GPU Core HP. A launched
selected-Tower projectile remains valid after M dies, but its snapshotted one-hit damage enters the same exact
Tower Maximum Damage Window as other hostile Tower damage; direct-HP bypass is forbidden.

### PentagonEffectDirector

The director observes exact lifecycle commits and completed Effect batches, owns only P roster/cadence in
bounded primitive SoA storage, and never owns endpoint submit/draw/destroy. All P sources due at the same
target fixed tick are ordered into one atomic `requestPulseBatch`; zero-target is a completed result that still
advances cadence, while partial acceptance is forbidden. The endpoint materializes exact source metadata once
and its generic owner binds session/tick/source/pulse sequence/fingerprint plus device/epoch replay evidence.
Exact handle-to-slot resolution remains private to the GPU backend.

Authentic whole-batch `CAPACITY_REJECTED` caused only by candidate/instance/event or pulse-grid capacity is a
normal zero-partial completion. It advances protocol watermark but consumes no P sequence/cadence, triggers no
HP/Summary/event mutation, and retries at the completion-observation fixed boundary without pausing the world.
Program capacity, ABI/record/ID exhaustion, or forged/mixed evidence remains recovery.

### FormationRuntimeDirector

The director owns a bounded primitive SoA roster for natural H, composite H groups, and HX, including sorted
original exact-handle lineage 1..6. It never stores one JS object per member. The endpoint-owned generic
`GpuFormationCommandOwner` owns whole-tick prepare/replay/protocol/terminal evidence; public slots are forbidden.
Prepare tick N may produce a privileged lifecycle proposal only at N+1. `EnemyLifecycleCommandOwner` alone
uses the frozen Formation transaction port and an opaque single-use private `WorldRegistry` preflight token to
publish one authentic lifecycle result: destination spawned, both sources despawned. GPU arm/commit and universal
active Effect rekey complete in that fixed submit; a post-publication mismatch is hard recovery with no rollback.

### JorangSplitLineageDirector

The director owns a bounded exact-root/branch roster and pending/due backlog, while the endpoint owns Atomic
Transform prepare/arm/commit/readback authority. Authentic T-1 evidence alone may publish J 1→2 or C′ 1→1 at
T through the lifecycle's generic topology transaction. Actual J-lineage starts are ordered and capped at four
per tick; a pending proof stalls the same T, while an authentic capacity rejection consumes that attempt and
uses fresh next-tick proof without recovery or half child.

The trigger is producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT`. Its common seam is independent of projectile
identity/contact budget and receives source body, damaged target, final positive damage, producer kind,
already-validated producer policy, and expected phase. Projectile is the connected caller after its own exact
policy checks; explosion/Effect/direct/melee remain future callers, not executed behavior. J uses `jorang`, and
each active Effect instance transfers once by its `EffectDefinition`; Penta Boost selects stable instance-ID
modulo destination count.

### RingProjectileCaptureDirector

The director owns only bounded exact-handle held/release/terminal-cleanup roster state. GPU capture completion
must be coherently accepted before generic death/Core events from the same source tick. Capture is registry
zero-mutation; release requests one privileged same-handle metadataRevision CAS after exact T-1 proof and
before backend commit. Unpublished held state is terminal-cleaned, while a lifecycle-published
`commitRequested` release completes GPU submit/readback before seal. Empty non-terminal epoch drift may rebind
only when director/backend pending, active, terminal, failure, and recovery state are all exact zero/idle.

Capture requires inclusive-funnel admission plus strictly closing relative velocity. Capture completion or
release capacity exhaustion rejects the whole batch with no bilateral/metadata mutation and `recovery=false`,
then retries/backoffs later; ABI/identity/fingerprint/bilateral corruption remains recovery. No-Tower release
stays stored-forward with a null target handle and no Core fallback. Logical origin provenance is retained for a future Subject/Sentence
runtime, without claiming current end-to-end Sentence execution.

### CorkRouteClosureDirector

The director owns only a bounded exact-handle mirror of at most eight Z closure leases. GPU RouteRuntime owns
route selection, forward transition, expansion, blocking, waiting, and availability `OPEN/LEASED/CLOSED` state.
The director accepts assignment/close/reopen/cleanup only after graph content, session/device/epoch, source tick,
availability version, fingerprint, exact handle, and lease generation all match. It supplies the immutable
availability snapshot consumed by WaveDirector, but does not rewrite flow fields, SDF, or body pose.

Z remains a hostile Enemy noun via interaction metadata/Team even when its physical role becomes
`ROUTE_BLOCKER`. EXPAND is visible but physically nonblocking; only completion publishes route `CLOSED` and
enables the physical blocker together. The Turn 9 cross-gate covers P-on-blocking-Z, formation backlog,
Arrow/M/O during WAIT, and R/J/H reroute-or-wait without recovery.

Lifecycle publication registers one Z roster entry atomically with spawn and stages exact reopen/cleanup before
despawn reclamation. Terminal success requires fixed/lifecycle observation, zero pending/readback/roster count,
and an all-open snapshot. Replacement is allowed only from the exact idle/all-open boundary and revokes the old
director/runtime binding.

### R3 Ability, reward, and participation owners

`AbilityRuntime`은 `WordSystem`의 fixed activation request를 하나의 typed execution으로 바꾸고 endpoint의
aggregate GPU Subject snapshot만 소비한다. `ActorPayloadMaterializer`는 snapshot identity를 그대로 묶어
exact N prelease와 one lifecycle publication/GPU materialization을 수행한다. true body capacity는 zero-partial
normal rejection이고 cooldown을 쓰지 않는다. event/telemetry backpressure는 같은 snapshot을 보존한 retry이며,
protocol/identity/generation mismatch만 recovery다. GPU가 child generation `source + 1`의 유일한 권위이고 CPU
registry는 authority/provenance metadata만 게시한다.

`BountyRewardDirector`는 exact PLAYER source가 HOSTILE Enemy에 준 authenticated lethal evidence와 같은
boundary의 exact `PLAYER_KILL` lifecycle result를 모두 확인한 뒤 `GoldLedger`에 idempotent transaction을
credit한다. Core impact, ordinary despawn, transform consume, non-Player kill, duplicate, replay, ABA mismatch는
지급하지 않는다. `HostileParticipationTracker`는 live/pending hostile count, sentence-created count, bounty
potential, Siege Weight를 bounded scalar로 게시한다. 이 tracker는 Wave timer/Overtime DOT owner가 아니다.

### R4 TowerGroup, creation, and target-query owners

`TowerGroupState` is the canonical CPU logical authority for living/dead records, stable ordinal, exact GPU
binding, current/max HP, Power, primary selection, group revision, and recovery descriptors.
`TowerShareLedger` owns the exact `1_000_000_000` Share/Lost Share conservation invariant and pure cap-aware
largest-remainder creation plan. `TowerCombatRoster` mirrors only the current primary for legacy Archer/M/LMB
ports and must not own independent HP or Share.

`TowerCreationCoordinator` uses the same preview plan as `TowerGroupState`, preflights the data-owned production
member capacity 256 plus Registry/body/program capacity, and publishes exact 0/N. Any derived
`currentHpFixedPoint <= 0` is `REJECTED_NON_VIABLE_CURRENT_HP / NON_VIABLE_DERIVED_CURRENT_HP` before prelease.
Its canonical transaction fingerprint includes sorted descriptors, child count, and requested fixed tick.
Same-ID/same-fingerprint replay returns the exact existing receipt at queued, pending, completed, or ordinary
rejection stages without new work; same-ID/different-fingerprint is protocol failure. Completed receipt history
is bounded and active work cannot be evicted.

`GpuTowerGroupRuntime` owns a compact exact member roster, one group control command, and a fixed 80-byte lossy
summary; it never reads back full bodies. Its `capacity` is the backend's stable body-slot address range, not the
production member-count policy. `GpuTowerTargetQueryRuntime` writes one 40-byte source-local result per hostile
source entirely from GPU body state plus compact Tower roster/Share. Selection is distance, higher Share, lower
entity ID, then lower incarnation. Arrow, O, and selected-target projectile consumers share that result. Zero
living Towers is a valid no-target state and roster death alone does not invent a revision.

### ShopCoordinator

offer 생성, 가격, transaction, WordSystem 재컴파일 무효화를 조정한다.

### CheckpointCoordinator

현재 GameState와 각 subsystem의 checkpoint contribution을 모아 repository에
커밋한다. 파일 시스템 세부 구현을 알지 않는다.

### CombatResolver

Collision/Ability가 만든 hit intent를 받아 피해와 사망을 확정한다. Core,
Enemy, Tower, 구조물의 대상 규칙을 분리한다. Ordinary contact/projectile and Arrow GPU Tower
피해는 target-side same-tick maximum aggregation과 `TowerMaximumDamageWindow`가 권위이며, Core damage는
`EnemyCoreImpactDirector`가 exact event/provenance를 검증한 뒤 CPU `CoreIntegrity`에 적용한다.
An active larger Tower maximum applies only the peak delta and updates provenance; it never extends the first
accepted tick's fixed `N + 60` expiry. Diamond M의 exact selected-Tower projectile도 launch-time damage
snapshot과 exact target identity는 source death 이후 유지하지만, 피해 적용은 같은 Maximum Damage Window
후보/승자 계약을 통과하며 direct HP path로 우회하지 않는다.

## 7. Command 계약

모든 command envelope:

```text
type
commandId
requestedAtFrame
targetFixedTick
expectedStateRevision optional
payload
```

결과:

```text
ACCEPTED
REJECTED_INVALID_PAYLOAD
REJECTED_WRONG_PHASE
REJECTED_STALE_REVISION
REJECTED_DUPLICATE
REJECTED_NO_SUBJECT
REJECTED_COOLDOWN
REJECTED_CAP
REJECTED_SAVE_PENDING
```

Command는 거절될 수 있다. 거절된 command는 상태와 cooldown을 바꾸지 않는다.
현재 command queue처럼 `type` 문자열 존재만 검사하는 계약은 새 인게임
command에 사용하지 않는다.

## 8. Event 계약

모든 committed event envelope:

```text
eventType
eventId
sequence
fixedTick
runId
mapId
waveId
payload
```

규칙:

- event는 이미 확정된 사실이다.
- sequence는 같은 fixed tick 안에서 단조 증가한다.
- 객체 대신 안정 ID를 담는다.
- 대량 hit는 batch event를 허용하되 원래 결정 순서를 보존한다.
- UI/VFX/Log가 구독하며 전투 권한은 event 구독 순서에 의존하지 않는다.

## 9. fixed-step 실행 순서

현재 mixed GPU World owner의 확정 순서는 다음과 같다. 이 순서는 아래 장기
GameEvent/Combat 구조가 도입된 뒤에도 endpoint exactly-once 경계로 남는다.

```text
completed fixed/SpawnProgram outcomes
→ completed Tower creation outcome authentication and exact CPU ledger commit/reject
→ completed Projectile Capture/release evidence drain and coherent source-tick watermark
→ completed Atomic Transform first-hit/prepare/transform evidence drain
→ completed Effect batch/event drain and whole-envelope authentication
→ completed Formation prepare/transform evidence drain and whole-envelope authentication
→ completed Route Availability assignment/close/reopen/cleanup drain and exact Z lease mirror
→ completed generic gameplay event drain gated by accepted capture watermark
→ raw typed snapshot publication
→ TowerGroupState exact damage/death commit, primary promotion, and compact roster binding
→ exact Core-impact event observation
→ authenticated CORE_IMPACT cleanup stage
→ Core depletion / RunOutcome transition
→ if RUNNING: WaveDirector, initial Tower/Core, one Tower-group control, Arrow/M control, projectile/hostile requests
→ if RUNNING: WordSystem fixed activation drain → aggregate GPU Subject snapshot
→ if RUNNING: ActorPayloadMaterializer exact 0/N prelease and lifecycle request
→ if DEFEATED: close ingress; version-cancel exact reserved/submitted/readback-pending fixed programs
→ if DEFEATED: tombstone destination/control set and retire its leases before terminal tick
→ if DEFEATED: cancel exact Effect programs/readbacks and observe the final P lifecycle removal
→ if DEFEATED: cancel exact Formation prepared/armed/program/readback work and observe final Formation removal
→ if DEFEATED: cancel exact Atomic Transform and Projectile Capture unpublished work, clean unpublished held projectiles, observe final J/R rosters
→ if DEFEATED: close Route Runtime ingress, reopen/cleanup exact Z leases, settle readback, observe all-open roster
→ lifecycle command commit
→ R3 actor-payload GPU materialization commit and aggregate completion
→ fixed command commit / source-control and authenticated Tower-creation program stage
→ if RUNNING: stage/commit one whole-tick Pentagon pulse batch
→ if RUNNING: stage one whole-tick Formation prepare batch; publish only on-time N→N+1 transforms
→ if RUNNING: stage bounded J/C′ prepare; publish authentic T-1→T transforms
→ if RUNNING: publish authentic T-1→T same-projectile metadata CAS/release
→ if RUNNING: Route Runtime select/forward-reroute/clearance-wait/Z expansion
→ finite lifetime clamp
→ Effect A/B expiry, summary, regeneration, and pulse application
→ Projectile Capture inclusive-funnel + strictly-closing preflight/prepared shield
→ raw → source modifiers → defense/status → final damage
→ ordinary contact/projectile and Arrow only: same-Tower/source-tick maximum aggregation
→ Maximum Damage Window winner → Tower HP mutation, including selected-target M launch-snapshot candidates
→ canonical-zero death marking
→ Projectile Capture late whole-batch seal or normal zero-mutation capacity rejection
→ Route Runtime availability + physical blocker close/reopen finalize atomically
→ one GPU fixed submit (published Atomic Transform/Projectile Capture/Route Runtime work may start async completion readback)
→ if DEFEATED: verify fixed + Effect + Formation + Atomic Transform + Projectile Capture + Route Runtime evidence, all-open state, and sealed rosters, then seal or fail closed
→ successful submit 뒤 GameSystem fixed tick 확정
→ variable presentation + bounded Tower-group summary; zero living Towers uses CPU Core fallback
→ TileMap → direct GPU World → CPU Core presentation draw
```

`GameObjectSystem`만 endpoint의 event commit, lifecycle/fixed commit, submit,
presentation, draw, synchronize, destroy를 호출한다. adapter/facade는 request만 한다.
The endpoint orders Tower creation validation/application and compact roster publication atomically, broadcasts
one control command before controlled motion, then computes source-local target-query results for dependent
Arrow/O/selected-target consumers. Every routed compute stage remains at or below nine storage buffers.
CPU fallback은 같은 tick에 GPU gameplay request 없이 기존 Tower fixed integration과
tile resolve를 수행한다. 두 authority를 한 session에서 함께 tick하지 않는다.

Core depletion transitions `RUNNING → FINAL_COMMIT_PENDING → SEALED` (or diagnostic
`SEALED_FAILED`). The final boundary includes the exact impact Enemy cleanup and emits immutable
`RunFailed` once. Closing/finalizing ingress is permanent and revokes raw fixed/lifecycle request paths and any
previously issued privileged cleanup port. The versioned cancel seam must also cover the exact fixed-program
destination/control set already reserved, GPU-submitted, or awaiting readback, tombstone it, and retire every
associated lease before the final tick. Generation-qualified callbacks arriving later are terminal no-ops.

The final fixed submit does not start ordinary frame readback. A lifecycle-published Atomic Transform or
Projectile Capture release is the explicit exception: its required async completion readback must settle.
Transition to `SEALED` requires exact evidence that fixed, Effect, Formation, Atomic Transform, and Projectile
Capture plus Route Runtime owners were armed/cancelled as applicable, the backend submitted that boundary, ABI/final/submitted tick
and armed/submitted counts match, pending programs/readbacks are zero, unpublished held cleanup is complete,
route availability is all-open, and Pentagon/Formation/J/R/Z rosters observed the final lifecycle commit before sealing. No unpublished pulse,
regeneration, Formation transform, J split/C′ return, or projectile release runs on that submit. Cancellation,
submission, or evidence
failure/partial completion transitions to `SEALED_FAILED`; it cannot masquerade as a
successful seal. After `SEALED`, `fixedUpdate()` is a successful gameplay/GPU-mutation-free no-op. Both terminal
states retain presentation, draw, and gameplay status from the last committed snapshot; successful seal does
not advance the completed fixed tick or presentation reference clock, and camera follow remains frozen.

```text
GameSystem.fixedUpdate
├─ fixed tick 증가
├─ target tick Command drain/validate
├─ GameEventStream.beginTick()
├─ phase guard
├─ WaveDirector가 spawn intent 생성
├─ WordSystem이 skill command와 ability intent 처리
├─ GameObjectSystem.fixedUpdate
│  ├─ player/item/projectile begin step
│  ├─ AISystem decision/steering 호출
│  ├─ enemy movement integration
│  ├─ collision frame/contact/solve
│  ├─ projectile hit intent
│  └─ merge/spawn/despawn commit
├─ CombatResolver hit/damage/death 확정
├─ WaveDirector completion 검사
├─ GameState invariant 검사
├─ GameEventStream.commitTick()
└─ LogSystem aggregate 반영
```

The older CPU hexa contact-timer/finalize sequence is historical only. Current H/HX merges use independent
Formation prepare → privileged atomic lifecycle publication → GPU transform/Effect-rekey authority described in
`05_object_and_collision.md`.

## 10. 가변 frame 순서

```text
InputSystem raw state update
→ InputActionMapper
→ PlayerControlRouter
→ semantic command enqueue
→ GameSystem.update
   ├─ object render interpolation
   ├─ GameUISystem view binding
   └─ 표현 event 전달
→ draw command 발행
```

가변 update에서 Core, Gold, cooldown, wave timer를 변경하지 않는다.

## 11. 초기화 실패와 파괴

- 중간 subsystem init 실패 시 이미 초기화된 항목만 역순 destroy한다.
- UI/input registration token은 GameSystem이 별도 목록으로 보관한다.
- pending checkpoint가 있으면 완료 결과를 받은 뒤 scene transition을 확정한다.
- destroy 이후 command는 `REJECTED_WRONG_PHASE`가 아니라
  `REJECTED_SESSION_DESTROYED`로 진단한다.
- destroy는 `WorldRegistry` active count와 event subscriber count가 0인지
  debug build에서 확인한다.
