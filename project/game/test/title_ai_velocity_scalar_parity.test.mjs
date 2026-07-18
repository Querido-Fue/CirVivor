import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const GAME_DIRECTORY = resolve(TEST_DIRECTORY, '..');
const TITLE_AI_PATH = resolve(
    GAME_DIRECTORY,
    'script/module/object/enemy/ai/_title_ai.js'
);
const NUMBER_UTIL_PATH = resolve(GAME_DIRECTORY, 'script/util/number_util.js');
const TITLE_CONSTANTS_PATH = resolve(
    GAME_DIRECTORY,
    'script/data/scene/title/title_constants.js'
);
const RAW_FLOAT_CASE_COUNT = 100_000;
const FULL_UPDATE_RAW_CASE_COUNT = 2_048;
const MASK_64 = (1n << 64n) - 1n;
const floatView = new DataView(new ArrayBuffer(8));

const normalizeLineEndings = (source) => source.replace(/\r\n?/g, '\n');
const [titleAISource, numberUtilSource, titleConstantsSource] = (
    await Promise.all([
        readFile(TITLE_AI_PATH, 'utf8'),
        readFile(NUMBER_UTIL_PATH, 'utf8'),
        readFile(TITLE_CONSTANTS_PATH, 'utf8')
    ])
).map(normalizeLineEndings);

const LEGACY_HELPER = `const easeOutExpoVelocityToMaxSpeed = (vx, vy, maxSpeed, stepDelta) => {
    if (!(Number.isFinite(maxSpeed) && maxSpeed > 0)) {
        return { x: vx, y: vy };
    }

    const speed = Math.hypot(vx, vy);
    if (!(speed > maxSpeed)) {
        return { x: vx, y: vy };
    }

    const easedOverflow = TITLE_SPEED_CAP_EASEOUT_EXPO_RATE > 0
        ? (speed - maxSpeed) * Math.pow(2, -(TITLE_SPEED_CAP_EASEOUT_EXPO_RATE * Math.max(0, stepDelta)))
        : 0;
    const nextSpeed = maxSpeed + easedOverflow;
    const scale = nextSpeed / speed;
    return {
        x: vx * scale,
        y: vy * scale
    };
};`;

const SCALAR_HELPER = `const getEaseOutExpoVelocityScale = (vx, vy, maxSpeed, stepDelta) => {
    if (!(Number.isFinite(maxSpeed) && maxSpeed > 0)) {
        return 1;
    }

    const speed = Math.hypot(vx, vy);
    if (!(speed > maxSpeed)) {
        return 1;
    }

    const easedOverflow = TITLE_SPEED_CAP_EASEOUT_EXPO_RATE > 0
        ? (speed - maxSpeed) * Math.pow(2, -(TITLE_SPEED_CAP_EASEOUT_EXPO_RATE * Math.max(0, stepDelta)))
        : 0;
    const nextSpeed = maxSpeed + easedOverflow;
    return nextSpeed / speed;
};`;

const LEGACY_FIXED_UPDATE_BLOCK = `        const clampedTargetVelocity = easeOutExpoVelocityToMaxSpeed(
            unclampedTargetVx,
            unclampedTargetVy,
            getTitleEnemySpeedCap(enemy),
            stepDelta
        );
        enemy.setAcc(
            clampedTargetVelocity.x - enemy.speed.x,
            clampedTargetVelocity.y - enemy.speed.y
        );`;

const SCALAR_FIXED_UPDATE_BLOCK = `        const targetVelocityScale = getEaseOutExpoVelocityScale(
            unclampedTargetVx,
            unclampedTargetVy,
            getTitleEnemySpeedCap(enemy),
            stepDelta
        );
        const clampedTargetVx = unclampedTargetVx * targetVelocityScale;
        const clampedTargetVy = unclampedTargetVy * targetVelocityScale;
        enemy.setAcc(
            clampedTargetVx - enemy.speed.x,
            clampedTargetVy - enemy.speed.y
        );`;

/**
 * 정확히 한 번 존재하는 소스 블록만 치환합니다.
 * @param {string} source - 원본 소스입니다.
 * @param {string} before - 치환 전 블록입니다.
 * @param {string} after - 치환 후 블록입니다.
 * @param {string} label - 실패 메시지용 블록 이름입니다.
 * @returns {string} 치환된 소스입니다.
 */
function replaceExactlyOnce(source, before, after, label) {
    const occurrenceCount = source.split(before).length - 1;
    assert.equal(occurrenceCount, 1, `${label} 블록은 정확히 한 번 존재해야 합니다.`);
    return source.replace(before, after);
}

/**
 * 현재 production이 legacy이면 검증용 scalar 후보로 정확히 변환하고,
 * 이미 scalar이면 production 소스를 그대로 반환합니다.
 * @param {string} source - 전체 타이틀 AI 소스입니다.
 * @returns {string} 전체 scalar 후보 소스입니다.
 */
function deriveScalarCandidateSource(source) {
    const scalarHelperCount = source.split(SCALAR_HELPER).length - 1;
    const scalarBlockCount = source.split(SCALAR_FIXED_UPDATE_BLOCK).length - 1;
    if (scalarHelperCount === 1 && scalarBlockCount === 1) {
        return source;
    }

    let candidate = replaceExactlyOnce(source, LEGACY_HELPER, SCALAR_HELPER, 'legacy helper');
    candidate = replaceExactlyOnce(
        candidate,
        LEGACY_FIXED_UPDATE_BLOCK,
        SCALAR_FIXED_UPDATE_BLOCK,
        'legacy fixedUpdate'
    );
    return candidate;
}

