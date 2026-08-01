import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const { createRouteFlowFieldAtlas } = await loadGameModule(
    'ingame/navigation/route_flow_field_atlas.js'
);

function createUnavailablePlatformPort() {
    return {
        getState: () => ({ status: 'unsupported' }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    };
}

function createBody(x) {
    return {
        position: { x, y: 2 },
        velocity: { x: 1, y: 0 },
        radius: 0.25,
        inverseMass: 1,
        layerMask: 1,
        collisionMask: 1,
        alive: true
    };
}

test('unsupported WebGPU는 spawn 성공으로 오인하지 않고 명시적으로 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });

    assert.equal(simulation.init(), false);
    assert.deepEqual({ ...simulation.replaceBodies([createBody(1), createBody(2)]) }, {
        accepted: 0,
        rejected: 2,
        capacity: 2,
        reason: 'unavailable'
    });
    assert.deepEqual({ ...simulation.replaceBodies([
        createBody(1),
        createBody(2),
        createBody(3)
    ]) }, {
        accepted: 0,
        rejected: 3,
        capacity: 2
    });
    assert.equal(simulation.getStatus().bodyCount, 0);
    assert.equal(simulation.fixedUpdate(1 / 60), false);
    assert.equal(simulation.getStatus().state, 'unavailable');
});

test('incremental spawn은 stable entity handle을 강제하고 실패 시 host 상태를 보존한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.spawnBodies([createBody(1)]), /entityId와 incarnation/);
    assert.throws(() => simulation.spawnBodies([
        { ...createBody(1), entityId: 7, incarnation: 2 },
        { ...createBody(2), entityId: 7, incarnation: 2 }
    ]), /이미 활성 상태인 enemy handle/);
    assert.throws(() => simulation.spawnBodies([{
        ...createBody(1),
        entityId: 7,
        incarnation: 2,
        simulationMeta: 1
    }]), /ALIVE flag와 alive 입력/);
    assert.deepEqual({ ...simulation.spawnBodies([{
        ...createBody(1),
        entityId: 7,
        incarnation: 2
    }]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 2,
        reason: 'unavailable'
    });
    assert.equal(simulation.hasBody({ entityId: 7, incarnation: 2 }), false);
    assert.equal(simulation.getStatus().bodyCount, 0);
    assert.equal(simulation.getStatus().activeBodyCount, 0);
});

test('frame delta 0은 pause 안전 규칙으로 reference prediction age를 제거한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    simulation.replaceBodies([createBody(1)]);
    simulation.fixedUpdate(1 / 60);
    simulation.updatePresentation({ frameDelta: 0.05, renderFrameId: 1 });
    assert.equal(
        simulation.getStatus().presentation.predictionDelta,
        Math.fround(0.05)
    );

    simulation.updatePresentation({ frameDelta: 0, renderFrameId: 2 });
    assert.equal(simulation.getStatus().presentation.predictionDelta, 0);
});

test('동적 body 지름이 grid cell을 넘으면 누락 가능한 3x3 구성을 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        radius: 0.51
    }]), /동적 body 지름/);
});

test('static/dynamic epsilon 경계가 모호한 inverse mass는 host에서 거부한다', () => {
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        inverseMass: 0.000001
    }]), /inverseMass는 0 또는/);
});

test('flow body는 기존 JS/WASM atlas 범위와 per-body speed 계약을 검증한다', () => {
    const tileMap = createTileMap();
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const simulation = new GpuCircleBodySimulation(createUnavailablePlatformPort(), {
        capacity: 1,
        worldSize: {
            x: tileMap.getWorldBounds().width,
            y: tileMap.getWorldBounds().height
        },
        gridCellSize: { x: 1.5, y: 1.5 },
        sdf: null,
        flowFieldAtlas: atlas
    });
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: atlas.fieldCount,
        flowSpeed: 6.25
    }]), /flowFieldIndex가 atlas 범위/);
    assert.throws(() => simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: 0,
        flowSpeed: -1
    }]), /flowSpeed/);
    assert.deepEqual({ ...simulation.replaceBodies([{
        ...createBody(1),
        flowFieldIndex: 0,
        flowSpeed: 6.25
    }]) }, {
        accepted: 0,
        rejected: 1,
        capacity: 1,
        reason: 'unavailable'
    });
});
