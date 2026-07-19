import { getData } from 'data/data_handler.js';
import { CollisionDetector } from './_collision_detector.js';
import {
    COLLISION_CANDIDATE_SWEEP_PAD_SCALE,
    COLLISION_RESOLVE_FRAME_MAX_RATIO,
    COLLISION_RESOLVE_FRAME_MIN_MAX,
    DENSE_POSITION_SOLVE_MAX_PASSES,
    getCollisionDensePressure,
    getCollisionResolvePassBoost,
    isCollisionEnemyPairAnchorBody,
    isCollisionHexaHiveWallBody
} from './_collision_resolve_tuning.js';
import {
    applyCollisionProjectileImpact,
    hasCollisionProjectileHit,
    markCollisionProjectileHit
} from './_collision_projectile_effect.js';
import {
    areCollisionBodyAabbsOverlapping,
    areCollisionBodyBroadCirclesOverlapping,
    shouldUseCollisionBroadCircleFilter
} from './collision_broad_phase_filter.js';
import { detectCollisionBodies } from './collision_body_detector.js';
import { CollisionBroadphaseBuffer } from './collision_broadphase_buffer.js';
import { CollisionBodyPool } from './collision_body_pool.js';
import {
    getCollisionEnemyCandidateBucketScanToken,
    getCollisionEnemyCandidateVisitLimit,
    shouldAdmitCollisionEnemyCandidate
} from './collision_candidate_admission.js';
import { CollisionCandidatePairBuffer } from './collision_candidate_pair_buffer.js';
import { getCollisionPeakCandidatePairs } from './collision_candidate_density.js';
import { processCollisionCandidatePairs } from './collision_candidate_pair_processor.js';
import { CollisionEnemyBodyCache } from './collision_enemy_body_cache.js';
import {
    getCollisionEnemyPairProcessBudget,
    resetCollisionPassPairProcessCounts
} from './collision_enemy_pair_budget.js';
import {
    advanceCollisionEnemySleepState,
    isCollisionEnemySleepObservationComplete,
    markCollisionEnemySleepObservationIncomplete,
    readCollisionEnemySleepState,
    resetCollisionEnemySleepObservation,
    updateCollisionEnemyPostSolveSleepState
} from './collision_enemy_sleep_state.js';
import {
    syncCollisionEnemyBodyResolveState,
    writeCollisionEnemyBody
} from './collision_enemy_body_builder.js';
import { CollisionGridBucketPool } from './collision_grid_bucket_pool.js';
import { estimateCollisionGridCellSize } from './collision_grid_cell_size.js';
import { CollisionGridQueryBuffer } from './collision_grid_query_buffer.js';
import { writeCollisionPlayerBody } from './collision_player_body_builder.js';
import { applyCollisionPairResolution } from './collision_pair_resolver.js';
import { getCollisionPassRule, areCollisionBodiesSameEntity } from './collision_pair_rule_guard.js';
import { writeCollisionProjectileSweepBody } from './collision_projectile_sweep_body.js';
import { writeCollisionWallBodies } from './collision_wall_body_builder.js';
import {
    createCollisionFrameStats,
    createCollisionFrameStatsSnapshot,
    resetCollisionFrameStats
} from './collision_frame_stats.js';
import { CollisionProfileRecorder } from './collision_profile_recorder.js';
import {
    createCollisionManifold,
    createCollisionScratchProjectileBody
} from './collision_scratch_objects.js';
import {
    COLLISION_BODY_KIND_ENEMY as BODY_KIND_ENEMY,
    COLLISION_BODY_SHAPE_CIRCLE as BODY_SHAPE_CIRCLE,
    COLLISION_BROAD_STRIDE as BROAD_STRIDE,
    COLLISION_CANDIDATE_SWEEP_INDEX as CANDIDATE_SWEEP_INDEX,
    COLLISION_CANDIDATE_SWEEP_STRIDE as CANDIDATE_SWEEP_STRIDE
} from './collision_soa_layout.js';
import { getSimulationSetting } from '../simulation/simulation_runtime.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const CELL_KEY_OFFSET = COLLISION_CONSTANTS.GRID.CELL_KEY_OFFSET;
const CELL_KEY_STRIDE = COLLISION_CONSTANTS.GRID.CELL_KEY_STRIDE;
const DEFAULT_PHYSICS_ITERATION_COUNT = COLLISION_CONSTANTS.SOLVER.DEFAULT_PHYSICS_ITERATION_COUNT;
const PROJECTILE_SWEEP_RADIUS_STEP = COLLISION_CONSTANTS.SOLVER.PROJECTILE_SWEEP_RADIUS_STEP;
const COLLISION_IDLE_TICKS_TO_SLEEP = COLLISION_CONSTANTS.SLEEP.IDLE_TICKS_TO_SLEEP;
const COLLISION_SLEEP_TICKS = COLLISION_CONSTANTS.SLEEP.TICKS;
const COLLISION_SLEEP_SPEED_SQ = COLLISION_CONSTANTS.SLEEP.SPEED_SQ;
const COLLISION_BASE_STAT_FIELDS = COLLISION_CONSTANTS.FRAME_STATS.BASE_FIELDS;
const COLLISION_ENEMY_BODY_BUILD_OPTIONS = Object.freeze({
    epsilon: EPSILON,
    frameResolveMinMax: COLLISION_RESOLVE_FRAME_MIN_MAX,
    frameResolveMaxRatio: COLLISION_RESOLVE_FRAME_MAX_RATIO
});
const COLLISION_PLAYER_BODY_BUILD_OPTIONS = COLLISION_ENEMY_BODY_BUILD_OPTIONS;

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
    #contactBodyPool;
    #enemyBodiesBuffer;
    #contactBodiesBuffer;
    #playerBodiesBuffer;
    #scratchProjectileBody;
    #scratchManifold;
    #scratchCandidateManifold;
    #scratchBestManifold;
    #bodyDetectorContext;
    #broadphaseBuffer;
    #gridBucketPool;
    #activeGridBuckets;
    #gridQueryBuffer;
    #candidatePairs;
    #enemyBodyCache;
    #profileRecorder;
    #activeGridCellSize;
    #contactPairs;
    #contactPairRecords;
    #contactStatsSnapshot;
    #pairProcessContext;
    #processObjectPairCallback;
    #fixedFrameToken;
    #pairPassCursor;
    #enemyCandidateScanEpoch;
    #sleepAdvanceFrameByEnemy;
    #sleepPostSolveFrameByEnemy;
    #enemyCandidateScanTruncated;

    constructor() {
        this.detector = new CollisionDetector();
        this.walls = [];
        this.#grid = new Map();
        this.#tempBodies = [];
        this.#wallBodiesCache = [];
        this.#wallBodiesDirty = true;
        this.#frameStats = createCollisionFrameStats();
        this.#bodyPool = new CollisionBodyPool();
        this.#contactBodyPool = new CollisionBodyPool();
        this.#enemyBodiesBuffer = [];
        this.#contactBodiesBuffer = [];
        this.#playerBodiesBuffer = [];
        this.#scratchProjectileBody = createCollisionScratchProjectileBody();
        this.#scratchManifold = createCollisionManifold();
        this.#scratchCandidateManifold = createCollisionManifold();
        this.#scratchBestManifold = createCollisionManifold();
        this.#broadphaseBuffer = new CollisionBroadphaseBuffer();
        this.#gridBucketPool = new CollisionGridBucketPool();
        this.#activeGridBuckets = [];
        this.#gridQueryBuffer = new CollisionGridQueryBuffer();
        this.#candidatePairs = new CollisionCandidatePairBuffer();
        this.#enemyBodyCache = new CollisionEnemyBodyCache(this.#enemyBodiesBuffer);
        this.#profileRecorder = new CollisionProfileRecorder(this.#frameStats);
        this.#activeGridCellSize = 1;
        this.#contactPairs = [];
        this.#contactPairRecords = [];
        this.#contactStatsSnapshot = {};
        this.#processObjectPairCallback = this.#processPair.bind(this);
        this.#fixedFrameToken = 0;
        this.#pairPassCursor = 0;
        this.#enemyCandidateScanEpoch = 0;
        this.#sleepAdvanceFrameByEnemy = new WeakMap();
        this.#sleepPostSolveFrameByEnemy = new WeakMap();
        this.#enemyCandidateScanTruncated = false;
        this.#bodyDetectorContext = {
            manifold: this.#scratchManifold,
            candidateManifold: this.#scratchCandidateManifold,
            bestManifold: this.#scratchBestManifold,
            profileRecorder: this.#profileRecorder
        };
        this.#pairProcessContext = {
            bodies: null,
            candidatePairs: this.#candidatePairs,
            broadphaseBuffer: this.#broadphaseBuffer,
            frameStats: this.#frameStats,
            profileRecorder: this.#profileRecorder,
            pairBudget: Number.POSITIVE_INFINITY,
            resolvePositions: true,
            applyNonPosition: false,
            resolveBoost: 1,
            detector: this.detector,
            scratchManifold: this.#scratchManifold,
            processObjectPair: this.#processObjectPairCallback,
            epsilon: EPSILON,
            pairStartToken: 0
        };
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
        this.#profileRecorder.setEnabled(this.#isProfilingEnabled());
        this.#enemyBodyCache.advanceFrame();
        this.#fixedFrameToken++;
        this.#pairPassCursor = 0;
        resetCollisionFrameStats(this.#frameStats);
    }

    /**
     * 마지막 고정 틱의 충돌 체크 카운트를 반환합니다.
     * @returns {object}
     */
    getFrameStats() {
        return createCollisionFrameStatsSnapshot(this.#frameStats);
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
     * contact와 본 solve가 공유할 enemy body geometry와 sleep snapshot을 준비합니다.
     * sleep/idle tick은 이 단계에서 변경하지 않습니다.
     * @param {object[]} enemies - 현재 fixed tick의 전체 적 목록입니다.
     * @param {{delta?:number}} [options] - fixed step 옵션입니다.
     * @returns {number} 준비한 활성 enemy body 수입니다.
     */
    prepareEnemyCollisionFrame(enemies, options = {}) {
        if (!Array.isArray(enemies)) {
            return 0;
        }

        const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
        return this.#buildFreshEnemyBodies(enemies, delta, true).length;
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
        const totalStart = this.#profileRecorder.startTimer();
        try {
            if (!Array.isArray(enemies)) return 0;

            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const maxIterations = this.#resolveIterationCount();
            const players = Array.isArray(options.players) ? options.players : [];

            const enemyBodyBuildStart = this.#profileRecorder.startTimer();
            const dynamicBodies = this.#enemyBodyCache.getReusable(enemies, delta, EPSILON)
                ?? this.#buildFreshEnemyBodies(enemies, delta, true);
            this.#advanceEnemySleepSnapshots(dynamicBodies);
            for (let i = 0; i < dynamicBodies.length; i++) {
                syncCollisionEnemyBodyResolveState(dynamicBodies[i], dynamicBodies[i].ref, EPSILON);
            }
            this.#profileRecorder.recordDuration('enemyBodyBuildMs', enemyBodyBuildStart);

            const playerBodyBuildStart = this.#profileRecorder.startTimer();
            const playerBodies = this.#buildPlayerBodies(players, delta);
            this.#profileRecorder.recordDuration('playerBodyBuildMs', playerBodyBuildStart);

            const wallBodyBuildStart = this.#profileRecorder.startTimer();
            const staticBodies = this.#buildWallBodies();
            this.#profileRecorder.recordDuration('wallBodyBuildMs', wallBodyBuildStart);
            if (dynamicBodies.length === 0 && playerBodies.length === 0) return 0;

            for (let i = 0; i < dynamicBodies.length; i++) {
                dynamicBodies[i]._candidatePairCount = 0;
                dynamicBodies[i]._resolvedPairCount = 0;
                dynamicBodies[i]._passPairProcessCount = 0;
                dynamicBodies[i]._frameResolveMoved = 0;
                resetCollisionEnemySleepObservation(dynamicBodies[i]);
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
            let densePressure = 0;
            this.#enemyCandidateScanTruncated = false;
            const positionPassCount = Math.min(maxIterations, DENSE_POSITION_SOLVE_MAX_PASSES);
            const positionSolveStart = this.#profileRecorder.startTimer();
            for (let i = 0; i < positionPassCount; i++) {
                const shouldRebuildGrid = i === 0 || i === 2;
                const resolveBoost = getCollisionResolvePassBoost(
                    i,
                    dynamicBodies.length,
                    densePressure
                );
                const resolved = this.#solveOnePass(
                    bodies,
                    true,
                    false,
                    shouldRebuildGrid,
                    resolveBoost,
                    dynamicBodies.length
                );
                this.#profileRecorder.recordCount('solvePassCount');
                if (shouldRebuildGrid) {
                    this.#profileRecorder.recordCount('solveGridRebuildCount');
                }
                totalResolved += resolved;
                if (i === 0) {
                    densePressure = getCollisionDensePressure(
                        resolved,
                        bodies.length,
                        getCollisionPeakCandidatePairs(dynamicBodies)
                    );
                    this.#profileRecorder.recordValue('solveDensePressure', densePressure);
                }
                if (resolved === 0) break;
            }
            this.#profileRecorder.recordDuration('enemyPositionSolveMs', positionSolveStart);

            for (let i = 0; i < dynamicBodies.length; i++) {
                const enemy = dynamicBodies[i].ref;
                if (this.#sleepPostSolveFrameByEnemy.get(enemy) === this.#fixedFrameToken) {
                    continue;
                }
                updateCollisionEnemyPostSolveSleepState(
                    enemy,
                    dynamicBodies[i],
                    COLLISION_IDLE_TICKS_TO_SLEEP,
                    COLLISION_SLEEP_TICKS,
                    !this.#enemyCandidateScanTruncated
                        && isCollisionEnemySleepObservationComplete(dynamicBodies[i])
                );
                this.#sleepPostSolveFrameByEnemy.set(enemy, this.#fixedFrameToken);
            }

            return totalResolved;
        } finally {
            this.#profileRecorder.recordDuration('enemyTotalMs', totalStart);
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
        const totalStart = this.#profileRecorder.startTimer();
        try {
            if (!Array.isArray(projectiles) || !Array.isArray(enemies)) return 0;
            if (projectiles.length === 0 || enemies.length === 0) return 0;

            const safeDelta = Math.max(delta, EPSILON);
            const enemyBodyBuildStart = this.#profileRecorder.startTimer();
            const enemyBodies = this.#enemyBodyCache.getReusable(enemies, safeDelta, EPSILON)
                ?? this.#buildFreshEnemyBodies(enemies, safeDelta, false);
            this.#profileRecorder.recordDuration('projectileEnemyBodyBuildMs', enemyBodyBuildStart);
            if (enemyBodies.length === 0) return 0;

            const gridBuildStart = this.#profileRecorder.startTimer();
            const enemyGridCellSize = this.#rebuildGridFromBodies(enemyBodies, 'projectile');
            this.#profileRecorder.recordDuration('projectileGridBuildMs', gridBuildStart);

            const baseSteps = this.#resolveIterationCount();
            let hitCount = 0;
            const projectileScanStart = this.#profileRecorder.startTimer();

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

                    const circleBody = writeCollisionProjectileSweepBody(
                        this.#scratchProjectileBody,
                        projectile,
                        cx,
                        cy,
                        EPSILON
                    );

                    const candidateQueryStart = this.#profileRecorder.startTimer();
                    const candidateIndices = this.#gridQueryBuffer.collectCandidateIndices(
                        this.#grid,
                        circleBody,
                        enemyGridCellSize,
                        enemyBodies.length
                    );
                    this.#profileRecorder.recordDuration('projectileCandidateQueryMs', candidateQueryStart);

                    const narrowphaseStart = this.#profileRecorder.startTimer();
                    for (let j = 0; j < candidateIndices.length; j++) {
                        const enemyBody = enemyBodies[candidateIndices[j]];
                        if (!enemyBody || enemyBody.ref?.active === false) continue;
                        const enemyId = enemyBody.id;
                        if (hasCollisionProjectileHit(projectile, enemyId)) continue;
                        this.#frameStats.collisionCheckCount++;
                        if (!areCollisionBodyAabbsOverlapping(circleBody, enemyBody)) {
                            this.#frameStats.aabbRejectCount++;
                            continue;
                        }
                        this.#frameStats.aabbPassCount++;
                        if (shouldUseCollisionBroadCircleFilter(circleBody, enemyBody)) {
                            if (!areCollisionBodyBroadCirclesOverlapping(circleBody, enemyBody, EPSILON)) {
                                this.#frameStats.circleRejectCount++;
                                continue;
                            }
                            this.#frameStats.circlePassCount++;
                        }

                        const manifold = detectCollisionBodies(circleBody, enemyBody, this.#bodyDetectorContext);
                        if (!manifold) continue;

                        markCollisionProjectileHit(projectile, enemyId);
                        applyCollisionProjectileImpact(projectile, enemyBody.ref, manifold);
                        hitCount++;
                        hitThisProjectile = true;
                        if (!projectile.piercing) break;
                    }
                    this.#profileRecorder.recordDuration('projectileNarrowphaseMs', narrowphaseStart);
                    if (hitThisProjectile && !projectile.piercing) break;
                }
            }
            this.#profileRecorder.recordDuration('projectileScanMs', projectileScanStart);

            return hitCount;
        } finally {
            this.#enemyBodyCache.invalidate();
            this.#profileRecorder.recordDuration('projectileTotalMs', totalStart);
        }
    }

    /**
     * 적 목록 중 실제로 접촉하고 있는 쌍을 exact 판정으로 수집합니다.
     * 충돌 통계에는 반영하지 않습니다.
     * @param {object[]} enemies
     * @param {{delta?: number}} [options]
     * @returns {{enemyA: object, enemyB: object}[]} 다음 contact 조회 전까지 유효한 재사용 결과 배열입니다.
     */
    collectEnemyContactPairs(enemies, options = {}) {
        const totalStart = this.#profileRecorder.startTimer();
        try {
            this.#resetContactPairResults();
            if (!Array.isArray(enemies) || enemies.length < 2) {
                return this.#contactPairs;
            }

            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const bodyBuildStart = this.#profileRecorder.startTimer();
            const bodies = this.#collectContactBodies(enemies, delta);
            this.#profileRecorder.recordDuration('contactBodyBuildMs', bodyBuildStart);
            if (bodies.length < 2) {
                return this.#contactPairs;
            }

            createCollisionBaseStatsSnapshot(this.#frameStats, this.#contactStatsSnapshot);
            try {
                const gridBuildStart = this.#profileRecorder.startTimer();
                this.#rebuildGridFromBodies(bodies, 'enemyPair');
                this.#profileRecorder.recordDuration('contactGridBuildMs', gridBuildStart);
                this.#buildContactCandidatePairsFromGrid(bodies);

                const pairScanStart = this.#profileRecorder.startTimer();
                const lowIndices = this.#candidatePairs.lowIndices;
                const highIndices = this.#candidatePairs.highIndices;
                for (let pairIndex = 0; pairIndex < this.#candidatePairs.count; pairIndex++) {
                    const bodyA = bodies[lowIndices[pairIndex]];
                    const bodyB = bodies[highIndices[pairIndex]];
                    if (!detectCollisionBodies(bodyA, bodyB, this.#bodyDetectorContext)) {
                        continue;
                    }

                    this.#appendContactPair(bodyA.ref, bodyB.ref);
                }
                this.#profileRecorder.recordDuration('contactPairScanMs', pairScanStart);

                return this.#contactPairs;
            } finally {
                restoreCollisionBaseStatsSnapshot(this.#frameStats, this.#contactStatsSnapshot);
            }
        } finally {
            this.#profileRecorder.recordDuration('contactTotalMs', totalStart);
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
     * @param {boolean} [resolvePositions=true] - 위치 해소 여부입니다.
     * @param {boolean} [applyNonPosition=false] - 비위치 효과 적용 여부입니다.
     * @param {boolean} [requestRebuildGrid=true] - grid 재구성 요청 여부입니다.
     * @param {number} [resolveBoost=1] - 위치 해소 강화 배율입니다.
     * @param {number} [gridBodyCount=bodies.length] - grid에 삽입할 앞쪽 body 개수입니다.
     * @returns {number}
     */
    #solveOnePass(
        bodies,
        resolvePositions = true,
        applyNonPosition = false,
        requestRebuildGrid = true,
        resolveBoost = 1,
        gridBodyCount = bodies.length
    ) {
        if (!bodies || bodies.length < 2) return 0;
        const safeResolveBoost = Number.isFinite(resolveBoost) && resolveBoost > 0
            ? resolveBoost
            : 1;
        const rebuildGrid = requestRebuildGrid !== false || this.#activeGridBuckets.length === 0;
        const bodyCount = bodies.length;

        const gridStart = this.#profileRecorder.startTimer();
        if (rebuildGrid) {
            this.#rebuildGridFromBodies(bodies, 'default', gridBodyCount);
        }
        // 후보 재사용 패스의 위치 해소는 broad-phase SoA도 함께 평행 이동하므로
        // 직전 rebuild가 만든 grid와 body 메타데이터를 그대로 유지합니다.
        this.#profileRecorder.recordDuration('solveGridMs', gridStart);

        const pairScanStart = this.#profileRecorder.startTimer();
        const shouldRebuildCandidatePairs = rebuildGrid || this.#candidatePairs.bodyCount !== bodyCount;
        if (shouldRebuildCandidatePairs) {
            const candidateBuildStart = this.#profileRecorder.startTimer();
            this.#buildCandidatePairsFromGrid(bodies, gridBodyCount);
            this.#profileRecorder.recordDuration('solveCandidateBuildMs', candidateBuildStart);
        }
        const pairProcessStart = this.#profileRecorder.startTimer();
        const resolvedCount = this.#processCandidatePairs(
            bodies,
            resolvePositions,
            applyNonPosition,
            safeResolveBoost
        );
        this.#profileRecorder.recordDuration('solvePairProcessMs', pairProcessStart);
        this.#profileRecorder.recordDuration('solvePairScanMs', pairScanStart);

        return resolvedCount;
    }

    /**
     * @private
     */
    #processPair(bodyA, bodyB, resolvePositions = true, applyNonPosition = false, resolveBoost = 1, pairRule = null) {
        if (areCollisionBodiesSameEntity(bodyA, bodyB)) return 0;

        const rule = pairRule ?? getCollisionPassRule(bodyA, bodyB, applyNonPosition);
        if (!rule) return 0;
        if (!rule.check) return 0;
        if (!rule.resolve && !applyNonPosition) return 0;

        if (resolvePositions) {
            bodyA._candidatePairCount = (bodyA._candidatePairCount || 0) + 1;
            bodyB._candidatePairCount = (bodyB._candidatePairCount || 0) + 1;
        }

        if (rule.oneShotByProjectile && applyNonPosition) {
            if (bodyA.kind === 'projectile' && hasCollisionProjectileHit(bodyA.ref, bodyB.id)) return 0;
            if (bodyB.kind === 'projectile' && hasCollisionProjectileHit(bodyB.ref, bodyA.id)) return 0;
        }

        const manifold = detectCollisionBodies(bodyA, bodyB, this.#bodyDetectorContext);
        if (!manifold) return 0;

        if (resolvePositions) {
            bodyA._resolvedPairCount = (bodyA._resolvedPairCount || 0) + 1;
            bodyB._resolvedPairCount = (bodyB._resolvedPairCount || 0) + 1;
        }

        if (rule.oneShotByProjectile && applyNonPosition) {
            if (bodyA.kind === 'projectile') markCollisionProjectileHit(bodyA.ref, bodyB.id);
            if (bodyB.kind === 'projectile') markCollisionProjectileHit(bodyB.ref, bodyA.id);
        }

        if (rule.applyImpactRotation && applyNonPosition) {
            if (bodyA.kind === 'projectile' && bodyB.kind === 'enemy') {
                applyCollisionProjectileImpact(bodyA.ref, bodyB.ref, manifold);
            } else if (bodyB.kind === 'projectile' && bodyA.kind === 'enemy') {
                applyCollisionProjectileImpact(bodyB.ref, bodyA.ref, manifold);
            }
        }

        if (!rule.resolve || !resolvePositions) return 1;

        applyCollisionPairResolution(
            this.detector,
            manifold,
            bodyA,
            bodyB,
            rule.movableA,
            rule.movableB,
            resolveBoost,
            this.#broadphaseBuffer
        );

        return 1;
    }

    /**
     * @private
     */
    #resetBodyPool() {
        this.#bodyPool.reset();
        this.#enemyBodyCache.invalidate();
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
            this.#enemyBodyCache.store(enemies, delta, bodies);
        }
        return bodies;
    }

    /**
     * 현재 grid bucket에서 유효 후보 pair 목록을 재구성합니다.
     * @private
     * @param {object[]} bodies
     * @param {number} enemyBodyCount - 배열 앞쪽의 enemy body 개수입니다.
     */
    #buildCandidatePairsFromGrid(bodies, enemyBodyCount) {
        const bodyCount = Array.isArray(bodies) ? bodies.length : 0;
        const safeEnemyBodyCount = Number.isFinite(enemyBodyCount)
            ? Math.min(bodyCount, Math.max(0, Math.floor(enemyBodyCount)))
            : bodyCount;
        this.#candidatePairs.reset(bodyCount);
        if (bodyCount < 2) {
            return;
        }

        const cellSize = this.#activeGridCellSize;
        const broadData = this.#broadphaseBuffer.broadData;
        const candidateSweepData = this.#broadphaseBuffer.candidateSweepData;
        const candidateSweepValidity = this.#broadphaseBuffer.candidateSweepValidity;
        const bodyKindCodes = this.#broadphaseBuffer.bodyKindCodes;
        const bodyShapeCodes = this.#broadphaseBuffer.bodyShapeCodes;
        const candidateScanEpoch = this.#enemyCandidateScanEpoch >>> 0;
        this.#enemyCandidateScanEpoch = (candidateScanEpoch + 1) >>> 0;
        const cellScanToken = candidateScanEpoch;
        let priorityAdmissionCount = 0;
        let predictiveAdmissionCount = 0;
        let admissionBudgetSkipCount = 0;
        let candidateVisitCount = 0;
        let scanTruncateCount = 0;
        let bucketPairCount = 0;
        let duplicatePairSkipCount = 0;
        let ruleRejectCount = 0;
        let candidatePairCount = 0;
        // grid에는 safeEnemyBodyCount 앞쪽 enemy body만 들어가므로 enemy-enemy 규칙 조회를 생략합니다.
        // getCollisionPassRule이 함께 보장하던 same-entity 차단은 inner loop에서 그대로 유지합니다.
        for (let low = 0; low < safeEnemyBodyCount - 1; low++) {
            const bodyA = bodies[low];
            const bodyARef = bodyA?.ref;
            const bodyAId = bodyA?.id;
            const hasComparableBodyAId = Number.isInteger(bodyAId) && bodyAId >= 0;
            const candidateOffsetA = low * CANDIDATE_SWEEP_STRIDE;
            const hasCandidateSweepA = candidateSweepValidity[low] === 1
                && bodyKindCodes[low] === BODY_KIND_ENEMY;
            const candidateMinAX = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.MIN_X];
            const candidateMaxAX = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.MAX_X];
            const candidateMinAY = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.MIN_Y];
            const candidateMaxAY = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.MAX_Y];
            const candidateCenterAX = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.CENTER_X];
            const candidateCenterAY = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.CENTER_Y];
            const candidateRadiusA = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.RADIUS];
            const candidatePadA = candidateSweepData[candidateOffsetA + CANDIDATE_SWEEP_INDEX.PAD];
            const bodyShapeCodeA = bodyShapeCodes[low];
            this.#candidatePairs.beginLowBody();
            let lowPriorityCount = 0;
            let lowPredictiveCount = 0;
            let lowCandidateVisitCount = 0;
            const lowCandidateVisitLimit = getCollisionEnemyCandidateVisitLimit(
                isCollisionHexaHiveWallBody(bodyA)
            );
            const broadOffset = low * BROAD_STRIDE;
            const minCellX = Math.floor(broadData[broadOffset] / cellSize);
            const maxCellX = Math.floor(broadData[broadOffset + 1] / cellSize);
            const minCellY = Math.floor(broadData[broadOffset + 2] / cellSize);
            const maxCellY = Math.floor(broadData[broadOffset + 3] / cellSize);

            const cellHeight = maxCellY - minCellY + 1;
            const cellCount = (maxCellX - minCellX + 1) * cellHeight;
            const lowCellScanToken = (cellScanToken + low) >>> 0;
            const cellStart = lowCellScanToken % cellCount;
            const bucketScanToken = getCollisionEnemyCandidateBucketScanToken(
                candidateScanEpoch,
                lowCandidateVisitLimit,
                cellCount,
                low
            );
            candidateCellLoop: for (let cellOffset = 0; cellOffset < cellCount; cellOffset++) {
                const cellIndex = (cellStart + cellOffset) % cellCount;
                const cx = minCellX + Math.floor(cellIndex / cellHeight);
                const cy = minCellY + (cellIndex % cellHeight);
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                const bucket = this.#grid.get(key);
                if (!bucket) continue;
                const bucketStart = (bucketScanToken + low + cellIndex) % bucket.count;
                for (let bucketOffset = 0; bucketOffset < bucket.count; bucketOffset++) {
                        const bucketIndex = (bucketStart + bucketOffset) % bucket.count;
                        const high = bucket.indices[bucketIndex];
                        if (high <= low) continue;
                        bucketPairCount++;
                        if (this.#candidatePairs.hasSeenHigh(high)) {
                            duplicatePairSkipCount++;
                            continue;
                        }
                        if (lowCandidateVisitCount >= lowCandidateVisitLimit) {
                            scanTruncateCount++;
                            break candidateCellLoop;
                        }
                        this.#candidatePairs.markSeenHigh(high);
                        lowCandidateVisitCount++;
                        candidateVisitCount++;

                        const bodyB = bodies[high];
                        if (!bodyA
                            || !bodyB
                            || (bodyARef && bodyARef === bodyB.ref)
                            || (hasComparableBodyAId && bodyAId === bodyB.id)) {
                            ruleRejectCount++;
                            continue;
                        }
                        const hasCandidateSweepB = candidateSweepValidity[high] === 1
                            && bodyKindCodes[high] === BODY_KIND_ENEMY;
                        let usesBroadCircle;
                        if (hasCandidateSweepA && hasCandidateSweepB) {
                            const candidateOffsetB = high * CANDIDATE_SWEEP_STRIDE;
                            if (!(candidateMinAX <= candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.MAX_X]
                                && candidateMaxAX >= candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.MIN_X]
                                && candidateMinAY <= candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.MAX_Y]
                                && candidateMaxAY >= candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.MIN_Y])) {
                                continue;
                            }

                            usesBroadCircle = bodyShapeCodeA !== BODY_SHAPE_CIRCLE
                                || bodyShapeCodes[high] !== BODY_SHAPE_CIRCLE;
                            if (usesBroadCircle) {
                                const dx = candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.CENTER_X]
                                    - candidateCenterAX;
                                const dy = candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.CENTER_Y]
                                    - candidateCenterAY;
                                const radiusSum = candidateRadiusA
                                    + candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.RADIUS]
                                    + candidatePadA
                                    + candidateSweepData[candidateOffsetB + CANDIDATE_SWEEP_INDEX.PAD]
                                    + EPSILON;
                                if (!(((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum))) {
                                    continue;
                                }
                            }
                        } else {
                            if (!areCollisionCandidateSweepAabbsOverlapping(bodyA, bodyB)) {
                                continue;
                            }
                            usesBroadCircle = shouldUseCollisionBroadCircleFilter(bodyA, bodyB);
                            if (usesBroadCircle
                                && !areCollisionCandidateSweepCirclesOverlapping(bodyA, bodyB, EPSILON)) {
                                continue;
                            }
                        }

                        const isAnchorPair = (
                            isCollisionEnemyPairAnchorBody(bodyA, bodyB)
                            || isCollisionEnemyPairAnchorBody(bodyB, bodyA)
                        );
                        const isCurrentOverlap = areCollisionBodyAabbsOverlapping(bodyA, bodyB)
                            && (!usesBroadCircle
                                || areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, EPSILON));
                        const priority = isCurrentOverlap || isAnchorPair;
                        if (!shouldAdmitCollisionEnemyCandidate(
                            lowPriorityCount,
                            lowPredictiveCount,
                            priority,
                            isAnchorPair
                        )) {
                            markCollisionEnemySleepObservationIncomplete(bodyA, bodyB);
                            admissionBudgetSkipCount++;
                            continue;
                        }
                        if (priority) {
                            lowPriorityCount++;
                            priorityAdmissionCount++;
                        } else {
                            lowPredictiveCount++;
                            predictiveAdmissionCount++;
                        }
                        this.#candidatePairs.append(
                            low,
                            high,
                            priority
                        );
                        candidatePairCount++;
                }
            }
        }

        const guaranteedPairCount = this.#appendGuaranteedNonEnemyPairs(
            bodies,
            safeEnemyBodyCount
        );
        this.#profileRecorder.recordCount('solveGuaranteedPairCount', guaranteedPairCount);
        this.#profileRecorder.recordCount('solvePriorityAdmissionCount', priorityAdmissionCount);
        this.#profileRecorder.recordCount('solvePredictiveAdmissionCount', predictiveAdmissionCount);
        this.#profileRecorder.recordCount('solveAdmissionBudgetSkipCount', admissionBudgetSkipCount);
        this.#profileRecorder.recordCount('solveCandidateVisitCount', candidateVisitCount);
        this.#profileRecorder.recordCount('solveScanTruncateCount', scanTruncateCount);
        if (scanTruncateCount > 0) {
            this.#enemyCandidateScanTruncated = true;
        }
        this.#profileRecorder.recordCount('solveBucketPairCount', bucketPairCount);
        this.#profileRecorder.recordCount('solveDuplicatePairSkipCount', duplicatePairSkipCount);
        this.#profileRecorder.recordCount('solveRuleRejectCount', ruleRejectCount);
        this.#profileRecorder.recordCount('solveCandidatePairCount', candidatePairCount);
    }

    /**
     * enemy grid 예산과 무관하게 player·wall을 포함한 pair를 보존합니다.
     * @private
     * @param {object[]} bodies - 전체 충돌 body 목록입니다.
     * @param {number} enemyBodyCount - 배열 앞쪽의 enemy body 개수입니다.
     * @returns {number} 추가한 보장 pair 수입니다.
     */
    #appendGuaranteedNonEnemyPairs(bodies, enemyBodyCount) {
        let appendedCount = 0;
        for (let high = enemyBodyCount; high < bodies.length; high++) {
            const bodyB = bodies[high];
            const candidateIndices = this.#gridQueryBuffer.collectCandidateIndices(
                this.#grid,
                bodyB,
                this.#activeGridCellSize,
                enemyBodyCount
            );
            for (let candidateIndex = 0; candidateIndex < candidateIndices.length; candidateIndex++) {
                const low = candidateIndices[candidateIndex];
                const bodyA = bodies[low];
                const rule = getCollisionPassRule(bodyA, bodyB, true);
                if (!rule || !areCollisionCandidateSweepAabbsOverlapping(bodyA, bodyB)) {
                    continue;
                }
                if (shouldUseCollisionBroadCircleFilter(bodyA, bodyB)
                    && !areCollisionCandidateSweepCirclesOverlapping(bodyA, bodyB, EPSILON)) {
                    continue;
                }
                this.#candidatePairs.append(low, high, true);
                appendedCount++;
            }
        }

        for (let low = enemyBodyCount; low < bodies.length - 1; low++) {
            for (let high = low + 1; high < bodies.length; high++) {
                const bodyA = bodies[low];
                const bodyB = bodies[high];
                const rule = getCollisionPassRule(bodyA, bodyB, true);
                if (!rule || !areCollisionCandidateSweepAabbsOverlapping(bodyA, bodyB)) {
                    continue;
                }
                if (shouldUseCollisionBroadCircleFilter(bodyA, bodyB)
                    && !areCollisionCandidateSweepCirclesOverlapping(bodyA, bodyB, EPSILON)) {
                    continue;
                }
                this.#candidatePairs.append(low, high, true);
                appendedCount++;
            }
        }
        return appendedCount;
    }

    /**
     * contact 관계 grid에서 exact 판정 전에 필요한 현재 중첩 pair만 수집합니다.
     * @private
     * @param {object[]} bodies - contact 대상 enemy body 목록입니다.
     */
    #buildContactCandidatePairsFromGrid(bodies) {
        const bodyCount = bodies.length;
        this.#candidatePairs.reset(bodyCount);
        const cellSize = this.#activeGridCellSize;
        const broadData = this.#broadphaseBuffer.broadData;
        for (let low = 0; low < bodyCount - 1; low++) {
            this.#candidatePairs.beginLowBody();
            const broadOffset = low * BROAD_STRIDE;
            const minCellX = Math.floor(broadData[broadOffset] / cellSize);
            const maxCellX = Math.floor(broadData[broadOffset + 1] / cellSize);
            const minCellY = Math.floor(broadData[broadOffset + 2] / cellSize);
            const maxCellY = Math.floor(broadData[broadOffset + 3] / cellSize);

            for (let cx = minCellX; cx <= maxCellX; cx++) {
                for (let cy = minCellY; cy <= maxCellY; cy++) {
                    const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                    const bucket = this.#grid.get(key);
                    if (!bucket) continue;
                    for (let bucketIndex = 0; bucketIndex < bucket.count; bucketIndex++) {
                        const high = bucket.indices[bucketIndex];
                        if (high <= low || this.#candidatePairs.hasSeenHigh(high)) continue;
                        this.#candidatePairs.markSeenHigh(high);

                        const bodyA = bodies[low];
                        const bodyB = bodies[high];
                        if (!bodyA || !bodyB || bodyA.ref === bodyB.ref) continue;
                        if (!areCollisionBodyAabbsOverlapping(bodyA, bodyB)) continue;
                        if (shouldUseCollisionBroadCircleFilter(bodyA, bodyB)
                            && !areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, EPSILON)) {
                            continue;
                        }
                        this.#candidatePairs.append(low, high);
                    }
                }
            }
        }
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
        const pairBudget = getCollisionEnemyPairProcessBudget(resolvePositions, applyNonPosition, resolveBoost);
        resetCollisionPassPairProcessCounts(bodies);
        const context = this.#pairProcessContext;
        context.bodies = bodies;
        context.pairBudget = pairBudget;
        context.resolvePositions = resolvePositions;
        context.applyNonPosition = applyNonPosition;
        context.resolveBoost = resolveBoost;
        context.pairStartToken = this.#fixedFrameToken + this.#pairPassCursor;
        this.#pairPassCursor++;
        return processCollisionCandidatePairs(context);
    }

    /**
     * @private
     */
    #insertBodyToGridSoA(index, cellSize) {
        const o = index * BROAD_STRIDE;
        const bd = this.#broadphaseBuffer.broadData;
        const minCellX = Math.floor(bd[o + 0] / cellSize);
        const maxCellX = Math.floor(bd[o + 1] / cellSize);
        const minCellY = Math.floor(bd[o + 2] / cellSize);
        const maxCellY = Math.floor(bd[o + 3] / cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                let bucket = this.#grid.get(key);
                if (!bucket) {
                    bucket = this.#gridBucketPool.acquire();
                    this.#grid.set(key, bucket);
                    this.#activeGridBuckets.push(bucket);
                }
                this.#gridBucketPool.pushIndex(bucket, index);
            }
        }
    }

    /**
     * @private
     */
    #clearGrid() {
        this.#gridBucketPool.resetActiveBuckets(this.#activeGridBuckets);
        this.#grid.clear();
    }

    /**
     * body 배열 기준으로 broad-phase SoA와 grid를 다시 구성합니다.
     * @private
     * @param {object[]} bodies
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default']
     * @param {number} [gridBodyCount=bodies.length] - grid에 삽입할 앞쪽 body 개수입니다.
     * @returns {number} 재구성에 사용한 grid cell size
     */
    #rebuildGridFromBodies(bodies, gridMode = 'default', gridBodyCount = bodies.length) {
        const safeGridBodyCount = Number.isFinite(gridBodyCount)
            ? Math.min(bodies.length, Math.max(0, Math.floor(gridBodyCount)))
            : bodies.length;
        this.#broadphaseBuffer.ensure(bodies.length);
        if (gridMode === 'projectile') {
            for (let i = 0; i < bodies.length; i++) {
                this.#broadphaseBuffer.writeProjectileGrid(i, bodies[i]);
            }
        } else {
            for (let i = 0; i < bodies.length; i++) {
                this.#broadphaseBuffer.write(i, bodies[i], gridMode);
            }
        }

        const cellSize = estimateCollisionGridCellSize(bodies, gridMode, safeGridBodyCount);
        this.#activeGridCellSize = cellSize;
        this.#clearGrid();
        for (let i = 0; i < safeGridBodyCount; i++) {
            this.#insertBodyToGridSoA(i, cellSize);
        }

        return cellSize;
    }

    /**
     * 준비된 enemy frame에서 contact 대상 body view를 만들고, 없으면 전용 풀에서 읽기 전용으로 구성합니다.
     * @private
     * @param {object[]} enemies - contact 대상 적 목록입니다.
     * @param {number} delta - fixed step delta입니다.
     * @returns {object[]} contact body view입니다.
     */
    #collectContactBodies(enemies, delta) {
        const out = this.#contactBodiesBuffer;
        if (this.#enemyBodyCache.collectReusableBodies(enemies, delta, EPSILON, out)) {
            return out;
        }

        this.#contactBodyPool.reset();
        out.length = 0;
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || enemy.active === false) continue;
            const sleeping = readCollisionEnemySleepState(
                enemy,
                delta,
                EPSILON,
                COLLISION_SLEEP_SPEED_SQ
            );
            const body = this.#contactBodyPool.acquire();
            if (writeCollisionEnemyBody(
                body,
                enemy,
                delta,
                sleeping,
                COLLISION_ENEMY_BODY_BUILD_OPTIONS
            )) {
                out.push(body);
            }
        }
        return out;
    }

    /**
     * 이전 contact 결과 record 참조를 비우고 결과 배열을 재사용 상태로 되돌립니다.
     * @private
     */
    #resetContactPairResults() {
        for (let i = 0; i < this.#contactPairs.length; i++) {
            const pair = this.#contactPairs[i];
            pair.enemyA = null;
            pair.enemyB = null;
        }
        this.#contactPairs.length = 0;
    }

    /**
     * contact 결과 record를 재사용해 한 쌍을 추가합니다.
     * @private
     * @param {object} enemyA - 첫 번째 접촉 적입니다.
     * @param {object} enemyB - 두 번째 접촉 적입니다.
     */
    #appendContactPair(enemyA, enemyB) {
        const resultIndex = this.#contactPairs.length;
        let pair = this.#contactPairRecords[resultIndex];
        if (!pair) {
            pair = { enemyA: null, enemyB: null };
            this.#contactPairRecords.push(pair);
        }
        pair.enemyA = enemyA;
        pair.enemyB = enemyB;
        this.#contactPairs.push(pair);
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

            const sleeping = readCollisionEnemySleepState(
                enemy,
                delta,
                EPSILON,
                COLLISION_SLEEP_SPEED_SQ
            );

            const body = this.#buildEnemyBody(enemy, delta, sleeping);
            if (body) bodies.push(body);
        }
        return bodies;
    }

    /**
     * 준비된 sleep snapshot을 적마다 fixed frame당 한 번만 전진시킵니다.
     * @private
     * @param {object[]} bodies - 준비된 enemy body 목록입니다.
     */
    #advanceEnemySleepSnapshots(bodies) {
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            const enemy = body?.ref;
            if (!enemy || this.#sleepAdvanceFrameByEnemy.get(enemy) === this.#fixedFrameToken) {
                continue;
            }
            advanceCollisionEnemySleepState(enemy, body._sleeping === true);
            this.#sleepAdvanceFrameByEnemy.set(enemy, this.#fixedFrameToken);
        }
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

            const body = this.#bodyPool.acquire();
            if (writeCollisionPlayerBody(body, player, delta, COLLISION_PLAYER_BODY_BUILD_OPTIONS)) {
                bodies.push(body);
            }
        }
        return bodies;
    }

    /**
     * @private
     */
    #buildEnemyBody(enemy, delta, sleeping = false) {
        const body = this.#bodyPool.acquire();
        return writeCollisionEnemyBody(
            body,
            enemy,
            delta,
            sleeping,
            COLLISION_ENEMY_BODY_BUILD_OPTIONS
        )
            ? body
            : null;
    }

    /**
     * @private
     */
    #buildWallBodies() {
        const out = this.#wallBodiesCache;
        if (!this.#wallBodiesDirty) {
            return out;
        }

        writeCollisionWallBodies(out, this.walls);
        this.#wallBodiesDirty = false;
        return out;
    }
}

