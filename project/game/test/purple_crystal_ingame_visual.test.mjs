import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    R2_ENEMY_SHOWCASE_MAP_DATA
} = await loadGameModule('data/scene/game/r2_enemy_showcase_map_data.js');
const {
    MAP_VISUAL_THEME_ID,
    PURPLE_CRYSTAL_MAP_VISUAL_THEME,
    resolveMapVisualTheme
} = await loadGameModule(
    'data/scene/game/purple_crystal_map_visual_theme_data.js'
);
const {
    defineMapVisualTheme
} = await loadGameModule('ingame/contract/map_visual_theme_contract.js');
const {
    TileMap,
    createTileMap
} = await loadGameModule('ingame/map/tile_map.js');
const {
    MapVisualGeometryBuilder
} = await loadGameModule('ingame/map/map_visual_geometry_builder.js');
const {
    TileMapRenderer
} = await loadGameModule('ingame/map/tile_map_renderer.js');
const {
    TheCoreRenderer
} = await loadGameModule('ingame/object/the_core_renderer.js');
const {
    TheTowerRenderer
} = await loadGameModule('ingame/object/the_tower_renderer.js');
const {
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');

const GOLDEN_PATH = fileURLToPath(new URL(
    './fixtures/purple_crystal_visual_semantic_golden.json',
    import.meta.url
));
const SEMANTIC_GOLDEN = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'));

function createProjection(worldBounds, scale = 10) {
    const view = {
        left: worldBounds.minX,
        top: worldBounds.minY,
        right: worldBounds.maxX,
        bottom: worldBounds.maxY
    };
    let revision = 1;
    return {
        getViewBounds() {
            return view;
        },
        getProjectionRevision() {
            return revision;
        },
        getScale() {
            return scale;
        },
        worldToViewport(x, y, out = {}) {
            out.x = (x - view.left) * scale;
            out.y = (y - view.top) * scale;
            return out;
        },
        viewportToWorld(x, y, out = {}) {
            out.x = x / scale + view.left;
            out.y = y / scale + view.top;
            return out;
        },
        worldLengthToViewport(length) {
            return length * scale;
        },
        isCircleVisible(x, y, radius) {
            return x + radius >= view.left
                && x - radius <= view.right
                && y + radius >= view.top
                && y - radius <= view.bottom;
        },
        pan(x, y) {
            view.left += x;
            view.right += x;
            view.top += y;
            view.bottom += y;
            revision += 1;
        }
    };
}

function createTraceRenderPort() {
    const calls = [];
    const snapshot = (kind, options, centers = null) => ({
        kind,
        layer: options.layer,
        shape: options.shape ?? 'square',
        fill: options.fill,
        alpha: options.alpha,
        x: options.x,
        y: options.y,
        w: options.w ?? options.size ?? options.diameter,
        h: options.h ?? options.size ?? options.diameter,
        rotation: options.rotation ?? 0,
        centerCount: centers?.length ?? 1,
        firstCenter: centers?.[0]
            ? { x: centers[0].x, y: centers[0].y }
            : null
    });
    return {
        calls,
        drawShape(options) {
            calls.push(snapshot('shape', options));
        },
        drawShapeInstances(options) {
            calls.push(snapshot('instances', options, options.centers));
        },
        drawCircle(options) {
            calls.push(snapshot('legacy-circle', options));
        },
        drawSquareInstances(options) {
            calls.push(snapshot('legacy-squares', options, options.centers));
        }
    };
}

test('visual theme는 strict known-key/range/fingerprint/deep-freeze 계약을 지킨다', () => {
    const { fingerprint: ignoredFingerprint, ...authored } =
        PURPLE_CRYSTAL_MAP_VISUAL_THEME;
    assert.ok(Number.isSafeInteger(ignoredFingerprint));
    const normalized = defineMapVisualTheme(authored);
    const repeated = defineMapVisualTheme(authored);
    assert.equal(normalized.fingerprint, repeated.fingerprint);
    assert.equal(normalized.fingerprint, SEMANTIC_GOLDEN.themeFingerprint);
    assert.ok(Object.isFrozen(normalized));
    assert.ok(Object.isFrozen(normalized.platform));
    assert.ok(Object.isFrozen(normalized.spawnPortal.colors));
    assert.throws(
        () => defineMapVisualTheme({ ...authored, unknownVisualKey: true }),
        /알려지지 않은 visual theme 키/
    );
    assert.throws(
        () => defineMapVisualTheme({
            ...authored,
            entityGlow: {
                ...authored.entityGlow,
                haloWidthPixels: Number.POSITIVE_INFINITY
            }
        }),
        /유한수/
    );
    assert.equal(
        resolveMapVisualTheme('missing-theme').themeId,
        MAP_VISUAL_THEME_ID.FLAT
    );
    assert.equal(
        R2_ENEMY_SHOWCASE_MAP_DATA.visualThemeId,
        MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL
    );
});

test('MapVisualGeometryBuilder는 deterministic/bounded geometry와 exact gate를 만든다', () => {
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    const builder = new MapVisualGeometryBuilder();
    const first = builder.build(tileMap, PURPLE_CRYSTAL_MAP_VISUAL_THEME);
    const second = builder.build(tileMap, PURPLE_CRYSTAL_MAP_VISUAL_THEME);
    const expected = SEMANTIC_GOLDEN.surfaces[
        'game.purple-crystal-map.empty'
    ];
    assert.deepEqual(first.diagnostics, {
        walkableTileCount: expected.walkableTileCount,
        facetCount: expected.facetCount,
        perimeterEdgeCount: expected.perimeterEdgeCount,
        ambientFragmentCount: expected.ambientFragmentCount,
        gateCount: 1
    });
    assert.equal(first.geometryFingerprint, second.geometryFingerprint);
    assert.deepEqual(
        Array.from(first.walkableColumns),
        Array.from(second.walkableColumns)
    );
    assert.deepEqual(
        Array.from(first.ambientFragments),
        Array.from(second.ambientFragments)
    );
    assert.ok(Object.isFrozen(first));
    assert.equal(
        first.diagnostics.ambientFragmentCount
            <= PURPLE_CRYSTAL_MAP_VISUAL_THEME
                .ambientGeometry.maximumFragmentCount,
        true
    );
    const [route] = tileMap.getSpawnRoutes();
    assert.deepEqual(Array.from(first.gatePositions), [
        route.entryPoint.x,
        route.entryPoint.y
    ]);
    const grid = tileMap.getNavigationGrid();
    for (let index = 0; index < first.ambientFragments.length; index += 4) {
        const tile = tileMap.worldToTile(
            first.ambientFragments[index],
            first.ambientFragments[index + 1],
            {}
        );
        assert.equal(grid.blocked[tile.row * grid.cols + tile.column], 1);
    }
});

test('여러 authored spawn gate는 exact 위치를 같은 bounded portal batch로 그린다', () => {
    const tileMap = new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA);
    const routes = tileMap.getSpawnRoutes();
    assert.ok(routes.length > 1);

    const builder = new MapVisualGeometryBuilder();
    const geometry = builder.build(tileMap, PURPLE_CRYSTAL_MAP_VISUAL_THEME);
    assert.equal(geometry.diagnostics.gateCount, routes.length);
    assert.deepEqual(
        Array.from(geometry.gatePositions),
        routes.flatMap((route) => [route.entryPoint.x, route.entryPoint.y])
    );

    const projection = createProjection(tileMap.getWorldBounds());
    const port = createTraceRenderPort();
    const renderer = new TileMapRenderer(port);
    renderer.draw(tileMap, projection);
    assert.ok(port.calls.some((call) => (
        call.kind === 'instances'
        && call.shape === 'circle'
        && call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.spawnPortal.colors[2]
        && call.centerCount === routes.length
    )));
    assert.ok(port.calls.some((call) => (
        call.kind === 'instances'
        && call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.spawnPortal.colors[0]
        && call.centerCount === routes.length * 7
    )));
    renderer.destroy();
});

