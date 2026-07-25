import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const { cullLocalGameSceneProjectiles } = await loadGameModule(
    'scene/game/update/game_scene_update_helpers.js'
);

const PROJECTILE_CULL_MARGIN_RATIO = 0.2;
const RAW_FLOAT_CASE_COUNT = 50_000;
const MASK_64 = (1n << 64n) - 1n;
const floatView = new DataView(new ArrayBuffer(8));

/**
 * 변경 전 프레임마다 경계 객체를 만들던 구현을 독립 오라클로 재현합니다.
 * @param {object|null|undefined} scene - 게임 씬 대역입니다.
 */
function cullLocalGameSceneProjectilesLegacy(scene) {
    if (!scene || !Array.isArray(scene.projectiles)) {
        return;
    }

    const bounds = {
        minX: -scene.WW * PROJECTILE_CULL_MARGIN_RATIO,
        maxX: scene.WW * (1 + PROJECTILE_CULL_MARGIN_RATIO),
        minY: -scene.objectWH * PROJECTILE_CULL_MARGIN_RATIO,
        maxY: scene.objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO)
    };
    for (let i = scene.projectiles.length - 1; i >= 0; i--) {
        const projectile = scene.projectiles[i];
        let shouldCull = false;
        if (!projectile || projectile.active === false || !projectile.position) {
            shouldCull = true;
        } else {
            const x = projectile.position.x;
            const y = projectile.position.y;
            shouldCull = x < bounds.minX
                || x > bounds.maxX
                || y < bounds.minY
                || y > bounds.maxY;
        }
        if (shouldCull) {
            scene.projectiles.splice(i, 1);
        }
    }
}

/**
 * 결정적 xorshift64 상태를 다음 값으로 전진시킵니다.
 * @param {bigint} state - 현재 64비트 상태입니다.
 * @returns {bigint} 다음 64비트 상태입니다.
 */
function nextRandomBits(state) {
    let next = state & MASK_64;
    next ^= (next << 13n) & MASK_64;
    next ^= next >> 7n;
    next ^= (next << 17n) & MASK_64;
    return next & MASK_64;
}

/**
 * 임의의 64비트 패턴을 IEEE-754 배정밀도 숫자로 해석합니다.
 * @param {bigint} bits - 원시 64비트 패턴입니다.
 * @returns {number} 해석된 숫자입니다.
 */
function floatFromBits(bits) {
    floatView.setBigUint64(0, bits & MASK_64, false);
    return floatView.getFloat64(0, false);
}

/**
 * 주어진 숫자 바로 다음의 표현 가능한 IEEE-754 배정밀도 값을 반환합니다.
 * @param {number} value - 기준 값입니다.
 * @returns {number} 다음 표현 가능 값입니다.
 */
function nextUp(value) {
    if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
    if (Object.is(value, -0) || value === 0) return Number.MIN_VALUE;
    floatView.setFloat64(0, value, false);
    const bits = floatView.getBigUint64(0, false);
    floatView.setBigUint64(0, value > 0 ? bits + 1n : bits - 1n, false);
    return floatView.getFloat64(0, false);
}

/**
 * 주어진 숫자 바로 이전의 표현 가능한 IEEE-754 배정밀도 값을 반환합니다.
 * @param {number} value - 기준 값입니다.
 * @returns {number} 이전 표현 가능 값입니다.
 */
function nextDown(value) {
    if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return value;
    if (Object.is(value, -0) || value === 0) return -Number.MIN_VALUE;
    floatView.setFloat64(0, value, false);
    const bits = floatView.getBigUint64(0, false);
    floatView.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n, false);
    return floatView.getFloat64(0, false);
}

/**
 * 비교 결과에 사용할 안정적인 값 설명을 반환합니다.
 * @param {unknown} value - 설명할 값입니다.
 * @returns {string} 값 설명입니다.
 */
