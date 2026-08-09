import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const abi = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_APPLIED_EVENT_META,
    GPU_CIRCLE_APPLIED_EVENT_TYPE,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_FIXED_POINT,
    GPU_CIRCLE_BODY_FLOW,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_IDENTITY,
    GPU_CIRCLE_BODY_INTERACTION_LAYER,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_LIFETIME,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    appendGpuCircleBodySpawn,
    assertGpuCircleBodyAbiVersion,
    createGpuCircleBodyAbiStorage,
    createGpuCircleGridBodyBuffer,
    decodeGpuCircleBodyFixedPoint,
    encodeGpuCircleBodyFixedPoint,
    normalizeGpuCircleBodyContactHandler,
    normalizeGpuCircleBodyLifetime,
    normalizeGpuCircleBodyMaximumDamageWindowDurationTicks,
    normalizeGpuCircleBodyRenderShapeCode,
    normalizeGpuCircleBodyMetadata,
    packGpuCircleAppliedEventMeta,
    packGpuCircleGameplayMeta,
    packGpuCircleInteractionMeta,
    packGpuCirclePhysicsMeta,
    packGpuCircleSimulationMeta,
    readGpuCircleBody,
    readGpuCircleBodyCombatState,
    readGpuCircleBodyCounts,
    readGpuCircleContactHandler,
    readGpuCircleGridBody,
    resolveGpuCircleBodyMaximumDamageWindow,
    unpackGpuCircleAppliedEventMeta,
    unpackGpuCircleGameplayMeta,
    unpackGpuCircleInteractionMeta,
    unpackGpuCirclePhysicsMeta,
    unpackGpuCircleSimulationMeta,
    writeGpuCircleBodyCounts,
    writeGpuCircleBodyCombatState,
    writeGpuCircleBodySpawn,
    writeGpuCircleContactHandler,
    writeGpuCircleGridBody
} = abi;
const {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY, 1);
assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER, GPU_CIRCLE_BODY_LAYER);
assert.equal(GPU_CIRCLE_BODY_INTERACTION_LAYER, GPU_CIRCLE_BODY_LAYER);
assert.equal(GPU_CIRCLE_BODY_LAYER.PROJECTILE, 2);
assert.equal(GPU_CIRCLE_BODY_LAYER.EXPLOSION, 4);
assert.equal(GPU_CIRCLE_BODY_LAYER.EFFECT, 8);
assert.equal(GPU_CIRCLE_BODY_LAYER.FLAME, 16);
assert.equal(GPU_CIRCLE_BODY_LAYER.GRENADE, 32);
assert.equal(GPU_CIRCLE_BODY_LAYER.KINEMATIC_OBSTACLE, 64);
assert.equal(GPU_CIRCLE_BODY_LAYER.LAYER_7, 64);
assert.equal(
    GPU_CIRCLE_BODY_LAYER.LAYER_7,
    GPU_CIRCLE_BODY_LAYER.KINEMATIC_OBSTACLE
);
assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN, 128);
assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY, 256);
assert.equal(GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE, 512);
for (const [name, value] of Object.entries(GPU_CIRCLE_BODY_LAYER)) {
    assert.equal(Number.isInteger(value), true, `${name} capability는 정수여야 합니다.`);
    assert.ok(value > 0 && value <= 0xffff, `${name} capability는 uint16이어야 합니다.`);
}
assert.equal(
    GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
    129
);
assert.equal(
    GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
    640
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
assert.equal(GPU_CIRCLE_BODY_ABI_VERSION, 5);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META, 8);
assert.equal('TIMER' in GPU_CIRCLE_BODY_ABI.SIMULATION, false);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.SIMULATION.RESERVED_INCARNATION, 28);
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
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICAL_META, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.FLAGS, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.GRID_BODY.INTERACTION_META, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_SELF, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_FALLOFF, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FIRE_TIMER, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.CHAINING, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_REPORT_ID, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.SLOW_TIMER, 28);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE, 40);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.TARGET_INTERACTION_LAYER_MASK, 0);
assert.equal(
    GPU_CIRCLE_BODY_ABI.COMBAT_STATE.MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS,
    4
);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_FINAL_DAMAGE_FIXED_POINT, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.EXPIRES_AT_FIXED_TICK, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_ENTITY_ID, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_INCARNATION, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.STRIDE, 32);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.COLOR_RED, 0);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.COLOR_GREEN, 4);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.COLOR_BLUE, 8);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.COLOR_ALPHA, 12);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RADIUS_SCALE, 16);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.VISIBLE, 20);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE, 24);
assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.RESERVED, 28);
assert.deepEqual({ ...GPU_CIRCLE_BODY_RENDER_SHAPE }, {
    CIRCLE: 0,
    SQUARE: 1,
    TRIANGLE: 2,
    ARROW: 3,
    PENTA: 4,
    HEXA: 5,
    GEN: 6
});
assert.equal(
    normalizeGpuCircleBodyRenderShapeCode(),
    GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
);
assert.equal(
    normalizeGpuCircleBodyRenderShapeCode(GPU_CIRCLE_BODY_RENDER_SHAPE.GEN),
    GPU_CIRCLE_BODY_RENDER_SHAPE.GEN
);