/**
 * 접촉 pair 조회가 프레임 충돌 기본 통계를 오염시키지 않도록 현재 값을 복사합니다.
 * @param {object} frameStats - 현재 프레임 통계 객체입니다.
 * @param {object} out - 값을 기록할 재사용 스냅샷입니다.
 * @returns {object} 기본 통계 필드 스냅샷입니다.
 */
function createCollisionBaseStatsSnapshot(frameStats, out) {
    const snapshot = out;
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_BASE_STAT_FIELDS[i];
        snapshot[fieldName] = frameStats[fieldName];
    }
    return snapshot;
}

/**
 * 접촉 pair 조회 전에 저장한 프레임 충돌 기본 통계를 복원합니다.
 * @param {object} frameStats - 복원 대상 프레임 통계 객체입니다.
 * @param {object} snapshot - 기본 통계 필드 스냅샷입니다.
 */
function restoreCollisionBaseStatsSnapshot(frameStats, snapshot) {
    for (let i = 0; i < COLLISION_BASE_STAT_FIELDS.length; i++) {
        const fieldName = COLLISION_BASE_STAT_FIELDS[i];
        frameStats[fieldName] = snapshot[fieldName];
    }
}

/**
 * 현재 relation AABB와 fixed frame sweep AABB의 합집합이 겹치는지 반환합니다.
 * 후보 목록을 solve pass에서 재사용해도 frame 내 이동으로 새 pair가 누락되지 않도록 보수적으로 판정합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @returns {boolean} frame 중 겹칠 가능성이 있으면 true입니다.
 */
