import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORK_DUAL_ROUTE_LOWER_CLOSURE_ID,
    CORK_DUAL_ROUTE_LOWER_PATH_ID,
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_ROUTE_SET_ID,
    CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
    CORK_DUAL_ROUTE_UPPER_PATH_ID
} = await loadGameModule('data/scene/game/cork_dual_route_map_data.js');
const {
    CORK_DUAL_ROUTE_WAVE_01_DATA
} = await loadGameModule('data/scene/game/cork_dual_route_wave_01_data.js');
const {
    BASIC_SQUARE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    AUTHORED_FORMATION_COORDINATE_SYSTEM,
    AUTHORED_FORMATION_SPAWN_MODE,
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} = await loadGameModule('ingame/flow/authored_wave_timeline_contract.js');
const { TileMap, createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    createRouteFlowFieldAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');
const {
    ROUTE_AVAILABILITY_ABI_VERSION,
    createAllOpenRouteAvailabilitySelectionSnapshot,
    normalizeRouteAvailabilitySelectionSnapshot,
    selectOpenRoutePathId
} = await loadGameModule('ingame/contract/route_availability_contract.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');
const {
    CorkRouteClosureDirector
} = await loadGameModule('ingame/object/enemy/cork_route_closure_director.js');

function createRuntimeStatus(atlas, overrides = {}) {
    return Object.freeze({
        abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        graphContentKey: atlas.contentKey,
        availabilityVersion: 1,
        closedPathIds: Object.freeze([]),
        rosterCount: 0,
        leaseCount: 0,
        capacity: 8,
        stagedCount: 0,
        commitRequested: false,
        pendingReadbackCount: 0,
        completedThroughTick: 0,
        requiresRecovery: false,
        failure: null,
        terminal: null,
        ingressOpen: true,
        ...overrides
    });
}

function createCompletion(atlas, overrides = {}) {
    return Object.freeze({
        abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        graphContentKey: atlas.contentKey,
        availabilityVersion: 1,
        closedPathIds: Object.freeze([]),
        sourceTick: 1,
        completedThroughTick: 1,
        batchIdFingerprint: 101,
        pending: false,
        protocolFailure: null,
        status: 0,
        errorFlags: 0,
        assignments: Object.freeze([]),
        closures: Object.freeze([]),
        reopens: Object.freeze([]),
        cleanups: Object.freeze([]),
        ...overrides
    });
}

function createRouteRecord({
    handle,
    pathId = CORK_DUAL_ROUTE_UPPER_PATH_ID,
    closureId = CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
    sourceTick,
    availabilityVersion,
    leaseGeneration = 1
}) {
    return Object.freeze({
        ownerHandle: handle,
        routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID,
        pathId,
        closureId,
        leaseGeneration,
        sourceTick,
        availabilityVersion
    });
}

function createLifecycleEntry(action, handle, fixedTick, fingerprint) {
    return Object.freeze({
        action,
        commandId: `route-${action}:${fixedTick}`,
        commandIdFingerprint: fingerprint,
        handle,
        targetFixedTick: fixedTick,
        batchIdFingerprint: fingerprint + 1000
    });
}

function createBinding(atlas, overrides = {}) {
    return Object.freeze({
        abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        graphContentKey: atlas.contentKey,
        availabilityVersion: 1,
        rosterCount: 0,
        ...overrides
    });
}

test('optional routeGraph를 immutable atlas topology와 positive all-open snapshot으로 컴파일한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const repeated = createRouteFlowFieldAtlas(tileMap);
    const graph = tileMap.getRouteGraph();

    assert.ok(Object.isFrozen(graph));
    assert.equal(atlas.contentKey, repeated.contentKey);
    assert.equal(atlas.routeGraph.version, 1);
    assert.equal(atlas.routeGraph.paths.length, 2);
    assert.equal(atlas.routeGraph.routeSets.length, 1);
    assert.equal(atlas.routeGraph.routeCandidates.length, 2);
    assert.equal(atlas.routeGraph.switches.length, 1);
    assert.equal(atlas.routeGraph.transitions.length, 2);
    assert.equal(atlas.routeGraph.closures.length, 2);
    assert.deepEqual(
        atlas.routeGraph.paths.map(({ pathId }) => pathId),
        [CORK_DUAL_ROUTE_UPPER_PATH_ID, CORK_DUAL_ROUTE_LOWER_PATH_ID]
    );
    assert.ok(atlas.routeGraph.memberships.some(({ fieldIndex }) => fieldIndex === -1));

    const allOpen = createAllOpenRouteAvailabilitySelectionSnapshot(
        atlas.contentKey,
        1
    );
    assert.equal(
        selectOpenRoutePathId(graph, CORK_DUAL_ROUTE_ROUTE_SET_ID, allOpen),
        CORK_DUAL_ROUTE_UPPER_PATH_ID
    );
    const upperClosed = normalizeRouteAvailabilitySelectionSnapshot({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 2,
        closedPathIds: [CORK_DUAL_ROUTE_UPPER_PATH_ID]
    }, graph);
    assert.equal(
        selectOpenRoutePathId(graph, CORK_DUAL_ROUTE_ROUTE_SET_ID, upperClosed),
        CORK_DUAL_ROUTE_LOWER_PATH_ID
    );
    const allClosed = normalizeRouteAvailabilitySelectionSnapshot({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 3,
        closedPathIds: [
            CORK_DUAL_ROUTE_LOWER_PATH_ID,
            CORK_DUAL_ROUTE_UPPER_PATH_ID
        ]
    }, graph);
    assert.equal(
        selectOpenRoutePathId(graph, CORK_DUAL_ROUTE_ROUTE_SET_ID, allClosed),
        null
    );
    assert.throws(
        () => createAllOpenRouteAvailabilitySelectionSnapshot(atlas.contentKey, 0),
        /positive non-sentinel/
    );
    assert.throws(
        () => createAllOpenRouteAvailabilitySelectionSnapshot(
            atlas.contentKey,
            0xffffffff
        ),
        /positive non-sentinel/
    );

    const legacyAtlas = createRouteFlowFieldAtlas(createTileMap());
    assert.equal(legacyAtlas.routeGraph, null);
});

