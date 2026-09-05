import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);
const realm = GpuCircleBodySimulation.constructor('return globalThis')();

function installGpuConstants() {
    const values = {
        GPUBufferUsage: { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8, INDIRECT: 16, MAP_READ: 32 },
        GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2 },
        GPUShaderStage: { COMPUTE: 1, VERTEX: 2 },
        GPUMapMode: { READ: 1 }
    };
    const old = Object.fromEntries(Object.keys(values).map(key => [key, realm[key]]));
    Object.assign(realm, values);
    return () => {
        for (const key of Object.keys(values)) {
            if (old[key] === undefined) delete realm[key];
            else realm[key] = old[key];
        }
    };
}

function createFixture(failAllocation = Infinity, failStage = null) {
    const resources = [];
    let allocationCount = 0;
    const allocate = descriptor => {
        if (++allocationCount === failAllocation) throw new Error('injected allocation failure');
        const resource = {
            ...descriptor,
            destroyed: false,
            createView() { return { texture: this }; },
            destroy() { this.destroyed = true; }
        };
        resources.push(resource);
        return resource;
    };
    const device = {
        limits: {
            maxStorageBufferBindingSize: 2 ** 28, maxStorageBuffersPerShaderStage: 9,
            maxBufferSize: 2 ** 29, maxComputeWorkgroupsPerDimension: 65535,
            maxUniformBufferBindingSize: 65536, maxTextureDimension2D: 16384,
            maxTextureArrayLayers: 256
        },
        createBuffer: allocate,
        createTexture: allocate,
        createBindGroupLayout: descriptor => descriptor,
        createPipelineLayout: descriptor => descriptor,
        createShaderModule: descriptor => descriptor,
        createComputePipeline(descriptor) {
            if (failStage === 'pipeline') throw new Error('injected pipeline failure');
            return { getBindGroupLayout: index => descriptor.layout.bindGroupLayouts[index] };
        },
        createRenderPipeline: descriptor => descriptor,
        createBindGroup: descriptor => descriptor,
        queue: {
            writeBuffer() {
                if (failStage === 'upload') throw new Error('injected upload failure');
            },
            writeTexture() {}
        }
    };
    const simulation = new GpuCircleBodySimulation({
        getState: () => ({ status: 'ready' }), getDevice: () => device,
        getCanvasFormat: () => 'bgra8unorm', getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null, clearCanvas: () => false,
        markCanvasDrawn: () => false, markCanvasCleared: () => false
    }, { capacity: 4, worldSize: { x: 4, y: 4 } });
    return { simulation, resources };
}

test('GPU setup은 모든 buffer/texture 할당 위치의 실패에서 선행 자원을 회수한다', () => {
    const restore = installGpuConstants();
    try {
        const baseline = createFixture();
        assert.equal(baseline.simulation.init(), true);
        const count = baseline.resources.length;
        assert.ok(count > 80, 'body와 모든 readback ring의 할당을 포함해야 합니다.');
        baseline.simulation.destroy();
        assert.ok(baseline.resources.every(resource => resource.destroyed));
        for (let failAt = 1; failAt <= count; failAt++) {
            const { simulation, resources } = createFixture(failAt);
            assert.equal(simulation.init(), false, `allocation ${failAt}`);
            assert.equal(simulation.getStatus().failure.message, 'injected allocation failure');
            const leaked = resources.filter(resource => !resource.destroyed).map(resource => resource.label);
            assert.deepEqual(leaked, [], `allocation ${failAt}`);
            simulation.destroy();
        }
    } finally {
        restore();
    }
});

test('pipeline 생성과 초기 upload 실패도 할당된 GPU 자원을 남기지 않는다', () => {
    const restore = installGpuConstants();
    try {
        for (const stage of ['pipeline', 'upload']) {
            const { simulation, resources } = createFixture(Infinity, stage);
            assert.equal(simulation.init(), false);
            assert.ok(resources.length > 80);
            assert.ok(resources.every(resource => resource.destroyed), stage);
            simulation.destroy();
        }
    } finally {
        restore();
    }
});
