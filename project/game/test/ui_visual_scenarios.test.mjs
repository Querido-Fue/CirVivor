import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const MANIFEST_URL = new URL('./fixtures/ui_visual/scenarios_v1.json', import.meta.url);
const OVERLAY_SYSTEM_URL = new URL(
    '../script/module/overlay/overlay_system.js',
    import.meta.url
);
const COLLECTION_OVERLAY_URL = new URL(
    '../script/module/overlay/title/_collection.js',
    import.meta.url
);
const DEBUG_SYSTEM_URL = new URL(
    '../script/module/debug/debug_system.js',
    import.meta.url
);
const DEBUG_MODE_TOGGLE_URL = new URL(
    '../script/module/input/_debug_mode_toggle_handler.js',
    import.meta.url
);

const [
    manifestSource,
    overlaySystemSource,
    collectionOverlaySource,
    debugSystemSource,
    debugModeToggleSource,
    titleMenuDefinitions
] = await Promise.all([
    readFile(MANIFEST_URL, 'utf8'),
    readFile(OVERLAY_SYSTEM_URL, 'utf8'),
    readFile(COLLECTION_OVERLAY_URL, 'utf8'),
    readFile(DEBUG_SYSTEM_URL, 'utf8'),
    readFile(DEBUG_MODE_TOGGLE_URL, 'utf8'),
    loadGameModule('scene/title/menu/_title_menu_definitions.js')
]);
const manifest = JSON.parse(manifestSource);

/**
 * production 타이틀 overlay factory의 key와 controller class를 추출합니다.
 * @returns {Map<string, string>} factory key별 controller class입니다.
 */
function readTitleOverlayFactoryEntries() {
    const factoryMatch = overlaySystemSource.match(
        /const TITLE_OVERLAY_FACTORY_BY_MENU = Object\.freeze\(\{([\s\S]*?)\}\);/
    );
    assert.ok(factoryMatch, 'TITLE_OVERLAY_FACTORY_BY_MENU 선언을 찾을 수 없습니다.');

    const propertyKeys = [...factoryMatch[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)]
        .map((match) => match[1]);
    const entries = [...factoryMatch[1].matchAll(
        /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*\(titleScene\)\s*=>\s*new\s+([A-Za-z][A-Za-z0-9]*)\(titleScene\),?\s*$/gm
    )].map((match) => [match[1], match[2]]);

    assert.equal(
        entries.length,
        propertyKeys.length,
        'factory에 테스트가 해석하지 못하는 생성식이 추가되었습니다.'
    );
    assert.deepEqual(
        entries.map(([key]) => key),
        propertyKeys,
        'factory property를 중복되거나 잘못 해석했습니다.'
    );
    return new Map(entries);
}

/**
 * 실제 타이틀 메뉴에서 overlay action으로 도달 가능한 항목을 반환합니다.
 * @returns {Map<string, {group:string, entryId:string}>} action key별 진입 항목입니다.
 */
function readReachableTitleOverlayEntries() {
    const groupedEntries = [
        ['card', titleMenuDefinitions.TITLE_MENU_CARD_DEFINITIONS],
        ['secondary', titleMenuDefinitions.TITLE_MENU_SECONDARY_ENTRIES]
    ];
    const reachableEntries = new Map();

    for (const [group, entries] of groupedEntries) {
        for (const entry of entries) {
            if (entry.actionType !== 'overlay') {
                continue;
            }
            assert.equal(typeof entry.actionKey, 'string');
            assert.ok(!reachableEntries.has(entry.actionKey), `${entry.actionKey} 진입점이 중복되었습니다.`);
            reachableEntries.set(entry.actionKey, {
                group,
                entryId: entry.id
            });
        }
    }
    return reachableEntries;
}

/**
 * OverlayManager가 controller를 직접 생성하는 공개 open 진입점을 반환합니다.
 * @returns {Map<string, {controllerClass:string, managerKey:string}>} 공개 method별 계약입니다.
 */
