import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const ANIMATION_ROOT = path.join(SCRIPT_ROOT, 'module', 'animation');
const ANIMATION_SYSTEM_PATH = path.join(ANIMATION_ROOT, 'animation_system.js');
const STANDARD_ANIMATION_PATH = path.join(ANIMATION_ROOT, '_standard_animation.js');
const MIXED_ANIMATION_PATH = path.join(ANIMATION_ROOT, '_mixed_animation.js');
const PERSISTENT_ANIMATION_PATH = path.join(ANIMATION_ROOT, '_persistent_animation.js');
const CONSTANTS_PATH = path.join(ANIMATION_ROOT, '_constants.js');
const SYNTHETIC_PREFIX = 'synthetic:';
const ALIAS_ROOTS = Object.freeze({
    'object/': path.join(SCRIPT_ROOT, 'module', 'object'),
    'util/': path.join(SCRIPT_ROOT, 'util')
});

/**
 * 실제 animation 구현과 풀을 새 VM realm에 로드하고 시간/debug 전역만 대체합니다.
 * @returns {Promise<object>} 독립 animation 테스트 하네스입니다.
 */
async function createAnimationHarness() {
    let frameDelta = 0;
    let fixedDelta = 0;
    let frameDeltaReads = 0;
    let fixedDeltaReads = 0;
    const context = vm.createContext({ console });
    const moduleCache = new Map();
    const syntheticExports = new Map([
        [`${SYNTHETIC_PREFIX}game/time_handler.js`, {
            getDelta() {
                frameDeltaReads += 1;
                return frameDelta;
            },
            getFixedDelta() {
                fixedDeltaReads += 1;
                return fixedDelta;
            }
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
        throw new Error(`지원하지 않는 animation 테스트 모듈 경로입니다: ${specifier}`);
    }

    async function createModule(identifier) {
        if (syntheticExports.has(identifier)) {
            const exports = syntheticExports.get(identifier);
            return new vm.SyntheticModule(Object.keys(exports), function initialize() {
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
    await animationSystemModule.link((specifier, referencingModule) => (
        getModule(resolveModuleIdentifier(specifier, referencingModule.identifier))
    ));
    await animationSystemModule.evaluate();

    const standardAnimationModule = await getModule(STANDARD_ANIMATION_PATH);
    const mixedAnimationModule = await getModule(MIXED_ANIMATION_PATH);
    const persistentAnimationModule = await getModule(PERSISTENT_ANIMATION_PATH);
    const constantsModule = await getModule(CONSTANTS_PATH);
    return {
        animation: animationSystemModule.namespace,
        constants: constantsModule.namespace,
        StandardAnimation: standardAnimationModule.namespace.StandardAnimation,
        MixedAnimation: mixedAnimationModule.namespace.MixedAnimation,
        PersistentAnimation: persistentAnimationModule.namespace.PersistentAnimation,
        standardAnimationPool: standardAnimationModule.namespace.standardAnimationPool,
        setFrameDelta(value) {
            frameDelta = value;
        },
        setFixedDelta(value) {
            fixedDelta = value;
        },
        getDeltaReadCounts() {
            return { frame: frameDeltaReads, fixed: fixedDeltaReads };
        }
    };
}

/**
 * 표준 애니메이션 하나를 일관된 linear 속성으로 생성합니다.
 * @param {object} system - AnimationSystem입니다.
 * @param {string} animationCategory - 카테고리 ID입니다.
 * @param {object} owner - 애니메이션 소유자입니다.
 * @param {object} [overrides={}] - 속성 override입니다.
 * @returns {object} 표준 애니메이션 핸들입니다.
 */
function animateLinear(system, animationCategory, owner, overrides = {}) {
    return system.animate(owner, {
        animationCategory,
        variable: 'value',
        startValue: 0,
        endValue: 1,
        duration: 1,
        type: 'linear',
        ...overrides
    });
}

test('category ID는 exact/frozen이며 모든 구현이 easing type과 별도로 보존한다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY, isAnimationCategory } = harness.constants;
    assert.deepEqual({ ...ANIMATION_CATEGORY }, {
        UI: 'ui',
        GAME_MECHANIC: 'game-mechanic',
        EFFECT: 'effect'
    });
    assert.equal(Object.isFrozen(ANIMATION_CATEGORY), true);
    assert.equal(isAnimationCategory(ANIMATION_CATEGORY.UI), true);
    assert.equal(isAnimationCategory('unknown'), false);

    const system = new harness.animation.AnimationSystem();
    const standardOwner = { value: 0 };
    const standardHandle = animateLinear(
        system,
        ANIMATION_CATEGORY.UI,
        standardOwner,
        { type: 'easeInExpo' }
    );
    const mixedOwner = { value: 0 };
    const mixedResult = system.animateMixed(mixedOwner, [{
        variable: 'value',
        animations: [{ startValue: 0, endValue: 1, duration: 1, type: 'linear' }]
    }], { animationCategory: ANIMATION_CATEGORY.EFFECT });
    const persistentOwner = { value: 0 };
    const persistentId = system.animatePersist(persistentOwner, {
        animationCategory: ANIMATION_CATEGORY.GAME_MECHANIC,
        variable: 'value',
        startValue: 0,
        endValue: 1,
        easings: 'linear',
        duration: 1
    });

    assert.equal(
        system.animationsById.get(standardHandle.id).animationCategory,
        ANIMATION_CATEGORY.UI
    );
    assert.equal(
        system.animationsById.get(mixedResult.ids[0]).animationCategory,
        ANIMATION_CATEGORY.EFFECT
    );
    assert.equal(
        system.animationsById.get(persistentId).animationCategory,
        ANIMATION_CATEGORY.GAME_MECHANIC
    );
    system.update({ delta: 0.5 });
    assert.ok(standardOwner.value < 0.5, 'type=easeInExpo는 category와 독립적으로 적용돼야 합니다.');
});

test('missing/unknown category는 ingress별 invalid 계약으로 거절되고 direct init은 fail-fast한다', async () => {
    const harness = await createAnimationHarness();
    const system = new harness.animation.AnimationSystem();
    assert.equal(system.animate({ value: 0 }, { variable: 'value' }).id, -1);
    assert.equal(system.animate({ value: 0 }, {
        animationCategory: 'unknown',
        variable: 'value'
    }).id, -1);
    assert.deepEqual(
        Array.from(system.animateMixed({ value: 0 }, [], {}).ids),
        []
    );
    assert.deepEqual(
        Array.from(system.animateMixed({ value: 0 }, [], null).ids),
        []
    );
    assert.deepEqual(
        Array.from(system.animateMixed({ value: 0 }, [], {
            animationCategory: 'unknown'
        }).ids),
        []
    );
    assert.equal(system.animatePersist({ value: 0 }, {
        variable: 'value',
        easings: 'linear',
        duration: 1
    }), -1);
    assert.equal(system.animatePersist({ value: 0 }, {
        animationCategory: 'unknown',
        variable: 'value',
        easings: 'linear',
        duration: 1
    }), -1);
    assert.equal(system.activeAnimations.length, 0);

    const direct = new harness.StandardAnimation();
    assert.throws(
        () => direct.init(1, { value: 0 }, 'value', 'unknown', 0, 1, 'linear', 1, 0),
        (error) => error?.name === 'TypeError'
    );
});

test('UI scale resolver는 update당 한 번만 읽고 missing/throw/non-number/nonfinite를 1로 복구하며 finite 값을 clamp한다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    const cases = [
        { name: 'missing', options: {}, expected: 0.1 },
        {
            name: 'throw',
            options: { getUiAnimationDurationScale: () => { throw new Error('scale'); } },
            expected: 0.1
        },
        { name: 'string', options: { getUiAnimationDurationScale: () => '2' }, expected: 0.1 },
        { name: 'NaN', options: { getUiAnimationDurationScale: () => Number.NaN }, expected: 0.1 },
        { name: 'Infinity', options: { getUiAnimationDurationScale: () => Infinity }, expected: 0.1 },
        { name: 'below', options: { getUiAnimationDurationScale: () => -3 }, expected: 1 },
        { name: 'above', options: { getUiAnimationDurationScale: () => 99 }, expected: 0.025 }
    ];

    for (const scenario of cases) {
        const system = new harness.animation.AnimationSystem(scenario.options);
        const owner = { value: 0 };
        animateLinear(system, ANIMATION_CATEGORY.UI, owner, { duration: 10 });
        system.update({ delta: 1 });
        assert.ok(
            Math.abs(owner.value - scenario.expected) < 1e-12,
            `${scenario.name}: ${owner.value}`
        );
    }

    let resolverCalls = 0;
    const onceSystem = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale() {
            resolverCalls += 1;
            return 2;
        }
    });
    animateLinear(onceSystem, ANIMATION_CATEGORY.UI, { value: 0 });
    animateLinear(onceSystem, ANIMATION_CATEGORY.EFFECT, { value: 0 });
    onceSystem.update({ delta: 0.25 });
    assert.equal(resolverCalls, 1);
    assert.equal(onceSystem.getResolvedUiAnimationDurationScale(), 2);
    assert.equal(harness.animation.getResolvedUiAnimationDurationScale(), 2);

    harness.setFrameDelta(0.25);
    harness.setFixedDelta(0.5);
    const clockSystem = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale() {
            resolverCalls += 1;
            return 2;
        }
    });
    animateLinear(clockSystem, ANIMATION_CATEGORY.UI, { value: 0 });
    animateLinear(clockSystem, ANIMATION_CATEGORY.EFFECT, { value: 0 });
    clockSystem.update({ useFixedTick: false });
    assert.deepEqual(harness.getDeltaReadCounts(), { frame: 1, fixed: 0 });
    clockSystem.update({ useFixedTick: true });
    assert.deepEqual(harness.getDeltaReadCounts(), { frame: 1, fixed: 1 });
    assert.equal(resolverCalls, 3);
});

