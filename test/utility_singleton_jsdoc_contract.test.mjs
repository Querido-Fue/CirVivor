import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const EXECUTABLE_SOURCE_HASHES = Object.freeze({
    math: 'b9b2376f1d0a5636d9cf818451514cf23a5566afe79aa51204d15379655ec54d',
    color: '2eef69a1a3bc8291e13a3576481676f25029d35f07aa8fe61ea90063d7b8ebf4',
    runtime: 'edffe87defef7d1af5ed3256459ec4df42683cb004bd45f873a3847eab5a803b'
});

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
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
 * 특정 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} source - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(source, escapedDeclaration) {
    const match = source.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

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

test('유틸리티 JSDoc 변경은 세 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(mathUtilSource), EXECUTABLE_SOURCE_HASHES.math);
    assert.equal(hashExecutableSource(colorUtilSource), EXECUTABLE_SOURCE_HASHES.color);
    assert.equal(hashExecutableSource(runtimeToolSource), EXECUTABLE_SOURCE_HASHES.runtime);
});

test('유틸리티 JSDoc은 실제 기능과 nullable 최신 인스턴스 계약을 명시한다', () => {
    const mathClassDoc = findLeadingJsDoc(mathUtilSource, 'export class MathUtil');
    assert.match(mathClassDoc, /시드 기반 난수/);
    assert.match(mathClassDoc, /각도.*벡터/);
    assert.match(mathClassDoc, /감쇠.*범위 제한/);
    assert.doesNotMatch(mathClassDoc, /Simplex Noise/);

    const mathAccessorDoc = findLeadingJsDoc(mathUtilSource, 'export function mathUtil\\(\\)');
    assert.match(mathAccessorDoc, /가장 최근에 생성된 MathUtil/);
    assert.match(mathAccessorDoc, /생성 전.*null/);
    assert.match(mathAccessorDoc, /@returns \{MathUtil\|null\}/);

    const colorAccessorDoc = findLeadingJsDoc(colorUtilSource, 'export function colorUtil\\(\\)');
    assert.match(colorAccessorDoc, /가장 최근에 생성된 ColorUtil/);
    assert.match(colorAccessorDoc, /생성 전.*null/);
    assert.match(colorAccessorDoc, /@returns \{ColorUtil\|null\}/);

    const runtimeAccessorDoc = findLeadingJsDoc(
        runtimeToolSource,
        'export function runtimeTool\\(\\)'
    );
    assert.match(runtimeAccessorDoc, /가장 최근에 생성이 시작되어 등록된 RuntimeTool/);
    assert.match(runtimeAccessorDoc, /필드.*초기화.*전에.*등록/);
    assert.match(runtimeAccessorDoc, /초기화.*실패.*유지/);
    assert.match(runtimeAccessorDoc, /생성 전.*null/);
    assert.match(runtimeAccessorDoc, /@returns \{RuntimeTool\|null\}/);
});

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
