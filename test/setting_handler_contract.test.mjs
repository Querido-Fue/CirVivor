import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const SETTING_DEFINITIONS = Object.freeze({
    theme: Object.freeze({
        type: 'string',
        defaultValue: 'dark',
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: Object.freeze(['light', 'dark'])
    }),
    disableTransparency: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: false
    }),
    language: Object.freeze({
        type: 'string',
        defaultValue: 'english',
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: Object.freeze(['korean', 'english', 'userLanguage'])
    }),
    windowMode: Object.freeze({
        type: 'string',
        defaultValue: 'fullscreen',
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: Object.freeze(['fullscreen', 'windowed'])
    }),
    widescreenSupport: Object.freeze({
        type: 'bool', defaultValue: true, min: -1, max: -1, hidden: false
    }),
    width: Object.freeze({
        type: 'int', defaultValue: 1280, min: 1280, max: -1, hidden: false
    }),
    height: Object.freeze({
        type: 'int', defaultValue: 720, min: 720, max: -1, hidden: false
    }),
    renderScale: Object.freeze({
        type: 'int', defaultValue: 100, min: 75, max: 100, hidden: false
    }),
    uiScale: Object.freeze({
        type: 'int', defaultValue: 100, min: 75, max: 150, hidden: false
    }),
    tooltipDelaySeconds: Object.freeze({
        type: 'float',
        defaultValue: 0.3,
        min: 0,
        max: 2,
        step: 0.01,
        precision: 2,
        hidden: false
    }),
    uiAnimationDurationScale: Object.freeze({
        type: 'float', defaultValue: 1, min: 0.1, max: 4, hidden: true
    }),
    bgmVolume: Object.freeze({
        type: 'int', defaultValue: 25, min: 0, max: 100, hidden: false
    }),
    sfxVolume: Object.freeze({
        type: 'int', defaultValue: 40, min: 0, max: 100, hidden: false
    }),
    screenModeChanged: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: true
    }),
    debugMode: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: true
    })
});

const settingHandlerUrl = new URL('../project/game/script/module/save/_setting_handler.js', import.meta.url);

/**
 * VM 경계 의존성을 제공하는 synthetic module을 만듭니다.
 * @param {vm.Context} context - 모듈을 실행할 VM 문맥입니다.
 * @param {string} identifier - synthetic module 식별자입니다.
 * @param {Record<string, *>} exports - 노출할 export 값입니다.
 * @returns {vm.SyntheticModule} 생성된 synthetic module입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context, identifier });
}

/**
 * 설정 파일 I/O와 테마 부수효과를 추적하는 SettingHandler harness를 만듭니다.
 * @param {object} [options={}] - 파일·언어·오류 조건입니다.
 * @param {string} [options.initialFile] - 최초 settings.json 원문입니다.
 * @param {string} [options.navigatorLanguage] - navigator 언어 값입니다.
 * @param {(targetPath:string) => Promise<void>|void} [options.accessHook] - access 중간 제어 hook입니다.
 * @param {Error} [options.accessError] - access에서 던질 오류입니다.
 * @param {Error} [options.mkdirError] - mkdir에서 던질 오류입니다.
 * @param {Error} [options.readError] - readFile에서 던질 오류입니다.
 * @param {Error} [options.writeError] - writeFile에서 던질 오류입니다.
 * @returns {Promise<object>} 테스트용 SettingHandler와 관찰 상태입니다.
 */
