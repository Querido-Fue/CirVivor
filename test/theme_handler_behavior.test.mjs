import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/_theme_handler.js',
    import.meta.url
));
const source = await readFile(SOURCE_PATH, 'utf8');

/**
 * 실제 production ThemeHandler 모듈을 격리된 context에서 로드합니다.
 * @param {object} options - 테스트 의존성입니다.
 * @param {object} options.themes - 테마 registry입니다.
 * @param {string} [options.defaultThemeKey='dark'] - 기본 테마 키입니다.
 * @param {Function} [options.getThemeByKey] - 테마 resolver입니다.
 * @param {Function} [options.fsAccess] - settings 파일 접근 구현입니다.
 * @param {Function} [options.fsReadFile] - settings 파일 읽기 구현입니다.
 * @param {Function} [options.processCwd] - 작업 경로 resolver입니다.
 * @param {Function} [options.setBackgroundColorImplementation] - 배경 적용 구현입니다.
 * @param {Function} [options.colorUtilFactory] - 색상 유틸리티 factory입니다.
 * @returns {Promise<{
 *   namespace: object,
 *   backgroundCalls: unknown[],
 *   colorCalls: unknown[],
 *   consoleErrors: unknown[]
 * }>} 로드된 모듈과 의존성 호출 기록입니다.
 */
async function loadThemeHandler({
    themes,
    defaultThemeKey = 'dark',
    getThemeByKey = (key) => themes[key] ?? themes[defaultThemeKey],
    fsAccess = async () => {
        throw new Error('missing settings');
    },
    fsReadFile = async () => '',
    processCwd = () => 'C:/game',
    setBackgroundColorImplementation,
    colorUtilFactory
}) {
    const backgroundCalls = [];
    const colorCalls = [];
    const consoleErrors = [];
    const context = vm.createContext({
        console: {
            error(...args) {
                consoleErrors.push(args);
            }
        },
        process: { cwd: processCwd },
        require(specifier) {
            if (specifier === 'fs') {
                return {
                    promises: {
                        access: fsAccess,
                        readFile: fsReadFile
                    }
                };
            }
            if (specifier === 'path') {
                return { join: (...parts) => parts.join('/') };
            }
            throw new Error(`지원하지 않는 require입니다: ${specifier}`);
        }
    });
    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
    const dependencies = new Map([
        ['data/theme/theme_registry.js', createSyntheticModule('data/theme/theme_registry.js', {
            THEMES: themes,
            DEFAULT_THEME_KEY: defaultThemeKey
        })],
        ['./_theme_registry.js', createSyntheticModule('./_theme_registry.js', {
            getThemeByKey
        })],
        ['display/display_system.js', createSyntheticModule('display/display_system.js', {
            setBackgroundColor(...args) {
                backgroundCalls.push(args);
                return setBackgroundColorImplementation?.(...args);
            }
        })],
        ['util/color_util.js', createSyntheticModule('util/color_util.js', {
            colorUtil() {
                if (colorUtilFactory) {
                    return colorUtilFactory();
                }
                return {
                    cssToRgb(value) {
                        colorCalls.push(value);
                        return { r: 51, g: 102, b: 153 };
                    }
                };
            }
        })]
    ]);
    const module = new vm.SourceTextModule(source, { context, identifier: SOURCE_PATH });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        namespace: module.namespace,
        backgroundCalls,
        colorCalls,
        consoleErrors
    };
}

