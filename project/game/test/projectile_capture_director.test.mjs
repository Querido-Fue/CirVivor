import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { RingProjectileCaptureDirector } = await loadGameModule(
    'ingame/object/enemy/projectile_capture_director.js'
);
const {
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} = await loadGameModule(
    'ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js'
);
const {
    RING_PROJECTILE_CAPTURE_PROFILE_ID
} = await loadGameModule(
    'data/object/enemy/enemy_projectile_capture_catalog_data.js'
);
const {
    BASIC_RING_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/basic_ring_enemy_data.js');

const SESSION = 7;
const DEVICE = 3;
const EPOCH = 2;
const INVALID_U32 = 0xffffffff;

function handle(entityId, incarnation = 1) {
    return Object.freeze({ entityId, incarnation });
}

function createRegistry(views) {
    const byKey = new Map(views.map((view) => [
        `${view.entityId}:${view.incarnation}`,
        Object.freeze(view)
    ]));
    return {
        has(candidate) {
            return byKey.has(`${candidate.entityId}:${candidate.incarnation}`);
        },
        copyEntityView(candidate) {
            return byKey.get(
                `${candidate.entityId}:${candidate.incarnation}`
            ) ?? null;
        },
        replaceView(candidate, view) {
            byKey.set(
                `${candidate.entityId}:${candidate.incarnation}`,
                Object.freeze(view)
            );
        }
    };
}

function createPort() {
    const requested = [];
    const discarded = [];
    const terminal = [];
    return {
        requested,
        discarded,
        terminal,
        requestPreparedReleaseBatch(request) {
            requested.push(request);
            return Object.freeze({
                accepted: true,
                commandId: request.commandId,
                commandIdFingerprint: 123,
                targetFixedTick: request.targetFixedTick
            });
        },
        discardPreparedBatch(request) {
            discarded.push(request);
            return Object.freeze({ accepted: true });
        },
        requestTerminalHeldProjectileDespawn(request) {
            terminal.push(request);
            return Object.freeze({
                accepted: true,
                commandId: request.commandId,
                targetFixedTick: request.targetFixedTick,
                authenticTerminalCleanup: true
            });
        }
    };
}

function completionHeader(sourceTick, batchIdFingerprint) {
    return {
        abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
        sessionGeneration: SESSION,
        deviceGeneration: DEVICE,
        authoritativeEpoch: EPOCH,
        sourceTick,
        completedThroughTick: sourceTick,
        status: GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE,
        errorFlags: 0,
        batchIdFingerprint,
        pending: false,
        protocolFailure: null
    };
}

function createDirector() {
    const captor = handle(11, 2);
    const projectile = handle(21, 4);
    const core = handle(31, 1);
    const projectileMetadata = Object.freeze({
        projectileCapturePolicyId: 'capturable',
        damagePolicyId: 0
    });
    const registry = createRegistry([{
        ...captor,
        kindId: 'enemy',
        definitionId: BASIC_RING_ENEMY_DEFINITION_ID,
        metadata: Object.freeze({
            projectileCaptureProfileId: RING_PROJECTILE_CAPTURE_PROFILE_ID
        }),
        metadataRevision: 1
    }, {
        ...projectile,
        kindId: 'projectile',
        definitionId: 'capturable-round',
        metadata: projectileMetadata,
        metadataRevision: 1
    }, {
        ...core,
        kindId: 'core-proxy',
        definitionId: 'the-core-interaction-proxy',
        metadata: Object.freeze({}),
        metadataRevision: 1
    }]);
    const port = createPort();
    const director = new RingProjectileCaptureDirector({
        registry,
        projectileCaptureCommandPort: port,
        sessionGeneration: SESSION,
        deviceGeneration: DEVICE,
        authoritativeEpoch: EPOCH,
        capacity: 8
    });
    return { director, port, registry, captor, projectile, core };
}

function publishCoreRelease(batchIdFingerprint = 644) {
    const state = createDirector();
    const prepareEvidence = Object.freeze({
        prepareFingerprint: 691,
        anchor: Object.freeze({ x: 4, y: 5 }),
        facing: Object.freeze({ x: 1, y: 0 }),
        capturedSpeed: 12,
        targetSelector: GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
        targetHandle: null,
        targetBodySlot: INVALID_U32,
        profileCode: 1,
        capturedAtFixedTick: 10,
        releaseDueFixedTick: 70,
        baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
    });
    assert.equal(state.director.observeCompletedCapturePrograms({
        ...completionHeader(10, batchIdFingerprint),
        captures: Object.freeze([Object.freeze({
            projectileHandle: state.projectile,
            captorHandle: state.captor,
            captureSequence: 5,
            sourceTick: 10
        })]),
        releasePreparations: Object.freeze([Object.freeze({
            projectileHandle: state.projectile,
            captorHandle: state.captor,
            captureSequence: 5,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 10,
            batchIdFingerprint,
            prepareEvidence
        })]),
        cleanups: Object.freeze([])
    }).accepted, true);
    const coreReceipt = Object.freeze({
        type: 'contact',
        eventType: 'interaction-enter',
        disposition: 'applied',
        sessionGeneration: SESSION,
        deviceGeneration: DEVICE,
        authoritativeEpoch: EPOCH,
        sourceTick: 10,
        sequence: 1,
        ...state.captor,
        other: state.core
    });
    assert.equal(state.director.observeCompletedEvents({
        events: Object.freeze([coreReceipt]),
        protocolFailure: null
    }).accepted, true);
    const staged = state.director.stageForFixedTick({
        targetFixedTick: 11,
        towerTargetHandle: null
    });
    assert.equal(staged.accepted, true);
    state.registry.replaceView(state.projectile, {
        ...state.projectile,
        kindId: 'projectile',
        definitionId: 'capturable-round',
        metadata: Object.freeze({
            projectileCapturePolicyId: 'capturable',
            teamId: 2,
            allegiancePolicy: 'fixed-hostile',
            damagePolicyId: 0,
            ownerEntityId: state.captor.entityId,
            ownerIncarnation: state.captor.incarnation,
            sourceEntityId: state.captor.entityId,
            sourceIncarnation: state.captor.incarnation,
            targetEntityId: null,
            targetIncarnation: null,
            targetPolicyId: 'player-damageable-and-terrain'
        }),
        metadataRevision: 2
    });
    const lifecycle = Object.freeze({
        fixedTick: 11,
        recoveryRequired: false,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        rejected: Object.freeze([]),
        projectileCaptureReleases: Object.freeze([Object.freeze({
            commandId: staged.commandIds[0],
            commandIdFingerprint: 123,
            projectileHandle: state.projectile,
            captorHandle: state.captor,
            captureSequence: 5,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 10,
            batchIdFingerprint,
            prepareFingerprint: 691,
            targetFixedTick: 11,
            targetHandle: null,
            registryRevision: 2,
            metadataRevision: 2,
            backendCommitRequested: true
        })])
    });
    state.director.observeFixedCommit(lifecycle, 11);
    state.director.observeLifecycle(lifecycle, 11);
    return {
        ...state,
        batchIdFingerprint,
        validReleaseCompletion: Object.freeze({
            projectileHandle: state.projectile,
            captorHandle: state.captor,
            captureSequence: 5,
            sourceTick: 11,
            batchIdFingerprint,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareFingerprint: 691,
            commandIdFingerprint: 123,
            publicationFixedTick: 11,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            teamId: 2,
            allegiancePolicy: 'fixed-hostile',
            damagePolicyId: 0,
            targetPolicyId: 'player-damageable-and-terrain',
            metadataRevision: 2
        })
    };
}

test('coherent core receipt authenticates an exact GPU CORE prepare and terminal preserves published release', () => {
    const {
        director,
        port,
        registry,
        captor,
        projectile,
        core
    } = createDirector();
    const prepareEvidence = Object.freeze({
        prepareFingerprint: 91,
        anchor: Object.freeze({ x: 4, y: 5 }),
        facing: Object.freeze({ x: 1, y: 0 }),
        capturedSpeed: 12,
        targetSelector: GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
        targetHandle: null,
        targetBodySlot: INVALID_U32,
        profileCode: 1,
        capturedAtFixedTick: 10,
        releaseDueFixedTick: 70,
        baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
    });
    const observed = director.observeCompletedCapturePrograms({
        ...completionHeader(10, 44),
        captures: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 5,
            sourceTick: 10
        })]),
        releasePreparations: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 5,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 10,
            batchIdFingerprint: 44,
            prepareEvidence
        })]),
        cleanups: Object.freeze([])
    });
    assert.equal(observed.accepted, true);

    const coreReceipt = Object.freeze({
        type: 'contact',
        eventType: 'interaction-enter',
        disposition: 'applied',
        sessionGeneration: SESSION,
        deviceGeneration: DEVICE,
        authoritativeEpoch: EPOCH,
        sourceTick: 10,
        sequence: 1,
        key: 'core:R:10',
        ...captor,
        other: core
    });
    assert.equal(director.observeCompletedEvents({
        events: Object.freeze([coreReceipt]),
        protocolFailure: null
    }).accepted, true);
    const staged = director.stageForFixedTick({
        targetFixedTick: 11,
        towerTargetHandle: handle(99, 1)
    });
    assert.equal(staged.accepted, true);
    assert.equal(port.requested.length, 1);
    const record = port.requested[0].records[0];
    assert.equal(
        record.releaseReason,
        GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
    );
    assert.equal(record.towerTargetHandle, null);
    assert.equal(record.coreImpactReceipt, coreReceipt);
    assert.equal(record.prepareEvidence.baseReason,
        GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT);

    registry.replaceView(projectile, {
        ...projectile,
        kindId: 'projectile',
        definitionId: 'capturable-round',
        metadata: Object.freeze({
            projectileCapturePolicyId: 'capturable',
            teamId: 2,
            allegiancePolicy: 'fixed-hostile',
            damagePolicyId: 0,
            ownerEntityId: captor.entityId,
            ownerIncarnation: captor.incarnation,
            sourceEntityId: captor.entityId,
            sourceIncarnation: captor.incarnation,
            targetEntityId: null,
            targetIncarnation: null,
            targetPolicyId: 'player-damageable-and-terrain'
        }),
        metadataRevision: 2
    });

    const lifecycle = Object.freeze({
        fixedTick: 11,
        recoveryRequired: false,
        spawned: Object.freeze([]),
        despawned: Object.freeze([]),
        rejected: Object.freeze([]),
        projectileCaptureReleases: Object.freeze([Object.freeze({
            commandId: staged.commandIds[0],
            commandIdFingerprint: 123,
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 5,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 10,
            batchIdFingerprint: 44,
            prepareFingerprint: 91,
            targetFixedTick: 11,
            targetHandle: null,
            registryRevision: 2,
            metadataRevision: 2,
            backendCommitRequested: true
        })])
    });
    director.observeFixedCommit(lifecycle, 11);
    director.observeLifecycle(lifecycle, 11);
    director.closeForTerminal(11);
    assert.equal(port.terminal.length, 0);
    assert.equal(director.getStatus().pendingReadbackCount, 1);
    assert.equal(director.getStatus().terminal.rosterSealed, false);

    const released = director.observeCompletedReleasePrograms({
        ...completionHeader(11, 44),
        releaseCompletions: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 5,
            sourceTick: 11,
            batchIdFingerprint: 44,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareFingerprint: 91,
            commandIdFingerprint: 123,
            publicationFixedTick: 11,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            teamId: 2,
            allegiancePolicy: 'fixed-hostile',
            damagePolicyId: 0,
            targetPolicyId: 'player-damageable-and-terrain',
            metadataRevision: 2
        })])
    });
    assert.equal(released.accepted, true);
    assert.equal(director.getStatus().capturedProjectileCount, 0);
    assert.equal(director.getStatus().terminal.rosterSealed, true);
});

