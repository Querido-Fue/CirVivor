import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DISPLAY_SYSTEM_PATH = fileURLToPath(new URL(
    '../script/module/display/display_system.js',
    import.meta.url
));
const DISPLAY_DESCRIPTOR_PATH = fileURLToPath(new URL(
    '../script/module/display/display_surface_descriptor.js',
    import.meta.url
));
const SYSTEM_HANDLER_PATH = fileURLToPath(new URL(
    '../script/module/system_handler.js',
    import.meta.url
));
const [
    displaySystemSource,
    displayDescriptorSource,
    systemHandlerSource
] = await Promise.all([
    readFile(DISPLAY_SYSTEM_PATH, 'utf8'),
    readFile(DISPLAY_DESCRIPTOR_PATH, 'utf8'),
    readFile(SYSTEM_HANDLER_PATH, 'utf8')
]);
const EXECUTABLE_SOURCE_HASH = '62805b2ebf3911ad15bfb97c4b330d21a9e2e8b845541f9e8394fbc5a5338559';
const STATIC_SURFACE_IDS = Object.freeze([
    'background',
    'gpu-object',
    'object',
    'effect',
    'texteffect',
    'ui',
    'vignette',
    'top'
]);

/**
 * 독립된 줄의 JSDoc을 제거한 production 실행 소스를 해시합니다.
 * @param {string} source - production 소스입니다.
 * @param {number} expectedJsDocCount - 예상 JSDoc 블록 수입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(source, expectedJsDocCount) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(allJsDocStarts.length, expectedJsDocCount, 'production JSDoc 개수가 바뀌었습니다.');
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    const executableSource = source
        .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(escapedDeclaration) {
    const match = displaySystemSource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

/**
 * 외부에서 이행·거부 시점을 제어하는 Promise를 만듭니다.
 * @returns {{promise:Promise<unknown>, resolve:Function, reject:Function}}
 */
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/**
 * 같은 VM context에서 synthetic dependency module을 만듭니다.
 * @param {vm.Context} context - 대상 context입니다.
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
 * 조건이 충족될 때까지 Promise job queue를 진행합니다.
 * @param {Function} predicate - 완료 조건입니다.
 * @param {string} label - 실패 메시지입니다.
 * @returns {Promise<void>}
 */
