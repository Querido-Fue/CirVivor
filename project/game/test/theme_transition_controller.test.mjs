import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [source, displaySystemSource] = await Promise.all([
    readFile(new URL('../script/module/display/_theme_transition_controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/display/display_system.js', import.meta.url), 'utf8')
]);

const transitionData = Object.freeze({
    LAYER: 'top', START_ALPHA: 1, END_ALPHA: 0, DURATION_SECONDS: 0.4, EASING: 'easeOutExpo'
});
const animations = [];
let nextAnimationId = 1;

function animate(owner, properties) {
    let resolve;
    const animation = {
        id: nextAnimationId++, owner, properties,
        promise: new Promise((done) => { resolve = done; }),
        complete() { owner[properties.variable] = properties.endValue; resolve(); }
    };
    animations.push(animation);
    return animation;
}

function remove(id) {
    animations.find((animation) => animation.id === id)?.complete();
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
}

const context = vm.createContext({ console });
const controllerModule = new vm.SourceTextModule(source, { context, identifier: '_theme_transition_controller.js' });
const dependencies = new Map([
    ['animation/animation_system.js', createSyntheticModule(context, { animate, remove })],
    ['data/data_handler.js', createSyntheticModule(context, {
        getData: (key) => key === 'THEME_TRANSITION_DATA' ? transitionData : undefined
    })]
]);
await controllerModule.link((specifier) => dependencies.get(specifier));
await controllerModule.evaluate();

const { ThemeTransitionController, beginThemeTransition } = controllerModule.namespace;
assert.equal(beginThemeTransition('#111111'), false);
const draws = [];
const controller = new ThemeTransitionController({
    render(layer, command) { draws.push({ layer, command: { ...command } }); },
    getWidth: () => 1280,
    getHeight: () => 720
});

assert.equal(controller.start(''), false);
assert.equal(controller.start('#111111'), true);
assert.deepEqual({ ...animations[0].properties }, {
    variable: 'alpha', startValue: 1, endValue: 0, duration: 0.4, type: 'easeOutExpo'
});
controller.draw();
assert.deepEqual(draws.at(-1), {
    layer: 'top',
    command: { shape: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: '#111111', alpha: 1 }
});

assert.equal(beginThemeTransition('#eeeeee'), true);
await Promise.resolve();
controller.draw();
assert.equal(controller.active, true);
assert.equal(draws.at(-1).command.fill, '#eeeeee');
animations[1].complete();
await Promise.resolve();
assert.equal(controller.active, false);

assert.doesNotMatch(source, /captureFrame|shape:\s*'image'|snapshot/i);
assert.doesNotMatch(displaySystemSource, /ThemeTransitionSnapshot|captureFrame|themeTransitionSnapshotRequested/);
assert.match(
    displaySystemSource,
    /new ThemeTransitionController\(\{[\s\S]*?render: \(layer, command\) => this\.drawHandler\.render\(layer, command\),[\s\S]*?getWidth: \(\) => this\.screenHandler\.width,[\s\S]*?getHeight: \(\) => this\.screenHandler\.height/
);

console.log('theme transition controller contract: ok');
