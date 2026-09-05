import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { createGpuRegistryMetadata } = await loadGameModule(
    'ingame/object/gpu_spawn_intent.js'
);
const {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION
} = await loadGameModule('ingame/contract/projectile_capture_contract.js');

function createProjectileOriginProvenance({
    definitionId,
    sourceEntityId = null,
    sourceIncarnation = null,
    targetEntityId = null,
    targetIncarnation = null,
    producerId = null,
    sourceAbilityId = null
}) {
    return {
        projectileCapturePolicyId:
            PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
        schemaVersion: PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
        archetypeId: definitionId,
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1,
        originProducerId: producerId,
        originSourceAbilityId: sourceAbilityId,
        originOwnerEntityId: sourceEntityId,
        originOwnerIncarnation: sourceIncarnation,
        originSourceEntityId: sourceEntityId,
        originSourceIncarnation: sourceIncarnation,
        originTargetEntityId: targetEntityId,
        originTargetIncarnation: targetIncarnation
    };
}

function reserveEnemy(registry, createdAtTick = 1) {
    return registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_circle_01',
        createdAtTick
    });
}

function createTeamMetadata(teamId, allegiancePolicy, sourceEntityId, sourceIncarnation, producerId) {
    return createGpuRegistryMetadata({
        kindId: 'projectile',
        definitionId: 'registry-team-fixture',
        ...createProjectileOriginProvenance({
            definitionId: 'registry-team-fixture',
            sourceEntityId,
            sourceIncarnation,
            producerId
        }),
        teamId,
        damagePolicyId: 0,
        allegiancePolicy,
        sourceEntityId,
        sourceIncarnation,
        producerId
    });
}

test('예약 handle은 backend 수락 전 활성 query에서 보이지 않는다', () => {
    const registry = new WorldRegistry({ capacity: 2 });
    const handle = reserveEnemy(registry);
    const activeHandles = [];

    assert.ok(handle);
    assert.equal(registry.getReservedCount(), 1);
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(registry.getActiveCount('enemy'), 0);
    assert.equal(registry.has(handle), false);
    assert.equal(registry.copyEntityView(handle), null);
    assert.equal(registry.copyActiveHandlesInto(activeHandles), activeHandles);
    assert.deepEqual(activeHandles, []);

    assert.equal(registry.activateReserved(handle), true);
    assert.equal(registry.getReservedCount(), 0);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getActiveCount('enemy'), 1);
    assert.equal(registry.has(handle), true);
    assert.equal(registry.copyActiveHandlesInto(activeHandles), activeHandles);
    assert.equal(activeHandles.length, 1);
    assert.equal(activeHandles[0].entityId, handle.entityId);
    assert.equal(activeHandles[0].incarnation, handle.incarnation);

    const view = registry.copyEntityView(handle, {});
    assert.equal(view.entityId, handle.entityId);
    assert.equal(view.incarnation, handle.incarnation);
    assert.equal(view.kindId, 'enemy');
    assert.equal(view.definitionId, 'basic_circle_01');
    assert.equal(view.createdAtTick, 1);
    assert.equal(view.metadata, null);
});

test('제거된 entity ID는 incarnation을 올려 재사용하고 stale handle을 거부한다', () => {
    const registry = new WorldRegistry({ capacity: 1 });
    const firstHandle = reserveEnemy(registry, 3);

    assert.equal(registry.activateReserved(firstHandle), true);
    assert.equal(registry.remove(firstHandle), true);
    assert.equal(registry.has(firstHandle), false);
    assert.equal(registry.copyEntityView(firstHandle), null);
    assert.equal(registry.remove(firstHandle), false);

    const reusedHandle = reserveEnemy(registry, 4);
    assert.equal(reusedHandle.entityId, firstHandle.entityId);
    assert.equal(reusedHandle.incarnation, firstHandle.incarnation + 1);
    assert.equal(registry.activateReserved(reusedHandle), true);

    assert.equal(registry.has(firstHandle), false);
    assert.equal(registry.remove(firstHandle), false);
    assert.equal(registry.has(reusedHandle), true);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(registry.getReservedCount(), 0);
});