async function createHarness({
    accessError,
    accessHook,
    initialFile,
    mkdirError,
    navigatorLanguage,
    readError,
    writeError
} = {}) {
    const dataDir = 'save-data';
    const filePath = `${dataDir}/settings.json`;
    const trace = [];
    const errors = [];
    const files = new Map();
    const directories = new Set([dataDir]);
    if (initialFile !== undefined) {
        files.set(filePath, initialFile);
    }

    const fsPromises = {
        async access(targetPath) {
            trace.push(['access', targetPath]);
            await accessHook?.(targetPath);
            if (accessError) throw accessError;
            if (!files.has(targetPath) && !directories.has(targetPath)) {
                throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: 'ENOENT' });
            }
        },
        async readFile(targetPath, encoding) {
            trace.push(['read', targetPath, encoding]);
            if (readError) throw readError;
            return files.get(targetPath);
        },
        async mkdir(targetPath, options) {
            trace.push(['mkdir', targetPath, options]);
            if (mkdirError) throw mkdirError;
            directories.add(targetPath);
        },
        async writeFile(targetPath, contents) {
            trace.push(['write', targetPath, contents]);
            if (writeError) throw writeError;
            files.set(targetPath, contents);
        }
    };
    const path = {
        join(...parts) {
            return parts.join('/');
        }
    };
    const ColorSchemes = { Background: '#before-theme' };
    const contextValues = {
        console: {
            error(...args) {
                errors.push(args);
            },
            log() {}
        }
    };
    if (navigatorLanguage !== undefined) {
        contextValues.navigator = { language: navigatorLanguage };
    }
    const context = vm.createContext(contextValues);

    class MathUtil {
        constructor() {
            trace.push(['math-constructor']);
        }

        cap(value, min, max) {
            if (min !== -1 && value < min) return min;
            if (max !== -1 && value > max) return max;
            return value;
        }
    }

    const syntheticModules = new Map([
        ['util/nw_bridge.js', createSyntheticModule(context, 'util/nw_bridge.js', {
            fsPromises,
            path
        })],
        ['display/_theme_handler.js', createSyntheticModule(context, 'display/_theme_handler.js', {
            ColorSchemes,
            setTheme(theme) {
                trace.push(['theme', theme]);
                ColorSchemes.Background = `background:${theme}`;
            }
        })],
        ['display/_theme_transition_controller.js', createSyntheticModule(
            context,
            'display/_theme_transition_controller.js',
            {
                beginThemeTransition(background) {
                    trace.push(['transition', background]);
                }
            }
        )],
        ['util/math_util.js', createSyntheticModule(context, 'util/math_util.js', { MathUtil })],
        ['data/settings/setting_definitions.js', createSyntheticModule(
            context,
            'data/settings/setting_definitions.js',
            { SETTING_DEFINITIONS }
        )]
    ]);
    const sourceModules = new Map();

    /**
     * SettingHandler와 상대 경로 내부 모듈을 같은 VM 문맥에 로드합니다.
     * @param {string} identifier - source module URL 문자열입니다.
     * @returns {Promise<vm.SourceTextModule>} 생성하거나 재사용한 source module입니다.
     */
    async function getSourceModule(identifier) {
        if (sourceModules.has(identifier)) {
            return sourceModules.get(identifier);
        }

        const source = await readFile(new URL(identifier), 'utf8');
        const module = new vm.SourceTextModule(source, { context, identifier });
        sourceModules.set(identifier, module);
        return module;
    }

    const entryModule = await getSourceModule(settingHandlerUrl.href);
    await entryModule.link(async (specifier, referencingModule) => {
        if (syntheticModules.has(specifier)) {
            return syntheticModules.get(specifier);
        }
        if (specifier.startsWith('.')) {
            return getSourceModule(new URL(specifier, referencingModule.identifier).href);
        }
        throw new Error(`Unexpected module dependency: ${specifier}`);
    });
    await entryModule.evaluate();

    return {
        ColorSchemes,
        SettingHandler: entryModule.namespace.SettingHandler,
        dataDir,
        errors,
        filePath,
        files,
        trace
    };
}

/**
 * harness에 마지막으로 기록된 settings.json을 파싱합니다.
 * @param {object} harness - 설정 테스트 harness입니다.
 * @returns {Record<string, *>} 저장된 설정 객체입니다.
 */
function readPersistedSettings(harness) {
    return JSON.parse(harness.files.get(harness.filePath));
}

/**
 * trace 항목에서 이벤트 이름만 선언 순서대로 추출합니다.
 * @param {Array<unknown[]>} trace - harness 이벤트 기록입니다.
 * @returns {string[]} 이벤트 이름 목록입니다.
 */
function eventNames(trace) {
    return trace.map(([name]) => name);
}

/**
 * handler의 현재 공개 설정만 파일 입력 형태로 복사합니다.
 * @param {object} handler - SettingHandler 인스턴스입니다.
 * @param {Record<string, *>} [overrides={}] - 덮어쓸 값입니다.
 * @returns {Record<string, *>} 공개 설정 파일 객체입니다.
 */
