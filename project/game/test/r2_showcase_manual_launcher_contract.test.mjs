import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    createManualShowcaseLaunchConfig
} from './support/run_nw_r2_showcase_manual.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIRECTORY = path.resolve(TEST_DIRECTORY, '..');

async function readGameFile(relativePath) {
    return readFile(path.join(GAME_DIRECTORY, relativePath), 'utf8');
}

test('manual showcase NW package는 production main 위에 visible test-only bootstrap을 설치한다', async () => {
    const packageJson = JSON.parse(await readGameFile(
        'test/nw_r2_showcase_manual/package.json'
    ));
    const indexSource = await readGameFile(
        'test/nw_r2_showcase_manual/index.html'
    );
    assert.equal(
        packageJson.main,
        'game/test/nw_r2_showcase_manual/index.html'
    );
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.window.show, true);
    assert.ok(packageJson.window.width >= 1280);
    assert.ok(packageJson.window.height >= 720);
    assert.match(packageJson.window.title, /Post-R2 S1 Manual Showcase/);
    assert.match(indexSource, /<base href="\.\.\/\.\.\/">/);
    assert.match(indexSource, /src="\.\/script\/main\.js"/);
    assert.match(indexSource, /src="\.\/script\/nw-setup\.js"/);
    assert.match(
        indexSource,
        /src="\.\/test\/nw_r2_showcase_manual\/bootstrap\.js"/
    );
    assert.ok(
        indexSource.indexOf('./script/main.js')
            < indexSource.indexOf('./test/nw_r2_showcase_manual/bootstrap.js')
    );
});

test('manual launcher는 actual GameScene과 injection-only 3-wave content를 사용한다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    assert.match(source, /import \{ GameScene \} from 'scene\/game\/_game_scene\.js'/);
    assert.match(source, /new TileMap\(R2_ENEMY_SHOWCASE_MAP_DATA\)/);
    assert.match(source, /new GameScene\(this\.sceneSystem, \{/);
    assert.match(source, /waveDefinition/);
    assert.match(source, /R2_ENEMY_SHOWCASE_WAVES\[waveNumber - 1\]/);
    assert.match(source, /actualGameScene: this\.currentScene instanceof GameScene/);
    assert.doesNotMatch(source, /INGAME_MAP_DATA|gameStart\(/);
});

test('manual launcher는 production WebGPU platform ready 뒤에만 GameScene을 만든다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    assert.match(
        source,
        /import \{ getWebGpuPlatformPort \} from 'display\/display_system\.js'/
    );
    const waitStart = source.indexOf('\nfunction waitForGame() {');
    const requireWaveStart = source.indexOf('\nfunction requireWaveNumber', waitStart);
    const installStart = source.indexOf(
        '\nexport async function installR2ShowcaseManualLauncher() {'
    );
    const controllerStartIndex = source.indexOf(
        'new R2ShowcaseManualController(game, panel).start()',
        installStart
    );
    assert.ok(waitStart >= 0);
    assert.ok(requireWaveStart > waitStart);
    assert.ok(installStart > requireWaveStart);
    const waitSource = source.slice(waitStart, requireWaveStart);
    assert.match(
        waitSource,
        /const sceneSystem = game\?\.systemHandler\?\.sceneSystem/
    );
    assert.match(waitSource, /const platformPort = getWebGpuPlatformPort\(\)/);
    assert.match(waitSource, /const platformState = platformPort\?\.getState\?\.\(\)/);
    assert.match(waitSource, /sceneSystem\?\.sceneState === 'title'/);
    assert.match(waitSource, /platformState\?\.ready === true/);
    assert.match(source.slice(installStart), /const game = await waitForGame\(\)/);
    assert.ok(
        controllerStartIndex > source.indexOf('await waitForGame()', installStart)
    );
});

