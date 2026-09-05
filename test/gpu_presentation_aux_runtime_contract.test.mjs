import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    GPU_CROWD_DENSITY_ABI_VERSION,
    GPU_CROWD_DENSITY_WGSL,
    GpuCrowdDensityRuntime,
    buildCrowdDensityMipChain,
    sampleCrowdDensity
} from '../project/game/script/module/ingame/physics/gpu/gpu_crowd_density_runtime.js';
import {
    GPU_TRANSIENT_VFX_COMPUTE_WGSL,
    GPU_TRANSIENT_VFX_RENDER_WGSL,
    GpuTransientVfxRuntime
} from '../project/game/script/module/ingame/physics/gpu/gpu_transient_vfx_runtime.js';

function installFakeWebGpuGlobals() {
    const previous = {
        GPUBufferUsage: globalThis.GPUBufferUsage,
        GPUShaderStage: globalThis.GPUShaderStage,
        GPUMapMode: globalThis.GPUMapMode
    };
    globalThis.GPUBufferUsage = Object.freeze({
        STORAGE: 1 << 0,
        COPY_SRC: 1 << 1,
        COPY_DST: 1 << 2,
        UNIFORM: 1 << 3,
        MAP_READ: 1 << 4,
        INDIRECT: 1 << 5
    });
    globalThis.GPUShaderStage = Object.freeze({
        COMPUTE: 1 << 0,
        VERTEX: 1 << 1
    });
    globalThis.GPUMapMode = Object.freeze({ READ: 1 });
    return () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    };
}

class FakeBuffer {
    constructor(descriptor) {
        this.label = descriptor.label;
        this.size = descriptor.size;
        this.data = new ArrayBuffer(descriptor.size);
        this.destroyCount = 0;
        this.mapped = false;
    }

    mapAsync() {
        this.mapped = true;
        return Promise.resolve();
    }

    getMappedRange() {
        return this.data;
    }

    unmap() {
        this.mapped = false;
    }

    destroy() {
        this.destroyCount++;
    }
}

class FakeDevice {
    constructor() {
        this.limits = {
            maxBufferSize: 1 << 24,
            maxStorageBufferBindingSize: 1 << 24,
            maxStorageBuffersPerShaderStage: 9
        };
        this.buffers = [];
        this.shaderModules = [];
        this.computePipelines = [];
        this.renderPipelines = [];
        this.computePasses = [];
        this.queue = {
            writeBuffer: (target, offset, source) => {
                const bytes = ArrayBuffer.isView(source)
                    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
                    : new Uint8Array(source);
                new Uint8Array(target.data, offset, bytes.byteLength).set(bytes);
            },
            submit() {}
        };
    }

    createBuffer(descriptor) {
        const buffer = new FakeBuffer(descriptor);
        this.buffers.push(buffer);
        return buffer;
    }

    createBindGroupLayout(descriptor) {
        return descriptor;
    }

    createPipelineLayout(descriptor) {
        return descriptor;
    }

    createShaderModule(descriptor) {
        this.shaderModules.push(descriptor);
        return descriptor;
    }

    createComputePipeline(descriptor) {
        const pipeline = { ...descriptor, entryPoint: descriptor.compute.entryPoint };
        this.computePipelines.push(pipeline);
        return pipeline;
    }

    createRenderPipeline(descriptor) {
        this.renderPipelines.push(descriptor);
        return descriptor;
    }

    createBindGroup(descriptor) {
        return descriptor;
    }

    createCommandEncoder() {
        const device = this;
        return {
            beginComputePass(descriptor) {
                const operations = [];
                let pipeline = null;
                const bindGroups = new Map();
                device.computePasses.push({ descriptor, operations });
                return {
                    setBindGroup(index, bindGroup) {
                        bindGroups.set(index, bindGroup);
                        operations.push(['bind', index, bindGroup.label]);
                    },
                    setPipeline(value) {
                        pipeline = value;
                        operations.push(['pipeline', value.entryPoint]);
                    },
                    dispatchWorkgroups(count) {
                        operations.push(['direct', pipeline.entryPoint, count]);
                    },
                    dispatchWorkgroupsIndirect(buffer, offset) {
                        // Explicit layouts use every bound resource, including
                        // bindings the current WGSL entry point never reads.
                        for (const [index, layout] of
                            pipeline.layout.bindGroupLayouts.entries()) {
                            const group = bindGroups.get(index);
                            for (const entry of layout.entries) {
                                const resource = group.entries.find(
                                    (bound) => bound.binding === entry.binding
                                )?.resource;
                                assert.ok(
                                    entry.buffer?.type !== 'storage'
                                        || resource?.buffer !== buffer,
                                    `${pipeline.entryPoint}: indirect buffer is also bound as writable storage`
                                );
                            }
                        }
                        operations.push(['indirect', pipeline.entryPoint, buffer.label, offset]);
                    },
                    end() {
                        operations.push(['end']);
                    }
                };
            },
            copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
                new Uint8Array(target.data, targetOffset, size).set(
                    new Uint8Array(source.data, sourceOffset, size)
                );
            },
            finish() {
                return {};
            }
        };
    }
}