test('ThemeHandler는 승인된 테마 데이터와 코드 resolver를 직접 import한다', () => {

    assert.match(source, /from 'data\/theme\/theme_registry\.js'/);
    assert.match(source, /from '\.\/_theme_registry\.js'/);
    assert.doesNotMatch(source, /data\/data_handler\.js|getData\(/);
});

test('ColorSchemes는 초기 빈 객체 identity와 테마의 live 중첩 참조를 유지한다', async () => {
    const lightNested = { tone: 'light' };
    const darkNested = { tone: 'dark' };
    const themes = {
        light: { Background: '#fff', LightOnly: true, Nested: lightNested },
        dark: { Background: '#000', DarkOnly: true, Nested: darkNested }
    };
    const { namespace } = await loadThemeHandler({ themes });
    const paletteIdentity = namespace.ColorSchemes;
    assert.deepEqual(Object.keys(paletteIdentity), []);

    const handler = new namespace.ThemeHandler();
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme('light', false);
    assert.equal(namespace.ColorSchemes, paletteIdentity);
    assert.equal(namespace.ColorSchemes.Nested, lightNested);
    namespace.ColorSchemes.Nested.tone = 'mutated';
    assert.equal(lightNested.tone, 'mutated');

    handler.setTheme('dark', false);
    assert.equal(namespace.ColorSchemes, paletteIdentity);
    assert.equal('LightOnly' in namespace.ColorSchemes, false);
    assert.equal(namespace.ColorSchemes.DarkOnly, true);
    assert.equal(namespace.ColorSchemes.Nested, darkNested);
});

test('교체는 enumerable 문자열 키만 지우고 비열거·Symbol 키를 보존한다', async () => {
    const sourceSymbol = Symbol('source');
    const preservedSymbol = Symbol('preserved');
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', [sourceSymbol]: 'source-symbol' }
    };
    const { namespace } = await loadThemeHandler({ themes });
    const handler = new namespace.ThemeHandler();
    handler.setTheme('light', false);
    namespace.ColorSchemes.stale = true;
    namespace.ColorSchemes[sourceSymbol] = 'stale-source-symbol';
    namespace.ColorSchemes[preservedSymbol] = 'preserved-symbol';
    Object.defineProperty(namespace.ColorSchemes, 'hidden', {
        value: 'hidden-value',
        enumerable: false,
        configurable: true
    });

    handler.setTheme('dark', false);
    assert.equal('stale' in namespace.ColorSchemes, false);
    assert.equal('LightOnly' in namespace.ColorSchemes, false);
    assert.equal(namespace.ColorSchemes.hidden, 'hidden-value');
    assert.equal(namespace.ColorSchemes[preservedSymbol], 'preserved-symbol');
    assert.equal(namespace.ColorSchemes[sourceSymbol], 'source-symbol');
});

test('삭제 실패는 currentTheme 선행 쓰기와 ColorSchemes 부분 삭제를 보존한다', async () => {
    const themeReads = [];
    const themes = {
        light: { First: 1, Second: 2 },
        dark: { DarkOnly: true }
    };
    const { namespace, backgroundCalls, colorCalls } = await loadThemeHandler({
        themes,
        getThemeByKey(key) {
            themeReads.push(key);
            return themes[key];
        }
    });
    const handler = new namespace.ThemeHandler();
    handler.setTheme('light', false);
    Object.defineProperty(namespace.ColorSchemes, 'Locked', {
        value: 3,
        enumerable: true,
        configurable: false
    });

    assert.throws(() => handler.setTheme('dark'), (error) => error?.name === 'TypeError');
    assert.equal(handler.getCurrentTheme(), 'dark');
    assert.deepEqual(themeReads, ['light', 'dark']);
    assert.equal('First' in namespace.ColorSchemes, false);
    assert.equal('Second' in namespace.ColorSchemes, false);
    assert.equal(namespace.ColorSchemes.Locked, 3);
    assert.equal('DarkOnly' in namespace.ColorSchemes, false);
    assert.deepEqual(backgroundCalls, []);
    assert.deepEqual(colorCalls, []);
});

