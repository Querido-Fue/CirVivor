/**
 * The Tower의 타일 기준 크기와 fixed-step 이동 밸런스 데이터입니다.
 * 현재 지수 마찰 적분에서
 * `CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED / LINEAR_FRICTION_PER_SECOND`가
 * 입력 유지 시 `MOVE_SPEED_TILES_PER_SECOND`가 되도록 함께 조정합니다.
 *
 * 모든 길이와 속도는 렌더 픽셀이 아니라 타일 월드 단위입니다.
 * @type {Readonly<{
 * RADIUS_TILES:number,
 * DAMAGEABLE_CONTACT_RADIUS_SCALE:number,
 * MOVE_SPEED_TILES_PER_SECOND:number,
 * CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED:number,
 * LINEAR_FRICTION_PER_SECOND:number,
 * SLEEP_SPEED_TILES_PER_SECOND:number,
 * WEIGHT:number,
 * MAX_LINEAR_SPEED_TILES_PER_SECOND:number
 * }>}
 */
export const THE_TOWER_DATA = Object.freeze({
    RADIUS_TILES: 0.5,
    DAMAGEABLE_CONTACT_RADIUS_SCALE: 1.01,
    MOVE_SPEED_TILES_PER_SECOND: 7.8,
    CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED: 78,
    LINEAR_FRICTION_PER_SECOND: 10,
    SLEEP_SPEED_TILES_PER_SECOND: 1 / 96,
    WEIGHT: 10,
    MAX_LINEAR_SPEED_TILES_PER_SECOND: 25
});

/** GPU_WORLD R1 single-Tower combat baseline의 단일 수치 권위입니다. */
export const THE_TOWER_COMBAT_DATA = Object.freeze({
    MAX_HEALTH: 30,
    BASE_POWER: 10,
    MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS: 60
});

/** CPU fallback renderer와 GPU direct renderer가 공유하는 Tower presentation data입니다. */
export const THE_TOWER_RENDER_DATA = Object.freeze({
    FILL: '#2785ff',
    COLOR_RGBA: Object.freeze([39 / 255, 133 / 255, 1, 1]),
    RADIUS_SCALE: 1
});
