import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const COMPOSER_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgpu/webgpu_frame_composer.js',
    import.meta.url
));
const composerSource = await readFile(COMPOSER_PATH, 'utf8');

async function loadComposerModule() {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(composerSource, {
        context,
        identifier: COMPOSER_PATH
    });
    await module.link(() => {
        throw new Error('WebGpuFrameComposer에는 import가 없어야 합니다.');
    });
    await module.evaluate();
    return module.namespace;
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushUntil(predicate, label) {
    for (let index = 0; index < 32; index += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail(`${label} 조건이 Promise queue 안에서 충족되지 않았습니다.`);
}

function createPlatformHarness(options = {}) {
    const timestampSupported = options.timestampSupported !== false;
    const timestampDurationNanoseconds = BigInt(options.timestampDurationNanoseconds ?? 750_000);
    const records = {
        acquireCount: 0,
        encoders: [],
        renderPasses: [],
        passEndCount: 0,
        finishCount: 0,
        submissionAttempts: 0,
        submissions: [],
        drawnMarks: 0,
        clearedMarks: 0,
        querySets: [],
        buffers: [],
        timestampWrites: [],
        queryResolveCount: 0,
        bufferCopyCount: 0,
        mapAsyncCount: 0,
        unmapCount: 0,
        queryDestroyCount: 0,
        bufferDestroyCount: 0,
        listenerAddCount: 0,
        listenerRemoveCount: 0,
        mapDeferreds: []
    };
    let ready = true;
    let generation = 1;
    let format = 'bgra8unorm';
    let width = 320;
    let height = 180;
    let submitError = null;
    let deviceSerial = 0;

    function createDevice() {
        const deviceId = ++deviceSerial;
        let timestampBase = 1_000_000n;
        const uncapturedErrorListeners = new Set();
        return {
            id: `device:${deviceId}`,
            addEventListener(type, listener) {
                if (type === 'uncapturederror') {
                    uncapturedErrorListeners.add(listener);
                    records.listenerAddCount += 1;
                }
            },
            removeEventListener(type, listener) {
                if (type === 'uncapturederror' && uncapturedErrorListeners.delete(listener)) {
                    records.listenerRemoveCount += 1;
                }
            },
            emitUncapturedError(error) {
                for (const listener of uncapturedErrorListeners) {
                    listener({ error });
                }
            },
            createQuerySet(descriptor) {
                const querySet = {
                    descriptor,
                    values: new BigUint64Array(descriptor.count),
                    destroy() {
                        records.queryDestroyCount += 1;
                    }
                };
                records.querySets.push(querySet);
                return querySet;
            },
            createBuffer(descriptor) {
                const storage = new ArrayBuffer(descriptor.size);
                const buffer = {
                    descriptor,
                    storage,
                    async mapAsync() {
                        records.mapAsyncCount += 1;
                        if (options.deferTimestampMap === true) {
                            const deferred = createDeferred();
                            records.mapDeferreds.push(deferred);
                            return deferred.promise;
                        }
                    },
                    getMappedRange() {
                        return storage;
                    },
                    unmap() {
                        records.unmapCount += 1;
                    },
                    destroy() {
                        records.bufferDestroyCount += 1;
                    }
                };
                records.buffers.push(buffer);
                return buffer;
            },
            queue: {
                submit(commandBuffers) {
                    records.submissionAttempts += 1;
                    if (submitError) {
                        throw submitError;
                    }
                    records.submissions.push(commandBuffers);
                }
            },
            createCommandEncoder(options) {
                const encoderRecord = {
                    deviceId,
                    options,
                    passes: [],
                    commands: [],
                    finished: false
                };
                records.encoders.push(encoderRecord);
                return {
                    beginRenderPass(descriptor) {
                        encoderRecord.commands.push('render-pass');
                        const passRecord = { descriptor, drawCount: 0 };
                        encoderRecord.passes.push(passRecord);
                        records.renderPasses.push(passRecord);
                        return {
                            draw() {
                                passRecord.drawCount += 1;
                            },
                            end() {
                                records.passEndCount += 1;
                            }
                        };
                    },
                    beginComputePass(descriptor) {
                        const timestampWrites = descriptor.timestampWrites;
                        const beginIndex = timestampWrites?.beginningOfPassWriteIndex;
                        const endIndex = timestampWrites?.endOfPassWriteIndex;
                        if (Number.isInteger(beginIndex)) {
                            timestampWrites.querySet.values[beginIndex] = timestampBase;
                            records.timestampWrites.push({
                                querySet: timestampWrites.querySet,
                                queryIndex: beginIndex,
                                value: timestampBase
                            });
                            encoderRecord.commands.push(`timestamp:${beginIndex}`);
                        }
                        return {
                            end() {
                                if (!Number.isInteger(endIndex)) {
                                    return;
                                }
                                const value = timestampBase + timestampDurationNanoseconds;
                                timestampWrites.querySet.values[endIndex] = value;
                                records.timestampWrites.push({
                                    querySet: timestampWrites.querySet,
                                    queryIndex: endIndex,
                                    value
                                });
                                encoderRecord.commands.push(`timestamp:${endIndex}`);
                                timestampBase += 10_000_000n;
                            }
                        };
                    },
                    writeTimestamp(querySet, queryIndex) {
                        const value = queryIndex === 0
                            ? timestampBase
                            : timestampBase + timestampDurationNanoseconds;
                        querySet.values[queryIndex] = value;
                        records.timestampWrites.push({ querySet, queryIndex, value });
                        encoderRecord.commands.push(`timestamp:${queryIndex}`);
                        if (queryIndex === 1) {
                            timestampBase += 10_000_000n;
                        }
                    },
                    resolveQuerySet(querySet, firstQuery, queryCount, destination) {
                        const target = new BigUint64Array(destination.storage);
                        target.set(querySet.values.subarray(firstQuery, firstQuery + queryCount));
                        records.queryResolveCount += 1;
                        encoderRecord.commands.push('resolve');
                    },
                    copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
                        const sourceBytes = new Uint8Array(source.storage, sourceOffset, size);
                        new Uint8Array(destination.storage, destinationOffset, size).set(sourceBytes);
                        records.bufferCopyCount += 1;
                        encoderRecord.commands.push('copy');
                    },
                    finish() {
                        encoderRecord.finished = true;
                        records.finishCount += 1;
                        return { id: `command-buffer:${deviceId}:${records.finishCount}` };
                    }
                };
            }
        };
    }

    let device = createDevice();
    const port = {
        getState() {
            return {
                ready,
                deviceGeneration: generation,
                format,
                width,
                height,
                features: timestampSupported ? ['timestamp-query'] : []
            };
        },
        getDevice() {
            return ready ? device : null;
        },
        acquireFrameTarget() {
            records.acquireCount += 1;
            if (!ready) return null;
            return {
                device,
                deviceGeneration: generation,
                format,
                view: { id: `view:${generation}:${records.acquireCount}` },
                width,
                height
            };
        },
        markCanvasDrawn() {
            records.drawnMarks += 1;
            return true;
        },
        markCanvasCleared() {
            records.clearedMarks += 1;
            return true;
        }
    };

    return {
        port,
        records,
        setSubmitError(error) {
            submitError = error;
        },
        drift({ nextGeneration = generation + 1, nextFormat = format } = {}) {
            generation = nextGeneration;
            format = nextFormat;
            device = createDevice();
        },
        resize(nextWidth, nextHeight) {
            width = nextWidth;
            height = nextHeight;
        },
        setReady(value) {
            ready = value;
        },
        getDevice() {
            return device;
        }
    };
}

test('2개 이상 contributor는 target/encoder/submit 하나와 clear→load canvas pass를 공유한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    const port = composer.getPort();
    const contexts = [];
    let committedCount = 0;

    assert.strictEqual(composer.getPort(), port);
    assert.equal(Object.isFrozen(port), true);
    assert.equal(port.isFrameActive(), false);
    assert.equal(composer.beginFrame(41), true);
    assert.equal(composer.isFrameActive(), true);
    assert.equal(port.isFrameActive(), true);
    assert.equal(port.deferFrameCallbacks({
        committed(event) {
            committedCount += 1;
            assert.equal(event.frameId, 41);
            assert.equal(event.submitted, true);
            assert.equal(Object.isFrozen(event), true);
        }
    }), true);
    assert.equal(port.encodeCanvasPass((pass, context) => {
        contexts.push(context);
        pass.draw();
    }), true);
    assert.equal(port.encodeCanvasPass((pass, context) => {
        contexts.push(context);
        pass.draw();
    }), true);

    assert.equal(harness.records.acquireCount, 1);
    assert.equal(harness.records.encoders.length, 1);
    assert.deepEqual(
        harness.records.renderPasses.map((pass) => (
            pass.descriptor.colorAttachments[0].loadOp
        )),
        ['clear', 'load']
    );
    assert.equal(Object.isFrozen(contexts[0]), true);
    assert.deepEqual(Object.keys(contexts[0]), [
        'frameId',
        'device',
        'deviceGeneration',
        'encoder',
        'target',
        'format',
        'width',
        'height'
    ]);
    assert.strictEqual(contexts[0], contexts[1]);
    assert.equal(contexts[0].frameId, 41);
    assert.equal(contexts[0].width, 320);
    assert.equal(contexts[0].height, 180);

    assert.equal(composer.commit(), true);
    assert.equal(composer.isFrameActive(), false);
    assert.equal(port.isFrameActive(), false);
    assert.equal(harness.records.finishCount, 1);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(harness.records.drawnMarks, 1);
    assert.equal(harness.records.clearedMarks, 0);
    assert.equal(committedCount, 1);
});