/**
 * scalar 전체 후보 소스에서 독립 비교용 legacy 소스를 정확히 한 번 역변환합니다.
 * @param {string} source - 전체 scalar 후보 소스입니다.
 * @returns {string} 전체 legacy 소스입니다.
 */
function deriveLegacySource(source) {
    let legacy = replaceExactlyOnce(source, SCALAR_HELPER, LEGACY_HELPER, 'scalar helper');
    legacy = replaceExactlyOnce(
        legacy,
        SCALAR_FIXED_UPDATE_BLOCK,
        LEGACY_FIXED_UPDATE_BLOCK,
        'scalar fixedUpdate'
    );
    return legacy;
}

const scalarCandidateSource = deriveScalarCandidateSource(titleAISource);
const legacySource = deriveLegacySource(scalarCandidateSource);

/**
 * 실제 상수 모듈 전체를 평가합니다.
 * @returns {Promise<object>} TITLE_CONSTANTS입니다.
 */
async function loadActualTitleConstants() {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(titleConstantsSource, {
        context,
        identifier: pathToFileURL(TITLE_CONSTANTS_PATH).href
    });
    await module.link((specifier) => {
        throw new Error(`unexpected title constants import: ${specifier}`);
    });
    await module.evaluate();
    return module.namespace.TITLE_CONSTANTS;
}

const TITLE_CONSTANTS = await loadActualTitleConstants();
const TITLE_SPEED_CAP_EASEOUT_EXPO_RATE = Number.isFinite(
    TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_EASEOUT_EXPO_RATE
)
    ? Math.max(0, TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_EASEOUT_EXPO_RATE)
    : 0;

/**
 * 실제 전체 타이틀 AI 소스를 VM 모듈로 연결합니다.
 * @param {string} source - 전체 모듈 소스입니다.
 * @param {object} [hooks={}] - 의존 함수 관찰 훅입니다.
 * @param {boolean} [exportScalarHelper=false] - 테스트 전용 helper export 추가 여부입니다.
 * @returns {Promise<object>} 평가한 모듈 namespace입니다.
 */
async function loadTitleAIRuntime(source, hooks = {}, exportScalarHelper = false) {
    const context = vm.createContext({ console });
    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
    const dataModule = createSyntheticModule('data/data_handler.js', {
        getData(key) {
            if (key === 'TITLE_CONSTANTS') return TITLE_CONSTANTS;
            throw new Error(`unexpected data key: ${key}`);
        }
    });
    const physicsModule = createSyntheticModule('physics/_magnetic_effect.js', {
        applyMagneticPoint(...args) {
            return hooks.applyMagneticPoint?.(...args);
        }
    });
    const simulationModule = createSyntheticModule('simulation/simulation_runtime.js', {
        getSimulationMouseFocus(...args) {
            return hooks.getSimulationMouseFocus?.(...args) ?? [];
        },
        getSimulationMouseInput(...args) {
            return hooks.getSimulationMouseInput?.(...args) ?? null;
        },
        isSimulationMousePressing(...args) {
            return hooks.isSimulationMousePressing?.(...args) ?? false;
        }
    });
    const numberModule = new vm.SourceTextModule(numberUtilSource, {
        context,
        identifier: pathToFileURL(NUMBER_UTIL_PATH).href
    });
    const moduleSource = exportScalarHelper
        ? `${source}\nexport { getEaseOutExpoVelocityScale as __testGetVelocityScale };\n`
        : source;
    const titleModule = new vm.SourceTextModule(moduleSource, {
        context,
        identifier: `${pathToFileURL(TITLE_AI_PATH).href}?variant=${encodeURIComponent(
            hooks.identifier ?? 'runtime'
        )}`
    });

    await titleModule.link((specifier) => {
        if (specifier === 'data/data_handler.js') return dataModule;
        if (specifier === 'physics/_magnetic_effect.js') return physicsModule;
        if (specifier === 'simulation/simulation_runtime.js') return simulationModule;
        if (specifier === 'util/number_util.js') return numberModule;
        throw new Error(`unexpected title AI import: ${specifier}`);
    });
    await titleModule.evaluate();
    return titleModule.namespace;
}

/**
 * 변경 전 객체 반환 helper를 테스트 코드에 독립 오라클로 재현합니다.
 * @param {number} vx - X축 목표 속도입니다.
 * @param {number} vy - Y축 목표 속도입니다.
 * @param {number} maxSpeed - 최대 속도입니다.
 * @param {number} stepDelta - 고정 틱 델타입니다.
 * @returns {{x:number,y:number}} legacy 목표 속도입니다.
 */
