import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    createGpuSignedDistanceField
} = await loadGameModule('ingame/physics/gpu/gpu_signed_distance_field.js');
const {
    createGpuCollisionGridDescriptor,
    getGpuCollisionGridFootprint,
    gpuCollisionGridBodyUsesSmall
} = await loadGameModule('ingame/physics/gpu/gpu_collision_grid_contract.js');
const {
    GPU_COLLISION_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const {
    ACTOR_ACTION_ENEMY_PAYLOAD_CANDIDATE_POLICY,
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY
} = await loadGameModule('ingame/contract/actor_action_contract.js');
const {
    R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    GPU_ACTOR_ACTION_SPAWN_ADMISSION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_action_placement_shaders.js'
);
const {
    GPU_ACTOR_PAYLOAD_SPAWN_ADMISSION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js'
);
const {
    GPU_SPAWN_ADMISSION_SHARED_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_spawn_admission_shaders.js'
);
const {
    planTowerRecoveryLayout,
    TOWER_RECOVERY_LAYOUT_CANDIDATE_POLICY_ID,
    TowerRecoveryLayoutCapacityError
} = await loadGameModule('ingame/object/tower/tower_recovery_layout_planner.js');

function createOpenSdf(size) {
    return createGpuSignedDistanceField({
        cols: size,
        rows: size,
        size: size * size,
        cellSize: 1,
        blocked: new Uint8Array(size * size)
    });
}

function createRecords(count) {
    return Array.from({ length: count }, (_, index) => Object.freeze({
        logicalTowerId: `tower:${index + 1}`,
        logicalTowerOrdinal: index + 1
    }));
}

function assertLayout(count) {
    const sdf = createOpenSdf(40);
    const grid = createGpuCollisionGridDescriptor({
        worldSize: { x: 40, y: 40 },
        gridCellSize: { x: 1.5, y: 1.5 },
        gridCellCount: { x: 27, y: 27 },
        maxBodiesPerCell: 64,
        maximumBodyRadius: 0.505
    });
    const result = planTowerRecoveryLayout({
        records: createRecords(count).reverse(),
        anchorPosition: { x: 20, y: 20 },
        radius: 0.5,
        clearance: 1 / 64,
        sdf,
        worldBounds: grid.worldBounds,
        grid,
        existingBodies: [{ position: { x: 2, y: 2 }, radius: 0.505 }]
    });
    assert.equal(result.placements.length, count);
    assert.equal(new Set(result.placements.map(({ position }) => (
        `${position.x}:${position.y}`
    ))).size, count);
    assert.deepEqual(
        result.placements.map(({ logicalTowerOrdinal }) => logicalTowerOrdinal),
        Array.from({ length: count }, (_, index) => index + 1)
    );
    return result;
}

assertLayout(1);
assertLayout(73);
assertLayout(256);

const exactGrid = createGpuCollisionGridDescriptor({
    worldSize: { x: 8, y: 8 },
    gridCellSize: { x: 2, y: 2 },
    gridCellCount: { x: 4, y: 4 },
    maxBodiesPerCell: 64,
    maximumBodyRadius: 2
});
assert.equal(gpuCollisionGridBodyUsesSmall(1, exactGrid), true);
assert.equal(gpuCollisionGridBodyUsesSmall(1.0001, exactGrid), false);
assert.deepEqual(
    getGpuCollisionGridFootprint({ x: 3, y: 3 }, 1, exactGrid)
        .counterIndices,
    [10]
);
assert.deepEqual(
    getGpuCollisionGridFootprint({ x: 3, y: 3 }, 1.0001, exactGrid)
        .counterIndices,
    [1, 3, 5, 9, 11, 13, 17, 19, 21]
);
assert.match(GPU_COLLISION_COMPUTE_WGSL, /fn collision_grid_footprint\(/);
assert.match(
    GPU_COLLISION_COMPUTE_WGSL,
    /let footprint = collision_grid_footprint\(predicted, body\.radius\)/
);

assert.notEqual(
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY.id,
    ACTOR_ACTION_ENEMY_PAYLOAD_CANDIDATE_POLICY.id
);
assert.notEqual(
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY.id,
    R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER.id
);
assert.notEqual(
    TOWER_RECOVERY_LAYOUT_CANDIDATE_POLICY_ID,
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY.id
);
assert.notEqual(
    TOWER_RECOVERY_LAYOUT_CANDIDATE_POLICY_ID,
    R3_ENEMY_ACTOR_PAYLOAD_SAFE_PLACEMENT_RESOLVER.id
);
assert.notEqual(
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY.targetLatticeRounds,
    ACTOR_ACTION_ENEMY_PAYLOAD_CANDIDATE_POLICY.targetLatticeRounds
);
assert.notEqual(
    ACTOR_ACTION_TOWER_PAYLOAD_CANDIDATE_POLICY.sourceRadialRounds,
    ACTOR_ACTION_ENEMY_PAYLOAD_CANDIDATE_POLICY.sourceRadialRounds
);
assert.match(
    GPU_ACTOR_ACTION_SPAWN_ADMISSION_WGSL,
    /fn tower_payload_candidate\(/
);
assert.match(
    GPU_ACTOR_ACTION_SPAWN_ADMISSION_WGSL,
    /fn enemy_payload_candidate\(/
);
assert.match(
    GPU_ACTOR_PAYLOAD_SPAWN_ADMISSION_WGSL,
    /fn enemy_payload_candidate\(/
);
assert.match(
    GPU_ACTOR_PAYLOAD_SPAWN_ADMISSION_WGSL,
    /const LOCAL_CANDIDATE_COUNT: u32 = 14u/
);
assert.doesNotMatch(
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    /tower_payload_candidate|enemy_payload_candidate|recovery_candidate/
);
assert.match(
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    /fn spawn_admission_overlaps_existing\(/
);
assert.match(
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    /fn spawn_admission_overlaps_sibling\(/
);
assert.match(
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    /fn spawn_admission_cell_capacity_available\(/
);
assert.match(
    GPU_SPAWN_ADMISSION_SHARED_WGSL,
    /fn spawn_admission_claim\(/
);

const impossibleSdf = createOpenSdf(2);
const impossibleGrid = createGpuCollisionGridDescriptor({
    worldSize: { x: 2, y: 2 },
    gridCellSize: { x: 1, y: 1 },
    gridCellCount: { x: 2, y: 2 },
    maxBodiesPerCell: 1,
    maximumBodyRadius: 0.5
});
assert.throws(
    () => planTowerRecoveryLayout({
        records: createRecords(5),
        anchorPosition: { x: 1, y: 1 },
        radius: 0.5,
        clearance: 1 / 64,
        sdf: impossibleSdf,
        worldBounds: impossibleGrid.worldBounds,
        grid: impossibleGrid,
        existingBodies: []
    }),
    (error) => error instanceof TowerRecoveryLayoutCapacityError
        && error.code === 'RECOVERY_LAYOUT_CAPACITY_EXCEEDED'
        && error.diagnostic.placedCount < error.diagnostic.requestedCount
);

console.log('post-R5 recovery layout/grid authority: ok');
