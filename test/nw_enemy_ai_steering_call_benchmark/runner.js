import { ENEMY_AI_DATA } from '../../project/game/script/data/object/enemy/enemy_ai_data.js';

const statusElement = document.querySelector('#status');
const steeringUrl = new URL(
    '../../project/game/script/module/object/enemy/ai/_enemy_ai_steering.js',
    import.meta.url
);
const SAMPLE_COUNT = 61;
const WARMUP_BATCH_COUNT = 12;
const MIN_BATCH_MILLISECONDS = 80;
const REQUIRED_MIXED_P50_SPEEDUP = 1.05;

const STEERING_TOKEN_IMPORT =
    `import { ENEMY_AI_STEERING_POSITIONAL_CALL } from './_enemy_ai_steering_call_mode.js';\n`;

const STEERING_INVALID_OPTIONS_HELPER = `/**
 * 공개 API의 null/undefined formal destructuring 예외 계약을 유지합니다.
 * @param {object|null|undefined} options - 검증할 공개 options입니다.
 * @returns {*} options의 enemy 값입니다.
 */
const readInvalidEnemyAISteeringOptions = ({ enemy }) => enemy;

`;

const BENCHMARK_TOKEN_DECLARATION = `const ENEMY_AI_STEERING_POSITIONAL_CALL = () => {};
export { ENEMY_AI_STEERING_POSITIONAL_CALL as __testEnemyAISteeringPositionalCall };

`;

const LEGACY_SIGNATURE = `export function resolveEnemyAISteeringDirection({
    enemy,
    state,
    context,
    profile,
    startX,
    startY,
    targetX,
    targetY,
    walls,
    enemyRadius,
    footprintMetrics,
    wallsVersion,
    forcedPolicyRefresh,
    aiDebugStats
}) {`;

const CANDIDATE_SIGNATURE = `export function resolveEnemyAISteeringDirection(
    enemy,
    state = undefined,
    context,
    profile,
    startX,
    startY,
    targetX,
    targetY,
    walls,
    enemyRadius,
    footprintMetrics,
    wallsVersion,
    forcedPolicyRefresh,
    aiDebugStats,
    internalCallMode
) {
    if (internalCallMode !== ENEMY_AI_STEERING_POSITIONAL_CALL) {
        const options = enemy;
        if (options === null || options === undefined) readInvalidEnemyAISteeringOptions(options);
        ({
            enemy,
            state,
            context,
            profile,
            startX,
            startY,
            targetX,
            targetY,
            walls,
            enemyRadius,
            footprintMetrics,
            wallsVersion,
            forcedPolicyRefresh,
            aiDebugStats
        } = options);
    }`;

/**
 * 정확히 한 번 존재하는 소스 블록만 치환합니다.
 * @param {string} source - 원본 소스입니다.
 * @param {string} before - 치환 전 블록입니다.
 * @param {string} after - 치환 후 블록입니다.
 * @returns {string} 치환된 소스입니다.
 */
function replaceExactlyOnce(source, before, after) {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`steering signature occurrence: ${count}`);
    return source.replace(before, after);
}

/**
 * 현재 production 소스가 legacy/candidate 중 어느 형태이든 동일한 비교 쌍을 만듭니다.
 * @param {string} source - 정규화된 production steering 소스입니다.
 * @returns {{legacySource: string, candidateSource: string}} 벤치마크 소스 쌍입니다.
 */
function deriveBenchmarkSources(source) {
    const legacyCount = source.split(LEGACY_SIGNATURE).length - 1;
    const candidateCount = source.split(CANDIDATE_SIGNATURE).length - 1;
    if (legacyCount + candidateCount !== 1) {
        throw new Error(
            `steering source shape: legacy=${legacyCount}, candidate=${candidateCount}`
        );
    }

    if (legacyCount === 1) {
        return {
            legacySource: source,
            candidateSource: replaceExactlyOnce(
                source,
                LEGACY_SIGNATURE,
                `${STEERING_INVALID_OPTIONS_HELPER}${BENCHMARK_TOKEN_DECLARATION}${CANDIDATE_SIGNATURE}`
            )
        };
    }

    const legacySource = replaceExactlyOnce(
        replaceExactlyOnce(
            replaceExactlyOnce(source, STEERING_TOKEN_IMPORT, ''),
            STEERING_INVALID_OPTIONS_HELPER,
            ''
        ),
        CANDIDATE_SIGNATURE,
        LEGACY_SIGNATURE
    );
    return {
        legacySource,
        candidateSource: replaceExactlyOnce(
            source,
            STEERING_TOKEN_IMPORT,
            BENCHMARK_TOKEN_DECLARATION
        )
    };
}

