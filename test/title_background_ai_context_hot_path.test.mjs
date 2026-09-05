import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const TITLE_BACKGROUND_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/_title_background.js',
    import.meta.url
));
const AI_CONTEXT_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/background/_title_background_ai_context.js',
    import.meta.url
));
const SIMULATION_RUNTIME_PATH = fileURLToPath(new URL(
    '../project/game/script/module/simulation/simulation_runtime.js',
    import.meta.url
));
const [titleBackgroundSource, aiContextSource, simulationRuntimeSource] = await Promise.all([
    readFile(TITLE_BACKGROUND_PATH, 'utf8'),
    readFile(AI_CONTEXT_PATH, 'utf8'),
    readFile(SIMULATION_RUNTIME_PATH, 'utf8')
]);
const simulationRuntime = await loadGameModule('simulation/simulation_runtime.js');
const aiContextModule = await loadGameModule(
    'scene/title/background/_title_background_ai_context.js'
);
const {
    SimulationRuntime,
    copySimulationMousePositionInto,
    getSimulationMouseFocus,
    getSimulationMouseInput,
    isSimulationMousePressing
} = simulationRuntime;
const {
    buildTitleBackgroundAiContext,
    buildTitleBackgroundAiContextFromSimulation
} = aiContextModule;

/**
 * 최적화 전 options builder 본문을 독립적으로 재현합니다.
 * @param {object} options - AI 컨텍스트 입력입니다.
 * @returns {object} 기존 계산 결과입니다.
 */
function buildLegacyContext({
    titleConstants,
    shieldLayout,
    shieldRadius,
    objectOffsetY,
    uiww
}) {
    const mousePos = getSimulationMouseInput('pos');
    const focus = getSimulationMouseFocus();
    const objectFocused = Array.isArray(focus) && focus.includes('object');
    const mousePosInObject = mousePos
        ? { x: mousePos.x, y: mousePos.y + objectOffsetY }
        : null;
    const shieldMagneticPointInObject = shieldLayout
        ? { x: shieldLayout.centerX, y: shieldLayout.centerY + objectOffsetY }
        : null;
    const rawMultiplier = titleConstants.TITLE_AI.LOGO_DISTANCE_MULTIPLIER;
    const logoDistanceMultiplier = Math.max(
        1,
        Math.min(Infinity, Number.isFinite(rawMultiplier) ? rawMultiplier : 1)
    );

    return {
        uiww,
        logoMagneticPoint: shieldMagneticPointInObject,
        logoMagneticDistance: shieldRadius * logoDistanceMultiplier,
        objectFocused,
        leftPressing: isSimulationMousePressing('left'),
        mousePos: mousePosInObject
    };
}

/**
 * 컨텍스트의 키 순서와 숫자 primitive을 `Object.is` 기준으로 비교합니다.
 * @param {object} actual - 실제 컨텍스트입니다.
 * @param {object} expected - 기대 컨텍스트입니다.
 */
function assertContextExact(actual, expected) {
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of ['uiww', 'logoMagneticDistance', 'objectFocused', 'leftPressing']) {
        assert.ok(Object.is(actual[key], expected[key]), `${key} 값이 달라졌습니다.`);
    }
    for (const key of ['logoMagneticPoint', 'mousePos']) {
        if (expected[key] === null) {
            assert.strictEqual(actual[key], null);
            continue;
        }
        assert.deepEqual(Object.keys(actual[key]), ['x', 'y']);
        assert.ok(Object.is(actual[key].x, expected[key].x), `${key}.x 값이 달라졌습니다.`);
        assert.ok(Object.is(actual[key].y, expected[key].y), `${key}.y 값이 달라졌습니다.`);
    }
}

/**
 * 공개 또는 positional builder를 관찰 가능한 getter 입력으로 실행합니다.
 * @param {'public'|'fast'} kind - 실행할 builder 종류입니다.
 * @param {{allowReentry?:boolean, throwOnY?:boolean, sentinel?:Error}} [options={}] - 관찰 옵션입니다.
 * @returns {{trace:string[], result:object|null, nestedResult:object|null, error:unknown}}
 */