function createMainBuffer(device, label, size = 64) {
    return device.createBuffer({ label, size, usage: 0 });
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

test('crowd density는 16x16 lossy ring과 immutable mip snapshot 계약을 지킨다', async () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const runtime = new GpuCrowdDensityRuntime({
        worldSize: { x: 160, y: 160 },
        sampleIntervalTicks: 8,
        readbackSlotCount: 1
    });
    try {
        runtime.initialize(device, {
            counts: createMainBuffer(device, 'counts'),
            physics: createMainBuffer(device, 'physics'),
            simulation: createMainBuffer(device, 'simulation')
        }, {
            deviceGeneration: 4,
            authoritativeEpoch: 7
        });
        const slot = runtime.claimSample({
            sourceTick: 101,
            submittedTick: 1,
            deviceGeneration: 4,
            authoritativeEpoch: 7
        });
        assert.ok(slot);
        assert.equal(runtime.claimSample({
            sourceTick: 102,
            submittedTick: 2,
            deviceGeneration: 4,
            authoritativeEpoch: 7
        }), null, 'interval 내부 샘플은 생성하지 않습니다.');
        assert.equal(runtime.claimSample({
            sourceTick: 109,
            submittedTick: 9,
            deviceGeneration: 4,
            authoritativeEpoch: 7
        }), null, 'ring 포화는 물리를 막지 않고 샘플만 버립니다.');
        assert.equal(runtime.getStatus().droppedSampleCount, 1);

        const words = new Uint32Array(runtime.buffers.output.data);
        words[0] = GPU_CROWD_DENSITY_ABI_VERSION;
        words[1] = 101;
        words[2] = 3;
        words[3] = 1;
        words[4] = 2;
        words[4 + 17] = 1;
        const encoder = device.createCommandEncoder();
        runtime.encodeSample(encoder, slot, createMainBuffer(device, 'body-dispatch'));
        runtime.beginReadback(slot);
        await flushMicrotasks();

        const snapshot = runtime.getLatestSnapshot();
        assert.equal(snapshot.valid, true);
        assert.equal(snapshot.totalCount, 3);
        assert.equal(snapshot.outOfBoundsCount, 1);
        assert.equal(snapshot.mipLevels.at(-1).cells[0], 3);
        assert.equal(sampleCrowdDensity(snapshot, { x: 5, y: 5 }), 2);
        assert.equal(Object.isFrozen(snapshot.cells), true);
        assert.deepEqual(
            device.computePasses[0].operations.filter((entry) => entry[0] !== 'bind'),
            [
                ['pipeline', 'clear_density'],
                ['direct', 'clear_density', 2],
                ['pipeline', 'accumulate_density'],
                ['indirect', 'accumulate_density', 'body-dispatch', 0],
                ['end']
            ]
        );
    } finally {
        runtime.retire();
        restore();
    }
});

test('density mip은 odd grid에서도 총량을 보존하고 적 alive/layer/team만 shader에서 읽는다', () => {
    const levels = buildCrowdDensityMipChain([1, 2, 3, 4, 5, 6], 3, 2);
    assert.deepEqual(levels.map(({ columns, rows }) => [columns, rows]), [
        [3, 2], [2, 1], [1, 1]
    ]);
    assert.equal(levels.at(-1).cells[0], 21);
    assert.match(GPU_CROWD_DENSITY_WGSL, /atomicLoad\(&simulations\.values\[body_id\]\.flags\)/);
    assert.match(GPU_CROWD_DENSITY_WGSL, /body_layer != ENEMY_LAYER/);
    assert.match(GPU_CROWD_DENSITY_WGSL, /team_id != HOSTILE_TEAM/);
});