function describeValue(value) {
    if (value && typeof value === 'object' && typeof value.tag === 'string') {
        return value.tag;
    }
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'number:NaN';
        if (Object.is(value, -0)) return 'number:-0';
    }
    return `${typeof value}:${String(value)}`;
}

/**
 * 투사체 대역을 생성합니다.
 * @param {string} tag - 비교용 식별자입니다.
 * @param {number} x - X 좌표입니다.
 * @param {number} y - Y 좌표입니다.
 * @param {boolean} [active=true] - 활성 상태입니다.
 * @returns {object} 투사체 대역입니다.
 */
function createProjectile(tag, x, y, active = true) {
    return { tag, active, position: { x, y } };
}

/**
 * 함수 실행 결과와 예외를 비교 가능한 형태로 캡처합니다.
 * @param {Function} cull - 실행할 컬링 함수입니다.
 * @param {object|null|undefined} scene - 게임 씬 대역입니다.
 * @returns {{returned:unknown, error:null|{name:string,message:string}}} 실행 결과입니다.
 */
function captureCull(cull, scene) {
    try {
        return { returned: cull(scene), error: null };
    } catch (error) {
        return {
            returned: undefined,
            error: { name: error?.name || '', message: error?.message || '' }
        };
    }
}

/**
 * 두 실행 결과가 부호 있는 0까지 동일한지 확인합니다.
 * @param {object} actual - 후보 실행 결과입니다.
 * @param {object} expected - legacy 실행 결과입니다.
 * @param {string} label - 케이스 이름입니다.
 */
function assertCapturedCullEqual(actual, expected, label) {
    assert.ok(Object.is(actual.returned, expected.returned), `${label}: 반환값 차이`);
    assert.deepEqual(actual.error, expected.error, `${label}: 예외 차이`);
}

for (const [label, scene] of [
    ['undefined', undefined],
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty-string', ''],
    ['missing-projectiles', {}],
    ['null-projectiles', { projectiles: null }],
    ['object-projectiles', { projectiles: {} }],
    ['typed-projectiles', { projectiles: new Float64Array(2) }]
]) {
    assertCapturedCullEqual(
        captureCull(cullLocalGameSceneProjectiles, scene),
        captureCull(cullLocalGameSceneProjectilesLegacy, scene),
        `invalid-scene:${label}`
    );
}

const TEST_WW = 100;
const TEST_OBJECT_WH = 60;
const minX = -TEST_WW * PROJECTILE_CULL_MARGIN_RATIO;
const maxX = TEST_WW * (1 + PROJECTILE_CULL_MARGIN_RATIO);
const minY = -TEST_OBJECT_WH * PROJECTILE_CULL_MARGIN_RATIO;
const maxY = TEST_OBJECT_WH * (1 + PROJECTILE_CULL_MARGIN_RATIO);

/**
 * 명시적 경계/무효 투사체 케이스를 새 배열로 구성합니다.
 * @returns {unknown[]} 투사체 목록입니다.
 */
function createExplicitProjectiles() {
    return [
        createProjectile('center', 0, 0),
        createProjectile('min-x', minX, 0),
        createProjectile('max-x', maxX, 0),
        createProjectile('min-y', 0, minY),
        createProjectile('max-y', 0, maxY),
        createProjectile('below-min-x', nextDown(minX), 0),
        createProjectile('above-max-x', nextUp(maxX), 0),
        createProjectile('below-min-y', 0, nextDown(minY)),
        createProjectile('above-max-y', 0, nextUp(maxY)),
        createProjectile('nan-x', Number.NaN, 0),
        createProjectile('nan-y', 0, Number.NaN),
        createProjectile('negative-infinity-x', Number.NEGATIVE_INFINITY, 0),
        createProjectile('positive-infinity-x', Number.POSITIVE_INFINITY, 0),
        createProjectile('negative-zero', -0, -0),
        createProjectile('inactive', 0, 0, false),
        createProjectile('active-zero', 0, 0, 0),
        createProjectile('active-null', 0, 0, null),
        { tag: 'active-undefined', active: undefined, position: { x: 0, y: 0 } },
        { tag: 'missing-position', active: true },
        { tag: 'null-position', active: true, position: null },
        { tag: 'number-position', active: true, position: 1 },
        { tag: 'string-position', active: true, position: 'position' },
        { tag: 'symbol-position', active: true, position: Symbol('position') },
        { tag: 'bigint-position', active: true, position: 1n },
        null,
        undefined,
        false,
        0,
        '',
        1,
        true,
        Symbol('projectile'),
        1n
    ];
}

