import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const GAME_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT_ROOT = path.join(GAME_ROOT, 'script');
const STEERING_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'object',
    'enemy',
    'ai',
    '_enemy_ai_steering.js'
);
const CORE_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'object',
    'enemy',
    'ai',
    '_enemy_ai_core.js'
);
const CALL_MODE_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'object',
    'enemy',
    'ai',
    '_enemy_ai_steering_call_mode.js'
);
const STEERING_URL = pathToFileURL(STEERING_PATH).href;
const CORE_URL = pathToFileURL(CORE_PATH).href;
const CALL_MODE_URL = pathToFileURL(CALL_MODE_PATH).href;
const TOKEN_EXPORT_NAME = 'ENEMY_AI_STEERING_POSITIONAL_CALL';
const OPTION_KEYS = Object.freeze([
    'enemy',
    'state',
    'context',
    'profile',
    'startX',
    'startY',
    'targetX',
    'targetY',
    'walls',
    'enemyRadius',
    'footprintMetrics',
    'wallsVersion',
    'forcedPolicyRefresh',
    'aiDebugStats'
]);
const ALIAS_ROOTS = Object.freeze({
    'animation/': path.join(SCRIPT_ROOT, 'module', 'animation'),
    'data/': path.join(SCRIPT_ROOT, 'data'),
    'debug/': path.join(SCRIPT_ROOT, 'module', 'debug'),
    'display/': path.join(SCRIPT_ROOT, 'module', 'display'),
    'game/': SCRIPT_ROOT,
    'input/': path.join(SCRIPT_ROOT, 'module', 'input'),
    'object/': path.join(SCRIPT_ROOT, 'module', 'object'),
    'overlay/': path.join(SCRIPT_ROOT, 'module', 'overlay'),
    'physics/': path.join(SCRIPT_ROOT, 'module', 'physics'),
    'save/': path.join(SCRIPT_ROOT, 'module', 'save'),
    'scene/': path.join(SCRIPT_ROOT, 'module', 'scene'),
    'simulation/': path.join(SCRIPT_ROOT, 'module', 'simulation'),
    'sound/': path.join(SCRIPT_ROOT, 'module', 'sound'),
    'ui/': path.join(SCRIPT_ROOT, 'module', 'ui'),
    'util/': path.join(SCRIPT_ROOT, 'util')
});

const STEERING_DEBUG_IMPORT = [
    "import { incrementEnemyAIDebugCounter } from './_enemy_ai_debug_stats.js';"
].join('\n');
const STEERING_TOKEN_IMPORT = [
    "import { ENEMY_AI_STEERING_POSITIONAL_CALL } from './_enemy_ai_steering_call_mode.js';"
].join('\n');
const STEERING_CONSTANT_ANCHOR = [
    'const HEXA_HIVE_TYPE = getHexaHiveType();'
].join('\n');
const STEERING_INVALID_OPTIONS_HELPER = [
    '/**',
    ' * 공개 API의 null/undefined formal destructuring 예외 계약을 유지합니다.',
    ' * @param {object|null|undefined} options - 검증할 공개 options입니다.',
    ' * @returns {*} options의 enemy 값입니다.',
    ' */',
    'const readInvalidEnemyAISteeringOptions = ({ enemy }) => enemy;'
].join('\n');
const LEGACY_STEERING_HEADER = [
    'export function resolveEnemyAISteeringDirection({',
    '    enemy,',
    '    state,',
    '    context,',
    '    profile,',
    '    startX,',
    '    startY,',
    '    targetX,',
    '    targetY,',
    '    walls,',
    '    enemyRadius,',
    '    footprintMetrics,',
    '    wallsVersion,',
    '    forcedPolicyRefresh,',
    '    aiDebugStats',
    '}) {'
].join('\n');
const CANDIDATE_STEERING_HEADER = [
    'export function resolveEnemyAISteeringDirection(',
    '    enemy,',
    '    state = undefined,',
    '    context,',
    '    profile,',
    '    startX,',
    '    startY,',
    '    targetX,',
    '    targetY,',
    '    walls,',
    '    enemyRadius,',
    '    footprintMetrics,',
    '    wallsVersion,',
    '    forcedPolicyRefresh,',
    '    aiDebugStats,',
    '    internalCallMode',
    ') {',
    '    if (internalCallMode !== ENEMY_AI_STEERING_POSITIONAL_CALL) {',
    '        const options = enemy;',
    '        if (options === null || options === undefined) readInvalidEnemyAISteeringOptions(options);',
    '        ({',
    '            enemy,',
    '            state,',
    '            context,',
    '            profile,',
    '            startX,',
    '            startY,',
    '            targetX,',
    '            targetY,',
    '            walls,',
    '            enemyRadius,',
    '            footprintMetrics,',
    '            wallsVersion,',
    '            forcedPolicyRefresh,',
    '            aiDebugStats',
    '        } = options);',
    '    }'
].join('\n');
const CORE_STEERING_IMPORT = [
    "import { resolveEnemyAISteeringDirection } from './_enemy_ai_steering.js';"
].join('\n');
const CORE_TOKEN_AND_STEERING_IMPORTS = [
    "import { ENEMY_AI_STEERING_POSITIONAL_CALL } from './_enemy_ai_steering_call_mode.js';",
    "import { resolveEnemyAISteeringDirection } from './_enemy_ai_steering.js';"
].join('\n');
const LEGACY_CORE_CALL = [
    '    const scratchDir = resolveEnemyAISteeringDirection({',
    '        enemy,',
    '        state,',
    '        context,',
    '        profile,',
    '        startX: updateFrame.startX,',
    '        startY: updateFrame.startY,',
    '        targetX: updateFrame.targetX,',
    '        targetY: updateFrame.targetY,',
    '        walls: updateFrame.walls,',
    '        enemyRadius: updateFrame.enemyRadius,',
    '        footprintMetrics: updateFrame.footprintMetrics,',
    '        wallsVersion: updateFrame.wallsVersion,',
    '        forcedPolicyRefresh,',
    '        aiDebugStats',
    '    });'
].join('\n');
const CANDIDATE_CORE_CALL = [
    '    const scratchDir = resolveEnemyAISteeringDirection(',
    '        enemy,',
    '        state,',
    '        context,',
    '        profile,',
    '        updateFrame.startX,',
    '        updateFrame.startY,',
    '        updateFrame.targetX,',
    '        updateFrame.targetY,',
    '        updateFrame.walls,',
    '        updateFrame.enemyRadius,',
    '        updateFrame.footprintMetrics,',
    '        updateFrame.wallsVersion,',
    '        forcedPolicyRefresh,',
    '        aiDebugStats,',
    '        ENEMY_AI_STEERING_POSITIONAL_CALL',
    '    );'
].join('\n');
const SYNTHETIC_CALL_MODE_SOURCE = [
    '/**',
    ' * 내부 hot path의 positional 호출을 식별하는 함수 identity입니다.',
    ' * @returns {void}',
    ' */',
    'export const ENEMY_AI_STEERING_POSITIONAL_CALL = () => {};',
    ''
].join('\n');

/**
 * 플랫폼 개행을 LF로 정규화합니다.
 * @param {string} source - 원문입니다.
 * @returns {string} 정규화된 원문입니다.
 */
function normalizeSource(source) {
    return source.replace(/\r\n?/g, '\n');
}

