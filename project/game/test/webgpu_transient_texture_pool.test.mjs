import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const POOL_PATH = fileURLToPath(new URL(
    '../script/module/display/webgpu/webgpu_transient_texture_pool.js',
    import.meta.url
));
const poolSource = await readFile(POOL_PATH, 'utf8');

async function loadPoolModule() {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(poolSource, {
        context,
        identifier: POOL_PATH
    });
    await module.link(() => {
        throw new Error('WebGpuTransientTexturePool에는 import가 없어야 합니다.');
    });
    await module.evaluate();
    return module.namespace;
}

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function createDevice(id) {
    const records = {
        id,
        textureDescriptors: [],
        textures: []
    };
    const device = {
        id,
        createTexture(descriptor) {
            const textureRecord = {
                id: `${id}:texture:${records.textures.length}`,
                viewDescriptors: [],
                destroyCount: 0
            };
            const texture = {
                id: textureRecord.id,
                createView(viewDescriptor) {
                    textureRecord.viewDescriptors.push(cloneRecord(viewDescriptor));
                    return Object.freeze({
                        id: `${textureRecord.id}:view:${textureRecord.viewDescriptors.length - 1}`
                    });
                },
                destroy() {
                    textureRecord.destroyCount += 1;
                }
            };
            records.textureDescriptors.push(cloneRecord(descriptor));
            records.textures.push(textureRecord);
            return texture;
        }
    };
    return { device, records };
}

function createDescriptor(overrides = {}) {
    return {
        width: 64,
        height: 36,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format: 'rgba8unorm',
        usage: 3,
        viewDimension: '2d',
        ...overrides
    };
}

test('pool은 texture/view 생성·폐기만 호출하고 command 제출이나 canvas 소유권을 갖지 않는다', async () => {
    await loadPoolModule();
    assert.match(poolSource, /device\.createTexture\(/);
    assert.match(poolSource, /texture\.createView\(/);
    assert.match(poolSource, /texture\.destroy\(/);
    for (const forbiddenCall of [
        'queue.submit',
        'getCurrentTexture',
        'acquireFrameTarget',
        'markCanvasDrawn',
        'markCanvasCleared'
    ]) {
        assert.equal(poolSource.includes(forbiddenCall), false, `${forbiddenCall} 호출 금지`);
    }
});

test('exact descriptor의 모든 필드가 같을 때만 같은 generation texture와 view를 재사용한다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('device-a');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 16, maxIdleFrames: 8 });

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 10 });
    const firstLease = pool.acquire(createDescriptor());
    assert.equal(Object.isFrozen(firstLease), true);
    assert.equal(Object.isFrozen(firstLease.descriptor), true);
    assert.strictEqual(firstLease.device, harness.device);
    assert.equal(firstLease.deviceGeneration, 1);
    assert.equal(firstLease.frameId, 10);
    assert.equal(pool.getDiagnostics().allocationCount, 1);
    assert.equal(pool.getDiagnostics().reuseCount, 0);
    assert.equal(pool.release(firstLease), true);
    pool.endFrame();

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 11 });
    const reusedLease = pool.acquire(createDescriptor());
    assert.strictEqual(reusedLease.texture, firstLease.texture);
    assert.strictEqual(reusedLease.view, firstLease.view);
    assert.equal(pool.getDiagnostics().allocationCount, 0);
    assert.equal(pool.getDiagnostics().reuseCount, 1);
    assert.equal(pool.release(reusedLease), true);
    pool.endFrame();

    const descriptorVariants = [
        { width: 65 },
        { height: 37 },
        { depthOrArrayLayers: 2 },
        { mipLevelCount: 2 },
        { sampleCount: 4 },
        { dimension: '3d' },
        { format: 'rgba16float' },
        { usage: 7 },
        { viewDimension: '2d-array' }
    ];
    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 12 });
    const variantTextures = [];
    for (const overrides of descriptorVariants) {
        const lease = pool.acquire(createDescriptor(overrides));
        variantTextures.push(lease.texture);
        assert.notStrictEqual(lease.texture, firstLease.texture);
        assert.equal(pool.release(lease), true);
    }
    const exactDiagnostics = pool.endFrame();
    assert.equal(exactDiagnostics.allocationCount, descriptorVariants.length);
    assert.equal(exactDiagnostics.reuseCount, 0);
    assert.equal(new Set(variantTextures).size, descriptorVariants.length);
    assert.equal(harness.records.textures.length, 1 + descriptorVariants.length);

    assert.deepEqual(harness.records.textureDescriptors[0], {
        size: { width: 64, height: 36, depthOrArrayLayers: 1 },
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format: 'rgba8unorm',
        usage: 3
    });
    assert.deepEqual(harness.records.textures[0].viewDescriptors, [{ dimension: '2d' }]);
    assert.equal('viewDimension' in harness.records.textureDescriptors[0], false);
    pool.destroy();
});