test('WaveDirector는 all-closed backlog만 보류하고 sink false/throw에서 상태를 롤백한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const allOpen = createAllOpenRouteAvailabilitySelectionSnapshot(
        atlas.contentKey,
        1
    );
    const director = new WaveDirector({
        waveDefinition: CORK_DUAL_ROUTE_WAVE_01_DATA
    });
    assert.equal(director.init(tileMap), true);
    const initialStatus = director.getStatus();

    assert.throws(() => director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch() {
            return Object.freeze({ accepted: false, requestedCount: 1, queuedCount: 0 });
        }
    }, allOpen), /atomic spawn batch queue/);
    assert.deepEqual(director.getStatus(), initialStatus);
    assert.throws(() => director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch() {
            throw new Error('synthetic sink failure');
        }
    }, allOpen), /synthetic sink failure/);
    assert.deepEqual(director.getStatus(), initialStatus);

    const allClosed = Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 2,
        closedPathIds: Object.freeze([
            CORK_DUAL_ROUTE_UPPER_PATH_ID,
            CORK_DUAL_ROUTE_LOWER_PATH_ID
        ])
    });
    let sinkCallCount = 0;
    assert.equal(director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch() {
            sinkCallCount++;
            throw new Error('all-closed backlog은 sink를 호출하면 안 됩니다.');
        }
    }, allClosed), 0);
    assert.equal(sinkCallCount, 0);
    assert.equal(director.getStatus().blockedSpawnCount, 1);

    const requests = [];
    const lowerOpen = Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 3,
        closedPathIds: Object.freeze([CORK_DUAL_ROUTE_UPPER_PATH_ID])
    });
    assert.equal(director.queueSpawnsForFixedTick(2, {
        requestSpawnBatch(batch) {
            requests.push(...batch);
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    }, lowerOpen), 1);
    assert.equal(requests[0].targetFixedTick, 2);
    assert.equal(requests[0].intent.pathId, CORK_DUAL_ROUTE_LOWER_PATH_ID);
    assert.equal(requests[0].intent.routeSetId, CORK_DUAL_ROUTE_ROUTE_SET_ID);
    assert.equal(requests[0].intent.routeAvailabilityVersion, 3);
    assert.equal(requests[0].intent.routeGraphContentKey, atlas.contentKey);
    assert.equal(director.getStatus().blockedSpawnCount, 0);
    assert.equal(director.getStatus().queuedSpawnCount, 1);
    const beforeRegression = director.getStatus();
    assert.throws(() => director.queueSpawnsForFixedTick(902, {
        requestSpawnBatch() {
            throw new Error('regressed snapshot은 sink에 도달하면 안 됩니다.');
        }
    }, Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 2,
        closedPathIds: Object.freeze([])
    })), /version이 회귀/);
    assert.deepEqual(director.getStatus(), beforeRegression);
    assert.throws(() => director.queueSpawnsForFixedTick(902, {
        requestSpawnBatch() {
            throw new Error('same-version conflict는 sink에 도달하면 안 됩니다.');
        }
    }, Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 3,
        closedPathIds: Object.freeze([])
    })), /same-version/);
    assert.deepEqual(director.getStatus(), beforeRegression);
});

