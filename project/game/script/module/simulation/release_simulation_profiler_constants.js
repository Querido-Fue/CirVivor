/**
 * 릴리스 시뮬레이션 프로파일러와 HUD가 공유하는 계측 상수입니다.
 */
export const RELEASE_SIMULATION_PROFILER_CONSTANTS = Object.freeze({
    RATE_WINDOW_MS: 1000,
    QUANTILE_WINDOW_MS: 10000,
    SNAPSHOT_INTERVAL_MS: 1000,
    FRAME_RING_CAPACITY: 4096,
    FIXED_RING_CAPACITY: 1024,
    QUANTILE_P50: 0.5,
    QUANTILE_P95: 0.95,
    QUANTILE_P99: 0.99,
    HUD: Object.freeze({
        FONT_MIN_SIZE: 11,
        FONT_WW_RATIO: 0.0075,
        LINE_HEIGHT_RATIO: 1.32,
        X_WW_RATIO: 0.985,
        Y_WH_RATIO: 0.04,
        PANEL_PADDING_RATIO: 0.65,
        PANEL_CHAR_WIDTH_RATIO: 0.56,
        PANEL_FILL: 'rgba(0, 0, 0, 0.72)',
        TEXT_FILL: '#FFFFFF',
        FONT_WEIGHT: 500
    })
});
