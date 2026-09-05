import {
    MAP_VISUAL_THEME_ID,
    resolveMapVisualTheme
} from 'data/scene/game/purple_crystal_map_visual_theme_data.js';
import {
    assertWorldViewProjection2D
} from '../contract/world_view_projection_contract.js';

const CORE_FILL = '#ffb52e';
const CORE_ALPHA = 1;
const FULL_CIRCLE_RADIANS = Math.PI * 2;
const CORE_INTEGRITY_SEGMENT_CAPACITY = 12;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function pushPooledCenter(target, pool, x, y) {
    const index = target.length;
    let center = pool[index];
    if (!center) {
        center = { x: 0, y: 0 };
        pool[index] = center;
    }
    center.x = x;
    center.y = y;
    target.push(center);
}

/**
 * @class TheCoreRenderer
 * @description flat fallback 또는 integrity-aware crystal Core presentation을 제출합니다.
 */
export class TheCoreRenderer {
    /**
     * @param {{drawCircle:(options:object)=>void,drawShape?:(options:object)=>void,drawShapeInstances?:(options:object)=>void}} worldRenderPort
     */
    constructor(worldRenderPort) {
        if (!worldRenderPort || typeof worldRenderPort.drawCircle !== 'function') {
            throw new TypeError('TheCoreRenderer에는 drawCircle 포트가 필요합니다.');
        }
        this.worldRenderPort = worldRenderPort;
        this.advancedPortAvailable = typeof worldRenderPort.drawShape === 'function'
            && typeof worldRenderPort.drawShapeInstances === 'function';
        this.renderOptions = {
            layer: 'object',
            x: 0,
            y: 0,
            diameter: 0,
            fill: CORE_FILL,
            alpha: CORE_ALPHA
        };
        this.viewportPosition = { x: 0, y: 0 };
        this.presentationTime = 0;
        this.cachedThemeFingerprint = -1;
        this.lastIntegrityRatio = 1;

        this.pedestalOptions = this.#createShapeOptions('octagon');
        this.ringOptions = [];
        this.warningRingOptions = this.#createShapeOptions('ring');
        this.crystalBackOptions = this.#createShapeOptions('square');
        this.crystalFrontOptions = this.#createShapeOptions('triangle');
        this.crystalHighlightOptions = this.#createShapeOptions('circle');
        this.integritySegmentOptions = {
            layer: 'object',
            shape: 'square',
            w: 0,
            h: 0,
            rotation: 45,
            fill: '#ffc064',
            alpha: 0.9,
            centers: null,
            originX: 0,
            originY: 0,
            localScale: 1,
            cacheKey: null
        };
        this.integritySegmentCenters = [];
        this.integritySegmentPool = [];
    }

