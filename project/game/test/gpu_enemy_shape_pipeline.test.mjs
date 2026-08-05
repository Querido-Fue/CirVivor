import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_GEN_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITIONS,
    INGAME_ENEMY_DEFINITION_BY_ID,
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
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
        shapeType: 'gen',
        shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.GEN
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

test('main GPU enemy catalog과 단일 wave phase는 65% radius·shape cycle·lane 순서를 고정한다', () => {
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
        assert.equal(definition.collisionWeight, 1);
        assert.equal(definition.radiusScale, 1);
        assert.strictEqual(INGAME_ENEMY_DEFINITION_BY_ID[definition.id], definition);
    }

    assert.equal(Object.isFrozen(CORRIDOR_EIGHT_WAVE_01_DATA), true);
    assert.equal(Object.isFrozen(CORRIDOR_EIGHT_WAVE_01_DATA.phases), true);
    assert.equal(CORRIDOR_EIGHT_WAVE_01_DATA.phases.length, 1);
    const phase = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0];
    const group = phase.spawnGroups[0];
    assert.equal(Object.isFrozen(phase), true);
    assert.equal(Object.isFrozen(phase.spawnGroups), true);
    assert.equal(Object.isFrozen(group), true);
    assert.equal(Object.isFrozen(group.enemyDefinitionIds), true);
    assert.equal(Object.isFrozen(group.laneOffsetsTiles), true);
    assert.equal(phase.startTick, 1);
    assert.equal(phase.durationTicks, 156);
    assert.equal(group.count, 32);
    assert.equal(group.intervalTicks, 5);
    assert.equal(group.enemyDefinitionId, BASIC_SQUARE_ENEMY_DATA.id);
    assert.deepEqual(
        Array.from(group.enemyDefinitionIds),
        EXPECTED_ARCHETYPES.map(({ definition }) => definition.id)
    );
    assert.deepEqual(Array.from(group.laneOffsetsTiles), EXPECTED_LANE_OFFSETS);
    const sameLaneTravel = BASIC_SQUARE_ENEMY_DATA.moveSpeedTilesPerSecond
        * ((group.intervalTicks * group.laneOffsetsTiles.length) / 60);
    assert.ok(
        sameLaneTravel > MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES * 2,
        '같은 lane의 다음 spawn 전에 이전 적이 collider 지름보다 멀리 이동해야 합니다.'
    );
});

test('legacy SVG raw path와 GPU normalized geometry는 단일 data 권위를 공유한다', () => {
    assert.equal(ENEMY_SVG_DRAW_SIZE_RATIO, 0.90);
    assert.equal(ENEMY_ASPECT_RATIO.arrow, 0.96);
    assert.equal(ENEMY_HEIGHT_SCALE.arrow, 0.9);
    assert.equal(ENEMY_ASPECT_RATIO.gen, 1.05);
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
    assertClose(normalized.gen.outerBox.halfSize.x, 0.47729707730091964);
    assertClose(normalized.gen.outerBox.halfSize.y, 0.45456864504849487);
    assertClose(normalized.gen.innerBox.halfSize.x, 0.35001785668734103);
    assertClose(normalized.gen.innerBox.halfSize.y, 0.33335033970222955);
    assert.equal(normalized.gen.terminalBoxes.length, 4);
    assertClose(normalized.gen.terminalBoxes[0].center.x, -0.6204862004911955);
    assertClose(normalized.gen.terminalBoxes[0].center.y, -0.5909392385620433);
});

test('enemy spawn adapter는 지원 shape만 숫자 render style code로 전달한다', () => {
    for (let index = 0; index < EXPECTED_ARCHETYPES.length; index++) {
        const { definition, shapeCode } = EXPECTED_ARCHETYPES[index];
        const intent = createGpuEnemySpawnIntent({
            definition,
            route: FIXTURE_ROUTE,
            spawnSequence: index,
            laneOffsetTiles: 0
        });
        assert.equal(Object.isFrozen(intent), true);
        assert.equal(Object.isFrozen(intent.renderStyle), true);
        assert.equal(intent.radius, MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES);
        assert.equal(intent.velocity.x, definition.moveSpeedTilesPerSecond);
        assert.equal(intent.velocity.y, 0);
        assert.equal(Math.hypot(intent.velocity.x, intent.velocity.y), intent.flowSpeed);
        assert.equal(intent.renderStyle.radiusScale, 1);
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
            shapeType: 'octa'
        },
        route: FIXTURE_ROUTE,
        spawnSequence: 99
    }), /지원하지 않는 GPU enemy shapeType/);
    assert.throws(() => createGpuEnemySpawnIntent({
        definition: {
            ...BASIC_SQUARE_ENEMY_DATA,
            shapeType: null
        },
        route: FIXTURE_ROUTE,
        spawnSequence: 100
    }), /enemy shapeType/);
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

test('WaveDirector는 단일 phase를 tick 1 + 5n에서 shape/lane 순서대로 컴파일한다', () => {
    const director = new WaveDirector();
    const scheduled = [];
    const tileMap = createTileMap(CORRIDOR_EIGHT_MAP_DATA.id);
    assert.equal(director.init(tileMap), true);

    const commandOwner = {
        requestSpawn(intent, targetFixedTick, commandId) {
            scheduled.push({ intent, targetFixedTick, commandId });
            return { accepted: true };
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
        const expected = EXPECTED_ARCHETYPES[index % EXPECTED_ARCHETYPES.length];
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
        assert.equal(entry.commandId, `corridor_eight_wave_01:0:0:${index}`);
    }
    assert.equal(director.getStatus().allSpawnsQueued, true);
    director.destroy();
});

test('WaveDirector는 legacy circle의 singular enemyDefinitionId wave schema를 그대로 지원한다', () => {
    const director = new WaveDirector({
        waveDefinition: {
            waveId: 'legacy_singular_wave',
            mapId: CORRIDOR_EIGHT_MAP_DATA.id,
            phases: [{
                startTick: 1,
                durationTicks: 4,
                spawnGroups: [{
                    enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
                    gateId: CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].gateId,
                    pathChoicePolicy: 'fixed-route',
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
        requestSpawn(intent, targetFixedTick, commandId) {
            scheduled.push({ intent, targetFixedTick, commandId });
            return { accepted: true };
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
        ['legacy_singular_wave:0:0:0', 'legacy_singular_wave:0:0:1']
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
    assert.match(GPU_COLLISION_RENDER_WGSL, /fn shape_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /fwidth\(distance\)/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /discard/);
    assert.match(GPU_COLLISION_RENDER_WGSL, /length\(input\.local_position\) > 1\.0/);
    assert.doesNotMatch(GPU_COLLISION_RENDER_WGSL, /head_half_width|shaft|center_hole/);

    const normalized = ENEMY_NORMALIZED_RENDER_GEOMETRY;
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes(
        `const SQUARE_HALF_SIZE: vec2f = ${toWgslVec2(normalized.square.box.halfSize)};`
    ));
    assert.ok(GPU_COLLISION_RENDER_WGSL.includes('const ARROW_POINTS = array<vec2f, 6>('));
    for (const point of normalized.arrow.points) {
        assert.ok(GPU_COLLISION_RENDER_WGSL.includes(toWgslVec2(point)));
    }
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

console.log('gpu enemy shape pipeline contract: ok');