/**
 * 원문에 특정 블록이 존재하는 횟수를 셉니다.
 * @param {string} source - 검사할 원문입니다.
 * @param {string} block - 찾을 블록입니다.
 * @returns {number} 발견 횟수입니다.
 */
function countOccurrences(source, block) {
    return source.split(block).length - 1;
}

/**
 * 원문에서 정확히 한 번 존재하는 블록만 치환합니다.
 * @param {string} source - 원문입니다.
 * @param {string} before - 치환 전 블록입니다.
 * @param {string} after - 치환 후 블록입니다.
 * @param {string} label - 실패 메시지용 이름입니다.
 * @returns {string} 치환된 원문입니다.
 */
function replaceExactlyOnce(source, before, after, label) {
    const occurrenceCount = countOccurrences(source, before);
    assert.equal(occurrenceCount, 1, label + ' 블록은 정확히 한 번 존재해야 합니다.');
    return source.replace(before, after);
}

/**
 * legacy steering 원문을 positional 후보 원문으로 변환합니다.
 * @param {string} source - legacy steering 원문입니다.
 * @returns {string} 후보 원문입니다.
 */
function buildCandidateSteeringSource(source) {
    let nextSource = replaceExactlyOnce(
        source,
        STEERING_DEBUG_IMPORT,
        STEERING_DEBUG_IMPORT + '\n' + STEERING_TOKEN_IMPORT,
        'steering token import anchor'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        STEERING_CONSTANT_ANCHOR,
        STEERING_CONSTANT_ANCHOR + '\n\n' + STEERING_INVALID_OPTIONS_HELPER,
        'steering invalid options helper anchor'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        LEGACY_STEERING_HEADER,
        CANDIDATE_STEERING_HEADER,
        'legacy steering header'
    );
    return nextSource;
}

/**
 * positional steering 원문을 legacy 원문으로 되돌립니다.
 * @param {string} source - positional steering 원문입니다.
 * @returns {string} legacy 원문입니다.
 */
function buildLegacySteeringSource(source) {
    let nextSource = replaceExactlyOnce(
        source,
        STEERING_DEBUG_IMPORT + '\n' + STEERING_TOKEN_IMPORT,
        STEERING_DEBUG_IMPORT,
        'candidate steering token import'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        STEERING_CONSTANT_ANCHOR + '\n\n' + STEERING_INVALID_OPTIONS_HELPER,
        STEERING_CONSTANT_ANCHOR,
        'candidate steering invalid options helper'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        CANDIDATE_STEERING_HEADER,
        LEGACY_STEERING_HEADER,
        'candidate steering header'
    );
    return nextSource;
}

/**
 * legacy core 원문을 positional 후보 원문으로 변환합니다.
 * @param {string} source - legacy core 원문입니다.
 * @returns {string} 후보 원문입니다.
 */
function buildCandidateCoreSource(source) {
    let nextSource = replaceExactlyOnce(
        source,
        CORE_STEERING_IMPORT,
        CORE_TOKEN_AND_STEERING_IMPORTS,
        'core steering import'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        LEGACY_CORE_CALL,
        CANDIDATE_CORE_CALL,
        'legacy core steering call'
    );
    return nextSource;
}

/**
 * positional core 원문을 legacy 원문으로 되돌립니다.
 * @param {string} source - positional core 원문입니다.
 * @returns {string} legacy 원문입니다.
 */
function buildLegacyCoreSource(source) {
    let nextSource = replaceExactlyOnce(
        source,
        CORE_TOKEN_AND_STEERING_IMPORTS,
        CORE_STEERING_IMPORT,
        'candidate core token import'
    );
    nextSource = replaceExactlyOnce(
        nextSource,
        CANDIDATE_CORE_CALL,
        LEGACY_CORE_CALL,
        'candidate core steering call'
    );
    return nextSource;
}

/**
 * 현재 production 상태와 무관하게 legacy/candidate 양쪽 원문을 만듭니다.
 * @param {string} steeringSource - 현재 steering 원문입니다.
 * @param {string} coreSource - 현재 core 원문입니다.
 * @returns {{legacySteering:string,candidateSteering:string,legacyCore:string,candidateCore:string}}
 */
function deriveSourceVariants(steeringSource, coreSource) {
    const steeringIsLegacy = countOccurrences(steeringSource, LEGACY_STEERING_HEADER) === 1;
    const steeringIsCandidate = countOccurrences(steeringSource, CANDIDATE_STEERING_HEADER) === 1;
    const coreIsLegacy = countOccurrences(coreSource, LEGACY_CORE_CALL) === 1;
    const coreIsCandidate = countOccurrences(coreSource, CANDIDATE_CORE_CALL) === 1;
    assert.notEqual(steeringIsLegacy, steeringIsCandidate, 'steering 구현 상태를 하나로 판별해야 합니다.');
    assert.notEqual(coreIsLegacy, coreIsCandidate, 'core 구현 상태를 하나로 판별해야 합니다.');
    assert.equal(steeringIsLegacy, coreIsLegacy, 'steering과 core 호출 모드는 함께 전환되어야 합니다.');

    const legacySteering = steeringIsLegacy
        ? steeringSource
        : buildLegacySteeringSource(steeringSource);
    const candidateSteering = steeringIsCandidate
        ? steeringSource
        : buildCandidateSteeringSource(steeringSource);
    const legacyCore = coreIsLegacy ? coreSource : buildLegacyCoreSource(coreSource);
    const candidateCore = coreIsCandidate ? coreSource : buildCandidateCoreSource(coreSource);

    assert.equal(
        buildLegacySteeringSource(candidateSteering),
        legacySteering,
        'steering 후보→legacy 역변환이 원문과 일치해야 합니다.'
    );
    assert.equal(
        buildCandidateSteeringSource(legacySteering),
        candidateSteering,
        'steering legacy→후보 변환이 원문과 일치해야 합니다.'
    );
    assert.equal(
        buildLegacyCoreSource(candidateCore),
        legacyCore,
        'core 후보→legacy 역변환이 원문과 일치해야 합니다.'
    );
    assert.equal(
        buildCandidateCoreSource(legacyCore),
        candidateCore,
        'core legacy→후보 변환이 원문과 일치해야 합니다.'
    );
    return {
        legacySteering,
        candidateSteering,
        legacyCore,
        candidateCore
    };
}

/**
 * importmap 별칭과 상대 경로를 파일 URL로 해석합니다.
 * @param {string} specifier - import specifier입니다.
 * @param {string} parentUrl - 부모 모듈 URL입니다.
 * @returns {string} 해석된 파일 URL입니다.
 */
function resolveModuleUrl(specifier, parentUrl) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        return new URL(specifier, parentUrl).href;
    }
    for (const [prefix, root] of Object.entries(ALIAS_ROOTS)) {
        if (specifier.startsWith(prefix)) {
            return pathToFileURL(path.join(root, specifier.slice(prefix.length))).href;
        }
    }
    throw new Error('지원하지 않는 모듈 경로입니다: ' + specifier);
}

/**
 * source override를 가진 완전 독립 ESM 그래프 로더를 만듭니다.
 * @param {Map<string,string>} sourceOverrides - URL별 전체 원문 override입니다.
 * @returns {{load:(moduleUrl:string)=>Promise<vm.SourceTextModule>}} 로더입니다.
 */
