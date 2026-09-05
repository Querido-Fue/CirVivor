import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SAVE_ROOT = fileURLToPath(new URL('../project/game/script/module/save/', import.meta.url));
const SAVE_DATA_ROOT = fileURLToPath(new URL('../project/game/script/data/save/', import.meta.url));
const SOURCE_PATHS = Object.freeze({
    progress: path.join(SAVE_ROOT, '_progress_handler.js'),
    ingame: path.join(SAVE_ROOT, '_ingame_handler.js'),
    helper: path.join(SAVE_ROOT, '_save_file_helper.js'),
    defaults: path.join(SAVE_DATA_ROOT, 'save_defaults.js')
});

const [progressSource, ingameSource, helperSource, defaultsSource] = await Promise.all([
    readFile(SOURCE_PATHS.progress, 'utf8'),
    readFile(SOURCE_PATHS.ingame, 'utf8'),
    readFile(SOURCE_PATHS.helper, 'utf8'),
    readFile(SOURCE_PATHS.defaults, 'utf8')
]);

const EXECUTABLE_SOURCE_HASHES = Object.freeze({
    progress: '4a859bfd12c49738da13b48bd6b6ed7ac8a7a3dab7b282cbc192adb6e7ed7c17',
    ingame: 'f08af33433480922f2438601ad874f01b1dc573a8f8c7f8426035d6da289bbd4',
    helper: '83d03d997567243009a7956f8e6e20f335fc52b28b490d609ea8639dc9f5f5aa'
});

/**
 * 대상 JSDoc만 제거한 실행 소스의 안정적인 해시를 계산합니다.
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
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞 JSDoc 본문을 찾습니다.
 * @param {string} source - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(source, escapedDeclaration) {
    const match = source.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`));
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

/**
 * 테스트용 오류를 만듭니다.
 * @param {string} code - Node 오류 코드입니다.
 * @returns {Error} 생성된 오류입니다.
 */
function createFsError(code) {
    return Object.assign(new Error(code), { code });
}

/**
 * 실제 save production 모듈을 가짜 NW.js 파일 시스템과 함께 로드합니다.
 * @param {object} [overrides] - 파일 시스템 동작 재정의입니다.
 * @returns {Promise<object>} 모듈 namespace와 호출 기록입니다.
 */
async function createSaveHarness(overrides = {}) {
    const calls = {
        access: [],
        mkdir: [],
        readFile: [],
        writeFile: [],
        join: [],
        consoleError: []
    };
    const implementations = {
        access: overrides.access ?? (async () => undefined),
        mkdir: overrides.mkdir ?? (async () => undefined),
        readFile: overrides.readFile ?? (async () => Buffer.alloc(0)),
        writeFile: overrides.writeFile ?? (async () => undefined)
    };
    const fsPromises = {};

    for (const methodName of ['access', 'mkdir', 'readFile', 'writeFile']) {
        fsPromises[methodName] = async (...args) => {
            calls[methodName].push(args);
            return implementations[methodName](...args);
        };
    }

    const pathApi = {
        join(...parts) {
            calls.join.push(parts);
            return parts.join('/');
        }
    };
    const consoleApi = {
        ...console,
        error(...args) {
            calls.consoleError.push(args);
        }
    };
    const contextGlobals = {
        Buffer,
        JSON,
        console: consoleApi
    };
    if (!overrides.isolateTypedArrayRealm) {
        contextGlobals.Array = Array;
        contextGlobals.Uint8Array = Uint8Array;
    }
    const context = vm.createContext(contextGlobals);
    const nwBridgeModule = new vm.SyntheticModule(
        ['fsPromises', 'path'],
        function initializeNwBridge() {
            this.setExport('fsPromises', fsPromises);
            this.setExport('path', pathApi);
        },
        { context, identifier: 'util/nw_bridge.js' }
    );
    const helperModule = new vm.SourceTextModule(helperSource, {
        context,
        identifier: 'save/_save_file_helper.js'
    });
    const progressModule = new vm.SourceTextModule(progressSource, {
        context,
        identifier: 'save/_progress_handler.js'
    });
    const ingameModule = new vm.SourceTextModule(ingameSource, {
        context,
        identifier: 'save/_ingame_handler.js'
    });
    const defaultsModule = new vm.SourceTextModule(defaultsSource, {
        context,
        identifier: 'data/save/save_defaults.js'
    });
    const linker = (specifier) => {
        if (specifier === 'util/nw_bridge.js') {
            return nwBridgeModule;
        }
        if (specifier === 'data/save/save_defaults.js') {
            return defaultsModule;
        }
        if (specifier === './_save_file_helper.js') {
            return helperModule;
        }
        throw new Error(`지원하지 않는 테스트 import입니다: ${specifier}`);
    };

    await progressModule.link(linker);
    await ingameModule.link(linker);
    await progressModule.evaluate();
    await ingameModule.evaluate();

    return {
        calls,
        helper: helperModule.namespace,
        defaults: defaultsModule.namespace,
        progress: progressModule.namespace,
        ingame: ingameModule.namespace,
        realm: {
            Uint8Array: vm.runInContext('Uint8Array', context)
        }
    };
}

