import {
    assertWorldViewProjection2D
} from '../contract/world_view_projection_contract.js';

const CORE_FILL = '#ffb52e';
const CORE_ALPHA = 1;

/**
 * @class TheCoreRenderer
 * @description 카메라를 통해 The Core를 object layer에 제출합니다.
 */
export class TheCoreRenderer {
    /**
     * @param {{drawCircle:(options:object)=>void}} worldRenderPort - 월드 렌더 포트입니다.
     */
    constructor(worldRenderPort) {
        if (!worldRenderPort || typeof worldRenderPort.drawCircle !== 'function') {
            throw new TypeError('TheCoreRenderer에는 drawCircle 포트가 필요합니다.');
        }
        this.worldRenderPort = worldRenderPort;
        this.renderOptions = {
            layer: 'object',
            x: 0,
            y: 0,
            diameter: 0,
            fill: CORE_FILL,
            alpha: CORE_ALPHA
        };
        this.viewportPosition = { x: 0, y: 0 };
    }

    /**
     * Core가 보일 때만 렌더 포트에 제출합니다.
     * @param {{active:boolean,position:{x:number,y:number},radius:number}|null} core - 렌더할 CPU Core presentation입니다.
     * @param {object} projection - IWorldViewProjection2D입니다.
     * @returns {void}
     */
    draw(core, projection) {
        const worldProjection = assertWorldViewProjection2D(projection);
        if (!core
            || core.active === false
            || !worldProjection.isCircleVisible(
                core.position.x,
                core.position.y,
                core.radius
            )) {
            return;
        }
        worldProjection.worldToViewport(
            core.position.x,
            core.position.y,
            this.viewportPosition
        );
        this.renderOptions.x = this.viewportPosition.x;
        this.renderOptions.y = this.viewportPosition.y;
        this.renderOptions.diameter = worldProjection.worldLengthToViewport(
            core.radius * 2
        );
        this.worldRenderPort.drawCircle(this.renderOptions);
    }

    /** @returns {void} 렌더 포트 참조를 해제합니다. */
    destroy() {
        this.worldRenderPort = null;
    }
}
