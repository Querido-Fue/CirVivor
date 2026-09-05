import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const BASE_ELEMENT_URL = new URL(
    '../project/game/script/module/ui/element/_base_element.js',
    import.meta.url
);
const baseElementSource = await readFile(BASE_ELEMENT_URL, 'utf8');
const ANIMATION_CATEGORY = Object.freeze({ UI: 'ui' });

/**
 * VM SyntheticModule을 생성합니다.
 * @param {vm.Context} context - VM 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - synthetic export입니다.
 * @returns {vm.SyntheticModule} 생성된 모듈입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initialize() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

/**
 * 실제 BaseUIElement와 animation handle 관찰 stub을 결합합니다.
 * @returns {Promise<object>} 테스트 하네스입니다.
 */
async function createInteractionHarness() {
    const animationRecords = [];
    const context = vm.createContext({
        console,
        crypto: {
            randomUUID: () => 'base-ui-element-test-id'
        }
    });
    let nextAnimationId = 0;

    const dependencies = new Map([
        ['animation/animation_system.js', createSyntheticModule(
            context,
            'animation/animation_system.js',
            {
                ANIMATION_CATEGORY,
                animate(owner, properties) {
                    const record = {
                        owner,
                        properties,
                        retargetCalls: [],
                        removeCount: 0,
                        active: true,
                        handle: null
                    };
                    const handle = Object.freeze({
                        id: nextAnimationId++,
                        promise: Promise.resolve(),
                        retarget(nextProperties, speedEasing = false) {
                            record.retargetCalls.push({
                                properties: nextProperties,
                                speedEasing
                            });
                            return record.active;
                        },
                        remove() {
                            record.removeCount += 1;
                            record.active = false;
                        },
                        isActive() {
                            return record.active;
                        }
                    });
                    record.handle = handle;
                    animationRecords.push(record);
                    return handle;
                }
            }
        )],
        ['ui/ui_system.js', createSyntheticModule(
            context,
            'ui/ui_system.js',
            { requestTooltip: () => undefined }
        )]
    ]);
    const module = new vm.SourceTextModule(baseElementSource, {
        context,
        identifier: BASE_ELEMENT_URL.href
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`BaseUIElement 테스트 의존성이 없습니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();

    return {
        BaseUIElement: module.namespace.BaseUIElement,
        animationRecords
    };
}

test('설정 공통 UI 호버·이탈 반복은 같은 scale/hover handle을 speedEasing false로 retarget한다', async () => {
    const harness = await createInteractionHarness();

    class InteractionElement extends harness.BaseUIElement {
        constructor() {
            super({});
            this.init({ clickAble: true });
            this.hoverScaleMultiplier = 1.04;
            this.pressScaleMultiplier = 0.96;
        }

        setInteraction(isHovered, isLeftClicking) {
            this._handleInteractionState(isHovered, isLeftClicking);
        }
    }

    const element = new InteractionElement();
    element.setInteraction(true, false);
    assert.equal(harness.animationRecords.length, 2);
    const [scaleAnimation, hoverAnimation] = harness.animationRecords;
    assert.ok(harness.animationRecords.every(
        ({ properties }) => properties.animationCategory === ANIMATION_CATEGORY.UI
    ));
    const scaleAnimationId = element.scaleAnimId;
    const hoverAnimationId = element.hoverAnimId;

    element.scale = 1.02;
    element.hoverValue = 0.4;
    element.setInteraction(false, false);
    element.setInteraction(true, false);

    assert.equal(harness.animationRecords.length, 2);
    assert.equal(element.scaleAnimId, scaleAnimationId);
    assert.equal(element.hoverAnimId, hoverAnimationId);
    assert.equal(scaleAnimation.removeCount, 0);
    assert.equal(hoverAnimation.removeCount, 0);
    assert.deepEqual(
        scaleAnimation.retargetCalls.map(call => call.properties.endValue),
        [1, 1.04]
    );
    assert.deepEqual(
        hoverAnimation.retargetCalls.map(call => call.properties.endValue),
        [0, 1]
    );
    assert.ok(scaleAnimation.retargetCalls.every(call => call.speedEasing === false));
    assert.ok(hoverAnimation.retargetCalls.every(call => call.speedEasing === false));
    assert.ok(scaleAnimation.retargetCalls.every(
        call => !Object.prototype.hasOwnProperty.call(call.properties, 'animationCategory')
    ));
    assert.ok(hoverAnimation.retargetCalls.every(
        call => !Object.prototype.hasOwnProperty.call(call.properties, 'animationCategory')
    ));

    element.setInteraction(true, true);
    assert.equal(element.isPressed, true);
    element.setInteraction(true, false);
    assert.equal(element.isPressed, false);
    assert.deepEqual(
        scaleAnimation.retargetCalls.map(call => call.properties.endValue),
        [1, 1.04, 0.96, 1.04]
    );

    element.reset();
    assert.equal(scaleAnimation.removeCount, 1);
    assert.equal(hoverAnimation.removeCount, 1);
    assert.equal(element.scaleAnimId, -1);
    assert.equal(element.hoverAnimId, -1);
});