test('terminal requests authentic cleanup for unpublished HELD and seals only after lifecycle proof', () => {
    const { director, port, captor, projectile } = createDirector();
    assert.equal(director.observeCompletedCapturePrograms({
        ...completionHeader(20, 55),
        captures: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 8,
            sourceTick: 20
        })]),
        releasePreparations: Object.freeze([]),
        cleanups: Object.freeze([])
    }).accepted, true);
    director.closeForTerminal(21);
    assert.equal(port.terminal.length, 1);
    assert.deepEqual(port.terminal[0].handle, projectile);
    assert.equal(director.getStatus().terminalCleanupPendingCount, 1);

    const lifecycle = Object.freeze({
        fixedTick: 21,
        recoveryRequired: false,
        spawned: Object.freeze([]),
        rejected: Object.freeze([]),
        projectileCaptureReleases: Object.freeze([]),
        despawned: Object.freeze([Object.freeze({
            commandId: port.terminal[0].commandId,
            handle: projectile,
            reason: 'projectile-capture-terminal-held-unpublished',
            disposition: 'projectile-capture-terminal-held-unpublished',
            bountyEligible: false
        })])
    });
    director.observeFixedCommit(lifecycle, 21);
    director.observeLifecycle(lifecycle, 21);
    assert.equal(director.getStatus().capturedProjectileCount, 0);
    assert.equal(director.getStatus().terminal.rosterSealed, true);
});

