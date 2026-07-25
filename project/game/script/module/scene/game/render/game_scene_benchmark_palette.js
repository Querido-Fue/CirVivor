import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';

const BENCHMARK_COLOR_FALLBACKS = Object.freeze({
    StaticWall: 'rgba(120, 136, 156, 0.9)',
    BoxWall: 'rgba(182, 201, 214, 0.9)',
    Player: '#4fa3ff',
    Projectile: '#ffc857',
    EnemyFill: '#ff6c6c',
    HexaBackdropFallback: 'rgb(255, 212, 184)',
    ButtonIdle: 'rgba(26, 32, 40, 0.74)',
    ButtonHover: 'rgba(26, 32, 40, 0.86)',
    ButtonStroke: 'rgba(255, 255, 255, 0.55)',
    ButtonText: '#f5f8ff'
});

/**
 * 벤치마크 씬 전용 테마 색상을 반환합니다.
 * @param {string} key - 색상 키입니다.
 * @returns {string} 색상 문자열입니다.
 */
export function getBenchmarkColor(key) {
    const themeColor = ColorSchemes?.Game?.Benchmark?.[key];
    if (typeof themeColor === 'string' && themeColor.length > 0) {
        return themeColor;
    }

    return BENCHMARK_COLOR_FALLBACKS[key] || '#ffffff';
}

/**
 * 벤치마크 씬 적 기본 색상을 반환합니다.
 * @returns {string} 적 색상 문자열입니다.
 */
export function getBenchmarkEnemyFill() {
    const themeFill = ColorSchemes?.Game?.Benchmark?.EnemyFill;
    if (typeof themeFill === 'string' && themeFill.length > 0) {
        return themeFill;
    }

    return ColorSchemes?.Title?.Enemy || BENCHMARK_COLOR_FALLBACKS.EnemyFill;
}

/**
 * 벤치마크 씬 적 색상을 불투명 문자열로 정규화합니다.
 * @param {string} fill - 원본 색상 문자열입니다.
 * @returns {string} 불투명 색상 문자열입니다.
 */
export function normalizeOpaqueBenchmarkEnemyFill(fill) {
    if (typeof fill !== 'string' || fill.length === 0) {
        return BENCHMARK_COLOR_FALLBACKS.EnemyFill;
    }

    const parsed = colorUtil().cssToRgb(fill);
    return colorUtil().rgbToString(parsed.r, parsed.g, parsed.b, 1);
}
