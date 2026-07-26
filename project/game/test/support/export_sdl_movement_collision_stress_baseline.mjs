import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { hashBaselineValue } from './export_sdl_game_system_baseline.mjs';
import { loadGameModule } from './source_module_loader.mjs';

const DEFAULT_SOURCE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/movement_collision_stress_source_v1.json',
    import.meta.url
);
const DEFAULT_BASELINE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/movement_collision_stress_baseline_v1.json',
    import.meta.url
);
const BASELINE_SCHEMA_VERSION = 1;
const MAX_PARTICIPANT_COUNT = 5000;
const MAX_TICK_COUNT = 10000;
const PLACEMENT_PATTERN_ID = 'route-waypoint-grid-v1';
const MOVEMENT_PATTERN_ID = 'rotating-cardinal-v1';
const CARDINAL_DIRECTIONS = Object.freeze([
    Object.freeze({ x: 1, y: 0 }),
    Object.freeze({ x: 0, y: 1 }),
    Object.freeze({ x: -1, y: 0 }),
    Object.freeze({ x: 0, y: -1 })
]);

/**
 * JSON fixture를 읽습니다.
 * @param {URL|string} fixtureUrl - fixture URL 또는 경로입니다.
 * @returns {Promise<object>} 파싱한 fixture입니다.
 */