test('save 기본값은 data 모듈이 소유하고 파일 helper 실행 소스는 유지된다', async () => {
    assert.equal(hashExecutableSource(progressSource, 8), EXECUTABLE_SOURCE_HASHES.progress);
    assert.equal(hashExecutableSource(ingameSource, 7), EXECUTABLE_SOURCE_HASHES.ingame);
    assert.equal(hashExecutableSource(helperSource, 3), EXECUTABLE_SOURCE_HASHES.helper);
    assert.match(progressSource, /data\/save\/save_defaults\.js/);
    assert.match(ingameSource, /data\/save\/save_defaults\.js/);

    const harness = await createSaveHarness();
    assert.equal(harness.defaults.PROGRESS_DEFAULT_BYTE_LENGTH, 128);
    assert.equal(harness.defaults.INGAME_DEFAULT_DATA.current_level, 0);
    assert.equal(harness.defaults.INGAME_DEFAULT_DATA.current_xp, 0);
    assert.deepEqual(Array.from(harness.defaults.INGAME_DEFAULT_DATA.items), []);
});

test('save JSDoc은 Promise, live 참조, 정규화, 최상위 병합과 오류 축약 계약을 명시한다', () => {
    const progressConstructorDoc = findLeadingJsDoc(progressSource, 'export class ProgressHandler');
    const progressInitDoc = findLeadingJsDoc(progressSource, 'async init\\(\\)');
    const progressLoadDoc = findLeadingJsDoc(progressSource, 'async #load\\(\\)');
    const progressSaveDoc = findLeadingJsDoc(progressSource, 'async save\\(\\)');
    const progressGetDataDoc = findLeadingJsDoc(progressSource, 'getData\\(\\)');
    const progressSetDataDoc = findLeadingJsDoc(progressSource, 'setData\\(data\\)');

    assert.match(progressConstructorDoc, /@param \{string\} dataDir/);
    assert.match(progressInitDoc, /@returns \{Promise<void>\}/);
    assert.match(progressLoadDoc, /@returns \{Promise<void>\}/);
    assert.match(progressLoadDoc, /stale/);
    assert.match(progressSaveDoc, /@returns \{Promise<void>\}/);
    assert.match(progressGetDataDoc, /live/);
    assert.match(progressGetDataDoc, /자동 저장하지 않습니다/);
    assert.match(progressGetDataDoc, /stale/);
    assert.match(progressSetDataDoc, /@param \{\*\} data/);
    assert.match(progressSetDataDoc, /새.*배열/);
    assert.match(progressSetDataDoc, /@returns \{void\}/);
    assert.match(progressSource, /기본 128바이트/);

    const ingameConstructorDoc = findLeadingJsDoc(ingameSource, 'export class IngameHandler');
    const ingameInitDoc = findLeadingJsDoc(ingameSource, 'async init\\(\\)');
    const ingameLoadDoc = findLeadingJsDoc(ingameSource, 'async #load\\(\\)');
    const ingameSaveDoc = findLeadingJsDoc(ingameSource, 'async save\\(\\)');
    const ingameGetDataDoc = findLeadingJsDoc(ingameSource, 'getData\\(\\)');
    const ingameSetDataDoc = findLeadingJsDoc(ingameSource, 'setData\\(key, value\\)');
    const ingameGetValueDoc = findLeadingJsDoc(ingameSource, 'getValue\\(key\\)');

    assert.match(ingameConstructorDoc, /@param \{string\} dataDir/);
    assert.match(ingameInitDoc, /@returns \{Promise<void>\}/);
    assert.match(ingameLoadDoc, /최상위/);
    assert.match(ingameLoadDoc, /중첩 병합/);
    assert.match(ingameLoadDoc, /알 수 없는/);
    assert.match(ingameLoadDoc, /stale/);
    assert.match(ingameLoadDoc, /@returns \{Promise<void>\}/);
    assert.match(ingameSaveDoc, /@returns \{Promise<void>\}/);
    assert.match(ingameSaveDoc, /직렬화/);
    assert.match(ingameGetDataDoc, /live/);
    assert.match(ingameGetDataDoc, /자동 저장하지 않습니다/);
    assert.match(ingameSetDataDoc, /최상위/);
    assert.match(ingameSetDataDoc, /@returns \{void\}/);
    assert.match(ingameGetValueDoc, /live/);

    const pathExistsDoc = findLeadingJsDoc(helperSource, 'export const pathExists');
    const ensureDirectoryDoc = findLeadingJsDoc(helperSource, 'export const ensureSaveDirectory');
    const cloneDoc = findLeadingJsDoc(helperSource, 'export const cloneJsonData');

    assert.match(pathExistsDoc, /모든.*실패/);
    assert.match(ensureDirectoryDoc, /디렉터리인지.*확인하지 않습니다/);
    assert.match(ensureDirectoryDoc, /recursive/);
    assert.match(cloneDoc, /@param \{\*\} data/);
    assert.match(cloneDoc, /@returns \{\*\}/);
    assert.match(cloneDoc, /@throws \{TypeError\|SyntaxError\}/);
});