async function flushUntil(predicate, label) {
    for (let index = 0; index < 64; index += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail(`${label} 조건이 Promise job queue 안에서 충족되지 않았습니다.`);
}

/**
 * 함수 호출이 동기 throw 없이 같은 오류 identity로 reject하는지 검증합니다.
 * @param {Function} invoke - Promise 반환 호출입니다.
 * @param {unknown} expectedError - 기대 오류입니다.
 * @returns {Promise<void>}
 */
async function assertAsyncSameError(invoke, expectedError) {
    let result;
    assert.doesNotThrow(() => {
        result = invoke();
    });
    assert.equal(typeof result?.then, 'function');
    await assert.rejects(result, (error) => error === expectedError);
}

/**
 * init 테스트용 canvas 대역을 만듭니다.
 * @param {string} id - DOM id입니다.
 * @param {object} records - 호출 기록입니다.
 * @returns {object} canvas 대역입니다.
 */
function createCanvas(id, records) {
    const canvas = {
        id,
        dataset: {},
        style: {},
        width: 0,
        height: 0,
        parentNode: null,
        getContext(type, options) {
            assert.equal(this, canvas, `${id}.getContext receiver`);
            records.contexts.push({
                id,
                type,
                options: options === undefined ? undefined : { ...options }
            });
            records.events.push(`context:${id}:${type}`);
            return { id: `${id}:${type}` };
        }
    };
    return canvas;
}

/**
 * 실제 DisplaySystem과 실제 descriptor 모듈을 최소 대역 의존성과 함께 로드합니다.
 * @param {object} [options={}] - controller 초기값과 DOM 훅입니다.
 * @returns {Promise<object>} namespace와 controller/기록입니다.
 */
async function loadDisplaySystem(options = {}) {
    const records = {
        events: [],
        contexts: [],
        drawLayers: [],
        webGLLayers: [],
        transforms: [],
        backgroundColors: [],
        screenResizeCalls: [],
        webGLResizeCalls: [],
        vignetteResizeCalls: [],
        elementIds: [],
        webGpuServices: [],
        webGpuComposers: [],
        webGpuBlurServices: [],
        webGpuKawaseFactories: []
    };
    const controls = {
        themeInit: options.themeInit ?? (() => undefined),
        screenInit: options.screenInit ?? (() => undefined),
        screenResize: options.screenResize ?? (() => false),
        getSetting: options.getSetting ?? (() => 'dark'),
        setTheme: options.setTheme ?? (() => undefined),
        colorUtil: options.colorUtil ?? (() => ({
            cssToRgb() {
                return { r: 17, g: 34, b: 51 };
            }
        })),
        drawRegister: options.drawRegister ?? (() => undefined),
        webGLRegister: options.webGLRegister ?? (() => undefined),
        setBackgroundColor: options.setBackgroundColor ?? (() => undefined),
        webGpuInit: options.webGpuInit ?? (() => ({
            status: 'ready',
            reason: null,
            ready: true,
            deviceGeneration: 1
        }))
    };
    const colorSchemes = options.colorSchemes ?? { Background: null };
    const overlayHost = {
        id: 'overlaylayerhost',
        style: {},
        children: [],
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            child.parentNode = null;
        }
    };
    const canvases = new Map(STATIC_SURFACE_IDS.map((id) => [id, createCanvas(id, records)]));
    const defaultGetElementById = (id) => (
        id === 'overlaylayerhost' ? overlayHost : (canvases.get(id) ?? null)
    );
    const documentObject = {
        getElementById(id) {
            assert.equal(this, documentObject, 'document.getElementById receiver');
            records.elementIds.push(id);
            records.events.push(`element:${id}`);
            return options.getElementById
                ? options.getElementById(id, defaultGetElementById)
                : defaultGetElementById(id);
        }
    };
    const context = vm.createContext({ console, document: documentObject });

    const instances = {
        screens: [],
        draws: [],
        webGLs: [],
        themes: [],
        vignettes: []
    };

    function ScreenHandler() {
        const instance = {
            width: 640,
            height: 360,
            baseWidth: 1280,
            baseHeight: 720,
            cssLeft: 11,
            cssTop: 12,
            cssWidth: 800,
            cssHeight: 450,
            init() {
                assert.equal(this, instance, 'ScreenHandler.init receiver');
                records.events.push('screen.init');
                return controls.screenInit(instance);
            },
            resize() {
                assert.equal(this, instance, 'ScreenHandler.resize receiver');
                records.events.push('screen.resize');
                records.screenResizeCalls.push(instance);
                return controls.screenResize(instance);
            }
        };
        instances.screens.push(instance);
        return instance;
    }

    function DrawHandler2D() {
        const instance = {
            registerLayer(id, layerContext, registerOptions) {
                assert.equal(this, instance, 'DrawHandler2D.registerLayer receiver');
                records.events.push(`draw.register:${id}`);
                records.drawLayers.push({ id, context: layerContext, options: registerOptions });
                return controls.drawRegister(id, layerContext, registerOptions, instance);
            },
            setLayerTransform(id, scaleX, scaleY) {
                assert.equal(this, instance, 'DrawHandler2D.setLayerTransform receiver');
                records.events.push(`draw.transform:${id}`);
                records.transforms.push({ id, scaleX, scaleY });
            },
            unregisterLayer() {},
            render() {},
            clearAll() {}
        };
        instances.draws.push(instance);
        return instance;
    }

    function WebGLHandler() {
        const instance = {
            registerLayer(id, layerContext, registerOptions) {
                assert.equal(this, instance, 'WebGLHandler.registerLayer receiver');
                records.events.push(`webgl.register:${id}`);
                records.webGLLayers.push({ id, context: layerContext, options: registerOptions });
                return controls.webGLRegister(id, layerContext, registerOptions, instance);
            },
            setBackgroundColor(r, g, b) {
                assert.equal(this, instance, 'WebGLHandler.setBackgroundColor receiver');
                records.events.push('webgl.background');
                records.backgroundColors.push([r, g, b]);
                return controls.setBackgroundColor(r, g, b, instance);
            },
            resize(width, height) {
                assert.equal(this, instance, 'WebGLHandler.resize receiver');
                records.events.push('webgl.resize');
                records.webGLResizeCalls.push([width, height]);
            },
            unregisterLayer() {},
            markDirty() {},
            render() {}
        };
        instances.webGLs.push(instance);
        return instance;
    }

    function ThemeHandler() {
        const instance = {
            init() {
                assert.equal(this, instance, 'ThemeHandler.init receiver');
                records.events.push('theme.init');
                return controls.themeInit(instance);
            }
        };
        instances.themes.push(instance);
        return instance;
    }

    function CanvasSurfacePool(type) {
        return {
            type,
            acquire() {
                throw new Error('init 테스트에서 pool.acquire를 호출하면 안 됩니다.');
            },
            release() {},
            warmUp() {},
            getStats() {
                return { createdCount: 0, availableCount: 0 };
            }
        };
    }

    function VignetteRenderer() {
        const instance = {
            resize(width, height) {
                assert.equal(this, instance, 'VignetteRenderer.resize receiver');
                records.events.push('vignette.resize');
                records.vignetteResizeCalls.push([width, height]);
            },
            draw() {}
        };
        instances.vignettes.push(instance);
        return instance;
    }

    function WebGpuPlatformService(serviceOptions) {
        const webGpuContext = { id: 'gpu-object:webgpu' };
        const port = { id: 'webgpu-port' };
        const instance = {
            options: serviceOptions,
            state: {
                status: 'idle',
                reason: 'not-initialized',
                ready: false,
                deviceGeneration: 0
            },
            init() {
                assert.equal(this, instance, 'WebGpuPlatformService.init receiver');
                records.events.push('webgpu.init');
                return Promise.resolve(controls.webGpuInit(instance)).then((state) => {
                    instance.state = state;
                    serviceOptions.onCanvasCleared?.();
                    serviceOptions.onStateChange?.(state);
                    return state;
                });
            },
            getCanvasContext() {
                return instance.state.ready ? webGpuContext : null;
            },
            getPort() {
                return port;
            },
            getState() {
                return instance.state;
            },
            attachFrameComposer(composerPort) {
                instance.frameComposerPort = composerPort;
                records.events.push('webgpu.composer.attach');
                return true;
            },
            resize(width, height) {
                records.events.push(`webgpu.resize:${width}:${height}`);
                return true;
            },
            destroy() {}
        };
        records.events.push('webgpu.construct');
        records.webGpuServices.push(instance);
        return instance;
    }

    function WebGpuFrameComposer(platformPort) {
        const contributorPort = { id: 'webgpu-frame-composer-port' };
        const instance = {
            platformPort,
            active: false,
            beginFrameIds: [],
            commitCount: 0,
            abortReasons: [],
            getPort() {
                return contributorPort;
            },
            beginFrame(frameId) {
                instance.beginFrameIds.push(frameId);
                if (instance.active) return false;
                instance.active = true;
                return true;
            },
            isFrameActive() {
                return instance.active;
            },
            commit() {
                if (!instance.active) return false;
                instance.active = false;
                instance.commitCount += 1;
                return true;
            },
            abort(reason) {
                if (!instance.active) return false;
                instance.active = false;
                instance.abortReasons.push(reason);
                return true;
            }
        };
        records.events.push('webgpu.composer.construct');
        records.webGpuComposers.push(instance);
        return instance;
    }

    function WebGpuBlurService(serviceOptions) {
        const blurPort = { id: 'webgpu-blur-port' };
        const instance = {
            options: serviceOptions,
            getPort() {
                return blurPort;
            },
            destroy() {}
        };
        records.events.push('webgpu.blur.construct');
        records.webGpuBlurServices.push(instance);
        return instance;
    }

    const WEBGPU_KAWASE_BLUR_ALGORITHM_ID = 'kawase-compatibility';
    function createWebGpuKawaseBlurAlgorithmFactory(factoryOptions) {
        const factory = ({ device, deviceGeneration }) => ({
            device,
            deviceGeneration,
            prepare() {},
            encode() {},
            destroy() {}
        });
        records.events.push('webgpu.kawase.factory');
        records.webGpuKawaseFactories.push({ options: factoryOptions, factory });
        return factory;
    }

    const dependencies = new Map();
    const addDependency = (specifier, exports) => {
        dependencies.set(specifier, createSyntheticModule(context, specifier, exports));
    };
    addDependency('./_screen_handler.js', { ScreenHandler });
    addDependency('./_draw_handler_2d.js', { DrawHandler2D });
    addDependency('./webgl/_webgl_handler.js', { WebGLHandler });
    addDependency('display/_theme_handler.js', {
        ColorSchemes: colorSchemes,
        ThemeHandler,
        setTheme(value) {
            records.events.push(`setTheme:${String(value)}`);
            return controls.setTheme(value);
        }
    });
    addDependency('util/color_util.js', {
        colorUtil() {
            records.events.push('colorUtil');
            return controls.colorUtil();
        }
    });
    addDependency('save/save_system.js', {
        getSetting(key) {
            records.events.push(`getSetting:${String(key)}`);
            return controls.getSetting(key);
        }
    });
    addDependency('./_surface_pool.js', { CanvasSurfacePool });
    addDependency('./_vignette_renderer.js', { VignetteRenderer });
    addDependency('./_theme_transition_controller.js', {
        ThemeTransitionController: class ThemeTransitionController {}
    });

    const descriptorModule = new vm.SourceTextModule(displayDescriptorSource, {
        context,
        identifier: DISPLAY_DESCRIPTOR_PATH
    });
    dependencies.set('./display_surface_descriptor.js', descriptorModule);
    const webGpuPlatformModule = createSyntheticModule(
        context,
        './webgpu/webgpu_platform_service.js',
        { WebGpuPlatformService }
    );
    await webGpuPlatformModule.link(() => {
        throw new Error('WebGPU synthetic module에는 import가 없어야 합니다.');
    });
    await webGpuPlatformModule.evaluate();
    const webGpuFrameComposerModule = createSyntheticModule(
        context,
        './webgpu/webgpu_frame_composer.js',
        { WebGpuFrameComposer }
    );
    await webGpuFrameComposerModule.link(() => {
        throw new Error('WebGPU frame composer synthetic module에는 import가 없어야 합니다.');
    });
    await webGpuFrameComposerModule.evaluate();
    const webGpuBlurServiceModule = createSyntheticModule(
        context,
        './webgpu/webgpu_blur_service.js',
        { WebGpuBlurService }
    );
    await webGpuBlurServiceModule.link(() => {
        throw new Error('WebGPU blur service synthetic module에는 import가 없어야 합니다.');
    });
    await webGpuBlurServiceModule.evaluate();
    const webGpuKawaseModule = createSyntheticModule(
        context,
        './webgpu/webgpu_kawase_blur_algorithm.js',
        {
            WEBGPU_KAWASE_BLUR_ALGORITHM_ID,
            createWebGpuKawaseBlurAlgorithmFactory
        }
    );
    await webGpuKawaseModule.link(() => {
        throw new Error('WebGPU Kawase synthetic module에는 import가 없어야 합니다.');
    });
    await webGpuKawaseModule.evaluate();
    const dynamicModules = new Map([
        ['./webgpu/webgpu_platform_service.js', webGpuPlatformModule],
        ['./webgpu/webgpu_frame_composer.js', webGpuFrameComposerModule],
        ['./webgpu/webgpu_blur_service.js', webGpuBlurServiceModule],
        ['./webgpu/webgpu_kawase_blur_algorithm.js', webGpuKawaseModule]
    ]);
    const module = new vm.SourceTextModule(displaySystemSource, {
        context,
        identifier: DISPLAY_SYSTEM_PATH,
        importModuleDynamically(specifier) {
            const dynamicModule = dynamicModules.get(specifier);
            assert.ok(dynamicModule, `지원하지 않는 DisplaySystem dynamic import입니다: ${specifier}`);
            return dynamicModule;
        }
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 DisplaySystem import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();

    return {
        namespace: module.namespace,
        context,
        records,
        controls,
        colorSchemes,
        overlayHost,
        canvases,
        documentObject,
        instances
    };
}

/**
 * 실제 SystemHandler를 display init gate와 시스템 대역으로 로드합니다.
 * @param {{promise:Promise<unknown>}} displayGate - Display init 완료 gate입니다.
 * @param {string[]} events - 생성·초기화 순서 기록입니다.
 * @returns {Promise<object>} production SystemHandler namespace입니다.
 */
async function loadSystemHandler(displayGate, events) {
    const context = vm.createContext({ console, performance });
    const makeSystemClass = (name, configure = () => {}) => class {
        constructor() {
            events.push(`construct:${name}`);
            configure(this);
        }

        async init() {
            events.push(`init:${name}`);
        }
    };
    const SaveSystem = makeSystemClass('SaveSystem', (instance) => {
        instance.getSetting = () => false;
    });
    const SoundSystem = makeSystemClass('SoundSystem');
    class DisplaySystem {
        constructor() {
            events.push('construct:DisplaySystem');
            this.screenHandler = {
                width: 1920,
                height: 1080,
                objectHeight: 1080,
                objectOffsetY: 0,
                uiWidth: 1920,
                uiOffsetX: 0
            };
            this.warmupCanvasPools = () => events.push('warmup:DisplaySystem');
            this.initializeThemeTransition = () => events.push('themeTransition:DisplaySystem');
        }

        async init() {
            events.push('init:DisplaySystem');
            await displayGate.promise;
            events.push('settle:DisplaySystem');
        }
    }
    const AnimationSystem = makeSystemClass('AnimationSystem', (instance) => {
        instance.warmup = async () => events.push('warmup:AnimationSystem');
    });
    const InputSystem = makeSystemClass('InputSystem', (instance) => {
        instance.getSimulationInputSnapshot = () => events.push('snapshot:InputSystem');
    });
    const UISystem = makeSystemClass('UISystem');
    const ObjectSystem = makeSystemClass('ObjectSystem');
    const SceneSystem = makeSystemClass('SceneSystem');
    const OverlayManager = makeSystemClass('OverlayManager');
    const DebugSystem = makeSystemClass('DebugSystem');

    const dependencies = new Map();
    const addDependency = (specifier, exports) => {
        dependencies.set(specifier, createSyntheticModule(context, specifier, exports));
    };
    addDependency('save/save_system.js', { SaveSystem });
    addDependency('display/display_system.js', { DisplaySystem });
    addDependency('animation/animation_system.js', { AnimationSystem });
    addDependency('input/input_system.js', { InputSystem });
    addDependency('object/object_system.js', { ObjectSystem });
    addDependency('scene/scene_system.js', { SceneSystem });
    addDependency('ui/ui_system.js', { UISystem });
    addDependency('overlay/overlay_system.js', { OverlayManager });
    addDependency('debug/debug_system.js', {
        DebugSystem,
        beginPerformanceSection: () => 0,
        endPerformanceSection() {}
    });
    addDependency('sound/sound_system.js', { SoundSystem });
    addDependency('game/time_handler.js', { getTimeHandler: () => null });
    addDependency('ui/_ui_pool.js', {
        warmupUIPools: () => events.push('warmup:UISystem')
    });
    addDependency('simulation/simulation_command_queue.js', {
        drainSimulationCommands: () => []
    });
    addDependency('simulation/simulation_runtime.js', {
        syncSimulationRuntime: () => events.push('sync:simulation')
    });
    addDependency('simulation/release_simulation_profiler.js', {
        isReleaseSimulationProfilerCollecting: () => false,
        recordReleaseSimulationFixedStep() {},
        shouldRecordReleaseSimulationForFrameMode: () => false
    });
    addDependency('debug/_release_simulation_profiler_hud.js', {
        drawReleaseSimulationProfilerHud() {}
    });

    const module = new vm.SourceTextModule(systemHandlerSource, {
        context,
        identifier: SYSTEM_HANDLER_PATH
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 SystemHandler import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace;
}

test('DisplaySystem은 코드-local descriptor 상수를 사용하고 중앙 data registry에 의존하지 않는다', () => {
    assert.equal(hashExecutableSource(displaySystemSource, 67), EXECUTABLE_SOURCE_HASH);
    assert.doesNotMatch(displaySystemSource, /data\/data_handler\.js/);
    assert.doesNotMatch(displayDescriptorSource, /data\/data_handler\.js/);
    assert.match(displaySystemSource, /DISPLAY_WEBGL_RENDER_MODES/);
    assert.match(
        displayDescriptorSource,
        /export const DISPLAY_WEBGL_RENDER_MODES = Object\.freeze\(\{/
    );
});

test('init JSDoc은 순서·live·Promise·부분 상태 계약을 정확히 명시한다', () => {
    const initDoc = findLeadingJsDoc('async init\\(\\) \\{');
    assert.match(initDoc, /themeHandler\.init\(\).*이행.*테마.*surface/s);
    assert.match(initDoc, /background.*gpu-object.*object.*effect.*texteffect.*ui.*vignette.*top.*순서/s);
    assert.match(initDoc, /ColorSchemes\.Background.*첫.*truthy.*다시.*두 번.*r.*g.*b.*clamp.*않/s);
    assert.match(initDoc, /screenHandler\.init\(\).*이행.*surfaceMap\.values\(\).*live/s);
    assert.match(initDoc, /resize\(\).*live receiver.*반환값.*기다리지.*버리/s);
    assert.match(initDoc, /WebGPU.*한 번.*동적 로드.*non-fatal.*unsupported.*기존 초기화.*거부하지 않/s);
    assert.match(initDoc, /매 호출.*새 Promise.*중복.*재진입.*guard.*없/s);
    assert.match(initDoc, /rollback.*않.*부분 상태.*유지/s);
    assert.match(initDoc, /접근·호출.*하위 Promise 거부.*thenable.*첫 reject 사유.*첫 resolve\/reject.*호출 전.*throw.*동기 throw.*아니.*같은.*identity/s);
    assert.match(initDoc, /resolve\/reject.*처음.*호출.*뒤.*pending.*추가.*throw.*무시/s);
    assert.match(initDoc, /@returns \{Promise<void>\}.*undefined.*거부/s);
});

test('init은 두 await gate와 정적 surface·backing·resize 순서를 보존한다', async () => {
    const themeGate = createDeferred();
    const screenGate = createDeferred();
    const runtime = await loadDisplaySystem({
        colorSchemes: { Background: '#112233' },
        themeInit: () => themeGate.promise,
        screenInit: () => screenGate.promise
    });
    const display = new runtime.namespace.DisplaySystem();
    runtime.records.events.length = 0;

    const result = display.init();
    assert.notStrictEqual(result, themeGate.promise);
    assert.notStrictEqual(result, screenGate.promise);
    assert.deepEqual(runtime.records.events, ['theme.init']);
    assert.equal(display.surfaceMap.size, 0);

    themeGate.resolve({ ignored: 'theme value' });
    await flushUntil(
        () => runtime.records.events.includes('screen.init'),
        'screen init 진입'
    );
    const expectedEventsThroughScreenInit = [
        'theme.init',
        'getSetting:theme',
        'setTheme:dark',
        'element:overlaylayerhost',
        'element:background',
        'context:background:webgl',
        'webgl.register:background',
        'element:gpu-object',
        'element:object',
        'context:object:webgl',
        'webgl.register:object',
        'element:effect',
        'context:effect:webgl',
        'webgl.register:effect',
        'element:texteffect',
        'context:texteffect:2d',
        'draw.register:texteffect',
        'element:ui',
        'context:ui:2d',
        'draw.register:ui',
        'element:vignette',
        'context:vignette:2d',
        'draw.register:vignette',
        'element:top',
        'context:top:2d',
        'draw.register:top',
        'colorUtil',
        'webgl.background',
        'screen.init'
    ];
    assert.deepEqual(runtime.records.events, expectedEventsThroughScreenInit);
    assert.deepEqual([...display.staticSurfaceIds], STATIC_SURFACE_IDS);
    assert.deepEqual([...display.surfaceMap.keys()], STATIC_SURFACE_IDS);
    assert.equal(runtime.records.events.includes('screen.resize'), false);
    assert.equal(runtime.canvases.get('background').width, 0);

    screenGate.resolve({ ignored: 'screen value' });
    assert.equal(await result, undefined);
    assert.deepEqual(runtime.records.elementIds, ['overlaylayerhost', ...STATIC_SURFACE_IDS]);
    assert.deepEqual(runtime.records.webGLLayers.map(({ id }) => id), [
        'background',
        'object',
        'effect'
    ]);
    assert.deepEqual(runtime.records.drawLayers.map(({ id }) => id), [
        'texteffect',
        'ui',
        'vignette',
        'top'
    ]);

    const descriptors = [...display.surfaceMap.values()];
    assert.deepEqual(descriptors.map(({ id }) => id), STATIC_SURFACE_IDS);
    assert.deepEqual(descriptors.map(({ order }) => order), [0, 5, 10, 20, 30, 40, 50, 1000]);
    assert.deepEqual(descriptors.map(({ mode }) => mode), [
        'batch',
        'batch',
        'batch',
        'effect',
        'batch',
        'batch',
        'batch',
        'batch'
    ]);
    assert.deepEqual(descriptors.map(({ persistent }) => persistent), [
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false
    ]);
    assert.deepEqual(descriptors.map(({ includeInComposite }) => includeInComposite), [
        true,
        false,
        true,
        true,
        true,
        true,
        false,
        false
    ]);
    assert.deepEqual(descriptors.map(({ contentRevision }) => contentRevision), [1, 2, 3, 4, 5, 6, 7, 8]);

    assert.deepEqual(runtime.records.contexts, [
        {
            id: 'background',
            type: 'webgl',
            options: { alpha: false, preserveDrawingBuffer: false }
        },
        {
            id: 'object',
            type: 'webgl',
            options: { alpha: true, preserveDrawingBuffer: false }
        },
        {
            id: 'effect',
            type: 'webgl',
            options: { alpha: true, preserveDrawingBuffer: false }
        },
        { id: 'texteffect', type: '2d', options: undefined },
        { id: 'ui', type: '2d', options: undefined },
        { id: 'vignette', type: '2d', options: undefined },
        { id: 'top', type: '2d', options: undefined }
    ]);
    assert.deepEqual(runtime.records.backgroundColors, [[17 / 255, 34 / 255, 51 / 255]]);
    for (const id of ['background', 'object', 'effect']) {
        assert.equal(runtime.canvases.get(id).width, 640, `${id}.width`);
        assert.equal(runtime.canvases.get(id).height, 360, `${id}.height`);
    }
    assert.equal(runtime.canvases.get('gpu-object').width, 640);
    assert.equal(runtime.canvases.get('gpu-object').height, 360);
    assert.equal(display.getSurface('gpu-object').type, 'webgpu');
    assert.equal(display.getSurface('gpu-object').context.id, 'gpu-object:webgpu');
    assert.equal(display.getWebGpuPlatformPort().id, 'webgpu-port');
    assert.strictEqual(runtime.namespace.getWebGpuPlatformPort(), display.getWebGpuPlatformPort());
    assert.equal(display.getWebGpuPlatformState().ready, true);
    assert.deepEqual([...display.getAllCanvases()].map(({ id }) => id), STATIC_SURFACE_IDS);
    for (const id of ['texteffect', 'ui', 'vignette', 'top']) {
        assert.equal(runtime.canvases.get(id).width, 1280, `${id}.width`);
        assert.equal(runtime.canvases.get(id).height, 720, `${id}.height`);
    }
    assert.deepEqual(runtime.records.transforms, [
        { id: 'texteffect', scaleX: 2, scaleY: 2 },
        { id: 'ui', scaleX: 2, scaleY: 2 },
        { id: 'vignette', scaleX: 2, scaleY: 2 },
        { id: 'top', scaleX: 2, scaleY: 2 }
    ]);
    assert.deepEqual(runtime.records.webGLResizeCalls, [[640, 360]]);
    assert.deepEqual(runtime.records.vignetteResizeCalls, [[640, 360]]);
    assert.deepEqual(runtime.overlayHost.style, {
        left: '11px',
        top: '12px',
        width: '800px',
        height: '450px'
    });
    assert.deepEqual(runtime.records.events, [
        ...expectedEventsThroughScreenInit,
        'draw.transform:texteffect',
        'draw.transform:ui',
        'draw.transform:vignette',
        'draw.transform:top',
        'screen.resize',
        'webgl.resize',
        'vignette.resize',
        'webgpu.construct',
        'webgpu.composer.construct',
        'webgpu.composer.attach',
        'webgpu.kawase.factory',
        'webgpu.blur.construct',
        'webgpu.init'
    ]);

    const [webGpuService] = runtime.records.webGpuServices;
    const [webGpuComposer] = runtime.records.webGpuComposers;
    const [webGpuBlurService] = runtime.records.webGpuBlurServices;
    const [webGpuKawaseFactory] = runtime.records.webGpuKawaseFactories;
    assert.strictEqual(webGpuComposer.platformPort, webGpuService.getPort());
    assert.strictEqual(webGpuService.frameComposerPort, webGpuComposer.getPort());
    assert.strictEqual(webGpuKawaseFactory.options.composerPort, webGpuComposer.getPort());
    assert.strictEqual(webGpuBlurService.options.composerPort, webGpuComposer.getPort());
    assert.strictEqual(
        webGpuBlurService.options.algorithmFactories.get('kawase-compatibility'),
        webGpuKawaseFactory.factory
    );
    assert.equal(display.getWebGpuBlurPort().id, 'webgpu-blur-port');
    assert.strictEqual(runtime.namespace.getWebGpuBlurPort(), display.getWebGpuBlurPort());
    assert.equal(display.beginWebGpuFrame(), true);
    assert.equal(display.endWebGpuFrame(true), true);
    assert.equal(display.beginWebGpuFrame(), true);
    assert.equal(display.endWebGpuFrame(false), true);
    assert.deepEqual(webGpuComposer.beginFrameIds, [1, 2]);
    assert.equal(webGpuComposer.commitCount, 1);
    assert.deepEqual(webGpuComposer.abortReasons, ['presentation-incomplete']);
});

test('WebGPU canvas가 없는 harness에서도 기존 Display 초기화는 unsupported 상태로 완료된다', async () => {
    const runtime = await loadDisplaySystem({
        getElementById(id, fallback) {
            return id === 'gpu-object' ? null : fallback(id);
        },
        webGpuInit(instance) {
            assert.equal(instance.options.canvas, null);
            return {
                status: 'unsupported',
                reason: 'canvas-unavailable',
                ready: false,
                deviceGeneration: 0
            };
        }
    });
    const display = new runtime.namespace.DisplaySystem();

    assert.equal(await display.init(), undefined);
    assert.equal(display.getSurface('gpu-object'), null);
    assert.deepEqual([...display.surfaceMap.keys()], STATIC_SURFACE_IDS.filter(
        (surfaceId) => surfaceId !== 'gpu-object'
    ));
    assert.deepEqual(runtime.records.webGLLayers.map(({ id }) => id), [
        'background',
        'object',
        'effect'
    ]);
    assert.equal(display.getWebGpuPlatformState().status, 'unsupported');
    assert.equal(display.getWebGpuPlatformState().reason, 'canvas-unavailable');
    assert.equal(display.beginWebGpuFrame(), false);
});

test('Background 이중 조회와 RGB coercion·callee 캡처 순서를 보존한다', async () => {
    const trace = [];
    let backgroundReadCount = 0;
    const colorSchemes = {};
    Object.defineProperty(colorSchemes, 'Background', {
        configurable: true,
        get() {
            backgroundReadCount += 1;
            trace.push(`background.get:${backgroundReadCount}`);
            return backgroundReadCount === 1 ? '#guard' : '#argument';
        }
    });
    const runtime = await loadDisplaySystem({ colorSchemes });
    const display = new runtime.namespace.DisplaySystem();
    const originalHandler = display.webGLHandler;
    const rgb = {};
    const channelValues = {
        r: -255,
        g: Number.POSITIVE_INFINITY,
        b: Number.NaN
    };
    for (const channel of ['r', 'g', 'b']) {
        Object.defineProperty(rgb, channel, {
            get() {
                trace.push(`rgb.${channel}.get`);
                return {
                    [Symbol.toPrimitive](hint) {
                        trace.push(`rgb.${channel}.toPrimitive:${hint}`);
                        if (channel === 'r') {
                            display.webGLHandler = {
                                replaced: true,
                                resize() {}
                            };
                        }
                        return channelValues[channel];
                    }
                };
            }
        });
    }
    const util = {};
    Object.defineProperty(util, 'cssToRgb', {
        get() {
            trace.push('cssToRgb.get');
            return function cssToRgb(value) {
                assert.equal(this, util);
                trace.push(`cssToRgb.call:${value}`);
                return rgb;
            };
        }
    });
    runtime.controls.colorUtil = () => {
        trace.push('colorUtil.call');
        return util;
    };
    let capturedSetBackgroundColor;
    Object.defineProperty(originalHandler, 'setBackgroundColor', {
        configurable: true,
        get() {
            trace.push('setBackgroundColor.get');
            capturedSetBackgroundColor = function setBackgroundColor(r, g, b) {
                assert.equal(this, originalHandler);
                trace.push('setBackgroundColor.call');
                runtime.records.backgroundColors.push([r, g, b]);
            };
            return capturedSetBackgroundColor;
        }
    });

    await display.init();
    assert.deepEqual(trace, [
        'background.get:1',
        'colorUtil.call',
        'cssToRgb.get',
        'background.get:2',
        'cssToRgb.call:#argument',
        'setBackgroundColor.get',
        'rgb.r.get',
        'rgb.r.toPrimitive:number',
        'rgb.g.get',
        'rgb.g.toPrimitive:number',
        'rgb.b.get',
        'rgb.b.toPrimitive:number',
        'setBackgroundColor.call'
    ]);
    assert.strictEqual(display.webGLHandler.replaced, true);
    assert.equal(runtime.records.backgroundColors.length, 1);
    assert.ok(Object.is(runtime.records.backgroundColors[0][0], -1));
    assert.equal(runtime.records.backgroundColors[0][1], Number.POSITIVE_INFINITY);
    assert.ok(Number.isNaN(runtime.records.backgroundColors[0][2]));
});

test('Background 첫 조회가 falsy이면 한 번만 읽고 색상 의존성을 모두 건너뛴다', async () => {
    let backgroundReadCount = 0;
    let colorUtilCalls = 0;
    let backgroundSetterCalls = 0;
    const colorSchemes = {};
    Object.defineProperty(colorSchemes, 'Background', {
        get() {
            backgroundReadCount += 1;
            return 0;
        }
    });
    const runtime = await loadDisplaySystem({
        colorSchemes,
        colorUtil() {
            colorUtilCalls += 1;
            throw new Error('falsy guard 뒤 colorUtil을 호출하면 안 됩니다.');
        },
        setBackgroundColor() {
            backgroundSetterCalls += 1;
        }
    });

    await new runtime.namespace.DisplaySystem().init();
    assert.equal(backgroundReadCount, 1);
    assert.equal(colorUtilCalls, 0);
    assert.equal(backgroundSetterCalls, 0);
    assert.equal(runtime.records.events.includes('colorUtil'), false);
    assert.equal(runtime.records.events.includes('webgl.background'), false);
    assert.deepEqual(runtime.records.backgroundColors, []);
});

test('screen await 뒤 live screen·Map iterator와 resize 반환 폐기 계약을 보존한다', async () => {
    const screenGate = createDeferred();
    const runtime = await loadDisplaySystem({ screenInit: () => screenGate.promise });
    const display = new runtime.namespace.DisplaySystem();
    const firstScreen = display.screenHandler;
    const result = display.init();
    await flushUntil(
        () => runtime.records.events.includes('screen.init'),
        'screen gate 대기'
    );

    const secondScreen = {
        width: 9,
        height: 8,
        baseWidth: 18,
        baseHeight: 16
    };
    display.screenHandler = secondScreen;
    const visited = [];
    const iteratedMap = new Map();
    const replacementMap = new Map();
    let appended = false;
    const createTrackedCanvas = (label) => {
        let width = 0;
        let height = 0;
        return Object.defineProperties({}, {
            width: {
                get() { return width; },
                set(value) {
                    width = value;
                    visited.push(`${label}.width:${value}`);
                }
            },
            height: {
                get() { return height; },
                set(value) {
                    height = value;
                    visited.push(`${label}.height:${value}`);
                }
            }
        });
    };
    const skippedCanvas = createTrackedCanvas('skipped');
    const reinsertedCanvas = createTrackedCanvas('reinserted');
    const secondCanvas = createTrackedCanvas('late');
    const firstCanvas = { height: 0 };
    let firstWidth = 0;
    Object.defineProperty(firstCanvas, 'width', {
        get() {
            return firstWidth;
        },
        set(value) {
            firstWidth = value;
            visited.push(`first.width:${value}`);
            if (!appended) {
                appended = true;
                const reinsertedDescriptor = iteratedMap.get('reinserted');
                assert.equal(iteratedMap.delete('skipped'), true);
                assert.equal(iteratedMap.delete('reinserted'), true);
                iteratedMap.set('reinserted', reinsertedDescriptor);
                iteratedMap.set('late', {
                    id: 'late',
                    type: 'webgl',
                    dynamic: false,
                    forceBackingReset: false,
                    canvas: secondCanvas
                });
                display.surfaceMap = replacementMap;
            }
        }
    });
    Object.defineProperty(firstCanvas, 'height', {
        configurable: true,
        get() {
            return 0;
        },
        set(value) {
            visited.push(`first.height:${value}`);
        }
    });
    iteratedMap.set('first', {
        id: 'first',
        type: 'webgl',
        dynamic: false,
        forceBackingReset: false,
        canvas: firstCanvas
    });
    iteratedMap.set('skipped', {
        id: 'skipped',
        type: 'webgl',
        dynamic: false,
        forceBackingReset: false,
        canvas: skippedCanvas
    });
    iteratedMap.set('reinserted', {
        id: 'reinserted',
        type: 'webgl',
        dynamic: false,
        forceBackingReset: false,
        canvas: reinsertedCanvas
    });
    display.surfaceMap = iteratedMap;

    let resizeGetterCalls = 0;
    let resizeCalls = 0;
    let thenGetterCalls = 0;
    Object.defineProperty(display, 'resize', {
        configurable: true,
        get() {
            resizeGetterCalls += 1;
            return function resize() {
                assert.equal(this, display);
                resizeCalls += 1;
                return Object.defineProperty({}, 'then', {
                    get() {
                        thenGetterCalls += 1;
                        throw new Error('resize then getter must stay unread');
                    }
                });
            };
        }
    });

    screenGate.resolve();
    assert.equal(await result, undefined);
    assert.notStrictEqual(firstScreen, display.screenHandler);
    assert.strictEqual(display.screenHandler, secondScreen);
    assert.strictEqual(display.surfaceMap, replacementMap);
    assert.deepEqual(visited, [
        'first.width:9',
        'first.height:8',
        'reinserted.width:9',
        'reinserted.height:8',
        'late.width:9',
        'late.height:8'
    ]);
    assert.equal(skippedCanvas.width, 0);
    assert.equal(skippedCanvas.height, 0);
    assert.equal(reinsertedCanvas.width, 9);
    assert.equal(reinsertedCanvas.height, 8);
    assert.equal(secondCanvas.width, 9);
    assert.equal(secondCanvas.height, 8);
    assert.equal(resizeGetterCalls, 1);
    assert.equal(resizeCalls, 1);
    assert.equal(thenGetterCalls, 0);
});

test('theme 단계 접근·호출·thenable 오류는 동기 throw 없이 같은 identity로 reject한다', async () => {
    const scenarios = [
        {
            name: 'theme property getter',
            install(display, error) {
                Object.defineProperty(display, 'themeHandler', { get() { throw error; } });
            }
        },
        {
            name: 'theme init getter',
            install(display, error) {
                display.themeHandler = Object.defineProperty({}, 'init', {
                    get() { throw error; }
                });
            }
        },
        {
            name: 'theme init call',
            install(display, error) {
                display.themeHandler = { init() { throw error; } };
            }
        },
        {
            name: 'theme then getter',
            install(display, error) {
                display.themeHandler = {
                    init() {
                        return Object.defineProperty({}, 'then', { get() { throw error; } });
                    }
                };
            }
        },
        {
            name: 'theme then body',
            install(display, error) {
                display.themeHandler = { init() { return { then() { throw error; } }; } };
            }
        },
        {
            name: 'theme rejection',
            install(display, error) {
                display.themeHandler = { init() { return Promise.reject(error); } };
            }
        },
        {
            name: 'theme thenable first rejection',
            install(display, error) {
                const ignored = new Error('ignored theme post rejection');
                const thenable = {
                    then(resolve, reject) {
                        assert.strictEqual(this, thenable);
                        reject(error);
                        resolve('ignored theme resolution');
                        reject(ignored);
                        throw ignored;
                    }
                };
                display.themeHandler = { init() { return thenable; } };
            }
        }
    ];

    for (const scenario of scenarios) {
        const runtime = await loadDisplaySystem();
        const display = new runtime.namespace.DisplaySystem();
        const error = new Error(scenario.name);
        scenario.install(display, error);
        await assertAsyncSameError(() => display.init(), error);
        assert.equal(display.surfaceMap.size, 0, scenario.name);
        assert.deepEqual([...display.staticSurfaceIds], [], scenario.name);
        assert.deepEqual(runtime.records.elementIds, [], scenario.name);
    }
});

test('screen 단계 접근·호출·thenable 오류는 등록 상태를 보존하고 같은 identity로 reject한다', async () => {
    const scenarios = [
        {
            name: 'screen property getter',
            install(display, error) {
                Object.defineProperty(display, 'screenHandler', { get() { throw error; } });
            }
        },
        {
            name: 'screen init getter',
            install(display, error) {
                display.screenHandler = Object.defineProperty({}, 'init', {
                    get() { throw error; }
                });
            }
        },
        {
            name: 'screen init call',
            install(display, error) {
                display.screenHandler = { init() { throw error; } };
            }
        },
        {
            name: 'screen then getter',
            install(display, error) {
                display.screenHandler = {
                    init() {
                        return Object.defineProperty({}, 'then', { get() { throw error; } });
                    }
                };
            }
        },
        {
            name: 'screen then body',
            install(display, error) {
                display.screenHandler = { init() { return { then() { throw error; } }; } };
            }
        },
        {
            name: 'screen rejection',
            install(display, error) {
                display.screenHandler = { init() { return Promise.reject(error); } };
            }
        },
        {
            name: 'screen thenable first rejection',
            install(display, error) {
                const ignored = new Error('ignored screen post rejection');
                const thenable = {
                    then(resolve, reject) {
                        assert.strictEqual(this, thenable);
                        reject(error);
                        resolve('ignored screen resolution');
                        reject(ignored);
                        throw ignored;
                    }
                };
                display.screenHandler = { init() { return thenable; } };
            }
        }
    ];

    for (const scenario of scenarios) {
        const runtime = await loadDisplaySystem();
        const display = new runtime.namespace.DisplaySystem();
        const error = new Error(scenario.name);
        scenario.install(display, error);
        await assertAsyncSameError(() => display.init(), error);
        assert.deepEqual([...display.staticSurfaceIds], STATIC_SURFACE_IDS, scenario.name);
        assert.deepEqual([...display.surfaceMap.keys()], STATIC_SURFACE_IDS, scenario.name);
        assert.equal(runtime.canvases.get('background').width, 0, scenario.name);
        assert.equal(runtime.records.screenResizeCalls.length, 0, scenario.name);
    }
});

test('await thenable의 inner adoption과 하위 비await 반환값 폐기 계약을 보존한다', async () => {
    const themeInner = createDeferred();
    const screenInner = createDeferred();
    const postResolveThemeError = new Error('theme post resolve');
    const postResolveScreenError = new Error('screen post resolve');
    let ignoredThenGetterCalls = 0;
    const ignoredThenable = () => Object.defineProperty({}, 'then', {
        get() {
            ignoredThenGetterCalls += 1;
            throw new Error('non-awaited then getter must stay unread');
        }
    });
    const themeThenable = {
        then(resolve, reject) {
            assert.strictEqual(this, themeThenable);
            resolve(themeInner.promise);
            resolve('ignored second theme resolution');
            reject(postResolveThemeError);
            throw postResolveThemeError;
        }
    };
    const screenThenable = {
        then(resolve, reject) {
            assert.strictEqual(this, screenThenable);
            resolve(screenInner.promise);
            reject(postResolveScreenError);
            throw postResolveScreenError;
        }
    };
    const runtime = await loadDisplaySystem({
        themeInit: () => themeThenable,
        screenInit: () => screenThenable,
        drawRegister: () => ignoredThenable(),
        webGLRegister: () => ignoredThenable()
    });
    const display = new runtime.namespace.DisplaySystem();
    Object.defineProperty(display, 'resize', {
        configurable: true,
        value() {
            return ignoredThenable();
        }
    });

    const result = display.init();
    await Promise.resolve();
    assert.equal(display.surfaceMap.size, 0);
    themeInner.resolve('ignored theme');
    await flushUntil(
        () => runtime.records.events.includes('screen.init'),
        'adopted theme Promise 정착 뒤 screen 진입'
    );
    assert.equal(runtime.canvases.get('background').width, 0);
    screenInner.resolve('ignored screen');
    assert.equal(await result, undefined);
    assert.equal(ignoredThenGetterCalls, 0);
    assert.equal(
        await runtime.namespace.DisplaySystem.prototype.init.call(null).then(
            () => 'fulfilled',
            (error) => error?.name
        ),
        'TypeError'
    );
});

test('등록·backing·resize 오류는 이미 반영된 부분 상태를 rollback하지 않는다', async () => {
    {
        const error = new Error('ui register failure');
        const runtime = await loadDisplaySystem({
            drawRegister(id) {
                if (id === 'ui') throw error;
            }
        });
        const display = new runtime.namespace.DisplaySystem();
        await assertAsyncSameError(() => display.init(), error);
        assert.deepEqual([...display.staticSurfaceIds], [
            'background',
            'gpu-object',
            'object',
            'effect',
            'texteffect',
            'ui'
        ]);
        assert.deepEqual([...display.surfaceMap.keys()], [...display.staticSurfaceIds]);
        assert.equal(display.contentRevisionSerial, 6);
        assert.equal(runtime.records.events.includes('screen.init'), false);
    }

    {
        const error = new Error('texteffect backing failure');
        const runtime = await loadDisplaySystem();
        const canvas = runtime.canvases.get('texteffect');
        Object.defineProperty(canvas, 'width', {
            configurable: true,
            get() {
                return 0;
            },
            set() {
                throw error;
            }
        });
        const display = new runtime.namespace.DisplaySystem();
        await assertAsyncSameError(() => display.init(), error);
        assert.equal(runtime.canvases.get('background').width, 640);
        assert.equal(runtime.canvases.get('object').width, 640);
        assert.equal(runtime.canvases.get('effect').width, 640);
        assert.equal(runtime.canvases.get('texteffect').height, 0);
        assert.equal(runtime.records.screenResizeCalls.length, 0);
    }

    {
        const error = new Error('resize failure');
        const runtime = await loadDisplaySystem();
        const display = new runtime.namespace.DisplaySystem();
        display.resize = function resize() {
            assert.equal(this, display);
            throw error;
        };
        await assertAsyncSameError(() => display.init(), error);
        for (const id of STATIC_SURFACE_IDS) {
            assert.ok(runtime.canvases.get(id).width > 0, `${id} backing은 유지되어야 합니다.`);
        }
    }
});

test('동시 init은 등록을 중복하고 두 Promise가 같은 최종 Map을 각각 동기화한다', async () => {
    const screenGate = createDeferred();
    const runtime = await loadDisplaySystem({ screenInit: () => screenGate.promise });
    const display = new runtime.namespace.DisplaySystem();
    const first = display.init();
    await flushUntil(
        () => runtime.records.events.filter((event) => event === 'screen.init').length === 1,
        '첫 screen init'
    );
    const second = display.init();
    await flushUntil(
        () => runtime.records.events.filter((event) => event === 'screen.init').length === 2,
        '둘째 screen init'
    );
    assert.notStrictEqual(first, second);
    assert.equal(display.surfaceMap.size, 8);
    assert.equal(display.staticSurfaceIds.length, 16);
    assert.equal(display.contentRevisionSerial, 16);
    assert.deepEqual(
        [...display.surfaceMap.values()].map(({ contentRevision }) => contentRevision),
        [9, 10, 11, 12, 13, 14, 15, 16]
    );
    assert.equal(runtime.records.webGLLayers.length, 6);
    assert.equal(runtime.records.drawLayers.length, 8);

    const finalDescriptorSyncReads = [];
    const finalDescriptorSyncWrites = [];
    for (const descriptor of display.surfaceMap.values()) {
        const marker = `${descriptor.id}:${descriptor.contentRevision}`;
        Object.defineProperty(descriptor, 'forceBackingReset', {
            configurable: true,
            get() {
                finalDescriptorSyncReads.push(marker);
                return false;
            },
            set(value) {
                finalDescriptorSyncWrites.push(`${marker}:${String(value)}`);
            }
        });
    }

    screenGate.resolve();
    assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
    const finalDescriptorMarkers = [
        'background:9',
        'gpu-object:10',
        'object:11',
        'effect:12',
        'texteffect:13',
        'ui:14',
        'vignette:15',
        'top:16'
    ];
    assert.deepEqual(finalDescriptorSyncReads, [
        ...finalDescriptorMarkers,
        ...finalDescriptorMarkers
    ]);
    assert.deepEqual(finalDescriptorSyncWrites, [
        ...finalDescriptorMarkers.map((marker) => `${marker}:false`),
        ...finalDescriptorMarkers.map((marker) => `${marker}:false`)
    ]);
    assert.equal(runtime.records.transforms.length, 8);
    assert.equal(runtime.records.screenResizeCalls.length, 2);
    assert.equal(runtime.records.webGLResizeCalls.length, 2);
    assert.equal(runtime.records.vignetteResizeCalls.length, 2);
    assert.equal(runtime.records.webGpuServices.length, 1);
    assert.equal(runtime.records.webGpuComposers.length, 1);
    assert.equal(runtime.records.webGpuBlurServices.length, 1);
    assert.equal(runtime.records.webGpuKawaseFactories.length, 1);
});

test('SystemHandler는 Display init 정착 전 로그와 AnimationSystem 단계로 진행하지 않는다', async () => {
    {
        const displayGate = createDeferred();
        const events = [];
        const namespace = await loadSystemHandler(displayGate, events);
        const handler = new namespace.SystemHandler();
        handler.logDebugInfo = (label) => events.push(`log:${label}`);
        const result = handler.init();
        await flushUntil(
            () => events.includes('init:DisplaySystem'),
            'SystemHandler Display init 진입'
        );
        assert.equal(events.includes('log:DisplaySystem 로드'), false);
        assert.equal(events.includes('construct:AnimationSystem'), false);

        displayGate.resolve();
        await result;
        const settleIndex = events.indexOf('settle:DisplaySystem');
        const logIndex = events.indexOf('log:DisplaySystem 로드');
        const animationConstructIndex = events.indexOf('construct:AnimationSystem');
        const animationInitIndex = events.indexOf('init:AnimationSystem');
        assert.ok(settleIndex < logIndex);
        assert.ok(logIndex < animationConstructIndex);
        assert.ok(animationConstructIndex < animationInitIndex);
    }

    {
        const displayGate = createDeferred();
        const events = [];
        const namespace = await loadSystemHandler(displayGate, events);
        const handler = new namespace.SystemHandler();
        handler.logDebugInfo = (label) => events.push(`log:${label}`);
        const error = new Error('display gate rejection');
        const result = handler.init();
        await flushUntil(
            () => events.includes('init:DisplaySystem'),
            'SystemHandler reject Display init 진입'
        );
        displayGate.reject(error);
        await assert.rejects(result, (received) => received === error);
        assert.equal(events.includes('log:DisplaySystem 로드'), false);
        assert.equal(events.includes('construct:AnimationSystem'), false);
        assert.ok(handler.displaySystem);
        assert.ok(Object.hasOwn(handler, 'loadTime'));
    }
});
