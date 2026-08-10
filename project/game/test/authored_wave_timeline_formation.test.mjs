import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    INGAME_ENEMY_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const { ARCHER_ENEMY_DATA } = await loadGameModule(
    'data/object/enemy/archer_enemy_data.js'
);
const {
    resolveBasicHexaTransformPrivateDefinition
} = await loadGameModule('data/object/enemy/basic_hexa_enemy_data.js');
const { CORRIDOR_EIGHT_WAVE_01_DATA } = await loadGameModule(
    'data/scene/game/corridor_eight_wave_01_data.js'
);
const {
    AUTHORED_FORMATION_COORDINATE_SYSTEM,
    AUTHORED_FORMATION_SPAWN_MODE,
    AUTHORED_WAVE_COMPILE_ERROR_CODE,
    AUTHORED_WAVE_COMPILE_LIMIT,
    AUTHORED_WAVE_FIXED_TICKS_PER_SECOND,
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} = await loadGameModule('ingame/flow/authored_wave_timeline_contract.js');
const {
    FORMATION_COORDINATE_SYSTEM
} = await loadGameModule('ingame/contract/enemy_formation_contract.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');

const FIXTURE_MAP_ID = 'authored-wave-fixture-map';
const FIXTURE_ROUTE = Object.freeze({
    gateId: 'fixture-gate',
    pathId: 'fixture-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 10, y: 10 }),
        Object.freeze({ x: 20, y: 10 }),
        Object.freeze({ x: 20, y: 20 })
    ])
});
const FIXTURE_ROUTE_BINDING = Object.freeze({
    gateId: FIXTURE_ROUTE.gateId,
    pathId: FIXTURE_ROUTE.pathId
});

function createFixtureTileMap(options = {}) {
    const minimum = Number(options.minimum ?? 0);
    const maximum = Number(options.maximum ?? 100);
    return {
        mapId: FIXTURE_MAP_ID,
        getSpawnRoutes() {
            return [FIXTURE_ROUTE];
        },
        getEnemyModifiers() {
            return undefined;
        },
        worldToTile(x, y, out = {}) {
            out.column = Math.floor(x);
            out.row = Math.floor(y);
            out.inside = Number.isFinite(x)
                && Number.isFinite(y)
                && x >= minimum
                && x < maximum
                && y >= minimum
                && y < maximum;
            return out;
        },
        isWalkableTile(row, column) {
            return Number.isInteger(row)
                && Number.isInteger(column)
                && row >= minimum
                && row < maximum
                && column >= minimum
                && column < maximum;
        }
    };
}

function createWave(waveId, timeline) {
    return {
        waveId,
        mapId: FIXTURE_MAP_ID,
        timeline
    };
}

function createDurationGroup(overrides = {}) {
    return {
        groupId: 'duration-group',
        enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
        routeBinding: FIXTURE_ROUTE_BINDING,
        policyId: 'corebound',
        count: 1,
        intervalTicks: 1,
        laneOffsetsTiles: [0],
        ...overrides
    };
}

function createImmediateGroup(overrides = {}) {
    return {
        groupId: 'immediate-group',
        enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
        routeBinding: FIXTURE_ROUTE_BINDING,
        policyId: 'corebound',
        count: 1,
        laneOffsetsTiles: [0],
        ...overrides
    };
}

function createFormation(overrides = {}) {
    return {
        groupId: 'formation-group',
        memberCount: 1,
        coordinateSystem: AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE,
        spawnMode: AUTHORED_FORMATION_SPAWN_MODE.ALL_AT_ONCE,
        rowDelayTicks: 0,
        keepFormation: false,
        layout: ['C'],
        symbolMap: { C: BASIC_CIRCLE_ENEMY_DATA.id },
        routeBinding: FIXTURE_ROUTE_BINDING,
        policyId: 'corebound',
        rowSpacingTiles: 1,
        columnSpacingTiles: 1,
        ...overrides
    };
}

