import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ANIMATION_CATEGORY = Object.freeze({ UI: 'ui' });

const source = await readFile(
    new URL('../script/module/ui/element/_toggle.js', import.meta.url),
    'utf8'
);

const animations = [];
const renderCalls = [];
let nextAnimationId = 1;

class BaseUIElementStub {
    constructor(properties = {}) {
        Object.assign(this, {
            id: 'toggle', layer: 'ui', x: 0, y: 0, scale: 1,
            alpha: 1, visible: true
        }, properties);
    }

    init(properties = {}) {
        Object.assign(this, properties);
    }

    reset() {}
    _handleInteractionState() {}
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
}

function animate(owner, properties) {
    let resolve;
    const animation = {
        id: nextAnimationId++, owner, properties, completed: false,
        promise: new Promise((done) => { resolve = done; }),
        finish(applyEndValue = true) {
            if (this.completed) return;
            this.completed = true;
            if (applyEndValue) owner[properties.variable] = properties.endValue;
            resolve();
        }
    };
    animations.push(animation);
    return animation;
}

function remove(id) {
    animations.find((animation) => animation.id === id)?.finish(false);
}

const context = vm.createContext({ console });
const toggleModule = new vm.SourceTextModule(source, { context, identifier: '_toggle.js' });
const dependencies = new Map([
    ['./_base_element.js', createSyntheticModule(context, { BaseUIElement: BaseUIElementStub })],
    ['display/display_system.js', createSyntheticModule(context, {
        render: (_layer, command) => renderCalls.push({ ...command }),
        shadowOn: () => {},
        shadowOff: () => {}
    })],
    ['input/input_system.js', createSyntheticModule(context, {
        getMouseInput: () => 0,
        getMouseFocus: () => ['ui'],
        hasMouseState: () => false,
        isMousePressing: () => false
    })],
    ['display/_theme_handler.js', createSyntheticModule(context, {
        ColorSchemes: { Overlay: { Toggle: {
            Active: '#0000ff', Inactive: '#808080', Knob: '#ffffff', Shadow: '#000000'
        } } }
    })],
    ['animation/animation_system.js', createSyntheticModule(context, {
        ANIMATION_CATEGORY,
        animate,
        remove
    })],
    ['util/color_util.js', createSyntheticModule(context, {
        colorUtil: () => ({
            cssToRgb: (color) => color === '#0000ff'
                ? { r: 0, g: 0, b: 255, a: 1 }
                : { r: 128, g: 128, b: 128, a: 1 }
        }),
        formatRgba: (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a})`
    })],
    ['util/number_util.js', createSyntheticModule(context, {
        clamp01: (value) => Math.min(1, Math.max(0, value))
    })],
    ['./_dropdown.js', createSyntheticModule(context, {
        DropdownElement: class DropdownElementStub {
            static isPointerBlockedFor() { return false; }
        }
    })]
]);

await toggleModule.link((specifier) => dependencies.get(specifier));
await toggleModule.evaluate();

const { ToggleElement } = toggleModule.namespace;
const changes = [];
const toggle = new ToggleElement({
    layer: 'ui', x: 0, y: 0, width: 60, height: 30, value: false,
    onChange: (value) => changes.push(value)
});

toggle.setValue(true);
assert.deepEqual(changes, [true]);
assert.deepEqual({ ...animations[0].properties }, {
    animationCategory: ANIMATION_CATEGORY.UI,
    variable: 'animValue',
    startValue: 'current',
    endValue: 1,
    duration: 0.32,
    type: 'easeOutExpo'
});

const drawKnobAt = (progress) => {
    toggle.animValue = progress;
    renderCalls.length = 0;
    toggle.draw();
    return renderCalls.find((command) => command.shape === 'circle');
};

assert.deepEqual(
    { x: drawKnobAt(0).x, radius: drawKnobAt(0).radius },
    { x: 15, radius: 12 }
);
assert.deepEqual(
    { x: drawKnobAt(0.5).x, radius: drawKnobAt(0.5).radius },
    { x: 30, radius: 7.199999999999999 }
);
assert.deepEqual(
    { x: drawKnobAt(1).x, radius: drawKnobAt(1).radius },
    { x: 45, radius: 12 }
);

toggle.animValue = 0.6;
toggle.setValue(false);
assert.equal(animations[0].completed, true);
assert.equal(animations[1].properties.startValue, 'current');
assert.equal(animations[1].properties.endValue, 0);

const rollbackPromise = toggle.animateToValue(true, {
    duration: 0.4,
    easing: 'easeOutExpo',
    notify: false
});
assert.deepEqual(changes, [true, false]);
assert.deepEqual({ ...animations[2].properties }, {
    animationCategory: ANIMATION_CATEGORY.UI,
    variable: 'animValue',
    startValue: 'current',
    endValue: 1,
    duration: 0.4,
    type: 'easeOutExpo'
});
animations[2].finish();
await rollbackPromise;
assert.equal(toggle.animValue, 1);

console.log('toggle animation contract: ok');
