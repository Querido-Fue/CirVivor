import { getDelta, getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { enemyAI } from './enemy/ai/_enemy_ai.js';
import { createEnemyPools } from './enemy/_enemy_pool_factory.js';
import {
    clearHexaHiveContactPairsForEnemyIds,
    syncHexaHiveMergePresentationState,
    syncHexaHiveMergeState
} from './enemy/_hexa_hive_merge.js';
import {
    acquireObjectSystemEnemy,
    releaseObjectSystemEnemyToPool,
    reserveObjectSystemEnemyIds
} from './object_system_enemy_lifecycle.js';
import {
    clearObjectSystemAISharedCaches,
    createObjectSystemAIContext,
    fixedUpdateActiveObjectList,
    fixedUpdateObjectSystemEnemies
} from './object_system_fixed_update_helpers.js';
import {
    collectObjectSystemHexaHiveContactPairs,
    resolveObjectSystemHexaHiveMerges
} from './object_system_hexa_hive_orchestration.js';
import { drawObjectSystemHexaHiveMergeEffects } from './object_system_hexa_hive_presentation.js';
import { updateObjectSystemEnemies } from './object_system_update_helpers.js';
import { PhysicsSystem } from 'physics/physics_system.js';
import { getSimulationObjectWH, getSimulationWW } from 'simulation/simulation_runtime.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_DEFAULT_WEIGHT = getData('ENEMY_DEFAULT_WEIGHT');
const ENEMY_AI_CONSTANTS = getData('ENEMY_AI_CONSTANTS');
const AI_DECISION_GROUP_COUNT = 60;
const AI_DECISION_INTERVAL_SECONDS = 1.0;
const DEFAULT_ENEMY_AI_QUALITY_PROFILE = ENEMY_AI_CONSTANTS.DEFAULT_QUALITY_PROFILE;
const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;

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
        this.aiSharedDensityFieldByKey = new Map();
        this.aiSharedPolicyTargetByKey = new Map();
        this.aiWallsVersion = 0;
        this.enemyCullOutsideRatio = DEFAULT_OUTSIDE_CULL_RATIO;
        this.hexaHiveContactSecondsByPair = new Map();
        this.hexaHiveMergeEffectPairs = [];
        this.hexaHiveMergeEffectPairPool = [];
        this.hexaHiveActiveMergeCandidatesById = new Map();
        this.hexaHivePullOffsetById = new Map();
        this.enemyReleaseIdScratch = new Set();
        this._releaseEnemyAtCallback = (index) => this.#releaseEnemyAt(index);
        this._spawnEnemyCallback = (type, data) => this.spawnEnemy(type, data);
        this.enemyAcquireResult = { enemy: null, enemyIdCounter: 0 };
        this.enemyAcquireOptions = {
            enemyPools: this.enemyPools,
            type: null,
            data: null,
            enemyIdCounter: 0,
            enemyDefaultWeight: ENEMY_DEFAULT_WEIGHT,
            result: this.enemyAcquireResult
        };
        this.enemyUpdateOptions = {
            enemies: this.enemies,
            alpha: 0,
            delta: 0,
            ww: 0,
            objectWH: 0,
            enemyCullOutsideRatio: this.enemyCullOutsideRatio,
            releaseEnemyAt: this._releaseEnemyAtCallback
        };
        this.aiContext = createObjectSystemAIContext();
        this.enemyFixedUpdateOptions = {
            enemies: this.enemies,
            delta: 0,
            aiContext: this.aiContext,
            decisionGroup: 0,
            decisionGroupCount: this.aiDecisionGroupCount,
            releaseEnemyAt: this._releaseEnemyAtCallback
        };
        this.hexaContactOptions = {
            enemies: this.enemies,
            physicsSystem: this.physicsSystem,
            delta: 0
        };
        this.hexaMergeStateOptions = {
            enemies: this.enemies,
            activeMergeCandidatesById: this.hexaHiveActiveMergeCandidatesById,
            contactSecondsByPair: this.hexaHiveContactSecondsByPair,
            delta: 0,
            contactPairs: null
        };
        this.enemyCollisionOptions = { delta: 0, players: this.players };
        this.hexaMergePresentationOptions = {
            activeMergeCandidatesById: this.hexaHiveActiveMergeCandidatesById,
            contactSecondsByPair: this.hexaHiveContactSecondsByPair,
            effectPairs: this.hexaHiveMergeEffectPairs,
            effectPairPool: this.hexaHiveMergeEffectPairPool,
            pullOffsetById: this.hexaHivePullOffsetById
        };
        this.hexaMergeResolveOptions = {
            enemies: this.enemies,
            contactSecondsByPair: this.hexaHiveContactSecondsByPair,
            activeMergeCandidatesById: this.hexaHiveActiveMergeCandidatesById,
            releaseEnemyAt: this._releaseEnemyAtCallback,
            spawnEnemy: this._spawnEnemyCallback
        };
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
        const options = this.enemyUpdateOptions;
        options.enemies = this.enemies;
        options.alpha = getFixedInterpolationAlpha();
        options.delta = getDelta();
        options.ww = getSimulationWW();
        options.objectWH = getSimulationObjectWH();
        options.enemyCullOutsideRatio = this.enemyCullOutsideRatio;
        updateObjectSystemEnemies(options);
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
        const aiContext = this.aiContext;
        aiContext.player = this.getPrimaryPlayer();
        aiContext.walls = this.walls;
        aiContext.enemies = this.enemies;
        aiContext.decisionInterval = this.aiDecisionIntervalSeconds;
        aiContext.decisionGroup = decisionGroup;
        aiContext.enemyAIQualityProfile = DEFAULT_ENEMY_AI_QUALITY_PROFILE;
        aiContext.sharedFlowFieldByKey = this.aiSharedFlowFieldByKey;
        aiContext.sharedDensityFieldByKey = this.aiSharedDensityFieldByKey;
        aiContext.sharedPolicyTargetByKey = this.aiSharedPolicyTargetByKey;
        aiContext.wallsVersion = this.aiWallsVersion;

        const fixedOptions = this.enemyFixedUpdateOptions;
        fixedOptions.enemies = this.enemies;
        fixedOptions.delta = delta;
        fixedOptions.decisionGroup = decisionGroup;
        fixedOptions.decisionGroupCount = this.aiDecisionGroupCount;
        fixedUpdateObjectSystemEnemies(fixedOptions);

        const hexaContactPairs = this.collectHexaHiveContactPairs(delta);
        const mergeStateOptions = this.hexaMergeStateOptions;
        mergeStateOptions.enemies = this.enemies;
        mergeStateOptions.delta = delta;
        mergeStateOptions.contactPairs = hexaContactPairs;
        const hexaMergeCandidatesById = syncHexaHiveMergeState(mergeStateOptions);
        this.enemyCollisionOptions.delta = delta;
        this.enemyCollisionOptions.players = this.players;
        this.resolveEnemyCollisions(this.enemies, this.enemyCollisionOptions);
        this.resolveProjectileVsEnemies(this.projectiles, this.enemies, delta);
        for (const [enemyId, enemy] of hexaMergeCandidatesById) {
            if (!enemy || enemy.active === false) {
                hexaMergeCandidatesById.delete(enemyId);
            }
        }
        const presentationOptions = this.hexaMergePresentationOptions;
        presentationOptions.activeMergeCandidatesById = hexaMergeCandidatesById;
        this.hexaHiveMergeEffectPairs = syncHexaHiveMergePresentationState(presentationOptions);
        if (this.resolveHexaHiveMerges(hexaMergeCandidatesById) > 0) {
            this.hexaHiveMergeEffectPairs.length = 0;
        }
    }

    /**
     * 모든 오브젝트를 그립니다.
     */
    draw() {
        for (let i = 0; i < this.enemies.length; i++) {
            this.enemies[i].draw();
        }
        drawObjectSystemHexaHiveMergeEffects(this.hexaHiveMergeEffectPairs);
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
        const options = this.enemyAcquireOptions;
        options.enemyPools = this.enemyPools;
        options.type = type;
        options.data = data;
        options.enemyIdCounter = this.enemyIdCounter;
        const result = acquireObjectSystemEnemy(options);
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
        this.hexaHiveMergeEffectPairs.length = 0;
        this.hexaHiveActiveMergeCandidatesById.clear();
        this.hexaHivePullOffsetById.clear();
        for (let i = 0; i < this.hexaHiveMergeEffectPairPool.length; i++) {
            const pair = this.hexaHiveMergeEffectPairPool[i];
            if (!pair) continue;
            pair.enemyA = null;
            pair.enemyB = null;
            pair.progress = 0;
        }
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
     * 일괄 생성 명령과 ID를 맞출 때 사용합니다.
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
     * 현재 접촉 중인 육각형/합체 육각형 쌍을 exact 판정으로 수집합니다.
     * @param {number} delta
     * @returns {{enemyA: object, enemyB: object}[]}
     */
    collectHexaHiveContactPairs(delta) {
        const options = this.hexaContactOptions;
        options.enemies = this.enemies;
        options.physicsSystem = this.physicsSystem;
        options.delta = delta;
        return collectObjectSystemHexaHiveContactPairs(options);
    }

    /**
     * 누적 접촉 시간을 기준으로 육각형 그룹 합체를 수행합니다.
     * @param {Map<number, object>|null} [activeMergeCandidatesById=null]
     * @returns {number}
     */
    resolveHexaHiveMerges(activeMergeCandidatesById = null) {
        const options = this.hexaMergeResolveOptions;
        options.enemies = this.enemies;
        options.contactSecondsByPair = this.hexaHiveContactSecondsByPair;
        options.activeMergeCandidatesById = activeMergeCandidatesById;
        return resolveObjectSystemHexaHiveMerges(options);
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
        if (Number.isInteger(enemy.id)) {
            const enemyIds = this.enemyReleaseIdScratch;
            enemyIds.clear();
            enemyIds.add(enemy.id);
            clearHexaHiveContactPairsForEnemyIds(this.hexaHiveContactSecondsByPair, enemyIds);
            enemyIds.clear();
        }
        if (Array.isArray(this.hexaHiveMergeEffectPairs) && this.hexaHiveMergeEffectPairs.length > 0) {
            let writeIndex = 0;
            for (let readIndex = 0; readIndex < this.hexaHiveMergeEffectPairs.length; readIndex++) {
                const pair = this.hexaHiveMergeEffectPairs[readIndex];
                if (pair?.enemyA === enemy || pair?.enemyB === enemy) {
                    continue;
                }
                this.hexaHiveMergeEffectPairs[writeIndex++] = pair;
            }
            this.hexaHiveMergeEffectPairs.length = writeIndex;
        }

        this.releaseEnemyToPool(enemy);

        const lastIndex = this.enemies.length - 1;
        if (index !== lastIndex) {
            this.enemies[index] = this.enemies[lastIndex];
        }
        this.enemies.pop();
    }
}

export const getObjectSystem = () => objectSystemInstance;