function areCollisionCandidateSweepAabbsOverlapping(bodyA, bodyB) {
    const isEnemyPair = bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy';
    const minAX = getCollisionCandidateSweepBound(bodyA, isEnemyPair, 'minX', 'enemyPairMinX', 'sweepMinX', true);
    const maxAX = getCollisionCandidateSweepBound(bodyA, isEnemyPair, 'maxX', 'enemyPairMaxX', 'sweepMaxX', false);
    const minAY = getCollisionCandidateSweepBound(bodyA, isEnemyPair, 'minY', 'enemyPairMinY', 'sweepMinY', true);
    const maxAY = getCollisionCandidateSweepBound(bodyA, isEnemyPair, 'maxY', 'enemyPairMaxY', 'sweepMaxY', false);
    const minBX = getCollisionCandidateSweepBound(bodyB, isEnemyPair, 'minX', 'enemyPairMinX', 'sweepMinX', true);
    const maxBX = getCollisionCandidateSweepBound(bodyB, isEnemyPair, 'maxX', 'enemyPairMaxX', 'sweepMaxX', false);
    const minBY = getCollisionCandidateSweepBound(bodyB, isEnemyPair, 'minY', 'enemyPairMinY', 'sweepMinY', true);
    const maxBY = getCollisionCandidateSweepBound(bodyB, isEnemyPair, 'maxY', 'enemyPairMaxY', 'sweepMaxY', false);
    return minAX <= maxBX && maxAX >= minBX && minAY <= maxBY && maxAY >= minBY;
}

