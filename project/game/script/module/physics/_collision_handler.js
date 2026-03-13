import { getObjectWH } from 'display/display_system.js';
import { getSetting } from 'save/save_system.js';
import { CollisionDetector } from './_collision_detector.js';

const EPSILON = 1e-6;
const CELL_KEY_OFFSET = 4096;
const CELL_KEY_STRIDE = 8192;
const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 280;
const BROAD_STRIDE = 14;
const GRID_BUCKET_INITIAL_CAPACITY = 8;
const ROTATION_IMPULSE_SCALE = 0.12;
const ROTATION_RESPONSE_MULTIPLIER = 1.3;
const COLLISION_RESOLVE_PERCENT = 0.55;
const COLLISION_RESOLVE_SLOP = 0.8;
const COLLISION_RESOLVE_MAX_RATIO = 0.16;
const COLLISION_RESOLVE_MIN_MAX = 1.25;
const COLLISION_RESOLVE_FRAME_MAX_RATIO = 0.42;
const COLLISION_RESOLVE_FRAME_MIN_MAX = 2.2;
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
const COLLISION_BROAD_RADIUS_SCALE_ENEMY = 1.08;
const COLLISION_BROAD_RADIUS_SCALE_DEFAULT = 1.03;
const DENSE_REBUILD_DENSITY_THRESHOLD = 0.45;
const DENSE_REBUILD_MIN_RESOLVED = 8;
const DENSE_REBUILD_MAX_EXTRA_PASSES = 4;
const DENSE_MIN_ITERATION_FLOOR = 5;
const DENSE_LOCAL_CANDIDATE_THRESHOLD = 8;
const DENSE_STABILIZE_MAX_PASSES = 4;
const DENSE_STABILIZE_MIN_RESOLVED = 4;
const DENSE_RESOLVE_BOOST = 1.55;
const DENSE_CORRECTION_CANDIDATE_THRESHOLD = 5;
const DENSE_CORRECTION_SCALE_PER_NEIGHBOR = 0.06;
const DENSE_CORRECTION_SCALE_MAX = 2.4;
const DENSE_FRAME_CANDIDATE_THRESHOLD = 6;
const DENSE_FRAME_SCALE_PER_NEIGHBOR = 0.065;
const DENSE_FRAME_SCALE_MAX = 2.5;
const PRESSURE_WEIGHT_MIN = 0.35;
const PRESSURE_WEIGHT_MAX = 8;
const PRESSURE_WEIGHT_EXPONENT = 0.6;
const PRESSURE_ENTRY_THRESHOLD = 4;
const PRESSURE_ENTRY_SCALE_PER_NEIGHBOR = 0.14;
const PRESSURE_ENTRY_SCALE_MAX = 2.8;
const PRESSURE_ESCAPE_THRESHOLD = 8;
const PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR = 0.055;
const PRESSURE_ESCAPE_SCALE_MAX = 1.45;

const regularPolygon = (sides, radius, rotation = -Math.PI / 2) => {
    const points = [];
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
        const a = rotation + (i * step);
        points.push(Math.cos(a) * radius, Math.sin(a) * radius);
    }
    return points;
};

