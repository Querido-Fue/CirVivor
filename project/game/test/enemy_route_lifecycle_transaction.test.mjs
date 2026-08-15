import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORK_DUAL_ROUTE_MAP_DATA
} = await loadGameModule('data/scene/game/cork_dual_route_map_data.js');
const {
    CORK_DUAL_ROUTE_WAVE_01_DATA
} = await loadGameModule('data/scene/game/cork_dual_route_wave_01_data.js');
const {
    BASIC_CORK_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/basic_cork_enemy_data.js');
const { TileMap } = await loadGameModule('ingame/map/tile_map.js');
const { createRouteFlowFieldAtlas } = await loadGameModule(
    'ingame/navigation/route_flow_field_atlas.js'
);
const {
    createAllOpenRouteAvailabilitySelectionSnapshot
} = await loadGameModule('ingame/contract/route_availability_contract.js');
const {
    GPU_ROUTE_LIFECYCLE_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_route_runtime_abi.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');
const {
    ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION,
    EnemyLifecycleCommandOwner
} = await loadGameModule(
    'ingame/object/enemy/enemy_lifecycle_command_owner.js'
);

function createTerminalCleanupAuthority() {
    const permits = new WeakSet();
    return Object.freeze({
        port: Object.freeze({
            consumePermit(permit) {
                if (!permits.has(permit)) {
                    return false;
                }
                permits.delete(permit);
                return true;
            }
        }),
        issuePermit() {
            const permit = Object.freeze({});
            permits.add(permit);
            return permit;
        }
    });
}

function keyOf(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class FakeRegistry {
    constructor(log) {
        this.log = log;
        this.nextEntityId = 1;
        this.revision = 0;
        this.reserved = new Map();
        this.active = new Map();
    }

    reserveEntity(descriptor) {
        const handle = Object.freeze({
            entityId: this.nextEntityId++,
            incarnation: 1
        });
        this.reserved.set(keyOf(handle), Object.freeze({ ...descriptor, handle }));
        this.log.push(`registry-reserve:${keyOf(handle)}`);
        return handle;
    }

    activateReserved(handle, metadata) {
        const key = keyOf(handle);
        const descriptor = this.reserved.get(key);
        if (!descriptor) {
            return false;
        }
        this.reserved.delete(key);
        this.active.set(key, Object.freeze({
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            kindId: descriptor.kindId,
            definitionId: descriptor.definitionId,
            createdAtTick: descriptor.createdAtTick,
            metadata
        }));
        this.revision++;
        this.log.push(`registry-activate:${key}`);
        return true;
    }

    cancelReservation(handle) {
        this.log.push(`registry-cancel:${keyOf(handle)}`);
        return this.reserved.delete(keyOf(handle));
    }

    remove(handle) {
        const removed = this.active.delete(keyOf(handle));
        if (removed) {
            this.revision++;
            this.log.push(`registry-remove:${keyOf(handle)}`);
        }
        return removed;
    }

    has(handle) {
        return this.active.has(keyOf(handle));
    }

    copyEntityView(handle, out = {}) {
        const view = this.active.get(keyOf(handle));
        if (!view) {
            return null;
        }
        Object.assign(out, view);
        return out;
    }

    getRevision() {
        return this.revision;
    }
}

class FakeBackend {
    constructor(log) {
        this.log = log;
        this.bodies = new Map();
    }

    spawnBodies(bodies) {
        this.log.push(`backend-spawn:${bodies.length}`);
        for (const body of bodies) {
            this.bodies.set(keyOf(body), Object.freeze(body));
        }
        return Object.freeze({
            accepted: bodies.length,
            rejected: 0,
            handles: Object.freeze(bodies.map(({ entityId, incarnation }) => (
                Object.freeze({ entityId, incarnation })
            ))),
            requiresRecovery: false
        });
    }

    despawnBodies(handles) {
        this.log.push(`backend-despawn:${handles.length}`);
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodies.delete(keyOf(handle)) ? 1 : 0;
        }
        return Object.freeze({
            removed,
            rejected: handles.length - removed,
            requiresRecovery: false
        });
    }

    hasBody(handle) {
        return this.bodies.has(keyOf(handle));
    }

    requiresRecovery() {
        return false;
    }

    getRuntimeState() {
        return 'ready';
    }
}

function createRoutePort(log, atlas, options = {}) {
    let rosterCount = 0;
    let epoch = 0;
    const preflights = [];
    const commits = [];
    return Object.freeze({
        preflights,
        commits,
        preflightRouteLifecycleBatch(request) {
            preflights.push(request);
            log.push(
                `route-preflight:${request.spawnPlans.length}:${request.despawnPlans.length}`
            );
            assert.notEqual(
                request.spawnPlans.length > 0,
                request.despawnPlans.length > 0
            );
            if (options.preflightRecovery === true) {
                return Object.freeze({
                    abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                    accepted: false,
                    requiresRecovery: true,
                    reason: 'synthetic-route-preflight-recovery'
                });
            }
            return Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: true,
                requiresRecovery: false,
                targetFixedTick: request.targetFixedTick,
                batchIdFingerprint: request.batchIdFingerprint,
                spawnReservationCount: request.spawnPlans.length,
                cleanupReservationCount: request.despawnPlans.length,
                receipt: Object.freeze({
                    request
                })
            });
        },
        commitRouteLifecycleBatch(receipt, publication) {
            commits.push(Object.freeze({ receipt, publication }));
            log.push(
                `route-commit:${publication.spawned.length}:${publication.despawned.length}`
            );
            rosterCount += publication.spawned.length;
            rosterCount -= publication.despawned.length;
            epoch++;
            const committedCount = options.commitCountMismatch === true
                ? publication.spawned.length + 1
                : publication.spawned.length;
            return Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: true,
                requiresRecovery: false,
                targetFixedTick: publication.targetFixedTick,
                batchIdFingerprint: publication.batchIdFingerprint,
                spawnedCount: committedCount,
                cleanedCount: publication.despawned.length,
                runtimeBinding: Object.freeze({
                    abiVersion: 1,
                    sessionGeneration: 1,
                    deviceGeneration: 0,
                    authoritativeEpoch: epoch,
                    graphContentKey: atlas.contentKey,
                    availabilityVersion: 1,
                    rosterCount
                })
            });
        },
        cancelRouteLifecycleBatch(receipt, reason) {
            log.push(`route-cancel:${reason}`);
            return Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: true,
                reason,
                cancelledSpawnReservationCount:
                    receipt.request.spawnPlans.length,
                cancelledCleanupReservationCount:
                    receipt.request.despawnPlans.length
            });
        }
    });
}

