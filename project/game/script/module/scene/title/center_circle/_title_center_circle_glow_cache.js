import { getData } from 'data/data_handler.js';
import { getLoadingAccentColor } from '../loading/_title_loading_theme.js';
import { getLoadingGlowSettings, toLoadingRgba } from './_title_center_circle_theme.js';
import {
    createCenterCircleGlowNoiseCanvas,
    drawCenterCircleDitheredHaloNoise,
    drawCenterCircleGlowRing,
    drawCenterCircleHaloRing,
    resizeCenterCircleGlowCanvas
} from './_title_center_circle_glow_canvas.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const GLOW_COMPENSATION_MIN_SCALE = 1;
const GLOW_COMPENSATION_MAX_SCALE = Math.max(
    GLOW_COMPENSATION_MIN_SCALE,
    Math.ceil(TITLE_LOADING.GLOW_COMPENSATION_SCALE || GLOW_COMPENSATION_MIN_SCALE)
);

/**
 * 중앙 원형 로딩 UI의 glow 오프스크린 캐시를 관리합니다.
 */
export class TitleCenterCircleGlowCache {
    /**
     * glow 캐시와 디더링 노이즈 리소스를 초기화합니다.
     */
    constructor() {
        this.glowNoiseCanvas = createCenterCircleGlowNoiseCanvas();
        this.entries = new Map();
    }

    /**
     * 현재 원형 로딩 UI 상태에 맞는 glow 캐시를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
     * @param {object} options - glow 렌더 옵션입니다.
     * @param {number} options.centerX - 화면에 표시할 원 중심 X 좌표입니다.
     * @param {number} options.centerY - 화면에 표시할 원 중심 Y 좌표입니다.
     * @param {number} options.radius - 기준 반경입니다.
     * @param {number} options.outlineWidth - 기준 외곽선 두께입니다.
     * @param {number} options.drawRadius - 현재 화면에 그릴 반경입니다.
     * @param {number} options.glowPhase - glow 펄스 위상입니다.
     * @param {number} options.glowCompensationScale - glow 보정 배율입니다.
     */
    draw(ctx, {
        centerX,
        centerY,
        radius,
        outlineWidth,
        drawRadius,
        glowPhase,
        glowCompensationScale
    }) {
        const pulse = 0.9 + (Math.sin(glowPhase) * 0.06);
        const drawScale = drawRadius / Math.max(1, radius);
        const glowBlend = this._getGlowCacheBlend(radius, outlineWidth, glowCompensationScale);
        if (!glowBlend || drawScale <= 0) {
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        this._drawGlowCacheEntry(ctx, glowBlend.lowerEntry, centerX, centerY, pulse * (1 - glowBlend.upperWeight), drawScale);
        if (glowBlend.upperEntry) {
            this._drawGlowCacheEntry(ctx, glowBlend.upperEntry, centerX, centerY, pulse * glowBlend.upperWeight, drawScale);
        }
        ctx.restore();
    }

    /**
     * glow 캐시 엔트리를 모두 정리합니다.
     */
    clear() {
        for (const entry of this.entries.values()) {
            entry.canvas.width = 0;
            entry.canvas.height = 0;
        }
        this.entries.clear();
    }

    /**
     * 현재 glow 보정 배율에 맞는 캐시 보간 정보를 반환합니다.
     * @param {number} radius - 기준 반경입니다.
     * @param {number} outlineWidth - 기준 외곽선 두께입니다.
     * @param {number} glowCompensationScale - glow 보정 배율입니다.
     * @returns {{lowerEntry: object, upperEntry: object|null, upperWeight: number}|null} glow 캐시 보간 정보입니다.
     */
    _getGlowCacheBlend(radius, outlineWidth, glowCompensationScale) {
        const normalizedScale = Math.max(
            GLOW_COMPENSATION_MIN_SCALE,
            Math.min(
                GLOW_COMPENSATION_MAX_SCALE,
                Number.isFinite(glowCompensationScale) ? glowCompensationScale : GLOW_COMPENSATION_MIN_SCALE
            )
        );
        const lowerScale = Math.max(GLOW_COMPENSATION_MIN_SCALE, Math.floor(normalizedScale));
        const upperScale = Math.min(GLOW_COMPENSATION_MAX_SCALE, Math.ceil(normalizedScale));
        const lowerEntry = this._getGlowCacheEntry(radius, outlineWidth, lowerScale);
        if (!lowerEntry) {
            return null;
        }

        if (lowerScale === upperScale) {
            return {
                lowerEntry,
                upperEntry: null,
                upperWeight: 0
            };
        }

        return {
            lowerEntry,
            upperEntry: this._getGlowCacheEntry(radius, outlineWidth, upperScale),
            upperWeight: (normalizedScale - lowerScale) / Math.max(0.0001, upperScale - lowerScale)
        };
    }

    /**
     * 지정한 glow 보정 배율의 캐시 엔트리를 반환합니다.
     * @param {number} radius - 기준 반경입니다.
     * @param {number} outlineWidth - 기준 외곽선 두께입니다.
     * @param {number} glowCompensationScale - glow 보정 배율 버킷입니다.
     * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|null, offsetX: number, offsetY: number}|null} glow 캐시 엔트리입니다.
     */
    _getGlowCacheEntry(radius, outlineWidth, glowCompensationScale) {
        const cacheKey = Math.max(
            GLOW_COMPENSATION_MIN_SCALE,
            Math.min(GLOW_COMPENSATION_MAX_SCALE, Math.round(glowCompensationScale))
        );
        let entry = this.entries.get(cacheKey);
        if (entry) {
            return entry;
        }

        entry = {
            canvas: document.createElement('canvas'),
            context: null,
            offsetX: 0,
            offsetY: 0
        };
        entry.context = entry.canvas.getContext('2d');
        this._rebuildGlowCache(entry, radius, outlineWidth, cacheKey);
        this.entries.set(cacheKey, entry);
        return entry;
    }

    /**
     * glow 캐시 이미지를 현재 스케일에 맞춰 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
     * @param {{canvas: HTMLCanvasElement, offsetX: number, offsetY: number}|null} entry - 사용할 glow 캐시 엔트리입니다.
     * @param {number} centerX - 화면에 표시할 원 중심 X 좌표입니다.
     * @param {number} centerY - 화면에 표시할 원 중심 Y 좌표입니다.
     * @param {number} alpha - 적용할 알파 값입니다.
     * @param {number} drawScale - 현재 화면에 그릴 스케일입니다.
     */
    _drawGlowCacheEntry(ctx, entry, centerX, centerY, alpha, drawScale) {
        if (!entry || alpha <= 0 || drawScale <= 0 || entry.canvas.width <= 0 || entry.canvas.height <= 0) {
            return;
        }

        ctx.globalAlpha = alpha;
        ctx.drawImage(
            entry.canvas,
            centerX - (entry.offsetX * drawScale),
            centerY - (entry.offsetY * drawScale),
            entry.canvas.width * drawScale,
            entry.canvas.height * drawScale
        );
    }

    /**
     * 현재 글로우 상태를 오프스크린 캔버스로 다시 렌더링합니다.
     * @param {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|null, offsetX: number, offsetY: number}} entry - glow 캐시 엔트리입니다.
     * @param {number} radius - 기준 반경입니다.
     * @param {number} outlineWidth - 기준 외곽선 두께입니다.
     * @param {number} glowCompensationScale - 현재 글로우 보정 배율입니다.
     */
    _rebuildGlowCache(entry, radius, outlineWidth, glowCompensationScale) {
        const glowSettings = getLoadingGlowSettings();
        const haloStops = Array.isArray(glowSettings?.haloStops) ? glowSettings.haloStops : [];
        const ringSettings = glowSettings?.ring || {};
        const glowContext = entry?.context;
        if (!glowContext) {
            return;
        }

        const drawRadius = Math.max(1, radius);
        const drawOutlineWidth = Math.max(1, outlineWidth);
        const haloInnerRadius = drawRadius * 1.015;
        const haloOuterRadius = drawRadius * (1.92 + (glowCompensationScale * 0.11));
        const glowRadius = drawRadius * 1.018;
        const glowBlur = drawRadius * (0.34 + (glowCompensationScale * 0.12));
        const glowLineWidth = Math.max(drawOutlineWidth * 1.12, drawRadius * 0.016);
        const baseBloomStrength = 0.76 + (glowCompensationScale * 0.12);
        const extent = Math.max(haloOuterRadius, glowRadius + (glowBlur * 2.5)) + 8;
        const canvasSize = Math.max(1, Math.ceil(extent * 2));
        const center = canvasSize * 0.5;
        let haloGradient;

        resizeCenterCircleGlowCanvas(entry.canvas, canvasSize, canvasSize);
        glowContext.clearRect(0, 0, canvasSize, canvasSize);

        haloGradient = glowContext.createRadialGradient(
            center,
            center,
            haloInnerRadius,
            center,
            center,
            haloOuterRadius
        );

        for (let i = 0; i < haloStops.length; i++) {
            const stop = haloStops[i];
            if (!stop || typeof stop.offset !== 'number' || typeof stop.alphaScale !== 'number' || typeof stop.maxAlpha !== 'number') {
                continue;
            }
            const stopAlpha = Math.min(stop.maxAlpha, stop.alphaScale * baseBloomStrength);
            haloGradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), toLoadingRgba(stop.color, stopAlpha));
        }
        if (haloStops.length === 0) {
            const fallbackStopColor = toLoadingRgba(getLoadingAccentColor(), 0);
            haloGradient.addColorStop(0, fallbackStopColor);
            haloGradient.addColorStop(1, fallbackStopColor);
        }

