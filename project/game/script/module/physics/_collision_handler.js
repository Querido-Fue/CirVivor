import { getData } from 'data/data_handler.js';
import { CollisionDetector } from './_collision_detector.js';
import {
    areCollisionEnemyPairAnchors,
    COLLISION_RESOLVE_FRAME_MAX_RATIO,
    COLLISION_RESOLVE_FRAME_MIN_MAX,
    DENSE_ADAPTIVE_DENSITY_SCALE,
    DENSE_ADAPTIVE_LIGHT_DENSITY_THRESHOLD,
    DENSE_ADAPTIVE_MIN_ITERATIONS,
    DENSE_LOCAL_CANDIDATE_THRESHOLD,
    DENSE_REBUILD_DENSITY_THRESHOLD,
    DENSE_REBUILD_MIN_RESOLVED,
    DENSE_STABILIZE_HEAVY_CANDIDATE_SCALE,
    DENSE_STABILIZE_MIN_RESOLVED,
    getDenseSolveTuning
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
import { CollisionCandidatePairBuffer } from './collision_candidate_pair_buffer.js';
import { getCollisionPeakCandidatePairs } from './collision_candidate_density.js';
import { processCollisionCandidatePairs } from './collision_candidate_pair_processor.js';
import { CollisionEnemyBodyCache } from './collision_enemy_body_cache.js';
import {
    getCollisionEnemyPairProcessBudget,
    resetCollisionPassPairProcessCounts
} from './collision_enemy_pair_budget.js';
import {
    updateCollisionEnemyPostSolveSleepState,
    updateCollisionEnemySleepState
} from './collision_enemy_sleep_state.js';
import { writeCollisionEnemyBody } from './collision_enemy_body_builder.js';
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
    COLLISION_BROAD_STRIDE as BROAD_STRIDE
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
    #enemyBodiesBuffer;
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

    constructor() {
        this.detector = new CollisionDetector();
        this.walls = [];
        this.#grid = new Map();
        this.#tempBodies = [];
        this.#wallBodiesCache = [];
        this.#wallBodiesDirty = true;
        this.#frameStats = createCollisionFrameStats();
        this.#bodyPool = new CollisionBodyPool();
        this.#enemyBodiesBuffer = [];
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
        this.#bodyDetectorContext = {
            manifold: this.#scratchManifold,
            candidateManifold: this.#scratchCandidateManifold,
            bestManifold: this.#scratchBestManifold,
            profileRecorder: this.#profileRecorder
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
            if (!Array.isArray(enemies) || enemies.length === 0) return 0;

            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const maxIterations = this.#resolveIterationCount();
            const players = Array.isArray(options.players) ? options.players : [];

            const enemyBodyBuildStart = this.#profileRecorder.startTimer();
            const dynamicBodies = this.#buildFreshEnemyBodies(enemies, delta, true);
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
                this.#profileRecorder.recordCount('solveLargePopulationMode');
            }
            const positionSolveStart = this.#profileRecorder.startTimer();
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
                if (i === 0 && maxIterations > DENSE_ADAPTIVE_MIN_ITERATIONS) {
                    const density = resolved / Math.max(1, bodies.length);
                    peakCandidatePairs = getCollisionPeakCandidatePairs(dynamicBodies);
                    const localDense = peakCandidatePairs >= DENSE_LOCAL_CANDIDATE_THRESHOLD;
                    if (density < DENSE_ADAPTIVE_LIGHT_DENSITY_THRESHOLD && !localDense) {
                        adaptiveMax = Math.max(
                            DENSE_ADAPTIVE_MIN_ITERATIONS,
                            Math.ceil(maxIterations * Math.min(1, density * DENSE_ADAPTIVE_DENSITY_SCALE))
                        );
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
            this.#profileRecorder.recordDuration('enemyPositionSolveMs', positionSolveStart);

            if (denseMode && lastResolved >= DENSE_STABILIZE_MIN_RESOLVED) {
                const stabilizeStart = this.#profileRecorder.startTimer();
                const stabilizeMaxPasses = peakCandidatePairs >= (
                    DENSE_LOCAL_CANDIDATE_THRESHOLD * DENSE_STABILIZE_HEAVY_CANDIDATE_SCALE
                )
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
                this.#profileRecorder.recordDuration('enemyStabilizeMs', stabilizeStart);
            }

            for (let i = 0; i < dynamicBodies.length; i++) {
                const enemy = dynamicBodies[i].ref;
                updateCollisionEnemyPostSolveSleepState(enemy, dynamicBodies[i], {
                    idleTicksToSleep: COLLISION_IDLE_TICKS_TO_SLEEP,
                    sleepTicks: COLLISION_SLEEP_TICKS
                });
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
     * @returns {{enemyA: object, enemyB: object}[]}
     */
    collectEnemyContactPairs(enemies, options = {}) {
        const totalStart = this.#profileRecorder.startTimer();
        try {
            if (!Array.isArray(enemies) || enemies.length < 2) {
                return [];
            }

            this.#resetBodyPool();
            const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
            const bodyBuildStart = this.#profileRecorder.startTimer();
            const bodies = this.#buildEnemyBodies(enemies, delta);
            this.#profileRecorder.recordDuration('contactBodyBuildMs', bodyBuildStart);
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

            const gridBuildStart = this.#profileRecorder.startTimer();
            this.#rebuildGridFromBodies(bodies, 'enemyPair');
            this.#profileRecorder.recordDuration('contactGridBuildMs', gridBuildStart);
            this.#candidatePairs.reset(bodies.length);
            const contactPairs = [];
            const gridBuckets = this.#activeGridBuckets;

            const pairScanStart = this.#profileRecorder.startTimer();
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
                        if (this.#candidatePairs.hasPair(low, high)) {
                            continue;
                        }
                        this.#candidatePairs.markPair(low, high);

                        const bodyA = bodies[low];
                        const bodyB = bodies[high];
                        if (!bodyA || !bodyB || bodyA.ref === bodyB.ref) {
                            continue;
                        }

                        if (!areCollisionBodyAabbsOverlapping(bodyA, bodyB)) {
                            continue;
                        }

                        if (
                            shouldUseCollisionBroadCircleFilter(bodyA, bodyB) &&
                            !areCollisionBodyBroadCirclesOverlapping(bodyA, bodyB, EPSILON)
                        ) {
                            continue;
                        }

                        if (!detectCollisionBodies(bodyA, bodyB, this.#bodyDetectorContext)) {
                            continue;
                        }

                        contactPairs.push({
                            enemyA: bodyA.ref,
                            enemyB: bodyB.ref
                        });
                    }
                }
            }
            this.#profileRecorder.recordDuration('contactPairScanMs', pairScanStart);

            this.#frameStats.collisionCheckCount = savedStats.collisionCheckCount;
            this.#frameStats.aabbPassCount = savedStats.aabbPassCount;
            this.#frameStats.aabbRejectCount = savedStats.aabbRejectCount;
            this.#frameStats.circlePassCount = savedStats.circlePassCount;
            this.#frameStats.circleRejectCount = savedStats.circleRejectCount;
            this.#frameStats.partChecks = savedStats.partChecks;
            return contactPairs;
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

        const gridStart = this.#profileRecorder.startTimer();
        if (rebuildGrid) {
            this.#rebuildGridFromBodies(bodies);
        } else {
            this.#broadphaseBuffer.ensure(bodyCount);
            for (let i = 0; i < bodyCount; i++) {
                this.#broadphaseBuffer.write(i, bodies[i]);
            }
        }
        this.#profileRecorder.recordDuration('solveGridMs', gridStart);

        const pairScanStart = this.#profileRecorder.startTimer();
        const shouldRebuildCandidatePairs = rebuildGrid || this.#candidatePairs.bodyCount !== bodyCount;
        if (shouldRebuildCandidatePairs) {
            const candidateBuildStart = this.#profileRecorder.startTimer();
            this.#buildCandidatePairsFromGrid(bodies);
            this.#profileRecorder.recordDuration('solveCandidateBuildMs', candidateBuildStart);
        }
        const pairProcessStart = this.#profileRecorder.startTimer();
        const resolvedCount = this.#processCandidatePairs(
            bodies,
            resolvePositions,
            applyNonPosition,
            resolveBoost
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

        if (areCollisionEnemyPairAnchors(bodyA, bodyB)) {
            return 0;
        }

        applyCollisionPairResolution(this.detector, manifold, bodyA, bodyB, {
            movableA: rule.movableA,
            movableB: rule.movableB,
            resolveBoost,
            broadphaseBuffer: this.#broadphaseBuffer
        });

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
     */
    #buildCandidatePairsFromGrid(bodies) {
        const bodyCount = Array.isArray(bodies) ? bodies.length : 0;
        this.#candidatePairs.reset(bodyCount);
        if (bodyCount < 2) {
            return;
        }
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
                    this.#profileRecorder.recordCount('solveBucketPairCount');

                    const rule = getCollisionPassRule(bodies[low], bodies[high], true);
                    if (!rule) {
                        this.#profileRecorder.recordCount('solveRuleRejectCount');
                        continue;
                    }
                    if (this.#candidatePairs.hasPair(low, high)) {
                        this.#profileRecorder.recordCount('solveDuplicatePairSkipCount');
                        continue;
                    }

                    this.#candidatePairs.markPair(low, high);
                    this.#candidatePairs.append(low, high);
                    this.#profileRecorder.recordCount('solveCandidatePairCount');
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
        return processCollisionCandidatePairs({
            bodies,
            candidatePairs: this.#candidatePairs,
            broadphaseBuffer: this.#broadphaseBuffer,
            frameStats: this.#frameStats,
            profileRecorder: this.#profileRecorder,
            pairBudget,
            resolvePositions,
            applyNonPosition,
            resolveBoost,
            detector: this.detector,
            scratchManifold: this.#scratchManifold,
            processObjectPair: this.#processPair.bind(this),
            epsilon: EPSILON
        });
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
     * @returns {number} 재구성에 사용한 grid cell size
     */
    #rebuildGridFromBodies(bodies, gridMode = 'default') {
        this.#broadphaseBuffer.ensure(bodies.length);
        for (let i = 0; i < bodies.length; i++) {
            this.#broadphaseBuffer.write(i, bodies[i], gridMode);
        }

        const cellSize = estimateCollisionGridCellSize(bodies, gridMode);
        this.#clearGrid();
        for (let i = 0; i < bodies.length; i++) {
            this.#insertBodyToGridSoA(i, cellSize);
        }

        return cellSize;
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

            const sleeping = updateCollisionEnemySleepState(enemy, delta, {
                epsilon: EPSILON,
                sleepSpeedSq: COLLISION_SLEEP_SPEED_SQ
            });

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

            const body = this.#bodyPool.acquire();
            if (writeCollisionPlayerBody(body, player, delta, {
                epsilon: EPSILON,
                frameResolveMinMax: COLLISION_RESOLVE_FRAME_MIN_MAX,
                frameResolveMaxRatio: COLLISION_RESOLVE_FRAME_MAX_RATIO
            })) {
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
        return writeCollisionEnemyBody(body, enemy, delta, sleeping, {
            epsilon: EPSILON,
            frameResolveMinMax: COLLISION_RESOLVE_FRAME_MIN_MAX,
            frameResolveMaxRatio: COLLISION_RESOLVE_FRAME_MAX_RATIO
        })
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
