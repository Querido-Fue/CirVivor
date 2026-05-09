import { getObjectOffsetY, renderGL } from 'display/display_system.js';
import { colorUtil } from 'util/color_util.js';
import { getData } from 'data/data_handler.js';
import { ShapeEnemy } from './_shape_enemy.js';
import { drawEnemyCollisionDebugCircles } from './_enemy_collision_debug.js';
import {
    cloneHexaHiveLayout,
    getHexaHiveType
} from './_hexa_hive_layout.js';

const getEnemyShapeKey = getData('getEnemyShapeKey');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const ENEMY_HEXA_HIVE_RENDER = ENEMY_CONSTANTS.HEXA_HIVE.RENDER;
const ENEMY_ANGLE_CONSTANTS = ENEMY_CONSTANTS.ANGLE;
const HEXA_SHAPE_KEY = getEnemyShapeKey('hexa');
const BACKDROP_FALLBACK_FILL = ENEMY_HEXA_HIVE_RENDER.BACKDROP_FALLBACK_FILL;
const BACKDROP_FILL_BLEND_RATIO = ENEMY_HEXA_HIVE_RENDER.BACKDROP_FILL_BLEND_RATIO;
const HEXA_HIVE_CELL_SHAPE = ENEMY_HEXA_HIVE_RENDER.CELL_SHAPE;
const HEXA_HIVE_FRONT_SCALE = ENEMY_HEXA_HIVE_RENDER.FRONT_SCALE;
const HEXA_HIVE_BACKDROP_SCALE = ENEMY_HEXA_HIVE_RENDER.BACKDROP_SCALE;
const DEGREES_TO_RADIANS = ENEMY_ANGLE_CONSTANTS.DEGREES_TO_RADIANS;

/**
 * 좌표를 회전합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} radians
 * @returns {{x: number, y: number}}
 */
function rotateHivePoint(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}

/**
 * @class HexaHiveEnemy
 * @description 여러 육각형 조각이 합쳐진 단일 적입니다.
 */
export class HexaHiveEnemy extends ShapeEnemy {
    constructor() {
        super('hexa');
        this.hexaHiveLayout = null;
        this.mergeBaseMoveSpeed = 0;
        this.collisionLocalCenters = null;
    }

    /**
     * @param {object} [data={}]
     * @returns {HexaHiveEnemy}
     */
    init(data = {}) {
        super.init({
            ...data,
            type: getHexaHiveType()
        });
        this.type = getHexaHiveType();
        this.shapeKey = HEXA_SHAPE_KEY;
        this.mergeBaseMoveSpeed = Number.isFinite(data.mergeBaseMoveSpeed)
            ? data.mergeBaseMoveSpeed
            : this.moveSpeed;
        this.hexaHiveLayout = cloneHexaHiveLayout(data.hexaHiveLayout);
        this.collisionLocalCenters = this.hexaHiveLayout?.filledLocalCenters ?? null;
        return this;
    }

    /**
     * 적을 기본 상태로 되돌립니다.
     */
    reset() {
        super.reset();
        this.type = getHexaHiveType();
        this.shapeKey = HEXA_SHAPE_KEY;
        this.hexaHiveLayout = null;
        this.mergeBaseMoveSpeed = 0;
        this.collisionLocalCenters = null;
    }

    /**
     * @private
     * @returns {string}
     */
    _resolveBackdropFill() {
        const sourceFill = typeof this.fill === 'string' ? this.fill : ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        if (typeof sourceFill === 'string' && sourceFill.length > 0) {
            return colorUtil().lerpColor(sourceFill, BACKDROP_FALLBACK_FILL, BACKDROP_FILL_BLEND_RATIO);
        }

        return BACKDROP_FALLBACK_FILL;
    }

    /**
     * 합체 적을 렌더링합니다.
     * @param {{layer?: string}} [overrideOptions={}]
     */
    draw(overrideOptions = {}) {
        if (!this.active) {
            return;
        }

        const layout = this.hexaHiveLayout;
        if (!layout || !Array.isArray(layout.visibleLocalCenters) || layout.visibleLocalCenters.length === 0) {
            super.draw(overrideOptions);
            return;
        }

        const layer = overrideOptions.layer || 'object';
        const baseHeight = this.getRenderHeightPx();
        const objectOffsetY = getObjectOffsetY();
        const rotation = Number.isFinite(this.rotation) ? this.rotation : 0;
        const rotationRadians = rotation * DEGREES_TO_RADIANS;
        const renderX = this.renderPosition.x;
        const renderY = this.renderPosition.y - objectOffsetY;
        const frontFill = typeof this.fill === 'string' ? this.fill : ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        const backdropFill = this._resolveBackdropFill();
        const backdropAlpha = Number.isFinite(this.alpha) ? this.alpha : 1;
        const frontAlpha = Number.isFinite(this.alpha) ? this.alpha : 1;
        const backdropCenters = Array.isArray(layout.filledLocalCenters) && layout.filledLocalCenters.length > 0
            ? layout.filledLocalCenters
            : layout.visibleLocalCenters;
        const collisionLocalCenters = Array.isArray(this.collisionLocalCenters) && this.collisionLocalCenters.length > 0
            ? this.collisionLocalCenters
            : backdropCenters;

        for (let i = 0; i < backdropCenters.length; i++) {
            const localCenter = backdropCenters[i];
            const rotated = rotateHivePoint(
                localCenter.x * baseHeight,
                localCenter.y * baseHeight,
                rotationRadians
            );
            renderGL(layer, {
                shape: HEXA_HIVE_CELL_SHAPE,
                x: renderX + rotated.x,
                y: renderY + rotated.y,
                w: baseHeight * HEXA_HIVE_BACKDROP_SCALE,
                h: baseHeight * HEXA_HIVE_BACKDROP_SCALE,
                fill: backdropFill,
                alpha: backdropAlpha,
                rotation
            });
        }

        for (let i = 0; i < layout.visibleLocalCenters.length; i++) {
            const localCenter = layout.visibleLocalCenters[i];
            const rotated = rotateHivePoint(
                localCenter.x * baseHeight,
                localCenter.y * baseHeight,
                rotationRadians
            );
            renderGL(layer, {
                shape: HEXA_HIVE_CELL_SHAPE,
                x: renderX + rotated.x,
                y: renderY + rotated.y,
                w: baseHeight * HEXA_HIVE_FRONT_SCALE,
                h: baseHeight * HEXA_HIVE_FRONT_SCALE,
                fill: frontFill,
                alpha: frontAlpha,
                rotation
            });
        }

        drawEnemyCollisionDebugCircles({
            enemyType: this.type,
            localCenters: collisionLocalCenters,
            width: baseHeight,
            height: baseHeight,
            rotationRadians,
            renderX,
            renderY
        });
    }
}
