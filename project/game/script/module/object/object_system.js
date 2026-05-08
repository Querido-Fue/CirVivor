import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { enemyAI } from './enemy/ai/_enemy_ai.js';
import { createEnemyPools } from './enemy/_enemy_pool_factory.js';
import { getHexaHiveType } from './enemy/_hexa_hive_layout.js';
import {
    buildActiveHexaMergeCandidatesById,
    buildHexaHiveSpawnData,
    clearHexaHiveContactPairsForEnemyIds,
    collectHexaHiveMergeGroups,
    collectHexaMergeCandidates,
    syncHexaHiveMergeState
} from './enemy/_hexa_hive_merge.js';
import {
    consumeObjectSystemSimulationCommands,
    createObjectSystemSimulationCommandState,
    queueObjectSystemEnemyDespawn,
    queueObjectSystemEnemySpawn
} from './object_system_simulation_commands.js';
import {
    acquireObjectSystemEnemy,
    releaseObjectSystemEnemyToPool,
    reserveObjectSystemEnemyIds
} from './object_system_enemy_lifecycle.js';
import {
    createObjectSystemSimulationFrameSnapshot,
    createObjectSystemSimulationSnapshot
} from './object_system_snapshot_builder.js';
import {
    clearObjectSystemAISharedCaches,
    createObjectSystemAIContext,
    fixedUpdateActiveObjectList
} from './object_system_fixed_update_helpers.js';
import { PhysicsSystem } from 'physics/physics_system.js';
import { getSimulationObjectWH, getSimulationWW } from 'simulation/simulation_runtime.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_DEFAULT_WEIGHT = getData('ENEMY_DEFAULT_WEIGHT');
const AI_DECISION_GROUP_COUNT = 60;
const AI_DECISION_INTERVAL_SECONDS = 1.0;
const INLINE_ENEMY_AI_QUALITY_PROFILE = 'inline_safe';
const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;
const HEXA_HIVE_TYPE = getHexaHiveType();

let objectSystemInstance = null;

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
        this.pendingSimulationCommandState = createObjectSystemSimulationCommandState();
    }

    /**
     * 오브젝트 시스템을 초기화합니다.
     */
    async init() {
        this.enemyPools = createEnemyPools();
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

        fixedUpdateActiveObjectList(this.players, delta);
        fixedUpdateActiveObjectList(this.items, delta);
        fixedUpdateActiveObjectList(this.projectiles, delta);

        const decisionGroup = this.aiDecisionGroupCursor;
        this.aiDecisionGroupCursor = (this.aiDecisionGroupCursor + 1) % this.aiDecisionGroupCount;
        clearObjectSystemAISharedCaches(this);
        const aiContext = createObjectSystemAIContext({
            player: this.getPrimaryPlayer(),
            walls: this.walls,
            enemies: this.enemies,
            decisionInterval: this.aiDecisionIntervalSeconds,
            decisionGroup,
            enemyAIQualityProfile: INLINE_ENEMY_AI_QUALITY_PROFILE,
            sharedFlowFieldByKey: this.aiSharedFlowFieldByKey,
            sharedDirectPathByKey: this.aiSharedDirectPathByKey,
            sharedDensityFieldByKey: this.aiSharedDensityFieldByKey,
            sharedPolicyTargetByKey: this.aiSharedPolicyTargetByKey,
            wallsVersion: this.aiWallsVersion
        });

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
        const hexaMergeCandidatesById = syncHexaHiveMergeState({
            enemies: this.enemies,
            contactSecondsByPair: this.hexaHiveContactSecondsByPair,
            delta,
            contactPairs: hexaContactPairs
        });
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
        const result = acquireObjectSystemEnemy({
            enemyPools: this.enemyPools,
            type,
            data,
            enemyIdCounter: this.enemyIdCounter,
            enemyDefaultWeight: ENEMY_DEFAULT_WEIGHT
        });
        this.enemyIdCounter = result.enemyIdCounter;
        return result.enemy;
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
        releaseObjectSystemEnemyToPool(enemy, this.enemyPools, this.enemyById);
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
        const reservation = reserveObjectSystemEnemyIds(this.enemyIdCounter, count);
        this.enemyIdCounter = reservation.nextEnemyIdCounter;
        return reservation.reservedIds;
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
        return createObjectSystemSimulationFrameSnapshot({
            enemyIdCounter: this.enemyIdCounter,
            enemies: this.enemies
        });
    }

    /**
     * 현재 오브젝트 시스템의 읽기 전용 시뮬레이션 스냅샷을 생성합니다.
     * 현재는 워커 분리 우선순위가 높은 적 상태 위주로 직렬화합니다.
     * @returns {{showcaseEnabled: boolean, enemyIdCounter: number, aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number, enemies: object[]}}
     */
    createSimulationSnapshot() {
        return createObjectSystemSimulationSnapshot({
            showcaseEnabled: this.showcaseEnabled,
            enemyIdCounter: this.enemyIdCounter,
            aiDecisionGroupCursor: this.aiDecisionGroupCursor,
            aiDecisionGroupCount: this.aiDecisionGroupCount,
            aiDecisionIntervalSeconds: this.aiDecisionIntervalSeconds,
            enemyCullOutsideRatio: this.enemyCullOutsideRatio,
            enemies: this.enemies
        });
    }

    /**
     * 현재 접촉 중인 육각형/합체 육각형 쌍을 exact 판정으로 수집합니다.
     * @param {number} delta
     * @returns {{enemyA: object, enemyB: object}[]}
     */
    collectHexaHiveContactPairs(delta) {
        const mergeCandidates = collectHexaMergeCandidates(this.enemies);
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
        const mergeGroups = collectHexaHiveMergeGroups(
            this.hexaHiveContactSecondsByPair,
            activeMergeCandidatesById instanceof Map
                ? activeMergeCandidatesById
                : buildActiveHexaMergeCandidatesById(this.enemies)
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

            const spawnData = buildHexaHiveSpawnData(mergeGroup);
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

        clearHexaHiveContactPairsForEnemyIds(this.hexaHiveContactSecondsByPair, releaseIds);

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
     * @returns {{collisionCheckCount:number, aabbPassCount:number, aabbRejectCount:number, circlePassCount:number, circleRejectCount:number, partChecks:number}}
     */
    getCollisionStats() {
        if (!this.physicsSystem || typeof this.physicsSystem.getCollisionStats !== 'function') {
            return {
                collisionCheckCount: 0,
                aabbPassCount: 0,
                aabbRejectCount: 0,
                circlePassCount: 0,
                circleRejectCount: 0,
                partChecks: 0
            };
        }
        return this.physicsSystem.getCollisionStats();
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
            clearHexaHiveContactPairsForEnemyIds(this.hexaHiveContactSecondsByPair, new Set([enemy.id]));
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
        return consumeObjectSystemSimulationCommands(this.pendingSimulationCommandState, this.enemyIdCounter);
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
        queueObjectSystemEnemyDespawn(this.pendingSimulationCommandState, enemyId);
    }

    /**
     * @private
     * @param {object|null|undefined} enemy
     */
    #queueEnemySpawn(enemy) {
        queueObjectSystemEnemySpawn(this.pendingSimulationCommandState, enemy);
    }
}

export const getObjectSystem = () => objectSystemInstance;
