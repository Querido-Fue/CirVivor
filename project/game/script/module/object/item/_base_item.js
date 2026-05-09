import { resolveFiniteNumber } from 'util/number_util.js';

/**
 * @class BaseItem
 * @description 원형 아이템 충돌체의 기본 골격입니다.
 */
export class BaseItem {
    /**
     * 기본 아이템 상태를 생성합니다.
     */
    constructor() {
        this.reset();
    }

    /**
     * 아이템 데이터를 활성 인스턴스에 반영합니다.
     * @param {object} [data={}]
     * @returns {BaseItem}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'item';
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
        this.kind = 'item';
        this.radius = 10;
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
