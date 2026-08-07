import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { EnemyLifecycleCommandOwner } = await loadGameModule(
    'ingame/object/enemy/enemy_lifecycle_command_owner.js'
);
const { createGpuEnemySpawnIntent } = await loadGameModule(
    'ingame/object/enemy/gpu_enemy_spawn_adapter.js'
);
const { GPU_CIRCLE_BODY_COLLISION_LAYER } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createSpawnIntent(spawnSequence = 0) {
    return createGpuEnemySpawnIntent({
        definition: {
            id: 'basic_circle_01',
            shapeType: 'square',
            moveSpeedTilesPerSecond: 2.5,
            collisionRadiusTiles: 0.5939696961966999,
            collisionWeight: 1,
            colorRgba: [1, 108 / 255, 108 / 255, 1],
            radiusScale: 1
        },
        route: {
            gateId: 'west-gate-01',
            pathId: 'west-figure-eight-core',
            waypoints: [
                { x: 3, y: 3 },
                { x: 4, y: 3 }
            ]
        },
        spawnSequence,
        waveId: 'corridor_eight_wave_01',
        policyId: 'corebound',
        laneOffsetTiles: 0
    });
}

function createProjectileIntent(overrides = {}) {
    return {
        kindId: 'projectile',
        definitionId: 'benchmark_round_01',
        spawnSequence: 7,
        sourceEntityId: 31,
        sourceIncarnation: 4,
        position: { x: 1, y: 2 },
        velocity: { x: 30, y: -2 },
        radius: 0.25,
        inverseMass: 10,
        bodyLayer: 2,
        collisionMask: 0,
        interactionLayer: 2,
        interactionMask: 129,
        health: 3,
        lifetime: 2,
        contactHandler: {
            damageSelf: 1,
            damageOther: 2.5,
            flags: 9
        },
        alive: true,
        ...overrides
    };
}

function createFakeBackend(options = {}) {
    const bodies = new Map();
    const events = [];
    let recovering = options.recovering === true;
    let runtimeState = options.runtimeState ?? (recovering ? 'gpu-backpressure' : 'gpu-ready');
    let spawnMode = options.spawnMode ?? 'accept';

    return {
        bodies,
        events,
        setRecovering(value, nextRuntimeState = value ? 'gpu-backpressure' : 'gpu-ready') {
            recovering = value === true;
            runtimeState = nextRuntimeState;
        },
        setSpawnMode(mode) {
            spawnMode = mode;
        },
        spawnBodies(spawnBodies) {
            events.push({ type: 'spawn', bodies: spawnBodies.map((body) => ({ ...body })) });
            if (spawnMode === 'reject' || spawnMode === 'reject-capacity') {
                return {
                    accepted: 0,
                    rejected: spawnBodies.length,
                    handles: [],
                    reason: spawnMode === 'reject-capacity' ? 'capacity' : 'unavailable',
                    requiresRecovery: false
                };
            }

            const handles = [];
            for (const body of spawnBodies) {
                const handle = Object.freeze({
                    entityId: body.entityId,
                    incarnation: body.incarnation
                });
                handles.push(handle);
                bodies.set(handleKey(handle), { ...body });
            }
            const requiresRecovery = spawnMode === 'accept-recovery';
            if (requiresRecovery) {
                recovering = true;
                runtimeState = 'gpu-recovery-required';
            }
            return {
                accepted: spawnBodies.length,
                rejected: 0,
                handles,
                requiresRecovery
            };
        },
        despawnBodies(handles) {
            events.push({ type: 'despawn', handles: handles.map((handle) => ({ ...handle })) });
            let removed = 0;
            for (const handle of handles) {
                if (bodies.delete(handleKey(handle))) {
                    removed++;
                }
            }
            return {
                removed,
                rejected: handles.length - removed,
                requiresRecovery: false
            };
        },
        hasBody(handle) {
            return bodies.has(handleKey(handle));
        },
        requiresRecovery() {
            return recovering;
        },
        getRuntimeState() {
            return runtimeState;
        }
    };
}

