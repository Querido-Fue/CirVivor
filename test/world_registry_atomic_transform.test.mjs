import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
} = await loadGameModule('ingame/contract/enemy_atomic_transform_contract.js');
const { WorldRegistry } = await loadGameModule('ingame/object/world_registry.js');

function activate(registry, definitionId, createdAtTick, metadata = null) {
    const handle = registry.reserveEntity({
        kindId: 'enemy',
        definitionId,
        createdAtTick
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, metadata), true);
    return handle;
}

function destination(definitionId, createdAtTick, metadata = null) {
    return Object.freeze({
        kindId: 'enemy',
        definitionId,
        createdAtTick,
        metadata
    });
}

test('WorldRegistry ONE_TO_MANY publishes root-first children with zero preflight mutation', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const source = activate(registry, 'basic_gen_01', 10, {
        lineageRootEntityId: 1,
        lineageRootIncarnation: 1,
        bountyBudget: 12
    });
    const before = registry.getStatus();
    const preflight = registry.preflightAtomicTransformBatch({
        transforms: [{
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
            sourceHandles: [source],
            destinations: [
                destination('basic_circle_prime_01', 11, {
                    lineageRootEntityId: source.entityId,
                    lineageRootIncarnation: source.incarnation,
                    branchIndex: 0,
                    bountyBudget: 6,
                    transformAtTick: 71
                }),
                destination('basic_circle_prime_01', 11, {
                    lineageRootEntityId: source.entityId,
                    lineageRootIncarnation: source.incarnation,
                    branchIndex: 1,
                    bountyBudget: 6,
                    transformAtTick: 71
                })
            ],
            effectTransferDestinationIndex: 0
        }]
    }, authority);
    assert.equal(preflight.accepted, true);
    assert.deepEqual(registry.getStatus(), before);
    assert.equal(preflight.transforms[0].destinationHandle, undefined);
    assert.equal(preflight.transforms[0].destinationHandles.length, 2);
    assert.deepEqual(preflight.transforms[0].destinationHandles[0], {
        entityId: source.entityId,
        incarnation: source.incarnation + 1
    });
    assert.notEqual(preflight.transforms[0].destinationHandles[1].entityId,
        source.entityId);
    assert.equal(preflight.transforms[0].effectTransferDestinationIndex, 0);

    const committed = registry.commitAtomicTransformBatch(preflight.token, authority);
    assert.equal(committed.accepted, true);
    assert.equal(committed.committed, true);
    assert.equal(registry.has(source), false);
    assert.equal(registry.getActiveCount('enemy'), 2);
    for (let index = 0; index < 2; index++) {
        const handle = committed.transforms[0].destinationHandles[index];
        const view = registry.copyEntityView(handle);
        assert.equal(view.definitionId, 'basic_circle_prime_01');
        assert.equal(view.metadata.branchIndex, index);
        assert.equal(view.metadata.bountyBudget, 6);
        assert.equal(view.metadata.lineageRootEntityId, source.entityId);
        assert.equal(view.metadata.lineageRootIncarnation, source.incarnation);
    }
});

test('WorldRegistry ONE_TO_ONE_DELAYED preserves each survivor root independently', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const child0 = activate(registry, 'basic_circle_prime_01', 11, { branchIndex: 0 });
    const child1 = activate(registry, 'basic_circle_prime_01', 11, { branchIndex: 1 });
    const preflight = registry.preflightAtomicTransformBatch({
        transforms: [child0, child1].map((source, branchIndex) => ({
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED,
            sourceHandles: [source],
            destinations: [destination('basic_gen_01', 71, {
                lineageRootEntityId: child0.entityId,
                lineageRootIncarnation: child0.incarnation,
                branchIndex,
                bountyBudget: 6,
                transformAtTick: 0
            })],
            effectTransferDestinationIndex: 0
        }))
    }, authority);
    assert.equal(preflight.accepted, true);
    assert.equal(preflight.transforms.length, 2);
    assert.deepEqual(preflight.transforms[0].destinationHandle, {
        entityId: child0.entityId,
        incarnation: child0.incarnation + 1
    });
    assert.deepEqual(preflight.transforms[1].destinationHandle, {
        entityId: child1.entityId,
        incarnation: child1.incarnation + 1
    });
    const committed = registry.commitAtomicTransformBatch(preflight.token, authority);
    assert.equal(committed.committed, true);
    assert.equal(registry.getActiveCount('enemy'), 2);
    for (const transform of committed.transforms) {
        assert.equal(registry.copyEntityView(transform.destinationHandle).definitionId,
            'basic_gen_01');
    }
});

