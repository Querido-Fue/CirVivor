import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const UI_SYSTEM_PATH = fileURLToPath(new URL(
    '../script/module/ui/ui_system.js',
    import.meta.url
));
const SYSTEM_HANDLER_PATH = fileURLToPath(new URL(
    '../script/module/system_handler.js',
    import.meta.url
));
const [uiSystemSource, systemHandlerSource] = await Promise.all([
    readFile(UI_SYSTEM_PATH, 'utf8'),
    readFile(SYSTEM_HANDLER_PATH, 'utf8')
]);
const EXECUTABLE_SOURCE_HASH = '75b73fa1387573634ca1c26941b1647b97cc401a78bc103907863a449da472a5';

/**
 * 독립된 줄의 JSDoc과 종결 개행을 제거한 production 실행 소스를 해시합니다.
 * @param {string} source - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(source) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
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
    const match = uiSystemSource.match(
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
 * 실제 production UISystem 모듈을 최소 synthetic dependency와 함께 로드합니다.
 * @param {object} [options={}] - 생성자별 테스트 factory입니다.
 * @param {Function} [options.cursorFactory] - cursor factory입니다.
 * @param {Function} [options.languageFactory] - language handler factory입니다.
 * @param {Function} [options.tooltipFactory] - tooltip factory입니다.
 * @returns {Promise<object>} production 모듈 namespace입니다.
 */