test('save file helper는 모든 access 오류를 false로 축약하고 디렉터리 생성 실패를 그대로 전파한다', async () => {
    let accessFailure;
    let mkdirFailure;
    const harness = await createSaveHarness({
        access: async () => {
            if (accessFailure !== undefined) {
                throw accessFailure;
            }
        },
        mkdir: async () => {
            if (mkdirFailure !== undefined) {
                throw mkdirFailure;
            }
        }
    });
    const { pathExists, ensureSaveDirectory } = harness.helper;

    assert.equal(await pathExists('existing'), true);
    for (const failure of [createFsError('ENOENT'), createFsError('EACCES'), 'primitive rejection']) {
        accessFailure = failure;
        assert.equal(await pathExists(`failed-${String(failure.code ?? failure)}`), false);
    }

    accessFailure = undefined;
    const mkdirCountBeforeExistingPath = harness.calls.mkdir.length;
    assert.equal(await ensureSaveDirectory('accessible-file-path', '테스트'), undefined);
    assert.equal(harness.calls.mkdir.length, mkdirCountBeforeExistingPath);

    accessFailure = createFsError('EIO');
    assert.equal(await ensureSaveDirectory('missing-or-inaccessible', '테스트'), undefined);
    const [mkdirPath, mkdirOptions] = harness.calls.mkdir.at(-1);
    assert.equal(mkdirPath, 'missing-or-inaccessible');
    assert.deepEqual(Object.keys(mkdirOptions), ['recursive']);
    assert.equal(mkdirOptions.recursive, true);

    mkdirFailure = createFsError('EROFS');
    await assert.rejects(
        ensureSaveDirectory('cannot-create', '저장 테스트'),
        (error) => error === mkdirFailure
    );
    assert.equal(harness.calls.consoleError.length, 1);
    assert.equal(harness.calls.consoleError[0][0], '저장 테스트 디렉토리 생성 실패:');
    assert.equal(harness.calls.consoleError[0][1], mkdirFailure);
});

