/**
 * @class BaseWall
 * @description 정적 직사각형 벽 충돌체의 기본 골격입니다.
 * wall은 항상 이동하지 않는 정적 물체입니다.
 */
export class BaseWall {
    constructor() {
        this.reset();
    }

    /**
     * @param {object} [data={}]
     * @returns {BaseWall}
     */
    init(data = {}) {
        this.active = true;
        this.id = Number.isInteger(data.id) ? data.id : this.id;
        this.kind = 'wall';
        this.x = Number.isFinite(data.x) ? data.x : this.x;
        this.y = Number.isFinite(data.y) ? data.y : this.y;
        this.w = Number.isFinite(data.w) ? data.w : this.w;
        this.h = Number.isFinite(data.h) ? data.h : this.h;
        this.origin = data.origin === 'topleft' ? 'topleft' : 'center';
        return this;
    }

    reset() {
        this.active = false;
        this.id = -1;
        this.kind = 'wall';
        this.x = 0;
        this.y = 0;
        this.w = 100;
        this.h = 20;
        this.origin = 'center';
    }

    /**
     * CollisionHandler가 읽는 공통 포맷을 제공합니다.
     * @returns {{id:number, x:number, y:number, w:number, h:number, origin:string, isCenter:boolean}}
     */
    getCollisionRect() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            w: this.w,
            h: this.h,
            origin: this.origin,
            isCenter: this.origin === 'center'
        };
    }
}
