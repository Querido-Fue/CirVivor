import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const ANIMATION_ROOT = path.join(SCRIPT_ROOT, 'module', 'animation');
const ANIMATION_SYSTEM_PATH = path.join(ANIMATION_ROOT, 'animation_system.js');
const STANDARD_ANIMATION_PATH = path.join(ANIMATION_ROOT, '_standard_animation.js');
const CONSTANTS_PATH = path.join(ANIMATION_ROOT, '_constants.js');
const animationSystemSource = await readFile(ANIMATION_SYSTEM_PATH, 'utf8');

const EXECUTABLE_SOURCE_HASH = '5428453a7d18511ad207f4e0c8e17304fc88b1959f0477c5190edc4acb309927';
const SYNTHETIC_PREFIX = 'synthetic:';
const ALIAS_ROOTS = Object.freeze({
    'object/': path.join(SCRIPT_ROOT, 'module', 'object'),
    'util/': path.join(SCRIPT_ROOT, 'util')
});

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
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
 * 실제 AnimationSystem과 실제 animation/object-pool 모듈을 새 VM realm에 로드합니다.
 * 런타임 전역 의존성만 최소 synthetic module로 대체합니다.
 * @returns {Promise<object>} 테스트 하네스입니다.
 */
async function createAnimationHarness() {
    let frameDelta = 0;
    let fixedDelta = 0;
    const context = vm.createContext({ console });
    const moduleCache = new Map();
    const syntheticExports = new Map([
        [`${SYNTHETIC_PREFIX}game/time_handler.js`, {
            getDelta: () => frameDelta,
            getFixedDelta: () => fixedDelta
        }],
        [`${SYNTHETIC_PREFIX}debug/debug_system.js`, {
            errThrow: () => undefined
        }]
    ]);

    function resolveModuleIdentifier(specifier, parentIdentifier) {
        if (syntheticExports.has(`${SYNTHETIC_PREFIX}${specifier}`)) {
            return `${SYNTHETIC_PREFIX}${specifier}`;
        }
        if (specifier.startsWith('.')) {
            return path.resolve(path.dirname(parentIdentifier), specifier);
        }
        for (const [prefix, root] of Object.entries(ALIAS_ROOTS)) {
            if (specifier.startsWith(prefix)) {
                return path.join(root, specifier.slice(prefix.length));
            }
        }
        throw new Error(`지원하지 않는 모듈 경로입니다: ${specifier}`);
    }

    async function createModule(identifier) {
        if (syntheticExports.has(identifier)) {
            const exports = syntheticExports.get(identifier);
            return new vm.SyntheticModule(Object.keys(exports), function setSyntheticExports() {
                for (const [name, value] of Object.entries(exports)) {
                    this.setExport(name, value);
                }
            }, { context, identifier });
        }

        const source = await readFile(identifier, 'utf8');
        return new vm.SourceTextModule(source, { context, identifier });
    }

    function getModule(identifier) {
        if (!moduleCache.has(identifier)) {
            moduleCache.set(identifier, createModule(identifier));
        }
        return moduleCache.get(identifier);
    }

    const animationSystemModule = await getModule(ANIMATION_SYSTEM_PATH);
    await animationSystemModule.link((specifier, referencingModule) => {
        return getModule(resolveModuleIdentifier(specifier, referencingModule.identifier));
    });
    await animationSystemModule.evaluate();

    const standardAnimationModule = await getModule(STANDARD_ANIMATION_PATH);
    const constantsModule = await getModule(CONSTANTS_PATH);
    // 이 파일은 remove/retarget legacy 계약만 검증하므로 test-only helper에서 필수 category를 주입합니다.
    const originalAnimate = animationSystemModule.namespace.AnimationSystem.prototype.animate;
    animationSystemModule.namespace.AnimationSystem.prototype.animate = function animateWithCategory(
        owner,
        properties
    ) {
        return originalAnimate.call(this, owner, {
            animationCategory: constantsModule.namespace.ANIMATION_CATEGORY.UI,
            ...properties
        });
    };
    return {
        namespace: animationSystemModule.namespace,
        standardAnimationPool: standardAnimationModule.namespace.standardAnimationPool,
        states: constantsModule.namespace.ANIMATION_STATE,
        setFrameDelta(value) {
            frameDelta = value;
        },
        setFixedDelta(value) {
            fixedDelta = value;
        }
    };
}