function collectAuthoredRequests() {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const availability = createAllOpenRouteAvailabilitySelectionSnapshot(
        atlas.contentKey,
        1
    );
    const wave = new WaveDirector({
        waveDefinition: CORK_DUAL_ROUTE_WAVE_01_DATA
    });
    wave.init(tileMap);
    const requests = [];
    const sink = {
        requestSpawnBatch(batch) {
            requests.push(...batch);
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    };
    wave.queueSpawnsForFixedTick(1, sink, availability);
    wave.queueSpawnsForFixedTick(902, sink, availability);
    return Object.freeze({ tileMap, atlas, requests: Object.freeze(requests) });
}

test('Cork spawn/despawn은 reserve-preflight-publication-route-commit 순서를 지킨다', () => {
    const { atlas, requests } = collectAuthoredRequests();
    const corkRequest = requests.find(
        ({ intent }) => intent.definitionId === BASIC_CORK_ENEMY_DEFINITION_ID
    );
    assert.ok(corkRequest);
    const log = [];
    const registry = new FakeRegistry(log);
    const backend = new FakeBackend(log);
    const routePort = createRoutePort(log, atlas);
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        routeLifecyclePort: routePort
    });

    assert.deepEqual(owner.requestSpawnBatch([corkRequest]), {
        accepted: true,
        requestedCount: 1,
        queuedCount: 1
    });
    const spawnResult = owner.commitAtFixedBoundary(1);
    assert.equal(spawnResult.recoveryRequired, false);
    assert.equal(spawnResult.spawned.length, 1);
    assert.equal(spawnResult.routeLifecycle.length, 1);
    assert.equal(spawnResult.routeLifecycle[0].action, 'spawn');
    assert.equal(spawnResult.routeRuntimeBinding.rosterCount, 1);
    const handle = spawnResult.spawned[0].handle;
    const body = backend.bodies.get(keyOf(handle));
    assert.equal(body.routeRuntimeState.selfEntityId, handle.entityId);
    assert.equal(body.routeRuntimeState.selfIncarnation, handle.incarnation);
    assert.equal(body.routeRuntimeState.routeSetId, corkRequest.intent.routeSetId);
    assert.equal(routePort.preflights[0].spawnPlans[0].handle, handle);
    assert.deepEqual(log.slice(0, 4), [
        `registry-reserve:${keyOf(handle)}`,
        'route-preflight:1:0',
        'backend-spawn:1',
        `registry-activate:${keyOf(handle)}`
    ]);
    assert.equal(log[4], 'route-commit:1:0');

    const despawnRequest = owner.requestDespawn(
        handle,
        'gpu-death',
        2,
        'cork-despawn:1'
    );
    assert.equal(despawnRequest.accepted, true);
    const beforeDespawn = log.length;
    const despawnResult = owner.commitAtFixedBoundary(2);
    assert.equal(despawnResult.recoveryRequired, false);
    assert.equal(despawnResult.despawned.length, 1);
    assert.equal(despawnResult.routeLifecycle[0].action, 'cleanup');
    assert.equal(despawnResult.routeRuntimeBinding.rosterCount, 0);
    assert.equal(registry.has(handle), false);
    assert.equal(backend.hasBody(handle), false);
    assert.deepEqual(log.slice(beforeDespawn), [
        'route-preflight:0:1',
        'backend-despawn:1',
        `registry-remove:${keyOf(handle)}`,
        'route-commit:0:1'
    ]);
});

