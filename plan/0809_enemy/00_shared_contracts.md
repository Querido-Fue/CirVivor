# R2 Enemy Ecosystem — Shared Contracts

모든 R2 턴에 적용되는 공통 권위다.

## 1. 기준과 작업트리

Accepted base:

```text
649806d25dfc541e58551515a0faf70733def3ec
```

현재 worktree에 이미 시작된 R2 변경이 있으면 사용자 변경으로 보존한다.

금지:

```text
reset
restore
checkout
stash
broad revert
destructive clean
자동 commit/staging
```

Code와 tests가 runtime truth다.

## 2. 런타임 불변식

```text
- gameplay/physics/AI timer = 1/60 fixed step
- presentation/UI = variable frame
- GPU bodies authoritative between fixed ticks
- full-body frame readback 금지
- exact entityId + incarnation
- GameObjectSystem only endpoint owner
- one commit / one fixed GPU submit per gameplay tick
- old session/device/epoch callback 폐기
- storage-buffer max per shader stage <= 9
- unsupported fallback는 session-atomic
- current Body ABI v8 / EnemyBehaviorState 80 bytes
- BodyControlProgram v2 record/state = 96/64 bytes
- SpawnProgram v4 record = 96 bytes
- independent Effect/Pulse/Formation/Atomic Transform/Projectile Capture/Terminal ABIs
- J/C′ AtomicTransformState 48 bytes + tick-local candidate 16 bytes; CombatState/EnemyBehaviorState를 확장하지 않음
- Atomic Transform Runtime ABI v1: prepare 32 + 64N, transform 48 + 80N, first-hit/storage max exact 9
- R/projectile ProjectileCaptureState 48 bytes + tick-local candidate 16 bytes; Simulation flag는 exact mirror만 담당
- Projectile Capture Runtime ABI v1: capture/release header 64, completion/release record 96, profile 32, Tower target 16 bytes
- Route Runtime ABI v1: body state 64, topology header 96, availability header/record 64/32, cleanup header/record 32/32 bytes
- optional routeGraph v1 overlays immutable SDF/Flow Field topology; legacy maps stay graph-null/all-open
- Effect/P/Formation/Atomic Transform/Projectile Capture state never extends EnemyBehaviorState
- Formation ABI v1: body/candidate 80/48 bytes, prepare 48 + 144N, transform 64 + 192N
- Formation prepare-select/transform-aux/render storage max = 9/8/8
```

보존해야 하는 accepted 동작:

```text
- Tower HP 30
- Tower death는 defeat가 아님
- Tower death 후 Enemy exact bodies/simulation/render 유지
- Tower death로 GPU World restart 금지
- no-Tower camera는 Core presentation follow
- CoreIntegrity 0만 defeat
- Player/Hostile damage matrix
- Archer hostile projectile
- tooltip 0.01 precision
- animationCategory와 UI duration scale
```

## 3. Interface/capability 설계

개념:

```text
EnemyBase + Shape + AI + optional capability
```

실제 JavaScript/GPU 구조:

```text
EnemyDefinition
- immutable profile IDs
- shapeDefinitionId
- capabilityIds

WorldRegistry
- exact handle
- stable IDs
- no per-Enemy JS AI object

Capability Systems
- lifecycle-driven exact-handle roster
- batch/fixed/event owner
- bounded state
```

State-domain separation:

```text
ENEMY_BEHAVIOR_STATE
→ mutually exclusive basic movement/attack programs only
→ Arrow charge / selected-target projectile처럼 한 body의 exclusive behavior program

Effect Runtime
→ independent capability system + independent instance/summary state domain

Formation Runtime
→ independent capability system + independent group/member state domain

Atomic Transform Runtime
→ independent J/C′ per-body state + first-hit/prepare/transform domain
→ H Formation state와도 별도 roster/implementation port

Projectile Capture Runtime
→ independent bilateral R/projectile state + capture/release evidence domain
→ same slot/entity/incarnation in-place allegiance transfer; spawn/recreate 금지

Route Runtime
→ independent per-body route state + GPU availability/exact lease domain
→ existing Flow Field/SDF remains immutable; closure changes only selection/forward transition/blocker state
```

