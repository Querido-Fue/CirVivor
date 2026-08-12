# R2 Turn 1 — Common Enemy Runtime Foundation

## 목표

다음 공통 기반을 구현한다.

```text
interface/capability Enemy architecture
physics/combat/behavior profiles
map/wave resolved stats
Tower Maximum Damage Window
weight-based Tower/Enemy physical solve
universal Enemy→Tower continuous contact
universal Enemy→Core impact/despawn/no-Gold disposition
Core depletion / RunFailed
```

## 시작

1. 공통 계약을 읽는다.
2. 진행 파일을 `r2t1 수행 중.`으로 바꾼다.
3. 현재 시작된 R2 contract/catalog가 있으면 감사해 재사용한다.
4. 중복 schema를 만들지 않는다.

## 1. Capability foundation

Stable IDs 최소:

```text
enemy-contact-combat
enemy-core-impact
```

Future IDs는 vocabulary에 둘 수 있지만 빈 runtime class는 만들지 않는다.

Contracts/ports:

```text
EnemyCapabilityRegistry
IEnemyLifecycleObserver
IEnemyFixedCommandProducer
IEnemyGameplayEventConsumer
```

각 port는 필요한 최소 method만 요구한다.

Production spawn path에 per-Enemy JS instance가 생성되지 않는 test를 작성한다.

## 2. Profiles

Canonical immutable profiles:

```text
EnemyPhysicsProfile
- collisionRadius
- weight
- pairCollisionRadiusScale

EnemyCombatProfile
- maxHealth
- towerContactDamage
- coreImpactDamage
- bountyBudget

EnemyBehaviorProfile
- navigation/target/fallback/formation policy
```

Every EnemyDefinition references profile IDs and capability IDs.

Current content를 migrate하되 기존 Archer와 production wave behavior는 바꾸지 않는다.

## 3. Map/Wave stat resolve

`ResolvedEnemySpawnStats` compiler를 추가한다.

Current production map/wave는 identity modifier를 사용한다.

Resolved values가 spawn intent와 registry metadata까지 전달되도록 한다.

## 4. Tower Maximum Damage Window

GPU-authoritative implementation.

Requirements:

```text
same-tick max aggregation
order-independent
tie-break provenance
projectile valid-hit penetration consumption
continuous Enemy overlap candidate
exact expiry tick
```

Current contact pass 9-binding 한도를 넘기지 않는다.

필요하면 versioned combat side-plane과 dedicated pass를 만든다.

Host/WGSL ABI mismatch fail-closed.

Tower HP events에는 실제 차액만 기록한다.

## 5. Weight collision

Tower weight 10 data-owned.

Enemy inverseMass from resolved weight.

Tower↔Enemy physical pair와 interaction pair를 동시에 유지한다.

Light/Heavy displacement reference tests를 작성한다.

## 6. Universal contact combat

All current Enemy definitions:

```text
interaction with PLAYER_DAMAGEABLE
continuous damage candidate
```

Team matrix를 통과한 최종 피해만 Tower window에 들어간다.

## 7. Core impact

`EnemyCoreImpactDirector` 또는 동등 owner.

```text
Core proxy interaction
→ exact Enemy lookup
→ resolved coreImpactDamage
→ CoreIntegrity damage
→ disposition CORE_IMPACT
→ exact despawn
```

Add disposition vocabulary.

Core 0:

```text
RunOutcome RUNNING → DEFEATED
RunFailed once
```

Terminal cleanup submit 후 later fixed calls are successful no-ops.

## 8. Tests to author, not execute

작성:

```text
capability/profile validation
no per-Enemy JS object
stat modifier precedence
damage-window oracle/permutation
GPU damage-window contracts
weight solve
continuous overlap expiry
Core impact dedupe/disposition
Core defeat terminal state
R1/Pre-R2 regressions
```

## 9. 일반 턴 위생 검사

행동 테스트는 실행하지 않는다.

실행:

```text
changed production JS/MJS node --check
git diff --check
```

## 10. 완료

성공하면 진행 파일을 정확히:

```text
r2t1 수행 완료.
```

로 변경하고 라우터로 돌아가 Turn 2를 즉시 시작한다.