function readManagerOverlayEntries() {
    const managerKeysMatch = overlaySystemSource.match(
        /const OVERLAY_MANAGER_KEYS = Object\.freeze\(\{([\s\S]*?)\}\);/
    );
    assert.ok(managerKeysMatch, 'OVERLAY_MANAGER_KEYS 선언을 찾을 수 없습니다.');
    const managerKeys = new Map(
        [...managerKeysMatch[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/gm)]
            .map((match) => [match[1], match[2]])
    );

    const methodBoundaries = [...overlaySystemSource.matchAll(
        /^    ([#A-Za-z][#A-Za-z0-9]*)\([^)]*\) \{/gm
    )];
    const directOpenMethods = methodBoundaries.filter((match) => (
        /^open[A-Z][A-Za-z0-9]+Overlay$/.test(match[1])
        && match[1] !== 'openTitleOverlay'
    ));
    const entries = new Map();

    for (const methodMatch of directOpenMethods) {
        const boundaryIndex = methodBoundaries.indexOf(methodMatch);
        const nextBoundary = methodBoundaries[boundaryIndex + 1];
        const methodSource = overlaySystemSource.slice(
            methodMatch.index,
            nextBoundary?.index ?? overlaySystemSource.length
        );
        const constructorMatch = methodSource.match(
            /this\.openOverlay\(new\s+([A-Za-z][A-Za-z0-9]*)\([^)]*\),\s*\{[\s\S]*?key:\s*OVERLAY_MANAGER_KEYS\.([A-Z][A-Z0-9_]*)/
        );
        assert.ok(
            constructorMatch,
            `${methodMatch[1]}의 직접 controller 생성과 manager key를 해석할 수 없습니다.`
        );
        const managerKey = managerKeys.get(constructorMatch[2]);
        assert.equal(typeof managerKey, 'string');
        entries.set(methodMatch[1], {
            controllerClass: constructorMatch[1],
            managerKey
        });
    }
    return entries;
}

/**
 * DebugSystem constructor의 기본 control 상태를 추출합니다.
 * @returns {Record<string, boolean>} 디버그 control 기본 상태입니다.
 */
function readDebugControlDefaults() {
    const stateMatch = debugSystemSource.match(/this\.controlState = \{([\s\S]*?)\};/);
    assert.ok(stateMatch, 'DebugSystem controlState 초기값을 찾을 수 없습니다.');
    return Object.fromEntries(
        [...stateMatch[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*(true|false),?$/gm)]
            .map((match) => [match[1], match[2] === 'true'])
    );
}

const sortedKeys = (keys) => [...keys].sort();

test('UI visual 시나리오 매니페스트는 결정적 oracle 입력을 고정한다', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.oracle.runtime, 'nwjs');
    assert.deepEqual(manifest.oracle.viewport, {
        width: 1280,
        height: 720,
        devicePixelRatio: 1
    });
    assert.equal(manifest.oracle.clock.fixedStepHz, 60);
    assert.equal(manifest.oracle.clock.titleReadyFrame, 420);
    assert.equal(manifest.oracle.clock.overlayOpenCompleteFrames, 30);
    assert.equal(manifest.oracle.random.algorithm, 'xorshift32');
    assert.ok(Number.isInteger(manifest.oracle.random.seed));
    assert.equal(manifest.oracle.settings.language, 'korean');
    assert.equal(manifest.oracle.settings.theme, 'dark');
    assert.equal(manifest.capture.dynamicSurfacePolicy, 'all-in-sort-order');
    assert.equal(manifest.capture.includeFinalComposite, true);

    const scenarioIds = manifest.scenarios.map(({ id }) => id);
    assert.equal(new Set(scenarioIds).size, scenarioIds.length, 'scenario id가 중복되었습니다.');
    for (const scenario of manifest.scenarios) {
        assert.match(scenario.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
        assert.ok(Array.isArray(scenario.steps) && scenario.steps.length > 0);
        assert.equal(typeof scenario.captureState, 'string');
        for (const step of scenario.steps) {
            assert.equal(typeof step.action, 'string');
            if (step.action === 'advanceFrames') {
                assert.ok(Number.isInteger(step.frames) && step.frames > 0);
            }
        }
    }
});

test('production 타이틀 메뉴와 overlay factory의 도달 가능 key가 정확히 일치한다', () => {
    const factoryEntries = readTitleOverlayFactoryEntries();
    const reachableEntries = readReachableTitleOverlayEntries();

    assert.deepEqual(
        sortedKeys(reachableEntries.keys()),
        sortedKeys(factoryEntries.keys())
    );
});

test('UI visual 시나리오는 factory 도달 가능 overlay를 100% 커버한다', () => {
    const factoryEntries = readTitleOverlayFactoryEntries();
    const reachableEntries = readReachableTitleOverlayEntries();
    const declaredCoverage = new Map();

    for (const entry of manifest.coverage.titleOverlayFactory) {
        assert.ok(!declaredCoverage.has(entry.key), `${entry.key} coverage 선언이 중복되었습니다.`);
        declaredCoverage.set(entry.key, entry);
    }

    assert.deepEqual(
        sortedKeys(declaredCoverage.keys()),
        sortedKeys(factoryEntries.keys())
    );

    for (const [key, controllerClass] of factoryEntries) {
        const coverage = declaredCoverage.get(key);
        assert.equal(coverage.controllerClass, controllerClass);
        assert.deepEqual(coverage.trigger, reachableEntries.get(key));

        const coveredScenarios = manifest.scenarios.filter(
            (scenario) => scenario.coverageKey === key
        );
        assert.ok(coveredScenarios.length > 0, `${key} 시각 시나리오가 없습니다.`);
        assert.ok(
            coveredScenarios.some((scenario) => scenario.captureState === 'open-complete'),
            `${key} open-complete 시나리오가 없습니다.`
        );
        for (const scenario of coveredScenarios) {
            assert.ok(
                scenario.steps.some((step) => (
                    step.action === 'openTitleOverlay' && step.menu === key
                )),
                `${scenario.id}가 ${key} factory를 열지 않습니다.`
            );
        }
    }

    for (const scenario of manifest.scenarios) {
        if (scenario.coverageKey !== undefined) {
            assert.ok(factoryEntries.has(scenario.coverageKey));
        }
    }
});

test('공개 manager overlay 진입점과 visual coverage가 양방향으로 일치한다', () => {
    const productionEntries = readManagerOverlayEntries();
    const declaredEntries = new Map();

    for (const entry of manifest.coverage.managerOverlays) {
        assert.ok(
            !declaredEntries.has(entry.managerMethod),
            `${entry.managerMethod} manager coverage 선언이 중복되었습니다.`
        );
        declaredEntries.set(entry.managerMethod, entry);
    }
    assert.deepEqual(
        sortedKeys(declaredEntries.keys()),
        sortedKeys(productionEntries.keys())
    );

    for (const [managerMethod, productionEntry] of productionEntries) {
        const declaredEntry = declaredEntries.get(managerMethod);
        assert.equal(declaredEntry.controllerClass, productionEntry.controllerClass);
        assert.equal(declaredEntry.managerKey, productionEntry.managerKey);

        const scenarios = manifest.scenarios.filter(
            (scenario) => scenario.managerCoverageMethod === managerMethod
        );
        assert.ok(scenarios.length > 0, `${managerMethod} 시각 시나리오가 없습니다.`);
        assert.ok(
            scenarios.some((scenario) => scenario.captureState === 'open-complete'),
            `${managerMethod} open-complete 시나리오가 없습니다.`
        );
        assert.ok(
            scenarios.every(
                (scenario) => scenario.expectedControllerClass === productionEntry.controllerClass
            ),
            `${managerMethod} controller 기대값이 production과 다릅니다.`
        );
    }

    const scenarioMethods = new Set(
        manifest.scenarios
            .map((scenario) => scenario.managerCoverageMethod)
            .filter((managerMethod) => managerMethod !== undefined)
    );
    assert.deepEqual(sortedKeys(scenarioMethods), sortedKeys(productionEntries.keys()));
});

test('debug visual 시나리오는 중클릭 3회와 활성 control·hitbox·profiler 상태를 고정한다', () => {
    const requiredClickMatch = debugModeToggleSource.match(
        /const REQUIRED_MIDDLE_CLICKS = (\d+);/
    );
    const clickWindowMatch = debugModeToggleSource.match(
        /const DEBUG_MODE_TOGGLE_WINDOW_MS = (\d+);/
    );
    assert.ok(requiredClickMatch);
    assert.ok(clickWindowMatch);

    const debugScenario = manifest.scenarios.find(
        (scenario) => scenario.managerCoverageMethod === 'openDebugOverlay'
    );
    assert.ok(debugScenario);
    const middleClicks = debugScenario.steps.filter(
        (step) => step.action === 'clickMouseButton' && step.button === 'middle'
    );
    assert.equal(middleClicks.length, Number(requiredClickMatch[1]));
    assert.ok(middleClicks.every(({ eventTimeMs }) => Number.isFinite(eventTimeMs)));
    assert.ok(
        middleClicks.at(-1).eventTimeMs - middleClicks[0].eventTimeMs
            <= Number(clickWindowMatch[1])
    );
    const lastClickIndex = debugScenario.steps.indexOf(middleClicks.at(-1));
    const flushIndex = debugScenario.steps.findIndex(({ action }) => action === 'flushAsyncJobs');
    assert.ok(flushIndex > lastClickIndex);
    assert.equal(debugScenario.captureState, 'open-complete');
    assert.equal(manifest.oracle.settings.debugMode, false);
    assert.equal(debugScenario.expectedRuntimeState.debugMode, true);
    assert.deepEqual(
        debugScenario.expectedRuntimeState.controlState,
        readDebugControlDefaults()
    );
    assert.equal(debugScenario.expectedRuntimeState.hitboxesActive, true);
    assert.equal(debugScenario.expectedRuntimeState.performanceProfilerEnabled, true);
    assert.equal(debugScenario.expectedRuntimeState.poolInfoVisible, true);
    assert.match(
        debugSystemSource,
        /hitboxesActive = this\.debugModeEnabled && this\.controlState\.hitboxes === true/
    );
    assert.match(
        debugSystemSource,
        /this\.performanceDebugger\.setEnabled\(this\.controlState\.frameTime\)/
    );
});

test('CollectionOverlay는 구현은 존재하지만 production 진입점이 없는 의식적 제외 대상이다', () => {
    assert.match(collectionOverlaySource, /export class CollectionOverlay extends TitleOverlay/);
    assert.doesNotMatch(overlaySystemSource, /\bCollectionOverlay\b/);

    const inventoryEntries = manifest.inventory.orphanOverlayImplementations.filter(
        ({ controllerClass }) => controllerClass === 'CollectionOverlay'
    );
    const exclusions = manifest.exclusions.visualScenarios.filter(
        ({ controllerClass }) => controllerClass === 'CollectionOverlay'
    );
    assert.equal(inventoryEntries.length, 1);
    assert.equal(inventoryEntries[0].productionEntryPoint, null);
    assert.equal(
        inventoryEntries[0].sourcePath,
        'game/script/module/overlay/title/_collection.js'
    );
    assert.deepEqual(exclusions, [{
        controllerClass: 'CollectionOverlay',
        reason: 'no-production-entry-point'
    }]);
    assert.ok(
        manifest.scenarios.every(
            (scenario) => scenario.expectedControllerClass !== 'CollectionOverlay'
        )
    );
});
