import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { EnemySimulationBackend } = await loadGameModule(
    'ingame/object/enemy/enemy_simulation_backend.js'
);
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

function createTileMapSource() {
    const cols = 4;
    const rows = 4;
    const blocked = new Uint8Array([
        1, 1, 1, 1,
        1, 0, 0, 1,
        1, 0, 0, 1,
        1, 1, 1, 1
    ]);
    return {
        getNavigationGrid() {
            return { cols, rows, size: cols * rows, cellSize: 1, blocked };
        },
        getWorldBounds() {
            return { minX: 0, minY: 0, maxX: 4, maxY: 4, width: 4, height: 4 };
        }
    };
}

function createBody() {
    return {
        position: { x: 1.5, y: 1.5 },
        velocity: { x: 0, y: 0 },
        radius: 0.25,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 129,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        alive: true
    };
}

test('empty enemy session은 GPU 자원을 지연하고 terminal unsupported spawn을 hard failure로 분류한다', () => {
    let deviceReadCount = 0;
    const platform = {
        getState: () => ({ status: 'unsupported' }),
        getDevice() {
            deviceReadCount++;
            return null;
        },
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const backend = new EnemySimulationBackend({ webGpuPlatformPort: platform });

    assert.equal(backend.getCapacity(), 16384);
    assert.equal(backend.init(createTileMapSource()), false);
    assert.equal(backend.getStatus().state, 'gpu-deferred');
    assert.equal(backend.getStatus().flowFieldCount, 0);
    assert.equal(backend.getStatus().gpu.capacity, 16384);
    assert.equal(deviceReadCount, 0);
    assert.equal(backend.fixedUpdate(1 / 60), false);
    assert.equal(backend.draw(null), false);
    assert.equal(deviceReadCount, 0);

    assert.deepEqual({ ...backend.replaceBodies([createBody()]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 16384,
        reason: 'unavailable'
    });
    assert.ok(deviceReadCount > 0);
    assert.equal(backend.getStatus().state, 'gpu-terminal-unavailable');
    assert.equal(backend.requiresRecovery(), true);

    backend.destroy();
    assert.equal(backend.getStatus().state, 'destroyed');
});

test('platform port가 없는 명시적 GPU session은 retryable 상태로 남지 않는다', () => {
    const backend = new EnemySimulationBackend();

    assert.equal(backend.init(createTileMapSource()), false);
    assert.equal(backend.getStatus().state, 'gpu-terminal-unavailable');
    assert.deepEqual({ ...backend.spawnBodies([createBody()]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 16384,
        reason: 'gpu-unavailable'
    });
    assert.equal(backend.requiresRecovery(), true);

    backend.destroy();
});

test('실제 TileMap route는 기존 JS/WASM flow atlas와 pathId spawn binding을 준비한다', () => {
    const platform = {
        getState: () => ({ status: 'unsupported' }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
    const tileMap = createTileMap();
    const route = tileMap.getSpawnRoutes()[0];
    const backend = new EnemySimulationBackend({ webGpuPlatformPort: platform });

    assert.equal(backend.init(tileMap), false);
    const atlas = backend.getFlowFieldAtlas();
    assert.equal(atlas.fieldCount, route.waypoints.length - 1);
    assert.equal(backend.getStatus().flowFieldCount, atlas.fieldCount);
    assert.deepEqual({ ...backend.replaceBodies([{
        ...createBody(),
        position: route.entryPoint,
        pathId: route.pathId,
        waypointIndex: 1,
        flowSpeed: 6.25
    }]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 16384,
        reason: 'unavailable'
    });
    assert.throws(() => backend.replaceBodies([{
        ...createBody(),
        pathId: 'missing-path',
        flowSpeed: 1
    }]), /등록되지 않은 enemy pathId/);
    backend.destroy();
});