function createIsolatedModuleLoader(sourceOverrides) {
    const context = vm.createContext({
        console,
        performance
    });
    const moduleCache = new Map();

    const getModule = (moduleUrl) => {
        if (!moduleCache.has(moduleUrl)) {
            moduleCache.set(moduleUrl, (async () => {
                const source = sourceOverrides.has(moduleUrl)
                    ? sourceOverrides.get(moduleUrl)
                    : normalizeSource(await readFile(fileURLToPath(moduleUrl), 'utf8'));
                return new vm.SourceTextModule(source, {
                    context,
                    identifier: moduleUrl,
                    initializeImportMeta(meta) {
                        meta.url = moduleUrl;
                    }
                });
            })());
        }
        return moduleCache.get(moduleUrl);
    };

    const load = async (moduleUrl) => {
        const module = await getModule(moduleUrl);
        if (module.status === 'unlinked') {
            await module.link((specifier, referencingModule) => (
                getModule(resolveModuleUrl(specifier, referencingModule.identifier))
            ));
        }
        if (module.status === 'linked') {
            await module.evaluate();
        }
        return module;
    };
    return { load };
}

/**
 * 하나의 구현 variant를 실제 의존성 그래프와 함께 로드합니다.
 * @param {'legacy'|'candidate'} kind - 호출 구현 종류입니다.
 * @param {string} steeringSource - variant steering 원문입니다.
 * @param {string} coreSource - variant core 원문입니다.
 * @param {string} callModeSource - 내부 호출 모듈 원문입니다.
 * @returns {Promise<object>} 테스트 runtime입니다.
 */
async function loadRuntime(kind, steeringSource, coreSource, callModeSource) {
    const sourceOverrides = new Map([
        [STEERING_URL, steeringSource],
        [CORE_URL, coreSource],
        [CALL_MODE_URL, callModeSource]
    ]);
    const loader = createIsolatedModuleLoader(sourceOverrides);
    const coreModule = await loader.load(CORE_URL);
    const steeringModule = await loader.load(STEERING_URL);
    const callModeModule = await loader.load(CALL_MODE_URL);
    const constantsModule = await loader.load(pathToFileURL(path.join(
        SCRIPT_ROOT,
        'data',
        'object',
        'enemy',
        'enemy_ai_constants.js'
    )).href);
    return {
        kind,
        steering: steeringModule.namespace,
        core: coreModule.namespace,
        callMode: callModeModule.namespace,
        constants: constantsModule.namespace
    };
}

const actualSteeringSource = normalizeSource(await readFile(STEERING_PATH, 'utf8'));
const actualCoreSource = normalizeSource(await readFile(CORE_PATH, 'utf8'));
let actualCallModeSource = null;
try {
    actualCallModeSource = normalizeSource(await readFile(CALL_MODE_PATH, 'utf8'));
} catch (error) {
    if (error?.code !== 'ENOENT') throw error;
}
const sourceVariants = deriveSourceVariants(actualSteeringSource, actualCoreSource);
const callModeSource = actualCallModeSource ?? SYNTHETIC_CALL_MODE_SOURCE;
const [legacyRuntime, candidateRuntime] = await Promise.all([
    loadRuntime(
        'legacy',
        sourceVariants.legacySteering,
        sourceVariants.legacyCore,
        callModeSource
    ),
    loadRuntime(
        'candidate',
        sourceVariants.candidateSteering,
        sourceVariants.candidateCore,
        callModeSource
    )
]);

// 비계약 항목: Error.stack, Function#toString(), 소스 행/열 위치는 비교하지 않습니다.

const float64Buffer = new ArrayBuffer(8);
const float64View = new DataView(float64Buffer);
const STATE_SNAPSHOT_KEYS = Object.freeze([
    'policyId',
    'flowPolicyKey',
    'flowKey',
    'targetX',
    'targetY',
    'desiredSpeed',
    'baseDesiredSpeed',
    'dirX',
    'dirY',
    'lastTargetCellX',
    'lastTargetCellY',
    'hasDirectPathResult',
    'lastDirectPath',
    'lastDirectPathWallsVersion',
    'lastDirectPathPad',
    'lastDirectPathStartX',
    'lastDirectPathStartY',
    'lastDirectPathTargetX',
    'lastDirectPathTargetY',
    'hexaHiveArrivalBrake'
]);

/**
 * 숫자를 Float64 원시 비트 토큰으로 변환합니다.
 * @param {number} value - 변환할 숫자입니다.
 * @returns {string} 16진수 원시 비트입니다.
 */
function numberBits(value) {
    float64View.setFloat64(0, value, false);
    return float64View.getBigUint64(0, false).toString(16).padStart(16, '0');
}

/**
 * 지정 비트 패턴의 Float64 숫자를 만듭니다.
 * @param {bigint} bits - IEEE-754 비트입니다.
 * @returns {number} 생성한 숫자입니다.
 */
function numberFromBits(bits) {
    float64View.setBigUint64(0, bits, false);
    return float64View.getFloat64(0, false);
}

/**
 * trace와 snapshot에 사용할 안정적인 원시 값 토큰을 만듭니다.
 * @param {*} value - 기록할 값입니다.
 * @returns {string} 비교용 토큰입니다.
 */
function valueToken(value) {
    if (typeof value === 'number') return 'number:' + numberBits(value);
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return 'string:' + value;
    if (typeof value === 'boolean') return 'boolean:' + String(value);
    if (typeof value === 'bigint') return 'bigint:' + String(value);
    if (typeof value === 'symbol') return 'symbol:' + String(value.description);
    if (Array.isArray(value)) return 'object:Array';
    if (ArrayBuffer.isView(value)) return 'view:' + value.constructor.name;
    return 'object:' + (value?.constructor?.name ?? 'null-prototype');
}

/**
 * TypedArray의 가시 바이트를 16진수로 직렬화합니다.
 * @param {ArrayBufferView} view - 직렬화할 view입니다.
 * @returns {string} 바이트 문자열입니다.
 */
