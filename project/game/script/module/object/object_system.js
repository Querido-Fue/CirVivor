import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { ObjectPool } from './_object_pool.js';
import { getData } from 'data/data_handler.js';
import { SquareEnemy } from './enemy/_square_enemy.js';
import { TriangleEnemy } from './enemy/_triangle_enemy.js';
import { ArrowEnemy } from './enemy/_arrow_enemy.js';
import { HexaEnemy } from './enemy/_hexa_enemy.js';
import { HexaHiveEnemy } from './enemy/_hexa_hive_enemy.js';
import { PentaEnemy } from './enemy/_penta_enemy.js';
import { RhomEnemy } from './enemy/_rhom_enemy.js';
import { OctaEnemy } from './enemy/_octa_enemy.js';
import { GenEnemy } from './enemy/_gen_enemy.js';
import { enemyAI } from './enemy/ai/_enemy_ai.js';
import {
    collectHexaWorldCellsFromEnemy,
    createHexaHiveLayoutFromWorldCells,
    getHexaHiveType,
    isHexaMergeEnemyType,
    snapHexaRotationDegToSymmetry
} from './enemy/_hexa_hive_layout.js';
import { PhysicsSystem } from 'physics/physics_system.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import { getSimulationObjectWH, getSimulationWW } from 'simulation/simulation_runtime.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const ENEMY_DEFAULT_WEIGHT = getData('ENEMY_DEFAULT_WEIGHT');
const AI_DECISION_GROUP_COUNT = 60;
const AI_DECISION_INTERVAL_SECONDS = 1.0;
const INLINE_ENEMY_AI_QUALITY_PROFILE = 'inline_safe';
const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_HIVE_MERGE_CONTACT_SECONDS = 0.5;
const HEXA_HIVE_MOVE_SPEED_DECAY = 0.95;
const HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO = 0.5;
const HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL = 0.5;
const HEXA_HIVE_MERGE_PENDING_WEIGHT = 100000;
const HEXA_HIVE_EPSILON = 1e-6;

let objectSystemInstance = null;
const ENEMY_CLASS_BY_TYPE = {
    square: SquareEnemy,
    triangle: TriangleEnemy,
    arrow: ArrowEnemy,
    hexa: HexaEnemy,
    hexa_hive: HexaHiveEnemy,
    penta: PentaEnemy,
    rhom: RhomEnemy,
    octa: OctaEnemy,
    gen: GenEnemy
};
const ENEMY_POOL_TYPES = Object.freeze([
    ...ENEMY_SHAPE_TYPES,
    HEXA_HIVE_TYPE
]);

/**
 * @class ObjectSystem
 * @description 게임 오브젝트의 생명주기(초기화/업데이트/렌더)를 담당합니다.
 */
export class ObjectSystem {
    constructor() {
        objectSystemInstance = this;
        this.enemies = [];
        this.enemyPools = {};
        this.enemyById = new Map();
        this.enemyIdCounter = 0;
        this.showcaseEnabled = false;
        this.physicsSystem = new PhysicsSystem();
        this.walls = [];
        this.players = [];
        this.projectiles = [];
        this.items = [];
        this.tempPlayer = {
            id: -1,
            kind: 'player',
            active: true,
            position: { x: 0, y: 0 },
            radius: 18,
            weight: 1
        };
        this.aiDecisionGroupCount = AI_DECISION_GROUP_COUNT;
        this.aiDecisionGroupCursor = 0;
        this.aiDecisionIntervalSeconds = AI_DECISION_INTERVAL_SECONDS;
        this.aiSharedFlowFieldByKey = new Map();
        this.aiSharedDirectPathByKey = new Map();
        this.aiSharedDensityFieldByKey = new Map();
        this.aiSharedPolicyTargetByKey = new Map();
        this.aiWallsVersion = 0;
        this.enemyCullOutsideRatio = DEFAULT_OUTSIDE_CULL_RATIO;
        this.hexaHiveContactSecondsByPair = new Map();
        this.pendingSimulationCommandState = {
            enemyDespawnIds: [],
            enemySpawnSnapshots: []
        };
    }

    /**
     * 오브젝트 시스템을 초기화합니다.
     */
    async init() {
        for (const type of ENEMY_POOL_TYPES) {
            const EnemyClass = ENEMY_CLASS_BY_TYPE[type];
            this.enemyPools[type] = new ObjectPool(
                () => {
                    const enemy = new EnemyClass();
                    enemy.__poolType = type;
                    return enemy;
                },
                (enemy) => enemy.reset(),
                `Enemy.${type}`
            );
            this.enemyPools[type].warmUp(ENEMY_CONSTANTS.POOL_WARMUP_COUNT);
        }
    }

    /**
     * 모든 오브젝트를 업데이트합니다.
     */
    update() {
        const alpha = getFixedInterpolationAlpha();
        const ww = getSimulationWW();
        const objectWH = getSimulationObjectWH();

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy || !enemy.active) {
                this.#releaseEnemyAt(i);
                continue;
            }

            enemy.interpolatePosition(alpha);

