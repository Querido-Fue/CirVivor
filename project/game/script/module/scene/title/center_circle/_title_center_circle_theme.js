import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { clamp01 } from 'util/number_util.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from '../_title_runtime_constants.js';
import { getLoadingAccentColor } from '../loading/_title_loading_theme.js';

export { toLoadingRgba } from '../loading/_title_loading_theme.js';

const DEFAULT_LOADING_GLOW = TITLE_LOADING.GLOW_DEFAULTS;
const DEFAULT_LOADING_GLOW_STOPS = DEFAULT_LOADING_GLOW.HALO_STOPS;
const DEFAULT_LOADING_GLOW_RING = DEFAULT_LOADING_GLOW.RING;
const DEFAULT_LOADING_GLOW_SURFACE = DEFAULT_LOADING_GLOW.SURFACE;
const DEFAULT_LOADING_CIRCLE_SHADER_COLORS = TITLE_LOADING.CIRCLE_SHADER.COLORS;
const LOADING_CIRCLE_SHADER_COLOR_CACHE = {
    initialized: false,
    baseSource: null,
    deepSource: null,
    rimSource: null,
    highlightSource: null,
    base: null,
    deep: null,
    rim: null,
    highlight: null
};

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
        surface: _writeLoadingGlowSurfaceSettings({}, loadingGlow?.Surface, fallbackColor)
    };
}

/**
 * 중앙 원형 수면선 glow 설정만 읽어 호출자 소유 객체에 기록합니다.
 * @param {object|null} [out=null] - 갱신할 재사용 설정 객체입니다.
 * @returns {{Highlight:string, HighlightAlpha:number, Shadow:string, ShadowAlpha:number}} 전달받은 객체 또는 새 설정 객체입니다.
 */
export function getLoadingGlowSurfaceSettings(out = null) {
    const loadingGlowSurface = ColorSchemes?.Title?.Loading?.Glow?.Surface;
    const fallbackColor = getLoadingAccentColor();
    const surface = out && typeof out === 'object' ? out : {};
    return _writeLoadingGlowSurfaceSettings(surface, loadingGlowSurface, fallbackColor);
}

/**
 * 해석한 수면선 설정을 대상 객체에 기록합니다.
 * @param {object} surface - 값을 기록할 설정 객체입니다.
 * @param {object|null|undefined} loadingGlowSurface - 현재 테마의 수면선 설정입니다.
 * @param {string} fallbackColor - 색상 fallback입니다.
 * @returns {object} 전달받은 설정 객체입니다.
 */
function _writeLoadingGlowSurfaceSettings(surface, loadingGlowSurface, fallbackColor) {
    surface.Highlight = typeof loadingGlowSurface?.Highlight === 'string' && loadingGlowSurface.Highlight
        ? loadingGlowSurface.Highlight
        : fallbackColor;
    surface.HighlightAlpha = Number.isFinite(loadingGlowSurface?.HighlightAlpha)
        ? loadingGlowSurface.HighlightAlpha
        : DEFAULT_LOADING_GLOW_SURFACE.HighlightAlpha;
    surface.Shadow = typeof loadingGlowSurface?.Shadow === 'string' && loadingGlowSurface.Shadow
        ? loadingGlowSurface.Shadow
        : fallbackColor;
    surface.ShadowAlpha = Number.isFinite(loadingGlowSurface?.ShadowAlpha)
        ? loadingGlowSurface.ShadowAlpha
        : DEFAULT_LOADING_GLOW_SURFACE.ShadowAlpha;
    return surface;
}

/**
 * 중앙 원형 WebGL 셰이더에 전달할 색상 벡터를 반환합니다.
 * @returns {{base:number[], deep:number[], rim:number[], highlight:number[]}} 0~1 범위 색상 벡터입니다.
 */
export function getLoadingCircleShaderColors() {
    const loading = ColorSchemes?.Title?.Loading;
    const loadingCircle = loading?.Circle;
    const loadingGlow = loading?.Glow;
    const accent = getLoadingAccentColor();
    const highlightFallback = ColorSchemes?.Cursor?.White
        || loadingGlow?.Surface?.Highlight
        || accent;
    const baseSource = loadingCircle?.Base || accent;
    const deepSource = loadingCircle?.Deep || loadingGlow?.Ring?.ShadowColor || accent;
    const rimSource = loadingCircle?.Rim || loadingGlow?.Ring?.Color || accent;
    const highlightSource = loadingCircle?.Highlight || highlightFallback;
    const cache = LOADING_CIRCLE_SHADER_COLOR_CACHE;

    if (
        !cache.initialized
        || cache.baseSource !== baseSource
        || cache.deepSource !== deepSource
        || cache.rimSource !== rimSource
        || cache.highlightSource !== highlightSource
    ) {
        cache.initialized = true;
        cache.baseSource = baseSource;
        cache.deepSource = deepSource;
        cache.rimSource = rimSource;
        cache.highlightSource = highlightSource;
        cache.base = _loadingColorToVec3(baseSource, DEFAULT_LOADING_CIRCLE_SHADER_COLORS.base);
        cache.deep = _loadingColorToVec3(deepSource, DEFAULT_LOADING_CIRCLE_SHADER_COLORS.deep);
        cache.rim = _loadingColorToVec3(rimSource, DEFAULT_LOADING_CIRCLE_SHADER_COLORS.rim);
        cache.highlight = _loadingColorToVec3(highlightSource, DEFAULT_LOADING_CIRCLE_SHADER_COLORS.highlight);
    }

    return {
        base: cache.base,
        deep: cache.deep,
        rim: cache.rim,
        highlight: cache.highlight
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
