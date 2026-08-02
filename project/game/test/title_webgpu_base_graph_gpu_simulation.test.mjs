import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TitleWebGpuBaseGraph } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_base_graph.js'
);

test('GPU enemy simulation은 CPU adapter를 우회하고 render pass보다 먼저 결과를 제공한다', () => {
    const fixture = createFixture({ frameId: 41 });

    assert.equal(
        fixture.graph.encode(fixture.input),
        true,
        fixture.framePort.lastError?.stack ?? 'GPU simulation graph encode failed'
    );
    assert.equal(fixture.cpuAdapterCallCount(), 0);
    assert.equal(fixture.cpuPresentationCallCount(), 0);
    assert.deepEqual(fixture.trace, [
        'simulation:encode:41',
        'gradient:encode',
        'enemy:encode',
        'shield:encode'
    ]);
    assert.equal(fixture.enemyInputs.length, 1);
    assert.strictEqual(fixture.enemyInputs[0].packet, fixture.gpuPresentationPacket);
    assert.equal(fixture.shieldInputs.length, 1);
    assert.strictEqual(
        fixture.shieldInputs[0].gpuInteractionBuffer,
        fixture.shieldInteractionBuffer
    );
    assert.deepEqual(fixture.finishCalls, []);

    assert.equal(fixture.framePort.commit(), true);
    assert.deepEqual(fixture.finishCalls, [{ outcome: 'committed', frameId: 41 }]);
    assert.equal(fixture.framePort.commit(), false);
    assert.equal(fixture.framePort.abort(), false);
    assert.equal(fixture.finishCalls.length, 1);
});

test('composer abort는 GPU simulation finishFrame을 frame identity와 함께 정확히 한 번 호출한다', () => {
    const fixture = createFixture({ frameId: 52 });

    assert.equal(fixture.graph.encode(fixture.input), true);
    assert.deepEqual(fixture.finishCalls, []);
    assert.equal(fixture.framePort.abort(), true);
    assert.deepEqual(fixture.finishCalls, [{ outcome: 'aborted', frameId: 52 }]);
    assert.equal(fixture.framePort.abort(), false);
    assert.equal(fixture.framePort.commit(), false);
    assert.equal(fixture.finishCalls.length, 1);
});

test('유효하지 않은 GPU simulation output은 전체 graph를 fail-closed한다', () => {
    for (const invalidOutput of [null, undefined, 7]) {
        const fixture = createFixture({
            frameId: 63,
            simulationOutputFactory: () => invalidOutput
        });

        assert.equal(fixture.graph.encode(fixture.input), false);
        assert.match(
            fixture.framePort.lastError?.message ?? '',
            /title GPU simulation output/u
        );
        assert.deepEqual(fixture.trace, ['simulation:encode:63']);
        assert.equal(fixture.cpuAdapterCallCount(), 0);
        assert.equal(fixture.cpuPresentationCallCount(), 0);
        assert.equal(fixture.graph.getCheckpoint('title:overlay:0'), null);
        assert.deepEqual(fixture.finishCalls, [{ outcome: 'aborted', frameId: 63 }]);
        assert.equal(fixture.finishCalls.length, 1);
        assert.equal(fixture.graph.getDiagnostics().abortCount, 1);
    }
});

test('불완전한 packet 또는 interaction buffer도 consumer 오류 시 composer abort로 폐기한다', () => {
    const cases = [
        (fixture) => ({
            presentationPacket: null,
            shieldInteractionBuffer: fixture.shieldInteractionBuffer
        }),
        (fixture) => ({
            presentationPacket: fixture.gpuPresentationPacket,
            shieldInteractionBuffer: 1
        })
    ];

    for (const buildInvalidOutput of cases) {
        let fixture;
        fixture = createFixture({
            frameId: 74,
            simulationOutputFactory: () => buildInvalidOutput(fixture)
        });

        assert.equal(fixture.graph.encode(fixture.input), false);
        assert.equal(fixture.graph.getCheckpoint('title:overlay:0'), null);
        assert.deepEqual(fixture.finishCalls, [{ outcome: 'aborted', frameId: 74 }]);
        assert.equal(fixture.finishCalls.length, 1);
        assert.equal(fixture.graph.getDiagnostics().abortCount, 1);
    }
});