function runObservedBuilder(kind, options = {}) {
    const runtime = new SimulationRuntime();
    const trace = [];
    const sentinel = options.sentinel ?? new Error('mouse-y-sentinel');
    const innerPoint = { x: 71, y: 89 };
    let input;
    let invoke;
    let reentered = false;
    let nestedResult = null;
    const outerPoint = {
        get x() {
            trace.push('mouse.x');
            input.mousePos = innerPoint;
            if (options.allowReentry === true && !reentered) {
                reentered = true;
                trace.push('reenter:start');
                nestedResult = invoke();
                trace.push('reenter:end');
            }
            return -0;
        },
        get y() {
            trace.push('mouse.y');
            if (options.throwOnY === true) {
                throw sentinel;
            }
            return Number.MIN_VALUE;
        }
    };
    const leftButtons = ['clicking'];
    const mouseButtons = {
        get left() {
            trace.push('left');
            return leftButtons;
        }
    };
    input = {
        mousePos: outerPoint,
        get focusList() {
            trace.push('focus');
            return ['object'];
        },
        get mouseButtons() {
            trace.push('buttons');
            return mouseButtons;
        }
    };
    runtime.input = input;

    const objectOffsetY = {
        [Symbol.toPrimitive]() {
            trace.push('offset');
            return 7;
        }
    };
    const shieldLayout = {
        get centerX() {
            trace.push('shield.x');
            return 11;
        },
        get centerY() {
            trace.push('shield.y');
            return 13;
        }
    };
    const titleAi = {
        get LOGO_DISTANCE_MULTIPLIER() {
            trace.push('multiplier');
            return 0.5;
        }
    };
    const titleConstants = {
        get TITLE_AI() {
            trace.push('titleAi');
            return titleAi;
        }
    };
    const shieldRadius = {
        [Symbol.toPrimitive]() {
            trace.push('radius');
            return 17;
        }
    };
    const args = { titleConstants, shieldLayout, shieldRadius, objectOffsetY, uiww: 2560 };
    invoke = kind === 'public'
        ? () => buildTitleBackgroundAiContext(args)
        : () => buildTitleBackgroundAiContextFromSimulation(
            titleConstants,
            shieldLayout,
            shieldRadius,
            objectOffsetY,
            2560
        );

    try {
        return { trace, result: invoke(), nestedResult, error: null };
    } catch (error) {
        return { trace, result: null, nestedResult, error };
    }
}

