const TOWER_FILL = '#2785ff';
const TOWER_ALPHA = 1;

/**
 * @class TheTowerRenderer
 * @description 엔진 렌더 API를 직접 알지 않고 월드 렌더 포트로 Tower 원을 제출합니다.
 */
export class TheTowerRenderer {
    /**
     * @param {{drawCircle:(options:object)=>void}} worldRenderPort - 월드 원 렌더 포트입니다.
     */
    constructor(worldRenderPort) {
        if (!worldRenderPort || typeof worldRenderPort.drawCircle !== 'function') {
            throw new TypeError('TheTowerRenderer에는 drawCircle 월드 렌더 포트가 필요합니다.');
        }
        this.worldRenderPort = worldRenderPort;
        this.renderOptions = {
            layer: 'object',
            x: 0,
            y: 0,
            diameter: 0,
            fill: TOWER_FILL,
            alpha: TOWER_ALPHA
        };
    }

    /**
     * Tower의 보간 위치를 오브젝트 레이어 좌표로 변환해 제출합니다.
     * @param {import('./the_tower.js').TheTower|null} tower - 렌더할 Tower입니다.
     * @param {number} objectOffsetY - 오브젝트 월드의 화면 Y 오프셋입니다.
     * @returns {void}
     */
    draw(tower, objectOffsetY) {
        if (!tower || tower.active === false) {
            return;
        }
        const safeOffsetY = Number.isFinite(objectOffsetY) ? objectOffsetY : 0;
        this.renderOptions.x = tower.renderPosition.x;
        this.renderOptions.y = tower.renderPosition.y - safeOffsetY;
        this.renderOptions.diameter = tower.radius * 2;
        this.worldRenderPort.drawCircle(this.renderOptions);
    }

    /**
     * 렌더 포트 참조를 해제합니다.
     * @returns {void}
     */
    destroy() {
        this.worldRenderPort = null;
    }
}
