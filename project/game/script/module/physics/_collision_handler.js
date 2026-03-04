import { getObjectWH } from 'display/display_system.js';
import { getSetting } from 'save/save_system.js';
import { CollisionDetector } from './_collision_detector.js';

const EPSILON = 1e-6;
const CELL_KEY_OFFSET = 4096;
const CELL_KEY_STRIDE = 8192;
const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 280;
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
        Object.freeze([0.0, -0.45, 0.462, 0.35, -0.462, 0.35])
    ]),
    arrow: Object.freeze([
        // concave 폴리곤(화살표)을 두 개의 볼록 삼각형으로 분해해 판정
        Object.freeze([0.0, -0.50, 0.46, 0.45, 0.0, 0.28]),
        Object.freeze([0.0, -0.50, 0.0, 0.28, -0.46, 0.45])
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
 * @class CollisionHandler
 * @description broad-phase + narrow-phase + resolve를 담당하는 충돌 핸들러
 */
export class CollisionHandler {
    #grid;
    #pairSet;
    #tempBodies;
    #wallBodiesCache;
    #wallBodiesDirty;
    #frameStats;

    constructor() {
        this.detector = new CollisionDetector();
        this.walls = [];
        this.#grid = new Map();
        this.#pairSet = new Set();
        this.#tempBodies = [];
        this.#wallBodiesCache = [];
        this.#wallBodiesDirty = true;
        this.#frameStats = {
            roughCircleChecks: 0,
            polygonChecks: 0,
            projectileEnemyChecks: 0
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
        this.#frameStats.roughCircleChecks = 0;
        this.#frameStats.polygonChecks = 0;
        this.#frameStats.projectileEnemyChecks = 0;
    }

    /**
     * 마지막 고정 틱의 충돌 체크 카운트를 반환합니다.
     * @returns {{roughCircleChecks:number, polygonChecks:number, projectileEnemyChecks:number}}
     */
    getFrameStats() {
        return {
            roughCircleChecks: this.#frameStats.roughCircleChecks,
            polygonChecks: this.#frameStats.polygonChecks,
            projectileEnemyChecks: this.#frameStats.projectileEnemyChecks
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
        for (let i = 0; i < maxIterations; i++) {
            const resolved = this.#solveOnePass(bodies, {
                resolvePositions: true,
                applyNonPosition: false
            });
            totalResolved += resolved;
            if (resolved === 0) break;
        }

        // 반복 보정의 마지막 1회에서만 위치 이동 외 충돌 처리(회전 반동 등)를 수행합니다.
        if (totalResolved > 0) {
            this.#solveOnePass(bodies, {
                resolvePositions: false,
                applyNonPosition: true
            });
        }

        // 다음 고정 틱의 예측 스윕 계산을 위해 최종 위치를 저장합니다.
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

                const circleBody = {
                    kind: 'projectile',
                    shape: 'circle',
                    x: cx,
                    y: cy,
                    radius: projectile.radius,
                    weight: Math.max(EPSILON, Number.isFinite(projectile.weight) ? projectile.weight : 1),
                    movable: false,
                    ref: projectile,
                    minX: cx - projectile.radius,
                    maxX: cx + projectile.radius,
                    minY: cy - projectile.radius,
                    maxY: cy + projectile.radius,
                    sweepMinX: cx - projectile.radius,
                    sweepMaxX: cx + projectile.radius,
                    sweepMinY: cy - projectile.radius,
                    sweepMaxY: cy + projectile.radius
                };

                for (let j = 0; j < enemyBodies.length; j++) {
                    const enemyBody = enemyBodies[j];
                    const enemyId = enemyBody.id;
                    if (this.#hasProjectileHit(projectile, enemyId)) continue;
                    if (!this.#aabbOverlap(circleBody, enemyBody, false)) continue;
                    if (!this.#roughBodyCircleOverlap(circleBody, enemyBody)) continue;

                    this.#frameStats.projectileEnemyChecks++;
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
     * @returns {number}
     */
    #solveOnePass(bodies, options = {}) {
        if (!bodies || bodies.length < 2) return 0;
        const resolvePositions = options.resolvePositions !== false;
        const applyNonPosition = options.applyNonPosition === true;
        const cellSize = this.#estimateCellSize(bodies);
        this.#grid.clear();
        this.#pairSet.clear();

        for (let i = 0; i < bodies.length; i++) {
            this.#insertBodyToGrid(i, bodies[i], cellSize);
        }

        let resolvedCount = 0;
        for (const bucket of this.#grid.values()) {
            const len = bucket.length;
            if (len < 2) continue;

            for (let i = 0; i < len - 1; i++) {
                const a = bucket[i];
                for (let j = i + 1; j < len; j++) {
                    const b = bucket[j];
                    const low = a < b ? a : b;
                    const high = a < b ? b : a;
                    const pairKey = (low << 16) | high;
                    if (this.#pairSet.has(pairKey)) continue;
                    this.#pairSet.add(pairKey);
                    resolvedCount += this.#processPair(
                        bodies[low],
                        bodies[high],
                        resolvePositions,
                        applyNonPosition
                    );
                }
            }
        }

        return resolvedCount;
    }

    /**
     * @private
     */
    #processPair(bodyA, bodyB, resolvePositions = true, applyNonPosition = false) {
        if (bodyA?.ref && bodyA.ref === bodyB?.ref) return 0;
        if (bodyA?.kind === 'enemy' && bodyB?.kind === 'enemy') {
            const idA = Number.isInteger(bodyA.id) ? bodyA.id : -1;
            const idB = Number.isInteger(bodyB.id) ? bodyB.id : -1;
            if (idA >= 0 && idA === idB) return 0;
        }

        const rule = this.#getRule(bodyA.kind, bodyB.kind);
        if (!rule.check) return 0;
        if (!rule.resolve && !applyNonPosition) return 0;
        if (!this.#aabbOverlap(bodyA, bodyB, true)) return 0;
        if (!this.#roughBodyCircleOverlap(bodyA, bodyB)) return 0;

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

        const resolveBodyA = {
            weight: bodyA.weight,
            movable: rule.movableA === null ? bodyA.movable !== false : rule.movableA
        };
        const resolveBodyB = {
            weight: bodyB.weight,
            movable: rule.movableB === null ? bodyB.movable !== false : rule.movableB
        };

        const resolved = this.detector.addResolution(manifold, resolveBodyA, resolveBodyB);
        const tunedResolve = this.#tuneResolutionMoves(resolved, manifold, bodyA, bodyB);
        if (tunedResolve.moveAX || tunedResolve.moveAY) {
            this.#applyBodyTranslation(bodyA, tunedResolve.moveAX, tunedResolve.moveAY);
        }
        if (tunedResolve.moveBX || tunedResolve.moveBY) {
            this.#applyBodyTranslation(bodyB, tunedResolve.moveBX, tunedResolve.moveBY);
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
            return this.detector.circleVsCircle(bodyA, bodyB, false);
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
        let best = null;
        for (let i = 0; i < parts.length; i++) {
            this.#frameStats.polygonChecks++;
            const manifold = this.detector.polygonVsCircle(parts[i], circle, false);
            if (!manifold) continue;
            if (!best || manifold.penetration > best.penetration) {
                best = manifold;
            }
        }
        return best;
    }

    /**
     * @private
     */
    #detectPolygonPartsVsPolygonParts(partsA, partsB) {
        let best = null;
        for (let i = 0; i < partsA.length; i++) {
            for (let j = 0; j < partsB.length; j++) {
                this.#frameStats.polygonChecks++;
                const manifold = this.detector.polygonVsPolygon(partsA[i], partsB[j], false);
                if (!manifold) continue;
                if (!best || manifold.penetration > best.penetration) {
                    best = manifold;
                }
            }
        }
        return best;
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
    #insertBodyToGrid(index, body, cellSize) {
        const minCellX = Math.floor(body.minX / cellSize);
        const maxCellX = Math.floor(body.maxX / cellSize);
        const minCellY = Math.floor(body.minY / cellSize);
        const maxCellY = Math.floor(body.maxY / cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                let bucket = this.#grid.get(key);
                if (!bucket) {
                    bucket = [];
                    this.#grid.set(key, bucket);
                }
                bucket.push(index);
            }
        }
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
        this.#frameStats.roughCircleChecks++;
        const ax = Number.isFinite(bodyA?.centerX) ? bodyA.centerX : bodyA?.x;
        const ay = Number.isFinite(bodyA?.centerY) ? bodyA.centerY : bodyA?.y;
        const bx = Number.isFinite(bodyB?.centerX) ? bodyB.centerX : bodyB?.x;
        const by = Number.isFinite(bodyB?.centerY) ? bodyB.centerY : bodyB?.y;
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return true;

        const ra = this.#getBodyBroadRadius(bodyA);
        const rb = this.#getBodyBroadRadius(bodyB);
        if (!Number.isFinite(ra) || !Number.isFinite(rb) || ra <= 0 || rb <= 0) return true;

        const scaleA = bodyA?.kind === 'enemy' ? COLLISION_BROAD_RADIUS_SCALE_ENEMY : COLLISION_BROAD_RADIUS_SCALE_DEFAULT;
        const scaleB = bodyB?.kind === 'enemy' ? COLLISION_BROAD_RADIUS_SCALE_ENEMY : COLLISION_BROAD_RADIUS_SCALE_DEFAULT;
        const radiusSum = (ra * scaleA) + (rb * scaleB);
        const dx = bx - ax;
        const dy = by - ay;
        return ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
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
    #tuneResolutionMoves(resolved, manifold, bodyA, bodyB) {
        if (!resolved || !manifold) {
            return {
                moveAX: 0,
                moveAY: 0,
                moveBX: 0,
                moveBY: 0
            };
        }

        const rawPenetration = Number.isFinite(manifold.penetration) ? manifold.penetration : 0;
        const effectivePenetration = Math.max(0, rawPenetration - COLLISION_RESOLVE_SLOP);
        if (effectivePenetration <= 0) {
            return {
                moveAX: 0,
                moveAY: 0,
                moveBX: 0,
                moveBY: 0
            };
        }

        const penetrationRatio = effectivePenetration / Math.max(EPSILON, rawPenetration);
        const correctionScale = COLLISION_RESOLVE_PERCENT * penetrationRatio;

        const moveA = this.#clampCorrectionVector(
            (resolved.moveAX || 0) * correctionScale,
            (resolved.moveAY || 0) * correctionScale,
            bodyA
        );
        const moveB = this.#clampCorrectionVector(
            (resolved.moveBX || 0) * correctionScale,
            (resolved.moveBY || 0) * correctionScale,
            bodyB
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
    #clampCorrectionVector(dx, dy, body) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
        const mag = Math.hypot(dx, dy);
        if (mag <= EPSILON) return { x: 0, y: 0 };

        const radius = Number.isFinite(body?.boundRadius) ? body.boundRadius : 16;
        const maxCorrection = Math.max(COLLISION_RESOLVE_MIN_MAX, radius * COLLISION_RESOLVE_MAX_RATIO);
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
    #applyBodyTranslation(body, dx, dy) {
        if (!body || body.movable === false) return;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (dx === 0 && dy === 0) return;

        const moveMag = Math.hypot(dx, dy);
        if (moveMag <= EPSILON) return;
        const frameMax = Number.isFinite(body._frameResolveMax) ? body._frameResolveMax : Number.POSITIVE_INFINITY;
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
        body.sweepMinX += dx;
        body.sweepMaxX += dx;
        body.sweepMinY += dy;
        body.sweepMaxY += dy;
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
            const sweepPadX = Math.abs(velX) * delta;
            const sweepPadY = Math.abs(velY) * delta;

            bodies.push({
                id: Number.isInteger(player.id) ? player.id : -1,
                kind: 'player',
                shape: 'circle',
                x,
                y,
                centerX: x,
                centerY: y,
                radius,
                ref: player,
                weight: Math.max(EPSILON, Number.isFinite(player.weight) ? player.weight : 1),
                movable: true,
                minX: x - radius,
                maxX: x + radius,
                minY: y - radius,
                maxY: y + radius,
                sweepMinX: x - radius - sweepPadX,
                sweepMaxX: x + radius + sweepPadX,
                sweepMinY: y - radius - sweepPadY,
                sweepMaxY: y + radius + sweepPadY,
                boundRadius: radius,
                broadRadius: radius,
                velocityX: velX,
                velocityY: velY
            });
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
        const sweepPadX = sleeping ? 0 : (Math.abs(velX) * delta);
        const sweepPadY = sleeping ? 0 : (Math.abs(velY) * delta);

        const boundRadius = Math.max((maxX - minX) * 0.5, (maxY - minY) * 0.5);
        const broadRadius = Math.sqrt(Math.max(0, maxDistSq));

        return {
            id: Number.isInteger(enemy.id) ? enemy.id : -1,
            kind: 'enemy',
            shape: 'polygon',
            parts: enemy.__collisionWorldParts,
            ref: enemy,
            weight: Math.max(EPSILON, Number.isFinite(enemy.weight) ? enemy.weight : 1),
            movable: true,
            centerX,
            centerY,
            x: centerX,
            y: centerY,
            minX,
            maxX,
            minY,
            maxY,
            sweepMinX: minX - sweepPadX,
            sweepMaxX: maxX + sweepPadX,
            sweepMinY: minY - sweepPadY,
            sweepMaxY: maxY + sweepPadY,
            boundRadius,
            broadRadius,
            velocityX: velX,
            velocityY: velY
        };
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