test('endFrame은 누수 lease를 강제 회수하고 stale, double, foreign release를 fail-closed 처리한다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('device-release');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 4, maxIdleFrames: 4 });

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 1 });
    const leakedLease = pool.acquire(createDescriptor());
    const leakedFrame = pool.endFrame();
    assert.equal(leakedFrame.forcedReleaseCount, 1);
    assert.equal(leakedFrame.leasedTextureCount, 0);
    assert.equal(leakedFrame.idleTextureCount, 1);
    assert.equal(pool.release(leakedLease), false);

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 2 });
    const currentLease = pool.acquire(createDescriptor());
    assert.strictEqual(currentLease.texture, leakedLease.texture);
    assert.equal(pool.release(Object.freeze({ ...currentLease })), false);
    assert.equal(pool.release(currentLease), true);
    assert.equal(pool.release(currentLease), false);

    const foreignPool = new WebGpuTransientTexturePool({ maxTextures: 1, maxIdleFrames: 1 });
    foreignPool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 2 });
    const foreignLease = foreignPool.acquire(createDescriptor({ width: 8, height: 8 }));
    assert.equal(pool.release(foreignLease), false);
    assert.equal(foreignPool.release(foreignLease), true);
    foreignPool.endFrame();
    foreignPool.destroy();

    const diagnostics = pool.endFrame();
    assert.equal(diagnostics.forcedReleaseCount, 0);
    assert.equal(diagnostics.invalidReleaseCount, 3);
    assert.equal(diagnostics.textureCount, 1);
    pool.destroy();
});

test('generation 또는 device identity drift는 이전 texture를 모두 폐기하고 재할당한다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const firstDevice = createDevice('device-generation-a');
    const secondDevice = createDevice('device-generation-b');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 4, maxIdleFrames: 4 });

    pool.beginFrame({ device: firstDevice.device, deviceGeneration: 1, frameId: 1 });
    const generationOneLease = pool.acquire(createDescriptor());
    pool.release(generationOneLease);
    pool.endFrame();

    const generationTwoStart = pool.beginFrame({
        device: firstDevice.device,
        deviceGeneration: 2,
        frameId: 2
    });
    assert.equal(generationTwoStart.destroyCount, 1);
    assert.equal(generationTwoStart.textureCount, 0);
    assert.equal(firstDevice.records.textures[0].destroyCount, 1);
    const generationTwoLease = pool.acquire(createDescriptor());
    assert.notStrictEqual(generationTwoLease.texture, generationOneLease.texture);
    pool.release(generationTwoLease);
    pool.endFrame();

    const secondDeviceStart = pool.beginFrame({
        device: secondDevice.device,
        deviceGeneration: 2,
        frameId: 3
    });
    assert.equal(secondDeviceStart.destroyCount, 1);
    assert.equal(firstDevice.records.textures[1].destroyCount, 1);
    const secondDeviceLease = pool.acquire(createDescriptor());
    assert.notStrictEqual(secondDeviceLease.texture, generationTwoLease.texture);
    pool.release(secondDeviceLease);
    pool.endFrame();

    assert.equal(pool.destroy(), true);
    assert.equal(secondDevice.records.textures[0].destroyCount, 1);
    assert.equal(pool.destroy(), false);
    assert.equal(secondDevice.records.textures[0].destroyCount, 1);
});

test('maxTextures는 LRU idle texture를 먼저 trim하고 leased capacity 초과는 거부한다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('device-capacity');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 2, maxIdleFrames: 1 });

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 1 });
    const first = pool.acquire(createDescriptor({ width: 16 }));
    const second = pool.acquire(createDescriptor({ width: 32 }));
    pool.release(first);
    pool.release(second);
    pool.endFrame();

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 2 });
    const third = pool.acquire(createDescriptor({ width: 48 }));
    assert.equal(harness.records.textures[0].destroyCount, 1);
    assert.equal(pool.getDiagnostics().destroyCount, 1);
    assert.equal(pool.getDiagnostics().textureCount, 2);
    pool.release(third);
    pool.endFrame();

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 3 });
    const firstIdleTrim = pool.endFrame();
    assert.equal(firstIdleTrim.destroyCount, 1);
    assert.equal(firstIdleTrim.textureCount, 1);
    assert.equal(harness.records.textures[1].destroyCount, 1);

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 4 });
    const secondIdleTrim = pool.endFrame();
    assert.equal(secondIdleTrim.destroyCount, 1);
    assert.equal(secondIdleTrim.textureCount, 0);
    assert.equal(harness.records.textures[2].destroyCount, 1);
    pool.destroy();

    const saturated = new WebGpuTransientTexturePool({ maxTextures: 1, maxIdleFrames: 1 });
    saturated.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 5 });
    saturated.acquire(createDescriptor({ width: 80 }));
    assert.throws(
        () => saturated.acquire(createDescriptor({ width: 96 })),
        /capacity를 초과/
    );
    assert.equal(saturated.endFrame().forcedReleaseCount, 1);
    saturated.destroy();
});

