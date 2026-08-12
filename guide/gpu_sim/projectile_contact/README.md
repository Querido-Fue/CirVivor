# GPU 투사체 판정 가이드

## 범위

이 문서는 총알·파편·폭발 영역이 적이나 지형과 접촉해 피해를 발생시키는 경로를 설명한다. 레이저는 별도의 선분 그리드와 `contacts_body_laser.glsl`을 사용하므로 핵심 흐름에서 제외한다.

앞부분의 `source/` 링크와 Godot/GLSL 이름은 추출한 참고 게임의 동작을 설명한다. CirVivor의 현재 WebGPU/WGSL 적용 계약은 아래 **CirVivor 현재 적용 계약**을 함께 기준으로 삼는다. Node 계약 테스트, 실제 NW.js Phase 5 production Basic Bullet, R1 Turn 3 exact source-to-target, R1 Turn 4 Archer producer, R1 Turn 5 production-wave Archer hardware smoke는 통과했다. 장시간 stress와 수동 시각 QA는 별도 승인 항목으로 남아 있다.

중요한 점은 **물리 충돌**과 **게임플레이 접촉**이 별도라는 것이다.

- `bodyLayer` / `collisionMask`: reciprocal 위치 보정 capability
- `interactionLayer` / `interactionMask`: reciprocal gameplay interaction capability
- `kindId` / `definitionId`: Fire, Projectile 같은 gameplay identity

`layerMask`/`sensorMask`는 public ingress의 V1 compatibility 입력일 뿐이다. canonical producer와 normalized ABI snapshot에는 남지 않으며, interaction 효과 방향은 layer나 slot 순서가 아니라 explicit enter-only/continuous handler policy가 소유한다.

## CirVivor 현재 적용 계약

### 하나의 mixed-body session

적과 투사체는 별도 backend가 아니라 같은 `GpuSimulationEndpoint`의 `WorldRegistry`, stable-slot pool, collision grid, fixed tick, presentation surface를 공유한다. 새 코드는 `GameScene.getGpuSimulationEndpoint()`와 `GameScene.getNextGpuLifecycleFixedTick()`을 사용한다. `getEnemySimulationEndpoint()`, `getNextEnemyLifecycleFixedTick()`, `GpuEnemySimulationEndpoint`, `createGpuEnemySimulationEndpoint()`, `enemyDefinitionId`는 기존 코드용 호환 alias다. intent의 canonical metadata는 `definitionId`, `bodyLayer`, `collisionMask`, `interactionLayer`, `interactionMask`다.

attached endpoint의 lifecycle은 `GameScene → GameSystem → GameObjectSystem`만 commit/fixed/presentation/draw/destroy한다. gameplay 코드는 `getNextGpuLifecycleFixedTick()`이 반환한 경계에 `requestSpawn()`/`requestDespawn()`만 예약한다. 정상 시 `fixedTick + 1`, 이미 commit한 `N + 1` submit 재시도 중에는 `N + 2`이므로 caller가 tick을 직접 계산하지 않는다.

### data-driven projectile 사용 예

[`GpuProjectileSpawnAdapter`](../../../project/game/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js)는 무기 종류를 알지 않는다. explicit `ABSOLUTE`, source-relative velocity, source-relative aim-point, source-relative target-entity mode를 받아 같은 GPU session에 spawn intent를 예약한다. source-relative mode는 exact source handle을 받고 CPU source pose를 금지한다. Target-entity mode는 exact target handle도 받지만 target pose를 CPU에서 읽지 않는다.

