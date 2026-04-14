/**
 * @class BaseProj
 * @description 원형 투사체 충돌체의 기본 골격입니다.
 * 동일 적 중복 타격 방지를 위해 hitEnemyIds를 유지합니다.
 */
export class BaseProj {
    constructor() {
        this.reset();
    }

    /**
     * @param {object} [data={}]
     * @returns {BaseProj}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'projectile';
        this.radius = Number.isFinite(data.radius) ? data.radius : this.radius;
        this.weight = Number.isFinite(data.weight) ? data.weight : this.weight;
        this.impactForce = Number.isFinite(data.impactForce) ? data.impactForce : this.impactForce;
        this.piercing = data.piercing === true;
        this.position.x = Number.isFinite(data.position?.x) ? data.position.x : this.position.x;
        this.position.y = Number.isFinite(data.position?.y) ? data.position.y : this.position.y;
        this.speed.x = Number.isFinite(data.speed?.x) ? data.speed.x : this.speed.x;
        this.speed.y = Number.isFinite(data.speed?.y) ? data.speed.y : this.speed.y;
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
        return this;
    }

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
        if (!Number.isInteger(enemyId)) return;
        this.hitEnemyIds.add(enemyId);
    }

    /**
     * 재사용 시 중복 타격 기록 초기화
     */
    clearHitHistory() {
        this.hitEnemyIds.clear();
    }

    /**
     * 현재 투사체의 프레임 동기화용 동적 상태만 복제합니다.
     * @returns {{id: number, active: boolean, position: {x: number, y: number}, prevPosition: {x: number, y: number}, speed: {x: number, y: number}}}
     */
    createSimulationFrameSnapshot() {
        return {
            id: Number.isInteger(this.id) ? this.id : -1,
            active: this.active === true,
            position: {
                x: Number.isFinite(this.position?.x) ? this.position.x : 0,
                y: Number.isFinite(this.position?.y) ? this.position.y : 0
            },
            prevPosition: {
                x: Number.isFinite(this.prevPosition?.x) ? this.prevPosition.x : 0,
                y: Number.isFinite(this.prevPosition?.y) ? this.prevPosition.y : 0
            },
            speed: {
                x: Number.isFinite(this.speed?.x) ? this.speed.x : 0,
                y: Number.isFinite(this.speed?.y) ? this.speed.y : 0
            }
        };
    }
}