/**
 * relation 현재 bound와 sweep bound를 합친 한 축 값을 반환합니다.
 * @param {object} body - 대상 body입니다.
 * @param {boolean} useEnemyPairBound - enemyPair bound 사용 여부입니다.
 * @param {string} baseField - 기본 bound 필드입니다.
 * @param {string} relationField - enemyPair bound 필드입니다.
 * @param {string} sweepField - sweep bound 필드입니다.
 * @param {boolean} useMinimum - 최솟값을 선택할지 여부입니다.
 * @returns {number} 보수적 sweep bound입니다.
 */
function getCollisionCandidateSweepBound(
    body,
    useEnemyPairBound,
    baseField,
    relationField,
    sweepField,
    useMinimum
) {
    const baseValue = useEnemyPairBound && Number.isFinite(body?.[relationField])
        ? body[relationField]
        : body?.[baseField];
    const sweepValue = Number.isFinite(body?.[sweepField]) ? body[sweepField] : baseValue;
    const sweepDelta = (sweepValue - baseValue) * COLLISION_CANDIDATE_SWEEP_PAD_SCALE;
    const expandedSweepValue = baseValue + sweepDelta;
    return useMinimum
        ? Math.min(baseValue, expandedSweepValue)
        : Math.max(baseValue, expandedSweepValue);
}