test('no-work commit과 duplicate commit은 GPU/mark를 만들지 않고 callback 오류도 격리한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let committedCount = 0;

    assert.equal(composer.beginFrame(42), true);
    assert.equal(composer.getPort().deferFrameCallbacks({
        committed() {
            committedCount += 1;
            throw new Error('local callback failure');
        }
    }), true);
    assert.equal(composer.commit(), true);
    assert.equal(composer.commit(), false);
    assert.equal(committedCount, 1);
    assert.equal(harness.records.acquireCount, 0);
    assert.equal(harness.records.encoders.length, 0);
    assert.equal(harness.records.submissionAttempts, 0);
    assert.equal(harness.records.drawnMarks, 0);
    assert.equal(harness.records.clearedMarks, 0);

    const diagnostics = composer.getDiagnostics();
    assert.equal(Object.isFrozen(diagnostics), true);
    assert.equal(Object.isFrozen(diagnostics.counters), true);
    assert.equal(diagnostics.status, 'committed');
    assert.equal(diagnostics.counters.noWorkCommits, 1);
    assert.equal(diagnostics.counters.duplicateCommitCount, 1);
    assert.equal(diagnostics.counters.callbackFailureCount, 1);
    assert.equal(diagnostics.lastCallbackFailure.message, 'local callback failure');
    assert.equal(composer.beginFrame(43), true, 'callback 오류 뒤에도 다음 frame이 시작됩니다.');
    assert.equal(composer.getPort().isFrameActive(), true);
    assert.equal(composer.abort(), true);
    assert.equal(composer.getPort().isFrameActive(), false);
});

