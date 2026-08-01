/**
 * 신규 플레이에서 처음 사용하는 GPU 원형 적 정의입니다.
 *
 * 속도는 legacy 기본 steering의 40 px/s와 16 px navigation cell을 타일 grid로
 * 환산한 2.5 cells/s입니다. 반경은 1타일 square의 legacy 충돌 벡터
 * (0.42, 0.42)를 감싸는 원이며, weight와 색상도 같은 square 적을 기준으로
 * 타일/선형 RGBA 단위에 명시적으로 옮겼습니다.
 * 피격 처리를 GPU contact 경계에서 바로 검증할 수 있도록 기본 HP만 선언합니다.
 * 무기별 피해·속성·특수 효과는 projectile definition이 별도로 소유합니다.
 */
export const BASIC_CIRCLE_ENEMY_DATA = Object.freeze({
    id: 'basic_circle_01',
    shapeType: 'square',
    moveSpeedTilesPerSecond: 2.5,
    collisionRadiusTiles: 0.5939696961966999,
    collisionWeight: 1,
    maxHealth: 1,
    colorRgba: Object.freeze([
        1,
        0.4235294117647059,
        0.4235294117647059,
        1
    ]),
    radiusScale: 1
});

/** 적 definition ID를 선언 데이터로 해석하는 읽기 전용 catalog입니다. */
export const INGAME_ENEMY_DEFINITION_BY_ID = Object.freeze({
    [BASIC_CIRCLE_ENEMY_DATA.id]: BASIC_CIRCLE_ENEMY_DATA
});
