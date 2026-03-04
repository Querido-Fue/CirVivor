/**
 * @class Player
 * @description 원형 플레이어 충돌체의 기본 골격입니다.
 */
export class Player {
    constructor() {
        this.reset();
    }

    /**
     * @param {object} [data={}]
     * @returns {Player}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'player';
        this.radius = Number.isFinite(data.radius) ? data.radius : this.radius;
        this.weight = Number.isFinite(data.weight) ? data.weight : this.weight;
        this.position.x = Number.isFinite(data.position?.x) ? data.position.x : this.position.x;
        this.position.y = Number.isFinite(data.position?.y) ? data.position.y : this.position.y;
        this.speed.x = Number.isFinite(data.speed?.x) ? data.speed.x : this.speed.x;
        this.speed.y = Number.isFinite(data.speed?.y) ? data.speed.y : this.speed.y;
        return this;
    }

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
     * @param {number} delta
     */
    fixedUpdate(delta) {
        this.position.x += this.speed.x * delta;
        this.position.y += this.speed.y * delta;
    }
}