test('StandardAnimation은 UI만 wall-clock 0.5/1/2 배율을 적용하고 gameplay/effect 및 tick 선택을 보존한다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    const scaleSystem = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => 2
    });
    const uiOwner = { value: 0 };
    const gameplayOwner = { value: 0 };
    const effectOwner = { value: 0 };
    const uiHandle = animateLinear(scaleSystem, ANIMATION_CATEGORY.UI, uiOwner);
    const gameplayHandle = animateLinear(
        scaleSystem,
        ANIMATION_CATEGORY.GAME_MECHANIC,
        gameplayOwner
    );
    const effectHandle = animateLinear(
        scaleSystem,
        ANIMATION_CATEGORY.EFFECT,
        effectOwner
    );
    assert.equal(scaleSystem.animationsById.get(uiHandle.id).duration, 1);

    scaleSystem.update({ delta: 1 });
    assert.equal(uiOwner.value, 0.5);
    assert.equal(gameplayOwner.value, 1);
    assert.equal(effectOwner.value, 1);
    assert.equal(uiHandle.isActive(), true);
    scaleSystem.update({ delta: 1 });
    assert.equal(uiOwner.value, 1);
    assert.equal(gameplayHandle.isActive(), false);
    assert.equal(effectHandle.isActive(), false);
    assert.equal(uiHandle.isActive(), true, 'exact duration 프레임의 기존 settle 계약을 보존합니다.');
    scaleSystem.update({ delta: Number.EPSILON });
    assert.equal(uiHandle.isActive(), false);

    for (const [scale, wallDelta] of [[1, 1], [0.5, 0.5]]) {
        const system = new harness.animation.AnimationSystem({
            getUiAnimationDurationScale: () => scale
        });
        const owner = { value: 0 };
        animateLinear(system, ANIMATION_CATEGORY.UI, owner);
        system.update({ delta: wallDelta });
        assert.equal(owner.value, 1);
    }

    const tickSystem = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => 2
    });
    const frameOwner = { value: 0 };
    const fixedOwner = { value: 0 };
    animateLinear(tickSystem, ANIMATION_CATEGORY.UI, frameOwner);
    animateLinear(tickSystem, ANIMATION_CATEGORY.UI, fixedOwner, { useFixedTick: true });
    tickSystem.update({ delta: 0.5, useFixedTick: false });
    assert.equal(frameOwner.value, 0.25);
    assert.equal(fixedOwner.value, 0);
    tickSystem.update({ delta: 0.5, useFixedTick: true });
    assert.equal(frameOwner.value, 0.25);
    assert.equal(fixedOwner.value, 0.25);
});