// V5 physical/interaction/gameplay metadata와 flags word는 서로 독립입니다.
const physicsMeta = packGpuCirclePhysicsMeta(0xa5, 0x81);
const interactionMeta = packGpuCircleInteractionMeta(0x42, 0xa5);
const gameplayMeta = packGpuCircleGameplayMeta(
    GAMEPLAY_TEAM_ID.HOSTILE,
    GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
);
const simulationMeta = packGpuCircleSimulationMeta(0x05);
assert.equal(physicsMeta, 0x008100a5);
assert.equal(interactionMeta, 0x00a50042);
assert.equal(gameplayMeta, 0x00000002);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT, 0);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK, 0xff);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_SHIFT, 8);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_MASK, 0xff);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_SHIFT, 16);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_MASK, 0xff);
assert.equal(GPU_CIRCLE_BODY_GAMEPLAY_META.RESERVED_MASK, 0xff000000);
assert.equal(simulationMeta, 0x05);
assert.equal(GPU_CIRCLE_BODY_META.ALIVE_BIT, 0x01);
assert.equal(GPU_CIRCLE_BODY_META.USE_FLOW_BIT, 0x02);
assert.equal(GPU_CIRCLE_BODY_META.COUNT_AS_KILL_BIT, 0x04);
assert.equal(GPU_CIRCLE_BODY_META.EXPLODE_ON_DEATH_BIT, 0x08);
assert.equal(GPU_CIRCLE_BODY_META.GOLDEN_BIT, 0x10);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE, 1);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW, 2);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL, 4);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH, 8);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN, 16);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY, 256);
assert.equal(GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_CONTINUOUS, 512);
assert.equal(GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.KILL_IF_OTHER_TERRAIN, 1);
assert.equal(GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY, 2);
assert.equal(GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.SLOW, 4);
assert.equal(GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY, 8);
assert.equal(GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS, 16);
assert.equal(GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE, 100);
assert.equal(GPU_CIRCLE_BODY_LIFETIME.IMMORTAL, -1);
assert.equal(GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX, 0xffffffff);
assert.equal(GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT, 256);
assert.equal(GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT, 0xffffffff);
const unpackedPhysics = unpackGpuCirclePhysicsMeta(physicsMeta);
assert.equal(unpackedPhysics.bodyLayer, 0xa5);
assert.equal(unpackedPhysics.collisionMask, 0x81);
const unpackedInteraction = unpackGpuCircleInteractionMeta(interactionMeta);
assert.equal(unpackedInteraction.interactionLayer, 0x42);
assert.equal(unpackedInteraction.interactionMask, 0xa5);
const towerInteractionMeta = packGpuCircleInteractionMeta(
    GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE,
    GPU_CIRCLE_BODY_LAYER.PROJECTILE
);
assert.equal(towerInteractionMeta, 0x00020200);
assert.deepEqual({ ...unpackGpuCircleInteractionMeta(towerInteractionMeta) }, {
    interactionLayer: GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE,
    interactionMask: GPU_CIRCLE_BODY_LAYER.PROJECTILE
});
assert.deepEqual({ ...unpackGpuCircleGameplayMeta(gameplayMeta) }, {
    teamId: GAMEPLAY_TEAM_ID.HOSTILE,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    damageResolutionPolicyId: GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT
});
const unpackedSimulation = unpackGpuCircleSimulationMeta(simulationMeta);
assert.equal(unpackedSimulation.flags, 0x05);
assert.equal(unpackedSimulation.alive, true);
assert.equal(unpackedSimulation.useFlow, false);
assert.equal(unpackedSimulation.countAsKill, true);
assert.equal(unpackedSimulation.explodeOnDeath, false);
assert.equal(unpackedSimulation.golden, false);
assert.equal(unpackGpuCircleSimulationMeta(packGpuCircleSimulationMeta(0)).alive, false);

// 재사용 slot을 오염시킨 뒤 spawn하면 current/previous/predicted와 모든 tmp sentinel이 초기화됩니다.
const storage = createGpuCircleBodyAbiStorage(2);
assert.equal(
    storage.contactHandlerBuffer.byteLength,
    GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * storage.capacity
);
assert.equal(
    storage.combatStateBuffer.byteLength,
    GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE * storage.capacity
);
new Uint8Array(storage.physicsBuffer).fill(0xff);
new Uint8Array(storage.simulationBuffer).fill(0xff);
new Uint8Array(storage.temporaryBuffer).fill(0xff);
new Uint8Array(storage.contactHandlerBuffer).fill(0xff);
new Uint8Array(storage.combatStateBuffer).fill(0xff);
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
    bodyLayer: 1,
    collisionMask: 0x81,
    interactionLayer: 2,
    interactionMask: 0x42,
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
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
assert.equal(packedBody.interactionMeta, packGpuCircleInteractionMeta(2, 0x42));
assert.equal(
    packedBody.gameplayMeta,
    packGpuCircleGameplayMeta(GAMEPLAY_TEAM_ID.PLAYER)
);
assert.equal(packedBody.teamId, GAMEPLAY_TEAM_ID.PLAYER);
assert.equal(
    packedBody.damagePolicyId,
    GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
);
assert.equal(packedBody.simulationMeta, packGpuCircleSimulationMeta(1));
assert.equal(packedBody.lifetime, GPU_CIRCLE_BODY_LIFETIME.IMMORTAL);
assert.equal(packedBody.healthFixedPoint, GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE);
assert.equal(packedBody.health, 1);
assert.equal('timer' in packedBody, false);
assert.equal(packedBody.flowFieldIndex, GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX);
assert.equal(packedBody.flowSpeed, 0);
assert.equal(packedBody.entityId, GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT);
assert.equal(packedBody.incarnation, GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT);
assert.equal(
    packedBody.previousFlowFieldIndex,
    GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX
);
assert.equal(packedBody.contactHandler.damageSelf, 0);
assert.equal(packedBody.contactHandler.damageOther, 0);
assert.equal(packedBody.contactHandler.damageFalloff, 0);
assert.equal(packedBody.contactHandler.fireTimer, 0);
assert.equal(packedBody.contactHandler.flags, 0);
assert.equal(packedBody.contactHandler.chaining, 0);
assert.equal(packedBody.contactHandler.damageReportId, -1);
assert.equal(packedBody.contactHandler.slowTimer, 0);
assert.equal(packedBody.contactHandler.targetInteractionLayerMask, 0x42);
assert.deepEqual({ ...packedBody.combatState }, {
    targetInteractionLayerMask: 0x42,
    maximumDamageWindowDurationTicks: 0,
    peakFinalDamageFixedPoint: 0,
    expiresAtFixedTick: 0,
    peakSourceEntityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
    peakSourceIncarnation: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
});
const physicsView = new DataView(storage.physicsBuffer);
const simulationView = new DataView(storage.simulationBuffer);
const temporaryView = new DataView(storage.temporaryBuffer);
assert.equal(
    physicsView.getUint32(
        GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
            + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
        true
    ),
    packGpuCircleInteractionMeta(2, 0x42)
);
const simulationOffset = GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
assert.equal(
    simulationView.getFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        true
    ),
    GPU_CIRCLE_BODY_LIFETIME.IMMORTAL
);
assert.equal(
    simulationView.getInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        true
    ),
    GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
        true
    ),
    packGpuCircleGameplayMeta(GAMEPLAY_TEAM_ID.PLAYER)
);
assert.equal(
    simulationView.getUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        true
    ),
    packGpuCircleSimulationMeta(1)
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