test('purple map renderer는 geometry를 1회 build하고 camera pan에는 rebuild하지 않는다', () => {
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    const projection = createProjection(tileMap.getWorldBounds());
    const port = createTraceRenderPort();
    const renderer = new TileMapRenderer(port);
    renderer.draw(tileMap, projection);

    const emptyGolden = SEMANTIC_GOLDEN.surfaces[
        'game.purple-crystal-map.empty'
    ];
    assert.equal(port.calls.length, emptyGolden.mapDrawCommandCount);
    assert.equal(
        port.calls.reduce((sum, call) => sum + call.centerCount, 0),
        emptyGolden.mapSpriteCount
    );
    assert.deepEqual(
        port.calls.slice(0, 4).map((call) => [call.kind, call.shape, call.layer]),
        Array.from({ length: 4 }, () => ['shape', 'rect', 'background'])
    );
    const floorIndex = port.calls.findIndex((call) => (
        call.fill === renderer.floorOptions.fill
    ));
    const portalIndex = port.calls.findIndex((call) => (
        call.shape === 'circle'
        && call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.spawnPortal.colors[2]
    ));
    assert.ok(floorIndex >= 0 && portalIndex > floorIndex);
    const routeEntry = tileMap.getSpawnRoutes()[0].entryPoint;
    assert.deepEqual(port.calls[portalIndex].firstCenter, {
        x: routeEntry.x * 10,
        y: routeEntry.y * 10
    });
    assert.equal(renderer.getDiagnostics().geometryBuildCount, 1);

    port.calls.length = 0;
    renderer.draw(tileMap, projection);
    assert.equal(renderer.getDiagnostics().geometryBuildCount, 1);
    const firstArcBefore = port.calls.find((call) => (
        call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.spawnPortal.colors[0]
        && call.kind === 'instances'
        && call.centerCount === 7
    )).firstCenter;

    renderer.update(1);
    port.calls.length = 0;
    renderer.draw(tileMap, projection);
    const firstArcAfter = port.calls.find((call) => (
        call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.spawnPortal.colors[0]
        && call.kind === 'instances'
        && call.centerCount === 7
    )).firstCenter;
    assert.notDeepEqual(firstArcAfter, firstArcBefore);

    projection.pan(1, 0);
    port.calls.length = 0;
    renderer.draw(tileMap, projection);
    assert.equal(renderer.getDiagnostics().geometryBuildCount, 1);
    tileMap.visualRevision += 1;
    renderer.draw(tileMap, projection);
    assert.equal(renderer.getDiagnostics().geometryBuildCount, 2);
    renderer.destroy();
});