test('타이틀의 기존 게임 시작 action이 injection-only Wave 1을 one-shot으로 연다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    const startIndex = source.indexOf('\n    start() {');
    const selectWaveIndex = source.indexOf('\n    selectWave(value) {', startIndex);
    const routeIndex = source.indexOf('\n    #startShowcaseFromTitle(mapId) {');
    const restoreIndex = source.indexOf('\n    #restoreTitleStartRoute() {', routeIndex);
    assert.ok(startIndex >= 0);
    assert.ok(selectWaveIndex > startIndex);
    assert.ok(routeIndex > selectWaveIndex);
    assert.ok(restoreIndex > routeIndex);
    const startSource = source.slice(startIndex, selectWaveIndex);
    const routeSource = source.slice(routeIndex, restoreIndex);
    assert.match(startSource, /this\.sceneSystem\.gameStart = this\.titleStartRoute/);
    assert.doesNotMatch(startSource, /this\.selectWave\(1\)/);
    assert.match(startSource, /타이틀의 게임 시작 버튼/);
    assert.match(routeSource, /this\.#restoreTitleStartRoute\(\)/);
    assert.match(routeSource, /this\.showcaseReady = false/);
    assert.match(routeSource, /this\.#setShowcaseControlsEnabled\(false\)/);
    assert.match(routeSource, /this\.selectWave\(1\)/);
    assert.match(routeSource, /title-game-start-routed/);
    assert.match(source, /delete this\.sceneSystem\.gameStart/);
    assert.doesNotMatch(source, /gameStart\s*\(mapId\)\s*\{/);
});

test('visible controls는 SendInput click, pause epoch, camera, bounded evidence를 노출한다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    for (const controlId of [
        'r2-manual-wave-1',
        'r2-manual-wave-2',
        'r2-manual-wave-3',
        'r2-manual-pause',
        'r2-manual-resume',
        'r2-manual-camera-fit',
        'r2-manual-camera-follow',
        'r2-manual-camera-zoom-in',
        'r2-manual-camera-zoom-out',
        'r2-manual-tower-lethal',
        'r2-manual-core-defeat',
        'r2-manual-capture',
        'r2-manual-safe-exit'
    ]) {
        assert.match(source, new RegExp(`id="${controlId}"`));
        assert.match(source, new RegExp(`bind\\('${controlId}'`));
    }
    assert.match(source, /WASD\/방향키/);
    assert.match(source, /LMB 누르기/);
    assert.match(source, /runFixedStep: false/);
    assert.match(source, /keepLoopRunning: true/);
    assert.match(source, /presentation synchronization 완료/);
    assert.match(source, /appWindow\.show\(\)/);
    assert.match(source, /appWindow\.focus\(\)/);
    assert.match(source, /window\.focus\(\)/);
    assert.match(source, /game\?\.start\?\.\(\)/);
    assert.match(source, /APP_INACTIVE_PAUSE_REASON = 'app-inactive'/);
    assert.match(source, /windowFocused: document\.hasFocus\(\)/);
    assert.match(source, /loopRunning: this\.game\.running === true/);
    assert.match(source, /getFrameExecutionPolicy\(\)/);
    assert.match(source, /this\.game\.systemHandler\.pauseReasons\.keys\(\)/);
    assert.match(source, /endpoint\.lifecycle\?\.lastCommitResult/);
    assert.match(source, /backendGpuState: endpoint\.backend\?\.gpu\?\.state/);
    assert.match(source, /includes\('프레임 루프 중 오류'\)/);
    assert.match(source, /console\.warn = this\.loopWarningCapture/);
    assert.match(source, /console\.warn = this\.originalConsoleWarn/);
    assert.match(source, /status\.fixedTick === 0/);
    assert.match(source, /status\.endpoint\.runtimeState === 'gpu-deferred'/);
    assert.match(source, /T0 first-submit pending/);
    assert.match(source, /status\.fixedTick > 0/);
    assert.match(source, /status\.endpoint\.runtimeState === 'gpu-ready'/);
    assert.match(source, /showcase-gpu-ready/);
    assert.match(source, /button\.id !== 'r2-manual-safe-exit'/);
    assert.match(source, /elapsed=\$\{\(status\.fixedTick \/ 60\)\.toFixed\(1\)\}s/);
    assert.match(source, /const ACTION_HISTORY_CAPACITY = 12/);
    assert.match(source, /while \(this\.actions\.length > ACTION_HISTORY_CAPACITY\)/);
});