// side-plane은 handler/effect record와 분리되어 peak/provenance를 보관하고 재spawn에서 clear됩니다.
writeGpuCircleBodyCombatState(storage, 1, {
    targetInteractionLayerMask: 0x42,
    maximumDamageWindowDurationTicks: 60,
    peakFinalDamageFixedPoint: 600,
    expiresAtFixedTick: 67,
    peakSourceEntityId: 9,
    peakSourceIncarnation: 3
});
assert.deepEqual({ ...readGpuCircleBodyCombatState(storage, 1) }, {
    targetInteractionLayerMask: 0x42,
    maximumDamageWindowDurationTicks: 60,
    peakFinalDamageFixedPoint: 600,
    expiresAtFixedTick: 67,
    peakSourceEntityId: 9,
    peakSourceIncarnation: 3
});
writeGpuCircleBodySpawn(storage, 1, {
    position: { x: 12.25, y: -3.5 },
    radius: 1.125,
    inverseMass: 0.5,
    bodyLayer: 1,
    collisionMask: 0x81,
    interactionLayer: 2,
    interactionMask: 0x42,
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    alive: true
});
assert.deepEqual({ ...readGpuCircleBodyCombatState(storage, 1) }, {
    targetInteractionLayerMask: 0x42,
    maximumDamageWindowDurationTicks: 0,
    peakFinalDamageFixedPoint: 0,
    expiresAtFixedTick: 0,
    peakSourceEntityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
    peakSourceIncarnation: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
});