test('Core는 exact center와 bounded integrity presentation만 소비한다', () => {
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    const projection = createProjection(tileMap.getWorldBounds());
    const port = createTraceRenderPort();
    const renderer = new TheCoreRenderer(port);
    let currentIntegrity = 50;
    const integrity = {
        getCurrentIntegrity: () => currentIntegrity,
        getMaxIntegrity: () => 100
    };
    const corePosition = tileMap.getCorePosition();
    const core = {
        active: true,
        position: corePosition,
        radius: 0.5,
        getCoreIntegrity: () => integrity
    };
    renderer.draw(core, projection, tileMap);
    assert.equal(port.calls.some((call) => call.kind === 'legacy-circle'), false);
    const exactRing = port.calls.find((call) => call.shape === 'ring');
    assert.equal(exactRing.x, corePosition.x * 10);
    assert.equal(exactRing.y, corePosition.y * 10);
    assert.equal(
        renderer.getDiagnostics().integritySegmentCount,
        SEMANTIC_GOLDEN.surfaces[
            'game.purple-crystal-map.core-and-spawn'
        ].coreIntegritySegmentsAtHalf
    );
    const beforeTime = renderer.getDiagnostics().presentationTime;
    renderer.update(0);
    assert.equal(renderer.getDiagnostics().presentationTime, beforeTime);
    renderer.update(0.5);
    assert.ok(renderer.getDiagnostics().presentationTime > beforeTime);
    currentIntegrity = 25;
    port.calls.length = 0;
    renderer.draw(core, projection, tileMap);
    assert.equal(renderer.getDiagnostics().integritySegmentCount, 3);
    assert.ok(port.calls.some((call) => (
        call.shape === 'ring'
        && call.fill === PURPLE_CRYSTAL_MAP_VISUAL_THEME.core.colors[2]
    )));

    const fallbackPort = createTraceRenderPort();
    const fallbackRenderer = new TheCoreRenderer(fallbackPort);
    fallbackRenderer.draw(core, projection);
    assert.equal(fallbackPort.calls[0].kind, 'legacy-circle');
    renderer.destroy();
    fallbackRenderer.destroy();
});