const legacyExplicit = createExplicitProjectiles();
const candidateExplicit = createExplicitProjectiles();
const legacyExplicitScene = { WW: TEST_WW, objectWH: TEST_OBJECT_WH, projectiles: legacyExplicit };
const candidateExplicitScene = {
    WW: TEST_WW,
    objectWH: TEST_OBJECT_WH,
    projectiles: candidateExplicit
};
assertCapturedCullEqual(
    captureCull(cullLocalGameSceneProjectiles, candidateExplicitScene),
    captureCull(cullLocalGameSceneProjectilesLegacy, legacyExplicitScene),
    'explicit-boundaries'
);
assert.deepEqual(
    candidateExplicit.map(describeValue),
    legacyExplicit.map(describeValue),
    '경계·무효·비유한 투사체의 생존 목록이 달라졌습니다.'
);
assert.deepEqual(candidateExplicit.map(describeValue), [
    'center',
    'min-x',
    'max-x',
    'min-y',
    'max-y',
    'nan-x',
    'nan-y',
    'negative-zero',
    'active-zero',
    'active-null',
    'active-undefined',
    'number-position',
    'string-position',
    'symbol-position',
    'bigint-position'
]);

let randomState = 0xA0761D6478BD642Fn;
for (let index = 0; index < RAW_FLOAT_CASE_COUNT; index++) {
    randomState = nextRandomBits(randomState);
    const ww = floatFromBits(randomState);
    randomState = nextRandomBits(randomState);
    const objectWH = floatFromBits(randomState);
    randomState = nextRandomBits(randomState);
    const x = floatFromBits(randomState);
    randomState = nextRandomBits(randomState);
    const y = floatFromBits(randomState);

    const legacyProjectiles = [createProjectile('raw', x, y)];
    const candidateProjectiles = [createProjectile('raw', x, y)];
    cullLocalGameSceneProjectilesLegacy({
        WW: ww,
        objectWH,
        projectiles: legacyProjectiles
    });
    cullLocalGameSceneProjectiles({
        WW: ww,
        objectWH,
        projectiles: candidateProjectiles
    });
    assert.equal(
        candidateProjectiles.length,
        legacyProjectiles.length,
        `raw-float[${index}]: ww=${String(ww)}, objectWH=${String(objectWH)}, `
            + `x=${String(x)}, y=${String(y)}`
    );
}

/**
 * getter/Proxy 평가 순서와 횟수를 검증할 대역을 생성합니다.
 * @returns {{scene:object, trace:string[], target:unknown[]}} 테스트 대역입니다.
 */