test('module adapter는 생성 전 no-op이고 가장 최근 인스턴스만 위임 대상으로 사용한다', async () => {
    const themeReads = [];
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };
    const { namespace, backgroundCalls, colorCalls } = await loadThemeHandler({
        themes,
        getThemeByKey(key) {
            themeReads.push(key);
            return themes[key];
        }
    });

    assert.equal(namespace.getCurrentThemeKey(), 'dark');
    assert.equal(namespace.setTheme('light'), undefined);
    assert.deepEqual(themeReads, []);
    assert.deepEqual(backgroundCalls, []);
    assert.deepEqual(colorCalls, []);

    const first = new namespace.ThemeHandler();
    const second = new namespace.ThemeHandler();
    assert.equal(namespace.setTheme(false), undefined);
    assert.equal(first.getCurrentTheme(), 'dark');
    assert.equal(second.getCurrentTheme(), 'light');
    assert.equal(namespace.getCurrentThemeKey(), 'light');
    assert.deepEqual(themeReads, ['light']);
    assert.equal(backgroundCalls.length, 1);
    assert.equal(colorCalls.length, 1);

    second.currentTheme = '';
    assert.equal(namespace.getCurrentThemeKey(), 'dark');

    second.currentTheme = 'light';
    second.getCurrentTheme = undefined;
    assert.equal(namespace.getCurrentThemeKey(), 'dark');

    const getterError = new Error('get-current-theme-property');
    Object.defineProperty(second, 'getCurrentTheme', {
        configurable: true,
        get() {
            throw getterError;
        }
    });
    assert.throws(() => namespace.getCurrentThemeKey(), (error) => error === getterError);

    const callError = new Error('get-current-theme-call');
    Object.defineProperty(second, 'getCurrentTheme', {
        configurable: true,
        value() {
            throw callError;
        }
    });
    assert.throws(() => namespace.getCurrentThemeKey(), (error) => error === callError);
});