// route field index와 speed는 source-compatible simulation stride 안에서 round trip합니다.
writeGpuCircleBodySpawn(storage, 0, {
    position: { x: 1, y: 2 },
    radius: 0.25,
    inverseMass: 1,
    bodyLayer: 1,
    collisionMask: 1,
    interactionLayer: 2,
    interactionMask: 0,
    teamId: GAMEPLAY_TEAM_ID.HOSTILE,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
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
assert.equal(flowBody.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
assert.equal(flowBody.previousFlowFieldIndex, 7);
assert.equal(
    unpackGpuCircleSimulationMeta(flowBody.simulationMeta).flags,
    GPU_CIRCLE_BODY_META.ALIVE_FLAG | GPU_CIRCLE_BODY_META.USE_FLOW_FLAG
);

writeGpuCircleBodySpawn(storage, 0, {
    position: { x: 1, y: 2 },
    radius: 0.25,
    inverseMass: 0.1,
    bodyLayer: GPU_CIRCLE_BODY_LAYER.KINEMATIC_OBSTACLE,
    collisionMask: GPU_CIRCLE_BODY_LAYER.ENEMY,
    interactionLayer: GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE,
    interactionMask: GPU_CIRCLE_BODY_LAYER.PROJECTILE | GPU_CIRCLE_BODY_LAYER.ENEMY,
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    damageResolutionPolicyId:
        GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW,
    maximumDamageWindowDurationTicks: 60,
    entityId: 31,
    incarnation: 2
});
const maximumDamageWindowBody = readGpuCircleBody(storage, 0);
assert.equal(
    maximumDamageWindowBody.damageResolutionPolicyId,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW
);
assert.equal(
    maximumDamageWindowBody.combatState.maximumDamageWindowDurationTicks,
    60
);
assert.equal(
    maximumDamageWindowBody.combatState.targetInteractionLayerMask,
    GPU_CIRCLE_BODY_LAYER.PROJECTILE | GPU_CIRCLE_BODY_LAYER.ENEMY
);
assert.equal(
    temporaryView.getUint32(
        GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
            + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
        true
    ),
    GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX
);

// 적과 투사체가 한 storage를 공유해도 sensor/수명/체력/충돌 핸들러가 독립적으로 보존됩니다.
const projectileSimulationFlags = GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
    | GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL
    | GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH
    | GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN;
writeGpuCircleBodySpawn(storage, 1, {
    position: { x: -5, y: 8 },
    velocity: { x: 9, y: -1 },
    radius: 0.125,
    inverseMass: 1,
    bodyLayer: GPU_CIRCLE_BODY_LAYER.PROJECTILE,
    collisionMask: 0,
    interactionLayer: GPU_CIRCLE_BODY_LAYER.PROJECTILE,
    interactionMask: GPU_CIRCLE_BODY_LAYER.ENEMY | GPU_CIRCLE_BODY_LAYER.TERRAIN,
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    health: 2,
    lifetime: 3.5,
    entityId: 77,
    incarnation: 4,
    countAsKill: true,
    explodeOnDeath: true,
    golden: true,
    contactHandler: {
        damageSelf: 1,
        damageOther: 2.25,
        damageFalloff: 0.5,
        fireTimer: 1.5,
        flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.KILL_IF_OTHER_TERRAIN
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY,
        chaining: 3,
        damageReportId: 7,
        slowTimer: 0.75
    }
});
const projectileBody = readGpuCircleBody(storage, 1);
const projectilePhysics = unpackGpuCirclePhysicsMeta(projectileBody.physicsMeta);
const projectileSimulation = unpackGpuCircleSimulationMeta(projectileBody.simulationMeta);
assert.equal(projectilePhysics.bodyLayer, GPU_CIRCLE_BODY_LAYER.PROJECTILE);
assert.equal(projectilePhysics.collisionMask, 0);
const projectileInteraction = unpackGpuCircleInteractionMeta(
    projectileBody.interactionMeta
);
assert.equal(
    projectileInteraction.interactionMask,
    GPU_CIRCLE_BODY_LAYER.ENEMY | GPU_CIRCLE_BODY_LAYER.TERRAIN
);
assert.equal(
    projectileInteraction.interactionLayer,
    GPU_CIRCLE_BODY_LAYER.PROJECTILE
);
assert.equal(
    projectileSimulation.flags,
    projectileSimulationFlags
        | GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY
);
assert.equal(projectileSimulation.alive, true);
assert.equal(projectileSimulation.useFlow, false);
assert.equal(projectileSimulation.countAsKill, true);
assert.equal(projectileSimulation.explodeOnDeath, true);
assert.equal(projectileSimulation.golden, true);
assertNear(projectileBody.lifetime, 3.5, 'projectile lifetime');
assert.equal(projectileBody.healthFixedPoint, 200);
assert.equal(projectileBody.health, 2);
assert.equal(projectileBody.teamId, GAMEPLAY_TEAM_ID.PLAYER);
assert.equal(
    projectileBody.damagePolicyId,
    GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
);
assert.equal(projectileBody.entityId, 77);
assert.equal(projectileBody.incarnation, 4);
assertNear(projectileBody.contactHandler.damageSelf, 1, 'projectile self damage');
assertNear(projectileBody.contactHandler.damageOther, 2.25, 'projectile other damage');
assertNear(projectileBody.contactHandler.damageFalloff, 0.5, 'projectile falloff');
assertNear(projectileBody.contactHandler.fireTimer, 1.5, 'projectile fire timer');
assert.equal(
    projectileBody.contactHandler.flags,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.KILL_IF_OTHER_TERRAIN
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
);
assert.equal(projectileBody.contactHandler.chaining, 3);
assert.equal(projectileBody.contactHandler.damageReportId, 7);
assertNear(projectileBody.contactHandler.slowTimer, 0.75, 'projectile slow timer');

// 원본 추출 코드의 snake_case 입력도 받되 빈 핸들러로 덮으면 stale 값이 모두 사라집니다.
writeGpuCircleContactHandler(storage, 0, {
    damage_self: 0.25,
    damage_other: 4,
    damage_falloff: 1,
    fire_timer: 2,
    flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.SLOW,
    chaining: -2,
    damage_report_id: 13,
    slow_timer: 5
});
const sourceNamedHandler = readGpuCircleContactHandler(storage, 0);
assertNear(sourceNamedHandler.damageSelf, 0.25, 'source damage_self alias');
assertNear(sourceNamedHandler.damageOther, 4, 'source damage_other alias');
assertNear(sourceNamedHandler.damageFalloff, 1, 'source damage_falloff alias');
assertNear(sourceNamedHandler.fireTimer, 2, 'source fire_timer alias');
assert.equal(sourceNamedHandler.flags, GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.SLOW);
assert.equal(sourceNamedHandler.chaining, -2);
assert.equal(sourceNamedHandler.damageReportId, 13);
assertNear(sourceNamedHandler.slowTimer, 5, 'source slow_timer alias');
writeGpuCircleContactHandler(storage, 0);
const resetHandler = readGpuCircleContactHandler(storage, 0);
assert.equal(resetHandler.damageSelf, 0);
assert.equal(resetHandler.damageOther, 0);
assert.equal(resetHandler.damageFalloff, 0);
assert.equal(resetHandler.fireTimer, 0);
assert.equal(resetHandler.flags, 0);
assert.equal(resetHandler.chaining, 0);
assert.equal(resetHandler.damageReportId, -1);
assert.equal(resetHandler.slowTimer, 0);

// host encoder는 WGSL의 f32 곱셈과 같은 단계에서 반올림한 뒤 0 방향으로 절삭합니다.
assert.equal(encodeGpuCircleBodyFixedPoint(0.29), 29);
assert.equal(encodeGpuCircleBodyFixedPoint(0.57), 57);
assert.equal(encodeGpuCircleBodyFixedPoint(1.15), 115);
assert.equal(encodeGpuCircleBodyFixedPoint(-0.29), -29);
assert.equal(encodeGpuCircleBodyFixedPoint(-0.57), -57);
assert.equal(encodeGpuCircleBodyFixedPoint(-1.15), -115);
assert.equal(encodeGpuCircleBodyFixedPoint(1.239), 123);
assert.equal(encodeGpuCircleBodyFixedPoint(21_474_834), 2_147_483_392);
assert.equal(encodeGpuCircleBodyFixedPoint(-21_474_837), -2_147_483_648);
assertThrowsNamed(() => encodeGpuCircleBodyFixedPoint(21_474_835), 'RangeError');
assertThrowsNamed(() => encodeGpuCircleBodyFixedPoint(-21_474_838), 'RangeError');

const fractionalFixedPointStorage = createGpuCircleBodyAbiStorage(1);
writeGpuCircleBodySpawn(fractionalFixedPointStorage, 0, {
    position: { x: 0, y: 0 },
    radius: 1,
    inverseMass: 1,
    bodyLayer: GPU_CIRCLE_BODY_LAYER.PROJECTILE,
    collisionMask: 0,
    interactionLayer: GPU_CIRCLE_BODY_LAYER.PROJECTILE,
    interactionMask: 0,
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    health: 0.29,
    contactHandler: {
        damageSelf: 0.29,
        damageOther: 0.57
    }
});
const fractionalFixedPointBody = readGpuCircleBody(fractionalFixedPointStorage, 0);
assert.equal(fractionalFixedPointBody.healthFixedPoint, 29);
assert.equal(
    encodeGpuCircleBodyFixedPoint(fractionalFixedPointBody.contactHandler.damageSelf),
    fractionalFixedPointBody.healthFixedPoint
);
assert.equal(
    encodeGpuCircleBodyFixedPoint(fractionalFixedPointBody.contactHandler.damageOther),
    57
);
assert.equal(decodeGpuCircleBodyFixedPoint(125), 1.25);
assert.equal(normalizeGpuCircleBodyLifetime(-1), GPU_CIRCLE_BODY_LIFETIME.IMMORTAL);
assertNear(normalizeGpuCircleBodyLifetime(2.5), 2.5, 'finite lifetime');
assert.equal(normalizeGpuCircleBodyMaximumDamageWindowDurationTicks(60), 60);

// GPU serial scan과 같은 (damage desc, entityId asc, incarnation asc) host oracle입니다.
const maximumDamageWindowCandidates = (values) => values.map((value, index) => ({
    finalDamageFixedPoint: encodeGpuCircleBodyFixedPoint(value),
    sourceEntityId: index + 10,
    sourceIncarnation: index + 1
}));
const firstPermutation = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 7,
    maximumDamageWindowDurationTicks: 60,
    candidates: maximumDamageWindowCandidates([0.1, 6])
});
const secondPermutation = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 7,
    maximumDamageWindowDurationTicks: 60,
    candidates: maximumDamageWindowCandidates([6, 0.1]).map((candidate, index) => ({
        ...candidate,
        sourceEntityId: index === 0 ? 11 : 10,
        sourceIncarnation: index === 0 ? 2 : 1
    }))
});
assert.equal(firstPermutation.appliedDamageFixedPoint, 600);
assert.equal(firstPermutation.peakFinalDamageFixedPoint, 600);
assert.equal(firstPermutation.expiresAtFixedTick, 67);
assert.equal(secondPermutation.appliedDamageFixedPoint, 600);
assert.equal(secondPermutation.peakFinalDamageFixedPoint, 600);
assert.equal(secondPermutation.expiresAtFixedTick, 67);
const threeCandidatePermutation = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 7,
    maximumDamageWindowDurationTicks: 60,
    candidates: maximumDamageWindowCandidates([2, 4, 3])
});
assert.equal(threeCandidatePermutation.appliedDamageFixedPoint, 400);
assert.equal(threeCandidatePermutation.peakFinalDamageFixedPoint, 400);
const tieProvenance = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 9,
    maximumDamageWindowDurationTicks: 60,
    candidates: [
        { finalDamageFixedPoint: 600, sourceEntityId: 2, sourceIncarnation: 1 },
        { finalDamageFixedPoint: 600, sourceEntityId: 1, sourceIncarnation: 9 }
    ]
});
assert.equal(tieProvenance.peakSourceEntityId, 1);
assert.equal(tieProvenance.peakSourceIncarnation, 9);
const suppressedSmaller = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 10,
    maximumDamageWindowDurationTicks: 60,
    peakFinalDamageFixedPoint: 600,
    expiresAtFixedTick: 69,
    peakSourceEntityId: 1,
    peakSourceIncarnation: 9,
    candidates: [{ finalDamageFixedPoint: 10, sourceEntityId: 7, sourceIncarnation: 3 }]
});
assert.equal(suppressedSmaller.appliedDamageFixedPoint, 0);
assert.equal(suppressedSmaller.peakFinalDamageFixedPoint, 600);
assert.equal(suppressedSmaller.expiresAtFixedTick, 69);
assert.equal(suppressedSmaller.damageAppliedEvent.valueFixedPoint, 0);
assert.equal(suppressedSmaller.damageAppliedEvent.sourceEntityId, 7);
assert.equal(suppressedSmaller.damageAppliedEvent.sourceIncarnation, 3);
const largerReset = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 10,
    maximumDamageWindowDurationTicks: 60,
    peakFinalDamageFixedPoint: 600,
    expiresAtFixedTick: 69,
    peakSourceEntityId: 1,
    peakSourceIncarnation: 9,
    candidates: [{ finalDamageFixedPoint: 700, sourceEntityId: 7, sourceIncarnation: 3 }]
});
assert.equal(largerReset.appliedDamageFixedPoint, 100);
assert.equal(largerReset.peakFinalDamageFixedPoint, 700);
assert.equal(largerReset.expiresAtFixedTick, 70);
assert.equal(largerReset.peakSourceEntityId, 7);
const clampedWinner = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 11,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: 125,
    candidates: [{ finalDamageFixedPoint: 600, sourceEntityId: 8, sourceIncarnation: 4 }]
});
assert.equal(clampedWinner.appliedDamageFixedPoint, 125);
assert.equal(clampedWinner.remainingHealthFixedPoint, 0);
assert.equal(clampedWinner.damageAppliedEvent.valueFixedPoint, 125);
assert.equal(clampedWinner.damageAppliedEvent.sourceEntityId, 8);
assert.equal(clampedWinner.damageAppliedEvent.sourceIncarnation, 4);
const expiredWithoutCandidate = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 70,
    maximumDamageWindowDurationTicks: 60,
    peakFinalDamageFixedPoint: 700,
    expiresAtFixedTick: 70,
    peakSourceEntityId: 7,
    peakSourceIncarnation: 3
});
assert.equal(expiredWithoutCandidate.peakFinalDamageFixedPoint, 0);
assert.equal(expiredWithoutCandidate.expiresAtFixedTick, 0);
assert.equal(
    expiredWithoutCandidate.peakSourceEntityId,
    GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
);