function easeOutExpoVelocityToMaxSpeedLegacy(vx, vy, maxSpeed, stepDelta) {
    if (!(Number.isFinite(maxSpeed) && maxSpeed > 0)) {
        return { x: vx, y: vy };
    }

    const speed = Math.hypot(vx, vy);
    if (!(speed > maxSpeed)) {
        return { x: vx, y: vy };
    }

    const easedOverflow = TITLE_SPEED_CAP_EASEOUT_EXPO_RATE > 0
        ? (speed - maxSpeed) * Math.pow(
            2,
            -(TITLE_SPEED_CAP_EASEOUT_EXPO_RATE * Math.max(0, stepDelta))
        )
        : 0;
    const nextSpeed = maxSpeed + easedOverflow;
    const scale = nextSpeed / speed;
    return { x: vx * scale, y: vy * scale };
}

/**
 * xorshift64 상태를 다음 결정적 값으로 전진시킵니다.
 * @param {bigint} state - 현재 상태입니다.
 * @returns {bigint} 다음 상태입니다.
 */
function nextRandomBits(state) {
    let next = state & MASK_64;
    next ^= (next << 13n) & MASK_64;
    next ^= next >> 7n;
    next ^= (next << 17n) & MASK_64;
    return next & MASK_64;
}

/**
 * 원시 64비트 패턴을 IEEE-754 배정밀도 값으로 해석합니다.
 * @param {bigint} bits - 원시 비트입니다.
 * @returns {number} 해석한 숫자입니다.
 */
function floatFromBits(bits) {
    floatView.setBigUint64(0, bits & MASK_64, false);
    return floatView.getFloat64(0, false);
}

/**
 * 숫자의 IEEE-754 배정밀도 표현을 원시 64비트로 반환합니다.
 * @param {number} value - 변환할 숫자입니다.
 * @returns {bigint} 원시 비트입니다.
 */
function floatToBits(value) {
    floatView.setFloat64(0, value, false);
    return floatView.getBigUint64(0, false);
}

/**
 * 부호 있는 0과 NaN을 포함해 숫자 동일성을 검사합니다.
 * @param {number} actual - 후보 값입니다.
 * @param {number} expected - legacy 값입니다.
 * @param {string} label - 케이스 이름입니다.
 */
function assertSameNumber(actual, expected, label) {
    assert.ok(
        Object.is(actual, expected),
        `${label}: expected ${String(expected)}, received ${String(actual)}`
    );
}

/**
 * 숫자에는 Object.is를 사용하면서 배열/레코드를 재귀 비교합니다.
 * @param {unknown} actual - 후보 값입니다.
 * @param {unknown} expected - legacy 값입니다.
 * @param {string} label - 현재 경로입니다.
 */
function assertExactValue(actual, expected, label) {
    if (typeof actual === 'number' || typeof expected === 'number') {
        assertSameNumber(actual, expected, label);
        return;
    }
    if (Array.isArray(actual) || Array.isArray(expected)) {
        assert.ok(Array.isArray(actual) && Array.isArray(expected), `${label}: 배열 형태 차이`);
        assert.equal(actual.length, expected.length, `${label}: 배열 길이 차이`);
        for (let index = 0; index < actual.length; index += 1) {
            assertExactValue(actual[index], expected[index], `${label}[${index}]`);
        }
        return;
    }
    if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
        const actualKeys = Object.keys(actual);
        const expectedKeys = Object.keys(expected);
        assert.deepEqual(actualKeys, expectedKeys, `${label}: key 차이`);
        for (const key of actualKeys) {
            assertExactValue(actual[key], expected[key], `${label}.${key}`);
        }
        return;
    }
    assert.strictEqual(actual, expected, `${label}: 값 차이`);
}

/**
 * 실행 완료 형태와 예외 계약을 비교합니다. V8 비표준 Error.stack은 제외합니다.
 * @param {object} actual - 후보 결과입니다.
 * @param {object} expected - legacy 결과입니다.
 * @param {string} label - 케이스 이름입니다.
 */
function assertSameOutcome(actual, expected, label) {
    assert.equal(actual.ok, expected.ok, `${label}: 완료 형태 차이`);
    if (actual.ok) return;
    assert.equal(actual.error?.name, expected.error?.name, `${label}: 예외 이름 차이`);
    assert.equal(actual.error?.message, expected.error?.message, `${label}: 예외 메시지 차이`);
    assert.equal(
        actual.error?.constructor?.name,
        expected.error?.constructor?.name,
        `${label}: 예외 생성자 차이`
    );
}

/**
 * 함수 실행 결과를 캡처합니다.
 * @param {Function} action - 실행할 함수입니다.
 * @returns {{ok:boolean,error:unknown}} 실행 결과입니다.
 */
function capture(action) {
    try {
        action();
        return { ok: true, error: null };
    } catch (error) {
        return { ok: false, error };
    }
}

const defaultContext = Object.freeze({
    uiww: 0,
    logoMagneticPoint: null,
    logoMagneticDistance: 0,
    objectFocused: false,
    leftPressing: false,
    mousePos: Object.freeze({ x: 0, y: 0 })
});

/**
 * fixedUpdate 전체 경로용 적 대역을 생성합니다.
 * @param {object} values - 초기 숫자 상태입니다.
 * @param {string[]} trace - 호출 기록입니다.
 * @returns {object} 적 대역입니다.
 */