test('CPU fallback Tower도 원형 fill을 보존하고 projected-radius LOD rim만 더한다', () => {
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    const projection = createProjection(tileMap.getWorldBounds());
    const port = createTraceRenderPort();
    const renderer = new TheTowerRenderer(port);
    const tower = {
        active: true,
        renderPosition: tileMap.getTowerSpawnPosition(),
        radius: 0.5
    };
    renderer.draw(tower, projection, tileMap);
    assert.deepEqual(port.calls.map((call) => call.kind), [
        'shape',
        'legacy-circle',
        'shape'
    ]);
    assert.equal(port.calls[0].shape, 'circle');
    assert.equal(port.calls[2].shape, 'ring');
    assert.equal(port.calls[1].w, 10);
    assert.equal(port.calls[0].w, 19);
    assert.equal(port.calls[2].w, port.calls[1].w);
    renderer.destroy();
});

test('actor glow는 기존 analytic draw/binding 안에서 Tower·Enemy에만 bounded 적용된다', () => {
    const groupZeroBindings = Array.from(
        GPU_COLLISION_RENDER_WGSL.matchAll(/@group\(0\) @binding\((\d+)\)/g),
        (match) => Number(match[1])
    );
    const crowdedGolden = SEMANTIC_GOLDEN.surfaces[
        'game.purple-crystal-map.crowded'
    ];
    assert.deepEqual(groupZeroBindings, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(groupZeroBindings.length, crowdedGolden.actorRenderStorageBindingCount);
    assert.equal((GPU_COLLISION_RENDER_WGSL.match(/@compute/g) ?? []).length, 0);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn shape_distance\(/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /glow_quad_extent/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /let glow_quad_extent = 1\.0;/);
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /return EffectPresentation\(rgb, base_alpha\);/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /projected_radius >= ENTITY_GLOW_MINIMUM_PROJECTED_RADIUS/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /\(interaction_layer & BODY_LAYER_PROJECTILE\) == 0u/
    );
    assert.match(GPU_COLLISION_RENDER_WGSL, /ENTITY_GLOW_KIND_TOWER/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /ENTITY_GLOW_KIND_ENEMY/);
    assert.equal(GPU_COLLISION_RENDER_WGSL.includes('queue.submit'), false);
    assert.equal(GPU_COLLISION_RENDER_WGSL.includes('mapAsync'), false);
});

test('render ownership source에는 새 submit/readback/canvas texture owner가 없다', async () => {
    const sourceRoot = new URL('../script/', import.meta.url);
    const paths = [
        'module/ingame/map/tile_map_renderer.js',
        'module/ingame/map/map_visual_geometry_builder.js',
        'module/ingame/object/the_core_renderer.js',
        'module/ingame/object/the_tower_renderer.js',
        'module/scene/game/game_scene_dependency_factory.js'
    ];
    const sources = await Promise.all(paths.map((path) => readFile(
        fileURLToPath(new URL(path, sourceRoot)),
        'utf8'
    )));
    for (const source of sources) {
        assert.equal(source.includes('queue.submit'), false);
        assert.equal(source.includes('mapAsync'), false);
        assert.equal(source.includes('getCurrentTexture'), false);
    }
    const gameObjectSystemSource = await readFile(
        fileURLToPath(new URL(
            'module/ingame/object/game_object_system.js',
            sourceRoot
        )),
        'utf8'
    );
    const mapDrawIndex = gameObjectSystemSource.indexOf(
        'this.tileMapRenderer.draw(this.tileMap, this.camera);'
    );
    const actorDrawIndex = gameObjectSystemSource.indexOf(
        'this.drawEnemySimulation();',
        mapDrawIndex
    );
    const coreDrawIndex = gameObjectSystemSource.indexOf(
        'this.coreRenderer.draw(this.core, this.camera, this.tileMap);',
        actorDrawIndex
    );
    assert.ok(mapDrawIndex >= 0);
    assert.ok(actorDrawIndex > mapDrawIndex);
    assert.ok(coreDrawIndex > actorDrawIndex);
});
