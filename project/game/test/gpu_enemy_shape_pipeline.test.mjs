import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_CORK_ENEMY_DATA,
    BASIC_GEN_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RING_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITIONS,
    INGAME_ENEMY_DEFINITION_BY_ID,
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const { ARCHER_ENEMY_DATA } = await loadGameModule(
    'data/object/enemy/archer_enemy_data.js'
);
const {
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE,
    ENEMY_NORMALIZED_RENDER_GEOMETRY,
    ENEMY_SHAPE_GEOMETRY,
    ENEMY_SHAPE_PATH_KIND,
    ENEMY_SVG_DRAW_SIZE_RATIO,
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES
} = await loadGameModule('data/object/enemy/enemy_shape_geometry_data.js');
const { ENEMY_SVG_SHAPES } = await loadGameModule(
    'object/enemy/_enemy_shape_assets.js'
);
const { TITLE_WEBGPU_ENEMY_SHAPE_KEYS } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_shape_atlas.js'
);
const { CORRIDOR_EIGHT_WAVE_01_DATA } = await loadGameModule(
    'data/scene/game/corridor_eight_wave_01_data.js'
);
const { CORRIDOR_EIGHT_MAP_DATA } = await loadGameModule(
    'data/scene/game/corridor_eight_map_data.js'
);
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const NW_WEBGPU_CAPABILITY_RUNNER_SOURCE = await readFile(
    new URL('./nw_webgpu_capability/runner.js', import.meta.url),
    'utf8'
);
const TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_SOURCE = await readFile(
    new URL(
        '../script/module/scene/title/webgpu/_title_webgpu_enemy_shape_atlas.js',
        import.meta.url
    ),
    'utf8'
);
const ENEMY_SHAPE_ASSETS_SOURCE = await readFile(
    new URL('../script/module/object/enemy/_enemy_shape_assets.js', import.meta.url),
    'utf8'
);

const EXPECTED_ARCHETYPES = Object.freeze([
    Object.freeze({
        definition: BASIC_SQUARE_ENEMY_DATA,
        shapeType: 'square',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE
    }),
    Object.freeze({
        definition: BASIC_TRIANGLE_ENEMY_DATA,
        shapeType: 'triangle',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE
    }),
    Object.freeze({
        definition: BASIC_ARROW_ENEMY_DATA,
        shapeType: 'arrow',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW
    }),
    Object.freeze({
        definition: BASIC_PENTA_ENEMY_DATA,
        shapeType: 'penta',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA
    }),
    Object.freeze({
        definition: BASIC_HEXA_ENEMY_DATA,
        shapeType: 'hexa',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA
    }),
    Object.freeze({
        definition: BASIC_GEN_ENEMY_DATA,
        shapeType: 'jorang',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG
    }),
    Object.freeze({
        definition: BASIC_RHOM_ENEMY_DATA,
        shapeType: 'rhom',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM
    }),
    Object.freeze({
        definition: BASIC_OCTA_ENEMY_DATA,
        shapeType: 'octa',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA
    }),
    Object.freeze({
        definition: BASIC_RING_ENEMY_DATA,
        shapeType: 'ring',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.RING
    }),
    Object.freeze({
        definition: BASIC_CORK_ENEMY_DATA,
        shapeType: 'cork',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CORK
    })
]);
const EXPECTED_PRODUCTION_WAVE_ARCHETYPES = Object.freeze([
    Object.freeze({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        shapeType: 'circle',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
    }),
    Object.freeze({
        definition: BASIC_TRIANGLE_ENEMY_DATA,
        shapeType: 'triangle',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE
    }),
    Object.freeze({
        definition: BASIC_ARROW_ENEMY_DATA,
        shapeType: 'arrow',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW
    }),
    Object.freeze({
        definition: BASIC_RHOM_ENEMY_DATA,
        shapeType: 'rhom',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM
    }),
    Object.freeze({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        shapeType: 'circle',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
    }),
    Object.freeze({
        definition: BASIC_TRIANGLE_ENEMY_DATA,
        shapeType: 'triangle',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE
    }),
    Object.freeze({
        definition: ARCHER_ENEMY_DATA,
        shapeType: 'arrow',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW
    })
]);
const EXPECTED_LANE_OFFSETS = Object.freeze([-1.8, -0.6, 0.6, 1.8]);
const FIXTURE_ROUTE = Object.freeze({
    gateId: 'shape-gate',
    pathId: 'shape-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 10, y: 20 }),
        Object.freeze({ x: 11, y: 20 })
    ])
});
const FIXTURE_DYNAMIC_ROUTE_SNAPSHOT = Object.freeze({
    routeSetId: 'shape-route-set',
    routeAvailabilityVersion: 1,
    routeGraphContentKey: 'shape-route-graph-v1'
});

const assertClose = (actual, expected, epsilon = 1e-12) => {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
};

const toPointTuples = (points) => Array.from(
    points,
    ({ x, y }) => [x, y]
);