P/H/J/C′/R/Z/Effect/Formation/Atomic Transform/Projectile Capture/Route Runtime state를
`ENEMY_BEHAVIOR_STATE` union에 append하지 않는다.

`tracked_pose_config`와 tracked-pose readback은 presentation/camera/diagnostic 전용이다. Tower를
targeting하는 gameplay GPU program은 별도의 exact Tower-target binding/port를 사용하며 gameplay
selection, validity, charge, aim에 tracked-pose configuration을 재사용하지 않는다.

Turn 4 production Arrow는 16-byte `TOWER_GAMEPLAY_TARGET_CONFIG` exact handle/slot binding으로 교정되었다.
Gameplay target clear는 hard gate이며 terminal seal은 마지막 tracked presentation snapshot을 그대로
freeze한다. 2026-08-10 Turn 4 누적 checkpoint의 dedicated Arrow hardware stage가 이 분리를 검증했다.

금지:

```text
class HexEnemy extends EnemyBase ...
shape switch 하나에 모든 AI 몰아넣기
Enemy 하나마다 JS controller 생성
shape가 AI를 암묵적으로 결정
```

필요한 capability 구현은 해당 턴에서 실제 기능과 함께 만든다.
미래 capability 빈 class를 미리 대량 생성하지 않는다.

Current live stable IDs:

```text
enemy-contact-combat
enemy-core-impact
enemy-charge  # basic_arrow_01 only in Turn 2
enemy-effect-emitter  # Pentagon P only in Turn 3
enemy-formation  # H/group/HX in Turn 4
enemy-atomic-transform  # H/group and natural J/transform-private C′; HX terminal composite에는 없음
enemy-projectile-capture  # natural Ring R in Turn 7
enemy-route-closure  # natural Cork Z in Turn 8
```

## 4. 공통 Enemy 접촉

모든 Enemy:

```text
Tower contact
→ towerContactDamage candidate
→ Enemy 생존
→ 계속 overlap 중이면 매 fixed tick candidate 가능

Core contact
→ coreImpactDamage
→ exact Enemy despawn
→ disposition CORE_IMPACT
→ Gold 없음
```

Core depletion boundary:

```text
new gameplay ingress 즉시 폐쇄
→ fixed + Effect + Formation + Atomic Transform + Projectile Capture + Route Runtime pending/prepared/armed work versioned cancel/tombstone/readback/transaction lease retire
→ authenticated Core-impact Enemy cleanup과 final P/Formation/J/R roster observation을 포함한 마지막 lifecycle commit/GPU submit 1회
→ unpublished held projectile privileged terminal cleanup
→ no unpublished terminal pulse/regen/Formation transform/J split/C′ return/projectile release; lifecycle-published backend-commitRequested transform/release는 final submit/readback settle
→ fixed + Effect + Formation + Atomic Transform + Projectile Capture + Route Runtime ABI/tick/count/pending-zero와 roster-seal/all-open evidence 검증
→ terminal seal
→ 이후 fixedUpdate successful no-op
```

Seal은 마지막 committed fixed/presentation reference clock과 camera target을 고정한다. 새 GPU/gameplay
mutation 없이 presentation/draw/status snapshot은 계속 읽고 그릴 수 있어야 한다.

Tower overlap의 재공격 조건은 separation이 아니다.
Tower Maximum Damage Window가 피해 빈도를 제한한다.

## 5. Tower Maximum Damage Window

내부 명칭:

```text
TowerMaximumDamageWindow
```

기술 baseline:

```text
durationTicks = 60
```

Damage order:

```text
raw
→ source modifier
→ armor/resistance/directional/status
→ final damage
→ same-tick max aggregation
→ Tower damage window
→ GPU HP mutation
```

같은 Tower/sourceTick 후보:

```text
tickMaximum = max(final damage)
```

동일 max provenance tie-break:

```text
source entityId ascending
→ source incarnation ascending
```

Window inactive at tick N:

```text
applied = D
peak = D
expiresAtFixedTick = N + 60
```

Window active:

```text
D <= peak
→ applied 0
→ timer unchanged

D > peak
→ applied D - peak
→ peak D
→ winning provenance update
→ 최초 N + 60 expiresAtFixedTick unchanged
```