test('AnimationSystem 구현 상수는 production 모듈에 있고 data registry에 의존하지 않는다', () => {
    assert.equal(hashExecutableSource(animationSystemSource, 27), EXECUTABLE_SOURCE_HASH);
    assert.doesNotMatch(animationSystemSource, /data\/data_handler\.js/);
    assert.match(animationSystemSource, /const ANIMATOR_POOL_WARMUP_COUNT = 500;/);
});

test('retarget은 같은 표준 애니메이션과 Promise를 유지하며 현재 표시값에서 최신 목표로 이어진다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const owner = { x: 0 };
    const handle = system.animate(owner, {
        variable: 'x',
        startValue: 0,
        endValue: 1,
        duration: 1,
        type: 'linear'
    });
    const animation = system.animationsById.get(handle.id);
    const completion = handle.promise;

    system.update({ delta: 0.25 });
    assert.equal(owner.x, 0.25);
    assert.equal(animation.currentTime, 0.25);
    assert.equal(harness.standardAnimationPool.inUseCount, 1);

    assert.equal(handle.retarget({
        endValue: 2,
        duration: 0.4,
        type: 'easeOutExpo'
    }), true);
    assert.strictEqual(system.animationsById.get(handle.id), animation);
    assert.strictEqual(handle.promise, completion);
    assert.equal(animation.startValue, 0.25);
    assert.equal(animation.endValue, 2);
    assert.equal(animation.currentTime, 0);
    assert.equal(owner.x, 0.25);
    assert.equal(harness.standardAnimationPool.inUseCount, 1);

    system.update({ delta: 0.2 });
    const expectedHalfValue = 0.25 + ((2 - 0.25) * (1 - Math.pow(2, -5)));
    assert.ok(Math.abs(owner.x - expectedHalfValue) < 1e-12);
    system.update({ delta: 0.2 });
    assert.equal(owner.x, 2);
    system.update({ delta: Number.EPSILON });
    await completion;
    assert.equal(system.animationsById.has(handle.id), false);
    assert.equal(harness.standardAnimationPool.inUseCount, 0);
});

test('speedEasing retarget은 직전 순간 속도를 Hermite 시작 속도로 보존하고 기본값은 false다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const owner = { x: 0 };
    const handle = system.animate(owner, {
        variable: 'x',
        startValue: 0,
        endValue: 10,
        duration: 1,
        type: 'linear'
    });
    const animation = system.animationsById.get(handle.id);

    system.update({ delta: 0.25 });
    assert.equal(owner.x, 2.5);

    assert.equal(handle.retarget({
        endValue: 5,
        duration: 0.5,
        type: 'easeOutExpo'
    }, true), true);
    assert.equal(animation.speedEasing, true);
    assert.ok(Math.abs(animation.startVelocity - 10) < 1e-9);

    system.update({ delta: 0.05 });
    const progress = 0.1;
    const progressSquared = progress * progress;
    const progressCubed = progressSquared * progress;
    const h00 = (2 * progressCubed) - (3 * progressSquared) + 1;
    const h10 = progressCubed - (2 * progressSquared) + progress;
    const h01 = (-2 * progressCubed) + (3 * progressSquared);
    const expectedValue = (h00 * 2.5) + (h10 * 10 * 0.5) + (h01 * 5);
    assert.ok(Math.abs(owner.x - expectedValue) < 1e-12);

    assert.equal(handle.retarget({
        endValue: 0,
        duration: 0.2,
        type: 'linear'
    }), true);
    assert.equal(animation.speedEasing, false);
    assert.equal(animation.startVelocity, 0);
});

test('완료 후 오래된 핸들은 풀에서 재사용된 다른 애니메이션을 조작하지 않는다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const firstOwner = { x: 0 };
    const firstHandle = system.animate(firstOwner, {
        variable: 'x',
        endValue: 1
    });

    firstHandle.remove();
    system.update({ delta: 0 });
    const secondOwner = { x: 10 };
    const secondHandle = system.animate(secondOwner, {
        variable: 'x',
        endValue: 20
    });

    assert.equal(firstHandle.isActive(), false);
    assert.equal(firstHandle.retarget({ endValue: 99 }), false);
    await firstHandle.promise;
    assert.equal(secondHandle.isActive(), true);
    assert.equal(system.animationsById.get(secondHandle.id).rawEndValue, 20);
});