        glowContext.save();
        glowContext.globalCompositeOperation = 'screen';
        drawCenterCircleHaloRing(glowContext, center, center, haloInnerRadius, haloOuterRadius, haloGradient);
        drawCenterCircleDitheredHaloNoise(
            glowContext,
            this.glowNoiseCanvas,
            center,
            center,
            haloInnerRadius,
            haloOuterRadius,
            Math.min(0.04, (Number.isFinite(ringSettings?.AlphaScale) ? ringSettings.AlphaScale : 0) * baseBloomStrength)
        );
        const ringColor = ringSettings?.Color || getLoadingAccentColor();
        const ringShadowColor = ringSettings?.ShadowColor || ringColor;
        const ringAlpha = Math.min(
            Number.isFinite(ringSettings?.AlphaMax) ? ringSettings.AlphaMax : 0,
            (Number.isFinite(ringSettings?.AlphaScale) ? ringSettings.AlphaScale : 0) * baseBloomStrength
        );
        const ringShadowAlpha = Math.min(
            Number.isFinite(ringSettings?.ShadowAlphaMax) ? ringSettings.ShadowAlphaMax : 0,
            (Number.isFinite(ringSettings?.ShadowAlphaScale) ? ringSettings.ShadowAlphaScale : 0) * baseBloomStrength
        );
        drawCenterCircleGlowRing(
            glowContext,
            center,
            center,
            glowRadius,
            glowLineWidth,
            toLoadingRgba(ringColor, ringAlpha),
            glowBlur,
            toLoadingRgba(ringShadowColor, ringShadowAlpha)
        );
        glowContext.restore();

        entry.offsetX = center;
        entry.offsetY = center;
    }
}