Candidate tick:

```text
tick < expiresAtFixedTick  → active
tick >= expiresAtFixedTick → expired
```

유효 projectile hit는 window가 HP 피해를 0으로 줄여도 penetration/self-hit를 소비한다.

Hit 자체가 friendly fire, stale, capture, reflect, invalid로 거절되면 소비하지 않는다.

Recovery:

```text
Tower HP 보존
transient damage window 초기화
Effect A/B pool/Summary/PEmitter/P roster/cadence/pending/readback 초기화
Formation body/group/exact-lineage roster/prepared/armed/readback/transaction/presentation 초기화
AtomicTransformState/J first-hit pending/C′ due roster/prepared/armed/readback/transaction/presentation 초기화
RouteRuntime body state/availability exact leases/Z roster/cleanup-readback/Wave availability binding all-open 초기화
stale Effect/Formation/Atomic Transform owner/director/transaction port revoke
```

## 6. Weight

`weight`는 물리 질량이다.

```text
inverseMass = 1 / weight
```

용도:

```text
- projectile knockback 저항
- Enemy-Enemy solver displacement
- Tower-Enemy solver displacement
```

Tower baseline:

```text
weight = 10
```

Wave rarity/random cost가 아니다.

## 7. Stat resolve

Spawn 시 한 번 resolve:

```text
base
× map global
× map per-definition
× wave global
× wave per-definition
→ absolute override
→ final validation/quantization
```

Absolute override precedence:

```text
map global
< map per-definition
< wave global
< wave per-definition
```

중간 반올림 금지.
Spawn 후 immutable.
런타임 변화는 Effect 시스템이 담당한다.
`bountyBudget`은 combat profile → resolved stats → spawn intent 경계 모두에서 exact uint32이다.
Fractional, negative, `2^32` 이상은 reservation 전 fail하고 `0`은 legitimate budget이다.

## 8. Authored waves and formations

Wave는 randomness가 아니라 data timeline이다.

60Hz compiler command vocabulary:

```text
SPAWN_FOR_DURATION
WAIT
SPAWN_GROUP
SPAWN_FORMATION
```

Command identity에는 wave/timeline/group/member provenance가 포함된다. 같은 fixed tick에 예정된
모든 spawn은 하나의 atomic batch로 요청하며, 거절되면 schedule cursor를 전진시키지 않고 동일한
command identity로 재시도한다.

예:

```text
for 2 sec: 10 C
wait 1 sec
for 2 sec: 10 C + 6 P
spawn formation group
```

Formation schema:

```text
memberCount
rows / columns  # explicit 또는 rectangular layout에서 exact derive
coordinateSystem
spawnMode
rowDelay
keepFormation
layout
symbol map
route/path binding
```

Optional multi-route content may bind a spawn group to one `routeSetId` instead of a fixed path. The
WaveDirector resolves only from the latest authenticated availability snapshot; if every candidate is closed,
the exact authored command identity remains backlogged and the schedule cursor does not advance. Legacy map/
wave content without `routeGraph` retains its existing exact gate/path binding and all-open behavior.

`memberCount`는 살아 있는 authored member 수이며 grid dimensions와 다른 개념이다. `rows`와
`columns`를 explicit하게 제공하지 않으면 rectangular `layout`의 행/열 수에서 exact derive하고,
둘 다 제공되면 layout과 일치해야 한다. `size` 하나를 member count와 grid dimensions의 이중
의미로 사용하지 않는다.

Turn 4 production compiler는 `memberCount + rows/columns`를 권위로 사용하고 legacy `size`를 거절한다.
Explicit/derived dimension, non-dot member count, layout/symbol, route/walkability mismatch는 모두 mutation
전에 fail한다.

Coordinate-system vocabulary:

```text
current production: LINEAR_GRID / HEX_AXIAL / PATH_RELATIVE / RING_SLOTS
future vocabulary only: HEX_OFFSET
```

`keepFormation`은 data-owned bool/policy다.

Runtime materialization:

```text
LINEAR_GRID initial offsets
PATH_RELATIVE initial offsets
ALL_AT_ONCE / SEQUENTIAL_ROWS rowDelayTicks
keepFormation=true → natural H exact HEX_AXIAL six-ring provenance에서만 허용
non-Formation keep/direct transform-private group·HX authored spawn → fail closed
```

모든 formation member 위치는 compile 시 exact gate/path binding과 walkable tile을 검증한다.
Lifecycle은 `(waveId, formationGroupId)` authored-provenance ledger를 bounded하게 유지해 여러 batch/tick에
걸친 dimensions/memberCount/occupied-mask consistency와 member/member-slot uniqueness를 whole-request commit
전에 검증한다. 이 groupId는 runtime merge identity가 아니다.

## 9. No-reverse path constraint

H와 P를 포함한 명시적 profile:

```text
- path progress 감소 금지
- path 폭 안 횡이동 허용
- 감속/대기 허용
- 뒤쪽 후보를 만나러 역주행 금지
```

## 10. Fallback

Tower-target behavior의 기본 fallback:

```text
Tower 없음
→ Core
```

O도 Core 주변 공전하지 않고 Core에 뛰어든다.

## 11. H/HX

Formation은 Effect 및 exclusive basic behavior union과 독립인 ABI/state/capability domain이다.

Production identity:

```text
n1 natural                basic_hexa_01
n2..5 transform-private   basic_hexa_group_01
n6 transform-private HX   basic_hexa_hive_01
formation                 hexa-hive-six-ring-01
shapeDefinitionId         hexa  # 셋 모두 동일
```

각 merge는 exact live H/group source 둘을 소비하고 composite destination body 하나를 만든다.
Group-to-group merge를 허용하며 direct authored group/HX spawn은 금지한다. Natural n1 generation은 1,
destination은 `max(sourceGenerationA, sourceGenerationB) + 1`이고 uint32 exhaustion은 zero-partial이다.
Identity root는 ordered exact source 중 낮은 entity identity이며 destination은 같은 entityId와
`root incarnation + 1`을 no-wrap/no-collision preflight 후 사용한다. Identity root와 GPU motion source는
별도 authenticated fact다.

`FormationRuntimeDirector` bounded SoA는 original exact handle 1..6을 정렬 보존한다. Runtime formation
identity는 exact live group/destination handle이다. Authored `formationGroupId`는 provenance일 뿐 merge key가
아니다. Registry/GPU `formationLineageHash`는 correlation only이며 exact lineage authority를 대체하지 않는다.

GPU prepare source tick N은 source를 바꾸지 않고 오직 N+1 CPU boundary에서만 privileged lifecycle
publication이 가능하다. Private authority + opaque generation-bound single-use WorldRegistry token을 사용해
한 authentic lifecycle commit `{spawned:[destination], despawned:[sourceA,sourceB]}`만 발행한다. Regular
death/Core cleanup이 publication 전에 이기며, CPU publication 뒤 GPU commit failure는 rollback 없는 hard
recovery다.

Centi-HP signed-int32 authority:

```text
sum = sourceA + sourceB
merged current = currentSum + trunc(currentSum / 10)
merged max     = maxSum     + trunc(maxSum / 10)
```

Positive/alive/current<=max/overflow/destination current<=max를 전체 preflight한다. f32 `1.1` 경로를 쓰지
않는다.

H/HX는 natural n1부터 map/wave modifier가 금지된 absolute fixed n-table을 사용한다. Tower-contact
`[0.1,0.12,0.144,0.1728,0.20736,0.248832]`, speed
`[2.5,2.25,2.025,1.8225,1.64025,1.476225]`, weight `[1,2,4,8,16,32]`를 table에서 한 번
quantize한다. Core impact는 모든 n에서 1이고 bounty budget은 `[1,2,4,6,8,10]`이다. Source disposition
`MERGE_CONSUMED / TRANSFORM_CONSUMED`은 kill bounty를 지급하지 않는다.

Join은 tick-start bounded grid와 route integration-cost/stage/SDF64를 사용한다. Same-stage cost nonincrease
또는 reachable later stage만 허용하고 reverse/SDF-invalid/grid overflow/naive H×N²를 fail closed한다.