test('UI scale은 delay/zero-duration과 live scale 변경에 적용되며 authored 값을 mutate하지 않는다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    let scale = 2;
    const system = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => scale
    });
    const uiOwner = { value: 0 };
    const effectOwner = { value: 0 };
    const uiHandle = animateLinear(system, ANIMATION_CATEGORY.UI, uiOwner, { delay: 1 });
    animateLinear(system, ANIMATION_CATEGORY.EFFECT, effectOwner, { delay: 1 });
    const uiAnimation = system.animationsById.get(uiHandle.id);

    system.update({ delta: 1 });
    assert.equal(uiAnimation.delay, 0.5);
    assert.equal(effectOwner.value, 0);
    system.update({ delta: 1 });
    assert.equal(uiAnimation.delay, 0);
    assert.equal(uiOwner.value, 0);
    assert.equal(effectOwner.value, 1);
    system.update({ delta: 1 });
    assert.equal(uiOwner.value, 0.5);
    assert.equal(uiAnimation.duration, 1);

    const liveOwner = { value: 0 };
    const liveHandle = animateLinear(system, ANIMATION_CATEGORY.UI, liveOwner, { duration: 2 });
    system.update({ delta: 1 });
    assert.equal(liveOwner.value, 0.25);
    scale = 0.5;
    system.update({ delta: 0.25 });
    assert.equal(liveOwner.value, 0.5);
    assert.equal(system.animationsById.get(liveHandle.id).duration, 2);

    const zeroOwner = { value: 0 };
    const zeroHandle = animateLinear(
        system,
        ANIMATION_CATEGORY.UI,
        zeroOwner,
        { duration: 0 }
    );
    system.update({ delta: 0.01 });
    assert.equal(zeroOwner.value, 1);
    assert.equal(zeroHandle.isActive(), false);
    await zeroHandle.promise;
});