async function loadUiSystem({
    cursorFactory = () => ({}),
    languageFactory = () => ({}),
    tooltipFactory = () => ({})
} = {}) {
    const context = vm.createContext({ console });
    function UICursor(owner) {
        return cursorFactory(owner);
    }
    function LanguageHandler(owner) {
        return languageFactory(owner);
    }
    function UITooltipSystem() {
        return tooltipFactory();
    }
    const dependencies = new Map([
        ['./cursor/ui_cursor.js', createSyntheticModule(context, 'ui_cursor.js', { UICursor })],
        ['./lang/_language_handler.js', createSyntheticModule(context, '_language_handler.js', { LanguageHandler })],
        ['./layout/_positioning_handler.js', createSyntheticModule(context, '_positioning_handler.js', {
            parseUIData(value) {
                return value;
            }
        })],
        ['./tooltip/ui_tooltip.js', createSyntheticModule(context, 'ui_tooltip.js', { UITooltipSystem })]
    ]);
    const module = new vm.SourceTextModule(uiSystemSource, {
        context,
        identifier: UI_SYSTEM_PATH
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 UISystem import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace;
}

/**
 * 함수 호출이 동기 throw 없이 같은 오류 identity로 reject하는지 검증합니다.
 * @param {Function} invoke - Promise 반환 호출입니다.
 * @param {Error} expectedError - 기대 오류입니다.
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
 * 실제 SystemHandler를 init 의존성 stub과 함께 로드합니다.
 * @param {{promise:Promise<unknown>}} uiGate - UI init 완료 gate입니다.
 * @param {string[]} events - 생성·초기화 순서 기록입니다.
 * @returns {Promise<object>} production SystemHandler namespace입니다.
 */
async function loadSystemHandler(uiGate, events) {
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
    const DisplaySystem = makeSystemClass('DisplaySystem', (instance) => {
        instance.screenHandler = {
            width: 1920,
            height: 1080,
            objectHeight: 1080,
            objectOffsetY: 0,
            uiWidth: 1920,
            uiOffsetX: 0
        };
        instance.warmupCanvasPools = () => events.push('warmup:DisplaySystem');
    });
    const AnimationSystem = makeSystemClass('AnimationSystem', (instance) => {
        instance.warmup = async () => events.push('warmup:AnimationSystem');
    });
    const InputSystem = makeSystemClass('InputSystem', (instance) => {
        instance.getSimulationInputSnapshot = () => events.push('snapshot:InputSystem');
    });
    const ObjectSystem = makeSystemClass('ObjectSystem');
    const SceneSystem = makeSystemClass('SceneSystem');
    const OverlayManager = makeSystemClass('OverlayManager');
    const DebugSystem = makeSystemClass('DebugSystem');
    class UISystem {
        constructor() {
            events.push('construct:UISystem');
        }

        async init() {
            events.push('init:UISystem');
            await uiGate.promise;
        }
    }

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
    addDependency('data/data_handler.js', {
        getData(key) {
            if (key === 'GLOBAL_CONSTANTS') {
                return { POOL_WARMUP: { CANVAS_2D: 0, CANVAS_WEBGL: 0 } };
            }
            if (key === 'SYSTEM_RUNTIME_POLICY_DATA') {
                return {
                    DISPLAY_REFRESH_SETTING_KEYS: [],
                    SIMULATION_RUNTIME_SETTING_KEYS: [],
                    DEFAULT_FRAME_EXECUTION_POLICY: {},
                    FRAME_EXECUTION_DISABLE_KEYS: []
                };
            }
            throw new Error(`지원하지 않는 SystemHandler data key입니다: ${key}`);
        }
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

test('UISystem JSDoc 변경은 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(uiSystemSource), EXECUTABLE_SOURCE_HASH);
});

test('init JSDoc은 순차·live·Promise·오류 계약을 정확히 명시한다', () => {
    const initDoc = findLeadingJsDoc('async init\\(\\) \\{');
    assert.match(initDoc, /cursor\.init\(\).*이행.*tooltip\.init\(\).*순차/);
    assert.match(initDoc, /매 호출.*다시 실행/);
    assert.match(initDoc, /첫 await.*tooltip.*교체.*live 객체/);
    assert.match(initDoc, /하위 반환값.*버리/);
    assert.match(initDoc, /접근·호출 예외.*첫 settlement 전 thenable 예외.*하위 거부/);
    assert.match(initDoc, /호출 자체의 동기 throw.*아니/);
    assert.match(initDoc, /첫 settlement 뒤 결과.*무시/);
    assert.match(initDoc, /@returns \{Promise<void>\}/);
    assert.match(initDoc, /호출별 새 Promise/);
});

test('init은 cursor 이행 뒤 tooltip을 호출하고 하위 값을 버려 undefined로 이행한다', async () => {
    const namespace = await loadUiSystem();
    const ui = new namespace.UISystem();
    const cursorGate = createDeferred();
    const tooltipGate = createDeferred();
    const events = [];
    const cursor = {
        init() {
            assert.equal(this, cursor);
            events.push('cursor');
            return cursorGate.promise;
        }
    };
    const tooltip = {
        init() {
            assert.equal(this, tooltip);
            events.push('tooltip');
            return tooltipGate.promise;
        }
    };
    ui.cursor = cursor;
    ui.tooltip = tooltip;

    const result = ui.init();
    assert.notStrictEqual(result, cursorGate.promise);
    assert.notStrictEqual(result, tooltipGate.promise);
    assert.deepEqual(events, ['cursor']);

    cursorGate.resolve({ ignored: 'cursor value' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['cursor', 'tooltip']);
    tooltipGate.resolve({ ignored: 'tooltip value' });
    assert.equal(await result, undefined);
});

test('init은 각 프로퍼티를 한 번씩 live 조회하고 원래 receiver로 호출한다', async () => {
    const namespace = await loadUiSystem();
    const ui = new namespace.UISystem();
    const cursorGate = createDeferred();
    const trace = [];
    const cursor = {};
    const tooltip = {};
    Object.defineProperty(cursor, 'init', {
        get() {
            trace.push('cursor.init:get');
            return function cursorInit() {
                assert.equal(this, cursor);
                trace.push('cursor.init:call');
                return cursorGate.promise;
            };
        }
    });
    Object.defineProperty(tooltip, 'init', {
        get() {
            trace.push('tooltip.init:get');
            return function tooltipInit() {
                assert.equal(this, tooltip);
                trace.push('tooltip.init:call');
            };
        }
    });
    Object.defineProperty(ui, 'cursor', {
        configurable: true,
        get() {
            trace.push('ui.cursor:get');
            return cursor;
        }
    });
    Object.defineProperty(ui, 'tooltip', {
        configurable: true,
        get() {
            trace.push('ui.tooltip:get');
            return tooltip;
        }
    });

    const result = ui.init();
    assert.deepEqual(trace, ['ui.cursor:get', 'cursor.init:get', 'cursor.init:call']);
    cursorGate.resolve();
    await result;
    assert.deepEqual(trace, [
        'ui.cursor:get',
        'cursor.init:get',
        'cursor.init:call',
        'ui.tooltip:get',
        'tooltip.init:get',
        'tooltip.init:call'
    ]);
});

test('cursor 단계 접근·호출·thenable 오류는 같은 identity로 reject하고 tooltip을 건너뛴다', async () => {
    const namespace = await loadUiSystem();
    const scenarios = [
        {
            name: 'cursor property getter',
            install(ui, error) {
                Object.defineProperty(ui, 'cursor', { get() { throw error; } });
            }
        },
        {
            name: 'cursor init getter',
            install(ui, error) {
                ui.cursor = Object.defineProperty({}, 'init', { get() { throw error; } });
            }
        },
        {
            name: 'cursor init call',
            install(ui, error) {
                ui.cursor = { init() { throw error; } };
            }
        },
        {
            name: 'cursor then getter',
            install(ui, error) {
                ui.cursor = {
                    init() {
                        return Object.defineProperty({}, 'then', { get() { throw error; } });
                    }
                };
            }
        },
        {
            name: 'cursor then body throw before settlement',
            install(ui, error) {
                ui.cursor = {
                    init() {
                        return { then() { throw error; } };
                    }
                };
            }
        },
        {
            name: 'cursor thenable rejection',
            install(ui, error) {
                ui.cursor = {
                    init() {
                        return { then(resolve, reject) { reject(error); } };
                    }
                };
            }
        },
        {
            name: 'cursor native Promise rejection',
            install(ui, error) {
                ui.cursor = { init() { return Promise.reject(error); } };
            }
        }
    ];

    for (const scenario of scenarios) {
        const ui = new namespace.UISystem();
        let tooltipCalls = 0;
        ui.tooltip = { init() { tooltipCalls += 1; } };
        const error = new Error(scenario.name);
        scenario.install(ui, error);
        await assertAsyncSameError(() => ui.init(), error);
        assert.equal(tooltipCalls, 0, scenario.name);
    }
});

test('tooltip 단계 접근·호출·thenable 오류는 cursor 성공 뒤 같은 identity로 reject한다', async () => {
    const namespace = await loadUiSystem();
    const scenarios = [
        {
            name: 'tooltip property getter',
            install(ui, error) {
                Object.defineProperty(ui, 'tooltip', { get() { throw error; } });
            }
        },
        {
            name: 'tooltip init getter',
            install(ui, error) {
                ui.tooltip = Object.defineProperty({}, 'init', { get() { throw error; } });
            }
        },
        {
            name: 'tooltip init call',
            install(ui, error) {
                ui.tooltip = { init() { throw error; } };
            }
        },
        {
            name: 'tooltip then getter',
            install(ui, error) {
                ui.tooltip = {
                    init() {
                        return Object.defineProperty({}, 'then', { get() { throw error; } });
                    }
                };
            }
        },
        {
            name: 'tooltip then body throw before settlement',
            install(ui, error) {
                ui.tooltip = {
                    init() {
                        return { then() { throw error; } };
                    }
                };
            }
        },
        {
            name: 'tooltip thenable rejection',
            install(ui, error) {
                ui.tooltip = {
                    init() {
                        return { then(resolve, reject) { reject(error); } };
                    }
                };
            }
        },
        {
            name: 'tooltip native Promise rejection',
            install(ui, error) {
                ui.tooltip = { init() { return Promise.reject(error); } };
            }
        }
    ];

    for (const scenario of scenarios) {
        const ui = new namespace.UISystem();
        let cursorCalls = 0;
        ui.cursor = { init() { cursorCalls += 1; } };
        const error = new Error(scenario.name);
        scenario.install(ui, error);
        await assertAsyncSameError(() => ui.init(), error);
        assert.equal(cursorCalls, 1, scenario.name);
    }
});

test('thenable의 첫 resolve 뒤 throw는 두 단계 모두 무시되고 undefined로 이행한다', async () => {
    const namespace = await loadUiSystem();
    const ui = new namespace.UISystem();
    const cursorAfterResolveError = new Error('cursor throw after resolve');
    const tooltipAfterResolveError = new Error('tooltip throw after resolve');
    let cursorThenCalls = 0;
    let tooltipThenCalls = 0;
    ui.cursor = {
        init() {
            return {
                then(resolve) {
                    cursorThenCalls += 1;
                    resolve('ignored cursor value');
                    throw cursorAfterResolveError;
                }
            };
        }
    };
    ui.tooltip = {
        init() {
            return {
                then(resolve) {
                    tooltipThenCalls += 1;
                    resolve('ignored tooltip value');
                    throw tooltipAfterResolveError;
                }
            };
        }
    };

    assert.equal(await ui.init(), undefined);
    assert.equal(cursorThenCalls, 1);
    assert.equal(tooltipThenCalls, 1);
});

test('첫 await 중 tooltip 교체와 동시 호출을 보존하며 중복 실행 guard가 없다', async () => {
    const namespace = await loadUiSystem();
    const ui = new namespace.UISystem();
    const cursorGate = createDeferred();
    let cursorCalls = 0;
    let oldTooltipCalls = 0;
    let newTooltipCalls = 0;
    ui.cursor = {
        init() {
            cursorCalls += 1;
            return cursorGate.promise;
        }
    };
    ui.tooltip = { init() { oldTooltipCalls += 1; } };

    const first = ui.init();
    const second = ui.init();
    assert.notStrictEqual(first, second);
    assert.equal(cursorCalls, 2);
    ui.tooltip = { init() { newTooltipCalls += 1; } };
    cursorGate.resolve();
    await Promise.all([first, second]);
    assert.equal(oldTooltipCalls, 0);
    assert.equal(newTooltipCalls, 2);
});

test('cursor 재진입은 두 독립 순회를 만들고 잘못된 receiver도 비동기 reject한다', async () => {
    const namespace = await loadUiSystem();
    const ui = new namespace.UISystem();
    let cursorCalls = 0;
    let tooltipCalls = 0;
    let nestedResult;
    ui.cursor = {
        init() {
            cursorCalls += 1;
            if (cursorCalls === 1) {
                nestedResult = ui.init();
            }
        }
    };
    ui.tooltip = { init() { tooltipCalls += 1; } };

    const outerResult = ui.init();
    assert.notStrictEqual(outerResult, nestedResult);
    await Promise.all([outerResult, nestedResult]);
    assert.equal(cursorCalls, 2);
    assert.equal(tooltipCalls, 2);

    const receiverErrorPromise = namespace.UISystem.prototype.init.call(null);
    await assert.rejects(receiverErrorPromise, (error) => error?.name === 'TypeError');
});

test('SystemHandler는 UI init 이행 전 로그와 ObjectSystem 단계로 진행하지 않는다', async () => {
    const uiGate = createDeferred();
    const events = [];
    const namespace = await loadSystemHandler(uiGate, events);
    const handler = new namespace.SystemHandler();
    handler.logDebugInfo = (label) => events.push(`log:${label}`);

    const initResult = handler.init();
    for (let index = 0; index < 32 && !events.includes('init:UISystem'); index++) {
        await Promise.resolve();
    }
    assert.equal(events.includes('init:UISystem'), true);
    assert.equal(events.includes('log:UISystem 로드'), false);
    assert.equal(events.includes('construct:ObjectSystem'), false);

    uiGate.resolve();
    await initResult;
    const uiInitIndex = events.indexOf('init:UISystem');
    const uiLogIndex = events.indexOf('log:UISystem 로드');
    const objectConstructIndex = events.indexOf('construct:ObjectSystem');
    const objectInitIndex = events.indexOf('init:ObjectSystem');
    assert.ok(uiInitIndex < uiLogIndex);
    assert.ok(uiLogIndex < objectConstructIndex);
    assert.ok(objectConstructIndex < objectInitIndex);
});