test('cloneJsonData는 JSON round-trip의 손실 변환, 독립 복사와 예외를 그대로 유지한다', async () => {
    const harness = await createSaveHarness();
    const { cloneJsonData } = harness.helper;
    const source = {
        nested: { value: 3 },
        list: [1, undefined, Number.NaN, Number.POSITIVE_INFINITY],
        omitted: undefined,
        date: new Date('2026-07-19T00:00:00.000Z')
    };
    const clone = cloneJsonData(source);

    assert.notEqual(clone, source);
    assert.notEqual(clone.nested, source.nested);
    assert.deepEqual(clone.nested, { value: 3 });
    assert.deepEqual(clone.list, [1, null, null, null]);
    assert.equal('omitted' in clone, false);
    assert.equal(clone.date, '2026-07-19T00:00:00.000Z');
    for (const primitive of [null, true, false, 0, 17.5, 'save']) {
        assert.equal(cloneJsonData(primitive), primitive);
    }
    assert.equal(cloneJsonData(Number.NaN), null);

    for (const unsupported of [undefined, () => undefined, Symbol('save')]) {
        assert.throws(() => cloneJsonData(unsupported), SyntaxError);
    }
    assert.throws(() => cloneJsonData(1n), TypeError);
    const cyclic = {};
    cyclic.self = cyclic;
    assert.throws(() => cloneJsonData(cyclic), TypeError);
});

test('ProgressHandler는 128바이트 새 배열, live 참조, Uint8 변환과 저장 시점 데이터를 보존한다', async () => {
    const harness = await createSaveHarness();
    const { ProgressHandler } = harness.progress;
    const handler = new ProgressHandler('C:/save-root');

    assert.deepEqual(harness.calls.join, [['C:/save-root', 'progress.dat']]);
    assert.equal(handler.filePath, 'C:/save-root/progress.dat');
    assert.equal(handler.defaultData.length, 128);
    assert.equal(handler.getData().length, 128);
    assert.notEqual(handler.getData(), handler.defaultData);
    assert.deepEqual(Array.from(handler.getData()), new Array(128).fill(0));

    const initialLiveReference = handler.getData();
    initialLiveReference[0] = 91;
    assert.equal(handler.getData(), initialLiveReference);
    assert.equal(handler.getData()[0], 91);
    assert.equal(harness.calls.writeFile.length, 0);

    const cases = [
        { input: [], prefix: [] },
        { input: [-1, 256, Number.NaN, 1.9], prefix: [255, 0, 0, 1] },
        { input: Uint8Array.from([4, 5, 6]), prefix: [4, 5, 6] },
        { input: Buffer.from([7, 8]), prefix: [7, 8] },
        { input: Array.from({ length: 129 }, (_, index) => index), prefix: Array.from({ length: 128 }, (_, index) => index) },
        { input: { unsupported: true }, prefix: [] }
    ];
    let previousReference = initialLiveReference;
    for (const { input, prefix } of cases) {
        assert.equal(handler.setData(input), undefined);
        const nextReference = handler.getData();
        assert.notEqual(nextReference, previousReference);
        assert.equal(nextReference.length, 128);
        assert.deepEqual(Array.from(nextReference.slice(0, prefix.length)), prefix);
        assert.deepEqual(Array.from(nextReference.slice(prefix.length)), new Array(128 - prefix.length).fill(0));
        previousReference = nextReference;
    }
    assert.equal(harness.calls.writeFile.length, 0);

    const dataAtWriteTime = handler.getData();
    dataAtWriteTime[127] = 211;
    assert.equal(await handler.save(), undefined);
    assert.deepEqual(harness.calls.access.at(-1), ['C:/save-root']);
    assert.equal(harness.calls.mkdir.length, 0);
    assert.equal(harness.calls.writeFile.length, 1);
    assert.equal(harness.calls.writeFile[0][0], 'C:/save-root/progress.dat');
    assert.equal(harness.calls.writeFile[0][1], dataAtWriteTime);
});

