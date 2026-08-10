import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { THE_TOWER_DATA } = await loadGameModule(
    'data/object/tower/the_tower_data.js'
);
const { TheTower } = await loadGameModule('ingame/object/the_tower.js');
const { GPU_COLLISION_COMPUTE_WGSL } = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);

const FIXED_DELTA = 1 / 60;
const FIXED_DELTA_F32 = Math.fround(FIXED_DELTA);
const INVERSE_FIXED_DELTA_F32 = Math.fround(1 / FIXED_DELTA_F32);
const ONE_TICK_VELOCITY_TOLERANCE = 0.00002;
const ONE_TICK_POSITION_TOLERANCE = 0.000002;
const LONG_RUN_VELOCITY_TOLERANCE = 0.006;
const LONG_RUN_POSITION_TOLERANCE = 0.003;

const shaderSource = await readFile(
    new URL(
        '../script/module/ingame/physics/gpu/gpu_collision_shaders.js',
        import.meta.url
    ),
    'utf8'
);

function f32(value) {
    return Math.fround(value);
}

function multiplyF32(left, right) {
    return f32(f32(left) * f32(right));
}

function addF32(left, right) {
    return f32(f32(left) + f32(right));
}

function normalizeControlIntent(x, y) {
    let nextX = Number.isFinite(Number(x)) ? Number(x) : 0;
    let nextY = Number.isFinite(Number(y)) ? Number(y) : 0;
    const magnitude = Math.hypot(nextX, nextY);
    if (magnitude > 1) {
        nextX /= magnitude;
        nextY /= magnitude;
    }
    return { x: f32(nextX), y: f32(nextY) };
}

function clampReferenceVelocity(velocity) {
    const maximumSpeed = f32(
        THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
    );
    const speedSquared = addF32(
        multiplyF32(velocity.x, velocity.x),
        multiplyF32(velocity.y, velocity.y)
    );
    const speed = f32(Math.sqrt(speedSquared));
    if (speed > maximumSpeed) {
        const scale = f32(maximumSpeed / speed);
        velocity.x = multiplyF32(velocity.x, scale);
        velocity.y = multiplyF32(velocity.y, scale);
    }
}

/**
 * apply_controlled_motion → prepare_bodies → rebuild_velocities →
 * finalize_controlled_motion의 collision-free f32 경로를 재현합니다.
 */
function stepGpuReference(state, rawIntent) {
    const intent = normalizeControlIntent(rawIntent.x, rawIntent.y);
    const friction = f32(THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND);
    const acceleration = f32(
        THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
    );
    const exponent = f32(-multiplyF32(friction, FIXED_DELTA_F32));
    const decay = f32(Math.exp(exponent));
    const accelerationScale = f32(f32(1 - decay) / friction);
    const acceleratedX = multiplyF32(
        multiplyF32(intent.x, acceleration),
        accelerationScale
    );
    const acceleratedY = multiplyF32(
        multiplyF32(intent.y, acceleration),
        accelerationScale
    );
    const velocity = {
        x: addF32(multiplyF32(state.velocity.x, decay), acceleratedX),
        y: addF32(multiplyF32(state.velocity.y, decay), acceleratedY)
    };
    clampReferenceVelocity(velocity);

    const sleepSpeed = f32(THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND);
    if (intent.x === 0 && intent.y === 0
        && Math.hypot(velocity.x, velocity.y) <= sleepSpeed) {
        velocity.x = 0;
        velocity.y = 0;
    }

    const previousX = f32(state.position.x);
    const previousY = f32(state.position.y);
    const nextX = addF32(previousX, multiplyF32(velocity.x, FIXED_DELTA_F32));
    const nextY = addF32(previousY, multiplyF32(velocity.y, FIXED_DELTA_F32));
    // rebuild_velocities가 solver 결과 위치로부터 velocity를 다시 계산합니다.
    velocity.x = multiplyF32(f32(nextX - previousX), INVERSE_FIXED_DELTA_F32);
    velocity.y = multiplyF32(f32(nextY - previousY), INVERSE_FIXED_DELTA_F32);
    clampReferenceVelocity(velocity);

    state.position.x = nextX;
    state.position.y = nextY;
    state.velocity.x = velocity.x;
    state.velocity.y = velocity.y;
    return state;
}