test('실제 blocker cap보다 많은 Cork도 모두 prospective route body로 생성된다', () => {
    const { atlas, requests } = collectAuthoredRequests();
    const corkRequest = requests.find(
        ({ intent }) => intent.definitionId === BASIC_CORK_ENEMY_DEFINITION_ID
    );
    const log = [];
    const registry = new FakeRegistry(log);
    const backend = new FakeBackend(log);
    const routePort = createRoutePort(log, atlas);
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        routeLifecyclePort: routePort
    });

    const candidateCount = 9;
    const batch = Array.from({ length: candidateCount }, (_, index) => (
        Object.freeze({
            ...corkRequest,
            commandId: `prospective-cork:${index}`
        })
    ));
    owner.requestSpawnBatch(batch);
    const spawnResult = owner.commitAtFixedBoundary(1);
    assert.equal(spawnResult.recoveryRequired, false);
    assert.equal(spawnResult.spawned.length, candidateCount);
    assert.equal(spawnResult.routeLifecycle.length, candidateCount);
    assert.equal(spawnResult.routeRuntimeBinding.rosterCount, candidateCount);
    assert.equal(spawnResult.rejected.length, 0);
    assert.equal(routePort.preflights[0].spawnPlans.length, candidateCount);
    for (const { handle } of spawnResult.spawned) {
        const body = backend.bodies.get(keyOf(handle));
        assert.equal(body.routeRuntimeState.selfEntityId, handle.entityId);
        assert.equal(body.routeRuntimeState.selfIncarnation, handle.incarnation);
        assert.equal(body.routeSetId, corkRequest.intent.routeSetId);
    }
});

test('route commit proof mismatch는 이미 게시된 registry/backend를 sticky recovery로 봉인한다', () => {
    const { atlas, requests } = collectAuthoredRequests();
    const corkRequest = requests.find(
        ({ intent }) => intent.definitionId === BASIC_CORK_ENEMY_DEFINITION_ID
    );
    const log = [];
    const registry = new FakeRegistry(log);
    const backend = new FakeBackend(log);
    const routePort = createRoutePort(log, atlas, { commitCountMismatch: true });
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        routeLifecyclePort: routePort
    });

    owner.requestSpawnBatch([corkRequest]);
    const result = owner.commitAtFixedBoundary(1);
    assert.equal(result.recoveryRequired, true);
    assert.equal(result.state, 'failed');
    assert.equal(result.spawned.length, 1);
    assert.equal(result.routeLifecycle.length, 0);
    assert.equal(result.routeRuntimeBinding, null);
    assert.equal(registry.has(result.spawned[0].handle), true);
    assert.equal(backend.hasBody(result.spawned[0].handle), true);
    assert.ok(result.rejected.some(({ code }) => code === 'route-spawn-commit'));
});

test('authentic Cork terminal despawn만 lifecycle close를 통과해 route cleanup과 결속된다', () => {
    const { atlas, requests } = collectAuthoredRequests();
    const corkRequest = requests.find(
        ({ intent }) => intent.definitionId === BASIC_CORK_ENEMY_DEFINITION_ID
    );
    const log = [];
    const registry = new FakeRegistry(log);
    const backend = new FakeBackend(log);
    const routePort = createRoutePort(log, atlas);
    const terminalAuthority = createTerminalCleanupAuthority();
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        routeLifecyclePort: routePort,
        terminalCleanupAuthority: terminalAuthority.port
    });
    owner.requestSpawnBatch([corkRequest]);
    const spawnResult = owner.commitAtFixedBoundary(1);
    const handle = spawnResult.spawned[0].handle;
    const terminalRequest = owner.requestDespawn(
        handle,
        ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION,
        2,
        'cork-route-terminal:2:1:1',
        Object.freeze({
            disposition: ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
        }),
        terminalAuthority.issuePermit()
    );
    assert.equal(terminalRequest.accepted, true);
    assert.equal(terminalRequest.authenticTerminalCleanup, true);
    assert.equal(owner.closeIngress('test-terminal').preservedCleanupCount, 1);

    const result = owner.commitAtFixedBoundary(2);
    assert.equal(result.recoveryRequired, false);
    assert.equal(result.despawned.length, 1);
    assert.equal(result.despawned[0].disposition,
        ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION);
    assert.equal(result.despawned[0].bountyEligible, false);
    assert.equal(result.routeLifecycle[0].action, 'cleanup');
    assert.equal(result.routeRuntimeBinding.rosterCount, 0);
});