const toWgslFloat = (value) => {
    const normalized = Object.is(value, -0) ? 0 : value;
    const literal = String(normalized);
    return /[.eE]/.test(literal) ? literal : `${literal}.0`;
};

const toWgslVec2 = ({ x, y }) => (
    `vec2f(${toWgslFloat(x)}, ${toWgslFloat(y)})`
);

const getPolygonCenter = (points) => points.reduce((center, point) => ({
    x: center.x + (point.x / points.length),
    y: center.y + (point.y / points.length)
}), { x: 0, y: 0 });

const getPointBounds = (points) => Object.freeze({
    minimumX: Math.min(...points.map(({ x }) => x)),
    maximumX: Math.max(...points.map(({ x }) => x)),
    minimumY: Math.min(...points.map(({ y }) => y)),
    maximumY: Math.max(...points.map(({ y }) => y))
});

const isPointInsidePolygon = (point, points) => {
    let inside = false;
    let previous = points.at(-1);
    for (const current of points) {
        if ((current.y > point.y) !== (previous.y > point.y)) {
            const crossingX = current.x
                + ((point.y - current.y) * (previous.x - current.x)
                    / (previous.y - current.y));
            if (point.x < crossingX) inside = !inside;
        }
        previous = current;
    }
    return inside;
};

const assertPointSetMatches = (actual, expected, epsilon = 1e-12) => {
    assert.equal(actual.length, expected.length);
    for (const point of actual) {
        assert.ok(expected.some((candidate) => (
            Math.abs(point.x - candidate.x) <= epsilon
                && Math.abs(point.y - candidate.y) <= epsilon
        )), `대칭 대응점이 없습니다: ${JSON.stringify(point)}`);
    }
};

const polygonPathToSvg = ({ points }) => {
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map(
        ({ x, y }) => `L ${x} ${y}`
    ).join(' ')} Z`;
};

const rectPathToSvg = ({ x, y, width, height }) => (
    `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
);

test('main GPU enemy catalog과 단일 wave timeline은 65% radius·shape cycle·lane 순서를 고정한다', () => {
    assert.equal(
        MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
        (LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES / 2) * 1.3
    );
    assert.notStrictEqual(BASIC_CIRCLE_ENEMY_DATA, BASIC_SQUARE_ENEMY_DATA);
    assert.equal(Object.isFrozen(BASIC_CIRCLE_ENEMY_DATA), true);
    assert.equal(BASIC_CIRCLE_ENEMY_DATA.id, 'basic_circle_01');
    assert.equal(BASIC_CIRCLE_ENEMY_DATA.shapeType, 'circle');
    assert.equal(
        BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles,
        MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
    );
    assert.strictEqual(
        INGAME_ENEMY_DEFINITION_BY_ID[BASIC_CIRCLE_ENEMY_DATA.id],
        BASIC_CIRCLE_ENEMY_DATA
    );
    assert.equal(Object.isFrozen(INGAME_ENEMY_DEFINITIONS), true);
    assert.equal(INGAME_ENEMY_DEFINITIONS.length, EXPECTED_ARCHETYPES.length);

    for (const { definition, shapeType } of EXPECTED_ARCHETYPES) {
        assert.equal(Object.isFrozen(definition), true);
        assert.equal(definition.shapeType, shapeType);
        assert.equal(definition.collisionRadiusTiles, MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES);
        assert.equal(
            Number.isFinite(definition.collisionWeight)
                && definition.collisionWeight > 0,
            true
        );
        assert.equal(definition.radiusScale, 1);
        assert.strictEqual(INGAME_ENEMY_DEFINITION_BY_ID[definition.id], definition);
    }

    assert.equal(Object.isFrozen(CORRIDOR_EIGHT_WAVE_01_DATA), true);
    assert.equal(Object.isFrozen(CORRIDOR_EIGHT_WAVE_01_DATA.timeline), true);
    assert.equal(CORRIDOR_EIGHT_WAVE_01_DATA.timeline.length, 1);
    const timelineEntry = CORRIDOR_EIGHT_WAVE_01_DATA.timeline[0];
    const group = timelineEntry.spawnGroups[0];
    assert.equal(Object.isFrozen(timelineEntry), true);
    assert.equal(Object.isFrozen(timelineEntry.spawnGroups), true);
    assert.equal(Object.isFrozen(group), true);
    assert.equal(Object.isFrozen(group.enemyDefinitionIds), true);
    assert.equal(Object.isFrozen(group.laneOffsetsTiles), true);
    assert.equal(timelineEntry.durationSeconds * 60, 156);
    assert.equal(group.count, 32);
    assert.equal(group.intervalTicks, 5);
    assert.equal(group.enemyDefinitionId, BASIC_CIRCLE_ENEMY_DATA.id);
    assert.deepEqual({ ...group.routeBinding }, {
        gateId: CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].gateId,
        pathId: CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].pathId
    });
    assert.deepEqual(
        Array.from(group.enemyDefinitionIds),
        EXPECTED_PRODUCTION_WAVE_ARCHETYPES.map(
            ({ definition }) => definition.id
        )
    );
    assert.deepEqual(Array.from(group.laneOffsetsTiles), EXPECTED_LANE_OFFSETS);
    const minimumCycleSpeed = Math.min(...EXPECTED_PRODUCTION_WAVE_ARCHETYPES.map(
        ({ definition }) => definition.moveSpeedTilesPerSecond
    ));
    const sameLaneTravel = minimumCycleSpeed
        * ((group.intervalTicks * group.laneOffsetsTiles.length) / 60);
    assert.ok(
        sameLaneTravel > MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES * 2,
        '같은 lane의 다음 spawn 전에 이전 적이 collider 지름보다 멀리 이동해야 합니다.'
    );
});