```js
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GPU_PROJECTILE_SPAWN_MODE,
    GpuProjectileSpawnAdapter,
    PROJECTILE_TARGET_POLICY_ID
} from 'ingame/gpu_simulation_endpoint.js';

const endpoint = gameScene.getGpuSimulationEndpoint();
const projectileSpawner = new GpuProjectileSpawnAdapter(endpoint, {
    commandNamespace: 'gameplay-projectile'
});

const projectileDefinition = Object.freeze({
    id: 'example_projectile_01',
    collisionRadius: 0.18,
    inverseMass: 1,
    speed: 18,
    penetration: 1,
    damage: 1.25,
    damageSelf: 1,
    lifetimeSeconds: 2.5,
    killOnTerrain: true,
    closestOnly: false,
    colorRgba: Object.freeze([0.1, 0.75, 1, 1])
});

projectileSpawner.requestProjectile({
    mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
    definition: projectileDefinition,
    sourceHandle: towerGpuHandle,
    positionOffset: { x: muzzleOffsetX, y: muzzleOffsetY },
    aimWorldPoint: { x: pointerWorldX, y: pointerWorldY },
    launchSpeed: projectileDefinition.speed,
    targetFixedTick: gameScene.getNextGpuLifecycleFixedTick(),
    spawnSequence,
    commandId
});

projectileSpawner.requestProjectile({
    mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
    definition: projectileDefinition,
    sourceHandle: hostileGpuHandle,
    targetHandle: towerGpuHandle,
    positionOffset: { x: muzzleOffsetX, y: muzzleOffsetY },
    targetOffset: { x: 0, y: authoredAimHeight },
    launchSpeed: projectileDefinition.speed,
    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
    targetPolicyId: PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
    targetFixedTick: gameScene.getNextGpuLifecycleFixedTick(),
    spawnSequence,
    commandId
});
```

두 번째 예시의 `targetHandle`은 조준 좌표와 exact provenance만 정한다. 발사 허용이나 피해 권한을
뜻하지 않으며 Team matrix와 named `targetPolicyId`가 실제 피해를 독립적으로 결정한다. Request와
commit은 source identity를 먼저, target identity를 두 번째로 검증한다. ordinary stale target은
정상 거절이고, commit 뒤 GPU에서 target이 죽거나 slot incarnation이 바뀌면 `TARGET_INVALID`로
destination reservation을 정리한다.

adapter가 만드는 projectile intent는 다음 핵심 값을 갖는다.

- `kindId: 'projectile'`, `definitionId`, optional source identity와 `spawnSequence`
- absolute mode의 world `position/velocity` 또는 source-relative mode의 exact source handle와 mode payload
- target-entity mode의 exact target handle/provenance와 zero-default `targetOffset`; target Team/kind는 aim 허용에 사용하지 않음
- `radius`, `inverseMass`, finite `lifetime`
- `bodyLayer: PROJECTILE`, `collisionMask: 0`
- `interactionLayer: PROJECTILE`, `interactionMask: ENEMY | TERRAIN`
- gameplay-unit `health: penetration`
- gameplay-unit f32 `contactHandler.damageSelf`, `damageOther`, terrain/closest flags

호출자는 피해를 `×100` 하거나 반올림하지 않는다. ABI writer와 WGSL은 모두 `f32(value) × f32(100) → f32 → trunc` 순서로 signed fixed-point를 만들므로 `0.29/0.57/1.15`는 `29/57/115`가 된다. contact handler 피해는 f32 gameplay 단위로 보관하고 shader가 atomic health 연산 직전에 같은 변환을 수행한다. 이미 fixed-point인 복구/진단 값만 명시적 `healthFixedPoint` 경계를 사용한다.

production primary fire는 `GpuPrimaryProjectileController`가 semantic held primary-pointer와 copied world aim을 exact Tower GPU handle에 결합해 `BASIC_BULLET_PROJECTILE_DATA`를 요청한다. command가 commit된 경우에만 cooldown/sequence를 소비하며, normal spawn pressure는 recovery가 아니라 같은 sequence의 재시도다. tracked camera pose는 발사 origin이나 aim 계산에 사용하지 않는다.

수명 host 계약은 `-1=immortal`, `>=0=finite`, 그 외 음수 거절이다. GPU `prepare_bodies`는 finite 값만 `max(previous - fixedDt, 0)`으로 clamp하고, contact/damage 뒤 `mark_dead`가 canonical zero를 lifetime reason으로 합친다. expiry tick의 contact 가능성, health+lifetime reason coexistence, ALIVE clear/death append exactly-once를 유지한다.

### 현재 WGSL 접촉·제거 adaptation