function viewBytes(view) {
    return Array.from(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
}

/**
 * steering 상태의 관찰 가능한 값을 원시 비트 기준으로 스냅샷합니다.
 * @param {object} fixture - steering fixture입니다.
 * @returns {object} 비교용 스냅샷입니다.
 */
function snapshotSteeringFixture(fixture) {
    const state = {};
    for (const key of STATE_SNAPSHOT_KEYS) {
        state[key] = valueToken(fixture.stateTarget[key]);
    }
    const flowData = fixture.stateTarget.flowData;
    return {
        state,
        scratchDir: {
            x: valueToken(fixture.scratchDirTarget.x),
            y: valueToken(fixture.scratchDirTarget.y)
        },
        scratchCell: {
            cx: valueToken(fixture.stateTarget.scratchCell.cx),
            cy: valueToken(fixture.stateTarget.scratchCell.cy)
        },
        scratchGoalCell: {
            cx: valueToken(fixture.stateTarget.scratchGoalCell.cx),
            cy: valueToken(fixture.stateTarget.scratchGoalCell.cy)
        },
        flow: flowData ? {
            identity: flowData === fixture.initialFlowData,
            key: valueToken(flowData.key),
            clearance: valueToken(flowData.clearance),
            blocked: flowData.grid?.blocked ? viewBytes(flowData.grid.blocked) : null,
            dirX: flowData.field?.dirX ? viewBytes(flowData.field.dirX) : null,
            dirY: flowData.field?.dirY ? viewBytes(flowData.field.dirY) : null
        } : null
    };
}

/**
 * 예외 stack을 제외하고 실행 결과를 캡처합니다.
 * @param {Function} callback - 실행할 함수입니다.
 * @param {*} [sentinel] - identity로 구분할 sentinel입니다.
 * @returns {object} 성공 또는 예외 결과입니다.
 */
function capture(callback, sentinel = null) {
    try {
        return {
            ok: true,
            value: callback()
        };
    } catch (error) {
        return {
            ok: false,
            sentinel: sentinel !== null && error === sentinel,
            name: error?.name ?? null,
            message: error?.message ?? String(error),
            constructorName: error?.constructor?.name ?? null
        };
    }
}

/**
 * square direct-path 캐시 조건을 현재 옵션과 일치시킵니다.
 * @param {object} state - AI 상태입니다.
 * @param {object} options - steering 옵션입니다.
 * @param {object} profile - AI 프로필입니다.
 * @param {boolean} hasDirectPath - 캐시 결과입니다.
 */
function primeDirectPathCache(state, options, profile, hasDirectPath) {
    const directPad = Math.max(0, options.enemyRadius * profile.NAV_DIRECT_CHECK_PAD_RATIO);
    state.hasDirectPathResult = true;
    state.lastDirectPath = hasDirectPath;
    state.lastDirectPathWallsVersion = options.wallsVersion;
    state.lastDirectPathPad = directPad;
    state.lastDirectPathStartX = options.startX;
    state.lastDirectPathStartY = options.startY;
    state.lastDirectPathTargetX = state.targetX;
    state.lastDirectPathTargetY = state.targetY;
}

/**
 * state와 scratch 방향의 get/set 순서를 기록하는 Proxy를 만듭니다.
 * @param {object} target - 원본 객체입니다.
 * @param {string} label - trace 접두사입니다.
 * @param {Array} trace - trace 배열입니다.
 * @returns {Proxy} 관찰 Proxy입니다.
 */
function createTraceProxy(target, label, trace) {
    return new Proxy(target, {
        get(proxyTarget, key) {
            if (typeof key === 'string') trace.push(['get', label, key]);
            return Reflect.get(proxyTarget, key);
        },
        set(proxyTarget, key, value) {
            if (typeof key === 'string') trace.push(['set', label, key, valueToken(value)]);
            return Reflect.set(proxyTarget, key, value);
        }
    });
}

/**
 * 실제 steering 본문의 분기별 독립 fixture를 만듭니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {string} scenarioName - 시나리오 이름입니다.
 * @param {number} [numericTarget=0] - numeric edge 목표 X입니다.
 * @returns {object} 실행 fixture입니다.
 */
function createSteeringFixture(runtime, scenarioName, numericTarget = 0) {
    const constants = runtime.constants.ENEMY_AI_CONSTANTS;
    const profile = constants.QUALITY_PROFILES[constants.DEFAULT_QUALITY_PROFILE];
    const trace = [];
    const scratchDirTarget = { x: -0, y: +0 };
    const scratchDir = createTraceProxy(scratchDirTarget, 'scratchDir', trace);
    const stateTarget = {
        policyId: constants.POLICY.CHASE,
        flowPolicyKey: 'chase',
        flowKey: '',
        flowData: null,
        targetX: 180.25,
        targetY: 95.5,
        desiredSpeed: 140.75,
        baseDesiredSpeed: 140.75,
        dirX: 1,
        dirY: 0,
        scratchDir,
        scratchCell: { cx: 0, cy: 0 },
        scratchGoalCell: { cx: 0, cy: 0 },
        lastTargetCellX: 0,
        lastTargetCellY: 0,
        hasDirectPathResult: false,
        lastDirectPath: false,
        lastDirectPathWallsVersion: -1,
        lastDirectPathPad: Number.NaN,
        lastDirectPathStartX: Number.NaN,
        lastDirectPathStartY: Number.NaN,
        lastDirectPathTargetX: Number.NaN,
        lastDirectPathTargetY: Number.NaN,
        hexaHiveArrivalBrake: false
    };
    const state = createTraceProxy(stateTarget, 'state', trace);
    const options = {
        enemy: { id: 11, type: 'square' },
        state,
        context: {
            shouldUpdateDecision: false,
            player: {
                radius: 12,
                position: { x: 180.25, y: 95.5 }
            }
        },
        profile,
        startX: 12.5,
        startY: -7.25,
        targetX: 180.25,
        targetY: 95.5,
        walls: [],
        enemyRadius: 12,
        footprintMetrics: null,
        wallsVersion: 19,
        forcedPolicyRefresh: false,
        aiDebugStats: null
    };

    if (scenarioName === 'arrival') {
        stateTarget.targetX = options.startX;
        stateTarget.targetY = options.startY;
        primeDirectPathCache(stateTarget, options, profile, true);
    } else if (scenarioName === 'flow' || scenarioName === 'blocked') {
        options.startX = 24;
        options.startY = 24;
        options.targetX = 104;
        options.targetY = 88;
        stateTarget.targetX = 104;
        stateTarget.targetY = 88;
        const blocked = new Uint8Array(9);
        if (scenarioName === 'blocked') blocked[4] = 1;
        const dirX = new Float32Array(9);
        const dirY = new Float32Array(9);
        dirX[4] = Math.fround(-0.375);
        dirY[4] = Math.fround(0.625);
        const flowData = {
            key: 'fixture-flow',
            clearance: 12,
            grid: {
                cellSize: 16,
                cols: 3,
                rows: 3,
                blocked
            },
            field: {
                dirX,
                dirY
            }
        };
        stateTarget.flowData = flowData;
        stateTarget.flowKey = flowData.key;
        stateTarget.lastTargetCellX = Math.floor(stateTarget.targetX / profile.NAV_CELL_SIZE);
        stateTarget.lastTargetCellY = Math.floor(stateTarget.targetY / profile.NAV_CELL_SIZE);
        primeDirectPathCache(stateTarget, options, profile, false);
    } else if (scenarioName === 'hexa-arrival' || scenarioName === 'hexa-final') {
        options.enemy.type = 'hexa_hive';
        options.startX = 0;
        options.startY = 0;
        options.targetX = scenarioName === 'hexa-arrival' ? 20 : 220;
        options.targetY = scenarioName === 'hexa-arrival' ? -0 : 40;
        options.context.player.position.x = options.targetX;
        options.context.player.position.y = options.targetY;
        options.enemyRadius = 24;
        options.footprintMetrics = {
            baseRadius: 10,
            halfWidth: 22,
            halfHeight: 15,
            radius: 28,
            axisLocalDeg: 0,
            axisAnisotropy: 0.5
        };
        stateTarget.targetX = scenarioName === 'hexa-final' ? 112 : options.targetX;
        stateTarget.targetY = scenarioName === 'hexa-final' ? 20 : options.targetY;
        stateTarget.flowPolicyKey = 'hexa_hive_approach';
        stateTarget.flowData = {
            key: 'hexa-flow-placeholder',
            clearance: 16,
            grid: {
                cellSize: 16,
                cols: 1,
                rows: 1,
                blocked: new Uint8Array(1)
            },
            field: {
                dirX: new Float32Array(1),
                dirY: new Float32Array(1)
            }
        };
        stateTarget.flowKey = stateTarget.flowData.key;
    } else if (scenarioName === 'numeric') {
        options.startX = -0;
        options.startY = Number.MIN_VALUE;
        options.targetX = numericTarget;
        options.targetY = 1;
        stateTarget.targetX = numericTarget;
        stateTarget.targetY = 1;
        primeDirectPathCache(stateTarget, options, profile, true);
    } else {
        primeDirectPathCache(stateTarget, options, profile, true);
    }

    return {
        options,
        stateTarget,
        scratchDirTarget,
        scratchDir,
        trace,
        initialFlowData: stateTarget.flowData
    };
}

/**
 * variant의 내부 hot 호출 경로를 실행합니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {object} fixture - steering fixture입니다.
 * @returns {object} 원시 동치 비교 결과입니다.
 */
function runInternalSteering(runtime, fixture) {
    const steering = runtime.steering.resolveEnemyAISteeringDirection;
    let execution;
    if (runtime.kind === 'candidate') {
        const options = fixture.options;
        execution = capture(() => steering(
            options.enemy,
            options.state,
            options.context,
            options.profile,
            options.startX,
            options.startY,
            options.targetX,
            options.targetY,
            options.walls,
            options.enemyRadius,
            options.footprintMetrics,
            options.wallsVersion,
            options.forcedPolicyRefresh,
            options.aiDebugStats,
            runtime.callMode[TOKEN_EXPORT_NAME]
        ));
    } else {
        execution = capture(() => steering(fixture.options));
    }
    const value = execution.ok ? execution.value : null;
    return {
        execution: execution.ok ? { ok: true } : execution,
        returnedScratchIdentity: execution.ok && value === fixture.scratchDir,
        trace: fixture.trace.map((entry) => [...entry]),
        snapshot: snapshotSteeringFixture(fixture)
    };
}

/**
 * 공개 API를 임의의 추가 인수와 함께 호출합니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {*} options - 첫 options 인수입니다.
 * @returns {*} 공개 함수 반환값입니다.
 */
function callPublicWithIgnoredExtras(runtime, options) {
    const ignoredArguments = new Array(13).fill('ignored');
    return Reflect.apply(
        runtime.steering.resolveEnemyAISteeringDirection,
        undefined,
        [options, ...ignoredArguments, () => {}]
    );
}

test('production은 private function identity token과 positional hot 호출 구조를 사용한다', () => {
    assert.equal(
        actualSteeringSource,
        sourceVariants.candidateSteering,
        'production steering은 candidate header와 private token import를 사용해야 합니다.'
    );
    assert.equal(
        actualCoreSource,
        sourceVariants.candidateCore,
        'production core는 options 객체 없이 positional 인수를 전달해야 합니다.'
    );
    assert.ok(actualCallModeSource, '내부 호출 identity 전용 모듈이 존재해야 합니다.');
    assert.doesNotMatch(actualCallModeSource, /\bSymbol\s*\(/, '호출 identity는 Symbol() 관찰점을 만들면 안 됩니다.');
    assert.equal(
        typeof candidateRuntime.callMode[TOKEN_EXPORT_NAME],
        'function',
        '내부 호출 identity는 함수여야 합니다.'
    );
    assert.equal(countOccurrences(actualCoreSource, CANDIDATE_CORE_CALL), 1);
    assert.equal(countOccurrences(actualCoreSource, LEGACY_CORE_CALL), 0);
});

test('direct/arrival/flow/blocked/hexa/numeric steering은 원시 상태와 trace가 동일하다', () => {
    const numericEdges = [
        -0,
        +0,
        Number.MIN_VALUE,
        -Number.MIN_VALUE,
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        numberFromBits(0x7ff8000000000719n)
    ];
    const scenarios = [
        ['direct', 0],
        ['arrival', 0],
        ['flow', 0],
        ['blocked', 0],
        ['hexa-arrival', 0],
        ['hexa-final', 0],
        ...numericEdges.map((value) => ['numeric', value])
    ];
    for (const [scenarioName, numericTarget] of scenarios) {
        const legacy = runInternalSteering(
            legacyRuntime,
            createSteeringFixture(legacyRuntime, scenarioName, numericTarget)
        );
        const candidate = runInternalSteering(
            candidateRuntime,
            createSteeringFixture(candidateRuntime, scenarioName, numericTarget)
        );
        assert.deepEqual(
            candidate,
            legacy,
            scenarioName + ' steering 결과가 raw Float64/trace/identity 기준으로 달라졌습니다.'
        );
        assert.equal(candidate.returnedScratchIdentity, true, scenarioName + ' 반환 버퍼 identity');
    }
});

test('candidate 공개 API는 name/length/namespace와 14개 getter 순서를 보존한다', () => {
    const legacyFunction = legacyRuntime.steering.resolveEnemyAISteeringDirection;
    const candidateFunction = candidateRuntime.steering.resolveEnemyAISteeringDirection;
    assert.equal(candidateFunction.name, legacyFunction.name);
    assert.equal(candidateFunction.length, legacyFunction.length);
    assert.equal(candidateFunction.length, 1);
    assert.deepEqual(
        Object.keys(candidateRuntime.steering).sort(),
        Object.keys(legacyRuntime.steering).sort(),
        'private token은 steering 공개 namespace에 추가되면 안 됩니다.'
    );
    assert.deepEqual(
        Object.keys(candidateRuntime.core).sort(),
        Object.keys(legacyRuntime.core).sort(),
        'private token은 core 공개 namespace에도 추가되면 안 됩니다.'
    );

    const runObserved = (runtime) => {
        const fixture = createSteeringFixture(runtime, 'direct');
        const getterTrace = [];
        const options = {};
        for (const key of OPTION_KEYS) {
            Object.defineProperty(options, key, {
                configurable: true,
                enumerable: true,
                get() {
                    getterTrace.push(key);
                    return fixture.options[key];
                }
            });
        }
        const result = callPublicWithIgnoredExtras(runtime, options);
        return {
            getterTrace,
            returnedScratchIdentity: result === fixture.scratchDir,
            snapshot: snapshotSteeringFixture(fixture)
        };
    };
    const legacy = runObserved(legacyRuntime);
    const candidate = runObserved(candidateRuntime);
    assert.deepEqual(candidate, legacy);
    assert.deepEqual(candidate.getterTrace, OPTION_KEYS);
    assert.equal(candidate.returnedScratchIdentity, true);
});

/**
 * 함수 own descriptor를 realm identity와 무관한 형태로 직렬화합니다.
 * @param {Function} fn - 검사할 함수입니다.
 * @returns {object[]} descriptor shape입니다.
 */
function snapshotFunctionOwnDescriptors(fn) {
    return Reflect.ownKeys(fn).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(fn, key);
        return {
            key: typeof key === 'symbol' ? 'symbol:' + String(key.description) : 'string:' + key,
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            writable: descriptor.writable ?? null,
            valueType: 'value' in descriptor ? typeof descriptor.value : null,
            getterType: typeof descriptor.get,
            setterType: typeof descriptor.set
        };
    });
}