function createParityFixture(options = {}) {
    const tower = new TheTower({
        x: options.position?.x ?? 0,
        y: options.position?.y ?? 0
    });
    const velocity = options.velocity ?? { x: 0, y: 0 };
    tower.getPhysicsBody().setVelocity(velocity.x, velocity.y);
    return {
        tower,
        gpu: {
            position: {
                x: f32(options.position?.x ?? 0),
                y: f32(options.position?.y ?? 0)
            },
            velocity: {
                x: f32(velocity.x),
                y: f32(velocity.y)
            }
        }
    };
}

function stepParityFixture(fixture, intent) {
    fixture.tower.setMoveIntent(intent.x, intent.y);
    fixture.tower.fixedUpdate(FIXED_DELTA);
    stepGpuReference(fixture.gpu, intent);
}

function snapshotCpu(tower) {
    const body = tower.getPhysicsBody();
    return {
        position: {
            x: body.getPosition().x,
            y: body.getPosition().y
        },
        velocity: {
            x: body.getVelocity().x,
            y: body.getVelocity().y
        }
    };
}

function assertParity(
    fixture,
    label,
    velocityTolerance = ONE_TICK_VELOCITY_TOLERANCE,
    positionTolerance = ONE_TICK_POSITION_TOLERANCE
) {
    const cpu = snapshotCpu(fixture.tower);
    for (const axis of ['x', 'y']) {
        const velocityError = Math.abs(
            cpu.velocity[axis] - fixture.gpu.velocity[axis]
        );
        const positionError = Math.abs(
            cpu.position[axis] - fixture.gpu.position[axis]
        );
        assert.ok(
            velocityError <= velocityTolerance,
            label + ' velocity.' + axis + ' error=' + velocityError
        );
        assert.ok(
            positionError <= positionTolerance,
            label + ' position.' + axis + ' error=' + positionError
        );
    }
}

function toWgslFloat(value) {
    const normalized = Object.is(value, -0) ? 0 : value;
    const literal = String(normalized);
    return /[.eE]/.test(literal) ? literal : literal + '.0';
}

function extractWgslFunction(source, functionName) {
    const signatureIndex = source.indexOf('fn ' + functionName + '(');
    assert.ok(signatureIndex >= 0, functionName + ' WGSL function이 없습니다.');
    const bodyStart = source.indexOf('{', signatureIndex);
    assert.ok(bodyStart >= 0, functionName + ' WGSL body가 없습니다.');
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') {
            depth++;
        } else if (source[index] === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(signatureIndex, index + 1);
            }
        }
    }
    throw new Error(functionName + ' WGSL body가 닫히지 않았습니다.');
}

