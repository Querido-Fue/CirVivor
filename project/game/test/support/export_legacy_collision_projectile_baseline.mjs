import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
    installSourceModuleTestGlobals,
    loadGameModule
} from './source_module_loader.mjs';
import { hashBaselineValue } from './export_sdl_game_system_baseline.mjs';

const DEFAULT_SOURCE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/legacy_collision_projectile_replay_v1.json',
    import.meta.url
);
const DEFAULT_BASELINE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/legacy_collision_projectile_baseline_v1.json',
    import.meta.url
);
const BASELINE_SCHEMA_VERSION = 1;
const HASH_ALGORITHM = 'fnv1a64-utf8';
const CANONICAL_ENCODING = 'cirvivor-canonical-v1-f64be';
const PROFILE_COUNTER_FIELDS = Object.freeze([
    'collisionCheckCount',
    'aabbPassCount',
    'aabbRejectCount',
    'circlePassCount',
    'circleRejectCount',
    'partChecks',
    'solveBucketPairCount',
    'solveCandidatePairCount',
    'solveDuplicatePairSkipCount',
    'solveRuleRejectCount',
    'solveAabbPassCount',
    'solveCirclePassCount',
    'solveResolvedPairCount',
    'solveSoACirclePairCount',
    'solveObjectNarrowphasePairCount',
    'solveBudgetSkipCount',
    'solvePassCount',
    'solveGridRebuildCount',
    'solveDensePressure',
    'solveGuaranteedPairCount',
    'solvePriorityAdmissionCount',
    'solvePredictiveAdmissionCount',
    'solveAdmissionBudgetSkipCount',
    'solveCandidateVisitCount',
    'solveScanTruncateCount'
]);

let productionModulesPromise = null;

/**
 * JSON fixture를 읽습니다.
 * @param {URL} fixtureUrl - 읽을 fixture URL입니다.
 * @returns {Promise<object>} 파싱한 JSON 객체입니다.
 */
