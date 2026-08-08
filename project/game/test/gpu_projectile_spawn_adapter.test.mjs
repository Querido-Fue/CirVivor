import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_PROJECTILE_SPAWN_MODE,
    GPU_PROJECTILE_CONTACT_HANDLER_FLAGS,
    GPU_PROJECTILE_WORLD_KIND_ID,
    GPU_SPAWN_PROGRAM_MODE,
    PROJECTILE_TARGET_POLICY_ID,
    GpuProjectileSpawnAdapter,
    createGpuProjectileCommandId,
    createGpuProjectileSpawnIntent,
    normalizeProjectileTargetPolicyId,
    requestGpuProjectile,
    requestGpuProjectileSpawn
} = await loadGameModule(
    'ingame/gpu_simulation_endpoint.js'
);
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    createGpuCircleBodyAbiStorage,
    readGpuCircleBody,
    readGpuCircleContactHandler,
    writeGpuCircleBodySpawn
} = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

const EXPLICIT_PLAYER_ALLEGIANCE = Object.freeze({
    teamId: GAMEPLAY_TEAM_ID.PLAYER,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
});

function createDefinition(overrides = {}) {
    return {
        id: 'benchmark_round_01',
        collisionRadius: 0.2,
        mass: 0.5,
        penetration: 3,
        damage: 2.5,
        lifetimeSeconds: 2,
        colorRgba: [0.25, 0.5, 1, 1],
        radiusScale: 1.25,
        ...overrides
    };
}

function createFakeEndpoint() {
    const calls = [];
    const sourceRelativeCalls = [];
    return {
        calls,
        sourceRelativeCalls,
        requestSpawn(intent, targetFixedTick, commandId) {
            calls.push({ intent, targetFixedTick, commandId });
            return Object.freeze({
                accepted: true,
                targetFixedTick,
                commandId
            });
        },
        requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
            sourceRelativeCalls.push({ intent, targetFixedTick, commandId });
            return Object.freeze({
                accepted: true,
                targetFixedTick,
                commandId
            });
        }
    };
}

