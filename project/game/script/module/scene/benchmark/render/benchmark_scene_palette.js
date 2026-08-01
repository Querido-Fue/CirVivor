import { ColorSchemes } from 'display/_theme_handler.js';

const BENCHMARK_COLOR_FALLBACKS = Object.freeze({
    StaticWall: 'rgba(120, 136, 156, 0.9)',
    BoxWall: 'rgba(182, 201, 214, 0.9)',
    Player: '#4fa3ff',
    Projectile: '#ffc857',
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
