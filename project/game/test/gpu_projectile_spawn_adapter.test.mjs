import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_PROJECTILE_CONTACT_HANDLER_FLAGS,
    GPU_PROJECTILE_WORLD_KIND_ID,
    GpuProjectileSpawnAdapter,
    createGpuProjectileCommandId,
    createGpuProjectileSpawnIntent,
    requestGpuProjectileSpawn
} = await loadGameModule(
    'ingame/gpu_simulation_endpoint.js'
);
const {
    createGpuCircleBodyAbiStorage,
    readGpuCircleBody,
    readGpuCircleContactHandler,
    writeGpuCircleBodySpawn
} = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);

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
    return {
        calls,
        requestSpawn(intent, targetFixedTick, commandId) {
            calls.push({ intent, targetFixedTick, commandId });
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
        sourceHandle: { entityId: 11, incarnation: 3 }
    });

    assert.equal(GPU_PROJECTILE_WORLD_KIND_ID, 'projectile');
    assert.deepEqual(JSON.parse(JSON.stringify(intent)), {
        kindId: 'projectile',
        definitionId: 'benchmark_round_01',
        spawnSequence: 9,
        sourceEntityId: 11,
        sourceIncarnation: 3,
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
    assert.equal(packedHandler.damageSelf, 1);
    assert.equal(packedHandler.damageOther, 2.5);
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
        velocity: { x: 1, y: 0 }
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
        velocity: { x: 1, y: 0 }
    });
    assert.equal(reusableSensorIntent.contactHandler.damageSelf, 0);
    const continuousIntent = createGpuProjectileSpawnIntent({
        definition: createDefinition({ continuousInteraction: true }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 }
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
        commandNamespace: 'benchmark-projectile'
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
        commandId: 'weapon-system-owned-command'
    });

    assert.equal(result.commandId, 'weapon-system-owned-command');
    assert.equal(endpoint.calls[0].commandId, 'weapon-system-owned-command');
    assert.equal(endpoint.calls[0].intent.spawnSequence, 2);
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
        entityId: 99
    }), /WorldRegistry/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ penetration: 0 }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 }
    }), /penetration/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ lifetimeSeconds: Infinity }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 }
    }), /lifetimeSeconds/);
    assert.throws(() => createGpuProjectileSpawnIntent({
        definition: createDefinition({ damage: 0x7fffffff }),
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 0 }
    }), /int32/);
    assert.throws(() => createGpuProjectileCommandId({
        definitionId: 'round',
        targetFixedTick: 0,
        spawnSequence: 0
    }), /targetFixedTick/);
});