test('타이틀 fixed 경로는 options와 중간 mouse clone이 없는 positional builder를 사용한다', () => {
    assert.equal(
        titleBackgroundSource.match(/\bbuildTitleBackgroundAiContextFromSimulation\s*\(/gu)?.length,
        1
    );
    assert.match(
        titleBackgroundSource,
        /buildTitleBackgroundAiContextFromSimulation\(\s*TITLE_CONSTANTS,\s*this\.shieldLayout,\s*this\.shieldRadius,\s*this\.objectOffsetY,\s*this\.UIWW\s*\)/u
    );
    assert.doesNotMatch(titleBackgroundSource, /buildTitleBackgroundAiContext\s*\(\s*\{/u);
    assert.match(aiContextSource, /export function buildTitleBackgroundAiContext\s*\(\{/u);

    const fastBuilderSource = aiContextSource.slice(
        aiContextSource.indexOf('export function buildTitleBackgroundAiContextFromSimulation')
    );
    assert.equal(fastBuilderSource.match(/copySimulationMousePositionInto\s*\(/gu)?.length, 1);
    assert.doesNotMatch(fastBuilderSource, /getSimulationMouseInput\s*\(/u);
    assert.match(fastBuilderSource, /const mousePosInObject = \{ x: 0, y: 0 \};/u);

    const copySource = simulationRuntimeSource.match(
        /export function copySimulationMousePositionInto\(target\) \{[\s\S]*?\n\}/u
    )?.[0] ?? '';
    assert.match(copySource, /const input = simulationRuntimeInstance\?\.input;/u);
    assert.match(copySource, /const point = input \? input\.mousePos : DEFAULT_MOUSE_POSITION;/u);
    assert.ok(copySource.indexOf('target.x =') < copySource.indexOf('target.y ='));
    assert.match(copySource, /return target;/u);
    assert.doesNotMatch(copySource, /clonePoint|getSimulationMouseInput/u);
});

test('positional 컨텍스트는 legacy/public 결과와 숫자 edge 및 fresh identity에서 exact 일치한다', () => {
    const runtime = new SimulationRuntime();
    const cases = [
        {
            mousePos: { x: 125.5, y: -48.25 },
            focusList: ['object'],
            left: ['click'],
            multiplier: 2.5,
            shieldLayout: { centerX: 640, centerY: 320 },
            shieldRadius: 90,
            objectOffsetY: 17,
            uiww: 2560
        },
        {
            mousePos: null,
            focusList: [],
            left: ['clicking'],
            multiplier: NaN,
            shieldLayout: null,
            shieldRadius: -0,
            objectOffsetY: -0,
            uiww: NaN
        },
        {
            mousePos: { x: -0, y: Number.MIN_VALUE },
            focusList: ['ui', 'object'],
            left: [],
            multiplier: -Infinity,
            shieldLayout: { centerX: -0, centerY: Infinity },
            shieldRadius: Number.MAX_VALUE,
            objectOffsetY: -Infinity,
            uiww: Number.MIN_VALUE
        },
        {
            mousePos: { x: NaN, y: Infinity },
            focusList: ['ui'],
            left: ['idle'],
            multiplier: Infinity,
            shieldLayout: { centerX: Number.MAX_VALUE, centerY: -Number.MAX_VALUE },
            shieldRadius: Infinity,
            objectOffsetY: Infinity,
            uiww: -Infinity
        }
    ];

    for (const testCase of cases) {
        runtime.input = {
            mousePos: testCase.mousePos,
            focusList: testCase.focusList,
            mouseButtons: { left: testCase.left, right: [], middle: [] },
            keys: {}
        };
        const titleConstants = { TITLE_AI: { LOGO_DISTANCE_MULTIPLIER: testCase.multiplier } };
        const options = {
            titleConstants,
            shieldLayout: testCase.shieldLayout,
            shieldRadius: testCase.shieldRadius,
            objectOffsetY: testCase.objectOffsetY,
            uiww: testCase.uiww
        };
        const expected = buildLegacyContext(options);
        const expectedMouse = getSimulationMouseInput('pos');
        const copiedMouse = { x: 999, y: 999 };
        assert.strictEqual(copySimulationMousePositionInto(copiedMouse), copiedMouse);
        assert.ok(Object.is(copiedMouse.x, expectedMouse.x));
        assert.ok(Object.is(copiedMouse.y, expectedMouse.y));
        const publicContext = buildTitleBackgroundAiContext(options);
        const first = buildTitleBackgroundAiContextFromSimulation(
            titleConstants,
            testCase.shieldLayout,
            testCase.shieldRadius,
            testCase.objectOffsetY,
            testCase.uiww
        );
        const second = buildTitleBackgroundAiContextFromSimulation(
            titleConstants,
            testCase.shieldLayout,
            testCase.shieldRadius,
            testCase.objectOffsetY,
            testCase.uiww
        );

        assertContextExact(publicContext, expected);
        assertContextExact(first, expected);
        assertContextExact(second, expected);
        assert.notStrictEqual(first, second);
        assert.notStrictEqual(first.mousePos, second.mousePos);
        if (first.logoMagneticPoint !== null) {
            assert.notStrictEqual(first.logoMagneticPoint, second.logoMagneticPoint);
        }
        if (testCase.mousePos && typeof testCase.mousePos === 'object') {
            assert.notStrictEqual(first.mousePos, testCase.mousePos);
        }

        const secondMouseX = second.mousePos.x;
        first.mousePos.x = 999;
        assert.ok(Object.is(second.mousePos.x, secondMouseX));
        if (first.logoMagneticPoint !== null) {
            const secondLogoX = second.logoMagneticPoint.x;
            first.logoMagneticPoint.x = 999;
            assert.ok(Object.is(second.logoMagneticPoint.x, secondLogoX));
        }
    }
});

test('positional 컨텍스트는 getter 순서와 throw/reentry snapshot 계약을 보존한다', () => {
    const expectedTrace = [
        'mouse.x',
        'mouse.y',
        'focus',
        'offset',
        'shield.x',
        'shield.y',
        'offset',
        'titleAi',
        'multiplier',
        'radius',
        'buttons',
        'left',
        'buttons',
        'left'
    ];
    const publicObserved = runObservedBuilder('public');
    const fastObserved = runObservedBuilder('fast');
    assert.deepEqual(publicObserved.trace, expectedTrace);
    assert.deepEqual(fastObserved.trace, expectedTrace);
    assertContextExact(fastObserved.result, publicObserved.result);

    const publicReentry = runObservedBuilder('public', { allowReentry: true });
    const fastReentry = runObservedBuilder('fast', { allowReentry: true });
    assert.deepEqual(fastReentry.trace, publicReentry.trace);
    assertContextExact(fastReentry.result, publicReentry.result);
    assertContextExact(fastReentry.nestedResult, publicReentry.nestedResult);
    assert.ok(Object.is(fastReentry.result.mousePos.x, -0));
    assert.ok(Object.is(fastReentry.result.mousePos.y, Number.MIN_VALUE + 7));
    assert.ok(Object.is(fastReentry.nestedResult.mousePos.x, 71));
    assert.ok(Object.is(fastReentry.nestedResult.mousePos.y, 96));

    const sentinel = new Error('shared-y-sentinel');
    const publicThrow = runObservedBuilder('public', { throwOnY: true, sentinel });
    const fastThrow = runObservedBuilder('fast', { throwOnY: true, sentinel });
    assert.strictEqual(publicThrow.error, sentinel);
    assert.strictEqual(fastThrow.error, sentinel);
    assert.deepEqual(publicThrow.trace, ['mouse.x', 'mouse.y']);
    assert.deepEqual(fastThrow.trace, publicThrow.trace);
});
