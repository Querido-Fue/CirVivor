import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const CURSOR_URL = new URL('../script/module/ui/cursor/ui_cursor.js', import.meta.url);
const cursorSource = await readFile(CURSOR_URL, 'utf8');
const ANIMATION_CATEGORY = Object.freeze({ UI: 'ui' });

/**
 * UICursor를 제어 가능한 animation/time/input 포트와 함께 로드합니다.
 * @param {number} initialScale - 시작 UI duration scale입니다.
 * @returns {Promise<object>} 커서 테스트 하네스입니다.
 */
async function createCursorHarness(initialScale) {
    let delta = 0.1;
    let durationScale = initialScale;
    let pressing = false;
    let nextAnimationId = 1;
    const animations = [];
    const removedIds = [];
    const context = vm.createContext({ console });

    function createSyntheticModule(exports) {
        return new vm.SyntheticModule(Object.keys(exports), function initialize() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        }, { context });
    }

    const dependencies = new Map([
        ['animation/animation_system.js', createSyntheticModule({
            ANIMATION_CATEGORY,
            animate(owner, properties) {
                const record = {
                    id: nextAnimationId++,
                    owner,
                    properties: { ...properties },
                    promise: Promise.resolve()
                };
                animations.push(record);
                return record;
            },
            getResolvedUiAnimationDurationScale: () => durationScale,
            remove: (id) => removedIds.push(id)
        })],
        ['display/display_system.js', createSyntheticModule({
            getCanvas: () => null,
            getDisplaySystem: () => null,
            getWW: () => 1920,
            getWH: () => 1080,
            render: () => undefined,
            shadowOn: () => undefined,
            shadowOff: () => undefined
        })],
        ['game/time_handler.js', createSyntheticModule({ getDelta: () => delta })],
        ['input/input_system.js', createSyntheticModule({
            getMouseInput: () => 0,
            isMousePressing: () => pressing
        })],
        ['display/_theme_handler.js', createSyntheticModule({ ColorSchemes: {} })],
        ['util/math_util.js', createSyntheticModule({
            toRadians: (degrees) => degrees * Math.PI / 180
        })],
        ['util/number_util.js', createSyntheticModule({
            clampFiniteNumber(value, min, max, fallback) {
                return Number.isFinite(value)
                    ? Math.max(min, Math.min(max, value))
                    : fallback;
            },
            resolveFiniteNumber: (value, fallback) => Number.isFinite(value) ? value : fallback
        })]
    ]);
    const module = new vm.SourceTextModule(cursorSource, {
        context,
        identifier: CURSOR_URL.href
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`UICursor 테스트 의존성이 없습니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        UICursor: module.namespace.UICursor,
        animations,
        removedIds,
        setDelta(value) {
            delta = value;
        },
        setDurationScale(value) {
            durationScale = value;
        },
        setPressing(value) {
            pressing = value;
        }
    };
}

for (const scenario of [
    { scale: 2, expectedAuthoredReverseDuration: 0.1 },
    { scale: 0.5, expectedAuthoredReverseDuration: 0.4 }
]) {
    test(`UICursor scale ${scenario.scale} press/release 역전은 같은 wall-clock 경로를 되짚는다`, async () => {
        const harness = await createCursorHarness(scenario.scale);
        const cursor = new harness.UICursor();
        harness.setPressing(true);
        cursor.update();
        cursor.update();
        assert.equal(harness.animations.length, 2);
        assert.ok(harness.animations.every(
            ({ properties }) => properties.animationCategory === ANIMATION_CATEGORY.UI
        ));
        assert.ok(harness.animations.every(
            ({ properties }) => properties.duration === 0.5
        ));

        harness.setPressing(false);
        cursor.update();
        assert.deepEqual(harness.removedIds, [-1, -1, 1, 2]);
        const reverseAnimations = harness.animations.slice(2);
        assert.equal(reverseAnimations.length, 2);
        assert.ok(reverseAnimations.every(
            ({ properties }) => properties.animationCategory === ANIMATION_CATEGORY.UI
        ));
        assert.ok(reverseAnimations.every(
            ({ properties }) => Math.abs(
                properties.duration - scenario.expectedAuthoredReverseDuration
            ) < 1e-12
        ));
        assert.ok(reverseAnimations.every(
            ({ properties }) => Math.abs(
                properties.duration * scenario.scale - 0.2
            ) < 1e-12
        ));
    });
}

test('UICursor manual clock은 live resolved scale 변경을 다음 update부터 반영한다', async () => {
    const harness = await createCursorHarness(2);
    const cursor = new harness.UICursor();
    harness.setPressing(true);
    cursor.update();
    harness.setDurationScale(0.5);
    cursor.update();
    harness.setPressing(false);
    cursor.update();
    const reverseDuration = harness.animations.at(-1).properties.duration;
    assert.ok(Math.abs(reverseDuration - 0.25) < 1e-12);
});
