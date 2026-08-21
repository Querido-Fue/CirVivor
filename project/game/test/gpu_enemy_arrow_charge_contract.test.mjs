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

const {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);
const {
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const { THE_TOWER_DATA } = await loadGameModule(
    'data/object/tower/the_tower_data.js'
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
const ENEMY_BACKEND_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_simulation_backend.js',
    import.meta.url
), 'utf8');
const NW_RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/runner.js',
    import.meta.url
), 'utf8');
const POST_R5_NW_RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/post_r5_live_bugfix_runner.js',
    import.meta.url
), 'utf8');

const CHARGE_CONFIG = Object.freeze({
    programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
    windupTicks: 30,
    windupRangeTiles: 3,
    chargeAccelerationTilesPerSecondSquared: 12,
    chargeSpeedTilesPerSecond: 6,
    chargeMaxTicks: 60,
    recoilImpulseTilesPerSecond: 4,
    recoilTicks: 12,
    recoverTicks: 30,
    telegraphStyleCode: 1,
    telegraphColorRgba: Object.freeze([1, 0.82, 0.2, 1]),
    telegraphRadiusScale: 1
});

const EXPO_OUT_LAMBDA = 10;

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

function acceleratedChargeSamples({
    acceleration,
    maximumSpeed,
    durationTicks,
    fixedDelta
}) {
    const accelerationF32 = Math.fround(acceleration);
    const maximumSpeedF32 = Math.fround(maximumSpeed);
    const fixedDeltaF32 = Math.fround(fixedDelta);
    let parallelSpeed = Math.fround(0);
    return Object.freeze(Array.from({ length: durationTicks }, () => {
        parallelSpeed = Math.fround(Math.min(
            Math.max(parallelSpeed, 0)
                + Math.fround(accelerationF32 * fixedDeltaF32),
            maximumSpeedF32
        ));
        return Object.freeze({
            parallelSpeed,
            displacement: Math.fround(parallelSpeed * fixedDeltaF32)
        });
    }));
}

function assertNear(actual, expected, tolerance, label) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
    );
}

