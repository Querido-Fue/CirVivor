import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { EnemyLifecycleCommandOwner } = await loadGameModule(
    'ingame/object/enemy/enemy_lifecycle_command_owner.js'
);
const {
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
} = await loadGameModule(
    'ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js'
);
const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);

function key(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createBackend() {
    const bodies = new Set();
    return {
        bodies,
        spawnBodies() {
            return { accepted: 0, rejected: 0, handles: [] };
        },
        despawnBodies(handles) {
            let removed = 0;
            for (const handle of handles) {
                if (bodies.delete(key(handle))) {
                    removed++;
                }
            }
            return { removed, rejected: handles.length - removed };
        },
        hasBody(handle) {
            return bodies.has(key(handle));
        },
        requiresRecovery() {
            return false;
        },
        getRuntimeState() {
            return 'gpu-ready';
        }
    };
}

function capturableMetadata() {
    return Object.freeze({
        projectileCapturePolicyId: 'capturable',
        schemaVersion: 1,
        archetypeId: 'basic-bullet',
        wordTagMask: 0x080,
        modifierSetId: null,
        sourceExecutionId: 'shot-1',
        projectileGeneration: 1,
        originProducerId: 'tower-primary',
        originSourceAbilityId: 'basic-shot',
        originOwnerEntityId: 90,
        originOwnerIncarnation: 2,
        originSourceEntityId: 90,
        originSourceIncarnation: 2,
        originTargetEntityId: null,
        originTargetIncarnation: null,
        teamId: 1,
        damagePolicyId: 0,
        allegiancePolicy: 'explicit-override',
        ownerEntityId: 90,
        ownerIncarnation: 2,
        sourceEntityId: 90,
        sourceIncarnation: 2,
        targetEntityId: null,
        targetIncarnation: null,
        targetPolicyId: 'hostile-damageable-and-terrain'
    });
}

function createFixture() {
    const metadataAuthority = Object.freeze({});
    const releasePermit = Object.freeze({});
    let permitAvailable = true;
    const backend = createBackend();
    const registry = new WorldRegistry({
        capacity: 2,
        activeMetadataMutationAuthority: metadataAuthority
    });
    const projectile = registry.reserveEntity({
        kindId: 'projectile',
        definitionId: 'capturable-round',
        createdAtTick: 1
    });
    assert.equal(registry.activateReserved(projectile, capturableMetadata()), true);
    backend.bodies.add(key(projectile));
    const transactionLog = [];
    let armedRequest = null;
    const transactionPort = Object.freeze({
        armPreparedProjectileCaptureReleaseBatch(request) {
            const current = registry.copyEntityView(projectile, {});
            transactionLog.push(Object.freeze({
                type: 'arm',
                metadata: current.metadata,
                metadataRevision: current.metadataRevision,
                request
            }));
            armedRequest = request;
            return Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: true,
                receipt: Object.freeze({
                    targetFixedTick: request.targetFixedTick,
                    batchIdFingerprint: request.batchIdFingerprint,
                    commandIdFingerprint: request.commandIdFingerprint
                }),
                armedCount: request.records.length,
                commandIdFingerprint: request.commandIdFingerprint,
                requiresRecovery: false
            });
        },
        commitArmedProjectileCaptureReleaseBatch(receipt) {
            const current = registry.copyEntityView(projectile, {});
            transactionLog.push(Object.freeze({
                type: 'commit',
                metadata: current.metadata,
                metadataRevision: current.metadataRevision,
                receipt
            }));
            return Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: true,
                targetFixedTick: armedRequest.targetFixedTick,
                committedCount: armedRequest.records.length,
                commandIdFingerprint: armedRequest.commandIdFingerprint,
                requiresRecovery: false
            });
        },
        cancelArmedProjectileCaptureReleaseBatch() {
            transactionLog.push(Object.freeze({ type: 'cancel' }));
            return Object.freeze({ accepted: true });
        }
    });
    const owner = new EnemyLifecycleCommandOwner(backend, registry, {
        projectileCaptureReleaseAuthority: Object.freeze({
            consumePermit(candidate) {
                if (!permitAvailable || candidate !== releasePermit) {
                    return false;
                }
                permitAvailable = false;
                return true;
            }
        }),
        activeMetadataMutationRegistryAuthority: metadataAuthority,
        projectileCaptureReleaseTransactionPort: transactionPort
    });
    return {
        backend,
        registry,
        projectile,
        releasePermit,
        transactionLog,
        owner
    };
}