test('재사용 incarnation은 이전 team/provenance metadata를 새 entity에 누출하지 않는다', () => {
    const registry = new WorldRegistry({ capacity: 1 });
    const firstHandle = reserveEnemy(registry, 11);
    const firstMetadata = createTeamMetadata(
        1,
        'fixed-player',
        41,
        3,
        'first-player-source'
    );
    assert.equal(registry.activateReserved(firstHandle, firstMetadata), true);
    const firstView = registry.copyEntityView(firstHandle, {});
    assert.equal(firstView.metadata.teamId, 1);
    assert.equal(firstView.metadata.allegiancePolicy, 'fixed-player');
    assert.equal(firstView.metadata.sourceEntityId, 41);
    assert.equal(firstView.metadata.sourceIncarnation, 3);
    assert.equal(registry.remove(firstHandle), true);

    const reusedHandle = reserveEnemy(registry, 12);
    const reusedMetadata = createTeamMetadata(
        2,
        'fixed-hostile',
        77,
        5,
        'reused-hostile-source'
    );
    assert.equal(reusedHandle.entityId, firstHandle.entityId);
    assert.equal(reusedHandle.incarnation, firstHandle.incarnation + 1);
    assert.equal(registry.activateReserved(reusedHandle, reusedMetadata), true);

    assert.equal(registry.copyEntityView(firstHandle), null);
    const reusedView = registry.copyEntityView(reusedHandle, {});
    assert.equal(reusedView.metadata.teamId, 2);
    assert.equal(reusedView.metadata.allegiancePolicy, 'fixed-hostile');
    assert.equal(reusedView.metadata.sourceEntityId, 77);
    assert.equal(reusedView.metadata.sourceIncarnation, 5);
    assert.notDeepEqual(reusedView.metadata, firstMetadata);
});

test('exact target provenance metadata를 보존하고 incarnation reuse에 누출하지 않는다', () => {
    const registry = new WorldRegistry({ capacity: 1 });
    const firstHandle = reserveEnemy(registry, 13);
    const targetedMetadata = createGpuRegistryMetadata({
        kindId: 'projectile',
        definitionId: 'targeted-registry-fixture',
        ...createProjectileOriginProvenance({
            definitionId: 'targeted-registry-fixture',
            sourceEntityId: 71,
            sourceIncarnation: 4,
            targetEntityId: 81,
            targetIncarnation: 6,
            producerId: 'targeted-registry-producer',
            sourceAbilityId: 'exact-target-aim'
        }),
        teamId: 2,
        damagePolicyId: 0,
        allegiancePolicy: 'inherit-subject',
        sourceEntityId: 71,
        sourceIncarnation: 4,
        targetEntityId: 81,
        targetIncarnation: 6,
        producerId: 'targeted-registry-producer',
        sourceAbilityId: 'exact-target-aim',
        targetPolicyId: 'player-damageable-and-terrain',
        spawnSequence: 9
    });
    assert.equal(registry.activateReserved(firstHandle, targetedMetadata), true);
    const firstView = registry.copyEntityView(firstHandle, {});
    assert.equal(firstView.metadata.targetEntityId, 81);
    assert.equal(firstView.metadata.targetIncarnation, 6);
    assert.equal(firstView.metadata.sourceEntityId, 71);
    assert.equal(firstView.metadata.sourceIncarnation, 4);
    assert.equal(registry.remove(firstHandle), true);

    const reusedHandle = reserveEnemy(registry, 14);
    const untargetedMetadata = createGpuRegistryMetadata({
        kindId: 'projectile',
        definitionId: 'untargeted-registry-fixture',
        ...createProjectileOriginProvenance({
            definitionId: 'untargeted-registry-fixture',
            sourceEntityId: 91,
            sourceIncarnation: 8
        }),
        teamId: 1,
        damagePolicyId: 0,
        allegiancePolicy: 'fixed-player',
        sourceEntityId: 91,
        sourceIncarnation: 8,
        spawnSequence: 10
    });
    assert.equal(registry.activateReserved(reusedHandle, untargetedMetadata), true);
    const reusedView = registry.copyEntityView(reusedHandle, {});
    assert.equal(reusedView.metadata.targetEntityId, null);
    assert.equal(reusedView.metadata.targetIncarnation, null);
    assert.equal(reusedView.metadata.sourceEntityId, 91);
    assert.equal(reusedView.metadata.sourceIncarnation, 8);
});