const ENEMY_LOCAL_PARTS = Object.freeze({
    square: Object.freeze([
        Object.freeze([-0.42, -0.42, 0.42, -0.42, 0.42, 0.42, -0.42, 0.42])
    ]),
    triangle: Object.freeze([
        Object.freeze([0.0, -0.5333, 0.462, 0.2667, -0.462, 0.2667])
    ]),
    arrow: Object.freeze([
        // 안쪽 꼭지점을 제외한 바깥 3개 꼭지점으로 단일 삼각형 hull을 구성합니다.
        Object.freeze([0.0, -0.5767, 0.46, 0.3733, -0.46, 0.3733])
    ]),
    hexa: Object.freeze([Object.freeze(regularPolygon(6, 0.47, -Math.PI / 2))]),
    penta: Object.freeze([Object.freeze(regularPolygon(5, 0.48, -Math.PI / 2))]),
    rhom: Object.freeze([
        Object.freeze([0.0, -0.50, 0.34, 0.0, 0.0, 0.50, -0.34, 0.0])
    ]),
    octa: Object.freeze([Object.freeze(regularPolygon(8, 0.47, Math.PI / 8))]),
    gen: Object.freeze([
        Object.freeze([-0.44, -0.44, 0.44, -0.44, 0.44, 0.44, -0.44, 0.44])
    ])
});

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
    #pairBitmap;
    #pairBitmapBodyCount;
    #scratchProjectileBody;
    #scratchManifold;
    #scratchCandidateManifold;
    #scratchBestManifold;
    #broadData;
    #broadBodyCount;
    #bucketPool;
    #bucketPoolCursor;
    #activeGridBuckets;

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
            polygonChecks: 0,
        };
        this.#bodyPool = [];
        this.#bodyPoolCursor = 0;
        this.#pairBitmap = new Uint32Array(512);
        this.#pairBitmapBodyCount = 0;
        this.#scratchProjectileBody = {
            kind: 'projectile', shape: 'circle',
            x: 0, y: 0, centerX: 0, centerY: 0, radius: 0,
            weight: 1, movable: false, ref: null, id: -1,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
            sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
            boundRadius: 0, broadRadius: 0, velocityX: 0, velocityY: 0,
            parts: null,
            _candidatePairCount: 0, _resolvedPairCount: 0,
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
        this.#broadBodyCount = 0;
        this.#bucketPool = [];
        this.#bucketPoolCursor = 0;
        this.#activeGridBuckets = [];
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
        this.#frameStats.collisionCheckCount = 0;
        this.#frameStats.aabbPassCount = 0;
        this.#frameStats.aabbRejectCount = 0;
        this.#frameStats.circlePassCount = 0;
        this.#frameStats.circleRejectCount = 0;
        this.#frameStats.polygonChecks = 0;
    }

    /**
     * 마지막 고정 틱의 충돌 체크 카운트를 반환합니다.
     * @returns {{collisionCheckCount:number, aabbPassCount:number, aabbRejectCount:number, circlePassCount:number, circleRejectCount:number, polygonChecks:number}}
     */
    getFrameStats() {
        return {
            collisionCheckCount: this.#frameStats.collisionCheckCount,
            aabbPassCount: this.#frameStats.aabbPassCount,
            aabbRejectCount: this.#frameStats.aabbRejectCount,
            circlePassCount: this.#frameStats.circlePassCount,
            circleRejectCount: this.#frameStats.circleRejectCount,
            polygonChecks: this.#frameStats.polygonChecks,
        };
    }

    /**
     * 적 목록 충돌을 처리합니다.
     * @param {object[]} enemies
     * @param {object} [options]
     * @param {number} [options.delta=1/60]
     * @param {number} [options.iterations]
     * @param {object[]} [options.players]
     * @returns {number} 처리된 충돌 건수
     */
    resolveEnemyCollisions(enemies, options = {}) {
        if (!Array.isArray(enemies) || enemies.length === 0) return 0;

        this.#resetBodyPool();
        const delta = Number.isFinite(options.delta) && options.delta > 0 ? options.delta : (1 / 60);
        const maxIterations = this.#resolveIterationCount(options.iterations);
        const players = Array.isArray(options.players) ? options.players : [];

        const dynamicBodies = this.#buildEnemyBodies(enemies, delta);
        const playerBodies = this.#buildPlayerBodies(players, delta);
        const staticBodies = this.#buildWallBodies();
        if (dynamicBodies.length === 0 && playerBodies.length === 0) return 0;

        for (let i = 0; i < dynamicBodies.length; i++) {
            dynamicBodies[i]._candidatePairCount = 0;
            dynamicBodies[i]._resolvedPairCount = 0;
            dynamicBodies[i]._frameResolveMoved = 0;
            const radius = Math.max(1, Number.isFinite(dynamicBodies[i].boundRadius) ? dynamicBodies[i].boundRadius : 1);
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
        for (let i = 0; i < adaptiveMax; i++) {
            const shouldDenseRebuild = (
                i > 0 &&
                denseMode &&
                denseRebuildPasses < DENSE_REBUILD_MAX_EXTRA_PASSES &&
                lastResolved >= DENSE_REBUILD_MIN_RESOLVED
            );
            const resolved = this.#solveOnePass(bodies, {
                resolvePositions: true,
                applyNonPosition: false,
                rebuildGrid: i === 0 || shouldDenseRebuild,
                resolveBoost: denseMode && i > 0 ? 1.18 : 1
            });
            if (shouldDenseRebuild) denseRebuildPasses++;
            totalResolved += resolved;
            if (i === 0 && maxIterations > 2) {
                const density = resolved / Math.max(1, bodies.length);
                const peakCandidates = this.#getPeakCandidatePairs(dynamicBodies);
                const localDense = peakCandidates >= DENSE_LOCAL_CANDIDATE_THRESHOLD;
                if (density < 0.5 && !localDense) {
                    adaptiveMax = Math.max(2, Math.ceil(maxIterations * Math.min(1, density * 2)));
                } else {
                    denseMode = density >= DENSE_REBUILD_DENSITY_THRESHOLD || localDense;
                }
                if (denseMode) {
                    // 과밀 구간에서는 최소 반복 수를 소폭 보장해 중심 끼임을 줄입니다.
                    minIterations = Math.min(maxIterations, DENSE_MIN_ITERATION_FLOOR);
                }
            }
            lastResolved = resolved;
            if (resolved === 0 && (i + 1) >= minIterations) break;
        }

        if (denseMode && lastResolved >= DENSE_STABILIZE_MIN_RESOLVED) {
            for (let pass = 0; pass < DENSE_STABILIZE_MAX_PASSES; pass++) {
                const stabilized = this.#solveOnePass(bodies, {
                    resolvePositions: true,
                    applyNonPosition: false,
                    rebuildGrid: true,
                    resolveBoost: DENSE_RESOLVE_BOOST
                });
                totalResolved += stabilized;
                lastResolved = stabilized;
                if (stabilized === 0) break;
            }
        }

        if (totalResolved > 0) {
            this.#solveOnePass(bodies, {
                resolvePositions: false,
                applyNonPosition: true,
                rebuildGrid: false
            });
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
        if (!Array.isArray(projectiles) || !Array.isArray(enemies)) return 0;
        if (projectiles.length === 0 || enemies.length === 0) return 0;

        this.#resetBodyPool();
        const enemyBodies = this.#buildEnemyBodies(enemies, Math.max(delta, EPSILON));
        if (enemyBodies.length === 0) return 0;

        const baseSteps = this.#resolveIterationCount();
        let hitCount = 0;

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

                for (let j = 0; j < enemyBodies.length; j++) {
                    const enemyBody = enemyBodies[j];
                    const enemyId = enemyBody.id;
                    if (this.#hasProjectileHit(projectile, enemyId)) continue;
                    this.#frameStats.collisionCheckCount++;
                    if (!this.#aabbOverlap(circleBody, enemyBody, false)) {
                        this.#frameStats.aabbRejectCount++;
                        continue;
                    }
                    this.#frameStats.aabbPassCount++;
                    if (!this.#roughBodyCircleOverlap(circleBody, enemyBody)) continue;

                    const manifold = this.#detectBodies(circleBody, enemyBody);
                    if (!manifold) continue;

                    this.#markProjectileHit(projectile, enemyId);
                    this.#applyProjectileImpact(projectile, enemyBody.ref, manifold);
                    hitCount++;
                    hitThisProjectile = true;
                    if (!projectile.piercing) break;
                }
                if (hitThisProjectile && !projectile.piercing) break;
            }
        }

        return hitCount;
    }

    /**
     * @private
     * @param {number|undefined} iterations
     * @returns {number}
     */
    #resolveIterationCount(iterations) {
        const fromSetting = Number(getSetting('physicsAccuracy'));
        const source = Number.isFinite(iterations) ? iterations : fromSetting;
        const normalized = Number.isFinite(source) ? Math.floor(source) : 1;
        return Math.max(1, Math.min(20, normalized));
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

        this.#ensureBroadData(bodyCount);
        for (let i = 0; i < bodyCount; i++) {
            this.#writeBroadData(i, bodies[i]);
        }

        if (rebuildGrid) {
            const cellSize = this.#estimateCellSize(bodies);
            this.#clearGrid();
            for (let i = 0; i < bodyCount; i++) {
                this.#insertBodyToGridSoA(i, cellSize);
            }
        }

        this.#ensurePairBitmap(bodyCount);
        const bd = this.#broadData;
        const gridBuckets = this.#activeGridBuckets;

        let resolvedCount = 0;
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
                    if (this.#hasPair(low, high)) continue;
                    this.#markPair(low, high);
                    const bodyA = bodies[low];
                    const bodyB = bodies[high];
                    if (bodyA?.ref && bodyA.ref === bodyB?.ref) continue;
                    if (bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy') {
                        const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
                        const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
                        if (idA >= 0 && idA === idB) continue;
                    }
                    const rule = this.#getRule(bodyA.kind, bodyB.kind);
                    if (!rule.check) continue;
                    if (!rule.resolve && !applyNonPosition) continue;

                    this.#frameStats.collisionCheckCount++;
                    const oA = low * BROAD_STRIDE;
                    const oB = high * BROAD_STRIDE;
                    if (bd[oA + 4] > bd[oB + 5] || bd[oA + 5] < bd[oB + 4] ||
                        bd[oA + 6] > bd[oB + 7] || bd[oA + 7] < bd[oB + 6]) {
                        this.#frameStats.aabbRejectCount++;
                        continue;
                    }
                    this.#frameStats.aabbPassCount++;
                    const dx = bd[oB + 8] - bd[oA + 8];
                    const dy = bd[oB + 9] - bd[oA + 9];
                    const rSum = bd[oA + 12] + bd[oB + 12];
                    if ((dx * dx) + (dy * dy) > (rSum * rSum)) {
                        this.#frameStats.circleRejectCount++;
                        continue;
                    }
                    this.#frameStats.circlePassCount++;
                    resolvedCount += this.#processPair(
                        bodyA,
                        bodyB,
                        resolvePositions,
                        applyNonPosition,
                        resolveBoost
                    );
                }
            }
        }

        return resolvedCount;
    }

    /**
     * @private
     */
    #processPair(bodyA, bodyB, resolvePositions = true, applyNonPosition = false, resolveBoost = 1) {
        if (bodyA?.ref && bodyA.ref === bodyB?.ref) return 0;
        if (bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy') {
            const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
            const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
            if (idA >= 0 && idA === idB) return 0;
        }

        const rule = this.#getRule(bodyA.kind, bodyB.kind);
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
            return this.detector.circleVsCircle(bodyA, bodyB, false, this.#scratchManifold);
        }

        if (bodyA.shape === 'polygon' && bodyB.shape === 'circle') {
            return this.#detectPolygonPartsVsCircle(bodyA.parts, bodyB);
        }

        if (bodyA.shape === 'circle' && bodyB.shape === 'polygon') {
            const manifold = this.#detectPolygonPartsVsCircle(bodyB.parts, bodyA);
            if (!manifold) return null;
            // poly->circle 기준 법선을 circle->poly 관점으로 뒤집습니다.
            manifold.normalX = -manifold.normalX;
            manifold.normalY = -manifold.normalY;
            return manifold;
        }

        if (bodyA.shape === 'polygon' && bodyB.shape === 'polygon') {
            return this.#detectPolygonPartsVsPolygonParts(bodyA.parts, bodyB.parts);
        }

        return null;
    }

    /**
     * @private
     */
    #detectPolygonPartsVsCircle(parts, circle) {
        const best = this.#scratchBestManifold;
        let hasBest = false;
        for (let i = 0; i < parts.length; i++) {
            this.#frameStats.polygonChecks++;
            const manifold = this.detector.polygonVsCircle(
                parts[i],
                circle,
                false,
                null,
                null,
                this.#scratchCandidateManifold
            );
            if (!manifold) continue;
            if (!hasBest || manifold.penetration > best.penetration) {
                this.#copyManifold(manifold, best);
                hasBest = true;
            }
        }
        return hasBest ? best : null;
    }

    /**
     * @private
     */
    #detectPolygonPartsVsPolygonParts(partsA, partsB) {
        const best = this.#scratchBestManifold;
        let hasBest = false;
        for (let i = 0; i < partsA.length; i++) {
            for (let j = 0; j < partsB.length; j++) {
                this.#frameStats.polygonChecks++;
                const manifold = this.detector.polygonVsPolygon(
                    partsA[i],
                    partsB[j],
                    false,
                    null,
                    null,
                    this.#scratchCandidateManifold
                );
                if (!manifold) continue;
                if (!hasBest || manifold.penetration > best.penetration) {
                    this.#copyManifold(manifold, best);
                    hasBest = true;
                }
            }
        }
        return hasBest ? best : null;
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
     * 국소 과밀도를 판단하기 위해 body별 후보 충돌 수 최대값을 반환합니다.
     * @private
     * @param {object[]} bodies
     * @returns {number}
     */
    #getPeakCandidatePairs(bodies) {
        if (!Array.isArray(bodies) || bodies.length === 0) return 0;
        let peak = 0;
        for (let i = 0; i < bodies.length; i++) {
            const count = Number.isFinite(bodies[i]?._candidatePairCount) ? bodies[i]._candidatePairCount : 0;
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
        const clamped = Math.max(PRESSURE_WEIGHT_MIN, Math.min(PRESSURE_WEIGHT_MAX, rawWeight));
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
     * @private
     */
    #estimateCellSize(bodies) {
        let radiusSum = 0;
        let count = 0;
        for (let i = 0; i < bodies.length; i++) {
            const radius = bodies[i].boundRadius;
            if (!Number.isFinite(radius) || radius <= 0) continue;
            radiusSum += radius;
            count++;
        }
        const avgRadius = count > 0 ? (radiusSum / count) : Math.max(getObjectWH() * 0.015, 12);
        const cell = Math.floor(avgRadius * 2.4);
        return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, cell));
    }

    /**
     * @private
     */
    #resetBodyPool() {
        this.#bodyPoolCursor = 0;
    }

    /**
     * @private
     */
    #acquireBody() {
        if (this.#bodyPoolCursor < this.#bodyPool.length) {
            return this.#bodyPool[this.#bodyPoolCursor++];
        }
        const body = {
            id: -1, kind: '', shape: '', parts: null, ref: null,
            weight: 1, movable: true,
            centerX: 0, centerY: 0, x: 0, y: 0, radius: 0,
            minX: 0, maxX: 0, minY: 0, maxY: 0,
            sweepMinX: 0, sweepMaxX: 0, sweepMinY: 0, sweepMaxY: 0,
            boundRadius: 0, broadRadius: 0, velocityX: 0, velocityY: 0,
            _candidatePairCount: 0, _resolvedPairCount: 0,
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
        this.#broadBodyCount = bodyCount;
    }

    /**
     * @private
     */
    #writeBroadData(index, body) {
        const o = index * BROAD_STRIDE;
        const bd = this.#broadData;
        bd[o + 0] = body.minX;
        bd[o + 1] = body.maxX;
        bd[o + 2] = body.minY;
        bd[o + 3] = body.maxY;
        bd[o + 4] = body.sweepMinX;
        bd[o + 5] = body.sweepMaxX;
        bd[o + 6] = body.sweepMinY;
        bd[o + 7] = body.sweepMaxY;
        bd[o + 8] = body.centerX;
        bd[o + 9] = body.centerY;
        bd[o + 10] = body.boundRadius;
        bd[o + 11] = body.broadRadius;
        bd[o + 12] = body.kind === 'enemy'
            ? body.broadRadius * COLLISION_BROAD_RADIUS_SCALE_ENEMY
            : (body.shape === 'circle' ? body.radius * COLLISION_BROAD_RADIUS_SCALE_DEFAULT : body.broadRadius * COLLISION_BROAD_RADIUS_SCALE_DEFAULT);
        bd[o + 13] = body.shape === 'circle' ? body.radius : body.broadRadius;
    }

    /**
     * @private
     */
    #aabbOverlap(a, b, useSweep = false) {
        const minAX = useSweep ? a.sweepMinX : a.minX;
        const maxAX = useSweep ? a.sweepMaxX : a.maxX;
        const minAY = useSweep ? a.sweepMinY : a.minY;
        const maxAY = useSweep ? a.sweepMaxY : a.maxY;
        const minBX = useSweep ? b.sweepMinX : b.minX;
        const maxBX = useSweep ? b.sweepMaxX : b.maxX;
        const minBY = useSweep ? b.sweepMinY : b.minY;
        const maxBY = useSweep ? b.sweepMaxY : b.maxY;

        return (
            minAX <= maxBX &&
            maxAX >= minBX &&
            minAY <= maxBY &&
            maxAY >= minBY
        );
    }

    /**
     * 다각형 상세 판정 전, 약간 확장된 가상 원으로 1차 필터링합니다.
     * @private
     */
    #roughBodyCircleOverlap(bodyA, bodyB) {
        const ax = Number.isFinite(bodyA?.centerX) ? bodyA.centerX : bodyA?.x;
        const ay = Number.isFinite(bodyA?.centerY) ? bodyA.centerY : bodyA?.y;
        const bx = Number.isFinite(bodyB?.centerX) ? bodyB.centerX : bodyB?.x;
        const by = Number.isFinite(bodyB?.centerY) ? bodyB.centerY : bodyB?.y;
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            this.#frameStats.circlePassCount++;
            return true;
        }

        const ra = this.#getBodyBroadRadius(bodyA);
        const rb = this.#getBodyBroadRadius(bodyB);
        if (!Number.isFinite(ra) || !Number.isFinite(rb) || ra <= 0 || rb <= 0) {
            this.#frameStats.circlePassCount++;
            return true;
        }

        const scaleA = bodyA?.kind === 'enemy' ? COLLISION_BROAD_RADIUS_SCALE_ENEMY : COLLISION_BROAD_RADIUS_SCALE_DEFAULT;
        const scaleB = bodyB?.kind === 'enemy' ? COLLISION_BROAD_RADIUS_SCALE_ENEMY : COLLISION_BROAD_RADIUS_SCALE_DEFAULT;
        const radiusSum = (ra * scaleA) + (rb * scaleB);
        const dx = bx - ax;
        const dy = by - ay;
        const passed = ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
        if (passed) {
            this.#frameStats.circlePassCount++;
        } else {
            this.#frameStats.circleRejectCount++;
        }
        return passed;
    }

    /**
     * @private
     */
    #getBodyBroadRadius(body) {
        if (!body) return 0;
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

        const radius = Number.isFinite(body?.boundRadius) ? body.boundRadius : 16;
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
        // sweep AABB는 고정 틱 시작 기준 보수 범위를 유지해 패스 간 grid 재구축 없이 재사용합니다.
        body.x = body.centerX;
        body.y = body.centerY;

        if (body.parts) {
            for (let p = 0; p < body.parts.length; p++) {
                const part = body.parts[p];
                for (let i = 0; i < part.length; i += 2) {
                    part[i] += dx;
                    part[i + 1] += dy;
                }
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
        const candidateCount = Number.isFinite(body?._candidatePairCount) ? body._candidatePairCount : 0;
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
        const candidateCount = Number.isFinite(body?._candidatePairCount) ? body._candidatePairCount : 0;
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
            return this.#rule(true, true, null, null, false, false);
        }
        // enemy vs player: 플레이어는 밀리지 않음
        if (kindA === 'enemy' && kindB === 'player') {
            return this.#rule(true, true, true, false, false, false);
        }
        if (kindA === 'player' && kindB === 'enemy') {
            return this.#rule(true, true, false, true, false, false);
        }
        // enemy vs projectile: 관통 허용 + 중복 타격 방지
        if ((kindA === 'enemy' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'enemy')) {
            return this.#rule(true, false, null, null, true, true);
        }
        // enemy vs item: 미판정
        if ((kindA === 'enemy' && kindB === 'item') || (kindA === 'item' && kindB === 'enemy')) {
            return this.#rule(false, false, null, null, false, false);
        }
        // player vs player
        if (kindA === 'player' && kindB === 'player') {
            return this.#rule(true, true, null, null, false, false);
        }
        // player vs projectile: 관통 허용 + 중복 타격 방지
        if ((kindA === 'player' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'player')) {
            return this.#rule(true, false, null, null, true, false);
        }
        // player vs item: 판정만
        if ((kindA === 'player' && kindB === 'item') || (kindA === 'item' && kindB === 'player')) {
            return this.#rule(true, false, null, null, false, false);
        }
        // projectile vs projectile: 관통 허용 + 중복 영향 방지
        if (kindA === 'projectile' && kindB === 'projectile') {
            return this.#rule(true, false, null, null, true, false);
        }
        // projectile vs item: 미판정
        if ((kindA === 'projectile' && kindB === 'item') || (kindA === 'item' && kindB === 'projectile')) {
            return this.#rule(false, false, null, null, false, false);
        }
        // item vs item
        if (kindA === 'item' && kindB === 'item') {
            return this.#rule(true, true, null, null, false, false);
        }
        // dynamic vs wall
        if (kindA === 'wall') {
            if (kindB === 'projectile') return this.#rule(true, false, false, true, false, false);
            return this.#rule(true, true, false, true, false, false);
        }
        if (kindB === 'wall') {
            if (kindA === 'projectile') return this.#rule(true, false, true, false, false, false);
            return this.#rule(true, true, true, false, false, false);
        }

        return this.#rule(false, false, null, null, false, false);
    }

    /**
     * @private
     * @returns {CollisionRule}
     */
    #rule(check, resolve, movableA, movableB, oneShotByProjectile, applyImpactRotation) {
        return {
            check,
            resolve,
            movableA,
            movableB,
            oneShotByProjectile,
            applyImpactRotation
        };
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
        const bodies = [];
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
        const bodies = [];
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
            body.parts = null;
            body.minX = x - radius;
            body.maxX = x + radius;
            body.minY = y - radius;
            body.maxY = y + radius;
            body.sweepMinX = x - radius - sweepPadX;
            body.sweepMaxX = x + radius + sweepPadX;
            body.sweepMinY = y - radius - sweepPadY;
            body.sweepMaxY = y + radius + sweepPadY;
            body.boundRadius = radius;
            body.broadRadius = radius;
            body.velocityX = velX;
            body.velocityY = velY;
            body._candidatePairCount = 0;
            body._resolvedPairCount = 0;
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
        const localParts = ENEMY_LOCAL_PARTS[enemy.type] || ENEMY_LOCAL_PARTS.square;
        const partCount = localParts.length;
        if (partCount === 0) return null;

        if (!Array.isArray(enemy.__collisionWorldParts) || enemy.__collisionWorldParts.length !== partCount) {
            enemy.__collisionWorldParts = Array.from({ length: partCount }, (_, idx) => {
                return new Float32Array(localParts[idx].length);
            });
        }

        const baseHeight = typeof enemy.getRenderHeightPx === 'function'
            ? enemy.getRenderHeightPx()
            : (getObjectWH() * 0.03 * (enemy.size || 1));
        const width = baseHeight * (enemy.aspectRatio ?? 1);
        const height = baseHeight * (enemy.heightScale ?? 1);
        const halfWScale = width;
        const halfHScale = height;

        const rotationDeg = Number.isFinite(enemy.rotation) ? enemy.rotation : 0;
        const rad = rotationDeg * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const centerX = enemy.position.x;
        const centerY = enemy.position.y;

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxDistSq = 0;

        for (let p = 0; p < partCount; p++) {
            const local = localParts[p];
            const world = enemy.__collisionWorldParts[p];
            for (let i = 0; i < local.length; i += 2) {
                const lx = local[i] * halfWScale;
                const ly = local[i + 1] * halfHScale;
                const wx = centerX + (lx * cos) - (ly * sin);
                const wy = centerY + (lx * sin) + (ly * cos);
                world[i] = wx;
                world[i + 1] = wy;

                if (wx < minX) minX = wx;
                if (wx > maxX) maxX = wx;
                if (wy < minY) minY = wy;
                if (wy > maxY) maxY = wy;
                const ddx = wx - centerX;
                const ddy = wy - centerY;
                const distSq = (ddx * ddx) + (ddy * ddy);
                if (distSq > maxDistSq) maxDistSq = distSq;
            }
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
        const broadRadius = Math.sqrt(Math.max(0, maxDistSq));
        const frameResolvePad = Math.max(
            COLLISION_RESOLVE_FRAME_MIN_MAX,
            boundRadius * COLLISION_RESOLVE_FRAME_MAX_RATIO
        );
        const velocitySweepPadX = sleeping ? 0 : (Math.abs(velX) * delta);
        const velocitySweepPadY = sleeping ? 0 : (Math.abs(velY) * delta);
        const sweepPadX = velocitySweepPadX + frameResolvePad;
        const sweepPadY = velocitySweepPadY + frameResolvePad;

        const body = this.#acquireBody();
        body.id = Number.isInteger(enemy.id) ? enemy.id : -1;
        body.kind = 'enemy';
        body.shape = 'polygon';
        body.parts = enemy.__collisionWorldParts;
        body.ref = enemy;
        body.weight = Math.max(EPSILON, Number.isFinite(enemy.weight) ? enemy.weight : 1);
        body.movable = true;
        body.centerX = centerX;
        body.centerY = centerY;
        body.x = centerX;
        body.y = centerY;
        body.radius = 0;
        body.minX = minX;
        body.maxX = maxX;
        body.minY = minY;
        body.maxY = maxY;
        body.sweepMinX = minX - sweepPadX;
        body.sweepMaxX = maxX + sweepPadX;
        body.sweepMinY = minY - sweepPadY;
        body.sweepMaxY = maxY + sweepPadY;
        body.boundRadius = boundRadius;
        body.broadRadius = broadRadius;
        body.velocityX = velX;
        body.velocityY = velY;
        body._candidatePairCount = 0;
        body._resolvedPairCount = 0;
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

            const points = new Float32Array([
                cx - hw, cy - hh,
                cx + hw, cy - hh,
                cx + hw, cy + hh,
                cx - hw, cy + hh
            ]);

            out.push({
                id: Number.isInteger(rect.id) ? rect.id : -1,
                kind: 'wall',
                shape: 'polygon',
                parts: [points],
                ref: wall,
                weight: Number.MAX_SAFE_INTEGER,
                movable: false,
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
                velocityY: 0
            });
        }
        this.#wallBodiesDirty = false;
        return out;
    }
}