test('core-depleted terminal tombstones same-tick capture+CORE before release publication', () => {
    const { director, port, captor, projectile, core } = createDirector();
    const prepareEvidence = Object.freeze({
        prepareFingerprint: 501,
        anchor: Object.freeze({ x: 0, y: 0 }),
        facing: Object.freeze({ x: 0, y: 1 }),
        capturedSpeed: 3,
        targetSelector: GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
        targetHandle: null,
        targetBodySlot: INVALID_U32,
        profileCode: 1,
        capturedAtFixedTick: 30,
        releaseDueFixedTick: 90,
        baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
    });
    assert.equal(director.observeCompletedCapturePrograms({
        ...completionHeader(30, 501),
        captures: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 9,
            sourceTick: 30
        })]),
        releasePreparations: Object.freeze([Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 9,
            releaseReason:
                GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 30,
            batchIdFingerprint: 501,
            prepareEvidence
        })]),
        cleanups: Object.freeze([])
    }).accepted, true);
    const receipt = Object.freeze({
        type: 'contact',
        eventType: 'interaction-enter',
        disposition: 'applied',
        sessionGeneration: SESSION,
        deviceGeneration: DEVICE,
        authoritativeEpoch: EPOCH,
        sourceTick: 30,
        sequence: 1,
        ...captor,
        other: core
    });
    assert.equal(director.observeCompletedEvents({
        events: Object.freeze([receipt]),
        protocolFailure: null
    }).accepted, true);

    director.closeForTerminal(31, 'core-depleted');
    assert.equal(port.requested.length, 0);
    assert.deepEqual(port.discarded.at(-1), { batchIdFingerprint: 501 });
    assert.equal(port.terminal.length, 1);
    assert.deepEqual(port.terminal[0].handle, projectile);
    assert.equal(director.getStatus().pendingReadbackCount, 0);
    assert.equal(director.getStatus().terminalCleanupPendingCount, 1);
});