test('sequential formation은 mid-spawn 폐쇄에서 원래 route를 고정하고 남은 row 전체를 backlog한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const director = new WaveDirector({
        waveDefinition: Object.freeze({
            waveId: 'cork-formation-mid-spawn-contract',
            mapId: CORK_DUAL_ROUTE_MAP_DATA.id,
            timeline: Object.freeze([Object.freeze({
                timelineEntryId: 'two-sequential-rows',
                type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
                formation: Object.freeze({
                    groupId: 'pinned-upper-formation',
                    memberCount: 4,
                    coordinateSystem:
                        AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE,
                    spawnMode:
                        AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
                    rowDelayTicks: 1,
                    keepFormation: false,
                    layout: Object.freeze(['SS', 'SS']),
                    symbolMap: Object.freeze({
                        S: BASIC_SQUARE_ENEMY_DATA.id
                    }),
                    routeBinding: Object.freeze({
                        routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID
                    }),
                    policyId: 'corebound',
                    rowSpacingTiles: 1,
                    columnSpacingTiles: 1
                })
            })])
        })
    });
    assert.equal(director.init(tileMap), true);
    const batches = [];
    const sink = {
        requestSpawnBatch(batch) {
            batches.push(batch);
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    };
    const snapshot = (availabilityVersion, closedPathIds) => Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion,
        closedPathIds: Object.freeze(closedPathIds)
    });

    assert.equal(director.queueSpawnsForFixedTick(
        1,
        sink,
        snapshot(1, [])
    ), 2);
    assert.equal(batches.length, 1);
    assert.deepEqual(
        batches[0].map(({ commandId }) => (
            commandId.slice(commandId.lastIndexOf(':') + 1)
        )),
        ['member-0-0', 'member-0-1']
    );
    assert.ok(batches[0].every(
        ({ intent }) => intent.pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    ));

    assert.equal(director.queueSpawnsForFixedTick(
        2,
        sink,
        snapshot(2, [CORK_DUAL_ROUTE_UPPER_PATH_ID])
    ), 0);
    assert.equal(batches.length, 1, '폐쇄 tick은 spawn sink를 호출하면 안 됩니다.');
    assert.equal(director.getStatus().blockedSpawnCount, 2);
    assert.equal(director.getStatus().remainingSpawnCount, 2);

    assert.equal(director.queueSpawnsForFixedTick(
        3,
        sink,
        snapshot(3, [])
    ), 2);
    assert.equal(batches.length, 2);
    assert.equal(batches[1].length, 2);
    assert.deepEqual(
        batches[1].map(({ commandId }) => (
            commandId.slice(commandId.lastIndexOf(':') + 1)
        )),
        ['member-1-0', 'member-1-1']
    );
    assert.ok(batches[1].every(
        ({ intent }) => intent.pathId === CORK_DUAL_ROUTE_UPPER_PATH_ID
    ));
    assert.equal(director.getStatus().blockedSpawnCount, 0);
    assert.equal(director.getStatus().remainingSpawnCount, 0);
    director.destroy();
});

