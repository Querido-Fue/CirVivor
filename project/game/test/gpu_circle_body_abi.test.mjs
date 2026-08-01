import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const abi = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_FLOW,
    GPU_CIRCLE_BODY_IDENTITY,
    GPU_CIRCLE_BODY_META,
    appendGpuCircleBodySpawn,
    createGpuCircleBodyAbiStorage,
    createGpuCircleGridBodyBuffer,
    packGpuCirclePhysicsMeta,
    packGpuCircleSimulationMeta,
    readGpuCircleBody,
    readGpuCircleBodyCounts,
    readGpuCircleGridBody,
    unpackGpuCirclePhysicsMeta,
    unpackGpuCircleSimulationMeta,
    writeGpuCircleBodyCounts,
    writeGpuCircleBodySpawn,
    writeGpuCircleGridBody
} = abi;

assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY, 1);
assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN, 128);
assert.equal(
    GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
    129
);

const FLOAT_EPSILON = 1e-6;

/**
 * 두 수가 Float32 허용 오차 안인지 검증합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} message - 실패 메시지입니다.
 */
function assertNear(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= FLOAT_EPSILON,
        `${message}: expected=${expected}, actual=${actual}`
    );
}

/**
 * VM context에서 발생한 오류를 realm 독립적으로 검증합니다.
 * @param {Function} callback - 오류를 발생시킬 함수입니다.
 * @param {string} expectedName - 기대 오류 이름입니다.
 */
function assertThrowsNamed(callback, expectedName) {
    assert.throws(callback, (error) => error?.name === expectedName);
}

// std430/WGSL과 공유할 stride 및 모든 field offset을 고정합니다.
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.RESERVED, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.META, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.RESERVED, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.TIMER, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.META, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_X, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_Y, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICS_META, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.SIMULATION_META, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.RESERVED, 28);

// physics/simulation meta는 low8 layer를 공유하고 그 다음 byte를 독립 mask/flags로 사용합니다.
const physicsMeta = packGpuCirclePhysicsMeta(0xa5, 0x81);
const simulationMeta = packGpuCircleSimulationMeta(0xa5, 0x05);
assert.equal(physicsMeta, 0x81a5);
assert.equal(simulationMeta, 0x05a5);
assert.equal(GPU_CIRCLE_BODY_META.ALIVE_BIT, 0x0100);
assert.equal(GPU_CIRCLE_BODY_META.USE_FLOW_BIT, 0x0200);
assert.equal(GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX, 0xffffffff);
assert.equal(GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT, 256);
assert.equal(GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT, 0xffffffff);
const unpackedPhysics = unpackGpuCirclePhysicsMeta(physicsMeta);
assert.equal(unpackedPhysics.layerMask, 0xa5);
assert.equal(unpackedPhysics.collisionMask, 0x81);
const unpackedSimulation = unpackGpuCircleSimulationMeta(simulationMeta);
assert.equal(unpackedSimulation.layerMask, 0xa5);
assert.equal(unpackedSimulation.flags, 0x05);
assert.equal(unpackedSimulation.alive, true);
assert.equal(unpackGpuCircleSimulationMeta(packGpuCircleSimulationMeta(1, 0)).alive, false);

// 재사용 slot을 오염시킨 뒤 spawn하면 current/previous/predicted와 모든 tmp sentinel이 초기화됩니다.
const storage = createGpuCircleBodyAbiStorage(2);
new Uint8Array(storage.physicsBuffer).fill(0xff);
new Uint8Array(storage.simulationBuffer).fill(0xff);
new Uint8Array(storage.temporaryBuffer).fill(0xff);
writeGpuCircleBodyCounts(storage, {
    bodyCount: 1,
    additionCount: 2,
    removalCount: 3
});
writeGpuCircleBodySpawn(storage, 1, {
    position: { x: 12.25, y: -3.5 },
    velocity: { x: 4.75, y: -2.25 },
    radius: 1.125,
    inverseMass: 0.5,
    layerMask: 1,
    collisionMask: 0x81,
    alive: true
});
const packedBody = readGpuCircleBody(storage, 1);
assertNear(packedBody.position.x, 12.25, 'spawn current x');
assertNear(packedBody.position.y, -3.5, 'spawn current y');
assertNear(packedBody.velocity.x, 4.75, 'spawn velocity x');
assertNear(packedBody.velocity.y, -2.25, 'spawn velocity y');
assertNear(packedBody.radius, 1.125, 'spawn radius');
assertNear(packedBody.inverseMass, 0.5, 'spawn inverse mass');
assertNear(packedBody.previousPosition.x, packedBody.position.x, 'spawn previous x sync');
assertNear(packedBody.previousPosition.y, packedBody.position.y, 'spawn previous y sync');
assertNear(packedBody.predictedPosition.x, packedBody.position.x, 'spawn predicted x sync');
assertNear(packedBody.predictedPosition.y, packedBody.position.y, 'spawn predicted y sync');
assert.equal(packedBody.positionDelta.x, 0);
assert.equal(packedBody.positionDelta.y, 0);
assert.equal(packedBody.gridIndex, -1);
assert.equal(packedBody.physicsMeta, packGpuCirclePhysicsMeta(1, 0x81));
assert.equal(packedBody.simulationMeta, packGpuCircleSimulationMeta(1, 1));
assert.equal(packedBody.flowFieldIndex, GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX);
assert.equal(packedBody.flowSpeed, 0);
assert.equal(packedBody.entityId, GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT);
assert.equal(packedBody.incarnation, GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT);
assert.equal(
    packedBody.previousFlowFieldIndex,
    GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX
);
const physicsView = new DataView(storage.physicsBuffer);
const simulationView = new DataView(storage.simulationBuffer);
const temporaryView = new DataView(storage.temporaryBuffer);
assert.equal(
    physicsView.getUint32(
        GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE + GPU_CIRCLE_BODY_ABI.PHYSICS.RESERVED,
        true
    ),
    0
);
const simulationOffset = GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
assert.equal(
    simulationView.getFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        true
    ),
    0
);
assert.equal(
    simulationView.getInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        true
    ),
    0
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.TIMER,
        true
    ),
    0
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.META,
        true
    ),
    packGpuCircleSimulationMeta(1, 1)
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
        true
    ),
    GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX
);
assert.equal(
    simulationView.getFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
        true
    ),
    0
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
        true
    ),
    GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
        true
    ),
    GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
);