/**
 * relation broad circle을 frame sweep 이동 상한만큼 확장해 겹침 가능성을 반환합니다.
 * @param {object} bodyA - 첫 번째 body입니다.
 * @param {object} bodyB - 두 번째 body입니다.
 * @param {number} epsilon - 반경 보정값입니다.
 * @returns {boolean} frame 중 broad circle이 겹칠 가능성이 있으면 true입니다.
 */
function areCollisionCandidateSweepCirclesOverlapping(bodyA, bodyB, epsilon) {
    const ax = Number.isFinite(bodyA?.centerX) ? bodyA.centerX : bodyA?.x;
    const ay = Number.isFinite(bodyA?.centerY) ? bodyA.centerY : bodyA?.y;
    const bx = Number.isFinite(bodyB?.centerX) ? bodyB.centerX : bodyB?.x;
    const by = Number.isFinite(bodyB?.centerY) ? bodyB.centerY : bodyB?.y;
    const radiusA = getCollisionCandidateRelationRadius(bodyA, bodyB);
    const radiusB = getCollisionCandidateRelationRadius(bodyB, bodyA);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)
        || !Number.isFinite(radiusA) || radiusA <= 0 || !Number.isFinite(radiusB) || radiusB <= 0) {
        return true;
    }

    const radiusSum = radiusA
        + radiusB
        + getCollisionCandidateSweepPad(bodyA)
        + getCollisionCandidateSweepPad(bodyB)
        + epsilon;
    const dx = bx - ax;
    const dy = by - ay;
    return ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
}