참고 구현의 상대 순서인 `integrate → grid → contact 생성 → closest 축약 → handle contact → mark dead → solver/finalize → 다음 tick cleanup`을 보존한다. stable-slot인 CirVivor는 원본의 매 틱 dense removal/sort 대신 다음처럼 어댑트한다.

1. predicted position으로 grid를 만들고 body/body와 body/world 후보를 생성한다.
2. enter-only policy인 projectile은 이전 위치에서도 이미 겹친 pair를 억제한다. continuous policy는 겹치는 동안 매 tick interaction을 허용하며, 어느 쪽도 swept CCD는 아니다.
3. `CLOSEST_ONLY`면 deterministic tie-break를 포함해 가장 가까운 한 후보만 남긴다.
4. `damageSelf > 0`이면 projectile penetration budget을 atomic으로 먼저 예약한다. 예산이 없는 invocation은 target damage를 적용하지 않으며, target에 실제 피해를 적용하지 못한 예약은 refund한다.
5. target 피해와 `KILL_IF_OTHER_TERRAIN`을 처리하고 health/lifetime death를 표시한다.
6. 죽은 body는 GPU draw·grid·후속 pass에서 즉시 숨기고 제외한다.
7. bounded readback으로 exact-identity death event가 완료되면 CPU owner가 `requestDespawn()`을 만들고 다음 fixed 경계에서 registry 제거와 slot 회수를 확정한다.

grid는 `2 × radius <= min(cellSize)`인 body를 small primary로 유지한다. 더 큰 static body는 big candidate로 `radius + 최대 small radius` 범위에 복제하므로 큰 Core/proxy 후보가 있어도 작은 dynamic body가 solver primary에서 빠지지 않는다. 모든 raw cell/contact/event count 소비는 실제 저장 capacity로 clamp한다. 완전히 같은 좌표의 원형 body는 body identity에서 만든 반대칭 normal을 사용해 항상 같은 `+X`로 몰리지 않는다.

AppliedEvent는 32-byte stride를 유지하면서 `DAMAGE_APPLIED`, `INTERACTION_ENTER`, `INTERACTION_CONTINUOUS`를 구분한다. `TERRAIN_CONTACT`는 other가 terrain/null임을, `TERRAIN_KILL`은 그 interaction이 subject death를 만든 결과임을 별도 flag로 기록한다. 피해가 아닌 event의 value는 0이다. Host decoder는 type에 대응하는 enter/continuous policy bit 하나만 허용하고 unknown bit나 모순된 result 조합은 watermark commit 전에 fail closed한다.

event readback은 `count header + element capacity`를 분리한 고정 크기 slot과 bounded leased ring을 사용한다. event dedupe key는 `(sessionGeneration, deviceGeneration, authoritativeEpoch, entityId, incarnation, sourceTick, sequence, eventType)`이며 batch는 drain-time protocol provenance와 explicit predecessor tick chain을 가진다. sparse producer tick은 허용하지만 실제 batch 누락, sequence gap, future 조기 commit, 변조된 replay, overflow에서는 watermark를 전진시키지 않고 authoritative recovery로 승격한다. 마지막 body를 일반 despawn해도 pending event/overflow readback과 아직 drain하지 않은 completion batch가 있으면 GPU epoch/resource release를 미룬다.

### NW.js 실기 검증 결과

최종 hardware smoke는 NVIDIA Lovelace adapter의 `maxStorageBuffersPerShaderStage=10`을 확인하고 device를 `requiredLimits.maxStorageBuffersPerShaderStage=9`로 요청해 통과했다. 실제 compute layout의 storage-buffer 수는 physics `8`, body-contact `9`, world-contact `7`, contact-handling `9`였고 `uncapturedErrorCount=0`이었다.

direct mixed-contact fixture는 authored enemy `health/damageOther=0.57`, projectile `health/damageSelf=0.29`에서 `applied=1`, `damageFixedPoint=57`/`damage=0.57`, exact `death=2`, `alive=0`, `sourceTick=37`, `completedThroughTick=37`을 확인했다. 공개 endpoint fixture는 enemy/projectile `1/1` spawn 뒤 exact death event를 거쳐 next-fixed cleanup 후 `0/0`이 됐다. Phase 5 production Basic Bullet/LMB fixture도 aim/render/damage/terrain/lifetime/pressure/rebind를 통과해 bounded primary projectile/lifecycle 실기 승인을 마쳤다. 기존 physics/SDF/flow/render/stable-slot/fault/sparse/overflow probe도 모두 PASS를 유지했다. 장시간 stress, `normal-10k-v1`, Core gameplay consumer, 수동 시각 QA는 별도 승인이다.