test('remove JSDoc은 완료와 지연 정리·Promise·예외 계약을 정확히 명시한다', () => {
    const methodDoc = findLeadingJsDoc(animationSystemSource, 'remove\\(id\\)');
    assert.match(methodDoc, /완료 상태/);
    assert.match(methodDoc, /이미 획득한.*Promise/);
    assert.match(methodDoc, /마이크로태스크/);
    assert.match(methodDoc, /endValue.*강제.*않/);
    assert.match(methodDoc, /Map.*activeAnimations.*정리/);
    assert.match(methodDoc, /현재 또는 다음.*update/);
    assert.match(methodDoc, /delta.*해석.*성공.*순회/);
    assert.match(methodDoc, /update.*호출.*않.*보류/);
    assert.match(methodDoc, /@param \{\*\} id/);
    assert.match(methodDoc, /@returns \{void\}/);
    assert.match(methodDoc, /@throws \{\*\}/);
    assert.match(methodDoc, /@throws.*Map.*접근.*조회.*complete.*접근.*호출/);

    const adapterDoc = findLeadingJsDoc(animationSystemSource, 'export const remove = \\(id\\) =>');
    assert.match(adapterDoc, /가장 최근에 생성/);
    assert.match(adapterDoc, /생성 전.*TypeError/);
    assert.match(adapterDoc, /후속.*update.*정리 대상/);
    assert.match(adapterDoc, /@param \{\*\} id/);
    assert.match(adapterDoc, /@returns \{\*\}/);
    assert.match(adapterDoc, /정상.*undefined.*교체.*반환값.*그대로/);
    assert.match(adapterDoc, /@throws \{\*\}/);
});

test('remove는 완료와 Promise settlement만 동기 시작하고 소유 값·등록·풀은 update까지 보존한다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const owner = { x: 7 };
    const handle = system.animate(owner, {
        variable: 'x',
        startValue: 7,
        endValue: 99,
        duration: 1
    });
    const animation = system.animationsById.get(handle.id);
    const pool = harness.standardAnimationPool;
    let promiseReactionRan = false;
    const observedPromise = handle.promise.then(() => {
        promiseReactionRan = true;
    });

    assert.equal(system.remove(handle.id), undefined);
    assert.equal(animation.state, harness.states.FINISHED);
    assert.equal(promiseReactionRan, false);
    assert.equal(owner.x, 7);
    assert.equal(system.animationsById.get(handle.id), animation);
    assert.equal(system.activeAnimations.length, 1);
    assert.equal(pool.inUseCount, 1);
    assert.equal(pool.pool.length, 0);

    await observedPromise;
    assert.equal(promiseReactionRan, true);
    await handle.promise;
    assert.equal(system.animationsById.get(handle.id), animation);

    assert.equal(system.update({ useFixedTick: true, delta: 0 }), undefined);
    assert.equal(system.animationsById.has(handle.id), false);
    assert.equal(system.activeAnimations.length, 0);
    assert.equal(pool.inUseCount, 0);
    assert.equal(pool.pool.length, 1);
    assert.equal(owner.x, 7);
});

test('FINISHED 정리는 tick 모드와 유효 delta보다 먼저 수행되어 일치하지 않는 update에서도 제거된다', async () => {
    const harness = await createAnimationHarness();
    harness.setFrameDelta(0);
    harness.setFixedDelta(0);
    const system = new harness.namespace.AnimationSystem();
    const handle = system.animate({ x: 0 }, {
        variable: 'x',
        endValue: 1,
        duration: 1,
        useFixedTick: true
    });

    system.remove(handle.id);
    system.update({ useFixedTick: false, delta: Number.NaN });
    assert.equal(system.animationsById.has(handle.id), false);
    assert.equal(system.activeAnimations.length, 0);
});

test('update의 delta 해석 예외는 순회 전 전파되어 FINISHED 등록과 풀 반환을 보류한다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const handle = system.animate({ x: 0 }, { variable: 'x', endValue: 1 });
    const animation = system.animationsById.get(handle.id);
    const deltaToken = new Error('animation delta getter sentinel');
    system.remove(handle.id);

    assert.throws(
        () => system.update({
            useFixedTick: false,
            get delta() {
                throw deltaToken;
            }
        }),
        (error) => error === deltaToken
    );
    assert.equal(system.animationsById.get(handle.id), animation);
    assert.equal(system.activeAnimations.length, 1);
    assert.equal(harness.standardAnimationPool.inUseCount, 1);
    assert.equal(harness.standardAnimationPool.pool.length, 0);

    system.update({ delta: 0 });
    assert.equal(system.animationsById.has(handle.id), false);
    assert.equal(system.activeAnimations.length, 0);
    assert.equal(harness.standardAnimationPool.inUseCount, 0);
    assert.equal(harness.standardAnimationPool.pool.length, 1);
});

