import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../script/module/ui/element/_slider.js', import.meta.url),
    'utf8'
);

const mouse = {
    x: 0,
    y: 8,
    pressing: false,
    click: false
};
const renderCalls = [];
const animations = [];
let nextAnimationId = 1;

class BaseUIElementStub {
    constructor(properties = {}) {
        Object.assign(this, {
            id: 'slider',
            layer: 'ui',
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            scale: 1,
            alpha: 1,
            visible: true,
            clickAble: true,
            isPressed: false,
            hoverValue: 0
        }, properties);
    }

    init(properties = {}) {
        Object.assign(this, properties);
    }

    reset() {}

    _handleInteractionState(isHovered, isPressed) {
        this.hoverValue = isHovered ? 1 : 0;
        this.isPressed = isPressed;
    }
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context });
}

function animate(owner, properties) {
    let resolvePromise;
    const animation = {
        id: nextAnimationId++,
        owner,
        properties: { ...properties },
        retargets: [],
        completed: false,
        promise: new Promise((resolve) => {
            resolvePromise = resolve;
        }),
        finish(applyEndValue = true) {
            if (this.completed) return;
            this.completed = true;
            if (applyEndValue) {
                owner[properties.variable] = properties.endValue;
            }
            resolvePromise();
        },
        retarget(nextProperties) {
            if (this.completed) return false;
            this.retargets.push({ ...nextProperties });
            this.properties = {
                ...this.properties,
                startValue: 'current',
                ...nextProperties
            };
            return true;
        }
    };
    animations.push(animation);
    return animation;
}

function remove(id) {
    animations.find((animation) => animation.id === id)?.finish(false);
}

const context = vm.createContext({ console });
const sliderModule = new vm.SourceTextModule(source, {
    context,
    identifier: '_slider.js'
});
const dependencies = new Map([
    ['./_base_element.js', createSyntheticModule(context, { BaseUIElement: BaseUIElementStub })],
    ['display/display_system.js', createSyntheticModule(context, {
        render: (_layer, command) => renderCalls.push(command),
        shadowOn: () => {},
        shadowOff: () => {}
    })],
    ['input/input_system.js', createSyntheticModule(context, {
        getMouseInput: (axis) => mouse[axis],
        getMouseFocus: () => ['ui'],
        hasMouseState: (_button, state) => state === 'click' && mouse.click,
        isMousePressing: () => mouse.pressing
    })],
    ['display/_theme_handler.js', createSyntheticModule(context, {
        ColorSchemes: {
            Overlay: {
                Slider: {
                    ValueActive: '#active',
                    Track: '#track',
                    Knob: '#knob',
                    ValueInactive: '#inactive',
                    Shadow: '#shadow'
                }
            }
        }
    })],
    ['animation/animation_system.js', createSyntheticModule(context, { animate, remove })],
    ['util/color_util.js', createSyntheticModule(context, {
        colorUtil: () => ({ lerpColor: (start) => start })
    })],
    ['util/math_util.js', createSyntheticModule(context, {
        mathUtil: () => ({
            cap: (value, min, max) => Math.min(max, Math.max(min, value)),
            decay: (value, max) => Math.min(value, max)
        })
    })],
    ['util/number_util.js', createSyntheticModule(context, {
        clamp01: (value) => Math.min(1, Math.max(0, value))
    })],
    ['util/font_util.js', createSyntheticModule(context, {
        createFontString: ({ weight, sizePx }) => `${weight} ${sizePx}px "SUIT Variable", arial`
    })],
    ['./_dropdown.js', createSyntheticModule(context, {
        DropdownElement: class DropdownElementStub {
            static isPointerBlockedFor() {
                return false;
            }
        }
    })]
]);

await sliderModule.link((specifier) => dependencies.get(specifier));
await sliderModule.evaluate();

const { SliderElement } = sliderModule.namespace;
const changedValues = [];
const committedValues = [];
let formattedValue = null;
const slider = new SliderElement({
    id: 'ui-scale',
    layer: 'ui',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    trackHeight: 4,
    knobRadius: 2,
    min: 0,
    max: 100,
    value: 20,
    valueFormatter: (value) => {
        formattedValue = value;
        return `${value}%`;
    },
    onChange: (value) => changedValues.push(value),
    onCommit: (value) => committedValues.push(value)
});

assert.equal(slider.value, 20);
assert.equal(slider.displayValue, 20);
slider.animatedValue = 25;
assert.equal(slider.displayValue, 25);
slider.displayValue = 20;
assert.equal(slider.animatedValue, 20);

mouse.x = 80;
mouse.pressing = true;
mouse.click = true;
slider.update();
mouse.click = false;
assert.equal(slider.value, 80);
assert.deepEqual(changedValues, [80]);
assert.deepEqual({ ...animations[0].properties }, {
    variable: 'displayValue',
    startValue: 'current',
    endValue: 80,
    duration: 0.2,
    type: 'easeOutExpo'
});

slider.displayValue = 50.49;
renderCalls.length = 0;
slider.draw();
const knobCommand = renderCalls.find((command) => command.shape === 'circle');
assert.equal(knobCommand.x, 50.49);
assert.equal(formattedValue, 50);

mouse.x = 500;
slider.update();
assert.equal(slider.value, 100);
assert.deepEqual(changedValues, [80, 100]);
assert.equal(animations.length, 1);
assert.equal(animations[0].completed, false);
assert.deepEqual(animations[0].retargets, [{
    endValue: 100,
    duration: 0.2,
    type: 'easeOutExpo'
}]);
assert.equal(animations[0].properties.startValue, 'current');
assert.equal(animations[0].properties.endValue, 100);

const settlePromise = slider.waitForDisplayValueSettle();
animations[0].finish();
await settlePromise;
assert.equal(slider.displayValue, 100);
assert.equal(slider.isDisplayValueSettled(), true);

mouse.pressing = false;
slider.update();
assert.deepEqual(committedValues, [100]);

slider.displayValue = 64;
const rollbackPromise = slider.animateToValue(20, {
    duration: 0.4,
    easing: 'easeOutExpo'
});
const rollbackAnimation = animations.at(-1);
assert.equal(slider.value, 20);
assert.equal(slider.dragging, false);
assert.deepEqual({ ...rollbackAnimation.properties }, {
    variable: 'displayValue',
    startValue: 'current',
    endValue: 20,
    duration: 0.4,
    type: 'easeOutExpo'
});
rollbackAnimation.finish();
await rollbackPromise;
assert.equal(slider.displayValue, 20);

console.log('slider display value contract: ok');
