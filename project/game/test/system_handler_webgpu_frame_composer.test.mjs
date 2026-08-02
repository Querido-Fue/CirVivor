import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const systemHandlerSource = await readFile(
    new URL('../script/module/system_handler.js', import.meta.url),
    'utf8'
);

function createSyntheticModule(context, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context });
}

async function loadSystemHandler() {
    const context = vm.createContext({ console });
    const timeHandler = {
        fixedStepSeconds: 1 / 60,
        setFixedInterpolationAlpha() {}
    };
    class EmptySystem {}
    const dependencies = new Map([
        ['save/save_system.js', { SaveSystem: EmptySystem }],
        ['display/display_system.js', { DisplaySystem: EmptySystem }],
        ['animation/animation_system.js', { AnimationSystem: EmptySystem }],
        ['input/input_system.js', { InputSystem: EmptySystem }],
        ['object/object_system.js', { ObjectSystem: EmptySystem }],
        ['scene/scene_system.js', { SceneSystem: EmptySystem }],
        ['ui/ui_system.js', { UISystem: EmptySystem }],
        ['overlay/overlay_system.js', { OverlayManager: EmptySystem }],
        ['debug/debug_system.js', {
            DebugSystem: EmptySystem,
            beginPerformanceSection: () => 0,
            endPerformanceSection: () => {}
        }],
        ['sound/sound_system.js', { SoundSystem: EmptySystem }],
        ['game/time_handler.js', { getTimeHandler: () => timeHandler }],
        ['ui/_ui_pool.js', { warmupUIPools: () => {} }],
        ['simulation/simulation_command_queue.js', {
            drainSimulationCommands: () => []
        }],
        ['simulation/simulation_runtime.js', { syncSimulationRuntime: () => {} }],
        ['simulation/release_simulation_profiler.js', {
            isReleaseSimulationProfilerCollecting: () => false,
            recordReleaseSimulationFixedStep: () => {},
            shouldRecordReleaseSimulationForFrameMode: () => false
        }],
        ['debug/_release_simulation_profiler_hud.js', {
            drawReleaseSimulationProfilerHud: () => {}
        }]
    ]);
    const dependencyModules = new Map(
        [...dependencies].map(([specifier, exports]) => [
            specifier,
            createSyntheticModule(context, exports)
        ])
    );
    const module = new vm.SourceTextModule(systemHandlerSource, {
        context,
        identifier: 'system_handler.js'
    });
    await module.link((specifier) => dependencyModules.get(specifier));
    await module.evaluate();
    return module.namespace.SystemHandler;
}

function createRenderableHandler(SystemHandler, events, options = {}) {
    const handler = new SystemHandler();
    handler.update = () => events.push('update');
    handler.draw = () => {
        events.push('draw');
        if (options.throwFromDraw) {
            throw options.throwFromDraw;
        }
    };
    handler.displaySystem = {
        drawHandler: {
            clearAll() {
                events.push('clear');
            }
        },
        webGLHandler: {
            clearAll() {
                events.push('webgl-clear');
            },
            flushAll() {
                events.push('flush');
            }
        },
        beginWebGpuFrame() {
            events.push('begin');
            return options.beginResult !== false;
        },
        endWebGpuFrame(completed) {
            events.push(`end:${completed}`);
        }
    };
    handler.sceneSystem = {
        finalizeWebGpuPresentation({ overlaySnapshots }) {
            assert.deepEqual(overlaySnapshots, ['overlay-snapshot']);
            events.push('finalize');
            if (options.throwFromFinalize) {
                throw options.throwFromFinalize;
            }
            return options.finalizeResult;
        },
        abortWebGpuPresentation(reason) {
            events.push(`abort:${reason}`);
        }
    };
    handler.overlayManager = {
        getTitleWebGpuPresentationSnapshots() {
            events.push('snapshots');
            return ['overlay-snapshot'];
        }
    };
    return handler;
}

test('렌더 프레임은 draw와 최종 flush를 하나의 WebGPU presentation frame으로 감싼다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const handler = createRenderableHandler(SystemHandler, events);

    handler.tick({ fixedStepCount: 0 });

    assert.deepEqual(events, [
        'clear',
        'webgl-clear',
        'update',
        'begin',
        'draw',
        'flush',
        'snapshots',
        'finalize',
        'end:true'
    ]);
});

test('draw 실패는 활성 WebGPU frame을 abort 상태로 닫고 원래 오류를 보존한다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const expectedError = new Error('draw-failed');
    const handler = createRenderableHandler(SystemHandler, events, {
        throwFromDraw: expectedError
    });

    assert.throws(() => handler.tick({ fixedStepCount: 0 }), (error) => error === expectedError);
    assert.deepEqual(events.slice(-4), [
        'begin',
        'draw',
        'abort:presentation-incomplete',
        'end:false'
    ]);
    assert.equal(events.includes('flush'), false);
    assert.equal(events.includes('finalize'), false);
});

test('composer가 frame을 시작하지 않았으면 종료 훅도 호출하지 않는다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const handler = createRenderableHandler(SystemHandler, events, { beginResult: false });

    handler.tick({ fixedStepCount: 0 });

    assert.equal(events.includes('end:true'), false);
    assert.deepEqual(events.slice(-3), ['begin', 'draw', 'flush']);
    assert.equal(events.includes('snapshots'), false);
    assert.equal(events.includes('finalize'), false);
});

test('최종 WebGPU 합성 실패는 composer를 abort하고 오류를 보존한다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const expectedError = new Error('finalize-failed');
    const handler = createRenderableHandler(SystemHandler, events, {
        throwFromFinalize: expectedError
    });

    assert.throws(() => handler.tick({ fixedStepCount: 0 }), (error) => error === expectedError);
    assert.deepEqual(events.slice(-4), [
        'snapshots',
        'finalize',
        'abort:presentation-incomplete',
        'end:false'
    ]);
});

test('최종 WebGPU 합성의 false 결과는 partial command를 commit하지 않고 composer를 abort한다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const handler = createRenderableHandler(SystemHandler, events, {
        finalizeResult: false
    });

    handler.tick({ fixedStepCount: 0 });
    assert.deepEqual(events.slice(-4), [
        'snapshots',
        'finalize',
        'abort:presentation-incomplete',
        'end:false'
    ]);
});

test('renderFrame 비활성 정책은 WebGPU frame lifecycle을 열지 않는다', async () => {
    const SystemHandler = await loadSystemHandler();
    const events = [];
    const handler = createRenderableHandler(SystemHandler, events);
    handler.frameExecutionPolicy = handler.createPausePolicy({ renderFrame: false });

    handler.tick({ fixedStepCount: 0 });

    assert.deepEqual(events, ['update']);
});

console.log('system handler WebGPU frame composer contract: ok');