function createEnemy(values, trace = []) {
    const enemy = {
        _titleMagVel: { x: values.magX, y: values.magY },
        _spawnBoost: values.spawnBoost,
        _spawnBoostDecayRate: values.spawnBoostDecayRate,
        _titleBaseSpeed: { x: values.baseX, y: values.baseY },
        _titleBurstVel: { x: values.burstX, y: values.burstY },
        _titleBurstDecayRate: values.burstDecayRate,
        _titleAccelResponse: values.accelResponse,
        _titleParallaxMotionScale: values.parallaxScale,
        speed: { x: values.speedX, y: values.speedY },
        accSpeed: values.initialAccSpeed,
        _setAccCalls: [],
        _setAccBitCalls: [],
        setAcc(x, y) {
            trace.push('setAcc.call');
            this._setAccCalls.push([x, y]);
            this._setAccBitCalls.push([floatToBits(x), floatToBits(y)]);
        }
    };
    return enemy;
}

/**
 * 비교할 수 있는 적 상태만 추출합니다.
 * @param {object} enemy - 적 대역입니다.
 * @returns {object} 숫자 상태 스냅샷입니다.
 */
function snapshotEnemy(enemy) {
    return {
        titleMagVel: [enemy._titleMagVel.x, enemy._titleMagVel.y],
        spawnBoost: enemy._spawnBoost,
        spawnBoostDecayRate: enemy._spawnBoostDecayRate,
        titleBaseSpeed: [enemy._titleBaseSpeed.x, enemy._titleBaseSpeed.y],
        titleBurstVel: [enemy._titleBurstVel.x, enemy._titleBurstVel.y],
        burstDecayRate: enemy._titleBurstDecayRate,
        accelResponse: enemy._titleAccelResponse,
        parallaxScale: enemy._titleParallaxMotionScale,
        accSpeed: enemy.accSpeed,
        setAccCalls: enemy._setAccCalls,
        setAccBitCalls: enemy._setAccBitCalls
    };
}

const ordinaryValues = Object.freeze({
    magX: 0,
    magY: 0,
    spawnBoost: 5,
    spawnBoostDecayRate: 0,
    baseX: 10,
    baseY: 0,
    burstX: 0,
    burstY: 0,
    burstDecayRate: 0,
    accelResponse: 6,
    parallaxScale: 1,
    speedX: 3,
    speedY: -4,
    initialAccSpeed: -1
});

test('실제 production 전체 타이틀 AI 모듈을 VM SourceTextModule로 로드한다', async () => {
    const runtime = await loadTitleAIRuntime(titleAISource, { identifier: 'actual-production' });
    assert.equal(runtime.titleAI.id, TITLE_CONSTANTS.TITLE_AI.ID);
    assert.equal(typeof runtime.titleAI.fixedUpdate, 'function');
    assert.equal(typeof runtime.ensureTitleEnemyState, 'function');
});

test('scalar helper는 명시적 IEEE-754 경계에서 독립 legacy 오라클과 같다', async () => {
    const runtime = await loadTitleAIRuntime(
        scalarCandidateSource,
        { identifier: 'scalar-helper-explicit' },
        true
    );
    const getScale = runtime.__testGetVelocityScale;
    const cases = [
        [0, 0, 0, 0],
        [-0, 0, 1, 0],
        [0, -0, 1, -0],
        [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE],
        [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0],
        [-Number.MAX_VALUE, Number.MAX_VALUE, 1, Number.MIN_VALUE],
        [Number.POSITIVE_INFINITY, 1, 10, 1 / 60],
        [Number.NEGATIVE_INFINITY, 1, 10, 1 / 60],
        [Number.NaN, 1, 10, 1 / 60],
        [1, Number.NaN, 10, 1 / 60],
        [3, 4, 5, 0],
        [3, 4, floatFromBits(0x4013FFFFFFFFFFFFn), 0],
        [3, 4, floatFromBits(0x4014000000000001n), 0],
        [6, 8, 5, Number.NEGATIVE_INFINITY],
        [6, 8, 5, Number.POSITIVE_INFINITY],
        [6, 8, 5, Number.NaN],
        [6, 8, Number.NaN, 1 / 60],
        [6, 8, Number.POSITIVE_INFINITY, 1 / 60],
        [6, 8, Number.NEGATIVE_INFINITY, 1 / 60],
        [6, 8, -0, 1 / 60],
        [6, 8, -5, 1 / 60],
        [Number.MAX_VALUE, Number.MIN_VALUE, Number.MIN_VALUE, Number.MAX_VALUE]
    ];

    for (let index = 0; index < cases.length; index += 1) {
        const [vx, vy, maxSpeed, stepDelta] = cases[index];
        const expected = easeOutExpoVelocityToMaxSpeedLegacy(vx, vy, maxSpeed, stepDelta);
        const scale = getScale(vx, vy, maxSpeed, stepDelta);
        assertSameNumber(vx * scale, expected.x, `explicit[${index}].x`);
        assertSameNumber(vy * scale, expected.y, `explicit[${index}].y`);
    }
});

/**
 * stepDelta 강제 변환 시나리오를 실행합니다.
 * @param {Function} velocityFunction - 속도 벡터를 반환할 helper입니다.
 * @param {string} kind - 입력 시나리오입니다.
 * @returns {{outcome:object,trace:string[],thrownSentinel:boolean}} 비교 가능한 결과입니다.
 */
