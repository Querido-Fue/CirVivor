# R2 Turn 6 — J Split/Transform and Conserved Bounty Lineage

## 현재 상태

Turn 6 production, contract, static/Node fixture, and dedicated NW support 경로는 authored되었다.
이 turn의 제한 cadence에서 behavior suite, Node suite, NW/WebGPU, WASM, render golden, manual smoke는
실행하지 않았다. 실행 결과를 PASS로 주장하지 않으며, 최종 수락과 repeated
exponential/capacity churn은 Turn 9 gate다.

Progress 파일은 라우터가 소유하며 이 문서가 대신 변경하지 않는다.

## 1. Immutable authoring authority

```text
natural J
  definitionId              basic_gen_01
  shapeDefinitionId         gen
  spawnPolicy               NATURAL
  atomicTransformProfileId  jorang-one-to-many-01
  bountyBudget              12 (uint32)

transform-private C′
  definitionId              basic_circle_prime_01
  shapeDefinitionId         circle
  spawnPolicy               TRANSFORM_PRIVATE
  atomicTransformProfileId  circle-prime-return-delayed-01
```

J와 C′는 둘 다 common C의 physics/behavior를 사용한다. C′는 HP `1`, speed `2.5`, weight `1`,
Tower/Core damage `0.1/1`을 사용하며 authored wave/direct spawn으로 생성할 수 없다. 두 profile은
topology/source/destination/trigger/kinematics/health/bounty/Effect/lineage/pending/forfeit 조합을 exact
fail-closed로 고정한다. 알고 있는 개별 policy 값을 임의로 섞어 phantom profile을 만들 수 없다.

Live capability는 J/C′의 `enemy-navigation`, `enemy-contact-combat`, `enemy-core-impact`,
`enemy-atomic-transform`이다. H natural/group의 Formation atomic-transform roster와 J/C′ lineage roster는
서로 다른 implementation port를 사용하며, shared generic transaction seam의 H `MANY_TO_ONE`
회귀를 유지한다.

## 2. Body ABI v7 and independent AtomicTransformState

Body ABI v7은 기존 primary plane, 40-byte `CombatState`, 80-byte `EnemyBehaviorState`의 stride를
바꾸지 않고, J/C′를 위한 48-byte persistent `AtomicTransformState`와 16-byte tick-local
candidate plane을 독립 domain으로 추가한다. `CombatState` reserved word나 exclusive behavior union에
J/C′ state를 인코딩하지 않는다.

```text
program: NONE | J_SPLIT_FIRST_HIT | C_PRIME_DELAYED_RECOMBINE
phase:   NONE | ARMED | SPLIT_PENDING | CHILD_DELAYED | TRANSFORM_ARMED
state:   exact entity/incarnation, due tick, lineage root pair,
         transaction-local branchIndex, uint32 bountyBudget,
         trigger tick/sequence, command generation
```

Generic topology vocabulary는 `MANY_TO_ONE`, `ONE_TO_MANY`, `ONE_TO_ONE_DELAYED`이다. Turn 6은
뒤의 두 topology를 J/C′에 연결하고, H는 기존 `MANY_TO_ONE` 자세를 유지한다. Atomic
Transform Runtime ABI v1은 prepare `32 + 64N`, transform `48 + 80N`이고 storage profile의
required maximum은 `9`다. First-hit contact pipeline의 transitive storage interface도 exact `9`이며
기존 contact profile의 `9`를 늘리지 않는다.

## 3. First valid projectile hit and PENDING shield

Current production의 `first-valid-projectile-hit`은 다음을 모두 충족한 exact contact다.

```text
positive final damage candidate
+ CLOSEST_ONLY projectile handler
+ positive, reservable self-hit budget
+ exact live projectile subject and exact live J in other/target identity
+ current Team/target acceptance
```

Event subject는 projectile이고 `other` exact handle이 J이다. 다른/non-`CLOSEST_ONLY` handler는 이 marker나
immunity를 forge하지 못하고 기존 generic contact semantics를 따른다.

첫 valid hit은 projectile self-hit budget을 한 번 소비하고, J damage를 `0`으로 기록하며
`ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT` event를 하나 낸 뒤 J를 `SPLIT_PENDING`으로 변경한다. 그 상태에서
후속 동일-valid projectile contact는 split success, terminal, or explicit cancel 전까지 damage `0`이며
추가 source budget/event를 소비하지 않는다. Normal capacity rejection은 J와 PENDING을 유지하고
recovery를 요구하지 않는다.

## 4. Atomic J 1→2 split

J source는 destination 두 개와 모든 auxiliary/effect capacity가 preflight된 후 한 lifecycle transaction에서만
소비된다. 모든 reservation이 성공하거나 source mutation이 `0`이며 half child는 없다.

```text
J source exact GPU pose/velocity/flow
  → child0 C′ exact copy
  → child1 C′ exact copy

both child HP current/max = fresh full common-C HP = 1/1
dueFixedTick = publication tick + 60
```

Bounty는 exact uint32이며 child0가 indivisible remainder를 먼저 받는다.

```text
b0 = floor(B / 2) + (B mod 2)
b1 = floor(B / 2)
12 → [6, 6]
1  → [1, 0]
0  → [0, 0]
```

