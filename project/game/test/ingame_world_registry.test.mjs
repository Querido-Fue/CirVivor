import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);

function reserveEnemy(registry, createdAtTick = 1) {
    return registry.reserveEntity({
        kindId: 'enemy',
        definitionId: 'basic_circle_01',
        createdAtTick
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