test('GPU simulation source의 frame identity, exact span, buffer identity와 COPY_SRC를 fail-closed 검증한다', () => {
    const cases = [
        {
            name: 'presentation-offset',
            mutate: (output) => ({
                ...output,
                presentationSource: { ...output.presentationSource, byteOffset: 4 }
            })
        },
        {
            name: 'presentation-length',
            mutate: (output) => ({
                ...output,
                presentationSource: { ...output.presentationSource, byteLength: (840 * 32) - 4 }
            })
        },
        {
            name: 'presentation-frame',
            mutate: (output) => ({
                ...output,
                presentationSource: { ...output.presentationSource, frameId: 82 }
            })
        },
        {
            name: 'presentation-device-generation',
            mutate: (output) => ({
                ...output,
                presentationSource: {
                    ...output.presentationSource,
                    deviceGeneration: 2
                }
            })
        },
        {
            name: 'packet-source-buffer-drift',
            mutate: (output) => ({
                ...output,
                presentationPacket: {
                    ...output.presentationPacket,
                    gpuSourceBuffer: { label: 'drifted-presentation-buffer' }
                }
            })
        },
        {
            name: 'shield-length',
            mutate: (output) => ({
                ...output,
                shieldInteractionSource: {
                    ...output.shieldInteractionSource,
                    byteLength: 460
                }
            })
        },
        {
            name: 'shield-revision',
            mutate: (output) => ({
                ...output,
                shieldInteractionSource: {
                    ...output.shieldInteractionSource,
                    revision: 2
                }
            })
        },
        {
            name: 'shield-source-buffer-drift',
            mutate: (output) => ({
                ...output,
                shieldInteractionBuffer: { label: 'drifted-shield-buffer' }
            })
        },
        {
            name: 'undersized-presentation-buffer',
            mutate: (output) => {
                const buffer = { label: 'undersized-presentation-buffer', size: 26752, usage: 0x04 };
                return {
                    ...output,
                    presentationPacket: { ...output.presentationPacket, gpuSourceBuffer: buffer },
                    presentationSource: { ...output.presentationSource, gpuSourceBuffer: buffer }
                };
            }
        },
        {
            name: 'shield-copy-src-missing',
            mutate: (output) => {
                const buffer = { label: 'shield-without-copy-src', size: 464, usage: 0x80 };
                return {
                    ...output,
                    shieldInteractionBuffer: buffer,
                    shieldInteractionSource: {
                        ...output.shieldInteractionSource,
                        gpuSourceBuffer: buffer
                    }
                };
            }
        }
    ];

    for (const entry of cases) {
        let fixture;
        fixture = createFixture({
            frameId: 83,
            simulationOutputFactory: () => entry.mutate(fixture.gpuSimulationOutput)
        });

        assert.equal(fixture.graph.encode(fixture.input), false, entry.name);
        assert.equal(fixture.graph.getCheckpoint('title:overlay:0'), null, entry.name);
        assert.deepEqual(
            fixture.finishCalls,
            [{ outcome: 'aborted', frameId: 83 }],
            entry.name
        );
        assert.deepEqual(fixture.trace, ['simulation:encode:83'], entry.name);
    }
});