test('DEATH/CORE release prepare requires the same coherent generic receipt', () => {
    {
        const { director, captor, projectile } = createDirector();
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(1, 521),
            captures: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                sourceTick: 1
            })]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const evidence = Object.freeze({
            prepareFingerprint: 522,
            anchor: Object.freeze({ x: 0, y: 0 }),
            facing: Object.freeze({ x: 1, y: 0 }),
            capturedSpeed: 1,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            targetBodySlot: INVALID_U32,
            profileCode: 1,
            capturedAtFixedTick: 1,
            releaseDueFixedTick: 61,
            baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH
        });
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(2, 522),
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                releaseReason:
                    GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
                prepareSourceTick: 2,
                batchIdFingerprint: 522,
                prepareEvidence: evidence
            })]),
            cleanups: Object.freeze([])
        }).accepted, true);
        assert.equal(director.observeCompletedEvents({
            events: Object.freeze([]),
            protocolFailure: null
        }).requiresRecovery, true);
    }
    {
        const { director, captor, projectile } = createDirector();
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(1, 531),
            captures: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                sourceTick: 1
            })]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const evidence = Object.freeze({
            prepareFingerprint: 532,
            anchor: Object.freeze({ x: 0, y: 0 }),
            facing: Object.freeze({ x: 1, y: 0 }),
            capturedSpeed: 1,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            targetBodySlot: INVALID_U32,
            profileCode: 1,
            capturedAtFixedTick: 1,
            releaseDueFixedTick: 61,
            baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
        });
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(60, 532),
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                releaseReason:
                    GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE,
                prepareSourceTick: 60,
                batchIdFingerprint: 532,
                prepareEvidence: evidence
            })]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const death = Object.freeze({
            type: 'death',
            disposition: 'applied',
            sessionGeneration: SESSION,
            deviceGeneration: DEVICE,
            authoritativeEpoch: EPOCH,
            sourceTick: 60,
            ...captor
        });
        assert.equal(director.observeCompletedEvents({
            events: Object.freeze([death]),
            protocolFailure: null
        }).requiresRecovery, true);
    }
});