/**
 * Blob module에서도 상대 import가 실제 파일을 가리키도록 절대 URL로 변환합니다.
 * @param {string} source - steering 모듈 원문입니다.
 * @returns {string} 상대 import를 절대화한 소스입니다.
 */
function absolutizeRelativeImports(source) {
    return source.replace(
        /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,
        (_match, prefix, specifier, suffix) => (
            `${prefix}${new URL(specifier, steeringUrl).href}${suffix}`
        )
    );
}

/**
 * 주어진 원문을 독립 Blob ESM으로 로드합니다.
 * @param {string} source - 로드할 전체 모듈 소스입니다.
 * @returns {Promise<object>} 모듈 namespace입니다.
 */
async function importSourceModule(source) {
    const blob = new Blob([absolutizeRelativeImports(source)], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
        return await import(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * direct-path 결과를 재사용하는 steering fixture를 만듭니다.
 * @returns {object} 독립 실행 fixture입니다.
 */
function createDirectReuseFixture() {
    const profile = ENEMY_AI_DATA.QUALITY_PROFILES[
        ENEMY_AI_DATA.DEFAULT_QUALITY_PROFILE
    ];
    const startX = 12.25;
    const startY = -7.5;
    const targetX = 310.75;
    const targetY = 141.125;
    const enemyRadius = 12;
    const directPad = Math.max(0, enemyRadius * profile.NAV_DIRECT_CHECK_PAD_RATIO);
    const wallsVersion = 19;
    const state = {
        policyId: ENEMY_AI_DATA.POLICY.CHASE,
        flowPolicyKey: 'chase',
        flowData: null,
        flowKey: '',
        targetX,
        targetY,
        desiredSpeed: 180,
        baseDesiredSpeed: 180,
        scratchDir: { x: -0, y: 0 },
        scratchCell: { cx: 0, cy: 0 },
        scratchGoalCell: { cx: 0, cy: 0 },
        hasDirectPathResult: true,
        lastDirectPath: true,
        lastDirectPathWallsVersion: wallsVersion,
        lastDirectPathPad: directPad,
        lastDirectPathStartX: startX,
        lastDirectPathStartY: startY,
        lastDirectPathTargetX: targetX,
        lastDirectPathTargetY: targetY,
        hexaHiveArrivalBrake: false
    };
    return {
        enemy: { type: 'square' },
        state,
        context: { shouldUpdateDecision: false },
        profile,
        startX,
        startY,
        targetX,
        targetY,
        walls: [],
        enemyRadius,
        footprintMetrics: null,
        wallsVersion,
        forcedPolicyRefresh: false,
        aiDebugStats: null
    };
}

/**
 * 기존 flow field를 갱신 없이 재사용하는 결정적 steering fixture를 만듭니다.
 * @returns {object} 독립 실행 fixture입니다.
 */
function createFlowReuseFixture() {
    const fixture = createDirectReuseFixture();
    const { profile, enemyRadius } = fixture;
    const startX = 160.25;
    const startY = 224.5;
    const targetX = 650.75;
    const targetY = 448.125;
    const wallsVersion = 23;
    const directPad = Math.max(0, enemyRadius * profile.NAV_DIRECT_CHECK_PAD_RATIO);
    const cellSize = profile.NAV_CELL_SIZE;
    const cols = 16;
    const rows = 12;
    const blocked = new Uint8Array(cols * rows);
    const dirX = new Float32Array(cols * rows);
    const dirY = new Float32Array(cols * rows);
    const currentCellX = Math.floor(startX / cellSize);
    const currentCellY = Math.floor(startY / cellSize);
    const currentIndex = (currentCellY * cols) + currentCellX;
    dirX[currentIndex] = 0.375;
    dirY[currentIndex] = -0.625;
    const flowData = {
        key: 'benchmark-flow-reuse',
        clearance: enemyRadius,
        grid: { cellSize, cols, rows, blocked },
        field: { dirX, dirY }
    };

    Object.assign(fixture, {
        startX,
        startY,
        targetX,
        targetY,
        wallsVersion
    });
    Object.assign(fixture.state, {
        targetX,
        targetY,
        flowData,
        flowKey: flowData.key,
        lastTargetCellX: Math.floor(targetX / cellSize),
        lastTargetCellY: Math.floor(targetY / cellSize),
        hasDirectPathResult: true,
        lastDirectPath: false,
        lastDirectPathWallsVersion: wallsVersion,
        lastDirectPathPad: directPad,
        lastDirectPathStartX: startX,
        lastDirectPathStartY: startY,
        lastDirectPathTargetX: targetX,
        lastDirectPathTargetY: targetY
    });
    return fixture;
}

/**
 * legacy object 호출 함수를 만듭니다.
 * @param {Function} steering - legacy steering 함수입니다.
 * @param {object} fixture - 실행 fixture입니다.
 * @returns {Function} 무인자 hot 호출 함수입니다.
 */
function createLegacyCall(steering, fixture) {
    return () => steering({
        enemy: fixture.enemy,
        state: fixture.state,
        context: fixture.context,
        profile: fixture.profile,
        startX: fixture.startX,
        startY: fixture.startY,
        targetX: fixture.targetX,
        targetY: fixture.targetY,
        walls: fixture.walls,
        enemyRadius: fixture.enemyRadius,
        footprintMetrics: fixture.footprintMetrics,
        wallsVersion: fixture.wallsVersion,
        forcedPolicyRefresh: fixture.forcedPolicyRefresh,
        aiDebugStats: fixture.aiDebugStats
    });
}

/**
 * private-token positional 호출 함수를 만듭니다.
 * @param {Function} steering - candidate steering 함수입니다.
 * @param {Function} token - 내부 호출 식별 함수입니다.
 * @param {object} fixture - 실행 fixture입니다.
 * @returns {Function} 무인자 hot 호출 함수입니다.
 */
function createCandidateCall(steering, token, fixture) {
    return () => steering(
        fixture.enemy,
        fixture.state,
        fixture.context,
        fixture.profile,
        fixture.startX,
        fixture.startY,
        fixture.targetX,
        fixture.targetY,
        fixture.walls,
        fixture.enemyRadius,
        fixture.footprintMetrics,
        fixture.wallsVersion,
        fixture.forcedPolicyRefresh,
        fixture.aiDebugStats,
        token
    );
}

/**
 * direct-reuse 3회마다 flow-reuse 1회를 실행하는 legacy 호출을 만듭니다.
 * @param {Function} steering - legacy steering 함수입니다.
 * @param {object} directFixture - direct-reuse fixture입니다.
 * @param {object} flowFixture - flow-reuse fixture입니다.
 * @returns {Function} 무인자 3:1 mixed 호출 함수입니다.
 */
function createLegacyMixedCall(steering, directFixture, flowFixture) {
    let phase = 0;
    return () => {
        const fixture = phase === 3 ? flowFixture : directFixture;
        phase = (phase + 1) & 3;
        return steering({
            enemy: fixture.enemy,
            state: fixture.state,
            context: fixture.context,
            profile: fixture.profile,
            startX: fixture.startX,
            startY: fixture.startY,
            targetX: fixture.targetX,
            targetY: fixture.targetY,
            walls: fixture.walls,
            enemyRadius: fixture.enemyRadius,
            footprintMetrics: fixture.footprintMetrics,
            wallsVersion: fixture.wallsVersion,
            forcedPolicyRefresh: fixture.forcedPolicyRefresh,
            aiDebugStats: fixture.aiDebugStats
        });
    };
}

/**
 * direct-reuse 3회마다 flow-reuse 1회를 실행하는 positional 호출을 만듭니다.
 * @param {Function} steering - candidate steering 함수입니다.
 * @param {Function} token - 내부 호출 식별 함수입니다.
 * @param {object} directFixture - direct-reuse fixture입니다.
 * @param {object} flowFixture - flow-reuse fixture입니다.
 * @returns {Function} 무인자 3:1 mixed 호출 함수입니다.
 */
function createCandidateMixedCall(steering, token, directFixture, flowFixture) {
    let phase = 0;
    return () => {
        const fixture = phase === 3 ? flowFixture : directFixture;
        phase = (phase + 1) & 3;
        return steering(
            fixture.enemy,
            fixture.state,
            fixture.context,
            fixture.profile,
            fixture.startX,
            fixture.startY,
            fixture.targetX,
            fixture.targetY,
            fixture.walls,
            fixture.enemyRadius,
            fixture.footprintMetrics,
            fixture.wallsVersion,
            fixture.forcedPolicyRefresh,
            fixture.aiDebugStats,
            token
        );
    };
}

/**
 * 호출을 반복하고 호출당 밀리초를 반환합니다.
 * @param {Function} call - 측정할 호출입니다.
 * @param {number} iterations - 반복 횟수입니다.
 * @returns {{milliseconds:number,checksum:number,lastDirection:object}} 측정 결과입니다.
 */
function measure(call, iterations) {
    let checksum = 0;
    let lastDirection = null;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index++) {
        lastDirection = call();
        checksum += lastDirection.x + lastDirection.y;
    }
    return {
        milliseconds: (performance.now() - startedAt) / iterations,
        checksum,
        lastDirection
    };
}

/**
 * 안정적인 sample 시간이 나오도록 반복 횟수를 보정합니다.
 * @param {object} benchmarkCase - 측정할 benchmark case입니다.
 * @returns {number} sample 반복 횟수입니다.
 */
function calibrateIterations(benchmarkCase) {
    let iterations = 1_024;
    while (iterations < 4_194_304) {
        const legacy = measure(benchmarkCase.legacyCall, iterations);
        const candidate = measure(benchmarkCase.candidateCall, iterations);
        assertBenchmarkCaseParity(benchmarkCase, legacy, candidate);
        if (Math.max(legacy.milliseconds, candidate.milliseconds) * iterations >= MIN_BATCH_MILLISECONDS) {
            return iterations;
        }
        iterations *= 2;
    }
    return iterations;
}

/**
 * 오름차순 nearest-rank percentile을 반환합니다.
 * @param {number[]} values - 표본입니다.
 * @param {number} percentile - 0~1 백분위입니다.
 * @returns {number} 백분위 값입니다.
 */
function percentile(values, percentileValue) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
    return sorted[index];
}

/**
 * 객체 그래프의 열거 가능 상태를 Object.is 의미론으로 재귀 대조합니다.
 * @param {*} legacyValue - legacy 값입니다.
 * @param {*} candidateValue - candidate 값입니다.
 * @param {string} path - 오류 경로입니다.
 */
function assertExactValue(legacyValue, candidateValue, path) {
    if (Object.is(legacyValue, candidateValue)) return;
    if (
        legacyValue == null
        || candidateValue == null
        || typeof legacyValue !== 'object'
        || typeof candidateValue !== 'object'
    ) {
        throw new Error(`${path} mismatch`);
    }

    const legacyIsView = ArrayBuffer.isView(legacyValue);
    const candidateIsView = ArrayBuffer.isView(candidateValue);
    if (legacyIsView || candidateIsView) {
        if (
            !legacyIsView
            || !candidateIsView
            || legacyValue.constructor !== candidateValue.constructor
            || legacyValue.length !== candidateValue.length
        ) {
            throw new Error(`${path} typed-array shape mismatch`);
        }
        for (let index = 0; index < legacyValue.length; index++) {
            if (!Object.is(legacyValue[index], candidateValue[index])) {
                throw new Error(`${path}[${index}] mismatch`);
            }
        }
        return;
    }

    const legacyKeys = Object.keys(legacyValue);
    const candidateKeys = Object.keys(candidateValue);
    if (legacyKeys.join('|') !== candidateKeys.join('|')) {
        throw new Error(`${path} key mismatch`);
    }
    for (const key of legacyKeys) {
        assertExactValue(legacyValue[key], candidateValue[key], `${path}.${key}`);
    }
}

/**
 * steering 실행 뒤 전체 AI state를 exact 대조합니다.
 * @param {object} legacyFixture - legacy fixture입니다.
 * @param {object} candidateFixture - candidate fixture입니다.
 */
function assertFixtureParity(legacyFixture, candidateFixture) {
    assertExactValue(legacyFixture.state, candidateFixture.state, 'state');
}

/**
 * 한 benchmark case의 반환값, checksum, fixture 상태를 exact 대조합니다.
 * @param {object} benchmarkCase - 대조할 benchmark case입니다.
 * @param {object|null} [legacyMeasurement=null] - legacy 측정값입니다.
 * @param {object|null} [candidateMeasurement=null] - candidate 측정값입니다.
 */
function assertBenchmarkCaseParity(
    benchmarkCase,
    legacyMeasurement = null,
    candidateMeasurement = null
) {
    if (legacyMeasurement && candidateMeasurement) {
        if (!Object.is(legacyMeasurement.checksum, candidateMeasurement.checksum)) {
            throw new Error(`${benchmarkCase.id} checksum mismatch`);
        }
        if (
            !benchmarkCase.legacyFixtures.some(
                (fixture) => legacyMeasurement.lastDirection === fixture.state.scratchDir
            )
        ) {
            throw new Error(`${benchmarkCase.id} legacy return identity mismatch`);
        }
        if (
            !benchmarkCase.candidateFixtures.some(
                (fixture) => candidateMeasurement.lastDirection === fixture.state.scratchDir
            )
        ) {
            throw new Error(`${benchmarkCase.id} candidate return identity mismatch`);
        }
        assertExactValue(
            legacyMeasurement.lastDirection,
            candidateMeasurement.lastDirection,
            `${benchmarkCase.id}.lastDirection`
        );
    }

    for (const [legacyFixture, candidateFixture] of benchmarkCase.fixturePairs) {
        assertFixtureParity(legacyFixture, candidateFixture);
    }
}

/**
 * NW Chromium의 IsHTMLDDA 특성을 가진 분리된 document.all을 만듭니다.
 * @returns {HTMLAllCollection} 느슨한 null 비교만 통과하는 옵션 객체입니다.
 */
function createDocumentAllOptions() {
    const probeDocument = document.implementation.createHTMLDocument('steering-contract-probe');
    const options = probeDocument.all;
    if (typeof options !== 'undefined' || options === undefined) {
        throw new Error('NW document.all IsHTMLDDA behavior unavailable');
    }
    return options;
}

/**
 * 공개 steering 호출의 반환 또는 예외를 안정적인 summary로 캡처합니다.
 * @param {Function} steering - 공개 steering 함수입니다.
 * @param {*} options - 공개 API의 첫 인자입니다.
 * @returns {{summary:object,direction:object|null}} 호출 관찰 결과입니다.
 */
function capturePublicCallOutcome(steering, options) {
    try {
        const direction = steering(options);
        return {
            summary: {
                kind: 'return',
                constructorName: direction?.constructor?.name,
                x: direction?.x,
                y: direction?.y
            },
            direction
        };
    } catch (error) {
        return {
            summary: {
                kind: 'throw',
                name: error?.name,
                message: error?.message,
                constructorName: error?.constructor?.name
            },
            direction: null
        };
    }
}

/**
 * document.all에 fixture 접근자를 설치해 공개 구조분해 조회를 관찰합니다.
 * @param {Function} steering - 공개 steering 함수입니다.
 * @param {string[]} keys - 관찰할 옵션 키 순서입니다.
 * @returns {{trace:string[],fixture:object,summary:object,direction:object|null}} 관찰 결과입니다.
 */
function observeDocumentAllPublicCall(steering, keys) {
    const options = createDocumentAllOptions();
    const fixture = createDirectReuseFixture();
    const trace = [];
    for (const key of keys) {
        Object.defineProperty(options, key, {
            configurable: true,
            enumerable: true,
            get() {
                trace.push(key);
                return fixture[key];
            }
        });
    }
    const outcome = capturePublicCallOutcome(steering, options);
    return { trace, fixture, ...outcome };
}

/**
 * 공개 객체 호출의 shape, getter 순서, null/undefined 오류를 비교합니다.
 * @param {object} legacyModule - legacy namespace입니다.
 * @param {object} candidateModule - candidate namespace입니다.
 */
function assertPublicContractParity(legacyModule, candidateModule) {
    const legacyFunction = legacyModule.resolveEnemyAISteeringDirection;
    const candidateFunction = candidateModule.resolveEnemyAISteeringDirection;
    if (
        legacyFunction.name !== 'resolveEnemyAISteeringDirection'
        || candidateFunction.name !== legacyFunction.name
        || legacyFunction.length !== 1
        || candidateFunction.length !== 1
    ) {
        throw new Error('public function name/length mismatch');
    }

    const keys = [
        'enemy', 'state', 'context', 'profile', 'startX', 'startY', 'targetX', 'targetY',
        'walls', 'enemyRadius', 'footprintMetrics', 'wallsVersion', 'forcedPolicyRefresh',
        'aiDebugStats'
    ];
    const runObserved = (steering) => {
        const fixture = createDirectReuseFixture();
        const trace = [];
        const options = {};
        for (const key of keys) {
            Object.defineProperty(options, key, {
                enumerable: true,
                get() {
                    trace.push(key);
                    return fixture[key];
                }
            });
        }
        const direction = steering(options, 'ignored-extra-argument');
        return { trace, fixture, direction };
    };
    const legacyObserved = runObserved(legacyFunction);
    const candidateObserved = runObserved(candidateFunction);
    if (legacyObserved.direction !== legacyObserved.fixture.state.scratchDir) {
        throw new Error('legacy scratch identity mismatch');
    }
    if (candidateObserved.direction !== candidateObserved.fixture.state.scratchDir) {
        throw new Error('candidate scratch identity mismatch');
    }
    if (legacyObserved.trace.join('|') !== keys.join('|')) throw new Error('legacy getter order mismatch');
    if (candidateObserved.trace.join('|') !== keys.join('|')) throw new Error('candidate getter order mismatch');
    assertFixtureParity(legacyObserved.fixture, candidateObserved.fixture);

    const legacyRawDocumentAll = capturePublicCallOutcome(
        legacyFunction,
        createDocumentAllOptions()
    );
    const candidateRawDocumentAll = capturePublicCallOutcome(
        candidateFunction,
        createDocumentAllOptions()
    );
    if (
        legacyRawDocumentAll.summary.kind !== 'throw'
        || candidateRawDocumentAll.summary.kind !== 'throw'
    ) {
        throw new Error('raw document.all must preserve the legacy error outcome');
    }
    assertExactValue(
        legacyRawDocumentAll.summary,
        candidateRawDocumentAll.summary,
        'public.documentAll.rawOutcome'
    );

    const legacyDocumentAll = observeDocumentAllPublicCall(legacyFunction, keys);
    const candidateDocumentAll = observeDocumentAllPublicCall(candidateFunction, keys);
    if (legacyDocumentAll.trace.join('|') !== keys.join('|')) {
        throw new Error('legacy document.all getter order mismatch');
    }
    if (candidateDocumentAll.trace.join('|') !== keys.join('|')) {
        throw new Error('candidate document.all getter order mismatch');
    }
    if (
        legacyDocumentAll.direction !== legacyDocumentAll.fixture.state.scratchDir
        || candidateDocumentAll.direction !== candidateDocumentAll.fixture.state.scratchDir
    ) {
        throw new Error('document.all scratch identity mismatch');
    }
    assertExactValue(
        legacyDocumentAll.summary,
        candidateDocumentAll.summary,
        'public.documentAll.observedOutcome'
    );
    assertFixtureParity(legacyDocumentAll.fixture, candidateDocumentAll.fixture);

    for (const invalid of [null, undefined]) {
        const capture = (steering) => {
            try {
                steering(invalid);
                return null;
            } catch (error) {
                return `${error?.name}|${error?.message}|${error?.constructor?.name}`;
            }
        };
        const legacyError = capture(legacyFunction);
        const candidateError = capture(candidateFunction);
        if (legacyError !== candidateError) {
            throw new Error(`public invalid options mismatch: ${legacyError} !== ${candidateError}`);
        }
    }
}

/**
 * direct, flow, 3:1 mixed benchmark case를 각각 독립 fixture로 구성합니다.
 * @param {object} legacyModule - legacy namespace입니다.
 * @param {object} candidateModule - candidate namespace입니다.
 * @returns {object[]} benchmark case 목록입니다.
 */
function createBenchmarkCases(legacyModule, candidateModule) {
    const legacySteering = legacyModule.resolveEnemyAISteeringDirection;
    const candidateSteering = candidateModule.resolveEnemyAISteeringDirection;
    const token = candidateModule.__testEnemyAISteeringPositionalCall;

    const legacyDirectFixture = createDirectReuseFixture();
    const candidateDirectFixture = createDirectReuseFixture();
    const legacyFlowFixture = createFlowReuseFixture();
    const candidateFlowFixture = createFlowReuseFixture();
    const legacyMixedDirectFixture = createDirectReuseFixture();
    const candidateMixedDirectFixture = createDirectReuseFixture();
    const legacyMixedFlowFixture = createFlowReuseFixture();
    const candidateMixedFlowFixture = createFlowReuseFixture();

    return [
        {
            id: 'direct-reuse',
            label: 'direct-reuse',
            legacyCall: createLegacyCall(legacySteering, legacyDirectFixture),
            candidateCall: createCandidateCall(
                candidateSteering,
                token,
                candidateDirectFixture
            ),
            legacyFixtures: [legacyDirectFixture],
            candidateFixtures: [candidateDirectFixture],
            fixturePairs: [[legacyDirectFixture, candidateDirectFixture]]
        },
        {
            id: 'flow-reuse',
            label: 'flow-reuse',
            legacyCall: createLegacyCall(legacySteering, legacyFlowFixture),
            candidateCall: createCandidateCall(
                candidateSteering,
                token,
                candidateFlowFixture
            ),
            legacyFixtures: [legacyFlowFixture],
            candidateFixtures: [candidateFlowFixture],
            fixturePairs: [[legacyFlowFixture, candidateFlowFixture]]
        },
        {
            id: 'mixed-3-to-1',
            label: 'mixed direct:flow = 3:1',
            legacyCall: createLegacyMixedCall(
                legacySteering,
                legacyMixedDirectFixture,
                legacyMixedFlowFixture
            ),
            candidateCall: createCandidateMixedCall(
                candidateSteering,
                token,
                candidateMixedDirectFixture,
                candidateMixedFlowFixture
            ),
            legacyFixtures: [legacyMixedDirectFixture, legacyMixedFlowFixture],
            candidateFixtures: [candidateMixedDirectFixture, candidateMixedFlowFixture],
            fixturePairs: [
                [legacyMixedDirectFixture, candidateMixedDirectFixture],
                [legacyMixedFlowFixture, candidateMixedFlowFixture]
            ],
            patternLength: 4
        }
    ];
}

/**
 * 한 case를 warm-up한 뒤 61개 표본을 legacy/candidate 교차 순서로 측정합니다.
 * @param {object} benchmarkCase - 측정할 benchmark case입니다.
 * @param {number} caseIndex - 0부터 시작하는 case 인덱스입니다.
 * @param {number} caseCount - 전체 case 수입니다.
 * @returns {Promise<object>} percentile과 speedup 결과입니다.
 */
async function runBenchmarkCase(benchmarkCase, caseIndex, caseCount) {
    assertBenchmarkCaseParity(benchmarkCase);
    statusElement.textContent = [
        `case ${caseIndex + 1}/${caseCount}: ${benchmarkCase.label}`,
        '반복 횟수 보정 중…'
    ].join('\n');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const iterations = calibrateIterations(benchmarkCase);
    if (benchmarkCase.patternLength && (iterations % benchmarkCase.patternLength) !== 0) {
        throw new Error(`${benchmarkCase.id} incomplete mixed pattern`);
    }

    for (let batch = 0; batch < WARMUP_BATCH_COUNT; batch++) {
        let legacy;
        let candidate;
        if ((batch & 1) === 0) {
            legacy = measure(benchmarkCase.legacyCall, iterations);
            candidate = measure(benchmarkCase.candidateCall, iterations);
        } else {
            candidate = measure(benchmarkCase.candidateCall, iterations);
            legacy = measure(benchmarkCase.legacyCall, iterations);
        }
        assertBenchmarkCaseParity(benchmarkCase, legacy, candidate);
    }

    const legacySamples = [];
    const candidateSamples = [];
    let checksum = 0;
    for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
        let legacy;
        let candidate;
        if ((sample & 1) === 0) {
            legacy = measure(benchmarkCase.legacyCall, iterations);
            candidate = measure(benchmarkCase.candidateCall, iterations);
        } else {
            candidate = measure(benchmarkCase.candidateCall, iterations);
            legacy = measure(benchmarkCase.legacyCall, iterations);
        }
        legacySamples.push(legacy.milliseconds);
        candidateSamples.push(candidate.milliseconds);
        checksum += legacy.checksum + candidate.checksum;
        assertBenchmarkCaseParity(benchmarkCase, legacy, candidate);
        if ((sample % 5) === 4 || sample === SAMPLE_COUNT - 1) {
            statusElement.textContent = [
                `case ${caseIndex + 1}/${caseCount}: ${benchmarkCase.label}`,
                `측정 ${sample + 1}/${SAMPLE_COUNT}…`
            ].join('\n');
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    }

    if (!Number.isFinite(checksum)) {
        throw new Error(`${benchmarkCase.id} invalid benchmark checksum`);
    }
    const legacyP50 = percentile(legacySamples, 0.5);
    const legacyP95 = percentile(legacySamples, 0.95);
    const candidateP50 = percentile(candidateSamples, 0.5);
    const candidateP95 = percentile(candidateSamples, 0.95);
    return {
        id: benchmarkCase.id,
        label: benchmarkCase.label,
        iterations,
        legacyP50,
        legacyP95,
        candidateP50,
        candidateP95,
        p50Speedup: legacyP50 / candidateP50,
        p95Speedup: legacyP95 / candidateP95
    };
}

/**
 * 한 case의 exact parity와 p50/p95 결과를 표시용 줄로 만듭니다.
 * @param {object} result - benchmark case 결과입니다.
 * @returns {string[]} 표시할 줄입니다.
 */
function formatBenchmarkResult(result) {
    return [
        `[${result.label}] parity: exact`,
        `iterations/sample: ${result.iterations.toLocaleString('en-US')}`,
        `legacy p50/p95: ${(result.legacyP50 * 1e6).toFixed(1)} / ${(result.legacyP95 * 1e6).toFixed(1)} ns/call`,
        `candidate p50/p95: ${(result.candidateP50 * 1e6).toFixed(1)} / ${(result.candidateP95 * 1e6).toFixed(1)} ns/call`,
        `speedup p50/p95: ${result.p50Speedup.toFixed(3)}x / ${result.p95Speedup.toFixed(3)}x`
    ];
}

async function run() {
    const response = await fetch(steeringUrl);
    if (!response.ok) throw new Error(`steering source load failed: ${response.status}`);
    const source = (await response.text()).replace(/\r\n?/g, '\n');
    const { legacySource, candidateSource } = deriveBenchmarkSources(source);
    const [legacyModule, candidateModule] = await Promise.all([
        importSourceModule(legacySource),
        importSourceModule(candidateSource)
    ]);
    assertPublicContractParity(legacyModule, candidateModule);
    const benchmarkCases = createBenchmarkCases(legacyModule, candidateModule);
    const results = [];
    for (let index = 0; index < benchmarkCases.length; index++) {
        results.push(await runBenchmarkCase(benchmarkCases[index], index, benchmarkCases.length));
    }

    const mixedResult = results.find((result) => result.id === 'mixed-3-to-1');
    if (!mixedResult) throw new Error('mixed benchmark result missing');
    const accepted = mixedResult.p50Speedup >= REQUIRED_MIXED_P50_SPEEDUP;

    document.title = accepted
        ? 'CANDIDATE — Enemy AI steering call benchmark'
        : 'NO-GO — Enemy AI steering call benchmark';
    statusElement.className = accepted ? 'pass' : 'warn';
    statusElement.textContent = [
        accepted ? 'CANDIDATE' : 'NO-GO',
        '공개 객체 API: name/length/getter order/null·undefined/document.all exact',
        'hot path: production steering 전체 본문/deps + direct/flow cache reuse',
        `samples: case별 ${SAMPLE_COUNT}, legacy/candidate 선행 순서 교차`,
        ...results.flatMap((result) => ['', ...formatBenchmarkResult(result)]),
        '',
        `gate: mixed 3:1 p50 >= ${REQUIRED_MIXED_P50_SPEEDUP.toFixed(2)}x`,
        `engine: ${navigator.userAgent}`
    ].join('\n');
}

run().catch((error) => {
    document.title = 'FAIL — Enemy AI steering call benchmark';
    statusElement.className = 'fail';
    statusElement.textContent = `FAIL\n${error?.stack ?? error}`;
});