function deathPrepareEvidence() {
    return Object.freeze({
        prepareFingerprint: 77,
        anchor: Object.freeze({ x: 1, y: 2 }),
        facing: Object.freeze({ x: 0, y: 1 }),
        capturedSpeed: 9,
        targetSelector: GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD,
        targetHandle: null,
        targetBodySlot: 0xffffffff,
        profileCode: 1,
        capturedAtFixedTick: 5,
        releaseDueFixedTick: 65,
        baseReason: GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH
    });
}

test('lifecycle publishes metadata CAS before backend commit while preserving immutable origin', () => {
    const fixture = createFixture();
    const before = fixture.registry.copyEntityView(fixture.projectile, {});
    const captor = Object.freeze({ entityId: 7, incarnation: 3 });
    const receipt = fixture.owner.requestProjectileCaptureReleaseBatch(
        Object.freeze({
            prepareSourceTick: 10,
            batchIdFingerprint: 55,
            records: Object.freeze([Object.freeze({
                projectileHandle: fixture.projectile,
                captorHandle: captor,
                captureSequence: 6,
                releaseReason:
                    GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH,
                expectedMetadata: before.metadata,
                expectedMetadataRevision: before.metadataRevision,
                towerTargetHandle: null,
                prepareEvidence: deathPrepareEvidence(),
                coreImpactReceipt: null
            })])
        }),
        11,
        'ring-projectile-capture-release:1:10:55',
        fixture.releasePermit
    );
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.commandIdFingerprint > 0, true);
    assert.equal(fixture.transactionLog.length, 0);
    assert.equal(fixture.registry.copyEntityView(fixture.projectile, {}).metadata,
        before.metadata);

    const committed = fixture.owner.commitAtFixedBoundary(11);
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.projectileCaptureReleases.length, 1);
    assert.equal(committed.projectileCaptureReleases[0].backendCommitRequested,
        true);
    assert.deepEqual(fixture.transactionLog.map(({ type }) => type), [
        'arm',
        'commit'
    ]);
    assert.equal(fixture.transactionLog[0].metadata, before.metadata);
    assert.equal(fixture.transactionLog[0].metadataRevision, 1);
    assert.equal(fixture.transactionLog[1].metadataRevision, 2);
    const after = fixture.registry.copyEntityView(fixture.projectile, {});
    assert.deepEqual({
        entityId: after.entityId,
        incarnation: after.incarnation
    }, fixture.projectile);
    assert.equal(after.metadata.teamId, 2);
    assert.equal(after.metadata.ownerEntityId, captor.entityId);
    assert.equal(after.metadata.originOwnerEntityId, 90);
    assert.equal(after.metadata.originOwnerIncarnation, 2);
    assert.equal(after.metadata.originProducerId, 'tower-primary');
});

test('CORE release cannot enter lifecycle without exact numeric CORE base proof and opaque receipt', () => {
    const fixture = createFixture();
    const before = fixture.registry.copyEntityView(fixture.projectile, {});
    assert.throws(() => fixture.owner.requestProjectileCaptureReleaseBatch(
        Object.freeze({
            prepareSourceTick: 10,
            batchIdFingerprint: 56,
            records: Object.freeze([Object.freeze({
                projectileHandle: fixture.projectile,
                captorHandle: Object.freeze({ entityId: 7, incarnation: 3 }),
                captureSequence: 6,
                releaseReason:
                    GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT,
                expectedMetadata: before.metadata,
                expectedMetadataRevision: before.metadataRevision,
                towerTargetHandle: null,
                prepareEvidence: deathPrepareEvidence(),
                coreImpactReceipt: null
            })])
        }),
        11,
        'ring-projectile-capture-release:1:10:56',
        fixture.releasePermit
    ), /core-impact|receipt/u);
    assert.equal(fixture.transactionLog.length, 0);
    assert.equal(fixture.registry.copyEntityView(fixture.projectile, {}).metadata,
        before.metadata);
});

test('direct release arm capacity exhaustion is retryable and leaves the batch unarmed', () => {
    const platform = Object.freeze({
        getState: () => Object.freeze({ ready: false }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
    const simulation = new GpuCircleBodySimulation(platform, {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 },
        projectileCaptureCompletionCapacity: 2,
        projectileCaptureReleasePreparationCapacity: 1,
        projectileCaptureCleanupCapacity: 2
    });
    const rejected = simulation.armPreparedProjectileCaptureReleaseBatch({
        records: Object.freeze([Object.freeze({}), Object.freeze({})])
    });
    assert.deepEqual({ ...rejected }, {
        abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
        accepted: false,
        reason: 'projectile-capture-release-capacity',
        requiresRecovery: false,
        retryable: true,
        receipt: null
    });
    const status = simulation.getProjectileCaptureRuntimeStatus();
    assert.equal(status.armedReleaseCount, 0);
    assert.equal(status.commitRequested, false);
    assert.equal(status.requiresRecovery, false);
    simulation.destroy();
});