test('ProgressHandler는 same-realm Uint8Array와 Buffer를 처리하고 foreign Uint8Array는 기본값으로 대체한다', async () => {
    const harness = await createSaveHarness({ isolateTypedArrayRealm: true });
    const handler = new harness.progress.ProgressHandler('save');
    const foreignTypedArray = Uint8Array.from([17, 23, 41]);

    handler.setData(foreignTypedArray);
    assert.equal(handler.getData().constructor, harness.realm.Uint8Array);
    assert.deepEqual(Array.from(handler.getData()), new Array(128).fill(0));

    const sameRealmTypedArray = harness.realm.Uint8Array.from([5, 8, 13]);
    handler.setData(sameRealmTypedArray);
    assert.deepEqual(Array.from(handler.getData().slice(0, 3)), [5, 8, 13]);
    assert.notEqual(handler.getData(), sameRealmTypedArray);

    handler.setData(Buffer.from([21, 34]));
    assert.deepEqual(Array.from(handler.getData().slice(0, 2)), [21, 34]);

    const foreignArray = vm.runInNewContext('[55, 89]');
    handler.setData(foreignArray);
    assert.deepEqual(Array.from(handler.getData().slice(0, 2)), [55, 89]);
});

test('ProgressHandler.init은 파일 부재, 길이 경계, 미지원 입력과 읽기 실패의 교체 계약을 보존한다', async () => {
    const missingHarness = await createSaveHarness({
        access: async (targetPath) => {
            if (targetPath.endsWith('progress.dat')) {
                throw createFsError('ENOENT');
            }
        }
    });
    const missingHandler = new missingHarness.progress.ProgressHandler('save');
    const missingOldReference = missingHandler.getData();
    missingOldReference[0] = 77;
    assert.equal(await missingHandler.init(), undefined);
    assert.notEqual(missingHandler.getData(), missingOldReference);
    assert.deepEqual(Array.from(missingHandler.getData()), new Array(128).fill(0));
    assert.deepEqual(missingHarness.calls.access, [['save/progress.dat'], ['save']]);
    assert.equal(missingHarness.calls.writeFile.length, 1);

    const lengths = [0, 1, 127, 128, 129, 4096];
    for (const length of lengths) {
        const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 17) & 0xff));
        const harness = await createSaveHarness({ readFile: async () => bytes });
        const handler = new harness.progress.ProgressHandler('save');
        const oldReference = handler.getData();
        assert.equal(await handler.init(), undefined);
        assert.notEqual(handler.getData(), oldReference);
        assert.equal(handler.getData().length, 128);
        assert.deepEqual(Array.from(handler.getData().slice(0, Math.min(length, 128))), Array.from(bytes.subarray(0, 128)));
        assert.deepEqual(
            Array.from(handler.getData().slice(Math.min(length, 128))),
            new Array(Math.max(0, 128 - length)).fill(0)
        );
        assert.equal(harness.calls.writeFile.length, 0);
    }

    const unsupportedHarness = await createSaveHarness({ readFile: async () => ({ bytes: [1, 2] }) });
    const unsupportedHandler = new unsupportedHarness.progress.ProgressHandler('save');
    await unsupportedHandler.init();
    assert.deepEqual(Array.from(unsupportedHandler.getData()), new Array(128).fill(0));

    const readFailure = createFsError('EIO');
    const failedHarness = await createSaveHarness({ readFile: async () => { throw readFailure; } });
    const failedHandler = new failedHarness.progress.ProgressHandler('save');
    const failedOldReference = failedHandler.getData();
    failedOldReference[0] = 55;
    assert.equal(await failedHandler.init(), undefined);
    assert.notEqual(failedHandler.getData(), failedOldReference);
    assert.deepEqual(Array.from(failedHandler.getData()), new Array(128).fill(0));
    assert.equal(failedHarness.calls.writeFile.length, 0);
    assert.equal(failedHarness.calls.consoleError.length, 1);
    assert.equal(failedHarness.calls.consoleError[0][0], '진행 데이터 로드 실패:');
    assert.equal(failedHarness.calls.consoleError[0][1], readFailure);
});