test('opt-in frame overflow는 현재 frame idle을 exact 재사용하되 endFrame 전에는 폐기하지 않는다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('device-frame-overflow');
    const pool = new WebGpuTransientTexturePool({
        maxTextures: 2,
        maxIdleFrames: 2,
        allowFrameOverflow: true
    });

    pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 1 });
    const first = pool.acquire(createDescriptor({ width: 16 }));
    assert.equal(pool.release(first), true);
    const second = pool.acquire(createDescriptor({ width: 32 }));
    assert.equal(pool.release(second), true);

    const reused = pool.acquire(createDescriptor({ width: 16 }));
    assert.strictEqual(reused.texture, first.texture);
    assert.equal(pool.release(reused), true);
    const overflow = pool.acquire(createDescriptor({ width: 48 }));
    assert.equal(pool.release(overflow), true);

    const beforeOutcome = pool.getDiagnostics();
    assert.equal(beforeOutcome.allowFrameOverflow, true);
    assert.equal(beforeOutcome.textureCount, 3);
    assert.equal(beforeOutcome.overflowAllocationCount, 1);
    assert.equal(beforeOutcome.reuseCount, 1);
    assert.equal(beforeOutcome.destroyCount, 0);
    assert.equal(harness.records.textures.reduce(
        (sum, texture) => sum + texture.destroyCount,
        0
    ), 0);

    const afterOutcome = pool.endFrame();
    assert.equal(afterOutcome.textureCount, 2);
    assert.equal(afterOutcome.destroyCount, 1);
    assert.equal(harness.records.textures.reduce(
        (sum, texture) => sum + texture.destroyCount,
        0
    ), 1);
    pool.destroy();
});

test('strict capacity도 현재 encoder가 참조한 idle texture를 제출 전에 폐기하지 않는다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('strict-frame');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 1 });
    try {
        pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 1 });
        const first = pool.acquire(createDescriptor());
        pool.release(first);
        assert.throws(() => pool.acquire(createDescriptor({ width: 128 })), /capacity를 초과/);
        assert.equal(harness.records.textures[0].destroyCount, 0);
        assert.equal(pool.getDiagnostics().textureCount, 1);
        const reused = pool.acquire(createDescriptor());
        assert.strictEqual(reused.texture, first.texture);
        pool.release(reused);
        pool.endFrame();

        pool.beginFrame({ device: harness.device, deviceGeneration: 1, frameId: 2 });
        const next = pool.acquire(createDescriptor({ width: 128 }));
        assert.notStrictEqual(next.texture, first.texture);
        assert.equal(harness.records.textures[0].destroyCount, 1);
        pool.release(next);
        pool.endFrame();
    } finally {
        pool.destroy();
    }
});

test('destroy는 active texture를 정확히 한 번 폐기하고 stale lease와 이후 사용을 막는다', async () => {
    const { WebGpuTransientTexturePool } = await loadPoolModule();
    const harness = createDevice('device-destroy');
    const pool = new WebGpuTransientTexturePool({ maxTextures: 2, maxIdleFrames: 1 });

    pool.beginFrame({ device: harness.device, deviceGeneration: 7, frameId: 9 });
    const first = pool.acquire(createDescriptor({ width: 20 }));
    const second = pool.acquire(createDescriptor({ width: 24 }));
    assert.equal(pool.destroy(), true);
    assert.equal(pool.getDiagnostics().destroyed, true);
    assert.equal(pool.getDiagnostics().textureCount, 0);
    assert.equal(pool.getDiagnostics().destroyCount, 2);
    assert.equal(harness.records.textures[0].destroyCount, 1);
    assert.equal(harness.records.textures[1].destroyCount, 1);
    assert.equal(pool.release(first), false);
    assert.equal(pool.release(second), false);
    assert.equal(pool.destroy(), false);
    assert.equal(harness.records.textures[0].destroyCount, 1);
    assert.equal(harness.records.textures[1].destroyCount, 1);
    assert.throws(
        () => pool.beginFrame({ device: harness.device, deviceGeneration: 8, frameId: 10 }),
        /destroy된/
    );
    assert.throws(() => pool.acquire(createDescriptor()), /destroy된/);
});
