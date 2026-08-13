import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE,
    createGpuCircleBodyAbiStorage,
    readGpuCircleEnemyBehaviorState,
    writeGpuCircleBodySpawn
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const { GPU_COLLISION_COMPUTE_WGSL } = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);
const {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

const SIMULATION_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const ABI_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_abi.js',
    import.meta.url
), 'utf8');

const CHARGE_CONFIG = Object.freeze({
    programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
    windupTicks: 30,
    windupRangeTiles: 3,
    chargeSpeedTilesPerSecond: 6,
    chargeMaxTicks: 60,
    recoilImpulseTilesPerSecond: 4,
    recoilTicks: 12,
    recoverTicks: 30,
    telegraphStyleCode: 1,
    telegraphColorRgba: Object.freeze([1, 0.82, 0.2, 1]),
    telegraphRadiusScale: 1.35
});

const EXPO_OUT_LAMBDA = 0.5;

function normalizedBoundedExpoOut(progress) {
    const boundedProgress = Math.min(Math.max(progress, 0), 1);
    if (boundedProgress <= 0) return 0;
    if (boundedProgress >= 1) return 1;
    return (1 - (2 ** (-EXPO_OUT_LAMBDA * boundedProgress)))
        / (1 - (2 ** -EXPO_OUT_LAMBDA));
}

function expoOutFixedTickDisplacements({ speed, durationTicks, fixedDelta }) {
    const safeDurationTicks = Math.max(durationTicks, 1);
    const totalDistance = speed * safeDurationTicks * fixedDelta;
    return Object.freeze(Array.from({ length: safeDurationTicks }, (_, elapsed) => (
        totalDistance * (
            normalizedBoundedExpoOut((elapsed + 1) / safeDurationTicks)
            - normalizedBoundedExpoOut(elapsed / safeDurationTicks)
        )
    )));
}

function assertNear(actual, expected, tolerance, label) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
    );
}

test('Body ABI v8은 기존 charge/atomic offset을 유지하고 capture side-plane을 append한다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI_VERSION, 8);
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 80);
    assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE, 40);
    assert.equal(GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE, 48);
    assert.equal(GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE, 48);
    assert.equal(GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE, 16);
    const storage = createGpuCircleBodyAbiStorage(2);
    assert.equal(storage.enemyBehaviorStateBuffer.byteLength, 160);
    assert.equal(storage.atomicTransformStateBuffer.byteLength, 96);
    assert.equal(storage.projectileCaptureStateBuffer.byteLength, 96);
    assert.equal(storage.projectileCaptureCandidateBuffer.byteLength, 32);

    const spawn = {
        position: { x: 1, y: 2 },
        velocity: { x: 0, y: 0 },
        radius: 0.25,
        inverseMass: 1,
        bodyLayer: 1,
        collisionMask: 0,
        interactionLayer: 1,
        interactionMask: 0,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        alive: true,
        enemyBehaviorState: CHARGE_CONFIG
    };
    writeGpuCircleBodySpawn(storage, 1, spawn);
    const state = readGpuCircleEnemyBehaviorState(storage, 1);
    assert.equal(state.programId, GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE);
    assert.equal(state.state, GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER);
    assert.equal(state.stateEnteredFixedTick, 0);
    assert.equal(state.stateExpiresAtFixedTick, 0);
    assert.equal(state.targetSlot, 0);
    assert.equal(state.targetEntityId, 0);
    assert.equal(state.targetIncarnation, 0);
    assert.equal(state.flags, 0);
    assert.deepEqual({ ...state.chargeDirection }, { x: 0, y: 0 });
    assert.equal(state.windupTicks, 30);
    assert.equal(state.chargeMaxTicks, 60);
    assert.equal(state.recoilTicks, 12);
    assert.equal(state.recoverTicks, 30);

    const stateOffset = GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE;
    const stateView = new DataView(storage.enemyBehaviorStateBuffer);
    stateView.setUint32(
        stateOffset + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE,
        GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CONTACT_RECOIL,
        true
    );
    stateView.setUint32(
        stateOffset + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.FLAGS,
        GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID
            | GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.RECOIL_PENDING,
        true
    );
    stateView.setFloat32(
        stateOffset + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_DIRECTION_X,
        1,
        true
    );
    writeGpuCircleBodySpawn(storage, 1, spawn);
    const replaced = readGpuCircleEnemyBehaviorState(storage, 1);
    assert.equal(replaced.state, GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER);
    assert.equal(replaced.flags, 0);
    assert.deepEqual({ ...replaced.chargeDirection }, { x: 0, y: 0 });

    writeGpuCircleBodySpawn(storage, 1, { ...spawn, enemyBehaviorState: undefined });
    assert.deepEqual(
        [...new Uint8Array(
            storage.enemyBehaviorStateBuffer,
            GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
            GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE
        )],
        new Array(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE).fill(0)
    );
});