test('transient VFX는 death buffer→stable ring→단일 indirect draw 경계를 보존한다', () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const runtime = new GpuTransientVfxRuntime({ capacity: 32 });
    try {
        const resources = {
            contactState: createMainBuffer(device, 'contact-state'),
            deathEvents: createMainBuffer(device, 'death-events'),
            physics: createMainBuffer(device, 'physics'),
            simulation: createMainBuffer(device, 'simulation'),
            renderParams: createMainBuffer(device, 'render-params'),
            bodyCapacity: 128,
            deathEventCapacity: 64
        };
        runtime.initialize(device, 'bgra8unorm', resources);
        const encoder = device.createCommandEncoder();
        assert.equal(runtime.encodeFixedStep(encoder, 1 / 60, 55), true);
        assert.equal(
            device.computePasses.length,
            2,
            'indirect args의 STORAGE_WRITE와 INDIRECT 소비는 pass usage scope를 분리합니다.'
        );
        assert.deepEqual(
            device.computePasses[0].operations.filter((entry) => entry[0] !== 'bind'),
            [
                ['pipeline', 'update_vfx_indirect_args'],
                ['direct', 'update_vfx_indirect_args', 1],
                ['end']
            ]
        );
        assert.deepEqual(
            device.computePasses[1].operations.filter((entry) => entry[0] !== 'bind'),
            [
                [
                    'pipeline',
                    'decay_vfx'
                ],
                [
                    'indirect',
                    'decay_vfx',
                    'cirvivor-gpu-transient-vfx-dispatch-indirect',
                    12
                ],
                ['pipeline', 'spawn_death_vfx'],
                [
                    'indirect',
                    'spawn_death_vfx',
                    'cirvivor-gpu-transient-vfx-dispatch-indirect',
                    0
                ],
                ['end']
            ]
        );
        const renderOperations = [];
        runtime.encodeRender({
            setPipeline: (pipeline) => renderOperations.push(['pipeline', pipeline.label]),
            setBindGroup: (index, group) => renderOperations.push([
                'bind', index, group.label
            ]),
            drawIndirect: (buffer, offset) => renderOperations.push([
                'draw-indirect', buffer.label, offset
            ])
        });
        assert.deepEqual(renderOperations.at(-1), [
            'draw-indirect',
            'cirvivor-gpu-transient-vfx-draw-indirect',
            0
        ]);
        assert.equal(runtime.getStatus().allocationPolicy, 'stable-ring-overwrite');
        assert.equal(runtime.getStatus().cpuReadback, false);
        assert.match(GPU_TRANSIENT_VFX_COMPUTE_WGSL, /contact_state\.death_count/);
        assert.match(GPU_TRANSIENT_VFX_COMPUTE_WGSL, /atomicAdd\(&state\.spawn_cursor/);
        assert.match(GPU_TRANSIENT_VFX_RENDER_WGSL, /fragment_main/);
    } finally {
        runtime.retire();
        restore();
    }
});

test('auxiliary runtime은 authoritative submit과 pass usage scope를 침범하지 않는다', () => {
    const simulationSource = readFileSync(new URL(
        '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
        import.meta.url
    ), 'utf8');
    const backendSource = readFileSync(new URL(
        '../project/game/script/module/ingame/object/enemy/enemy_simulation_backend.js',
        import.meta.url
    ), 'utf8');
    assert.match(
        simulationSource,
        /options\.crowdDensityEnabled === true[\s\S]*new GpuCrowdDensityRuntime/
    );
    assert.match(
        simulationSource,
        /options\.transientVfxEnabled === true[\s\S]*new GpuTransientVfxRuntime/
    );
    assert.match(backendSource, /options\.crowdDensityEnabled !== false/);
    assert.match(backendSource, /options\.transientVfxEnabled !== false/);
    const fixedEncoderIndex = simulationSource.indexOf(
        "label: 'cirvivor-gpu-circle-fixed-step'"
    );
    const fixedSubmitIndex = simulationSource.indexOf(
        'device.queue.submit([encoder.finish()]);',
        fixedEncoderIndex
    );
    const auxiliaryEncoderIndex = simulationSource.indexOf(
        "label: 'cirvivor-gpu-circle-presentation-auxiliary'",
        fixedSubmitIndex
    );
    assert.ok(
        fixedEncoderIndex >= 0
            && fixedSubmitIndex > fixedEncoderIndex
            && auxiliaryEncoderIndex > fixedSubmitIndex,
        'presentation auxiliary command buffer는 authoritative fixed submit 뒤에 생성해야 합니다.'
    );
    assert.ok(
        simulationSource.indexOf(
            'this.transientVfxRuntime.encodeFixedStep(',
            auxiliaryEncoderIndex
        ) > auxiliaryEncoderIndex,
        'VFX compute는 auxiliary encoder에만 기록해야 합니다.'
    );
    assert.match(simulationSource, /pushErrorScope\('validation'\)/);
    assert.ok(
        fixedSubmitIndex
            < simulationSource.indexOf(
                'this.crowdDensityRuntime.beginReadback(crowdDensitySlot);'
            ),
        'MAP_READ는 fixed command submit 이후에만 시작해야 합니다.'
    );
    assert.match(
        simulationSource,
        /this\.crowdDensityRuntime\?\.retire\('simulation-resource-retired'\)/
    );
    assert.match(
        simulationSource,
        /GPU flow-field 생성에는 GPUTextureUsage\.STORAGE_BINDING이 필요합니다/
    );
});