test('IngameHandler는 live 단일 키 API와 누락된 최상위 기본값만 보완하는 병합을 보존한다', async () => {
    const completePayload = {
        current_level: null,
        current_xp: 0,
        items: false,
        unknown: { live: true }
    };
    const completeHarness = await createSaveHarness({
        readFile: async () => JSON.stringify(completePayload)
    });
    const completeHandler = new completeHarness.ingame.IngameHandler('save');
    const constructorReference = completeHandler.getData();
    assert.deepEqual(completeHarness.calls.join, [['save', 'ingame.dat']]);
    assert.equal(await completeHandler.init(), undefined);
    assert.notEqual(completeHandler.getData(), constructorReference);
    assert.equal(completeHandler.getValue('current_level'), null);
    assert.equal(completeHandler.getValue('current_xp'), 0);
    assert.equal(completeHandler.getValue('items'), false);
    assert.equal(completeHandler.getValue('unknown').live, true);
    assert.equal(completeHarness.calls.writeFile.length, 0);

    const liveReference = completeHandler.getData();
    assert.equal(completeHandler.setData('score', { value: 12 }), undefined);
    assert.equal(completeHandler.getData(), liveReference);
    assert.equal(completeHandler.getValue('score'), liveReference.score);
    completeHandler.getValue('score').value = 18;
    assert.equal(liveReference.score.value, 18);
    assert.equal(completeHarness.calls.writeFile.length, 0);

    const mergeHarness = await createSaveHarness({
        readFile: async () => JSON.stringify({
            current_level: 5,
            profile: { existing: 9 }
        })
    });
    const mergeHandler = new mergeHarness.ingame.IngameHandler('save');
    mergeHandler.defaultData.profile = { existing: 0, nestedDefault: 7 };
    assert.equal(await mergeHandler.init(), undefined);
    assert.equal(mergeHandler.getValue('current_level'), 5);
    assert.equal(mergeHandler.getValue('current_xp'), 0);
    assert.equal(mergeHandler.getValue('items'), mergeHandler.defaultData.items);
    assert.equal(mergeHandler.getValue('profile').existing, 9);
    assert.equal('nestedDefault' in mergeHandler.getValue('profile'), false);
    assert.equal(mergeHarness.calls.writeFile.length, 1);
    assert.equal(mergeHarness.calls.writeFile[0][0], 'save/ingame.dat');
    assert.equal(mergeHarness.calls.writeFile[0][1], JSON.stringify(mergeHandler.getData(), null, 4));
});