/**
 * pair 관계에 맞는 broad circle 반경을 반환합니다.
 * @param {object} body - 대상 body입니다.
 * @param {object} otherBody - 상대 body입니다.
 * @returns {number} 관계 broad 반경입니다.
 */
function getCollisionCandidateRelationRadius(body, otherBody) {
    if (body?.kind === 'enemy' && otherBody?.kind === 'enemy' && Number.isFinite(body.enemyPairBroadRadius)) {
        return body.enemyPairBroadRadius;
    }
    if (body?.kind === 'enemy' && otherBody?.kind === 'projectile' && Number.isFinite(body.projectileBroadRadius)) {
        return body.projectileBroadRadius;
    }
    if (body?.shape === 'circle' && Number.isFinite(body.radius)) {
        return body.radius;
    }
    return Number.isFinite(body?.broadRadius) ? body.broadRadius : body?.boundRadius;
}

/**
 * 현재 AABB에서 sweep AABB까지의 최대 축 확장량을 반환합니다.
 * @param {object} body - 대상 body입니다.
 * @returns {number} 보수적 중심 이동 여유입니다.
 */
function getCollisionCandidateSweepPad(body) {
    const padLeft = Number.isFinite(body?.sweepMinX) && Number.isFinite(body?.minX)
        ? Math.max(0, body.minX - body.sweepMinX)
        : 0;
    const padRight = Number.isFinite(body?.sweepMaxX) && Number.isFinite(body?.maxX)
        ? Math.max(0, body.sweepMaxX - body.maxX)
        : 0;
    const padTop = Number.isFinite(body?.sweepMinY) && Number.isFinite(body?.minY)
        ? Math.max(0, body.minY - body.sweepMinY)
        : 0;
    const padBottom = Number.isFinite(body?.sweepMaxY) && Number.isFinite(body?.maxY)
        ? Math.max(0, body.sweepMaxY - body.maxY)
        : 0;
    return Math.max(padLeft, padRight, padTop, padBottom) * COLLISION_CANDIDATE_SWEEP_PAD_SCALE;
}
