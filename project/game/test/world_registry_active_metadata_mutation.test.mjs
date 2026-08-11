import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);

function activate(registry, metadata) {
    const handle = registry.reserveEntity({
        kindId: 'projectile',
        definitionId: 'capturable-round',
        createdAtTick: 1
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, metadata), true);
    return handle;
}

test('active metadata batch preserves exact handle and publishes one revision atomically', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 2,
        activeMetadataMutationAuthority: authority
    });
    const handle = activate(registry, {
        teamId: 'PLAYER',
        projectileCapturePolicyId: 'CAPTURABLE',
        originProducerId: 'tower-primary'
    });
    const before = registry.copyEntityView(handle, {});
    const beforeRegistryRevision = registry.getRevision();
    const nextMetadata = Object.freeze({
        ...before.metadata,
        teamId: 'HOSTILE',
        ownerEntityId: 77,
        ownerIncarnation: 3
    });

    const preflight = registry.preflightActiveMetadataMutationBatch({
        mutations: [Object.freeze({
            handle,
            expectedMetadata: before.metadata,
            expectedMetadataRevision: before.metadataRevision,
            nextMetadata
        })]
    }, authority);

    assert.equal(preflight.accepted, true);
    assert.equal(registry.getRevision(), beforeRegistryRevision);
    assert.equal(registry.copyEntityView(handle, {}).metadata, before.metadata);
    assert.equal(preflight.mutations[0].nextMetadataRevision, 2);

    const committed = registry.commitActiveMetadataMutationBatch(
        preflight.token,
        authority
    );
    assert.equal(committed.accepted, true);
    assert.equal(registry.getRevision(), beforeRegistryRevision + 1);
    const after = registry.copyEntityView(handle, {});
    assert.deepEqual({
        entityId: after.entityId,
        incarnation: after.incarnation
    }, handle);
    assert.notEqual(after.metadata, before.metadata);
    assert.equal(after.metadataRevision, 2);
    assert.equal(after.metadata.teamId, 'HOSTILE');
    assert.equal(after.metadata.originProducerId, 'tower-primary');
    assert.equal(
        registry.commitActiveMetadataMutationBatch(preflight.token, authority),
        null
    );
});

test('active metadata token is cancelled or invalidated by any intervening registry publication', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 2,
        activeMetadataMutationAuthority: authority
    });
    const handle = activate(registry, { teamId: 'PLAYER' });
    const view = registry.copyEntityView(handle, {});
    const request = {
        mutations: [{
            handle,
            expectedMetadata: view.metadata,
            expectedMetadataRevision: view.metadataRevision,
            nextMetadata: Object.freeze({ teamId: 'HOSTILE' })
        }]
    };

    const cancelled = registry.preflightActiveMetadataMutationBatch(
        request,
        authority
    );
    assert.equal(
        registry.cancelActiveMetadataMutationBatch(cancelled.token, authority),
        true
    );
    assert.equal(
        registry.commitActiveMetadataMutationBatch(cancelled.token, authority),
        null
    );

    const stale = registry.preflightActiveMetadataMutationBatch(
        request,
        authority
    );
    activate(registry, { teamId: 'NEUTRAL' });
    assert.equal(
        registry.commitActiveMetadataMutationBatch(stale.token, authority),
        null
    );
    assert.equal(registry.copyEntityView(handle, {}).metadata, view.metadata);
});

test('active metadata preflight rejects stale identity/revision, duplicates, empty, and accessor data', () => {
    const authority = Object.freeze({});
    const registry = new WorldRegistry({
        capacity: 1,
        activeMetadataMutationAuthority: authority
    });
    const handle = activate(registry, { teamId: 'PLAYER' });
    const view = registry.copyEntityView(handle, {});
    const mutation = Object.freeze({
        handle,
        expectedMetadata: view.metadata,
        expectedMetadataRevision: view.metadataRevision,
        nextMetadata: Object.freeze({ teamId: 'HOSTILE' })
    });

    assert.equal(registry.preflightActiveMetadataMutationBatch({
        mutations: []
    }, authority).reason, 'active-metadata-mutation-empty-batch');
    assert.equal(registry.preflightActiveMetadataMutationBatch({
        mutations: [mutation, mutation]
    }, authority).reason, 'active-metadata-mutation-duplicate-handle');
    assert.equal(registry.preflightActiveMetadataMutationBatch({
        mutations: [{
            ...mutation,
            expectedMetadataRevision: view.metadataRevision + 1
        }]
    }, authority).reason, 'active-metadata-mutation-stale');
    assert.throws(() => registry.preflightActiveMetadataMutationBatch({
        mutations: [{
            ...mutation,
            nextMetadata: Object.defineProperty({}, 'teamId', {
                enumerable: true,
                get() {
                    throw new Error('must not execute');
                }
            })
        }]
    }, authority), /getter\/setter/u);
    assert.throws(() => registry.preflightActiveMetadataMutationBatch({
        mutations: [mutation]
    }, Object.freeze({})), /authority/u);
});
