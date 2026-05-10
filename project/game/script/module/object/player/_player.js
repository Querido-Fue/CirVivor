import { resolveFiniteNumber } from 'util/number_util.js';

/**
 * @class Player
 * @description 원형 플레이어 충돌체의 기본 골격입니다.
 */
export class Player {
    /**
     * 기본 플레이어 상태를 생성합니다.
     */
    constructor() {
        this.reset();
    }

    /**
     * 플레이어 데이터를 활성 인스턴스에 반영합니다.
     * @param {object} [data={}]
     * @returns {Player}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'player';
        this.radius = resolveFiniteNumber(data.radius, this.radius);
        this.weight = resolveFiniteNumber(data.weight, this.weight);
        this.position.x = resolveFiniteNumber(data.position?.x, this.position.x);
        this.position.y = resolveFiniteNumber(data.position?.y, this.position.y);
        this.speed.x = resolveFiniteNumber(data.speed?.x, this.speed.x);
        this.speed.y = resolveFiniteNumber(data.speed?.y, this.speed.y);
        return this;
    }

    /**
     * 풀 재사용을 위해 기본 비활성 상태로 되돌립니다.
     */
    reset() {
        this.active = false;
        this.id = -1;
        this.kind = 'player';
        this.radius = 24;
        this.weight = 1;
        this.position = { x: 0, y: 0 };
        this.speed = { x: 0, y: 0 };
    }

    /**
     * 고정 스텝 기준 위치를 갱신합니다.
     * @param {number} delta
     */
    fixedUpdate(delta) {
        this.position.x += this.speed.x * delta;
        this.position.y += this.speed.y * delta;
    }
}