test('MixedAnimation parent category는 모든 child에 전파되고 UI Promise만 scaled settle 뒤 이행한다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    const system = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => 2
    });
    const uiOwner = { first: 0, second: 0 };
    const effectOwner = { value: 0 };
    const uiResult = system.animateMixed(uiOwner, [
        {
            variable: 'first',
            animations: [{ startValue: 0, endValue: 1, duration: 1, type: 'linear' }]
        },
        {
            variable: 'second',
            animations: [{ startValue: 0, endValue: 2, duration: 1, type: 'linear' }]
        }
    ], { animationCategory: ANIMATION_CATEGORY.UI });
    const effectResult = system.animateMixed(effectOwner, [{
        variable: 'value',
        animations: [{ startValue: 0, endValue: 1, duration: 1, type: 'linear' }]
    }], { animationCategory: ANIMATION_CATEGORY.EFFECT });
    assert.ok(uiResult.ids.every(
        (id) => system.animationsById.get(id).animationCategory === ANIMATION_CATEGORY.UI
    ));

    let uiSettled = false;
    uiResult.promise.then(() => { uiSettled = true; });
    system.update({ delta: 1 });
    assert.equal(uiOwner.first, 0.5);
    assert.equal(uiOwner.second, 1);
    assert.equal(effectOwner.value, 1);
    system.update({ delta: 1 });
    await effectResult.promise;
    assert.equal(uiOwner.first, 1);
    assert.equal(uiOwner.second, 2);
    assert.equal(uiSettled, false);
    system.update({ delta: Number.EPSILON });
    await uiResult.promise;
    assert.equal(uiSettled, true);
});

