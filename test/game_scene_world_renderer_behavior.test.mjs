import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/benchmark/render/benchmark_scene_world_renderer.js',
    import.meta.url
));
const SNAPSHOT_UTILS_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/benchmark/benchmark_scene_snapshot_utils.js',
    import.meta.url
));
const [source, snapshotUtilsSource] = await Promise.all([
    readFile(SOURCE_PATH, 'utf8'),
    readFile(SNAPSHOT_UTILS_PATH, 'utf8')
]);

/**
 * 실제 production 모듈에서 비공개 world state resolver만 테스트용으로 노출합니다.
 * @returns {Promise<Function>} resolver 함수입니다.
 */
async function loadWorldRenderStateResolver() {
    const context = vm.createContext({ console });
    const modules = new Map();
    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );

    modules.set('display/_theme_handler.js', createSyntheticModule(
        'display/_theme_handler.js',
        { ColorSchemes: { Game: { Map: {} } } }
    ));
    modules.set('display/display_system.js', createSyntheticModule(
        'display/display_system.js',
        { renderGL() {}, renderGLShapeInstances() {} }
    ));
    modules.set('debug/debug_system.js', createSyntheticModule(
        'debug/debug_system.js',
        { beginPerformanceSection: () => 0, endPerformanceSection() {} }
    ));
    modules.set('physics/collision_frame_stats.js', createSyntheticModule(
        'physics/collision_frame_stats.js',
        { COLLISION_FRAME_STAT_FIELDS: Object.freeze([]) }
    ));
    modules.set('util/number_util.js', createSyntheticModule(
        'util/number_util.js',
        {
            resolveFiniteNumber(value, fallback) {
                return Number.isFinite(value) ? value : fallback;
            }
        }
    ));
    modules.set('../benchmark_scene_snapshot_utils.js', new vm.SourceTextModule(
        snapshotUtilsSource,
        { context, identifier: SNAPSHOT_UTILS_PATH }
    ));
    modules.set('./benchmark_scene_palette.js', createSyntheticModule(
        './benchmark_scene_palette.js',
        { getBenchmarkColor: () => '#000' }
    ));

    const module = new vm.SourceTextModule(
        `${source}\nexport { resolveWorldRenderState };`,
        { context, identifier: SOURCE_PATH }
    );
    await module.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 테스트 import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace.resolveWorldRenderState;
}

test('resolveWorldRenderState는 out identity와 snapshot 우선 live 참조를 보존한다', async () => {
    const resolveWorldRenderState = await loadWorldRenderStateResolver();
    const snapshotStaticWalls = [{ id: 'snapshot-static' }];
    const snapshotProjectiles = [{ id: 'snapshot-projectile' }];
    const fallbackBoxWalls = [{ id: 'fallback-box' }];
    const fallbackStaticWalls = [{ id: 'fallback-static' }];
    const fallbackPlayer = { id: 'fallback-player' };
    const out = {
        mapGeometry: { stale: true },
        staticWalls: [],
        boxWalls: [],
        player: { stale: true },
        projectiles: [],
        offsetY: -1,
        extraField: 'preserved'
    };
    const options = {
        sceneSnapshot: {
            mapGeometry: null,
            staticWalls: snapshotStaticWalls,
            boxWalls: 'invalid-snapshot-array',
            player: undefined,
            projectiles: snapshotProjectiles
        },
        mapGeometry: { id: 'fallback-map' },
        staticWalls: fallbackStaticWalls,
        boxWalls: fallbackBoxWalls,
        player: fallbackPlayer,
        projectiles: [{ id: 'fallback-projectile' }],
        objectOffsetY: 37
    };

    const result = resolveWorldRenderState(options, out);
    assert.equal(result, out);
    assert.equal(out.mapGeometry, null);
    assert.equal(out.staticWalls, snapshotStaticWalls);
    assert.equal(out.boxWalls, fallbackBoxWalls);
    assert.equal(out.player, undefined);
    assert.equal(out.projectiles, snapshotProjectiles);
    assert.equal(out.offsetY, 37);
    assert.equal(out.extraField, 'preserved');

    snapshotStaticWalls.push({ id: 'late-static' });
    snapshotProjectiles.push({ id: 'late-projectile' });
    fallbackBoxWalls.push({ id: 'late-box' });
    assert.equal(out.staticWalls.length, 2);
    assert.equal(out.projectiles.length, 2);
    assert.equal(out.boxWalls.length, 2);

    const liveMap = { nested: { value: 1 } };
    const livePlayer = { position: { x: 2, y: 3 } };
    const objectOut = {};
    resolveWorldRenderState({ mapGeometry: liveMap, player: livePlayer }, objectOut);
    assert.equal(objectOut.mapGeometry, liveMap);
    assert.equal(objectOut.player, livePlayer);
    liveMap.nested.value = 5;
    livePlayer.position.x = 8;
    assert.equal(objectOut.mapGeometry.nested.value, 5);
    assert.equal(objectOut.player.position.x, 8);
});

test('resolveWorldRenderState는 빈 fallback identity와 예외 전 부분 쓰기를 보존한다', async () => {
    const resolveWorldRenderState = await loadWorldRenderStateResolver();
    const emptyOut = {};
    assert.equal(resolveWorldRenderState(null, emptyOut), emptyOut);
    assert.equal(emptyOut.mapGeometry, null);
    assert.equal(emptyOut.staticWalls, emptyOut.boxWalls);
    assert.equal(emptyOut.boxWalls, emptyOut.projectiles);
    assert.equal(Object.isFrozen(emptyOut.staticWalls), true);
    assert.equal(emptyOut.player, undefined);
    assert.equal(emptyOut.offsetY, 0);
    const negativeZeroOut = {};
    resolveWorldRenderState({ objectOffsetY: -0 }, negativeZeroOut);
    assert.equal(Object.is(negativeZeroOut.offsetY, -0), true);
    resolveWorldRenderState({ objectOffsetY: Number.POSITIVE_INFINITY }, negativeZeroOut);
    assert.equal(negativeZeroOut.offsetY, 0);
    resolveWorldRenderState({ objectOffsetY: '37' }, negativeZeroOut);
    assert.equal(negativeZeroOut.offsetY, 0);

    const token = new Error('static walls sentinel');
    const oldStaticWalls = [{ id: 'old-static' }];
    const partialOut = {
        mapGeometry: { id: 'old-map' },
        staticWalls: oldStaticWalls,
        boxWalls: [{ id: 'old-box' }],
        player: { id: 'old-player' },
        projectiles: [{ id: 'old-projectile' }],
        offsetY: 91
    };
    const nextMap = { id: 'next-map' };
    const sceneSnapshot = { mapGeometry: nextMap };
    let staticWallsReadCount = 0;
    Object.defineProperty(sceneSnapshot, 'staticWalls', {
        get() {
            staticWallsReadCount += 1;
            if (staticWallsReadCount === 1) {
                return [];
            }
            throw token;
        }
    });

    assert.throws(
        () => resolveWorldRenderState({ sceneSnapshot }, partialOut),
        (error) => error === token
    );
    assert.equal(partialOut.mapGeometry, nextMap);
    assert.equal(partialOut.staticWalls, oldStaticWalls);
    assert.equal(partialOut.offsetY, 91);
    assert.equal(staticWallsReadCount, 2);
    assert.throws(
        () => resolveWorldRenderState({}, null),
        (error) => error?.name === 'TypeError'
    );
});