test('Body ABI v9은 기존 offset 뒤에 Arrow acceleration tail을 append한다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI_VERSION, 9);
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 96);
    assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE, 40);
    assert.equal(GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE, 48);
    assert.equal(GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE, 48);
    assert.equal(GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE, 16);
    const storage = createGpuCircleBodyAbiStorage(2);
    assert.equal(storage.enemyBehaviorStateBuffer.byteLength, 192);
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
    assert.equal(state.chargeAccelerationTilesPerSecondSquared, 12);
    assert.equal(state.chargeSpeedTilesPerSecond, 6);
    assert.equal(state.windupTicks, 30);
    assert.equal(state.chargeMaxTicks, 60);
    assert.equal(state.recoilTicks, 12);
    assert.equal(state.recoverTicks, 30);
    const stateOffset = GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE;
    const binaryView = new DataView(storage.enemyBehaviorStateBuffer);
    assert.equal(
        binaryView.getFloat32(
            stateOffset
                + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_ACCELERATION,
            true
        ),
        12
    );
    for (const reservedField of ['RESERVED_0', 'RESERVED_1', 'RESERVED_2']) {
        assert.equal(
            binaryView.getUint32(
                stateOffset
                    + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE[reservedField],
                true
            ),
            0
        );
    }
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
        /state == ENEMY_BEHAVIOR_STATE_CHARGE[\s\S]*?let charge_velocity = enemy_charge_accelerated_velocity\([\s\S]*?body_id[\s\S]*?charge_direction[\s\S]*?let charge_segment_end = physics\.values\[body_id\]\.position[\s\S]*?charge_velocity \* max\(params\.dt, 0\.0\)[\s\S]*?enemy_charge_segment_is_visible\([\s\S]*?charge_segment_end[\s\S]*?ENEMY_BEHAVIOR_STATE_RECOVER/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /if \(!tower_target_query_is_valid\(body_id\)\) \{[\s\S]*?physics\.values\[body_id\]\.velocity = vec2f\(0\.0\);[\s\S]*?enter_enemy_core_fallback\(body_id\)/u
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

test('Arrow CHARGE는 data-owned acceleration/cap이고 recoil만 λ=10 Expo-out이다', () => {
    assert.equal(normalizedBoundedExpoOut(0), 0);
    assert.equal(normalizedBoundedExpoOut(1), 1);
    const fixedDelta = 1 / 60;
    const charge = acceleratedChargeSamples({
        acceleration: CHARGE_CONFIG.chargeAccelerationTilesPerSecondSquared,
        maximumSpeed: CHARGE_CONFIG.chargeSpeedTilesPerSecond,
        durationTicks: CHARGE_CONFIG.chargeMaxTicks,
        fixedDelta
    });
    const recoil = expoOutFixedTickDisplacements({
        speed: CHARGE_CONFIG.recoilImpulseTilesPerSecond,
        durationTicks: CHARGE_CONFIG.recoilTicks - 1,
        fixedDelta
    });
    const exactChargeSamples = Object.freeze({
        k0: Object.freeze({ speed: 0.20000001788139343,
            displacement: 0.0033333338797092438 }),
        k1: Object.freeze({ speed: 0.40000003576278687,
            displacement: 0.0066666677594184875 }),
        middle: Object.freeze({ speed: 6,
            displacement: 0.10000000894069672 }),
        end: Object.freeze({ speed: 6,
            displacement: 0.10000000894069672 })
    });
    for (const [label, index] of Object.entries({
        k0: 0,
        k1: 1,
        middle: 30,
        end: 59
    })) {
        assertNear(
            charge[index].parallelSpeed,
            exactChargeSamples[label].speed,
            0.000000000001,
            `charge ${label} speed`
        );
        assertNear(
            charge[index].displacement,
            exactChargeSamples[label].displacement,
            0.000000000001,
            `charge ${label} displacement`
        );
    }
    assertNear(
        charge.reduce((sum, sample) => sum + sample.displacement, 0),
        4.550000344403088,
        0.000000001,
        'charge deterministic 60 Hz distance'
    );
    assert.ok(charge[0].displacement < charge[30].displacement);
    for (let index = 1; index < charge.length; index++) {
        assert.ok(
            charge[index].parallelSpeed >= charge[index - 1].parallelSpeed,
            `charge speed must be monotonic at ${index}`
        );
        assert.ok(
            charge[index].parallelSpeed
                <= CHARGE_CONFIG.chargeSpeedTilesPerSecond,
            `charge speed must respect cap at ${index}`
        );
    }
    for (const direction of [
        Object.freeze({ x: 1, y: 0 }),
        Object.freeze({ x: 0, y: -1 }),
        Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 })
    ]) {
        const velocity = {
            x: direction.x * charge[15].parallelSpeed,
            y: direction.y * charge[15].parallelSpeed
        };
        assertNear(
            Math.hypot(velocity.x, velocity.y),
            charge[15].parallelSpeed,
            0.000001,
            'cardinal/diagonal locked direction speed'
        );
    }
    assertNear(
        recoil.reduce((sum, displacement) => sum + displacement, 0),
        CHARGE_CONFIG.recoilImpulseTilesPerSecond
            * (CHARGE_CONFIG.recoilTicks - 1)
            * fixedDelta,
        0.000000001,
        'recoil normalized endpoint'
    );
    const exactRecoilSamples = Object.freeze({
        k0: 0.34315337792597783,
        k1: 0.18273622373564335,
        middle: 0.014695017792215683,
        end: 0.0006292916281888402
    });
    for (const [label, index] of Object.entries({
        k0: 0,
        k1: 1,
        middle: 5,
        end: 10
    })) {
        assertNear(
            recoil[index],
            exactRecoilSamples[label],
            0.000000000001,
            `recoil ${label}`
        );
    }
    for (let index = 1; index < recoil.length; index++) {
        assert.ok(
            recoil[index - 1] >= recoil[index],
            `recoil Expo-out displacement must be monotonic at ${index}`
        );
    }
    const maximumChargeDisplacement = Math.max(
        ...charge.map((sample) => sample.displacement)
    );
    const maximumRelativeTowerStep = maximumChargeDisplacement
        + (THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND * fixedDelta);
    const towerInteractionInterval = 2 * (
        MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES + THE_TOWER_DATA.RADIUS_TILES
    );
    assert.ok(
        maximumRelativeTowerStep < towerInteractionInterval,
        `acceleration/cap step must not skip the full Arrow/Tower overlap interval: ${JSON.stringify({
            maximumRelativeTowerStep,
            towerInteractionInterval
        })}`
    );
    assert.match(
        ENEMY_BACKEND_SOURCE,
        /const SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO = 1 \/ 8;/u
    );
    const minimumSdfMarchStepTiles = (1 / 8) * 0.25;
    assert.ok(
        Math.ceil(maximumChargeDisplacement / minimumSdfMarchStepTiles) < 48,
        `maximum charge segment must fit the bounded production SDF marcher: ${maximumChargeDisplacement}`
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const ENEMY_RECOIL_EXPO_OUT_LAMBDA: f32 = 10\.0;[\s\S]*?fn normalized_bounded_recoil_expo_out[\s\S]*?exp2\(-ENEMY_RECOIL_EXPO_OUT_LAMBDA \* bounded_progress\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enemy_recoil_expo_out_velocity[\s\S]*?normalized_bounded_recoil_expo_out\(end_progress\)[\s\S]*?normalized_bounded_recoil_expo_out\(start_progress\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enemy_charge_accelerated_velocity\([\s\S]*?max\(dot\(current_velocity, locked_direction\), 0\.0\)[\s\S]*?charge_acceleration[\s\S]*?max\(params\.dt, 0\.0\)[\s\S]*?enemy_behavior_states\.values\[body_id\]\.charge_speed/u
    );
    const chargeStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'if (state == ENEMY_BEHAVIOR_STATE_CHARGE)'
    );
    const recoilStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'if (state == ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL)',
        chargeStart
    );
    const chargeBlock = GPU_COLLISION_COMPUTE_WGSL.slice(
        chargeStart,
        recoilStart
    );
    assert.match(chargeBlock, /enemy_charge_accelerated_velocity/u);
    assert.doesNotMatch(chargeBlock, /enemy_recoil_expo_out_velocity/u);
    assert.doesNotMatch(chargeBlock, /target_position/u);
    assert.match(
        POST_R5_NW_RUNNER_SOURCE,
        /async function runArrowR2Fixture[\s\S]*?chargeAccelerationTilesPerSecondSquared,[\s\S]*?12, 0\.000001[\s\S]*?chargeSpeedTilesPerSecond,[\s\S]*?6, 0\.000001/u
    );
    assert.match(
        POST_R5_NW_RUNNER_SOURCE,
        /sample\.speed > 0 && sample\.speed <= 6\.0001[\s\S]*?near\(chargeSamples\[0\]\.speed, 12 \/ 60[\s\S]*?chargeSamples\[0\]\.displacement[\s\S]*?< chargeSamples\[Math\.floor\(chargeSamples\.length \/ 2\)\]\.displacement/u
    );
    assert.match(
        POST_R5_NW_RUNNER_SOURCE,
        /chargeSamples\.length === 1 && !movedTower[\s\S]*?behavior\.chargeDirection\.x, lockedDirection\.x[\s\S]*?behavior\.chargeDirection\.y, lockedDirection\.y/u
    );
});

test('Arrow 본체 반경은 WINDUP/effect tag와 무관하고 telegraph는 color/halo만 바꾼다', () => {
    const pulseStart = GPU_COLLISION_RENDER_WGSL.indexOf(
        'if (effect_identity_matches'
    );
    const arrowWindupStart = GPU_COLLISION_RENDER_WGSL.indexOf(
        'if (behavior.program_id == ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE'
    );
    const directionalDefenseStart = GPU_COLLISION_RENDER_WGSL.indexOf(
        'let directional_defense_active',
        arrowWindupStart
    );
    assert.ok(
        pulseStart >= 0
            && arrowWindupStart > pulseStart
            && directionalDefenseStart > arrowWindupStart
    );
    const pulseBlock = GPU_COLLISION_RENDER_WGSL.slice(
        pulseStart,
        arrowWindupStart
    );
    const arrowWindupBlock = GPU_COLLISION_RENDER_WGSL.slice(
        arrowWindupStart,
        directionalDefenseStart
    );
    assert.match(
        pulseBlock,
        /behavior\.program_id != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE/u
    );
    assert.match(arrowWindupBlock, /presentation_color = unpack_rgba8/u);
    assert.doesNotMatch(arrowWindupBlock, /presentation_radius_scale/u);
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /let world_position = body_position[\s\S]*?local \* body\.radius \* presentation_radius_scale/u
    );
    assert.match(
        NW_RUNNER_SOURCE,
        /assertArrowSizeInvariant[\s\S]*?BASIC_ARROW_ENEMY_DATA\.collisionRadiusTiles[\s\S]*?behavior\?\.telegraphRadiusScale === 1/u
    );
});

test('source-local Tower query는 tracked pose와 독립이고 single-submit pass order를 유지한다', () => {
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn tower_target_query_is_valid\(source_body_id: u32\)[\s\S]*?query\.source_entity_id[\s\S]*?simulations\.values\[source_body_id\]\.entity_id[\s\S]*?query\.source_incarnation[\s\S]*?simulations\.values\[source_body_id\]\.incarnation[\s\S]*?query\.target_slot[\s\S]*?query\.target_entity_id[\s\S]*?query\.target_incarnation[\s\S]*?body_id_is_alive[\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?GAMEPLAY_TEAM_PLAYER/u
    );
    const arrowGameplayStart = GPU_COLLISION_COMPUTE_WGSL.indexOf(
        'fn tower_target_query_is_valid(source_body_id: u32)'
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
        /fn apply_enemy_charge_recoil[\s\S]*?enemy_recoil_expo_out_velocity\([\s\S]*?-enemy_behavior_states\.values\[body_id\]\.charge_direction[\s\S]*?recoil_impulse/u
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