test('data definition을 guide-compatible mixed-body projectile intent로 변환한다', () => {
    const intent = createGpuProjectileSpawnIntent({
        definition: createDefinition(),
        position: { x: 10, y: 12 },
        velocity: { x: 30, y: -2 },
        spawnSequence: 9,
        sourceHandle: { entityId: 11, incarnation: 3 },
        ownerHandle: { entityId: 11, incarnation: 3 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    });

    assert.equal(GPU_PROJECTILE_WORLD_KIND_ID, 'projectile');
    assert.deepEqual(JSON.parse(JSON.stringify(intent)), {
        kindId: 'projectile',
        definitionId: 'benchmark_round_01',
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        targetPolicyId: PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN,
        spawnSequence: 9,
        sourceEntityId: 11,
        sourceIncarnation: 3,
        ownerEntityId: 11,
        ownerIncarnation: 3,
        position: { x: 10, y: 12 },
        velocity: { x: 30, y: -2 },
        radius: 0.2,
        inverseMass: 2,
        bodyLayer: 2,
        collisionMask: 0,
        interactionLayer: 2,
        interactionMask: 129,
        health: 3,
        lifetime: 2,
        contactHandler: {
            damageSelf: 1,
            damageOther: 2.5,
            flags: GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.KILL_IF_OTHER_TERRAIN
                | GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_ENTER_ONLY
        },
        alive: true,
        renderStyle: {
            color: [0.25, 0.5, 1, 1],
            radiusScale: 1.25,
            visible: true
        }
    });
    assert.equal(Object.isFrozen(intent), true);
    assert.equal(Object.isFrozen(intent.position), true);
    assert.equal(Object.isFrozen(intent.velocity), true);
    assert.equal(Object.isFrozen(intent.contactHandler), true);
    assert.equal(Object.isFrozen(intent.renderStyle), true);
    assert.equal(Object.isFrozen(intent.renderStyle.color), true);

    const storage = createGpuCircleBodyAbiStorage(1);
    writeGpuCircleBodySpawn(storage, 0, {
        ...intent,
        entityId: 1,
        incarnation: 1
    });
    const packedBody = readGpuCircleBody(storage, 0);
    const packedHandler = readGpuCircleContactHandler(storage, 0);
    assert.equal(packedBody.health, 3);
    assert.equal(packedBody.healthFixedPoint, 300);
    assert.equal(packedBody.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(
        packedBody.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(packedHandler.damageSelf, 1);
    assert.equal(packedHandler.damageOther, 2.5);
});

test('named target policy는 Team과 독립적으로 Enemy 129와 Player-damageable 640을 결정한다', () => {
    assert.equal(Object.isFrozen(PROJECTILE_TARGET_POLICY_ID), true);
    assert.deepEqual({ ...PROJECTILE_TARGET_POLICY_ID }, {
        ENEMY_AND_TERRAIN: 'enemy-and-terrain',
        PLAYER_DAMAGEABLE_AND_TERRAIN: 'player-damageable-and-terrain'
    });
    assert.equal(
        normalizeProjectileTargetPolicyId(),
        PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN
    );

    const shared = {
        definition: createDefinition(),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    };
    const hostileDefault = createGpuProjectileSpawnIntent({
        ...shared,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE
    });
    const hostileTowerTarget = createGpuProjectileSpawnIntent({
        ...shared,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    });
    const playerTowerTarget = createGpuProjectileSpawnIntent({
        ...shared,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    });

    assert.equal(
        hostileDefault.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN
    );
    assert.equal(
        hostileDefault.interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
    );
    assert.equal(hostileDefault.interactionMask, 129);
    for (const intent of [hostileTowerTarget, playerTowerTarget]) {
        assert.equal(
            intent.targetPolicyId,
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        );
        assert.equal(
            intent.interactionMask,
            GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
                | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
        );
        assert.equal(intent.interactionMask, 640);
    }
    assert.notEqual(hostileTowerTarget.teamId, playerTowerTarget.teamId);
    assert.equal(
        hostileTowerTarget.interactionMask,
        playerTowerTarget.interactionMask,
        'target policy는 projectile Team에서 추론하지 않습니다.'
    );
    assert.throws(
        () => normalizeProjectileTargetPolicyId('kinematic-obstacles'),
        /target policy/
    );
    assert.throws(() => createGpuProjectileSpawnIntent({
        ...shared,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        targetPolicyId: 'kinematic-obstacles'
    }), /target policy/);
});

test('terrain/closest contact 옵션과 inverseMass/lifetime alias를 데이터로만 해석한다', () => {
    const intent = createGpuProjectileSpawnIntent({
        definition: createDefinition({
            inverseMass: 4,
            mass: undefined,
            lifetime: 0.75,
            lifetimeSeconds: undefined,
            killOnTerrain: false,
            closestOnly: true,
            damageSelf: 2,
            colorRgba: undefined,
            radiusScale: undefined,
            visible: undefined
        }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    });

    assert.equal(intent.inverseMass, 4);
    assert.equal(intent.lifetime, 0.75);
    assert.equal(intent.contactHandler.damageSelf, 2);
    assert.equal(intent.contactHandler.flags,
        GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.CLOSEST_ONLY
            | GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_ENTER_ONLY);
    assert.equal('renderStyle' in intent, false);

    const reusableSensorIntent = createGpuProjectileSpawnIntent({
        definition: createDefinition({ damageSelf: 0 }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    });
    assert.equal(reusableSensorIntent.contactHandler.damageSelf, 0);
    const continuousIntent = createGpuProjectileSpawnIntent({
        definition: createDefinition({ continuousInteraction: true }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    });
    assert.equal(
        continuousIntent.contactHandler.flags
            & GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_CONTINUOUS,
        GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_CONTINUOUS
    );
});

test('request helper는 안정적인 command ID와 동일 intent를 endpoint에 전달한다', () => {
    const endpoint = createFakeEndpoint();
    const options = {
        endpoint,
        definition: createDefinition(),
        position: { x: 1, y: 2 },
        velocity: { x: 3, y: 4 },
        targetFixedTick: 5,
        spawnSequence: 9,
        sourceHandle: { entityId: 11, incarnation: 3 },
        commandNamespace: 'benchmark-projectile',
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        ...EXPLICIT_PLAYER_ALLEGIANCE
    };

    const first = requestGpuProjectileSpawn(options);
    const second = requestGpuProjectileSpawn(options);
    const expectedCommandId =
        'benchmark-projectile:11:3:5:9:benchmark_round_01';

    assert.equal(first.accepted, true);
    assert.equal(first.commandId, expectedCommandId);
    assert.equal(second.commandId, expectedCommandId);
    assert.equal(endpoint.calls.length, 2);
    assert.equal(endpoint.calls[0].targetFixedTick, 5);
    assert.equal(endpoint.calls[0].commandId, expectedCommandId);
    assert.deepEqual(endpoint.calls[0].intent, endpoint.calls[1].intent);
    assert.equal(endpoint.calls[0].intent.definitionId, 'benchmark_round_01');
    assert.equal(
        endpoint.calls[0].intent.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assert.equal(endpoint.calls[0].intent.interactionMask, 640);
});

test('adapter instance는 endpoint/namespace를 보관하고 explicit command ID를 허용한다', () => {
    const endpoint = createFakeEndpoint();
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'tower-projectile'
    });

    const result = adapter.requestSpawn({
        definition: createDefinition(),
        position: { x: 4, y: 5 },
        velocity: { x: 6, y: 7 },
        targetFixedTick: 8,
        spawnSequence: 2,
        commandId: 'weapon-system-owned-command',
        ...EXPLICIT_PLAYER_ALLEGIANCE
    });

    assert.equal(result.commandId, 'weapon-system-owned-command');
    assert.equal(endpoint.calls[0].commandId, 'weapon-system-owned-command');
    assert.equal(endpoint.calls[0].intent.spawnSequence, 2);
});

test('generic mode API는 velocity source-relative payload를 불변 GPU SpawnProgram ingress로 보낸다', () => {
    const endpoint = createFakeEndpoint();
    const sourceHandle = { entityId: 11, incarnation: 3 };
    const receipt = requestGpuProjectile({
        endpoint,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_VELOCITY,
        definition: createDefinition(),
        sourceHandle,
        ownerHandle: { entityId: 41, incarnation: 3 },
        positionOffset: { x: 0.25, y: -0.5 },
        launchVelocity: { x: 18, y: 0 },
        sourceVelocityScale: 0.5,
        targetFixedTick: 13,
        spawnSequence: 4,
        producerId: 'tower-primary-weapon',
        sourceAbilityId: 'primary-pointer-fire',
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        commandNamespace: 'primary-projectile'
    });

    assert.equal(receipt.accepted, true);
    assert.equal(endpoint.calls.length, 0);
    assert.equal(endpoint.sourceRelativeCalls.length, 1);
    const call = endpoint.sourceRelativeCalls[0];
    assert.equal(call.targetFixedTick, 13);
    assert.equal(
        call.commandId,
        'primary-projectile:11:3:13:4:benchmark_round_01'
    );
    assert.equal(
        call.intent.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY
    );
    assert.deepEqual({ ...call.intent.sourceHandle }, sourceHandle);
    assert.deepEqual({ ...call.intent.positionOffset }, { x: 0.25, y: -0.5 });
    assert.deepEqual({ ...call.intent.launchVelocity }, { x: 18, y: 0 });
    assert.equal(call.intent.sourceVelocityScale, 0.5);
    assert.deepEqual(
        { ...call.intent.destinationSpawn.position },
        { x: 0, y: 0 }
    );
    assert.deepEqual(
        { ...call.intent.destinationSpawn.velocity },
        { x: 0, y: 0 }
    );
    assert.equal(call.intent.destinationSpawn.sourceEntityId, 11);
    assert.equal(call.intent.destinationSpawn.sourceIncarnation, 3);
    assert.equal(call.intent.destinationSpawn.ownerEntityId, 41);
    assert.equal(call.intent.destinationSpawn.ownerIncarnation, 3);
    assert.equal('teamId' in call.intent.destinationSpawn, false);
    assert.equal(
        call.intent.destinationSpawn.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );
    assert.equal(
        call.intent.destinationSpawn.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(call.intent.destinationSpawn.producerId, 'tower-primary-weapon');
    assert.equal(call.intent.destinationSpawn.sourceAbilityId, 'primary-pointer-fire');
    assert.equal(
        call.intent.destinationSpawn.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assert.equal(call.intent.destinationSpawn.interactionMask, 640);
    assert.equal(Object.isFrozen(call.intent), true);
    assert.equal(Object.isFrozen(call.intent.sourceHandle), true);
    assert.equal(Object.isFrozen(call.intent.positionOffset), true);
    assert.equal(Object.isFrozen(call.intent.launchVelocity), true);
    assert.equal(Object.isFrozen(call.intent.destinationSpawn), true);
    assert.equal(Object.isFrozen(call.intent.destinationSpawn.position), true);
    assert.equal(Object.isFrozen(call.intent.destinationSpawn.velocity), true);
});

test('adapter aim-point mode는 CPU pose 없이 world aim/speed만 source-relative endpoint에 전달한다', () => {
    const endpoint = createFakeEndpoint();
    const adapter = new GpuProjectileSpawnAdapter(endpoint, {
        commandNamespace: 'tower-primary'
    });
    const result = adapter.requestProjectile({
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        definition: createDefinition(),
        sourceHandle: { entityId: 17, incarnation: 5 },
        positionOffset: { x: 0, y: 0 },
        aimWorldPoint: { x: -8, y: 3 },
        launchSpeed: 18,
        targetFixedTick: 21,
        spawnSequence: 7
    });

    assert.equal(result.accepted, true);
    assert.equal(endpoint.calls.length, 0);
    assert.equal(endpoint.sourceRelativeCalls.length, 1);
    const intent = endpoint.sourceRelativeCalls[0].intent;
    assert.equal(intent.modeFlags, GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT);
    assert.deepEqual({ ...intent.aimWorldPoint }, { x: -8, y: 3 });
    assert.equal(intent.launchSpeed, 18);
    assert.equal('launchVelocity' in intent, false);
    assert.equal('sourceVelocityScale' in intent, false);
    assert.equal('teamId' in intent.destinationSpawn, false);
    assert.equal(
        intent.destinationSpawn.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );
    assert.equal(Object.isFrozen(intent.aimWorldPoint), true);
});

test('target-entity mode는 exact aim handle/provenance와 default targetOffset을 Team과 독립적으로 보낸다', () => {
    const endpoint = createFakeEndpoint();
    const sourceHandle = { entityId: 31, incarnation: 2 };
    const targetHandle = { entityId: 47, incarnation: 9 };
    const receipt = requestGpuProjectile({
        endpoint,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        definition: createDefinition(),
        sourceHandle,
        targetHandle,
        positionOffset: { x: 0.25, y: -0.5 },
        launchSpeed: 12,
        targetFixedTick: 25,
        spawnSequence: 6,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        producerId: 'targeted-projectile-fixture',
        sourceAbilityId: 'exact-target-aim',
        commandNamespace: 'hostile-targeted'
    });

    assert.equal(
        GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        'source-relative-target-entity'
    );
    assert.equal(receipt.accepted, true);
    assert.equal(endpoint.sourceRelativeCalls.length, 1);
    const call = endpoint.sourceRelativeCalls[0];
    assert.equal(
        call.commandId,
        'hostile-targeted:31:2:25:6:benchmark_round_01'
    );
    assert.equal(
        call.intent.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
    );
    assert.deepEqual({ ...call.intent.sourceHandle }, sourceHandle);
    assert.deepEqual({ ...call.intent.targetHandle }, targetHandle);
    assert.deepEqual({ ...call.intent.positionOffset }, { x: 0.25, y: -0.5 });
    assert.deepEqual({ ...call.intent.targetOffset }, { x: 0, y: 0 });
    assert.equal(call.intent.launchSpeed, 12);
    assert.equal(call.intent.destinationSpawn.sourceEntityId, sourceHandle.entityId);
    assert.equal(
        call.intent.destinationSpawn.sourceIncarnation,
        sourceHandle.incarnation
    );
    assert.equal(call.intent.destinationSpawn.targetEntityId, targetHandle.entityId);
    assert.equal(
        call.intent.destinationSpawn.targetIncarnation,
        targetHandle.incarnation
    );
    assert.equal('teamId' in call.intent.destinationSpawn, false);
    assert.equal(
        call.intent.destinationSpawn.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );
    assert.equal(
        call.intent.destinationSpawn.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assert.equal(call.intent.destinationSpawn.interactionMask, 640);
    assert.equal(Object.isFrozen(call.intent), true);
    assert.equal(Object.isFrozen(call.intent.sourceHandle), true);
    assert.equal(Object.isFrozen(call.intent.targetHandle), true);
    assert.equal(Object.isFrozen(call.intent.positionOffset), true);
    assert.equal(Object.isFrozen(call.intent.targetOffset), true);
    assert.equal(Object.isFrozen(call.intent.destinationSpawn), true);
});

test('target-entity public raw Proxy는 ownKeys/source/target getter를 한 번만 materialize한다', () => {
    const endpoint = createFakeEndpoint();
    const source = { entityId: 51, incarnation: 4 };
    const firstTarget = { entityId: 61, incarnation: 7 };
    const driftTarget = { entityId: 62, incarnation: 8 };
    let ownKeysCount = 0;
    let sourceReadCount = 0;
    let targetReadCount = 0;
    const raw = {
        endpoint,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        definition: createDefinition(),
        positionOffset: { x: 0, y: 0 },
        targetOffset: { x: 1, y: -2 },
        launchSpeed: 12,
        targetFixedTick: 26,
        spawnSequence: 7
    };
    Object.defineProperty(raw, 'sourceHandle', {
        enumerable: true,
        configurable: true,
        get() {
            sourceReadCount++;
            return source;
        }
    });
    Object.defineProperty(raw, 'targetHandle', {
        enumerable: true,
        configurable: true,
        get() {
            targetReadCount++;
            return targetReadCount === 1 ? firstTarget : driftTarget;
        }
    });
    const proxied = new Proxy(raw, {
        ownKeys(target) {
            ownKeysCount++;
            return Reflect.ownKeys(target);
        }
    });

    assert.equal(requestGpuProjectile(proxied).accepted, true);
    assert.equal(ownKeysCount, 1);
    assert.equal(sourceReadCount, 1);
    assert.equal(targetReadCount, 1);
    const intent = endpoint.sourceRelativeCalls[0].intent;
    assert.deepEqual({ ...intent.sourceHandle }, source);
    assert.deepEqual({ ...intent.targetHandle }, firstTarget);
    assert.notDeepEqual({ ...intent.targetHandle }, driftTarget);
    assert.equal(intent.destinationSpawn.targetEntityId, firstTarget.entityId);
    assert.deepEqual({ ...intent.targetOffset }, { x: 1, y: -2 });
});

test('aim-point/target-entity launchSpeed의 float32 underflow는 endpoint 호출 전에 거부한다', () => {
    const endpoint = createFakeEndpoint();
    const definition = createDefinition();
    const sourceHandle = { entityId: 71, incarnation: 3 };
    const common = {
        endpoint,
        definition,
        sourceHandle,
        positionOffset: { x: 0, y: 0 },
        launchSpeed: 1e-50,
        targetFixedTick: 27,
        spawnSequence: 8
    };

    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        aimWorldPoint: { x: 1, y: 0 }
    }), /launchSpeed/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        targetHandle: { entityId: 72, incarnation: 4 }
    }), /launchSpeed/);

    assert.equal(endpoint.calls.length, 0);
    assert.equal(endpoint.sourceRelativeCalls.length, 0);
});

test('generic mode API는 mode별 absolute/source-relative forbidden field를 fail-fast한다', () => {
    const endpoint = createFakeEndpoint();
    const definition = createDefinition();
    const sourceHandle = { entityId: 11, incarnation: 3 };
    const common = {
        endpoint,
        definition,
        targetFixedTick: 5,
        spawnSequence: 1
    };

    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.ABSOLUTE,
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        launchSpeed: 18
    }), /ABSOLUTE mode/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        sourceHandle,
        position: { x: 0, y: 0 },
        positionOffset: { x: 0, y: 0 },
        aimWorldPoint: { x: 1, y: 0 },
        launchSpeed: 18
    }), /position/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        sourceHandle,
        positionOffset: { x: 0, y: 0 },
        aimWorldPoint: { x: 1, y: 0 },
        launchSpeed: 18,
        sourceVelocityScale: 0
    }), /sourceVelocityScale/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_VELOCITY,
        sourceHandle,
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        aimWorldPoint: { x: 1, y: 0 }
    }), /aimWorldPoint/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle: { entityId: 12, incarnation: 4 },
        positionOffset: { x: 0, y: 0 },
        aimWorldPoint: { x: 1, y: 0 },
        launchSpeed: 12
    }), /aimWorldPoint/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        positionOffset: { x: 0, y: 0 },
        launchSpeed: 12
    }), /targetHandle/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle: { entityId: 12, incarnation: 4 },
        launchSpeed: 12
    }), /positionOffset/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle: { entityId: 12, incarnation: 4 },
        positionOffset: { x: 0, y: 0 },
        targetOffset: { x: 1e100, y: 0 },
        launchSpeed: 12
    }), /float32/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        sourceHandle,
        targetHandle: { entityId: 12, incarnation: 4 },
        positionOffset: { x: 0, y: 0 },
        aimWorldPoint: { x: 1, y: 0 },
        launchSpeed: 12
    }), /targetHandle/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle: { entityId: 12, incarnation: 4 },
        targetEntityId: 13,
        targetIncarnation: 5,
        positionOffset: { x: 0, y: 0 },
        launchSpeed: 12
    }), /targetEntityId/);
    assert.throws(() => requestGpuProjectile({
        ...common,
        mode: 'tracked-pose-relative',
        sourceHandle,
        positionOffset: { x: 0, y: 0 }
    }), /지원하지 않는/);
    assert.equal(endpoint.calls.length, 0);
    assert.equal(endpoint.sourceRelativeCalls.length, 0);
});

test('command ID helper와 spawn intent는 잘못된 identity/수치를 fail-fast한다', () => {
    assert.equal(createGpuProjectileCommandId({
        definitionId: 'round/a',
        targetFixedTick: 4,
        spawnSequence: 0,
        commandNamespace: 'projectile test'
    }), 'projectile%20test:session:4:0:round%2Fa');

    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition(),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        entityId: 99,
        ...EXPLICIT_PLAYER_ALLEGIANCE
    }), /WorldRegistry/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ penetration: 0 }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    }), /penetration/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ lifetimeSeconds: Infinity }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    }), /lifetimeSeconds/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ damage: 0x7fffffff }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 },
        ...EXPLICIT_PLAYER_ALLEGIANCE
    }), /int32/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition(),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 }
    }), /EXPLICIT_OVERRIDE/);
    assert.throws(() => createGpuProjectileCommandId({
        definitionId: 'round',
        targetFixedTick: 0,
        spawnSequence: 0
    }), /targetFixedTick/);
});
