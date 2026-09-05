import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_JORANG_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_jorang_enemy_data.js');
const {
    createGpuEnemySpawnIntent,
    materializeNaturalJorangAtomicTransformActivation
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    resolveEnemySpawnStats
} = await loadGameModule('ingame/object/enemy/resolved_enemy_spawn_stats.js');
const {
    createGpuRegistryMetadata
} = await loadGameModule('ingame/object/gpu_spawn_intent.js');
const {
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'jorang-spawn-boundary-gate',
    pathId: 'jorang-spawn-boundary-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 1, y: 2 }),
        Object.freeze({ x: 2, y: 2 })
    ])
});

test('J spawn boundary preserves canonical uint32 bounty 12', () => {
    const intent = createGpuEnemySpawnIntent({
        definition: BASIC_JORANG_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 0
    });
    assert.equal(intent.bountyBudget, 12);
    assert.equal(intent.renderStyle.shapeCode, GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG);
    assert.equal(intent.atomicTransformState, undefined);
    assert.equal(intent.lineageRootEntityId, undefined);
    assert.equal(intent.lineageRootIncarnation, undefined);
    assert.equal(intent.atomicTransformTriggerSourceEntityId, undefined);
    assert.equal(intent.atomicTransformTriggerSourceIncarnation, undefined);
    assert.throws(() => createGpuRegistryMetadata(intent),
        /atomic transform|activation|lineage/i);
    const activated = materializeNaturalJorangAtomicTransformActivation(
        intent,
        Object.freeze({ entityId: 17, incarnation: 4 })
    );
    const metadata = createGpuRegistryMetadata(activated);
    assert.equal(activated.bountyBudget, 12);
    assert.equal(activated.atomicTransformState.lineageRootEntityId, 17);
    assert.equal(activated.atomicTransformState.lineageRootIncarnation, 4);
    assert.equal(activated.atomicTransformState.branchIndex, 0);
    assert.equal(activated.atomicTransformState.entityId, 17);
    assert.equal(activated.atomicTransformState.incarnation, 4);
    assert.equal(activated.atomicTransformState.programId,
        GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT);
    assert.equal(activated.atomicTransformState.phase,
        GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED);
    assert.equal(activated.atomicTransformState.dueFixedTick, 0);
    assert.equal(metadata.bountyBudget, 12);
    assert.equal(metadata.lineageRootEntityId, 17);
    assert.equal(metadata.lineageRootIncarnation, 4);
    assert.equal(metadata.branchIndex, 0);
    assert.equal(metadata.transformAtTick, 0);
    assert.equal(metadata.atomicTransformProgramId,
        activated.atomicTransformState.programId);
    assert.equal(metadata.atomicTransformPhase,
        activated.atomicTransformState.phase);
    assert.equal(BASIC_JORANG_ENEMY_DATA.bountyBudget, 12);
    assert.equal(Object.isFrozen(BASIC_JORANG_ENEMY_DATA), true);
});

test('J spawn request rejects fractional, negative, and uint32-overflow bounty with zero mutation', () => {
    const canonicalStats = resolveEnemySpawnStats({
        definition: BASIC_JORANG_ENEMY_DATA
    });
    const before = { ...canonicalStats };
    for (const invalidBountyBudget of [12.5, -1, 0x100000000]) {
        assert.throws(() => resolveEnemySpawnStats({
            definition: BASIC_JORANG_ENEMY_DATA,
            waveEnemyModifiers: {
                global: {
                    absolute: { bountyBudget: invalidBountyBudget }
                }
            }
        }), /bountyBudget|uint32/);
        const resolvedStats = Object.freeze({
            ...canonicalStats,
            bountyBudget: invalidBountyBudget
        });
        assert.throws(() => createGpuEnemySpawnIntent({
            definition: BASIC_JORANG_ENEMY_DATA,
            route: FIXTURE_ROUTE,
            spawnSequence: 1,
            resolvedStats
        }), /bountyBudget|uint32/);
        assert.equal(resolvedStats.bountyBudget, invalidBountyBudget);
        assert.deepEqual(canonicalStats, before);
        assert.equal(BASIC_JORANG_ENEMY_DATA.bountyBudget, 12);
    }
    assert.throws(() => resolveEnemySpawnStats({
        definition: BASIC_JORANG_ENEMY_DATA,
        waveEnemyModifiers: {
            global: {
                multipliers: { bountyBudget: 1.01 }
            }
        }
    }), /bountyBudget|uint32/);

    const canonical = createGpuEnemySpawnIntent({
        definition: BASIC_JORANG_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: 2,
        resolvedStats: canonicalStats
    });
    assert.equal(canonical.bountyBudget, 12);
    assert.throws(() => createGpuRegistryMetadata(canonical),
        /atomic transform|activation|lineage/i);
});