async function readJsonFixture(fixtureUrl) {
    return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

/**
 * trace의 VM realm 객체를 저장 가능한 host realm JSON 값으로 복제합니다.
 * @param {*} value - 복제할 값입니다.
 * @returns {*} JSON 호환 복제본입니다.
 */
function cloneJsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * 선택적 숫자를 fixture에서 표현할 수 있는 유한 값 또는 null로 정규화합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {number|null} 유한 숫자 또는 null입니다.
 */
function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

/**
 * numeric plane의 원소를 지정 IEEE-754 big-endian byte열로 직렬화해 SHA-256을 계산합니다.
 * JSON이 보존하지 못하는 -0과 마지막 mantissa bit까지 native parity 계약에 포함합니다.
 * @param {ArrayLike<number>} values - numeric plane 값입니다.
 * @param {'f32be'|'f64be'|'u8'} encoding - raw encoding입니다.
 * @returns {string} 64자리 SHA-256입니다.
 */
function hashNumericPlaneRawBits(values, encoding) {
    const byteWidth = encoding === 'f64be' ? 8 : 4;
    if (encoding === 'u8') {
        return createHash('sha256').update(Buffer.from(values)).digest('hex');
    }
    const bytes = Buffer.allocUnsafe(values.length * byteWidth);
    for (let index = 0; index < values.length; index++) {
        if (encoding === 'f32be') {
            bytes.writeFloatBE(values[index], index * byteWidth);
        } else {
            bytes.writeDoubleBE(values[index], index * byteWidth);
        }
    }
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * typed numeric plane을 값 배열과 raw-bit digest를 가진 저장 snapshot으로 만듭니다.
 * @param {string} type - typed array 타입 이름입니다.
 * @param {number} stride - record stride입니다.
 * @param {ArrayLike<number>} source - 원본 typed array view입니다.
 * @param {number} length - 유효 원소 수입니다.
 * @returns {object} plane snapshot입니다.
 */
function captureNumericPlane(type, stride, source, length) {
    const values = Array.from(source.subarray(0, length));
    const rawEncoding = type === 'Float32Array'
        ? 'ieee754-f32be'
        : (type === 'Float64Array' ? 'ieee754-f64be' : 'u8');
    const hashEncoding = type === 'Float32Array'
        ? 'f32be'
        : (type === 'Float64Array' ? 'f64be' : 'u8');
    return {
        type,
        stride,
        rawEncoding,
        rawSha256: hashNumericPlaneRawBits(values, hashEncoding),
        values
    };
}

/**
 * handler가 준비한 canonical collision body slot을 native kernel 입력용 snapshot으로 만듭니다.
 * @param {object} body - production collision body입니다.
 * @param {number} slot - ordered body slot입니다.
 * @returns {object} body snapshot입니다.
 */
function captureCollisionBody(slot, body) {
    const scalarFields = [
        'x', 'y', 'centerX', 'centerY',
        'minX', 'maxX', 'minY', 'maxY',
        'sweepMinX', 'sweepMaxX', 'sweepMinY', 'sweepMaxY',
        'enemyPairMinX', 'enemyPairMaxX', 'enemyPairMinY', 'enemyPairMaxY',
        'projectileMinX', 'projectileMaxX', 'projectileMinY', 'projectileMaxY',
        'radius', 'boundRadius', 'broadRadius', 'enemyPairBroadRadius',
        'projectileBroadRadius', 'resolveRadius', 'velocityX', 'velocityY',
        'weight', '_frameResolveMoved', '_frameResolveMax',
        '_candidatePairCount', '_resolvedPairCount', '_passPairProcessCount'
    ];
    const scalars = {};
    for (let index = 0; index < scalarFields.length; index++) {
        const fieldName = scalarFields[index];
        scalars[fieldName] = finiteOrNull(body?.[fieldName]);
    }
    const circlePartCount = Number.isInteger(body?.circlePartCount)
        ? Math.max(0, body.circlePartCount)
        : 0;
    const circlePartLength = Math.min(
        body?.circleParts?.length ?? 0,
        circlePartCount * 3
    );
    const circleParts = circlePartLength > 0
        ? captureNumericPlane('Float32Array', 3, body.circleParts, circlePartLength)
        : null;
    return {
        slot,
        id: Number.isInteger(body?.id) ? body.id : -1,
        refToken: Number.isInteger(body?.ref?.id) ? body.ref.id : -1,
        refType: body?.ref?.type ?? null,
        kind: body?.kind ?? 'none',
        shape: body?.shape ?? 'none',
        movable: body?.movable !== false,
        mergeLock: body?.mergeLock === true,
        sleeping: body?._sleeping === true,
        sleepObservationIncomplete: body?._sleepObservationIncomplete === true,
        circlePartCount,
        circleParts,
        scalars
    };
}

/**
 * candidate pair buffer의 priority/normal 배열을 즉시 복제합니다.
 * @param {object} candidatePairs - production pair buffer입니다.
 * @returns {{priorityPairs:number[][], normalPairs:number[][]}} ordered pair snapshot입니다.
 */
function captureCandidatePairs(candidatePairs) {
    const priorityPairs = [];
    for (let index = 0; index < candidatePairs.priorityCount; index++) {
        priorityPairs.push([
            candidatePairs.priorityLowIndices[index],
            candidatePairs.priorityHighIndices[index]
        ]);
    }
    const normalPairs = [];
    for (let index = 0; index < candidatePairs.count; index++) {
        normalPairs.push([
            candidatePairs.lowIndices[index],
            candidatePairs.highIndices[index]
        ]);
    }
    return { priorityPairs, normalPairs };
}

/**
 * handler의 opt-in raw trace view를 callback 시점에 불변 host snapshot으로 복제합니다.
 * production grid/candidate 알고리즘을 재구현하지 않고 실제 내부 배열과 Map 순서를 직렬화만 합니다.
 * @param {object} event - handler trace event입니다.
 * @returns {object} 저장 가능한 trace event입니다.
 */
function captureCollisionTraceEvent(event) {
    if (event.type === 'gridRebuild') {
        const bodyCount = event.bodies.length;
        const buffer = event.broadphaseBuffer;
        const planes = {
            broad: captureNumericPlane('Float32Array', 14, buffer.broadData, bodyCount * 14),
            bodyKind: captureNumericPlane('Uint8Array', 1, buffer.bodyKindCodes, bodyCount),
            bodyShape: captureNumericPlane('Uint8Array', 1, buffer.bodyShapeCodes, bodyCount)
        };
        if (!event.gridDataOnly) {
            planes.relation = captureNumericPlane('Float64Array', 8, buffer.relationData, bodyCount * 8);
            planes.candidateSweep = captureNumericPlane(
                'Float64Array',
                8,
                buffer.candidateSweepData,
                bodyCount * 8
            );
            planes.candidateSweepValidity = captureNumericPlane(
                'Uint8Array',
                1,
                buffer.candidateSweepValidity,
                bodyCount
            );
        }
        const gridCells = [];
        for (const [key, bucket] of event.grid) {
            gridCells.push([key, Array.from(bucket.indices.subarray(0, bucket.count))]);
        }
        return {
            type: event.type,
            fixedFrameToken: event.fixedFrameToken,
            gridMode: event.gridMode,
            gridDataOnly: event.gridDataOnly,
            cellSize: event.cellSize,
            gridBodyCount: event.gridBodyCount,
            bodies: Array.from(event.bodies, (body, slot) => captureCollisionBody(slot, body)),
            planes,
            gridCells
        };
    }
    if (event.type === 'candidateBuild') {
        return {
            type: event.type,
            fixedFrameToken: event.fixedFrameToken,
            candidateScanEpoch: event.candidateScanEpoch,
            nextCandidateScanEpoch: event.nextCandidateScanEpoch,
            cellScanToken: event.cellScanToken,
            bodyIds: Array.from(event.bodies, (body) => (
                Number.isInteger(body?.id) ? body.id : -1
            )),
            ...captureCandidatePairs(event.candidatePairs),
            fairness: Array.from(event.fairness, (entry) => ({ ...entry })),
            counters: { ...event.counters }
        };
    }
    if (event.type === 'solvePass') {
        const bodyCount = event.bodies.length;
        const buffer = event.broadphaseBuffer;
        return {
            type: event.type,
            fixedFrameToken: event.fixedFrameToken,
            passIndex: event.passIndex,
            rebuiltGrid: event.rebuiltGrid,
            rebuiltCandidates: event.rebuiltCandidates,
            pairStartToken: event.pairStartToken,
            resolveBoost: event.resolveBoost,
            resolvedCount: event.resolvedCount,
            ...captureCandidatePairs(event.candidatePairs),
            postBodies: Array.from(event.bodies, (body, slot) => captureCollisionBody(slot, body)),
            postPlanes: {
                broad: captureNumericPlane('Float32Array', 14, buffer.broadData, bodyCount * 14),
                relation: captureNumericPlane('Float64Array', 8, buffer.relationData, bodyCount * 8),
                candidateSweepValidity: captureNumericPlane(
                    'Uint8Array',
                    1,
                    buffer.candidateSweepValidity,
                    bodyCount
                )
            }
        };
    }
    return cloneJsonValue(event);
}

/**
 * production module graph가 요구하는 최소 NW.js 전역 어댑터를 한 번 설치하고 모듈을 불러옵니다.
 * 표시 시스템은 초기화하지 않으며 collision/ObjectSystem 생성자만 실제 코드 그대로 사용합니다.
 * @returns {Promise<object>} replay에서 사용할 production 생성자와 adapter입니다.
 */
async function loadProductionModules() {
    if (productionModulesPromise) {
        return productionModulesPromise;
    }

    const require = createRequire(import.meta.url);
    const window = {
        nw: {},
        require,
        screen: {
            width: 1280,
            height: 720,
            availWidth: 1280,
            availHeight: 720
        },
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1
    };
    installSourceModuleTestGlobals({
        require,
        window,
        process,
        performance: Object.freeze({ now: () => 0 })
    });

    productionModulesPromise = (async () => {
        const { ColorUtil } = await loadGameModule('util/color_util.js');
        new ColorUtil();
        const { syncSimulationRuntime } = await loadGameModule('simulation/simulation_runtime.js');
        const { TimeHandler } = await loadGameModule('game/time_handler.js');
        const { ObjectSystem } = await loadGameModule('object/object_system.js');
        const { Player } = await loadGameModule('object/player/_player.js');
        const { BaseWall } = await loadGameModule('object/wall/_base_wall.js');
        const { BaseProj } = await loadGameModule('object/proj/_base_proj.js');
        return {
            syncSimulationRuntime,
            TimeHandler,
            ObjectSystem,
            Player,
            BaseWall,
            BaseProj
        };
    })();
    return productionModulesPromise;
}

/**
 * source fixture의 최소 구조와 replay 상한을 검증합니다.
 * @param {object} fixture - source fixture입니다.
 * @returns {void}
 */
function validateReplayFixture(fixture) {
    if (fixture?.schemaVersion !== 1 || fixture?.fixtureId !== 'legacy_collision_projectile_replay_v1') {
        throw new Error('지원하지 않는 legacy collision replay fixture입니다.');
    }
    if (!Number.isFinite(fixture.fixedStep?.seconds) || fixture.fixedStep.seconds <= 0) {
        throw new Error('legacy collision replay fixed step이 유효하지 않습니다.');
    }
    if (!Number.isInteger(fixture.fixedStep?.tickCount)
        || fixture.fixedStep.tickCount <= 0
        || fixture.fixedStep.tickCount > 10000) {
        throw new Error('legacy collision replay tickCount가 유효하지 않습니다.');
    }
    if (!Number.isInteger(fixture.denseCluster?.count)
        || fixture.denseCluster.count < 0
        || fixture.denseCluster.count > 512) {
        throw new Error('legacy collision dense cluster count가 유효하지 않습니다.');
    }
}

/**
 * source fixture의 밀집 cluster 정의를 ObjectSystem spawn 데이터 목록으로 확장합니다.
 * @param {object} definition - 밀집 cluster 정의입니다.
 * @returns {object[]} row-major 적 생성 데이터입니다.
 */
function expandDenseCluster(definition) {
    const enemies = [];
    const columns = Math.max(1, Math.floor(definition.columns));
    for (let index = 0; index < definition.count; index++) {
        enemies.push({
            id: definition.idStart + index,
            type: definition.type,
            position: {
                x: definition.origin.x + ((index % columns) * definition.spacing.x),
                y: definition.origin.y + (Math.floor(index / columns) * definition.spacing.y)
            },
            size: definition.size,
            weight: definition.weight
        });
    }
    return enemies;
}

/**
 * production ObjectSystem과 production entity 생성자로 replay world를 구성합니다.
 * @param {object} fixture - source fixture입니다.
 * @param {object} modules - production module 묶음입니다.
 * @param {((event: object) => void)|null|undefined} traceSink - collision 내부 trace sink입니다.
 * @returns {Promise<{objectSystem:object, players:object[], walls:object[], projectiles:object[]}>} world입니다.
 */
async function createReplayWorld(fixture, modules, traceSink) {
    modules.syncSimulationRuntime({
        viewport: fixture.viewport,
        settings: { debugMode: true }
    });
    const timeHandler = new modules.TimeHandler();
    timeHandler.updateFixed(fixture.fixedStep.seconds);

    const objectSystem = new modules.ObjectSystem();
    await objectSystem.init();
    if (traceSink !== undefined) {
        objectSystem.physicsSystem.collisionHandler.setDeterministicOracleTraceSink(traceSink);
    }

    const enemyDefinitions = [
        ...expandDenseCluster(fixture.denseCluster),
        ...fixture.enemies
    ];
    for (let index = 0; index < enemyDefinitions.length; index++) {
        const definition = enemyDefinitions[index];
        const enemy = objectSystem.spawnEnemy(definition.type, definition);
        if (!enemy) {
            throw new Error(`production enemy를 생성하지 못했습니다: ${definition.type}`);
        }
    }

    const players = fixture.players.map((definition) => new modules.Player().init(definition));
    const walls = fixture.walls.map((definition) => new modules.BaseWall().init(definition));
    const projectiles = fixture.projectiles.map((definition) => new modules.BaseProj().init(definition));
    objectSystem.setPlayers(players);
    objectSystem.setWalls(walls);
    objectSystem.setProjectiles(projectiles);
    return { objectSystem, players, walls, projectiles };
}

/**
 * 한 적의 collision 결과와 projectile impact 상태를 canonical snapshot으로 만듭니다.
 * @param {object} enemy - production enemy입니다.
 * @returns {object} 적 상태입니다.
 */
function createEnemyState(enemy) {
    return {
        id: Number.isInteger(enemy.id) ? enemy.id : -1,
        type: enemy.type,
        active: enemy.active !== false,
        position: { x: enemy.position.x, y: enemy.position.y },
        previousPosition: { x: enemy.prevPosition.x, y: enemy.prevPosition.y },
        speed: { x: enemy.speed.x, y: enemy.speed.y },
        rotation: finiteOrNull(enemy.rotation),
        angularVelocity: finiteOrNull(enemy.angularVelocity),
        angularDeceleration: finiteOrNull(enemy.angularDeceleration),
        collisionPrevious: {
            x: finiteOrNull(enemy.__collisionPrevX),
            y: finiteOrNull(enemy.__collisionPrevY)
        },
        collisionIdleTicks: Number.isInteger(enemy.__collisionIdleTicks)
            ? enemy.__collisionIdleTicks
            : 0,
        collisionSleepTicks: Number.isInteger(enemy.__collisionSleepTicks)
            ? enemy.__collisionSleepTicks
            : 0,
        projectileHitCount: Number.isInteger(enemy.projectileHitCount)
            ? enemy.projectileHitCount
            : 0,
        lastImpactPoint: enemy.lastImpactPoint
            ? { x: enemy.lastImpactPoint.x, y: enemy.lastImpactPoint.y }
            : null,
        lastImpactOffset: enemy.lastImpactOffset
            ? { x: enemy.lastImpactOffset.x, y: enemy.lastImpactOffset.y }
            : null,
        mergePending: enemy.hexaHiveMergePending === true
    };
}

/**
 * 한 투사체의 sweep 이력과 중복 hit 순서를 canonical snapshot으로 만듭니다.
 * @param {object} projectile - production BaseProj입니다.
 * @returns {object} 투사체 상태입니다.
 */
function createProjectileState(projectile) {
    return {
        id: Number.isInteger(projectile.id) ? projectile.id : -1,
        active: projectile.active !== false,
        piercing: projectile.piercing === true,
        position: { x: projectile.position.x, y: projectile.position.y },
        previousPosition: { x: projectile.prevPosition.x, y: projectile.prevPosition.y },
        speed: { x: projectile.speed.x, y: projectile.speed.y },
        hitEnemyIds: Array.from(projectile.hitEnemyIds ?? [])
    };
}

/**
 * 비결정적인 duration 필드를 제외한 충돌 count/value 통계를 복제합니다.
 * @param {object} objectSystem - production ObjectSystem입니다.
 * @returns {object} 선택한 통계입니다.
 */
function createCollisionCounterState(objectSystem) {
    const stats = objectSystem.getCollisionStats();
    const counters = {};
    for (let index = 0; index < PROFILE_COUNTER_FIELDS.length; index++) {
        const fieldName = PROFILE_COUNTER_FIELDS[index];
        counters[fieldName] = Number.isFinite(stats[fieldName]) ? stats[fieldName] : 0;
    }
    return counters;
}

/**
 * ObjectSystem의 배열 순서와 모든 collision 관련 live 상태를 snapshot으로 만듭니다.
 * @param {number} tick - 0 기반 replay tick입니다.
 * @param {object} world - replay world입니다.
 * @returns {object} fixed tick 상태입니다.
 */
function createWorldState(tick, world) {
    return {
        tick,
        enemyOrder: world.objectSystem.enemies.map((enemy) => enemy.id),
        enemies: world.objectSystem.enemies.map(createEnemyState),
        players: world.players.map((player) => ({
            id: player.id,
            active: player.active !== false,
            position: { x: player.position.x, y: player.position.y },
            speed: { x: player.speed.x, y: player.speed.y }
        })),
        projectiles: world.projectiles.map(createProjectileState),
        collisionCounters: createCollisionCounterState(world.objectSystem)
    };
}

/**
 * 해당 tick 전에 정의된 명시적 release 명령을 production swap-pop API로 적용합니다.
 * @param {number} tick - 현재 tick입니다.
 * @param {object[]} events - source event 목록입니다.
 * @param {object} objectSystem - production ObjectSystem입니다.
 * @returns {object[]} 적용 결과입니다.
 */
function applyReplayEvents(tick, events, objectSystem) {
    const results = [];
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
        const event = events[eventIndex];
        if (event.tick !== tick) continue;
        const beforeOrder = objectSystem.enemies.map((enemy) => enemy.id);
        const releasedEnemyIds = [];
        for (let idIndex = 0; idIndex < event.releaseEnemyIds.length; idIndex++) {
            const enemyId = event.releaseEnemyIds[idIndex];
            const enemy = objectSystem.enemyById.get(enemyId);
            if (!enemy) continue;
            objectSystem.releaseEnemy(enemy);
            releasedEnemyIds.push(enemyId);
        }
        results.push({
            tick,
            requestedReleaseEnemyIds: [...event.releaseEnemyIds],
            releasedEnemyIds,
            beforeOrder,
            afterOrder: objectSystem.enemies.map((enemy) => enemy.id)
        });
    }
    return results;
}

/**
 * grid trace의 full plane/grid order를 해시와 진단 표본으로 축약합니다.
 * @param {object} event - production gridRebuild trace입니다.
 * @returns {object} grid summary입니다.
 */
function summarizeGridTrace(event) {
    const planeHashes = {};
    const planeRawSha256 = {};
    for (const [planeName, plane] of Object.entries(event.planes)) {
        planeHashes[planeName] = hashBaselineValue(plane);
        planeRawSha256[planeName] = plane.rawSha256;
    }
    return {
        fixedFrameToken: event.fixedFrameToken,
        gridMode: event.gridMode,
        gridDataOnly: event.gridDataOnly,
        cellSize: event.cellSize,
        gridBodyCount: event.gridBodyCount,
        bodyCount: event.bodies.length,
        bodyOrderHash: hashBaselineValue(event.bodies),
        planeHashes,
        planeRawSha256,
        gridCellCount: event.gridCells.length,
        orderedGridHash: hashBaselineValue(event.gridCells),
        orderedGridHead: cloneJsonValue(event.gridCells.slice(0, 8))
    };
}

/**
 * 후보 pair의 전체 순서는 hash로 고정하고 첫 solve 외 checkpoint에는 진단 표본만 남깁니다.
 * 최초 solve의 전체 priority/normal 배열은 `firstSolveInternals`에 별도로 보존됩니다.
 * @param {object} event - production candidateBuild trace입니다.
 * @returns {object} 후보 순서 summary입니다.
 */
function summarizeCandidateTrace(event) {
    return {
        fixedFrameToken: event.fixedFrameToken,
        candidateScanEpoch: event.candidateScanEpoch,
        nextCandidateScanEpoch: event.nextCandidateScanEpoch,
        cellScanToken: event.cellScanToken,
        bodyIds: cloneJsonValue(event.bodyIds),
        priorityPairCount: event.priorityPairs.length,
        priorityPairsHash: hashBaselineValue(event.priorityPairs),
        priorityPairsHead: cloneJsonValue(event.priorityPairs.slice(0, 16)),
        priorityPairsTail: cloneJsonValue(event.priorityPairs.slice(-8)),
        normalPairCount: event.normalPairs.length,
        normalPairsHash: hashBaselineValue(event.normalPairs),
        normalPairsHead: cloneJsonValue(event.normalPairs.slice(0, 16)),
        normalPairsTail: cloneJsonValue(event.normalPairs.slice(-8)),
        fairness: cloneJsonValue(event.fairness),
        fairnessHash: hashBaselineValue(event.fairness),
        counters: cloneJsonValue(event.counters),
        candidateBuildHash: hashBaselineValue(event)
    };
}

/**
 * solve pass의 실제 pair 배열과 pass 후 body/plane 상태를 hash와 작은 진단 표본으로 축약합니다.
 * @param {object} event - production solvePass trace입니다.
 * @returns {object} solve pass summary입니다.
 */
function summarizeSolveTrace(event) {
    const postPlaneHashes = {};
    const postPlaneRawSha256 = {};
    for (const [planeName, plane] of Object.entries(event.postPlanes)) {
        postPlaneHashes[planeName] = hashBaselineValue(plane);
        postPlaneRawSha256[planeName] = plane.rawSha256;
    }
    return {
        fixedFrameToken: event.fixedFrameToken,
        passIndex: event.passIndex,
        rebuiltGrid: event.rebuiltGrid,
        rebuiltCandidates: event.rebuiltCandidates,
        pairStartToken: event.pairStartToken,
        resolveBoost: event.resolveBoost,
        resolvedCount: event.resolvedCount,
        priorityPairCount: event.priorityPairs.length,
        priorityPairsHash: hashBaselineValue(event.priorityPairs),
        normalPairCount: event.normalPairs.length,
        normalPairsHash: hashBaselineValue(event.normalPairs),
        postBodiesHash: hashBaselineValue(event.postBodies),
        postBodyPositions: event.postBodies.map((body) => ({
            id: body.id,
            x: body.scalars.centerX,
            y: body.scalars.centerY
        })),
        postPlaneHashes,
        postPlaneRawSha256,
        solvePassHash: hashBaselineValue(event)
    };
}

/**
 * 모든 projectile substep 순서는 hash로 고정하고 실제 후보가 있었던 query와 hit는 그대로 남깁니다.
 * @param {object[]} traceEvents - 한 tick의 전체 trace입니다.
 * @returns {object} projectile trace summary입니다.
 */
function summarizeProjectileTrace(traceEvents) {
    const projectileEvents = traceEvents.filter((event) => event.type.startsWith('projectile'));
    const queries = projectileEvents.filter((event) => event.type === 'projectileQuery');
    return {
        projectileTraceHash: hashBaselineValue(projectileEvents),
        sweeps: projectileEvents
            .filter((event) => event.type === 'projectileSweep')
            .map(cloneJsonValue),
        queryCount: queries.length,
        emptyQueryCount: queries.filter((event) => event.candidateIndices.length === 0).length,
        allQueriesHash: hashBaselineValue(queries),
        candidateQueries: queries
            .filter((event) => event.candidateIndices.length > 0)
            .map(cloneJsonValue),
        hits: projectileEvents
            .filter((event) => event.type === 'projectileHit')
            .map(cloneJsonValue)
    };
}

/**
 * 선택한 tick의 내부 trace를 C++ parity 진단에 필요한 순서 정보로 정리합니다.
 * @param {number} tick - replay tick입니다.
 * @param {object[]} traceEvents - 해당 tick trace입니다.
 * @returns {object} trace checkpoint입니다.
 */
function createTraceCheckpoint(tick, traceEvents) {
    return {
        tick,
        traceHash: hashBaselineValue(traceEvents),
        gridRebuilds: traceEvents
            .filter((event) => event.type === 'gridRebuild')
            .map(summarizeGridTrace),
        candidateBuilds: traceEvents
            .filter((event) => event.type === 'candidateBuild')
            .map(summarizeCandidateTrace),
        solvePasses: traceEvents
            .filter((event) => event.type === 'solvePass')
            .map(summarizeSolveTrace),
        projectileTrace: summarizeProjectileTrace(traceEvents)
    };
}

/**
 * actual production trace에서 최초 default solve의 전체 typed plane·grid·candidate 상태를 추출합니다.
 * @param {object[]} traceEvents - 전체 replay trace입니다.
 * @returns {object|null} 최초 solve 내부 snapshot입니다.
 */
function createFirstSolveInternals(traceEvents) {
    const gridIndex = traceEvents.findIndex((event) => (
        event.type === 'gridRebuild'
        && event.gridMode === 'default'
        && event.gridDataOnly === false
    ));
    if (gridIndex < 0) return null;
    const candidate = traceEvents.slice(gridIndex + 1).find((event) => event.type === 'candidateBuild');
    const firstPass = traceEvents.slice(gridIndex + 1).find((event) => event.type === 'solvePass');
    return {
        grid: cloneJsonValue(traceEvents[gridIndex]),
        gridHash: hashBaselineValue(traceEvents[gridIndex]),
        candidate: candidate ? cloneJsonValue(candidate) : null,
        candidateHash: candidate ? hashBaselineValue(candidate) : null,
        firstPass: firstPass ? cloneJsonValue(firstPass) : null,
        firstPassHash: firstPass ? hashBaselineValue(firstPass) : null
    };
}

/**
 * source fixture를 실제 legacy ObjectSystem fixed path로 실행해 baseline을 생성합니다.
 * @param {object} fixture - source replay fixture입니다.
 * @returns {Promise<object>} 결정론 baseline입니다.
 */
export async function exportLegacyCollisionProjectileBaseline(fixture) {
    validateReplayFixture(fixture);
    const modules = await loadProductionModules();
    const allTraceEvents = [];
    const world = await createReplayWorld(
        fixture,
        modules,
        (event) => allTraceEvents.push(captureCollisionTraceEvent(event))
    );
    const checkpointTicks = new Set(fixture.checkpointTicks);
    const traceCheckpointTicks = new Set(fixture.traceCheckpointTicks);
    const records = [];
    const checkpoints = [];
    const traceCheckpoints = [];
    const appliedEvents = [];
    const projectileHits = [];
    const firstSleepTickByEnemyId = new Map();

    const initialState = createWorldState(-1, world);
    const initialStateHash = hashBaselineValue(initialState);
    let previousEnemyOrder = [...initialState.enemyOrder];
    for (let tick = 0; tick < fixture.fixedStep.tickCount; tick++) {
        appliedEvents.push(...applyReplayEvents(tick, fixture.events, world.objectSystem));
        const traceStart = allTraceEvents.length;
        world.objectSystem.fixedUpdate();
        const tickTrace = allTraceEvents.slice(traceStart);
        const state = createWorldState(tick, world);
        const stateHash = hashBaselineValue(state);
        const hitEvents = tickTrace.filter((event) => event.type === 'projectileHit');
        for (let hitIndex = 0; hitIndex < hitEvents.length; hitIndex++) {
            projectileHits.push(cloneJsonValue(hitEvents[hitIndex]));
        }
        for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex++) {
            const enemy = state.enemies[enemyIndex];
            if (enemy.collisionSleepTicks > 0 && !firstSleepTickByEnemyId.has(enemy.id)) {
                firstSleepTickByEnemyId.set(enemy.id, tick);
            }
        }

        const candidateEvents = tickTrace.filter((event) => event.type === 'candidateBuild');
        const solvePassEvents = tickTrace.filter((event) => event.type === 'solvePass');
        const currentEnemyIdSet = new Set(state.enemyOrder);
        const releasedEnemyIdsSincePreviousTick = previousEnemyOrder.filter(
            (enemyId) => !currentEnemyIdSet.has(enemyId)
        );
        records.push({
            tick,
            stateHash,
            traceHash: hashBaselineValue(tickTrace),
            enemyOrderHash: hashBaselineValue(state.enemyOrder),
            enemyCount: state.enemies.length,
            activeEnemyCount: state.enemies.filter((enemy) => enemy.active).length,
            releasedEnemyIdsSincePreviousTick,
            hitOrder: hitEvents.map((event) => [event.projectileId, event.enemyId]),
            candidateBuildCount: candidateEvents.length,
            scanTruncateCount: candidateEvents.reduce(
                (sum, event) => sum + event.counters.scanTruncateCount,
                0
            ),
            solvePassCount: solvePassEvents.length,
            resolvedPairCount: solvePassEvents.reduce(
                (sum, event) => sum + event.resolvedCount,
                0
            )
        });
        previousEnemyOrder = [...state.enemyOrder];
        if (checkpointTicks.has(tick)) {
            checkpoints.push({ tick, stateHash, state });
        }
        if (traceCheckpointTicks.has(tick)) {
            traceCheckpoints.push(createTraceCheckpoint(tick, tickTrace));
        }
    }

    const firstSolveInternals = createFirstSolveInternals(allTraceEvents);
    const finalStateHash = records.at(-1).stateHash;
    const baseline = {
        schemaVersion: BASELINE_SCHEMA_VERSION,
        fixtureId: fixture.fixtureId,
        oracle: {
            runtime: 'javascript-legacy-object-system',
            contractVersion: 1,
            hashAlgorithm: HASH_ALGORITHM,
            canonicalEncoding: CANONICAL_ENCODING,
            productionEntrypoint: 'ObjectSystem.fixedUpdate()',
            productionConstructors: [
                'ObjectSystem.spawnEnemy()',
                'Player.init()',
                'BaseWall.init()',
                'BaseProj.init()'
            ],
            authoritativeScope: [
                'legacy Title/Benchmark global ObjectSystem fixed-step collision order',
                'Float32 broad and Float64 relation/candidate planes with kind/shape code arrays',
                'ordered grid cells, bucket body indices, scan epochs and fairness tokens',
                'priority-before-normal candidate order and rotating pair start tokens',
                'dense, hexa-hive anchor, sleep and three-pass position solve state',
                'ObjectSystem swap-pop release order',
                'projectile initial overlap, fast sweep, piercing/non-piercing and same-tick target deactivation'
            ],
            unavailableCapabilities: [
                'current GameScene GameSystem Tower-to-tile collision path (covered by the separate SDL GameSystem oracle)',
                'generic WAT collision solver (the production WAT module only answers prepared hexa boolean contact)',
                'rendering, interpolation and display state',
                'enemy navigation/decision behavior and deterministic RNG state'
            ]
        },
        replay: cloneJsonValue(fixture),
        initialStateHash,
        initialState,
        records,
        checkpoints,
        traceCheckpoints,
        firstSolveInternals,
        appliedEvents,
        projectileHits,
        sleepEntryTicks: [...firstSleepTickByEnemyId.entries()].map(([enemyId, tick]) => ({
            enemyId,
            tick
        })),
        summary: {
            tickCount: records.length,
            traceEventCount: allTraceEvents.length,
            fullTraceHash: hashBaselineValue(allTraceEvents),
            recordsHash: hashBaselineValue(records),
            projectileHitCount: projectileHits.length,
            projectileHitOrderHash: hashBaselineValue(projectileHits),
            totalScanTruncateCount: records.reduce((sum, record) => sum + record.scanTruncateCount, 0),
            totalResolvedPairCount: records.reduce((sum, record) => sum + record.resolvedPairCount, 0),
            finalEnemyOrder: world.objectSystem.enemies.map((enemy) => enemy.id),
            finalStateHash
        }
    };
    return cloneJsonValue(baseline);
}

