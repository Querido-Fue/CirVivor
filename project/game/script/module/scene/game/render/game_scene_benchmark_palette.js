import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';

const BENCHMARK_COLOR_FALLBACKS = getData('GAME_SCENE_CONSTANTS').BENCHMARK.COLOR_FALLBACKS;

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
