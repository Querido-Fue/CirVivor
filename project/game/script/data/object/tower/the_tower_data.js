/**
 * The Tower의 타일 기준 크기와 fixed-step 이동 밸런스 데이터입니다.
 * 현재 지수 마찰 적분에서
 * `CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED / LINEAR_FRICTION_PER_SECOND`가
 * 입력 유지 시 `MOVE_SPEED_TILES_PER_SECOND`가 되도록 함께 조정합니다.
 *
 * 모든 길이와 속도는 렌더 픽셀이 아니라 타일 월드 단위입니다.
 * Tower에는 체력 데이터가 존재하지 않습니다.
 * @type {Readonly<{
 * RADIUS_TILES:number,
 * MOVE_SPEED_TILES_PER_SECOND:number,
 * CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED:number,
 * LINEAR_FRICTION_PER_SECOND:number,
 * SLEEP_SPEED_TILES_PER_SECOND:number,
 * MASS:number,
 * MAX_LINEAR_SPEED_TILES_PER_SECOND:number
 * }>}
 */
export const THE_TOWER_DATA = Object.freeze({
    RADIUS_TILES: 0.5,
    MOVE_SPEED_TILES_PER_SECOND: 7.8,
    CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED: 78,
    LINEAR_FRICTION_PER_SECOND: 10,
    SLEEP_SPEED_TILES_PER_SECOND: 1 / 96,
    MASS: 1,
    MAX_LINEAR_SPEED_TILES_PER_SECOND: 25
});