test('update 도중 remove 재진입은 같은 update의 후검사에서 정리되고 값을 쓰지 않는다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const owner = { x: 11 };
    let handle;
    handle = system.animate(owner, {
        variable: 'x',
        startValue() {
            system.remove(handle.id);
            return 11;
        },
        endValue: 100,
        duration: 1
    });
    const completion = handle.promise;

    system.update({ delta: 0.25 });
    await completion;
    assert.equal(owner.x, 11);
    assert.equal(system.animationsById.has(handle.id), false);
    assert.equal(system.activeAnimations.length, 0);
});

test('역순 update 재진입은 아직 순회하지 않은 대상은 현재, 이미 순회한 대상은 다음 update에 정리한다', async () => {
    const currentHarness = await createAnimationHarness();
    const currentSystem = new currentHarness.namespace.AnimationSystem();
    const currentFirst = currentSystem.animate({ x: 0 }, {
        variable: 'x',
        startValue: 0,
        endValue: 1,
        duration: 1
    });
    const currentSecond = currentSystem.animate({ x: 0 }, {
        variable: 'x',
        startValue() {
            currentSystem.remove(currentFirst.id);
            return 0;
        },
        endValue: 1,
        duration: 1
    });

    currentSystem.update({ delta: 0.1 });
    assert.equal(currentSystem.animationsById.has(currentFirst.id), false);
    assert.equal(currentSystem.animationsById.has(currentSecond.id), true);
    assert.equal(currentSystem.activeAnimations.length, 1);

    const nextHarness = await createAnimationHarness();
    const nextSystem = new nextHarness.namespace.AnimationSystem();
    let nextSecond;
    const nextFirst = nextSystem.animate({ x: 0 }, {
        variable: 'x',
        startValue() {
            nextSystem.remove(nextSecond.id);
            return 0;
        },
        endValue: 1,
        duration: 1
    });
    nextSecond = nextSystem.animate({ x: 0 }, {
        variable: 'x',
        startValue: 0,
        endValue: 1,
        duration: 1
    });

    nextSystem.update({ delta: 0.1 });
    assert.equal(nextSystem.animationsById.has(nextFirst.id), true);
    assert.equal(nextSystem.animationsById.has(nextSecond.id), true);
    assert.equal(nextSystem.animationsById.get(nextSecond.id).state, nextHarness.states.FINISHED);
    assert.equal(nextSystem.activeAnimations.length, 2);

    nextSystem.update({ delta: 0 });
    assert.equal(nextSystem.animationsById.has(nextFirst.id), true);
    assert.equal(nextSystem.animationsById.has(nextSecond.id), false);
    assert.equal(nextSystem.activeAnimations.length, 1);
});

test('remove는 id 비교 후 Map의 exact key를 사용하며 -0만 숫자 0 ID와 일치한다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.namespace.AnimationSystem();
    const handle = system.animate({ x: 0 }, { variable: 'x', endValue: 1 });
    const animation = system.animationsById.get(handle.id);
    const nonMatchingIds = [
        undefined,
        null,
        false,
        Number.NaN,
        Infinity,
        -Infinity,
        -1,
        '0',
        0n,
        {},
        { [Symbol.toPrimitive]: () => -1 }
    ];
    for (const id of nonMatchingIds) {
        assert.equal(system.remove(id), undefined);
        assert.equal(animation.state, harness.states.RUNNING, `id=${String(id)}`);
    }

    assert.throws(() => system.remove(Symbol('id')), (error) => error?.name === 'TypeError');
    const coercionToken = new Error('remove id coercion sentinel');
    assert.throws(
        () => system.remove({
            [Symbol.toPrimitive]() {
                throw coercionToken;
            }
        }),
        (error) => error === coercionToken
    );
    assert.equal(animation.state, harness.states.RUNNING);

    assert.equal(system.remove(-0), undefined);
    assert.equal(animation.state, harness.states.FINISHED);
});