test('charge state/event vocabulary와 exact [entered, expires) 경계를 고정한다', () => {
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_STATE }, {
        NONE: 0,
        SEEK_TOWER: 1,
        WINDUP: 2,
        CHARGE: 3,
        CONTACT_RECOIL: 4,
        RECOVER: 5,
        CORE_FALLBACK: 6,
        ORBIT_TOWER: 7
    });
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG }, {
        TARGET_VALID: 1,
        TELEGRAPH_PENDING: 2,
        RECOIL_PENDING: 4,
        SELECTED_TARGET_VALID: 8,
        SELECTED_TARGET_CORE: 16,
        SELECTED_TARGET_TOWER: 32,
        DIRECTIONAL_DEFENSE_ACTIVE: 64
    });
    assert.equal(GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED, 4);
    assert.equal(
        GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED,
        5
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_WINDUP[\s\S]*?params\.fixed_tick[\s\S]*?< enemy_behavior_states\.values\[body_id\]\.state_expires_at_fixed_tick/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_CHARGE[\s\S]*?params\.fixed_tick[\s\S]*?>= enemy_behavior_states\.values\[body_id\]\.state_expires_at_fixed_tick/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /ENEMY_BEHAVIOR_STATE_RECOVER[\s\S]*?ENEMY_BEHAVIOR_STATE_SEEK_TOWER[\s\S]*?return;/u
    );
});

test('Arrow SDF 가시성은 route ownership/WINDUP/terrain CHARGE 회복을 분리한다', () => {
    assert.equal(GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.ARROW_ROUTE_FALLBACK, undefined);
    assert.doesNotMatch(ABI_SOURCE, /ARROW_ROUTE_FALLBACK/u);
    const arrowAllowedKeysStart = ABI_SOURCE.indexOf('const allowedArrowKeys = new Set([');
    const arrowAllowedKeysEnd = ABI_SOURCE.indexOf(']);', arrowAllowedKeysStart);
    assert.ok(arrowAllowedKeysStart >= 0 && arrowAllowedKeysEnd > arrowAllowedKeysStart);
    assert.doesNotMatch(
        ABI_SOURCE.slice(arrowAllowedKeysStart, arrowAllowedKeysEnd),
        /['"]flags['"]/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const ENEMY_CHARGE_VISIBILITY_MAX_STEPS: u32 = 48u;[\s\S]*?fn enemy_charge_segment_is_visible\(body_id: u32, segment_end: vec2f\) -> bool[\s\S]*?params\.sdf_enabled == 0u[\s\S]*?for \(var step_index = 0u;[\s\S]*?return false;/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK: u32 = 128u;[\s\S]*?fn enter_enemy_charge_route_fallback[\s\S]*?ENEMY_BEHAVIOR_FLAG_TARGET_VALID[\s\S]*?ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER[\s\S]*?enemy_charge_segment_is_visible\(body_id, target_position\)[\s\S]*?behavior_flags[\s\S]*?ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK[\s\S]*?physics\.values\[body_id\]\.velocity = vec2f\(0\.0\);[\s\S]*?restore_enemy_route_flow\(body_id\)[\s\S]*?enter_enemy_charge_route_fallback\(body_id\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /enemy_charge_segment_is_visible\(body_id, target_position\)[\s\S]*?clear_enemy_charge_route_fallback_latch\(body_id\)[\s\S]*?disable_enemy_flow\(body_id\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_WINDUP[\s\S]*?enemy_charge_segment_is_visible\([\s\S]*?physics\.values\[body_id\]\.velocity = vec2f\(0\.0\);[\s\S]*?restore_enemy_route_flow\(body_id\)[\s\S]*?enter_enemy_charge_route_fallback\(body_id\)[\s\S]*?ENEMY_BEHAVIOR_STATE_SEEK_TOWER/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_CHARGE[\s\S]*?let charge_velocity = enemy_charge_expo_out_velocity\([\s\S]*?let charge_segment_end = physics\.values\[body_id\]\.position[\s\S]*?charge_velocity \* max\(params\.dt, 0\.0\)[\s\S]*?enemy_charge_segment_is_visible\([\s\S]*?charge_segment_end[\s\S]*?ENEMY_BEHAVIOR_STATE_RECOVER/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /if \(!tower_gameplay_target_is_valid\(\)\) \{[\s\S]*?physics\.values\[body_id\]\.velocity = vec2f\(0\.0\);[\s\S]*?enter_enemy_core_fallback\(body_id\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK[\s\S]*?physics\.values\[body_id\]\.velocity = vec2f\(0\.0\);[\s\S]*?clear_enemy_charge_route_fallback_latch\(body_id\)[\s\S]*?restore_enemy_route_flow\(body_id\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /state == ENEMY_BEHAVIOR_STATE_RECOVER[\s\S]*?clear_enemy_charge_route_fallback_latch\(body_id\)[\s\S]*?ENEMY_BEHAVIOR_STATE_SEEK_TOWER/u
    );
    const chargeStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'if (state == ENEMY_BEHAVIOR_STATE_CHARGE)'
    );
    const recoilResolverStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'fn resolve_enemy_charge_contacts'
    );
    assert.ok(chargeStart >= 0 && recoilResolverStart > chargeStart);
    assert.doesNotMatch(
        GPU_COLLISION_COMPUTE_WGSL.slice(chargeStart, recoilResolverStart),
        /APPLIED_EVENT_TYPE_ENEMY_CHARGE_CONTACT_RECOIL_STARTED/u
    );
});

