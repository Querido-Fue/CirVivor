import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../script/module/ui/element/_dropdown.js', import.meta.url), 'utf8');
const renderCalls = [];
const glassCalls = [];
const floatingLayerCalls = [];

class BaseUIElementStub {
    constructor() {
        Object.assign(this, {
            id: 'dropdown', layer: 'base-ui', x: 10, y: 20, scale: 1,
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

const colors = {
    Overlay: {
        Segment: { Background: '#segment', TextInactive: '#muted', TextActive: '#active' },
        Control: { Hover: '#hover' },
        Panel: {
            GlassBackground: '#glass', GlassBorder: '#glass-border', GlassTint: '#tint', GlassEdge: '#edge',
            GlassTintStrength: 0.2, GlassEdgeStrength: 0.1, Background: '#opaque', Border: '#opaque-border',
            Divider: '#divider', Shadow: '#shadow'
        },
        Text: { Control: '#icon' }
    }
};
const context = vm.createContext({ console });
const dropdownModule = new vm.SourceTextModule(source, { context, identifier: '_dropdown.js' });
const dependencies = new Map([
    ['./_base_element.js', createSyntheticModule(context, { BaseUIElement: BaseUIElementStub })],
    ['animation/animation_system.js', createSyntheticModule(context, { animate: () => ({ id: 1, promise: Promise.resolve() }), remove: () => {} })],
    ['display/display_system.js', createSyntheticModule(context, {
        render: (layer, command) => renderCalls.push({ layer, command: { ...command } }),
        shadowOn: () => {}, shadowOff: () => {}, measureText: (text) => text.length * 8
    })],
    ['input/input_system.js', createSyntheticModule(context, {
        consumeMouseState: () => {}, getMouseInput: () => 0, getMouseFocus: () => ['base-ui'],
        hasMouseState: () => false, isMousePressing: () => false
    })],
    ['display/_theme_handler.js', createSyntheticModule(context, { ColorSchemes: colors })],
    ['util/color_util.js', createSyntheticModule(context, { colorUtil: () => ({ lerpColor: (value) => value }) })],
    ['util/font_util.js', createSyntheticModule(context, {
        createFontString: () => '12px sans-serif', truncateTextToWidth: (text) => text
    })],
    ['data/data_handler.js', createSyntheticModule(context, {
        getData: () => ({ FLOATING_DROPDOWN_BLUR_RADIUS: 18 })
    })]
]);
await dropdownModule.link((specifier) => dependencies.get(specifier));
await dropdownModule.evaluate();

const { DropdownElement } = dropdownModule.namespace;
const createDropdown = (session) => {
    const dropdown = new DropdownElement({
        parent: { session }, layer: 'base-ui', x: 10, y: 20, width: 200, height: 36,
        items: [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }], value: 'one'
    });
    dropdown.openProgress = 1;
    return dropdown;
};

const glassSession = {
    getGlassMix: () => 1,
    renderFloatingGlassPanel(command) { glassCalls.push({ ...command }); return true; },
    getFloatingUILayerId() { floatingLayerCalls.push('called'); return 'floating-ui'; },
    uiLayerId: 'session-ui'
};
createDropdown(glassSession).drawFloating();
assert.equal(glassCalls.length, 1);
assert.equal(glassCalls[0].blur, 18);
assert.equal(glassCalls[0].sampleBackdrop, undefined);
assert.deepEqual(floatingLayerCalls, ['called']);
assert.ok(renderCalls.length > 0);
assert.ok(renderCalls.every(({ layer }) => layer === 'floating-ui'));
assert.equal(renderCalls.some(({ command }) => command.shape === 'roundRect'), false);

renderCalls.length = 0;
glassCalls.length = 0;
floatingLayerCalls.length = 0;
const opaqueSession = {
    getGlassMix: () => 0,
    renderFloatingGlassPanel(command) { glassCalls.push({ ...command }); return true; },
    getFloatingUILayerId() { floatingLayerCalls.push('called'); return 'floating-ui'; },
    uiLayerId: 'session-ui'
};
createDropdown(opaqueSession).drawFloating();
assert.equal(glassCalls.length, 0);
assert.deepEqual(floatingLayerCalls, []);
const opaquePanel = renderCalls.find(({ command }) => command.shape === 'roundRect');
assert.equal(opaquePanel.layer, 'session-ui');
assert.equal(opaquePanel.command.fill, '#opaque');

console.log('dropdown backdrop glass contract: ok');
