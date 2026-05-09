import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { clamp01 } from 'util/number_util.js';
import { getLoadingAccentColor } from '../loading/_title_loading_theme.js';

export { toLoadingRgba } from '../loading/_title_loading_theme.js';

const TITLE_LOADING = getData('TITLE_CONSTANTS').TITLE_LOADING;
const DEFAULT_LOADING_GLOW = TITLE_LOADING.GLOW_DEFAULTS;
const DEFAULT_LOADING_GLOW_STOPS = DEFAULT_LOADING_GLOW.HALO_STOPS;
const DEFAULT_LOADING_GLOW_RING = DEFAULT_LOADING_GLOW.RING;
const DEFAULT_LOADING_GLOW_SURFACE = DEFAULT_LOADING_GLOW.SURFACE;
const DEFAULT_LOADING_CIRCLE_SHADER_COLORS = TITLE_LOADING.CIRCLE_SHADER.COLORS;

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
 * 중앙 원형 로딩 WebGL 셰이더에 전달할 색상 벡터를 반환합니다.
 * @returns {{base:number[], deep:number[], rim:number[], highlight:number[], surface:number[]}} 0~1 범위 색상 벡터입니다.
 */
export function getLoadingCircleShaderColors() {
    const loading = ColorSchemes?.Title?.Loading;
    const loadingCircle = loading?.Circle;
    const loadingGlow = loading?.Glow;
    const accent = getLoadingAccentColor();
    const highlightFallback = ColorSchemes?.Cursor?.White
        || loadingGlow?.Surface?.Highlight
        || accent;

    return {
        base: _loadingColorToVec3(loadingCircle?.Base || accent, DEFAULT_LOADING_CIRCLE_SHADER_COLORS.base),
        deep: _loadingColorToVec3(
            loadingCircle?.Deep || loadingGlow?.Ring?.ShadowColor || accent,
            DEFAULT_LOADING_CIRCLE_SHADER_COLORS.deep
        ),
        rim: _loadingColorToVec3(
            loadingCircle?.Rim || loadingGlow?.Ring?.Color || accent,
            DEFAULT_LOADING_CIRCLE_SHADER_COLORS.rim
        ),
        highlight: _loadingColorToVec3(
            loadingCircle?.Highlight || highlightFallback,
            DEFAULT_LOADING_CIRCLE_SHADER_COLORS.highlight
        ),
        surface: _loadingColorToVec3(
            loadingCircle?.Surface || loadingGlow?.Surface?.Highlight || highlightFallback,
            DEFAULT_LOADING_CIRCLE_SHADER_COLORS.surface
        )
    };
}

/**
 * CSS 색상 문자열을 WebGL 셰이더용 vec3 배열로 변환합니다.
 * @param {string|null|undefined} color - CSS 색상 문자열입니다.
 * @param {number[]} fallback - 변환 실패 시 사용할 색상 벡터입니다.
 * @returns {number[]} 0~1 범위의 RGB 배열입니다.
 */
function _loadingColorToVec3(color, fallback) {
    const colorString = typeof color === 'string' ? color.trim() : '';
    if (!colorString) {
        return fallback;
    }

    const parsedColor = colorUtil().cssToRgb(colorString);
    if (!parsedColor) {
        return fallback;
    }

    return Object.freeze([
        clamp01(parsedColor.r / 255),
        clamp01(parsedColor.g / 255),
        clamp01(parsedColor.b / 255)
    ]);
}
