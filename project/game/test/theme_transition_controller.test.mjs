import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ANIMATION_CATEGORY = Object.freeze({ EFFECT: 'effect' });

const [source, displaySystemSource, colorUtilSource] = await Promise.all([
    readFile(new URL('../script/module/display/_theme_transition_controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/display/display_system.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/util/color_util.js', import.meta.url), 'utf8')
]);

const animations = [];
let nextAnimationId = 1;

function animate(owner, properties) {
    let resolve;
    const animation = {
        id: nextAnimationId++, owner, properties,
        promise: new Promise((done) => { resolve = done; }),
        setProgress(progress) {
            owner[properties.variable] = properties.startValue
                + ((properties.endValue - properties.startValue) * progress);
        },
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
const colorUtilModule = new vm.SourceTextModule(colorUtilSource, {
    context,
    identifier: 'color_util.js'
});
await colorUtilModule.link(() => {
    throw new Error('color_util.js에는 외부 import가 없어야 합니다.');
});
await colorUtilModule.evaluate();
new colorUtilModule.namespace.ColorUtil();

const controllerModule = new vm.SourceTextModule(source, { context, identifier: '_theme_transition_controller.js' });
const dependencies = new Map([
    ['animation/animation_system.js', createSyntheticModule(context, {
        ANIMATION_CATEGORY,
        animate,
        remove
    })],
    ['util/color_util.js', colorUtilModule]
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
    animationCategory: ANIMATION_CATEGORY.EFFECT,
    variable: 'alpha', startValue: 0.82, endValue: 0, duration: 0.4, type: 'linear'
});
controller.draw();
assert.deepEqual(draws.at(-1), {
    layer: 'top',
    command: { shape: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: '#111111', alpha: 0.82 }
});
animations[0].setProgress(0.5);
controller.draw();
assert.equal(draws.at(-1).command.alpha, 0.41);

assert.equal(beginThemeTransition('#d2d2d2ff'), true);
await Promise.resolve();
controller.draw();
assert.equal(controller.active, true);
assert.equal(draws.at(-1).command.fill, '#d2d2d2ff');
assert.equal(draws.at(-1).command.alpha, 0.55);
assert.equal(animations[1].properties.startValue, 0.55);
animations[1].complete();
await Promise.resolve();
assert.equal(controller.active, false);

assert.equal(controller.start('rgba(236, 237, 239, 0.92)'), true);
assert.equal(animations[2].properties.startValue, 0.55);
animations[2].complete();
await Promise.resolve();
assert.equal(controller.active, false);

assert.doesNotMatch(source, /captureFrame|shape:\s*'image'|snapshot/i);
assert.doesNotMatch(displaySystemSource, /ThemeTransitionSnapshot|captureFrame|themeTransitionSnapshotRequested/);
assert.match(
    displaySystemSource,
    /new ThemeTransitionController\(\{[\s\S]*?render: \(layer, command\) => this\.drawHandler\.render\(layer, command\),[\s\S]*?getWidth: \(\) => this\.screenHandler\.width,[\s\S]*?getHeight: \(\) => this\.screenHandler\.height/
);

console.log('theme transition controller contract: ok');