function createCompletePublicSettings(handler, overrides = {}) {
    const settings = {};
    for (const [key, entry] of Object.entries(handler.schema)) {
        if (!entry.hidden) {
            settings[key] = entry.value;
        }
    }
    return { ...settings, ...overrides };
}

test('constructor preserves runtime schema defaults and coercion rules', async () => {
    const harness = await createHarness({ navigatorLanguage: 'ko-KR' });
    const handler = new harness.SettingHandler(harness.dataDir);

    assert.equal(handler.filePath, harness.filePath);
    assert.equal(handler.get('language'), 'korean');
    assert.equal(handler.getSchema('uiScale'), handler.schema.uiScale);
    assert.equal(handler.getSchema('tooltipDelaySeconds').defaultValue, 0.3);
    assert.equal(handler.getSchema('tooltipDelaySeconds').step, 0.01);
    assert.equal(handler.getSchema('tooltipDelaySeconds').precision, 2);
    assert.equal(handler.get('uiAnimationDurationScale'), 1);
    assert.deepEqual(eventNames(harness.trace), ['math-constructor']);

    handler.previewBatch({
        width: '12px',
        height: '900.9',
        renderScale: 999,
        uiScale: 'not-a-number',
        tooltipDelaySeconds: 0.26,
        disableTransparency: 'false',
        windowMode: 'borderless',
        language: 'unknown'
    });

    assert.equal(handler.get('width'), 1280);
    assert.equal(handler.get('height'), 900);
    assert.equal(handler.get('renderScale'), 100);
    assert.equal(handler.get('uiScale'), 100);
    assert.equal(handler.get('tooltipDelaySeconds'), 0.26);
    assert.equal(handler.get('disableTransparency'), true);
    assert.equal(handler.get('windowMode'), 'fullscreen');
    assert.equal(handler.get('language'), 'english');

    for (const [input, expected] of [
        [-1, 0],
        [0.004, 0],
        [0.005, 0.01],
        [0.014, 0.01],
        [0.015, 0.02],
        [0.345, 0.35],
        [2.001, 2]
    ]) {
        handler.previewBatch({ tooltipDelaySeconds: input });
        assert.equal(handler.get('tooltipDelaySeconds'), expected, `${input}`);
    }

    handler.previewBatch({ tooltipDelaySeconds: 0.27 });
    handler.previewBatch({ tooltipDelaySeconds: Number.NaN });
    assert.equal(handler.get('tooltipDelaySeconds'), 0.27);

    handler.previewBatch({ uiAnimationDurationScale: 'invalid' });
    assert.equal(handler.get('uiAnimationDurationScale'), 1);
    handler.previewBatch({ uiAnimationDurationScale: 0 });
    assert.equal(handler.get('uiAnimationDurationScale'), 0.1);
    handler.previewBatch({ uiAnimationDurationScale: 5 });
    assert.equal(handler.get('uiAnimationDurationScale'), 4);
    handler.previewBatch({ uiAnimationDurationScale: 0.5 });
    assert.equal(handler.get('uiAnimationDurationScale'), 0.5);

    const inheritedSettings = Object.create({ bgmVolume: 80 });
    handler.previewBatch(inheritedSettings);
    assert.equal(handler.get('bgmVolume'), 25);

    handler.schema = {
        ...handler.schema,
        uiScale: { ...handler.schema.uiScale, value: 120 }
    };
    handler.previewBatch({ uiScale: 'not-a-number' });
    assert.equal(handler.get('uiScale'), 120);
});