    #createShapeOptions(shape) {
        return {
            layer: 'object',
            shape,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            rotation: 0,
            fill: '#ffffff',
            alpha: 1
        };
    }

    /** presentation variable time만 전진합니다. */
    update(frameDelta = 0) {
        const delta = Number(frameDelta);
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }
        this.presentationTime = (this.presentationTime + Math.min(delta, 0.25))
            % 4096;
    }

    /**
     * @param {{active:boolean,position:{x:number,y:number},radius:number,getCoreIntegrity?:()=>object}|null} core
     * @param {object} projection - IWorldViewProjection2D입니다.
     * @param {object|null} [tileMap] - visual theme ID만 읽는 TileMap입니다.
     */
    draw(core, projection, tileMap = null) {
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
        const theme = resolveMapVisualTheme(tileMap?.getVisualThemeId?.());
        if (!this.advancedPortAvailable
            || theme.themeId === MAP_VISUAL_THEME_ID.FLAT) {
            this.#drawFlat(core, worldProjection);
            return;
        }
        this.#drawCrystalCore(core, worldProjection, theme);
    }

    #drawFlat(core, projection) {
        projection.worldToViewport(
            core.position.x,
            core.position.y,
            this.viewportPosition
        );
        this.renderOptions.x = this.viewportPosition.x;
        this.renderOptions.y = this.viewportPosition.y;
        this.renderOptions.diameter = projection.worldLengthToViewport(
            core.radius * 2
        );
        this.worldRenderPort.drawCircle(this.renderOptions);
    }

    #configureTheme(theme) {
        if (this.cachedThemeFingerprint === theme.fingerprint) {
            return;
        }
        this.cachedThemeFingerprint = theme.fingerprint;
        const colors = theme.core.colors;
        this.pedestalOptions.fill = colors[3];
        this.pedestalOptions.alpha = 0.9;
        while (this.ringOptions.length < theme.core.ringCount) {
            this.ringOptions.push(this.#createShapeOptions('ring'));
        }
        for (let index = 0; index < this.ringOptions.length; index++) {
            const options = this.ringOptions[index];
            options.fill = index % 2 === 0 ? colors[1] : colors[2];
            options.alpha = 0.28 + index * 0.08;
        }
        this.warningRingOptions.fill = colors[2];
        this.crystalBackOptions.fill = colors[1];
        this.crystalBackOptions.alpha = 0.88;
        this.crystalFrontOptions.fill = colors[0];
        this.crystalFrontOptions.alpha = 0.94;
        this.crystalHighlightOptions.fill = colors[0];
        this.crystalHighlightOptions.alpha = 0.58;
        this.integritySegmentOptions.fill = colors[2];
    }

    #readIntegrityRatio(core) {
        const integrity = core.getCoreIntegrity?.();
        if (!integrity) {
            return 1;
        }
        const current = Number(integrity.getCurrentIntegrity?.());
        const maximum = Number(integrity.getMaxIntegrity?.());
        if (!Number.isFinite(current)
            || !Number.isFinite(maximum)
            || maximum <= 0) {
            return 1;
        }
        return clamp(current / maximum, 0, 1);
    }

    #drawCrystalCore(core, projection, theme) {
        this.#configureTheme(theme);
        projection.worldToViewport(
            core.position.x,
            core.position.y,
            this.viewportPosition
        );
        const centerX = this.viewportPosition.x;
        const centerY = this.viewportPosition.y;
        const coreRadiusPixels = projection.worldLengthToViewport(core.radius);
        const baseRadius = coreRadiusPixels * theme.core.baseRadiusScale;
        const integrityRatio = this.#readIntegrityRatio(core);
        this.lastIntegrityRatio = integrityRatio;
        const pulsePeriod = theme.core.pulsePeriodSeconds
            * (0.68 + integrityRatio * 0.32);
        const pulsePhase = this.presentationTime
            * FULL_CIRCLE_RADIANS
            / pulsePeriod;
        const pulseScale = 1 + Math.sin(pulsePhase) * 0.035;
        const rotationDegrees = (
            this.presentationTime * 10 * (0.7 + (1 - integrityRatio) * 0.4)
        ) % 360;

        this.#setShapeGeometry(
            this.pedestalOptions,
            centerX,
            centerY + baseRadius * 0.08,
            baseRadius * 1.68,
            baseRadius * 1.25,
            22.5
        );
        this.worldRenderPort.drawShape(this.pedestalOptions);

        for (let index = theme.core.ringCount - 1; index >= 0; index--) {
            const ring = this.ringOptions[index];
            const diameter = baseRadius * 2 * (0.54 + index * 0.2);
            this.#setShapeGeometry(
                ring,
                centerX,
                centerY,
                diameter,
                diameter,
                rotationDegrees * (index % 2 === 0 ? 1 : -0.7)
            );
            this.worldRenderPort.drawShape(ring);
        }

        const warningStrength = 1 - integrityRatio;
        if (warningStrength > 0.02) {
            const warningDiameter = baseRadius * 1.82;
            this.warningRingOptions.alpha = 0.08 + warningStrength * 0.48;
            this.#setShapeGeometry(
                this.warningRingOptions,
                centerX,
                centerY,
                warningDiameter,
                warningDiameter,
                -rotationDegrees
            );
            this.worldRenderPort.drawShape(this.warningRingOptions);
        }

        this.#drawIntegritySegments(
            centerX,
            centerY,
            baseRadius * 0.94,
            integrityRatio,
            rotationDegrees
        );

        const crystalDiameter = coreRadiusPixels
            * 2
            * theme.core.crystalScale
            * pulseScale;
        this.#setShapeGeometry(
            this.crystalBackOptions,
            centerX,
            centerY,
            crystalDiameter * 0.78,
            crystalDiameter,
            45 + rotationDegrees * 0.12
        );
        this.worldRenderPort.drawShape(this.crystalBackOptions);
        this.#setShapeGeometry(
            this.crystalFrontOptions,
            centerX,
            centerY - crystalDiameter * 0.04,
            crystalDiameter * 0.58,
            crystalDiameter * 0.74,
            0
        );
        this.worldRenderPort.drawShape(this.crystalFrontOptions);
        this.#setShapeGeometry(
            this.crystalHighlightOptions,
            centerX - crystalDiameter * 0.1,
            centerY - crystalDiameter * 0.18,
            crystalDiameter * 0.14,
            crystalDiameter * 0.14,
            0
        );
        this.worldRenderPort.drawShape(this.crystalHighlightOptions);
    }

    #setShapeGeometry(options, x, y, width, height, rotation) {
        options.x = x;
        options.y = y;
        options.w = width;
        options.h = height;
        options.rotation = rotation;
    }

    #drawIntegritySegments(centerX, centerY, radius, ratio, rotationDegrees) {
        const segmentCount = Math.round(CORE_INTEGRITY_SEGMENT_CAPACITY * ratio);
        this.integritySegmentCenters.length = 0;
        const rotation = rotationDegrees * Math.PI / 180;
        for (let index = 0; index < segmentCount; index++) {
            const angle = rotation
                + index * FULL_CIRCLE_RADIANS / CORE_INTEGRITY_SEGMENT_CAPACITY;
            pushPooledCenter(
                this.integritySegmentCenters,
                this.integritySegmentPool,
                centerX + Math.cos(angle) * radius,
                centerY + Math.sin(angle) * radius
            );
        }
        if (this.integritySegmentCenters.length === 0) {
            return;
        }
        const size = clamp(radius * 0.12, 1.5, 7);
        this.integritySegmentOptions.w = size;
        this.integritySegmentOptions.h = size;
        this.integritySegmentOptions.centers = this.integritySegmentCenters;
        this.worldRenderPort.drawShapeInstances(this.integritySegmentOptions);
    }

    /** 테스트/측정용 bounded presentation 진단입니다. */
    getDiagnostics() {
        return Object.freeze({
            presentationTime: this.presentationTime,
            integrityRatio: this.lastIntegrityRatio,
            integritySegmentCount: this.integritySegmentCenters.length,
            advanced: this.cachedThemeFingerprint >= 0
        });
    }

    /** 렌더 포트와 bounded scratch 참조를 해제합니다. */
    destroy() {
        this.integritySegmentCenters.length = 0;
        this.integritySegmentPool.length = 0;
        this.ringOptions.length = 0;
        this.worldRenderPort = null;
    }
}