function createPersistentHexFormation(overrides = {}) {
    return createFormation({
        memberCount: 6,
        rows: 3,
        columns: 3,
        coordinateSystem: AUTHORED_FORMATION_COORDINATE_SYSTEM.HEX_AXIAL,
        keepFormation: true,
        layout: ['.HH', 'H.H', 'HH.'],
        symbolMap: { H: BASIC_HEXA_ENEMY_DATA.id },
        ...overrides
    });
}

function createAtomicSink() {
    const batches = [];
    return {
        batches,
        requestSpawnBatch(requests) {
            batches.push(requests);
            return {
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            };
        }
    };
}

test('timeline cursor는 duration/wait/group/formation을 60Hz exact tick으로 compile한다', () => {
    assert.equal(AUTHORED_WAVE_FIXED_TICKS_PER_SECOND, 60);
    const waveDefinition = createWave('cursor wave/01', [
        {
            timelineEntryId: 'duration / α',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION,
            durationSeconds: 2,
            spawnGroups: [createDurationGroup({
                groupId: 'duration:group',
                count: 3,
                intervalTicks: 30
            })]
        },
        {
            timelineEntryId: 'wait',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
            durationSeconds: 1
        },
        {
            timelineEntryId: 'group',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
            spawnGroup: createImmediateGroup({ count: 2 })
        },
        {
            timelineEntryId: 'formation',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
            formation: createFormation()
        }
    ]);
    const director = new WaveDirector({ waveDefinition });
    assert.equal(director.init(createFixtureTileMap()), true);
    assert.deepEqual(
        Array.from(director.schedule, ({ targetFixedTick }) => targetFixedTick),
        [1, 31, 61, 181, 181, 182]
    );
    assert.equal(
        director.schedule[0].commandId,
        'authored-wave-spawn:cursor%20wave%2F01:duration%20%2F%20%CE%B1:duration%3Agroup:spawn-0'
    );
    assert.equal(director.schedule[3].commandId.endsWith(':spawn-0'), true);
    assert.equal(director.schedule[5].commandId.endsWith(':member-0-0'), true);

    const sink = createAtomicSink();
    for (let tick = 1; tick <= 182; tick++) {
        director.queueSpawnsForFixedTick(tick, sink);
    }
    const tick181Batch = sink.batches.find((batch) => (
        batch[0]?.targetFixedTick === 181
    ));
    assert.equal(tick181Batch.length, 2);
    assert.equal(sink.batches.length, 5);
    assert.equal(director.getStatus().allSpawnsQueued, true);
    director.destroy();
});

