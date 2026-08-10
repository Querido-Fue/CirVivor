import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);

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

function transformRequest(sourceA, sourceB, createdAtTick = 2) {
    return Object.freeze({
        transforms: Object.freeze([Object.freeze({
            sourceHandles: Object.freeze([sourceA, sourceB]),
            destination: Object.freeze({
                kindId: 'enemy',
                definitionId: 'basic_hexa_group_01',
                createdAtTick,
                metadata: null
            })
        })])
    });
}

test('WorldRegistry atomic transform authority/token은 private이고 full-capacity publish가 원자적이다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 2, atomicTransformAuthority: authority });
    const sourceA = activate(registry, 'basic_hexa_01', 1);
    const sourceB = activate(registry, 'basic_hexa_01', 1);
    assert.equal(registry.getStatus().activeCount, 2);
    assert.equal(registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'should-not-fit',
        createdAtTick: 1
    }), null);

    assert.equal(registry.atomicTransformAuthority, undefined);
    assert.equal(registry.atomicTransformGeneration, undefined);
    assert.equal(registry.atomicTransformBatchPlans, undefined);
    assert.equal(Object.keys(registry).some((key) => key.includes('atomicTransform')), false);
    assert.throws(() => registry.preflightAtomicTransformBatch(
        transformRequest(sourceA, sourceB)
    ), /authority/);
    assert.throws(() => registry.preflightAtomicTransformBatch(
        transformRequest(sourceA, sourceB),
        Object.freeze({})
    ), /authority/);
    assert.deepEqual({ ...registry.getStatus() }, {
        capacity: 2,
        activeCount: 2,
        reservedCount: 0,
        revision: 4,
        destroyed: false
    });

    const preflight = registry.preflightAtomicTransformBatch(
        transformRequest(sourceB, sourceA),
        authority
    );
    assert.ok(preflight);
    assert.equal(preflight.transforms.length, 1);
    assert.deepEqual(
        Array.from(preflight.transforms[0].sourceHandles, (handle) => ({
            ...handle
        })),
        [{ ...sourceA }, { ...sourceB }]
    );
    assert.deepEqual({ ...preflight.transforms[0].destinationHandle }, {
        entityId: sourceA.entityId,
        incarnation: sourceA.incarnation + 1
    });
    assert.equal(registry.getStatus().activeCount, 2, 'preflight는 zero mutation');

    const committed = registry.commitAtomicTransformBatch(preflight.token, authority);
    assert.equal(committed.committed, true);
    assert.equal(registry.has(sourceA), false);
    assert.equal(registry.has(sourceB), false);
    assert.equal(registry.has(preflight.transforms[0].destinationHandle), true);
    assert.equal(registry.getStatus().activeCount, 1);
    assert.equal(registry.commitAtomicTransformBatch(preflight.token, authority), null);
    assert.equal(registry.cancelAtomicTransformBatch(preflight.token, authority), false);
    assert.equal(registry.getStatus().activeCount, 1, 'replay는 mutation 0');
});

test('WorldRegistry transform token은 stale validation 첫 commit 시도에도 소비된다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 3, atomicTransformAuthority: authority });
    const sourceA = activate(registry, 'basic_hexa_01', 1);
    const sourceB = activate(registry, 'basic_hexa_01', 1);
    const preflight = registry.preflightAtomicTransformBatch(
        transformRequest(sourceA, sourceB),
        authority
    );
    const unrelated = activate(registry, 'unrelated', 2);
    const before = registry.getStatus();
    assert.equal(registry.commitAtomicTransformBatch(preflight.token, authority), null);
    assert.equal(registry.commitAtomicTransformBatch(preflight.token, authority), null);
    assert.deepEqual(registry.getStatus(), before);
    assert.equal(registry.has(sourceA), true);
    assert.equal(registry.has(sourceB), true);
    assert.equal(registry.has(unrelated), true);
});

test('overlap/stale batch preflight는 whole-batch zero-partial이다', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({ capacity: 4, atomicTransformAuthority: authority });
    const sourceA = activate(registry, 'basic_hexa_01', 1);
    const sourceB = activate(registry, 'basic_hexa_01', 1);
    const sourceC = activate(registry, 'basic_hexa_01', 1);
    const before = registry.getStatus();
    const request = {
        transforms: [
            transformRequest(sourceA, sourceB).transforms[0],
            transformRequest(sourceA, sourceC).transforms[0]
        ]
    };
    assert.equal(registry.preflightAtomicTransformBatch(request, authority), null);
    assert.deepEqual(registry.getStatus(), before);
    assert.equal(registry.has(sourceA), true);
    assert.equal(registry.has(sourceB), true);
    assert.equal(registry.has(sourceC), true);
});

console.log('WorldRegistry atomic Formation: ok');