// 실제 연속 fixed tick 산술: 0.1→6→4→8→만료 뒤 0.1을 state chaining으로 고정합니다.
const chainedWindowFirst = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 100,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: 3000,
    candidates: [{ finalDamageFixedPoint: 10, sourceEntityId: 1, sourceIncarnation: 1 }]
});
assert.deepEqual({
    applied: chainedWindowFirst.appliedDamageFixedPoint,
    health: chainedWindowFirst.remainingHealthFixedPoint,
    peak: chainedWindowFirst.peakFinalDamageFixedPoint,
    expires: chainedWindowFirst.expiresAtFixedTick,
    source: [
        chainedWindowFirst.peakSourceEntityId,
        chainedWindowFirst.peakSourceIncarnation
    ],
    event: chainedWindowFirst.damageAppliedEvent.valueFixedPoint
}, {
    applied: 10,
    health: 2990,
    peak: 10,
    expires: 160,
    source: [1, 1],
    event: 10
});
const chainedWindowSix = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 101,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: chainedWindowFirst.remainingHealthFixedPoint,
    peakFinalDamageFixedPoint: chainedWindowFirst.peakFinalDamageFixedPoint,
    expiresAtFixedTick: chainedWindowFirst.expiresAtFixedTick,
    peakSourceEntityId: chainedWindowFirst.peakSourceEntityId,
    peakSourceIncarnation: chainedWindowFirst.peakSourceIncarnation,
    candidates: [{ finalDamageFixedPoint: 600, sourceEntityId: 2, sourceIncarnation: 1 }]
});
assert.deepEqual({
    applied: chainedWindowSix.appliedDamageFixedPoint,
    health: chainedWindowSix.remainingHealthFixedPoint,
    peak: chainedWindowSix.peakFinalDamageFixedPoint,
    expires: chainedWindowSix.expiresAtFixedTick,
    source: [chainedWindowSix.peakSourceEntityId, chainedWindowSix.peakSourceIncarnation],
    event: chainedWindowSix.damageAppliedEvent.valueFixedPoint
}, {
    applied: 590,
    health: 2400,
    peak: 600,
    expires: 161,
    source: [2, 1],
    event: 590
});
const chainedWindowFour = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 102,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: chainedWindowSix.remainingHealthFixedPoint,
    peakFinalDamageFixedPoint: chainedWindowSix.peakFinalDamageFixedPoint,
    expiresAtFixedTick: chainedWindowSix.expiresAtFixedTick,
    peakSourceEntityId: chainedWindowSix.peakSourceEntityId,
    peakSourceIncarnation: chainedWindowSix.peakSourceIncarnation,
    candidates: [{ finalDamageFixedPoint: 400, sourceEntityId: 3, sourceIncarnation: 1 }]
});
assert.deepEqual({
    applied: chainedWindowFour.appliedDamageFixedPoint,
    health: chainedWindowFour.remainingHealthFixedPoint,
    peak: chainedWindowFour.peakFinalDamageFixedPoint,
    expires: chainedWindowFour.expiresAtFixedTick,
    source: [chainedWindowFour.peakSourceEntityId, chainedWindowFour.peakSourceIncarnation],
    event: chainedWindowFour.damageAppliedEvent.valueFixedPoint,
    eventSource: [
        chainedWindowFour.damageAppliedEvent.sourceEntityId,
        chainedWindowFour.damageAppliedEvent.sourceIncarnation
    ]
}, {
    applied: 0,
    health: 2400,
    peak: 600,
    expires: 161,
    source: [2, 1],
    event: 0,
    eventSource: [3, 1]
});
const chainedWindowEight = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 103,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: chainedWindowFour.remainingHealthFixedPoint,
    peakFinalDamageFixedPoint: chainedWindowFour.peakFinalDamageFixedPoint,
    expiresAtFixedTick: chainedWindowFour.expiresAtFixedTick,
    peakSourceEntityId: chainedWindowFour.peakSourceEntityId,
    peakSourceIncarnation: chainedWindowFour.peakSourceIncarnation,
    candidates: [{ finalDamageFixedPoint: 800, sourceEntityId: 4, sourceIncarnation: 1 }]
});
assert.deepEqual({
    applied: chainedWindowEight.appliedDamageFixedPoint,
    health: chainedWindowEight.remainingHealthFixedPoint,
    peak: chainedWindowEight.peakFinalDamageFixedPoint,
    expires: chainedWindowEight.expiresAtFixedTick,
    source: [chainedWindowEight.peakSourceEntityId, chainedWindowEight.peakSourceIncarnation],
    event: chainedWindowEight.damageAppliedEvent.valueFixedPoint
}, {
    applied: 200,
    health: 2200,
    peak: 800,
    expires: 163,
    source: [4, 1],
    event: 200
});
const chainedWindowExpiry = resolveGpuCircleBodyMaximumDamageWindow({
    fixedTick: 163,
    maximumDamageWindowDurationTicks: 60,
    currentHealthFixedPoint: chainedWindowEight.remainingHealthFixedPoint,
    peakFinalDamageFixedPoint: chainedWindowEight.peakFinalDamageFixedPoint,
    expiresAtFixedTick: chainedWindowEight.expiresAtFixedTick,
    peakSourceEntityId: chainedWindowEight.peakSourceEntityId,
    peakSourceIncarnation: chainedWindowEight.peakSourceIncarnation,
    candidates: [{ finalDamageFixedPoint: 10, sourceEntityId: 5, sourceIncarnation: 1 }]
});
assert.deepEqual({
    applied: chainedWindowExpiry.appliedDamageFixedPoint,
    health: chainedWindowExpiry.remainingHealthFixedPoint,
    peak: chainedWindowExpiry.peakFinalDamageFixedPoint,
    expires: chainedWindowExpiry.expiresAtFixedTick,
    source: [
        chainedWindowExpiry.peakSourceEntityId,
        chainedWindowExpiry.peakSourceIncarnation
    ],
    event: chainedWindowExpiry.damageAppliedEvent.valueFixedPoint
}, {
    applied: 10,
    health: 2190,
    peak: 10,
    expires: 223,
    source: [5, 1],
    event: 10
});

