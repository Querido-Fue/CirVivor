import { resolveFiniteNumber } from 'util/number_util.js';

/**
 * @class BaseProj
 * @description 원형 투사체 충돌체의 기본 골격입니다.
 * 동일 적 중복 타격 방지를 위해 hitEnemyIds를 유지합니다.
 */
export class BaseProj {
    /**
     * 기본 투사체 상태를 생성합니다.
     */
    constructor() {
        this.reset();
    }

    /**
     * 투사체 데이터를 활성 인스턴스에 반영합니다.
     * @param {object} [data={}]
     * @returns {BaseProj}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'projectile';
        this.radius = resolveFiniteNumber(data.radius, this.radius);
        this.weight = resolveFiniteNumber(data.weight, this.weight);
        this.impactForce = resolveFiniteNumber(data.impactForce, this.impactForce);
        this.piercing = data.piercing === true;
        this.position.x = resolveFiniteNumber(data.position?.x, this.position.x);
        this.position.y = resolveFiniteNumber(data.position?.y, this.position.y);
        this.speed.x = resolveFiniteNumber(data.speed?.x, this.speed.x);
        this.speed.y = resolveFiniteNumber(data.speed?.y, this.speed.y);
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
        return this;
    }

    /**
     * 풀 재사용을 위해 기본 비활성 상태로 되돌립니다.
     */
    reset() {
        this.active = false;
        this.id = -1;
        this.kind = 'projectile';
        this.radius = 8;
        this.weight = 0.2;
        this.impactForce = 1;
        this.piercing = false;
        this.position = { x: 0, y: 0 };
        this.prevPosition = { x: 0, y: 0 };
        this.speed = { x: 0, y: 0 };
        this.hitEnemyIds = new Set();
    }

    /**
     * 매 fixed step 직전에 이전 좌표를 기록합니다.
     */
    beginStep() {
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
    }

    /**
     * 고정 스텝 기준 위치를 갱신합니다.
     * @param {number} delta
     */
    fixedUpdate(delta) {
        this.beginStep();
        this.position.x += this.speed.x * delta;
        this.position.y += this.speed.y * delta;
    }

    /**
     * @param {number} enemyId
     * @returns {boolean}
     */
    hasHitEnemy(enemyId) {
        return Number.isInteger(enemyId) && this.hitEnemyIds.has(enemyId);
    }

    /**
     * @param {number} enemyId
     */
    markEnemyHit(enemyId) {
        if (!Number.isInteger(enemyId)) {
            return;
        }
        this.hitEnemyIds.add(enemyId);
    }

    /**
     * 재사용 시 중복 타격 기록을 초기화합니다.
     */
    clearHitHistory() {
        this.hitEnemyIds.clear();
    }
}