test('공개 함수 constructability·own descriptor와 잘못된 내부 token 처리가 동일하다', () => {
    const legacyFunction = legacyRuntime.steering.resolveEnemyAISteeringDirection;
    const candidateFunction = candidateRuntime.steering.resolveEnemyAISteeringDirection;
    assert.deepEqual(
        snapshotFunctionOwnDescriptors(candidateFunction),
        snapshotFunctionOwnDescriptors(legacyFunction)
    );

    const runConstruct = (runtime) => {
        const fixture = createSteeringFixture(runtime, 'direct');
        const value = Reflect.construct(
            runtime.steering.resolveEnemyAISteeringDirection,
            [fixture.options]
        );
        return {
            returnedScratchIdentity: value === fixture.scratchDir,
            snapshot: snapshotSteeringFixture(fixture)
        };
    };
    assert.deepEqual(runConstruct(candidateRuntime), runConstruct(legacyRuntime));

    for (const wrongToken of [() => {}, Symbol('wrong-token'), {}, null, undefined]) {
        const runWrongToken = (runtime) => {
            const fixture = createSteeringFixture(runtime, 'direct');
            const args = [fixture.options, ...new Array(13).fill('ignored'), wrongToken];
            const value = Reflect.apply(
                runtime.steering.resolveEnemyAISteeringDirection,
                undefined,
                args
            );
            return {
                returnedScratchIdentity: value === fixture.scratchDir,
                snapshot: snapshotSteeringFixture(fixture)
            };
        };
        assert.deepEqual(
            runWrongToken(candidateRuntime),
            runWrongToken(legacyRuntime),
            '잘못된 내부 token은 공개 options 경로를 유지해야 합니다.'
        );
    }
});

