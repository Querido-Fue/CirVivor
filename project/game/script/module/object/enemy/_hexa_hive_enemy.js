import { getObjectOffsetY, renderGLShapeInstances } from 'display/display_system.js';
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
const EMPTY_DRAW_OPTIONS = Object.freeze({});

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
        this._hiveRotationCacheDeg = Number.NaN;
        this._hiveRotationCos = 1;
        this._hiveRotationSin = 0;
        this._hiveBackdropFillSource = null;
        this._hiveBackdropFill = BACKDROP_FALLBACK_FILL;
        this._hiveBackdropRenderOptions = {
            shape: HEXA_HIVE_CELL_SHAPE,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: BACKDROP_FALLBACK_FILL,
            alpha: 1,
            rotation: 0,
            rotationCos: 1,
            rotationSin: 0
        };
        this._hiveFrontRenderOptions = {
            shape: HEXA_HIVE_CELL_SHAPE,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: this.fill,
            alpha: 1,
            rotation: 0,
            rotationCos: 1,
            rotationSin: 0
        };
        this._hiveCollisionDebugOptions = {
            enemyType: this.type,
            localCenters: null,
            width: 0,
            height: 0,
            rotationRadians: 0,
            renderX: 0,
            renderY: 0
        };
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
        this._hiveBackdropFillSource = null;
        this._syncHiveRotationCache(true);
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
        this._hiveRotationCacheDeg = Number.NaN;
        this._hiveBackdropFillSource = null;
        if (this._hiveCollisionDebugOptions) {
            this._hiveCollisionDebugOptions.localCenters = null;
        }
    }

    /**
     * 회전값이 바뀐 경우에만 셀 위치와 sprite geometry가 공유할 삼각함수를 갱신합니다.
     * @param {boolean} [force=false]
     * @private
     */
    _syncHiveRotationCache(force = false) {
        const rotation = Number.isFinite(this.rotation) ? this.rotation : 0;
        if (!force && this._hiveRotationCacheDeg === rotation) {
            return;
        }

        this._hiveRotationCacheDeg = rotation;
        if (rotation === 0) {
            this._hiveRotationCos = 1;
            this._hiveRotationSin = 0;
        } else {
            const radians = rotation * DEGREES_TO_RADIANS;
            this._hiveRotationCos = Math.cos(radians);
            this._hiveRotationSin = Math.sin(radians);
        }

        const backdropOptions = this._hiveBackdropRenderOptions;
        const frontOptions = this._hiveFrontRenderOptions;
        if (backdropOptions) {
            backdropOptions.rotation = rotation;
            backdropOptions.rotationCos = this._hiveRotationCos;
            backdropOptions.rotationSin = this._hiveRotationSin;
        }
        if (frontOptions) {
            frontOptions.rotation = rotation;
            frontOptions.rotationCos = this._hiveRotationCos;
            frontOptions.rotationSin = this._hiveRotationSin;
        }
    }

    /**
     * @private
     * @returns {string}
     */
    _resolveBackdropFill() {
        const sourceFill = typeof this.fill === 'string' ? this.fill : ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        if (this._hiveBackdropFillSource === sourceFill) {
            return this._hiveBackdropFill;
        }

        this._hiveBackdropFillSource = sourceFill;
        this._hiveBackdropFill = typeof sourceFill === 'string' && sourceFill.length > 0
            ? colorUtil().lerpColor(sourceFill, BACKDROP_FALLBACK_FILL, BACKDROP_FILL_BLEND_RATIO)
            : BACKDROP_FALLBACK_FILL;
        return this._hiveBackdropFill;
    }

    /**
     * 합체 적을 렌더링합니다.
     * @param {{layer?: string}} [overrideOptions={}]
     */
    draw(overrideOptions = EMPTY_DRAW_OPTIONS) {
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
        this._syncHiveRotationCache();
        const rotationRadians = rotation * DEGREES_TO_RADIANS;
        const mergeOffsetX = (Number.isFinite(this.mergePullOffset?.x) ? this.mergePullOffset.x : 0)
            + (Number.isFinite(this.mergeSettleOffset?.x) ? this.mergeSettleOffset.x : 0);
        const mergeOffsetY = (Number.isFinite(this.mergePullOffset?.y) ? this.mergePullOffset.y : 0)
            + (Number.isFinite(this.mergeSettleOffset?.y) ? this.mergeSettleOffset.y : 0);
        const renderX = this.renderPosition.x + mergeOffsetX;
        const renderY = this.renderPosition.y - objectOffsetY + mergeOffsetY;
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
        const backdropOptions = this._hiveBackdropRenderOptions;
        backdropOptions.w = baseHeight * HEXA_HIVE_BACKDROP_SCALE;
        backdropOptions.h = backdropOptions.w;
        backdropOptions.fill = backdropFill;
        backdropOptions.alpha = backdropAlpha;

        renderGLShapeInstances(layer, backdropOptions, backdropCenters, renderX, renderY, baseHeight);

        const frontOptions = this._hiveFrontRenderOptions;
        frontOptions.w = baseHeight * HEXA_HIVE_FRONT_SCALE;
        frontOptions.h = frontOptions.w;
        frontOptions.fill = frontFill;
        frontOptions.alpha = frontAlpha;
        renderGLShapeInstances(
            layer,
            frontOptions,
            layout.visibleLocalCenters,
            renderX,
            renderY,
            baseHeight
        );

        const debugOptions = this._hiveCollisionDebugOptions;
        debugOptions.enemyType = this.type;
        debugOptions.localCenters = collisionLocalCenters;
        debugOptions.width = baseHeight;
        debugOptions.height = baseHeight;
        debugOptions.rotationRadians = rotationRadians;
        debugOptions.renderX = renderX;
        debugOptions.renderY = renderY;
        drawEnemyCollisionDebugCircles(debugOptions);
    }
}