            if (enemy.isOutsideScreen(ww, objectWH, this.enemyCullOutsideRatio)) {
                this.#releaseEnemyAt(i);
            }
        }
    }

    /**
     * 고정 틱 기반 오브젝트 상태를 업데이트합니다.
     */
    fixedUpdate() {
        const delta = getFixedDelta();
        if (!Number.isFinite(delta) || delta <= 0) return;
        if (this.physicsSystem && typeof this.physicsSystem.beginFrame === 'function') {
            this.physicsSystem.beginFrame();
        }

        if (Array.isArray(this.players)) {
            for (let i = 0; i < this.players.length; i++) {
                const player = this.players[i];
                if (!player || player.active === false) continue;
                if (typeof player.fixedUpdate === 'function') {
                    player.fixedUpdate(delta);
                }
            }
        }

        if (Array.isArray(this.items)) {
            for (let i = 0; i < this.items.length; i++) {
                const item = this.items[i];
                if (!item || item.active === false) continue;
                if (typeof item.fixedUpdate === 'function') {
                    item.fixedUpdate(delta);
                }
            }
        }

        if (Array.isArray(this.projectiles)) {
            for (let i = 0; i < this.projectiles.length; i++) {
                const projectile = this.projectiles[i];
                if (!projectile || projectile.active === false) continue;
                if (typeof projectile.fixedUpdate === 'function') {
                    projectile.fixedUpdate(delta);
                }
            }
        }

        const decisionGroup = this.aiDecisionGroupCursor;
        this.aiDecisionGroupCursor = (this.aiDecisionGroupCursor + 1) % this.aiDecisionGroupCount;
        this.aiSharedFlowFieldByKey.clear();
        this.aiSharedDirectPathByKey.clear();
        this.aiSharedDensityFieldByKey.clear();
        this.aiSharedPolicyTargetByKey.clear();
        const aiContext = {
            player: this.getPrimaryPlayer(),
            walls: this.walls,
            enemies: this.enemies,
            shouldUpdateDecision: false,
            decisionInterval: this.aiDecisionIntervalSeconds,
            decisionGroup,
            enemyAIQualityProfile: INLINE_ENEMY_AI_QUALITY_PROFILE,
            sharedFlowFieldByKey: this.aiSharedFlowFieldByKey,
            sharedDirectPathByKey: this.aiSharedDirectPathByKey,
            sharedDensityFieldByKey: this.aiSharedDensityFieldByKey,
            sharedPolicyTargetByKey: this.aiSharedPolicyTargetByKey,
            wallsVersion: this.aiWallsVersion
        };

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy || !enemy.active) {
                this.#releaseEnemyAt(i);
                continue;
            }

            enemy.beginFixedStep();

            if (enemy.status && enemy.status.remainingTime > 0) {
                enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - delta);
                if (enemy.status.remainingTime === 0) {
                    enemy.clearStatus();
                }
            }

            aiContext.shouldUpdateDecision = this.#getEnemyDecisionGroup(enemy, i) === decisionGroup;
            enemy.fixedUpdate(delta, aiContext);
        }

        const hexaContactPairs = this.collectHexaHiveContactPairs(delta);
        const hexaMergeCandidatesById = this.#syncHexaHiveMergeState(delta, hexaContactPairs);
        this.resolveEnemyCollisions(this.enemies, {
            delta,
            players: this.players
        });
        this.resolveProjectileVsEnemies(this.projectiles, this.enemies, delta);
        this.resolveHexaHiveMerges(hexaMergeCandidatesById);
    }

    /**
     * 모든 오브젝트를 그립니다.
     */
    draw() {
        for (let i = 0; i < this.enemies.length; i++) {
            this.enemies[i].draw();
        }
    }

    /**
         * 화면 크기 변경 등에 대응하여 쇼케이스가 활성화되어 있다면 다시 배치합니다.
         */
    resize() {
        if (this.showcaseEnabled) {
            this.buildEnemyShowcase();
        }
    }

    /**
         * 오브젝트 풀에서 지정된 타입의 적 인스턴스를 하나 획득하고 초기값을 주입합니다.
         * @param {'square'|'triangle'|'arrow'|'hexa'|'hexa_hive'|'penta'|'rhom'|'octa'|'gen'} type 대상 적의 형태 타입
         * @param {object} data 초기화에 필요한 프로퍼티 보유 객체 (hp, speed 등)
         * @returns {object|null} 초기화된 적 인스턴스
         */
    acquireEnemy(type, data = {}) {
        const pool = this.enemyPools[type];
        if (!pool) return null;

        const enemy = pool.get();
        const hasNumericId = Number.isInteger(data.id) && data.id >= 0;
        const enemyId = hasNumericId ? data.id : this.enemyIdCounter++;
        if (hasNumericId && data.id >= this.enemyIdCounter) {
            this.enemyIdCounter = data.id + 1;
        }
        enemy.init({
            id: enemyId,
            type,
            hp: data.hp ?? 1,
            maxHp: data.maxHp ?? 1,
            atk: data.atk ?? 1,
            moveSpeed: data.moveSpeed ?? 0,
            accSpeed: data.accSpeed ?? 0,
            size: data.size ?? 1,
            weight: data.weight ?? ENEMY_DEFAULT_WEIGHT[type] ?? 1,
            rotationResistance: data.rotationResistance,
            projectileHitsToKill: data.projectileHitsToKill ?? 0,
            position: data.position ?? { x: getSimulationWW() * 0.5, y: getSimulationObjectWH() * 0.5 },
            speed: data.speed ?? { x: 0, y: 0 },
            acc: data.acc ?? { x: 0, y: 0 },
            status: data.status,
            ai: data.ai ?? null,
            fill: data.fill,
            alpha: data.alpha,
            rotation: data.rotation,
            angularVelocity: data.angularVelocity,
            angularDeceleration: data.angularDeceleration,
            mergeBaseMoveSpeed: data.mergeBaseMoveSpeed,
            hexaHiveLayout: data.hexaHiveLayout
        });

        return enemy;
    }

    /**
         * 지정된 타입의 적을 오브젝트 풀에서 꺼내어 활성화 큐에 추가합니다.
         * @param {'square'|'triangle'|'arrow'|'hexa'|'hexa_hive'|'penta'|'rhom'|'octa'|'gen'} type 대상 적의 형태 타입
         * @param {object} data 초기 속성 데이터
         * @returns {object|null} 생성되어 배치된 적 인스턴스
         */
    spawnEnemy(type, data = {}) {
        const enemy = this.acquireEnemy(type, data);
        if (!enemy) return null;

        this.enemies.push(enemy);
        this.enemyById.set(enemy.id, enemy);
        return enemy;
    }

    /**
         * 활성화된 적 목록에서 인스턴스를 찾고, 발견 시 풀로 반환합니다.
         * @param {object} enemy 제거(반납)할 적 인스턴스
         */
    releaseEnemy(enemy) {
        const index = this.enemies.indexOf(enemy);
        if (index >= 0) {
            this.#releaseEnemyAt(index);
        }
    }

    /**
         * 주어진 대상 적 인스턴스를 초기화한 뒤 오브젝트 풀에 직접 집어넣습니다.
         * 매핑된 ID 캐시도 삭제됩니다.
         * @param {object} enemy 반납할 적 객체
         */
    releaseEnemyToPool(enemy) {
        if (!enemy) return;

        if (enemy.id !== null && enemy.id !== undefined) {
            this.enemyById.delete(enemy.id);
        }

        if (enemy.__poolType && this.enemyPools[enemy.__poolType]) {
            enemy.release();
            this.enemyPools[enemy.__poolType].release(enemy);
        }
    }

    /**
         * 현재 화면 상에 배치된 모든 활성 적들을 전부 제거 및 반납합니다.
         */
    clearEnemies() {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            this.#releaseEnemyAt(i);
        }
    }

    /**
         * 활성화되어 있는 적 인스턴스의 배열을 반환합니다.
         * @returns {object[]} 적 인스턴스 목록
         */
    getEnemies() {
        return this.enemies;
    }

    /**
     * 앞으로 사용할 적 ID를 미리 예약합니다.
     * 워커/명령 큐와 ID를 맞출 때 사용합니다.
     * @param {number} [count=1]
     * @returns {number[]}
     */
    reserveEnemyIds(count = 1) {
        const safeCount = Number.isInteger(count) ? Math.max(0, count) : 0;
        if (safeCount <= 0) {
            return [];
        }

        const reservedIds = [];
        for (let i = 0; i < safeCount; i++) {
            reservedIds.push(this.enemyIdCounter++);
        }
        return reservedIds;
    }

    /**
     * 다음 적 ID 카운터 값을 반환합니다.
     * @returns {number}
     */
    getEnemyIdCounter() {
        return this.enemyIdCounter;
    }

    /**
     * 현재 오브젝트 시스템의 프레임 동기화용 동적 시뮬레이션 스냅샷을 생성합니다.
     * @returns {{enemyIdCounter: number, enemies: object[]}}
     */
    createSimulationFrameSnapshot() {
        const enemyStates = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            if (!enemy || enemy.active === false) {
                continue;
            }

            if (typeof enemy.createSimulationFrameSnapshot === 'function') {
                enemyStates.push(enemy.createSimulationFrameSnapshot());
                continue;
            }

            enemyStates.push({
                id: enemy.id ?? null,
                active: enemy.active === true
            });
        }

        return {
            enemyIdCounter: this.enemyIdCounter,
            enemies: enemyStates
        };
    }

    /**
     * 현재 오브젝트 시스템의 읽기 전용 시뮬레이션 스냅샷을 생성합니다.
     * 현재는 워커 분리 우선순위가 높은 적 상태 위주로 직렬화합니다.
     * @returns {{showcaseEnabled: boolean, enemyIdCounter: number, aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number, enemies: object[]}}
     */
    createSimulationSnapshot() {
        const enemySnapshots = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            if (!enemy || enemy.active === false) {
                continue;
            }

            if (typeof enemy.createSimulationSnapshot === 'function') {
                enemySnapshots.push(enemy.createSimulationSnapshot());
                continue;
            }

            enemySnapshots.push({
                id: enemy.id ?? null,
                active: enemy.active === true,
                type: enemy.type ?? 'none'
            });
        }

        return {
            showcaseEnabled: this.showcaseEnabled === true,
            enemyIdCounter: this.enemyIdCounter,
            aiDecisionGroupCursor: this.aiDecisionGroupCursor,
            aiDecisionGroupCount: this.aiDecisionGroupCount,
            aiDecisionIntervalSeconds: this.aiDecisionIntervalSeconds,
            enemyCullOutsideRatio: this.enemyCullOutsideRatio,
            enemies: enemySnapshots
        };
    }

    /**
     * 현재 접촉 중인 육각형/합체 육각형 쌍을 exact 판정으로 수집합니다.
     * @param {number} delta
     * @returns {{enemyA: object, enemyB: object}[]}
     */
    collectHexaHiveContactPairs(delta) {
        const mergeCandidates = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            if (!enemy || enemy.active === false || !isHexaMergeEnemyType(enemy.type)) {
                continue;
            }

            mergeCandidates.push(enemy);
        }

        if (mergeCandidates.length < 2 || !this.physicsSystem || typeof this.physicsSystem.collectEnemyContactPairs !== 'function') {
            return [];
        }

        return this.physicsSystem.collectEnemyContactPairs(mergeCandidates, { delta });
    }

    /**
     * 누적 접촉 시간을 기준으로 육각형 그룹 합체를 수행합니다.
     * @param {Map<number, object>|null} [activeMergeCandidatesById=null]
     * @returns {number}
     */
    resolveHexaHiveMerges(activeMergeCandidatesById = null) {
        const mergeGroups = this.#collectHexaHiveMergeGroups(
            activeMergeCandidatesById instanceof Map
                ? activeMergeCandidatesById
                : this.#buildActiveHexaMergeCandidatesById()
        );
        if (mergeGroups.length === 0) {
            return 0;
        }

        const releaseIds = new Set();
        const spawnDataList = [];
        for (let i = 0; i < mergeGroups.length; i++) {
            const mergeGroup = mergeGroups[i];
            if (!Array.isArray(mergeGroup) || mergeGroup.length < 2) {
                continue;
            }

            const spawnData = this.#buildHexaHiveSpawnData(mergeGroup);
            if (!spawnData) {
                continue;
            }

            spawnDataList.push(spawnData);
            for (let j = 0; j < mergeGroup.length; j++) {
                const enemyId = mergeGroup[j]?.id;
                if (Number.isInteger(enemyId)) {
                    releaseIds.add(enemyId);
                }
            }
        }

        if (spawnDataList.length === 0 || releaseIds.size === 0) {
            return 0;
        }

        this.#clearHexaHiveContactPairsForEnemyIds(releaseIds);

        const releaseIndices = [];
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            if (enemy && releaseIds.has(enemy.id)) {
                releaseIndices.push(i);
            }
        }

        releaseIndices.sort((left, right) => right - left);
        for (let i = 0; i < releaseIndices.length; i++) {
            this.#releaseEnemyAt(releaseIndices[i]);
        }

        let mergedCount = 0;
        for (let i = 0; i < spawnDataList.length; i++) {
            const hexaHive = this.spawnEnemy(HEXA_HIVE_TYPE, spawnDataList[i]);
            if (!hexaHive) {
                continue;
            }

            this.#queueEnemySpawn(hexaHive);
            mergedCount++;
        }

        return mergedCount;
    }

    /**
     * 플레이어 충돌체 목록을 등록합니다.
     * @param {object[]} players
     */
    setPlayers(players = []) {
        this.players = Array.isArray(players) ? players : [];
    }

    /**
     * 등록된 플레이어 충돌체 목록을 반환합니다.
     * @returns {object[]}
     */
    getPlayers() {
        return this.players;
    }

    /**
     * 투사체 충돌체 목록을 등록합니다.
     * @param {object[]} projectiles
     */
    setProjectiles(projectiles = []) {
        this.projectiles = Array.isArray(projectiles) ? projectiles : [];
    }

    /**
     * 등록된 투사체 충돌체 목록을 반환합니다.
     * @returns {object[]}
     */
    getProjectiles() {
        return this.projectiles;
    }

    /**
     * 아이템 충돌체 목록을 등록합니다.
     * @param {object[]} items
     */
    setItems(items = []) {
        this.items = Array.isArray(items) ? items : [];
    }

    /**
     * 등록된 아이템 충돌체 목록을 반환합니다.
     * @returns {object[]}
     */
    getItems() {
        return this.items;
    }

    /**
     * 현재 추적 대상 플레이어를 반환합니다.
     * 플레이어가 없으면 화면 중앙 임시 플레이어를 반환합니다.
     * @returns {object}
     */
    getPrimaryPlayer() {
        if (Array.isArray(this.players)) {
            for (let i = 0; i < this.players.length; i++) {
                const player = this.players[i];
                if (player && player.active !== false) return player;
            }
        }

        this.tempPlayer.position.x = getSimulationWW() * 0.5;
        this.tempPlayer.position.y = getSimulationObjectWH() * 0.5;
        return this.tempPlayer;
    }

    /**
     * 고정형 벽 충돌체 목록을 등록합니다.
     * @param {object[]} walls
     */
    setWalls(walls = []) {
        this.walls = Array.isArray(walls) ? walls : [];
        this.aiWallsVersion++;
        if (this.physicsSystem) {
            this.physicsSystem.setWalls(this.walls);
        }
    }

    /**
     * 등록된 벽 목록을 반환합니다.
     * @returns {object[]}
     */
    getWalls() {
        return this.walls;
    }

    /**
     * 지정한 적 목록에 대해 충돌을 해소합니다.
     * @param {object[]} enemies
     * @param {object} [options]
     * @returns {number}
     */
    resolveEnemyCollisions(enemies, options = {}) {
        if (!this.physicsSystem) return 0;
        return this.physicsSystem.resolveEnemyCollisions(enemies, options);
    }

    /**
     * 투사체 vs 적 충돌(고속 스윕 + 중복 타격 방지)을 처리합니다.
     * @param {object[]} projectiles
     * @param {object[]} enemies
     * @param {number} delta
     * @returns {number}
     */
    resolveProjectileVsEnemies(projectiles, enemies, delta) {
        if (!this.physicsSystem) return 0;
        return this.physicsSystem.resolveProjectileVsEnemies(projectiles, enemies, delta);
    }

    /**
     * 마지막 고정 틱 충돌 체크 통계를 반환합니다.
     * @returns {{collisionCheckCount:number, aabbPassCount:number, aabbRejectCount:number, circlePassCount:number, circleRejectCount:number, polygonChecks:number}}
     */
    getCollisionStats() {
        if (!this.physicsSystem || typeof this.physicsSystem.getCollisionStats !== 'function') {
            return {
                collisionCheckCount: 0,
                aabbPassCount: 0,
                aabbRejectCount: 0,
                circlePassCount: 0,
                circleRejectCount: 0,
                polygonChecks: 0
            };
        }
        return this.physicsSystem.getCollisionStats();
    }

    /**
     * @private
     * @param {object} enemy
     * @returns {number}
     */
    #getHexaHiveBaseMoveSpeed(enemy) {
        if (Number.isFinite(enemy?.mergeBaseMoveSpeed) && enemy.mergeBaseMoveSpeed > 0) {
            return enemy.mergeBaseMoveSpeed;
        }
        if (Number.isFinite(enemy?.moveSpeed) && enemy.moveSpeed > 0) {
            return enemy.moveSpeed;
        }
        return 0;
    }

    /**
     * @private
     * @param {number} enemyIdA
     * @param {number} enemyIdB
     * @returns {string}
     */
    #buildHexaHivePairKey(enemyIdA, enemyIdB) {
        const firstId = enemyIdA < enemyIdB ? enemyIdA : enemyIdB;
        const secondId = enemyIdA < enemyIdB ? enemyIdB : enemyIdA;
        return `${firstId}:${secondId}`;
    }

    /**
     * @private
     * @param {string} pairKey
     * @returns {number[]}
     */
    #parseHexaHivePairKey(pairKey) {
        if (typeof pairKey !== 'string') {
            return [];
        }

        const [left, right] = pairKey.split(':');
        const enemyIdA = Number.parseInt(left, 10);
        const enemyIdB = Number.parseInt(right, 10);
        if (!Number.isInteger(enemyIdA) || !Number.isInteger(enemyIdB)) {
            return [];
        }
        return [enemyIdA, enemyIdB];
    }

    /**
     * @private
     * @param {Set<number>} enemyIds
     */
    #clearHexaHiveContactPairsForEnemyIds(enemyIds) {
        if (!(enemyIds instanceof Set) || enemyIds.size === 0) {
            return;
        }

        for (const pairKey of this.hexaHiveContactSecondsByPair.keys()) {
            const [enemyIdA, enemyIdB] = this.#parseHexaHivePairKey(pairKey);
            if (enemyIds.has(enemyIdA) || enemyIds.has(enemyIdB)) {
                this.hexaHiveContactSecondsByPair.delete(pairKey);
            }
        }
    }

    /**
     * @private
     * @returns {Map<number, object>}
     */
    #buildActiveHexaMergeCandidatesById() {
        const activeMergeCandidatesById = new Map();
        for (let i = 0; i < this.enemies.length; i++) {
            const enemy = this.enemies[i];
            if (!enemy || enemy.active === false || !isHexaMergeEnemyType(enemy.type) || !Number.isInteger(enemy.id)) {
                continue;
            }

            activeMergeCandidatesById.set(enemy.id, enemy);
        }

        return activeMergeCandidatesById;
    }

    /**
     * @private
     * @param {Map<number, object>} activeMergeCandidatesById
     * @param {number} delta
     * @param {{enemyA: object, enemyB: object}[]} contactPairs
     */
    #updateHexaHiveContactTimers(activeMergeCandidatesById, delta, contactPairs) {
        const activePairKeys = new Set();
        if (Array.isArray(contactPairs)) {
            for (let i = 0; i < contactPairs.length; i++) {
                const pair = contactPairs[i];
                const enemyA = pair?.enemyA;
                const enemyB = pair?.enemyB;
                if (!enemyA || !enemyB || enemyA === enemyB) {
                    continue;
                }

                if (!activeMergeCandidatesById.has(enemyA.id) || !activeMergeCandidatesById.has(enemyB.id)) {
                    continue;
                }

                const pairKey = this.#buildHexaHivePairKey(enemyA.id, enemyB.id);
                activePairKeys.add(pairKey);
                this.hexaHiveContactSecondsByPair.set(
                    pairKey,
                    (this.hexaHiveContactSecondsByPair.get(pairKey) || 0) + delta
                );
            }
        }

        for (const pairKey of [...this.hexaHiveContactSecondsByPair.keys()]) {
            if (!activePairKeys.has(pairKey)) {
                this.hexaHiveContactSecondsByPair.delete(pairKey);
            }
        }
    }

    /**
     * @private
     * @param {Map<number, object>} activeMergeCandidatesById
     */
    #applyHexaHiveMergePendingState(activeMergeCandidatesById) {
        const pendingEnemyIds = new Set();
        for (const [pairKey, contactSeconds] of this.hexaHiveContactSecondsByPair.entries()) {
            if (!Number.isFinite(contactSeconds) || contactSeconds <= 0) {
                continue;
            }

            const [enemyIdA, enemyIdB] = this.#parseHexaHivePairKey(pairKey);
            if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
                continue;
            }

            pendingEnemyIds.add(enemyIdA);
            pendingEnemyIds.add(enemyIdB);
        }

        for (const enemy of activeMergeCandidatesById.values()) {
            enemy.hexaHiveMergePending = pendingEnemyIds.has(enemy.id);
            enemy.hexaHiveMergePendingWeight = enemy.hexaHiveMergePending
                ? HEXA_HIVE_MERGE_PENDING_WEIGHT
                : null;
        }
    }

    /**
     * @private
     * @param {number} delta
     * @param {{enemyA: object, enemyB: object}[]} contactPairs
     * @returns {Map<number, object>}
     */
    #syncHexaHiveMergeState(delta, contactPairs) {
        const activeMergeCandidatesById = this.#buildActiveHexaMergeCandidatesById();
        this.#updateHexaHiveContactTimers(activeMergeCandidatesById, delta, contactPairs);
        this.#applyHexaHiveMergePendingState(activeMergeCandidatesById);
        return activeMergeCandidatesById;
    }

    /**
     * @private
     * @param {Map<number, object>} activeMergeCandidatesById
     * @returns {object[][]}
     */
    #collectHexaHiveMergeGroups(activeMergeCandidatesById) {
        if (!(activeMergeCandidatesById instanceof Map) || activeMergeCandidatesById.size === 0) {
            return [];
        }

        const adjacency = new Map();
        for (const [pairKey, contactSeconds] of this.hexaHiveContactSecondsByPair.entries()) {
            if (!Number.isFinite(contactSeconds) || contactSeconds < HEXA_HIVE_MERGE_CONTACT_SECONDS) {
                continue;
            }

            const [enemyIdA, enemyIdB] = this.#parseHexaHivePairKey(pairKey);
            if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
                continue;
            }

            if (!adjacency.has(enemyIdA)) adjacency.set(enemyIdA, new Set());
            if (!adjacency.has(enemyIdB)) adjacency.set(enemyIdB, new Set());
            adjacency.get(enemyIdA).add(enemyIdB);
            adjacency.get(enemyIdB).add(enemyIdA);
        }

        const visited = new Set();
        const mergeGroups = [];
        for (const [enemyId, enemy] of activeMergeCandidatesById.entries()) {
            if (visited.has(enemyId) || !adjacency.has(enemyId)) {
                continue;
            }

            const queue = [enemyId];
            const mergeGroup = [];
            visited.add(enemyId);
            while (queue.length > 0) {
                const currentId = queue.shift();
                const currentEnemy = activeMergeCandidatesById.get(currentId);
                if (currentEnemy) {
                    mergeGroup.push(currentEnemy);
                }

                const neighbors = adjacency.get(currentId);
                if (!neighbors) {
                    continue;
                }

                for (const neighborId of neighbors) {
                    if (visited.has(neighborId)) {
                        continue;
                    }
                    visited.add(neighborId);
                    queue.push(neighborId);
                }
            }

            if (mergeGroup.length >= 2) {
                mergeGroups.push(mergeGroup);
            }
        }

        return mergeGroups;
    }

    /**
     * @private
     * @param {object[]} mergeGroup
     * @returns {object|null}
     */
    #buildHexaHiveSpawnData(mergeGroup) {
        if (!Array.isArray(mergeGroup) || mergeGroup.length < 2) {
            return null;
        }

        const worldCells = [];
        let totalMass = 0;
        let weightedCenterX = 0;
        let weightedCenterY = 0;
        let weightedRotationSin = 0;
        let weightedRotationCos = 0;
        let weightedSpeedX = 0;
        let weightedSpeedY = 0;
        let weightedAngularVelocity = 0;
        let weightedBaseMoveSpeed = 0;
        let weightedCurrentMoveSpeed = 0;
        let weightedAccSpeed = 0;
        let weightedSize = 0;
        let weightedBaseHeight = 0;
        let weightedAlpha = 0;
        let alphaWeight = 0;
        let totalWeight = 0;
        let totalMaxHp = 0;
        let totalHp = 0;
        let totalAtk = 0;
        let totalProjectileHitsToKill = 0;
        let totalCells = 0;
        let preferredFill = null;

        for (let i = 0; i < mergeGroup.length; i++) {
            const enemy = mergeGroup[i];
            const enemyCells = collectHexaWorldCellsFromEnemy(enemy);
            if (enemyCells.length === 0) {
                continue;
            }

            const enemyWeight = Math.max(HEXA_HIVE_EPSILON, Number.isFinite(enemy.weight) ? enemy.weight : 1);
            const cellMass = enemyWeight / enemyCells.length;
            const baseMoveSpeed = this.#getHexaHiveBaseMoveSpeed(enemy);
            const currentMoveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : baseMoveSpeed;
            const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
            const size = Number.isFinite(enemy.size) ? enemy.size : 1;
            const baseHeight = typeof enemy.getRenderHeightPx === 'function'
                ? enemy.getRenderHeightPx()
                : (getSimulationObjectWH() * 0.03 * size);
            const rotationRadians = (Number.isFinite(enemy.rotation) ? enemy.rotation : 0) * (Math.PI / 180);

            for (let j = 0; j < enemyCells.length; j++) {
                worldCells.push(enemyCells[j]);
                totalMass += cellMass;
                weightedCenterX += enemyCells[j].x * cellMass;
                weightedCenterY += enemyCells[j].y * cellMass;
            }

            totalCells += enemyCells.length;
            totalWeight += enemyWeight;
            totalMaxHp += Number.isFinite(enemy.maxHp) ? enemy.maxHp : 0;
            totalHp += Number.isFinite(enemy.hp) ? enemy.hp : 0;
            totalAtk += Number.isFinite(enemy.atk) ? enemy.atk : 0;
            totalProjectileHitsToKill += Number.isFinite(enemy.projectileHitsToKill) ? enemy.projectileHitsToKill : 0;
            weightedRotationSin += Math.sin(rotationRadians) * enemyWeight;
            weightedRotationCos += Math.cos(rotationRadians) * enemyWeight;
            weightedSpeedX += (Number.isFinite(enemy.speed?.x) ? enemy.speed.x : 0) * enemyWeight;
            weightedSpeedY += (Number.isFinite(enemy.speed?.y) ? enemy.speed.y : 0) * enemyWeight;
            weightedAngularVelocity += (Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0) * enemyWeight;
            weightedBaseMoveSpeed += baseMoveSpeed * enemyCells.length;
            weightedCurrentMoveSpeed += currentMoveSpeed * enemyCells.length;
            weightedAccSpeed += accSpeed * enemyCells.length;
            weightedSize += size * enemyCells.length;
            weightedBaseHeight += baseHeight * enemyCells.length;
            if (Number.isFinite(enemy.alpha)) {
                weightedAlpha += enemy.alpha * enemyCells.length;
                alphaWeight += enemyCells.length;
            }
            if (preferredFill === null && typeof enemy.fill === 'string') {
                preferredFill = enemy.fill;
            }
        }

        if (worldCells.length === 0 || totalMass <= HEXA_HIVE_EPSILON || totalCells <= 0) {
            return null;
        }

        const centerX = weightedCenterX / totalMass;
        const centerY = weightedCenterY / totalMass;
        const baseHeight = weightedBaseHeight / totalCells;
        const mergedRotation = snapHexaRotationDegToSymmetry(
            Math.atan2(weightedRotationSin, weightedRotationCos) * (180 / Math.PI)
        );
        const mergedBaseMoveSpeed = weightedBaseMoveSpeed / totalCells;
        const mergedCurrentMoveSpeed = weightedCurrentMoveSpeed / totalCells;
        const mergedMoveSpeed = Math.max(
            mergedBaseMoveSpeed * HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO,
            mergedCurrentMoveSpeed * HEXA_HIVE_MOVE_SPEED_DECAY
        );
        const mergedWeight = totalWeight * (1 + ((Math.max(1, totalCells) - 1) * HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL));
        const mergedMaxHp = totalMaxHp;
        const mergedHp = Math.min(mergedMaxHp, totalHp + (mergedMaxHp * 0.1));
        const mergedLayout = createHexaHiveLayoutFromWorldCells(worldCells, {
            originX: centerX,
            originY: centerY,
            baseHeight,
            rotationDeg: mergedRotation
        });

        return {
            type: HEXA_HIVE_TYPE,
            hp: mergedHp,
            maxHp: mergedMaxHp,
            atk: totalAtk,
            moveSpeed: mergedMoveSpeed,
            mergeBaseMoveSpeed: mergedBaseMoveSpeed,
            accSpeed: weightedAccSpeed / totalCells,
            size: weightedSize / totalCells,
            weight: mergedWeight,
            rotationResistance: Math.max(1, totalCells),
            projectileHitsToKill: Math.max(0, Math.round(totalProjectileHitsToKill)),
            position: { x: centerX, y: centerY },
            speed: {
                x: weightedSpeedX / Math.max(HEXA_HIVE_EPSILON, totalWeight),
                y: weightedSpeedY / Math.max(HEXA_HIVE_EPSILON, totalWeight)
            },
            acc: { x: 0, y: 0 },
            ai: enemyAI,
            fill: preferredFill,
            alpha: alphaWeight > 0 ? (weightedAlpha / alphaWeight) : 1,
            rotation: mergedRotation,
            angularVelocity: weightedAngularVelocity / Math.max(HEXA_HIVE_EPSILON, totalWeight),
            angularDeceleration: Math.abs(weightedAngularVelocity / Math.max(HEXA_HIVE_EPSILON, totalWeight)),
            hexaHiveLayout: mergedLayout
        };
    }

    /**
     * 요청하신 도형 샘플을 한 화면에 배치합니다.
     * 위치는 모두 중심 좌표 기준입니다.
     */
    buildEnemyShowcase() {
        this.showcaseEnabled = true;
        this.clearEnemies();

        const ww = getSimulationWW();
        const wh = getSimulationObjectWH();
        const startX = ww * 0.25;
        const startY = wh * 0.15;
        const rowGap = wh * 0.1;
        const enemyColor = ColorSchemes?.Title?.Enemy || '#ff6c6c';

        for (let row = 0; row < ENEMY_SHAPE_TYPES.length; row++) {
            const type = ENEMY_SHAPE_TYPES[row];
            this.spawnEnemy(type, {
                size: 1,
                moveSpeed: 1,
                speed: { x: 0, y: 0 },
                fill: enemyColor,
                ai: enemyAI,
                position: {
                    x: startX,
                    y: startY + row * rowGap
                }
            });
        }
    }

    /**
         * 지정된 인덱스에 있는 적을 반납하고, 목록 끝의 엔티티와 위치를 스왑하는 최적화 방식으로 제거합니다.
         * @param {number} index 제거할 적의 인덱스 번호
         * @private
         */
    #releaseEnemyAt(index) {
        const enemy = this.enemies[index];
        if (!enemy) return;
        this.#queueEnemyDespawn(enemy.id);
        if (Number.isInteger(enemy.id)) {
            this.#clearHexaHiveContactPairsForEnemyIds(new Set([enemy.id]));
        }

        this.releaseEnemyToPool(enemy);

        const lastIndex = this.enemies.length - 1;
        if (index !== lastIndex) {
            this.enemies[index] = this.enemies[lastIndex];
        }
        this.enemies.pop();
    }

    /**
     * 워커 미러 동기화에 사용할 구조 변경 명령을 반환하고 큐를 비웁니다.
     * @returns {object[]}
     */
    consumeSimulationCommands() {
        const commands = [];
        if (Array.isArray(this.pendingSimulationCommandState.enemySpawnSnapshots)
            && this.pendingSimulationCommandState.enemySpawnSnapshots.length > 0) {
            commands.push({
                type: GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH,
                enemies: [...this.pendingSimulationCommandState.enemySpawnSnapshots],
                nextEnemyIdCounter: this.enemyIdCounter
            });
        }
        const uniqueEnemyIds = [...new Set(this.pendingSimulationCommandState.enemyDespawnIds)];
        if (uniqueEnemyIds.length > 0) {
            commands.push({
                type: GAME_SCENE_COMMAND_TYPES.DESPAWN_ENEMY_BATCH,
                enemyIds: uniqueEnemyIds,
                nextEnemyIdCounter: this.enemyIdCounter
            });
        }

        this.pendingSimulationCommandState.enemySpawnSnapshots.length = 0;
        this.pendingSimulationCommandState.enemyDespawnIds.length = 0;
        return commands;
    }

    /**
     * @private
     * @param {object} enemy
     * @param {number} fallbackIndex
     * @returns {number}
     */
    #getEnemyDecisionGroup(enemy, fallbackIndex) {
        const sourceId = Number.isInteger(enemy?.id) ? enemy.id : fallbackIndex;
        const mod = sourceId % this.aiDecisionGroupCount;
        return mod < 0 ? mod + this.aiDecisionGroupCount : mod;
    }

    /**
     * @private
     * @param {number|null|undefined} enemyId
     */
    #queueEnemyDespawn(enemyId) {
        if (!Number.isInteger(enemyId)) {
            return;
        }

        this.pendingSimulationCommandState.enemyDespawnIds.push(enemyId);
    }

    /**
     * @private
     * @param {object|null|undefined} enemy
     */
    #queueEnemySpawn(enemy) {
        if (!enemy || typeof enemy.createSimulationSnapshot !== 'function') {
            return;
        }

        this.pendingSimulationCommandState.enemySpawnSnapshots.push(enemy.createSimulationSnapshot());
    }
}

export const getObjectSystem = () => objectSystemInstance;
