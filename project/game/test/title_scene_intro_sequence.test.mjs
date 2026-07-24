import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../script/module/scene/title/_title_scene_intro_sequence.js', import.meta.url),
    'utf8'
);
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(source, {
    context,
    identifier: '_title_scene_intro_sequence.js'
});

const animationCalls = [];
const removedAnimationIds = [];
const animationModule = new vm.SyntheticModule(['animateMixed', 'remove'], function init() {
    this.setExport('animateMixed', (owner, definitions) => {
        animationCalls.push({ owner, definitions });
        return { ids: animationCalls.length === 1 ? [11] : [12] };
    });
    this.setExport('remove', (animationId) => removedAnimationIds.push(animationId));
}, { context });
const titleLoading = {
    SCENE_TRANSITION_MOTION: {},
    GLOW_COMPENSATION_SCALE: 1.25,
    MINI_CIRCLE_SCALE: 0.75
};
const dataModule = new vm.SyntheticModule(['getData'], function init() {
    this.setExport('getData', () => ({ TITLE_LOADING: titleLoading }));
}, { context });
const displayModule = new vm.SyntheticModule(
    ['getUIOffsetX', 'getUIWW', 'getWH'],
    function init() {
        this.setExport('getUIOffsetX', () => 10);
        this.setExport('getUIWW', () => 900);
        this.setExport('getWH', () => 600);
    },
    { context }
);
class TitleSceneContentStub {
    constructor(assets) {
        this.assets = assets;
    }
}
const contentModule = new vm.SyntheticModule(['TitleSceneContent'], function init() {
    this.setExport('TitleSceneContent', TitleSceneContentStub);
}, { context });
const placementModule = new vm.SyntheticModule(['buildTitleLoadingLogoPlacement'], function init() {
    this.setExport('buildTitleLoadingLogoPlacement', ({ sceneTransitionProgress }) => ({
        progress: sceneTransitionProgress
    }));
}, { context });
const themeModule = new vm.SyntheticModule(['getLoadingLogoColor'], function init() {
    this.setExport('getLoadingLogoColor', () => '#fff');
}, { context });
const transitionSegments = [{ startValue: 0, endValue: 0.2 }];
const transitionModule = new vm.SyntheticModule(['buildTitleSceneTransitionSegments'], function init() {
    this.setExport('buildTitleSceneTransitionSegments', () => transitionSegments);
}, { context });
const dependencyModules = new Map([
    ['animation/animation_system.js', animationModule],
    ['data/data_handler.js', dataModule],
    ['display/display_system.js', displayModule],
    ['./_title_scene_content.js', contentModule],
    ['./loading/_title_loading_logo_placement.js', placementModule],
    ['./loading/_title_loading_theme.js', themeModule],
    ['./loading/_title_scene_transition_segments.js', transitionModule]
]);
await module.link((specifier) => dependencyModules.get(specifier));
await module.evaluate();

const circleTrace = [];
const logoTrace = [];
const menuTrace = [];
const centerCircle = {
    glowCompensationScale: 1,
    update: () => circleTrace.push('update'),
    draw: () => circleTrace.push('draw'),
    resize: () => circleTrace.push('resize'),
    setVisualScale: (value) => circleTrace.push(['scale', value]),
    setPlacementProgress: (value) => circleTrace.push(['placement', value]),
    getCircleLayout: () => ({ centerX: 100, centerY: 200, radius: 50 }),
    destroy: () => circleTrace.push('destroy')
};
const titleLogo = {
    update: () => logoTrace.push('update'),
    draw: () => logoTrace.push('draw'),
    resize: () => logoTrace.push('resize'),
    setPlacement: (value) => logoTrace.push(['placement', value.progress]),
    setColor: (value) => logoTrace.push(['color', value]),
    destroy: () => logoTrace.push('destroy')
};
const titleMenu = {
    pointerEnabled: false,
    update: () => menuTrace.push('update'),
    draw: () => menuTrace.push('draw'),
    resize: () => menuTrace.push('resize'),
    applyRuntimeSettings: (value) => menuTrace.push(['settings', value]),
    destroy: () => menuTrace.push('destroy')
};

const { TitleSceneIntroSequence } = module.namespace;
const sequence = new TitleSceneIntroSequence({}, {
    centerCircle,
    titleLogo,
    titleMenu,
    centerIntroBlurAnimId: 7
});
assert.equal(animationCalls.length, 2);
assert.strictEqual(animationCalls[0].owner, sequence);
assert.strictEqual(animationCalls[1].owner, centerCircle);
assert.equal(sequence.sceneTransitionProgress, 0);
assert.equal(sequence.isEnemySpawnReady(), false);
sequence.sceneTransitionProgress = 0.2;
assert.equal(sequence.isEnemySpawnReady(), true);

sequence.update();
assert.deepEqual(circleTrace, ['update', ['scale', 0.75], ['placement', 0.2]]);
assert.deepEqual(logoTrace, ['update', ['placement', 0.2]]);
assert.deepEqual(menuTrace, ['update']);
assert.equal(sequence.releaseCompletedContent(), null);

sequence.sceneTransitionProgress = 1;
titleMenu.pointerEnabled = true;
const completedContent = sequence.releaseCompletedContent();
assert.ok(completedContent instanceof TitleSceneContentStub);
assert.strictEqual(completedContent.assets.centerCircle, centerCircle);
assert.strictEqual(completedContent.assets.titleLogo, titleLogo);
assert.strictEqual(completedContent.assets.titleMenu, titleMenu);
assert.deepEqual(removedAnimationIds, [7, 11, 12]);

sequence.destroy();
assert.deepEqual(removedAnimationIds, [7, 11, 12]);
assert.doesNotMatch(circleTrace.join(','), /destroy/);
assert.doesNotMatch(logoTrace.join(','), /destroy/);
assert.doesNotMatch(menuTrace.join(','), /destroy/);

console.log('title scene intro sequence contract: ok');