test('WorldRegistry capacity rejection is retryable and never publishes a half child', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const source = activate(registry, 'basic_gen_01', 10);
    const blocker = activate(registry, 'capacity-blocker', 10);
    const request = {
        transforms: [{
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
            sourceHandles: [source],
            destinations: [
                destination('basic_circle_prime_01', 11),
                destination('basic_circle_prime_01', 11)
            ],
            effectTransferDestinationIndex: 0
        }]
    };
    const before = registry.getStatus();
    const rejected = registry.preflightAtomicTransformBatch(request, authority);
    assert.deepEqual(rejected, {
        accepted: false,
        reason: 'atomic-transform-capacity',
        retryable: true,
        capacity: 2,
        occupiedCount: 2,
        requiredCount: 3
    });
    assert.deepEqual(registry.getStatus(), before);
    assert.equal(registry.has(source), true);
    assert.equal(registry.has(blocker), true);

    assert.ok(registry.remove(blocker));
    const retry = registry.preflightAtomicTransformBatch(request, authority);
    assert.equal(retry.accepted, true);
    assert.equal(registry.commitAtomicTransformBatch(retry.token, authority).committed,
        true);
    assert.equal(registry.getActiveCount('enemy'), 2);
});

test('WorldRegistry shared MANY_TO_ONE seam retains legacy H root/effect destination', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const sourceA = activate(registry, 'basic_hexa_01', 1);
    const sourceB = activate(registry, 'basic_hexa_01', 1);
    const preflight = registry.preflightAtomicTransformBatch({
        transforms: [{
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE,
            sourceHandles: [sourceA, sourceB],
            destinations: [destination('basic_hexa_group_01', 2)],
            effectTransferDestinationIndex: 0
        }]
    }, authority);
    assert.equal(preflight.accepted, true);
    assert.equal(preflight.transforms[0].effectTransferDestinationIndex, 0);
    assert.deepEqual(preflight.transforms[0].destinationHandle, {
        entityId: sourceA.entityId,
        incarnation: sourceA.incarnation + 1
    });
    const committed = registry.commitAtomicTransformBatch(preflight.token, authority);
    assert.equal(committed.committed, true);
    assert.equal(registry.getActiveCount('enemy'), 1);
    assert.equal(registry.copyEntityView(committed.transforms[0].destinationHandle)
        .definitionId, 'basic_hexa_group_01');
});

test('WorldRegistry stale/ABA transaction token is consumed without partial mutation', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 3, atomicTransformAuthority: authority });
    const source = activate(registry, 'basic_gen_01', 10);
    const preflight = registry.preflightAtomicTransformBatch({
        transforms: [{
            topologyId: ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
            sourceHandles: [source],
            destinations: [
                destination('basic_circle_prime_01', 11),
                destination('basic_circle_prime_01', 11)
            ],
            effectTransferDestinationIndex: 0
        }]
    }, authority);
    const unrelated = activate(registry, 'unrelated', 11);
    const before = registry.getStatus();
    assert.equal(registry.commitAtomicTransformBatch(preflight.token, authority), null);
    assert.equal(registry.commitAtomicTransformBatch(preflight.token, authority), null);
    assert.deepEqual(registry.getStatus(), before);
    assert.equal(registry.has(source), true);
    assert.equal(registry.has(unrelated), true);
});