/**
 * 기본 source fixture를 production oracle로 실행합니다.
 * @returns {Promise<object>} 생성한 baseline입니다.
 */
export async function exportDefaultLegacyCollisionProjectileBaseline() {
    return exportLegacyCollisionProjectileBaseline(await readJsonFixture(DEFAULT_SOURCE_FIXTURE_URL));
}

/**
 * trace seam을 전혀 설정하지 않은 기본 경로와 명시적 null sink 경로의 첫 fixed state를 비교합니다.
 * sink가 null일 때 production 결과가 바뀌지 않는다는 회귀 테스트용 helper입니다.
 * @returns {Promise<{defaultStateHash:string, nullSinkStateHash:string}>} 두 경로의 state hash입니다.
 */
export async function exportLegacyCollisionNullSinkParity() {
    const fixture = await readJsonFixture(DEFAULT_SOURCE_FIXTURE_URL);
    validateReplayFixture(fixture);
    const modules = await loadProductionModules();
    const defaultWorld = await createReplayWorld(fixture, modules, undefined);
    defaultWorld.objectSystem.fixedUpdate();
    const defaultStateHash = hashBaselineValue(createWorldState(0, defaultWorld));

    const nullSinkWorld = await createReplayWorld(fixture, modules, null);
    nullSinkWorld.objectSystem.fixedUpdate();
    const nullSinkStateHash = hashBaselineValue(createWorldState(0, nullSinkWorld));
    return { defaultStateHash, nullSinkStateHash };
}