Formation ABI v1 universal Effect invariant는 target tick에 half-open active인 모든 source instance를
destination으로 independently in-place rekey하는 것이다. ID/incarnation/source/applied/expiry/payload를
보존하고 aggregate/refresh/silent loss를 금지한다. `preparedEffectRekeyCount === effectRekeyCount`가 아니면
transform completion을 수용하지 않는다.

## 12. P effects

Turn 3 production architecture:

```text
endpoint-owned bounded generic GpuEffectCommandOwner
GameObjectSystem-owned PentagonEffectDirector exact-handle SoA roster
GPU Effect instance pool A/B
per-body Effect Summary
per-body PEmitter state
```

각 Effect instance는 독립 timer/source/target을 가진다. Lifetime은 half-open이다.

```text
appliedTick <= T < expiresAtTick → active
T >= expiresAtTick              → expired
```

Boost stack:

```text
active Boost instance count
```

예:

```text
1 stack → HP regen
2 stacks → HP regen + Attack bonus
```

각 instance 만료에 따라 stack이 감소한다.

Poison/Burn/Freeze/Boost가 같은 Effect Runtime을 공유한다.

같은 target fixed tick에 due인 모든 P는 source exact identity/pulseSequence 순서를 포함한 하나의
whole-tick batch로 stage한다. Host validation, private handle→slot resolve, pool/candidate capacity 중 하나라도
실패하면 partial acceptance 없이 0개를 적용한다. Explicit zero-target completion도 cadence를 전진시킨다.
Command/replay 인증은 session→device→epoch hierarchy와 tick/source/pulse/fingerprint를 사용한다.

Authentic `CAPACITY_REJECTED`는 status가 candidate/instance/event/pulse-grid capacity의 nonzero subset이고,
모든 pulse result가 CAPACITY_REJECTED이며 candidate/applied/event와 events가 모두 0일 때만 normal이다.
Completion watermark는 전진하지만 pulseSequence/cadence/HP/Summary/event는 mutation하지 않고 observation
fixed tick에서 deterministic retry한다. Program capacity, ABI/record, instance-ID exhaustion, forged/mixed
evidence는 recovery다.

P navigation은 tick-start bounded grid candidate와 route integration-cost/stage/SDF gate를 사용한다.
Same-stage cost 증가, reverse progress, unreachable/SDF-invalid 후보는 거절하며 naive P×N²와 CPU pose
readback을 금지한다.

Effect Summary는 immutable base를 대체하지 않는다. Contact handler는 authored/resolved base에서 매 tick
재계산하고 projectile은 spawn 시 한 번만 snapshot한다. Explicit flag가 있는 Tower contact/projectile
channel만 current Boost attack multiplier를 소비하며 direct Core impact와 typed projectile Core damage는
unmodified다. 일반 `PLAYER_DAMAGEABLE` mask만으로 Tower channel을 추론하지 않는다. Canonical Archer
exact-Tower target-entity SpawnProgram만 host-validated `TOWER_DAMAGE_CHANNEL`을 가지며 M은 GPU-selected
Tower evidence를 유지한다. GPU-world replacement는 Tower HP만 보존하고 모든 transient Effect/P 상태를 초기화한다.

Poison/Burn/Freeze는 Turn 3에서 data/contract/non-production fixture만 존재한다. 빈 production runtime
class를 만들지 않는다.

## 13. O

```text
orbit center = Tower
orbit radius = authored, baseline Tower radius × 12
3 consecutive armored faces
armored faces always point toward Tower
flat damage reduction on armored sector
normal damage elsewhere
Tower absent → Core rush
```

## 14. J

Production identity:

```text
natural J              basic_gen_01 / gen / NATURAL
J profile              jorang-one-to-many-01
transform-private C′  basic_circle_prime_01 / circle / TRANSFORM_PRIVATE
C′ profile            circle-prime-return-delayed-01
common stats           HP 1 / speed 2.5 / weight 1 / Tower 0.1 / Core 1
natural J bounty       uint32 12
return delay           60 fixed ticks
host actual starts     J lineage global 4/fixed tick; H cadence separate
```