function createFixture({
    frameId = 1,
    simulationOutputFactory = null
} = {}) {
    const trace = [];
    const finishCalls = [];
    const enemyInputs = [];
    const shieldInputs = [];
    const presentationBuffer = Object.freeze({
        label: 'title-enemy-presentation-buffer',
        size: 840 * 32,
        usage: 0x04
    });
    const gpuPresentationPacket = Object.freeze({
        gpuSourceBuffer: presentationBuffer,
        records: null,
        recordCount: 840,
        recordStrideFloats: 8,
        recordStrideBytes: 32,
        maxRecordCount: 840,
        usedByteLength: 840 * 32,
        frameId,
        deviceGeneration: 1,
        revision: 1
    });
    const shieldInteractionBuffer = Object.freeze({
        label: 'title-shield-interaction-buffer',
        size: 464,
        usage: 0x04
    });
    const presentationSource = Object.freeze({
        gpuSourceBuffer: presentationBuffer,
        byteOffset: 0,
        byteLength: 840 * 32,
        frameId,
        deviceGeneration: 1,
        revision: 1
    });
    const shieldInteractionSource = Object.freeze({
        gpuSourceBuffer: shieldInteractionBuffer,
        byteOffset: 0,
        byteLength: 464,
        impactCountByteOffset: 0,
        dentCountByteOffset: 4,
        frameId,
        deviceGeneration: 1,
        revision: 1
    });
    const gpuSimulationOutput = Object.freeze({
        presentationPacket: gpuPresentationPacket,
        presentationSource,
        shieldInteractionBuffer,
        shieldInteractionSource,
        frameId,
        deviceGeneration: 1,
        revision: 1
    });
    const enemyPalette = new Float32Array(24);
    let cpuAdapterCalls = 0;
    let cpuPresentationCalls = 0;

    const enemySimulation = {
        encode(context) {
            trace.push(`simulation:encode:${context.frameId}`);
            if (simulationOutputFactory) {
                return simulationOutputFactory();
            }
            return gpuSimulationOutput;
        },
        finishFrame(outcome, completedFrameId) {
            finishCalls.push({ outcome, frameId: completedFrameId });
        }
    };
    const titleBackground = {
        getWebGpuEnemySimulation() {
            return enemySimulation;
        },
        getWebGpuEnemyPresentationPacket() {
            cpuPresentationCalls += 1;
            throw new Error('GPU simulation frame에서 CPU presentation adapter를 호출했습니다.');
        },
        getWebGpuEnemyPalette() {
            return enemyPalette;
        },
        titleEnemies: []
    };
    const framePort = new FakeFramePort(createContext({ frameId }));
    const graph = new TitleWebGpuBaseGraph({
        framePort,
        blurPort: {
            encode() {
                throw new Error('이 fixture에서는 blur가 실행되면 안 됩니다.');
            }
        },
        enemyAdapter: {
            writePacket() {
                cpuAdapterCalls += 1;
                throw new Error('GPU simulation frame에서 CPU adapter를 호출했습니다.');
            }
        },
        uiAtlas: createNoopResource({
            getOrUpload() {
                throw new Error('이 fixture에서는 atlas upload가 실행되면 안 됩니다.');
            },
            getDiagnostics() {
                return {};
            }
        }),
        gradientPass: createNoopResource({
            encode() {
                trace.push('gradient:encode');
            }
        }),
        enemyPass: createNoopResource({
            encode(context, input) {
                trace.push('enemy:encode');
                enemyInputs.push(input);
                if (input.packet !== gpuPresentationPacket) {
                    throw new TypeError('유효한 GPU enemy presentation packet이 필요합니다.');
                }
                return true;
            }
        }),
        shieldPass: createNoopResource({
            encode(context, input) {
                trace.push('shield:encode');
                shieldInputs.push(input);
                if (input.gpuInteractionBuffer !== shieldInteractionBuffer) {
                    throw new TypeError('유효한 GPU shield interaction buffer가 필요합니다.');
                }
                return true;
            }
        }),
        centerPass: createNoopResource({
            encode() {
                throw new Error('이 fixture에서는 center pass가 실행되면 안 됩니다.');
            }
        }),
        compositePass: createNoopResource({
            encode() {
                throw new Error('이 fixture에서는 composite pass가 실행되면 안 됩니다.');
            }
        })
    });
    const input = {
        titleBackground,
        presentationSeconds: 1,
        gradientColors: new Float32Array(15),
        enemyPalette,
        centerCommand: null,
        shieldCommand: {
            x: 640,
            y: 360,
            radius: 110,
            fieldRadius: 150,
            ringThickness: 4,
            glowWidth: 12,
            impacts: [],
            dents: []
        },
        introBlur: 0,
        logoPacket: null
    };

    return {
        graph,
        framePort,
        input,
        trace,
        finishCalls,
        enemyInputs,
        shieldInputs,
        gpuPresentationPacket,
        presentationSource,
        shieldInteractionBuffer,
        shieldInteractionSource,
        gpuSimulationOutput,
        cpuAdapterCallCount: () => cpuAdapterCalls,
        cpuPresentationCallCount: () => cpuPresentationCalls
    };
}

class FakeFramePort {
    constructor(context) {
        this.context = context;
        this.active = true;
        this.callbacks = null;
        this.lastError = null;
    }

    isFrameActive() {
        return this.active;
    }

    encodeCommands(callback) {
        if (!this.active) {
            return false;
        }
        try {
            callback(this.context);
            return true;
        } catch (error) {
            this.lastError = error;
            this.abort();
            return false;
        }
    }

    deferFrameCallbacks(callbacks) {
        if (!this.active) {
            return false;
        }
        this.callbacks = callbacks;
        return true;
    }

    commit() {
        return this.#finish('committed');
    }

    abort() {
        return this.#finish('aborted');
    }

    #finish(outcome) {
        if (!this.active) {
            return false;
        }
        this.active = false;
        const callbacks = this.callbacks;
        this.callbacks = null;
        callbacks?.[outcome]?.({ frameId: this.context.frameId });
        return true;
    }
}

function createNoopResource(methods) {
    return {
        ...methods,
        destroy() {}
    };
}

let nextTextureId = 0;
function createDevice() {
    return {
        createTexture(descriptor) {
            const id = ++nextTextureId;
            const texture = {
                id: `texture:${id}`,
                width: descriptor.size.width,
                height: descriptor.size.height,
                destroyed: false,
                createView() {
                    return { id: `view:${id}`, texture };
                },
                destroy() {
                    this.destroyed = true;
                }
            };
            return texture;
        }
    };
}

function createContext(overrides = {}) {
    return {
        frameId: overrides.frameId ?? 1,
        device: overrides.device ?? createDevice(),
        deviceGeneration: overrides.deviceGeneration ?? 1,
        encoder: overrides.encoder ?? {},
        target: overrides.target ?? {},
        format: overrides.format ?? 'bgra8unorm',
        width: overrides.width ?? 1280,
        height: overrides.height ?? 720
    };
}
