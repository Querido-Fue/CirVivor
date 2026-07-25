/**
 * The Tower의 현재 첫 구현 기본값입니다.
 * @type {Readonly<{RADIUS:number,MOVE_SPEED:number}>}
 */
export const THE_TOWER_DEFAULTS = Object.freeze({
    RADIUS: 24,
    MOVE_SPEED: 260
});

/**
 * 유한한 0 이상 월드 축 크기를 반환합니다.
 * @param {*} value - 정규화할 크기입니다.
 * @returns {number} 정규화된 크기입니다.
 */
function normalizeWorldSize(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

/**
 * 원 중심 좌표를 한 월드 축의 내부로 제한합니다.
 * 월드가 지름보다 작으면 축 중앙에 고정합니다.
 * @param {number} value - 제한할 중심 좌표입니다.
 * @param {number} size - 월드 축 크기입니다.
 * @param {number} radius - 원 반지름입니다.
 * @returns {number} 제한된 중심 좌표입니다.
 */
function clampCircleAxis(value, size, radius) {
    if (size <= radius * 2) {
        return size * 0.5;
    }
    return Math.min(size - radius, Math.max(radius, value));
}

/**
 * @class TheTower
 * @description HP 없이 위치·이동 의도·렌더 보간 상태만 소유하는 파란 Tower 엔티티입니다.
 */
export class TheTower {
    /**
     * @param {{x?:number,y?:number,radius?:number,moveSpeed?:number}} [options={}] - 생성 옵션입니다.
     */
    constructor(options = {}) {
        const radius = Number(options.radius);
        const moveSpeed = Number(options.moveSpeed);
        const x = Number(options.x);
        const y = Number(options.y);

        this.id = 'the-tower';
        this.kind = 'tower';
        this.active = true;
        this.radius = Number.isFinite(radius) && radius > 0
            ? radius
            : THE_TOWER_DEFAULTS.RADIUS;
        this.moveSpeed = Number.isFinite(moveSpeed) && moveSpeed >= 0
            ? moveSpeed
            : THE_TOWER_DEFAULTS.MOVE_SPEED;
        this.position = {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0
        };
        this.previousPosition = { ...this.position };
        this.renderPosition = { ...this.position };
        this.moveIntent = { x: 0, y: 0 };
    }

    /**
     * 다음 fixed tick에 적용할 정규화된 이동 의도를 기록합니다.
     * @param {*} x - X축 이동 의도입니다.
     * @param {*} y - Y축 이동 의도입니다.
     * @returns {void}
     */
    setMoveIntent(x, y) {
        const nextX = Number(x);
        const nextY = Number(y);
        let safeX = Number.isFinite(nextX) ? nextX : 0;
        let safeY = Number.isFinite(nextY) ? nextY : 0;
        const magnitude = Math.hypot(safeX, safeY);
        if (magnitude > 1) {
            safeX /= magnitude;
            safeY /= magnitude;
        }
        this.moveIntent.x = safeX;
        this.moveIntent.y = safeY;
    }

    /**
     * 고정 시간축에서 이동을 적분하고 Tower를 월드 경계 안에 유지합니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @param {{ww?:number,objectWH?:number}} viewport - 현재 월드 뷰포트입니다.
     * @returns {void}
     */
    fixedUpdate(delta, viewport) {
        if (!this.active) {
            return;
        }

        const safeDelta = Number(delta);
        if (!Number.isFinite(safeDelta) || safeDelta <= 0) {
            return;
        }

        this.previousPosition.x = this.position.x;
        this.previousPosition.y = this.position.y;
        this.position.x += this.moveIntent.x * this.moveSpeed * safeDelta;
        this.position.y += this.moveIntent.y * this.moveSpeed * safeDelta;
        this.#clampPosition(viewport);
    }

    /**
     * 이전 fixed 위치와 현재 위치 사이의 렌더 좌표를 계산합니다.
     * @param {number} alpha - 0~1 보간 계수입니다.
     * @returns {void}
     */
    updateRenderPosition(alpha) {
        const numericAlpha = Number(alpha);
        const safeAlpha = Number.isFinite(numericAlpha)
            ? Math.min(1, Math.max(0, numericAlpha))
            : 0;
        this.renderPosition.x = this.previousPosition.x
            + ((this.position.x - this.previousPosition.x) * safeAlpha);
        this.renderPosition.y = this.previousPosition.y
            + ((this.position.y - this.previousPosition.y) * safeAlpha);
    }

    /**
     * resize에서 월드를 재생성하지 않고 현재 위치만 새 경계 안으로 제한합니다.
     * @param {{ww?:number,objectWH?:number}} viewport - 새 월드 뷰포트입니다.
     * @returns {void}
     */
    resize(viewport) {
        this.#clampPosition(viewport);
        this.previousPosition.x = this.position.x;
        this.previousPosition.y = this.position.y;
        this.renderPosition.x = this.position.x;
        this.renderPosition.y = this.position.y;
    }

    /**
     * 엔티티를 비활성화하고 남은 이동 의도를 제거합니다.
     * @returns {void}
     */
    destroy() {
        this.active = false;
        this.setMoveIntent(0, 0);
    }

    /**
     * 현재 위치를 월드 경계 안으로 제한합니다.
     * @param {{ww?:number,objectWH?:number}} viewport - 현재 월드 뷰포트입니다.
     * @returns {void}
     * @private
     */
    #clampPosition(viewport) {
        const width = normalizeWorldSize(viewport?.ww);
        const height = normalizeWorldSize(viewport?.objectWH);
        this.position.x = clampCircleAxis(this.position.x, width, this.radius);
        this.position.y = clampCircleAxis(this.position.y, height, this.radius);
    }
}
