> **2026-08-08 gameplay authority update**
>
> Tower is now damageable and may die. Team/target metadata is distinct from physical/interaction
> masks. Multiple Towers and actor payload transactions must remain GPU-authoritative. Read
> `../gameplay/03_tower_health_share_split_merge.md` and `../gameplay/06_gpu_runtime_requirements.md`.

> **2026-08-10 R2 Turn 4 Formation authority/checkpoint complete**
>
> Current H/HX uses independent Formation ABI v1 and privileged atomic lifecycle publication, not the legacy
> CPU hexa contact-timer/finalize prototype. The cumulative behavior and actual-hardware checkpoint passed,
> including the bounded five-merge n1→n6/HX scenario, exact Effect rekey, atomic reject/ABA/replacement, route/
> SDF/overflow, and presentation/storage evidence. Turn 9 subsequently completed the mixed H-inclusive churn gate.

> **2026-08-12 R2 Turn 5 O authority accepted**
>
> Octagon O uses a fixed lifecycle-owned eight-slot `RING_SLOTS` lease and GPU behavior program 3. It follows
> route flow in `SEEK_TOWER`, captures only inside radius 6, then the exact Tower binding drives both orbit and
> one authoritative facing; a separate 8-storage classifier marks front
> contacts before the unchanged 9-storage handler applies integer flat reduction. The compatible open-ring
> fixture and explicit `enemy-octagon-directional-defense` stage passed the routed Turn 9 acceptance. The current
> corridor map cannot place all eight radius-6 slots on walkable/SDF-clear space, so O remains absent from that
> production wave; the injection-only showcase is the accepted compatible content path.

> **2026-08-12 R2 Turn 6 J/C′ authority accepted**
>
> Turn 6 production introduced Body ABI v7. J/C′ uses an independent 48-byte `AtomicTransformState`, PENDING
> shield, atomic J 1→2 and delayed C′ 1→1 T-1→T transactions. Turn 9 generalized the trigger to
> producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT`; projectile remains the connected producer after its own
> exact policy validation. The selected J stage, full Node suite, and final mixed incarnation churn passed.

> **2026-08-12 R2 Turn 7 R authority accepted**
>
> Current production is Body ABI v8. Ring R and capturable projectiles use an independent bilateral 48-byte
> `ProjectileCaptureState`, 16-byte candidate plane, coherent capture/event completion, and same-identity
> active-metadata allegiance transfer. The explicitly selected Ring stage and final cumulative runner passed
> with zero uncaptured errors and orderly destroyed teardown. No-Tower stored-forward keeps a null target and
> never infers Core; retained origin provenance is future Subject/Sentence preparation, not end-to-end execution.

> **2026-08-12 R2 Turn 8 Z/Route Runtime authority accepted**
>
> Cork Z uses one common-C circle body, helper count 0, and independent RouteRuntime ABI v1 over optional
> immutable routeGraph v1. GPU availability owns exact closure leases and forward reroute/wait behavior; a
> radius-3 blocker collides with Enemy/Tower but not projectiles. The dedicated
> `enemy-cork-route-closure` stage passed P-on-blocking-Z, atomic close, pinned formation backlog, WAIT/reroute,
> exact cleanup, capacity 8, and storage maximum 9 acceptance.

> **2026-08-12 R2 Turn 9 integration and cumulative acceptance complete**
>
> J producer-neutral admission/`jorang`/EffectDefinition distribution, inbound Ring capture and normal capacity
> rejection, O future/overflow contracts, injection-only showcase, Cork/Formation cross fixtures, and the final
> default-plus-nine-stage runner are accepted. Final results are syntax `38/38`, Node `1402/1402`, and all ten
> actual WebGPU routes PASS with NW.js `0.108.0`, effective storage maximum 9, exact
> `uncapturedErrorCount=0`, and destroyed teardown. Full/Arrow/Maximum/Rhom directly identify NVIDIA
> Lovelace/adapter limit 10; Ring/Cork directly report adapter/requested/device `10/9/9`. Both WASM checks,
> flow stress, audited golden, two title GPU smokes, diff hygiene, and 3/3 single-device/session mixed churn passed.

# 05. Object and Collision System

## 1. 책임

GameObjectSystem은 인게임 월드에 존재하는 모든 entity의 유일한 생명주기
권한이다.

```text
GameObjectSystem
├─ WorldRegistry
├─ TileMap / WorldCamera2D
├─ EntityIdAllocator
├─ CapabilityIndexes
├─ EntityFactoryRegistry
├─ PoolManager
├─ Spawn/DespawnCommandBuffer
├─ RenderViewBuilder
└─ PhysicsSystem
   └─ CollisionHandler
      ├─ TileMapCollisionResolver
      ├─ body builders
      ├─ broad-phase SoA/grid
      ├─ narrow phase/manifold
      ├─ position solver
      ├─ projectile sweep
      └─ WASM contact backend