test('clear-only frame은 submit 뒤 markCanvasCleared만 한 번 호출한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let localCleared = false;

    composer.beginFrame(50);
    composer.getPort().deferFrameCallbacks({
        committed() {
            localCleared = true;
        }
    });
    assert.equal(composer.getPort().clearCanvas(), true);
    assert.equal(localCleared, false, 'submit 전 local 상태를 바꾸지 않습니다.');
    assert.equal(composer.commit(), true);
    assert.equal(localCleared, true);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(harness.records.drawnMarks, 0);
    assert.equal(harness.records.clearedMarks, 1);
    assert.equal(
        harness.records.renderPasses[0].descriptor.colorAttachments[0].loadOp,
        'clear'
    );
});

test('draw 뒤 명시 clear는 실제 clear pass와 최종 cleared signal로 이전 draw를 덮는다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);

    assert.equal(composer.beginFrame(51), true);
    assert.equal(composer.getPort().encodeCanvasPass((pass) => pass.draw()), true);
    assert.equal(composer.getPort().clearCanvas({ r: 0.1, g: 0.2, b: 0.3, a: 0.4 }), true);
    assert.deepEqual(
        harness.records.renderPasses.map((pass) => (
            pass.descriptor.colorAttachments[0].loadOp
        )),
        ['clear', 'clear']
    );
    assert.equal(composer.commit(), true);
    assert.equal(harness.records.drawnMarks, 0);
    assert.equal(harness.records.clearedMarks, 1);
});

