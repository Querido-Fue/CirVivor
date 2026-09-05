import {
    assertWorldViewProjection2D
} from '../contract/world_view_projection_contract.js';
import { THE_TOWER_RENDER_DATA } from 'data/object/tower/the_tower_data.js';
import {
    MAP_VISUAL_THEME_ID,
    resolveMapVisualTheme
} from 'data/scene/game/purple_crystal_map_visual_theme_data.js';

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
        this.advancedPortAvailable = typeof worldRenderPort.drawShape === 'function';
        this.renderOptions = {
            layer: 'object',
            x: 0,
            y: 0,
            diameter: 0,
            fill: THE_TOWER_RENDER_DATA.FILL,
            alpha: TOWER_ALPHA
        };
        this.viewportPosition = { x: 0, y: 0 };
        this.haloOptions = {
            layer: 'object',
            shape: 'circle',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: THE_TOWER_RENDER_DATA.FILL,
            alpha: 0
        };
        this.rimOptions = {
            layer: 'object',
            shape: 'ring',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: THE_TOWER_RENDER_DATA.FILL,
            alpha: 0
        };
    }

    /**
     * Tower의 보간 위치를 카메라 기준 오브젝트 레이어 좌표로 변환해 제출합니다.
     * @param {import('./the_tower.js').TheTower|null} tower - 렌더할 Tower입니다.
     * @param {object} projection - IWorldViewProjection2D입니다.
     * @returns {void}
     */
    draw(tower, projection, tileMap = null) {
        if (!tower || tower.active === false) {
            return;
        }
        const worldProjection = assertWorldViewProjection2D(projection);
        worldProjection.worldToViewport(
            tower.renderPosition.x,
            tower.renderPosition.y,
            this.viewportPosition
        );
        this.renderOptions.x = this.viewportPosition.x;
        this.renderOptions.y = this.viewportPosition.y;
        this.renderOptions.diameter = worldProjection.worldLengthToViewport(
            tower.radius * 2
        );
        const theme = resolveMapVisualTheme(tileMap?.getVisualThemeId?.());
        const projectedRadius = this.renderOptions.diameter * 0.5;
        const advanced = this.advancedPortAvailable
            && theme.themeId === MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL;
        if (advanced
            && projectedRadius
                >= theme.entityGlow.minimumProjectedRadiusForHalo) {
            const haloDiameter = this.renderOptions.diameter
                + theme.entityGlow.haloWidthPixels * 2;
            this.haloOptions.x = this.viewportPosition.x;
            this.haloOptions.y = this.viewportPosition.y;
            this.haloOptions.w = haloDiameter;
            this.haloOptions.h = haloDiameter;
            this.haloOptions.alpha = theme.entityGlow.towerIntensity * 0.12;
            this.worldRenderPort.drawShape(this.haloOptions);
        }
        this.worldRenderPort.drawCircle(this.renderOptions);
        if (advanced) {
            this.rimOptions.x = this.viewportPosition.x;
            this.rimOptions.y = this.viewportPosition.y;
            this.rimOptions.w = this.renderOptions.diameter;
            this.rimOptions.h = this.renderOptions.diameter;
            this.rimOptions.alpha = theme.entityGlow.towerIntensity * 0.72;
            this.worldRenderPort.drawShape(this.rimOptions);
        }
    }

    /**
     * 렌더 포트 참조를 해제합니다.
     * @returns {void}
     */
    destroy() {
        this.worldRenderPort = null;
    }
}