test('controlled WGSL 상수는 named THE_TOWER_DATA import만 authority로 사용한다', () => {
    assert.match(
        shaderSource,
        /import\s*\{\s*THE_TOWER_DATA\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/\.\.\/data\/object\/tower\/the_tower_data\.js'/
    );
    const mappings = [
        [
            'CONTROL_ACCELERATION',
            'CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED'
        ],
        ['CONTROL_LINEAR_FRICTION', 'LINEAR_FRICTION_PER_SECOND'],
        ['CONTROL_SLEEP_SPEED', 'SLEEP_SPEED_TILES_PER_SECOND'],
        ['CONTROL_MAX_LINEAR_SPEED', 'MAX_LINEAR_SPEED_TILES_PER_SECOND']
    ];
    for (const [wgslName, dataName] of mappings) {
        const sourcePattern = new RegExp(
            'const ' + wgslName
                + ': f32 = \\$\\{toWgslFloat\\(\\s*THE_TOWER_DATA\\.'
                + dataName
                + '\\s*\\)\\};'
        );
        assert.match(shaderSource, sourcePattern);
        assert.ok(
            GPU_COLLISION_COMPUTE_WGSL.includes(
                'const ' + wgslName + ': f32 = '
                    + toWgslFloat(THE_TOWER_DATA[dataName]) + ';'
            ),
            wgslName + ' literal이 named Tower data와 다릅니다.'
        );
    }
    assert.equal(
        THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
            / THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND,
        THE_TOWER_DATA.MOVE_SPEED_TILES_PER_SECOND
    );
    assert.ok(
        THE_TOWER_DATA.MOVE_SPEED_TILES_PER_SECOND
            < THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
    );
});

test('1/60 oracle은 zero, cardinal, diagonal normalization과 max-speed clamp를 고정한다', () => {
    const zero = createParityFixture();
    stepParityFixture(zero, { x: 0, y: 0 });
    assertParity(zero, 'zero');
    assert.deepEqual(snapshotCpu(zero.tower).velocity, { x: 0, y: 0 });

    const cardinal = createParityFixture();
    stepParityFixture(cardinal, { x: 1, y: 0 });
    const doubleDecay = Math.exp(
        -THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND * FIXED_DELTA
    );
    const exactFirstVelocity = (
        THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
        / THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND
    ) * (1 - doubleDecay);
    assert.ok(
        Math.abs(
            snapshotCpu(cardinal.tower).velocity.x - exactFirstVelocity
        ) <= 1e-12
    );
    assertParity(cardinal, 'cardinal');

    const diagonal = createParityFixture();
    stepParityFixture(diagonal, { x: 1, y: 1 });
    assertParity(diagonal, 'diagonal');
    const diagonalVelocity = snapshotCpu(diagonal.tower).velocity;
    assert.ok(Math.abs(diagonalVelocity.x - diagonalVelocity.y) <= 1e-12);
    assert.ok(
        Math.abs(
            Math.hypot(diagonalVelocity.x, diagonalVelocity.y)
                - snapshotCpu(cardinal.tower).velocity.x
        ) <= 1e-12
    );

    const capped = createParityFixture({
        velocity: {
            x: THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND,
            y: 0
        }
    });
    capped.tower.getPhysicsBody().applyImpulse(
        THE_TOWER_DATA.WEIGHT * 5,
        0
    );
    capped.gpu.velocity.x = f32(
        THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND + 5
    );
    stepParityFixture(capped, { x: 0, y: 0 });
    assertParity(capped, 'max-speed');
    assert.ok(
        Math.hypot(
            snapshotCpu(capped.tower).velocity.x,
            snapshotCpu(capped.tower).velocity.y
        ) <= THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
    );

    for (const fixture of [zero, cardinal, diagonal, capped]) {
        fixture.tower.destroy();
    }
});

test('1/60 oracle은 release 감속, reversal, sleep threshold를 고정한다', () => {
    const released = createParityFixture();
    for (let tick = 0; tick < 120; tick++) {
        stepParityFixture(released, { x: 1, y: 0 });
    }
    const releaseStart = snapshotCpu(released.tower).velocity.x;
    for (let tick = 0; tick < 30; tick++) {
        stepParityFixture(released, { x: 0, y: 0 });
        assertParity(
            released,
            'release:' + tick,
            LONG_RUN_VELOCITY_TOLERANCE,
            LONG_RUN_POSITION_TOLERANCE
        );
    }
    const releaseEnd = snapshotCpu(released.tower).velocity.x;
    assert.ok(releaseEnd >= 0 && releaseEnd < releaseStart);

    const reversed = createParityFixture();
    for (let tick = 0; tick < 60; tick++) {
        stepParityFixture(reversed, { x: 1, y: 0 });
    }
    assert.ok(snapshotCpu(reversed.tower).velocity.x > 0);
    for (let tick = 0; tick < 60; tick++) {
        stepParityFixture(reversed, { x: -1, y: 0 });
        assertParity(
            reversed,
            'reversal:' + tick,
            LONG_RUN_VELOCITY_TOLERANCE,
            LONG_RUN_POSITION_TOLERANCE
        );
    }
    assert.ok(snapshotCpu(reversed.tower).velocity.x < 0);

    const sleeping = createParityFixture({
        velocity: {
            x: THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND * 1.01,
            y: 0
        }
    });
    stepParityFixture(sleeping, { x: 0, y: 0 });
    assertParity(sleeping, 'sleep');
    assert.deepEqual(snapshotCpu(sleeping.tower).velocity, { x: 0, y: 0 });
    assert.deepEqual(sleeping.gpu.velocity, { x: 0, y: 0 });

    released.tower.destroy();
    reversed.tower.destroy();
    sleeping.tower.destroy();
});

test('600 fixed tick f32 reference는 명시한 누적 오차 한도 안에서 CPU Tower를 따른다', () => {
    const fixture = createParityFixture({
        position: { x: 3.25, y: -1.75 }
    });
    let maximumVelocityError = 0;
    let maximumPositionError = 0;
    for (let tick = 0; tick < 600; tick++) {
        const intent = tick < 150
            ? { x: 1, y: 0 }
            : tick < 300
                ? { x: -1, y: 1 }
                : tick < 450
                    ? { x: -1, y: 0 }
                    : { x: 0, y: 0 };
        stepParityFixture(fixture, intent);
        const cpu = snapshotCpu(fixture.tower);
        for (const axis of ['x', 'y']) {
            maximumVelocityError = Math.max(
                maximumVelocityError,
                Math.abs(cpu.velocity[axis] - fixture.gpu.velocity[axis])
            );
            maximumPositionError = Math.max(
                maximumPositionError,
                Math.abs(cpu.position[axis] - fixture.gpu.position[axis])
            );
        }
    }
    assert.ok(
        maximumVelocityError <= LONG_RUN_VELOCITY_TOLERANCE,
        '600-tick maximum velocity error=' + maximumVelocityError
    );
    assert.ok(
        maximumPositionError <= LONG_RUN_POSITION_TOLERANCE,
        '600-tick maximum position error=' + maximumPositionError
    );
    assertParity(
        fixture,
        '600-tick-final',
        LONG_RUN_VELOCITY_TOLERANCE,
        LONG_RUN_POSITION_TOLERANCE
    );
    fixture.tower.destroy();
});

test('control marker는 controlled body의 FLOW_FIELD overwrite를 막고 ballistic prepare를 보존한다', () => {
    const clearControl = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'clear_body_control_states'
    );
    const validateControl = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'validate_body_control_commands'
    );
    const applyControl = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'apply_body_control_commands'
    );
    const prepareBodies = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'prepare_bodies'
    );
    const finalizeVelocities = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'finalize_velocities'
    );
    const finalizeControlledMotion = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'finalize_controlled_motion'
    );

    assert.match(validateControl, /BODY_FLAG_USE_FLOW/);
    assert.match(validateControl, /FIXED_PROGRAM_STATUS_RECORD_INVALID/);
    assert.match(clearControl, /atomicAnd[\s\S]*~BODY_FLAG_CONTROLLED_THIS_TICK/);
    assert.match(applyControl, /atomicOr[\s\S]*BODY_FLAG_CONTROLLED_THIS_TICK/);
    assert.match(
        prepareBodies,
        /body_has_flag\(simulation_flags, BODY_FLAG_USE_FLOW\)[\s\S]*?!body_has_flag\(simulation_flags, BODY_FLAG_CONTROLLED_THIS_TICK\)[\s\S]*?velocity = mix\(/
    );
    assert.match(prepareBodies, /velocity = mix\(/);
    assert.match(
        prepareBodies,
        /predicted_position = current\s*\+ \(velocity \* params\.dt\)/
    );
    assert.match(
        finalizeVelocities,
        /BODY_FLAG_CONTROLLED_THIS_TICK[\s\S]*return;[\s\S]*velocity_damping/
    );
    assert.match(
        finalizeControlledMotion,
        /BODY_FLAG_CONTROLLED_THIS_TICK[\s\S]*?CONTROL_MAX_LINEAR_SPEED/
    );
    assert.equal(
        (GPU_COLLISION_COMPUTE_WGSL.match(
            /BODY_FLAG_CONTROLLED_THIS_TICK/g
        ) ?? []).length,
        7,
        'marker는 선언/clear/move+stop apply/flow skip/general+controlled finalize에만 있어야 합니다.'
    );
});