test('legacy SVG raw path와 GPU normalized geometry는 단일 data 권위를 공유한다', () => {
    assert.equal(ENEMY_SVG_DRAW_SIZE_RATIO, 0.90);
    assert.equal(ENEMY_ASPECT_RATIO.arrow, 0.96);
    assert.equal(ENEMY_ASPECT_RATIO.rhom, 0.81);
    assert.equal(ENEMY_HEIGHT_SCALE.arrow, 0.9);
    assert.equal(ENEMY_ASPECT_RATIO.gen, 1.05);
    assert.equal(ENEMY_ASPECT_RATIO.jorang, 1);
    assert.equal(ENEMY_ASPECT_RATIO.cork, 1);
    assert.equal(Object.isFrozen(ENEMY_SHAPE_GEOMETRY), true);
    assert.equal(Object.isFrozen(ENEMY_NORMALIZED_RENDER_GEOMETRY), true);

    const arrowPath = ENEMY_SHAPE_GEOMETRY.arrow.paths[0];
    assert.equal(arrowPath.kind, ENEMY_SHAPE_PATH_KIND.POLYGON);
    assert.deepEqual(toPointTuples(arrowPath.points), [
        [0, -0.5767],
        [0.46, 0.3733],
        [0, 0.2033],
        [-0.46, 0.3733]
    ]);
    assert.equal(
        ENEMY_SVG_SHAPES.enemy_arrow[0],
        'M 0 -0.5767 L 0.46 0.3733 L 0 0.2033 L -0.46 0.3733 Z'
    );

    const generatorPaths = ENEMY_SHAPE_GEOMETRY.gen.paths;
    assert.equal(generatorPaths.length, 5);
    assert.equal(generatorPaths[0].kind, ENEMY_SHAPE_PATH_KIND.COMPOUND);
    assert.equal(generatorPaths[0].fillRule, 'evenodd');
    assert.equal(generatorPaths[0].paths[0].kind, ENEMY_SHAPE_PATH_KIND.RECT);
    assert.equal(ENEMY_SVG_SHAPES.enemy_gen[0].fillRule, 'evenodd');

    const jorangPaths = ENEMY_SHAPE_GEOMETRY.jorang.paths;
    assert.equal(jorangPaths.length, 3);
    assert.deepEqual(jorangPaths.map(({ kind }) => kind), [
        ENEMY_SHAPE_PATH_KIND.POLYGON,
        ENEMY_SHAPE_PATH_KIND.POLYGON,
        ENEMY_SHAPE_PATH_KIND.RECT
    ]);
    assert.deepEqual(Array.from(ENEMY_SVG_SHAPES.enemy_jorang), [
        polygonPathToSvg(jorangPaths[0]),
        polygonPathToSvg(jorangPaths[1]),
        rectPathToSvg(jorangPaths[2])
    ]);

    const normalized = ENEMY_NORMALIZED_RENDER_GEOMETRY;
    assertClose(normalized.square.box.halfSize.x, 0.6363961030678927);
    assertClose(normalized.square.box.halfSize.y, 0.6363961030678927);
    assertClose(normalized.triangle.points[0].y, 0.808071528014541);
    assertClose(normalized.triangle.points[1].x, 0.7000357133746821);
    assertClose(normalized.triangle.points[1].y, -0.4041115254481119);
    assertClose(normalized.arrow.points[0].y, 0.786449212798401);
    assertClose(normalized.arrow.points[1].x, 0.6691250455113844);
    assertClose(normalized.arrow.points[1].y, -0.5090714255898094);
    assertClose(normalized.arrow.points[2].y, -0.277241416615077);
    assert.ok(Math.abs(normalized.penta.points[0].x) < 1e-15);
    assertClose(normalized.penta.points[0].y, -0.7273098320775917);
    assertClose(normalized.hexa.points[0].y, -0.7121575439093085);
    assert.equal(normalized.rhom.points.length, 4);
    assertClose(normalized.rhom.points[0].y, -0.7576144084141581);
    assertClose(normalized.rhom.points[1].x, 0.41729401615451833);
    assert.equal(normalized.octa.points.length, 8);
    assertClose(Math.hypot(
        normalized.octa.points[0].x,
        normalized.octa.points[0].y
    ), 0.7121575439093085);
    assert.deepEqual(toPointTuples(ENEMY_SHAPE_GEOMETRY.cork.paths[0].points), [
        [-0.48, -0.46],
        [0.48, -0.46],
        [0.34, 0.46],
        [-0.34, 0.46]
    ]);
    assert.equal(normalized.cork.points.length, 4);
    assertClose(normalized.gen.outerBox.halfSize.x, 0.47729707730091964);
    assertClose(normalized.gen.outerBox.halfSize.y, 0.45456864504849487);
    assertClose(normalized.gen.innerBox.halfSize.x, 0.35001785668734103);
    assertClose(normalized.gen.innerBox.halfSize.y, 0.33335033970222955);
    assert.equal(normalized.gen.terminalBoxes.length, 4);
    assertClose(normalized.gen.terminalBoxes[0].center.x, -0.6204862004911955);
    assertClose(normalized.gen.terminalBoxes[0].center.y, -0.5909392385620433);
    assert.equal(normalized.jorang.lobes.length, 2);
    assert.equal(normalized.jorang.lobes.every((points) => (
        points.length === 8
    )), true);
    assert.ok(normalized.jorang.connector.halfSize.x > 0);
    assert.ok(normalized.jorang.connector.halfSize.y > 0);
    assert.ok(normalized.ring.outerRadius > normalized.ring.innerRadius);
    assert.ok(normalized.ring.innerRadius > 0);
});