function runStepDeltaScenario(velocityFunction, kind) {
    const trace = [];
    const sentinel = new RangeError(`step-delta-sentinel:${kind}`);
    let entered = false;
    let stepDelta;

    if (kind === 'boxed-number') {
        stepDelta = new Number(0.25);
    } else if (kind === 'numeric-string') {
        stepDelta = '0.25';
    } else if (kind === 'symbol') {
        stepDelta = Symbol('stepDelta');
    } else if (kind === 'bigint') {
        stepDelta = 1n;
    } else if (kind === 'custom-number') {
        stepDelta = {
            [Symbol.toPrimitive](hint) {
                trace.push(`outer.toPrimitive:${hint}`);
                return -0.25;
            }
        };
    } else if (kind === 'custom-throw') {
        stepDelta = {
            [Symbol.toPrimitive](hint) {
                trace.push(`outer.toPrimitive:${hint}`);
                throw sentinel;
            }
        };
    } else if (kind === 'custom-reentrant') {
        stepDelta = {
            [Symbol.toPrimitive](hint) {
                trace.push(`outer.toPrimitive:${hint}`);
                if (!entered) {
                    entered = true;
                    trace.push('inner.begin');
                    const inner = velocityFunction(3, 4, 4, 0.5);
                    trace.push(`inner.bits:${floatToBits(inner.x)}:${floatToBits(inner.y)}`);
                    trace.push('inner.end');
                }
                return 0.25;
            }
        };
    } else {
        throw new Error(`알 수 없는 stepDelta 시나리오입니다: ${kind}`);
    }

    let outcome;
    try {
        const value = velocityFunction(6, 8, 5, stepDelta);
        outcome = {
            ok: true,
            bits: [floatToBits(value.x), floatToBits(value.y)],
            error: null
        };
    } catch (error) {
        outcome = {
            ok: false,
            bits: null,
            error: {
                name: error?.name,
                message: error?.message,
                constructorName: error?.constructor?.name
            }
        };
        return { outcome, trace, thrownSentinel: error === sentinel };
    }
    return { outcome, trace, thrownSentinel: false };
}

test('stepDelta coercion·예외·재진입 계약이 legacy와 같다', async () => {
    const runtime = await loadTitleAIRuntime(
        scalarCandidateSource,
        { identifier: 'scalar-helper-step-delta' },
        true
    );
    const candidateVelocity = (vx, vy, maxSpeed, stepDelta) => {
        const scale = runtime.__testGetVelocityScale(vx, vy, maxSpeed, stepDelta);
        return { x: vx * scale, y: vy * scale };
    };
    for (const kind of [
        'boxed-number',
        'numeric-string',
        'symbol',
        'bigint',
        'custom-number',
        'custom-throw',
        'custom-reentrant'
    ]) {
        const actual = runStepDeltaScenario(candidateVelocity, kind);
        const expected = runStepDeltaScenario(easeOutExpoVelocityToMaxSpeedLegacy, kind);
        assert.deepEqual(actual, expected, `stepDelta:${kind}`);
        if (kind === 'custom-throw') {
            assert.equal(actual.thrownSentinel, true, 'candidate는 원래 sentinel을 그대로 던져야 합니다.');
            assert.equal(expected.thrownSentinel, true, 'legacy는 원래 sentinel을 그대로 던져야 합니다.');
        }
    }
});

test(`${RAW_FLOAT_CASE_COUNT.toLocaleString('en-US')}개 raw Float64 tuple이 Object.is 기준으로 같다`, async () => {
    const runtime = await loadTitleAIRuntime(
        scalarCandidateSource,
        { identifier: 'scalar-helper-raw' },
        true
    );
    const getScale = runtime.__testGetVelocityScale;
    let randomState = 0xD1B54A32D192ED03n;

    for (let index = 0; index < RAW_FLOAT_CASE_COUNT; index += 1) {
        randomState = nextRandomBits(randomState);
        const vx = floatFromBits(randomState);
        randomState = nextRandomBits(randomState);
        const vy = floatFromBits(randomState);
        randomState = nextRandomBits(randomState);
        const maxSpeed = floatFromBits(randomState);
        randomState = nextRandomBits(randomState);
        const stepDelta = floatFromBits(randomState);
        const expected = easeOutExpoVelocityToMaxSpeedLegacy(vx, vy, maxSpeed, stepDelta);
        const scale = getScale(vx, vy, maxSpeed, stepDelta);
        if (!Object.is(vx * scale, expected.x) || !Object.is(vy * scale, expected.y)) {
            assert.fail(`raw Float64 tuple ${index}에서 속도 결과가 달라졌습니다.`);
        }
    }
});