function createTraceFixture() {
    const trace = [];
    let wwRead = 0;
    let objectWHRead = 0;

    function createTracedProjectile(tag, coordinateSets, active = true) {
        let positionRead = 0;
        const projectile = { tag };
        Object.defineProperty(projectile, 'active', {
            get() {
                trace.push(`${tag}.active`);
                return active;
            }
        });
        Object.defineProperty(projectile, 'position', {
            get() {
                const readIndex = positionRead++;
                trace.push(`${tag}.position:${readIndex}`);
                const coordinates = coordinateSets[Math.min(readIndex, coordinateSets.length - 1)];
                return {
                    get x() {
                        trace.push(`${tag}.x:${readIndex}`);
                        return coordinates.x;
                    },
                    get y() {
                        trace.push(`${tag}.y:${readIndex}`);
                        return coordinates.y;
                    }
                };
            }
        });
        return projectile;
    }

    const target = [
        createTracedProjectile('keep', [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]),
        createTracedProjectile('outside', [
            { x: 1, y: 2 },
            { x: Number.POSITIVE_INFINITY, y: 4 },
            { x: 5, y: 6 }
        ]),
        createTracedProjectile('inactive', [{ x: 0, y: 0 }], false),
        null
    ];
    const projectiles = new Proxy(target, {
        get(array, property, receiver) {
            trace.push(`array.get:${String(property)}`);
            return Reflect.get(array, property, receiver);
        },
        set(array, property, value, receiver) {
            trace.push(`array.set:${String(property)}:${describeValue(value)}`);
            return Reflect.set(array, property, value, receiver);
        },
        deleteProperty(array, property) {
            trace.push(`array.delete:${String(property)}`);
            return Reflect.deleteProperty(array, property);
        }
    });
    const scene = {
        get projectiles() {
            trace.push('scene.projectiles');
            return projectiles;
        },
        get WW() {
            trace.push(`scene.WW:${wwRead}`);
            return [100, 105][Math.min(wwRead++, 1)];
        },
        get objectWH() {
            trace.push(`scene.objectWH:${objectWHRead}`);
            return [60, 65][Math.min(objectWHRead++, 1)];
        }
    };
    return { scene, trace, target };
}

const legacyTraceFixture = createTraceFixture();
const candidateTraceFixture = createTraceFixture();
cullLocalGameSceneProjectilesLegacy(legacyTraceFixture.scene);
cullLocalGameSceneProjectiles(candidateTraceFixture.scene);
assert.deepEqual(candidateTraceFixture.trace, legacyTraceFixture.trace, 'getter/Proxy trace가 다릅니다.');
assert.deepEqual(
    candidateTraceFixture.target.map(describeValue),
    legacyTraceFixture.target.map(describeValue),
    'getter/Proxy 생존 목록이 다릅니다.'
);
assert.deepEqual(candidateTraceFixture.target.map(describeValue), ['keep']);
assert.deepEqual(candidateTraceFixture.trace.slice(0, 6), [
    'scene.projectiles',
    'scene.WW:0',
    'scene.WW:1',
    'scene.objectWH:0',
    'scene.objectWH:1',
    'scene.projectiles'
]);
assert.equal(
    candidateTraceFixture.trace.filter((entry) => entry === 'scene.projectiles').length,
    9,
    'projectiles getter는 2 + 원래 길이 4 + 제거 3회만큼 읽혀야 합니다.'
);
assert.equal(
    candidateTraceFixture.trace.filter((entry) => entry.startsWith('keep.position:')).length,
    3,
    '유효 투사체 position getter는 정확히 세 번 읽혀야 합니다.'
);
assert.equal(
    candidateTraceFixture.trace.filter((entry) => entry.startsWith('outside.position:')).length,
    3,
    '제거되는 유효 투사체도 position getter는 정확히 세 번 읽혀야 합니다.'
);

/**
 * 호출마다 다른 배열을 반환하는 scene.projectiles getter 대역을 생성합니다.
 * @returns {{scene:object, trace:string[], arrays:unknown[][]}} 테스트 대역입니다.
 */
function createVolatileArrayFixture() {
    const trace = [];
    const arrays = [
        [createProjectile('guard', 0, 0)],
        [createProjectile('length', 0, 0)],
        [createProjectile('item', Number.POSITIVE_INFINITY, 0)],
        [createProjectile('splice-target', 0, 0)]
    ];
    arrays[3].splice = function tracedSplice(...args) {
        trace.push(`custom-splice:${args.join(':')}`);
        return Array.prototype.splice.apply(this, args);
    };
    let projectilesRead = 0;
    const scene = {
        WW: 100,
        objectWH: 60,
        get projectiles() {
            const readIndex = projectilesRead++;
            trace.push(`projectiles:${readIndex}`);
            return arrays[Math.min(readIndex, arrays.length - 1)];
        }
    };
    return { scene, trace, arrays };
}