test('J geometry는 두 둥근 lobe를 좁은 허리로 잇는 대칭·무공 단일 실루엣이다', () => {
    const paths = ENEMY_SHAPE_GEOMETRY.jorang.paths;
    const lobes = paths.filter(({ kind }) => (
        kind === ENEMY_SHAPE_PATH_KIND.POLYGON
    ));
    const connectors = paths.filter(({ kind }) => (
        kind === ENEMY_SHAPE_PATH_KIND.RECT
    ));
    assert.equal(lobes.length, 2, 'rounded lobe authority는 정확히 둘이어야 합니다.');
    assert.equal(connectors.length, 1, 'waist connector authority는 정확히 하나여야 합니다.');
    const connector = connectors[0];
    const lobeCenters = lobes.map(({ points }) => getPolygonCenter(points));
    const lobeBounds = lobes.map(({ points }) => getPointBounds(points));

    for (let index = 0; index < lobes.length; index++) {
        const { points } = lobes[index];
        const center = lobeCenters[index];
        assert.equal(points.length, 8);
        const radii = points.map(({ x, y }) => Math.hypot(
            x - center.x,
            y - center.y
        ));
        const edgeLengths = points.map((point, pointIndex) => {
            const next = points[(pointIndex + 1) % points.length];
            return Math.hypot(next.x - point.x, next.y - point.y);
        });
        assert.ok(radii.every((radius) => (
            Math.abs(radius - radii[0]) <= 1e-12
        )), '각 lobe는 같은 반경의 regular octagon이어야 합니다.');
        assert.ok(edgeLengths.every((length) => (
            Math.abs(length - edgeLengths[0]) <= 1e-12
        )), '각 lobe edge 길이는 같아야 합니다.');
        const crossProducts = points.map((point, pointIndex) => {
            const next = points[(pointIndex + 1) % points.length];
            const after = points[(pointIndex + 2) % points.length];
            return ((next.x - point.x) * (after.y - next.y))
                - ((next.y - point.y) * (after.x - next.x));
        });
        assert.ok(
            crossProducts.every((cross) => cross > 0)
                || crossProducts.every((cross) => cross < 0),
            '각 lobe authority는 convex여야 합니다.'
        );
    }

    assertClose(lobeCenters[0].x, -lobeCenters[1].x);
    assertClose(lobeCenters[0].y, 0);
    assertClose(lobeCenters[1].y, 0);
    assertClose(connector.x, -(connector.x + connector.width));
    assertClose(connector.y, -(connector.y + connector.height));
    assertPointSetMatches(
        lobes[0].points.map(({ x, y }) => ({ x, y: -y })),
        lobes[0].points
    );
    assertPointSetMatches(
        lobes[0].points.map(({ x, y }) => ({ x: -x, y })),
        lobes[1].points
    );
    assertPointSetMatches(
        lobes[1].points.map(({ x, y }) => ({ x, y: -y })),
        lobes[1].points
    );

    const lobeMaximumWidth = Math.max(...lobeBounds.map((bounds) => (
        bounds.maximumX - bounds.minimumX
    )));
    const lobeMaximumHeight = Math.max(...lobeBounds.map((bounds) => (
        bounds.maximumY - bounds.minimumY
    )));
    assert.ok(connector.width < lobeMaximumWidth);
    assert.ok(connector.height < lobeMaximumHeight);
    assert.ok(
        connector.height <= lobeMaximumHeight * 0.4,
        '중앙 waist의 횡단 폭은 lobe 최대 폭보다 명확히 좁아야 합니다.'
    );

    assert.ok(
        lobeBounds[0].maximumX < lobeBounds[1].minimumX,
        '두 lobe는 connector와 별개의 authority여야 합니다.'
    );
    const connectorCenterY = connector.y + (connector.height * 0.5);
    const overlapWitnesses = [
        {
            x: connector.x + (connector.width * 0.05),
            y: connectorCenterY
        },
        {
            x: connector.x + (connector.width * 0.95),
            y: connectorCenterY
        }
    ];
    assert.ok(isPointInsidePolygon(overlapWitnesses[0], lobes[0].points));
    assert.ok(isPointInsidePolygon(overlapWitnesses[1], lobes[1].points));
    assert.ok(overlapWitnesses.every(({ x, y }) => (
        x > connector.x
            && x < connector.x + connector.width
            && y > connector.y
            && y < connector.y + connector.height
    )));

    // 세 convex authority의 교차 graph는 L-C-R tree입니다. 따라서 모든 path가
    // 하나로 연결되고, cycle이나 열린 hole을 만들 수 없습니다.
    const adjacency = [[2], [2], [0, 1]];
    const visited = new Set([0]);
    const pending = [0];
    while (pending.length > 0) {
        const current = pending.shift();
        for (const next of adjacency[current]) {
            if (visited.has(next)) continue;
            visited.add(next);
            pending.push(next);
        }
    }
    const intersectionEdgeCount = adjacency.reduce(
        (count, neighbors) => count + neighbors.length,
        0
    ) / 2;
    assert.equal(visited.size, paths.length, 'detached path가 없어야 합니다.');
    assert.equal(intersectionEdgeCount, paths.length - 1, 'convex cover에 hole cycle이 없어야 합니다.');

    const allRawPoints = lobes.flatMap(({ points }) => points);
    const rawBounds = getPointBounds(allRawPoints);
    assertClose(rawBounds.minimumX, -rawBounds.maximumX);
    assertClose(rawBounds.minimumY, -rawBounds.maximumY);
    assert.ok(Math.hypot(rawBounds.maximumX, rawBounds.maximumY) < 0.60);
    assert.notDeepEqual(paths.map(({ kind }) => kind), [
        ENEMY_SHAPE_PATH_KIND.RECT,
        ENEMY_SHAPE_PATH_KIND.RECT,
        ENEMY_SHAPE_PATH_KIND.RECT,
        ENEMY_SHAPE_PATH_KIND.RECT
    ]);
    assert.doesNotMatch(
        ENEMY_SVG_SHAPES.enemy_jorang.join(' '),
        /M -0\.4 -0\.46 H 0\.4|right stem|lower hook/
    );
});

