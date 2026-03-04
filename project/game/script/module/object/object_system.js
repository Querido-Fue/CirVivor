import { getWH, getWW } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
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

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');

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
        const delta = getDelta();
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy || !enemy.active) {
                this._releaseEnemyAt(i);
                continue;
            }

            if (enemy.status && enemy.status.remainingTime > 0) {
                enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - delta);
                if (enemy.status.remainingTime === 0) {
                    enemy.clearStatus();
                }
            }

            enemy.update(delta);
        }
    }

    /**
     * 모든 오브젝트를 그립니다.
     */
    draw() {
        for (const enemy of this.enemies) {
            enemy.draw();
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
        const enemyId = data.id ?? `enemy_${this.enemyIdCounter++}`;
        enemy.init({
            id: enemyId,
            type,
            hp: data.hp ?? 1,
            maxHp: data.maxHp ?? 1,
            atk: data.atk ?? 1,
            moveSpeed: data.moveSpeed ?? 0,
            accSpeed: data.accSpeed ?? 0,
            size: data.size ?? 1,
            Weight: data.Weight ?? data.weight ?? 1,
            position: data.position ?? { x: getWW() * 0.5, y: getWH() * 0.5 },
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
            this._releaseEnemyAt(index);
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
            this._releaseEnemyAt(i);
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
     * 요청하신 도형 샘플을 한 화면에 배치합니다.
     * 위치는 모두 중심 좌표 기준입니다.
     */
    buildEnemyShowcase() {
        this.showcaseEnabled = true;
        this.clearEnemies();

        const ww = getWW();
        const wh = getWH();
        const startX = ww * 0.25;
        const startY = wh * 0.15;
        const rowGap = wh * 0.1;
        const enemyColor = ColorSchemes?.Title?.Enemy || '#ff6c6c';

        for (let row = 0; row < ENEMY_SHAPE_TYPES.length; row++) {
            const type = ENEMY_SHAPE_TYPES[row];
            this.spawnEnemy(type, {
                size: 1,
                fill: enemyColor,
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
    _releaseEnemyAt(index) {
        const enemy = this.enemies[index];
        if (!enemy) return;

        this.releaseEnemyToPool(enemy);

        const lastIndex = this.enemies.length - 1;
        if (index !== lastIndex) {
            this.enemies[index] = this.enemies[lastIndex];
        }
        this.enemies.pop();
    }
}

export const getObjectSystem = () => objectSystemInstance;