test('cross-realm plain metadata는 getter 1회 snapshot과 fail-closed activation을 보존한다', () => {
    const registry = new WorldRegistry({ capacity: 2 });
    const handle = reserveEnemy(registry, 15);
    const metadata = {};
    let getterReadCount = 0;
    Object.defineProperties(metadata, {
        capabilityMask: {
            configurable: true,
            enumerable: true,
            get() {
                getterReadCount++;
                metadata.lateUnknown = 'not-in-key-snapshot';
                return 16;
            }
        },
        optionalValue: {
            enumerable: true,
            get() {
                getterReadCount++;
                return undefined;
            }
        }
    });

    assert.equal(registry.activateReserved(handle, metadata), true);
    assert.equal(getterReadCount, 2);
    const view = registry.copyEntityView(handle, {});
    assert.equal(Object.isFrozen(view.metadata), true);
    assert.equal(view.metadata.capabilityMask, 16);
    assert.equal(view.metadata.optionalValue, null);
    assert.equal('lateUnknown' in view.metadata, false);
    Object.defineProperty(metadata, 'capabilityMask', { value: 99 });
    assert.equal(view.metadata.capabilityMask, 16);

    const rejectedHandle = reserveEnemy(registry, 16);
    const beforeRejectedActivation = registry.getStatus();
    class MetadataRecord {
        constructor() {
            this.capabilityMask = 16;
        }
    }
    assert.throws(
        () => registry.activateReserved(rejectedHandle, new MetadataRecord()),
        /plain object/
    );
    assert.deepEqual(registry.getStatus(), beforeRejectedActivation);
    assert.equal(registry.has(rejectedHandle), false);
    assert.throws(
        () => registry.activateReserved(rejectedHandle, { nested: {} }),
        /primitive/
    );
    assert.deepEqual(registry.getStatus(), beforeRejectedActivation);
});

test('예약 취소와 destroy는 phantom entity를 남기지 않고 이후 mutation을 막는다', () => {
    const registry = new WorldRegistry({ capacity: 2 });
    const cancelledHandle = reserveEnemy(registry, 7);

    assert.equal(registry.cancelReservation(cancelledHandle), true);
    assert.equal(registry.cancelReservation(cancelledHandle), false);
    assert.equal(registry.getActiveCount(), 0);
    assert.equal(registry.getReservedCount(), 0);

    const activeHandle = reserveEnemy(registry, 8);
    const reservedHandle = reserveEnemy(registry, 9);
    assert.equal(registry.activateReserved(activeHandle), true);
    registry.destroy();

    const status = registry.getStatus();
    assert.equal(status.destroyed, true);
    assert.equal(status.activeCount, 0);
    assert.equal(status.reservedCount, 0);
    assert.equal(registry.has(activeHandle), false);
    assert.equal(registry.has(reservedHandle), false);
    assert.equal(registry.copyEntityView(activeHandle), null);
    assert.deepEqual(registry.copyActiveHandlesInto([]), []);
    assert.throws(() => reserveEnemy(registry, 10), /destroy/);
    assert.throws(() => registry.activateReserved(reservedHandle), /destroy/);
});