test('init migrates legacy values, retains loaded hidden keys, saves, then applies theme', async () => {
    const initialSettings = {
        darkMode: false,
        disableTransparency: 0,
        language: 'english',
        windowMode: 'borderless',
        widescreenSupport: 1,
        width: 1920,
        height: 1080,
        renderScale: 85,
        uiScale: 110,
        tooltipDelaySeconds: 0.26,
        bgmVolume: 30,
        sfxVolume: 50,
        debugMode: 0,
        physicsAccuracy: 2,
        physicsFps: 60,
        simulationWorkerAuthorityMode: true,
        simulationWorkerShadowMode: true,
        simulationWorkerPresentationMode: true
    };
    const harness = await createHarness({ initialFile: JSON.stringify(initialSettings) });
    const handler = new harness.SettingHandler(harness.dataDir);

    harness.trace.length = 0;
    await handler.init();

    const persisted = readPersistedSettings(harness);
    assert.equal(persisted.theme, 'light');
    assert.equal(persisted.windowMode, 'fullscreen');
    assert.equal(persisted.tooltipDelaySeconds, 0.26);
    assert.equal(persisted.debugMode, false);
    assert.equal(handler.get('uiAnimationDurationScale'), 1);
    assert.equal('uiAnimationDurationScale' in persisted, false);
    assert.equal('screenModeChanged' in persisted, false);
    for (const legacyKey of [
        'darkMode',
        'physicsAccuracy',
        'physicsFps',
        'simulationWorkerAuthorityMode',
        'simulationWorkerShadowMode',
        'simulationWorkerPresentationMode'
    ]) {
        assert.equal(legacyKey in persisted, false);
    }

    const significantEvents = harness.trace
        .filter(([name]) => name === 'read' || name === 'write' || name === 'theme');
    assert.deepEqual(eventNames(significantEvents), ['read', 'write', 'theme']);
    assert.equal(significantEvents.at(-1)[1], 'light');
});

test('missing settings file saves public defaults before applying the default theme', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);

    harness.trace.length = 0;
    await handler.init();

    const persisted = readPersistedSettings(harness);
    assert.equal(persisted.theme, 'dark');
    assert.equal('screenModeChanged' in persisted, false);
    assert.equal('debugMode' in persisted, false);
    assert.equal('uiAnimationDurationScale' in persisted, false);
    const significantEvents = harness.trace
        .filter(([name]) => name === 'write' || name === 'theme');
    assert.deepEqual(eventNames(significantEvents), ['write', 'theme']);
});

test('tooltip precision previews without I/O, saves canonical numbers, and reloads legacy 0.3', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);

    harness.trace.length = 0;
    handler.previewBatch({ tooltipDelaySeconds: 0.27 });
    assert.equal(handler.get('tooltipDelaySeconds'), 0.27);
    assert.equal(harness.trace.some(([name]) => name === 'write'), false);

    await handler.setBatch({ tooltipDelaySeconds: 0.27 });
    assert.equal(readPersistedSettings(harness).tooltipDelaySeconds, 0.27);

    const reloadedHandler = new harness.SettingHandler(harness.dataDir);
    harness.trace.length = 0;
    await reloadedHandler.init();
    assert.equal(reloadedHandler.get('tooltipDelaySeconds'), 0.27);
    assert.equal(harness.trace.some(([name]) => name === 'write'), false);

    const legacyHarness = await createHarness();
    const legacyHandler = new legacyHarness.SettingHandler(legacyHarness.dataDir);
    legacyHarness.files.set(
        legacyHarness.filePath,
        JSON.stringify(createCompletePublicSettings(legacyHandler, {
            tooltipDelaySeconds: 0.3
        }))
    );
    legacyHarness.trace.length = 0;
    await legacyHandler.init();
    assert.equal(legacyHandler.get('tooltipDelaySeconds'), 0.3);
    assert.equal(legacyHarness.trace.some(([name]) => name === 'write'), false);
});

test('load re-reads the live filePath after its deferred existence check', async () => {
    let releaseFileAccess;
    let signalFileAccessStarted;
    let defersFileAccess = true;
    const fileAccessStarted = new Promise((resolve) => {
        signalFileAccessStarted = resolve;
    });
    const harness = await createHarness({
        accessHook(targetPath) {
            if (defersFileAccess && targetPath === 'save-data/settings.json') {
                defersFileAccess = false;
                signalFileAccessStarted();
                return new Promise((resolve) => {
                    releaseFileAccess = resolve;
                });
            }
            return undefined;
        }
    });
    const handler = new harness.SettingHandler(harness.dataDir);
    const nextFilePath = 'moved-data/live-settings.json';
    harness.files.set(
        harness.filePath,
        JSON.stringify(createCompletePublicSettings(handler, { theme: 'dark', width: 1440 }))
    );
    harness.files.set(
        nextFilePath,
        JSON.stringify(createCompletePublicSettings(handler, { theme: 'light', width: 1777 }))
    );

    harness.trace.length = 0;
    const initPromise = handler.init();
    await fileAccessStarted;
    handler.filePath = nextFilePath;
    releaseFileAccess();
    await initPromise;

    assert.deepEqual(
        harness.trace.filter(([name]) => name === 'access' || name === 'read'),
        [
            ['access', harness.filePath],
            ['read', nextFilePath, 'utf-8']
        ]
    );
    assert.equal(handler.get('theme'), 'light');
    assert.equal(handler.get('width'), 1777);
    assert.equal(handler.get('uiAnimationDurationScale'), 1);
    assert.equal(harness.trace.some(([name]) => name === 'write'), false);
});