test('Tower/Core QA는 상태를 합성하지 않고 canonical intent를 public endpoint에 예약한다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    assert.match(source, /createGpuEnemySpawnIntent\(\{/);
    assert.match(source, /definition: BASIC_CIRCLE_ENEMY_DATA/);
    assert.match(source, /resolveEnemySpawnStats\(\{/);
    assert.match(source, /getNextGpuLifecycleFixedTick\(\)/);
    assert.match(
        source,
        /getGpuSimulationEndpoint\(\)\.requestSpawn\(/
    );
    assert.match(source, /status\.tower\.alive !== false/);
    assert.match(source, /currentHp \+ 1_000_000/);
    assert.match(source, /const CORE_CONTACT_INGRESS_GAP_TILES = 1 \/ 128/);
    assert.match(source, /waypointIndex: targetWaypointIndex/);
    assert.match(source, /THE_CORE_DATA\.RADIUS_TILES/);
    assert.match(source, /createCoreIngressIntent\(baseIntent, route, target\)/);
    assert.doesNotMatch(source, /applyIntegrityDamage\(|transitionToDefeated\(/);
    assert.doesNotMatch(source, /currentIntegrity\s*=|runOutcome\.state\s*=/);
});

test('screenshot은 명시적 action에서만 ignored evidence 경로에 deterministic 이름으로 저장한다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    assert.match(source, /async captureScreenshot\(/);
    assert.match(source, /CIRVIVOR_R2_SHOWCASE_EVIDENCE_DIR/);
    assert.match(source, /wave-\$\{padIdentifier\(snapshot\.waveNumber, 2\)\}/);
    assert.match(source, /tick-\$\{padIdentifier\(snapshot\.fixedTick, 8\)\}/);
    assert.match(source, /action-\$\{padIdentifier\(nextActionSequence, 4\)\}/);
    assert.equal((source.match(/capturePagePng\(\)/g) ?? []).length, 2);
    const controllerStartIndex = source.indexOf('\n    start() {');
    const controllerSelectWaveIndex = source.indexOf('\n    selectWave(value) {');
    assert.ok(controllerStartIndex >= 0);
    assert.ok(controllerSelectWaveIndex > controllerStartIndex);
    assert.doesNotMatch(
        source.slice(controllerStartIndex, controllerSelectWaveIndex),
        /capturePagePng|captureScreenshot/
    );

    const config = createManualShowcaseLaunchConfig();
    assert.equal(
        config.harnessDirectory,
        path.join(GAME_DIRECTORY, 'test', 'nw_r2_showcase_manual')
    );
    assert.equal(
        config.evidenceDirectory,
        path.resolve(
            GAME_DIRECTORY,
            '..',
            '..',
            'plan',
            'post_r2_stabilization',
            'evidence',
            'manual_showcase'
        )
    );
});

test('Safe Exit은 production loop를 먼저 멈추고 beforeunload에서 scene을 정리한다', async () => {
    const source = await readGameFile(
        'test/support/r2_showcase_manual_launcher.js'
    );
    const safeExitStart = source.indexOf('\n    safeExit() {');
    const destroyStart = source.indexOf('\n    destroy() {', safeExitStart);
    assert.ok(safeExitStart >= 0);
    assert.ok(destroyStart > safeExitStart);
    const safeExitSource = source.slice(safeExitStart, destroyStart);
    assert.match(safeExitSource, /this\.game\.close\(\)/);
    assert.doesNotMatch(safeExitSource, /this\.destroy\(\)/);
    assert.match(source, /this\.boundBeforeUnload = \(\) => this\.destroy\(\)/);
    const destroySource = source.slice(
        destroyStart,
        source.indexOf('\n    #getGameSystem()', destroyStart)
    );
    const detachIndex = destroySource.indexOf('this.sceneSystem.scene = null');
    const destroySceneIndex = destroySource.indexOf('scene?.destroy?.()');
    assert.ok(detachIndex >= 0);
    assert.ok(destroySceneIndex > detachIndex);
});

test('runner는 project package root가 아닌 isolated runtime/app만 spawn한다', async () => {
    const source = await readGameFile(
        'test/support/run_nw_r2_showcase_manual.mjs'
    );
    assert.match(source, /prepareIsolatedNwRuntime\(/);
    assert.match(source, /prepareIsolatedHarnessApp\(/);
    assert.match(source, /path\.join\(runDirectory, 'runtime'\)/);
    assert.match(source, /path\.join\(runDirectory, 'app'\)/);
    assert.match(source, /const executablePath = path\.join\(runtimeDirectory, 'nw\.exe'\)/);
    assert.match(source, /child = spawn\(executablePath, \[/);
    assert.match(source, /appDirectory\n        \], \{/);
    assert.match(source, /cwd: runDirectory/);
    assert.match(source, /production package root 직접 실행은 manual harness에서 금지/);
    assert.doesNotMatch(source, /spawn\(config\.sourceExecutablePath/);
    assert.doesNotMatch(source, /cwd: config\.gameDirectory|cwd: config\.projectDirectory/);
    assert.match(source, /NW manual showcase exit:/);
    assert.match(source, /Removed isolated manual showcase run directory:/);
});

test('production map registry와 menu/SceneSystem에는 manual showcase route가 추가되지 않는다', async () => {
    const [mapSource, sceneSystemSource, productionIndex] = await Promise.all([
        readGameFile('script/data/scene/game/corridor_eight_map_data.js'),
        readGameFile('script/module/scene/scene_system.js'),
        readGameFile('index.html')
    ]);
    assert.doesNotMatch(mapSource, /r2_enemy_showcase|manual-showcase/);
    assert.doesNotMatch(sceneSystemSource, /r2_enemy_showcase|manual-showcase/);
    assert.doesNotMatch(productionIndex, /nw_r2_showcase_manual/);
});