const legacyVolatileFixture = createVolatileArrayFixture();
const candidateVolatileFixture = createVolatileArrayFixture();
cullLocalGameSceneProjectilesLegacy(legacyVolatileFixture.scene);
cullLocalGameSceneProjectiles(candidateVolatileFixture.scene);
assert.deepEqual(candidateVolatileFixture.trace, legacyVolatileFixture.trace);
assert.deepEqual(candidateVolatileFixture.trace, [
    'projectiles:0',
    'projectiles:1',
    'projectiles:2',
    'projectiles:3',
    'custom-splice:0:1'
]);
assert.deepEqual(
    candidateVolatileFixture.arrays.map((array) => array.map(describeValue)),
    legacyVolatileFixture.arrays.map((array) => array.map(describeValue))
);

/**
 * 중간 getter·숫자 coercion·splice 예외의 발생 지점과 순서를 검증합니다.
 * @param {Function} cull - 실행할 컬링 함수입니다.
 * @param {string} kind - 예외 대역 종류입니다.
 * @returns {object} 비교 가능한 실행 결과입니다.
 */
function runExceptionalFixture(cull, kind) {
    const trace = [];
    let projectiles = [];
    let scene = { WW: 100, objectWH: 60, projectiles };

    if (kind === 'projectiles-getter') {
        scene = {
            get projectiles() {
                trace.push('projectiles');
                throw new ReferenceError('projectiles getter sentinel');
            }
        };
    } else if (kind === 'ww-second-coercion' || kind === 'object-wh-second-coercion') {
        let wwCoercionCount = 0;
        let objectWHCoercionCount = 0;
        const wwToken = {
            [Symbol.toPrimitive](hint) {
                const readIndex = wwCoercionCount++;
                trace.push(`WW.toPrimitive:${hint}:${readIndex}`);
                if (kind === 'ww-second-coercion' && readIndex === 1) {
                    throw new TypeError('WW coercion sentinel');
                }
                return 100;
            }
        };
        const objectWHToken = {
            [Symbol.toPrimitive](hint) {
                const readIndex = objectWHCoercionCount++;
                trace.push(`objectWH.toPrimitive:${hint}:${readIndex}`);
                if (kind === 'object-wh-second-coercion' && readIndex === 1) {
                    throw new TypeError('objectWH coercion sentinel');
                }
                return 60;
            }
        };
        scene = {
            projectiles,
            get WW() {
                trace.push('WW.get');
                return wwToken;
            },
            get objectWH() {
                trace.push('objectWH.get');
                return objectWHToken;
            }
        };
    } else if (kind === 'ww-symbol' || kind === 'ww-bigint' || kind === 'object-wh-symbol') {
        scene = {
            projectiles,
            get WW() {
                trace.push('WW');
                if (kind === 'ww-symbol') return Symbol('WW');
                if (kind === 'ww-bigint') return 1n;
                return 100;
            },
            get objectWH() {
                trace.push('objectWH');
                return kind === 'object-wh-symbol' ? Symbol('objectWH') : 60;
            }
        };
    } else if (kind === 'active-getter') {
        const projectile = { tag: kind, position: { x: 0, y: 0 } };
        Object.defineProperty(projectile, 'active', {
            get() {
                trace.push('active');
                throw new RangeError('active getter sentinel');
            }
        });
        projectiles = [projectile];
        scene.projectiles = projectiles;
    } else if (kind.startsWith('position-')) {
        const throwAt = Number(kind.slice('position-'.length));
        let positionRead = 0;
        const projectile = { tag: kind, active: true };
        Object.defineProperty(projectile, 'position', {
            get() {
                const readIndex = positionRead++;
                trace.push(`position:${readIndex}`);
                if (readIndex === throwAt) {
                    throw new URIError(`position ${throwAt} sentinel`);
                }
                return { x: 0, y: 0 };
            }
        });
        projectiles = [projectile];
        scene.projectiles = projectiles;
    } else if (kind === 'x-getter' || kind === 'y-getter') {
        const position = {};
        Object.defineProperties(position, {
            x: {
                get() {
                    trace.push('x');
                    if (kind === 'x-getter') throw new EvalError('x getter sentinel');
                    return 0;
                }
            },
            y: {
                get() {
                    trace.push('y');
                    if (kind === 'y-getter') throw new EvalError('y getter sentinel');
                    return 0;
                }
            }
        });
        projectiles = [{ tag: kind, active: true, position }];
        scene.projectiles = projectiles;
    } else if (kind === 'splice' || kind === 'splice-null') {
        projectiles = [createProjectile('outside', Number.POSITIVE_INFINITY, 0)];
        projectiles.splice = kind === 'splice-null'
            ? null
            : (...args) => {
                trace.push(`splice:${args.join(':')}`);
                throw new SyntaxError('splice sentinel');
            };
        scene.projectiles = projectiles;
    } else {
        throw new Error(`알 수 없는 예외 대역입니다: ${kind}`);
    }

    return {
        captured: captureCull(cull, scene),
        trace,
        values: Array.from(projectiles, describeValue),
        length: projectiles.length
    };
}

