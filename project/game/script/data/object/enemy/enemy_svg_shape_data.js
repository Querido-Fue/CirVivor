/**
 * 다각형의 꼭짓점 좌표 배열을 생성합니다.
 * @param {number} sides 다각형의 변 개수
 * @param {number} radius 반지름 크기
 * @param {number} [rotation=-Math.PI / 2] 시작 회전 각도
 * @returns {Array<{x: number, y: number}>} 생성된 좌표 점 배열
 */
const polygonPoints = (sides, radius, rotation = -Math.PI / 2) => {
    const points = [];
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
        const a = rotation + i * step;
        points.push({
            x: Math.cos(a) * radius,
            y: Math.sin(a) * radius
        });
    }
    return points;
};

/**
 * 좌표 배열을 SVG 경로 문자열로 변환합니다.
 * @param {Array<{x: number, y: number}>} points 좌표 객체 배열
 * @returns {string} 완성된 SVG d 속성 경로 문자열
 */
const pointsToPath = (points) => {
    if (!points || points.length === 0) return '';
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`;
};

/**
 * 지정된 위치와 크기의 직사각형 SVG 경로 문자열을 생성합니다.
 * @param {number} x 시작 x좌표
 * @param {number} y 시작 y좌표
 * @param {number} w 직사각형 너비
 * @param {number} h 직사각형 높이
 * @returns {string} 사각형 SVG 경로 문자열
 */
const rectPath = (x, y, w, h) => `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;

/**
 * 각 적 형태별 SVG 그리기 데이터 목록
 */
export const ENEMY_SVG_SHAPES = Object.freeze({
    enemy_square: [rectPath(-0.42, -0.42, 0.84, 0.84)],
    enemy_triangle: [pointsToPath([
        { x: 0.0, y: -0.5333 },
        { x: 0.462, y: 0.2667 },
        { x: -0.462, y: 0.2667 }
    ])],
    enemy_arrow: [pointsToPath([
        { x: 0.0, y: -0.5767 },
        { x: 0.46, y: 0.3733 },
        { x: 0.0, y: 0.2033 },
        { x: -0.46, y: 0.3733 }
    ])],
    enemy_hexa: [pointsToPath(polygonPoints(6, 0.47, -Math.PI / 2))],
    enemy_penta: [pointsToPath(polygonPoints(5, 0.48, -Math.PI / 2))],
    enemy_rhom: [pointsToPath([
        { x: 0.0, y: -0.50 },
        { x: 0.34, y: 0.0 },
        { x: 0.0, y: 0.50 },
        { x: -0.34, y: 0.0 }
    ])],
    enemy_octa: [pointsToPath(polygonPoints(8, 0.47, Math.PI / 8))],
    enemy_gen: [
        {
            d: `${rectPath(-0.30, -0.30, 0.60, 0.60)} ${rectPath(-0.22, -0.22, 0.44, 0.44)}`,
            fillRule: 'evenodd'
        },
        rectPath(-0.44, -0.44, 0.10, 0.10),
        rectPath(0.34, -0.44, 0.10, 0.10),
        rectPath(0.34, 0.34, 0.10, 0.10),
        rectPath(-0.44, 0.34, 0.10, 0.10)
    ]
});