test('IngameHandler.init은 파일 부재, 파싱 오류, 배열 root와 보완 저장 실패의 실제 경계를 보존한다', async () => {
    const missingHarness = await createSaveHarness({
        access: async (targetPath) => {
            if (targetPath.endsWith('ingame.dat')) {
                throw createFsError('ENOENT');
            }
        }
    });
    const missingHandler = new missingHarness.ingame.IngameHandler('save');
    const missingOldReference = missingHandler.getData();
    assert.equal(await missingHandler.init(), undefined);
    assert.notEqual(missingHandler.getData(), missingOldReference);
    assert.notEqual(missingHandler.getValue('items'), missingHandler.defaultData.items);
    assert.equal(missingHarness.calls.writeFile.length, 1);

    for (const invalidPayload of ['{invalid json', 'null']) {
        const harness = await createSaveHarness({ readFile: async () => invalidPayload });
        const handler = new harness.ingame.IngameHandler('save');
        assert.equal(await handler.init(), undefined);
        assert.equal(handler.getValue('current_level'), 0);
        assert.equal(handler.getValue('current_xp'), 0);
        assert.deepEqual(Array.from(handler.getValue('items')), []);
        assert.notEqual(handler.getValue('items'), handler.defaultData.items);
        assert.equal(harness.calls.writeFile.length, 0);
        assert.equal(harness.calls.consoleError.length, 1);
        assert.equal(harness.calls.consoleError[0][0], '인게임 데이터 로드 실패:');
    }

    const arrayHarness = await createSaveHarness({ readFile: async () => '[]' });
    const arrayHandler = new arrayHarness.ingame.IngameHandler('save');
    assert.equal(await arrayHandler.init(), undefined);
    assert.equal(Array.isArray(arrayHandler.getData()), true);
    assert.equal(arrayHandler.getValue('current_level'), 0);
    assert.equal(arrayHandler.getValue('items'), arrayHandler.defaultData.items);
    assert.equal(arrayHarness.calls.writeFile.length, 1);
    assert.equal(arrayHarness.calls.writeFile[0][1], '[]');

    const repairWriteFailure = createFsError('ENOSPC');
    const repairHarness = await createSaveHarness({
        readFile: async () => '{"current_level": 9}',
        writeFile: async () => { throw repairWriteFailure; }
    });
    const repairHandler = new repairHarness.ingame.IngameHandler('save');
    assert.equal(await repairHandler.init(), undefined);
    assert.equal(repairHandler.getValue('current_level'), 0);
    assert.equal(repairHandler.getValue('current_xp'), 0);
    assert.notEqual(repairHandler.getValue('items'), repairHandler.defaultData.items);
    assert.equal(repairHarness.calls.consoleError.length, 2);
    assert.equal(repairHarness.calls.consoleError[0][0], '인게임 데이터 저장 실패:');
    assert.equal(repairHarness.calls.consoleError[0][1], repairWriteFailure);
    assert.equal(repairHarness.calls.consoleError[1][0], '인게임 데이터 로드 실패:');
    assert.equal(repairHarness.calls.consoleError[1][1], repairWriteFailure);
});

test('IngameHandler.save는 JSON 직렬화 예외와 파일 쓰기 실패 순서를 보존한다', async () => {
    const serializationHarness = await createSaveHarness();
    const serializationHandler = new serializationHarness.ingame.IngameHandler('save');
    const cyclic = {};
    cyclic.self = cyclic;
    serializationHandler.data = cyclic;
    await assert.rejects(serializationHandler.save(), TypeError);
    assert.equal(serializationHarness.calls.access.length, 1);
    assert.equal(serializationHarness.calls.writeFile.length, 0);
    assert.equal(serializationHarness.calls.consoleError.length, 0);

    serializationHandler.data = { value: 1n };
    await assert.rejects(serializationHandler.save(), TypeError);
    assert.equal(serializationHarness.calls.access.length, 2);
    assert.equal(serializationHarness.calls.writeFile.length, 0);
    assert.equal(serializationHarness.calls.consoleError.length, 0);

    const writeFailure = createFsError('EROFS');
    const writeHarness = await createSaveHarness({
        writeFile: async () => { throw writeFailure; }
    });
    const writeHandler = new writeHarness.ingame.IngameHandler('save');
    writeHandler.data = { current_level: 4 };
    await assert.rejects(writeHandler.save(), (error) => error === writeFailure);
    assert.equal(writeHarness.calls.writeFile.length, 1);
    assert.equal(writeHarness.calls.consoleError.length, 1);
    assert.equal(writeHarness.calls.consoleError[0][0], '인게임 데이터 저장 실패:');
    assert.equal(writeHarness.calls.consoleError[0][1], writeFailure);
});