for (const kind of [
    'projectiles-getter',
    'ww-second-coercion',
    'object-wh-second-coercion',
    'ww-symbol',
    'ww-bigint',
    'object-wh-symbol',
    'active-getter',
    'position-0',
    'position-1',
    'position-2',
    'x-getter',
    'y-getter',
    'splice',
    'splice-null'
]) {
    const expected = runExceptionalFixture(cullLocalGameSceneProjectilesLegacy, kind);
    const actual = runExceptionalFixture(cullLocalGameSceneProjectiles, kind);
    assert.deepEqual(actual, expected, `exception:${kind}`);
}

/**
 * 취소된 배열 Proxy의 IsArray 예외 계약을 실행합니다.
 * @param {Function} cull - 실행할 컬링 함수입니다.
 * @returns {object} 캡처한 예외 결과입니다.
 */
function runRevokedProxyFixture(cull) {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    return captureCull(cull, { projectiles: proxy });
}

assert.deepEqual(
    runRevokedProxyFixture(cullLocalGameSceneProjectiles),
    runRevokedProxyFixture(cullLocalGameSceneProjectilesLegacy),
    '취소된 Proxy의 Array.isArray 예외가 달라졌습니다.'
);

/**
 * splice의 Array species 관찰 순서를 실행합니다.
 * @param {Function} cull - 실행할 컬링 함수입니다.
 * @returns {object} 비교 가능한 실행 결과입니다.
 */
function runArraySpeciesFixture(cull) {
    const trace = [];
    const projectiles = [createProjectile('outside', Number.POSITIVE_INFINITY, 0)];
    function RemovedProjectileList(length) {
        trace.push(`removed-constructor:${length}`);
        this.length = length;
    }
    const constructorRecord = {};
    Object.defineProperty(constructorRecord, Symbol.species, {
        get() {
            trace.push('species');
            return RemovedProjectileList;
        }
    });
    Object.defineProperty(projectiles, 'constructor', { value: constructorRecord });

    const captured = captureCull(cull, { WW: 100, objectWH: 60, projectiles });
    return {
        captured,
        trace,
        values: Array.from(projectiles, describeValue),
        length: projectiles.length
    };
}

const legacySpecies = runArraySpeciesFixture(cullLocalGameSceneProjectilesLegacy);
const candidateSpecies = runArraySpeciesFixture(cullLocalGameSceneProjectiles);
assert.deepEqual(candidateSpecies, legacySpecies, 'Array Symbol.species 관찰 순서가 다릅니다.');
assert.deepEqual(candidateSpecies.trace, ['species', 'removed-constructor:1']);