test('request는 fixed 경계 전 backend를 호출하지 않고 due command를 despawn 다음 spawn 순서로 반영한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 4 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    assert.equal(owner.requestSpawn(createSpawnIntent(0), 1, 'spawn:0').accepted, true);
    assert.deepEqual(backend.events, []);
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(registry.getReservedCount(), 0);

    const firstCommit = owner.commitAtFixedBoundary(1);
    assert.equal(firstCommit.state, 'committed');
    assert.equal(firstCommit.spawned.length, 1);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.deepEqual(backend.events.map((event) => event.type), ['spawn']);
    const firstHandle = firstCommit.spawned[0].handle;

    backend.events.length = 0;
    assert.equal(owner.requestSpawn(createSpawnIntent(1), 2, 'spawn:1').accepted, true);
    assert.equal(owner.requestDespawn(firstHandle, 'cleanup', 2, 'despawn:0').accepted, true);
    assert.deepEqual(backend.events, []);

    const secondCommit = owner.commitAtFixedBoundary(2);
    assert.equal(secondCommit.state, 'committed');
    assert.equal(secondCommit.despawned.length, 1);
    assert.equal(secondCommit.spawned.length, 1);
    assert.deepEqual(backend.events.map((event) => event.type), ['despawn', 'spawn']);
    assert.equal(registry.has(firstHandle), false);
    assert.equal(registry.has(secondCommit.spawned[0].handle), true);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(backend.bodies.size, 1);
    assert.equal(backend.events[1].bodies[0].definitionId, 'basic_circle_01');
    assert.equal(backend.events[1].bodies[0].enemyDefinitionId, 'basic_circle_01');
    assert.equal(backend.events[1].bodies[0].bodyLayer, 1);
    assert.equal(backend.events[1].bodies[0].interactionLayer, 1);
    assert.equal(
        backend.events[1].bodies[0].interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
    );
    assert.equal('layerMask' in backend.events[1].bodies[0], false);
    assert.equal('sensorMask' in backend.events[1].bodies[0], false);
});

test('generic projectile intent는 route 없이 canonical definition/layer와 nested gameplay 데이터를 보존한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);
    const intent = createProjectileIntent();

    assert.equal(owner.requestSpawn(intent, 3, 'projectile:7').accepted, true);
    intent.position.x = 999;
    intent.velocity.y = 999;
    intent.contactHandler.damageOther = 999;

    const committed = owner.commitAtFixedBoundary(3);
    assert.equal(committed.state, 'committed');
    assert.equal(committed.spawned.length, 1);
    const body = backend.events[0].bodies[0];
    assert.equal(body.kindId, 'projectile');
    assert.equal(body.definitionId, 'benchmark_round_01');
    assert.equal(body.enemyDefinitionId, undefined);
    assert.equal(body.bodyLayer, 2);
    assert.equal(body.interactionLayer, 2);
    assert.equal(body.interactionMask, 129);
    assert.equal('layerMask' in body, false);
    assert.equal('sensorMask' in body, false);
    assert.deepEqual(JSON.parse(JSON.stringify(body.position)), { x: 1, y: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(body.velocity)), { x: 30, y: -2 });
    assert.deepEqual(JSON.parse(JSON.stringify(body.contactHandler)), {
        damageSelf: 1,
        damageOther: 2.5,
        flags: 9
    });
    assert.equal(Object.isFrozen(body.position), true);
    assert.equal(Object.isFrozen(body.contactHandler), true);
    assert.equal(Number.isSafeInteger(body.entityId), true);
    assert.equal(Number.isSafeInteger(body.incarnation), true);

    const handle = committed.spawned[0].handle;
    const view = registry.copyEntityView(handle, {});
    assert.equal(view.kindId, 'projectile');
    assert.equal(view.definitionId, 'benchmark_round_01');
    assert.equal(view.metadata.definitionId, 'benchmark_round_01');
    assert.equal(view.metadata.spawnSequence, 7);
    assert.equal(view.metadata.sourceEntityId, 31);
    assert.equal(view.metadata.sourceIncarnation, 4);
});