test('Arrow charge/recoil Expo-out은 fixed tick endpoint와 first-last monotonic을 고정한다', () => {
    assert.equal(normalizedBoundedExpoOut(0), 0);
    assert.equal(normalizedBoundedExpoOut(1), 1);
    const fixedDelta = 1 / 60;
    const charge = expoOutFixedTickDisplacements({
        speed: CHARGE_CONFIG.chargeSpeedTilesPerSecond,
        durationTicks: CHARGE_CONFIG.chargeMaxTicks,
        fixedDelta
    });
    const recoil = expoOutFixedTickDisplacements({
        speed: CHARGE_CONFIG.recoilImpulseTilesPerSecond,
        durationTicks: CHARGE_CONFIG.recoilTicks - 1,
        fixedDelta
    });
    assert.ok(
        charge[0] < (1 / 8),
        `charge first fixed-tick displacement must stay below 1/8: ${charge[0]}`
    );
    assertNear(
        charge.reduce((sum, displacement) => sum + displacement, 0),
        CHARGE_CONFIG.chargeSpeedTilesPerSecond
            * CHARGE_CONFIG.chargeMaxTicks
            * fixedDelta,
        0.000000001,
        'charge normalized endpoint'
    );
    assertNear(
        recoil.reduce((sum, displacement) => sum + displacement, 0),
        CHARGE_CONFIG.recoilImpulseTilesPerSecond
            * (CHARGE_CONFIG.recoilTicks - 1)
            * fixedDelta,
        0.000000001,
        'recoil normalized endpoint'
    );
    for (const [label, displacements] of Object.entries({ charge, recoil })) {
        assert.ok(displacements[0] > displacements.at(-1), `${label} first > last`);
        for (let index = 1; index < displacements.length; index++) {
            assert.ok(
                displacements[index - 1] >= displacements[index],
                `${label} Expo-out displacement must be monotonic at ${index}`
            );
        }
    }
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const ENEMY_CHARGE_EXPO_OUT_LAMBDA: f32 = 0\.5;[\s\S]*?fn normalized_bounded_expo_out[\s\S]*?exp2\(-ENEMY_CHARGE_EXPO_OUT_LAMBDA \* bounded_progress\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enemy_charge_expo_out_velocity[\s\S]*?normalized_bounded_expo_out\(end_progress\)[\s\S]*?normalized_bounded_expo_out\(start_progress\)/u
    );
});