test('WaveDirector idle epoch reset은 구 route cache만 지우고 authored backlog를 보존한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const director = new WaveDirector({
        waveDefinition: CORK_DUAL_ROUTE_WAVE_01_DATA
    });
    assert.equal(director.init(tileMap), true);
    const allClosed = Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 3,
        closedPathIds: Object.freeze([
            CORK_DUAL_ROUTE_LOWER_PATH_ID,
            CORK_DUAL_ROUTE_UPPER_PATH_ID
        ])
    });
    assert.equal(director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch() {
            throw new Error('all-closed backlog은 sink를 호출하면 안 됩니다.');
        }
    }, allClosed), 0);
    const beforeReset = director.getStatus();
    assert.equal(beforeReset.blockedSpawnCount, 1);
    assert.equal(beforeReset.routeAvailabilityVersion, 3);

    assert.equal(director.resetRouteAvailabilityBinding(Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 1,
        closedPathIds: Object.freeze([CORK_DUAL_ROUTE_UPPER_PATH_ID])
    })), false);
    assert.deepEqual(director.getStatus(), beforeReset);
    assert.equal(director.resetRouteAvailabilityBinding(Object.freeze({
        graphContentKey: atlas.contentKey,
        availabilityVersion: 1,
        closedPathIds: Object.freeze([])
    })), true);
    assert.equal(director.getStatus().blockedSpawnCount, 1);
    assert.equal(director.getStatus().queuedSpawnCount, 0);
    assert.equal(director.getStatus().routeAvailabilityVersion, null);

    const requests = [];
    assert.equal(director.queueSpawnsForFixedTick(2, {
        requestSpawnBatch(batch) {
            requests.push(...batch);
            return Object.freeze({
                accepted: true,
                requestedCount: batch.length,
                queuedCount: batch.length
            });
        }
    }, createAllOpenRouteAvailabilitySelectionSnapshot(
        atlas.contentKey,
        1
    )), 1);
    assert.equal(requests[0].intent.routeAvailabilityVersion, 1);
    assert.equal(director.getStatus().blockedSpawnCount, 0);
});