// route field index와 speed는 source-compatible simulation stride 안에서 round trip합니다.
writeGpuCircleBodySpawn(storage, 0, {
    position: { x: 1, y: 2 },
    radius: 0.25,
    inverseMass: 1,
    layerMask: 1,
    collisionMask: 1,
    flowFieldIndex: 7,
    flowSpeed: 6.25,
    entityId: 42,
    incarnation: 9
});
const flowBody = readGpuCircleBody(storage, 0);
assert.equal(flowBody.flowFieldIndex, 7);
assertNear(flowBody.flowSpeed, 6.25, 'flow speed');
assert.equal(flowBody.entityId, 42);
assert.equal(flowBody.incarnation, 9);
assert.equal(flowBody.previousFlowFieldIndex, 7);
assert.equal(
    unpackGpuCircleSimulationMeta(flowBody.simulationMeta).flags,
    GPU_CIRCLE_BODY_META.ALIVE_FLAG | GPU_CIRCLE_BODY_META.USE_FLOW_FLAG
);
assert.equal(
    temporaryView.getUint32(
        GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
            + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
        true
    ),
    GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX
);
const counts = readGpuCircleBodyCounts(storage);
assert.equal(counts.bodyCount, 1);
assert.equal(counts.additionCount, 2);
assert.equal(counts.removalCount, 3);
assert.equal(counts.reserved, 0);

// GridBody도 같은 32-byte ABI로 signed/unsigned와 Float32를 round trip합니다.
const gridBuffer = createGpuCircleGridBodyBuffer(2);
writeGpuCircleGridBody(gridBuffer, 2, 1, {
    predictedPosition: { x: -10.5, y: 9.25 },
    physicsMeta,
    simulationMeta,
    inverseMass: 0.25,
    radius: 7.5,
    bodyId: 0xfedcba98
});
const gridBody = readGpuCircleGridBody(gridBuffer, 2, 1);
assertNear(gridBody.predictedPosition.x, -10.5, 'grid predicted x');
assertNear(gridBody.predictedPosition.y, 9.25, 'grid predicted y');
assert.equal(gridBody.physicsMeta, physicsMeta);
assert.equal(gridBody.simulationMeta, simulationMeta);
assertNear(gridBody.inverseMass, 0.25, 'grid inverse mass');
assertNear(gridBody.radius, 7.5, 'grid radius');
assert.equal(gridBody.bodyId, 0xfedcba98);
assert.equal(gridBody.reserved, 0);

// append는 count를 정확히 증가시키며 capacity를 넘기기 전에 명시적으로 거부합니다.
const singleSlotStorage = createGpuCircleBodyAbiStorage(1);
const spawn = {
    position: { x: 1, y: 2 },
    radius: 1,
    inverseMass: 1,
    layerMask: 1,
    collisionMask: 1
};
assert.equal(appendGpuCircleBodySpawn(singleSlotStorage, spawn), 0);
assert.equal(readGpuCircleBodyCounts(singleSlotStorage).bodyCount, 1);
assertThrowsNamed(() => appendGpuCircleBodySpawn(singleSlotStorage, spawn), 'RangeError');
assert.equal(readGpuCircleBodyCounts(singleSlotStorage).bodyCount, 1);

// invalid/NaN/Infinity/negative/layer mismatch/index overflow는 조용히 보정하지 않습니다.
assertThrowsNamed(() => createGpuCircleBodyAbiStorage(0), 'RangeError');
assertThrowsNamed(() => createGpuCircleBodyAbiStorage(1.5), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodyCounts(storage, { bodyCount: 3 }), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 2, spawn), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    position: { x: Number.NaN, y: 0 }
}), 'TypeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    velocity: { x: Number.POSITIVE_INFINITY, y: 0 }
}), 'TypeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    radius: -1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    useFlow: true,
    flowSpeed: 1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    flowFieldIndex: GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX,
    flowSpeed: 1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    flowFieldIndex: 0,
    flowSpeed: -1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    entityId: 1
}), 'TypeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    entityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
    incarnation: 1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    inverseMass: -0.1
}), 'RangeError');
assertThrowsNamed(() => packGpuCirclePhysicsMeta(256, 1), 'RangeError');
assertThrowsNamed(() => packGpuCircleSimulationMeta(1, 256), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    physicsMeta: packGpuCirclePhysicsMeta(1, 1),
    simulationMeta: packGpuCircleSimulationMeta(2, 1)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    simulationMeta: packGpuCircleSimulationMeta(1, 0)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    alive: false,
    simulationMeta: packGpuCircleSimulationMeta(1, GPU_CIRCLE_BODY_META.ALIVE_FLAG)
}), 'RangeError');

console.log('gpu circle body ABI contract: ok');