/**
 * 배열 형태별 컬링 결과와 예외 계약을 실행합니다.
 * @param {Function} cull - 실행할 컬링 함수입니다.
 * @param {string} kind - 배열 대역 종류입니다.
 * @returns {object} 비교 가능한 결과입니다.
 */
function runArrayShapeFixture(cull, kind) {
    const trace = [];
    let projectiles;
    let snapshotSource;
    if (kind === 'sparse') {
        projectiles = new Array(5);
        projectiles[1] = createProjectile('keep', 0, 0);
        projectiles[4] = createProjectile('outside', Number.POSITIVE_INFINITY, 0);
    } else if (kind === 'frozen') {
        projectiles = Object.freeze([null]);
    } else if (kind === 'sealed') {
        projectiles = Object.seal([null]);
    } else if (kind === 'prevent-extensions') {
        projectiles = Object.preventExtensions([null]);
    } else if (kind === 'subclass') {
        class ProjectileList extends Array {
            splice(...args) {
                trace.push(`subclass-splice:${args.join(':')}`);
                return super.splice(...args);
            }
        }
        projectiles = new ProjectileList(
            createProjectile('keep', 0, 0),
            createProjectile('outside', Number.POSITIVE_INFINITY, 0)
        );
    } else if (kind === 'inherited-index') {
        class InheritedProjectileList extends Array {}
        InheritedProjectileList.prototype[0] = createProjectile('inherited-keep', 0, 0);
        projectiles = new InheritedProjectileList(1);
    } else if (kind === 'proxy-partial-throw') {
        const target = [
            createProjectile('outside-first', Number.POSITIVE_INFINITY, 0),
            createProjectile('outside-second', Number.POSITIVE_INFINITY, 0),
            createProjectile('keep-last', 0, 0)
        ];
        snapshotSource = target;
        projectiles = new Proxy(target, {
            set(array, property, value, receiver) {
                trace.push(`proxy-set:${String(property)}:${describeValue(value)}`);
                return Reflect.set(array, property, value, receiver);
            },
            deleteProperty(array, property) {
                trace.push(`proxy-delete:${String(property)}`);
                if (property === '2') {
                    throw new TypeError('proxy partial delete sentinel');
                }
                return Reflect.deleteProperty(array, property);
            }
        });
    } else {
        throw new Error(`알 수 없는 배열 대역입니다: ${kind}`);
    }

    snapshotSource ||= projectiles;

    const alias = projectiles;
    const scene = {
        WW: 100,
        objectWH: 60,
        projectiles,
        objectSystem: { projectiles }
    };
    const captured = captureCull(cull, scene);
    return {
        captured,
        trace,
        values: Array.from(snapshotSource, describeValue),
        length: snapshotSource.length,
        sceneAliasPreserved: scene.projectiles === alias,
        objectSystemAliasPreserved: scene.objectSystem.projectiles === scene.projectiles
    };
}

for (const kind of [
    'sparse',
    'frozen',
    'sealed',
    'prevent-extensions',
    'subclass',
    'inherited-index',
    'proxy-partial-throw'
]) {
    const expected = runArrayShapeFixture(cullLocalGameSceneProjectilesLegacy, kind);
    const actual = runArrayShapeFixture(cullLocalGameSceneProjectiles, kind);
    assert.deepEqual(actual, expected, `array-shape:${kind}`);
}

/**
 * 경계 getter에서 내부 컬링을 재진입시키는 대역을 생성합니다.
 * @param {Function} cull - 내부에서도 사용할 컬링 함수입니다.
 * @returns {{scene:object, trace:string[], inner:unknown[], outer:unknown[]}} 테스트 대역입니다.
 */
