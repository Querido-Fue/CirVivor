import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function createHarness() {
    const animations = [];
    const draws = [];
    const pointer = { x: 180, y: 20, clicked: true };
    const context = vm.createContext({ crypto, console });
    const synthetic = (exports) => new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
    const dependencies = new Map([
        ['animation/animation_system.js', synthetic({
            ANIMATION_CATEGORY: { UI: 'ui' },
            animate(owner, properties) {
                const handle = {
                    id: animations.length, active: true, retargets: 0,
                    target: properties.endValue,
                    isActive() { return this.active; },
                    retarget(next) { this.target = next.endValue; this.retargets++; return true; },
                    remove() { this.active = false; },
                    finish() {
                        if (this.active) owner[properties.variable] = this.target;
                        this.active = false;
                    }
                };
                animations.push(handle);
                return handle;
            }
        })],
        ['ui/ui_system.js', synthetic({ requestTooltip() {} })],
        ['display/display_system.js', synthetic({
            render: (_layer, command) => draws.push(command), shadowOn() {}, shadowOff() {}
        })],
        ['input/input_system.js', synthetic({
            getMouseInput: (axis) => pointer[axis], getMouseFocus: () => ['ui'],
            hasMouseState: () => pointer.clicked, isMousePressing: () => false
        })],
        ['display/_theme_handler.js', synthetic({ ColorSchemes: { Overlay: { Segment: {} } } })],
        ['./_dropdown.js', synthetic({ DropdownElement: { isPointerBlockedFor: () => false } })],
        ['util/font_util.js', synthetic({ createFontString: () => '12px sans-serif' })]
    ]);
    for (const file of ['_base_element.js', '_segment_control.js']) {
        const url = new URL(`../project/game/script/module/ui/element/${file}`, import.meta.url);
        const module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
        await module.link((specifier) => dependencies.get(specifier));
        await module.evaluate();
        dependencies.set(`./${file}`, module);
    }
    return { Element: dependencies.get('./_segment_control.js').namespace.SegmentControlElement,
        animations, draws, pointer };
}

const items = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }];

test('segment initialization displays the selected item without a stale animation', async () => {
    const { Element, animations, draws } = await createHarness();
    const element = new Element({ layer: 'ui', items, value: 'b' });
    assert.equal(element.selectionProgress, 1);
    assert.equal(animations.length, 0);
    element.draw();
    assert.ok(draws.length > 0);
    for (const command of draws) {
        for (const value of Object.values(command)) {
            if (typeof value === 'number') assert.ok(Number.isFinite(value));
        }
    }
});

test('rapid segment changes reuse one animation and pool reset retires it', async () => {
    const { Element, animations } = await createHarness();
    const element = new Element({ layer: 'ui', items, value: 'a', parent: { session: {} } });
    element.value = 'b';
    element.selectionProgress = 0.5;
    element.value = 'c';
    assert.equal(animations.length, 1);
    assert.equal(animations[0].retargets, 1);
    assert.equal(element.selectionProgress, 0.5);
    element.reset();
    assert.equal(animations[0].active, false);
    assert.equal(element.parent, null);
    assert.equal(element.items.length, 0);
    assert.equal(element.value, null);
    element.init({ layer: 'ui', items, value: 'b' });
    animations[0].finish();
    assert.equal(element.selectionProgress, 1);
    assert.equal(element.value, 'b');
});

test('empty and disabled segments ignore pointer selection safely', async () => {
    const { Element, animations, draws } = await createHarness();
    const empty = new Element({ layer: 'ui', items: [] });
    assert.doesNotThrow(() => { empty.update(); empty.draw(); });
    assert.equal(draws.length, 0);
    let changes = 0;
    const disabled = new Element({ layer: 'ui', items, value: 'a', clickAble: false,
        onChange: () => changes++ });
    disabled.update();
    assert.equal(disabled.value, 'a');
    assert.equal(changes, 0);
    assert.equal(animations.length, 0);
});