test('layer alias 불일치는 fail-fast하고 같은 command ID 재요청을 막지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    assert.throws(
        () => owner.requestSpawn(
            createProjectileIntent({ layerMask: 4 }),
            1,
            'projectile:retry-layer'
        ),
        /bodyLayer.*layerMask/
    );
    assert.equal(
        owner.requestSpawn(
            createProjectileIntent({
                bodyLayer: undefined,
                interactionLayer: undefined,
                interactionMask: undefined,
                layerMask: 2,
                sensorMask: 129
            }),
            1,
            'projectile:retry-layer'
        ).accepted,
        true
    );
    assert.throws(() => owner.requestSpawn(createProjectileIntent({
        layerMask: 2,
        interactionLayer: 4
    }), 1, 'projectile:interaction-layer-conflict'), /interactionLayer.*layerMask/);
    assert.throws(() => owner.requestSpawn(createProjectileIntent({
        sensorMask: 1
    }), 1, 'projectile:interaction-mask-conflict'), /interactionMask.*sensorMask/);
});

test('enemy intent만 gate/path/flow를 요구하고 projectile identity 주입은 거부한다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    assert.throws(
        () => owner.requestSpawn({
            kindId: 'enemy',
            definitionId: 'enemy_without_route',
            bodyLayer: 1,
            collisionMask: 1,
            interactionLayer: 1,
            interactionMask: 0
        }, 1, 'enemy:missing-route'),
        /gateId/
    );
    assert.throws(
        () => owner.requestSpawn({
            ...createProjectileIntent(),
            incarnation: 99
        }, 1, 'projectile:forged-identity'),
        /WorldRegistry/
    );
    assert.equal(
        owner.requestSpawn(
            createProjectileIntent(),
            1,
            'projectile:no-route-required'
        ).accepted,
        true
    );
});

test('일시 unavailable spawn은 예약을 정리하되 command를 보존해 같은 tick에 재시도한다', () => {
    const backend = createFakeBackend({ spawnMode: 'reject' });
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(), 1, 'spawn:rejected');
    const commit = owner.commitAtFixedBoundary(1);

    assert.equal(commit.state, 'stalled');
    assert.equal(commit.spawned.length, 0);
    assert.equal(commit.rejected.length, 1);
    assert.equal(commit.rejected[0].code, 'unavailable');
    assert.equal(commit.recoveryRequired, true);
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 0);
    assert.deepEqual(registry.copyActiveHandlesInto([]), []);
    assert.equal(backend.bodies.size, 0);

    backend.setSpawnMode('accept');
    const retried = owner.commitAtFixedBoundary(1);
    assert.equal(retried.state, 'committed');
    assert.equal(retried.spawned.length, 1);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(backend.bodies.size, 1);
});

test('capacity spawn 거부는 command를 버리지 않고 hard recovery로 승격한다', () => {
    const backend = createFakeBackend({ spawnMode: 'reject-capacity' });
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(), 1, 'spawn:capacity');
    const commit = owner.commitAtFixedBoundary(1);

    assert.equal(commit.state, 'failed');
    assert.equal(commit.recoveryRequired, true);
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(backend.bodies.size, 0);
    assert.equal(owner.getStatus().recoveryRequired, true);
});

test('backpressure 또는 recovery gate는 pending command를 소비하지 않는다', () => {
    const backend = createFakeBackend({
        recovering: true,
        runtimeState: 'gpu-backpressure'
    });
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(), 1, 'spawn:deferred');
    const stalled = owner.commitAtFixedBoundary(1);

    assert.equal(stalled.state, 'stalled');
    assert.equal(stalled.recoveryRequired, true);
    assert.equal(stalled.backendState, 'gpu-backpressure');
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 0);
    assert.deepEqual(backend.events, []);

    backend.setRecovering(false);
    const resumed = owner.commitAtFixedBoundary(1);
    assert.equal(resumed.state, 'committed');
    assert.equal(resumed.spawned.length, 1);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
});