test('save observes live schema and filePath after deferred directory access and the next dataDir per call', async () => {
    let releaseDirectoryAccess;
    let signalDirectoryAccessStarted;
    let defersDirectoryAccess = true;
    const directoryAccessStarted = new Promise((resolve) => {
        signalDirectoryAccessStarted = resolve;
    });
    const harness = await createHarness({
        accessHook(targetPath) {
            if (defersDirectoryAccess && targetPath === 'save-data') {
                defersDirectoryAccess = false;
                signalDirectoryAccessStarted();
                return new Promise((resolve) => {
                    releaseDirectoryAccess = resolve;
                });
            }
            return undefined;
        }
    });
    const handler = new harness.SettingHandler(harness.dataDir);
    const nextDataDir = 'moved-data';
    const nextFilePath = `${nextDataDir}/live-settings.json`;
    const nextSchema = Object.fromEntries(
        Object.entries(handler.schema).map(([key, entry]) => [key, { ...entry }])
    );
    nextSchema.width.value = 2048;

    harness.trace.length = 0;
    const firstSave = handler.save();
    await directoryAccessStarted;
    handler.schema = nextSchema;
    handler.dataDir = nextDataDir;
    handler.filePath = nextFilePath;
    releaseDirectoryAccess();
    await firstSave;

    assert.deepEqual(
        harness.trace.filter(([name]) => name === 'access' || name === 'mkdir' || name === 'write')
            .map(([name, targetPath]) => [name, targetPath]),
        [
            ['access', harness.dataDir],
            ['write', nextFilePath]
        ]
    );
    assert.equal(JSON.parse(harness.files.get(nextFilePath)).width, 2048);

    harness.trace.length = 0;
    await handler.save();
    assert.deepEqual(
        harness.trace.filter(([name]) => name === 'access' || name === 'mkdir' || name === 'write')
            .map(([name, targetPath]) => [name, targetPath]),
        [
            ['access', nextDataDir],
            ['mkdir', nextDataDir],
            ['write', nextFilePath]
        ]
    );
});

test('own Proxy setting getters coerce with the replaced schema but assign the captured entry', async () => {
    /**
     * 설정 getter가 schema를 교체하는 두 객체 형태에 같은 경계 검증을 적용합니다.
     * @param {(replaceSchema:() => number) => object} createSettings - 설정 객체 factory입니다.
     * @returns {Promise<void>} 검증이 끝나면 이행됩니다.
     */
    async function verifyGetterBoundary(createSettings) {
        const harness = await createHarness();
        const handler = new harness.SettingHandler(harness.dataDir);
        const previousSchema = handler.schema;
        const capturedEntry = previousSchema.uiScale;
        const nextSchema = {
            ...previousSchema,
            uiScale: {
                ...capturedEntry,
                max: 125,
                value: 88
            }
        };
        const settings = createSettings(() => {
            handler.schema = nextSchema;
            return 200;
        });

        handler.previewBatch(settings);

        assert.equal(capturedEntry.value, 125);
        assert.equal(handler.schema, nextSchema);
        assert.equal(nextSchema.uiScale.value, 88);
    }

    await verifyGetterBoundary((replaceSchema) => new Proxy(
        { uiScale: 0 },
        {
            get(target, property, receiver) {
                if (property === 'uiScale') {
                    return replaceSchema();
                }
                return Reflect.get(target, property, receiver);
            }
        }
    ));
});