test('PersistentAnimation forward/backward 진행량과 finite command duration은 UI만 scale되고 category가 유지된다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    const system = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => 2
    });
    const entries = [
        [ANIMATION_CATEGORY.UI, { value: 0 }],
        [ANIMATION_CATEGORY.GAME_MECHANIC, { value: 0 }],
        [ANIMATION_CATEGORY.EFFECT, { value: 0 }]
    ].map(([animationCategory, owner]) => {
        const id = system.animatePersist(owner, {
            animationCategory,
            variable: 'value',
            startValue: 0,
            endValue: 1,
            easings: 'linear',
            duration: 1
        });
        system.forward(id, 1, 1, true);
        return { animationCategory, owner, id, animation: system.animationsById.get(id) };
    });
    const [uiEntry, gameplayEntry, effectEntry] = entries;
    let persistentSettled = false;
    uiEntry.animation.promise.then(() => { persistentSettled = true; });

    system.update({ delta: 1 });
    assert.equal(uiEntry.animation.progress, 0.5);
    assert.equal(uiEntry.animation.commandQueue[0].duration, 0.5);
    assert.equal(gameplayEntry.animation.progress, 1);
    assert.equal(effectEntry.animation.progress, 1);
    assert.equal(gameplayEntry.animation.commandQueue.length, 0);
    assert.equal(effectEntry.animation.commandQueue.length, 0);
    system.update({ delta: 1 });
    assert.equal(uiEntry.animation.progress, 1);
    assert.equal(uiEntry.animation.commandQueue.length, 0);
    assert.equal(persistentSettled, false);

    for (const entry of entries) {
        system.backward(entry.id, 1, 1, true);
    }
    system.update({ delta: 1 });
    assert.equal(uiEntry.animation.progress, 0.5);
    assert.equal(gameplayEntry.animation.progress, 0);
    assert.equal(effectEntry.animation.progress, 0);
    assert.ok(entries.every(
        ({ animationCategory, animation }) => animation.animationCategory === animationCategory
    ));
    system.update({ delta: 1 });
    assert.equal(uiEntry.animation.progress, 0);

    system.remove(uiEntry.id);
    await uiEntry.animation.promise;
    assert.equal(persistentSettled, true);
});

test('retarget은 category/ID/Promise를 보존하고 scale 2 speed-easing wall velocity를 연속 유지한다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY } = harness.constants;
    const system = new harness.animation.AnimationSystem({
        getUiAnimationDurationScale: () => 2
    });
    const owner = { value: 0 };
    const handle = animateLinear(system, ANIMATION_CATEGORY.UI, owner, {
        endValue: 10,
        duration: 1
    });
    const completionPromise = handle.promise;
    system.update({ delta: 0.5 });
    assert.equal(owner.value, 2.5);
    assert.equal(handle.retarget({
        animationCategory: ANIMATION_CATEGORY.EFFECT,
        endValue: 20,
        duration: 1
    }, true), false);
    assert.equal(handle.retarget({
        animationCategory: 'unknown',
        endValue: 20,
        duration: 1
    }, true), false);
    assert.equal(handle.retarget({
        animationCategory: undefined,
        endValue: 20,
        duration: 1
    }, true), false);
    assert.equal(owner.value, 2.5);

    assert.equal(handle.retarget({
        animationCategory: ANIMATION_CATEGORY.UI,
        endValue: 20,
        duration: 1,
        type: 'linear'
    }, true), true);
    assert.strictEqual(handle.promise, completionPromise);
    const beforeVelocityStep = owner.value;
    system.update({ delta: 0.002 });
    const wallVelocity = (owner.value - beforeVelocityStep) / 0.002;
    assert.ok(Math.abs(wallVelocity - 5) < 0.2, `wallVelocity=${wallVelocity}`);
    assert.equal(handle.retarget({ endValue: 30, duration: 1, type: 'linear' }), true);
    assert.equal(
        system.animationsById.get(handle.id).animationCategory,
        ANIMATION_CATEGORY.UI
    );
});

test('standard pool reset은 재사용 전 category와 공통 owner/state를 지운다', async () => {
    const harness = await createAnimationHarness();
    const { ANIMATION_CATEGORY, ANIMATION_STATE } = harness.constants;
    const pool = harness.standardAnimationPool;
    pool.clear();
    const first = pool.get();
    first.init(
        7,
        { value: 0 },
        'value',
        ANIMATION_CATEGORY.UI,
        0,
        1,
        'linear',
        1,
        0
    );
    assert.equal(first.animationCategory, ANIMATION_CATEGORY.UI);
    pool.release(first);
    const reused = pool.get();
    assert.strictEqual(reused, first);
    assert.equal(reused.animationCategory, null);
    assert.equal(reused.owner, null);
    assert.equal(reused.state, ANIMATION_STATE.IDLE);
    reused.init(
        8,
        { value: 0 },
        'value',
        ANIMATION_CATEGORY.EFFECT,
        0,
        1,
        'linear',
        1,
        0
    );
    assert.equal(reused.animationCategory, ANIMATION_CATEGORY.EFFECT);
    pool.release(reused);
});