test('terminal backend recovery gate는 pending을 보존하며 hard failure로 latch한다', () => {
    const backend = createFakeBackend({
        recovering: true,
        runtimeState: 'gpu-terminal-unavailable'
    });
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(), 1, 'spawn:terminal-unavailable');
    const failed = owner.commitAtFixedBoundary(1);

    assert.equal(failed.state, 'failed');
    assert.equal(failed.recoveryRequired, true);
    assert.equal(failed.backendState, 'gpu-terminal-unavailable');
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(owner.getStatus().recoveryRequired, true);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 0);
    assert.deepEqual(backend.events, []);
});

test('GPU command가 없는 fixed boundary는 사용하지 않는 terminal backend 때문에 실패하지 않는다', () => {
    const backend = createFakeBackend({
        recovering: true,
        runtimeState: 'gpu-terminal-unavailable'
    });
    const registry = new WorldRegistry({ capacity: 2 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    const idleCommit = owner.commitAtFixedBoundary(1);

    assert.equal(idleCommit.state, 'committed');
    assert.equal(idleCommit.recoveryRequired, false);
    assert.equal(owner.getStatus().recoveryRequired, false);
    assert.equal(owner.getPendingCount(), 0);
    assert.deepEqual(backend.events, []);
});

test('GPU 수락 후 recovery가 필요해도 registry를 활성화하고 다음 command를 freeze한다', () => {
    const backend = createFakeBackend({ spawnMode: 'accept-recovery' });
    const registry = new WorldRegistry({ capacity: 3 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(0), 1, 'spawn:accepted-before-recovery');
    const failed = owner.commitAtFixedBoundary(1);

    assert.equal(failed.state, 'failed');
    assert.equal(failed.recoveryRequired, true);
    assert.equal(failed.backendState, 'gpu-recovery-required');
    assert.equal(failed.spawned.length, 1);
    assert.equal(failed.rejected.length, 0);
    assert.equal(owner.getPendingCount(), 0);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.has(failed.spawned[0].handle), true);
    assert.equal(backend.bodies.size, 1);

    backend.setSpawnMode('accept');
    owner.requestSpawn(createSpawnIntent(1), 2, 'spawn:frozen');
    const eventCountBeforeFreeze = backend.events.length;
    const frozen = owner.commitAtFixedBoundary(2);
    assert.equal(frozen.state, 'failed');
    assert.equal(frozen.recoveryRequired, true);
    assert.equal(owner.getPendingCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(backend.events.length, eventCountBeforeFreeze);

    assert.equal(owner.cancelAll(), 1);
    owner.destroy();
    assert.equal(owner.getStatus().destroyed, true);
    assert.throws(
        () => owner.requestSpawn(createSpawnIntent(2), 3, 'spawn:after-destroy'),
        /destroy/
    );
});

test('유효하지 않은 despawn reason은 command ID를 선점하지 않는다', () => {
    const backend = createFakeBackend();
    const registry = new WorldRegistry({ capacity: 1 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);
    const handle = { entityId: 1, incarnation: 1 };

    assert.throws(
        () => owner.requestDespawn(handle, '', 1, 'despawn:retryable'),
        /despawnReason/
    );
    assert.equal(
        owner.requestDespawn(handle, 'cleanup', 1, 'despawn:retryable').accepted,
        true
    );
    assert.equal(owner.getPendingCount(), 1);
});

test('backend 성공 응답 handle 계약이 깨져도 예약을 남기지 않고 recovery로 승격한다', () => {
    const backend = createFakeBackend();
    const originalSpawnBodies = backend.spawnBodies;
    backend.spawnBodies = (bodies) => {
        const result = originalSpawnBodies(bodies);
        return { ...result, handles: [] };
    };
    const registry = new WorldRegistry({ capacity: 1 });
    const owner = new EnemyLifecycleCommandOwner(backend, registry);

    owner.requestSpawn(createSpawnIntent(), 1, 'spawn:malformed-handles');
    const result = owner.commitAtFixedBoundary(1);

    assert.equal(result.state, 'failed');
    assert.equal(result.recoveryRequired, true);
    assert.equal(result.spawned.length, 1);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(owner.getStatus().recoveryRequired, true);
});
