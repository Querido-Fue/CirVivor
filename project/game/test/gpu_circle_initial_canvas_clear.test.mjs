import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);

function createPlatform(frameComposer = null) {
    let directClearCount = 0;
    return {
        getState: () => 'ready',
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => {
            directClearCount++;
            return true;
        },
        markCanvasDrawn: () => {},
        markCanvasCleared: () => {},
        getFrameComposer: () => frameComposer,
        getDirectClearCount: () => directClearCount
    };
}

function createSimulation(platform) {
    return new GpuCircleBodySimulation(platform, {
        capacity: 4,
        worldSize: { x: 64, y: 36 },
        gridCellSize: { x: 12, y: 12 }
    });
}

test('body가 없는 새 GPU 세션도 공유 canvas를 최초 1회 직접 clear한다', () => {
    const platform = createPlatform();
    const simulation = createSimulation(platform);

    assert.equal(simulation.draw(null), true);
    assert.equal(platform.getDirectClearCount(), 1);
    assert.equal(simulation.draw(null), false);
    assert.equal(platform.getDirectClearCount(), 1);
});

test('composer 최초 clear는 abort 시 재시도하고 commit 뒤 중복 제출하지 않는다', () => {
    let clearCount = 0;
    let callbacks = null;
    const composer = {
        isFrameActive: () => true,
        deferFrameCallbacks(nextCallbacks) {
            callbacks = nextCallbacks;
            return true;
        },
        clearCanvas() {
            clearCount++;
            return true;
        }
    };
    const simulation = createSimulation(createPlatform(composer));

    assert.equal(simulation.draw(null), true);
    assert.equal(clearCount, 1);
    callbacks.aborted();

    assert.equal(simulation.draw(null), true);
    assert.equal(clearCount, 2);
    callbacks.committed();

    assert.equal(simulation.draw(null), false);
    assert.equal(clearCount, 2);
});