test('unknown special keys cannot mutate schema prototypes and inherited input getters are ignored', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);
    const prototype = Object.getPrototypeOf(handler.schema);
    const constructor = prototype.constructor;
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(handler.getSchema(key), undefined);
        await handler.set(key, { injected: true });
        assert.equal(handler.get(key), undefined);
    }
    await handler.setBatch(JSON.parse('{"__proto__":{"injected":true},"constructor":1,"bgmVolume":55}'));
    assert.equal(Object.hasOwn(prototype, 'value'), false);
    assert.equal(Object.hasOwn(constructor, 'value'), false);
    assert.equal(handler.get('bgmVolume'), 55);
    const inherited = Object.create(null);
    for (const key of ['theme', 'bgmVolume']) {
        Object.defineProperty(inherited, key, {
            enumerable: true,
            get() { throw new Error('inherited getter must not run'); }
        });
    }
    handler.previewBatch(Object.create(inherited));
    assert.equal(handler.get('bgmVolume'), 55);
    assert.equal(handler.get('theme'), 'dark');
});

test('hidden persistence state is owned by explicit load/set history, not preview', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);

    handler.previewBatch({ debugMode: true, uiAnimationDurationScale: 2 });
    await handler.save();
    assert.equal('debugMode' in readPersistedSettings(harness), false);
    assert.equal('uiAnimationDurationScale' in readPersistedSettings(harness), false);

    const writesBeforeUnknownSet = harness.trace.filter(([name]) => name === 'write').length;
    await handler.set('unknownSetting', 1);
    assert.equal(
        harness.trace.filter(([name]) => name === 'write').length,
        writesBeforeUnknownSet
    );

    await handler.setBatch({ unknownSetting: 2 });
    assert.equal(
        harness.trace.filter(([name]) => name === 'write').length,
        writesBeforeUnknownSet + 1
    );

    await handler.set('debugMode', false);
    assert.equal(readPersistedSettings(harness).debugMode, false);

    await handler.setBatch({ uiAnimationDurationScale: 2 });
    assert.equal(readPersistedSettings(harness).uiAnimationDurationScale, 2);

    const reloadedHandler = new harness.SettingHandler(harness.dataDir);
    harness.trace.length = 0;
    await reloadedHandler.init();
    assert.equal(reloadedHandler.get('uiAnimationDurationScale'), 2);
    assert.equal(harness.trace.some(([name]) => name === 'write'), false);

    handler.previewBatch({ debugMode: true });
    await handler.save();
    assert.equal(readPersistedSettings(harness).debugMode, true);
});

test('loaded malformed UI animation scale falls back safely and stays hidden', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);
    harness.files.set(
        harness.filePath,
        JSON.stringify({
            ...createCompletePublicSettings(handler),
            uiAnimationDurationScale: 'malformed'
        })
    );

    harness.trace.length = 0;
    await handler.init();

    assert.equal(handler.get('uiAnimationDurationScale'), 1);
    assert.equal(handler.getSchema('uiAnimationDurationScale').hidden, true);
    assert.equal(harness.trace.some(([name]) => name === 'write'), false);

    await handler.save();
    assert.equal(readPersistedSettings(harness).uiAnimationDurationScale, 1);
});

test('theme transition and application happen before persistence while unrelated settings do not transition', async () => {
    const harness = await createHarness();
    const handler = new harness.SettingHandler(harness.dataDir);

    harness.ColorSchemes.Background = '#old-background';
    harness.trace.length = 0;
    await handler.set('theme', 'light');

    const significantThemeEvents = harness.trace
        .filter(([name]) => name === 'transition' || name === 'theme' || name === 'write');
    assert.deepEqual(eventNames(significantThemeEvents), ['transition', 'theme', 'write']);
    assert.deepEqual(significantThemeEvents[0], ['transition', '#old-background']);
    assert.deepEqual(significantThemeEvents[1], ['theme', 'light']);

    harness.trace.length = 0;
    await handler.set('disableTransparency', true);
    assert.equal(harness.trace.some(([name]) => name === 'transition'), false);
    assert.equal(harness.trace.some(([name]) => name === 'theme'), false);
});