const counts = readGpuCircleBodyCounts(storage);
assert.equal(counts.bodyCount, 1);
assert.equal(counts.additionCount, 2);
assert.equal(counts.removalCount, 3);
assert.equal(counts.abiVersion, GPU_CIRCLE_BODY_ABI_VERSION);
assert.equal(assertGpuCircleBodyAbiVersion(storage), GPU_CIRCLE_BODY_ABI_VERSION);

// GridBody도 같은 32-byte ABI로 signed/unsigned와 Float32를 round trip합니다.
const gridBuffer = createGpuCircleGridBodyBuffer(2);
writeGpuCircleGridBody(gridBuffer, 2, 1, {
    predictedPosition: { x: -10.5, y: 9.25 },
    physicsMeta,
    simulationMeta,
    interactionMeta,
    inverseMass: 0.25,
    radius: 7.5,
    bodyId: 0xfedcba98
});
const gridBody = readGpuCircleGridBody(gridBuffer, 2, 1);
assertNear(gridBody.predictedPosition.x, -10.5, 'grid predicted x');
assertNear(gridBody.predictedPosition.y, 9.25, 'grid predicted y');
assert.equal(gridBody.physicsMeta, physicsMeta);
assert.equal(gridBody.simulationMeta, simulationMeta);
assert.equal(gridBody.interactionMeta, interactionMeta);
assertNear(gridBody.inverseMass, 0.25, 'grid inverse mass');
assertNear(gridBody.radius, 7.5, 'grid radius');
assert.equal(gridBody.bodyId, 0xfedcba98);