Phase 5 실제 NW fixture는 Basic Bullet의 tick-start source aim, same-submit Tower control, direct render, damage/terrain cleanup을 통과했다. f32 2초 lifetime은 source tick 121에서 `reason='lifetime'`, flags 2로 한 번 죽고 boundary 122에 정리됐으며 zero/half-dt는 tick 1에 만료됐다. immortal `-1`은 tick 130까지 보존된 뒤 explicit cleanup됐다. SpawnProgram/body/result-ring/registry pressure에서도 control 8건과 fixed submit이 계속됐고 reservation/pending leak와 recovery는 0이었다. generation 1→2 retire/rebind, held fire, CoreIntegrity identity/value 보존을 확인했다.

R1 Turn 3 actual fixture는 SpawnProgram ABI v3의 16-byte header/80-byte record에서 moving source `(2.0416667, 8)`와 target `(7, 10)`, source offset `(0.35, 0.1)`, target offset `(0.5, -0.25)`, speed `12`를 사용했다. projectile origin은 약 `(2.3916667, 8.1)`, velocity는 약 `(11.42705, 3.66365)`였고 같은 submit의 source/target 이동 뒤 좌표가 aim에 섞이지 않았다. 동일 위치에서는 source velocity `(3,4)`가 `(7.2,9.6)`으로, 완전 퇴화는 `(+12,0)`으로 fallback했고 target이 source 뒤에 있으면 `(-12,0)`을 보존했다. PLAYER→PLAYER target aim은 resolve되지만 HP `30→30`, penetration `9→9`, damage/death 0이었고 HOSTILE→PLAYER + `PLAYER_DAMAGEABLE_AND_TERRAIN`은 HP `30→25`, penetration `9→4`였다. Target death-before-resolve와 same-slot ABA는 모두 `TARGET_INVALID`로 destination을 활성화하지 않고 reservation/pending을 0으로 정리했으며 targeted pressure에서도 Tower control/fixed submit이 계속됐다. 전체 profile은 source-resolve storage 5, stage maximum 9, `uncapturedErrorCount=0`, teardown `deviceLostReason='destroyed'`를 유지했다.

R1 Turn 4 actual fixture는 lifecycle spawn으로 등록한 moving Archer가 living Tower exact handle을 target으로 삼아 source tick-start `(4.4583354, 8)`, target tick-start `(8.0199575, 10)`, speed `12`, velocity 약 `(10.463189, 5.875511)`의 hostile Bullet을 만들었다. deterministic phase 29에서 first eligible/resolve가 `60/61`, repeat가 `150/151`, 다음 eligible이 `240`이었고 Tower HP는 `30→25→20→15→10→5→0`이었다. hostile-on-hostile은 damage 0/penetration 불변, Core는 interaction/damage 0, terrain/lifetime death는 정상 정리됐다. Tower death 뒤 shot은 0이고 Archer는 x축으로 약 `0.2500019` 계속 이동했다. 별도 target-death fixture는 `TARGET_INVALID`에서 sequence/cooldown을 소비하지 않고 모든 active/reserved/pending 수치를 0으로 정리했다. stage maximum 9, `uncapturedErrorCount=0`, teardown `deviceLostReason='destroyed'`를 유지했다.

R1 Turn 5 actual fixture는 production seven-ID 32-spawn/five-tick wave에서 Archer 4기를 indexes `6/13/20/27`, local ticks `31/66/101/136`에 등록했다. 첫 Archer는 phase 0, eligible/resolve `61/62`, repeat `151/152`; source tick-start 약 `(2.595484,4.169039)`, technical Tower target `(3,12)`, velocity 약 `(0.619054,11.984023)`, speed `12.000002`였다. Tower HP는 `30→25→20→15→10→5→0`, death source/boundary `225/226`, post-death fixed tick `256`, render alpha `255→0`, final active/reserved/pending `0`이었다. 이 fixture는 contact 안정성을 위한 technical Tower `(3,12)`를 쓰며 production GameScene spawn `(45,15)` 기하 증거가 아니다. GPU Core proxy 불변은 actual이고 CPU `CoreIntegrity`는 `coreIntegrityRuntimeBound=false`라 별도 GameSystem 테스트가 권위다.