test('Cork director는 lifecycle identity를 GPU assignment/close/reopen/cleanup과 결속해 terminal을 봉인한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const routeGraph = tileMap.getRouteGraph();
    const director = new CorkRouteClosureDirector({
        routeGraph,
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    const handle = Object.freeze({ entityId: 41, incarnation: 7 });

    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 11)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.getStatus().rosterCount, 1);
    assert.equal(director.getStatus().pendingAssignmentCount, 1);
    assert.equal(director.getStatus().authoritativeEpoch, 0);

    const assignment = createCompletion(atlas, {
        availabilityVersion: 2,
        assignments: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 1,
            availabilityVersion: 2
        })])
    });
    assert.equal(director.observeCompletedPrograms(assignment).accepted, true);
    assert.equal(director.observeCompletedPrograms(assignment).replayed, true);
    assert.equal(director.getStatus().assignedLeaseCount, 1);
    assert.equal(director.getStatus().pendingAssignmentCount, 0);

    const closure = createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 102,
        availabilityVersion: 3,
        closedPathIds: Object.freeze([CORK_DUAL_ROUTE_UPPER_PATH_ID]),
        closures: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 2,
            availabilityVersion: 3
        })])
    });
    assert.equal(director.observeCompletedPrograms(closure).accepted, true);
    assert.deepEqual(
        director.getAvailabilitySnapshot().closedPathIds,
        [CORK_DUAL_ROUTE_UPPER_PATH_ID]
    );

    director.closeForTerminal(4, 'test-terminal');
    director.observeFixedCommit({ fixedTick: 4 }, 4);
    director.observeLifecycle({
        fixedTick: 4,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', handle, 4, 14)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            availabilityVersion: 3,
            rosterCount: 0
        })
    }, 4);
    assert.equal(director.getStatus().pendingCleanupCount, 1);
    assert.equal(director.getStatus().terminal.rosterSealed, false);

    const cleanup = createCompletion(atlas, {
        sourceTick: 4,
        completedThroughTick: 4,
        batchIdFingerprint: 104,
        availabilityVersion: 4,
        reopens: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 4,
            availabilityVersion: 4
        })]),
        cleanups: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 4,
            availabilityVersion: 4
        })])
    });
    assert.equal(director.observeCompletedPrograms(cleanup).accepted, true);
    const terminalStatus = director.getStatus();
    assert.equal(terminalStatus.rosterCount, 0);
    assert.equal(terminalStatus.pendingCleanupCount, 0);
    assert.equal(terminalStatus.terminal.fixedCommitObserved, true);
    assert.equal(terminalStatus.terminal.lifecycleObserved, true);
    assert.equal(terminalStatus.terminal.rosterSealed, true);
});

test('Cork director는 한 snapshot 내부 duplicate owner와 무인증 assignment를 fail-close한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const handle = Object.freeze({ entityId: 51, incarnation: 2 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 21)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    const record = createRouteRecord({
        handle,
        sourceTick: 1,
        availabilityVersion: 2
    });
    const result = director.observeCompletedPrograms(createCompletion(atlas, {
        availabilityVersion: 3,
        assignments: Object.freeze([record, record])
    }));
    assert.equal(result.accepted, false);
    assert.equal(director.requiresRecovery(), true);

    const unauthenticated = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    const unsolicited = unauthenticated.observeCompletedPrograms(
        createCompletion(atlas, {
            availabilityVersion: 2,
            assignments: Object.freeze([record])
        })
    );
    assert.equal(unsolicited.accepted, false);
    assert.equal(unauthenticated.requiresRecovery(), true);

    const regressionDirector = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    regressionDirector.observeFixedCommit({ fixedTick: 1 }, 1);
    regressionDirector.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 31)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(regressionDirector.observeCompletedPrograms(
        createCompletion(atlas, {
            availabilityVersion: 2,
            assignments: Object.freeze([record])
        })
    ).accepted, true);
    assert.equal(regressionDirector.observeCompletedPrograms(
        createCompletion(atlas, {
            sourceTick: 2,
            completedThroughTick: 2,
            batchIdFingerprint: 202,
            availabilityVersion: 3,
            closedPathIds: Object.freeze([CORK_DUAL_ROUTE_UPPER_PATH_ID]),
            closures: Object.freeze([createRouteRecord({
                handle,
                sourceTick: 2,
                availabilityVersion: 3
            })])
        })
    ).accepted, true);
    const regression = regressionDirector.observeCompletedPrograms(
        createCompletion(atlas, {
            sourceTick: 3,
            completedThroughTick: 3,
            batchIdFingerprint: 203,
            availabilityVersion: 2
        })
    );
    assert.equal(regression.accepted, false);
    assert.equal(regressionDirector.requiresRecovery(), true);
});