// append는 count를 정확히 증가시키며 capacity를 넘기기 전에 명시적으로 거부합니다.
const singleSlotStorage = createGpuCircleBodyAbiStorage(1);
const spawn = {
    position: { x: 1, y: 2 },
    radius: 1,
    inverseMass: 1,
    bodyLayer: 1,
    collisionMask: 1,
    interactionLayer: 1,
    interactionMask: 0,
    teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
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
assertThrowsNamed(() => packGpuCirclePhysicsMeta(0x10000, 1), 'RangeError');
assertThrowsNamed(() => packGpuCircleInteractionMeta(1, 0x10000), 'RangeError');
assertThrowsNamed(() => packGpuCircleSimulationMeta(-1), 'RangeError');
assertThrowsNamed(() => normalizeGpuCircleBodyRenderShapeCode(7), 'RangeError');
assertThrowsNamed(() => normalizeGpuCircleBodyLifetime(-2), 'RangeError');
assertThrowsNamed(
    () => normalizeGpuCircleBodyLifetime(Number.POSITIVE_INFINITY),
    'TypeError'
);
assertThrowsNamed(() => encodeGpuCircleBodyFixedPoint(Number.NaN), 'TypeError');
assertThrowsNamed(() => encodeGpuCircleBodyFixedPoint(1, 0), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    lifetime: -2
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    health: -0.01
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    healthFixedPoint: 0x80000000
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    timer: -1
}), 'TypeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    teamId: 3
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    teamId: -1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    damagePolicyId: 1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    damageResolutionPolicyId: 2
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    damageResolutionPolicyId:
        GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    maximumDamageWindowDurationTicks: 60
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    gameplayMeta: 0x00010000
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    teamId: GAMEPLAY_TEAM_ID.HOSTILE,
    gameplayMeta: packGpuCircleGameplayMeta(GAMEPLAY_TEAM_ID.PLAYER)
}), 'RangeError');
assertThrowsNamed(() => packGpuCircleGameplayMeta(3), 'RangeError');
assertThrowsNamed(() => packGpuCircleGameplayMeta(
    GAMEPLAY_TEAM_ID.PLAYER,
    1
), 'RangeError');
assertThrowsNamed(() => unpackGpuCircleGameplayMeta(0x01000000), 'RangeError');
assertThrowsNamed(() => unpackGpuCircleGameplayMeta(3), 'RangeError');
assertThrowsNamed(() => writeGpuCircleContactHandler(storage, 0, {
    damageOther: -0.01
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleContactHandler(storage, 0, {
    flags: -1
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleContactHandler(storage, 0, {
    flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleContactHandler(storage, 0, {
    chaining: 0x80000000
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleContactHandler(storage, 0, null), 'TypeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    physicsMeta: packGpuCirclePhysicsMeta(2, 1)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    simulationMeta: packGpuCircleSimulationMeta(0)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    alive: false,
    simulationMeta: packGpuCircleSimulationMeta(GPU_CIRCLE_BODY_META.ALIVE_FLAG)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    interactionMeta: packGpuCircleInteractionMeta(2, 0)
}), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodySpawn(storage, 0, {
    ...spawn,
    countAsKill: false,
    simulationMeta: packGpuCircleSimulationMeta(
        GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
            | GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL
    )
}), 'RangeError');

// Legacy aliases are accepted only at the public normalizer and disappear from output.
assert.deepEqual({ ...normalizeGpuCircleBodyMetadata({
    layerMask: 7,
    collisionMask: 3,
    sensorMask: 5
}) }, {
    bodyLayer: 7,
    collisionMask: 3,
    interactionLayer: 7,
    interactionMask: 7
});
assert.equal(
    normalizeGpuCircleBodyContactHandler({
        sensorMask: 5,
        contactHandler: { flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY }
    }).flags,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
);
assert.equal(
    normalizeGpuCircleBodyContactHandler({
        interactionMask: 5,
        contactHandler: { flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY }
    }).flags,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY,
    'canonical producer에는 implicit policy를 추가하지 않습니다.'
);
assertThrowsNamed(() => normalizeGpuCircleBodyMetadata({
    bodyLayer: 1,
    layerMask: 2,
    collisionMask: 0,
    interactionLayer: 2,
    interactionMask: 0
}), 'RangeError');
assertThrowsNamed(() => normalizeGpuCircleBodyMetadata({
    bodyLayer: 1,
    layerMask: 1,
    collisionMask: 0,
    interactionLayer: 2,
    interactionMask: 0
}), 'RangeError');
assertThrowsNamed(() => normalizeGpuCircleBodyMetadata({
    layerMask: 1,
    collisionMask: 0,
    sensorMask: 2,
    interactionMask: 3
}), 'RangeError');

const appliedMeta = packGpuCircleAppliedEventMeta(
    GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
    GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
);
assert.deepEqual({ ...unpackGpuCircleAppliedEventMeta(appliedMeta) }, {
    type: GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
    flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
});
const maximumDamageWindowAppliedMeta = packGpuCircleAppliedEventMeta(
    GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
    GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
        | GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW
);
assert.deepEqual({ ...unpackGpuCircleAppliedEventMeta(maximumDamageWindowAppliedMeta) }, {
    type: GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED,
    flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.CONTINUOUS_POLICY
        | GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW
});
assert.equal(
    appliedMeta & GPU_CIRCLE_APPLIED_EVENT_META.TYPE_MASK,
    GPU_CIRCLE_APPLIED_EVENT_TYPE.DAMAGE_APPLIED
);

// Physics plane의 V5 binary fixture는 정확히 32 bytes이며 +24/+28 word를 보존합니다.
const fixtureStorage = createGpuCircleBodyAbiStorage(1);
writeGpuCircleBodySpawn(fixtureStorage, 0, {
    position: { x: 1, y: -2 },
    velocity: { x: 3, y: -4 },
    radius: 5,
    inverseMass: 0.5,
    bodyLayer: 0x1234,
    collisionMask: 0xabcd,
    interactionLayer: 0x5678,
    interactionMask: 0xef01,
    teamId: GAMEPLAY_TEAM_ID.HOSTILE,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
});
assert.equal(fixtureStorage.physicsBuffer.byteLength, 32);
const fixtureView = new DataView(fixtureStorage.physicsBuffer);
assert.equal(fixtureView.getUint32(24, true), 0xabcd1234);
assert.equal(fixtureView.getUint32(28, true), 0xef015678);
const gameplayFixtureView = new DataView(fixtureStorage.simulationBuffer);
assert.equal(fixtureStorage.simulationBuffer.byteLength, 32);
assert.equal(
    gameplayFixtureView.getUint32(
        GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
        true
    ),
    packGpuCircleGameplayMeta(GAMEPLAY_TEAM_ID.HOSTILE)
);

// Header mismatch is inspected but never repaired by a live writer.
const mismatchedStorage = createGpuCircleBodyAbiStorage(1);
new DataView(mismatchedStorage.countsBuffer).setUint32(
    GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
    GPU_CIRCLE_BODY_ABI_VERSION - 1,
    true
);
assert.equal(
    readGpuCircleBodyCounts(mismatchedStorage).abiVersion,
    GPU_CIRCLE_BODY_ABI_VERSION - 1
);
assertThrowsNamed(() => assertGpuCircleBodyAbiVersion(mismatchedStorage), 'RangeError');
assertThrowsNamed(() => writeGpuCircleBodyCounts(mismatchedStorage, {
    bodyCount: 0
}), 'RangeError');

console.log('gpu circle body ABI contract: ok');