C′는 authored wave/direct spawn으로 생성할 수 없다. 두 profile은 topology/source/destination/
trigger/kinematics/health/bounty/Effect/lineage/pending/forfeit 조합 전체를 exact fail-closed로
고정하며 known policy를 임의로 재조합한 phantom runtime를 허용하지 않는다. Public/profile
normalizer는 exact own data descriptor를 한 번 snapshot하고 accessor를 실행하지 않으며 symbol,
non-enumerable extra, catalog array extra를 거절한다.

Body ABI v8에서 그대로 보존되는 48-byte persistent `AtomicTransformState`와 16-byte tick-local candidate plane은
`CombatState`/80-byte `EnemyBehaviorState`/Formation과 독립이다. Program은
`J_SPLIT_FIRST_HIT`/`C_PRIME_DELAYED_RECOMBINE`, phase는 `ARMED`/`SPLIT_PENDING`/
`CHILD_DELAYED`/`TRANSFORM_ARMED`를 사용한다. Generic topology는 J `ONE_TO_MANY`, C′
`ONE_TO_ONE_DELAYED`, H `MANY_TO_ONE`이며 H/J roster port는 별도다.

Current `first-valid-projectile-hit`:

```text
positive source/mitigated damage
+ CLOSEST_ONLY projectile handler
+ positive reservable self-hit budget
+ exact live projectile subject / exact live J other
+ current Team/target acceptance
```

위 exact hit은 projectile budget을 한 번 소비하고 J damage `0`/marker event 하나를 낸 뒤
J를 `SPLIT_PENDING`으로 만든다. Non-`CLOSEST_ONLY`는 marker/immunity를 forge하지 못하고 generic
semantics를 유지한다. PENDING 동안 후속 same-valid contact는 split success/terminal/cancel 전까지
damage `0`, additional source budget `0`, additional event `0`이다.

Atomic J 1→2:

```text
all destination/body/Effect capacity preflight success → source J consume + C′ two children
any failure                                      → source unchanged, no half child
both child GPU pose/velocity/flow                → exact source copy
both child current/max HP                        → fresh full common-C 1/1
all exact active Effect instances                → child0 only; child1 empty
```

Bounty lineage total은 exact uint32로 보존한다.

```text
child0 = floor(parent / 2) + parent % 2
child1 = floor(parent / 2)
12 → [6,6]
1  → [1,0]
0  → [0,0]
```

Zero-budget J/C′도 split/return eligibility를 그대로 가지며 payout만 `0`이다. Lineage authority는
natural root exact `(entityId, incarnation)` pair이고 `branchIndex` 0/1은 각 split transaction의
local child order이지 lineage-global identity가 아니다.

C′ 각 branch는 publication tick + 60에 independently due다. Authentic GPU prepare evidence는
`T-1`에 생성되고 `T`에만 1→1 J로 publish될 수 있다. Returned J는 exact GPU pose/velocity/
flow, current/max HP, Effect instances, branch budget, root pair, local branch order를 보존하고 새로
`ARMED`된다. 둘/하나/없음 생존은 J 둘/하나/없음을 만든다. Core impact는 그 branch를 bounty/
return 없이 소비한다.

GPU trigger admission은 host max4와 다르다. Same-tick valid hit 5개는 모두 budget/marker/PENDING을
얻고, host에서 C′ due first → due tick → root pair → source exact handle ASC로 정렬해 4+1 tick에
시작한다. Prepare readback pending은 authoritative `T` publication prerequisite이며 recovery가 아니다.
Fixed world는 proof가 준비될 때까지 같은 `T`를 정상 stall/retry한다. Normal capacity rejection은
`recovery=false`, source PENDING/logical backlog preserved, half child `0`이고 현재 `T` attempt
command/proof를 소비한다. 같은 `T` 말단에 fresh prepare를 stage해 `T+1`의 새 proof/command ID로
재시도하며 old evidence를 replay하지 않는다. Terminal에서는 registry/host publication 전 prepared/
armed work만 cancel한다. 이미 publication되어 backend `commitRequested`인 split/return은 terminal final
submit에서 GPU commit과 async readback을 완결하고 prior/current readback이 모두 settle된 뒤에만 `SEALED`다.
Mismatch/partial evidence는 `SEALED_FAILED`다. Replacement는 pending/due/program/readback/transaction/
port를 reset하고 old identity/generation callback을 무시한다.