test('전체 fixedUpdate의 명시적 상태와 호출 결과가 legacy와 같다', async () => {
    const candidateTrace = [];
    const legacyTrace = [];
    const candidateRuntime = await loadTitleAIRuntime(scalarCandidateSource, {
        identifier: 'candidate-explicit-update',
        applyMagneticPoint(target, point, strength, distance, stepDelta, options) {
            candidateTrace.push([
                'magnetic',
                target === candidateEnemy,
                point === defaultContext.mousePos,
                strength,
                distance,
                stepDelta,
                options.velocity === target._titleMagVel,
                options.motionScale,
                options.impulseScale
            ]);
        }
    });
    const legacyRuntime = await loadTitleAIRuntime(legacySource, {
        identifier: 'legacy-explicit-update',
        applyMagneticPoint(target, point, strength, distance, stepDelta, options) {
            legacyTrace.push([
                'magnetic',
                target === legacyEnemy,
                point === defaultContext.mousePos,
                strength,
                distance,
                stepDelta,
                options.velocity === target._titleMagVel,
                options.motionScale,
                options.impulseScale
            ]);
        }
    });
    let candidateEnemy;
    let legacyEnemy;
    const cases = [
        ordinaryValues,
        { ...ordinaryValues, spawnBoost: 1 },
        { ...ordinaryValues, baseX: -0, baseY: 0, spawnBoost: -0, speedX: -0, speedY: 0 },
        { ...ordinaryValues, baseX: Number.MAX_VALUE, baseY: Number.MAX_VALUE },
        { ...ordinaryValues, magX: Number.NaN, burstY: Number.POSITIVE_INFINITY },
        { ...ordinaryValues, spawnBoost: Number.NEGATIVE_INFINITY, accelResponse: 0 },
        { ...ordinaryValues, burstX: 100, burstY: -50, burstDecayRate: 11.5 },
        { ...ordinaryValues, spawnBoost: 1.0005, spawnBoostDecayRate: 100 }
    ];
    const stepDeltas = [1 / 60, 0, -0, -1, Number.MIN_VALUE, Number.POSITIVE_INFINITY, 0.25, 1];

    for (let index = 0; index < cases.length; index += 1) {
        candidateTrace.length = 0;
        legacyTrace.length = 0;
        candidateEnemy = createEnemy(cases[index], candidateTrace);
        legacyEnemy = createEnemy(cases[index], legacyTrace);
        const stepDelta = stepDeltas[index];
        const actual = capture(() => candidateRuntime.titleAI.fixedUpdate(
            candidateEnemy,
            stepDelta,
            defaultContext
        ));
        const expected = capture(() => legacyRuntime.titleAI.fixedUpdate(
            legacyEnemy,
            stepDelta,
            defaultContext
        ));
        assertSameOutcome(actual, expected, `explicit fixedUpdate[${index}]`);
        assertExactValue(
            snapshotEnemy(candidateEnemy),
            snapshotEnemy(legacyEnemy),
            `explicit fixedUpdate[${index}].state`
        );
        assertExactValue(candidateTrace, legacyTrace, `explicit fixedUpdate[${index}].trace`);
    }
});

test(`${FULL_UPDATE_RAW_CASE_COUNT}개 raw 상태의 전체 fixedUpdate가 legacy와 같다`, async () => {
    const candidateRuntime = await loadTitleAIRuntime(scalarCandidateSource, {
        identifier: 'candidate-raw-update'
    });
    const legacyRuntime = await loadTitleAIRuntime(legacySource, {
        identifier: 'legacy-raw-update'
    });
    let randomState = 0x9E3779B97F4A7C15n;
    const nextFloat = () => {
        randomState = nextRandomBits(randomState);
        return floatFromBits(randomState);
    };

    for (let index = 0; index < FULL_UPDATE_RAW_CASE_COUNT; index += 1) {
        const values = {
            magX: nextFloat(),
            magY: nextFloat(),
            spawnBoost: nextFloat(),
            spawnBoostDecayRate: nextFloat(),
            baseX: nextFloat(),
            baseY: nextFloat(),
            burstX: nextFloat(),
            burstY: nextFloat(),
            burstDecayRate: nextFloat(),
            accelResponse: nextFloat(),
            parallaxScale: nextFloat(),
            speedX: nextFloat(),
            speedY: nextFloat(),
            initialAccSpeed: nextFloat()
        };
        const stepDelta = nextFloat();
        const candidateEnemy = createEnemy(values);
        const legacyEnemy = createEnemy(values);
        const actual = capture(() => candidateRuntime.titleAI.fixedUpdate(
            candidateEnemy,
            stepDelta,
            defaultContext
        ));
        const expected = capture(() => legacyRuntime.titleAI.fixedUpdate(
            legacyEnemy,
            stepDelta,
            defaultContext
        ));
        assertSameOutcome(actual, expected, `raw fixedUpdate[${index}]`);
        assertExactValue(
            snapshotEnemy(candidateEnemy),
            snapshotEnemy(legacyEnemy),
            `raw fixedUpdate[${index}].state`
        );
    }
});

/**
 * setAcc와 speed의 getter/예외/부분 변경 순서를 관찰할 적을 생성합니다.
 * @param {string|null} failAt - 예외를 던질 관찰 지점입니다.
 * @returns {object} 실행 시나리오입니다.
 */
