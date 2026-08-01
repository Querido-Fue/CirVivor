import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/scene/benchmark/render/benchmark_scene_world_renderer.js',
    import.meta.url
));
const SNAPSHOT_UTILS_PATH = fileURLToPath(new URL(
    '../script/module/scene/benchmark/benchmark_scene_snapshot_utils.js',
    import.meta.url
));
const [source, snapshotUtilsSource] = await Promise.all([
    readFile(SOURCE_PATH, 'utf8'),
    readFile(SNAPSHOT_UTILS_PATH, 'utf8')
]);
const EXECUTABLE_SOURCE_HASH = 'bdd27b0fb9e27387d76e1db563663b78f83bb98f88833b0f43013e93709df9b7';

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
 * @param {string} productionSource - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(productionSource) {
    const allJsDocStarts = productionSource.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = productionSource.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    const executableSource = productionSource
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} productionSource - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(productionSource, escapedDeclaration) {
    const match = productionSource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

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

test('world renderer JSDoc 변경은 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(source), EXECUTABLE_SOURCE_HASH);
});

test('world renderer JSDoc은 out identity, live 배열, 부분 쓰기와 void 반환을 명시한다', () => {
    const resolverDoc = findLeadingJsDoc(
        source,
        'function resolveWorldRenderState\\(options, out\\)'
    );
    assert.match(resolverDoc, /@param \{object\} out/);
    assert.match(resolverDoc, /`out`과 동일한 객체/);
    assert.match(resolverDoc, /선택된 맵·플레이어 객체와 유효한 입력 엔티티 배열/);
    assert.match(resolverDoc, /복제하지 않고 live 참조로 유지/);
    assert.match(resolverDoc, /기존의 다른 필드는 유지/);
    assert.match(resolverDoc, /예외 전까지 완료된 필드 쓰기/);

    for (const declaration of [
        'function renderGameMap\\(mapGeometry, offsetY\\)',
        'function renderWall\\(wall, fill, offsetY\\)',
        'function renderCircleEntity\\(entity, fill, offsetY\\)',
        'function renderPlayer\\(player, offsetY\\)',
        'function renderProjectileRun\\(diameter, fill, centers, renderOptions\\)',
        'function renderProjectiles\\(projectiles, fill, offsetY\\)',
        'export function drawGameSceneWorldObjects\\(options = EMPTY_WORLD_RENDER_OPTIONS\\)'
    ]) {
        assert.match(findLeadingJsDoc(source, declaration), /@returns \{void\}/);
    }
});

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