test('encode callback throw는 stale command를 submit/mark하지 않고 aborted callback만 호출한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let committedCount = 0;
    let abortedCount = 0;

    composer.beginFrame(60);
    composer.getPort().deferFrameCallbacks({
        committed() {
            committedCount += 1;
        },
        aborted() {
            abortedCount += 1;
        }
    });
    assert.equal(composer.getPort().encodeCommands(() => {
        throw new Error('encode failed');
    }), false);
    assert.equal(composer.commit(), false);
    assert.equal(committedCount, 0);
    assert.equal(abortedCount, 1);
    assert.equal(harness.records.finishCount, 0);
    assert.equal(harness.records.submissionAttempts, 0);
    assert.equal(harness.records.drawnMarks, 0);
    assert.equal(harness.records.clearedMarks, 0);
    assert.equal(composer.getDiagnostics().lastFailure.reason, 'encode-commands-failed');

    assert.equal(composer.beginFrame(61), true);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    assert.equal(composer.commit(), true);
    assert.equal(harness.records.submissions.length, 1);
});

test('submit throw는 local commit과 canvas mark를 막고 다음 frame에서 복구한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let localCommitted = false;
    let abortedCount = 0;

    harness.setSubmitError(new Error('submit failed'));
    composer.beginFrame(70);
    composer.getPort().deferFrameCallbacks({
        committed() {
            localCommitted = true;
        },
        aborted() {
            abortedCount += 1;
        }
    });
    composer.getPort().encodeCanvasPass(() => {});
    assert.equal(composer.commit(), false);
    assert.equal(localCommitted, false);
    assert.equal(abortedCount, 1);
    assert.equal(harness.records.submissions.length, 0);
    assert.equal(harness.records.drawnMarks, 0);
    assert.equal(harness.records.clearedMarks, 0);

    harness.setSubmitError(null);
    assert.equal(composer.beginFrame(71), true);
    assert.equal(composer.getPort().encodeCanvasPass(() => {}), true);
    assert.equal(composer.commit(), true);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(harness.records.drawnMarks, 1);
    assert.equal(composer.getDiagnostics().counters.submitFailureCount, 1);
});

test('generation/device drift는 acquired command를 폐기하고 새 generation frame에서 회복한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let abortedCount = 0;

    composer.beginFrame(80);
    composer.getPort().deferFrameCallbacks({
        aborted(event) {
            abortedCount += 1;
            assert.equal(event.reason, 'pre-finish-drift');
        }
    });
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    harness.drift({ nextGeneration: 2 });
    assert.equal(composer.commit(), false);
    assert.equal(abortedCount, 1);
    assert.equal(harness.records.finishCount, 0);
    assert.equal(harness.records.submissionAttempts, 0);
    assert.equal(harness.records.drawnMarks, 0);

    assert.equal(composer.beginFrame(81), true);
    let recoveredGeneration = null;
    assert.equal(composer.getPort().encodeCommands((context) => {
        recoveredGeneration = context.deviceGeneration;
    }), true);
    assert.equal(composer.commit(), true);
    assert.equal(recoveredGeneration, 2);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(composer.getDiagnostics().counters.driftFailureCount, 1);
});

test('같은 device generation의 resize drift도 이전 target을 제출하지 않고 다음 frame에서 회복한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let abortedReason = null;

    assert.equal(composer.beginFrame(82), true);
    assert.equal(composer.getPort().deferFrameCallbacks({
        aborted(event) {
            abortedReason = event.reason;
        }
    }), true);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    harness.resize(640, 360);
    assert.equal(composer.commit(), false);
    assert.equal(abortedReason, 'pre-finish-drift');
    assert.equal(harness.records.finishCount, 0);
    assert.equal(harness.records.submissionAttempts, 0);

    assert.equal(composer.beginFrame(83), true);
    let recoveredSize = null;
    assert.equal(composer.getPort().encodeCommands((context) => {
        recoveredSize = [context.width, context.height];
    }), true);
    assert.equal(composer.commit(), true);
    assert.deepEqual(recoveredSize, [640, 360]);
});

test('명시 abort는 deferred aborted를 한 번 호출하고 command를 제출하지 않는다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    let abortedCount = 0;

    composer.beginFrame(90);
    composer.getPort().deferFrameCallbacks({
        aborted() {
            abortedCount += 1;
        }
    });
    composer.getPort().encodeCommands(() => {});
    assert.equal(composer.abort('presentation-interrupted'), true);
    assert.equal(abortedCount, 1);
    assert.equal(composer.abort(), false);
    assert.equal(harness.records.finishCount, 0);
    assert.equal(harness.records.submissionAttempts, 0);
    assert.equal(composer.getDiagnostics().lastFailure.reason, 'presentation-interrupted');
});