test('공개 options의 상속 accessor·Proxy receiver와 getter 재진입이 동일하다', () => {
    const runInheritedProxy = (runtime) => {
        const fixture = createSteeringFixture(runtime, 'direct');
        const trace = [];
        const prototype = {};
        let proxy;
        for (const key of OPTION_KEYS) {
            Object.defineProperty(prototype, key, {
                configurable: true,
                get() {
                    trace.push(['getter', key, this === proxy]);
                    return fixture.options[key];
                }
            });
        }
        proxy = new Proxy(Object.create(prototype), {
            get(target, key, receiver) {
                if (typeof key === 'string') {
                    trace.push(['trap', key, receiver === proxy]);
                }
                return Reflect.get(target, key, receiver);
            }
        });
        const value = callPublicWithIgnoredExtras(runtime, proxy);
        return {
            trace,
            returnedScratchIdentity: value === fixture.scratchDir,
            snapshot: snapshotSteeringFixture(fixture)
        };
    };
    const legacyInherited = runInheritedProxy(legacyRuntime);
    const candidateInherited = runInheritedProxy(candidateRuntime);
    assert.deepEqual(candidateInherited, legacyInherited);
    assert.equal(candidateInherited.trace.length, OPTION_KEYS.length * 2);
    assert.ok(candidateInherited.trace.every((entry) => entry[2] === true));

    const runReentrant = (runtime) => {
        const outer = createSteeringFixture(runtime, 'direct');
        const inner = createSteeringFixture(runtime, 'flow');
        const trace = [];
        const options = {};
        let entered = false;
        for (const key of OPTION_KEYS) {
            Object.defineProperty(options, key, {
                configurable: true,
                get() {
                    trace.push('outer.' + key);
                    if (key === 'startX' && !entered) {
                        entered = true;
                        trace.push('inner.begin');
                        const innerValue = callPublicWithIgnoredExtras(runtime, inner.options);
                        trace.push('inner.identity:' + String(innerValue === inner.scratchDir));
                        trace.push('inner.end');
                    }
                    return outer.options[key];
                }
            });
        }
        const value = callPublicWithIgnoredExtras(runtime, options);
        return {
            trace,
            entered,
            returnedScratchIdentity: value === outer.scratchDir,
            outer: snapshotSteeringFixture(outer),
            inner: snapshotSteeringFixture(inner)
        };
    };
    const legacyReentrant = runReentrant(legacyRuntime);
    const candidateReentrant = runReentrant(candidateRuntime);
    assert.deepEqual(candidateReentrant, legacyReentrant);
    assert.equal(candidateReentrant.entered, true);
    assert.ok(candidateReentrant.trace.indexOf('inner.end') < candidateReentrant.trace.indexOf('outer.startY'));
});

test('공개 options의 모든 getter throw 지점은 순서·identity·부분 상태가 동일하다', () => {
    for (let throwIndex = 0; throwIndex < OPTION_KEYS.length; throwIndex++) {
        const sentinel = { throwIndex };
        const run = (runtime) => {
            const fixture = createSteeringFixture(runtime, 'direct');
            const getterTrace = [];
            const options = {};
            for (let index = 0; index < OPTION_KEYS.length; index++) {
                const key = OPTION_KEYS[index];
                Object.defineProperty(options, key, {
                    configurable: true,
                    get() {
                        getterTrace.push(key);
                        if (index === throwIndex) throw sentinel;
                        return fixture.options[key];
                    }
                });
            }
            const outcome = capture(() => callPublicWithIgnoredExtras(runtime, options), sentinel);
            return {
                outcome: {
                    ok: outcome.ok,
                    sentinel: outcome.sentinel,
                    name: outcome.name ?? null,
                    message: outcome.message ?? null
                },
                getterTrace,
                snapshot: snapshotSteeringFixture(fixture)
            };
        };
        const legacy = run(legacyRuntime);
        const candidate = run(candidateRuntime);
        assert.deepEqual(candidate, legacy, OPTION_KEYS[throwIndex] + ' getter throw 동치');
        assert.equal(candidate.outcome.sentinel, true);
        assert.deepEqual(candidate.getterTrace, OPTION_KEYS.slice(0, throwIndex + 1));
    }
});

test('공개 null/undefined/primitive/revoked Proxy 예외의 이름과 메시지가 동일하다', () => {
    const primitiveValues = [
        null,
        undefined,
        false,
        true,
        0,
        -0,
        1,
        '',
        'options',
        1n,
        Symbol('options')
    ];
    const describeFailure = (runtime, value) => {
        const outcome = capture(() => callPublicWithIgnoredExtras(runtime, value));
        return {
            ok: outcome.ok,
            name: outcome.name ?? null,
            message: outcome.message ?? null,
            constructorName: outcome.constructorName ?? null
        };
    };
    for (const value of primitiveValues) {
        assert.deepEqual(
            describeFailure(candidateRuntime, value),
            describeFailure(legacyRuntime, value),
            'primitive options 예외 동치: ' + valueToken(value)
        );
    }

    const runRevoked = (runtime) => {
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();
        return describeFailure(runtime, revocable.proxy);
    };
    assert.deepEqual(runRevoked(candidateRuntime), runRevoked(legacyRuntime));
});

const CORE_STATE_NUMERIC_KEYS = Object.freeze([
    'dirX',
    'dirY',
    'baseDesiredSpeed',
    'desiredSpeed',
    'baseAccelResponse',
    'accelResponse',
    'targetX',
    'targetY',
    'targetEnemyId',
    'targetEnemyTtlSeconds',
    'targetEnemyWallsVersion',
    'policyIntentWallsVersion',
    'lastTargetCellX',
    'lastTargetCellY',
    'lastDecisionGroup',
    'lastDirectPathWallsVersion',
    'lastDirectPathPad',
    'lastDirectPathStartX',
    'lastDirectPathStartY',
    'lastDirectPathTargetX',
    'lastDirectPathTargetY',
    'orbitDirection',
    'chargeCooldownRemaining',
    'chargeDurationRemaining',
    'chargeRecoverRemaining',
    'chargeTargetX',
    'chargeTargetY'
]);
const CORE_STATE_VALUE_KEYS = Object.freeze([
    '__initialized',
    '__schemaVersion',
    'policyId',
    'flowPolicyKey',
    'flowKey',
    'hasDirectPathResult',
    'lastDirectPath',
    'chargeState',
    'hexaHiveArrivalBrake'
]);