test('J legacy·title·ingame GPU는 같은 raw geometry와 normalized bounds를 소비한다', () => {
    const raw = ENEMY_SHAPE_GEOMETRY.jorang;
    const normalized = ENEMY_NORMALIZED_RENDER_GEOMETRY.jorang;
    const scale = ENEMY_SVG_DRAW_SIZE_RATIO
        / LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES;
    for (let lobeIndex = 0; lobeIndex < normalized.lobes.length; lobeIndex++) {
        const rawPoints = raw.paths[lobeIndex].points;
        const normalizedPoints = normalized.lobes[lobeIndex];
        assert.equal(normalizedPoints.length, rawPoints.length);
        for (let pointIndex = 0; pointIndex < rawPoints.length; pointIndex++) {
            assertClose(normalizedPoints[pointIndex].x, rawPoints[pointIndex].x * scale);
            assertClose(normalizedPoints[pointIndex].y, rawPoints[pointIndex].y * scale);
        }
    }
    const rawConnector = raw.paths[2];
    assertClose(
        normalized.connector.center.x,
        (rawConnector.x + (rawConnector.width * 0.5)) * scale
    );
    assertClose(
        normalized.connector.center.y,
        (rawConnector.y + (rawConnector.height * 0.5)) * scale
    );
    assertClose(normalized.connector.halfSize.x, rawConnector.width * scale * 0.5);
    assertClose(normalized.connector.halfSize.y, rawConnector.height * scale * 0.5);

    const rawBounds = getPointBounds(raw.paths.slice(0, 2).flatMap(({ points }) => points));
    const normalizedBounds = getPointBounds(normalized.lobes.flat());
    assertClose(normalizedBounds.minimumX, rawBounds.minimumX * scale);
    assertClose(normalizedBounds.maximumX, rawBounds.maximumX * scale);
    assertClose(normalizedBounds.minimumY, rawBounds.minimumY * scale);
    assertClose(normalizedBounds.maximumY, rawBounds.maximumY * scale);

    assert.ok(TITLE_WEBGPU_ENEMY_SHAPE_KEYS.includes('enemy_jorang'));
    assert.match(
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_SOURCE,
        /import \{ ShapeDrawer \} from 'display\/_shape_drawer\.js'/
    );
    assert.match(
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_SOURCE,
        /TITLE_WEBGPU_ENEMY_SHAPE_KEYS\[index\]/
    );
    assert.match(ENEMY_SHAPE_ASSETS_SOURCE, /ENEMY_SHAPE_GEOMETRY/);
    assert.match(ENEMY_SHAPE_ASSETS_SOURCE, /ENEMY_SVG_SHAPES/);

    for (const [name, points] of [
        ['JORANG_LEFT_LOBE_POINTS', normalized.lobes[0]],
        ['JORANG_RIGHT_LOBE_POINTS', normalized.lobes[1]]
    ]) {
        const block = GPU_COLLISION_RENDER_WGSL.match(
            new RegExp(`const ${name} = array<vec2f, 8>\\([\\s\\S]*?\\n    \\);`)
        )?.[0] ?? '';
        assert.ok(block.length > 0, `${name} WGSL array가 없습니다.`);
        assert.deepEqual(
            block.match(/vec2f\([^\n]+\)/g),
            points.map(toWgslVec2)
        );
    }
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const JORANG_CONNECTOR_CENTER: vec2f = ${toWgslVec2(normalized.connector.center)};`
    ));
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const JORANG_CONNECTOR_HALF_SIZE: vec2f = ${toWgslVec2(normalized.connector.halfSize)};`
    ));
    assert.equal(BASIC_GEN_ENEMY_DATA.id, 'basic_gen_01');
    assert.equal(BASIC_GEN_ENEMY_DATA.shapeDefinitionId, 'jorang');
    assert.equal(
        BASIC_GEN_ENEMY_DATA.collisionRadiusTiles,
        MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
    );
});