test('concurrent duration groups의 같은 tick spawn은 requestSpawnBatch 한 번만 사용한다', () => {
    const waveDefinition = createWave('concurrent-wave', [{
        timelineEntryId: 'concurrent',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION,
        durationSeconds: 1,
        spawnGroups: [
            createDurationGroup({ groupId: 'left', laneOffsetsTiles: [-1] }),
            createDurationGroup({
                groupId: 'right',
                enemyDefinitionId: BASIC_TRIANGLE_ENEMY_DATA.id,
                laneOffsetsTiles: [1]
            })
        ]
    }]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    const sink = createAtomicSink();
    assert.equal(director.queueSpawnsForFixedTick(1, sink), 2);
    assert.equal(sink.batches.length, 1);
    assert.equal(sink.batches[0].length, 2);
    assert.deepEqual(
        Array.from(sink.batches[0], ({ intent }) => intent.definitionId),
        [BASIC_CIRCLE_ENEMY_DATA.id, BASIC_TRIANGLE_ENEMY_DATA.id]
    );
    const missingSinkDirector = new WaveDirector({ waveDefinition });
    missingSinkDirector.init(createFixtureTileMap());
    assert.throws(
        () => missingSinkDirector.queueSpawnsForFixedTick(1, {}),
        /requestSpawnBatch/
    );
    missingSinkDirector.destroy();
    director.destroy();
});

test('WaveDirector definition snapshot은 Effect emitter profile identity를 보존한다', () => {
    const waveDefinition = createWave('penta-profile-snapshot-wave', [{
        timelineEntryId: 'penta-profile-snapshot',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: createImmediateGroup({
            groupId: 'penta-profile-snapshot-group',
            enemyDefinitionId: BASIC_PENTA_ENEMY_DATA.id
        })
    }]);
    const director = new WaveDirector({ waveDefinition });
    assert.equal(director.init(createFixtureTileMap()), true);
    assert.equal(
        director.schedule[0].definition.effectEmitterProfileId,
        BASIC_PENTA_ENEMY_DATA.effectEmitterProfileId
    );
    const sink = createAtomicSink();
    assert.equal(director.queueSpawnsForFixedTick(1, sink), 1);
    assert.equal(
        sink.batches[0][0].intent.effectEmitterProfileId,
        BASIC_PENTA_ENEMY_DATA.effectEmitterProfileId
    );
    director.destroy();
});

test('atomic batch 거절은 schedule index를 보존하고 동일 command identity로 재시도한다', () => {
    const waveDefinition = createWave('atomic-retry-wave', [{
        timelineEntryId: 'atomic-retry-entry',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: createImmediateGroup({
            groupId: 'atomic-retry-group',
            count: 2,
            laneOffsetsTiles: [-1, 1]
        })
    }]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    const attempts = [];
    const snapshotRequests = (requests) => Array.from(requests, (request) => ({
        commandId: request.commandId,
        targetFixedTick: request.targetFixedTick,
        spawnSequence: request.intent.spawnSequence,
        definitionId: request.intent.definitionId
    }));
    assert.throws(() => director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch(requests) {
            attempts.push(snapshotRequests(requests));
            return {
                accepted: false,
                requestedCount: requests.length,
                queuedCount: 0
            };
        }
    }), /atomic spawn batch queue 실패/);
    assert.deepEqual({ ...director.getStatus() }, {
        waveId: 'atomic-retry-wave',
        initialized: true,
        totalSpawnCount: 2,
        queuedSpawnCount: 0,
        remainingSpawnCount: 2,
        allSpawnsQueued: false,
        completionOwned: false,
        fixedTickOffset: 0
    });

    assert.equal(director.queueSpawnsForFixedTick(1, {
        requestSpawnBatch(requests) {
            attempts.push(snapshotRequests(requests));
            return {
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            };
        }
    }), 2);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(director.getStatus().queuedSpawnCount, 2);
    assert.equal(director.getStatus().allSpawnsQueued, true);
    director.destroy();
});

test('fixedTickOffset은 target tick만 이동시키고 authored command identity는 보존한다', () => {
    const waveDefinition = createWave('offset-wave', [{
        timelineEntryId: 'entry',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: createImmediateGroup()
    }]);
    const base = new WaveDirector({ waveDefinition });
    const shifted = new WaveDirector({ waveDefinition, fixedTickOffset: 500 });
    base.init(createFixtureTileMap());
    shifted.init(createFixtureTileMap());
    assert.equal(base.schedule[0].targetFixedTick, 1);
    assert.equal(shifted.schedule[0].targetFixedTick, 501);
    assert.equal(shifted.schedule[0].commandId, base.schedule[0].commandId);
    assert.equal(base.getStatus().waveId, 'offset-wave');
    assert.equal(shifted.getStatus().waveId, 'offset-wave');
    waveDefinition.waveId = 'mutated-after-init';
    assert.equal(base.getStatus().waveId, 'offset-wave');
    assert.equal(shifted.getStatus().waveId, 'offset-wave');
    assert.equal(base.schedule[0].waveId, 'offset-wave');
    assert.equal(shifted.schedule[0].waveId, 'offset-wave');
    base.destroy();
    shifted.destroy();
});