/**
 * 실제 core가 사용할 최소 적 객체를 만듭니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {number} id - 적 ID입니다.
 * @param {string} [type='square'] - 적 타입입니다.
 * @returns {object} 적 fixture입니다.
 */
function createCoreEnemy(runtime, id, type = 'square') {
    const setAccTrace = [];
    const enemy = {
        id,
        type,
        active: true,
        position: { x: 31.25, y: -18.5 },
        speed: { x: -0, y: 3.75 },
        accSpeed: 0,
        lastAccX: 0,
        lastAccY: 0,
        renderHeightPx: 24,
        rotation: 0,
        angularVelocity: 0,
        angularDeceleration: 0,
        setAcc(x, y) {
            this.lastAccX = x;
            this.lastAccY = y;
            setAccTrace.push([valueToken(x), valueToken(y)]);
        }
    };
    runtime.core.ensureEnemyAIState(enemy);
    return { enemy, setAccTrace };
}

/**
 * core fixture의 게임 가시 상태를 Float64 원시 비트 기준으로 스냅샷합니다.
 * @param {object} fixture - core fixture입니다.
 * @returns {object} 비교용 스냅샷입니다.
 */
function snapshotCoreFixture(fixture) {
    const enemy = fixture.enemy;
    const state = enemy._enemyAIState;
    const stateNumbers = {};
    const stateValues = {};
    for (const key of CORE_STATE_NUMERIC_KEYS) {
        stateNumbers[key] = valueToken(state?.[key]);
    }
    for (const key of CORE_STATE_VALUE_KEYS) {
        stateValues[key] = valueToken(state?.[key]);
    }
    return {
        enemy: {
            type: enemy.type,
            positionX: valueToken(enemy.position.x),
            positionY: valueToken(enemy.position.y),
            speedX: valueToken(enemy.speed.x),
            speedY: valueToken(enemy.speed.y),
            lastAccX: valueToken(enemy.lastAccX),
            lastAccY: valueToken(enemy.lastAccY),
            accSpeed: valueToken(enemy.accSpeed),
            rotation: valueToken(enemy.rotation),
            angularVelocity: valueToken(enemy.angularVelocity),
            angularDeceleration: valueToken(enemy.angularDeceleration)
        },
        stateNumbers,
        stateValues,
        scratchDir: {
            x: valueToken(state?.scratchDir?.x),
            y: valueToken(state?.scratchDir?.y)
        },
        scratchCell: {
            cx: valueToken(state?.scratchCell?.cx),
            cy: valueToken(state?.scratchCell?.cy)
        },
        scratchGoalCell: {
            cx: valueToken(state?.scratchGoalCell?.cx),
            cy: valueToken(state?.scratchGoalCell?.cy)
        },
        scratchPolicyPoint: {
            x: valueToken(state?.scratchPolicyPoint?.x),
            y: valueToken(state?.scratchPolicyPoint?.y)
        },
        flowDataIsNull: state?.flowData === null,
        stateIdentity: state === enemy._enemyAIState,
        setAccTrace: fixture.setAccTrace.map((entry) => [...entry])
    };
}

/**
 * updateFrame Proxy를 사용하는 실제 core fixture를 만듭니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {object} [control={}] - getter throw/reentry 제어값입니다.
 * @returns {object} core fixture입니다.
 */
function createObservedCoreFixture(runtime, control = {}) {
    const fixture = createCoreEnemy(runtime, control.id ?? 71, control.type ?? 'square');
    const state = fixture.enemy._enemyAIState;
    const rawFrame = state.scratchUpdateFrame;
    const frameTrace = [];
    const propertyGetCounts = new Map();
    let getCount = 0;
    const frameProxy = new Proxy(rawFrame, {
        set(target, key, value) {
            if (typeof key === 'string') {
                frameTrace.push(['set', key, valueToken(value)]);
            }
            return Reflect.set(target, key, value);
        },
        get(target, key) {
            if (typeof key === 'string') {
                getCount++;
                const propertyCount = (propertyGetCounts.get(key) ?? 0) + 1;
                propertyGetCounts.set(key, propertyCount);
                frameTrace.push(['get', key, propertyCount]);
                if (getCount === control.throwAtGet) {
                    throw control.sentinel;
                }
                control.onGet?.({
                    key,
                    propertyCount,
                    getCount,
                    frameTrace
                });
            }
            return Reflect.get(target, key);
        }
    });
    state.scratchUpdateFrame = frameProxy;
    const context = {
        player: {
            radius: 12,
            position: { x: 214.5, y: 103.25 }
        },
        walls: [],
        wallsVersion: 23,
        shouldUpdateDecision: true,
        decisionGroup: 11,
        enemyAIQualityProfile: 'inline_safe',
        enemies: [fixture.enemy],
        aiDebugStats: null
    };
    return {
        ...fixture,
        context,
        rawFrame,
        frameProxy,
        frameTrace,
        getGetCount: () => getCount,
        getPropertyGetCount: (key) => propertyGetCounts.get(key) ?? 0
    };
}

/**
 * 실제 core의 updateFrame 관찰 시나리오를 한 번 실행합니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {object} [control={}] - throw/reentry 제어값입니다.
 * @returns {object} 실행 결과입니다.
 */
function runObservedCore(runtime, control = {}) {
    const fixture = createObservedCoreFixture(runtime, control);
    const outcome = capture(
        () => runtime.core.fixedUpdateEnemyAI(fixture.enemy, 1 / 60, fixture.context),
        control.sentinel ?? null
    );
    return {
        fixture,
        result: {
            outcome: {
                ok: outcome.ok,
                sentinel: outcome.sentinel ?? false,
                name: outcome.name ?? null,
                message: outcome.message ?? null
            },
            frameTrace: fixture.frameTrace.map((entry) => [...entry]),
            getCount: fixture.getGetCount(),
            snapshot: snapshotCoreFixture(fixture)
        }
    };
}

test('실제 core updateFrame의 getter/setter 순서와 모든 getter throw 지점이 동일하다', () => {
    const legacyBaseline = runObservedCore(legacyRuntime);
    const candidateBaseline = runObservedCore(candidateRuntime);
    assert.deepEqual(candidateBaseline.result, legacyBaseline.result, 'updateFrame baseline trace');
    assert.ok(
        candidateBaseline.result.getCount >= 8,
        'positional 호출 인수의 updateFrame getter를 모두 관찰해야 합니다.'
    );

    for (let throwAtGet = 1; throwAtGet <= legacyBaseline.result.getCount; throwAtGet++) {
        const sentinel = { throwAtGet };
        const legacy = runObservedCore(legacyRuntime, { throwAtGet, sentinel });
        const candidate = runObservedCore(candidateRuntime, { throwAtGet, sentinel });
        assert.deepEqual(
            candidate.result,
            legacy.result,
            'updateFrame getter #' + throwAtGet + ' throw 동치'
        );
        assert.equal(candidate.result.outcome.sentinel, true);
    }
});

/**
 * 마지막 startX getter에서 같은 core 함수로 재진입합니다.
 * @param {object} runtime - variant runtime입니다.
 * @param {number} reentryOccurrence - startX 재진입 발생 횟수입니다.
 * @returns {object} 외부/내부 상태와 trace입니다.
 */