test('malformed JSON and non-object roots recover valid defaults before applying the theme', async () => {
    const malformedHarness = await createHarness({ initialFile: '{' });
    const malformedHandler = new malformedHarness.SettingHandler(
        malformedHarness.dataDir
    );

    await malformedHandler.init();
    assert.equal(malformedHarness.errors.length, 1);
    assert.equal(malformedHarness.errors[0][0], '설정 파일 로드 실패:');
    assert.equal(malformedHarness.errors[0][1]?.name, 'SyntaxError');
    assert.deepEqual(
        eventNames(
            malformedHarness.trace.filter(
                ([name]) => name === 'write' || name === 'theme'
            )
        ),
        ['write', 'theme']
    );

    for (const initialFile of ['null', '[]', 'true', '1', '"text"']) {
        const nullRootHarness = await createHarness({ initialFile });
        const nullRootHandler = new nullRootHarness.SettingHandler(
            nullRootHarness.dataDir
        );

        await nullRootHandler.init();
        assert.equal(nullRootHarness.errors.length, 1);
        assert.equal(readPersistedSettings(nullRootHarness).theme, 'dark');
        assert.equal(nullRootHarness.trace.at(-1)[0], 'theme');
    }
});

test('load/save failures preserve logging, rejection, and init theme ordering contracts', async () => {
    const readFailure = new Error('read failed');
    const loadHarness = await createHarness({
        initialFile: '{}',
        readError: readFailure
    });
    const loadHandler = new loadHarness.SettingHandler(loadHarness.dataDir);

    await assert.rejects(loadHandler.init(), (error) => error === readFailure);
    assert.equal(loadHarness.errors.length, 1);
    assert.equal(loadHarness.errors[0][0], '설정 파일 로드 실패:');
    assert.equal(loadHarness.errors[0][1], readFailure);
    assert.deepEqual(
        eventNames(loadHarness.trace.filter(([name]) => name === 'write' || name === 'theme')),
        []
    );

    const writeFailure = new Error('write failed');
    const saveHarness = await createHarness({ writeError: writeFailure });
    const saveHandler = new saveHarness.SettingHandler(saveHarness.dataDir);

    await assert.rejects(saveHandler.init(), (error) => error === writeFailure);
    assert.equal(saveHarness.errors.at(-1)[0], '설정 파일 저장 실패:');
    assert.equal(saveHarness.errors.at(-1)[1], writeFailure);
    assert.equal(saveHarness.trace.some(([name]) => name === 'theme'), false);

    const stringifyHarness = await createHarness();
    const stringifyHandler = new stringifyHarness.SettingHandler(stringifyHarness.dataDir);
    stringifyHandler.getSchema('width').value = 1n;

    await assert.rejects(stringifyHandler.save(), (error) => error?.name === 'TypeError');
    assert.equal(stringifyHarness.errors.at(-1)[0], '설정 파일 저장 실패:');
    assert.equal(stringifyHarness.errors.at(-1)[1]?.name, 'TypeError');
});

test('directory access failures prevent writes and missing-directory creation failures propagate', async () => {
    const accessFailure = new Error('access failed');
    const accessHarness = await createHarness({ accessError: accessFailure });
    const accessHandler = new accessHarness.SettingHandler(accessHarness.dataDir);

    await assert.rejects(accessHandler.save(), (error) => error === accessFailure);
    assert.deepEqual(
        eventNames(
            accessHarness.trace.filter(
                ([name]) => name === 'access' || name === 'mkdir' || name === 'write'
            )
        ),
        ['access']
    );
    assert.deepEqual(accessHarness.errors, []);

    const mkdirFailure = new Error('mkdir failed');
    const mkdirHarness = await createHarness({
        accessError: Object.assign(new Error('missing'), { code: 'ENOENT' }),
        mkdirError: mkdirFailure
    });
    const mkdirHandler = new mkdirHarness.SettingHandler(mkdirHarness.dataDir);

    await assert.rejects(mkdirHandler.save(), (error) => error === mkdirFailure);
    assert.equal(mkdirHarness.errors.length, 1);
    assert.equal(mkdirHarness.errors[0][0], '설정 디렉토리 생성 실패:');
    assert.equal(mkdirHarness.errors[0][1], mkdirFailure);
    assert.equal(mkdirHarness.trace.some(([name]) => name === 'write'), false);
});
