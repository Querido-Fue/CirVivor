import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../script/module/ui/element/_dropdown.js', import.meta.url),
    'utf8'
);

const animations = [];
const renderCalls = [];
let nextAnimationId = 1;

class BaseUIElementStub {
    constructor() {
        Object.assign(this, {
            id: 'dropdown', layer: 'ui', x: 0, y: 0, scale: 1,
            alpha: 1, visible: true, hoverValue: 0
        });
    }

    init(properties = {}) { Object.assign(this, properties); }
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
        id: nextAnimationId++, properties, completed: false,
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

const colors = {
    Overlay: {
        Segment: { Background: '#bg', TextInactive: '#muted', TextActive: '#active' },
        Control: { Hover: '#hover' },
        Panel: { GlassBackground: '#panel', Background: '#panel', Divider: '#line', Border: '#line' },
        Text: { Control: '#icon' }
    }
};
const context = vm.createContext({ console });
const dropdownModule = new vm.SourceTextModule(source, { context, identifier: '_dropdown.js' });
const dependencies = new Map([
    ['./_base_element.js', createSyntheticModule(context, { BaseUIElement: BaseUIElementStub })],
    ['animation/animation_system.js', createSyntheticModule(context, { animate, remove })],
    ['display/display_system.js', createSyntheticModule(context, {
        render: (_layer, command) => renderCalls.push({ ...command }),
        shadowOn: () => {}, shadowOff: () => {}, measureText: (text) => text.length * 8
    })],
    ['input/input_system.js', createSyntheticModule(context, {
        consumeMouseState: () => {}, getMouseInput: () => 0, getMouseFocus: () => ['ui'],
        hasMouseState: () => false, isMousePressing: () => false
    })],
    ['display/_theme_handler.js', createSyntheticModule(context, { ColorSchemes: colors })],
    ['util/color_util.js', createSyntheticModule(context, {
        colorUtil: () => ({
            lerpColor: (start) => start,
            cssToRgb: () => ({ r: 0, g: 0, b: 0, a: 1 })
        }),
        formatRgba: () => 'rgba(0, 0, 0, 1)'
    })],
    ['util/font_util.js', createSyntheticModule(context, {
        createFontString: () => '12px sans-serif',
        truncateTextToWidth: (text) => text
    })],
    ['data/data_handler.js', createSyntheticModule(context, {
        getData: () => ({ FLOATING_DROPDOWN_BLUR_RADIUS: 0.1 })
    })]
]);

await dropdownModule.link((specifier) => dependencies.get(specifier));
await dropdownModule.evaluate();

const { DropdownElement } = dropdownModule.namespace;
const dropdown = new DropdownElement({
    layer: 'ui', width: 200, height: 36,
    items: [
        { label: 'Original', value: 'original' },
        { label: 'Changed', value: 'changed' }
    ],
    value: 'changed'
});

const rollbackPromise = dropdown.animateToValue('original', {
    duration: 0.4,
    easing: 'easeOutExpo'
});
assert.equal(dropdown.value, 'original');
assert.deepEqual({ ...animations[0].properties }, {
    variable: 'selectionProgress',
    startValue: 0,
    endValue: 1,
    duration: 0.4,
    type: 'easeOutExpo'
});

dropdown.selectionProgress = 0.5;
dropdown.draw();
const labels = renderCalls.filter((command) => command.shape === 'text');
assert.deepEqual(labels.map(({ text, alpha }) => ({ text, alpha })), [
    { text: 'Changed', alpha: 0.5 },
    { text: 'Original', alpha: 0.5 }
]);

animations[0].finish();
await rollbackPromise;
renderCalls.length = 0;
dropdown.draw();
const finalLabels = renderCalls.filter((command) => command.shape === 'text');
assert.deepEqual(finalLabels.map(({ text, alpha }) => ({ text, alpha })), [
    { text: 'Original', alpha: 1 }
]);

console.log('dropdown selection animation contract: ok');