test('enemy spawn adapter는 지원 shape만 숫자 render style code로 전달한다', () => {
    for (let index = 0; index < EXPECTED_ARCHETYPES.length; index++) {
        const { definition, shapeCode } = EXPECTED_ARCHETYPES[index];
        const intent = createGpuEnemySpawnIntent({
            definition,
            route: FIXTURE_ROUTE,
            spawnSequence: index,
            laneOffsetTiles: 0,
            ...(definition === BASIC_CORK_ENEMY_DATA
                ? FIXTURE_DYNAMIC_ROUTE_SNAPSHOT
                : null)
        });
        assert.equal(Object.isFrozen(intent), true);
        assert.equal(Object.isFrozen(intent.renderStyle), true);
        assert.equal(intent.radius, MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES);
        assert.equal(intent.velocity.x, definition.moveSpeedTilesPerSecond);
        assert.equal(intent.velocity.y, 0);
        assert.equal(Math.hypot(intent.velocity.x, intent.velocity.y), intent.flowSpeed);
        assert.equal(intent.renderStyle.radiusScale, definition.radiusScale);
        assert.equal(intent.renderStyle.shapeCode, shapeCode);
    }

    const legacyCircleIntent = createGpuEnemySpawnIntent({
        definition: BASIC_CIRCLE_ENEMY_DATA,
        route: FIXTURE_ROUTE,
        spawnSequence: EXPECTED_ARCHETYPES.length
    });
    assert.equal(
        legacyCircleIntent.renderStyle.shapeCode,
        GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
    );

    const legacyDefinitionWithoutShape = { ...BASIC_CIRCLE_ENEMY_DATA };
    delete legacyDefinitionWithoutShape.shapeType;
    const missingShapeIntent = createGpuEnemySpawnIntent({
        definition: legacyDefinitionWithoutShape,
        route: FIXTURE_ROUTE,
        spawnSequence: EXPECTED_ARCHETYPES.length + 1
    });
    assert.equal(
        missingShapeIntent.renderStyle.shapeCode,
        GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
    );

    assert.throws(() => createGpuEnemySpawnIntent({
        definition: {
            ...BASIC_SQUARE_ENEMY_DATA,
            shapeDefinitionId: 'nonagon'
        },
        route: FIXTURE_ROUTE,
        spawnSequence: 99
    }), /지원하지 않는 GPU enemy shapeDefinitionId/);
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: {
            ...BASIC_SQUARE_ENEMY_DATA,
            shapeDefinitionId: null
        },
        route: FIXTURE_ROUTE,
        spawnSequence: 100
    }), /enemy shapeDefinitionId/);
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: BASIC_SQUARE_ENEMY_DATA,
        route: {
            ...FIXTURE_ROUTE,
            waypoints: [
                { x: -Number.MAX_VALUE, y: 0 },
                { x: Number.MAX_VALUE, y: 0 }
            ]
        },
        spawnSequence: 101
    }), /첫 두 waypoint/);
});