```

## 2. Entity 모델

상속 트리보다 component/capability를 사용한다.

공통 identity:

```text
entityId
incarnation
kindId
active
createdAtTick
```

`incarnation`은 풀 재사용 뒤 오래된 handle이 새 entity를 가리키는 문제를 막는다.

현재 mixed-body `WorldRegistry`는 최종 capability index의 선행 구현이다. GPU mode의
Tower, Core proxy, enemy, projectile과 benchmark proxy를 등록하며 다음 계약을 이미 지킨다.

- backend 수락 전 `reserveEntity()` handle은 활성 query에 보이지 않는다.
- 수락 뒤에만 `activateReserved()`하고, 거부 시 `cancelReservation()`한다.
- 제거된 ID를 재사용할 때 incarnation을 증가시켜 stale handle을 거부한다.
- registry는 kind/content/path metadata만 소유한다. GPU 위치·속도·flow stage는
  fixed tick 사이 GPU 권위이며 frame readback으로 복제하지 않는다.
- R2 Enemy metadata includes immutable physics/combat/behavior profile IDs, stable capabilityMask,
  and spawn-resolved numeric stats. `enemy-contact-combat` and `enemy-core-impact` are mandatory for
  current production definitions; actual systems register through `EnemyCapabilityRegistry` without
  allocating one JavaScript controller per body.
- Body ABI v8 keeps the established primary strides, 40-byte `CombatState`, and 80-byte
  `EnemyBehaviorState` side-plane. It adds an independent 48-byte persistent `AtomicTransformState` and
  16-byte tick-local first-hit candidate plane for J/C′ plus an independent 48-byte bilateral
  `ProjectileCaptureState` and 16-byte capture candidate plane for R/projectiles without consuming either
  existing state domain.
- Turn 3 adds stable `enemy-effect-emitter` only to P. Registry metadata carries primitive emitter/effect IDs,
  codes, target/channel flags, and retarget cadence; GPU Effect A/B instance pools, per-body Summary, and
  PEmitter state are independent planes and never extend `EnemyBehaviorState`.
- Turn 4 adds H/group `enemy-formation + enemy-atomic-transform` and HX `enemy-formation`. Registry metadata
  carries primitive Formation definition/coordinate/policy/member/mask/rotation/generation/lineage-hash facts,
  while the bounded host SoA alone preserves sorted original exact lineage handles. Formation state never
  extends `EnemyBehaviorState`.
- Turn 5 adds O's paired `enemy-orbit + enemy-directional-defense`. The lifecycle owner assigns a persistent
  primitive slot/capacity/coordinate lease from `[0,4,2,6,1,5,3,7]`; it does not own Tower pose or create a
  per-O group. GPU program 3 reuses the existing 80-byte behavior union, while `CombatState` reserved words,
  the behavior stride, and the global storage maximum 9 remain unchanged.
- Turn 6/9 adds natural compatibility identity `basic_gen_01` J rendered as dedicated `jorang`, and
  transform-private `basic_circle_prime_01` C′ with a
  profile-discriminated `enemy-atomic-transform` implementation distinct from H Formation. Registry metadata
  carries exact profile ID, root entity/incarnation pair, transaction-local branch `0/1`, uint32 bounty,
  transform tick, program, and phase. Raw J activation is materialized only after lifecycle reservation;
  forged/partial/ABA state fails before backend publication. C′ never enters authored/public spawn ingress.
- `WorldRegistry` atomic transform authority, generation, and plan state are private. Only the lifecycle-owned
  frozen transaction port can preflight/commit/cancel with an opaque generation-bound token; a token is consumed
  on its first commit attempt and raw/forged/replayed callers cannot mutate registry state.
- Turn 7 adds natural `basic_ring_01` R with `enemy-projectile-capture`. Capture changes GPU bilateral state and
  host roster only; release uses a separate private active-metadata mutation authority. Its opaque one-shot token
  binds exact record/metadata identity, handle, metadataRevision, immutable origin provenance, next current
  Team/owner/source/target-policy snapshot, and backend proof. The projectile keeps the same slot/entity/
  incarnation; release is never modeled as despawn plus spawn.
- Turn 8 adds natural `basic_cork_01` Z with `enemy-route-closure`. Registry metadata carries the exact route-set/
  graph content/version/profile primitives; independent 64-byte RouteRuntime body state and GPU availability
  records own current path, closure, expansion phase, and `(entityId, incarnation, leaseGeneration)` authority.
  Z has one body and no helper-body roster.
- CPU fallback/legacy entity까지 포함하는 전체 capability index 이관은 후속이다.

권장 component:

```text
Transform
Motion
Collider
Renderable
Team
EnemyState
PathFollower
CoreIntegrity
TowerControl
Damageable
Projectile
Structure
Lifetime
PlayerOwned
SubjectEligibility
Generation
LaneAffinity
```

Tower에는 GPU-authoritative `Damageable`/Health를 추가한다. CPU run domain은 Tower share/Lost Share를 소유한다. Core는 일반 Health가 아니라
명시적 `CoreIntegrity`를 사용한다.

### 2.1 PhysicsBody와 Collider 계약 분리

물리 운동과 충돌 형상은 하나의 거대한 인터페이스나 상속 계층으로 합치지 않는다.

```text
Entity
├─ IPhysicsBody2D
│  ├─ position / previousPosition / velocity
│  ├─ mass / inverseMass
│  ├─ acceleration / force accumulator
│  ├─ applyImpulse
│  ├─ applyPositionCorrection
│  └─ fixed integration / linear friction
└─ ICollidable                    future
   ├─ shape / bounds
   ├─ collision layer / mask
   ├─ contact material
   └─ getPhysicsBody() optional
