import { getObjectOffsetY, render, renderGL } from 'display/display_system.js';
import { colorUtil } from 'util/color_util.js';
import { getData } from 'data/data_handler.js';
import { getSetting } from 'save/save_system.js';
import { ShapeEnemy } from './_shape_enemy.js';
import {
    cloneHexaHiveLayout,
    getHexaHiveType
} from './_hexa_hive_layout.js';

const getEnemyShapeKey = getData('getEnemyShapeKey');
const HEXA_SHAPE_KEY = getEnemyShapeKey('hexa');
const BACKDROP_FALLBACK_FILL = 'rgb(255, 212, 184)';
const HEXA_HIVE_CELL_SHAPE = 'hexagon';
const HEXA_HIVE_FRONT_SCALE = 1;
const HEXA_HIVE_BACKDROP_SCALE = 1.14;
const HEXA_HIVE_DEBUG_STROKE = 'rgba(64, 240, 255, 1)';
const HEXA_HIVE_DEBUG_LINE_WIDTH = 2.25;

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
 * 디버그 모드에서 실제 충돌 part 외곽을 그립니다.
 * @param {number[][]|null|undefined} collisionLocalParts
 * @param {number} baseHeight
 * @param {number} rotationRadians
 * @param {number} renderX
 * @param {number} renderY
 * @param {number} rotation
 */
function drawHexaHiveCollisionDebugParts(collisionLocalParts, baseHeight, rotationRadians, renderX, renderY, rotation) {
    if (getSetting('debugMode') !== true || !Array.isArray(collisionLocalParts)) {
        return;
    }

    for (let partIndex = 0; partIndex < collisionLocalParts.length; partIndex++) {
        const part = collisionLocalParts[partIndex];
        if (!Array.isArray(part) || part.length < 6) {
            continue;
        }

        for (let i = 0; i < part.length; i += 2) {
            const nextIndex = (i + 2) % part.length;
            const start = rotateHivePoint(
                (Number.isFinite(part[i]) ? part[i] : 0) * baseHeight,
                (Number.isFinite(part[i + 1]) ? part[i + 1] : 0) * baseHeight,
                rotationRadians
            );
            const end = rotateHivePoint(
                (Number.isFinite(part[nextIndex]) ? part[nextIndex] : 0) * baseHeight,
                (Number.isFinite(part[nextIndex + 1]) ? part[nextIndex + 1] : 0) * baseHeight,
                rotationRadians
            );

            render('top', {
                shape: 'line',
                x1: renderX + start.x,
                y1: renderY + start.y,
                x2: renderX + end.x,
                y2: renderY + end.y,
                stroke: HEXA_HIVE_DEBUG_STROKE,
                lineWidth: HEXA_HIVE_DEBUG_LINE_WIDTH,
                alpha: 1
            });
        }
    }
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
        this.collisionLocalParts = null;
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
        this.collisionLocalParts = this.hexaHiveLayout?.collisionLocalParts ?? null;
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
        this.collisionLocalParts = null;
    }

    /**
     * 현재 적 상태를 읽기 전용 시뮬레이션 스냅샷으로 복제합니다.
     * @returns {object}
     */
    createSimulationSnapshot() {
        const snapshot = super.createSimulationSnapshot();
        snapshot.mergeBaseMoveSpeed = Number.isFinite(this.mergeBaseMoveSpeed)
            ? this.mergeBaseMoveSpeed
            : snapshot.moveSpeed;
        snapshot.hexaHiveLayout = cloneHexaHiveLayout(this.hexaHiveLayout);
        return snapshot;
    }

    /**
     * @private
     * @returns {string}
     */
    _resolveBackdropFill() {
        const sourceFill = typeof this.fill === 'string' ? this.fill : '#ff6c6c';
        if (typeof sourceFill === 'string' && sourceFill.length > 0) {
            return colorUtil().lerpColor(sourceFill, BACKDROP_FALLBACK_FILL, 0.72);
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
        const rotationRadians = rotation * (Math.PI / 180);
        const renderX = this.renderPosition.x;
        const renderY = this.renderPosition.y - objectOffsetY;
        const frontFill = typeof this.fill === 'string' ? this.fill : '#ff6c6c';
        const backdropFill = this._resolveBackdropFill();
        const backdropAlpha = Number.isFinite(this.alpha) ? this.alpha : 1;
        const frontAlpha = Number.isFinite(this.alpha) ? this.alpha : 1;
        const collisionLocalParts = Array.isArray(this.collisionLocalParts)
            ? this.collisionLocalParts
            : layout.collisionLocalParts;

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
                w: baseHeight * HEXA_HIVE_BACKDROP_SCALE,
                h: baseHeight * HEXA_HIVE_BACKDROP_SCALE,
                fill: backdropFill,
                alpha: backdropAlpha,
                rotation
            });
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

        drawHexaHiveCollisionDebugParts(
            collisionLocalParts,
            baseHeight,
            rotationRadians,
            renderX,
            renderY,
            rotation
        );
    }
}