test('PATH_RELATIVE formation은 first segment forward/normal과 sequential row delay를 사용한다', () => {
    const waveDefinition = createWave('path-formation-wave', [
        {
            timelineEntryId: 'path-formation',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
            formation: createFormation({
                groupId: 'path-relative',
                memberCount: 5,
                rows: 2,
                columns: 3,
                spawnMode: AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
                rowDelayTicks: 4,
                layout: ['C.C', 'TTT'],
                symbolMap: {
                    C: BASIC_CIRCLE_ENEMY_DATA.id,
                    T: BASIC_TRIANGLE_ENEMY_DATA.id
                },
                rowSpacingTiles: 3,
                columnSpacingTiles: 2,
                anchorOffsetTiles: { x: 0.5, y: 1 }
            })
        },
        {
            timelineEntryId: 'after-formation',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
            spawnGroup: createImmediateGroup({ groupId: 'after' })
        }
    ]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    assert.deepEqual(
        Array.from(director.schedule, ({ targetFixedTick }) => targetFixedTick),
        [1, 1, 5, 5, 5, 6]
    );
    assert.deepEqual(
        Array.from(
            director.schedule.slice(0, 5),
            ({ initialWorldOffsetTiles }) => ({ ...initialWorldOffsetTiles })
        ),
        [
            { x: 1, y: -1.5 },
            { x: 1, y: 2.5 },
            { x: 4, y: -1.5 },
            { x: 4, y: 0.5 },
            { x: 4, y: 2.5 }
        ]
    );
    const sink = createAtomicSink();
    assert.equal(director.queueSpawnsForFixedTick(1, sink), 2);
    const positions = Array.from(
        sink.batches[0],
        ({ intent }) => ({ ...intent.position })
    );
    assert.deepEqual(positions, [
        { x: 11, y: 8.5 },
        { x: 11, y: 12.5 }
    ]);
    for (const { intent } of sink.batches[0]) {
        assert.equal('initialWorldOffsetTiles' in intent, false);
        assert.equal('groupId' in intent, false);
        assert.equal('timelineEntryId' in intent, false);
    }
    director.destroy();
});

test('formation rows/columns는 raw rectangular layout에서 derive되며 dot-only extent를 보존한다', () => {
    const createDimensionWave = (dimensions = {}) => createWave(
        'dimension-formation-wave',
        [
            {
                timelineEntryId: 'dimension-formation',
                type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
                formation: createFormation({
                    groupId: 'dimension-group',
                    memberCount: 2,
                    spawnMode: AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
                    rowDelayTicks: 3,
                    layout: ['C.', '..', 'T.'],
                    symbolMap: {
                        C: BASIC_CIRCLE_ENEMY_DATA.id,
                        T: BASIC_TRIANGLE_ENEMY_DATA.id
                    },
                    ...dimensions
                })
            },
            {
                timelineEntryId: 'after-dimension-formation',
                type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
                spawnGroup: createImmediateGroup({ groupId: 'after-dimension' })
            }
        ]
    );
    const derived = new WaveDirector({ waveDefinition: createDimensionWave() });
    const explicit = new WaveDirector({
        waveDefinition: createDimensionWave({ rows: 3, columns: 2 })
    });
    derived.init(createFixtureTileMap());
    explicit.init(createFixtureTileMap());
    const snapshot = (director) => Array.from(director.schedule, (entry) => ({
        commandId: entry.commandId,
        targetFixedTick: entry.targetFixedTick,
        offset: { ...entry.initialWorldOffsetTiles }
    }));
    assert.deepEqual(snapshot(explicit), snapshot(derived));
    assert.deepEqual(
        Array.from(derived.schedule, ({ targetFixedTick }) => targetFixedTick),
        [1, 7, 8]
    );
    assert.deepEqual(
        Array.from(
            derived.schedule.slice(0, 2),
            ({ commandId }) => commandId.slice(commandId.lastIndexOf(':') + 1)
        ),
        ['member-0-0', 'member-2-0']
    );
    derived.destroy();
    explicit.destroy();
});

test('같은 tick formation retry는 exact member command identity를 보존한다', () => {
    const waveDefinition = createWave('formation-retry-wave', [{
        timelineEntryId: 'formation-retry-entry',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createFormation({
            groupId: 'formation-retry-group',
            memberCount: 2,
            layout: ['CC']
        })
    }]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    const attempts = [];
    const request = (accepted) => ({
        requestSpawnBatch(requests) {
            attempts.push(Array.from(requests, ({ commandId, targetFixedTick, intent }) => ({
                commandId,
                targetFixedTick,
                definitionId: intent.definitionId,
                spawnSequence: intent.spawnSequence
            })));
            return {
                accepted,
                requestedCount: requests.length,
                queuedCount: accepted ? requests.length : 0
            };
        }
    });
    assert.throws(
        () => director.queueSpawnsForFixedTick(1, request(false)),
        /atomic spawn batch queue 실패/
    );
    assert.equal(director.getStatus().queuedSpawnCount, 0);
    assert.equal(director.queueSpawnsForFixedTick(1, request(true)), 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.deepEqual(
        Array.from(
            attempts[1],
            ({ commandId }) => commandId.slice(commandId.lastIndexOf(':') + 1)
        ),
        ['member-0-0', 'member-0-1']
    );
    director.destroy();
});

test('LINEAR_GRID formation offset은 route 방향과 무관한 world +X/+Y다', () => {
    const waveDefinition = createWave('linear-formation-wave', [{
        timelineEntryId: 'linear',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createFormation({
            coordinateSystem: AUTHORED_FORMATION_COORDINATE_SYSTEM.LINEAR_GRID,
            anchorOffsetTiles: { x: 2, y: 3 }
        })
    }]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    assert.deepEqual(
        { ...director.schedule[0].initialWorldOffsetTiles },
        { x: 2, y: 3 }
    );
    const sink = createAtomicSink();
    director.queueSpawnsForFixedTick(1, sink);
    assert.deepEqual(
        { ...sink.batches[0][0].intent.position },
        { x: 12, y: 13 }
    );
    director.destroy();
});

test('persistent H HEX_AXIAL formation은 six-ring provenance를 exact compile한다', () => {
    assert.strictEqual(
        AUTHORED_FORMATION_COORDINATE_SYSTEM,
        FORMATION_COORDINATE_SYSTEM
    );
    assert.deepEqual({ ...AUTHORED_FORMATION_COORDINATE_SYSTEM }, {
        LINEAR_GRID: 'LINEAR_GRID',
        HEX_AXIAL: 'HEX_AXIAL',
        PATH_RELATIVE: 'PATH_RELATIVE'
    });
    const keepFormationWave = createWave('keep-formation-wave', [{
        timelineEntryId: 'keep',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createPersistentHexFormation()
    }]);
    const director = new WaveDirector({ waveDefinition: keepFormationWave });
    assert.equal(director.init(createFixtureTileMap()), true);
    assert.deepEqual(
        Array.from(
            director.schedule,
            ({ formationProvenance }) => (
                formationProvenance.formationMemberSlotIndex
            )
        ),
        [2, 1, 3, 0, 4, 5]
    );
    assert.deepEqual(
        Array.from(
            director.schedule,
            ({ formationProvenance }) => (
                formationProvenance.formationMemberIndex
            )
        ),
        [0, 1, 2, 3, 4, 5]
    );
    assert.deepEqual(
        Array.from(
            director.schedule,
            ({ initialWorldOffsetTiles }) => ({ ...initialWorldOffsetTiles })
        ),
        [
            { x: -0.5, y: -1 },
            { x: 0.5, y: -1 },
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: -0.5, y: 1 },
            { x: 0.5, y: 1 }
        ]
    );
    const sink = createAtomicSink();
    assert.equal(director.queueSpawnsForFixedTick(1, sink), 6);
    for (let index = 0; index < sink.batches[0].length; index++) {
        const intent = sink.batches[0][index].intent;
        assert.equal(intent.formationGroupId, 'formation-group');
        assert.equal(intent.formationAuthoredMemberCount, 6);
        assert.equal(intent.formationRows, 3);
        assert.equal(intent.formationColumns, 3);
        assert.equal(intent.formationAuthoredOccupiedSlotMask, 63);
        assert.equal(intent.formationMemberSlotIndex, [2, 1, 3, 0, 4, 5][index]);
        assert.equal(intent.formationMemberCount, 1);
        assert.equal('formationState' in intent, false);
        assert.equal('formationLineageHash' in intent, false);
    }
    director.destroy();
});

test('persistent H atomic retry는 command와 authored member/slot provenance를 보존한다', () => {
    const waveDefinition = createWave('persistent-retry-wave', [{
        timelineEntryId: 'persistent-retry',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createPersistentHexFormation()
    }]);
    const director = new WaveDirector({ waveDefinition });
    director.init(createFixtureTileMap());
    const attempts = [];
    const sink = (accepted) => ({
        requestSpawnBatch(requests) {
            attempts.push(Array.from(requests, ({ commandId, intent }) => ({
                commandId,
                formationGroupId: intent.formationGroupId,
                formationMemberIndex: intent.formationMemberIndex,
                formationMemberSlotIndex: intent.formationMemberSlotIndex,
                formationAuthoredOccupiedSlotMask:
                    intent.formationAuthoredOccupiedSlotMask
            })));
            return {
                accepted,
                requestedCount: requests.length,
                queuedCount: accepted ? requests.length : 0
            };
        }
    });
    assert.throws(
        () => director.queueSpawnsForFixedTick(1, sink(false)),
        /atomic spawn batch queue 실패/
    );
    assert.equal(director.getStatus().queuedSpawnCount, 0);
    assert.equal(director.queueSpawnsForFixedTick(1, sink(true)), 6);
    assert.deepEqual(attempts[1], attempts[0]);
    director.destroy();
});

test('persistent formation은 non-H/even-center/disconnected/out-of-ring을 publication 전에 거절한다', () => {
    const invalidFormations = [
        createPersistentHexFormation({
            memberCount: 1,
            rows: 1,
            columns: 3,
            layout: ['.C.'],
            symbolMap: { C: BASIC_CIRCLE_ENEMY_DATA.id }
        }),
        createPersistentHexFormation({
            memberCount: 2,
            rows: 2,
            columns: 3,
            layout: ['HH.', '...']
        }),
        createPersistentHexFormation({
            memberCount: 1,
            layout: ['...', '.H.', '...']
        }),
        createPersistentHexFormation({
            memberCount: 2,
            layout: ['..H', '...', 'H..']
        }),
        createPersistentHexFormation({
            memberCount: 1,
            rows: 5,
            columns: 5,
            layout: ['....H', '.....', '.....', '.....', '.....']
        })
    ];
    for (let index = 0; index < invalidFormations.length; index++) {
        const waveDefinition = createWave(`invalid-persistent-${index}`, [{
            timelineEntryId: 'invalid-persistent',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
            formation: invalidFormations[index]
        }]);
        assert.throws(
            () => new WaveDirector({ waveDefinition }).init(createFixtureTileMap()),
            (error) => error?.code
                === AUTHORED_WAVE_COMPILE_ERROR_CODE.FORMATION_CAPABILITY_REQUIRED
                || error?.code
                    === AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION
        );
    }

    const unknownCoordinateWave = createWave('unknown-coordinate-wave', [{
        timelineEntryId: 'unknown-coordinate',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createFormation({ coordinateSystem: 'HEX_OFFSET' })
    }]);
    assert.throws(
        () => new WaveDirector({ waveDefinition: unknownCoordinateWave })
            .init(createFixtureTileMap()),
        /알려진 vocabulary/
    );
});

test('authored/injected catalog는 transform-private H group/HX natural spawn을 거절한다', () => {
    for (const memberCount of [2, 6]) {
        const privateDefinition = resolveBasicHexaTransformPrivateDefinition(memberCount);
        const waveDefinition = createWave(`private-spawn-${memberCount}`, [{
            timelineEntryId: 'private-spawn',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
            spawnGroup: createImmediateGroup({
                enemyDefinitionId: privateDefinition.id
            })
        }]);
        const director = new WaveDirector({
            waveDefinition,
            enemyDefinitions: {
                ...INGAME_ENEMY_DEFINITION_BY_ID,
                [privateDefinition.id]: privateDefinition
            }
        });
        assert.throws(
            () => director.init(createFixtureTileMap()),
            (error) => error?.code
                === AUTHORED_WAVE_COMPILE_ERROR_CODE.TRANSFORM_PRIVATE_SPAWN_FORBIDDEN
        );
        assert.equal(director.schedule.length, 0);
    }
});

test('formation memberCount/dimensions/layout/symbol/route는 compile 전에 fail-fast한다', () => {
    const invalidFormations = [
        { ...createFormation(), size: 1 },
        createFormation({ memberCount: undefined }),
        createFormation({ memberCount: 2 }),
        createFormation({ memberCount: 3, layout: ['C', 'CC'] }),
        createFormation({ memberCount: 1, layout: [] }),
        createFormation({ memberCount: 1, layout: [''] }),
        createFormation({ memberCount: 1, layout: ['.'] }),
        createFormation({ memberCount: 1, layout: ['X'] }),
        createFormation({ rows: 1 }),
        createFormation({ columns: 1 }),
        createFormation({ rows: null, columns: null }),
        createFormation({ rows: 2, columns: 1 }),
        createFormation({ rows: 1, columns: 2 }),
        createFormation({ rows: 0, columns: 1 }),
        createFormation({ unknownFormationField: true }),
        createFormation({ symbolMap: {
            C: BASIC_CIRCLE_ENEMY_DATA.id,
            T: BASIC_TRIANGLE_ENEMY_DATA.id
        } }),
        createFormation({
            routeBinding: {
                gateId: FIXTURE_ROUTE.gateId,
                pathId: 'wrong-path'
            }
        })
    ];
    for (let index = 0; index < invalidFormations.length; index++) {
        const waveDefinition = createWave(`invalid-formation-${index}`, [{
            timelineEntryId: 'invalid',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
            formation: invalidFormations[index]
        }]);
        assert.throws(
            () => new WaveDirector({ waveDefinition }).init(createFixtureTileMap())
        );
    }

    const outsideWave = createWave('outside-wave', [{
        timelineEntryId: 'outside',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: createFormation({
            coordinateSystem: AUTHORED_FORMATION_COORDINATE_SYSTEM.LINEAR_GRID,
            anchorOffsetTiles: { x: 1000, y: 1000 }
        })
    }]);
    assert.throws(
        () => new WaveDirector({ waveDefinition: outsideWave })
            .init(createFixtureTileMap()),
        (error) => error?.code
            === AUTHORED_WAVE_COMPILE_ERROR_CODE.SPAWN_POSITION_NOT_WALKABLE
    );
});

test('timeline identity/duration/capacity 오류는 schedule publication 전에 거절된다', () => {
    const duplicateEntryWave = createWave('duplicate-entry-wave', [
        {
            timelineEntryId: 'same',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
            durationSeconds: 1
        },
        {
            timelineEntryId: 'same',
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
            durationSeconds: 1
        }
    ]);
    assert.throws(
        () => new WaveDirector({ waveDefinition: duplicateEntryWave })
            .init(createFixtureTileMap()),
        /timelineEntryId가 중복/
    );

    const inexactDurationWave = createWave('inexact-duration-wave', [{
        timelineEntryId: 'inexact',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 0.01
    }]);
    assert.throws(
        () => new WaveDirector({ waveDefinition: inexactDurationWave })
            .init(createFixtureTileMap()),
        /반올림 없이/
    );

    const overCapacityWave = createWave('over-capacity-wave', [{
        timelineEntryId: 'burst',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: createImmediateGroup({
            count: AUTHORED_WAVE_COMPILE_LIMIT.MAXIMUM_SPAWN_COUNT_PER_FIXED_TICK + 1
        })
    }]);
    assert.throws(
        () => new WaveDirector({ waveDefinition: overCapacityWave })
            .init(createFixtureTileMap()),
        (error) => error?.code
            === AUTHORED_WAVE_COMPILE_ERROR_CODE.FIXED_TICK_SPAWN_CAPACITY_EXCEEDED
    );
});

test('production timeline은 32/5와 Archer index를 보존한 C/T/A/M/C/T/Archer cycle이다', async () => {
    assert.equal(Object.isFrozen(CORRIDOR_EIGHT_WAVE_01_DATA.timeline), true);
    assert.equal(CORRIDOR_EIGHT_WAVE_01_DATA.timeline.length, 1);
    const entry = CORRIDOR_EIGHT_WAVE_01_DATA.timeline[0];
    const group = entry.spawnGroups[0];
    assert.equal(entry.type, AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION);
    assert.equal(entry.durationSeconds * 60, 156);
    assert.equal(group.count, 32);
    assert.equal(group.intervalTicks, 5);
    assert.deepEqual(Array.from(group.enemyDefinitionIds), [
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id,
        BASIC_ARROW_ENEMY_DATA.id,
        BASIC_RHOM_ENEMY_DATA.id,
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id,
        ARCHER_ENEMY_DATA.id
    ]);
    const director = new WaveDirector();
    const tileMapModule = await loadGameModule('ingame/map/tile_map.js');
    const mapDataModule = await loadGameModule(
        'data/scene/game/corridor_eight_map_data.js'
    );
    director.init(tileMapModule.createTileMap(mapDataModule.CORRIDOR_EIGHT_MAP_DATA.id));
    assert.deepEqual(
        Array.from(
            director.schedule,
            (scheduled, index) => ({ scheduled, index })
        )
            .filter(({ scheduled }) => scheduled.definition.id === ARCHER_ENEMY_DATA.id)
            .map(({ index }) => index),
        [6, 13, 20, 27]
    );
    assert.deepEqual(
        Array.from(director.schedule, ({ targetFixedTick }) => targetFixedTick),
        Array.from({ length: 32 }, (_, index) => 1 + (index * 5))
    );
    director.destroy();
});

test('authored source는 canonical formation schema와 독립 behavior union을 고정한다', async () => {
    const [contractSource, directorSource, adapterSource, behaviorAbiSource] = await Promise.all([
        readFile(new URL(
            '../script/module/ingame/flow/authored_wave_timeline_contract.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../script/module/ingame/flow/wave_director.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../script/module/ingame/physics/gpu/gpu_circle_body_abi.js',
            import.meta.url
        ), 'utf8')
    ]);
    assert.doesNotMatch(contractSource, /Math\.random|crypto\.getRandomValues/);
    assert.doesNotMatch(directorSource, /Math\.random|crypto\.getRandomValues/);
    assert.doesNotMatch(
        `${contractSource}\n${directorSource}`,
        /new\s+\w*(?:Enemy|Formation|Controller)\b/
    );
    assert.doesNotMatch(
        contractSource,
        /['"]size['"]|\bformation\.size\b|\browCount\b|\bcolumnCount\b/
    );
    assert.doesNotMatch(contractSource, /pending-capability:enemy-formation/);
    const behaviorProgramSource = behaviorAbiSource.match(
        /export const GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM = Object\.freeze\(\{([\s\S]*?)\n\}\);/
    )?.[1];
    assert.equal(typeof behaviorProgramSource, 'string');
    assert.match(behaviorProgramSource, /\bARROW_TOWER_CHARGE\b/);
    assert.match(behaviorProgramSource, /\bSELECTED_TARGET_PROJECTILE\b/);
    assert.doesNotMatch(
        behaviorProgramSource,
        /\b(?:FORMATION|HEXA|PENTA|EFFECT)\b/
    );
    assert.match(adapterSource, /formationGroupId/);
    assert.match(adapterSource, /formationMemberSlotIndex/);
    assert.match(adapterSource, /formationLineageHash/);
    assert.equal(
        Object.isFrozen(INGAME_ENEMY_DEFINITION_BY_ID),
        true
    );
});

console.log('authored wave timeline/formation contract: ok');