test('composer-owned timestamp는 모든 contribution을 한 scope로 감싸고 비동기 sample을 분리 drain한다', async () => {
    const {
        WebGpuFrameComposer,
        WEBGPU_FRAME_GPU_TELEMETRY_SCOPE
    } = await loadComposerModule();
    const harness = createPlatformHarness({ timestampDurationNanoseconds: 750_000 });
    const composer = new WebGpuFrameComposer(harness.port);
    const telemetryPort = composer.getGpuTelemetryPort();

    assert.strictEqual(composer.getGpuTelemetryPort(), telemetryPort);
    assert.equal(Object.isFrozen(telemetryPort), true);
    assert.equal(telemetryPort.setEnabled(true), true);
    assert.equal(telemetryPort.getSnapshot().status, 'armed');

    assert.equal(composer.beginFrame(101), true);
    assert.equal(composer.getPort().encodeCanvasPass((pass) => pass.draw()), true);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    assert.equal(composer.commit(), true);
    assert.deepEqual(
        harness.records.encoders[0].commands,
        ['timestamp:0', 'render-pass', 'timestamp:1', 'resolve', 'copy']
    );
    assert.equal(harness.records.querySets.length, 1);
    assert.equal(harness.records.queryResolveCount, 1);
    assert.equal(harness.records.bufferCopyCount, 1);
    assert.equal(harness.records.mapAsyncCount, 1);

    await flushUntil(
        () => telemetryPort.getSnapshot().counters.sampleCount === 1,
        'timestamp sample 완료'
    );
    const samples = telemetryPort.drainSamples();
    assert.equal(samples.length, 1);
    assert.deepEqual({ ...samples[0] }, {
        source: 'webgpu-frame-composer',
        scope: WEBGPU_FRAME_GPU_TELEMETRY_SCOPE,
        deviceGeneration: 1,
        frameId: 101,
        gpuMs: 0.75
    });
    assert.equal(Object.isFrozen(samples[0]), true);
    assert.deepEqual(Array.from(telemetryPort.drainSamples()), []);

    const snapshot = telemetryPort.getSnapshot();
    assert.equal(snapshot.supported, true);
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.pendingCount, 0);
    assert.equal(snapshot.bufferedSampleCount, 0);
    assert.equal(snapshot.counters.scopeBeginCount, 1);
    assert.equal(snapshot.counters.scopeEndCount, 1);
    assert.equal(snapshot.counters.timestampSubmitCount, 1);
    assert.equal(snapshot.counters.sampleCount, 1);
    assert.equal(snapshot.counters.apiFailureCount, 0);
    assert.equal(snapshot.counters.mapFailureCount, 0);
    assert.equal(snapshot.counters.uncapturedErrorCount, 0);
    assert.deepEqual(Array.from(snapshot.uncapturedErrorMessages), []);
});

test('timestamp-query 미지원은 presentation을 유지하고 telemetry만 fail-closed한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness({ timestampSupported: false });
    const composer = new WebGpuFrameComposer(harness.port);
    const telemetryPort = composer.getGpuTelemetryPort();

    telemetryPort.setEnabled(true);
    assert.equal(composer.beginFrame(102), true);
    assert.equal(composer.getPort().encodeCanvasPass((pass) => pass.draw()), true);
    assert.equal(composer.commit(), true);
    assert.equal(harness.records.submissions.length, 1);
    assert.equal(harness.records.drawnMarks, 1);
    assert.equal(harness.records.querySets.length, 0);
    assert.deepEqual(Array.from(telemetryPort.drainSamples()), []);

    const snapshot = telemetryPort.getSnapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.status, 'unsupported');
    assert.equal(snapshot.supported, false);
    assert.equal(snapshot.reason, 'timestamp-query-unavailable');
    assert.equal(snapshot.counters.scopeBeginCount, 0);
    assert.equal(composer.getDiagnostics().counters.framesCommitted, 1);
});

test('abort된 timestamp scope는 map을 시작하지 않고 같은 slot을 다음 submit에서 재사용한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    const telemetryPort = composer.getGpuTelemetryPort();
    telemetryPort.setEnabled(true);

    composer.beginFrame(103);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    assert.equal(composer.abort('test-abort'), true);
    assert.equal(harness.records.mapAsyncCount, 0);
    assert.equal(telemetryPort.getSnapshot().encodingCount, 0);

    composer.beginFrame(104);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    assert.equal(composer.commit(), true);
    await flushUntil(
        () => telemetryPort.getSnapshot().counters.sampleCount === 1,
        'abort 뒤 timestamp sample 완료'
    );
    assert.equal(telemetryPort.drainSamples()[0].frameId, 104);
    assert.equal(harness.records.querySets.length, 2,
        'ring은 다음 idle slot을 사용하되 abort slot도 안전하게 재사용 가능한 상태로 남깁니다.');
});