test('release completion binds every committed proof and only whole snapshot replay is idempotent', () => {
    const mismatches = [
        (record) => ({ ...record, commandIdFingerprint: 999 }),
        (record) => ({ ...record, publicationFixedTick: 12 }),
        (record) => ({ ...record, damagePolicyId: 1 }),
        (record) => ({ ...record, metadataRevision: 3 })
    ];
    for (const [index, mutate] of mismatches.entries()) {
        const state = publishCoreRelease(650 + index);
        const result = state.director.observeCompletedReleasePrograms({
            ...completionHeader(11, state.batchIdFingerprint),
            releaseCompletions: Object.freeze([Object.freeze(
                mutate(state.validReleaseCompletion)
            )])
        });
        assert.equal(result.requiresRecovery, true);
    }

    const wrongBatch = publishCoreRelease(659);
    const mismatchedBatchId = wrongBatch.batchIdFingerprint + 1;
    assert.equal(wrongBatch.director.observeCompletedReleasePrograms({
        ...completionHeader(11, mismatchedBatchId),
        releaseCompletions: Object.freeze([Object.freeze({
            ...wrongBatch.validReleaseCompletion,
            batchIdFingerprint: mismatchedBatchId
        })])
    }).requiresRecovery, true);

    const replay = publishCoreRelease(660);
    const snapshot = Object.freeze({
        ...completionHeader(11, replay.batchIdFingerprint),
        releaseCompletions: Object.freeze([replay.validReleaseCompletion])
    });
    assert.equal(
        replay.director.observeCompletedReleasePrograms(snapshot).accepted,
        true
    );
    const replayed = replay.director.observeCompletedReleasePrograms(snapshot);
    assert.equal(replayed.accepted, true);
    assert.equal(replayed.replayed, true);
});

test('release publication timing permits late NORMAL retry and death/core before, at, or after due', () => {
    const scenarios = [
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE,
            prepareSourceTick: 60
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE,
            prepareSourceTick: 61
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
            prepareSourceTick: 9
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
            prepareSourceTick: 60
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
            prepareSourceTick: 70
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 9
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 60
        },
        {
            reason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
            prepareSourceTick: 70
        }
    ];
    for (const [index, scenario] of scenarios.entries()) {
        const { director, captor, projectile } = createDirector();
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(1, 100 + index),
            captures: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                sourceTick: 1
            })]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const evidence = Object.freeze({
            prepareFingerprint: 200 + index,
            anchor: Object.freeze({ x: 1, y: 1 }),
            facing: Object.freeze({ x: 1, y: 0 }),
            capturedSpeed: 2,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            targetBodySlot: INVALID_U32,
            profileCode: 1,
            capturedAtFixedTick: 1,
            releaseDueFixedTick: 61,
            baseReason: scenario.reason
        });
        const prepared = director.observeCompletedCapturePrograms({
            ...completionHeader(
                scenario.prepareSourceTick,
                300 + index
            ),
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                releaseReason: scenario.reason,
                prepareSourceTick: scenario.prepareSourceTick,
                batchIdFingerprint: 300 + index,
                prepareEvidence: evidence
            })]),
            cleanups: Object.freeze([])
        });
        assert.equal(prepared.accepted, true, JSON.stringify(scenario));
    }
});

test('one authenticated batch rejects duplicate capture, prepare, and cleanup cardinality', () => {
    {
        const { director, captor, projectile } = createDirector();
        const record = Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 1,
            sourceTick: 1
        });
        const result = director.observeCompletedCapturePrograms({
            ...completionHeader(1, 401),
            captures: Object.freeze([record, record]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        });
        assert.equal(result.requiresRecovery, true);
    }
    {
        const { director, captor, projectile } = createDirector();
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(1, 402),
            captures: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                sourceTick: 1
            })]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const evidence = Object.freeze({
            prepareFingerprint: 402,
            anchor: Object.freeze({ x: 0, y: 0 }),
            facing: Object.freeze({ x: 1, y: 0 }),
            capturedSpeed: 1,
            targetSelector:
                GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
            targetHandle: null,
            targetBodySlot: INVALID_U32,
            profileCode: 1,
            capturedAtFixedTick: 1,
            releaseDueFixedTick: 61,
            baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH
        });
        const record = Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 1,
            releaseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
            prepareSourceTick: 2,
            batchIdFingerprint: 403,
            prepareEvidence: evidence
        });
        const result = director.observeCompletedCapturePrograms({
            ...completionHeader(2, 403),
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([record, record]),
            cleanups: Object.freeze([])
        });
        assert.equal(result.requiresRecovery, true);
    }
    {
        const { director, captor, projectile } = createDirector();
        assert.equal(director.observeCompletedCapturePrograms({
            ...completionHeader(1, 404),
            captures: Object.freeze([Object.freeze({
                projectileHandle: projectile,
                captorHandle: captor,
                captureSequence: 1,
                sourceTick: 1
            })]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([])
        }).accepted, true);
        const record = Object.freeze({
            projectileHandle: projectile,
            captorHandle: captor,
            captureSequence: 1,
            reason: 'held-expired',
            sourceTick: 2
        });
        const result = director.observeCompletedCapturePrograms({
            ...completionHeader(2, 405),
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([record, record])
        });
        assert.equal(result.requiresRecovery, true);
    }
});