test('lease를 아직 얻지 못한 duplicate-wait Cork는 lifecycle cleanup을 exact no-op으로 끝낸다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const handle = Object.freeze({ entityId: 61, incarnation: 3 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 41)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.getStatus().pendingAssignmentCount, 1);

    director.closeForTerminal(2, 'waiter-terminal');
    director.observeFixedCommit({ fixedTick: 2 }, 2);
    director.observeLifecycle({
        fixedTick: 2,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', handle, 2, 42)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            rosterCount: 0
        })
    }, 2);
    assert.equal(director.getStatus().pendingAssignmentCount, 0);
    assert.equal(director.getStatus().pendingCleanupCount, 0);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 302
    })).accepted, true);
    assert.equal(director.getStatus().terminal.rosterSealed, true);
});

test('갈림길 normal-fallback CLEANED는 lease 없이 lifecycle identity를 보존한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const handle = Object.freeze({ entityId: 66, incarnation: 3 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 45)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        cleanups: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 1,
            availabilityVersion: 1,
            leaseGeneration: 5
        })])
    })).accepted, true);
    assert.equal(director.getStatus().rosterCount, 0);
    assert.equal(director.getStatus().pendingAssignmentCount, 0);
    assert.equal(director.getStatus().assignedLeaseCount, 0);
    assert.equal(director.getStatus().normalFallbackCount, 1);
    assert.equal(director.observeRuntimeStatus(createRuntimeStatus(atlas, {
        completedThroughTick: 1
    })).recoveryRequired, false);

    director.closeForTerminal(2, 'normalized-terminal');
    director.observeFixedCommit({ fixedTick: 2 }, 2);
    director.observeLifecycle({
        fixedTick: 2,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', handle, 2, 46)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 0 })
    }, 2);
    assert.equal(director.getStatus().normalFallbackCount, 0);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 306
    })).accepted, true);
    assert.equal(director.getStatus().terminal.rosterSealed, true);
});

test('prospective Cork 수는 blocker lease capacity와 독립적으로 body 범위까지 허용된다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    const handles = Array.from({ length: 9 }, (_, index) => Object.freeze({
        entityId: 100 + index,
        incarnation: 1
    }));
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze(handles.map((handle, index) => (
            createLifecycleEntry('spawn', handle, 1, 100 + index)
        ))),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 9 })
    }, 1);
    assert.equal(director.getStatus().rosterCount, 9);
    assert.equal(director.getStatus().pendingAssignmentCount, 9);
    assert.equal(director.observeRuntimeStatus(createRuntimeStatus(atlas, {
        rosterCount: 9
    })).recoveryRequired, false);
});

test('확장 전 LEASED Cork terminal cleanup은 REOPEN과 CLEANUP을 같은 completion에서 수용한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const handle = Object.freeze({ entityId: 71, incarnation: 4 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 51)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        availabilityVersion: 2,
        assignments: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 1,
            availabilityVersion: 2
        })])
    })).accepted, true);

    director.closeForTerminal(2, 'leased-terminal');
    director.observeFixedCommit({ fixedTick: 2 }, 2);
    director.observeLifecycle({
        fixedTick: 2,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', handle, 2, 52)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            availabilityVersion: 2,
            rosterCount: 0
        })
    }, 2);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 402,
        availabilityVersion: 3,
        reopens: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 2,
            availabilityVersion: 3
        })]),
        cleanups: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 2,
            availabilityVersion: 3
        })])
    })).accepted, true);
    assert.equal(director.getStatus().terminal.rosterSealed, true);
});