test('destroy는 active frame을 한 번 abort하고 timestamp 자원과 device listener를 idempotent하게 해제한다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness();
    const composer = new WebGpuFrameComposer(harness.port);
    const port = composer.getPort();
    const telemetryPort = composer.getGpuTelemetryPort();
    let abortedCount = 0;
    let abortedReason = null;

    telemetryPort.setEnabled(true);
    assert.equal(composer.beginFrame(105), true);
    assert.equal(port.deferFrameCallbacks({
        aborted(event) {
            abortedCount += 1;
            abortedReason = event.reason;
        }
    }), true);
    assert.equal(port.encodeCommands(() => {}), true);
    assert.equal(harness.records.listenerAddCount, 1);
    assert.equal(harness.records.querySets.length, 1);

    composer.destroy();
    assert.equal(composer.isFrameActive(), false);
    assert.equal(composer.getDiagnostics().status, 'destroyed');
    assert.equal(composer.getDiagnostics().counters.destroyCount, 1);
    assert.equal(composer.getDiagnostics().counters.framesAborted, 1);
    assert.equal(abortedCount, 1);
    assert.equal(abortedReason, 'composer-destroyed');
    assert.equal(harness.records.finishCount, 0);
    assert.equal(harness.records.submissionAttempts, 0);
    assert.equal(harness.records.queryDestroyCount, 1);
    assert.equal(harness.records.bufferDestroyCount, 2);
    assert.equal(harness.records.listenerRemoveCount, 1);
    assert.equal('destroy' in port, false, 'contributor port는 display lifecycle 권한을 노출하지 않습니다.');

    const telemetry = telemetryPort.getSnapshot();
    assert.equal(telemetry.enabled, false);
    assert.equal(telemetry.status, 'destroyed');
    assert.equal(telemetry.reason, 'composer-destroyed');
    assert.equal(telemetry.pendingCount, 0);
    assert.equal(telemetry.encodingCount, 0);
    assert.equal(telemetry.counters.resourceDestroyCount, 1);
    assert.equal(telemetryPort.setEnabled(true), false);
    assert.equal(composer.beginFrame(106), false);

    composer.destroy();
    assert.equal(composer.getDiagnostics().counters.destroyCount, 1);
    assert.equal(abortedCount, 1);
    assert.equal(harness.records.queryDestroyCount, 1);
    assert.equal(harness.records.bufferDestroyCount, 2);
    assert.equal(harness.records.listenerRemoveCount, 1);
});

test('destroy 뒤 늦게 완료된 timestamp map은 lifecycle generation으로 무효화된다', async () => {
    const { WebGpuFrameComposer } = await loadComposerModule();
    const harness = createPlatformHarness({ deferTimestampMap: true });
    const composer = new WebGpuFrameComposer(harness.port);
    const telemetryPort = composer.getGpuTelemetryPort();

    telemetryPort.setEnabled(true);
    assert.equal(composer.beginFrame(107), true);
    assert.equal(composer.getPort().encodeCommands(() => {}), true);
    assert.equal(composer.commit(), true);
    assert.equal(telemetryPort.getSnapshot().pendingCount, 1);
    assert.equal(harness.records.mapDeferreds.length, 1);

    composer.destroy();
    assert.equal(telemetryPort.getSnapshot().pendingCount, 0);
    assert.equal(harness.records.queryDestroyCount, 1);
    assert.equal(harness.records.bufferDestroyCount, 2);
    harness.records.mapDeferreds[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const snapshot = telemetryPort.getSnapshot();
    assert.equal(snapshot.status, 'destroyed');
    assert.equal(snapshot.counters.sampleCount, 0);
    assert.equal(snapshot.counters.mapFailureCount, 0);
    assert.deepEqual(Array.from(telemetryPort.drainSamples()), []);
    harness.getDevice().emitUncapturedError(new Error('late device event'));
    assert.equal(telemetryPort.getSnapshot().counters.uncapturedErrorCount, 0);
});