현재 의도적으로 제외한 것은 broader hostile attack selection, laser/Tesla/fire/freeze/chaining과 참고 게임 특수 producer다. swept CCD, Core arrival/damage, Gold/reward, wave completion, shop, Word/Sentence/Skill runtime과 GPU subject selector/child allocator, versioned 10k fixture, 장시간 stress와 수동 시각 QA가 후속이다. 원본 `removal/sort`와 laser 소스는 exact dense/special parity에는 필요하지만 stable-slot vertical slice의 blocker는 아니다.

## 전체 흐름

```text
타워가 Rigidbody 생성
  → CPU가 80바이트 레코드로 직렬화
  → addition 패스가 GPU 바디 배열에 추가
  → integrate가 이전 위치와 예측 위치 생성
  → build_grid가 예측 위치를 균일 그리드에 등록
  → body/body 또는 body/world 접촉 후보 생성
  → 필요하면 CLOSEST_ONLY 후보 축약
  → handle_contacts가 피해·상태 효과·관통·연쇄 처리
  → mark_dead가 사망 표시
  → 다음 물리 틱의 handle_dead/removal에서 제거
```

실제 패스 호출 순서는 [globals/gpu_sim.gd](source/globals/gpu_sim.gd)의 `_physics_process()`에서 확인한다. 신규 바디 추가는 현재 틱의 마지막에 실행되므로 본격적인 이동과 판정은 다음 물리 틱부터 시작한다.

## 1. CPU에서 투사체 속성을 만든다

[gunner.gd](source/towers/gunner/gunner.gd)와 [cannon.gd](source/towers/cannon/cannon.gd)가 대표적인 예다.

```gdscript
var body := Rigidbody.new(position, velocity, radius, inverse_mass, penetration)
body.layer = Rigidbody.Layers.PROJECTILES
body.sensor_mask = Rigidbody.Layers.ENEMIES | Rigidbody.Layers.TERRAIN
body.collision_mask = 0
body.lifetime = range / speed
body.ch_damage_self = 1.0
body.ch_damage_other = damage
body.ch_flags = Rigidbody.ContactHandlerFlags.KILL_IF_OTHER_TERRAIN
```

여기서 `health`는 일반 투사체의 관통 예산처럼 사용된다. 적과 접촉할 때마다 `ch_damage_self`만큼 감소하고 0 이하가 되면 사망 대상으로 표시된다.

## 2. 레이어와 접촉 데이터를 비트로 묶는다

[rigidbody.gd](source/gpu_sim/rigidbody.gd)의 `insert_into()`가 CPU 데이터를 GPU 레코드로 변환한다.

```text
physics_meta = sensor_mask << 16 | collision_mask << 8 | layer
sim_meta     = flags << 8 | layer
```

위치·속도·반경·수명·피해 설정을 포함한 전체 추가 레코드 stride는 80바이트다. GPU 구조체와 binding은 [bindings.gdshaderinc](source/shaders/bindings.gdshaderinc), 실제 배열 추가는 [addition.glsl](source/shaders/rigidbody/addition.glsl)에서 확인한다.

## 3. 예측 위치를 기준으로 후보를 찾는다

[integrate.glsl](source/shaders/rigidbody/integrate.glsl)은 다음 값을 만든다.

```glsl
previous_position = position;
predicted_position = position + velocity * dt;
```

[clear_grid.glsl](source/shaders/rigidbody/clear_grid.glsl)이 셀 카운터를 비우고, [build_grid.glsl](source/shaders/rigidbody/build_grid.glsl)이 예측 위치를 셀에 넣는다. 일반 총알과 적은 중심 셀 하나에 들어가며, 판정 패스는 자기 셀과 주변 8개 셀만 확인한다.

