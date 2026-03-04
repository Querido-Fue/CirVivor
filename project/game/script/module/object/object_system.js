import { getObjectWH, getWW } from 'display/display_system.js';
import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { ObjectPool } from './_object_pool.js';
import { getData } from 'data/data_handler.js';
import { SquareEnemy } from './enemy/_square_enemy.js';
import { TriangleEnemy } from './enemy/_triangle_enemy.js';
import { ArrowEnemy } from './enemy/_arrow_enemy.js';
import { HexaEnemy } from './enemy/_hexa_enemy.js';
import { PentaEnemy } from './enemy/_penta_enemy.js';
import { RhomEnemy } from './enemy/_rhom_enemy.js';
import { OctaEnemy } from './enemy/_octa_enemy.js';
import { GenEnemy } from './enemy/_gen_enemy.js';
import { tempAI } from './enemy/ai/_temp_ai.js';
import { PhysicsSystem } from 'physics/physics_system.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const ENEMY_DEFAULT_WEIGHT = getData('ENEMY_DEFAULT_WEIGHT');
const AI_DECISION_GROUP_COUNT = 60;
const AI_DECISION_INTERVAL_SECONDS = 1.0;
const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;

let objectSystemInstance = null;
const ENEMY_CLASS_BY_TYPE = {
    square: SquareEnemy,
    triangle: TriangleEnemy,
    arrow: ArrowEnemy,
    hexa: HexaEnemy,
    penta: PentaEnemy,
    rhom: RhomEnemy,
    octa: OctaEnemy,
    gen: GenEnemy
};

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
        this.enemyCullOutsideRatio = DEFAULT_OUTSIDE_CULL_RATIO;
    }

    /**
     * 오브젝트 시스템을 초기화합니다.
     */
    async init() {
        for (const type of ENEMY_SHAPE_TYPES) {
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
        const ww = getWW();
        const objectWH = getObjectWH();

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
        const aiContext = {
            player: this.getPrimaryPlayer(),
            walls: this.walls,
            shouldUpdateDecision: false,
            decisionInterval: this.aiDecisionIntervalSeconds,
            decisionGroup
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

        this.resolveEnemyCollisions(this.enemies, {
            delta,
            players: this.players
        });
        this.resolveProjectileVsEnemies(this.projectiles, this.enemies, delta);
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
         * @param {'square'|'triangle'|'arrow'|'hexa'|'penta'|'rhom'|'octa'|'gen'} type 대상 적의 형태 타입
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
            projectileHitsToKill: data.projectileHitsToKill ?? 0,
            position: data.position ?? { x: getWW() * 0.5, y: getObjectWH() * 0.5 },
            speed: data.speed ?? { x: 0, y: 0 },
            acc: data.acc ?? { x: 0, y: 0 },
            status: data.status,
            ai: data.ai ?? null,
            fill: data.fill,
            alpha: data.alpha,
            rotation: data.rotation
        });

        return enemy;
    }

    /**
         * 지정된 타입의 적을 오브젝트 풀에서 꺼내어 활성화 큐에 추가합니다.
         * @param {'square'|'triangle'|'arrow'|'hexa'|'penta'|'rhom'|'octa'|'gen'} type 대상 적의 형태 타입
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

        this.tempPlayer.position.x = getWW() * 0.5;
        this.tempPlayer.position.y = getObjectWH() * 0.5;
        return this.tempPlayer;
    }

    /**
     * 고정형 벽 충돌체 목록을 등록합니다.
     * @param {object[]} walls
     */
    setWalls(walls = []) {
        this.walls = Array.isArray(walls) ? walls : [];
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
     * @returns {{roughCircleChecks:number, polygonChecks:number, projectileEnemyChecks:number}}
     */
    getCollisionStats() {
        if (!this.physicsSystem || typeof this.physicsSystem.getCollisionStats !== 'function') {
            return { roughCircleChecks: 0, polygonChecks: 0, projectileEnemyChecks: 0 };
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

        const ww = getWW();
        const wh = getObjectWH();
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
                ai: tempAI,
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

        this.releaseEnemyToPool(enemy);

        const lastIndex = this.enemies.length - 1;
        if (index !== lastIndex) {
            this.enemies[index] = this.enemies[lastIndex];
        }
        this.enemies.pop();
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
}

export const getObjectSystem = () => objectSystemInstance;
