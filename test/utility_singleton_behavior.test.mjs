import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const UTIL_ROOT = path.join(SCRIPT_ROOT, 'util');
const MATH_UTIL_PATH = path.join(UTIL_ROOT, 'math_util.js');
const COLOR_UTIL_PATH = path.join(UTIL_ROOT, 'color_util.js');
const RUNTIME_TOOL_PATH = path.join(UTIL_ROOT, 'runtime_tool.js');
const NUMBER_UTIL_PATH = path.join(UTIL_ROOT, 'number_util.js');
const [mathUtilSource, colorUtilSource, runtimeToolSource, numberUtilSource] = await Promise.all([
    readFile(MATH_UTIL_PATH, 'utf8'),
    readFile(COLOR_UTIL_PATH, 'utf8'),
    readFile(RUNTIME_TOOL_PATH, 'utf8'),
    readFile(NUMBER_UTIL_PATH, 'utf8')
]);

/**
 * import가 없는 production 유틸리티 모듈을 새 VM realm에 로드합니다.
 * @param {string} source - 모듈 소스입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @returns {Promise<object>} 모듈 namespace입니다.
 */
async function loadStandaloneNamespace(source, identifier) {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(source, { context, identifier });
    await module.link((specifier) => {
        throw new Error(`예상하지 못한 import입니다: ${specifier}`);
    });
    await module.evaluate();
    return module.namespace;
}

/**
 * 실제 RuntimeTool과 숫자 유틸 모듈을 새 VM realm에 로드합니다.
 * NW.js bridge만 최소 synthetic module로 대체합니다.
 * @returns {Promise<object>} RuntimeTool 모듈 namespace입니다.
 */
async function loadRuntimeToolNamespace() {
    const context = vm.createContext({ console });
    const nwBridgeModule = new vm.SyntheticModule(['nw'], function setNwExport() {
        this.setExport('nw', {
            Shell: { openExternal() {} },
            Window: { get: () => ({}) }
        });
    }, { context, identifier: 'synthetic:nw_bridge.js' });
    const numberUtilModule = new vm.SourceTextModule(numberUtilSource, {
        context,
        identifier: NUMBER_UTIL_PATH
    });
    const runtimeToolModule = new vm.SourceTextModule(runtimeToolSource, {
        context,
        identifier: RUNTIME_TOOL_PATH
    });
    await runtimeToolModule.link((specifier) => {
        if (specifier === './nw_bridge.js') return nwBridgeModule;
        if (specifier === './number_util.js') return numberUtilModule;
        throw new Error(`예상하지 못한 RuntimeTool import입니다: ${specifier}`);
    });
    await runtimeToolModule.evaluate();
    return runtimeToolModule.namespace;
}

test('MathUtil accessor는 생성 전 null과 가장 최근 인스턴스 identity를 보존한다', async () => {
    const api = await loadStandaloneNamespace(mathUtilSource, MATH_UTIL_PATH);
    assert.equal(api.mathUtil.name, 'mathUtil');
    assert.equal(api.mathUtil.length, 0);
    assert.equal(api.mathUtil(), null);

    const first = new api.MathUtil();
    first.marker = { owner: 'first math util' };
    assert.equal(api.mathUtil(), first);

    const second = new api.MathUtil();
    assert.equal(api.mathUtil(), second);
    assert.notEqual(second, first);
    assert.deepEqual(first.marker, { owner: 'first math util' });
});

test('ColorUtil accessor는 생성 전 null과 가장 최근 인스턴스 identity를 보존한다', async () => {
    const api = await loadStandaloneNamespace(colorUtilSource, COLOR_UTIL_PATH);
    assert.equal(api.colorUtil.name, 'colorUtil');
    assert.equal(api.colorUtil.length, 0);
    assert.equal(api.colorUtil(), null);

    const first = new api.ColorUtil();
    first.marker = { owner: 'first color util' };
    assert.equal(api.colorUtil(), first);

    const second = new api.ColorUtil();
    assert.equal(api.colorUtil(), second);
    assert.notEqual(second, first);
    assert.deepEqual(first.marker, { owner: 'first color util' });
});

test('RuntimeTool accessor는 최신 인스턴스와 초기화 실패 부분 인스턴스를 보존한다', async () => {
    const api = await loadRuntimeToolNamespace();
    assert.equal(api.runtimeTool.name, 'runtimeTool');
    assert.equal(api.runtimeTool.length, 0);
    assert.equal(api.runtimeTool(), null);

    const first = new api.RuntimeTool();
    const firstHandler = () => 'first handler';
    first.setExternalURLHandler(firstHandler);
    first.marker = { owner: 'first runtime tool' };
    assert.equal(api.runtimeTool(), first);
    assert.equal(first._externalURLHandler, firstHandler);

    const second = new api.RuntimeTool();
    assert.equal(api.runtimeTool(), second);
    assert.notEqual(second, first);
    assert.deepEqual(first.marker, { owner: 'first runtime tool' });
    assert.equal(first._externalURLHandler, firstHandler);
    assert.equal(second._externalURLHandler, null);
    assert.throws(() => api.RuntimeTool(), (error) => error?.name === 'TypeError');
    assert.equal(api.runtimeTool(), second);

    const initializationToken = new Error('RuntimeTool initialization sentinel');
    let partialInstance = null;
    Object.defineProperty(api.RuntimeTool.prototype, '_externalURLHandler', {
        configurable: true,
        set() {
            partialInstance = this;
            throw initializationToken;
        }
    });
    assert.throws(() => new api.RuntimeTool(), (error) => error === initializationToken);
    assert.ok(partialInstance instanceof api.RuntimeTool);
    assert.equal(Object.hasOwn(partialInstance, '_externalURLHandler'), false);
    assert.equal(api.runtimeTool(), partialInstance);
});

test('RuntimeTool 필드 초기화 재진입은 가장 나중에 등록된 내부 인스턴스를 유지한다', async () => {
    const api = await loadRuntimeToolNamespace();
    let innerInstance = null;
    let setterCalls = 0;
    Object.defineProperty(api.RuntimeTool.prototype, '_externalURLHandler', {
        configurable: true,
        set() {
            setterCalls += 1;
            if (setterCalls === 1) {
                innerInstance = new api.RuntimeTool();
            }
        }
    });

    const outerInstance = new api.RuntimeTool();
    assert.equal(setterCalls, 2);
    assert.ok(innerInstance instanceof api.RuntimeTool);
    assert.notEqual(innerInstance, outerInstance);
    assert.equal(api.runtimeTool(), innerInstance);
    assert.equal(Object.hasOwn(outerInstance, '_externalURLHandler'), false);
    assert.equal(Object.hasOwn(innerInstance, '_externalURLHandler'), false);
});