function createReentrantFixture(cull) {
    const trace = [];
    const inner = [null, createProjectile('inner-keep', 0, 0)];
    const outer = [createProjectile('outer-keep', 0, 0)];
    const innerScene = { WW: 50, objectWH: 30, projectiles: inner };
    let entered = false;
    const scene = {
        projectiles: outer,
        get WW() {
            trace.push(`outer.WW:${entered}`);
            if (!entered) {
                entered = true;
                trace.push('inner.begin');
                cull(innerScene);
                trace.push('inner.end');
            }
            return 100;
        },
        get objectWH() {
            trace.push('outer.objectWH');
            return 60;
        }
    };
    return { scene, trace, inner, outer };
}

const legacyReentrant = createReentrantFixture(cullLocalGameSceneProjectilesLegacy);
const candidateReentrant = createReentrantFixture(cullLocalGameSceneProjectiles);
cullLocalGameSceneProjectilesLegacy(legacyReentrant.scene);
cullLocalGameSceneProjectiles(candidateReentrant.scene);
assert.deepEqual(candidateReentrant.trace, legacyReentrant.trace, '재진입 getter 순서가 다릅니다.');
assert.deepEqual(
    candidateReentrant.inner.map(describeValue),
    legacyReentrant.inner.map(describeValue),
    '재진입 내부 배열 결과가 다릅니다.'
);
assert.deepEqual(
    candidateReentrant.outer.map(describeValue),
    legacyReentrant.outer.map(describeValue),
    '재진입 외부 배열 결과가 다릅니다.'
);

const helperPath = fileURLToPath(new URL(
    '../script/module/scene/game/update/game_scene_update_helpers.js',
    import.meta.url
));
const helperSource = await readFile(helperPath, 'utf8');
assert.doesNotMatch(
    helperSource,
    /\bcreateProjectileCullBounds\b/,
    '가변 프레임 컬링 경계 객체 생성 helper가 다시 생기면 안 됩니다.'
);
assert.doesNotMatch(
    helperSource,
    /\b(?:const|let|var)\s+(?:bounds|cullBounds)\s*=\s*\{/,
    '컬링 경계는 다른 이름의 임시 객체로 다시 할당하면 안 됩니다.'
);
assert.match(
    helperSource,
    /const\s+minX\s*=\s*-scene\.WW\s*\*\s*PROJECTILE_CULL_MARGIN_RATIO\s*;/,
    'minX는 기존 평가식과 순서를 유지하는 스칼라 지역값이어야 합니다.'
);
assert.match(
    helperSource,
    /const\s+maxX\s*=\s*scene\.WW\s*\*\s*\(1\s*\+\s*PROJECTILE_CULL_MARGIN_RATIO\)\s*;/,
    'maxX는 기존 평가식과 순서를 유지하는 스칼라 지역값이어야 합니다.'
);
assert.match(
    helperSource,
    /const\s+minY\s*=\s*-scene\.objectWH\s*\*\s*PROJECTILE_CULL_MARGIN_RATIO\s*;/,
    'minY는 기존 평가식과 순서를 유지하는 스칼라 지역값이어야 합니다.'
);
assert.match(
    helperSource,
    /const\s+maxY\s*=\s*scene\.objectWH\s*\*\s*\(1\s*\+\s*PROJECTILE_CULL_MARGIN_RATIO\)\s*;/,
    'maxY는 기존 평가식과 순서를 유지하는 스칼라 지역값이어야 합니다.'
);
assert.match(
    helperSource,
    /shouldCullLocalProjectile\(scene\.projectiles\[i\],\s*minX,\s*maxX,\s*minY,\s*maxY\)/,
    '투사체 판정은 네 스칼라 경계를 직접 전달해야 합니다.'
);
assert.doesNotMatch(
    helperSource,
    /scene\.projectiles\s*=|\.filter\s*\(/,
    '컬링은 ObjectSystem과 공유하는 배열 identity를 교체하면 안 됩니다.'
);

console.log(
    `game scene projectile cull scalar parity: explicit edges + ${RAW_FLOAT_CASE_COUNT} raw floats + `
        + 'getter/proxy/volatile/sparse/frozen/sealed/subclass/reentrant contracts exact'
);
