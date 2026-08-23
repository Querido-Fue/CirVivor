import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const MAIN_PATH = fileURLToPath(new URL('../script/main.js', import.meta.url));
const mainSource = await readFile(MAIN_PATH, 'utf8');

/**
 * 외부에서 이행 시점을 제어하는 Promise를 만듭니다.
 * @returns {{promise: Promise<void>, resolve: () => void}}
 */
function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

/**
 * 같은 VM context에서 main.js import 대역을 만듭니다.
 * @param {vm.Context} context - 대상 VM context입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {Record<string, unknown>} exports - export 값입니다.
 * @returns {vm.SyntheticModule}
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

/**
 * production main.js를 지연 가능한 SystemHandler.init과 이벤트 대역으로 로드합니다.
 * @returns {Promise<object>} 테스트 제어기와 호출 기록입니다.
 */
async function loadMainHarness(options = {}) {
    const initGate = createDeferred();
    const trace = [];
    const resizeSnapshots = [];
    const warnings = [];
    const windowListeners = new Map();
    const documentListeners = new Map();
    const scheduledFrames = [];
    let nextFrameId = 0;

    const windowObject = {
        innerWidth: 1280,
        innerHeight: 720,
        onload: null,
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) ?? [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        }
    };
    const documentObject = {
        hidden: false,
        documentElement: { style: {} },
        hasFocus() {
            return true;
        },
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) ?? [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        }
    };
    const consoleObject = Object.create(console);
    consoleObject.warn = (...args) => warnings.push(args);

    const context = vm.createContext({
        console: consoleObject,
        document: documentObject,
        window: windowObject,
        performance: {
            now() {
                return 1000;
            }
        },
        requestAnimationFrame(callback) {
            const frameId = ++nextFrameId;
            trace.push(`raf:${frameId}`);
            scheduledFrames.push({ frameId, callback });
            return frameId;
        },
        cancelAnimationFrame(frameId) {
            trace.push(`cancel-raf:${frameId}`);
        },
        setTimeout,
        clearTimeout
    });

    class SystemHandler {
        constructor() {
            trace.push('system.construct');
            this.uiSystem = null;
            this.debugSystem = null;
            this.overlayManager = Object.hasOwn(options, 'overlayManager')
                ? options.overlayManager
                : { openExitOverlay: () => 'exit-overlay' };
            this.saveSystem = {
                saveAll: () => {
                    trace.push('saveAll');
                    return typeof options.saveAll === 'function'
                        ? options.saveAll()
                        : Promise.resolve();
                }
            };
        }

        init() {
            trace.push('system.init');
            return initGate.promise;
        }

        resize() {
            trace.push('system.resize');
            resizeSnapshots.push({
                width: windowObject.innerWidth,
                height: windowObject.innerHeight,
                gamePublished: windowObject.Game !== undefined
            });
        }

        setPauseReason() {
            trace.push('system.setPauseReason');
        }

        shouldKeepLoopRunning() {
            trace.push('system.shouldKeepLoopRunning');
            return true;
        }
    }

    class FixedStepCatchUpPolicy {
        reset() {
            trace.push('catchUp.reset');
        }

        resolveMaxSteps() {
            return 1;
        }

        isCpuBound() {
            return false;
        }
    }

    let runtimeToolInstance = null;
    class RuntimeTool {
        constructor() {
            runtimeToolInstance = this;
        }

        closeWindow() {
            trace.push('closeWindow');
        }
    }

    const dependencies = new Map([
        ['game/module/system_handler.js', { SystemHandler }],
        ['game/time_handler.js', { TimeHandler: class TimeHandler {} }],
        ['util/math_util.js', { MathUtil: class MathUtil {} }],
        ['util/color_util.js', { ColorUtil: class ColorUtil {} }],
        ['util/runtime_tool.js', {
            RuntimeTool,
            runtimeTool: () => runtimeToolInstance
        }],
        ['simulation/fixed_step_catch_up_policy.js', {
            FixedStepCatchUpPolicy,
            countExcessFixedStepDebt: () => 0,
            countWholeFixedSteps: () => 0,
            restoreUncompletedFixedStepDebt: (accumulatorSeconds) => accumulatorSeconds
        }],
        ['simulation/release_simulation_profiler.js', {
            isReleaseSimulationProfilerCollecting: () => false,
            recordReleaseSimulationFrame: () => {},
            resumeReleaseSimulationProfiler: () => trace.push('profiler.resume'),
            shouldRecordReleaseSimulationForFrameMode: () => false,
            suspendReleaseSimulationProfiler: () => trace.push('profiler.suspend')
        }],
        ['display/webgl/_webgl_gpu_telemetry_state.js', {
            advanceWebGLGpuTelemetryFrame: () => 0
        }]
    ]);

    const syntheticModules = new Map();
    for (const [specifier, exports] of dependencies) {
        syntheticModules.set(
            specifier,
            createSyntheticModule(context, specifier, exports)
        );
    }

    const module = new vm.SourceTextModule(mainSource, {
        context,
        identifier: MAIN_PATH
    });
    await module.link((specifier) => {
        const dependency = syntheticModules.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 main.js import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();

    return {
        initGate,
        trace,
        resizeSnapshots,
        warnings,
        scheduledFrames,
        window: windowObject,
        dispatchWindowEvent(type) {
            for (const listener of windowListeners.get(type) ?? []) {
                listener.call(windowObject);
            }
        }
    };
}

test('초기 전체화면 resize 유실 뒤 최신 viewport를 첫 frame 전에 수렴하고 이후 resize를 전달한다', async () => {
    const harness = await loadMainHarness();
    assert.equal(typeof harness.window.onload, 'function');

    const loadPromise = harness.window.onload();
    assert.deepEqual(harness.trace, ['system.construct', 'system.init']);
    assert.equal(harness.window.Game, undefined);

    harness.window.innerWidth = 2560;
    harness.window.innerHeight = 1440;
    harness.dispatchWindowEvent('resize');
    assert.equal(
        harness.resizeSnapshots.length,
        0,
        'SystemHandler.init 중 resize는 아직 생성되지 않은 Game에 전달되면 안 됩니다.'
    );

    harness.initGate.resolve();
    await loadPromise;

    assert.equal(harness.warnings.length, 0);
    assert.ok(harness.window.Game, '초기화가 끝나면 Game이 전역에 공개되어야 합니다.');
    assert.deepEqual(harness.resizeSnapshots, [{
        width: 2560,
        height: 1440,
        gamePublished: true
    }]);
    const startupResizeIndex = harness.trace.indexOf('system.resize');
    const startSideEffectIndex = harness.trace.indexOf('system.setPauseReason');
    const profilerResumeIndex = harness.trace.indexOf('profiler.resume');
    const firstFrameIndex = harness.trace.findIndex((entry) => entry.startsWith('raf:'));
    assert.ok(startupResizeIndex >= 0);
    assert.ok(startupResizeIndex < startSideEffectIndex, 'viewport 수렴은 App.start보다 먼저여야 합니다.');
    assert.ok(startupResizeIndex < profilerResumeIndex, 'viewport 수렴은 loop 재개보다 먼저여야 합니다.');
    assert.ok(startupResizeIndex < firstFrameIndex, 'viewport 수렴은 첫 rAF 예약보다 먼저여야 합니다.');
    assert.equal(harness.scheduledFrames.length, 1);

    harness.window.innerWidth = 1920;
    harness.window.innerHeight = 1080;
    harness.dispatchWindowEvent('resize');
    assert.deepEqual(harness.resizeSnapshots, [
        { width: 2560, height: 1440, gamePublished: true },
        { width: 1920, height: 1080, gamePublished: true }
    ]);
});

async function initializeMainHarness(options = {}) {
    const harness = await loadMainHarness(options);
    const loadPromise = harness.window.onload();
    harness.initGate.resolve();
    await loadPromise;
    return harness;
}

test('종료 확인 오버레이 생성 실패 시 저장 후 강제 종료 경로로 전환한다', async (t) => {
    await t.test('오버레이가 열리면 현재 close 요청만 소비한다', async () => {
        let openCount = 0;
        const harness = await initializeMainHarness({
            overlayManager: {
                openExitOverlay() {
                    openCount++;
                    return 'exit-overlay';
                }
            }
        });

        assert.equal(harness.window.Game.tryClose(), true);
        assert.equal(openCount, 1);
        assert.equal(harness.window.Game.shouldForceCloseWindow(), false);
        assert.equal(harness.trace.includes('saveAll'), false);
    });

    await t.test('오버레이 ID가 없으면 종료를 막은 채 방치하지 않는다', async () => {
        const harness = await initializeMainHarness({
            overlayManager: { openExitOverlay: () => null }
        });

        assert.equal(harness.window.Game.tryClose(), true);
        assert.equal(harness.window.Game.shouldForceCloseWindow(), true);
        assert.equal(harness.trace.includes('saveAll'), true);
        assert.equal(harness.window.Game.tryClose(), false);
    });

    await t.test('오버레이 생성 예외도 저장 후 종료하고 경고를 남긴다', async () => {
        const harness = await initializeMainHarness({
            overlayManager: {
                openExitOverlay() {
                    throw new Error('overlay failed');
                }
            }
        });

        assert.equal(harness.window.Game.tryClose(), true);
        assert.equal(harness.window.Game.shouldForceCloseWindow(), true);
        assert.equal(harness.trace.includes('saveAll'), true);
        assert.equal(harness.warnings.length, 1);
    });

    await t.test('fallback 저장 Promise가 거부되어도 실제 창 닫기를 예약한다', async () => {
        const saveError = new Error('save failed');
        const harness = await initializeMainHarness({
            overlayManager: { openExitOverlay: () => null },
            saveAll: () => Promise.reject(saveError)
        });

        assert.equal(harness.window.Game.tryClose(), true);
        await new Promise((resolve) => setTimeout(resolve, 120));

        assert.equal(harness.window.Game.shouldForceCloseWindow(), true);
        assert.equal(harness.trace.includes('closeWindow'), true);
        assert.equal(harness.warnings.length, 1);
        assert.strictEqual(harness.warnings[0][1], saveError);
    });
});