```

분리 원칙:

- Collider는 질량과 속도를 복제하지 않고 동적 대상일 때 같은
  `IPhysicsBody2D`를 참조한다.
- PhysicsBody는 원·사각형 같은 충돌 형상이나 damage 규칙을 알지 않는다.
- CollisionHandler는 반환된 위치·속도 객체를 직접 변경하지 않고
  `applyImpulse()`와 `applyPositionCorrection()`을 사용한다.
- 스킬 반동도 `applyImpulse()`를 사용하여 충돌 반응과 동일한 운동량 경로에
  합성한다.
- `linearFriction`은 월드 이동 감쇠이고, 향후 Collider의 접촉면 friction은
  별도 material 값으로 둔다.

현재 CPU fallback 최소 구현:

```text
module/ingame/contract/physics_body_contract.js
module/ingame/physics/physics_body_2d.js
TheTower.getPhysicsBody()
GameObjectSystem.getPhysicsBodies()
module/ingame/contract/collidable_contract.js
module/ingame/physics/circle_collider_2d.js
GameObjectSystem.getCollidables()
```

`PhysicsBody2D`는 fixed delta 기반 지수 감쇠를 사용한다. 키 해제는 속도를
직접 0으로 바꾸지 않으며 sleep 임계값 아래까지 마찰로 감속한 뒤 정지한다.
`GPU_WORLD`의 Tower facade는 이 인터페이스를 구현하지 않고 exact-handle control
command만 보낸다. authoritative 위치/속도/충돌은 GPU body plane에만 있다.

### 2.2 해상도 독립 타일 월드와 projection 계약

- 한 실제 타일은 1 월드 단위이며 Tower 지름은 1타일이다. Tower/Core 크기와
  이동 수치는 `_TILES` 단위의 data가 유일한 권한이다.
- 물리·AI·저장 좌표는 렌더 픽셀을 사용하지 않고 viewport resize로
  확대·축소하지 않는다.
- authored route의 한 매크로 셀은 `pathWidthTiles × pathWidthTiles` 실제
  타일 블록으로 확장한다. 첫 맵의 모든 길 폭은 6타일이다.
- 짝수 폭 매크로 셀의 waypoint는 블록의 기하학적 중앙에 두고, Flow Field
  대표 tile은 중앙 경계의 아래·오른쪽 셀을 결정적으로 선택한다.
- `TileMap`이 소유하는 `blocked: Uint8Array`가 플레이어 정적 충돌과
  JS/WASM Flow Field의 공통 지형 권한이다.
- CPU fallback의 `TileMapCollisionResolver`는 원형 collider 주변 타일만 조회하고,
  `IPhysicsBody2D.applyPositionCorrection()`과 `setVelocity()`로 침투와
  벽 안쪽 속도를 해소한다.
- GPU mode의 Tower는 같은 `blocked` authority에서 만든 SDF/world-boundary solver를 사용한다.
- 맵 전체를 매 fixed tick 훑거나 타일마다 entity 객체를 만들지 않는다.
- `IWorldViewProjection2D`가 simulation과 renderer 사이 좌표 경계다.
  `WorldCamera2D`는 실제 표시 `WW × WH`의 전체 맵 contain 배율에 기본
  zoom `0.7`을 곱한다.
- 카메라 제어 권한은 별도 `ICameraControl2D`, 추종 대상은
  `ICameraFollowTarget2D`로 분리한다. CPU fallback Tower는 `renderPosition`, GPU facade는
  exact generation/identity의 bounded observed pose만 추종 좌표로 제공한다.
- zoom이 `0.7`보다 크면 Tower를 viewport 중앙에서 추종한다. 맵 경계에서도
  offset을 clamp하지 않아 월드 밖 배경을 표시한다.
- resize는 projection revision만 변경하며 맵, Core, Tower 좌표를
  재생성하지 않는다.
- `TileMapRenderer`는 정적 타일의 viewport 중심과 크기를 최초 draw 또는
  projection revision 변경 때 계산한다. 확대 추종 중에는 Tower 이동도
  revision을 바꾸므로 대량 맵 단계에서는 같은 계약을 GPU view-projection
  uniform으로 이관할 수 있다.

## 3. Capability index

WorldRegistry는 등록 시 capability별 dense index를 만든다.

```text
fixedUpdatables
renderablesByLayer
collidables
damageables
hostiles
projectiles
subjectEligibleByKind
pathFollowersByLane
```

외부에는 배열을 반환하지 않고 다음 port를 제공한다.

```text
queryById(handle)
forEachHostile(callback, scratch)
copySubjectIdsInto(kindId, out)
getActiveCount(kindId)
getCoreHandle()
getTowerHandle()
```

hot path 내부 배열은 live여도 되지만 호출자에게 길이·순서 변경 권한을 주지 않는다.

## 4. 생성과 제거

모든 생성은 `SpawnIntent`를 통과한다.

```text
sourceEntityId
sourceAbilityId
executionId
kindId
generation
position/rotation
laneAffinity
resolvedStats
```

Enemy `resolvedStats` is compiled once before reservation:

```text
base
× map global
× map per-definition
× wave global
× wave per-definition
→ absolute override (same low-to-high precedence)
→ one final validation/f32 quantization
```

Intermediate rounding and post-spawn re-resolution are forbidden. Runtime buffs/debuffs belong to the
Effect system rather than rewriting the immutable spawn snapshot.

For damage, the immutable spawn snapshot remains the base authority. A contact handler recomputes its current
Tower-channel damage from the authored/resolved base plus current Effect Summary each tick. A projectile takes
one resolved damage snapshot at spawn and never rereads or compounds a later modified value. Tower contact and
Tower projectile flags may opt into the P attack multiplier; direct Core impact and typed projectile Core
damage are explicitly unmodified.

순서:

1. payload schema 검증
2. generation과 execution budget 검증
3. kind별 entity cap 정책
4. pool acquire
5. 모든 component 완전 초기화
6. WorldRegistry 등록
7. `EntitySpawned` event

제거는 fixed iteration 중 배열을 직접 splice하지 않고 buffer에 넣어 phase
끝에서 stable ordering으로 commit한다.

현재 mixed GPU World는 `EnemyLifecycleCommandOwner`가 제안 fixed tick 시작점에서 due
command snapshot을 `despawn/RouteRuntime reopen-cleanup → H atomic → J atomic → projectile release → spawn/route-roster assignment` 순으로 commit한다. `spawnBodies()`와
`despawnBodies()`는 이 owner 내부의 저수준 port이며 variable update/draw에서
직접 호출하지 않는다. 일시 unavailable은 command를 보존해 같은 tick에
재시도하며, backend `requiresRecovery()` gate에서 retryable한 상태는 telemetry
`gpu-backpressure`뿐이다. `unsupported/destroyed` platform과 GPU port 부재는 GPU wave,
pending command 또는 active body가 실제 GPU를 요구할 때 terminal hard
recovery로 승격한다. unsupported enter의 CPU no-wave fallback은 GPU gameplay request를
만들지 않는다. capacity·protocol·upload fault도 hard recovery다.

GPU collision protocol의 relevant named mask는 `ENEMY=1`, `TERRAIN=128`,
`CORE_PROXY=256`이다. Core proxy bit는 interaction metadata에서만 사용한다. legacy
CPU `COLLISION_LAYERS`의 숫자를 GPU body에 재사용하지 않는다.

Phase 5 production primary fire는 semantic pointer/LMB를 `GpuPrimaryProjectileController`가
받아 exact Tower GPU handle과 world aim point로 source-relative Basic Bullet을 요청한다.
source resolve는 같은 fixed submit의 Tower control보다 먼저 tick-start GPU pose를 읽고,
tracked/CPU pose를 사용하지 않는다. `GpuFixedCommandOwner`와 backend는 mandatory control과
normal source-spawn pressure를 별도 domain으로 commit한다. body/program/result-ring/registry
pressure는 projectile batch만 zero-partial reject하고 Tower control과 fixed tick을 계속한다.

GPU body lifetime은 host에서 `-1` immortal 또는 `>=0` finite만 허용한다. prepare에서
finite 값을 `max(previous - fixedDt, 0)`으로 clamp한 뒤 contact/damage를 처리하고,
`mark_dead`가 canonical zero와 health reason을 합쳐 ALIVE clear/death event를 한 번만 낸다.
exact death readback은 기존 next-fixed registry/slot cleanup을 그대로 사용한다.

H/HX transform is not a public spawn path. Natural `basic_hexa_01` enters through ordinary lifecycle spawn,
then each on-time GPU prepare proposal (N→N+1 only) crosses privileged lifecycle ingress. Complete preflight
authenticates two exact active sources, their Formation facts/lineages/current/max centi-HP, one deterministic
root destination handle, private transform definition/stats, backend arm evidence, and registry token before one
atomic result is published as `{spawned:[destination], despawned:[sourceA,sourceB]}`. There is no second synthetic
lifecycle result. Ordinary death/Core cleanup wins before publication; backend failure after publication is
hard recovery without rollback.

Turn 2 fixed primitives are BodyControlProgram v2 (96-byte record, 64-byte result state) and SpawnProgram
v4 (96-byte record). Diamond M stages explicit exact Core/Tower handles; GPU tick-start inclusive-range
selection chooses Core first, then Tower, or none, and persists stop/resume state. Its selected-target spawn
must match the same source/tick/selection fingerprint and preflight the whole destination/metadata batch before
activation. This low-rate program is not the future general GPU child allocator.

## 5. Pool 계약

재사용 시 반드시 초기화:

- entity ID/incarnation
- source/owner/execution IDs
- generation과 lane affinity
- transform 이전/현재/렌더 좌표
- velocity와 collision sleep
- hit history와 target set
- lifetime/cooldown/status
- event/listener token
- AI state/cache reference

풀 부족 정책은 kind definition에 둔다.

The Effect instance pool is bounded and double-buffered A/B. One fixed tick reads one pool and writes the
other, then swaps only after a complete successful pass. Expiry is half-open
(`appliedTick <= T < expiresAtTick`), each instance keeps exact source/target identity and its own timer, and a
whole-tick pulse batch either fits completely or mutates nothing. Per-body summaries and PEmitter records are
reset with identity/epoch just like pooled bodies; no per-effect or per-P object is allocated.

Formation transform universally rekeys every target-tick half-open active Effect instance from either source to
the one destination in place. Each instance keeps ID/incarnation/source/applied/expiry/payload independently;
there is no aggregate, refresh, new allocation, or silent drop. Prepared and actual rekey counts must match the
authenticated transform completion or the world enters recovery.

```text
RejectNew
ReplaceOldest
ReplaceLowestGeneration
```

결과를 `SpawnSuppressed` 또는 `EntityReplaced` event로 기록한다.

## 6. CollisionHandler 경계

CollisionHandler는 기하와 위치 해소를 소유한다.

소유:

- collision body 작성
- broad phase 후보
- exact contact/manifold
- 위치 보정과 충돌 sleep
- projectile sweep의 접촉 시점/대상 판정

소유하지 않음:

- 최종 damage formula
- Gold drop
- Word effect
- Wave 완료
- UI/VFX

projectile 충돌 결과는 `HitIntent`로 CombatResolver에 전달한다.

Ordinary GPU Tower contact/projectile damage, including Arrow, uses the locked target-side order:

```text
raw → source modifier → armor/resistance/directional/status → final damage
→ same-Tower/source-tick maximum → Tower Maximum Damage Window → HP mutation
```

Maximum selection is independent of append order. Equal final damage chooses source entityId then
incarnation ascending. A valid projectile contact consumes penetration/self-hit even when the window
applies zero HP; friendly/stale/invalid/miss/capture/reflect rejection consumes nothing. A larger value inside
an active window applies only the peak delta and never extends the first accepted tick's `N + 60` expiry.

Diamond M's exact selected-Tower projectile is the explicit exception. It reserves its one-hit projectile
budget, applies the immutable launch-time damage snapshot directly to that selected Tower even if M has since
died, and emits `maximumDamageWindow=false`; it never enters same-tick maximum aggregation or the continuous
Tower Maximum Damage Window.

동적 접촉 해소 순서:

```text
contact manifold
→ 두 바디 inverseMass 조회
→ 법선 impulse 계산
→ IPhysicsBody2D.applyImpulse
→ 침투 깊이 위치 보정 계산
→ IPhysicsBody2D.applyPositionCorrection
```

```text
projectileHandle
targetHandle
contactPoint
contactNormal
timeOfImpact
sourceAbilityId
executionId
```

기존 코드가 직접 enemy hit count나 active 상태를 바꾸는 경로는 adapter 단계에서
event를 함께 기록하고, 최종 cutover에서 CombatResolver 권한으로 이동한다.

## 7. O directional contact boundary

O's ordinary circle collider participates in the same grid and inverse-mass solver as every mixed body.
After body/world contacts are generated, `classify_directional_defense_contacts` authenticates the target's
captured `ORBIT_TOWER` state/exact Tower binding and compares the contact origin with the same behavior-facing
value used by render. A pre-capture `SEEK_TOWER` body has no armor rim or reduction marker. Only the inclusive
front 3/8 sector receives a tick-local marker containing the centi-int reduction.

The handler order is fixed:

```text
positive raw/source damage
→ exact target layer and team policy
→ projectile/self-hit budget reservation
→ integer flat reduction
→ zero clamp, target resolution, typed event
```

A valid fully absorbed hit consumes budget and reports value `0` with the directional flag; it can therefore
physically shield a body behind O without granting free penetration. Friendly, stale, invalid, and rear/side
contacts do not gain that reduction. O weight `2.5` and Tower weight `10` remain the only push authority.

## 8. H/HX Formation transform boundary

The legacy CPU `prepared hexa contact → contact timer → post-projectile finalize` sequence is no longer current
H/HX authority. Formation uses tick-start GPU bounded-grid/route/SDF state, produces an immutable prepare result,
and leaves all sources unchanged until the next exact CPU publication boundary.

Each transform consumes two live individual/group bodies and creates one body: n2..5
`basic_hexa_group_01`, n6 `basic_hexa_hive_01`. Natural/direct spawn is allowed only for n1
`basic_hexa_01`; all use shape `hexa`. Current/max signed-int32 centi-HP each become
`sum + trunc(sum / 10)` with full overflow/alive/current≤max preflight. H/HX stats are absolute n-table values
from n1, map/wave modification is rejected, only Tower contact scales, Core impact remains 1, and bounty budget
is `[1,2,4,6,8,10]`. Merge-consumed sources grant no bounty.

The destination keeps the deterministic root source's GPU motion slot privately and one composite transform,
HP, stats, and render identity. The host Formation roster atomically replaces both source groups with the sorted
union of their exact original handles; `formationLineageHash` is correlation only.

## 9. J/C′ Atomic Transform boundary

J first-hit arbitration uses producer-neutral `FIRST_VALID_POSITIVE_DAMAGE_HIT` before ordinary contact
handling. The common one-shot seam accepts source body, damaged target, final positive damage, producer kind,
already-validated producer hit policy, and expected phase; it has no projectile-identity/contact-budget ABI
dependency. Projectile is the connected producer and calls it after exact live identity, `CLOSEST_ONLY`, team/
target, final-positive-damage, and reservable self-hit-budget checks. Explosion, Effect, direct, and melee may
call the same seam after their own validation but are future, not executed, producers. One winner enters
`SPLIT_PENDING`; further same-valid hits add no damage/source budget/event and invalid contacts cannot forge it.

The lifecycle transaction is generic topology `ONE_TO_MANY` or `ONE_TO_ONE_DELAYED`, but J/C′ profile
combinations remain exact and fail-closed. A J split consumes one exact source and publishes exactly two
transform-private C′ destinations. Both copy the source GPU pose, velocity, and flow; both start fresh full
HP `1/1`. Uint32 bounty divides child0-ceil/child1-floor and accepts zero. Every exact active Effect instance
rekeys exactly once according to its `EffectDefinition.atomicTransformTransferPolicy`; Penta Boost uses stable
instance ID modulo destination count. The legacy destination word remains reserved zero rather than child
selection. Both children retain the natural exact root `(entityId, incarnation)` pair and use a
transaction-local `branchIndex` of `0/1`.

Each C′ is due exactly 60 fixed ticks after its publication. Authentic compact GPU prepare evidence from
`T-1` may publish one returned J only at `T`, preserving exact pose/velocity/flow, current/max HP, Effect
instances, branch bounty, root pair, and local branch index. Each source is independent, so death/Core cleanup
before publication yields one or zero survivors naturally; Core impact grants no bounty or return.

GPU admission and host start capacity are separate. `JorangSplitLineageDirector` keeps a bounded marker/due
backlog and sorts C′ return first, then due tick, root pair, and source exact handle ascending. Actual J-lineage
starts are capped at four per fixed tick; H Formation retains its separate seam. A normal capacity rejection
keeps the exact source PENDING and logical backlog, publishes no half child, reports no recovery, and consumes
the failed attempt identity before requesting a fresh authentic proof/command next tick. All source,
destination, trigger, and lineage identities are incarnation- and generation-qualified against ABA/replay.

## 9.1 R Projectile Capture and metadata-transfer boundary

R capture arbitration runs before ordinary contact handling and uses deterministic distance/entity tie-breaks.
A candidate must be an exact live PLAYER projectile with capturable policy, enter the inclusive ±45° funnel,
have strictly closing relative velocity, and match one exact live R slot. Inside-cone outbound overlap is
rejected. Whole-batch capacity/protocol preflight precedes bilateral mutation. Capture-completion/release
capacity exhaustion is a normal zero-mutation rejection (`recovery=false`), with no bilateral or metadata
mutation and later retry/data-owned backoff; ABI/identity/fingerprint/bilateral corruption remains recovery. A
transient prepared-shield blocks generic damage between preflight and seal, including rejection. The same
projectile slot/entity/incarnation enters HELD with reciprocal peer slot/entity/incarnation/phase/sequence/
generation; the Simulation `PROJECTILE_CAPTURED` bit is an exact mirror only. Partial bilateral success is
forbidden.

Held projectiles retain immutable origin archetype/tag/modifier/execution/generation and origin owner/source/
target handles. Authored lifetime continues, but movement, grid insertion, ordinary contacts, solver,
source-control, and rendering are skipped. Every spawn/despawn/slot-reuse copy uploads and resets both the
48-byte state and 16-byte candidate plane; a canonical tombstone is role NONE with identity `(INVALID, 0)`.

After 60 ticks, R death, or R Core impact, a T-1 authenticated release proof may enter the lifecycle metadata
transaction. Backend arm precedes registry publication; exact metadataRevision CAS changes only current Team,
owner/source, target policy, and release fields, then backend commit mutates the same GPU body. Team becomes
HOSTILE, target policy becomes player-damageable-and-terrain, speed magnitude is preserved, and aim is exact
living Tower or stored forward—never Core. Exit position clears both radii by 1/1024 tile. Projectile expiry
wins and clears the slot without release.

No-Tower stored-forward release carries a null target handle; `PLAYER_DAMAGEABLE_AND_TERRAIN` must not be used
to infer or add Core. Logical projectile/origin provenance remains exact across capture/release so a future GPU
Subject/Sentence runtime can continue Fireball relationships. Current Turn 9 does not execute that end-to-end
Sentence path.

Capture and generic event streams publish through one coherent source-tick watermark so death/Core cleanup
cannot overtake capture evidence. Per exact projectile, tombstone/despawn > authenticated release > held
capture; contradictory duplicates are protocol failure. Terminal cleanup removes unpublished held state and
cancels unpublished release work, while lifecycle-published `commitRequested` release completes GPU commit and
async readback before seal.

## 9.2 Z Route Runtime and physical-blocker boundary

Optional routeGraph v1 is normalized from authored route sets, shared forward switches, clearance/closure
nodes, and merge nodes, then compiled into immutable indices referencing the established Flow Field atlas.
Graph-null maps remain disabled/all-open. Route availability never rewrites `TileMap.blocked`, the terrain SDF,
flow directions, authored goals, or next-stage links.

Natural `basic_cork_01` uses common-C stats and one ordinary circle body. GPU RouteRuntime assigns one open
closure under an exact `(entityId, incarnation, leaseGeneration)`, moves the body to its entrance, anchors it,
and visibly expands its radius for 60 ticks to 3 while physically nonblocking. Expansion completion changes
availability from LEASED to CLOSED and enables one physical `ROUTE_BLOCKER` in the same boundary; helper-body
count remains zero. Interaction metadata plus hostile Team keep BLOCKING Z a hostile Enemy noun—physical
`bodyLayer` is not Effect target authority. A duplicate Z waits instead of sharing a
lease, and the host exact roster is capped at eight actors.

The blocker pair mask includes Enemy and Player Tower bodies but excludes projectiles. Thus projectile sweep/
contact is not stopped by the expanded radius; the projectile may still target and damage the Z body through
ordinary interaction policy, consumes its normal self-hit/penetration budget, and continues when penetration
remains. No special projectile refund or new damage channel exists.

On availability change, an upstream actor switches only at its next authored forward switch. One past the
switch advances to the closure clearance field, disables flow, and waits without reverse while independent
attack/Effect/Formation state remains live. Exact Z death/despawn reopens the owned route before cleanup and slot
reclamation; ABA/replay/owner mismatch fails closed. Terminal final submit and replacement require all closures
open, zero Z roster/readback/cleanup counts, and stale route authority revoked.

For a formation command mid-spawn, the original selected route stays pinned only for the unpublished remaining
entry/group. Closure backlogs all remaining members and publishes no partial row 0; reopen publishes the
remaining group/rows on that same path in one batch. Already published actors retain general forward-switch
reroute/clearance-wait behavior. Any future remaining-formation reroute must move the whole remaining formation
atomically.

## 10. WASM 충돌 커널 보존

보존 대상:

- prepared hexa contact의 candidate 순서
- JS detector와 byte/boolean parity
- WAT → bytes deterministic build
- capability/초기화/실행 실패 시 영구 JS fallback
- Float32 part 입력을 기존 순서로 f64 연산하는 계약

재사용 방식:

```text
new WorldRegistry/Collider components
→ CollisionBodyAdapter
→ 기존 canonical SoA plane
→ 기존 JS/WASM backend
→ contact flags
→ 새 Hit/ContactIntent
```

WASM 코드가 새 entity 객체나 GameState를 직접 알게 하지 않는다.

## 11. Tower 충돌

Tower collision의 장기 허용 범위는 다음과 같다.

- 월드 경계·정적 장애물과 위치 해소
- 적과 weight 기반 겹침 해소
- 콘텐츠가 허용한 knockback/stun intent
- Tower 스킬 공격의 반대 방향 recoil impulse

Tower baseline weight is data-owned `10`; Enemy inverse mass is derived once from resolved weight.
Tower↔Enemy physical masks and `PLAYER_DAMAGEABLE` interaction masks remain separate so one pair can both
solve displacement and submit continuous contact damage. The Tower is GPU-authoritative HP and may emit
typed damage/death events; collision code still must not own pause/defeat transition or force an Enemy to
wait permanently for Tower death.

The Tower's internal `TowerMaximumDamageWindow` is not invulnerability. First accepted tick `N` stores
`expiresAtFixedTick = N + 60`; candidate `T < expiresAtFixedTick` is active and `T >=` is expired. During
an active window, values at/below peak apply zero without rearming; a larger value applies only its delta
above peak, updates winning provenance, and leaves the original `N + 60` expiry unchanged.
`DAMAGE_APPLIED.value` is the actual HP decrement.

## 12. Core 충돌

현재 Core는 CPU `CoreIntegrity`/presentation facade와 invisible GPU interaction proxy로
분리된다. Proxy는 `inverseMass=0`, physical mask 0이고 Enemy와 mutual interaction acceptance를
가진 enter-only subject이며 movable pair budget에 들어가지 않는다.

`EnemyCoreImpactDirector`는 exact `(entityId, incarnation)` event와 spawn-resolved
`coreImpactDamage`/`enemy-core-impact` capability를 검증하고, Core Integrity를 감소시킨 뒤 같은
Enemy의 authenticated exact despawn을 `CORE_IMPACT` disposition으로 stage한다. 이 disposition은
Gold/bounty를 forfeiture하며, stale/forged/duplicate events cannot mutate Core or steal cleanup identity.

Diamond M's Core-selected projectile reaches the same CPU domain through a separate typed damage request.
It carries exact Core/source identity, generation/epoch, source tick, selection sequence/fingerprint, and
positive resolved damage; it never mutates GPU Core health. Batch validation/dedupe is atomic before CPU
CoreIntegrity mutation. Its Tower-selected branch instead validates the exact selected Tower and applies its
launch-time one-hit damage snapshot directly after contact, even after source death. That branch bypasses the
continuous Maximum Damage Window and reports `maximumDamageWindow=false`; ordinary contact and Arrow retain
the established maximum/window path.

Core depletion closes new gameplay ingress immediately. The exact impact cleanup is still included in that
boundary's one lifecycle commit and one final GPU fixed submit; `RunFailed` is emitted once. Fixed,
Effect, Formation, Atomic Transform, and Projectile Capture command owners cancel/tombstone all exact
submitted/pending/prepared/armed work and retire readback/transaction leases before that submit. Route Runtime
also closes ingress, reopens/cleans exact Z leases, and settles its bounded readback. P, Formation,
J/C′ lineage, R, and Z directors still observe the final lifecycle commit exactly once. No unpublished pulse,
regeneration, Formation transform, J split, C′ return, or projectile release executes; unpublished held
projectiles use the exact terminal cleanup ledger. A lifecycle-published `commitRequested` transform/release
does complete and settle its readback. Matching fixed/Effect/Formation/Atomic Transform/Projectile Capture/
Route Runtime ABI, tick/count/pending-zero/all-open evidence, and roster-seal evidence is required; otherwise the result is
`SEALED_FAILED`. Later terminal fixed updates are successful no-ops while presentation/draw/status retain the
frozen last committed world.

## 13. GPU-world replacement combat policy

Replacement restores the living Tower only at committed current HP. It intentionally resets the transient
Maximum Damage Window rather than copying its peak, expiry, or provenance. Core Integrity and CPU run-domain
identity survive; old session/device/epoch results cannot mutate the replacement.

Replacement also creates fresh Effect A/B pools, Summary/PEmitter planes, Pentagon roster/cadence, pending
program/readback state, and bounded presentation summary. Old owner/director/cleanup ports are revoked. No
Effect instance, Boost timer, or P roster member crosses the GPU-world generation boundary.

Formation body/group state, sorted exact lineage roster, prepared/armed programs, readbacks, private registry
transaction state, HX status, and Formation presentation summary are also reset. Only committed Tower HP crosses
the replacement boundary.

AtomicTransformState, first-hit pending, C′ due roster, prepared/armed programs, readbacks, registry
transactions, command generation, and lineage status are reset as well. Old J/C′ owner/director/transaction
ports are revoked, and no old lineage is reconstructed in the replacement world.

ProjectileCaptureState/candidate planes, held/release roster, prepare/release proofs, replay caches, readbacks,
terminal cleanup ledger, and active-metadata mutation authority are reset too. Old capture command/director/
transaction ports are revoked; no held projectile or origin-current metadata split is reconstructed.

RouteRuntime state, availability/lease records, Cork roster, cleanup/readback evidence, and Wave availability
binding are reset to a fresh all-open snapshot. Old route-runtime/director ports are revoked; no closed route,
pending all-closed backlog binding, or Z lease is reconstructed.

## 14. 렌더 보간

- fixed step 시작에 이전 Transform을 보관한다.
- solver correction은 현재 위치/body/SoA에 반영하되 이전 렌더 위치를 같이
  이동하지 않는다.
- 가변 update에서 alpha로 render transform을 계산한다.
- draw는 물리 Transform이 아니라 render Transform을 사용한다.
- 확대 카메라도 같은 render Transform을 추종해 fixed-step 경계 떨림을 만들지
  않는다.
- resize는 viewport와 UI projection만 바꾸며 월드 entity를 다시 생성하지 않는다.
- spawn/teleport/resize처럼 보간을 의도적으로 끊는 경계만 현재/이전 위치를
  함께 동기화한다.
- GPU 적은 strict interpolation, source reference-clock extrapolation, capped
  accumulator profile을 제공한다. 현재 production 기본은 reference-clock이며
  표현 위치만 예측하고 authoritative physics buffer를 수정하지 않는다.

## 15. 성능 원칙

- interface validation은 등록 시 수행한다.
- inner collision loop는 숫자 kind/shape code와 SoA를 사용한다.
- query scratch와 candidate buffer를 재사용한다.
- 전체 projectile × enemy O(N²)를 허용하지 않는다.
- P pulse/cluster navigation also forbids naive emitter × all-body or P×N² scans. It consumes tick-start
  bounded-grid candidates and bounded route-integration/SDF reachability data.
- H join/rotation likewise uses tick-start bounded-grid candidates and route integration/SDF gates; naive H×N²
  scans and CPU pose authority are forbidden.
- J/C′ marker/due work uses bounded exact-handle rosters and batched GPU prepare; no full-body scan readback,
  unbounded lineage queue, or per-branch JavaScript controller is allowed.
- R capture/release uses bounded one-slot-per-R GPU matching, exact-handle host roster, and bounded completion
  streams; no projectile×R CPU scan, per-held-projectile JavaScript timer, or full-body readback is allowed.
- Z closure/reroute uses GPU topology indices, one bounded exact-handle roster of eight, and bounded completion
  readback; no per-Z controller/helper collection, dynamic SDF rebuild, or enemy×closure CPU scan is allowed.
- 이벤트 수가 많으면 HitBatch를 사용하되 damage 순서를 보존한다.
- debug recorder on/off가 시뮬레이션 결과를 바꾸지 않아야 한다.
- production projectile의 물리/contact/lifetime/render를 CPU object/timer로 복제하지 않는다.

## 16. 전환 완료 기준

- GameScene이 player/wall/projectile 배열을 직접 소유하지 않는다.
- 외부 호출자가 enemy live 배열을 변경할 수 없다.
- 플레이·benchmark 월드가 별도 WorldRegistry를 사용한다.
- 현재 target에서는 Tower GPU Health/death field와 CPU TowerShare/LostShare domain metadata가 필요하다.
- GPU mode primary Basic Bullet이 exact Tower source, same-world contact/lifetime/death/direct render와 next-boundary cleanup을 사용한다.
- WASM collision parity와 기존 고밀도 benchmark gate가 유지된다.
- 맵 전환과 scene destroy 뒤 active entity/listener가 0이다.
- production 월드 renderer에 고정 픽셀 크기·간격이 없고 2560×1440 및 다른
  해상도에서 동일한 월드 비율을 유지한다.