test('async death readback 전 exact dead body control은 hard protocol failure 없이 no-op한다', () => {
    const validateControl = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'validate_body_control_commands'
    );
    const applyControl = extractWgslFunction(
        GPU_COLLISION_COMPUTE_WGSL,
        'apply_body_control_commands'
    );
    const firstRecordInvalidIndex = validateControl.indexOf(
        'FIXED_PROGRAM_STATUS_RECORD_INVALID'
    );
    const lastRecordInvalidIndex = validateControl.lastIndexOf(
        'FIXED_PROGRAM_STATUS_RECORD_INVALID'
    );
    const deadNoOpIndex = validateControl.indexOf(
        'if (!body_id_is_alive(command.destination_slot))'
    );
    const identityValidationIndex = validateControl.indexOf(
        'command.destination_slot >= counts.body_count'
    );
    const identityRecordInvalidIndex = validateControl.indexOf(
        'FIXED_PROGRAM_STATUS_RECORD_INVALID',
        identityValidationIndex
    );

    assert.ok(
        firstRecordInvalidIndex >= 0,
        '구조/flow/move payload 위반은 RECORD_INVALID를 유지해야 합니다.'
    );
    assert.match(
        validateControl,
        /let output_is_initial = command\.result == BODY_CONTROL_RESULT_PENDING/
    );
    for (const requiredHardValidation of [
        '!supported_mode',
        '!output_is_initial',
        '!finite_move',
        '!priority_payload_valid',
        '!move_payload_valid',
        'command.reserved_0 != 0u',
        'command.destination_slot >= body_capacity'
    ]) {
        const validationIndex = validateControl.indexOf(requiredHardValidation);
        assert.ok(
            validationIndex >= 0 && validationIndex < firstRecordInvalidIndex,
            requiredHardValidation + ' 위반은 dead no-op보다 먼저 hard reject해야 합니다.'
        );
    }
    assert.match(
        validateControl.slice(firstRecordInvalidIndex, deadNoOpIndex),
        /BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT[\s\S]*?BODY_FLAG_USE_FLOW[\s\S]*?FIXED_PROGRAM_STATUS_RECORD_INVALID/
    );
    assert.ok(
        identityValidationIndex >= 0
            && identityRecordInvalidIndex > identityValidationIndex
            && validateControl.indexOf(
                'simulations.values[command.destination_slot].entity_id\n            != command.entity_id',
                identityValidationIndex
            ) < identityRecordInvalidIndex
            && validateControl.indexOf(
                'simulations.values[command.destination_slot].incarnation\n            != command.incarnation',
                identityValidationIndex
            ) < identityRecordInvalidIndex
            && identityRecordInvalidIndex < deadNoOpIndex,
        'destination range/entity/incarnation mismatch는 dead no-op 전에 hard reject해야 합니다.'
    );
    assert.ok(
        deadNoOpIndex > lastRecordInvalidIndex,
        '구조와 flow 위반을 모두 preflight한 뒤 exact GPU-dead command만 no-op이어야 합니다.'
    );
    assert.match(
        validateControl.slice(deadNoOpIndex),
        /^if \(!body_id_is_alive\(command\.destination_slot\)\) \{\s*return;\s*\}/
    );

    const applyExactLivingGuardIndex = applyControl.indexOf(
        'if (!exact_living_body('
    );
    const sourceInvalidWriteIndex = applyControl.indexOf(
        'BODY_CONTROL_RESULT_SOURCE_INVALID',
        applyExactLivingGuardIndex
    );
    const exactDeadMoveIndex = applyControl.indexOf(
        'let exact_dead_move = command.mode_flags',
        applyExactLivingGuardIndex
    );
    const exactDeadMoveReturnIndex = applyControl.indexOf(
        'if (exact_dead_move)',
        exactDeadMoveIndex
    );
    const exactDeadMoveReturnEnd = applyControl.indexOf(
        'return;',
        exactDeadMoveReturnIndex
    ) + 'return;'.length;
    const controlStateWriteIndex = applyControl.indexOf(
        'store_body_control_state(',
        applyExactLivingGuardIndex
    );
    assert.ok(
        applyExactLivingGuardIndex >= 0
            && sourceInvalidWriteIndex > applyExactLivingGuardIndex
            && controlStateWriteIndex > sourceInvalidWriteIndex,
        'apply는 exact living identity를 재확인하고 stale/dead source를 state mutation 없이 종료해야 합니다.'
    );
    assert.ok(
        exactDeadMoveIndex > applyExactLivingGuardIndex
            && exactDeadMoveReturnIndex > exactDeadMoveIndex
            && exactDeadMoveReturnIndex < sourceInvalidWriteIndex,
        'exact dead MOVE no-op은 SOURCE_INVALID output보다 먼저 판정해야 합니다.'
    );
    const exactDeadMoveBlock = applyControl.slice(
        exactDeadMoveIndex,
        exactDeadMoveReturnEnd
    );
    assert.match(
        exactDeadMoveBlock,
        /BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT[\s\S]*?entity_id[\s\S]*?command\.entity_id[\s\S]*?incarnation[\s\S]*?command\.incarnation[\s\S]*?!body_id_is_alive\(command\.destination_slot\)[\s\S]*?if \(exact_dead_move\) \{\s*(?:\/\/[^\n]*\n\s*)*return;/
    );
    assert.doesNotMatch(
        exactDeadMoveBlock,
        /body_control_program\.records\[command_index\]\.result\s*=/,
        'exact dead MOVE는 ingress PENDING output record를 변경하면 안 됩니다.'
    );
});
