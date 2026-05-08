import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { getLoadingAccentColor } from '../loading/_title_loading_theme.js';

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

/**
 * 중앙 원형 로딩 glow에 사용할 색상 설정을 반환합니다.
 * @returns {{haloStops: Array<object>, ring: object, surface: object}} 로딩 glow 설정
 */
export function getLoadingGlowSettings() {
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
export function toLoadingRgba(color, alpha) {
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