test('exact idle route epoch advance만 availability version 3에서 새 epoch version 1 reset을 허용한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const handle = Object.freeze({ entityId: 81, incarnation: 5 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 61)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        availabilityVersion: 2,
        assignments: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 1,
            availabilityVersion: 2
        })])
    })).accepted, true);
    director.observeFixedCommit({ fixedTick: 2 }, 2);
    director.observeLifecycle({
        fixedTick: 2,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', handle, 2, 62)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            availabilityVersion: 2,
            rosterCount: 0
        })
    }, 2);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 502,
        availabilityVersion: 3,
        reopens: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 2,
            availabilityVersion: 3
        })]),
        cleanups: Object.freeze([createRouteRecord({
            handle,
            sourceTick: 2,
            availabilityVersion: 3
        })])
    })).accepted, true);
    assert.equal(director.getStatus().rosterCount, 0);
    assert.equal(director.getStatus().availabilityVersion, 3);
    assert.equal(director.resetGpuBinding({
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        availabilityVersion: 3
    }), false);
    assert.equal(director.resetGpuBinding({
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 1,
        availabilityVersion: 1
    }), true);
    assert.equal(director.getStatus().availabilityVersion, 1);

    const active = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    active.observeFixedCommit({ fixedTick: 1 }, 1);
    active.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', handle, 1, 71)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(active.resetGpuBinding({
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 1,
        availabilityVersion: 1
    }), false);
    assert.equal(active.getStatus().authoritativeEpoch, 0);
});

test('closure lease generation은 cleanup 뒤 새 exact owner에서도 strictly advance한다', () => {
    const tileMap = new TileMap(CORK_DUAL_ROUTE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const firstHandle = Object.freeze({ entityId: 91, incarnation: 1 });
    const nextHandle = Object.freeze({ entityId: 92, incarnation: 1 });
    const director = new CorkRouteClosureDirector({
        routeGraph: tileMap.getRouteGraph(),
        graphContentKey: atlas.contentKey,
        sessionGeneration: 1,
        deviceGeneration: 0,
        authoritativeEpoch: 0,
        capacity: 8,
        runtimeStatus: createRuntimeStatus(atlas)
    });
    director.observeFixedCommit({ fixedTick: 1 }, 1);
    director.observeLifecycle({
        fixedTick: 1,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', firstHandle, 1, 81)
        ]),
        routeRuntimeBinding: createBinding(atlas, { rosterCount: 1 })
    }, 1);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        availabilityVersion: 2,
        assignments: Object.freeze([createRouteRecord({
            handle: firstHandle,
            sourceTick: 1,
            availabilityVersion: 2,
            leaseGeneration: 7
        })])
    })).accepted, true);
    director.observeFixedCommit({ fixedTick: 2 }, 2);
    director.observeLifecycle({
        fixedTick: 2,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('cleanup', firstHandle, 2, 82)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            availabilityVersion: 2,
            rosterCount: 0
        })
    }, 2);
    assert.equal(director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 2,
        completedThroughTick: 2,
        batchIdFingerprint: 602,
        availabilityVersion: 3,
        reopens: Object.freeze([createRouteRecord({
            handle: firstHandle,
            sourceTick: 2,
            availabilityVersion: 3,
            leaseGeneration: 7
        })]),
        cleanups: Object.freeze([createRouteRecord({
            handle: firstHandle,
            sourceTick: 2,
            availabilityVersion: 3,
            leaseGeneration: 7
        })])
    })).accepted, true);
    director.observeFixedCommit({ fixedTick: 3 }, 3);
    director.observeLifecycle({
        fixedTick: 3,
        recoveryRequired: false,
        routeLifecycle: Object.freeze([
            createLifecycleEntry('spawn', nextHandle, 3, 83)
        ]),
        routeRuntimeBinding: createBinding(atlas, {
            availabilityVersion: 3,
            rosterCount: 1
        })
    }, 3);
    const aba = director.observeCompletedPrograms(createCompletion(atlas, {
        sourceTick: 3,
        completedThroughTick: 3,
        batchIdFingerprint: 603,
        availabilityVersion: 4,
        assignments: Object.freeze([createRouteRecord({
            handle: nextHandle,
            sourceTick: 3,
            availabilityVersion: 4,
            leaseGeneration: 7
        })])
    }));
    assert.equal(aba.accepted, false);
    assert.equal(director.requiresRecovery(), true);
});