test('WaveDirector는 단일 timeline을 tick 1 + 5n에서 shape/lane 순서대로 컴파일한다', () => {
    const director = new WaveDirector();
    const scheduled = [];
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    assert.equal(director.init(tileMap), true);

    const commandOwner = {
        requestSpawnBatch(requests) {
            scheduled.push(...requests);
            return {
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            };
        }
    };
    const route = tileMap.getSpawnRoutes()[0];
    const routeEntry = route.waypoints[0];
    const next = route.waypoints[1];
    const directionLength = Math.hypot(next.x - routeEntry.x, next.y - routeEntry.y);
    const normalX = -(next.y - routeEntry.y) / directionLength;
    const normalY = (next.x - routeEntry.x) / directionLength;
    for (let tick = 1; tick <= 156; tick++) {
        director.queueSpawnsForFixedTick(tick, commandOwner);
    }

    assert.equal(scheduled.length, 32);
    for (let index = 0; index < scheduled.length; index++) {
        const entry = scheduled[index];
        const expected = EXPECTED_PRODUCTION_WAVE_ARCHETYPES[
            index % EXPECTED_PRODUCTION_WAVE_ARCHETYPES.length
        ];
        assert.equal(entry.targetFixedTick, 1 + (index * 5));
        assert.equal(entry.intent.spawnSequence, index);
        assert.equal(entry.intent.definitionId, expected.definition.id);
        assert.equal(entry.intent.renderStyle.shapeCode, expected.shapeCode);
        const laneOffset = EXPECTED_LANE_OFFSETS[index % EXPECTED_LANE_OFFSETS.length];
        assert.equal(entry.intent.position.x, routeEntry.x + (normalX * laneOffset));
        assert.equal(entry.intent.position.y, routeEntry.y + (normalY * laneOffset));
        assert.equal(
            entry.intent.velocity.x,
            ((next.x - routeEntry.x) / directionLength) * entry.intent.flowSpeed
        );
        assert.equal(
            entry.intent.velocity.y,
            ((next.y - routeEntry.y) / directionLength) * entry.intent.flowSpeed
        );
        assert.equal(
            entry.commandId,
            `authored-wave-spawn:corridor_eight_wave_01:main-authored-duration:main-deterministic-cycle:spawn-${index}`
        );
    }
    assert.equal(director.getStatus().allSpawnsQueued, true);
    director.destroy();
});

test('WaveDirector는 circle singular enemyDefinitionId timeline schema를 지원한다', () => {
    const director = new WaveDirector({
        waveDefinition: {
            waveId: 'legacy_singular_wave',
            mapId: CORRIDOR_EIGHT_MAP_DATA.id,
            timeline: [{
                timelineEntryId: 'legacy-singular-duration',
                type: 'SPAWN_FOR_DURATION',
                durationSeconds: 4 / 60,
                spawnGroups: [{
                    groupId: 'legacy-singular-group',
                    enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
                    routeBinding: {
                        gateId: CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].gateId,
                        pathId: CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].pathId
                    },
                    count: 2,
                    intervalTicks: 3,
                    policyId: 'corebound',
                    laneOffsetsTiles: [0]
                }]
            }]
        }
    });
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    const scheduled = [];
    assert.equal(director.init(tileMap), true);
    const commandOwner = {
        requestSpawnBatch(requests) {
            scheduled.push(...requests);
            return {
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            };
        }
    };
    for (let tick = 1; tick <= 4; tick++) {
        director.queueSpawnsForFixedTick(tick, commandOwner);
    }
    assert.deepEqual(
        scheduled.map(({ intent }) => intent.definitionId),
        [BASIC_CIRCLE_ENEMY_DATA.id, BASIC_CIRCLE_ENEMY_DATA.id]
    );
    assert.deepEqual(
        scheduled.map(({ intent }) => intent.renderStyle.shapeCode),
        [GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE, GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE]
    );
    assert.deepEqual(
        scheduled.map(({ commandId }) => commandId),
        [
            'authored-wave-spawn:legacy_singular_wave:legacy-singular-duration:legacy-singular-group:spawn-0',
            'authored-wave-spawn:legacy_singular_wave:legacy-singular-duration:legacy-singular-group:spawn-1'
        ]
    );
    director.destroy();
});