/**
 * 저장 baseline과 현재 production oracle 결과가 같은지 확인합니다.
 * @returns {Promise<object>} 검증된 baseline입니다.
 */
export async function checkDefaultLegacyCollisionProjectileBaseline() {
    const actual = await exportDefaultLegacyCollisionProjectileBaseline();
    const expected = await readJsonFixture(DEFAULT_BASELINE_FIXTURE_URL);
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(
            'legacy collision/projectile baseline이 현재 production oracle과 다릅니다. '
            + '`npm run baseline:sdl:legacy:update`로 의도한 변경을 검토해 갱신하세요.'
        );
    }
    return actual;
}

/**
 * CLI에서 baseline을 갱신하거나 확인합니다.
 * @returns {Promise<void>}
 */
async function runCli() {
    const args = new Set(process.argv.slice(2));
    const baseline = await exportDefaultLegacyCollisionProjectileBaseline();
    if (args.has('--update')) {
        await writeFile(
            DEFAULT_BASELINE_FIXTURE_URL,
            `${JSON.stringify(baseline, null, 2)}\n`,
            'utf8'
        );
        console.log(
            `legacy collision/projectile baseline updated: ${baseline.summary.tickCount} ticks, `
            + `${baseline.summary.projectileHitCount} hits, ${baseline.summary.finalStateHash}`
        );
        return;
    }
    if (args.has('--stdout')) {
        process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
        return;
    }

    const expected = await readJsonFixture(DEFAULT_BASELINE_FIXTURE_URL);
    if (!isDeepStrictEqual(baseline, expected)) {
        throw new Error(
            'legacy collision/projectile baseline check failed. '
            + '`npm run baseline:sdl:legacy:update`로 의도한 변경을 검토해 갱신하세요.'
        );
    }
    console.log(
        `legacy collision/projectile baseline ok: ${baseline.summary.tickCount} ticks, `
        + `${baseline.summary.projectileHitCount} hits, ${baseline.summary.finalStateHash}`
    );
}

const isMainModule = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
    await runCli();
}