Turn 9 전 hardening 계약:

```text
trigger vocabulary        FIRST_VALID_POSITIVE_DAMAGE_HIT
producer                  projectile/explosion/effect/direct/melee가 각자 hit-policy 검증 후 공통 one-shot seam 호출
J presentation            dedicated analytic/legacy jorang shape; basic_gen_01은 compatibility alias만 허용
Effect transfer           EffectDefinition-owned deterministic non-duplicating policy
```

현재 `FIRST_VALID_PROJECTILE_HIT`, `gen` silhouette, global child0-only Effect transfer는 Turn 6 authored
baseline이며 최종 Turn 9 제품 계약이 아니다. Child0-only를 유지하려면 별도 product approval이 필요하다.

## 15. R

Production identity/profile:

```text
natural R                basic_ring_01 / ring / NATURAL
capture profile          ring-projectile-capture-01
common stats             HP 1 / speed 2.5 / weight 1 / Tower 0.1 / Core 1
slot/delay               one projectile / 60 fixed ticks
funnel                   inclusive ±45°, last nonzero route facing
release aim              exact living Tower, otherwise stored forward; no Core targeting fallback
```

Body ABI v8 adds an independent 48-byte bilateral `ProjectileCaptureState` and 16-byte tick-local candidate
plane. `PROJECTILE_CAPTURED` in Simulation is an exact mirror used by existing movement/grid/contact/solver/
render bindings; peer identity, sequence, timer, and provenance authority remain in the capture plane.
Projectile Capture Runtime ABI v1 uses 64-byte capture/release headers, 96-byte completion/release records,
a 32-byte profile, and a 16-byte Tower target config. Every routed pass stays at or below 9 storage bindings.

Capture is a GPU state change plus authenticated host roster observation, not a registry mutation. A valid
PLAYER projectile must be capturable, enter the inclusive funnel, and win the deterministic one-slot match.
The same slot/entity/incarnation becomes HELD, remains hidden and excluded from movement/grid/contact/solver,
and continues authored lifetime. Bilateral peer identity/role/phase/sequence and the Simulation mirror must
match exactly or fail recovery.

Release is a same-identity transaction. The lifecycle owner serializes active-metadata mutation after despawn
and H/J atomic work but before spawn. One opaque revision token binds the exact record object, handle,
metadataRevision, immutable provenance, next logical metadata, and backend T-1 proof. Registry publication
then backend commit is zero-partial until publication; post-publication mismatch requires recovery. Team becomes
HOSTILE, active owner/source becomes R, target policy becomes player-damageable-and-terrain, speed magnitude is
preserved, and the exit is outside captor+projectile radii by 1/1024 tile. R death/Core impact releases stored
forward once. Projectile expiry wins with no release.

Capture completion and generic events use a coherent watermark: capture evidence for a source tick is accepted
before generic death/Core evidence from that tick. Per exact projectile, tombstone/despawn > authenticated
release > held capture; contradictory duplicate evidence is protocol corruption. Terminal cancels unpublished
release work and despawns unpublished held projectiles, but a lifecycle-published `commitRequested` release
finishes its GPU commit/readback before seal. Replacement clears all capture state/roster/proof/readback and
revokes old ports/metadata-mutation authority.

포획 시 logical projectile metadata 보존:

```text
archetype
word/tag metadata
modifiers
damage
size
generation
ability/source relationships
```

변경:

```text
Team
owner
target policy
```

포획 후 관련 Subject/문장 관계가 유지되어야 한다.

## 16. Z

Production identity/profile:

```text
natural Z                 basic_cork_01 / circle / NATURAL
route profile             cork-route-closure-01
common-C stats            HP 1 / speed 2.5 / weight 1 / Tower 0.1 / Core 1
logical/helper bodies     1 / 0
travel/block radius       common circle radius / 3 tiles
expansion                 60 fixed ticks, anchored at authored closure entrance
host roster capacity      8 exact Z leases
```

`routeGraph` is optional v1 content compiled on top of the existing immutable Flow Field atlas. Legacy maps
omit it and remain all-open. Dynamic availability never mutates `TileMap.blocked`, terrain SDF, uploaded flow
directions, or authored goal positions.

