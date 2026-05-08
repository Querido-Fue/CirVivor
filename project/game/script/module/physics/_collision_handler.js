import { CollisionDetector } from './_collision_detector.js';
import { getSimulationObjectWH, getSimulationSetting } from '../simulation/simulation_runtime.js';

const EPSILON = 1e-6;
const CELL_KEY_OFFSET = 4096;
const CELL_KEY_STRIDE = 8192;
const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 280;
const BROAD_STRIDE = 14;
const RELATION_BROAD_STRIDE = 8;
const BODY_KIND_NONE = 0;
const BODY_KIND_ENEMY = 1;
const BODY_KIND_PLAYER = 2;
const BODY_KIND_WALL = 3;
const BODY_KIND_PROJECTILE = 4;
const BODY_KIND_ITEM = 5;
const BODY_SHAPE_NONE = 0;
const BODY_SHAPE_CIRCLE = 1;
const BODY_SHAPE_CIRCLE_PARTS = 2;
const BODY_SHAPE_RECT = 3;
const DEFAULT_PHYSICS_ITERATION_COUNT = 3;
const GRID_BUCKET_INITIAL_CAPACITY = 8;
const ROTATION_IMPULSE_SCALE = 0.12;
const ROTATION_RESPONSE_MULTIPLIER = 1.3;
const COLLISION_RESOLVE_PERCENT = 0.55;
const COLLISION_RESOLVE_SLOP = 0.8;
const COLLISION_RESOLVE_MAX_RATIO = 0.16;
const COLLISION_RESOLVE_MIN_MAX = 1.25;
const COLLISION_RESOLVE_FRAME_MAX_RATIO = 0.42;
const COLLISION_RESOLVE_FRAME_MIN_MAX = 2.2;
const HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE = 1.1;
const HEXA_HIVE_COLLISION_RESOLVE_RADIUS_ROOT_SCALE = 0.55;
const ENEMY_COLLISION_ROTATION_SCALE = 0.25;
const ENEMY_COLLISION_SPEED_GAP_DEADZONE = 8;
const ENEMY_COLLISION_CENTER_DEADZONE = 0.24;
const ENEMY_COLLISION_MIN_EFFECTIVE_IMPULSE = 0.35;
const ENEMY_COLLISION_MAX_ANGULAR_IMPULSE = 42;
const PROJECTILE_SWEEP_RADIUS_STEP = 0.45;
const COLLISION_IDLE_TICKS_TO_SLEEP = 45;
const COLLISION_SLEEP_TICKS = 2;
const COLLISION_SLEEP_SPEED_SQ = 9; // 3px/s 이하
const COLLISION_AXIS_RESISTANCE_MIN = 0.25;
const COLLISION_AXIS_RESISTANCE_GAIN = 0.85;
const COLLISION_AXIS_RESISTANCE_RADIUS_RATIO = 0.35;
const COLLISION_GRID_RADIUS_SCALE = 1.03;
const COLLISION_RADIUS_TUNING_SCALE = 0.85;
const ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE = 0.9;
const ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE = 1.1;
const ENEMY_PAIR_COLLISION_RADIUS_SCALE = ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
const ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE = ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
const HEXA_HIVE_CELL_COLLISION_RADIUS = 0.47 / ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE;
const DENSE_REBUILD_DENSITY_THRESHOLD = 0.45;
const DENSE_REBUILD_MIN_RESOLVED = 8;
const DENSE_REBUILD_MAX_EXTRA_PASSES = 4;
const DENSE_MIN_ITERATION_FLOOR = 5;
const DENSE_LOCAL_CANDIDATE_THRESHOLD = 8;
const DENSE_STABILIZE_MAX_PASSES = 4;
const DENSE_STABILIZE_LIGHT_MAX_PASSES = 2;
const DENSE_STABILIZE_MIN_RESOLVED = 4;
const DENSE_RESOLVE_BOOST = 1.55;
const LARGE_POPULATION_DENSE_BODY_THRESHOLD = 512;
const LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES = 2;
const LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR = 3;
const LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES = 2;
const LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES = 1;
const LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST = 1.28;
const LARGE_POPULATION_DENSE_RESOLVE_BOOST = 1.85;
const ENEMY_PAIR_PROCESS_BUDGET_POSITION = 14;
const ENEMY_PAIR_PROCESS_BUDGET_STABILIZE = 10;
const ENEMY_PAIR_PROCESS_BUDGET_NON_POSITION = 8;
const DENSE_CORRECTION_CANDIDATE_THRESHOLD = 5;
const DENSE_CORRECTION_SCALE_PER_NEIGHBOR = 0.06;
const DENSE_CORRECTION_SCALE_MAX = 2.4;
const DENSE_FRAME_CANDIDATE_THRESHOLD = 6;
const DENSE_FRAME_SCALE_PER_NEIGHBOR = 0.065;
const DENSE_FRAME_SCALE_MAX = 2.5;
const PRESSURE_WEIGHT_MIN = 0.35;
const PRESSURE_WEIGHT_MAX = 8;
const PRESSURE_HEXA_HIVE_WEIGHT_MAX = 64;
const PRESSURE_WEIGHT_EXPONENT = 0.6;
const MERGE_PENDING_RESOLVE_WEIGHT = 100000;
const PRESSURE_ENTRY_THRESHOLD = 4;
const PRESSURE_ENTRY_SCALE_PER_NEIGHBOR = 0.14;
const PRESSURE_ENTRY_SCALE_MAX = 2.8;
const PRESSURE_ESCAPE_THRESHOLD = 8;
const PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR = 0.055;
const PRESSURE_ESCAPE_SCALE_MAX = 1.45;
const MULTI_CONTACT_NORMAL_DIVERSITY_SCALE = 0.9;
const MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX = 1.85;
const COLLISION_PROFILE_STAT_FIELDS = Object.freeze([
    'enemyTotalMs',
    'enemyBodyBuildMs',
    'playerBodyBuildMs',
    'wallBodyBuildMs',
    'enemyPositionSolveMs',
    'enemyStabilizeMs',
    'enemyNonPositionMs',
    'solveGridMs',
    'solvePairScanMs',
    'solveCandidateBuildMs',
    'solvePairProcessMs',
    'solveNarrowphaseMs',
    'projectileTotalMs',
    'projectileEnemyBodyBuildMs',
    'projectileGridBuildMs',
    'projectileScanMs',
    'projectileCandidateQueryMs',
    'projectileNarrowphaseMs',
    'contactTotalMs',
    'contactBodyBuildMs',
    'contactGridBuildMs',
    'contactPairScanMs',
    'solveBucketPairCount',
    'solveCandidatePairCount',
    'solveDuplicatePairSkipCount',
    'solveRuleRejectCount',
    'solveAabbPassCount',
    'solveCirclePassCount',
    'solveResolvedPairCount',
    'solveBudgetSkipCount',
    'solveLargePopulationMode'
]);
const COLLISION_RULE_NONE = Object.freeze({
    check: false,
    resolve: false,
    movableA: null,
    movableB: null,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_DYNAMIC_RESOLVE = Object.freeze({
    check: true,
    resolve: true,
    movableA: null,
    movableB: null,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_ENEMY_PLAYER = Object.freeze({
    check: true,
    resolve: true,
    movableA: true,
    movableB: false,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_PLAYER_ENEMY = Object.freeze({
    check: true,
    resolve: true,
    movableA: false,
    movableB: true,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_PROJECTILE_ENEMY = Object.freeze({
    check: true,
    resolve: false,
    movableA: null,
    movableB: null,
    oneShotByProjectile: true,
    applyImpactRotation: true
});
const COLLISION_RULE_PLAYER_PROJECTILE = Object.freeze({
    check: true,
    resolve: false,
    movableA: null,
    movableB: null,
    oneShotByProjectile: true,
    applyImpactRotation: false
});
const COLLISION_RULE_PLAYER_ITEM = Object.freeze({
    check: true,
    resolve: false,
    movableA: null,
    movableB: null,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_PROJECTILE_PROJECTILE = Object.freeze({
    check: true,
    resolve: false,
    movableA: null,
    movableB: null,
    oneShotByProjectile: true,
    applyImpactRotation: false
});
const COLLISION_RULE_WALL_PROJECTILE = Object.freeze({
    check: true,
    resolve: false,
    movableA: false,
    movableB: true,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_PROJECTILE_WALL = Object.freeze({
    check: true,
    resolve: false,
    movableA: true,
    movableB: false,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_WALL_OTHER = Object.freeze({
    check: true,
    resolve: true,
    movableA: false,
    movableB: true,
    oneShotByProjectile: false,
    applyImpactRotation: false
});
const COLLISION_RULE_OTHER_WALL = Object.freeze({
    check: true,
    resolve: true,
    movableA: true,
    movableB: false,
    oneShotByProjectile: false,
    applyImpactRotation: false
});

/**
 * 합체 적 충돌 형상 기준 셀 수를 반환합니다.
 * @param {object|null|undefined} enemy
 * @returns {number}
 */
function getHexaHiveCollisionCellCount(enemy) {
    const candidateCounts = [
        enemy?.hexaHiveLayout?.filledCells?.length,
        enemy?.hexaHiveLayout?.filledLocalCenters?.length,
        enemy?.hexaHiveLayout?.visibleLocalCenters?.length
    ];

    for (let i = 0; i < candidateCounts.length; i++) {
        const count = candidateCounts[i];
        if (Number.isInteger(count) && count > 0) {
            return count;
        }
    }

    return 1;
}

/**
 * 큰 육각 합체 적은 전체 외곽 반경 기준으로 충돌 보정을 허용하면
 * 양끝 동시 충돌 시 중심이 과도하게 밀릴 수 있으므로,
 * 단일 셀 높이와 전체 외곽 반경의 중간값을 사용해 보정 상한을 조절합니다.
 * @param {object|null|undefined} enemy
 * @param {number} boundRadius
 * @param {number} baseHeight
 * @returns {number}
 */
function getEnemyResolveRadius(enemy, boundRadius, baseHeight) {
    const safeBoundRadius = Number.isFinite(boundRadius) ? Math.max(COLLISION_RESOLVE_MIN_MAX, boundRadius) : COLLISION_RESOLVE_MIN_MAX;
    if (enemy?.type !== 'hexa_hive') {
        return safeBoundRadius;
    }

    const safeBaseHeight = Number.isFinite(baseHeight) ? Math.max(COLLISION_RESOLVE_MIN_MAX, baseHeight) : safeBoundRadius;
    const cellCount = getHexaHiveCollisionCellCount(enemy);
    const rootedCellCount = Math.max(1, Math.sqrt(cellCount));
    const cellDrivenRadius = safeBaseHeight * (
        HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE
        + (Math.max(0, rootedCellCount - 1) * HEXA_HIVE_COLLISION_RESOLVE_RADIUS_ROOT_SCALE)
    );
    const hybridRadius = Math.sqrt(safeBoundRadius * safeBaseHeight);
    return Math.max(
        COLLISION_RESOLVE_MIN_MAX,
        Math.min(
            safeBoundRadius,
            Math.max(
                safeBaseHeight * HEXA_HIVE_COLLISION_RESOLVE_RADIUS_SCALE,
                hybridRadius,
                cellDrivenRadius
            )
        )
    );
}

/**
 * 적 타입별 단일 원 충돌 반지름을 계산합니다.
 * @param {string|null|undefined} enemyType
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function getEnemyCircleCollisionRadius(enemyType, width, height) {
    const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
    const safeHeight = Number.isFinite(height) ? Math.max(1, height) : safeWidth;
    let radius = 0;

    switch (enemyType) {
        case 'triangle':
            radius = Math.max(
                safeHeight * 0.5333,
                Math.hypot(safeWidth * 0.462, safeHeight * 0.2667)
            );
            break;
        case 'arrow':
            radius = Math.max(
                safeHeight * 0.5767,
                Math.hypot(safeWidth * 0.46, safeHeight * 0.3733)
            );
            break;
        case 'hexa':
            radius = 0.47 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.8660254037844386, safeHeight * 0.5)
            );
            break;
        case 'penta':
            radius = 0.48 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.9510565162951535, safeHeight * 0.3090169943749474),
                Math.hypot(safeWidth * 0.5877852522924731, safeHeight * 0.8090169943749475)
            );
            break;
        case 'rhom':
            radius = Math.max(safeWidth * 0.34, safeHeight * 0.5);
            break;
        case 'octa':
            radius = 0.47 * Math.max(
                Math.hypot(safeWidth * 0.9238795325112867, safeHeight * 0.3826834323650898),
                Math.hypot(safeWidth * 0.3826834323650898, safeHeight * 0.9238795325112867)
            );
            break;
        case 'gen':
            radius = Math.hypot(safeWidth * 0.44, safeHeight * 0.44);
            break;
        case 'square':
        default:
            radius = Math.hypot(safeWidth * 0.42, safeHeight * 0.42);
            break;
    }

    return Math.max(1, radius);
}

/**
 * 적 수에 따라 dense 충돌 해소 반복 상한을 반환합니다.
 * @param {number} dynamicBodyCount
 * @returns {{largePopulation:boolean, denseRebuildMaxExtraPasses:number, denseMinIterationFloor:number, denseStabilizeMaxPasses:number, denseStabilizeLightMaxPasses:number, denseIterationResolveBoost:number, denseResolveBoost:number}}
 */
function getDenseSolveTuning(dynamicBodyCount) {
    const largePopulation = Number.isFinite(dynamicBodyCount)
        && dynamicBodyCount >= LARGE_POPULATION_DENSE_BODY_THRESHOLD;
    if (!largePopulation) {
        return {
            largePopulation: false,
            denseRebuildMaxExtraPasses: DENSE_REBUILD_MAX_EXTRA_PASSES,
            denseMinIterationFloor: DENSE_MIN_ITERATION_FLOOR,
            denseStabilizeMaxPasses: DENSE_STABILIZE_MAX_PASSES,
            denseStabilizeLightMaxPasses: DENSE_STABILIZE_LIGHT_MAX_PASSES,
            denseIterationResolveBoost: 1.18,
            denseResolveBoost: DENSE_RESOLVE_BOOST
        };
    }

    return {
        largePopulation: true,
        denseRebuildMaxExtraPasses: LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES,
        denseMinIterationFloor: LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR,
        denseStabilizeMaxPasses: LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES,
        denseStabilizeLightMaxPasses: LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES,
        denseIterationResolveBoost: LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST,
        denseResolveBoost: LARGE_POPULATION_DENSE_RESOLVE_BOOST
    };
}

/**
 * @typedef {object} CollisionRule
 * @property {boolean} check
 * @property {boolean} resolve
 * @property {boolean|null} movableA
 * @property {boolean|null} movableB
 * @property {boolean} oneShotByProjectile
 * @property {boolean} applyImpactRotation
 */

/**
 * @typedef {object} GridBucket
 * @property {Int32Array} indices 셀에 포함된 body 인덱스 버퍼
 * @property {number} count 현재 사용 중인 인덱스 개수
 */

/**
 * @class CollisionHandler
 * @description broad-phase + narrow-phase + resolve를 담당하는 충돌 핸들러
 */
export class CollisionHandler {
    #grid;
    #tempBodies;
    #wallBodiesCache;
    #wallBodiesDirty;
    #frameStats;
    #bodyPool;
    #bodyPoolCursor;
    #enemyBodiesBuffer;
    #playerBodiesBuffer;
    #pairBitmap;
    #pairBitmapBodyCount;
    #scratchProjectileBody;
    #scratchManifold;
    #scratchCandidateManifold;
    #scratchBestManifold;
    #broadData;
    #relationBroadData;
    #bodyKindCodes;
    #bodyShapeCodes;
    #broadBodyCount;
    #bucketPool;
    #bucketPoolCursor;
    #activeGridBuckets;
    #queryMarks;
    #queryMarkStamp;
    #queryCandidateIndices;
    #candidatePairLowIndices;
    #candidatePairHighIndices;
    #candidatePairCount;
    #candidatePairBodyCount;
    #enemyBodyFrameToken;
    #enemyBodyCache;
    #profileEnabled;

    constructor() {
        this.detector = new CollisionDetector();
        this.walls = [];
        this.#grid = new Map();
        this.#tempBodies = [];
        this.#wallBodiesCache = [];
        this.#wallBodiesDirty = true;
        this.#frameStats = {
            collisionCheckCount: 0,
            aabbPassCount: 0,
            aabbRejectCount: 0,
            circlePassCount: 0,
            circleRejectCount: 0,
            partChecks: 0,
            enemyTotalMs: 0,
            enemyBodyBuildMs: 0,
            playerBodyBuildMs: 0,
            wallBodyBuildMs: 0,
            enemyPositionSolveMs: 0,
            enemyStabilizeMs: 0,
            enemyNonPositionMs: 0,
            solveGridMs: 0,
            solvePairScanMs: 0,
            solveCandidateBuildMs: 0,
            solvePairProcessMs: 0,
            solveNarrowphaseMs: 0,
            projectileTotalMs: 0,
            projectileEnemyBodyBuildMs: 0,
            projectileGridBuildMs: 0,
            projectileScanMs: 0,
            projectileCandidateQueryMs: 0,
            projectileNarrowphaseMs: 0,
            contactTotalMs: 0,
            contactBodyBuildMs: 0,
            contactGridBuildMs: 0,
            contactPairScanMs: 0,
            solveBucketPairCount: 0,
            solveCandidatePairCount: 0,
            solveDuplicatePairSkipCount: 0,
            solveRuleRejectCount: 0,
            solveAabbPassCount: 0,
            solveCirclePassCount: 0,
            solveResolvedPairCount: 0,
            solveBudgetSkipCount: 0,
            solveLargePopulationMode: 0
        };
        this.#bodyPool = [];
        this.#bodyPoolCursor = 0;
        this.#enemyBodiesBuffer = [];
        this.#playerBodiesBuffer = [];
        this.#pairBitmap = new Uint32Array(512);
        this.#pairBitmapBodyCount = 0;
        this.#scratchProjectileBody = {
            kind: 'projectile', shape: 'circle',
            x: 0, y: 0, centerX: 0, centerY: 0, radius: 0,
            weight: 1, movable: false, ref: null, id: -1,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
            sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
            boundRadius: 0, broadRadius: 0, velocityX: 0, velocityY: 0,
            enemyPairMinX: 0, enemyPairMaxX: 0, enemyPairMinY: 0, enemyPairMaxY: 0,
            projectileMinX: 0, projectileMaxX: 0, projectileMinY: 0, projectileMaxY: 0,
            enemyPairBroadRadius: 0, projectileBroadRadius: 0,
            circleParts: null, circlePartCount: 0, mergeLock: false,
            _broadDataIndex: -1,
            _candidatePairCount: 0, _resolvedPairCount: 0, _passPairProcessCount: 0,
            _frameResolveMoved: 0, _frameResolveMax: Infinity
        };
        this.#scratchManifold = {
            collided: false,
            normalX: 1, normalY: 0, penetration: 0, pointX: 0, pointY: 0,
            moveAX: 0, moveAY: 0, moveBX: 0, moveBY: 0
        };
        this.#scratchCandidateManifold = {
            collided: false,
            normalX: 1, normalY: 0, penetration: 0, pointX: 0, pointY: 0,
            moveAX: 0, moveAY: 0, moveBX: 0, moveBY: 0
        };
        this.#scratchBestManifold = {
            collided: false,
            normalX: 1, normalY: 0, penetration: 0, pointX: 0, pointY: 0,
            moveAX: 0, moveAY: 0, moveBX: 0, moveBY: 0
        };
        this.#broadData = new Float32Array(512 * BROAD_STRIDE);
        this.#relationBroadData = new Float64Array(512 * RELATION_BROAD_STRIDE);
        this.#bodyKindCodes = new Uint8Array(512);
        this.#bodyShapeCodes = new Uint8Array(512);
        this.#broadBodyCount = 0;
        this.#bucketPool = [];
        this.#bucketPoolCursor = 0;
        this.#activeGridBuckets = [];
        this.#queryMarks = new Int32Array(512);
        this.#queryMarkStamp = 0;
        this.#queryCandidateIndices = [];
        this.#candidatePairLowIndices = new Int32Array(1024);
        this.#candidatePairHighIndices = new Int32Array(1024);
        this.#candidatePairCount = 0;
        this.#candidatePairBodyCount = 0;
        this.#enemyBodyFrameToken = 0;
        this.#enemyBodyCache = {
            frameToken: -1,
            enemies: null,
            delta: 0,
            sourceLength: 0,
            bodies: this.#enemyBodiesBuffer
        };
        this.#profileEnabled = false;
    }

    /**
     * @param {object[]} walls
     */
    setWalls(walls) {
        this.walls = Array.isArray(walls) ? walls : [];
        this.#wallBodiesDirty = true;
    }

    /**
     * @returns {object[]}
     */
    getWalls() {
        return this.walls;
    }

    /**
     * 고정 틱 시작 시 충돌 체크 카운터를 초기화합니다.
     */
    resetFrameStats() {
        this.#profileEnabled = this.#isProfilingEnabled();
        this.#enemyBodyFrameToken++;
        this.#invalidateEnemyBodyCache();
        this.#frameStats.collisionCheckCount = 0;
        this.#frameStats.aabbPassCount = 0;
        this.#frameStats.aabbRejectCount = 0;
        this.#frameStats.circlePassCount = 0;
        this.#frameStats.circleRejectCount = 0;
        this.#frameStats.partChecks = 0;
        for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
            this.#frameStats[COLLISION_PROFILE_STAT_FIELDS[i]] = 0;
        }
    }

    /**
     * 마지막 고정 틱의 충돌 체크 카운트를 반환합니다.
     * @returns {object}
     */
    getFrameStats() {
        const stats = {
            collisionCheckCount: this.#frameStats.collisionCheckCount,
            aabbPassCount: this.#frameStats.aabbPassCount,
            aabbRejectCount: this.#frameStats.aabbRejectCount,
            circlePassCount: this.#frameStats.circlePassCount,
            circleRejectCount: this.#frameStats.circleRejectCount,
            partChecks: this.#frameStats.partChecks
        };
        for (let i = 0; i < COLLISION_PROFILE_STAT_FIELDS.length; i++) {
            const fieldName = COLLISION_PROFILE_STAT_FIELDS[i];
            stats[fieldName] = Number.isFinite(this.#frameStats[fieldName]) ? this.#frameStats[fieldName] : 0;
        }
        return stats;
    }

    /**
     * @private
     * 충돌 세부 계측 활성 여부를 반환합니다.
     * @returns {boolean}
     */
    #isProfilingEnabled() {
        return getSimulationSetting('debugMode', false) === true;
    }

    /**
     * @private
     * 충돌 계측 시작 시각을 반환합니다.
     * @returns {number|null}
     */
    #startProfileTimer() {
        return this.#profileEnabled ? performance.now() : null;
    }

    /**
     * @private
     * 충돌 계측 시간을 누적합니다.
     * @param {string} fieldName
     * @param {number|null} startTime
     */
    #recordProfileDuration(fieldName, startTime) {
        if (!Number.isFinite(startTime)) {
            return;
        }

        const durationMs = performance.now() - startTime;
        this.#frameStats[fieldName] = (Number.isFinite(this.#frameStats[fieldName]) ? this.#frameStats[fieldName] : 0) + durationMs;
    }

    /**
     * @private
     * 충돌 계측 카운터를 누적합니다.
     * @param {string} fieldName
     * @param {number} [amount=1]
     */
    #recordProfileCount(fieldName, amount = 1) {
        if (!this.#profileEnabled) {
            return;
        }

        const safeAmount = Number.isFinite(amount) ? amount : 1;
        this.#frameStats[fieldName] = (Number.isFinite(this.#frameStats[fieldName]) ? this.#frameStats[fieldName] : 0) + safeAmount;
    }

    /**
     * @private
     * 원형 part 상세 검사 횟수를 누적합니다.
     */
    #recordPartCheck() {
        this.#frameStats.partChecks++;
    }

    /**
     * 적 목록 충돌을 처리합니다.
     * @param {object[]} enemies
     * @param {object} [options]
     * @param {number} [options.delta=1/60]
     * @param {object[]} [options.players]
     * @returns {number} 처리된 충돌 건수
     */
    resolveEnemyCollisions(enemies, options = {}) {
        const totalStart = this.#startProfileTimer();
        try {
            if (!Array.isArray(enemies) || enemies.length === 0) return 0;

            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const maxIterations = this.#resolveIterationCount();
            const players = Array.isArray(options.players) ? options.players : [];

            const enemyBodyBuildStart = this.#startProfileTimer();
            const dynamicBodies = this.#buildFreshEnemyBodies(enemies, delta, true);
            this.#recordProfileDuration('enemyBodyBuildMs', enemyBodyBuildStart);

            const playerBodyBuildStart = this.#startProfileTimer();
            const playerBodies = this.#buildPlayerBodies(players, delta);
            this.#recordProfileDuration('playerBodyBuildMs', playerBodyBuildStart);

            const wallBodyBuildStart = this.#startProfileTimer();
            const staticBodies = this.#buildWallBodies();
            this.#recordProfileDuration('wallBodyBuildMs', wallBodyBuildStart);
            if (dynamicBodies.length === 0 && playerBodies.length === 0) return 0;

            for (let i = 0; i < dynamicBodies.length; i++) {
                dynamicBodies[i]._candidatePairCount = 0;
                dynamicBodies[i]._resolvedPairCount = 0;
                dynamicBodies[i]._passPairProcessCount = 0;
                dynamicBodies[i]._frameResolveMoved = 0;
                const radius = Math.max(
                    1,
                    Number.isFinite(dynamicBodies[i].resolveRadius)
                        ? dynamicBodies[i].resolveRadius
                        : (Number.isFinite(dynamicBodies[i].boundRadius) ? dynamicBodies[i].boundRadius : 1)
                );
                dynamicBodies[i]._frameResolveMax = Math.max(
                    COLLISION_RESOLVE_FRAME_MIN_MAX,
                    radius * COLLISION_RESOLVE_FRAME_MAX_RATIO
                );
            }

            const bodies = this.#tempBodies;
            bodies.length = 0;
            for (let i = 0; i < dynamicBodies.length; i++) bodies.push(dynamicBodies[i]);
            for (let i = 0; i < playerBodies.length; i++) bodies.push(playerBodies[i]);
            for (let i = 0; i < staticBodies.length; i++) bodies.push(staticBodies[i]);

            let totalResolved = 0;
            let adaptiveMax = maxIterations;
            let minIterations = 1;
            let lastResolved = 0;
            let denseRebuildPasses = 0;
            let denseMode = false;
            let peakCandidatePairs = 0;
            const denseSolveTuning = getDenseSolveTuning(dynamicBodies.length);
            if (denseSolveTuning.largePopulation) {
                this.#recordProfileCount('solveLargePopulationMode');
            }
            const positionSolveStart = this.#startProfileTimer();
            for (let i = 0; i < adaptiveMax; i++) {
                const shouldDenseRebuild = (
                    i > 0 &&
                    denseMode &&
                    denseRebuildPasses < denseSolveTuning.denseRebuildMaxExtraPasses &&
                    lastResolved >= DENSE_REBUILD_MIN_RESOLVED
                );
                const resolved = this.#solveOnePass(bodies, {
                    resolvePositions: true,
                    applyNonPosition: false,
                    rebuildGrid: i === 0 || shouldDenseRebuild,
                    resolveBoost: denseMode && i > 0 ? denseSolveTuning.denseIterationResolveBoost : 1
                });
                if (shouldDenseRebuild) denseRebuildPasses++;
                totalResolved += resolved;
                if (i === 0 && maxIterations > 2) {
                    const density = resolved / Math.max(1, bodies.length);
                    peakCandidatePairs = this.#getPeakCandidatePairs(dynamicBodies);
                    const localDense = peakCandidatePairs >= DENSE_LOCAL_CANDIDATE_THRESHOLD;
                    if (density < 0.5 && !localDense) {
                        adaptiveMax = Math.max(2, Math.ceil(maxIterations * Math.min(1, density * 2)));
                    } else {
                        denseMode = density >= DENSE_REBUILD_DENSITY_THRESHOLD || localDense;
                    }
                    if (denseMode) {
                        minIterations = Math.min(maxIterations, denseSolveTuning.denseMinIterationFloor);
                    }
                }
                lastResolved = resolved;
                if (resolved === 0 && (i + 1) >= minIterations) break;
            }
            this.#recordProfileDuration('enemyPositionSolveMs', positionSolveStart);

            if (denseMode && lastResolved >= DENSE_STABILIZE_MIN_RESOLVED) {
                const stabilizeStart = this.#startProfileTimer();
                const stabilizeMaxPasses = peakCandidatePairs >= (DENSE_LOCAL_CANDIDATE_THRESHOLD * 2)
                    ? denseSolveTuning.denseStabilizeMaxPasses
                    : denseSolveTuning.denseStabilizeLightMaxPasses;
                for (let pass = 0; pass < stabilizeMaxPasses; pass++) {
                    const stabilized = this.#solveOnePass(bodies, {
                        resolvePositions: true,
                        applyNonPosition: false,
                        rebuildGrid: true,
                        resolveBoost: denseSolveTuning.denseResolveBoost
                    });
                    totalResolved += stabilized;
                    lastResolved = stabilized;
                    if (stabilized === 0) break;
                }
                this.#recordProfileDuration('enemyStabilizeMs', stabilizeStart);
            }

            if (totalResolved > 0) {
                const nonPositionStart = this.#startProfileTimer();
                this.#solveOnePass(bodies, {
                    resolvePositions: false,
                    applyNonPosition: true,
                    rebuildGrid: false
                });
                this.#recordProfileDuration('enemyNonPositionMs', nonPositionStart);
            }

            for (let i = 0; i < dynamicBodies.length; i++) {
                const enemy = dynamicBodies[i].ref;
                enemy.__collisionPrevX = enemy.position.x;
                enemy.__collisionPrevY = enemy.position.y;
                if (dynamicBodies[i]._candidatePairCount > 0 || dynamicBodies[i]._resolvedPairCount > 0) {
                    enemy.__collisionIdleTicks = 0;
                    enemy.__collisionSleepTicks = 0;
                } else {
                    const idleTicks = (enemy.__collisionIdleTicks || 0) + 1;
                    enemy.__collisionIdleTicks = idleTicks;
                    if (idleTicks >= COLLISION_IDLE_TICKS_TO_SLEEP) {
                        enemy.__collisionSleepTicks = COLLISION_SLEEP_TICKS;
                    }
                }
            }

            return totalResolved;
        } finally {
            this.#recordProfileDuration('enemyTotalMs', totalStart);
        }
    }

    /**
     * 고속 투사체를 서브스텝으로 검사해 적 충돌을 처리합니다.
     * 투사체-적은 resolve하지 않고 중복 피해 방지만 수행합니다.
     * @param {object[]} projectiles
     * @param {object[]} enemies
     * @param {number} delta
     * @returns {number}
     */
    resolveProjectileVsEnemies(projectiles, enemies, delta = 1 / 60) {
        const totalStart = this.#startProfileTimer();
        try {
            if (!Array.isArray(projectiles) || !Array.isArray(enemies)) return 0;
            if (projectiles.length === 0 || enemies.length === 0) return 0;

            const safeDelta = Math.max(delta, EPSILON);
            const enemyBodyBuildStart = this.#startProfileTimer();
            const enemyBodies = this.#getReusableEnemyBodies(enemies, safeDelta)
                ?? this.#buildFreshEnemyBodies(enemies, safeDelta, false);
            this.#recordProfileDuration('projectileEnemyBodyBuildMs', enemyBodyBuildStart);
            if (enemyBodies.length === 0) return 0;

            const gridBuildStart = this.#startProfileTimer();
            const enemyGridCellSize = this.#rebuildGridFromBodies(enemyBodies, 'projectile');
            this.#recordProfileDuration('projectileGridBuildMs', gridBuildStart);

            const baseSteps = this.#resolveIterationCount();
            let hitCount = 0;
            const projectileScanStart = this.#startProfileTimer();

            for (let i = 0; i < projectiles.length; i++) {
                const projectile = projectiles[i];
                if (!projectile || projectile.active === false) continue;
                if (!Number.isFinite(projectile.radius) || projectile.radius <= 0) continue;

                const startX = Number.isFinite(projectile.prevPosition?.x) ? projectile.prevPosition.x : projectile.position.x;
                const startY = Number.isFinite(projectile.prevPosition?.y) ? projectile.prevPosition.y : projectile.position.y;
                const endX = projectile.position.x;
                const endY = projectile.position.y;

                const travelX = endX - startX;
                const travelY = endY - startY;
                const travelDist = Math.hypot(travelX, travelY);
                const stepDistance = Math.max(projectile.radius * PROJECTILE_SWEEP_RADIUS_STEP, 1);
                const travelSteps = Math.max(1, Math.ceil(travelDist / stepDistance));
                const steps = Math.max(baseSteps, travelSteps);

                let hitThisProjectile = false;
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    const cx = startX + (travelX * t);
                    const cy = startY + (travelY * t);

                    const circleBody = this.#scratchProjectileBody;
                    circleBody.x = cx;
                    circleBody.y = cy;
                    circleBody.centerX = cx;
                    circleBody.centerY = cy;
                    circleBody.radius = projectile.radius;
                    circleBody.boundRadius = projectile.radius;
                    circleBody.broadRadius = projectile.radius;
                    circleBody.circleParts = null;
                    circleBody.circlePartCount = 0;
                    circleBody.weight = Math.max(EPSILON, Number.isFinite(projectile.weight) ? projectile.weight : 1);
                    circleBody.ref = projectile;
                    circleBody.minX = cx - projectile.radius;
                    circleBody.maxX = cx + projectile.radius;
                    circleBody.minY = cy - projectile.radius;
                    circleBody.maxY = cy + projectile.radius;
                    circleBody.sweepMinX = cx - projectile.radius;
                    circleBody.sweepMaxX = cx + projectile.radius;
                    circleBody.sweepMinY = cy - projectile.radius;
                    circleBody.sweepMaxY = cy + projectile.radius;

                    const candidateQueryStart = this.#startProfileTimer();
                    const candidateIndices = this.#collectGridCandidateIndices(
                        circleBody,
                        enemyGridCellSize,
                        enemyBodies.length
                    );
                    this.#recordProfileDuration('projectileCandidateQueryMs', candidateQueryStart);

                    const narrowphaseStart = this.#startProfileTimer();
                    for (let j = 0; j < candidateIndices.length; j++) {
                        const enemyBody = enemyBodies[candidateIndices[j]];
                        const enemyId = enemyBody.id;
                        if (this.#hasProjectileHit(projectile, enemyId)) continue;
                        this.#frameStats.collisionCheckCount++;
                        if (!this.#bodyAabbOverlap(circleBody, enemyBody)) {
                            this.#frameStats.aabbRejectCount++;
                            continue;
                        }
                        this.#frameStats.aabbPassCount++;
                        if (this.#shouldUseBroadCircleFilter(circleBody, enemyBody)) {
                            if (!this.#bodyBroadCircleOverlap(circleBody, enemyBody)) {
                                this.#frameStats.circleRejectCount++;
                                continue;
                            }
                            this.#frameStats.circlePassCount++;
                        }

                        const manifold = this.#detectBodies(circleBody, enemyBody);
                        if (!manifold) continue;

                        this.#markProjectileHit(projectile, enemyId);
                        this.#applyProjectileImpact(projectile, enemyBody.ref, manifold);
                        hitCount++;
                        hitThisProjectile = true;
                        if (!projectile.piercing) break;
                    }
                    this.#recordProfileDuration('projectileNarrowphaseMs', narrowphaseStart);
                    if (hitThisProjectile && !projectile.piercing) break;
                }
            }
            this.#recordProfileDuration('projectileScanMs', projectileScanStart);

            return hitCount;
        } finally {
            this.#invalidateEnemyBodyCache();
            this.#recordProfileDuration('projectileTotalMs', totalStart);
        }
    }

    /**
     * 적 목록 중 실제로 접촉하고 있는 쌍을 exact 판정으로 수집합니다.
     * 충돌 통계에는 반영하지 않습니다.
     * @param {object[]} enemies
     * @param {{delta?: number}} [options]
     * @returns {{enemyA: object, enemyB: object}[]}
     */
    collectEnemyContactPairs(enemies, options = {}) {
        const totalStart = this.#startProfileTimer();
        try {
            if (!Array.isArray(enemies) || enemies.length < 2) {
                return [];
            }

            this.#resetBodyPool();
            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const bodyBuildStart = this.#startProfileTimer();
            const bodies = this.#buildEnemyBodies(enemies, delta);
            this.#recordProfileDuration('contactBodyBuildMs', bodyBuildStart);
            if (bodies.length < 2) {
                return [];
            }

            const savedStats = {
                collisionCheckCount: this.#frameStats.collisionCheckCount,
                aabbPassCount: this.#frameStats.aabbPassCount,
                aabbRejectCount: this.#frameStats.aabbRejectCount,
                circlePassCount: this.#frameStats.circlePassCount,
                circleRejectCount: this.#frameStats.circleRejectCount,
                partChecks: this.#frameStats.partChecks
            };

            const gridBuildStart = this.#startProfileTimer();
            this.#rebuildGridFromBodies(bodies, 'enemyPair');
            this.#recordProfileDuration('contactGridBuildMs', gridBuildStart);
            this.#ensurePairBitmap(bodies.length);
            const contactPairs = [];
            const gridBuckets = this.#activeGridBuckets;

            const pairScanStart = this.#startProfileTimer();
            for (let bucketIndex = 0; bucketIndex < gridBuckets.length; bucketIndex++) {
                const bucket = gridBuckets[bucketIndex];
                const count = bucket.count;
                if (count < 2) {
                    continue;
                }

                const indices = bucket.indices;
                for (let left = 0; left < count - 1; left++) {
                    const bodyIndexA = indices[left];
                    for (let right = left + 1; right < count; right++) {
                        const bodyIndexB = indices[right];
                        const low = bodyIndexA < bodyIndexB ? bodyIndexA : bodyIndexB;
                        const high = bodyIndexA < bodyIndexB ? bodyIndexB : bodyIndexA;
                        if (this.#hasPair(low, high)) {
                            continue;
                        }
                        this.#markPair(low, high);

                        const bodyA = bodies[low];
                        const bodyB = bodies[high];
                        if (!bodyA || !bodyB || bodyA.ref === bodyB.ref) {
                            continue;
                        }

                        if (!this.#bodyAabbOverlap(bodyA, bodyB)) {
                            continue;
                        }

                        if (this.#shouldUseBroadCircleFilter(bodyA, bodyB) && !this.#bodyBroadCircleOverlap(bodyA, bodyB)) {
                            continue;
                        }

                        if (!this.#detectBodies(bodyA, bodyB)) {
                            continue;
                        }

                        contactPairs.push({
                            enemyA: bodyA.ref,
                            enemyB: bodyB.ref
                        });
                    }
                }
            }
            this.#recordProfileDuration('contactPairScanMs', pairScanStart);

            this.#frameStats.collisionCheckCount = savedStats.collisionCheckCount;
            this.#frameStats.aabbPassCount = savedStats.aabbPassCount;
            this.#frameStats.aabbRejectCount = savedStats.aabbRejectCount;
            this.#frameStats.circlePassCount = savedStats.circlePassCount;
            this.#frameStats.circleRejectCount = savedStats.circleRejectCount;
            this.#frameStats.partChecks = savedStats.partChecks;
            return contactPairs;
        } finally {
            this.#recordProfileDuration('contactTotalMs', totalStart);
        }
    }

    /**
     * @private
     * @returns {number}
     */
    #resolveIterationCount() {
        return DEFAULT_PHYSICS_ITERATION_COUNT;
    }

    /**
     * @private
     * @param {object[]} bodies
     * @param {object} [options]
     * @param {boolean} [options.resolvePositions=true]
     * @param {boolean} [options.applyNonPosition=false]
     * @param {boolean} [options.rebuildGrid=true]
     * @param {number} [options.resolveBoost=1]
     * @returns {number}
     */
    #solveOnePass(bodies, options = {}) {
        if (!bodies || bodies.length < 2) return 0;
        const resolvePositions = options.resolvePositions !== false;
        const applyNonPosition = options.applyNonPosition === true;
        const requestRebuildGrid = options.rebuildGrid !== false;
        const resolveBoost = Number.isFinite(options.resolveBoost) && options.resolveBoost > 0
            ? options.resolveBoost
            : 1;
        const rebuildGrid = requestRebuildGrid || this.#activeGridBuckets.length === 0;
        const bodyCount = bodies.length;

        const gridStart = this.#startProfileTimer();
        if (rebuildGrid) {
            this.#rebuildGridFromBodies(bodies);
        } else {
            this.#ensureBroadData(bodyCount);
            for (let i = 0; i < bodyCount; i++) {
                this.#writeBroadData(i, bodies[i]);
            }
        }
        this.#recordProfileDuration('solveGridMs', gridStart);

        const pairScanStart = this.#startProfileTimer();
        const shouldRebuildCandidatePairs = rebuildGrid || this.#candidatePairBodyCount !== bodyCount;
        if (shouldRebuildCandidatePairs) {
            const candidateBuildStart = this.#startProfileTimer();
            this.#buildCandidatePairsFromGrid(bodies);
            this.#recordProfileDuration('solveCandidateBuildMs', candidateBuildStart);
        }
        const pairProcessStart = this.#startProfileTimer();
        const resolvedCount = this.#processCandidatePairs(
            bodies,
            resolvePositions,
            applyNonPosition,
            resolveBoost
        );
        this.#recordProfileDuration('solvePairProcessMs', pairProcessStart);
        this.#recordProfileDuration('solvePairScanMs', pairScanStart);

        return resolvedCount;
    }

    /**
     * @private
     */
    #processPair(bodyA, bodyB, resolvePositions = true, applyNonPosition = false, resolveBoost = 1, pairRule = null) {
        if (bodyA?.ref && bodyA.ref === bodyB?.ref) return 0;
        if (bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy') {
            const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
            const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
            if (idA >= 0 && idA === idB) return 0;
        }

        const rule = pairRule ?? this.#getRule(bodyA.kind, bodyB.kind);
        if (!rule.check) return 0;
        if (!rule.resolve && !applyNonPosition) return 0;

        if (resolvePositions) {
            bodyA._candidatePairCount = (bodyA._candidatePairCount || 0) + 1;
            bodyB._candidatePairCount = (bodyB._candidatePairCount || 0) + 1;
        }

        if (rule.oneShotByProjectile && applyNonPosition) {
            if (bodyA.kind === 'projectile' && this.#hasProjectileHit(bodyA.ref, bodyB.id)) return 0;
            if (bodyB.kind === 'projectile' && this.#hasProjectileHit(bodyB.ref, bodyA.id)) return 0;
        }

        const manifold = this.#detectBodies(bodyA, bodyB);
        if (!manifold) return 0;

        if (resolvePositions) {
            bodyA._resolvedPairCount = (bodyA._resolvedPairCount || 0) + 1;
            bodyB._resolvedPairCount = (bodyB._resolvedPairCount || 0) + 1;
        }

        if (rule.oneShotByProjectile && applyNonPosition) {
            if (bodyA.kind === 'projectile') this.#markProjectileHit(bodyA.ref, bodyB.id);
            if (bodyB.kind === 'projectile') this.#markProjectileHit(bodyB.ref, bodyA.id);
        }

        if (rule.applyImpactRotation && applyNonPosition) {
            if (bodyA.kind === 'projectile' && bodyB.kind === 'enemy') {
                this.#applyProjectileImpact(bodyA.ref, bodyB.ref, manifold);
            } else if (bodyB.kind === 'projectile' && bodyA.kind === 'enemy') {
                this.#applyProjectileImpact(bodyB.ref, bodyA.ref, manifold);
            }
        }

        if (!rule.resolve || !resolvePositions) {
            if (applyNonPosition && bodyA.kind === 'enemy' && bodyB.kind === 'enemy') {
                this.#applyEnemyCollisionRotation(bodyA, bodyB, manifold);
            }
            return 1;
        }

        const pairWeights = this.#getPairResolveWeights(bodyA, bodyB);
        const pairResolveBoost = resolveBoost * this.#getPairEscapeBoost(bodyA, bodyB);
        const resolveBodyA = {
            weight: pairWeights.weightA,
            movable: rule.movableA === null ? bodyA.movable !== false : rule.movableA
        };
        const resolveBodyB = {
            weight: pairWeights.weightB,
            movable: rule.movableB === null ? bodyB.movable !== false : rule.movableB
        };

        const resolved = this.detector.addResolution(manifold, resolveBodyA, resolveBodyB);
        const tunedResolve = this.#tuneResolutionMoves(resolved, manifold, bodyA, bodyB, pairResolveBoost);
        if (tunedResolve.moveAX || tunedResolve.moveAY) {
            this.#applyBodyTranslation(bodyA, tunedResolve.moveAX, tunedResolve.moveAY, pairResolveBoost);
        }
        if (tunedResolve.moveBX || tunedResolve.moveBY) {
            this.#applyBodyTranslation(bodyB, tunedResolve.moveBX, tunedResolve.moveBY, pairResolveBoost);
        }

        if (applyNonPosition && bodyA.kind === 'enemy' && bodyB.kind === 'enemy') {
            this.#applyEnemyCollisionRotation(bodyA, bodyB, manifold);
        }

        return 1;
    }

    /**
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {object|null}
     */
    #detectBodies(bodyA, bodyB) {
        if (bodyA.shape === 'circle' && bodyB.shape === 'circle') {
            return this.#detectCircleVsCircleBody(bodyA, bodyB);
        }

        if (bodyA.shape === 'circleParts' && bodyB.shape === 'circleParts') {
            return this.#detectCirclePartsVsCircleParts(bodyA, bodyB);
        }

        if (bodyA.shape === 'circleParts' && bodyB.shape === 'circle') {
            return this.#detectCirclePartsVsCircle(bodyA, bodyB);
        }

        if (bodyA.shape === 'circle' && bodyB.shape === 'circleParts') {
            const manifold = this.#detectCirclePartsVsCircle(bodyB, bodyA);
            if (!manifold) return null;
            return this.#invertManifoldNormal(manifold);
        }

        if (bodyA.shape === 'circle' && bodyB.shape === 'rect') {
            return this.#detectCircleVsRect(bodyA, bodyB);
        }

        if (bodyA.shape === 'rect' && bodyB.shape === 'circle') {
            const manifold = this.#detectCircleVsRect(bodyB, bodyA);
            if (!manifold) return null;
            return this.#invertManifoldNormal(manifold);
        }

        if (bodyA.shape === 'circleParts' && bodyB.shape === 'rect') {
            return this.#detectCirclePartsVsRect(bodyA, bodyB);
        }

        if (bodyA.shape === 'rect' && bodyB.shape === 'circleParts') {
            const manifold = this.#detectCirclePartsVsRect(bodyB, bodyA);
            if (!manifold) return null;
            return this.#invertManifoldNormal(manifold);
        }

        return null;
    }

    /**
     * 원형 body 두 개의 충돌을 판정합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {object|null}
     */
    #detectCircleVsCircleBody(bodyA, bodyB) {
        return this.#writeCircleOverlapManifold(
            bodyA.centerX,
            bodyA.centerY,
            bodyA.radius * this.#getBodyCollisionRadiusScale(bodyA, bodyB),
            bodyB.centerX,
            bodyB.centerY,
            bodyB.radius * this.#getBodyCollisionRadiusScale(bodyB, bodyA),
            this.#scratchManifold,
            bodyB.centerX - bodyA.centerX,
            bodyB.centerY - bodyA.centerY
        );
    }

    /**
     * 원형 part body 두 개의 충돌을 판정합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {object|null}
     */
    #detectCirclePartsVsCircleParts(bodyA, bodyB) {
        const partsA = bodyA?.circleParts;
        const partsB = bodyB?.circleParts;
        if (!(partsA instanceof Float32Array) || !(partsB instanceof Float32Array)) {
            return null;
        }

        const best = this.#scratchBestManifold;
        let hasBest = false;
        let contactCount = 0;
        let normalSumX = 0;
        let normalSumY = 0;
        let pointSumX = 0;
        let pointSumY = 0;
        let penetrationSum = 0;
        let maxPenetration = 0;
        const scaleA = this.#getBodyCollisionRadiusScale(bodyA, bodyB);
        const scaleB = this.#getBodyCollisionRadiusScale(bodyB, bodyA);
        const countA = Math.max(0, Math.floor(bodyA.circlePartCount || 0));
        const countB = Math.max(0, Math.floor(bodyB.circlePartCount || 0));
        const fallbackNormalX = bodyB.centerX - bodyA.centerX;
        const fallbackNormalY = bodyB.centerY - bodyA.centerY;

        for (let i = 0; i < countA; i++) {
            const offsetA = i * 3;
            const ax = partsA[offsetA];
            const ay = partsA[offsetA + 1];
            const ar = partsA[offsetA + 2] * scaleA;
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0) {
                continue;
            }
            for (let j = 0; j < countB; j++) {
                const offsetB = j * 3;
                this.#recordPartCheck();
                const bx = partsB[offsetB];
                const by = partsB[offsetB + 1];
                const br = partsB[offsetB + 2] * scaleB;
                if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(br) || br <= 0) {
                    continue;
                }
                const dx = bx - ax;
                const dy = by - ay;
                const radiusSum = ar + br;
                const distSq = (dx * dx) + (dy * dy);
                if (distSq >= (radiusSum * radiusSum)) {
                    continue;
                }
                const manifold = this.#writeCircleOverlapManifoldFromDelta(
                    ax,
                    ay,
                    ar,
                    br,
                    dx,
                    dy,
                    distSq,
                    this.#scratchCandidateManifold,
                    fallbackNormalX,
                    fallbackNormalY
                );
                if (!manifold) continue;
                const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
                if (penetration <= EPSILON) continue;
                contactCount++;
                normalSumX += manifold.normalX * penetration;
                normalSumY += manifold.normalY * penetration;
                pointSumX += manifold.pointX * penetration;
                pointSumY += manifold.pointY * penetration;
                penetrationSum += penetration;
                if (penetration > maxPenetration) {
                    maxPenetration = penetration;
                }
                if (!hasBest || manifold.penetration > best.penetration) {
                    this.#copyManifold(manifold, best);
                    hasBest = true;
                }
            }
        }
        return hasBest
            ? this.#finalizeAggregatePartManifold(best, {
                contactCount,
                normalSumX,
                normalSumY,
                pointSumX,
                pointSumY,
                penetrationSum,
                maxPenetration
            })
            : null;
    }

    /**
     * 원형 part body와 원형 body의 충돌을 판정합니다.
     * @private
     * @param {object} partBody
     * @param {object} circleBody
     * @returns {object|null}
     */
    #detectCirclePartsVsCircle(partBody, circleBody) {
        const parts = partBody?.circleParts;
        if (!(parts instanceof Float32Array)) {
            return null;
        }

        const best = this.#scratchBestManifold;
        let hasBest = false;
        let contactCount = 0;
        let normalSumX = 0;
        let normalSumY = 0;
        let pointSumX = 0;
        let pointSumY = 0;
        let penetrationSum = 0;
        let maxPenetration = 0;
        const partScale = this.#getBodyCollisionRadiusScale(partBody, circleBody);
        const circleX = circleBody.centerX;
        const circleY = circleBody.centerY;
        const circleRadius = circleBody.radius * this.#getBodyCollisionRadiusScale(circleBody, partBody);
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(circleRadius) || circleRadius <= 0) {
            return null;
        }
        const count = Math.max(0, Math.floor(partBody.circlePartCount || 0));
        const fallbackNormalX = circleX - partBody.centerX;
        const fallbackNormalY = circleY - partBody.centerY;

        for (let i = 0; i < count; i++) {
            const offset = i * 3;
            this.#recordPartCheck();
            const ax = parts[offset];
            const ay = parts[offset + 1];
            const ar = parts[offset + 2] * partScale;
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0) {
                continue;
            }
            const dx = circleX - ax;
            const dy = circleY - ay;
            const radiusSum = ar + circleRadius;
            const distSq = (dx * dx) + (dy * dy);
            if (distSq >= (radiusSum * radiusSum)) {
                continue;
            }
            const manifold = this.#writeCircleOverlapManifoldFromDelta(
                ax,
                ay,
                ar,
                circleRadius,
                dx,
                dy,
                distSq,
                this.#scratchCandidateManifold,
                fallbackNormalX,
                fallbackNormalY
            );
            if (!manifold) continue;
            const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
            if (penetration <= EPSILON) continue;
            contactCount++;
            normalSumX += manifold.normalX * penetration;
            normalSumY += manifold.normalY * penetration;
            pointSumX += manifold.pointX * penetration;
            pointSumY += manifold.pointY * penetration;
            penetrationSum += penetration;
            if (penetration > maxPenetration) {
                maxPenetration = penetration;
            }
            if (!hasBest || manifold.penetration > best.penetration) {
                this.#copyManifold(manifold, best);
                hasBest = true;
            }
        }

        return hasBest
            ? this.#finalizeAggregatePartManifold(best, {
                contactCount,
                normalSumX,
                normalSumY,
                pointSumX,
                pointSumY,
                penetrationSum,
                maxPenetration
            })
            : null;
    }

    /**
     * 원형 body와 축 정렬 사각형 body의 충돌을 판정합니다.
     * @private
     * @param {object} circleBody
     * @param {object} rectBody
     * @returns {object|null}
     */
    #detectCircleVsRect(circleBody, rectBody) {
        return this.#writeCircleRectOverlapManifold(
            circleBody.centerX,
            circleBody.centerY,
            circleBody.radius * this.#getBodyCollisionRadiusScale(circleBody, rectBody),
            rectBody,
            this.#scratchManifold
        );
    }

    /**
     * 원형 part body와 축 정렬 사각형 body의 충돌을 판정합니다.
     * @private
     * @param {object} partBody
     * @param {object} rectBody
     * @returns {object|null}
     */
    #detectCirclePartsVsRect(partBody, rectBody) {
        const parts = partBody?.circleParts;
        if (!(parts instanceof Float32Array)) {
            return null;
        }

        const best = this.#scratchBestManifold;
        let hasBest = false;
        let contactCount = 0;
        let normalSumX = 0;
        let normalSumY = 0;
        let pointSumX = 0;
        let pointSumY = 0;
        let penetrationSum = 0;
        let maxPenetration = 0;
        const partScale = this.#getBodyCollisionRadiusScale(partBody, rectBody);
        const count = Math.max(0, Math.floor(partBody.circlePartCount || 0));
        const rectMinX = Number.isFinite(rectBody?.minX) ? rectBody.minX : 0;
        const rectMaxX = Number.isFinite(rectBody?.maxX) ? rectBody.maxX : 0;
        const rectMinY = Number.isFinite(rectBody?.minY) ? rectBody.minY : 0;
        const rectMaxY = Number.isFinite(rectBody?.maxY) ? rectBody.maxY : 0;

        for (let i = 0; i < count; i++) {
            const offset = i * 3;
            this.#recordPartCheck();
            const circleX = parts[offset];
            const circleY = parts[offset + 1];
            const radius = parts[offset + 2] * partScale;
            if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius) || radius <= 0) {
                continue;
            }
            if (
                circleX + radius <= rectMinX ||
                circleX - radius >= rectMaxX ||
                circleY + radius <= rectMinY ||
                circleY - radius >= rectMaxY
            ) {
                continue;
            }
            const manifold = this.#writeCircleRectOverlapManifold(
                circleX,
                circleY,
                radius,
                rectBody,
                this.#scratchCandidateManifold
            );
            if (!manifold) continue;
            const penetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
            if (penetration <= EPSILON) continue;
            contactCount++;
            normalSumX += manifold.normalX * penetration;
            normalSumY += manifold.normalY * penetration;
            pointSumX += manifold.pointX * penetration;
            pointSumY += manifold.pointY * penetration;
            penetrationSum += penetration;
            if (penetration > maxPenetration) {
                maxPenetration = penetration;
            }
            if (!hasBest || manifold.penetration > best.penetration) {
                this.#copyManifold(manifold, best);
                hasBest = true;
            }
        }

        return hasBest
            ? this.#finalizeAggregatePartManifold(best, {
                contactCount,
                normalSumX,
                normalSumY,
                pointSumX,
                pointSumY,
                penetrationSum,
                maxPenetration
            })
            : null;
    }

    /**
     * 충돌 관계별 가상 원 반지름 스케일을 반환합니다.
     * @private
     * @param {object} body
     * @param {object} otherBody
     * @returns {number}
     */
    #getBodyCollisionRadiusScale(body, otherBody) {
        if (body?.kind !== 'enemy') {
            return 1;
        }
        if (otherBody?.kind === 'projectile') {
            return ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
        }
        if (otherBody?.kind === 'enemy') {
            return ENEMY_PAIR_COLLISION_RADIUS_SCALE;
        }
        return 1;
    }

    /**
     * 원-원 충돌 manifold를 씁니다.
     * @private
     * @param {number} ax
     * @param {number} ay
     * @param {number} ar
     * @param {number} bx
     * @param {number} by
     * @param {number} br
     * @param {object} out
     * @param {number} fallbackNormalX
     * @param {number} fallbackNormalY
     * @returns {object|null}
     */
    #writeCircleOverlapManifold(ax, ay, ar, bx, by, br, out, fallbackNormalX = 1, fallbackNormalY = 0) {
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(ar) || ar <= 0
            || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(br) || br <= 0) {
            return null;
        }

        const dx = bx - ax;
        const dy = by - ay;
        const distSq = (dx * dx) + (dy * dy);
        return this.#writeCircleOverlapManifoldFromDelta(
            ax,
            ay,
            ar,
            br,
            dx,
            dy,
            distSq,
            out,
            fallbackNormalX,
            fallbackNormalY
        );
    }

    /**
     * 이미 계산된 중심 차이로 원-원 충돌 manifold를 씁니다.
     * @private
     * @param {number} ax
     * @param {number} ay
     * @param {number} ar
     * @param {number} br
     * @param {number} dx
     * @param {number} dy
     * @param {number} distSq
     * @param {object} out
     * @param {number} fallbackNormalX
     * @param {number} fallbackNormalY
     * @returns {object|null}
     */
    #writeCircleOverlapManifoldFromDelta(ax, ay, ar, br, dx, dy, distSq, out, fallbackNormalX = 1, fallbackNormalY = 0) {
        const radiusSum = ar + br;
        if (distSq >= (radiusSum * radiusSum)) {
            return null;
        }

        let distance = Math.sqrt(distSq);
        let normalX = 1;
        let normalY = 0;
        if (distance > EPSILON) {
            normalX = dx / distance;
            normalY = dy / distance;
        } else {
            const fallbackLength = Math.hypot(fallbackNormalX, fallbackNormalY);
            if (fallbackLength > EPSILON) {
                normalX = fallbackNormalX / fallbackLength;
                normalY = fallbackNormalY / fallbackLength;
            }
            distance = 0;
        }

        return this.#writeManifold(
            out,
            normalX,
            normalY,
            radiusSum - distance,
            ax + (normalX * ar),
            ay + (normalY * ar)
        );
    }

    /**
     * 원-사각형 충돌 manifold를 씁니다.
     * @private
     * @param {number} circleX
     * @param {number} circleY
     * @param {number} radius
     * @param {object} rectBody
     * @param {object} out
     * @returns {object|null}
     */
    #writeCircleRectOverlapManifold(circleX, circleY, radius, rectBody, out) {
        if (!Number.isFinite(circleX) || !Number.isFinite(circleY) || !Number.isFinite(radius) || radius <= 0) {
            return null;
        }

        const minX = Number.isFinite(rectBody?.minX) ? rectBody.minX : 0;
        const maxX = Number.isFinite(rectBody?.maxX) ? rectBody.maxX : 0;
        const minY = Number.isFinite(rectBody?.minY) ? rectBody.minY : 0;
        const maxY = Number.isFinite(rectBody?.maxY) ? rectBody.maxY : 0;
        const closestX = Math.max(minX, Math.min(circleX, maxX));
        const closestY = Math.max(minY, Math.min(circleY, maxY));
        const dx = closestX - circleX;
        const dy = closestY - circleY;
        const distSq = (dx * dx) + (dy * dy);
        if (distSq >= (radius * radius)) {
            return null;
        }

        if (distSq > EPSILON) {
            const distance = Math.sqrt(distSq);
            const normalX = dx / distance;
            const normalY = dy / distance;
            return this.#writeManifold(
                out,
                normalX,
                normalY,
                radius - distance,
                closestX,
                closestY
            );
        }

        const leftDistance = Math.max(0, circleX - minX);
        const rightDistance = Math.max(0, maxX - circleX);
        const topDistance = Math.max(0, circleY - minY);
        const bottomDistance = Math.max(0, maxY - circleY);
        const minDistance = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);
        let normalX = 1;
        let normalY = 0;
        let pointX = minX;
        let pointY = circleY;

        if (minDistance === rightDistance) {
            normalX = -1;
            pointX = maxX;
        } else if (minDistance === topDistance) {
            normalX = 0;
            normalY = 1;
            pointX = circleX;
            pointY = minY;
        } else if (minDistance === bottomDistance) {
            normalX = 0;
            normalY = -1;
            pointX = circleX;
            pointY = maxY;
        }

        return this.#writeManifold(
            out,
            normalX,
            normalY,
            radius + minDistance,
            pointX,
            pointY
        );
    }

    /**
     * manifold 법선을 A->B 관점으로 뒤집습니다.
     * @private
     * @param {object} manifold
     * @returns {object}
     */
    #invertManifoldNormal(manifold) {
        manifold.normalX = -manifold.normalX;
        manifold.normalY = -manifold.normalY;
        return manifold;
    }

    /**
     * manifold 출력 객체를 채웁니다.
     * @private
     * @param {object} out
     * @param {number} normalX
     * @param {number} normalY
     * @param {number} penetration
     * @param {number} pointX
     * @param {number} pointY
     * @returns {object}
     */
    #writeManifold(out, normalX, normalY, penetration, pointX, pointY) {
        out.collided = true;
        out.normalX = normalX;
        out.normalY = normalY;
        out.penetration = penetration;
        out.pointX = pointX;
        out.pointY = pointY;
        out.moveAX = 0;
        out.moveAY = 0;
        out.moveBX = 0;
        out.moveBY = 0;
        return out;
    }

    /**
     * manifold 값을 대상 스크래치 객체에 복사합니다.
     * @private
     * @param {object} source
     * @param {object} target
     * @returns {object}
     */
    #copyManifold(source, target) {
        target.collided = source.collided;
        target.normalX = source.normalX;
        target.normalY = source.normalY;
        target.penetration = source.penetration;
        target.pointX = source.pointX;
        target.pointY = source.pointY;
        target.moveAX = source.moveAX || 0;
        target.moveAY = source.moveAY || 0;
        target.moveBX = source.moveBX || 0;
        target.moveBY = source.moveBY || 0;
        return target;
    }

    /**
     * 다중 part 접촉을 단일 대표 manifold로 누적합니다.
     * @private
     * @param {object} best
     * @param {{contactCount:number, normalSumX:number, normalSumY:number, pointSumX:number, pointSumY:number, penetrationSum:number, maxPenetration:number}} aggregate
     * @returns {object}
     */
    #finalizeAggregatePartManifold(best, aggregate) {
        if (!best || !aggregate || aggregate.contactCount <= 1) {
            return best;
        }

        const normalLen = Math.hypot(aggregate.normalSumX, aggregate.normalSumY);
        if (normalLen <= EPSILON || aggregate.penetrationSum <= EPSILON) {
            return best;
        }

        const alignment = Math.min(1, normalLen / aggregate.penetrationSum);
        const diversity = Math.max(0, 1 - alignment);
        const multiplier = Math.min(
            MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX,
            1 + (diversity * Math.min(aggregate.contactCount - 1, 3) * MULTI_CONTACT_NORMAL_DIVERSITY_SCALE)
        );
        const pointWeight = Math.max(EPSILON, aggregate.penetrationSum);

        best.normalX = aggregate.normalSumX / normalLen;
        best.normalY = aggregate.normalSumY / normalLen;
        best.penetration = Math.max(best.penetration, aggregate.maxPenetration * multiplier);
        best.pointX = aggregate.pointSumX / pointWeight;
        best.pointY = aggregate.pointSumY / pointWeight;
        return best;
    }

    /**
     * 국소 과밀도를 판단하기 위해 body별 후보 충돌 수 최대값을 반환합니다.
     * @private
     * @param {object[]} bodies
     * @returns {number}
     */
    #getPeakCandidatePairs(bodies) {
        if (!Array.isArray(bodies) || bodies.length === 0) return 0;
        let peak = 0;
        for (let i = 0; i < bodies.length; i++) {
            const candidateCount = Number.isFinite(bodies[i]?._candidatePairCount) ? bodies[i]._candidatePairCount : 0;
            const resolvedCount = Number.isFinite(bodies[i]?._resolvedPairCount) ? bodies[i]._resolvedPairCount : 0;
            const count = Math.max(candidateCount, resolvedCount);
            if (count > peak) peak = count;
        }
        return peak;
    }

    /**
     * 과밀한 쪽이 덜 과밀한 쪽에게 밀리지 않도록 해소용 weight를 재계산합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {{weightA:number, weightB:number}}
     */
    #getPairResolveWeights(bodyA, bodyB) {
        const weightA = Number.isFinite(bodyA?.weight) ? bodyA.weight : 1;
        const weightB = Number.isFinite(bodyB?.weight) ? bodyB.weight : 1;
        if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
            return { weightA, weightB };
        }

        const pressureA = this.#getBodyPressure(bodyA);
        const pressureB = this.#getBodyPressure(bodyB);
        return {
            weightA: this.#getResolveWeight(bodyA) * this.#getEntryResistanceScale(pressureA),
            weightB: this.#getResolveWeight(bodyB) * this.#getEntryResistanceScale(pressureB)
        };
    }

    /**
     * 과밀 코어에 끼인 적끼리의 충돌은 추가 분리 부스트를 적용합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {number}
     */
    #getPairEscapeBoost(bodyA, bodyB) {
        if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') return 1;
        const jamPressure = Math.min(this.#getBodyPressure(bodyA), this.#getBodyPressure(bodyB));
        if (jamPressure < PRESSURE_ESCAPE_THRESHOLD) return 1;
        const extra = jamPressure - PRESSURE_ESCAPE_THRESHOLD + 1;
        return Math.min(
            PRESSURE_ESCAPE_SCALE_MAX,
            1 + (extra * PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR)
        );
    }

    /**
     * 해소에 쓰는 weight는 원본 차이를 압축해 과도한 고정벽화를 줄입니다.
     * @private
     * @param {object} body
     * @returns {number}
     */
    #getResolveWeight(body) {
        const rawWeight = Number.isFinite(body?.weight) ? body.weight : 1;
        if (body?.mergeLock === true) {
            return MERGE_PENDING_RESOLVE_WEIGHT;
        }

        const maxWeight = body?.ref?.type === 'hexa_hive'
            ? PRESSURE_HEXA_HIVE_WEIGHT_MAX
            : PRESSURE_WEIGHT_MAX;
        const clamped = Math.max(PRESSURE_WEIGHT_MIN, Math.min(maxWeight, rawWeight));
        return Math.pow(clamped, PRESSURE_WEIGHT_EXPONENT);
    }

    /**
     * body가 현재 얼마나 압축된 상태인지 후보/해결 충돌 수로 추정합니다.
     * @private
     * @param {object} body
     * @returns {number}
     */
    #getBodyPressure(body) {
        const candidateCount = Number.isFinite(body?._candidatePairCount) ? body._candidatePairCount : 0;
        const resolvedCount = Number.isFinite(body?._resolvedPairCount) ? body._resolvedPairCount : 0;
        return Math.max(candidateCount, resolvedCount);
    }

    /**
     * 과밀할수록 entry resistance를 키워 덜 과밀한 적이 안쪽으로 파고드는 것을 줄입니다.
     * @private
     * @param {number} pressure
     * @returns {number}
     */
    #getEntryResistanceScale(pressure) {
        if (!Number.isFinite(pressure) || pressure < PRESSURE_ENTRY_THRESHOLD) return 1;
        const extra = pressure - PRESSURE_ENTRY_THRESHOLD + 1;
        return Math.min(
            PRESSURE_ENTRY_SCALE_MAX,
            1 + (extra * PRESSURE_ENTRY_SCALE_PER_NEIGHBOR)
        );
    }

    /**
     * grid 용도에 맞는 평균 broad radius로 셀 크기를 추정합니다.
     * @private
     * @param {object[]} bodies
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default']
     * @returns {number}
     */
    #estimateCellSize(bodies, gridMode = 'default') {
        let radiusSum = 0;
        let count = 0;
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            let radius = body?.boundRadius;
            if (gridMode === 'enemyPair' && body?.kind === 'enemy') {
                radius = body.enemyPairBroadRadius;
            } else if (gridMode === 'projectile' && body?.kind === 'enemy') {
                radius = body.projectileBroadRadius;
            }
            if (!Number.isFinite(radius) || radius <= 0) continue;
            radiusSum += radius;
            count++;
        }
        const avgRadius = count > 0 ? (radiusSum / count) : Math.max(getSimulationObjectWH() * 0.015, 12);
        const cell = Math.floor(avgRadius * 2.4);
        return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, cell));
    }

    /**
     * @private
     */
    #resetBodyPool() {
        this.#bodyPoolCursor = 0;
        this.#invalidateEnemyBodyCache();
    }

    /**
     * enemy body 재사용 캐시를 무효화합니다.
     * @private
     */
    #invalidateEnemyBodyCache() {
        this.#enemyBodyCache.frameToken = -1;
        this.#enemyBodyCache.enemies = null;
        this.#enemyBodyCache.delta = 0;
        this.#enemyBodyCache.sourceLength = 0;
    }

    /**
     * 새 body pool 세대에서 enemy body를 만들고 필요하면 같은 프레임 재사용 캐시에 보관합니다.
     * @private
     * @param {object[]} enemies
     * @param {number} delta
     * @param {boolean} [cacheForReuse=false]
     * @returns {object[]}
     */
    #buildFreshEnemyBodies(enemies, delta, cacheForReuse = false) {
        this.#resetBodyPool();
        const bodies = this.#buildEnemyBodies(enemies, delta);
        if (cacheForReuse) {
            this.#storeEnemyBodyCache(enemies, delta, bodies);
        }
        return bodies;
    }

    /**
     * 현재 fixed frame에서 같은 enemy 배열로 만든 body를 캐시에 기록합니다.
     * @private
     * @param {object[]} enemies
     * @param {number} delta
     * @param {object[]} bodies
     */
    #storeEnemyBodyCache(enemies, delta, bodies) {
        this.#enemyBodyCache.frameToken = this.#enemyBodyFrameToken;
        this.#enemyBodyCache.enemies = enemies;
        this.#enemyBodyCache.delta = delta;
        this.#enemyBodyCache.sourceLength = Array.isArray(enemies) ? enemies.length : 0;
        this.#enemyBodyCache.bodies = bodies;
    }

    /**
     * 같은 fixed frame에서 같은 enemy 배열과 delta로 만든 body를 반환합니다.
     * @private
     * @param {object[]} enemies
     * @param {number} delta
     * @returns {object[]|null}
     */
    #getReusableEnemyBodies(enemies, delta) {
        const cache = this.#enemyBodyCache;
        if (cache.frameToken !== this.#enemyBodyFrameToken) {
            return null;
        }
        if (cache.enemies !== enemies || cache.sourceLength !== enemies.length) {
            return null;
        }
        if (Math.abs(cache.delta - delta) > EPSILON) {
            return null;
        }
        return Array.isArray(cache.bodies) ? cache.bodies : null;
    }

    /**
     * @private
     */
    #acquireBody() {
        if (this.#bodyPoolCursor < this.#bodyPool.length) {
            return this.#bodyPool[this.#bodyPoolCursor++];
        }
        const body = {
            id: -1, kind: '', shape: '', circleParts: null, circlePartCount: 0, ref: null,
            weight: 1, movable: true,
            centerX: 0, centerY: 0, x: 0, y: 0, radius: 0,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
            sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
            boundRadius: 0, broadRadius: 0, resolveRadius: 0, velocityX: 0, velocityY: 0,
            enemyPairMinX: 0, enemyPairMaxX: 0, enemyPairMinY: 0, enemyPairMaxY: 0,
            projectileMinX: 0, projectileMaxX: 0, projectileMinY: 0, projectileMaxY: 0,
            enemyPairBroadRadius: 0, projectileBroadRadius: 0,
            mergeLock: false,
            _broadDataIndex: -1,
            _candidatePairCount: 0, _resolvedPairCount: 0, _passPairProcessCount: 0,
            _frameResolveMoved: 0, _frameResolveMax: Infinity
        };
        this.#bodyPool.push(body);
        this.#bodyPoolCursor++;
        return body;
    }

    /**
     * @private
     */
    #ensurePairBitmap(bodyCount) {
        const neededWords = Math.ceil((bodyCount * bodyCount) / 32);
        if (this.#pairBitmap.length < neededWords) {
            this.#pairBitmap = new Uint32Array(Math.max(neededWords, this.#pairBitmap.length * 2));
        }
        this.#pairBitmapBodyCount = bodyCount;
        this.#pairBitmap.fill(0, 0, neededWords);
    }

    /**
     * 후보 pair 버퍼 용량을 확보합니다.
     * @private
     * @param {number} pairCount
     */
    #ensureCandidatePairCapacity(pairCount) {
        if (this.#candidatePairLowIndices.length >= pairCount) {
            return;
        }

        const nextCapacity = Math.max(pairCount, this.#candidatePairLowIndices.length * 2);
        const nextLowIndices = new Int32Array(nextCapacity);
        const nextHighIndices = new Int32Array(nextCapacity);
        nextLowIndices.set(this.#candidatePairLowIndices);
        nextHighIndices.set(this.#candidatePairHighIndices);
        this.#candidatePairLowIndices = nextLowIndices;
        this.#candidatePairHighIndices = nextHighIndices;
    }

    /**
     * 후보 pair를 재사용 버퍼에 추가합니다.
     * @private
     * @param {number} low
     * @param {number} high
     */
    #appendCandidatePair(low, high) {
        this.#ensureCandidatePairCapacity(this.#candidatePairCount + 1);
        this.#candidatePairLowIndices[this.#candidatePairCount] = low;
        this.#candidatePairHighIndices[this.#candidatePairCount] = high;
        this.#candidatePairCount++;
    }

    /**
     * @private
     */
    #hasPair(low, high) {
        const bitIndex = low * this.#pairBitmapBodyCount + high;
        return (this.#pairBitmap[bitIndex >>> 5] & (1 << (bitIndex & 31))) !== 0;
    }

    /**
     * @private
     */
    #markPair(low, high) {
        const bitIndex = low * this.#pairBitmapBodyCount + high;
        this.#pairBitmap[bitIndex >>> 5] |= (1 << (bitIndex & 31));
    }

    /**
     * 현재 패스에서 처리 가능한 충돌 규칙을 반환합니다.
     * @private
     * @param {object|null|undefined} bodyA
     * @param {object|null|undefined} bodyB
     * @param {boolean} applyNonPosition
     * @returns {CollisionRule|null}
     */
    #getPassRule(bodyA, bodyB, applyNonPosition) {
        if (!bodyA || !bodyB) return null;
        if (bodyA?.ref && bodyA.ref === bodyB?.ref) return null;
        if (bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy') {
            const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
            const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
            if (idA >= 0 && idA === idB) return null;
        }

        const rule = this.#getRule(bodyA.kind, bodyB.kind);
        if (!rule.check) return null;
        if (!rule.resolve && !applyNonPosition) return null;
        return rule;
    }

    /**
     * 현재 grid bucket에서 유효 후보 pair 목록을 재구성합니다.
     * @private
     * @param {object[]} bodies
     */
    #buildCandidatePairsFromGrid(bodies) {
        const bodyCount = Array.isArray(bodies) ? bodies.length : 0;
        this.#candidatePairCount = 0;
        this.#candidatePairBodyCount = bodyCount;
        if (bodyCount < 2) {
            return;
        }
        this.#ensurePairBitmap(bodyCount);
        const gridBuckets = this.#activeGridBuckets;
        for (let b = 0; b < gridBuckets.length; b++) {
            const bucket = gridBuckets[b];
            const len = bucket.count;
            if (len < 2) continue;
            const indices = bucket.indices;

            for (let i = 0; i < len - 1; i++) {
                const a = indices[i];
                for (let j = i + 1; j < len; j++) {
                    const c = indices[j];
                    const low = a < c ? a : c;
                    const high = a < c ? c : a;
                    this.#recordProfileCount('solveBucketPairCount');

                    const rule = this.#getPassRule(bodies[low], bodies[high], true);
                    if (!rule) {
                        this.#recordProfileCount('solveRuleRejectCount');
                        continue;
                    }
                    if (this.#hasPair(low, high)) {
                        this.#recordProfileCount('solveDuplicatePairSkipCount');
                        continue;
                    }

                    this.#markPair(low, high);
                    this.#appendCandidatePair(low, high);
                    this.#recordProfileCount('solveCandidatePairCount');
                }
            }
        }
    }

    /**
     * 현재 패스에서 적-적 narrowphase 처리에 적용할 상한을 반환합니다.
     * @private
     * @param {boolean} resolvePositions
     * @param {boolean} applyNonPosition
     * @param {number} resolveBoost
     * @returns {number}
     */
    #getEnemyPairProcessBudget(resolvePositions, applyNonPosition, resolveBoost) {
        if (applyNonPosition) {
            return ENEMY_PAIR_PROCESS_BUDGET_NON_POSITION;
        }
        if (!resolvePositions) {
            return Number.POSITIVE_INFINITY;
        }
        return resolveBoost > 1
            ? ENEMY_PAIR_PROCESS_BUDGET_STABILIZE
            : ENEMY_PAIR_PROCESS_BUDGET_POSITION;
    }

    /**
     * 패스 단위 적-적 처리 카운터를 초기화합니다.
     * @private
     * @param {object[]} bodies
     */
    #resetPassPairProcessCounts(bodies) {
        for (let i = 0; i < bodies.length; i++) {
            if (bodies[i]) {
                bodies[i]._passPairProcessCount = 0;
            }
        }
    }

    /**
     * 과밀 적-적 후보가 현재 패스 처리 예산을 초과했는지 반환합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @param {number} budget
     * @returns {boolean}
     */
    #shouldSkipEnemyPairByBudget(bodyA, bodyB, budget) {
        if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
            return false;
        }
        if (!Number.isFinite(budget) || budget <= 0) {
            return false;
        }

        const passCountA = Number.isFinite(bodyA._passPairProcessCount) ? bodyA._passPairProcessCount : 0;
        const passCountB = Number.isFinite(bodyB._passPairProcessCount) ? bodyB._passPairProcessCount : 0;
        return passCountA >= budget || passCountB >= budget;
    }

    /**
     * 현재 패스에서 적-적 narrowphase 시도 횟수를 누적합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     */
    #markEnemyPairProcessAttempt(bodyA, bodyB) {
        if (bodyA?.kind !== 'enemy' || bodyB?.kind !== 'enemy') {
            return;
        }
        bodyA._passPairProcessCount = (bodyA._passPairProcessCount || 0) + 1;
        bodyB._passPairProcessCount = (bodyB._passPairProcessCount || 0) + 1;
    }

    /**
     * enemy 원형 쌍을 SoA 중심/반경으로 직접 판정하고 해소합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @param {Float64Array} relationData
     * @param {number} relationOffsetA
     * @param {number} relationOffsetB
     * @param {boolean} resolvePositions
     * @param {boolean} applyNonPosition
     * @param {number} resolveBoost
     * @returns {number}
     */
    #processEnemyCirclePairSoA(
        bodyA,
        bodyB,
        relationData,
        relationOffsetA,
        relationOffsetB,
        resolvePositions,
        applyNonPosition,
        resolveBoost
    ) {
        if (resolvePositions) {
            bodyA._candidatePairCount = (bodyA._candidatePairCount || 0) + 1;
            bodyB._candidatePairCount = (bodyB._candidatePairCount || 0) + 1;
        }

        const ax = relationData[relationOffsetA + 4];
        const ay = relationData[relationOffsetA + 5];
        const bx = relationData[relationOffsetB + 4];
        const by = relationData[relationOffsetB + 5];
        const radiusA = relationData[relationOffsetA + 6];
        const radiusB = relationData[relationOffsetB + 6];
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(radiusA) || radiusA <= 0
            || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(radiusB) || radiusB <= 0) {
            return 0;
        }

        const dx = bx - ax;
        const dy = by - ay;
        const radiusSum = radiusA + radiusB;
        const distSq = (dx * dx) + (dy * dy);
        if (distSq >= (radiusSum * radiusSum)) {
            return 0;
        }

        let distance = Math.sqrt(distSq);
        let normalX = 1;
        let normalY = 0;
        if (distance > EPSILON) {
            normalX = dx / distance;
            normalY = dy / distance;
        } else {
            distance = 0;
        }

        const penetration = radiusSum - distance;
        const manifold = this.#scratchManifold;
        manifold.collided = true;
        manifold.normalX = normalX;
        manifold.normalY = normalY;
        manifold.penetration = penetration;
        manifold.pointX = ax + (normalX * radiusA);
        manifold.pointY = ay + (normalY * radiusA);
        manifold.moveAX = 0;
        manifold.moveAY = 0;
        manifold.moveBX = 0;
        manifold.moveBY = 0;

        if (resolvePositions) {
            bodyA._resolvedPairCount = (bodyA._resolvedPairCount || 0) + 1;
            bodyB._resolvedPairCount = (bodyB._resolvedPairCount || 0) + 1;
        }

        if (!resolvePositions) {
            if (applyNonPosition) {
                this.#applyEnemyCollisionRotation(bodyA, bodyB, manifold);
            }
            return 1;
        }

        const candidateCountA = Number.isFinite(bodyA._candidatePairCount) ? bodyA._candidatePairCount : 0;
        const candidateCountB = Number.isFinite(bodyB._candidatePairCount) ? bodyB._candidatePairCount : 0;
        const resolvedCountA = Number.isFinite(bodyA._resolvedPairCount) ? bodyA._resolvedPairCount : 0;
        const resolvedCountB = Number.isFinite(bodyB._resolvedPairCount) ? bodyB._resolvedPairCount : 0;
        const pressureA = Math.max(candidateCountA, resolvedCountA);
        const pressureB = Math.max(candidateCountB, resolvedCountB);

        const rawWeightA = Number.isFinite(bodyA.weight) ? bodyA.weight : 1;
        const rawWeightB = Number.isFinite(bodyB.weight) ? bodyB.weight : 1;
        const maxWeightA = bodyA.ref?.type === 'hexa_hive' ? PRESSURE_HEXA_HIVE_WEIGHT_MAX : PRESSURE_WEIGHT_MAX;
        const maxWeightB = bodyB.ref?.type === 'hexa_hive' ? PRESSURE_HEXA_HIVE_WEIGHT_MAX : PRESSURE_WEIGHT_MAX;
        const resolveWeightA = bodyA.mergeLock === true
            ? MERGE_PENDING_RESOLVE_WEIGHT
            : Math.pow(Math.max(PRESSURE_WEIGHT_MIN, Math.min(maxWeightA, rawWeightA)), PRESSURE_WEIGHT_EXPONENT);
        const resolveWeightB = bodyB.mergeLock === true
            ? MERGE_PENDING_RESOLVE_WEIGHT
            : Math.pow(Math.max(PRESSURE_WEIGHT_MIN, Math.min(maxWeightB, rawWeightB)), PRESSURE_WEIGHT_EXPONENT);
        const entryScaleA = pressureA < PRESSURE_ENTRY_THRESHOLD
            ? 1
            : Math.min(
                PRESSURE_ENTRY_SCALE_MAX,
                1 + ((pressureA - PRESSURE_ENTRY_THRESHOLD + 1) * PRESSURE_ENTRY_SCALE_PER_NEIGHBOR)
            );
        const entryScaleB = pressureB < PRESSURE_ENTRY_THRESHOLD
            ? 1
            : Math.min(
                PRESSURE_ENTRY_SCALE_MAX,
                1 + ((pressureB - PRESSURE_ENTRY_THRESHOLD + 1) * PRESSURE_ENTRY_SCALE_PER_NEIGHBOR)
            );
        const weightA = resolveWeightA * entryScaleA;
        const weightB = resolveWeightB * entryScaleB;

        let ratioA = 0;
        let ratioB = 0;
        const movableA = bodyA.movable !== false;
        const movableB = bodyB.movable !== false;
        if (movableA && movableB) {
            const weightSum = weightA + weightB;
            ratioA = weightB / weightSum;
            ratioB = weightA / weightSum;
        } else if (movableA) {
            ratioA = 1;
        } else if (movableB) {
            ratioB = 1;
        }

        manifold.moveAX = -normalX * penetration * ratioA;
        manifold.moveAY = -normalY * penetration * ratioA;
        manifold.moveBX = normalX * penetration * ratioB;
        manifold.moveBY = normalY * penetration * ratioB;

        const jamPressure = Math.min(pressureA, pressureB);
        const pairEscapeBoost = jamPressure < PRESSURE_ESCAPE_THRESHOLD
            ? 1
            : Math.min(
                PRESSURE_ESCAPE_SCALE_MAX,
                1 + ((jamPressure - PRESSURE_ESCAPE_THRESHOLD + 1) * PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR)
            );
        const pairResolveBoost = resolveBoost * pairEscapeBoost;
        const slopScale = pairResolveBoost > 1 ? (1 / pairResolveBoost) : 1;
        const effectivePenetration = Math.max(0, penetration - (COLLISION_RESOLVE_SLOP * slopScale));
        if (effectivePenetration > 0) {
            const penetrationRatio = effectivePenetration / Math.max(EPSILON, penetration);
            const correctionScale = COLLISION_RESOLVE_PERCENT * penetrationRatio * pairResolveBoost;
            let moveAX = manifold.moveAX * correctionScale;
            let moveAY = manifold.moveAY * correctionScale;
            let moveBX = manifold.moveBX * correctionScale;
            let moveBY = manifold.moveBY * correctionScale;
            const moveAMag = Math.hypot(moveAX, moveAY);
            if (moveAMag > EPSILON) {
                const resolveRadiusA = Number.isFinite(bodyA.resolveRadius)
                    ? bodyA.resolveRadius
                    : (Number.isFinite(bodyA.boundRadius) ? bodyA.boundRadius : 16);
                const correctionBaseA = Math.max(COLLISION_RESOLVE_MIN_MAX, resolveRadiusA * COLLISION_RESOLVE_MAX_RATIO);
                const denseScaleA = pressureA < DENSE_CORRECTION_CANDIDATE_THRESHOLD
                    ? 1
                    : Math.min(
                        DENSE_CORRECTION_SCALE_MAX,
                        1 + ((pressureA - DENSE_CORRECTION_CANDIDATE_THRESHOLD + 1) * DENSE_CORRECTION_SCALE_PER_NEIGHBOR)
                    );
                const maxCorrectionA = correctionBaseA * denseScaleA * pairResolveBoost;
                if (moveAMag > maxCorrectionA) {
                    const scaleA = maxCorrectionA / moveAMag;
                    moveAX *= scaleA;
                    moveAY *= scaleA;
                }
                this.#applyBodyTranslation(bodyA, moveAX, moveAY, pairResolveBoost);
            }

            const moveBMag = Math.hypot(moveBX, moveBY);
            if (moveBMag > EPSILON) {
                const resolveRadiusB = Number.isFinite(bodyB.resolveRadius)
                    ? bodyB.resolveRadius
                    : (Number.isFinite(bodyB.boundRadius) ? bodyB.boundRadius : 16);
                const correctionBaseB = Math.max(COLLISION_RESOLVE_MIN_MAX, resolveRadiusB * COLLISION_RESOLVE_MAX_RATIO);
                const denseScaleB = pressureB < DENSE_CORRECTION_CANDIDATE_THRESHOLD
                    ? 1
                    : Math.min(
                        DENSE_CORRECTION_SCALE_MAX,
                        1 + ((pressureB - DENSE_CORRECTION_CANDIDATE_THRESHOLD + 1) * DENSE_CORRECTION_SCALE_PER_NEIGHBOR)
                    );
                const maxCorrectionB = correctionBaseB * denseScaleB * pairResolveBoost;
                if (moveBMag > maxCorrectionB) {
                    const scaleB = maxCorrectionB / moveBMag;
                    moveBX *= scaleB;
                    moveBY *= scaleB;
                }
                this.#applyBodyTranslation(bodyB, moveBX, moveBY, pairResolveBoost);
            }
        }

        if (applyNonPosition) {
            this.#applyEnemyCollisionRotation(bodyA, bodyB, manifold);
        }

        return 1;
    }

    /**
     * 후보 pair 목록을 현재 broad-phase 데이터 기준으로 판정합니다.
     * @private
     * @param {object[]} bodies
     * @param {boolean} resolvePositions
     * @param {boolean} applyNonPosition
     * @param {number} resolveBoost
     * @returns {number}
     */
    #processCandidatePairs(bodies, resolvePositions, applyNonPosition, resolveBoost) {
        let resolvedCount = 0;
        const pairBudget = this.#getEnemyPairProcessBudget(resolvePositions, applyNonPosition, resolveBoost);
        const relationData = this.#relationBroadData;
        const kindCodes = this.#bodyKindCodes;
        const shapeCodes = this.#bodyShapeCodes;
        const lowIndices = this.#candidatePairLowIndices;
        const highIndices = this.#candidatePairHighIndices;
        this.#resetPassPairProcessCounts(bodies);
        for (let pairIndex = 0; pairIndex < this.#candidatePairCount; pairIndex++) {
            const low = lowIndices[pairIndex];
            const high = highIndices[pairIndex];
            const bodyA = bodies[low];
            const bodyB = bodies[high];
            if (kindCodes[low] === BODY_KIND_ENEMY && kindCodes[high] === BODY_KIND_ENEMY) {
                if (!bodyA || !bodyB || bodyA.ref === bodyB.ref) continue;
                const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
                const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
                if (idA >= 0 && idA === idB) continue;

                if (Number.isFinite(pairBudget) && pairBudget > 0) {
                    const passCountA = Number.isFinite(bodyA._passPairProcessCount) ? bodyA._passPairProcessCount : 0;
                    const passCountB = Number.isFinite(bodyB._passPairProcessCount) ? bodyB._passPairProcessCount : 0;
                    if (passCountA >= pairBudget || passCountB >= pairBudget) {
                        this.#recordProfileCount('solveBudgetSkipCount');
                        continue;
                    }
                }

                this.#frameStats.collisionCheckCount++;
                const relationOffsetA = low * RELATION_BROAD_STRIDE;
                const relationOffsetB = high * RELATION_BROAD_STRIDE;
                if (
                    relationData[relationOffsetA + 0] > relationData[relationOffsetB + 1] ||
                    relationData[relationOffsetA + 1] < relationData[relationOffsetB + 0] ||
                    relationData[relationOffsetA + 2] > relationData[relationOffsetB + 3] ||
                    relationData[relationOffsetA + 3] < relationData[relationOffsetB + 2]
                ) {
                    this.#frameStats.aabbRejectCount++;
                    continue;
                }

                this.#frameStats.aabbPassCount++;
                this.#recordProfileCount('solveAabbPassCount');
                const isCirclePair = shapeCodes[low] === BODY_SHAPE_CIRCLE && shapeCodes[high] === BODY_SHAPE_CIRCLE;
                if (!isCirclePair) {
                    const ax = relationData[relationOffsetA + 4];
                    const ay = relationData[relationOffsetA + 5];
                    const bx = relationData[relationOffsetB + 4];
                    const by = relationData[relationOffsetB + 5];
                    const ra = relationData[relationOffsetA + 6];
                    const rb = relationData[relationOffsetB + 6];
                    if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(bx) && Number.isFinite(by)
                        && Number.isFinite(ra) && Number.isFinite(rb) && ra > 0 && rb > 0) {
                        const radiusSum = ra + rb + EPSILON;
                        const dx = bx - ax;
                        const dy = by - ay;
                        if (((dx * dx) + (dy * dy)) > (radiusSum * radiusSum)) {
                            this.#frameStats.circleRejectCount++;
                            continue;
                        }
                    }
                    this.#frameStats.circlePassCount++;
                    this.#recordProfileCount('solveCirclePassCount');
                }

                bodyA._passPairProcessCount = (bodyA._passPairProcessCount || 0) + 1;
                bodyB._passPairProcessCount = (bodyB._passPairProcessCount || 0) + 1;

                const narrowphaseStart = this.#startProfileTimer();
                const pairResolved = isCirclePair
                    ? this.#processEnemyCirclePairSoA(
                        bodyA,
                        bodyB,
                        relationData,
                        relationOffsetA,
                        relationOffsetB,
                        resolvePositions,
                        applyNonPosition,
                        resolveBoost
                    )
                    : this.#processPair(
                        bodyA,
                        bodyB,
                        resolvePositions,
                        applyNonPosition,
                        resolveBoost,
                        COLLISION_RULE_DYNAMIC_RESOLVE
                    );
                this.#recordProfileDuration('solveNarrowphaseMs', narrowphaseStart);
                if (pairResolved > 0) {
                    this.#recordProfileCount('solveResolvedPairCount', pairResolved);
                }
                resolvedCount += pairResolved;
                continue;
            }

            const rule = this.#getPassRule(bodyA, bodyB, applyNonPosition);
            if (!rule) continue;

            if (this.#shouldSkipEnemyPairByBudget(bodyA, bodyB, pairBudget)) {
                this.#recordProfileCount('solveBudgetSkipCount');
                continue;
            }

            this.#frameStats.collisionCheckCount++;
            if (!this.#bodyAabbOverlap(bodyA, bodyB)) {
                this.#frameStats.aabbRejectCount++;
                continue;
            }
            this.#frameStats.aabbPassCount++;
            this.#recordProfileCount('solveAabbPassCount');
            if (this.#shouldUseBroadCircleFilter(bodyA, bodyB)) {
                if (!this.#bodyBroadCircleOverlap(bodyA, bodyB)) {
                    this.#frameStats.circleRejectCount++;
                    continue;
                }
                this.#frameStats.circlePassCount++;
                this.#recordProfileCount('solveCirclePassCount');
            }

            this.#markEnemyPairProcessAttempt(bodyA, bodyB);

            const narrowphaseStart = this.#startProfileTimer();
            const pairResolved = this.#processPair(
                bodyA,
                bodyB,
                resolvePositions,
                applyNonPosition,
                resolveBoost,
                rule
            );
            this.#recordProfileDuration('solveNarrowphaseMs', narrowphaseStart);
            if (pairResolved > 0) {
                this.#recordProfileCount('solveResolvedPairCount', pairResolved);
            }
            resolvedCount += pairResolved;
        }

        return resolvedCount;
    }

    /**
     * @private
     */
    #insertBodyToGridSoA(index, cellSize) {
        const o = index * BROAD_STRIDE;
        const bd = this.#broadData;
        const minCellX = Math.floor(bd[o + 0] / cellSize);
        const maxCellX = Math.floor(bd[o + 1] / cellSize);
        const minCellY = Math.floor(bd[o + 2] / cellSize);
        const maxCellY = Math.floor(bd[o + 3] / cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                let bucket = this.#grid.get(key);
                if (!bucket) {
                    bucket = this.#acquireBucket();
                    this.#grid.set(key, bucket);
                    this.#activeGridBuckets.push(bucket);
                }
                this.#pushBucketIndex(bucket, index);
            }
        }
    }

    /**
     * @private
     */
    #clearGrid() {
        for (let i = 0; i < this.#activeGridBuckets.length; i++) {
            this.#activeGridBuckets[i].count = 0;
        }
        this.#activeGridBuckets.length = 0;
        this.#grid.clear();
        this.#bucketPoolCursor = 0;
    }

    /**
     * @private
     * @returns {GridBucket}
     */
    #acquireBucket() {
        if (this.#bucketPoolCursor < this.#bucketPool.length) {
            const bucket = this.#bucketPool[this.#bucketPoolCursor++];
            bucket.count = 0;
            return bucket;
        }
        const b = {
            indices: new Int32Array(GRID_BUCKET_INITIAL_CAPACITY),
            count: 0
        };
        this.#bucketPool.push(b);
        this.#bucketPoolCursor++;
        return b;
    }

    /**
     * @private
     * @param {GridBucket} bucket
     * @param {number} bodyIndex
     */
    #pushBucketIndex(bucket, bodyIndex) {
        if (bucket.count >= bucket.indices.length) {
            const next = new Int32Array(bucket.indices.length * 2);
            next.set(bucket.indices);
            bucket.indices = next;
        }
        bucket.indices[bucket.count++] = bodyIndex;
    }

    /**
     * @private
     */
    #ensureBroadData(bodyCount) {
        const needed = bodyCount * BROAD_STRIDE;
        if (this.#broadData.length < needed) {
            this.#broadData = new Float32Array(Math.max(needed, this.#broadData.length * 2));
        }
        const relationNeeded = bodyCount * RELATION_BROAD_STRIDE;
        if (this.#relationBroadData.length < relationNeeded) {
            this.#relationBroadData = new Float64Array(Math.max(relationNeeded, this.#relationBroadData.length * 2));
        }
        if (this.#bodyKindCodes.length < bodyCount) {
            this.#bodyKindCodes = new Uint8Array(Math.max(bodyCount, this.#bodyKindCodes.length * 2));
        }
        if (this.#bodyShapeCodes.length < bodyCount) {
            this.#bodyShapeCodes = new Uint8Array(Math.max(bodyCount, this.#bodyShapeCodes.length * 2));
        }
        this.#broadBodyCount = bodyCount;
    }

    /**
     * body 배열 기준으로 broad-phase SoA와 grid를 다시 구성합니다.
     * @private
     * @param {object[]} bodies
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default']
     * @returns {number} 재구성에 사용한 grid cell size
     */
    #rebuildGridFromBodies(bodies, gridMode = 'default') {
        this.#ensureBroadData(bodies.length);
        for (let i = 0; i < bodies.length; i++) {
            this.#writeBroadData(i, bodies[i], gridMode);
        }

        const cellSize = this.#estimateCellSize(bodies, gridMode);
        this.#clearGrid();
        for (let i = 0; i < bodies.length; i++) {
            this.#insertBodyToGridSoA(i, cellSize);
        }

        return cellSize;
    }

    /**
     * projectile broad-phase query에서 사용할 방문 마크 버퍼 크기를 확보합니다.
     * @private
     * @param {number} bodyCount
     */
    #ensureQueryMarks(bodyCount) {
        if (this.#queryMarks.length >= bodyCount) {
            return;
        }

        this.#queryMarks = new Int32Array(Math.max(bodyCount, this.#queryMarks.length * 2));
    }

    /**
     * projectile broad-phase query용 방문 stamp를 갱신합니다.
     * overflow 시 버퍼를 초기화하고 1부터 다시 사용합니다.
     * @private
     * @returns {number}
     */
    #advanceQueryStamp() {
        this.#queryMarkStamp++;
        if (this.#queryMarkStamp < 0x7fffffff) {
            return this.#queryMarkStamp;
        }

        this.#queryMarks.fill(0);
        this.#queryMarkStamp = 1;
        return this.#queryMarkStamp;
    }

    /**
     * 원형 query body가 현재 grid에서 겹치는 enemy 후보 인덱스를 수집합니다.
     * @private
     * @param {object} body
     * @param {number} cellSize
     * @param {number} bodyCount
     * @returns {number[]}
     */
    #collectGridCandidateIndices(body, cellSize, bodyCount) {
        const candidates = this.#queryCandidateIndices;
        candidates.length = 0;
        if (!body || cellSize <= 0 || bodyCount <= 0) {
            return candidates;
        }

        this.#ensureQueryMarks(bodyCount);
        const stamp = this.#advanceQueryStamp();
        const minCellX = Math.floor(body.minX / cellSize);
        const maxCellX = Math.floor(body.maxX / cellSize);
        const minCellY = Math.floor(body.minY / cellSize);
        const maxCellY = Math.floor(body.maxY / cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                const bucket = this.#grid.get(key);
                if (!bucket || bucket.count <= 0) {
                    continue;
                }

                const indices = bucket.indices;
                for (let i = 0; i < bucket.count; i++) {
                    const bodyIndex = indices[i];
                    if (bodyIndex < 0 || bodyIndex >= bodyCount) {
                        continue;
                    }
                    if (this.#queryMarks[bodyIndex] === stamp) {
                        continue;
                    }

                    this.#queryMarks[bodyIndex] = stamp;
                    candidates.push(bodyIndex);
                }
            }
        }

        return candidates;
    }

    /**
     * body kind 문자열을 SoA fast path용 숫자 코드로 변환합니다.
     * @private
     * @param {string} kind
     * @returns {number}
     */
    #getBodyKindCode(kind) {
        if (kind === 'enemy') return BODY_KIND_ENEMY;
        if (kind === 'player') return BODY_KIND_PLAYER;
        if (kind === 'wall') return BODY_KIND_WALL;
        if (kind === 'projectile') return BODY_KIND_PROJECTILE;
        if (kind === 'item') return BODY_KIND_ITEM;
        return BODY_KIND_NONE;
    }

    /**
     * body shape 문자열을 SoA fast path용 숫자 코드로 변환합니다.
     * @private
     * @param {string} shape
     * @returns {number}
     */
    #getBodyShapeCode(shape) {
        if (shape === 'circle') return BODY_SHAPE_CIRCLE;
        if (shape === 'circleParts') return BODY_SHAPE_CIRCLE_PARTS;
        if (shape === 'rect') return BODY_SHAPE_RECT;
        return BODY_SHAPE_NONE;
    }

    /**
     * grid 삽입용 broad-phase SoA 데이터를 씁니다.
     * @private
     * @param {number} index
     * @param {object} body
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default']
     */
    #writeBroadData(index, body, gridMode = 'default') {
        const o = index * BROAD_STRIDE;
        const bd = this.#broadData;
        let minX = body.minX;
        let maxX = body.maxX;
        let minY = body.minY;
        let maxY = body.maxY;
        let broadRadius = body.broadRadius;
        if (body.kind === 'enemy' && gridMode === 'enemyPair') {
            minX = Number.isFinite(body.enemyPairMinX) ? body.enemyPairMinX : minX;
            maxX = Number.isFinite(body.enemyPairMaxX) ? body.enemyPairMaxX : maxX;
            minY = Number.isFinite(body.enemyPairMinY) ? body.enemyPairMinY : minY;
            maxY = Number.isFinite(body.enemyPairMaxY) ? body.enemyPairMaxY : maxY;
            broadRadius = Number.isFinite(body.enemyPairBroadRadius) ? body.enemyPairBroadRadius : broadRadius;
        } else if (body.kind === 'enemy' && gridMode === 'projectile') {
            minX = Number.isFinite(body.projectileMinX) ? body.projectileMinX : minX;
            maxX = Number.isFinite(body.projectileMaxX) ? body.projectileMaxX : maxX;
            minY = Number.isFinite(body.projectileMinY) ? body.projectileMinY : minY;
            maxY = Number.isFinite(body.projectileMaxY) ? body.projectileMaxY : maxY;
            broadRadius = Number.isFinite(body.projectileBroadRadius) ? body.projectileBroadRadius : broadRadius;
        }

        body._broadDataIndex = index;
        this.#bodyKindCodes[index] = this.#getBodyKindCode(body.kind);
        this.#bodyShapeCodes[index] = this.#getBodyShapeCode(body.shape);

        bd[o + 0] = minX;
        bd[o + 1] = maxX;
        bd[o + 2] = minY;
        bd[o + 3] = maxY;
        bd[o + 4] = minX;
        bd[o + 5] = maxX;
        bd[o + 6] = minY;
        bd[o + 7] = maxY;
        bd[o + 8] = body.centerX;
        bd[o + 9] = body.centerY;
        bd[o + 10] = body.boundRadius;
        bd[o + 11] = broadRadius;
        bd[o + 12] = broadRadius * COLLISION_GRID_RADIUS_SCALE;
        bd[o + 13] = body.shape === 'circle' ? body.radius : broadRadius;

        const relationOffset = index * RELATION_BROAD_STRIDE;
        const relationData = this.#relationBroadData;
        relationData[relationOffset + 0] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMinX) ? body.enemyPairMinX : body.minX;
        relationData[relationOffset + 1] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMaxX) ? body.enemyPairMaxX : body.maxX;
        relationData[relationOffset + 2] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMinY) ? body.enemyPairMinY : body.minY;
        relationData[relationOffset + 3] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMaxY) ? body.enemyPairMaxY : body.maxY;
        relationData[relationOffset + 4] = Number.isFinite(body.centerX) ? body.centerX : body.x;
        relationData[relationOffset + 5] = Number.isFinite(body.centerY) ? body.centerY : body.y;
        relationData[relationOffset + 6] = body.kind === 'enemy' && Number.isFinite(body.enemyPairBroadRadius) ? body.enemyPairBroadRadius : broadRadius;
        relationData[relationOffset + 7] = body.kind === 'enemy' && Number.isFinite(body.projectileBroadRadius) ? body.projectileBroadRadius : broadRadius;
    }

    /**
     * 관계별 원형 충돌 반경에 맞춘 AABB 중첩 여부를 반환합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {boolean}
     */
    #bodyAabbOverlap(bodyA, bodyB) {
        if (!bodyA || !bodyB) return false;

        let minAX = bodyA.minX;
        let maxAX = bodyA.maxX;
        let minAY = bodyA.minY;
        let maxAY = bodyA.maxY;
        let minBX = bodyB.minX;
        let maxBX = bodyB.maxX;
        let minBY = bodyB.minY;
        let maxBY = bodyB.maxY;

        if (bodyA.kind === 'enemy' && bodyB.kind === 'enemy') {
            minAX = Number.isFinite(bodyA.enemyPairMinX) ? bodyA.enemyPairMinX : minAX;
            maxAX = Number.isFinite(bodyA.enemyPairMaxX) ? bodyA.enemyPairMaxX : maxAX;
            minAY = Number.isFinite(bodyA.enemyPairMinY) ? bodyA.enemyPairMinY : minAY;
            maxAY = Number.isFinite(bodyA.enemyPairMaxY) ? bodyA.enemyPairMaxY : maxAY;
            minBX = Number.isFinite(bodyB.enemyPairMinX) ? bodyB.enemyPairMinX : minBX;
            maxBX = Number.isFinite(bodyB.enemyPairMaxX) ? bodyB.enemyPairMaxX : maxBX;
            minBY = Number.isFinite(bodyB.enemyPairMinY) ? bodyB.enemyPairMinY : minBY;
            maxBY = Number.isFinite(bodyB.enemyPairMaxY) ? bodyB.enemyPairMaxY : maxBY;
        } else if (bodyA.kind === 'enemy' && bodyB.kind === 'projectile') {
            minAX = Number.isFinite(bodyA.projectileMinX) ? bodyA.projectileMinX : minAX;
            maxAX = Number.isFinite(bodyA.projectileMaxX) ? bodyA.projectileMaxX : maxAX;
            minAY = Number.isFinite(bodyA.projectileMinY) ? bodyA.projectileMinY : minAY;
            maxAY = Number.isFinite(bodyA.projectileMaxY) ? bodyA.projectileMaxY : maxAY;
        } else if (bodyA.kind === 'projectile' && bodyB.kind === 'enemy') {
            minBX = Number.isFinite(bodyB.projectileMinX) ? bodyB.projectileMinX : minBX;
            maxBX = Number.isFinite(bodyB.projectileMaxX) ? bodyB.projectileMaxX : maxBX;
            minBY = Number.isFinite(bodyB.projectileMinY) ? bodyB.projectileMinY : minBY;
            maxBY = Number.isFinite(bodyB.projectileMaxY) ? bodyB.projectileMaxY : maxBY;
        }

        return (
            minAX <= maxBX &&
            maxAX >= minBX &&
            minAY <= maxBY &&
            maxAY >= minBY
        );
    }

    /**
     * broad circle 필터가 narrowphase와 다른 의미를 갖는 쌍인지 반환합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {boolean}
     */
    #shouldUseBroadCircleFilter(bodyA, bodyB) {
        return bodyA?.shape !== 'circle' || bodyB?.shape !== 'circle';
    }

    /**
     * 관계별 union circle의 중첩 여부를 반환합니다.
     * @private
     * @param {object} bodyA
     * @param {object} bodyB
     * @returns {boolean}
     */
    #bodyBroadCircleOverlap(bodyA, bodyB) {
        const ax = Number.isFinite(bodyA?.centerX) ? bodyA.centerX : bodyA?.x;
        const ay = Number.isFinite(bodyA?.centerY) ? bodyA.centerY : bodyA?.y;
        const bx = Number.isFinite(bodyB?.centerX) ? bodyB.centerX : bodyB?.x;
        const by = Number.isFinite(bodyB?.centerY) ? bodyB.centerY : bodyB?.y;
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            return true;
        }

        const ra = this.#getBodyRelationBroadRadius(bodyA, bodyB);
        const rb = this.#getBodyRelationBroadRadius(bodyB, bodyA);
        if (!Number.isFinite(ra) || !Number.isFinite(rb) || ra <= 0 || rb <= 0) {
            return true;
        }

        const radiusSum = ra + rb + EPSILON;
        const dx = bx - ax;
        const dy = by - ay;
        return ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
    }

    /**
     * 관계별 broad-phase 반경을 반환합니다.
     * @private
     * @param {object} body
     * @param {object} otherBody
     * @returns {number}
     */
    #getBodyRelationBroadRadius(body, otherBody) {
        if (!body) return 0;
        if (body.kind === 'enemy' && otherBody?.kind === 'enemy' && Number.isFinite(body.enemyPairBroadRadius)) {
            return body.enemyPairBroadRadius;
        }
        if (body.kind === 'enemy' && otherBody?.kind === 'projectile' && Number.isFinite(body.projectileBroadRadius)) {
            return body.projectileBroadRadius;
        }
        if (body.shape === 'circle') {
            return Number.isFinite(body.radius) ? body.radius : 0;
        }
        if (Number.isFinite(body.broadRadius)) {
            return body.broadRadius;
        }
        if (Number.isFinite(body.boundRadius)) {
            return body.boundRadius;
        }
        const minX = Number.isFinite(body.minX) ? body.minX : 0;
        const maxX = Number.isFinite(body.maxX) ? body.maxX : 0;
        const minY = Number.isFinite(body.minY) ? body.minY : 0;
        const maxY = Number.isFinite(body.maxY) ? body.maxY : 0;
        return Math.hypot((maxX - minX) * 0.5, (maxY - minY) * 0.5);
    }

    /**
     * 침투량 보정 이동을 감쇠/상한 처리하여 과도한 순간 이동을 억제합니다.
     * @private
     */
    #tuneResolutionMoves(resolved, manifold, bodyA, bodyB, resolveBoost = 1) {
        if (!resolved || !manifold) {
            return {
                moveAX: 0,
                moveAY: 0,
                moveBX: 0,
                moveBY: 0
            };
        }

        const rawPenetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
        const slopScale = resolveBoost > 1 ? (1 / resolveBoost) : 1;
        const effectivePenetration = Math.max(0, rawPenetration - (COLLISION_RESOLVE_SLOP * slopScale));
        if (effectivePenetration <= 0) {
            return {
                moveAX: 0,
                moveAY: 0,
                moveBX: 0,
                moveBY: 0
            };
        }

        const penetrationRatio = effectivePenetration / Math.max(EPSILON, rawPenetration);
        const correctionScale = COLLISION_RESOLVE_PERCENT * penetrationRatio * resolveBoost;

        const moveA = this.#clampCorrectionVector(
            (resolved.moveAX || 0) * correctionScale,
            (resolved.moveAY || 0) * correctionScale,
            bodyA,
            resolveBoost
        );
        const moveB = this.#clampCorrectionVector(
            (resolved.moveBX || 0) * correctionScale,
            (resolved.moveBY || 0) * correctionScale,
            bodyB,
            resolveBoost
        );

        return {
            moveAX: moveA.x,
            moveAY: moveA.y,
            moveBX: moveB.x,
            moveBY: moveB.y
        };
    }

    /**
     * @private
     */
    #clampCorrectionVector(dx, dy, body, resolveBoost = 1) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
        const mag = Math.hypot(dx, dy);
        if (mag <= EPSILON) return { x: 0, y: 0 };

        const radius = Number.isFinite(body?.resolveRadius)
            ? body.resolveRadius
            : (Number.isFinite(body?.boundRadius) ? body.boundRadius : 16);
        const baseMaxCorrection = Math.max(COLLISION_RESOLVE_MIN_MAX, radius * COLLISION_RESOLVE_MAX_RATIO);
        const maxCorrection = baseMaxCorrection * this.#getDenseCorrectionScale(body) * resolveBoost;
        if (mag <= maxCorrection) {
            return { x: dx, y: dy };
        }

        const scale = maxCorrection / mag;
        return {
            x: dx * scale,
            y: dy * scale
        };
    }

    /**
     * body 이동량을 현재 broad-phase SoA 버퍼에 반영합니다.
     * @private
     * @param {object} body
     * @param {number} dx
     * @param {number} dy
     */
    #translateBodyBroadData(body, dx, dy) {
        const bodyIndex = Number.isInteger(body?._broadDataIndex) ? body._broadDataIndex : -1;
        if (bodyIndex < 0 || bodyIndex >= this.#broadBodyCount) {
            return;
        }

        const broadOffset = bodyIndex * BROAD_STRIDE;
        const broadData = this.#broadData;
        broadData[broadOffset + 0] += dx;
        broadData[broadOffset + 1] += dx;
        broadData[broadOffset + 2] += dy;
        broadData[broadOffset + 3] += dy;
        broadData[broadOffset + 4] += dx;
        broadData[broadOffset + 5] += dx;
        broadData[broadOffset + 6] += dy;
        broadData[broadOffset + 7] += dy;
        broadData[broadOffset + 8] += dx;
        broadData[broadOffset + 9] += dy;

        const relationOffset = bodyIndex * RELATION_BROAD_STRIDE;
        const relationData = this.#relationBroadData;
        relationData[relationOffset + 0] += dx;
        relationData[relationOffset + 1] += dx;
        relationData[relationOffset + 2] += dy;
        relationData[relationOffset + 3] += dy;
        relationData[relationOffset + 4] += dx;
        relationData[relationOffset + 5] += dy;
    }

    /**
     * @private
     */
    #applyBodyTranslation(body, dx, dy, resolveBoost = 1) {
        if (!body || body.movable === false) return;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (dx === 0 && dy === 0) return;

        const moveMag = Math.hypot(dx, dy);
        if (moveMag <= EPSILON) return;
        const baseFrameMax = Number.isFinite(body._frameResolveMax) ? body._frameResolveMax : Number.POSITIVE_INFINITY;
        const frameMax = baseFrameMax * this.#getDenseFrameScale(body) * resolveBoost;
        const frameMoved = Number.isFinite(body._frameResolveMoved) ? body._frameResolveMoved : 0;
        if (frameMoved >= frameMax) return;
        const remain = frameMax - frameMoved;
        if (remain < moveMag) {
            const scale = remain / moveMag;
            dx *= scale;
            dy *= scale;
        }
        const appliedMag = Math.hypot(dx, dy);
        if (appliedMag <= EPSILON) return;
        body._frameResolveMoved = frameMoved + appliedMag;

        body.centerX += dx;
        body.centerY += dy;
        body.minX += dx;
        body.maxX += dx;
        body.minY += dy;
        body.maxY += dy;
        if (Number.isFinite(body.enemyPairMinX)) body.enemyPairMinX += dx;
        if (Number.isFinite(body.enemyPairMaxX)) body.enemyPairMaxX += dx;
        if (Number.isFinite(body.enemyPairMinY)) body.enemyPairMinY += dy;
        if (Number.isFinite(body.enemyPairMaxY)) body.enemyPairMaxY += dy;
        if (Number.isFinite(body.projectileMinX)) body.projectileMinX += dx;
        if (Number.isFinite(body.projectileMaxX)) body.projectileMaxX += dx;
        if (Number.isFinite(body.projectileMinY)) body.projectileMinY += dy;
        if (Number.isFinite(body.projectileMaxY)) body.projectileMaxY += dy;
        body.x = body.centerX;
        body.y = body.centerY;
        this.#translateBodyBroadData(body, dx, dy);

        if (body.circleParts instanceof Float32Array) {
            const limit = Math.max(0, Math.floor(body.circlePartCount || 0)) * 3;
            for (let i = 0; i < limit; i += 3) {
                body.circleParts[i] += dx;
                body.circleParts[i + 1] += dy;
            }
        }

        if (body.ref?.position) {
            body.ref.position.x += dx;
            body.ref.position.y += dy;
            // 고정틱 말미 충돌 보정으로 위치가 이동하면, 보간 시작점도 함께 이동시켜
            // 렌더 프레임에서 과거 위치로 순간 되돌아가는 시각적 점프를 줄입니다.
            if (body.ref.prevPosition) {
                body.ref.prevPosition.x += dx;
                body.ref.prevPosition.y += dy;
            }
            if (body.kind === 'enemy' && typeof body.ref.applyAxisResistance === 'function') {
                let resistX = 1;
                let resistY = 1;
                const radius = Math.max(1, Number.isFinite(body.boundRadius) ? body.boundRadius : 1);
                const axisRange = Math.max(1, radius * COLLISION_AXIS_RESISTANCE_RADIUS_RATIO);

                const velX = Number.isFinite(body.velocityX) ? body.velocityX : 0;
                const velY = Number.isFinite(body.velocityY) ? body.velocityY : 0;
                if ((dx * velX) < -EPSILON) {
                    const ratioX = Math.min(1, Math.abs(dx) / axisRange);
                    resistX = Math.max(COLLISION_AXIS_RESISTANCE_MIN, 1 - (ratioX * COLLISION_AXIS_RESISTANCE_GAIN));
                }
                if ((dy * velY) < -EPSILON) {
                    const ratioY = Math.min(1, Math.abs(dy) / axisRange);
                    resistY = Math.max(COLLISION_AXIS_RESISTANCE_MIN, 1 - (ratioY * COLLISION_AXIS_RESISTANCE_GAIN));
                }

                if (resistX < 1 || resistY < 1) {
                    body.ref.applyAxisResistance(resistX, resistY);
                }
            }
        }
    }

    /**
     * 고밀도 접촉 상태에서만 분리 보정 상한을 제한적으로 높입니다.
     * @private
     * @param {object} body
     * @returns {number}
     */
    #getDenseCorrectionScale(body) {
        const candidateCount = this.#getBodyPressure(body);
        if (candidateCount < DENSE_CORRECTION_CANDIDATE_THRESHOLD) return 1;
        const extra = candidateCount - DENSE_CORRECTION_CANDIDATE_THRESHOLD + 1;
        return Math.min(
            DENSE_CORRECTION_SCALE_MAX,
            1 + (extra * DENSE_CORRECTION_SCALE_PER_NEIGHBOR)
        );
    }

    /**
     * 과밀 구간에서 프레임당 이동 상한을 소폭 완화합니다.
     * @private
     * @param {object} body
     * @returns {number}
     */
    #getDenseFrameScale(body) {
        const candidateCount = this.#getBodyPressure(body);
        if (candidateCount < DENSE_FRAME_CANDIDATE_THRESHOLD) return 1;
        const extra = candidateCount - DENSE_FRAME_CANDIDATE_THRESHOLD + 1;
        return Math.min(
            DENSE_FRAME_SCALE_MAX,
            1 + (extra * DENSE_FRAME_SCALE_PER_NEIGHBOR)
        );
    }

    /**
     * @private
     */
    #getRule(kindA, kindB) {
        // enemy vs enemy
        if (kindA === 'enemy' && kindB === 'enemy') {
            return COLLISION_RULE_DYNAMIC_RESOLVE;
        }
        // enemy vs player: 플레이어는 밀리지 않음
        if (kindA === 'enemy' && kindB === 'player') {
            return COLLISION_RULE_ENEMY_PLAYER;
        }
        if (kindA === 'player' && kindB === 'enemy') {
            return COLLISION_RULE_PLAYER_ENEMY;
        }
        // enemy vs projectile: 관통 허용 + 중복 타격 방지
        if ((kindA === 'enemy' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'enemy')) {
            return COLLISION_RULE_PROJECTILE_ENEMY;
        }
        // enemy vs item: 미판정
        if ((kindA === 'enemy' && kindB === 'item') || (kindA === 'item' && kindB === 'enemy')) {
            return COLLISION_RULE_NONE;
        }
        // player vs player
        if (kindA === 'player' && kindB === 'player') {
            return COLLISION_RULE_DYNAMIC_RESOLVE;
        }
        // player vs projectile: 관통 허용 + 중복 타격 방지
        if ((kindA === 'player' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'player')) {
            return COLLISION_RULE_PLAYER_PROJECTILE;
        }
        // player vs item: 판정만
        if ((kindA === 'player' && kindB === 'item') || (kindA === 'item' && kindB === 'player')) {
            return COLLISION_RULE_PLAYER_ITEM;
        }
        // projectile vs projectile: 관통 허용 + 중복 영향 방지
        if (kindA === 'projectile' && kindB === 'projectile') {
            return COLLISION_RULE_PROJECTILE_PROJECTILE;
        }
        // projectile vs item: 미판정
        if ((kindA === 'projectile' && kindB === 'item') || (kindA === 'item' && kindB === 'projectile')) {
            return COLLISION_RULE_NONE;
        }
        // item vs item
        if (kindA === 'item' && kindB === 'item') {
            return COLLISION_RULE_DYNAMIC_RESOLVE;
        }
        // dynamic vs wall
        if (kindA === 'wall') {
            if (kindB === 'projectile') return COLLISION_RULE_WALL_PROJECTILE;
            return kindB === 'wall' ? COLLISION_RULE_NONE : COLLISION_RULE_WALL_OTHER;
        }
        if (kindB === 'wall') {
            if (kindA === 'projectile') return COLLISION_RULE_PROJECTILE_WALL;
            return kindA === 'wall' ? COLLISION_RULE_NONE : COLLISION_RULE_OTHER_WALL;
        }

        return COLLISION_RULE_NONE;
    }

    /**
     * @private
     */
    #hasProjectileHit(projectile, targetId) {
        if (!projectile || !Number.isInteger(targetId)) return false;
        if (typeof projectile.hasHitEnemy === 'function') {
            return projectile.hasHitEnemy(targetId);
        }
        if (projectile.hitEnemyIds instanceof Set) {
            return projectile.hitEnemyIds.has(targetId);
        }
        return false;
    }

    /**
     * @private
     */
    #markProjectileHit(projectile, targetId) {
        if (!projectile || !Number.isInteger(targetId)) return;
        if (typeof projectile.markEnemyHit === 'function') {
            projectile.markEnemyHit(targetId);
            return;
        }
        if (!(projectile.hitEnemyIds instanceof Set)) {
            projectile.hitEnemyIds = new Set();
        }
        projectile.hitEnemyIds.add(targetId);
    }

    /**
     * @private
     */
    #applyProjectileImpact(projectile, enemy, manifold) {
        if (!projectile || !enemy || !manifold) return;
        if (typeof enemy.addAngularImpulse !== 'function') return;

        const vx = Number.isFinite(projectile.velocity?.x)
            ? projectile.velocity.x
            : (Number.isFinite(projectile.speed?.x) ? projectile.speed.x : 0);
        const vy = Number.isFinite(projectile.velocity?.y)
            ? projectile.velocity.y
            : (Number.isFinite(projectile.speed?.y) ? projectile.speed.y : 0);
        const speed = Math.hypot(vx, vy);
        if (speed <= EPSILON) return;

        const impactX = Number.isFinite(manifold.pointX) ? manifold.pointX : enemy.position.x;
        const impactY = Number.isFinite(manifold.pointY) ? manifold.pointY : enemy.position.y;

        const relX = impactX - enemy.position.x;
        const relY = impactY - enemy.position.y;
        const projectileWeight = Math.max(0.01, Number.isFinite(projectile.weight) ? projectile.weight : 1);
        const forceScale = (Number.isFinite(projectile.impactForce) ? projectile.impactForce : 1) * projectileWeight;
        const impulseX = (vx / speed) * speed * forceScale;
        const impulseY = (vy / speed) * speed * forceScale;
        const torque = (relX * impulseY) - (relY * impulseX);
        const weight = Math.max(0.1, Number.isFinite(enemy.weight) ? enemy.weight : 1);
        const angularImpulse = (torque / weight) * ROTATION_IMPULSE_SCALE * ROTATION_RESPONSE_MULTIPLIER;

        enemy.lastImpactPoint = { x: impactX, y: impactY };
        enemy.lastImpactOffset = { x: relX, y: relY };
        enemy.lastImpactOffsetRatio = Math.min(
            1,
            Math.hypot(relX, relY) / Math.max(enemy.getRenderHeightPx?.() || 1, 1)
        );
        enemy.addAngularImpulse(angularImpulse, 1);

        if (typeof enemy.registerProjectileHit === 'function') {
            enemy.registerProjectileHit();
        } else if (Number.isFinite(enemy.projectileHitsToKill) && enemy.projectileHitsToKill > 0) {
            const hitCount = (Number.isFinite(enemy.projectileHitCount) ? enemy.projectileHitCount : 0) + 1;
            enemy.projectileHitCount = hitCount;
            if (hitCount >= enemy.projectileHitsToKill) {
                enemy.active = false;
            }
        }
    }

    /**
     * enemy-enemy 충돌 시 충돌 지점/무게를 반영한 회전 반동을 적용합니다.
     * @private
     */
    #applyEnemyCollisionRotation(bodyA, bodyB, manifold) {
        const enemyA = bodyA?.ref;
        const enemyB = bodyB?.ref;
        if (!enemyA || !enemyB) return;
        if (typeof enemyA.addAngularImpulse !== 'function' || typeof enemyB.addAngularImpulse !== 'function') return;

        const rvx = (bodyA.velocityX || 0) - (bodyB.velocityX || 0);
        const rvy = (bodyA.velocityY || 0) - (bodyB.velocityY || 0);
        const speedA = Math.hypot(bodyA.velocityX || 0, bodyA.velocityY || 0);
        const speedB = Math.hypot(bodyB.velocityX || 0, bodyB.velocityY || 0);
        const speedGap = Math.abs(speedA - speedB);
        const gap = speedGap - ENEMY_COLLISION_SPEED_GAP_DEADZONE;
        if (gap <= 0) return;

        const nx = Number.isFinite(manifold.normalX) ? manifold.normalX : 1;
        const ny = Number.isFinite(manifold.normalY) ? manifold.normalY : 0;
        const closingSpeed = Math.max(0, (rvx * nx) + (rvy * ny));
        if (closingSpeed <= EPSILON) return;

        const pointX = Number.isFinite(manifold.pointX) ? manifold.pointX : ((bodyA.centerX + bodyB.centerX) * 0.5);
        const pointY = Number.isFinite(manifold.pointY) ? manifold.pointY : ((bodyA.centerY + bodyB.centerY) * 0.5);

        const relAX = pointX - bodyA.centerX;
        const relAY = pointY - bodyA.centerY;
        const relBX = pointX - bodyB.centerX;
        const relBY = pointY - bodyB.centerY;

        const torqueSignA = Math.sign((relAX * rvy) - (relAY * rvx)) || 1;
        const torqueSignB = -torqueSignA;
        const armA = Math.hypot(relAX, relAY);
        const armB = Math.hypot(relBX, relBY);
        const sizeA = Math.max(1, enemyA.getRenderHeightPx?.() || 1);
        const sizeB = Math.max(1, enemyB.getRenderHeightPx?.() || 1);
        const armRatioA = Math.min(1, armA / sizeA);
        const armRatioB = Math.min(1, armB / sizeB);
        const offCenterA = Math.max(0, armRatioA - ENEMY_COLLISION_CENTER_DEADZONE);
        const offCenterB = Math.max(0, armRatioB - ENEMY_COLLISION_CENTER_DEADZONE);
        if (offCenterA <= 0 && offCenterB <= 0) return;

        const weightA = Math.max(0.1, Number.isFinite(enemyA.weight) ? enemyA.weight : 1);
        const weightB = Math.max(0.1, Number.isFinite(enemyB.weight) ? enemyB.weight : 1);
        const sumWeight = weightA + weightB;
        const shareA = weightB / sumWeight;
        const shareB = weightA / sumWeight;
        const offCenterFactor = Math.min(1, ((offCenterA + offCenterB) * 0.5) / Math.max(EPSILON, 1 - ENEMY_COLLISION_CENTER_DEADZONE));
        const baseImpulseRaw = gap * ENEMY_COLLISION_ROTATION_SCALE * (offCenterFactor * offCenterFactor);
        const dynamicScale = Math.min(1, closingSpeed / Math.max(speedGap, EPSILON));
        const baseImpulse = Math.min(
            ENEMY_COLLISION_MAX_ANGULAR_IMPULSE,
            baseImpulseRaw * dynamicScale * ROTATION_RESPONSE_MULTIPLIER
        );
        if (baseImpulse < ENEMY_COLLISION_MIN_EFFECTIVE_IMPULSE) return;
        const ampA = 0.3 + (offCenterA * 0.7);
        const ampB = 0.3 + (offCenterB * 0.7);

        enemyA.lastImpactPoint = { x: pointX, y: pointY };
        enemyB.lastImpactPoint = { x: pointX, y: pointY };
        enemyA.lastImpactOffset = { x: relAX, y: relAY };
        enemyB.lastImpactOffset = { x: relBX, y: relBY };
        enemyA.lastImpactOffsetRatio = armRatioA;
        enemyB.lastImpactOffsetRatio = armRatioB;
        enemyA.addAngularImpulse(torqueSignA * baseImpulse * shareA * ampA, 1);
        enemyB.addAngularImpulse(torqueSignB * baseImpulse * shareB * ampB, 1);
    }

    /**
     * @private
     */
    #buildEnemyBodies(enemies, delta) {
        const bodies = this.#enemyBodiesBuffer;
        bodies.length = 0;
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || enemy.active === false) continue;

            const prevX = Number.isFinite(enemy.__collisionPrevX) ? enemy.__collisionPrevX : enemy.position.x;
            const prevY = Number.isFinite(enemy.__collisionPrevY) ? enemy.__collisionPrevY : enemy.position.y;
            const speedX = (enemy.position.x - prevX) / Math.max(EPSILON, delta);
            const speedY = (enemy.position.y - prevY) / Math.max(EPSILON, delta);
            const speedSq = (speedX * speedX) + (speedY * speedY);
            const sleepTicks = Number.isFinite(enemy.__collisionSleepTicks) ? enemy.__collisionSleepTicks : 0;
            const sleeping = sleepTicks > 0 && speedSq <= COLLISION_SLEEP_SPEED_SQ;
            if (sleeping) {
                enemy.__collisionSleepTicks = sleepTicks - 1;
            }

            const body = this.#buildEnemyBody(enemy, delta, sleeping);
            if (body) bodies.push(body);
        }
        return bodies;
    }

    /**
     * @private
     */
    #buildPlayerBodies(players, delta) {
        const bodies = this.#playerBodiesBuffer;
        bodies.length = 0;
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            if (!player || player.active === false) continue;
            const radius = Number.isFinite(player.radius) ? player.radius : 0;
            if (radius <= 0) continue;

            const x = Number.isFinite(player.position?.x) ? player.position.x : 0;
            const y = Number.isFinite(player.position?.y) ? player.position.y : 0;
            const prevX = Number.isFinite(player.prevPosition?.x)
                ? player.prevPosition.x
                : (x - ((Number.isFinite(player.speed?.x) ? player.speed.x : 0) * delta));
            const prevY = Number.isFinite(player.prevPosition?.y)
                ? player.prevPosition.y
                : (y - ((Number.isFinite(player.speed?.y) ? player.speed.y : 0) * delta));
            const invDelta = 1 / Math.max(EPSILON, delta);
            const velX = (x - prevX) * invDelta;
            const velY = (y - prevY) * invDelta;
            const frameResolvePad = Math.max(
                COLLISION_RESOLVE_FRAME_MIN_MAX,
                radius * COLLISION_RESOLVE_FRAME_MAX_RATIO
            );
            const sweepPadX = (Math.abs(velX) * delta) + frameResolvePad;
            const sweepPadY = (Math.abs(velY) * delta) + frameResolvePad;

            const body = this.#acquireBody();
            body.id = Number.isInteger(player.id) ? player.id : -1;
            body.kind = 'player';
            body.shape = 'circle';
            body.x = x;
            body.y = y;
            body.centerX = x;
            body.centerY = y;
            body.radius = radius;
            body.ref = player;
            body.weight = Math.max(EPSILON, Number.isFinite(player.weight) ? player.weight : 1);
            body.movable = true;
            body.circleParts = null;
            body.circlePartCount = 0;
            body.mergeLock = false;
            body.minX = x - radius;
            body.maxX = x + radius;
            body.minY = y - radius;
            body.maxY = y + radius;
            body.enemyPairMinX = body.minX;
            body.enemyPairMaxX = body.maxX;
            body.enemyPairMinY = body.minY;
            body.enemyPairMaxY = body.maxY;
            body.projectileMinX = body.minX;
            body.projectileMaxX = body.maxX;
            body.projectileMinY = body.minY;
            body.projectileMaxY = body.maxY;
            body.sweepMinX = x - radius - sweepPadX;
            body.sweepMaxX = x + radius + sweepPadX;
            body.sweepMinY = y - radius - sweepPadY;
            body.sweepMaxY = y + radius + sweepPadY;
            body.boundRadius = radius;
            body.broadRadius = radius;
            body.enemyPairBroadRadius = radius;
            body.projectileBroadRadius = radius;
            body.velocityX = velX;
            body.velocityY = velY;
            body._candidatePairCount = 0;
            body._resolvedPairCount = 0;
            body._passPairProcessCount = 0;
            body._frameResolveMoved = 0;
            body._frameResolveMax = frameResolvePad;
            bodies.push(body);
        }
        return bodies;
    }

    /**
     * @private
     */
    #buildEnemyBody(enemy, delta, sleeping = false) {
        const baseHeight = typeof enemy.getRenderHeightPx === 'function'
            ? enemy.getRenderHeightPx()
            : (getSimulationObjectWH() * 0.03 * (enemy.size || 1));
        const width = baseHeight * (enemy.aspectRatio ?? 1);
        const height = baseHeight * (enemy.heightScale ?? 1);
        const hexaHiveCenters = Array.isArray(enemy?.hexaHiveLayout?.filledLocalCenters) && enemy.hexaHiveLayout.filledLocalCenters.length > 0
            ? enemy.hexaHiveLayout.filledLocalCenters
            : (Array.isArray(enemy?.hexaHiveLayout?.visibleLocalCenters) ? enemy.hexaHiveLayout.visibleLocalCenters : null);
        const useHiveCells = enemy?.type === 'hexa_hive' && Array.isArray(hexaHiveCenters) && hexaHiveCenters.length > 0;
        const partCount = useHiveCells ? hexaHiveCenters.length : 1;
        if (partCount <= 0) return null;

        let cos = 1;
        let sin = 0;
        if (useHiveCells) {
            const rotationDeg = Number.isFinite(enemy.rotation) ? enemy.rotation : 0;
            const rad = rotationDeg * (Math.PI / 180);
            cos = Math.cos(rad);
            sin = Math.sin(rad);
        }
        const centerX = enemy.position.x;
        const centerY = enemy.position.y;

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let enemyPairMinX = Number.POSITIVE_INFINITY;
        let enemyPairMaxX = Number.NEGATIVE_INFINITY;
        let enemyPairMinY = Number.POSITIVE_INFINITY;
        let enemyPairMaxY = Number.NEGATIVE_INFINITY;
        let projectileMinX = Number.POSITIVE_INFINITY;
        let projectileMaxX = Number.NEGATIVE_INFINITY;
        let projectileMinY = Number.POSITIVE_INFINITY;
        let projectileMaxY = Number.NEGATIVE_INFINITY;
        let broadRadius = 0;
        let enemyPairBroadRadius = 0;
        let projectileBroadRadius = 0;
        const singleCircleRadius = useHiveCells
            ? HEXA_HIVE_CELL_COLLISION_RADIUS * Math.max(width, height)
            : getEnemyCircleCollisionRadius(enemy.type, width, height);

        if (useHiveCells) {
            const circleBufferLength = partCount * 3;
            if (!(enemy.__collisionWorldCircles instanceof Float32Array) || enemy.__collisionWorldCircles.length !== circleBufferLength) {
                enemy.__collisionWorldCircles = new Float32Array(circleBufferLength);
            }

            for (let p = 0; p < partCount; p++) {
                const localCenter = hexaHiveCenters[p];
                const lx = (Number.isFinite(localCenter?.x) ? localCenter.x : 0) * width;
                const ly = (Number.isFinite(localCenter?.y) ? localCenter.y : 0) * height;
                const wx = centerX + (lx * cos) - (ly * sin);
                const wy = centerY + (lx * sin) + (ly * cos);
                const radius = singleCircleRadius;
                const enemyPairRadius = radius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
                const projectileRadius = radius * ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
                const offset = p * 3;
                enemy.__collisionWorldCircles[offset] = wx;
                enemy.__collisionWorldCircles[offset + 1] = wy;
                enemy.__collisionWorldCircles[offset + 2] = radius;

                minX = Math.min(minX, wx - radius);
                maxX = Math.max(maxX, wx + radius);
                minY = Math.min(minY, wy - radius);
                maxY = Math.max(maxY, wy + radius);
                enemyPairMinX = Math.min(enemyPairMinX, wx - enemyPairRadius);
                enemyPairMaxX = Math.max(enemyPairMaxX, wx + enemyPairRadius);
                enemyPairMinY = Math.min(enemyPairMinY, wy - enemyPairRadius);
                enemyPairMaxY = Math.max(enemyPairMaxY, wy + enemyPairRadius);
                projectileMinX = Math.min(projectileMinX, wx - projectileRadius);
                projectileMaxX = Math.max(projectileMaxX, wx + projectileRadius);
                projectileMinY = Math.min(projectileMinY, wy - projectileRadius);
                projectileMaxY = Math.max(projectileMaxY, wy + projectileRadius);

                const centerDistance = Math.hypot(wx - centerX, wy - centerY);
                broadRadius = Math.max(broadRadius, centerDistance + radius);
                enemyPairBroadRadius = Math.max(enemyPairBroadRadius, centerDistance + enemyPairRadius);
                projectileBroadRadius = Math.max(projectileBroadRadius, centerDistance + projectileRadius);
            }
        } else {
            const radius = singleCircleRadius;
            const enemyPairRadius = radius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
            const projectileRadius = radius * ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
            minX = centerX - radius;
            maxX = centerX + radius;
            minY = centerY - radius;
            maxY = centerY + radius;
            enemyPairMinX = centerX - enemyPairRadius;
            enemyPairMaxX = centerX + enemyPairRadius;
            enemyPairMinY = centerY - enemyPairRadius;
            enemyPairMaxY = centerY + enemyPairRadius;
            projectileMinX = centerX - projectileRadius;
            projectileMaxX = centerX + projectileRadius;
            projectileMinY = centerY - projectileRadius;
            projectileMaxY = centerY + projectileRadius;
            broadRadius = radius;
            enemyPairBroadRadius = enemyPairRadius;
            projectileBroadRadius = projectileRadius;
        }

        const prevX = sleeping
            ? centerX
            : (Number.isFinite(enemy.__collisionPrevX)
                ? enemy.__collisionPrevX
                : (Number.isFinite(enemy.prevPosition?.x) ? enemy.prevPosition.x : centerX));
        const prevY = sleeping
            ? centerY
            : (Number.isFinite(enemy.__collisionPrevY)
                ? enemy.__collisionPrevY
                : (Number.isFinite(enemy.prevPosition?.y) ? enemy.prevPosition.y : centerY));
        const invDelta = 1 / Math.max(EPSILON, delta);
        const velX = (centerX - prevX) * invDelta;
        const velY = (centerY - prevY) * invDelta;

        const boundRadius = Math.max((maxX - minX) * 0.5, (maxY - minY) * 0.5);
        const resolveRadius = getEnemyResolveRadius(enemy, boundRadius, baseHeight);
        const frameResolvePad = Math.max(
            COLLISION_RESOLVE_FRAME_MIN_MAX,
            resolveRadius * COLLISION_RESOLVE_FRAME_MAX_RATIO
        );
        const velocitySweepPadX = sleeping ? 0 : (Math.abs(velX) * delta);
        const velocitySweepPadY = sleeping ? 0 : (Math.abs(velY) * delta);
        const sweepPadX = velocitySweepPadX + frameResolvePad;
        const sweepPadY = velocitySweepPadY + frameResolvePad;

        const body = this.#acquireBody();
        body.id = Number.isInteger(enemy.id) ? enemy.id : -1;
        body.kind = 'enemy';
        body.shape = useHiveCells ? 'circleParts' : 'circle';
        body.circleParts = useHiveCells ? enemy.__collisionWorldCircles : null;
        body.circlePartCount = useHiveCells ? partCount : 0;
        body.ref = enemy;
        body.mergeLock = enemy?.hexaHiveMergePending === true;
        body.weight = body.mergeLock
            ? Math.max(MERGE_PENDING_RESOLVE_WEIGHT, Number.isFinite(enemy.hexaHiveMergePendingWeight) ? enemy.hexaHiveMergePendingWeight : MERGE_PENDING_RESOLVE_WEIGHT)
            : Math.max(EPSILON, Number.isFinite(enemy.weight) ? enemy.weight : 1);
        body.movable = true;
        body.centerX = centerX;
        body.centerY = centerY;
        body.x = centerX;
        body.y = centerY;
        body.radius = singleCircleRadius;
        body.minX = minX;
        body.maxX = maxX;
        body.minY = minY;
        body.maxY = maxY;
        body.enemyPairMinX = enemyPairMinX;
        body.enemyPairMaxX = enemyPairMaxX;
        body.enemyPairMinY = enemyPairMinY;
        body.enemyPairMaxY = enemyPairMaxY;
        body.projectileMinX = projectileMinX;
        body.projectileMaxX = projectileMaxX;
        body.projectileMinY = projectileMinY;
        body.projectileMaxY = projectileMaxY;
        body.sweepMinX = minX - sweepPadX;
        body.sweepMaxX = maxX + sweepPadX;
        body.sweepMinY = minY - sweepPadY;
        body.sweepMaxY = maxY + sweepPadY;
        body.boundRadius = boundRadius;
        body.broadRadius = broadRadius;
        body.enemyPairBroadRadius = enemyPairBroadRadius;
        body.projectileBroadRadius = projectileBroadRadius;
        body.resolveRadius = resolveRadius;
        body.velocityX = velX;
        body.velocityY = velY;
        body._candidatePairCount = 0;
        body._resolvedPairCount = 0;
        body._passPairProcessCount = 0;
        body._frameResolveMoved = 0;
        body._frameResolveMax = frameResolvePad;
        return body;
    }

    /**
     * @private
     */
    #buildWallBodies() {
        const out = this.#wallBodiesCache;
        if (!Array.isArray(this.walls) || this.walls.length === 0) {
            out.length = 0;
            this.#wallBodiesDirty = false;
            return out;
        }
        if (!this.#wallBodiesDirty) {
            return out;
        }

        out.length = 0;
        for (let i = 0; i < this.walls.length; i++) {
            const wall = this.walls[i];
            if (!wall) continue;
            const rect = typeof wall.getCollisionRect === 'function' ? wall.getCollisionRect() : wall;
            if (!rect) continue;

            const w = Number.isFinite(rect.w) ? rect.w : 0;
            const h = Number.isFinite(rect.h) ? rect.h : 0;
            if (w <= 0 || h <= 0) continue;
            const isCenter = rect.origin === 'center' || rect.isCenter === true;
            const cx = isCenter ? rect.x : (rect.x + (w * 0.5));
            const cy = isCenter ? rect.y : (rect.y + (h * 0.5));
            const hw = w * 0.5;
            const hh = h * 0.5;

            out.push({
                id: Number.isInteger(rect.id) ? rect.id : -1,
                kind: 'wall',
                shape: 'rect',
                circleParts: null,
                circlePartCount: 0,
                ref: wall,
                weight: Number.MAX_SAFE_INTEGER,
                movable: false,
                mergeLock: false,
                centerX: cx,
                centerY: cy,
                x: cx,
                y: cy,
                minX: cx - hw,
                maxX: cx + hw,
                minY: cy - hh,
                maxY: cy + hh,
                sweepMinX: cx - hw,
                sweepMaxX: cx + hw,
                sweepMinY: cy - hh,
                sweepMaxY: cy + hh,
                boundRadius: Math.max(hw, hh),
                broadRadius: Math.hypot(hw, hh),
                velocityX: 0,
                velocityY: 0,
                _candidatePairCount: 0,
                _resolvedPairCount: 0,
                _passPairProcessCount: 0
            });
        }
        this.#wallBodiesDirty = false;
        return out;
    }
}