function createObservedScenario(failAt) {
    const trace = [];
    const sentinel = new RangeError(`title-ai-sentinel:${failAt}`);
    const values = { ...ordinaryValues };
    const setAccCalls = [];
    const mark = (label) => {
        trace.push(label);
        if (failAt === label) throw sentinel;
    };
    let speedReadCount = 0;
    const speed = {};
    Object.defineProperties(speed, {
        x: {
            get() {
                mark('speed.x.get');
                return values.speedX;
            }
        },
        y: {
            get() {
                mark('speed.y.get');
                return values.speedY;
            }
        }
    });
    const magVel = {};
    let magX = values.magX;
    let magY = values.magY;
    Object.defineProperties(magVel, {
        x: {
            enumerable: true,
            configurable: true,
            get: () => magX,
            set(value) {
                mark('mag.x.set');
                magX = value;
            }
        },
        y: {
            enumerable: true,
            configurable: true,
            get: () => magY,
            set(value) {
                mark('mag.y.set');
                magY = value;
            }
        }
    });
    let accSpeed = values.initialAccSpeed;
    const enemy = {
        _titleMagVel: magVel,
        _spawnBoost: values.spawnBoost,
        _spawnBoostDecayRate: values.spawnBoostDecayRate,
        _titleBaseSpeed: { x: values.baseX, y: values.baseY },
        _titleBurstVel: { x: values.burstX, y: values.burstY },
        _titleBurstDecayRate: values.burstDecayRate,
        _titleAccelResponse: values.accelResponse,
        _titleParallaxMotionScale: values.parallaxScale,
        _setAccCalls: setAccCalls
    };
    Object.defineProperties(enemy, {
        speed: {
            configurable: true,
            get() {
                const label = `speed.get.${speedReadCount++}`;
                mark(label);
                return speed;
            }
        },
        setAcc: {
            configurable: true,
            get() {
                mark('setAcc.get');
                return function setAcc(x, y) {
                    mark('setAcc.call');
                    assert.strictEqual(this, enemy, 'setAcc this 바인딩이 달라졌습니다.');
                    setAccCalls.push([x, y]);
                };
            }
        },
        accSpeed: {
            configurable: true,
            get: () => accSpeed,
            set(value) {
                mark('accSpeed.set');
                accSpeed = value;
            }
        }
    });
    return {
        enemy,
        trace,
        sentinel,
        snapshot() {
            return {
                mag: [magX, magY],
                accSpeed,
                setAccCalls,
                spawnBoost: enemy._spawnBoost,
                spawnBoostDecayRate: enemy._spawnBoostDecayRate
            };
        }
    };
}

test('setAcc/speed getter·예외·부분 변경 순서가 legacy와 같다', async () => {
    let candidateScenario;
    let legacyScenario;
    const candidateRuntime = await loadTitleAIRuntime(scalarCandidateSource, {
        identifier: 'candidate-observed-order',
        applyMagneticPoint() {
            candidateScenario.trace.push('applyMagneticPoint');
        }
    });
    const legacyRuntime = await loadTitleAIRuntime(legacySource, {
        identifier: 'legacy-observed-order',
        applyMagneticPoint() {
            legacyScenario.trace.push('applyMagneticPoint');
        }
    });
    const failPoints = [
        null,
        'setAcc.get',
        'speed.get.0',
        'speed.x.get',
        'speed.get.1',
        'speed.y.get',
        'setAcc.call'
    ];
    const successTrace = [
        'applyMagneticPoint',
        'setAcc.get',
        'speed.get.0',
        'speed.x.get',
        'speed.get.1',
        'speed.y.get',
        'setAcc.call',
        'accSpeed.set',
        'mag.x.set',
        'mag.y.set'
    ];

    for (const failAt of failPoints) {
        candidateScenario = createObservedScenario(failAt);
        legacyScenario = createObservedScenario(failAt);
        const label = failAt ?? 'success';
        const actual = capture(() => candidateRuntime.titleAI.fixedUpdate(
            candidateScenario.enemy,
            1 / 60,
            defaultContext
        ));
        const expected = capture(() => legacyRuntime.titleAI.fixedUpdate(
            legacyScenario.enemy,
            1 / 60,
            defaultContext
        ));
        assertSameOutcome(actual, expected, label);
        if (failAt !== null) {
            assert.strictEqual(actual.error, candidateScenario.sentinel, `${label}: candidate sentinel`);
            assert.strictEqual(expected.error, legacyScenario.sentinel, `${label}: legacy sentinel`);
        }
        assert.deepEqual(candidateScenario.trace, legacyScenario.trace, `${label}: trace`);
        assertExactValue(
            candidateScenario.snapshot(),
            legacyScenario.snapshot(),
            `${label}: partial state`
        );
        if (failAt === null) assert.deepEqual(candidateScenario.trace, successTrace);
    }

    const speedXFailure = createObservedScenario('speed.x.get');
    candidateScenario = speedXFailure;
    const failed = capture(() => candidateRuntime.titleAI.fixedUpdate(
        speedXFailure.enemy,
        1 / 60,
        defaultContext
    ));
    assert.strictEqual(failed.error, speedXFailure.sentinel);
    assert.deepEqual(speedXFailure.trace, [
        'applyMagneticPoint',
        'setAcc.get',
        'speed.get.0',
        'speed.x.get'
    ]);
});

/**
 * speed.x getter에서 같은 모듈의 fixedUpdate를 재진입시키는 시나리오를 실행합니다.
 * @param {object} runtime - 후보 또는 legacy namespace입니다.
 * @returns {object} 호출 기록과 최종 상태입니다.
 */
