/** Collision shader literal formatting; no runtime state. */
export const WGSL_POLYGON_POINT_CAPACITY = 8;

export const toWgslFloat = (value) => {
    if (!Number.isFinite(value)) {
        throw new TypeError('WGSL enemy shape 좌표는 유한한 숫자여야 합니다.');
    }
    const normalized = Object.is(value, -0) ? 0 : value;
    const literal = String(normalized);
    return /[.eE]/.test(literal) ? literal : `${literal}.0`;
};

export const toWgslVec2 = ({ x, y }) => (
    `vec2f(${toWgslFloat(x)}, ${toWgslFloat(y)})`
);

export const toWgslPointArray = (
    points,
    capacity = WGSL_POLYGON_POINT_CAPACITY
) => {
    if (points.length > capacity) {
        throw new RangeError(`WGSL enemy shape point capacity를 초과했습니다: ${points.length}`);
    }
    const padded = Array.from(points);
    while (padded.length < capacity) {
        padded.push({ x: 0, y: 0 });
    }
    return `array<vec2f, ${capacity}>(\n        ${padded.map(toWgslVec2).join(',\n        ')}\n    )`;
};
