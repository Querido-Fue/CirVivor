/**
 * 유한한 0 이상 크기를 반환합니다.
 * @param {*} value - 원본 값입니다.
 * @returns {number} 안전한 크기입니다.
 */
function normalizeSize(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

/**
 * 월드 전체가 viewport 안에 들어오는 균일 배율을 계산합니다.
 * @param {number} worldWidth - 월드 너비입니다.
 * @param {number} worldHeight - 월드 높이입니다.
 * @param {number} viewportWidth - viewport 너비입니다.
 * @param {number} viewportHeight - viewport 높이입니다.
 * @returns {number} contain 배율입니다.
 */
function resolveContainScale(
    worldWidth,
    worldHeight,
    viewportWidth,
    viewportHeight
) {
    if (worldWidth <= 0
        || worldHeight <= 0
        || viewportWidth <= 0
        || viewportHeight <= 0) {
        return 0;
    }
    return Math.min(
        viewportWidth / worldWidth,
        viewportHeight / worldHeight
    );
}

/**
 * @class WorldCamera2D
 * @description 전체 타일 월드를 현재 viewport에 contain하는 직교 projection입니다.
 */
export class WorldCamera2D {
    constructor() {
        this.worldWidth = 0;
        this.worldHeight = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        this.scale = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.projectionRevision = 0;
        this.viewBounds = { left: 0, top: 0, right: 0, bottom: 0 };
    }

    /**
     * 월드 크기와 초기 viewport를 설정합니다.
     * @param {{width:number,height:number}} worldBounds - 월드 크기입니다.
     * @param {{ww:number,wh:number}} viewport - 실제 표시 viewport입니다.
     * @returns {void}
     */
    init(worldBounds, viewport) {
        this.worldWidth = normalizeSize(worldBounds?.width);
        this.worldHeight = normalizeSize(worldBounds?.height);
        this.viewBounds.left = 0;
        this.viewBounds.top = 0;
        this.viewBounds.right = this.worldWidth;
        this.viewBounds.bottom = this.worldHeight;
        this.resize(viewport);
    }

    /**
     * viewport에 맞춰 contain 배율과 중앙 오프셋을 다시 계산합니다.
     * 월드 좌표와 물리 상태는 변경하지 않습니다.
     * @param {{ww:number,wh:number}} viewport - 실제 표시 viewport입니다.
     * @returns {void}
     */
    resize(viewport) {
        this.viewportWidth = normalizeSize(viewport?.ww);
        this.viewportHeight = normalizeSize(viewport?.wh);
        this.scale = resolveContainScale(
            this.worldWidth,
            this.worldHeight,
            this.viewportWidth,
            this.viewportHeight
        );
        this.offsetX = (
            this.viewportWidth - (this.worldWidth * this.scale)
        ) * 0.5;
        this.offsetY = (
            this.viewportHeight - (this.worldHeight * this.scale)
        ) * 0.5;
        this.projectionRevision++;
    }

    /** @returns {object} 현재 월드 기준 view bounds입니다. */
    getViewBounds() {
        return this.viewBounds;
    }

    /** @returns {number} projection 변경 revision입니다. */
    getProjectionRevision() {
        return this.projectionRevision;
    }

    /** @returns {number} 한 월드 단위를 렌더 타깃 좌표로 바꾸는 배율입니다. */
    getScale() {
        return this.scale;
    }

    /**
     * 월드 좌표를 실제 표시 viewport 좌표로 변환합니다.
     * @param {*} x - 월드 X입니다.
     * @param {*} y - 월드 Y입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{x:number,y:number}} 결과 객체입니다.
     */
    worldToViewport(x, y, out = {}) {
        out.x = this.offsetX + (Number(x) * this.scale);
        out.y = this.offsetY + (Number(y) * this.scale);
        return out;
    }

    /**
     * 실제 표시 viewport 좌표를 월드 좌표로 역변환합니다.
     * @param {*} x - viewport X입니다.
     * @param {*} y - viewport Y입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{x:number,y:number}} 결과 객체입니다.
     */
    viewportToWorld(x, y, out = {}) {
        if (this.scale <= 0) {
            out.x = 0;
            out.y = 0;
            return out;
        }
        out.x = (Number(x) - this.offsetX) / this.scale;
        out.y = (Number(y) - this.offsetY) / this.scale;
        return out;
    }

    /**
     * 월드 길이를 현재 viewport 길이로 변환합니다.
     * @param {*} length - 월드 길이입니다.
     * @returns {number} viewport 길이입니다.
     */
    worldLengthToViewport(length) {
        const numericLength = Number(length);
        return Number.isFinite(numericLength)
            ? numericLength * this.scale
            : 0;
    }

    /**
     * 원이 현재 object viewport와 겹치는지 확인합니다.
     * @param {number} x - 원 중심 X입니다.
     * @param {number} y - 원 중심 Y입니다.
     * @param {number} radius - 반지름입니다.
     * @returns {boolean} 표시 가능 여부입니다.
     */
    isCircleVisible(x, y, radius) {
        if (this.scale <= 0) {
            return false;
        }
        return x + radius >= this.viewBounds.left
            && x - radius <= this.viewBounds.right
            && y + radius >= this.viewBounds.top
            && y - radius <= this.viewBounds.bottom;
    }
}