test('render WGSL은 32-byte style의 shape code만 사용하고 compute WGSL을 확장하지 않는다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.STRIDE, 32);
    assert.equal(GPU_CIRCLE_BODY_ABI.RENDER_STYLE.SHAPE_CODE, 24);
    assert.match(GPU_COLLISION_RENDER_WGSL, /shape_code: u32/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn directional_local_position/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn box_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn polygon_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn arrow_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn generator_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn jorang_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn shape_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fwidth\(distance\)/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /discard/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /length\(input\.local_position\) > 1\.0/);
    assert.doesNotMatch(GPU_COLLISION_RENDER_WGSL, /head_half_width|shaft|center_hole/);

    const normalized = ENEMY_NORMALIZED_RENDER_GEOMETRY;
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const SQUARE_HALF_SIZE: vec2f = ${toWgslVec2(normalized.square.box.halfSize)};`
    ));
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes('const ARROW_POINTS = array<vec2f, 8>('));
    for (const point of normalized.arrow.points) {
        assert.ok(GPU_COLLISION_RENDER_WGSL.includes(toWgslVec2(point)));
    }
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes('const RHOM_POINTS = array<vec2f, 8>('));
    for (const point of normalized.rhom.points) {
        assert.ok(GPU_COLLISION_RENDER_WGSL.includes(toWgslVec2(point)));
    }
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /shape_code == RENDER_SHAPE_RHOM[\s\S]*polygon_distance\(point, RHOM_POINTS, 4u\)/
    );
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        'const OCTA_POINTS = array<vec2f, 8>('
    ));
    for (const point of normalized.octa.points) {
        assert.ok(GPU_COLLISION_RENDER_WGSL.includes(toWgslVec2(point)));
    }
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /shape_code == RENDER_SHAPE_OCTA[\s\S]*directional_local_position\(point, velocity\)[\s\S]*OCTA_POINTS,[\s\S]*8u/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /directional_defense_active[\s\S]*behavior\.charge_direction/
    );
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(toWgslVec2(
        normalized.penta.points[0]
    )));
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const GENERATOR_OUTER_HALF_SIZE: vec2f = ${toWgslVec2(normalized.gen.outerBox.halfSize)};`
    ));
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const GENERATOR_INNER_HALF_SIZE: vec2f = ${toWgslVec2(normalized.gen.innerBox.halfSize)};`
    ));
    assert.match(GPU_COLLISION_RENDER_WGSL, /var distance = max\(outer, -inner\)/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /index < 4u/);
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /fn jorang_distance[\s\S]*polygon_distance\([\s\S]*JORANG_LEFT_LOBE_POINTS,[\s\S]*8u[\s\S]*JORANG_RIGHT_LOBE_POINTS,[\s\S]*8u[\s\S]*box_distance\([\s\S]*JORANG_CONNECTOR_CENTER,[\s\S]*JORANG_CONNECTOR_HALF_SIZE[\s\S]*return min\(min\(left_lobe, right_lobe\), connector\)/
    );
    assert.doesNotMatch(GPU_COLLISION_RENDER_WGSL, /JORANG_BOX_/);
    assert.match(GPU_COLLISION_RENDER_WGSL,
        /shape_code == RENDER_SHAPE_JORANG[\s\S]*return jorang_distance\(point\)/);
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /shape_code == RENDER_SHAPE_CORK[\s\S]*polygon_distance\(point, CORK_POINTS, 4u\)/
    );
    assert.equal(BASIC_GEN_ENEMY_DATA.shapeDefinitionId, 'jorang');
    assert.notEqual(
        GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG,
        GPU_CIRCLE_BODY_RENDER_SHAPE.GEN
    );

    for (const [name, code] of Object.entries(GPU_CIRCLE_BODY_RENDER_SHAPE)) {
        assert.match(
            GPU_COLLISION_RENDER_WGSL,
            new RegExp(`const RENDER_SHAPE_${name}: u32 = ${code}u;`)
        );
    }

    assert.doesNotMatch(GPU_COLLISION_COMPUTE_WGSL, /shape_code/);
    assert.doesNotMatch(GPU_COLLISION_COMPUTE_WGSL, /BodyRenderStyle/);
    assert.doesNotMatch(GPU_COLLISION_COMPUTE_WGSL, /RENDER_SHAPE_/);
});

test('default actual shape smoke는 J 두 lobe·연결 허리·대칭 notch를 샘플한다', () => {
    assert.match(
        NW_WEBGPU_CAPABILITY_RUNNER_SOURCE,
        /const jorangGeometry = ENEMY_NORMALIZED_RENDER_GEOMETRY\.jorang/
    );
    assert.match(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangGeometry\.lobes/);
    assert.match(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangGeometry\.connector/);
    assert.match(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangConnectedOffsets/);
    assert.match(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangWaistGapOffsets/);
    assert.match(
        NW_WEBGPU_CAPABILITY_RUNNER_SOURCE,
        /jorangConnectedAlphas\.every\(\(alpha\) => alpha >= 192\)/
    );
    assert.match(
        NW_WEBGPU_CAPABILITY_RUNNER_SOURCE,
        /jorangWaistGapAlphas\.every\(\(alpha\) => alpha < 16\)/
    );
    assert.doesNotMatch(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangStrokeOffsets/);
    assert.doesNotMatch(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /jorangGapOffsets/);
    assert.doesNotMatch(NW_WEBGPU_CAPABILITY_RUNNER_SOURCE, /four-stroke\/gap/);
    assert.doesNotMatch(
        NW_WEBGPU_CAPABILITY_RUNNER_SOURCE,
        /generator square hole\/ring\/terminal topology/
    );
});

console.log('gpu enemy shape pipeline contract: ok');