이 단계는 좁은 단계 판정을 실행하기 전에 후보를 줄이는 broad phase다. 셀당 최대 64개만 실제로 저장된다.

## 4. 원 겹침으로 접촉을 생성한다

[contacts_body_body.glsl](source/shaders/rigidbody/contacts_body_body.glsl)은 센서 바디 하나당 주변 후보를 순회한다.

```text
sensor_possible = (self.sensor_mask & other.layer) != 0
overlap          = distance_squared < (self.radius + other.radius)²
```

둘 다 참이면 `(self_id, other_id, contact_position)`을 접촉 버퍼에 추가한다. 투사체 레이어는 이전 위치에서도 이미 겹쳤다면 같은 겹침을 다시 접촉으로 만들지 않는다. 이는 한 적에게 매 틱 반복 피해를 주는 것을 막지만, 이동 구간 전체를 검사하는 swept CCD는 아니다. 이전과 현재 위치가 모두 원 밖이면 중간을 통과해도 놓칠 수 있다.

반경이 큰 폭발·효과 영역은 여러 셀에 등록되고 [contacts_big_body_body.glsl](source/shaders/rigidbody/contacts_big_body_body.glsl)이 처리한다. 지형 센서 접촉은 SDF를 사용하는 [contacts_body_world.glsl](source/shaders/rigidbody/contacts_body_world.glsl)이 `other_id = -1` 형태로 생성한다.

## 5. `CLOSEST_ONLY`는 별도 축약 경로를 사용한다

Tesla와 같은 효과가 `ContactHandlerFlags.CLOSEST_ONLY`를 설정하면 즉시 접촉 버퍼에 쓰지 않는다. 후보를 임시 bucket에 넣은 뒤 [filter_contacts.glsl](source/shaders/rigidbody/filter_contacts.glsl)이 self ID별 가장 가까운 대상 하나만 최종 접촉으로 만든다.

참고 게임의 일반 총알은 이 플래그를 사용하지 않으므로 같은 틱에 겹친 모든 적에 대한 접촉이 생성될 수 있다. CirVivor의 data definition은 이 정책을 선택하며, 현재 benchmark 방사형 projectile fixture는 판정 QA를 위해 `closestOnly: true`를 사용한다.

## 6. 피해와 상태 효과를 병렬 처리한다

[handle_contacts.glsl](source/shaders/rigidbody/handle_contacts.glsl)은 최종 접촉마다 한 스레드를 실행한다.

- 적 체력은 정수 스케일로 변환해 `atomicAdd`로 감소
- 화상·감속·빙결 종료 시간은 주로 `atomicMax`로 갱신
- 피해 통계는 리드백 버퍼에 atomic 누적
- 연쇄 공격은 GPU addition 큐에 새 바디를 추가
- `damage_self`가 있으면 투사체 자체 체력도 감소
- 지형 접촉이고 `KILL_IF_OTHER_TERRAIN`이면 생존 플래그 제거

참고 구현은 타깃 피해 후에 투사체 체력을 감소시킨다. 여러 접촉이 동시에 실행되면 설정된 관통 횟수보다 많은 적을 같은 틱에 공격할 수 있다. CirVivor WGSL은 이를 그대로 복사하지 않고 위의 **선예약 → 성공한 hit만 적용 → 미적용 예약 refund** 순서로 보강했다. 자세한 원본 결함과 적용 상태는 [GPU Sim 개선 항목](../GPU_SIM_IMPROVEMENTS.md)을 참고한다.

## 7. 사망과 제거는 다음 틱까지 분리된다

[mark_dead.glsl](source/shaders/rigidbody/mark_dead.glsl)이 체력·수명·플래그를 검사해 사망 상태를 만든다. [handle_dead.glsl](source/shaders/rigidbody/handle_dead.glsl)은 다음 틱에 제거 목록과 사망 리드백을 작성하고, `gpu_sim.gd`의 removal 패스가 연속 배열을 다시 압축한다.