`0` budget branch는 legitimate하며 first-hit/split/return eligibility에서 제외되지 않고 지급만 `0`이다.
Source의 target-tick half-open active Effect instance는 exact identity/provenance/ticks를 보존한 채
child0으로만 모두 rekey되고 child1은 Effect 인스턴스가 없다.

Lineage authority는 hash/단일 ID가 아닌 natural root의 exact `(entityId, incarnation)` pair다.
`branchIndex` `0/1`은 각 `ONE_TO_MANY` transaction의 local child order이며 lineage 전역 unique ID가 아니다.

## 5. Independent C′ 1→1 return

C′ 각 body는 publication tick에서 exact `60` fixed ticks 후 독립적으로 return due가 된다.
Due source의 authentic GPU prepare evidence는 `T-1`에 생성되고 오직 `T`의 privileged lifecycle
`ONE_TO_ONE_DELAYED` transaction에서 J로 발행될 수 있다.

Returned J는 source C′의 exact GPU pose/velocity/flow, current/max HP, exact Effect instances, branch
bounty budget, lineage root pair, local `branchIndex`를 보존하고 `transformAtTick=0`, `ARMED`로 시작한다.

```text
two surviving C′ → two independent J
one surviving C′  → one J
no survivor       → no J
```

C′가 return 전 Core에 impact하면 그 branch는 body와 bounty budget을 함께 소비하고
bounty payout/J return을 모두 발생시키지 않는다.

## 6. Scheduling, capacity, retry, and identity

GPU first-hit admission은 host start quota와 다르다. 같은 tick의 valid J hit 5개를 모두 marker/event/
PENDING으로 수용하고 각 projectile budget을 한 번씩 소비한다. `JorangSplitLineageDirector`는
current pending/due backlog를 bounded capacity까지 prepare하며, authentic completion을 다음 순서로 정렬한다.

```text
C′ delayed return first
→ dueFixedTick ascending
→ lineageRootEntityId/incarnation ascending
→ source entityId/incarnation ascending
```

Actual lifecycle transform start는 J lineage 전역에서 fixed tick당 exact `4`개다. H Formation start
quota/seam은 별도로 유지한다. 5개 예시에서 첫 tick에 4개, 다음 tick에 남은 1개가
실행되며 ENTER_ONLY overlap 때문에 5번째 trigger가 유실되지 않는다.

Prepare readback pending은 authoritative `T` publication prerequisite이고 recovery가 아니다. Fixed world는
그 readback이 준비될 때까지 같은 `T`를 정상 stall/retry한다. 반면 normal body/registry/Effect capacity
rejection은 `recovery=false`, `retryDisposition=restage-next-prepare`,
`sourcePendingPreserved=true`다. 현재 `T` attempt의 lifecycle command/owned identity/proof는 소비하고
PENDING/logical backlog를 유지한다. 같은 `T` 말단 prepare가 fresh authentic proof를 만들며,
`T+1`에는 새 command ID로 재시도한다. 이전 proof/command를 replay하지 않는다. Stale source/death/
Core cleanup은 normal cancel이고 registry/backend parity/protocol/ABI mismatch만 recovery다.

Every source/destination/lineage operation validates exact `(entityId, incarnation)` and command/session/
device/epoch generation. Despawn, terminal, replacement, and slot reuse 후 old prepared/readback/callback은
new identity를 mutate할 수 없다.

## 7. Terminal and GPU-world replacement

Core depletion은 new J/C′ ingress를 닫는다. Registry/host publication 전 pending first-hit, delayed
return, prepared/armed transform과 그 lease는 versioned cancel/tombstone한다. 이미 lifecycle publication이
끝나 backend `commitRequested`인 split/return은 rollback하지 않고 terminal final submit에서 GPU commit과
async readback을 완결한다. Prior/current readback이 모두 settle되고 Atomic Transform owner/backend
ABI·final/submitted tick·pending-zero evidence와 J/C′ roster의 fixed/lifecycle observation·pending/due-zero
seal이 일치할 때만 `SEALED`다. Missing/partial/mismatched evidence는 `SEALED_FAILED`이다.

GPU-world replacement는 committed Tower HP만 보존하고 `AtomicTransformState`, first-hit pending,
C′ due roster, prepared/armed programs/readbacks/transactions, lineage director status를 모두 새로 시작한다.
Old endpoint/owner/director/transaction port는 revoke되며 이전 lineage를 replacement body로 복원하지 않는다.

## 8. Authored evidence and deferred acceptance

Turn 6 source-authorship은 다음을 고정한다.

```text
immutable J/C′ profile/capability/catalog and negative combinations
Body ABI v7 + independent AtomicTransformState/WGSL/static layout
first-hit subject(projectile)/other(J), immunity, PENDING shield
atomic 1→2 and delayed 1→1 T-1→T
one/both/no survivor and independent 60-tick timers
pose/velocity/flow, HP, Effect, bounty, lineage preservation
uint32 12.5/negative/overflow rejection and 0-budget recursive lineage
5-trigger admission versus host starts 4+1
capacity retry with fresh proof/command, no half child
terminal/replacement/ABA and H shared-seam regression
dedicated enemy-jorang-split-lineage NW support/manifest routing
```

위 항목은 authored evidence이지 이 turn에서 실행된 PASS evidence가 아니다. Turn 9이 full Node,
actual NW.js/WebGPU, WASM, render golden, stress/churn, optional manual smoke를 수행해 R2 최종
acceptance를 확정한다.