export async function readMovementCollisionStressFixture(
    fixtureUrl = DEFAULT_SOURCE_FIXTURE_URL
) {
    return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

/**
 * 스트레스 source fixture의 고정 스텝과 연산 상한 계약을 검증합니다.
 * @param {object} fixture - 검사할 source fixture입니다.
 * @returns {void}
 */
function assertStressFixture(fixture) {
    const fixedHz = Number(fixture?.fixedStep?.hz);
    const deltaSeconds = Number(fixture?.fixedStep?.deltaSeconds);
    const tickCount = Number(fixture?.fixedStep?.tickCount);
    const participantCount = Number(fixture?.participantCount);
    const phaseTicks = Number(fixture?.movementPattern?.phaseTicks);
    const maxTileProbesPerResolve = Number(
        fixture?.operationBudget?.maxTileProbesPerResolve
    );
    const maxPositionCorrectionsPerResolve = Number(
        fixture?.operationBudget?.maxPositionCorrectionsPerResolve
    );

    if (fixture?.schemaVersion !== BASELINE_SCHEMA_VERSION
        || typeof fixture?.fixtureId !== 'string'
        || fixture.fixtureId.length === 0
        || typeof fixture?.mapId !== 'string'
        || fixture.mapId.length === 0) {
        throw new TypeError('movement/collision stress fixture 식별자가 유효하지 않습니다.');
    }
    if (fixedHz !== 60
        || !Number.isFinite(deltaSeconds)
        || Math.abs(deltaSeconds - (1 / fixedHz)) > Number.EPSILON
        || !Number.isInteger(tickCount)
        || tickCount <= 0
        || tickCount > MAX_TICK_COUNT) {
        throw new RangeError('movement/collision stress는 유효한 60Hz tick을 사용해야 합니다.');
    }
    if (!Number.isInteger(participantCount)
        || participantCount <= 0
        || participantCount > MAX_PARTICIPANT_COUNT) {
        throw new RangeError('movement/collision stress participantCount가 범위를 벗어났습니다.');
    }
    if (fixture.placementPattern !== PLACEMENT_PATTERN_ID
        || fixture?.movementPattern?.id !== MOVEMENT_PATTERN_ID
        || !Number.isInteger(phaseTicks)
        || phaseTicks <= 0) {
        throw new TypeError('지원하지 않는 placement/movement pattern입니다.');
    }
    if (!Number.isInteger(maxTileProbesPerResolve)
        || maxTileProbesPerResolve <= 0
        || !Number.isInteger(maxPositionCorrectionsPerResolve)
        || maxPositionCorrectionsPerResolve <= 0) {
        throw new RangeError('operation budget은 양의 정수여야 합니다.');
    }
    if (!Array.isArray(fixture.checkpointTicks)
        || fixture.checkpointTicks.length === 0) {
        throw new TypeError('movement/collision stress checkpoint가 필요합니다.');
    }
    let previousTick = -1;
    for (const tick of fixture.checkpointTicks) {
        if (!Number.isInteger(tick)
            || tick <= previousTick
            || tick < 0
            || tick >= tickCount) {
            throw new RangeError('checkpointTicks는 tick 범위 안에서 오름차순이어야 합니다.');
        }
        previousTick = tick;
    }
    if (previousTick !== tickCount - 1) {
        throw new RangeError('마지막 movement/collision stress tick은 checkpoint여야 합니다.');
    }
}

/**
 * route waypoint 안쪽의 반복 가능한 격자 위치를 계산합니다.
 * 동적 개체 간 접촉은 현재 미구현이므로 서로 겹칠 수 있습니다.
 * @param {object[]} waypoints - production map route waypoint입니다.
 * @param {number} participantIndex - 0-based participant 번호입니다.
 * @returns {{x:number,y:number}} 초기 월드 위치입니다.
 */
function createParticipantPosition(waypoints, participantIndex) {
    const waypoint = waypoints[participantIndex % waypoints.length];
    const gridIndex = Math.floor(participantIndex / waypoints.length);
    const columnOffset = ((gridIndex % 5) - 2) * 0.75;
    const rowOffset = ((Math.floor(gridIndex / 5) % 5) - 2) * 0.75;
    return {
        x: waypoint.x + columnOffset,
        y: waypoint.y + rowOffset
    };
}

/**
 * fixed 상태의 hash 입력을 생성합니다.
 * @param {object[]} participants - production physics participant 목록입니다.
 * @param {number} tick - 완료한 fixed tick입니다.
 * @returns {object} canonical hash 입력입니다.
 */
function createStateSnapshot(participants, tick) {
    return {
        tick,
        participants: participants.map(({ participantId, body }) => ({
            participantId,
            position: { ...body.getPosition() },
            previousPosition: { ...body.getPreviousPosition() },
            velocity: { ...body.getVelocity() }
        }))
    };
}

/**
 * production 물리 primitive와 tile resolver로 결정적 스트레스를 실행합니다.
 * @param {object} fixture - 검증된 source fixture입니다.
 * @param {{captureTickHashes?:boolean,measureWallClock?:boolean}} [options={}] - 실행 옵션입니다.
 * @returns {Promise<{baseline:object,informationalTiming:object|null}>} 권위 결과와 비권위 시간 정보입니다.
 */
async function executeStressSimulation(fixture, options = {}) {
    assertStressFixture(fixture);
    const captureTickHashes = options.captureTickHashes !== false;
    const measureWallClock = options.measureWallClock === true;
    const [
        { createTileMap },
        { TileMapCollisionResolver },
        { PhysicsBody2D },
        { CircleCollider2D },
        { PHYSICS_BODY_TYPES },
        { COLLISION_LAYERS },
        { THE_TOWER_DATA }
    ] = await Promise.all([
        loadGameModule('ingame/map/tile_map.js'),
        loadGameModule('ingame/map/tile_map_collision_resolver.js'),
        loadGameModule('ingame/physics/physics_body_2d.js'),
        loadGameModule('ingame/physics/circle_collider_2d.js'),
        loadGameModule('ingame/contract/physics_body_contract.js'),
        loadGameModule('ingame/contract/collidable_contract.js'),
        loadGameModule('data/object/tower/the_tower_data.js')
    ]);

    const tileMap = createTileMap(fixture.mapId);
    if (tileMap.mapId !== fixture.mapId) {
        throw new Error(`등록되지 않은 production map입니다: ${fixture.mapId}`);
    }
    const route = tileMap.getSpawnRoutes()[0];
    if (!route || route.waypoints.length === 0) {
        throw new Error('movement/collision stress에 사용할 production route가 없습니다.');
    }

    const productionParameters = {
        radiusTiles: THE_TOWER_DATA.RADIUS_TILES,
        mass: THE_TOWER_DATA.MASS,
        controlAccelerationTilesPerSecondSquared:
            THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED,
        linearFrictionPerSecond: THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND,
        sleepSpeedTilesPerSecond: THE_TOWER_DATA.SLEEP_SPEED_TILES_PER_SECOND,
        maxLinearSpeedTilesPerSecond:
            THE_TOWER_DATA.MAX_LINEAR_SPEED_TILES_PER_SECOND
    };
    const participants = [];
    for (let index = 0; index < fixture.participantCount; index++) {
        const participantId = `movement-circle-${index.toString().padStart(4, '0')}`;
        const position = createParticipantPosition(route.waypoints, index);
        const body = new PhysicsBody2D({
            physicsBodyId: `${participantId}:physics`,
            bodyType: PHYSICS_BODY_TYPES.DYNAMIC,
            x: position.x,
            y: position.y,
            mass: productionParameters.mass,
            linearFriction: productionParameters.linearFrictionPerSecond,
            sleepSpeed: productionParameters.sleepSpeedTilesPerSecond,
            maxLinearSpeed: productionParameters.maxLinearSpeedTilesPerSecond
        });
        const collider = new CircleCollider2D({
            colliderId: `${participantId}:collider`,
            physicsBody: body,
            radius: productionParameters.radiusTiles,
            collisionLayer: COLLISION_LAYERS.TOWER,
            collisionMask: COLLISION_LAYERS.WORLD
        });
        participants.push({ participantId, body, collider });
    }

    const resolver = new TileMapCollisionResolver(tileMap);
    const originalIsWalkableTile = tileMap.isWalkableTile.bind(tileMap);
    let tileProbeCount = 0;
    tileMap.isWalkableTile = (row, column) => {
        tileProbeCount++;
        return originalIsWalkableTile(row, column);
    };

    const initialStateHash = hashBaselineValue(createStateSnapshot(participants, -1));
    const records = [];
    const checkpointSet = new Set(fixture.checkpointTicks);
    const checkpoints = [];
    let integrateCallCount = 0;
    let resolverCallCount = 0;
    let positionCorrectionCount = 0;
    let maximumTileProbesPerResolve = 0;
    let maximumPositionCorrectionsPerResolve = 0;
    let maximumTileProbesPerTick = 0;
    let maximumPositionCorrectionsPerTick = 0;
    let maximumSpeed = 0;
    const startTime = measureWallClock ? performance.now() : 0;
    let elapsedMilliseconds = null;

    try {
        for (let tick = 0; tick < fixture.fixedStep.tickCount; tick++) {
            const probesBeforeTick = tileProbeCount;
            const correctionsBeforeTick = positionCorrectionCount;
            const movementPhase = Math.floor(
                tick / fixture.movementPattern.phaseTicks
            );

            for (let index = 0; index < participants.length; index++) {
                const participant = participants[index];
                const direction = CARDINAL_DIRECTIONS[
                    (index + movementPhase) % CARDINAL_DIRECTIONS.length
                ];
                participant.body.beginStep();
                participant.body.addAcceleration(
                    direction.x
                        * productionParameters.controlAccelerationTilesPerSecondSquared,
                    direction.y
                        * productionParameters.controlAccelerationTilesPerSecondSquared
                );
                participant.body.integrate(fixture.fixedStep.deltaSeconds);
                integrateCallCount++;

                const probesBeforeResolve = tileProbeCount;
                const correctionCount = resolver.resolve(participant.collider);
                const probesForResolve = tileProbeCount - probesBeforeResolve;
                resolverCallCount++;
                positionCorrectionCount += correctionCount;
                maximumTileProbesPerResolve = Math.max(
                    maximumTileProbesPerResolve,
                    probesForResolve
                );
                maximumPositionCorrectionsPerResolve = Math.max(
                    maximumPositionCorrectionsPerResolve,
                    correctionCount
                );
                const velocity = participant.body.getVelocity();
                maximumSpeed = Math.max(
                    maximumSpeed,
                    Math.hypot(velocity.x, velocity.y)
                );
            }

            const tickTileProbeCount = tileProbeCount - probesBeforeTick;
            const tickPositionCorrectionCount = positionCorrectionCount
                - correctionsBeforeTick;
            maximumTileProbesPerTick = Math.max(
                maximumTileProbesPerTick,
                tickTileProbeCount
            );
            maximumPositionCorrectionsPerTick = Math.max(
                maximumPositionCorrectionsPerTick,
                tickPositionCorrectionCount
            );

            if (captureTickHashes) {
                const stateHash = hashBaselineValue(
                    createStateSnapshot(participants, tick)
                );
                const record = {
                    tick,
                    stateHash,
                    tileProbeCount: tickTileProbeCount,
                    positionCorrectionCount: tickPositionCorrectionCount
                };
                records.push(record);
                if (checkpointSet.has(tick)) {
                    checkpoints.push({ ...record });
                }
            }
        }
        elapsedMilliseconds = measureWallClock ? performance.now() - startTime : null;
    } finally {
        tileMap.isWalkableTile = originalIsWalkableTile;
        for (let index = participants.length - 1; index >= 0; index--) {
            participants[index].collider.destroy();
            participants[index].body.destroy();
        }
    }

    const expectedOperationCount = fixture.participantCount
        * fixture.fixedStep.tickCount;
    if (integrateCallCount !== expectedOperationCount
        || resolverCallCount !== expectedOperationCount) {
        throw new Error('movement/collision stress fixed operation 수가 예상과 다릅니다.');
    }
    if (maximumTileProbesPerResolve
            > fixture.operationBudget.maxTileProbesPerResolve
        || maximumPositionCorrectionsPerResolve
            > fixture.operationBudget.maxPositionCorrectionsPerResolve) {
        throw new Error('movement/collision stress operation budget을 초과했습니다.');
    }

    const finalStateHash = captureTickHashes
        ? records.at(-1).stateHash
        : null;
    const baseline = {
        schemaVersion: BASELINE_SCHEMA_VERSION,
        fixtureId: fixture.fixtureId,
        oracle: {
            runtime: 'javascript-production-physics-primitives',
            contractVersion: 1,
            hashAlgorithm: 'fnv1a64-utf8',
            canonicalEncoding: 'cirvivor-canonical-v1-f64be',
            authoritativeScope: [
                'PhysicsBody2D fixed-step integration',
                'CircleCollider2D world collision filter',
                'TileMapCollisionResolver position correction',
                'production map blocked-grid probes'
            ],
            excludedGameplayClaims: [
                'participants are enemies',
                'participants are projectiles',
                'dynamic participants collide with each other',
                'overlay blur or rendering is measured'
            ],
            unavailableCapabilities: [
                'enemy simulation in current GameSystem',
                'projectile simulation in current GameSystem',
                'general dynamic contact pipeline in current GameSystem',
                'tick heap-allocation telemetry',
                'render and overlay blur timing'
            ]
        },
        source: {
            mapId: fixture.mapId,
            fixedStep: { ...fixture.fixedStep },
            participantCount: fixture.participantCount,
            participantKind: 'independent production movement circles',
            placementPattern: fixture.placementPattern,
            movementPattern: { ...fixture.movementPattern },
            productionParameters
        },
        initialStateHash,
        recordsDigest: captureTickHashes ? hashBaselineValue(records) : null,
        checkpoints,
        summary: {
            integrateCallCount,
            resolverCallCount,
            tileProbeCount,
            positionCorrectionCount,
            maximumTileProbesPerResolve,
            maximumPositionCorrectionsPerResolve,
            maximumTileProbesPerTick,
            maximumPositionCorrectionsPerTick,
            maximumSpeed,
            finalStateHash
        },
        operationBudget: {
            maxTileProbesPerResolve:
                fixture.operationBudget.maxTileProbesPerResolve,
            maxPositionCorrectionsPerResolve:
                fixture.operationBudget.maxPositionCorrectionsPerResolve,
            maxTotalTileProbes: expectedOperationCount
                * fixture.operationBudget.maxTileProbesPerResolve,
            maxTotalPositionCorrections: expectedOperationCount
                * fixture.operationBudget.maxPositionCorrectionsPerResolve
        }
    };
    const informationalTiming = measureWallClock
        ? {
            fixtureId: fixture.fixtureId,
            classification: 'informational-only-not-a-pass-fail-gate',
            elapsedMilliseconds,
            participantStepsPerSecond: expectedOperationCount
                / (elapsedMilliseconds / 1000)
        }
        : null;
    return { baseline, informationalTiming };
}

/**
 * source fixture의 권위 baseline을 생성합니다.
 * wall-clock은 결과에 포함하지 않습니다.
 * @param {object} fixture - source fixture입니다.
 * @returns {Promise<object>} 결정적 compact baseline입니다.
 */
export async function exportMovementCollisionStressBaseline(fixture) {
    const { baseline } = await executeStressSimulation(fixture, {
        captureTickHashes: true,
        measureWallClock: false
    });
    return baseline;
}

/**
 * 기본 source fixture로 권위 baseline을 생성합니다.
 * @returns {Promise<object>} 결정적 compact baseline입니다.
 */
export async function exportDefaultMovementCollisionStressBaseline() {
    return exportMovementCollisionStressBaseline(
        await readMovementCollisionStressFixture()
    );
}

/**
 * 저장된 baseline과 production primitive 실행 결과가 같은지 확인합니다.
 * @returns {Promise<object>} 검증한 권위 baseline입니다.
 */
export async function checkDefaultMovementCollisionStressBaseline() {
    const [actual, expected] = await Promise.all([
        exportDefaultMovementCollisionStressBaseline(),
        readMovementCollisionStressFixture(DEFAULT_BASELINE_FIXTURE_URL)
    ]);
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error('movement/collision stress baseline이 현재 JS oracle과 다릅니다.');
    }
    return actual;
}

/**
 * 같은 production kernel의 wall-clock을 pass/fail 임계값 없이 측정합니다.
 * @param {object} fixture - source fixture입니다.
 * @returns {Promise<object>} CI 권위 판단에 사용하지 않는 측정값입니다.
 */
export async function measureMovementCollisionStress(fixture) {
    const { informationalTiming } = await executeStressSimulation(fixture, {
        captureTickHashes: false,
        measureWallClock: true
    });
    return informationalTiming;
}

/** @returns {Promise<void>} baseline 확인 또는 stdout 출력을 수행합니다. */
async function runCli() {
    const args = new Set(process.argv.slice(2));
    const baseline = await exportDefaultMovementCollisionStressBaseline();
    if (args.has('--stdout')) {
        process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
        return;
    }
    const expected = await readMovementCollisionStressFixture(
        DEFAULT_BASELINE_FIXTURE_URL
    );
    if (!isDeepStrictEqual(baseline, expected)) {
        throw new Error('movement/collision stress baseline check failed.');
    }
    console.log(
        `movement/collision stress baseline ok: ${baseline.source.participantCount} `
        + `participants, ${baseline.summary.finalStateHash}`
    );
}

const isMainModule = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
    await runCli();
}