test('exact gameplay Tower config는 tracked pose와 독립이고 single-submit pass order를 유지한다', () => {
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /tower_gameplay_target\.target_slot[\s\S]*?tower_gameplay_target\.entity_id[\s\S]*?tower_gameplay_target\.incarnation[\s\S]*?body_id_is_alive[\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?GAMEPLAY_TEAM_PLAYER/u
    );
    const arrowGameplayStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'fn tower_gameplay_target_is_valid()'
    );
    const trackedPackStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'fn pack_tracked_pose()'
    );
    assert.ok(arrowGameplayStart >= 0 && trackedPackStart > arrowGameplayStart);
    assert.doesNotMatch(
        GPU_COLLISION_COMPUTE_WGSL.slice(
            arrowGameplayStart,
            trackedPackStart
        ),
        /tracked_pose_config/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL.slice(trackedPackStart),
        /tracked_pose_config\.source_slot[\s\S]*?tracked_pose_config\.entity_id[\s\S]*?tracked_pose_config\.incarnation/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /enemy_behavior_states\.values\[body_id\]\.charge_direction = direction/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /maximum_damage_window_policy_from_marker[\s\S]*?atomicExchange\([\s\S]*?ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn apply_enemy_charge_recoil[\s\S]*?enemy_charge_expo_out_velocity\([\s\S]*?-enemy_behavior_states\.values\[body_id\]\.charge_direction[\s\S]*?recoil_impulse/u
    );

    const advance = SIMULATION_SOURCE.indexOf("'advance_enemy_charge'");
    const handle = SIMULATION_SOURCE.indexOf("'handle_contacts'");
    const recoilContact = SIMULATION_SOURCE.indexOf("'resolve_enemy_charge_contacts'");
    const window = SIMULATION_SOURCE.indexOf("'resolve_maximum_damage_window'");
    const rebuild = SIMULATION_SOURCE.indexOf("'rebuild_velocities'");
    const recoil = SIMULATION_SOURCE.indexOf("'apply_enemy_charge_recoil'");
    assert.ok(advance >= 0 && handle > advance);
    assert.ok(recoilContact > handle && window > recoilContact);
    assert.ok(rebuild > window && recoil > rebuild);
    assert.match(SIMULATION_SOURCE, /enemyBehavior: 9/u);
    assert.match(
        SIMULATION_SOURCE,
        /compute-enemy-behavior-bodies-layout[\s\S]*?storageLayoutEntry\(0\)[\s\S]*?storageLayoutEntry\(1\)[\s\S]*?storageLayoutEntry\(2\)[\s\S]*?storageLayoutEntry\(11\)[\s\S]*?storageLayoutEntry\(13, 'read-only-storage'\)/u
    );
    assert.match(
        SIMULATION_SOURCE,
        /\[COMPUTE_PIPELINE_PROFILE\.ENEMY_BEHAVIOR\]: \[[\s\S]*?computeEnemyBehaviorBodiesLayout,[\s\S]*?computeWorldSdfLayout,[\s\S]*?computeParamsLayout,[\s\S]*?computeEnemyBehaviorEventsLayout/u
    );
    assert.match(
        SIMULATION_SOURCE,
        /\[COMPUTE_PIPELINE_PROFILE\.ENEMY_BEHAVIOR\]: \[[\s\S]*?computeEnemyBehaviorBodies,[\s\S]*?computeWorldSdf,[\s\S]*?computeParams,[\s\S]*?computeEnemyBehaviorEvents/u
    );
    assert.match(
        SIMULATION_SOURCE,
        /compute-tracked-pose-layout[\s\S]*?storageLayoutEntry\(8, 'read-only-storage'\)[\s\S]*?storageLayoutEntry\(9\)/u
    );
    assert.match(SIMULATION_SOURCE, /contactHandling: 9/u);
    assert.match(SIMULATION_SOURCE, /device\.queue\.submit\(\[encoder\.finish\(\)\]\)/u);
    const fixedGameplayStart = SIMULATION_SOURCE.indexOf(
        "this.#dispatchBodies(pass, 'apply_controlled_motion')"
    );
    const fixedGameplayEnd = SIMULATION_SOURCE.indexOf(
        'pass.end();',
        fixedGameplayStart
    );
    const fixedGameplayBlock = SIMULATION_SOURCE.slice(
        fixedGameplayStart,
        fixedGameplayEnd
    );
    assert.match(
        fixedGameplayBlock,
        /if \(!terminalFinalSubmit\) \{[\s\S]*?advance_enemy_charge/u
    );
    assert.match(
        fixedGameplayBlock,
        /clear_contact_state[\s\S]*?if \(!terminalFinalSubmit\) \{[\s\S]*?emit_enemy_charge_telegraphs[\s\S]*?handle_contacts[\s\S]*?resolve_enemy_charge_contacts[\s\S]*?resolve_maximum_damage_window[\s\S]*?mark_dead/u
    );
    assert.match(
        fixedGameplayBlock,
        /if \(!terminalFinalSubmit\) \{[\s\S]*?apply_enemy_charge_recoil/u
    );
});

console.log('GPU enemy Arrow charge contract: ok');