function runReentrantScenario(runtime) {
    const trace = [];
    let phase = 'outer';
    let entered = false;
    const inner = createEnemy({
        ...ordinaryValues,
        spawnBoost: 2,
        speedX: -7,
        speedY: 9
    }, trace);
    const outer = createEnemy(ordinaryValues, trace);
    const speed = {};
    Object.defineProperties(speed, {
        x: {
            get() {
                trace.push(`${phase}.speed.x.get`);
                if (!entered) {
                    entered = true;
                    trace.push('inner.begin');
                    phase = 'inner';
                    try {
                        runtime.titleAI.fixedUpdate(inner, 1 / 120, defaultContext);
                    } finally {
                        phase = 'outer';
                        trace.push('inner.end');
                    }
                }
                return ordinaryValues.speedX;
            }
        },
        y: {
            get() {
                trace.push(`${phase}.speed.y.get`);
                return ordinaryValues.speedY;
            }
        }
    });
    Object.defineProperty(outer, 'speed', {
        configurable: true,
        get() {
            trace.push(`${phase}.speed.get`);
            return speed;
        }
    });
    const originalOuterSetAcc = outer.setAcc;
    outer.setAcc = function setOuterAcc(x, y) {
        trace.push(`${phase}.outer.setAcc`);
        originalOuterSetAcc.call(this, x, y);
    };
    const originalInnerSetAcc = inner.setAcc;
    inner.setAcc = function setInnerAcc(x, y) {
        trace.push(`${phase}.inner.setAcc`);
        originalInnerSetAcc.call(this, x, y);
    };

    const captured = capture(() => runtime.titleAI.fixedUpdate(
        outer,
        1 / 60,
        defaultContext
    ));
    return {
        captured,
        trace,
        outer: snapshotEnemy(outer),
        inner: snapshotEnemy(inner)
    };
}

test('speed.x getter 재진입에서도 외부/내부 fixedUpdate 상태가 섞이지 않는다', async () => {
    const candidateRuntime = await loadTitleAIRuntime(scalarCandidateSource, {
        identifier: 'candidate-reentrant'
    });
    const legacyRuntime = await loadTitleAIRuntime(legacySource, {
        identifier: 'legacy-reentrant'
    });
    const actual = runReentrantScenario(candidateRuntime);
    const expected = runReentrantScenario(legacyRuntime);
    assertSameOutcome(actual.captured, expected.captured, 'reentrant outcome');
    assertExactValue(actual.trace, expected.trace, 'reentrant trace');
    assertExactValue(actual.outer, expected.outer, 'reentrant outer');
    assertExactValue(actual.inner, expected.inner, 'reentrant inner');
    const innerBeginIndex = actual.trace.indexOf('inner.begin');
    const innerEndIndex = actual.trace.indexOf('inner.end');
    const outerYIndex = actual.trace.indexOf('outer.speed.y.get');
    assert.ok(innerBeginIndex >= 0 && innerEndIndex > innerBeginIndex);
    assert.ok(outerYIndex > innerEndIndex, '외부 Y 속도 조회는 내부 재진입 완료 뒤여야 합니다.');
});

test('production 소스는 per-tick 속도 객체 없이 두 scalar를 setAcc 전에 계산한다', () => {
    assert.equal(
        titleAISource.split(SCALAR_HELPER).length - 1,
        1,
        'scalar scale helper가 production에 정확히 한 번 있어야 합니다.'
    );
    assert.equal(
        titleAISource.split(SCALAR_FIXED_UPDATE_BLOCK).length - 1,
        1,
        'scalar fixedUpdate 블록이 production에 정확히 한 번 있어야 합니다.'
    );
    assert.doesNotMatch(titleAISource, /\beaseOutExpoVelocityToMaxSpeed\b/);
    assert.doesNotMatch(titleAISource, /\bclampedTargetVelocity\b/);
    assert.doesNotMatch(
        titleAISource,
        /return\s*\{\s*x:\s*vx(?:\s*\*\s*scale)?\s*,\s*y:\s*vy(?:\s*\*\s*scale)?\s*\}/,
        '속도 helper가 프레임마다 결과 객체를 만들면 안 됩니다.'
    );

    const scaleIndex = titleAISource.indexOf(
        'const targetVelocityScale = getEaseOutExpoVelocityScale('
    );
    const xIndex = titleAISource.indexOf(
        'const clampedTargetVx = unclampedTargetVx * targetVelocityScale;'
    );
    const yIndex = titleAISource.indexOf(
        'const clampedTargetVy = unclampedTargetVy * targetVelocityScale;'
    );
    const setAccIndex = titleAISource.indexOf('enemy.setAcc(', yIndex);
    const speedXIndex = titleAISource.indexOf('enemy.speed.x', setAccIndex);
    const speedYIndex = titleAISource.indexOf('enemy.speed.y', speedXIndex);
    assert.ok(scaleIndex >= 0, 'scale 계산이 있어야 합니다.');
    assert.ok(scaleIndex < xIndex, 'scale 다음에 X scalar를 계산해야 합니다.');
    assert.ok(xIndex < yIndex, 'X scalar 다음에 Y scalar를 계산해야 합니다.');
    assert.ok(yIndex < setAccIndex, '두 scalar는 setAcc member 조회 전에 계산되어야 합니다.');
    assert.ok(setAccIndex < speedXIndex, 'setAcc member 조회가 speed.x보다 먼저여야 합니다.');
    assert.ok(speedXIndex < speedYIndex, 'speed.x는 speed.y보다 먼저 조회해야 합니다.');
});
