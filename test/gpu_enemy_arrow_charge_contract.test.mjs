import { readGpuCircleImplementationSource } from './support/gpu_circle_source.mjs';
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
    GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS,
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
const { THE_TOWER_DATA } = await loadGameModule(
    'data/object/tower/the_tower_data.js'
);
const {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

const SIMULATION_SOURCE = await readGpuCircleImplementationSource();
const ABI_SOURCE = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_abi.js',
    import.meta.url
), 'utf8');
const NW_RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/runner.js',
    import.meta.url
), 'utf8');

const CHARGE_CONFIG = Object.freeze({
    programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
    windupTicks: 30,
    windupRangeTiles: 3,
    chargeSpeedTilesPerSecond: 6,
    chargeMaxTicks: 60,
    impactRestitution: 0.55,
    impactTangentialRetention: 0.85,
    recoilDamping: 0.9,
    recoilSleepThresholdTilesPerSecond: 0.05,
    recoilTicks: 12,
    recoverTicks: 30,
    telegraphStyleCode: 1,
    telegraphColorRgba: Object.freeze([1, 0.82, 0.2, 1]),
    telegraphRadiusScale: 1
});

function assertNear(actual, expected, tolerance, label) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`
    );
}

function extractFunction(source, name) {
    const signature = new RegExp(`fn\\s+${name}\\b`, 'u');
    const match = signature.exec(source);
    assert.ok(match, `${name} function이 없습니다.`);
    const openBrace = source.indexOf('{', match.index);
    assert.ok(openBrace >= 0, `${name} body가 없습니다.`);
    let depth = 1;
    let cursor = openBrace + 1;
    while (cursor < source.length && depth > 0) {
        if (source[cursor] === '{') depth++;
        if (source[cursor] === '}') depth--;
        cursor++;
    }
    assert.equal(depth, 0, `${name} body brace가 닫히지 않았습니다.`);
    return source.slice(match.index, cursor);
}

function normalize(vector) {
    const length = Math.hypot(vector.x, vector.y);
    assert.ok(length > 0);
    return Object.freeze({ x: vector.x / length, y: vector.y / length });
}

function dot(left, right) {
    return left.x * right.x + left.y * right.y;
}

function add(left, right) {
    return Object.freeze({ x: left.x + right.x, y: left.y + right.y });
}

function scale(vector, scalar) {
    return Object.freeze({ x: vector.x * scalar, y: vector.y * scalar });
}

function subtract(left, right) {
    return add(left, scale(right, -1));
}

function resolveImpactOracle({
    arrowVelocity,
    towerVelocity,
    towerToArrowNormal,
    arrowInverseMass,
    towerInverseMass,
    restitution,
    tangentialRetention,
    sleepThreshold = 0
}) {
    const normal = normalize(towerToArrowNormal);
    const relativeVelocity = subtract(arrowVelocity, towerVelocity);
    const normalSpeed = dot(relativeVelocity, normal);
    const inverseMassSum = arrowInverseMass + towerInverseMass;
    if (inverseMassSum <= 0 || normalSpeed >= -sleepThreshold) {
        return Object.freeze({
            normal,
            relativeVelocity,
            normalSpeed,
            impulse: Object.freeze({ x: 0, y: 0 }),
            arrowVelocity,
            towerVelocity
        });
    }
    const tangent = subtract(relativeVelocity, scale(normal, normalSpeed));
    const normalImpulseMagnitude = -(1 + restitution)
        * normalSpeed / inverseMassSum;
    const tangentialImpulse = scale(
        tangent,
        (tangentialRetention - 1) / inverseMassSum
    );
    const impulse = add(
        scale(normal, normalImpulseMagnitude),
        tangentialImpulse
    );
    return Object.freeze({
        normal,
        relativeVelocity,
        normalSpeed,
        impulse,
        arrowVelocity: add(arrowVelocity, scale(impulse, arrowInverseMass)),
        towerVelocity: add(towerVelocity, scale(impulse, -towerInverseMass))
    });
}

test('Body ABI v10은 direct-speed/impact data와 transient evidence plane을 고정한다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI_VERSION, 10);
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 96);
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_CHARGE_IMPACT_STATUS }, {
        EMPTY: 0,
        CAPTURED: 1,
        RESOLVED: 2
    });
    assert.deepEqual({ ...GPU_CIRCLE_BODY_ABI.ENEMY_CHARGE_IMPACT_STATE }, {
        STRIDE: 72,
        SELECTED_CONTACT_INDEX: 0,
        STATUS: 4,
        CAPTURED_FIXED_TICK: 8,
        ARROW_SLOT: 12,
        TOWER_SLOT: 16,
        ARROW_ENTITY_ID: 20,
        ARROW_INCARNATION: 24,
        TOWER_ENTITY_ID: 28,
        TOWER_INCARNATION: 32,
        ALIGNMENT_PADDING: 36,
        CONTACT_NORMAL_X: 40,
        CONTACT_NORMAL_Y: 44,
        PRE_IMPACT_RELATIVE_VELOCITY_X: 48,
        PRE_IMPACT_RELATIVE_VELOCITY_Y: 52,
        ARROW_INVERSE_MASS: 56,
        TOWER_INVERSE_MASS: 60,
        VELOCITY_DELTA_X_FIXED_POINT: 64,
        VELOCITY_DELTA_Y_FIXED_POINT: 68
    });

    const storage = createGpuCircleBodyAbiStorage(2);
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
    assert.equal(state.chargeSpeedTilesPerSecond, 6);
    assert.equal(state.impactRestitution, Math.fround(0.55));
    assert.equal(state.impactTangentialRetention, Math.fround(0.85));
    assert.equal(state.recoilDamping, Math.fround(0.9));
    assert.equal(state.recoilSleepThresholdTilesPerSecond, Math.fround(0.05));
    const offset = GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE;
    const view = new DataView(storage.enemyBehaviorStateBuffer);
    assert.equal(view.getFloat32(
        offset + GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE
            .DEPRECATED_CHARGE_ACCELERATION,
        true
    ), 0);
    assert.throws(() => writeGpuCircleBodySpawn(storage, 1, {
        ...spawn,
        enemyBehaviorState: {
            ...CHARGE_CONFIG,
            chargeAccelerationTilesPerSecondSquared: 12
        }
    }), /알 수 없는 필드|사용할 수 없는 config/u);
});

test('WINDUP 종료는 authored charge speed를 한 번만 부여하고 CHARGE는 재적용하지 않는다', () => {
    const advance = extractFunction(GPU_COLLISION_COMPUTE_WGSL, 'advance_enemy_charge');
    assert.match(
        advance,
        /enemy_behavior_states\.values\[body_id\]\.charge_direction = direction[\s\S]*?ENEMY_BEHAVIOR_STATE_CHARGE[\s\S]*?physics\.values\[body_id\]\.velocity = direction[\s\S]*?\* enemy_behavior_states\.values\[body_id\]\.charge_speed/u
    );
    const chargeStart = advance.indexOf(
        'if (state == ENEMY_BEHAVIOR_STATE_CHARGE)'
    );
    const recoilStart = advance.indexOf(
        'if (state == ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL)',
        chargeStart
    );
    const chargeBlock = advance.slice(chargeStart, recoilStart);
    assert.match(chargeBlock, /let charge_velocity = physics\.values\[body_id\]\.velocity/u);
    assert.doesNotMatch(chargeBlock, /charge_acceleration|accelerated_velocity/u);
    assert.doesNotMatch(
        chargeBlock,
        /physics\.values\[body_id\]\.velocity = charge_velocity/u
    );
    assert.doesNotMatch(GPU_COLLISION_COMPUTE_WGSL, /normalized_bounded_recoil|Expo-out|exp2\(/u);
    assert.doesNotMatch(GPU_COLLISION_COMPUTE_WGSL, /enemy_recoil_expo_out_velocity/u);
    assert.match(
        advance,
        /ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL[\s\S]*?damp_enemy_charge_recoil_velocity\(body_id\)[\s\S]*?enemy_charge_target_is_separated\(body_id\)[\s\S]*?ENEMY_BEHAVIOR_STATE_RECOVER/u
    );
    const authoredSpeed = CHARGE_CONFIG.chargeSpeedTilesPerSecond;
    for (const direction of [
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    ]) {
        assertNear(
            Math.hypot(direction.x * authoredSpeed, direction.y * authoredSpeed),
            authoredSpeed,
            0.000001,
            'charge entry speed'
        );
    }
});

test('impact oracle는 normal/relative velocity/inverse mass/restitution/tangent를 보존한다', () => {
    const frontal = resolveImpactOracle({
        arrowVelocity: { x: 6, y: 0 },
        towerVelocity: { x: 0, y: 0 },
        towerToArrowNormal: { x: -1, y: 0 },
        arrowInverseMass: 1,
        towerInverseMass: 1 / THE_TOWER_DATA.WEIGHT,
        restitution: CHARGE_CONFIG.impactRestitution,
        tangentialRetention: CHARGE_CONFIG.impactTangentialRetention
    });
    const frontalRelativeAfter = subtract(
        frontal.arrowVelocity,
        frontal.towerVelocity
    );
    assertNear(
        dot(frontalRelativeAfter, frontal.normal),
        -CHARGE_CONFIG.impactRestitution * frontal.normalSpeed,
        0.0000001,
        'frontal restitution'
    );
    assert.ok(
        Math.abs(frontal.arrowVelocity.x - 6)
            > Math.abs(frontal.towerVelocity.x),
        '무거운 Tower의 velocity delta가 Arrow보다 작아야 합니다.'
    );
    const arrowMass = 1;
    const towerMass = THE_TOWER_DATA.WEIGHT;
    assertNear(
        arrowMass * (frontal.arrowVelocity.x - 6),
        -towerMass * frontal.towerVelocity.x,
        0.0000001,
        'equal/opposite impulse momentum'
    );

    const movingHeadOn = resolveImpactOracle({
        arrowVelocity: { x: 6, y: 0 },
        towerVelocity: { x: 2, y: 0 },
        towerToArrowNormal: { x: -1, y: 0 },
        arrowInverseMass: 1,
        towerInverseMass: 1 / THE_TOWER_DATA.WEIGHT,
        restitution: CHARGE_CONFIG.impactRestitution,
        tangentialRetention: CHARGE_CONFIG.impactTangentialRetention
    });
    assertNear(
        movingHeadOn.normalSpeed,
        -4,
        0.0000001,
        'moving Tower pre-impact relative normal speed'
    );
    assertNear(
        dot(
            subtract(movingHeadOn.arrowVelocity, movingHeadOn.towerVelocity),
            movingHeadOn.normal
        ),
        -CHARGE_CONFIG.impactRestitution * movingHeadOn.normalSpeed,
        0.0000001,
        'moving Tower restitution'
    );

    const glancing = resolveImpactOracle({
        arrowVelocity: { x: 6, y: 2 },
        towerVelocity: { x: 1, y: 0.5 },
        towerToArrowNormal: { x: -1, y: 0 },
        arrowInverseMass: 1,
        towerInverseMass: 0.1,
        restitution: CHARGE_CONFIG.impactRestitution,
        tangentialRetention: CHARGE_CONFIG.impactTangentialRetention
    });
    const glancingRelativeAfter = subtract(
        glancing.arrowVelocity,
        glancing.towerVelocity
    );
    const tangent = { x: 0, y: 1 };
    assertNear(
        dot(glancingRelativeAfter, tangent),
        CHARGE_CONFIG.impactTangentialRetention
            * dot(glancing.relativeVelocity, tangent),
        0.0000001,
        'glancing tangential retention'
    );
    const separating = resolveImpactOracle({
        arrowVelocity: { x: -1, y: 0 },
        towerVelocity: { x: 0, y: 0 },
        towerToArrowNormal: { x: -1, y: 0 },
        arrowInverseMass: 1,
        towerInverseMass: 0.1,
        restitution: 1,
        tangentialRetention: 0
    });
    assert.deepEqual({ ...separating.impulse }, { x: 0, y: 0 });
    const nearZero = resolveImpactOracle({
        arrowVelocity: { x: 1, y: 0 },
        towerVelocity: { x: 0.96, y: 0 },
        towerToArrowNormal: { x: -1, y: 0 },
        arrowInverseMass: 1,
        towerInverseMass: 0.1,
        restitution: 1,
        tangentialRetention: 0,
        sleepThreshold: CHARGE_CONFIG.recoilSleepThresholdTilesPerSecond
    });
    assertNear(nearZero.normalSpeed, -0.04, 0.0000001, 'near-zero normal speed');
    assert.deepEqual({ ...nearZero.impulse }, { x: 0, y: 0 });
});

test('WGSL impact는 pre-marker evidence를 deterministic claim하고 exact-once 적용한다', () => {
    const selectImpact = extractFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'select_enemy_charge_impact_contacts'
    );
    const materializeImpact = extractFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'materialize_enemy_charge_impact_evidence'
    );
    const resolveImpact = extractFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'resolve_enemy_charge_contacts'
    );
    const applyImpact = extractFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'apply_enemy_charge_impact_impulses'
    );
    assert.match(selectImpact, /atomicMin\([\s\S]*?selected_contact_index[\s\S]*?contact_index/u);
    assert.match(
        materializeImpact,
        /tower_to_arrow_normal = -contact\.normal[\s\S]*?relative_velocity = physics\.values\[arrow_slot\]\.velocity[\s\S]*?- physics\.values\[tower_slot\]\.velocity[\s\S]*?ENEMY_CHARGE_IMPACT_STATUS_CAPTURED/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /var normal = -deterministic_separation_normal\([\s\S]*?if \(distance_squared > EPSILON_DISTANCE_SQUARED\)[\s\S]*?normal = delta \* inverse_distance/u
    );
    assert.match(
        resolveImpact,
        /normal_speed = dot\(relative_velocity, normal\)[\s\S]*?normal_speed < -sleep_threshold[\s\S]*?normal_impulse_magnitude = -\(1\.0 \+ restitution\)[\s\S]*?\/ inverse_mass_sum[\s\S]*?tangential_retention - 1\.0[\s\S]*?arrow_velocity_delta = impulse \* arrow_inverse_mass[\s\S]*?tower_velocity_delta = -impulse \* tower_inverse_mass/u
    );
    assert.match(resolveImpact, /atomicCompareExchangeWeak\([\s\S]*?ENEMY_BEHAVIOR_STATE_CHARGE[\s\S]*?ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL/u);
    assert.match(applyImpact, /atomicExchange\([\s\S]*?velocity_delta_x_fixed_point[\s\S]*?atomicExchange\([\s\S]*?velocity_delta_y_fixed_point/u);
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn shield_unselected_enemy_charge_contacts[\s\S]*?ENEMY_CHARGE_DISARMED_SHIELD[\s\S]*?fn handle_contacts[\s\S]*?atomic_transform_marker == ENEMY_CHARGE_DISARMED_SHIELD/u
    );
    assert.equal(
        (GPU_COLLISION_COMPUTE_WGSL.match(
            /fn apply_enemy_charge_impact_impulses\b/gu
        ) ?? []).length,
        1
    );
});

test('single submit은 capture-before-marker와 post-reconstruction exact-once 순서를 고정한다', () => {
    const fixedStart = SIMULATION_SOURCE.indexOf(
        "this.#dispatchBodies(pass, 'apply_controlled_motion')"
    );
    const fixedEnd = SIMULATION_SOURCE.indexOf('pass.end();', fixedStart);
    const block = SIMULATION_SOURCE.slice(fixedStart, fixedEnd);
    const order = [
        'clear_enemy_charge_impact_states',
        'generate_body_contacts',
        'select_enemy_charge_impact_contacts',
        'materialize_enemy_charge_impact_evidence',
        'classify_directional_defense_contacts',
        'shield_unselected_enemy_charge_contacts',
        'handle_contacts',
        'resolve_enemy_charge_contacts',
        'resolve_maximum_damage_window',
        'rebuild_velocities',
        'finalize_velocities',
        'finalize_controlled_motion',
        'apply_enemy_charge_impact_impulses'
    ];
    let previous = -1;
    for (const entryPoint of order) {
        const index = block.indexOf(entryPoint);
        assert.ok(index > previous, `${entryPoint} dispatch 순서가 잘못되었습니다.`);
        previous = index;
    }
    assert.equal(
        (block.match(/apply_enemy_charge_impact_impulses/gu) ?? []).length,
        1
    );
    assert.match(
        SIMULATION_SOURCE,
        /compute-enemy-charge-impact-bodies-layout[\s\S]*?storageLayoutEntry\(0\)[\s\S]*?storageLayoutEntry\(1\)[\s\S]*?storageLayoutEntry\(2\)[\s\S]*?storageLayoutEntry\(11\)[\s\S]*?storageLayoutEntry\(13, 'read-only-storage'\)[\s\S]*?storageLayoutEntry\(16\)/u
    );
    assert.match(SIMULATION_SOURCE, /storageBuffersPerStage: 9/u);
    assert.match(SIMULATION_SOURCE, /device\.queue\.submit\(\[encoder\.finish\(\)\]\)/u);

    const solveBody = extractFunction(GPU_COLLISION_COMPUTE_WGSL, 'solve_body_body');
    const solveWorld = extractFunction(GPU_COLLISION_COMPUTE_WGSL, 'solve_body_world');
    assert.doesNotMatch(solveBody, /physics\.values\[[^\]]+\]\.velocity\s*[+\-]?=/u);
    assert.doesNotMatch(solveWorld, /physics\.values\[[^\]]+\]\.velocity\s*[+\-]?=/u);
    assert.match(solveBody, /position_delta/u);
    assert.match(solveWorld, /position_delta/u);
});

test('state/event vocabulary, SDF fallback, presentation size는 기존 계약을 보존한다', () => {
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
    assert.equal(GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.RECOIL_PENDING, 4);
    assert.equal(GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_WINDUP_STARTED, 4);
    assert.equal(
        GPU_CIRCLE_APPLIED_EVENT_TYPE.ENEMY_CHARGE_CONTACT_RECOIL_STARTED,
        5
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enemy_charge_segment_is_visible\(body_id: u32, segment_end: vec2f\) -> bool[\s\S]*?ENEMY_CHARGE_VISIBILITY_MAX_STEPS[\s\S]*?return false;/u
    );
    assert.doesNotMatch(ABI_SOURCE, /'chargeAccelerationTilesPerSecondSquared'/u);
    const arrowWindupStart = GPU_COLLISION_RENDER_WGSL.indexOf(
        'if (behavior.program_id == ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE'
    );
    const defenseStart = GPU_COLLISION_RENDER_WGSL.indexOf(
        'let directional_defense_active',
        arrowWindupStart
    );
    const windupPresentation = GPU_COLLISION_RENDER_WGSL.slice(
        arrowWindupStart,
        defenseStart
    );
    assert.match(windupPresentation, /presentation_color = unpack_rgba8/u);
    assert.doesNotMatch(windupPresentation, /presentation_radius_scale/u);
    assert.match(
        NW_RUNNER_SOURCE,
        /assertArrowSizeInvariant[\s\S]*?behavior\?\.telegraphRadiusScale === 1/u
    );
});

console.log('GPU enemy Arrow direct-speed/impact contract: ok');