따라서 접촉 처리 중 즉시 배열에서 삭제하지 않는다. GPU 스레드가 참조 중인 body ID를 유지하면서 구조 변경을 틱 경계로 미루는 방식이다. CirVivor도 같은 안전 경계를 유지하지만 dense compaction 대신 GPU 즉시 hide와 CPU next-fixed stable-slot despawn을 사용한다.

## 물리 충돌과의 관계

[solve_body_body.glsl](source/shaders/rigidbody/solve_body_body.glsl)과 [solve_body_world.glsl](source/shaders/rigidbody/solve_body_world.glsl)은 `collision_mask`를 사용해 위치만 보정한다. 센서 접촉 버퍼나 피해 처리는 사용하지 않는다.

마스크는 각 바디 관점에서 평가되므로 비대칭 설정이 가능하다. 예를 들어 총알의 `collision_mask`가 0이어도 적의 마스크가 `PROJECTILES`를 포함하면 적 쪽 위치 보정은 발생할 수 있다.

## 관련 소스 빠른 찾기

| 단계 | 파일 |
|---|---|
| 총알 생성 예시 | [gunner.gd](source/towers/gunner/gunner.gd), [cannon.gd](source/towers/cannon/cannon.gd) |
| 레이어·마스크·직렬화 | [gpu_sim/rigidbody.gd](source/gpu_sim/rigidbody.gd) |
| 전체 패스 순서와 버퍼 | [globals/gpu_sim.gd](source/globals/gpu_sim.gd) |
| GPU 메모리 배치 | [shaders/bindings.gdshaderinc](source/shaders/bindings.gdshaderinc) |
| 추가·이동 예측 | [addition.glsl](source/shaders/rigidbody/addition.glsl), [integrate.glsl](source/shaders/rigidbody/integrate.glsl) |
| broad phase | [build_grid.glsl](source/shaders/rigidbody/build_grid.glsl) |
| 적·큰 영역·지형 접촉 | [contacts_body_body.glsl](source/shaders/rigidbody/contacts_body_body.glsl), [contacts_big_body_body.glsl](source/shaders/rigidbody/contacts_big_body_body.glsl), [contacts_body_world.glsl](source/shaders/rigidbody/contacts_body_world.glsl) |
| 최근접 축약 | [filter_contacts.glsl](source/shaders/rigidbody/filter_contacts.glsl) |
| 피해·관통·상태 효과 | [handle_contacts.glsl](source/shaders/rigidbody/handle_contacts.glsl) |
| 사망·제거 준비 | [mark_dead.glsl](source/shaders/rigidbody/mark_dead.glsl), [handle_dead.glsl](source/shaders/rigidbody/handle_dead.glsl) |
| 물리 위치 보정 | [solve_body_body.glsl](source/shaders/rigidbody/solve_body_body.glsl), [solve_body_world.glsl](source/shaders/rigidbody/solve_body_world.glsl) |

현재 CirVivor 경계:

| 책임 | 파일 |
|---|---|
| 안정 mixed-body endpoint와 projectile API | [`ingame/gpu_simulation_endpoint.js`](../../../project/game/script/module/ingame/gpu_simulation_endpoint.js) |
| data definition → spawn intent | [`gpu_projectile_spawn_adapter.js`](../../../project/game/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js) |
| stable identity/next-fixed lifecycle | [`enemy_lifecycle_command_owner.js`](../../../project/game/script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js), [`world_registry.js`](../../../project/game/script/module/ingame/object/world_registry.js) |
| ABI/fixed-point/contact handler | [`gpu_circle_body_abi.js`](../../../project/game/script/module/ingame/physics/gpu/gpu_circle_body_abi.js) |
| contact WGSL | [`gpu_collision_shaders.js`](../../../project/game/script/module/ingame/physics/gpu/gpu_collision_shaders.js) |
| bounded event readback/status | [`gpu_circle_body_simulation.js`](../../../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js) |
| benchmark radial projectile | [`gpu_benchmark_projectile_spawn_adapter.js`](../../../project/game/script/module/scene/benchmark/gpu_benchmark_projectile_spawn_adapter.js) |

`source/` 아래 파일은 `swhaop_source_code/`의 같은 상대 경로에서 복사한 분석용 스냅샷이다.