test('테마 key 정규화는 primitive type만 사용하고 display 인수는 truthiness로 판정한다', async () => {
    const themeReads = [];
    const proxyTrace = [];
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };
    Object.setPrototypeOf(themes, {
        inherited: { Background: '#inherited', InheritedOnly: true }
    });
    const { namespace, backgroundCalls, colorCalls } = await loadThemeHandler({
        themes,
        getThemeByKey(key) {
            themeReads.push(key);
            return themes[key];
        }
    });
    const handler = new namespace.ThemeHandler();
    const objectProxy = new Proxy({}, {
        get() {
            proxyTrace.push('get');
            return undefined;
        },
        getOwnPropertyDescriptor() {
            proxyTrace.push('getOwnPropertyDescriptor');
            return undefined;
        },
        getPrototypeOf() {
            proxyTrace.push('getPrototypeOf');
            return null;
        },
        has() {
            proxyTrace.push('has');
            return false;
        }
    });

    handler.setTheme(true, false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme(false, false);
    assert.equal(handler.getCurrentTheme(), 'light');
    handler.setTheme('light', false);
    assert.equal(handler.getCurrentTheme(), 'light');
    handler.setTheme('missing', false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme(new String('light'), false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme(objectProxy, false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme(Symbol('light'), false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    handler.setTheme('inherited', false);
    assert.equal(handler.getCurrentTheme(), 'dark');
    assert.equal('InheritedOnly' in namespace.ColorSchemes, false);
    assert.deepEqual(proxyTrace, []);

    handler.setTheme('light', 0);
    handler.setTheme('light', '');
    assert.deepEqual(backgroundCalls, []);
    handler.setTheme('light', new Boolean(false));
    assert.equal(backgroundCalls.length, 1);
    assert.equal(colorCalls.length, 1);
    assert.deepEqual(themeReads, [
        'dark',
        'light',
        'light',
        'dark',
        'dark',
        'dark',
        'dark',
        'dark',
        'light',
        'light',
        'light'
    ]);
});

test('constructor는 기본 필드 쓰기 전에 최신 adapter 대상을 교체하고 실패 상태도 유지한다', async () => {
    const themeReads = [];
    const themes = {
        light: { Background: '#fff' },
        dark: { Background: '#000' }
    };
    const { namespace } = await loadThemeHandler({
        themes,
        getThemeByKey(key) {
            themeReads.push(key);
            return themes[key];
        }
    });
    const previous = new namespace.ThemeHandler();
    const constructorError = new Error('constructor-currentTheme-setter');
    Object.defineProperty(namespace.ThemeHandler.prototype, 'currentTheme', {
        configurable: true,
        get() {
            return 'partial';
        },
        set() {
            throw constructorError;
        }
    });

    assert.throws(() => new namespace.ThemeHandler(), (error) => error === constructorError);
    assert.equal(previous.getCurrentTheme(), 'dark');
    assert.equal(namespace.getCurrentThemeKey(), 'partial');
    assert.throws(() => namespace.setTheme('light'), (error) => error === constructorError);
    assert.deepEqual(themeReads, []);
});

test('constructor setter 재진입 시 module adapter는 내부에서 생성된 인스턴스를 유지한다', async () => {
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };
    const { namespace, backgroundCalls } = await loadThemeHandler({ themes });
    const currentThemes = new WeakMap();
    let innerHandler;
    let didReenter = false;
    Object.defineProperty(namespace.ThemeHandler.prototype, 'currentTheme', {
        configurable: true,
        get() {
            return currentThemes.get(this);
        },
        set(value) {
            currentThemes.set(this, value);
            if (!didReenter) {
                didReenter = true;
                innerHandler = new namespace.ThemeHandler();
            }
        }
    });

    const outerHandler = new namespace.ThemeHandler();
    assert.notEqual(innerHandler, outerHandler);
    assert.equal(outerHandler.getCurrentTheme(), 'dark');
    assert.equal(innerHandler.getCurrentTheme(), 'dark');

    namespace.setTheme('light');
    assert.equal(outerHandler.getCurrentTheme(), 'dark');
    assert.equal(innerHandler.getCurrentTheme(), 'light');
    assert.equal(namespace.ColorSchemes.LightOnly, true);
    assert.equal(backgroundCalls.length, 1);
});

test('비열거 target setter 예외는 앞선 source key만 적용한 부분 상태를 남긴다', async () => {
    const setterError = new Error('target-setter');
    const setterTrace = [];
    const themes = {
        light: { Background: '#fff' },
        dark: { First: 1, Background: '#000', After: 2 }
    };
    const { namespace } = await loadThemeHandler({ themes });
    const handler = new namespace.ThemeHandler();
    Object.defineProperty(namespace.ColorSchemes, 'Background', {
        configurable: true,
        enumerable: false,
        get() {
            return 'hidden-background';
        },
        set(value) {
            setterTrace.push(value);
            throw setterError;
        }
    });

    assert.throws(() => handler.setTheme('dark', false), (error) => error === setterError);
    assert.equal(handler.getCurrentTheme(), 'dark');
    assert.equal(namespace.ColorSchemes.First, 1);
    assert.equal('After' in namespace.ColorSchemes, false);
    assert.deepEqual(setterTrace, ['#000']);
});

test('target prototype Proxy의 true·false·throw set 결과를 Object.assign 계약대로 전파한다', async () => {
    const themes = {
        light: { Background: '#fff' },
        dark: { First: 1, Second: 2 }
    };

    const successful = await loadThemeHandler({ themes });
    const successfulHandler = new successful.namespace.ThemeHandler();
    const successfulTrace = [];
    Object.setPrototypeOf(successful.namespace.ColorSchemes, new Proxy({}, {
        set(target, key, value) {
            successfulTrace.push([key, value]);
            return true;
        }
    }));
    successfulHandler.setTheme('dark', false);
    assert.deepEqual(successfulTrace, [['First', 1], ['Second', 2]]);
    assert.deepEqual(Object.keys(successful.namespace.ColorSchemes), []);

    const rejected = await loadThemeHandler({ themes });
    const rejectedHandler = new rejected.namespace.ThemeHandler();
    Object.setPrototypeOf(rejected.namespace.ColorSchemes, new Proxy({}, {
        set() {
            return false;
        }
    }));
    assert.throws(
        () => rejectedHandler.setTheme('dark', false),
        (error) => error?.name === 'TypeError'
    );
    assert.equal(rejectedHandler.getCurrentTheme(), 'dark');

    const thrown = await loadThemeHandler({ themes });
    const thrownHandler = new thrown.namespace.ThemeHandler();
    const setError = new Error('prototype-set-trap');
    Object.setPrototypeOf(thrown.namespace.ColorSchemes, new Proxy({}, {
        set() {
            throw setError;
        }
    }));
    assert.throws(() => thrownHandler.setTheme('dark', false), (error) => error === setError);
    assert.equal(thrownHandler.getCurrentTheme(), 'dark');
});

test('target prototype Proxy set trap 재진입은 내부 테마와 외부 후속 key를 혼합한다', async () => {
    const themes = {
        light: { LightOnly: true },
        dark: { Trigger: 'outer', After: 'outer-after' }
    };
    const { namespace } = await loadThemeHandler({ themes });
    const handler = new namespace.ThemeHandler();
    let didReenter = false;
    Object.setPrototypeOf(namespace.ColorSchemes, new Proxy({}, {
        set(target, key, value, receiver) {
            if (key === 'Trigger' && !didReenter) {
                didReenter = true;
                handler.setTheme('light', false);
                return true;
            }
            return Reflect.defineProperty(receiver, key, {
                value,
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
    }));

    handler.setTheme('dark', false);
    assert.equal(handler.getCurrentTheme(), 'light');
    assert.equal(namespace.ColorSchemes.LightOnly, true);
    assert.equal(namespace.ColorSchemes.After, 'outer-after');
    assert.equal('Trigger' in namespace.ColorSchemes, false);
});

test('seal과 preventExtensions는 서로 다른 삭제·복사 실패 부분 상태를 보존한다', async () => {
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };

    const sealed = await loadThemeHandler({ themes });
    const sealedHandler = new sealed.namespace.ThemeHandler();
    sealedHandler.setTheme('light', false);
    Object.seal(sealed.namespace.ColorSchemes);
    assert.throws(
        () => sealedHandler.setTheme('dark', false),
        (error) => error?.name === 'TypeError'
    );
    assert.equal(sealedHandler.getCurrentTheme(), 'dark');
    assert.equal(sealed.namespace.ColorSchemes.Background, '#fff');
    assert.equal(sealed.namespace.ColorSchemes.LightOnly, true);

    const nonExtensible = await loadThemeHandler({ themes });
    const nonExtensibleHandler = new nonExtensible.namespace.ThemeHandler();
    nonExtensibleHandler.setTheme('light', false);
    Object.preventExtensions(nonExtensible.namespace.ColorSchemes);
    assert.throws(
        () => nonExtensibleHandler.setTheme('dark', false),
        (error) => error?.name === 'TypeError'
    );
    assert.equal(nonExtensibleHandler.getCurrentTheme(), 'dark');
    assert.deepEqual(Object.keys(nonExtensible.namespace.ColorSchemes), []);
});

test('source Proxy는 ownKeys→descriptor→get 순서로 얕게 복사된다', async () => {
    const sourceTrace = [];
    const darkTheme = new Proxy({ First: 1, Second: 2 }, {
        ownKeys(target) {
            sourceTrace.push('ownKeys');
            return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
            sourceTrace.push(`descriptor:${String(key)}`);
            return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
            sourceTrace.push(`get:${String(key)}`);
            return Reflect.get(target, key, receiver);
        }
    });
    const themes = {
        light: { Background: '#fff' },
        dark: darkTheme
    };
    const { namespace } = await loadThemeHandler({ themes });
    const handler = new namespace.ThemeHandler();

    handler.setTheme('dark', false);
    assert.deepEqual(sourceTrace, [
        'ownKeys',
        'descriptor:First',
        'get:First',
        'descriptor:Second',
        'get:Second'
    ]);
    assert.equal(namespace.ColorSchemes.First, 1);
    assert.equal(namespace.ColorSchemes.Second, 2);
});

test('source getter 예외와 재진입은 Object.assign의 순차 부분 상태를 그대로 남긴다', async () => {
    const getterError = new Error('source-getter');
    const throwingDarkTheme = {};
    Object.defineProperties(throwingDarkTheme, {
        First: {
            enumerable: true,
            get() {
                return 1;
            }
        },
        Second: {
            enumerable: true,
            get() {
                throw getterError;
            }
        },
        Third: {
            enumerable: true,
            get() {
                return 3;
            }
        }
    });
    const throwing = await loadThemeHandler({
        themes: {
            light: { LightOnly: true },
            dark: throwingDarkTheme
        }
    });
    const throwingHandler = new throwing.namespace.ThemeHandler();
    assert.throws(
        () => throwingHandler.setTheme('dark', false),
        (error) => error === getterError
    );
    assert.equal(throwingHandler.getCurrentTheme(), 'dark');
    assert.equal(throwing.namespace.ColorSchemes.First, 1);
    assert.equal('Second' in throwing.namespace.ColorSchemes, false);
    assert.equal('Third' in throwing.namespace.ColorSchemes, false);

    let reentrantHandler;
    let didReenter = false;
    const reentrantDarkTheme = {
        Before: 'outer-before',
        get Trigger() {
            if (!didReenter) {
                didReenter = true;
                reentrantHandler.setTheme('light', false);
            }
            return 'outer-trigger';
        },
        After: 'outer-after'
    };
    const reentrant = await loadThemeHandler({
        themes: {
            light: { LightOnly: true, Shared: 'inner' },
            dark: reentrantDarkTheme
        }
    });
    reentrantHandler = new reentrant.namespace.ThemeHandler();
    reentrantHandler.setTheme('dark', false);
    assert.equal(reentrantHandler.getCurrentTheme(), 'light');
    assert.equal('Before' in reentrant.namespace.ColorSchemes, false);
    assert.equal(reentrant.namespace.ColorSchemes.LightOnly, true);
    assert.equal(reentrant.namespace.ColorSchemes.Shared, 'inner');
    assert.equal(reentrant.namespace.ColorSchemes.Trigger, 'outer-trigger');
    assert.equal(reentrant.namespace.ColorSchemes.After, 'outer-after');
});

test('getThemeByKey 재진입은 currentTheme과 최종 palette가 다른 split state를 만들 수 있다', async () => {
    const themes = {
        light: { LightOnly: true },
        dark: { DarkOnly: true }
    };
    let handler;
    let didReenter = false;
    const { namespace } = await loadThemeHandler({
        themes,
        getThemeByKey(key) {
            if (key === 'dark' && !didReenter) {
                didReenter = true;
                handler.setTheme('light', false);
            }
            return themes[key];
        }
    });
    handler = new namespace.ThemeHandler();

    handler.setTheme('dark', false);
    assert.equal(handler.getCurrentTheme(), 'light');
    assert.equal(namespace.ColorSchemes.DarkOnly, true);
    assert.equal('LightOnly' in namespace.ColorSchemes, false);
});

test('배경 갱신은 Background를 두 번 읽고 첫 값이 falsy면 모든 의존성을 건너뛴다', async () => {
    const themes = {
        light: { Background: '#fff' },
        dark: { Background: '#000' }
    };
    const { namespace, backgroundCalls, colorCalls } = await loadThemeHandler({ themes });
    const handler = new namespace.ThemeHandler();
    handler.setTheme('dark', false);
    let reads = 0;
    Object.defineProperty(namespace.ColorSchemes, 'Background', {
        configurable: true,
        enumerable: true,
        get() {
            reads += 1;
            return reads === 1 ? '#first' : '#second';
        }
    });

    assert.equal(handler.updateBackgroundColor(), undefined);
    assert.equal(reads, 2);
    assert.deepEqual(colorCalls, ['#second']);
    assert.deepEqual(backgroundCalls, [[51 / 255, 102 / 255, 153 / 255]]);

    let falsyReads = 0;
    Object.defineProperty(namespace.ColorSchemes, 'Background', {
        configurable: true,
        enumerable: true,
        get() {
            falsyReads += 1;
            return '';
        }
    });
    handler.updateBackgroundColor();
    assert.equal(falsyReads, 1);
    assert.equal(colorCalls.length, 1);
    assert.equal(backgroundCalls.length, 1);
});

test('색상 변환·display 예외는 이미 적용된 theme state를 롤백하지 않는다', async () => {
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };
    const colorError = new Error('css-to-rgb');
    const colorFailure = await loadThemeHandler({
        themes,
        colorUtilFactory() {
            return {
                cssToRgb() {
                    throw colorError;
                }
            };
        }
    });
    const colorFailureHandler = new colorFailure.namespace.ThemeHandler();
    assert.throws(
        () => colorFailureHandler.setTheme('light'),
        (error) => error === colorError
    );
    assert.equal(colorFailureHandler.getCurrentTheme(), 'light');
    assert.equal(colorFailure.namespace.ColorSchemes.LightOnly, true);
    assert.deepEqual(colorFailure.backgroundCalls, []);

    const displayError = new Error('set-background');
    const displayFailure = await loadThemeHandler({
        themes,
        setBackgroundColorImplementation() {
            throw displayError;
        }
    });
    const displayFailureHandler = new displayFailure.namespace.ThemeHandler();
    assert.throws(
        () => displayFailureHandler.setTheme('light'),
        (error) => error === displayError
    );
    assert.equal(displayFailureHandler.getCurrentTheme(), 'light');
    assert.equal(displayFailure.namespace.ColorSchemes.LightOnly, true);
    assert.equal(displayFailure.backgroundCalls.length, 1);
});

test('배경 RGB 성분은 NaN과 무한대를 clamp 없이 255로 나누어 전달한다', async () => {
    const themes = {
        light: { Background: '#fff' },
        dark: { Background: '#000' }
    };
    const { namespace, backgroundCalls } = await loadThemeHandler({
        themes,
        colorUtilFactory() {
            return {
                cssToRgb() {
                    return { r: NaN, g: Infinity, b: -Infinity };
                }
            };
        }
    });
    const handler = new namespace.ThemeHandler();
    handler.setTheme('dark');

    assert.equal(backgroundCalls.length, 1);
    assert.equal(Number.isNaN(backgroundCalls[0][0]), true);
    assert.equal(backgroundCalls[0][1], Infinity);
    assert.equal(backgroundCalls[0][2], -Infinity);
});

test('init은 파일 오류를 기본 테마로 복구하지만 테마 적용 예외는 reject한다', async () => {
    const themes = {
        light: { Background: '#fff' },
        dark: { Background: '#000' }
    };
    const recovered = await loadThemeHandler({ themes });
    const recoveredHandler = new recovered.namespace.ThemeHandler();
    assert.equal(await recoveredHandler.init(), undefined);
    assert.equal(recoveredHandler.getCurrentTheme(), 'dark');
    assert.equal(recovered.backgroundCalls.length, 1);
    assert.deepEqual(recovered.consoleErrors, []);

    const applyError = new Error('theme-resolver');
    const rejected = await loadThemeHandler({
        themes,
        getThemeByKey() {
            throw applyError;
        }
    });
    const rejectedHandler = new rejected.namespace.ThemeHandler();
    await assert.rejects(rejectedHandler.init(), (error) => error === applyError);
    assert.equal(rejectedHandler.getCurrentTheme(), 'dark');
    assert.deepEqual(rejected.backgroundCalls, []);
});

test('init은 theme 문자열을 legacy darkMode보다 우선하고 유효하지 않으면 기본 키로 정규화한다', async () => {
    const themes = {
        light: { Background: '#fff', LightOnly: true },
        dark: { Background: '#000', DarkOnly: true }
    };

    const explicitTheme = await loadThemeHandler({
        themes,
        fsAccess: async () => undefined,
        fsReadFile: async () => JSON.stringify({ theme: 'light', darkMode: true })
    });
    const explicitHandler = new explicitTheme.namespace.ThemeHandler();
    assert.equal(await explicitHandler.init(), undefined);
    assert.equal(explicitHandler.getCurrentTheme(), 'light');
    assert.equal(explicitTheme.namespace.ColorSchemes.LightOnly, true);

    const legacyTheme = await loadThemeHandler({
        themes,
        fsAccess: async () => undefined,
        fsReadFile: async () => JSON.stringify({ darkMode: false })
    });
    const legacyHandler = new legacyTheme.namespace.ThemeHandler();
    await legacyHandler.init();
    assert.equal(legacyHandler.getCurrentTheme(), 'light');
    assert.equal(legacyTheme.namespace.ColorSchemes.LightOnly, true);

    const invalidTheme = await loadThemeHandler({
        themes,
        fsAccess: async () => undefined,
        fsReadFile: async () => JSON.stringify({ theme: 'missing', darkMode: false })
    });
    const invalidHandler = new invalidTheme.namespace.ThemeHandler();
    await invalidHandler.init();
    assert.equal(invalidHandler.getCurrentTheme(), 'dark');
    assert.equal(invalidTheme.namespace.ColorSchemes.DarkOnly, true);
    assert.equal('LightOnly' in invalidTheme.namespace.ColorSchemes, false);
});