GPU RouteRuntime owns `SELECT_ROUTE → TRAVEL → EXPAND → READY_TO_CLOSE → BLOCKING` plus actor
reroute/wait state and the exact closure lease. One `(entityId, incarnation, leaseGeneration)` owns a closure;
duplicate Z waits and an old incarnation cannot reopen a replacement lease. Assignment/close/reopen/cleanup
completions are authenticated by graph content key, session/device/epoch, source tick, availability version,
and fingerprint before the bounded host mirror changes.

```text
future routeSet spawn
→ lowest open priority/path
→ all closed: exact Wave command remains backlogged

active actor before switch
→ next authored forward switch only
→ open alternative

active actor beyond switch
→ advance to clearance
→ wait without reverse; other attack/effect/formation behavior continues
```

Expanded Z becomes one anchored radius-3 route blocker. Its physical mask blocks Enemy and Player Tower bodies,
but projectiles are not a physical blocker pair. Projectile contact still damages Z and consumes normal hit/
self/penetration budget; remaining penetration continues through. Exact Z death/despawn reopens then cleans the
lease. Terminal final submit and GPU-world replacement revoke old authority, empty the roster, and restore an
all-open availability snapshot.

## 17. Validation cadence

### 일반 턴: 1,2,3,5,6,7,8

작성:

```text
production code
tests
fixtures
guides only when durable
```

실행 허용:

```text
changed production JS/MJS node --check
git diff --check
```

실행 금지:

```text
npm test
behavior focused test suites
NW/WebGPU
WASM checks
render golden
manual smoke
```

이 턴들은 acceptance gate가 아니다.

### Turn 4 checkpoint

Turn 1~4 누적 전체 검증.

Dedicated actual-hardware stages:

```text
maximum-damage-window
enemy-arrow-charge
enemy-rhom-priority
enemy-pentagon-effect
enemy-hexa-formation
```

Production corridor wave는 계속 32 spawn / five-tick interval이며 dedicated H fixture가 이를 변경하지
않는다. 2026-08-10 checkpoint에서 changed-file syntax 42/42, Node 1245/1245, default WebGPU와 위 다섯
dedicated stage, 양쪽 WASM, flow-field stress 1,000 cases, audited render golden, `git diff --check`가
PASS했다. 별도 반복 H/R2 stress/churn은 Turn 9 범위이며 optional manual smoke는 실행하지 않았으므로
PASS로 기록하지 않는다. Turn 4 progress는 `r2t4 수행 완료.`다.

### Turn 9 final

R2 전체 최종 검증. Full focused/complete Node, default actual NW/WebGPU, 모든 이전 dedicated hardware
stage, 양쪽 WASM reproducibility, render golden, repeated stress/churn, diff hygiene를 실행한다. 특히
Turn 5–8에서 작성만 한 아래 네 stage는 이름을 생략하거나 default route로 대체하지 않고 명시 실행한다.

```text
enemy-octagon-directional-defense
enemy-jorang-split-lineage
enemy-ring-projectile-capture
enemy-cork-route-closure
```

Turn 9 authored O content는 current fixed-eight orbit capacity를 넘지 않는다. 8개 초과 simultaneous O의
향후 overflow policy와 multi-Tower/Tower-reappearance dynamic reacquisition은 별도 확장 계약으로 기록한다.

## 18. Progress protocol

각 턴 시작:

```text
plan/0809_enemy/r2_enemy_ecosystem_progress.md
→ r2tN 수행 중.
```

성공:

```text
→ r2tN 수행 완료.
```

Hard blocker:

```text
→ r2tN BLOCKED: <한 줄 사유>
```

항상 한 줄.

## 19. 공통 금지 범위

R2에서 구현하지 않는다.

```text
Enemy Word
The Tower shoots Enemies
Enemies shoot The Tower sentence runtime
multi-Tower Share/Split/Merge
Gold 실제 지급/drop
Wave Clear/Overtime/Shop
Run result/meta progression
GPU sentence subject selector
general GPU child allocator beyond exact feature needs
global time scale
tooltip/animation 추가 변경
```