test('음수 ID는 Map 접근 전에 반환하고 property/get 예외는 identity를 보존해 전파한다', async () => {
    const propertyHarness = await createAnimationHarness();
    const propertySystem = new propertyHarness.namespace.AnimationSystem();
    const propertyToken = new Error('animation map property sentinel');
    let propertyReads = 0;
    Object.defineProperty(propertySystem, 'animationsById', {
        configurable: true,
        get() {
            propertyReads += 1;
            throw propertyToken;
        }
    });

    assert.equal(propertySystem.remove(-1), undefined);
    assert.equal(propertyReads, 0);
    assert.throws(() => propertySystem.remove(0), (error) => error === propertyToken);
    assert.equal(propertyReads, 1);

    const methodHarness = await createAnimationHarness();
    const methodSystem = new methodHarness.namespace.AnimationSystem();
    const methodToken = new Error('animation map get property sentinel');
    let methodReads = 0;
    const mapLike = {};
    Object.defineProperty(mapLike, 'get', {
        configurable: true,
        get() {
            methodReads += 1;
            throw methodToken;
        }
    });
    methodSystem.animationsById = mapLike;

    assert.equal(methodSystem.remove(-1), undefined);
    assert.equal(methodReads, 0);
    assert.throws(() => methodSystem.remove(0), (error) => error === methodToken);
    assert.equal(methodReads, 1);

    const lookupHarness = await createAnimationHarness();
    const lookupSystem = new lookupHarness.namespace.AnimationSystem();
    const lookupToken = new Error('animation map get sentinel');
    let lookupCalls = 0;
    lookupSystem.animationsById = {
        get() {
            lookupCalls += 1;
            throw lookupToken;
        }
    };

    assert.equal(lookupSystem.remove(-1), undefined);
    assert.equal(lookupCalls, 0);
    assert.throws(() => lookupSystem.remove(0), (error) => error === lookupToken);
    assert.equal(lookupCalls, 1);
});

test('id coercion 재진입과 complete 예외는 호출 순서·예외 identity·등록 상태를 보존한다', async () => {
    const reentryHarness = await createAnimationHarness();
    const reentrySystem = new reentryHarness.namespace.AnimationSystem();
    const reentryHandle = reentrySystem.animate({ x: 0 }, { variable: 'x', endValue: 1 });
    let coercionCalls = 0;
    const reentrantId = {
        [Symbol.toPrimitive]() {
            coercionCalls += 1;
            reentrySystem.remove(reentryHandle.id);
            return 0;
        }
    };
    assert.equal(reentrySystem.remove(reentrantId), undefined);
    assert.equal(coercionCalls, 1);
    assert.equal(
        reentrySystem.animationsById.get(reentryHandle.id).state,
        reentryHarness.states.FINISHED
    );

    const exceptionHarness = await createAnimationHarness();
    const exceptionSystem = new exceptionHarness.namespace.AnimationSystem();
    const exceptionHandle = exceptionSystem.animate({ x: 0 }, { variable: 'x', endValue: 1 });
    const exceptionAnimation = exceptionSystem.animationsById.get(exceptionHandle.id);
    const completionPropertyToken = new Error('animation complete property sentinel');
    Object.defineProperty(exceptionAnimation, 'complete', {
        configurable: true,
        get() {
            throw completionPropertyToken;
        }
    });
    assert.throws(
        () => exceptionSystem.remove(exceptionHandle.id),
        (error) => error === completionPropertyToken
    );
    assert.equal(exceptionAnimation.state, exceptionHarness.states.RUNNING);

    const completionToken = new Error('animation complete sentinel');
    Object.defineProperty(exceptionAnimation, 'complete', {
        configurable: true,
        value() {
            throw completionToken;
        }
    });
    assert.throws(
        () => exceptionSystem.remove(exceptionHandle.id),
        (error) => error === completionToken
    );
    assert.equal(exceptionAnimation.state, exceptionHarness.states.RUNNING);
    assert.equal(exceptionSystem.animationsById.get(exceptionHandle.id), exceptionAnimation);
    assert.equal(exceptionSystem.activeAnimations.length, 1);
});

test('공개 remove adapter는 생성 전 TypeError를 내고 가장 최근 AnimationSystem에만 위임한다', async () => {
    const harness = await createAnimationHarness();
    const api = harness.namespace;
    assert.throws(() => api.remove(0), (error) => error?.name === 'TypeError');

    const first = new api.AnimationSystem();
    const firstHandle = first.animate({ x: 0 }, { variable: 'x', endValue: 1 });
    const second = new api.AnimationSystem();
    const secondHandle = second.animate({ x: 0 }, { variable: 'x', endValue: 1 });

    assert.equal(api.remove(0), undefined);
    assert.equal(first.animationsById.get(firstHandle.id).state, harness.states.RUNNING);
    assert.equal(second.animationsById.get(secondHandle.id).state, harness.states.FINISHED);

    const adapterToken = new Error('animation adapter method sentinel');
    Object.defineProperty(second, 'remove', {
        configurable: true,
        get() {
            throw adapterToken;
        }
    });
    assert.throws(() => api.remove(0), (error) => error === adapterToken);

    const returnSentinel = { kind: 'animation adapter return' };
    Object.defineProperty(second, 'remove', {
        configurable: true,
        value() {
            return returnSentinel;
        }
    });
    assert.equal(api.remove(0), returnSentinel);
});
