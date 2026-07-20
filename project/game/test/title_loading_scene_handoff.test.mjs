import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sceneSystemSource = await readFile(
    new URL('../script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
const titleSceneSource = await readFile(
    new URL('../script/module/scene/title/_title_scene.js', import.meta.url),
    'utf8'
);
const loadingSceneSource = await readFile(
    new URL('../script/module/scene/loading/_loading_scene.js', import.meta.url),
    'utf8'
);

assert.match(sceneSystemSource, /new LoadingScene\(this\), SCENE_STATES\.LOADING/);
assert.match(sceneSystemSource, /new TitleScene\(this, handoff\)/);
assert.doesNotMatch(titleSceneSource, /TitleLoadingSequence|new TitleGradientBackground|new TitleBackGround/);
assert.match(loadingSceneSource, /new TitleScenePresentation\(this\.titleController\)/);
assert.match(loadingSceneSource, /releaseTitlePresentation\(\)/);

const trace = [];
class LoadingSceneStub {
    constructor(sceneSystem) {
        this.sceneSystem = sceneSystem;
        this.presentation = { id: 'presentation' };
        this.titleController = { id: 'controller' };
        this.ready = false;
        this.releaseCount = 0;
        this.destroyCount = 0;
    }

    releaseTitlePresentation() {
        this.releaseCount++;
        if (!this.ready) return null;
        return {
            presentation: this.presentation,
            titleController: this.titleController
        };
    }

    destroy() {
        this.destroyCount++;
        trace.push('loading-destroy');
    }
}

class TitleSceneStub {
    constructor(sceneSystem, handoff) {
        this.sceneSystem = sceneSystem;
        this.presentation = handoff.presentation;
        this.titleController = handoff.titleController;
        trace.push('title-create');
    }
}

class GameSceneStub {}
const context = vm.createContext({ console });
const sceneModule = new vm.SourceTextModule(sceneSystemSource, {
    context,
    identifier: 'scene_system.js'
});
const dependencyModules = new Map([
    ['./title/_title_scene.js', new vm.SyntheticModule(['TitleScene'], function init() {
        this.setExport('TitleScene', TitleSceneStub);
    }, { context })],
    ['./loading/_loading_scene.js', new vm.SyntheticModule(['LoadingScene'], function init() {
        this.setExport('LoadingScene', LoadingSceneStub);
    }, { context })],
    ['./game/_game_scene.js', new vm.SyntheticModule(['GAME_SCENE_MODES', 'GameScene'], function init() {
        this.setExport('GAME_SCENE_MODES', { PLAY: 'play', BENCHMARK: 'benchmark' });
        this.setExport('GameScene', GameSceneStub);
    }, { context })],
    ['simulation/simulation_command_queue.js', new vm.SyntheticModule(['clearSimulationCommands'], function init() {
        this.setExport('clearSimulationCommands', () => {});
    }, { context })]
]);

await sceneModule.link((specifier) => dependencyModules.get(specifier));
await sceneModule.evaluate();
const { SceneSystem } = sceneModule.namespace;
const sceneSystem = new SceneSystem({ overlayManager: {} });
await sceneSystem.init();
const loadingScene = sceneSystem.scene;
const presentationIdentity = loadingScene.presentation;
const controllerIdentity = loadingScene.titleController;

assert.equal(sceneSystem.sceneState, 'loading');
assert.equal(sceneSystem.completeLoading({}), false);
assert.strictEqual(sceneSystem.scene, loadingScene);
assert.equal(loadingScene.releaseCount, 0);
assert.equal(sceneSystem.completeLoading(loadingScene), false);
assert.strictEqual(sceneSystem.scene, loadingScene);
assert.equal(loadingScene.releaseCount, 1);

loadingScene.ready = true;
assert.equal(sceneSystem.completeLoading(loadingScene), true);
assert.equal(sceneSystem.sceneState, 'title');
assert.ok(sceneSystem.scene instanceof TitleSceneStub);
assert.strictEqual(sceneSystem.scene.presentation, presentationIdentity);
assert.strictEqual(sceneSystem.scene.titleController, controllerIdentity);
assert.equal(loadingScene.destroyCount, 1);
assert.deepEqual(trace, ['title-create', 'loading-destroy']);
assert.equal(sceneSystem.completeLoading(loadingScene), false);
assert.equal(loadingScene.releaseCount, 2);

console.log('title loading scene handoff contract: ok');
