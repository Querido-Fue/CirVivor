import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_ROUTE_FLOW_FIELD_GENERATOR_STORAGE_BUFFER_MAXIMUM,
    GPU_ROUTE_FLOW_FIELD_GENERATOR_VERSION,
    GPU_ROUTE_FLOW_FIELD_GENERATOR_WGSL,
    GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND,
    createGpuRouteFlowFieldRebuildJob,
    generateGpuRouteFlowFieldTextures
} = await loadGameModule(
    'ingame/physics/gpu/gpu_route_flow_field_generator.js'
);
const simulationSource = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const nwSupportSource = await readFile(new URL(
    './support/run_nw_webgpu_capability.mjs',
    import.meta.url
), 'utf8');

test('GPU route generator는 bounds-safe seed-relax-finalize와 hard-wall 계약을 가진다', () => {
    const wgsl = GPU_ROUTE_FLOW_FIELD_GENERATOR_WGSL;

    assert.equal(GPU_ROUTE_FLOW_FIELD_GENERATOR_VERSION, 2);
    assert.equal(GPU_ROUTE_FLOW_FIELD_GENERATOR_STORAGE_BUFFER_MAXIMUM, 3);
    for (const entryPoint of [
        'seed_flow_cost',
        'relax_flow_cost',
        'finalize_flow_field'
    ]) {
        assert.match(wgsl, new RegExp(`fn\\s+${entryPoint}\\b`));
    }
    assert.match(
        wgsl,
        /id\.x >= params\.cols \|\| id\.y >= params\.row_count[\s\S]*?output_row >= params\.rows/
    );
    assert.match(wgsl, /row_offset: u32,[\s\S]*?row_count: u32,/);
    assert.equal(GPU_ROUTE_FLOW_FIELD_MINIMUM_REBUILD_RATE_PER_SECOND, 0.30);
    assert.match(
        wgsl,
        /blocked_layers\[index\] != 0u[\s\S]*?cost_write\[index\] = COST_INFINITY;/
    );
    assert.match(
        wgsl,
        /fn diagonal_is_open\([\s\S]*?cell \+ vec2i\(offset\.x, 0\)[\s\S]*?cell \+ vec2i\(0, offset\.y\)/
    );
    assert.match(wgsl, /const CARDINAL_COST: u32 = 1000u;/);
    assert.match(wgsl, /const DIAGONAL_COST: u32 = 1414u;/);
    assert.match(wgsl, /neighbor_cost > COST_INFINITY - step_cost/);
    assert.match(
        wgsl,
        /let source_layer = stage_layer_indices\[id\.z\];[\s\S]*?textureStore\(flow_output[\s\S]*?textureStore\(integration_output/
    );
    assert.doesNotMatch(wgsl, /512u|512\.0/);
});

test('GPU route 생성 texture와 NW 격리 manifest는 storage-write 경계를 보존한다', () => {
    assert.match(
        simulationSource,
        /format: 'rgba32float',[\s\S]*?usage: textureUsage\.TEXTURE_BINDING[\s\S]*?textureUsage\.STORAGE_BINDING/
    );
    assert.match(
        simulationSource,
        /format: 'r32float',[\s\S]*?usage: textureUsage\.TEXTURE_BINDING[\s\S]*?textureUsage\.STORAGE_BINDING/
    );
    assert.match(
        simulationSource,
        /generateGpuRouteFlowFieldTextures\([\s\S]*?this\.flowTexture,[\s\S]*?this\.flowIntegrationTexture/
    );
    assert.match(
        nwSupportSource,
        /module\/ingame\/physics\/gpu\/gpu_route_flow_field_generator\.js/
    );
});

test('GPU route generator는 pipeline을 device별 재사용하고 제출 완료 뒤 임시 buffer를 회수한다', async () => {
    const previousBufferUsage = globalThis.GPUBufferUsage;
    const previousTextureUsage = globalThis.GPUTextureUsage;
    globalThis.GPUBufferUsage = Object.freeze({
        COPY_DST: 1,
        STORAGE: 2,
        UNIFORM: 4
    });
    globalThis.GPUTextureUsage = Object.freeze({ STORAGE_BINDING: 8 });
    const createdBuffers = [];
    const counters = {
        shaderModules: 0,
        pipelines: 0,
        submissions: 0
    };
    const pass = {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {}
    };
    const device = {
        limits: {
            maxBufferSize: 1 << 20,
            maxStorageBufferBindingSize: 1 << 20,
            maxTextureDimension2D: 1024,
            maxTextureArrayLayers: 256,
            maxComputeWorkgroupsPerDimension: 65535
        },
        queue: {
            writeBuffer() {},
            submit() { counters.submissions++; },
            onSubmittedWorkDone() { return Promise.resolve(); }
        },
        createBuffer(descriptor) {
            const buffer = {
                descriptor,
                destroyCount: 0,
                destroy() { this.destroyCount++; }
            };
            createdBuffers.push(buffer);
            return buffer;
        },
        createShaderModule() {
            counters.shaderModules++;
            return {};
        },
        createComputePipeline(descriptor) {
            counters.pipelines++;
            return {
                descriptor,
                getBindGroupLayout() { return {}; }
            };
        },
        createBindGroup(descriptor) { return descriptor; },
        createCommandEncoder() {
            return {
                beginComputePass() { return pass; },
                finish() { return {}; }
            };
        }
    };
    const atlas = {
        cols: 2,
        rows: 2,
        fieldCount: 1,
        gpuGeneration: {
            version: 2,
            sourceLayerCount: 1,
            blockedLayers: new Uint32Array([0, 0, 0, 0]),
            goalCellIndices: new Uint32Array([3]),
            stageLayerIndices: new Uint32Array([0]),
            relaxationPassCount: 4
        }
    };
    const texture = { createView: (descriptor) => descriptor };

    try {
        const first = generateGpuRouteFlowFieldTextures(
            device,
            atlas,
            texture,
            texture
        );
        const second = generateGpuRouteFlowFieldTextures(
            device,
            atlas,
            texture,
            texture
        );
        await Promise.all([
            first.retirementPromise,
            second.retirementPromise
        ]);

        assert.equal(counters.shaderModules, 1);
        assert.equal(counters.pipelines, 3);
        assert.equal(counters.submissions, 2);
        assert.equal(createdBuffers.length, 12);
        assert.ok(createdBuffers.every((buffer) => buffer.destroyCount === 1));
        first.destroy();
        second.destroy();
        assert.ok(createdBuffers.every((buffer) => buffer.destroyCount === 1));
    } finally {
        if (previousBufferUsage === undefined) {
            delete globalThis.GPUBufferUsage;
        } else {
            globalThis.GPUBufferUsage = previousBufferUsage;
        }
        if (previousTextureUsage === undefined) {
            delete globalThis.GPUTextureUsage;
        } else {
            globalThis.GPUTextureUsage = previousTextureUsage;
        }
    }
});

test('GPU route generator는 잘못된 recipe와 device limit를 allocation 전에 거절한다', () => {
    const previousBufferUsage = globalThis.GPUBufferUsage;
    const previousTextureUsage = globalThis.GPUTextureUsage;
    globalThis.GPUBufferUsage = Object.freeze({
        COPY_DST: 1,
        STORAGE: 2,
        UNIFORM: 4
    });
    globalThis.GPUTextureUsage = Object.freeze({ STORAGE_BINDING: 8 });
    let allocationCount = 0;
    const device = {
        limits: {
            maxBufferSize: 8,
            maxStorageBufferBindingSize: 8,
            maxTextureDimension2D: 1024,
            maxTextureArrayLayers: 256,
            maxComputeWorkgroupsPerDimension: 65535
        },
        queue: { writeBuffer() {}, submit() {} },
        createBuffer() { allocationCount++; return {}; },
        createShaderModule() { return {}; },
        createComputePipeline() {
            return { getBindGroupLayout() { return {}; } };
        },
        createBindGroup() { return {}; },
        createCommandEncoder() { return {}; }
    };
    const texture = { createView() { return {}; } };
    const validRecipe = {
        version: 2,
        sourceLayerCount: 1,
        blockedLayers: new Uint32Array([0, 0, 0, 0]),
        goalCellIndices: new Uint32Array([3]),
        stageLayerIndices: new Uint32Array([0]),
        relaxationPassCount: 4
    };
    try {
        assert.throws(
            () => generateGpuRouteFlowFieldTextures(
                device,
                { cols: 2, rows: 2, fieldCount: 1, gpuGeneration: validRecipe },
                texture,
                texture
            ),
            /storage 한도/
        );
        assert.equal(allocationCount, 0);
        assert.throws(
            () => generateGpuRouteFlowFieldTextures(
                { ...device, limits: { ...device.limits, maxBufferSize: 1024,
                    maxStorageBufferBindingSize: 1024 } },
                {
                    cols: 2,
                    rows: 2,
                    fieldCount: 1,
                    gpuGeneration: {
                        ...validRecipe,
                        goalCellIndices: new Uint32Array([4])
                    }
                },
                texture,
                texture
            ),
            /goal은 범위 안/
        );
        assert.equal(allocationCount, 0);
    } finally {
        if (previousBufferUsage === undefined) {
            delete globalThis.GPUBufferUsage;
        } else {
            globalThis.GPUBufferUsage = previousBufferUsage;
        }
        if (previousTextureUsage === undefined) {
            delete globalThis.GPUTextureUsage;
        } else {
            globalThis.GPUTextureUsage = previousTextureUsage;
        }
    }
});

test('incremental rebuild는 CPU 포화 시 30%/초 credit을 보장하고 여유분만 가속한다', () => {
    const previousBufferUsage = globalThis.GPUBufferUsage;
    const previousTextureUsage = globalThis.GPUTextureUsage;
    globalThis.GPUBufferUsage = Object.freeze({
        COPY_DST: 1,
        STORAGE: 2,
        UNIFORM: 4
    });
    globalThis.GPUTextureUsage = Object.freeze({
        STORAGE_BINDING: 8,
        COPY_SRC: 16
    });
    const counters = { copies: 0, commits: 0 };
    const pass = {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {},
        end() {}
    };
    const texture = {
        createView(descriptor) { return descriptor; },
        destroy() {}
    };
    const device = {
        limits: {
            maxBufferSize: 1 << 20,
            maxStorageBufferBindingSize: 1 << 20,
            maxTextureDimension2D: 1024,
            maxTextureArrayLayers: 256,
            maxComputeWorkgroupsPerDimension: 65535
        },
        queue: {
            writeBuffer() {},
            submit() {},
            onSubmittedWorkDone() { return Promise.resolve(); }
        },
        createBuffer() { return { destroy() {} }; },
        createTexture() { return { ...texture }; },
        createShaderModule() { return {}; },
        createComputePipeline() {
            return { getBindGroupLayout() { return {}; } };
        },
        createBindGroup(descriptor) { return descriptor; },
        createCommandEncoder() {
            return {
                beginComputePass() { return pass; },
                copyTextureToTexture() { counters.copies++; },
                finish() { return {}; }
            };
        }
    };
    const atlas = {
        cols: 1,
        rows: 10,
        size: 10,
        fieldCount: 1,
        gpuGeneration: {
            version: 2,
            sourceLayerCount: 1,
            blockedLayers: new Uint32Array(10),
            goalCellIndices: new Uint32Array([9]),
            stageLayerIndices: new Uint32Array([0]),
            relaxationPassCount: 1
        }
    };
    try {
        const saturated = createGpuRouteFlowFieldRebuildJob(
            device,
            atlas,
            texture,
            texture,
            { availabilityVersion: 2 }
        );
        let saturatedStatus;
        for (let index = 0; index < 4; index++) {
            saturatedStatus = saturated.pump({
                elapsedSeconds: 0.25,
                previousFrameCpuSeconds: 1 / 60,
                targetFrameSeconds: 1 / 60
            });
        }
        assert.ok(saturatedStatus.progress >= 0.26);
        assert.ok(saturatedStatus.progress <= 0.34);
        assert.equal(saturatedStatus.complete, false);
        saturated.cancel();

        const oneSecondSaturated = createGpuRouteFlowFieldRebuildJob(
            device,
            atlas,
            texture,
            texture,
            { availabilityVersion: 3 }
        );
        const oneSecondStatus = oneSecondSaturated.pump({
            elapsedSeconds: 1,
            previousFrameCpuSeconds: 1 / 60,
            targetFrameSeconds: 1 / 60
        });
        assert.ok(oneSecondStatus.progress >= 0.30);
        assert.ok(oneSecondStatus.progress <= 0.34);
        assert.equal(oneSecondStatus.complete, false);
        oneSecondSaturated.cancel();

        const spare = createGpuRouteFlowFieldRebuildJob(
            device,
            atlas,
            texture,
            texture,
            {
                availabilityVersion: 4,
                onCommitted() { counters.commits++; }
            }
        );
        let spareStatus;
        for (let index = 0; index < 4; index++) {
            spareStatus = spare.pump({
                elapsedSeconds: 0.25,
                previousFrameCpuSeconds: 0,
                targetFrameSeconds: 1 / 60
            });
        }
        assert.equal(spareStatus.complete, true);
        assert.equal(counters.commits, 1);
        assert.equal(counters.copies, 2);
    } finally {
        if (previousBufferUsage === undefined) delete globalThis.GPUBufferUsage;
        else globalThis.GPUBufferUsage = previousBufferUsage;
        if (previousTextureUsage === undefined) delete globalThis.GPUTextureUsage;
        else globalThis.GPUTextureUsage = previousTextureUsage;
    }
});

function installFlowGpuGlobals(t) {
    const values = {
        GPUBufferUsage: { COPY_DST: 1, STORAGE: 2, UNIFORM: 4 },
        GPUTextureUsage: { STORAGE_BINDING: 8, COPY_SRC: 16 }
    };
    for (const [name, value] of Object.entries(values)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, name, previous);
            else delete globalThis[name];
        });
    }
}

function createFailureHarness(failureStage, failureIndex = 2) {
    const resources = [];
    const calls = new Map();
    const run = (stage) => {
        const count = (calls.get(stage) ?? 0) + 1;
        calls.set(stage, count);
        if (stage === failureStage && count === failureIndex) {
            throw new Error(`fixture:${stage}`);
        }
    };
    const allocate = (stage) => {
        run(stage);
        const resource = {
            destroyCount: 0,
            destroy() { this.destroyCount++; },
            createView() { run('createView'); return {}; }
        };
        resources.push(resource);
        return resource;
    };
    const device = {
        queue: {
            writeBuffer() { run('writeBuffer'); },
            submit() {},
            onSubmittedWorkDone() { run('queueDone'); return Promise.resolve(); }
        },
        createBuffer() { return allocate('createBuffer'); },
        createTexture() { return allocate('createTexture'); },
        createShaderModule() { return {}; },
        createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
        createBindGroup() { run('createBindGroup'); return {}; },
        createCommandEncoder() {
            return {
                beginComputePass() {
                    return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
                },
                copyTextureToTexture() {},
                finish() { return {}; }
            };
        }
    };
    const atlas = {
        cols: 2, rows: 2, size: 4, fieldCount: 1,
        gpuGeneration: {
            version: 2, sourceLayerCount: 1,
            blockedLayers: new Uint32Array(4),
            goalCellIndices: new Uint32Array([3]),
            stageLayerIndices: new Uint32Array([0]),
            relaxationPassCount: 1
        }
    };
    const texture = { createView() { return {}; }, destroy() { assert.fail('borrowed texture destroyed'); } };
    return { device, atlas, texture, resources, calls };
}

for (const mode of ['initial', 'rebuild']) {
    const failureStages = mode === 'initial' ? ['writeBuffer']
        : ['createBuffer', 'writeBuffer', 'createTexture', 'createView', 'createBindGroup'];
    for (const stage of failureStages) {
        test(`${mode} flow 생성 중 ${stage} 실패는 이미 할당한 GPU 자원을 모두 회수한다`, (t) => {
            installFlowGpuGlobals(t);
            const h = createFailureHarness(stage);
            const generate = mode === 'initial' ? generateGpuRouteFlowFieldTextures
                : createGpuRouteFlowFieldRebuildJob;
            assert.throws(() => generate(h.device, h.atlas, h.texture, h.texture,
                { availabilityVersion: 1 }), new RegExp(`fixture:${stage}`));
            assert.ok(h.resources.length > 0);
            assert.ok(h.resources.every((resource) => resource.destroyCount === 1),
                `${mode}/${stage}: ${h.resources.map((resource) => resource.destroyCount)}`);
        });
    }
}

test('flow publication callback 실패 뒤에도 제출된 임시 자원은 queue 완료 후 회수한다', async (t) => {
    installFlowGpuGlobals(t);
    const h = createFailureHarness(null);
    const job = createGpuRouteFlowFieldRebuildJob(h.device, h.atlas, h.texture, h.texture, {
        availabilityVersion: 1,
        onCommitted() { throw new Error('publication fixture'); }
    });
    assert.throws(() => job.pump({ elapsedSeconds: 10 }), /publication fixture/);
    assert.equal(job.getStatus().complete, true);
    assert.equal(h.calls.get('queueDone'), 1);
    assert.ok(h.resources.every((resource) => resource.destroyCount === 0));
    await Promise.resolve();
    assert.ok(h.resources.every((resource) => resource.destroyCount === 1));
});