function runCoreReentry(runtime, reentryOccurrence) {
    const inner = createCoreEnemy(runtime, 172, 'arrow');
    const innerContext = {
        player: {
            radius: 10,
            position: { x: -91.5, y: 44.25 }
        },
        walls: [],
        wallsVersion: 24,
        shouldUpdateDecision: true,
        decisionGroup: 12,
        enemyAIQualityProfile: 'inline_safe',
        enemies: [inner.enemy],
        aiDebugStats: null
    };
    let didReenter = false;
    const outer = runObservedCore(runtime, {
        id: 171,
        onGet({ key, propertyCount, frameTrace }) {
            if (didReenter || key !== 'startX' || propertyCount !== reentryOccurrence) return;
            didReenter = true;
            frameTrace.push(['reentry', 'begin']);
            runtime.core.fixedUpdateEnemyAI(inner.enemy, 1 / 120, innerContext);
            frameTrace.push(['reentry', 'end']);
        }
    });
    return {
        didReenter,
        outer: outer.result,
        inner: snapshotCoreFixture(inner)
    };
}

test('실제 core updateFrame 인수 평가 중 재진입해도 외부/내부 상태가 동일하다', () => {
    const baseline = runObservedCore(legacyRuntime);
    const lastStartXOccurrence = baseline.fixture.getPropertyGetCount('startX');
    assert.ok(lastStartXOccurrence > 0);
    const legacy = runCoreReentry(legacyRuntime, lastStartXOccurrence);
    const candidate = runCoreReentry(candidateRuntime, lastStartXOccurrence);
    assert.deepEqual(candidate, legacy);
    assert.equal(candidate.didReenter, true);
    const beginIndex = candidate.outer.frameTrace.findIndex((entry) => (
        entry[0] === 'reentry' && entry[1] === 'begin'
    ));
    const endIndex = candidate.outer.frameTrace.findIndex((entry) => (
        entry[0] === 'reentry' && entry[1] === 'end'
    ));
    assert.ok(beginIndex >= 0 && endIndex > beginIndex);
});

/**
 * 10,000틱 재생에 사용할 actual core fixture를 만듭니다.
 * @param {object} runtime - variant runtime입니다.
 * @returns {object} 재생 fixture입니다.
 */
function createReplayFixture(runtime) {
    const fixture = createCoreEnemy(runtime, 719, 'square');
    fixture.context = {
        player: {
            radius: 12,
            position: { x: 240, y: 135 }
        },
        walls: [],
        wallsVersion: 0,
        shouldUpdateDecision: true,
        decisionGroup: 0,
        enemyAIQualityProfile: 'inline_safe',
        enemies: [fixture.enemy],
        aiDebugStats: null
    };
    return fixture;
}

/**
 * 재생 fixture의 매 tick 핵심 상태를 짧은 raw 토큰으로 만듭니다.
 * @param {object} fixture - 재생 fixture입니다.
 * @returns {string} 비교 토큰입니다.
 */
function replayStateToken(fixture) {
    const enemy = fixture.enemy;
    const state = enemy._enemyAIState;
    const tokens = [
        valueToken(enemy.type),
        valueToken(enemy.position.x),
        valueToken(enemy.position.y),
        valueToken(enemy.speed.x),
        valueToken(enemy.speed.y),
        valueToken(enemy.lastAccX),
        valueToken(enemy.lastAccY),
        valueToken(enemy.accSpeed),
        valueToken(enemy.rotation),
        valueToken(enemy.angularVelocity),
        valueToken(enemy.angularDeceleration)
    ];
    for (const key of CORE_STATE_NUMERIC_KEYS) tokens.push(valueToken(state?.[key]));
    for (const key of CORE_STATE_VALUE_KEYS) tokens.push(valueToken(state?.[key]));
    tokens.push(
        valueToken(state?.scratchDir?.x),
        valueToken(state?.scratchDir?.y),
        valueToken(state?.scratchCell?.cx),
        valueToken(state?.scratchCell?.cy),
        valueToken(state?.scratchGoalCell?.cx),
        valueToken(state?.scratchGoalCell?.cy),
        valueToken(state?.scratchPolicyPoint?.x),
        valueToken(state?.scratchPolicyPoint?.y),
        valueToken(state?.scratchUpdateFrame?.startX),
        valueToken(state?.scratchUpdateFrame?.startY),
        valueToken(state?.scratchUpdateFrame?.targetX),
        valueToken(state?.scratchUpdateFrame?.targetY),
        valueToken(state?.scratchUpdateFrame?.enemyRadius),
        valueToken(state?.scratchUpdateFrame?.wallsVersion),
        valueToken(state?.flowData === null)
    );
    return tokens.join('|');
}

/**
 * 고정 seed xorshift32를 한 단계 진행합니다.
 * @param {number} seed - 현재 unsigned seed입니다.
 * @returns {number} 다음 unsigned seed입니다.
 */
function nextReplaySeed(seed) {
    let next = seed >>> 0;
    next ^= next << 13;
    next ^= next >>> 17;
    next ^= next << 5;
    return next >>> 0;
}

/**
 * core 출력 가속도를 간단한 결정적 적분으로 다음 입력 상태에 반영합니다.
 * @param {object} fixture - 재생 fixture입니다.
 * @param {number} delta - fixed delta입니다.
 */
function integrateReplayEnemy(fixture, delta) {
    const enemy = fixture.enemy;
    const response = Math.min(1, Math.max(0, enemy.accSpeed * delta));
    enemy.speed.x += enemy.lastAccX * response;
    enemy.speed.y += enemy.lastAccY * response;
    enemy.position.x += enemy.speed.x * delta;
    enemy.position.y += enemy.speed.y * delta;
}

test('실제 core 10,000틱 deterministic replay가 매 tick raw Float64 exact이다', () => {
    const legacy = createReplayFixture(legacyRuntime);
    const candidate = createReplayFixture(candidateRuntime);
    const replayTypes = ['square', 'arrow', 'rhom', 'gen', 'triangle', 'octa'];
    const delta = 1 / 60;
    let seed = 0x0719c0de;

    for (let tick = 0; tick < 10_000; tick++) {
        seed = nextReplaySeed(seed);
        const playerX = 64 + ((seed & 0xffff) / 64);
        seed = nextReplaySeed(seed);
        const playerY = -128 + ((seed & 0xffff) / 96);
        const type = replayTypes[Math.floor(tick / 317) % replayTypes.length];
        const shouldUpdateDecision = tick % 60 === 0;
        const wallsVersion = Math.floor(tick / 997);
        const decisionGroup = tick % 60;

        for (const fixture of [legacy, candidate]) {
            fixture.enemy.type = type;
            fixture.context.player.position.x = playerX;
            fixture.context.player.position.y = playerY;
            fixture.context.shouldUpdateDecision = shouldUpdateDecision;
            fixture.context.wallsVersion = wallsVersion;
            fixture.context.decisionGroup = decisionGroup;
        }

        legacyRuntime.core.fixedUpdateEnemyAI(legacy.enemy, delta, legacy.context);
        candidateRuntime.core.fixedUpdateEnemyAI(candidate.enemy, delta, candidate.context);
        assert.equal(
            replayStateToken(candidate),
            replayStateToken(legacy),
            'core replay tick ' + tick + ' 출력 불일치'
        );
        integrateReplayEnemy(legacy, delta);
        integrateReplayEnemy(candidate, delta);
        assert.equal(
            replayStateToken(candidate),
            replayStateToken(legacy),
            'core replay tick ' + tick + ' 적분 후 입력 불일치'
        );
    }

    assert.deepEqual(snapshotCoreFixture(candidate), snapshotCoreFixture(legacy));
    assert.equal(candidate.setAccTrace.length, 10_000);
});
