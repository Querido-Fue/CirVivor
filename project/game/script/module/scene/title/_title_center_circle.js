import { getCanvas, getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const TWO_PI = Math.PI * 2;
const DEFAULT_LOADING_GLOW_STOPS = Object.freeze([
    Object.freeze({ offset: 0, color: null, alphaScale: 0, maxAlpha: 0 }),
    Object.freeze({ offset: 0.06, color: null, alphaScale: 0.022, maxAlpha: 0.038 }),
    Object.freeze({ offset: 0.14, color: null, alphaScale: 0.03, maxAlpha: 0.05 }),
    Object.freeze({ offset: 0.3, color: null, alphaScale: 0.032, maxAlpha: 0.054 }),
    Object.freeze({ offset: 0.5, color: null, alphaScale: 0.024, maxAlpha: 0.04 }),
    Object.freeze({ offset: 0.72, color: null, alphaScale: 0.013, maxAlpha: 0.022 }),
    Object.freeze({ offset: 0.9, color: null, alphaScale: 0.004, maxAlpha: 0.008 }),
    Object.freeze({ offset: 1, color: null, alphaScale: 0, maxAlpha: 0 })
]);
const DEFAULT_LOADING_GLOW_RING = Object.freeze({
    Color: null,
    ShadowColor: null,
    AlphaScale: 0.052,
    AlphaMax: 0.09,
    ShadowAlphaScale: 0.07,
    ShadowAlphaMax: 0.12
});
const DEFAULT_LOADING_GLOW_SURFACE = Object.freeze({
    Highlight: null,
    HighlightAlpha: 0.95,
    Shadow: null,
    ShadowAlpha: 0.45
});
const GLOW_COMPENSATION_MIN_SCALE = 1;
const GLOW_COMPENSATION_MAX_SCALE = Math.max(
    GLOW_COMPENSATION_MIN_SCALE,
    Math.ceil(TITLE_LOADING.GLOW_COMPENSATION_SCALE || GLOW_COMPENSATION_MIN_SCALE)
);

/**
 * 로딩 아크/채움 기본 색상입니다.
 * @returns {string} 로딩 하이라이트 기본 색상
 */
function getLoadingAccentColor() {
    return ColorSchemes?.Title?.Loading?.Accent
        || ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.Active
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text;
}

/**
 * 로딩 glow에 사용할 색상 설정을 반환합니다.
 * @returns {{haloStops: readonly object[], ring: object, surface: object}} 로딩 glow 설정
 */
function getLoadingGlowSettings() {
    const loadingGlow = ColorSchemes?.Title?.Loading?.Glow;
    const fallbackColor = getLoadingAccentColor();
    const mappedStops = Array.isArray(loadingGlow?.HaloStops) && loadingGlow.HaloStops.length > 0
        ? loadingGlow.HaloStops
        : DEFAULT_LOADING_GLOW_STOPS;

    return {
        haloStops: mappedStops.map((stop, index) => {
            const defaultStop = DEFAULT_LOADING_GLOW_STOPS[index]
                || DEFAULT_LOADING_GLOW_STOPS[DEFAULT_LOADING_GLOW_STOPS.length - 1];
            return {
                offset: Number.isFinite(stop?.offset) ? stop.offset : defaultStop.offset,
                color: typeof stop?.color === 'string' && stop.color ? stop.color : fallbackColor,
                alphaScale: Number.isFinite(stop?.alphaScale) ? stop.alphaScale : defaultStop.alphaScale,
                maxAlpha: Number.isFinite(stop?.maxAlpha) ? stop.maxAlpha : defaultStop.maxAlpha
            };
        }),
        ring: {
            Color: (loadingGlow?.Ring?.Color && typeof loadingGlow.Ring.Color === 'string')
                ? loadingGlow.Ring.Color
                : fallbackColor,
            ShadowColor: (loadingGlow?.Ring?.ShadowColor && typeof loadingGlow.Ring.ShadowColor === 'string')
                ? loadingGlow.Ring.ShadowColor
                : (loadingGlow?.Ring?.Color || fallbackColor),
            AlphaScale: Number.isFinite(loadingGlow?.Ring?.AlphaScale)
                ? loadingGlow.Ring.AlphaScale
                : DEFAULT_LOADING_GLOW_RING.AlphaScale,
            AlphaMax: Number.isFinite(loadingGlow?.Ring?.AlphaMax)
                ? loadingGlow.Ring.AlphaMax
                : DEFAULT_LOADING_GLOW_RING.AlphaMax,
            ShadowAlphaScale: Number.isFinite(loadingGlow?.Ring?.ShadowAlphaScale)
                ? loadingGlow.Ring.ShadowAlphaScale
                : DEFAULT_LOADING_GLOW_RING.ShadowAlphaScale,
            ShadowAlphaMax: Number.isFinite(loadingGlow?.Ring?.ShadowAlphaMax)
                ? loadingGlow.Ring.ShadowAlphaMax
                : DEFAULT_LOADING_GLOW_RING.ShadowAlphaMax
        },
        surface: {
            Highlight: typeof loadingGlow?.Surface?.Highlight === 'string' && loadingGlow.Surface.Highlight
                ? loadingGlow.Surface.Highlight
                : fallbackColor,
            HighlightAlpha: Number.isFinite(loadingGlow?.Surface?.HighlightAlpha)
                ? loadingGlow.Surface.HighlightAlpha
                : DEFAULT_LOADING_GLOW_SURFACE.HighlightAlpha,
            Shadow: typeof loadingGlow?.Surface?.Shadow === 'string' && loadingGlow.Surface.Shadow
                ? loadingGlow.Surface.Shadow
                : fallbackColor,
            ShadowAlpha: Number.isFinite(loadingGlow?.Surface?.ShadowAlpha)
                ? loadingGlow.Surface.ShadowAlpha
                : DEFAULT_LOADING_GLOW_SURFACE.ShadowAlpha
        }
    };
}

/**
 * css 색상 문자열과 알파값으로 rgba 문자열을 생성합니다.
 * @param {string|null|undefined} color - 색상 문자열
 * @param {number} alpha - 알파값
 * @returns {string} rgba 문자열
 */
function toRgba(color, alpha) {
    const fallbackColor = getLoadingAccentColor();
    const parsedColor = colorUtil().cssToRgb(color);
    const safeAlpha = Number.isFinite(alpha) ? alpha : 0;
    if (!parsedColor) {
        const fallback = colorUtil().cssToRgb(fallbackColor);
        if (!fallback) {
            return 'transparent';
        }
        return `rgba(${fallback.r}, ${fallback.g}, ${fallback.b}, ${safeAlpha})`;
    }

    return `rgba(${parsedColor.r}, ${parsedColor.g}, ${parsedColor.b}, ${safeAlpha})`;
}

/**
 * @class TitleCenterCircle
 * @description 타이틀 화면 중앙의 원형 로딩 UI를 렌더링합니다.
 */
export class TitleCenterCircle {
    /**
     * 중앙 원형 로딩 UI의 내부 상태를 초기화합니다.
     */
    constructor() {
        this.progress = 0;
        this.wavePhase = 0;
        this.secondaryWavePhase = Math.PI * 0.35;
        this.glowPhase = 0;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.loadingCenterX = 0;
        this.loadingCenterY = 0;
        this.finalCenterX = 0;
        this.finalCenterY = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.radius = 0;
        this.outlineWidth = 0;
        this.textAnchorY = 0;
        this.visualScale = 1;
        this.placementProgress = 0;
        this.glowCompensationScale = 1;
        this.glowNoiseCanvas = this.#createGlowNoiseCanvas();
        this.glowCacheEntries = new Map();
        this.#recalculateLayout();
    }

    /**
     * 로딩 진행률을 갱신합니다.
     * @param {number} progress - 0~1.1 범위의 진행률
     */
    setProgress(progress) {
        if (!Number.isFinite(progress)) {
            this.progress = 0;
            return;
        }
        this.progress = Math.min(TITLE_LOADING.COMPLETE_PROGRESS, Math.max(0, progress));
    }

    /**
     * 파도와 외곽 글로우의 시간 축을 갱신합니다.
     */
    update() {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }

        this.wavePhase = (this.wavePhase + (delta * 1.9)) % TWO_PI;
        this.secondaryWavePhase = (this.secondaryWavePhase + (delta * 1.15)) % TWO_PI;
        this.glowPhase = (this.glowPhase + (delta * 1.4)) % TWO_PI;
    }

    /**
     * 화면 크기 변경 시 로딩 원과 텍스트 앵커 좌표를 다시 계산합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.#recalculateLayout();
        this.#clearGlowCaches();
    }

    /**
     * 화면 축소처럼 보이도록 원의 시각 반경 배율을 설정합니다.
     * @param {number} scale - 0보다 큰 시각 배율
     */
    setVisualScale(scale) {
        if (!Number.isFinite(scale) || scale <= 0) {
            this.visualScale = 1;
            this.#syncVisualPlacement();
            return;
        }
        this.visualScale = scale;
        this.#syncVisualPlacement();
    }

    /**
     * 로딩 완료 후 원형 UI가 최종 배치로 이동하는 진행률을 설정합니다.
     * @param {number} progress - 0~1 범위 위치 전환 진행률입니다.
     */
    setPlacementProgress(progress) {
        if (!Number.isFinite(progress)) {
            this.placementProgress = 0;
            this.#syncVisualPlacement();
            return;
        }

        this.placementProgress = Math.max(0, Math.min(1, progress));
        this.#syncVisualPlacement();
    }

    /**
     * 원형 로딩 애니메이션을 그립니다.
     */
    draw() {
        const canvas = getCanvas('ui');
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const drawRadius = this.radius * this.visualScale;
        const drawOutlineWidth = Math.max(1, this.outlineWidth * this.visualScale);

        ctx.save();
        this.#drawOutlineGlow(ctx, drawRadius);
        if (this.progress > 0) {
            this.#drawFill(ctx, drawRadius);
        }
        this.#drawOutline(ctx, drawRadius, drawOutlineWidth);
        ctx.restore();
    }

    /**
     * 로딩 텍스트를 배치할 중심점을 반환합니다.
     * @returns {{x:number, y:number}} 텍스트 중심점
     */
    getTextAnchor() {
        return {
            x: this.centerX,
            y: this.textAnchorY
        };
    }

    /**
     * 현재 원형 로딩 UI의 핵심 배치 정보를 반환합니다.
     * @returns {{centerX:number, centerY:number, radius:number}} 원의 중심과 반경
     */
    getCircleLayout() {
        return {
            centerX: this.centerX,
            centerY: this.centerY,
            radius: this.radius * this.visualScale
        };
    }

    /**
     * 내부 상태를 정리합니다.
     */
    destroy() {
        this.#clearGlowCaches();
    }

    /**
     * 원형 로딩 애니메이션의 기준 좌표를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        this.loadingCenterX = this.UIOffsetX + (this.UIWW * 0.5);
        this.loadingCenterY = this.WH * 0.5;
        this.finalCenterX = this.UIOffsetX + (this.UIWW * (TITLE_LOADING.CIRCLE_CENTER_X_RATIO || 0.5));
        this.finalCenterY = this.WH * TITLE_LOADING.CIRCLE_CENTER_Y_RATIO;
        this.radius = Math.max(
            48,
            Math.min(
                this.WH * TITLE_LOADING.CIRCLE_RADIUS_WH_RATIO,
                this.UIWW * TITLE_LOADING.CIRCLE_RADIUS_UIWW_RATIO
            )
        );
        this.outlineWidth = Math.max(2, this.WH * TITLE_LOADING.OUTLINE_WIDTH_WH_RATIO);
        this.#syncVisualPlacement();
    }

    /**
     * 현재 위치 전환 진행률과 시각 배율을 적용해 원 중심과 텍스트 앵커를 갱신합니다.
     * @private
     */
    #syncVisualPlacement() {
        this.centerX = this.loadingCenterX + ((this.finalCenterX - this.loadingCenterX) * this.placementProgress);
        this.centerY = this.loadingCenterY + ((this.finalCenterY - this.loadingCenterY) * this.placementProgress);
        this.textAnchorY = this.centerY + (this.radius * this.visualScale) + Math.max(18, this.WH * TITLE_LOADING.TEXT_GAP_WH_RATIO);
    }

    /**
     * 외곽 글로우가 있는 원형 outline을 먼저 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} drawRadius - 현재 렌더 반경입니다.
     * @private
     */
    #drawOutlineGlow(ctx, drawRadius) {
        const pulse = 0.9 + (Math.sin(this.glowPhase) * 0.06);
        const drawScale = drawRadius / Math.max(1, this.radius);
        const glowBlend = this.#getGlowCacheBlend();
        if (!glowBlend || drawScale <= 0) {
            return;
        }

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        this.#drawGlowCacheEntry(ctx, glowBlend.lowerEntry, pulse * (1 - glowBlend.upperWeight), drawScale);
        if (glowBlend.upperEntry) {
            this.#drawGlowCacheEntry(ctx, glowBlend.upperEntry, pulse * glowBlend.upperWeight, drawScale);
        }
        ctx.restore();
    }

    /**
     * 현재 glow 보정 배율에 맞는 캐시 보간 정보를 반환합니다.
     * @returns {{lowerEntry: object, upperEntry: object|null, upperWeight: number}|null} glow 캐시 보간 정보입니다.
     * @private
     */
    #getGlowCacheBlend() {
        const normalizedScale = Math.max(
            GLOW_COMPENSATION_MIN_SCALE,
            Math.min(
                GLOW_COMPENSATION_MAX_SCALE,
                Number.isFinite(this.glowCompensationScale) ? this.glowCompensationScale : GLOW_COMPENSATION_MIN_SCALE
            )
        );
        const lowerScale = Math.max(GLOW_COMPENSATION_MIN_SCALE, Math.floor(normalizedScale));
        const upperScale = Math.min(GLOW_COMPENSATION_MAX_SCALE, Math.ceil(normalizedScale));
        const lowerEntry = this.#getGlowCacheEntry(lowerScale);
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
            upperEntry: this.#getGlowCacheEntry(upperScale),
            upperWeight: (normalizedScale - lowerScale) / Math.max(0.0001, upperScale - lowerScale)
        };
    }

    /**
     * 지정한 glow 보정 배율의 캐시 엔트리를 반환합니다.
     * @param {number} glowCompensationScale - glow 보정 배율 버킷입니다.
     * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|null, offsetX: number, offsetY: number}|null} glow 캐시 엔트리입니다.
     * @private
     */
    #getGlowCacheEntry(glowCompensationScale) {
        const cacheKey = Math.max(
            GLOW_COMPENSATION_MIN_SCALE,
            Math.min(GLOW_COMPENSATION_MAX_SCALE, Math.round(glowCompensationScale))
        );
        let entry = this.glowCacheEntries.get(cacheKey);
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
        this.#rebuildGlowCache(entry, cacheKey);
        this.glowCacheEntries.set(cacheKey, entry);
        return entry;
    }

    /**
     * glow 캐시 이미지를 현재 스케일에 맞춰 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
     * @param {{canvas: HTMLCanvasElement, offsetX: number, offsetY: number}|null} entry - 사용할 glow 캐시 엔트리입니다.
     * @param {number} alpha - 적용할 알파 값입니다.
     * @param {number} drawScale - 현재 화면에 그릴 스케일입니다.
     * @private
     */
    #drawGlowCacheEntry(ctx, entry, alpha, drawScale) {
        if (!entry || alpha <= 0 || drawScale <= 0 || entry.canvas.width <= 0 || entry.canvas.height <= 0) {
            return;
        }

        ctx.globalAlpha = alpha;
        ctx.drawImage(
            entry.canvas,
            this.centerX - (entry.offsetX * drawScale),
            this.centerY - (entry.offsetY * drawScale),
            entry.canvas.width * drawScale,
            entry.canvas.height * drawScale
        );
    }

    /**
     * 현재 글로우 상태를 오프스크린 캔버스로 다시 렌더링합니다.
     * @param {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|null, offsetX: number, offsetY: number}} entry - glow 캐시 엔트리입니다.
     * @param {number} glowCompensationScale - 현재 글로우 보정 배율입니다.
     * @private
     */
    #rebuildGlowCache(entry, glowCompensationScale) {
        const glowSettings = getLoadingGlowSettings();
        const haloStops = Array.isArray(glowSettings?.haloStops) ? glowSettings.haloStops : DEFAULT_LOADING_GLOW_STOPS;
        const ringSettings = glowSettings.ring || DEFAULT_LOADING_GLOW_RING;
        const surfaceSettings = glowSettings.surface || DEFAULT_LOADING_GLOW_SURFACE;
        const glowContext = entry?.context;
        if (!glowContext) {
            return;
        }

        const drawRadius = Math.max(1, this.radius);
        const drawOutlineWidth = Math.max(1, this.outlineWidth);
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

        this.#resizeGlowCanvas(entry.canvas, canvasSize, canvasSize);
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
            haloGradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), toRgba(stop.color, stopAlpha));
        }
        if (haloStops.length === 0) {
            const fallbackStopColor = toRgba(getLoadingAccentColor(), 0);
            haloGradient.addColorStop(0, fallbackStopColor);
            haloGradient.addColorStop(1, fallbackStopColor);
        }

        glowContext.save();
        glowContext.globalCompositeOperation = 'screen';
        this.#drawHaloRing(glowContext, center, center, haloInnerRadius, haloOuterRadius, haloGradient);
        this.#drawDitheredHaloNoise(
            glowContext,
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
        this.#drawGlowRing(
            glowContext,
            center,
            center,
            glowRadius,
            glowLineWidth,
            toRgba(ringColor, ringAlpha),
            glowBlur,
            toRgba(ringShadowColor, ringShadowAlpha)
        );
        glowContext.restore();

        entry.offsetX = center;
        entry.offsetY = center;
    }

    /**
     * glow 캐시 캔버스 크기를 필요한 경우에만 갱신합니다.
     * @param {HTMLCanvasElement} canvas - 대상 캐시 캔버스입니다.
     * @param {number} width - 목표 너비입니다.
     * @param {number} height - 목표 높이입니다.
     * @private
     */
    #resizeGlowCanvas(canvas, width, height) {
        const nextWidth = Math.max(1, Math.ceil(width));
        const nextHeight = Math.max(1, Math.ceil(height));
        if (!canvas) {
            return;
        }
        if (canvas.width === nextWidth && canvas.height === nextHeight) {
            return;
        }

        canvas.width = nextWidth;
        canvas.height = nextHeight;
    }

    /**
     * glow 캐시 엔트리를 모두 정리합니다.
     * @private
     */
    #clearGlowCaches() {
        for (const entry of this.glowCacheEntries.values()) {
            entry.canvas.width = 0;
            entry.canvas.height = 0;
        }
        this.glowCacheEntries.clear();
    }

    /**
     * glow 밴딩 완화를 위한 디더링 노이즈 캔버스를 생성합니다.
     * @returns {HTMLCanvasElement|null} 생성된 노이즈 캔버스
     * @private
     */
    #createGlowNoiseCanvas() {
        const noiseCanvas = document.createElement('canvas');
        const noiseSize = 96;
        noiseCanvas.width = noiseSize;
        noiseCanvas.height = noiseSize;

        const noiseCtx = noiseCanvas.getContext('2d');
        if (!noiseCtx) {
            return null;
        }

        const imageData = noiseCtx.createImageData(noiseSize, noiseSize);
        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const intensity = 200 + Math.floor(Math.random() * 56);
            const alpha = Math.floor(Math.random() * 38);
            pixels[i] = intensity - 18;
            pixels[i + 1] = intensity;
            pixels[i + 2] = 255;
            pixels[i + 3] = alpha;
        }

        noiseCtx.putImageData(imageData, 0, 0);
        return noiseCanvas;
    }

    /**
     * bloom의 바깥 halo 링을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
     * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
     * @param {number} innerRadius - halo 시작 반경
     * @param {number} outerRadius - halo 종료 반경
     * @param {CanvasGradient|CanvasPattern|string} fillStyle - 적용할 채우기 스타일
     * @private
     */
    #drawHaloRing(ctx, centerX, centerY, innerRadius, outerRadius, fillStyle) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, TWO_PI);
        ctx.arc(centerX, centerY, innerRadius, 0, TWO_PI, true);
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.restore();
    }

    /**
     * glow 밴딩을 줄이기 위해 halo 영역에 약한 노이즈를 덮습니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
     * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
     * @param {number} innerRadius - halo 시작 반경
     * @param {number} outerRadius - halo 종료 반경
     * @param {number} alpha - 디더링 알파 값
     * @private
     */
    #drawDitheredHaloNoise(ctx, centerX, centerY, innerRadius, outerRadius, alpha) {
        if (!this.glowNoiseCanvas || alpha <= 0) {
            return;
        }

        const pattern = ctx.createPattern(this.glowNoiseCanvas, 'repeat');
        if (!pattern) {
            return;
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'soft-light';
        this.#drawHaloRing(ctx, centerX, centerY, innerRadius, outerRadius, pattern);
        ctx.restore();
    }

    /**
     * bloom의 링 형태 glow 패스를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
     * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
     * @param {number} radius - 링 반경
     * @param {number} lineWidth - 링 두께
     * @param {string} strokeStyle - 링 색상
     * @param {number} shadowBlur - 그림자 블러 반경
     * @param {string} shadowColor - 그림자 색상
     * @private
     */
    #drawGlowRing(ctx, centerX, centerY, radius, lineWidth, strokeStyle, shadowBlur, shadowColor) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, TWO_PI);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.shadowBlur = shadowBlur;
        ctx.shadowColor = shadowColor;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 선명한 원형 outline을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} drawRadius - 현재 렌더 반경입니다.
     * @param {number} drawOutlineWidth - 현재 렌더 외곽선 두께입니다.
     * @private
     */
    #drawOutline(ctx, drawRadius, drawOutlineWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, drawRadius, 0, TWO_PI);
        ctx.lineWidth = drawOutlineWidth;
        ctx.strokeStyle = getLoadingAccentColor();
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 진행률에 따라 원 내부를 채우고 파도 애니메이션을 적용합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {number} drawRadius - 현재 렌더 반경입니다.
     * @private
     */
    #drawFill(ctx, drawRadius) {
        const innerRadius = Math.max(1, drawRadius);
        const fillData = this.#buildFillData(innerRadius);

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, innerRadius, 0, TWO_PI);
        ctx.clip();

        ctx.fillStyle = getLoadingAccentColor();
        ctx.fill(fillData.path);

        this.#drawSurfaceHighlight(ctx, fillData, drawRadius);
        ctx.restore();
    }

    /**
     * 진행률에 맞는 파도 형태의 내부 fill 경로를 계산합니다.
     * @param {number} innerRadius - 내부 채움 반경
     * @returns {{path: Path2D, surfacePoints: Array<{x:number, y:number}>}} fill 경로와 표면 포인트
     * @private
     */
    #buildFillData(innerRadius) {
        const fillBottomY = this.centerY + innerRadius;
        const fillHeight = (innerRadius * 2) * this.progress;
        const fillTopBaseY = fillBottomY - fillHeight;
        const amplitudeLimit = innerRadius * 0.06;
        const amplitude = this.progress >= 1
            ? 0
            : Math.min(amplitudeLimit, Math.max(1.5, fillHeight * 0.2));
        const leftX = this.centerX - innerRadius - (amplitude * 2);
        const rightX = this.centerX + innerRadius + (amplitude * 2);
        const segments = 30;
        const path = new Path2D();
        const surfacePoints = [];

        path.moveTo(leftX, fillBottomY + innerRadius);
        path.lineTo(leftX, fillTopBaseY);

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = leftX + ((rightX - leftX) * t);
            const y = this.#getWaveY(t, fillTopBaseY, amplitude);
            surfacePoints.push({ x, y });
            path.lineTo(x, y);
        }

        path.lineTo(rightX, fillBottomY + innerRadius);
        path.closePath();

        return { path, surfacePoints };
    }

    /**
     * 특정 정규화 위치에서 파도 표면의 y 좌표를 계산합니다.
     * @param {number} normalizedX - 0~1 범위의 정규화 x 값
     * @param {number} baseY - 표면 기준 y 값
     * @param {number} amplitude - 파도 진폭
     * @returns {number} 계산된 y 값
     * @private
     */
    #getWaveY(normalizedX, baseY, amplitude) {
        const primary = Math.sin((normalizedX * Math.PI * 2.2) + this.wavePhase) * amplitude;
        const secondary = Math.sin((normalizedX * Math.PI * 5.2) - this.secondaryWavePhase) * (amplitude * 0.32);
        return baseY + primary + secondary;
    }

    /**
     * fill 상단의 밝은 수면선을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {{surfacePoints: Array<{x:number, y:number}>}} fillData - fill 표면 포인트
     * @param {number} drawRadius - 현재 렌더 반경입니다.
     * @private
     */
    #drawSurfaceHighlight(ctx, fillData, drawRadius) {
        if (this.progress >= 1) {
            return;
        }

        const points = fillData.surfacePoints;
        if (!Array.isArray(points) || points.length === 0) {
            return;
        }
        const surfaceSettings = getLoadingGlowSettings().surface;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineWidth = Math.max(1.5, drawRadius * 0.022);
        ctx.strokeStyle = toRgba(surfaceSettings?.Highlight || getLoadingAccentColor(), surfaceSettings?.HighlightAlpha || 0);
        ctx.shadowBlur = drawRadius * 0.06;
        ctx.shadowColor = toRgba(surfaceSettings?.Shadow || getLoadingAccentColor(), surfaceSettings?.ShadowAlpha || 0);
        ctx.stroke();
        ctx.restore();
    }
}
